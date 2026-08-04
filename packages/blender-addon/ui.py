# SPDX-License-Identifier: GPL-3.0-or-later
"""Sidebar panels. One tab, tagging on top, checks and physics in sub-panels."""
from __future__ import annotations

import bpy
import bpy.utils.previews

from .bakelib_loader import bakelib
from . import (
    known_issues,
    nla_sequence,
    ownership,
    previewrun,
    probe_authoring,
    props,
    syncrun,
    syncstatus,
    ui_state,
    validation,
    vocab,
    weblights,
)

_DEFAULT_CATEGORY = "Blendlink"
_derived_previews = None
_material_preview_token = None


def _logical_region_width(context=None) -> float:
    """Current editor width after Blender UI scaling, with a test fallback."""
    context = context or getattr(bpy, "context", None)
    region = getattr(context, "region", None)
    width = float(getattr(region, "width", 0) or 0)
    preferences = getattr(context, "preferences", None)
    system = getattr(preferences, "system", None)
    scale = float(getattr(system, "ui_scale", 1.0) or 1.0)
    return width / scale if width else 340.0


def _is_compact(context=None, threshold: float = 300.0) -> bool:
    return _logical_region_width(context) < threshold


def _responsive_wrap_width(context=None) -> int:
    # Blender labels do not wrap. Reserve panel padding/icon space before
    # estimating characters; this stays conservative at the default N-panel.
    usable = max(160.0, _logical_region_width(context) - 32.0)
    return max(22, min(84, int(usable / 7.2)))


def _shorten(value: str, context=None, *, reserve: int = 0) -> str:
    limit = max(16, _responsive_wrap_width(context) - reserve)
    value = str(value)
    return value if len(value) <= limit else value[: max(1, limit - 1)].rstrip() + "…"


def _wrap_text(value: str, width: int | None = None) -> list[str]:
    """Wrap sidebar copy explicitly; Blender labels do not wrap themselves."""
    width = width or _responsive_wrap_width()
    lines = []
    for paragraph in str(value).splitlines() or [""]:
        words, line = paragraph.split(), ""
        for word in words:
            if line and len(line) + len(word) + 1 > width:
                lines.append(line)
                line = word
            else:
                line = f"{line} {word}".strip()
        if line:
            lines.append(line)
        elif not words:
            lines.append("")
    return lines


def _draw_wrapped(container, value: str, *, width: int | None = None, icon: str = "NONE"):
    for index, line in enumerate(_wrap_text(value, width)):
        container.label(text=line, icon=icon if index == 0 else "NONE")


def _message_sections(message: str, fallback_remedy: str) -> tuple[str, str]:
    """Split compiler prose into a visible consequence and next action."""
    value = str(message).strip()
    for marker in ("; ", ". Remedy: ", ". Fix: "):
        if marker in value:
            consequence, remedy = value.split(marker, 1)
            return consequence.rstrip("."), remedy.strip()
    return value, fallback_remedy


def _export_setup(configured: bool, filepath: str, project_root: str | None) -> tuple[dict, ...]:
    """Blender-side prerequisites; deliberately not website readiness."""
    saved = bool(filepath)
    located = saved and bool(project_root)
    return (
        {
            "key": "scene",
            "complete": bool(configured),
            "label": "Blendlink scene is set up" if configured else "Set up this Blender scene",
        },
        {
            "key": "save",
            "complete": saved,
            "label": "Blend file is saved" if saved else "Save this .blend file",
        },
        {
            "key": "project",
            "complete": located,
            "label": "Three.js project connected" if located else "Connect the Three.js project",
        },
    )


def _draw_export_setup(layout, context, project) -> bool:
    filepath = bpy.data.filepath
    root = syncstatus.project_root() if filepath else None
    steps = _export_setup(project.configured, filepath, root)
    complete = all(step["complete"] for step in steps)
    box = layout.box()
    header = box.row(align=True)
    header.label(
        text="Blender export setup complete" if complete else "Blender Export Setup",
        icon="CHECKMARK" if complete else "INFO",
    )
    header.operator("blendlink.refresh_sync", text="", icon="FILE_REFRESH")
    for step in steps:
        row = box.row(align=True)
        row.label(
            text=step["label"],
            icon="CHECKMARK" if step["complete"] else "RADIOBUT_OFF",
        )
        if step["key"] == "scene" and not step["complete"]:
            row.operator("blendlink.setup_website_export", text="Set Up", icon="ADD")
        elif step["key"] == "save" and not step["complete"]:
            row.operator("wm.save_as_mainfile", text="Save…", icon="FILE_TICK")
        elif step["key"] == "project" and step["complete"]:
            row.operator("blendlink.open_workspace", text="Open", icon="FILE_FOLDER")

    if filepath and not root:
        _draw_wrapped(
            box,
            "No website project connection was found above this file. Keep the .blend "
            "inside the Three.js project, then run this once from the website folder. "
            "It connects paths and commands; artistic settings stay in this scene:",
        )
        actions = box.row(align=True)
        actions.operator(
            "blendlink.copy_connect_command",
            text="Copy: npx blendlink connect",
            icon="COPYDOWN",
        )
        guide = actions.operator("wm.url_open", text="Connect Guide", icon="HELP")
        guide.url = "https://github.com/michaelrowejones/Blendlink#quick-start"
    elif not filepath:
        _draw_wrapped(
            box,
            "Saving establishes where Blendlink should look for the website project and generated output.",
        )
    elif complete:
        _draw_wrapped(box, str(root), icon="FILE_FOLDER")
        _draw_wrapped(
            box,
            "These checks cover Blender-side setup and project location only. "
            "The first preview verifies the CLI and website dependencies.",
            icon="INFO",
        )
    return complete


def _draw_next_setup_step(layout, context, project) -> bool:
    """Show one unresolved prerequisite and one dominant remedy.

    Completed checklist rows are deliberately omitted: they are useful state
    for the model, but visual noise for an artist trying to find the next move.
    """
    filepath = bpy.data.filepath
    root = syncstatus.project_root() if filepath else None
    steps = _export_setup(project.configured, filepath, root)
    # A connected website is required for Final publishing, but never for the
    # artist's first preview. Preview Website provisions a private disposable
    # Preview Studio for any configured, saved .blend.
    if all(step["complete"] for step in steps[:2]):
        return True

    step = next(item for item in steps if not item["complete"])
    box = layout.box()
    title = {
        "scene": "Set up this scene",
        "save": "Save this scene",
        "project": "Connect the website",
    }[step["key"]]
    box.label(text=f"Next · {title}", icon="INFO")
    action = box.column(align=True)
    action.scale_y = 1.35
    if step["key"] == "scene":
        _draw_wrapped(
            box,
            "Prepare this scene for web publishing. Blendlink creates Main and keeps the settings in this .blend.",
        )
        action.operator("blendlink.setup_website_export", text="Set Up Blendlink Scene", icon="ADD")
    elif step["key"] == "save":
        _draw_wrapped(
            box,
            "Save the .blend inside the website project so Blendlink can find its output and tools.",
        )
        action.operator("wm.save_as_mainfile", text="Save Scene…", icon="FILE_TICK")
    return False


class _PreviewSessionState:
    """Derived Live Preview session flags for the panels that draw it.

    `current` - the running preview belongs to THIS saved file.
    `stale`   - a previous session is still lying around.
    `starting`- this file's preview is spawning but not serving yet.
    `updating`- this file's preview is mid-recompile.

    Three panels answer these questions and used to derive them
    independently, so they could disagree about the same session. They
    render differently on purpose; only the answers are shared.
    """

    __slots__ = ("current", "stale", "starting", "updating")

    def __init__(self):
        self.current = previewrun.matches_current_file()
        self.stale = previewrun.has_stale_session()
        self.starting = (
            self.current
            and previewrun.is_running()
            and not previewrun.is_ready()
        )
        self.updating = self.current and previewrun.is_updating()


def _draw_handoff_alert(layout, context):
    handoff = syncstatus.website_handoff()
    if handoff is None or handoff.get("kind") not in {"missing", "unknown", "unreadable"}:
        return
    box = layout.box()
    header = box.row(align=True)
    header.alert = True
    header.label(text="Website hookup needed", icon="ERROR")
    header.operator("blendlink.open_workspace", text="", icon="FILE_FOLDER")
    detail = {
        "unknown": "Create this scene's website component before the first preview.",
        "missing": "The generated website component is missing. Run connect to recreate it.",
    }.get(handoff.get("kind"), handoff.get("detail") or handoff.get("instruction", ""))
    _draw_wrapped(box, detail)
    actions = box.column(align=True) if _is_compact(context) else box.row(align=True)
    if handoff.get("kind") in {"missing", "unknown"}:
        actions.operator(
            "blendlink.copy_connect_command", text="Copy Connect Command", icon="COPYDOWN",
        )
    else:
        actions.operator("blendlink.copy_website_handoff", text="Copy Website Hookup", icon="COPYDOWN")
    actions.operator("blendlink.open_workspace", text="Open Website Folder", icon="FILE_FOLDER")


def _draw_website_handoff(layout):
    """Show the required app-code step without pretending Blender can certify it."""
    handoff = syncstatus.website_handoff()
    if handoff is None:
        return
    box = layout.box()
    missing = handoff.get("kind") in {"missing", "unknown", "unreadable"}
    box.alert = missing
    header = box.row(align=True)
    header.label(text="Required Website Hookup", icon="ERROR" if missing else "INFO")
    header.operator("blendlink.open_workspace", text="", icon="FILE_FOLDER")
    _draw_wrapped(box, handoff.get("instruction", ""), icon="CONSOLE")
    _draw_wrapped(box, handoff.get("detail", ""), icon="INFO")
    actions = box.row(align=True)
    if handoff.get("kind") in {"missing", "unknown"}:
        actions.operator(
            "blendlink.copy_connect_command", text="Copy: npx blendlink connect", icon="COPYDOWN",
        )
    else:
        actions.operator(
            "blendlink.copy_website_handoff", text="Copy Hookup", icon="COPYDOWN",
        )
    actions.operator("blendlink.open_workspace", text="Open Website Folder", icon="FILE_FOLDER")


def _draw_known_issues(layout):
    try:
        issues = known_issues.current()
    except RuntimeError as error:
        box = layout.box()
        box.alert = True
        box.label(text="Known-issue data is invalid", icon="ERROR")
        _draw_wrapped(box, str(error))
        return
    for issue in issues:
        box = layout.box()
        box.alert = issue["severity"] == "block"
        box.label(text=f"Blender known issue: {issue['summary']}", icon="ERROR")
        _draw_wrapped(box, issue["action"])
        evidence = box.operator("wm.url_open", text="Primary evidence", icon="URL")
        evidence.url = issue["evidence"][0]


def prepare_derived_preview(path: str, revision: str = "") -> int:
    """Load a verified derived thumbnail from an explicit user action."""
    global _derived_previews
    if not path:
        return 0
    if _derived_previews is None:
        _derived_previews = bpy.utils.previews.new()
    try:
        key = f"{path}:{revision}"
        prefix = f"{path}:"
        for stale_key in [
            candidate for candidate in _derived_previews.keys()
            if candidate.startswith(prefix) and candidate != key
        ]:
            del _derived_previews[stale_key]
        if key not in _derived_previews:
            _derived_previews.load(key, path, "IMAGE")
        return _derived_previews[key].icon_id
    except (OSError, KeyError, RuntimeError) as error:
        print(
            f"blendlink addon: could not prepare derived thumbnail {path!r}: "
            f"{type(error).__name__}: {error}"
        )
        return 0


def _derived_preview_icon(path: str, revision: str = "") -> int:
    """Read a prepared icon without touching the file system from draw()."""
    if _derived_previews is None:
        return 0
    key = f"{path}:{revision}"
    try:
        return _derived_previews[key].icon_id if key in _derived_previews else 0
    except KeyError:
        return 0


def clear_derived_previews():
    global _derived_previews, _material_preview_token
    if _derived_previews is not None:
        bpy.utils.previews.remove(_derived_previews)
        _derived_previews = None
    _material_preview_token = None


class _BlendlinkPanelMixin:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = _DEFAULT_CATEGORY


class _BlendlinkScenePanelMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "scene"


class _BlendlinkWorldPanelMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "world"


class _BlendlinkObjectPanelMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "object"


class _BlendlinkMaterialPanelMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "material"


class _BlendlinkLightPanelMixin:
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "data"


def _web_light_objects(context) -> list:
    """Objects in this scene using the Light Data tab's current data-block."""
    light = getattr(context, "light", None)
    active = getattr(context, "object", None) or getattr(context, "active_object", None)
    if light is None and getattr(active, "type", None) == "LIGHT":
        light = getattr(active, "data", None)
    scene = getattr(context, "scene", None)
    if light is None or scene is None:
        return []
    objects = [
        obj for obj in getattr(scene, "objects", ())
        if getattr(obj, "type", None) == "LIGHT" and getattr(obj, "data", None) is light
    ]
    objects.sort(key=lambda obj: str(getattr(obj, "name", "Light")).casefold())
    if active in objects:
        objects.remove(active)
        objects.insert(0, active)
    return objects


def _web_light_outcome(diagnostic: dict) -> str:
    outcome = diagnostic.get("outcome")
    if outcome in {
        weblights.OUTCOME_EXACT,
        weblights.OUTCOME_APPROXIMATED,
        weblights.OUTCOME_BAKE_ONLY,
        weblights.OUTCOME_NOT_PUBLISHED,
    }:
        return outcome
    visibility = diagnostic.get("visibility") or {}
    if not visibility.get("exported", True):
        return weblights.OUTCOME_NOT_PUBLISHED
    if diagnostic.get("source_type") not in weblights.SUPPORTED_PUNCTUAL_TYPES:
        return weblights.OUTCOME_BAKE_ONLY
    return (
        weblights.OUTCOME_APPROXIMATED
        if diagnostic.get("status") == weblights.STATUS_APPROXIMATED
        else weblights.OUTCOME_EXACT
    )


def _web_light_number(value) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return f"{float(value):.6g}"


def _draw_web_area_light_mode(layout, obj) -> bool:
    """Draw the Area-light policy choice without rescanning validation."""
    if str(getattr(getattr(obj, "data", None), "type", "")).upper() != "AREA":
        return False
    authored_mode = obj.get(weblights.AREA_LIGHT_MODE_PROPERTY)
    enabled = authored_mode == weblights.AREA_LIGHT_MODE_THREE_RECT
    bake_only = authored_mode == weblights.AREA_LIGHT_MODE_BAKE_ONLY
    automatic = (
        authored_mode is None
        or authored_mode == weblights.AREA_LIGHT_MODE_AUTO
    )
    controls = layout.box()
    controls.label(text="Website Area Light", icon="LIGHT_AREA")
    choice = controls.operator_menu_enum(
        "blendlink.set_area_light_mode",
        "mode",
        text=(
            "Three Rect Area (Approximation)"
            if enabled else
            "Bake Only"
            if bake_only else
            "Automatic (Default)"
            if automatic else
            "Unknown Website Area Mode"
        ),
        icon="DOWNARROW_HLT",
    )
    choice.object_name = obj.name
    if enabled:
        _draw_wrapped(
            controls,
            "Adds a shadowless realtime RectAreaLight for live PBR "
            "materials. Baked artwork still uses Blender's original light.",
            icon="INFO",
        )
    elif automatic:
        _draw_wrapped(
            controls,
            "Publishes the supported rectangle subset for live PBR receivers; "
            "intentional unsupported controls stay bake-only with a named reason.",
            icon="INFO",
        )
    elif bake_only:
        _draw_wrapped(
            controls,
            "Keeps this Area light in baked artwork without adding a realtime "
            "website light.",
            icon="INFO",
        )
    else:
        controls.alert = True
        _draw_wrapped(
            controls,
            f"Unknown {weblights.AREA_LIGHT_MODE_PROPERTY} value "
            f"{authored_mode!r}; choose a supported mode.",
            icon="ERROR",
        )
    return True


