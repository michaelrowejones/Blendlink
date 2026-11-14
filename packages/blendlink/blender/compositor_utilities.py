# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalize actual shared function-node schemas for the compositor."""

def socket_bounds(socket, seen=()):
    key = socket.as_pointer()
    if key in seen: return None
    if not socket.is_linked:
        value = getattr(socket, "default_value", None)
        return (value, value) if isinstance(value, (int, float)) else None
    source = next((link.from_socket for link in socket.links if link.is_valid and not getattr(link, "is_muted", False)), None)
    if source is None: return None
    node = source.node
    if node.bl_idname == "FunctionNodeInputInt": return node.integer, node.integer
    if node.bl_idname in {"ShaderNodeValue", "CompositorNodeValue"}: return source.default_value, source.default_value
    if node.bl_idname == "ShaderNodeClamp":
        low, high = (socket_bounds(node.inputs[name], seen + (key,)) for name in ("Min", "Max"))
        if low and high and low[0] == low[1] and high[0] == high[1]: return min(low[0], high[0]), max(low[0], high[0])
    if node.bl_idname == "FunctionNodeIntegerMath" and node.operation == "ADD":
        a, b = (socket_bounds(incoming, seen + (key,)) for incoming in list(node.inputs)[:2])
        if a and b and a[0] + b[0] >= -2147483648 and a[1] + b[1] <= 2147483647: return a[0] + b[0], a[1] + b[1]
    return None

def normalize_utility(node, op, input_value, fail, device, constant_string=None):
    if node.bl_idname in {"FunctionNodeInputBool", "FunctionNodeInputInt"}:
        op["value"] = bool(node.boolean) if node.bl_idname == "FunctionNodeInputBool" else int(node.integer)
        return
    if node.bl_idname == "FunctionNodeCompare":
        op["properties"].update({"data_type": node.data_type, "operation": node.operation, "mode": node.mode})
        if node.data_type in {"STRING", "OBJECT", "FONT"}:
            active = [socket for socket in node.inputs if socket.enabled and not getattr(socket, "is_unavailable", False)]
            if node.operation not in {"EQUAL", "NOT_EQUAL"} or len(active) != 2:
                fail("Linked string or data-block comparisons require live identity transport")
            if any(socket.is_linked for socket in active):
                if node.data_type != 'STRING' or constant_string is None:
                    fail("Linked string or data-block comparisons require qualified static string or live identity transport")
                a, b = (constant_string(socket) for socket in active)
            else:
                a, b = (socket.default_value for socket in active)
            op["kind"] = "utility-constant"
            op["value"] = (a == b) if node.operation == "EQUAL" else (a != b)
            return
        if node.data_type not in {"FLOAT", "INT", "VECTOR", "RGBA"}:
            fail("Compare has an unverified data type")
    else:
        op["properties"]["operation"] = node.operation
        if node.bl_idname == "FunctionNodeIntegerMath":
            op["properties"]["integer_math_device"] = device
            if node.operation == "LCM":
                bounds = [socket_bounds(socket) for socket in list(node.inputs)[:2]]
                if any(bound is None or bound[0] <= -2147483648 for bound in bounds):
                    fail("Integer Math LCM requires provable inputs above INT_MIN; clamp dynamic inputs before integer conversion")
            if node.operation == "DIVIDE_ROUND":
                bounds = [socket_bounds(socket) for socket in node.inputs if socket.enabled and not getattr(socket, "is_unavailable", False)]
                if any(bound is None for bound in bounds): fail("Integer Math Round requires provably bounded inputs; clamp dynamic inputs before integer conversion")
                a, b = (max(abs(bound[0]), abs(bound[1])) for bound in bounds)
                if 2 * a + b > 2147483647 or 2 * b > 2147483647:
                    fail("Integer Math Round exceeds Blender's defined signed-integer intermediate range")
    for socket in node.inputs:
        if not socket.enabled or getattr(socket, "is_unavailable", False):
            continue
        op["inputs"][socket.identifier] = {"name": socket.name, "socketType": socket.type, "value": input_value(socket)}
