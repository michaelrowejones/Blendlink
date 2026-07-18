# SPDX-License-Identifier: GPL-3.0-or-later
"""Validate overlay shader names, uniforms, and batch formats offscreen.

Requires Blender 5.2+ (gpu.init() in background mode).
Run:  blender --background --factory-startup --python tests/overlay_gpu_check.py --python-exit-code 1
"""
import importlib.util
import sys
from pathlib import Path

import bpy

if bpy.app.version < (5, 2, 0):
    print("SKIP: gpu.init() needs Blender 5.2+; overlay must be checked in the GUI")
    raise SystemExit(0)

import gpu  # noqa: E402

gpu.init()

ADDON_DIR = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "blendlink_addon", ADDON_DIR / "__init__.py",
    submodule_search_locations=[str(ADDON_DIR)],
)
module = importlib.util.module_from_spec(spec)
sys.modules["blendlink_addon"] = module
spec.loader.exec_module(module)
overlay = sys.modules["blendlink_addon.overlay"]

from mathutils import Matrix  # noqa: E402

offscreen = gpu.types.GPUOffScreen(64, 64)
with offscreen.bind():
    overlay._ensure_batches()
    uniform = overlay._batches["shader_uniform"]
    flat = overlay._batches["shader_flat"]
    with gpu.matrix.push_pop():
        gpu.matrix.multiply_matrix(Matrix.Identity(4))
        for shape in ("box", "sphere", "cross"):
            uniform.bind()
            uniform.uniform_float("viewportSize", (64.0, 64.0))
            uniform.uniform_float("lineWidth", 2.0)
            uniform.uniform_float("color", (0.3, 0.85, 0.45, 0.9))
            overlay._batches[shape].draw(uniform)
        flat.bind()
        flat.uniform_float("viewportSize", (64.0, 64.0))
        flat.uniform_float("lineWidth", 2.0)
        overlay._batches["axes"].draw(flat)
offscreen.free()
print("BLENDLINK_OVERLAY_GPU_OK")
