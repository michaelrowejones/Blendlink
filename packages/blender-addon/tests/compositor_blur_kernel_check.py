# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native Gaussian impulse coefficients, checked bit-for-bit."""
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    pixels = np.zeros((4, 257, 4), np.float32)
    for row in range(4):
        pixels[row, 128] = [2 ** row, 1, .5, 1]
    oracle = NativeCompositorReference(output, pixels=pixels,
        device=os.environ.get("BLENDLINK_COMPOSITOR_BLUR_KERNEL_DEVICE", "CPU"), name="Native Gaussian kernel")
    for radius in (0, 1, 2, 2.25, 7, 128):
        sink, source = oracle.reset()
        node = oracle.tree.nodes.new("CompositorNodeBlur")
        if oracle.modern:
            node.inputs["Size"].default_value = (radius, 0)
        else:
            multiplier = .25 if radius == 2.25 else 1
            node.size_x, node.size_y = int(radius / multiplier), 0
            oracle.tree.links.new(oracle.value(multiplier), node.inputs["Size"])
        oracle.tree.links.new(source.outputs["Image"], node.inputs["Image"])
        oracle.tree.links.new(node.outputs[0], sink.inputs[0])
        oracle.save("blur-kernel-gaussian-" + str(radius), source)
        path = output / (oracle.rows[-1]["case"] + ".json")
        document = json.loads(path.read_text())
        operation = next(op for op in document["program"]["ops"] if op["kind"] == "blur")
        assert operation["properties"]["blur_gaussian_math"] == "native-c-f32-v1", operation
        weights = operation["properties"]["blur_weights"][0]
        expected = np.asarray(document["expected"], np.float32).reshape(4, 257, 4)
        # Each row has exactly one impulse. A source1 multiplication plus
        # zero additions exposes the native coefficient directly in row0.
        reconstructed = np.asarray([weights[abs(x - 128)] if abs(x - 128) < len(weights) else 0
                                    for x in range(257)], np.float32)
        native_words, model_words = expected[0, :, 0].view(np.uint32), reconstructed.view(np.uint32)
        mismatches = np.flatnonzero(native_words != model_words)
        assert len(mismatches) == 0, {
            "radius": radius, "device": oracle.device,
            "mismatches": len(mismatches), "first": [
                {"x": int(x), "nativeBits": int(native_words[x]), "modelBits": int(model_words[x])}
                for x in mismatches[:8]]}
        document.update(requireFloat32Bits=True, assertTextureCleanup=True, assertMrtState=True,
                        assertShaderCost={"maxPasses": 3, "maxFragmentBytes": 12000})
        path.write_text(json.dumps(document, separators=(",", ":")))
    module = compositor_graph._sibling("compositor_blur")
    with patch.object(module, "gaussian_float_math", side_effect=ValueError("Native scalar math unavailable")):
        refused = compositor_graph.extract(oracle.scene)
        assert refused["status"] == "unsupported" and any(
            diagnostic["code"] == "unsupported-blur-mode" and "Native scalar math unavailable" in diagnostic["message"]
            for diagnostic in refused["diagnostics"]), refused
    oracle.finish("BLENDLINK_COMPOSITOR_BLUR_KERNEL_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_KERNEL_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-blur-kernel-") as directory:
        main(Path(directory))
