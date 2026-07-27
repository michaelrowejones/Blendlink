# SPDX-License-Identifier: GPL-3.0-or-later
"""MTLX-TSL-001 reference side: Cycles evaluates each cell's node graph.

Every cell builds a private Emission material and bakes one 0..1 UV tile
through the shipped isolated-channel machinery (`bakelib.uv_tile_proxy` +
`bake_channel_field_pixels`) — exact channel isolation, one deterministic
sample per texel, no lighting, no view transform. The float result is the
ground truth the TSL side must reproduce numerically.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        --python experiments/tsl-node-differential/reference.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(REPO / "packages" / "blender-addon"))

import bakelib  # noqa: E402
import tsl_ir  # noqa: E402

OUTPUT = HERE / "output" / "reference"
CELLS = json.loads((HERE / "cells.json").read_text(encoding="utf8"))
SIZE = int(CELLS["size"])


def emission_material(name, build):
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    build(tree, emission)
    return material


def build_constant_linear(tree, emission):
    emission.inputs["Color"].default_value = (0.25, 0.5, 0.75, 1.0)


def build_uv_gradient(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_math_compare(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    greater = tree.nodes.new("ShaderNodeMath")
    greater.operation = "GREATER_THAN"
    greater.inputs[1].default_value = 0.5
    tree.links.new(separate.outputs["X"], greater.inputs[0])
    less = tree.nodes.new("ShaderNodeMath")
    less.operation = "LESS_THAN"
    less.inputs[1].default_value = 0.5
    tree.links.new(separate.outputs["Y"], less.inputs[0])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(greater.outputs["Value"], combine.inputs["Red"])
    tree.links.new(less.outputs["Value"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_mapping_rotate(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.vector_type = "POINT"
    mapping.inputs["Scale"].default_value = (2.0, 1.0, 1.0)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(30.0))
    tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    # Bias 0.25*p + 0.5 keeps rotated coordinates inside the bakeable range.
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.25
    tree.links.new(mapping.outputs["Vector"], scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(offset.outputs["Vector"], separate.inputs["Vector"])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_colorramp_linear(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (0.1, 0.2, 0.8, 1.0)
    ramp.color_ramp.elements[1].position = 0.8
    ramp.color_ramp.elements[1].color = (0.9, 0.5, 0.1, 1.0)
    tree.links.new(separate.outputs["X"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def _uv_channel(tree, axis):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    return separate.outputs["X" if axis == "u" else "Y"]


def _math(tree, operation, a, b=None):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    if hasattr(a, "name"):
        tree.links.new(a, node.inputs[0])
    else:
        node.inputs[0].default_value = float(a)
    if b is not None:
        if hasattr(b, "name"):
            tree.links.new(b, node.inputs[1])
        else:
            node.inputs[1].default_value = float(b)
    return node.outputs["Value"]


def _affine(tree, socket, scale, offset):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = "MULTIPLY_ADD"
    tree.links.new(socket, node.inputs[0])
    node.inputs[1].default_value = float(scale)
    node.inputs[2].default_value = float(offset)
    return node.outputs["Value"]


def _emit_scalar(tree, emission, socket):
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(socket, combine.inputs["Red"])
    tree.links.new(socket, combine.inputs["Green"])
    tree.links.new(socket, combine.inputs["Blue"])
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_math_safe_divide(tree, emission):
    a = _affine(tree, _uv_channel(tree, "u"), 4.0, -2.0)
    bands = _math(
        tree, "SUBTRACT",
        _math(tree, "FLOOR", _affine(tree, _uv_channel(tree, "v"), 3.0, 0.0)),
        1.0,
    )
    divided = _math(tree, "DIVIDE", a, bands)
    biased = _affine(tree, divided, 0.25, 0.5)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", biased, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_modulo_sign(tree, emission):
    a = _affine(tree, _uv_channel(tree, "u"), 8.0, -4.0)
    result = _math(tree, "MODULO", a, 1.5)
    biased = _affine(tree, result, 0.25, 0.5)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", biased, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_power_negative_base(tree, emission):
    base = _affine(tree, _uv_channel(tree, "u"), 4.0, -2.0)
    result = _math(tree, "POWER", base, 2.0)
    scaled = _affine(tree, result, 0.2, 0.0)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", scaled, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_trig(tree, emission):
    sine = _affine(
        tree,
        _math(tree, "SINE", _affine(tree, _uv_channel(tree, "u"), 8.0, 0.0)),
        0.5, 0.5,
    )
    cosine = _affine(
        tree,
        _math(tree, "COSINE", _affine(tree, _uv_channel(tree, "v"), 8.0, 0.0)),
        0.5, 0.5,
    )
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(sine, combine.inputs["Red"])
    tree.links.new(cosine, combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_colorramp_constant(tree, emission):
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.1, 0.1, 0.7, 1.0)
    ramp.color_ramp.elements[1].position = 0.3
    ramp.color_ramp.elements[1].color = (0.2, 0.7, 0.2, 1.0)
    element = ramp.color_ramp.elements.new(0.6)
    element.color = (0.8, 0.3, 0.1, 1.0)
    tree.links.new(_uv_channel(tree, "u"), ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def build_mapping_texture_mode(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.vector_type = "TEXTURE"
    mapping.inputs["Scale"].default_value = (2.0, 1.0, 1.0)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(30.0))
    tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.25
    tree.links.new(mapping.outputs["Vector"], scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(offset.outputs["Vector"], separate.inputs["Vector"])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_noise_fractal_detail(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 2.0
    if "Roughness" in noise.inputs:
        noise.inputs["Roughness"].default_value = 0.5
    tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])


def build_voronoi_f1_divergence(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    voronoi = tree.nodes.new("ShaderNodeTexVoronoi")
    voronoi.inputs["Scale"].default_value = 4.0
    if hasattr(voronoi, "feature"):
        voronoi.feature = "F1"
    if hasattr(voronoi, "distance"):
        voronoi.distance = "EUCLIDEAN"
    tree.links.new(coord.outputs["UV"], voronoi.inputs["Vector"])
    tree.links.new(voronoi.outputs["Distance"], emission.inputs["Color"])


def build_noise_mx_divergence(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 0.0
    tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])


def build_mix_modes(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate_uv = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate_uv.inputs["Vector"])

    def mix_node(blend_type, factor_socket):
        node = tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        node.blend_type = blend_type
        factor = next(
            item for item in node.inputs
            if item.identifier == "Factor_Float"
        )
        a_input = next(
            item for item in node.inputs if item.identifier == "A_Color"
        )
        b_input = next(
            item for item in node.inputs if item.identifier == "B_Color"
        )
        a_input.default_value = (0.2, 0.8, 0.4, 1.0)
        b_input.default_value = (0.9, 0.1, 0.6, 1.0)
        tree.links.new(factor_socket, factor)
        return next(
            item for item in node.outputs
            if item.identifier == "Result_Color"
        )

    def channel_of(color_socket, channel):
        separate = tree.nodes.new("ShaderNodeSeparateColor")
        separate.mode = "RGB"
        tree.links.new(color_socket, separate.inputs["Color"])
        return separate.outputs[channel]

    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(
        channel_of(mix_node("MIX", separate_uv.outputs["X"]), "Red"),
        combine.inputs["Red"],
    )
    tree.links.new(
        channel_of(mix_node("MULTIPLY", separate_uv.outputs["Y"]), "Green"),
        combine.inputs["Green"],
    )
    tree.links.new(
        channel_of(mix_node("ADD", separate_uv.outputs["X"]), "Blue"),
        combine.inputs["Blue"],
    )
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


BUILDERS = {
    "constant-linear": build_constant_linear,
    "uv-gradient": build_uv_gradient,
    "math-compare": build_math_compare,
    "mapping-rotate": build_mapping_rotate,
    "colorramp-linear": build_colorramp_linear,
    "math-safe-divide": build_math_safe_divide,
    "math-modulo-sign": build_math_modulo_sign,
    "math-power-negative-base": build_math_power_negative_base,
    "math-trig": build_math_trig,
    "colorramp-constant": build_colorramp_constant,
    "mapping-texture-mode": build_mapping_texture_mode,
    "noise-fractal-detail": build_noise_fractal_detail,
    "voronoi-f1-divergence": build_voronoi_f1_divergence,
    "noise-mx-divergence": build_noise_mx_divergence,
    "mix-modes": build_mix_modes,
}


def main():
    import numpy as np

    bpy.ops.wm.read_factory_settings(use_empty=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ir_output = OUTPUT / "ir"
    ir_output.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "size": SIZE, "cells": {}}
    for cell in CELLS["cells"]:
        cell_id = cell["id"]
        pipeline = cell.get("pipeline", "ir")
        builder = BUILDERS.get(cell_id)
        if builder is None:
            raise SystemExit(f"reference builder missing for cell {cell_id!r}")
        material = emission_material(f"CELL {cell_id}", builder)
        ir_path = None
        try:
            if pipeline == "ir":
                # The production emitter walks the SAME graph Cycles bakes;
                # a refusal here is a harness bug, not a soft skip.
                tree = material.node_tree
                emission = next(
                    node for node in tree.nodes
                    if node.bl_idname == "ShaderNodeEmission"
                )
                document = tsl_ir.emit_channel(emission.inputs["Color"])
                ir_path = ir_output / f"{cell_id}.json"
                ir_path.write_text(
                    json.dumps(document, indent=2) + "\n", encoding="utf8",
                )
            proxy = bakelib.uv_tile_proxy([], window=(0.0, 0.0, 1.0, 1.0))
            try:
                proxy.data.materials.append(material)
                result = bakelib.bake_channel_field_pixels(
                    [proxy], size=SIZE, margin_px=0,
                    uv_layer="BLENDLINK_TILE_BAKE",
                    label=f"tsl differential {cell_id}",
                    allow_hdr=True,
                )
            finally:
                bakelib.remove_uv_tile_proxy(proxy)
        finally:
            bpy.data.materials.remove(material, do_unlink=True)
        pixels = np.asarray(result["pixels"], dtype=np.float32)
        path = OUTPUT / f"{cell_id}.f32"
        pixels.tofile(path)
        manifest["cells"][cell_id] = {
            "path": path.name,
            "pipeline": pipeline,
            **({"ir": f"ir/{cell_id}.json"} if ir_path is not None else {}),
            "shape": list(pixels.shape),
            "rgbMin": list(result["rgbMin"]),
            "rgbMax": list(result["rgbMax"]),
            "deviceClass": result["deviceClass"],
            "backend": result["backend"],
        }
        print(f"tsl differential reference: {cell_id} baked ({pipeline})")
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf8",
    )
    print("BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE")


if __name__ == "__main__":
    main()
