# SPDX-License-Identifier: GPL-3.0-or-later
"""MTLX-TSL-001: Blender channel graphs to a portable TSL IR.

The compiler's front half.  ``emit_channel(socket)`` walks one channel's
upstream graph and returns a JSON-safe expression tree the TypeScript
builder (`tslNodeRecipe.ts`) turns into TSL nodes.  Every op in the IR is
backed by a gated cell in ``experiments/tsl-node-differential`` — nothing
is emitted on faith.  Unsupported nodes refuse with a named reason; the
Material bake remains the fallback route for every surface-stable channel.

The IR is deliberately dumb: constants are folded into the tree, enum
parameters become fields, and there is no sharing/CSE — attestability and
auditability first, optimization later.
"""
from __future__ import annotations

IR_MODEL = "blendlink-tsl-ir-v1"

# Blender Math operations with proven differential cells.  The builder maps
# DIVIDE/MODULO/POWER to Blender's safe-math wrappers.  ABSOLUTE, CEIL,
# FRACT, ROUND, and SQRT are one-cell-each additions once celled.
_MATH_OPERATIONS = {
    "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MULTIPLY_ADD",
    "POWER", "MINIMUM", "MAXIMUM", "LESS_THAN", "GREATER_THAN",
    "MODULO", "FLOOR", "SINE", "COSINE",
}
_MATH_UNARY = {"FLOOR", "SINE", "COSINE"}
_MATH_TERNARY = {"MULTIPLY_ADD"}

_VECTOR_MATH_OPERATIONS = {"ADD", "SCALE"}

_RAMP_INTERPOLATIONS = {"LINEAR", "CONSTANT"}


class TslIrRefusal(Exception):
    """A channel graph contains something without a proven cell."""


def _refuse(reason: str):
    raise TslIrRefusal(reason)


def _constant_value(socket):
    value = getattr(socket, "default_value", None)
    if value is None:
        return None
    try:
        return [float(item) for item in value]
    except TypeError:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None


def _scalar(value):
    if isinstance(value, list):
        # Blender converts color -> float via luminance only in specific
        # nodes; sockets feeding scalar inputs carry floats already.
        return {"op": "const_float", "value": float(value[0])}
    return {"op": "const_float", "value": float(value)}


def _vector(value, length=3):
    if isinstance(value, (int, float)):
        return {"op": "const_vec3", "value": [float(value)] * 3}
    items = [float(item) for item in value[:length]]
    while len(items) < 3:
        items.append(0.0)
    return {"op": "const_vec3", "value": items[:3]}


def _socket_source(socket):
    if not socket.is_linked:
        return None
    links = socket.links
    if len(links) != 1:
        _refuse(f"socket {socket.name!r} has {len(links)} links")
    return links[0].from_node, links[0].from_socket


def emit_input(socket, *, as_vector=False):
    """IR for one input socket: its link's expression or its constant."""
    source = _socket_source(socket)
    if source is None:
        value = _constant_value(socket)
        if value is None:
            _refuse(f"socket {socket.name!r} has no usable constant")
        return _vector(value) if as_vector else _scalar(value)
    node, from_socket = source
    return emit_output(node, from_socket)


