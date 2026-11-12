# SPDX-License-Identifier: GPL-3.0-or-later
"""Native compositor blend modes, alpha rules, and scalar/vector Mix domains."""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get("BLENDLINK_COMPOSITOR_MIX_DEVICE", "CPU"), name="Native Mix")
    # Keep Divide's finite outputs bounded while retaining explicit zero lanes.
    channels = oracle.pixels[..., :3]
    oracle.pixels[..., :3] = np.where((np.abs(channels) < 0.125) & (channels != 0), np.sign(channels) * 0.125, channels)
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    tree = oracle.tree
    probes = [
        ("zero", 0, True, False, False, True, (0.25, 0.7, 0, 0.35)),
        ("partial", 0.35, True, False, False, True, (0.25, 0.7, 0, 0.35)),
        ("one", 1, True, False, False, True, (0.25, 0.7, 0, 0.35)),
        ("spatial-alpha", "spatial", True, True, False, True, (1.5, -0.2, 0.4, 0.35)),
        ("foreground-alpha", 0.35, False, True, False, True, (0.25, 0.7, 0, 0.35)),
        ("gray-clamp", 0.35, True, True, True, True, (0.5, 0.5, 0.5, 0.35)),
        ("negative-factor", -0.5, True, False, False, False, (1.5, -0.2, 0.4, 0.35)),
        ("above-factor", 1.5, True, False, False, False, (1.5, -0.2, 0.4, 0.35)),
        ("clamped-above", 1.5, True, True, True, True, (0.25, 0.7, 0, 0.35)),
        ("negative-color", 0.35, True, False, False, True, (-0.25, 0, 0.25, 0.35)),
    ]
    node_types = ("ShaderNodeMixRGB", "ShaderNodeMix") if oracle.modern else ("CompositorNodeMixRGB",)
    for node_type in node_types:
        probe = tree.nodes.new(node_type)
        operations = [item.identifier for item in probe.bl_rna.properties["blend_type"].enum_items if item.identifier]
        for operation in operations:
            for label, factor, spatial_back, use_alpha, clamp_result, clamp_factor, color in probes:
                sink, source = oracle.reset()
                node = tree.nodes.new(node_type)
                if node_type == "ShaderNodeMix":
                    node.data_type = "RGBA"
                    node.clamp_factor, node.clamp_result = clamp_factor, clamp_result
                    identifiers = ("Factor_Float", "A_Color", "B_Color")
                else:
                    node.use_alpha, node.use_clamp = use_alpha, clamp_result
                    identifiers = ("Fac", "Color1", "Color2") if oracle.modern else ("Fac", "Image", "Image_001")
                node.blend_type = operation
                sockets = {socket.identifier: socket for socket in node.inputs}
                outputs = {socket.identifier: socket for socket in node.outputs}
                incoming = oracle.separate(source.outputs["Image"]).outputs["Red"] if factor == "spatial" else oracle.value(factor)
                tree.links.new(incoming, sockets[identifiers[0]])
                a = source.outputs["Image"] if spatial_back else oracle.color(color)
                b = oracle.color(color) if spatial_back else source.outputs["Image"]
                tree.links.new(a, sockets[identifiers[1]])
                tree.links.new(b, sockets[identifiers[2]])
                tree.links.new(outputs["Result_Color"] if node_type == "ShaderNodeMix" else node.outputs[0], sink.inputs[0])
                oracle.save("mix-" + node_type.lower() + "-" + operation.lower() + "-" + label, source)
    if oracle.modern:
        for data_type, factor_mode in (("FLOAT", "UNIFORM"), ("VECTOR", "UNIFORM"), ("VECTOR", "NON_UNIFORM")):
            for clamp_factor in (False, True):
                for factor in (-0.5, 0.35, 1.5, "spatial"):
                    sink, source = oracle.reset()
                    node = tree.nodes.new("ShaderNodeMix")
                    node.data_type, node.factor_mode = data_type, factor_mode
                    node.clamp_factor = clamp_factor
                    # These inactive Color controls must not leak into numeric Mix.
                    node.clamp_result = True
                    node.blend_type = "DODGE"
                    sockets = {socket.identifier: socket for socket in node.inputs}
                    outputs = {socket.identifier: socket for socket in node.outputs}
                    vector = data_type == "VECTOR"
                    suffix = "Vector" if vector else "Float"
                    a = source.outputs["Image"] if vector else oracle.separate(source.outputs["Image"]).outputs["Red"]
                    tree.links.new(a, sockets["A_" + suffix])
                    sockets["B_" + suffix].default_value = (0.2, 1.25, -0.5) if vector else 1.25
                    nonuniform = factor_mode == "NON_UNIFORM"
                    if nonuniform:
                        incoming = source.outputs["Image"] if factor == "spatial" else oracle.color((factor, factor * 0.5, -factor, 1))
                    else:
                        incoming = oracle.separate(source.outputs["Image"]).outputs["Red"] if factor == "spatial" else oracle.value(factor)
                    tree.links.new(incoming, sockets["Factor_Vector" if nonuniform else "Factor_Float"])
                    tree.links.new(outputs["Result_" + suffix], sink.inputs[0])
                    oracle.save("mix-" + data_type.lower() + "-" + factor_mode.lower() + "-" + str(int(clamp_factor)) + "-" + str(factor), source)
    oracle.finish("BLENDLINK_COMPOSITOR_MIX_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_MIX_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-mix-") as directory:
        main(Path(directory))
