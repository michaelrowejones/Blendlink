# SPDX-License-Identifier: GPL-3.0-or-later
"""Canonical Blender-to-web realtime-light policy and diagnostics.

The module deliberately has no ``bpy`` dependency.  The interactive addon and
the headless exporter both pass Blender's scene/object data through this seam,
while pure Python tests can use small stand-ins.  Keeping visibility, supported
light types, unit conversion, and artist guidance together prevents the addon
from promising a light that the exporter cannot faithfully publish.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from math import isfinite, pi, sqrt
from typing import Iterable, Mapping


SUPPORTED_PUNCTUAL_TYPES = frozenset({"POINT", "SPOT", "SUN"})
WEB_LIGHT_TYPES = {
    "POINT": "point",
    "SPOT": "spot",
    "SUN": "directional",
}
LIGHTING_MODE_KEYS = (
    "export_import_convert_lighting_mode",
    "convert_lighting_mode",
)
LIGHTING_CONVERSION_MODE = "COMPAT"

STATUS_EXACT = "exact"
STATUS_APPROXIMATED = "approximated"
STATUS_NOT_EXPORTED = "notExported"

OUTCOME_EXACT = "exact"
OUTCOME_APPROXIMATED = "approximated"
OUTCOME_BAKE_ONLY = "bakeOnly"
OUTCOME_NOT_PUBLISHED = "notPublished"

AREA_LIGHT_MODE_PROPERTY = "blendlink_area_light_mode"
AREA_LIGHT_MODE_AUTO = "auto"
AREA_LIGHT_MODE_BAKE_ONLY = "bake-only"
AREA_LIGHT_MODE_THREE_RECT = "three-rect-area"
RECT_AREA_LIGHT_SCHEMA_VERSION = 1

_EPSILON = 1e-6
_EEVEE_ENGINES = frozenset({"BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"})
_EEVEE_MIN_AREA_HALF_EXTENT_PRODUCT = 1e-5
_EEVEE_MIN_AREA_HALF_EXTENT = 0.003
_SHADOW_CONTROL_DEFAULTS = {
    "shadow_buffer_clip_start": 0.05,
    "shadow_filter_radius": 1.0,
    "shadow_maximum_resolution": 0.001,
    "use_shadow_jitter": False,
}


@dataclass(frozen=True)
class RenderVisibility:
    """Why an object does or does not participate in a web render export."""

    exported: bool
    code: str
    detail: str
    hidden_collections: tuple[str, ...] = ()


@dataclass(frozen=True)
class LightDiagnostic:
    """One deterministic realtime-light decision for an artist-authored light."""

    object_name: str
    data_name: str
    source_type: str
    web_type: str | None
    status: str
    visibility: RenderVisibility
    detail: str
    reasons: tuple[str, ...] = ()
    source_energy: float | None = None
    source_exposure: float | None = None
    expected_web_intensity: float | None = None
    expected_three_power: float | None = None
    outcome: str = OUTCOME_EXACT
    remedy: str = ""

    def as_dict(self) -> dict:
        """Return a JSON-safe record for exporter sidecars and cached UI data."""
        return asdict(self)


@dataclass(frozen=True)
class LightWarning:
    """Nonblocking, artist-facing action associated with a light decision."""

    code: str
    message: str
    object_name: str
    severity: str = "WARNING"
    blocking: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class SceneLightAnalysis:
    """All light decisions and actionable warnings for one scene."""

    diagnostics: tuple[LightDiagnostic, ...]
    warnings: tuple[LightWarning, ...]

    def as_dict(self) -> dict:
        return {
            "lights": [item.as_dict() for item in self.diagnostics],
            "warnings": [item.as_dict() for item in self.warnings],
        }


@dataclass(frozen=True)
class RectAreaLightIssue:
    """One stable, machine-readable refusal or approximation reason."""

    code: str
    detail: str

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class RectAreaLightDescriptor:
    """Validated v1 payload for the finalized glTF node extra."""

    color: tuple[float, float, float]
    size: tuple[float, float]
    power: float | None = None
    intensity: float | None = None

    def __post_init__(self):
        _finite_vector(self.color, 3, label="color")
        _finite_vector(self.size, 2, label="size", positive=True)
        if (self.power is None) == (self.intensity is None):
            raise ValueError(
                "RectArea descriptor must contain exactly one of power or intensity"
            )
        strength_name = "power" if self.power is not None else "intensity"
        strength = self.power if self.power is not None else self.intensity
        numeric = _number(strength)
        if numeric is None or not isfinite(numeric) or numeric < 0.0:
            raise ValueError(f"{strength_name} must be a finite non-negative number")

    def as_dict(self) -> dict:
        payload = {
            "schemaVersion": RECT_AREA_LIGHT_SCHEMA_VERSION,
            "color": list(self.color),
            "size": list(self.size),
        }
        if self.power is not None:
            payload["power"] = self.power
        if self.intensity is not None:
            payload["intensity"] = self.intensity
        return payload


@dataclass(frozen=True)
class RectAreaLightPlan:
    """Closed Blender-side decision for one optional RectArea compilation."""

    object_name: str
    mode: str
    descriptor: RectAreaLightDescriptor | None = None
    refusals: tuple[RectAreaLightIssue, ...] = ()
    approximations: tuple[RectAreaLightIssue, ...] = ()
    fallbacks: tuple[RectAreaLightIssue, ...] = ()

    @property
    def outcome(self) -> str:
        if self.refusals:
            return OUTCOME_NOT_PUBLISHED
        if self.descriptor is not None:
            return OUTCOME_APPROXIMATED
        return OUTCOME_BAKE_ONLY

    def as_dict(self) -> dict:
        return {
            "object": self.object_name,
            "mode": self.mode,
            "outcome": self.outcome,
            "descriptor": (
                self.descriptor.as_dict() if self.descriptor is not None else None
            ),
            "refusals": [item.as_dict() for item in self.refusals],
            "approximations": [item.as_dict() for item in self.approximations],
            "fallbacks": [item.as_dict() for item in self.fallbacks],
        }


def exporter_policy(
    supported_properties: Iterable[str],
    overrides: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Compile the glTF options Blendlink must own for faithful web lights.

    Callers merge ordinary exporter options first and this returned mapping
    last.  Conflicting raw overrides fail loudly instead of silently restoring
    Blender's 683x ``SPEC`` conversion or publishing render-hidden lights.
    """
    supported = frozenset(supported_properties)
    mode_key = next((key for key in LIGHTING_MODE_KEYS if key in supported), None)
    if mode_key is None:
        raise RuntimeError(
            "This Blender glTF exporter exposes no compatible light-conversion "
            "mode; Blendlink cannot guarantee that authored light energy will "
            "match the website."
        )

    required = {"export_lights", "use_renderable", "use_active_scene"}
    missing = sorted(required - supported)
    if missing:
        raise RuntimeError(
            "This Blender glTF exporter cannot enforce Blendlink's realtime-light "
            "contract; missing exporter option(s): " + ", ".join(missing)
        )

    owned = {
        "export_lights": True,
        "use_renderable": True,
        "use_active_scene": True,
        mode_key: LIGHTING_CONVERSION_MODE,
    }
    authored_overrides = overrides or {}
    conflicts = {
        key
        for key, expected in owned.items()
        if key in authored_overrides and authored_overrides[key] != expected
    }
    conflicts.update(
        key for key in LIGHTING_MODE_KEYS
        if key in supported and key in authored_overrides
        and authored_overrides[key] != LIGHTING_CONVERSION_MODE
    )
    if conflicts:
        raise ValueError(
            "exporterOverrides cannot replace Blendlink's light-fidelity "
            f"contract ({', '.join(sorted(conflicts))}). Blendlink owns "
            "punctual-light export, render visibility, and Blender-compatible "
            "energy conversion."
        )
    return owned


def _identity(value) -> int:
    pointer = getattr(value, "as_pointer", None)
    if callable(pointer):
        try:
            return int(pointer())
        except (ReferenceError, RuntimeError, TypeError, ValueError):
            pass
    return id(value)


def _name(value, fallback: str) -> str:
    name = getattr(value, "name", None)
    return name if isinstance(name, str) and name else fallback


def _object_in_scene(obj, scene) -> bool:
    objects = getattr(scene, "objects", ())
    get = getattr(objects, "get", None)
    if callable(get):
        try:
            return get(getattr(obj, "name", "")) is obj
        except (ReferenceError, RuntimeError, TypeError):
            return False
    return any(candidate is obj for candidate in objects)


def _collection_paths(scene) -> dict[int, list[tuple]]:
    """Map every scene collection to all of its root-to-collection paths."""
    root = getattr(scene, "collection", None)
    if root is None:
        return {}
    paths: dict[int, list[tuple]] = {}
    stack = [(root, (root,), frozenset())]
    while stack:
        collection, path, ancestors = stack.pop()
        key = _identity(collection)
        if key in ancestors:
            continue
        paths.setdefault(key, []).append(path)
        next_ancestors = ancestors | {key}
        for child in getattr(collection, "children", ()):
            stack.append((child, (*path, child), next_ancestors))
    return paths


def _layer_collection_paths(view_layer) -> dict[tuple[int, ...], tuple]:
    """Index active LayerCollection paths by their Collection identity path."""
    root = getattr(view_layer, "layer_collection", None)
    if root is None:
        return {}
    paths = {}
    stack = [(root, (root,), frozenset())]
    while stack:
        layer, path, ancestors = stack.pop()
        collection = getattr(layer, "collection", None)
        key = _identity(collection) if collection is not None else _identity(layer)
        if key in ancestors:
            continue
        signature = tuple(
            _identity(getattr(item, "collection", item)) for item in path
        )
        paths[signature] = path
        next_ancestors = ancestors | {key}
        for child in getattr(layer, "children", ()):
            stack.append((child, (*path, child), next_ancestors))
    return paths


