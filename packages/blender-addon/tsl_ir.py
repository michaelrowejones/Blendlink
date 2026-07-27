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
    "MODULO", "FLOORED_MODULO", "FLOOR", "SINE", "COSINE", "PINGPONG",
    "SQRT", "INVERSE_SQRT", "ABSOLUTE", "EXPONENT", "LOGARITHM",
    "CEIL", "FRACT", "TRUNC", "ROUND", "SNAP", "WRAP", "COMPARE",
    "SMOOTH_MIN", "SMOOTH_MAX", "SIGN", "TANGENT",
    "ARCSINE", "ARCCOSINE", "ARCTANGENT", "ARCTAN2",
    "SINH", "COSH", "TANH", "RADIANS", "DEGREES",
}
_MATH_UNARY = {
    "FLOOR", "SINE", "COSINE", "SQRT", "INVERSE_SQRT", "ABSOLUTE",
    "EXPONENT", "CEIL", "FRACT", "TRUNC", "ROUND", "SIGN", "TANGENT",
    "ARCSINE", "ARCCOSINE", "ARCTANGENT", "SINH", "COSH", "TANH",
    "RADIANS", "DEGREES",
}
_MATH_TERNARY = {"MULTIPLY_ADD", "WRAP", "COMPARE", "SMOOTH_MIN", "SMOOTH_MAX"}

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


def _matching_socket(sockets, reference):
    named = sockets.get(reference.name)
    if named is not None:
        return named
    identifier = getattr(reference, "identifier", None)
    return next(
        (item for item in sockets
         if item.name == reference.name or item.identifier == identifier),
        None,
    )


def find_principled_root(tree):
    """(principled, group_stack) for the material's single Principled surface.

    The stack is the chain of group-instance nodes enclosing the Principled,
    outermost first — the context `emit_channel` needs to resolve channel
    inputs fed through Group Input sockets.  Refuses ambiguity (several
    shader roots, or one reachable through multiple instance paths) instead
    of guessing.
    """
    import procedural

    nodes = procedural.reachable_surface_nodes(tree)
    root = procedural._single_principled_surface_root(nodes)
    if root is None:
        _refuse("no root-level single Principled surface")
    if root.id_data.as_pointer() == tree.as_pointer():
        return root, ()

    paths = []

    def locate(current, stack, seen):
        pointer = current.as_pointer()
        if pointer in seen:
            return
        seen = seen | {pointer}
        for node in current.nodes:
            if node.as_pointer() == root.as_pointer():
                paths.append(stack)
            nested = getattr(node, "node_tree", None)
            if node.bl_idname == "ShaderNodeGroup" and nested is not None:
                locate(nested, stack + (node,), seen)

    locate(tree, (), frozenset())
    if len(paths) != 1:
        _refuse(
            f"Principled surface reachable through {len(paths)} group "
            "instance paths"
        )
    return root, paths[0]


def emit_input(socket, stack=(), *, as_vector=False):
    """IR for one input socket: its link's expression or its constant."""
    source = _socket_source(socket)
    if source is None:
        value = _constant_value(socket)
        if value is None:
            _refuse(f"socket {socket.name!r} has no usable constant")
        return _vector(value) if as_vector else _scalar(value)
    node, from_socket = source
    return emit_output(node, from_socket, stack)


