# SPDX-License-Identifier: GPL-3.0-or-later
"""Vocabulary authoring operators.

Every operator follows the native contract: acts on all selected editable
objects, {'REGISTER', 'UNDO'} so F9 redo works, poll() with a message, and a
status-bar report of what happened. No dialogs, no popups.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import tomllib
import uuid
from functools import lru_cache
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

from . import material_compiler, probe_authoring, validation, vocab, weblights
from .bakelib_loader import bakelib

_SEP = "-"
WEBSITE_CONNECT_COMMAND = "npx blendlink connect"
WEBSITE_PUBLISH_COMMAND = "npx blendlink publish"


@lru_cache(maxsize=1)
def _addon_release_version() -> str:
    """Read the npm-compatible release paired with this installed addon."""
    manifest_path = Path(__file__).with_name("blender_manifest.toml")
    try:
        with manifest_path.open("rb") as stream:
            version = tomllib.load(stream).get("version")
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise RuntimeError(
            f"Blendlink cannot read its addon version from {manifest_path}: {error}"
        ) from error
    if not isinstance(version, str) or re.fullmatch(
        r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version,
    ) is None:
        raise RuntimeError(
            f"Blendlink addon version in {manifest_path} is not a safe npm version: "
            f"{version!r}"
        )
    return version


def _preview_cli_package_candidates(blend_path: Path):
    """Yield nearby Blendlink package roots in artist-first priority order."""
    seen: set[Path] = set()
    anchors = (blend_path.parent, Path(__file__).resolve().parent)
    for anchor in anchors:
        for parent in (anchor, *anchor.parents):
            for candidate in (
                parent,
                parent / "packages" / "blendlink",
                parent / "node_modules" / "blendlink",
            ):
                resolved = candidate.resolve()
                if resolved in seen:
                    continue
                seen.add(resolved)
                yield resolved


def _local_preview_cli(blend_path: Path, release_version: str) -> Path | None:
    """Find a built local CLI compatible with the installed Blender addon."""
    for package_root in _preview_cli_package_candidates(blend_path):
        descriptor_path = package_root / "package.json"
        if not descriptor_path.is_file():
            continue
        try:
            descriptor = json.loads(descriptor_path.read_text(encoding="utf8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            # Only a directory named blendlink is evidence that this malformed
            # descriptor was intended for us; unrelated website package files
            # are common along the search path and should not create noise.
            if package_root.name.casefold() == "blendlink":
                print(
                    "blendlink addon: skipped local Preview Studio package at "
                    f"{package_root}: package.json could not be read: {error}",
                    flush=True,
                )
            continue
        if not isinstance(descriptor, dict) or descriptor.get("name") != "blendlink":
            continue
        package_version = descriptor.get("version")
        if package_version != release_version:
            print(
                "blendlink addon: skipped local Preview Studio package at "
                f"{package_root}: version {package_version!s} requires {release_version}",
                flush=True,
            )
            continue
        cli_path = package_root / "dist" / "cli.js"
        if not cli_path.is_file():
            print(
                "blendlink addon: skipped local Preview Studio package at "
                f"{package_root}: dist/cli.js is missing; run npm run build",
                flush=True,
            )
            continue
        print(
            f"blendlink addon: using local Preview Studio CLI {cli_path}",
            flush=True,
        )
        return cli_path
    return None


def _preview_studio_command(blend_path: str | None = None) -> tuple[str, str]:
    """Return a shell-safe disposable-preview command and harmless cwd."""
    blend_path = Path(os.path.abspath(blend_path or bpy.data.filepath))
    release_version = _addon_release_version()
    local_cli = _local_preview_cli(blend_path, release_version)
    if local_cli is None:
        parts = ["npx", "--yes", f"blendlink@{release_version}"]
    else:
        parts = ["node", str(local_cli)]
    parts.extend(("preview", "--blend", str(blend_path), "--no-open"))
    command = subprocess.list2cmdline(parts) if os.name == "nt" else shlex.join(parts)
    return command, str(blend_path.parent)


def _copy_to_system_clipboard(context, text: str) -> str | None:
    """Copy *text* and return an artist-facing error when it cannot be verified.

    Blender's clipboard RNA property silently discards writes when Blender runs
    without a native window (notably ``--background``).  Treat readback as the
    completion contract so copy operators never claim success when no text was
    made available to paste.
    """
    if not isinstance(text, str) or not text:
        return "There is no text to copy"
    manager = getattr(context, "window_manager", None)
    if manager is None:
        return "Blender has no window manager for the system clipboard"
    try:
        manager.clipboard = text
        copied = manager.clipboard
    except (AttributeError, RuntimeError, TypeError) as error:
        return f"Blender could not access the system clipboard: {error}"
    if copied != text:
        if bpy.app.background:
            return "The system clipboard is unavailable while Blender runs in background mode"
        return "Blender could not verify the text in the system clipboard"
    return None


def _copy_with_feedback(operator, context, text: str, success: str):
    """Apply the verified clipboard contract shared by every copy operator."""
    error = _copy_to_system_clipboard(context, text)
    if error:
        operator.report({"ERROR"}, f"{error}. The text remains visible in Blendlink")
        return {"CANCELLED"}
    operator.report({"INFO"}, success)
    return {"FINISHED"}


def _scene_settings_ready(operator, context) -> bool:
    """Block unrelated mutations while a visible scene-setting error exists."""
    project = getattr(context.scene, "blendlink_project", None)
    error = str(getattr(project, "recipe_error", "") or "").strip()
    if not error:
        return True
    operator.report({"ERROR"}, f"Correct the scene setting first: {error}")
    return False


def _scene_editability_issue(context) -> str | None:
    scene = getattr(context, "scene", None)
    if scene is None:
        return "No active scene"
    if not getattr(scene, "is_editable", True):
        return "Make this linked scene local before changing Blendlink settings"
    return None


def _require_editable_scene(operator, context) -> bool:
    issue = _scene_editability_issue(context)
    if issue:
        operator.report({"ERROR"}, issue)
        return False
    return True


def _writable_target_collection(context):
    """Prefer an active-scene-only collection, then the local scene root."""
    def contains(scene, wanted) -> bool:
        stack = [scene.collection]
        seen_collections = set()
        while stack:
            collection = stack.pop()
            pointer = collection.as_pointer()
            if pointer in seen_collections:
                continue
            seen_collections.add(pointer)
            if collection is wanted:
                return True
            stack.extend(collection.children)
        return False

    candidates = (getattr(context, "collection", None), context.scene.collection)
    seen = set()
    for collection in candidates:
        if collection is None:
            continue
        pointer = collection.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        owners = [scene for scene in bpy.data.scenes if contains(scene, collection)]
        if getattr(collection, "is_editable", True) and owners == [context.scene]:
            return collection
    return None


def _rename(obj, new_name: str) -> bool:
    """Rename without letting Blender silently append `.001` (which would hide
    the vocabulary token). Returns False when the name is taken."""
    if obj.name == new_name:
        return True
    existing = bpy.data.objects.get(new_name)
    if existing is not None and existing != obj:
        return False
    obj.name = new_name
    return obj.name == new_name


def _mesh_or_empty_selected(context) -> bool:
    return any(o.type in ("MESH", "EMPTY") for o in context.selected_editable_objects)


def _atlas_display_name(project, atlas_id) -> str:
    """Return an artist-facing atlas name without leaking internal slugs."""
    atlas_id = str(atlas_id or "main")
    if atlas_id in {"main", "__AUTO__", "AUTO"}:
        return "Main"
    for atlas in getattr(project, "atlases", ()) if project is not None else ():
        if atlas.atlas_id == atlas_id:
            return atlas.name
    readable = atlas_id.replace("-", " ").replace("_", " ").strip()
    return readable.title() if readable else "Main"


def _properties_area(context):
    """Return an unpinned Properties editor in this workspace, if available."""
    areas = []
    current = getattr(context, "area", None)
    if current is not None and current.type == "PROPERTIES":
        areas.append(current)
    screen = getattr(context, "screen", None)
    if screen is None:
        window = getattr(context, "window", None)
        screen = getattr(window, "screen", None)
    for area in getattr(screen, "areas", ()):
        if area.type == "PROPERTIES" and area not in areas:
            areas.append(area)
    for area in areas:
        space = getattr(getattr(area, "spaces", None), "active", None)
        if space is not None and getattr(space, "pin_id", None) is None:
            return area
    return None


_PROPERTIES_CONTEXT_LABELS = {
    "SCENE": "Scene",
    "WORLD": "World",
    "OBJECT": "Object",
    "DATA": "Object Data",
    "MATERIAL": "Material",
}


class BLENDLINK_OT_open_properties_context(bpy.types.Operator):
    """Open the requested tab in Blender's existing native Properties editor"""
    bl_idname = "blendlink.open_properties_context"
    bl_label = "Open Blender Properties"
    bl_description = (
        "Open the relevant native Blender Properties tab without changing the scene"
    )
    bl_options = {"INTERNAL"}

    target: bpy.props.EnumProperty(
        name="Properties Tab",
        description="Native Blender Properties tab to open",
        items=(
            ("SCENE", "Scene", "Open Blender's Scene Properties"),
            ("WORLD", "World", "Open Blender's World Properties"),
            ("OBJECT", "Object", "Open Blender's Object Properties"),
            ("DATA", "Object Data", "Open the active object's data properties"),
            ("MATERIAL", "Material", "Open the active object's material properties"),
        ),
        default="SCENE",
        options={"SKIP_SAVE"},
    )

    @classmethod
    def poll(cls, context):
        if _properties_area(context) is None:
            cls.poll_message_set(
                "Open or unpin a Properties editor in this Blender workspace"
            )
            return False
        return True

    def execute(self, context):
        area = _properties_area(context)
        if area is None:
            self.report(
                {"ERROR"},
                "No unpinned Properties editor is open in this Blender workspace",
            )
            return {"CANCELLED"}

        active = getattr(context, "active_object", None)
        if self.target == "OBJECT" and active is None:
            self.report({"ERROR"}, "Select an object before opening Object Properties")
            return {"CANCELLED"}
        if self.target == "DATA" and (active is None or active.data is None):
            self.report(
                {"ERROR"},
                "Select an object with data before opening Object Data Properties",
            )
            return {"CANCELLED"}
        if self.target == "MATERIAL" and (
            active is None or getattr(active.data, "materials", None) is None
        ):
            self.report(
                {"ERROR"},
                "Select an object that supports materials before opening Material Properties",
            )
            return {"CANCELLED"}

        space = getattr(getattr(area, "spaces", None), "active", None)
        if space is None:
            self.report({"ERROR"}, "Blender could not access the Properties editor")
            return {"CANCELLED"}
        try:
            space.context = self.target
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            self.report(
                {"ERROR"},
                f"Blender could not open {_PROPERTIES_CONTEXT_LABELS[self.target]} "
                f"Properties: {error}",
            )
            return {"CANCELLED"}
        if space.context != self.target:
            self.report(
                {"ERROR"},
                f"{_PROPERTIES_CONTEXT_LABELS[self.target]} Properties are not available "
                "for the current selection",
            )
            return {"CANCELLED"}

        area.tag_redraw()
        self.report(
            {"INFO"},
            f"Opened Blender {_PROPERTIES_CONTEXT_LABELS[self.target]} Properties",
        )
        return {"FINISHED"}


class BLENDLINK_OT_use_website_camera(bpy.types.Operator):
    """Designate an existing Blender camera as the website's authored view"""
    bl_idname = "blendlink.use_website_camera"
    bl_label = "Use Website Camera"
    bl_options = {"REGISTER", "UNDO"}

    camera_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    def execute(self, context):
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        project = getattr(context.scene, "blendlink_project", None)
        if project is None or not project.configured:
            self.report({"ERROR"}, "Set up this Blendlink scene before choosing its website camera")
            return {"CANCELLED"}
        camera = bpy.data.objects.get(self.camera_name)
        if camera is None or camera.type != "CAMERA":
            self.report({"ERROR"}, f"Camera {self.camera_name!r} no longer exists")
            return {"CANCELLED"}
        if camera.name not in context.scene.objects:
            self.report({"ERROR"}, f"Camera {camera.name!r} is not part of this scene")
            return {"CANCELLED"}
        project.main_camera = camera
        self.report({"INFO"}, f"Website camera → {camera.name}")
        return {"FINISHED"}


def _ensure_scene_ids(scene) -> int:
    objects = list(scene.objects)
    made = 0
    seen = set()

    # Reserve identities owned by linked source files first. If an editable
    # local object collides, change the local object rather than attempting to
    # mutate read-only library data.
    for obj in objects:
        if getattr(obj, "is_editable", True):
            continue
        current = obj.get("blendlink_id")
        if not isinstance(current, str) or not current or current in seen:
            raise ValueError(
                f"Linked object {obj.name!r} needs a unique persistent web identity. "
                "Open its source .blend with Blendlink enabled and save it once"
            )
        seen.add(current)

    for obj in objects:
        if not getattr(obj, "is_editable", True):
            continue
        current = obj.get("blendlink_id")
        if not isinstance(current, str) or not current or current in seen:
            obj["blendlink_id"] = str(uuid.uuid4())
            made += 1
        seen.add(obj["blendlink_id"])
    return made


class BLENDLINK_OT_setup_website_export(bpy.types.Operator):
    """Create an artist-owned web recipe; existing scene art is untouched"""
    bl_idname = "blendlink.setup_website_export"
    bl_label = "Set Up Blendlink Scene"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if project is not None and project.configured:
            cls.poll_message_set("This scene is already set up for Blendlink")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        if context.scene.blendlink_project.configured:
            self.report({"ERROR"}, "This scene is already set up for Blendlink")
            return {"CANCELLED"}
        try:
            _ensure_scene_ids(context.scene)
        except ValueError as error:
            print(f"blendlink addon: scene setup canceled: {error}")
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        recipe = props.setup_project(context.scene)
        self.report(
            {"INFO"},
            f"Blendlink scene ready with a {recipe['atlases'][0]['size']}px Main atlas. "
            "Website connection is shown separately",
        )
        return {"FINISHED"}


class BLENDLINK_OT_add_composition(bpy.types.Operator):
    """Add a Responsive Frame for the Website Camera"""
    bl_idname = "blendlink.add_composition"
    bl_label = "Add Responsive Frame"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or not project.configured:
            cls.poll_message_set("Run Set Up Blendlink Scene first")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        if not _scene_settings_ready(self, context):
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        number = len(project.compositions) + 1
        existing = {item.name.strip() for item in project.compositions}
        while f"Frame {number}" in existing:
            number += 1
        frame = project.compositions.add()
        frame.name = f"Frame {number}"
        frame.width = 1920
        frame.height = 1080
        frame.safe_margin = 0.08
        project.composition_index = len(project.compositions) - 1
        props.write_recipe(context.scene)
        return {"FINISHED"}


class BLENDLINK_OT_remove_composition(bpy.types.Operator):
    """Remove the selected Responsive Frame"""
    bl_idname = "blendlink.remove_composition"
    bl_label = "Remove Responsive Frame"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or len(project.compositions) <= 1:
            cls.poll_message_set("A Website Camera needs at least one Responsive Frame")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        index = min(project.composition_index, len(project.compositions) - 1)
        frame = project.compositions[index]
        snapshot = {
            "name": frame.name,
            "width": frame.width,
            "height": frame.height,
            "safe_margin": frame.safe_margin,
        }
        project.compositions.remove(index)
        project.composition_index = max(0, index - 1)
        try:
            props.write_recipe(context.scene)
        except ValueError as error:
            previous_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                restored = project.compositions.add()
                for key, value in snapshot.items():
                    setattr(restored, key, value)
                project.compositions.move(len(project.compositions) - 1, index)
                project.composition_index = index
            finally:
                props._loading_recipe = previous_loading
            self.report(
                {"ERROR"},
                f"Could not remove this Responsive Frame; correct the other scene setting first: {error}",
            )
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_add_atlas(bpy.types.Operator):
    """Create an intentional atlas exception for the selected hero meshes"""
    bl_idname = "blendlink.add_atlas"
    bl_label = "Add Atlas from Selection"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or not project.configured:
            cls.poll_message_set("Run Set Up Blendlink Scene first")
            return False
        if not any(obj.type == "MESH" for obj in context.selected_editable_objects):
            cls.poll_message_set("Select one or more hero meshes")
            return False
        return True

    def execute(self, context):
        from . import handlers, props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        if not _scene_settings_ready(self, context):
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        number = len(project.atlases) + 1
        atlas_id = f"atlas-{number}"
        existing = {atlas.atlas_id for atlas in project.atlases}
        while atlas_id in existing:
            number += 1
            atlas_id = f"atlas-{number}"
        atlas = project.atlases.add()
        atlas.atlas_id = atlas_id
        atlas.name = f"Atlas {number}"
        atlas.size = project.atlases[0].size
        atlas.target_density = project.atlases[0].target_density
        atlas.margin = project.atlases[0].margin
        atlas.fit_policy = "BLOCK"
        atlas.bake_output = "LIGHTING"
        project.atlas_index = len(project.atlases) - 1
        assigned = 0
        for obj in context.selected_editable_objects:
            if obj.type == "MESH":
                obj["blendlink_atlas"] = atlas_id
                assigned += 1
        props.write_recipe(context.scene)
        handlers.mark_bake_table_changed()
        self.report({"INFO"}, f"Created {atlas.name} and assigned {assigned} selected mesh(es)")
        return {"FINISHED"}