def view_layer_includes_object(obj, scene, view_layer) -> bool:
    """Whether any scene-collection path is included by the active View Layer.

    ``view_layer.objects`` may remain stale immediately after object linking.
    Identity-path resolution is deterministic, supports multi-linked objects,
    and matches Blender's rule that one included path is sufficient.
    """
    if not _object_in_scene(obj, scene):
        return False
    path_index = _collection_paths(scene)
    layer_paths = _layer_collection_paths(view_layer)
    for collection in getattr(obj, "users_collection", ()):
        for path in path_index.get(_identity(collection), ()):
            signature = tuple(_identity(item) for item in path)
            layer_path = layer_paths.get(signature)
            if layer_path is not None and not any(
                    bool(getattr(layer, "exclude", False))
                    for layer in layer_path):
                return True
    return False


def render_visibility(
        obj, scene, view_layer=None, *,
        additionally_hidden=frozenset()) -> RenderVisibility:
    """Resolve Blender's object + collection-hierarchy render visibility.

    Blender objects can be linked into several collections.  One visible path
    from the scene collection is sufficient; the object is collection-hidden
    only when every reachable membership path contains ``hide_render``.
    """
    object_name = _name(obj, "Object")
    if not _object_in_scene(obj, scene):
        return RenderVisibility(
            False,
            "notInScene",
            f'"{object_name}" does not belong to this scene and will not publish.',
        )
    if bool(getattr(obj, "hide_render", False)):
        return RenderVisibility(
            False,
            "objectHidden",
            f'"{object_name}" is disabled in renders, so it will not publish.',
        )

    path_index = _collection_paths(scene)
    layer_paths = _layer_collection_paths(view_layer) if view_layer is not None else {}
    reachable_paths = []
    for collection in getattr(obj, "users_collection", ()):
        reachable_paths.extend(path_index.get(_identity(collection), ()))
    if not reachable_paths:
        return RenderVisibility(
            False,
            "notInSceneCollection",
            f'"{object_name}" has no collection path in this scene and will not publish.',
        )

    hidden_names = set()
    excluded_names = set()
    for path in reachable_paths:
        hidden_on_path = [
            _name(collection, "Scene Collection")
            for collection in path
            if (bool(getattr(collection, "hide_render", False))
                or _name(collection, "Scene Collection") in additionally_hidden)
        ]
        signature = tuple(_identity(collection) for collection in path)
        layer_path = layer_paths.get(signature) if view_layer is not None else ()
        excluded_on_path = (
            [
                _name(getattr(layer, "collection", None), _name(layer, "View Layer"))
                for layer in layer_path
                if bool(getattr(layer, "exclude", False))
            ]
            if layer_path is not None else
            [_name(path[-1], "Collection")]
        )
        if not hidden_on_path and not excluded_on_path:
            return RenderVisibility(
                True,
                "visible",
                f'"{object_name}" is enabled for render publishing.',
            )
        hidden_names.update(hidden_on_path)
        excluded_names.update(excluded_on_path)

    blockers = tuple(sorted(hidden_names | excluded_names, key=str.casefold))
    if excluded_names and not hidden_names:
        code = "viewLayerExcluded"
        detail = (
            f'Every active View Layer path for "{object_name}" is excluded by '
            f"{', '.join(blockers)}; it will not publish."
        )
    else:
        code = "collectionHidden"
        detail = (
            f'Every scene collection path for "{object_name}" is render-hidden '
            f"or excluded by {', '.join(blockers)}; it will not publish."
        )
    return RenderVisibility(
        False,
        code,
        detail,
        blockers,
    )


def _instance_collection(obj):
    if getattr(obj, "instance_type", None) != "COLLECTION":
        return None
    return getattr(obj, "instance_collection", None)


def collect_instance_source_occurrences(scene, view_layer=None) -> dict[int, dict]:
    """Resolve objects expanded by every render-reachable Collection Instance.

    Each identity-keyed record retains all source occurrences because one
    source object can be reached through several roots or nested collection
    paths. Visibility includes the root instance's active View Layer state,
    every source collection's render flag, and every nested instance/object
    render flag. Malformed collection or instance cycles fail loudly rather
    than hanging a Web Check or silently omitting content.
    """
    records: dict[int, dict] = {}

    def record(obj, visible, root_instance, collections, instances):
        identity = _identity(obj)
        entry = records.setdefault(identity, {"object": obj, "occurrences": []})
        entry["occurrences"].append({
            "visible": bool(visible),
            "root": root_instance,
            "collections": tuple(collections),
            "instances": tuple(instances),
        })

    def walk_collection(
        collection,
        outer_visible,
        root_instance,
        collection_path,
        collection_ancestors,
        instance_ancestors,
        instance_path,
    ):
        identity = _identity(collection)
        if identity in collection_ancestors:
            raise RuntimeError(
                "collection hierarchy cycle while resolving instance source "
                f"{_name(collection, 'unnamed')!r}"
            )
        visible = outer_visible and not bool(
            getattr(collection, "hide_render", False),
        )
        path = (*collection_path, collection)
        next_collection_ancestors = collection_ancestors | {identity}
        for obj in getattr(collection, "objects", ()):
            object_visible = visible and not bool(getattr(obj, "hide_render", False))
            record(obj, object_visible, root_instance, path, instance_path)
            nested = _instance_collection(obj)
            if nested is None:
                continue
            nested_identity = _identity(nested)
            if nested_identity in instance_ancestors:
                raise RuntimeError(
                    "recursive Collection Instance while resolving web export: "
                    + " -> ".join(
                        [*(_name(item, "Instance") for item in instance_path),
                         _name(obj, "Instance")]
                    )
                )
            walk_collection(
                nested,
                object_visible,
                root_instance,
                (),
                frozenset(),
                instance_ancestors | {nested_identity},
                (*instance_path, obj),
            )
        for child in getattr(collection, "children", ()):
            walk_collection(
                child,
                visible,
                root_instance,
                path,
                next_collection_ancestors,
                instance_ancestors,
                instance_path,
            )

    for obj in getattr(scene, "objects", ()):
        source = _instance_collection(obj)
        if source is None:
            continue
        visibility = render_visibility(obj, scene, view_layer=view_layer)
        source_identity = _identity(source)
        walk_collection(
            source,
            visibility.exported,
            obj,
            (),
            frozenset(),
            frozenset({source_identity}),
            (obj,),
        )
    return records


def render_visible_instance_source_objects(scene, view_layer=None) -> tuple:
    """Return identity-deduplicated source objects with any visible occurrence."""
    records = collect_instance_source_occurrences(scene, view_layer=view_layer)
    visible = [
        entry["object"] for entry in records.values()
        if any(item["visible"] for item in entry["occurrences"])
    ]
    visible.sort(key=lambda obj: (_name(obj, "Object").casefold(), _identity(obj)))
    return tuple(visible)


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _custom_property(obj, key: str):
    missing = object()
    getter = getattr(obj, "get", None)
    if callable(getter):
        try:
            return getter(key, missing), missing
        except (ReferenceError, RuntimeError, TypeError):
            pass
    try:
        return obj[key], missing
    except (KeyError, ReferenceError, RuntimeError, TypeError):
        return missing, missing


def _has_effective_animation(value) -> bool:
    """Conservatively detect authored Action, driver, or enabled NLA data."""
    animation = getattr(value, "animation_data", None)
    if animation is None:
        return False
    if getattr(animation, "action", None) is not None:
        return True
    if tuple(getattr(animation, "drivers", ()) or ()):
        return True
    if not getattr(animation, "use_nla", True):
        return False
    tracks = [
        track for track in tuple(getattr(animation, "nla_tracks", ()) or ())
        if not getattr(track, "mute", False)
    ]
    solo = [track for track in tracks if getattr(track, "is_solo", False)]
    return any(
        not getattr(strip, "mute", False)
        for track in (solo or tracks)
        for strip in tuple(getattr(track, "strips", ()) or ())
    )


def _action_fcurves(action, slot=None):
    """Inspect one Action slot across Blender's legacy and layered layouts.

    The boolean result is false when a non-empty Action cannot be inspected.
    Callers can then remain conservative instead of assuming that an unknown
    animation representation changes only an engine-ignored property.
    """
    if action is None:
        return (), True
    try:
        legacy_curves = tuple(action.fcurves)
    except (AttributeError, RuntimeError):
        legacy_curves = ()
    if legacy_curves:
        return legacy_curves, True
    if not getattr(action, "is_action_layered", False):
        return legacy_curves, bool(getattr(action, "is_empty", not legacy_curves))

    action_slots = tuple(getattr(action, "slots", ()))
    selected_slots = (slot,) if slot is not None else action_slots
    curves = []
    seen = set()
    for layer in getattr(action, "layers", ()):
        if getattr(layer, "mute", False):
            continue
        for strip in getattr(layer, "strips", ()):
            for selected_slot in selected_slots:
                try:
                    channelbag = strip.channelbag(selected_slot)
                except (AttributeError, RuntimeError, TypeError):
                    continue
                if channelbag is None:
                    continue
                for curve in getattr(channelbag, "fcurves", ()):
                    try:
                        pointer = curve.as_pointer()
                    except (AttributeError, RuntimeError):
                        pointer = id(curve)
                    if pointer not in seen:
                        seen.add(pointer)
                        curves.append(curve)
    inspectable = bool(curves) or bool(getattr(action, "is_empty", False))
    return tuple(curves), inspectable


