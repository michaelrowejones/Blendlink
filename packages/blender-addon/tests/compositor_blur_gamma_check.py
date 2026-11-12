# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual legacy Blur gamma transfer, alpha and CPU/GPU identity semantics."""
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
    pixels = np.random.default_rng(76131).uniform(-.4, 2, (7, 13, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (7, 13))
    oracle = NativeCompositorReference(output, pixels=pixels.copy(),
        device=os.environ.get("BLENDLINK_COMPOSITOR_BLUR_GAMMA_DEVICE", "CPU"), name="Native Blur gamma")
    tree = oracle.tree
    probe = tree.nodes.new("CompositorNodeBlur")
    if not hasattr(probe, "use_gamma_correction"):
        (output / "not-applicable.json").write_text(json.dumps({"blender": bpy.app.version_string,
            "hash": bpy.app.build_hash.decode(), "device": oracle.device,
            "reason": "This native Blur schema has no legacy gamma correction property"}, indent=2))
        print("BLENDLINK_COMPOSITOR_BLUR_GAMMA_NOT_APPLICABLE")
        oracle.finish("BLENDLINK_COMPOSITOR_BLUR_GAMMA_CHECK_PASSED")
        return

    def graph(kind, radius=(2, 3), multiplier=1, constant=None, gamma=True):
        sink, source = oracle.reset()
        node = tree.nodes.new("CompositorNodeBlur")
        node.filter_type = kind
        node.size_x, node.size_y = radius
        node.use_gamma_correction = gamma
        tree.links.new(oracle.value(multiplier), node.inputs["Size"])
        tree.links.new(oracle.color(constant) if constant is not None else source.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source

    def save(label, source, state=False):
        oracle.save(label, source)
        path = output / (oracle.rows[-1]["case"] + ".json")
        document = json.loads(path.read_text())
        document.update(assertTextureCleanup=True, assertMrtState=state)
        if state or ("-random-" in label and label.endswith(("-0-0", "-2-3", "-128-0"))):
            document["assertShaderCost"] = {"maxPasses": 4, "maxFragmentBytes": 12000}
        for operation in document["program"]["ops"]:
            if operation["kind"] == "blur":
                assert operation["properties"]["blur_gamma_model"] == (
                    "legacy-cpu-square-v1" if oracle.device == "CPU" else "legacy-gpu-square-v1")
        path.write_text(json.dumps(document, separators=(",", ":")))

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    save("blur-gamma-control", source)
    impulse = np.zeros_like(pixels)
    impulse[0, 0] = [2, -.25, .75, 1]
    impulse[0, -1] = [-.25, 1.5, .125, .5]
    impulse[-1, 0] = [.25, .5, 2, .25]
    impulse[-1, -1] = [1, 1, 1, -.25]
    impulse[3, 6] = [4, 2, .5, 1.5]
    boundary = pixels.copy()
    boundary[..., 3] = np.resize(np.asarray([-1, -.5, -.0002, -1e-7, -0., 0, 1e-7, .0002,
                                             .125, .5, 1, 1.5, 2], np.float32), (7, 13))
    positive = boundary[..., 3] > 0
    boundary[..., :3][positive] *= np.minimum(boundary[..., 3][positive], 1)[:, None]
    kinds = ("FLAT", "TENT", "QUAD", "CUBIC", "GAUSS", "CATROM", "MITCH")
    for pattern, active in (("random", pixels), ("impulse", impulse), ("alpha-boundary", boundary)):
        oracle.pixels[:] = active
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        for kind in kinds:
            for radius in ((0, 0), (0, 2), (2, 0), (2, 3), (7, 5), (128, 0)):
                node, source = graph(kind, radius)
                save("blur-gamma-" + pattern + "-" + kind.lower() + "-" + str(radius[0]) + "-" + str(radius[1]), source)
    oracle.pixels[:] = pixels
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    for kind in kinds:
        for index, color in enumerate(((.25, -.5, 1.5, .35), (-1, 2, -3, 0), (-1, 2, -3, -.5), (.25, .5, .75, 1.5))):
            for radius in ((0, 0), (2, 3)):
                node, source = graph(kind, radius, constant=color)
                save("blur-gamma-" + kind.lower() + "-constant-" + str(index) + "-" + str(radius[0]) + "-" + str(radius[1]), source)
    for kind in ("GAUSS", "MITCH"):
        for multiplier in (-.5, .25, 1.5, 2):
            node, source = graph(kind, multiplier=multiplier)
            save("blur-gamma-" + kind.lower() + "-multiplier-" + str(multiplier), source)
        node, source = graph(kind)
        exposure = tree.nodes.new("CompositorNodeExposure")
        exposure.inputs["Exposure"].default_value = 1.25
        tree.links.new(source.outputs["Image"], exposure.inputs["Image"])
        tree.links.new(exposure.outputs[0], node.inputs["Image"])
        save("blur-gamma-" + kind.lower() + "-after-exposure", source, state=True)
    oracle.finish("BLENDLINK_COMPOSITOR_BLUR_GAMMA_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_GAMMA_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-blur-gamma-") as directory:
        main(Path(directory))
