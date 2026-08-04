# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only validation for authored website components.

This is the single artist-facing diagnostic seam shared by component cards,
Web Checks, and publish preflight.  It deliberately knows nothing about
Blender layout objects and never repairs IDs or mutates an authored record.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass

from . import component_schema


_TYPE_PATTERN = re.compile(
    r"[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+",
)

_WEBSITE_SURFACE_UV_BOUND_TOLERANCE = 1e-5
_WEBSITE_SURFACE_UV_EDGE_TOLERANCE = 1e-4
_WEBSITE_SURFACE_UV_DEGENERATE_TOLERANCE = 1e-6
_WEBSITE_SURFACE_UV_AREA_TOLERANCE = 1e-10


def website_surface_uv0_issue(mesh) -> tuple[str, str] | None:
    """Return the first application-pixel addressing problem in Mesh UV0."""
    if not mesh.uv_layers or len(mesh.uv_layers[0].data) != len(mesh.loops):
        return (
            "website_surface_uv0",
            "Open the UV Editing workspace, unwrap this dedicated surface, "
            "then fit UV0 to the full 0-1 square.",
        )

    coordinates = [
        (float(item.uv[0]), float(item.uv[1]))
        for item in mesh.uv_layers[0].data
    ]
    if not coordinates or any(
        not math.isfinite(value)
        for coordinate in coordinates
        for value in coordinate
    ):
        return (
            "website_surface_uv0_non_finite",
            "UV0 contains non-finite coordinates. In the UV Editor, select all "
            "screen faces, unwrap again, then fit them to the full 0-1 square.",
        )

    minimum_u = min(coordinate[0] for coordinate in coordinates)
    maximum_u = max(coordinate[0] for coordinate in coordinates)
    minimum_v = min(coordinate[1] for coordinate in coordinates)
    maximum_v = max(coordinate[1] for coordinate in coordinates)
    collapsed_axes = [
        axis for axis, minimum, maximum in (
            ("U", minimum_u, maximum_u),
            ("V", minimum_v, maximum_v),
        )
        if maximum - minimum <= _WEBSITE_SURFACE_UV_DEGENERATE_TOLERANCE
    ]
    if collapsed_axes:
        return (
            "website_surface_uv0_degenerate",
            f"UV0 is collapsed in {' and '.join(collapsed_axes)}. In the UV Editor, "
            "select all screen faces, unwrap again, then fit them to the full "
            "0-1 square.",
        )

    tolerance = _WEBSITE_SURFACE_UV_BOUND_TOLERANCE
    if minimum_u < -tolerance or minimum_v < -tolerance \
            or maximum_u > 1.0 + tolerance or maximum_v > 1.0 + tolerance:
        return (
            "website_surface_uv0_out_of_range",
            "UV0 leaves the ordinary 0-1 square, which would repeat or clamp "
            "application pixels. In the UV Editor, select all screen faces and "
            "fit them inside the full 0-1 square.",
        )

    edge_tolerance = _WEBSITE_SURFACE_UV_EDGE_TOLERANCE
    if minimum_u > edge_tolerance or minimum_v > edge_tolerance \
            or maximum_u < 1.0 - edge_tolerance \
            or maximum_v < 1.0 - edge_tolerance:
        return (
            "website_surface_uv0_not_full_frame",
            "UV0 does not span the full 0-1 square, so application pixels would "
            "be cropped. In the UV Editor, select all screen faces and scale the "
            "UV bounds to the complete square.",
        )

    mesh.calc_loop_triangles()
    uv0 = mesh.uv_layers[0]
    uv_area = 0.0
    for triangle in mesh.loop_triangles:
        a, b, c = (
            tuple(uv0.data[loop_index].uv)
            for loop_index in triangle.loops
        )
        uv_area += 0.5 * abs(
            (b[0] - a[0]) * (c[1] - a[1])
            - (b[1] - a[1]) * (c[0] - a[0])
        )
    if uv_area <= _WEBSITE_SURFACE_UV_AREA_TOLERANCE:
        return (
            "website_surface_uv0_zero_area",
            "UV0 has no usable texture area; every renderable triangle is "
            "collapsed in UV space. In the UV Editor, select all screen faces "
            "and unwrap them so the triangles fill the 0-1 square with visible area.",
        )
    return None


@dataclass(frozen=True)
class ComponentIssue:
    code: str
    message: str
    component_id: str
    component_label: str
    object_name: str | None = None
    blocking: bool = True


