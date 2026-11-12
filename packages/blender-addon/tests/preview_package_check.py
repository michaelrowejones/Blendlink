# SPDX-License-Identifier: GPL-3.0-or-later
"""Installed addon can preview scenes outside an unpublished local checkout."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

addon_root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "blendlink_addon", addon_root / "__init__.py",
    submodule_search_locations=[str(addon_root)],
)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
original = addon.prefs.get_prefs
try:
    with tempfile.TemporaryDirectory(prefix="blendlink-preview-package-") as temporary:
        package = Path(temporary) / "Package With Spaces"
        cli = package / "dist" / "cli.js"
        cli.parent.mkdir(parents=True)
        cli.write_text("// fixture", encoding="utf8")
        descriptor = package / "package.json"
        version = addon.ops._addon_release_version()
        descriptor.write_text(json.dumps({"name": "blendlink", "version": version}), encoding="utf8")
        preferences = SimpleNamespace(preview_package=str(package))
        addon.prefs.get_prefs = lambda: preferences
        scene = Path(temporary) / "Unrelated Artist Folder" / "Scene.blend"
        command, cwd = addon.ops._preview_studio_command(str(scene))
        assert str(cli.resolve()) in command and str(scene) in command and "npx" not in command
        assert cwd == str(scene.parent)
        for invalid, message in (("relative/package", "absolute"), (str(package / "missing"), "Cannot read")):
            preferences.preview_package = invalid
            try:
                addon.ops._preview_studio_command(str(scene))
                raise AssertionError("Invalid override silently fell back to npm")
            except RuntimeError as error:
                assert message in str(error), str(error)
        preferences.preview_package = str(package)
        descriptor.write_text(json.dumps({"name": "blendlink", "version": "99.0.0"}), encoding="utf8")
        try:
            addon.ops._preview_studio_command(str(scene))
            raise AssertionError("Wrong version silently fell back to npm")
        except RuntimeError as error:
            assert f"blendlink {version}" in str(error)
        descriptor.write_text(json.dumps({"name": "blendlink", "version": version}), encoding="utf8")
        cli.unlink()
        try:
            addon.ops._preview_studio_command(str(scene))
            raise AssertionError("Missing build silently fell back to npm")
        except RuntimeError as error:
            assert "npm run build" in str(error)
finally:
    addon.prefs.get_prefs = original
    addon.unregister()
print("BLENDLINK_PREVIEW_PACKAGE_PASSED")
