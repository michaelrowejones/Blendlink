# SPDX-License-Identifier: GPL-3.0-or-later
"""Event wiring: dirty flags from handlers/msgbus, one 1-second timer that
does the actual work on the main thread, redraws only on change."""
from __future__ import annotations

import json

import bpy
from bpy.app.handlers import persistent

from . import syncstatus, validation

_msgbus_owner = object()
_bake_table_change_token = 1
_bake_table_built_token = None
_active_object_token = None
_scene_inventory_token = None
_recipe_hydration_token = None


def mark_bake_table_changed():
    """Invalidate the session table without rebuilding inside an RNA callback."""
    global _bake_table_change_token
    _bake_table_change_token += 1


def _bake_table_source_token():
    return (
        _bake_table_change_token,
        syncstatus.change_token(),
        validation.rendering_revision(),
    )


def _hydrate_recipe_if_needed(context=None) -> bool:
    """Hydrate legacy JSON once per scene/recipe revision, never from draw()."""
    global _recipe_hydration_token
    context = context or bpy.context
    scene = getattr(context, "scene", None)
    if scene is None:
        return False
    from . import props
    raw = scene.get(props.RECIPE_PROPERTY)
    token = (scene.as_pointer(), raw if isinstance(raw, str) else None)
    if token == _recipe_hydration_token:
        return False
    _recipe_hydration_token = token
    project = getattr(scene, "blendlink_project", None)
    if project is None or not isinstance(raw, str):
        return False
    if project.configured:
        try:
            native = json.dumps(
                props.project_recipe(project), separators=(",", ":"), sort_keys=True,
            )
        except ValueError:
            native = None
        if native == raw:
            return False
    try:
        loaded = props.load_legacy_recipe(scene)
    except Exception as error:
        message = (
            "Embedded Blendlink settings could not be loaded: "
            f"{type(error).__name__}: {error}"
        )
        project.recipe_error = message
        print(f"blendlink addon: {message}")
        return True
    if loaded:
        print(f"blendlink addon: loaded canonical embedded settings for scene {scene.name!r}")
        return True
    if not project.recipe_error:
        project.recipe_error = (
            "Embedded Blendlink settings are invalid or use an unsupported schema."
        )
        print(f"blendlink addon: {project.recipe_error} Scene: {scene.name!r}")
    return True


def note_bake_table_rebuilt():
    """Keep an explicit refresh from being repeated by the next timer tick."""
    global _bake_table_built_token
    _bake_table_built_token = _bake_table_source_token()


def _tag_redraw_ui():
    """Refresh every Blendlink host after a cached snapshot changes."""
    manager = bpy.context.window_manager
    if manager is None:
        return
    for window in manager.windows:
        for area in window.screen.areas:
            if area.type in {"VIEW_3D", "PROPERTIES"}:
                area.tag_redraw()


def _on_rename():
    validation.mark_dirty()
    mark_bake_table_changed()
    from . import probe_authoring
    probe_authoring.mark_dirty(getattr(bpy.context, "scene", None))


def _on_bake_table_metadata():
    validation.mark_dirty()
    mark_bake_table_changed()


def _active_token(context):
    view_layer = getattr(context, "view_layer", None)
    active = getattr(getattr(view_layer, "objects", None), "active", None)
    try:
        active_token = (
            (active.as_pointer(), active.name) if active is not None else None
        )
        selected_token = tuple(sorted(
            obj.as_pointer()
            for obj in (getattr(context, "selected_objects", ()) or ())
        ))
        return (active_token, selected_token)
    except ReferenceError:
        return None


def _sync_bake_row_to_active(context=None) -> bool:
    """Reverse-sync scene selection into the session table's active row."""
    context = context or bpy.context
    window_manager = getattr(context, "window_manager", None)
    session = getattr(window_manager, "blendlink", None) if window_manager else None
    if session is None:
        return False
    active = getattr(getattr(context, "view_layer", None), "objects", None)
    active = getattr(active, "active", None)
    active_name = getattr(active, "name", "")
    wanted = next(
        (index for index, row in enumerate(session.bake_rows) if row.name == active_name),
        -1,
    )
    if session.bake_row_index == wanted:
        return False
    session.bake_row_index = wanted
    return True


