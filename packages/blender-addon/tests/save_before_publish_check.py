# SPDX-License-Identifier: GPL-3.0-or-later
"""Native save contents, legacy deferred state, and failed-save refusals."""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import bpy

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("blendlink_save_contract", root / "__init__.py",
    submodule_search_locations=[str(root)])
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
try:
    with tempfile.TemporaryDirectory(prefix="blendlink-save-contract-") as temporary:
        source = Path(temporary) / "Saved Scene.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(source))
        scene = bpy.context.scene
        scene["private_publish_revision"] = 7
        assert addon.ops._save_before_publish(1) is True
        assert source.is_file()
        # Verify disk data independently of the dirty flag or operator report.
        check = subprocess.run([bpy.app.binary_path, "--background", "--factory-startup", str(source),
            "--python-exit-code", "1", "--python-expr",
            'import bpy;assert bpy.context.scene["private_publish_revision"]==7;print("PUBLISH_DISK_REVISION_PASSED")'],
            capture_output=True, text=True, timeout=60)
        assert check.returncode == 0 and "PUBLISH_DISK_REVISION_PASSED" in check.stdout, check.stdout + check.stderr
        for version in [(4, 2, 0), (5, 2, 0), (5, 3, 0)]:
            fake = SimpleNamespace(app=SimpleNamespace(version=version),
                data=SimpleNamespace(is_dirty=True, filepath=str(source)))
            with patch.object(addon.ops, "bpy", fake):
                for save in [lambda: {"CANCELLED"}, lambda: {"FINISHED"}]:
                    try:
                        addon.ops._save_before_publish(1, save_operation=save)
                    except RuntimeError:
                        pass
                    else:
                        raise AssertionError("A failed or still-dirty custom save allowed publishing")
        for version in [(4, 2, 0), (5, 2, 0), (5, 3, 0)]:
            fake = SimpleNamespace(app=SimpleNamespace(version=version),
                data=SimpleNamespace(is_dirty=True, filepath=str(source.parent / "Missing.blend")),
                ops=SimpleNamespace(wm=SimpleNamespace(save_mainfile=lambda: {"FINISHED"})))
            with patch.object(addon.ops, "bpy", fake):
                try:
                    addon.ops._save_before_publish(1)
                except RuntimeError:
                    pass
                else:
                    raise AssertionError("A missing/dirty save allowed publishing")
finally:
    addon.unregister()
print("BLENDLINK_SAVE_BEFORE_PUBLISH_PASSED", bpy.app.version_string)