def _effective_nla_strips(animation):
    if animation is None or not getattr(animation, "use_nla", True):
        return ()
    tracks = [
        track for track in tuple(getattr(animation, "nla_tracks", ()) or ())
        if not getattr(track, "mute", False)
    ]
    solo = [track for track in tracks if getattr(track, "is_solo", False)]
    return tuple(
        strip
        for track in (solo or tracks)
        for strip in tuple(getattr(track, "strips", ()) or ())
        if not getattr(strip, "mute", False)
    )


def _effective_animation_curves(value):
    """Return effective curves plus whether every Action was inspectable."""
    animation = getattr(value, "animation_data", None)
    if animation is None:
        return (), True
    curves = []
    action = getattr(animation, "action", None)
    if action is not None:
        action_curves, inspectable = _action_fcurves(
            action, getattr(animation, "action_slot", None),
        )
        if not inspectable:
            return (), False
        curves.extend(action_curves)
    for strip in _effective_nla_strips(animation):
        strip_action = getattr(strip, "action", None)
        if strip_action is None:
            return (), False
        action_curves, inspectable = _action_fcurves(
            strip_action, getattr(strip, "action_slot", None),
        )
        if not inspectable:
            return (), False
        curves.extend(action_curves)
    curves.extend(tuple(getattr(animation, "drivers", ()) or ()))
    return tuple(curves), True


def _animation_changes_only_paths(value, ignored_paths: frozenset[str]) -> bool:
    """Prove that every effective animation curve targets an ignored path."""
    curves, inspectable = _effective_animation_curves(value)
    if not inspectable:
        return False
    return bool(curves) and all(
        str(getattr(curve, "data_path", "")) in ignored_paths
        for curve in curves
    )


def _animation_may_change_paths(value, relevant_paths: frozenset[str]) -> bool:
    """Conservatively detect animation of descriptor-relevant properties."""
    if not _has_effective_animation(value):
        return False
    curves, inspectable = _effective_animation_curves(value)
    if not inspectable:
        return True
    return any(
        str(getattr(curve, "data_path", "")) in relevant_paths
        for curve in curves
    )


def _animated_transform_source(obj) -> str | None:
    """Name an animated object/parent transform source, without importing bpy."""
    seen = set()
    current = obj
    while current is not None:
        identity = _identity(current)
        if identity in seen:
            return _name(current, "Object") + " (parent cycle)"
        seen.add(identity)
        if _has_effective_animation(current):
            return _name(current, "Object")
        current = getattr(current, "parent", None)
    return None


def _matrix_component(matrix, row: int, column: int) -> float | None:
    try:
        return _number(matrix[row][column])
    except (AttributeError, IndexError, KeyError, TypeError):
        pass
    try:
        return _number(matrix.col[column][row])
    except (AttributeError, IndexError, KeyError, TypeError):
        return None


def _local_transform_issue(obj) -> RectAreaLightIssue | None:
    """Refuse source-local shear that glTF's required TRS cannot preserve."""
    matrix = getattr(obj, "matrix_local", None)
    if matrix is None:
        return None
    values = [
        _matrix_component(matrix, row, column)
        for row in range(3)
        for column in range(3)
    ]
    if any(value is None or not isfinite(value) for value in values):
        return RectAreaLightIssue(
            "rect-area-local-transform-non-finite",
            "The light's local transform contains a missing, NaN, or infinite "
            "value and cannot be serialized as a glTF node transform.",
        )
    rows = [values[index:index + 3] for index in range(0, 9, 3)]
    axes = tuple(
        (rows[0][column], rows[1][column], rows[2][column])
        for column in range(3)
    )
    lengths = tuple(
        sqrt(sum(component * component for component in axis))
        for axis in axes
    )
    if any(length <= _EPSILON for length in lengths):
        return RectAreaLightIssue(
            "rect-area-local-transform-singular",
            "The light's local transform has a zero or near-zero axis and "
            "cannot be serialized as a stable glTF TRS node.",
        )
    sheared_pairs = []
    for first, second, label in ((0, 1, "X/Y"), (0, 2, "X/Z"), (1, 2, "Y/Z")):
        normalized_dot = sum(
            axes[first][index] * axes[second][index]
            for index in range(3)
        ) / (lengths[first] * lengths[second])
        if abs(normalized_dot) > 1e-5:
            sheared_pairs.append(label)
    if sheared_pairs:
        return RectAreaLightIssue(
            "rect-area-local-transform-sheared",
            "The light's local " + ", ".join(sheared_pairs) +
            " axes are sheared. glTF nodes must be decomposable to translation, "
            "rotation, and scale, so apply or remove local shear before publishing.",
        )
    return None


def _transform_issue(obj) -> RectAreaLightIssue | None:
    local_issue = _local_transform_issue(obj)
    if local_issue is not None:
        return local_issue
    matrix = getattr(obj, "matrix_world", None)
    if matrix is None:
        return RectAreaLightIssue(
            "rect-area-transform-unavailable",
            "The light has no readable world transform, so Blendlink cannot "
            "validate its rectangular source plane.",
        )
    values = [
        _matrix_component(matrix, row, column)
        for row in range(3)
        for column in range(3)
    ]
    if any(value is None or not isfinite(value) for value in values):
        return RectAreaLightIssue(
            "rect-area-transform-non-finite",
            "The light transform contains a missing, NaN, or infinite value.",
        )
    rows = [values[index:index + 3] for index in range(0, 9, 3)]
    x_axis = (rows[0][0], rows[1][0], rows[2][0])
    y_axis = (rows[0][1], rows[1][1], rows[2][1])
    z_axis = (rows[0][2], rows[1][2], rows[2][2])
    lengths = tuple(sqrt(sum(component * component for component in axis))
                    for axis in (x_axis, y_axis, z_axis))
    if any(length <= _EPSILON for length in lengths):
        return RectAreaLightIssue(
            "rect-area-transform-singular",
            "The light transform has a zero or near-zero axis; use positive, "
            "non-zero object and parent scales.",
        )
    normalized_xy_dot = sum(
        x_axis[index] * y_axis[index] for index in range(3)
    ) / (lengths[0] * lengths[1])
    if abs(normalized_xy_dot) > 1e-5:
        return RectAreaLightIssue(
            "rect-area-transform-sheared",
            "The light's world X and Y axes are sheared. Apply or remove the "
            "shear so the emitted rectangle remains orthogonal.",
        )
    determinant = (
        rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
        - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
        + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0])
    )
    if not isfinite(determinant) or determinant <= 0.0:
        return RectAreaLightIssue(
            "rect-area-transform-reflected",
            "The light transform is reflected or singular. RectArea publication "
            "requires a positive world-transform determinant.",
        )
    return None


def _world_axis_lengths(obj) -> tuple[float, float, float] | None:
    """Return world X/Y/Z scale magnitudes after transform validation."""
    matrix = getattr(obj, "matrix_world", None)
    if matrix is None:
        return None
    values = [
        _matrix_component(matrix, row, column)
        for row in range(3)
        for column in range(3)
    ]
    if any(value is None or not isfinite(value) for value in values):
        return None
    rows = [values[index:index + 3] for index in range(0, 9, 3)]
    axes = tuple(
        (rows[0][column], rows[1][column], rows[2][column])
        for column in range(3)
    )
    lengths = tuple(
        sqrt(sum(component * component for component in axis))
        for axis in axes
    )
    return lengths if all(length > _EPSILON for length in lengths) else None


def _finite_vector(value, length: int, *, label: str, positive: bool = False):
    try:
        items = tuple(value)
    except TypeError:
        items = ()
    if len(items) != length:
        raise ValueError(f"{label} must contain exactly {length} numbers")
    numbers = tuple(_number(item) for item in items)
    if any(item is None or not isfinite(item) for item in numbers):
        raise ValueError(f"{label} must contain only finite numbers")
    if positive and any(item <= 0.0 for item in numbers):
        raise ValueError(f"{label} must contain only positive numbers")
    if not positive and any(item < 0.0 for item in numbers):
        raise ValueError(f"{label} must contain only non-negative numbers")
    return numbers


def parse_rect_area_light_descriptor(payload) -> RectAreaLightDescriptor:
    """Validate an authored/finalized v1 node-extra payload.

    Unknown fields are additive within v1. Unknown schema versions, malformed
    dimensions, or ambiguous strength forms are refused loudly.
    """
    if not isinstance(payload, Mapping):
        raise ValueError("blendlink_rect_area_light must be an object")
    version = payload.get("schemaVersion")
    if isinstance(version, bool) or not isinstance(version, int) \
            or version != RECT_AREA_LIGHT_SCHEMA_VERSION:
        raise ValueError(
            "blendlink_rect_area_light schemaVersion must be exactly 1; "
            f"received {version!r}"
        )
    color = _finite_vector(payload.get("color"), 3, label="color")
    size = _finite_vector(payload.get("size"), 2, label="size", positive=True)
    has_power = "power" in payload
    has_intensity = "intensity" in payload
    if has_power == has_intensity:
        raise ValueError(
            "blendlink_rect_area_light must contain exactly one of power or intensity"
        )
    strength_name = "power" if has_power else "intensity"
    strength = _number(payload.get(strength_name))
    if strength is None or not isfinite(strength) or strength < 0.0:
        raise ValueError(f"{strength_name} must be a finite non-negative number")
    return RectAreaLightDescriptor(
        color=color,
        size=size,
        power=strength if has_power else None,
        intensity=strength if has_intensity else None,
    )


