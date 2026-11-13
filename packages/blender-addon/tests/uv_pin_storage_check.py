# SPDX-License-Identifier: GPL-3.0-or-later
"""UV copies preserve pins without stale RNA after optional attribute creation."""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import bakelib

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("Pin storage regression")
vertices, faces = [], []
for index in range(100):
    start = len(vertices)
    vertices.extend([(index, 0, 0), (index + .5, 0, 0),
                     (index + .5, .5, 0), (index, .5, 0)])
    faces.append(tuple(range(start, start + 4)))
mesh.from_pydata(vertices, [], faces)
mesh.update()
owner = bpy.data.objects.new("Pin storage owner", mesh)
bpy.context.scene.collection.objects.link(owner)
source = mesh.uv_layers.new(name="Source UV")
for index, loop in enumerate(source.data):
    loop.uv = ((index % 17) / 32, (index % 23) / 32)
original = tuple(tuple(loop.uv) for loop in source.data)

# This was a native heap-corruption crash in 4.2 when copying coordinates
# and assigning pin_uv=False inside the same collection iterator.
assert bakelib.stage_atlas_layers([owner]) == []
bpy.context.view_layer.update()
target = mesh.uv_layers[bakelib.ATLAS_UV]
assert tuple(tuple(loop.uv) for loop in target.data) == original
assert bakelib._uv_layer_pin_mask(target) == [False] * 400
assert tuple(tuple(loop.uv) for loop in mesh.uv_layers["Source UV"].data) == original

# Materialize previously absent pin storage, bulk-copy an irregular mask,
# clear existing pins, and preserve the layer's coordinates throughout.
mask = [index % 7 == 3 for index in range(400)]
target = bakelib.set_uv_layer_pin_mask(target, mask)
bpy.context.view_layer.update()
assert bakelib._uv_layer_pin_mask(target) == mask
assert tuple(tuple(loop.uv) for loop in target.data) == original
target = bakelib.set_uv_layer_pin_mask(target, [False] * 400)
bpy.context.view_layer.update()
assert not bakelib._uv_layer_has_pins(target)
try:
    bakelib.set_uv_layer_pin_mask(target, [True])
except RuntimeError as error:
    assert "corner count" in str(error)
else:
    raise AssertionError("A mismatched pin mask was admitted")

# The authored layer supplies its pin mask; the source stays untouched.
authored = mesh.uv_layers.new(name=bakelib.AUTHORED_UV)
authored = bakelib.set_uv_layer_pin_mask(authored, mask)
for index, loop in enumerate(authored.data):
    loop.uv = original[index]
assert bakelib.stage_atlas_layers([owner]) == [owner.name]
bpy.context.view_layer.update()
assert bakelib._uv_layer_pin_mask(mesh.uv_layers[bakelib.ATLAS_UV]) == mask
assert bakelib._uv_layer_pin_mask(mesh.uv_layers[bakelib.AUTHORED_UV]) == mask
assert tuple(tuple(loop.uv) for loop in mesh.uv_layers[bakelib.AUTHORED_UV].data) == original

# Empty meshes do not materialize an optional attribute or access corner 0.
empty = bpy.data.meshes.new("Empty pin storage")
layer = empty.uv_layers.new(name="Empty UV")
assert len(bakelib.set_uv_layer_pin_mask(layer, []).data) == 0
print("BLENDLINK_UV_PIN_STORAGE_PASSED", bpy.app.version_string)
