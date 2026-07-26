# SPDX-License-Identifier: GPL-3.0-or-later
"""Artist-facing authoring for portable website components.

The scene recipe is the source of truth.  This module only makes that
contract pleasant to author: scene-wide effects live with the scene, object
behaviours apply to the editable selection, and every record remains visible
even when its editor or target is unavailable.
"""
from __future__ import annotations

import json
import re
import textwrap
import uuid
from dataclasses import dataclass, field

import bpy

from . import component_schema, component_validation, props


_CATEGORY_ICONS = {
    "Effects": "SHADING_RENDERED",
    "Rendering": "MATERIAL",
    "Interaction": "MOUSE_LMB",
    "Motion": "CON_TRACKTO",
    "Animation": "ACTION",
    "Audio": "SPEAKER",
}

_COMPONENT_ICONS = {
    "blendlink.bloom": "LIGHT_SUN",
    "blendlink.vignette": "IMAGE",
    "blendlink.ambient-occlusion": "SHADING_RENDERED",
    "blendlink.shadow-catcher": "MATERIAL",
    "blendlink.contact-shadows": "LIGHT_AREA",
    "blendlink.outline": "MOD_LINEART",
    "blendlink.color-grading": "COLOR",
    "blendlink.depth-of-field": "CAMERA_DATA",
    "blendlink.kuwahara": "BRUSH_DATA",
    "blendlink.chromatic-aberration": "SEQ_CHROMA_SCOPE",
    "blendlink.pixelation": "IMAGE",
    "blendlink.sharpen": "MODIFIER",
    "blendlink.tilt-shift": "CAMERA_DATA",
    "blendlink.see-through": "HIDE_OFF",
    "blendlink.open-url": "URL",
    "blendlink.hover": "ORIENTATION_GIMBAL",
    "blendlink.website-surface": "IMAGE",
    "blendlink.hide-on-start": "HIDE_ON",
    "blendlink.look-at": "CON_TRACKTO",
    "blendlink.play-animation-on-click": "PLAY",
    "blendlink.audio-source": "SPEAKER",
    "blendlink.play-audio-on-click": "PLAY_SOUND",
}

# Add menus use the full task-oriented names. Cards need a shorter scan label
# because their header also carries expand, enable, type icon, and remove.
_CARD_LABELS = {
    "blendlink.see-through": "Keep Visible",
    "blendlink.open-url": "Open Link",
    "blendlink.hover": "Hover",
    "blendlink.website-surface": "Website Surface",
    "blendlink.play-animation-on-click": "Play Animation",
    "blendlink.play-audio-on-click": "Play Audio",
    "blendlink.ambient-occlusion": "Ambient Occlusion",
    "blendlink.shadow-catcher": "Shadow Catcher",
    "blendlink.contact-shadows": "Contact Shadows",
    "blendlink.color-grading": "Color Grade",
    "blendlink.depth-of-field": "Depth of Field",
    "blendlink.kuwahara": "Kuwahara",
    "blendlink.chromatic-aberration": "Chromatic Aberration",
    "blendlink.pixelation": "Pixelation",
    "blendlink.sharpen": "Sharpen",
    "blendlink.tilt-shift": "Tilt Shift",
}

_DEFAULT_BINDINGS = component_schema.COMPONENT_VALUE_BINDINGS

_FIELD_LABELS = {
    "reference_object": "Target",
    "fade_distance": "Clearance",
    "minimum_opacity": "Fade To",
    "new_tab": "New Tab",
    "hover_scale": "Scale",
    "website_surface_name": "Website Name",
    "website_surface_color_treatment": "Color Treatment",
    "keep_up": "Upright",
    "toggle": "Click Toggles",
}

_CLIPBOARD_PREFIX = "BLENDLINK_COMPONENT_V1\n"
_component_clipboard_text = ""
_last_component_action = None

# Artist-facing discoverability and product-boundary copy. Kept as named
# contracts so the headless suite catches a regression back to unlabeled +
# buttons or wording that implies Blendlink ships a physics simulation.
SCENE_CATALOG_ACTION_LABEL = "Browse Scene Effects"
BEHAVIOR_CATALOG_ACTION_LABEL = "Browse Object Behaviors"
SCENE_EMPTY_MESSAGE = "No scene effects yet. Browse the complete catalog above."
BEHAVIOR_EMPTY_MESSAGE = "No object behaviors yet. Browse the catalog above."
PHYSICS_DESIGNATION_TITLE = "Physics Export Designations"
PHYSICS_DESIGNATION_NOTE = "Export tags only — not a bundled physics simulation."


def _project(context):
    scene = getattr(context, "scene", None)
    return getattr(scene, "blendlink_project", None) if scene is not None else None


def _configured(context) -> bool:
    project = _project(context)
    return project is not None and project.configured


def _wrap(layout, message: str, *, icon: str = "NONE", width: int = 52):
    """Draw readable copy in both the narrow N-panel and wide Properties UI."""
    region = getattr(bpy.context, "region", None)
    region_width = int(getattr(region, "width", 0) or 0)
    if region_width:
        preferences = getattr(bpy.context, "preferences", None)
        system = getattr(preferences, "system", None)
        ui_scale = max(0.5, float(getattr(system, "ui_scale", 1.0) or 1.0))
        # Blender labels do not word-wrap themselves. Reserve room for the
        # panel/box gutters and an optional icon, then conservatively estimate
        # the number of average UI glyphs that remain.
        available = (region_width / ui_scale) - 72.0
        width = min(width, max(20, int(available / 7.0)))
    lines = textwrap.wrap(
        str(message),
        width=width,
        break_long_words=False,
        break_on_hyphens=False,
    ) or [""]
    for index, line in enumerate(lines):
        layout.label(text=line, icon=icon if index == 0 else "NONE")


def _target_type(obj) -> str:
    return "MESH" if getattr(obj, "type", None) == "MESH" else "OBJECT"


def _selected_editable(context) -> list:
    return list(getattr(context, "selected_editable_objects", ()) or ())


def _component_target(component):
    return getattr(component, "target_object", None)


def _matches_object(component, obj) -> bool:
    if component.target_kind != "OBJECT" or obj is None:
        return False
    target = _component_target(component)
    if target is not None:
        return target == obj
    object_id = obj.get("blendlink_id")
    return bool(object_id and component.target_id == object_id)


def _has_component(project, component_type: str, *, obj=None) -> bool:
    definition = component_schema.definition(component_type)
    if definition is not None \
            and definition.get("cardinality") == "one-per-scene":
        return any(
            item.component_type == component_type
            for item in project.components
        )
    if obj is None:
        return any(
            item.component_type == component_type and item.target_kind == "SCENE"
            for item in project.components
        )
    object_id = obj.get("blendlink_id")
    return any(
        item.component_type == component_type
        and item.target_kind == "OBJECT"
        and (
            _component_target(item) == obj
            or bool(object_id and item.target_id == object_id)
        )
        for item in project.components
    )


def _set_defaults(component, component_type: str):
    definition = component_schema.definition(component_type)
    if definition is None:
        return
    bindings = _DEFAULT_BINDINGS.get(component_type, {})
    for key, value in definition.get("defaults", {}).items():
        attribute = bindings.get(key)
        if attribute is not None:
            setattr(component, attribute, value)


