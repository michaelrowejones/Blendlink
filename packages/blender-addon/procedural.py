# SPDX-License-Identifier: GPL-3.0-or-later
"""Geometry/instance compiler diagnostics shared by the addon and exporter.

The public seam is deliberately small: ``evaluated_material_uses(obj)`` names
the material bindings that can produce exported primitives, while
``analyze_scene(scene, full)`` returns JSON-safe facts.  The addon turns those
facts into artist-facing Fidelity cards; the exporter carries the same facts
into the manifest.  Nothing here mutates authored meshes or node trees.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass
import hashlib
import struct

import bpy

if __package__:
    from .bakelib_loader import bakelib
else:
    # Headless export_scene.py also imports this module directly after adding
    # the canonical blender/ directory to sys.path.
    import bakelib


# Exhaustive acceptance is bounded by deterministic evaluated work, not by an
# arbitrary timeline length.  A single static Scene-Time object can therefore
# prove a longer ordinary clip, while a dense procedural scene still stops at
# the same machine-independent boundary.  Wall-clock time is deliberately not
# part of the contract: identical .blend files must not take different routes
# on a faster workstation or a busy CI runner.
MAX_AUDIT_SNAPSHOTS = 6000
# Backward-compatible single-object upper bound retained in the JSON-safe
# ``limits`` record.  New consumers should prefer ``maxAuditSnapshots``.
MAX_AUDIT_FRAMES = MAX_AUDIT_SNAPSHOTS
MAX_MORPH_CACHE_BYTES = 64 * 1024 * 1024

_SIMULATION_NODES = {
    "GeometryNodeSimulationInput", "GeometryNodeSimulationOutput",
}
_TIME_NODES = {"GeometryNodeInputSceneTime"}
_CAMERA_NODES = {"GeometryNodeInputActiveCamera"}
_INSTANCE_NODES = {"GeometryNodeInstanceOnPoints", "GeometryNodeGeometryToInstance"}
_REALIZE_NODES = {"GeometryNodeRealizeInstances"}
_NAMED_ATTRIBUTE_NODES = {
    "GeometryNodeStoreNamedAttribute", "GeometryNodeInputNamedAttribute",
    "GeometryNodeRemoveAttribute",
}

# Core glTF owns these Object channels independently of the evaluated local
# mesh.  Do not make a static Geometry Nodes realization look like a geometry
# cache merely because its host Object moves.  Other Object action paths (for
# example ``modifiers[...]["Socket_2"]`` or custom properties) can alter the
# evaluated mesh and remain finite-frame dependencies.
_PORTABLE_OBJECT_TRANSFORM_PATHS = frozenset({
    "location", "rotation_euler", "rotation_quaternion",
    "rotation_axis_angle", "scale",
})


@dataclass(frozen=True)
class EvaluatedMaterialUse:
    """One material index that owns faces in Blendlink's export mesh.

    ``source_slot_index`` is deliberately narrower than
    ``source_candidate_indices``.  A compiler may replace a material only when
    the evaluated index still has the identical editable source-slot owner.
    Candidates at another index explain the ambiguity but do not make a
    generated/evaluated assignment safe to mutate.
    """

    evaluated_slot_index: int
    material: object | None
    source_slot_index: int | None
    source_candidate_indices: tuple[int, ...]


class EvaluatedMaterialUseError(RuntimeError):
    """The export mesh's material ownership could not be inspected."""

# Initial proof boundary for separating a host Object transform from its local
# evaluated mesh.  A Geometry Nodes graph has its dependencies scanned below;
# Solidify is local-space and is the other modifier in the Blender 2.82
# Auto-Smooth migration case.  Unknown modifier types retain the old
# conservative coupling because Boolean/Object-coordinate modifiers, for
# example, can change local output as their owner moves.
_TRANSFORM_INVARIANT_MODIFIERS = frozenset({"NODES", "SOLIDIFY"})

_ALWAYS_DYNAMIC_MODIFIERS = {
    "ARMATURE", "CAST", "CLOTH", "CURVE", "DISPLACE", "DYNAMIC_PAINT",
    "FLUID", "HOOK", "LAPLACIANDEFORM", "LATTICE", "MESH_DEFORM",
    "OCEAN", "PARTICLE_INSTANCE", "SHRINKWRAP", "SIMPLE_DEFORM",
    "SMOOTH", "CORRECTIVE_SMOOTH", "LAPLACIANSMOOTH", "SOFT_BODY",
    "SURFACE_DEFORM", "WARP", "WAVE",
}

_VIEW_DEPENDENT_SHADER_NODES = {
    "ShaderNodeBsdfGlass", "ShaderNodeBsdfRefraction", "ShaderNodeBsdfTransparent",
    "ShaderNodeFresnel", "ShaderNodeLayerWeight", "ShaderNodeCameraData",
    "ShaderNodeLightPath", "ShaderNodeVolumeAbsorption", "ShaderNodeVolumePrincipled",
    "ShaderNodeVolumeScatter",
}

# A Cycles bake can cast its view rays from the active camera.  That makes a
# narrow set of otherwise view-dependent *opaque* inputs safe to capture when
# the website camera is fixed.  Transmission, transparency, Light Path, and
# volume shaders are deliberately absent: a per-surface color atlas cannot
# preserve their compositing, secondary-ray, or interior semantics.
_FIXED_CAMERA_APPEARANCE_NODES = {
    "ShaderNodeFresnel", "ShaderNodeLayerWeight", "ShaderNodeCameraData",
}
_FIXED_CAMERA_APPEARANCE_UNSAFE_NODES = (
    _VIEW_DEPENDENT_SHADER_NODES - _FIXED_CAMERA_APPEARANCE_NODES
)

_PORTABLE_MATERIAL_NODES = {
    # Blender's stock glTF exporter understands these directly or uses them
    # as structural/pass-through nodes while gathering a Principled material.
    "NodeGroupInput", "NodeReroute",
    "ShaderNodeBsdfPrincipled", "ShaderNodeGroup", "ShaderNodeMapping",
    "ShaderNodeNormalMap", "ShaderNodeRGB", "ShaderNodeSeparateColor",
    "ShaderNodeSeparateRGB", "ShaderNodeTexCoord",
    "ShaderNodeTexImage", "ShaderNodeUVMap", "ShaderNodeValue",
    "ShaderNodeVertexColor",
}

_PROCEDURAL_MATERIAL_NODES = {
    "ShaderNodeTexBrick", "ShaderNodeTexChecker", "ShaderNodeTexGradient",
    "ShaderNodeTexMagic", "ShaderNodeTexNoise", "ShaderNodeTexVoronoi",
    "ShaderNodeTexWave", "ShaderNodeTexWhiteNoise", "ShaderNodeValToRGB",
}

# Blender 5.2 Principled inputs with a direct stock glTF/KHR representation.
# Names that do not exist in an older supported Blender release are harmless:
# socket lookup is tolerant and the analyzer only inspects what that node has.
_PRINCIPLED_GLTF_INPUTS = frozenset({
    "Base Color", "Metallic", "Roughness", "IOR", "Alpha",
    "Specular IOR Level", "Specular Tint", "Anisotropic",
    "Anisotropic Rotation", "Transmission Weight", "Coat Weight",
    "Coat Roughness", "Sheen Roughness", "Sheen Tint",
    "Emission Color", "Emission Strength",
})

_PRINCIPLED_CONDITIONAL_INPUTS = frozenset({"Normal", "Coat Normal", "Tangent"})
_PRINCIPLED_CONTEXTUAL_INPUTS = frozenset({
    "Sheen Weight", "Thin Film Thickness", "Thin Film IOR",
})

# These graph relaxations are tied to inspected exporter source, not merely a
# Blender major/minor family. Unknown, older, and newer exporter revisions stay
# conservative until their implementations and differential cells are pinned.
_VERIFIED_GLTF_MATERIAL_EXPORTER = (5, 2, 39)

# Authored values on these sockets are not faithfully serialized by the stock
# Blender 5.2 glTF exporter. Keep the baseline beside the name so a pristine
# default Principled shader stays Exact; missing sockets are skipped for older
# Blender releases. Context-dependent exporter mappings are handled separately
# below so the same authored value can be Exact or Approximated according to
# the surrounding graph.
_PRINCIPLED_OMITTED_INPUTS = (
    ("Weight", 0.0, "Weight"),
    ("Thin Wall", False, "Thin Wall"),
    ("Diffuse Roughness", 0.0, "Diffuse Roughness"),
    ("Subsurface Weight", 0.0, "Subsurface Weight"),
    ("Subsurface Radius", (1.0, 0.2, 0.1), "Subsurface Radius"),
    ("Subsurface Scale", 0.005, "Subsurface Scale"),
    ("Subsurface IOR", 1.4, "Subsurface IOR"),
    ("Subsurface Anisotropy", 0.0, "Subsurface Anisotropy"),
    ("Coat IOR", 1.5, "Coat IOR"),
    ("Coat Tint", (1.0, 1.0, 1.0, 1.0), "Coat Tint"),
)

_MATERIAL_NODE_LABELS = {
    "ShaderNodeAddShader": "Add Shader",
    "ShaderNodeBsdfAnisotropic": "Anisotropic BSDF",
    "ShaderNodeBsdfDiffuse": "Diffuse BSDF",
    "ShaderNodeBsdfGlass": "Glass BSDF",
    "ShaderNodeBsdfGlossy": "Glossy BSDF",
    "ShaderNodeBsdfRefraction": "Refraction BSDF",
    "ShaderNodeBsdfToon": "Toon BSDF",
    "ShaderNodeBsdfTranslucent": "Translucent BSDF",
    "ShaderNodeBsdfTransparent": "Transparent BSDF",
    "ShaderNodeBump": "Bump",
    "ShaderNodeEmission": "Emission Shader",
    "ShaderNodeMix": "Mix",
    "ShaderNodeMixRGB": "Mix Color",
    "ShaderNodeMixShader": "Mix Shader",
    "ShaderNodeTexBrick": "Brick Texture",
    "ShaderNodeTexChecker": "Checker Texture",
    "ShaderNodeTexGradient": "Gradient Texture",
    "ShaderNodeTexMagic": "Magic Texture",
    "ShaderNodeTexNoise": "Noise Texture",
    "ShaderNodeTexVoronoi": "Voronoi Texture",
    "ShaderNodeTexWave": "Wave Texture",
    "ShaderNodeTexWhiteNoise": "White Noise Texture",
    "ShaderNodeValToRGB": "Color Ramp",
}


def _walk_node_trees(tree, seen=None):
    """Yield a node group and every nested group exactly once."""
    if tree is None:
        return
    seen = seen if seen is not None else set()
    pointer = tree.as_pointer()
    if pointer in seen:
        return
    seen.add(pointer)
    yield tree
    for node in tree.nodes:
        nested = getattr(node, "node_tree", None)
        if nested is not None:
            yield from _walk_node_trees(nested, seen)


def reachable_surface_nodes(tree, output_type="OUTPUT_MATERIAL"):
    """Return only nodes that contribute to an active Surface output.

    Artists commonly keep experiments beside the active graph. Those scratch
    nodes must never lower the portability result. Nested groups follow their
    matching active Group Output and also include values linked into the group
    instance from its parent graph.
    """
    if tree is None:
        return []
    reachable = []
    seen = set()

    def visit_output(node, output_socket):
        key = (node.as_pointer(), getattr(output_socket, "identifier", output_socket.name))
        if key in seen:
            return
        seen.add(key)
        reachable.append(node)
        if node.type == "GROUP" and node.node_tree is not None:
            group_outputs = [
                item for item in node.node_tree.nodes if item.type == "GROUP_OUTPUT"
                and getattr(item, "is_active_output", True)
            ]
            for group_output in group_outputs:
                target = group_output.inputs.get(output_socket.name)
                if target is None:
                    target = next((
                        item for item in group_output.inputs
                        if getattr(item, "identifier", None)
                        == getattr(output_socket, "identifier", None)
                    ), None)
                if target is not None:
                    for link in target.links:
                        visit_output(link.from_node, link.from_socket)
            for socket in node.inputs:
                for link in socket.links:
                    visit_output(link.from_node, link.from_socket)
            return
        for socket in node.inputs:
            for link in socket.links:
                visit_output(link.from_node, link.from_socket)

    outputs = [
        node for node in tree.nodes if node.type == output_type
        and getattr(node, "is_active_output", True)
    ]
    for output in outputs:
        surface = output.inputs.get("Surface")
        if surface is None:
            continue
        for link in surface.links:
            visit_output(link.from_node, link.from_socket)
    return reachable


