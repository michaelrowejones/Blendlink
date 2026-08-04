# SPDX-License-Identifier: GPL-3.0-or-later
"""Blender adapter for responsive framing and visual-reference matrices."""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import bpy

from . import presentation, props, vocab


def _redraw_view3d(self=None, context=None):
    manager = context.window_manager if context is not None else bpy.context.window_manager
    if manager is None:
        return
    for window in manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _reference_inputs_changed(self=None, context=None):
    mark_cache_dirty()
    _redraw_view3d(self, context)


def _enter_camera_view(context) -> bool:
    """Enter camera view in the current workspace's first 3D View.

    The preview action lives in Scene Properties, so ``context.area`` is not a
    3D View. Resolve the neighboring editor explicitly instead of silently
    skipping the visible half of the action.
    """
    screen = getattr(context, "screen", None)
    if screen is None:
        window = getattr(context, "window", None)
        screen = getattr(window, "screen", None)
    for area in getattr(screen, "areas", ()):
        if area.type != "VIEW_3D":
            continue
        space = getattr(getattr(area, "spaces", None), "active", None)
        region_3d = getattr(space, "region_3d", None)
        if region_3d is None:
            continue
        region_3d.view_perspective = "CAMERA"
        area.tag_redraw()
        return True
    return False


class BlendlinkReferenceSettings(bpy.types.PropertyGroup):
    show_composition_overlay: bpy.props.BoolProperty(
        name="Responsive Frame Guides",
        description="Show the selected responsive crop, page-safe zone, and backing-buffer size in camera view",
        default=True,
        update=_redraw_view3d,
    )
    device_pixel_ratio: bpy.props.FloatProperty(
        name="Reference Pixel Ratio",
        description=(
            "Representative browser devicePixelRatio for the overlay and comparison captures; "
            "this does not force the website renderer"
        ),
        default=1.0,
        min=0.5,
        max=4.0,
        step=25,
        precision=2,
        update=_reference_inputs_changed,
    )
    camera_scope: bpy.props.EnumProperty(
        name="Reference Cameras",
        items=(
            ("PRESENTATION", "Website Camera", "Audit only the designated website camera"),
            (
                "ALL", "All Published Cameras",
                "Audit every render-visible, included camera in this Blender scene",
            ),
        ),
        default="PRESENTATION",
        update=_reference_inputs_changed,
    )
    frame_spec: bpy.props.StringProperty(
        name="Frames / Poses",
        description="current, start, end, frame numbers, or inclusive ranges such as 1-48x12",
        default="current",
        update=_reference_inputs_changed,
    )
    output_directory: bpy.props.StringProperty(
        name="Reference Folder",
        description="Folder for clean Blender references, required browser captures, and visual diffs",
        default="//blendlink-references",
        subtype="DIR_PATH",
        update=_reference_inputs_changed,
    )
    preview_active: bpy.props.BoolProperty(default=False, options={"HIDDEN", "SKIP_SAVE"})
    previous_camera: bpy.props.PointerProperty(
        type=bpy.types.Object, options={"HIDDEN", "SKIP_SAVE"},
    )
    previous_resolution_x: bpy.props.IntProperty(default=1920, options={"HIDDEN", "SKIP_SAVE"})
    previous_resolution_y: bpy.props.IntProperty(default=1080, options={"HIDDEN", "SKIP_SAVE"})
    previous_resolution_percentage: bpy.props.IntProperty(default=100, options={"HIDDEN", "SKIP_SAVE"})
    previous_pixel_aspect_x: bpy.props.FloatProperty(default=1.0, options={"HIDDEN", "SKIP_SAVE"})
    previous_pixel_aspect_y: bpy.props.FloatProperty(default=1.0, options={"HIDDEN", "SKIP_SAVE"})
    last_manifest: bpy.props.StringProperty(default="", options={"HIDDEN", "SKIP_SAVE"})
    last_plan_signature: bpy.props.StringProperty(default="", options={"HIDDEN", "SKIP_SAVE"})
    last_reference_count: bpy.props.IntProperty(default=0, options={"HIDDEN", "SKIP_SAVE"})
    last_comparison_count: bpy.props.IntProperty(default=0, options={"HIDDEN", "SKIP_SAVE"})


