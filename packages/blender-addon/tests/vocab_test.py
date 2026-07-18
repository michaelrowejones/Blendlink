# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure-Python vocab tests — run with any Python 3.10+, no bpy required."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import vocab  # noqa: E402


class ClassifyTests(unittest.TestCase):
    def test_collider_family(self):
        c = vocab.classify("Crate-colonly")
        self.assertEqual((c.kind, c.base, c.shape, c.proxy_only), ("collider", "Crate", "trimesh", True))
        c = vocab.classify("Dome_ConvCol")
        self.assertEqual((c.shape, c.proxy_only), ("convex", False))
        self.assertEqual(vocab.classify("Fence-col").shape, "trimesh")

    def test_anchors(self):
        self.assertEqual(vocab.classify("SOCKET_Muzzle").anchor_name, "Muzzle")
        self.assertEqual(vocab.classify("HOTSPOT_Info").kind, "hotspot")
        self.assertEqual(vocab.classify("AUDIO_Hum").kind, "audio")

    def test_lod_rigid_noimp(self):
        self.assertEqual(vocab.classify("Rock_LOD2").lod_index, 2)
        self.assertEqual(vocab.classify("Barrel-rigid").kind, "rigid")
        self.assertEqual(vocab.classify("Grid-noimp").kind, "noimp")

    def test_plain_names_pass(self):
        self.assertIsNone(vocab.classify("Crate"))
        self.assertIsNone(vocab.classify("Protocol"))  # 'col' not at a separator


class NumberedTests(unittest.TestCase):
    def test_numbered_hides_suffix_token(self):
        self.assertIsNone(vocab.classify("Crate-colonly.001"))
        self.assertEqual(vocab.numbered_token("Crate-colonly.001"), "Crate-colonly")
        self.assertEqual(vocab.fix_numbered("Crate-colonly.001"), "Crate.001-colonly")
        self.assertEqual(vocab.fix_numbered("Rock_LOD1.002"), "Rock.002_LOD1")

    def test_numbered_anchor_still_parses(self):
        self.assertEqual(vocab.classify("SOCKET_Top.001").kind, "socket")
        self.assertIsNone(vocab.numbered_token("SOCKET_Top.001"))

    def test_plain_numbered_untouched(self):
        self.assertIsNone(vocab.numbered_token("Crate.001"))
        self.assertEqual(vocab.fix_numbered("Crate.001"), "Crate.001")


class StripTests(unittest.TestCase):
    def test_strip_structural(self):
        self.assertEqual(vocab.strip_structural("Crate-colonly"), "Crate")
        self.assertEqual(vocab.strip_structural("Rock_LOD3"), "Rock")
        self.assertEqual(vocab.strip_structural("Crate"), "Crate")

    def test_strip_anchor(self):
        self.assertEqual(vocab.strip_anchor("SOCKET_Muzzle"), "Muzzle")
        self.assertEqual(vocab.strip_anchor("Muzzle"), "Muzzle")


class LintTests(unittest.TestCase):
    def test_near_miss(self):
        issues = vocab.lint([vocab.SceneNode("Wall-collonly")])
        self.assertTrue(any("did not match" in i.message for i in issues))

    def test_numbered_fixable(self):
        issues = vocab.lint([vocab.SceneNode("Crate-colonly.001")])
        self.assertTrue(any(i.fixable_numbered for i in issues))

    def test_lod_gap_and_missing_zero(self):
        issues = vocab.lint([
            vocab.SceneNode("Rock_LOD1", extras={"lod_distance": 10}),
            vocab.SceneNode("Rock_LOD3", extras={"lod_distance": 30}),
        ])
        self.assertTrue(any("gaps" in i.message for i in issues))
        self.assertTrue(any("no LOD0" in i.message for i in issues))

    def test_anchor_with_geometry(self):
        issues = vocab.lint([vocab.SceneNode("SOCKET_Oops", is_empty=False)])
        self.assertTrue(any("usually Empties" in i.message for i in issues))

    def test_clean_scene(self):
        issues = vocab.lint([
            vocab.SceneNode("Crate"),
            vocab.SceneNode("Crate-colonly"),
            vocab.SceneNode("SOCKET_Top", is_empty=True),
            vocab.SceneNode("Rock_LOD0"),
            vocab.SceneNode("Rock_LOD1", extras={"lod_distance": 12}),
        ])
        self.assertEqual(issues, [])


if __name__ == "__main__":
    # Explicit argv so this also runs under `blender --python` (whose sys.argv
    # carries Blender's own flags, which unittest would choke on).
    unittest.main(argv=[sys.argv[0]], verbosity=2)