def _new_component(project, component_type: str, *, obj=None):
    object_id = props._stable_id(obj) if obj is not None else ""
    initial_count = len(project.components)
    was_loading = props._loading_recipe
    had_dynamic = obj is not None and "blendlink_dynamic" in obj
    previous_dynamic = obj.get("blendlink_dynamic") if had_dynamic else None
    had_atlas = obj is not None and "blendlink_atlas" in obj
    previous_atlas = obj.get("blendlink_atlas") if had_atlas else None
    props._loading_recipe = True
    try:
        if component_type == "blendlink.website-surface":
            if obj is None:
                raise ValueError("Website Surface needs a selected Mesh")
            obj["blendlink_dynamic"] = 1
            if "blendlink_atlas" in obj:
                del obj["blendlink_atlas"]
            props._validate_website_surface_target(obj, obj.name)
        component = project.components.add()
        component.component_id = str(uuid.uuid4())
        component.component_type = component_type
        component.schema_version = component_schema.COMPONENT_SCHEMA_VERSION
        component.expanded = True
        component.raw_values = "{}"
        if obj is None:
            component.target_id = ""
            component.target_name = ""
            component.target_kind = "SCENE"
        else:
            component.target_id = object_id
            component.target_name = obj.name
            component.target_object = obj
        _set_defaults(component, component_type)
        if component_type == "blendlink.website-surface":
            base = re.sub(r"[^a-z0-9]+", "-", obj.name.lower()).strip("-")
            if not base or not base[0].isalpha():
                base = f"surface-{base}".rstrip("-")
            base = base[:64].rstrip("-") or "surface"
            used = {
                str(getattr(item, "website_surface_name", "") or "").strip()
                for item in project.components
                if item != component
                and item.component_type == "blendlink.website-surface"
            }
            candidate = base
            suffix = 2
            while candidate in used:
                tail = f"-{suffix}"
                candidate = f"{base[:64 - len(tail)].rstrip('-')}{tail}"
                suffix += 1
            component.website_surface_name = candidate
    except Exception:
        # A half-authored record must never survive an operator failure.
        if len(project.components) > initial_count:
            project.components.remove(len(project.components) - 1)
        if component_type == "blendlink.website-surface" and obj is not None:
            if had_dynamic:
                obj["blendlink_dynamic"] = previous_dynamic
            elif "blendlink_dynamic" in obj:
                del obj["blendlink_dynamic"]
            if had_atlas:
                obj["blendlink_atlas"] = previous_atlas
            elif "blendlink_atlas" in obj:
                del obj["blendlink_atlas"]
        raise
    finally:
        props._loading_recipe = was_loading
    return component


@dataclass
class ComponentActionResult:
    """Structured outcome for one catalog/copy/paste operation.

    Operators render the short summary, tests assert through ``as_dict()``,
    and the full JSON result is printed for automation. No target disappears
    into a boolean or a swallowed ``setattr`` failure.
    """

    action: str
    component_type: str = ""
    changed: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    def add(self, bucket: str, target: str, code: str, detail: str):
        getattr(self, bucket).append({
            "target": str(target), "code": str(code), "detail": str(detail),
        })

    def as_dict(self) -> dict:
        return {
            "action": self.action,
            "componentType": self.component_type,
            "changed": list(self.changed),
            "skipped": list(self.skipped),
            "errors": list(self.errors),
            "summary": {
                "changed": len(self.changed),
                "skipped": len(self.skipped),
                "errors": len(self.errors),
            },
        }

    def summary(self) -> str:
        label = component_schema.label(self.component_type) if self.component_type else "Component"
        action = self.action.replace("_", " ").title()
        counts = (
            f"{len(self.changed)} changed, {len(self.skipped)} skipped, "
            f"{len(self.errors)} error(s)"
        )
        detail = ""
        if self.errors:
            first = self.errors[0]
            detail = f"; {first['target']}: {first['detail']}"
        elif self.skipped:
            first = self.skipped[0]
            detail = f"; {first['target']}: {first['detail']}"
        return f"{action} {label}: {counts}{detail}"


def _raw_component_values(component) -> dict:
    try:
        values = json.loads(component.raw_values or "{}")
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError(f"Stored component values are not valid JSON: {error}") from error
    if not isinstance(values, dict):
        raise ValueError("Stored component values must be a JSON object")
    return values


def _clipboard_value(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "__len__"):
        return [_clipboard_value(item) for item in value]
    raise ValueError(f"{type(value).__name__} is not a portable component value")


def _component_values_for_clipboard(component) -> dict:
    """Capture an editor, including incomplete drafts and extension fields."""
    values = _raw_component_values(component)
    for json_key, attribute in _DEFAULT_BINDINGS.get(component.component_type, {}).items():
        values[json_key] = _clipboard_value(getattr(component, attribute))

    reference = getattr(component, "reference_object", None)
    if reference is not None:
        reference_id = props._stable_id(reference)
        if component.component_type == "blendlink.look-at":
            values.update(targetId=reference_id, targetName=reference.name)
        elif component.component_type == "blendlink.play-audio-on-click":
            values.update(sourceId=reference_id, sourceName=reference.name)
        elif component.component_type == "blendlink.depth-of-field":
            values.update(focusTargetId=reference_id, focusTargetName=reference.name)
    if component.component_type == "blendlink.depth-of-field" \
            and component.dof_focus_mode != "object":
        values.pop("focusTargetId", None)
        values.pop("focusTargetName", None)

    # Validate JSON portability without requiring an artist's draft to already
    # satisfy publish-time fields such as URL or animation clip.
    json.dumps(values, ensure_ascii=False, allow_nan=False)
    return values


def _component_by_id(project, component_id: str):
    return next(
        (item for item in project.components if item.component_id == component_id),
        None,
    )


def _component_target_label(component) -> str:
    if component.target_kind == "SCENE":
        return "Scene"
    target = _component_target(component)
    return target.name if target is not None else (component.target_name or "Missing object")


def _components_on_object(project, component_type: str, obj) -> list:
    return [
        item for item in project.components
        if item.component_type == component_type and _matches_object(item, obj)
    ]


def _validate_clipboard_payload(payload) -> dict:
    if not isinstance(payload, dict) or payload.get("clipboardVersion") != 1:
        raise ValueError("Clipboard does not contain a Blendlink component v1 record")
    component_type = payload.get("componentType")
    if not isinstance(component_type, str) or not re.fullmatch(
        r"[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+", component_type,
    ):
        raise ValueError("Clipboard component type is not a namespaced identifier")
    if payload.get("schemaVersion") != component_schema.COMPONENT_SCHEMA_VERSION:
        raise ValueError(
            f"Clipboard schema must be {component_schema.COMPONENT_SCHEMA_VERSION}"
        )
    if payload.get("targetKind") not in {"SCENE", "OBJECT"}:
        raise ValueError("Clipboard component target must be Scene or Object")
    if not isinstance(payload.get("enabled"), bool):
        raise ValueError("Clipboard component enabled state must be true or false")
    if not isinstance(payload.get("values"), dict):
        raise ValueError("Clipboard component values must be a JSON object")
    json.dumps(payload["values"], ensure_ascii=False, allow_nan=False)
    # Drafts may omit publish-required fields, but a field that is present
    # must already have its exact portable type and range.  Never let Python's
    # bool("false") or float("1") silently reinterpret malformed intent.
    props._validate_component_values(
        component_type, payload["values"], "Clipboard component values",
        require_complete=False,
    )
    return payload