def _render_engine(scene) -> str:
    render = getattr(scene, "render", None)
    return str(getattr(render, "engine", "") or "").upper()


def _input(node, name: str):
    inputs = getattr(node, "inputs", None)
    get = getattr(inputs, "get", None)
    return get(name) if callable(get) else None


def _upstream_node(socket, wanted_type: str, visited=None):
    """Small bpy-free mirror of the exporter node search for light graphs."""
    if socket is None:
        return None
    visited = set() if visited is None else visited
    for link in getattr(socket, "links", ()):
        node = getattr(link, "from_node", None)
        if node is None or id(node) in visited:
            continue
        visited.add(id(node))
        if str(getattr(node, "type", "")).upper() == wanted_type:
            return node
        for candidate in getattr(node, "inputs", ()):
            found = _upstream_node(candidate, wanted_type, visited)
            if found is not None:
                return found
    return None


def _cycles_emission_node(data):
    tree = getattr(data, "node_tree", None)
    for node in getattr(tree, "nodes", ()):
        if str(getattr(node, "type", "")).upper() != "OUTPUT_LIGHT":
            continue
        if getattr(node, "is_active_output", True) is False:
            continue
        emission = _upstream_node(_input(node, "Surface"), "EMISSION")
        if emission is not None:
            return emission
    return None


def _node_owned_intensity(data, scene, light_type: str) -> bool:
    """Mirror Blender 5.2's actual glTF intensity branch.

    Eevee ignores light nodes. Cycles Sun uses Emission Strength, while Cycles
    Point/Spot still use ``data.energy`` unless a Light Falloff node is
    connected upstream of Emission Strength. A default node tree therefore
    remains exactly predictable for ordinary Point/Spot lights.
    """
    if _render_engine(scene) in _EEVEE_ENGINES:
        return False
    emission = _cycles_emission_node(data)
    if emission is None:
        return False
    if light_type == "SUN":
        return True
    if light_type in {"POINT", "SPOT"}:
        return _upstream_node(_input(emission, "Strength"), "LIGHT_FALLOFF") is not None
    return False


def _linked_emission_color(data, scene) -> bool:
    if _render_engine(scene) in _EEVEE_ENGINES:
        return False
    emission = _cycles_emission_node(data)
    color = _input(emission, "Color") if emission is not None else None
    return bool(getattr(color, "is_linked", False))


def _linked_emission_strength_without_falloff(data, scene, light_type: str) -> bool:
    if _render_engine(scene) in _EEVEE_ENGINES or light_type not in {"POINT", "SPOT"}:
        return False
    emission = _cycles_emission_node(data)
    strength = _input(emission, "Strength") if emission is not None else None
    return bool(getattr(strength, "is_linked", False)) \
        and _upstream_node(strength, "LIGHT_FALLOFF") is None


def _indirect_emission_surface(data, scene) -> bool:
    if _render_engine(scene) in _EEVEE_ENGINES:
        return False
    tree = getattr(data, "node_tree", None)
    for node in getattr(tree, "nodes", ()):
        if str(getattr(node, "type", "")).upper() != "OUTPUT_LIGHT" \
                or getattr(node, "is_active_output", True) is False:
            continue
        surface = _input(node, "Surface")
        if _upstream_node(surface, "EMISSION") is None:
            continue
        links = tuple(getattr(surface, "links", ()))
        return not links or str(
            getattr(getattr(links[0], "from_node", None), "type", ""),
        ).upper() != "EMISSION"
    return False


def _cycles_group_boundary(data, scene) -> bool:
    """Whether the active Cycles light surface crosses a node-group boundary.

    Blender's glTF exporter descends ShaderNodeGroup trees. This small canonical
    diagnostic walker intentionally does not guess group interface routing, so
    crossing that boundary must suppress numeric promises rather than falling
    back to the unrelated light data-block Energy.
    """
    if _render_engine(scene) in _EEVEE_ENGINES:
        return False
    tree = getattr(data, "node_tree", None)
    for node in getattr(tree, "nodes", ()):
        if str(getattr(node, "type", "")).upper() != "OUTPUT_LIGHT" \
                or getattr(node, "is_active_output", True) is False:
            continue
        if _upstream_node(_input(node, "Surface"), "GROUP") is not None:
            return True
    return False


def _expected_output(obj, data, scene, light_type: str, energy: float | None):
    if energy is None:
        return None, None
    # Blender's exporter can follow a Cycles light-node strength/falloff path
    # instead of data.energy. Do not claim an exact numeric prediction when
    # that authored graph owns the value.
    if _cycles_group_boundary(data, scene) \
            or _node_owned_intensity(data, scene, light_type):
        return None, None
    effective_energy = energy
    if getattr(data, "normalize", True) is False:
        area = getattr(data, "area", None)
        if not callable(area):
            return None, None
        try:
            effective_energy *= float(area(matrix_world=getattr(obj, "matrix_world", None)))
        except (ReferenceError, RuntimeError, TypeError, ValueError):
            return None, None
    exposure = _number(getattr(data, "exposure", None))
    effective_energy *= 2.0 ** (exposure or 0.0)
    if light_type == "POINT":
        intensity = effective_energy / (4.0 * pi)
        # Three PointLight.power = intensity * 4pi.
        return intensity, intensity * 4.0 * pi
    if light_type == "SPOT":
        intensity = effective_energy / (4.0 * pi)
        # Three SpotLight.power = intensity * pi. Blender's COMPAT exporter
        # still treats spot energy as if it came from an omnidirectional point,
        # so the Three power readout is one quarter of the effective energy.
        return intensity, intensity * pi
    if light_type == "SUN":
        return effective_energy, None
    return None, None


def _rna_default(data, attribute: str, fallback):
    properties = getattr(getattr(data, "bl_rna", None), "properties", None)
    if properties is not None:
        try:
            prop = properties[attribute]
        except (KeyError, TypeError):
            prop = None
        if prop is not None and hasattr(prop, "default"):
            return prop.default
    return fallback


def _changed_from_default(data, attribute: str, fallback) -> bool:
    if not hasattr(data, attribute):
        return False
    value = getattr(data, attribute)
    default = _rna_default(data, attribute, fallback)
    numeric_value = _number(value)
    numeric_default = _number(default)
    if numeric_value is not None and numeric_default is not None:
        return abs(numeric_value - numeric_default) > _EPSILON
    return value != default


def _approximation_reasons(obj, data, scene, light_type: str) -> tuple[str, ...]:
    reasons = []
    if light_type in {"POINT", "SPOT"}:
        radius = _number(getattr(data, "shadow_soft_size", None))
        if radius is not None and radius > _EPSILON:
            soft_falloff = getattr(data, "use_soft_falloff", None)
            if isinstance(soft_falloff, bool):
                emitter_controls = (
                    f"Blender's {radius:g} m emitter radius and its Soft Falloff "
                    f"{'On' if soft_falloff else 'Off'} setting have"
                )
            else:
                emitter_controls = f"Blender's {radius:g} m emitter radius has"
            reasons.append(
                emitter_controls + " no direct glTF representation; "
                "the website uses a mathematical point and its shadow recipe."
            )
    elif light_type == "SUN":
        angle = _number(getattr(data, "angle", None))
        if angle is not None and angle > _EPSILON:
            reasons.append(
                f"Blender's {angle:g} rad sun angle has no glTF light field; "
                "the website uses a directional light and its shadow recipe."
            )

    contribution_fields = (
        ("diffuse_factor", "Diffuse"),
        ("specular_factor", "Specular"),
        ("transmission_factor", "Transmission"),
        ("volume_factor", "Volume"),
    )
    changed_contributions = []
    for attribute, label in contribution_fields:
        value = _number(getattr(data, attribute, None))
        if value is not None and abs(value - 1.0) > _EPSILON:
            changed_contributions.append(f"{label} {value:g}")
    if changed_contributions:
        reasons.append(
            "Blender contribution controls (" + ", ".join(changed_contributions) +
            ") are not represented by KHR_lights_punctual."
        )

    # Blendlink post-processes native ``use_shadow=False`` into the namespaced
    # ``blendlink_cast_shadow=False`` node extra (an explicit object extra wins),
    # so the ordinary Blender switch is portable even though core glTF has no
    # shadow field. Blender-only tuning matters only while native shadows are on.
    if getattr(data, "use_shadow", True) is not False:
        changed_shadow_controls = []
        shadow_labels = (
            ("shadow_buffer_clip_start", "Clip Start"),
            ("shadow_filter_radius", "Filter Radius"),
            ("shadow_maximum_resolution", "Maximum Resolution"),
        )
        for attribute, label in shadow_labels:
            fallback = _SHADOW_CONTROL_DEFAULTS[attribute]
            if _changed_from_default(data, attribute, fallback):
                value = _number(getattr(data, attribute, None))
                changed_shadow_controls.append(
                    f"{label} {value:g}" if value is not None else label
                )
        if _changed_from_default(data, "use_shadow_jitter", False):
            changed_shadow_controls.append(
                "Jitter On" if getattr(data, "use_shadow_jitter", False) else "Jitter Off"
            )
        if changed_shadow_controls:
            reasons.append(
                "Blender shadow tuning (" + ", ".join(changed_shadow_controls) +
                ") is not represented by KHR_lights_punctual; the website's "
                "shadow preset owns shadow maps and filtering."
            )

    linking = getattr(obj, "light_linking", None)
    receiver_collection = getattr(linking, "receiver_collection", None)
    if receiver_collection is not None:
        reasons.append(
            f'Blender Light Linking collection "{_name(receiver_collection, "unnamed")}" '
            "has no portable glTF/Three.js field; the website light reaches all "
            "eligible realtime receivers unless application code recreates that relationship."
        )
    blocker_collection = getattr(linking, "blocker_collection", None)
    if blocker_collection is not None:
        reasons.append(
            f'Blender Shadow Linking collection "{_name(blocker_collection, "unnamed")}" '
            "has no portable glTF/Three.js field; website blockers follow the "
            "published mesh and shadow recipe instead."
        )

    if _node_owned_intensity(data, scene, light_type):
        reasons.append(
            "The Cycles light graph owns exported intensity through "
            + ("Emission Strength" if light_type == "SUN" else "Light Falloff")
            + "; Blendlink cannot predict it from the light data-block Energy."
        )
    if _linked_emission_color(data, scene):
        reasons.append(
            "The Cycles Emission Color input is linked; the stock glTF exporter "
            "flattens its socket value instead of running that procedural graph "
            "on the website."
        )
    if _linked_emission_strength_without_falloff(data, scene, light_type):
        reasons.append(
            "The Cycles Emission Strength input is linked without a Light "
            "Falloff node; Blender's stock glTF exporter ignores that procedural "
            "strength and falls back to the light data-block Energy."
        )
    if _indirect_emission_surface(data, scene):
        reasons.append(
            "The active Light Output reaches Emission through an intermediate "
            "shader graph; the stock glTF exporter flattens the Emission socket "
            "values instead of reproducing that graph."
        )
    if _cycles_group_boundary(data, scene):
        reasons.append(
            "The active Cycles light surface crosses a Shader Node Group; "
            "Blender's exporter evaluates that group, but Blendlink cannot "
            "predict its website intensity from the outer light data-block."
        )
    return tuple(reasons)


