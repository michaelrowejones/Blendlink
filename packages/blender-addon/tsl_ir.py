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

from contextlib import contextmanager
from contextvars import ContextVar

IR_MODEL = "blendlink-tsl-ir-v1"

_evaluation_engine = ContextVar("blendlink_tsl_evaluation_engine", default=None)


def _normalize_evaluation_engine(engine):
    engine = str(engine)
    return "EEVEE" if engine in {"EEVEE", "BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"} else engine


def get_evaluation_engine():
    """Effective source engine, scoped to the selected material output."""
    import bpy
    engine = _evaluation_engine.get()
    return _normalize_evaluation_engine(engine if engine is not None else bpy.context.scene.render.engine)


@contextmanager
def emission_context(*, tree=None, target=None, evaluation_engine=None):
    """Explicit output targets win; an ALL output follows the source scene.

    Reset on every exit so a refused channel, nested surface emission or a
    later material cannot inherit another root's evaluation semantics.
    """
    if evaluation_engine is None and tree is not None and target is not None:
        import bpy
        output = _active_material_output(tree, target)
        selected = str(getattr(output, "target", "ALL"))
        evaluation_engine = selected if selected != "ALL" else bpy.context.scene.render.engine
    engine = get_evaluation_engine() if evaluation_engine is None else _normalize_evaluation_engine(evaluation_engine)
    token = _evaluation_engine.set(engine)
    try:
        yield engine
    finally:
        _evaluation_engine.reset(token)

# Blender Math operations with proven differential cells.  The builder maps
# DIVIDE/MODULO/POWER to Blender's safe-math wrappers; the full declared
# scalar enum sweep is covered by native-node differential cells.
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
    "PROJECT", "REFLECT", "REFRACT", "FACEFORWARD", "ROUND", "POWER", "SIGN",
}
# ROUND/POWER/SIGN are available in newer native Blender versions; the
# differential runner records actual native operation availability.
_VECTOR_MATH_UNARY = {
    "NORMALIZE", "FLOOR", "CEIL", "FRACTION", "ABSOLUTE", "LENGTH",
    "SINE", "COSINE", "TANGENT", "ROUND", "SIGN",
}
_VECTOR_MATH_TERNARY = {"MULTIPLY_ADD", "WRAP", "FACEFORWARD"}
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


def _hash_float_to_float(x):
    """util/hash.h hash_float_to_float: the ONE-argument Jenkins member."""
    seed = (0xDEADBEEF + (1 << 2) + 13) & 0xFFFFFFFF
    return _jenkins_final(
        (seed + _float_bits(x)) & 0xFFFFFFFF, seed, seed,
    ) / 0xFFFFFFFF


# The per-object extra the exporter stamps and the runtime reads back through
# userData. One reserved name, shared by the emitter, the exporter and the
# differential harness, so it cannot drift apart silently.
OBJECT_RANDOM_PROPERTY = "blendlink_object_random"


def object_random_number(name: str) -> float:
    """Cycles' Object Info Random for a non-instanced object, from its name.

    Verbatim: ``object->set_random_id(hash_uint2(hash_string(name), 0))``
    (intern/cycles/scene/object.cpp), where ``hash_string`` is ``i = i*37 + c``
    per byte; EEVEE computes the identical value via BLI_hash_string /
    BLI_hash_int_2d, so both engines agree. Verified against a Blender 5.2
    render to float32 ('Cube' -> 0.313141934, 'Ellie' -> 0.556522661).

    Renaming the object changes the value -- in Blender too, so this matches
    the oracle rather than diverging from it. Instanced duplis do NOT use the
    name hash (their random_id carries a persistent-id chain and a
    root-object XOR); the exporter only stamps real exported objects, which
    is exactly the population this derivation is correct for.
    """
    accumulated = 0
    for byte in str(name).encode("utf-8"):
        accumulated = (accumulated * 37 + byte) & 0xFFFFFFFF
    seed = (0xDEADBEEF + (2 << 2) + 13) & 0xFFFFFFFF
    return _jenkins_final(
        (seed + accumulated) & 0xFFFFFFFF, seed, seed,
    ) / 0xFFFFFFFF


def _noise_gpu_renderer():
    try:
        import gpu
        return gpu.platform.renderer_get() or ''
    except Exception:
        # A headless planning process can lack an initialized graphics
        # context. Unidentified hardware never acquires a measured profile.
        return ''


def _noise_shader_offset_profile(engine, host_platform, architecture, gpu_backend, version, renderer=''):
    """Measured shader-stage arithmetic, separate from MF eligibility.

    Legacy Linux x64 Cycles and measured Linux x64 llvmpipe shaders round the hash conversion,
    product and sum separately. Modern Cycles and Metal/ARM shader folding stay
    separate from their MF-eligible constant path.
    Concrete offsets ship in IR, so runtime behavior never guesses the host.
    """
    if engine == 'CYCLES' and version < (5, 0, 0) and host_platform.startswith('linux') and architecture.lower() in {'x86_64', 'amd64'}:
        return 'cycles-legacy-linux-x64-f32'
    if engine == 'EEVEE' and host_platform.startswith('linux') and architecture.lower() in {'x86_64', 'amd64'} \
            and gpu_backend == 'OPENGL' and 'llvmpipe' in renderer.lower():
        return 'eevee-llvmpipe-f32'
    return None


def _normalized_noise_source_profile(engine, host_platform, architecture, cycles_device='CPU'):
    """Only measured fresh normalized source profiles; old IR stays separate."""
    if engine == 'EEVEE':
        return 'native-standard-f32'
    if (engine == 'CYCLES' and cycles_device == 'CPU' and host_platform == 'darwin'
            and architecture.lower() in {'arm64', 'aarch64'}):
        return 'cycles-neon-fma'
    return None


def _noise_random_offset(seed, count, *, native_mf=False, native_float4=False, native_shader_f32=False, native_shader_fused=False):
    """noisetex.h random_floatN_offset for a constant seed.

    The scalar helper is NOT the vec2 hash with a zero lane:
    ``random_float_offset`` calls ``hash_float_to_float(seed)`` -- the
    one-argument hash -- while every vector arity calls
    ``hash_vec2_to_float(vec2(seed, index))``. Conflating them emits valid
    but WRONG offsets for 1D distortion and colour lanes, which decorrelates
    the field at ~9e-2 while everything else measures exact.
    """
    hashes = ([_hash_float_to_float(seed)] if count == 1 else
              [_hash_float2_to_float(seed, float(index)) for index in range(count)])
    if native_shader_fused:
        import struct
        f32 = lambda value: struct.unpack('f', struct.pack('f', value))[0]
        # Cycles NEON shader code rounds the uint quotient, then contracts
        # 100*q+100. Its low-seed offsets differ from both legacy models.
        return [f32(100 + f32(f32(round(value * 0xFFFFFFFF)) / f32(0xFFFFFFFF)) * 100)
                for value in hashes]
    if native_mf or native_float4 or native_shader_f32:
        import struct
        f32 = lambda value: struct.unpack('f', struct.pack('f', value))[0]
        # The shared hash helpers retain the exact uint quotient in double.
        # Recovering its integer is exact (<2^-20 rounding error), then model
        # BLI's float conversion, multiply and addition separately. Material
        # MF evaluation differs from the lower-dimensional shader's folded
        # offset here; the native float4 path also uses separate operations.
        return [f32(100 + f32(f32(f32(round(value * 0xFFFFFFFF)) / f32(0xFFFFFFFF)) * 100))
                for value in hashes]
    return [100.0 + value * 100.0 for value in hashes]


def _fold_constant_scalar(expression):
    """Evaluate a pure-constant scalar IR subtree to a float, else None.

    Covers the wrapper shapes corpus graphs put around literal knobs
    (Clamp over group-input constants); anything genuinely varying stays
    None so the caller refuses by name."""
    if not isinstance(expression, dict):
        return None
    op = expression.get("op")
    if op == "const_float":
        return float(expression["value"])
    if op == "clamp01":
        value = _fold_constant_scalar(expression.get("input"))
        if value is None:
            return None
        return min(max(value, 0.0), 1.0)
    if op == "clamp_minmax":
        value = _fold_constant_scalar(expression.get("value"))
        low = _fold_constant_scalar(expression.get("min"))
        high = _fold_constant_scalar(expression.get("max"))
        if value is None or low is None or high is None:
            return None
        return min(max(value, low), high)
    if op == "math":
        operation = str(expression.get("operation", ""))
        a = _fold_constant_scalar(expression.get("a"))
        b = _fold_constant_scalar(expression.get("b"))
        if a is None or b is None:
            return None
        if operation == "ADD":
            return a + b
        if operation == "SUBTRACT":
            return a - b
        if operation == "MULTIPLY":
            return a * b
        if operation == "DIVIDE":
            # Cycles safe divide: b == 0 -> 0.
            return a / b if b != 0.0 else 0.0
        if operation == "MINIMUM":
            return min(a, b)
        if operation == "MAXIMUM":
            return max(a, b)
        if operation == "MULTIPLY_ADD":
            c = _fold_constant_scalar(expression.get("c"))
            if c is None:
                return None
            return a * b + c
        return None
    return None


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


# Declared approximations for the channel currently being emitted, drained by
# emit_channel/emit_surface. The peer of _refuse: where _refuse means "this
# cannot ship", _approximate means "this ships and here is exactly how far off
# it is, and which cells prove the algorithm underneath". Every code must have
# a matching claim:approximate cell in the differential harness -- a bare
# string here with no cell behind it is the failure mode this whole tier exists
# to prevent.
_approximations: list = []

