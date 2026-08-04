# SPDX-License-Identifier: GPL-3.0-or-later
"""Contract check for the pure UV/atlas geometry module.

Deliberately imports NO bpy. Until this module was lifted out of bakelib,
the MaxRects receiver allocator that decides where every object lands in
the atlas could only be exercised by running a complete Cycles bake, and
both of its expensive lessons -- the 8192-page VRAM regression and the
fixed-pixel gutter contract saturating at a too-small atlas -- were
learned that way. These are the invariants the bake depends on, asserted
as ordinary numbers in and ordinary numbers out.
"""
import re
import sys
from pathlib import Path


BLENDER_DIR = Path(__file__).resolve().parents[1].parent / "blendlink" / "blender"
sys.path.insert(0, str(BLENDER_DIR))

import uvgeometry  # noqa: E402

# The property is that uvgeometry does not DEPEND on Blender, not that the
# host process lacks it -- this module is also run by the discovered-suite
# runner inside Blender, where bpy is always loaded. Assert against the
# module itself and its source.
assert "bpy" not in vars(uvgeometry), (
    "uvgeometry bound bpy into its namespace; its whole purpose is being "
    "provable without Blender"
)
# An actual import statement, not the word appearing in prose -- the
# module's own docstring explains why it no longer sits behind one.
_source = (BLENDER_DIR / "uvgeometry.py").read_text(encoding="utf-8")
_bpy_import = re.search(r"^\s*(?:import bpy|from bpy\b)", _source, re.MULTILINE)
assert _bpy_import is None, (
    "uvgeometry.py imports bpy; it must stay provable without Blender"
)


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def placements_of(rectangles, edge_gutter, receiver_gutter):
    return uvgeometry.allocate_receiver_rectangles(
        rectangles, edge_gutter=edge_gutter, receiver_gutter=receiver_gutter,
    )


CASES = (
    ("two equal squares", [("a", 0.3, 0.3), ("b", 0.3, 0.3)], 0.01, 0.02),
    ("mixed aspects", [("wide", 0.6, 0.15), ("tall", 0.15, 0.6),
                       ("square", 0.3, 0.3)], 0.02, 0.04),
    ("many small", [(f"r{i}", 0.08, 0.08) for i in range(24)], 0.01, 0.015),
    ("one dominant", [("big", 0.8, 0.8), ("small", 0.05, 0.05)], 0.01, 0.02),
)

for label, rectangles, edge_gutter, receiver_gutter in CASES:
    result = placements_of(rectangles, edge_gutter, receiver_gutter)
    placements = result["placements"]
    scale = result["scale"]

    expect(
        set(placements) == {name for name, _w, _h in rectangles},
        f"{label}: the allocator dropped or invented receivers",
    )
    expect(scale > 0.0, f"{label}: non-positive scale {scale}")

    # Uniform scale: every receiver's width AND height scale by the same
    # factor, or texel density silently differs per object.
    for name, width, height in rectangles:
        left, bottom, right, top = placements[name]
        scale_u = (right - left) / width
        scale_v = (top - bottom) / height
        expect(
            abs(scale_u - scale_v) <= 2e-4 * max(1.0, scale_u),
            f"{label}: {name} changed aspect ({scale_u} by {scale_v})",
        )
        expect(
            abs(scale_u - scale) <= 2e-4 * max(1.0, scale),
            f"{label}: {name} did not use the reported uniform scale",
        )

    # Edge gutter: nothing may sit closer to the atlas border than declared.
    for name, box in placements.items():
        left, bottom, right, top = box
        margin = min(left, bottom, 1.0 - right, 1.0 - top)
        expect(
            margin + 1e-9 >= edge_gutter,
            f"{label}: {name} leaves {margin} at the atlas edge; "
            f"needs {edge_gutter}",
        )

    # Receiver gutter: separate bake writes must not be able to bleed into
    # each other, which is the whole reason the gap is fixed in pixels.
    names = sorted(placements)
    for index, first in enumerate(names):
        for second in names[index + 1:]:
            distance = uvgeometry._uv_bounds_tuple_distance(
                placements[first], placements[second],
            )
            expect(
                distance + 1e-9 >= receiver_gutter,
                f"{label}: {first}/{second} leave {distance}; "
                f"need {receiver_gutter}",
            )

    # Determinism: the bake cache keys on the layout, so an identical
    # request must produce identical bytes.
    expect(
        placements_of(rectangles, edge_gutter, receiver_gutter) == result,
        f"{label}: the allocator is not deterministic",
    )

# Ordering independence: receivers are allocated by measured size, not by
# the caller's iteration order, or two equivalent scenes would disagree.
shuffled = list(reversed(CASES[1][1]))
expect(
    placements_of(shuffled, 0.02, 0.04)
    == placements_of(CASES[1][1], 0.02, 0.04),
    "the allocator depends on input order",
)

print(f"BLENDLINK_UVGEOMETRY_CHECK_PASSED cases={len(CASES)}")