def _material_node_label(node):
    return _MATERIAL_NODE_LABELS.get(
        node.bl_idname,
        str(getattr(node, "bl_label", "") or getattr(node, "name", "")
            or node.bl_idname),
    )


def _value_differs(value, expected, tolerance=1e-4):
    try:
        values = list(value)
    except TypeError:
        return abs(float(value) - float(expected)) > tolerance
    expected_values = list(expected)
    return len(values) != len(expected_values) or any(
        abs(float(actual) - float(wanted)) > tolerance
        for actual, wanted in zip(values, expected_values)
    )


def _node_input(node, socket_name):
    """Find a socket across Blender versions, including disabled inputs.

    Blender 5.2 exposes Principled's disabled ``Weight`` socket while
    iterating ``inputs`` but excludes it from ``inputs.get()``.  Matching the
    display name and identifier keeps diagnostics truthful without assuming
    every supported Blender version exposes the same socket set.
    """
    socket = node.inputs.get(socket_name)
    if socket is not None:
        return socket
    return next((
        item for item in node.inputs
        if item.name == socket_name or item.identifier == socket_name
    ), None)


def _gltf_exporter_version():
    """Return the bundled glTF add-on version without widening public API."""
    try:
        from io_scene_gltf2 import bl_info as gltf_bl_info
    except (ImportError, ModuleNotFoundError):
        return None
    version = gltf_bl_info.get("version")
    if not isinstance(version, (tuple, list)) or not version:
        return None
    try:
        return tuple(int(item) for item in version)
    except (TypeError, ValueError):
        return None


def _material_exporter_capabilities():
    version = _gltf_exporter_version()
    verified = version == _VERIFIED_GLTF_MATERIAL_EXPORTER
    return {
        "version": version,
        "alphaClipMath": verified,
        "contextualSheenWeight": verified,
        "constantIridescence": verified,
        "fixedCameraUnlit": verified,
    }


def _exporter_version_label(capabilities):
    version = capabilities["version"]
    return ".".join(str(item) for item in version) if version else "unknown"


def _single_input_link(socket):
    """Return one direct input link, rejecting malformed/multi-link inputs."""
    if socket is None or not socket.is_linked or len(socket.links) != 1:
        return None
    return socket.links[0]


def _fixed_camera_unlit_nodes(tree):
    """Recognize Blendlink's exact stock-glTF fixed-camera card grammar.

    Blender glTF exporter 5.2.39 recognizes a wider private shadeless grammar.
    Blendlink deliberately accepts only the independently exported subset its
    own fixed-camera capture primitive authors: one RGBA Image Texture drives
    both camera-visible Emission color and an outer Transparent alpha mix.
    Keeping this matcher direct and structural prevents a successful stock
    export from hiding different per-ray, strength, volume, or alpha intent.
    """
    if tree is None:
        return frozenset()
    outputs = [
        node for node in tree.nodes
        if node.type == "OUTPUT_MATERIAL" and getattr(node, "is_active_output", True)
    ]
    if len(outputs) != 1:
        return frozenset()
    output = outputs[0]
    surface = output.inputs.get("Surface")
    surface_link = _single_input_link(surface)
    if surface_link is None:
        return frozenset()
    if any(
        socket.name != "Surface" and socket.is_linked
        for socket in output.inputs
    ):
        return frozenset()

    outer_mix = surface_link.from_node
    if outer_mix.bl_idname != "ShaderNodeMixShader" or len(outer_mix.inputs) < 3:
        return frozenset()
    alpha_link = _single_input_link(outer_mix.inputs[0])
    outer_transparent_link = _single_input_link(outer_mix.inputs[1])
    inner_link = _single_input_link(outer_mix.inputs[2])
    if alpha_link is None or outer_transparent_link is None or inner_link is None:
        return frozenset()

    transparent = outer_transparent_link.from_node
    inner_mix = inner_link.from_node
    if (
        transparent.bl_idname != "ShaderNodeBsdfTransparent"
        or inner_mix.bl_idname != "ShaderNodeMixShader"
        or len(inner_mix.inputs) < 3
    ):
        return frozenset()
    camera_link = _single_input_link(inner_mix.inputs[0])
    inner_transparent_link = _single_input_link(inner_mix.inputs[1])
    emission_link = _single_input_link(inner_mix.inputs[2])
    if camera_link is None or inner_transparent_link is None or emission_link is None:
        return frozenset()
    if inner_transparent_link.from_node != transparent:
        return frozenset()

    light_path = camera_link.from_node
    camera_output = camera_link.from_socket
    if (
        light_path.bl_idname != "ShaderNodeLightPath"
        or (camera_output.name or camera_output.identifier) != "Is Camera Ray"
    ):
        return frozenset()
    emission = emission_link.from_node
    if emission.bl_idname != "ShaderNodeEmission":
        return frozenset()
    strength = _node_input(emission, "Strength")
    if strength is None or strength.is_linked or _value_differs(strength.default_value, 1.0):
        return frozenset()
    weight = _node_input(emission, "Weight")
    if weight is not None and (
        weight.is_linked or _value_differs(weight.default_value, 0.0)
    ):
        return frozenset()

    color = _node_input(emission, "Color")
    color_link = _single_input_link(color)
    if color_link is None:
        return frozenset()
    image_texture = color_link.from_node
    if (
        image_texture.bl_idname != "ShaderNodeTexImage"
        or alpha_link.from_node != image_texture
        or (color_link.from_socket.name or color_link.from_socket.identifier) != "Color"
        or (alpha_link.from_socket.name or alpha_link.from_socket.identifier) != "Alpha"
        or image_texture.image is None
        or int(getattr(image_texture.image, "channels", 0)) != 4
    ):
        return frozenset()
    structural = (outer_mix, transparent, inner_mix, light_path, emission)
    if any(getattr(node, "mute", False) for node in structural):
        return frozenset()
    if any(socket.is_linked for socket in transparent.inputs):
        return frozenset()
    transparent_color = _node_input(transparent, "Color")
    if transparent_color is not None and _value_differs(
        transparent_color.default_value, (1.0, 1.0, 1.0, 1.0),
    ):
        return frozenset()
    return frozenset(node.as_pointer() for node in structural)


def _constant_float(socket):
    """Mirror the scalar constants used by Blender 5.2's alpha matcher.

    The installed 5.2.39 exporter recognizes an unlinked VALUE socket and a
    directly linked Value node. More elaborate Math evaluation is deliberately
    absent: accepting it here would bless graphs the exporter does not treat as
    alpha clipping.
    """
    if socket is None:
        return None
    if not socket.is_linked:
        try:
            return float(socket.default_value)
        except (TypeError, ValueError):
            return None
    link = _single_input_link(socket)
    if link is None or link.from_node.bl_idname != "ShaderNodeValue":
        return None
    try:
        return float(link.from_socket.default_value)
    except (TypeError, ValueError):
        return None


def _dynamic_float_input(socket):
    return _single_input_link(socket) is not None and _constant_float(socket) is None


def _only_output_link(output_socket, target_node, target_socket):
    links = list(output_socket.links)
    return (
        len(links) == 1
        and links[0].to_node == target_node
        and links[0].to_socket == target_socket
    )


def _recognized_alpha_clip_math_nodes(principled):
    """Return only Math nodes in Blender 5.2.39's alpha-clip grammar.

    This is intentionally a strict direct-link subset of
    ``detect_alpha_clip``. The structural Math output may only drive the
    Principled Alpha socket, preventing a clip helper reused as an ordinary
    material input from being globally treated as portable.
    """
    alpha = _node_input(principled, "Alpha")
    alpha_link = _single_input_link(alpha)
    if alpha_link is None:
        return set()
    clip = alpha_link.from_node
    if clip.bl_idname != "ShaderNodeMath" or getattr(clip, "mute", False):
        return set()
    if not _only_output_link(alpha_link.from_socket, principled, alpha):
        return set()

    operation = getattr(clip, "operation", "")
    if operation == "ROUND":
        return (
            {clip.as_pointer()}
            if _dynamic_float_input(clip.inputs[0])
            else set()
        )

    if operation == "SUBTRACT":
        outer_left = clip.inputs[0]
        outer_right = clip.inputs[1]
        left = _constant_float(outer_left)
        comparator_link = _single_input_link(outer_right)
        if (
            left is None
            or abs(left - 1.0) > 1e-6
            or comparator_link is None
            or comparator_link.from_node.bl_idname != "ShaderNodeMath"
        ):
            return set()
        comparator = comparator_link.from_node
        if (
            getattr(comparator, "mute", False)
            or not _only_output_link(
                comparator_link.from_socket, clip, outer_right,
            )
        ):
            return set()
        comparator_operation = getattr(comparator, "operation", "")
        input_zero = comparator.inputs[0]
        input_one = comparator.inputs[1]
        if (
            comparator_operation == "LESS_THAN"
            and _dynamic_float_input(input_zero)
            and _constant_float(input_one) is not None
        ) or (
            comparator_operation == "GREATER_THAN"
            and _constant_float(input_zero) is not None
            and _dynamic_float_input(input_one)
        ):
            return {clip.as_pointer(), comparator.as_pointer()}
        return set()

    input_zero = clip.inputs[0]
    input_one = clip.inputs[1]
    if (
        operation == "GREATER_THAN"
        and _dynamic_float_input(input_zero)
        and _constant_float(input_one) is not None
    ) or (
        operation == "LESS_THAN"
        and _constant_float(input_zero) is not None
        and _dynamic_float_input(input_one)
    ):
        return {clip.as_pointer()}
    return set()


def _gltf_material_output_nodes(tree, seen=None):
    """Find exporter-defined glTF Material Output groups in traversal order."""
    if tree is None:
        return []
    seen = seen if seen is not None else set()
    pointer = tree.as_pointer()
    if pointer in seen:
        return []
    seen.add(pointer)
    result = []
    names = ("gltf material output", "gltf settings")
    for node in tree.nodes:
        nested = getattr(node, "node_tree", None)
        if (
            node.bl_idname != "ShaderNodeGroup"
            or nested is None
            or getattr(node, "mute", False)
        ):
            continue
        if nested.name.lower().startswith(names):
            result.append(node)
        else:
            result.extend(_gltf_material_output_nodes(nested, seen))
    return result


def _has_constant_iridescence_pair(tree, principled):
    """Whether Blender 5.2.39 can serialize this constant thin-film setup."""
    thickness = _node_input(principled, "Thin Film Thickness")
    ior = _node_input(principled, "Thin Film IOR")
    if (
        thickness is None
        or ior is None
        or thickness.is_linked
        or ior.is_linked
        or float(thickness.default_value) <= 0.0
    ):
        return False
    groups = _gltf_material_output_nodes(tree)
    if not groups:
        return False
    # The exporter selects the first matching group/input in traversal order.
    group = groups[0]
    factor = _node_input(group, "Iridescence Factor")
    minimum = _node_input(group, "Iridescence Thickness Minimum")
    factor_value = _constant_float(factor)
    return (
        factor is not None
        and minimum is not None
        and not factor.is_linked
        and not minimum.is_linked
        and factor_value is not None
        and factor_value > 0.0
    )


