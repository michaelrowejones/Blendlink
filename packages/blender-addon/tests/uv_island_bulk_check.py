# SPDX-License-Identifier: MIT
"""Bulk UV reads preserve seam-aware and exact-weld island models."""
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import bakelib

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Bulk islands')
side = 50
mesh.from_pydata([(x / side, y / side, 0) for y in range(side + 1) for x in range(side + 1)], [],
                 [(y * (side + 1) + x, y * (side + 1) + x + 1,
                   (y + 1) * (side + 1) + x + 1, (y + 1) * (side + 1) + x)
                  for y in range(side) for x in range(side)])
layer = mesh.uv_layers.new(name='UVMap')
for loop in mesh.loops:
    layer.data[loop.index].uv = mesh.vertices[loop.vertex_index].co[:2]

class CountedCollection:
    def __init__(self, values):
        self.values = values
        self.reads = 0
    def __len__(self):
        return len(self.values)
    def __getitem__(self, key):
        self.reads += 1
        return self.values[key]
    def foreach_get(self, *args):
        return self.values.foreach_get(*args)

loops, edges, uv_data = map(CountedCollection, (mesh.loops, mesh.edges, layer.data))
view = SimpleNamespace(polygons=mesh.polygons, loops=loops, edges=edges)
uv_view = SimpleNamespace(data=uv_data)
started = time.perf_counter()
roots, numbers = bakelib._uv_polygon_islands(view, uv_view)
welded = bakelib._uv_welded_island_pairs(view, uv_view, roots)
elapsed = time.perf_counter() - started
assert roots == [0] * len(mesh.polygons) and numbers == {0: 1} and welded == {0: 0}
reads = loops.reads + edges.reads + uv_data.reads
print('BLENDLINK_UV_ISLAND_TIMING', elapsed, 'scalar_reads', reads, flush=True)
assert reads == 0, f'Island analysis made {reads} individual RNA reads'

for edge in mesh.edges:
    edge.use_seam = True
roots, numbers = bakelib._uv_polygon_islands(mesh, layer)
assert roots == list(range(len(mesh.polygons))), 'Seams no longer split topological islands'
assert set(bakelib._uv_welded_island_pairs(mesh, layer, roots).values()) == {0}, 'Seams split rigid packer units'
# The last polygon now has a distinct UV chart. Coincident charts elsewhere
# remain welded, while this one must require its own gutter.
last = mesh.polygons[-1]
for index in last.loop_indices:
    layer.data[index].uv.x += .25
roots, _ = bakelib._uv_polygon_islands(mesh, layer)
welded = bakelib._uv_welded_island_pairs(mesh, layer, roots)
assert welded[last.index] == last.index and len(set(welded.values())) == 2
bpy.data.meshes.remove(mesh)

# The topological tolerance must not leak into the packer's exact weld test.
for seam in (False, True):
    for delta in (0.0, 5e-8, 2e-7):
        mesh = bpy.data.meshes.new('Weld threshold')
        mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0)], [],
                         [(0, 1, 2), (1, 3, 2)])
        layer = mesh.uv_layers.new(name='UVMap')
        coordinates = [(.2, .2), (.4, .2), (.2, .4),
                       (.4 + delta, .2), (.4, .4), (.2 + delta, .4)]
        for item, coordinate in zip(layer.data, coordinates):
            item.uv = coordinate
        for edge in mesh.edges:
            edge.use_seam = seam
        roots, _ = bakelib._uv_polygon_islands(mesh, layer)
        assert len(set(roots)) == (2 if seam or delta > 1e-7 else 1)
        welded = bakelib._uv_welded_island_pairs(mesh, layer, roots)
        assert len(set(welded.values())) == (1 if not seam and delta < 1e-7 or delta == 0 else 2)
        bpy.data.meshes.remove(mesh)
print('BLENDLINK_UV_ISLAND_BULK_PASSED')
