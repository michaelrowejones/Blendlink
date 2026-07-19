# SPDX-License-Identifier: GPL-3.0-or-later
"""Sidebar panels. One tab, tagging on top, checks and physics in sub-panels."""
from __future__ import annotations

import bpy

from . import syncrun, syncstatus, validation, vocab

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
        if syncrun.is_running():
            fraction, label = syncrun.progress()
            if hasattr(layout, "progress"):
                row = layout.row(align=True)
                row.progress(factor=fraction, type="BAR", text=label or "syncing")
                row.operator("blendlink.sync_cancel", text="", icon="X")
            else:
                row = layout.row(align=True)
                row.label(text=f"{label} ({fraction:.0%})", icon="FILE_REFRESH")
                row.operator("blendlink.sync_cancel", text="", icon="X")
        else:
            status, icon, label = syncstatus.status()
            row = layout.row(align=True)
            row.label(text=label, icon=icon)
            row.operator("blendlink.refresh_sync", text="", icon="FILE_REFRESH")
            exit_code = syncrun.last_exit_code()
            if exit_code not in (None, 0):
                failed = layout.row(align=True)
                failed.label(text=f"Last sync failed (exit {exit_code})", icon="ERROR")
                failed.operator("blendlink.open_sync_log", text="", icon="TEXT")
            if status in ("NEEDS_SYNC", "UNSAVED_EDITS"):
                layout.operator("blendlink.sync_now", icon="FILE_REFRESH")
                if syncstatus.sync_hint():
                    hint = layout.row(align=True)
                    hint.label(text=f"Or run: {syncstatus.sync_hint()}", icon="CONSOLE")
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


_ROLE_UI = {
    "collider": ("MESH_ICOSPHERE", "Collider"),
    "rigid": ("RIGID_BODY", "Rigid Body"),
    "lod": ("MOD_DECIM", "LOD Level"),
    "noimp": ("EXPORT", "Excluded"),
    "socket": ("EMPTY_ARROWS", "Socket"),
    "hotspot": ("INFO", "Hotspot"),
    "audio": ("SPEAKER", "Audio Anchor"),
}


def describe(classification) -> str:
    """One sentence: what this designation DOES in the web build. The
    research finding: legible designation systems state consequences, not
    just labels."""
    if classification is None:
        return "No designation — renders as-is in the web build"
    kind = classification.kind
    if kind == "collider":
        shape = "a convex-hull" if classification.shape == "convex" else "an exact-mesh"
        if classification.proxy_only:
            return (
                f"Ships for physics only: hidden in the web build, "
                f"its mesh becomes {shape} collider named {classification.base!r}"
            )
        return f"Renders normally, and the web build also gets {shape} collider"
    if kind == "rigid":
        return "Simulated as a rigid body in the web build (mass and friction below)"
    if kind == "lod":
        return (
            f"Level {classification.lod_index} of the {classification.base!r} chain — "
            f"the web build switches levels by camera distance"
        )
    if kind == "noimp":
        return "Never exported — reference geometry that stays in Blender"
    if kind == "socket":
        return (
            f"Typed attach point {classification.anchor_name!r}: its transform is "
            f"exported for mounting objects in code; no geometry"
        )
    if kind == "hotspot":
        return (
            f"Interactive marker {classification.anchor_name!r}: the web UI shows "
            f"its title and body at this position"
        )
    if kind == "audio":
        return f"Positional audio emitter {classification.anchor_name!r} for the web scene"
    return ""