def _principled_omissions(node, tree, capabilities):
    """Name non-default Principled details the stock glTF path omits."""
    omitted = []
    for socket_name, expected, artist_label in _PRINCIPLED_OMITTED_INPUTS:
        socket = _node_input(node, socket_name)
        if socket is None:
            continue
        if socket.is_linked:
            omitted.append(
                ("needsBake", f"{artist_label} is linked, but glTF has no equivalent input."),
            )
        elif _value_differs(socket.default_value, expected):
            omitted.append(
                ("approximated", f"{artist_label} is authored but is omitted by glTF."),
            )

    sheen_weight = _node_input(node, "Sheen Weight")
    if sheen_weight is not None:
        if sheen_weight.is_linked:
            omitted.append((
                "needsBake",
                "Sheen Weight is linked, but Blender 5.2 glTF only uses this socket "
                "as an unlinked extension enable gate.",
            ))
        else:
            weight = float(sheen_weight.default_value)
            if (
                abs(weight) > 1e-4
                and not capabilities["contextualSheenWeight"]
            ):
                omitted.append((
                    "approximated",
                    "Sheen Weight transport is verified only for Blender glTF "
                    f"exporter 5.2.39; installed exporter "
                    f"{_exporter_version_label(capabilities)} stays conservative.",
                ))
            elif abs(weight) > 1e-4 and abs(weight - 1.0) > 1e-4:
                omitted.append((
                    "approximated",
                    "Sheen Weight is between 0 and 1, but Blender 5.2 glTF uses any "
                    "nonzero value only to enable full KHR_materials_sheen.",
                ))

    structural_iridescence_pair = _has_constant_iridescence_pair(tree, node)
    iridescence_pair = (
        capabilities["constantIridescence"] and structural_iridescence_pair
    )
    for socket_name, expected in (
        ("Thin Film Thickness", 0.0),
        ("Thin Film IOR", 1.33),
    ):
        socket = _node_input(node, socket_name)
        if socket is None:
            continue
        if socket.is_linked:
            omitted.append((
                "needsBake",
                f"{socket_name} is linked, but Blendlink has only verified Blender "
                "5.2's constant glTF iridescence mapping.",
            ))
        elif _value_differs(socket.default_value, expected) and not iridescence_pair:
            if (
                structural_iridescence_pair
                and not capabilities["constantIridescence"]
            ):
                reason = (
                    f"{socket_name} transport is verified only for Blender glTF "
                    f"exporter 5.2.39; installed exporter "
                    f"{_exporter_version_label(capabilities)} stays conservative."
                )
            else:
                reason = (
                    f"{socket_name} needs an enabled glTF Material Output "
                    "iridescence pair to serialize through KHR_materials_iridescence."
                )
            omitted.append(("approximated", reason))

    for socket_name in ("Normal", "Coat Normal"):
        socket = _node_input(node, socket_name)
        if socket is None:
            continue
        if not socket.is_linked:
            if _value_differs(socket.default_value, (0.0, 0.0, 0.0)):
                omitted.append((
                    "approximated",
                    f"{socket_name} is an authored constant vector, but glTF only serializes "
                    "this input through a normal-map texture.",
                ))
            continue
        source = socket.links[0].from_node
        color = _node_input(source, "Color") if source.bl_idname == "ShaderNodeNormalMap" else None
        strength = _node_input(source, "Strength") if source.bl_idname == "ShaderNodeNormalMap" else None
        image_source = (
            color.links[0].from_node
            if color is not None and color.is_linked else None
        )
        validated_normal_map = (
            source.bl_idname == "ShaderNodeNormalMap"
            and strength is not None and not strength.is_linked
            and image_source is not None
            and image_source.bl_idname == "ShaderNodeTexImage"
            and image_source.image is not None
        )
        if not validated_normal_map:
            omitted.append((
                "needsBake",
                f"{socket_name} is only portable through an Image Texture → Normal Map graph; "
                "this linked vector is not serialized faithfully by stock glTF.",
            ))

    tangent = _node_input(node, "Tangent")
    if tangent is not None:
        if tangent.is_linked:
            source = tangent.links[0].from_node
            # A Tangent node is classified with its direction below. Other
            # arbitrary vector sources have no stock glTF tangent-input field.
            if source.bl_idname != "ShaderNodeTangent":
                omitted.append((
                    "needsBake",
                    "Tangent is linked from a graph without a verified stock glTF anisotropy mapping.",
                ))
        elif _value_differs(tangent.default_value, (0.0, 0.0, 0.0)):
            omitted.append((
                "approximated",
                "Tangent is an authored constant vector, but glTF does not serialize a material tangent input.",
            ))
    known_inputs = _PRINCIPLED_GLTF_INPUTS | {
        name for name, _expected, _label in _PRINCIPLED_OMITTED_INPUTS
    } | _PRINCIPLED_CONDITIONAL_INPUTS | _PRINCIPLED_CONTEXTUAL_INPUTS
    for socket in node.inputs:
        socket_name = socket.name or socket.identifier
        if socket_name in known_inputs:
            continue
        if socket.is_linked:
            omitted.append((
                "needsBake",
                f"{socket_name} is a newer linked Principled input with no verified stock glTF mapping.",
            ))
        else:
            omitted.append((
                "approximated",
                f"{socket_name} is a newer Principled input Blendlink has not verified against stock glTF yet; "
                "update Blendlink before relying on an Exact result.",
            ))
    return omitted


def _contributing_output_names(node, reachable_nodes):
    """Name this node's outputs that lead toward the active Surface graph."""
    reachable = {item.as_pointer() for item in reachable_nodes}
    return [
        socket.name for socket in node.outputs
        if any(link.to_node.as_pointer() in reachable for link in socket.links)
    ]


def _cycles_appearance_compatibility(nodes):
    """Report whether Cycles can evaluate the active graph for Appearance bake."""
    blockers = []
    if any(node.bl_idname == "ShaderNodeShaderToRGB" for node in nodes):
        blockers.append(
            "Shader to RGB is EEVEE-only and cannot be evaluated by "
            "Blendlink's Cycles Appearance bake.",
        )
    return {
        "status": "blocked" if blockers else "compatible",
        "blockers": blockers,
    }


# --- MTL-UV-002: per-channel coordinate-space classification -----------------
#
# Portability is a property of a channel, not of a whole material.  These
# helpers resolve which coordinate spaces feed each Principled input so the
# Material bake can route every channel independently: a Tileable channel
# bakes one 0..1 tile and keeps the artist's authored UVs — overlapping
# islands and tiling past 0..1 stay correct — while a Unique channel needs a
# non-overlapping unwrap.  The structural result is deliberately a candidate:
# numeric channel fidelity at bake time may still demote a tileable channel
# whose graph is not period-1 in UV space.

CHANNEL_ROUTING_MODEL = "principled-channel-routing-v1"

# Principled inputs the Material bake can carry into stock glTF, in report
# order.  Occlusion has no Principled input; ORM occlusion is composed at
# bake time.  Tangent has no bakeable carrier and stays with the existing
# per-socket diagnostics.
_CHANNEL_ROUTING_INPUTS = (
    "Base Color", "Metallic", "Roughness", "Alpha",
    "Emission Color", "Emission Strength", "Normal",
)

_TEXCOORD_OUTPUT_SPACES = {
    "Generated": "generated",
    "Normal": "normal",
    "UV": "uv",
    "Object": "object",
    "Camera": "camera",
    "Window": "window",
    "Reflection": "reflection",
}

_GEOMETRY_OUTPUT_SPACES = {
    "Position": "position",
    "Normal": "normal",
    "Tangent": "tangent",
    "True Normal": "normal",
    "Incoming": "incoming",
    "Parametric": "parametric",
    "Backfacing": "backfacing",
    "Pointiness": "pointiness",
    "Random Per Island": "island",
}

# Unlinked Vector inputs sample these implicit coordinates.
_TEXTURE_DEFAULT_SPACES = {
    "ShaderNodeTexImage": "uv",
    "ShaderNodeTexBrick": "generated",
    "ShaderNodeTexChecker": "generated",
    "ShaderNodeTexGradient": "generated",
    "ShaderNodeTexMagic": "generated",
    "ShaderNodeTexNoise": "generated",
    "ShaderNodeTexVoronoi": "generated",
    "ShaderNodeTexWave": "generated",
    "ShaderNodeTexWhiteNoise": "generated",
    "ShaderNodeTexEnvironment": "reflection",
}

# A channel touching these spaces changes with the viewer; a baked channel
# would freeze one view.
_VIEW_DEPENDENT_SPACES = frozenset({
    "camera", "window", "reflection", "incoming", "backfacing",
})

# Stable per surface point, but never reproducible by repeat-wrapping one
# 0..1 UV tile.
_UNIQUE_SPACES = frozenset({
    "generated", "object", "position", "normal", "tangent", "parametric",
    "pointiness", "island", "attribute", "objectValue",
})

# Value/color/vector plumbing that contributes no coordinate space of its
# own.  ShaderNodeMapping transforms its input space instead of defining one.
_CHANNEL_NEUTRAL_NODES = {
    "ShaderNodeMath", "ShaderNodeVectorMath", "ShaderNodeMix",
    "ShaderNodeMixRGB", "ShaderNodeValToRGB", "ShaderNodeRGB",
    "ShaderNodeValue", "ShaderNodeSeparateColor", "ShaderNodeSeparateRGB",
    "ShaderNodeSeparateXYZ", "ShaderNodeCombineColor", "ShaderNodeCombineRGB",
    "ShaderNodeCombineXYZ", "ShaderNodeInvert", "ShaderNodeHueSaturation",
    "ShaderNodeBrightContrast", "ShaderNodeGamma", "ShaderNodeClamp",
    "ShaderNodeMapRange", "ShaderNodeRGBCurve", "ShaderNodeVectorCurve",
    "ShaderNodeFloatCurve", "ShaderNodeMapping", "ShaderNodeVectorRotate",
    "ShaderNodeBlackbody", "ShaderNodeWavelength", "ShaderNodeRGBToBW",
    "ShaderNodeNormalMap", "ShaderNodeBump",
}

# Lighting/scene capture: baking these into a channel input would violate the
# EMIT-only isolation contract — the runtime would light the result again.
_CHANNEL_SCENE_NODES = {"ShaderNodeShaderToRGB", "ShaderNodeAmbientOcclusion"}

# View-ray evaluation without a coordinate socket.
_CHANNEL_VIEW_NODES = {
    "ShaderNodeCameraData", "ShaderNodeFresnel", "ShaderNodeLayerWeight",
    "ShaderNodeLightPath",
}


def _matching_socket(sockets, reference):
    """Find the socket matching another socket's name, then identifier."""
    named = sockets.get(reference.name)
    if named is not None:
        return named
    identifier = getattr(reference, "identifier", None)
    return next(
        (item for item in sockets
         if item.name == reference.name or item.identifier == identifier),
        None,
    )


def _walk_channel_upstream(socket):
    """Return (node, output_socket) pairs feeding one input socket.

    The walk crosses node-group walls in both directions: it enters a group
    instance through its matching active Group Output and leaves through the
    instance input feeding a Group Input node.  Reroutes are transparent.
    Muted nodes are kept — counting a muted texture is conservative, never
    unsafe.  The walk must start from a socket in the material's root tree so
    every Group Input has a known enclosing instance.
    """
    visited = []
    seen = set()
    stack = [
        (link.from_node, link.from_socket, ())
        for link in getattr(socket, "links", ())
    ]
    while stack:
        node, from_socket, group_stack = stack.pop()
        key = (
            node.as_pointer(),
            getattr(from_socket, "identifier", from_socket.name),
            tuple(item.as_pointer() for item in group_stack),
        )
        if key in seen:
            continue
        seen.add(key)
        idname = node.bl_idname
        if idname == "ShaderNodeGroup":
            if node.node_tree is None:
                continue
            for group_output in node.node_tree.nodes:
                if group_output.type != "GROUP_OUTPUT" or not getattr(
                        group_output, "is_active_output", True):
                    continue
                target = _matching_socket(group_output.inputs, from_socket)
                if target is None:
                    continue
                stack.extend(
                    (link.from_node, link.from_socket, group_stack + (node,))
                    for link in target.links
                )
            continue
        if idname == "NodeGroupInput":
            if not group_stack:
                continue
            instance = group_stack[-1]
            outer = _matching_socket(instance.inputs, from_socket)
            if outer is not None:
                stack.extend(
                    (link.from_node, link.from_socket, group_stack[:-1])
                    for link in outer.links
                )
            continue
        if idname == "NodeReroute":
            stack.extend(
                (link.from_node, link.from_socket, group_stack)
                for link in node.inputs[0].links
            )
            continue
        visited.append((node, from_socket))
        stack.extend(
            (link.from_node, link.from_socket, group_stack)
            for input_socket in node.inputs
            for link in input_socket.links
        )
    return visited


def _channel_constant_value(socket):
    default = getattr(socket, "default_value", None)
    if default is None:
        return None
    try:
        return [round(float(item), 6) for item in default]
    except TypeError:
        try:
            return round(float(default), 6)
        except (TypeError, ValueError):
            return None