def _read_component_clipboard(context) -> tuple[dict | None, str]:
    clipboard = str(getattr(context.window_manager, "clipboard", "") or "")
    if not clipboard and bpy.app.background and _component_clipboard_text:
        # Background Blender has no system clipboard. The same safe serialized
        # payload remains available for this process and test automation.
        clipboard = _component_clipboard_text
    if not clipboard.startswith(_CLIPBOARD_PREFIX):
        return None, "Copy a Blendlink component first"
    try:
        payload = json.loads(clipboard[len(_CLIPBOARD_PREFIX):])
        return _validate_clipboard_payload(payload), ""
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        return None, str(error)


def _write_component_clipboard(context, component) -> dict:
    global _component_clipboard_text
    payload = {
        "clipboardVersion": 1,
        "componentType": component.component_type,
        "schemaVersion": int(component.schema_version),
        "targetKind": component.target_kind,
        "enabled": bool(component.enabled),
        "values": _component_values_for_clipboard(component),
        "source": {
            "componentId": component.component_id,
            "target": _component_target_label(component),
        },
    }
    _validate_clipboard_payload(payload)
    clipboard = _CLIPBOARD_PREFIX + json.dumps(
        payload, ensure_ascii=False, allow_nan=False, sort_keys=True,
        separators=(",", ":"),
    )
    _component_clipboard_text = clipboard
    try:
        context.window_manager.clipboard = clipboard
    except (AttributeError, RuntimeError, TypeError) as error:
        print(
            "blendlink components: system clipboard unavailable; keeping the "
            f"versioned component clipboard in this Blender process: {error}"
        )
    return payload


def _hydrate_component_atomic(component, values: dict, scene):
    props._validate_component_values(
        component.component_type, values, "Clipboard component values",
        require_complete=False,
    )
    before = _component_values_for_clipboard(component)
    try:
        was_loading = props._loading_recipe
        props._loading_recipe = True
        try:
            props._hydrate_component_values(component, values, scene)
        finally:
            props._loading_recipe = was_loading
        reference_key = {
            "blendlink.look-at": "targetId",
            "blendlink.play-audio-on-click": "sourceId",
            "blendlink.depth-of-field": "focusTargetId",
        }.get(component.component_type)
        if reference_key and reference_key in values:
            expected = values[reference_key]
            resolved = getattr(component, "reference_object", None)
            matches = [
                obj for obj in scene.objects
                if isinstance(expected, str) and obj.get("blendlink_id") == expected
            ]
            if (
                not isinstance(expected, str) or not expected
                or len(matches) != 1 or resolved is not matches[0]
            ):
                raise ValueError(
                    f"copied {reference_key} {expected!r} does not resolve to "
                    "exactly one object in this Scene"
                )
        # Clipboard records may carry disabled, incomplete drafts. Once values
        # land on an enabled target, however, validate the fully hydrated
        # editor before committing so a batch action cannot report success and
        # then leave write_recipe() stuck on an invalid record.
        hydrated = _component_values_for_clipboard(component)
        props._validate_component_values(
            component.component_type, hydrated, "Pasted component values",
            require_complete=bool(component.enabled),
        )
    except (AttributeError, RuntimeError, TypeError, ValueError) as error:
        try:
            was_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                props._hydrate_component_values(component, before, scene)
            finally:
                props._loading_recipe = was_loading
        except (AttributeError, RuntimeError, TypeError, ValueError) as restore_error:
            raise RuntimeError(
                f"{error}; restoring the previous values also failed: {restore_error}"
            ) from error
        raise
    return hydrated != before


def _add_from_clipboard(project, scene, payload, result, *, obj=None):
    component_type = payload["componentType"]
    target_label = obj.name if obj is not None else "Scene"
    if obj is None:
        if not component_schema.supports_target(component_type, "SCENE"):
            result.add("skipped", target_label, "incompatible_target", "component is not scene-wide")
            return
        if _has_component(project, component_type):
            result.add("skipped", target_label, "already_exists", "already has this component")
            return
    else:
        if not component_schema.supports_target(component_type, _target_type(obj)):
            result.add(
                "skipped", target_label, "incompatible_target",
                f"{obj.type} is not a supported target",
            )
            return
        if _has_component(project, component_type, obj=obj):
            result.add("skipped", target_label, "already_exists", "already has this component")
            return

    initial_count = len(project.components)
    try:
        component = _new_component(project, component_type, obj=obj)
        component.enabled = payload["enabled"]
        _hydrate_component_atomic(component, payload["values"], scene)
        result.add(
            "changed", target_label, "created",
            f"created {component.component_id} with all {len(payload['values'])} value field(s)",
        )
    except (AttributeError, RuntimeError, TypeError, ValueError) as error:
        while len(project.components) > initial_count:
            project.components.remove(len(project.components) - 1)
        result.add("errors", target_label, "create_failed", str(error))


