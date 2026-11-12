# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Shared native oracle helper imported by compositor regression suites.
"""Small native image oracle shared by compositor family regression fixtures."""
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_graph


class NativeCompositorReference:
    def __init__(self, output, *, device="CPU", name="Native Compositor", pixels=None):
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.device = device
        self.rows = []
        bpy.ops.wm.read_factory_settings(use_empty=False)
        self.scene = scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 1
        import _cycles
        _cycles.set_device_override("CPU")
        scene.render.resolution_x = scene.render.resolution_y = 8
        scene.render.resolution_percentage = 100
        scene.render.use_compositing = True
        scene.render.use_sequencer = False
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
        self.modern = hasattr(scene, "compositing_node_group")
        if self.modern:
            self.tree = bpy.data.node_groups.new(name, "CompositorNodeTree")
            self.tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            scene.compositing_node_group = self.tree
        else:
            scene.use_nodes = True
            self.tree = scene.node_tree
        if pixels is None:
            pixels = np.random.default_rng(71241).uniform(-0.4, 2.0, (8, 8, 4)).astype(np.float32)
            pixels[..., 3] = np.resize(np.asarray([0, 0.125, 0.5, 1, 1.5, -0.5, 0.25, 0.75], np.float32), (8, 8))
            pixels[0, :, :3] = [[0, 0, 0], [0.25, 0.5, 0.75], [1, 1, 1], [2, -0.25, 0.75],
                                [-0.25, 0, 0.5], [0, 0, 0], [0.125, 0.25, 0.5], [0.75, 0.5, 0.25]]
        self.pixels = np.asarray(pixels, np.float32)
        self.height, self.width = self.pixels.shape[:2]
        scene.render.resolution_x, scene.render.resolution_y = self.width, self.height
        self.image = bpy.data.images.new(name + " float input", width=self.width, height=self.height, alpha=True, float_buffer=True)
        self.image.alpha_mode = "PREMUL"
        self.image.colorspace_settings.name = "Linear Rec.709"
        self.image.pixels.foreach_set(self.pixels.ravel())
        self.prefix = "blender-" + str(bpy.app.version[0]) + "-" + str(bpy.app.version[1]) + "-" + device.lower()

    def reset(self):
        self.tree.nodes.clear()
        sink = self.tree.nodes.new("NodeGroupOutput" if self.modern else "CompositorNodeComposite")
        source = self.tree.nodes.new("CompositorNodeRLayers")
        return sink, source

    def value(self, number):
        node = self.tree.nodes.new("ShaderNodeValue" if self.modern else "CompositorNodeValue")
        node.outputs[0].default_value = number
        return node.outputs[0]

    def color(self, channels):
        node = self.tree.nodes.new("CompositorNodeCombineColor")
        for socket, number in zip(node.inputs, channels):
            self.tree.links.new(self.value(number), socket)
        return node.outputs[0]

    def separate(self, source):
        node = self.tree.nodes.new("CompositorNodeSeparateColor")
        self.tree.links.new(source, node.inputs["Image"])
        return node

    def save(self, label, source, *, exact_alpha=False):
        program = compositor_graph.extract(self.scene)
        assert program["status"] == "extracted", program
        replacement = self.tree.nodes.new("CompositorNodeImage")
        replacement.image = self.image
        for link in list(source.outputs["Image"].links):
            self.tree.links.new(replacement.outputs["Image"], link.to_socket)
        self.scene.render.filepath = str(self.output / "native.exr")
        bpy.ops.render.render(write_still=True)
        result = bpy.data.images.load(self.scene.render.filepath, check_existing=False)
        result.alpha_mode = "PREMUL"
        expected = np.asarray(result.pixels[:], np.float32).reshape(self.height, self.width, 4)
        assert np.isfinite(expected).all(), (label, "Native Blender produced non-finite pixels")
        case = self.prefix + "-" + label
        data = {"case": case, "blenderVersion": bpy.app.version_string,
                "blenderHash": bpy.app.build_hash.decode(), "compositorDevice": self.device,
                "width": self.width, "height": self.height, "colorSpace": "scene-linear", "exactAlpha": exact_alpha,
                "input": self.pixels.ravel().tolist(), "expected": expected.ravel().tolist(), "program": program}
        (self.output / (case + ".json")).write_text(json.dumps(data, separators=(",", ":")))
        self.rows.append({"case": case})
        bpy.data.images.remove(result)

    def finish(self, marker):
        (self.output / "index.json").write_text(json.dumps(self.rows, indent=2))
        print(marker + " " + json.dumps({"blender": bpy.app.version_string,
                                          "device": self.device, "cases": len(self.rows)}))
