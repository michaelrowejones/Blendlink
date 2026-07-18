# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure-Python mirror of blendlink's vocabulary parser (vocabulary.ts).

No bpy imports — this module is unit-testable outside Blender and is the
single source of truth for name parsing inside the addon. Keep the regexes
byte-for-byte in sync with packages/blendlink/src/vocabulary.ts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

COLLIDER_RE = re.compile(r"[-_](conv)?col(only)?$", re.IGNORECASE)
RIGID_RE = re.compile(r"[-_]rigid$", re.IGNORECASE)
LOD_RE = re.compile(r"[-_]lod(\d+)$", re.IGNORECASE)
NOIMP_RE = re.compile(r"[-_]noimp$", re.IGNORECASE)
SOCKET_RE = re.compile(r"^socket[-_](.+)$", re.IGNORECASE)
HOTSPOT_RE = re.compile(r"^hotspot[-_](.+)$", re.IGNORECASE)
AUDIO_RE = re.compile(r"^audio[-_](.+)$", re.IGNORECASE)
NEAR_MISS_RE = re.compile(r"col+only|con+vcol|socket|hotspot|[-_]lod[-_]?\d", re.IGNORECASE)
# Blender's duplicate auto-numbering ("Crate-colonly.001") hides end-of-name
# tokens from every suffix regex above.
NUMBERED_RE = re.compile(r"^(?P<stem>.+)(?P<dup>\.\d{3})$")

STRUCTURAL_TOKENS = ("col", "convcol", "colonly", "convcolonly", "rigid", "noimp")
ANCHOR_KINDS = ("SOCKET", "HOTSPOT", "AUDIO")


@dataclass
class Classification:
    kind: str  # 'collider' | 'rigid' | 'lod' | 'noimp' | 'socket' | 'hotspot' | 'audio'
    base: str
    shape: str | None = None  # collider: 'convex' | 'trimesh'
    proxy_only: bool = False
    lod_index: int | None = None
    anchor_name: str | None = None


@dataclass
class LintIssue:
    severity: str  # 'WARNING' | 'INFO'
    message: str
    object_name: str | None = None
    fixable_numbered: bool = False


def classify(name: str) -> Classification | None:
    """Classify one object name; None when it carries no vocabulary token."""
    match = SOCKET_RE.match(name)
    if match:
        return Classification("socket", name, anchor_name=match.group(1))
    match = HOTSPOT_RE.match(name)
    if match:
        return Classification("hotspot", name, anchor_name=match.group(1))
    match = AUDIO_RE.match(name)
    if match:
        return Classification("audio", name, anchor_name=match.group(1))
    match = COLLIDER_RE.search(name)
    if match:
        return Classification(
            "collider",
            name[: match.start()],
            shape="convex" if match.group(1) else "trimesh",
            proxy_only=bool(match.group(2)),
        )
    match = RIGID_RE.search(name)
    if match:
        return Classification("rigid", name[: match.start()])
    match = LOD_RE.search(name)
    if match:
        return Classification("lod", name[: match.start()], lod_index=int(match.group(1)))
    match = NOIMP_RE.search(name)
    if match:
        return Classification("noimp", name[: match.start()])
    return None


def strip_structural(name: str) -> str:
    """Remove one trailing structural suffix (collider/rigid/lod/noimp)."""
    for pattern in (COLLIDER_RE, RIGID_RE, LOD_RE, NOIMP_RE):
        match = pattern.search(name)
        if match:
            return name[: match.start()]
    return name


def strip_anchor(name: str) -> str:
    """Remove a leading SOCKET_/HOTSPOT_/AUDIO_ prefix."""
    for pattern in (SOCKET_RE, HOTSPOT_RE, AUDIO_RE):
        match = pattern.match(name)
        if match:
            return match.group(1)
    return name


def numbered_token(name: str) -> str | None:
    """If Blender's `.NNN` duplicate suffix hides a vocabulary token, return
    the stem that WOULD have matched ('Crate-colonly' for 'Crate-colonly.001')."""
    match = NUMBERED_RE.match(name)
    if not match:
        return None
    stem = match.group("stem")
    classification = classify(stem)
    if classification and classification.kind not in ("socket", "hotspot", "audio"):
        return stem
    return None


def fix_numbered(name: str) -> str:
    """Move the `.NNN` duplicate suffix into the base so the token parses:
    'Crate-colonly.001' -> 'Crate.001-colonly'."""
    match = NUMBERED_RE.match(name)
    if not match:
        return name
    stem, dup = match.group("stem"), match.group("dup")
    classification = classify(stem)
    if classification is None:
        return name
    if classification.kind in ("socket", "hotspot", "audio"):
        # Prefix tokens still parse with a numbered tail; nothing to fix.
        return name
    suffix = stem[len(classification.base):]
    return f"{classification.base}{dup}{suffix}"


@dataclass
class SceneNode:
    """Minimal object description the linter needs (decoupled from bpy)."""
    name: str
    is_empty: bool = False
    extras: dict = field(default_factory=dict)


def lint(nodes: list[SceneNode]) -> list[LintIssue]:
    issues: list[LintIssue] = []
    lod_groups: dict[str, list[int]] = {}
    for node in nodes:
        classification = classify(node.name)
        if classification is None:
            hidden_stem = numbered_token(node.name)
            if hidden_stem is not None:
                issues.append(LintIssue(
                    "WARNING",
                    f'"{node.name}" — duplicate numbering hides the tag',
                    node.name,
                    fixable_numbered=True,
                ))
            elif NEAR_MISS_RE.search(node.name):
                issues.append(LintIssue(
                    "WARNING",
                    f'"{node.name}" looks like a vocabulary token but did not match',
                    node.name,
                ))
            continue
        if classification.kind in ("socket", "hotspot", "audio") and not node.is_empty:
            issues.append(LintIssue(
                "WARNING",
                f'"{node.name}" — anchors are usually Empties, this has geometry',
                node.name,
            ))
        if classification.kind == "lod" and classification.lod_index is not None:
            lod_groups.setdefault(classification.base, []).append(classification.lod_index)
            if classification.lod_index > 0 and "lod_distance" not in node.extras:
                issues.append(LintIssue(
                    "INFO",
                    f'"{node.name}" has no lod_distance custom property',
                    node.name,
                ))
    for base, levels in lod_groups.items():
        ordered = sorted(set(levels))
        if ordered and ordered != list(range(ordered[0], ordered[0] + len(ordered))):
            issues.append(LintIssue(
                "WARNING",
                f'LOD chain "{base}" has gaps: {ordered}',
            ))
        if ordered and ordered[0] != 0:
            issues.append(LintIssue(
                "WARNING",
                f'LOD chain "{base}" has no LOD0',
            ))
    return issues
