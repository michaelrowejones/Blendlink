# SPDX-License-Identifier: GPL-3.0-or-later
"""Native artist task regressions: paths, planning and malformed progress."""
import importlib.util
import json
import math
import queue
import sys
import tempfile
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import bpy


bpy.ops.wm.read_factory_settings(use_empty=False)
addon_root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "blendlink_desktop_task_check", addon_root / "__init__.py",
    submodule_search_locations=[str(addon_root)],
)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
addon.register()
native_state = ExitStack()


try:
    # A bad compiler line must not kill the main-thread timer or poison its
    # progress widget. Subsequent output and process completion must still drain.
    for runner in (addon.previewrun, addon.syncrun):
        for payload in ([], None, True, {"fraction": float("nan")},
                        {"fraction": float("inf")}, {"fraction": True},
                        {"fraction": 10 ** 500},
                        {"label": ["unexpected"]}):
            runner.reset_for_tests()
            output = queue.Queue()
            runner._state.update(running=True, queue=output, fraction=0.3)
            output.put("##blendlink " + json.dumps(payload))
            output.put('##blendlink {"fraction":0.7,"label":"Recovered stage"}')
            assert runner._drain(), "Malformed output ended the task pump"
            assert runner.progress() == (0.7, "Recovered stage")
            assert "malformed progress protocol" in "\n".join(runner._state["tail"])
            output.put(("__exit__", 0))
            with patch.object(addon.syncstatus, "refresh", return_value=False):
                assert not runner._drain()
            assert runner.last_exit_code() == 0
        runner.reset_for_tests()
        for value, expected in ((-0.5, 0.0), (1.5, 1.0)):
            runner._handle_line("##blendlink " + json.dumps({"fraction": value}))
            assert runner.progress()[0] == expected
            assert math.isfinite(runner.progress()[0])
        runner.reset_for_tests()

    with tempfile.TemporaryDirectory(prefix="blendlink-desktop-task-") as temporary:
        source = Path(temporary) / "Scene With Spaces.blend"
        bpy.ops.blendlink.setup_website_export()
        bpy.ops.wm.save_as_mainfile(filepath=str(source))
        if bpy.app.background and bpy.app.version[:3] == (4, 2, 0):
            # 4.2 clears file_saved through its GUI notification loop. Model
            # the post-notification state for these task/measurement checks;
            # the real native save and its disk contents are tested separately
            # in save_before_publish_check.py. Nested dirty-state controls below
            # still exercise actual measurement invalidation.
            native_state.enter_context(patch.object(addon.syncrun, "bpy", SimpleNamespace(
                data=SimpleNamespace(filepath=bpy.data.filepath, is_dirty=False))))
        calls, reports = [], []

        def capture_task(command, cwd, *, initial_label):
            calls.append((command, cwd, initial_label))
            return None

        def command(blend_path, arguments, *, cwd=None):
            return arguments, cwd or str(source.parent)

        operator = SimpleNamespace(
            directory="//Website With Spaces/",
            report=lambda levels, message: reports.append((levels, message)),
        )
        with patch.object(addon.ops, "_desktop_cli_command", side_effect=command), \
                patch.object(addon.syncrun, "start", side_effect=capture_task):
            result = addon.ops.BLENDLINK_OT_export_website.execute(operator, bpy.context)
        assert result == {"FINISHED"}, reports
        arguments = calls[-1][0]
        assert Path(arguments[arguments.index("--out") + 1]).resolve() == (source.parent / "Website With Spaces").resolve(), arguments
        assert source.is_file()

        # A task may start while the native folder picker is open. Reject the
        # delayed action before stamping IDs or saving another scene revision.
        calls.clear()
        addon.syncrun._state["running"] = True
        with patch.object(addon.ops, "_ensure_scene_ids") as ids, \
                patch.object(addon.ops, "_save_before_publish") as save:
            assert addon.ops.BLENDLINK_OT_export_website.execute(operator, bpy.context) == {"CANCELLED"}
            ids.assert_not_called()
            save.assert_not_called()
        assert "Another website task" in reports[-1][1]
        addon.syncrun.reset_for_tests()

        # Standalone artists can measure Final capacity before a costly export
        # without stopping their idle Live Preview or creating a web project.
        addon.previewrun._state.update(
            running=True, watching=True, ready=True,
            url="http://127.0.0.1:5173/",
            blend_path=addon.previewrun._canonical_blend_path(bpy.data.filepath),
        )
        addon.previewrun._state["updating"] = True
        assert not addon.ops.BLENDLINK_OT_check_atlas_fit.poll(bpy.context)
        addon.previewrun._state["updating"] = False
        with patch.object(addon.syncstatus, "project_root", return_value=None), \
                patch.object(addon.syncstatus, "refresh", return_value=False), \
                patch.object(addon.ops, "_desktop_cli_command", side_effect=command), \
                patch.object(addon.syncrun, "start", side_effect=capture_task):
            assert addon.ops.BLENDLINK_OT_check_atlas_fit.poll(bpy.context)
            assert addon.ops.BLENDLINK_OT_check_atlas_fit.execute(operator, bpy.context) == {"FINISHED"}, reports
        assert calls[-1][0] == ["plan", "--blend", bpy.data.filepath]
        assert calls[-1][2] == "Checking Final atlas fit"
        with patch.object(addon.syncstatus, "project_root", return_value=str(source.parent)), \
                patch.object(addon.syncstatus, "refresh", return_value=False), \
                patch.object(addon.ops, "_desktop_cli_command", side_effect=command), \
                patch.object(addon.syncrun, "start", side_effect=capture_task):
            assert addon.ops.BLENDLINK_OT_check_atlas_fit.execute(operator, bpy.context) == {"FINISHED"}, reports
        assert calls[-1][0] == ["plan"]

        bpy.ops.wm.save_mainfile()
        source_identity = addon.syncrun._source_identity(bpy.data.filepath)
        addon.syncrun._state.update(
            source_blend=source_identity,
            source_stamp=addon.syncrun._source_stamp(bpy.data.filepath),
        )
        prior_status = addon.syncstatus.status()
        plan = {"atlases": {"main": {"occupancy": 0.5}}, "objects": []}

        def measured(value, source_path=source_identity):
            addon.syncrun._handle_line("##blendlink " + json.dumps({
                "fraction": 1, "label": "Final atlas measured",
                "atlasPlan": {"sourceBlend": source_path, "quality": "final", "plan": value},
            }))

        measured(plan)
        assert addon.syncrun.atlas_plan_measurement()["current"]
        assert addon.ui._atlas_capacity_plan() == plan
        assert addon.ui._atlas_plan_result(bpy.context.scene.blendlink_project.atlases[0]) == {"occupancy": 0.5}
        assert addon.syncstatus.status() == prior_status, "A measurement falsely marked the website published"
        for malformed in (
            {},
            {"plan": []},
            {"plan": {"atlases": ["bad"]}},
            {"plan": {"atlases": {"main": ["bad"]}}},
            {"plan": {"atlases": {"main": {}}}},
            {"plan": {"atlases": {"main": {"occupancy": "bad"}}}},
            {"plan": {"atlases": {"main": {"occupancy": float("nan")}}}},
            {"plan": {"atlases": {"main": {"occupancy": 0.2, "compositionDetail": []}}}},
            {"plan": {"atlases": {"main": {"occupancy": 0.2, "compositionDetail": {"cssWidth": float("inf")}}}}},
        ):
            addon.syncrun._handle_line("##blendlink " + json.dumps({
                "fraction": 1, "label": "Malformed measurement",
                "atlasPlan": {"sourceBlend": source_identity, "quality": "final", **malformed},
            }))
            assert addon.ui._atlas_capacity_plan() == plan, "Malformed plan replaced verified capacity"
            assert "malformed progress protocol" in addon.syncrun.last_message()
        measured(plan)
        assert addon.syncrun.progress() == (1.0, "Final atlas measured"), "Valid plan did not recover after malformed output"
        measured({"atlases": {}}, str(source.parent / "Another Scene.blend"))
        assert addon.ui._atlas_capacity_plan() == plan, "Another scene replaced this file's measurement"
        bpy.context.scene["unsaved_measurement_edit"] = True
        # Background RNA assignments do not set Blender's interactive dirty
        # flag. Exercise that public signal explicitly, then a real saved edit.
        with patch.object(addon.syncrun, "bpy", SimpleNamespace(data=SimpleNamespace(
            filepath=bpy.data.filepath, is_dirty=True,
        ))):
            assert not addon.syncrun.atlas_plan_measurement()["current"]
        bpy.ops.wm.save_mainfile()
        assert not addon.syncrun.atlas_plan_measurement()["current"], "Saved changes retained a fresh measurement"
        # An in-flight older plan also stays stale after a save.
        measured(plan)
        assert not addon.syncrun.atlas_plan_measurement()["current"]
        addon.syncrun._state["source_stamp"] = addon.syncrun._source_stamp(bpy.data.filepath)
        measured(None)
        assert addon.syncrun.atlas_plan_measurement()["current"]
        with patch.object(addon.syncstatus, "bake_plan", return_value=plan):
            assert addon.ui._atlas_capacity_plan() == {}, "A realtime-only measurement kept an old bake plan"
finally:
    native_state.close()
    addon.previewrun.reset_for_tests()
    addon.syncrun.reset_for_tests()
    addon.unregister()

print("BLENDLINK_DESKTOP_TASK_CHECK_PASSED")
