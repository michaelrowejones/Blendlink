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

_VECTOR_MATH_OPERATIONS = {
    "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MULTIPLY_ADD", "SCALE",
    "CROSS_PRODUCT", "DOT_PRODUCT", "DISTANCE", "LENGTH", "NORMALIZE",
    "ABSOLUTE", "MINIMUM", "MAXIMUM", "FLOOR", "CEIL", "FRACTION",
    "MODULO", "WRAP", "SNAP", "SINE", "COSINE", "TANGENT",
}
# REFLECT / REFRACT / FACEFORWARD / PROJECT stay named refusals until a
# geometric cell batch earns them.
_VECTOR_MATH_UNARY = {
    "NORMALIZE", "FLOOR", "CEIL", "FRACTION", "ABSOLUTE", "LENGTH",
    "SINE", "COSINE", "TANGENT",
}
_VECTOR_MATH_TERNARY = {"MULTIPLY_ADD", "WRAP"}
_VECTOR_MATH_VALUE_OUTPUT = {"DOT_PRODUCT", "DISTANCE", "LENGTH"}

_MIX_BLEND_TYPES = {
    "MIX", "MULTIPLY", "ADD", "OVERLAY", "DIVIDE",
    "SUBTRACT", "DIFFERENCE", "DARKEN", "LIGHTEN", "SCREEN",
    "EXCLUSION", "SOFT_LIGHT", "LINEAR_LIGHT", "DODGE", "BURN",
    "HUE", "SATURATION", "VALUE", "COLOR",
}

_RAMP_INTERPOLATIONS = {"LINEAR", "CONSTANT"}


def _jenkins_rot(x, k):
    x &= 0xFFFFFFFF
    return ((x << k) | (x >> (32 - k))) & 0xFFFFFFFF


def _jenkins_final(a, b, c):
    m = 0xFFFFFFFF
    c = (c ^ b) & m; c = (c - _jenkins_rot(b, 14)) & m
    a = (a ^ c) & m; a = (a - _jenkins_rot(c, 11)) & m
    b = (b ^ a) & m; b = (b - _jenkins_rot(a, 25)) & m
    c = (c ^ b) & m; c = (c - _jenkins_rot(b, 16)) & m
    a = (a ^ c) & m; a = (a - _jenkins_rot(c, 4)) & m
    b = (b ^ a) & m; b = (b - _jenkins_rot(a, 14)) & m
    c = (c ^ b) & m; c = (c - _jenkins_rot(b, 24)) & m
    return c


def _float_bits(value):
    import struct
    return struct.unpack("<I", struct.pack("<f", float(value)))[0]


def _hash_float2_to_float(x, y):
    """Cycles hash_float2_to_float on constants (Jenkins on float bits)."""
    seed = (0xDEADBEEF + (2 << 2) + 13) & 0xFFFFFFFF
    c = _jenkins_final(
        (seed + _float_bits(x)) & 0xFFFFFFFF,
        (seed + _float_bits(y)) & 0xFFFFFFFF,
        seed,
    )
    return c / 0xFFFFFFFF


def _noise_random_offset(seed, count):
    """noisetex.h random_floatN_offset for a constant seed."""
    return [
        100.0 + _hash_float2_to_float(seed, float(index)) * 100.0
        for index in range(count)
    ]


def _import_procedural():
    """procedural in both loading modes: as an addon submodule (packaged)
    or as a bare module (harness scripts insert the directory on path)."""
    if __package__:
        from . import procedural
        return procedural
    import procedural
    return procedural


class TslIrRefusal(Exception):
    """A channel graph contains something without a proven cell."""


def _refuse(reason: str):
    raise TslIrRefusal(reason)


# Production opt-in (Phase 4 Track C): over-budget images emit texture_ref
# ops resolved against published image assets instead of refusing. The
# differential harness never sets this — its cells keep the byte-exact
# embedded-pixel contract.
_allow_texture_refs = False


def set_texture_ref_emission(enabled: bool) -> None:
    global _allow_texture_refs
    _allow_texture_refs = bool(enabled)


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
    # Blender treats a muted link exactly like no link (the socket's
    # default value applies), so the walk must too — following a muted
    # link would compile a branch Cycles never evaluates.
    links = [
        link for link in socket.links
        if not getattr(link, "is_muted", False)
    ]
    if not links:
        return None
    if len(links) != 1:
        _refuse(f"socket {socket.name!r} has {len(links)} links")
    return links[0].from_node, links[0].from_socket


