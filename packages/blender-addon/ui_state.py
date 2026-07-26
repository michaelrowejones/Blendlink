# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure selection state used by Blendlink's Blender UI.

The UI must not imply that one active object's settings apply to an entire
selection.  This module reduces only the objects it is given; it never reads
``bpy.context``, a scene, or global Blender data, so redraw cost stays
proportional to the current selection.
"""
from __future__ import annotations

try:
    from . import vocab
except ImportError:  # Direct execution by the standalone test.
    import vocab  # type: ignore


MIXED = "MIXED"

_RENDERING_VALUES = ("AUTO", "DYNAMIC", "BAKED")
_INCLUSION_VALUES = ("INCLUDED", "EXCLUDED")
_VISIBILITY_VALUES = ("VISIBLE", "HIDDEN")
_SHADOW_VALUES = ("AUTO", "BOTH", "CAST", "RECEIVE", "NONE")


def _rendering(obj) -> str:
    explicit = obj.get("blendlink_dynamic")
    if explicit is None:
        return "AUTO"
    return "DYNAMIC" if bool(explicit) else "BAKED"


def _inclusion(obj) -> str:
    role = obj.get("blendlink_role")
    extras = {"blendlink_role": role} if role is not None else None
    classification = vocab.classify(obj.name, extras)
    return (
        "EXCLUDED"
        if classification is not None and classification.kind == "noimp"
        else "INCLUDED"
    )


def _atlas(obj) -> str:
    override = obj.get("blendlink_atlas")
    return override if isinstance(override, str) else "AUTO"


def _visibility(obj) -> str:
    return "VISIBLE" if bool(obj.get("blendlink_active", True)) else "HIDDEN"


def _shadows(obj) -> str:
    cast = obj.get("blendlink_cast_shadow")
    receive = obj.get("blendlink_receive_shadow")
    if cast is None and receive is None:
        return "AUTO"
    if cast and receive:
        return "BOTH"
    if cast:
        return "CAST"
    if receive:
        return "RECEIVE"
    return "NONE"


def _reflections(obj) -> str:
    probe_id = obj.get("blendlink_reflection_probe")
    return probe_id if isinstance(probe_id, str) and probe_id else "SCENE"


def _finish(counts: dict[str, int]) -> dict:
    used = [value for value, count in counts.items() if count]
    return {
        "total": sum(counts.values()),
        "counts": counts,
        "value": used[0] if len(used) == 1 else (MIXED if used else None),
    }


def _summarize(objects, resolver, values=(), *, meshes_only=False) -> dict:
    counts = {value: 0 for value in values}
    for obj in objects:
        if meshes_only and getattr(obj, "type", None) != "MESH":
            continue
        value = resolver(obj)
        counts[value] = counts.get(value, 0) + 1
    return _finish(counts)


def summarize_rendering(objects) -> dict:
    """Summarize authored Automatic/Realtime/Baked intent on meshes."""
    return _summarize(objects, _rendering, _RENDERING_VALUES, meshes_only=True)


def summarize_inclusion(objects) -> dict:
    """Summarize web-scene inclusion using the canonical vocabulary parser."""
    return _summarize(objects, _inclusion, _INCLUSION_VALUES)


def summarize_atlas(objects) -> dict:
    """Summarize explicit atlas IDs; absent overrides are ``AUTO``."""
    return _summarize(objects, _atlas, ("AUTO",), meshes_only=True)


def summarize_visibility(objects) -> dict:
    """Summarize authored initial website visibility for all objects."""
    return _summarize(objects, _visibility, _VISIBILITY_VALUES)


def summarize_shadows(objects) -> dict:
    """Summarize portable cast/receive intent on meshes."""
    return _summarize(objects, _shadows, _SHADOW_VALUES, meshes_only=True)


def summarize_reflections(objects) -> dict:
    """Summarize scene-environment/local-probe intent on meshes."""
    return _summarize(objects, _reflections, ("SCENE",), meshes_only=True)


def summarize_selection(objects) -> dict[str, dict]:
    """Return every authored selection summary after exactly one iteration.

    Each dimension has the same shape: ``total``, ``counts``, and ``value``.
    ``value`` is the sole value, ``MIXED``, or ``None`` when no passed object is
    applicable. Rendering, atlas, and shadows apply only to meshes.
    """
    counts = {
        "rendering": {value: 0 for value in _RENDERING_VALUES},
        "inclusion": {value: 0 for value in _INCLUSION_VALUES},
        "atlas": {"AUTO": 0},
        "visibility": {value: 0 for value in _VISIBILITY_VALUES},
        "shadows": {value: 0 for value in _SHADOW_VALUES},
        "reflections": {"SCENE": 0},
    }
    for obj in objects:
        inclusion = _inclusion(obj)
        counts["inclusion"][inclusion] += 1
        visibility = _visibility(obj)
        counts["visibility"][visibility] += 1
        if getattr(obj, "type", None) != "MESH":
            continue
        rendering = _rendering(obj)
        counts["rendering"][rendering] += 1
        atlas = _atlas(obj)
        counts["atlas"][atlas] = counts["atlas"].get(atlas, 0) + 1
        shadows = _shadows(obj)
        counts["shadows"][shadows] += 1
        reflections = _reflections(obj)
        counts["reflections"][reflections] = (
            counts["reflections"].get(reflections, 0) + 1
        )
    return {name: _finish(dimension) for name, dimension in counts.items()}


__all__ = (
    "MIXED",
    "summarize_atlas",
    "summarize_inclusion",
    "summarize_rendering",
    "summarize_reflections",
    "summarize_selection",
    "summarize_shadows",
    "summarize_visibility",
)
