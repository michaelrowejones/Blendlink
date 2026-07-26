"""Create the smallest real mixed-Hybrid material-fidelity fixture.

The source has three renderable mesh occurrences:

* Appearance Receiver owns the complete active Surface through an Appearance atlas;
* Dynamic Survivor explicitly remains live while sharing that same needsBake material;
* Lighting Receiver keeps a different needsBake material under a Lighting atlas.

Both procedural graphs are valid Cycles graphs.  That distinction is important:
the fixture reaches the staged material-publication gate instead of failing for
an unrelated Appearance-bake incompatibility.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from io_scene_gltf2 import bl_info as gltf_bl_info


def args_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


args = args_after_separator()
if len(args) != 2:
    raise SystemExit(
        "usage: blender --background --python make_fixture.py -- SOURCE.blend GENERATION.json"
    )

source_path = Path(args[0]).resolve()
generation_path = Path(args[1]).resolve()
source_path.parent.mkdir(parents=True, exist_ok=True)
generation_path.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Hybrid Material Gate Differential"
scene.render.engine = "CYCLES"
scene.render.resolution_x = 320
scene.render.resolution_y = 180
scene.render.resolution_percentage = 100
scene.frame_start = 1
scene.frame_end = 1
scene.frame_set(1)


def procedural_principled(name: str, warm: bool):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    principled.name = f"{name}.Principled"
    principled.inputs["Roughness"].default_value = 0.72

    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.name = f"{name}.Noise"
    noise.noise_dimensions = "3D"
    noise.inputs["Scale"].default_value = 3.5 if warm else 5.0
    noise.inputs["Detail"].default_value = 2.0

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.name = f"{name}.Ramp"
    if warm:
        ramp.color_ramp.elements[0].color = (0.035, 0.008, 0.003, 1.0)
        ramp.color_ramp.elements[1].color = (0.8, 0.18, 0.025, 1.0)
    else:
        ramp.color_ramp.elements[0].color = (0.005, 0.02, 0.06, 1.0)
        ramp.color_ramp.elements[1].color = (0.1, 0.55, 0.95, 1.0)
    tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
    return material


def cube(name: str, location: tuple[float, float, float], material):
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        calc_uvs=True,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}.Mesh"
    obj.data.materials.append(material)
    return obj


shared = procedural_principled("Shared Painterly Surface", warm=True)
lighting = procedural_principled("Lighting Painterly Surface", warm=False)

appearance_receiver = cube("Appearance Receiver", (-1.25, 0.0, 0.0), shared)
appearance_receiver["blendlink_id"] = "appearance-receiver"
appearance_receiver["blendlink_dynamic"] = False
appearance_receiver["blendlink_atlas"] = "main"

dynamic_survivor = cube("Dynamic Survivor", (0.0, 0.0, 0.0), shared)
dynamic_survivor["blendlink_id"] = "dynamic-survivor"
dynamic_survivor["blendlink_dynamic"] = True
# An authored atlas preference must not turn a live occurrence into an
# Appearance-owned occurrence.
dynamic_survivor["blendlink_atlas"] = "main"

lighting_receiver = cube("Lighting Receiver", (1.25, 0.0, 0.0), lighting)
lighting_receiver["blendlink_id"] = "lighting-receiver"
lighting_receiver["blendlink_dynamic"] = False
lighting_receiver["blendlink_atlas"] = "lighting"

camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (4.0, -7.0, 4.5)
camera.rotation_euler = (
    math.radians(67.0),
    0.0,
    math.radians(30.0),
)
camera_data.lens = 50.0
scene.camera = camera

light_data = bpy.data.lights.new("Sun", "SUN")
light_data.energy = 2.0
light = bpy.data.objects.new("Sun", light_data)
scene.collection.objects.link(light)
light.rotation_euler = (
    math.radians(35.0),
    math.radians(-20.0),
    math.radians(-30.0),
)

scene["blendlink_recipe"] = json.dumps(
    {
        "schemaVersion": 1,
        "presentation": "hybrid",
        "atlases": [
            {
                "id": "main",
                "name": "Appearance",
                "size": 128,
                "targetDensity": 1,
                "margin": 4,
                "fitPolicy": "scale",
                "bakeOutput": "appearance",
            },
            {
                "id": "lighting",
                "name": "Lighting",
                "size": 128,
                "targetDensity": 1,
                "margin": 4,
                "fitPolicy": "scale",
                "bakeOutput": "lighting",
            },
        ],
        "preview": {
            "samples": 1,
            "supersample": 1,
            "denoise": False,
            "resolutionScale": 1,
        },
        "final": {
            "samples": 1,
            "supersample": 1,
            "denoise": False,
            "resolutionScale": 1,
        },
        "states": [{"name": "default"}],
        "optimization": {"geometry": "none", "textures": "none"},
    },
    separators=(",", ":"),
)

bpy.ops.wm.save_as_mainfile(
    filepath=str(source_path),
    check_existing=False,
    compress=False,
)

generation = {
    "schemaVersion": 1,
    "blender": {
        "version": bpy.app.version_string,
        "versionTuple": list(bpy.app.version),
        "versionCycle": bpy.app.version_cycle,
        "buildHash": bpy.app.build_hash.decode("ascii"),
        "buildDate": bpy.app.build_date.decode("ascii"),
    },
    "gltfExporter": {
        "version": ".".join(str(item) for item in gltf_bl_info["version"]),
        "name": gltf_bl_info["name"],
    },
    "source": {
        "scene": scene.name,
        "renderEngine": scene.render.engine,
        "frame": scene.frame_current,
        "objects": [
            {
                "name": obj.name,
                "id": obj.get("blendlink_id"),
                "dynamic": bool(obj.get("blendlink_dynamic", False)),
                "atlas": obj.get("blendlink_atlas"),
                "materials": [
                    slot.material.name if slot.material is not None else None
                    for slot in obj.material_slots
                ],
            }
            for obj in (appearance_receiver, dynamic_survivor, lighting_receiver)
        ],
        "materials": [shared.name, lighting.name],
    },
}
generation_path.write_text(
    json.dumps(generation, indent=2, sort_keys=True) + "\n",
    encoding="utf8",
)
print(f"BLENDLINK_HYBRID_MATERIAL_GATE_FIXTURE {source_path.as_posix()}")
