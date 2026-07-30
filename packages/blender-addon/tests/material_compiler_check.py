# SPDX-License-Identifier: GPL-3.0-or-later
"""Real Blender/glTF contract for the first portable Material Compiler slice."""
from __future__ import annotations

import base64
import importlib
import importlib.util
import hashlib
import json
import os
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_material_compiler_check"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE, ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def triangle_object(name):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(((-1, -1, 0), (1, -1, 0), (0, 1, 0)), (), ((0, 1, 2),))
    mesh.update()
    attribute = mesh.color_attributes.new(
        name="Paint", type="BYTE_COLOR", domain="CORNER",
    )
    colors = (
        (0.9, 0.1, 0.2, 0.25),
        (0.1, 0.8, 0.2, 0.65),
        (0.2, 0.3, 0.9, 1.0),
    )
    for item, color in zip(attribute.data, colors):
        item.color = color
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("Paint")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def set_paint_alphas(obj, values):
    attribute = obj.data.color_attributes["Paint"]
    expect(
        len(attribute.data) == len(values),
        f"{obj.name} alpha fixture has the wrong value count",
    )
    for item, alpha in zip(attribute.data, values):
        color = tuple(item.color)
        item.color = (color[0], color[1], color[2], alpha)
    obj.data.update()


def uv_snapshot(mesh):
    return (
        int(mesh.uv_layers.active_index),
        tuple(
            (
                layer.name,
                bool(layer.active_render),
                tuple(
                    (float(item.uv[0]), float(item.uv[1]))
                    for item in layer.data
                ),
            )
            for layer in mesh.uv_layers
        ),
    )


def selected_vertex_material(compiler, name, layer_name=""):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    principled = tree.nodes.get("Principled BSDF")
    vertex = tree.nodes.new("ShaderNodeVertexColor")
    vertex.name = "Artist Paint"
    vertex.layer_name = layer_name
    tree.links.new(vertex.outputs["Color"], principled.inputs["Base Color"])
    tree.links.new(vertex.outputs["Alpha"], principled.inputs["Alpha"])
    compiler.set_web_source(material, vertex, vertex.outputs["Color"].identifier, "COLOR")
    compiler.set_web_source(material, vertex, vertex.outputs["Alpha"].identifier, "ALPHA")
    return material


