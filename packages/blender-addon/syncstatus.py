# SPDX-License-Identifier: GPL-3.0-or-later
"""Sync status: does the saved .blend match the last `blendlink sync`?

blendlink's generated manifest records `blendBytesHash` — the first 16 hex
chars of sha256 over the .blend bytes — and `sourceBlend`. We locate the
manifest (walk up from the .blend to a dir containing blendlink.config.mjs,
then a bounded search for *.manifest.json), then compare hashes. Everything
is mtime-cached; the timer only stats files.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import bpy

_SKIP_DIRS = {"node_modules", ".git", ".next", "dist", "out", "__pycache__"}
_MAX_WALK_UP = 8
_MAX_SCAN_DEPTH = 6

_state = {
    "status": "NO_FILE",  # NO_FILE | NO_MANIFEST | IN_SYNC | NEEDS_SYNC | UNSAVED_EDITS
    "detail": "",
    "hint": "",  # manifest syncHint: the command that regenerates the artifacts
    "manifest_path": None,
    "manifest_mtime": 0,
    "blend_hash": None,
    "blend_mtime": 0,
    "searched_for": None,
}

STATUS_UI = {
    "NO_FILE": ("FILE_BLEND", "Save the file to track sync"),
    "NO_MANIFEST": ("GHOST_DISABLED", "No blendlink manifest found"),
    "IN_SYNC": ("CHECKMARK", "In sync with the web build"),
    "NEEDS_SYNC": ("FILE_REFRESH", "Saved changes not yet synced"),
    "UNSAVED_EDITS": ("GREASEPENCIL", "Unsaved edits in Blender"),
}


def status() -> tuple[str, str, str]:
    icon, label = STATUS_UI[_state["status"]]
    return _state["status"], icon, label


def sync_hint() -> str:
    """Command that regenerates the artifacts (from the manifest), or ''."""
    return _state["hint"]


def reset():
    _state.update(
        status="NO_FILE", detail="", hint="", manifest_path=None, manifest_mtime=0,
        blend_hash=None, blend_mtime=0, searched_for=None,
    )


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def _iter_manifests(root: Path):
    stack = [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                if depth < _MAX_SCAN_DEPTH and entry.name not in _SKIP_DIRS:
                    stack.append((Path(entry.path), depth + 1))
            elif entry.name.endswith(".manifest.json"):
                yield Path(entry.path)


def _find_manifest(blend_path: Path) -> Path | None:
    directory = blend_path.parent
    root = None
    for _ in range(_MAX_WALK_UP):
        if (directory / "blendlink.config.mjs").exists():
            root = directory
            break
        if directory.parent == directory:
            break
        directory = directory.parent
    if root is None:
        return None
    for manifest_path in _iter_manifests(root):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        except (OSError, json.JSONDecodeError):
            continue
        source = manifest.get("sourceBlend")
        if not source:
            continue
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = (root / source_path).resolve()
        try:
            if source_path.resolve() == blend_path.resolve():
                return manifest_path
        except OSError:
            pass
        if source_path.name == blend_path.name:
            return manifest_path
    return None


def refresh(force: bool = False) -> bool:
    """Recompute the status; returns True when it changed. Cheap unless the
    .blend or manifest changed on disk (mtime-gated)."""
    previous = _state["status"]
    filepath = bpy.data.filepath
    if not filepath:
        _state["status"] = "NO_FILE"
        return previous != _state["status"]
    blend_path = Path(filepath)

    if force or _state["searched_for"] != filepath or (
        _state["manifest_path"] and not Path(_state["manifest_path"]).exists()
    ):
        _state["manifest_path"] = _find_manifest(blend_path)
        _state["searched_for"] = filepath
        _state["manifest_mtime"] = 0
        _state["blend_mtime"] = 0

    if _state["manifest_path"] is None:
        _state["status"] = "NO_MANIFEST"
        return previous != _state["status"]

    try:
        blend_mtime = os.stat(blend_path).st_mtime_ns
        manifest_mtime = os.stat(_state["manifest_path"]).st_mtime_ns
    except OSError:
        _state["status"] = "NO_MANIFEST"
        return previous != _state["status"]

    if force or blend_mtime != _state["blend_mtime"]:
        _state["blend_hash"] = _hash_file(blend_path)
        _state["blend_mtime"] = blend_mtime
    if force or manifest_mtime != _state["manifest_mtime"]:
        try:
            manifest = json.loads(Path(_state["manifest_path"]).read_text(encoding="utf8"))
            _state["detail"] = manifest.get("blendBytesHash", "")
            _state["hint"] = manifest.get("syncHint", "")
        except (OSError, json.JSONDecodeError):
            _state["detail"] = ""
            _state["hint"] = ""
        _state["manifest_mtime"] = manifest_mtime

    if bpy.data.is_dirty:
        _state["status"] = "UNSAVED_EDITS"
    elif _state["detail"] and _state["detail"] == _state["blend_hash"]:
        _state["status"] = "IN_SYNC"
    else:
        _state["status"] = "NEEDS_SYNC"
    return previous != _state["status"]
