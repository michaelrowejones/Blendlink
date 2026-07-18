# SPDX-License-Identifier: GPL-3.0-or-later
"""Cached vocabulary scan of the scene.

The scan is cheap (regexes over object names) but per the HIG it must not run
inside draw() or on every depsgraph tick. Handlers mark the cache dirty; a
1-second timer consumes the flag; panels and the overlay read the cache.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import bpy
from mathutils import Matrix

from . import vocab


@dataclass
class OverlayItem:
    kind: str  # 'collider' | 'socket' | 'hotspot' | 'audio'
    shape: str  # 'box' | 'sphere' | 'axes' | 'cross'
    matrix: Matrix
    label: str = ""
    color: tuple = (1.0, 1.0, 1.0, 1.0)


@dataclass
class ScanResult:
    issues: list = field(default_factory=list)
    overlay: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)


_state = {"dirty": True, "result": ScanResult()}

_COLLIDER_COLOR = (0.30, 0.85, 0.45, 0.9)
_HOTSPOT_COLOR = (1.00, 0.62, 0.15, 0.95)
_AUDIO_COLOR = (0.25, 0.80, 0.95, 0.95)


def mark_dirty():
    _state["dirty"] = True


def is_dirty() -> bool:
    return _state["dirty"]


def result() -> ScanResult:
    return _state["result"]


def _bound_box_matrix(obj) -> Matrix:
    """World matrix that maps a unit cube (±0.5) onto the object's bound box."""
    corners = obj.bound_box
    minimum = [min(c[i] for c in corners) for i in range(3)]
    maximum = [max(c[i] for c in corners) for i in range(3)]
    center = [(minimum[i] + maximum[i]) / 2 for i in range(3)]
    size = [max(maximum[i] - minimum[i], 1e-5) for i in range(3)]
    local = Matrix.Translation(center) @ Matrix.Diagonal((*size, 1.0))
    return obj.matrix_world @ local


def _empty_matrix(obj) -> Matrix:
    scale = obj.empty_display_size if obj.type == "EMPTY" else 1.0
    return obj.matrix_world @ Matrix.Scale(scale, 4)


def _overlay_for(obj, classification) -> OverlayItem | None:
    if classification.kind == "collider":
        if obj.type == "EMPTY":
            shape = "sphere" if obj.empty_display_type == "SPHERE" else "box"
            # Empty display size is a radius / half-extent: unit shapes are ±0.5.
            matrix = obj.matrix_world @ Matrix.Scale(obj.empty_display_size * 2.0, 4)
            return OverlayItem("collider", shape, matrix, color=_COLLIDER_COLOR)
        if obj.type == "MESH":
            return OverlayItem("collider", "box", _bound_box_matrix(obj), color=_COLLIDER_COLOR)
        return None
    if classification.kind == "socket":
        return OverlayItem("socket", "axes", _empty_matrix(obj), label=classification.anchor_name or "")
    if classification.kind == "hotspot":
        return OverlayItem(
            "hotspot", "cross", _empty_matrix(obj),
            label=classification.anchor_name or "", color=_HOTSPOT_COLOR,
        )
    if classification.kind == "audio":
        return OverlayItem(
            "audio", "cross", _empty_matrix(obj),
            label=classification.anchor_name or "", color=_AUDIO_COLOR,
        )
    return None


def recompute(scene) -> bool:
    """Rescan; returns True when the visible outcome changed."""
    nodes = []
    overlay: list[OverlayItem] = []
    counts: dict[str, int] = {}
    for obj in scene.objects:
        extras = {key: obj[key] for key in obj.keys()}
        nodes.append(vocab.SceneNode(
            name=obj.name,
            is_empty=obj.type == "EMPTY",
            extras=extras,
        ))
        classification = vocab.classify(obj.name, extras)
        if classification is None:
            continue
        counts[classification.kind] = counts.get(classification.kind, 0) + 1
        item = _overlay_for(obj, classification)
        if item is not None:
            overlay.append(item)
    issues = vocab.lint(nodes)
    _state["result"] = ScanResult(issues=issues, overlay=overlay, counts=counts)
    _state["dirty"] = False
    # A dirty scan implies something moved or was renamed — one redraw is due
    # even when the issue list is unchanged, because overlay matrices shifted.
    return True


def consume_if_dirty() -> bool:
    if not _state["dirty"]:
        return False
    scene = bpy.context.scene
    if scene is None:
        return False
    return recompute(scene)