def _issue(component, code: str, message: str, *, target=None, blocking=True):
    return ComponentIssue(
        code=code,
        message=message,
        component_id=str(getattr(component, "component_id", "") or ""),
        component_label=component_schema.label(
            str(getattr(component, "component_type", "") or ""),
        ),
        object_name=getattr(target, "name", None),
        blocking=blocking,
    )


def _scene_contains(scene, obj) -> bool:
    if obj is None:
        return False
    if scene is None:
        return True
    return scene.objects.get(getattr(obj, "name", "")) is obj


def target_for(scene, component):
    """Resolve a component target read-only, using its stable ID as fallback."""
    if str(getattr(component, "target_kind", "")) != "OBJECT":
        return None
    pointer = getattr(component, "target_object", None)
    if _scene_contains(scene, pointer):
        return pointer
    target_id = str(getattr(component, "target_id", "") or "")
    if scene is None or not target_id:
        return None
    matches = [
        obj for obj in scene.objects
        if obj.get("blendlink_id") == target_id
    ]
    return matches[0] if len(matches) == 1 else None


def matches_object(scene, component, obj) -> bool:
    if obj is None or str(getattr(component, "target_kind", "")) != "OBJECT":
        return False
    target = target_for(scene, component)
    if target is not None:
        return target is obj
    target_id = str(getattr(component, "target_id", "") or "")
    return bool(target_id and obj.get("blendlink_id") == target_id)


def _target_type(obj) -> str:
    return "MESH" if getattr(obj, "type", None) == "MESH" else "OBJECT"


def _safe_address(value: str, *, audio: bool = False) -> bool:
    address = str(value or "").strip()
    if not address or address.lower() in {"http://", "https://"}:
        return False
    scheme = re.match(r"^([a-z][a-z0-9+.-]*):", address, re.IGNORECASE)
    allowed = {"http", "https"} if audio else {"http", "https", "mailto", "tel"}
    return scheme is None or scheme.group(1).lower() in allowed


def _unsafe_address(value: str, *, audio: bool = False) -> bool:
    address = str(value or "").strip()
    scheme = re.match(r"^([a-z][a-z0-9+.-]*):", address, re.IGNORECASE)
    allowed = {"http", "https"} if audio else {"http", "https", "mailto", "tel"}
    return bool(scheme and scheme.group(1).lower() not in allowed)