_APPROXIMATION_CELLS = {
    "tsl.noise-3d-scale-above-exact": {
        "cell": "noise-3d-scale200",
        "divergenceKind": "bounded",
        "provenBy": ["noise-scale80", "noise-scale40"],
        "detail": (
            "3D noise between scale 80 and 200. Same mechanism as the 1D and "
            "2D bands: exact algorithm (the proven fBM over MaterialX "
            "Perlin), sample-position divergence measured at the corpus "
            "maximum and monotone in scale."
        ),
    },
    "tsl.noise-1d-scale-above-exact": {
        "cell": "noise-1d-scale1600",
        "divergenceKind": "bounded",
        "provenBy": ["noise-1d", "noise-1d-detail0"],
        "detail": (
            "1D noise between scale 80 and 1600. The algorithm is exact "
            "(perlin_1d port, gated by the provenBy cells); the divergence is "
            "the harness rasterizers' ~3e-5 UV sample-position difference "
            "multiplied by the frequency, measured at the corpus maximum and "
            "monotone in scale, so the declared figure bounds every smaller "
            "scale in the band."
        ),
    },
    "tsl.noise-2d-scale-above-exact": {
        "cell": "noise-2d-scale100-color",
        "divergenceKind": "bounded",
        "provenBy": ["noise-2d", "noise-scale80"],
        "detail": (
            "2D noise between scale 80 and 100, Fac and Color lanes. Same "
            "mechanism as the 1D band: exact algorithm, sample-position "
            "divergence measured at the corpus maximum."
        ),
    },
    "tsl.voronoi-smooth-f1-scale-above-exact": {
        "cell": "voronoi-scale177-smoothf1",
        "divergenceKind": "bounded",
        "provenBy": ["voronoi-smooth-f1", "voronoi-scale40"],
        "detail": (
            "Smooth F1 voronoi between scale 40 and 180. Integer-cell "
            "hashing shifts only local distances under coordinate wiggle and "
            "the smooth minimum damps them further, but at 177.1 the residual "
            "is measurably over the exact gate, so it ships declared."
        ),
    },
    "tsl.voronoi-color-winner-flip": {
        "cell": "voronoi-scale155-f1-color",
        "divergenceKind": "bounded",
        "provenBy": ["voronoi-f1", "voronoi-scale40"],
        "detail": (
            "Voronoi COLOR output at ANY scale: F1 distance is continuous "
            "across a winner flip, but the winning-cell hash colour is "
            "not, so sample-position wiggle near a cell boundary flips a "
            "sparse set of texels to an unrelated colour -- maxAbs O(1) "
            "with tiny mean. Measured sparsely at scale 6 over the object "
            "domain (one texel, maxAbs 0.207) and densely at 155 by the "
            "named cell, whose declared budget upper-bounds every smaller "
            "scale. The <=40 exact bound was earned on the Distance "
            "output and never transferred to Color."
        ),
    },
    "tsl.voronoi-f1-color-scale-above-exact": {
        "cell": "voronoi-scale155-f1-color",
        "divergenceKind": "bounded",
        "provenBy": ["voronoi-f1", "voronoi-scale40"],
        "detail": (
            "F1 voronoi COLOR output between scale 40 and 160. Measured at "
            "155: more than 99% of texels agree exactly (p99Abs 0) because "
            "the ~3e-5 sample-position wiggle is only ~5e-3 of a cell "
            "width; the divergence is confined to boundary texels whose "
            "winning cell flips to a different hash colour (meanAbs "
            "2.45e-3, maxAbs 0.819). The hash-to-colour algebra is proven "
            "at low scale by voronoi-f1; scale robustness to 40 by "
            "voronoi-scale40."
        ),
    },
    "tsl.white-noise-continuous-uv": {
        "cell": "white-noise-continuous-uv",
        "divergenceKind": "decorrelated",
        "provenBy": ["hash-probe", "white-noise"],
        "detail": (
            "White Noise hashes the raw bits of an interpolated coordinate, "
            "and the two rasterizers' interpolated UVs differ by ulps, so the "
            "Jenkins avalanche decorrelates every texel. The PORT is exact -- "
            "gated byte-for-byte by hash-probe on constant input and by "
            "white-noise over quantized blocks. What is approximate is only "
            "the sample position, so the field is statistically identical and "
            "per-texel different, which is what Blender's own two engines also "
            "produce for this node. The mechanism is arity-independent (1D/2D/3D/4D hash raw bits identically); the hash arities are proven separately by hash-probe and the white-noise family of cells."
        ),
    },
}


def _approximate(code: str) -> None:
    """Declare a named, cell-backed approximation for this channel."""
    record = _APPROXIMATION_CELLS.get(code)
    if record is None:
        raise TslIrRefusal(
            f"approximation code {code!r} has no declared cell; an "
            "approximation without measured evidence is not shippable"
        )
    entry = {"code": code, **record}
    if entry not in _approximations:
        _approximations.append(entry)


def drain_approximations() -> list:
    """Take and clear the approximations declared since the last drain."""
    global _approximations
    drained, _approximations = _approximations, []
    return drained



# Production opt-in (Phase 4 Track C): over-budget images emit texture_ref
# ops resolved against published image assets instead of refusing. The
# differential harness never sets this — its cells keep the byte-exact
# embedded-pixel contract.
_allow_texture_refs = False

# The highest Noise Texture Scale a gated differential cell has measured
# inside tolerance. Raising this REQUIRES a passing cell at the new value:
# fBM octave phases amplify the harness's ~3e-5 UV sample-position wiggle,
# so noise cannot inherit Voronoi's separately-earned bound of 40 (see
# `voronoi-scale40`, whose integer-cell hashing only shifts local
# distances). Cells: `noise-scale16`, `noise-scale20`, `noise-scale40`.
_NOISE_SCALE_BOUND = 80.0
# Above the exact bound, per-dimension APPROXIMATE bands ship as declared,
# cell-measured approximations instead of refusing. Keyed by the emitter's
# dimensions string; a dimension with no band still refuses above the exact
# bound. One number cannot carry two claims, which is why these are separate
# constants from the exact bound rather than a raised copy of it.
_NOISE_SCALE_APPROXIMATE_BOUNDS = {"1D": 1600.0, "2D": 200.0, "3D": 400.0}
_VORONOI_SMOOTH_F1_APPROXIMATE_BOUND = 180.0
# F1 COLOR only: the splash corpus asks for 150/155. Measured 2026-07-30
# at 155: even with ~0.8-texel cells, the ~3e-5 sample-position wiggle is
# only ~5e-3 of a cell width, so MORE THAN 99% of texels agree exactly
# (p99Abs 0) and only boundary texels flip winners (maxAbs 0.819,
# meanAbs 2.45e-3) -- bounded with a fat tail, NOT the decorrelated
# regime the refusal message used to predict. F1 Distance above 40 still
# refuses: it would be bounded-class too, but nothing needs it yet and
# an unmeasured band is not shippable.
_VORONOI_F1_COLOR_APPROXIMATE_BOUND = 160.0
_VORONOI_SCALE_BOUND = 40.0
_NOISE_DETAIL_BOUND = 6.0


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


def find_principled_root(tree, target="CYCLES"):
    """(principled, group_stack) for the material's single Principled surface.

    The stack is the chain of group-instance nodes enclosing the Principled,
    outermost first — the context `emit_channel` needs to resolve channel
    inputs fed through Group Input sockets. The selected output's actual
    shader-link path owns the instance context; unrelated output targets or
    unused group instances cannot change which graph gets compiled.
    """
    if tree is None:
        _refuse("material has no shader node tree")
    node, _socket, stack = _active_surface_link(tree, target)
    if node.bl_idname != "ShaderNodeBsdfPrincipled":
        _refuse("no single Principled surface for " + target)
    return node, stack


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
            # Same internal_links bypass as emit_output, for shader
            # sockets: a muted Mix Shader passes one branch through.
            bypass = None
            for internal in node.internal_links:
                if internal.to_socket.identifier == from_socket.identifier:
                    bypass = internal.from_socket
                    break
            if bypass is None:
                _refuse(
                    f"muted node {idname} has no internal bypass to "
                    f"{from_socket.name!r}"
                )
            source = _socket_source(bypass)
            continue
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


def _active_material_output(tree, target):
    """One shared selection for shader traversal and evaluation context."""
    # The active flag is global, not one flag per renderer. Native Blender
    # can select a unique engine-targeted output even when another engine's
    # output carries that flag. Its read-only API is authoritative here.
    native = getattr(tree, "get_output_node", None)
    if callable(native):
        return native(target)
    actives = [
        node for node in tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
        and getattr(node, "is_active_output", True)
    ]
    return next(
        (node for node in actives
         if str(getattr(node, "target", "ALL")) == target),
        None,
    ) or next(
        (node for node in actives
         if str(getattr(node, "target", "ALL")) == "ALL"),
        None,
    )


def _active_surface_link(tree, target):
    """Resolve the requested engine output, falling back to ALL by name."""
    output = _active_material_output(tree, target)
    if output is None:
        _refuse("material has no " + target + "-visible active Material Output")
    resolved = _resolve_shader_link(output.inputs["Surface"], ())
    if resolved is None:
        _refuse("material output has no linked Surface")
    return resolved


def resolve_surface(tree, target="CYCLES"):
    return _surface_expression(*_active_surface_link(tree, target))


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
    # The Fac socket is FLOAT: a color-driven mix factor takes Cycles'
    # implicit COLOR->FLOAT conversion exactly like Mix.Factor does --
    # the splash outline class drives MixShader.Fac with a vertex color,
    # and omitting the conversion is the same class of defect the
    # mix-factor-color-ramp cell pinned (caught here by the surface tap
    # baking through a real Math input, which Blender converts).
    factor = _scalar_input(expression["fac_socket"], expression["fac_stack"])
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
    if any(('"'+name+'"') in encoded for name in ('normal_map_native','normal_view_native','tangent_native','normal_map_tangent_native')):
        document['viewDependent'] = True
    if any(('"'+name+'"') in encoded for name in ('normal_map','normal_view','normal_map_native','normal_view_native','tangent_native','normal_map_tangent_native')):
        document["geometryDependent"] = True
    if '"ambient_occlusion"' in encoded:
        # Scene occlusion is not carried: the runtime evaluates the
        # unoccluded algebra unless a baked occlusion source is wired
        # into the hook. Declared, like viewDependent and
        # lightDependent, so no consumer can mistake the passthrough
        # for ray-traced AO.
        document["geometryDependent"] = True
    if '"shader_to_rgb_diffuse"' in encoded:
        document["lightDependent"] = True
    return document


def emit_normal_channel(socket, stack=(), *, evaluation_engine=None):
    if evaluation_engine is not None:
        with emission_context(evaluation_engine=evaluation_engine):
            return emit_normal_channel(socket, stack)
    expression=emit_input(socket, stack, as_vector=True)
    if __package__:
        from . import normal_ir
    else:
        import normal_ir
    normals=[];normal_ir.requirements(expression,normals)
    if __package__:
        from . import tangent_ir
        from . import normal_map_tangent_ir
    else:
        import tangent_ir
        import normal_map_tangent_ir
    tangents=[];tangent_ir.requirements(expression,tangents)
    tangent_maps=[];normal_map_tangent_ir.requirements(expression,tangent_maps)
    if __package__:
        from . import bump_ir
    else:
        import bump_ir
    if (get_evaluation_engine() == 'EEVEE' and expression.get('op') == 'geometry_context'
            and expression.get('output') == 'normal' and expression.get('sourceEngine') == 'EEVEE'):
        return _channel_document({"op": "normal_view_native", "input": expression})
    if bump_ir.contains(expression):
        if not bump_ir.unit_normal(expression):
            _refuse('No-height Bump normal channels need a direct verified unit-normal source; linked zero/nonunit or transformed vectors remain unproved')
        return _channel_document({"op": "normal_view_native", "input": expression})
    if (normals or tangents or tangent_maps) and expression.get('op') not in {'normal_map_native','tangent_native','normal_map_tangent_native'}:
        _refuse('Native Normal Map normal channels currently require a direct unit-normal output; downstream vector normalization is not certified yet')
    if normals or tangents or tangent_maps: return _channel_document({"op": "normal_view_native", "input": expression})
    return _channel_document({"op": "normal_view", "input": expression})


def emit_surface(tree, target="CYCLES"):
    """Emit one selected surface without leaking its engine to another root."""
    with emission_context(tree=tree, target=target):
        return _emit_surface(tree, target)