class BLENDLINK_OT_remove_atlas(bpy.types.Operator):
    """Remove the active additional atlas; its objects return to Main"""
    bl_idname = "blendlink.remove_atlas"
    bl_label = "Remove Atlas"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or len(project.atlases) <= 1 or project.atlas_index <= 0:
            cls.poll_message_set("Main is undeletable; select an additional atlas")
            return False
        if not getattr(context.scene, "is_editable", True):
            cls.poll_message_set("Make this linked scene local before removing an atlas")
            return False
        return True

    def execute(self, context):
        from . import handlers, props
        project = context.scene.blendlink_project
        index = min(project.atlas_index, len(project.atlases) - 1)
        atlas = project.atlases[index]
        atlas_id = atlas.atlas_id
        atlas_name = _atlas_display_name(project, atlas_id)
        atlas_snapshot = {
            "atlas_id": atlas.atlas_id,
            "name": atlas.name,
            "size": atlas.size,
            "target_density": atlas.target_density,
            "margin": atlas.margin,
            "fit_policy": atlas.fit_policy,
            "bake_output": atlas.bake_output,
        }
        assigned = [
            obj for obj in context.scene.objects
            if obj.get("blendlink_atlas") == atlas_id
        ]
        blocked = [obj for obj in assigned if not getattr(obj, "is_editable", True)]
        if blocked:
            print(
                f"blendlink addon: cannot remove atlas {atlas_name!r}; linked/read-only members: "
                + ", ".join(obj.name for obj in blocked)
            )
            self.report(
                {"ERROR"},
                f"{len(blocked)} assigned object(s) are linked/read-only; make them local or move them in their source .blend",
            )
            return {"CANCELLED"}
        cleared = []
        try:
            for obj in assigned:
                del obj["blendlink_atlas"]
                cleared.append(obj)
        except (AttributeError, KeyError, RuntimeError, TypeError) as error:
            rollback_errors = []
            for obj in cleared:
                try:
                    obj["blendlink_atlas"] = atlas_id
                except Exception as rollback_error:
                    rollback_errors.append(f"{obj.name}: {rollback_error}")
            detail = (
                "; rollback failed for " + "; ".join(rollback_errors)
                if rollback_errors else "; prior assignments were restored"
            )
            self.report({"ERROR"}, f"Could not remove {atlas_name}: {error}{detail}")
            return {"CANCELLED"}
        removed_record = False
        try:
            project.atlases.remove(index)
            removed_record = True
            project.atlas_index = max(0, index - 1)
            props.write_recipe(context.scene)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            if removed_record:
                previous_loading = props._loading_recipe
                props._loading_recipe = True
                try:
                    restored = project.atlases.add()
                    for key, value in atlas_snapshot.items():
                        setattr(restored, key, value)
                    project.atlases.move(len(project.atlases) - 1, index)
                    project.atlas_index = index
                except Exception as rollback_error:
                    print(
                        f"blendlink addon: could not restore atlas {atlas_name!r}: "
                        f"{type(rollback_error).__name__}: {rollback_error}"
                    )
                finally:
                    props._loading_recipe = previous_loading
            for obj in cleared:
                try:
                    obj["blendlink_atlas"] = atlas_id
                except Exception as rollback_error:
                    print(
                        f"blendlink addon: could not restore atlas assignment on {obj.name!r}: "
                        f"{type(rollback_error).__name__}: {rollback_error}"
                    )
            self.report(
                {"ERROR"},
                f"Could not finish removing {atlas_name}; correct the reported scene setting and try again: {error}",
            )
            return {"CANCELLED"}
        handlers.mark_bake_table_changed()
        self.report({"INFO"}, f"Removed {atlas_name}; {len(cleared)} object(s) returned to Main")
        return {"FINISHED"}


class BLENDLINK_OT_add_state(bpy.types.Operator):
    bl_idname = "blendlink.add_state"
    bl_label = "Add Lighting State"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or not project.configured:
            cls.poll_message_set("Run Set Up Blendlink Scene first")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context) or not _scene_settings_ready(self, context):
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        number = len(project.states) + 1
        existing = {item.name.strip() for item in project.states}
        while f"Lighting State {number}" in existing:
            number += 1
        state = project.states.add()
        state.name = f"Lighting State {number}"
        project.state_index = len(project.states) - 1
        props.write_recipe(context.scene)
        return {"FINISHED"}


def _active_lighting_state(context):
    project = getattr(context.scene, "blendlink_project", None)
    if project is None or not len(project.states):
        return None
    return project.states[min(project.state_index, len(project.states) - 1)]


def _scene_collection_names(scene) -> list[str]:
    result = []
    stack = list(scene.collection.children)
    seen = set()
    while stack:
        collection = stack.pop()
        pointer = collection.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        result.append(collection.name)
        stack.extend(collection.children)
    return sorted(result, key=str.casefold)


_DYNAMIC_ENUM_ITEMS = {}


def _cached_enum_items(kind: str, items):
    """Retain dynamic-enum strings for Blender's required callback lifetime."""
    normalized = tuple(tuple(str(value) for value in item) for item in items)
    key = (kind, normalized)
    return _DYNAMIC_ENUM_ITEMS.setdefault(key, normalized)


def _active_material(context):
    material = getattr(context, "material", None)
    if material is None:
        obj = getattr(context, "active_object", None)
        material = getattr(obj, "active_material", None) if obj is not None else None
    return material


def _web_material_output_items(self, context):
    material = _active_material(context)
    tree = getattr(material, "node_tree", None)
    node = getattr(getattr(tree, "nodes", None), "active", None)
    items = [
        (identifier, name, f"Use {node.name} / {name} ({socket_type})")
        for identifier, name, socket_type in material_compiler.eligible_outputs(node)
    ] if node is not None else []
    return _cached_enum_items(
        "web-material-outputs",
        items or [("__NONE__", "No Color/Value outputs", "Select a source node first")],
    )


def _hidden_collection_items(self, context):
    from . import props
    state = _active_lighting_state(context)
    existing = set(props.hidden_collection_names(state)) if state is not None else set()
    items = [
        (name, name, f"Hide {name} while this state bakes")
        for name in _scene_collection_names(context.scene)
        if name not in existing
        and getattr(bpy.data.collections.get(name), "is_editable", True)
    ]
    return _cached_enum_items(
        "hidden-collections",
        items or [(
            "__NONE__", "No writable collections available",
            "Every local scene collection is already listed or the remaining collections are linked",
        )],
    )


class BLENDLINK_OT_add_state_hidden_collection(bpy.types.Operator):
    """Add a scene collection to the active lighting state's hidden set"""
    bl_idname = "blendlink.add_state_hidden_collection"
    bl_label = "Add Hidden Collection"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "collection_name"

    collection_name: bpy.props.EnumProperty(
        name="Collection",
        description="Scene collection hidden while this lighting state bakes",
        items=_hidden_collection_items,
    )

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        if _active_lighting_state(context) is None:
            cls.poll_message_set("Add a lighting state first")
            return False
        return True

    def invoke(self, context, event):
        return context.window_manager.invoke_search_popup(self)

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context) or not _scene_settings_ready(self, context):
            return {"CANCELLED"}
        state = _active_lighting_state(context)
        if state is None or self.collection_name == "__NONE__":
            self.report({"WARNING"}, "No additional scene collection is available")
            return {"CANCELLED"}
        names = props.hidden_collection_names(state)
        if self.collection_name in names:
            self.report({"INFO"}, f"{self.collection_name} is already hidden in this state")
            return {"FINISHED"}
        props.set_hidden_collection_names(state, [*names, self.collection_name])
        self.report({"INFO"}, f"{self.collection_name} will be hidden in {state.name}")
        return {"FINISHED"}


class BLENDLINK_OT_remove_state_hidden_collection(bpy.types.Operator):
    """Remove one collection from the active lighting state's hidden set"""
    bl_idname = "blendlink.remove_state_hidden_collection"
    bl_label = "Remove Hidden Collection"
    bl_options = {"REGISTER", "UNDO"}

    collection_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        if _active_lighting_state(context) is None:
            cls.poll_message_set("Add a lighting state first")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        state = _active_lighting_state(context)
        if state is None:
            self.report({"ERROR"}, "The lighting state no longer exists")
            return {"CANCELLED"}
        names = props.hidden_collection_names(state)
        if self.collection_name not in names:
            self.report({"WARNING"}, f"{self.collection_name} is not hidden in this state")
            return {"CANCELLED"}
        props.set_hidden_collection_names(
            state, [name for name in names if name != self.collection_name],
        )
        self.report({"INFO"}, f"{self.collection_name} remains visible in {state.name}")
        return {"FINISHED"}


class BLENDLINK_OT_select_state_collection_objects(bpy.types.Operator):
    """Select scene objects belonging to one lighting-state collection"""
    bl_idname = "blendlink.select_state_collection_objects"
    bl_label = "Select Collection Objects"
    bl_options = {"REGISTER", "UNDO"}

    collection_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        from . import props
        collection = props.scene_collection_by_name(context.scene, self.collection_name)
        if collection is None:
            self.report({"ERROR"}, f"Collection {self.collection_name!r} is no longer in this scene")
            return {"CANCELLED"}
        matches = [obj for obj in collection.all_objects if obj.name in context.scene.objects]
        selected_objects, skipped = _select_only(context, matches)
        if selected_objects:
            note = f" · {skipped} unavailable in this view" if skipped else ""
            self.report(
                {"INFO"},
                f"Selected {len(selected_objects)} object(s) in {collection.name}{note}",
            )
        else:
            self.report(
                {"WARNING"},
                f"No selectable objects in {collection.name}; unhide the collection to inspect it",
            )
        return {"FINISHED"}


class BLENDLINK_OT_remove_state(bpy.types.Operator):
    bl_idname = "blendlink.remove_state"
    bl_label = "Remove Lighting State"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or len(project.states) <= 1:
            cls.poll_message_set("Every published scene needs at least one lighting state")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context):
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        index = min(project.state_index, len(project.states) - 1)
        state = project.states[index]
        snapshot = {
            "name": state.name,
            "hide_collections": state.hide_collections,
        }
        project.states.remove(index)
        project.state_index = max(0, index - 1)
        try:
            props.write_recipe(context.scene)
        except ValueError as error:
            previous_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                restored = project.states.add()
                for key, value in snapshot.items():
                    setattr(restored, key, value)
                project.states.move(len(project.states) - 1, index)
                project.state_index = index
            finally:
                props._loading_recipe = previous_loading
            self.report(
                {"ERROR"},
                f"Could not remove this Lighting State; correct the other scene setting first: {error}",
            )
            return {"CANCELLED"}
        return {"FINISHED"}


def _active_reflection_probe(context):
    project = getattr(context.scene, "blendlink_project", None)
    if not project or not len(project.reflection_probes):
        return None
    index = min(project.reflection_probe_index, len(project.reflection_probes) - 1)
    return project.reflection_probes[index]


class BLENDLINK_OT_add_reflection_probe(bpy.types.Operator):
    """Create a visible local-reflection volume and assign selected meshes"""
    bl_idname = "blendlink.add_reflection_probe"
    bl_label = "Add Probe from Selection"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        issue = _scene_editability_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        project = getattr(context.scene, "blendlink_project", None)
        if not project or not project.configured:
            cls.poll_message_set("Run Set Up Blendlink Scene first")
            return False
        if not any(obj.type == "MESH" for obj in context.selected_editable_objects):
            cls.poll_message_set("Select one or more reflective meshes")
            return False
        if _writable_target_collection(context) is None:
            cls.poll_message_set("Make the active collection local to this scene")
            return False
        return True

    def execute(self, context):
        from . import props
        if not _require_editable_scene(self, context) or not _scene_settings_ready(self, context):
            return {"CANCELLED"}
        target_collection = _writable_target_collection(context)
        if target_collection is None:
            self.report({"ERROR"}, "No writable collection owned only by this scene is available")
            return {"CANCELLED"}
        project = context.scene.blendlink_project
        meshes = [obj for obj in context.selected_editable_objects if obj.type == "MESH"]
        points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
        if points:
            center = sum(points, Vector()) / len(points)
            influence = max((point - center).length for point in points) * 1.1
            influence = max(0.01, influence)
        else:
            center = context.scene.cursor.location.copy()
            influence = 5.0

        helper = bpy.data.objects.new("Reflection Probe", None)
        try:
            target_collection.objects.link(helper)
        except (RuntimeError, TypeError) as error:
            bpy.data.objects.remove(helper)
            self.report({"ERROR"}, f"Could not add the probe helper to this scene: {error}")
            return {"CANCELLED"}
        helper.location = center
        helper_id = str(uuid.uuid4())
        helper["blendlink_id"] = helper_id

        number = len(project.reflection_probes) + 1
        existing_names = {item.name.strip() for item in project.reflection_probes}
        while f"Probe {number}" in existing_names:
            number += 1
        prior_assignments = [
            (obj, "blendlink_reflection_probe" in obj, obj.get("blendlink_reflection_probe"))
            for obj in meshes
        ]
        probe = project.reflection_probes.add()
        probe_index = len(project.reflection_probes) - 1
        try:
            probe.name = f"Probe {number}"
            probe.object_id = helper_id
            probe.probe_object = helper
            probe.shape = "BOX"
            probe.capture_mode = "RUNTIME"
            probe.resolution = "256"
            probe.samples = 128
            probe.influence = influence
            probe.intensity = 1.0
            project.reflection_probe_index = probe_index
            for obj in meshes:
                obj["blendlink_reflection_probe"] = helper_id
            props.write_recipe(context.scene)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            previous_loading = props._loading_recipe
            props._loading_recipe = True
            try:
                if probe_index < len(project.reflection_probes):
                    project.reflection_probes.remove(probe_index)
                project.reflection_probe_index = max(0, probe_index - 1)
            finally:
                props._loading_recipe = previous_loading
            for obj, had_assignment, value in prior_assignments:
                try:
                    if had_assignment:
                        obj["blendlink_reflection_probe"] = value
                    else:
                        obj.pop("blendlink_reflection_probe", None)
                except Exception as rollback_error:
                    print(
                        f"blendlink addon: could not restore reflection assignment on {obj.name!r}: "
                        f"{type(rollback_error).__name__}: {rollback_error}"
                    )
            bpy.data.objects.remove(helper, do_unlink=True)
            self.report({"ERROR"}, f"Could not add the reflection probe: {error}")
            return {"CANCELLED"}

        selected_helpers, _skipped = _select_only(context, [helper])
        validation.mark_dirty()
        selection_note = "" if selected_helpers else "; helper could not be selected"
        self.report(
            {"INFO"},
            f"Created {probe.name} at the selection center; assigned {len(meshes)} mesh(es)"
            f"{selection_note}",
        )
        return {"FINISHED"}