def two_slot_vertex_object(name):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        (
            (-2, -1, 0), (0, -1, 0), (-1, 1, 0),
            (0, -1, 0), (2, -1, 0), (1, 1, 0),
        ),
        (),
        ((0, 1, 2), (3, 4, 5)),
    )
    mesh.polygons[0].material_index = 0
    mesh.polygons[1].material_index = 1
    paint = mesh.color_attributes.new(
        name="Paint", type="BYTE_COLOR", domain="CORNER",
    )
    paint_colors = (
        (0.92, 0.08, 0.12, 0.2),
        (0.82, 0.18, 0.22, 0.4),
        (0.72, 0.28, 0.32, 0.6),
        (0.08, 0.72, 0.18, 0.3),
        (0.18, 0.82, 0.28, 0.7),
        (0.28, 0.92, 0.38, 1.0),
    )
    for item, color in zip(paint.data, paint_colors):
        item.color = color
    detail = mesh.color_attributes.new(
        name="Detail", type="FLOAT_COLOR", domain="POINT",
    )
    detail_colors = (
        (0.12, 0.22, 0.82, 0.15),
        (0.22, 0.32, 0.72, 0.35),
        (0.32, 0.42, 0.62, 0.55),
        (0.62, 0.22, 0.52, 0.25),
        (0.72, 0.32, 0.42, 0.65),
        (0.82, 0.42, 0.32, 0.95),
    )
    for item, color in zip(detail.data, detail_colors):
        item.color = color
    artist_data = mesh.attributes.new(
        name="_ArtistData", type="FLOAT", domain="POINT",
    )
    for index, item in enumerate(artist_data.data):
        item.value = (index + 1) / len(artist_data.data)
    mesh.color_attributes.render_color_index = mesh.color_attributes.find("Paint")
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def selected_constant_material(compiler, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    rgb = material.node_tree.nodes.new("ShaderNodeRGB")
    rgb.name = "Artist Constant"
    rgb.outputs["Color"].default_value = (0.18, 0.42, 0.75, 1.0)
    principled = material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(rgb.outputs["Color"], principled.inputs["Base Color"])
    compiler.set_web_source(material, rgb, rgb.outputs["Color"].identifier, "COLOR")
    return material


def selected_surface_response_material(compiler, name, response):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "Artist Output"
    selected = tree.nodes.new("ShaderNodeRGB")
    selected.name = "Artist Selected Field"
    selected.outputs["Color"].default_value = (0.18, 0.42, 0.75, 1.0)
    if response == "lit":
        surface = tree.nodes.new("ShaderNodeBsdfPrincipled")
        tree.links.new(selected.outputs["Color"], surface.inputs["Base Color"])
        tree.links.new(surface.outputs["BSDF"], output.inputs["Surface"])
    elif response == "unlit":
        surface = tree.nodes.new("ShaderNodeEmission")
        tree.links.new(selected.outputs["Color"], surface.inputs["Color"])
        tree.links.new(surface.outputs["Emission"], output.inputs["Surface"])
    elif response == "mixed":
        lit = tree.nodes.new("ShaderNodeBsdfPrincipled")
        unlit = tree.nodes.new("ShaderNodeEmission")
        mix = tree.nodes.new("ShaderNodeMixShader")
        tree.links.new(selected.outputs["Color"], lit.inputs["Base Color"])
        tree.links.new(selected.outputs["Color"], unlit.inputs["Color"])
        tree.links.new(lit.outputs["BSDF"], mix.inputs[1])
        tree.links.new(unlit.outputs["Emission"], mix.inputs[2])
        tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    elif response != "unreachable":
        raise AssertionError(f"unsupported surface-response fixture {response!r}")
    compiler.set_web_source(
        material, selected, selected.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_group_lit_material(compiler, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    selected = tree.nodes.new("ShaderNodeRGB")
    selected.name = "Artist Selected Field"

    group_tree = bpy.data.node_groups.new(f"{name} Group", "ShaderNodeTree")
    group_tree.interface.new_socket(
        name="Color", in_out="INPUT", socket_type="NodeSocketColor",
    )
    group_tree.interface.new_socket(
        name="Shader", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    group_input = group_tree.nodes.new("NodeGroupInput")
    group_output = group_tree.nodes.new("NodeGroupOutput")
    principled = group_tree.nodes.new("ShaderNodeBsdfPrincipled")
    group_tree.links.new(
        group_input.outputs["Color"], principled.inputs["Base Color"],
    )
    group_tree.links.new(
        principled.outputs["BSDF"], group_output.inputs["Shader"],
    )

    group = tree.nodes.new("ShaderNodeGroup")
    group.node_tree = group_tree
    tree.links.new(selected.outputs["Color"], group.inputs["Color"])
    tree.links.new(group.outputs["Shader"], output.inputs["Surface"])
    compiler.set_web_source(
        material, selected, selected.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_parallel_lighting_material(compiler, name):
    """Intrinsic color and converted EEVEE lighting converge inside a group."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    selected = tree.nodes.new("ShaderNodeRGB")
    selected.name = "Artist Selected Field"
    mask = tree.nodes.new("ShaderNodeRGB")
    mask.name = "Additional Intrinsic Pattern"
    mask.outputs["Color"].default_value = (0.65, 0.8, 0.45, 1.0)
    complete = tree.nodes.new("ShaderNodeMixRGB")
    complete.name = "Complete Intrinsic Result"
    complete.blend_type = "MULTIPLY"
    complete.inputs["Fac"].default_value = 1.0
    tree.links.new(selected.outputs["Color"], complete.inputs["Color1"])
    tree.links.new(mask.outputs["Color"], complete.inputs["Color2"])

    group_tree = bpy.data.node_groups.new(f"{name} Group", "ShaderNodeTree")
    group_tree.interface.new_socket(
        name="Color", in_out="INPUT", socket_type="NodeSocketColor",
    )
    group_tree.interface.new_socket(
        name="Shader", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    group_input = group_tree.nodes.new("NodeGroupInput")
    group_output = group_tree.nodes.new("NodeGroupOutput")
    diffuse = group_tree.nodes.new("ShaderNodeBsdfDiffuse")
    shader_to_rgb = group_tree.nodes.new("ShaderNodeShaderToRGB")
    shade = group_tree.nodes.new("ShaderNodeValToRGB")
    combine = group_tree.nodes.new("ShaderNodeMixRGB")
    combine.blend_type = "MULTIPLY"
    combine.inputs["Fac"].default_value = 1.0
    emission = group_tree.nodes.new("ShaderNodeEmission")
    group_tree.links.new(diffuse.outputs["BSDF"], shader_to_rgb.inputs["Shader"])
    group_tree.links.new(shader_to_rgb.outputs["Color"], shade.inputs["Fac"])
    group_tree.links.new(group_input.outputs["Color"], combine.inputs["Color1"])
    group_tree.links.new(shade.outputs["Color"], combine.inputs["Color2"])
    group_tree.links.new(combine.outputs["Color"], emission.inputs["Color"])
    group_tree.links.new(
        emission.outputs["Emission"], group_output.inputs["Shader"],
    )

    group = tree.nodes.new("ShaderNodeGroup")
    group.node_tree = group_tree
    tree.links.new(complete.outputs["Color"], group.inputs["Color"])
    tree.links.new(group.outputs["Shader"], output.inputs["Surface"])
    compiler.set_web_source(
        material, selected, selected.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_static_floor_material(
    compiler,
    name,
    *,
    post_transform=False,
    shade_value=0.7,
):
    """Exact response family with arbitrary names and one deliberate near miss."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "Arbitrary Destination"

    coordinates = tree.nodes.new("ShaderNodeTexCoord")
    coordinates.name = "Unimportant Coordinates"
    checker = tree.nodes.new("ShaderNodeTexChecker")
    checker.name = "Complete Intrinsic Candidate"
    checker.inputs["Color1"].default_value = (0.04, 0.18, 0.72, 1.0)
    checker.inputs["Color2"].default_value = (0.88, 0.12, 0.03, 1.0)
    checker.inputs["Scale"].default_value = 5.0
    tree.links.new(coordinates.outputs["Object"], checker.inputs["Vector"])

    group_tree = bpy.data.node_groups.new(
        f"{name} Structurally Recognized Response", "ShaderNodeTree",
    )
    pigment_socket = group_tree.interface.new_socket(
        name="Pigment", in_out="INPUT", socket_type="NodeSocketColor",
    )
    pigment_socket.default_value = (0.5, 0.5, 0.5, 1.0)
    floor_socket = group_tree.interface.new_socket(
        name="Night Tint", in_out="INPUT", socket_type="NodeSocketColor",
    )
    floor_socket.default_value = (0.08, 0.2, 0.42, 1.0)
    blend_socket = group_tree.interface.new_socket(
        name="Response Share", in_out="INPUT", socket_type="NodeSocketFloat",
    )
    blend_socket.default_value = shade_value
    group_tree.interface.new_socket(
        name="Finished", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    group_input = group_tree.nodes.new("NodeGroupInput")
    group_output = group_tree.nodes.new("NodeGroupOutput")
    diffuse = group_tree.nodes.new("ShaderNodeBsdfDiffuse")
    converted = group_tree.nodes.new("ShaderNodeShaderToRGB")
    ramp = group_tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1.0)
    add = group_tree.nodes.new("ShaderNodeMixRGB")
    add.blend_type = "ADD"
    add.inputs["Fac"].default_value = 1.0
    multiply = group_tree.nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs["Fac"].default_value = 1.0
    response_mix = group_tree.nodes.new("ShaderNodeMixRGB")
    response_mix.blend_type = "MIX"
    emission = group_tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0

    group_tree.links.new(diffuse.outputs["BSDF"], converted.inputs["Shader"])
    group_tree.links.new(converted.outputs["Color"], ramp.inputs["Fac"])
    group_tree.links.new(ramp.outputs["Color"], add.inputs["Color1"])
    group_tree.links.new(group_input.outputs["Night Tint"], add.inputs["Color2"])
    group_tree.links.new(
        group_input.outputs["Pigment"], multiply.inputs["Color1"],
    )
    group_tree.links.new(add.outputs["Color"], multiply.inputs["Color2"])
    group_tree.links.new(
        group_input.outputs["Pigment"], response_mix.inputs["Color1"],
    )
    group_tree.links.new(
        multiply.outputs["Color"], response_mix.inputs["Color2"],
    )
    group_tree.links.new(
        group_input.outputs["Response Share"], response_mix.inputs["Fac"],
    )
    final_color = response_mix.outputs["Color"]
    if post_transform:
        post = group_tree.nodes.new("ShaderNodeHueSaturation")
        post.inputs["Saturation"].default_value = 0.8
        group_tree.links.new(final_color, post.inputs["Color"])
        final_color = post.outputs["Color"]
    group_tree.links.new(final_color, emission.inputs["Color"])
    group_tree.links.new(
        emission.outputs["Emission"], group_output.inputs["Finished"],
    )

    response = tree.nodes.new("ShaderNodeGroup")
    response.name = "Names Do Not Define This Family"
    response.node_tree = group_tree
    tree.links.new(checker.outputs["Color"], response.inputs["Pigment"])
    tree.links.new(response.outputs["Finished"], output.inputs["Surface"])
    compiler.set_web_source(
        material, checker, checker.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_umbrella_response_material(compiler, name):
    """Backfacing Translucent-to-color intrinsic must refuse factorization."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    raw = tree.nodes.new("ShaderNodeRGB")
    raw.outputs["Color"].default_value = (0.5, 0.08, 0.12, 1.0)
    translucent = tree.nodes.new("ShaderNodeBsdfTranslucent")
    converted = tree.nodes.new("ShaderNodeShaderToRGB")
    geometry = tree.nodes.new("ShaderNodeNewGeometry")
    mix = tree.nodes.new("ShaderNodeMixRGB")
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(raw.outputs["Color"], translucent.inputs["Color"])
    tree.links.new(translucent.outputs["BSDF"], converted.inputs["Shader"])
    tree.links.new(geometry.outputs["Backfacing"], mix.inputs["Fac"])
    tree.links.new(raw.outputs["Color"], mix.inputs["Color1"])
    tree.links.new(converted.outputs["Color"], mix.inputs["Color2"])
    tree.links.new(mix.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    compiler.set_web_source(
        material, raw, raw.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_independent_lit_branch_material(compiler, name):
    """A separate lit shader branch must not relabel an unlit selected field."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    selected = tree.nodes.new("ShaderNodeRGB")
    selected.name = "Artist Selected Field"
    mix = tree.nodes.new("ShaderNodeMixShader")
    lit = tree.nodes.new("ShaderNodeBsdfDiffuse")
    tree.links.new(selected.outputs["Color"], mix.inputs[1])
    tree.links.new(lit.outputs["BSDF"], mix.inputs[2])
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    compiler.set_web_source(
        material, selected, selected.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_disconnected_lit_conversion_material(compiler, name):
    """Scratch Shader-to-RGB nodes must not affect the active selected path."""
    material = selected_surface_response_material(compiler, name, "unlit")
    tree = material.node_tree
    scratch_lit = tree.nodes.new("ShaderNodeBsdfDiffuse")
    scratch_conversion = tree.nodes.new("ShaderNodeShaderToRGB")
    tree.links.new(
        scratch_lit.outputs["BSDF"], scratch_conversion.inputs["Shader"],
    )
    return material


def selected_translucent_surface_material(compiler, name):
    """A non-portable BSDF response must not be relabeled ordinary PBR."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    selected = tree.nodes.new("ShaderNodeRGB")
    selected.name = "Artist Selected Field"
    translucent = tree.nodes.new("ShaderNodeBsdfTranslucent")
    tree.links.new(selected.outputs["Color"], translucent.inputs["Color"])
    tree.links.new(translucent.outputs["BSDF"], output.inputs["Surface"])
    compiler.set_web_source(
        material, selected, selected.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_procedural_material(compiler, name, uv_name=None):
    """Selected intrinsic field with an unrelated downstream EEVEE branch."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "Artist Output"
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "Artist EEVEE Presentation"
    shader_to_rgb = tree.nodes.new("ShaderNodeShaderToRGB")
    shader_to_rgb.name = "Artist Downstream Shader to RGB"
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.name = "Artist Lit Surface"
    coordinates = tree.nodes.new(
        "ShaderNodeUVMap" if uv_name else "ShaderNodeTexCoord"
    )
    coordinates.name = "Artist Coordinates"
    if uv_name:
        coordinates.uv_map = uv_name
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.name = "Artist Mapping"
    checker = tree.nodes.new("ShaderNodeTexChecker")
    checker.name = "Artist Intrinsic Checker"
    checker.inputs["Color1"].default_value = (0.025, 0.12, 0.82, 1.0)
    checker.inputs["Color2"].default_value = (0.92, 0.08, 0.025, 1.0)
    checker.inputs["Scale"].default_value = 7.0
    tree.links.new(
        coordinates.outputs["UV" if uv_name else "Object"],
        mapping.inputs["Vector"],
    )
    tree.links.new(mapping.outputs["Vector"], checker.inputs["Vector"])
    tree.links.new(checker.outputs["Color"], diffuse.inputs["Color"])
    tree.links.new(diffuse.outputs["BSDF"], shader_to_rgb.inputs["Shader"])
    tree.links.new(shader_to_rgb.outputs["Color"], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    compiler.set_web_source(
        material, checker, checker.outputs["Color"].identifier, "COLOR",
    )
    return material


def selected_out_of_range_material(compiler, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    value = material.node_tree.nodes.new("ShaderNodeMath")
    value.name = "Artist Out of Range Field"
    value.operation = "ADD"
    value.inputs[0].default_value = 1.25
    value.inputs[1].default_value = 0.25
    principled = material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(value.outputs["Value"], principled.inputs["Base Color"])
    compiler.set_web_source(
        material, value, value.outputs["Value"].identifier, "COLOR",
    )
    return material


def rgba_png_bytes():
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload)) + kind + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    width = 2
    height = 2
    pixels = bytes((
        255, 32, 16, 255, 16, 255, 32, 255,
        32, 16, 255, 255, 255, 224, 32, 255,
    ))
    rows = b"".join(
        b"\x00" + pixels[row * width * 4:(row + 1) * width * 4]
        for row in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def image_triangle_object(name):
    obj = triangle_object(name)
    uv = obj.data.uv_layers.new(name="Picture UV")
    uv.active_render = True
    obj.data.uv_layers.active = uv
    for item, value in zip(uv.data, ((0.125, 0.25), (0.875, 0.25), (0.5, 0.75))):
        item.uv = value
    obj.data.update()
    return obj


def named_image_triangle_object(name):
    obj = triangle_object(name)
    base = obj.data.uv_layers.new(name="Base UV")
    base.active_render = True
    picture = obj.data.uv_layers.new(name="Picture UV")
    for item, value in zip(base.data, ((0, 0), (1, 0), (0.5, 1))):
        item.uv = value
    for item, value in zip(picture.data, ((0.2, 0.3), (0.8, 0.3), (0.5, 0.7))):
        item.uv = value
    obj.data.uv_layers.active = base
    obj.data.update()
    return obj


def selected_image_material(compiler, name, image, uv_name=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.name = "Artist Picture"
    texture.image = image
    texture.projection = "FLAT"
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    if uv_name:
        uv_map = material.node_tree.nodes.new("ShaderNodeUVMap")
        uv_map.uv_map = uv_name
        material.node_tree.links.new(
            uv_map.outputs["UV"], texture.inputs["Vector"],
        )
    principled = material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(texture.outputs["Color"], principled.inputs["Base Color"])
    compiler.set_web_source(
        material, texture, texture.outputs["Color"].identifier, "COLOR",
    )
    return material


def curve_object(name):
    curve = bpy.data.curves.new(f"{name} Curve", type="CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("POLY")
    spline.points.add(1)
    spline.points[0].co = (0, 0, 0, 1)
    spline.points[1].co = (1, 0, 0, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def geometry_nodes_material_object(name, material):
    obj = triangle_object(name)
    tree = bpy.data.node_groups.new(f"{name} Nodes", "GeometryNodeTree")
    tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    group_input = tree.nodes.new("NodeGroupInput")
    group_output = tree.nodes.new("NodeGroupOutput")
    set_material = tree.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    tree.links.new(group_input.outputs["Geometry"], set_material.inputs["Geometry"])
    tree.links.new(set_material.outputs["Geometry"], group_output.inputs["Geometry"])
    modifier = obj.modifiers.new("Evaluated Material", "NODES")
    modifier.node_group = tree
    return obj


def geometry_nodes_curve_material_object(name, material):
    obj = curve_object(name)
    tree = bpy.data.node_groups.new(f"{name} Nodes", "GeometryNodeTree")
    tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    group_output = tree.nodes.new("NodeGroupOutput")
    cube = tree.nodes.new("GeometryNodeMeshCube")
    set_material = tree.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    tree.links.new(cube.outputs["Mesh"], set_material.inputs["Geometry"])
    tree.links.new(set_material.outputs["Geometry"], group_output.inputs["Geometry"])
    modifier = obj.modifiers.new("Evaluated Curve Material", "NODES")
    modifier.node_group = tree
    return obj


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    compiler = importlib.import_module(f"{PACKAGE}.material_compiler")
    try:
        jpeg_fixture = base64.b64decode(
            "/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJtAEx7/2Q=="
        )
        expect(
            compiler._encoded_image_info(jpeg_fixture) == ("image/jpeg", 2, 3),
            "JPEG byte/dimension attestation parser drifted",
        )
        # Cross-language golden vector shared with sceneDiagnostics.test.ts.
        # This exercises the complete Python pre-optimizer association writer,
        # not only its individual hash helpers.
        golden_positions = struct.pack(
            "<9f",
            0.0, 0.0, 0.0,
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
        )
        golden_uvs = struct.pack(
            "<6f",
            0.125, 0.75,
            0.875, 0.75,
            0.5, 0.25,
        )
        golden_primitive = {
            "mode": 4,
            "attributes": {"POSITION": 0, "TEXCOORD_0": 1},
        }
        golden_document = {
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": len(golden_positions)},
                {
                    "buffer": 0,
                    "byteOffset": len(golden_positions),
                    "byteLength": len(golden_uvs),
                },
            ],
            "accessors": [
                {
                    "bufferView": 0,
                    "componentType": 5126,
                    "count": 3,
                    "type": "VEC3",
                },
                {
                    "bufferView": 1,
                    "componentType": 5126,
                    "count": 3,
                    "type": "VEC2",
                },
            ],
            "meshes": [{"primitives": [golden_primitive]}],
        }
        golden_association = compiler._uv_geometry_association(
            golden_document,
            golden_positions + golden_uvs,
            [(0, 0, golden_primitive)],
            0,
        )
        expect(
            golden_association == {
                "algorithm": "mesh-position14-uv-triangles-v1",
                "hash": "a26224e3b03b793bbc96f5e6cefc3eeae345a3864f98e28b79ab9ee3e217ceb1",
                "triangleCount": 1,
                "positionGrids": [{
                    "mesh": 0,
                    "bits": 14,
                    "offset": [0.5, 0.5, 0.0],
                    "scale": 0.5,
                }],
            },
            f"Python/TypeScript primitive-corner golden vector drifted: "
            f"{golden_association}",
        )
        vertex_obj = triangle_object("Vertex Painted")
        vertex_material = selected_vertex_material(compiler, "Selected Vertex")
        vertex_obj.data.materials.append(vertex_material)
        vertex_obj.shape_key_add(name="Basis")
        raised = vertex_obj.shape_key_add(name="Raised")
        raised.data[0].co.z = 0.25
        shape_action = bpy.data.actions.new("Selected Vertex Shape Action")
        vertex_obj.data.shape_keys.animation_data_create()
        vertex_obj.data.shape_keys.animation_data.action = shape_action
        vertex_instance = bpy.data.objects.new("Vertex Painted Instance", vertex_obj.data)
        vertex_instance.location.y = 3
        bpy.context.scene.collection.objects.link(vertex_instance)

        same_layer_obj = two_slot_vertex_object("Two Slots Same Layer")
        same_layer_obj.location.y = 6
        same_layer_obj.data.materials.append(selected_vertex_material(
            compiler, "Same Layer Red", "Paint",
        ))
        same_layer_obj.data.materials.append(selected_vertex_material(
            compiler, "Same Layer Green", "Paint",
        ))

        distinct_layer_obj = two_slot_vertex_object("Two Slots Distinct Layers")
        distinct_layer_obj.location.y = 9
        distinct_layer_obj.data.materials.append(selected_vertex_material(
            compiler, "Distinct Layer Paint", "Paint",
        ))
        distinct_layer_obj.data.materials.append(selected_vertex_material(
            compiler, "Distinct Layer Detail", "Detail",
        ))

        constant_obj = triangle_object("Constant Painted")
        constant_obj.location.x = 3
        constant_material = selected_constant_material(compiler, "Selected Constant")
        constant_obj.data.materials.append(constant_material)
        unused_material = selected_constant_material(compiler, "Selected But Unused")
        constant_obj.data.materials.append(unused_material)

        procedural_obj = triangle_object("Procedural Painted")
        procedural_obj.location.x = 12
        # An artist UV with the compiler's preferred private name, deliberately
        # folded and outside 0..1. The selected field uses Object coordinates,
        # so the transaction must preserve this layer byte-for-byte while
        # allocating and packing a distinct private bake UV.
        colliding_uv = procedural_obj.data.uv_layers.new(
            name="BLENDLINK_WEB_ATLAS",
        )
        colliding_uv.active_render = True
        for item, value in zip(
            colliding_uv.data,
            ((-1.25, 2.5), (-1.25, 2.5), (3.75, -0.5)),
        ):
            item.uv = value
        procedural_obj.data.uv_layers.active = colliding_uv
        procedural_obj.data.update()
        procedural_material = selected_procedural_material(
            compiler, "Selected Procedural", "BLENDLINK_WEB_ATLAS",
        )
        procedural_obj.data.materials.append(procedural_material)
        procedural_auto_plan = compiler.plan_materials(
            (procedural_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in procedural_auto_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "an Eevee-only Shader-to-RGB presentation was silently relabeled "
            f"as ordinary PBR: {procedural_auto_plan.as_dict()}",
        )
        compiler.set_surface_response(procedural_material, "LIT")
        procedural_plan = compiler.plan_materials(
            (procedural_obj,), purpose="final",
        )
        expect(
            not procedural_plan.errors
            and len(procedural_plan.lowerings) == 1
            and procedural_plan.lowerings[0].transport == "image"
            and procedural_plan.lowerings[0].surface_response == "lit"
            and procedural_plan.lowerings[0].color is not None
            and procedural_plan.lowerings[0].color.kind == "materialized",
            "one static opaque selected intrinsic field did not plan a private "
            f"image materialization: {procedural_plan.as_dict()}",
        )

        unlit_obj = triangle_object("Unlit Selected Field")
        unlit_obj.data.materials.append(selected_surface_response_material(
            compiler, "Unlit Selected Field Material", "unlit",
        ))
        unlit_plan = compiler.plan_materials((unlit_obj,), purpose="inspect")
        expect(
            not unlit_plan.errors
            and unlit_plan.lowerings[0].surface_response == "unlit",
            "a selected field feeding the active Emission surface was not "
            f"classified as unlit: {unlit_plan.as_dict()}",
        )

        mixed_obj = triangle_object("Mixed Surface Selected Field")
        mixed_obj.data.materials.append(selected_surface_response_material(
            compiler, "Mixed Surface Selected Field Material", "mixed",
        ))
        mixed_plan = compiler.plan_materials((mixed_obj,), purpose="inspect")
        expect(
            [issue.code for issue in mixed_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "a selected field feeding both lit and unlit active-surface "
            f"branches was guessed instead of blocked: {mixed_plan.as_dict()}",
        )

        unreachable_obj = triangle_object("Unreachable Surface Selected Field")
        unreachable_material = selected_surface_response_material(
            compiler, "Unreachable Surface Selected Field Material", "unreachable",
        )
        unreachable_obj.data.materials.append(unreachable_material)
        unreachable_plan = compiler.plan_materials(
            (unreachable_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in unreachable_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "a selected field disconnected from the active Surface was guessed "
            f"instead of blocked: {unreachable_plan.as_dict()}",
        )
        compiler.set_surface_response(unreachable_material, "UNLIT")
        overridden_unreachable_plan = compiler.plan_materials(
            (unreachable_obj,), purpose="inspect",
        )
        expect(
            not overridden_unreachable_plan.errors
            and overridden_unreachable_plan.lowerings[0].surface_response
            == "unlit",
            "an explicit unlit response did not resolve the deliberately "
            f"detached website field: {overridden_unreachable_plan.as_dict()}",
        )
        compiler.set_surface_response(unreachable_material, "AUTO")

        grouped_obj = triangle_object("Grouped Lit Selected Field")
        grouped_obj.data.materials.append(selected_group_lit_material(
            compiler, "Grouped Lit Selected Field Material",
        ))
        grouped_plan = compiler.plan_materials((grouped_obj,), purpose="inspect")
        expect(
            not grouped_plan.errors
            and grouped_plan.lowerings[0].surface_response == "lit",
            "a selected field feeding a Principled surface inside one shader "
            f"group was not classified as lit: {grouped_plan.as_dict()}",
        )

        parallel_lighting_obj = triangle_object(
            "Parallel Lighting Selected Field",
        )
        parallel_lighting_obj.data.materials.append(
            selected_parallel_lighting_material(
                compiler, "Parallel Lighting Selected Field Material",
            ),
        )
        parallel_lighting_plan = compiler.plan_materials(
            (parallel_lighting_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in parallel_lighting_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"]
            and '"Complete Intrinsic Result -> Color (Color)"'
            in parallel_lighting_plan.errors[0].problem
            and "will not change the artist-selected socket"
            in parallel_lighting_plan.errors[0].problem,
            "a selected intrinsic field combined with an Eevee-only "
            "Diffuse-to-Shader-to-RGB response was silently relabeled or did "
            "not name its unique downstream complete intrinsic candidate: "
            f"ordinary PBR: {parallel_lighting_plan.as_dict()}",
        )

        static_floor_obj = triangle_object(
            "Exact Static Shade Floor Selected Field",
        )
        static_floor_obj.location.x = 15
        static_floor_obj.data.materials.append(
            selected_static_floor_material(
                compiler, "Exact Static Shade Floor Material",
            ),
        )
        static_floor_plan = compiler.plan_materials(
            (static_floor_obj,), purpose="final",
        )
        static_floor_decision = static_floor_plan.lowerings[0]
        expect(
            not static_floor_plan.errors
            and static_floor_decision.surface_response == "lit"
            and static_floor_decision.transport == "image"
            and static_floor_decision.color is not None
            and static_floor_decision.color.kind == "materialized"
            and static_floor_decision.surface_factorization is not None
            and static_floor_decision.surface_factorization.model
            == compiler.STATIC_SHADE_FLOOR_MODEL
            and abs(
                static_floor_decision.surface_factorization.shade_value - 0.7
            ) < 1e-6
            and tuple(
                round(value, 6)
                for value in static_floor_decision.surface_factorization.shade_color
            ) == (0.08, 0.2, 0.42, 1.0),
            "the exact name-agnostic intrinsic/static-floor response did not "
            f"produce a bounded stock-glTF factorization: {static_floor_plan.as_dict()}",
        )

        near_miss_obj = triangle_object(
            "Post Transform Static Floor Near Miss",
        )
        near_miss_obj.data.materials.append(
            selected_static_floor_material(
                compiler,
                "Post Transform Static Floor Near Miss Material",
                post_transform=True,
            ),
        )
        near_miss_plan = compiler.plan_materials(
            (near_miss_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in near_miss_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "a post-response color transform widened the exact static-floor "
            f"family instead of refusing: {near_miss_plan.as_dict()}",
        )

        muted_group_obj = triangle_object(
            "Muted Group Static Floor Near Miss",
        )
        muted_group_material = selected_static_floor_material(
            compiler, "Muted Group Static Floor Near Miss Material",
        )
        muted_group_obj.data.materials.append(muted_group_material)
        muted_group_material.node_tree.nodes[
            "Names Do Not Define This Family"
        ].mute = True
        muted_group_plan = compiler.plan_materials(
            (muted_group_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in muted_group_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"]
            and not muted_group_plan.lowerings,
            "a muted outer response group entered the exact static-floor "
            f"family instead of refusing: {muted_group_plan.as_dict()}",
        )

        for boundary_name, boundary_value in (
            ("Zero Direct Share", 0.0),
            ("Zero Static Floor", 1.0),
        ):
            boundary_obj = triangle_object(
                f"{boundary_name} Static Floor Boundary",
            )
            boundary_obj.data.materials.append(
                selected_static_floor_material(
                    compiler,
                    f"{boundary_name} Static Floor Boundary Material",
                    shade_value=boundary_value,
                ),
            )
            boundary_plan = compiler.plan_materials(
                (boundary_obj,), purpose="inspect",
            )
            expect(
                [issue.code for issue in boundary_plan.errors]
                == ["material.selected-field-surface-response-ambiguous"],
                f"degenerate shade share {boundary_value} planned a carrier "
                f"that the exporter can omit: {boundary_plan.as_dict()}",
            )

        animated_floor_obj = triangle_object(
            "Animated Static Floor Boundary",
        )
        animated_floor_material = selected_static_floor_material(
            compiler, "Animated Static Floor Boundary Material",
        )
        animated_floor_obj.data.materials.append(animated_floor_material)
        animated_response = animated_floor_material.node_tree.nodes[
            "Names Do Not Define This Family"
        ]
        response_share = animated_response.inputs["Response Share"]
        response_share.default_value = 0.65
        response_share.keyframe_insert("default_value", frame=1)
        response_share.default_value = 0.75
        response_share.keyframe_insert("default_value", frame=2)
        animated_floor_plan = compiler.plan_materials(
            (animated_floor_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in animated_floor_plan.errors]
            == ["material.selected-field-animated"],
            "an animated outer group-instance response parameter entered the "
            f"static-floor factorization: {animated_floor_plan.as_dict()}",
        )

        umbrella_obj = triangle_object("Umbrella Response Negative")
        umbrella_obj.data.materials.append(
            selected_umbrella_response_material(
                compiler, "Umbrella Response Negative Material",
            ),
        )
        umbrella_plan = compiler.plan_materials(
            (umbrella_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in umbrella_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "a selected raw field feeding a backfacing Translucent-to-Shader-"
            "to-RGB umbrella response entered the static-floor or generic PBR "
            f"route: {umbrella_plan.as_dict()}",
        )

        independent_lit_obj = triangle_object(
            "Independent Lit Branch Selected Field",
        )
        independent_lit_obj.data.materials.append(
            selected_independent_lit_branch_material(
                compiler, "Independent Lit Branch Selected Field Material",
            ),
        )
        independent_lit_plan = compiler.plan_materials(
            (independent_lit_obj,), purpose="inspect",
        )
        expect(
            not independent_lit_plan.errors
            and independent_lit_plan.lowerings[0].surface_response == "unlit",
            "an independent BSDF branch incorrectly relabeled the selected "
            f"unlit field as lit: {independent_lit_plan.as_dict()}",
        )

        disconnected_conversion_obj = triangle_object(
            "Disconnected Lit Conversion Selected Field",
        )
        disconnected_conversion_obj.data.materials.append(
            selected_disconnected_lit_conversion_material(
                compiler, "Disconnected Lit Conversion Selected Field Material",
            ),
        )
        disconnected_conversion_plan = compiler.plan_materials(
            (disconnected_conversion_obj,), purpose="inspect",
        )
        expect(
            not disconnected_conversion_plan.errors
            and disconnected_conversion_plan.lowerings[0].surface_response
            == "unlit",
            "a disconnected Shader-to-RGB scratch branch incorrectly "
            "relabeled the active selected field as lit: "
            f"{disconnected_conversion_plan.as_dict()}",
        )

        translucent_obj = triangle_object(
            "Translucent Surface Selected Field",
        )
        translucent_obj.data.materials.append(
            selected_translucent_surface_material(
                compiler, "Translucent Surface Selected Field Material",
            ),
        )
        translucent_plan = compiler.plan_materials(
            (translucent_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in translucent_plan.errors]
            == ["material.selected-field-surface-response-ambiguous"],
            "a selected field feeding a non-portable Translucent BSDF was "
            f"silently relabeled as ordinary PBR: {translucent_plan.as_dict()}",
        )

        shared_alpha_material = selected_vertex_material(
            compiler, "Selected Shared Alpha", "Paint",
        )
        opaque_alpha_obj = triangle_object("Opaque Shared Alpha")
        set_paint_alphas(opaque_alpha_obj, (1.0, 1.0, 1.0))
        opaque_alpha_obj.data.materials.append(shared_alpha_material)
        varying_alpha_obj = triangle_object("Varying Shared Alpha")
        varying_alpha_obj.data.materials.append(shared_alpha_material)
        masked_alpha_obj = triangle_object("Masked Shared Alpha")
        set_paint_alphas(masked_alpha_obj, (0.0, 1.0, 0.0))
        masked_alpha_obj.data.materials.append(shared_alpha_material)
        shared_alpha_plan = compiler.plan_materials(
            (opaque_alpha_obj, varying_alpha_obj, masked_alpha_obj,),
            purpose="final",
        )
        shared_alpha_decision = shared_alpha_plan.lowerings[0]
        expect(
            not shared_alpha_plan.errors
            and {
                binding.object_name: binding.alpha_mode
                for binding in shared_alpha_decision.bindings
            } == {
                "Masked Shared Alpha": "MASK",
                "Opaque Shared Alpha": "OPAQUE",
                "Varying Shared Alpha": "BLEND",
            },
            "shared vertex-alpha bindings were not classified independently "
            f"for safe material splitting: {shared_alpha_plan.as_dict()}",
        )

        eevee_selected_obj = triangle_object("EEVEE Selected Field")
        eevee_selected_material = selected_procedural_material(
            compiler, "EEVEE Selected Field Material",
        )
        eevee_selected_obj.data.materials.append(eevee_selected_material)
        eevee_node = eevee_selected_material.node_tree.nodes[
            "Artist Downstream Shader to RGB"
        ]
        compiler.set_web_source(
            eevee_selected_material,
            eevee_node,
            eevee_node.outputs["Color"].identifier,
            "COLOR",
        )
        eevee_selected_plan = compiler.plan_materials(
            (eevee_selected_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in eevee_selected_plan.errors]
            == ["material.selected-field-eevee-only"],
            "an EEVEE-only selected field did not block with its exact "
            f"artist-facing reason: {eevee_selected_plan.as_dict()}",
        )

        ao_obj = triangle_object("Scene Dependent Selected Field")
        ao_material = bpy.data.materials.new("Scene Dependent Selected Field Material")
        ao_material.use_nodes = True
        ao_node = ao_material.node_tree.nodes.new("ShaderNodeAmbientOcclusion")
        compiler.set_web_source(
            ao_material, ao_node, ao_node.outputs["Color"].identifier, "COLOR",
        )
        ao_obj.data.materials.append(ao_material)
        ao_plan = compiler.plan_materials((ao_obj,), purpose="inspect")
        expect(
            [issue.code for issue in ao_plan.errors]
            == ["material.selected-field-scene-dependent"],
            "scene-dependent AO was silently treated as an intrinsic field: "
            f"{ao_plan.as_dict()}",
        )

        view_obj = triangle_object("View Dependent Selected Field")
        view_material = bpy.data.materials.new("View Dependent Selected Field Material")
        view_material.use_nodes = True
        view_tree = view_material.node_tree
        coordinates = view_tree.nodes.new("ShaderNodeTexCoord")
        separate = view_tree.nodes.new("ShaderNodeSeparateXYZ")
        view_tree.links.new(coordinates.outputs["Camera"], separate.inputs["Vector"])
        compiler.set_web_source(
            view_material, separate, separate.outputs["X"].identifier, "COLOR",
        )
        view_obj.data.materials.append(view_material)
        view_plan = compiler.plan_materials((view_obj,), purpose="inspect")
        expect(
            [issue.code for issue in view_plan.errors]
            == ["material.selected-field-view-dependent"],
            "camera-coordinate selected field did not block before baking: "
            f"{view_plan.as_dict()}",
        )

        external_obj = bpy.data.objects.new("External Coordinate Driver", None)
        bpy.context.scene.collection.objects.link(external_obj)
        external_field_obj = triangle_object("External Object Selected Field")
        external_field_material = selected_procedural_material(
            compiler, "External Object Selected Field Material",
        )
        external_field_material.node_tree.nodes[
            "Artist Coordinates"
        ].object = external_obj
        external_field_obj.data.materials.append(external_field_material)
        external_field_plan = compiler.plan_materials(
            (external_field_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in external_field_plan.errors]
            == ["material.selected-field-external-object"],
            "an external Texture Coordinate object entered a plan without a "
            f"dependency fingerprint: {external_field_plan.as_dict()}",
        )

        range_obj = triangle_object("Out of Range Selected Field")
        range_material = selected_out_of_range_material(
            compiler, "Out of Range Selected Field Material",
        )
        range_obj.data.materials.append(range_material)
        range_plan = compiler.plan_materials((range_obj,), purpose="inspect")
        expect(
            not range_plan.errors
            and range_plan.lowerings[0].color.kind == "materialized",
            "materialized unit-range validation was bypassed during planning: "
            f"{range_plan.as_dict()}",
        )

        missing_image = bpy.data.images.new(
            "Missing Selected Field Image",
            width=2,
            height=2,
        )
        missing_image.source = "FILE"
        missing_image.filepath_raw = "//definitely-missing-selected-field.png"
        missing_image_obj = triangle_object("Missing Image Selected Field")
        missing_image_material = bpy.data.materials.new(
            "Missing Image Selected Field Material"
        )
        missing_image_material.use_nodes = True
        missing_tree = missing_image_material.node_tree
        texture = missing_tree.nodes.new("ShaderNodeTexImage")
        texture.image = missing_image
        hue = missing_tree.nodes.new("ShaderNodeHueSaturation")
        missing_tree.links.new(texture.outputs["Color"], hue.inputs["Color"])
        compiler.set_web_source(
            missing_image_material,
            hue,
            hue.outputs["Color"].identifier,
            "COLOR",
        )
        missing_image_obj.data.materials.append(missing_image_material)
        missing_image_plan = compiler.plan_materials(
            (missing_image_obj,), purpose="inspect",
        )
        expect(
            [issue.code for issue in missing_image_plan.errors]
            == ["material.selected-field-image-bytes-unavailable"],
            "missing procedural image bytes did not block before rendering an "
            f"error color: {missing_image_plan.as_dict()}",
        )

        scene = bpy.context.scene
        old_resolution = (
            scene.render.resolution_x,
            scene.render.resolution_y,
            scene.render.resolution_percentage,
        )
        old_scene_camera = scene.camera
        old_units = (
            scene.unit_settings.system,
            scene.unit_settings.scale_length,
        )
        camera_data = bpy.data.cameras.new("Enclosing Receiver Camera")
        camera_obj = bpy.data.objects.new(
            "Enclosing Receiver Camera", camera_data,
        )
        scene.collection.objects.link(camera_obj)
        camera_obj["blendlink_id"] = "enclosing-receiver-camera"
        camera_data.clip_start = 0.1
        camera_data.clip_end = 100.0
        far_camera_data = bpy.data.cameras.new("Active Far Camera")
        far_camera_data.type = "ORTHO"
        far_camera_data.ortho_scale = 100.0
        far_camera_data.clip_start = 0.1
        far_camera_data.clip_end = 100.0
        far_camera = bpy.data.objects.new("Active Far Camera", far_camera_data)
        far_camera.location.z = 50.0
        scene.collection.objects.link(far_camera)
        scene.camera = far_camera
        stack_mesh = bpy.data.meshes.new("Projected Triangle Stack Mesh")
        stack_mesh.from_pydata(
            (
                (-1, -1, 0), (1, -1, 0), (0, 1, 0),
                (-1, -1, -1), (1, -1, -1), (0, 1, -1),
            ),
            (),
            ((0, 1, 2), (3, 4, 5)),
        )
        stack_mesh.update()
        stack_obj = bpy.data.objects.new(
            "Projected Triangle Stack", stack_mesh,
        )
        scene.collection.objects.link(stack_obj)
        bpy.ops.mesh.primitive_cube_add(size=10.0, location=(0.0, 0.0, 0.0))
        enclosing = bpy.context.object
        enclosing.name = "Camera Inside Receiver"
        try:
            scene.render.resolution_x = 320
            scene.render.resolution_y = 180
            scene.render.resolution_percentage = 100
            stack_mesh.polygons[1].material_index = 1
            single_projected_area = (
                compiler.bakelib._material_projected_pixel_area(
                    stack_obj, 0, far_camera, 320, 180,
                )
            )
            stack_mesh.polygons[1].material_index = 0
            double_projected_area = (
                compiler.bakelib._material_projected_pixel_area(
                    stack_obj, 0, far_camera, 320, 180,
                )
            )
            expect(
                single_projected_area > 0.0
                and abs(
                    double_projected_area - 2.0 * single_projected_area
                ) < 1.0e-6,
                "projected density metric stopped being the documented "
                "continuous triangle-area sum: "
                f"{single_projected_area} -> {double_projected_area}",
            )
            scene.unit_settings.system = "METRIC"
            scene.unit_settings.scale_length = 0.01
            projected_plan = compiler.bakelib.plan_material_texture_resolution(
                enclosing,
                0,
                purpose="final",
            )
            expect(
                projected_plan["policy"] == "projected-camera-coverage"
                and projected_plan["camera"] == camera_obj.name
                and projected_plan["measurementModel"]
                == "selected-field-density-v1"
                and projected_plan["projectionMetric"]
                == "clipped-triangle-area-sum-capped-to-viewport"
                and projected_plan["cameraScope"]
                == "all-scene-perspective-orthographic-cameras"
                and projected_plan["cameraSelection"]
                == "maximum-projected-triangle-area-sum"
                and projected_plan["selectedCameraName"] == camera_obj.name
                and projected_plan["selectedCameraStableId"]
                == "enclosing-receiver-camera"
                and projected_plan["eligibleCameraCount"] == 2
                and projected_plan["projectingCameraCount"] == 2
                and 0.99
                <= projected_plan["projectedCoverageFraction"]
                <= 1.0
                and projected_plan["targetProjectedPixels"] <= 320 * 180,
                "camera-inside receiver sizing used world-area/centre density "
                f"instead of bounded screen coverage: {projected_plan}",
            )
            expect(
                projected_plan["targetProjectedPixels"]
                == projected_plan[
                    "projectedTriangleAreaSumPixelAreaCapped"
                ]
                and projected_plan["projectedCoverageFraction"]
                == projected_plan[
                    "projectedTriangleAreaSumFractionCapped"
                ]
                and projected_plan["sourceUnitSystem"] == "METRIC"
                and abs(
                    projected_plan["sourceMetersPerBlenderUnit"] - 0.01
                ) < 1.0e-8
                and projected_plan["worldAreaM2"]
                == projected_plan[
                    "sourceWorldAreaBlenderUnitsSquared"
                ]
                and abs(
                    projected_plan["sourceWorldAreaSquareMeters"]
                    - projected_plan[
                        "sourceWorldAreaBlenderUnitsSquared"
                    ] * projected_plan["sourceMetersPerBlenderUnit"] ** 2
                ) < 1.0e-12,
                "selected-field source units or legacy projection aliases "
                f"changed meaning: {projected_plan}",
            )
            scene.unit_settings.system = "NONE"
            unitless_plan = (
                compiler.bakelib.plan_material_texture_resolution(
                    enclosing,
                    0,
                    purpose="final",
                )
            )
            expect(
                unitless_plan["sourceUnitSystem"] == "NONE"
                and unitless_plan["sourceMetersPerBlenderUnit"] is None
                and unitless_plan["sourceWorldAreaSquareMeters"] is None
                and unitless_plan[
                    "sourceWorldAreaBlenderUnitsSquared"
                ] == projected_plan[
                    "sourceWorldAreaBlenderUnitsSquared"
                ]
                and unitless_plan[
                    "projectedTriangleAreaSumPixelAreaCapped"
                ] == projected_plan[
                    "projectedTriangleAreaSumPixelAreaCapped"
                ],
                "unit-display settings changed raw geometry/projection facts "
                f"or invented meters for NONE: {unitless_plan}",
            )
        finally:
            (
                scene.render.resolution_x,
                scene.render.resolution_y,
                scene.render.resolution_percentage,
            ) = old_resolution
            scene.camera = old_scene_camera
            (
                scene.unit_settings.system,
                scene.unit_settings.scale_length,
            ) = old_units
            bpy.data.objects.remove(enclosing, do_unlink=True)
            bpy.data.objects.remove(stack_obj, do_unlink=True)
            bpy.data.meshes.remove(stack_mesh)
            bpy.data.objects.remove(far_camera, do_unlink=True)
            bpy.data.cameras.remove(far_camera_data)
            bpy.data.objects.remove(camera_obj, do_unlink=True)
            bpy.data.cameras.remove(camera_data)

        image_payload = rgba_png_bytes()
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as image_file:
            image_file.write(image_payload)
            image_path = Path(image_file.name)
        try:
            picture = bpy.data.images.load(str(image_path), check_existing=False)
            picture.name = "Packed Website Picture"
            picture.colorspace_settings.name = "sRGB"
            picture.alpha_mode = "STRAIGHT"
            picture.pack()
        finally:
            image_path.unlink(missing_ok=True)
        image_obj = image_triangle_object("Image Painted")
        image_obj.location.x = 6
        image_material = selected_image_material(
            compiler, "Selected Image", picture,
        )
        image_obj.data.materials.append(image_material)
        image_node = image_material.node_tree.nodes["Artist Picture"]
        picture.colorspace_settings.name = "Non-Color"
        _source, issue = compiler._classify_source(
            image_material.name, (image_node, image_node.outputs["Color"]), "color",
        )
        expect(
            issue is not None and issue.code == "material.image-colorspace-unsupported",
            "Non-Color image was silently relabelled as glTF base color",
        )
        picture.colorspace_settings.name = "sRGB"
        uv_map = image_material.node_tree.nodes.new("ShaderNodeUVMap")
        uv_map.uv_map = "Picture UV"
        image_material.node_tree.links.new(
            uv_map.outputs["UV"], image_node.inputs["Vector"],
        )
        named_source, issue = compiler._classify_source(
            image_material.name, (image_node, image_node.outputs["Color"]), "color",
        )
        expect(
            issue is None and named_source.uv_mode == "named"
            and named_source.uv_name == "Picture UV",
            f"direct named UV Map did not classify exactly: {issue}",
        )
        image_material.node_tree.links.remove(image_node.inputs["Vector"].links[0])
        named_image_obj = named_image_triangle_object("Named Image Painted")
        named_image_obj.location.x = 9
        named_image_material = selected_image_material(
            compiler, "Selected Named Image", picture, "Picture UV",
        )
        named_image_obj.data.materials.append(named_image_material)

        unproven = bpy.data.materials.new("Unproven Alpha")
        unproven.use_nodes = True
        tree = unproven.node_tree
        output = tree.nodes.get("Material Output")
        tree.links.remove(output.inputs["Surface"].links[0])
        transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
        principled = tree.nodes.get("Principled BSDF")
        mix = tree.nodes.new("ShaderNodeMixShader")
        tree.links.new(transparent.outputs[0], mix.inputs[1])
        tree.links.new(principled.outputs[0], mix.inputs[2])
        tree.links.new(mix.outputs[0], output.inputs["Surface"])
        rgb = tree.nodes.new("ShaderNodeRGB")
        tree.links.new(rgb.outputs["Color"], principled.inputs["Base Color"])
        compiler.set_web_source(unproven, rgb, rgb.outputs["Color"].identifier, "COLOR")
        blocked_obj = triangle_object("Blocked Alpha")
        blocked_obj.data.materials.append(unproven)

        # Exact source semantics: output names are part of the contract. The
        # compiler must not reinterpret an attribute Alpha as Color or an RGB
        # Color socket as a scalar alpha conversion.
        vertex_node = vertex_material.node_tree.nodes["Artist Paint"]
        _source, issue = compiler._classify_source(
            vertex_material.name,
            (vertex_node, vertex_node.outputs["Alpha"]),
            "color",
        )
        expect(
            issue is not None and issue.code == "material.source-conversion-unsupported",
            "attribute Alpha was silently reinterpreted as Website Color",
        )
        rgb_node = constant_material.node_tree.nodes["Artist Constant"]
        _source, issue = compiler._classify_source(
            constant_material.name,
            (rgb_node, rgb_node.outputs["Color"]),
            "alpha",
        )
        expect(
            issue is not None and issue.code == "material.source-conversion-unsupported",
            "RGBA Color was silently reinterpreted as Website Alpha",
        )
        constant_material.diffuse_color = (0.2, 0.3, 0.4, 0.2)
        expect(
            not compiler._requires_alpha(constant_material),
            "legacy viewport diffuse alpha overrode an opaque active node graph",
        )
        holdout_material = bpy.data.materials.new("Holdout Coverage")
        holdout_material.use_nodes = True
        holdout_tree = holdout_material.node_tree
        holdout_output = holdout_tree.nodes.get("Material Output")
        holdout_tree.links.remove(holdout_output.inputs["Surface"].links[0])
        holdout = holdout_tree.nodes.new("ShaderNodeHoldout")
        holdout_tree.links.new(holdout.outputs[0], holdout_output.inputs["Surface"])
        expect(
            compiler._requires_alpha(holdout_material),
            "reachable Holdout coverage was not detected",
        )

        curve = curve_object("Selected Curve")
        curve_material = selected_constant_material(compiler, "Selected Curve Material")
        curve.data.materials.append(curve_material)
        curve_plan = compiler.plan_materials((curve,), purpose="inspect")
        expect(
            [issue.code for issue in curve_plan.errors] == ["material.binding-type-unsupported"],
            f"marked Curve binding disappeared instead of blocking: {curve_plan.as_dict()}",
        )

        evaluated_material = selected_constant_material(
            compiler, "Selected Evaluated Material",
        )
        evaluated_obj = geometry_nodes_material_object(
            "Geometry Nodes Material", evaluated_material,
        )
        evaluated_plan = compiler.plan_materials((evaluated_obj,), purpose="inspect")
        expect(
            [issue.code for issue in evaluated_plan.errors]
            == ["material.evaluated-binding-unsupported"],
            f"evaluated-only marked material disappeared instead of blocking: {evaluated_plan.as_dict()}",
        )

        evaluated_curve_material = selected_constant_material(
            compiler, "Selected Evaluated Curve Material",
        )
        evaluated_curve = geometry_nodes_curve_material_object(
            "Geometry Nodes Curve Material", evaluated_curve_material,
        )
        evaluated_curve_plan = compiler.plan_materials(
            (evaluated_curve,), purpose="inspect",
        )
        expect(
            [issue.code for issue in evaluated_curve_plan.errors]
            == ["material.evaluated-binding-unsupported"],
            "evaluated-only selected Curve material disappeared instead of blocking: "
            f"{evaluated_curve_plan.as_dict()}",
        )

        instance_source = triangle_object("Instanced Compiler Source")
        instance_material = selected_constant_material(
            compiler, "Instanced Compiler Material",
        )
        instance_source.data.materials.append(instance_material)
        instance_collection = bpy.data.collections.new("Compiler Instance Collection")
        bpy.context.scene.collection.objects.unlink(instance_source)
        instance_collection.objects.link(instance_source)
        for index in range(2):
            collection_instance = bpy.data.objects.new(
                f"Compiler Collection Instance {index + 1}", None,
            )
            collection_instance.instance_type = "COLLECTION"
            collection_instance.instance_collection = instance_collection
            collection_instance.location.x = 6 + index * 2
            bpy.context.scene.collection.objects.link(collection_instance)

        plan = compiler.plan_materials(
            (
                vertex_obj, vertex_instance, constant_obj, image_obj,
                named_image_obj, unlit_obj, opaque_alpha_obj,
                varying_alpha_obj, masked_alpha_obj, blocked_obj,
            ), purpose="final",
        )
        expect(len(plan.errors) == 1, f"unexpected compiler issues: {plan.as_dict()}")
        expect(
            plan.errors[0].code == "material.alpha-unresolved",
            f"transparent selected field did not block on alpha: {plan.errors[0]}",
        )

        compiler.clear_web_source(unproven)
        blocked_obj.hide_render = True
        plan = compiler.plan_materials(
            (
                vertex_obj, vertex_instance, constant_obj, image_obj,
                named_image_obj, unlit_obj, opaque_alpha_obj,
                varying_alpha_obj, masked_alpha_obj,
            ), purpose="final",
        )
        expect(not plan.errors, f"valid direct lowerings blocked: {plan.as_dict()}")
        expect(
            {(item.material_name, item.transport) for item in plan.lowerings}
            == {
                ("Selected Vertex", "vertexColor"),
                ("Selected Constant", "factor"),
                ("Selected Image", "image"),
                ("Selected Named Image", "image"),
                ("Selected Shared Alpha", "vertexColor"),
                ("Unlit Selected Field Material", "factor"),
            },
            f"wrong direct lowering decisions: {plan.as_dict()}",
        )
        expect(
            all(item.material_name != "Selected But Unused" for item in plan.decisions),
            "unused selected material slot entered the executable plan",
        )
        vertex_decision = next(
            item for item in plan.lowerings if item.material_name == "Selected Vertex"
        )
        expect(
            len(vertex_decision.bindings) == 2
            and all(binding.color_attribute == "Paint" for binding in vertex_decision.bindings)
            and all(binding.alpha_attribute == "Paint" for binding in vertex_decision.bindings),
            f"active color did not resolve per binding: {vertex_decision}",
        )
        expect(
            compiler.exporter_overrides(plan) == {
                "export_attributes": True,
                "export_all_vertex_colors": False,
            },
            "vertex-color plan did not claim its exact stock-export contract",
        )

        with tempfile.TemporaryDirectory(prefix="blendlink-material-compiler-") as directory:
            root = Path(directory)
            saved = root / "marker-roundtrip.blend"
            bpy.ops.wm.save_as_mainfile(filepath=str(saved), check_existing=False)
            bpy.ops.wm.open_mainfile(filepath=str(saved))
            vertex_obj = bpy.data.objects["Vertex Painted"]
            vertex_instance = bpy.data.objects["Vertex Painted Instance"]
            constant_obj = bpy.data.objects["Constant Painted"]
            image_obj = bpy.data.objects["Image Painted"]
            named_image_obj = bpy.data.objects["Named Image Painted"]
            unlit_obj = bpy.data.objects["Unlit Selected Field"]
            opaque_alpha_obj = bpy.data.objects["Opaque Shared Alpha"]
            varying_alpha_obj = bpy.data.objects["Varying Shared Alpha"]
            masked_alpha_obj = bpy.data.objects["Masked Shared Alpha"]
            instance_source = bpy.data.objects["Instanced Compiler Source"]
            instance_material = bpy.data.materials["Instanced Compiler Material"]
            expect(
                len(compiler.marker_nodes(bpy.data.materials["Selected Vertex"])) == 1,
                "Blendlink Web Color marker did not survive save/reopen",
            )
            plan = compiler.plan_materials(
                (
                    vertex_obj, vertex_instance, constant_obj, image_obj,
                    named_image_obj, unlit_obj, opaque_alpha_obj,
                    varying_alpha_obj, masked_alpha_obj,
                ), purpose="final",
            )

            procedural_obj = bpy.data.objects["Procedural Painted"]
            procedural_material = bpy.data.materials["Selected Procedural"]
            static_floor_obj = bpy.data.objects[
                "Exact Static Shade Floor Selected Field"
            ]
            static_floor_material = bpy.data.materials[
                "Exact Static Shade Floor Material"
            ]
            scene = bpy.context.scene
            scene.render.resolution_x = 256
            scene.render.resolution_y = 144
            scene.render.resolution_percentage = 100
            scene.render.engine = "BLENDER_EEVEE"
            scene.cycles.samples = 13
            materialization_unit_state = (
                scene.unit_settings.system,
                scene.unit_settings.scale_length,
            )
            scene.unit_settings.system = "METRIC"
            scene.unit_settings.scale_length = 0.01
            procedural_plan = compiler.plan_materials(
                (procedural_obj,), purpose="preview",
            )
            expect(
                not procedural_plan.errors
                and len(procedural_plan.lowerings) == 1,
                f"saved procedural plan changed: {procedural_plan.as_dict()}",
            )
            procedural_mesh = procedural_obj.data
            procedural_slot = procedural_obj.material_slots[0].material
            procedural_link = procedural_obj.material_slots[0].link
            procedural_material_hash = compiler._material_fingerprint(
                procedural_material,
            )
            procedural_uv_state = uv_snapshot(procedural_mesh)
            before_ids = {
                "materials": set(bpy.data.materials.keys()),
                "meshes": set(bpy.data.meshes.keys()),
                "images": set(bpy.data.images.keys()),
                "nodeGroups": set(bpy.data.node_groups.keys()),
            }
            before_engine = scene.render.engine
            before_cycles_samples = scene.cycles.samples
            bpy.ops.object.select_all(action="DESELECT")
            constant_obj.select_set(True)
            bpy.context.view_layer.objects.active = constant_obj
            before_selected = tuple(sorted(
                item.name for item in bpy.context.selected_objects
            ))
            before_active = (
                bpy.context.view_layer.objects.active.name
                if bpy.context.view_layer.objects.active is not None else None
            )
            before_mode = bpy.context.mode
            bake_properties = (
                "use_clear", "margin", "margin_type", "use_selected_to_active",
                "use_cage", "cage_extrusion", "max_ray_distance",
                "use_pass_direct", "use_pass_indirect", "use_pass_color",
                "use_pass_diffuse", "use_pass_glossy",
                "use_pass_transmission", "use_pass_emit", "normal_space",
            )
            before_bake = {
                name: getattr(scene.render.bake, name)
                for name in bake_properties
                if hasattr(scene.render.bake, name)
            }
            procedural_out = root / "procedural-selected-field.glb"

            stale_plan = procedural_plan
            checker_scale = procedural_material.node_tree.nodes[
                "Artist Intrinsic Checker"
            ].inputs["Scale"]
            old_scale = float(checker_scale.default_value)
            checker_scale.default_value = old_scale + 1.0

            def emit_stale_plan(_output_path):
                raise AssertionError(
                    "stale selected-field plan reached the export continuation"
                )

            try:
                compiler.with_compiled_materials(
                    stale_plan,
                    str(root / "stale-selected-field.glb"),
                    emit_stale_plan,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "changed after planning" in str(error),
                    f"selected-field graph drift produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError("selected-field graph drift was not refused")
            finally:
                checker_scale.default_value = old_scale
            expect(
                procedural_obj.data == procedural_mesh
                and procedural_obj.material_slots[0].material == procedural_slot
                and uv_snapshot(procedural_mesh) == procedural_uv_state
                and {
                    "materials": set(bpy.data.materials.keys()),
                    "meshes": set(bpy.data.meshes.keys()),
                    "images": set(bpy.data.images.keys()),
                    "nodeGroups": set(bpy.data.node_groups.keys()),
                } == before_ids,
                "stale selected-field plan mutated Blender state before refusal",
            )
            procedural_plan = compiler.plan_materials(
                (procedural_obj,), purpose="preview",
            )
            expect(
                procedural_plan.source_fingerprint
                == stale_plan.source_fingerprint,
                "restoring the artist graph did not restore its exact plan identity",
            )

            def emit_procedural(output_path):
                selected_before = list(bpy.context.selected_objects)
                active_before = bpy.context.view_layer.objects.active
                try:
                    bpy.ops.object.select_all(action="DESELECT")
                    procedural_obj.select_set(True)
                    bpy.context.view_layer.objects.active = procedural_obj
                    return bpy.ops.export_scene.gltf(
                        filepath=output_path,
                        export_format="GLB",
                        export_extras=True,
                        export_image_format="AUTO",
                        export_texcoords=True,
                        use_selection=True,
                        use_active_scene=True,
                    )
                finally:
                    bpy.ops.object.select_all(action="DESELECT")
                    for item in selected_before:
                        if bpy.context.scene.objects.get(item.name) is item:
                            item.select_set(True)
                    bpy.context.view_layer.objects.active = active_before

            _value, procedural_compilation = compiler.with_compiled_materials(
                procedural_plan,
                str(procedural_out),
                emit_procedural,
            )
            expect(
                procedural_out.is_file()
                and len(procedural_compilation.gltf_evidence) == 1,
                "selected-field materialization emitted no attested GLB",
            )
            procedural_evidence = procedural_compilation.gltf_evidence[0]
            materialization_evidence = procedural_evidence[
                "materializationEvidence"
            ]
            expect(
                procedural_evidence["transport"] == "image"
                and procedural_evidence["materialization"] == "cyclesEmit"
                and procedural_evidence["imageMime"] == "image/png"
                and len(procedural_evidence["imageSha256"]) == 64
                and (
                    procedural_evidence["imageWidth"],
                    procedural_evidence["imageHeight"],
                ) == (256, 256)
                and procedural_evidence["sampler"] == {
                    "magFilter": 9729,
                    "minFilter": 9987,
                    "wrapS": 33071,
                    "wrapT": 33071,
                }
                and procedural_evidence["texCoord"] == 1
                and procedural_evidence["alphaMode"] == "OPAQUE"
                and not procedural_evidence["unlit"]
                and procedural_evidence["surfaceResponse"] == "lit"
                and procedural_evidence["metallicFactor"] == 0.0
                and procedural_evidence["roughnessFactor"] == 0.5
                and procedural_evidence["uvDistinctValues"] >= 3,
                "selected field did not become an ordinary attested lit PBR PNG: "
                f"{procedural_evidence}",
            )
            expect(
                materialization_evidence["resolutionPolicy"]
                == "fallback-no-camera"
                and materialization_evidence["measurementModel"]
                == "selected-field-density-v1"
                and materialization_evidence["sourceUnitSystem"] == "METRIC"
                and materialization_evidence[
                    "sourceMetersPerBlenderUnit"
                ] is not None
                and abs(
                    materialization_evidence[
                        "sourceMetersPerBlenderUnit"
                    ] - 0.01
                ) < 1.0e-8
                and materialization_evidence[
                    "sourceWorldAreaBlenderUnitsSquared"
                ] > 0.0
                and abs(
                    materialization_evidence["sourceWorldAreaSquareMeters"]
                    - materialization_evidence[
                        "sourceWorldAreaBlenderUnitsSquared"
                    ] * materialization_evidence[
                        "sourceMetersPerBlenderUnit"
                    ] ** 2
                ) < 1.0e-12
                and materialization_evidence["projectionMetric"]
                == "clipped-triangle-area-sum-capped-to-viewport"
                and materialization_evidence["cameraScope"]
                == "all-scene-perspective-orthographic-cameras"
                and materialization_evidence["cameraSelection"]
                == "maximum-projected-triangle-area-sum"
                and materialization_evidence["selectedCameraName"] is None
                and materialization_evidence[
                    "selectedCameraStableId"
                ] is None
                and materialization_evidence["eligibleCameraCount"] == 0
                and materialization_evidence["projectingCameraCount"] == 0
                and materialization_evidence["targetPxPerMeter"] is None
                and materialization_evidence[
                    "projectedTriangleAreaSumPixelAreaCapped"
                ] is None
                and materialization_evidence[
                    "projectedTriangleAreaSumFractionCapped"
                ] is None
                and materialization_evidence["densityRatio"] is None
                and materialization_evidence["densityMet"]
                and materialization_evidence["uvStrategy"]
                == "smart-project-fallback"
                and materialization_evidence["uvGenerationSpace"]
                == "world-linear-private-proxy"
                and materialization_evidence["sourceUvName"]
                == "BLENDLINK_WEB_ATLAS"
                and "out-of-bounds"
                in materialization_evidence["sourceLayoutIssues"]
                and materialization_evidence["sourceRescuePolygonCount"] == 0
                and materialization_evidence[
                    "sourceRescueAttemptedPolygonCount"
                ] == 0
                and materialization_evidence["repairCount"] == 0
                and materialization_evidence["uvRepairStrategies"] == []
                and materialization_evidence["ignoredZeroAreaTriangles"] == 0
                and materialization_evidence["zeroWorldAreaTriangleCount"] == 0
                and materialization_evidence["uvArea"] > 0.0
                and materialization_evidence["achievedProjectedPixels"] > 0.0
                and materialization_evidence["achievedPxPerMeter"]
                == materialization_evidence[
                    "achievedTexelsPerBlenderUnit"
                ]
                and abs(
                    materialization_evidence[
                        "achievedTexelsPerSourceMeter"
                    ]
                    - materialization_evidence[
                        "achievedTexelsPerBlenderUnit"
                    ] / materialization_evidence[
                        "sourceMetersPerBlenderUnit"
                    ]
                ) < 1.0e-8
                and materialization_evidence[
                    "achievedProjectedPixels"
                ] == materialization_evidence[
                    "allocatedBindingTexelArea"
                ]
                and abs(
                    materialization_evidence["achievedProjectedPixels"]
                    - materialization_evidence["uvArea"]
                    * materialization_evidence["resolution"] ** 2
                ) < 1.0e-6
                and 0.0 < materialization_evidence["coveredFraction"] < 1.0
                and materialization_evidence["rgbMax"][0]
                - materialization_evidence["rgbMin"][0] > 0.5
                and materialization_evidence["rgbMax"][2]
                - materialization_evidence["rgbMin"][2] > 0.5
                and materialization_evidence["deviceClass"] in {"cpu", "gpu"},
                "selected-field bake evidence did not prove its resolution, "
                f"coverage, color range, or compute path: {materialization_evidence}",
            )
            procedural_document, _procedural_binary = compiler._read_glb(
                str(procedural_out),
            )
            procedural_json = json.dumps(
                procedural_document,
                sort_keys=True,
                separators=(",", ":"),
            )
            expect(
                "BLENDLINK_PRIVATE_SELECTED" not in procedural_json
                and "Blendlink Web Color" not in procedural_json
                and "_BLENDLINK_WEB_" not in procedural_json
                and "blendlink_private_materialization" not in procedural_json
                and "blendlink_material_source_version" not in procedural_json
                and "blendlink_material_source_group_version" not in procedural_json
                and "BLENDLINK_WEB_ATLAS" not in procedural_json,
                "compiler-private bake graph or carrier names leaked into the GLB",
            )
            expect(
                procedural_obj.data == procedural_mesh
                and procedural_obj.material_slots[0].material == procedural_slot
                and procedural_obj.material_slots[0].link == procedural_link
                and uv_snapshot(procedural_mesh) == procedural_uv_state
                and compiler._material_fingerprint(procedural_material)
                == procedural_material_hash,
                "selected-field transaction changed the source Mesh, UVs, "
                "material graph, or binding",
            )
            expect(
                scene.render.engine == before_engine
                and scene.cycles.samples == before_cycles_samples
                and {
                    name: getattr(scene.render.bake, name)
                    for name in before_bake
                } == before_bake,
                "selected-field bake did not restore render/Cycles/bake settings",
            )
            expect(
                {
                    "materials": set(bpy.data.materials.keys()),
                    "meshes": set(bpy.data.meshes.keys()),
                    "images": set(bpy.data.images.keys()),
                    "nodeGroups": set(bpy.data.node_groups.keys()),
                } == before_ids,
                "selected-field transaction leaked private Blender data",
            )
            expect(
                tuple(sorted(
                    item.name for item in bpy.context.selected_objects
                )) == before_selected
                and (
                    bpy.context.view_layer.objects.active.name
                    if bpy.context.view_layer.objects.active is not None else None
                ) == before_active
                and bpy.context.mode == before_mode,
                "selected-field transaction did not restore selection, active "
                "object, or mode",
            )

            static_floor_plan = compiler.plan_materials(
                (static_floor_obj,), purpose="final",
            )
            expect(
                not static_floor_plan.errors
                and static_floor_plan.lowerings[0].surface_factorization
                is not None,
                "the exact response factorization did not survive save/reopen: "
                f"{static_floor_plan.as_dict()}",
            )
            static_floor_mesh = static_floor_obj.data
            static_floor_slot = static_floor_obj.material_slots[0].material
            static_floor_link = static_floor_obj.material_slots[0].link
            static_floor_uv_state = uv_snapshot(static_floor_mesh)
            static_floor_material_hash = compiler._material_fingerprint(
                static_floor_material,
            )
            static_floor_out = root / "static-shade-floor.glb"

            def emit_static_floor(output_path):
                selected_before = list(bpy.context.selected_objects)
                active_before = bpy.context.view_layer.objects.active
                try:
                    bpy.ops.object.select_all(action="DESELECT")
                    static_floor_obj.select_set(True)
                    bpy.context.view_layer.objects.active = static_floor_obj
                    return bpy.ops.export_scene.gltf(
                        filepath=output_path,
                        export_format="GLB",
                        export_extras=True,
                        export_image_format="AUTO",
                        export_texcoords=True,
                        use_selection=True,
                        use_active_scene=True,
                    )
                finally:
                    bpy.ops.object.select_all(action="DESELECT")
                    for item in selected_before:
                        if bpy.context.scene.objects.get(item.name) is item:
                            item.select_set(True)
                    bpy.context.view_layer.objects.active = active_before

            _value, static_floor_compilation = (
                compiler.with_compiled_materials(
                    static_floor_plan,
                    str(static_floor_out),
                    emit_static_floor,
                )
            )
            expect(
                static_floor_out.is_file()
                and len(static_floor_compilation.gltf_evidence) == 1,
                "static shade-floor factorization emitted no attested GLB",
            )
            static_floor_evidence = static_floor_compilation.gltf_evidence[0]
            expect(
                static_floor_evidence["surfaceFactorization"]["model"]
                == compiler.STATIC_SHADE_FLOOR_MODEL
                and static_floor_evidence["surfaceResponse"] == "lit"
                and not static_floor_evidence["unlit"]
                and static_floor_evidence["transport"] == "image"
                and static_floor_evidence["metallicFactor"] == 0.0
                and static_floor_evidence["roughnessFactor"] == 0.5
                and all(
                    abs(actual - expected) < 1e-6
                    for actual, expected in zip(
                        static_floor_evidence["baseColorFactor"],
                        (0.7, 0.7, 0.7, 1.0),
                    )
                )
                and all(
                    abs(actual - expected) < 1e-6
                    for actual, expected in zip(
                        static_floor_evidence["emissiveFactor"],
                        (0.356, 0.44, 0.594),
                    )
                )
                and static_floor_evidence["imageMime"] == "image/png"
                and static_floor_evidence["emissiveImageMime"] == "image/png"
                and static_floor_evidence["imageWidth"]
                == static_floor_evidence["emissiveImageWidth"]
                and static_floor_evidence["imageHeight"]
                == static_floor_evidence["emissiveImageHeight"]
                and static_floor_evidence["imageSha256"]
                == static_floor_evidence["emissiveImageSha256"]
                and static_floor_evidence["sampler"]
                == static_floor_evidence["emissiveSampler"]
                and static_floor_evidence["texCoord"]
                == static_floor_evidence["emissiveTexCoord"]
                and static_floor_evidence["uvHash"]
                == static_floor_evidence["emissiveUvHash"]
                and static_floor_evidence["uvGeometryAssociation"]["hash"]
                == static_floor_evidence[
                    "emissiveUvGeometryAssociation"
                ]["hash"]
                and isinstance(
                    static_floor_evidence["sharedTextureIndex"], int,
                ),
                "final GLB did not attest one shared stock Base Color/Emission "
                f"texture plus exact factors/sampler/UV ownership: {static_floor_evidence}",
            )
            static_floor_document, _static_floor_binary = compiler._read_glb(
                str(static_floor_out),
            )
            emitted_static_floor = next(
                material
                for material in static_floor_document.get("materials", [])
                if material.get("name")
                == static_floor_evidence["generatedMaterial"]
            )
            expect(
                isinstance(
                    emitted_static_floor.get(
                        "pbrMetallicRoughness", {}
                    ).get("baseColorTexture"),
                    dict,
                )
                and isinstance(
                    emitted_static_floor.get("emissiveTexture"),
                    dict,
                )
                and emitted_static_floor[
                    "pbrMetallicRoughness"
                ]["baseColorTexture"]["index"]
                == emitted_static_floor["emissiveTexture"]["index"]
                and not emitted_static_floor.get("extensions"),
                "factorized material did not remain an extension-free stock "
                "glTF carrier reusing one intrinsic texture for Base Color and "
                f"Emission: {emitted_static_floor}",
            )
            normalization = static_floor_evidence["textureNormalization"]
            expect(
                normalization["model"] == "stock-gltf-shared-texture-v1"
                and normalization["baseTextureIndex"]
                == static_floor_evidence["sharedTextureIndex"]
                and normalization["duplicateTextureRecordRetained"],
                "the stock-exporter duplicate Texture normalization was not "
                f"explicitly evidenced: {normalization}",
            )
            browser_output = os.environ.get(
                "BLENDLINK_STATIC_FLOOR_BROWSER_OUTPUT",
            )
            if browser_output:
                browser_path = Path(browser_output).resolve()
                browser_path.parent.mkdir(parents=True, exist_ok=True)
                browser_path.write_bytes(static_floor_out.read_bytes())

            already_shared = root / "static-floor-already-shared.glb"
            already_shared.write_bytes(static_floor_out.read_bytes())
            already_shared_facts = {
                static_floor_evidence["generatedMaterial"]: {
                    "source": static_floor_evidence["sourceMaterial"],
                    "rule": emitted_static_floor["extras"][
                        "blendlink_material_rule"
                    ],
                    "variant": emitted_static_floor["extras"][
                        "blendlink_material_variant"
                    ],
                    "surfaceFactorization": static_floor_evidence[
                        "surfaceFactorization"
                    ],
                },
            }
            compiler._rewrite_factorized_shared_textures(
                str(already_shared), already_shared_facts,
            )
            already_normalized = already_shared_facts[
                static_floor_evidence["generatedMaterial"]
            ]["textureNormalization"]
            expect(
                already_normalized["model"]
                == "stock-gltf-shared-texture-v1"
                and already_normalized["baseTextureIndex"]
                == already_normalized["exporterEmissiveTextureIndex"]
                and not already_normalized["duplicateTextureRecordRetained"],
                "an exporter that already shared one Texture was not "
                f"truthfully evidenced: {already_normalized}",
            )

            sampler_near_miss = root / "static-floor-sampler-near-miss.glb"
            sampler_near_miss.write_bytes(static_floor_out.read_bytes())
            near_document, near_chunks, near_json_index = (
                compiler.glblib.read_document(
                    str(sampler_near_miss),
                    "create factorized sampler near miss from",
                )
            )
            near_material = next(
                material
                for material in near_document.get("materials", [])
                if material.get("name")
                == static_floor_evidence["generatedMaterial"]
            )
            duplicate_index = normalization["exporterEmissiveTextureIndex"]
            near_material["emissiveTexture"]["index"] = duplicate_index
            near_document.setdefault("samplers", []).append({
                "magFilter": 9728,
                "minFilter": 9728,
                "wrapS": 10497,
                "wrapT": 10497,
            })
            near_document["textures"][duplicate_index]["sampler"] = (
                len(near_document["samplers"]) - 1
            )
            compiler.glblib.write_document(
                str(sampler_near_miss),
                near_document,
                near_chunks,
                near_json_index,
                "factorized-sampler-near-miss",
            )
            material_extras = emitted_static_floor["extras"]
            near_facts = {
                static_floor_evidence["generatedMaterial"]: {
                    "source": static_floor_evidence["sourceMaterial"],
                    "rule": material_extras["blendlink_material_rule"],
                    "variant": material_extras["blendlink_material_variant"],
                    "surfaceFactorization": static_floor_evidence[
                        "surfaceFactorization"
                    ],
                },
            }
            try:
                compiler._rewrite_factorized_shared_textures(
                    str(sampler_near_miss), near_facts,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "equivalent-sampler" in str(error),
                    f"sampler near miss produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError(
                    "differing factorized wrap/filter sampler was normalized"
                )

            extras_near_miss = root / "static-floor-extras-near-miss.glb"
            extras_near_miss.write_bytes(static_floor_out.read_bytes())
            extras_document, extras_chunks, extras_json_index = (
                compiler.glblib.read_document(
                    str(extras_near_miss),
                    "create factorized TextureInfo extras near miss from",
                )
            )
            extras_material = next(
                material
                for material in extras_document.get("materials", [])
                if material.get("name")
                == static_floor_evidence["generatedMaterial"]
            )
            extras_material["emissiveTexture"]["extras"] = {
                "applicationMeaning": "different",
            }
            compiler.glblib.write_document(
                str(extras_near_miss),
                extras_document,
                extras_chunks,
                extras_json_index,
                "factorized-extras-near-miss",
            )
            try:
                compiler._rewrite_factorized_shared_textures(
                    str(extras_near_miss), near_facts,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "coordinate contracts" in str(error),
                    f"TextureInfo extras near miss produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError(
                    "differing factorized TextureInfo extras were normalized"
                )
            expect(
                static_floor_obj.data == static_floor_mesh
                and static_floor_obj.material_slots[0].material
                == static_floor_slot
                and static_floor_obj.material_slots[0].link
                == static_floor_link
                and uv_snapshot(static_floor_mesh) == static_floor_uv_state
                and compiler._material_fingerprint(static_floor_material)
                == static_floor_material_hash
                and {
                    "materials": set(bpy.data.materials.keys()),
                    "meshes": set(bpy.data.meshes.keys()),
                    "images": set(bpy.data.images.keys()),
                    "nodeGroups": set(bpy.data.node_groups.keys()),
                } == before_ids,
                "factorized response transaction changed or leaked source "
                "material, Mesh, UV, binding, image, or node-group state",
            )

            failed_procedural_out = root / "failed-selected-field.glb"

            def fail_after_selected_field_bake(_output_path):
                raise RuntimeError("forced selected-field export failure")

            try:
                compiler.with_compiled_materials(
                    procedural_plan,
                    str(failed_procedural_out),
                    fail_after_selected_field_bake,
                )
            except RuntimeError as error:
                expect(
                    str(error) == "forced selected-field export failure",
                    f"wrong selected-field failure propagated: {error}",
                )
            else:
                raise AssertionError("selected-field export failure was swallowed")
            expect(
                not failed_procedural_out.exists()
                and procedural_obj.data == procedural_mesh
                and procedural_obj.material_slots[0].material == procedural_slot
                and procedural_obj.material_slots[0].link == procedural_link
                and uv_snapshot(procedural_mesh) == procedural_uv_state
                and compiler._material_fingerprint(procedural_material)
                == procedural_material_hash
                and scene.render.engine == before_engine
                and scene.cycles.samples == before_cycles_samples
                and {
                    name: getattr(scene.render.bake, name)
                    for name in before_bake
                } == before_bake
                and {
                    "materials": set(bpy.data.materials.keys()),
                    "meshes": set(bpy.data.meshes.keys()),
                    "images": set(bpy.data.images.keys()),
                    "nodeGroups": set(bpy.data.node_groups.keys()),
                } == before_ids
                and tuple(sorted(
                    item.name for item in bpy.context.selected_objects
                )) == before_selected
                and (
                    bpy.context.view_layer.objects.active.name
                    if bpy.context.view_layer.objects.active is not None else None
                ) == before_active
                and bpy.context.mode == before_mode,
                "failed selected-field transaction leaked source, render, "
                "selection, or compiler-owned state",
            )
            (
                scene.unit_settings.system,
                scene.unit_settings.scale_length,
            ) = materialization_unit_state

            range_obj = bpy.data.objects["Out of Range Selected Field"]
            range_material = bpy.data.materials[
                "Out of Range Selected Field Material"
            ]
            range_mesh = range_obj.data
            range_material_hash = compiler._material_fingerprint(range_material)
            range_plan = compiler.plan_materials(
                (range_obj,), purpose="preview",
            )
            range_out = root / "out-of-range-selected-field.glb"

            def emit_out_of_range(_output_path):
                raise AssertionError(
                    "out-of-range selected field reached GLB export"
                )

            try:
                compiler.with_compiled_materials(
                    range_plan,
                    str(range_out),
                    emit_out_of_range,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "outside 0..1" in str(error)
                    or "range" in str(error) and "0..1" in str(error),
                    f"out-of-range bake produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError(
                    "out-of-range selected field was clipped and published"
                )
            expect(
                not range_out.exists()
                and range_obj.data == range_mesh
                and range_obj.material_slots[0].material == range_material
                and compiler._material_fingerprint(range_material)
                == range_material_hash
                and scene.render.engine == before_engine
                and scene.cycles.samples == before_cycles_samples
                and {
                    name: getattr(scene.render.bake, name)
                    for name in before_bake
                } == before_bake
                and {
                    "materials": set(bpy.data.materials.keys()),
                    "meshes": set(bpy.data.meshes.keys()),
                    "images": set(bpy.data.images.keys()),
                    "nodeGroups": set(bpy.data.node_groups.keys()),
                } == before_ids,
                "out-of-range selected-field refusal leaked Blender or artifact state",
            )

            before_materials = set(bpy.data.materials.keys())
            before_vertex_slot = vertex_obj.material_slots[0].material
            before_instance_slot = vertex_instance.material_slots[0].material
            before_constant_slot = constant_obj.material_slots[0].material
            before_image_slot = image_obj.material_slots[0].material
            before_named_image_slot = named_image_obj.material_slots[0].material
            before_unlit_slot = unlit_obj.material_slots[0].material
            before_opaque_alpha_slot = opaque_alpha_obj.material_slots[0].material
            before_varying_alpha_slot = varying_alpha_obj.material_slots[0].material
            before_masked_alpha_slot = masked_alpha_obj.material_slots[0].material
            before_vertex_link = vertex_obj.material_slots[0].link
            before_instance_link = vertex_instance.material_slots[0].link
            before_shared_mesh = vertex_obj.data
            before_shape_keys = vertex_obj.data.shape_keys
            before_shape_action = before_shape_keys.animation_data.action
            out = root / "compiled.glb"

            def emit(output_path):
                expect(
                    vertex_obj.data == vertex_instance.data,
                    "identical substitutions broke a shared Mesh before export",
                )
                expect(
                    vertex_obj.data.shape_keys is not None
                    and vertex_obj.data.shape_keys.animation_data.action == before_shape_action,
                    "private compiler Mesh lost shape keys or their action",
                )
                return bpy.ops.export_scene.gltf(
                    filepath=output_path,
                    export_format="GLB",
                    export_extras=True,
                    export_vertex_color="MATERIAL",
                    export_attributes=True,
                    export_all_vertex_colors=False,
                    use_active_scene=True,
                )

            _value, compilation = compiler.with_compiled_materials(plan, str(out), emit)
            expect(out.is_file() and out.stat().st_size > 0, "compiler emitted no GLB")
            document, _binary = compiler._read_glb(str(out))
            mesh_by_node = {
                node.get("name"): node.get("mesh")
                for node in document.get("nodes", [])
                if node.get("mesh") is not None
            }
            expect(
                mesh_by_node["Vertex Painted"] == mesh_by_node["Vertex Painted Instance"],
                f"shared source Mesh serialized twice: {mesh_by_node}",
            )
            expect(
                len(compilation.gltf_evidence) == 8,
                f"generated GLB evidence missing: {compilation.as_dict()}",
            )
            expect(
                compilation.as_dict().get("attestationModel")
                == compiler.ATTESTATION_MODEL,
                "material compiler did not mark the primitive-corner "
                f"attestation model: {compilation.as_dict()}",
            )
            vertex_evidence = next(
                item for item in compilation.gltf_evidence
                if item["sourceMaterial"] == "Selected Vertex"
            )
            expect(
                not vertex_evidence["unlit"]
                and vertex_evidence["surfaceResponse"] == "lit"
                and vertex_evidence["metallicFactor"] == 0.0
                and vertex_evidence["roughnessFactor"] == 0.5
                and vertex_evidence["color0"]
                and vertex_evidence["alphaMode"] == "BLEND",
                f"vertex RGBA did not export as stock lit COLOR_0: {vertex_evidence}",
            )
            unlit_evidence = next(
                item for item in compilation.gltf_evidence
                if item["sourceMaterial"] == "Unlit Selected Field Material"
            )
            expect(
                unlit_evidence["unlit"]
                and unlit_evidence["surfaceResponse"] == "unlit"
                and "metallicFactor" not in unlit_evidence
                and unlit_evidence["alphaMode"] == "OPAQUE",
                "an authored Emission surface did not retain its ordinary "
                f"KHR_materials_unlit carrier: {unlit_evidence}",
            )
            shared_alpha_evidence = sorted(
                (
                    item for item in compilation.gltf_evidence
                    if item["sourceMaterial"] == "Selected Shared Alpha"
                ),
                key=lambda item: item["bindings"],
            )
            expect(
                len(shared_alpha_evidence) == 3
                and shared_alpha_evidence[0]["bindings"]
                == ["Masked Shared Alpha[0]"]
                and shared_alpha_evidence[0]["alphaMode"] == "MASK"
                and shared_alpha_evidence[1]["bindings"]
                == ["Opaque Shared Alpha[0]"]
                and shared_alpha_evidence[1]["alphaMode"] == "OPAQUE"
                and shared_alpha_evidence[2]["bindings"]
                == ["Varying Shared Alpha[0]"]
                and shared_alpha_evidence[2]["alphaMode"] == "BLEND",
                "shared selected alpha did not split into independently "
                f"attested opaque and blend material variants: {shared_alpha_evidence}",
            )
            image_evidence = next(
                item for item in compilation.gltf_evidence
                if item["sourceMaterial"] == "Selected Image"
            )
            expect(
                image_evidence["transport"] == "image"
                and image_evidence["imageSha256"] == hashlib.sha256(image_payload).hexdigest()
                and image_evidence["imageMime"] == "image/png"
                and (image_evidence["imageWidth"], image_evidence["imageHeight"]) == (2, 2)
                and image_evidence["texCoord"] == 0
                and image_evidence["uvDistinctValues"] == 3
                and image_evidence["bindingPrimitives"]
                == [{
                    "binding": "Image Painted[0]",
                    "occurrences": [{"mesh": mesh_by_node["Image Painted"], "primitives": [0]}],
                }]
                and image_evidence["uvGeometryAssociation"]["algorithm"]
                == "mesh-position14-uv-triangles-v1"
                and len(image_evidence["uvGeometryAssociation"]["hash"]) == 64
                and image_evidence["uvGeometryAssociation"]["triangleCount"] == 1
                and image_evidence["uvGeometryAssociation"]["positionGrids"]
                == [{
                    "mesh": mesh_by_node["Image Painted"],
                    "bits": 14,
                    "offset": [0.0, 0.0, 0.0],
                    "scale": 1.0,
                }],
                f"image bytes, sampler, texCoord, or UVs were not attested: {image_evidence}",
            )
            named_image_evidence = next(
                item for item in compilation.gltf_evidence
                if item["sourceMaterial"] == "Selected Named Image"
            )
            expect(
                named_image_evidence["transport"] == "image"
                and named_image_evidence["imageSha256"] == hashlib.sha256(image_payload).hexdigest()
                and named_image_evidence["texCoord"] == 1
                and named_image_evidence["uvDistinctValues"] == 3
                and named_image_evidence["uvGeometryAssociation"]["triangleCount"] == 1,
                f"named UV image route was not attested on TEXCOORD_1: {named_image_evidence}",
            )
            expect(
                vertex_obj.material_slots[0].material == before_vertex_slot
                and vertex_instance.material_slots[0].material == before_instance_slot
                and constant_obj.material_slots[0].material == before_constant_slot
                and image_obj.material_slots[0].material == before_image_slot
                and named_image_obj.material_slots[0].material == before_named_image_slot
                and unlit_obj.material_slots[0].material == before_unlit_slot
                and opaque_alpha_obj.material_slots[0].material
                == before_opaque_alpha_slot
                and varying_alpha_obj.material_slots[0].material
                == before_varying_alpha_slot
                and masked_alpha_obj.material_slots[0].material
                == before_masked_alpha_slot,
                "source material bindings were not restored",
            )
            expect(
                vertex_obj.material_slots[0].link == before_vertex_link
                and vertex_instance.material_slots[0].link == before_instance_link
                and vertex_obj.data.materials[0] == before_vertex_slot,
                "shared Mesh material data or slot-link ownership changed",
            )
            expect(
                vertex_obj.data == before_shared_mesh
                and vertex_instance.data == before_shared_mesh
                and vertex_obj.data.shape_keys == before_shape_keys
                and vertex_obj.data.shape_keys.animation_data.action == before_shape_action,
                "shared Mesh, shape keys, or shape-key action were not restored",
            )
            expect(
                set(bpy.data.materials.keys()) == before_materials,
                "private generated materials leaked after export",
            )

            for object_name, expected_sources in (
                (
                    "Two Slots Same Layer",
                    {"Same Layer Red", "Same Layer Green"},
                ),
                (
                    "Two Slots Distinct Layers",
                    {"Distinct Layer Paint", "Distinct Layer Detail"},
                ),
            ):
                multi_obj = bpy.data.objects[object_name]
                multi_plan = compiler.plan_materials((multi_obj,), purpose="final")
                expect(
                    not multi_plan.errors and len(multi_plan.lowerings) == 2,
                    f"multi-slot vertex-color plan failed: {multi_plan.as_dict()}",
                )
                multi_out = root / f"{object_name.replace(' ', '-').lower()}.glb"

                def emit_multi_slot(output_path):
                    return bpy.ops.export_scene.gltf(
                        filepath=output_path,
                        export_format="GLB",
                        export_extras=True,
                        export_vertex_color="MATERIAL",
                        export_attributes=True,
                        export_all_vertex_colors=False,
                        use_active_scene=True,
                    )

                preserve_artist_data = object_name == "Two Slots Distinct Layers"
                _value, multi_compilation = compiler.with_compiled_materials(
                    multi_plan,
                    str(multi_out),
                    emit_multi_slot,
                    preserve_custom_attributes=preserve_artist_data,
                )
                expect(
                    {
                        item["sourceMaterial"]
                        for item in multi_compilation.gltf_evidence
                    } == expected_sources,
                    f"multi-slot generated material evidence drifted: {multi_compilation.as_dict()}",
                )
                primitive_refs = [
                    (
                        item["bindings"],
                        item["bindingPrimitives"],
                    )
                    for item in multi_compilation.gltf_evidence
                ]
                expect(
                    all(
                        len(bindings) == 1
                        and len(refs) == 1
                        and refs[0]["binding"] == bindings[0]
                        and len(refs[0]["occurrences"]) == 1
                        and len(refs[0]["occurrences"][0]["primitives"]) == 1
                        for bindings, refs in primitive_refs
                    )
                    and len({
                        refs[0]["occurrences"][0]["primitives"][0]
                        for _bindings, refs in primitive_refs
                    }) == 2,
                    "multi-slot evidence did not preserve distinct emitted "
                    f"primitive ownership: {primitive_refs}",
                )
                multi_document, _binary = compiler._read_glb(str(multi_out))
                leaked_semantics = {
                    semantic
                    for mesh in multi_document.get("meshes", [])
                    for primitive in mesh.get("primitives", [])
                    for semantic in (primitive.get("attributes") or {})
                    if semantic.startswith(compiler.PRIVATE_COLOR_PREFIX)
                }
                expect(
                    not leaked_semantics,
                    f"private material carrier leaked into public glTF: {leaked_semantics}",
                )
                authored_semantics = {
                    semantic
                    for mesh in multi_document.get("meshes", [])
                    for primitive in mesh.get("primitives", [])
                    for semantic in (primitive.get("attributes") or {})
                    if semantic.startswith("_")
                }
                expect(
                    bool(authored_semantics) == preserve_artist_data,
                    "compiler-forced custom-attribute export changed the application's authored attribute policy",
                )
                expect(
                    multi_obj.data.name == f"{object_name} Mesh",
                    "multi-slot compiler did not restore the source Mesh",
                )

            collection_plan = compiler.plan_materials(
                (instance_source,), purpose="preview",
            )
            collection_out = root / "collection-instances.glb"

            def emit_collection_instances(output_path):
                return bpy.ops.export_scene.gltf(
                    filepath=output_path,
                    export_format="GLB",
                    export_extras=True,
                    export_attributes=True,
                    export_all_vertex_colors=False,
                    use_active_scene=True,
                )

            _value, collection_compilation = compiler.with_compiled_materials(
                collection_plan, str(collection_out), emit_collection_instances,
            )
            collection_document, _binary = compiler._read_glb(str(collection_out))
            occurrence_nodes = [
                node for node in collection_document.get("nodes", [])
                if node.get("name") == "Instanced Compiler Source"
                and node.get("mesh") is not None
            ]
            expect(
                len(occurrence_nodes) >= 2
                and len(collection_compilation.gltf_evidence) == 1,
                "Collection Instance occurrences were not all attested",
            )
            expect(
                len(
                    collection_compilation.gltf_evidence[0][
                        "bindingPrimitives"
                    ][0]["occurrences"]
                ) == len(occurrence_nodes),
                "Collection Instance primitive evidence lost an emitted "
                "binding occurrence",
            )
            expect(
                instance_source.material_slots[0].material == instance_material
                and set(bpy.data.materials.keys()) == before_materials,
                "Collection Instance compilation leaked source state",
            )

            # Ownership starts at ID allocation, not after successful setup.
            # A setup failure must still remove the half-built generated ID.
            original_copy_setting = compiler._copy_material_setting
            compiler._copy_material_setting = lambda *_args: (_ for _ in ()).throw(
                compiler.MaterialCompileError("forced generated setup failure")
            )
            try:
                try:
                    compiler.with_compiled_materials(
                        plan, str(root / "setup-failure.glb"), lambda _path: None,
                    )
                except compiler.MaterialCompileError as error:
                    expect(
                        "forced generated setup failure" in str(error),
                        f"wrong generated setup failure propagated: {error}",
                    )
                else:
                    raise AssertionError("generated material setup failure was swallowed")
            finally:
                compiler._copy_material_setting = original_copy_setting
            expect(
                vertex_obj.data == before_shared_mesh
                and vertex_instance.data == before_shared_mesh
                and set(bpy.data.materials.keys()) == before_materials,
                "failed generated setup leaked a Mesh or Material ID",
            )

            # Missing generated output is never recorded as a successful
            # omission. Hide the only planned binding during the continuation
            # and require finished-GLB attestation to reject it.
            omitted_plan = compiler.plan_materials((vertex_obj,), purpose="preview")
            omitted_out = root / "omitted.glb"

            def emit_without_binding(output_path):
                selected_before = {
                    obj.name: obj.select_get() for obj in bpy.context.scene.objects
                }
                active_before = bpy.context.view_layer.objects.active
                try:
                    for scene_obj in bpy.context.scene.objects:
                        scene_obj.select_set(False)
                    constant_obj.select_set(True)
                    bpy.context.view_layer.objects.active = constant_obj
                    return bpy.ops.export_scene.gltf(
                        filepath=output_path,
                        export_format="GLB",
                        export_extras=True,
                        export_vertex_color="MATERIAL",
                        export_attributes=True,
                        export_all_vertex_colors=False,
                        use_selection=True,
                        use_active_scene=True,
                    )
                finally:
                    for scene_obj in bpy.context.scene.objects:
                        scene_obj.select_set(selected_before.get(scene_obj.name, False))
                    bpy.context.view_layer.objects.active = active_before

            try:
                compiler.with_compiled_materials(
                    omitted_plan, str(omitted_out), emit_without_binding,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "is absent" in str(error),
                    f"missing generated material produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError("missing generated material was attested as successful")
            expect(
                not omitted_out.exists()
                and
                vertex_obj.data == before_shared_mesh
                and vertex_obj.material_slots[0].material == before_vertex_slot
                and set(bpy.data.materials.keys()) == before_materials,
                "failed GLB attestation published an artifact or leaked compiler state",
            )

            atomic_out = root / "atomic-material-output.glb"
            previous_artifact = b"previous-attested-artifact"
            atomic_out.write_bytes(previous_artifact)
            atomic_plan = compiler.plan_materials(
                (constant_obj,), purpose="preview",
            )

            def emit_invalid_glb(output_path):
                Path(output_path).write_bytes(b"not-a-glb")
                return {"FINISHED"}

            try:
                compiler.with_compiled_materials(
                    atomic_plan, str(atomic_out), emit_invalid_glb,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "GLB" in str(error) or "glTF" in str(error),
                    f"invalid staged GLB produced the wrong refusal: {error}",
                )
            else:
                raise AssertionError("invalid staged GLB passed attestation")
            expect(
                atomic_out.read_bytes() == previous_artifact
                and not tuple(root.glob(
                    f".{atomic_out.name}.blendlink-material-*.glb"
                ))
                and constant_obj.material_slots[0].material
                == before_constant_slot
                and set(bpy.data.materials.keys()) == before_materials,
                "failed post-write attestation replaced the prior artifact or "
                "leaked staging/compiler state",
            )

            failing_plan = compiler.plan_materials((vertex_obj,), purpose="preview")
            try:
                compiler.with_compiled_materials(
                    failing_plan, str(root / "never.glb"),
                    lambda _path: (_ for _ in ()).throw(
                        RuntimeError("forced export failure")
                    ),
                )
            except RuntimeError as error:
                expect(str(error) == "forced export failure", "wrong forced failure propagated")
            else:
                raise AssertionError("forced export failure was swallowed")
            expect(
                vertex_obj.material_slots[0].material == before_vertex_slot
                and vertex_instance.material_slots[0].material == before_instance_slot
                and set(bpy.data.materials.keys()) == before_materials,
                "failed export leaked a generated binding or material",
            )

            cleanup_obj = triangle_object("Cleanup Must Fail Loudly")
            cleanup_material = selected_constant_material(
                compiler, "Cleanup Failure Material",
            )
            cleanup_obj.data.materials.append(cleanup_material)
            cleanup_plan = compiler.plan_materials((cleanup_obj,), purpose="preview")

            def remove_during_emit(_output_path):
                bpy.data.objects.remove(
                    bpy.data.objects["Cleanup Must Fail Loudly"], do_unlink=True,
                )
                raise RuntimeError("forced primary failure")

            try:
                compiler.with_compiled_materials(
                    cleanup_plan, str(root / "cleanup-failure.glb"), remove_during_emit,
                )
            except compiler.MaterialCompileError as error:
                expect(
                    "could not restore Blender state" in str(error)
                    and isinstance(error.__cause__, RuntimeError),
                    f"cleanup failure was not loud or did not retain its cause: {error}",
                )
            else:
                raise AssertionError("cleanup failure was swallowed")

        # A channels carrier that plans no emissive image must ship a black
        # emissive factor. glTF multiplies factor by texture, so dropping a
        # black emissive map while leaving the factor at the identity makes
        # the material emit FULL WHITE -- the exact failure the constant
        # channel elision would introduce. Until this gate existed the whole
        # emissive attestation sat under "if an emissive image was planned",
        # so nothing could see it. Called directly: the branch needs no bake,
        # and routing a real one through here would prove less, not more.
        no_emissive_fact = {"source": "Emissive Gate", "materialBake": {"images": {}}}
        try:
            compiler._attest_material_bake_channels(
                {}, b"", {}, {"emissiveFactor": [1.0, 1.0, 1.0]}, no_emissive_fact,
            )
        except compiler.MaterialCompileError as error:
            expect(
                "no emissive texture was planned" in str(error)
                and "is not black" in str(error),
                f"unplanned emissive factor refused for the wrong reason: {error}",
            )
        else:
            raise AssertionError(
                "a carrier with no planned emissive image shipped a white "
                "emissive factor without refusing"
            )
        black_evidence = compiler._attest_material_bake_channels(
            {}, b"", {}, {"emissiveFactor": [0.0, 0.0, 0.0]}, no_emissive_fact,
        )
        expect(
            black_evidence["materialBake"]["textures"] == {},
            "a carrier with no planned emissive image and a black factor was "
            "refused or invented texture evidence, and producing exactly this "
            f"is what the elision must be allowed to do: {black_evidence!r}",
        )
        try:
            compiler._attest_material_bake_channels(
                {}, b"", {},
                {
                    "emissiveFactor": [0.0, 0.0, 0.0],
                    "extensions": {"KHR_materials_emissive_strength": {
                        "emissiveStrength": 2.0,
                    }},
                },
                no_emissive_fact,
            )
        except compiler.MaterialCompileError as error:
            expect(
                "KHR_materials_emissive_strength shipped" in str(error),
                f"unplanned emissive strength refused for the wrong reason: {error}",
            )
        else:
            raise AssertionError(
                "an emissive strength shipped with no planned emissive image"
            )
    finally:
        addon.unregister()
    print("BLENDLINK_MATERIAL_COMPILER_CHECK_PASSED")


if __name__ == "__main__":
    main()
