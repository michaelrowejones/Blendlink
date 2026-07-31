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

from . import (
    component_validation,
    consequence_gizmos,
    material_compiler,
    procedural,
    vocab,
    weblights,
)
from .bakelib_loader import bakelib


@dataclass
class OverlayItem:
    kind: str  # 'collider' | 'socket' | 'hotspot' | 'audio'
    shape: str  # 'box' | 'sphere' | 'axes' | 'cross'
    matrix: Matrix
    label: str = ""
    color: tuple = (1.0, 1.0, 1.0, 1.0)
    matrix_resolver: object | None = field(
        default=None, repr=False, compare=False,
    )

    def resolved_matrix(self):
        """Resolve only the cheap current transform during viewport drawing."""
        if self.matrix_resolver is None:
            return self.matrix
        try:
            return self.matrix_resolver()
        except (AttributeError, ReferenceError, RuntimeError, ValueError):
            # Removed/temporarily invalid Blender data disappears on the next
            # cached scan. Avoid destabilizing the draw handler in between.
            return None


@dataclass
class FidelityItem:
    object_name: str
    source: str
    route: str  # Preserve | Realize | Bake | Runtime | Cache | Block
    detail: str
    blocking: bool = False


@dataclass(frozen=True)
class RenderingAnalysis:
    """Cached facts used to explain an object's effective web rendering."""
    authored_mode: str = "AUTO"
    dynamic_reason: str | None = None
    forced_bake_risk: str | None = None
    automatic_bake_reason: str | None = None


@dataclass
class ScanResult:
    issues: list = field(default_factory=list)
    overlay: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)
    fidelity: list = field(default_factory=list)
    rendering_analysis: dict[str, RenderingAnalysis] = field(default_factory=dict)
    material_compatibility: dict[str, dict] = field(default_factory=dict)
    light_diagnostics: dict[str, dict] = field(default_factory=dict)
    consequence_gizmo_counts: dict[str, int] = field(default_factory=dict)


_state = {"dirty": True, "result": ScanResult(), "rendering_revision": 0}

_COLLIDER_COLOR = (0.30, 0.85, 0.45, 0.9)
_HOTSPOT_COLOR = (1.00, 0.62, 0.15, 0.95)
_AUDIO_COLOR = (0.25, 0.80, 0.95, 0.95)


def mark_dirty():
    _state["dirty"] = True
    try:
        from . import presentation_ui
        presentation_ui.mark_cache_dirty()
    except (AttributeError, ImportError):
        pass


def is_dirty() -> bool:
    return _state["dirty"]


def result() -> ScanResult:
    return _state["result"]


def rendering_revision() -> int:
    """Revision of cached Baked/Realtime analysis used by session tables."""
    return int(_state["rendering_revision"])


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
            return OverlayItem(
                "collider", shape, matrix, color=_COLLIDER_COLOR,
                matrix_resolver=lambda obj=obj: (
                    obj.matrix_world @ Matrix.Scale(obj.empty_display_size * 2.0, 4)
                ),
            )
        if obj.type == "MESH":
            return OverlayItem(
                "collider", "box", _bound_box_matrix(obj), color=_COLLIDER_COLOR,
                matrix_resolver=lambda obj=obj: _bound_box_matrix(obj),
            )
        return None
    if classification.kind == "socket":
        return OverlayItem(
            "socket", "axes", _empty_matrix(obj),
            label=classification.anchor_name or "",
            matrix_resolver=lambda obj=obj: _empty_matrix(obj),
        )
    if classification.kind == "hotspot":
        return OverlayItem(
            "hotspot", "cross", _empty_matrix(obj),
            label=classification.anchor_name or "", color=_HOTSPOT_COLOR,
            matrix_resolver=lambda obj=obj: _empty_matrix(obj),
        )
    if classification.kind == "audio":
        return OverlayItem(
            "audio", "cross", _empty_matrix(obj),
            label=classification.anchor_name or "", color=_AUDIO_COLOR,
            matrix_resolver=lambda obj=obj: _empty_matrix(obj),
        )
    return None