class BLENDLINK_OT_remove_reflection_probe(bpy.types.Operator):
    """Remove the active helper and clear every mesh assignment to it"""
    bl_idname = "blendlink.remove_reflection_probe"
    bl_label = "Remove Reflection Probe"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if _active_reflection_probe(context) is None:
            cls.poll_message_set("Add or select a reflection probe first")
            return False
        if not getattr(context.scene, "is_editable", True):
            cls.poll_message_set("Make this linked scene local before removing a probe")
            return False
        return True

    def execute(self, context):
        from . import props
        project = context.scene.blendlink_project
        index = min(project.reflection_probe_index, len(project.reflection_probes) - 1)
        probe = project.reflection_probes[index]
        probe_name = probe.name
        object_id = probe.object_id
        helper = probe.probe_object
        assigned = [
            obj for obj in context.scene.objects
            if obj.get("blendlink_reflection_probe") == object_id
        ]
        blocked = [obj for obj in assigned if not getattr(obj, "is_editable", True)]
        helper_in_scene = (
            helper is not None and context.scene.objects.get(helper.name) is helper
        )
        owner_scenes = (
            [scene for scene in bpy.data.scenes if scene.objects.get(helper.name) is helper]
            if helper is not None else []
        )
        if helper_in_scene and not getattr(helper, "is_editable", True):
            blocked.append(helper)
        if helper_in_scene and len(owner_scenes) > 1:
            print(
                f"blendlink addon: probe helper {helper.name!r} belongs to multiple scenes: "
                + ", ".join(scene.name for scene in owner_scenes)
            )
            self.report(
                {"ERROR"},
                "The probe helper is shared by multiple scenes; make it single-scene before removing the probe",
            )
            return {"CANCELLED"}
        if blocked:
            unique_blocked = list(dict.fromkeys(obj.name for obj in blocked))
            print(
                f"blendlink addon: cannot remove probe {probe_name!r}; linked/read-only data: "
                + ", ".join(unique_blocked)
            )
            self.report(
                {"ERROR"},
                f"{len(unique_blocked)} assigned item(s) are linked/read-only; make them local or edit the source .blend",
            )
            return {"CANCELLED"}

        probe_snapshot = {
            "name": probe.name,
            "object_id": probe.object_id,
            "probe_object": probe.probe_object,
            "shape": probe.shape,
            "capture_mode": probe.capture_mode,
            "resolution": probe.resolution,
            "samples": probe.samples,
            "influence": probe.influence,
            "intensity": probe.intensity,
            "anchor": probe.anchor,
            "custom_image": probe.custom_image,
            "baked_image": probe.baked_image,
            "baked_source_hash": probe.baked_source_hash,
            "baked_content_hash": probe.baked_content_hash,
            "baked_at_utc": probe.baked_at_utc,
            "derived_asset_path": probe.derived_asset_path,
            "baked_width": probe.baked_width,
            "baked_height": probe.baked_height,
        }
        cleared = []
        try:
            for obj in assigned:
                del obj["blendlink_reflection_probe"]
                cleared.append(obj)
        except (AttributeError, KeyError, RuntimeError, TypeError) as error:
            rollback_errors = []
            for obj in cleared:
                try:
                    obj["blendlink_reflection_probe"] = object_id
                except Exception as rollback_error:
                    rollback_errors.append(f"{obj.name}: {rollback_error}")
            detail = (
                "; rollback failed for " + "; ".join(rollback_errors)
                if rollback_errors else "; prior assignments were restored"
            )
            self.report({"ERROR"}, f"Could not remove {probe_name}: {error}{detail}")
            return {"CANCELLED"}

        removed_record = False
        try:
            project.reflection_probes.remove(index)
            removed_record = True
            project.reflection_probe_index = max(0, index - 1)
            props.write_recipe(context.scene)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            if removed_record:
                previous_loading = props._loading_recipe
                props._loading_recipe = True
                try:
                    restored = project.reflection_probes.add()
                    for key, value in probe_snapshot.items():
                        setattr(restored, key, value)
                    project.reflection_probes.move(
                        len(project.reflection_probes) - 1, index,
                    )
                    project.reflection_probe_index = index
                except Exception as rollback_error:
                    print(
                        f"blendlink addon: could not restore probe {probe_name!r}: "
                        f"{type(rollback_error).__name__}: {rollback_error}"
                    )
                finally:
                    props._loading_recipe = previous_loading
            for obj in cleared:
                try:
                    obj["blendlink_reflection_probe"] = object_id
                except Exception as rollback_error:
                    print(
                        f"blendlink addon: could not restore probe assignment on {obj.name!r}: "
                        f"{type(rollback_error).__name__}: {rollback_error}"
                    )
            self.report(
                {"ERROR"},
                f"Could not finish removing {probe_name}; correct the reported scene setting and try again: {error}",
            )
            return {"CANCELLED"}

        helper_note = ""
        if helper_in_scene:
            try:
                bpy.data.objects.remove(helper, do_unlink=True)
            except (ReferenceError, RuntimeError, TypeError) as error:
                print(
                    f"blendlink addon: removed probe settings but could not delete helper "
                    f"{helper.name!r}: {type(error).__name__}: {error}"
                )
                helper_note = "; helper could not be deleted—remove it manually"
        elif helper is not None:
            helper_note = "; helper belongs to another scene and was left untouched"
        validation.mark_dirty()
        self.report(
            {"WARNING" if helper_note else "INFO"},
            f"Removed {probe_name}; cleared {len(cleared)} mesh assignment(s){helper_note}",
        )
        return {"FINISHED"}


class BLENDLINK_OT_assign_reflection_probe(bpy.types.Operator):
    """Assign the active named probe to selected meshes"""
    bl_idname = "blendlink.assign_reflection_probe"
    bl_label = "Assign Selected Meshes"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        probe = _active_reflection_probe(context)
        if probe is None or not probe.object_id:
            cls.poll_message_set("Add or select a reflection probe first")
            return False
        helper = probe.probe_object
        if helper is None or context.scene.objects.get(helper.name) is not helper \
                or helper.get("blendlink_id") != probe.object_id:
            cls.poll_message_set("The selected probe helper is missing; remove or repair the probe")
            return False
        if not any(obj.type == "MESH" for obj in context.selected_editable_objects):
            cls.poll_message_set("Select one or more meshes")
            return False
        return True

    def execute(self, context):
        probe = _active_reflection_probe(context)
        helper = probe.probe_object if probe is not None else None
        if probe is None or helper is None \
                or context.scene.objects.get(helper.name) is not helper \
                or helper.get("blendlink_id") != probe.object_id:
            self.report({"ERROR"}, "The selected probe helper is missing; remove or repair the probe")
            return {"CANCELLED"}
        meshes = [obj for obj in context.selected_editable_objects if obj.type == "MESH"]
        changed = 0
        unchanged = 0
        for obj in meshes:
            if obj.get("blendlink_reflection_probe") == probe.object_id:
                unchanged += 1
                continue
            obj["blendlink_reflection_probe"] = probe.object_id
            changed += 1
        if changed:
            validation.mark_dirty()
        self.report(
            {"INFO"},
            f"Assigned {probe.name} — {changed} changed · {unchanged} already assigned",
        )
        return {"FINISHED"}


class BLENDLINK_OT_clear_reflection_probe(bpy.types.Operator):
    """Return selected meshes to the scene environment"""
    bl_idname = "blendlink.clear_reflection_probe"
    bl_label = "Use Scene Environment"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if not any(obj.type == "MESH" for obj in context.selected_editable_objects):
            cls.poll_message_set("Select one or more meshes")
            return False
        return True

    def execute(self, context):
        cleared = 0
        for obj in context.selected_editable_objects:
            if obj.type == "MESH" and "blendlink_reflection_probe" in obj:
                del obj["blendlink_reflection_probe"]
                cleared += 1
        if cleared:
            validation.mark_dirty()
        self.report({"INFO"}, f"Cleared local reflections from {cleared} mesh(es)")
        return {"FINISHED"}


class BLENDLINK_OT_select_reflection_probe_members(bpy.types.Operator):
    """Select every mesh explicitly assigned to the active probe"""
    bl_idname = "blendlink.select_reflection_probe_members"
    bl_label = "Select Assigned Meshes"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if _active_reflection_probe(context) is None:
            cls.poll_message_set("Add or select a reflection probe first")
            return False
        return True

    def execute(self, context):
        probe = _active_reflection_probe(context)
        matches = [
            obj for obj in context.scene.objects
            if obj.type == "MESH" and obj.get("blendlink_reflection_probe") == probe.object_id
        ]
        selected, skipped = _select_only(context, matches)
        if selected:
            note = f" · {skipped} unavailable in this view" if skipped else ""
            self.report(
                {"INFO"}, f"Selected {len(selected)} mesh(es) assigned to {probe.name}{note}",
            )
        else:
            self.report(
                {"WARNING"},
                f"{probe.name} has no assigned meshes available in this view",
            )
        return {"FINISHED"}


class BLENDLINK_OT_bake_reflection_probe(bpy.types.Operator):
    """Render and atomically publish the active Blender Bake reflection probe"""
    bl_idname = "blendlink.bake_reflection_probe"
    bl_label = "Bake Reflection Probe"
    # Writes the probe's baked image, hashes and dimensions into the .blend
    # and creates an Image datablock, so it belongs on the undo stack. Without
    # UNDO an unrelated Ctrl+Z later reverts the bake with nothing to redo.
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        probe = _active_reflection_probe(context)
        if probe is None:
            cls.poll_message_set("Add or select a reflection probe first")
            return False
        if probe_authoring.mode_of(probe) != "BAKED":
            cls.poll_message_set("Set Reflection Source to Blender Bake")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save this .blend before baking reflection probes")
            return False
        if probe.probe_object is None:
            cls.poll_message_set("The selected probe helper is missing")
            return False
        return True

    def execute(self, context):
        probe = _active_reflection_probe(context)
        if probe is None:
            self.report({"ERROR"}, "No active reflection probe")
            return {"CANCELLED"}
        window = getattr(context, "window", None)
        if window is not None:
            window.cursor_set("WAIT")
        try:
            results = probe_authoring.bake(context, [probe])
        except Exception as error:
            message = f"Reflection probe bake failed: {type(error).__name__}: {error}"
            print(f"blendlink addon: {message}")
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        finally:
            if window is not None:
                window.cursor_set("DEFAULT")
        result = results[0]
        self.report(
            {"INFO"},
            f"Baked {result.name} · {result.width} x {result.height} · "
            f"{result.bytes / (1024 * 1024):.1f} MB · "
            f"{result.device_class.upper()}/{result.backend.upper()} · "
            f"{result.content_hash}",
        )
        return {"FINISHED"}


class BLENDLINK_OT_bake_all_reflection_probes(bpy.types.Operator):
    """Bake every Blender Bake probe; commit none unless every render succeeds"""
    bl_idname = "blendlink.bake_all_reflection_probes"
    bl_label = "Bake All Reflection Probes"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        if project is None or not any(
                probe_authoring.mode_of(probe) == "BAKED"
                for probe in project.reflection_probes):
            cls.poll_message_set("No reflection probes use Blender Bake")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save this .blend before baking reflection probes")
            return False
        return True

    def execute(self, context):
        project = context.scene.blendlink_project
        probes = [
            probe for probe in project.reflection_probes
            if probe_authoring.mode_of(probe) == "BAKED"
        ]
        window = getattr(context, "window", None)
        if window is not None:
            window.cursor_set("WAIT")
        try:
            results = probe_authoring.bake(context, probes)
        except Exception as error:
            message = (
                "Bake All stopped without replacing prior probe assets: "
                f"{type(error).__name__}: {error}"
            )
            print(f"blendlink addon: {message}")
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        finally:
            if window is not None:
                window.cursor_set("DEFAULT")
        total = sum(result.bytes for result in results)
        devices = ", ".join(sorted({
            f"{result.device_class.upper()}/{result.backend.upper()}"
            for result in results
        }))
        self.report(
            {"INFO"},
            f"Baked {len(results)} reflection probe(s) atomically · "
            f"{total / (1024 * 1024):.1f} MB · {devices}",
        )
        return {"FINISHED"}


class BLENDLINK_OT_refresh_reflection_probe_status(bpy.types.Operator):
    """Rehash reflection sources and scene dependencies now"""
    bl_idname = "blendlink.refresh_reflection_probe_status"
    bl_label = "Refresh Reflection Source Status"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        probe_authoring.mark_dirty(context.scene)
        probe_authoring.prepare_status_cache(context.scene, force=True)
        self.report({"INFO"}, "Reflection probe source status refreshed")
        return {"FINISHED"}


class BLENDLINK_OT_open_reflection_probe_asset(bpy.types.Operator):
    """Open the verified reflection source in the operating system"""
    bl_idname = "blendlink.open_reflection_probe_asset"
    bl_label = "Open Reflection Texture"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        probe = _active_reflection_probe(context)
        status = probe_authoring.status_for(probe) if probe is not None else None
        path = status.evidence.path if status and status.evidence else ""
        if not path or not os.path.isfile(path):
            cls.poll_message_set("This reflection source is packed or has no readable file")
            return False
        return True

    def execute(self, context):
        probe = _active_reflection_probe(context)
        status = probe_authoring.status_for(probe) if probe is not None else None
        path = status.evidence.path if status and status.evidence else ""
        if not path or not os.path.isfile(path):
            self.report({"ERROR"}, "The reflection source file is missing or packed")
            return {"CANCELLED"}
        bpy.ops.wm.path_open(filepath=path)
        return {"FINISHED"}


class BLENDLINK_OT_set_area_light_mode(bpy.types.Operator):
    """Choose whether one Blender Area light gets a live Three approximation"""

    bl_idname = "blendlink.set_area_light_mode"
    bl_label = "Set Website Area Light"
    bl_options = {"REGISTER", "UNDO"}

    mode: bpy.props.EnumProperty(
        name="Website Area Light",
        items=(
            (
                "AUTO",
                "Automatic (Default)",
                "Publish the proven rectangle subset and keep unsupported authored semantics bake-only",
            ),
            (
                "BAKE_ONLY",
                "Bake Only",
                "Keep this Blender Area light in baked artwork without adding a realtime web light",
            ),
            (
                "THREE_RECT_AREA",
                "Three Rect Area (Approximation)",
                "Publish a shadowless Three.js RectAreaLight for live PBR receivers",
            ),
        ),
        default="AUTO",
    )
    object_name: bpy.props.StringProperty(options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        light = getattr(context, "light", None)
        if str(getattr(light, "type", "")).upper() == "AREA":
            return True
        obj = getattr(context, "object", None) or getattr(context, "active_object", None)
        if getattr(obj, "type", None) != "LIGHT" \
                or str(getattr(getattr(obj, "data", None), "type", "")).upper() != "AREA":
            cls.poll_message_set("Select a Blender Area light")
            return False
        return True

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name) if self.object_name else (
            getattr(context, "object", None) or getattr(context, "active_object", None)
        )
        if obj is None or getattr(obj, "type", None) != "LIGHT" \
                or str(getattr(getattr(obj, "data", None), "type", "")).upper() != "AREA":
            self.report({"ERROR"}, "The target is no longer a Blender Area light")
            return {"CANCELLED"}
        if obj.name not in context.scene.objects:
            self.report({"ERROR"}, "The target Area light is not in the active scene")
            return {"CANCELLED"}
        if not getattr(obj, "is_editable", True):
            self.report({"ERROR"}, "The target Area light is linked and not editable")
            return {"CANCELLED"}

        if self.mode == "THREE_RECT_AREA":
            obj[weblights.AREA_LIGHT_MODE_PROPERTY] = \
                weblights.AREA_LIGHT_MODE_THREE_RECT
            obj.id_properties_ui(weblights.AREA_LIGHT_MODE_PROPERTY).update(
                description=(
                    "Blendlink opt-in for a shadowless Three.js RectAreaLight "
                    "approximation on live PBR receivers"
                ),
            )
            message = f'Enabled Three Rect Area approximation for "{obj.name}"'
        elif self.mode == "BAKE_ONLY":
            obj[weblights.AREA_LIGHT_MODE_PROPERTY] = \
                weblights.AREA_LIGHT_MODE_BAKE_ONLY
            obj.id_properties_ui(weblights.AREA_LIGHT_MODE_PROPERTY).update(
                description=(
                    "Blendlink artist override: keep this Area light in baked "
                    "artwork without a realtime website approximation"
                ),
            )
            message = f'Kept "{obj.name}" as an explicit bake-only Area light'
        else:
            obj.pop(weblights.AREA_LIGHT_MODE_PROPERTY, None)
            message = f'Restored Automatic Website Area Light for "{obj.name}"'

        validation.mark_dirty()
        self.report({"INFO"}, message)
        return {"FINISHED"}