def run_component_action(
    context, action: str, *, component_id: str = "",
) -> ComponentActionResult:
    """Run COPY, COPY_AS_NEW, PASTE_NEW, or PASTE_VALUES through one interface."""
    global _last_component_action
    project = _project(context)
    result = ComponentActionResult(action=action)
    if project is None:
        result.add("errors", "Scene", "not_configured", "Blendlink is not configured")
        _last_component_action = result
        return result

    copied_payload = None
    if action in {"COPY", "COPY_AS_NEW"}:
        component = _component_by_id(project, component_id)
        if component is None:
            result.add("errors", "Component", "missing", "component no longer exists")
        else:
            result.component_type = component.component_type
            try:
                copied_payload = _write_component_clipboard(context, component)
                if action == "COPY":
                    result.add(
                        "changed", "Clipboard", "copied",
                        f"copied {_component_target_label(component)} with all "
                        f"{len(copied_payload['values'])} value field(s)",
                    )
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                result.add("errors", _component_target_label(component), "copy_failed", str(error))
        if action == "COPY" or result.errors:
            _last_component_action = result
            return result

    payload, clipboard_error = (
        (copied_payload, "") if copied_payload is not None
        else _read_component_clipboard(context)
    )
    if payload is None:
        result.add("errors", "Clipboard", "invalid", clipboard_error)
        _last_component_action = result
        return result
    result.component_type = payload["componentType"]
    scene = context.scene
    changed_project = False
    was_loading = props._loading_recipe
    props._loading_recipe = True
    try:
        if action in {"PASTE_NEW", "COPY_AS_NEW"}:
            if payload["targetKind"] == "SCENE":
                _add_from_clipboard(project, scene, payload, result)
            else:
                selected = _selected_editable(context)
                if not selected:
                    result.add(
                        "errors", "Selection", "empty",
                        "select one or more editable objects",
                    )
                for obj in selected:
                    _add_from_clipboard(project, scene, payload, result, obj=obj)
            changed_project = bool(result.changed)
        elif action == "PASTE_VALUES":
            anchor = _component_by_id(project, component_id)
            if anchor is None:
                result.add("errors", "Component", "missing", "component no longer exists")
            elif anchor.component_type != payload["componentType"]:
                result.add(
                    "errors", _component_target_label(anchor), "different_type",
                    f"clipboard contains {component_schema.label(payload['componentType'])}, "
                    f"not {component_schema.label(anchor.component_type)}",
                )
            elif anchor.target_kind != payload["targetKind"]:
                result.add(
                    "errors", _component_target_label(anchor), "different_target_kind",
                    "scene and object component values cannot be mixed",
                )
            elif anchor.target_kind == "SCENE":
                try:
                    changed = _hydrate_component_atomic(
                        anchor, payload["values"], scene,
                    )
                    if changed:
                        result.add(
                            "changed", "Scene", "values_pasted",
                            f"applied all {len(payload['values'])} value field(s)",
                        )
                    else:
                        result.add(
                            "skipped", "Scene", "already_matches",
                            "already has every copied value",
                        )
                except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                    result.add("errors", "Scene", "paste_failed", str(error))
            else:
                selected = _selected_editable(context)
                if not selected:
                    result.add(
                        "errors", "Selection", "empty",
                        "select one or more editable objects",
                    )
                for obj in selected:
                    if not component_schema.supports_target(
                        payload["componentType"], _target_type(obj),
                    ):
                        result.add(
                            "skipped", obj.name, "incompatible_target",
                            f"{obj.type} is not a supported target",
                        )
                        continue
                    matches = _components_on_object(project, payload["componentType"], obj)
                    if not matches:
                        result.add(
                            "skipped", obj.name, "missing_component",
                            "does not have this component",
                        )
                        continue
                    if len(matches) > 1:
                        result.add(
                            "errors", obj.name, "duplicate_components",
                            "has this component more than once; resolve Web Checks first",
                        )
                        continue
                    try:
                        changed = _hydrate_component_atomic(
                            matches[0], payload["values"], scene,
                        )
                        if changed:
                            result.add(
                                "changed", obj.name, "values_pasted",
                                f"applied all {len(payload['values'])} value field(s)",
                            )
                        else:
                            result.add(
                                "skipped", obj.name, "already_matches",
                                "already has every copied value",
                            )
                    except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                        result.add("errors", obj.name, "paste_failed", str(error))
            changed_project = bool(result.changed)
        else:
            result.add("errors", "Action", "unknown", f"unknown component action {action!r}")
    finally:
        props._loading_recipe = was_loading
    if changed_project:
        props._project_changed(project, context)
    _last_component_action = result
    return result


def _component_issues(project, component):
    scene = getattr(bpy.context, "scene", None)
    return component_validation.validate_component(
        project, component, scene=scene,
    )


def _component_icon(component_type: str) -> str:
    return _COMPONENT_ICONS.get(component_type, "PLUGIN")


def _draw_known_fields(layout, component, definition):
    component_type = component.component_type
    controls = layout.column(align=True)
    controls.use_property_split = True
    controls.use_property_decorate = False

    if component_type == "blendlink.bloom":
        controls.prop(component, "bloom_mode")
        controls.prop(component, "intensity")
        controls.prop(component, "threshold")
        controls.prop(component, "radius")
        return

    if component_type == "blendlink.chromatic-aberration":
        controls.prop(component, "chromatic_amount")
        controls.prop(component, "chromatic_mode")
        if component.chromatic_mode == "directional":
            controls.prop(component, "chromatic_angle")
        else:
            controls.prop(component, "chromatic_center_x")
            controls.prop(component, "chromatic_center_y")
        return

    if component_type == "blendlink.pixelation":
        controls.prop(component, "pixel_size")
        controls.prop(component, "pixel_depth_edge_strength")
        controls.prop(component, "pixel_normal_edge_strength")
        return

    if component_type == "blendlink.sharpen":
        controls.prop(component, "sharpen_amount")
        return

    if component_type == "blendlink.tilt-shift":
        controls.prop(component, "tilt_shift_focus_position")
        controls.prop(component, "tilt_shift_angle")
        controls.prop(component, "tilt_shift_feather")
        controls.prop(component, "tilt_shift_strength")
        controls.prop(component, "tilt_shift_quality")
        return

    if component_type == "blendlink.ambient-occlusion":
        controls.prop(component, "ao_radius_mode")
        if component.ao_radius_mode == "screen":
            controls.prop(component, "ao_screen_radius")
        else:
            controls.prop(component, "ao_world_radius")
        controls.prop(component, "ao_intensity")
        controls.prop(component, "ao_color")
        return

    if component_type == "blendlink.shadow-catcher":
        controls.prop(component, "shadow_catcher_mode")
        controls.prop(component, "shadow_catcher_include_descendants")
        if component.shadow_catcher_mode == "mask":
            controls.prop(component, "shadow_catcher_color")
            controls.prop(component, "shadow_catcher_opacity")
        if component.shadow_catcher_mode == "additive":
            controls.prop(component, "shadow_catcher_light_strength")
        return

    if component_type == "blendlink.contact-shadows":
        controls.prop(component, "contact_shadows_auto_fit")
        controls.prop(component, "contact_shadows_darkness")
        controls.prop(component, "contact_shadows_opacity")
        controls.prop(component, "contact_shadows_blur")
        controls.prop(component, "contact_shadows_occlude_below_ground")
        controls.prop(component, "contact_shadows_backface_shadows")
        controls.prop(component, "contact_shadows_update_policy")
        if (not component.contact_shadows_auto_fit
                and component.target_kind == "SCENE"):
            note = controls.box()
            note.alert = True
            note.label(
                text="Manual placement needs an Empty target.",
                icon="ERROR",
            )
        return

    if component_type == "blendlink.outline":
        controls.prop(component, "outline_visible_color")
        controls.prop(component, "outline_strength")
        controls.prop(component, "outline_thickness")
        controls.prop(component, "outline_xray")
        if component.outline_xray:
            controls.prop(component, "outline_hidden_color")
        return

    if component_type == "blendlink.color-grading":
        controls.prop(component, "color_grading_lut_url")
        controls.prop(component, "color_grading_intensity")
        controls.prop(component, "color_grading_tetrahedral")
        return

    if component_type == "blendlink.depth-of-field":
        controls.prop(component, "dof_focus_mode")
        if component.dof_focus_mode == "object":
            controls.prop(component, "reference_object", text="Focus Object")
        else:
            controls.prop(component, "dof_focus_distance")
        controls.prop(component, "dof_focus_range")
        controls.prop(component, "dof_blur_strength")
        return

    if component_type == "blendlink.play-animation-on-click":
        controls.prop(component, "accessibility_label")
        controls.prop_search(
            component, "animation_clip", bpy.data, "actions", text="Animation",
        )
        controls.prop(component, "animation_loop")
        return

    if component_type == "blendlink.audio-source":
        controls.prop(component, "audio_url", text="Audio URL")
        controls.prop(component, "autoplay")
        controls.prop(component, "audio_loop")
        controls.prop(component, "volume")
        controls.prop(component, "spatial", text="Spatial")
        if component.spatial:
            distance = controls.column(align=True)
            distance.prop(component, "min_distance", text="Full Volume")
            distance.prop(component, "max_distance", text="Silent Beyond")
        return

    fields = tuple(definition.get("fields", ()))
    if not fields:
        controls.label(text="No settings needed.", icon="CHECKMARK")
        return
    for field in fields:
        label = _FIELD_LABELS.get(field)
        if component_type == "blendlink.play-audio-on-click" and field == "reference_object":
            label = "Audio Source"
        if label:
            controls.prop(component, field, text=label)
        else:
            controls.prop(component, field)


