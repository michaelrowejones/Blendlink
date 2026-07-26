"""Install and enable the official Needle Engine Blender addon."""

from __future__ import annotations

import sys
from pathlib import Path

import addon_utils
import bpy


def main() -> None:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 1:
        raise SystemExit("usage: blender --python install_needle_addon.py -- <addon.zip>")

    archive = Path(args[0]).resolve()
    if not archive.is_file():
        raise SystemExit(f"Needle addon archive not found: {archive}")

    bpy.ops.preferences.addon_install(filepath=str(archive), overwrite=True)
    addon_utils.modules_refresh()
    needle = next(
        (
            module
            for module in addon_utils.modules()
            if module.bl_info.get("name") == "Needle Engine Exporter for Blender"
        ),
        None,
    )
    if needle is None:
        raise SystemExit("Needle addon installed but its module could not be discovered")

    bpy.ops.preferences.addon_enable(module=needle.__name__)
    bpy.ops.wm.save_userpref()
    enabled, loaded = addon_utils.check(needle.__name__)
    if not enabled or not loaded:
        raise SystemExit(f"Needle addon did not enable cleanly: {needle.__name__}")
    print(f"NEEDLE_ADDON_READY {needle.__name__} {needle.bl_info.get('version')}")


if __name__ == "__main__":
    main()
