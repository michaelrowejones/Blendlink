# SPDX-License-Identifier: GPL-3.0-or-later
"""MTLX-TSL-001 reference side: Cycles evaluates each cell's node graph.

Every cell builds a private Emission material and bakes one 0..1 UV tile
through the shipped isolated-channel machinery (`bakelib.uv_tile_proxy` +
`bake_channel_field_pixels`) — exact channel isolation, one deterministic
sample per texel, no lighting, no view transform. The float result is the
ground truth the TSL side must reproduce numerically.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        --python experiments/tsl-node-differential/reference.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(REPO / "packages" / "blender-addon"))

import bakelib  # noqa: E402
import tsl_ir  # noqa: E402

OUTPUT = HERE / "output" / "reference"
CELLS = json.loads((HERE / "cells.json").read_text(encoding="utf8"))
SIZE = int(CELLS["size"])


def emission_material(name, build):
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    build(tree, emission)
    return material


def build_constant_linear(tree, emission):
    emission.inputs["Color"].default_value = (0.25, 0.5, 0.75, 1.0)


def build_uv_gradient(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_math_compare(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    greater = tree.nodes.new("ShaderNodeMath")
    greater.operation = "GREATER_THAN"
    greater.inputs[1].default_value = 0.5
    tree.links.new(separate.outputs["X"], greater.inputs[0])
    less = tree.nodes.new("ShaderNodeMath")
    less.operation = "LESS_THAN"
    less.inputs[1].default_value = 0.5
    tree.links.new(separate.outputs["Y"], less.inputs[0])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(greater.outputs["Value"], combine.inputs["Red"])
    tree.links.new(less.outputs["Value"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_mapping_rotate(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.vector_type = "POINT"
    mapping.inputs["Scale"].default_value = (2.0, 1.0, 1.0)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(30.0))
    tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    # Bias 0.25*p + 0.5 keeps rotated coordinates inside the bakeable range.
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.25
    tree.links.new(mapping.outputs["Vector"], scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(offset.outputs["Vector"], separate.inputs["Vector"])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_colorramp_linear(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = 0.2
    ramp.color_ramp.elements[0].color = (0.1, 0.2, 0.8, 1.0)
    ramp.color_ramp.elements[1].position = 0.8
    ramp.color_ramp.elements[1].color = (0.9, 0.5, 0.1, 1.0)
    tree.links.new(separate.outputs["X"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def _uv_channel(tree, axis):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    return separate.outputs["X" if axis == "u" else "Y"]


def _math(tree, operation, a, b=None):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    if hasattr(a, "name"):
        tree.links.new(a, node.inputs[0])
    else:
        node.inputs[0].default_value = float(a)
    if b is not None:
        if hasattr(b, "name"):
            tree.links.new(b, node.inputs[1])
        else:
            node.inputs[1].default_value = float(b)
    return node.outputs["Value"]


def _affine(tree, socket, scale, offset):
    node = tree.nodes.new("ShaderNodeMath")
    node.operation = "MULTIPLY_ADD"
    tree.links.new(socket, node.inputs[0])
    node.inputs[1].default_value = float(scale)
    node.inputs[2].default_value = float(offset)
    return node.outputs["Value"]


def _emit_scalar(tree, emission, socket):
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(socket, combine.inputs["Red"])
    tree.links.new(socket, combine.inputs["Green"])
    tree.links.new(socket, combine.inputs["Blue"])
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_math_safe_divide(tree, emission):
    a = _affine(tree, _uv_channel(tree, "u"), 4.0, -2.0)
    bands = _math(
        tree, "SUBTRACT",
        _math(tree, "FLOOR", _affine(tree, _uv_channel(tree, "v"), 3.0, 0.0)),
        1.0,
    )
    divided = _math(tree, "DIVIDE", a, bands)
    biased = _affine(tree, divided, 0.25, 0.5)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", biased, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_modulo_sign(tree, emission):
    a = _affine(tree, _uv_channel(tree, "u"), 8.0, -4.0)
    result = _math(tree, "MODULO", a, 1.5)
    biased = _affine(tree, result, 0.25, 0.5)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", biased, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_power_negative_base(tree, emission):
    base = _affine(tree, _uv_channel(tree, "u"), 4.0, -2.0)
    result = _math(tree, "POWER", base, 2.0)
    scaled = _affine(tree, result, 0.2, 0.0)
    clamped = _math(tree, "MINIMUM", _math(tree, "MAXIMUM", scaled, 0.0), 1.0)
    _emit_scalar(tree, emission, clamped)


def build_math_trig(tree, emission):
    sine = _affine(
        tree,
        _math(tree, "SINE", _affine(tree, _uv_channel(tree, "u"), 8.0, 0.0)),
        0.5, 0.5,
    )
    cosine = _affine(
        tree,
        _math(tree, "COSINE", _affine(tree, _uv_channel(tree, "v"), 8.0, 0.0)),
        0.5, 0.5,
    )
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(sine, combine.inputs["Red"])
    tree.links.new(cosine, combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_colorramp_constant(tree, emission):
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.1, 0.1, 0.7, 1.0)
    ramp.color_ramp.elements[1].position = 0.3
    ramp.color_ramp.elements[1].color = (0.2, 0.7, 0.2, 1.0)
    element = ramp.color_ramp.elements.new(0.6)
    element.color = (0.8, 0.3, 0.1, 1.0)
    tree.links.new(_uv_channel(tree, "u"), ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def build_mapping_texture_mode(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.vector_type = "TEXTURE"
    mapping.inputs["Scale"].default_value = (2.0, 1.0, 1.0)
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, math.radians(30.0))
    tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.25
    tree.links.new(mapping.outputs["Vector"], scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(offset.outputs["Vector"], separate.inputs["Vector"])
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(separate.outputs["X"], combine.inputs["Red"])
    tree.links.new(separate.outputs["Y"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_noise_fractal_detail(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 2.0
    if "Roughness" in noise.inputs:
        noise.inputs["Roughness"].default_value = 0.5
    tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])


def build_voronoi_f1_divergence(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    voronoi = tree.nodes.new("ShaderNodeTexVoronoi")
    voronoi.inputs["Scale"].default_value = 4.0
    if hasattr(voronoi, "feature"):
        voronoi.feature = "F1"
    if hasattr(voronoi, "distance"):
        voronoi.distance = "EUCLIDEAN"
    tree.links.new(coord.outputs["UV"], voronoi.inputs["Vector"])
    tree.links.new(voronoi.outputs["Distance"], emission.inputs["Color"])


def build_noise_mx_divergence(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 0.0
    tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])


def build_mix_modes(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate_uv = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate_uv.inputs["Vector"])

    def mix_node(blend_type, factor_socket):
        node = tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        node.blend_type = blend_type
        factor = next(
            item for item in node.inputs
            if item.identifier == "Factor_Float"
        )
        a_input = next(
            item for item in node.inputs if item.identifier == "A_Color"
        )
        b_input = next(
            item for item in node.inputs if item.identifier == "B_Color"
        )
        a_input.default_value = (0.2, 0.8, 0.4, 1.0)
        b_input.default_value = (0.9, 0.1, 0.6, 1.0)
        tree.links.new(factor_socket, factor)
        return next(
            item for item in node.outputs
            if item.identifier == "Result_Color"
        )

    def channel_of(color_socket, channel):
        separate = tree.nodes.new("ShaderNodeSeparateColor")
        separate.mode = "RGB"
        tree.links.new(color_socket, separate.inputs["Color"])
        return separate.outputs[channel]

    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(
        channel_of(mix_node("MIX", separate_uv.outputs["X"]), "Red"),
        combine.inputs["Red"],
    )
    tree.links.new(
        channel_of(mix_node("MULTIPLY", separate_uv.outputs["Y"]), "Green"),
        combine.inputs["Green"],
    )
    tree.links.new(
        channel_of(mix_node("ADD", separate_uv.outputs["X"]), "Blue"),
        combine.inputs["Blue"],
    )
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_group_passthrough(tree, emission):
    group_tree = bpy.data.node_groups.new(
        "TSL Cell Group", "ShaderNodeTree",
    )
    group_tree.interface.new_socket(
        "Vector", in_out="INPUT", socket_type="NodeSocketVector",
    )
    group_tree.interface.new_socket(
        "Value", in_out="OUTPUT", socket_type="NodeSocketFloat",
    )
    group_input = group_tree.nodes.new("NodeGroupInput")
    group_output = group_tree.nodes.new("NodeGroupOutput")
    noise = group_tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 0.0
    group_tree.links.new(
        group_input.outputs["Vector"], noise.inputs["Vector"],
    )
    group_tree.links.new(noise.outputs[0], group_output.inputs["Value"])
    instance = tree.nodes.new("ShaderNodeGroup")
    instance.node_tree = group_tree
    coord = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coord.outputs["UV"], instance.inputs["Vector"])
    tree.links.new(instance.outputs["Value"], emission.inputs["Color"])


def build_map_range_linear(tree, emission):
    node = tree.nodes.new("ShaderNodeMapRange")
    node.clamp = True
    node.inputs["From Min"].default_value = 0.2
    node.inputs["From Max"].default_value = 0.8
    node.inputs["To Min"].default_value = 0.1
    node.inputs["To Max"].default_value = 0.9
    tree.links.new(_uv_channel(tree, "u"), node.inputs["Value"])
    _emit_scalar(tree, emission, node.outputs["Result"])


def build_mix_overlay(tree, emission):
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "OVERLAY"
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = (0.2, 0.8, 0.4, 1.0)
    b_input.default_value = (0.9, 0.1, 0.6, 1.0)
    tree.links.new(_uv_channel(tree, "v"), factor)
    result = next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def build_math_pingpong(tree, emission):
    scaled = _affine(tree, _uv_channel(tree, "u"), 4.0, 0.0)
    result = _math(tree, "PINGPONG", scaled, 0.75)
    _emit_scalar(tree, emission, result)


def build_clamp_node(tree, emission):
    node = tree.nodes.new("ShaderNodeClamp")
    node.clamp_type = "MINMAX"
    node.inputs["Min"].default_value = 0.1
    node.inputs["Max"].default_value = 0.9
    value = _affine(tree, _uv_channel(tree, "u"), 2.0, -0.5)
    tree.links.new(value, node.inputs["Value"])
    _emit_scalar(tree, emission, node.outputs["Result"])


def build_mix_divide(tree, emission):
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "DIVIDE"
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = (0.3, 0.6, 0.8, 1.0)
    # G divides by zero: the cell decides Blender's fallback semantics.
    b_input.default_value = (0.5, 0.0, 2.0, 1.0)
    tree.links.new(_uv_channel(tree, "u"), factor)
    result = next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def build_map_range_smoothstep(tree, emission):
    node = tree.nodes.new("ShaderNodeMapRange")
    node.interpolation_type = "SMOOTHSTEP"
    node.clamp = True
    node.inputs["From Min"].default_value = 0.2
    node.inputs["From Max"].default_value = 0.8
    node.inputs["To Min"].default_value = 0.1
    node.inputs["To Max"].default_value = 0.9
    tree.links.new(_uv_channel(tree, "u"), node.inputs["Value"])
    _emit_scalar(tree, emission, node.outputs["Result"])


def _spline_ramp(tree, emission, interpolation):
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = interpolation
    ramp.color_ramp.elements[0].position = 0.1
    ramp.color_ramp.elements[0].color = (0.05, 0.1, 0.8, 1.0)
    ramp.color_ramp.elements[1].position = 0.45
    ramp.color_ramp.elements[1].color = (0.2, 0.85, 0.3, 1.0)
    element = ramp.color_ramp.elements.new(0.9)
    element.color = (0.9, 0.4, 0.05, 1.0)
    tree.links.new(_uv_channel(tree, "u"), ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def build_colorramp_bspline(tree, emission):
    _spline_ramp(tree, emission, "B_SPLINE")


def build_colorramp_cardinal(tree, emission):
    _spline_ramp(tree, emission, "CARDINAL")


def build_noise_2d(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "2D"
    noise.inputs["Scale"].default_value = 4.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 0.0
    tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    tree.links.new(noise.outputs[0], emission.inputs["Color"])


def build_vertex_color(tree, emission):
    node = tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "Col"
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def proxy_vertex_colors(proxy):
    """Corner color attribute linear in UV: exact under any triangulation."""
    mesh = proxy.data
    layer = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    source = mesh.uv_layers["BLENDLINK_TILE_SOURCE"]
    for index, item in enumerate(source.data):
        u, v = item.uv
        layer.data[index].color = (u, v, 0.25, 1.0)


def _combine_xyz(tree, x_socket=None, y_socket=None, z_value=0.0):
    combine = tree.nodes.new("ShaderNodeCombineXYZ")
    if x_socket is not None:
        tree.links.new(x_socket, combine.inputs["X"])
    if y_socket is not None:
        tree.links.new(y_socket, combine.inputs["Y"])
    combine.inputs["Z"].default_value = float(z_value)
    return combine.outputs["Vector"]


def build_tex_checker(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexChecker")
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Color1"].default_value = (0.9, 0.2, 0.1, 1.0)
    node.inputs["Color2"].default_value = (0.1, 0.3, 0.8, 1.0)
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_tex_gradient(tree, emission):
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"

    def gradient(gradient_type, vector_socket):
        node = tree.nodes.new("ShaderNodeTexGradient")
        node.gradient_type = gradient_type
        tree.links.new(vector_socket, node.inputs["Vector"])
        return node.outputs["Fac"]

    tree.links.new(
        gradient("LINEAR", _combine_xyz(tree, _uv_channel(tree, "u"))),
        combine.inputs["Red"],
    )
    tree.links.new(
        gradient("QUADRATIC", _combine_xyz(
            tree, _affine(tree, _uv_channel(tree, "u"), 2.0, -1.0),
        )),
        combine.inputs["Green"],
    )
    tree.links.new(
        gradient("RADIAL", _combine_xyz(
            tree,
            _affine(tree, _uv_channel(tree, "u"), 1.0, -0.5),
            _affine(tree, _uv_channel(tree, "v"), 1.0, -0.5),
        )),
        combine.inputs["Blue"],
    )
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def build_tex_magic(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexMagic")
    node.turbulence_depth = 2
    node.inputs["Scale"].default_value = 3.0
    node.inputs["Distortion"].default_value = 1.2
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_tex_wave(tree, emission):
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"

    def wave(vector_socket, **settings):
        node = tree.nodes.new("ShaderNodeTexWave")
        node.wave_type = settings.get("wave_type", "BANDS")
        node.bands_direction = settings.get("bands_direction", "X")
        node.rings_direction = settings.get("rings_direction", "X")
        node.wave_profile = settings.get("profile", "SIN")
        node.inputs["Scale"].default_value = settings.get("scale", 1.0)
        node.inputs["Distortion"].default_value = settings.get(
            "distortion", 0.0,
        )
        node.inputs["Detail"].default_value = settings.get("detail", 2.0)
        tree.links.new(vector_socket, node.inputs["Vector"])
        return node.outputs["Fac"]

    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    centered = _combine_xyz(
        tree,
        _affine(tree, _uv_channel(tree, "u"), 1.0, -0.5),
        _affine(tree, _uv_channel(tree, "v"), 1.0, -0.5),
    )
    tree.links.new(
        wave(uv, wave_type="BANDS", bands_direction="X", profile="SIN"),
        combine.inputs["Red"],
    )
    tree.links.new(
        wave(centered, wave_type="RINGS", rings_direction="SPHERICAL",
             profile="SAW"),
        combine.inputs["Green"],
    )
    tree.links.new(
        wave(uv, wave_type="BANDS", bands_direction="DIAGONAL",
             profile="TRI", distortion=1.0, detail=2.0),
        combine.inputs["Blue"],
    )
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def _rgb_input(tree, x_socket=None, y_socket=None, y_value=0.0, z_socket=None,
               z_value=0.0):
    combine = tree.nodes.new("ShaderNodeCombineXYZ")
    if x_socket is not None:
        tree.links.new(x_socket, combine.inputs["X"])
    if y_socket is not None:
        tree.links.new(y_socket, combine.inputs["Y"])
    else:
        combine.inputs["Y"].default_value = float(y_value)
    if z_socket is not None:
        tree.links.new(z_socket, combine.inputs["Z"])
    else:
        combine.inputs["Z"].default_value = float(z_value)
    return combine.outputs["Vector"]


def _rgb_channel(tree, color_socket, name):
    separate = tree.nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    tree.links.new(color_socket, separate.inputs["Color"])
    return separate.outputs[name]


def build_color_utilities(tree, emission):
    out = tree.nodes.new("ShaderNodeCombineColor")
    out.mode = "RGB"
    u = _uv_channel(tree, "u")
    v = _uv_channel(tree, "v")

    invert = tree.nodes.new("ShaderNodeInvert")
    tree.links.new(_rgb_input(tree, u, y_value=0.6, z_value=0.3),
                   invert.inputs["Color"])
    tree.links.new(v, invert.inputs["Fac"])
    tree.links.new(_rgb_channel(tree, invert.outputs["Color"], "Red"),
                   out.inputs["Red"])

    gamma = tree.nodes.new("ShaderNodeGamma")
    tree.links.new(_rgb_input(tree, u, y_value=0.5, z_value=0.2),
                   gamma.inputs["Color"])
    tree.links.new(_affine(tree, v, 2.0, 0.5), gamma.inputs["Gamma"])
    tree.links.new(_rgb_channel(tree, gamma.outputs["Color"], "Red"),
                   out.inputs["Green"])

    bright = tree.nodes.new("ShaderNodeBrightContrast")
    tree.links.new(_rgb_input(tree, u, y_value=0.5, z_value=0.5),
                   bright.inputs["Color"])
    tree.links.new(_affine(tree, v, 0.2, -0.1), bright.inputs["Bright"])
    bright.inputs["Contrast"].default_value = 0.4
    tree.links.new(_rgb_channel(tree, bright.outputs["Color"], "Red"),
                   out.inputs["Blue"])

    tree.links.new(out.outputs["Color"], emission.inputs["Color"])


def build_color_hsv(tree, emission):
    out = tree.nodes.new("ShaderNodeCombineColor")
    out.mode = "RGB"
    u = _uv_channel(tree, "u")
    v = _uv_channel(tree, "v")

    to_bw = tree.nodes.new("ShaderNodeRGBToBW")
    tree.links.new(_rgb_input(tree, u, y_socket=v, z_value=0.3),
                   to_bw.inputs["Color"])
    tree.links.new(to_bw.outputs["Val"], out.inputs["Red"])

    separate_hsv = tree.nodes.new("ShaderNodeSeparateColor")
    separate_hsv.mode = "HSV"
    tree.links.new(
        _rgb_input(tree, u, y_value=0.7,
                   z_socket=_affine(tree, v, 0.5, 0.2)),
        separate_hsv.inputs["Color"],
    )
    # outputs[1] is saturation; HSV mode relabels the socket names.
    tree.links.new(separate_hsv.outputs[1], out.inputs["Green"])

    combine_hsv = tree.nodes.new("ShaderNodeCombineColor")
    combine_hsv.mode = "HSV"
    tree.links.new(u, combine_hsv.inputs[0])
    combine_hsv.inputs[1].default_value = 0.8
    combine_hsv.inputs[2].default_value = 0.6
    tree.links.new(
        _rgb_channel(tree, combine_hsv.outputs["Color"], "Blue"),
        out.inputs["Blue"],
    )

    tree.links.new(out.outputs["Color"], emission.inputs["Color"])


def build_hue_saturation(tree, emission):
    node = tree.nodes.new("ShaderNodeHueSaturation")
    tree.links.new(
        _rgb_input(tree, _uv_channel(tree, "u"), y_value=0.55, z_value=0.25),
        node.inputs["Color"],
    )
    tree.links.new(_uv_channel(tree, "v"), node.inputs["Hue"])
    node.inputs["Saturation"].default_value = 1.3
    node.inputs["Value"].default_value = 0.9
    node.inputs["Fac"].default_value = 0.8
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_hash_probe(tree, emission):
    # TEMP: constant-vector White Noise COLOR isolates the WGSL hash4
    # (jenkinsMix) path: (hash3, hash4 w=1, hash4 w=2) of (2, 3, 0).
    combine = tree.nodes.new("ShaderNodeCombineXYZ")
    combine.inputs["X"].default_value = 2.0
    combine.inputs["Y"].default_value = 3.0
    combine.inputs["Z"].default_value = 0.0
    node = tree.nodes.new("ShaderNodeTexWhiteNoise")
    node.noise_dimensions = "3D"
    tree.links.new(combine.outputs["Vector"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_voronoi_rand0_probe(tree, emission):
    # TEMP: randomness-0 Voronoi has NO hash in its distances — a pure
    # lattice-distance pyramid. Divergence here means the geometric
    # construction is wrong, not the hash.
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    node = tree.nodes.new("ShaderNodeTexVoronoi")
    node.voronoi_dimensions = "3D"
    node.feature = "F1"
    node.distance = "EUCLIDEAN"
    if hasattr(node, "normalize"):
        node.normalize = False
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Randomness"].default_value = 0.0
    node.inputs["Detail"].default_value = 0.0
    tree.links.new(uv, node.inputs["Vector"])
    tree.links.new(node.outputs["Distance"], emission.inputs["Color"])


def build_white_noise(tree, emission):
    # The hash consumes RAW float bits, and interpolated UVs differ
    # between engines by ~260 ulps (measured on the uv-gradient cell) —
    # avalanche then decorrelates every texel. Quantizing to floor(uv*8)
    # makes the hashed bits integer-valued and bit-identical, gating the
    # Jenkins port itself through the production node.
    out = tree.nodes.new("ShaderNodeCombineColor")
    out.mode = "RGB"
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 8.0
    tree.links.new(uv, scale.inputs[0])
    quantize = tree.nodes.new("ShaderNodeVectorMath")
    quantize.operation = "FLOOR"
    tree.links.new(scale.outputs["Vector"], quantize.inputs[0])
    cells = quantize.outputs["Vector"]

    def white_noise(dimensions):
        node = tree.nodes.new("ShaderNodeTexWhiteNoise")
        node.noise_dimensions = dimensions
        tree.links.new(cells, node.inputs["Vector"])
        return node

    tree.links.new(
        white_noise("3D").outputs["Value"], out.inputs["Red"],
    )
    tree.links.new(
        white_noise("2D").outputs["Value"], out.inputs["Green"],
    )
    tree.links.new(
        _rgb_channel(tree, white_noise("3D").outputs["Color"], "Green"),
        out.inputs["Blue"],
    )
    tree.links.new(out.outputs["Color"], emission.inputs["Color"])


def build_voronoi_f1(tree, emission):
    out = tree.nodes.new("ShaderNodeCombineColor")
    out.mode = "RGB"
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]

    def voronoi(dimensions):
        node = tree.nodes.new("ShaderNodeTexVoronoi")
        node.voronoi_dimensions = dimensions
        node.feature = "F1"
        node.distance = "EUCLIDEAN"
        if hasattr(node, "normalize"):
            node.normalize = False
        node.inputs["Scale"].default_value = 4.0
        node.inputs["Randomness"].default_value = 1.0
        node.inputs["Detail"].default_value = 0.0
        tree.links.new(uv, node.inputs["Vector"])
        return node

    three_d = voronoi("3D")
    tree.links.new(
        _affine(tree, three_d.outputs["Distance"], 0.6, 0.0),
        out.inputs["Red"],
    )
    tree.links.new(
        _rgb_channel(tree, three_d.outputs["Color"], "Red"),
        out.inputs["Green"],
    )
    tree.links.new(
        _affine(tree, voronoi("2D").outputs["Distance"], 0.6, 0.0),
        out.inputs["Blue"],
    )
    tree.links.new(out.outputs["Color"], emission.inputs["Color"])


def build_noise_z_probe(tree, emission):
    # TEMP: the same fBM the Fac cell proved, but on a z ~ 150 plane —
    # isolates large-coordinate lineage agreement from the color-offset
    # computation.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 4.0
    tree.links.new(coord.outputs["UV"], scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (0.0, 0.0, 150.37)
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 1.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(offset.outputs["Vector"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_scale16(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 16.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_color(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["Roughness"].default_value = 0.5
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_noise_color_2d(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "2D"
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Detail"].default_value = 1.0
    node.inputs["Roughness"].default_value = 0.5
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_voronoi_smooth_f1(tree, emission):
    out = tree.nodes.new("ShaderNodeCombineColor")
    out.mode = "RGB"
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]

    def voronoi(dimensions):
        node = tree.nodes.new("ShaderNodeTexVoronoi")
        node.voronoi_dimensions = dimensions
        node.feature = "SMOOTH_F1"
        node.distance = "EUCLIDEAN"
        if hasattr(node, "normalize"):
            node.normalize = False
        node.inputs["Scale"].default_value = 4.0
        node.inputs["Randomness"].default_value = 1.0
        node.inputs["Smoothness"].default_value = 1.0
        node.inputs["Detail"].default_value = 0.0
        tree.links.new(uv, node.inputs["Vector"])
        return node

    three_d = voronoi("3D")
    tree.links.new(
        _affine(tree, three_d.outputs["Distance"], 0.6, 0.0),
        out.inputs["Red"],
    )
    tree.links.new(
        _rgb_channel(tree, three_d.outputs["Color"], "Red"),
        out.inputs["Green"],
    )
    tree.links.new(
        _affine(tree, voronoi("2D").outputs["Distance"], 0.6, 0.0),
        out.inputs["Blue"],
    )
    tree.links.new(out.outputs["Color"], emission.inputs["Color"])


def build_tex_magic_fac(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexMagic")
    node.turbulence_depth = 2
    node.inputs["Scale"].default_value = 3.0
    node.inputs["Distortion"].default_value = 1.2
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    fac = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(fac, emission.inputs["Color"])


def build_rgb_curve(tree, emission):
    node = tree.nodes.new("ShaderNodeRGBCurve")
    mapping = node.mapping
    red, green, blue, composite = mapping.curves
    # A bent composite curve plus distinct per-channel shapes: the C curve
    # applies before each channel curve, so a wrong composition order is a
    # gross error.
    composite.points.new(0.5, 0.35)
    red.points.new(0.25, 0.55)
    green.points[1].location = (1.0, 0.8)
    blue.points.new(0.7, 0.2)
    mapping.update()
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(_uv_channel(tree, "u"), combine.inputs["Red"])
    tree.links.new(
        _affine(tree, _uv_channel(tree, "u"), 0.5, 0.25),
        combine.inputs["Green"],
    )
    tree.links.new(
        _affine(tree, _uv_channel(tree, "u"), -0.8, 0.9),
        combine.inputs["Blue"],
    )
    tree.links.new(combine.outputs["Color"], node.inputs["Color"])
    tree.links.new(_uv_channel(tree, "v"), node.inputs["Fac"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_fresnel_dielectric(tree, emission):
    node = tree.nodes.new("ShaderNodeFresnel")
    node.inputs["IOR"].default_value = 1.45
    tree.links.new(node.outputs["Fac"], emission.inputs["Color"])


def build_layer_weight(tree, emission):
    node = tree.nodes.new("ShaderNodeLayerWeight")
    node.inputs["Blend"].default_value = 0.3
    combine = tree.nodes.new("ShaderNodeCombineColor")
    combine.mode = "RGB"
    tree.links.new(node.outputs["Facing"], combine.inputs["Red"])
    tree.links.new(node.outputs["Fresnel"], combine.inputs["Green"])
    combine.inputs["Blue"].default_value = 0.0
    tree.links.new(combine.outputs["Color"], emission.inputs["Color"])


def ensure_view_camera():
    """The view-dependent cell camera contract: position (0, 0, 2) looking
    down -Z at the unit-UV tile quad spanning [-1, 1]^2 at z = 0.  The TSL
    side reproduces V analytically from the same numbers."""
    camera = bpy.data.objects.get("TSL View Camera")
    if camera is None:
        data = bpy.data.cameras.new("TSL View Camera")
        camera = bpy.data.objects.new("TSL View Camera", data)
        bpy.context.scene.collection.objects.link(camera)
        camera.location = (0.0, 0.0, 2.0)
        camera.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.scene.camera = camera


def make_sweep_builder(spec):
    """A spec-driven Math cell: each input is a constant or an affine map
    of u/v, the swept operation runs once, and a post affine folds the
    result into the bakeable range.  The IR pipeline needs no per-cell TSL
    code — the production emitter walks this same graph."""
    def build(tree, emission):
        node = tree.nodes.new("ShaderNodeMath")
        node.operation = str(spec["operation"])
        for index, key in enumerate(("a", "b", "c")):
            if key not in spec:
                continue
            item = spec[key]
            if isinstance(item, (int, float)):
                node.inputs[index].default_value = float(item)
                continue
            source = _uv_channel(tree, item.get("axis", "u"))
            scale = float(item.get("scale", 1.0))
            offset = float(item.get("offset", 0.0))
            if scale != 1.0 or offset != 0.0:
                source = _affine(tree, source, scale, offset)
            tree.links.new(source, node.inputs[index])
        result = node.outputs["Value"]
        post = spec.get("post")
        if post:
            result = _affine(
                tree, result,
                float(post.get("scale", 1.0)), float(post.get("offset", 0.0)),
            )
        if spec.get("clamp"):
            result = _math(
                tree, "MINIMUM", _math(tree, "MAXIMUM", result, 0.0), 1.0,
            )
        _emit_scalar(tree, emission, result)
    return build


def make_mix_sweep_builder(spec):
    """A spec-driven Mix cell: each entry drives one Mix node (blend type,
    factor axis, constant A/B colors) and contributes one channel of the
    baked color, so up to three blend modes gate per cell with per-mode
    failure attribution."""
    def build(tree, emission):
        coord = tree.nodes.new("ShaderNodeTexCoord")
        separate_uv = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coord.outputs["UV"], separate_uv.inputs["Vector"])
        if len(spec["entries"]) == 1 and spec["entries"][0].get("full"):
            entry = spec["entries"][0]
            result = _mix_sweep_node(tree, separate_uv, entry)
            tree.links.new(result, emission.inputs["Color"])
            return
        combine = tree.nodes.new("ShaderNodeCombineColor")
        combine.mode = "RGB"
        for slot in ("Red", "Green", "Blue"):
            combine.inputs[slot].default_value = 0.0
        for entry, slot in zip(spec["entries"], ("Red", "Green", "Blue")):
            result = _mix_sweep_node(tree, separate_uv, entry)
            separate = tree.nodes.new("ShaderNodeSeparateColor")
            separate.mode = "RGB"
            tree.links.new(result, separate.inputs["Color"])
            tree.links.new(
                separate.outputs[entry.get("channel", slot)],
                combine.inputs[slot],
            )
        tree.links.new(combine.outputs["Color"], emission.inputs["Color"])
    return build


def _mix_sweep_node(tree, separate_uv, entry):
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = entry["blend"]
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = tuple(entry.get("a", (0.2, 0.8, 0.4))) + (1.0,)
    b_input.default_value = tuple(entry.get("b", (0.9, 0.1, 0.6))) + (1.0,)
    axis = entry.get("axis", "u")
    tree.links.new(
        separate_uv.outputs["X" if axis == "u" else "Y"], factor,
    )
    return next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )


def make_vector_sweep_builder(spec):
    """A spec-driven Vector Math cell: each entry drives one node whose
    vector inputs are per-component constants or affine maps of u/v; the
    entry samples either the scalar Value output or one component of the
    Vector output into its channel, with an optional post affine."""
    def build(tree, emission):
        coord = tree.nodes.new("ShaderNodeTexCoord")
        separate_uv = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coord.outputs["UV"], separate_uv.inputs["Vector"])

        def scalar_socket(item):
            axis = separate_uv.outputs[
                "X" if item.get("axis", "u") == "u" else "Y"
            ]
            scale = float(item.get("scale", 1.0))
            offset = float(item.get("offset", 0.0))
            if scale == 1.0 and offset == 0.0:
                return axis
            return _affine(tree, axis, scale, offset)

        def vector_math_node(entry):
            node = tree.nodes.new("ShaderNodeVectorMath")
            node.operation = entry["operation"]
            for index, key in enumerate(("a", "b", "c")):
                if key not in entry:
                    continue
                combine_xyz = tree.nodes.new("ShaderNodeCombineXYZ")
                for socket_name, item in zip(("X", "Y", "Z"), entry[key]):
                    if isinstance(item, (int, float)):
                        combine_xyz.inputs[socket_name].default_value = (
                            float(item)
                        )
                    else:
                        tree.links.new(
                            scalar_socket(item),
                            combine_xyz.inputs[socket_name],
                        )
                tree.links.new(
                    combine_xyz.outputs["Vector"], node.inputs[index],
                )
            return node

        entries = spec["entries"]
        if len(entries) == 1 and entries[0].get("full"):
            node = vector_math_node(entries[0])
            tree.links.new(node.outputs["Vector"], emission.inputs["Color"])
            return
        combine = tree.nodes.new("ShaderNodeCombineColor")
        combine.mode = "RGB"
        for slot in ("Red", "Green", "Blue"):
            combine.inputs[slot].default_value = 0.0
        for entry, slot in zip(entries, ("Red", "Green", "Blue")):
            node = vector_math_node(entry)
            if entry.get("output", "Vector") == "Value":
                scalar = node.outputs["Value"]
            else:
                separate = tree.nodes.new("ShaderNodeSeparateXYZ")
                tree.links.new(
                    node.outputs["Vector"], separate.inputs["Vector"],
                )
                scalar = separate.outputs[entry.get("component", "X")]
            post = entry.get("post")
            if post:
                scalar = _affine(
                    tree, scalar,
                    float(post.get("scale", 1.0)),
                    float(post.get("offset", 0.0)),
                )
            tree.links.new(scalar, combine.inputs[slot])
        tree.links.new(combine.outputs["Color"], emission.inputs["Color"])
    return build


CELL_PROXY_SETUP = {
    "vertex-color": proxy_vertex_colors,
}


BUILDERS = {
    "constant-linear": build_constant_linear,
    "uv-gradient": build_uv_gradient,
    "math-compare": build_math_compare,
    "mapping-rotate": build_mapping_rotate,
    "colorramp-linear": build_colorramp_linear,
    "math-safe-divide": build_math_safe_divide,
    "math-modulo-sign": build_math_modulo_sign,
    "math-power-negative-base": build_math_power_negative_base,
    "math-trig": build_math_trig,
    "colorramp-constant": build_colorramp_constant,
    "mapping-texture-mode": build_mapping_texture_mode,
    "noise-fractal-detail": build_noise_fractal_detail,
    "voronoi-f1-divergence": build_voronoi_f1_divergence,
    "noise-mx-divergence": build_noise_mx_divergence,
    "mix-modes": build_mix_modes,
    "mix-divide": build_mix_divide,
    "map-range-smoothstep": build_map_range_smoothstep,
    "colorramp-bspline": build_colorramp_bspline,
    "colorramp-cardinal": build_colorramp_cardinal,
    "noise-2d": build_noise_2d,
    "vertex-color": build_vertex_color,
    "group-passthrough": build_group_passthrough,
    "rgb-curve": build_rgb_curve,
    "hash-probe": build_hash_probe,
    "voronoi-rand0-probe": build_voronoi_rand0_probe,
    "noise-z-probe": build_noise_z_probe,
    "noise-scale16": build_noise_scale16,
    "noise-color": build_noise_color,
    "noise-color-2d": build_noise_color_2d,
    "voronoi-smooth-f1": build_voronoi_smooth_f1,
    "tex-magic-fac": build_tex_magic_fac,
    "white-noise": build_white_noise,
    "voronoi-f1": build_voronoi_f1,
    "color-utilities": build_color_utilities,
    "color-hsv": build_color_hsv,
    "hue-saturation": build_hue_saturation,
    "tex-checker": build_tex_checker,
    "tex-gradient": build_tex_gradient,
    "tex-magic": build_tex_magic,
    "tex-wave": build_tex_wave,
    "fresnel-dielectric": build_fresnel_dielectric,
    "layer-weight": build_layer_weight,
    "map-range-linear": build_map_range_linear,
    "mix-overlay": build_mix_overlay,
    "math-pingpong": build_math_pingpong,
    "clamp-node": build_clamp_node,
}


def main():
    import numpy as np

    bpy.ops.wm.read_factory_settings(use_empty=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ir_output = OUTPUT / "ir"
    ir_output.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "size": SIZE, "cells": {}}
    for cell in CELLS["cells"]:
        cell_id = cell["id"]
        pipeline = cell.get("pipeline", "ir")
        builder = BUILDERS.get(cell_id)
        if builder is None and "sweep" in cell:
            builder = make_sweep_builder(cell["sweep"])
        if builder is None and "mixSweep" in cell:
            builder = make_mix_sweep_builder(cell["mixSweep"])
        if builder is None and "vectorSweep" in cell:
            builder = make_vector_sweep_builder(cell["vectorSweep"])
        if builder is None:
            raise SystemExit(f"reference builder missing for cell {cell_id!r}")
        material = emission_material(f"CELL {cell_id}", builder)
        ir_path = None
        try:
            if pipeline == "ir":
                # The production emitter walks the SAME graph Cycles bakes;
                # a refusal here is a harness bug, not a soft skip.
                tree = material.node_tree
                emission = next(
                    node for node in tree.nodes
                    if node.bl_idname == "ShaderNodeEmission"
                )
                document = tsl_ir.emit_channel(emission.inputs["Color"])
                ir_path = ir_output / f"{cell_id}.json"
                ir_path.write_text(
                    json.dumps(document, indent=2) + "\n", encoding="utf8",
                )
            view_from = str(cell.get("viewFrom", "ABOVE_SURFACE"))
            if view_from == "ACTIVE_CAMERA":
                ensure_view_camera()
            proxy = bakelib.uv_tile_proxy([], window=(0.0, 0.0, 1.0, 1.0))
            try:
                setup = CELL_PROXY_SETUP.get(cell_id)
                if setup is not None:
                    setup(proxy)
                proxy.data.materials.append(material)
                result = bakelib.bake_channel_field_pixels(
                    [proxy], size=SIZE, margin_px=0,
                    uv_layer="BLENDLINK_TILE_BAKE",
                    label=f"tsl differential {cell_id}",
                    allow_hdr=True,
                    view_from=view_from,
                )
            finally:
                bakelib.remove_uv_tile_proxy(proxy)
        finally:
            bpy.data.materials.remove(material, do_unlink=True)
        pixels = np.asarray(result["pixels"], dtype=np.float32)
        path = OUTPUT / f"{cell_id}.f32"
        pixels.tofile(path)
        manifest["cells"][cell_id] = {
            "path": path.name,
            "pipeline": pipeline,
            **({"ir": f"ir/{cell_id}.json"} if ir_path is not None else {}),
            "shape": list(pixels.shape),
            "rgbMin": list(result["rgbMin"]),
            "rgbMax": list(result["rgbMax"]),
            "deviceClass": result["deviceClass"],
            "backend": result["backend"],
        }
        print(f"tsl differential reference: {cell_id} baked ({pipeline})")
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf8",
    )
    print("BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE")


if __name__ == "__main__":
    main()
