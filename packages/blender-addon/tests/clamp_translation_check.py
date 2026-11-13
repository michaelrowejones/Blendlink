# SPDX-License-Identifier: GPL-3.0-or-later
"""Both Clamp menus retain static and live operands without editing the graph."""
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir

material = bpy.data.materials.new("Clamp extraction")
material.use_nodes = True
tree = material.node_tree
target = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
clamp = tree.nodes.new("ShaderNodeClamp")
coordinate = tree.nodes.new("ShaderNodeTexCoord")
separate = tree.nodes.new("ShaderNodeSeparateXYZ")
tree.links.new(coordinate.outputs["UV"], separate.inputs[0])
tree.links.new(clamp.outputs[0], target.inputs["Roughness"])
clamp.inputs["Min"].default_value = 1
clamp.inputs["Max"].default_value = -1
for mode in ("MINMAX", "RANGE"):
    clamp.clamp_type = mode
    for linked in (False, True):
        if linked:
            for index, socket in enumerate(clamp.inputs):
                tree.links.new(separate.outputs[index], socket)
        before = (len(tree.nodes), len(tree.links), len(bpy.data.node_groups),
                  [socket.default_value for socket in clamp.inputs])
        document = tsl_ir.emit_channel(target.inputs["Roughness"])
        json.dumps(document, allow_nan=False)
        expression = document["output"]
        assert expression["op"] == "clamp_minmax"
        if mode == "RANGE":
            assert expression["min"]["operation"] == "MINIMUM"
            assert expression["max"]["operation"] == "MAXIMUM"
            if linked:
                assert expression["min"]["a"]["op"] == "separate"
                assert expression["min"]["b"]["op"] == "separate"
        else:
            assert expression["min"]["op"] == ("separate" if linked else "const_float")
        assert before == (len(tree.nodes), len(tree.links), len(bpy.data.node_groups),
                          [socket.default_value for socket in clamp.inputs])
        for socket in clamp.inputs:
            for link in list(socket.links):
                tree.links.remove(link)
print("BLENDLINK_CLAMP_TRANSLATION_CHECK_PASSED both menus, live bounds and read-only extraction")
