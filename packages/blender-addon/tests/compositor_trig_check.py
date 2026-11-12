# SPDX-License-Identifier: GPL-3.0-or-later
"""Spatial native trig with independent libm controls and separate pole stress."""
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    output = Path(output)
    rows, stress, accuracy = [], [], []
    limit = 8192.0
    center = np.linspace(-8, 8, 64, dtype=np.float32)
    center[:8] = [0, -0.0, 0.5, -0.5, 1, -1, math.pi / 2, math.pi]
    wide = np.random.default_rng(71743).uniform(-limit, limit, 64).astype(np.float32)
    wide[:8] = [-limit, limit, -math.pi * 1024, math.pi * 1024, -math.pi, math.pi, 0, 1e-7]
    inverse = np.linspace(-1, 1, 64, dtype=np.float32)
    inverse[:10] = [-2, -1, np.nextafter(np.float32(-1), np.float32(0)), -0.5, 0, 0.5,
                   np.nextafter(np.float32(1), np.float32(0)), 1, 2, -0.0]
    pole = []
    for multiple in (-127, -3, -1, 1, 3, 127):
        value = np.float32(multiple * math.pi / 2)
        pole.extend([np.nextafter(value, np.float32(-np.inf)), value, np.nextafter(value, np.float32(np.inf))])
    pole = np.resize(np.asarray(pole, np.float32), 64)

    for device in ("CPU", "GPU"):
        oracle = NativeCompositorReference(output, device=device, name="Native Trig Accuracy")
        tree = oracle.tree
        for operation in ("SINE", "COSINE", "TANGENT", "ARCSINE", "ARCCOSINE"):
            arrays = [("endpoints", inverse)] if operation in {"ARCSINE", "ARCCOSINE"} else [
                ("central", center), ("reduction", wide)]
            if operation == "TANGENT":
                arrays = [(name, np.asarray([value if abs(math.tan(float(value))) <= 64 else np.float32(0.75)
                                             for value in values], np.float32)) for name, values in arrays]
                bounded = np.asarray([multiple * math.pi / 2 + side * math.atan(1 / 64)
                    for multiple in (-127, -3, -1, 1, 3, 127) for side in (-1, 1)], np.float32)
                arrays += [("bounded-pole-flanks", np.resize(bounded, 64)), ("pole-stress", pole)]
            for label, values in arrays:
                oracle.pixels[..., 0] = values.reshape(8, 8)
                oracle.image.pixels.foreach_set(oracle.pixels.ravel())
                sink, source = oracle.reset()
                node = tree.nodes.new("ShaderNodeMath" if oracle.modern else "CompositorNodeMath")
                node.operation = operation
                tree.links.new(oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs[0])
                tree.links.new(node.outputs[0], sink.inputs[0])
                oracle.save("trig-" + operation.lower() + "-" + label, source, exact_alpha=True)
                row = oracle.rows[-1]
                path = output / (row["case"] + ".json")
                payload = json.loads(path.read_text())
                function = {"SINE": math.sin, "COSINE": math.cos, "TANGENT": math.tan,
                            "ARCSINE": math.asin, "ARCCOSINE": math.acos}[operation]
                control = []
                for value in values:
                    value = float(value)
                    if operation in {"ARCSINE", "ARCCOSINE"} and abs(value) > 1:
                        result = 0 if not oracle.modern or device == "GPU" else function(max(-1, min(1, value)))
                    else:
                        result = function(value)
                    control.append(np.float32(result).item())
                actual = np.asarray(payload["expected"], np.float32).reshape(8, 8, 4)[..., 0].ravel()
                difference = float(np.max(np.abs(actual.astype(np.float64) - control)))
                payload["accuracyControl"] = {"source": "independent Python libm at exact float32 input, rounded to float32",
                    "expectedRed": control, "nativeMaximumAbsoluteError": difference,
                    "reductionLimit": limit, "tangentBoundedOutput": 64 if operation == "TANGENT" and label != "pole-stress" else None}
                path.write_text(json.dumps(payload, separators=(",", ":")))
                accuracy.append({"case": row["case"], "nativeControlError": difference})
                if label == "pole-stress":
                    oracle.rows.pop()
                    stress.append(row)
                    folder = output / "pole-stress"
                    folder.mkdir(exist_ok=True)
                    shutil.copy2(path, folder / path.name)
                elif device == "CPU":
                    assert difference < 2e-5, (row["case"], "Native CPU differs from independent libm", difference)
        rows.extend(oracle.rows)
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    (output / "pole-stress/index.json").write_text(json.dumps(stress, indent=2))
    (output / "accuracy-controls.json").write_text(json.dumps(accuracy, indent=2))
    print("BLENDLINK_COMPOSITOR_TRIG_CHECK_PASSED " + json.dumps({"blender": bpy.app.version_string,
        "cases": len(rows), "poleStressCases": len(stress), "reductionLimit": limit,
        "tangentBoundedOutput": 64}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_TRIG_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-trig-") as directory:
        main(Path(directory))