def _rendering_analysis_for(
        obj, *, fixed_camera_appearance: bool = False) -> RenderingAnalysis:
    """Run the material/animation safety policy once, outside Blender draw."""
    if obj.type != "MESH":
        return RenderingAnalysis()
    explicit = obj.get("blendlink_dynamic")
    authored_mode = (
        "AUTO" if explicit is None else "DYNAMIC" if bool(explicit) else "BAKED"
    )
    return RenderingAnalysis(
        authored_mode=authored_mode,
        dynamic_reason=procedural.effective_dynamic_reason(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        ),
        forced_bake_risk=procedural.forced_bake_risk(obj),
        automatic_bake_reason=(
            procedural.fixed_camera_appearance_bake_reason(obj)
            if fixed_camera_appearance else None
        ),
    )


def _fidelity_for(
        obj, rendering_analysis: RenderingAnalysis | None = None,
) -> list[FidelityItem]:
    """Explain the compile route for procedural/evaluated scene features.

    This is intentionally conservative. Blender's evaluated mesh can preserve
    a still result, but node graphs, simulation state, and arbitrary named
    attributes are not portable glTF runtime programs.
    """
    pointer_reason = procedural.pointer_animation_reason(obj)
    if obj.type != "MESH" and pointer_reason:
        return [FidelityItem(
            obj.name, f"{obj.type.title()} animation", "Block",
            f"{pointer_reason}. Standard Three.js does not bind KHR_animation_pointer; "
            "animate this property in website code or remove the property animation.",
            blocking=True,
        )]
    if obj.type != "MESH":
        return []
    modifiers = [modifier for modifier in obj.modifiers
                 if modifier.type == "NODES" and modifier.show_render]
    if modifiers:
        # Geometry Nodes use the shared procedural analyzer below. Keeping the
        # ordinary-mesh path here avoids evaluating every mesh in the scene.
        return []
    rendering_analysis = rendering_analysis or _rendering_analysis_for(obj)
    forced_risk = rendering_analysis.forced_bake_risk
    if forced_risk:
        return [FidelityItem(
            obj.name, "Mesh + Material", "Bake",
            f"Explicit Baked override freezes {forced_risk}. This is intentional but will not follow runtime motion or view changes.",
        )]
    if pointer_reason:
        return [FidelityItem(
            obj.name, "Material animation", "Block",
            f"{pointer_reason}. Standard Three.js does not bind KHR_animation_pointer; "
            "animate this property in website code, or explicitly choose Baked to freeze it.",
            blocking=True,
        )]
    if rendering_analysis.automatic_bake_reason:
        return [FidelityItem(
            obj.name, "Mesh + Material", "Bake",
            "Fixed-camera Bake Appearance captures this opaque camera-dependent "
            f"surface from the authored active camera: "
            f"{rendering_analysis.automatic_bake_reason}.",
        )]
    runtime_reason = rendering_analysis.dynamic_reason
    if runtime_reason:
        return [FidelityItem(
            obj.name, "Mesh + Material", "Runtime",
            f"Keeps its glTF material and website lighting: {runtime_reason}.",
        )]
    return [FidelityItem(
        obj.name, "Mesh", "Preserve",
        "Exports as ordinary glTF geometry.",
    )]


