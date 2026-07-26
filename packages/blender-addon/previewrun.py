# SPDX-License-Identifier: GPL-3.0-or-later
"""Own the website preview process independently from scene compilation.

The CLI remains the adapter for package managers and web frameworks. This
module only understands its small machine-readable contract: progress and a
reachable previewUrl. Keeping preview and sync processes separate means an
artist can leave the site running while building, planning, or watching saves.
"""
from __future__ import annotations

import collections
import json
import os
import queue
import subprocess
import threading
import time
import webbrowser

import bpy

_PREFIX = "##blendlink "
_PROTOCOL_SCHEMA_VERSION = 1
_state = {
    "running": False,
    "ready": False,
    "watching": False,
    "updating": False,
    "update_error": "",
    "fraction": 0.0,
    "label": "",
    "url": "",
    "opened_url": "",
    "owns_server": True,
    "tail": collections.deque(maxlen=60),
    "exit_code": None,
    "process": None,
    "queue": None,
    "log_path": "",
    "cancel_requested": False,
    "canceled": False,
    "finished_at": 0,
    # Canonical source identity prevents Blender from presenting a Preview
    # Studio left running for another .blend as though it belonged to the
    # file currently open in this process.  New CLIs repeat both values on
    # lifecycle events; start() supplies the path so legacy CLIs remain safe.
    "blend_path": "",
    "session_id": "",
    "generation": "",
    "update_phase": "",
    "replacement": None,
}


def is_running() -> bool:
    return bool(_state["running"])


def is_ready() -> bool:
    return bool(_state["ready"] and _state["url"])


def _canonical_blend_path(path: str | None) -> str:
    """Return one comparison identity for a saved Blender path."""
    if not isinstance(path, str) or not path.strip():
        return ""
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def blend_path() -> str:
    return str(_state["blend_path"])


def session_id() -> str:
    return str(_state["session_id"])


def generation() -> str:
    return str(_state["generation"])


def update_phase() -> str:
    return str(_state["update_phase"])


def matches_current_file(path: str | None = None) -> bool:
    """Whether remembered preview evidence belongs to this saved .blend.

    An unbound legacy event is deliberately not considered current. Production
    starts bind the source path before any CLI output is read, while the
    protocol can strengthen that binding with its session ID.
    """
    remembered = blend_path()
    current = _canonical_blend_path(
        bpy.data.filepath if path is None else path
    )
    return bool(remembered and current and remembered == current)


def is_ready_for_current_file(path: str | None = None) -> bool:
    return is_ready() and matches_current_file(path)


def is_watching_current_file(path: str | None = None) -> bool:
    return is_watching() and matches_current_file(path)


def has_stale_session(path: str | None = None) -> bool:
    """Whether a live/reusable preview is bound to another Blender file."""
    return bool(
        blend_path()
        and (is_running() or is_ready())
        and not matches_current_file(path)
    )


def is_watching() -> bool:
    return bool(_state["watching"])


def is_updating() -> bool:
    return bool(_state["updating"])


def update_error() -> str:
    return str(_state["update_error"])


def url() -> str:
    return str(_state["url"])


def progress() -> tuple[float, str]:
    return float(_state["fraction"]), str(_state["label"])


def last_exit_code():
    return _state["exit_code"]


def last_log_path() -> str:
    return str(_state["log_path"])


def last_message() -> str:
    """Last non-protocol process line, for concise in-panel failure evidence."""
    return str(_state["tail"][-1]) if _state["tail"] else ""


def was_canceled() -> bool:
    return bool(_state["canceled"])


def owns_server() -> bool:
    """Whether the remembered URL belongs to our still-running process."""
    return bool(_state["owns_server"])


def last_finished_at() -> int:
    return int(_state["finished_at"])


def _log_dir() -> str:
    try:
        return bpy.utils.extension_path_user(__package__, create=True)
    except Exception as error:
        import tempfile
        fallback = tempfile.gettempdir()
        print(
            "blendlink preview: extension log directory unavailable; "
            f"using {fallback}: {type(error).__name__}: {error}",
            flush=True,
        )
        return fallback


def _reader(process, output_queue):
    for line in process.stdout:
        output_queue.put(line.rstrip("\n"))
    process.stdout.close()
    output_queue.put(("__exit__", process.wait()))


