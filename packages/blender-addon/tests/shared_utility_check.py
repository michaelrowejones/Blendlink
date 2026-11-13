# SPDX-License-Identifier: GPL-3.0-or-later
"""Real shared-node extraction and native spatial integer/boolean references."""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compositor_reference import NativeCompositorReference
import tsl_ir


def shader_check():
    tree = bpy.data.node_groups.new("Typed shader utility regression", "ShaderNodeTree")
    boolean, integer = tree.nodes.new("FunctionNodeInputBool"), tree.nodes.new("FunctionNodeInputInt")
    boolean.boolean = True
    integer.integer = 2147483647
    assert tsl_ir.emit_output(boolean, boolean.outputs[0]) == {"op": "typed_const", "type": "BOOLEAN", "value": True}
    assert tsl_ir.emit_output(integer, integer.outputs[0]) == {"op": "typed_const", "type": "INT", "value": 2147483647}
    assert integer.outputs[0].default_value != integer.integer, "Test must exercise the authored node property"
    if bpy.app.version >= (5, 3, 0):
        math = tree.nodes.new("FunctionNodeIntegerMath")
        math.operation = "ADD"
        tree.links.new(integer.outputs[0], math.inputs[0])
        math.inputs[1].default_value = 1
        ir = tsl_ir.emit_output(math, math.outputs[0])
        assert ir["op"] == "integer_math" and ir["a"]["value"] == 2147483647 and ir["b"]["value"] == 1, ir
        boolean_math = tree.nodes.new("FunctionNodeBooleanMath")
        boolean_math.operation = "NOT"
        tree.links.new(integer.outputs[0], boolean_math.inputs[0])
        ir = tsl_ir.emit_output(boolean_math, boolean_math.outputs[0])
        assert ir["a"]["op"] == "typed_convert" and ir["a"]["fromType"] == "INT", ir
        tree.links.remove(math.inputs[0].links[0])
        math.operation = "DIVIDE_ROUND"; math.inputs[0].default_value = 2147483647; math.inputs[1].default_value = 2
        try: tsl_ir.emit_output(math, math.outputs[0])
        except tsl_ir.TslIrRefusal as error: assert "intermediate range" in str(error), str(error)
        else: raise AssertionError("Undefined native Round overflow must refuse")
        math.operation = "LCM"; math.inputs[0].default_value = -2147483648; math.inputs[1].default_value = 2
        try: tsl_ir.emit_output(math, math.outputs[0])
        except tsl_ir.TslIrRefusal as error: assert "INT_MIN" in str(error), str(error)
        else: raise AssertionError("Undefined native LCM domain must refuse")
    # Typed conversion also survives the entry and exit of an authored group.
    tree.interface.new_socket(name="Integer", in_out="INPUT", socket_type="NodeSocketInt")
    tree.interface.new_socket(name="Boolean", in_out="OUTPUT", socket_type="NodeSocketBool")
    bpy.data.node_groups.remove(tree)


