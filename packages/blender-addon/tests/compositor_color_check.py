# SPDX-License-Identifier: GPL-3.0-or-later
"""Native color controls: Exposure, Hue/Saturation, Color Correction, Posterize."""
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get("BLENDLINK_COMPOSITOR_COLOR_DEVICE", "CPU"), name="Native Color Controls")
    tree = oracle.tree
    # Exercise the four Color Correction transition boundaries and HDR/negative
    # luminance, in addition to the oracle's independent seeded RGBA pixels.
    for index, level in enumerate((0.09999, 0.1, 0.10001, 0.29999, 0.3, 0.6, 0.7, 0.8)):
        oracle.pixels[1, index, :3] = level
    for row, levels in ((2, (0.125, 0.25, 0.5, 0.75)), (3, (0.1, 0.3, 0.6, 0.8))):
        for index, level in enumerate(levels):
            for side, direction in enumerate((-np.inf, np.inf)):
                oracle.pixels[row, index * 2 + side, :3] = np.nextafter(np.float32(level), np.float32(direction))
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())

    def graph(node_type, *, constant=False):
        sink, source = oracle.reset()
        node = tree.nodes.new(node_type)
        tree.links.new(oracle.color((0.25, 0.5, 0.75, 0.35)) if constant else source.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source

    def setting(node, name, value, source=None):
        socket = node.inputs.get(name)
        if socket is not None:
            if isinstance(value, bool):
                socket.default_value = value
            else:
                incoming = oracle.separate(source.outputs["Image"]).outputs["Red"] if value == "spatial" else oracle.value(value)
                tree.links.new(incoming, socket)
        else:
            attribute = name.lower().replace(" ", "_").replace("offset", "lift")
            if name.startswith("Apply On "):
                attribute = name[9:].lower()
            setattr(node, attribute, value)

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    oracle.save("color-control", source, exact_alpha=True)
    for exposure in (-8, -2.3, -1, 0, 0.75, 2.5, 8, "spatial"):
        node, source = graph("CompositorNodeExposure")
        setting(node, "Exposure", exposure, source)
        oracle.save("exposure-" + str(exposure), source, exact_alpha=True)
    for steps in (-4, 0, 1, 2, 2.5, 4, 8, 1000, 1024, 2048, "spatial"):
        node, source = graph("CompositorNodePosterize")
        setting(node, "Steps", steps, source)
        oracle.save("posterize-" + str(steps), source, exact_alpha=True)
    hues = (-2.75, -0.5, 0, 0.25, 0.5, 0.75, 1, 1.5, 3.25, "spatial")
    parameters = [("Hue", item) for item in hues] + [(parameter, item)
        for parameter in ("Saturation", "Value") for item in (-0.5, 0, 0.35, 1.5, 2, "spatial")]
    parameters += [("Fac", item) for item in (-0.5, 0, 0.25, 1, 1.5, "spatial")]
    for parameter, value in parameters:
        node, source = graph("CompositorNodeHueSat")
        if parameter == "Fac":
            setting(node, "Hue", 0.75)
            setting(node, "Saturation", 1.4)
            setting(node, "Value", 0.65)
        setting(node, parameter, value, source)
        oracle.save("hue-saturation-" + parameter.lower() + "-" + str(value), source)
    for constant in (False, True):
        node, source = graph("CompositorNodeHueSat", constant=constant)
        for name, value in (("Hue", 3.25), ("Saturation", 1.6), ("Value", 0.7), ("Fac", 0.35)):
            setting(node, name, value)
        oracle.save("hue-saturation-combined-" + str(int(constant)), source)

    grades = {"Saturation": (0, 1.6), "Contrast": (0.5, 1.5), "Gamma": (0.6, 1.4),
              "Gain": (0.4, 1.5), "Offset": (-0.25, 0.2)}
    node, source = graph("CompositorNodeColorCorrection")
    oracle.save("color-correction-neutral", source, exact_alpha=True)
    for region in ("Master", "Shadows", "Midtones", "Highlights"):
        for parameter, values in grades.items():
            for value in values:
                node, source = graph("CompositorNodeColorCorrection")
                setting(node, region + " " + parameter, value)
                oracle.save("color-correction-" + region.lower() + "-" + parameter.lower() + "-" + str(value), source, exact_alpha=True)

    def combined(node):
        for name, value in (("Master Contrast", 1.2), ("Master Saturation", 0.8), ("Master Gamma", 1.1),
            ("Master Gain", 1.2), ("Master Offset", -0.15), ("Shadows Gain", 0.7),
            ("Shadows Offset", 0.1), ("Midtones Gamma", 1.4), ("Midtones Saturation", 1.3),
            ("Highlights Contrast", 0.65), ("Highlights Offset", 0.25)):
            setting(node, name, value)

    for mask in (-0.5, 0, 0.25, 1, 1.5, "spatial"):
        node, source = graph("CompositorNodeColorCorrection")
        combined(node)
        setting(node, "Mask", mask, source)
        oracle.save("color-correction-mask-" + str(mask), source, exact_alpha=True)
    for channels in ((False, True, True), (True, False, True), (True, True, False), (False, False, False)):
        node, source = graph("CompositorNodeColorCorrection")
        combined(node)
        for channel, enabled in zip(("Red", "Green", "Blue"), channels):
            setting(node, "Apply On " + channel, enabled)
        oracle.save("color-correction-channels-" + "".join(str(int(item)) for item in channels), source, exact_alpha=True)
    for start, end in ((0.2, 0.7), (0, 1), (0.5, 0.5), (0.65, 0.35), (0.25, 0.3)):
        node, source = graph("CompositorNodeColorCorrection")
        combined(node)
        setting(node, "Midtones Start", start)
        setting(node, "Midtones End", end)
        oracle.save("color-correction-range-" + str(start) + "-" + str(end), source, exact_alpha=True)
    if node.inputs.get("Master Saturation") is not None:
        for name in ("Master Saturation", "Master Contrast", "Master Gain", "Master Offset", "Midtones Start", "Midtones End",
                     "Shadows Offset", "Midtones Saturation", "Highlights Gain", "Apply On Red", "Apply On Green", "Apply On Blue"):
            node, source = graph("CompositorNodeColorCorrection")
            combined(node)
            tree.links.new(oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs[name])
            oracle.save("color-correction-spatial-" + name.lower().replace(" ", "-"), source, exact_alpha=True)
    node, source = graph("CompositorNodeColorCorrection", constant=True)
    combined(node)
    oracle.save("color-correction-constant", source, exact_alpha=True)
    for gamma in ((0, -1) if node.inputs.get("Master Gamma") is not None else (0,)):
        node, source = graph("CompositorNodeColorCorrection", constant=True)
        setting(node, "Master Gamma", gamma)
        oracle.save("color-correction-constant-gamma-" + str(gamma), source, exact_alpha=True)
    if node.inputs.get("Master Gamma") is not None:
        # Keep reciprocal grading finite and bounded while retaining exact zero
        # and negative bases. Near-zero positives amplify native CPU/GPU float
        # differences into large HDR absolute errors, independently of fallback.
        rgb = oracle.pixels[..., :3]
        oracle.pixels[..., :3] = np.where((rgb > 0) & (rgb < 0.125), np.float32(0.125), rgb)
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        node, source = graph("CompositorNodeColorCorrection")
        setting(node, "Master Gamma", -1)
        oracle.save("color-correction-zero-base-negative-gamma", source, exact_alpha=True)
    oracle.finish("BLENDLINK_COMPOSITOR_COLOR_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_COLOR_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-color-") as directory:
        main(Path(directory))