_cache = {
    "dirty": True,
    "scene_pointer": None,
    "camera_issues": {},
    "plan_signature": "",
}


def mark_cache_dirty() -> None:
    _cache["dirty"] = True


def prepare_cache(scene=None, *, force: bool = False) -> bool:
    """Refresh camera/plan facts outside draw and operator poll."""
    scene = scene or getattr(bpy.context, "scene", None)
    if scene is None:
        return False
    project = getattr(scene, "blendlink_project", None)
    settings = getattr(scene, "blendlink_reference", None)
    if project is None or settings is None:
        return False
    pointer = scene.as_pointer()
    if not force and not _cache["dirty"] and _cache["scene_pointer"] == pointer:
        return False
    _cache.update(
        dirty=False,
        scene_pointer=pointer,
        camera_issues={
            scope: _camera_id_issue(scene, project, scope)
            for scope in ("PRESENTATION", "ALL")
        },
        plan_signature=_matrix_input_signature(scene, project, settings),
    )
    return True


def _cache_matches(scene) -> bool:
    return bool(
        not _cache["dirty"]
        and _cache["scene_pointer"] == scene.as_pointer()
    )


def _project(context):
    return getattr(context.scene, "blendlink_project", None)


def _active_composition(project):
    if project is None or not len(project.compositions):
        return None
    return project.compositions[min(project.composition_index, len(project.compositions) - 1)]


def _camera_publish_issue(scene, camera) -> str | None:
    if camera is None:
        return "Choose a Website Camera first"
    if camera.type != "CAMERA" or scene.objects.get(camera.name) is not camera:
        return "Choose a Website Camera that belongs to this scene"
    if camera.hide_render:
        return f"{camera.name} is hidden from website publishing"
    current = camera
    while current is not None:
        extras = {key: current[key] for key in current.keys()}
        classification = vocab.classify(current.name, extras)
        if classification is not None and classification.kind == "noimp":
            return f"{camera.name} is excluded from website publishing by {current.name}"
        current = current.parent
    return None


def _reference_cameras(scene, project, scope: str):
    if scope == "PRESENTATION":
        camera = project.main_camera
        return [] if _camera_publish_issue(scene, camera) else [camera]

    return [
        obj for obj in scene.objects
        if obj.type == "CAMERA" and _camera_publish_issue(scene, obj) is None
    ]


def _camera_id_issue(scene, project, scope: str) -> str | None:
    if scope == "PRESENTATION":
        issue = _camera_publish_issue(scene, project.main_camera)
        if issue:
            return issue
    cameras = _reference_cameras(scene, project, scope)
    if not cameras:
        return (
            "Choose a Website Camera first"
            if scope == "PRESENTATION" else
            "No render-visible, included cameras are available"
        )
    counts = {}
    for obj in scene.objects:
        object_id = obj.get("blendlink_id")
        if isinstance(object_id, str) and object_id:
            counts[object_id] = counts.get(object_id, 0) + 1
    for camera in cameras:
        object_id = camera.get("blendlink_id")
        if not isinstance(object_id, str) or not object_id or counts.get(object_id) != 1:
            return (
                f"Save this .blend once so Blendlink can preserve {camera.name} "
                "across renames, then build the comparison plan again"
            )
    return None


def _camera_records(scene, project, scope: str) -> list[dict]:
    issue = _camera_id_issue(scene, project, scope)
    if issue:
        raise ValueError(issue)
    return [
        {"objectId": obj["blendlink_id"], "objectName": obj.name}
        for obj in _reference_cameras(scene, project, scope)
    ]


def _state_records(project) -> list[dict]:
    return [
        {
            "name": state.name.strip() or "state",
            "hideCollections": props.hidden_collection_names(state),
        }
        for state in project.states
    ] or [{"name": "default", "hideCollections": []}]


def _composition_records(project) -> list[dict]:
    return [
        {
            "name": frame.name.strip() or f"Frame {index + 1}",
            "width": int(frame.width),
            "height": int(frame.height),
            "safeMargin": float(frame.safe_margin),
        }
        for index, frame in enumerate(project.compositions)
    ]