def _classify_channel(name, socket):
    """One JSON-safe routing record for one Principled input."""
    if not socket.is_linked:
        return {
            "channel": name,
            "linked": False,
            "routing": "constant",
            "value": _channel_constant_value(socket),
        }

    spaces = set()
    uv_maps = set()
    uses_active_uv = False
    view_reasons = []
    scene_reasons = []
    unknown_reasons = []
    unique_notes = []
    animated_sources = set()

    visited = _walk_channel_upstream(socket)
    for node, from_socket in visited:
        owner = getattr(node, "id_data", None)
        if owner is not None and _animated_id(owner):
            animated_sources.add(owner.name)
        image = getattr(node, "image", None)
        if image is not None:
            if _animated_id(image) or getattr(image, "source", "") in {
                    "MOVIE", "SEQUENCE"}:
                animated_sources.add(image.name)

        idname = node.bl_idname
        label = _material_node_label(node)
        if idname == "ShaderNodeTexCoord":
            space = _TEXCOORD_OUTPUT_SPACES.get(from_socket.name)
            if space == "uv":
                spaces.add("uv")
                uses_active_uv = True
            elif space in {"generated", "object"} and getattr(
                    node, "object", None) is not None:
                spaces.add("object")
                unique_notes.append(
                    f"Texture Coordinate follows external object "
                    f"{node.object.name!r}."
                )
            elif space is not None:
                spaces.add(space)
        elif idname == "ShaderNodeUVMap":
            spaces.add("uv")
            uv_name = str(getattr(node, "uv_map", "") or "")
            if uv_name:
                uv_maps.add(uv_name)
            else:
                uses_active_uv = True
        elif idname == "ShaderNodeNewGeometry":
            spaces.add(_GEOMETRY_OUTPUT_SPACES.get(from_socket.name, "position"))
        elif idname in {"ShaderNodeVertexColor", "ShaderNodeAttribute"}:
            spaces.add("attribute")
        elif idname == "ShaderNodeObjectInfo":
            spaces.add("objectValue")
        elif idname == "ShaderNodeVectorTransform":
            if "CAMERA" in {str(getattr(node, "convert_from", "")),
                            str(getattr(node, "convert_to", ""))}:
                spaces.add("camera")
                view_reasons.append(f"{label} converts through camera space.")
            else:
                spaces.add("object")
        elif idname == "ShaderNodeTangent":
            if getattr(node, "direction_type", "") == "UV_MAP":
                spaces.add("uv")
                uv_name = str(getattr(node, "uv_map", "") or "")
                if uv_name:
                    uv_maps.add(uv_name)
                else:
                    uses_active_uv = True
            else:
                spaces.add("tangent")
        elif idname in _CHANNEL_VIEW_NODES:
            view_reasons.append(f"{label} evaluates per view ray.")
        elif idname in _CHANNEL_SCENE_NODES:
            scene_reasons.append(
                f"{label} captures scene lighting; a Material bake input "
                "must stay lighting-free."
            )
        elif idname in _TEXTURE_DEFAULT_SPACES:
            vector = _node_input(node, "Vector")
            if vector is None or not vector.is_linked:
                default_space = _TEXTURE_DEFAULT_SPACES[idname]
                spaces.add(default_space)
                if default_space == "uv":
                    uses_active_uv = True
                elif default_space in _VIEW_DEPENDENT_SPACES:
                    view_reasons.append(
                        f"{label} samples the view direction by default."
                    )
            if idname == "ShaderNodeTexImage" and str(getattr(
                    node, "projection", "FLAT")) != "FLAT":
                spaces.add("position")
                unique_notes.append(
                    f"{label} uses {str(node.projection).title()} projection, "
                    "which blends 3D coordinates."
                )
        elif idname == "ShaderNodeNormalMap":
            spaces.add("uv")
            uv_name = str(getattr(node, "uv_map", "") or "")
            if uv_name:
                uv_maps.add(uv_name)
            else:
                uses_active_uv = True
        elif idname in _CHANNEL_NEUTRAL_NODES:
            pass
        elif any(getattr(item, "type", "") == "SHADER"
                 for item in getattr(node, "outputs", ())):
            # A shader closure is only reachable through Shader to RGB, which
            # already carries the scene-dependence refusal for this channel.
            pass
        else:
            unknown_reasons.append(
                f"{label} is not classified for channel routing yet."
            )

    for space in sorted(spaces & _VIEW_DEPENDENT_SPACES):
        view_reasons.append(f"{space} coordinates are view dependent.")
    if len(uv_maps) > 1:
        unique_notes.append(
            "Multiple UV maps feed this channel; one glTF sampler carries "
            "one UV set."
        )

    if unknown_reasons:
        routing = "unknown"
        reasons = unknown_reasons + view_reasons + scene_reasons
    elif view_reasons:
        routing = "viewDependent"
        reasons = view_reasons
    elif scene_reasons:
        routing = "sceneDependent"
        reasons = scene_reasons
    elif (spaces & _UNIQUE_SPACES) or len(uv_maps) > 1 or unique_notes:
        routing = "unique"
        reasons = unique_notes
    elif "uv" in spaces:
        routing = "tileable"
        reasons = []
    else:
        routing = "uniform"
        reasons = []

    return {
        "channel": name,
        "linked": True,
        "routing": routing,
        "spaces": sorted(spaces),
        "uvMaps": sorted(uv_maps),
        "usesActiveUv": uses_active_uv,
        "animated": bool(animated_sources),
        "reasons": list(dict.fromkeys(reasons)),
    }


def _single_principled_surface_root(nodes):
    """The one Principled BSDF owning the surface, or None.

    Groups, group inputs, and reroutes are structural.  Any other node with a
    linked shader output — another BSDF, Emission, Mix/Add Shader, Holdout —
    means the surface is not a single-Principled root, unless every one of
    its shader links feeds Shader to RGB: that closure is a channel input,
    not a surface competitor, and the scene-dependence refusal already rides
    the Shader to RGB visit.
    """
    root = None
    for node in nodes:
        if node.bl_idname in {"ShaderNodeGroup", "NodeGroupInput",
                              "NodeReroute"}:
            continue
        shader_links = [
            link
            for output in getattr(node, "outputs", ())
            if getattr(output, "type", "") == "SHADER"
            for link in output.links
        ]
        if not shader_links:
            continue
        if all(link.to_node.bl_idname == "ShaderNodeShaderToRGB"
               for link in shader_links):
            continue
        if node.bl_idname != "ShaderNodeBsdfPrincipled" or root is not None:
            return None
        root = node
    return root


def material_channel_routing(tree, nodes):
    """JSON-safe MTL-UV-002 coordinate-space routing for every channel.

    ``routing`` per channel: ``constant`` (unlinked — stays a glTF factor),
    ``uniform`` (linked but spatially constant), ``tileable`` (driven only by
    the mesh's own UVs — candidate for a 0..1 tile bake with authored UVs
    kept), ``unique`` (position/object/generated/attribute-driven — needs a
    non-overlapping unwrap), ``viewDependent``/``sceneDependent`` (cannot be
    a baked channel), or ``unknown`` (unclassified node; stays refused).

    ``animated`` is tree-granular: a driver or action anywhere in a node tree
    marks every channel touching that tree, which is conservative but never
    unsafe — an animated input channel must refuse a bake that would freeze
    it.
    """
    root = _single_principled_surface_root(nodes)
    if root is None:
        return {
            "model": CHANNEL_ROUTING_MODEL,
            "surfaceRoot": "unsupported",
            "reason": (
                "Channel routing needs exactly one Principled BSDF driving "
                "the active Surface."
            ),
            "channels": [],
        }
    if root.id_data.as_pointer() != tree.as_pointer():
        return {
            "model": CHANNEL_ROUTING_MODEL,
            "surfaceRoot": "unsupported",
            "reason": (
                "Channel routing supports a root-level Principled BSDF; "
                "this one lives inside a node group."
            ),
            "channels": [],
        }
    channels = []
    for name in _CHANNEL_ROUTING_INPUTS:
        socket = _node_input(root, name)
        if socket is None:
            continue
        channels.append(_classify_channel(name, socket))
    return {
        "model": CHANNEL_ROUTING_MODEL,
        "surfaceRoot": "principled",
        "channels": channels,
    }


