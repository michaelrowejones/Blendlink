# SPDX-License-Identifier: GPL-3.0-or-later
"""Sidebar panels. One tab, tagging on top, checks and physics in sub-panels."""
from __future__ import annotations

import bpy

from . import syncstatus, validation, vocab

_DEFAULT_CATEGORY = "Blendlink"


class _BlendlinkPanelMixin:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = _DEFAULT_CATEGORY


class BLENDLINK_PT_main(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_main"
    bl_label = "Blendlink"

    def draw(self, context):
        layout = self.layout
        status, icon, label = syncstatus.status()
        row = layout.row(align=True)
        row.label(text=label, icon=icon)
        row.operator("blendlink.refresh_sync", text="", icon="FILE_REFRESH")
        if status in ("NEEDS_SYNC", "UNSAVED_EDITS") and syncstatus.sync_hint():
            hint = layout.row(align=True)
            hint.label(text=f"Run: {syncstatus.sync_hint()}", icon="CONSOLE")
            hint.operator("blendlink.copy_sync_hint", text="", icon="COPYDOWN")

        counts = validation.result().counts
        if counts:
            summary = "  ".join(
                f"{count} {kind}{'s' if count != 1 else ''}"
                for kind, count in sorted(counts.items())
            )
            layout.label(text=summary, icon="OUTLINER_OB_GROUP_INSTANCE")

        layout.prop(context.window_manager.blendlink, "show_overlay")


class BLENDLINK_PT_tag(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_tag"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Tag Selected"

    def draw(self, context):
        layout = self.layout
        column = layout.column(align=True)
        column.operator_menu_enum("blendlink.tag_collider", "kind", icon="MESH_ICOSPHERE")
        column.operator("blendlink.tag_rigid", icon="RIGID_BODY")
        column.operator("blendlink.set_lod", icon="MOD_DECIM")
        column.operator("blendlink.tag_noimp", icon="EXPORT")
        layout.operator_menu_enum("blendlink.add_anchor", "kind", icon="EMPTY_ARROWS")
        layout.operator("blendlink.clear_tag", icon="X")


class BLENDLINK_PT_physics(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_physics"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Physics"

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        if obj is None:
            return False
        classification = vocab.classify(obj.name)
        return classification is not None and classification.kind == "rigid"

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False
        obj = context.active_object
        if "mass" in obj:
            layout.prop(obj, '["mass"]', text="Mass", slider=True)
        if "friction" in obj:
            layout.prop(obj, '["friction"]', text="Friction", slider=True)


_ANCHOR_LABEL = {"socket": "Socket", "hotspot": "Hotspot", "audio": "Audio Anchor"}


class BLENDLINK_PT_anchor(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_anchor"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Anchor"

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        if obj is None:
            return False
        classification = vocab.classify(obj.name)
        return classification is not None and classification.kind in _ANCHOR_LABEL

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False
        obj = context.active_object
        classification = vocab.classify(obj.name)
        layout.label(
            text=f"{_ANCHOR_LABEL[classification.kind]}: {classification.anchor_name}",
            icon="EMPTY_ARROWS",
        )
        if classification.kind == "hotspot":
            if "title" in obj:
                layout.prop(obj, '["title"]', text="Title")
            if "body" in obj:
                layout.prop(obj, '["body"]', text="Body")
        if obj.parent is not None:
            layout.label(text=f"Attached to {obj.parent.name}", icon="LINKED")


class BLENDLINK_PT_checks(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_checks"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Checks"

    def draw(self, context):
        layout = self.layout
        issues = validation.result().issues
        header = layout.row(align=True)
        if issues:
            header.label(text=f"{len(issues)} to review", icon="ERROR")
        else:
            header.label(text="Vocabulary looks good", icon="CHECKMARK")
        header.operator("blendlink.refresh_checks", text="", icon="FILE_REFRESH")
        if not issues:
            return
        box = layout.box()
        for issue in issues:
            row = box.row(align=True)
            icon = "ERROR" if issue.severity == "WARNING" else "INFO"
            row.label(text=issue.message, icon=icon)
            if issue.object_name:
                op = row.operator("blendlink.select_issue", text="", icon="RESTRICT_SELECT_OFF")
                op.object_name = issue.object_name
            if issue.fixable_numbered and issue.object_name:
                op = row.operator("blendlink.fix_numbered", text="", icon="AUTO")
                op.object_name = issue.object_name


classes = (
    BLENDLINK_PT_main,
    BLENDLINK_PT_tag,
    BLENDLINK_PT_physics,
    BLENDLINK_PT_anchor,
    BLENDLINK_PT_checks,
)


def re_register_category(category: str):
    """Move all panels to a different sidebar tab (preferences update)."""
    for cls in reversed(classes):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
    for cls in classes:
        cls.bl_category = category or _DEFAULT_CATEGORY
        bpy.utils.register_class(cls)
