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
import os
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, os.environ.get("BLENDLINK_TSL_NATIVE_MODULES") or str(REPO / "packages" / "blendlink" / "blender"))
sys.path.insert(0, os.environ.get("BLENDLINK_TSL_NATIVE_MODULES") or str(REPO / "packages" / "blender-addon"))

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


def make_mapping_sweep_builder(spec):
    """Native static Mapping: all three output components retain their field."""
    def build(tree, emission):
        coord = tree.nodes.new("ShaderNodeTexCoord")
        scaled_input = tree.nodes.new("ShaderNodeVectorMath")
        scaled_input.operation = "MULTIPLY"
        scaled_input.inputs[1].default_value = (1.3, -0.8, 0.6)
        tree.links.new(coord.outputs["UV"], scaled_input.inputs[0])
        shifted_input = tree.nodes.new("ShaderNodeVectorMath")
        shifted_input.operation = "ADD"
        shifted_input.inputs[1].default_value = (-0.5, 0.2, -0.3)
        tree.links.new(scaled_input.outputs["Vector"], shifted_input.inputs[0])
        mapping = tree.nodes.new("ShaderNodeMapping")
        mapping.vector_type = spec["vectorType"]
        mapping.inputs["Rotation"].default_value = spec["rotation"]
        mapping.inputs["Scale"].default_value = spec["scale"]
        if "Location" in mapping.inputs:
            mapping.inputs["Location"].default_value = spec["location"]
        tree.links.new(shifted_input.outputs["Vector"], mapping.inputs["Vector"])
        scale = tree.nodes.new("ShaderNodeVectorMath")
        scale.operation = "SCALE"
        scale.inputs["Scale"].default_value = 0.05
        tree.links.new(mapping.outputs["Vector"], scale.inputs[0])
        bias = tree.nodes.new("ShaderNodeVectorMath")
        bias.operation = "ADD"
        bias.inputs[1].default_value = (0.5, 0.5, 0.5)
        tree.links.new(scale.outputs["Vector"], bias.inputs[0])
        tree.links.new(bias.outputs["Vector"], emission.inputs["Color"])
    return build


def make_generic_mix_builder(spec):
    """Native Float/Vector Mix, including scalar broadcast across a group."""
    def build(tree, emission):
        u, v = _uv_channel(tree, "u"), _uv_channel(tree, "v")

        def vector(values):
            combined = tree.nodes.new("ShaderNodeCombineXYZ")
            for name, value in zip(("X", "Y", "Z"), values):
                if hasattr(value, "node"):
                    tree.links.new(value, combined.inputs[name])
                else:
                    combined.inputs[name].default_value = value
            return combined.outputs["Vector"]

        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = spec["dataType"]
        mix.factor_mode = spec.get("factorMode", "UNIFORM")
        mix.clamp_factor = spec["clampFactor"]
        # These color-only settings must not change Float/Vector arithmetic.
        mix.clamp_result = True
        mix.blend_type = "MULTIPLY"
        sockets = {socket.identifier: socket for socket in mix.inputs}
        factor = _affine(tree, u, 3.0, -1.0)
        if mix.data_type == "FLOAT":
            tree.links.new(factor, sockets["Factor_Float"])
            tree.links.new(_affine(tree, u, 1.25, -0.4), sockets["A_Float"])
            tree.links.new(_affine(tree, v, -0.75, 0.8), sockets["B_Float"])
            result = next(socket for socket in mix.outputs if socket.identifier == "Result_Float")
        else:
            if spec.get("broadcastGroup"):
                group = bpy.data.node_groups.new("Mix Broadcast Boundary", "ShaderNodeTree")
                group.interface.new_socket(name="Value", in_out="INPUT", socket_type="NodeSocketFloat")
                group.interface.new_socket(name="Vector", in_out="OUTPUT", socket_type="NodeSocketVector")
                group_input = group.nodes.new("NodeGroupInput")
                group_output = group.nodes.new("NodeGroupOutput")
                group.links.new(group_input.outputs["Value"], group_output.inputs["Vector"])
                instance = tree.nodes.new("ShaderNodeGroup")
                instance.node_tree = group
                tree.links.new(_affine(tree, u, 1.25, -0.4), instance.inputs["Value"])
                tree.links.new(instance.outputs["Vector"], sockets["A_Vector"])
                tree.links.new(_affine(tree, v, -0.75, 0.8), sockets["B_Vector"])
            else:
                tree.links.new(vector((_affine(tree, u, 1.25, -0.4), _affine(tree, v, -0.75, 0.8), -0.2)), sockets["A_Vector"])
                tree.links.new(vector((-0.4, _affine(tree, u, 0.6, 0.15), _affine(tree, v, 1.1, -0.2))), sockets["B_Vector"])
            if mix.factor_mode == "NON_UNIFORM":
                tree.links.new(vector((factor, _affine(tree, v, 3.0, -1.0), 1.6)), sockets["Factor_Vector"])
            else:
                tree.links.new(factor, sockets["Factor_Float"])
            result = next(socket for socket in mix.outputs if socket.identifier == "Result_Vector")
            if spec.get("broadcastGroup"):
                separate = tree.nodes.new("ShaderNodeSeparateXYZ")
                tree.links.new(result, separate.inputs["Vector"])
                result = separate.outputs["Y"]
        if result.type == "VALUE":
            tree.links.new(_affine(tree, result, 0.2, 0.5), emission.inputs["Color"])
        else:
            scaled = tree.nodes.new("ShaderNodeVectorMath")
            scaled.operation = "SCALE"
            scaled.inputs["Scale"].default_value = 0.2
            tree.links.new(result, scaled.inputs[0])
            bias = tree.nodes.new("ShaderNodeVectorMath")
            bias.operation = "ADD"
            bias.inputs[1].default_value = (0.5, 0.5, 0.5)
            tree.links.new(scaled.outputs["Vector"], bias.inputs[0])
            tree.links.new(bias.outputs["Vector"], emission.inputs["Color"])
    return build


def make_map_range_builder(spec):
    """Native range modes, with degenerate/reversed ranges in the oracle."""
    def build(tree, emission):
        u, v = _uv_channel(tree, "u"), _uv_channel(tree, "v")
        node = tree.nodes.new("ShaderNodeMapRange")
        node.data_type = spec["dataType"]
        node.interpolation_type = spec["interpolation"]
        node.clamp = spec.get("clamp", True)
        sockets = {socket.identifier: socket for socket in node.inputs}
        if node.data_type == "FLOAT_VECTOR":
            combined = tree.nodes.new("ShaderNodeCombineXYZ")
            tree.links.new(_affine(tree, u, 1.8, -0.4), combined.inputs["X"])
            tree.links.new(_affine(tree, v, -2.0, 1.5), combined.inputs["Y"])
            combined.inputs["Z"].default_value = 0.7
            tree.links.new(combined.outputs["Vector"], sockets["Vector"])
            for key, value in {
                "From_Min_FLOAT3": (0.0, 1.0, 0.5), "From_Max_FLOAT3": (1.0, -1.0, 0.5),
                "To_Min_FLOAT3": (0.2, 0.8, 0.3), "To_Max_FLOAT3": (0.9, 0.1, 0.7),
                "Steps_FLOAT3": (4.0, 0.0, 2.5),
            }.items():
                sockets[key].default_value = value
            result = next(socket for socket in node.outputs if socket.identifier == "Vector")
            scaled = tree.nodes.new("ShaderNodeVectorMath")
            scaled.operation = "SCALE"
            scaled.inputs["Scale"].default_value = 0.2
            tree.links.new(result, scaled.inputs[0])
            bias = tree.nodes.new("ShaderNodeVectorMath")
            bias.operation = "ADD"
            bias.inputs[1].default_value = (0.4, 0.4, 0.4)
            tree.links.new(scaled.outputs["Vector"], bias.inputs[0])
            tree.links.new(bias.outputs["Vector"], emission.inputs["Color"])
        else:
            if not spec.get("default"):
                tree.links.new(_affine(tree, u, 1.8, -0.4), sockets["Value"])
                sockets["From Min"].default_value = 1.0 if spec.get("reversed") else 0.0
                sockets["From Max"].default_value = 0.0 if spec.get("reversed") else 1.0
                sockets["To Min"].default_value = 0.8 if spec.get("reversed") else 0.2
                sockets["To Max"].default_value = 0.2 if spec.get("reversed") else 0.9
                sockets["Steps"].default_value = 0.0 if spec.get("zeroSteps") else 4.5
                if spec.get("degenerate"):
                    sockets["From Min"].default_value = 0.5
                    sockets["From Max"].default_value = 0.5
            result = next(socket for socket in node.outputs if socket.identifier == "Result")
            tree.links.new(_affine(tree, result, 0.2, 0.4), emission.inputs["Color"])
    return build


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