def emit_output(node, from_socket):
    """IR for one node output.  Refuses anything without a proven cell."""
    idname = node.bl_idname
    socket_name = from_socket.name

    if idname == "NodeReroute":
        inner = _socket_source(node.inputs[0])
        if inner is None:
            _refuse("reroute with no input")
        return emit_output(*inner)

    if idname == "ShaderNodeTexCoord":
        if socket_name != "UV":
            _refuse(
                f"Texture Coordinate {socket_name!r} has no TSL cell yet; "
                "only UV is proven"
            )
        return {"op": "uv"}

    if idname == "ShaderNodeUVMap":
        uv_map = str(getattr(node, "uv_map", "") or "")
        return {"op": "uv", **({"uvMap": uv_map} if uv_map else {})}

    if idname == "ShaderNodeRGB":
        return _vector(_constant_value(node.outputs["Color"]))

    if idname == "ShaderNodeValue":
        return _scalar(_constant_value(node.outputs["Value"]))

    if idname == "ShaderNodeSeparateXYZ":
        return {
            "op": "separate",
            "channel": {"X": "x", "Y": "y", "Z": "z"}[socket_name],
            "input": emit_input(node.inputs["Vector"], as_vector=True),
        }

    if idname in {"ShaderNodeSeparateColor", "ShaderNodeSeparateRGB"}:
        if idname == "ShaderNodeSeparateColor" \
                and getattr(node, "mode", "RGB") != "RGB":
            _refuse(f"Separate Color mode {node.mode!r} has no cell yet")
        channel = {
            "Red": "x", "Green": "y", "Blue": "z",
            "R": "x", "G": "y", "B": "z",
        }[socket_name]
        return {
            "op": "separate",
            "channel": channel,
            "input": emit_input(node.inputs[0], as_vector=True),
        }

    if idname == "ShaderNodeCombineXYZ":
        return {
            "op": "combine",
            "x": emit_input(node.inputs["X"]),
            "y": emit_input(node.inputs["Y"]),
            "z": emit_input(node.inputs["Z"]),
        }

    if idname in {"ShaderNodeCombineColor", "ShaderNodeCombineRGB"}:
        if idname == "ShaderNodeCombineColor" \
                and getattr(node, "mode", "RGB") != "RGB":
            _refuse(f"Combine Color mode {node.mode!r} has no cell yet")
        names = ("Red", "Green", "Blue") \
            if idname == "ShaderNodeCombineColor" else ("R", "G", "B")
        return {
            "op": "combine",
            "x": emit_input(node.inputs[names[0]]),
            "y": emit_input(node.inputs[names[1]]),
            "z": emit_input(node.inputs[names[2]]),
        }

    if idname == "ShaderNodeMath":
        operation = str(node.operation)
        if operation not in _MATH_OPERATIONS:
            _refuse(f"Math operation {operation!r} has no cell yet")
        expression = {
            "op": "math",
            "operation": operation,
            "a": emit_input(node.inputs[0]),
        }
        if operation not in _MATH_UNARY:
            expression["b"] = emit_input(node.inputs[1])
        if operation in _MATH_TERNARY:
            expression["c"] = emit_input(node.inputs[2])
        if getattr(node, "use_clamp", False):
            expression = {
                "op": "clamp01", "input": expression,
            }
        return expression

    if idname == "ShaderNodeVectorMath":
        operation = str(node.operation)
        if operation not in _VECTOR_MATH_OPERATIONS:
            _refuse(f"Vector Math operation {operation!r} has no cell yet")
        if operation == "SCALE":
            return {
                "op": "vector_scale",
                "input": emit_input(node.inputs[0], as_vector=True),
                "scale": emit_input(node.inputs["Scale"]),
            }
        return {
            "op": "vector_math",
            "operation": operation,
            "a": emit_input(node.inputs[0], as_vector=True),
            "b": emit_input(node.inputs[1], as_vector=True),
        }

    if idname == "ShaderNodeMapping":
        vector_type = str(getattr(node, "vector_type", "POINT"))
        if vector_type not in {"POINT", "TEXTURE"}:
            _refuse(f"Mapping type {vector_type!r} has no cell yet")
        for name in ("Location", "Rotation", "Scale"):
            if node.inputs[name].is_linked:
                _refuse(f"Mapping with linked {name} has no cell yet")
        rotation = node.inputs["Rotation"].default_value
        if abs(float(rotation[0])) > 1e-9 or abs(float(rotation[1])) > 1e-9:
            _refuse("Mapping X/Y rotation has no cell yet (Z only)")
        return {
            "op": "mapping",
            "vectorType": vector_type,
            "input": emit_input(node.inputs["Vector"], as_vector=True),
            "location": [
                float(item) for item in node.inputs["Location"].default_value
            ],
            "rotation": [
                float(item) for item in node.inputs["Rotation"].default_value
            ],
            "scale": [
                float(item) for item in node.inputs["Scale"].default_value
            ],
        }

    if idname == "ShaderNodeValToRGB":
        ramp = node.color_ramp
        interpolation = str(ramp.interpolation)
        if interpolation not in _RAMP_INTERPOLATIONS:
            _refuse(
                f"ColorRamp interpolation {interpolation!r} has no cell yet"
            )
        if socket_name not in {"Color", "Alpha"}:
            _refuse(f"ColorRamp output {socket_name!r} unsupported")
        expression = {
            "op": "color_ramp",
            "interpolation": interpolation,
            "stops": [
                {
                    "position": float(element.position),
                    "color": [float(item) for item in element.color],
                }
                for element in ramp.elements
            ],
            "input": emit_input(node.inputs["Fac"]),
        }
        if socket_name == "Alpha":
            expression = {"op": "ramp_alpha", "input": expression}
        return expression

    if idname in {"ShaderNodeMix", "ShaderNodeMixRGB"}:
        if idname == "ShaderNodeMix":
            if str(getattr(node, "data_type", "")) != "RGBA":
                _refuse(f"Mix data type {node.data_type!r} has no cell yet")
            blend = str(getattr(node, "blend_type", "MIX"))
            factor = next(
                item for item in node.inputs
                if item.identifier == "Factor_Float"
            )
            a_input = next(
                item for item in node.inputs if item.identifier == "A_Color"
            )
            b_input = next(
                item for item in node.inputs if item.identifier == "B_Color"
            )
            clamp_factor = bool(getattr(node, "clamp_factor", True))
            clamp_result = bool(getattr(node, "clamp_result", False))
        else:
            blend = str(getattr(node, "blend_type", "MIX"))
            factor = node.inputs["Fac"]
            a_input = node.inputs["Color1"]
            b_input = node.inputs["Color2"]
            clamp_factor = True
            clamp_result = bool(getattr(node, "use_clamp", False))
        if blend not in {"MIX", "MULTIPLY", "ADD"}:
            _refuse(f"Mix blend type {blend!r} has no cell yet")
        return {
            "op": "mix_color",
            "blendType": blend,
            "clampFactor": clamp_factor,
            "clampResult": clamp_result,
            "factor": emit_input(factor),
            "a": emit_input(a_input, as_vector=True),
            "b": emit_input(b_input, as_vector=True),
        }

    if idname == "ShaderNodeTexNoise":
        # Blender 5.2 displays the output as "Factor"; the identifier stays
        # "Fac" across versions.
        if getattr(from_socket, "identifier", socket_name) != "Fac":
            _refuse(f"Noise output {socket_name!r} has no cell yet (Fac only)")
        if getattr(node, "noise_dimensions", "3D") != "3D":
            _refuse(
                f"Noise dimensions {node.noise_dimensions!r} has no cell "
                "yet (3D only)"
            )
        distortion = node.inputs.get("Distortion")
        if distortion is not None and (
            distortion.is_linked
            or abs(float(distortion.default_value)) > 1e-9
        ):
            _refuse("Noise distortion has no cell yet")
        for name in ("Detail", "Roughness", "Lacunarity"):
            socket = node.inputs.get(name)
            if socket is not None and socket.is_linked:
                _refuse(f"Noise with linked {name} has no cell yet")
        vector = node.inputs["Vector"]
        if not vector.is_linked:
            # Unlinked Vector defaults to Generated coordinates, which the
            # TSL route cannot reproduce on arbitrary meshes.
            _refuse(
                "Noise with unlinked Vector samples Generated coordinates; "
                "no TSL cell"
            )
        lacunarity = node.inputs.get("Lacunarity")
        return {
            "op": "noise",
            "output": "fac",
            "detail": float(node.inputs["Detail"].default_value),
            "roughness": float(node.inputs["Roughness"].default_value),
            "lacunarity": (
                float(lacunarity.default_value)
                if lacunarity is not None else 2.0
            ),
            "scale": emit_input(node.inputs["Scale"]),
            "input": emit_input(vector, as_vector=True),
        }

    _refuse(f"{idname} has no proven TSL mapping")


def emit_channel(socket) -> dict:
    """Complete IR document for one channel input socket."""
    source = _socket_source(socket)
    if source is None:
        value = _constant_value(socket)
        if value is None:
            _refuse(f"channel {socket.name!r} has no usable constant")
        expression = _vector(value) if socket.type in {"RGBA", "VECTOR"} \
            else _scalar(value)
    else:
        expression = emit_output(*source)
    return {
        "schemaVersion": 1,
        "model": IR_MODEL,
        "output": expression,
    }