def _procedural_fidelity(record: dict) -> list[FidelityItem]:
    """Shared analyzer facts -> concise artist-facing compiler routes."""
    obj = record["object"]
    modifiers = record.get("modifiers", [])
    source = ", ".join(
        item.get("nodeGroup") or item.get("name", "Geometry Nodes")
        for item in modifiers
    ) or "Geometry Nodes"
    delta = record.get("sourceDelta", {})
    delta_text = (
        f" Evaluated delta: {delta.get('vertices', 0):+} vertices, "
        f"{delta.get('triangles', 0):+} triangles."
    )
    dependency = record.get("dependencies", {})
    dependency_parts = []
    if dependency.get("camera"):
        dependency_parts.append("active camera")
    if dependency.get("objects"):
        dependency_parts.append("objects " + ", ".join(dependency["objects"][:3]))
    if dependency.get("collections"):
        dependency_parts.append("collections " + ", ".join(dependency["collections"][:3]))
    if dependency.get("animated"):
        dependency_parts.append("animated " + ", ".join(dependency["animated"][:3]))
    if dependency.get("animatedNodeGroups"):
        dependency_parts.append(
            "animated node groups " + ", ".join(dependency["animatedNodeGroups"][:3])
        )
    dependency_text = (
        " Dependencies: " + "; ".join(dependency_parts) + "."
        if dependency_parts else ""
    )
    items = [FidelityItem(
        obj, source, record.get("route", "Realize"),
        record.get("reason", "") + delta_text + dependency_text,
        bool(record.get("blocking")),
    )]
    if any(item.get("hasNamedAttributes") for item in modifiers):
        items.append(FidelityItem(
            obj, source, "Bake",
            "Named attributes survive only when the evaluated geometry/material consumes them; bake visual-only fields or author an explicit shader adapter.",
        ))
    if any(item.get("hasUnrealizedInstances") for item in modifiers):
        items.append(FidelityItem(
            obj, source, "Realize",
            "Unrealized node instances are evaluated for the still export; instance identity is not implied unless the exported GPU-instance diagnostics confirm it.",
        ))
    return items


def _instance_fidelity(group: dict) -> FidelityItem:
    members = group.get("members", [])
    first = members[0]["name"] if members else group.get("meshData", "Shared mesh")
    saved = group.get("drawCallsSaved", 0)
    if group.get("eligible"):
        eligibility = (
            f"Technically eligible for a {group.get('drawCallsInstanced', 1)}-draw GPU batch "
            f"({saved} estimated draw calls saved), but emitted as separate stable objects so "
            "per-object IDs, animation, and culling remain addressable."
        )
    else:
        eligibility = "GPU batch blocked: " + "; ".join(group.get("reasons", [])) + "."
    return FidelityItem(
        first,
        f"Shared mesh data: {group.get('meshData', '?')} × {group.get('count', len(members))}",
        "Preserve",
        f"Core glTF shares geometry bytes but still estimates {group.get('drawCallsSeparate', 0)} draw calls. {eligibility}",
    )


def _lod_fidelity(groups: dict[str, list]) -> list[FidelityItem]:
    items = []
    for base, levels in groups.items():
        levels.sort(key=lambda pair: pair[0].lod_index or 0)
        thresholds = []
        for classification, obj in levels:
            index = classification.lod_index or 0
            distance = obj.get("blendlink_lod_distance")
            thresholds.append(f"LOD{index} {distance:g}m" if isinstance(distance, (int, float)) else f"LOD{index} unset")
        first = levels[0][1]
        stable = sum(isinstance(obj.get("blendlink_id"), str) for _classification, obj in levels)
        items.append(FidelityItem(
            first.name, f"LOD chain: {base}", "Runtime",
            f"{' → '.join(thresholds)}. The optional adapter keeps one of {len(levels)} levels visible "
            f"(instead of {len(levels)} estimated mesh draws); {stable}/{len(levels)} levels have stable IDs.",
        ))
    return items


