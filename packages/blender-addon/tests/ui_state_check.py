# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure selection-state checks; runs in Python or Blender without bpy."""
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ui_state  # noqa: E402


class FakeObject(dict):
    def __init__(self, name, object_type="MESH", **properties):
        super().__init__(properties)
        self.name = name
        self.type = object_type

    @property
    def scene(self):
        raise AssertionError("selection summaries must not walk into a scene")


class OnePassSelection:
    def __init__(self, objects):
        self.objects = objects
        self.iterations = 0

    def __iter__(self):
        self.iterations += 1
        if self.iterations > 1:
            raise AssertionError("selection was iterated more than once")
        return iter(self.objects)


class SelectionSummaryTests(unittest.TestCase):
    def test_empty_selection_has_no_single_value(self):
        summary = ui_state.summarize_selection([])
        for dimension in summary.values():
            self.assertEqual(dimension["total"], 0)
            self.assertIsNone(dimension["value"])

    def test_defaults_are_explicit_and_type_appropriate(self):
        summary = ui_state.summarize_selection([
            FakeObject("Cube"),
            FakeObject("SOCKET_Grip", "EMPTY"),
        ])
        self.assertEqual(summary["rendering"], {
            "total": 1,
            "counts": {"AUTO": 1, "DYNAMIC": 0, "BAKED": 0},
            "value": "AUTO",
        })
        self.assertEqual(summary["atlas"], {
            "total": 1, "counts": {"AUTO": 1}, "value": "AUTO",
        })
        self.assertEqual(summary["shadows"]["total"], 1)
        self.assertEqual(summary["shadows"]["value"], "AUTO")
        self.assertEqual(summary["reflections"], {
            "total": 1, "counts": {"SCENE": 1}, "value": "SCENE",
        })
        self.assertEqual(summary["inclusion"]["total"], 2)
        self.assertEqual(summary["inclusion"]["value"], "INCLUDED")
        self.assertEqual(summary["visibility"]["total"], 2)
        self.assertEqual(summary["visibility"]["value"], "VISIBLE")

    def test_mixed_selection_reports_counts_instead_of_active_object_state(self):
        summary = ui_state.summarize_selection([
            FakeObject(
                "Hero", blendlink_dynamic=1, blendlink_atlas="hero",
                blendlink_active=False, blendlink_cast_shadow=True,
                blendlink_receive_shadow=True,
                blendlink_reflection_probe="studio-probe",
            ),
            FakeObject(
                "Ground", blendlink_dynamic=0, blendlink_active=True,
                blendlink_cast_shadow=True, blendlink_receive_shadow=False,
            ),
            FakeObject("Guide-noimp", "EMPTY"),
        ])
        self.assertEqual(summary["rendering"]["value"], ui_state.MIXED)
        self.assertEqual(summary["rendering"]["counts"], {
            "AUTO": 0, "DYNAMIC": 1, "BAKED": 1,
        })
        self.assertEqual(summary["atlas"]["value"], ui_state.MIXED)
        self.assertEqual(summary["atlas"]["counts"], {"AUTO": 1, "hero": 1})
        self.assertEqual(summary["visibility"]["counts"], {"VISIBLE": 2, "HIDDEN": 1})
        self.assertEqual(summary["shadows"]["counts"], {
            "AUTO": 0, "BOTH": 1, "CAST": 1, "RECEIVE": 0, "NONE": 0,
        })
        self.assertEqual(summary["reflections"]["value"], ui_state.MIXED)
        self.assertEqual(summary["reflections"]["counts"], {
            "SCENE": 1, "studio-probe": 1,
        })
        self.assertEqual(summary["inclusion"]["counts"], {"INCLUDED": 2, "EXCLUDED": 1})

    def test_inclusion_uses_vocabulary_precedence_and_number_folding(self):
        summary = ui_state.summarize_inclusion([
            FakeObject("Guide-noimp", blendlink_role="rigid"),
            FakeObject("Anything", blendlink_role="noimp"),
            FakeObject("Duplicate-noimp.001"),
        ])
        self.assertEqual(summary["counts"], {"INCLUDED": 1, "EXCLUDED": 2})
        self.assertEqual(summary["value"], ui_state.MIXED)

    def test_only_namespaced_authoring_properties_affect_state(self):
        obj = FakeObject(
            "Cube", dynamic=1, atlas="legacy", active=False,
            cast_shadow=True, receive_shadow=True, reflection_probe="legacy",
            role="noimp",
        )
        summary = ui_state.summarize_selection([obj])
        self.assertEqual(summary["rendering"]["value"], "AUTO")
        self.assertEqual(summary["atlas"]["value"], "AUTO")
        self.assertEqual(summary["visibility"]["value"], "VISIBLE")
        self.assertEqual(summary["shadows"]["value"], "AUTO")
        self.assertEqual(summary["reflections"]["value"], "SCENE")
        self.assertEqual(summary["inclusion"]["value"], "INCLUDED")

    def test_shadow_modes_cover_partial_and_disabled_overrides(self):
        objects = [
            FakeObject("Receive", blendlink_receive_shadow=True),
            FakeObject(
                "None",
                blendlink_cast_shadow=False,
                blendlink_receive_shadow=False,
            ),
        ]
        summary = ui_state.summarize_shadows(objects)
        self.assertEqual(summary["counts"], {
            "AUTO": 0, "BOTH": 0, "CAST": 0, "RECEIVE": 1, "NONE": 1,
        })
        self.assertEqual(summary["value"], ui_state.MIXED)

    def test_reflection_modes_report_scene_probe_and_mixed_selection(self):
        objects = [
            FakeObject("Scene reflections"),
            FakeObject("Local reflections", blendlink_reflection_probe="hero-probe"),
        ]
        summary = ui_state.summarize_reflections(objects)
        self.assertEqual(summary["counts"], {"SCENE": 1, "hero-probe": 1})
        self.assertEqual(summary["value"], ui_state.MIXED)

    def test_combined_summary_is_one_pass_and_scene_independent(self):
        selection = OnePassSelection([FakeObject("Cube")])
        summary = ui_state.summarize_selection(selection)
        self.assertEqual(selection.iterations, 1)
        self.assertEqual(summary["rendering"]["total"], 1)

    def test_dimension_helpers_share_the_combined_contract(self):
        objects = [FakeObject("A"), FakeObject("B", blendlink_active=False)]
        summary = ui_state.summarize_visibility(objects)
        self.assertEqual(set(summary), {"total", "counts", "value"})
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["value"], ui_state.MIXED)


if __name__ == "__main__":
    # Blender appends its own arguments, which unittest would otherwise parse.
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SelectionSummaryTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    print("BLENDLINK_UI_STATE_CHECK_PASSED")
