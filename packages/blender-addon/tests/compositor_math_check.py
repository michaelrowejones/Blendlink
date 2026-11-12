# SPDX-License-Identifier: GPL-3.0-or-later
"""Native float-pixel oracle for every available compositor Math operation.

BLENDLINK_COMPOSITOR_MATH_REFERENCES retains programs and actual Blender pixels
for experiments/native-compositor-differential. No Python math copy is an oracle.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_graph


def main(output):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    import _cycles
    _cycles.set_device_override("CPU")
    scene.render.resolution_x = scene.render.resolution_y = 2
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    if hasattr(scene.render, "compositor_device"):
        scene.render.compositor_device = "CPU"
    if hasattr(scene.render, "compositor_precision"):
        scene.render.compositor_precision = "FULL"
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    modern = hasattr(scene, "compositing_node_group")
    if modern:
        tree = bpy.data.node_groups.new("Native Scalar Math", "CompositorNodeTree")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
        sink = tree.nodes.new("NodeGroupOutput")
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        sink = tree.nodes.new("CompositorNodeComposite")
    node = tree.nodes.new("ShaderNodeMath" if modern else "CompositorNodeMath")
    node.name = "Artist Math"
    tree.links.new(node.outputs[0], sink.inputs[0])
    operations = [item.identifier for item in node.bl_rna.properties["operation"].enum_items if item.identifier]
    probes = [(-0.75, 0.4, 0.2), (0.75, 1.3, 0.1), (0.5, 0, 0), (1, 1, 0),
              (0, -1, 0), (-2, -1, 0), (-0.5, 2, 0)]
    clamp_probes = {"ADD": (-0.75, 0.4, 0.2), "MULTIPLY": (2, 1.3, 0.1),
                    "POWER": (-2, -1, 0), "SINE": (0.75, 0, 0), "ROUND": (-0.5, 0, 0)}
    rows, undefined = [], []
    for operation in operations:
        node.operation = operation
        operation_probes = [(str(index), values, False) for index, values in enumerate(probes)]
        if operation in clamp_probes:
            operation_probes.append(("clamp", clamp_probes[operation], True))
        for suffix, values, use_clamp in operation_probes:
            node.use_clamp = use_clamp
            for socket, value in zip(node.inputs, values):
                socket.default_value = value
            label = "math-" + operation.lower() + "-" + suffix
            program = compositor_graph.extract(scene)
            scene.render.filepath = str(output / "native.exr")
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(scene.render.filepath, check_existing=False)
            width, height = image.size
            actual = np.asarray(image.pixels[:], dtype=np.float32).reshape(height, width, 4)
            if not np.isfinite(actual).all():
                assert program["status"] == "unsupported", (operation, values, program)
                undefined.append({"case": label, "operation": operation, "operands": values,
                                  "reason": "Native Blender produces non-finite pixels; translation explicitly refused",
                                  "diagnostics": program["diagnostics"]})
                bpy.data.images.remove(image)
                continue
            assert program["status"] == "extracted", program
            assert program["ops"][-1]["properties"]["use_clamp"] == use_clamp
            assert np.all(actual[..., 3] == 1), "Scalar compositor output must be opaque"
            data = {"case": label, "operation": operation, "operands": values,
                    "useClamp": use_clamp,
                    "blenderVersion": bpy.app.version_string, "blenderHash": bpy.app.build_hash.decode(),
                    "device": "CPU", "width": width, "height": height,
                    "input": np.tile([0.25, 0.5, 0.75, 1], width * height).tolist(),
                    "expected": actual.ravel().tolist(), "program": program}
            (output / (label + ".json")).write_text(json.dumps(data, separators=(",", ":")))
            rows.append({"case": label, "operation": operation})
            bpy.data.images.remove(image)
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    (output / "undefined.json").write_text(json.dumps(undefined, indent=2))
    print("BLENDLINK_COMPOSITOR_MATH_CHECK_PASSED " + json.dumps({"operations": len(operations), "cases": len(rows), "undefinedRefusals": len(undefined)}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_MATH_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-compositor-math-") as directory:
        main(Path(directory))