def _remember_diagnostic(message: str) -> None:
    """Keep protocol/log failures visible in Blender, the tail, and the log."""
    print(message, flush=True)
    _state["tail"].append(message)
    _state["label"] = "Preview output needs attention — see console/log"
    if not _state["log_path"]:
        return
    try:
        with open(_state["log_path"], "a", encoding="utf8") as handle:
            handle.write(message + "\n")
    except OSError as error:
        fallback = f"blendlink preview: could not append diagnostic log: {error}"
        print(fallback, flush=True)
        _state["tail"].append(fallback)
        _state["log_path"] = ""


def start(
    command: str,
    cwd: str,
    *,
    blend_path: str | None = None,
    session_id: str | None = None,
) -> str | None:
    if _state["running"]:
        return "The local preview is already running"
    env = os.environ.copy()
    env["BLENDLINK_PROGRESS"] = "1"
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        process = subprocess.Popen(
            command,
            shell=True,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf8",
            errors="replace",
            creationflags=creationflags,
        )
    except OSError as error:
        return str(error)
    output_queue = queue.Queue()
    log_path = os.path.join(_log_dir(), "preview-log.txt")
    _state.update(
        running=True,
        ready=False,
        watching=False,
        updating=False,
        update_error="",
        fraction=0.0,
        label="Compiling Preview quality",
        # A restarted server must earn a fresh reachable URL. Retaining the
        # previous run here can hide a failed restart behind a dead Open button.
        url="",
        opened_url="",
        owns_server=True,
        exit_code=None,
        process=process,
        queue=output_queue,
        log_path=log_path,
        cancel_requested=False,
        canceled=False,
        finished_at=0,
        blend_path=_canonical_blend_path(blend_path),
        session_id=str(session_id or "").strip(),
        generation="",
        update_phase="building",
        replacement=None,
    )
    _state["tail"].clear()
    try:
        with open(log_path, "w", encoding="utf8") as handle:
            handle.write(f"$ {command}\n")
    except OSError as error:
        _state["log_path"] = ""
        _remember_diagnostic(f"blendlink preview: could not create diagnostic log: {error}")
    threading.Thread(target=_reader, args=(process, output_queue), daemon=True).start()
    if not bpy.app.background and not bpy.app.timers.is_registered(_pump):
        bpy.app.timers.register(_pump, first_interval=0.1)
    return None


def replace(
    command: str,
    cwd: str,
    *,
    blend_path: str,
    session_id: str | None = None,
) -> str | None:
    """Stop a stale Blendlink child and start the requested source afterward.

    Only the process launched by this module is terminated.  When that child
    merely watches an explicitly configured external website, the unrelated
    website server remains untouched.
    """
    if not _state["running"]:
        return start(
            command, cwd, blend_path=blend_path, session_id=session_id,
        )
    if matches_current_file(blend_path):
        return "The local preview for this Blender file is already running"
    _state["replacement"] = {
        "command": command,
        "cwd": cwd,
        "blend_path": blend_path,
        "session_id": session_id,
    }
    _state["label"] = "Stopping preview for the previous Blender file"
    cancel()
    return None


def open_browser() -> bool:
    preview_url = url()
    if not preview_url or not matches_current_file():
        return False
    webbrowser.open(preview_url)
    _state["opened_url"] = preview_url
    return True


def cancel():
    process = _state["process"]
    if process is None or process.poll() is not None:
        return
    _state["cancel_requested"] = True
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        process.kill()