def _rect_area_effective_color(data, scene):
    refusals = []
    try:
        color = _finite_vector(getattr(data, "color", None), 3, label="light color")
    except ValueError as error:
        return None, (RectAreaLightIssue("rect-area-color-invalid", str(error)),)

    engine = _render_engine(scene)
    if engine not in _EEVEE_ENGINES and engine != "CYCLES":
        return None, (RectAreaLightIssue(
            "rect-area-render-engine-unsupported",
            f"Render engine {engine or 'UNKNOWN'} has no proven RectArea color policy; "
            "use Eevee or Cycles before publishing.",
        ),)

    emission_color = (1.0, 1.0, 1.0)
    if engine == "CYCLES":
        if _cycles_group_boundary(data, scene):
            refusals.append(RectAreaLightIssue(
                "rect-area-node-group-unresolved",
                "The active Cycles Light Output crosses a Shader Node Group, so "
                "Blendlink cannot prove one constant RectArea color and strength.",
            ))
        if _indirect_emission_surface(data, scene):
            refusals.append(RectAreaLightIssue(
                "rect-area-node-route-unresolved",
                "The active Cycles Light Output reaches Emission through an "
                "intermediate shader graph that cannot be compiled as one constant light.",
            ))
        emission = _cycles_emission_node(data)
        if emission is None and getattr(data, "use_nodes", False):
            refusals.append(RectAreaLightIssue(
                "rect-area-emission-missing",
                "The enabled Cycles light node tree has no supported active Emission route.",
            ))
        elif emission is not None:
            color_socket = _input(emission, "Color")
            if color_socket is None:
                refusals.append(RectAreaLightIssue(
                    "rect-area-emission-color-missing",
                    "The Cycles Emission node has no readable Color input.",
                ))
            elif getattr(color_socket, "is_linked", False):
                refusals.append(RectAreaLightIssue(
                    "rect-area-emission-color-linked",
                    "The Cycles Emission Color input is linked. Select a constant "
                    "color or keep this Area light bake-only.",
                ))
            else:
                try:
                    raw = tuple(getattr(color_socket, "default_value", ()))[:3]
                    emission_color = _finite_vector(
                        raw, 3, label="Emission Color",
                    )
                except ValueError as error:
                    refusals.append(RectAreaLightIssue(
                        "rect-area-emission-color-invalid", str(error),
                    ))
            strength_socket = _input(emission, "Strength")
            if strength_socket is None:
                refusals.append(RectAreaLightIssue(
                    "rect-area-emission-strength-missing",
                    "The Cycles Emission node has no readable Strength input.",
                ))
            elif getattr(strength_socket, "is_linked", False):
                refusals.append(RectAreaLightIssue(
                    "rect-area-emission-strength-linked",
                    "The Cycles Emission Strength input is linked. Blendlink cannot "
                    "compile that routed graph into a static RectArea descriptor.",
                ))
            else:
                emission_strength = _number(
                    getattr(strength_socket, "default_value", None),
                )
                if emission_strength is None or not isfinite(emission_strength) \
                        or emission_strength < 0.0:
                    refusals.append(RectAreaLightIssue(
                        "rect-area-emission-strength-invalid",
                        "The Cycles Emission Strength must be a finite "
                        "non-negative number.",
                    ))
                elif abs(emission_strength - 1.0) > _EPSILON:
                    refusals.append(RectAreaLightIssue(
                        "rect-area-emission-strength-nondefault",
                        f"Cycles Emission Strength is {emission_strength:g}. "
                        "Blendlink has not yet proven the exact Area-light "
                        "strength algebra beyond Blender's default value 1.",
                    ))

    temperature_color = (1.0, 1.0, 1.0)
    use_temperature = getattr(data, "use_temperature", False)
    if not isinstance(use_temperature, bool):
        refusals.append(RectAreaLightIssue(
            "rect-area-temperature-mode-invalid",
            "The light's Use Temperature value is not a boolean.",
        ))
    elif use_temperature:
        try:
            temperature_color = _finite_vector(
                getattr(data, "temperature_color", None), 3,
                label="temperature color",
            )
        except ValueError as error:
            refusals.append(RectAreaLightIssue(
                "rect-area-temperature-color-invalid", str(error),
            ))

    if refusals:
        return None, tuple(refusals)
    effective = tuple(
        color[index] * emission_color[index] * temperature_color[index]
        for index in range(3)
    )
    if any(not isfinite(value) or value < 0.0 for value in effective):
        return None, (RectAreaLightIssue(
            "rect-area-effective-color-invalid",
            "The composed light, Emission, and temperature color is not finite "
            "and non-negative.",
        ),)
    return effective, ()


def _eevee_setting(scene, name: str, default):
    settings = getattr(scene, "eevee", None)
    return getattr(settings, name, default) if settings is not None else default


def _eevee_direct_light_scale(scene) -> tuple[float | None, RectAreaLightIssue | None]:
    if _render_engine(scene) not in _EEVEE_ENGINES:
        return 1.0, None
    scale = _number(_eevee_setting(scene, "direct_light_intensity", 1.0))
    if scale is None or not isfinite(scale) or scale < 0.0:
        return None, RectAreaLightIssue(
            "rect-area-direct-light-intensity-invalid",
            "Eevee Direct Light intensity must be a finite non-negative number.",
        )
    return scale, None


