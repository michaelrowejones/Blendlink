# SPDX-License-Identifier: GPL-3.0-or-later
"""Event wiring: dirty flags from handlers/msgbus, one 1-second timer that
does the actual work on the main thread, redraws only on change."""
from __future__ import annotations

import bpy
from bpy.app.handlers import persistent

from . import syncstatus, validation

_msgbus_owner = object()


def _tag_redraw_view3d():
    manager = bpy.context.window_manager
    if manager is None:
        return
    for window in manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _on_rename():
    validation.mark_dirty()


def _subscribe_msgbus():
    bpy.msgbus.clear_by_owner(_msgbus_owner)
    bpy.msgbus.subscribe_rna(
        key=(bpy.types.Object, "name"),
        owner=_msgbus_owner,
        args=(),
        notify=_on_rename,
    )


@persistent
def _load_post(_filepath):
    validation.mark_dirty()
    syncstatus.reset()
    syncstatus.refresh(force=True)
    # msgbus subscriptions are cleared on file load — re-subscribe.
    _subscribe_msgbus()


@persistent
def _save_post(_filepath):
    syncstatus.refresh(force=True)
    _tag_redraw_view3d()


@persistent
def _depsgraph_update_post(_scene, depsgraph):
    # O(1) early-out: only geometry/object-count changes matter to the scan;
    # a pure transform still moves overlay matrices, so mark dirty regardless
    # (the timer coalesces this to at most one rescan per second).
    if depsgraph.updates:
        validation.mark_dirty()


def _tick():
    changed = False
    if validation.is_dirty():
        changed = validation.consume_if_dirty() or changed
    changed = syncstatus.refresh() or changed
    if changed:
        _tag_redraw_view3d()
    return 1.0


def register():
    bpy.app.handlers.load_post.append(_load_post)
    bpy.app.handlers.save_post.append(_save_post)
    bpy.app.handlers.depsgraph_update_post.append(_depsgraph_update_post)
    _subscribe_msgbus()
    if not bpy.app.background:
        # No eager syncstatus.refresh here: register() may run in Blender's
        # restricted context (enable-at-install) where bpy.data is off-limits.
        # The first timer tick performs the initial scan and refresh.
        bpy.app.timers.register(_tick, first_interval=1.0, persistent=True)


def unregister():
    if bpy.app.timers.is_registered(_tick):
        bpy.app.timers.unregister(_tick)
    bpy.msgbus.clear_by_owner(_msgbus_owner)
    for handler_list, fn in (
        (bpy.app.handlers.load_post, _load_post),
        (bpy.app.handlers.save_post, _save_post),
        (bpy.app.handlers.depsgraph_update_post, _depsgraph_update_post),
    ):
        if fn in handler_list:
            handler_list.remove(fn)
