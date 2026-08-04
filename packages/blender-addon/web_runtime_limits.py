# SPDX-License-Identifier: GPL-3.0-or-later
"""Hard ceilings of the pinned web runtime, shared with the TypeScript side.

The numbers in ``web_runtime_limits.json`` are the reason several refusals
exist, and they have to be identical in two languages: Blender refuses before
a two-hour bake, and the compiled-artifact gate refuses again on the finished
GLB because the exporter is not the only thing that can put a joint or a UV
set into it. A constant copied into both languages drifts silently, so the
number is authored once as data and both readers assert against it.

Empty is not a valid state here: a limit is removed only when the pinned
runtime stops having it.
"""
from __future__ import annotations

import json
from pathlib import Path

REGISTRY_PATH = Path(__file__).with_name("web_runtime_limits.json")

_registry_cache = None


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be non-empty text")
    return value.strip()


def validate_registry(data):
    """Fail loudly on a malformed registry rather than defaulting a ceiling."""
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError("web runtime limit registry schemaVersion must be 1")
    _text(data.get("policy"), "web runtime limit registry policy")
    _text(data.get("runtime"), "web runtime limit registry runtime")
    limits = data.get("limits")
    if not isinstance(limits, list) or not limits:
        raise ValueError(
            "web runtime limit registry limits must be a nonempty array"
        )
    seen = set()
    resolved = {}
    for index, limit in enumerate(limits):
        if not isinstance(limit, dict):
            raise ValueError(f"limits[{index}] must be an object")
        limit_id = _text(limit.get("id"), f"limits[{index}].id")
        if limit_id in seen:
            raise ValueError(f"duplicate web runtime limit id {limit_id}")
        seen.add(limit_id)
        maximum = limit.get("maximum")
        if not isinstance(maximum, int) or isinstance(maximum, bool) \
                or maximum <= 0:
            raise ValueError(
                f"limits[{index}].maximum must be a positive integer"
            )
        for field in ("measure", "summary", "symptom", "action"):
            _text(limit.get(field), f"limits[{index}].{field}")
        evidence = limit.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(
                f"limits[{index}].evidence must be a nonempty array; a ceiling "
                "without evidence is a guess"
            )
        for position, item in enumerate(evidence):
            _text(item, f"limits[{index}].evidence[{position}]")
        resolved[limit_id] = limit
    return resolved


def registry():
    global _registry_cache
    if _registry_cache is None:
        try:
            data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise ValueError(
                f"cannot read web runtime limits at {REGISTRY_PATH}: {error}"
            ) from error
        _registry_cache = validate_registry(data)
    return _registry_cache


def limit(limit_id: str) -> dict:
    """One validated limit record, or a loud failure naming the known ids."""
    found = registry().get(limit_id)
    if found is None:
        raise KeyError(
            f"unknown web runtime limit {limit_id!r}; the registry declares "
            + ", ".join(sorted(registry()))
        )
    return found


def maximum(limit_id: str) -> int:
    return int(limit(limit_id)["maximum"])


def consequence(limit_id: str) -> str:
    """The artist-facing sentence pair every refusal on this limit reuses."""
    record = limit(limit_id)
    return f"{record['symptom']} {record['action']}"
