# SPDX-License-Identifier: GPL-3.0-or-later
"""Vocabulary authoring operators.

Every operator follows the native contract: acts on all selected editable
objects, {'REGISTER', 'UNDO'} so F9 redo works, poll() with a message, and a
status-bar report of what happened. No dialogs, no popups.
"""
from __future__ import annotations

import bpy
from mathutils import Matrix

from . import validation, vocab

_SEP = "-"


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
                tagged += 1
            else:
                skipped.append(obj.name)
        validation.mark_dirty()
        if skipped:
            self.report({"WARNING"}, f"Tagged {tagged}, skipped name collisions: {', '.join(skipped)}")
        else:
            self.report({"INFO"}, f"Tagged {tagged} object(s) as {self.kind}")
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
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}{_SEP}rigid"):
                continue
            obj["mass"] = self.mass
            obj.id_properties_ui("mass").update(
                min=0.0, soft_max=100.0, precision=2,
                description="Rigid-body mass in kilograms",
            )
            obj["friction"] = self.friction
            obj.id_properties_ui("friction").update(
                min=0.0, max=1.0, precision=2,
                description="Surface friction coefficient",
            )
            tagged += 1
        validation.mark_dirty()
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
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            base = vocab.strip_structural(obj.name)
            if not _rename(obj, f"{base}_LOD{self.level}"):
                continue
            if self.distance > 0.0:
                obj["lod_distance"] = self.distance
                obj.id_properties_ui("lod_distance").update(
                    min=0.0, soft_max=500.0, subtype="DISTANCE",
                    description="Camera distance where this level takes over",
                )
            tagged += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Set {tagged} object(s) to LOD{self.level}")
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
        tagged = 0
        for obj in context.selected_editable_objects:
            base = vocab.strip_structural(obj.name)
            if _rename(obj, f"{base}{_SEP}noimp"):
                tagged += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Excluded {tagged} object(s) from export")
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
        if not any(vocab.classify(o.name) for o in context.selected_editable_objects):
            cls.poll_message_set("Select tagged objects")
            return False
        return True

    def execute(self, context):
        cleared = 0
        for obj in context.selected_editable_objects:
            classification = vocab.classify(obj.name)
            if classification is None:
                continue
            if classification.kind in ("socket", "hotspot", "audio"):
                stripped = vocab.strip_anchor(obj.name)
            else:
                stripped = vocab.strip_structural(obj.name)
            if _rename(obj, stripped):
                cleared += 1
        validation.mark_dirty()
        self.report({"INFO"}, f"Cleared tags on {cleared} object(s)")
        return {"FINISHED"}


_ANCHOR_DISPLAY = {
    "SOCKET": ("ARROWS", 0.15),
    "HOTSPOT": ("SPHERE", 0.08),
    "AUDIO": ("PLAIN_AXES", 0.12),
}


class BLENDLINK_OT_add_anchor(bpy.types.Operator):
    """Add a typed anchor empty parented to the active object"""
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

    @classmethod
    def poll(cls, context):
        if context.mode != "OBJECT":
            cls.poll_message_set("Switch to Object Mode")
            return False
        return True

    def execute(self, context):
        display_type, display_size = _ANCHOR_DISPLAY[self.kind]
        anchor = bpy.data.objects.new(f"{self.kind}_{self.anchor_name}", None)
        anchor.empty_display_type = display_type
        anchor.empty_display_size = display_size
        context.collection.objects.link(anchor)
        parent = context.active_object
        if parent is not None and parent != anchor:
            anchor.parent = parent
            anchor.matrix_parent_inverse = Matrix.Identity(4)
            anchor.matrix_world = parent.matrix_world
        else:
            anchor.location = context.scene.cursor.location
        if self.kind == "HOTSPOT":
            anchor["title"] = self.anchor_name
            anchor.id_properties_ui("title").update(description="Heading shown in the web hotspot")
            anchor["body"] = ""
            anchor.id_properties_ui("body").update(description="Body text shown in the web hotspot")
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
        obj = bpy.data.objects.get(self.object_name)
        if obj is None:
            self.report({"WARNING"}, f"Object {self.object_name!r} no longer exists")
            return {"CANCELLED"}
        fixed = vocab.fix_numbered(obj.name)
        if fixed == obj.name or not _rename(obj, fixed):
            self.report({"WARNING"}, f"Could not fix {obj.name!r}")
            return {"CANCELLED"}
        validation.mark_dirty()
        self.report({"INFO"}, f"Renamed to {fixed!r}")
        return {"FINISHED"}