def analyze_material(material):
    """Explain how faithfully Blender's stock glTF exporter can publish it.

    ``exact`` means the authored parameters have a known glTF representation;
    it does not promise pixel identity between Blender and website lighting.
    The result is deliberately JSON-safe so the addon and exporter can share
    one contract without mutating or rewriting the artist's node graph.
    """
    if material is None:
        return {
            "material": "",
            "status": "exact",
            "label": "Exact glTF",
            "summary": "The default material publishes directly.",
            "reasons": [],
            "cyclesAppearance": _cycles_appearance_compatibility(()),
        }
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return {
            "material": material.name,
            "status": "exact",
            "label": "Exact glTF",
            "summary": "Simple material values publish through Blender's glTF exporter.",
            "reasons": [],
            "cyclesAppearance": _cycles_appearance_compatibility(()),
        }

    nodes = reachable_surface_nodes(tree)
    cycles_appearance = _cycles_appearance_compatibility(nodes)
    if not nodes:
        return {
            "material": material.name,
            "status": "approximated",
            "label": "Approximated",
            "summary": "No active Surface shader is connected; the website uses a fallback material.",
            "reasons": ["Connect a Principled BSDF to the active Material Output Surface."],
            "cyclesAppearance": cycles_appearance,
        }

    needs_bake = []
    approximated = []
    principled = [node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"]
    material_capabilities = _material_exporter_capabilities()
    fixed_camera_unlit = _fixed_camera_unlit_nodes(tree)
    if fixed_camera_unlit:
        if material_capabilities["fixedCameraUnlit"]:
            approximated.append(
                "Blender's exporter-recognized camera-ray unlit/alpha surface publishes as "
                "KHR_materials_unlit; raster alpha and object-level shadow flags replace "
                "Blender's per-ray shader behavior.",
            )
        else:
            needs_bake.append(
                "The fixed-camera camera-ray unlit/alpha grammar is verified only for "
                "Blender glTF exporter 5.2.39; installed exporter "
                f"{_exporter_version_label(material_capabilities)} stays conservative.",
            )
    portable_alpha_math = set()
    unverified_alpha_math = set()
    for node in principled:
        matched = _recognized_alpha_clip_math_nodes(node)
        if material_capabilities["alphaClipMath"]:
            portable_alpha_math.update(matched)
        else:
            unverified_alpha_math.update(matched)
    for node in nodes:
        node_id = node.bl_idname
        label = _material_node_label(node)
        if node.as_pointer() in fixed_camera_unlit:
            pass
        elif node_id in _PROCEDURAL_MATERIAL_NODES:
            needs_bake.append(
                f"{label} contributes to the active surface but cannot be represented as editable glTF.",
            )
        elif node_id in {"ShaderNodeMixShader", "ShaderNodeAddShader"}:
            needs_bake.append(
                f"{label} combines shaders; Blender's glTF exporter may silently keep only one branch.",
            )
        elif node_id == "ShaderNodeBump":
            needs_bake.append(
                "Bump shading has no direct glTF form; bake it to a normal map or use a Normal Map node.",
            )
        elif node_id == "ShaderNodeTexCoord":
            non_uv_outputs = [
                name for name in _contributing_output_names(node, nodes)
                if name != "UV"
            ]
            if non_uv_outputs:
                outputs = ", ".join(non_uv_outputs)
                needs_bake.append(
                    f"Texture Coordinate {outputs} output is not serialized by stock glTF; "
                    "author a UV map or bake the result.",
                )
        elif node_id == "ShaderNodeAttribute":
            needs_bake.append(
                "Attribute data in the active shader is not a portable editable glTF input; "
                "bake it or replace it with an authored UV/vertex-color workflow.",
            )
        elif node_id == "ShaderNodeTangent":
            if getattr(node, "direction_type", "") == "UV_MAP":
                approximated.append(
                    "Tangent input is only recognized inside the stock exporter's specific "
                    "anisotropy texture pattern; a direct tangent link may be simplified.",
                )
            else:
                needs_bake.append(
                    "Tangent shading outside a UV-map tangent basis has no editable glTF form.",
                )
        elif node_id == "ShaderNodeEmission":
            approximated.append(
                "Emission Shader is reduced to glTF emissive/unlit behavior; scene-light interaction can differ.",
            )
        elif node_id == "ShaderNodeMath" and node.as_pointer() in portable_alpha_math:
            pass
        elif node_id == "ShaderNodeMath" and node.as_pointer() in unverified_alpha_math:
            needs_bake.append(
                "Alpha clip Math transport is verified only for Blender glTF "
                f"exporter 5.2.39; installed exporter "
                f"{_exporter_version_label(material_capabilities)} stays conservative.",
            )
        elif node_id not in _PORTABLE_MATERIAL_NODES:
            needs_bake.append(
                f"{label} is not a portable stock glTF material node.",
            )

    if len(principled) > 1:
        needs_bake.append(
            "More than one Principled shader contributes to the surface; glTF stores one material model.",
        )
    for node in principled:
        for status, reason in _principled_omissions(
            node, tree, material_capabilities,
        ):
            (needs_bake if status == "needsBake" else approximated).append(reason)

    # Preserve traversal order for useful explanations while removing repeats
    # introduced by nested groups or multiple sockets using the same node.
    needs_bake = list(dict.fromkeys(needs_bake))
    approximated = list(dict.fromkeys(approximated))
    channels = material_channel_routing(tree, nodes)
    if needs_bake:
        return {
            "material": material.name,
            "status": "needsBake",
            "label": "Needs Bake",
            "summary": "The active shader graph cannot publish faithfully as editable glTF.",
            "reasons": needs_bake + approximated,
            "cyclesAppearance": cycles_appearance,
            "channels": channels,
        }
    if approximated:
        return {
            "material": material.name,
            "status": "approximated",
            "label": "Approximated",
            "summary": (
                "The exporter-recognized unlit material publishes, with the named "
                "raster/per-ray differences."
                if fixed_camera_unlit
                else "The portable PBR material publishes, with the named Blender details simplified."
            ),
            "reasons": approximated,
            "cyclesAppearance": cycles_appearance,
            "channels": channels,
        }
    return {
        "material": material.name,
        "status": "exact",
        "label": "Exact glTF",
        "summary": (
            "Supported Principled inputs publish through Blender's glTF exporter. "
            "Changes update in Live Preview when you save."
        ),
        "reasons": [],
        "cyclesAppearance": cycles_appearance,
        "channels": channels,
    }


def _dependency_name(value):
    if isinstance(value, bpy.types.Object):
        return "objects", value.name
    if isinstance(value, bpy.types.Collection):
        return "collections", value.name
    return None


def _animated_id(value):
    animation = getattr(value, "animation_data", None)
    if not animation:
        return False
    if animation.action or animation.drivers:
        return True
    if not getattr(animation, "use_nla", True):
        return False
    tracks = [track for track in getattr(animation, "nla_tracks", ())
              if not getattr(track, "mute", False)]
    solo_tracks = [track for track in tracks if getattr(track, "is_solo", False)]
    effective_tracks = solo_tracks or tracks
    return any(
        not getattr(strip, "mute", False)
        for track in effective_tracks
        for strip in getattr(track, "strips", ())
    )


def _action_or_nla(value):
    """Whether an ID has an authored timeline source, excluding drivers."""
    animation = getattr(value, "animation_data", None)
    if not animation:
        return False
    if animation.action:
        return True
    if not getattr(animation, "use_nla", True):
        return False
    tracks = [track for track in getattr(animation, "nla_tracks", ())
              if not getattr(track, "mute", False)]
    solo_tracks = [track for track in tracks if getattr(track, "is_solo", False)]
    return any(
        not getattr(strip, "mute", False)
        for track in (solo_tracks or tracks)
        for strip in getattr(track, "strips", ())
    )


def _effective_nla_strips(animation):
    """Yield the NLA strips Blender can currently evaluate."""
    if animation is None or not getattr(animation, "use_nla", True):
        return ()
    tracks = [track for track in getattr(animation, "nla_tracks", ())
              if not getattr(track, "mute", False)]
    solo_tracks = [track for track in tracks if getattr(track, "is_solo", False)]
    return tuple(
        strip
        for track in (solo_tracks or tracks)
        for strip in getattr(track, "strips", ())
        if not getattr(strip, "mute", False)
    )


def _action_fcurves(action, slot=None):
    """Return one Action slot's F-Curves across legacy and layered Actions.

    Blender 4.4 introduced Action slots.  Blender 5.x migrated old actions to
    a layered Action whose curves live in keyframe-strip channelbags, while
    older supported versions expose ``Action.fcurves`` directly.  The boolean
    says whether a non-empty action was inspected completely enough to make a
    transform-only claim; unknown representations stay conservative.
    """
    if action is None:
        return (), True
    try:
        legacy_curves = tuple(action.fcurves)
    except (AttributeError, RuntimeError):
        legacy_curves = ()
    if legacy_curves:
        return legacy_curves, True
    if not getattr(action, "is_action_layered", False):
        return legacy_curves, bool(getattr(action, "is_empty", not legacy_curves))

    action_slots = tuple(getattr(action, "slots", ()))
    selected_slots = (slot,) if slot is not None else action_slots
    curves = []
    seen = set()
    for layer in getattr(action, "layers", ()):
        if getattr(layer, "mute", False):
            continue
        for strip in getattr(layer, "strips", ()):
            for selected_slot in selected_slots:
                try:
                    channelbag = strip.channelbag(selected_slot)
                except (AttributeError, RuntimeError, TypeError):
                    continue
                if channelbag is None:
                    continue
                for curve in getattr(channelbag, "fcurves", ()):
                    try:
                        pointer = curve.as_pointer()
                    except (AttributeError, RuntimeError):
                        pointer = id(curve)
                    if pointer not in seen:
                        seen.add(pointer)
                        curves.append(curve)
    inspectable = bool(curves) or bool(getattr(action, "is_empty", False))
    return tuple(curves), inspectable


def _action_changes_local_geometry(action, slot=None):
    curves, inspectable = _action_fcurves(action, slot)
    if not inspectable:
        # A non-empty Action in an unknown representation cannot be proven to
        # contain only portable transform channels.
        return True
    return any(
        str(getattr(curve, "data_path", "")) not in _PORTABLE_OBJECT_TRANSFORM_PATHS
        for curve in curves
    )


def _expression_uses_frame(expression):
    try:
        tree = ast.parse(str(expression or ""), mode="eval")
    except SyntaxError:
        # An invalid driver cannot be proven static.
        return True
    return any(
        isinstance(node, ast.Name) and node.id in {"frame", "time"}
        for node in ast.walk(tree)
    )


def _driver_time_dependent(curve, seen):
    if getattr(curve, "mute", False):
        return False
    if any(not getattr(modifier, "mute", False)
           for modifier in getattr(curve, "modifiers", ())):
        return True
    driver = curve.driver
    if _expression_uses_frame(getattr(driver, "expression", "")):
        return True
    for variable in driver.variables:
        if variable.type == "CONTEXT_PROP":
            return True
        for target in variable.targets:
            dependency = target.id
            data_path = str(getattr(target, "data_path", "") or "")
            if data_path == "frame_current" or data_path.startswith("frame_current["):
                return True
            if dependency is None:
                continue
            if _time_dependent_id(dependency, set(seen)):
                return True
            if isinstance(dependency, bpy.types.Object):
                if getattr(dependency, "constraints", None):
                    return True
                if _time_dependent_id(getattr(dependency, "data", None), set(seen)):
                    return True
                parent = getattr(dependency, "parent", None)
                if parent is not None and _time_dependent_id(parent, set(seen)):
                    return True
    return False


def _time_dependent_id(value, seen=None):
    """Whether animation or a driver dependency can change an ID by frame.

    Blender commonly uses drivers as authoring constraints between static
    custom properties (for example, a Book Thickness control driving a
    Geometry Nodes socket). A driver existing is therefore not evidence of
    timeline animation. Follow its variables and only enter the finite-frame
    audit when a real time source, action/NLA strip, animated dependency, or
    frame-varying driver modifier is present.
    """
    if value is None:
        return False
    seen = seen if seen is not None else set()
    pointer = value.as_pointer()
    if pointer in seen:
        return False
    seen.add(pointer)
    if _action_or_nla(value):
        return True
    animation = getattr(value, "animation_data", None)
    if not animation:
        return False
    for curve in getattr(animation, "drivers", ()):
        if _driver_time_dependent(curve, seen):
            return True
    return False


def _time_dependent_local_geometry(obj):
    """Whether the host Object animates something besides its glTF transform.

    A Geometry Nodes modifier evaluates an Object-local mesh.  Location,
    rotation, and scale animation is serialized separately by core glTF and
    must not force that local result through an unsupported morph/VAT cache.
    Modifier inputs, custom properties, and other Object paths can change the
    evaluated mesh, so they remain conservative time dependencies.  Explicit
    Object/Collection inputs are handled independently by
    ``_animated_dependencies`` and therefore still see transform animation.
    """
    animation = getattr(obj, "animation_data", None)
    if animation is None:
        return False
    action = getattr(animation, "action", None)
    if action is not None and _action_changes_local_geometry(
            action, getattr(animation, "action_slot", None)):
        return True
    for strip in _effective_nla_strips(animation):
        action = getattr(strip, "action", None)
        if action is not None and _action_changes_local_geometry(
                action, getattr(strip, "action_slot", None)):
            return True
    seen = {obj.as_pointer()}
    for curve in getattr(animation, "drivers", ()):
        if str(getattr(curve, "data_path", "")) in _PORTABLE_OBJECT_TRANSFORM_PATHS:
            continue
        if _driver_time_dependent(curve, seen):
            return True
    return False


def _portable_transform_animation_paths(obj):
    """Name Object channels that remain independent core-glTF animation."""
    animation = getattr(obj, "animation_data", None)
    if animation is None:
        return ()
    paths = set()
    action = getattr(animation, "action", None)
    if action is not None:
        curves, inspectable = _action_fcurves(
            action, getattr(animation, "action_slot", None),
        )
        if inspectable:
            paths.update(
                str(curve.data_path) for curve in curves
                if str(curve.data_path) in _PORTABLE_OBJECT_TRANSFORM_PATHS
            )
    for strip in _effective_nla_strips(animation):
        action = getattr(strip, "action", None)
        if action is None:
            continue
        curves, inspectable = _action_fcurves(
            action, getattr(strip, "action_slot", None),
        )
        if inspectable:
            paths.update(
                str(curve.data_path) for curve in curves
                if str(curve.data_path) in _PORTABLE_OBJECT_TRANSFORM_PATHS
            )
    paths.update(
        str(curve.data_path)
        for curve in getattr(animation, "drivers", ())
        if str(getattr(curve, "data_path", "")) in _PORTABLE_OBJECT_TRANSFORM_PATHS
    )
    return tuple(sorted(paths))


def _animated_transform_dependency(obj, seen=None):
    """Name the first object/data dependency that can move a render mesh."""
    if obj is None:
        return None
    seen = seen if seen is not None else set()
    pointer = obj.as_pointer()
    if pointer in seen:
        return None
    seen.add(pointer)
    data = getattr(obj, "data", None)
    if _animated_id(obj) or _animated_id(data):
        return obj.name
    shape_keys = getattr(data, "shape_keys", None)
    if shape_keys is not None and _animated_id(shape_keys):
        return shape_keys.name
    parent_source = _animated_transform_dependency(getattr(obj, "parent", None), seen)
    if parent_source:
        return parent_source
    for constraint in getattr(obj, "constraints", ()):
        # Constraint behavior is not a portable glTF runtime contract; even a
        # static target can be moved later by website code.
        return constraint.name or constraint.type
    return None


def _linked_output(node, *names):
    return any(
        socket.is_linked and (not names or socket.name in names)
        for socket in getattr(node, "outputs", ())
    )


def material_realtime_reason(material):
    """Why a material cannot honestly become a static unlit lightmap."""
    if material is None:
        return None
    if len(material.diffuse_color) > 3 and material.diffuse_color[3] < 0.999:
        return "viewport alpha is below one"
    if getattr(material, "surface_render_method", "") == "BLENDED":
        return "blended surface"
    if not hasattr(material, "surface_render_method") and getattr(
            material, "blend_method", "OPAQUE") in {"BLEND", "HASHED", "CLIP"}:
        return "non-opaque surface"
    pointer_reason = material_pointer_animation_reason(material)
    if pointer_reason:
        return pointer_reason
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return None
    for node_tree in _walk_node_trees(tree):
        for node in node_tree.nodes:
            if node.bl_idname == "ShaderNodeOutputMaterial":
                volume = node.inputs.get("Volume")
                if volume is not None and volume.is_linked:
                    return "volume output is view/ray dependent"
            if node.bl_idname in _VIEW_DEPENDENT_SHADER_NODES and _linked_output(node):
                return f"{node.bl_label or node.bl_idname} is view/ray dependent"
            if node.bl_idname == "ShaderNodeTexCoord" and _linked_output(node, "Camera", "Reflection"):
                return "camera/reflection texture coordinates are view dependent"
            if node.bl_idname == "ShaderNodeNewGeometry" and _linked_output(node, "Incoming", "Backfacing"):
                return "incoming/backfacing geometry data is view dependent"
            if node.bl_idname != "ShaderNodeBsdfPrincipled" or not _linked_output(node):
                continue
            alpha = node.inputs.get("Alpha")
            if alpha is not None and (alpha.is_linked or float(alpha.default_value) < 0.999):
                return "Principled alpha is linked or below one"
            transmission = node.inputs.get("Transmission Weight") or node.inputs.get("Transmission")
            if transmission is not None and (
                    transmission.is_linked or float(transmission.default_value) > 0.001):
                return "Principled transmission is linked or above zero"
    return None


def fixed_camera_material_bake_reason(material):
    """Return the camera-dependent reason an opaque material may bake.

    This is intentionally stricter than :func:`material_realtime_reason`.
    Cycles' ``ACTIVE_CAMERA`` bake origin can evaluate facing/Fresnel/camera
    inputs for one authored view, but it does not turn alpha, transmission,
    volumes, or Light Path branching into a compositable surface texture.
    Returning ``None`` means the material must remain Realtime unless the
    artist explicitly accepts a Baked override.
    """
    reason = material_realtime_reason(material)
    if reason is None or material is None:
        return None
    if len(material.diffuse_color) > 3 and material.diffuse_color[3] < 0.999:
        return None
    if getattr(material, "surface_render_method", "") == "BLENDED":
        return None
    if not hasattr(material, "surface_render_method") and getattr(
            material, "blend_method", "OPAQUE") in {"BLEND", "HASHED", "CLIP"}:
        return None
    if material_pointer_animation_reason(material):
        return None
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return None

    found_camera_input = False
    for node_tree in _walk_node_trees(tree):
        for node in node_tree.nodes:
            if node.bl_idname == "ShaderNodeOutputMaterial":
                volume = node.inputs.get("Volume")
                if volume is not None and volume.is_linked:
                    return None
            if node.bl_idname in _FIXED_CAMERA_APPEARANCE_UNSAFE_NODES \
                    and _linked_output(node):
                return None
            if node.bl_idname in _FIXED_CAMERA_APPEARANCE_NODES \
                    and _linked_output(node):
                found_camera_input = True
            if node.bl_idname == "ShaderNodeTexCoord" \
                    and _linked_output(node, "Camera", "Reflection"):
                found_camera_input = True
            if node.bl_idname == "ShaderNodeNewGeometry" \
                    and _linked_output(node, "Incoming", "Backfacing"):
                found_camera_input = True
            if node.bl_idname != "ShaderNodeBsdfPrincipled" or not _linked_output(node):
                continue
            alpha = node.inputs.get("Alpha")
            if alpha is not None and (
                    alpha.is_linked or float(alpha.default_value) < 0.999):
                return None
            transmission = (
                node.inputs.get("Transmission Weight")
                or node.inputs.get("Transmission")
            )
            if transmission is not None and (
                    transmission.is_linked
                    or float(transmission.default_value) > 0.001):
                return None
    return reason if found_camera_input else None


def fixed_camera_appearance_bake_reason(obj):
    """Why Automatic may bake this object for a fixed-camera Appearance.

    Explicit Realtime/Baked choices always win.  Geometry motion and every
    unsafe material slot keep the object out; only static meshes whose complete
    realtime reason is camera-dependent opaque shading qualify.
    """
    if obj.get("blendlink_dynamic") is not None:
        return None
    automatic = automatic_dynamic_reason(obj)
    if automatic is None or not automatic.startswith("view-dependent material"):
        return None
    found = False
    for slot in obj.material_slots:
        material = slot.material
        reason = material_realtime_reason(material)
        if reason is None:
            continue
        if fixed_camera_material_bake_reason(material) is None:
            return None
        found = True
    return automatic if found else None


def effective_dynamic_reason(obj, *, fixed_camera_appearance=False):
    """Apply project context without weakening the context-free safety rule."""
    reason = dynamic_reason(obj)
    if reason is None or not fixed_camera_appearance:
        return reason
    if fixed_camera_appearance_bake_reason(obj) is not None:
        return None
    return reason


def material_pointer_animation_reason(material):
    """Name property animation that core glTF/Three cannot bind by itself."""
    if material is None:
        return None
    if _animated_id(material):
        return "material values are animated or driven"
    tree = bakelib.active_shader_node_tree(material)
    if tree is not None:
        for node_tree in _walk_node_trees(tree):
            if _animated_id(node_tree):
                return f"shader group {node_tree.name!r} is animated or driven"
    return None


def pointer_animation_reasons(obj):
    """Return every KHR_animation_pointer dependency core Three would drop.

    One mesh can use several independently animated materials. Returning only
    the first made a Final refusal actionable for one slot while hiding the
    next one, which is especially misleading for Pip's two shell materials.
    Keep stable slot/tree order and remove duplicate bindings to the same
    material so the artist gets one consequence per authored source.
    """
    reasons = []
    data = getattr(obj, "data", None)
    if obj.type in {"LIGHT", "CAMERA"} and _animated_id(data):
        reasons.append(f"{obj.type.lower()} data values are animated or driven")
    if obj.type == "LIGHT" and data is not None:
        tree = bakelib.active_shader_node_tree(data)
        if tree is not None:
            for node_tree in _walk_node_trees(tree):
                if _animated_id(node_tree):
                    reasons.append(
                        f"light shader group {node_tree.name!r} is animated or driven"
                    )
                    break
    seen_materials = set()
    for slot in getattr(obj, "material_slots", ()):
        material = slot.material
        if material is None:
            continue
        pointer = material.as_pointer()
        if pointer in seen_materials:
            continue
        seen_materials.add(pointer)
        reason = material_pointer_animation_reason(material)
        if reason:
            reasons.append(f"material {material.name!r}: {reason}")
    return tuple(dict.fromkeys(reasons))


def pointer_animation_reason(obj):
    """Return the first KHR_animation_pointer dependency for compact UI."""
    return next(iter(pointer_animation_reasons(obj)), None)


def pointer_animation_issues(scene, allow_forced_bake=False, objects=None):
    """List non-transform animation that needs an explicit Three loader plugin.

    Blendlink currently emits portable core-Three assets, so these are loud
    blockers. An explicitly Baked mesh may freeze the values only when the
    active compiler mode actually bakes it.
    """
    issues = []
    world = scene.world
    if world is not None:
        reason = None
        if _animated_id(world):
            reason = "world values are animated or driven"
        else:
            tree = bakelib.active_shader_node_tree(world)
            for node_tree in _walk_node_trees(tree) if tree is not None else ():
                if _animated_id(node_tree):
                    reason = f"world shader group {node_tree.name!r} is animated or driven"
                    break
        if reason:
            issues.append({"object": "World", "reason": reason})
    for obj in tuple(scene.objects) if objects is None else tuple(objects):
        reasons = pointer_animation_reasons(obj)
        if not reasons:
            continue
        explicitly_baked = (
            obj.type == "MESH"
            and (obj.get("blendlink_dynamic") is False or obj.get("blendlink_dynamic") == 0)
        )
        if allow_forced_bake and explicitly_baked:
            continue
        issues.extend({"object": obj.name, "reason": reason} for reason in reasons)
    return issues


def automatic_dynamic_reason(obj):
    """Automatic safety reason without applying the artist's override."""
    animation_source = _animated_transform_dependency(obj)
    if animation_source:
        return f"animated or constrained by {animation_source!r}"
    if getattr(obj.data, "shape_keys", None) is not None:
        return "shape-key mesh (a static lightmap cannot follow morphs)"
    modifier = next((mod for mod in obj.modifiers
                     if mod.show_render and mod.type in _ALWAYS_DYNAMIC_MODIFIERS), None)
    if modifier is not None:
        return f"{modifier.type.lower().replace('_', ' ')} modifier {modifier.name!r} can deform"
    if getattr(obj, "particle_systems", None) and len(obj.particle_systems) > 0:
        return "particle-system geometry is time-dependent"
    for slot in obj.material_slots:
        material = slot.material
        reason = material_realtime_reason(material)
        if reason:
            return f"view-dependent material {material.name!r}: {reason}"
    return None


def forced_bake_risk(obj):
    """Safety consequence accepted by an explicit Baked override, if any."""
    if obj.get("blendlink_dynamic") is not False and obj.get("blendlink_dynamic") != 0:
        return None
    return automatic_dynamic_reason(obj)


def dynamic_reason(obj):
    """Why a mesh retains realtime lighting after artist intent is applied."""
    explicit = obj.get("blendlink_dynamic")
    if explicit is not None:
        return "explicitly marked Realtime" if explicit else None
    return automatic_dynamic_reason(obj)


def _animated_geometry_data(value):
    """Animation can live on a mesh or its separate Shape Keys datablock."""
    return bool(
        value is not None
        and (
            _animated_id(value)
            or _animated_id(getattr(value, "shape_keys", None))
        )
    )


def _time_dependent_geometry_data(value):
    return bool(
        value is not None
        and (
            _time_dependent_id(value)
            or _time_dependent_id(getattr(value, "shape_keys", None))
        )
    )


def _modifier_facts(modifier, scene):
    node_types = set()
    objects = set()
    collections = set()
    animated_node_groups = set()
    for tree in _walk_node_trees(modifier.node_group):
        if _time_dependent_id(tree):
            animated_node_groups.add(tree.name)
        for node in tree.nodes:
            node_types.add(node.bl_idname)
            for socket in getattr(node, "inputs", ()):
                try:
                    dependency = _dependency_name(socket.default_value)
                except (AttributeError, RuntimeError, TypeError):
                    dependency = None
                if dependency:
                    (objects if dependency[0] == "objects" else collections).add(dependency[1])

    # Object/Collection interface inputs are stored on the modifier, rather
    # than the group node's default socket.  Scan only ID values; other custom
    # properties are implementation detail and need not enter the contract.
    try:
        modifier_items = list(modifier.items())
    except TypeError:
        # A new/empty Geometry Nodes modifier may not have an IDProperty group
        # until interface values are authored.
        modifier_items = []
    for _key, value in modifier_items:
        try:
            dependency = _dependency_name(value)
        except (KeyError, RuntimeError, TypeError):
            dependency = None
        if dependency:
            (objects if dependency[0] == "objects" else collections).add(dependency[1])

    uses_active_camera = bool(node_types & _CAMERA_NODES)
    if scene.camera and scene.camera.name in objects:
        uses_active_camera = True
    return {
        "name": modifier.name,
        "nodeGroup": modifier.node_group.name if modifier.node_group else None,
        "nodeTypes": sorted(node_types),
        "usesSceneTime": bool(node_types & _TIME_NODES),
        "usesCamera": uses_active_camera,
        "objects": sorted(objects),
        "collections": sorted(collections),
        "animatedNodeGroups": sorted(animated_node_groups),
        "hasSimulation": bool(node_types & _SIMULATION_NODES),
        "hasNamedAttributes": bool(node_types & _NAMED_ATTRIBUTE_NODES),
        "hasUnrealizedInstances": bool(node_types & _INSTANCE_NODES)
                                  and not bool(node_types & _REALIZE_NODES),
    }


def _topology_hash(mesh):
    """Hash counts and triangle connectivity, excluding positions."""
    digest = hashlib.sha256()
    mesh.calc_loop_triangles()
    digest.update(struct.pack(
        "<5Q", len(mesh.vertices), len(mesh.edges), len(mesh.polygons),
        len(mesh.loops), len(mesh.loop_triangles),
    ))
    for triangle in mesh.loop_triangles:
        digest.update(struct.pack("<3I", *triangle.vertices))
    return digest.hexdigest()[:16]


def _position_hash(mesh):
    digest = hashlib.sha256()
    for vertex in mesh.vertices:
        digest.update(struct.pack("<3f", *vertex.co))
    return digest.hexdigest()[:16]


def _hash_channel_value(digest, value):
    if isinstance(value, bool):
        digest.update(b"b1" if value else b"b0")
    elif isinstance(value, int):
        digest.update(b"i" + struct.pack("<q", value))
    elif isinstance(value, float):
        digest.update(b"f" + struct.pack("<d", value))
    elif isinstance(value, str):
        digest.update(b"s" + value.encode("utf8", "backslashreplace") + b"\0")
    else:
        try:
            values = list(value)
        except (TypeError, ValueError):
            digest.update(repr(value).encode("utf8", "backslashreplace") + b"\0")
        else:
            digest.update(b"[")
            for item in values:
                _hash_channel_value(digest, item)
            digest.update(b"]")


def _appearance_hash(mesh):
    """Hash evaluated channels that can change shipped shading/appearance."""
    digest = hashlib.sha256()
    for material in mesh.materials:
        _hash_channel_value(digest, material.name if material else None)
    for polygon in mesh.polygons:
        _hash_channel_value(digest, (polygon.material_index, polygon.use_smooth))
    for attribute in sorted(
            mesh.attributes, key=lambda item: (item.name, item.domain, item.data_type)):
        if attribute.name in {"position", ".corner_vert", ".corner_edge", ".edge_verts"}:
            continue
        _hash_channel_value(digest, (attribute.name, attribute.domain, attribute.data_type))
        for item in attribute.data:
            for field in ("value", "vector", "color", "byte_color", "uv"):
                if hasattr(item, field):
                    _hash_channel_value(digest, getattr(item, field))
                    break
    return digest.hexdigest()[:16]


def _normal_hash(mesh):
    digest = hashlib.sha256()
    try:
        for normal in mesh.corner_normals:
            _hash_channel_value(digest, normal.vector)
    except (AttributeError, RuntimeError):
        digest.update(b"NO_CORNER_NORMALS")
    return digest.hexdigest()[:16]


def _mesh_snapshot(mesh, frame):
    mesh.calc_loop_triangles()
    return {
        "frame": int(frame),
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
        "triangles": len(mesh.loop_triangles),
        "topologyHash": _topology_hash(mesh),
        "positionHash": _position_hash(mesh),
        "appearanceHash": _appearance_hash(mesh),
        "normalHash": _normal_hash(mesh),
    }


def _evaluated_snapshot_at_current_frame(obj, scene, frame, depsgraph=None):
    """Snapshot one object after the caller has selected ``frame``.

    Timeline traversal is scene-owned: setting a frame once and evaluating
    every admitted object avoids object-major dependency-graph churn on large
    scenes.  Keeping the frame argument in the record makes the resulting
    evidence byte-identical in shape to the former per-object sampler.
    """
    depsgraph = depsgraph or bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    if mesh is None:
        raise RuntimeError(f'{obj.name}: evaluated Geometry Nodes output is not a mesh')
    try:
        return _mesh_snapshot(mesh, frame)
    finally:
        evaluated.to_mesh_clear()


def _set_audit_frame(scene, frame):
    """Small test seam around Blender's stateful timeline mutation."""
    scene.frame_set(frame)


def _animation_sources(dependency, seen=None):
    """Return animation sources that can move/change an object indirectly.

    Geometry Nodes object/collection inputs inherit parent transforms and can
    be driven through constraints. Looking only at the referenced object's own
    action misses both cases and can incorrectly bless a time-dependent graph
    as a still realization.
    """
    if dependency is None:
        return set()
    seen = seen if seen is not None else set()
    pointer = dependency.as_pointer()
    if pointer in seen:
        return set()
    seen.add(pointer)
    animated = set()
    data = getattr(dependency, "data", None)
    if _time_dependent_id(dependency) or _time_dependent_geometry_data(data):
        animated.add(dependency.name)
    parent = getattr(dependency, "parent", None)
    animated.update(_animation_sources(parent, seen))
    for constraint in getattr(dependency, "constraints", ()): 
        target = getattr(constraint, "target", None)
        animated.update(_animation_sources(target, seen))
    return animated


def _animated_dependencies(scene, object_names, collection_names):
    animated = set()
    candidates = [scene.objects.get(name) for name in object_names]
    for collection_name in collection_names:
        collection = bpy.data.collections.get(collection_name)
        if collection:
            candidates.extend(collection.all_objects)
    for dependency in candidates:
        if dependency is None:
            continue
        animated.update(_animation_sources(dependency))
    return sorted(animated)


def _procedural_facts(obj, scene):
    """Classify one Geometry Nodes host without touching the timeline."""
    modifiers = [
        _modifier_facts(modifier, scene)
        for modifier in obj.modifiers
        if modifier.type == "NODES" and modifier.show_render
    ]
    if not modifiers:
        return None

    uses_time = any(item["usesSceneTime"] for item in modifiers)
    uses_camera = any(item["usesCamera"] for item in modifiers)
    has_simulation = any(item["hasSimulation"] for item in modifiers)
    dependency_objects = sorted({name for item in modifiers for name in item["objects"]})
    dependency_collections = sorted({name for item in modifiers for name in item["collections"]})
    animated_dependencies = set(_animated_dependencies(
        scene, dependency_objects, dependency_collections,
    ))
    if uses_camera and scene.camera:
        animated_dependencies.update(_animation_sources(scene.camera))
    animated_node_groups = sorted({
        name for item in modifiers for name in item["animatedNodeGroups"]
    })
    portable_transform_paths = _portable_transform_animation_paths(obj)
    owner_transform_can_affect_geometry = bool(portable_transform_paths) and (
        any(
            "GeometryNodeSelfObject" in item["nodeTypes"]
            for item in modifiers
        )
        or any(
            modifier.show_render
            and modifier.type not in _TRANSFORM_INVARIANT_MODIFIERS
            for modifier in obj.modifiers
        )
    )
    time_dependent = (
        uses_time or has_simulation or bool(animated_dependencies)
        or bool(animated_node_groups)
        or _time_dependent_local_geometry(obj)
        or _time_dependent_geometry_data(obj.data)
        or owner_transform_can_affect_geometry
    )
    return {
        "object_ref": obj,
        "modifiers": modifiers,
        "uses_camera": uses_camera,
        "has_simulation": has_simulation,
        "dependency_objects": dependency_objects,
        "dependency_collections": dependency_collections,
        "animated_dependencies": sorted(animated_dependencies),
        "animated_node_groups": animated_node_groups,
        "portable_transform_paths": portable_transform_paths,
        "time_dependent": time_dependent,
    }


def _sample_procedural_facts(facts, scene, full, fixed_camera):
    """Evaluate every admitted object in one scene-major timeline pass."""
    original_frame = scene.frame_current
    start, end = scene.frame_start, scene.frame_end
    frame_count = end - start + 1
    admitted = [
        item for item in facts
        if item["time_dependent"]
        and not item["has_simulation"]
        and not (item["uses_camera"] and not fixed_camera)
    ]
    required_snapshots = frame_count * len(admitted)
    exhaustive_allowed = (
        full
        and required_snapshots <= MAX_AUDIT_SNAPSHOTS
    )
    by_frame = {}
    for item in facts:
        if not full:
            sample_frames, exhaustive = [original_frame], False
        elif (
            item["has_simulation"]
            or (item["uses_camera"] and not fixed_camera)
            or not item["time_dependent"]
        ):
            # These routes are already decided without a temporal proof. One
            # current snapshot still supplies the useful source/evaluated
            # delta without paying for evidence that cannot change the route.
            sample_frames, exhaustive = [original_frame], False
        elif exhaustive_allowed:
            sample_frames, exhaustive = list(range(start, end + 1)), True
        else:
            # Endpoint/current samples can prove a rejection, never a static
            # acceptance. The finalizer blocks every non-exhaustive temporal
            # record even if these witnesses happen to match.
            sample_frames = sorted({start, original_frame, end})
            exhaustive = False
        item["samples"] = []
        item["sampled_exhaustively"] = exhaustive
        item["audit_required_snapshots"] = required_snapshots
        for frame in sample_frames:
            by_frame.setdefault(frame, []).append(item)

    try:
        for frame in sorted(by_frame):
            _set_audit_frame(scene, frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for item in by_frame[frame]:
                item["samples"].append(_evaluated_snapshot_at_current_frame(
                    item["object_ref"], scene, frame, depsgraph,
                ))
    finally:
        _set_audit_frame(scene, original_frame)


def _finalize_procedural(facts, scene, full, fixed_camera):
    obj = facts["object_ref"]
    modifiers = facts["modifiers"]
    uses_camera = facts["uses_camera"]
    has_simulation = facts["has_simulation"]
    dependency_objects = facts["dependency_objects"]
    dependency_collections = facts["dependency_collections"]
    animated_dependencies = facts["animated_dependencies"]
    animated_node_groups = facts["animated_node_groups"]
    portable_transform_paths = facts["portable_transform_paths"]
    time_dependent = facts["time_dependent"]
    samples = facts["samples"]
    exhaustive = facts["sampled_exhaustively"]
    original_frame = scene.frame_current

    topology_hashes = {sample["topologyHash"] for sample in samples}
    position_hashes = {sample["positionHash"] for sample in samples}
    appearance_hashes = {sample["appearanceHash"] for sample in samples}
    normal_hashes = {sample["normalHash"] for sample in samples}
    topology = "changing" if len(topology_hashes) > 1 else (
        "deforming" if len(position_hashes) > 1 else "static"
    )
    # Deformation naturally changes evaluated normals and can be represented
    # by a future fixed-topology morph/VAT cache. Normals alone are an
    # appearance blocker only when vertex positions stay fixed.
    appearance_changing = (
        len(appearance_hashes) > 1
        or (len(position_hashes) == 1 and len(normal_hashes) > 1)
    )
    source = _mesh_snapshot(obj.data, original_frame)
    current = next((sample for sample in samples if sample["frame"] == original_frame), samples[0])
    source_delta = {
        "vertices": current["vertices"] - source["vertices"],
        "triangles": current["triangles"] - source["triangles"],
        "topologyChanged": current["topologyHash"] != source["topologyHash"],
        "appearanceChanged": current["appearanceHash"] != source["appearanceHash"],
    }

    frame_count = scene.frame_end - scene.frame_start + 1
    estimated_morph_bytes = current["vertices"] * 3 * 4 * frame_count
    if has_simulation:
        route = "Block"
        reason = (
            "Simulation Zones have no portable glTF runtime and may depend on a baked Blender "
            "simulation state. Publish a validated proxy, VAT/runtime recipe, or a static frame."
        )
    elif uses_camera and not fixed_camera:
        route = "Block"
        reason = (
            "Camera-dependent Geometry Nodes were evaluated for Blender's active camera; that "
            "can permanently remove geometry needed by an orbiting website camera. Use explicit "
            "LOD metadata/runtime culling, or declare and validate a fixed presentation camera."
        )
    elif topology == "changing":
        route = "Block"
        reason = (
            "Evaluated vertex/index topology changes across the audited frame range. Core glTF "
            "animates transforms or fixed-topology morph weights, not changing vertex/index "
            "counts; choose a VAT/point-cache adapter, proxy, or runtime recipe."
        )
    elif appearance_changing:
        route = "Block"
        reason = (
            "Evaluated topology and positions are stable, but material indices, normals, UVs, "
            "colors, or named attributes change across the audited range. A frozen glTF frame "
            "would lose that procedural appearance; use an explicit attribute/VAT/runtime "
            "recipe or publish a validated still."
        )
    elif time_dependent and not full:
        route = "Cache"
        reason = (
            "Time or an animated object dependency drives this node graph. Preview shows the current evaluated frame only; "
            "the publish audit must prove fixed topology across the finite range before any "
            "morph/VAT cache can be considered."
        )
    elif time_dependent and not exhaustive:
        route = "Block"
        reason = (
            f"An exhaustive audit of {frame_count} frames across the admitted procedural "
            f"scene requires {facts['audit_required_snapshots']} evaluated object-frame "
            f"snapshots, which exceeds Blendlink's deterministic "
            f"{MAX_AUDIT_SNAPSHOTS}-snapshot "
            "budget. Shorten the publish range, exclude unrelated objects from this scene, "
            "or provide an explicit cache/proxy recipe; endpoint/current samples are "
            "evidence for rejection, not a static-geometry guarantee."
        )
    elif time_dependent and topology == "deforming":
        route = "Cache"
        if estimated_morph_bytes > MAX_MORPH_CACHE_BYTES:
            reason = (
                f"Topology is constant across all {frame_count} frames, but a raw position cache "
                f"is about {estimated_morph_bytes / (1024 * 1024):.1f} MiB, over the "
                f"{MAX_MORPH_CACHE_BYTES // (1024 * 1024)} MiB review budget. Use a VAT, lower-rate "
                "proxy, or authored runtime recipe."
            )
        else:
            reason = (
                f"Topology is constant across all {frame_count} frames; a finite deformation "
                f"cache is technically possible (~{estimated_morph_bytes / (1024 * 1024):.1f} MiB "
                "raw positions), but Blendlink will not emit a non-standard cache without an "
                "explicit VAT/morph adapter and visual gate."
            )
    elif time_dependent:
        route = "Realize"
        reason = (
            f"All {frame_count} audited frames evaluate to identical geometry; the still "
            "evaluated result is safe to realize for this publish range."
        )
    elif uses_camera:
        route = "Realize"
        reason = (
            "Camera-dependent geometry was evaluated for the exact camera owned by the Fixed "
            "website contract. The evaluated still result is safe while that camera remains fixed."
        )
    else:
        route = "Realize"
        reason = (
            "The evaluated still result ships as ordinary glTF geometry; the editable node graph remains in Blender."
            + (
                " The Object's " + ", ".join(portable_transform_paths)
                + " animation remains separate core glTF transform animation."
                if portable_transform_paths else ""
            )
        )

    return {
        "object": obj.name,
        **({"objectId": obj.get("blendlink_id")} if isinstance(obj.get("blendlink_id"), str) else {}),
        "modifiers": modifiers,
        "dependencies": {
            "camera": uses_camera,
            "objects": dependency_objects,
            "collections": dependency_collections,
            "animated": sorted(animated_dependencies),
            "animatedNodeGroups": animated_node_groups,
        },
        "source": source,
        "samples": samples,
        "sampledExhaustively": exhaustive,
        "frameRange": [scene.frame_start, scene.frame_end],
        "topology": topology,
        "appearanceChanging": appearance_changing,
        "sourceDelta": source_delta,
        "route": route,
        "blocking": route in {"Block", "Cache"},
        "reason": reason,
        **({"estimatedMorphBytes": estimated_morph_bytes} if time_dependent else {}),
    }


def _analyze_procedural(obj, scene, full, fixed_camera):
    """Compatibility wrapper for the historical one-object private seam."""
    facts = _procedural_facts(obj, scene)
    if facts is None:
        return None
    _sample_procedural_facts([facts], scene, full, fixed_camera)
    return _finalize_procedural(facts, scene, full, fixed_camera)


def _has_individual_animation(obj):
    animation = obj.animation_data
    return bool(animation and (animation.action or animation.drivers))


def _material_signature(obj):
    return tuple(slot.material.as_pointer() if slot.material else 0 for slot in obj.material_slots)


def _analyze_instances(scene, objects=None):
    groups = {}
    for obj in (scene.objects if objects is None else objects):
        if obj.type != "MESH" or obj.hide_render:
            continue
        groups.setdefault(obj.data.as_pointer(), []).append(obj)

    output = []
    for members in groups.values():
        if len(members) < 2:
            continue
        members = sorted(members, key=lambda item: item.name)
        ids = [
            obj.get("blendlink_id") if isinstance(obj.get("blendlink_id"), str) else obj.name
            for obj in members
        ]
        group_id = hashlib.sha256("\0".join(sorted(ids)).encode("utf-8")).hexdigest()[:16]
        parent_names = {obj.parent.name if obj.parent else None for obj in members}
        material_signatures = {_material_signature(obj) for obj in members}
        reasons = []
        if len(parent_names) != 1:
            reasons.append("members do not share one parent")
        if any(obj.children for obj in members):
            reasons.append("one or more members have children")
        if len(material_signatures) != 1:
            reasons.append("object-linked material assignments differ")
        if any(_has_individual_animation(obj) for obj in members):
            reasons.append("individual instance animation is not supported by EXT_mesh_gpu_instancing")
        if any(any(mod.type == "ARMATURE" for mod in obj.modifiers) for obj in members):
            reasons.append("skinned/deforming meshes cannot share one static instance matrix batch")
        if any(getattr(obj.data, "shape_keys", None) is not None for obj in members):
            reasons.append("per-object morph state is not supported by the portable instance batch")
        if any(obj.matrix_local.to_3x3().determinant() < 0 for obj in members):
            reasons.append("Three InstancedMesh does not support negatively scaled instance matrices")
        if any(any(mod.type == "NODES" and mod.show_render for mod in obj.modifiers) for obj in members):
            reasons.append("Geometry Nodes evaluation may make the shared source mesh diverge")
        if any(not isinstance(obj.get("blendlink_id"), str) for obj in members):
            reasons.append("one or more members need a stable blendlink_id")
        runtime_signatures = {
            (
                obj.get("blendlink_active", True),
                obj.get("blendlink_cast_shadow"),
                obj.get("blendlink_receive_shadow"),
                obj.get("blendlink_reflection_probe"),
            )
            for obj in members
        }
        if len(runtime_signatures) != 1:
            reasons.append("per-object visibility, shadow, or reflection intent differs")
        primitives = max(1, len(members[0].material_slots))
        if primitives > 1:
            reasons.append(
                "multi-material meshes export as multiple glTF primitives; the portable "
                "single-mesh instance adapter cannot preserve them yet"
            )
        separate = primitives * len(members)
        instanced = primitives
        output.append({
            "id": group_id,
            "meshData": members[0].data.name,
            "members": [
                {
                    "name": obj.name,
                    **({"id": obj.get("blendlink_id")}
                       if isinstance(obj.get("blendlink_id"), str) else {}),
                }
                for obj in members
            ],
            "count": len(members),
            "eligible": not reasons,
            "reasons": reasons,
            "drawCallsSeparate": separate,
            "drawCallsInstanced": instanced,
            "drawCallsSaved": separate - instanced,
            # The exporter keeps ordinary nodes by default: that preserves
            # stable per-object identity, animation, and frustum culling.
            "emission": "shared-data",
        })
    return output


def _original_material(material):
    if material is None:
        return None
    return getattr(material, "original", None) or material


def evaluated_material_uses(obj, depsgraph=None):
    """Resolve the face-owning material indices used by stock glTF export.

    Blendlink owns ``export_apply=True``.  Blender's exporter reads ordinary
    object slots directly when no modifier exists, and otherwise reads the
    evaluated Mesh produced by ``to_mesh``.  Because Blendlink also owns
    ``export_skins=True``, every ARMATURE modifier is temporarily disabled
    before evaluation and its exact ``show_viewport`` value is restored after
    the temporary Mesh is cleared.  An evaluated table containing exactly one
    ``None`` entry falls back to source object slots, matching the exporter's
    narrow sentinel behavior.  Mirroring those details avoids both needless
    Mesh allocation for the common case and a false promise that an attached
    slot with no primitive faces is render-used.

    The returned tuple retains evaluated-only assignments.  Callers that only
    inspect material fidelity can report those materials directly; callers
    that install a private source binding must require ``source_slot_index``.

    Geometry Nodes instance vnodes are gathered through a separate stock
    exporter path and are deliberately not inferred from this ordinary
    evaluated-Mesh helper.
    """
    if getattr(obj, "type", None) != "MESH":
        raise EvaluatedMaterialUseError(
            f'Cannot resolve render-used materials for "{getattr(obj, "name", "(unnamed)")}" '
            f"because it is {getattr(obj, 'type', None)!r}, not a Mesh."
        )
    source_materials = tuple(
        _original_material(slot.material)
        for slot in getattr(obj, "material_slots", ())
    )
    evaluated = None
    mesh = None
    armature_states = []
    try:
        if len(getattr(obj, "modifiers", ())) == 0:
            polygons = tuple(getattr(obj.data, "polygons", ()))
            exported_materials = source_materials
        else:
            armature_states = [
                (modifier, modifier.show_viewport)
                for modifier in obj.modifiers
                if modifier.type == "ARMATURE"
            ]
            for modifier, _show_viewport in armature_states:
                modifier.show_viewport = False
            # Toggling an ARMATURE modifier invalidates a dependency-graph
            # supplied by analyze_scene. Acquire the current graph only after
            # stock-exporter-equivalent suppression.
            if armature_states:
                depsgraph = bpy.context.evaluated_depsgraph_get()
            else:
                depsgraph = depsgraph or bpy.context.evaluated_depsgraph_get()
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh(
                preserve_all_data_layers=True,
                depsgraph=depsgraph,
            )
            if mesh is None:
                raise EvaluatedMaterialUseError(
                    f'Evaluated Mesh for "{obj.name}" is unavailable.'
                )
            polygons = tuple(mesh.polygons)
            exported_materials = tuple(
                _original_material(material) for material in mesh.materials
            )
            if exported_materials == (None,):
                exported_materials = source_materials

        used_indices = sorted({
            int(polygon.material_index) for polygon in polygons
        })
        if any(index < 0 for index in used_indices):
            raise EvaluatedMaterialUseError(
                f'Evaluated Mesh for "{obj.name}" contains a negative material index.'
            )
        uses = []
        for evaluated_index in used_indices:
            material = (
                exported_materials[evaluated_index]
                if evaluated_index < len(exported_materials) else None
            )
            candidates = tuple(
                index for index, source_material in enumerate(source_materials)
                if material is not None and source_material == material
            )
            source_slot_index = (
                evaluated_index
                if evaluated_index < len(source_materials)
                and material is not None
                and source_materials[evaluated_index] == material
                else None
            )
            uses.append(EvaluatedMaterialUse(
                evaluated_index,
                material,
                source_slot_index,
                candidates,
            ))
        return tuple(uses)
    except EvaluatedMaterialUseError:
        raise
    except (
        AttributeError,
        ReferenceError,
        RuntimeError,
        TypeError,
        ValueError,
    ) as error:
        raise EvaluatedMaterialUseError(
            f'Cannot resolve render-used materials for "{obj.name}": {error}'
        ) from error
    finally:
        try:
            if mesh is not None and evaluated is not None:
                evaluated.to_mesh_clear()
        finally:
            for modifier, show_viewport in armature_states:
                modifier.show_viewport = show_viewport


def analyze_scene(scene, full=False, fixed_camera=False, objects=None):
    """Return JSON-safe compiler diagnostics without modifying authored data.

    ``full=True`` exhaustively samples time-dependent Geometry Nodes up to the
    published audit cap.  The live addon samples only the current evaluated
    frame for responsive feedback; the exporter owns the exhaustive proof.
    """
    procedural = []
    procedural_facts = []
    materials = {}
    scoped_objects = tuple(scene.objects if objects is None else objects)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in scoped_objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        for use in evaluated_material_uses(obj, depsgraph):
            material = use.material
            if material is None:
                continue
            key = material.as_pointer()
            if key not in materials:
                materials[key] = {
                    **analyze_material(material),
                    "usedBy": [],
                }
            if obj.name not in materials[key]["usedBy"]:
                materials[key]["usedBy"].append(obj.name)
        facts = _procedural_facts(obj, scene)
        if facts is not None:
            procedural_facts.append(facts)
    if procedural_facts:
        _sample_procedural_facts(
            procedural_facts, scene, full, fixed_camera,
        )
        procedural = [
            _finalize_procedural(facts, scene, full, fixed_camera)
            for facts in procedural_facts
        ]
    return {
        "procedural": procedural,
        "instances": _analyze_instances(scene, scoped_objects),
        "materials": sorted(materials.values(), key=lambda item: item["material"].casefold()),
        "limits": {
            "maxAuditFrames": MAX_AUDIT_FRAMES,
            "maxAuditSnapshots": MAX_AUDIT_SNAPSHOTS,
            "maxMorphCacheBytes": MAX_MORPH_CACHE_BYTES,
        },
    }