def _on_active_object():
    global _active_object_token
    try:
        changed = _sync_bake_row_to_active()
        _active_object_token = _active_token(bpy.context)
        # Selection-scoped guides cannot rely on dependency-graph updates.
        validation.mark_dirty()
    except Exception as error:
        print(
            "blendlink addon: bake-table selection sync failed: "
            f"{type(error).__name__}: {error}"
        )
        return
    if changed:
        _tag_redraw_ui()


def _subscribe_msgbus():
    bpy.msgbus.clear_by_owner(_msgbus_owner)
    bpy.msgbus.subscribe_rna(
        key=(bpy.types.Object, "name"),
        owner=_msgbus_owner,
        args=(),
        notify=_on_rename,
    )
    bpy.msgbus.subscribe_rna(
        key=(bpy.types.Object, "hide_render"),
        owner=_msgbus_owner,
        args=(),
        notify=_on_bake_table_metadata,
    )
    bpy.msgbus.subscribe_rna(
        key=(bpy.types.LayerObjects, "active"),
        owner=_msgbus_owner,
        args=(),
        notify=_on_active_object,
    )


@persistent
def _load_post(_filepath):
    global _active_object_token, _scene_inventory_token, _recipe_hydration_token
    validation.mark_dirty()
    syncstatus.reset()
    _recipe_hydration_token = None
    _hydrate_recipe_if_needed()
    syncstatus.refresh(force=True)
    mark_bake_table_changed()
    _active_object_token = None
    _scene_inventory_token = None
    from . import ops, probe_authoring
    ops.reset_checker_mode_cache()
    probe_authoring.mark_dirty(getattr(bpy.context, "scene", None))
    # msgbus subscriptions are cleared on file load — re-subscribe.
    _subscribe_msgbus()


@persistent
def _save_pre(_filepath):
    """Refresh human-readable names in the embedded recipe before save.

    Stable IDs preserve the contract across renames; current names make the
    manifest and diagnostics understandable to the artist.
    """
    from . import ops, presentation_ui, props
    for candidate in bpy.data.scenes:
        reference = getattr(candidate, "blendlink_reference", None)
        if reference is not None:
            reference.last_plan_signature = ""
        if reference is not None and reference.preview_active:
            presentation_ui._restore_preview(candidate, reference)
            print(
                "blendlink addon: restored temporary Responsive Frame preview "
                f"before saving scene {candidate.name!r}"
            )
    scene = bpy.context.scene
    project = getattr(scene, "blendlink_project", None) if scene else None
    if project and project.configured:
        try:
            assigned = ops._ensure_scene_ids(scene)
            if assigned:
                print(
                    f"blendlink addon: assigned {assigned} stable object ID(s) before save"
                )
            props.write_recipe(scene)
        except ValueError as error:
            project.recipe_error = str(error)
            print(
                "blendlink addon: saved without refreshing Blendlink scene settings: "
                f"{error}"
            )


@persistent
def _save_post(_filepath):
    from . import presentation_ui, probe_authoring
    presentation_ui.mark_cache_dirty()
    probe_authoring.mark_dirty(getattr(bpy.context, "scene", None))
    syncstatus.refresh(force=True)
    _tag_redraw_ui()


@persistent
def _history_post(_scene):
    """Invalidate every cached artist-facing view after Undo or Redo."""
    global _active_object_token, _scene_inventory_token, _recipe_hydration_token
    from . import ops, probe_authoring
    validation.mark_dirty()
    mark_bake_table_changed()
    _active_object_token = None
    _scene_inventory_token = None
    _recipe_hydration_token = None
    ops.reset_checker_mode_cache()
    probe_authoring.mark_dirty(_scene or getattr(bpy.context, "scene", None))
    syncstatus.refresh()
    _tag_redraw_ui()


