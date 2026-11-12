# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native Hue Correct curves, devices, HDR colors, factors and alpha."""
import colorsys
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get("BLENDLINK_COMPOSITOR_HUE_CORRECT_DEVICE", "CPU"), name="Native Hue Correct")
    tree = oracle.tree
    for row, (saturation, value) in enumerate(((1, 1), (0.4, 2), (1, 0.25), (0, 0.5))):
        for column in range(8):
            oracle.pixels[row, column, :3] = colorsys.hsv_to_rgb(column / 8, saturation, value)
    # Include negative hue sectors, nonzero endpoint neighborhoods, zero,
    # grayscale and native HDR/negative saturation handling independently.
    oracle.pixels[4, :, :3] = [[1, -0.5, 0], [0, 1, -0.5], [-0.5, 0, 1], [-1, -2, -3],
        [-1, -1, -1], [1, 0, 0.00001], [1, 0.00001, 0], [0, 0, 0]]
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())

    def graph(style, factor=1, constant=None):
        sink, source = oracle.reset()
        node = tree.nodes.new("CompositorNodeHueCorrect")
        mapping = node.mapping
        mapping.initialize()
        if style != "neutral":
            active = {"hue": (0,), "saturation": (1,), "value": (2,)}.get(style, (0, 1, 2))
            for channel in active:
                for index, point in enumerate(mapping.curves[channel].points):
                    point.location.y = (0.5 + 0.36 * np.sin(index * 1.7 + channel * 0.8))
                    if style == "vector":
                        point.handle_type = "VECTOR"
                    if style in ("clip-on", "clip-off"):
                        point.location.y = (-0.5, 1.8, -0.2, 1.2)[index % 4]
            if style in ("clip-on", "clip-off"):
                mapping.use_clip = style == "clip-on"
                mapping.clip_min_y, mapping.clip_max_y = 0.15, 0.85
            if style == "range":
                mapping.clip_min_x, mapping.clip_max_x = -0.25, 1.25
        mapping.update()
        tree.links.new(source.outputs["Image"] if constant is None else oracle.color(constant), node.inputs["Image"])
        incoming = oracle.separate(source.outputs["Image"]).outputs["Red"] if factor == "spatial" else oracle.value(factor)
        tree.links.new(incoming, node.inputs["Fac"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source

    def save(label, node, source):
        unused = tree.nodes.new("CompositorNodeImage")
        unused.image = oracle.image
        before = [(tuple(point.location), point.handle_type) for curve in node.mapping.curves for point in curve.points]
        clip = (node.mapping.use_clip, node.mapping.clip_min_y, node.mapping.clip_max_y)
        groups, users = len(bpy.data.node_groups), oracle.image.users
        oracle.save(label, source)
        captured = json.loads((output / (oracle.rows[-1]["case"] + ".json")).read_text())
        for operation in captured["program"]["ops"]:
            if operation["kind"] != "hue-correct":
                continue
            properties = operation["properties"]
            opengl_gpu = oracle.device == "GPU" and properties["native_gpu_backend"] == "OPENGL"
            assert properties.get("hue_curve_sampling_model") == (
                "opengl-normalized-f32-v1" if opengl_gpu else None), properties
        assert groups == len(bpy.data.node_groups), "Hue Correct extraction leaked a copied tree"
        assert users + 1 == oracle.image.users, "Only the oracle input node may add an image user"
        assert before == [(tuple(point.location), point.handle_type) for curve in node.mapping.curves for point in curve.points]
        assert clip == (node.mapping.use_clip, node.mapping.clip_min_y, node.mapping.clip_max_y)

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    oracle.save("hue-correct-control", source, exact_alpha=True)
    for extend in ("EXTRAPOLATED", "HORIZONTAL"):
        for tone in ("STANDARD", "FILMLIKE"):
            node, source = graph("combined", 0.73)
            node.mapping.extend = extend
            node.mapping.tone = tone
            node.mapping.update()
            save("hue-correct-menus-" + extend.lower() + "-" + tone.lower(), node, source)
    for style in ("neutral", "hue", "saturation", "value", "combined", "vector", "clip-on", "clip-off", "range"):
        for factor in (-0.5, 0, 0.25, 1, 1.5, "spatial"):
            node, source = graph(style, factor)
            save("hue-correct-" + style + "-" + str(factor), node, source)
        for index, color in enumerate(((0.25, 0.5, 0.75, 0.35), (-0.5, 1.5, 0.25, -0.5), (1, 0, 0, 1.5))):
            node, source = graph(style, 0.35, color)
            save("hue-correct-" + style + "-constant-" + str(index), node, source)
            node, source = graph(style, "spatial", color)
            save("hue-correct-" + style + "-constant-image-spatial-factor-" + str(index), node, source)
    oracle.finish("BLENDLINK_COMPOSITOR_HUE_CORRECT_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_HUE_CORRECT_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-hue-correct-") as directory:
        main(Path(directory))
