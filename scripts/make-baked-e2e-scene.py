# SPDX-License-Identifier: MIT
"""Create the tiny two-state scene used by test-baked-e2e.mjs."""
import json
import os
import sys
import uuid
from pathlib import Path

import bpy

sys.path.insert(0, str(
    Path(__file__).resolve().parents[1] / "packages" / "blendlink" / "blender"
))
import bakelib  # noqa: E402

script_args = sys.argv[sys.argv.index("--") + 1:]
out_path = script_args[0]
target_density = float(script_args[1]) if len(script_args) > 1 else 12
bake_output = script_args[2] if len(script_args) > 2 else "appearance"
if bake_output not in {"appearance", "lighting"}:
    raise SystemExit(f"unknown bake output {bake_output!r}")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "Gallery"
cube["blendlink_id"] = str(uuid.uuid4())
material = bpy.data.materials.new("Plaster")
material.diffuse_color = (0.55, 0.32, 0.16, 1)
if bake_output == "lighting":
    # The lighting-mode fixture must prove that high-frequency PBR detail
    # survives separately from the indirect-light atlas.
    bakelib.ensure_shader_node_tree(material)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")

    base_image = bpy.data.images.new("Gallery Base Detail", width=16, height=16)
    base_pixels = []
    for y in range(16):
        for x in range(16):
            value = 0.2 if (x // 2 + y // 2) % 2 else 0.8
            base_pixels.extend((value, 0.15 + value * 0.25, 0.08, 1.0))
    base_image.pixels.foreach_set(base_pixels)
    base_path = os.path.join(os.path.dirname(out_path), "gallery-base-detail.png")
    base_image.filepath_raw = base_path
    base_image.file_format = "PNG"
    base_image.save()
    bpy.data.images.remove(base_image)
    base_image = bpy.data.images.load(base_path, check_existing=False)
    base_image.name = "Gallery Base Detail"
    base_texture = nodes.new("ShaderNodeTexImage")
    base_texture.image = base_image
    links.new(base_texture.outputs["Color"], principled.inputs["Base Color"])

    normal_image = bpy.data.images.new("Gallery Normal Detail", width=16, height=16)
    normal_image.pixels.foreach_set([0.5, 0.5, 1.0, 1.0] * (16 * 16))
    normal_path = os.path.join(os.path.dirname(out_path), "gallery-normal-detail.png")
    normal_image.filepath_raw = normal_path
    normal_image.file_format = "PNG"
    normal_image.save()
    bpy.data.images.remove(normal_image)
    normal_image = bpy.data.images.load(normal_path, check_existing=False)
    normal_image.name = "Gallery Normal Detail"
    normal_image.colorspace_settings.name = "Non-Color"
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = normal_image
    normal_texture.image.colorspace_settings.name = "Non-Color"
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])
    principled.inputs["Roughness"].default_value = 0.32
    principled.inputs["Metallic"].default_value = 0.15
cube.data.materials.append(material)

# A genuinely material-less baked primitive locks the neutral-material seam:
# its disposable bake proxy needs a surface, and the shipped original must
# still receive an explicit unlit atlas texture binding.
bpy.ops.mesh.primitive_cube_add(size=0.4, location=(1.5, 0, 1.25))
materialless = bpy.context.active_object
materialless.name = "Materialless Accent"
materialless["blendlink_id"] = "materialless-accent-id"
materialless["blendlink_texel_weight"] = 0.25

# Realtime textured art exercises the real Blender image-name -> GLB texture
# resize seam while the gallery itself exercises baked lighting.
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 2))
poster = bpy.context.active_object
poster.name = "Poster"
poster["blendlink_id"] = str(uuid.uuid4())
poster["blendlink_dynamic"] = True
image = bpy.data.images.new("Hero Poster Source", width=64, height=32)
image.generated_color = (0.8, 0.3, 0.1, 1.0)
poster_path = os.path.join(os.path.dirname(out_path), "hero-poster.png")
image.filepath_raw = poster_path
image.file_format = "PNG"
image.save()
bpy.data.images.remove(image)
image = bpy.data.images.load(poster_path, check_existing=False)
image.name = "Hero Poster"
image["blendlink_max_size"] = 16
poster_material = bpy.data.materials.new("Poster Material")
bakelib.ensure_shader_node_tree(poster_material)
nodes = poster_material.node_tree.nodes
image_node = nodes.new("ShaderNodeTexImage")
image_node.image = image
principled = nodes.get("Principled BSDF")
poster_material.node_tree.links.new(image_node.outputs["Color"], principled.inputs["Base Color"])
poster.data.materials.append(poster_material)

