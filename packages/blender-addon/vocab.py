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
# Anchor prefixes are EXACT-CASE (Unreal's SOCKET_ convention): the
# case-insensitive version turned every "Socket_2way" electrical fixture
# into an anchor. Suffixes stay tolerant.
SOCKET_RE = re.compile(r"^SOCKET[-_](.+)$")
HOTSPOT_RE = re.compile(r"^HOTSPOT[-_](.+)$")
AUDIO_RE = re.compile(r"^AUDIO[-_](.+)$")
# Prefix tokens require their separator — bare "socket" fired on every
# WallSocket/EyeSocket in a hard-surface scene.
NEAR_MISS_RE = re.compile(
    r"col+only|con+vcol|^(socket|hotspot|audio)[-_]|[-_]lod[-_]?\d|[-_]noimp",
    re.IGNORECASE,
)
# Blender's duplicate auto-numbering ("Crate-colonly.001") hides end-of-name
# tokens from every suffix regex above.
NUMBERED_RE = re.compile(r"^(?P<stem>.+)(?P<dup>\.\d{3})$")

STRUCTURAL_TOKENS = ("col", "convcol", "colonly", "convcolonly", "rigid", "noimp")
ANCHOR_KINDS = ("SOCKET", "HOTSPOT", "AUDIO")

# Explicit property override: wins over the name when both are present.
ROLE_PROPERTY = "blendlink_role"
ROLE_VALUES = frozenset(STRUCTURAL_TOKENS)

_COLLIDER_ROLES = {
    "col": ("trimesh", False),
    "convcol": ("convex", False),
    "colonly": ("trimesh", True),
    "convcolonly": ("convex", True),
}


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


def classify(name: str, extras: dict | None = None) -> Classification | None:
    """Classify one object; None when it carries no vocabulary designation.

    Mirrors the TS parser's tolerance rules: a `blendlink_role` custom
    property wins over the name, and Blender's `.NNN` duplicate numbering is
    folded into the base so tagged duplicates still parse."""
    role = (extras or {}).get(ROLE_PROPERTY)
    if isinstance(role, str) and role.lower().strip() in ROLE_VALUES:
        role = role.lower().strip()
        if role in _COLLIDER_ROLES:
            shape, proxy_only = _COLLIDER_ROLES[role]
            # The property decides the SHAPE, but the logical name is still
            # the name with its collider token removed, exactly as the name
            # branch below does it and exactly as vocabulary.ts does it
            # (`nameCollider ? matchName.replace(COLLIDER, '') + dup : name`).
            # Returning the raw name here promised a collider called
            # "Crate-colonly" while the pipeline produced one called "Crate",
            # so the proxy never paired with its render mesh.
            numbered = NUMBERED_RE.match(name)
            stem, dup = (
                (numbered.group("stem"), numbered.group("dup"))
                if numbered else (name, "")
            )
            token = COLLIDER_RE.search(stem)
            base = stem[: token.start()] + dup if token else name
            return Classification(
                "collider", base, shape=shape, proxy_only=proxy_only,
            )
        return Classification(role, name)

    match = SOCKET_RE.match(name)
    if match:
        return Classification("socket", name, anchor_name=match.group(1))
    match = HOTSPOT_RE.match(name)
    if match:
        return Classification("hotspot", name, anchor_name=match.group(1))
    match = AUDIO_RE.match(name)
    if match:
        return Classification("audio", name, anchor_name=match.group(1))

    numbered = NUMBERED_RE.match(name)
    stem, dup = (numbered.group("stem"), numbered.group("dup")) if numbered else (name, "")
    match = COLLIDER_RE.search(stem)
    if match:
        return Classification(
            "collider",
            stem[: match.start()] + dup,
            shape="convex" if match.group(1) else "trimesh",
            proxy_only=bool(match.group(2)),
        )
    match = RIGID_RE.search(stem)
    if match:
        return Classification("rigid", stem[: match.start()] + dup)
    match = LOD_RE.search(stem)
    if match:
        return Classification("lod", stem[: match.start()] + dup, lod_index=int(match.group(1)))
    match = NOIMP_RE.search(stem)
    if match:
        return Classification("noimp", stem[: match.start()] + dup)
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
        role = node.extras.get(ROLE_PROPERTY)
        if isinstance(role, str) and role.lower().strip() not in ROLE_VALUES:
            issues.append(LintIssue(
                "WARNING",
                f'"{node.name}" — {ROLE_PROPERTY}="{role}" is not a known role',
                node.name,
            ))
        elif isinstance(role, str):
            name_only = classify(node.name)
            explicit = classify(node.name, node.extras)
            if name_only and explicit and name_only.kind != explicit.kind:
                issues.append(LintIssue(
                    "WARNING",
                    f'"{node.name}" — name says {name_only.kind} but {ROLE_PROPERTY} says {explicit.kind}; the property wins',
                    node.name,
                ))
        classification = classify(node.name, node.extras)
        if classification is None:
            if NEAR_MISS_RE.search(node.name):
                issues.append(LintIssue(
                    "WARNING",
                    f'"{node.name}" looks like a vocabulary token but did not match',
                    node.name,
                ))
            continue
        if numbered_token(node.name) is not None:
            issues.append(LintIssue(
                "INFO",
                f'"{node.name}" — duplicate numbering after the tag (parsed anyway; strict engines would miss it)',
                node.name,
                fixable_numbered=True,
            ))
        if classification.kind in ("socket", "hotspot", "audio") and not node.is_empty:
            issues.append(LintIssue(
                "WARNING",
                f'"{node.name}" — anchors are usually Empties, this has geometry',
                node.name,
            ))
        if classification.kind == "lod" and classification.lod_index is not None:
            lod_groups.setdefault(classification.base, []).append(classification.lod_index)
            if classification.lod_index > 0 and "blendlink_lod_distance" not in node.extras \
                    and "lod_distance" not in node.extras:
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
