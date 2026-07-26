"""Generate compact Blender 5.2 glTF exporter capability cells.

The fixtures are deliberately generated from code so each claim can be
reproduced without checking a large opaque .blend into the repository.  The
stock export uses the exact argument family used by the pinned Needle Blender
add-on 1.4.2 on Blender >= 3.6.
"""
from __future__ import annotations

import json
import os
import sys

import bpy

from io_scene_gltf2 import bl_info as gltf_bl_info
from io_scene_gltf2.blender.com.material_helpers import (
    create_settings_group,
    get_gltf_node_name,
)


def argv_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


ARGS = argv_after_separator()
if len(ARGS) != 1:
    raise SystemExit("usage: blender --background --python create_fixtures.py -- OUTPUT_DIR")

OUTPUT_DIR = os.path.abspath(ARGS[0])
FIXTURE_DIR = os.path.join(OUTPUT_DIR, "fixtures")
STOCK_DIR = os.path.join(OUTPUT_DIR, "stock")
os.makedirs(FIXTURE_DIR, exist_ok=True)
os.makedirs(STOCK_DIR, exist_ok=True)


def socket(node, name):
    result = node.inputs.get(name)
    if result is None:
        names = [item.name for item in node.inputs]
        raise RuntimeError(f"{node.bl_idname} has no {name!r} input; found {names}")
    return result


def set_input(node, name, value):
    target = socket(node, name)
    target.default_value = value


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "ExporterCapabilityCells"
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.frame_start = 1
    scene.frame_end = 1
    scene.frame_set(1)
    return scene


def add_camera_and_light(scene):
    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (8.0, -12.0, 8.0)
    camera.rotation_euler = (0.98, 0.0, 0.58)
    camera_data.lens = 52.0
    scene.camera = camera

    light_data = bpy.data.lights.new("Key", "SUN")
    light_data.energy = 2.0
    light = bpy.data.objects.new("Key", light_data)
    scene.collection.objects.link(light)
    light.rotation_euler = (0.45, -0.35, -0.55)


