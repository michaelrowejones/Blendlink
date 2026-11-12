# SPDX-License-Identifier: GPL-3.0-or-later
"""Native spatial GPU Math: all available enums and defined-domain guards."""
import json
import os
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    oracle = NativeCompositorReference(output, device="GPU", name="Native Spatial Math")
    tree = oracle.tree
    gpu_profile = compositor_graph._sibling("compositor_gpu").native_gpu_profile()
    (Path(output) / "gpu-profile.json").write_text(json.dumps(gpu_profile, indent=2))
    node_type = "ShaderNodeMath" if oracle.modern else "CompositorNodeMath"
    probe = tree.nodes.new(node_type)
    operations = [item.identifier for item in probe.bl_rna.properties["operation"].enum_items if item.identifier]
    profiles = ((0.4, 0.2), (1.3, 0.1), (0, 0), (1, 0), (-1, 0), (2, 0))

    def math(operation, a, b=None):
        node = tree.nodes.new(node_type)
        node.operation = operation
        tree.links.new(a, node.inputs[0])
        if b is not None:
            tree.links.new(b, node.inputs[1])
        return node.outputs[0]

    for operation in operations:
        for profile, (second, third) in enumerate(profiles):
            sink, source = oracle.reset()
            node = tree.nodes.new(node_type)
            node.operation = operation
            active = [socket for socket in node.inputs if socket.enabled and not getattr(socket, "is_unavailable", False)]
            if len(active) == 1 and profile:
                break
            if (operation == "LOGARITHM" and second == 1) or (not oracle.modern and operation == "ARCTAN2" and second == 0):
                continue  # Native GPU domains are undefined and separately refused.
            first = oracle.separate(source.outputs["Image"]).outputs["Red"]
            if operation == "INVERSE_SQRT":
                first = math("MAXIMUM", first, oracle.value(0.125))
            tree.links.new(first, node.inputs[0])
            for socket, number in zip(node.inputs[1:], (second, third)):
                if socket.enabled and not getattr(socket, "is_unavailable", False):
                    tree.links.new(oracle.value(number), socket)
            tree.links.new(node.outputs[0], sink.inputs[0])
            oracle.save("math-spatial-" + operation.lower() + "-" + str(profile), source, exact_alpha=True)
    sink, source = oracle.reset()
    first = oracle.separate(source.outputs["Image"]).outputs["Red"]
    first = math("ADD", math("ABSOLUTE", first), oracle.value(0.125))
    result = math("INVERSE_SQRT", first)
    tree.links.new(result, sink.inputs[0])
    oracle.save("math-spatial-inverse-sqrt-absolute-offset", source, exact_alpha=True)

    undefined = []
    modes = ["logarithm-base-one", "unbounded-inverse-sqrt"]
    if not oracle.modern:
        modes += ["arctan2-origin", "float32-cancellation"]
    for mode in modes:
        sink, source = oracle.reset()
        if mode != "float32-cancellation":
            first = oracle.separate(source.outputs["Image"]).outputs["Red"]
        else:
            first = math("ADD", oracle.value(2 ** 24), oracle.value(1))
            first = math("SUBTRACT", first, oracle.value(2 ** 24))
        operation = "LOGARITHM" if mode == "logarithm-base-one" else "ARCTAN2" if mode == "arctan2-origin" else "INVERSE_SQRT"
        second = oracle.value(1 if operation == "LOGARITHM" else 0) if operation != "INVERSE_SQRT" else None
        tree.links.new(math(operation, first, second), sink.inputs[0])
        refused = compositor_graph.extract(oracle.scene)
        assert refused["status"] == "unsupported", (mode, refused)
        assert refused["diagnostics"][-1]["code"] in {
            "legacy-gpu-inverse-sqrt-domain", "gpu-inverse-sqrt-domain", "legacy-logarithm-domain", "gpu-logarithm-domain", "gpu-arctan2-domain"}, refused
        replacement = tree.nodes.new("CompositorNodeImage")
        replacement.image = oracle.image
        for link in list(source.outputs["Image"].links):
            tree.links.new(replacement.outputs["Image"], link.to_socket)
        oracle.scene.render.filepath = str(Path(output) / (mode + ".exr"))
        bpy.ops.render.render(write_still=True)
        result = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False)
        native = np.asarray(result.pixels[:], np.float32)
        finite = bool(np.isfinite(native).all())
        # GLSL atan(y,x) explicitly leaves(0,0) undefined. Mesa can return a
        # finite2.35619 here while Metal returnsNaN; neither is a portable
        # authored result. Preserve the refusal and record the native outcome.
        if not (mode == "arctan2-origin" and gpu_profile["backend"] == "OPENGL"):
            assert not finite, (mode, "Native domain is unexpectedly finite")
        bpy.data.images.remove(result)
        undefined.append({"case": mode, "diagnostics": refused["diagnostics"], "nativeFinite": finite,
                          "nativeFirstPixel": [float(v) if np.isfinite(v) else str(v) for v in native[:4]]})
    (Path(output) / "undefined.json").write_text(json.dumps(undefined, indent=2))
    oracle.finish("BLENDLINK_COMPOSITOR_MATH_SPATIAL_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_MATH_SPATIAL_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-math-spatial-") as directory:
        main(Path(directory))