def _rect_area_approximation_issues(obj, data, scene) -> tuple[RectAreaLightIssue, ...]:
    issues = [
        RectAreaLightIssue(
            "rect-area-pbr-only",
            "Three RectAreaLight affects MeshStandardMaterial and "
            "MeshPhysicalMaterial receivers only.",
        ),
        RectAreaLightIssue(
            "rect-area-indirect-volume-unsupported",
            "Three RectAreaLight does not reproduce Blender indirect bounce, "
            "volumetric contribution, or renderer sampling.",
        ),
    ]
    if getattr(data, "use_shadow", True) is not False:
        issues.append(RectAreaLightIssue(
            "rect-area-shadows-unsupported",
            "Three RectAreaLight does not cast shadows; use Point, Spot, or Sun "
            "when realtime shadows are required.",
        ))
    engine = _render_engine(scene)
    if engine in _EEVEE_ENGINES:
        issues.append(RectAreaLightIssue(
            "rect-area-eevee-ltc-horizon-approximation",
            "Eevee and Three use closely related LTC area-light fits but "
            "different horizon clipping and receiver-facing fades, so grazing "
            "angles and rough highlights can differ.",
        ))
    spread = _number(getattr(data, "spread", None))
    if engine not in _EEVEE_ENGINES \
            and spread is not None and abs(spread - pi) > _EPSILON:
        issues.append(RectAreaLightIssue(
            "rect-area-spread-unsupported",
            f"Blender Area spread {spread:g} rad is not reproduced; the website "
            "uses Three's one-sided rectangular emitter.",
        ))
    if engine in _EEVEE_ENGINES:
        custom_distance = getattr(data, "use_custom_distance", False)
        cutoff = _number(getattr(data, "cutoff_distance", None))
        if custom_distance is True:
            issues.append(RectAreaLightIssue(
                "rect-area-custom-distance-unsupported",
                "Eevee Custom Distance"
                + (f" {cutoff:g} m" if cutoff is not None and isfinite(cutoff) else "")
                + " is not reproduced; Three RectAreaLight continues with geometric falloff.",
            ))
        else:
            threshold = _number(_eevee_setting(scene, "light_threshold", 0.01))
            issues.append(RectAreaLightIssue(
                "rect-area-distance-cutoff-unsupported",
                "Eevee's finite influence fade"
                + (f" from Light Threshold {threshold:g}" if threshold is not None else "")
                + " is not reproduced; Three RectAreaLight continues with geometric falloff.",
            ))
        direct_clamp = _number(_eevee_setting(scene, "clamp_surface_direct", 0.0))
        if direct_clamp is not None and direct_clamp > _EPSILON:
            issues.append(RectAreaLightIssue(
                "rect-area-direct-clamp-unsupported",
                f"Eevee Surface Direct Light clamp {direct_clamp:g} is nonlinear and "
                "cannot be represented by Three RectAreaLight strength.",
            ))
    contribution_fields = (
        ("diffuse_factor", "Diffuse"),
        ("specular_factor", "Specular"),
    )
    changed = []
    for attribute, label in contribution_fields:
        value = _number(getattr(data, attribute, None))
        if value is not None and abs(value - 1.0) > _EPSILON:
            changed.append(f"{label} {value:g}")
    closure_powers = []
    for attribute, label in (
        ("transmission_factor", "Transmission"),
        ("volume_factor", "Volume"),
    ):
        value = _number(getattr(data, attribute, None))
        if value is None:
            continue
        if value > _EPSILON:
            closure_powers.append(f"{label} {value:g}")
        # Zero agrees with Three's absent closure path; one is Blender's
        # default and stays an explicitly named approximation. Intermediate
        # authored powers carry additional intent and therefore trigger Auto's
        # conservative bake-only fallback.
        if abs(value) > _EPSILON and abs(value - 1.0) > _EPSILON:
            changed.append(f"{label} {value:g}")
    if changed:
        issues.append(RectAreaLightIssue(
            "rect-area-contributions-unsupported",
            "Blender contribution controls (" + ", ".join(changed) +
            ") are not represented by Three RectAreaLight.",
        ))
    if closure_powers:
        issues.append(RectAreaLightIssue(
            "rect-area-direct-transmission-volume-unsupported",
            "Three's native RectArea path does not reproduce Blender direct "
            "closure lighting for " + ", ".join(closure_powers) + ". Its "
            "supported PBR receivers use direct diffuse, specular, and "
            "clearcoat terms.",
        ))
    linking = getattr(obj, "light_linking", None)
    receiver_collection = getattr(linking, "receiver_collection", None)
    if receiver_collection is not None:
        issues.append(RectAreaLightIssue(
            "rect-area-light-linking-unsupported",
            f'Blender Light Linking collection "{_name(receiver_collection, "unnamed")}" '
            "is not reproduced; the web light reaches every eligible PBR receiver.",
        ))
    blocker_collection = getattr(linking, "blocker_collection", None)
    if blocker_collection is not None:
        issues.append(RectAreaLightIssue(
            "rect-area-shadow-linking-unsupported",
            f'Blender Shadow Linking collection "{_name(blocker_collection, "unnamed")}" '
            "is not reproduced by the shadowless web light.",
        ))
    return tuple(issues)


def _rect_area_auto_fallbacks(
        issues: tuple[RectAreaLightIssue, ...]) -> tuple[RectAreaLightIssue, ...]:
    """Semantics too intentional to approximate without an artist override.

    Default Eevee shadows and finite threshold remain named approximations: a
    shadowless direct light on live PBR receivers is useful alongside baked
    static Appearance. Explicit masks, non-default diffuse/specular or
    intermediate closure powers, custom cutoff, clamp, or Cycles spread can
    illuminate the wrong receivers or energy domains, so Automatic keeps
    those lights bake-only.
    """
    blocking_codes = {
        "rect-area-spread-unsupported",
        "rect-area-contributions-unsupported",
        "rect-area-light-linking-unsupported",
        "rect-area-shadow-linking-unsupported",
        "rect-area-custom-distance-unsupported",
        "rect-area-direct-clamp-unsupported",
    }
    return tuple(issue for issue in issues if issue.code in blocking_codes)


def plan_rect_area_light(obj, scene) -> RectAreaLightPlan:
    """Compile one Area light into an automatic or authored web plan.

    Missing metadata selects the supported native-Three subset. Artists can
    explicitly keep a source bake-only or force the diagnosed RectArea
    approximation. Invalid explicit choices never fall back silently.
    """
    object_name = _name(obj, "Light")
    data = getattr(obj, "data", None)
    light_type = str(getattr(data, "type", "UNKNOWN")).upper()
    authored_mode, missing = _custom_property(obj, AREA_LIGHT_MODE_PROPERTY)
    if authored_mode is missing:
        if light_type != "AREA":
            return RectAreaLightPlan(object_name, AREA_LIGHT_MODE_BAKE_ONLY)
        mode = AREA_LIGHT_MODE_AUTO
    elif authored_mode == AREA_LIGHT_MODE_AUTO:
        mode = AREA_LIGHT_MODE_AUTO
    elif authored_mode == AREA_LIGHT_MODE_BAKE_ONLY:
        mode = AREA_LIGHT_MODE_BAKE_ONLY
    elif authored_mode == AREA_LIGHT_MODE_THREE_RECT:
        mode = AREA_LIGHT_MODE_THREE_RECT
    else:
        return RectAreaLightPlan(
            object_name,
            str(authored_mode),
            refusals=(RectAreaLightIssue(
                "rect-area-mode-invalid",
                f'{AREA_LIGHT_MODE_PROPERTY} on "{object_name}" must be '
                f'{AREA_LIGHT_MODE_AUTO!r}, {AREA_LIGHT_MODE_BAKE_ONLY!r}, or '
                f'{AREA_LIGHT_MODE_THREE_RECT!r}; remove the property for the '
                "preferred Automatic representation.",
            ),),
        )

    if light_type != "AREA":
        return RectAreaLightPlan(
            object_name,
            mode,
            refusals=(RectAreaLightIssue(
                "rect-area-source-type-invalid",
                f'"{object_name}" is {light_type}, but three-rect-area is valid '
                "only for Blender Area lights.",
            ),),
        )
    if mode == AREA_LIGHT_MODE_BAKE_ONLY:
        return RectAreaLightPlan(object_name, AREA_LIGHT_MODE_BAKE_ONLY)

    refusals = []
    engine = _render_engine(scene)
    data_animated = _has_effective_animation(data)
    if engine in _EEVEE_ENGINES and data_animated:
        # Pinned Eevee does not consume Area Spread or light node graphs. Only
        # relax the static-descriptor gate when every effective curve can be
        # inspected and targets one of those engine-ignored data paths.
        data_animated = not _animation_changes_only_paths(
            data, frozenset({"spread", "use_nodes"}),
        )
    node_tree_animated = (
        engine not in _EEVEE_ENGINES
        and _has_effective_animation(getattr(data, "node_tree", None))
    )
    if data_animated or node_tree_animated:
        refusals.append(RectAreaLightIssue(
            "rect-area-source-animated",
            "Light color, energy, exposure, size, shape, or temperature"
            + (" and active Cycles node values" if node_tree_animated else "")
            + " are animated. V1 publishes a static descriptor, so freeze "
              "those values or keep the light bake-only.",
        ))
    if engine in _EEVEE_ENGINES and _animation_may_change_paths(
        scene, frozenset({"eevee.direct_light_intensity"}),
    ):
        refusals.append(RectAreaLightIssue(
            "rect-area-scene-direct-light-animated",
            "Eevee Direct Light intensity is animated on the Scene. V1 folds "
            "only the current value into a static RectArea descriptor; freeze "
            "that setting or keep the light bake-only.",
        ))
    transform_source = _animated_transform_source(obj)
    if transform_source is not None:
        refusals.append(RectAreaLightIssue(
            "rect-area-transform-animation-pending",
            f'Object transform animation from "{transform_source}" is not yet '
            "covered by the finalized-node conformance fixture. Freeze it before "
            "opting in.",
        ))
    transform_issue = _transform_issue(obj)
    if transform_issue is not None:
        refusals.append(transform_issue)

    shape = str(getattr(data, "shape", "UNKNOWN")).upper()
    if shape not in {"SQUARE", "RECTANGLE"}:
        refusals.append(RectAreaLightIssue(
            "rect-area-shape-unsupported",
            f"Area shape {shape} cannot be represented exactly by a rectangle; "
            "use Square/Rectangle or keep this light bake-only.",
        ))
        size = None
    else:
        width = _number(getattr(data, "size", None))
        height = width if shape == "SQUARE" else _number(getattr(data, "size_y", None))
        if width is None or height is None or not isfinite(width) \
                or not isfinite(height) or width <= 0.0 or height <= 0.0:
            refusals.append(RectAreaLightIssue(
                "rect-area-size-invalid",
                "Area width and height must be finite positive local dimensions.",
            ))
            size = None
        else:
            size = (width, height)

    if engine in _EEVEE_ENGINES and size is not None and transform_issue is None:
        world_scale = _world_axis_lengths(obj)
        if world_scale is not None:
            half_width = size[0] * world_scale[0] * 0.5
            half_height = size[1] * world_scale[1] * 0.5
            if (
                half_width * half_height
                < _EEVEE_MIN_AREA_HALF_EXTENT_PRODUCT
            ):
                refusals.append(RectAreaLightIssue(
                    "rect-area-eevee-micro-cull-unsupported",
                    "Eevee culls this Area light because its scaled half-extent "
                    f"product is {half_width * half_height:g}, below "
                    f"{_EEVEE_MIN_AREA_HALF_EXTENT_PRODUCT:g}. Three RectAreaLight "
                    "would continue illuminating receivers.",
                ))
            elif (
                half_width < _EEVEE_MIN_AREA_HALF_EXTENT
                or half_height < _EEVEE_MIN_AREA_HALF_EXTENT
            ):
                refusals.append(RectAreaLightIssue(
                    "rect-area-eevee-micro-clamp-unsupported",
                    "Eevee clamps each scaled Area half extent to at least "
                    f"{_EEVEE_MIN_AREA_HALF_EXTENT:g} m for shading, but Three "
                    f"would use {half_width:g} x {half_height:g} m exactly.",
                ))

    energy = _number(getattr(data, "energy", None))
    exposure = _number(getattr(data, "exposure", None))
    direct_scale, direct_scale_issue = _eevee_direct_light_scale(scene)
    if direct_scale_issue is not None:
        refusals.append(direct_scale_issue)
    if energy is None or not isfinite(energy) or energy < 0.0:
        refusals.append(RectAreaLightIssue(
            "rect-area-energy-invalid",
            "Area energy must be a finite non-negative number.",
        ))
        effective_strength = None
    elif exposure is None or not isfinite(exposure):
        refusals.append(RectAreaLightIssue(
            "rect-area-exposure-invalid",
            "Area exposure must be a finite number.",
        ))
        effective_strength = None
    elif direct_scale is None:
        effective_strength = None
    else:
        try:
            effective_strength = energy * (2.0 ** exposure) * direct_scale
        except OverflowError:
            effective_strength = None
        if effective_strength is None or not isfinite(effective_strength):
            refusals.append(RectAreaLightIssue(
                "rect-area-strength-invalid",
                "Area energy multiplied by 2 ** exposure and the active "
                "Eevee Direct Light scale is not finite.",
            ))
            effective_strength = None

    normalize = getattr(data, "normalize", None)
    if not isinstance(normalize, bool):
        refusals.append(RectAreaLightIssue(
            "rect-area-normalize-invalid",
            "Area Normalize must be a boolean so Blendlink can choose exactly "
            "one power or intensity strength form.",
        ))

    for attribute, label in (
        ("spread", "Area spread"),
        ("diffuse_factor", "Diffuse contribution"),
        ("specular_factor", "Specular contribution"),
        ("transmission_factor", "Transmission contribution"),
        ("volume_factor", "Volume contribution"),
    ):
        if not hasattr(data, attribute):
            continue
        value = _number(getattr(data, attribute))
        if value is None or not isfinite(value):
            refusals.append(RectAreaLightIssue(
                "rect-area-control-invalid",
                f"{label} must be a finite number.",
            ))

    color, color_refusals = _rect_area_effective_color(data, scene)
    refusals.extend(color_refusals)
    approximations = _rect_area_approximation_issues(obj, data, scene)
    if refusals:
        if mode == AREA_LIGHT_MODE_AUTO:
            return RectAreaLightPlan(
                object_name,
                mode,
                approximations=approximations,
                fallbacks=tuple(refusals),
            )
        return RectAreaLightPlan(
            object_name,
            mode,
            refusals=tuple(refusals),
            approximations=approximations,
        )

    automatic_fallbacks = _rect_area_auto_fallbacks(approximations)
    if mode == AREA_LIGHT_MODE_AUTO and automatic_fallbacks:
        return RectAreaLightPlan(
            object_name,
            mode,
            approximations=approximations,
            fallbacks=automatic_fallbacks,
        )

    descriptor = RectAreaLightDescriptor(
        color=color,
        size=size,
        power=effective_strength if normalize else None,
        intensity=(effective_strength / pi) if not normalize else None,
    )
    # Keep schema validation on the producing path too; later final-GLB code
    # can use the same parser for pre-existing/conflicting extras.
    descriptor = parse_rect_area_light_descriptor(descriptor.as_dict())
    return RectAreaLightPlan(
        object_name,
        mode,
        descriptor=descriptor,
        approximations=approximations,
    )


