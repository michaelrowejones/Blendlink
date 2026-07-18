# SPDX-License-Identifier: GPL-3.0-or-later
"""Session-level settings (WindowManager — never dirties the file)."""
from __future__ import annotations

import bpy


def _redraw_view3d(self, context):
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


class BlendlinkSessionSettings(bpy.types.PropertyGroup):
    show_overlay: bpy.props.BoolProperty(
        name="Vocabulary Overlay",
        description="Draw colliders, sockets, hotspots and audio anchors in the viewport",
        default=True,
        update=_redraw_view3d,
    )


def session(context) -> BlendlinkSessionSettings:
    return context.window_manager.blendlink


def register_pointers():
    bpy.types.WindowManager.blendlink = bpy.props.PointerProperty(
        type=BlendlinkSessionSettings,
    )


def unregister_pointers():
    del bpy.types.WindowManager.blendlink


classes = (BlendlinkSessionSettings,)
