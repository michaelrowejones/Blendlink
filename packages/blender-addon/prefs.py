# SPDX-License-Identifier: GPL-3.0-or-later
"""Addon preferences: sidebar category and overlay behavior."""
from __future__ import annotations

import bpy


def _update_category(self, context):
    from . import ui
    ui.re_register_category(self.category)


class BlendlinkPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    category: bpy.props.StringProperty(
        name="Sidebar Tab",
        description="Choose the sidebar tab the Blendlink panel appears in",
        default="Blendlink",
        update=_update_category,
    )
    overlay_xray: bpy.props.BoolProperty(
        name="Overlay X-Ray",
        description="Draw vocabulary overlays through geometry instead of depth-tested",
        default=False,
    )

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False
        layout.prop(self, "category")
        layout.prop(self, "overlay_xray")


def get_prefs() -> BlendlinkPreferences | None:
    """Preferences, or None when running from source in tests (no installed addon)."""
    addon = bpy.context.preferences.addons.get(__package__)
    return addon.preferences if addon else None


classes = (BlendlinkPreferences,)