def _draw_component_card(layout, context, project, component, index: int):
    definition = component_schema.definition(component.component_type)
    label = _CARD_LABELS.get(
        component.component_type,
        component_schema.label(component.component_type),
    )
    box = layout.box()
    header = box.row(align=True)
    header.prop(
        component,
        "expanded",
        text="",
        emboss=False,
        icon="TRIA_DOWN" if component.expanded else "TRIA_RIGHT",
    )
    header.prop(component, "enabled", text="")
    header.label(text=label, icon=_component_icon(component.component_type))
    actions = header.operator(
        "blendlink.open_component_actions", text="", icon="DOWNARROW_HLT",
    )
    actions.component_id = component.component_id
    remove = header.operator("blendlink.remove_component", text="", icon="X")
    remove.component_id = component.component_id
    remove.component_index = index
    if not component.expanded:
        return

    content = box.column()
    if not component.enabled:
        _wrap(
            content,
            "Disabled - stored in the project, but not run on the website. You can still edit it here.",
            icon="PAUSE",
        )

    if definition is not None:
        _wrap(content, definition["description"], icon="INFO")
        badges = content.row(align=True)
        badges.label(text=component_schema.target_badge(definition), icon="OBJECT_DATA")
        badges.label(text=component_schema.cost_badge(definition), icon="TIME")
        docs_url = definition.get("docs_url", "")
        if docs_url:
            docs = badges.operator("wm.url_open", text="Docs", icon="HELP")
            docs.url = docs_url
        _wrap(
            content, definition.get("compatibility", "Three.js"),
            icon="WORLD", width=58,
        )
        adapter_row = content.row(align=True)
        for adapter in ("webgl", "tsl"):
            level = definition.get("adapters", {}).get(adapter, "unavailable")
            icon = "CHECKMARK" if level == "production" else "INFO" if level in {"preview", "fallback"} else "ERROR"
            adapter_row.label(
                text=component_schema.adapter_badge(definition, adapter), icon=icon,
            )
        for adapter, label in (("webgl", "WebGL"), ("tsl", "WebGPU")):
            fallback = definition.get("fallbacks", {}).get(adapter)
            level = definition.get("adapters", {}).get(adapter)
            if fallback and level != "production":
                note = "preview" if level == "preview" else "fallback"
                _wrap(content, f"{label} {note}: {fallback}", icon="INFO", width=58)
        consequence = definition.get("consequence")
        if consequence:
            _wrap(content, consequence, icon="INFO", width=58)
    else:
        _wrap(content, component.component_type, icon="PLUGIN", width=64)

    if component.target_kind != "SCENE":
        target_row = content.row(align=True)
        target_row.use_property_split = True
        target_row.use_property_decorate = False
        target_row.prop(component, "target_object", text="Object")
        target = component_validation.target_for(context.scene, component)
        if target is not None:
            select = target_row.operator(
                "blendlink.select_issue", text="Select", icon="RESTRICT_SELECT_OFF",
            )
            select.object_name = target.name

    for issue in _component_issues(project, component):
        warning = content.box()
        warning.alert = issue.blocking
        _wrap(
            warning, issue.message,
            icon="ERROR" if issue.blocking else "INFO",
        )

    if definition is None:
        try:
            raw = json.dumps(json.loads(component.raw_values or "{}"), separators=(",", ":"))
        except (TypeError, json.JSONDecodeError):
            raw = component.raw_values or "<invalid JSON>"
        _wrap(content, f"Stored values: {raw}", icon="TEXT", width=64)
        return

    _draw_known_fields(content, component, definition)
    cost = definition.get("cost")
    if cost:
        _wrap(content, cost, icon="INFO", width=58)


def _draw_cards(layout, context, project, entries, empty_message: str):
    entries = list(entries)
    if not entries:
        quiet = layout.box()
        _wrap(quiet, empty_message, icon="INFO")
        return
    for index, component in entries:
        _draw_component_card(layout, context, project, component, index)


def _catalog_types(target_mode: str):
    for category in component_schema.COMPONENT_CATEGORIES:
        matches = []
        for component_type, definition in component_schema.COMPONENT_DEFINITIONS.items():
            if definition["category"] != category:
                continue
            if target_mode == "SCENE" and component_schema.supports_target(
                component_type, "SCENE",
            ):
                matches.append(component_type)
            elif target_mode == "SELECTION" and (
                "OBJECT" in definition["targets"] or "MESH" in definition["targets"]
            ):
                matches.append(component_type)
        if matches:
            yield category, matches


def _draw_catalog(layout, context, target_mode: str):
    selection = _selected_editable(context)
    for category, component_types in _catalog_types(target_mode):
        layout.label(text=category, icon=_CATEGORY_ICONS.get(category, "DOT"))
        for component_type in component_types:
            definition = component_schema.definition(component_type)
            row = layout.row()
            if target_mode == "SELECTION":
                row.enabled = any(
                    component_schema.supports_target(component_type, _target_type(obj))
                    for obj in selection
                )
            operator = row.operator(
                "blendlink.add_component",
                text=definition["label"],
                icon=_component_icon(component_type),
            )
            operator.component_type = component_type
            operator.target_mode = target_mode
        layout.separator()


def _draw_physics_shortcuts(layout):
    physics = layout.box()
    physics.label(text=PHYSICS_DESIGNATION_TITLE, icon="PHYSICS")
    _wrap(
        physics,
        PHYSICS_DESIGNATION_NOTE,
        width=54,
    )
    actions = physics.row(align=True)
    actions.operator("blendlink.tag_rigid", text="Tag Rigid Body", icon="RIGID_BODY")
    actions.operator_menu_enum(
        "blendlink.tag_collider", "kind", text="Tag Collider", icon="MESH_ICOSPHERE",
    )


def _catalog_target_counts(context, project, component_type: str, target_mode: str) -> dict:
    if target_mode == "SCENE":
        existing = 1 if _has_component(project, component_type) else 0
        return {"selected": 1, "compatible": 1, "existing": existing, "ready": 1 - existing}
    selected = _selected_editable(context)
    compatible = [
        obj for obj in selected
        if component_schema.supports_target(component_type, _target_type(obj))
    ]
    existing = sum(
        1 for obj in compatible if _has_component(project, component_type, obj=obj)
    )
    return {
        "selected": len(selected), "compatible": len(compatible),
        "existing": existing, "ready": len(compatible) - existing,
    }