class BLENDLINK_PT_designation(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_designation"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Designation"

    @classmethod
    def poll(cls, context):
        return context.active_object is not None

    def draw(self, context):
        layout = self.layout
        obj = context.active_object
        extras = {key: obj[key] for key in obj.keys()}
        classification = vocab.classify(obj.name, extras)

        if classification is None:
            layout.label(text="None — renders as-is", icon="OBJECT_DATA")
            _draw_atlas_controls(layout, obj)
            return
        icon, label = _ROLE_UI.get(classification.kind, ("OBJECT_DATA", classification.kind))
        header = layout.row(align=True)
        header.label(text=label, icon=icon)
        if isinstance(extras.get(vocab.ROLE_PROPERTY), str):
            header.label(text="(set by property)", icon="PROPERTIES")

        # The consequence, wrapped to the panel width.
        text = describe(classification)
        words, line = text.split(), ""
        box = layout.box()
        for word in words:
            if len(line) + len(word) + 1 > 38:
                box.label(text=line)
                line = word
            else:
                line = f"{line} {word}".strip()
        if line:
            box.label(text=line)

        column = layout.column()
        column.use_property_split = True
        column.use_property_decorate = False
        if classification.kind == "rigid":
            _draw_prop(column, obj, "mass", "Mass", slider=True)
            _draw_prop(column, obj, "friction", "Friction", slider=True)
        if classification.kind == "lod":
            _draw_prop(column, obj, "lod_distance", "Switch Distance")
        if classification.kind == "hotspot":
            _draw_prop(column, obj, "title", "Title")
            _draw_prop(column, obj, "body", "Body")
        if classification.kind in ("socket", "hotspot", "audio") and obj.parent is not None:
            layout.label(text=f"Attached to {obj.parent.name}", icon="LINKED")
        _draw_atlas_controls(layout, obj)


def density_summary(entry) -> list[str]:
    """Bake-plan entry → the consequence lines shown under the slider.

    The card's thesis applies to density too: state what the number MEANS
    (perceived quality at the camera), not just the raw px/m.
    """
    if not entry:
        return []
    lines = []
    px = entry.get("pxPerMeter")
    share = entry.get("uvShare")
    if px:
        share_text = f" · {share * 100:.1f}% of atlas" if share else ""
        lines.append(f"{px:.0f} px/m{share_text}")
    screen = entry.get("screenDensity")
    if screen:
        auto = entry.get("autoWeight", 1.0)
        auto_text = f" · auto {auto:g}x" if auto != 1.0 else ""
        lines.append(f"screen density {screen:.0f}{auto_text}")
    return lines


def _prop_key(obj, bare: str) -> str | None:
    """Namespaced key first (blendlink_*), bare key as the deprecated
    fallback — bare names collide with other addons' ID properties."""
    namespaced = f"blendlink_{bare}"
    if namespaced in obj:
        return namespaced
    if bare in obj:
        return bare
    return None


def _draw_prop(column, obj, bare: str, text: str, slider: bool = False):
    key = _prop_key(obj, bare)
    if key is not None:
        column.prop(obj, f'["{key}"]', text=text, slider=slider)


def _draw_atlas_controls(layout, obj):
    """Baked-atlas density control (meshes only): the artist's lightmap
    scale, applied by the bake pipeline as an island pre-scale."""
    if obj.type != "MESH":
        return
    column = layout.column()
    column.use_property_split = True
    column.use_property_decorate = False
    weight_key = _prop_key(obj, "texel_weight")
    if weight_key is not None:
        column.prop(obj, f'["{weight_key}"]', text="Lightmap Scale", slider=True)
        if float(obj[weight_key] or 0) == 0:
            column.label(text="Excluded from the atlas (still lights)", icon="INFO")
    else:
        column.operator("blendlink.set_texel_weight", icon="TEXTURE")
    # Density from the last sync's bake plan: the slider's consequence,
    # shown where the slider lives instead of only in the terminal.
    lines = density_summary(syncstatus.plan_for(obj.name))
    if lines:
        readout = layout.column(align=True)
        readout.scale_y = 0.8
        for line in lines:
            readout.label(text=line, icon="NONE")
        if syncstatus.status()[0] != "IN_SYNC":
            readout.label(text="from last sync — resync to refresh", icon="TIME")


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
    BLENDLINK_PT_designation,
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
