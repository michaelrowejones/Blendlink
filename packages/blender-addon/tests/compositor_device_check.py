# SPDX-License-Identifier: GPL-3.0-or-later
"""Matched CPU/GPU execution and constant-folding canaries with float32 EXRs."""
import json
import os
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    enum = bpy.context.scene.render.bl_rna.properties.get("compositor_device")
    devices = ["CPU", "GPU"] if enum and "GPU" in [item.identifier for item in enum.enum_items] else ["CPU"]
    rows, expected = [], {}
    for device in devices:
        oracle = NativeCompositorReference(output, device=device, name="Native Device Canaries")
        tree = oracle.tree
        oracle.pixels[0, :, 0] = [-0.1, 0, 0.25, 0.4, 0.43, 0.75, 1, 1.1]
        oracle.pixels[1, :, 0] = [-2.5, -1.5, -0.5, -0.49999, 0, 0.5, 1.5, 2.5]
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())

        def save(label, source):
            oracle.save("device-" + label, source, exact_alpha=label == "control")
            row = oracle.rows[-1]
            payload = json.loads((oracle.output / (row["case"] + ".json")).read_text())
            payload["nativePrecision"] = {"compositor": "FULL", "fileFormat": "OPEN_EXR", "colorDepth": 32,
                "imageFloatBuffer": bool(oracle.image.is_float), "viewTransform": "Raw",
                "requestedDevice": device, "selectedDevice": getattr(oracle.scene.render, "compositor_device", "CPU")}
            (oracle.output / (row["case"] + ".json")).write_text(json.dumps(payload, separators=(",", ":")))
            pixels = np.asarray(payload["expected"], np.float32).reshape(8, 8, 4)
            expected[(device, label)] = pixels
            if label == "control":
                assert np.array_equal(pixels, oracle.pixels), "Device control lost float32 HDR/negative/alpha precision"
            return pixels

        sink, source = oracle.reset()
        tree.links.new(source.outputs["Image"], sink.inputs[0])
        save("control", source)
        for constant in (False, True):
            sink, source = oracle.reset()
            node = tree.nodes.new("ShaderNodeValToRGB" if oracle.modern else "CompositorNodeValToRGB")
            ramp = node.color_ramp
            ramp.elements[0].color = (0.13, 0.23, 0.37, 0.43)
            ramp.elements[1].color = (0.8, 0.7, 0.9, 0.6)
            ramp.elements.new(0.4).color = (0.5, 0.3, 0.6, 0.7)
            tree.links.new(oracle.value(0.4) if constant else oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs["Fac"])
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("ramp-" + ("constant" if constant else "spatial"), source)
        for constant in (False, True):
            sink, source = oracle.reset()
            node = tree.nodes.new("CompositorNodeCurveRGB")
            for index, curve in enumerate(node.mapping.curves):
                curve.points.new(0.37 if index != 3 else 0.52, 0.71 - index * 0.11)
            node.mapping.update()
            tree.links.new(oracle.color((0.25, 0.5, 0.75, 0.35)) if constant else source.outputs["Image"], node.inputs["Image"])
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("curves-" + ("constant" if constant else "spatial"), source)
        for constant in (False, True):
            sink, source = oracle.reset()
            node = tree.nodes.new("ShaderNodeMath" if oracle.modern else "CompositorNodeMath")
            node.operation = "ROUND"
            tree.links.new(oracle.value(-0.5) if constant else oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs[0])
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("round-" + ("constant" if constant else "spatial"), source)
        if device == "CPU" or oracle.modern:
            sink, source = oracle.reset()
            node = tree.nodes.new("ShaderNodeMath" if oracle.modern else "CompositorNodeMath")
            node.operation = "ARCTAN2"
            tree.links.new(oracle.value(0), node.inputs[0])
            tree.links.new(oracle.value(0), node.inputs[1])
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("atan2-constant-origin", source)
        if oracle.modern:
            sink, source = oracle.reset()
            node = tree.nodes.new("ShaderNodeMath")
            node.operation = "LOGARITHM"
            tree.links.new(oracle.value(0.5), node.inputs[0])
            tree.links.new(oracle.value(1), node.inputs[1])
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("log-constant-base-one", source)
        rows.extend(oracle.rows)
    differences = {}
    if "GPU" in devices:
        for label in ("control", "ramp-constant", "ramp-spatial", "curves-constant", "curves-spatial", "round-constant", "round-spatial"):
            differences[label] = float(np.max(np.abs(expected[("CPU", label)] - expected[("GPU", label)])))
        assert differences["control"] == 0, "Matched controls do not share the same input/target precision"
        assert differences["ramp-spatial"] > 2e-5, "GPU request silently executed the CPU ramp path"
        if bpy.app.version < (4, 5, 0):
            assert differences["curves-constant"] > 2e-5, "Legacy GPU constants unexpectedly used the CPU curve order"
        else:
            assert differences["curves-constant"] < 2e-5, "Modern GPU constant folding no longer uses the verified CPU curve order"
    report = {"blenderVersion": bpy.app.version_string, "devices": devices, "cases": len(rows),
              "gpuExecution": "proved" if "GPU" in devices else "unavailable",
              "matchedCpuGpuDifferences": differences}
    (Path(output) / "index.json").write_text(json.dumps(rows, indent=2))
    (Path(output) / "device-report.json").write_text(json.dumps(report, indent=2))
    print("BLENDLINK_COMPOSITOR_DEVICE_CHECK_PASSED " + json.dumps(report))


destination = os.environ.get("BLENDLINK_COMPOSITOR_DEVICE_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-device-") as directory:
        main(Path(directory))