def validate_component(project, component, *, scene=None) -> tuple[ComponentIssue, ...]:
    """Return every actionable issue for one component without changing it."""
    issues = []
    components = tuple(getattr(project, "components", ()) or ())
    component_id = str(getattr(component, "component_id", "") or "").strip()
    component_type = str(getattr(component, "component_type", "") or "").strip()
    definition = component_schema.definition(component_type)
    active = bool(getattr(component, "enabled", True))

    # Extension fields are part of every component record, including built-in
    # editors. Never let malformed storage pass Web Checks and then disappear
    # behind props.component_values() during the next recipe write.
    try:
        raw = json.loads(str(getattr(component, "raw_values", "") or "{}"))
        if not isinstance(raw, dict):
            issues.append(_issue(
                component, "values_not_object",
                "Stored component values must be a JSON object.",
            ))
    except (TypeError, json.JSONDecodeError):
        issues.append(_issue(
            component, "invalid_values_json",
            "Stored component values are not valid JSON.",
        ))

    if not component_id:
        issues.append(_issue(component, "missing_id", "This record has no persistent identity."))
    elif sum(
        str(getattr(item, "component_id", "") or "").strip() == component_id
        for item in components
    ) > 1:
        issues.append(_issue(component, "duplicate_id", "Another component uses this record identity."))

    if int(getattr(component, "schema_version", 0)) != component_schema.COMPONENT_SCHEMA_VERSION:
        issues.append(_issue(
            component, "unsupported_schema",
            f"Schema {getattr(component, 'schema_version', 0)} is not supported by this Blendlink version.",
        ))
    if not _TYPE_PATTERN.fullmatch(component_type):
        issues.append(_issue(
            component, "invalid_type",
            "The component type is not a valid namespaced identifier.",
        ))

    if definition is None:
        issues.append(_issue(
            component, "adapter_required",
            "No built-in editor or website adapter is installed. The stored record is preserved for a custom adapter.",
            blocking=False,
        ))

    target_kind = str(getattr(component, "target_kind", "") or "")
    target = target_for(scene, component)
    one_per_scene = bool(
        definition and definition.get("cardinality") == "one-per-scene"
    )
    duplicate_in_scene = bool(
        one_per_scene
        and sum(
            getattr(item, "component_type", "") == component_type
            for item in components
        ) > 1
    )
    if duplicate_in_scene:
        issues.append(_issue(
            component, "duplicate_placement",
            "This Scene already has this effect; keep one Scene or Empty placement.",
            target=target,
        ))
    if target_kind == "SCENE":
        if not component_schema.supports_target(component_type, "SCENE"):
            issues.append(_issue(
                component, "incompatible_target",
                "This behavior cannot be attached to the complete Scene.",
            ))
        if not one_per_scene and sum(
            getattr(item, "component_type", "") == component_type
            and getattr(item, "target_kind", "") == "SCENE"
            for item in components
        ) > 1:
            issues.append(_issue(
                component, "duplicate_placement",
                "This Scene has the same effect more than once.",
            ))
    elif target_kind == "OBJECT":
        if target is None:
            name = (
                str(getattr(component, "target_name", "") or "")
                or str(getattr(component, "target_id", "") or "")
                or "unknown object"
            )
            issues.append(_issue(
                component, "missing_target", f"Target missing: {name}.",
            ))
        elif not component_schema.supports_target(component_type, _target_type(target)):
            issues.append(_issue(
                component, "incompatible_target",
                f"This behavior cannot be attached to {target.name} ({target.type}).",
                target=target,
            ))
        elif not one_per_scene and sum(
            getattr(item, "component_type", "") == component_type
            and matches_object(scene, item, target)
            for item in components
        ) > 1:
            issues.append(_issue(
                component, "duplicate_placement",
                "This object has the same behavior more than once.",
                target=target,
            ))
    else:
        issues.append(_issue(
            component, "invalid_target_kind",
            "The component target must be the Scene or an object.",
        ))

    needs_accessible_label = bool(
        definition
        and "pointer" in definition.get("requires", ())
        and "accessibility_label" in definition.get("fields", ())
    )
    if needs_accessible_label and not str(
        getattr(component, "accessibility_label", "") or "",
    ).strip():
        issues.append(_issue(
            component, "missing_accessible_label",
            "Enter an Accessible Label so the website can name this action for keyboard and assistive-technology users.",
            target=target, blocking=active,
        ))

    if component_type == "blendlink.chromatic-aberration" and active \
            and float(getattr(component, "chromatic_amount", 0.0)) > 0.01:
        issues.append(_issue(
            component, "strong_chromatic_aberration",
            "Strong color separation can reduce readability; use 0.01 or less for most scenes.",
            blocking=False,
        ))
    if component_type == "blendlink.contact-shadows" and active:
        if target_kind == "SCENE" and not bool(
            getattr(component, "contact_shadows_auto_fit", True)
        ):
            issues.append(_issue(
                component, "manual_contact_shadows_need_empty",
                "Manual Contact Shadows need an Empty target. Re-enable Fit to "
                "Scene, or select an Empty, add Contact Shadows to it, and "
                "remove this scene record.",
            ))
        elif target is not None and getattr(target, "type", "") == "MESH":
            issues.append(_issue(
                component, "contact_shadows_mesh_target",
                "Contact Shadows belong on the Scene or an Empty, not a Mesh.",
                target=target,
            ))
    if component_type == "blendlink.website-surface":
        surface_name = str(
            getattr(component, "website_surface_name", "") or ""
        ).strip()
        if len(surface_name) > 64 or not re.fullmatch(
            r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", surface_name,
        ):
            issues.append(_issue(
                component, "invalid_website_surface_name",
                "Website Name must be lowercase kebab-case, for example monitor-screen.",
                target=target, blocking=active,
            ))
        elif sum(
            getattr(item, "component_type", "") == "blendlink.website-surface"
            and str(getattr(item, "website_surface_name", "") or "").strip()
            == surface_name
            for item in components
        ) > 1:
            issues.append(_issue(
                component, "duplicate_website_surface_name",
                f"Another Website Surface already uses {surface_name!r}; every application name must be unique.",
                target=target, blocking=active,
            ))
        if target is not None and getattr(target, "type", "") == "MESH":
            mesh = target.data
            if not bool(target.get("blendlink_dynamic", False)):
                issues.append(_issue(
                    component, "website_surface_not_realtime",
                    "Website Surfaces must be Realtime so an appearance atlas cannot replace their UVs or material.",
                    target=target, blocking=active,
                ))
            if len(mesh.materials) != 1 or mesh.materials[0] is None:
                issues.append(_issue(
                    component, "website_surface_material_count",
                    "Use one material on a dedicated screen mesh. Separate screen faces from a multi-material object first.",
                    target=target, blocking=active,
                ))
            if not mesh.polygons:
                issues.append(_issue(
                    component, "website_surface_empty",
                    "The Website Surface has no renderable faces.",
                    target=target, blocking=active,
                ))
            uv0_issue = website_surface_uv0_issue(mesh)
            if uv0_issue is not None:
                issues.append(_issue(
                    component, uv0_issue[0], uv0_issue[1],
                    target=target, blocking=active,
                ))

    if component_type == "blendlink.open-url" and not _safe_address(
        getattr(component, "url", ""),
    ):
        issues.append(_issue(
            component, "invalid_url", "Enter a complete, safe website address.",
            target=target,
            blocking=active or _unsafe_address(getattr(component, "url", "")),
        ))
    elif component_type == "blendlink.look-at" and getattr(
        component, "reference_object", None,
    ) is None:
        issues.append(_issue(
            component, "missing_reference", "Choose the object this one should look at.",
            target=target, blocking=active,
        ))
    elif component_type == "blendlink.play-animation-on-click" and not str(
        getattr(component, "animation_clip", "") or "",
    ).strip():
        issues.append(_issue(
            component, "missing_animation", "Choose or enter an exported animation name.",
            target=target, blocking=active,
        ))
    elif component_type == "blendlink.audio-source":
        if not _safe_address(getattr(component, "audio_url", ""), audio=True):
            issues.append(_issue(
                component, "invalid_audio_url",
                "Enter a site-relative or HTTPS audio URL.", target=target,
                blocking=active or _unsafe_address(
                    getattr(component, "audio_url", ""), audio=True,
                ),
            ))
        if float(getattr(component, "max_distance", 0.0)) <= float(
            getattr(component, "min_distance", 0.0),
        ):
            issues.append(_issue(
                component, "invalid_audio_range",
                "Silent Beyond must be farther than Full Volume Within.", target=target,
            ))
    elif component_type == "blendlink.play-audio-on-click":
        source = getattr(component, "reference_object", None)
        if source is None:
            issues.append(_issue(
                component, "missing_reference",
                "Choose the object that owns the Audio Source.", target=target,
                blocking=active,
            ))
        elif not any(
            getattr(item, "component_type", "") == "blendlink.audio-source"
            and bool(getattr(item, "enabled", True))
            and matches_object(scene, item, source)
            for item in components
        ):
            issues.append(_issue(
                component, "missing_audio_source",
                "The chosen object does not have an enabled Audio Source.", target=target,
                blocking=active,
            ))

    issues.extend(_out_of_range_issues(component, component_type, blocking=active))
    return tuple(issues)


