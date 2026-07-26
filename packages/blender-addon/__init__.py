# SPDX-License-Identifier: GPL-3.0-or-later
"""Blendlink companion addon: author the blendlink vocabulary in Blender.

Thin and authoring-only by design — it never exports and never syncs. It
tags names, adds anchor empties, sets physics properties with native slider
metadata, lints the vocabulary live, shows whether the saved file matches
the last `blendlink sync`, and draws what blendlink sees in the viewport.
"""
from __future__ import annotations

import bpy

from . import components_ui, handlers, ops, overlay, prefs, presentation_ui, props, ui

_classes = (
    *props.classes,
    *prefs.classes,
    *ops.classes,
    *ui.classes,
    *presentation_ui.classes,
    *components_ui.classes,
)


def register():
    for cls in _classes:
        bpy.utils.register_class(cls)
    props.register_pointers()
    presentation_ui.register_pointers()
    preferences = prefs.get_prefs()
    if preferences and preferences.category != "Blendlink":
        presentation_ui.re_register_category(preferences.category)
    handlers.register()
    overlay.register()


def unregister():
    from . import previewrun, syncrun
    previewrun.shutdown()
    syncrun.shutdown()
    overlay.unregister()
    ui.clear_derived_previews()
    handlers.unregister()
    presentation_ui.unregister_pointers()
    props.unregister_pointers()
    for cls in reversed(_classes):
        bpy.utils.unregister_class(cls)
