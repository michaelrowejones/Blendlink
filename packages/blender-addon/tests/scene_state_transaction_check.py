# SPDX-License-Identifier: GPL-3.0-or-later
"""Contract check for the scene-state transaction.

Blender-side code borrows global mutable state - modes, selections, tool
settings, world and render assignments - in 18 hand-written acquire and
release pairs, and the protocol that makes a FAILED restore diagnosable
was hand-written at least four times. Every copy is a chance to drop a
restore on the failure path, which is the one path no bake test reaches:
provoking it previously meant inducing a real mid-bake failure.

These assertions state the protocol directly, with no Blender state
involved at all.
"""
import importlib.util
import sys
from pathlib import Path


BLENDER_DIR = Path(__file__).resolve().parents[1].parent / "blendlink" / "blender"

spec = importlib.util.spec_from_file_location(
    "blendlink_transaction_bakelib", BLENDER_DIR / "bakelib.py",
)
bakelib = importlib.util.module_from_spec(spec)
sys.modules["blendlink_transaction_bakelib"] = bakelib
spec.loader.exec_module(bakelib)

scene_state_transaction = bakelib.scene_state_transaction


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


class BodyError(RuntimeError):
    pass


class RestoreError(RuntimeError):
    pass


# --- Restores run, in reverse registration order -----------------------
order = []
with scene_state_transaction("ordering") as state:
    state.on_restore("first", lambda: order.append("first"))
    state.on_restore("second", lambda: order.append("second"))
expect(
    order == ["second", "first"],
    f"restores must unwind in reverse registration order, got {order}",
)


# --- A failing body still releases, and keeps its own error ------------
released = []
try:
    with scene_state_transaction("failing body") as state:
        state.on_restore("mode", lambda: released.append("mode"))
        raise BodyError("the bake failed")
except BodyError:
    pass
else:
    raise AssertionError("the transaction swallowed the body's error")
expect(released == ["mode"], "a failing body skipped its restore")


# --- One failing restore does not prevent the others -------------------
released = []


def failing_restore():
    raise RestoreError("could not restore sync")


try:
    with scene_state_transaction("failing restore") as state:
        state.on_restore("first", lambda: released.append("first"))
        state.on_restore("sync", failing_restore)
        state.on_restore("last", lambda: released.append("last"))
except RuntimeError as error:
    expect(
        "failing restore could not restore Blender state" in str(error),
        f"unexpected cleanup error text: {error}",
    )
    expect("sync: could not restore sync" in str(error),
           f"the cleanup error did not name the failing step: {error}")
else:
    raise AssertionError("a failing restore did not raise")
expect(
    released == ["last", "first"],
    f"a failing restore blocked the others, got {released}",
)


# --- A cleanup failure reports the body's error as its CAUSE -----------
# The bake that failed for one reason and then failed to clean up must
# still say why it failed in the first place.
try:
    with scene_state_transaction("both failed") as state:
        state.on_restore("sync", failing_restore)
        raise BodyError("the original cause")
except RuntimeError as error:
    expect(isinstance(error.__cause__, BodyError),
           f"the body's error was not the cause: {error.__cause__!r}")
    expect(str(error.__cause__) == "the original cause",
           f"the original cause was lost: {error.__cause__}")
else:
    raise AssertionError("a failing restore after a failing body did not raise")


# --- A clean run raises nothing ----------------------------------------
with scene_state_transaction("clean") as state:
    state.on_restore("noop", lambda: None)

print("BLENDLINK_SCENE_STATE_TRANSACTION_CHECK_PASSED")
