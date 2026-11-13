# SPDX-License-Identifier: GPL-3.0-or-later
"""Native pixel boundaries when Blur feeds Posterize and Alpha Over."""
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    pixels = np.random.default_rng(78331).uniform(-.4, 2, (7, 13, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (7, 13))
    oracle = NativeCompositorReference(output, pixels=pixels.copy(),
        device=os.environ.get("BLENDLINK_COMPOSITOR_BLUR_INTEROP_DEVICE", "CPU"), name="Native Blur interoperability")
    tree = oracle.tree
    labels = {"TENT": "Tent", "GAUSS": "Gaussian", "MITCH": "Mitch"}

    def graph(kind, radius, consumer):
        sink, source = oracle.reset()
        blur = tree.nodes.new("CompositorNodeBlur")
        if oracle.modern:
            blur.inputs["Type"].default_value = labels[kind]
            blur.inputs["Size"].default_value = radius
        else:
            blur.filter_type = kind
            blur.size_x, blur.size_y = radius
        tree.links.new(source.outputs["Image"], blur.inputs["Image"])
        result = blur.outputs[0]
        if consumer == "posterize":
            node = tree.nodes.new("CompositorNodePosterize")
            node.inputs["Steps"].default_value = 2
            tree.links.new(result, node.inputs["Image"])
            result = node.outputs[0]
        elif consumer.startswith("over-"):
            node = tree.nodes.new("CompositorNodeAlphaOver")
            straight = consumer == "over-straight"
            if oracle.modern:
                node.inputs["Straight Alpha"].default_value = straight
                node.inputs["Type"].default_value = "Over"
            else:
                node.use_premultiply, node.premul = straight, 0
            node.inputs["Fac"].default_value = 1
            tree.links.new(oracle.color((.1, .2, .4, .8)), node.inputs["Background"] if oracle.modern else node.inputs["Image"])
            tree.links.new(result, node.inputs["Foreground"] if oracle.modern else node.inputs["Image_001"])
            result = node.outputs[0]
        tree.links.new(result, sink.inputs[0])
        return source

    def save(label, source):
        oracle.save(label, source)
        path = output / (oracle.rows[-1]["case"] + ".json")
        document = json.loads(path.read_text())
        for operation in document["program"]["ops"]:
            if operation["kind"] == "blur":
                assert operation["properties"]["blur_output_sampling_model"] == "native-texel-v1", operation
        document.update(assertTextureCleanup=True, assertMrtState=True,
                        assertShaderCost={"maxPasses": 3, "maxFragmentBytes": 12000})
        path.write_text(json.dumps(document, separators=(",", ":")))

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    save("blur-interop-control", source)
    checker = pixels.copy()
    pattern = (np.indices(pixels.shape[:2]).sum(axis=0) % 2).astype(np.float32)
    checker[..., :3] = np.stack((pattern, 1 - pattern, pattern * .5), axis=-1)
    checker[..., 3] = np.where(pattern > 0, np.float32(.5), np.float32(-.5))
    impulse = np.zeros_like(pixels)
    impulse[0, 0] = [2, -.25, .75, 1]
    impulse[0, -1] = [-.25, 1.5, .125, .5]
    impulse[-1, 0] = [.25, .5, 2, .25]
    impulse[-1, -1] = [1, 1, 1, -.25]
    impulse[3, 6] = [4, 2, .5, 1.5]
    for pattern, active in (("random", pixels), ("checker", checker), ("impulse", impulse)):
        oracle.pixels[:] = active
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        source = graph("TENT", (2, 3), "blur")
        save("blur-interop-" + pattern + "-blur-control", source)
        for kind in labels:
            for radius in ((2, 0), (0, 2), (2, 3)):
                for consumer in ("posterize", "over-premultiplied", "over-straight"):
                    source = graph(kind, radius, consumer)
                    save("blur-interop-" + pattern + "-" + kind.lower() + "-" + str(radius[0]) + "-" + str(radius[1]) + "-" + consumer, source)
    oracle.finish("BLENDLINK_COMPOSITOR_BLUR_INTEROP_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_INTEROP_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-blur-interop-") as directory:
        main(Path(directory))