def _diagnose_light(
    obj,
    scene,
    published_object_names: frozenset[str] | None = None,
    published_source_identities: frozenset[int] = frozenset(),
    published_rect_area_identities: frozenset[int] | None = None,
    view_layer=None,
    instance_source_identities: frozenset[int] = frozenset(),
    rect_area_artifact_fallback: RectAreaLightIssue | None = None,
) -> tuple[LightDiagnostic, LightWarning | None]:
    belongs_to_scene = _object_in_scene(obj, scene)
    object_identity = _identity(obj)
    confirmed_rect_area_source = (
        published_rect_area_identities is not None
        and object_identity in published_rect_area_identities
    )
    confirmed_published_source = (
        object_identity in published_source_identities
        or confirmed_rect_area_source
    )
    confirmed_instance_source = object_identity in instance_source_identities
    if not belongs_to_scene and (
        confirmed_published_source or confirmed_instance_source
    ):
        visibility = RenderVisibility(
            True,
            "collectionInstance",
            (
                f'"{_name(obj, "Light")}" publishes through a collection instance '
                "in the finished web scene."
            ),
        )
    else:
        visibility = render_visibility(obj, scene, view_layer=view_layer)
    data = getattr(obj, "data", None)
    object_name = _name(obj, "Light")
    data_name = _name(data, object_name)
    light_type = str(getattr(data, "type", "UNKNOWN")).upper()
    energy = _number(getattr(data, "energy", None))
    exposure = _number(getattr(data, "exposure", None))
    rect_area_plan = plan_rect_area_light(obj, scene)
    if rect_area_plan.refusals:
        detail = " ".join(issue.detail for issue in rect_area_plan.refusals)
        diagnostic = LightDiagnostic(
            object_name, data_name, light_type, None, STATUS_NOT_EXPORTED,
            visibility, detail,
            tuple(issue.detail for issue in rect_area_plan.refusals),
            source_energy=energy, source_exposure=exposure,
            outcome=OUTCOME_NOT_PUBLISHED,
            remedy=(
                "Correct the named RectArea source problems, choose Automatic "
                f"by removing {AREA_LIGHT_MODE_PROPERTY}, choose Bake Only, or "
                "use a Point, Spot, or Sun light for portable realtime lighting."
            ),
        )
        return diagnostic, LightWarning(
            "rect-area-light-refused",
            f'Web Light "{object_name}" RectArea opt-in refused: {detail}',
            object_name,
            severity="ERROR",
            blocking=True,
        )
    if (
        visibility.exported
        and rect_area_plan.mode == AREA_LIGHT_MODE_AUTO
        and rect_area_artifact_fallback is not None
    ):
        detail = (
            "Automatic Website Area Light kept this source bake-only in the "
            "finished artifact because " + rect_area_artifact_fallback.detail
        )
        diagnostic = LightDiagnostic(
            object_name, data_name, light_type, None, STATUS_NOT_EXPORTED,
            visibility, detail, (rect_area_artifact_fallback.detail,),
            source_energy=energy, source_exposure=exposure,
            outcome=OUTCOME_BAKE_ONLY,
            remedy=(
                "Leave Automatic to preserve a safe bake-only result, simplify "
                "the named export structure, or choose Three Rect Area when a "
                "missing realtime light should block publication."
            ),
        )
        return diagnostic, LightWarning(
            "rect-area-auto-artifact-bake-only",
            f'Web Light "{object_name}": {detail}',
            object_name,
        )
    if (
        visibility.exported
        and published_object_names is not None
        and (
            light_type in SUPPORTED_PUNCTUAL_TYPES
            or rect_area_plan.descriptor is not None
        )
        and object_name not in published_object_names
        and not confirmed_published_source
    ):
        visibility = RenderVisibility(
            False,
            "exportScope",
            (
                f'"{object_name}" is render-visible but absent from this export scope, '
                "so it will not publish."
            ),
        )
    expected_intensity, expected_power = _expected_output(
        obj, data, scene, light_type, energy,
    )

    if not visibility.exported:
        return LightDiagnostic(
            object_name, data_name, light_type, WEB_LIGHT_TYPES.get(light_type),
            STATUS_NOT_EXPORTED, visibility, visibility.detail,
            source_energy=energy, source_exposure=exposure,
            outcome=OUTCOME_NOT_PUBLISHED,
            remedy=(
                "Include this light in the active export scope, or leave it excluded "
                "when the website should not receive it."
                if visibility.code == "exportScope" else
                "Enable this light and at least one of its scene collection paths for "
                "renders when it should publish to the website."
            ),
        ), None

    if rect_area_plan.descriptor is not None:
        if confirmed_rect_area_source:
            approximation_reasons = tuple(
                issue.detail for issue in rect_area_plan.approximations
            )
            detail = (
                "Blendlink attached the validated Three Rect Area v1 descriptor "
                "to exactly one finalized glTF node. The package runtime installs "
                "a shadowless Three RectAreaLight for live PBR receivers. "
                + " ".join(approximation_reasons)
            )
            descriptor = rect_area_plan.descriptor
            return LightDiagnostic(
                object_name, data_name, light_type, "rectArea",
                STATUS_APPROXIMATED, visibility, detail,
                approximation_reasons,
                source_energy=energy, source_exposure=exposure,
                expected_web_intensity=descriptor.intensity,
                expected_three_power=descriptor.power,
                outcome=OUTCOME_APPROXIMATED,
                remedy=(
                    "Use Point, Spot, or Sun when portable glTF lighting or "
                    "realtime shadows are required. Keep static Appearance "
                    "surfaces baked and verify live PBR receivers in the website."
                ),
            ), LightWarning(
                "rect-area-light-approximated",
                f'Web Light "{object_name}": ' + " ".join(
                    approximation_reasons
                ),
                object_name,
            )

        approximation = " ".join(
            issue.detail for issue in rect_area_plan.approximations
        )
        selection = (
            "automatic" if rect_area_plan.mode == AREA_LIGHT_MODE_AUTO
            else "explicit"
        )
        if published_rect_area_identities is None:
            descriptor = rect_area_plan.descriptor
            detail = (
                f"The {selection} Three Rect Area source plan is valid. Final export "
                "will attach this descriptor to exactly one glTF node, then Blendlink "
                "will attest it again after optimization before the package runtime "
                "installs a shadowless Three RectAreaLight. "
            ) + approximation
            return LightDiagnostic(
                object_name, data_name, light_type, "rectArea",
                STATUS_APPROXIMATED, visibility, detail,
                tuple(issue.detail for issue in rect_area_plan.approximations),
                source_energy=energy, source_exposure=exposure,
                expected_web_intensity=descriptor.intensity,
                expected_three_power=descriptor.power,
                outcome=OUTCOME_APPROXIMATED,
                remedy=(
                    "Publish to finalize and verify the descriptor-bearing node. "
                    "Use Point, Spot, or Sun instead when realtime shadows or a "
                    "portable glTF-native light are required."
                ),
            ), LightWarning(
                "rect-area-light-planned",
                f'Web Light "{object_name}": ' + detail,
                object_name,
            )

        detail = (
            f"The {selection} Three Rect Area source plan is valid, but finished-GLB "
            "evidence does not attest an exact descriptor-bearing node. Publication "
            "is blocked instead of silently falling back to a missing realtime light. "
        ) + approximation
        diagnostic = LightDiagnostic(
            object_name, data_name, light_type, None, STATUS_NOT_EXPORTED,
            visibility, detail,
            tuple(issue.detail for issue in rect_area_plan.approximations),
            source_energy=energy, source_exposure=exposure,
            outcome=OUTCOME_NOT_PUBLISHED,
            remedy=(
                "Re-export so Blendlink can attach and attest the finalized Rect "
                f"Area descriptor, set {AREA_LIGHT_MODE_PROPERTY} to "
                f"{AREA_LIGHT_MODE_BAKE_ONLY!r}, or use Point, Spot, or Sun for "
                "portable realtime lighting."
            ),
        )
        return diagnostic, LightWarning(
            "rect-area-light-final-evidence-missing",
            f'Web Light "{object_name}": {detail}',
            object_name,
            severity="ERROR",
            blocking=True,
        )

    if light_type not in SUPPORTED_PUNCTUAL_TYPES:
        type_label = "AREA" if light_type == "AREA" else light_type
        if light_type == "AREA" and rect_area_plan.fallbacks:
            fallback = " ".join(issue.detail for issue in rect_area_plan.fallbacks)
            detail = (
                "Automatic Website Area Light kept this source bake-only because "
                + fallback
            )
            diagnostic = LightDiagnostic(
                object_name, data_name, light_type, None, STATUS_NOT_EXPORTED,
                visibility, detail,
                tuple(issue.detail for issue in rect_area_plan.fallbacks),
                source_energy=energy, source_exposure=exposure,
                outcome=OUTCOME_BAKE_ONLY,
                remedy=(
                    "Simplify the named source semantics, choose Three Rect Area "
                    "to accept the diagnosed approximation, or leave Automatic "
                    "to preserve this light only in baked artwork."
                ),
            )
            return diagnostic, LightWarning(
                "rect-area-auto-bake-only",
                f'Web Light "{object_name}": {detail}',
                object_name,
            )
        detail = (
            f"{type_label} is explicitly Bake Only: portable glTF punctual lights "
            "have no AREA type. This light contributes to baked artwork but does "
            "not illuminate Realtime PBR objects."
            if light_type == "AREA" else
            f"{type_label} has no KHR_lights_punctual realtime equivalent. It can "
            "contribute to baked lighting, but it will not light Realtime objects."
        )
        diagnostic = LightDiagnostic(
            object_name, data_name, light_type, None, STATUS_NOT_EXPORTED,
            visibility, detail, (detail,), source_energy=energy,
            source_exposure=exposure,
            outcome=OUTCOME_BAKE_ONLY,
            remedy=(
                "Keep this light for baked artwork, or add a Point, Spot, or Sun "
                "light when Realtime objects need portable direct illumination. "
                "Three RectAreaLight is PBR-only and shadowless, so use it only "
                "through a deliberately calibrated adapter."
            ),
        )
        return diagnostic, LightWarning(
            "light-bake-only",
            f'Web Light "{object_name}": {detail}',
            object_name,
        )

    reasons = _approximation_reasons(obj, data, scene, light_type)
    if expected_intensity is None:
        preserved = (
            "The stock glTF exporter follows this render engine's active light "
            "node graph, so the data-block Energy alone cannot predict website output."
        )
    elif light_type == "POINT":
        preserved = (
            "COMPAT maps effective Blender energy to glTF/Three point intensity "
            "at energy / (4pi); Three.js PointLight.power reads back that effective "
            "energy. Color and range publish through KHR_lights_punctual."
        )
    elif light_type == "SPOT":
        preserved = (
            "COMPAT maps effective Blender energy to glTF/Three spot intensity "
            "at energy / (4pi). Three.js SpotLight.power uses pi * intensity, so "
            "its power readout is one quarter of the effective Blender energy. "
            "Color, range, and cone fields publish through KHR_lights_punctual."
        )
    else:
        preserved = (
            "COMPAT export preserves Blender sun energy as directional intensity; "
            "color publishes through KHR_lights_punctual."
        )
    status = STATUS_APPROXIMATED if reasons else STATUS_EXACT
    detail = preserved
    warning = None
    if reasons:
        detail += " Web approximation: " + " ".join(reasons)
        warning = LightWarning(
            "light-approximated",
            f'Web Light "{object_name}": ' + " ".join(reasons),
            object_name,
        )
    return LightDiagnostic(
        object_name, data_name, light_type, WEB_LIGHT_TYPES[light_type], status,
        visibility, detail, reasons,
        source_energy=energy,
        source_exposure=exposure,
        expected_web_intensity=expected_intensity,
        expected_three_power=expected_power,
        outcome=(OUTCOME_APPROXIMATED if reasons else OUTCOME_EXACT),
        remedy=(
            "Reset unsupported Blender-only controls for the closest realtime "
            "match, recreate the relationship in website code, or bake the "
            "affected lighting into static artwork."
            if reasons else
            "No correction is needed for this portable realtime-light setup."
        ),
    ), warning