def _emit_surface(tree, target="CYCLES"):
    """Per-channel IR documents for a mixed surface expression.

    The documented projection model: a Mix Shader closure lerp becomes a
    per-channel parameter lerp (exact for emission radiance and alpha
    coverage; an approximation for Metallic/Roughness, whose closure mix
    is nonlinear under lighting), Transparent branches contribute only
    coverage, Diffuse/Glossy canonicalize onto the Principled channel
    vector, and emission always ships as radiance with strength 1."""
    channels = _fold_surface(resolve_surface(tree, target))
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



def _fold_constant_vector(expression):
    if not isinstance(expression, dict):
        return None
    if expression.get("op") == "const_vec3":
        values = expression.get("value")
        return [float(item) for item in values] if isinstance(values, list) and len(values) == 3 else None
    if expression.get("op") == "combine":
        values = [_fold_constant_scalar(expression.get(axis)) for axis in ("x", "y", "z")]
        return values if all(item is not None for item in values) else None
    if expression.get('op') == 'color_convert' and expression.get('mode') == 'RGB':
        return _fold_constant_vector(expression.get('input'))
    return None



def _vector_provably_nonzero(expression):
    import math
    constant = _fold_constant_vector(expression)
    if constant is not None:
        return all(math.isfinite(item) for item in constant) and any(item != 0 for item in constant)
    if isinstance(expression, dict) and expression.get("op") == "combine":
        components = [_fold_constant_scalar(expression.get(axis)) for axis in ("x", "y", "z")]
        return any(item is not None and math.isfinite(item) and item != 0 for item in components)
    return False


def _fold_vector_prescale(expression):
    """Conservative max-axis multiplier applied to a coordinate BEFORE
    a texture's Scale socket. Wooden_Bars multiplies Object coords by
    (1, 100, 100) ahead of a scale-4 noise: effective frequency 400,
    while the bound saw 4 and the chain shipped claiming exact inside
    the measured float32-divergence class. Folds only what is certain --
    constant vector_math MULTIPLY/SCALE factors and the texture-panel
    mapping wrapper -- and returns 1.0 for anything else, which keeps
    every unfoldable input exactly as blind as before but NAMED here
    rather than silently: a linked non-constant pre-scale remains the
    known residual gap."""
    factor = 1.0
    current = expression
    for _ in range(16):
        if not isinstance(current, dict):
            break
        op = current.get("op")
        if op == 'color_convert' and current.get('mode') == 'RGB':
            current = current.get('input')
            continue
        if op == "mapping":
            if current.get("vectorType") == "NORMAL" or any(key in current for key in ("locationNode", "rotationNode", "scaleNode")):
                _refuse("Mapping NORMAL or varying transforms feeding a frequency-bounded texture have no proven coordinate-frequency bound")
            scales = [abs(float(v)) for v in current.get("scale", [1.0])]
            if current.get("vectorType") == "TEXTURE":
                # Texture Mapping is the inverse transform. Safe divide
                # collapses zero-scale axes, while a small nonzero scale
                # increases frequency instead of reducing it.
                scales = [1.0 / value if value != 0.0 else 0.0 for value in scales]
            factor *= max(scales)
            current = current.get("input")
            continue
        if op == "vector_transform":
            if current.get("from") != current.get("to"):
                _refuse("Vector Transform feeding a frequency-bounded texture needs an explicit scene-transform frequency bound")
            current = current.get("input")
            continue
        if op == "vector_rotate":
            center = current.get("centerNode")
            varying = center is not None and _fold_constant_vector(center) is None
            if current.get("rotationType") == "EULER_XYZ":
                varying = varying or _fold_constant_vector(current.get("rotation")) is None
            else:
                varying = varying or _fold_constant_scalar(current.get("angle")) is None \
                    or _fold_constant_vector(current.get("axis")) is None
            if varying:
                _refuse("Vector Rotate varying transforms feeding a frequency-bounded texture have no proven coordinate-frequency bound")
            current = current.get("input")
            continue
        if op == "vector_math" and current.get("operation") in {"PROJECT", "REFLECT", "REFRACT", "FACEFORWARD", "ROUND", "POWER", "SIGN"}:
            _refuse("Vector Math geometric/nonlinear transforms feeding a frequency-bounded texture have no proven coordinate-frequency bound")
        if op == "vector_scale":
            scale = current.get("scale")
            folded = _fold_constant_scalar(scale) if scale else None
            if folded is None:
                break
            factor *= abs(folded)
            current = current.get("input")
            continue
        if op == "vector_math" and current.get("operation") == "MULTIPLY":
            a = current.get("a")
            b = current.get("b")
            const = None
            varying = None
            for side, other in ((a, b), (b, a)):
                if isinstance(side, dict) and side.get("op") == "const_vec3":
                    const, varying = side, other
                    break
            if const is None:
                break
            factor *= max(abs(float(v)) for v in const.get("value", [1.0]))
            current = varying
            continue
        break
    return factor


def _scalar_input(socket, stack):
    """A float input socket. The implicit COLOR->FLOAT conversion now
    lives in ``_convert_link`` (applied by emit_input at EVERY link, the
    way Cycles applies it); this wrapper remains only as the historical
    name at the Mix/Math factor call sites."""
    return emit_input(socket, stack=stack)


def _texture_vector(socket, stack, node=None):
    """A texture node's Vector input: its link's expression, or Generated
    coordinates when unlinked (Blender's implicit default).

    When the owning ``node`` is supplied, its Texture-panel transform
    (``node.texture_mapping`` -- the collapsed Mapping section every
    texture node carries) wraps the coordinate. Cycles applies it BEFORE
    the Scale socket; ignoring it decorrelated cube-diorama's bluebell
    and plants.leaf noises (panel scales (0.8, 0.16, 1.0) and
    (0.8, 0.07, 1.0)); with the mapping applied the CPU-exact chains
    match the bake at 1e-5. Refuses by name for the shapes the proven
    mapping cell does not cover."""
    expression = (
        emit_input(socket, stack=stack, as_vector=True)
        if socket.is_linked else {"op": "generated"}
    )
    mapping = getattr(node, "texture_mapping", None) if node else None
    if mapping is None:
        return expression
    location = [float(v) for v in mapping.translation]
    rotation = [float(v) for v in mapping.rotation]
    scale = [float(v) for v in mapping.scale]
    identity = (
        all(abs(v) <= 1e-9 for v in location)
        and all(abs(v) <= 1e-9 for v in rotation)
        and all(abs(v - 1.0) <= 1e-9 for v in scale)
    )
    if identity:
        return expression
    if str(mapping.vector_type) != "POINT":
        _refuse(
            f"texture panel mapping type {mapping.vector_type!r} has no "
            "cell yet"
        )
    if bool(getattr(mapping, "use_min", False)) or bool(
        getattr(mapping, "use_max", False)
    ):
        _refuse("texture panel mapping min/max clamp has no cell yet")
    if abs(rotation[0]) > 1e-9 or abs(rotation[1]) > 1e-9:
        _refuse(
            "texture panel mapping X/Y rotation has no cell yet (Z only)"
        )
    # Rides the PROVEN mapping op (mapping-rotate / mapping-texture-mode
    # cells): POINT order scale-rotate-translate matches Cycles'
    # TextureMapping compile.
    return {
        "op": "mapping",
        "vectorType": "POINT",
        "input": expression,
        "location": location,
        "rotation": rotation,
        "scale": scale,
    }


def _require_static_tree(node):
    tree = getattr(node, "id_data", None)
    animation = getattr(tree, "animation_data", None)
    if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
        _refuse(f"node tree {tree.name!r} has animation or drivers; live curve transport is required")


def emit_input(socket, stack=(), *, as_vector=False):
    """IR for one input socket: its link's expression or its constant."""
    _require_static_tree(socket.node)
    source = _socket_source(socket)
    if source is None:
        if socket.type in {"INT", "BOOLEAN"}:
            if __package__:
                from .utility_ir import typed_constant
            else:
                from utility_ir import typed_constant
            return typed_constant(socket, _refuse)
        value = _constant_value(socket)
        if value is None:
            _refuse(f"socket {socket.name!r} has no usable constant")
        return _vector(value) if as_vector else _scalar(value)
    node, from_socket = source
    return _convert_link(emit_output(node, from_socket, stack), from_socket, socket)


def _convert_link(expression, from_socket, to_socket):
    """Cycles' implicit link conversion, applied AT THE LINK.

    Cycles inserts NODE_CONVERT_CF -- linear_rgb_to_gray -- on every
    COLOR-to-FLOAT link (intern/cycles/kernel/svm/convert.h); rgb_to_bw's
    Rec.709 row is that function verbatim. The first miss (plants.leaf's
    Mix.Factor) was patched at the consumer socket; the splash outline
    class then hid the SAME conversion one group wall away -- a vertex
    color wired into a group's float input, where no consumer-site check
    can see it. Cycles' actual rule is per-LINK, group boundaries
    included, so the emitter's is now too: this runs on every linked
    socket emit_input resolves, in both group directions. FLOAT->COLOR
    broadcast needs no op (scalar replication is what both Cycles and
    TSL broadcasting do); vector-to-float (NODE_CONVERT_VF, component
    average) refuses by name until a cell exists."""
    from_type = str(getattr(from_socket, "type", ""))
    to_type = str(getattr(to_socket, "type", ""))
    if from_type != to_type and ({from_type, to_type} & {"INT", "BOOLEAN"}):
        if __package__:
            from .utility_ir import convert
        else:
            from utility_ir import convert
        return convert(expression, from_type, to_type, _refuse)
    if to_type == "VECTOR" and from_type == "VALUE":
        # An explicit broadcast survives group boundaries and later vector
        # component reads. Relying on arithmetic broadcasting alone can leave
        # a Vector socket represented by one scalar expression.
        return {"op": "combine", "x": expression, "y": expression, "z": expression}
    if to_type == "VALUE" and from_type == "RGBA":
        return {"op": "rgb_to_bw", "input": expression}
    if to_type == "VALUE" and from_type == "VECTOR":
        _refuse(
            "implicit vector-to-float conversion (component average) "
            "has no cell yet"
        )
    return expression