def _draw_catalog_entry(layout, context, project, component_type: str, definition, target_mode: str):
    counts = _catalog_target_counts(context, project, component_type, target_mode)
    box = layout.box()
    heading = box.row(align=True)
    heading.label(text=definition["label"], icon=_component_icon(component_type))
    action = heading.row(align=True)
    action.enabled = counts["ready"] > 0
    if counts["ready"]:
        button_text = (
            "Add to Scene" if target_mode == "SCENE"
            else f"Add to {counts['ready']} object(s)"
        )
        button_icon = "ADD"
    else:
        button_text = (
            "Already on Scene" if target_mode == "SCENE" and counts["existing"]
            else "Already on selection" if counts["existing"]
            else "No compatible selection"
        )
        button_icon = "CHECKMARK" if counts["existing"] else "ERROR"
    operator = action.operator(
        "blendlink.add_component", text=button_text, icon=button_icon,
    )
    operator.component_type = component_type
    operator.target_mode = target_mode
    docs = heading.operator("wm.url_open", text="", icon="HELP")
    docs.url = definition["docs_url"]

    _wrap(box, definition["description"], width=72)
    badges = box.row(align=True)
    badges.label(text=component_schema.target_badge(definition), icon="OBJECT_DATA")
    badges.label(text=component_schema.cost_badge(definition), icon="TIME")
    badges.label(text=definition["support"], icon="CHECKMARK")
    _wrap(box, component_schema.support_badge(definition), icon="WORLD", width=72)
    if target_mode == "SELECTION" and counts["selected"]:
        incompatible = counts["selected"] - counts["compatible"]
        status = []
        if counts["existing"]:
            status.append(f"{counts['existing']} existing skipped")
        if incompatible:
            status.append(f"{incompatible} incompatible skipped")
        if status:
            _wrap(box, "; ".join(status), icon="INFO", width=72)
    _wrap(box, definition["consequence"], icon="INFO", width=72)
    _wrap(box, definition["cost"], icon="TIME", width=72)


_CATEGORY_ITEMS = (("ALL", "All", "Show every compatible component"),) + tuple(
    (category, category, f"Show {category} components")
    for category in component_schema.COMPONENT_CATEGORIES
)


class BLENDLINK_OT_browse_components(bpy.types.Operator):
    """Search the supported website effect and behavior catalog"""

    bl_idname = "blendlink.browse_components"
    bl_label = "Add Website Component"
    bl_options = {"REGISTER", "INTERNAL"}
    bl_property = "search"

    search: bpy.props.StringProperty(
        name="Search",
        description="Search names, artist tasks, consequences and compatibility",
        default="",
    )
    category: bpy.props.EnumProperty(name="Category", items=_CATEGORY_ITEMS, default="ALL")
    target_mode: bpy.props.EnumProperty(
        items=(
            ("SCENE", "Scene", "Browse scene-wide effects"),
            ("SELECTION", "Selection", "Browse behaviors for editable selected objects"),
        ),
        default="SELECTION",
        options={"HIDDEN"},
    )

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def invoke(self, context, event):
        self.search = ""
        self.category = "ALL"
        return context.window_manager.invoke_popup(self, width=880)

    def check(self, context):
        return True

    def execute(self, context):
        return {"FINISHED"}

    def draw(self, context):
        layout = self.layout
        project = _project(context)
        search = layout.row(align=True)
        search.activate_init = True
        search.prop(self, "search", text="", icon="VIEWZOOM")
        if self.search:
            clear = search.operator("blendlink.clear_component_search", text="", icon="X")
            clear.target_mode = self.target_mode

        split = layout.split(factor=0.18)
        categories = split.box().column(align=True)
        categories.label(text="Categories", icon="FILE_FOLDER")
        categories.prop(self, "category", expand=True)
        results_layout = split.column()
        matches = component_schema.search_catalog(
            self.search, category=self.category, target_mode=self.target_mode,
        )
        target_text = (
            "Scene" if self.target_mode == "SCENE"
            else f"{len(_selected_editable(context))} editable object(s)"
        )
        results_layout.label(
            text=f"{len(matches)} result(s) for {target_text}", icon="PLUGIN",
        )
        if not matches:
            empty = results_layout.box()
            _wrap(
                empty,
                "No compatible component matches this search. Try a task such as glow, "
                "sound, click, visibility, or animation.",
                icon="INFO", width=66,
            )
            return
        for component_type, definition in matches:
            _draw_catalog_entry(
                results_layout, context, project, component_type, definition, self.target_mode,
            )


class BLENDLINK_OT_clear_component_search(bpy.types.Operator):
    """Reopen the component browser with an empty search"""

    bl_idname = "blendlink.clear_component_search"
    bl_label = "Clear Component Search"
    bl_options = {"INTERNAL"}

    target_mode: bpy.props.StringProperty(default="SELECTION", options={"HIDDEN"})

    def execute(self, context):
        # A popup operator cannot mutate the owning operator from a nested
        # button. Reopening is deterministic and immediately focuses search.
        bpy.ops.blendlink.browse_components("INVOKE_DEFAULT", target_mode=self.target_mode)
        return {"FINISHED"}


def _finish_component_operator(operator, result: ComponentActionResult):
    operator.result_json = json.dumps(
        result.as_dict(), ensure_ascii=False, allow_nan=False, sort_keys=True,
        separators=(",", ":"),
    )
    print("##blendlink-component-action " + operator.result_json)
    if result.errors:
        operator.report({"WARNING" if result.changed else "ERROR"}, result.summary())
    elif result.skipped:
        operator.report({"WARNING"}, result.summary())
    else:
        operator.report({"INFO"}, result.summary())
    return {"FINISHED"} if result.changed else {"CANCELLED"}


class BLENDLINK_OT_copy_component(bpy.types.Operator):
    """Copy this component, including extension values, as safe versioned JSON"""

    bl_idname = "blendlink.copy_component"
    bl_label = "Copy Component Values"
    bl_options = {"REGISTER"}

    component_id: bpy.props.StringProperty(options={"HIDDEN"})
    result_json: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def execute(self, context):
        return _finish_component_operator(
            self, run_component_action(context, "COPY", component_id=self.component_id),
        )


class BLENDLINK_OT_copy_component_as_new(bpy.types.Operator):
    """Copy this component directly onto every compatible selected target"""

    bl_idname = "blendlink.copy_component_as_new"
    bl_label = "Copy as New Component"
    bl_options = {"REGISTER", "UNDO"}

    component_id: bpy.props.StringProperty(options={"HIDDEN"})
    result_json: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def execute(self, context):
        return _finish_component_operator(
            self,
            run_component_action(context, "COPY_AS_NEW", component_id=self.component_id),
        )


class BLENDLINK_OT_paste_component_as_new(bpy.types.Operator):
    """Create the copied component on every compatible selected target; skip existing records"""

    bl_idname = "blendlink.paste_component_as_new"
    bl_label = "Paste as New Component"
    bl_options = {"REGISTER", "UNDO"}

    result_json: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def execute(self, context):
        return _finish_component_operator(self, run_component_action(context, "PASTE_NEW"))


