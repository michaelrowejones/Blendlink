# SPDX-License-Identifier: GPL-3.0-or-later
"""Brick texture extraction, keeping every color and mortar input live."""
import math


def _scalar_interval(expression, fold_scalar):
    value = fold_scalar(expression)
    if value is not None and math.isfinite(value):
        return value, value
    if not isinstance(expression, dict):
        return -math.inf, math.inf
    op = expression.get("op")
    if op == "clamp01":
        return 0, 1
    if op == "clamp_minmax":
        low, high = [fold_scalar(expression.get(key)) for key in ("min", "max")]
        if low is not None and high is not None:
            return min(low, high), max(low, high)
    if op == "math":
        a = _scalar_interval(expression.get("a"), fold_scalar)
        b = _scalar_interval(expression.get("b"), fold_scalar)
        operation = expression.get("operation")
        if operation == "MAXIMUM":
            return max(a[0], b[0]), max(a[1], b[1])
        if operation == "MINIMUM":
            return min(a[0], b[0]), min(a[1], b[1])
        if operation == "ADD":
            return a[0] + b[0], a[1] + b[1]
        if operation == "ABSOLUTE":
            return 0, max(abs(a[0]), abs(a[1]))
    return -math.inf, math.inf


def emit_brick(node, socket, *, emit_scalar, emit_vector, refuse, fold_scalar):
    output = {"Color": "color", "Fac": "fac", "Factor": "fac"}.get(getattr(socket, "identifier", socket.name))
    if output is None:
        refuse("Brick Texture has no verified output " + socket.name)
    result = {"op": "tex_brick", "output": output,
              "vector": emit_vector(node.inputs["Vector"]),
              "offsetAmount": float(node.offset), "offsetFrequency": int(node.offset_frequency),
              "squashAmount": float(node.squash), "squashFrequency": int(node.squash_frequency)}
    for name, key in (("Color1", "color1"), ("Color2", "color2"), ("Mortar", "mortar")):
        result[key] = emit_vector(node.inputs[name])
    for name, key in (("Scale", "scale"), ("Mortar Size", "mortarSize"),
                      ("Mortar Smooth", "mortarSmooth"), ("Bias", "bias"),
                      ("Brick Width", "brickWidth"), ("Row Height", "rowHeight")):
        result[key] = emit_scalar(node.inputs[name])
    for key in ("brickWidth", "rowHeight"):
        lower, _ = _scalar_interval(result[key], fold_scalar)
        if not math.isfinite(lower) or lower <= 0:
            refuse("Brick Texture " + key + " requires a verified positive dimension; zero division has no portable native value")
    if result["offsetFrequency"] and result["squashFrequency"] and result["squashAmount"] <= 0:
        refuse("Brick Texture squash must keep the effective brick width positive")
    return result
