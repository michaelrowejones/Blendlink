# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native Brick graphs for the shared shader differential harness."""
import bpy
import numpy as np


def make_brick_builder(spec):
    def build(tree, emission):
        coordinate = tree.nodes.new("ShaderNodeTexCoord")
        # Bake rasterization nudges barycentric UVs by up to3.2e-5. Mortar
        # edges amplify that positional error. An exact nearest-sampled UV
        # image supplies identical inputs to both evaluators, isolating the
        # Brick algorithm without changing either production implementation.
        image = bpy.data.images.new("Brick exact input coordinates", width=64, height=64,
                                    alpha=True, float_buffer=True)
        image.colorspace_settings.name = "Non-Color"
        pixels = np.ones((64, 64, 4), np.float32)
        pixels[:, :, 0] = (np.arange(64, dtype=np.float32) + 0.5)[None, :] / 64
        pixels[:, :, 1] = (np.arange(64, dtype=np.float32) + 0.5)[:, None] / 64
        pixels[:, :, 2] = 0
        image.pixels.foreach_set(pixels.ravel())
        source = tree.nodes.new("ShaderNodeTexImage")
        source.image = image
        source.interpolation = "Closest"
        tree.links.new(coordinate.outputs["UV"], source.inputs["Vector"])
        separate = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(source.outputs["Color"], separate.inputs[0])
        transform = tree.nodes.new("ShaderNodeVectorMath")
        transform.operation = "MULTIPLY_ADD"
        tree.links.new(source.outputs["Color"], transform.inputs[0])
        transform.inputs[1].default_value = tuple(spec.get("coordinateScale", [1.37, 1.61, 1]))
        transform.inputs[2].default_value = tuple(spec.get("coordinateOffset", [-0.173, -0.237, 0]))
        node = tree.nodes.new("ShaderNodeTexBrick")
        tree.links.new(transform.outputs[0], node.inputs["Vector"])
        node.inputs["Color1"].default_value = (0.15, 0.3, 0.8, 1)
        node.inputs["Color2"].default_value = (1.1, 0.05, 0.12, 1)
        node.inputs["Mortar"].default_value = (0.08, 0.11, 0.17, 1)
        for name, value in spec.get("inputs", {}).items():
            node.inputs[name].default_value = value
        for name, value in spec.get("properties", {}).items():
            setattr(node, name, value)
        if "constantCoordinate" in spec:
            constant = tree.nodes.new("ShaderNodeCombineXYZ")
            for axis, value in enumerate(spec["constantCoordinate"]):
                constant.inputs[axis].default_value = value
            tree.links.new(constant.outputs[0], node.inputs["Vector"])
        for name, values in spec.get("live", {}).items():
            axis, scale, offset = values
            affine = tree.nodes.new("ShaderNodeMath")
            affine.operation = "MULTIPLY_ADD"
            tree.links.new(separate.outputs[axis], affine.inputs[0])
            affine.inputs[1].default_value = scale
            affine.inputs[2].default_value = offset
            incoming = affine.outputs[0]
            if name in spec.get("positiveMinimum", {}):
                bounded = tree.nodes.new("ShaderNodeMath")
                bounded.operation = "MAXIMUM"
                tree.links.new(incoming, bounded.inputs[0])
                bounded.inputs[1].default_value = spec["positiveMinimum"][name]
                incoming = bounded.outputs[0]
            tree.links.new(incoming, node.inputs[name])
        if spec.get("positionControl"):
            scaled = tree.nodes.new("ShaderNodeVectorMath")
            scaled.operation = "SCALE"
            tree.links.new(node.inputs["Vector"].links[0].from_socket, scaled.inputs[0])
            if node.inputs["Scale"].is_linked:
                tree.links.new(node.inputs["Scale"].links[0].from_socket, scaled.inputs["Scale"])
            else:
                scaled.inputs["Scale"].default_value = node.inputs["Scale"].default_value
            encoded = tree.nodes.new("ShaderNodeVectorMath")
            encoded.operation = "ADD"
            tree.links.new(scaled.outputs[0], encoded.inputs[0])
            encoded.inputs[1].default_value = (2, 2, 2)
            tree.links.new(encoded.outputs[0], emission.inputs["Color"])
            return
        output = node.outputs[spec.get("output", "Color")]
        if spec.get("signedColor") and spec.get("output", "Color") == "Color":
            # The production isolated bake rejects negative radiance. Encode
            # this test signal after the native node, and export that same
            # graph, so negative Brick colors still have a native oracle.
            encode = tree.nodes.new("ShaderNodeVectorMath")
            encode.operation = "MULTIPLY_ADD"
            tree.links.new(output, encode.inputs[0])
            encode.inputs[1].default_value = (0.25, 0.25, 0.25)
            encode.inputs[2].default_value = (0.5, 0.5, 0.5)
            output = encode.outputs[0]
        tree.links.new(output, emission.inputs["Color"])
    return build