def _out_of_range_issues(component, component_type: str, *, blocking: bool):
    """Values the publish step will refuse, named here instead of at publish.

    Several components share one RNA property, so a slider's range is the
    widest any component needs: Vignette and Bloom both drive `intensity`,
    whose widget goes to 4 while Vignette publishes only 0..1. Without this
    the artist authors a value Blender accepts, sees nothing wrong, and is
    refused minutes later by a compile step that names a field they have
    already stopped looking at. The ranges come from the same table the
    recipe writer enforces, so the two cannot disagree.
    """
    from . import props

    ranges = props._COMPONENT_NUMBER_FIELDS.get(component_type, {})
    if not ranges:
        return ()
    try:
        values = props.component_values(component, require_complete=False)
    except (ValueError, TypeError, AttributeError):
        # Malformed storage is already reported above; do not report it twice.
        return ()
    found = []
    for key, (minimum, maximum) in sorted(ranges.items()):
        value = values.get(key)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        if minimum <= float(value) <= maximum:
            continue
        label = key[0].upper() + key[1:]
        found.append(_issue(
            component, "value_out_of_range",
            f"{label} is {float(value):g}, outside the {minimum:g} to "
            f"{maximum:g} this effect publishes. Bring it back into range; "
            "the slider is shared with another effect that allows more.",
            blocking=blocking,
        ))
    return tuple(found)


def validate_project(project, *, scene=None) -> tuple[ComponentIssue, ...]:
    """Return a stable, complete project diagnostic list."""
    return tuple(
        issue
        for component in tuple(getattr(project, "components", ()) or ())
        for issue in validate_component(project, component, scene=scene)
    )


def first_blocking_issue(project, *, scene=None) -> ComponentIssue | None:
    return next(
        (issue for issue in validate_project(project, scene=scene) if issue.blocking),
        None,
    )