def _validate_protocol_identity(payload, raw_line: str) -> bool:
    """Validate before mutating state, then bind any newly supplied identity."""
    schema_version = payload.get("schemaVersion")
    if schema_version is not None and (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version != _PROTOCOL_SCHEMA_VERSION
    ):
        _remember_diagnostic(
            "blendlink preview: unsupported progress protocol schema "
            f"{schema_version!r}; raw line: {raw_line}"
        )
        return False

    event_path = payload.get("blendPath")
    if event_path is not None and (
        not isinstance(event_path, str) or not event_path.strip()
    ):
        _remember_diagnostic(
            "blendlink preview: malformed blendPath in progress protocol; "
            f"raw line: {raw_line}"
        )
        return False
    canonical_event_path = _canonical_blend_path(event_path)
    remembered_path = blend_path()
    if canonical_event_path and remembered_path \
            and canonical_event_path != remembered_path:
        _remember_diagnostic(
            "blendlink preview: ignored progress for another Blender file "
            f"({canonical_event_path}); expected {remembered_path}; raw line: {raw_line}"
        )
        return False

    event_session_id = payload.get("sessionId")
    if event_session_id is not None and (
        not isinstance(event_session_id, str) or not event_session_id.strip()
    ):
        _remember_diagnostic(
            "blendlink preview: malformed sessionId in progress protocol; "
            f"raw line: {raw_line}"
        )
        return False
    event_session_id = str(event_session_id or "").strip()
    remembered_session_id = session_id()
    if event_session_id and remembered_session_id \
            and event_session_id != remembered_session_id:
        _remember_diagnostic(
            "blendlink preview: ignored progress from another preview session "
            f"({event_session_id}); expected {remembered_session_id}; raw line: {raw_line}"
        )
        return False

    event_generation = payload.get("generation")
    generation_is_string = (
        isinstance(event_generation, str) and bool(event_generation.strip())
    )
    generation_is_integer = (
        isinstance(event_generation, int)
        and not isinstance(event_generation, bool)
        and event_generation >= 0
    )
    if event_generation is not None \
            and not generation_is_string and not generation_is_integer:
        _remember_diagnostic(
            "blendlink preview: malformed generation in progress protocol; "
            f"raw line: {raw_line}"
        )
        return False

    if canonical_event_path and not remembered_path:
        _state["blend_path"] = canonical_event_path
    if event_session_id and not remembered_session_id:
        _state["session_id"] = event_session_id
    if generation_is_string or generation_is_integer:
        _state["generation"] = str(event_generation).strip()
    return True


def _handle_line(line):
    if isinstance(line, tuple):
        _finish(line[1])
        return
    if _state["log_path"]:
        try:
            with open(_state["log_path"], "a", encoding="utf8") as handle:
                handle.write(line + "\n")
        except OSError as error:
            _remember_diagnostic(f"blendlink preview: could not write diagnostic log: {error}")
    if line.startswith(_PREFIX):
        try:
            payload = json.loads(line[len(_PREFIX):])
            if not isinstance(payload, dict):
                raise TypeError("progress payload must be a JSON object")
            if not _validate_protocol_identity(payload, line):
                return
            _state["fraction"] = float(payload.get("fraction", _state["fraction"]))
            _state["label"] = str(payload.get("label", _state["label"]))
            preview_watching = payload.get("previewWatching")
            if isinstance(preview_watching, bool):
                _state["watching"] = preview_watching
            preview_update = payload.get("previewUpdate")
            if preview_update in {"updating", "building", "loading"}:
                _state["updating"] = True
                _state["update_error"] = ""
                _state["update_phase"] = preview_update
            elif preview_update == "ready":
                _state["updating"] = False
                _state["update_error"] = ""
                _state["update_phase"] = "ready"
            elif preview_update == "failed":
                _state["updating"] = False
                _state["update_phase"] = "failed"
                error = payload.get("error")
                if not isinstance(error, str) or not error.strip():
                    error = "The saved scene could not be exported. See the Preview Log for details."
                _state["update_error"] = error.strip()
                diagnostic = f"blendlink preview update failed: {_state['update_error']}"
                print(diagnostic, flush=True)
                _state["tail"].append(diagnostic)
            preview_url = payload.get("previewUrl")
            if isinstance(preview_url, str) and preview_url.startswith(("http://", "https://")):
                # Older CLIs did not declare lifecycle ownership; they always
                # kept the spawned server process alive, so True is the safe
                # backwards-compatible default.
                owns_server = payload.get("previewOwned", True)
                owns_server = owns_server if isinstance(owns_server, bool) else True
                _state.update(
                    url=preview_url,
                    ready=True,
                    owns_server=owns_server,
                    fraction=1.0,
                    label=_state["label"] or "Preview ready",
                )
                if not bpy.app.background and _state["opened_url"] != preview_url:
                    open_browser()
            if preview_update == "ready":
                _refresh_published_state()
        except (ValueError, TypeError) as error:
            _remember_diagnostic(
                "blendlink preview: malformed progress protocol "
                f"({type(error).__name__}: {error}); raw line: {line}"
            )
        return
    if line.strip():
        _state["tail"].append(line)