def _matrix_input_signature(scene, project, settings) -> str:
    """Cheap, read-only signature of every value written into a comparison plan."""
    payload = {
        "sourceBlend": bpy.data.filepath,
        "cameraScope": settings.camera_scope,
        "cameras": [
            {
                "id": obj.get("blendlink_id", ""),
                "name": obj.name,
            }
            for obj in _reference_cameras(scene, project, settings.camera_scope)
        ],
        "states": _state_records(project),
        "compositions": _composition_records(project),
        "frameSpec": settings.frame_spec,
        "frameCurrent": scene.frame_current,
        "frameStart": scene.frame_start,
        "frameEnd": scene.frame_end,
        "fps": scene.render.fps,
        "fpsBase": scene.render.fps_base,
        "devicePixelRatio": float(settings.device_pixel_ratio),
        "outputDirectory": settings.output_directory,
        "renderer": scene.render.engine,
        "colorManagement": {
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
        },
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf8")).hexdigest()[:16]


def _plan_is_current(scene, project, settings) -> bool:
    return bool(
        _cache_matches(scene)
        and settings.last_manifest
        and settings.last_plan_signature
        and settings.last_plan_signature == _cache["plan_signature"]
    )


def build_matrix(scene, project, settings) -> dict:
    """Adapt the current Blender scene into the pure comparison contract."""
    fps = scene.render.fps / scene.render.fps_base
    source_path = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    matrix = presentation.build_reference_matrix(
        source_blend=str(source_path) if source_path is not None else "",
        cameras=_camera_records(scene, project, settings.camera_scope),
        states=_state_records(project),
        compositions=_composition_records(project),
        frame_spec=settings.frame_spec,
        current_frame=scene.frame_current,
        frame_start=scene.frame_start,
        frame_end=scene.frame_end,
        fps=fps,
        device_pixel_ratio=float(settings.device_pixel_ratio),
    )
    if source_path is not None and source_path.is_file():
        digest = hashlib.sha256()
        with source_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        matrix["sourceBlendHash"] = digest.hexdigest()[:16]
    missing = sorted({
        collection_name
        for reference in matrix["references"]
        for collection_name in reference["lightingState"]["hideCollections"]
        if bpy.data.collections.get(collection_name) is None
    })
    matrix["diagnostics"] = [
        {
            "severity": "warning",
            "message": f"lighting state names missing collection {name!r}; nothing will be hidden",
        }
        for name in missing
    ]
    matrix["blenderCapture"] = {
        "renderer": scene.render.engine,
        "colorManagement": {
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
        },
        "qualityNote": (
            "One clean Blender source reference is shared by Preview and Final comparisons; "
            "quality changes the compiled website artifact, not the authored source truth."
        ),
    }
    return matrix


def _output_root(settings) -> Path:
    raw = bpy.path.abspath(settings.output_directory).strip()
    if not raw:
        raise ValueError("choose a reference output folder")
    return Path(raw).resolve()


def _manifest_path(root: Path) -> Path:
    return root / "comparison-manifest.json"


def _write_manifest(path: Path, matrix: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(matrix, indent=2) + "\n", encoding="utf8")
    os.replace(temporary, path)


def write_matrix(scene, project, settings) -> tuple[Path, dict]:
    matrix = build_matrix(scene, project, settings)
    root = _output_root(settings)
    path = _manifest_path(root)
    _write_manifest(path, matrix)
    settings.last_manifest = str(path)
    settings.last_plan_signature = _matrix_input_signature(scene, project, settings)
    settings.last_reference_count = matrix["matrix"]["blenderReferenceCount"]
    settings.last_comparison_count = matrix["matrix"]["comparisonCount"]
    return path, matrix


def _capture_matrix(context, matrix: dict, root: Path, manifest_path: Path) -> None:
    scene = context.scene
    render = scene.render
    image = render.image_settings
    camera_by_id = {
        obj.get("blendlink_id"): obj
        for obj in scene.objects if obj.type == "CAMERA"
    }
    scene_collections = []
    stack = [scene.collection]
    seen_collections = set()
    while stack:
        collection = stack.pop()
        pointer = collection.as_pointer()
        if pointer in seen_collections:
            continue
        seen_collections.add(pointer)
        scene_collections.append(collection)
        stack.extend(collection.children)
    collection_by_name = {collection.name: collection for collection in scene_collections}
    requested_hidden = {
        name
        for reference in matrix["references"]
        for name in reference["lightingState"]["hideCollections"]
    }
    blocked = [
        collection for name, collection in collection_by_name.items()
        if name in requested_hidden and not collection.hide_render
        and not getattr(collection, "is_editable", True)
    ]
    if blocked:
        names = ", ".join(collection.name for collection in blocked)
        raise RuntimeError(
            "These linked/read-only collections cannot be hidden for the requested "
            f"Lighting States: {names}. Make them local or author the visibility in their source .blend"
        )
    collection_snapshot = [
        (collection, collection.hide_render) for collection in scene_collections
    ]
    snapshot = {
        "camera": scene.camera,
        "frame": scene.frame_current,
        "resolution_x": render.resolution_x,
        "resolution_y": render.resolution_y,
        "resolution_percentage": render.resolution_percentage,
        "pixel_aspect_x": render.pixel_aspect_x,
        "pixel_aspect_y": render.pixel_aspect_y,
        "filepath": render.filepath,
        "use_file_extension": render.use_file_extension,
        "file_format": image.file_format,
        "color_mode": image.color_mode,
        "color_depth": image.color_depth,
    }
    manager = context.window_manager
    references = matrix["references"]
    manager.progress_begin(0, max(1, len(references)))
    try:
        render.resolution_percentage = 100
        render.pixel_aspect_x = 1.0
        render.pixel_aspect_y = 1.0
        render.use_file_extension = True
        image.file_format = "PNG"
        image.color_mode = "RGBA"
        image.color_depth = "8"
        for index, reference in enumerate(references):
            manager.progress_update(index)
            camera = camera_by_id.get(reference["camera"]["objectId"])
            if camera is None:
                raise RuntimeError(
                    f"reference camera {reference['camera']['objectName']!r} no longer exists"
                )
            for collection, hidden in collection_snapshot:
                if collection.hide_render != hidden:
                    collection.hide_render = hidden
            for name in reference["lightingState"]["hideCollections"]:
                collection = collection_by_name.get(name)
                if collection is not None and not collection.hide_render:
                    collection.hide_render = True
            scene.camera = camera
            scene.frame_set(reference["pose"]["frame"])
            composition = reference["composition"]
            render.resolution_x = composition["backingWidth"]
            render.resolution_y = composition["backingHeight"]
            target = root / reference["blender"]["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            render.filepath = str(target)
            try:
                bpy.ops.render.render(write_still=True, scene=scene.name)
                if not target.exists() or target.stat().st_size == 0:
                    raise RuntimeError("Blender reported success but produced no PNG")
                reference["blender"] = {
                    "status": "captured",
                    "path": reference["blender"]["path"],
                    "bytes": target.stat().st_size,
                }
            except Exception as error:
                reference["blender"]["status"] = "failed"
                reference["blender"]["error"] = str(error)
                _write_manifest(manifest_path, matrix)
                raise RuntimeError(f"reference {reference['id']} failed: {error}") from error
            _write_manifest(manifest_path, matrix)
    finally:
        pending_exception = sys.exc_info()[0] is not None
        restoration_errors = []
        try:
            manager.progress_end()
        except Exception as error:
            restoration_errors.append(f"progress display: {error}")
        for collection, hidden in collection_snapshot:
            try:
                if collection.hide_render != hidden:
                    collection.hide_render = hidden
            except Exception as error:
                restoration_errors.append(f"collection {collection.name!r}: {error}")

        restorations = (
            ("camera", lambda: setattr(scene, "camera", snapshot["camera"])),
            ("frame", lambda: scene.frame_set(snapshot["frame"])),
            ("resolution X", lambda: setattr(render, "resolution_x", snapshot["resolution_x"])),
            ("resolution Y", lambda: setattr(render, "resolution_y", snapshot["resolution_y"])),
            ("resolution percentage", lambda: setattr(
                render, "resolution_percentage", snapshot["resolution_percentage"],
            )),
            ("pixel aspect X", lambda: setattr(render, "pixel_aspect_x", snapshot["pixel_aspect_x"])),
            ("pixel aspect Y", lambda: setattr(render, "pixel_aspect_y", snapshot["pixel_aspect_y"])),
            ("render filepath", lambda: setattr(render, "filepath", snapshot["filepath"])),
            ("file extension", lambda: setattr(
                render, "use_file_extension", snapshot["use_file_extension"],
            )),
            ("file format", lambda: setattr(image, "file_format", snapshot["file_format"])),
            ("color mode", lambda: setattr(image, "color_mode", snapshot["color_mode"])),
            ("color depth", lambda: setattr(image, "color_depth", snapshot["color_depth"])),
        )
        for label, restore in restorations:
            try:
                restore()
            except Exception as error:
                restoration_errors.append(f"{label}: {error}")
        if restoration_errors:
            message = "Could not fully restore Blender after reference capture: " + "; ".join(
                restoration_errors
            )
            print(f"blendlink addon: {message}")
            if not pending_exception:
                raise RuntimeError(message)


def _restore_preview(scene, settings) -> bool:
    if not settings.preview_active:
        return False
    scene.camera = settings.previous_camera
    scene.render.resolution_x = settings.previous_resolution_x
    scene.render.resolution_y = settings.previous_resolution_y
    scene.render.resolution_percentage = settings.previous_resolution_percentage
    scene.render.pixel_aspect_x = settings.previous_pixel_aspect_x
    scene.render.pixel_aspect_y = settings.previous_pixel_aspect_y
    settings.preview_active = False
    _redraw_view3d()
    return True


class BLENDLINK_OT_preview_composition(bpy.types.Operator):
    """Apply the selected CSS aspect/DPR and enter the authored camera view"""
    bl_idname = "blendlink.preview_composition"
    bl_label = "Preview Selected Frame"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        project = _project(context)
        if not project or not project.configured or project.main_camera is None:
            cls.poll_message_set("Set a Website Camera first")
            return False
        if _active_composition(project) is None:
            cls.poll_message_set("Add a Responsive Frame first")
            return False
        return True

    def execute(self, context):
        scene, project = context.scene, _project(context)
        settings = scene.blendlink_reference
        composition = _active_composition(project)
        width = round(composition.width * settings.device_pixel_ratio)
        height = round(composition.height * settings.device_pixel_ratio)
        if max(width, height) > presentation.MAX_CAPTURE_DIMENSION:
            self.report({"ERROR"}, f"Backing buffer exceeds {presentation.MAX_CAPTURE_DIMENSION}px per edge")
            return {"CANCELLED"}
        if not settings.preview_active:
            settings.previous_camera = scene.camera
            settings.previous_resolution_x = scene.render.resolution_x
            settings.previous_resolution_y = scene.render.resolution_y
            settings.previous_resolution_percentage = scene.render.resolution_percentage
            settings.previous_pixel_aspect_x = scene.render.pixel_aspect_x
            settings.previous_pixel_aspect_y = scene.render.pixel_aspect_y
            settings.preview_active = True
        scene.camera = project.main_camera
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.render.pixel_aspect_x = 1.0
        scene.render.pixel_aspect_y = 1.0
        entered_camera = _enter_camera_view(context)
        _redraw_view3d()
        message = (
            f"{composition.name}: {composition.width}x{composition.height} CSS px @ "
            f"{settings.device_pixel_ratio:g}x = {width}x{height} backing px"
        )
        if entered_camera:
            self.report({"INFO"}, message)
        else:
            self.report({"WARNING"}, message + "; open a 3D View to see the camera preview")
        return {"FINISHED"}


class BLENDLINK_OT_stop_composition_preview(bpy.types.Operator):
    """Restore the camera and render dimensions from before composition preview"""
    bl_idname = "blendlink.stop_composition_preview"
    bl_label = "Restore Previous Render Frame"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        settings = getattr(context.scene, "blendlink_reference", None)
        return bool(settings and settings.preview_active)

    def execute(self, context):
        _restore_preview(context.scene, context.scene.blendlink_reference)
        self.report({"INFO"}, "Restored the previous camera and render dimensions")
        return {"FINISHED"}


def _reference_matrix_poll_reason(context) -> str | None:
    project = _project(context)
    if not project or not project.configured:
        return "Run Set Up Blendlink Scene first"
    if not getattr(context.scene, "is_editable", True):
        return "Make this linked scene local before capturing references"
    if not bpy.data.filepath:
        return "Save the .blend first"
    if bpy.data.is_dirty:
        return "Save current edits so Blender references and the website build use the same scene"
    settings = getattr(context.scene, "blendlink_reference", None)
    if settings is not None:
        if not _cache_matches(context.scene):
            return "Blendlink is checking published cameras"
        issue = _cache["camera_issues"].get(settings.camera_scope)
        if issue:
            return issue
    return None


class BLENDLINK_OT_build_reference_matrix(bpy.types.Operator):
    """Write the exact Blender/browser capture matrix without rendering images"""
    bl_idname = "blendlink.build_reference_matrix"
    bl_label = "Build Comparison Plan"
    # Writes the matrix manifest and its signature onto scene.blendlink_reference.
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        reason = _reference_matrix_poll_reason(context)
        if reason:
            cls.poll_message_set(reason)
            return False
        return True

    def execute(self, context):
        try:
            path, matrix = write_matrix(
                context.scene, _project(context), context.scene.blendlink_reference,
            )
        except (OSError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        diagnostics = matrix.get("diagnostics", [])
        if diagnostics:
            self.report({"WARNING"}, diagnostics[0]["message"])
        else:
            self.report(
                {"INFO"},
                f"Comparison plan: {matrix['matrix']['blenderReferenceCount']} Blender references / "
                f"{matrix['matrix']['comparisonCount']} browser comparisons -> {path}",
            )
        return {"FINISHED"}


class BLENDLINK_OT_capture_reference_matrix(bpy.types.Operator):
    """Render every clean Blender source reference in the comparison matrix"""
    bl_idname = "blendlink.capture_reference_matrix"
    bl_label = "Capture Blender References"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        reason = _reference_matrix_poll_reason(context)
        if reason:
            cls.poll_message_set(reason)
            return False
        return True

    def invoke(self, context, event):
        # An empty confirmation dialog asks the artist to agree to nothing.
        # This one names the cost: Cycles renders every cell, and Blender is
        # unresponsive for the duration.
        settings = context.scene.blendlink_reference
        count = int(getattr(settings, "last_reference_count", 0) or 0)
        return context.window_manager.invoke_confirm(
            self, event,
            title="Capture Blender References",
            message=(
                f"Render {count} reference image(s) with Cycles."
                if count else "Render the Blender reference images with Cycles."
            ) + " Blender stays unresponsive until it finishes.",
            confirm_text="Render References",
        )

    def execute(self, context):
        settings = context.scene.blendlink_reference
        try:
            path, matrix = write_matrix(context.scene, _project(context), settings)
            _capture_matrix(context, matrix, path.parent, path)
        except (OSError, RuntimeError, ValueError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            f"Captured {matrix['matrix']['blenderReferenceCount']} Blender references; "
            f"browser captures remain required in {path}",
        )
        return {"FINISHED"}


class BLENDLINK_OT_open_reference_folder(bpy.types.Operator):
    """Open the visual-reference output folder"""
    bl_idname = "blendlink.open_reference_folder"
    bl_label = "Open Current Reference Folder"
    # Opens a folder; changes no data, so it registers without an undo step.
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        settings = getattr(context.scene, "blendlink_reference", None)
        return bool(
            settings is not None
            and settings.output_directory.strip()
        )

    def execute(self, context):
        settings = context.scene.blendlink_reference
        try:
            path = _output_root(settings)
        except ValueError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if not path.exists():
            self.report({"ERROR"}, f"Reference folder no longer exists: {path}")
            return {"CANCELLED"}
        bpy.ops.wm.path_open(filepath=str(path))
        return {"FINISHED"}


class BLENDLINK_PT_visual_references(bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_visual_references"
    bl_parent_id = "BLENDLINK_PT_camera"
    bl_label = "Responsive Preview & Visual Checks"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "scene"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 10

    @classmethod
    def poll(cls, context):
        project = _project(context)
        return project is not None and project.configured and project.main_camera is not None

    def draw(self, context):
        from . import ui as addon_ui
        layout = self.layout
        scene, project = context.scene, _project(context)
        settings = scene.blendlink_reference
        composition = _active_composition(project)

        guides = layout.column()
        guides.use_property_split = True
        guides.use_property_decorate = False
        guides.prop(settings, "show_composition_overlay")
        guides.prop(settings, "device_pixel_ratio")
        if composition is not None:
            width = round(composition.width * settings.device_pixel_ratio)
            height = round(composition.height * settings.device_pixel_ratio)
            addon_ui._draw_wrapped(
                guides,
                f"{composition.name}: {composition.width}×{composition.height} CSS → {width}×{height} backing pixels",
                icon="FULLSCREEN_ENTER",
            )
        row = layout.row(align=True)
        row.operator("blendlink.preview_composition", icon="CAMERA_DATA")
        restore = row.row(align=True)
        restore.enabled = settings.preview_active
        restore.operator("blendlink.stop_composition_preview", text="Restore", icon="LOOP_BACK")

        layout.separator()
        layout.label(text="Blender vs Website", icon="IMAGE_DATA")
        audit = layout.column()
        audit.use_property_split = True
        audit.use_property_decorate = False
        audit.prop(settings, "camera_scope")
        audit.prop(settings, "frame_spec")
        audit.prop(settings, "output_directory")
        addon_ui._draw_wrapped(
            audit,
            "Build Plan calculates the exact render count before Blender captures anything.",
            icon="INFO",
        )
        actions = layout.row(align=True)
        actions.operator("blendlink.build_reference_matrix", text="Build Plan", icon="FILE_TICK")
        actions.operator("blendlink.capture_reference_matrix", text="Capture Blender", icon="RENDER_STILL")
        if settings.last_manifest:
            if not _cache_matches(scene):
                addon_ui._draw_wrapped(
                    layout,
                    "Checking whether the comparison plan still matches this scene...",
                    icon="TIME",
                )
            elif _plan_is_current(scene, project, settings):
                addon_ui._draw_wrapped(
                    layout,
                    f"Plan has {settings.last_reference_count} Blender renders and "
                    f"{settings.last_comparison_count} website comparisons.",
                    icon="CHECKMARK",
                )
            else:
                addon_ui._draw_wrapped(
                    layout,
                    "Plan is out of date. Build it again before capturing references.",
                    icon="FILE_REFRESH",
                )
        layout.operator("blendlink.open_reference_folder", icon="FILE_FOLDER")
        truth = layout.box()
        addon_ui._draw_wrapped(
            truth, "Browser captures stay explicitly required.", icon="URL",
        )
        addon_ui._draw_wrapped(
            truth, "Blender never labels its pixels as website output.",
        )


classes = (
    BlendlinkReferenceSettings,
    BLENDLINK_OT_preview_composition,
    BLENDLINK_OT_stop_composition_preview,
    BLENDLINK_OT_build_reference_matrix,
    BLENDLINK_OT_capture_reference_matrix,
    BLENDLINK_OT_open_reference_folder,
    BLENDLINK_PT_visual_references,
)


def register_pointers():
    bpy.types.Scene.blendlink_reference = bpy.props.PointerProperty(type=BlendlinkReferenceSettings)


def unregister_pointers():
    for scene in bpy.data.scenes:
        settings = getattr(scene, "blendlink_reference", None)
        if settings is not None:
            _restore_preview(scene, settings)
    if hasattr(bpy.types.Scene, "blendlink_reference"):
        del bpy.types.Scene.blendlink_reference


def re_register_category(category: str):
    """Move only Blendlink's viewport workspace to the configured tab."""
    from . import ui
    ui.re_register_category(category)