def emit_output(node, from_socket, stack=()):
    """IR for one node output.  Refuses anything without a proven cell.

    ``stack`` is the enclosing group-instance chain, outermost first; the
    walk crosses group walls in both directions with it.
    """
    idname = node.bl_idname
    socket_name = from_socket.name

    if getattr(node, "mute", False):
        _refuse(f"muted node {idname} has no proven passthrough mapping")

    if idname == "NodeReroute":
        inner = _socket_source(node.inputs[0])
        if inner is None:
            _refuse("reroute with no input")
        return emit_output(*inner, stack)

    if idname == "ShaderNodeGroup":
        if node.node_tree is None:
            _refuse("group instance without a node tree")
        group_output = next(
            (item for item in node.node_tree.nodes
             if item.type == "GROUP_OUTPUT"
             and getattr(item, "is_active_output", True)),
            None,
        )
        if group_output is None:
            _refuse(f"group {node.node_tree.name!r} has no active output")
        target = _matching_socket(group_output.inputs, from_socket)
        if target is None:
            _refuse(
                f"group {node.node_tree.name!r} output "
                f"{socket_name!r} not found"
            )
        return emit_input(
            target, stack + (node,),
            as_vector=target.type in {"RGBA", "VECTOR"},
        )

    if idname == "NodeGroupInput":
        if not stack:
            _refuse("Group Input outside any group instance context")
        instance = stack[-1]
        outer = _matching_socket(instance.inputs, from_socket)
        if outer is None:
            _refuse(
                f"group instance {instance.name!r} is missing input "
                f"{socket_name!r}"
            )
        return emit_input(
            outer, stack[:-1],
            as_vector=outer.type in {"RGBA", "VECTOR"},
        )

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
            "input": emit_input(node.inputs["Vector"], stack=stack, as_vector=True),
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
            "input": emit_input(node.inputs[0], stack=stack, as_vector=True),
        }

    if idname == "ShaderNodeCombineXYZ":
        return {
            "op": "combine",
            "x": emit_input(node.inputs["X"], stack=stack),
            "y": emit_input(node.inputs["Y"], stack=stack),
            "z": emit_input(node.inputs["Z"], stack=stack),
        }

    if idname in {"ShaderNodeCombineColor", "ShaderNodeCombineRGB"}:
        if idname == "ShaderNodeCombineColor" \
                and getattr(node, "mode", "RGB") != "RGB":
            _refuse(f"Combine Color mode {node.mode!r} has no cell yet")
        names = ("Red", "Green", "Blue") \
            if idname == "ShaderNodeCombineColor" else ("R", "G", "B")
        return {
            "op": "combine",
            "x": emit_input(node.inputs[names[0]], stack=stack),
            "y": emit_input(node.inputs[names[1]], stack=stack),
            "z": emit_input(node.inputs[names[2]], stack=stack),
        }

    if idname == "ShaderNodeMath":
        operation = str(node.operation)
        if operation not in _MATH_OPERATIONS:
            _refuse(f"Math operation {operation!r} has no cell yet")
        expression = {
            "op": "math",
            "operation": operation,
            "a": emit_input(node.inputs[0], stack=stack),
        }
        if operation not in _MATH_UNARY:
            expression["b"] = emit_input(node.inputs[1], stack=stack)
        if operation in _MATH_TERNARY:
            expression["c"] = emit_input(node.inputs[2], stack=stack)
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
                "input": emit_input(node.inputs[0], stack=stack, as_vector=True),
                "scale": emit_input(node.inputs["Scale"], stack=stack),
            }
        return {
            "op": "vector_math",
            "operation": operation,
            "a": emit_input(node.inputs[0], stack=stack, as_vector=True),
            "b": emit_input(node.inputs[1], stack=stack, as_vector=True),
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
            "input": emit_input(node.inputs["Vector"], stack=stack, as_vector=True),
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
        if socket_name not in {"Color", "Alpha"}:
            _refuse(f"ColorRamp output {socket_name!r} unsupported")
        if interpolation in _RAMP_INTERPOLATIONS:
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
                "input": emit_input(node.inputs["Fac"], stack=stack),
            }
            if socket_name == "Alpha":
                expression = {"op": "ramp_alpha", "input": expression}
            return expression
        # B_SPLINE / CARDINAL / EASE: sample Blender's own evaluator into a
        # LUT; the builder interpolates between exact texels.  257 samples
        # bound the reconstruction error of any smooth colorband well below
        # cell tolerance.
        samples = 257
        values = []
        for index in range(samples):
            color = ramp.evaluate(index / (samples - 1))
            values.extend(float(item) for item in color)
        return {
            "op": "ramp_lut",
            "channel": "alpha" if socket_name == "Alpha" else "rgb",
            "samples": samples,
            "values": values,
            "input": emit_input(node.inputs["Fac"], stack=stack),
        }

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
        if blend not in {"MIX", "MULTIPLY", "ADD", "OVERLAY", "DIVIDE"}:
            _refuse(f"Mix blend type {blend!r} has no cell yet")
        return {
            "op": "mix_color",
            "blendType": blend,
            "clampFactor": clamp_factor,
            "clampResult": clamp_result,
            "factor": emit_input(factor, stack=stack),
            "a": emit_input(a_input, stack=stack, as_vector=True),
            "b": emit_input(b_input, stack=stack, as_vector=True),
        }

    if idname == "ShaderNodeTexNoise":
        # Blender 5.2 displays the output as "Factor"; the identifier stays
        # "Fac" across versions.
        if getattr(from_socket, "identifier", socket_name) != "Fac":
            _refuse(f"Noise output {socket_name!r} has no cell yet (Fac only)")
        dimensions = str(getattr(node, "noise_dimensions", "3D"))
        if dimensions not in {"2D", "3D"}:
            _refuse(
                f"Noise dimensions {dimensions!r} has no cell yet"
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
        detail_value = float(node.inputs["Detail"].default_value)
        if detail_value > 2.0 + 1e-9:
            # Detail 2 is the proven range. At high octave counts (measured
            # at detail 6, scale 5: mean 3.9e-2) float phase differences in
            # the shared base octave amplify past channel tolerance; the
            # Material bake carries these channels faithfully instead.
            _refuse(
                f"Noise detail {detail_value:g} exceeds the proven range "
                "(<= 2); high-octave phase divergence measured"
            )
        lacunarity = node.inputs.get("Lacunarity")
        return {
            "op": "noise",
            "output": "fac",
            "dimensions": 2 if dimensions == "2D" else 3,
            "detail": float(node.inputs["Detail"].default_value),
            "roughness": float(node.inputs["Roughness"].default_value),
            "lacunarity": (
                float(lacunarity.default_value)
                if lacunarity is not None else 2.0
            ),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
            "input": emit_input(vector, stack=stack, as_vector=True),
        }

    if idname == "ShaderNodeFresnel":
        if node.inputs["Normal"].is_linked:
            _refuse("Fresnel with a linked Normal has no cell yet")
        return {
            "op": "fresnel",
            "ior": emit_input(node.inputs["IOR"], stack=stack),
            "cos": {"op": "view_cos"},
        }

    if idname == "ShaderNodeLayerWeight":
        if node.inputs["Normal"].is_linked:
            _refuse("Layer Weight with a linked Normal has no cell yet")
        if socket_name not in {"Fresnel", "Facing"}:
            _refuse(f"Layer Weight output {socket_name!r} unsupported")
        return {
            "op": "layer_weight",
            "output": "fresnel" if socket_name == "Fresnel" else "facing",
            "blend": emit_input(node.inputs["Blend"], stack=stack),
            "cos": {"op": "view_cos"},
        }

    if idname == "ShaderNodeVertexColor":
        if socket_name != "Color":
            _refuse(f"Vertex Color output {socket_name!r} has no cell yet")
        return {
            "op": "vertex_color",
            "layer": str(getattr(node, "layer_name", "") or ""),
        }

    if idname == "ShaderNodeAttribute":
        if str(getattr(node, "attribute_type", "GEOMETRY")) != "GEOMETRY":
            _refuse(
                f"Attribute type {node.attribute_type!r} has no cell yet"
            )
        if socket_name != "Color":
            _refuse(f"Attribute output {socket_name!r} has no cell yet")
        return {
            "op": "vertex_color",
            "layer": str(getattr(node, "attribute_name", "") or ""),
        }

    if idname == "ShaderNodeMapRange":
        if str(getattr(node, "data_type", "FLOAT")) != "FLOAT":
            _refuse(f"Map Range data type {node.data_type!r} has no cell yet")
        interpolation = str(getattr(node, "interpolation_type", "LINEAR"))
        if interpolation not in {"LINEAR", "SMOOTHSTEP"}:
            _refuse(
                f"Map Range interpolation {interpolation!r} has no cell yet"
            )
        return {
            "op": "map_range",
            "interpolation": interpolation,
            "clamp": bool(getattr(node, "clamp", True)),
            "value": emit_input(node.inputs["Value"], stack=stack),
            "fromMin": emit_input(node.inputs["From Min"], stack=stack),
            "fromMax": emit_input(node.inputs["From Max"], stack=stack),
            "toMin": emit_input(node.inputs["To Min"], stack=stack),
            "toMax": emit_input(node.inputs["To Max"], stack=stack),
        }

    if idname == "ShaderNodeClamp":
        if str(getattr(node, "clamp_type", "MINMAX")) != "MINMAX":
            _refuse(f"Clamp type {node.clamp_type!r} has no cell yet")
        return {
            "op": "clamp_minmax",
            "value": emit_input(node.inputs["Value"], stack=stack),
            "min": emit_input(node.inputs["Min"], stack=stack),
            "max": emit_input(node.inputs["Max"], stack=stack),
        }

    _refuse(f"{idname} has no proven TSL mapping")


def emit_channel(socket, stack=()) -> dict:
    """Complete IR document for one channel input socket.

    ``stack`` is the group-instance chain enclosing the socket's node
    (from ``find_principled_root``), so channels fed through Group Input
    sockets resolve against the right instance.
    """
    source = _socket_source(socket)
    if source is None:
        value = _constant_value(socket)
        if value is None:
            _refuse(f"channel {socket.name!r} has no usable constant")
        expression = _vector(value) if socket.type in {"RGBA", "VECTOR"} \
            else _scalar(value)
    else:
        expression = emit_output(*source, stack)
    document = {
        "schemaVersion": 1,
        "model": IR_MODEL,
        "output": expression,
    }
    import json as _json

    if '"view_cos"' in _json.dumps(expression):
        # A view-dependent channel can never take the tile-bake routes; the
        # TSL runtime is its only faithful transport.
        document["viewDependent"] = True
    return document