def _refresh_published_state() -> None:
    """Discover the manifest written by Preview Website without waiting for a manual refresh."""
    try:
        from . import syncstatus
        syncstatus.refresh(force=True)
    except Exception as error:
        _remember_diagnostic(
            "blendlink preview: could not refresh published evidence: "
            f"{type(error).__name__}: {error}"
        )


def _finish(exit_code: int):
    replacement = _state.get("replacement")
    if _state["cancel_requested"]:
        external_ready = bool(_state["url"] and not _state["owns_server"])
        _state.update(
            running=False,
            ready=external_ready,
            watching=False,
            updating=False,
            update_error="",
            url=_state["url"] if external_ready else "",
            opened_url=_state["opened_url"] if external_ready else "",
            owns_server=not external_ready,
            exit_code=exit_code,
            process=None,
            queue=None,
            label=(
                "Live updates stopped — website is still available"
                if external_ready else "Preview stopped"
            ),
            cancel_requested=False,
            canceled=True,
            finished_at=time.monotonic_ns(),
            replacement=None,
        )
        _refresh_published_state()
        _launch_replacement(replacement)
        return
    # A configured external server is deliberately reusable: the short-lived
    # discovery command exits after proving its URL reachable. URLs owned by
    # this process die with it and must never leave a dead Open Website action.
    external_ready = bool(
        exit_code == 0 and _state["url"] and not _state["owns_server"]
    )
    if external_ready:
        _state.update(
            running=False,
            ready=True,
            watching=False,
            updating=False,
            fraction=1.0,
            exit_code=exit_code,
            process=None,
            queue=None,
            label="Last detected preview URL",
            cancel_requested=False,
            canceled=False,
            finished_at=time.monotonic_ns(),
            replacement=None,
        )
        _refresh_published_state()
        _launch_replacement(replacement)
        return
    label = "Preview stopped" if exit_code == 0 else f"Preview failed (exit {exit_code})"
    _state.update(
        running=False,
        ready=False,
        watching=False,
        updating=False,
        update_error="",
        url="",
        opened_url="",
        owns_server=True,
        exit_code=exit_code,
        process=None,
        queue=None,
        label=label,
        cancel_requested=False,
        canceled=False,
        finished_at=time.monotonic_ns(),
        replacement=None,
    )
    _refresh_published_state()
    _launch_replacement(replacement)


def _launch_replacement(replacement) -> None:
    if not isinstance(replacement, dict):
        return
    error = start(
        replacement["command"],
        replacement["cwd"],
        blend_path=replacement.get("blend_path"),
        session_id=replacement.get("session_id"),
    )
    if error:
        _remember_diagnostic(
            f"blendlink preview: could not start replacement preview: {error}"
        )


def _drain() -> bool:
    output_queue = _state["queue"]
    if output_queue is None:
        return False
    while True:
        try:
            line = output_queue.get_nowait()
        except queue.Empty:
            break
        _handle_line(line)
        if not _state["running"]:
            return False
    return bool(_state["running"])


def _redraw():
    manager = bpy.context.window_manager
    if manager is None:
        return
    for window in manager.windows:
        for area in window.screen.areas:
            if area.type in {"VIEW_3D", "PROPERTIES"}:
                area.tag_redraw()


def _pump():
    still_running = _drain()
    _redraw()
    return 0.15 if still_running else None


def shutdown():
    cancel()
    if bpy.app.timers.is_registered(_pump):
        bpy.app.timers.unregister(_pump)
    _state.update(
        running=False,
        ready=False,
        watching=False,
        updating=False,
        update_error="",
        url="",
        opened_url="",
        owns_server=True,
        process=None,
        queue=None,
        cancel_requested=False,
        canceled=False,
        finished_at=0,
        blend_path="",
        session_id="",
        generation="",
        update_phase="",
        replacement=None,
    )


def reset_for_tests():
    """Clear remembered process/UI state. Never used by production code."""
    _state.update(
        running=False,
        ready=False,
        watching=False,
        updating=False,
        update_error="",
        fraction=0.0,
        label="",
        url="",
        opened_url="",
        owns_server=True,
        exit_code=None,
        process=None,
        queue=None,
        log_path="",
        cancel_requested=False,
        canceled=False,
        finished_at=0,
        blend_path="",
        session_id="",
        generation="",
        update_phase="",
        replacement=None,
    )
    _state["tail"].clear()
