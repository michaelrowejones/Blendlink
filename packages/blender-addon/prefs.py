# SPDX-License-Identifier: GPL-3.0-or-later
"""Addon preferences: sidebar category and overlay behavior."""
from __future__ import annotations

import bpy


def _update_category(self, context):
    from . import presentation_ui
    presentation_ui.re_register_category(self.category)


class BlendlinkPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    category: bpy.props.StringProperty(
        name="Sidebar Tab",
        description="Choose the sidebar tab the SceneToWeb panel appears in",
        default="SceneToWeb",
        update=_update_category,
    )
    overlay_xray: bpy.props.BoolProperty(
        name="Overlay X-Ray",
        description="Draw vocabulary overlays through geometry instead of depth-tested",
        default=False,
    )
    preview_package: bpy.props.StringProperty(
        name="Local Preview Package",
        description="Optional built SceneToWeb package folder (containing package.json and dist/cli.js), used for scenes anywhere on this computer",
        subtype="DIR_PATH",
        default="",
    )

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = True
        layout.use_property_decorate = False
        layout.prop(self, "category")
        layout.prop(self, "overlay_xray")
        layout.prop(self, "preview_package")


def get_prefs() -> BlendlinkPreferences | None:
    """Preferences, or None when running from source in tests (no installed addon)."""
    addon = bpy.context.preferences.addons.get(__package__)
    return addon.preferences if addon else None


classes = (BlendlinkPreferences,)
