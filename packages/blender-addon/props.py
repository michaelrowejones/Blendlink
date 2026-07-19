# SPDX-License-Identifier: GPL-3.0-or-later
"""Session-level settings (WindowManager — never dirties the file)."""
from __future__ import annotations

import bpy


def _redraw_view3d(self, context):
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _select_row_object(self, context):
    """Row click → select that object in the viewport (one-way sync)."""
    obj = context.scene.objects.get(self.name)
    if obj is None:
        return
    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        context.view_layer.objects.active = obj
    except RuntimeError:
        pass


class BlendlinkBakeRow(bpy.types.PropertyGroup):
    """One row of the bake table, populated from the manifest plan plus the
    live scene (shading reflects current properties, not the stale plan)."""
    name: bpy.props.StringProperty()
    atlas: bpy.props.StringProperty()
    shading: bpy.props.StringProperty()  # 'baked' | 'dynamic (…reason)'
    density: bpy.props.StringProperty()  # e.g. '214 px/m'
    weight: bpy.props.StringProperty()   # e.g. '2.0×1.0'


def _row_index_update(self, context):
    rows = self.bake_rows
    if 0 <= self.bake_row_index < len(rows):
        _select_row_object(rows[self.bake_row_index], context)


class BlendlinkSessionSettings(bpy.types.PropertyGroup):
    show_overlay: bpy.props.BoolProperty(
        name="Vocabulary Overlay",
        description="Draw colliders, sockets, hotspots and audio anchors in the viewport",
        default=True,
        update=_redraw_view3d,
    )
    bake_rows: bpy.props.CollectionProperty(type=BlendlinkBakeRow)
    bake_row_index: bpy.props.IntProperty(default=-1, update=_row_index_update)


def session(context) -> BlendlinkSessionSettings:
    return context.window_manager.blendlink


def register_pointers():
    bpy.types.WindowManager.blendlink = bpy.props.PointerProperty(
        type=BlendlinkSessionSettings,
    )


def unregister_pointers():
    del bpy.types.WindowManager.blendlink


classes = (BlendlinkBakeRow, BlendlinkSessionSettings)
