"""Prove Blender's bake ray origin changes camera-dependent shader bytes.

Run with Blender 4.2+ in background mode.  This is deliberately a tiny
research oracle: a horizontal quad uses Layer Weight/Facing as emission, so
the ordinary surface-normal bake and an active-camera bake must not agree.
"""

from __future__ import annotations

import json

import bpy
from mathutils import Vector


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

mesh = bpy.data.meshes.new("ViewFromProbe")
mesh.from_pydata(
    [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)],
    [],
    [(0, 1, 2, 3)],
)
mesh.update()
uv = mesh.uv_layers.new(name="UVMap")
for loop, coordinate in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
    loop.uv = coordinate

probe = bpy.data.objects.new("ViewFromProbe", mesh)
bpy.context.scene.collection.objects.link(probe)

material = bpy.data.materials.new("ViewFromProbe")
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
output = nodes.new("ShaderNodeOutputMaterial")
emission = nodes.new("ShaderNodeEmission")
layer_weight = nodes.new("ShaderNodeLayerWeight")
target = nodes.new("ShaderNodeTexImage")
image = bpy.data.images.new("ViewFromProbe", width=32, height=32, alpha=True, float_buffer=True)
target.image = image
nodes.active = target
target.select = True
material.node_tree.links.new(layer_weight.outputs["Facing"], emission.inputs["Color"])
material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
mesh.materials.append(material)

camera_data = bpy.data.cameras.new("ViewFromCamera")
camera = bpy.data.objects.new("ViewFromCamera", camera_data)
bpy.context.scene.collection.objects.link(camera)
camera.location = (0.0, -6.0, 0.25)
camera.rotation_euler = (Vector((0.0, 0.0, 0.0)) - camera.location).to_track_quat("-Z", "Y").to_euler()

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "CYCLES"
scene.cycles.samples = 1
scene.render.bake.use_clear = True
scene.render.bake.margin = 0
bpy.ops.object.select_all(action="DESELECT")
probe.select_set(True)
bpy.context.view_layer.objects.active = probe


def bake_mean(view_from: str) -> float:
    scene.render.bake.view_from = view_from
    bpy.ops.object.bake(type="EMIT", target="IMAGE_TEXTURES", use_clear=True, margin=0, uv_layer="UVMap")
    pixels = tuple(image.pixels)
    covered = [pixels[index] for index in range(0, len(pixels), 4) if pixels[index + 3] > 0.5]
    if not covered:
        raise RuntimeError(f"{view_from} bake produced no covered pixels")
    return sum(covered) / len(covered)


evidence = {
    "blender": bpy.app.version_string,
    "aboveSurfaceMean": bake_mean("ABOVE_SURFACE"),
    "activeCameraMean": bake_mean("ACTIVE_CAMERA"),
}
evidence["absoluteDifference"] = abs(
    evidence["aboveSurfaceMean"] - evidence["activeCameraMean"]
)
if evidence["absoluteDifference"] < 0.2:
    raise RuntimeError(f"active-camera bake did not materially change Layer Weight: {evidence}")
print("BLENDLINK_FIXED_CAMERA_VIEW_FROM " + json.dumps(evidence, sort_keys=True))
