# SPDX-License-Identifier: GPL-3.0-or-later
"""Proven input bounds for legacy GPU Math domains that are natively undefined."""
import math
import struct


def _float32(value):
    try:
        return struct.unpack("f", struct.pack("f", value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def numeric_socket_bounds(socket, seen=()):
    key = socket.as_pointer()
    if key in seen:
        return None
    if not socket.is_linked:
        value = getattr(socket, "default_value", None)
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value), float(value)
        return None
    source = next((link.from_socket for link in socket.links
                   if link.is_valid and not getattr(link, "is_muted", False)), None)
    if source is None or source.type not in {"VALUE", "INT", "BOOLEAN"}:
        return None
    node = source.node
    if node.bl_idname in {"ShaderNodeValue", "CompositorNodeValue"}:
        value = float(source.default_value)
        return (value, value) if math.isfinite(value) else None
    if node.bl_idname not in {"ShaderNodeMath", "CompositorNodeMath"}:
        return None

    def result(low, high):
        # Bounds follow each native float32 operation, including cancellation.
        # Float64 arithmetic can incorrectly prove (2**24 + 1) - 2**24 > 0.
        low, high = _float32(low), _float32(high)
        if node.use_clamp:
            low, high = min(max(low, 0), 1), min(max(high, 0), 1)
        return low, high

    a = numeric_socket_bounds(node.inputs[0], seen + (key,))
    if node.operation == "ABSOLUTE":
        if a is None:
            return result(0.0, math.inf)
        return result(0.0 if a[0] <= 0 <= a[1] else min(abs(a[0]), abs(a[1])), max(abs(a[0]), abs(a[1])))
    b = numeric_socket_bounds(node.inputs[1], seen + (key,))
    if node.operation == "MAXIMUM":
        if a is None and b is None:
            return None
        a, b = a or (-math.inf, math.inf), b or (-math.inf, math.inf)
        return result(max(a[0], b[0]), max(a[1], b[1]))
    if a is None or b is None:
        return None
    if node.operation == "ADD":
        return result(a[0] + b[0], a[1] + b[1])
    if node.operation == "SUBTRACT":
        return result(a[0] - b[1], a[1] - b[0])
    if node.operation == "MINIMUM":
        return result(min(a[0], b[0]), min(a[1], b[1]))
    return None


def require_positive_inverse_sqrt(node, fail):
    bounds = numeric_socket_bounds(node.inputs[0])
    if bounds is None or not math.isfinite(bounds[0]) or bounds[0] < 2 ** -126:
        fail("GPU Inverse Square Root requires a provably positive normal input; "
             "native zero/negative inputs produce non-finite pixels. Use a positive Math Maximum bound")
    return float(bounds[0])


def require_fixed_logarithm_base(node, fail):
    bounds = numeric_socket_bounds(node.inputs[1])
    if bounds is None or bounds[0] != bounds[1] or not math.isfinite(bounds[0]) or bounds[0] == 1:
        context = "Legacy compositor" if node.bl_idname == "CompositorNodeMath" else "GPU compositor"
        fail(context + " Logarithm requires a proven fixed base other than 1; "
             "native base1 can produce non-finite pixels")
    return float(bounds[0])


def validate_math_domain(node, device, fail):
    """Return native domain evidence after actual dependencies are classified."""
    properties = {}
    legacy = node.bl_idname == "CompositorNodeMath"
    if node.operation in {"SINE", "COSINE", "TANGENT", "ARCSINE", "ARCCOSINE"}:
        properties["math_precision_model"] = "portable-f32-v1"
    if node.operation == "POWER":
        exponent = numeric_socket_bounds(node.inputs[1])
        if exponent == (-1.0, -1.0):
            properties.update({"math_precision_model": "portable-f32-v1", "math_fixed_power_exponent": -1})
    if node.operation == "POWER" and device == "CPU":
        first, second = (numeric_socket_bounds(node.inputs[index]) for index in (0, 1))
        if first == (0.0, 0.0) and second is not None and second[1] < 0:
            fail("non-finite-math-domain", node.inputs[0],
                 "Zero raised to a negative power produces non-finite CPU compositor pixels in Blender")
    if node.operation == "INVERSE_SQRT" and device == "GPU":
        properties["math_domain_lower_bound"] = require_positive_inverse_sqrt(node,
            lambda message: fail("legacy-gpu-inverse-sqrt-domain" if legacy else "gpu-inverse-sqrt-domain", node.inputs[0], message))
    if node.operation == "LOGARITHM" and (legacy or device == "GPU"):
        properties["math_logarithm_base"] = require_fixed_logarithm_base(node,
            lambda message: fail("legacy-logarithm-domain" if legacy else "gpu-logarithm-domain", node.inputs[1], message))
    if node.operation == "ARCTAN2" and legacy and device == "GPU":
        for index in (0, 1):
            bounds = numeric_socket_bounds(node.inputs[index])
            if bounds is None or bounds[0] <= 0 <= bounds[1]:
                continue
            minimum = min(abs(bounds[0]), abs(bounds[1]))
            if math.isfinite(minimum) and minimum >= 2 ** -126:
                properties.update({"math_atan2_nonzero_operand": index, "math_atan2_nonzero_bound": minimum})
                break
        else:
            fail("gpu-arctan2-domain", node.inputs[0],
                 "GPU Arctan2 requires one provably nonzero normal operand; native atan2(0, 0) produces non-finite pixels")
    return properties
