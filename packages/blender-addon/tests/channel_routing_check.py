# SPDX-License-Identifier: GPL-3.0-or-later
"""MTL-UV-002: per-channel coordinate-space routing stays truthful.

The ledger fixture pair lives here: one tiled brick material authored at
0..20 UVs and one world-space noise material on the same mesh.  The tiled
case must classify as Tileable (authored UVs kept, no re-unwrap, overlap
correct) and the unique case as Unique (a non-overlapping unwrap is
required); silently swapping the two would either destroy authored texel
density or accept an overlapping bake target.

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/channel_routing_check.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
CANONICAL_BLENDER_DIR = ADDON_DIR.parent / "blendlink" / "blender"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_procedural():
    sys.path.insert(0, str(CANONICAL_BLENDER_DIR))
    spec = importlib.util.spec_from_file_location(
        "blendlink_channel_routing_procedural", ADDON_DIR / "procedural.py",
    )
    module = importlib.util.module_from_spec(spec)
    # Dataclass decoration resolves the owning module through sys.modules.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


procedural = load_procedural()


def quad_object(name, collection, uv_scale=1.0):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    layer = mesh.uv_layers.new(name="Authored UVs")
    corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for loop_index, corner in enumerate(corners):
        layer.data[loop_index].uv = (
            corner[0] * uv_scale, corner[1] * uv_scale,
        )
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def base_material(name):
    material = bpy.data.materials.new(name)
    tree = procedural.bakelib.ensure_shader_node_tree(material)
    principled = tree.nodes.get("Principled BSDF")
    return material, tree, principled


def channel(record, name):
    expect(record is not None, f"missing channels record for {name}")
    entry = next(
        (item for item in record["channels"] if item["channel"] == name),
        None,
    )
    expect(entry is not None, f"missing channel entry {name!r}: {record}")
    return entry


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)

    fixtures = bpy.data.collections.new("Channel Routing Fixtures")
    bpy.context.scene.collection.children.link(fixtures)

    # --- Ledger fixture pair: brick at 0..20 UVs + world noise, one mesh ---
    fixture = quad_object("Routing Fixture", fixtures, uv_scale=20.0)

    brick_material, brick_tree, brick_principled = base_material("Tiled Brick")
    texcoord = brick_tree.nodes.new("ShaderNodeTexCoord")
    brick = brick_tree.nodes.new("ShaderNodeTexBrick")
    brick_tree.links.new(texcoord.outputs["UV"], brick.inputs["Vector"])
    brick_tree.links.new(
        brick.outputs["Color"], brick_principled.inputs["Base Color"],
    )

    noise_material, noise_tree, noise_principled = base_material("World Noise")
    noise_coord = noise_tree.nodes.new("ShaderNodeTexCoord")
    noise = noise_tree.nodes.new("ShaderNodeTexNoise")
    noise_tree.links.new(noise_coord.outputs["Object"], noise.inputs["Vector"])
    noise_tree.links.new(
        noise.outputs["Fac"], noise_principled.inputs["Base Color"],
    )

    fixture.data.materials.append(brick_material)
    fixture.data.materials.append(noise_material)
    bpy.context.view_layer.update()

    uv_layers_before = tuple(
        layer.name for layer in fixture.data.uv_layers
    )
    authored_uvs = tuple(
        tuple(item.uv) for item in fixture.data.uv_layers["Authored UVs"].data
    )

    brick_record = procedural.analyze_material(brick_material)
    noise_record = procedural.analyze_material(noise_material)

    # Both stay needsBake at the material level until MTL-BAKE-001 lands; the
    # channel record is additive evidence, never a silent status change.
    expect(
        brick_record["status"] == "needsBake"
        and noise_record["status"] == "needsBake",
        "procedural fixtures no longer classify needsBake at material level",
    )

    brick_channels = brick_record["channels"]
    expect(
        brick_channels["model"] == procedural.CHANNEL_ROUTING_MODEL
        and brick_channels["surfaceRoot"] == "principled",
        f"brick surface root mismatch: {brick_channels}",
    )
    brick_base = channel(brick_channels, "Base Color")
    expect(
        brick_base["routing"] == "tileable"
        and brick_base["spaces"] == ["uv"]
        and brick_base["usesActiveUv"] is True
        and brick_base["animated"] is False,
        f"tiled brick Base Color must route tileable: {brick_base}",
    )
    brick_roughness = channel(brick_channels, "Roughness")
    expect(
        brick_roughness["routing"] == "constant"
        and brick_roughness["linked"] is False
        and isinstance(brick_roughness["value"], float),
        f"unlinked Roughness must stay a factor: {brick_roughness}",
    )

    noise_base = channel(noise_record["channels"], "Base Color")
    expect(
        noise_base["routing"] == "unique"
        and noise_base["spaces"] == ["object"],
        f"world noise Base Color must route unique: {noise_base}",
    )

    # Classification is read-only: authored UVs — including tiling past 0..1
    # with wrap overlap — survive untouched.  The Tileable route must never
    # re-unwrap; the Unique route names the non-overlapping unwrap instead of
    # silently accepting the authored overlap as a bake target.
    expect(
        tuple(layer.name for layer in fixture.data.uv_layers)
        == uv_layers_before,
        "channel routing mutated the mesh UV layer set",
    )
    expect(
        tuple(
            tuple(item.uv)
            for item in fixture.data.uv_layers["Authored UVs"].data
        ) == authored_uvs,
        "channel routing rewrote authored UV values",
    )
    expect(
        max(value for corner in authored_uvs for value in corner) > 1.0 + 1e-6,
        "fixture lost its authored 0..20 tiling",
    )

    # --- Implicit coordinate defaults ---
    bare_noise_material, bare_tree, bare_principled = base_material(
        "Bare Noise",
    )
    bare_noise = bare_tree.nodes.new("ShaderNodeTexNoise")
    bare_tree.links.new(
        bare_noise.outputs["Fac"], bare_principled.inputs["Roughness"],
    )
    bare_entry = channel(
        procedural.analyze_material(bare_noise_material)["channels"],
        "Roughness",
    )
    expect(
        bare_entry["routing"] == "unique"
        and bare_entry["spaces"] == ["generated"],
        f"unlinked Noise Vector must default to Generated: {bare_entry}",
    )

    image_material, image_tree, image_principled = base_material("Bare Image")
    image = bpy.data.images.new("Routing Pixels", width=4, height=4)
    teximage = image_tree.nodes.new("ShaderNodeTexImage")
    teximage.image = image
    image_tree.links.new(
        teximage.outputs["Color"], image_principled.inputs["Base Color"],
    )
    image_entry = channel(
        procedural.analyze_material(image_material)["channels"], "Base Color",
    )
    expect(
        image_entry["routing"] == "tileable"
        and image_entry["spaces"] == ["uv"]
        and image_entry["usesActiveUv"] is True,
        f"unlinked Image Vector must default to the active UV map: {image_entry}",
    )

    # --- View- and scene-dependent refusals stay named ---
    camera_material, camera_tree, camera_principled = base_material(
        "Camera Coordinates",
    )
    camera_coord = camera_tree.nodes.new("ShaderNodeTexCoord")
    camera_noise = camera_tree.nodes.new("ShaderNodeTexNoise")
    camera_tree.links.new(
        camera_coord.outputs["Camera"], camera_noise.inputs["Vector"],
    )
    camera_tree.links.new(
        camera_noise.outputs["Fac"], camera_principled.inputs["Base Color"],
    )
    camera_entry = channel(
        procedural.analyze_material(camera_material)["channels"], "Base Color",
    )
    expect(
        camera_entry["routing"] == "viewDependent"
        and any("view dependent" in reason for reason in camera_entry["reasons"]),
        f"camera coordinates must refuse as view dependent: {camera_entry}",
    )

    fresnel_material, fresnel_tree, fresnel_principled = base_material(
        "Fresnel Drive",
    )
    fresnel = fresnel_tree.nodes.new("ShaderNodeFresnel")
    fresnel_tree.links.new(
        fresnel.outputs["Fac"], fresnel_principled.inputs["Metallic"],
    )
    fresnel_entry = channel(
        procedural.analyze_material(fresnel_material)["channels"], "Metallic",
    )
    expect(
        fresnel_entry["routing"] == "viewDependent",
        f"Fresnel must refuse as view dependent: {fresnel_entry}",
    )

    shader_rgb_material, shader_rgb_tree, shader_rgb_principled = (
        base_material("Shader To RGB Drive")
    )
    diffuse = shader_rgb_tree.nodes.new("ShaderNodeBsdfDiffuse")
    shader_rgb = shader_rgb_tree.nodes.new("ShaderNodeShaderToRGB")
    shader_rgb_tree.links.new(
        diffuse.outputs["BSDF"], shader_rgb.inputs["Shader"],
    )
    shader_rgb_tree.links.new(
        shader_rgb.outputs["Color"], shader_rgb_principled.inputs["Base Color"],
    )
    shader_rgb_entry = channel(
        procedural.analyze_material(shader_rgb_material)["channels"],
        "Base Color",
    )
    expect(
        shader_rgb_entry["routing"] == "sceneDependent",
        f"Shader to RGB must refuse as scene dependent: {shader_rgb_entry}",
    )

    # --- Group walls cross in both directions ---
    group_material, group_root_tree, group_principled = base_material(
        "Grouped UV Noise",
    )
    group_tree = bpy.data.node_groups.new(
        "Routing Group", "ShaderNodeTree",
    )
    group_tree.interface.new_socket(
        "Vector", in_out="INPUT", socket_type="NodeSocketVector",
    )
    group_tree.interface.new_socket(
        "Value", in_out="OUTPUT", socket_type="NodeSocketFloat",
    )
    group_input = group_tree.nodes.new("NodeGroupInput")
    group_output = group_tree.nodes.new("NodeGroupOutput")
    grouped_noise = group_tree.nodes.new("ShaderNodeTexNoise")
    group_tree.links.new(
        group_input.outputs["Vector"], grouped_noise.inputs["Vector"],
    )
    group_tree.links.new(
        grouped_noise.outputs["Fac"], group_output.inputs["Value"],
    )
    instance = group_root_tree.nodes.new("ShaderNodeGroup")
    instance.node_tree = group_tree
    outer_coord = group_root_tree.nodes.new("ShaderNodeTexCoord")
    group_root_tree.links.new(
        outer_coord.outputs["UV"], instance.inputs["Vector"],
    )
    group_root_tree.links.new(
        instance.outputs["Value"], group_principled.inputs["Roughness"],
    )
    grouped_entry = channel(
        procedural.analyze_material(group_material)["channels"], "Roughness",
    )
    expect(
        grouped_entry["routing"] == "tileable"
        and grouped_entry["spaces"] == ["uv"],
        f"group walls must not hide the outer UV source: {grouped_entry}",
    )

    # --- Bounded surface roots stay named, never guessed ---
    grouped_principled_material = bpy.data.materials.new("Grouped Principled")
    root_tree = procedural.bakelib.ensure_shader_node_tree(
        grouped_principled_material,
    )
    inner_tree = bpy.data.node_groups.new(
        "Principled Wrapper", "ShaderNodeTree",
    )
    inner_tree.interface.new_socket(
        "Shader", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    inner_output = inner_tree.nodes.new("NodeGroupOutput")
    inner_principled = inner_tree.nodes.new("ShaderNodeBsdfPrincipled")
    inner_tree.links.new(
        inner_principled.outputs["BSDF"], inner_output.inputs["Shader"],
    )
    wrapper = root_tree.nodes.new("ShaderNodeGroup")
    wrapper.node_tree = inner_tree
    root_output = root_tree.nodes.get("Material Output")
    original_principled = root_tree.nodes.get("Principled BSDF")
    root_tree.nodes.remove(original_principled)
    root_tree.links.new(
        wrapper.outputs["Shader"], root_output.inputs["Surface"],
    )
    grouped_root = procedural.analyze_material(
        grouped_principled_material,
    )["channels"]
    expect(
        grouped_root["surfaceRoot"] == "unsupported"
        and "node group" in grouped_root["reason"],
        f"group-wrapped Principled must stay a named boundary: {grouped_root}",
    )

    mix_material, mix_tree, mix_principled = base_material("Mixed Shaders")
    mix_shader = mix_tree.nodes.new("ShaderNodeMixShader")
    emission = mix_tree.nodes.new("ShaderNodeEmission")
    mix_output = mix_tree.nodes.get("Material Output")
    mix_tree.links.remove(mix_output.inputs["Surface"].links[0])
    mix_tree.links.new(mix_principled.outputs["BSDF"], mix_shader.inputs[1])
    mix_tree.links.new(emission.outputs["Emission"], mix_shader.inputs[2])
    mix_tree.links.new(
        mix_shader.outputs["Shader"], mix_output.inputs["Surface"],
    )
    mix_root = procedural.analyze_material(mix_material)["channels"]
    expect(
        mix_root["surfaceRoot"] == "unsupported"
        and mix_root["channels"] == [],
        f"mixed shader surface must stay unsupported: {mix_root}",
    )

    # --- Multiple UV maps, spatial uniformity, and animated closures ---
    multi_uv_material, multi_tree, multi_principled = base_material(
        "Two UV Maps",
    )
    uv_a = multi_tree.nodes.new("ShaderNodeUVMap")
    uv_a.uv_map = "Layout A"
    uv_b = multi_tree.nodes.new("ShaderNodeUVMap")
    uv_b.uv_map = "Layout B"
    brick_a = multi_tree.nodes.new("ShaderNodeTexBrick")
    noise_b = multi_tree.nodes.new("ShaderNodeTexNoise")
    mix_rgb = multi_tree.nodes.new("ShaderNodeMix")
    mix_rgb.data_type = "RGBA"
    multi_tree.links.new(uv_a.outputs["UV"], brick_a.inputs["Vector"])
    multi_tree.links.new(uv_b.outputs["UV"], noise_b.inputs["Vector"])
    multi_tree.links.new(brick_a.outputs["Color"], mix_rgb.inputs["A"])
    multi_tree.links.new(noise_b.outputs["Fac"], mix_rgb.inputs["B"])
    multi_tree.links.new(
        mix_rgb.outputs["Result"], multi_principled.inputs["Base Color"],
    )
    multi_entry = channel(
        procedural.analyze_material(multi_uv_material)["channels"],
        "Base Color",
    )
    expect(
        multi_entry["routing"] == "unique"
        and multi_entry["uvMaps"] == ["Layout A", "Layout B"],
        f"two named UV maps cannot share one sampler: {multi_entry}",
    )

    uniform_material, uniform_tree, uniform_principled = base_material(
        "Uniform Math",
    )
    value = uniform_tree.nodes.new("ShaderNodeValue")
    value.outputs[0].default_value = 0.25
    math = uniform_tree.nodes.new("ShaderNodeMath")
    math.operation = "MULTIPLY"
    uniform_tree.links.new(value.outputs[0], math.inputs[0])
    uniform_tree.links.new(
        math.outputs["Value"], uniform_principled.inputs["Roughness"],
    )
    uniform_entry = channel(
        procedural.analyze_material(uniform_material)["channels"], "Roughness",
    )
    expect(
        uniform_entry["routing"] == "uniform"
        and uniform_entry["spaces"] == [],
        f"coordinate-free math must classify uniform: {uniform_entry}",
    )

    animated_material, animated_tree, animated_principled = base_material(
        "Animated Value",
    )
    animated_value = animated_tree.nodes.new("ShaderNodeValue")
    animated_tree.links.new(
        animated_value.outputs[0], animated_principled.inputs["Roughness"],
    )
    animated_tree.driver_add(
        f'nodes["{animated_value.name}"].outputs[0].default_value',
    )
    animated_entry = channel(
        procedural.analyze_material(animated_material)["channels"],
        "Roughness",
    )
    expect(
        animated_entry["animated"] is True,
        f"a driven closure must report animated: {animated_entry}",
    )

    # A pristine Principled material stays Exact and still reports channels.
    pristine_material, _tree, _principled = base_material("Pristine")
    pristine_record = procedural.analyze_material(pristine_material)
    expect(
        pristine_record["status"] == "exact"
        and pristine_record["channels"]["surfaceRoot"] == "principled"
        and all(
            item["routing"] == "constant"
            for item in pristine_record["channels"]["channels"]
        ),
        f"pristine Principled must stay exact with constant channels: "
        f"{pristine_record['channels']}",
    )

    print("BLENDLINK_CHANNEL_ROUTING_CHECK_PASSED")


if __name__ == "__main__":
    main()
