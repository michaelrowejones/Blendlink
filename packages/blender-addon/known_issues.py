# SPDX-License-Identifier: GPL-3.0-or-later
"""Evidence-gated Blender-version warnings shared by the addon UI.

The JSON beside this module is intentionally data, not Python behavior. Empty
is a valid state: Blendlink only warns when a bounded failure has public primary
evidence and a practical artist action.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

REGISTRY_PATH = Path(__file__).with_name("blender_known_issues.json")
BLENDER_EVIDENCE_HOSTS = {
    "docs.blender.org",
    "developer.blender.org",
    "projects.blender.org",
}
_registry_cache = None
_registry_error = None


def _version(value, field):
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a numeric Blender version")
    parts = value.split(".")
    if len(parts) not in (2, 3) or any(not part.isdigit() for part in parts):
        raise ValueError(f"{field} must be a numeric Blender version such as 4.2 or 5.1.1")
    values = tuple(int(part) for part in parts)
    return values + (0,) * (3 - len(values))


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be non-empty text")
    return value.strip()


def validate_registry(data):
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise ValueError("known-issue registry schemaVersion must be 1")
    _text(data.get("policy"), "known-issue registry policy")
    issues = data.get("issues")
    if not isinstance(issues, list):
        raise ValueError("known-issue registry issues must be an array")
    seen = set()
    for index, issue in enumerate(issues):
        if not isinstance(issue, dict):
            raise ValueError(f"issues[{index}] must be an object")
        issue_id = _text(issue.get("id"), f"issues[{index}].id")
        if re.fullmatch(r"[a-z0-9][a-z0-9-]*", issue_id) is None:
            raise ValueError(f"issues[{index}].id must be a lowercase slug")
        if issue_id in seen:
            raise ValueError(f"duplicate known-issue id {issue_id}")
        seen.add(issue_id)
        _text(issue.get("summary"), f"issues[{index}].summary")
        _text(issue.get("action"), f"issues[{index}].action")
        if issue.get("severity") not in {"warning", "block"}:
            raise ValueError(f"issues[{index}].severity must be warning or block")
        minimum = _version(issue.get("minInclusive"), f"issues[{index}].minInclusive")
        maximum = _text(issue.get("maxExclusive"), f"issues[{index}].maxExclusive")
        if _version(maximum, f"issues[{index}].maxExclusive") <= minimum:
            raise ValueError(f"issues[{index}].maxExclusive must be newer than minInclusive")
        evidence = issue.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"issues[{index}].evidence needs at least one primary-source URL")
        for source_index, source in enumerate(evidence):
            parsed = urlparse(_text(source, f"issues[{index}].evidence[{source_index}]"))
            primary = parsed.hostname in BLENDER_EVIDENCE_HOSTS or (
                parsed.hostname == "github.com"
                and parsed.path.startswith("/KhronosGroup/glTF-Blender-IO/")
            )
            if parsed.scheme != "https" or not primary:
                raise ValueError(
                    f"issues[{index}].evidence[{source_index}] must be an HTTPS "
                    "Blender/Khronos primary source"
                )
    return data


def load_registry(path=REGISTRY_PATH):
    try:
        return validate_registry(json.loads(Path(path).read_text(encoding="utf8")))
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(f"{path}: {error}") from error


def prime_cache() -> None:
    """Read and validate the bundled registry outside panel draw calls."""
    global _registry_cache, _registry_error
    try:
        _registry_cache = load_registry()
        _registry_error = None
    except RuntimeError as error:
        _registry_cache = None
        _registry_error = error


def matching(version, registry=None):
    version = tuple(version[:3])
    data = registry if registry is not None else load_registry()
    matches = []
    for issue in data["issues"]:
        if version < _version(issue["minInclusive"], f"{issue['id']}.minInclusive"):
            continue
        if version >= _version(issue["maxExclusive"], f"{issue['id']}.maxExclusive"):
            continue
        matches.append(issue)
    return matches


def current():
    import bpy
    if _registry_cache is None and _registry_error is None:
        # Direct module use in tests or source sessions that bypass register().
        prime_cache()
    if _registry_error is not None:
        raise RuntimeError(str(_registry_error))
    return matching(bpy.app.version, _registry_cache)