def analyze_scene(
    scene,
    published_object_names: set[str] | frozenset[str] | None = None,
    published_source_objects: Iterable[object] | None = None,
    published_rect_area_objects: Iterable[object] | None = None,
    view_layer=None,
    instance_source_objects: Iterable[object] | None = None,
    rect_area_artifact_fallbacks: Mapping[str, RectAreaLightIssue] | None = None,
) -> SceneLightAnalysis:
    """Return stable light decisions and nonblocking warnings for ``scene``.

    ``published_object_names`` may be supplied after export to distinguish a
    render-visible light that was omitted by the selected/collection export
    scope. The interactive addon leaves it ``None`` and reports authoring
    visibility only. ``published_source_objects`` is finished-artifact evidence
    that a source produced a KHR punctual light. ``instance_source_objects`` is
    weaker collection-instance evidence: it makes an external source eligible
    for diagnosis, but a supported punctual source must still appear in
    ``published_object_names`` to be reported as published. Both iterables are
    identity-deduplicated with scene lights. ``rect_area_artifact_fallbacks``
    contains named, nonblocking reasons why an Automatic source could not be
    represented by exactly one finalized node and therefore stayed bake-only.
    """
    published = (
        frozenset(published_object_names)
        if published_object_names is not None else None
    )
    source_objects = tuple(published_source_objects or ())
    rect_area_objects = (
        tuple(published_rect_area_objects)
        if published_rect_area_objects is not None else None
    )
    instance_objects = tuple(instance_source_objects or ())
    published_source_identities = frozenset(
        _identity(obj) for obj in source_objects
        if getattr(obj, "type", None) == "LIGHT"
    )
    published_rect_area_identities = (
        frozenset(
            _identity(obj) for obj in rect_area_objects
            if getattr(obj, "type", None) == "LIGHT"
        )
        if rect_area_objects is not None else None
    )
    instance_source_identities = frozenset(
        _identity(obj) for obj in instance_objects
        if getattr(obj, "type", None) == "LIGHT"
    )
    lights_by_identity = {}
    for obj in (
        *tuple(getattr(scene, "objects", ())),
        *source_objects,
        *(rect_area_objects or ()),
        *instance_objects,
    ):
        if getattr(obj, "type", None) == "LIGHT":
            lights_by_identity.setdefault(_identity(obj), obj)
    lights = sorted(
        lights_by_identity.values(),
        key=lambda obj: _name(obj, "Light").casefold(),
    )
    diagnostics = []
    warnings = []
    for obj in lights:
        diagnostic, warning = _diagnose_light(
            obj,
            scene,
            published,
            published_source_identities,
            published_rect_area_identities,
            view_layer,
            instance_source_identities,
            (rect_area_artifact_fallbacks or {}).get(_name(obj, "Light")),
        )
        diagnostics.append(diagnostic)
        if warning is not None:
            warnings.append(warning)
    return SceneLightAnalysis(tuple(diagnostics), tuple(warnings))


def scene_warnings(scene) -> tuple[LightWarning, ...]:
    """Convenience interface for callers that only render artist warnings."""
    return analyze_scene(scene).warnings