def main(output):
    if bpy.app.version < (5, 2, 0):
        print("BLENDLINK_SHARED_UTILITY_OK " + json.dumps({"blender": bpy.app.version_string, "creatable": False}))
        return
    shader_check()
    pixels = np.zeros((8, 8, 4), dtype=np.float32)
    pixels[..., 0] = np.resize(np.asarray([-7.75, -2.5, -1, -0.25, 0, 0.5, 2.5, 7.75], np.float32), (8, 8))
    pixels[..., 1] = np.resize(np.asarray([3.75, -3, 0, 1, 0.125, -1.25, 4, 2], np.float32), (8, 8))
    pixels[..., 2] = np.resize(np.asarray([2, 0, -1, 3, 0, -4, 1, 5], np.float32), (8, 8))
    pixels[..., 3] = np.resize(np.asarray([0, 0.125, 0.5, 1, -0.5, 1.5, 0, 1], np.float32), (8, 8))
    native = NativeCompositorReference(output, device=os.environ.get("BLENDLINK_SHARED_UTILITY_DEVICE", "CPU"),
                                       name="Shared typed utility references", pixels=pixels)
    tree = native.tree
    def scalar(value, kind="INT"):
        node = tree.nodes.new("FunctionNodeInputBool" if kind == "BOOLEAN" else "FunctionNodeInputInt")
        if kind == "BOOLEAN": node.boolean = value
        else: node.integer = value
        return node.outputs[0]
    def reset():
        sink, source = native.reset()
        separate = native.separate(source.outputs["Image"])
        return sink, source, separate
    def finish(label, sink, source, socket):
        tree.links.new(socket, sink.inputs[0])
        native.save(label, source)
    for kind, values in [("BOOLEAN", [False, True]), ("INT", [-2147483648, -16777217, -1, 0, 1, 16777217, 2147483647])]:
        for val in values:
            sink, source, _ = reset()
            finish("input-" + kind.lower() + "-" + str(val), sink, source, scalar(val, kind))
    if bpy.app.version < (5, 3, 0):
        native.finish("BLENDLINK_SHARED_UTILITY_OK")
        return
    for operation in ["AND", "OR", "NOT", "XOR", "XNOR", "NAND", "NOR", "IMPLY", "NIMPLY"]:
        sink, source, separate = reset()
        node = tree.nodes.new("FunctionNodeBooleanMath"); node.operation = operation
        tree.links.new(separate.outputs[0], node.inputs[0])
        if operation != "NOT": tree.links.new(separate.outputs[1], node.inputs[1])
        finish("boolean-" + operation.lower() + "-spatial", sink, source, node.outputs[0])
        for a, b in [(False, False), (False, True), (True, False), (True, True)]:
            sink, source, _ = reset()
            node = tree.nodes.new("FunctionNodeBooleanMath"); node.operation = operation
            tree.links.new(scalar(a, "BOOLEAN"), node.inputs[0])
            if operation != "NOT": tree.links.new(scalar(b, "BOOLEAN"), node.inputs[1])
            finish("boolean-" + operation.lower() + "-" + str(int(a)) + str(int(b)), sink, source, node.outputs[0])
    for operation in ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MULTIPLY_ADD", "ABSOLUTE", "NEGATE", "POWER", "MINIMUM", "MAXIMUM", "SIGN", "DIVIDE_ROUND", "DIVIDE_FLOOR", "DIVIDE_CEIL", "FLOORED_MODULO", "MODULO", "GCD", "LCM"]:
        sink, source, separate = reset()
        node = tree.nodes.new("FunctionNodeIntegerMath"); node.operation = operation
        active = [s for s in node.inputs if s.enabled and not getattr(s, "is_unavailable", False)]
        for incoming, channel in zip(active, separate.outputs):
            if operation in {"DIVIDE_ROUND", "LCM"}:
                bounded = tree.nodes.new("ShaderNodeClamp"); bounded.inputs["Min"].default_value = -10000; bounded.inputs["Max"].default_value = 10000
                tree.links.new(channel, bounded.inputs[0]); channel = bounded.outputs[0]
            tree.links.new(channel, incoming)
        finish("integer-" + operation.lower() + "-spatial", sink, source, node.outputs[0])
        for case, values in enumerate([(2147483647, 2, 11), (-2147483648, -1, 1), (50000, 50000, -50000), (-2, -3, 4), (2147483600, 2147483600, 1)]):
            if operation == "LCM" and values[0] == -2147483648: continue  # Native C++ std::lcm has undefined INT_MIN domain.
            if operation == "DIVIDE_ROUND" and case in {0, 1, 4}: continue  # Explicitly refused signed-overflow domain.
            sink, source, separate = reset()
            node = tree.nodes.new("FunctionNodeIntegerMath"); node.operation = operation
            active = [s for s in node.inputs if s.enabled and not getattr(s, "is_unavailable", False)]
            for index, (incoming, number) in enumerate(zip(active, values)):
                value = scalar(number)
                if case == 4:
                    varying = tree.nodes.new("FunctionNodeIntegerMath"); varying.operation = "ADD"
                    tree.links.new(value, varying.inputs[0])
                    bounded = tree.nodes.new("ShaderNodeClamp"); bounded.inputs["Min"].default_value = -10; bounded.inputs["Max"].default_value = 10
                    tree.links.new(separate.outputs[index], bounded.inputs[0]); tree.links.new(bounded.outputs[0], varying.inputs[1])
                    value = varying.outputs[0]
                tree.links.new(value, incoming)
            # Observe low integer bits before float image transport rounds large results.
            digits = tree.nodes.new("FunctionNodeIntegerMath"); digits.operation = "MODULO"
            tree.links.new(node.outputs[0], digits.inputs[0]); digits.inputs[1].default_value = 251
            finish("integer-" + operation.lower() + "-boundary-" + str(case), sink, source, digits.outputs[0])
    operations = ["LESS_THAN", "LESS_EQUAL", "GREATER_THAN", "GREATER_EQUAL", "EQUAL", "NOT_EQUAL"]
    for integer in [-2147483648, -1, 0, 1, 2147483647]:
        sink, source, _ = reset()
        node = tree.nodes.new("FunctionNodeBooleanMath"); node.operation = "NOT"
        tree.links.new(scalar(integer), node.inputs[0])
        finish("int-to-bool-" + str(integer), sink, source, node.outputs[0])
    for data_type in ["FLOAT", "INT", "VECTOR", "RGBA"]:
        modes = ["ELEMENT", "AVERAGE", "LENGTH", "DOT_PRODUCT", "DIRECTION"] if data_type == "VECTOR" else ["ELEMENT"]
        for mode in modes:
            for operation in (["EQUAL", "NOT_EQUAL", "BRIGHTER", "DARKER"] if data_type == "RGBA" else operations):
                sink, source, separate = reset()
                node = tree.nodes.new("FunctionNodeCompare"); node.data_type = data_type; node.mode = mode; node.operation = operation
                active = [s for s in node.inputs if s.enabled and not getattr(s, "is_unavailable", False)]
                for index, incoming in enumerate(active):
                    if incoming.identifier == "A": tree.links.new(source.outputs["Image"] if data_type in {"VECTOR", "RGBA"} else separate.outputs[0], incoming)
                    elif incoming.identifier == "B": incoming.default_value = (0.25, -0.5, 0.75, 0.125) if data_type == "RGBA" else (0.25, -0.5, 0.75) if data_type == "VECTOR" else 0
                    elif incoming.identifier == "Epsilon": incoming.default_value = 0.125
                    elif incoming.identifier == "C": incoming.default_value = 0.25
                    elif incoming.identifier == "Angle": incoming.default_value = 1.5
                finish("compare-" + data_type.lower() + "-" + mode.lower() + "-" + operation.lower(), sink, source, node.outputs[0])
    for data_type in ["STRING", "OBJECT", "FONT"]:
        for operation in ["EQUAL", "NOT_EQUAL"]:
            for different in [False, True]:
                sink, source, _ = reset()
                node = tree.nodes.new("FunctionNodeCompare"); node.data_type = data_type; node.operation = operation
                if data_type == "STRING": node.inputs["A"].default_value = "café 🪴"; node.inputs["B"].default_value = "different" if different else "café 🪴"
                if data_type == "OBJECT":
                    objects = list(bpy.data.objects)
                    node.inputs["A"].default_value = objects[0]; node.inputs["B"].default_value = objects[1] if different else objects[0]
                if data_type == "FONT" and different: continue  # No portable externalfont dependency in this fixture.
                finish("compare-" + data_type.lower() + "-" + operation.lower() + "-" + str(different).lower(), sink, source, node.outputs[0])
    for operation in ["EQUAL", "NOT_EQUAL"]:
        sink, source, _ = reset()
        node = tree.nodes.new("FunctionNodeCompare"); node.data_type = "RGBA"; node.operation = operation
        node.inputs["A"].default_value = (.25, .5, .75, 0); node.inputs["B"].default_value = (.25, .5, .75, 1)
        finish("compare-rgba-ignored-alpha-" + operation.lower(), sink, source, node.outputs[0])
    for index, vectors in enumerate([((0, 0, 0), (0, 0, 0)), ((0, 0, 0), (1, 0, 0)), ((1, 0, 0), (-1, 0, 0)), ((1, 0, 0), (1, 0, 0)), ((.0001, 0, 0), (1, .00001, 0))]):
        for operation in operations:
            sink, source, _ = reset()
            node = tree.nodes.new("FunctionNodeCompare"); node.data_type = "VECTOR"; node.mode = "DIRECTION"; node.operation = operation
            node.inputs["A"].default_value = vectors[0]; node.inputs["B"].default_value = vectors[1]
            node.inputs["Angle"].default_value = 0 if index in {0, 3, 4} else 1.5
            if "Epsilon" in node.inputs: node.inputs["Epsilon"].default_value = .0001
            finish("compare-direction-boundary-" + str(index) + "-" + operation.lower(), sink, source, node.outputs[0])
    native.finish("BLENDLINK_SHARED_UTILITY_OK")


output = os.environ.get("BLENDLINK_SHARED_UTILITY_REFERENCES")
if output:
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-shared-utilities-") as temporary:
        main(temporary)
