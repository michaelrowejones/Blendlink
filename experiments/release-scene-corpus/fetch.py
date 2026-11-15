"""Acquire hash-pinned public originals. Does not open Blender or run scripts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
import urllib.request
import zipfile


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def safe_member(root, member):
    if '\\' in member.filename or ':' in member.filename:
        raise ValueError('Nonportable archive member: ' + member.filename)
    target = (root / member.filename).resolve()
    if not target.is_relative_to(root.resolve()) or stat.S_ISLNK(member.external_attr >> 16):
        raise ValueError('Unsafe archive member: ' + member.filename)
    return target


def member_digest(z, member):
    h = hashlib.sha256()
    with z.open(member) as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_cached_tree(z, members, destination):
    if destination.is_symlink() or not destination.is_dir():
        raise ValueError('Extraction cache is not a regular directory: ' + str(destination))
    for member in members:
        path = destination / member.filename
        safe_member(destination, member)
        # Reject even an internal symlink: cached extracted members must retain
        # their original kind, not merely resolve to currently identical bytes.
        if any(p.is_symlink() for p in [path, *path.parents] if p.is_relative_to(destination)):
            raise ValueError('Changed cached member (symlink): ' + member.filename)
        if member.is_dir():
            if not path.is_dir():
                raise ValueError('Missing or changed cached directory: ' + member.filename)
        elif (not path.is_file() or path.stat().st_size != member.file_size
              or digest(path) != member_digest(z, member)):
            raise ValueError('Missing or changed cached member; preserving prior bytes: ' + member.filename)


def extract_immutable(z, destination, source_entry, expected_source):
    members = z.infolist()
    if sum(m.file_size for m in members) > 1024 * 1024 * 1024:
        raise ValueError('Archive exceeds extraction byte budget')
    targets = set()
    for member in members:
        target = safe_member(destination, member)
        if target in targets:
            raise ValueError('Duplicate archive target: ' + member.filename)
        targets.add(target)
    entry = z.getinfo(source_entry)
    if entry.is_dir() or entry.file_size != expected_source['bytes'] or member_digest(z, entry) != expected_source['sha256']:
        raise ValueError('Pinned source does not match the archive member')
    if destination.exists() or destination.is_symlink():
        verify_cached_tree(z, members, destination)
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    lock = destination.parent / ('.' + destination.name + '.extract.lock')
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise ValueError('Extraction already in progress; preserving cache: ' + str(lock)) from error
    stage = None
    try:
        os.close(fd)
        if destination.exists() or destination.is_symlink():
            verify_cached_tree(z, members, destination)
            return
        stage = Path(tempfile.mkdtemp(prefix='.' + destination.name + '.extract-', dir=destination.parent))
        z.extractall(stage)
        verify_cached_tree(z, members, stage)
        if destination.exists() or destination.is_symlink():
            verify_cached_tree(z, members, destination)
        else:
            # Stage and destination share a parent/filesystem. Existing cache
            # trees never pass through extractall and never receive writes.
            os.rename(stage, destination)
            stage = None
    finally:
        if stage is not None:
            shutil.rmtree(stage)
        lock.unlink()


def acquire(scene, directory):
    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    archive = (directory / scene['downloadFile']).resolve()
    assert archive.is_relative_to(directory)
    if not archive.exists():
        fd, temp = tempfile.mkstemp(prefix='.download-', dir=directory)
        try:
            with os.fdopen(fd, 'wb') as output, urllib.request.urlopen(scene['url'], timeout=60) as response:
                total = 0
                while data := response.read(1024 * 1024):
                    total += len(data)
                    if total > scene['downloadBytes']:
                        raise ValueError('Download exceeds pinned byte count')
                    output.write(data)
            assert Path(temp).stat().st_size == scene['downloadBytes']
            assert digest(Path(temp)) == scene['downloadSha256']
            os.replace(temp, archive)
        finally:
            Path(temp).unlink(missing_ok=True)
    assert archive.stat().st_size == scene['downloadBytes']
    assert digest(archive) == scene['downloadSha256']
    if scene.get('archiveEntry'):
        destination = directory / scene['extractDirectory']
        assert destination.resolve().is_relative_to(directory)
        with zipfile.ZipFile(archive) as z:
            extract_immutable(z, destination, scene['archiveEntry'], scene['source'])
    source = (directory / scene['sourcePath']).resolve()
    assert source.is_relative_to(directory)
    assert source.stat().st_size == scene['source']['bytes']
    assert digest(source) == scene['source']['sha256']
    return source


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--scene', action='append')
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).resolve().parents[2] / 'docs/release-scene-corpus.json').read_text())
    ids = {s['id'] for s in manifest['scenes']}
    assert not args.scene or set(args.scene) <= ids
    for scene in manifest['scenes']:
        if not args.scene or scene['id'] in args.scene:
            print(scene['id'], acquire(scene, args.directory))