class BLENDLINK_PT_web_light(_BlendlinkLightPanelMixin, bpy.types.Panel):
    """Explain the active Blender light's portable website consequence."""

    bl_idname = "BLENDLINK_PT_web_light"
    bl_label = "Blendlink Web Light"
    bl_order = 80

    @classmethod
    def poll(cls, context):
        return getattr(context, "light", None) is not None

    def draw(self, context):
        layout = self.layout
        objects = _web_light_objects(context)
        if not objects:
            _draw_wrapped(
                layout,
                "This light data-block is not linked to an object in the active scene, so it will not publish.",
                icon="INFO",
            )
            return

        obj = objects[0]
        if len(objects) > 1:
            layout.label(
                text=f"Shared by {len(objects)} objects · showing {obj.name}",
                icon="LINKED",
            )

        _draw_web_area_light_mode(layout, obj)

        diagnostic = validation.result().light_diagnostics.get(obj.name)
        if validation.is_dirty():
            row = layout.row(align=True)
            row.label(
                text="Updating web-light result…" if diagnostic is None else "From the last Web Check",
                icon="TIME",
            )
            row.operator("blendlink.refresh_checks", text="", icon="FILE_REFRESH")
        if diagnostic is None:
            _draw_wrapped(
                layout,
                "Blendlink is checking render visibility and portable light controls.",
                icon="INFO",
            )
            return

        outcome = _web_light_outcome(diagnostic)
        styles = {
            weblights.OUTCOME_EXACT: ("Exact Realtime Light", "CHECKMARK", False),
            weblights.OUTCOME_APPROXIMATED: ("Realtime · Web Approximation", "INFO", True),
            weblights.OUTCOME_BAKE_ONLY: ("Bake-only Light", "RENDER_STILL", True),
            weblights.OUTCOME_NOT_PUBLISHED: ("Not Published", "RESTRICT_RENDER_ON", False),
        }
        label, icon, alert = styles[outcome]
        status = layout.box()
        status.alert = alert
        status.label(text=label, icon=icon)

        source_type = str(diagnostic.get("source_type") or "Light").title()
        source_energy = _web_light_number(diagnostic.get("source_energy"))
        source_exposure = _web_light_number(diagnostic.get("source_exposure"))
        authored = status.column(align=True)
        authored.label(text=f"Blender · {source_type}")
        if source_energy is not None:
            authored.label(text=f"Energy · {source_energy}")
        if source_exposure is not None and float(diagnostic["source_exposure"]) != 0.0:
            authored.label(text=f"Exposure · {source_exposure} stops")

        intensity = _web_light_number(diagnostic.get("expected_web_intensity"))
        power = _web_light_number(diagnostic.get("expected_three_power"))
        if outcome in {weblights.OUTCOME_EXACT, weblights.OUTCOME_APPROXIMATED}:
            output = status.column(align=True)
            if intensity is not None:
                output.label(text=f"Website intensity · {intensity}", icon="WORLD")
            elif diagnostic.get("web_type") == "rectArea" and power is not None:
                output.label(
                    text="Website intensity · derived from power and final area",
                    icon="LIGHT_AREA",
                )
            else:
                output.label(text="Website intensity · resolved from light nodes", icon="NODETREE")
            if power is not None:
                output.label(text=f"Three.js power readout · {power}")

        reasons = tuple(diagnostic.get("reasons") or ())
        if reasons:
            explanation = layout.box()
            explanation.label(text="What changes on the web", icon="INFO")
            for reason in reasons:
                _draw_wrapped(explanation, reason)
        else:
            _draw_wrapped(status, diagnostic.get("detail", ""), icon="INFO")

        remedy = str(diagnostic.get("remedy") or "").strip()
        if remedy:
            action = layout.box()
            action.label(
                text=("Recommended next step" if outcome != weblights.OUTCOME_EXACT
                      else "Ready for the web"),
                icon="TOOL_SETTINGS" if outcome != weblights.OUTCOME_EXACT else "CHECKMARK",
            )
            _draw_wrapped(action, remedy)