def make_clamp_builder(spec):
    """Native Clamp with authored and live bounds, including crossings."""
    def build(tree, emission):
        node = tree.nodes.new("ShaderNodeClamp")
        node.clamp_type = spec["mode"]
        for name, value in zip(("Value", "Min", "Max"), spec["inputs"]):
            if isinstance(value, (int, float)):
                node.inputs[name].default_value = value
            else:
                source = _affine(tree, _uv_channel(tree, value.get("axis", "u")),
                                 value.get("scale", 1), value.get("offset", 0))
                tree.links.new(source, node.inputs[name])
        # A shared positive carrier retains negative/HDR results through the
        # Cycles isolated-channel bake; it is not a rewrite of the Clamp node.
        tree.links.new(_affine(tree, node.outputs[0], 1 / 32, .5), emission.inputs["Color"])
    return build


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


def build_map_range_smootherstep(tree, emission):
    node = tree.nodes.new("ShaderNodeMapRange")
    node.interpolation_type = "SMOOTHERSTEP"
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


def build_noise_detail4(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Detail"].default_value = 4.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_scale80(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 80.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_distortion(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 5.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["Distortion"].default_value = 1.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_distortion_color(tree, emission):
    # Distortion AND the colour lanes together: the lanes use seeds 3 and 4
    # precisely because distortion consumes 0..2, so this is the cell that
    # catches the two features colliding over the same offsets.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 5.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["Distortion"].default_value = 0.75
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def _rotate_probe_point(tree):
    """UV shrunk to [0.3,0.7]^2 at z=0.5, so a rotation about (0.5,0.5,0.5)
    keeps ALL THREE components inside [0,1].

    The reference bake refuses negative channel values and clamps above 1, so
    a cell that rotated the full unit tile could not measure anything: the
    square's half-diagonal is 0.707, which leaves [0,1] under any rotation
    that is not a multiple of 90 degrees. Shrinking the sampled region to an
    in-plane radius of 0.283 about the centre bounds every rotated component
    to roughly [0.2, 0.8] for an arbitrary axis, not just for Z.
    """
    coord = tree.nodes.new("ShaderNodeTexCoord")
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.vector_type = "POINT"
    mapping.inputs["Location"].default_value = (0.3, 0.3, 0.5)
    mapping.inputs["Scale"].default_value = (0.4, 0.4, 0.0)
    tree.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    return mapping.outputs["Vector"]


def build_vector_rotate_z(tree, emission):
    point = _rotate_probe_point(tree)
    node = tree.nodes.new("ShaderNodeVectorRotate")
    node.rotation_type = "Z_AXIS"
    node.inputs["Center"].default_value = (0.5, 0.5, 0.5)
    node.inputs["Angle"].default_value = 0.5
    tree.links.new(point, node.inputs["Vector"])
    tree.links.new(node.outputs["Vector"], emission.inputs["Color"])


def build_vector_rotate_axis_angle(tree, emission):
    # A deliberately non-unit, non-axis-aligned Axis: this is the cell that
    # gates the normalize and all nine Rodrigues coefficients at once, and
    # therefore also stands behind the X/Y/Z_AXIS literals.
    point = _rotate_probe_point(tree)
    node = tree.nodes.new("ShaderNodeVectorRotate")
    node.rotation_type = "AXIS_ANGLE"
    node.inputs["Center"].default_value = (0.5, 0.5, 0.5)
    node.inputs["Axis"].default_value = (0.3, -0.7, 0.5)
    node.inputs["Angle"].default_value = 0.9
    tree.links.new(point, node.inputs["Vector"])
    tree.links.new(node.outputs["Vector"], emission.inputs["Color"])


def build_noise_detail6(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Detail"].default_value = 6.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_scale20(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 20.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_scale40(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 40.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_voronoi_scale20(tree, emission):
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    node = tree.nodes.new("ShaderNodeTexVoronoi")
    node.voronoi_dimensions = "3D"
    node.feature = "F1"
    node.distance = "EUCLIDEAN"
    if hasattr(node, "normalize"):
        node.normalize = False
    node.inputs["Scale"].default_value = 20.0
    node.inputs["Randomness"].default_value = 1.0
    node.inputs["Detail"].default_value = 0.0
    tree.links.new(uv, node.inputs["Vector"])
    _emit_scalar(
        tree, emission, _affine(tree, node.outputs["Distance"], 0.6, 0.0),
    )


def build_voronoi_scale40(tree, emission):
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    node = tree.nodes.new("ShaderNodeTexVoronoi")
    node.voronoi_dimensions = "3D"
    node.feature = "F1"
    node.distance = "EUCLIDEAN"
    if hasattr(node, "normalize"):
        node.normalize = False
    node.inputs["Scale"].default_value = 40.0
    node.inputs["Randomness"].default_value = 1.0
    node.inputs["Detail"].default_value = 0.0
    tree.links.new(uv, node.inputs["Vector"])
    _emit_scalar(
        tree, emission, _affine(tree, node.outputs["Distance"], 0.6, 0.0),
    )


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


def _test_image(name, *, float_buffer, colorspace):
    existing = bpy.data.images.get(name)
    if existing is not None:
        bpy.data.images.remove(existing)
    image = bpy.data.images.new(
        name, 8, 8, alpha=True, float_buffer=float_buffer,
    )
    image.colorspace_settings.name = colorspace
    pixels = []
    for j in range(8):
        for i in range(8):
            pixels.extend((
                (i + 0.5) / 8.0,
                (j + 0.5) / 8.0,
                ((i * 3 + j * 5) % 8) / 7.0,
                ((i + j) % 4) / 3.0,
            ))
    image.pixels = pixels
    # Byte images must be packed after pixel assignment or the renderer
    # samples zeros (measured: the un-packed byte cell baked black while
    # the float-buffer path propagated directly).
    image.pack()
    image.update()
    return image


def _scaled_uv(tree, scale, offset):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    scale_node = tree.nodes.new("ShaderNodeVectorMath")
    scale_node.operation = "SCALE"
    scale_node.inputs["Scale"].default_value = scale
    tree.links.new(coord.outputs["UV"], scale_node.inputs[0])
    if offset == 0.0:
        return scale_node.outputs["Vector"]
    add = tree.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (offset, offset, 0.0)
    tree.links.new(scale_node.outputs["Vector"], add.inputs[0])
    return add.outputs["Vector"]


def build_tex_image_linear(tree, emission):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = _test_image(
        "TSL_IMG_FLOAT", float_buffer=True, colorspace="Non-Color",
    )
    node.interpolation = "Linear"
    node.extension = "REPEAT"
    tree.links.new(_scaled_uv(tree, 2.0, 0.0), node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_noise_1d(tree, emission):
    # 1D noise consumes the W socket alone. Driven from UV.x through a
    # Separate XYZ so the field actually varies across the tile; a constant W
    # would measure one texel repeated 4096 times and prove nothing.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "1D"
    node.inputs["Scale"].default_value = 6.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(separate.outputs["X"], node.inputs["W"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_1d_detail0(tree, emission):
    # Detail 0 isolates the single perlin_1d octave from the fBM loop, so a
    # gradient/hash error and an octave-accumulation error cannot hide in each
    # other.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "1D"
    node.inputs["Scale"].default_value = 11.0
    node.inputs["Detail"].default_value = 0.0
    tree.links.new(separate.outputs["Y"], node.inputs["W"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_4d(tree, emission):
    # 4D Fac: Vector from UV, constant W -- the watch-family shape.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "4D"
    node.inputs["Scale"].default_value = 5.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["W"].default_value = 3.3
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_4d_color_distortion(tree, emission):
    # Colour output AND distortion together: colour lanes sit at seeds 4/5
    # precisely because 4D distortion consumes 0..3, so this cell fails if
    # either lane family is given the wrong seeds or the wrong arity.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "4D"
    node.inputs["Scale"].default_value = 8.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["W"].default_value = 3.3
    node.inputs["Distortion"].default_value = 0.5
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_noise_1d_color_distortion(tree, emission):
    # The 1D twin of the cell above: one scalar distortion lane at seed 0,
    # colour lanes at seeds 1/2. Guards the lane-count fix -- the old
    # "2 if 2D else 3" fallthrough emitted three offsets here.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "1D"
    node.inputs["Scale"].default_value = 7.0
    node.inputs["Detail"].default_value = 2.0
    node.inputs["Distortion"].default_value = 0.7
    tree.links.new(separate.outputs["X"], node.inputs["W"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_muted_math(tree, emission):
    # A MUTED Math between a varying value and the output: Blender bypasses
    # per the node's internal_links (input 0 passes through), so the field
    # must equal the raw uv.x gradient, not the multiply.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    muted = tree.nodes.new("ShaderNodeMath")
    muted.operation = "MULTIPLY"
    muted.inputs[1].default_value = 0.25
    muted.mute = True
    tree.links.new(separate.outputs["X"], muted.inputs[0])
    tree.links.new(muted.outputs["Value"], emission.inputs["Color"])


def build_muted_mix_color(tree, emission):
    # A MUTED Mix (RGBA) with a varying A and constant B: the bypass passes
    # A through, proving the mechanism on a second node shape whose
    # internal_links map differently-typed sockets.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    muted = tree.nodes.new("ShaderNodeMix")
    muted.data_type = "RGBA"
    muted.blend_type = "MIX"
    muted.mute = True
    factor = next(
        s for s in muted.inputs
        if s.identifier == "Factor_Float"
    )
    factor.default_value = 0.75
    a_socket = next(s for s in muted.inputs if s.identifier == "A_Color")
    b_socket = next(s for s in muted.inputs if s.identifier == "B_Color")
    b_socket.default_value = (0.9, 0.1, 0.2, 1.0)
    tree.links.new(coord.outputs["UV"], a_socket)
    result = next(s for s in muted.outputs if s.identifier == "Result_Color")
    tree.links.new(result, emission.inputs["Color"])


def build_white_noise_1d(tree, emission):
    # Quantized W (floor of uv.x * 8): integer-valued bits, bit-identical
    # across engines, gating the 1-argument hash and the hash_float_to_vec3
    # Colour re-hash through the production node.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    scale = tree.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = 8.0
    tree.links.new(separate.outputs["X"], scale.inputs[0])
    quantize = tree.nodes.new("ShaderNodeMath")
    quantize.operation = "FLOOR"
    tree.links.new(scale.outputs["Value"], quantize.inputs[0])
    node = tree.nodes.new("ShaderNodeTexWhiteNoise")
    node.noise_dimensions = "1D"
    tree.links.new(quantize.outputs["Value"], node.inputs["W"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_white_noise_4d(tree, emission):
    # Quantized vector AND constant W: gates hash_vec4_to_float and the
    # xyzw/zxwy/wzyx Colour swizzles through the production node.
    out_mix = tree.nodes.new("ShaderNodeCombineColor")
    out_mix.mode = "RGB"
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 8.0
    tree.links.new(uv, scale.inputs[0])
    quantize = tree.nodes.new("ShaderNodeVectorMath")
    quantize.operation = "FLOOR"
    tree.links.new(scale.outputs["Vector"], quantize.inputs[0])
    node = tree.nodes.new("ShaderNodeTexWhiteNoise")
    node.noise_dimensions = "4D"
    node.inputs["W"].default_value = 7.25
    tree.links.new(quantize.outputs["Vector"], node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_noise_effective_scale400(tree, emission):
    # The Wooden_Bars shape: a constant per-axis pre-multiply ahead of a
    # small Scale socket, effective frequency 400 on the dominant axes.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    premultiply = tree.nodes.new("ShaderNodeVectorMath")
    premultiply.operation = "MULTIPLY"
    premultiply.inputs[1].default_value = (1.0, 100.0, 100.0)
    tree.links.new(coord.outputs["UV"], premultiply.inputs[0])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 4.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(premultiply.outputs["Vector"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_overlay_branch_voronoi(tree, emission):
    # The DP-SkyPaint composition, minimized: an OVERLAY whose A operand
    # crosses 0.5 mid-tile (UV as colour) while B is a var-heavy Voronoi
    # colour over OBJECT coordinates (so the negative half of the domain
    # is finally measured too). Overlay selects its branch PER CHANNEL
    # per texel; TSL emits .toVar() assignments at the FIRST USE site and
    # select() compiles to if/else, so an operand whose vars first
    # materialize inside one arm leaves the other arm reading them
    # unassigned -- measured as an exact half-tile divergence on
    # DP-SkyPaint.MAT, zero on the a<0.5 half, 0.45 max on the other.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    voronoi = tree.nodes.new("ShaderNodeTexVoronoi")
    voronoi.voronoi_dimensions = "3D"
    voronoi.feature = "F1"
    voronoi.distance = "EUCLIDEAN"
    if hasattr(voronoi, "normalize"):
        voronoi.normalize = False
    voronoi.inputs["Scale"].default_value = 6.0
    voronoi.inputs["Randomness"].default_value = 1.0
    voronoi.inputs["Detail"].default_value = 0.0
    tree.links.new(coord.outputs["Object"], voronoi.inputs["Vector"])
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "OVERLAY"
    mix.clamp_result = True
    a_socket = next(s for s in mix.inputs if s.identifier == "A_Color")
    b_socket = next(s for s in mix.inputs if s.identifier == "B_Color")
    tree.links.new(coord.outputs["UV"], a_socket)
    # Distance, not Color: the argmin loop is exactly as var-heavy (the
    # hazard trigger), but F1 distance is CONTINUOUS across a winner flip
    # while the winning-cell hash colour is not -- with Color this cell
    # measured a maxAbs 0.207 single-texel lottery that no exact gate can
    # hold. That tail is the emitter's declared
    # tsl.voronoi-color-winner-flip approximation, measured densely by
    # voronoi-scale155-f1-color; this cell stays a tight exact gate for
    # the branch-sealing mechanism.
    tree.links.new(voronoi.outputs["Distance"], b_socket)
    factor = next(s for s in mix.inputs if s.identifier == "Factor_Float")
    factor.default_value = 0.5
    result = next(
        item for item in mix.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def build_ambient_occlusion_passthrough(tree, emission):
    # AO on the lone flat tile: no occluders, so Cycles evaluates factor 1.0
    # and the Colour output equals the input colour - which is exactly the
    # runtime's unoccluded default. The input is a UV gradient rather than
    # the corpus's constant white so the passthrough algebra is actually
    # exercised; the corpus shape (white input) is strictly easier.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeAmbientOcclusion")
    tree.links.new(coord.outputs["UV"], node.inputs["Color"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_mix_factor_color_ramp(tree, emission):
    # A NON-grayscale ColorRamp COLOR wired into Mix.Factor: Cycles inserts
    # linear_rgb_to_gray on the link. A coloured ramp distinguishes the
    # correct luminance from a component average and from the x-lane
    # truncation the guard exists to prevent.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.9, 0.1, 0.3, 1.0)
    ramp.color_ramp.elements[1].color = (0.05, 0.8, 0.6, 1.0)
    tree.links.new(separate.outputs["X"], ramp.inputs["Fac"])
    mix = tree.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "OVERLAY"
    a_socket = next(s for s in mix.inputs if s.identifier == "A_Color")
    b_socket = next(s for s in mix.inputs if s.identifier == "B_Color")
    a_socket.default_value = (0.2, 0.55, 0.3, 1.0)
    b_socket.default_value = (0.7, 0.35, 0.9, 1.0)
    factor = next(s for s in mix.inputs if s.identifier == "Factor_Float")
    tree.links.new(ramp.outputs["Color"], factor)
    result = next(s for s in mix.outputs if s.identifier == "Result_Color")
    tree.links.new(result, emission.inputs["Color"])


def build_noise_texture_panel_mapping(tree, emission):
    # The collapsed Texture-panel transform on the node itself, not a
    # Mapping node: the cube-diorama defect class. Non-uniform scale plus a
    # translation, applied by Cycles BEFORE the Scale socket.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 6.0
    node.inputs["Detail"].default_value = 2.0
    node.texture_mapping.scale = (0.8, 0.16, 1.0)
    node.texture_mapping.translation = (0.35, -0.2, 0.0)
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_2d_scale200(tree, emission):
    # The head/skin 2D config: detail 2, Colour output at scale 200 - found
    # hidden behind the Voronoi-177 refusal after the first band pass.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "2D"
    node.inputs["Scale"].default_value = 200.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_noise_3d_scale200(tree, emission):
    # The corpus-maximum 3D frequency. Same shape as the scale-40/80 cells.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "3D"
    node.inputs["Scale"].default_value = 200.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_1d_scale1600(tree, emission):
    # The corpus-maximum 1D frequency (fannypack seams). 1600 periods across
    # the 64px tile is 25 per texel: both engines alias identically in
    # structure, and the divergence is sample position times frequency.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "1D"
    node.inputs["Scale"].default_value = 1600.0
    node.inputs["Detail"].default_value = 2.0
    tree.links.new(separate.outputs["X"], node.inputs["W"])
    factor = next(s for s in node.outputs if s.identifier == "Fac")
    tree.links.new(factor, emission.inputs["Color"])


def build_noise_2d_scale100_color(tree, emission):
    # The hair configuration: 2D, detail 0.5, Colour output at scale 100.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.noise_dimensions = "2D"
    node.inputs["Scale"].default_value = 100.0
    node.inputs["Detail"].default_value = 0.5
    node.inputs["Roughness"].default_value = 0.4
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_voronoi_scale177_smoothf1(tree, emission):
    # The head/skin configuration verbatim: SMOOTH_F1, EUCLIDEAN,
    # smoothness 1.0, randomness 1.0, Distance output at 177.1.
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    node = tree.nodes.new("ShaderNodeTexVoronoi")
    node.voronoi_dimensions = "3D"
    node.feature = "SMOOTH_F1"
    node.distance = "EUCLIDEAN"
    if hasattr(node, "normalize"):
        node.normalize = False
    node.inputs["Scale"].default_value = 177.1
    node.inputs["Smoothness"].default_value = 1.0
    node.inputs["Randomness"].default_value = 1.0
    tree.links.new(uv, node.inputs["Vector"])
    distance = next(s for s in node.outputs if s.identifier == "Distance")
    tree.links.new(distance, emission.inputs["Color"])


def build_voronoi_scale155_f1_color(tree, emission):
    # The splash configuration verbatim: 19 nodes, all 3D F1 EUCLIDEAN,
    # randomness 1.0, Color output, group-linked Scale folding to 150 or
    # 155. Sub-texel cells: the per-texel colour is the hash of whichever
    # cell wins, and sample-position wiggle flips the winner, so this is
    # measured as a distribution, never per texel.
    uv = tree.nodes.new("ShaderNodeTexCoord").outputs["UV"]
    node = tree.nodes.new("ShaderNodeTexVoronoi")
    node.voronoi_dimensions = "3D"
    node.feature = "F1"
    node.distance = "EUCLIDEAN"
    if hasattr(node, "normalize"):
        node.normalize = False
    node.inputs["Scale"].default_value = 155.0
    node.inputs["Randomness"].default_value = 1.0
    node.inputs["Detail"].default_value = 0.0
    tree.links.new(uv, node.inputs["Vector"])
    color = next(s for s in node.outputs if s.identifier == "Color")
    tree.links.new(color, emission.inputs["Color"])


def build_white_noise_continuous_uv(tree, emission):
    # Raw UV straight into White Noise -- no floor/ceil/snap. This is the
    # configuration the corpus actually uses and the one that cannot agree
    # per texel; the quantized `white-noise` cell gates the port itself.
    coord = tree.nodes.new("ShaderNodeTexCoord")
    node = tree.nodes.new("ShaderNodeTexWhiteNoise")
    node.noise_dimensions = "3D"
    tree.links.new(coord.outputs["UV"], node.inputs["Vector"])
    value = next(s for s in node.outputs if s.identifier == "Value")
    tree.links.new(value, emission.inputs["Color"])


def make_image_sampling_builder(spec):
    def build(tree, emission):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = _test_image("TSL_IMAGE_SAMPLING_" + str(spec.get("image", "float")),
                                 float_buffer=spec.get("image", "float") == "float",
                                 colorspace=spec.get("colorSpace", "Non-Color"))
        node.interpolation, node.extension = spec["interpolation"], spec["extension"]
        if "halfPrecision" in spec:
            node.image.use_half_precision = spec["halfPrecision"]
        if "coordinate" in spec:
            coordinate = tree.nodes.new("ShaderNodeCombineXYZ")
            for index, value in enumerate((*spec["coordinate"], 0)):
                coordinate.inputs[index].default_value = value
            tree.links.new(coordinate.outputs[0], node.inputs["Vector"])
        else:
            tree.links.new(_scaled_uv(tree, spec.get("scale", 3.125), spec.get("offset", -1.0625)), node.inputs["Vector"])
        tree.links.new(node.outputs[spec.get("output", "Color")], emission.inputs["Color"])
    return build


def build_tex_image_cubic(tree, emission):
    # Cubic B-spline over a 4x4 neighbourhood. REPEAT extension on purpose:
    # the wrap has to hold for the ix-1 and ix+2 taps, which reach outside the
    # tile at every edge, and those are exactly the taps bilinear never uses.
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = _test_image(
        "TSL_IMG_CUBIC", float_buffer=True, colorspace="Non-Color",
    )
    node.interpolation = "Cubic"
    node.extension = "REPEAT"
    tree.links.new(_scaled_uv(tree, 2.0, 0.0), node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_tex_image_cubic_extend(tree, emission):
    # Same filter against the EXTEND clamp, where the outer taps saturate
    # instead of wrapping.
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = _test_image(
        "TSL_IMG_CUBIC_EXT", float_buffer=True, colorspace="Non-Color",
    )
    node.interpolation = "Cubic"
    node.extension = "EXTEND"
    tree.links.new(_scaled_uv(tree, 1.5, -0.25), node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_tex_image_box(tree, emission):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = _test_image(
        "TSL_IMG_BOX", float_buffer=True, colorspace="Non-Color",
    )
    node.interpolation = "Linear"
    node.extension = "REPEAT"
    node.projection = "BOX"
    node.projection_blend = 0.0
    coord = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coord.outputs["Object"], node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_tex_image_closest_srgb(tree, emission):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = _test_image(
        "TSL_IMG_BYTE", float_buffer=False, colorspace="sRGB",
    )
    node.interpolation = "Closest"
    node.extension = "EXTEND"
    tree.links.new(_scaled_uv(tree, 1.5, -0.25), node.inputs["Vector"])
    tree.links.new(node.outputs["Color"], emission.inputs["Color"])


def build_texco_object(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = 0.25
    tree.links.new(coord.outputs["Object"], scale.inputs[0])
    add = tree.nodes.new("ShaderNodeVectorMath")
    add.operation = "ADD"
    add.inputs[1].default_value = (0.5, 0.5, 0.5)
    tree.links.new(scale.outputs["Vector"], add.inputs[0])
    tree.links.new(add.outputs["Vector"], emission.inputs["Color"])


def build_texco_generated(tree, emission):
    coord = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coord.outputs["Generated"], emission.inputs["Color"])


def build_attribute_fac(tree, emission):
    node = tree.nodes.new("ShaderNodeAttribute")
    node.attribute_type = "GEOMETRY"
    node.attribute_name = "Col"
    fac = next(s for s in node.outputs if s.identifier == "Fac")
    _emit_scalar(tree, emission, fac)


def build_attribute_object(tree, emission):
    """Per-object custom property (the shared-material per-object-tint
    pattern): the object's color property scales a UV gradient so the
    diff carries both the property value and its spatial application."""
    node = tree.nodes.new("ShaderNodeAttribute")
    node.attribute_type = "OBJECT"
    node.attribute_name = "blendlink_probe"
    coord = tree.nodes.new("ShaderNodeTexCoord")
    multiply = tree.nodes.new("ShaderNodeVectorMath")
    multiply.operation = "MULTIPLY"
    tree.links.new(node.outputs["Color"], multiply.inputs[0])
    tree.links.new(coord.outputs["UV"], multiply.inputs[1])
    tree.links.new(multiply.outputs["Vector"], emission.inputs["Color"])


def build_objectinfo_random(tree, emission):
    """Object Info Random scaled by the UV.x gradient, so the diff carries
    both the per-object value and its spatial application. The reference
    side needs no fixture property: Cycles derives Random from the proxy
    object's NAME, and the manifest hook below computes the same value with
    the production helper for the TSL side."""
    info = tree.nodes.new("ShaderNodeObjectInfo")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    multiply = tree.nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    tree.links.new(info.outputs["Random"], multiply.inputs[0])
    tree.links.new(separate.outputs["X"], multiply.inputs[1])
    tree.links.new(multiply.outputs["Value"], emission.inputs["Color"])


def manifest_objectinfo_random(proxy):
    """Declare the TSL fixture FROM the proxy's actual name via the
    production helper, so the hash itself is inside the gate: if
    object_random_number ever drifts from what Cycles renders, this cell
    fails rather than both sides agreeing on a wrong constant."""
    value = tsl_ir.object_random_number(proxy.name)
    return {"objectAttributes": {
        tsl_ir.OBJECT_RANDOM_PROPERTY: [value, value, value],
    }}


def proxy_object_attribute(proxy):
    proxy["blendlink_probe"] = [0.8, 0.35, 0.1]


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


def render_eevee_reference(material, light_contract):
    """EEVEE ortho render of the unit tile — the oracle for captured
    lighting (Shader to RGB), which Cycles cannot evaluate.

    Contract: quad [-1, 1]^2 at z = 0 with identity UVs, orthographic
    camera at (0, 0, 2) framing exactly the quad, ONE sun with the
    declared rotation/strength, no world light, 1 sample, Raw view
    transform, float EXR readback. Rows come back bottom-up like the
    bake references."""
    import tempfile

    import numpy as np

    scene = bpy.context.scene
    mesh = bpy.data.meshes.new("TSL EEVEE Tile")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    layer = mesh.uv_layers.new(name="TSL_EEVEE_UV")
    for loop_index, corner in enumerate(
        ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
    ):
        layer.data[loop_index].uv = corner
    quad = bpy.data.objects.new("TSL EEVEE Tile", mesh)
    scene.collection.objects.link(quad)
    quad.data.materials.append(material)

    camera_data = bpy.data.cameras.new("TSL EEVEE Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 2.0
    camera = bpy.data.objects.new("TSL EEVEE Camera", camera_data)
    camera.location = (0.0, 0.0, 2.0)
    scene.collection.objects.link(camera)

    light_data = bpy.data.lights.new("TSL EEVEE Sun", "SUN")
    light_data.energy = float(light_contract.get("strength", 1.0))
    light_data.angle = 0.0
    light = bpy.data.objects.new("TSL EEVEE Sun", light_data)
    light.rotation_euler = tuple(light_contract.get("rotation", (0, 0, 0)))
    scene.collection.objects.link(light)

    previous_camera = scene.camera
    previous_engine = scene.render.engine
    output_path = Path(tempfile.mkdtemp()) / "tsl_eevee_reference.exr"
    try:
        scene.camera = camera
        engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
        scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
        scene.eevee.taa_render_samples = 1
        scene.render.resolution_x = SIZE
        scene.render.resolution_y = SIZE
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = False
        scene.view_settings.view_transform = "Raw"
        scene.view_settings.look = "None"
        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.image_settings.exr_codec = "NONE"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.filepath = str(output_path)
        if scene.world is not None:
            scene.world = None
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(str(output_path))
        try:
            pixels = np.asarray(image.pixels[:], dtype=np.float32)
            channels = len(image.pixels) // (SIZE * SIZE)
            grid = pixels.reshape(SIZE, SIZE, channels)[:, :, :3]
        finally:
            bpy.data.images.remove(image)
        return {
            "pixels": grid,
            "rgbMin": [float(grid[..., c].min()) for c in range(3)],
            "rgbMax": [float(grid[..., c].max()) for c in range(3)],
            "deviceClass": "eevee",
            "backend": "BLENDER_EEVEE",
        }
    finally:
        scene.camera = previous_camera
        scene.render.engine = previous_engine
        for obj in (quad, light, camera):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
        bpy.data.lights.remove(light_data)
        bpy.data.cameras.remove(camera_data)
        if output_path.exists():
            output_path.unlink()


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




def _vector_probe_field(tree, values):
    node = tree.nodes.new("ShaderNodeCombineXYZ")
    for socket, value in zip(("X", "Y", "Z"), values):
        if isinstance(value, (int, float)):
            node.inputs[socket].default_value = value
        else:
            source = _uv_channel(tree, value.get("axis", "u"))
            source = _affine(tree, source, value.get("scale", 1), value.get("offset", 0))
            tree.links.new(source, node.inputs[socket])
    return node.outputs["Vector"]


def _emit_vector_probe(tree, emission, vector, post):
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs["Scale"].default_value = post.get("scale", 0.2)
    tree.links.new(vector, scale.inputs[0])
    offset = tree.nodes.new("ShaderNodeVectorMath")
    offset.operation = "ADD"
    offset.inputs[1].default_value = (post.get("offset", 0.5),) * 3
    tree.links.new(scale.outputs["Vector"], offset.inputs[0])
    tree.links.new(offset.outputs["Vector"], emission.inputs["Color"])


def make_vector_transform_builder(spec):
    def build(tree, emission):
        point = _vector_probe_field(tree, spec.get("input", [{"axis": "u", "scale": 1.3, "offset": -0.4},
                                                            {"axis": "v", "scale": 0.8, "offset": -0.3}, -0.2]))
        def transform(inverse=False):
            mapping = spec["node"] == "Mapping"
            node = tree.nodes.new("ShaderNodeMapping" if mapping else "ShaderNodeVectorRotate")
            if mapping:
                node.vector_type = spec["mode"]
            else:
                node.rotation_type = spec["mode"]
                node.invert = not spec.get("invert", False) if inverse else spec.get("invert", False)
            for name in ("Location", "Scale", "Rotation", "Center", "Axis", "Angle"):
                if name not in node.inputs or name.lower() not in spec:
                    continue
                value = spec[name.lower()]
                if name in spec.get("linked", []):
                    if name == "Angle":
                        source = _affine(tree, _uv_channel(tree, value.get("axis", "u")), value.get("scale", 1), value.get("offset", 0))
                    else:
                        source = _vector_probe_field(tree, value)
                    tree.links.new(source, node.inputs[name])
                else:
                    node.inputs[name].default_value = value
            return node
        node = transform()
        tree.links.new(point, node.inputs["Vector"])
        result = node.outputs["Vector"]
        if spec.get("roundTrip"):
            inverse = transform(True)
            tree.links.new(result, inverse.inputs["Vector"])
            result = inverse.outputs["Vector"]
        _emit_vector_probe(tree, emission, result, spec.get("post", {}))
    return build


def make_hue_ramp_builder(spec):
    """Native hue-ramp evaluator, including alpha and ignored interpolation UI."""
    def build(tree, emission):
        node = tree.nodes.new("ShaderNodeValToRGB")
        ramp = node.color_ramp
        ramp.color_mode = spec["colorMode"]
        ramp.hue_interpolation = spec["hueInterpolation"]
        ramp.interpolation = spec["interpolation"]
        stops = ((0.07, (0.92, 0.12, 0.37, 0.18)),
                 (0.43, (0.14, 0.81, 0.38, 0.83)),
                 (0.91, (0.22, 0.31, 0.95, 0.41)))
        for element, (position, color) in zip(ramp.elements, (stops[0], stops[-1])):
            element.position = position
            element.color = color
        middle = ramp.elements.new(stops[1][0])
        middle.color = stops[1][1]
        if "factor" in spec:
            node.inputs["Fac"].default_value = float(spec["factor"])
        else:
            # Keep moving CONSTANT factors off exact bin boundaries: the
            # rasterizers' independently calibrated UVs differ by ~3e-5.
            # Separate fixed-factor cells prove the exact boundary itself.
            tree.links.new(_affine(tree, _uv_channel(tree, "u"), 1.273, -0.137), node.inputs["Fac"])
        tree.links.new(node.outputs["Alpha" if spec.get("alpha") else "Color"], emission.inputs["Color"])
    return build


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
            if "ior" in entry:
                ior = entry["ior"]
                if isinstance(ior, (int, float)):
                    node.inputs["Scale"].default_value = ior
                else:
                    tree.links.new(scalar_socket(ior), node.inputs["Scale"])
            return node

        entries = spec["entries"]
        if len(entries) == 1 and entries[0].get("full"):
            node = vector_math_node(entries[0])
            if entries[0].get("post"):
                _emit_vector_probe(tree, emission, node.outputs["Vector"], entries[0]["post"])
            else:
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


# --- Surface-expression cells: the CLOSURE builder constructs a real
# shader surface (Mix Shader over BSDF leaves) whose per-channel IR comes
# from tsl_ir.emit_surface; the PROJECTION builder (registered in
# BUILDERS) hand-builds the documented channel model under an Emission
# surface as the Cycles oracle.  The cell gates that emit_surface's
# algebra matches the projection numerically.

def _principled(tree, base=None, base_socket=None, roughness=None,
                alpha=None, emission=None, emission_strength=None,
                emission_strength_socket=None):
    node = tree.nodes.new("ShaderNodeBsdfPrincipled")
    if base is not None:
        node.inputs["Base Color"].default_value = tuple(base) + (1.0,)
    if base_socket is not None:
        tree.links.new(base_socket, node.inputs["Base Color"])
    if roughness is not None:
        node.inputs["Roughness"].default_value = roughness
    if alpha is not None:
        node.inputs["Alpha"].default_value = alpha
    if emission is not None:
        node.inputs["Emission Color"].default_value = tuple(emission) + (1.0,)
    if emission_strength is not None:
        node.inputs["Emission Strength"].default_value = emission_strength
    if emission_strength_socket is not None:
        tree.links.new(
            emission_strength_socket, node.inputs["Emission Strength"],
        )
    return node


def _mix_shader(tree, fac_socket, a_node, b_node,
                a_output="BSDF", b_output="BSDF"):
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(fac_socket, mix.inputs[0])
    tree.links.new(a_node.outputs[a_output], mix.inputs[1])
    tree.links.new(b_node.outputs[b_output], mix.inputs[2])
    return mix


def _clamp01_math(tree, socket):
    return _math(tree, "MINIMUM", _math(tree, "MAXIMUM", socket, 0.0), 1.0)


def closure_mix_color(tree, output):
    a = _principled(tree, base=(0.8, 0.2, 0.1))
    b = _principled(tree)
    tree.links.new(
        _rgb_input(tree, _uv_channel(tree, "u"), y_value=0.7,
                   z_socket=_uv_channel(tree, "v")),
        b.inputs["Base Color"],
    )
    fac = _affine(tree, _uv_channel(tree, "v"), 1.5, -0.25)
    mix = _mix_shader(tree, fac, a, b)
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_mix_color(tree, emission):
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "MIX"
    node.clamp_factor = True
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = (0.8, 0.2, 0.1, 1.0)
    tree.links.new(
        _rgb_input(tree, _uv_channel(tree, "u"), y_value=0.7,
                   z_socket=_uv_channel(tree, "v")),
        b_input,
    )
    tree.links.new(
        _affine(tree, _uv_channel(tree, "v"), 1.5, -0.25), factor,
    )
    result = next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def closure_mix_scalar(tree, output):
    a = _principled(tree, base=(0.5, 0.5, 0.5), roughness=0.15)
    b = _principled(tree, base=(0.5, 0.5, 0.5), roughness=0.85)
    fac = _affine(tree, _uv_channel(tree, "u"), 1.4, -0.2)
    mix = _mix_shader(tree, fac, a, b)
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_mix_scalar(tree, emission):
    fac = _clamp01_math(
        tree, _affine(tree, _uv_channel(tree, "u"), 1.4, -0.2),
    )
    # 0.15 + (0.85 - 0.15) * fac
    result = _affine(tree, fac, 0.7, 0.15)
    _emit_scalar(tree, emission, result)


def closure_transparent_alpha(tree, output):
    lit = _principled(tree, base=(0.6, 0.4, 0.2), alpha=0.9)
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    fac = _uv_channel(tree, "u")
    mix = _mix_shader(tree, fac, lit, transparent)
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_transparent_alpha(tree, emission):
    # alpha = 0.9 * (1 - u)
    visible = _math(tree, "SUBTRACT", 1.0, _uv_channel(tree, "u"))
    _emit_scalar(tree, emission, _affine(tree, visible, 0.9, 0.0))


def closure_emission_radiance(tree, output):
    glowing = tree.nodes.new("ShaderNodeEmission")
    glowing.inputs["Color"].default_value = (0.9, 0.3, 0.1, 1.0)
    glowing.inputs["Strength"].default_value = 2.5
    lit = _principled(
        tree, base=(0.2, 0.2, 0.2), emission=(0.1, 0.6, 0.9),
        emission_strength_socket=_affine(tree, _uv_channel(tree, "u"), 2.0, 0.0),
    )
    fac = _uv_channel(tree, "v")
    mix = _mix_shader(tree, fac, glowing, lit, a_output="Emission")
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_emission_radiance(tree, emission):
    # radiance lerp: mix((0.9,0.3,0.1)*2.5, (0.1,0.6,0.9)*(2u), v)
    scale = tree.nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[0].default_value = (0.1, 0.6, 0.9)
    tree.links.new(
        _affine(tree, _uv_channel(tree, "u"), 2.0, 0.0),
        scale.inputs["Scale"],
    )
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "MIX"
    node.clamp_factor = True
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = (2.25, 0.75, 0.25, 1.0)
    tree.links.new(scale.outputs["Vector"], b_input)
    tree.links.new(_uv_channel(tree, "v"), factor)
    result = next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def closure_nested_mix(tree, output):
    one = _principled(tree, base=(0.9, 0.1, 0.1))
    two = _principled(tree, base=(0.1, 0.8, 0.2))
    three = _principled(tree, base=(0.15, 0.25, 0.9))
    inner = _mix_shader(tree, _uv_channel(tree, "u"), one, two)
    outer = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(_uv_channel(tree, "v"), outer.inputs[0])
    tree.links.new(inner.outputs["Shader"], outer.inputs[1])
    tree.links.new(three.outputs["BSDF"], outer.inputs[2])
    tree.links.new(outer.outputs["Shader"], output.inputs["Surface"])


def projection_nested_mix(tree, emission):
    def color_mix(a_value, b_socket_or_value, fac_socket):
        node = tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA"
        node.blend_type = "MIX"
        node.clamp_factor = True
        factor = next(
            item for item in node.inputs if item.identifier == "Factor_Float"
        )
        a_input = next(
            item for item in node.inputs if item.identifier == "A_Color"
        )
        b_input = next(
            item for item in node.inputs if item.identifier == "B_Color"
        )
        if isinstance(a_value, tuple):
            a_input.default_value = a_value
        else:
            tree.links.new(a_value, a_input)
        if isinstance(b_socket_or_value, tuple):
            b_input.default_value = b_socket_or_value
        else:
            tree.links.new(b_socket_or_value, b_input)
        tree.links.new(fac_socket, factor)
        return next(
            item for item in node.outputs
            if item.identifier == "Result_Color"
        )

    inner = color_mix(
        (0.9, 0.1, 0.1, 1.0), (0.1, 0.8, 0.2, 1.0), _uv_channel(tree, "u"),
    )
    outer = color_mix(
        inner, (0.15, 0.25, 0.9, 1.0), _uv_channel(tree, "v"),
    )
    tree.links.new(outer, emission.inputs["Color"])


def closure_diffuse_glossy(tree, output):
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (0.7, 0.5, 0.3, 1.0)
    glossy_id = (
        "ShaderNodeBsdfAnisotropic"
        if hasattr(bpy.types, "ShaderNodeBsdfAnisotropic")
        else "ShaderNodeBsdfGlossy"
    )
    glossy = tree.nodes.new(glossy_id)
    glossy.inputs["Color"].default_value = (0.9, 0.9, 0.9, 1.0)
    glossy.inputs["Roughness"].default_value = 0.3
    mix = _mix_shader(
        tree, _uv_channel(tree, "u"), diffuse, glossy,
        a_output="BSDF", b_output="BSDF",
    )
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_diffuse_glossy(tree, emission):
    # Metallic = lerp(0, 1, clamp(u)) = u on the tile.
    _emit_scalar(tree, emission, _clamp01_math(tree, _uv_channel(tree, "u")))


def closure_coerced_color(tree, output):
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = (0.9, 0.2, 0.7, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.1, 0.8, 0.4, 1.0)
    tree.links.new(_uv_channel(tree, "u"), ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], output.inputs["Surface"])


def projection_coerced_color(tree, emission):
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = 0.15
    ramp.color_ramp.elements[0].color = (0.9, 0.2, 0.7, 1.0)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.1, 0.8, 0.4, 1.0)
    tree.links.new(_uv_channel(tree, "u"), ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], emission.inputs["Color"])


def closure_fresnel_mix(tree, output):
    a = _principled(tree, base=(0.9, 0.1, 0.1))
    b = _principled(tree, base=(0.1, 0.2, 0.9))
    fresnel = tree.nodes.new("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value = 1.45
    mix = _mix_shader(tree, fresnel.outputs["Fac"], a, b)
    tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])


def projection_fresnel_mix(tree, emission):
    fresnel = tree.nodes.new("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value = 1.45
    node = tree.nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    node.blend_type = "MIX"
    node.clamp_factor = True
    factor = next(
        item for item in node.inputs if item.identifier == "Factor_Float"
    )
    a_input = next(
        item for item in node.inputs if item.identifier == "A_Color"
    )
    b_input = next(
        item for item in node.inputs if item.identifier == "B_Color"
    )
    a_input.default_value = (0.9, 0.1, 0.1, 1.0)
    b_input.default_value = (0.1, 0.2, 0.9, 1.0)
    tree.links.new(fresnel.outputs["Fac"], factor)
    result = next(
        item for item in node.outputs if item.identifier == "Result_Color"
    )
    tree.links.new(result, emission.inputs["Color"])


def _shader_to_rgb_capture(tree, color_socket=None, color_value=None):
    diffuse = tree.nodes.new("ShaderNodeBsdfDiffuse")
    if color_socket is not None:
        tree.links.new(color_socket, diffuse.inputs["Color"])
    if color_value is not None:
        diffuse.inputs["Color"].default_value = tuple(color_value) + (1.0,)
    capture = tree.nodes.new("ShaderNodeShaderToRGB")
    tree.links.new(diffuse.outputs["BSDF"], capture.inputs["Shader"])
    return capture.outputs["Color"]


def closure_shader_to_rgb_flat(tree, output):
    captured = _shader_to_rgb_capture(
        tree,
        color_socket=_rgb_input(
            tree, _uv_channel(tree, "u"), y_value=0.7,
            z_socket=_uv_channel(tree, "v"),
        ),
    )
    tree.links.new(captured, output.inputs["Surface"])


def closure_shader_to_rgb_tilted(tree, output):
    closure_shader_to_rgb_flat(tree, output)


def closure_shader_to_rgb_ramped(tree, output):
    captured = _shader_to_rgb_capture(
        tree,
        color_socket=_rgb_input(
            tree, _uv_channel(tree, "u"),
            y_socket=_uv_channel(tree, "u"),
            z_socket=_uv_channel(tree, "u"),
        ),
    )
    separate = tree.nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    tree.links.new(captured, separate.inputs["Color"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = 0.1
    ramp.color_ramp.elements[0].color = (0.05, 0.1, 0.6, 1.0)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (0.9, 0.6, 0.1, 1.0)
    tree.links.new(separate.outputs[0], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], output.inputs["Surface"])


SURFACE_CLOSURES = {
    "shader-to-rgb-flat": closure_shader_to_rgb_flat,
    "shader-to-rgb-tilted": closure_shader_to_rgb_tilted,
    "shader-to-rgb-ramped": closure_shader_to_rgb_ramped,
    "surface-mix-color": closure_mix_color,
    "surface-mix-scalar": closure_mix_scalar,
    "surface-transparent-alpha": closure_transparent_alpha,
    "surface-emission-radiance": closure_emission_radiance,
    "surface-nested-mix": closure_nested_mix,
    "surface-diffuse-glossy": closure_diffuse_glossy,
    "surface-coerced-color": closure_coerced_color,
    "surface-fresnel-mix": closure_fresnel_mix,
}


CELL_PROXY_SETUP = {
    "vertex-color": proxy_vertex_colors,
    "attribute-fac": proxy_vertex_colors,
    "attribute-object": proxy_object_attribute,
}

# Hooks that contribute per-cell manifest fields computed while the proxy
# still exists (it is removed before the manifest entry is written).
CELL_MANIFEST_EXTRA = {
    "objectinfo-random": manifest_objectinfo_random,
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
    "map-range-smootherstep": build_map_range_smootherstep,
    "colorramp-bspline": build_colorramp_bspline,
    "colorramp-cardinal": build_colorramp_cardinal,
    "noise-2d": build_noise_2d,
    "vertex-color": build_vertex_color,
    "group-passthrough": build_group_passthrough,
    "rgb-curve": build_rgb_curve,
    "texco-object": build_texco_object,
    "texco-generated": build_texco_generated,
    "attribute-fac": build_attribute_fac,
    "attribute-object": build_attribute_object,
    "objectinfo-random": build_objectinfo_random,
    "hash-probe": build_hash_probe,
    "voronoi-rand0-probe": build_voronoi_rand0_probe,
    "noise-z-probe": build_noise_z_probe,
    "noise-detail4": build_noise_detail4,
    "noise-detail6": build_noise_detail6,
    "noise-scale80": build_noise_scale80,
    "noise-distortion": build_noise_distortion,
    "noise-distortion-color": build_noise_distortion_color,
    "vector-rotate-z": build_vector_rotate_z,
    "vector-rotate-axis-angle": build_vector_rotate_axis_angle,
    "noise-scale16": build_noise_scale16,
    "noise-scale20": build_noise_scale20,
    "noise-scale40": build_noise_scale40,
    "voronoi-scale20": build_voronoi_scale20,
    "voronoi-scale40": build_voronoi_scale40,
    "tex-image-linear": build_tex_image_linear,
    "noise-1d-detail0": build_noise_1d_detail0,
    "noise-1d": build_noise_1d,
    "noise-1d-color-distortion": build_noise_1d_color_distortion,
    "noise-4d": build_noise_4d,
    "noise-4d-color-distortion": build_noise_4d_color_distortion,
    "muted-math": build_muted_math,
    "muted-mix-color": build_muted_mix_color,
    "white-noise-1d": build_white_noise_1d,
    "white-noise-4d": build_white_noise_4d,
    "noise-effective-scale400": build_noise_effective_scale400,
    "overlay-branch-voronoi": build_overlay_branch_voronoi,
    "ambient-occlusion-passthrough": build_ambient_occlusion_passthrough,
    "mix-factor-color-ramp": build_mix_factor_color_ramp,
    "noise-texture-panel-mapping": build_noise_texture_panel_mapping,
    "noise-2d-scale200": build_noise_2d_scale200,
    "noise-3d-scale200": build_noise_3d_scale200,
    "noise-1d-scale1600": build_noise_1d_scale1600,
    "noise-2d-scale100-color": build_noise_2d_scale100_color,
    "voronoi-scale177-smoothf1": build_voronoi_scale177_smoothf1,
    "voronoi-scale155-f1-color": build_voronoi_scale155_f1_color,
    "white-noise-continuous-uv": build_white_noise_continuous_uv,
    "tex-image-cubic": build_tex_image_cubic,
    "tex-image-cubic-extend": build_tex_image_cubic_extend,
    "tex-image-closest-srgb": build_tex_image_closest_srgb,
    "tex-image-box": build_tex_image_box,
    "surface-mix-color": projection_mix_color,
    "surface-mix-scalar": projection_mix_scalar,
    "surface-transparent-alpha": projection_transparent_alpha,
    "surface-emission-radiance": projection_emission_radiance,
    "surface-nested-mix": projection_nested_mix,
    "surface-diffuse-glossy": projection_diffuse_glossy,
    "surface-coerced-color": projection_coerced_color,
    "surface-fresnel-mix": projection_fresnel_mix,
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
        # Match the graph's evaluation context to the actual native oracle,
        # before extracting engine-specific shader tables or folded values.
        engines = {item.identifier for item in bpy.context.scene.render.bl_rna.properties['engine'].enum_items}
        bpy.context.scene.render.engine = ('BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT') if 'eeveeLight' in cell or cell.get('nativeEngine') == 'EEVEE' else 'CYCLES'
        cell_id = cell["id"]
        pipeline = cell.get("pipeline", "ir")
        builder = BUILDERS.get(cell_id)
        if builder is None and "vectorTransform" in cell:
            builder = make_vector_transform_builder(cell["vectorTransform"])
        if builder is None and "hueRamp" in cell:
            builder = make_hue_ramp_builder(cell["hueRamp"])
        if builder is None and "sweep" in cell:
            builder = make_sweep_builder(cell["sweep"])
        if builder is None and "mixSweep" in cell:
            builder = make_mix_sweep_builder(cell["mixSweep"])
        if builder is None and "vectorSweep" in cell:
            builder = make_vector_sweep_builder(cell["vectorSweep"])
        if builder is None and "mappingSweep" in cell:
            builder = make_mapping_sweep_builder(cell["mappingSweep"])
        if builder is None and "genericMix" in cell:
            builder = make_generic_mix_builder(cell["genericMix"])
        if builder is None and "brickSweep" in cell:
            from brick_reference import make_brick_builder
            builder = make_brick_builder(cell["brickSweep"])
        if builder is None and "imagePrecisionControl" in cell:
            values = cell["imagePrecisionControl"]
            builder = lambda tree, emission: setattr(emission.inputs["Color"], "default_value", (*values, 1))
        if builder is None and "imageSampling" in cell:
            builder = make_image_sampling_builder(cell["imageSampling"])
        if builder is None and "clampSweep" in cell:
            builder = make_clamp_builder(cell["clampSweep"])
        if builder is None and "mapRange" in cell:
            builder = make_map_range_builder(cell["mapRange"])
        if builder is None and "eeveeLight" not in cell:
            raise SystemExit(f"reference builder missing for cell {cell_id!r}")
        if "eeveeLight" in cell:
            # EEVEE-oracle cells (captured lighting): the closure graph
            # provides BOTH the IR (emit_surface) and the reference (an
            # EEVEE ortho render under the fixed-light contract) —
            # Cycles cannot evaluate Shader to RGB at all.
            closure_builder = SURFACE_CLOSURES[cell_id]
            closure_material = bpy.data.materials.new(f"CELL {cell_id}")
            try:
                closure_tree = bakelib.ensure_shader_node_tree(
                    closure_material,
                )
                closure_tree.nodes.clear()
                closure_output = closure_tree.nodes.new(
                    "ShaderNodeOutputMaterial",
                )
                closure_builder(closure_tree, closure_output)
                surface_document = tsl_ir.emit_surface(closure_tree)
                document = surface_document["channels"][
                    cell["surface"]["channel"]
                ]
                ir_path = ir_output / f"{cell_id}.json"
                ir_path.write_text(
                    json.dumps(document, indent=2) + "\n", encoding="utf8",
                )
                result = render_eevee_reference(
                    closure_material, cell["eeveeLight"],
                )
            finally:
                bpy.data.materials.remove(closure_material, do_unlink=True)
            pixels = np.asarray(result["pixels"], dtype=np.float32)
            path = OUTPUT / f"{cell_id}.f32"
            pixels.tofile(path)
            manifest["cells"][cell_id] = {
                "path": path.name,
                "pipeline": "ir",
                "ir": f"ir/{cell_id}.json",
                "shape": list(pixels.shape),
                "rgbMin": list(result["rgbMin"]),
                "rgbMax": list(result["rgbMax"]),
                "deviceClass": result["deviceClass"],
                "backend": result["backend"],
            }
            print(f"tsl differential reference: {cell_id} rendered (eevee)")
            continue

        material = emission_material(f"CELL {cell_id}", builder)
        ir_path = None
        try:
            if "surface" in cell:
                # Surface cells: the IR comes from emit_surface over a REAL
                # closure graph; the baked material is the hand-built
                # projection (the documented channel model) — the cell
                # gates that the emitted algebra matches the projection.
                closure_builder = SURFACE_CLOSURES[cell_id]
                closure_material = bpy.data.materials.new(
                    f"SURF {cell_id}",
                )
                try:
                    closure_tree = bakelib.ensure_shader_node_tree(
                        closure_material,
                    )
                    closure_tree.nodes.clear()
                    closure_output = closure_tree.nodes.new(
                        "ShaderNodeOutputMaterial",
                    )
                    closure_builder(closure_tree, closure_output)
                    surface_document = tsl_ir.emit_surface(closure_tree)
                    document = surface_document["channels"][
                        cell["surface"]["channel"]
                    ]
                finally:
                    bpy.data.materials.remove(
                        closure_material, do_unlink=True,
                    )
                ir_path = ir_output / f"{cell_id}.json"
                ir_path.write_text(
                    json.dumps(document, indent=2) + "\n", encoding="utf8",
                )
            elif pipeline == "ir":
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
            manifest_extra = {}
            if cell.get("nativeEngine") == "EEVEE":
                result = render_eevee_reference(material, {"strength": 0})
            else:
                proxy = bakelib.uv_tile_proxy([], window=(0.0, 0.0, 1.0, 1.0))
                try:
                    setup = CELL_PROXY_SETUP.get(cell_id)
                    if setup is not None:
                        setup(proxy)
                    extra_hook = CELL_MANIFEST_EXTRA.get(cell_id)
                    if extra_hook is not None:
                        manifest_extra = extra_hook(proxy)
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
            **manifest_extra,
        }
        print(f"tsl differential reference: {cell_id} baked ({pipeline})")
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf8",
    )
    print("BLENDLINK_TSL_DIFFERENTIAL_REFERENCE_DONE")


if __name__ == "__main__":
    main()