def emit_output(node, from_socket, stack=()):
    """IR for one node output.  Refuses anything without a proven cell.

    ``stack`` is the enclosing group-instance chain, outermost first; the
    walk crosses group walls in both directions with it.
    """
    _require_static_tree(node)
    idname = node.bl_idname
    socket_name = from_socket.name

    if getattr(node, "mute", False):
        # A muted node bypasses per its OWN internal_links -- Blender's
        # authoritative statement of which input each output passes
        # through, the same data the renderer uses. Reading it beats any
        # hand table: per-node bypass rules (first matching-type socket)
        # live in Blender and can change there. The muted-math and
        # muted-mix-color cells gate the mechanism against the bake.
        for internal in node.internal_links:
            if internal.to_socket.identifier == from_socket.identifier:
                return emit_input(
                    internal.from_socket, stack=stack,
                    as_vector=from_socket.type in {"VECTOR", "RGBA"},
                )
        _refuse(
            f"muted node {idname} has no internal bypass to "
            f"{socket_name!r}"
        )

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
        if socket_name in {"Camera", "Normal", "Window", "Reflection"}:
            if __package__:
                from .geometry_ir import emit_geometry
            else:
                from geometry_ir import emit_geometry
            return emit_geometry(node, from_socket, refuse=_refuse, engine=get_evaluation_engine())
        if socket_name == "UV":
            return {"op": "uv_active"}
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

    if idname == "ShaderNodeNewGeometry":
        if __package__:
            from .geometry_ir import emit_geometry
        else:
            from geometry_ir import emit_geometry
        return emit_geometry(node, from_socket, refuse=_refuse, engine=get_evaluation_engine())

    if idname == "ShaderNodeUVMap":
        uv_map = str(getattr(node, "uv_map", "") or "")
        return {"op": "uv", "uvMap": uv_map} if uv_map else {"op": "uv_active"}

    if idname == "ShaderNodeRGB":
        return _vector(_constant_value(node.outputs["Color"]))

    if idname == "ShaderNodeValue":
        return _scalar(_constant_value(node.outputs["Value"]))

    if idname == "ShaderNodeNormal":
        if __package__:
            from .normal_direction_ir import emit_normal_direction
        else:
            from normal_direction_ir import emit_normal_direction
        return emit_normal_direction(node, from_socket, engine=get_evaluation_engine(),
            emit_vector=lambda socket: emit_input(socket, stack=stack, as_vector=True), refuse=_refuse)

    if idname == "FunctionNodeInputVector":
        return _vector(list(node.vector))

    if idname in {"FunctionNodeInputBool", "FunctionNodeInputInt", "FunctionNodeBooleanMath", "FunctionNodeIntegerMath"}:
        if __package__:
            from .utility_ir import emit_utility
        else:
            from utility_ir import emit_utility
        return emit_utility(node, lambda socket: emit_input(socket, stack=stack), _refuse, get_evaluation_engine())

    if idname == "ShaderNodeSeparateXYZ":
        return {
            "op": "separate",
            "channel": {"X": "x", "Y": "y", "Z": "z"}[socket_name],
            "input": emit_input(node.inputs["Vector"], stack=stack, as_vector=True),
        }

    if idname in {"ShaderNodeSeparateColor", "ShaderNodeSeparateRGB", "ShaderNodeCombineColor", "ShaderNodeCombineRGB"}:
        if __package__:
            from .color_ir import emit_color_conversion
        else:
            from color_ir import emit_color_conversion
        return emit_color_conversion(node, from_socket,
            emit_input=lambda socket, as_vector=False: emit_input(socket, stack=stack, as_vector=as_vector),
            refuse=_refuse, evaluation_engine=get_evaluation_engine())

    if idname == "ShaderNodeCombineXYZ":
        return {
            "op": "combine",
            "x": emit_input(node.inputs["X"], stack=stack),
            "y": emit_input(node.inputs["Y"], stack=stack),
            "z": emit_input(node.inputs["Z"], stack=stack),
        }

    if idname == "ShaderNodeInvert":
        return {
            "op": "invert",
            "factor": _scalar_input(node.inputs["Fac"], stack),
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
            "factor": _scalar_input(node.inputs["Fac"], stack),
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
        if operation == "MODULO":
            import bpy
            try:
                from .math_modulo_native_ir import qualify_modulo
            except ImportError:
                from math_modulo_native_ir import qualify_modulo
            expression = qualify_modulo(expression, engine=get_evaluation_engine(),
                backend=str(bpy.context.preferences.system.gpu_backend), version=bpy.app.version, refuse=_refuse)
        if getattr(node, "use_clamp", False):
            expression = {
                "op": "clamp01", "input": expression,
            }
        return expression

    if idname == "ShaderNodeAmbientOcclusion":
        # Cycles ray-traces this; no material node can. The translation
        # carries the node's ALGEBRA (Color output = input colour x AO
        # factor) with the factor supplied by a runtime hook that defaults
        # to 1.0 -- the unoccluded value, and exactly what Cycles evaluates
        # on the harness's lone flat tile, so the passthrough gates exact
        # there. Scene occlusion is a geometry-dependent quantity the
        # document DECLARES it does not carry (the geometryDependent marker,
        # the lightDependent precedent); the runtime hook is where a baked
        # aoMap plugs in later. The splash corpus authors 31 of these, all
        # white-input Color-output.
        output_id = getattr(from_socket, "identifier", socket_name)
        if output_id not in {"Color", "AO"}:
            _refuse(f"Ambient Occlusion output {socket_name!r} unsupported")
        if bool(getattr(node, "inside", False)):
            _refuse("Ambient Occlusion 'Inside' has no cell yet")
        if bool(getattr(node, "only_local", False)):
            _refuse("Ambient Occlusion 'Only Local' has no cell yet")
        normal_socket = node.inputs.get("Normal")
        if normal_socket is not None and normal_socket.is_linked:
            _refuse("Ambient Occlusion with a linked Normal has no cell yet")
        return {
            "op": "ambient_occlusion",
            "output": "ao" if output_id == "AO" else "color",
            "color": emit_input(
                node.inputs["Color"], stack=stack, as_vector=True,
            ),
        }

    if idname == "ShaderNodeObjectInfo":
        output_id = getattr(from_socket, "identifier", socket_name)
        if output_id != "Random":
            if __package__:
                from . import tsl_object_info
            else:
                import tsl_object_info
            output = tsl_object_info.OUTPUTS.get(output_id)
            if output is None:
                _refuse(f"Object Info output {socket_name!r} has no verified mapping")
            return {"op": "object_info", "output": output}
        # A per-object constant, so it rides the proven attribute_object
        # seam: the exporter stamps OBJECT_RANDOM_PROPERTY on every exported
        # mesh object (export_scene.emit_gltf), GLTFLoader lands it in
        # userData, and the runtime's onObjectUpdate uniform delivers it per
        # draw. A material SHARED by several objects therefore gets each
        # object's own value -- per-object behaviour, not a baked average.
        # 'fac' averages the resolver's (r, r, r) back to the scalar.
        return {
            "op": "attribute_object",
            "name": OBJECT_RANDOM_PROPERTY,
            "output": "fac",
        }

    if idname in {"ShaderNodeBlackbody", "ShaderNodeWavelength"}:
        if __package__:
            from .spectral_ir import emit_spectral
        else:
            from spectral_ir import emit_spectral
        return emit_spectral(node, from_socket,
                             emit_input=lambda socket: emit_input(socket, stack=stack), refuse=_refuse,
                             evaluation_engine=get_evaluation_engine(),
                             fold_scalar=_fold_constant_scalar)

    if idname == "ShaderNodeVectorTransform":
        if __package__:
            from .vector_transform_ir import emit_vector_transform
        else:
            from vector_transform_ir import emit_vector_transform
        return emit_vector_transform(node, from_socket,
                                     emit_input=lambda socket: emit_input(socket, stack=stack, as_vector=True),
                                     refuse=_refuse, engine=get_evaluation_engine())

    if idname == "ShaderNodeVectorRotate":
        rotation_type = str(getattr(node, "rotation_type", "AXIS_ANGLE"))
        if rotation_type not in {"AXIS_ANGLE", "X_AXIS", "Y_AXIS", "Z_AXIS", "EULER_XYZ"}:
            _refuse(f"Vector Rotate type {rotation_type!r} has no cell")
        center_socket = node.inputs["Center"]
        expression = {
            "op": "vector_rotate", "rotationType": rotation_type,
            "invert": bool(getattr(node, "invert", False)),
            "input": emit_input(node.inputs["Vector"], stack=stack, as_vector=True),
            "center": [float(item) for item in center_socket.default_value],
        }
        if _socket_source(center_socket) is not None:
            expression["centerNode"] = emit_input(center_socket, stack=stack, as_vector=True)
        if rotation_type == "EULER_XYZ":
            expression["rotation"] = emit_input(node.inputs["Rotation"], stack=stack, as_vector=True)
        else:
            axis_literal = {"X_AXIS": [1.0, 0.0, 0.0], "Y_AXIS": [0.0, 1.0, 0.0],
                            "Z_AXIS": [0.0, 0.0, 1.0]}.get(rotation_type)
            expression["axis"] = {"op": "const_vec3", "value": axis_literal} if axis_literal is not None \
                else emit_input(node.inputs["Axis"], stack=stack, as_vector=True)
            expression["angle"] = emit_input(node.inputs["Angle"], stack=stack)
            expression["normalizeAxis"] = axis_literal is None
        return expression

    if idname == "ShaderNodeVectorMath":
        operation = str(node.operation)
        if operation not in _VECTOR_MATH_OPERATIONS:
            _refuse(f"Vector Math operation {operation!r} has no cell yet")
        output_id = getattr(from_socket, "identifier", socket_name)
        expected_output = "Value" if operation in _VECTOR_MATH_VALUE_OUTPUT else "Vector"
        if output_id != expected_output:
            _refuse(f"Vector Math {operation} inactive output {output_id!r}")
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
        if operation in {"REFLECT", "REFRACT"}:
            import bpy
            # Older Cycles normalizes zero unsafely, yielding nonfinite values.
            # Do not imitate downstream render sanitization. 5.2+ uses the
            # explicitly safe-zero native contract proved by its own cells.
            safe_zero = bpy.app.version >= (5, 2, 0)
            if not safe_zero and not _vector_provably_nonzero(expression["b"]):
                _refuse("Vector Math " + operation + " before Blender 5.2 requires a provably nonzero normal; zero normalization has no finite native value")
            expression["normalMode"] = "safe-zero" if safe_zero else "nonzero-required"
        if operation == "POWER":
            bases = _fold_constant_vector(expression["a"])
            exponents = _fold_constant_vector(expression["b"])
            if bases is not None and exponents is not None and any(
                    base == 0.0 and exponent < 0.0 for base, exponent in zip(bases, exponents)):
                _refuse("Vector Math POWER zero base with a negative exponent has no finite native value")
        if operation == "REFRACT":
            expression["ior"] = emit_input(node.inputs["Scale"], stack=stack)
        if operation in _VECTOR_MATH_VALUE_OUTPUT:
            # The node's scalar "Value" output is the linked one for these.
            expression["scalar"] = True
        return expression

    if idname == "ShaderNodeMapping":
        vector_type = str(getattr(node, "vector_type", "POINT"))
        if vector_type not in {"POINT", "TEXTURE", "VECTOR", "NORMAL"}:
            _refuse(f"Mapping type {vector_type!r} has no cell yet")
        expression = {
            "op": "mapping", "vectorType": vector_type,
            "input": emit_input(node.inputs["Vector"], stack=stack, as_vector=True),
            "location": [0.0, 0.0, 0.0],
        }
        names = ("Rotation", "Scale") if vector_type in {"VECTOR", "NORMAL"} else ("Location", "Rotation", "Scale")
        for name in names:
            socket = node.inputs[name]
            key = name.lower()
            expression[key] = [float(item) for item in socket.default_value]
            if _socket_source(socket) is not None:
                linked = emit_input(socket, stack=stack, as_vector=True)
                folded = _fold_constant_vector(linked)
                if folded is not None:
                    expression[key] = folded
                else:
                    expression[key + "Node"] = linked
        return expression

    if idname == "ShaderNodeValToRGB":
        if __package__:
            from .ramps_ir import emit_context_ramp
        else:
            from ramps_ir import emit_context_ramp
        contextual = emit_context_ramp(node, from_socket,
            incoming=lambda: emit_input(node.inputs['Fac'], stack=stack),
            refuse=_refuse, evaluation_engine=get_evaluation_engine())
        if contextual is not None:
            return contextual
        ramp = node.color_ramp
        color_mode = str(getattr(ramp, "color_mode", "RGB"))
        interpolation = str(ramp.interpolation)
        if socket_name not in {"Color", "Alpha"}:
            _refuse(f"ColorRamp output {socket_name!r} unsupported")
        if color_mode in {"HSV", "HSL"}:
            hue_interpolation = str(ramp.hue_interpolation)
            if hue_interpolation not in {"NEAR", "FAR", "CW", "CCW"}:
                _refuse(f"ColorRamp hue direction {hue_interpolation!r} has no cell")
            if interpolation not in {"LINEAR", "CONSTANT", "EASE", "B_SPLINE", "CARDINAL"}:
                _refuse(f"ColorRamp interpolation {interpolation!r} has no cell")
            # Cycles' colorramp_to_array exports RAMP_TABLE_SIZE+1=257
            # samples of the native evaluator. Its shader uses a floor lookup
            # for CONSTANT and linear lookup otherwise. This preserves the
            # actual shader's sampling, rather than approximating its continuous
            # evaluator with a denser but visibly different function at kinks.
            samples = 257
            values = [float(item) for index in range(samples)
                      for item in ramp.evaluate(index / (samples - 1))]
            lookup = "FLOOR" if interpolation == "CONSTANT" else "LINEAR"
            return {
                "op": "ramp_lut",
                "channel": "alpha" if socket_name == "Alpha" else "rgb",
                "samples": samples, "values": values, "lookup": lookup,
                "sourceColorMode": color_mode,
                "sourceHueInterpolation": hue_interpolation,
                "sourceInterpolation": interpolation,
                "sampling": {"method": "native-cycles-257-table", "lookup": lookup},
                "input": emit_input(node.inputs["Fac"], stack=stack),
            }
        if color_mode != "RGB":
            _refuse(f"ColorRamp color mode {color_mode!r} has no cell")
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
        # LUT; the builder interpolates between exact texels. Existing RGB
        # B_SPLINE/CARDINAL cells gate this fixed 257-sample route; no universal
        # bound is inferred for arbitrarily narrow native stop intervals.
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

    if idname == "ShaderNodeTexBrick":
        if __package__:
            from .brick_ir import emit_brick
        else:
            from brick_ir import emit_brick
        return emit_brick(node, from_socket,
                          emit_scalar=lambda socket: emit_input(socket, stack=stack),
                          emit_vector=lambda socket: _texture_vector(socket, stack, node) if socket == node.inputs["Vector"]
                          else emit_input(socket, stack=stack, as_vector=True),
                          refuse=_refuse, fold_scalar=_fold_constant_scalar)

    if idname == "ShaderNodeTexChecker":
        # Blender 5.2 displays "Fac" as "Factor"; match the identifier.
        checker_output = getattr(from_socket, "identifier", socket_name)
        if checker_output not in {"Color", "Fac"}:
            _refuse(f"Checker output {socket_name!r} unsupported")
        expression = {
            "op": "tex_checker",
            "vector": _texture_vector(node.inputs["Vector"], stack, node),
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
            "vector": _texture_vector(node.inputs["Vector"], stack, node),
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
            "vector": _texture_vector(node.inputs["Vector"], stack, node),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
            "distortion": emit_input(node.inputs["Distortion"], stack=stack),
        }

    if idname == "ShaderNodeTexWave":
        import math
        if getattr(from_socket, "identifier", socket_name) not in {
            "Color", "Fac",
        }:
            _refuse(f"Wave output {socket_name!r} unsupported")
        # The fractal-loop shape must be known at emit time: the builder
        # unrolls octaves like the Noise mapping does.
        detail_socket = node.inputs["Detail"]
        roughness_socket = node.inputs["Detail Roughness"]
        distortion_socket = node.inputs["Distortion"]
        distortion_linked = distortion_socket.is_linked
        distortion_value = float(distortion_socket.default_value)
        detail_value = 0.0
        roughness_value = 0.5
        roughness_expression = None
        if distortion_linked or distortion_value != 0.0:
            if detail_socket.is_linked:
                _refuse("Wave with a linked Detail has no cell yet")
            if roughness_socket.is_linked:
                if __package__:
                    from .color_ir import _unit_bounded
                else:
                    from color_ir import _unit_bounded
                roughness_expression = emit_input(roughness_socket, stack=stack)
                if not _unit_bounded(roughness_expression):
                    _refuse('Wave linked Detail Roughness needs a proven [0,1] input; use an authored Clamp for unbounded values')
            detail_value = float(detail_socket.default_value)
            roughness_value = float(roughness_socket.default_value)
            if not all(math.isfinite(value) for value in [detail_value, roughness_value, distortion_value]):
                _refuse('Wave fractal parameters must be finite')
            if not 0.0 <= detail_value <= 2.0:
                _refuse(
                    f"Wave detail {detail_value:g} is outside the proven "
                    "range [0,2]; negative-detail semantics and high-octave phase divergence are not ported"
                )
        return {
            "op": "tex_wave",
            "precisionModel": "portable-f32-v1",
            "waveType": str(node.wave_type),
            "bandsDirection": str(node.bands_direction),
            "ringsDirection": str(node.rings_direction),
            "profile": str(node.wave_profile),
            "vector": _texture_vector(node.inputs["Vector"], stack, node),
            "scale": emit_input(node.inputs["Scale"], stack=stack),
            "distortion": distortion_value,
            **({"distortionNode": emit_input(distortion_socket, stack=stack)} if distortion_linked else {}),
            "detail": detail_value,
            "detailRoughness": roughness_value,
            **({"detailRoughnessNode": roughness_expression} if roughness_expression is not None else {}),
            "detailScale": emit_input(
                node.inputs["Detail Scale"], stack=stack,
            ),
            "phase": emit_input(node.inputs["Phase Offset"], stack=stack),
        }

    if idname == "ShaderNodeTexImage":
        import bpy
        image = node.image
        if image is None:
            _refuse("Image Texture without an image")
        if str(getattr(image, "source", "")) not in {"FILE", "GENERATED"}:
            _refuse("Image Texture needs a static FILE or GENERATED image; media, tiles and viewer buffers need a separate transport")
        animation = getattr(image, "animation_data", None)
        if animation and (animation.action or len(animation.drivers) or len(animation.nla_tracks)):
            _refuse("Image Texture datablock has animation or drivers; live image animation transport is required")
        if get_evaluation_engine() == "EEVEE" and getattr(bpy.context.preferences.system, "gpu_backend", "OPENGL") not in {"METAL", "OPENGL"}:
            _refuse("Native image sampling has no verified GPU backend model")
        image_output = getattr(from_socket, "identifier", socket_name)
        if image_output not in {"Color", "Alpha"}:
            _refuse(f"Image Texture output {socket_name!r} unsupported")
        interpolation = str(node.interpolation)
        # Native Image Texture routes Smart to the same cubic B-spline
        # sampler. Canonicalize its authored selector only after accepting
        # the actual native menu; external cubic transport remains refused.
        if interpolation not in {"Linear", "Closest", "Cubic", "Smart"}:
            _refuse(f"Image interpolation {interpolation!r} has no cell yet")
        if interpolation == "Smart":
            interpolation = "Cubic"
        extension = str(node.extension)
        if extension not in {"REPEAT", "EXTEND", "MIRROR", "CLIP"}:
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
            if interpolation == "Cubic":
                _refuse("Image Cubic interpolation with the texture transport has no proven cubic sampler (embedded Cubic only)")
            if extension not in {"REPEAT", "EXTEND"}:
                _refuse("Image Mirror/Clip extension with the texture transport has no verified sampler (embedded images only)")
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
                reference_vector = {"op": "uv_active"}
            # Hardware sampling against the published source bytes; the
            # sRGB decode and alpha association follow the browser's image
            # pipeline (named fidelity note vs the byte-exact embedded
            # oracle). The ref carries the sampling contract so the
            # runtime configures one texture per distinct triple.
            return {
                "op": "texture_ref",
                "sourceEngine": get_evaluation_engine(),
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
        if get_evaluation_engine() == "EEVEE" and bool(getattr(image, "is_float", False)) and colorspace in {"Non-Color", "Raw"}:
            # The native GPU image upload treats float buffers as associated
            # storage even for data images, then unassociates each texel. The
            # data-color node clears alpha without reversing that conversion.
            # Zero-alpha pixels retain their authored RGB, as native controls
            # explicitly verify; dividing them would destroy valid data.
            for index in range(0, len(pixels), 4):
                alpha = pixels[index + 3]
                if alpha not in {0.0, 1.0}:
                    for channel in range(3):
                        pixels[index + channel] /= alpha
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
        gpu_half_image = get_evaluation_engine() == "EEVEE" and bool(getattr(image, "is_float", False)) and bool(getattr(image, "use_half_precision", False))
        if gpu_half_image:
            import numpy as np
            source = np.asarray(pixels, dtype=np.float32)
            if not np.isfinite(source).all() or np.any(np.abs(source) > 65504):
                _refuse("Image half-float upload exceeds its finite range; disable Half Precision on the source image")
            # Native image uploads use GPU float-to-half conversion. This path
            # remains truncating on Metal even after color-band uploads moved
            # to CPU nearest-even conversion in Blender5.0.
            half = source.astype(np.float16)
            away = np.abs(half.astype(np.float32)) > np.abs(source)
            half = np.where(away, np.nextafter(half, np.float16(0)), half)
            pixels = half.astype(np.float32).tolist()
        vector_socket = node.inputs["Vector"]
        if vector_socket.is_linked:
            vector_expression = emit_input(
                vector_socket, stack=stack, as_vector=True,
            )
        else:
            # Unlinked Vector on Image Texture means the active UV map.
            vector_expression = {"op": "uv_active"}
        import math as _math
        embedded = [float(value) for value in pixels]
        if not all(_math.isfinite(value) and abs(value) <= 3.4028234663852886e38 for value in embedded):
            # NaN/Inf pixels would serialize as non-standard JSON tokens
            # downstream (allow_nan defaults on) and poison the document.
            _refuse("image contains pixel values outside finite float32 transport")
        return {
            "op": "tex_image",
            "sourceEngine": get_evaluation_engine(),
            "sourceImageStorage": "rgba16f" if gpu_half_image else "rgba32f" if bool(getattr(image, "is_float", False)) else "rgba8",
            "sourceImageUploadRounding": "toward-zero" if gpu_half_image else "none",
            **({"nativeGpuBackend": getattr(bpy.context.preferences.system, "gpu_backend", "OPENGL")}
               if get_evaluation_engine() == "EEVEE" else {}),
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
        if dimensions not in {"1D", "2D", "3D", "4D"}:
            _refuse(
                f"White Noise dimensions {dimensions!r} has no cell yet"
            )
        # 1D consumes the W socket alone (the node has no Vector socket
        # in that mode); 4D consumes Vector AND W. Verbatim per
        # gpu_shader_material_tex_white_noise.glsl: 1D hashes
        # hash_float_to_float(w), 4D hashes float4(vector, w).
        w_expression = None
        if dimensions == "1D":
            vector_expression = emit_input(node.inputs["W"], stack=stack)
        else:
            vector_socket = node.inputs.get("Vector")
            if vector_socket is None or not vector_socket.is_linked:
                _refuse(
                    "White Noise with implicit Generated coordinates has "
                    "no cell yet"
                )
            vector_expression = emit_input(
                vector_socket, stack=stack, as_vector=True,
            )
            if dimensions == "4D":
                w_expression = emit_input(node.inputs["W"], stack=stack)
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
                    "uv", "uv_active", "generated", "object_coords",
                    "vertex_color", "view_cos",
                }:
                    return True
                return any(_contains_uv(value) for value in item.values())
            if isinstance(item, list):
                return any(_contains_uv(value) for value in item)
            return False
        def _quantized_root(expression):
            # A scalar W quantizes through math FLOOR/CEIL/SNAP; vectors
            # through vector_math. Both make the hashed bits
            # integer-valued and bit-identical across engines.
            return (
                expression.get("op") in {"vector_math", "math"}
                and expression.get("operation") in {
                    "FLOOR", "CEIL", "SNAP",
                }
            )
        quantized_root = _quantized_root(vector_expression) and (
            w_expression is None
            or _quantized_root(w_expression)
            or not _contains_uv(w_expression)
        )
        if (
            _contains_uv(vector_expression)
            or (w_expression is not None and _contains_uv(w_expression))
        ) and not quantized_root:
            # Ships as a DECLARED approximation rather than refusing. The hash
            # port itself is exact and separately gated; only the sample
            # position diverges, so the two fields agree in distribution and
            # differ per texel. Blender does not hold its own two engines to
            # per-pixel agreement on this node either.
            _approximate("tsl.white-noise-continuous-uv")
        return {
            "op": "tex_white_noise",
            "dimensions": {"1D": 1, "2D": 2, "4D": 4}.get(dimensions, 3),
            "output": "color" if output_id == "Color" else "value",
            "vector": vector_expression,
            **({"w": w_expression} if w_expression is not None else {}),
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
        voronoi_scale_magnitude = abs(float(voronoi_scale["value"]))
        if (
            voronoi_scale_magnitude > _VORONOI_SCALE_BOUND + 1e-9
            and feature == "SMOOTH_F1"
            and voronoi_scale_magnitude
            <= _VORONOI_SMOOTH_F1_APPROXIMATE_BOUND + 1e-9
        ):
            # Only the measured features have bands; F1 Distance above 40
            # could earn its own (bounded-class) cell when something needs
            # it.
            _approximate("tsl.voronoi-smooth-f1-scale-above-exact")
        elif (
            voronoi_scale_magnitude > _VORONOI_SCALE_BOUND + 1e-9
            and feature == "F1"
            and output_id == "Color"
            and voronoi_scale_magnitude
            <= _VORONOI_F1_COLOR_APPROXIMATE_BOUND + 1e-9
        ):
            # The splash shape: 19 nodes, 3D F1 EUCLIDEAN randomness 1.0,
            # Color output, group-linked Scale folding to 150/155. Bounded
            # with a fat boundary-texel tail -- see the band constant.
            _approximate("tsl.voronoi-f1-color-scale-above-exact")
        elif abs(float(voronoi_scale["value"])) > _VORONOI_SCALE_BOUND + 1e-9:
            # Voronoi's bound is measured separately from noise: integer
            # cell hashing tolerates coordinate wiggle structurally (only
            # local distances shift), so scale 40 gates where fBM noise
            # needed its own ladder. That structural tolerance does NOT
            # extend indefinitely: scale 177.1 -- the frequency ellie.head,
            # ellie.head_lips and ellie.skin ask for -- measured meanAbs
            # 3.01e-3 and p99 6.11e-3 on 2026-07-30, over both gates by ~3x
            # and ~1.2x though maxAbs 6.18e-3 stays inside. So it is a real
            # divergence and an approximation candidate, not a bound to
            # raise. No cell records it because a cell draws its IR from
            # this emitter and cannot outlive the bound.
            _refuse(
                f"Voronoi scale {float(voronoi_scale['value']):g} "
                f"exceeds the proven range (<= {_VORONOI_SCALE_BOUND:g}); "
                "sample-position "
                "differences decorrelate high-frequency patterns"
            )
        if (
            output_id == "Color"
            and voronoi_scale_magnitude <= _VORONOI_SCALE_BOUND + 1e-9
        ):
            # Above the exact bound the Color band's declaration already
            # includes the flip tail; at or below it the tail is the ONLY
            # divergence and still needs declaring -- Color is not
            # Distance, and the exact bound was never earned for it.
            _approximate("tsl.voronoi-color-winner-flip")
        expression = {
            "op": "tex_voronoi",
            "dimensions": 2 if dimensions == "2D" else 3,
            "feature": "f1",
            "output": "color" if output_id == "Color" else "distance",
            "vector": _texture_vector(node.inputs["Vector"], stack, node),
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

    if idname in {"ShaderNodeFloatCurve", "ShaderNodeVectorCurve", "ShaderNodeRGBCurve"}:
        if __package__:
            from .curves_ir import emit_curve
        else:
            from curves_ir import emit_curve
        return emit_curve(node, from_socket,
                          emit_input=lambda socket, as_vector=False: emit_input(socket, stack=stack, as_vector=as_vector),
                          refuse=_refuse, evaluation_engine=get_evaluation_engine())

    if idname in {"ShaderNodeMix", "ShaderNodeMixRGB"}:
        if idname == "ShaderNodeMix":
            data_type = str(getattr(node, "data_type", ""))
            if data_type in {"FLOAT", "VECTOR"}:
                is_vector = data_type == "VECTOR"
                suffix = "Vector" if is_vector else "Float"
                if str(getattr(from_socket, "identifier", "")) != f"Result_{suffix}":
                    _refuse(f"Mix {data_type} inactive output has no cell")
                factor_mode = str(getattr(node, "factor_mode", "UNIFORM"))
                if factor_mode not in {"UNIFORM", "NON_UNIFORM"}:
                    _refuse(f"Mix factor mode {factor_mode!r} has no cell yet")
                factor_id = "Factor_Vector" if is_vector and factor_mode == "NON_UNIFORM" \
                    else "Factor_Float"
                sockets = {item.identifier: item for item in node.inputs}
                factor = emit_input(sockets[factor_id], stack=stack,
                                    as_vector=factor_id == "Factor_Vector")
                if bool(getattr(node, "clamp_factor", True)):
                    factor = {"op": "clamp01", "input": factor}
                # Native Float/Vector Mix ignores the color-only blend and
                # result-clamp properties. No color-space conversion applies.
                return _lerp_scalar(
                    emit_input(sockets[f"A_{suffix}"], stack=stack, as_vector=is_vector),
                    emit_input(sockets[f"B_{suffix}"], stack=stack, as_vector=is_vector),
                    factor,
                )
            if data_type != "RGBA":
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
            "factor": _scalar_input(factor, stack),
            "a": emit_input(a_input, stack=stack, as_vector=True),
            "b": emit_input(b_input, stack=stack, as_vector=True),
        }

    if idname == "ShaderNodeTexNoise":
        import math
        import bpy
        # Blender 5.2 displays the output as "Factor"; the identifier stays
        # "Fac" across versions.
        noise_output = getattr(from_socket, "identifier", socket_name)
        if noise_output not in {"Fac", "Color"}:
            _refuse(f"Noise output {socket_name!r} has no cell yet")
        noise_type = str(getattr(node, "noise_type", "FBM"))
        if noise_type not in {"FBM", "MULTIFRACTAL", "HETERO_TERRAIN", "HYBRID_MULTIFRACTAL", "RIDGED_MULTIFRACTAL"}:
            _refuse(f"Noise type {noise_type!r} has no cell yet")
        normalize_output = noise_type == 'FBM' and bool(getattr(node, "normalize", True))
        dimensions = str(getattr(node, "noise_dimensions", "3D"))
        # 1D shipped 2026-07-30, second attempt. The first failed at 1.79e-1
        # because hashUint1's all-literal b/c seeds CONST-FOLDED in WGSL, and a
        # WGSL const-expression that overflows u32 is a compile error, not a
        # wrap -- the shader never built and the harness read back the previous
        # render. Two .toVar() calls fix it; the stage-by-stage GPU-vs-CPU
        # bisection that found it is run-debug1d.mjs in the differential
        # harness. 4D uses the separately proved grad4/16-tap quad_mix port.
        if dimensions not in {"1D", "2D", "3D", "4D"}:
            _refuse(
                f"Noise dimensions {dimensions!r} has no cell yet"
            )
        roughness_expression = None
        def _folded_noise_scalar(name, default):
            nonlocal roughness_expression
            # Same contract as Scale below: a linked value that folds to a
            # constant through group walls (the ellie paint corpus drives
            # Detail/Roughness through value + Clamp plumbing) is boundable
            # like any literal; genuinely varying inputs refuse by name.
            socket = node.inputs.get(name)
            if socket is None:
                return float(default)
            if not socket.is_linked:
                return float(socket.default_value)
            expression = emit_input(socket, stack=stack)
            folded = _fold_constant_scalar(expression)
            if folded is not None:
                if __package__:
                    from .noise_varying_ir import float32_safe_noise_scalar
                else:
                    from noise_varying_ir import float32_safe_noise_scalar
                if not float32_safe_noise_scalar(expression):
                    _refuse(f'Noise linked {name} requires literal float32/Clamp inputs; arithmetic folding needs source baking')
            if folded is None:
                if name == 'Roughness':
                    if __package__:
                        from .noise_varying_ir import unit_roughness
                    else:
                        from noise_varying_ir import unit_roughness
                    if not unit_roughness(expression):
                        _refuse('Noise linked Roughness needs a proven [0,1] input; use an authored Clamp for unbounded values')
                    roughness_expression = expression
                    return 1.0  # Independent conservative amplitude bound.
                _refuse(
                    f"Noise with a non-constant {name} has no cell yet "
                    f"(source op {expression.get('op')!r})"
                )
            return folded

        # 1D noise has no Vector socket at all -- the node swaps it for W --
        # so this cannot be fetched unconditionally.
        vector = node.inputs.get("Vector")
        detail_value = _folded_noise_scalar("Detail", 0.0)
        roughness_value = _folded_noise_scalar("Roughness", 0.5)
        lacunarity_value = _folded_noise_scalar("Lacunarity", 2.0)
        native_varying = normalize_output and roughness_expression is not None and get_evaluation_engine() == 'EEVEE'
        if native_varying and bpy.context.preferences.system.gpu_backend not in {'METAL','OPENGL'}:
            _refuse('Native varying Noise has no verified EEVEE GPU backend profile')
        normalized_native = normalize_output and (roughness_expression is None or native_varying)
        precise_fractal = not normalize_output or roughness_expression is not None or normalized_native
        if roughness_expression is not None and detail_value > 2:
            _refuse('Noise varying Roughness requires static Detail <= 2 in the proven domain')
        offset_value = _folded_noise_scalar('Offset', 0) if noise_type in {'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'} else 0
        gain_value = _folded_noise_scalar('Gain', 1) if noise_type in {'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'} else 1
        amplitude_bound = None
        if noise_type != 'FBM':
            if __package__:
                from .noise_fractal_ir import fractal_amplitude_bound
            else:
                from noise_fractal_ir import fractal_amplitude_bound
            try: amplitude_bound = fractal_amplitude_bound(noise_type, detail_value, roughness_value, offset_value, gain_value)
            except ValueError as error: _refuse(str(error))
        if precise_fractal and (
                not all(math.isfinite(value) for value in [detail_value, roughness_value, lacunarity_value])
                or abs(lacunarity_value) > 2):
            _refuse('Unnormalized Noise needs finite static controls and |Lacunarity| <= 2 in the proven domain')
        if roughness_value > 1.0:
            # Native Noise clamps negative roughness to zero, but does not
            # upper-clamp a linked value. The current normalized kernel's
            # [0,1] amplitude model must not silently replace values above1.
            _refuse(
                f"Noise Roughness {roughness_value:g} exceeds the proven range "
                "(<= 1); native linked roughness is not upper-clamped"
            )
        if detail_value > _NOISE_DETAIL_BOUND + 1e-9:
            # Cells: `noise-detail4`, `noise-detail6`. Measured 2026-07-30,
            # maxAbs against a 0.01 gate: detail 4 1.94e-4, detail 6 2.49e-4 --
            # 40x headroom, and barely worse than detail 4. The bound used to
            # sit at 4 citing a detail-6/scale-5 measurement of 3.9e-2; that
            # was wrong by ~157x, the same vintage and the same direction as
            # the scale-100 claim above. Raising this still REQUIRES a passing
            # cell at the new value.
            _refuse(
                f"Noise detail {detail_value:g} exceeds the proven range "
                f"(<= {_NOISE_DETAIL_BOUND:g}); high-octave phase divergence "
                "measured"
            )
        # Resolve the Scale expression FIRST: a linked scale that folds to
        # a constant through group walls (the splash corpus feeds noise
        # scales through group inputs) is boundable like any literal.
        scale_expression = emit_input(node.inputs["Scale"], stack=stack)
        folded_scale = _fold_constant_scalar(scale_expression)
        if folded_scale is None:
            _refuse(
                "Noise with a non-constant Scale has no bounded cell yet "
                f"(source op {scale_expression.get('op')!r})"
            )
        if node.inputs['Scale'].is_linked:
            if __package__:
                from .noise_varying_ir import float32_safe_noise_scalar
            else:
                from noise_varying_ir import float32_safe_noise_scalar
            if not float32_safe_noise_scalar(scale_expression):
                _refuse('Noise linked Scale requires literal float32/Clamp inputs; arithmetic folding needs source baking')
        if precise_fractal and not math.isfinite(folded_scale):
            _refuse('Unnormalized Noise requires a finite static Scale')
        scale_expression = {"op": "const_float", "value": folded_scale}
        input_expression = (
            emit_input(node.inputs["W"], stack=stack)
            if dimensions == "1D" else _texture_vector(vector, stack, node)
        )
        prescale = (
            1.0 if dimensions == "1D"
            else _fold_vector_prescale(input_expression)
        )
        scale_magnitude = abs(float(scale_expression["value"])) * prescale
        # Keep explicitly measured legacy high-scale approximations separate
        # from the versioned native normalized capability.
        if normalized_native and not native_varying and scale_magnitude > _NOISE_SCALE_BOUND + 1e-9:
            normalized_native = False
            precise_fractal = False
        normalized_source_profile = None
        if normalized_native:
            import platform
            import sys
            normalized_source_profile = _normalized_noise_source_profile(
                get_evaluation_engine(), sys.platform, platform.machine(),
                getattr(getattr(bpy.context.scene, 'cycles', None), 'device', 'CPU'))
            if normalized_source_profile is None:
                _refuse('Normalized Noise has no verified live source precision profile for '
                        + get_evaluation_engine() + ' on ' + sys.platform + '/' + platform.machine()
                        + '; use source baking for this Cycles profile')
        approximate_bound = _NOISE_SCALE_APPROXIMATE_BOUNDS.get(dimensions)
        if (
            scale_magnitude > _NOISE_SCALE_BOUND + 1e-9
            and not precise_fractal
            and approximate_bound is not None
            and scale_magnitude <= approximate_bound + 1e-9
        ):
            # Inside the declared band: ships as a bounded approximation
            # measured at the corpus-maximum frequency for this dimension.
            _approximate({
                "1D": "tsl.noise-1d-scale-above-exact",
                "2D": "tsl.noise-2d-scale-above-exact",
                "3D": "tsl.noise-3d-scale-above-exact",
            }[dimensions])
        elif scale_magnitude > _NOISE_SCALE_BOUND + 1e-9:
            # Sub-texel sample-position differences between the two
            # rasterizers (~3e-5 in UV) multiply by the scale. Measured
            # 2026-07-30, maxAbs against a 0.01 gate: scale 16 7.2e-4,
            # scale 20 9.5e-4, scale 40 1.8e-3, scale 100 4.3e-3. The growth
            # is near-linear in frequency, not a decorrelation cliff -- an
            # earlier comment here claimed scale 100 reached 1.8e-1, which is
            # wrong by ~175x and predates whatever fixed the fBM composition.
            # Scale 100 still refuses, but only because it misses the 1.0e-3
            # meanAbs gate by 2.3% (1.023e-3) -- p99 and max are both inside.
            # There is deliberately no scale-100 cell: a cell draws its IR
            # from this emitter, so the harness cannot hold one above this
            # bound, which is why the figures above are recorded here instead.
            # Material bake carries what refuses.
            _refuse(
                f"Noise effective scale {scale_magnitude:g} "
                f"(socket {float(scale_expression['value']):g} x "
                f"pre-scale {prescale:g}) exceeds the proven range "
                f"(<= {_NOISE_SCALE_BOUND:g}); sample-position "
                "differences decorrelate high-frequency noise"
            )
        expression = {
            "op": "noise",
            "normalize": normalize_output,
            "output": "fac" if noise_output == "Fac" else "color",
            # 1D must be carried explicitly: an "else 3" fallthrough silently
            # sends the scalar W into mx_noise_float, whose
            # .convert('vec2|vec3') turns it into a plausible-looking 3D field,
            # producing a wrong result that reads exactly like a hash bug.
            "dimensions": {"1D": 1, "2D": 2, "4D": 4}.get(dimensions, 3),
            "detail": detail_value,
            "roughness": roughness_value,
            "lacunarity": lacunarity_value,
            "scale": scale_expression,
            # 1D noise consumes the W socket alone -- the node has no Vector
            # socket at all -- so the runtime receives a SCALAR here and runs
            # Blender's ported perlin_1d over it.
            "input": (
                emit_input(node.inputs["W"], stack=stack)
                if dimensions == "1D" else _texture_vector(vector, stack, node)
            ),
            # 4D reads Vector AND W; Blender scales the whole float4(co, w).
            **(
                {"w": emit_input(node.inputs["W"], stack=stack)}
                if dimensions == "4D" else {}
            ),
        }
        native_mf = False
        shader_offset_profile = None
        native_shader_fused = False
        if not normalize_output:
            expression.update({"op": "noise_fractal"})
            expression['noiseType'] = noise_type
            if amplitude_bound is not None:
                expression.update(offset=offset_value, gain=gain_value, amplitudeBound=amplitude_bound)
        if normalized_native:
            expression.update({"op": "noise_normalized", 'noiseType': 'FBM'})
        if native_varying:
            expression.update({"op": "noise_varying_native", 'sourceEngine': 'EEVEE', 'nativeGpuBackend': bpy.context.preferences.system.gpu_backend, 'noiseType': 'FBM', 'roughnessNode': roughness_expression})
        elif roughness_expression is not None:
            expression.update({"op": "noise_varying", 'noiseType': noise_type, 'roughnessNode': roughness_expression})
        if precise_fractal and bpy.app.version >= (5, 0, 0):
            if __package__:
                from .shader_domains import native_shader_input_evaluation
            else:
                from shader_domains import native_shader_input_evaluation
            stage = native_shader_input_evaluation(expression)
            if stage == 'opaque':
                _refuse('Unnormalized Noise has unverified native constant-evaluation eligibility')
            native_mf = stage == 'constant'
        if precise_fractal:
            import platform
            import sys
            source_engine = get_evaluation_engine()
            gpu_backend = bpy.context.preferences.system.gpu_backend
            shader_offset_profile = _noise_shader_offset_profile(
                source_engine, sys.platform, platform.machine(), gpu_backend, bpy.app.version,
                _noise_gpu_renderer() if source_engine == 'EEVEE' and gpu_backend == 'OPENGL' else '')
            native_shader_fused = normalized_native and not native_mf and normalized_source_profile == 'cycles-neon-fma'
            if normalized_native:
                expression['perlinModel'] = 'cycles-neon-fma' if native_shader_fused else 'mf-periodic-f32' if native_mf else 'eevee-metal-periodic-f32' if gpu_backend == 'METAL' else normalized_source_profile
            expression['evaluationModel'] = 'shader-mf' if native_mf else 'shader'
            expression['offsetModel'] = ('cycles-neon-fma' if native_shader_fused else 'float4-f32' if dimensions == '4D' else 'mf-f32' if native_mf
                                         else shader_offset_profile or 'shader-folded')
        # Distortion perturbs the SCALED coordinate before any octave runs,
        # by a single signed Perlin octave per component sampled at the low
        # hash-derived offsets. noisetex.h and
        # gpu_shader_material_tex_noise.glsl agree verbatim:
        #     p += floatN(snoise(p + random_floatN_offset(0)) * distortion,
        #                 snoise(p + random_floatN_offset(1)) * distortion,
        #                 ...)
        # The offsets depend only on a literal seed, so they fold here and the
        # runtime never needs Blender's integer hash. Seeds 0..N-1 are exactly
        # the ones the colour lanes below already skip, which is why that
        # comment says distortion consumes the low seeds.
        distortion_socket = node.inputs.get("Distortion")
        distortion_value = 0.0
        if distortion_socket is not None:
            if distortion_socket.is_linked:
                distortion_expression = emit_input(distortion_socket, stack=stack)
                if precise_fractal and distortion_expression.get('op') != 'const_float':
                    _refuse('Native normalized live Roughness requires literal float32 Distortion; linked arithmetic needs source baking'
                            if native_varying else 'Native Noise requires literal float32 Distortion; linked arithmetic needs source baking')
                folded = _fold_constant_scalar(distortion_expression)
                if folded is None:
                    _refuse(
                        "Noise with a non-constant Distortion has no bounded "
                        "cell yet"
                    )
                distortion_value = folded
            else:
                distortion_value = float(distortion_socket.default_value)
        if precise_fractal and (not math.isfinite(distortion_value) or abs(distortion_value) > 1):
            _refuse('Unnormalized Noise Distortion exceeds its proven finite [-1,1] domain')
        if native_varying and distortion_value != 0:
            if __package__:
                from .noise_varying_ir import native_distortion_mf_inputs, portable_noise_constant_arithmetic, NATIVE_MF_NOISE_INPUT_MESSAGE, NATIVE_SHADER_NOISE_INPUT_MESSAGE
            else:
                from noise_varying_ir import native_distortion_mf_inputs, portable_noise_constant_arithmetic, NATIVE_MF_NOISE_INPUT_MESSAGE, NATIVE_SHADER_NOISE_INPUT_MESSAGE
            mf_distortion = native_mf and native_distortion_mf_inputs(expression)
            if native_mf and not mf_distortion:
                _refuse(NATIVE_MF_NOISE_INPUT_MESSAGE)
            if not native_mf and not portable_noise_constant_arithmetic(expression):
                _refuse(NATIVE_SHADER_NOISE_INPUT_MESSAGE)
            if gpu_backend != 'METAL' or not (mf_distortion or dimensions == '1D' and not native_mf):
                _refuse('Native normalized live Roughness nonzero Distortion requires verified Metal 1D shader or native MF inputs; use source baking')
            expression['distortionModel'] = 'native-mf-f32-v1' if mf_distortion else 'metal-1d-fma-f32-v1'
        if native_shader_fused and dimensions in {'3D', '4D'} and (detail_value > 1 or distortion_value != 0):
            _refuse('Normalized Noise Cycles SIMD 3D/4D above Detail1 or with Distortion needs source baking; '
                    'the software renderer cannot reliably compile this workload')
        if distortion_value != 0 if native_varying else abs(distortion_value) > 1e-9:
            # Lane count follows the dimension. The old "2 if 2D else 3" was
            # the same silent fallthrough that broke 1D dimensions: it would
            # emit three offsets for a 1D or 4D noise and the runtime would
            # decorrelate. noisetex.h: 1D uses one scalar lane at seed 0; N-D
            # uses N lanes at seeds 0..N-1.
            count = {"1D": 1, "2D": 2, "4D": 4}.get(dimensions, 3)
            expression["distortion"] = distortion_value
            expression["distortionOffsets"] = [
                _noise_random_offset(float(seed), count, native_mf=native_mf,
                                     native_float4=precise_fractal and count == 4,
                                     native_shader_f32=shader_offset_profile is not None,
                                     native_shader_fused=native_shader_fused)
                for seed in range(count)
            ]
        if noise_output == "Color":
            # Cycles noise color lanes are the same fBM at constant
            # hash-derived offsets (noisetex.h random_floatN_offset).
            # The seeds are DIMENSION-DEPENDENT: distortion consumes the
            # low seeds per dimension, so 2D color uses (2, 3) and 3D
            # uses (3, 4) — measured: the wrong pair decorrelates both
            # offset lanes at 1e-1 while Fac stays at 4e-5.
            # N-D colour lanes use seeds (N, N+1) with N-component offsets:
            # distortion consumes seeds 0..N-1 first. The old 2D/3D pair
            # (2,3)/(3,4) is exactly this rule; 1D gives (1,2), 4D (4,5).
            count = {"1D": 1, "2D": 2, "4D": 4}.get(dimensions, 3)
            seeds = (float(count), float(count + 1))
            expression["colorOffsets"] = [
                _noise_random_offset(seed, count, native_mf=native_mf,
                                     native_float4=precise_fractal and count == 4,
                                     native_shader_f32=shader_offset_profile is not None,
                                     native_shader_fused=native_shader_fused) for seed in seeds
            ]
        if precise_fractal and get_evaluation_engine() == 'EEVEE':
            if __package__:
                from .noise_static_inputs import require_shader_constant_inputs
            else:
                from noise_static_inputs import require_shader_constant_inputs
            require_shader_constant_inputs(expression, _refuse)
        return expression

    if idname == "ShaderNodeBump":
        if __package__:
            from .bump_ir import emit as emit_bump
        else:
            from bump_ir import emit as emit_bump
        return emit_bump(node, emit_vector=lambda socket: emit_input(socket, stack=stack, as_vector=True),
                            refuse=_refuse, engine=get_evaluation_engine())

    if idname == "ShaderNodeTangent":
        if __package__:
            from .tangent_ir import emit_tangent
        else:
            from tangent_ir import emit_tangent
        return emit_tangent(node,engine=get_evaluation_engine(),refuse=_refuse)

    if idname == "ShaderNodeNormalMap":
        if node.space=='TANGENT' and get_evaluation_engine()=='EEVEE':
            if __package__:
                from .normal_map_tangent_ir import emit as emit_tangent_map
            else:
                from normal_map_tangent_ir import emit as emit_tangent_map
            return emit_tangent_map(node,emit_vector=lambda socket:emit_input(socket,stack=stack,as_vector=True),
                emit_scalar=lambda socket:emit_input(socket,stack=stack),refuse=_refuse,engine=get_evaluation_engine())
        if node.space != 'TANGENT':
            if __package__:
                from .normal_ir import emit_normal_map
            else:
                from normal_ir import emit_normal_map
            return emit_normal_map(node, emit_vector=lambda socket:emit_input(socket, stack=stack, as_vector=True),
                                   emit_scalar=lambda socket:emit_input(socket, stack=stack),
                                   refuse=_refuse, engine=get_evaluation_engine())
        if node.uv_map:
            _refuse('Normal Map with a named tangent UV basis is not supported yet')
        convention = str(getattr(node, 'convention', 'OPENGL'))
        if convention not in {'OPENGL', 'DIRECTX'}:
            _refuse('Unknown Normal Map convention: ' + convention)
        return {
            "op": "normal_map",
            "convention": convention,
            "color": emit_input(node.inputs['Color'], stack=stack, as_vector=True),
            "strength": emit_input(node.inputs['Strength'], stack=stack),
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
        data_type = str(getattr(node, "data_type", "FLOAT"))
        if data_type not in {"FLOAT", "FLOAT_VECTOR"}:
            _refuse(f"Map Range data type {node.data_type!r} has no cell yet")
        is_vector = data_type == "FLOAT_VECTOR"
        expected_output = "Vector" if is_vector else "Result"
        if str(getattr(from_socket, "identifier", socket_name)) != expected_output:
            _refuse(f"Map Range {data_type} inactive output has no cell")
        interpolation = str(getattr(node, "interpolation_type", "LINEAR"))
        if interpolation not in {"LINEAR", "STEPPED", "SMOOTHSTEP", "SMOOTHERSTEP"}:
            _refuse(
                f"Map Range interpolation {interpolation!r} has no cell yet"
            )
        sockets = {item.identifier: item for item in node.inputs}
        keys = {
            "value": "Vector", "fromMin": "From_Min_FLOAT3", "fromMax": "From_Max_FLOAT3",
            "toMin": "To_Min_FLOAT3", "toMax": "To_Max_FLOAT3", "steps": "Steps_FLOAT3",
        } if is_vector else {
            "value": "Value", "fromMin": "From Min", "fromMax": "From Max",
            "toMin": "To Min", "toMax": "To Max", "steps": "Steps",
        }
        expression = {
            "op": "map_range",
            "dataType": data_type,
            "interpolation": interpolation,
            "clamp": bool(getattr(node, "clamp", True)),
            **{key: emit_input(sockets[keys[key]], stack=stack, as_vector=is_vector)
               for key in ("value", "fromMin", "fromMax", "toMin", "toMax")},
        }
        if interpolation == "STEPPED":
            # Negative vector steps differ between Cycles and EEVEE. Admit
            # only finite nonnegative static values until that context has
            # an explicit engine contract; dynamic Steps keeps its bake route.
            import math
            steps = emit_input(sockets[keys["steps"]], stack=stack, as_vector=is_vector)
            if not is_vector:
                values = [_fold_constant_scalar(steps)]
            elif steps.get("op") == "const_vec3":
                values = steps.get("value", [])
            elif steps.get("op") == "combine":
                values = [_fold_constant_scalar(steps.get(axis)) for axis in ("x", "y", "z")]
            else:
                values = []
            if len(values) != (3 if is_vector else 1) or any(value is None for value in values):
                _refuse("Map Range STEPPED with dynamic Steps has no bounded cell yet")
            if any(not math.isfinite(value) or value < 0 for value in values):
                _refuse("Map Range STEPPED requires finite nonnegative Steps")
            expression["steps"] = {"op": "const_vec3", "value": [float(value) for value in values]} \
                if is_vector else {"op": "const_float", "value": float(values[0])}
        return expression

    if idname == "ShaderNodeClamp":
        mode = str(getattr(node, "clamp_type", "MINMAX"))
        if mode not in {"MINMAX", "RANGE"}:
            _refuse(f"Clamp type {mode!r} has no native model")
        low = emit_input(node.inputs["Min"], stack=stack)
        high = emit_input(node.inputs["Max"], stack=stack)
        # Range orders either authored or live bounds. Min Max deliberately
        # retains their order: reversed bounds collapse to the Max input.
        if mode == "RANGE":
            low, high = ({"op": "math", "operation": "MINIMUM", "a": low, "b": high},
                         {"op": "math", "operation": "MAXIMUM", "a": low, "b": high})
        return {"op": "clamp_minmax", "value": emit_input(node.inputs["Value"], stack=stack),
                "min": low, "max": high}

    _refuse(f"{idname} has no proven TSL mapping")


def emit_channel(socket, stack=(), *, evaluation_engine=None) -> dict:
    """Complete IR document for one channel input socket.

    ``stack`` is the group-instance chain enclosing the socket's node
    (from ``find_principled_root``), so channels fed through Group Input
    sockets resolve against the right instance.
    """
    if evaluation_engine is not None:
        with emission_context(evaluation_engine=evaluation_engine):
            return emit_channel(socket, stack)
    _require_static_tree(socket.node)
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
    if '"ambient_occlusion"' in encoded:
        # Scene occlusion is not carried: the runtime evaluates the
        # unoccluded algebra unless a baked occlusion source is wired
        # into the hook. Declared, like viewDependent and
        # lightDependent, so no consumer can mistake the passthrough
        # for ray-traced AO.
        document["geometryDependent"] = True
    if '"shader_to_rgb_diffuse"' in encoded:
        # Captured lighting: only the TSL runtime (or an EEVEE-render
        # oracle under the light contract) can evaluate it.
        document["lightDependent"] = True
    return document
