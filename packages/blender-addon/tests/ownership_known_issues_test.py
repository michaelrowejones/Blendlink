# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure Python tests for artist-facing ownership and version warning data."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import known_issues  # noqa: E402
import ownership  # noqa: E402


class OwnershipTests(unittest.TestCase):
    def project(self, **changes):
        values = {
            "main_camera": None,
            "animation_start": "MANUAL",
            "tone_mapping": "APPLICATION",
            "fog_mode": "APPLICATION",
            "environment_background": "APPLICATION",
            "background_mode": "APPLICATION",
            "environment_lighting": "APPLICATION",
            "shadow_preset": "APPLICATION",
        }
        values.update(changes)
        return SimpleNamespace(**values)

    def test_defaults_leave_application_state_owned_by_the_website(self):
        resolved = {item.key: item for item in ownership.decisions(self.project())}
        self.assertEqual(resolved["camera"].owner, "WEBSITE")
        self.assertEqual(resolved["playback"].owner, "WEBSITE")
        self.assertEqual(resolved["tone"].owner, "WEBSITE")
        self.assertEqual(resolved["fog"].owner, "WEBSITE")
        self.assertEqual(resolved["background"].owner, "WEBSITE")
        self.assertEqual(resolved["shadows"].owner, "WEBSITE")
        self.assertEqual(resolved["integration"].owner, "CONFIG")
        self.assertEqual(resolved["artifacts"].owner, "OUTPUT")

    def test_hdr_background_has_explicit_precedence(self):
        resolved = {item.key: item for item in ownership.decisions(self.project(
            environment_background="GROUNDED", background_mode="COLOR",
        ))}
        self.assertEqual(resolved["background"].owner, "BLEND")
        self.assertIn("HDR Environment owns", resolved["background"].reason)

    def test_scene_fog_names_the_blend_as_owner(self):
        resolved = {item.key: item for item in ownership.decisions(self.project(
            fog_mode="LINEAR",
        ))}
        self.assertEqual(resolved["fog"].owner, "BLEND")
        self.assertIn("distance recipe", resolved["fog"].reason)


class KnownIssueTests(unittest.TestCase):
    def test_checked_in_registry_is_valid_and_evidence_gated(self):
        self.assertEqual(known_issues.load_registry()["issues"], [])

    def test_fixture_matches_only_its_bounded_range(self):
        registry = known_issues.validate_registry({
            "schemaVersion": 1,
            "policy": "Primary evidence only.",
            "issues": [{
                "id": "fixture-export-regression",
                "summary": "Fixture regression.",
                "action": "Use a supported patch release.",
                "severity": "warning",
                "minInclusive": "5.1.0",
                "maxExclusive": "5.1.3",
                "evidence": ["https://projects.blender.org/blender/blender/issues/123"],
            }],
        })
        self.assertEqual(len(known_issues.matching((5, 1, 2), registry)), 1)
        self.assertEqual(known_issues.matching((5, 1, 3), registry), [])

    def test_missing_or_empty_upper_bound_is_rejected(self):
        base = {
            "id": "unbounded-fixture",
            "summary": "Fixture regression.",
            "action": "Use a supported patch release.",
            "severity": "warning",
            "minInclusive": "5.1.0",
            "evidence": ["https://projects.blender.org/blender/blender/issues/123"],
        }
        for value in (None, "", "  "):
            issue = dict(base)
            if value is not None:
                issue["maxExclusive"] = value
            with self.subTest(max_exclusive=value):
                with self.assertRaisesRegex(
                    ValueError,
                    r"issues\[0\]\.maxExclusive must be non-empty text",
                ):
                    known_issues.validate_registry({
                        "schemaVersion": 1,
                        "policy": "Primary evidence only.",
                        "issues": [issue],
                    })

    def test_unsubstantiated_entry_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "primary-source"):
            known_issues.validate_registry({
                "schemaVersion": 1,
                "policy": "Primary evidence only.",
                "issues": [{
                    "id": "hearsay", "summary": "Someone reported it.",
                    "action": "Guess.", "severity": "warning",
                    "minInclusive": "5.1", "maxExclusive": "5.2",
                    "evidence": [],
                }],
            })


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]], verbosity=2)
