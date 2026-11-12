# SPDX-License-Identifier: GPL-3.0-or-later
"""Native RGB/HSV/HSL channel references, including the legacy RGBA aliases."""
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
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    import _cycles
    _cycles.set_device_override("CPU")
    scene.render.resolution_x = scene.render.resolution_y = 8
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    device = os.environ.get("BLENDLINK_COMPOSITOR_CHANNEL_DEVICE", "CPU")
    if hasattr(scene.render, "compositor_device"):
        scene.render.compositor_device = device
        scene.render.compositor_precision = "FULL"
    elif device != "CPU":
        raise AssertionError("This Blender has no selectable offline GPU compositor")
    scene.render.dither_intensity = 0
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    modern = hasattr(scene, "compositing_node_group")
    if modern:
        tree = bpy.data.node_groups.new("Native Color Channels", "CompositorNodeTree")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
    else:
        scene.use_nodes = True
        tree = scene.node_tree
    pixels = np.random.default_rng(71238).uniform(-0.2, 2.2, (8, 8, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, 0.125, 0.5, 1], np.float32), (8, 8))
    pixels[..., :3] *= pixels[..., 3, None]
    pixels[0, :5] = [[0, 0, 0, 0], [1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5],
                     [2.2, 0.5, 0.2, 1], [-0.2, 0.01, 0.8, 0.125]]
    image = bpy.data.images.new("Premultiplied channel input", width=8, height=8, alpha=True, float_buffer=True)
    image.alpha_mode = "PREMUL"
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(pixels.ravel())
    constants = [(0.2, 0.4, 0.8, 0.3), (-0.2, 1.4, 2, 0.125),
                 (1.2, 0.8, 1, 0), (0.5, 0, -0.5, 1)]
    cases = []
    for mode in ("RGB", "HSV", "HSL"):
        cases += [("separate-" + mode.lower() + "-" + channel.lower(), "separate", mode, channel, None)
                  for channel in ("Red", "Green", "Blue", "Alpha")]
        cases += [("roundtrip-" + mode.lower(), "roundtrip", mode, None, None)]
        cases += [("combine-" + mode.lower() + "-" + str(index), "combine", mode, None, values)
                  for index, values in enumerate(constants)]
        cases += [("spatial-combine-" + mode.lower() + "-" + str(index), "combine-spatial", mode, None, values)
                  for index, values in enumerate(constants)]
    if not modern:
        cases += [("legacy-separate-" + channel.lower(), "legacy-separate", "RGB", channel, None)
                  for channel in ("R", "G", "B", "A")]
        cases += [("legacy-roundtrip", "legacy-roundtrip", "RGB", None, None),
                  ("legacy-combine", "legacy-combine", "RGB", None, constants[1])]
    rows = []
    prefix = "blender-" + str(bpy.app.version[0]) + "-" + str(bpy.app.version[1]) + "-" + device.lower()
    for label, kind, mode, channel, values in cases:
        tree.nodes.clear()
        sink = tree.nodes.new("NodeGroupOutput" if modern else "CompositorNodeComposite")
        source = tree.nodes.new("CompositorNodeRLayers")
        if "separate" in kind or "roundtrip" in kind:
            separate = tree.nodes.new("CompositorNodeSepRGBA" if kind.startswith("legacy") else "CompositorNodeSeparateColor")
            if hasattr(separate, "mode"):
                separate.mode = mode
            tree.links.new(source.outputs["Image"], separate.inputs["Image"])
            if "separate" in kind:
                tree.links.new(separate.outputs[channel], sink.inputs[0])
        if "combine" in kind or "roundtrip" in kind:
            combine = tree.nodes.new("CompositorNodeCombRGBA" if kind.startswith("legacy") else "CompositorNodeCombineColor")
            if hasattr(combine, "mode"):
                combine.mode = mode
            if kind == "combine-spatial":
                alpha = tree.nodes.new("CompositorNodeSeparateColor")
                tree.links.new(source.outputs["Image"], alpha.inputs["Image"])
            for index, incoming in enumerate(combine.inputs):
                if "roundtrip" in kind:
                    tree.links.new(separate.outputs[index], incoming)
                elif kind == "combine-spatial" and index == 3:
                    tree.links.new(alpha.outputs["Alpha"], incoming)
                else:
                    value = tree.nodes.new("ShaderNodeValue" if modern else "CompositorNodeValue")
                    value.outputs[0].default_value = values[index]
                    tree.links.new(value.outputs[0], incoming)
            tree.links.new(combine.outputs[0], sink.inputs[0])
        program = compositor_graph.extract(scene)
        assert program["status"] == "extracted", program
        source_image = tree.nodes.new("CompositorNodeImage")
        source_image.image = image
        for link in list(source.outputs["Image"].links):
            tree.links.new(source_image.outputs["Image"], link.to_socket)
        scene.render.filepath = str(output / (prefix + "-" + label + ".exr"))
        bpy.ops.render.render(write_still=True)
        result = bpy.data.images.load(scene.render.filepath, check_existing=False)
        result.alpha_mode = "PREMUL"
        expected = np.asarray(result.pixels[:], np.float32).reshape(8, 8, 4)
        assert np.isfinite(expected).all(), (label, "Native color channels produced a non-finite value")
        if "roundtrip" in kind:
            assert np.array_equal(expected[..., 3], pixels[..., 3]), "Recombined alpha changed"
        if "separate" in kind and channel in ("Alpha", "A"):
            assert np.array_equal(expected[..., 0], pixels[..., 3]), "Separate Alpha changed coverage"
            assert np.all(expected[..., 3] == 1), "Scalar-to-color conversion did not set alpha one"
        case = prefix + "-" + label
        data = {"case": case, "blenderVersion": bpy.app.version_string,
                "blenderHash": bpy.app.build_hash.decode(), "compositorDevice": device,
                "width": 8, "height": 8, "colorSpace": "scene-linear", "exactAlpha": True,
                "input": pixels.ravel().tolist(), "expected": expected.ravel().tolist(), "program": program}
        (output / (case + ".json")).write_text(json.dumps(data, separators=(",", ":")))
        rows.append({"case": case})
        bpy.data.images.remove(result)
    for mode in ("YUV", "YCC"):
        tree.nodes.clear()
        sink = tree.nodes.new("NodeGroupOutput" if modern else "CompositorNodeComposite")
        for kind in ("CompositorNodeSeparateColor", "CompositorNodeCombineColor"):
            node = tree.nodes.new(kind)
            node.mode = mode
            tree.links.new(node.outputs[0], sink.inputs[0])
            refused = compositor_graph.extract(scene)
            assert refused["status"] == "unsupported" and refused["diagnostics"][-1]["code"] == "unsupported-color-channel-mode", refused
            tree.nodes.remove(node)
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    print("BLENDLINK_COLOR_CHANNELS_CHECK_PASSED " + json.dumps({"blender": bpy.app.version_string,
                                                               "device": device, "cases": len(rows)}))


destination = os.environ.get("BLENDLINK_COLOR_CHANNEL_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-color-channels-") as directory:
        main(Path(directory))
