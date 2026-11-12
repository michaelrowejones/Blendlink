# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Float/Vector Mix stays live without accepting quaternion math."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

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


material = bpy.data.materials.new("Native Mix Translation")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
output = tree.nodes.new("ShaderNodeEmission")
mix = tree.nodes.new("ShaderNodeMix")
coord = tree.nodes.new("ShaderNodeTexCoord")
for kind, suffix in (("FLOAT", "Float"), ("VECTOR", "Vector")):
    mix.data_type = kind
    for mode in ("UNIFORM", "NON_UNIFORM"):
        mix.factor_mode = mode
        result = next(socket for socket in mix.outputs if socket.identifier == f"Result_{suffix}")
        tree.links.new(result, output.inputs["Color"])
        document = tsl_ir.emit_channel(output.inputs["Color"])
        expect(document["output"]["op"] == "math", f"{kind}/{mode} was not lowered to live arithmetic")
        expect(document["output"]["operation"] == "MULTIPLY_ADD", "Mix interpolation algebra was lost")
        factor = document["output"]["b"]
        expect(factor["op"] == "clamp01", "Native factor clamp was lost")
        mix.clamp_factor = False
        unclamped = tsl_ir.emit_channel(output.inputs["Color"])
        expect(unclamped["output"]["b"]["op"] != "clamp01", "Unclamped native Mix was silently clamped")
        mix.clamp_factor = True

mix.data_type = "VECTOR"
mix.factor_mode = "UNIFORM"
sockets = {socket.identifier: socket for socket in mix.inputs}
value = tree.nodes.new("ShaderNodeValue")
value.outputs["Value"].default_value = 0.37
tree.links.new(value.outputs["Value"], sockets["A_Vector"])
vector_result = next(socket for socket in mix.outputs if socket.identifier == "Result_Vector")
tree.links.new(vector_result, output.inputs["Color"])
document = tsl_ir.emit_channel(output.inputs["Color"])
expect('"op": "combine"' in json.dumps(document), "Scalar-to-Vector input did not emit an explicit broadcast")
wrong_output = next(socket for socket in mix.outputs if socket.identifier == "Result_Float")
refusal(lambda: tsl_ir.emit_output(mix, wrong_output), "inactive output")
# Rotation is not available on ShaderNodeMix in this shader-tree context,
# even when global RNA enum_items lists it. Keep unknown future types closed.
refusal(lambda: tsl_ir.emit_output(SimpleNamespace(bl_idname="ShaderNodeMix", data_type="ROTATION"),
                                 SimpleNamespace(name="Result", identifier="Result_Rotation")),
        "Mix data type 'ROTATION'")
mix.data_type = "FLOAT"
float_a = next(socket for socket in mix.inputs if socket.identifier == "A_Float")
tree.links.new(coord.outputs["UV"], float_a)
float_result = next(socket for socket in mix.outputs if socket.identifier == "Result_Float")
tree.links.new(float_result, output.inputs["Color"])
refusal(lambda: tsl_ir.emit_channel(output.inputs["Color"]), "vector-to-float")
bpy.data.materials.remove(material)
print("BLENDLINK_MIX_TRANSLATION_PASSED native scalar/vector modes, factors, broadcast and named refusals")