class BLENDLINK_OT_paste_component_values(bpy.types.Operator):
    """Paste every copied field onto same-type components across the editable selection"""

    bl_idname = "blendlink.paste_component_values"
    bl_label = "Paste Component Values"
    bl_options = {"REGISTER", "UNDO"}

    component_id: bpy.props.StringProperty(options={"HIDDEN"})
    result_json: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def execute(self, context):
        return _finish_component_operator(
            self,
            run_component_action(context, "PASTE_VALUES", component_id=self.component_id),
        )


class BLENDLINK_OT_open_component_actions(bpy.types.Operator):
    """Open copy and paste actions for this website component"""

    bl_idname = "blendlink.open_component_actions"
    bl_label = "Component Actions"
    bl_options = {"INTERNAL"}

    component_id: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        BLENDLINK_MT_component_actions.component_id = self.component_id
        bpy.ops.wm.call_menu(name=BLENDLINK_MT_component_actions.bl_idname)
        return {"FINISHED"}


class BLENDLINK_MT_component_actions(bpy.types.Menu):
    bl_idname = "BLENDLINK_MT_component_actions"
    bl_label = "Component Actions"

    component_id = ""

    def draw(self, context):
        layout = self.layout
        project = _project(context)
        component = _component_by_id(project, self.component_id) if project is not None else None
        if component is None:
            layout.label(text="Component no longer exists", icon="ERROR")
            return
        copy = layout.operator("blendlink.copy_component", text="Copy Values", icon="COPYDOWN")
        copy.component_id = component.component_id
        if component.target_kind == "OBJECT":
            copy_new = layout.operator(
                "blendlink.copy_component_as_new",
                text="Copy as New on Selection",
                icon="DUPLICATE",
            )
            copy_new.component_id = component.component_id
        layout.separator()
        payload, error = _read_component_clipboard(context)
        if payload is None:
            quiet = layout.row()
            quiet.enabled = False
            quiet.label(text=error, icon="INFO")
            return
        layout.label(
            text=f"Clipboard: {component_schema.label(payload['componentType'])}",
            icon="PASTEDOWN",
        )
        layout.operator(
            "blendlink.paste_component_as_new",
            text="Paste as New on Selection" if payload["targetKind"] == "OBJECT" else "Paste as New on Scene",
            icon="PASTEDOWN",
        )
        compatible = (
            component.component_type == payload["componentType"]
            and component.target_kind == payload["targetKind"]
        )
        row = layout.row()
        row.enabled = compatible
        paste = row.operator(
            "blendlink.paste_component_values",
            text="Paste Values on Selection" if component.target_kind == "OBJECT" else "Paste Values",
            icon="PASTEFLIPDOWN",
        )
        paste.component_id = component.component_id
        if not compatible:
            warning = layout.row()
            warning.enabled = False
            warning.label(text="Paste Values requires the same component type", icon="ERROR")