def _material_fidelity(item: dict) -> FidelityItem:
    status = item.get("status")
    reasons = " ".join(item.get("reasons", []))
    name = item.get("material", "unnamed")
    object_name = (item.get("usedBy") or [name])[0]
    compilation = item.get("materialCompilation") or {}
    outcome = compilation.get("outcome")
    limitations = " ".join(compilation.get("limitations", []))
    if outcome == "lowered":
        source = compilation.get("colorSource") or {}
        transport = compilation.get("transport", "stock glTF")
        source_label = " / ".join(
            value for value in (source.get("node"), source.get("socket")) if value
        )
        return FidelityItem(
            object_name,
            f"Material: {name}",
            "Realize",
            (
                f"Blendlink Web Color {source_label or 'selection'} will compile through "
                f"{transport}. {limitations}"
            ).strip(),
        )
    if outcome == "blocked":
        problems = " ".join(
            f'{issue.get("problem", "")} {issue.get("fix", "")}'
            for issue in compilation.get("issues", [])
        )
        return FidelityItem(
            object_name,
            f"Material: {name}",
            "Block",
            (problems or "The selected Blendlink Web Color cannot be compiled truthfully.").strip(),
            blocking=True,
        )
    if status != "needsBake":
        return FidelityItem(
            object_name,
            f"Material: {name}",
            "Preserve",
            (reasons + " The supported PBR portion still publishes through glTF.").strip(),
        )
    cycles = item.get("cyclesAppearance")
    if isinstance(cycles, dict) and cycles.get("status") == "blocked":
        blockers = " ".join(cycles.get("blockers", []))
        return FidelityItem(
            object_name,
            f"Material: {name}",
            "Runtime",
            (
                reasons + " " + blockers +
                " Current Cycles Appearance cannot evaluate this graph. Simplify to portable "
                "Principled inputs, use a proven EEVEE materialization route, or provide an "
                "application-owned material adapter."
            ).strip(),
        )
    return FidelityItem(
        object_name,
        f"Material: {name}",
        "Bake",
        (reasons +
         " Bake Appearance or simplify the active graph before keeping this material Realtime.").strip(),
    )


def _fixed_camera_appearance_enabled(project, scene) -> bool:
    """Mirror the exporter's narrow automatic camera-dependent bake gate."""
    if project is None or not getattr(project, "configured", False):
        return False
    atlases = tuple(getattr(project, "atlases", ()) or ())
    return bool(
        getattr(project, "presentation", "HYBRID") != "REALTIME"
        and getattr(project, "camera_behavior", "FIXED") == "FIXED"
        and getattr(project, "camera_framing", "AUTHORED") == "AUTHORED"
        and getattr(project, "main_camera", None) is not None
        and project.main_camera == scene.camera
        and atlases
        and all(getattr(atlas, "bake_output", "APPEARANCE") == "APPEARANCE"
                for atlas in atlases)
    )


def _appearance_bake_owned(
        obj, *, fixed_camera_appearance: bool = False) -> bool:
    """Mirror the headless exporter's render_meshes ownership predicate."""
    extras = {key: obj[key] for key in obj.keys()}
    classification = vocab.classify(obj.name, extras)
    collision_only = bool(
        classification is not None
        and classification.kind in {"colonly", "convcolonly"}
    )
    return bool(
        obj.type == "MESH"
        and not obj.hide_render
        and len(obj.data.polygons) > 0
        and not collision_only
        and bakelib.texel_weight_of(obj) > 0.0
        and procedural.effective_dynamic_reason(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        ) is None
    )


