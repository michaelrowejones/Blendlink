# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored Normal direction and dot products, with explicit engine semantics."""
import math

from mathutils import Vector


def direction_literal(values, *, normalize, refuse):
    values = [float(value) for value in values]
    if len(values) != 3 or any(not math.isfinite(value) or abs(value) > 16 for value in values):
        refuse("Normal direction requires finite components with absolute value at most 16")
    if normalize:
        if sum(value * value for value in values) < 1e-30:
            refuse("Cycles Normal direction must be nonzero; choose a direction or bake this channel")
        values = list(Vector(values).normalized())
    return {"op": "const_vec3", "value": values}


def emit_normal_direction(node, output, *, engine, emit_vector, refuse):
    def fail(reason):
        refuse(node.name + ": " + reason)
    if engine not in {"CYCLES", "EEVEE"}:
        fail("Normal direction needs an explicit native source engine")
    direction = direction_literal(node.outputs["Normal"].default_value,
                                  normalize=engine == "CYCLES", refuse=fail)
    if output.identifier == "Normal":
        return direction
    if output.identifier != "Dot":
        fail("Normal has no verified output " + output.identifier)
    incoming = emit_vector(node.inputs["Normal"])
    if not nonzero_input(incoming):
        fail("Normal Dot needs a verified finite nonzero input; use a nonzero constant, a supported normal field, or bake this channel")
    return {"op": "vector_math", "operation": "DOT_PRODUCT", "a": direction,
            "b": {"op": "vector_math", "operation": "NORMALIZE", "a": incoming}}


def nonzero_input(value):
    if not isinstance(value, dict):
        return False
    op = value.get("op")
    if op == "geometry_context":
        # These fields already carry their primary-triangle normal validation.
        return value.get("model") == "primary-triangles-v1" and value.get("output") in {"normal", "true-normal"}
    if op == "tex_image" and value.get("output") == "color" and value.get("interpolation") == "Closest" and value.get("extension") in {"REPEAT", "EXTEND"}:
        pixels = value.get("pixels")
        return isinstance(pixels, list) and len(pixels) > 0 and len(pixels) % 4 == 0 and all(
            pixels[index + 3] == 1 and all(isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 16
                                         for v in pixels[index:index + 3])
            and sum(v * v for v in pixels[index:index + 3]) >= 1e-6
            for index in range(0, len(pixels), 4))
    if op == "const_vec3":
        values = value.get("value")
    elif op == "combine" and all(isinstance(value.get(axis), dict) and value[axis].get("op") == "const_float" for axis in ("x", "y", "z")):
        values = [value[axis].get("value") for axis in ("x", "y", "z")]
    else:
        return False
    return isinstance(values, list) and len(values) == 3 and all(
        isinstance(v, (int, float)) and math.isfinite(v) and abs(v) <= 2**54 for v in values
    ) and sum(v * v for v in values) >= 1e-30