class BLENDLINK_OT_tag_collider(bpy.types.Operator):
    """Rename selected objects with a collider suffix the web build understands"""
    bl_idname = "blendlink.tag_collider"
    bl_label = "Tag as Collider"
    bl_options = {"REGISTER", "UNDO"}

    kind: bpy.props.EnumProperty(
        name="Collider Type",
        items=(
            ("col", "Trimesh (-col)", "Exact triangle-mesh collider, object stays visible"),
            ("convcol", "Convex (-convcol)", "Convex-hull collider, object stays visible"),
            ("colonly", "Trimesh Proxy (-colonly)", "Collision-only proxy, removed from the render"),
            ("convcolonly", "Convex Proxy (-convcolonly)", "Convex collision-only proxy, removed from the render"),
        ),
        default="colonly",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not _mesh_or_empty_selected(context):
            cls.poll_message_set("Select a mesh or empty to tag")
            return False
        return True

    def execute(self, context):
        tagged, skipped = 0, []
        for obj in context.selected_editable_objects:
            if obj.type not in ("MESH", "EMPTY"):
                continue
            base = vocab.strip_structural(obj.name)
            if _rename(obj, f"{base}{_SEP}{self.kind}"):
                obj.pop("blendlink_role", None)
                tagged += 1
            else:
                skipped.append(obj.name)
        validation.mark_dirty()
        if skipped:
            self.report({"WARNING"}, f"Tagged {tagged}, skipped name collisions: {', '.join(skipped)}")
        else:
            label = {
                "col": "Trimesh Collider",
                "convcol": "Convex Collider",
                "colonly": "Trimesh Proxy",
                "convcolonly": "Convex Proxy",
            }[self.kind]
            self.report({"INFO"}, f"Tagged {tagged} object(s) as {label}")
        return {"FINISHED"}


class BLENDLINK_OT_tag_rigid(bpy.types.Operator):
    """Rename selected objects as rigid bodies and add mass and friction properties"""
    bl_idname = "blendlink.tag_rigid"
    bl_label = "Tag as Rigid Body"
    bl_options = {"REGISTER", "UNDO"}

    mass: bpy.props.FloatProperty(
        name="Mass", default=1.0, min=0.0, soft_max=100.0,
        description="Rigid-body mass in kilograms",
    )
    friction: bpy.props.FloatProperty(
        name="Friction", default=0.5, min=0.0, max=1.0,
        description="Surface friction coefficient",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh to tag")
            return False
        return True

    def execute(self, context):
        tagged, skipped = 0, []
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}{_SEP}rigid"):
                skipped.append(obj.name)
                continue
            obj.pop("blendlink_role", None)
            obj["blendlink_mass"] = self.mass
            obj.id_properties_ui("blendlink_mass").update(
                min=0.0, soft_max=100.0, precision=2,
                description="Rigid-body mass in kilograms",
            )
            obj["blendlink_friction"] = self.friction
            obj.id_properties_ui("blendlink_friction").update(
                min=0.0, max=1.0, precision=2,
                description="Surface friction coefficient",
            )
            tagged += 1
        validation.mark_dirty()
        if skipped:
            self.report(
                {"WARNING"},
                f"Tagged {tagged} rigid bod{'y' if tagged == 1 else 'ies'}; "
                f"skipped name collisions: {', '.join(skipped)}",
            )
        else:
            self.report({"INFO"}, f"Tagged {tagged} rigid bod{'y' if tagged == 1 else 'ies'}")
        return {"FINISHED"}


class BLENDLINK_OT_set_lod(bpy.types.Operator):
    """Rename selected objects into a LOD chain level"""
    bl_idname = "blendlink.set_lod"
    bl_label = "Set LOD Level"
    bl_options = {"REGISTER", "UNDO"}

    level: bpy.props.IntProperty(name="Level", default=0, min=0, max=7)
    distance: bpy.props.FloatProperty(
        name="Switch Distance", default=0.0, min=0.0, soft_max=200.0, subtype="DISTANCE",
        description="Camera distance where this level takes over (0 leaves it unset)",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh to place in a LOD chain")
            return False
        return True

    def execute(self, context):
        tagged, skipped = 0, []
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}_LOD{self.level}"):
                skipped.append(obj.name)
                continue
            obj.pop("blendlink_role", None)
            if self.distance > 0.0:
                obj["blendlink_lod_distance"] = self.distance
                obj.id_properties_ui("blendlink_lod_distance").update(
                    min=0.0, soft_max=500.0, subtype="DISTANCE",
                    description="Camera distance where this level takes over",
                )
            else:
                obj.pop("blendlink_lod_distance", None)
            tagged += 1
        validation.mark_dirty()
        distance = f" at {self.distance:g}m" if self.distance > 0.0 else " with distance unset"
        message = f"Set {tagged} object(s) to LOD{self.level}{distance}"
        if skipped:
            self.report({"WARNING"}, message + f"; skipped name collisions: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, message)
        return {"FINISHED"}


class BLENDLINK_OT_tag_noimp(bpy.types.Operator):
    """Rename selected objects so the web export leaves them out"""
    bl_idname = "blendlink.tag_noimp"
    bl_label = "Exclude from Web Export"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not context.selected_editable_objects:
            cls.poll_message_set("Select objects to exclude")
            return False
        return True

    def execute(self, context):
        tagged, skipped = 0, []
        for obj in context.selected_editable_objects:
            base = vocab.strip_structural(obj.name)
            if _rename(obj, f"{base}{_SEP}noimp"):
                obj.pop("blendlink_role", None)
                tagged += 1
            else:
                skipped.append(obj.name)
        validation.mark_dirty()
        message = f"Excluded {tagged} object(s) from export"
        if skipped:
            self.report({"WARNING"}, message + f"; skipped name collisions: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, message)
        return {"FINISHED"}


class BLENDLINK_OT_set_export_inclusion(bpy.types.Operator):
    """Include or exclude selected objects without forcing an artist rename"""
    bl_idname = "blendlink.set_export_inclusion"
    bl_label = "Set Web Export Inclusion"
    bl_options = {"REGISTER", "UNDO"}

    include: bpy.props.BoolProperty(default=True, options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return bool(context.selected_editable_objects)

    def execute(self, context):
        changed = 0
        skipped = []
        for obj in context.selected_editable_objects:
            if self.include:
                classification = vocab.classify(obj.name)
                if classification is not None and classification.kind == "noimp":
                    target_name = vocab.strip_structural(obj.name)
                    if not _rename(obj, target_name):
                        skipped.append(obj.name)
                        continue
                object_changed = classification is not None and classification.kind == "noimp"
                if obj.get("blendlink_role") == "noimp":
                    del obj["blendlink_role"]
                    object_changed = True
                changed += int(object_changed)
            elif obj.get("blendlink_role") != "noimp":
                obj["blendlink_role"] = "noimp"
                changed += 1
        validation.mark_dirty()
        action = "Included" if self.include else "Excluded"
        message = f"{action} {changed} object(s) {'in' if self.include else 'from'} the web scene"
        if skipped:
            self.report({"WARNING"}, message + f"; skipped name collisions: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, message)
        return {"FINISHED"}


class BLENDLINK_OT_set_initial_visibility(bpy.types.Operator):
    """Set whether selected objects are visible when the web scene starts"""
    bl_idname = "blendlink.set_initial_visibility"
    bl_label = "Set Initial Visibility"
    bl_options = {"REGISTER", "UNDO"}

    visible: bpy.props.BoolProperty(default=True, options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        if not context.selected_editable_objects:
            cls.poll_message_set("Select one or more objects")
            return False
        return True

    def execute(self, context):
        changed = 0
        unchanged = 0
        for obj in context.selected_editable_objects:
            if bool(obj.get("blendlink_active", True)) == bool(self.visible):
                unchanged += 1
                continue
            obj["blendlink_active"] = bool(self.visible)
            changed += 1
        state = "Visible" if self.visible else "Hidden"
        self.report(
            {"INFO"},
            f"Starts {state} — {changed} changed · {unchanged} already {state.lower()}",
        )
        if changed:
            validation.mark_dirty()
        return {"FINISHED"}


class BLENDLINK_OT_set_shadows(bpy.types.Operator):
    """Author portable cast/receive shadow intent on selected meshes"""
    bl_idname = "blendlink.set_shadows"
    bl_label = "Set Web Shadows"
    bl_options = {"REGISTER", "UNDO"}

    mode: bpy.props.EnumProperty(items=(
        ("AUTO", "Application Default", "Do not override the website's shadow policy"),
        ("BOTH", "Cast & Receive", "Cast shadows onto others and receive shadows"),
        ("CAST", "Cast Only", "Cast shadows but do not receive them"),
        ("RECEIVE", "Receive Only", "Receive shadows but do not cast them"),
        ("NONE", "No Realtime Shadows", "Neither cast nor receive realtime shadows"),
    ), default="AUTO")

    @classmethod
    def poll(cls, context):
        if not any(obj.type == "MESH" for obj in context.selected_editable_objects):
            cls.poll_message_set("Select one or more meshes")
            return False
        return True

    def execute(self, context):
        meshes = [obj for obj in context.selected_editable_objects if obj.type == "MESH"]
        values = {
            "BOTH": (True, True),
            "CAST": (True, False),
            "RECEIVE": (False, True),
            "NONE": (False, False),
        }
        changed = 0
        unchanged = 0
        for obj in meshes:
            current_cast = obj.get("blendlink_cast_shadow")
            current_receive = obj.get("blendlink_receive_shadow")
            if self.mode == "AUTO":
                if current_cast is None and current_receive is None:
                    unchanged += 1
                    continue
                obj.pop("blendlink_cast_shadow", None)
                obj.pop("blendlink_receive_shadow", None)
            else:
                cast, receive = values[self.mode]
                if current_cast == cast and current_receive == receive:
                    unchanged += 1
                    continue
                obj["blendlink_cast_shadow"] = cast
                obj["blendlink_receive_shadow"] = receive
            changed += 1
        label = {
            "AUTO": "Application Default", "BOTH": "Cast & Receive",
            "CAST": "Cast Only", "RECEIVE": "Receive Only", "NONE": "None",
        }[self.mode]
        self.report(
            {"INFO"}, f"Web shadows → {label} — {changed} changed · {unchanged} already set",
        )
        if changed:
            validation.mark_dirty()
        return {"FINISHED"}


class BLENDLINK_OT_set_texture_max_size(bpy.types.Operator):
    """Limit the published dimensions of one Blender image"""
    bl_idname = "blendlink.set_texture_max_size"
    bl_label = "Set Published Texture Size"
    bl_options = {"REGISTER", "UNDO"}

    image_name: bpy.props.StringProperty(options={"HIDDEN"})
    max_size: bpy.props.EnumProperty(items=(
        ("0", "Original Size", "Do not resize this image during publishing"),
        ("256", "256 px", "Limit the longest edge to 256 pixels"),
        ("512", "512 px", "Limit the longest edge to 512 pixels"),
        ("1024", "1024 px", "Limit the longest edge to 1024 pixels"),
        ("2048", "2048 px", "Limit the longest edge to 2048 pixels"),
        ("4096", "4096 px", "Limit the longest edge to 4096 pixels"),
    ), default="0")

    def execute(self, context):
        image = bpy.data.images.get(self.image_name)
        if image is None:
            self.report({"ERROR"}, f"Image {self.image_name!r} no longer exists")
            return {"CANCELLED"}
        if not getattr(image, "is_editable", True):
            self.report(
                {"ERROR"},
                f"{image.name} is linked/read-only; make the image local before changing publish settings",
            )
            return {"CANCELLED"}
        limit = int(self.max_size)
        try:
            if limit:
                image["blendlink_max_size"] = limit
                self.report({"INFO"}, f"{image.name} will publish at no more than {limit}px")
            else:
                image.pop("blendlink_max_size", None)
                self.report({"INFO"}, f"{image.name} will publish at its original dimensions")
        except (AttributeError, RuntimeError, TypeError) as error:
            self.report({"ERROR"}, f"Could not change {image.name}: {error}")
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_set_texture_compression(bpy.types.Operator):
    """Choose an artistic texture outcome, not encoder flags"""
    bl_idname = "blendlink.set_texture_compression"
    bl_label = "Set GPU Texture Compression"
    bl_options = {"REGISTER", "UNDO"}

    image_name: bpy.props.StringProperty(options={"HIDDEN"})
    mode: bpy.props.EnumProperty(items=(
        ("INHERIT", "Scene Default", "Follow GPU Textures in the Optimization panel"),
        ("NONE", "Uncompressed", "Protect this image from lossy GPU compression"),
        ("ETC1S", "Compact", "Smallest delivery size; best for smooth opaque color"),
        ("UASTC", "High Fidelity", "Protect normals, packed data, alpha, and fine detail"),
    ), default="INHERIT")

    def execute(self, context):
        image = bpy.data.images.get(self.image_name)
        if image is None:
            self.report({"ERROR"}, f"Image {self.image_name!r} no longer exists")
            return {"CANCELLED"}
        if not getattr(image, "is_editable", True):
            self.report(
                {"ERROR"},
                f"{image.name} is linked/read-only; make the image local before changing publish settings",
            )
            return {"CANCELLED"}
        try:
            if self.mode == "INHERIT":
                image.pop("blendlink_texture_compression", None)
                self.report({"INFO"}, f"{image.name} follows the scene GPU texture policy")
            else:
                value = {"NONE": "none", "ETC1S": "etc1s", "UASTC": "uastc"}[self.mode]
                image["blendlink_texture_compression"] = value
                label = {
                    "NONE": "Uncompressed", "ETC1S": "Compact", "UASTC": "High Fidelity",
                }[self.mode]
                self.report({"INFO"}, f"{image.name} GPU texture mode → {label}")
        except (AttributeError, RuntimeError, TypeError) as error:
            self.report({"ERROR"}, f"Could not change {image.name}: {error}")
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_clear_tag(bpy.types.Operator):
    """Remove the blendlink suffix or anchor prefix from selected object names"""
    bl_idname = "blendlink.clear_tag"
    bl_label = "Clear Blendlink Tag"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(
            vocab.classify(o.name, {key: o[key] for key in o.keys()})
            for o in context.selected_editable_objects
        ):
            cls.poll_message_set("Select tagged objects")
            return False
        return True

    def execute(self, context):
        cleared = 0
        skipped = []
        for obj in context.selected_editable_objects:
            extras = {key: obj[key] for key in obj.keys()}
            classification = vocab.classify(obj.name, extras)
            if classification is None:
                continue
            original_name = obj.name
            has_role = "blendlink_role" in obj
            renamed = False
            name_classification = vocab.classify(obj.name)
            if name_classification is not None:
                if name_classification.kind in ("socket", "hotspot", "audio"):
                    stripped = vocab.strip_anchor(obj.name)
                else:
                    stripped = vocab.strip_structural(obj.name)
                if not _rename(obj, stripped):
                    skipped.append(obj.name)
                    continue
                renamed = obj.name != original_name
            try:
                if has_role:
                    del obj["blendlink_role"]
            except (KeyError, RuntimeError, TypeError) as error:
                if renamed and not _rename(obj, original_name):
                    print(
                        f"blendlink addon: could not restore {obj.name!r} after tag clear failed: {error}"
                    )
                skipped.append(obj.name)
                continue
            if renamed or has_role:
                cleared += 1
        validation.mark_dirty()
        message = f"Cleared tags on {cleared} object(s)"
        if skipped:
            self.report({"WARNING"}, message + f"; skipped: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, message)
        return {"FINISHED"}


_ANCHOR_DISPLAY = {
    "SOCKET": ("ARROWS", 0.15),
    "HOTSPOT": ("SPHERE", 0.08),
    "AUDIO": ("PLAIN_AXES", 0.12),
}


class BLENDLINK_OT_add_anchor(bpy.types.Operator):
    """Add a typed anchor Empty parented to the object shown in Properties"""
    bl_idname = "blendlink.add_anchor"
    bl_label = "Add Anchor"
    bl_options = {"REGISTER", "UNDO"}

    kind: bpy.props.EnumProperty(
        name="Anchor Type",
        items=(
            ("SOCKET", "Socket", "Attachment point exposed as a typed transform"),
            ("HOTSPOT", "Hotspot", "Interactive marker with title and body text"),
            ("AUDIO", "Audio", "Positional audio emitter location"),
        ),
        default="SOCKET",
    )
    anchor_name: bpy.props.StringProperty(name="Name", default="New")
    parent_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if _writable_target_collection(context) is None:
            cls.poll_message_set("Make the active collection local to this scene")
            return False
        return True

    def execute(self, context):
        anchor_name = self.anchor_name.strip()
        if not anchor_name:
            self.report({"ERROR"}, "Give the anchor a name before adding it")
            return {"CANCELLED"}
        target_collection = _writable_target_collection(context)
        if target_collection is None:
            self.report({"ERROR"}, "No writable collection owned only by this scene is available")
            return {"CANCELLED"}
        display_type, display_size = _ANCHOR_DISPLAY[self.kind]
        anchor = bpy.data.objects.new(f"{self.kind}_{anchor_name}", None)
        anchor.empty_display_type = display_type
        anchor.empty_display_size = display_size
        try:
            target_collection.objects.link(anchor)
        except (RuntimeError, TypeError) as error:
            bpy.data.objects.remove(anchor)
            self.report({"ERROR"}, f"Could not add the anchor to this scene: {error}")
            return {"CANCELLED"}
        parent = (
            context.scene.objects.get(self.parent_name)
            if self.parent_name else context.active_object
        )
        if self.parent_name and parent is None:
            bpy.data.objects.remove(anchor, do_unlink=True)
            self.report({"ERROR"}, "The intended anchor parent is no longer in this scene")
            return {"CANCELLED"}
        if parent is not None and parent != anchor:
            anchor.parent = parent
            anchor.matrix_parent_inverse = Matrix.Identity(4)
            anchor.matrix_world = parent.matrix_world
        else:
            anchor.location = context.scene.cursor.location
        if self.kind == "HOTSPOT":
            anchor["blendlink_title"] = anchor_name
            anchor.id_properties_ui("blendlink_title").update(description="Heading shown in the web hotspot")
            anchor["blendlink_body"] = ""
            anchor.id_properties_ui("blendlink_body").update(description="Body text shown in the web hotspot")
        for obj in context.selected_objects:
            obj.select_set(False)
        anchor.select_set(True)
        context.view_layer.objects.active = anchor
        validation.mark_dirty()
        self.report({"INFO"}, f"Added {self.kind.lower()} anchor {anchor.name!r}")
        return {"FINISHED"}


class BLENDLINK_OT_fix_numbered(bpy.types.Operator):
    """Move Blender's duplicate number into the base name so the tag parses"""
    bl_idname = "blendlink.fix_numbered"
    bl_label = "Fix Numbered Name"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"SKIP_SAVE"})

    def execute(self, context):
        obj = context.scene.objects.get(self.object_name)
        if obj is None:
            self.report({"WARNING"}, f"Object {self.object_name!r} is no longer in this scene")
            return {"CANCELLED"}
        if not getattr(obj, "is_editable", True):
            self.report(
                {"ERROR"},
                f"{obj.name} is linked/read-only; make it local or rename it in its source .blend",
            )
            return {"CANCELLED"}
        fixed = vocab.fix_numbered(obj.name)
        try:
            renamed = fixed != obj.name and _rename(obj, fixed)
        except (AttributeError, RuntimeError, TypeError) as error:
            self.report({"ERROR"}, f"Could not rename {obj.name!r}: {error}")
            return {"CANCELLED"}
        if not renamed:
            self.report({"WARNING"}, f"Could not fix {obj.name!r}")
            return {"CANCELLED"}
        validation.mark_dirty()
        self.report({"INFO"}, f"Renamed to {fixed!r}")
        return {"FINISHED"}


class BLENDLINK_OT_migrate_legacy_property(bpy.types.Operator):
    """Move one deprecated bare custom property into Blendlink's namespace"""
    bl_idname = "blendlink.migrate_legacy_property"
    bl_label = "Migrate Legacy Blendlink Setting"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})
    property_name: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    def execute(self, context):
        allowed = {"mass", "friction", "lod_distance", "title", "body"}
        if self.property_name not in allowed:
            self.report({"ERROR"}, "That legacy setting is not supported")
            return {"CANCELLED"}
        obj = context.scene.objects.get(self.object_name)
        if obj is None:
            self.report({"ERROR"}, f"Object {self.object_name!r} is no longer in this scene")
            return {"CANCELLED"}
        if not getattr(obj, "is_editable", True):
            self.report({"ERROR"}, f"{obj.name} is linked/read-only; migrate it in its source .blend")
            return {"CANCELLED"}
        bare = self.property_name
        namespaced = f"blendlink_{bare}"
        if bare not in obj:
            self.report({"WARNING"}, f"{obj.name} no longer has the legacy {bare} setting")
            return {"CANCELLED"}
        if namespaced in obj:
            self.report({"WARNING"}, f"{obj.name} already has the Blendlink {bare} setting")
            return {"CANCELLED"}
        value = obj[bare]
        metadata = {}
        try:
            metadata = obj.id_properties_ui(bare).as_dict()
        except (AttributeError, TypeError):
            pass
        try:
            obj[namespaced] = value
            if metadata:
                obj.id_properties_ui(namespaced).update(**metadata)
            del obj[bare]
        except (AttributeError, KeyError, RuntimeError, TypeError) as error:
            try:
                obj.pop(namespaced, None)
            except Exception as rollback_error:
                print(
                    f"blendlink addon: could not roll back {namespaced!r} on {obj.name!r}: "
                    f"{type(rollback_error).__name__}: {rollback_error}"
                )
            self.report({"ERROR"}, f"Could not migrate {bare} on {obj.name}: {error}")
            return {"CANCELLED"}
        validation.mark_dirty()
        self.report({"INFO"}, f"Migrated {obj.name} {bare} to {namespaced}")
        return {"FINISHED"}


class BLENDLINK_OT_select_issue(bpy.types.Operator):
    """Select and frame the object this check refers to"""
    bl_idname = "blendlink.select_issue"
    bl_label = "Select Object"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name)
        if obj is None or obj.name not in context.view_layer.objects:
            self.report({"WARNING"}, f"Object {self.object_name!r} is not in this view layer")
            return {"CANCELLED"}
        selected, _skipped = _select_only(context, [obj])
        if not selected:
            self.report(
                {"WARNING"},
                f"Object {self.object_name!r} is hidden or selection-disabled in this view layer",
            )
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_set_texel_weight(bpy.types.Operator):
    """Add a lightmap scale to selected meshes — a linear density multiplier
    for the baked atlas (2 doubles resolution per axis; 0 excludes the
    object from the atlas while it keeps lighting the bake)"""
    bl_idname = "blendlink.set_texel_weight"
    bl_label = "Set Lightmap Scale"
    bl_options = {"REGISTER", "UNDO"}

    weight: bpy.props.FloatProperty(
        name="Scale", default=1.0, min=0.0, soft_max=4.0,
        description="Linear texel-density multiplier (0 excludes from the atlas)",
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select a mesh")
            return False
        return True

    def invoke(self, context, event):
        values = [
            float(value) if isinstance(value, (int, float)) else 1.0
            for obj in context.selected_editable_objects if obj.type == "MESH"
            for value in (obj.get("blendlink_texel_weight"),)
        ]
        if values and all(abs(value - values[0]) < 1e-9 for value in values[1:]):
            self.weight = values[0]
        return context.window_manager.invoke_props_dialog(self, width=300)

    def execute(self, context):
        changed = 0
        unchanged = 0
        skipped = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                skipped += 1
                continue
            current = obj.get("blendlink_texel_weight")
            if isinstance(current, (int, float)) and abs(float(current) - self.weight) < 1e-9:
                unchanged += 1
                continue
            obj["blendlink_texel_weight"] = self.weight
            obj.id_properties_ui("blendlink_texel_weight").update(
                min=0.0, soft_max=4.0, precision=2,
                description=(
                    "Lightmap scale: linear texel-density multiplier for the "
                    "baked atlas. 0 excludes the object from the atlas but it "
                    "still lights the bake"
                ),
            )
            changed += 1
        from . import handlers
        if changed:
            handlers.mark_bake_table_changed()
        detail = f"{changed} changed · {unchanged} already {self.weight:g}×"
        if skipped:
            detail += f" · {skipped} non-mesh skipped"
        self.report({"INFO"}, f"Lightmap scale {self.weight:g}× — {detail}")
        return {"FINISHED"}


def _atlas_items(self, context):
    """Main by default, then artist-created atlases."""
    project = getattr(context.scene, "blendlink_project", None)
    if project and project.configured and len(project.atlases) > 0:
        items = [("__AUTO__", "Main (default)", "Remove the override and use Main")]
        for atlas in list(project.atlases)[1:]:
            items.append((atlas.atlas_id, atlas.name, f"Bake into {atlas.name}"))
        return _cached_enum_items("atlases", items)
    from . import syncstatus
    plan = syncstatus.bake_plan() or {}
    items = [("__AUTO__", "Main (default)", "Remove the override and use Main")]
    for name in (plan.get("atlases") or {"main": {}}):
        if str(name).lower() == "main":
            continue
        label = str(name).replace("-", " ").replace("_", " ").title()
        items.append((name, label, f"Bake into {label}"))
    return _cached_enum_items("atlases", items)


class BLENDLINK_OT_set_atlas(bpy.types.Operator):
    """Move selected meshes to Main or an artist-created atlas"""
    bl_idname = "blendlink.set_atlas"
    bl_label = "Set Atlas"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "atlas"

    atlas: bpy.props.EnumProperty(name="Atlas", items=_atlas_items)

    @classmethod
    def poll(cls, context):
        return any(obj.type == "MESH" for obj in context.selected_editable_objects)

    def execute(self, context):
        from . import handlers
        changed = 0
        unchanged = 0
        skipped = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                skipped += 1
                continue
            if self.atlas == "__AUTO__":
                if "blendlink_atlas" in obj:
                    del obj["blendlink_atlas"]
                    changed += 1
                else:
                    unchanged += 1
            else:
                if obj.get("blendlink_atlas") == self.atlas:
                    unchanged += 1
                else:
                    obj["blendlink_atlas"] = self.atlas
                    changed += 1
        project = getattr(context.scene, "blendlink_project", None)
        label = _atlas_display_name(project, self.atlas)
        handlers.mark_bake_table_changed()
        detail = f"{changed} moved · {unchanged} already there"
        if skipped:
            detail += f" · {skipped} non-mesh skipped"
        self.report({"INFO"}, f"Atlas → {label} — {detail}")
        return {"FINISHED"}


class BLENDLINK_OT_select_authored_atlas_members(bpy.types.Operator):
    """Select meshes currently authored into one atlas, before rebuilding"""
    bl_idname = "blendlink.select_authored_atlas_members"
    bl_label = "Select Atlas Members"
    bl_options = {"REGISTER", "UNDO"}

    atlas_id: bpy.props.StringProperty(options={"HIDDEN", "SKIP_SAVE"})

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        main = self.atlas_id in {"", "main", "__AUTO__"}
        matches = []
        for obj in context.scene.objects:
            if obj.type != "MESH":
                continue
            authored = obj.get("blendlink_atlas")
            if (main and (not isinstance(authored, str) or authored == "main")) \
                    or (not main and authored == self.atlas_id):
                matches.append(obj)
        selectable, skipped = _select_only(context, matches)
        if selectable:
            note = f" · {skipped} unavailable in this view" if skipped else ""
            self.report({"INFO"}, f"Selected {len(selectable)} authored atlas member(s){note}")
        else:
            self.report(
                {"WARNING"},
                "This atlas has no assigned meshes available in this view",
            )
        return {"FINISHED"}


class BLENDLINK_OT_set_shading(bpy.types.Operator):
    """Bake this mesh into the atlas, keep it dynamic (real materials, lit
    at runtime), or let blendlink decide (armature/transparency auto-detect)"""
    bl_idname = "blendlink.set_shading"
    bl_label = "Set Web Rendering"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "mode"

    mode: bpy.props.EnumProperty(name="Web Rendering", items=[
        ("AUTO", "Automatic", "Bake when safe; keep deformation and transparency realtime"),
        ("DYNAMIC", "Realtime", "Keep real materials and light this object in Three.js"),
        ("BAKED", "Baked", "Compile this object using its atlas Bake Output"),
    ])

    @classmethod
    def poll(cls, context):
        return any(obj.type == "MESH" for obj in context.selected_editable_objects)

    def execute(self, context):
        from . import handlers, validation
        changed = 0
        unchanged = 0
        skipped = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                skipped += 1
                continue
            if self.mode == "AUTO":
                if "blendlink_dynamic" in obj:
                    del obj["blendlink_dynamic"]
                    changed += 1
                else:
                    unchanged += 1
            else:
                wanted = 1 if self.mode == "DYNAMIC" else 0
                if obj.get("blendlink_dynamic") == wanted:
                    unchanged += 1
                else:
                    obj["blendlink_dynamic"] = wanted
                    changed += 1
        label = {"AUTO": "Automatic", "DYNAMIC": "Realtime", "BAKED": "Baked"}[self.mode]
        handlers.mark_bake_table_changed()
        if changed:
            validation.mark_dirty()
        detail = f"{changed} changed · {unchanged} already {label}"
        if skipped:
            detail += f" · {skipped} non-mesh skipped"
        self.report({"INFO"}, f"Web rendering → {label} — {detail}")
        return {"FINISHED"}


class BLENDLINK_OT_set_web_material_source(bpy.types.Operator):
    """Use one selected Color/Value output as the website material field"""
    bl_idname = "blendlink.set_web_material_source"
    bl_label = "Use Active Node Output"
    bl_options = {"REGISTER", "UNDO"}
    bl_property = "source_output"

    semantic: bpy.props.EnumProperty(
        name="Website Field",
        items=(
            ("COLOR", "Web Color", "Compile this intrinsic field as website base color"),
            ("ALPHA", "Web Alpha", "Compile this linear field as website alpha"),
        ),
        default="COLOR",
    )
    source_output: bpy.props.EnumProperty(
        name="Source Output", items=_web_material_output_items,
    )
    surface_response: bpy.props.EnumProperty(
        name="Website Lighting",
        description=(
            "Automatic follows the selected field into the active Surface; "
            "choose Lit or Unlit only for an intentionally detached website field"
        ),
        items=(
            ("AUTO", "Automatic", "Infer lighting response from the active Surface"),
            ("LIT", "Lit", "Receive website lights and shadows using stock glTF PBR"),
            ("UNLIT", "Unlit", "Preserve the selected color without website lighting"),
        ),
        default="AUTO",
    )

    @classmethod
    def poll(cls, context):
        material = _active_material(context)
        if material is None:
            cls.poll_message_set("Choose an active material")
            return False
        if getattr(material, "library", None) is not None:
            cls.poll_message_set("Make the linked material local or create a library override")
            return False
        tree = getattr(material, "node_tree", None)
        node = getattr(getattr(tree, "nodes", None), "active", None)
        if node is None:
            cls.poll_message_set("Select a source node in the material Shader Editor")
            return False
        if not material_compiler.eligible_outputs(node):
            cls.poll_message_set("The active node has no Color or Value output")
            return False
        return True

    def invoke(self, context, _event):
        items = _web_material_output_items(self, context)
        if not items or items[0][0] == "__NONE__":
            self.report({"ERROR"}, "Select a source node with a Color or Value output")
            return {"CANCELLED"}
        identifiers = {item[0] for item in items}
        if self.source_output not in identifiers:
            self.source_output = items[0][0]
        material = _active_material(context)
        response = material_compiler.surface_response_setting(material)
        if response in {"AUTO", "LIT", "UNLIT"}:
            self.surface_response = response
        return context.window_manager.invoke_props_dialog(self, width=420)

    def draw(self, context):
        layout = self.layout
        material = _active_material(context)
        node = material.node_tree.nodes.active if material and material.node_tree else None
        layout.label(
            text=f"Material: {material.name}" if material else "No material",
            icon="MATERIAL",
        )
        layout.label(
            text=f"Active node: {node.name}" if node else "No active source node",
            icon="NODE_MATERIAL",
        )
        layout.prop(self, "semantic")
        layout.prop(self, "source_output")
        if self.semantic == "COLOR":
            layout.prop(self, "surface_response")
        layout.label(
            text=(
                "Automatic preserves the active Surface's lit/unlit response; "
                "downstream effects are not baked."
            ),
            icon="INFO",
        )

    def execute(self, context):
        from . import handlers
        material = _active_material(context)
        tree = getattr(material, "node_tree", None)
        node = getattr(getattr(tree, "nodes", None), "active", None)
        try:
            material_compiler.set_web_source(
                material,
                node,
                self.source_output,
                self.semantic,
                self.surface_response if self.semantic == "COLOR" else None,
            )
        except material_compiler.MaterialCompileError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        validation.mark_dirty()
        handlers.mark_bake_table_changed()
        field = "Color" if self.semantic == "COLOR" else "Alpha"
        output = next(
            socket.name for socket in node.outputs
            if socket.identifier == self.source_output
        )
        self.report({"INFO"}, f"Website {field}: {node.name} / {output}")
        return {"FINISHED"}


class BLENDLINK_OT_clear_web_material_source(bpy.types.Operator):
    """Clear the active material's selected website color or alpha"""
    bl_idname = "blendlink.clear_web_material_source"
    bl_label = "Clear Web Material Source"
    bl_options = {"REGISTER", "UNDO"}

    semantic: bpy.props.EnumProperty(
        name="Website Field",
        items=(
            ("ALL", "Color & Alpha", "Remove the Blendlink Web Color node"),
            ("ALPHA", "Alpha Only", "Keep Web Color and clear only Web Alpha"),
        ),
        default="ALL",
    )

    @classmethod
    def poll(cls, context):
        material = _active_material(context)
        if material is None or not material_compiler.marker_nodes(material):
            cls.poll_message_set("This material has no Blendlink Web Color selection")
            return False
        if getattr(material, "library", None) is not None:
            cls.poll_message_set("Make the linked material local or create a library override")
            return False
        return True

    def execute(self, context):
        from . import handlers
        material = _active_material(context)
        try:
            changed = material_compiler.clear_web_source(material, self.semantic)
        except material_compiler.MaterialCompileError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if not changed:
            self.report({"INFO"}, "Website material source was already clear")
            return {"CANCELLED"}
        validation.mark_dirty()
        handlers.mark_bake_table_changed()
        self.report({"INFO"}, "Cleared the selected website material source")
        return {"FINISHED"}


class BLENDLINK_OT_toggle_tsl_program(bpy.types.Operator):
    """Translate this material's proven channels to a TSL program.

    No bake, no image products: the artist material ships as a stock
    passthrough carrier and the WebGPU runtime rebuilds each proven
    channel from its published program. Channels the emitter cannot
    prove keep the shipped carrier, each refusal named on the plan.
    Unlike Material Bake this is meaningful on any status -- an exact
    material can still trade its textures for a program.
    """
    bl_idname = "blendlink.toggle_tsl_program"
    bl_label = "TSL Program"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        material = _active_material(context)
        if material is None:
            cls.poll_message_set("Select a material first")
            return False
        if getattr(material, "library", None) is not None:
            cls.poll_message_set(
                "Make the linked material local or create a library override"
            )
            return False
        if material_compiler.marker_nodes(material):
            cls.poll_message_set(
                "Clear the Blendlink Web Color selection first; a TSL "
                "Program translates proven channels instead of one "
                "selected field"
            )
            return False
        return True

    def execute(self, context):
        from . import handlers
        material = _active_material(context)
        enabled = not material_compiler.tsl_ir_requested(material)
        material_compiler.set_tsl_ir(material, enabled)
        validation.mark_dirty()
        handlers.mark_bake_table_changed()
        self.report(
            {"INFO"},
            f'TSL Program {"enabled" if enabled else "disabled"} for '
            f'"{material.name}"',
        )
        return {"FINISHED"}


class BLENDLINK_OT_toggle_material_bake(bpy.types.Operator):
    """Carry every Principled channel of this material as lit glTF.

    Constants stay factors, tileable graphs bake one repeat-wrapped 0..1
    tile on the authored UVs, and unique graphs bake a non-overlapping
    unwrap; the plan names every channel's route before anything bakes.
    """
    bl_idname = "blendlink.toggle_material_bake"
    bl_label = "Material Bake"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        material = _active_material(context)
        if material is None:
            cls.poll_message_set("Select a material first")
            return False
        if getattr(material, "library", None) is not None:
            cls.poll_message_set(
                "Make the linked material local or create a library override"
            )
            return False
        if material_compiler.marker_nodes(material):
            cls.poll_message_set(
                "Clear the Blendlink Web Color selection first; Material "
                "Bake carries every channel instead of one selected field"
            )
            return False
        return True

    def execute(self, context):
        from . import handlers
        material = _active_material(context)
        enabled = not material_compiler.material_bake_requested(material)
        material_compiler.set_material_bake(material, enabled)
        validation.mark_dirty()
        handlers.mark_bake_table_changed()
        self.report(
            {"INFO"},
            f'Material Bake {"enabled" if enabled else "disabled"} for '
            f'"{material.name}"',
        )
        return {"FINISHED"}


class BLENDLINK_OT_select_atlas_objects(bpy.types.Operator):
    """Select every object the last website build assigned to this atlas"""
    bl_idname = "blendlink.select_atlas_objects"
    bl_label = "Select Last-Build Members"
    bl_options = {"REGISTER", "UNDO"}

    atlas: bpy.props.StringProperty()

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        plan = syncstatus.bake_plan() or {}
        names = {
            entry["name"] for entry in plan.get("objects", [])
            if entry.get("atlas", "main") == self.atlas
        }
        matches = [context.scene.objects.get(name) for name in names]
        missing = sum(obj is None for obj in matches)
        selected, skipped = _select_only(context, [obj for obj in matches if obj is not None])
        atlas_name = _atlas_display_name(
            getattr(context.scene, "blendlink_project", None), self.atlas,
        )
        unavailable = missing + skipped
        note = f" · {unavailable} unavailable in this view" if unavailable else ""
        if selected:
            self.report(
                {"INFO"}, f"Selected {len(selected)} object(s) in {atlas_name}{note}",
            )
        else:
            self.report(
                {"WARNING"}, f"{atlas_name} has no objects available in this view",
            )
        return {"FINISHED"}


# These names and every bake mechanic come from the distributed canonical
# module. The addon owns only artist interaction and display.
ATLAS_UV = bakelib.ATLAS_UV
AUTHORED_UV = bakelib.AUTHORED_UV
CHECKER_MODIFIER = bakelib.CHECKER_MODIFIER


class BLENDLINK_OT_preview_atlas_uvs(bpy.types.Operator):
    """Load the exact packed atlas UVs recorded by the last successful build.

    This never re-runs packing. Evaluated-topology mismatches are skipped
    loudly because an approximate UV preview is worse than none.
    """
    bl_idname = "blendlink.preview_atlas_uvs"
    bl_label = "Load Published Atlas UVs"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        plan = syncstatus.bake_plan()
        if plan is None:
            cls.poll_message_set("No atlas plan yet — Preview Website or Check Atlas Fit first")
            return False
        atlas_layout = plan.get("atlasLayout")
        if not isinstance(atlas_layout, dict) or atlas_layout.get("space") != "final-glb-decoded":
            cls.poll_message_set(
                "The last build predates exact UV inspection — rebuild with this Blendlink version"
            )
            return False
        return context.mode == "OBJECT"

    def execute(self, context):
        from . import syncstatus
        plan = syncstatus.bake_plan()
        try:
            result = bakelib.apply_packed_uv_evidence(
                context.scene.objects, plan.get("atlasLayout") if plan else None, ATLAS_UV,
            )
        except (RuntimeError, ValueError) as error:
            self.report({"ERROR"}, f"Published atlas evidence is invalid: {error}")
            return {"CANCELLED"}
        applied = result["applied"]
        skipped = result["skipped"]
        for item in skipped:
            print(f"blendlink atlas inspection: skipped {item['name']}: {item['reason']}")
        if not applied:
            reason = skipped[0]["reason"] if skipped else "the published layout contains no meshes"
            self.report({"WARNING"}, f"Could not load published atlas UVs: {reason}")
            return {"CANCELLED"}
        note = f"; skipped {len(skipped)} (see console)" if skipped else ""
        self.report(
            {"INFO"},
            f"Loaded exact published atlas UVs on {len(applied)} mesh(es){note} — "
            "open a UV Editor to inspect (Ctrl+Z reverses)",
        )
        return {"FINISHED"}


class BLENDLINK_OT_materialize_atlas_uvs(bpy.types.Operator):
    """Persist the published pack as an authored, editable UV layer the
    export honors: move islands freely, pin (P in the UV editor) the ones
    that must hold — the next build locks pinned islands in place and packs
    everything else around them"""
    bl_idname = "blendlink.materialize_atlas_uvs"
    bl_label = "Materialize Editable UVs"
    bl_options = {"REGISTER", "UNDO"}

    overwrite: bpy.props.BoolProperty(
        name="Overwrite Authored Layer",
        description="Replace an existing authored layer — its edits and pins are lost",
        default=False,
    )

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        if not any(o.type == "MESH" for o in context.selected_editable_objects):
            cls.poll_message_set("Select the meshes to materialize")
            return False
        return True

    def execute(self, context):
        made, kept, missing = [], [], []
        targets = []
        seen_meshes = set()
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            mesh = obj.data
            if not getattr(mesh, "is_editable", True):
                self.report(
                    {"ERROR"},
                    f"{obj.name}: mesh data is linked/read-only; make it local before "
                    "materializing; no selected mesh was changed",
                )
                return {"CANCELLED"}
            mesh_key = mesh.as_pointer()
            if mesh_key in seen_meshes:
                continue
            seen_meshes.add(mesh_key)
            atlas = mesh.uv_layers.get(ATLAS_UV)
            if atlas is None:
                missing.append(obj.name)
                continue
            existing = mesh.uv_layers.get(AUTHORED_UV)
            reserved = mesh.attributes.get(AUTHORED_UV)
            if existing is None and reserved is not None:
                self.report(
                    {"ERROR"},
                    f"{obj.name}: a {reserved.domain}/{reserved.data_type} mesh attribute "
                    f"already uses {AUTHORED_UV}; rename or remove that attribute before "
                    "materializing — no selected mesh was changed",
                )
                return {"CANCELLED"}
            # NEVER silently overwrite an authored layer — the artist's
            # edits and pins live there. Explicit opt-in via the redo panel.
            if existing is not None and not self.overwrite:
                kept.append(obj.name)
                continue
            targets.append({
                "obj": obj,
                "mesh": mesh,
                "values": [tuple(loop.uv) for loop in atlas.data],
                "existing": existing,
                "active": mesh.uv_layers.active.name if mesh.uv_layers.active else None,
                "snapshot": (
                    [(tuple(loop.uv), bool(loop.pin_uv)) for loop in existing.data]
                    if existing is not None else None
                ),
                "layer": existing,
            })

        # Allocate every missing layer before changing a single authored UV.
        # If any mesh is at Blender's UV-layer limit, removing these empty
        # allocations restores the whole selection exactly.
        created = []

        def restore_active_layers():
            for target in targets:
                active_name = target["active"]
                if active_name:
                    active = target["mesh"].uv_layers.get(active_name)
                    if active is not None:
                        target["mesh"].uv_layers.active = active

        for target in targets:
            if target["layer"] is not None:
                continue
            failure = None
            try:
                layer = target["mesh"].uv_layers.new(name=AUTHORED_UV)
            except Exception as error:
                layer = None
                failure = f"{type(error).__name__}: {error}"
            if layer is None and failure is None:
                failure = "Blender returned no UV layer"
            elif layer is not None:
                # Mesh attributes and UV layers share a name namespace.
                # Blender may silently suffix the requested name; accepting
                # that layer would report success while the exporter ignores
                # it, so include it in the transaction and fail loudly.
                created.append((target["mesh"], layer))
                if layer.name != AUTHORED_UV:
                    failure = (
                        f"Blender returned renamed UV layer {layer.name!r}; "
                        f"the exact {AUTHORED_UV!r} name is reserved"
                    )
                    layer = None
            if layer is None:
                for created_mesh, created_layer in reversed(created):
                    created_mesh.uv_layers.remove(created_layer)
                restore_active_layers()
                remedy = (
                    f"rename or remove the mesh attribute reserving {AUTHORED_UV}"
                    if failure.startswith("Blender returned renamed UV layer")
                    else "remove unused UV maps"
                )
                self.report(
                    {"ERROR"},
                    f"{target['obj'].name}: could not add {AUTHORED_UV} "
                    f"({failure}) — no selected mesh was changed; {remedy}",
                )
                return {"CANCELLED"}
            target["layer"] = layer

        try:
            for target in targets:
                layer = target["layer"]
                values = target["values"]
                if len(layer.data) != len(values):
                    raise RuntimeError(
                        f"{target['obj'].name}: loop count changed during materialization"
                    )
                for index, loop in enumerate(layer.data):
                    loop.uv = values[index]
                    loop.pin_uv = False
                target["mesh"].uv_layers.active = layer
                made.append(target["obj"].name)
        except Exception as error:
            for target in targets:
                snapshot = target["snapshot"]
                if snapshot is None:
                    continue
                for loop, (uv, pinned) in zip(target["layer"].data, snapshot):
                    loop.uv = uv
                    loop.pin_uv = pinned
            for created_mesh, created_layer in reversed(created):
                created_mesh.uv_layers.remove(created_layer)
            restore_active_layers()
            self.report(
                {"ERROR"},
                "Materialize Editable UVs failed; every selected mesh was restored: "
                f"{type(error).__name__}: {error}",
            )
            return {"CANCELLED"}
        if not made and not kept:
            self.report(
                {"WARNING"},
                "No published atlas UVs on the selection — load them first",
            )
            return {"CANCELLED"}
        parts = []
        if made:
            parts.append(
                f"Materialized {len(made)} authored layer(s) — edit freely, "
                "pin (P) islands to hold them through the next website build"
            )
        if kept:
            parts.append(
                f"kept {len(kept)} existing authored layer(s) untouched "
                f"(enable Overwrite to replace): {', '.join(kept)}"
            )
        if missing:
            parts.append(f"no published UVs on {len(missing)}")
        self.report({"WARNING"} if kept or missing else {"INFO"}, "; ".join(parts))
        return {"FINISHED"}


# --- checker inspection override -------------------------------------------
# TexTools-style: a geometry-nodes modifier sets a shared checker material
# in the VIEWPORT only (show_render=False), never touching user material
# slots. The exporter additionally strips strays before evaluating, because
# freeze/export walk the viewport depsgraph where the override IS applied.

_CHECKER_PREFIX = "BLENDLINK-checker"
_GRID_IMAGE_RES = 1024
_checker_mode_cache = None
# Blender's generated UV_GRID image draws fixed 32px checkers at any
# resolution (measured on 5.2), so one repeat holds RES/32 cells.
_UV_GRID_CELL_PX = 32


def _checker_image(kind: str):
    name = f"{_CHECKER_PREFIX}-grid-{'uv' if kind == 'UV_GRID' else 'color'}"
    image = bpy.data.images.get(name)
    if image is None:
        image = bpy.data.images.new(name, _GRID_IMAGE_RES, _GRID_IMAGE_RES)
        image.generated_type = kind
    return image


def _checker_material(mode: str, size: int, cell_px: int):
    if mode == "DENSITY":
        name = f"{_CHECKER_PREFIX}-DENSITY-{size}px-{cell_px}t"
        # One generated checker cell (32px in the image) must span cell_px
        # REAL atlas texels: scale = atlas / (cells-per-repeat × cell_px).
        cells = _GRID_IMAGE_RES // _UV_GRID_CELL_PX
        scale = size / (cells * cell_px)
        image, interpolation = _checker_image("UV_GRID"), "Closest"
    else:
        name = f"{_CHECKER_PREFIX}-UVGRID-{size}px"
        # One lettered color grid across the whole atlas: cells are fixed
        # in ATLAS space (density still comparable) and letters say WHERE
        # an island landed.
        scale = 1.0
        image, interpolation = _checker_image("COLOR_GRID"), "Linear"
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = interpolation
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, 1.0)
    uvmap = tree.nodes.new("ShaderNodeUVMap")
    uvmap.uv_map = ATLAS_UV
    tree.links.new(uvmap.outputs["UV"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _checker_group(mode: str, size: int, cell_px: int):
    """Geometry-nodes group per (mode, atlas size): Set Material with the
    checker as the socket DEFAULT (5.2 rejects material id-props on the
    modifier, so the material rides inside the group)."""
    material = _checker_material(mode, size, cell_px)
    group = bpy.data.node_groups.get(material.name)
    if group is not None:
        return group
    group = bpy.data.node_groups.new(material.name, "GeometryNodeTree")
    group.is_modifier = True
    group.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    source = group.nodes.new("NodeGroupInput")
    sink = group.nodes.new("NodeGroupOutput")
    set_material = group.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    group.links.new(source.outputs["Geometry"], set_material.inputs["Geometry"])
    group.links.new(set_material.outputs["Geometry"], sink.inputs["Geometry"])
    return group


def _saved_asset_group(path: str, content_hash: str):
    """Viewport-only material showing the exact saved atlas bytes."""
    identity = f"{os.path.abspath(path)}:{content_hash}"
    token = uuid.uuid5(uuid.NAMESPACE_URL, identity).hex[:10]
    name = f"{_CHECKER_PREFIX}-SAVED-{token}"
    group = bpy.data.node_groups.get(name)
    if group is not None:
        return group
    image = bpy.data.images.load(path, check_existing=False)
    image.name = f"{name}-image"
    image.colorspace_settings.name = "sRGB"
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    uvmap = tree.nodes.new("ShaderNodeUVMap")
    uvmap.uv_map = ATLAS_UV
    tree.links.new(uvmap.outputs["UV"], texture.inputs["Vector"])
    tree.links.new(texture.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    group = bpy.data.node_groups.new(name, "GeometryNodeTree")
    group.is_modifier = True
    group.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    source = group.nodes.new("NodeGroupInput")
    sink = group.nodes.new("NodeGroupOutput")
    set_material = group.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    group.links.new(source.outputs["Geometry"], set_material.inputs["Geometry"])
    group.links.new(set_material.outputs["Geometry"], sink.inputs["Geometry"])
    return group


def checker_mode_cached():
    """Cheap draw-safe checker state; None until the timer primes it."""
    return _checker_mode_cache


def reset_checker_mode_cache():
    global _checker_mode_cache
    _checker_mode_cache = None


def _set_checker_mode(mode: str) -> str:
    global _checker_mode_cache
    _checker_mode_cache = mode
    return mode


def _checker_mode() -> str:
    """Current mode derived from the FILE (robust across undo and reload):
    the first checker modifier found names its node group by mode."""
    for obj in bpy.data.objects:
        for modifier in getattr(obj, "modifiers", []):
            if modifier.name.startswith(CHECKER_MODIFIER) and modifier.node_group:
                if "-DENSITY-" in modifier.node_group.name:
                    return _set_checker_mode("DENSITY")
                if "-UVGRID-" in modifier.node_group.name:
                    return _set_checker_mode("UVGRID")
                if "-SAVED-" in modifier.node_group.name:
                    return _set_checker_mode("SAVED")
    return _set_checker_mode("OFF")


def prime_checker_mode() -> bool:
    """Perform the one file scan outside draw, returning visible-state change."""
    previous = _checker_mode_cache
    if previous is not None:
        return False
    return _checker_mode() != previous


def reconcile_saved_asset_override(context=None) -> bool:
    """Remove a saved-pixel viewport override when its exact bytes vanished.

    The published file path may stay constant across builds, so the selected
    content hash—not the path—is the evidence contract. This runs from the
    shared timer after sync status refresh, never from panel draw.
    """
    if _checker_mode_cache != "SAVED":
        return False
    from . import syncstatus
    context = context or bpy.context
    manager = getattr(context, "window_manager", None)
    session = getattr(manager, "blendlink", None) if manager else None
    if session is not None and syncstatus.verified_derived_asset(
        session.derived_asset_path,
        getattr(session, "derived_asset_content_hash", ""),
    ) is not None:
        return False
    try:
        removed, _blocks, blocked = _checker_sweep()
    except RuntimeError as error:
        print(f"blendlink addon: stale saved-layer isolation could not be removed: {error}")
        return False
    if blocked:
        print(
            "blendlink addon: stale saved-layer isolation remains on linked/read-only objects: "
            + ", ".join(blocked)
        )
        return False
    print(
        "blendlink addon: published image bytes changed; turned off the stale "
        f"saved-layer isolation ({removed} override(s) removed)"
    )
    return True


def _checker_sweep() -> tuple:
    """Strip every checker override and datablock, strays included."""
    snapshots = []
    blocked = []
    for obj in bpy.data.objects:
        modifiers = [
            modifier for modifier in getattr(obj, "modifiers", [])
            if modifier.name.startswith(CHECKER_MODIFIER)
        ]
        if modifiers and not getattr(obj, "is_editable", True):
            blocked.append(obj.name)
            continue
        for modifier in modifiers:
            snapshots.append({
                "obj": obj,
                "name": modifier.name,
                "node_group": modifier.node_group,
                "show_render": modifier.show_render,
            })
    if blocked:
        print(
            "blendlink checker: read-only overrides could not be reconciled: "
            + ", ".join(blocked)
        )
        return 0, 0, blocked
    removed = 0
    removed_snapshots = []
    try:
        for snapshot in snapshots:
            obj = snapshot["obj"]
            modifier = obj.modifiers.get(snapshot["name"])
            if modifier is None:
                continue
            obj.modifiers.remove(modifier)
            removed_snapshots.append(snapshot)
            removed += 1
    except Exception as error:
        rollback_errors = []
        for snapshot in removed_snapshots:
            try:
                modifier = snapshot["obj"].modifiers.new(
                    name=snapshot["name"], type="NODES",
                )
                modifier.node_group = snapshot["node_group"]
                modifier.show_render = snapshot["show_render"]
            except Exception as rollback_error:
                rollback_errors.append(
                    f"{snapshot['obj'].name}: {type(rollback_error).__name__}: {rollback_error}"
                )
        detail = (
            "; rollback failed for " + "; ".join(rollback_errors)
            if rollback_errors else "; prior overrides were restored"
        )
        raise RuntimeError(
            f"checker cleanup failed: {type(error).__name__}: {error}{detail}"
        ) from error
    blocks = 0
    for collection in (bpy.data.node_groups, bpy.data.materials, bpy.data.images):
        for block in [b for b in collection if b.name.startswith(_CHECKER_PREFIX)]:
            try:
                collection.remove(block)
                blocks += 1
            except Exception as error:
                print(
                    f"blendlink checker: could not remove generated datablock "
                    f"{block.name!r}: {type(error).__name__}: {error}"
                )
    _set_checker_mode("OFF")
    return removed, blocks, []


def _omission_summary(action: str, omissions: list[tuple[str, str]]) -> str:
    if not omissions:
        return ""
    counts = {}
    for _name, reason in omissions:
        counts[reason] = counts.get(reason, 0) + 1
    print(
        f"blendlink addon: {action} omitted published members: "
        + "; ".join(f"{name}: {reason}" for name, reason in omissions)
    )
    detail = ", ".join(f"{count} {reason}" for reason, count in counts.items())
    return f"{len(omissions)} omitted ({detail})"


class BLENDLINK_OT_toggle_checker(bpy.types.Operator):
    """Cycle the atlas checker: OFF → DENSITY (one checker cell = a fixed
    count of real atlas texels — judge density AFTER packing, the pack
    rescales islands) → UV GRID (one lettered grid across the whole atlas —
    seams, orientation, and where islands landed) → OFF. Viewport-only:
    a geometry-nodes override, render and export never see it"""
    bl_idname = "blendlink.toggle_checker"
    bl_label = "Toggle Atlas Checker"
    bl_options = {"REGISTER", "UNDO"}

    cell_px: bpy.props.IntProperty(
        name="Texels per Checker", default=8, min=1, soft_max=64,
        description="DENSITY mode: real atlas texels covered by one checker cell",
    )

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if syncstatus.bake_plan() is None:
            cls.poll_message_set("No atlas plan yet — Preview Website or Check Atlas Fit first")
            return False
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        current = _checker_mode()
        if current in {"UVGRID", "SAVED"}:
            try:
                removed, _blocks, blocked = _checker_sweep()
            except RuntimeError as error:
                self.report({"ERROR"}, str(error))
                return {"CANCELLED"}
            if blocked:
                self.report(
                    {"ERROR"},
                    f"Could not turn the checker off on {len(blocked)} linked/read-only object(s); see console",
                )
                return {"CANCELLED"}
            self.report({"INFO"}, f"Checker off — removed {removed} override(s)")
            return {"FINISHED"}
        mode = "DENSITY" if current == "OFF" else "UVGRID"
        plan = syncstatus.bake_plan()
        atlases = plan.get("atlases") or {"main": {"size": plan.get("atlasSize", 2048)}}
        targets, omissions = [], []
        for entry in plan.get("objects", []):
            name = entry.get("name", "")
            obj = context.scene.objects.get(name)
            if obj is None:
                omissions.append((name or "<unnamed>", "missing or renamed"))
                continue
            if obj.type != "MESH":
                omissions.append((obj.name, "not a mesh"))
                continue
            if not getattr(obj, "is_editable", True):
                omissions.append((obj.name, "linked/read-only"))
                continue
            if obj.data.uv_layers.get(ATLAS_UV) is None:
                omissions.append((obj.name, "no published atlas UVs"))
                continue
            size = int(atlases.get(entry.get("atlas", "main"), {}).get("size", 2048))
            targets.append((obj, size))
        if not targets:
            note = _omission_summary("atlas checker", omissions)
            self.report(
                {"WARNING"},
                "Nothing to inspect — run Load Published Atlas UVs first "
                f"(the checker samples the published layer){'; ' + note if note else ''}",
            )
            return {"CANCELLED"}
        try:
            _removed, _blocks, blocked = _checker_sweep()
        except RuntimeError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if blocked:
            self.report(
                {"ERROR"},
                f"Could not reconcile {len(blocked)} linked/read-only checker override(s); see console",
            )
            return {"CANCELLED"}
        created = []
        try:
            for obj, size in targets:
                group = _checker_group(mode, size, self.cell_px)
                modifier = obj.modifiers.new(name=CHECKER_MODIFIER, type="NODES")
                created.append((obj, modifier))
                modifier.node_group = group
                modifier.show_render = False
        except Exception as error:
            rollback_errors = []
            for obj, modifier in reversed(created):
                try:
                    obj.modifiers.remove(modifier)
                except Exception as rollback_error:
                    rollback_errors.append(f"{obj.name}: {rollback_error}")
            _set_checker_mode("OFF")
            detail = (
                "; rollback failed for " + "; ".join(rollback_errors)
                if rollback_errors else "; no checker overrides remain"
            )
            self.report(
                {"ERROR"},
                f"Could not apply the checker: {type(error).__name__}: {error}{detail}",
            )
            return {"CANCELLED"}
        _set_checker_mode(mode)
        label = (
            f"Density checker: 1 cell = {self.cell_px}×{self.cell_px} atlas texels"
            if mode == "DENSITY"
            else "UV grid: one lettered grid across each atlas"
        )
        omitted = _omission_summary("atlas checker", omissions)
        note = f" — {omitted}; see console" if omitted else ""
        self.report(
            {"WARNING" if omissions else "INFO"},
            f"{label} on {len(targets)} mesh(es){note} (viewport only)",
        )
        return {"FINISHED"}


class BLENDLINK_OT_checker_cleanup(bpy.types.Operator):
    """Remove every checker override and its datablocks from the file,
    strays included (the exporter also strips leftovers defensively)"""
    bl_idname = "blendlink.checker_cleanup"
    bl_label = "Remove Checker Overrides"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            removed, blocks, blocked = _checker_sweep()
        except RuntimeError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if blocked:
            self.report(
                {"ERROR"},
                f"Could not remove overrides from {len(blocked)} linked/read-only object(s); see console",
            )
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            f"Removed {removed} checker override(s) and {blocks} datablock(s)",
        )
        return {"FINISHED"}


class BLENDLINK_OT_select_derived_asset(bpy.types.Operator):
    """Select one published image for thumbnail, opening, or isolation"""
    bl_idname = "blendlink.select_derived_asset"
    bl_label = "Inspect Published Asset"
    bl_options = {"INTERNAL"}

    path: bpy.props.StringProperty(options={"HIDDEN"})
    label: bpy.props.StringProperty(options={"HIDDEN"})
    atlas: bpy.props.StringProperty(default="main", options={"HIDDEN"})
    kind: bpy.props.StringProperty(options={"HIDDEN"})

    def execute(self, context):
        from . import syncstatus, ui
        asset = syncstatus.verified_derived_asset(self.path)
        if asset is None:
            self.report({"ERROR"}, "That published image is missing or changed since the last build")
            return {"CANCELLED"}
        session = context.window_manager.blendlink
        session.derived_asset_path = asset["path"]
        session.derived_asset_label = self.label
        session.derived_asset_atlas = self.atlas
        session.derived_asset_kind = self.kind
        session.derived_asset_content_hash = asset.get("contentHash", "")
        ui.prepare_derived_preview(
            asset["path"], asset.get("contentHash", ""),
        )
        return {"FINISHED"}


class BLENDLINK_OT_open_derived_asset(bpy.types.Operator):
    """Open the selected published image in the operating-system viewer"""
    bl_idname = "blendlink.open_derived_asset"
    bl_label = "Open Saved Image"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        session = context.window_manager.blendlink
        if syncstatus.verified_derived_asset(
            session.derived_asset_path, session.derived_asset_content_hash,
        ) is None:
            cls.poll_message_set("Select an unchanged image from the last build")
            return False
        return True

    def execute(self, context):
        bpy.ops.wm.path_open(filepath=context.window_manager.blendlink.derived_asset_path)
        return {"FINISHED"}


class BLENDLINK_OT_isolate_derived_asset(bpy.types.Operator):
    """Show exact saved atlas pixels on their meshes via a viewport-only override"""
    bl_idname = "blendlink.isolate_derived_asset"
    bl_label = "Isolate Saved Baked Layer"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        session = context.window_manager.blendlink
        if session.derived_asset_kind not in {"state", "light"}:
            cls.poll_message_set("Choose a baked state or light-group atlas")
            return False
        if syncstatus.verified_derived_asset(
            session.derived_asset_path, session.derived_asset_content_hash,
        ) is None:
            cls.poll_message_set("The published image is missing or changed since the last build")
            return False
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        session = context.window_manager.blendlink
        plan = syncstatus.bake_plan() or {}
        targets = []
        omissions = []
        for entry in plan.get("objects", []):
            if entry.get("atlas", "main") != session.derived_asset_atlas:
                continue
            name = entry.get("name", "")
            obj = context.scene.objects.get(name)
            if obj is None:
                omissions.append((name or "<unnamed>", "missing or renamed"))
                continue
            if obj.type != "MESH":
                omissions.append((obj.name, "not a mesh"))
                continue
            if obj.data.uv_layers.get(ATLAS_UV) is None:
                omissions.append((obj.name, "no published atlas UVs"))
                continue
            if not getattr(obj, "is_editable", True):
                omissions.append((obj.name, "linked/read-only"))
                continue
            targets.append(obj)
        if not targets:
            omitted = _omission_summary("saved-layer isolation", omissions)
            note = f"; {omitted}" if omitted else ""
            self.report(
                {"WARNING"}, f"No writable matching published atlas UVs; load them first{note}",
            )
            return {"CANCELLED"}
        try:
            _removed, _blocks, blocked = _checker_sweep()
        except RuntimeError as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        if blocked:
            self.report(
                {"ERROR"},
                f"Could not reconcile {len(blocked)} linked/read-only checker override(s); see console",
            )
            return {"CANCELLED"}
        created = []
        try:
            group = _saved_asset_group(
                session.derived_asset_path, session.derived_asset_content_hash,
            )
            for obj in targets:
                modifier = obj.modifiers.new(name=CHECKER_MODIFIER, type="NODES")
                created.append((obj, modifier))
                modifier.node_group = group
                modifier.show_render = False
        except Exception as error:
            rollback_errors = []
            for obj, modifier in reversed(created):
                try:
                    obj.modifiers.remove(modifier)
                except Exception as rollback_error:
                    rollback_errors.append(f"{obj.name}: {rollback_error}")
            _set_checker_mode("OFF")
            detail = (
                "; rollback failed for " + "; ".join(rollback_errors)
                if rollback_errors else "; no saved-layer overrides remain"
            )
            self.report(
                {"ERROR"},
                f"Could not isolate the saved layer: {type(error).__name__}: {error}{detail}",
            )
            return {"CANCELLED"}
        _set_checker_mode("SAVED")
        omitted = _omission_summary("saved-layer isolation", omissions)
        note = f"; partial view — {omitted}; see console" if omitted else ""
        self.report(
            {"WARNING" if omissions else "INFO"},
            f"Isolating saved {session.derived_asset_label!r} on {len(targets)} mesh(es) "
            f"(viewport only){note}",
        )
        return {"FINISHED"}


def _select_only(context, objs):
    """Select only candidates that belong to the active view layer.

    Operators calling this helper poll for Object Mode first. Avoiding
    ``bpy.ops.object.select_all`` keeps selection deterministic in pinned and
    excluded collection contexts.
    """
    candidates = []
    skipped = 0
    for obj in objs:
        if obj.name not in context.view_layer.objects:
            skipped += 1
            continue
        try:
            if obj.hide_select or not obj.visible_get(view_layer=context.view_layer):
                skipped += 1
                continue
        except (AttributeError, RuntimeError):
            skipped += 1
            continue
        candidates.append(obj)
    # A failed navigation action must not destroy the artist's useful current
    # selection. Only replace it after at least one candidate proves eligible.
    if not candidates:
        return [], skipped
    previous = list(context.selected_objects)
    previous_active = context.view_layer.objects.active
    for obj in previous:
        try:
            obj.select_set(False)
        except RuntimeError:
            pass
    selected = []
    for obj in candidates:
        try:
            obj.select_set(True)
            if obj.select_get():
                selected.append(obj)
            else:
                skipped += 1
        except RuntimeError:
            skipped += 1
            continue
    if not selected:
        for obj in previous:
            if obj.name not in context.view_layer.objects:
                continue
            try:
                obj.select_set(True)
            except RuntimeError:
                continue
        if previous_active is not None and previous_active.select_get():
            context.view_layer.objects.active = previous_active
        return [], skipped
    context.view_layer.objects.active = selected[0] if selected else None
    return selected, skipped


def _bake_table_records(context) -> list[dict]:
    """Build the next table off-RNA so a calculation failure preserves it."""
    from . import syncstatus, ui
    if context is None or context.scene is None:
        raise RuntimeError("no active Blender scene is available")
    plan = syncstatus.bake_plan() or {}
    planned = {
        entry.get("name", ""): entry
        for entry in plan.get("objects", [])
        if isinstance(entry, dict)
    }
    dynamic_reasons = {
        entry.get("name", ""): entry.get("reason", "")
        for entry in plan.get("dynamicObjects", [])
        if isinstance(entry, dict)
    }
    records = []
    project = getattr(context.scene, "blendlink_project", None)
    for obj in sorted(context.scene.objects, key=lambda item: item.name):
        if obj.type != "MESH" or obj.hide_render:
            continue
        entry = planned.get(obj.name)
        record = {
            "name": obj.name,
            "atlas": "",
            "shading": "",
            "density": "",
            "weight": "",
            "reason": "",
            "planned": entry is not None or obj.name in dynamic_reasons,
            "authored": bool(entry and entry.get("authored")),
            "pinned": bool(entry and entry.get("pinned")),
        }
        effective, reason = ui._effective_rendering(obj, project)
        if effective == "DYNAMIC":
            record.update(shading="realtime", atlas="—", reason=reason, density=reason)
            records.append(record)
            continue
        if obj.name in dynamic_reasons and "blendlink_dynamic" not in obj:
            reason = dynamic_reasons[obj.name]
            record.update(shading="realtime", atlas="—", reason=reason, density=reason)
            records.append(record)
            continue
        record.update(shading="baked", reason=reason)
        override = obj.get("blendlink_atlas")
        if isinstance(override, str):
            record["atlas"] = _atlas_display_name(project, override)
        elif entry is not None:
            atlas_id = str(entry.get("atlas", "main"))
            record["atlas"] = _atlas_display_name(project, atlas_id)
        else:
            record["atlas"] = "Main · not measured"
        if entry is not None:
            px = entry.get("pxPerMeter")
            record["density"] = f"{px:.0f} px/m" if px else ""
            auto = entry.get("autoWeight", 1.0)
            artist = entry.get("artistWeight", 1.0)
            if auto != 1.0 or artist != 1.0:
                record["weight"] = f"{auto:g}×{artist:g}"
        records.append(record)
    return records


def rebuild_bake_table(context) -> int:
    """Replace the session table and retain the active mesh's row."""
    # The table persists its effective route until the next invalidation. Never
    # turn a transient PENDING analysis into a false Baked row.
    from . import validation
    if validation.is_dirty():
        validation.recompute(context.scene)
    window_manager = getattr(context, "window_manager", None)
    session = getattr(window_manager, "blendlink", None) if window_manager else None
    view_layer = getattr(context, "view_layer", None)
    if session is None or view_layer is None:
        raise RuntimeError("Blendlink session or active view layer is unavailable")
    records = _bake_table_records(context)
    active_name = getattr(view_layer.objects.active, "name", "")
    rows = session.bake_rows
    rows.clear()
    for record in records:
        row = rows.add()
        for field, value in record.items():
            setattr(row, field, value)
    session.bake_row_index = next(
        (index for index, row in enumerate(rows) if row.name == active_name),
        -1,
    )
    return len(records)


class BLENDLINK_OT_refresh_bake_table(bpy.types.Operator):
    """Immediately rebuild the otherwise automatically maintained bake table."""
    bl_idname = "blendlink.refresh_bake_table"
    bl_label = "Refresh Bake Table"
    bl_options = {"REGISTER"}

    def execute(self, context):
        try:
            count = rebuild_bake_table(context)
        except Exception as error:
            message = f"Bake table refresh failed: {type(error).__name__}: {error}"
            print(f"blendlink addon: {message}")
            self.report({"ERROR"}, message)
            return {"CANCELLED"}
        from . import handlers
        handlers.note_bake_table_rebuilt()
        self.report({"INFO"}, f"{count} meshes in the bake table")
        return {"FINISHED"}


def _save_before_publish(assigned_ids: int, save_operation=None) -> bool:
    """Persist every byte the external compiler will read; return whether saved."""
    if not bpy.data.is_dirty and not assigned_ids:
        return False
    save_operation = save_operation or bpy.ops.wm.save_mainfile
    try:
        result = save_operation()
    except Exception as error:
        raise RuntimeError(
            f"Blender could not save the scene: {type(error).__name__}: {error}"
        ) from error
    if result != {"FINISHED"} or bpy.data.is_dirty:
        raise RuntimeError(
            "Blender did not finish saving. Resolve the file or network-path "
            "problem before publishing"
        )
    return True


def _publish_settings_issue(context) -> str | None:
    issue = _scene_editability_issue(context)
    if issue:
        return issue
    project = getattr(context.scene, "blendlink_project", None)
    if project is None or not project.configured:
        return "Run Set Up Blendlink Scene first"
    from . import component_validation
    component_issue = component_validation.first_blocking_issue(
        project, scene=context.scene,
    )
    if component_issue is not None:
        return (
            f"{component_issue.component_label}: "
            f"{component_issue.message}"
        )
    if str(getattr(project, "recipe_error", "") or "").strip():
        return "Correct the highlighted Blendlink scene setting before publishing"
    return None


def _website_task_command(quality: str) -> str:
    """Return the exact CLI workflow promised by one artist-facing action."""
    commands = {
        "FINAL": WEBSITE_PUBLISH_COMMAND,
        "PREVIEW": "npx blendlink compile --preview",
        "PLAN": "npx blendlink plan",
        "WATCH": "npx blendlink compile --preview --watch",
    }
    try:
        return commands[quality]
    except KeyError as error:
        raise ValueError(f"Unsupported Blendlink website task {quality!r}") from error


class BLENDLINK_OT_sync_now(bpy.types.Operator):
    """Save, validate, and publish the connected Three.js website"""
    bl_idname = "blendlink.sync_now"
    bl_label = "Publish Website"
    # Stamps a persistent blendlink_id onto every editable object and writes
    # the scene recipe before it saves; that is .blend data and has to be an
    # undo step like any other.
    bl_options = {"REGISTER", "UNDO"}

    quality: bpy.props.EnumProperty(items=(
        (
            "FINAL", "Publish Website",
            "Compile and verify Final assets, then run the connected website build",
        ),
        ("PREVIEW", "Preview Website", "Use the fast Preview quality profile"),
        ("PLAN", "Check Atlas Fit", "Validate final atlas capacity without running Cycles"),
        ("WATCH", "Auto-build on Save", "Build a preview whenever this .blend file is saved"),
    ), default="FINAL", options={"HIDDEN"})

    @classmethod
    def poll(cls, context):
        from . import previewrun, syncrun, syncstatus
        issue = _publish_settings_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        if syncrun.is_running():
            cls.poll_message_set("Another website task is already running")
            return False
        preview_current = previewrun.matches_current_file()
        if preview_current and previewrun.is_watching():
            cls.poll_message_set(
                "Live Preview already updates on Save; stop it before publishing the website"
            )
            return False
        if preview_current and previewrun.is_running() and not previewrun.is_ready():
            cls.poll_message_set("Website Preview is still compiling")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save this .blend before building the website")
            return False
        if syncstatus.project_root() is None:
            cls.poll_message_set("Connect a Three.js website to this .blend first")
            return False
        return True

    def execute(self, context):
        from . import previewrun, props, syncrun, syncstatus
        issue = _publish_settings_issue(context)
        if issue:
            self.report({"ERROR"}, issue)
            return {"CANCELLED"}
        preview_current = previewrun.matches_current_file()
        if preview_current and previewrun.is_watching():
            self.report(
                {"ERROR"},
                "Stop Live Preview before publishing the website",
            )
            return {"CANCELLED"}
        if syncrun.is_running() or (
            preview_current and previewrun.is_running() and not previewrun.is_ready()
        ):
            self.report({"ERROR"}, "Another website task is already running")
            return {"CANCELLED"}
        try:
            assigned_ids = _ensure_scene_ids(context.scene)
            props.write_recipe(context.scene)
            saved = _save_before_publish(assigned_ids)
        except (RuntimeError, ValueError) as error:
            print(f"blendlink addon: publish canceled: {error}")
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        syncstatus.refresh(force=not saved)
        # Final is intentionally the complete publish transaction: Final
        # compile, verification, and the connected website's own build. Preview
        # remains the fast, save-driven asset loop and never runs that build.
        try:
            command = _website_task_command(self.quality)
        except ValueError as error:
            print(f"blendlink addon: website task canceled: {error}")
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        label = {
            "PREVIEW": "Updating website preview",
            "FINAL": "Publishing website",
            "PLAN": "Checking atlas fit",
            "WATCH": "Auto-build is watching Blender saves",
        }[self.quality]
        error = syncrun.start(
            command,
            syncstatus.project_root(),
            initial_label=label,
        )
        if error is not None:
            self.report({"ERROR"}, error)
            return {"CANCELLED"}
        self.report({"INFO"}, label + " in the background...")
        return {"FINISHED"}


class BLENDLINK_OT_browser_preview(bpy.types.Operator):
    """Update the real website with Preview quality and open it"""
    bl_idname = "blendlink.browser_preview"
    bl_label = "Preview Website"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        from . import previewrun, syncrun, syncstatus
        issue = _publish_settings_issue(context)
        if issue:
            cls.poll_message_set(issue)
            return False
        if syncrun.is_running():
            cls.poll_message_set("Another website task is already running")
            return False
        if previewrun.matches_current_file() \
                and previewrun.is_running() and not previewrun.is_ready():
            cls.poll_message_set("Website Preview is still compiling")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save this .blend before previewing the website")
            return False
        return True

    def execute(self, context):
        from . import previewrun, props, syncrun, syncstatus
        issue = _publish_settings_issue(context)
        if issue:
            self.report({"ERROR"}, issue)
            return {"CANCELLED"}
        if syncrun.is_running():
            self.report({"ERROR"}, "Another website task is already running")
            return {"CANCELLED"}
        try:
            assigned_ids = _ensure_scene_ids(context.scene)
            props.write_recipe(context.scene)
            saved = _save_before_publish(assigned_ids)
        except (RuntimeError, ValueError) as error:
            print(f"blendlink addon: preview canceled: {error}")
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}
        syncstatus.refresh(force=not saved)
        root = syncstatus.project_root()
        if root is None:
            update_command, update_cwd = _preview_studio_command()
            preview_command, preview_cwd = update_command, update_cwd
        else:
            update_command, update_cwd = "npx blendlink compile --preview", root
            preview_command, preview_cwd = "npx blendlink preview --no-open", root

        preview_current = previewrun.matches_current_file()
        if previewrun.is_running() and preview_current:
            if previewrun.is_ready():
                if not previewrun.open_browser():
                    self.report(
                        {"ERROR"},
                        "The remembered preview does not belong to this Blender file",
                    )
                    return {"CANCELLED"}
                if previewrun.is_watching():
                    self.report(
                        {"INFO"},
                        "Opened Live Preview; the saved changes are updating automatically",
                    )
                elif not syncrun.is_running():
                    error = syncrun.start(
                        update_command,
                        update_cwd,
                        initial_label="Updating website preview",
                    )
                    if error is not None:
                        self.report({"ERROR"}, error)
                        return {"CANCELLED"}
                    self.report({"INFO"}, "Updating the website preview; the browser will refresh")
                else:
                    self.report({"INFO"}, "Opened the preview; another build is already running")
            else:
                self.report({"INFO"}, "The local preview is still starting")
            return {"FINISHED"}

        if previewrun.is_running():
            error = previewrun.replace(
                preview_command,
                preview_cwd,
                blend_path=bpy.data.filepath,
            )
            if error is not None:
                self.report({"ERROR"}, error)
                return {"CANCELLED"}
            self.report(
                {"INFO"},
                "Stopping the previous file's preview; this preview will start automatically",
            )
            return {"FINISHED"}

        error = previewrun.start(
            preview_command,
            preview_cwd,
            blend_path=bpy.data.filepath,
        )
        if error is not None:
            self.report({"ERROR"}, error)
            return {"CANCELLED"}
        self.report(
            {"INFO"},
            "Creating a private Preview Studio..." if root is None
            else "Compiling and starting the local website preview...",
        )
        return {"FINISHED"}


class BLENDLINK_OT_stop_preview(bpy.types.Operator):
    """Stop the local website preview process"""
    bl_idname = "blendlink.stop_preview"
    bl_label = "Stop Website Preview"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import previewrun
        return previewrun.is_running()

    def execute(self, context):
        from . import previewrun
        external_server = not previewrun.owns_server()
        previewrun.cancel()
        self.report(
            {"INFO"},
            "Stopping Blendlink live updates; the external website stays running"
            if external_server else "Stopping the local preview",
        )
        return {"FINISHED"}


class BLENDLINK_OT_open_preview(bpy.types.Operator):
    """Open the last reachable website preview URL"""
    bl_idname = "blendlink.open_preview"
    bl_label = "Open Website"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import previewrun
        if not previewrun.is_ready_for_current_file():
            cls.poll_message_set("Preview this Blender file first")
            return False
        return True

    def execute(self, context):
        from . import previewrun
        if not previewrun.open_browser():
            self.report(
                {"ERROR"}, "No preview URL for this Blender file is available yet",
            )
            return {"CANCELLED"}
        return {"FINISHED"}


class BLENDLINK_OT_copy_preview_url(bpy.types.Operator):
    """Copy the reachable website preview URL"""
    bl_idname = "blendlink.copy_preview_url"
    bl_label = "Copy Preview URL"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import previewrun
        return previewrun.is_ready_for_current_file()

    def execute(self, context):
        from . import previewrun
        if not previewrun.is_ready_for_current_file():
            self.report(
                {"ERROR"}, "No preview URL for this Blender file is available yet",
            )
            return {"CANCELLED"}
        return _copy_with_feedback(
            self, context, previewrun.url(), "Preview URL copied",
        )


class BLENDLINK_OT_open_workspace(bpy.types.Operator):
    """Open the website workspace in the system file browser"""
    bl_idname = "blendlink.open_workspace"
    bl_label = "Open Workspace"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if syncstatus.project_root() is None:
            cls.poll_message_set("No linked Three.js project found near this file")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        bpy.ops.wm.path_open(filepath=syncstatus.project_root())
        return {"FINISHED"}


class BLENDLINK_OT_open_preview_log(bpy.types.Operator):
    """Open the website preview process log"""
    bl_idname = "blendlink.open_preview_log"
    bl_label = "Open Preview Log"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import previewrun
        if not previewrun.last_log_path():
            cls.poll_message_set("No local preview has run yet")
            return False
        return True

    def execute(self, context):
        from . import previewrun
        path = previewrun.last_log_path()
        if not path or not os.path.exists(path):
            self.report({"ERROR"}, "The last preview log is no longer available")
            return {"CANCELLED"}
        bpy.ops.wm.path_open(filepath=path)
        return {"FINISHED"}


class BLENDLINK_OT_sync_cancel(bpy.types.Operator):
    """Stop the running website task"""
    bl_idname = "blendlink.sync_cancel"
    bl_label = "Cancel Website Task"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        return syncrun.is_running()

    def execute(self, context):
        from . import syncrun
        syncrun.cancel()
        self.report({"INFO"}, "Website task canceled")
        return {"FINISHED"}


class BLENDLINK_OT_open_sync_log(bpy.types.Operator):
    """Open the last website build log in the system viewer"""
    bl_idname = "blendlink.open_sync_log"
    bl_label = "Open Build Log"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        if not syncrun.last_log_path():
            cls.poll_message_set("No website build has run yet")
            return False
        return True

    def execute(self, context):
        from . import syncrun
        path = syncrun.last_log_path()
        if not path or not os.path.exists(path):
            self.report({"ERROR"}, "The last website build log is no longer available")
            return {"CANCELLED"}
        bpy.ops.wm.path_open(filepath=path)
        return {"FINISHED"}


class BLENDLINK_OT_copy_sync_hint(bpy.types.Operator):
    """Copy the website build command to run it in a terminal"""
    bl_idname = "blendlink.copy_sync_hint"
    bl_label = "Copy Build Command"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if not syncstatus.sync_hint():
            cls.poll_message_set("The last published result does not include a build command")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        hint = syncstatus.sync_hint()
        return _copy_with_feedback(self, context, hint, f"Copied: {hint}")


class BLENDLINK_OT_copy_connect_command(bpy.types.Operator):
    """Copy the safe website-connection command for a terminal in the site root"""
    bl_idname = "blendlink.copy_connect_command"
    bl_label = "Copy Website Connect Command"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        return _copy_with_feedback(
            self,
            context,
            WEBSITE_CONNECT_COMMAND,
            "Copied npx blendlink connect — run it from the Three.js website folder",
        )


class BLENDLINK_OT_copy_website_handoff(bpy.types.Operator):
    """Copy the exact generated WebGL integration hookup"""
    bl_idname = "blendlink.copy_website_handoff"
    bl_label = "Copy Website Hookup"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        handoff = syncstatus.website_handoff()
        if not handoff or handoff.get("kind") in {"missing", "unknown"}:
            cls.poll_message_set("No generated scene integration was identified yet")
            return False
        return bool(handoff.get("instruction"))

    def execute(self, context):
        from . import syncstatus
        handoff = syncstatus.website_handoff()
        if not handoff or not handoff.get("instruction"):
            self.report({"ERROR"}, "No generated website hookup was identified")
            return {"CANCELLED"}
        return _copy_with_feedback(
            self,
            context,
            handoff["instruction"],
            "Copied the generated WebGL hookup; verify it in the running site",
        )


class BLENDLINK_OT_refresh_checks(bpy.types.Operator):
    """Re-run the vocabulary checks now"""
    bl_idname = "blendlink.refresh_checks"
    bl_label = "Refresh Checks"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        validation.recompute(context.scene)
        return {"FINISHED"}


class BLENDLINK_OT_refresh_sync(bpy.types.Operator):
    """Re-check whether the saved file matches the last website build"""
    bl_idname = "blendlink.refresh_sync"
    bl_label = "Refresh Website Status"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        from . import handlers, syncstatus
        syncstatus.refresh(force=True, rehash_assets=True, rehash_blend=True)
        handlers._tag_redraw_ui()
        return {"FINISHED"}


classes = (
    BLENDLINK_OT_open_properties_context,
    BLENDLINK_OT_use_website_camera,
    BLENDLINK_OT_setup_website_export,
    BLENDLINK_OT_add_composition,
    BLENDLINK_OT_remove_composition,
    BLENDLINK_OT_add_atlas,
    BLENDLINK_OT_remove_atlas,
    BLENDLINK_OT_add_state,
    BLENDLINK_OT_add_state_hidden_collection,
    BLENDLINK_OT_remove_state_hidden_collection,
    BLENDLINK_OT_select_state_collection_objects,
    BLENDLINK_OT_remove_state,
    BLENDLINK_OT_add_reflection_probe,
    BLENDLINK_OT_remove_reflection_probe,
    BLENDLINK_OT_assign_reflection_probe,
    BLENDLINK_OT_clear_reflection_probe,
    BLENDLINK_OT_select_reflection_probe_members,
    BLENDLINK_OT_bake_reflection_probe,
    BLENDLINK_OT_bake_all_reflection_probes,
    BLENDLINK_OT_refresh_reflection_probe_status,
    BLENDLINK_OT_open_reflection_probe_asset,
    BLENDLINK_OT_set_area_light_mode,
    BLENDLINK_OT_tag_collider,
    BLENDLINK_OT_tag_rigid,
    BLENDLINK_OT_set_lod,
    BLENDLINK_OT_tag_noimp,
    BLENDLINK_OT_set_export_inclusion,
    BLENDLINK_OT_set_initial_visibility,
    BLENDLINK_OT_set_shadows,
    BLENDLINK_OT_set_texture_max_size,
    BLENDLINK_OT_set_texture_compression,
    BLENDLINK_OT_clear_tag,
    BLENDLINK_OT_add_anchor,
    BLENDLINK_OT_fix_numbered,
    BLENDLINK_OT_migrate_legacy_property,
    BLENDLINK_OT_select_issue,
    BLENDLINK_OT_set_texel_weight,
    BLENDLINK_OT_set_atlas,
    BLENDLINK_OT_select_authored_atlas_members,
    BLENDLINK_OT_set_shading,
    BLENDLINK_OT_set_web_material_source,
    BLENDLINK_OT_clear_web_material_source,
    BLENDLINK_OT_toggle_material_bake,
    BLENDLINK_OT_toggle_tsl_program,
    BLENDLINK_OT_select_atlas_objects,
    BLENDLINK_OT_preview_atlas_uvs,
    BLENDLINK_OT_materialize_atlas_uvs,
    BLENDLINK_OT_toggle_checker,
    BLENDLINK_OT_checker_cleanup,
    BLENDLINK_OT_select_derived_asset,
    BLENDLINK_OT_open_derived_asset,
    BLENDLINK_OT_isolate_derived_asset,
    BLENDLINK_OT_refresh_bake_table,
    BLENDLINK_OT_sync_now,
    BLENDLINK_OT_browser_preview,
    BLENDLINK_OT_stop_preview,
    BLENDLINK_OT_open_preview,
    BLENDLINK_OT_copy_preview_url,
    BLENDLINK_OT_open_workspace,
    BLENDLINK_OT_open_preview_log,
    BLENDLINK_OT_sync_cancel,
    BLENDLINK_OT_open_sync_log,
    BLENDLINK_OT_copy_sync_hint,
    BLENDLINK_OT_copy_connect_command,
    BLENDLINK_OT_copy_website_handoff,
    BLENDLINK_OT_refresh_checks,
    BLENDLINK_OT_refresh_sync,
)
