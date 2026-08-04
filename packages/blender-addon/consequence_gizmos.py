# SPDX-License-Identifier: GPL-3.0-or-later
"""Cached, data-driven viewport consequences for authored web behavior.

The public interface is ``build()``.  It performs no drawing and mutates no
Blender data; validation owns when it is recomputed, while overlay.py owns the
single draw-handler lifecycle.  That keeps component/probe/shadow knowledge out
of the per-frame renderer and makes every skipped visualization reportable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math

from mathutils import Matrix

from . import component_schema


@dataclass(frozen=True)
class GizmoItem:
    kind: str
    shape: str
    matrix: Matrix
    label: str = ""
    color: tuple = (1.0, 1.0, 1.0, 1.0)
    matrix_resolver: object | None = field(
        default=None, repr=False, compare=False,
    )

    def resolved_matrix(self):
        """Resolve the current object transform without rescanning the scene."""
        if self.matrix_resolver is None:
            return self.matrix
        try:
            return self.matrix_resolver()
        except (AttributeError, ReferenceError, RuntimeError, ValueError):
            return None


@dataclass(frozen=True)
class GizmoIssue:
    message: str
    object_name: str | None = None


@dataclass(frozen=True)
class GizmoBuildResult:
    items: tuple[GizmoItem, ...] = ()
    counts: dict[str, int] = field(default_factory=dict)
    issues: tuple[GizmoIssue, ...] = ()


_AUDIO_NEAR = (0.25, 0.92, 1.0, 0.80)
_AUDIO_FAR = (0.15, 0.55, 1.0, 0.55)
_SEE_THROUGH = (0.78, 0.40, 1.0, 0.82)
_PROBE_BOX = (0.95, 0.38, 0.78, 0.82)
_PROBE_SPHERE = (0.55, 0.42, 1.0, 0.82)
_SHADOW = (1.0, 0.67, 0.16, 0.72)
_SHADOW_OFF = (0.75, 0.32, 0.18, 0.92)
_INTERACTION = (0.20, 0.82, 1.0, 0.88)
_INTERACTION_SELECTED = (0.35, 1.0, 0.72, 0.96)
_INTERACTION_WARNING = (1.0, 0.24, 0.12, 0.98)


def _pointer(value) -> int:
    try:
        return int(value.as_pointer())
    except (AttributeError, ReferenceError, TypeError, ValueError):
        return id(value)


def _world_rotation(obj) -> Matrix:
    """Return rotation without inheriting an artist's object scale.

    Component distances and probe influence are authored in scene units. A
    scaled speaker or helper must not silently double its audible range.
    """
    try:
        return obj.matrix_world.to_quaternion().to_matrix().to_4x4()
    except (AttributeError, ValueError):
        return Matrix.Identity(4)


def _world_volume_matrix(obj, scale: tuple[float, float, float]) -> Matrix:
    return (
        Matrix.Translation(obj.matrix_world.translation)
        @ _world_rotation(obj)
        @ Matrix.Diagonal((*scale, 1.0))
    )


def _sphere_matrix(obj, radius: float) -> Matrix:
    # overlay.py's cached unit sphere has radius 0.5.
    diameter = radius * 2.0
    return _world_volume_matrix(obj, (diameter, diameter, diameter))


def _box_matrix(obj, half_extent: float) -> Matrix:
    # overlay.py's cached unit box spans -0.5..0.5 on every axis.
    size = half_extent * 2.0
    return _world_volume_matrix(obj, (size, size, size))


def _spot_matrix(obj, reach: float) -> Matrix:
    angle = _finite_nonnegative(
        getattr(getattr(obj, "data", None), "spot_size", None),
    )
    if angle is None or angle <= 0.0 or angle >= math.pi:
        angle = math.radians(45.0)
    radius = reach * math.tan(angle * 0.5)
    # The cached cone starts at the origin and extends one unit along local -Z,
    # matching Blender and Three.js spotlight direction.
    return _world_volume_matrix(obj, (radius, radius, reach))


def _cross_matrix(obj, scale: float = 1.0) -> Matrix:
    size = max(scale, 1e-5)
    return _world_volume_matrix(obj, (size, size, size))


def _target(scene, component):
    target = getattr(component, "target_object", None)
    if target is not None:
        return target
    target_id = str(getattr(component, "target_id", "") or "")
    if not target_id:
        return None
    return next(
        (
            obj for obj in scene.objects
            if obj.get("blendlink_id") == target_id
        ),
        None,
    )


def _visible_in_viewport(obj) -> bool:
    """Whether the artist can currently see this object in the 3D viewport."""
    visible_get = getattr(obj, "visible_get", None)
    if not callable(visible_get):
        return True
    try:
        return bool(visible_get())
    except (RuntimeError, TypeError):
        # An object outside the active view layer raises rather than answering.
        return False


def _finite_nonnegative(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0.0 else None


def _format_distance(value: float) -> str:
    return f"{value:.3g} m"


def _add(items, counts, item: GizmoItem) -> None:
    items.append(item)
    counts[item.kind] = counts.get(item.kind, 0) + 1


_RADIUS_STYLES = {
    "clearance": ("see-through", _SEE_THROUGH),
    "inner": ("audio-range", _AUDIO_NEAR),
    "outer": ("audio-range", _AUDIO_FAR),
}


def _gizmo_condition_matches(component, condition) -> bool:
    if condition is None:
        return True
    if not isinstance(condition, dict) or not isinstance(condition.get("field"), str):
        return False
    return getattr(component, condition["field"], None) == condition.get("equals")


def _interaction_target_gizmos(
    scene, project, selected_pointers: set[int], items, counts,
) -> None:
    """Identify every enabled pointer target without scanning in the draw loop.

    The website resolves pointer priority from the nearest visible rendered hit,
    then prefers a registered descendant over its interactive ancestor. This
    guide deliberately describes that runtime rule instead of inventing an
    author-controlled ordering field that the runtime does not implement.
    """
    grouped = {}
    for component in getattr(project, "components", ()):
        if not bool(getattr(component, "enabled", True)):
            continue
        component_type = str(getattr(component, "component_type", "") or "")
        definition = component_schema.definition(component_type)
        if definition is None or "pointer" not in definition.get("requires", ()):
            continue
        target = _target(scene, component)
        if target is None:
            continue
        if not _visible_in_viewport(target):
            # An object the artist has hidden should not paint a marker and a
            # label over their work. The rest of the scan already filters on
            # visibility; this one did not.
            continue
        key = _pointer(target)
        entry = grouped.setdefault(key, {
            "target": target, "labels": [], "missing_label": False,
        })
        detail = str(definition.get("label", component_type) or component_type)
        if "accessibility_label" in definition.get("fields", ()):
            accessible = str(
                getattr(component, "accessibility_label", "") or "",
            ).strip()
            if accessible:
                detail += f' "{accessible}"'
            else:
                detail += " [MISSING ACCESSIBLE LABEL]"
                entry["missing_label"] = True
        entry["labels"].append(detail)

    for key, entry in grouped.items():
        target = entry["target"]
        selected = key in selected_pointers
        label = (
            f"{getattr(target, 'name', 'Interaction target')} | "
            f"{' + '.join(entry['labels'])} | Pick priority: nearest visible hit"
        )
        color = (
            _INTERACTION_WARNING if entry["missing_label"]
            else _INTERACTION_SELECTED if selected else _INTERACTION
        )
        scale = 0.24 if selected else 0.16
        _add(items, counts, GizmoItem(
            "interaction-target", "cross", _cross_matrix(target, scale),
            label, color,
            matrix_resolver=(
                lambda target=target, scale=scale: _cross_matrix(target, scale)
            ),
        ))


def _component_gizmos(
    scene, project, selected_pointers: set[int], items, counts, issues,
) -> None:
    for component in getattr(project, "components", ()):
        if not bool(getattr(component, "enabled", True)):
            continue
        component_type = str(getattr(component, "component_type", "") or "")
        definition = component_schema.definition(component_type)
        definitions = definition.get("gizmos", ()) if definition else ()
        if not definitions:
            continue
        target = _target(scene, component)
        if target is None or _pointer(target) not in selected_pointers:
            continue
        active = tuple(
            item for item in definitions
            if _gizmo_condition_matches(component, item.get("when"))
        )
        values = {
            item.get("role"): _finite_nonnegative(
                getattr(component, item.get("field", ""), None),
            )
            for item in active if item.get("kind") == "radius"
        }
        if "inner" in values and "outer" in values and (
            values["inner"] is None or values["outer"] is None
            or values["outer"] <= values["inner"]
        ):
            issues.append(GizmoIssue(
                f"{definition['label']} needs finite inner and outer distances, with the outer distance farther than the inner distance.",
                getattr(target, "name", None),
            ))
            continue
        for gizmo in active:
            if gizmo.get("kind") != "radius":
                issues.append(GizmoIssue(
                    f"{definition['label']} declares unsupported viewport guide kind {gizmo.get('kind')!r}.",
                    getattr(target, "name", None),
                ))
                continue
            role = str(gizmo.get("role", "") or "")
            value = values.get(role)
            if value is None:
                issues.append(GizmoIssue(
                    f"{definition['label']} needs a finite {gizmo.get('label', 'distance')} before its viewport guide can be drawn.",
                    getattr(target, "name", None),
                ))
                continue
            if value == 0.0:
                # Zero is valid authored intent (for example, immediate
                # see-through fading).  It has no drawable radius and is not a
                # scene problem, so omit the guide quietly.
                continue
            kind, color = _RADIUS_STYLES.get(
                role, ("component-radius", (0.55, 0.78, 1.0, 0.72)),
            )
            label = str(
                gizmo.get("label", definition["label"]) or definition["label"],
            )
            if role == "inner" and "outer" in values:
                # Both concentric spheres share a screen-space origin. Put one
                # combined label on the outer guide instead of drawing two
                # unreadable strings on top of each other.
                label_text = ""
            elif role == "outer" and values.get("inner") is not None:
                inner = next(
                    (item for item in active if item.get("role") == "inner"),
                    {},
                )
                inner_label = str(inner.get("label", "Inner"))
                label_text = (
                    f"{definition['label']} · {inner_label} "
                    f"{_format_distance(values['inner'])} · {label} "
                    f"{_format_distance(value)}"
                )
            else:
                label_text = f"{label} · {_format_distance(value)}"
            _add(items, counts, GizmoItem(
                kind, "sphere", _sphere_matrix(target, value),
                label_text, color,
                matrix_resolver=(
                    lambda target=target, value=value: _sphere_matrix(target, value)
                ),
            ))


def _probe_consequence(probe, resolution: int) -> str:
    """Describe runtime work from the already-prepared authoring cache."""
    from . import probe_authoring

    mode = probe_authoring.mode_of(probe)
    status = probe_authoring.status_for(probe)
    if mode == "RUNTIME":
        pixels = 6 * max(0, resolution) ** 2
        return (
            f"Runtime capture · {resolution}px × 6 "
            f"({pixels / 1_000_000:.2f} MP)"
        )
    evidence = status.evidence
    if evidence is not None and evidence.width > 0 and evidence.height > 0:
        megabytes = evidence.bytes / (1024 * 1024)
        return (
            f"{mode.title()} · {status.code.title()} · "
            f"{evidence.width}×{evidence.height} {evidence.format.upper()} · "
            f"{megabytes:.2f} MB"
        )
    return f"{mode.title()} · {status.label}"


def _probe_gizmo(project, items, counts, issues) -> None:
    probes = getattr(project, "reflection_probes", ())
    if not len(probes):
        return
    index = min(max(0, int(getattr(project, "reflection_probe_index", 0))), len(probes) - 1)
    probe = probes[index]
    helper = getattr(probe, "probe_object", None)
    if helper is None:
        issues.append(GizmoIssue(
            f"Reflection Probe {getattr(probe, 'name', index + 1)!r} has no helper, so its influence cannot be drawn.",
        ))
        return
    influence = _finite_nonnegative(getattr(probe, "influence", None))
    if influence is None or influence <= 0.0:
        issues.append(GizmoIssue(
            "Reflection Probe needs a positive Influence Distance before its viewport guide can be drawn.",
            getattr(helper, "name", None),
        ))
        return
    shape = "sphere" if str(getattr(probe, "shape", "BOX")) == "SPHERE" else "box"
    try:
        resolution = int(getattr(probe, "resolution", 256))
    except (TypeError, ValueError):
        resolution = 0
    label = (
        f"{getattr(probe, 'name', 'Reflection Probe')} · "
        f"{_probe_consequence(probe, resolution)}"
    )
    _add(items, counts, GizmoItem(
        "reflection-probe", shape,
        _sphere_matrix(helper, influence)
        if shape == "sphere" else _box_matrix(helper, influence),
        label, _PROBE_SPHERE if shape == "sphere" else _PROBE_BOX,
        matrix_resolver=(
            (lambda helper=helper, influence=influence: _sphere_matrix(helper, influence))
            if shape == "sphere" else
            (lambda helper=helper, influence=influence: _box_matrix(helper, influence))
        ),
    ))


def _resolved_shadow_settings(project):
    preset = str(getattr(project, "shadow_preset", "APPLICATION") or "APPLICATION")
    if preset == "APPLICATION":
        return None
    if preset == "OFF":
        return {"enabled": False, "map_size": 0, "reach": 0.0}
    # This is the one authored source used by props.project_recipe(). Importing
    # lazily avoids making PropertyGroup registration depend on validation.
    from . import props
    values = props._SHADOW_PRESETS.get(preset)
    if values is not None:
        _filter, map_size, reach, _bias, _normal_bias, _radius, _auto = values
    else:
        map_size = int(getattr(project, "shadow_map_size", 0))
        reach = float(getattr(project, "shadow_max_distance", 0.0))
    return {"enabled": True, "map_size": int(map_size), "reach": float(reach)}


def _shadow_gizmos(
    project, selected_objects, light_diagnostics, items, counts, issues,
) -> None:
    settings = _resolved_shadow_settings(project)
    if settings is None:
        return
    for obj in selected_objects:
        if getattr(obj, "type", None) != "LIGHT":
            continue
        light_type = str(getattr(getattr(obj, "data", None), "type", ""))
        if light_type not in {"POINT", "SPOT", "SUN"}:
            continue
        diagnostic = (light_diagnostics or {}).get(getattr(obj, "name", ""), {})
        if diagnostic and diagnostic.get("outcome") in {"bakeOnly", "notPublished"}:
            continue
        authored = obj.get("blendlink_cast_shadow")
        casts = (
            authored if isinstance(authored, bool)
            else bool(getattr(getattr(obj, "data", None), "use_shadow", False))
        )
        if not settings["enabled"] or not casts:
            _add(items, counts, GizmoItem(
                "shadow-reach", "cross", _cross_matrix(obj),
                "Realtime shadows disabled", _SHADOW_OFF,
                matrix_resolver=lambda obj=obj: _cross_matrix(obj),
            ))
            continue
        reach = _finite_nonnegative(settings["reach"])
        map_size = int(settings["map_size"])
        if reach is None or reach <= 0.0 or map_size <= 0:
            issues.append(GizmoIssue(
                "Realtime Shadows needs positive Reach and Map Resolution before its viewport guide can be drawn.",
                getattr(obj, "name", None),
            ))
            continue
        faces = 6 if light_type == "POINT" else 1
        megapixels = faces * map_size ** 2 / 1_000_000
        label = (
            f"Shadow reach · {_format_distance(reach)} · {map_size}px × {faces} "
            f"({megapixels:.2f} MP)"
        )
        if light_type == "SUN":
            label = label.replace("Shadow reach", "Shadow far clip", 1)
        if light_type == "POINT":
            shape = "sphere"
            matrix = _sphere_matrix(obj, reach)
            resolver = lambda obj=obj, reach=reach: _sphere_matrix(obj, reach)
        elif light_type == "SPOT":
            shape = "cone"
            matrix = _spot_matrix(obj, reach)
            resolver = lambda obj=obj, reach=reach: _spot_matrix(obj, reach)
        else:
            # The recipe owns only a Sun shadow's far clip, not its
            # orthographic footprint. A selected-light badge is honest; a
            # small cross would falsely imply geometric reach.
            shape = "badge"
            matrix = _cross_matrix(obj)
            resolver = lambda obj=obj: _cross_matrix(obj)
        _add(items, counts, GizmoItem(
            "shadow-reach",
            shape, matrix, label, _SHADOW, matrix_resolver=resolver,
        ))


def build(
    scene, *, project=None, selected_objects=(), light_diagnostics=None,
) -> GizmoBuildResult:
    """Return immutable draw data plus actionable problems.

    Callers decide when to cache and draw it.  Only selected component/light
    targets receive potentially large range guides; the currently active probe
    remains visible because its list selection is the authoring focus.
    """
    project = project or getattr(scene, "blendlink_project", None)
    if project is None or not bool(getattr(project, "configured", False)):
        return GizmoBuildResult()
    selected_objects = tuple(selected_objects or ())
    selected_pointers = {_pointer(obj) for obj in selected_objects}
    items = []
    counts = {}
    issues = []
    _interaction_target_gizmos(
        scene, project, selected_pointers, items, counts,
    )
    _component_gizmos(
        scene, project, selected_pointers, items, counts, issues,
    )
    _probe_gizmo(project, items, counts, issues)
    _shadow_gizmos(
        project, selected_objects, light_diagnostics or {},
        items, counts, issues,
    )
    return GizmoBuildResult(tuple(items), counts, tuple(issues))