def _matching_socket(sockets, reference):
    # Identifiers are unique per node interface; display names are not
    # (Blender permits two group sockets both shown as "Shader"), so the
    # identifier match must win before any name lookup.
    identifier = getattr(reference, "identifier", None)
    if identifier:
        matched = next(
            (item for item in sockets if item.identifier == identifier),
            None,
        )
        if matched is not None:
            return matched
    named = sockets.get(reference.name)
    if named is not None:
        return named
    return next(
        (item for item in sockets if item.name == reference.name),
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
    procedural = _import_procedural()

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


_SURFACE_MODEL = "blendlink-tsl-surface-v1"

_GLOSSY_IDNAMES = {"ShaderNodeBsdfGlossy", "ShaderNodeBsdfAnisotropic"}


def _resolve_shader_link(socket, stack):
    """Follow a shader input's link to its producing node, crossing
    reroutes and group walls with the same discipline as emit_output.
    Returns (node, from_socket, stack) or None when the chain ends
    unlinked."""
    steps = 0
    source = _socket_source(socket)
    while source is not None:
        steps += 1
        if steps > 4096:
            # Scripted trees can contain reroute link cycles (Blender
            # marks them invalid but the data allows them); a bound turns
            # the hang into a named refusal.
            _refuse("shader link chain exceeds the traversal bound")
        node, from_socket = source
        idname = node.bl_idname
        if getattr(node, "mute", False):
            _refuse(f"muted node {idname} has no proven passthrough mapping")
        if idname == "NodeReroute":
            source = _socket_source(node.inputs[0])
            continue
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
                _refuse(
                    f"group {node.node_tree.name!r} has no active output"
                )
            target = _matching_socket(group_output.inputs, from_socket)
            if target is None:
                _refuse(
                    f"group {node.node_tree.name!r} output "
                    f"{from_socket.name!r} not found"
                )
            stack = stack + (node,)
            source = _socket_source(target)
            continue
        if idname == "NodeGroupInput":
            if not stack:
                _refuse("Group Input outside any group instance context")
            instance = stack[-1]
            outer = _matching_socket(instance.inputs, from_socket)
            if outer is None:
                _refuse(
                    f"group instance {instance.name!r} is missing input "
                    f"{from_socket.name!r}"
                )
            stack = stack[:-1]
            source = _socket_source(outer)
            continue
        return node, from_socket, stack
    return None


def _surface_expression(node, from_socket, stack):
    """Parse the surface closure tree into leaves the channel projection
    understands.  Every leaf carries its OWN group-instance stack."""
    idname = node.bl_idname
    if getattr(from_socket, "type", "") != "SHADER":
        # Blender coerces a color/value output plugged into a shader
        # socket into an emission of that color (measured corpus class:
        # the splash outlines and sky paint).
        return {
            "kind": "coerced_color",
            "node": node,
            "socket": from_socket,
            "stack": stack,
        }
    if idname == "ShaderNodeMixShader":
        branches = []
        for index in (1, 2):
            resolved = _resolve_shader_link(node.inputs[index], stack)
            if resolved is None:
                _refuse(
                    "Mix Shader with an unlinked branch has no measured "
                    "semantics"
                )
            branches.append(_surface_expression(*resolved))
        return {
            "kind": "mix",
            "fac_socket": node.inputs[0],
            "fac_stack": stack,
            "a": branches[0],
            "b": branches[1],
        }
    if idname == "ShaderNodeBsdfPrincipled":
        return {"kind": "principled", "node": node, "stack": stack}
    if idname == "ShaderNodeEmission":
        return {"kind": "emission", "node": node, "stack": stack}
    if idname == "ShaderNodeBsdfTransparent":
        color_socket = node.inputs["Color"]
        if color_socket.is_linked:
            _refuse("Transparent BSDF with a linked Color has no cell yet")
        color = _constant_value(color_socket)
        if not isinstance(color, list) or any(
            abs(component - 1.0) > 1e-6 for component in color[:3]
        ):
            _refuse(
                "Transparent BSDF with a non-white Color tints "
                "transmission; no cell yet"
            )
        return {"kind": "transparent"}
    if idname == "ShaderNodeBsdfDiffuse":
        return {"kind": "diffuse", "node": node, "stack": stack}
    if idname in _GLOSSY_IDNAMES:
        return {"kind": "glossy", "node": node, "stack": stack}
    _refuse(f"surface node {idname} has no surface-expression mapping")


def _const_scalar(value):
    return {"op": "const_float", "value": float(value)}


def _const_color(r, g, b):
    return {"op": "const_vec3", "value": [float(r), float(g), float(b)]}


def _leaf_channels(leaf):
    """The canonical channel vector for one closure leaf.

    'radiance' is emission color x strength folded into one vec3 — mixes
    must lerp RADIANCE, not color and strength separately (lerping the
    parts is not linear in the light the closure emits)."""
    procedural = _import_procedural()

    kind = leaf["kind"]
    if kind == "principled":
        node = leaf["node"]
        stack = leaf["stack"]

        def channel(name, *, as_vector=False):
            socket = procedural._node_input(node, name)
            if socket is None:
                _refuse(f"Principled input {name!r} not found")
            return emit_input(socket, stack, as_vector=as_vector)

        return {
            "Base Color": channel("Base Color", as_vector=True),
            "Metallic": channel("Metallic"),
            "Roughness": channel("Roughness"),
            "Alpha": channel("Alpha"),
            "radiance": {
                "op": "vector_scale",
                "input": channel("Emission Color", as_vector=True),
                "scale": channel("Emission Strength"),
            },
        }
    if kind == "diffuse":
        # Canonicalization: diffuse -> rough dielectric.
        return {
            "Base Color": emit_input(
                leaf["node"].inputs["Color"], leaf["stack"], as_vector=True,
            ),
            "Metallic": _const_scalar(0.0),
            "Roughness": _const_scalar(1.0),
            "Alpha": _const_scalar(1.0),
            "radiance": _const_color(0.0, 0.0, 0.0),
        }
    if kind == "glossy":
        # Canonicalization: glossy -> fully metallic.
        return {
            "Base Color": emit_input(
                leaf["node"].inputs["Color"], leaf["stack"], as_vector=True,
            ),
            "Metallic": _const_scalar(1.0),
            "Roughness": emit_input(
                leaf["node"].inputs["Roughness"], leaf["stack"],
            ),
            "Alpha": _const_scalar(1.0),
            "radiance": _const_color(0.0, 0.0, 0.0),
        }
    if kind == "emission":
        return {
            "Base Color": _const_color(0.0, 0.0, 0.0),
            "Metallic": _const_scalar(0.0),
            "Roughness": _const_scalar(1.0),
            "Alpha": _const_scalar(1.0),
            "radiance": {
                "op": "vector_scale",
                "input": emit_input(
                    leaf["node"].inputs["Color"], leaf["stack"],
                    as_vector=True,
                ),
                "scale": emit_input(
                    leaf["node"].inputs["Strength"], leaf["stack"],
                ),
            },
        }
    if kind == "coerced_color":
        expression = emit_output(leaf["node"], leaf["socket"], leaf["stack"])
        if getattr(leaf["socket"], "type", "") == "VALUE":
            expression = {
                "op": "combine",
                "x": expression, "y": expression, "z": expression,
            }
        return {
            "Base Color": _const_color(0.0, 0.0, 0.0),
            "Metallic": _const_scalar(0.0),
            "Roughness": _const_scalar(1.0),
            "Alpha": _const_scalar(1.0),
            "radiance": expression,
        }
    _refuse(f"surface leaf {kind!r} has no channel projection")


def resolve_surface(tree):
    """The material's Cycles-visible surface expression.

    Cycles renders the output targeted at CYCLES when one exists, then
    the ALL-target output — measured on 5.2 with an EEVEE/CYCLES output
    pair (selecting by tree order compiled the branch Cycles never
    renders). Returns the parsed closure expression; refuses by name."""
    actives = [
        node for node in tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
        and getattr(node, "is_active_output", True)
    ]
    output = next(
        (node for node in actives
         if str(getattr(node, "target", "ALL")) == "CYCLES"),
        None,
    ) or next(
        (node for node in actives
         if str(getattr(node, "target", "ALL")) == "ALL"),
        None,
    )
    if output is None:
        _refuse("material has no Cycles-visible active Material Output")
    resolved = _resolve_shader_link(output.inputs["Surface"], ())
    if resolved is None:
        _refuse("material output has no linked Surface")
    return _surface_expression(*resolved)


def _lerp_scalar(a, b, factor):
    # a + (b - a) * factor, from proven ops only.
    return {
        "op": "math",
        "operation": "MULTIPLY_ADD",
        "a": {"op": "math", "operation": "SUBTRACT", "a": b, "b": a},
        "b": factor,
        "c": a,
    }


def _lerp_color(a, b, factor):
    return {
        "op": "mix_color",
        "blendType": "MIX",
        "clampFactor": True,
        "clampResult": False,
        "factor": factor,
        "a": a,
        "b": b,
    }


def _fold_surface(expression):
    """Fold the closure tree into one channel vector.

    Returns None for a fully transparent subtree.  Transparent branches
    contribute ONLY coverage: the visible branch keeps its channels
    unweighted and alpha multiplies by the visible weight — lerping
    toward invented neutral values would corrupt every channel."""
    kind = expression["kind"]
    if kind == "transparent":
        return None
    if kind != "mix":
        return _leaf_channels(expression)
    factor = emit_input(expression["fac_socket"], expression["fac_stack"])
    clamped = {"op": "clamp01", "input": factor}
    a = _fold_surface(expression["a"])
    b = _fold_surface(expression["b"])
    if a is None and b is None:
        return None
    if b is None:
        channels = dict(a)
        visible = {
            "op": "math", "operation": "SUBTRACT",
            "a": _const_scalar(1.0), "b": clamped,
        }
        channels["Alpha"] = {
            "op": "math", "operation": "MULTIPLY",
            "a": a["Alpha"], "b": visible,
        }
        return channels
    if a is None:
        channels = dict(b)
        channels["Alpha"] = {
            "op": "math", "operation": "MULTIPLY",
            "a": b["Alpha"], "b": clamped,
        }
        return channels
    return {
        "Base Color": _lerp_color(a["Base Color"], b["Base Color"], factor),
        "Metallic": _lerp_scalar(a["Metallic"], b["Metallic"], clamped),
        "Roughness": _lerp_scalar(a["Roughness"], b["Roughness"], clamped),
        "Alpha": _lerp_scalar(a["Alpha"], b["Alpha"], clamped),
        "radiance": _lerp_color(a["radiance"], b["radiance"], factor),
    }


def _channel_document(expression):
    import json as _json

    document = {
        "schemaVersion": 1,
        "model": IR_MODEL,
        "output": expression,
    }
    encoded = _json.dumps(expression)
    if '"view_cos"' in encoded:
        document["viewDependent"] = True
    if '"shader_to_rgb_diffuse"' in encoded:
        document["lightDependent"] = True
    return document


def emit_surface(tree):
    """Per-channel IR documents for a mixed surface expression.

    The documented projection model: a Mix Shader closure lerp becomes a
    per-channel parameter lerp (exact for emission radiance and alpha
    coverage; an approximation for Metallic/Roughness, whose closure mix
    is nonlinear under lighting), Transparent branches contribute only
    coverage, Diffuse/Glossy canonicalize onto the Principled channel
    vector, and emission always ships as radiance with strength 1."""
    channels = _fold_surface(resolve_surface(tree))
    if channels is None:
        channels = {
            "Base Color": _const_color(0.0, 0.0, 0.0),
            "Metallic": _const_scalar(0.0),
            "Roughness": _const_scalar(1.0),
            "Alpha": _const_scalar(0.0),
            "radiance": _const_color(0.0, 0.0, 0.0),
        }
    documents = {
        "Base Color": _channel_document(channels["Base Color"]),
        "Metallic": _channel_document(channels["Metallic"]),
        "Roughness": _channel_document(channels["Roughness"]),
        "Alpha": _channel_document(channels["Alpha"]),
        "Emission Color": _channel_document(channels["radiance"]),
        "Emission Strength": _channel_document(_const_scalar(1.0)),
    }
    return {
        "schemaVersion": 1,
        "model": _SURFACE_MODEL,
        "channels": documents,
    }


def _texture_vector(socket, stack):
    """A texture node's Vector input: its link's expression, or Generated
    coordinates when unlinked (Blender's implicit default)."""
    if socket.is_linked:
        return emit_input(socket, stack=stack, as_vector=True)
    return {"op": "generated"}


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
        if socket_name == "UV":
            return {"op": "uv"}
        if socket_name == "Object":
            if getattr(node, "object", None) is not None:
                _refuse(
                    "Texture Coordinate with an Object override maps "
                    "another object's space; no cell yet"
                )
            if bool(getattr(node, "from_instancer", False)):
                _refuse(
                    "Texture Coordinate from instancer has no cell yet"
                )
            # Object coordinates = object-space shading position (measured
            # on the tile proxy: the raw quad coordinates) — three's
            # positionGeometry.
            return {"op": "object_coords"}
        if socket_name == "Generated":
            # Generated = (p - texspace_location) / (2 * texspace_size)
            # + 0.5 (measured: the flat proxy reports size (1,1,1) and a
            # degenerate axis reads 0.5). The runtime supplies the mesh's
            # texspace through BuildTslOptions.
            return {"op": "generated"}
        _refuse(
            f"Texture Coordinate {socket_name!r} has no TSL cell yet"
        )

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
        mode = str(getattr(node, "mode", "RGB")) \
            if idname == "ShaderNodeSeparateColor" else "RGB"
        if mode not in {"RGB", "HSV"}:
            _refuse(f"Separate Color mode {mode!r} has no cell yet")
        # HSV mode relabels the outputs; identifiers stay Red/Green/Blue.
        channel = {
            "Red": "x", "Green": "y", "Blue": "z",
            "R": "x", "G": "y", "B": "z",
        }[getattr(from_socket, "identifier", socket_name)]
        inner = emit_input(node.inputs[0], stack=stack, as_vector=True)
        if mode == "HSV":
            inner = {"op": "rgb_to_hsv", "input": inner}
        return {
            "op": "separate",
            "channel": channel,
            "input": inner,
        }

    if idname == "ShaderNodeCombineXYZ":
        return {
            "op": "combine",
            "x": emit_input(node.inputs["X"], stack=stack),
            "y": emit_input(node.inputs["Y"], stack=stack),
            "z": emit_input(node.inputs["Z"], stack=stack),
        }

    if idname in {"ShaderNodeCombineColor", "ShaderNodeCombineRGB"}:
        mode = str(getattr(node, "mode", "RGB")) \
            if idname == "ShaderNodeCombineColor" else "RGB"
        if mode not in {"RGB", "HSV"}:
            _refuse(f"Combine Color mode {mode!r} has no cell yet")
        expression = {
            "op": "combine",
            "x": emit_input(node.inputs[0], stack=stack),
            "y": emit_input(node.inputs[1], stack=stack),
            "z": emit_input(node.inputs[2], stack=stack),
        }
        if mode == "HSV":
            expression = {"op": "hsv_to_rgb", "input": expression}
        return expression

    if idname == "ShaderNodeInvert":
        return {
            "op": "invert",
            "factor": emit_input(node.inputs["Fac"], stack=stack),
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
        }

    if idname == "ShaderNodeGamma":
        return {
            "op": "gamma",
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
            "gamma": emit_input(node.inputs["Gamma"], stack=stack),
        }

    if idname == "ShaderNodeBrightContrast":
        return {
            "op": "bright_contrast",
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
            "bright": emit_input(node.inputs["Bright"], stack=stack),
            "contrast": emit_input(node.inputs["Contrast"], stack=stack),
        }

    if idname == "ShaderNodeRGBToBW":
        return {
            "op": "rgb_to_bw",
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
        }

    if idname == "ShaderNodeHueSaturation":
        return {
            "op": "hue_sat",
            "hue": emit_input(node.inputs["Hue"], stack=stack),
            "saturation": emit_input(node.inputs["Saturation"], stack=stack),
            "value": emit_input(node.inputs["Value"], stack=stack),
            "factor": emit_input(node.inputs["Fac"], stack=stack),
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
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
        expression = {
            "op": "vector_math",
            "operation": operation,
            "a": emit_input(node.inputs[0], stack=stack, as_vector=True),
        }
        if operation not in _VECTOR_MATH_UNARY:
            expression["b"] = emit_input(node.inputs[1], stack=stack, as_vector=True)
        if operation in _VECTOR_MATH_TERNARY:
            expression["c"] = emit_input(node.inputs[2], stack=stack, as_vector=True)
        if operation in _VECTOR_MATH_VALUE_OUTPUT:
            # The node's scalar "Value" output is the linked one for these.
            expression["scalar"] = True
        return expression

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

    if idname == "ShaderNodeShaderToRGB":
        # EEVEE-only closure capture. The compilable class is a Diffuse
        # BSDF input: the captured value is albedo x diffuse irradiance,
        # gated by EEVEE-render cells under the fixed-light contract
        # (Cycles cannot evaluate this node at all).
        if getattr(from_socket, "identifier", socket_name) != "Color":
            _refuse(
                f"Shader to RGB output {socket_name!r} has no cell yet"
            )
        resolved = _resolve_shader_link(node.inputs["Shader"], stack)
        if resolved is None:
            _refuse("Shader to RGB with an unlinked Shader input")
        source_node, _source_socket, source_stack = resolved
        if source_node.bl_idname != "ShaderNodeBsdfDiffuse":
            _refuse(
                f"Shader to RGB over {source_node.bl_idname} has no cell "
                "yet (Diffuse only)"
            )
        roughness = source_node.inputs["Roughness"]
        if roughness.is_linked or abs(float(roughness.default_value)) > 1e-9:
            _refuse(
                "Shader to RGB over Oren-Nayar Diffuse (roughness > 0) "
                "has no cell yet"
            )
        if source_node.inputs["Normal"].is_linked:
            _refuse(
                "Shader to RGB over a custom-normal Diffuse has no cell yet"
            )
        return {
            "op": "shader_to_rgb_diffuse",
            "color": emit_input(
                source_node.inputs["Color"], source_stack, as_vector=True,
            ),
        }

    if idname == "ShaderNodeTexChecker":
        # Blender 5.2 displays "Fac" as "Factor"; match the identifier.
        checker_output = getattr(from_socket, "identifier", socket_name)
        if checker_output not in {"Color", "Fac"}:
            _refuse(f"Checker output {socket_name!r} unsupported")
        expression = {
            "op": "tex_checker",
            "vector": _texture_vector(node.inputs["Vector"], stack),
            "color1": emit_input(
                node.inputs["Color1"], stack=stack, as_vector=True,
            ),
            "color2": emit_input(
                node.inputs["Color2"], stack=stack, as_vector=True,
            ),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
        }
        if checker_output == "Fac":
            expression["output"] = "fac"
        return expression

    if idname == "ShaderNodeTexGradient":
        if getattr(from_socket, "identifier", socket_name) not in {
            "Color", "Fac",
        }:
            _refuse(f"Gradient output {socket_name!r} unsupported")
        gradient_type = str(node.gradient_type)
        if gradient_type not in {
            "LINEAR", "QUADRATIC", "EASING", "DIAGONAL",
            "RADIAL", "SPHERICAL", "QUADRATIC_SPHERE",
        }:
            _refuse(f"Gradient type {gradient_type!r} has no cell yet")
        return {
            "op": "tex_gradient",
            "gradientType": gradient_type,
            "vector": _texture_vector(node.inputs["Vector"], stack),
        }

    if idname == "ShaderNodeTexMagic":
        magic_output = getattr(from_socket, "identifier", socket_name)
        if magic_output not in {"Color", "Fac"}:
            _refuse(f"Magic output {socket_name!r} has no cell yet")
        return {
            "op": "tex_magic",
            "depth": int(node.turbulence_depth),
            # Fac is the color average.
            "output": "fac" if magic_output == "Fac" else "color",
            "vector": _texture_vector(node.inputs["Vector"], stack),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
            "distortion": emit_input(node.inputs["Distortion"], stack=stack),
        }

    if idname == "ShaderNodeTexWave":
        if getattr(from_socket, "identifier", socket_name) not in {
            "Color", "Fac",
        }:
            _refuse(f"Wave output {socket_name!r} unsupported")
        # The fractal-loop shape must be known at emit time: the builder
        # unrolls octaves like the Noise mapping does.
        detail_socket = node.inputs["Detail"]
        roughness_socket = node.inputs["Detail Roughness"]
        if node.inputs["Distortion"].is_linked:
            _refuse("Wave with a linked Distortion has no cell yet")
        distortion_value = float(node.inputs["Distortion"].default_value)
        detail_value = 0.0
        roughness_value = 0.5
        if distortion_value != 0.0:
            if detail_socket.is_linked:
                _refuse("Wave with a linked Detail has no cell yet")
            if roughness_socket.is_linked:
                _refuse("Wave with a linked Detail Roughness has no cell yet")
            detail_value = float(detail_socket.default_value)
            roughness_value = float(roughness_socket.default_value)
            if detail_value > 2.0:
                _refuse(
                    f"Wave detail {detail_value:g} exceeds the proven "
                    "range (<= 2); high-octave phase divergence measured"
                )
        return {
            "op": "tex_wave",
            "waveType": str(node.wave_type),
            "bandsDirection": str(node.bands_direction),
            "ringsDirection": str(node.rings_direction),
            "profile": str(node.wave_profile),
            "vector": _texture_vector(node.inputs["Vector"], stack),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
            "distortion": distortion_value,
            "detail": detail_value,
            "detailRoughness": roughness_value,
            "detailScale": emit_input(
                node.inputs["Detail Scale"], stack=stack,
            ),
            "phase": emit_input(node.inputs["Phase Offset"], stack=stack),
        }

    if idname == "ShaderNodeTexImage":
        image = node.image
        if image is None:
            _refuse("Image Texture without an image")
        image_output = getattr(from_socket, "identifier", socket_name)
        if image_output not in {"Color", "Alpha"}:
            _refuse(f"Image Texture output {socket_name!r} unsupported")
        interpolation = str(node.interpolation)
        if interpolation not in {"Linear", "Closest"}:
            _refuse(
                f"Image interpolation {interpolation!r} has no cell yet"
            )
        extension = str(node.extension)
        if extension not in {"REPEAT", "EXTEND"}:
            _refuse(f"Image extension {extension!r} has no cell yet")
        projection = str(node.projection)
        if projection not in {"FLAT", "BOX"}:
            _refuse(f"Image projection {projection!r} has no cell yet")
        if projection == "BOX" and abs(
            float(getattr(node, "projection_blend", 0.0)),
        ) > 1e-9:
            _refuse(
                "Image BOX projection with blend > 0 has no cell yet "
                "(sharp box only)"
            )
        if str(getattr(image, "alpha_mode", "STRAIGHT")) != "STRAIGHT":
            _refuse(
                f"Image alpha mode {image.alpha_mode!r} has no cell yet"
            )
        colorspace = str(image.colorspace_settings.name)
        if colorspace not in {"sRGB", "Non-Color", "Raw", "Linear Rec.709"}:
            _refuse(f"Image colorspace {colorspace!r} has no cell yet")
        width, height = int(image.size[0]), int(image.size[1])
        if width <= 0 or height <= 0:
            _refuse("Image Texture with no pixel data")
        if width * height > 128 * 128:
            if not _allow_texture_refs:
                # The IR route embeds pixels (the harness's float oracle);
                # the production texture-binding route carries larger images.
                _refuse(
                    f"Image {width}x{height} exceeds the embedded-IR bound "
                    "(128x128); the texture transport carries it"
                )
            if projection == "BOX":
                _refuse(
                    "Image BOX projection with the texture transport has "
                    "no cell yet (embedded sharp box only)"
                )
            if bool(getattr(image, "is_float", False)):
                _refuse(
                    "Float-buffer image with the texture transport has no "
                    "cell yet (browser decode of float formats unproven)"
                )
            if node.inputs["Vector"].is_linked:
                reference_vector = emit_input(
                    node.inputs["Vector"], stack=stack, as_vector=True,
                )
            else:
                reference_vector = {"op": "uv"}
            # Hardware sampling against the published source bytes; the
            # sRGB decode and alpha association follow the browser's image
            # pipeline (named fidelity note vs the byte-exact embedded
            # oracle). The ref carries the sampling contract so the
            # runtime configures one texture per distinct triple.
            return {
                "op": "texture_ref",
                "ref": {
                    "image": str(image.name),
                    "interpolation": interpolation,
                    "extension": extension,
                },
                "image": {
                    "name": str(image.name),
                    "width": width,
                    "height": height,
                    "colorSpace": colorspace,
                },
                "interpolation": interpolation,
                "extension": extension,
                "output": "alpha" if image_output == "Alpha" else "color",
                "vector": reference_vector,
            }
        pixels = list(image.pixels)
        if len(pixels) != width * height * 4:
            _refuse("Image pixel buffer is not RGBA")
        if colorspace == "sRGB" and bool(getattr(image, "is_float", False)):
            _refuse(
                "Float-buffer sRGB image has no cell yet "
                "(association order unmeasured)"
            )
        if colorspace == "sRGB":
            # Measured against baked ground truth: Cycles associates
            # alpha at load IN BYTE sRGB SPACE with integer floor
            # division (assoc = rgb_byte * alpha_byte // 255), THEN
            # decodes with the exact IEC curve, and the Color output
            # stays associated (zero alpha bakes black; nothing divides
            # back). Data (Non-Color/Raw) images skip all of it.
            def _srgb_to_linear(value):
                if value <= 0.04045:
                    return value / 12.92
                return ((value + 0.055) / 1.055) ** 2.4
            for index in range(0, len(pixels), 4):
                alpha_byte = round(pixels[index + 3] * 255)
                for channel in range(3):
                    byte = round(pixels[index + channel] * 255)
                    associated_byte = (byte * alpha_byte) // 255
                    pixels[index + channel] = _srgb_to_linear(
                        associated_byte / 255,
                    )
        vector_socket = node.inputs["Vector"]
        if vector_socket.is_linked:
            vector_expression = emit_input(
                vector_socket, stack=stack, as_vector=True,
            )
        else:
            # Unlinked Vector on Image Texture means the active UV map.
            vector_expression = {"op": "uv"}
        import math as _math
        embedded = [float(value) for value in pixels]
        if not all(_math.isfinite(value) for value in embedded):
            # NaN/Inf pixels would serialize as non-standard JSON tokens
            # downstream (allow_nan defaults on) and poison the document.
            _refuse("image contains non-finite pixel values")
        return {
            "op": "tex_image",
            "width": width,
            "height": height,
            "pixels": embedded,
            "interpolation": interpolation,
            "extension": extension,
            "output": "alpha" if image_output == "Alpha" else "color",
            **({"projection": "box"} if projection == "BOX" else {}),
            "vector": vector_expression,
        }

    if idname == "ShaderNodeTexWhiteNoise":
        output_id = getattr(from_socket, "identifier", socket_name)
        if output_id not in {"Value", "Color"}:
            _refuse(f"White Noise output {socket_name!r} unsupported")
        dimensions = str(node.noise_dimensions)
        if dimensions not in {"2D", "3D"}:
            _refuse(
                f"White Noise dimensions {dimensions!r} has no cell yet"
            )
        if not node.inputs["Vector"].is_linked:
            _refuse(
                "White Noise with implicit Generated coordinates has no "
                "cell yet"
            )
        vector_expression = emit_input(
            node.inputs["Vector"], stack=stack, as_vector=True,
        )
        # The hash consumes RAW float bits, and interpolated coordinates
        # differ between engines by hundreds of ulps (measured) — the
        # avalanche decorrelates every texel. Only quantized coordinates
        # (a floor/ceil/snap as the last step) are bit-identical across
        # engines and therefore honestly comparable.
        def _contains_uv(item):
            # Every interpolated varying decorrelates raw bits across
            # engines — vertex colors and view terms included, not just
            # coordinate ops.
            if isinstance(item, dict):
                if item.get("op") in {
                    "uv", "generated", "object_coords",
                    "vertex_color", "view_cos",
                }:
                    return True
                return any(_contains_uv(value) for value in item.values())
            if isinstance(item, list):
                return any(_contains_uv(value) for value in item)
            return False
        quantized_root = (
            vector_expression.get("op") == "vector_math"
            and vector_expression.get("operation") in {
                "FLOOR", "CEIL", "SNAP",
            }
        )
        if _contains_uv(vector_expression) and not quantized_root:
            _refuse(
                "White Noise over continuous coordinates decorrelates "
                "across engines (raw-bit hash of interpolated floats); "
                "only quantized (floor/ceil/snap) inputs are comparable"
            )
        return {
            "op": "tex_white_noise",
            "dimensions": 2 if dimensions == "2D" else 3,
            "output": "color" if output_id == "Color" else "value",
            "vector": vector_expression,
        }

    if idname == "ShaderNodeTexVoronoi":
        output_id = getattr(from_socket, "identifier", socket_name)
        if output_id not in {"Distance", "Color"}:
            _refuse(f"Voronoi output {socket_name!r} has no cell yet")
        dimensions = str(node.voronoi_dimensions)
        if dimensions not in {"2D", "3D"}:
            _refuse(f"Voronoi dimensions {dimensions!r} has no cell yet")
        feature = str(node.feature)
        if feature not in {"F1", "SMOOTH_F1"}:
            _refuse(f"Voronoi feature {feature!r} has no cell yet")
        if str(node.distance) != "EUCLIDEAN":
            _refuse(f"Voronoi metric {node.distance!r} has no cell yet")
        if bool(getattr(node, "normalize", False)):
            _refuse("Voronoi normalize has no cell yet")
        detail_socket = node.inputs["Detail"]
        if detail_socket.is_linked or float(detail_socket.default_value) != 0:
            _refuse("Fractal Voronoi (detail > 0) has no cell yet")
        voronoi_scale = emit_input(node.inputs["Scale"], stack=stack)
        if voronoi_scale.get("op") != "const_float":
            _refuse(
                "Voronoi with a non-constant Scale has no bounded cell yet"
            )
        if abs(float(voronoi_scale["value"])) > 40.0 + 1e-9:
            # Voronoi's bound is measured separately from noise: integer
            # cell hashing tolerates coordinate wiggle structurally (only
            # local distances shift), so scale 40 gates where fBM noise
            # is bounded at 20.
            _refuse(
                f"Voronoi scale {float(voronoi_scale['value']):g} "
                "exceeds the proven range (<= 40); sample-position "
                "differences decorrelate high-frequency patterns"
            )
        expression = {
            "op": "tex_voronoi",
            "dimensions": 2 if dimensions == "2D" else 3,
            "feature": "f1",
            "output": "color" if output_id == "Color" else "distance",
            "vector": _texture_vector(node.inputs["Vector"], stack),
            "scale": voronoi_scale,
            "randomness": emit_input(node.inputs["Randomness"], stack=stack),
        }
        if feature == "SMOOTH_F1":
            smoothness_socket = node.inputs["Smoothness"]
            if smoothness_socket.is_linked:
                _refuse("Voronoi with a linked Smoothness has no cell yet")
            # Cycles: params.smoothness = clamp(smoothness / 2, 0, 0.5),
            # and smoothness == 0 falls back to plain F1.
            smoothness = min(
                max(float(smoothness_socket.default_value) / 2.0, 0.0), 0.5,
            )
            if smoothness != 0.0:
                expression["feature"] = "smooth_f1"
                expression["smoothness"] = smoothness
        return expression

    if idname == "ShaderNodeRGBCurve":
        # Cycles itself bakes RGB Curves into a sampled table
        # (curvemapping_color_to_array with the composite C curve applied
        # before each channel curve) — the LUT route IS the faithful port.
        if socket_name != "Color":
            _refuse(f"RGB Curves output {socket_name!r} unsupported")
        mapping = node.mapping
        if not bool(getattr(mapping, "use_clip", True)):
            _refuse("RGB Curves without clipping has no cell yet")
        if (abs(float(mapping.clip_min_x)) > 1e-6
                or abs(float(mapping.clip_max_x) - 1.0) > 1e-6):
            _refuse("RGB Curves with a non-unit X range has no cell yet")
        mapping.initialize()
        curves = mapping.curves
        samples = 257
        values = []
        for index in range(samples):
            position = index / (samples - 1)
            composite = mapping.evaluate(curves[3], position)
            values.extend((
                float(mapping.evaluate(curves[0], composite)),
                float(mapping.evaluate(curves[1], composite)),
                float(mapping.evaluate(curves[2], composite)),
                1.0,
            ))
        return {
            "op": "curve_rgb",
            "samples": samples,
            "values": values,
            "factor": emit_input(node.inputs["Fac"], stack=stack),
            "input": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
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
        if blend not in _MIX_BLEND_TYPES:
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
        noise_output = getattr(from_socket, "identifier", socket_name)
        if noise_output not in {"Fac", "Color"}:
            _refuse(f"Noise output {socket_name!r} has no cell yet")
        noise_type = str(getattr(node, "noise_type", "FBM"))
        if noise_type != "FBM":
            _refuse(f"Noise type {noise_type!r} has no cell yet")
        if not bool(getattr(node, "normalize", True)):
            _refuse("Unnormalized noise has no cell yet")
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
        detail_value = float(node.inputs["Detail"].default_value)
        if detail_value > 4.0 + 1e-9:
            # Detail 4 is the proven range (the noise-detail4 cell; the
            # original bound of 2 came from the detail-6/scale-5 3.9e-2
            # phase-divergence measurement). Higher octave counts amplify
            # float phase differences past channel tolerance; the
            # Material bake carries those channels faithfully instead.
            _refuse(
                f"Noise detail {detail_value:g} exceeds the proven range "
                "(<= 4); high-octave phase divergence measured"
            )
        # Resolve the Scale expression FIRST: a linked scale that folds to
        # a constant through group walls (the splash corpus feeds noise
        # scales through group inputs) is boundable like any literal.
        scale_expression = emit_input(node.inputs["Scale"], stack=stack)
        if scale_expression.get("op") != "const_float":
            _refuse("Noise with a non-constant Scale has no bounded cell yet")
        if abs(float(scale_expression["value"])) > 20.0 + 1e-9:
            # Sub-texel sample-position differences between the two
            # rasterizers (~3e-5 in UV) multiply by the scale; measured at
            # scale 100 (ellie hair) the channel decorrelates to 1.8e-1
            # while scale 16 stays inside tolerance. Material bake carries
            # higher frequencies faithfully.
            _refuse(
                f"Noise scale {float(scale_expression['value']):g} "
                "exceeds the proven range (<= 20); sample-position "
                "differences decorrelate high-frequency noise"
            )
        lacunarity = node.inputs.get("Lacunarity")
        expression = {
            "op": "noise",
            "output": "fac" if noise_output == "Fac" else "color",
            "dimensions": 2 if dimensions == "2D" else 3,
            "detail": float(node.inputs["Detail"].default_value),
            "roughness": float(node.inputs["Roughness"].default_value),
            "lacunarity": (
                float(lacunarity.default_value)
                if lacunarity is not None else 2.0
            ),
            "scale": scale_expression,
            "input": _texture_vector(vector, stack),
        }
        if noise_output == "Color":
            # Cycles noise color lanes are the same fBM at constant
            # hash-derived offsets (noisetex.h random_floatN_offset).
            # The seeds are DIMENSION-DEPENDENT: distortion consumes the
            # low seeds per dimension, so 2D color uses (2, 3) and 3D
            # uses (3, 4) — measured: the wrong pair decorrelates both
            # offset lanes at 1e-1 while Fac stays at 4e-5.
            count = 2 if dimensions == "2D" else 3
            seeds = (2.0, 3.0) if dimensions == "2D" else (3.0, 4.0)
            expression["colorOffsets"] = [
                _noise_random_offset(seed, count) for seed in seeds
            ]
        return expression

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
        attribute_type = str(getattr(node, "attribute_type", "GEOMETRY"))
        if attribute_type == "OBJECT":
            # A per-object custom property (the shared-material,
            # per-object-tint pattern). The value resolves per object:
            # bake receivers carry the property, and the runtime reads
            # the exported extras through a per-object uniform.
            attribute_output = getattr(from_socket, "identifier", socket_name)
            if attribute_output not in {"Color", "Vector", "Fac"}:
                _refuse(
                    f"Attribute OBJECT output {socket_name!r} has no cell yet"
                )
            name = str(getattr(node, "attribute_name", "") or "")
            if not name:
                _refuse("Attribute OBJECT without a property name")
            return {
                "op": "attribute_object",
                "name": name,
                "output": attribute_output.lower(),
            }
        if attribute_type != "GEOMETRY":
            _refuse(
                f"Attribute type {node.attribute_type!r} has no cell yet"
            )
        attribute_output = getattr(from_socket, "identifier", socket_name)
        color = {
            "op": "vertex_color",
            "layer": str(getattr(node, "attribute_name", "") or ""),
        }
        if attribute_output == "Color":
            return color
        if attribute_output == "Fac":
            # Cycles: the Fac output of a color attribute is the average
            # of its three components.
            return {
                "op": "math", "operation": "MULTIPLY",
                "a": {
                    "op": "math", "operation": "ADD",
                    "a": {
                        "op": "math", "operation": "ADD",
                        "a": {"op": "separate", "channel": "x",
                              "input": color},
                        "b": {"op": "separate", "channel": "y",
                              "input": color},
                    },
                    "b": {"op": "separate", "channel": "z", "input": color},
                },
                "b": {"op": "const_float", "value": 1.0 / 3.0},
            }
        _refuse(f"Attribute output {socket_name!r} has no cell yet")

    if idname == "ShaderNodeMapRange":
        if str(getattr(node, "data_type", "FLOAT")) != "FLOAT":
            _refuse(f"Map Range data type {node.data_type!r} has no cell yet")
        interpolation = str(getattr(node, "interpolation_type", "LINEAR"))
        if interpolation not in {"LINEAR", "SMOOTHSTEP", "SMOOTHERSTEP"}:
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

    encoded = _json.dumps(expression)
    if '"view_cos"' in encoded:
        # A view-dependent channel can never take the tile-bake routes; the
        # TSL runtime is its only faithful transport.
        document["viewDependent"] = True
    if '"shader_to_rgb_diffuse"' in encoded:
        # Captured lighting: only the TSL runtime (or an EEVEE-render
        # oracle under the light contract) can evaluate it.
        document["lightDependent"] = True
    return document
