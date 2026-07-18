# SPDX-License-Identifier: GPL-3.0-or-later
"""Install the built extension zip into the user's Blender and verify it
registers through the real bl_ext package path, then persist preferences.

Run:  blender --background --python tests/install_check.py --python-exit-code 1
"""
import sys
from pathlib import Path

import bpy

zip_path = Path(__file__).resolve().parents[1] / "blendlink-addon.zip"
if not zip_path.exists():
    raise SystemExit(f"build the zip first: {zip_path}")

bpy.ops.extensions.package_install_files(
    filepath=str(zip_path), repo="user_default", enable_on_install=True,
)

module_name = "bl_ext.user_default.blendlink"
if module_name not in sys.modules:
    raise SystemExit(f"{module_name} not imported after install")

addon = bpy.context.preferences.addons.get(module_name)
if addon is None:
    raise SystemExit("addon not enabled in preferences")
if addon.preferences is None:
    raise SystemExit("AddonPreferences did not register (bl_idname mismatch?)")
if addon.preferences.category != "Blendlink":
    raise SystemExit(f"unexpected default category: {addon.preferences.category}")

# Operators registered through the real package path?
if not hasattr(bpy.ops.blendlink, "tag_collider"):
    raise SystemExit("blendlink operators missing")

bpy.ops.wm.save_userpref()
print("BLENDLINK_ADDON_INSTALL_OK")