def new_principled(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    output = next(node for node in tree.nodes if node.type == "OUTPUT_MATERIAL")
    principled.name = f"{name}.Principled"
    output.name = f"{name}.Output"
    return material, tree, principled, output


def add_cube(name, material, location):
    bpy.ops.mesh.primitive_cube_add(size=1.5, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.name = f"{name}.Mesh"
    obj.data.materials.append(material)
    return obj


def add_gltf_settings(tree):
    # Use the exporter's canonical datablock prefix. Blender adds .001, .002,
    # and so on for later fixtures, which the exporter intentionally accepts.
    group = create_settings_group(get_gltf_node_name())
    node = tree.nodes.new("ShaderNodeGroup")
    node.node_tree = group
    node.name = get_gltf_node_name()
    node.label = get_gltf_node_name()
    return node


def make_generated_image():
    image = bpy.data.images.new("PortableTexture2x2", width=2, height=2, alpha=True)
    image.file_format = "PNG"
    image.alpha_mode = "STRAIGHT"
    image.colorspace_settings.name = "sRGB"
    image.pixels = [
        1.0, 0.0, 0.0, 1.0,
        0.0, 1.0, 0.0, 1.0,
        0.0, 0.0, 1.0, 1.0,
        1.0, 1.0, 0.0, 1.0,
    ]
    image.pack()
    return image


def make_alpha_image():
    image = bpy.data.images.new("PortableAlpha2x2", width=2, height=2, alpha=True)
    image.file_format = "PNG"
    image.alpha_mode = "STRAIGHT"
    image.colorspace_settings.name = "sRGB"
    image.pixels = [
        0.2, 0.8, 0.3, 0.20,
        0.2, 0.8, 0.3, 0.55,
        0.2, 0.8, 0.3, 0.80,
        0.2, 0.8, 0.3, 1.00,
    ]
    image.pack()
    return image


def build_portable_factors():
    scene = clear_scene()
    add_camera_and_light(scene)

    material, _tree, pbr, _output = new_principled("Cell.CorePrincipled")
    set_input(pbr, "Base Color", (0.18, 0.42, 0.80, 1.0))
    set_input(pbr, "Metallic", 0.35)
    set_input(pbr, "Roughness", 0.27)
    add_cube("CorePrincipled", material, (-6.0, 0.0, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.AlphaBlend")
    set_input(pbr, "Base Color", (0.82, 0.18, 0.12, 0.38))
    set_input(pbr, "Alpha", 0.38)
    add_cube("AlphaBlend", material, (-4.0, 0.0, 0.0))

    material = bpy.data.materials.new("Cell.Unlit")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    rgb = tree.nodes.new("ShaderNodeRGB")
    rgb.name = "UnlitColor"
    rgb.outputs["Color"].default_value = (0.08, 0.72, 0.30, 1.0)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "UnlitOutput"
    tree.links.new(rgb.outputs["Color"], output.inputs["Surface"])
    add_cube("Unlit", material, (-2.0, 0.0, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.Clearcoat")
    set_input(pbr, "Base Color", (0.12, 0.20, 0.72, 1.0))
    set_input(pbr, "Coat Weight", 0.70)
    set_input(pbr, "Coat Roughness", 0.16)
    add_cube("Clearcoat", material, (0.0, 0.0, 0.0))

    material, tree, pbr, output = new_principled("Cell.TransmissionVolume")
    set_input(pbr, "Base Color", (0.60, 0.83, 0.92, 1.0))
    set_input(pbr, "Roughness", 0.10)
    set_input(pbr, "Transmission Weight", 0.82)
    set_input(pbr, "IOR", 1.33)
    set_input(pbr, "Thin Film Thickness", 460.0)
    set_input(pbr, "Thin Film IOR", 1.42)
    settings = add_gltf_settings(tree)
    settings.inputs["Thickness"].default_value = 0.45
    settings.inputs["Dispersion"].default_value = 0.18
    settings.inputs["Iridescence Factor"].default_value = 0.64
    settings.inputs["Iridescence Thickness Minimum"].default_value = 120.0
    volume = tree.nodes.new("ShaderNodeVolumeAbsorption")
    volume.name = "VolumeAbsorption"
    set_input(volume, "Color", (0.62, 0.80, 0.95, 1.0))
    set_input(volume, "Density", 0.20)
    tree.links.new(volume.outputs["Volume"], output.inputs["Volume"])
    add_cube("TransmissionVolume", material, (2.0, 0.0, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.Specular")
    set_input(pbr, "Base Color", (0.58, 0.13, 0.46, 1.0))
    set_input(pbr, "Specular IOR Level", 0.30)
    set_input(pbr, "Specular Tint", (0.74, 0.92, 1.0, 1.0))
    add_cube("Specular", material, (4.0, 0.0, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.SheenFullWeight")
    set_input(pbr, "Base Color", (0.16, 0.06, 0.03, 1.0))
    set_input(pbr, "Sheen Weight", 1.0)
    set_input(pbr, "Sheen Tint", (0.82, 0.28, 0.12, 1.0))
    set_input(pbr, "Sheen Roughness", 0.42)
    add_cube("SheenFullWeight", material, (6.0, 0.0, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.Anisotropy")
    set_input(pbr, "Base Color", (0.68, 0.70, 0.73, 1.0))
    set_input(pbr, "Metallic", 0.85)
    set_input(pbr, "Roughness", 0.24)
    set_input(pbr, "Anisotropic", 0.65)
    set_input(pbr, "Anisotropic Rotation", 0.20)
    add_cube("Anisotropy", material, (-2.0, 2.2, 0.0))

    material, _tree, pbr, _output = new_principled("Cell.EmissiveStrength")
    set_input(pbr, "Base Color", (0.01, 0.01, 0.01, 1.0))
    set_input(pbr, "Emission Color", (0.20, 0.45, 0.90, 1.0))
    set_input(pbr, "Emission Strength", 4.0)
    add_cube("EmissiveStrength", material, (0.0, 2.2, 0.0))

    material, tree, pbr, _output = new_principled("Cell.TextureTransform")
    image_node = tree.nodes.new("ShaderNodeTexImage")
    image_node.name = "PortableImage"
    image_node.image = make_generated_image()
    texcoord = tree.nodes.new("ShaderNodeTexCoord")
    texcoord.name = "UVCoordinates"
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "PortableMapping"
    mapping.vector_type = "POINT"
    set_input(mapping, "Location", (0.25, 0.125, 0.0))
    set_input(mapping, "Rotation", (0.0, 0.0, 0.30))
    set_input(mapping, "Scale", (2.0, 0.50, 1.0))
    tree.links.new(texcoord.outputs["UV"], mapping.inputs["Vector"])
    tree.links.new(mapping.outputs["Vector"], image_node.inputs["Vector"])
    tree.links.new(image_node.outputs["Color"], pbr.inputs["Base Color"])
    add_cube("TextureTransform", material, (2.0, 2.2, 0.0))


def build_alpha_mask():
    scene = clear_scene()
    add_camera_and_light(scene)
    material, tree, pbr, _output = new_principled("Cell.AlphaMask")
    set_input(pbr, "Base Color", (0.16, 0.78, 0.28, 1.0))
    image = tree.nodes.new("ShaderNodeTexImage")
    image.name = "AuthoredAlpha"
    image.image = make_alpha_image()
    clip = tree.nodes.new("ShaderNodeMath")
    clip.name = "PortableAlphaClip"
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.42
    tree.links.new(image.outputs["Alpha"], clip.inputs[0])
    tree.links.new(clip.outputs["Value"], pbr.inputs["Alpha"])
    add_cube("AlphaMask", material, (0.0, 0.0, 0.0))


def build_unsupported_procedural():
    scene = clear_scene()
    add_camera_and_light(scene)
    material, tree, pbr, _output = new_principled("Cell.UnsupportedNoise")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.name = "UnsupportedNoise"
    set_input(noise, "Scale", 7.5)
    tree.links.new(noise.outputs["Color"], pbr.inputs["Base Color"])
    add_cube("UnsupportedNoise", material, (0.0, 0.0, 0.0))


NEEDLE_EQUIVALENT_EXPORT_ARGS = {
    "check_existing": False,
    "export_format": "GLB",
    "export_cameras": True,
    "export_lights": True,
    "use_active_scene": True,
    "gltf_export_id": "Needle Engine",
    "export_import_convert_lighting_mode": "COMPAT",
    "export_apply": True,
    "export_animations": True,
    "use_visible": False,
    "export_image_format": "AUTO",
    "export_jpeg_quality": 100,
}


def save_and_export(name, builder):
    builder()
    blend_path = os.path.join(FIXTURE_DIR, f"{name}.blend")
    glb_path = os.path.join(STOCK_DIR, f"{name}.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, check_existing=False)
    args = dict(NEEDLE_EQUIVALENT_EXPORT_ARGS)
    args["filepath"] = glb_path
    result = bpy.ops.export_scene.gltf(**args)
    if "FINISHED" not in result:
        raise RuntimeError(f"stock glTF export failed for {name}: {result}")
    return {
        "name": name,
        "blend": os.path.relpath(blend_path, OUTPUT_DIR).replace("\\", "/"),
        "stockGlb": os.path.relpath(glb_path, OUTPUT_DIR).replace("\\", "/"),
        "objects": sorted(obj.name for obj in bpy.context.scene.objects),
        "materials": sorted(material.name for material in bpy.data.materials),
    }


fixtures = [
    save_and_export("portable-factors", build_portable_factors),
    save_and_export("portable-alpha-mask", build_alpha_mask),
    save_and_export("unsupported-procedural", build_unsupported_procedural),
]

evidence = {
    "schemaVersion": 1,
    "blender": {
        "version": bpy.app.version_string,
        "versionTuple": list(bpy.app.version),
        "buildHash": bpy.app.build_hash.decode("ascii"),
        "buildDate": bpy.app.build_date.decode("ascii"),
    },
    "gltfExporter": {
        "version": ".".join(str(item) for item in gltf_bl_info["version"]),
        "blInfo": {
            "name": gltf_bl_info["name"],
            "author": gltf_bl_info["author"],
            "support": gltf_bl_info["support"],
        },
    },
    "needleEquivalentStockExportArgs": NEEDLE_EQUIVALENT_EXPORT_ARGS,
    "fixtures": fixtures,
}
with open(os.path.join(OUTPUT_DIR, "generation.json"), "w", encoding="utf-8") as handle:
    json.dump(evidence, handle, indent=2, sort_keys=True)
    handle.write("\n")

print("BLENDLINK_BLENDER_52_EXPORTER_FIXTURES_CREATED")