def _material_compiler_inspection_scope(project, visible_objects, scene=None):
    if project is None or not project.configured \
            or getattr(project, "presentation", "HYBRID") == "REALTIME":
        return visible_objects, False
    atlases = tuple(getattr(project, "atlases", ()) or ())
    has_lighting = any(
        getattr(atlas, "bake_output", "APPEARANCE") == "LIGHTING"
        for atlas in atlases
    )
    if has_lighting:
        # Mirror of the exporter's composition rule (Phase 2 unit E):
        # unmarked atlas-owned objects are subtracted exactly like the
        # all-Appearance case; objects whose materials carry an explicit
        # Material Bake / TSL Program intent stay in scope (the exporter
        # composes them on Lighting atlases and refuses them by name on
        # surface-replacing ones -- the UI deliberately shows the plan
        # either way, so the refusal is never a surprise).
        fixed_camera_appearance = _fixed_camera_appearance_enabled(
            project, scene or bpy.context.scene,
        )

        def _material_intent_marked(obj):
            for slot in getattr(obj, "material_slots", ()):
                slot_material = slot.material
                if slot_material is not None and (
                    slot_material.get("blendlink_material_bake")
                    or slot_material.get("blendlink_tsl_ir")
                ):
                    return True
            return False

        return tuple(
            obj for obj in visible_objects
            if not _appearance_bake_owned(
                obj, fixed_camera_appearance=fixed_camera_appearance,
            )
            or _material_intent_marked(obj)
        ), True
    # Appearance owns complete static surfaces. Only the exact surviving live
    # objects can consume a selected-field compiler lowering.
    fixed_camera_appearance = _fixed_camera_appearance_enabled(
        project, scene or bpy.context.scene,
    )
    return tuple(
        obj for obj in visible_objects
        if not _appearance_bake_owned(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        )
    ), False


