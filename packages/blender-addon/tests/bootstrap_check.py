# SPDX-License-Identifier: GPL-3.0-or-later
"""Offline adversarial checks for the private desktop runtime installer."""
import hashlib
import importlib.util
import io
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bootstrap", Path(__file__).resolve().parents[1] / "bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class BootstrapChecks(unittest.TestCase):
    def test_archive_traversal_and_escaping_links_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, target in [("../outside", None), ("runtime/link", "../../outside")]:
                archive = root / "bad.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    item = tarfile.TarInfo(name)
                    if target:
                        item.type = tarfile.SYMTYPE
                        item.linkname = target
                    bundle.addfile(item)
                with self.assertRaisesRegex(RuntimeError, "unsafe path"):
                    bootstrap.extract_runtime(archive, root / "out", "runtime")
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("runtime/../../outside", "bad")
            with self.assertRaisesRegex(RuntimeError, "unsafe path"):
                bootstrap.extract_runtime(archive, root / "zip-out", "runtime")
            self.assertFalse((root / "outside").exists())

    def test_offline_setup_reuses_valid_runtime_without_network(self):
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(bootstrap, "valid_runtime", return_value=True), \
                patch.object(bootstrap.urllib.request, "urlopen") as download:
            node, npm = bootstrap.ensure_runtime(Path(temporary), online=False)
            self.assertIn("node", node.name)
            self.assertEqual(npm.name, "npm-cli.js")
            download.assert_not_called()

    def test_offline_first_setup_has_actionable_remedy(self):
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(bootstrap, "valid_runtime", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "Allow Online Access"):
                bootstrap.ensure_runtime(Path(temporary), online=False)

    def test_checksum_failure_never_installs_or_leaves_partial_download(self):
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(bootstrap, "valid_runtime", return_value=False), \
                patch.object(bootstrap.urllib.request, "urlopen", return_value=io.BytesIO(b"untrusted")):
            root = Path(temporary)
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                bootstrap.ensure_runtime(root)
            self.assertEqual(list(root.iterdir()), [])

    def test_windows_and_arm_architecture_mapping(self):
        with patch.object(bootstrap.platform, "system", return_value="Windows"), \
                patch.object(bootstrap.platform, "machine", return_value="AMD64"):
            self.assertEqual(bootstrap.runtime_platform(), ("Windows", "x64"))
        with patch.object(bootstrap.platform, "system", return_value="Darwin"), \
                patch.object(bootstrap.platform, "machine", return_value="arm64"):
            self.assertEqual(bootstrap.runtime_platform(), ("Darwin", "arm64"))


if __name__ == "__main__":
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(BootstrapChecks))
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("BLENDLINK_BOOTSTRAP_PASSED")
