# SPDX-License-Identifier: GPL-3.0-or-later
"""Typed shared-node transport. Values stay integer/boolean across group links."""
import math

UTILITY_NODES = {
    "FunctionNodeInputBool", "FunctionNodeInputInt", "FunctionNodeBooleanMath", "FunctionNodeIntegerMath",
}
BOOLEAN_OPERATIONS = {"AND", "OR", "NOT", "XOR", "XNOR", "NAND", "NOR", "IMPLY", "NIMPLY"}
INTEGER_OPERATIONS = {"ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MULTIPLY_ADD", "ABSOLUTE", "NEGATE", "POWER",
                      "MINIMUM", "MAXIMUM", "SIGN", "DIVIDE_ROUND", "DIVIDE_FLOOR", "DIVIDE_CEIL",
                      "FLOORED_MODULO", "MODULO", "GCD", "LCM"}


def typed_constant(socket, refuse):
    kind = socket.type
    value = getattr(socket, "default_value", None)
    if kind == "BOOLEAN" and isinstance(value, bool):
        return {"op": "typed_const", "type": "BOOLEAN", "value": value}
    if kind == "INT" and isinstance(value, int) and -2147483648 <= value <= 2147483647:
        return {"op": "typed_const", "type": "INT", "value": value}
    refuse("invalid typed utility constant " + kind)


def convert(expression, from_type, to_type, refuse):
    if from_type == to_type:
        return expression
    allowed = {
        "BOOLEAN": {"INT", "VALUE", "VECTOR", "RGBA"},
        "INT": {"BOOLEAN", "VALUE", "VECTOR", "RGBA"},
        "VALUE": {"BOOLEAN", "INT"},
    }
    if to_type not in allowed.get(from_type, set()):
        refuse("unverified typed utility conversion " + from_type + " to " + to_type)
    if from_type == "VALUE" and to_type == "INT" and expression.get("op") == "const_float":
        number = expression["value"]
        if not math.isfinite(number) or number < -2147483648 or number > 2147483520:
            refuse("float-to-integer conversion requires a finite value in the native int32 domain")
    return {"op": "typed_convert", "fromType": from_type, "toType": to_type, "input": expression}


def constant_expression(expression):
    if expression.get("op") in {"typed_const", "const_float", "const_vec3"}:
        return True
    if expression.get("op") not in {"typed_convert", "integer_math", "boolean_math", "math", "combine", "clamp01", "clamp_minmax"}:
        return False
    return all(constant_expression(value) for value in expression.values() if isinstance(value, dict) and "op" in value)


def scalar_bounds(expression):
    if expression.get("op") in {"typed_const", "const_float"}:
        number = expression.get("value")
        if isinstance(number, (int, float)) and math.isfinite(number): return number, number
    if expression.get("op") == "typed_convert": return scalar_bounds(expression["input"])
    if expression.get("op") == "clamp01": return 0, 1
    if expression.get("op") == "clamp_minmax":
        low, high = scalar_bounds(expression["min"]), scalar_bounds(expression["max"])
        if low and high and low[0] == low[1] and high[0] == high[1]: return min(low[0], high[0]), max(low[0], high[0])
    if expression.get("op") == "integer_math" and expression.get("operation") == "ADD":
        a, b = scalar_bounds(expression["a"]), scalar_bounds(expression["b"])
        if a and b and a[0] + b[0] >= -2147483648 and a[1] + b[1] <= 2147483647: return a[0] + b[0], a[1] + b[1]
    return None


def require_round_bounds(bounds, refuse):
    if len(bounds) != 2 or any(bound is None for bound in bounds):
        refuse("Integer Math Round requires provably bounded inputs; clamp dynamic inputs before integer conversion")
    a, b = (max(abs(bound[0]), abs(bound[1])) for bound in bounds)
    if 2 * a + b > 2147483647 or 2 * b > 2147483647:
        refuse("Integer Math Round exceeds Blender's defined signed-integer intermediate range")


def emit_utility(node, emit_input, refuse, engine):
    if node.bl_idname == "FunctionNodeInputBool":
        return {"op": "typed_const", "type": "BOOLEAN", "value": bool(node.boolean)}
    if node.bl_idname == "FunctionNodeInputInt":
        return {"op": "typed_const", "type": "INT", "value": int(node.integer)}
    operation = str(node.operation)
    boolean = node.bl_idname == "FunctionNodeBooleanMath"
    if operation not in (BOOLEAN_OPERATIONS if boolean else INTEGER_OPERATIONS):
        refuse("unverified shared utility operation " + operation)
    inputs = [socket for socket in node.inputs if socket.enabled and not getattr(socket, "is_unavailable", False)]
    values = [emit_input(socket) for socket in inputs]
    if not boolean and operation == "DIVIDE_ROUND": require_round_bounds([scalar_bounds(value) for value in values], refuse)
    if not boolean and operation == "LCM":
        bounds = [scalar_bounds(value) for value in values]
        if any(bound is None or bound[0] <= -2147483648 for bound in bounds):
            refuse("Integer Math LCM requires provable inputs above INT_MIN; clamp dynamic inputs before integer conversion")
    result = {"op": "boolean_math", "operation": operation} if boolean else {"op": "integer_math", "operation": operation}
    result.update(zip(("a", "b", "c"), values))
    if not boolean:
        result["model"] = "CPU" if all(constant_expression(value) for value in values) else "CYCLES" if engine == "CYCLES" else "GPU"
    return result
