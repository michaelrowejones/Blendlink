# SPDX-License-Identifier: GPL-3.0-or-later
"""Spatial gutter candidates must preserve the exhaustive distance proof."""
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import uvgeometry

randomizer = random.Random(912)
cases = [[], [(0, 0, 1, 1)], [(0, 0, 1, 1)] * 8]
for _ in range(80):
    rectangles = []
    for _ in range(70):
        x, y = randomizer.uniform(-2, 2), randomizer.uniform(-2, 2)
        rectangles.append((x, y, x + randomizer.random(), y + randomizer.random()))
    cases.append(rectangles)
cases.append([(0, 0, 0, 0), (.1, 0, .1, 0),
              (math.nextafter(.1, 0), 0, .1, 0), (0, .1, 0, .1)])
for rectangles in cases:
    for radius in [0, .1, 2e-6, 1.5]:
        expected = {(i, j) for i in range(len(rectangles)) for j in range(i + 1, len(rectangles))
                    if uvgeometry._uv_bounds_tuple_distance(rectangles[i], rectangles[j]) <= radius}
        pairs = list(uvgeometry.nearby_uv_bounds_pairs(rectangles, radius))
        assert len(pairs) == len(set(pairs)), 'Duplicate pair'
        assert all(i < j for i, j in pairs), 'Pair lost original indices'
        actual = {(i, j) for i, j in pairs
                  if uvgeometry._uv_bounds_tuple_distance(rectangles[i], rectangles[j]) <= radius}
        assert actual == expected, 'Spatial search omitted a possible gutter violation'

# Thousands of separate charts should not require millions of distance tests.
grid = [(x * .02, y * .02, x * .02 + .01, y * .02 + .01)
        for y in range(40) for x in range(40)]
pairs = list(uvgeometry.nearby_uv_bounds_pairs(grid, .005))
assert not pairs, f'Separate charts produced {len(pairs)} unnecessary distance tests'
print('BLENDLINK_UV_GUTTER_SEARCH_PASSED', len(cases), 'cases', len(grid), 'separate charts')
