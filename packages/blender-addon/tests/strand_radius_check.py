# SPDX-License-Identifier: GPL-3.0-or-later
"""Realized strand radii match native authored endpoints on every supported schema."""
from pathlib import Path
import math
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"blendlink/blender"))
import bakelib

bpy.ops.wm.read_factory_settings(use_empty=True)
data=bpy.data.hair_curves.new("Authored radius contract");data.add_curves([3])
for point,z,radius in zip(data.points,[0,.5,1],[.01,.02,.03]):point.position=(0,0,z);point.radius=radius
owner=bpy.data.objects.new("Authored strand",data);bpy.context.scene.collection.objects.link(owner)
before=tuple((tuple(point.position),point.radius) for point in data.points)
counts=(len(bpy.data.meshes),len(bpy.data.objects),len(bpy.data.node_groups))
mesh=bakelib.realize_object_to_mesh_data(owner,kind="strands",label="Independent strand radius")
try:
    assert mesh.polygons and mesh.vertices
    for z,radius in [(0,.01),(1,.03)]:
        distances=[math.hypot(vertex.co.x,vertex.co.y) for vertex in mesh.vertices if abs(vertex.co.z-z)<1e-6]
        assert distances and max(abs(value-radius) for value in distances)<2e-6,(z,radius,distances)
    assert before==tuple((tuple(point.position),point.radius) for point in data.points)
finally:bpy.data.meshes.remove(mesh)
assert counts==(len(bpy.data.meshes),len(bpy.data.objects),len(bpy.data.node_groups)),"Realization leaked temporary resources"
print("BLENDLINK_STRAND_RADIUS_PASSED",bpy.app.version_string)