lights = bpy.data.collections.new("KeyLights")
scene.collection.children.link(lights)
light_data = bpy.data.lights.new("Key", "AREA")
light_data.energy = 100
light_data.shape = "DISK"
light_data.size = 4
light = bpy.data.objects.new("Key", light_data)
light["blendlink_id"] = "key-light-id"
light.location = (2, -2, 4)
lights.objects.link(light)

# Geometry-changing state evidence: the dark state hides this actual exported
# mesh as well as the key light, and the generated runtime must reproduce it.
day_props = bpy.data.collections.new("DayProps")
scene.collection.children.link(day_props)
bpy.ops.mesh.primitive_cube_add(size=0.5, location=(-1.5, 0, 1.25))
day_decor = bpy.context.active_object
day_decor.name = "Day Decor"
day_decor["blendlink_id"] = "day-decor-id"
# This small state-only prop intentionally receives half the Gallery's detail
# budget.  Besides exercising the artist-facing relative-detail contract, that
# keeps the 128 px fixture honest under native per-object bake ownership: the
# hero still has to meet 12 px/m while Day Decor need not consume the same
# surface density as the dominant receiver.  The target-16 case below remains
# deliberately impossible and proves that weighting cannot bypass the gate.
day_decor["blendlink_texel_weight"] = 0.5
for collection in list(day_decor.users_collection):
    collection.objects.unlink(day_decor)
day_props.objects.link(day_decor)
day_material = bpy.data.materials.new("Day Decor Paint")
day_material.diffuse_color = (0.1, 0.35, 0.8, 1.0)
day_decor.data.materials.append(day_material)

world = bpy.data.worlds.new("World")
world.color = (0.02, 0.03, 0.05)
scene.world = world

# A packed, valid Radiance payload exercises byte-preserving HDR publication
# and the artifact relocation/cache contract without adding a fixture binary.
environment_image = bpy.data.images.new(
    "Studio Environment", width=64, height=32, float_buffer=True,
)
environment_image.use_fake_user = True
environment_image.generated_color = (0.04, 0.08, 0.16, 1.0)
environment_image.filepath_raw = os.path.join(os.path.dirname(out_path), "studio-environment.hdr")
environment_image.file_format = "HDR"
environment_image.save()
environment_image.pack()

camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
camera.location = (4, -4, 3)
scene.collection.objects.link(camera)
scene.camera = camera

atlas = {
    "id": "main", "name": "Main", "size": 128,
    "targetDensity": target_density, "margin": 8, "fitPolicy": "block",
}
if bake_output == "lighting":
    atlas["bakeOutput"] = "lighting"

scene["blendlink_recipe"] = json.dumps({
    "schemaVersion": 1,
    "presentation": "hybrid",
    "atlases": [atlas],
    "preview": {"samples": 1, "supersample": 1, "denoise": False, "resolutionScale": 1},
    "final": {"samples": 2, "supersample": 1, "denoise": False, "resolutionScale": 1},
    "states": [
        {"name": "lit"},
        {"name": "dark", "hideCollections": ["KeyLights", "DayProps"]},
    ],
    "shadows": {
        "preset": "balanced", "filter": "pcf", "mapSize": 1024,
        "maxDistance": 50, "bias": -0.0005, "normalBias": 0.02,
        "radius": 1, "autoUpdate": True,
    },
    "environment": {
        "source": "image", "imageName": environment_image.name,
        "lighting": "image", "background": "grounded",
        "lightingIntensity": 1.25, "lightingRotation": 15,
        "backgroundIntensity": 1, "backgroundRotation": 0,
        "backgroundBlur": 0, "groundHeight": 2, "groundRadius": 100,
    },
    "optimization": {"geometry": "meshopt"},
}, separators=(",", ":"))

bpy.ops.wm.save_as_mainfile(filepath=out_path, compress=True)
print("BLENDLINK_BAKED_E2E_SCENE", bake_output, out_path)
