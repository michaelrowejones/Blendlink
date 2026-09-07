# SPDX-License-Identifier: GPL-3.0-or-later
import sys, pathlib, json
import bpy
import numpy as np

repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / "artifacts/verification-look"
sys.path.insert(0, str(root.parents[1] / "packages/blendlink/blender"))
import source_presentation as source

scene = bpy.context.scene
rng = np.random.default_rng(4883)
colors = np.concatenate(
    [
        rng.uniform(0, 4, (1024, 3)),
        np.exp2(rng.uniform(-12, 12, (1024, 3))),
        rng.uniform(-0.1, 1, (1024, 3)),
        np.repeat(np.exp2(np.linspace(-20, 16, 1024))[:, None], 3, axis=1),
    ]
).astype(np.float32)
out = root / "browser"
out.mkdir(exist_ok=True)
for label, view, look in [
    ("agx", "AgX", "None"),
    ("filmic", "Filmic", "Medium High Contrast"),
    ("standard", "Standard", "None"),
]:
    scene.view_settings.view_transform = view
    scene.view_settings.look = look
    asset = source.export_source_presentation(scene, out / label)
    cfg, _ = source.config_from_install()
    expected = colors.copy()
    source.composed_processor(scene, cfg).getDefaultCPUProcessor().applyRGB(expected)
    (out / (label + "-pixels.json")).write_text(
        json.dumps(
            {"input": colors.ravel().tolist(), "expected": expected.ravel().tolist()}
        )
    )
print("DISPLAY_CASES_READY")