class BLENDLINK_OT_select_issue(bpy.types.Operator):
    """Select and frame the object this check refers to"""
    bl_idname = "blendlink.select_issue"
    bl_label = "Select Object"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: bpy.props.StringProperty(options={"SKIP_SAVE"})

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name)
        if obj is None or obj.name not in context.view_layer.objects:
            self.report({"WARNING"}, f"Object {self.object_name!r} is not in this view layer")
            return {"CANCELLED"}
        for other in context.selected_objects:
            other.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
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

    def execute(self, context):
        tagged = 0
        for obj in context.selected_editable_objects:
            if obj.type != "MESH":
                continue
            obj["texel_weight"] = self.weight
            obj.id_properties_ui("texel_weight").update(
                min=0.0, soft_max=4.0, precision=2,
                description=(
                    "Lightmap scale: linear texel-density multiplier for the "
                    "baked atlas. 0 excludes the object from the atlas but it "
                    "still lights the bake"
                ),
            )
            tagged += 1
        from . import validation
        validation.mark_dirty()
        self.report({"INFO"}, f"Set lightmap scale {self.weight:g} on {tagged} object(s)")
        return {"FINISHED"}


class BLENDLINK_OT_sync_now(bpy.types.Operator):
    """Save the file and run the project sync in the background"""
    bl_idname = "blendlink.sync_now"
    bl_label = "Sync Now"
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        from . import syncrun, syncstatus
        if syncrun.is_running():
            cls.poll_message_set("A sync is already running")
            return False
        if not bpy.data.filepath:
            cls.poll_message_set("Save the file first so there is something to sync")
            return False
        if syncstatus.project_root() is None:
            cls.poll_message_set("No blendlink.config.mjs found near this file")
            return False
        return True

    def execute(self, context):
        from . import syncrun, syncstatus
        if bpy.data.is_dirty:
            bpy.ops.wm.save_mainfile()
        syncstatus.refresh(force=True)
        # Always run the orchestrator: it hash-gates external builds and
        # skips instantly when everything is already in sync.
        command = "npx blendlink sync"
        error = syncrun.start(command, syncstatus.project_root())
        if error is not None:
            self.report({"ERROR"}, error)
            return {"CANCELLED"}
        self.report({"INFO"}, "Syncing in the background...")
        return {"FINISHED"}


class BLENDLINK_OT_sync_cancel(bpy.types.Operator):
    """Stop the running sync"""
    bl_idname = "blendlink.sync_cancel"
    bl_label = "Cancel Sync"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        return syncrun.is_running()

    def execute(self, context):
        from . import syncrun
        syncrun.cancel()
        self.report({"INFO"}, "Sync canceled")
        return {"FINISHED"}


class BLENDLINK_OT_open_sync_log(bpy.types.Operator):
    """Open the last sync log in the system viewer"""
    bl_idname = "blendlink.open_sync_log"
    bl_label = "Open Sync Log"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncrun
        import os
        if not syncrun.last_log_path() or not os.path.exists(syncrun.last_log_path()):
            cls.poll_message_set("No sync has run yet")
            return False
        return True

    def execute(self, context):
        from . import syncrun
        bpy.ops.wm.path_open(filepath=syncrun.last_log_path())
        return {"FINISHED"}


class BLENDLINK_OT_copy_sync_hint(bpy.types.Operator):
    """Copy the sync command to the clipboard to run it in a terminal"""
    bl_idname = "blendlink.copy_sync_hint"
    bl_label = "Copy Sync Command"
    bl_options = {"INTERNAL"}

    @classmethod
    def poll(cls, context):
        from . import syncstatus
        if not syncstatus.sync_hint():
            cls.poll_message_set("The manifest does not record a sync command")
            return False
        return True

    def execute(self, context):
        from . import syncstatus
        hint = syncstatus.sync_hint()
        context.window_manager.clipboard = hint
        self.report({"INFO"}, f"Copied: {hint}")
        return {"FINISHED"}


class BLENDLINK_OT_refresh_checks(bpy.types.Operator):
    """Re-run the vocabulary checks now"""
    bl_idname = "blendlink.refresh_checks"
    bl_label = "Refresh Checks"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        validation.recompute(context.scene)
        return {"FINISHED"}


class BLENDLINK_OT_refresh_sync(bpy.types.Operator):
    """Re-check whether the saved file matches the last blendlink sync"""
    bl_idname = "blendlink.refresh_sync"
    bl_label = "Refresh Sync Status"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        from . import syncstatus
        syncstatus.refresh(force=True)
        return {"FINISHED"}


classes = (
    BLENDLINK_OT_tag_collider,
    BLENDLINK_OT_tag_rigid,
    BLENDLINK_OT_set_lod,
    BLENDLINK_OT_tag_noimp,
    BLENDLINK_OT_clear_tag,
    BLENDLINK_OT_add_anchor,
    BLENDLINK_OT_fix_numbered,
    BLENDLINK_OT_select_issue,
    BLENDLINK_OT_set_texel_weight,
    BLENDLINK_OT_sync_now,
    BLENDLINK_OT_sync_cancel,
    BLENDLINK_OT_open_sync_log,
    BLENDLINK_OT_copy_sync_hint,
    BLENDLINK_OT_refresh_checks,
    BLENDLINK_OT_refresh_sync,
)
