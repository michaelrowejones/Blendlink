# SPDX-License-Identifier: GPL-3.0-or-later
"""Artist-facing summaries of desktop tool failures; full logs stay intact."""
from __future__ import annotations


def last_task_message(output) -> str:
    lines = [str(line).strip() for line in output if str(line).strip()]
    # npm marks its debug-log locator as an error too. It follows the real
    # cause, so a reverse search otherwise hides first-install failures.
    useful = [line for line in lines if not line.lower().startswith((
        "npm error a complete log of this run can be found in:",
        "npm err! a complete log of this run can be found in:",
    )) and line.lower() not in {"npm error", "npm err!"}]
    if not useful:
        return ""
    for line in reversed(useful):
        lowered = line.lower()
        if ("error" in lowered or "failed" in lowered or "blocked" in lowered
                or lowered.startswith(("refus", "npm err!"))):
            if lowered.startswith(("npm error", "npm err!")) and any(
                item.lower() in {"npm error code enotcached", "npm err! code enotcached"}
                for item in useful
            ):
                return ("The website tools needed for this action are not cached for offline use. "
                        "Enable Allow Online Access in Blender Preferences → System, "
                        "then retry this action. Open Log for the download details.")
            return line
    return useful[-1]
