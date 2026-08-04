# SPDX-License-Identifier: GPL-3.0-or-later
"""Non-blocking website-task runner.

Spawns the project's sync command as a subprocess, reads its output on a
worker thread (which never touches bpy), and drains results on the main
thread via a bpy.app.timers timer — the blessed thread pattern from the
Blender docs. ##blendlink progress lines drive the panel's progress bar.
"""
from __future__ import annotations

import collections
import json
import os
import queue
import subprocess
import threading
import time

import bpy

_state = {
    "running": False,
    "fraction": 0.0,
    "label": "",
    "tail": collections.deque(maxlen=60),
    "exit_code": None,  # None until a run has finished
    "command": "",
    "process": None,
    "queue": None,
    "log_path": "",
    "cancel_requested": False,
    "canceled": False,
    "finished_at": 0,
}

_PROGRESS_PREFIX = "##blendlink "


def is_running() -> bool:
    return _state["running"]


def progress() -> tuple[float, str]:
    return _state["fraction"], _state["label"]


def last_exit_code():
    return _state["exit_code"]


def last_log_path() -> str:
    return _state["log_path"]


def last_message() -> str:
    """The most explanatory line the process produced, for the failure box.

    The last line is often the least useful one - a stack frame, a progress
    remnant, or an internal diagnostic - and it was being drawn verbatim as
    the explanation under "Website task failed". Prefer the most recent line
    that actually names an error, and never return an empty string as the
    body of an alert.
    """
    tail = [str(line).strip() for line in _state["tail"] if str(line).strip()]
    if not tail:
        return ""
    for line in reversed(tail):
        lowered = line.lower()
        if "error" in lowered or "failed" in lowered or "blocked" in lowered                 or lowered.startswith("refus"):
            return line
    return tail[-1]


def was_canceled() -> bool:
    return bool(_state["canceled"])


def last_finished_at() -> int:
    return int(_state["finished_at"])


def _log_dir() -> str:
    try:
        return bpy.utils.extension_path_user(__package__, create=True)
    except Exception as error:
        import tempfile
        fallback = tempfile.gettempdir()
        print(
            "blendlink build: extension log directory unavailable; "
            f"using {fallback}: {type(error).__name__}: {error}",
            flush=True,
        )
        return fallback


def _reader(process, output_queue):
    """Worker thread: forward subprocess lines. Never touches bpy."""
    for line in process.stdout:
        output_queue.put(line.rstrip("\n"))
    process.stdout.close()
    output_queue.put(("__exit__", process.wait()))


def _remember_diagnostic(message: str) -> None:
    """Keep runner/protocol failures visible in Blender and the build log."""
    print(message, flush=True)
    _state["tail"].append(message)
    _state["label"] = "Website task output needs attention — see console/log"
    if not _state["log_path"]:
        return
    try:
        with open(_state["log_path"], "a", encoding="utf8") as handle:
            handle.write(message + "\n")
    except OSError as error:
        fallback = f"blendlink build: could not append diagnostic log: {error}"
        print(fallback, flush=True)
        _state["tail"].append(fallback)
        _state["log_path"] = ""


def start(
    command: str,
    cwd: str,
    *,
    initial_label: str = "Starting website task",
) -> str | None:
    """Launch one website task; returns an error message or None."""
    if _state["running"]:
        return "A sync is already running"
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
    _state.update(
        running=True, fraction=0.0, label=initial_label, exit_code=None,
        command=command, process=process, queue=output_queue,
        log_path=os.path.join(_log_dir(), "sync-log.txt"),
        cancel_requested=False, canceled=False,
        finished_at=0,
    )
    _state["tail"].clear()
    try:
        with open(_state["log_path"], "w", encoding="utf8") as handle:
            handle.write(f"$ {command}\n")
    except OSError as error:
        _state["log_path"] = ""
        _remember_diagnostic(f"blendlink build: could not create diagnostic log: {error}")
    threading.Thread(target=_reader, args=(process, output_queue), daemon=True).start()
    if not bpy.app.background:
        bpy.app.timers.register(_pump, first_interval=0.1)
    return None


def cancel():
    process = _state["process"]
    if process is None or process.poll() is not None:
        return
    _state["cancel_requested"] = True
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        process.kill()


def _handle_line(line):
    if isinstance(line, tuple):  # ("__exit__", code)
        _finish(line[1])
        return
    if _state["log_path"]:
        try:
            with open(_state["log_path"], "a", encoding="utf8") as handle:
                handle.write(line + "\n")
        except OSError as error:
            _remember_diagnostic(f"blendlink build: could not write diagnostic log: {error}")
    if line.startswith(_PROGRESS_PREFIX):
        try:
            payload = json.loads(line[len(_PROGRESS_PREFIX):])
            _state["fraction"] = float(payload.get("fraction", _state["fraction"]))
            _state["label"] = str(payload.get("label", _state["label"]))
        except (ValueError, TypeError) as error:
            _remember_diagnostic(
                "blendlink build: malformed progress protocol "
                f"({type(error).__name__}: {error}); raw line: {line}"
            )
        return
    if line.strip():
        _state["tail"].append(line)


def _finish(exit_code: int):
    canceled = bool(_state["cancel_requested"])
    _state.update(
        running=False,
        exit_code=exit_code,
        process=None,
        queue=None,
        cancel_requested=False,
        canceled=canceled,
        finished_at=time.monotonic_ns(),
    )
    if canceled:
        _state["label"] = "Website task canceled"
    elif exit_code == 0:
        _state["fraction"], _state["label"] = 1.0, "done"
    from . import syncstatus, validation
    syncstatus.refresh(force=True)
    validation.mark_dirty()


def _drain() -> bool:
    """Drain queued lines on the main thread; True while still running."""
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
    return _state["running"]


def _redraw():
    from . import handlers
    handlers._tag_redraw_ui()


def _pump():
    still_running = _drain()
    _redraw()
    return 0.15 if still_running else None


def shutdown():
    """Addon unregister: kill any running sync and its pump timer."""
    cancel()
    if bpy.app.timers.is_registered(_pump):
        bpy.app.timers.unregister(_pump)
    _state.update(
        running=False, process=None, queue=None,
        cancel_requested=False, canceled=False,
    )


def reset_for_tests():
    """Clear remembered process/UI state. Never used by production code."""
    _state.update(
        running=False,
        fraction=0.0,
        label="",
        exit_code=None,
        command="",
        process=None,
        queue=None,
        log_path="",
        cancel_requested=False,
        canceled=False,
        finished_at=0,
    )
    _state["tail"].clear()


def drain_blocking(timeout_seconds: float = 300.0) -> int:
    """Headless/test path: wait for the run to finish, draining inline."""
    import time
    deadline = time.monotonic() + timeout_seconds
    while _state["running"] and time.monotonic() < deadline:
        if not _drain():
            break
        time.sleep(0.05)
    if _state["running"]:
        cancel()
        raise TimeoutError(f"sync did not finish within {timeout_seconds}s")
    return _state["exit_code"]
