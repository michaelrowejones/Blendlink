# SPDX-License-Identifier: MIT
"""Generate the bundled sample scene: a small, CLEAN vocabulary showcase.

Run:  blender --background --factory-startup --python scripts/make-sample-blend.py -- packages/blendlink/assets/sample.blend
"""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(
    Path(__file__).resolve().parents[1] / "packages" / "blendlink" / "blender"
))
import bakelib  # noqa: E402

out_path = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24


def material(name, color, roughness=0.7):
    mat = bpy.data.materials.new(name)
    bakelib.ensure_shader_node_tree(mat)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def cube(name, location, size=1.0):
    bpy.ops.mesh.primitive_cube_add(size=size, location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj


# A ground plane and a crate — friendly, readable names.
ground = cube("Ground", (0, 0, -0.05), size=6)
ground.scale.z = 0.02
ground.data.materials.append(material("GroundPaint", (0.82, 0.78, 0.72)))

crate = cube("Crate", (0, 0, 0.5))
crate.data.materials.append(material("CrateWood", (0.55, 0.38, 0.22)))

# Vocabulary showcase, all clean (no lint warnings in the first-run output):
# a collision proxy, a typed socket, and a hotspot with title/body.
proxy = cube("Crate-colonly", (0, 0, 0.5), size=1.05)

socket = bpy.data.objects.new("SOCKET_Top", None)
socket.empty_display_type = "ARROWS"
socket.empty_display_size = 0.15
socket.location = (0, 0, 1.05)
socket.parent = crate
scene.collection.objects.link(socket)

hotspot = bpy.data.objects.new("HOTSPOT_About", None)
hotspot.empty_display_type = "SPHERE"
hotspot.empty_display_size = 0.08
hotspot.location = (0.7, 0, 0.9)
hotspot["title"] = "The crate"
hotspot["body"] = "Rename me in Blender and your build breaks at compile time."
scene.collection.objects.link(hotspot)

# A small animation clip + a timeline marker (typed scroll waypoints).
crate.keyframe_insert(data_path="location", frame=1)
crate.location.z = 1.2
crate.keyframe_insert(data_path="location", frame=24)
crate.location.z = 0.5
crate.keyframe_insert(data_path="location", frame=48)
crate.animation_data.action.name = "CrateHop"
scene.timeline_markers.new("Hop", frame=24)

# Lights: a sun, plus a warm lamp in a Light Group so baked mode shows the
# interactive-layer feature out of the box.
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", type="SUN"))
sun.data.energy = 3.0
sun.rotation_euler = (0.7, 0.15, 0.5)
scene.collection.objects.link(sun)
lamp = bpy.data.objects.new("WarmLamp", bpy.data.lights.new("WarmLamp", type="POINT"))
lamp.data.energy = 300.0
lamp.data.color = (1.0, 0.65, 0.35)
lamp.location = (1.2, -1.0, 2.0)
lamp.lightgroup = "lamp"
scene.collection.objects.link(lamp)

world = bpy.data.worlds.new("World")
scene.world = world
bakelib.ensure_shader_node_tree(world)
background = world.node_tree.nodes.get("Background")
background.inputs["Color"].default_value = (0.45, 0.55, 0.65, 1.0)
background.inputs["Strength"].default_value = 0.5

camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
camera.location = (3.2, -3.2, 2.2)
camera.rotation_euler = (1.1, 0.0, 0.78)
scene.collection.objects.link(camera)
scene.camera = camera

bpy.ops.wm.save_as_mainfile(filepath=out_path, compress=True)
print("SAMPLE_BLEND_SAVED", out_path)