def recompute(scene) -> bool:
    """Rescan; returns True when the visible outcome changed."""
    nodes = []
    overlay: list[OverlayItem] = []
    counts: dict[str, int] = {}
    fidelity: list[FidelityItem] = []
    rendering_analysis: dict[str, RenderingAnalysis] = {}
    lod_groups = {}
    project = getattr(scene, "blendlink_project", None)
    fixed_camera_appearance = _fixed_camera_appearance_enabled(project, scene)
    for obj in scene.objects:
        extras = {key: obj[key] for key in obj.keys()}
        nodes.append(vocab.SceneNode(
            name=obj.name,
            is_empty=obj.type == "EMPTY",
            extras=extras,
        ))
        classification = vocab.classify(obj.name, extras)
        analysis = _rendering_analysis_for(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        )
        if obj.type == "MESH":
            rendering_analysis[obj.name] = analysis
        fidelity.extend(_fidelity_for(obj, analysis))
        if classification is None:
            continue
        counts[classification.kind] = counts.get(classification.kind, 0) + 1
        if classification.kind == "lod":
            lod_groups.setdefault(classification.base, []).append((classification, obj))
        item = _overlay_for(obj, classification)
        if item is not None:
            overlay.append(item)
    fixed_camera = bool(
        project and project.camera_behavior == "FIXED"
        and project.main_camera is not None and project.main_camera == scene.camera
    )
    active_view_layer = (
        bpy.context.view_layer if bpy.context.scene is scene else None
    )
    visible_objects = tuple(
        obj for obj in scene.objects
        if weblights.render_visibility(
            obj, scene, view_layer=active_view_layer,
        ).exported
    )
    diagnostics = procedural.analyze_scene(
        scene, full=False, fixed_camera=fixed_camera,
        objects=visible_objects,
    )
    compiler_objects, lighting_blocks_selected_fields = (
        _material_compiler_inspection_scope(project, visible_objects, scene)
    )
    material_plan = material_compiler.plan_materials(
        compiler_objects, purpose="inspect",
    )
    material_compiler.merge_diagnostics(
        diagnostics.setdefault("materials", []), material_plan,
    )
    if lighting_blocks_selected_fields:
        for record in diagnostics.get("materials", []):
            compilation = record.get("materialCompilation") or {}
            if compilation.get("intent") != "webColor":
                continue
            compilation["outcome"] = "blocked"
            compilation.pop("transport", None)
            compilation.setdefault("issues", []).append({
                "code": "material.lighting-atlas-selected-field-unsupported",
                "material": record.get("material", "unnamed"),
                "problem": (
                    "Selected-field Website Material transport is not yet composited "
                    "with a Lighting atlas; replacing the live base material would "
                    "change its lighting formula."
                ),
                "fix": (
                    "Use all-Appearance atlases, clear the Web Color selection, or "
                    "publish this object through Realtime."
                ),
                "objects": list(record.get("usedBy", [])),
            })
    instance_source_objects = weblights.render_visible_instance_source_objects(
        scene, view_layer=active_view_layer,
    )
    light_analysis = weblights.analyze_scene(
        scene,
        view_layer=active_view_layer,
        instance_source_objects=instance_source_objects,
    )
    light_diagnostics = {
        item.object_name: item.as_dict() for item in light_analysis.diagnostics
    }
    selected_objects = (
        tuple(getattr(bpy.context, "selected_objects", ()) or ())
        if bpy.context.scene is scene else ()
    )
    gizmos = consequence_gizmos.build(
        scene,
        project=project,
        selected_objects=selected_objects,
        light_diagnostics=light_diagnostics,
    )
    overlay.extend(gizmos.items)
    material_compatibility = {
        item["material"]: item for item in diagnostics.get("materials", [])
    }
    for item in diagnostics.get("materials", []):
        compilation = item.get("materialCompilation") or {}
        if item.get("status") == "exact" and compilation.get("outcome") in {None, "preserved"}:
            continue
        fidelity.append(_material_fidelity(item))
    for record in diagnostics["procedural"]:
        fidelity.extend(_procedural_fidelity(record))
    for issue in procedural.pointer_animation_issues(scene, objects=visible_objects):
        if issue["object"] == "World":
            fidelity.append(FidelityItem(
                "World", "World animation", "Block",
                f'{issue["reason"]}. Standard Three.js does not bind '
                "KHR_animation_pointer; animate the environment in website code instead.",
                blocking=True,
            ))
    fidelity.extend(_instance_fidelity(group) for group in diagnostics["instances"])
    fidelity.extend(_lod_fidelity(lod_groups))
    issues = vocab.lint(nodes)
    if project is not None and project.configured:
        issues.extend(
            vocab.LintIssue(
                severity="WARNING" if issue.blocking else "INFO",
                message=(
                    f"Website Component {issue.component_label}: {issue.message}"
                ),
                object_name=issue.object_name,
            )
            for issue in component_validation.validate_project(
                project, scene=scene,
            )
        )
    issues.extend(
        vocab.LintIssue(
            severity="WARNING",
            message=f"Viewport Guide: {issue.message}",
            object_name=issue.object_name,
        )
        for issue in gizmos.issues
    )
    diagnostic_by_name = {
        item.object_name: item for item in light_analysis.diagnostics
    }
    for warning in light_analysis.warnings:
        diagnostic = diagnostic_by_name[warning.object_name]
        fidelity.append(FidelityItem(
            diagnostic.object_name,
            f"Web Light: {diagnostic.source_type.title()}",
            "Bake" if diagnostic.status == weblights.STATUS_NOT_EXPORTED else "Runtime",
            diagnostic.detail,
            warning.blocking,
        ))
        issues.append(vocab.LintIssue(
            severity=warning.severity,
            message=warning.message,
            object_name=warning.object_name,
        ))
    identity_counts = {}
    for obj in scene.objects:
        identity = obj.get("blendlink_id")
        if isinstance(identity, str) and identity:
            identity_counts[identity] = identity_counts.get(identity, 0) + 1
    for obj in scene.objects:
        identity = obj.get("blendlink_id")
        if not getattr(obj, "is_editable", True) and (
            not isinstance(identity, str) or not identity
        ):
            issues.append(vocab.LintIssue(
                severity="WARNING",
                message=(
                    f'Linked object "{obj.name}" has no persistent web identity. '
                    "Open its source .blend with Blendlink enabled and save it once."
                ),
                object_name=obj.name,
            ))
        elif isinstance(identity, str) and identity and identity_counts[identity] > 1:
            remedy = (
                "Open its source .blend with Blendlink enabled and save it once."
                if not getattr(obj, "is_editable", True)
                else "Save this .blend once before publishing."
            )
            issues.append(vocab.LintIssue(
                severity="WARNING",
                message=(
                    f'"{obj.name}" does not have a unique persistent web identity. '
                    + remedy
                ),
                object_name=obj.name,
            ))
    if project is not None and project.configured:
        atlas_names = set()
        for index, atlas in enumerate(project.atlases):
            name = "Main" if index == 0 else atlas.name.strip()
            name_key = name.casefold()
            if not name:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Atlas {index + 1} needs a name before publishing.",
                ))
            elif name_key in atlas_names:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Atlas name {name!r} is used more than once.",
                ))
            atlas_names.add(name_key)

        state_names = set()
        from . import props
        for index, state in enumerate(project.states):
            name = state.name.strip()
            if not name:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Lighting State {index + 1} needs a name before publishing.",
                ))
            elif name in state_names:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Lighting State name {name!r} is used more than once.",
                ))
            state_names.add(name)
            for collection_name in props.hidden_collection_names(state):
                collection = props.scene_collection_by_name(scene, collection_name)
                if collection is None:
                    issues.append(vocab.LintIssue(
                        severity="WARNING",
                        message=(f"Lighting State {name or index + 1!r} references missing "
                                 f"collection {collection_name!r}."),
                    ))
                elif not getattr(collection, "is_editable", True) and not collection.hide_render:
                    issues.append(vocab.LintIssue(
                        severity="WARNING",
                        message=(f"Lighting State {name or index + 1!r} cannot hide linked "
                                 f"collection {collection_name!r}; make it local or hide it in its source .blend."),
                    ))

        frame_names = set()
        for index, frame in enumerate(project.compositions):
            name = frame.name.strip()
            if not name:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Responsive Frame {index + 1} needs a name before publishing.",
                ))
            elif name in frame_names:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=f"Responsive Frame name {name!r} is used more than once.",
                ))
            frame_names.add(name)
    camera = project.main_camera if project is not None else None
    if camera is not None:
        camera_issue = None
        if scene.objects.get(camera.name) is not camera:
            camera_issue = "does not belong to this scene"
        elif camera.hide_render:
            camera_issue = "is hidden from website publishing"
        else:
            current = camera
            while current is not None:
                extras = {key: current[key] for key in current.keys()}
                classification = vocab.classify(current.name, extras)
                if classification is not None and classification.kind == "noimp":
                    camera_issue = f"is excluded from website publishing by {current.name}"
                    break
                current = current.parent
        if camera_issue:
            issues.append(vocab.LintIssue(
                severity="WARNING",
                message=f'Website Camera "{camera.name}" {camera_issue}.',
                object_name=camera.name,
            ))
    for node in nodes:
        if "texel_weight" in node.extras and "blendlink_texel_weight" not in node.extras:
            issues.append(vocab.LintIssue(
                severity="WARNING",
                message=(
                    f'"{node.name}" — bare texel_weight is deprecated; rename it to '
                    "blendlink_texel_weight before 1.0"
                ),
                object_name=node.name,
            ))
        for bare in ("mass", "friction", "lod_distance", "title", "body"):
            namespaced = f"blendlink_{bare}"
            if bare in node.extras and namespaced not in node.extras:
                issues.append(vocab.LintIssue(
                    severity="WARNING",
                    message=(
                        f'"{node.name}" uses deprecated bare {bare}; rename it to '
                        f"{namespaced} before 1.0"
                    ),
                    object_name=node.name,
                ))
    for item in fidelity:
        if item.blocking:
            issues.append(vocab.LintIssue(
                severity="WARNING",
                message=f"Geometry Conversion {item.route}: {item.detail}",
                object_name=item.object_name,
            ))
    previous_rendering = _state["result"].rendering_analysis
    _state["result"] = ScanResult(
        issues=issues, overlay=overlay, counts=counts, fidelity=fidelity,
        rendering_analysis=rendering_analysis,
        material_compatibility=material_compatibility,
        light_diagnostics=light_diagnostics,
        consequence_gizmo_counts=gizmos.counts,
    )
    if rendering_analysis != previous_rendering:
        _state["rendering_revision"] += 1
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
