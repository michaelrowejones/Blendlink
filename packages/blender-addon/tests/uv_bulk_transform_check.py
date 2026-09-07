# SPDX-License-Identifier: MIT
"""Bulk UV edits must preserve the existing float32 coordinates and pins."""
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import bakelib

mesh = bpy.data.meshes.new('Bulk UV regression')
vertices = [(float(i), 0, 0) for i in range(12000)]
mesh.from_pydata(vertices, [], [(i, i + 1, i + 2) for i in range(0, 12000, 3)])
layer = mesh.uv_layers.new(name='Atlas')
values = np.random.default_rng(71).uniform(-2, 2, len(layer.data) * 2).astype(np.float32)
values[:4] = [0.0, -0.0, 1e-30, -1e-30]
layer.data[0].pin_uv = True
for origin, scale, offset in [(None, (0.314159265, 0.314159265), None),
                               ((-.1, .2), (.73, .73), (.04, .19))]:
    layer.data.foreach_set('uv', values)
    started = time.perf_counter()
    for loop in layer.data:
        if origin is None:
            loop.uv.x *= scale[0]
            loop.uv.y *= scale[1]
        else:
            loop.uv.x = offset[0] + (loop.uv.x - origin[0]) * scale[0]
            loop.uv.y = offset[1] + (loop.uv.y - origin[1]) * scale[1]
    scalar_seconds = time.perf_counter() - started
    expected = np.empty_like(values)
    layer.data.foreach_get('uv', expected)
    layer.data.foreach_set('uv', values)
    started = time.perf_counter()
    bakelib._transform_uv_layer(layer, scale, source_origin=origin, target_origin=offset)
    bulk_seconds = time.perf_counter() - started
    actual = np.empty_like(values)
    layer.data.foreach_get('uv', actual)
    assert np.array_equal(expected.view(np.uint32), actual.view(np.uint32)), 'UV rounding changed'
    assert layer.data[0].pin_uv, 'Bulk edit changed artist pins'
    print('BLENDLINK_UV_TRANSFORM', len(layer.data), scalar_seconds, bulk_seconds, flush=True)
bpy.data.meshes.remove(mesh)
print('BLENDLINK_UV_BULK_TRANSFORM_PASSED')