class BLENDLINK_PT_main(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_main"
    bl_label = "Blendlink"

    def draw(self, context):
        layout = self.layout
        _draw_known_issues(layout)
        project = context.scene.blendlink_project
        if project.recipe_error:
            recipe_error = layout.box()
            recipe_error.alert = True
            recipe_error.label(text="Scene settings need correction", icon="ERROR")
            _draw_wrapped(recipe_error, project.recipe_error)
            _draw_wrapped(
                recipe_error,
                "Use a supported Bake Output or update the Blendlink version that authored this file.",
            )
        elif not project.configured and isinstance(
            context.scene.get(props.RECIPE_PROPERTY), str,
        ):
            loading = layout.box()
            loading.label(text="Loading saved Blendlink settings…", icon="TIME")
            return
        if not _draw_next_setup_step(layout, context, project):
            return

        _draw_handoff_alert(layout, context)
        status, icon, status_label = syncstatus.status()
        busy = syncrun.is_running()
        session = _PreviewSessionState()
        preview_current = session.current
        stale_preview = session.stale
        starting_preview = session.starting
        updating_preview = session.updating
        if busy:
            _fraction, running_label = syncrun.progress()
            headline = running_label or "Building website scene"
            headline_icon = "FILE_REFRESH"
        elif starting_preview:
            _fraction, running_label = previewrun.progress()
            headline = running_label or "Starting website preview"
            headline_icon = "PLAY"
        elif updating_preview:
            _fraction, running_label = previewrun.progress()
            headline = running_label or "Saved changes detected — updating preview"
            headline_icon = "FILE_REFRESH"
        elif preview_current and previewrun.update_error():
            headline = "Live preview update needs attention"
            headline_icon = "ERROR"
        elif preview_current and previewrun.is_watching():
            headline = (
                "Save to update the live preview"
                if status in {"NEEDS_SYNC", "UNSAVED_EDITS"}
                else "Live preview — updates when you save"
            )
            headline_icon = "REC"
        else:
            headline = {
                "IN_SYNC": "Website scene is current",
                "NEEDS_SYNC": "Scene has unpublished changes",
                "UNSAVED_EDITS": "Scene has unpublished changes",
                "NO_MANIFEST": "Ready for the first preview",
            }.get(status, status_label)
            headline_icon = "CHECKMARK" if status == "IN_SYNC" else icon
        publish = layout.box()
        heading = publish.row(align=True)
        heading.label(text=_shorten(headline, context, reserve=5), icon=headline_icon)
        heading.operator("blendlink.refresh_sync", text="", icon="FILE_REFRESH")
        root = syncstatus.project_root()
        if root is None and not busy and not starting_preview and not updating_preview:
            _draw_wrapped(
                publish,
                "No website is connected yet. Preview Website creates a private, reusable "
                "Three.js studio without adding files beside this .blend. Connect a website "
                "when you are ready to publish it.",
                icon="INFO",
            )

        if stale_preview:
            stale = publish.box()
            stale.alert = True
            stale.label(text="Preview belongs to another Blender file", icon="INFO")
            _draw_wrapped(
                stale,
                "Preview Website will stop the previous Blendlink session and start "
                "one for this saved file. An externally owned website server is never stopped.",
            )
            if previewrun.is_running():
                stale.operator(
                    "blendlink.stop_preview", text="Stop Previous Preview", icon="X",
                )

        if busy:
            fraction, progress_label = syncrun.progress()
            progress = publish.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(factor=fraction, type="BAR", text=progress_label or "Publishing")
            else:
                progress.label(text=f"{progress_label or 'Publishing'} ({fraction:.0%})", icon="FILE_REFRESH")
            progress.operator("blendlink.sync_cancel", text="", icon="X")
        elif starting_preview:
            fraction, progress_label = previewrun.progress()
            progress = publish.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(factor=fraction, type="BAR", text=progress_label or "Starting website")
            else:
                progress.label(text=f"{progress_label or 'Starting website'} ({fraction:.0%})", icon="PLAY")
            progress.operator("blendlink.stop_preview", text="", icon="X")
        elif updating_preview:
            fraction, progress_label = previewrun.progress()
            progress = publish.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(
                    factor=fraction,
                    type="BAR",
                    text=progress_label or "Updating from saved Blender scene",
                )
            else:
                progress.label(
                    text=f"{progress_label or 'Updating from saved Blender scene'} ({fraction:.0%})",
                    icon="FILE_REFRESH",
                )
            progress.operator("blendlink.stop_preview", text="", icon="X")
        else:
            latest_preview_finished = (
                previewrun.last_finished_at() if preview_current else 0
            )
            latest_runner = max(
                syncrun.last_finished_at(), latest_preview_finished,
            )
            sync_failed = (
                syncrun.last_finished_at() == latest_runner
                and syncrun.last_exit_code() not in (None, 0)
                and not syncrun.was_canceled()
            )
            preview_failed = (
                preview_current
                and previewrun.last_finished_at() == latest_runner
                and previewrun.last_exit_code() not in (None, 0)
                and not previewrun.was_canceled()
                and not previewrun.url()
            )
            if sync_failed or preview_failed:
                failure = publish.box()
                failure_header = failure.row(align=True)
                failure_header.alert = True
                failure_header.label(
                    text="Website preview failed" if preview_failed else "Website task failed",
                    icon="ERROR",
                )
                failure_header.operator(
                    "blendlink.open_preview_log" if preview_failed else "blendlink.open_sync_log",
                    text="Open Log",
                    icon="TEXT",
                )
                last_message = (
                    previewrun.last_message() if preview_failed else syncrun.last_message()
                )
                if last_message:
                    _draw_wrapped(failure, last_message)

            if preview_current and previewrun.update_error():
                failure = publish.box()
                failure.alert = True
                failure_header = failure.row(align=True)
                failure_header.label(
                    text="Update failed — last good preview is still open",
                    icon="ERROR",
                )
                failure_header.operator(
                    "blendlink.open_preview_log", text="Open Log", icon="TEXT",
                )
                _draw_wrapped(failure, previewrun.update_error())

            dominant = publish.column(align=True)
            dominant.scale_y = 1.55
            if previewrun.is_ready_for_current_file() and status == "IN_SYNC":
                dominant.operator("blendlink.open_preview", text="Open Website", icon="WORLD")
            else:
                dominant.operator(
                    "blendlink.browser_preview",
                    text=("Save & Update Live Preview" if preview_current and previewrun.is_watching() else
                          "Check & Update Website" if preview_current and previewrun.url() and not previewrun.owns_server() else
                          "Update Website Preview" if preview_current and previewrun.url() else
                          "Retry Website Preview" if preview_failed else "Preview Website"),
                    icon="FILE_REFRESH" if preview_current and previewrun.url() else "TRIA_RIGHT",
                )

        if preview_current and previewrun.url():
            address = publish.row(align=True)
            prefix = (
                "Live: " if previewrun.is_watching()
                else "Last detected: " if not previewrun.owns_server()
                else ""
            )
            address.label(
                text=_shorten(prefix + previewrun.url(), context, reserve=14), icon="URL",
            )
            if not previewrun.owns_server():
                address.operator("blendlink.open_preview", text="", icon="WORLD")
            address.operator("blendlink.copy_preview_url", text="", icon="COPYDOWN")
            if previewrun.is_watching() and not previewrun.is_updating():
                live = publish.row(align=True)
                live.label(text="Watching this saved .blend for changes", icon="REC")
                live.operator("blendlink.stop_preview", text="Stop", icon="X")

        if root is not None:
            actions = publish.column(align=True) if _is_compact(context) else publish.row(align=True)
            plan = actions.operator("blendlink.sync_now", text="Check Atlas Fit", icon="CHECKMARK")
            plan.quality = "PLAN"
            final = actions.operator("blendlink.sync_now", text="Publish Website", icon="EXPORT")
            final.quality = "FINAL"
            publish.menu("BLENDLINK_MT_workspace_tools", text="More Tools", icon="DOWNARROW_HLT")
        else:
            handoff = publish.row(align=True)
            handoff.operator(
                "blendlink.copy_connect_command", text="Copy Connect Command", icon="COPYDOWN",
            )
            guide = handoff.operator("wm.url_open", text="Guide", icon="HELP")
            guide.url = "https://github.com/michaelrowejones/Blendlink#quick-start"

        integrity = syncstatus.integrity_failures()
        if integrity:
            warning = layout.box()
            warning_header = warning.row(align=True)
            warning_header.alert = True
            warning_header.label(text="Published files changed outside Blendlink", icon="ERROR")
            _draw_wrapped(
                warning,
                "One or more website files are missing or no longer match the last build. "
                "Publish Website again before deploying the site.",
            )
            warning.operator("blendlink.open_sync_log", text="Open Build Log", icon="TEXT")
        rejected = syncstatus.manifest_rejections()
        if status == "NO_MANIFEST" and rejected:
            warning = layout.box()
            warning_header = warning.row(align=True)
            warning_header.alert = True
            warning_header.label(text="Last published result was rejected", icon="ERROR")
            _draw_wrapped(
                warning,
                "Blendlink found website output it could not safely use. Publish Website again to "
                "replace it; technical details are in Blender's console.",
            )

        counts = validation.result().counts
        if counts:
            role_labels = {
                "collider": ("collider", "colliders"),
                "rigid": ("rigid body", "rigid bodies"),
                "lod": ("LOD level", "LOD levels"),
                "noimp": ("excluded object", "excluded objects"),
                "socket": ("socket", "sockets"),
                "hotspot": ("hotspot", "hotspots"),
                "audio": ("audio anchor", "audio anchors"),
            }
            summary = "  ".join(
                f"{count} {role_labels.get(kind, (kind, kind + 's'))[count != 1]}"
                for kind, count in sorted(counts.items())
            )
            layout.label(
                text=_shorten(f"Web roles · {summary}", context),
                icon="OUTLINER_OB_GROUP_INSTANCE",
            )

        navigation = layout.column(align=True) if _is_compact(context) else layout.row(align=True)
        scene_settings = navigation.operator(
            "blendlink.open_properties_context", text="Scene & Atlases", icon="SCENE_DATA",
        )
        scene_settings.target = "SCENE"
        if context.active_object is not None:
            selection_count = len(getattr(context, "selected_editable_objects", ()) or ())
            object_settings = navigation.operator(
                "blendlink.open_properties_context",
                text=(f"Edit {selection_count} Selected" if selection_count > 1 else "Selected Object"),
                icon="OBJECT_DATA",
            )
            object_settings.target = "OBJECT"
        layout.prop(context.window_manager.blendlink, "show_overlay")


class BLENDLINK_MT_workspace_tools(bpy.types.Menu):
    bl_idname = "BLENDLINK_MT_workspace_tools"
    bl_label = "Blendlink Workspace Tools"

    def draw(self, context):
        layout = self.layout
        preview_current = _PreviewSessionState().current
        if preview_current and previewrun.is_watching():
            layout.label(text="Live Preview is watching saves", icon="REC")
        else:
            watch = layout.operator("blendlink.sync_now", text="Auto-build on Save", icon="REC")
            watch.quality = "WATCH"
        if previewrun.is_running():
            layout.operator(
                "blendlink.stop_preview",
                text=("Stop Website Preview" if preview_current
                      else "Stop Previous File Preview"),
                icon="X",
            )
        layout.separator()
        layout.operator("blendlink.open_workspace", text="Open Website Folder", icon="FILE_FOLDER")
        layout.operator("blendlink.open_sync_log", text="Open Build Log", icon="TEXT")
        layout.operator("blendlink.open_preview_log", text="Open Preview Log", icon="CONSOLE")
        if syncstatus.sync_hint():
            layout.operator("blendlink.copy_sync_hint", text="Copy Build Command", icon="COPYDOWN")
        if previewrun.is_ready_for_current_file():
            layout.operator("blendlink.copy_preview_url", text="Copy Preview URL", icon="URL")
        layout.separator()
        layout.label(text="Edit Settings", icon="PROPERTIES")
        scene_settings = layout.operator(
            "blendlink.open_properties_context", text="Scene & Atlases", icon="SCENE_DATA",
        )
        scene_settings.target = "SCENE"
        world_settings = layout.operator(
            "blendlink.open_properties_context", text="World & Environment", icon="WORLD_DATA",
        )
        world_settings.target = "WORLD"
        active = context.active_object
        if active is not None:
            object_settings = layout.operator(
                "blendlink.open_properties_context", text="Selected Object", icon="OBJECT_DATA",
            )
            object_settings.target = "OBJECT"
            if getattr(getattr(active, "data", None), "materials", None) is not None:
                material_settings = layout.operator(
                    "blendlink.open_properties_context", text="Active Material", icon="MATERIAL",
                )
                material_settings.target = "MATERIAL"


class BLENDLINK_UL_atlases(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_prop):
        row = layout.row(align=True)
        row.label(text=item.name, icon="TEXTURE")
        output = "Lighting" if item.bake_output == "LIGHTING" else "Appearance"
        evidence = _atlas_plan_result(item)
        occupancy = (
            f" · {float(evidence.get('occupancy', 0.0)):.0%}"
            if evidence is not None else ""
        )
        if _is_compact(context, 360):
            row.label(text=f"{output} · {item.size}px{occupancy}")
        else:
            row.label(text=output)
            row.label(text=f"{item.size}px{occupancy}")


class BLENDLINK_UL_states(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_prop):
        row = layout.row(align=True)
        row.label(text=item.name, icon="LIGHT")
        hidden = props.hidden_collection_names(item)
        if hidden:
            row.label(text=f"{len(hidden)} hidden", icon="HIDE_ON")
        else:
            row.label(text="Full scene", icon="HIDE_OFF")


class BLENDLINK_UL_compositions(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_prop):
        row = layout.row(align=True)
        row.label(text=item.name, icon="CAMERA_DATA")
        row.label(text=f"{item.width} x {item.height}")


class BLENDLINK_UL_reflection_probes(bpy.types.UIList):
    def draw_item(self, context, layout, data, item, icon, active_data, active_prop):
        row = layout.row(align=True)
        helper = item.probe_object
        row.label(text=item.name, icon="CUBE")
        if helper is None:
            row.label(text="Missing helper", icon="ERROR")
            return
        # Cached status keeps list drawing constant-time; expensive scene and
        # image hashes are prepared by the shared timer, never in draw().
        status = probe_authoring.status_for(item)
        icon_name = {
            "READY": "CHECKMARK", "RUNTIME": "TIME", "STALE": "ERROR",
            "ERROR": "CANCEL", "CHECKING": "FILE_REFRESH",
        }.get(status.code, "INFO")
        source = {"RUNTIME": "Live", "BAKED": "Bake", "CUSTOM": "Custom"}.get(
            probe_authoring.mode_of(item), "Live",
        )
        row.label(text=f"{source} · {item.resolution}px", icon=icon_name)


class BLENDLINK_PT_project(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_project"
    bl_label = "Blendlink Scene"
    bl_order = 0

    @classmethod
    def poll(cls, context):
        return getattr(context.scene, "blendlink_project", None) is not None

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        if not project.configured:
            if project.recipe_error:
                error = layout.box()
                error.alert = True
                error.label(text="Saved Blendlink settings need attention", icon="ERROR")
                _draw_wrapped(error, project.recipe_error)
                return
            if isinstance(context.scene.get(props.RECIPE_PROPERTY), str):
                layout.label(text="Loading saved Blendlink settings…", icon="TIME")
                return
            layout.label(text="This scene is not set up for Blendlink yet.", icon="INFO")
            layout.operator("blendlink.setup_website_export", icon="ADD")
            return

        layout.prop(project, "presentation", text="Publishing Mode")
        consequence = {
            "HYBRID": "Static art bakes; motion and transparency stay realtime.",
            "REALTIME": "Everything keeps realtime materials and lighting.",
            "BAKED": "Every eligible visible mesh is captured into textures.",
        }[project.presentation]
        box = layout.box()
        _draw_wrapped(box, consequence, icon="INFO")

        preview = layout.box()
        preview.label(text="Website Preview", icon="WORLD")
        session = _PreviewSessionState()
        preview_current = session.current
        stale_preview = session.stale
        action = preview.column(align=True)
        action.scale_y = 1.35
        if not bpy.data.filepath:
            action.operator(
                "wm.save_as_mainfile",
                text="Save Scene to Preview...",
                icon="FILE_TICK",
            )
            _draw_wrapped(
                preview,
                "Save once, then Blendlink can open a private Three.js preview directly from here.",
                icon="INFO",
            )
        elif syncrun.is_running():
            fraction, progress_label = syncrun.progress()
            progress = preview.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(
                    factor=fraction,
                    type="BAR",
                    text=progress_label or "Building website scene",
                )
            else:
                progress.label(
                    text=f"{progress_label or 'Building website scene'} ({fraction:.0%})",
                    icon="FILE_REFRESH",
                )
            progress.operator("blendlink.sync_cancel", text="", icon="X")
        elif session.starting:
            fraction, progress_label = previewrun.progress()
            progress = preview.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(
                    factor=fraction,
                    type="BAR",
                    text=progress_label or "Starting website preview",
                )
            else:
                progress.label(
                    text=f"{progress_label or 'Starting website preview'} ({fraction:.0%})",
                    icon="PLAY",
                )
            progress.operator("blendlink.stop_preview", text="", icon="X")
        elif session.updating:
            fraction, progress_label = previewrun.progress()
            progress = preview.row(align=True)
            if hasattr(progress, "progress"):
                progress.progress(
                    factor=fraction,
                    type="BAR",
                    text=progress_label or "Updating from saved Blender scene",
                )
            else:
                progress.label(
                    text=f"{progress_label or 'Updating from saved Blender scene'} ({fraction:.0%})",
                    icon="FILE_REFRESH",
                )
            progress.operator("blendlink.stop_preview", text="", icon="X")
        else:
            status, _status_icon, _status_label = syncstatus.status()
            if stale_preview:
                stale = preview.box()
                stale.alert = True
                stale.label(text="Preview belongs to another Blender file", icon="INFO")
                _draw_wrapped(
                    stale,
                    "Preview Website safely replaces the previous Blendlink session. "
                    "An externally owned website server stays running.",
                )
                if previewrun.is_running():
                    stale.operator(
                        "blendlink.stop_preview",
                        text="Stop Previous Preview",
                        icon="X",
                    )
            if preview_current and previewrun.update_error():
                failure = preview.box()
                failure.alert = True
                failure.label(
                    text="Update failed — last good preview is still open",
                    icon="ERROR",
                )
                _draw_wrapped(failure, previewrun.update_error())
                failure.operator(
                    "blendlink.open_preview_log", text="Open Preview Log", icon="TEXT",
                )
            if previewrun.is_ready_for_current_file() and status == "IN_SYNC":
                action.operator(
                    "blendlink.open_preview",
                    text="Open Website Preview",
                    icon="WORLD",
                )
            else:
                action.operator(
                    "blendlink.browser_preview",
                    text=("Save & Update Live Preview"
                          if preview_current and previewrun.is_watching()
                          else "Update Website Preview"
                          if preview_current and previewrun.url()
                          else "Preview Website"),
                    icon=("FILE_REFRESH"
                          if preview_current and previewrun.url()
                          else "TRIA_RIGHT"),
                )
            _draw_wrapped(
                preview,
                (
                    "Live Preview updates after every save and keeps the last good scene if an export fails."
                    if preview_current and previewrun.is_watching()
                    else "Uses the connected Three.js project."
                    if syncstatus.project_root() is not None
                    else "Private Preview Studio - no website project required."
                ),
                icon="INFO",
            )
            if preview_current and previewrun.is_watching():
                preview.operator(
                    "blendlink.stop_preview", text="Stop Live Preview", icon="X",
                )


class BLENDLINK_PT_ownership(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_ownership"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Website Ownership"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 90

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        _draw_wrapped(
            layout, "Every publishing decision has one visible owner.", icon="INFO",
        )
        ownership.draw_summary(layout, context.scene.blendlink_project)


class BLENDLINK_PT_camera(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_camera"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Website Camera & Frames"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 10

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(project, "main_camera")
        if project.main_camera is None:
            box = layout.box()
            box.label(text="No website camera designated.", icon="INFO")
            candidate = context.scene.camera
            if candidate is not None:
                use_camera = box.operator(
                    "blendlink.use_website_camera", text=f"Use Scene Camera · {candidate.name}",
                    icon="CAMERA_DATA",
                )
                use_camera.camera_name = candidate.name
            elif context.active_object is not None and context.active_object.type == "CAMERA":
                use_camera = box.operator(
                    "blendlink.use_website_camera", text=f"Use Selected Camera · {context.active_object.name}",
                    icon="CAMERA_DATA",
                )
                use_camera.camera_name = context.active_object.name
            else:
                _draw_wrapped(box, "Choose a camera above, or select one and make it the Scene Camera.")
            return
        controls.prop(project, "camera_behavior")
        controls.prop(project, "camera_framing")
        if project.camera_behavior == "ORBIT" or project.camera_framing == "FIT_TARGET":
            controls.prop(project, "camera_target")
        if project.camera_framing == "FIT_TARGET" and project.camera_target is None:
            warning = layout.box()
            warning.alert = True
            warning.label(text="Fit Target needs an Orbit Target.", icon="ERROR")
        consequence = {
            "FIXED": "The website preserves this authored view.",
            "ORBIT": "Visitors orbit the target from this starting view.",
            "FREE": "Visitors begin here, then move freely.",
        }[project.camera_behavior]
        _draw_wrapped(layout, consequence, icon="INFO")
        framing = {
            "AUTHORED": "First frame stays pixel-for-pixel at the authored camera transform.",
            "FIT_SCENE": "Install-time fit protects the nearest responsive frame's safe margins.",
            "FIT_TARGET": "Install-time fit protects the target and responsive safe margins.",
        }[project.camera_framing]
        _draw_wrapped(layout, framing, icon="CAMERA_DATA")
        if project.camera_framing != "AUTHORED":
            _draw_wrapped(
                layout,
                "The website integration applies this fit using its viewport bounds.",
                icon="INFO",
            )
        layout.label(text="Responsive Frames", icon="FULLSCREEN_ENTER")
        layout.template_list(
            "BLENDLINK_UL_compositions", "", project, "compositions",
            project, "composition_index", rows=max(2, min(4, len(project.compositions))),
        )
        buttons = layout.row(align=True)
        buttons.operator("blendlink.add_composition", text="Add Frame", icon="ADD")
        buttons.operator("blendlink.remove_composition", text="", icon="REMOVE")
        if len(project.compositions):
            frame = project.compositions[min(project.composition_index, len(project.compositions) - 1)]
            settings = layout.column()
            settings.use_property_split = True
            settings.use_property_decorate = False
            settings.prop(frame, "name")
            frame_name = frame.name.strip()
            duplicate_name = bool(frame_name) and sum(
                item.name.strip() == frame_name for item in project.compositions
            ) > 1
            if not frame_name or duplicate_name:
                warning = layout.box()
                warning.alert = True
                warning.label(
                    text=("Give this Responsive Frame a name."
                          if not frame_name else "Responsive Frame names must be unique."),
                    icon="ERROR",
                )
            size = settings.row(align=True)
            size.prop(frame, "width")
            size.prop(frame, "height")
            settings.prop(frame, "safe_margin")
            settings.label(
                text=f"Aspect {frame.width / max(1, frame.height):.3f} | page-safe inset {frame.safe_margin:.0%}",
                icon="CAMERA_DATA",
            )


class BLENDLINK_PT_playback(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_playback"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Animation"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 50

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(project, "animation_sequence_enabled")
        if project.animation_sequence_enabled:
            controls.prop(project, "animation_sequence_name")
            controls.prop(project, "animation_sequence_source")
            source = project.animation_sequence_source
            animation = getattr(source, "animation_data", None) if source is not None else None
            tracks = getattr(animation, "nla_tracks", None) if animation is not None else None
            if tracks and len(tracks):
                controls.prop_search(
                    project, "animation_sequence_track", animation, "nla_tracks",
                    text="NLA Track",
                )
            else:
                warning = layout.box()
                warning.alert = True
                warning.label(
                    text=("Choose an animated Source."
                          if source is None else "Source has no NLA tracks."),
                    icon="ERROR",
                )
            controls.prop(project, "animation_sequence_loop")
            controls.prop(project, "animation_sequence_speed", slider=True)
            controls.prop(project, "animation_sequence_easing")
            try:
                record = nla_sequence.collect_project_sequence(project, context.scene)
            except ValueError as error:
                warning = layout.box()
                warning.alert = True
                warning.label(text="Sequence cannot publish", icon="ERROR")
                _draw_wrapped(warning, str(error))
            else:
                strips = record["strips"]
                summary = layout.box()
                summary.label(
                    text=f"{len(strips)} strips | {record['duration']:.2f}s",
                    icon="NLA",
                )
                muted = sum(bool(strip["muted"]) for strip in strips)
                additive = sum(strip["blend"] == "add" for strip in strips)
                if muted or additive:
                    summary.label(
                        text=f"{muted} muted | {additive} additive",
                        icon="INFO",
                    )
                _draw_wrapped(
                    summary,
                    "Strip order, Action trims, scale, repeat, blend, extrapolation, "
                    "and reverse come from this NLA track.",
                )
            _draw_wrapped(
                layout,
                "Edit the timeline in Blender's NLA Editor. Blendlink publishes the "
                "selected track without creating a second animation state machine.",
                icon="ACTION",
            )
            return
        controls.prop(project, "animation_start")
        if project.animation_start == "MANUAL":
            _draw_wrapped(layout, "The page owns animation playback in code.", icon="PAUSE")
            if len(bpy.data.actions) == 0:
                layout.label(text="No Blender actions currently exist.", icon="INFO")
            return
        if project.animation_start == "NAMED":
            controls.prop_search(project, "animation_clip", bpy.data, "actions")
            if not project.animation_clip.strip():
                warning = layout.box()
                warning.alert = True
                warning.label(text="Choose a clip before publishing.", icon="ERROR")
        controls.prop(project, "animation_loop")
        controls.prop(project, "animation_speed", slider=True)
        consequence = {
            "FIRST": "The first exported clip starts when the scene loads.",
            "NAMED": f"{project.animation_clip or 'The named clip'} starts when the scene loads.",
            "ALL": "All exported clips start together; use only when they do not conflict.",
        }[project.animation_start]
        _draw_wrapped(layout, consequence, icon="PLAY")


class BLENDLINK_PT_look(_BlendlinkWorldPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_look"
    bl_label = "Blendlink Web World"
    bl_order = 0

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(project, "tone_mapping")
        if project.tone_mapping != "APPLICATION":
            controls.prop(project, "look_exposure")
            layout.label(
                text=f"Runtime exposure multiplier: {2 ** project.look_exposure:.3g}x",
                icon="LIGHT_SUN",
            )
        else:
            _draw_wrapped(
                layout, "The website keeps its tone mapping and exposure.", icon="INFO",
            )
        controls.prop(project, "background_mode")
        if project.background_mode == "COLOR":
            controls.prop(project, "background_color")
        consequence = {
            "APPLICATION": "The page keeps ownership of canvas compositing.",
            "TRANSPARENT": "The HTML/CSS background shows through the canvas.",
            "COLOR": "The 3D scene publishes a solid background color.",
        }[project.background_mode]
        _draw_wrapped(layout, consequence, icon="WORLD")
        if project.environment_background in {"IMAGE", "GROUNDED"}:
            _draw_wrapped(
                layout,
                "The HDR owns the visible backdrop, so the page background remains unchanged.",
                icon="INFO",
            )

        layout.separator()
        layout.label(text="Distance Fog", icon="MOD_FLUIDSIM")
        controls.prop(project, "fog_mode")
        if project.fog_mode in {"LINEAR", "EXPONENTIAL"}:
            controls.prop(project, "fog_color")
            _draw_wrapped(
                layout, "Fog fades rendered materials; the backdrop remains separate.", icon="INFO",
            )
            if project.background_mode == "COLOR" and any(
                    abs(project.fog_color[index] - project.background_color[index]) > 0.01
                    for index in range(3)):
                _draw_wrapped(
                    layout,
                    "Match Fog Color to the solid background for a seamless horizon.",
                    icon="ERROR",
                )
        if project.fog_mode == "LINEAR":
            controls.prop(project, "fog_near")
            controls.prop(project, "fog_far")
            if project.fog_far <= project.fog_near:
                warning = layout.box()
                warning.alert = True
                _draw_wrapped(
                    warning, "Fully Fogged At must be farther than Starts At.", icon="ERROR",
                )
            else:
                layout.label(
                    text=f"Clear for {project.fog_near:g} units, fully fogged by {project.fog_far:g}.",
                    icon="INFO",
                )
        elif project.fog_mode == "EXPONENTIAL":
            controls.prop(project, "fog_density")
            _draw_wrapped(layout, "Density is measured per Blender world unit.", icon="INFO")
        elif project.fog_mode == "NONE":
            _draw_wrapped(
                layout, "Installing this scene explicitly clears existing fog.", icon="INFO",
            )
        else:
            _draw_wrapped(layout, "The website keeps its existing fog unchanged.", icon="INFO")


class BLENDLINK_PT_environment(_BlendlinkWorldPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_environment"
    bl_parent_id = "BLENDLINK_PT_look"
    bl_label = "HDR Environment"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 10

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(project, "environment_source")
        if project.environment_source == "APPLICATION":
            _draw_wrapped(
                layout, "The website owns image-based lighting and backdrop assets.", icon="INFO",
            )
            return

        controls.prop(project, "environment_image")
        image = project.environment_image
        if image is None:
            warning = layout.box()
            warning.alert = True
            warning.label(text="Choose a Radiance HDR or OpenEXR image.", icon="ERROR")
        else:
            width, height = image.size[:]
            packed = "packed in blend" if image.packed_file else "linked file"
            layout.label(text=f"{image.file_format} | {width} x {height} | {packed}", icon="IMAGE_DATA")
            if image.file_format not in {"HDR", "OPEN_EXR", "OPEN_EXR_MULTILAYER"}:
                warning = layout.box()
                warning.alert = True
                _draw_wrapped(
                    warning, "Web environment publishing requires .hdr or .exr.", icon="ERROR",
                )

        controls.prop(project, "environment_lighting")
        if project.environment_lighting == "IMAGE":
            controls.prop(project, "environment_lighting_intensity")
            controls.prop(project, "environment_lighting_rotation")

        controls.prop(project, "environment_background")
        if project.environment_background == "IMAGE":
            controls.prop(project, "environment_background_intensity")
            controls.prop(project, "environment_background_rotation")
            controls.prop(project, "environment_background_blur", slider=True)
        if project.environment_background == "GROUNDED":
            controls.prop(project, "environment_background_rotation")
            controls.prop(project, "environment_ground_height")
            controls.prop(project, "environment_ground_radius")
            _draw_wrapped(
                layout,
                "The HDR horizon meets a web ground plane; no extra mesh exports.",
                icon="WORLD",
            )
        elif project.environment_background == "NONE":
            _draw_wrapped(
                layout, "The HDR can still light objects without being visible.", icon="HIDE_ON",
            )
        elif project.environment_background == "APPLICATION":
            _draw_wrapped(layout, "The page keeps its existing background.", icon="INFO")
        if project.background_mode != "APPLICATION":
            _draw_wrapped(
                layout,
                "The HDR backdrop is hidden because Website Look owns the background.",
                icon="INFO",
            )


class BLENDLINK_PT_reflection_probes(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_reflection_probes"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Reflection Probes"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 70

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        layout.template_list(
            "BLENDLINK_UL_reflection_probes", "", project, "reflection_probes",
            project, "reflection_probe_index", rows=max(2, min(4, len(project.reflection_probes))),
        )
        actions = layout.row(align=True)
        actions.operator(
            "blendlink.add_reflection_probe", text="Add Probe from Selection", icon="ADD",
        )
        actions.operator("blendlink.remove_reflection_probe", text="", icon="REMOVE")
        if not len(project.reflection_probes):
            box = layout.box()
            _draw_wrapped(
                box, "Select reflective meshes, then add a local probe.", icon="INFO",
            )
            _draw_wrapped(
                box, "Blendlink centers its visible influence volume and assigns them.",
            )
            return

        index = min(project.reflection_probe_index, len(project.reflection_probes) - 1)
        probe = project.reflection_probes[index]
        helper = probe.probe_object
        if helper is None:
            warning = layout.box()
            warning.alert = True
            _draw_wrapped(
                warning, "Probe helper was deleted. Remove or recreate this probe.", icon="ERROR",
            )
        else:
            header = layout.row(align=True)
            header.label(text=f"Helper: {helper.name}", icon="EMPTY_AXIS")
            select = header.operator("blendlink.select_issue", text="Select", icon="RESTRICT_SELECT_OFF")
            select.object_name = helper.name

        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(probe, "name")
        controls.prop(probe, "shape")
        controls.prop(probe, "influence")
        controls.prop(probe, "intensity")
        controls.prop(probe, "anchor")
        probe_slug = props._slug(probe.name)
        if sum(1 for candidate in project.reflection_probes
               if props._slug(candidate.name) == probe_slug) > 1:
            duplicate = layout.box()
            duplicate.alert = True
            duplicate.label(text="Duplicate reflection probe name", icon="ERROR")
            _draw_wrapped(
                duplicate, "Give each reflection probe a unique name before publishing.",
            )

        source_box = layout.box()
        source_box.label(text="Reflection Source", icon="SHADING_RENDERED")
        source_controls = source_box.column()
        source_controls.use_property_split = True
        source_controls.use_property_decorate = False
        source_controls.prop(probe, "capture_mode", text="Mode")
        mode = probe_authoring.mode_of(probe)
        if mode in {"RUNTIME", "BAKED"}:
            source_controls.prop(probe, "resolution")
        if mode == "BAKED":
            source_controls.prop(probe, "samples")
            resolution = int(probe.resolution)
            source_box.label(
                text=f"EXR panorama: {resolution * 4:,} x {resolution * 2:,}",
                icon="IMAGE_DATA",
            )
            bake_row = source_box.row(align=True)
            bake_row.scale_y = 1.35
            bake_row.operator(
                "blendlink.bake_reflection_probe", text="Bake Probe", icon="RENDER_RESULT",
            )
            bake_row.operator(
                "blendlink.bake_all_reflection_probes", text="Bake All", icon="RENDER_ANIMATION",
            )
            _draw_wrapped(
                source_box,
                "Bake All renders every probe first, then replaces the prior assets together.",
                icon="LOCKED",
            )
            _draw_wrapped(
                source_box,
                "Offline probe panoramas use Cycles even when Eevee owns the scene look. "
                "Blendlink rejects known Eevee-only Shader to RGB contributors; "
                "Custom Texture remains the exact artist-controlled fallback.",
                icon="INFO",
            )
            _draw_wrapped(
                source_box,
                "Bakes are managed derived files. Switch to Custom Texture before hand-editing one.",
            )
        elif mode == "CUSTOM":
            source_controls.prop(probe, "custom_image")
            _draw_wrapped(
                source_box,
                "Use a 2:1 equirectangular image. HDR or EXR preserves bright reflections; LDR is supported for graphic looks.",
                icon="INFO",
            )
        else:
            resolution = int(probe.resolution)
            source_box.label(
                text=f"6 x {resolution}px faces · {6 * resolution * resolution:,} pixels",
                icon="MATERIAL",
            )
            _draw_wrapped(
                source_box,
                "Three.js captures once after the scene loads. Fast to author, but it adds startup GPU work and cannot be CDN-cached.",
                icon="TIME",
            )

        status = probe_authoring.status_for(probe)
        status_box = layout.box()
        status_box.alert = status.severity in {"ERROR", "WARNING"}
        status_header = status_box.row(align=True)
        status_header.label(
            text=status.label,
            icon={
                "READY": "CHECKMARK", "RUNTIME": "TIME", "STALE": "ERROR",
                "ERROR": "CANCEL", "CHECKING": "FILE_REFRESH",
            }.get(status.code, "INFO"),
        )
        status_header.operator(
            "blendlink.refresh_reflection_probe_status", text="", icon="FILE_REFRESH",
        )
        _draw_wrapped(status_box, status.detail)
        evidence = status.evidence
        if evidence is not None and evidence.valid:
            status_box.label(
                text=f"{evidence.format.upper()} · {evidence.width} x {evidence.height} · {evidence.bytes:,} bytes",
                icon="IMAGE_DATA",
            )
            status_box.label(text=f"Content {evidence.content_hash}", icon="KEYTYPE_KEYFRAME_VEC")
        if status.image is not None:
            try:
                status_box.template_preview(status.image, show_buttons=False)
            except (AttributeError, RuntimeError) as error:
                print(
                    f"blendlink addon: could not draw reflection preview for "
                    f"{status.image.name!r}: {type(error).__name__}: {error}"
                )
        if evidence is not None and evidence.path:
            status_box.operator(
                "blendlink.open_reflection_probe_asset", text="Open Texture", icon="FILE_FOLDER",
            )

        consequence = layout.box()
        _draw_wrapped(
            consequence,
            "Assigned meshes use this local environment explicitly; influence volumes never silently reassign overlaps.",
            icon="INFO",
        )

        assignments = layout.row(align=True)
        assignments.operator("blendlink.assign_reflection_probe", text="Assign Selected", icon="LINKED")
        assignments.operator("blendlink.clear_reflection_probe", text="Use Scene Environment", icon="UNLINKED")
        layout.operator(
            "blendlink.select_reflection_probe_members",
            text="Select Assigned Meshes",
            icon="RESTRICT_SELECT_OFF",
        )


class BLENDLINK_PT_shadows(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_shadows"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Realtime Shadows"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 60

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        controls = layout.column()
        controls.use_property_split = True
        controls.use_property_decorate = False
        controls.prop(project, "shadow_preset")
        if project.shadow_preset == "APPLICATION":
            _draw_wrapped(
                layout, "The website keeps its renderer and light shadow settings.", icon="INFO",
            )
            return
        if project.shadow_preset == "OFF":
            _draw_wrapped(
                layout, "No realtime shadow maps are rendered for this scene.", icon="GHOST_DISABLED",
            )
            return
        if project.shadow_preset == "CUSTOM":
            controls.prop(project, "shadow_filter")
            controls.prop(project, "shadow_map_size")
            controls.prop(project, "shadow_max_distance")
            controls.prop(project, "shadow_bias")
            controls.prop(project, "shadow_normal_bias")
            controls.prop(project, "shadow_radius")
            controls.prop(project, "shadow_auto_update")
            _draw_wrapped(
                layout,
                "Higher resolution costs GPU memory once per shadow-casting light.",
                icon="INFO",
            )
            return
        filter_name, size, reach, bias, normal_bias, radius, auto_update = props._SHADOW_PRESETS[project.shadow_preset]
        descriptions = {
            "PERFORMANCE": "Fast hard-edged shadows for mobile-heavy scenes.",
            "BALANCED": "Filtered shadows with a moderate memory budget.",
            "SOFT": "Soft studio shadows; watch thin geometry for light leaks.",
            "CRISP": "High-resolution detail with a tight filtered edge.",
        }
        _draw_wrapped(layout, descriptions[project.shadow_preset], icon="LIGHT_SUN")
        box = layout.box()
        box.label(text=f"{size}px per light | {reach:g}m reach | {filter_name}")
        box.label(text=f"Bias {bias:g} | normal {normal_bias:g} | softness {radius:g}")
        box.label(text="Updates every frame" if auto_update else "Updates only when requested")


def _format_bytes(value):
    if not isinstance(value, (int, float)):
        return "-"
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.1f} MB"
    return f"{value / 1024:.0f} kB"


class BLENDLINK_PT_optimization(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_optimization"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Optimization"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 80

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        layout = self.layout
        project = context.scene.blendlink_project
        layout.prop(project, "geometry_optimization", text="Geometry")
        if project.geometry_optimization == "MESHOPT":
            box = layout.box()
            _draw_wrapped(
                box, "Preview and Final use the same Meshopt stage.", icon="CHECKMARK",
            )
            _draw_wrapped(box, "Geometry, morph targets, and animation are compressed.")
        else:
            _draw_wrapped(
                layout, "Uncompressed geometry · maximum loader compatibility", icon="INFO",
            )

        layout.separator()
        layout.prop(project, "texture_optimization")
        if project.texture_optimization == "KTX2":
            box = layout.box()
            _draw_wrapped(
                box, "Color → Compact · detail, data, and alpha → High Fidelity", icon="TEXTURE",
            )
            _draw_wrapped(box, "Every result is decoded, measured, and glTF-validated.")
            _draw_wrapped(box, "Baked lighting atlases stay PNG to protect mip backgrounds.")
            install = box.operator("wm.url_open", text="Get Free Khronos KTX Tools", icon="URL")
            install.url = "https://github.com/KhronosGroup/KTX-Software/releases"
        else:
            _draw_wrapped(
                layout, "Original image formats · no KTX2 runtime setup", icon="INFO",
            )

        stats = syncstatus.build_stats()
        if stats:
            layout.label(text="Last Published Build", icon="SPREADSHEET")
            rows = layout.column(align=True)
            rows.label(
                text=f"{_format_bytes(stats.get('bytes'))} | {stats.get('triangles', 0):,} triangles | "
                     f"~{stats.get('drawCallsEstimate', 0):,} draw calls",
            )
            rows.label(
                text=f"GPU textures {_format_bytes(stats.get('gpuTextureBytes'))} | "
                     f"animation {_format_bytes(stats.get('animationBytes'))}",
            )
            if stats.get("environmentBytes"):
                rows.label(text=f"Published HDR {_format_bytes(stats.get('environmentBytes'))}")
        report = syncstatus.optimization()
        if report and report.get("geometry") == "meshopt":
            saved = report.get("savedBytes", 0)
            result = layout.box()
            result.label(
                text=f"Meshopt: {_format_bytes(report.get('inputBytes'))} -> "
                     f"{_format_bytes(report.get('outputBytes'))}",
                icon="FILE_3D",
            )
            result.label(
                text=(f"Saved {_format_bytes(saved)}" if saved >= 0
                      else f"Increased by {_format_bytes(abs(saved))} (consider Off)"),
                icon="CHECKMARK" if saved >= 0 else "ERROR",
            )
            result.label(text=f"Verified bounds error: {report.get('maxBoundsError', 0):.6g}")
        texture_report = syncstatus.texture_compression()
        if texture_report:
            saved = texture_report.get("savedBytes", 0)
            result = layout.box()
            result.label(
                text=f"KTX2: {_format_bytes(texture_report.get('inputBytes'))} -> "
                     f"{_format_bytes(texture_report.get('outputBytes'))}",
                icon="TEXTURE",
            )
            result.label(
                text=(f"Saved {_format_bytes(saved)}" if saved >= 0
                      else f"Increased by {_format_bytes(abs(saved))}"),
                icon="CHECKMARK" if saved >= 0 else "INFO",
            )
            result.label(
                text=f"{len(texture_report.get('textures', []))} verified | "
                     f"{len(texture_report.get('skipped', []))} protected/skipped",
            )


def _atlas_plan_result(atlas):
    plan = syncstatus.bake_plan() or {}
    atlases = plan.get("atlases") or {}
    return (
        atlases.get(atlas.atlas_id)
        or atlases.get(atlas.name)
        or atlases.get(atlas.name.lower())
    )


def _draw_active_atlas_gpu_estimate(layout, plan):
    """Draw the plan's active-set upper bound without recomputing residency."""
    value = plan.get("estimatedActiveAtlasGpuBytesRgba8Mipmapped") \
        if isinstance(plan, dict) else None
    if not isinstance(value, (int, float)):
        return False
    layout.label(
        text=f"Active atlas GPU estimate · {_format_bytes(value)} · RGBA8 mipmapped",
        icon="TEXTURE",
    )
    return True


def _draw_atlas_plan_evidence(
    layout, atlas_name, evidence, *, context=None, show_fix=False,
):
    """One cached atlas summary: residency, worst composition, and actions.

    The compiler owns all calculations. Keeping this function presentation-only
    prevents the Scene and published-evidence panels from growing subtly
    different interpretations of the same plan.
    """
    if not isinstance(evidence, dict):
        return False
    context = context or bpy.context
    drew = False
    gpu_bytes = evidence.get("estimatedGpuBytesRgba8Mipmapped")
    if isinstance(gpu_bytes, (int, float)):
        layout.label(
            text=f"{atlas_name} GPU estimate · {_format_bytes(gpu_bytes)} · RGBA8 mipmapped",
            icon="TEXTURE",
        )
        drew = True

    detail = evidence.get("compositionDetail")
    if not isinstance(detail, dict):
        return drew
    worst = str(detail.get("worstObject", "")).strip()
    composition = str(detail.get("composition", "Composition")).strip() or "Composition"
    width = detail.get("cssWidth")
    height = detail.get("cssHeight")
    at_1x = detail.get("atlasTexelsPerCssPixelAt1x")
    at_2x = detail.get("atlasTexelsPerDevicePixelAt2x")
    if not worst or not isinstance(at_1x, (int, float)) \
            or not isinstance(at_2x, (int, float)):
        return drew

    evidence_box = layout.box()
    if at_1x < 1.0:
        evidence_box.alert = True
    frame = (
        f" · {int(width)}×{int(height)}"
        if isinstance(width, (int, float)) and isinstance(height, (int, float))
        else ""
    )
    evidence_box.label(
        text=f"Worst screen detail · {_shorten(worst, context, reserve=18)}",
        icon="ERROR" if at_1x < 1.0 else "INFO",
    )
    evidence_box.label(text=f"{_shorten(composition, context)}{frame}")
    evidence_box.label(
        text=f"{at_1x:.2f} atlas texels/CSS px · {at_2x:.2f}/device px at DPR 2",
    )
    if at_1x < 1.0:
        _draw_wrapped(
            evidence_box,
            "Fix: raise Resolution, move this object to a separate hero atlas, or reduce the declared output size.",
        )
    elif at_2x < 1.0:
        _draw_wrapped(
            evidence_box,
            "DPR 2 magnifies this atlas. Consider a higher-resolution or separate hero atlas.",
        )
    else:
        evidence_box.label(text="At least one atlas texel per DPR 2 device pixel.", icon="CHECKMARK")

    actions = evidence_box.row(align=True)
    compact = _is_compact(context, 330)
    select = actions.operator(
        "blendlink.select_issue",
        text="Select Worst" if compact else "Select Worst Object",
        icon="RESTRICT_SELECT_OFF",
    )
    select.object_name = worst
    if show_fix:
        fix = actions.operator(
            "blendlink.open_properties_context",
            text="Fix in Atlases" if compact else "Fix in Texture Atlases",
            icon="TOOL_SETTINGS",
        )
        fix.target = "SCENE"
    return True


def _draw_atlas_recipe(layout, project, context=None):
    context = context or bpy.context
    _draw_wrapped(
        layout,
        "Main receives baked meshes by default. Select meshes before adding an atlas to give them a separate detail budget.",
        icon="INFO",
    )
    plan = syncstatus.bake_plan() or {}
    _draw_active_atlas_gpu_estimate(layout, plan)
    layout.template_list(
        "BLENDLINK_UL_atlases", "", project, "atlases",
        project, "atlas_index", rows=max(2, min(5, len(project.atlases))),
    )
    row = layout.row(align=True)
    row.operator("blendlink.add_atlas", text="Add Atlas from Selection", icon="ADD")
    remove = row.row(align=True)
    remove.enabled = len(project.atlases) > 1 and project.atlas_index > 0
    remove.operator("blendlink.remove_atlas", text="", icon="REMOVE")
    if not len(project.atlases):
        return

    index = min(project.atlas_index, len(project.atlases) - 1)
    atlas = project.atlases[index]
    settings = layout.column()
    settings.use_property_split = True
    settings.use_property_decorate = False
    name_row = settings.row()
    name_row.enabled = index > 0
    name_row.prop(atlas, "name")
    atlas_name = "Main" if index == 0 else atlas.name.strip()
    duplicate_name = bool(atlas_name) and sum(
        ("Main" if item_index == 0 else item.name.strip()).casefold()
        == atlas_name.casefold()
        for item_index, item in enumerate(project.atlases)
    ) > 1
    if not atlas_name or duplicate_name:
        warning = layout.box()
        warning.alert = True
        warning.label(
            text=("Give this Atlas a name."
                  if not atlas_name else "Atlas names must be unique."),
            icon="ERROR",
        )
    settings.prop(atlas, "size")
    settings.prop(atlas, "target_density", text="Minimum Detail (px/m)")
    _draw_wrapped(
        settings,
        "Validation floor only. Packing still uses the available atlas area.",
    )
    settings.prop(atlas, "margin")
    settings.prop(atlas, "fit_policy")
    settings.prop(atlas, "bake_output")

    membership = layout.column(align=True) if _is_compact(context, 330) else layout.row(align=True)
    move = membership.operator(
        "blendlink.set_atlas",
        text="Move Selection to Main" if index == 0 else "Move Selection Here",
        icon="LINKED",
    )
    move.atlas = "__AUTO__" if index == 0 else atlas.atlas_id
    select = membership.operator(
        "blendlink.select_authored_atlas_members",
        text="Select Assigned Meshes",
        icon="RESTRICT_SELECT_OFF",
    )
    select.atlas_id = atlas.atlas_id
    if index > 0:
        move_main = layout.operator(
            "blendlink.set_atlas", text="Move Selection to Main", icon="UNLINKED",
        )
        move_main.atlas = "__AUTO__"

    consequence = layout.box()
    if atlas.bake_output == "LIGHTING":
        consequence.label(text="Baked lighting, live materials", icon="LIGHT")
        _draw_wrapped(
            consequence,
            "Preserves material detail and reflections while capturing indirect light and grounding.",
        )
    else:
        consequence.label(text="Finished appearance", icon="IMAGE_DATA")
        _draw_wrapped(
            consequence,
            "Captures the final stylized look when realtime PBR cannot reproduce it faithfully.",
        )
    if index == 0:
        consequence.label(text="Main is the permanent default atlas.", icon="LOCKED")

    evidence = _atlas_plan_result(atlas)
    result = layout.box()
    if evidence is None:
        result.label(text="Capacity has not been checked yet.", icon="INFO")
    else:
        occupancy = float(evidence.get("occupancy", 0.0))
        result.label(text=f"Last check · {occupancy:.0%} full", icon="SPREADSHEET")
        required = evidence.get("requiredOccupancy")
        achievement = evidence.get("targetAchievement")
        if isinstance(required, (int, float)) and required > 1.0:
            result.alert = True
            _draw_wrapped(
                result,
                f"Needs {required:.0%} capacity at the minimum detail. Increase resolution, move meshes, or lower Minimum Detail.",
                icon="ERROR",
            )
        elif isinstance(achievement, (int, float)) and achievement < 0.999:
            result.alert = True
            _draw_wrapped(
                result,
                f"This atlas currently reaches {achievement:.0%} of the minimum detail.",
                icon="ERROR",
            )
        else:
            result.label(text="Target detail is preserved.", icon="CHECKMARK")
        _draw_atlas_plan_evidence(
            result, atlas_name, evidence, context=context,
        )
        if syncstatus.status()[0] != "IN_SYNC":
            result.label(text="From the last check · run again to refresh", icon="TIME")
    check = layout.operator("blendlink.sync_now", text="Check Atlas Fit", icon="CHECKMARK")
    check.quality = "PLAN"


def _draw_bake_quality_recipe(layout, project):
    quality = layout.column()
    quality.use_property_split = True
    quality.use_property_decorate = False
    quality.prop(project, "preview_samples")
    quality.prop(project, "preview_scale")
    quality.prop(project, "final_samples")
    quality.prop(project, "final_supersample")
    quality.prop(project, "final_denoise")
    _draw_wrapped(
        layout,
        "Preview Website favors iteration speed. Publish Website uses the full Final sample and resolution settings.",
        icon="INFO",
    )


def _draw_lighting_states_recipe(layout, project):
    _draw_wrapped(
        layout,
        "States bake alternate visibility setups into the same atlas layout, so the website can switch lighting without repacking UVs.",
        icon="INFO",
    )
    layout.template_list(
        "BLENDLINK_UL_states", "", project, "states",
        project, "state_index", rows=max(1, min(4, len(project.states))),
    )
    state_buttons = layout.row(align=True)
    state_buttons.operator("blendlink.add_state", text="Add State", icon="ADD")
    remove = state_buttons.row(align=True)
    remove.enabled = len(project.states) > 1
    remove.operator("blendlink.remove_state", text="", icon="REMOVE")
    if len(project.states):
        state = project.states[min(project.state_index, len(project.states) - 1)]
        state_settings = layout.column()
        state_settings.use_property_split = True
        state_settings.use_property_decorate = False
        state_settings.prop(state, "name")
        state_name = state.name.strip()
        duplicate_name = bool(state_name) and sum(
            item.name.strip() == state_name for item in project.states
        ) > 1
        if not state_name or duplicate_name:
            warning = layout.box()
            warning.alert = True
            warning.label(
                text=("Give this Lighting State a name."
                      if not state_name else "Lighting State names must be unique."),
                icon="ERROR",
            )
        hidden = props.hidden_collection_names(state)
        collections = layout.box()
        collections.label(text="Hidden Collections", icon="OUTLINER_COLLECTION")
        if not hidden:
            _draw_wrapped(
                collections,
                "No collections are hidden. This state bakes the full scene.",
                icon="INFO",
            )
        for collection_name in hidden:
            row = collections.row(align=True)
            collection = props.scene_collection_by_name(context.scene, collection_name)
            collection_editable = collection is not None and getattr(collection, "is_editable", True)
            select = row.operator(
                "blendlink.select_state_collection_objects",
                text=collection_name,
                icon=("OUTLINER_COLLECTION" if collection_editable else
                      "LINKED" if collection is not None else "ERROR"),
            )
            select.collection_name = collection_name
            remove_collection = row.operator(
                "blendlink.remove_state_hidden_collection", text="", icon="X",
            )
            remove_collection.collection_name = collection_name
            if collection is not None and not collection_editable:
                row.label(text="fixed by linked source", icon="INFO")
        collections.operator(
            "blendlink.add_state_hidden_collection",
            text="Add Hidden Collection",
            icon="ADD",
        )


class BLENDLINK_PT_atlases(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_atlases"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Texture Atlases"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 20

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        _draw_atlas_recipe(self.layout, context.scene.blendlink_project, context)


class BLENDLINK_PT_bake_quality(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_bake_quality"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Bake Quality"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 30

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        _draw_bake_quality_recipe(self.layout, context.scene.blendlink_project)


class BLENDLINK_PT_lighting_states(_BlendlinkScenePanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_lighting_states"
    bl_parent_id = "BLENDLINK_PT_project"
    bl_label = "Lighting States"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 40

    @classmethod
    def poll(cls, context):
        project = getattr(context.scene, "blendlink_project", None)
        return project is not None and project.configured

    def draw(self, context):
        _draw_lighting_states_recipe(self.layout, context.scene.blendlink_project)


class BLENDLINK_PT_tag(_BlendlinkObjectPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_tag"
    bl_parent_id = "BLENDLINK_PT_designation"
    bl_label = "Semantic Designation"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 10

    @classmethod
    def poll(cls, context):
        obj = getattr(context, "object", None) or context.active_object
        return bool(
            obj is not None
            and obj in (getattr(context, "selected_editable_objects", ()) or ())
        )

    def draw(self, context):
        layout = self.layout
        selected = len(getattr(context, "selected_editable_objects", ()) or ())
        layout.label(
            text=f"Selection · {selected} object{'s' if selected != 1 else ''}",
            icon="RESTRICT_SELECT_OFF",
        )
        column = layout.column(align=True)
        column.operator_menu_enum("blendlink.tag_collider", "kind", icon="MESH_ICOSPHERE")
        column.operator("blendlink.tag_rigid", icon="RIGID_BODY")
        column.operator("blendlink.set_lod", icon="MOD_DECIM")
        column.operator("blendlink.clear_tag", icon="X")
        layout.separator()
        layout.label(text="This Object", icon="OBJECT_DATA")
        anchor = layout.operator_menu_enum(
            "blendlink.add_anchor", "kind", text="Add Anchor to This Object",
            icon="EMPTY_ARROWS",
        )
        pinned = getattr(context, "object", None)
        anchor.parent_name = pinned.name if pinned is not None else ""


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
            f"the generated helper can switch levels by camera distance"
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


def _role_heading(classification, selection_count: int) -> str:
    label = "No special web role" if classification is None else _ROLE_UI.get(
        classification.kind, ("OBJECT_DATA", classification.kind),
    )[1]
    return f"This Object Role · {label}" if selection_count > 1 else label


class BLENDLINK_PT_designation(_BlendlinkObjectPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_designation"
    bl_label = "Blendlink Web Object"
    bl_order = 0

    @classmethod
    def poll(cls, context):
        return getattr(context, "object", None) is not None or context.active_object is not None

    def draw(self, context):
        layout = self.layout
        obj = getattr(context, "object", None) or context.active_object
        selection = _selected_for_ui(context, obj)
        summaries = ui_state.summarize_selection(selection)
        extras = {key: obj[key] for key in obj.keys()}
        classification = vocab.classify(obj.name, extras)

        identity = layout.box()
        identity.label(text=obj.name, icon="OBJECT_DATA")
        if obj not in getattr(context, "selected_editable_objects", ()):
            _draw_wrapped(
                identity,
                "This Properties editor is pinned to an object outside the editable selection. Select it before changing Blendlink settings.",
                icon="PINNED",
            )
            select = identity.operator(
                "blendlink.select_issue", text="Select This Object", icon="RESTRICT_SELECT_OFF",
            )
            select.object_name = obj.name
            return
        inclusion = summaries["inclusion"]
        if inclusion["total"] > 1:
            identity.label(text=f"Website Inclusion · {inclusion['total']} selected")
            inclusion_actions = (
                identity.column(align=True) if _is_compact(context, 250)
                else identity.row(align=True)
            )
            include = inclusion_actions.operator(
                "blendlink.set_export_inclusion", text="Include", icon="CHECKBOX_HLT",
                depress=inclusion["value"] == "INCLUDED",
            )
            include.include = True
            exclude = inclusion_actions.operator(
                "blendlink.set_export_inclusion", text="Exclude", icon="CHECKBOX_DEHLT",
                depress=inclusion["value"] == "EXCLUDED",
            )
            exclude.include = False
            if inclusion["value"] == ui_state.MIXED:
                identity.label(
                    text="Mixed · " + _counts_text(
                        inclusion, {"INCLUDED": "included", "EXCLUDED": "excluded"},
                    ),
                    icon="INFO",
                )
        else:
            excluded = inclusion["value"] == "EXCLUDED"
            identity.label(text="Website Inclusion")
            inclusion_actions = identity.row(align=True)
            include = inclusion_actions.operator(
                "blendlink.set_export_inclusion", text="Include",
                icon="CHECKBOX_HLT", depress=not excluded,
            )
            include.include = True
            exclude = inclusion_actions.operator(
                "blendlink.set_export_inclusion", text="Exclude",
                icon="CHECKBOX_DEHLT", depress=excluded,
            )
            exclude.include = False

        # A mixed inclusion batch has no honest downstream bake state. Ask the
        # artist to resolve that decision before presenting batch rendering knobs.
        if inclusion["value"] == ui_state.MIXED:
            _draw_wrapped(layout, "Choose Include or Exclude before editing this selection's web rendering.")
            return

        if classification is None:
            layout.label(text=_role_heading(classification, len(selection)), icon="OBJECT_DATA")
            _draw_atlas_controls(
                layout, obj, context, selection=selection, summaries=summaries,
            )
            _draw_runtime_controls(
                layout, obj, context, selection=selection, summaries=summaries,
            )
            return
        icon, label = _ROLE_UI.get(classification.kind, ("OBJECT_DATA", classification.kind))
        header = layout.row(align=True)
        header.label(text=_role_heading(classification, len(selection)), icon=icon)
        if isinstance(extras.get(vocab.ROLE_PROPERTY), str):
            header.label(text="(set by property)", icon="PROPERTIES")

        text = describe(classification)
        box = layout.box()
        _draw_wrapped(box, text)

        # Excluded objects have no shading or atlas consequence. Keeping those
        # controls visible implies that an omitted object still consumes bake
        # budget, making the direct inclusion toggle self-contradictory.
        if classification.kind == "noimp":
            return

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
        _draw_atlas_controls(
            layout, obj, context, selection=selection, summaries=summaries,
        )
        _draw_runtime_controls(
            layout, obj, context, selection=selection, summaries=summaries,
        )


def _images_for_object(obj):
    images = []
    seen = set()
    for slot in getattr(obj, "material_slots", []):
        material = slot.material
        tree = bakelib.active_shader_node_tree(material)
        if tree is None:
            continue
        for node in tree.nodes:
            image = getattr(node, "image", None)
            if node.type == "TEX_IMAGE" and image is not None and image.name not in seen:
                seen.add(image.name)
                images.append((image, material.name))
    return images


def _images_for_material(material):
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return []
    images = []
    seen = set()
    for node in tree.nodes:
        image = getattr(node, "image", None)
        if node.type == "TEX_IMAGE" and image is not None and image.name not in seen:
            seen.add(image.name)
            images.append((image, material.name))
    return images


def prepare_active_material_previews(context=None) -> bool:
    """Prepare active-material thumbnails from the shared timer, never draw()."""
    global _material_preview_token
    context = context or bpy.context
    material = getattr(context, "material", None)
    if material is None:
        active = getattr(context, "active_object", None)
        material = getattr(active, "active_material", None) if active is not None else None
    images = _images_for_material(material)
    token = (
        material.as_pointer() if material is not None else None,
        tuple(image.as_pointer() for image, _material_name in images),
    )
    if token == _material_preview_token:
        return False
    prepared = False
    complete = True
    for image, _material_name in images:
        try:
            image.preview_ensure()
            prepared = True
        except (AttributeError, RuntimeError) as error:
            complete = False
            print(
                f"blendlink addon: could not prepare thumbnail for {image.name!r}: "
                f"{type(error).__name__}: {error}"
            )
    # A preview can fail transiently while Blender updates an image. Only a
    # fully successful pass is safe to memoize; otherwise the next timer tick
    # must retry instead of leaving a permanent placeholder in Material UI.
    if complete:
        _material_preview_token = token
    return prepared


def _draw_material_compatibility(layout, result):
    """Draw the cached, non-mutating stock glTF material contract."""
    status = result.get("status", "approximated")
    box = layout.box()
    box.alert = status == "needsBake"
    header = box.row(align=True)
    header.label(
        text=result.get("label", "Checking glTF compatibility"),
        icon={
            "exact": "CHECKMARK",
            "approximated": "INFO",
            "needsBake": "ERROR",
        }.get(status, "INFO"),
    )
    _draw_wrapped(box, result.get("summary", ""))
    for reason in result.get("reasons", [])[:4]:
        _draw_wrapped(box, reason, icon="DOT")
    compilation = result.get("materialCompilation") or {}
    if compilation.get("intent") == "tslProgram":
        program_box = box.box()
        program_box.alert = compilation.get("outcome") == "blocked"
        program_box.label(
            text={
                "lowered": "TSL Program ready to compile",
                "blocked": "TSL Program needs attention",
                "preserved": "TSL Program has no proven channel",
            }.get(compilation.get("outcome"), "TSL Program"),
            icon={
                "lowered": "CHECKMARK", "blocked": "ERROR",
                "preserved": "INFO",
            }.get(compilation.get("outcome"), "NODETREE"),
        )
        for entry in (compilation.get("channels") or {}).get("channels", ())[:8]:
            route = entry.get("route")
            detail = (
                "translates to a program" if route == "program" else "refused"
            )
            _draw_wrapped(
                program_box,
                f'{entry.get("channel", "?")}: {detail}',
                icon="DOT" if route == "program" else "ERROR",
            )
        program_box.operator(
            "blendlink.toggle_tsl_program",
            text="Disable TSL Program",
            icon="X",
        )
    if compilation.get("intent") == "materialBake":
        bake_box = box.box()
        bake_box.alert = compilation.get("outcome") == "blocked"
        bake_box.label(
            text={
                "lowered": "Material Bake ready to compile",
                "blocked": "Material Bake needs attention",
            }.get(compilation.get("outcome"), "Material Bake"),
            icon={
                "lowered": "CHECKMARK", "blocked": "ERROR",
            }.get(compilation.get("outcome"), "TEXTURE"),
        )
        for entry in (compilation.get("channels") or {}).get("channels", ())[:8]:
            route = entry.get("route")
            if route == "factor":
                detail = "stays a factor"
            elif route == "factor-over-carrier":
                detail = "factor over the alpha carrier"
            elif route == "bake":
                size = entry.get("resolution")
                size_label = f" {size}px" if isinstance(size, int) else ""
                detail = f'bakes{size_label} ({entry.get("uv", "tile")})'
            elif route == "passthrough":
                detail = "passes through untouched"
            else:
                detail = "refused"
            _draw_wrapped(
                bake_box,
                f'{entry.get("channel", "?")}: {detail}',
                icon="DOT" if route != "refused" else "ERROR",
            )
        bake_box.operator(
            "blendlink.toggle_material_bake",
            text="Disable Material Bake",
            icon="X",
        )
    if status == "needsBake":
        cycles_appearance = result.get("cyclesAppearance") or {}
        if compilation.get("intent") != "materialBake":
            box.operator(
                "blendlink.toggle_material_bake",
                text="Material Bake — keep it lit",
                icon="TEXTURE",
            )
        if compilation.get("intent") not in {"materialBake", "tslProgram"}:
            # Deliberately NOT gated on needsBake alone elsewhere: unlike
            # the bake row this one is also drawn from the route list
            # below for exact materials, where a program is still a
            # texture-for-ALU trade. Here it rides the needsBake block
            # beside the bake offer.
            box.operator(
                "blendlink.toggle_tsl_program",
                text="TSL Program — translate the nodes",
                icon="NODETREE",
            )
        if cycles_appearance.get("status") == "blocked":
            for blocker in cycles_appearance.get("blockers", []):
                _draw_wrapped(box, blocker, icon="ERROR")
            _draw_wrapped(
                box,
                "Simplify to portable material inputs, use a proven EEVEE materialization route, "
                "or provide an application-owned runtime material.",
                icon="LIGHT",
            )
        else:
            _draw_wrapped(
                box,
                "Use a Material Bake to keep the surface lit, an Appearance "
                "bake for a deliberately flattened look, simplify the active "
                "shader branch, or author a website runtime material.",
                icon="LIGHT",
            )
    elif status == "exact":
        _draw_wrapped(
            box,
            "Exact refers to material parameters; Blender and Three.js lighting can still look different.",
            icon="INFO",
        )


def _draw_web_material_source(layout, result):
    """Draw the compiler-owned selected-field contract from cached evidence."""
    compilation = result.get("materialCompilation") or {}
    outcome = compilation.get("outcome", "preserved")
    box = layout.box()
    box.alert = outcome == "blocked"
    header = box.row(align=True)
    header.label(
        text={
            "lowered": "Website Color ready to compile",
            "blocked": "Website Color needs attention",
        }.get(outcome, "Website Color (optional)"),
        icon={"lowered": "CHECKMARK", "blocked": "ERROR"}.get(outcome, "NODE_MATERIAL"),
    )
    source = compilation.get("colorSource") or {}
    if source:
        _draw_wrapped(
            box,
            f'{source.get("node", "Source")} / {source.get("socket", "Color")} '
            f'\u2192 {compilation.get("transport", "compiler")}',
            icon="LINKED",
        )
    response = compilation.get("surfaceResponse")
    if response in {"lit", "unlit"}:
        _draw_wrapped(
            box,
            "Website lighting: "
            + ("Lit (receives lights and shadows)" if response == "lit"
               else "Unlit (color is lighting-independent)"),
            icon="LIGHT",
        )
    for limitation in compilation.get("limitations", []):
        _draw_wrapped(box, limitation, icon="INFO")
    for issue in compilation.get("issues", []):
        _draw_wrapped(box, issue.get("problem", "Website material compilation blocked."), icon="ERROR")
        _draw_wrapped(box, issue.get("fix", "Choose another source or clear the selection."), icon="LIGHT")

    actions = box.row(align=True)
    set_source = actions.operator(
        "blendlink.set_web_material_source",
        text="Use Active Node Output",
        icon="EYEDROPPER",
    )
    set_source.semantic = "COLOR"
    clear = actions.operator(
        "blendlink.clear_web_material_source",
        text="Clear",
        icon="X",
    )
    clear.semantic = "ALL"
    if outcome == "lowered" and compilation.get("alphaSource"):
        alpha = compilation["alphaSource"]
        _draw_wrapped(
            box,
            f'Alpha: {alpha.get("node", "Source")} / {alpha.get("socket", "Alpha")}',
            icon="IMAGE_ALPHA",
        )
    alpha_action = box.operator(
        "blendlink.set_web_material_source",
        text="Use Active Node Output for Alpha",
        icon="IMAGE_ALPHA",
    )
    alpha_action.semantic = "ALPHA"


class BLENDLINK_PT_textures(_BlendlinkMaterialPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_textures"
    bl_label = "Blendlink Web Material"
    bl_order = 1

    @classmethod
    def poll(cls, context):
        material = getattr(context, "material", None)
        if material is not None:
            return True
        obj = context.active_object
        return obj is not None and getattr(obj, "active_material", None) is not None

    def draw(self, context):
        layout = self.layout
        material = getattr(context, "material", None)
        if material is None and context.active_object is not None:
            material = context.active_object.active_material
        compatibility = validation.result().material_compatibility.get(material.name)
        if compatibility is not None:
            _draw_material_compatibility(layout, compatibility)
            _draw_web_material_source(layout, compatibility)
        else:
            checking = layout.box()
            checking.label(text="Checking glTF material compatibility…", icon="TIME")
            _draw_wrapped(
                checking,
                "Blendlink checks only the active Surface branch; unused scratch nodes are ignored.",
            )
        images = _images_for_material(material)
        if not images:
            layout.label(text="No image textures in this material.", icon="INFO")
            return
        for image, material_name in images:
            box = layout.box()
            compact = _is_compact(context, 360)
            if compact:
                preview = box.column(align=True)
                info = box.column(align=True)
            else:
                split = box.split(factor=0.24)
                preview = split.column()
                info = split.column(align=True)
            preview_data = getattr(image, "preview", None)
            icon_id = int(getattr(preview_data, "icon_id", 0) or 0)
            if icon_id:
                preview.template_icon(
                    icon_value=icon_id,
                    scale=2.25 if compact else 3.0,
                )
            else:
                preview.label(text="", icon="IMAGE_DATA")
            info.label(text=_shorten(image.name, context), icon="IMAGE_DATA")
            info.label(text=f"{int(image.size[0])} x {int(image.size[1])} | {material_name}")
            info.label(text=f"Color space: {image.colorspace_settings.name}")
            if image.users > 1:
                info.label(
                    text=f"Shared image asset · {image.users} Blender users",
                    icon="LINKED",
                )
            image_editable = getattr(image, "is_editable", True)
            limit = image.get("blendlink_max_size")
            label = f"Published Max: {int(limit)} px" if isinstance(limit, (int, float)) else "Published Max: Original"
            limit_row = info.row()
            limit_row.enabled = image_editable
            operator = limit_row.operator_menu_enum(
                "blendlink.set_texture_max_size", "max_size", text=label, icon="FULLSCREEN_EXIT",
            )
            operator.image_name = image.name
            compression = image.get("blendlink_texture_compression")
            compression_label = {
                "none": "Compression: Uncompressed",
                "etc1s": "Compression: Compact",
                "uastc": "Compression: High Fidelity",
            }.get(compression, "Compression: Scene Default")
            compression_row = info.row()
            compression_row.enabled = image_editable
            compression_operator = compression_row.operator_menu_enum(
                "blendlink.set_texture_compression", "mode",
                text=compression_label, icon="TEXTURE_DATA",
            )
            compression_operator.image_name = image.name
            if not image_editable:
                info.label(text="Linked image · make local to edit publish settings", icon="LINKED")
            published = syncstatus.texture_transform(image.name)
            if published:
                info.label(
                    text=f"Last build: {published.get('publishedWidth')} x "
                         f"{published.get('publishedHeight')} | "
                         f"{_format_bytes(published.get('outputBytes'))}",
                    icon="CHECKMARK",
                )
            compressed = syncstatus.texture_compression_for(image.name)
            if compressed:
                info.label(
                    text=f"{compressed.get('codec', '').upper()} | "
                         f"{compressed.get('psnr', 0):.1f} dB | "
                         f"{_format_bytes(compressed.get('outputBytes'))}",
                    icon="CHECKMARK",
                )


def density_summary(entry, plan=None) -> list[str]:
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
    if share and plan:
        atlas_name = entry.get("atlas", "main")
        atlas = (plan.get("atlases") or {}).get(atlas_name, {})
        size = atlas.get("size", plan.get("atlasSize"))
        if isinstance(size, (int, float)) and size > 0:
            texels = int(round(float(share) * float(size) * float(size)))
            square = int(round(texels ** 0.5))
            lines.append(f"~{texels:,} atlas texels (about {square}x{square} square)")
    screen = entry.get("screenDensity")
    if screen:
        auto = entry.get("autoWeight", 1.0)
        auto_text = f" · auto {auto:g}x" if auto != 1.0 else ""
        lines.append(f"screen density {screen:.0f}{auto_text}")
    return lines


def _cached_rendering_analysis(obj):
    """Return only fresh validation facts; never inspect scene data in draw."""
    if validation.is_dirty():
        return None
    analysis = validation.result().rendering_analysis.get(obj.name)
    if (analysis is not None
            and analysis.authored_mode != _authored_rendering_mode(obj)):
        # Custom ID-property edits can become visible before the depsgraph
        # timer marks validation dirty. Never present the previous intent as
        # the new effective result during that small window.
        return None
    return analysis


def _dynamic_note(obj) -> str | None:
    """Cached export policy rendered as an artist-facing reason."""
    analysis = _cached_rendering_analysis(obj)
    if analysis is None:
        return "Checking web rendering…"
    if analysis.forced_bake_risk:
        return f"Baked override — freezes {analysis.forced_bake_risk}"
    if analysis.automatic_bake_reason:
        return (
            "Baked automatically — fixed-camera Appearance captures "
            f"{analysis.automatic_bake_reason}"
        )
    return (
        f"Realtime — {analysis.dynamic_reason}"
        if analysis.dynamic_reason else None
    )


_RENDERING_LABELS = {
    "AUTO": "Automatic",
    "DYNAMIC": "Realtime",
    "BAKED": "Baked",
}


def _authored_rendering_mode(obj) -> str:
    explicit = obj.get("blendlink_dynamic")
    if explicit is None:
        return "AUTO"
    return "DYNAMIC" if bool(explicit) else "BAKED"


def _effective_rendering(obj, project=None) -> tuple[str, str]:
    if (project is not None and getattr(project, "configured", False)
            and getattr(project, "presentation", "HYBRID") == "REALTIME"):
        return (
            "DYNAMIC",
            "The scene's Web Presentation is Realtime. This object choice is retained "
            "for Hybrid or Fully Baked presentation.",
        )
    # Explicit Realtime intent needs no procedural inspection and remains
    # immediately truthful while the validation timer refreshes its cache.
    if _authored_rendering_mode(obj) == "DYNAMIC":
        return "DYNAMIC", "explicitly marked Realtime"
    analysis = _cached_rendering_analysis(obj)
    if analysis is None:
        return (
            "PENDING",
            "Web-rendering analysis is pending. Blendlink is checking motion, "
            "modifiers, and materials.",
        )
    if analysis.dynamic_reason:
        return "DYNAMIC", analysis.dynamic_reason
    if analysis.automatic_bake_reason:
        return (
            "BAKED",
            "Automatic fixed-camera Bake Appearance captures this opaque "
            "camera-dependent material from the authored active camera. It "
            "returns to Realtime for orbit/free cameras or Bake Lighting.",
        )
    if analysis.forced_bake_risk:
        return "BAKED", f"Explicit Baked override freezes {analysis.forced_bake_risk}."
    if _authored_rendering_mode(obj) == "BAKED":
        atlases = list(getattr(project, "atlases", ())) if project is not None else []
        atlas = atlases[0] if atlases else None
        override = obj.get("blendlink_atlas")
        if isinstance(override, str):
            atlas = next((item for item in atlases if item.atlas_id == override), atlas)
        if atlas is not None and atlas.bake_output == "LIGHTING":
            return (
                "BAKED",
                f"Explicit Baked choice; {atlas.name} uses Bake Lighting, preserving PBR "
                "while baking indirect GI.",
            )
        if atlas is not None:
            return (
                "BAKED",
                f"Explicit Baked choice; {atlas.name} uses Bake Appearance to capture "
                "the final stylized look.",
            )
        return "BAKED", "Explicit Baked choice; the atlas Bake Output controls what is captured."
    return "BAKED", "Automatic found no motion or material behavior that requires realtime rendering."


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
    if key == f"blendlink_{bare}":
        column.prop(obj, f'["{key}"]', text=text, slider=slider)
    elif key == bare:
        row = column.row(align=True)
        value = obj[bare]
        display = f"{value:g}" if isinstance(value, float) else str(value)
        row.label(text=f"{text}: {display}", icon="ERROR")
        migrate = row.operator(
            "blendlink.migrate_legacy_property", text="Migrate", icon="IMPORT",
        )
        migrate.object_name = obj.name
        migrate.property_name = bare


def _selected_for_ui(context, active):
    selected = list(getattr(context, "selected_editable_objects", ()) or ())
    # Match the exact scope used by batch operators. A pinned/read-only active
    # object must not silently join an otherwise editable selection summary.
    if selected:
        return selected
    return [active] if active is not None else []


def _counts_text(summary, labels, missing_label="Missing") -> str:
    return ", ".join(
        f"{count} {labels.get(value, missing_label)}"
        for value, count in summary["counts"].items() if count
    )


def _atlas_labels(project) -> dict[str, str]:
    labels = {"AUTO": "Main", "__AUTO__": "Main", "main": "Main"}
    for atlas in getattr(project, "atlases", ()) if project is not None else ():
        labels[atlas.atlas_id] = atlas.name
    return labels


def _atlas_display_name(project, atlas_id) -> str:
    atlas_id = str(atlas_id or "main")
    known = _atlas_labels(project).get(atlas_id)
    if known:
        return known
    readable = atlas_id.replace("-", " ").replace("_", " ").strip()
    return readable.title() if readable else "Main"


def _draw_atlas_controls(layout, obj, context=None, *, selection=None, summaries=None):
    """Draw authored rendering and bake intent without implying false uniformity."""
    context = context or bpy.context
    project = getattr(context.scene, "blendlink_project", None)
    selection = selection or _selected_for_ui(context, obj)
    meshes = [item for item in selection if item.type == "MESH"]
    if not meshes:
        return
    representative = obj if obj in meshes else meshes[0]
    summaries = summaries or ui_state.summarize_selection(selection)
    rendering = summaries["rendering"]

    header = layout.row(align=True)
    header.label(
        text=(f"Web Rendering · {rendering['total']} meshes"
              if rendering["total"] > 1 else "Web Rendering"),
        icon="SHADING_RENDERED",
    )
    buttons = layout.column(align=True) if _is_compact(context, 250) else layout.row(align=True)
    for mode, label in _RENDERING_LABELS.items():
        operator = buttons.operator(
            "blendlink.set_shading",
            text=label,
            depress=rendering["value"] == mode,
        )
        operator.mode = mode
    if rendering["value"] == ui_state.MIXED:
        layout.label(
            text=_shorten("Mixed · " + _counts_text(rendering, _RENDERING_LABELS), context),
            icon="INFO",
        )

    effective_counts = {"DYNAMIC": 0, "BAKED": 0, "PENDING": 0}
    effective_results = {}
    for selected_obj in meshes:
        mode, selected_reason = _effective_rendering(selected_obj, project)
        effective_results[selected_obj.name] = (mode, selected_reason)
        effective_counts[mode] += 1
    used_effective = [mode for mode, count in effective_counts.items() if count]
    effective, reason = effective_results[representative.name]
    result = layout.box()
    if effective_counts["PENDING"]:
        known = []
        if effective_counts["BAKED"]:
            known.append(f"{effective_counts['BAKED']} Baked")
        if effective_counts["DYNAMIC"]:
            known.append(f"{effective_counts['DYNAMIC']} Realtime")
        pending = effective_counts["PENDING"]
        known.append(f"{pending} Checking")
        result.label(
            text=("Effective · Checking…" if pending == len(meshes)
                  else "Effective · " + ", ".join(known)),
            icon="TIME",
        )
        _draw_wrapped(
            result,
            "Blendlink is checking motion, modifiers, and materials before "
            "deciding which selected meshes can be baked.",
        )
        return
    if len(used_effective) > 1:
        result.label(
            text=(f"Effective · {effective_counts['BAKED']} Baked, "
                  f"{effective_counts['DYNAMIC']} Realtime"),
            icon="INFO",
        )
        _draw_wrapped(
            result,
            f"{representative.name}: {_RENDERING_LABELS[effective]} — {reason}",
        )
    else:
        result.label(
            text=f"Effective · {_RENDERING_LABELS[effective]}",
            icon="LIGHT" if effective == "DYNAMIC" else "TEXTURE",
        )
        _draw_wrapped(result, reason)
    if effective_counts["BAKED"] == 0:
        return

    atlas = summaries["atlas"]
    atlas_names = _atlas_labels(project)
    if atlas["value"] == ui_state.MIXED:
        atlas_text = "Atlas: Mixed · " + _counts_text(
            atlas, atlas_names, "missing atlas",
        )
    elif atlas["value"] == "AUTO":
        atlas_text = "Atlas: Main (default)"
    else:
        atlas_text = f"Atlas: {atlas_names.get(atlas['value'], 'Missing atlas')}"
    layout.operator_menu_enum(
        "blendlink.set_atlas", "atlas", text=_shorten(atlas_text, context), icon="TEXTURE",
    )
    unknown_atlases = [
        value for value, count in atlas["counts"].items()
        if count and value != "AUTO" and value not in atlas_names
    ]
    if unknown_atlases:
        warning = layout.box()
        warning.alert = True
        _draw_wrapped(
            warning,
            "A selected mesh points to an atlas that no longer exists. Choose Main or another atlas.",
            icon="ERROR",
        )

    weights = []
    for item in meshes:
        key = _prop_key(item, "texel_weight")
        weights.append(float(item[key]) if key is not None else 1.0)
    if len(meshes) > 1:
        unique_weights = sorted(set(weights))
        label = (
            f"Lightmap Scale: {unique_weights[0]:g}×"
            if len(unique_weights) == 1 else
            f"Lightmap Scale: Mixed · {len(unique_weights)} values"
        )
        layout.label(text=label, icon="FULLSCREEN_ENTER")
        layout.operator(
            "blendlink.set_texel_weight",
            text=f"Set Scale for {len(meshes)} Meshes",
            icon="TEXTURE",
        )
    else:
        column = layout.column()
        weight_key = _prop_key(representative, "texel_weight")
        current_weight = float(representative[weight_key]) if weight_key is not None else 1.0
        column.operator(
            "blendlink.set_texel_weight",
            text=(f"Lightmap Scale · {current_weight:g}×"
                  if weight_key is not None else "Lightmap Scale · 1× Default"),
            icon="TEXTURE",
        )
        if current_weight == 0:
            column.label(text="Excluded from atlas pixels; still contributes lighting", icon="INFO")

    lines = density_summary(
        syncstatus.plan_for(representative.name), syncstatus.bake_plan(),
    )
    if lines:
        readout = layout.column(align=True)
        readout.scale_y = 0.8
        for line in lines:
            readout.label(text=line)
        if syncstatus.status()[0] != "IN_SYNC":
            readout.label(text="From last build · preview again to refresh", icon="TIME")


_SHADOW_LABELS = {
    "AUTO": "Application Default",
    "BOTH": "Cast & Receive",
    "CAST": "Cast Only",
    "RECEIVE": "Receive Only",
    "NONE": "None",
}


def _draw_runtime_controls(layout, obj, context=None, *, selection=None, summaries=None):
    """Portable runtime intent with explicit mixed-selection presentation."""
    context = context or bpy.context
    selection = selection or _selected_for_ui(context, obj)
    summaries = summaries or ui_state.summarize_selection(selection)
    layout.label(text="Website Behavior", icon="WORLD")

    visibility = summaries["visibility"]
    if visibility["total"] > 1:
        buttons = layout.row(align=True)
        show = buttons.operator(
            "blendlink.set_initial_visibility",
            text="Visible at Start",
            icon="HIDE_OFF",
            depress=visibility["value"] == "VISIBLE",
        )
        show.visible = True
        hide = buttons.operator(
            "blendlink.set_initial_visibility",
            text="Hidden at Start",
            icon="HIDE_ON",
            depress=visibility["value"] == "HIDDEN",
        )
        hide.visible = False
        if visibility["value"] == ui_state.MIXED:
            layout.label(
                text="Mixed · " + _counts_text(
                    visibility, {"VISIBLE": "visible", "HIDDEN": "hidden"},
                ),
                icon="INFO",
            )
    else:
        starts_visible = visibility["value"] != "HIDDEN"
        buttons = layout.row(align=True)
        show = buttons.operator(
            "blendlink.set_initial_visibility",
            text="Visible at Start",
            icon="HIDE_OFF",
            depress=starts_visible,
        )
        show.visible = True
        hide = buttons.operator(
            "blendlink.set_initial_visibility",
            text="Hidden at Start",
            icon="HIDE_ON",
            depress=not starts_visible,
        )
        hide.visible = False

    meshes = [item for item in selection if item.type == "MESH"]
    if not meshes:
        return
    shadows = summaries["shadows"]
    shadow_text = (
        "Shadows: Mixed · " + _counts_text(shadows, _SHADOW_LABELS)
        if shadows["value"] == ui_state.MIXED else
        f"Shadows: {_SHADOW_LABELS.get(shadows['value'], 'Application Default')}"
    )
    layout.operator_menu_enum(
        "blendlink.set_shadows", "mode", text=_shorten(shadow_text, context), icon="LIGHT_SUN",
    )

    reflections = summaries["reflections"]
    project = getattr(context.scene, "blendlink_project", None)
    reflection_names = {"SCENE": "Scene Environment"}
    for probe in getattr(project, "reflection_probes", ()) if project is not None else ():
        reflection_names[probe.object_id] = probe.name
    assignment = layout.row(align=True)
    if reflections["value"] == ui_state.MIXED:
        assignment.label(
            text=_shorten(
                "Reflections: Mixed · " + _counts_text(
                    reflections, reflection_names, "missing probe",
                ),
                context,
                reserve=8,
            ),
            icon="INFO",
        )
        assignment.operator("blendlink.clear_reflection_probe", text="", icon="UNLINKED")
    elif reflections["value"] == "SCENE":
        assignment.label(text="Reflections: Scene Environment", icon="WORLD")
    else:
        probe_name = reflection_names.get(reflections["value"])
        if probe_name is None:
            assignment.alert = True
            assignment.label(text="Reflections: Missing Probe", icon="ERROR")
            assignment.operator("blendlink.clear_reflection_probe", text="", icon="UNLINKED")
        else:
            assignment.label(text=f"Reflections: {probe_name}", icon="MATERIAL")
            assignment.operator("blendlink.clear_reflection_probe", text="", icon="UNLINKED")


class BLENDLINK_UL_bake_table(bpy.types.UIList):
    """object | atlas | web rendering | density — the whole bake at a glance."""

    def draw_filter(self, context, layout):
        row = layout.row(align=True)
        row.prop(self, "filter_name", text="", icon="VIEWZOOM")
        row.prop(self, "use_filter_invert", text="", icon="ARROW_LEFTRIGHT")
        row.prop(self, "use_filter_sort_alpha", text="", icon="SORTALPHA")

    def filter_items(self, context, data, property_name):
        items = getattr(data, property_name)
        flags = []
        if self.filter_name:
            flags = bpy.types.UI_UL_list.filter_items_by_name(
                self.filter_name,
                self.bitflag_filter_item,
                items,
                "name",
                reverse=self.use_filter_invert,
            )
        order = (
            bpy.types.UI_UL_list.sort_items_by_name(items, "name")
            if self.use_filter_sort_alpha else []
        )
        return flags, order

    def draw_item(self, context, layout, data, item, icon, active_data, active_prop):
        shading = {
            "realtime": "Realtime",
            "baked": "Baked",
        }.get(item.shading, item.shading.title())
        if _is_compact(context, 380):
            atlas = item.atlas or "Main"
            layout.label(
                text=_shorten(f"{item.name} · {atlas}", context, reserve=3),
                icon="LIGHT" if item.shading == "realtime" else "TEXTURE",
            )
            return
        split = layout.split(factor=0.36)
        split.label(text=item.name, icon="MESH_DATA")
        rest = split.split(factor=0.3)
        rest.label(text=item.atlas)
        tail = rest.split(factor=0.35)
        tail.label(
            text=shading,
            icon="LIGHT" if item.shading == "realtime" else "TEXTURE",
        )
        density = item.density + (f" · {item.weight}" if item.weight else "")
        tail.label(text=density)


def _bake_row_uv_summary(row) -> str:
    if not row.planned:
        return "Not in the last plan — preview the website to measure it."
    if row.pinned:
        return "Editable atlas UVs · pinned islands stay locked on the next build."
    if row.authored:
        return "Editable atlas UVs · unpinned islands can repack on the next build."
    return "Automatic atlas UVs · materialize them before hand editing."


def _draw_bake_row_detail(layout, row):
    box = layout.box()
    header = box.row(align=True)
    header.label(text=row.name, icon="MESH_DATA")
    select = header.operator("blendlink.select_issue", text="Select Object", icon="RESTRICT_SELECT_OFF")
    select.object_name = row.name
    effective = "Realtime" if row.shading == "realtime" else "Baked"
    box.label(
        text=f"Effective: {effective}",
        icon="LIGHT" if row.shading == "realtime" else "TEXTURE",
    )
    if row.shading == "baked":
        atlas = row.atlas or "unassigned"
        density = f" · {row.density}" if row.density else ""
        box.label(text=f"Atlas: {atlas}{density}", icon="UV")
        _draw_wrapped(box, _bake_row_uv_summary(row), icon="PINNED" if row.pinned else "INFO")
    if row.reason:
        box.label(text="Why", icon="INFO")
        _draw_wrapped(box, row.reason)


def _bake_job_display(job, project) -> str:
    """Translate an internal incremental-build key into an artist-facing label."""
    parts = str(job or "").split(":")
    if len(parts) >= 3 and parts[0] in {"state", "light"}:
        kind = "Lighting state" if parts[0] == "state" else "Light group"
        name = parts[1] or "Unnamed"
        atlas = _atlas_display_name(project, parts[-1])
        return f"{kind} {name} / {atlas}"
    return "One baked lighting result"


def _bake_duration_label(milliseconds) -> str:
    try:
        duration = max(0, int(milliseconds))
    except (TypeError, ValueError):
        return "unknown time"
    seconds = duration / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, remaining = divmod(round(seconds), 60)
    return f"{minutes}m {remaining:02d}s"


def _draw_published_assets(layout, context):
    incremental = syncstatus.incremental_bake()
    if incremental:
        total = int(incremental.get("totalJobs", 0))
        reused = int(incremental.get("reusedJobs", 0))
        rebuilt = int(incremental.get("rebuiltJobs", max(0, total - reused)))
        summary = layout.box()
        summary.label(text="Dependency-aware Bake", icon="FILE_REFRESH")
        summary.label(text=f"Last build: {reused} reused · {rebuilt} rebuilt")
        summary.label(text="Unit: one lighting state or light group × one atlas", icon="INFO")
        execution = incremental.get("execution")
        if isinstance(execution, dict):
            profile = str(execution.get("profile", "build")).title()
            device = str(execution.get("deviceClass", "device")).upper()
            backend = str(execution.get("backend", "")).upper()
            device_label = f"{device}/{backend}" if backend and backend != device else device
            summary.label(
                text=(f"Bake work: {_bake_duration_label(execution.get('durationMs'))} · "
                      f"{profile} · {device_label}"),
                icon="TIME",
            )
            timings = execution.get("jobs")
            if isinstance(timings, list) and timings:
                project = getattr(context.scene, "blendlink_project", None)
                slowest = sorted(
                    (item for item in timings if isinstance(item, dict)),
                    key=lambda item: int(item.get("durationMs", 0)),
                    reverse=True,
                )
                timing_column = summary.column(align=True)
                timing_column.scale_y = 0.8
                for item in slowest[:4]:
                    size = item.get("effectiveSize")
                    size_label = f" · {int(size)}px" if isinstance(size, (int, float)) else ""
                    timing_column.label(
                        text=(f"{_bake_job_display(item.get('job'), project)} · "
                              f"{_bake_duration_label(item.get('durationMs'))}{size_label}"),
                        icon="CHECKMARK" if item.get("status") == "reused" else "RENDER_STILL",
                    )
                if len(slowest) > 4:
                    timing_column.label(text=f"…and {len(slowest) - 4} more measured jobs")
        invalidated = incremental.get("invalidated") or []
        if invalidated:
            column = summary.column(align=True)
            column.scale_y = 0.8
            labels = {
                "no-prior-fingerprint": "first build",
                "dependencies-changed": "scene inputs changed",
                "no-prior-artifact-hash": "prior output predates integrity checks",
                "artifact-not-provided": "prior output unavailable",
                "artifact-missing": "prior file missing",
                "artifact-changed": "prior file bytes changed",
            }
            project = getattr(context.scene, "blendlink_project", None)
            for item in invalidated[:4]:
                column.label(
                    text=(f"{_bake_job_display(item.get('job'), project)} · "
                          f"{labels.get(item.get('reason'), item.get('reason', 'needs rebuild'))}"),
                    icon="RENDER_STILL",
                )
            if len(invalidated) > 4:
                column.label(text=f"…and {len(invalidated) - 4} more")
    assets = syncstatus.derived_assets()
    if not assets:
        layout.label(text="No published baked images yet.", icon="IMAGE_DATA")
        return
    layout.label(text=f"Published Images ({len(assets)})", icon="IMAGE_DATA")
    session = context.window_manager.blendlink
    project = getattr(context.scene, "blendlink_project", None)
    for asset in assets:
        row = layout.row(align=True)
        kind_icon = {
            "state": "WORLD", "light": "LIGHT", "environment": "WORLD_DATA",
            "probe": "LIGHTPROBE_SPHERE",
        }.get(
            asset.get("kind"), "IMAGE_DATA",
        )
        atlas = asset.get("atlas", "main")
        atlas_name = _atlas_display_name(project, atlas)
        suffix = f" / {atlas_name}" if asset.get("kind") in {"state", "light"} else ""
        label = f"{asset.get('label', '?')}{suffix}"
        selected = (
            session.derived_asset_path == (asset.get("path") or "")
            and session.derived_asset_content_hash == asset.get("contentHash", "")
            and bool(asset.get("path"))
        )
        op = row.operator(
            "blendlink.select_derived_asset", text=label, icon=kind_icon, depress=selected,
        )
        op.path = asset.get("path") or ""
        op.label = label
        op.atlas = atlas
        op.kind = asset.get("kind", "")
        if asset.get("bytes"):
            row.label(text=_format_bytes(asset["bytes"]))
        if not asset.get("path"):
            row.label(text="not found", icon="ERROR")
    selected_asset = syncstatus.verified_derived_asset(
        session.derived_asset_path, session.derived_asset_content_hash,
    )
    if selected_asset is None:
        layout.label(text="Select an image to inspect its saved pixels.", icon="INFO")
        return
    icon_id = _derived_preview_icon(
        selected_asset["path"], selected_asset.get("contentHash", ""),
    )
    if icon_id:
        layout.template_icon(icon_value=icon_id, scale=7.0)
    layout.label(text=session.derived_asset_label, icon="CHECKMARK")
    actions = layout.row(align=True)
    actions.operator("blendlink.open_derived_asset", icon="FILE_FOLDER")
    actions.operator("blendlink.isolate_derived_asset", icon="SHADING_TEXTURE")
    if session.derived_asset_kind == "light":
        if selected_asset.get("maxValue") is not None:
            layout.label(
                text=f"Preview is normalized; runtime scale {selected_asset['maxValue']:.3g}x",
                icon="INFO",
            )


class BLENDLINK_PT_bake(_BlendlinkPanelMixin, bpy.types.Panel):
    """What the next bake will do, from the last sync's plan: settings,
    atlases with occupancy and membership, the per-object table, dynamic
    meshes. Numbers come from the manifest; visual settings come from the
    scene-owned Web Presentation above. ALWAYS visible: an empty panel that explains itself beats a
    hidden one (a poll-gated version was invisible on external scenes and
    read as broken)."""
    bl_idname = "BLENDLINK_PT_bake"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Baked Textures & UVs"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 20

    def draw(self, context):
        layout = self.layout
        project = getattr(context.scene, "blendlink_project", None)
        _draw_published_assets(layout, context)
        layout.separator()
        plan = syncstatus.bake_plan()
        if plan is None:
            column = layout.column(align=True)
            column.scale_y = 0.85
            column.label(text="No published bake details yet.", icon="INFO")
            column.label(text="Preview Website to create an inspectable plan.")
            return
        if syncstatus.status()[0] != "IN_SYNC":
            layout.label(text="From the last build — preview again to refresh", icon="TIME")

        settings = layout.column(align=True)
        settings.scale_y = 0.85
        supersample = plan.get("supersample", 1)
        supersample_text = f" · {supersample}x supersample" if supersample > 1 else ""
        settings.label(
            text=f"{plan.get('samples', '?')} samples · {plan.get('marginPx', '?')}px padding"
                 f"{supersample_text}",
            icon="SCENE",
        )
        _draw_active_atlas_gpu_estimate(settings, plan)
        owner = settings.operator(
            "blendlink.open_properties_context",
            text="Bake settings live in Scene Properties",
            icon="SCENE_DATA",
        )
        owner.target = "SCENE"

        atlases = plan.get("atlases") or {"main": {"size": plan.get("atlasSize", 0),
                                                   "occupancy": plan.get("occupancy", 0),
                                                   "objects": len(plan.get("objects", []))}}
        for message in plan.get("errors") or []:
            error_box = layout.box()
            error_box.alert = True
            error_box.label(text="Bake blocked to protect detail", icon="ERROR")
            consequence, remedy = _message_sections(
                message,
                "Open Texture Atlases in Scene Properties. Adjust Resolution, Minimum Detail "
                "(px/m), Padding, assigned meshes, or When Full, then run Check Atlas Fit again.",
            )
            error_box.label(text="Consequence", icon="INFO")
            _draw_wrapped(error_box, consequence)
            error_box.label(text="How to fix", icon="TOOL_SETTINGS")
            _draw_wrapped(error_box, remedy)
        raw_plan_warnings = plan.get("warnings") or []
        plan_warnings = sorted(
            raw_plan_warnings,
            key=lambda item: not str(item).startswith("Bake Lighting preflight:"),
        )
        for message in plan_warnings[:8]:
            warning_box = layout.box()
            is_lighting = str(message).startswith("Bake Lighting preflight:")
            warning_box.alert = is_lighting
            warning_box.label(
                text=("Bake Lighting needs a runtime match" if is_lighting else "Bake warning"),
                icon="ERROR" if is_lighting else "INFO",
            )
            _draw_wrapped(warning_box, str(message))
        if len(plan_warnings) > 8:
            layout.label(
                text=f"+ {len(plan_warnings) - 8} more bake warning(s) in the build log",
                icon="INFO",
            )
        box = layout.box()
        box.label(text=f"{len(atlases)} atlas(es)", icon="TEXTURE")
        for name, atlas in atlases.items():
            display_name = _atlas_display_name(project, name)
            atlas_box = box.box()
            row = atlas_box.column(align=True) if _is_compact(context, 380) else atlas_box.row(align=True)
            occupancy = atlas.get("occupancy", 0.0)
            row.label(
                text=f"{display_name}: {atlas.get('size', '?')}px · {occupancy * 100:.0f}% full "
                     f"· {atlas.get('objects', '?')} objects",
            )
            required = atlas.get("requiredOccupancy")
            if required is not None:
                row.label(text=f"needs {required * 100:.0f}% at target")
            achievement = atlas.get("targetAchievement")
            if achievement is not None:
                row.label(text=f"quality {achievement * 100:.0f}%")
            op = row.operator(
                "blendlink.select_atlas_objects",
                text="Select Last Build" if _is_compact(context, 380) else "",
                icon="RESTRICT_SELECT_OFF",
            )
            op.atlas = name
            _draw_atlas_plan_evidence(
                atlas_box, display_name, atlas, context=context, show_fix=True,
            )

        session = context.window_manager.blendlink
        header = layout.row(align=True)
        header.label(
            text=("mesh · atlas" if _is_compact(context, 380)
                  else "object · atlas · Web Rendering · density"),
            icon="SPREADSHEET",
        )
        header.operator("blendlink.refresh_bake_table", text="", icon="FILE_REFRESH")
        if len(session.bake_rows) > 0:
            layout.template_list(
                "BLENDLINK_UL_bake_table", "", session, "bake_rows",
                session, "bake_row_index", rows=6,
            )
            if 0 <= session.bake_row_index < len(session.bake_rows):
                _draw_bake_row_detail(layout, session.bake_rows[session.bake_row_index])
            else:
                layout.label(text="Choose a row to inspect its web result", icon="INFO")
        else:
            layout.label(text="Waiting for the automatic scene scan…", icon="TIME")
        layout.operator("blendlink.preview_atlas_uvs", icon="UV")
        # Inspect → materialize: judge the last published pack with a
        # real-texel checker, persist it, edit/pin, then resync.
        from . import ops as _ops
        mode = _ops.checker_mode_cached()
        row = layout.row(align=True)
        next_label = {
            None: "Checker: Checking…",
            "OFF": "Checker: Density",
            "DENSITY": "Checker: UV Grid",
            "UVGRID": "Checker: Off",
            "SAVED": "Saved Layer: Off",
        }.get(mode, "Checker: Refreshing…")
        row.enabled = mode is not None
        row.operator("blendlink.toggle_checker", text=next_label, icon="TEXTURE")
        if mode not in {None, "OFF"}:
            row.operator("blendlink.checker_cleanup", text="", icon="X")
        layout.operator("blendlink.materialize_atlas_uvs", icon="PINNED")

        dynamic = plan.get("dynamicObjects") or []
        if dynamic:
            names = ", ".join(entry.get("name", "?") for entry in dynamic[:4])
            more = f" +{len(dynamic) - 4}" if len(dynamic) > 4 else ""
            layout.label(text=f"Realtime (lit): {names}{more}", icon="LIGHT")

        bakes = plan.get("bakeCount")
        states = plan.get("states") or []
        lights = plan.get("lightGroups") or []
        if bakes:
            setups = len(states) + len(lights)
            populated_atlases = len(atlases)
            detail = (
                f"{setups} lighting setup(s) × {populated_atlases} populated atlas(es) = {bakes} bakes"
                if setups * populated_atlases == bakes else
                f"{bakes} bakes · one per lighting setup and populated atlas"
            )
            layout.label(text=detail, icon="RENDER_STILL")


class BLENDLINK_PT_checks(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_checks"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Web Checks"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 10

    def draw(self, context):
        layout = self.layout
        issues = validation.result().issues
        checking = validation.is_dirty()
        header = layout.row(align=True)
        if checking and not issues:
            header.label(text="Checking scene…", icon="TIME")
        elif issues:
            header.label(text=f"{len(issues)} to review", icon="ERROR")
        else:
            header.label(text="Vocabulary looks good", icon="CHECKMARK")
        header.operator("blendlink.refresh_checks", text="", icon="FILE_REFRESH")
        if checking and not issues:
            return
        if not issues:
            return
        ordered = sorted(
            issues,
            key=lambda issue: (issue.severity != "WARNING", issue.object_name or "", issue.message),
        )
        visible = ordered[:8]
        for issue in visible:
            row = layout.row(align=True)
            row.alert = issue.severity == "WARNING"
            icon = "ERROR" if issue.severity == "WARNING" else "INFO"
            subject = f"{issue.object_name}: " if issue.object_name else ""
            row.label(text=_shorten(subject + issue.message, context, reserve=8), icon=icon)
            if issue.object_name:
                op = row.operator(
                    "blendlink.select_issue", text="", icon="RESTRICT_SELECT_OFF",
                )
                op.object_name = issue.object_name
            if issue.fixable_numbered and issue.object_name:
                fix = row.row(align=True)
                candidate = context.scene.objects.get(issue.object_name)
                fix.enabled = candidate is not None and getattr(candidate, "is_editable", True)
                op = fix.operator("blendlink.fix_numbered", text="", icon="AUTO")
                op.object_name = issue.object_name
        if len(ordered) > len(visible):
            layout.label(text=f"+ {len(ordered) - len(visible)} more checks", icon="THREE_DOTS")

        active_name = getattr(getattr(context, "active_object", None), "name", None)
        detail = next(
            (issue for issue in ordered if issue.object_name == active_name), ordered[0],
        )
        box = layout.box()
        box.alert = detail.severity == "WARNING"
        box.label(
            text="Needs correction" if detail.severity == "WARNING" else "Review before publishing",
            icon="ERROR" if detail.severity == "WARNING" else "INFO",
        )
        _draw_wrapped(box, detail.message)
        consequence = (
            "The web build may be blocked or interpret this object differently than intended."
            if detail.severity == "WARNING" else
            "The export can continue, but its generated contract is less explicit."
        )
        _draw_wrapped(box, consequence, icon="WORLD")
        detail_object = (
            context.scene.objects.get(detail.object_name) if detail.object_name else None
        )
        if detail.fixable_numbered and detail_object is not None \
                and not getattr(detail_object, "is_editable", True):
            remedy = "Make the linked object local, or rename it in its source .blend."
        elif detail.fixable_numbered:
            remedy = "Fix duplicate numbering so every tool reads the same semantic role."
        elif detail.object_name:
            remedy = "Select the affected object and review its Blendlink Web Object settings."
        else:
            remedy = "Correct the named scene setting, then refresh Web Checks."
        _draw_wrapped(box, remedy, icon="TOOL_SETTINGS")


class BLENDLINK_PT_fidelity(_BlendlinkPanelMixin, bpy.types.Panel):
    bl_idname = "BLENDLINK_PT_fidelity"
    bl_parent_id = "BLENDLINK_PT_main"
    bl_label = "Geometry Conversion"
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 30

    def draw(self, context):
        layout = self.layout
        items = validation.result().fidelity
        if validation.is_dirty() and not items:
            layout.label(text="Checking geometry routes…", icon="TIME")
            return
        if not items:
            layout.label(text="No mesh compile routes to report.", icon="INFO")
            return
        route_counts = {}
        for item in items:
            route_counts[item.route] = route_counts.get(item.route, 0) + 1
        summary = " | ".join(f"{route} {count}" for route, count in sorted(route_counts.items()))
        layout.label(text=_shorten(summary, context), icon="NODETREE")
        icons = {
            "Preserve": "CHECKMARK",
            "Realize": "NODETREE",
            "Bake": "RENDER_STILL",
            "Runtime": "PLAY",
            "Cache": "TIME",
            "Block": "ERROR",
        }
        ordered = sorted(items, key=lambda item: (item.route == "Preserve", item.object_name))
        visible = ordered[:8]
        for item in visible:
            row = layout.row(align=True)
            row.alert = item.blocking
            row.label(
                text=_shorten(f"{item.route} · {item.object_name}", context, reserve=8),
                icon=icons.get(item.route, "INFO"),
            )
            select = row.operator("blendlink.select_issue", text="", icon="RESTRICT_SELECT_OFF")
            select.object_name = item.object_name
        if len(ordered) > len(visible):
            layout.label(text=f"+ {len(ordered) - len(visible)} more routes", icon="THREE_DOTS")

        active_name = getattr(getattr(context, "active_object", None), "name", None)
        detail = next(
            (item for item in ordered if item.object_name == active_name), ordered[0],
        )
        box = layout.box()
        box.alert = detail.blocking
        box.label(
            text=f"{detail.route} · {detail.object_name}",
            icon=icons.get(detail.route, "INFO"),
        )
        _draw_wrapped(box, detail.source)
        _draw_wrapped(box, detail.detail, icon="INFO")


classes = (
    BLENDLINK_MT_workspace_tools,
    BLENDLINK_UL_atlases,
    BLENDLINK_UL_states,
    BLENDLINK_UL_compositions,
    BLENDLINK_UL_reflection_probes,
    BLENDLINK_UL_bake_table,
    BLENDLINK_PT_main,
    BLENDLINK_PT_project,
    BLENDLINK_PT_ownership,
    BLENDLINK_PT_camera,
    BLENDLINK_PT_playback,
    BLENDLINK_PT_look,
    BLENDLINK_PT_environment,
    BLENDLINK_PT_reflection_probes,
    BLENDLINK_PT_shadows,
    BLENDLINK_PT_optimization,
    BLENDLINK_PT_atlases,
    BLENDLINK_PT_bake_quality,
    BLENDLINK_PT_lighting_states,
    BLENDLINK_PT_designation,
    BLENDLINK_PT_tag,
    BLENDLINK_PT_textures,
    BLENDLINK_PT_web_light,
    BLENDLINK_PT_bake,
    BLENDLINK_PT_fidelity,
    BLENDLINK_PT_checks,
)


_sidebar_panels = (
    BLENDLINK_PT_main,
    BLENDLINK_PT_bake,
    BLENDLINK_PT_fidelity,
    BLENDLINK_PT_checks,
)


def re_register_category(category: str):
    """Move the viewport workspace without disturbing native Properties panels."""
    for cls in reversed(_sidebar_panels):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
    for cls in _sidebar_panels:
        cls.bl_category = category or _DEFAULT_CATEGORY
        bpy.utils.register_class(cls)
