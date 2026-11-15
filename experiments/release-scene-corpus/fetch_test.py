import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from fetch import acquire


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fixture(directory, extra=None):
    archive = directory / 'scene.zip'
    source = b'original source'
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('scene.blend', source)
        z.writestr('textures/albedo.png', b'original texture')
        if extra is not None:
            z.writestr(extra, b'not allowed')
    return {'downloadFile': archive.name, 'downloadBytes': archive.stat().st_size,
        'downloadSha256': sha(archive.read_bytes()), 'url': 'https://example.invalid/never-fetch',
        'extractDirectory': 'extracted/source', 'archiveEntry': 'scene.blend',
        'sourcePath': 'extracted/source/scene.blend',
        'source': {'bytes': len(source), 'sha256': sha(source)}}


def snapshot(directory):
    return {str(p.relative_to(directory)): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in directory.rglob('*') if p.is_file() and not p.is_symlink()}


class ImmutableExtraction(unittest.TestCase):
    def test_fresh_staging_then_cached_validation_has_no_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            scene = fixture(root)
            source = acquire(scene, root)
            self.assertEqual(source.read_bytes(), b'original source')
            before = snapshot(root)
            with patch('fetch.zipfile.ZipFile.extractall', side_effect=AssertionError('cached extraction must not run')):
                self.assertEqual(acquire(scene, root), source)
            self.assertEqual(snapshot(root), before)
            self.assertEqual(sorted(p.name for p in (root / 'extracted').iterdir()), ['source'])

    def test_changed_source_and_sidecar_are_preserved(self):
        for member in ['scene.blend', 'textures/albedo.png']:
            with self.subTest(member=member), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                scene = fixture(root)
                acquire(scene, root)
                changed = root / 'extracted/source' / member
                changed.write_bytes(changed.read_bytes().upper())  # same size, different hash
                before = snapshot(root)
                with self.assertRaisesRegex(ValueError, 'changed cached member'):
                    acquire(scene, root)
                self.assertEqual(snapshot(root), before)

    def test_partial_existing_cache_is_not_repaired_or_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            scene = fixture(root)
            destination = root / 'extracted/source'
            destination.mkdir(parents=True)
            (destination / 'scene.blend').write_bytes(b'original source')
            before = snapshot(root)
            with self.assertRaisesRegex(ValueError, 'Missing or changed cached member'):
                acquire(scene, root)
            self.assertEqual(snapshot(root), before)
            self.assertFalse((destination / 'textures').exists())

    def test_interrupted_fresh_extraction_leaves_no_destination_or_debris(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            scene = fixture(root)
            def fail_extract(_archive, stage):
                (stage / 'scene.blend').write_bytes(b'partial')
                raise OSError('simulated interrupted write')
            with patch('fetch.zipfile.ZipFile.extractall', autospec=True, side_effect=fail_extract):
                with self.assertRaisesRegex(OSError, 'interrupted'):
                    acquire(scene, root)
            self.assertFalse((root / 'extracted/source').exists())
            self.assertEqual(list((root / 'extracted').iterdir()), [])
            self.assertEqual(sha((root / 'scene.zip').read_bytes()), scene['downloadSha256'])

    def test_traversal_and_archive_symlink_refuse_without_extraction(self):
        symbolic = zipfile.ZipInfo('link.blend')
        symbolic.external_attr = 0o120777 << 16
        for member in ['../escape.blend', '/escape.blend', '..\\escape.blend', symbolic]:
            with self.subTest(member=member), tempfile.TemporaryDirectory() as folder:
                root = Path(folder).resolve()
                scene = fixture(root, member)
                before = snapshot(root)
                with self.assertRaises(ValueError):
                    acquire(scene, root)
                self.assertEqual(snapshot(root), before)
                self.assertFalse((root / 'extracted').exists())


if __name__ == '__main__':
    unittest.main()