@persistent
def _depsgraph_update_post(_scene, depsgraph):
    global _scene_inventory_token
    # O(1) early-out: only geometry/object-count changes matter to the scan;
    # a pure transform still moves overlay matrices, so mark dirty regardless
    # (the timer coalesces this to at most one rescan per second).
    if depsgraph.updates:
        validation.mark_dirty()
        from . import probe_authoring
        probe_authoring.mark_dirty(_scene or getattr(bpy.context, "scene", None))
    if any(
        isinstance(update.id, bpy.types.Object)
        and getattr(update, "is_updated_geometry", False)
        for update in depsgraph.updates
    ):
        from . import ops
        ops.reset_checker_mode_cache()
    # Object creation/removal is table-relevant. Comparing scene identity and
    # collection length is O(1), unlike walking every mesh on every animated
    # depsgraph update. Names and render visibility use msgbus above.
    scene = _scene or getattr(bpy.context, "scene", None)
    if scene is not None:
        inventory = (scene.as_pointer(), len(scene.objects))
        if _scene_inventory_token is not None and inventory != _scene_inventory_token:
            mark_bake_table_changed()
            from . import ops
            ops.reset_checker_mode_cache()
        _scene_inventory_token = inventory


def _rebuild_bake_table_if_needed(context=None) -> bool:
    """Rebuild once per plan/live token, retaining the token on failure."""
    global _bake_table_built_token
    token = _bake_table_source_token()
    if token == _bake_table_built_token:
        return False
    try:
        from . import ops
        ops.rebuild_bake_table(context or bpy.context)
    except Exception as error:
        # A Blender timer that raises is unregistered. Keep it alive, keep the
        # token pending for retry, and make the failure explicit in stderr.
        print(
            "blendlink addon: automatic bake-table rebuild failed: "
            f"{type(error).__name__}: {error}"
        )
        return False
    _bake_table_built_token = token
    return True


def _sync_active_if_changed(context=None) -> bool:
    global _active_object_token
    context = context or bpy.context
    token = _active_token(context)
    if token == _active_object_token:
        return False
    changed = _sync_bake_row_to_active(context)
    _active_object_token = token
    validation.mark_dirty()
    return changed


def _tick():
    changed = _hydrate_recipe_if_needed()
    from . import ops, presentation_ui, probe_authoring, ui
    # Capture selection changes before consuming validation, so cached guides
    # update this tick rather than one timer interval later.
    changed = _sync_active_if_changed() or changed
    changed = ops.prime_checker_mode() or changed
    changed = ui.prepare_active_material_previews() or changed
    probe_status_changed = probe_authoring.prepare_status_cache()
    if probe_status_changed:
        # Probe status is embedded in the cached viewport-guide label.
        validation.mark_dirty()
        changed = True
    if validation.is_dirty():
        changed = validation.consume_if_dirty() or changed
    changed = presentation_ui.prepare_cache() or changed
    changed = syncstatus.refresh() or changed
    changed = ops.reconcile_saved_asset_override() or changed
    changed = _rebuild_bake_table_if_needed() or changed
    if changed:
        _tag_redraw_ui()
    return 1.0


def register():
    global _active_object_token, _scene_inventory_token, _recipe_hydration_token
    from . import known_issues
    known_issues.prime_cache()
    bpy.app.handlers.load_post.append(_load_post)
    bpy.app.handlers.save_pre.append(_save_pre)
    bpy.app.handlers.save_post.append(_save_post)
    bpy.app.handlers.undo_post.append(_history_post)
    redo_post = getattr(bpy.app.handlers, "redo_post", None)
    if redo_post is not None:
        redo_post.append(_history_post)
    bpy.app.handlers.depsgraph_update_post.append(_depsgraph_update_post)
    _subscribe_msgbus()
    mark_bake_table_changed()
    _active_object_token = None
    _scene_inventory_token = None
    _recipe_hydration_token = None
    from . import ops
    ops.reset_checker_mode_cache()
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
        (bpy.app.handlers.save_pre, _save_pre),
        (bpy.app.handlers.save_post, _save_post),
        (bpy.app.handlers.undo_post, _history_post),
        (bpy.app.handlers.depsgraph_update_post, _depsgraph_update_post),
    ):
        if fn in handler_list:
            handler_list.remove(fn)
    redo_post = getattr(bpy.app.handlers, "redo_post", None)
    if redo_post is not None and _history_post in redo_post:
        redo_post.remove(_history_post)
