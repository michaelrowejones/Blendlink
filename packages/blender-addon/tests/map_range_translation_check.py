# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Map Range mode coverage keeps dynamic/negative step bounds closed."""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def refusal(work, message):
    try:
        work()
    except tsl_ir.TslIrRefusal as error:
        expect(message in str(error), f"Expected {message!r}, got {error}")
    else:
        raise AssertionError(f"Expected refusal naming {message!r}")


material = bpy.data.materials.new("Native Map Range Translation")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
node = tree.nodes.new("ShaderNodeMapRange")
emission = tree.nodes.new("ShaderNodeEmission")
coord = tree.nodes.new("ShaderNodeTexCoord")
for kind in ("FLOAT", "FLOAT_VECTOR"):
    node.data_type = kind
    result = next(socket for socket in node.outputs if socket.identifier == ("Vector" if kind == "FLOAT_VECTOR" else "Result"))
    tree.links.new(result, emission.inputs["Color"])
    for interpolation in ("LINEAR", "STEPPED", "SMOOTHSTEP", "SMOOTHERSTEP"):
        node.interpolation_type = interpolation
        document = tsl_ir.emit_channel(emission.inputs["Color"])
        expect(document["output"]["dataType"] == kind, "Native range data type was lost")
        expect(document["output"]["interpolation"] == interpolation, "Native range shaping was lost")
        if interpolation == "STEPPED":
            expect("steps" in document["output"], "Native step count was lost")
    node.interpolation_type = "STEPPED"
    sockets = {socket.identifier: socket for socket in node.inputs}
    steps = sockets["Steps_FLOAT3" if kind == "FLOAT_VECTOR" else "Steps"]
    if kind == "FLOAT_VECTOR":
        link = tree.links.new(coord.outputs["UV"], steps)
    else:
        separate = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
        link = tree.links.new(separate.outputs["X"], steps)
    refusal(lambda: tsl_ir.emit_channel(emission.inputs["Color"]), "dynamic Steps")
    tree.links.remove(link)
    value = tree.nodes.new("ShaderNodeValue")
    value.outputs["Value"].default_value = -1.0
    link = tree.links.new(value.outputs["Value"], steps)
    refusal(lambda: tsl_ir.emit_channel(emission.inputs["Color"]), "finite nonnegative Steps")
    tree.links.remove(link)
    value.outputs["Value"].default_value = 0.0
    link = tree.links.new(value.outputs["Value"], steps)
    document = tsl_ir.emit_channel(emission.inputs["Color"])
    expect(document["output"]["steps"]["op"] == ("const_vec3" if kind == "FLOAT_VECTOR" else "const_float"),
           "Static group-safe zero steps were not folded into the bounded IR")
    tree.links.remove(link)

bpy.data.materials.remove(material)
print("BLENDLINK_MAP_RANGE_TRANSLATION_PASSED scalar/vector native modes, static zero steps and named bounds")
