# SPDX-License-Identifier: MIT
"""PROTOTYPE ONLY — compare unlit and lit stock-glTF selected-field carriers."""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = HERE / "output"
OUTPUT.mkdir(exist_ok=True)
SIZE = 256
WIDTH = 800
HEIGHT = 500
UV_NAME = "UVMap"

sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(ROOT / "packages" / "blender-addon"))
import bakelib  # noqa: E402 — canonical bake implementation
import material_compiler  # noqa: E402


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.materials,
        bpy.data.meshes,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
        bpy.data.worlds,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def configure_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    world = bpy.data.worlds.new("PROTOTYPE_World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.04, 0.045, 0.055, 1.0)
    background.inputs["Strength"].default_value = 0.0
    scene.world = world
    return scene


def make_quad(name, center, width, height, material):
    cx, cy, cz = center
    mesh = bpy.data.meshes.new(f"{name}.Mesh")
    mesh.from_pydata(
        (
            (cx - width / 2, cy - height / 2, cz),
            (cx + width / 2, cy - height / 2, cz),
            (cx + width / 2, cy + height / 2, cz),
            (cx - width / 2, cy + height / 2, cz),
        ),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    uv = mesh.uv_layers.new(name=UV_NAME)
    uv.active_render = True
    mesh.uv_layers.active = uv
    authored = {
        0: (0.0, 0.0),
        1: (1.0, 0.0),
        2: (1.0, 1.0),
        3: (0.0, 1.0),
    }
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv.data[loop_index].uv = authored[vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def make_box(name, location, scale, material):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(value / 2 for value in scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.name = f"{name}.Mesh"
    obj.data.materials.append(material)
    return obj


def source_material():
    material = bpy.data.materials.new("PROTOTYPE_SelectedSource")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "PROTOTYPE_SourceOutput"
    principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    principled.name = "PROTOTYPE_SourcePrincipled"
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 1.0
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.name = "PROTOTYPE_SelectedUV"
    uv.uv_map = UV_NAME
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    separate.name = "PROTOTYPE_SelectedSeparate"
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.name = "PROTOTYPE_SelectedField"
    ramp.color_ramp.interpolation = "CONSTANT"
    first = ramp.color_ramp.elements[0]
    first.position = 0.48
    first.color = (0.82, 0.025, 0.015, 1.0)
    second = ramp.color_ramp.elements[1]
    second.position = 0.52
    second.color = (0.015, 0.08, 0.82, 1.0)
    tree.links.new(uv.outputs["UV"], separate.inputs["Vector"])
    tree.links.new(separate.outputs["X"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
    tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def neutral_material(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 1.0
    return material


def private_emit_material(source):
    material = source.copy()
    material.name = "PROTOTYPE_PRIVATE_SELECTED_FIELD"
    tree = material.node_tree
    ramp = tree.nodes.get("PROTOTYPE_SelectedField")
    expect(ramp is not None, "private selected-field node disappeared")
    for output in [
        node for node in tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def coverage_material():
    material = bpy.data.materials.new("PROTOTYPE_PRIVATE_COVERAGE")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def bake_field(source_receiver, source):
    private = source_receiver.copy()
    private.name = "PROTOTYPE_PRIVATE_BAKE_OBJECT"
    private.data = source_receiver.data.copy()
    private.data.name = "PROTOTYPE_PRIVATE_BAKE_MESH"
    bpy.context.scene.collection.objects.link(private)
    private.data.materials.clear()
    private.data.materials.append(private_emit_material(source))

    target = bpy.data.images.new(
        "PROTOTYPE_SELECTED_FIELD_FLOAT",
        width=SIZE,
        height=SIZE,
        alpha=True,
        float_buffer=True,
    )
    target.generated_color = (0.0, 0.0, 0.0, 0.0)
    coverage_target = bpy.data.images.new(
        "PROTOTYPE_SELECTED_FIELD_COVERAGE",
        width=SIZE,
        height=SIZE,
        alpha=True,
        float_buffer=True,
    )
    coverage_target.generated_color = (0.0, 0.0, 0.0, 0.0)

    scene = bpy.context.scene
    old_engine = scene.render.engine
    try:
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 1
        private.data.materials.clear()
        private.data.materials.append(coverage_material())
        bakelib.bake_objects_to_image(
            [private],
            coverage_target,
            bake_type="EMIT",
            margin_px=8,
            uv_layer=UV_NAME,
        )
        coverage = bakelib.image_signal_coverage(
            coverage_target,
            "selected-field lit transport differential",
        )
        private.data.materials.clear()
        private.data.materials.append(private_emit_material(source))
        bakelib.bake_objects_to_image(
            [private],
            target,
            bake_type="EMIT",
            margin_px=8,
            uv_layer=UV_NAME,
        )
        clipped = bakelib.clipped_fraction(target, coverage)
        expect(clipped == 0.0, f"selected field clipped {clipped:.6%}")
        path = OUTPUT / "selected-field.png"
        bakelib.save_resolved(
            target,
            str(path),
            SIZE,
            denoise=False,
            delivery_sizes=[],
            coverage=coverage,
        )
    finally:
        scene.render.engine = old_engine
        bpy.data.objects.remove(private, do_unlink=True)
    return path, float(coverage.sum()) / float(coverage.size), clipped


def published_material(name, image, *, unlit):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material["blendlink_source_material"] = "PROTOTYPE_SelectedSource"
    material["blendlink_material_rule"] = (
        "blendlink.unlit.selected-field"
        if unlit else "blendlink.pbr.selected-field"
    )
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "EXTEND"
    uv = tree.nodes.new("ShaderNodeUVMap")
    uv.uv_map = UV_NAME
    tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
    if unlit:
        surface = tree.nodes.new("ShaderNodeBackground")
        tree.links.new(texture.outputs["Color"], surface.inputs["Color"])
        tree.links.new(surface.outputs["Background"], output.inputs["Surface"])
    else:
        surface = tree.nodes.new("ShaderNodeBsdfPrincipled")
        surface.inputs["Metallic"].default_value = 0.0
        surface.inputs["Roughness"].default_value = 1.0
        tree.links.new(texture.outputs["Color"], surface.inputs["Base Color"])
        tree.links.new(surface.outputs["BSDF"], output.inputs["Surface"])
    return material


def add_camera_and_sun(scene):
    camera_data = bpy.data.cameras.new("PROTOTYPE_Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 5.0
    camera = bpy.data.objects.new("PROTOTYPE_Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0.0, 0.0, 10.0)
    camera.rotation_euler = (0.0, 0.0, 0.0)
    scene.camera = camera

    sun_data = bpy.data.lights.new("PROTOTYPE_Sun", type="SUN")
    sun_data.energy = 3.0
    sun_data.angle = math.radians(4.0)
    sun = bpy.data.objects.new("PROTOTYPE_Sun", sun_data)
    scene.collection.objects.link(sun)
    direction = Vector((0.48, -0.24, -1.0)).normalized()
    sun.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render(path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.filepath = str(path)
    result = bpy.ops.render.render(write_still=True)
    expect("FINISHED" in result, f"Eevee render failed: {result}")
    expect(path.is_file(), f"Eevee render missing: {path}")


def export_glb(path):
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        check_existing=False,
        export_format="GLB",
        export_cameras=True,
        export_lights=True,
        use_active_scene=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_extras=True,
        export_image_format="AUTO",
        export_animations=False,
        export_import_convert_lighting_mode="COMPAT",
    )
    expect("FINISHED" in result, f"glTF export failed: {result}")


def embedded_texture_evidence(path, wanted_material):
    document, binary = material_compiler._read_glb(str(path))
    found = [
        material for material in document.get("materials", ())
        if material.get("name") == wanted_material
    ]
    expect(len(found) == 1, f"{path.name} did not contain {wanted_material}")
    material = found[0]
    texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    image_index = document["textures"][texture_index]["source"]
    image = document["images"][image_index]
    view = document["bufferViews"][image["bufferView"]]
    start = int(view.get("byteOffset", 0))
    end = start + int(view["byteLength"])
    payload = binary[start:end]
    return {
        "material": wanted_material,
        "extensions": sorted((material.get("extensions") or {}).keys()),
        "roughnessFactor": material["pbrMetallicRoughness"].get("roughnessFactor"),
        "metallicFactor": material["pbrMetallicRoughness"].get("metallicFactor"),
        "imageMime": image.get("mimeType"),
        "imageSha256": hashlib.sha256(payload).hexdigest(),
        "extensionsUsed": sorted(document.get("extensionsUsed") or ()),
    }


def main():
    clean_scene()
    bpy.context.preferences.filepaths.save_version = 0
    scene = configure_scene()
    source = source_material()
    neutral = neutral_material("PROTOTYPE_Neutral", (0.43, 0.46, 0.5))
    dark = neutral_material("PROTOTYPE_OccluderMaterial", (0.12, 0.14, 0.17))

    floor = make_quad(
        "PROTOTYPE_Floor", (0.0, 0.0, 0.0), 8.0, 5.0, neutral,
    )
    receiver = make_quad(
        "PROTOTYPE_SelectedReceiver", (-2.25, 0.0, 0.025), 3.2, 3.2, source,
    )
    occluder = make_box(
        "PROTOTYPE_Occluder", (-2.3, 0.0, 0.72), (0.72, 0.72, 1.35), dark,
    )
    caster = make_box(
        "PROTOTYPE_SelectedCaster", (2.0, 0.3, 0.65), (1.05, 1.05, 1.25), source,
    )
    add_camera_and_sun(scene)
    fixture = OUTPUT / "source-fixture.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(fixture), check_existing=False)

    source_render = OUTPUT / "source-eevee.png"
    render(source_render)

    texture_path, covered_fraction, clipped_fraction = bake_field(receiver, source)
    published_image = bpy.data.images.load(
        str(texture_path),
        check_existing=False,
    )
    published_image.name = "PROTOTYPE_SelectedFieldTexture"
    published_image.colorspace_settings.name = "sRGB"
    published_image.alpha_mode = "STRAIGHT"
    unlit = published_material(
        "PROTOTYPE_SelectedUnlit", published_image, unlit=True,
    )
    lit = published_material(
        "PROTOTYPE_SelectedLit", published_image, unlit=False,
    )

    variants = {}
    for name, material in (("lit", lit), ("unlit", unlit)):
        receiver.material_slots[0].material = material
        caster.material_slots[0].material = material
        render_path = OUTPUT / f"published-{name}-eevee.png"
        glb_path = OUTPUT / f"{name}.glb"
        render(render_path)
        export_glb(glb_path)
        variants[name] = {
            "render": str(render_path),
            "renderSha256": sha256(render_path),
            "glb": str(glb_path),
            "glbSha256": sha256(glb_path),
            "texture": embedded_texture_evidence(
                glb_path,
                "PROTOTYPE_SelectedLit" if name == "lit"
                else "PROTOTYPE_SelectedUnlit",
            ),
        }

    receiver.material_slots[0].material = source
    caster.material_slots[0].material = source
    same_texture = (
        variants["lit"]["texture"]["imageSha256"]
        == variants["unlit"]["texture"]["imageSha256"]
        == sha256(texture_path)
    )
    unlit_extension = (
        "KHR_materials_unlit" in variants["unlit"]["texture"]["extensions"]
        and "KHR_materials_unlit" not in variants["lit"]["texture"]["extensions"]
    )
    result = {
        "prototype": "selected-field-lit-transport-differential",
        "blenderVersion": bpy.app.version_string,
        "sourceEngine": scene.render.engine,
        "sourceFixture": {
            "path": str(fixture),
            "sha256": sha256(fixture),
            "render": str(source_render),
            "renderSha256": sha256(source_render),
            "surface": "Principled BSDF",
            "selectedField": "PROTOTYPE_SelectedField.Color",
        },
        "materializedField": {
            "path": str(texture_path),
            "sha256": sha256(texture_path),
            "size": [SIZE, SIZE],
            "coveredFraction": covered_fraction,
            "clippedFraction": clipped_fraction,
        },
        "variants": variants,
        "checks": {
            "sameMaterializedTextureBytes": same_texture,
            "onlyUnlitVariantDeclaresKhrUnlit": unlit_extension,
            "sourceFixturePreserved": (
                receiver.material_slots[0].material == source
                and caster.material_slots[0].material == source
            ),
        },
    }
    (OUTPUT / "blender-evidence.json").write_text(
        json.dumps(result, indent=2) + "\n",
        encoding="utf-8",
    )
    expect(all(result["checks"].values()), f"Blender checks failed: {result}")
    print("BLENDLINK_SELECTED_FIELD_SURFACE_BLENDER=" + json.dumps(
        result,
        separators=(",", ":"),
    ))


main()
