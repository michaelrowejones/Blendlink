# SPDX-License-Identifier: GPL-3.0-or-later
"""Native vector mode completeness, active sockets and transform safety."""
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


material = bpy.data.materials.new("Native Vector Completeness")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
node = tree.nodes.new("ShaderNodeVectorMath")
available = []
for item in node.bl_rna.properties["operation"].enum_items:
    if not item.identifier:
        continue
    try:
        node.operation = item.identifier
    except (TypeError, ValueError):
        continue
    available.append(item.identifier)
    if item.identifier in {"REFLECT", "REFRACT"}:
        node.inputs[1].default_value = (0, 1, 0)
    output = "Value" if item.identifier in tsl_ir._VECTOR_MATH_VALUE_OUTPUT else "Vector"
    active = next(socket for socket in node.outputs if socket.identifier == output)
    expression = tsl_ir.emit_output(node, active)
    expect(expression["op"] in {"vector_math", "vector_scale"}, f"Native operation {item.identifier} was not ported")
    inactive = next((socket for socket in node.outputs if socket.identifier != output), None)
    if inactive is not None:
        refusal(lambda: tsl_ir.emit_output(node, inactive), "inactive output")
if "POWER" in available:
    node.operation = "POWER"
    node.inputs[0].default_value = (0, 1, 2)
    node.inputs[1].default_value = (-1, 1, 2)
    refusal(lambda: tsl_ir.emit_output(node, node.outputs["Vector"]), "zero base with a negative exponent")
for operation in ("REFLECT", "REFRACT"):
    node.operation = operation
    node.inputs[1].default_value = (0, 0, 0)
    if bpy.app.version < (5, 2, 0):
        refusal(lambda: tsl_ir.emit_output(node, node.outputs["Vector"]), "provably nonzero normal")
    else:
        expression = tsl_ir.emit_output(node, node.outputs["Vector"])
        expect(expression["normalMode"] == "safe-zero", "Modern normal model was lost")
rotate = tree.nodes.new("ShaderNodeVectorRotate")
coord = tree.nodes.new("ShaderNodeTexCoord")
for mode in ("AXIS_ANGLE", "X_AXIS", "Y_AXIS", "Z_AXIS", "EULER_XYZ"):
    rotate.rotation_type = mode
    for inverse in (False, True):
        rotate.invert = inverse
        link = tree.links.new(coord.outputs["UV"], rotate.inputs["Center"])
        expression = tsl_ir.emit_output(rotate, rotate.outputs["Vector"])
        expect(expression["rotationType"] == mode and expression["invert"] == inverse, "Native rotate mode was lost")
        expect(expression["centerNode"]["op"] == "uv", "Linked center was flattened")
        if mode == "EULER_XYZ":
            expect("rotation" in expression and "angle" not in expression, "Euler read inactive axis/angle sockets")
        tree.links.remove(link)
# A live transform is safe as a vector but not an unmeasured Noise frequency.
rotate.rotation_type = "EULER_XYZ"
tree.links.new(coord.outputs["UV"], rotate.inputs["Rotation"])
noise = tree.nodes.new("ShaderNodeTexNoise")
noise.inputs["Detail"].default_value = 0
noise.inputs["Scale"].default_value = 2
tree.links.new(rotate.outputs["Vector"], noise.inputs["Vector"])
refusal(lambda: tsl_ir.emit_output(noise, noise.outputs.get("Fac") or noise.outputs.get("Factor")), "coordinate-frequency bound")
bpy.data.materials.remove(material)
print("BLENDLINK_VECTOR_TRANSLATION_PASSED " + bpy.app.version_string + " native_operations=" + ",".join(available))