class BLENDLINK_OT_add_component(bpy.types.Operator):
    """Add a portable website effect or behavior"""

    bl_idname = "blendlink.add_component"
    bl_label = "Add Website Component"
    bl_options = {"REGISTER", "UNDO"}

    component_type: bpy.props.StringProperty(options={"HIDDEN"})
    target_mode: bpy.props.EnumProperty(
        items=(
            ("SCENE", "Scene", "Add one scene-wide effect"),
            ("SELECTION", "Selection", "Add to each compatible selected object"),
        ),
        default="SELECTION",
        options={"HIDDEN"},
    )

    @classmethod
    def poll(cls, context):
        if not _configured(context):
            cls.poll_message_set("Set up this scene for Blendlink first")
            return False
        return True

    @classmethod
    def description(cls, context, properties):
        definition = component_schema.definition(getattr(properties, "component_type", ""))
        return definition["description"] if definition is not None else cls.__doc__

    def execute(self, context):
        project = _project(context)
        definition = component_schema.definition(self.component_type)
        if definition is None:
            self.report({"ERROR"}, f"No component definition for {self.component_type!r}")
            return {"CANCELLED"}

        if self.target_mode == "SCENE":
            if not component_schema.supports_target(self.component_type, "SCENE"):
                self.report({"ERROR"}, f"{definition['label']} is not a scene-wide effect")
                return {"CANCELLED"}
            if _has_component(project, self.component_type):
                self.report({"WARNING"}, f"{definition['label']} is already on this Scene")
                return {"CANCELLED"}
            try:
                _new_component(project, self.component_type)
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                self.report({"ERROR"}, f"Could not add {definition['label']}: {error}")
                return {"CANCELLED"}
            props._project_changed(project, context)
            self.report({"INFO"}, f"Added {definition['label']} to the website scene")
            return {"FINISHED"}

        selected = _selected_editable(context)
        compatible = [
            obj for obj in selected
            if component_schema.supports_target(self.component_type, _target_type(obj))
        ]
        incompatible = len(selected) - len(compatible)
        if not compatible:
            wanted = "a mesh" if definition["targets"] == {"MESH"} else "an editable object"
            self.report({"ERROR"}, f"Select {wanted} for {definition['label']}")
            return {"CANCELLED"}

        added = 0
        duplicates = 0
        failures = []
        for obj in compatible:
            if _has_component(project, self.component_type, obj=obj):
                duplicates += 1
                continue
            try:
                _new_component(project, self.component_type, obj=obj)
                added += 1
            except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                failures.append(f"{obj.name}: {error}")
        props._project_changed(project, context)
        if failures:
            self.report(
                {"WARNING"},
                f"Added to {added}; failed {len(failures)}: {'; '.join(failures[:3])}",
            )
        elif added:
            notes = []
            if duplicates:
                notes.append(f"{duplicates} already had it")
            if incompatible:
                notes.append(f"{incompatible} incompatible selection(s) skipped")
            note = f"; {'; '.join(notes)}" if notes else ""
            self.report(
                {"INFO"}, f"Added {definition['label']} to {added} object(s){note}",
            )
        else:
            self.report({"WARNING"}, f"Every compatible object already has {definition['label']}")
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_remove_component(bpy.types.Operator):
    """Remove this website component without changing unrelated object settings"""

    bl_idname = "blendlink.remove_component"
    bl_label = "Remove Website Component"
    bl_options = {"REGISTER", "UNDO"}

    component_id: bpy.props.StringProperty(options={"HIDDEN"})
    component_index: bpy.props.IntProperty(default=-1, options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def execute(self, context):
        project = _project(context)
        index = next(
            (
                candidate for candidate, component in enumerate(project.components)
                if self.component_id and component.component_id == self.component_id
            ),
            self.component_index,
        )
        if not 0 <= index < len(project.components):
            self.report({"ERROR"}, "That website component no longer exists")
            return {"CANCELLED"}
        label = component_schema.label(project.components[index].component_type)
        project.components.remove(index)
        project.component_index = min(
            max(0, int(project.component_index)), max(0, len(project.components) - 1),
        )
        props._project_changed(project, context)
        self.report({"INFO"}, f"Removed {label}")
        return {"FINISHED"}


class BLENDLINK_MT_add_scene_component(bpy.types.Menu):
    bl_idname = "BLENDLINK_MT_add_scene_component"
    bl_label = "Add Scene Effect"

    def draw(self, context):
        _draw_catalog(self.layout, context, "SCENE")


class BLENDLINK_MT_add_object_component(bpy.types.Menu):
    bl_idname = "BLENDLINK_MT_add_object_component"
    bl_label = "Add Behavior to Selection"

    def draw(self, context):
        _draw_catalog(self.layout, context, "SELECTION")
        self.layout.label(text=PHYSICS_DESIGNATION_TITLE, icon="PHYSICS")
        self.layout.label(text=PHYSICS_DESIGNATION_NOTE, icon="INFO")
        self.layout.operator("blendlink.tag_rigid", text="Tag Rigid Body", icon="RIGID_BODY")
        self.layout.operator_menu_enum(
            "blendlink.tag_collider", "kind", text="Tag Collider", icon="MESH_ICOSPHERE",
        )


class _BlendlinkSceneComponentsMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "scene"


class _BlendlinkObjectComponentsMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "object"


class BLENDLINK_PT_scene_components(_BlendlinkSceneComponentsMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_scene_components"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Website Effects & Behaviors"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 20

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def draw(self, context):
        layout = self.layout
        project = _project(context)
        _wrap(
            layout,
            "Add portable website behavior without writing JavaScript. Scene "
            "effects apply once; object behaviors travel with stable object identities.",
            icon="INFO",
        )
        row = layout.row()
        browse = row.operator(
            "blendlink.browse_components", text="Add Scene Effect", icon="ADD",
        )
        browse.target_mode = "SCENE"
        clipboard, _ = _read_component_clipboard(context)
        if clipboard is not None and clipboard["targetKind"] == "SCENE":
            row.operator(
                "blendlink.paste_component_as_new", text="Paste as New", icon="PASTEDOWN",
            )
        scene_entries = [
            (index, component)
            for index, component in enumerate(project.components)
            if component.target_kind == "SCENE"
        ]
        layout.label(text="Scene Effects", icon="SCENE_DATA")
        _draw_cards(
            layout, context, project, scene_entries,
            "No scene effects yet. The website keeps its normal renderer output.",
        )

        imported = [
            (index, component)
            for index, component in enumerate(project.components)
            if component.target_kind != "SCENE"
            and (
                component_schema.definition(component.component_type) is None
                or _component_target(component) is None
            )
        ]
        if imported:
            layout.separator()
            layout.label(text="Imported Records Needing Attention", icon="ERROR")
            _draw_cards(layout, context, project, imported, "")


class BLENDLINK_PT_object_components(_BlendlinkObjectComponentsMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_object_components"
    bl_parent_id = "BLENDLINK_PT_designation"
    bl_label = "Web Behaviors"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 20

    @classmethod
    def poll(cls, context):
        project = _project(context)
        obj = getattr(context, "object", None) or getattr(context, "active_object", None)
        return project is not None and project.configured and obj is not None

    def draw(self, context):
        layout = self.layout
        project = _project(context)
        obj = getattr(context, "object", None) or context.active_object
        selected = _selected_editable(context)
        if obj not in selected:
            warning = layout.box()
            warning.alert = True
            _wrap(
                warning,
                "Select this object before adding or editing website behaviors.",
                icon="ERROR",
            )
            return
        selection_count = len(selected)
        _wrap(
            layout,
            (
                f"Add affects all {selection_count} selected objects."
                if selection_count > 1 else f"Behaviors on {obj.name}"
            ),
            icon="RESTRICT_SELECT_OFF",
        )
        actions = layout.row(align=True)
        browse = actions.operator(
            "blendlink.browse_components", text="Add Behavior to Selection", icon="ADD",
        )
        browse.target_mode = "SELECTION"
        clipboard, _ = _read_component_clipboard(context)
        if clipboard is not None and clipboard["targetKind"] == "OBJECT":
            actions.operator(
                "blendlink.paste_component_as_new", text="Paste as New", icon="PASTEDOWN",
            )
        entries = [
            (index, component)
            for index, component in enumerate(project.components)
            if _matches_object(component, obj)
        ]
        _draw_cards(
            layout, context, project, entries,
            "No website behaviors on this object yet.",
        )
        _draw_physics_shortcuts(layout)


class BLENDLINK_PT_components_sidebar(bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_components_sidebar"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Effects & Behaviors"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 15

    @classmethod
    def poll(cls, context):
        return _configured(context)

    def draw(self, context):
        layout = self.layout
        project = _project(context)
        scene_entries = [
            (index, component)
            for index, component in enumerate(project.components)
            if component.target_kind == "SCENE"
        ]
        heading = layout.row(align=True)
        heading.label(text="Scene Effects", icon="SCENE_DATA")
        actions = layout.row(align=True)
        browse = actions.operator(
            "blendlink.browse_components", text=SCENE_CATALOG_ACTION_LABEL, icon="ADD",
        )
        browse.target_mode = "SCENE"
        clipboard, _ = _read_component_clipboard(context)
        if clipboard is not None and clipboard["targetKind"] == "SCENE":
            actions.operator("blendlink.paste_component_as_new", text="", icon="PASTEDOWN")
        _draw_cards(
            layout, context, project, scene_entries,
            SCENE_EMPTY_MESSAGE,
        )

        obj = getattr(context, "active_object", None)
        selected = _selected_editable(context)
        if obj is None or obj not in selected:
            layout.separator()
            _wrap(
                layout,
                "Select an editable object to browse and author its website behaviors.",
                icon="INFO",
            )
            return
        layout.separator()
        object_heading = layout.row(align=True)
        object_heading.label(text=f"{obj.name} Behaviors", icon="OBJECT_DATA")
        object_actions = layout.row(align=True)
        browse = object_actions.operator(
            "blendlink.browse_components", text=BEHAVIOR_CATALOG_ACTION_LABEL, icon="ADD",
        )
        browse.target_mode = "SELECTION"
        clipboard, _ = _read_component_clipboard(context)
        if clipboard is not None and clipboard["targetKind"] == "OBJECT":
            object_actions.operator(
                "blendlink.paste_component_as_new", text="", icon="PASTEDOWN",
            )
        selection_count = len(selected)
        if selection_count > 1:
            _wrap(
                layout,
                f"Cards show the active object. Add affects all {selection_count} selected objects.",
                icon="RESTRICT_SELECT_OFF",
            )
        entries = [
            (index, component)
            for index, component in enumerate(project.components)
            if _matches_object(component, obj)
        ]
        _draw_cards(
            layout, context, project, entries,
            BEHAVIOR_EMPTY_MESSAGE,
        )
        _draw_physics_shortcuts(layout)


classes = (
    BLENDLINK_OT_browse_components,
    BLENDLINK_OT_clear_component_search,
    BLENDLINK_OT_copy_component,
    BLENDLINK_OT_copy_component_as_new,
    BLENDLINK_OT_paste_component_as_new,
    BLENDLINK_OT_paste_component_values,
    BLENDLINK_OT_open_component_actions,
    BLENDLINK_MT_component_actions,
    BLENDLINK_OT_add_component,
    BLENDLINK_OT_remove_component,
    BLENDLINK_MT_add_scene_component,
    BLENDLINK_MT_add_object_component,
    BLENDLINK_PT_scene_components,
    BLENDLINK_PT_object_components,
    BLENDLINK_PT_components_sidebar,
)
