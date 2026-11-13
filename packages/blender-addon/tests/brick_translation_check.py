# SPDX-License-Identifier: GPL-3.0-or-later
"""Brick transport keeps linked controls and refuses undefined dimensions."""
import json
import sys
from pathlib import Path

import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir

material = bpy.data.materials.new("Brick extraction")
material.use_nodes = True
tree = material.node_tree
principled = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
node = tree.nodes.new("ShaderNodeTexBrick")
tree.links.new(node.outputs["Color"], principled.inputs["Base Color"])
before = (len(tree.nodes), len(tree.links), len(bpy.data.node_groups))
document = tsl_ir.emit_channel(principled.inputs["Base Color"])
assert document["output"]["op"] == "tex_brick", document
assert document["output"]["output"] == "color"
assert before == (len(tree.nodes), len(tree.links), len(bpy.data.node_groups))
json.dumps(document, allow_nan=False)
node.inputs["Brick Width"].default_value = 0
try:
    tsl_ir.emit_channel(principled.inputs["Base Color"])
    raise AssertionError("Undefined native zero width silently shipped")
except tsl_ir.TslIrRefusal as error:
    assert "positive dimension" in str(error)
node.inputs["Brick Width"].default_value = 0.5
coordinate = tree.nodes.new("ShaderNodeTexCoord")
separate = tree.nodes.new("ShaderNodeSeparateXYZ")
tree.links.new(coordinate.outputs["UV"], separate.inputs[0])
bounded = tree.nodes.new("ShaderNodeMath")
bounded.operation = "MAXIMUM"
tree.links.new(separate.outputs[0], bounded.inputs[0])
bounded.inputs[1].default_value = .125
tree.links.new(bounded.outputs[0], node.inputs["Brick Width"])
document = tsl_ir.emit_channel(principled.inputs["Base Color"])
assert document["output"]["brickWidth"]["op"] == "math"
tree.links.new(separate.outputs[0], node.inputs["Brick Width"])
try:
    tsl_ir.emit_channel(principled.inputs["Base Color"])
    raise AssertionError("An unbounded linked width silently claimed a positive domain")
except tsl_ir.TslIrRefusal as error:
    assert "positive dimension" in str(error)
print("BLENDLINK_BRICK_TRANSLATION_CHECK_PASSED live inputs, read-only extraction and explicit dimension limits")
