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
import contextlib
from dataclasses import dataclass
import hashlib
import struct

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

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

# Refusing a mesh whose only motion is a deformer glTF cannot carry needs its
# own modifier table. ``material_compiler._DEFORMING_MODIFIERS`` is NOT it:
# that set answers which modifiers a rest-basis UV-space channel bake is
# invariant to, so it holds SUBSURF/MASK and six data-only kinds that move no
# vertex, and omits DISPLACE/MULTIRES. Run through this refusal's scope gate on
# the ellie character it selects five unskinned publish-scoped meshes, two of
# which deviate by exactly 0.000000 m across all 331 frames -- a 40%
# false-refusal rate on a hard stop. This table asks the narrower question: can
# the modifier INTRODUCE motion that Blender's glTF exporter would freeze? Each
# value names the ID-valued inputs whose movement is the only way it can, so a
# deformer bound to a provably static input stays publishable.
#
# Deliberately absent, because the next reader will want to add them back:
# SUBSURF/MULTIRES/MASK refine or remove geometry and introduce no motion;
# VERTEX_WEIGHT_*/NORMAL_EDIT/DATA_TRANSFER/WEIGHTED_NORMAL edit data, not
# positions; CORRECTIVE_SMOOTH/SMOOTH/LAPLACIANSMOOTH amplify whatever is
# upstream and have no independent time source (measured at 1.6-2.4% of the
# bounding-box diagonal on ellie, which is the residual diagnostic's business,
# not a refusal's); ARMATURE is the absence this refusal is about; NODES is
# owned by ``_procedural_facts``.
_FROZEN_DEFORMER_INPUTS = {
    "CAST": ("object",),
    "CURVE": ("object",),
    "DISPLACE": ("texture_coords_object", "texture"),
    "HOOK": ("object",),
    # Parameters only: it can vary, never from an input it does not have.
    "LAPLACIANDEFORM": (),
    "LATTICE": ("object",),
    "MESH_DEFORM": ("object",),
    "SHRINKWRAP": ("target", "auxiliary_target"),
    "SIMPLE_DEFORM": ("origin",),
    "SURFACE_DEFORM": ("target",),
    "WARP": ("object_from", "object_to"),
    # Wave reads scene time directly, so it needs no moving input at all.
    "WAVE": (),
}

# Followed only to WALK toward a time source, never to classify a modifier, so
# a superset is safe: an attribute a modifier type does not have is simply
# absent. Sorted so the source named in the manifest is deterministic.
_DEFORMER_INPUT_ATTRIBUTES = (
    "auxiliary_target", "curve", "mirror_object", "object", "object_from",
    "object_to", "offset_object", "origin", "projector_object", "target",
    "texture", "texture_coords_object",
)

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
    """Find the socket matching another socket's IDENTIFIER, then name.

    Identifiers are unique per node interface; display names are not --
    Blender permits two group sockets both shown as "Shader". Matching by
    name first therefore returns whichever duplicate comes earlier, which
    is a silently wrong socket rather than an error. This ordering is the
    canonical one, stated in tsl_ir._matching_socket and shared by
    material_compiler._matching_socket; this copy used to match by name
    first and could disagree with the other two about the same graph.
    """
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


def _skinned_by_armature(obj):
    """The exporter's own skin test, not ours.

    ``io_scene_gltf2`` decides a node is skinned from
    ``modifiers["ARMATURE"].object is not None`` and never consults
    ``show_viewport`` -- it mutes the modifier itself before evaluating. A
    viewport-disabled Armature modifier therefore still produces a glTF skin
    and must count as skinned here, or we would refuse a mesh whose motion
    actually ships as joints.
    """
    return any(
        modifier.type == "ARMATURE" and modifier.object is not None
        for modifier in getattr(obj, "modifiers", ())
    )


def _driven_data_paths(obj):
    """Driver data paths on one Object, for modifier liveness and variation."""
    animation = getattr(obj, "animation_data", None)
    if animation is None:
        return ()
    return tuple(
        str(getattr(curve, "data_path", "") or "")
        for curve in getattr(animation, "drivers", ())
    )


def _keyframed_modifier_parameter(obj, modifier):
    """Name keyframed motion on this modifier's own parameters, if any.

    Channel presence is not the test. Rigs key constant-valued switch channels
    -- 23 of them measured on ellie, one distinct value across 4-12 keyframes
    -- so a keyed channel counts only when its keyed values differ. An F-Curve
    modifier (Noise/Cycles) varies by construction whatever the keys say.
    """
    prefix = f'modifiers["{modifier.name}"]'
    animation = getattr(obj, "animation_data", None)
    if animation is None:
        return None
    sources = []
    action = getattr(animation, "action", None)
    if action is not None:
        sources.append((action, getattr(animation, "action_slot", None)))
    for strip in _effective_nla_strips(animation):
        strip_action = getattr(strip, "action", None)
        if strip_action is not None:
            sources.append((strip_action, getattr(strip, "action_slot", None)))
    for candidate, slot in sources:
        curves, inspectable = _action_fcurves(candidate, slot)
        if not inspectable:
            # A non-empty Action in a representation this build cannot read
            # must not be blessed as constant.
            return (
                f"Action {candidate.name!r}, which this Blender build cannot "
                "inspect"
            )
        for curve in curves:
            path = str(getattr(curve, "data_path", "") or "")
            if not path.startswith(prefix):
                continue
            if any(not getattr(item, "mute", False)
                   for item in getattr(curve, "modifiers", ())):
                return f"an F-Curve modifier on {path}"
            keyed = {
                round(float(point.co[1]), 6)
                for point in getattr(curve, "keyframe_points", ())
            }
            if len(keyed) > 1:
                return f"keyframes on {path}"
    return None


def _deformer_motion_source(value, seen=None):
    """Name the authored time source that can move a deformer's input.

    Returns ``(id_name, kind)`` or ``None``. ``_animation_sources`` answers a
    similar question for Geometry Nodes object inputs but stops at parents and
    constraints, and every frozen-deformer target on the ellie character fails
    that walk: the teeth SurfaceDeform cages and the fannypack lattices carry
    no ``animation_data`` at all and move only because an ARMATURE/HOOK
    modifier binds them to the rig. Following modifier inputs too is therefore
    not an optimisation -- without it this refusal exempts exactly the objects
    it exists to catch. Kept as a sibling rather than folded into
    ``_animation_sources`` because widening that function would change which
    Geometry Nodes records enter the exhaustive finite-frame audit, a separate
    proven contract. ``_time_dependent_id`` is called with a fresh cycle guard
    on purpose: this function's ``seen`` tracks the object graph, and passing
    it down would make every ID report itself already visited.
    """
    if value is None:
        return None
    seen = seen if seen is not None else set()
    try:
        pointer = value.as_pointer()
    except (AttributeError, ReferenceError):
        return None
    if pointer in seen:
        return None
    seen.add(pointer)
    if _time_dependent_id(value):
        return value.name, "animation"
    data = getattr(value, "data", None)
    if data is not None:
        if _time_dependent_id(data):
            return data.name, "geometry"
        shape_keys = getattr(data, "shape_keys", None)
        if shape_keys is not None and _time_dependent_id(shape_keys):
            return shape_keys.name, "shapeKeys"
    # Bone parenting arrives here as an ordinary parent whose own action is the
    # time source, so it needs no separate case.
    source = _deformer_motion_source(getattr(value, "parent", None), seen)
    if source is not None:
        return source
    for constraint in getattr(value, "constraints", ()):
        source = _deformer_motion_source(
            getattr(constraint, "target", None), seen,
        )
        if source is not None:
            return source
    for modifier in getattr(value, "modifiers", ()):
        for attribute in _DEFORMER_INPUT_ATTRIBUTES:
            source = _deformer_motion_source(
                getattr(modifier, attribute, None), seen,
            )
            if source is not None:
                return source
    return None


def _frozen_deformer_evidence(obj, modifier, inputs):
    """Why this one modifier's frozen contribution provably moves, or None."""
    if modifier.type == "WAVE":
        return {
            "name": modifier.name, "type": modifier.type,
            "timeSource": "the scene timeline",
        }
    for attribute in inputs:
        value = getattr(modifier, attribute, None)
        if value is None:
            continue
        source = _deformer_motion_source(value)
        if source is not None:
            name, kind = source
            return {
                "name": modifier.name, "type": modifier.type,
                "input": attribute,
                "inputId": getattr(value, "name", str(value)),
                "timeSource": name, "timeSourceKind": kind,
            }
    parameter = _keyframed_modifier_parameter(obj, modifier)
    if parameter is not None:
        return {
            "name": modifier.name, "type": modifier.type,
            "timeSource": parameter,
        }
    prefix = f'modifiers["{modifier.name}"]'
    for path in _driven_data_paths(obj):
        if path.startswith(prefix):
            return {
                "name": modifier.name, "type": modifier.type,
                "timeSource": f"a driver on {path}",
            }
    return None


def _frozen_deformer_reason(moving):
    """One artist-facing refusal naming the object's deformers and the remedy."""
    clauses = []
    for entry in moving:
        label = (
            f"{entry['type'].lower().replace('_', ' ')} modifier "
            f"{entry['name']!r}"
        )
        if "inputId" not in entry:
            clauses.append(f"{label} varies with {entry['timeSource']}")
        elif entry["timeSource"] == entry["inputId"]:
            clauses.append(
                f"{label} follows {entry['inputId']!r}, which is animated"
            )
        else:
            clauses.append(
                f"{label} follows {entry['inputId']!r}, which the timeline "
                f"moves through {entry['timeSource']!r}"
            )
    names = ", ".join(f"{entry['name']!r}" for entry in moving)
    return (
        f"{'; '.join(clauses)}. This mesh has no Armature modifier, and "
        "Blender's glTF exporter mutes only ARMATURE modifiers before it "
        "evaluates the depsgraph, so every other deformer freezes at the "
        "single export frame: the published mesh holds one shape forever while "
        "the object driving it keeps moving. Skin this mesh to the same "
        "armature -- add an Armature modifier, or parent it to a bone with "
        "automatic weights -- so the deformation ships as glTF joint "
        f"animation; or accept it as static by applying or removing {names}, "
        "so Blender and the website agree."
    )


def _frozen_deformer_issue(obj, frame_range):
    """One JSON-safe refusal record for this mesh, or None.

    One record per object, not per modifier: the remedy is per-object, and
    telling the artist to skin the same mesh five times is noise. Every
    implicated modifier is listed inside the record.
    """
    if obj.type != "MESH" or obj.hide_render:
        return None
    mesh = getattr(obj, "data", None)
    if mesh is None or len(getattr(mesh, "polygons", ())) == 0:
        return None
    if _skinned_by_armature(obj):
        return None
    driven_paths = _driven_data_paths(obj)
    moving = []
    for modifier in getattr(obj, "modifiers", ()):
        inputs = _FROZEN_DEFORMER_INPUTS.get(modifier.type)
        if inputs is None:
            continue
        # show_viewport, not show_render: the exporter evaluates the VIEWPORT
        # depsgraph. A DRIVEN flag still counts as live -- ellie's fannypack
        # zippers drive three SurfaceDeform show_viewport flags, so one frame's
        # read under-reports the stack the exporter will apply.
        driven_visibility = (
            f'modifiers["{modifier.name}"].show_viewport' in driven_paths
        )
        if not modifier.show_viewport and not driven_visibility:
            continue
        evidence = _frozen_deformer_evidence(obj, modifier, inputs)
        if evidence is None:
            continue
        evidence["showViewport"] = bool(modifier.show_viewport)
        evidence["drivenVisibility"] = driven_visibility
        moving.append(evidence)
    if not moving:
        return None
    identity = obj.get("blendlink_id")
    return {
        "code": "geometry.frozen-deformer-no-armature",
        "object": obj.name,
        **({"objectId": identity}
           if isinstance(identity, str) and identity else {}),
        "modifiers": moving,
        "frameRange": list(frame_range),
        "reason": _frozen_deformer_reason(moving),
    }


def frozen_deformer_issues(scene, objects=None):
    """Meshes that publish one frozen pose of a deformer that keeps moving.

    Blender's glTF exporter mutes ARMATURE modifiers and nothing else before it
    evaluates the mesh. A mesh with no Armature modifier and a deformer whose
    input provably moves therefore ships a single snapshot while Blender keeps
    animating -- silently, and with no glTF channel that could carry the
    difference.

    Zero depsgraph evaluation and zero frame stepping, by construction: this
    decides only that the frozen contribution provably varies, never by how
    much. Measured on the ellie character it names the two teeth meshes, which
    ship 143.5% and 144.9% of their bounding-box diagonal out of position, and
    the fannypack zippers at 72.3%, with no false positives over 41
    render-visible meshes.
    """
    if scene.frame_start == scene.frame_end:
        # A single-frame scene has nothing to freeze; the exported snapshot is
        # the whole authored result. This is only an outer sanity gate -- the
        # reachability walk above is what actually discriminates.
        return []
    frame_range = (scene.frame_start, scene.frame_end)
    issues = (
        _frozen_deformer_issue(obj, frame_range)
        for obj in (tuple(scene.objects) if objects is None else tuple(objects))
    )
    # Sorted because these records reach the content-hashed manifest.
    return sorted(
        (issue for issue in issues if issue is not None),
        key=lambda item: item["object"].casefold(),
    )


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


# ---------------------------------------------------------------------------
# Phase 0c / 0d: name the two silent losses in Blendlink's applied-modifier
# export contract — shape keys that never reach the glb, and ARMATURE options
# glTF cannot carry.  Both are reports, not refusals, except for the one case
# that is provably wrong: a dropped key whose value actually animates.
# ---------------------------------------------------------------------------

# io_scene_gltf2/blender/exp/export.py:28-29 calls ``frame_set(0)`` unless
# ``gltf_current_frame`` is set, and Blendlink never sets it
# (packages/blendlink/blender/export_scene.py:5125-5160 pins export_apply,
# export_skins and export_morph and nothing else).  Frame 0 is therefore the
# frame whose evaluated state freezes into the shipped mesh, and on a scene
# whose range starts at 1 it cannot be inferred from that range.
_EXPORTER_FROZEN_FRAME = 0

# Warn line for a shipped-vs-evaluated displacement, as a fraction of the
# object's bounding-box diagonal.  Deliberately the same 1% the frozen-modifier
# residual uses, so the two diagnostics cannot disagree about "small".
_DISPLACEMENT_WARN_FRACTION = 0.01

# Modifier types whose evaluated output can change the vertex container.
# ``to_mesh`` keeps ``mesh->key`` only when no *enabled* modifier changes that
# container, so this table only narrows the leave-one-out attribution below; it
# never decides the drop itself, which is always read off the evaluated mesh.
# This is deliberately not material_compiler._DEFORMING_MODIFIERS: that set's
# own comment says it names the modifiers a rest-basis UV bake is invariant to,
# which is a different question and would both miss ARRAY/BOOLEAN and include
# motion-free deformers.  Measured on ellie: GEO-ellie_jacket.001 loses four
# key blocks through the one MASK of its three that is enabled, which removes
# 801 vertices (5186 -> 4385), while GEO-ellie_eyelashes.001 loses two through
# a stack no single member of which is responsible (72 -> 564).  Listing a type
# here is therefore never the decision.
_VERTEX_CONTAINER_MODIFIERS = frozenset({
    "ARRAY", "BEVEL", "BOOLEAN", "BUILD", "DECIMATE", "EDGE_SPLIT",
    "EXPLODE", "MASK", "MESH_SEQUENCE_CACHE", "MIRROR", "MULTIRES", "NODES",
    "OCEAN", "PARTICLE_INSTANCE", "REMESH", "SCREW", "SKIN", "SOLIDIFY",
    "SUBSURF", "TRIANGULATE", "VOLUME_TO_MESH", "WELD", "WIREFRAME",
})


def _rounded(value):
    """Keep committed generated manifests free of float-noise churn."""
    return None if value is None else round(float(value), 7)


def _percent(value, diagonal):
    """One place that turns metres into a fraction of a bounding box."""
    if not diagonal:
        return "an unmeasurable fraction"
    return f"{value / diagonal * 100.0:.2f}%"


def _skip_shape_key(key_blocks, key):
    """Port of io_scene_gltf2 ``blender/com/data_path.py:69-76`` (``skip_sk``).

    The exporter drops the Basis, muted keys, and any key relative to itself.
    Ported rather than imported: the addon must report the same decision in a
    Blender where io_scene_gltf2 is not enabled.
    """
    return (
        key == key.relative_key
        or bool(key.mute)
        or key_blocks[0].name == key.name
    )


def _exported_shape_keys(shape_keys):
    """The key blocks io_scene_gltf2 would export (``get_sk_exported``)."""
    if shape_keys is None:
        return ()
    key_blocks = shape_keys.key_blocks
    return tuple(
        key for key in key_blocks if not _skip_shape_key(key_blocks, key)
    )


@contextlib.contextmanager
def _applied_mesh(obj):
    """Yield the Mesh io_scene_gltf2 would export for ``obj``, or ``None``.

    Follows ``blender/exp/nodes.py:294-330``.  Under Blendlink's pinned
    ``export_apply=True``/``export_skins=True``
    (packages/blendlink/blender/export_scene.py:5125-5126) the exporter exports
    the source Mesh datablock when the object carries no modifier, and
    otherwise mutes only *this* object's ARMATURE modifiers, takes
    ``bpy.context.evaluated_depsgraph_get()`` and calls
    ``to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)`` — the same
    sequence ``evaluated_material_uses`` above already relies on.

    Per-object muting is load-bearing, not an optimisation to undo: batching
    every candidate's ARMATURE into one depsgraph rebuild would change the
    evaluated result of a mesh whose SURFACE_DEFORM target is itself skinned.
    """
    if len(obj.modifiers) == 0:
        # nodes.py:294-296 — with no modifier the exporter exports the source
        # Mesh datablock itself, so every key block survives.
        yield obj.data
        return
    armature_states = [
        (modifier, modifier.show_viewport)
        for modifier in obj.modifiers
        if modifier.type == "ARMATURE"
    ]
    evaluated = None
    mesh = None
    try:
        for modifier, _show_viewport in armature_states:
            modifier.show_viewport = False
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh(
            preserve_all_data_layers=True, depsgraph=depsgraph,
        )
        yield mesh
    finally:
        try:
            if mesh is not None and evaluated is not None:
                evaluated.to_mesh_clear()
        finally:
            for modifier, show_viewport in armature_states:
                modifier.show_viewport = show_viewport


def _bbox_diagonal(obj):
    """World-space bounding-box diagonal: what every percentage divides by.

    Read from ``obj.bound_box``, which tracks the current evaluated pose, so a
    percentage carries the animated pose's drift across a range while the metre
    figures do not.
    """
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return max(
        (first - second).length
        for index, first in enumerate(corners)
        for second in corners[index + 1:]
    ) if len(corners) > 1 else 0.0


def _basis_displacement(obj, mesh, exported):
    """Metres between what the glb ships and the evaluated mesh.

    ``primitive_extract.py:1112-1116`` (``__get_positions``) sources POSITION from
    ``self.key_blocks[0].relative_key.points`` — the Basis cage — whenever any
    key block survives, and never from the evaluated positions.  A frozen
    closed-form deformer's contribution is therefore *absent* from the glb for
    these meshes rather than frozen into it.  Only the 3x3 of ``matrix_world``
    is applied because a shared translation cancels in the difference.
    """
    points = exported[0].relative_key.points
    if len(points) != len(mesh.vertices):
        return None
    matrix = obj.matrix_world.to_3x3()
    worst = 0.0
    for vertex, point in zip(mesh.vertices, points):
        worst = max(worst, (matrix @ (vertex.co - point.co)).length)
    return worst


def _key_displacement(obj, key):
    """Metres this key block moves at value 1.0, before the modifier stack.

    Shape-key blending is linear in the key value, so the motion a dropped key
    loses across a value range is exactly this figure times that range — before
    the stack, which can amplify or attenuate it.
    """
    relative = key.relative_key
    matrix = obj.matrix_world.to_3x3()
    worst = 0.0
    for point, base in zip(key.points, relative.points):
        worst = max(worst, (matrix @ (point.co - base.co)).length)
    return worst


def _shape_key_restoring_modifiers(obj):
    """Name every enabled modifier whose absence alone restores the key blocks.

    Causal isolation, not an inference from the modifier type: on ellie,
    disabling GEO-ellie_jacket.001's one enabled MASK restores its key blocks,
    while GEO-ellie_eyelashes.001 keeps zero key blocks with each of its
    container-changing modifiers switched off in turn, so its list is correctly
    empty and the message must say so.  Only container-changing types are
    probed, and only for an object that already lost its keys, so the cost is a
    handful of extra evaluations.  ``show_viewport`` is restored to its literal
    authored value; a driver on that property re-asserts itself on the next
    depsgraph update, exactly as ``evaluated_material_uses`` already relies on.
    """
    restoring = []
    for modifier in obj.modifiers:
        if modifier.type not in _VERTEX_CONTAINER_MODIFIERS:
            continue
        if not modifier.show_viewport:
            continue
        show_viewport = modifier.show_viewport
        modifier.show_viewport = False
        try:
            with _applied_mesh(obj) as mesh:
                if mesh is not None and _exported_shape_keys(
                        getattr(mesh, "shape_keys", None)):
                    restoring.append(modifier.name)
        finally:
            modifier.show_viewport = show_viewport
    return tuple(restoring)


def _shape_key_facts(obj):
    """Decide, with no timeline traversal, what the glb does with ``obj``'s keys.

    Blender's own property description is unconditional — io_scene_gltf2
    ``__init__.py:679-684``, ``export_apply``: "Apply modifiers (excluding
    Armatures) to mesh objects - WARNING: prevents exporting shape keys" — but
    the code is not.  ``primitive_extract.py:151-158`` still admits an
    exporter-applied mesh (its own comment hedges at line 154), and what
    actually decides the outcome is whether ``to_mesh`` kept ``mesh->key``.
    Measured on ellie: 7 of 9 render-visible shape-keyed meshes ship real morph
    targets; only GEO-ellie_jacket.001 and GEO-ellie_eyelashes.001 lose theirs.
    A blanket refusal here would refuse a working export.
    """
    shape_keys = getattr(obj.data, "shape_keys", None)
    if shape_keys is None:
        return None
    authored = _exported_shape_keys(shape_keys)
    with _applied_mesh(obj) as mesh:
        if mesh is None:
            # An evaluated Mesh is unavailable (a Geometry Nodes graph emitted
            # a non-mesh, for example). Say nothing rather than guess.
            return None
        exported = _exported_shape_keys(getattr(mesh, "shape_keys", None))
        exported_names = {key.name for key in exported}
        applied_vertices = len(mesh.vertices)
        basis_key = exported[0].relative_key.name if exported else None
        basis_displacement = (
            _basis_displacement(obj, mesh, exported) if exported else None
        )
    authored_names = {key.name for key in authored}
    frozen_names = sorted(authored_names - exported_names)
    # A Key datablock with no reachable time source cannot change by frame, so
    # its constancy is proven without evaluating anything.  The converse is not
    # true and must not be assumed: GEO-ellie_jacket.001's Key *does* have a
    # reachable time source, yet all four of its dropped keys hold one value
    # across frames 0 and 1..330.  A channel existing proves nothing; only the
    # evaluated value can be trusted.
    time_dependent = bool(frozen_names) and _time_dependent_id(shape_keys)
    keys = []
    for index, key in enumerate(shape_keys.key_blocks):
        if key.name in exported_names:
            transport = "morphTarget"
        elif key.name in authored_names:
            transport = "frozen"
        else:
            # The Basis, a muted key, or a key relative to itself: skip_sk
            # drops it and Blender contributes nothing from it either.
            transport = "skipped"
        keys.append({
            "index": index,
            "name": key.name,
            "transport": transport,
            "muted": bool(key.mute),
            "value": _rounded(key.value),
            "frozenValue": _rounded(key.value),
            "maxDelta": _rounded(_key_displacement(obj, key)),
            # A dropped key on a Key ID with no reachable time source is
            # already proven constant here; every other reading waits for the
            # evaluated sample below rather than guessing.
            "animation": (
                "constant"
                if transport == "frozen" and not time_dependent
                else "notSampled"
            ),
            "values": [],
        })
    return {
        "object_ref": obj,
        "shape_keys_ref": shape_keys,
        "position_source": "basis" if exported else "evaluated",
        "basis_key": basis_key,
        "basis_displacement": basis_displacement,
        "source_vertices": len(obj.data.vertices),
        "applied_vertices": applied_vertices,
        "bbox_diagonal": _bbox_diagonal(obj),
        "container_modifiers": tuple(
            modifier.name for modifier in obj.modifiers
            if modifier.type in _VERTEX_CONTAINER_MODIFIERS
            and modifier.show_viewport
        ),
        "restored_by": (
            _shape_key_restoring_modifiers(obj)
            if authored and not exported else None
        ),
        "keys": keys,
        "frozen_names": frozen_names,
        "sampled_keys": [
            item for item in keys if item["transport"] == "frozen"
        ] if time_dependent else [],
        "value_proof": (
            "notRequired" if not frozen_names
            else ("static" if not time_dependent else "unproven")
        ),
        "frozen_at_frame": _EXPORTER_FROZEN_FRAME,
    }


def _sample_shape_key_values(scene, facts, full):
    """Prove whether a dropped key's value varies, by evaluating it per frame.

    Channel presence is not the predicate: GEO-ellie_jacket.001's Key ID has a
    reachable time source and every one of its four dropped keys still measures
    one value over frames 0 and 1..330, so "an F-Curve exists" would refuse a
    working export.  Curve inspection is not the predicate either:
    Blender 5.2 stores slotted-action curves behind channelbags, and a driven
    value is not on a curve at all.  The only honest reading is the evaluated
    one, ``shape_keys.evaluated_get(depsgraph).key_blocks[i].value``.

    Frame 0 is visited deliberately — it is the frame io_scene_gltf2 freezes
    (``blender/exp/export.py:28-29``) and it lies outside a range that starts
    at 1.
    """
    candidates = [item for item in facts if item["sampled_keys"]]
    if not candidates:
        return
    original_frame = scene.frame_current
    start, end = scene.frame_start, scene.frame_end
    frame_count = end - start + 1
    required_snapshots = frame_count * len(candidates)
    if not full:
        # The live addon never moves the timeline. One frame cannot bless a
        # value as constant, so the record stays unproven and cannot refuse.
        frames, proof = (original_frame,), "currentFrame"
    elif required_snapshots <= MAX_AUDIT_SNAPSHOTS:
        frames = tuple(sorted({
            _EXPORTER_FROZEN_FRAME, *range(start, end + 1),
        }))
        proof = "exhaustive"
    else:
        # Witnesses can prove variation but never constancy — the same
        # asymmetry the procedural audit relies on, pointing the other way, so
        # an over-budget scene warns instead of blessing or refusing.
        frames = tuple(sorted({
            _EXPORTER_FROZEN_FRAME, start, original_frame, end,
        }))
        proof = "sampled"
    try:
        for frame in frames:
            _set_audit_frame(scene, frame)
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for item in candidates:
                blocks = item["shape_keys_ref"].evaluated_get(
                    depsgraph,
                ).key_blocks
                for sample in item["sampled_keys"]:
                    sample["values"].append(
                        (int(frame), float(blocks[sample["index"]].value)),
                    )
    finally:
        _set_audit_frame(scene, original_frame)
    for item in candidates:
        item["value_proof"] = proof
        item["frozen_at_frame"] = (
            _EXPORTER_FROZEN_FRAME if full else original_frame
        )
        item["audit_required_snapshots"] = required_snapshots
        for sample in item["sampled_keys"]:
            values = [value for _frame, value in sample["values"]]
            sample["frozenValue"] = _rounded(next(
                (
                    value for frame, value in sample["values"]
                    if frame == item["frozen_at_frame"]
                ),
                values[0],
            ))
            sample["valueRange"] = [
                _rounded(min(values)), _rounded(max(values)),
            ]
            if len(set(values)) > 1:
                sample["animation"] = "varying"
                sample["lostDisplacement"] = _rounded(
                    sample["maxDelta"] * (max(values) - min(values)),
                )
            elif proof == "exhaustive":
                sample["animation"] = "constant"
            else:
                sample["animation"] = "unproven"


def _restored_clause(facts):
    restored = facts["restored_by"] or ()
    if len(restored) == 1:
        return f'disabling modifier "{restored[0]}" restores them'
    if restored:
        names = ", ".join(f'"{name}"' for name in restored)
        return f"disabling any one of {names} restores them"
    return (
        "no single modifier restores them — the whole applied stack changes "
        "the container"
    )


def _finalize_shape_keys(facts, scene):
    """Turn one object's shape-key facts into the artist-facing record.

    Only one of the three findings refuses, and only on measured variation: a
    dropped key whose evaluated value actually animates is nowhere in the glb.
    A dropped key with a constant value — zero or not — is already baked into
    the exported positions by ``to_mesh``, so it warns; refusing it would
    refuse a correct export, which is what ellie's jacket and eyelashes are.
    A Basis-sourced POSITION warns and hands the frozen-modifier residual the
    baseline selector it needs; that diagnostic owns the >10% refusal, and two
    refusals for one defect would be two messages for one fix.
    """
    obj = facts["object_ref"]
    diagonal = facts["bbox_diagonal"]
    keys = facts["keys"]
    frozen = [item for item in keys if item["transport"] == "frozen"]
    exported = [item for item in keys if item["transport"] == "morphTarget"]
    varying = [item for item in frozen if item["animation"] == "varying"]
    displacement = facts["basis_displacement"]
    if varying:
        worst = max(varying, key=lambda item: item["lostDisplacement"])
        low, high = worst["valueRange"]
        severity = "refuse"
        message = (
            f'{obj.name}: shape key "{worst["name"]}" animates between '
            f"{low:.3f} and {high:.3f} but cannot reach the glb. Blendlink "
            f"publishes with Apply Modifiers on, and this object's evaluated "
            f"mesh changes the vertex container "
            f"({facts['source_vertices']} -> {facts['applied_vertices']} "
            f"vertices), so Blender keeps no key block at all "
            f"({_restored_clause(facts)}). The website ships the shape frozen "
            f"at the exporter's frame {facts['frozen_at_frame']} value "
            f"{worst['frozenValue']:.3f}, silently dropping up to "
            f"{worst['lostDisplacement'] * 1000.0:.1f} mm of authored motion "
            f"({_percent(worst['lostDisplacement'], diagonal)} of this "
            f"object's {diagonal:.4f} m bounding-box diagonal). Disable or "
            f"apply the modifier that changes the vertex count, re-author the "
            f"motion as bone animation, or delete the key."
        )
    elif frozen:
        names = ", ".join(f'"{item["name"]}"' for item in frozen)
        proven = facts["value_proof"] in {"static", "exhaustive"}
        severity = "warn"
        message = (
            f"{obj.name}: {len(frozen)} shape key(s) will not reach the glb "
            f"({names}). Apply Modifiers is on and this object's evaluated "
            f"mesh changes the vertex container "
            f"({facts['source_vertices']} -> {facts['applied_vertices']} "
            f"vertices), so Blender keeps no key block "
            f"({_restored_clause(facts)}). "
            + (
                f"Every dropped key holds one value over frames "
                f"{scene.frame_start}..{scene.frame_end}, and a constant "
                f"blend is already baked into the exported positions, so "
                f"nothing shipped is wrong — the website simply cannot drive "
                f"these keys at runtime."
                if proven else
                "Their values were read at one frame only, so constancy is "
                "unproven here; the publish audit measures every frame and "
                "refuses if any of them animates."
            )
        )
    elif (
        displacement is not None
        and diagonal > 0.0
        and displacement > diagonal * _DISPLACEMENT_WARN_FRACTION
    ):
        severity = "warn"
        message = (
            f"{obj.name}: its shape keys ship as glTF morph targets, so the "
            f'exporter sources POSITION from the "{facts["basis_key"]}" cage '
            f"(primitive_extract.py:1112-1116) instead of the evaluated mesh. "
            f"This object's evaluated stack moves it "
            f"{displacement * 1000.0:.1f} mm "
            f"({_percent(displacement, diagonal)} of its {diagonal:.4f} m "
            f"bounding-box diagonal) away from that cage, and none of that "
            f"deformation is in the glb — it is absent, not frozen. Lower the "
            f"deformer to skinning, remove the shape keys, or accept the "
            f"rest-cage export."
        )
    else:
        severity = "info"
        message = (
            f"{obj.name}: {len(exported)} shape key(s) reach the glb as morph "
            f'targets and the exported positions match the '
            f'"{facts["basis_key"]}" cage to '
            f"{(displacement or 0.0) * 1000.0:.3f} mm."
            if facts["position_source"] == "basis" else
            f"{obj.name}: no shape key block reaches the glb and none is "
            f"lost — every key is muted or relative to itself."
        )
    return {
        "object": obj.name,
        **({"objectId": obj.get("blendlink_id")}
           if isinstance(obj.get("blendlink_id"), str) else {}),
        "positionSource": facts["position_source"],
        **({"basisKey": facts["basis_key"]} if facts["basis_key"] else {}),
        "sourceVertices": facts["source_vertices"],
        "appliedVertices": facts["applied_vertices"],
        "bboxDiagonal": _rounded(diagonal),
        **({"basisDisplacement": _rounded(displacement)}
           if displacement is not None else {}),
        "containerModifiers": list(facts["container_modifiers"]),
        **({"restoredBy": list(facts["restored_by"])}
           if facts["restored_by"] is not None else {}),
        "keys": [
            {
                "name": item["name"],
                "transport": item["transport"],
                "muted": item["muted"],
                "value": item["value"],
                "maxDelta": item["maxDelta"],
                "animation": item["animation"],
                **({"frozenValue": item["frozenValue"]}
                   if item["transport"] == "frozen" else {}),
                **({"valueRange": item["valueRange"]}
                   if "valueRange" in item else {}),
                **({"lostDisplacement": item["lostDisplacement"]}
                   if "lostDisplacement" in item else {}),
            }
            for item in keys
        ],
        "valueProof": facts["value_proof"],
        "frameRange": [scene.frame_start, scene.frame_end],
        "frozenAtFrame": facts["frozen_at_frame"],
        "severity": severity,
        "message": message,
    }


def _skin_approximation_record(obj):
    """Name the ARMATURE options the glb cannot carry.  No evaluation at all.

    glTF skinning is linear blend skinning only: neither the format nor three's
    skinning node has a dual-quaternion mode, and envelope falloff has no
    exported form because ``primitive_extract.py:1557`` derives
    JOINTS_0/WEIGHTS_0 from vertex groups alone.  Both flags are therefore lost
    silently — the export succeeds and the deformation is merely different.

    Measured on ellie, max |C(DQS on) - C(DQS off)| over frames 1..330 of the
    full authored stack in world space, divided by this module's own
    ``_bbox_diagonal``: GEO-ellie_jacket.001 6.255 mm = 1.62% at frame 196,
    GEO-ellie_body.001 7.060 mm = 0.91% at frame 48, GEO-ellie_boots.001
    0.214 mm = 0.044%, GEO-ellie_eyebrows.001 0.002 mm = 0.0009% — 4 of its 36
    render-visible ARMATURE modifiers.  ``use_bone_envelopes`` is False on
    every one of them, so that half of this record ships without a real-scene
    witness and needs the synthetic test.  Only the jacket crosses the 1% warn
    line and none approaches the 10% refusal line, which is why this warns: the
    only artist action is to clear the flag and re-weight, and refusing would
    refuse every volume-preserving rig that ships acceptably today.  The
    percentages are denominator-sensitive and the metres are not; an earlier
    probe divided by a rest-pose diagonal and read 1.627% / 1.083% for the same
    two millimetre figures.

    The magnitude is deliberately not measured here.  It costs two evaluated
    meshes per frame per object — exactly the harness the frozen-modifier
    residual builds — so this record names the object and the modifier instead,
    so that measurement can subtract the DQS term rather than report it as
    noise.
    """
    armatures = [
        modifier for modifier in obj.modifiers if modifier.type == "ARMATURE"
    ]
    if not armatures:
        return None
    if not any(
        modifier.use_deform_preserve_volume or modifier.use_bone_envelopes
        for modifier in armatures
    ):
        return None
    # tree.py:247-248 builds ``{m.type: m for m in modifiers}`` and then tests
    # ``modifiers["ARMATURE"].object is not None``, so only the LAST ARMATURE
    # modifier can produce a skin, and ``show_viewport`` is never consulted
    # (nodes.py:308-311 mutes it regardless).  ``exporterSelected`` is carried
    # per modifier so a second ARMATURE the exporter's dict discards is visible
    # rather than implied.
    selected = armatures[-1]
    skinned = selected.object is not None
    preserve_volume = bool(selected.use_deform_preserve_volume)
    bone_envelopes = bool(selected.use_bone_envelopes)
    sentences = []
    if preserve_volume:
        sentences.append(
            f'{obj.name}: ARMATURE modifier "{selected.name}" has Preserve '
            f"Volume enabled. glTF skinning is linear blend skinning only — "
            f"neither the format nor three's SkinningNode has a "
            f"dual-quaternion mode — so the website ships the linearised "
            f"deformation. On Blendlink's reference character that "
            f"linearisation moves vertices up to 1.62% of the bounding-box "
            f"diagonal; this scene's magnitude is not measured here. Clear "
            f"Preserve Volume and re-weight if the website must match "
            f"Blender, or accept the linear result."
        )
    if bone_envelopes:
        sentences.append(
            f'{obj.name}: ARMATURE modifier "{selected.name}" has Bone '
            f"Envelopes enabled. The exporter derives JOINTS_0/WEIGHTS_0 from "
            f"vertex groups only (primitive_extract.py:1557), so envelope "
            f"falloff has no exported form and the website ships the "
            f"vertex-group weights alone. Bake the falloff into groups with "
            f"Weight from Bones (with envelopes), or clear Bone Envelopes."
        )
    if not sentences:
        sentences.append(
            f"{obj.name}: a Preserve Volume or Bone Envelopes ARMATURE "
            f"modifier is present, but the exporter's skin comes from "
            f'"{selected.name}", which sets neither, so nothing is '
            f"approximated."
        )
    return {
        "object": obj.name,
        **({"objectId": obj.get("blendlink_id")}
           if isinstance(obj.get("blendlink_id"), str) else {}),
        "skinned": skinned,
        **({"armature": selected.object.name} if skinned else {}),
        "exporterSelected": selected.name,
        "preserveVolume": preserve_volume,
        "boneEnvelopes": bone_envelopes,
        "modifiers": [
            {
                "name": modifier.name,
                "armature": (
                    modifier.object.name
                    if modifier.object is not None else None
                ),
                "preserveVolume": bool(modifier.use_deform_preserve_volume),
                "boneEnvelopes": bool(modifier.use_bone_envelopes),
                "vertexGroups": bool(modifier.use_vertex_groups),
                "showViewport": bool(modifier.show_viewport),
                "exporterSelected": modifier == selected,
            }
            for modifier in armatures
        ],
        "severity": (
            "warn" if skinned and (preserve_volume or bone_envelopes)
            else "info"
        ),
        "message": " ".join(sentences),
    }


# ---------------------------------------------------------------------------
# Phase 1: lower a SURFACE_DEFORM bind onto glTF skin weights.
#
# When a mesh is bound by SURFACE_DEFORM to a target that is itself LBS-skinned,
# "static bind composed with linear blend skinning" is linear blend skinning
# with derived weights, so the bound mesh can ship as an ordinary glTF skin
# instead of the static prop the Phase 0a refusal correctly rejects today.
#
# Two gates that measurement refuted, and are therefore NOT used here:
#
#  * "Verify the target's stack is pure LBS."  Neither necessary nor
#    sufficient.  Both ellie teeth cages carry a SHRINKWRAP and both lower to
#    under 1%; the cage whose SHRINKWRAP is provably inert (0.000 m across 330
#    frames) is the WORSE of the two.  A purity gate would refuse the good case
#    and wave the bad one through.  Worse, the identity is exact only when
#    every bind's support is weight-homogeneous, which holds on 0 of 84 and 0
#    of 10 cage polygons here -- so no predicate over modifier types can
#    certify exactness even for a perfectly pure cage.
#
#  * "Measure the residual and nothing else."  The fannypack zippers' two
#    rig-hooked LATTICEs structurally break the lowering and still contribute
#    0.0001% of the bounding-box diagonal across the whole assigned clip.
#    Measurement is per-assigned-action; structure is not -- the Phase 0f
#    hazard in a new place.
#
# So a structural predicate runs first (``deformer_lowering_plan``, no
# depsgraph evaluation at all, same shape as ``frozen_deformer_issues``) and an
# end-to-end measurement runs second (``verify_deformer_lowerings``).  Neither
# substitutes for the other, and a mesh that fails either one stays refused by
# the existing Phase 0a door.
#
# The measured oracle is deliberately the RUNTIME's arithmetic, not Blender's:
# the exported rest positions, the exported interpolated weights and linear
# blend skinning from the pose matrices, against the authored evaluated stack,
# in world space.  Re-evaluating the lowered stack in Blender instead would
# hide the subdivide-then-skin / skin-then-subdivide difference a post-bind
# SUBSURF introduces, because Blender computes it the other way round.
# ---------------------------------------------------------------------------

_LOWERING_ARMATURE_MODIFIER = "BLENDLINK_LOWERED_ARMATURE"

# The 10% line the frozen-modifier residual already refuses at.  The 1% warn
# line is ``_DISPLACEMENT_WARN_FRACTION`` above, shared on purpose so the three
# geometry diagnostics cannot disagree about "small".
_LOWERING_REFUSE_FRACTION = 0.10

# ``primitive_extract.py:1587`` computes ``num_joint_sets = (max + 3) // 4``
# with no cap, so a fifth influence emits a JOINTS_1/WEIGHTS_1 pair that
# three's GLTFLoader never binds -- the weight is dropped at runtime and the
# residual measured here would be a lie.  Refuse instead.
_LOWERING_MAX_INFLUENCES = 4
_LOWERING_WEIGHT_EPSILON = 1e-6

# Frame samples per measured object.  Ellie's 330-frame range fits
# exhaustively.  Beyond the cap the sweep strides and says so in the record: a
# strided measurement must never be readable as an exhaustive one.  Measured on
# ellie a stride of 5 reproduced the every-frame maximum to six decimals, but
# that flatness is a property of a smooth pose-driven residual, not a promise.
_LOWERING_MAX_SAMPLED_FRAMES = 600

# Modifiers allowed on the BOUND mesh after the bind.  Deliberately narrower
# than "class A": DATA_TRANSFER and VERTEX_WEIGHT_* are excluded because they
# rewrite vertex groups between the ARMATURE modifier Blender evaluates and the
# weights the exporter reads off the evaluated mesh, a divergence the residual
# gate cannot see.  Any deformer here is a hard refusal -- after lowering, the
# exporter bakes it into the REST mesh and the runtime skins the result, which
# re-freezes exactly the defect Phase 1 exists to remove.
_LOWERING_TOPOLOGY_ONLY = frozenset({
    "ARRAY", "BEVEL", "BOOLEAN", "BUILD", "DECIMATE", "EDGE_SPLIT", "MASK",
    "MIRROR", "MULTIRES", "NORMAL_EDIT", "REMESH", "SCREW", "SOLIDIFY",
    "SUBSURF", "TRIANGULATE", "UV_PROJECT", "UV_WARP", "WEIGHTED_NORMAL",
    "WELD", "WIREFRAME",
})

# Modifiers on the TARGET that leave no readable rest cage at all.  Not
# "impure" -- impurity is priced by the measurement; these have nothing to
# snapshot.
_LOWERING_TARGET_BREAKING = frozenset({
    "NODES", "CLOTH", "SOFT_BODY", "OCEAN", "FLUID", "DYNAMIC_PAINT",
    "EXPLODE", "PARTICLE_SYSTEM", "PARTICLE_INSTANCE", "MESH_SEQUENCE_CACHE",
    "MESH_CACHE", "SURFACE_DEFORM", "MESH_DEFORM",
})

# Modifiers on the TARGET that perturb the "the cage's motion IS LBS" identity.
# Recorded and attributed, never refused: the measurement decides.
_LOWERING_TARGET_PERTURBING = frozenset({
    "SHRINKWRAP", "CORRECTIVE_SMOOTH", "SMOOTH", "LAPLACIANSMOOTH",
    "LAPLACIANDEFORM", "VERTEX_WEIGHT_EDIT", "VERTEX_WEIGHT_MIX",
    "VERTEX_WEIGHT_PROXIMITY", "LATTICE", "CURVE", "HOOK", "WARP", "CAST",
    "SIMPLE_DEFORM", "DISPLACE", "WAVE",
})

_LOWERING_BIND_TYPES = frozenset({"SURFACE_DEFORM", "MESH_DEFORM"})


def _lowering_conditional_modifiers(obj):
    """Modifier names on ``obj`` whose visibility a driver or keyframe moves.

    A conditionally-applied stack has no single derived weight set, and one
    frame's read of ``show_viewport`` under-reports it -- the same reason
    ``_frozen_deformer_issue`` consults ``_driven_data_paths``.  Ellie's
    fannypack zippers are the witness: three SurfaceDeform modifiers whose
    visibility a rig property switches between one cage and two others.
    """
    driven = _driven_data_paths(obj)
    conditional = []
    for modifier in getattr(obj, "modifiers", ()):
        prefix = f'modifiers["{modifier.name}"]'
        if any(
            path in (f"{prefix}.show_viewport", f"{prefix}.show_render")
            for path in driven
        ):
            conditional.append(modifier.name)
            continue
        keyed = _keyframed_modifier_parameter(obj, modifier)
        if keyed is not None and (
            ".show_viewport" in keyed or ".show_render" in keyed
        ):
            conditional.append(modifier.name)
    return tuple(conditional)


def _lowering_live_modifiers(obj):
    """The modifiers the exporter's viewport depsgraph can apply.

    ``show_viewport``, not ``show_render``: ``nodes.py:294-330`` evaluates the
    viewport graph.  A driven flag counts as live for the same reason
    ``_frozen_deformer_issue`` treats it as live.
    """
    driven = _driven_data_paths(obj)
    return tuple(
        modifier for modifier in getattr(obj, "modifiers", ())
        if modifier.show_viewport
        or f'modifiers["{modifier.name}"].show_viewport' in driven
    )


def _lowering_refused(obj, modifier_name, target_name, reason):
    """One JSON-safe record for a bind the lowering will not touch."""
    identity = obj.get("blendlink_id")
    return {
        "code": "geometry.surface-deform-not-lowerable",
        "object": obj.name,
        **({"objectId": identity}
           if isinstance(identity, str) and identity else {}),
        **({"modifier": modifier_name} if modifier_name else {}),
        **({"target": target_name} if target_name else {}),
        "outcome": "refused",
        "severity": "refuse",
        "reason": reason,
    }


def _deformer_lowering_candidate(obj, frozen_record, scene):
    """Decide, with no depsgraph evaluation, whether ``obj``'s bind can lower.

    Returns a planned record, a refusal record, or ``None`` when the object
    carries no bind at all and is therefore not this diagnostic's business.
    """
    all_binds = [
        modifier for modifier in getattr(obj, "modifiers", ())
        if modifier.type in _LOWERING_BIND_TYPES
    ]
    if not all_binds:
        return None
    live = _lowering_live_modifiers(obj)
    binds = [modifier for modifier in live if modifier.type in _LOWERING_BIND_TYPES]
    if len(all_binds) != 1 or len(binds) != 1:
        names = ", ".join(repr(item.name) for item in all_binds)
        return _lowering_refused(
            obj, None, None,
            f"{len(all_binds)} bind modifiers ({names}) share this mesh and "
            "their visibility selects between different cages, so there is no "
            "single set of skin weights that reproduces this stack. Resolve "
            "the branch -- delete or apply the binds that are never enabled -- "
            "and re-run.",
        )
    bind = binds[0]
    target = getattr(bind, "target", None)
    target_name = getattr(target, "name", None)
    if bind.type != "SURFACE_DEFORM":
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} is a {bind.type.lower().replace('_', ' ')} "
            "modifier. Only SurfaceDeform binds lower to skin weights; the "
            "mesh-deform cage bind is a different interpolation Blendlink has "
            "not measured.",
        )

    conditional = _lowering_conditional_modifiers(obj)
    if conditional:
        return _lowering_refused(
            obj, bind.name, target_name,
            "a driver or keyframe switches the visibility of "
            + ", ".join(repr(name) for name in conditional)
            + " on this mesh, so its modifier stack -- and with it the set of "
            "skin weights that would reproduce it -- is not the same on every "
            "frame.",
        )

    order = list(obj.modifiers)
    index = order.index(bind)
    before = [item for item in order[:index] if item in live]
    if before:
        return _lowering_refused(
            obj, bind.name, target_name,
            "modifier(s) "
            + ", ".join(repr(item.name) for item in before)
            + f" run before {bind.name!r}, so the geometry the bind reads is "
            "not this mesh's authored vertices and the derived weights would "
            "be sampled at the wrong positions. Move the SurfaceDeform to the "
            "top of the stack, or apply what precedes it.",
        )
    after = [
        item for item in order[index + 1:]
        if item in live and item.type not in _LOWERING_TOPOLOGY_ONLY
    ]
    if after:
        return _lowering_refused(
            obj, bind.name, target_name,
            "modifier(s) "
            + ", ".join(
                f"{item.name!r} ({item.type.lower().replace('_', ' ')})"
                for item in after
            )
            + f" run after {bind.name!r}. Lowering the bind to skin weights "
            "would leave them baked into the exported rest mesh and skinned as "
            "though they were static, which is the same defect this lowering "
            "exists to remove. Apply or remove them first.",
        )

    if float(getattr(bind, "strength", 1.0)) != 1.0:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} has Strength {bind.strength:g}, so it is a partial "
            "blend between the bound and undeformed positions. Plain skin "
            "weights cannot express that blend. Set Strength to 1.0.",
        )
    if str(getattr(bind, "vertex_group", "") or ""):
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} is masked by vertex group {bind.vertex_group!r}, "
            "so it deforms only part of the mesh. Plain skin weights cannot "
            "express that mask. Clear the vertex group, or split the masked "
            "region into its own object.",
        )
    if not bool(getattr(bind, "is_bound", False)):
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} is not bound, so it contributes nothing and there "
            "is nothing to lower. Press Bind, or remove the modifier.",
        )
    if bool(getattr(bind, "use_pin_to_last", False)):
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} has Pin To Last enabled, which re-orders it after "
            "every later modifier at evaluation time, so the stack this "
            "predicate read is not the stack Blender applies.",
        )

    if getattr(obj.data, "shape_keys", None) is not None:
        return _lowering_refused(
            obj, bind.name, target_name,
            "this mesh has shape keys. primitive_extract.py:1112-1116 sources "
            "POSITION from the Basis cage whenever a key block survives, so "
            "the shipped rest positions are not the ones this lowering "
            "measures and the residual gate would be blind to the difference. "
            "Blendlink has no measurement for that path and refuses rather "
            "than guessing.",
        )

    if target is None or getattr(target, "type", None) != "MESH":
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{bind.name!r} has no mesh cage, so there is no rest surface to "
            "derive weights from.",
        )

    target_conditional = _lowering_conditional_modifiers(target)
    if target_conditional:
        return _lowering_refused(
            obj, bind.name, target_name,
            "a driver or keyframe switches the visibility of "
            + ", ".join(repr(name) for name in target_conditional)
            + f" on the deformer cage {target.name!r}, so the cage the weights "
            "would be derived from is not the same on every frame.",
        )
    target_live = _lowering_live_modifiers(target)
    breaking = [
        item for item in target_live if item.type in _LOWERING_TARGET_BREAKING
    ]
    if breaking:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} carries "
            + ", ".join(
                f"{item.name!r} ({item.type.lower().replace('_', ' ')})"
                for item in breaking
            )
            + ", which has no readable rest pose -- its output is a "
            "simulation, a node graph, or another bind. There is no cage to "
            "snapshot.",
        )
    armatures = [item for item in target_live if item.type == "ARMATURE"]
    if len(armatures) != 1 or armatures[0].object is None:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} has {len(armatures)} usable "
            "Armature modifier(s). The lowering is valid only when the cage's "
            "own motion IS linear blend skinning from exactly one armature. "
            "Skin the cage, or skin this mesh directly.",
        )
    armature_modifier = armatures[0]
    rig = armature_modifier.object
    if bool(getattr(armature_modifier, "use_bone_envelopes", False)):
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} uses Bone Envelopes, which "
            "have no exported form (primitive_extract.py:1557 derives weights "
            "from vertex groups alone), so the weights this lowering can read "
            "are not the weights Blender is using. Bake the envelopes into "
            "groups with Weight from Bones.",
        )
    if not bool(getattr(armature_modifier, "use_vertex_groups", True)):
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} has Vertex Groups switched off "
            "on its Armature modifier, so its motion does not come from the "
            "weights this lowering would transfer.",
        )

    if obj.parent is not rig:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"this mesh's parent is {getattr(obj.parent, 'name', None)!r}, not "
            f"the armature {rig.name!r} that drives its deformer cage. "
            "tree.py:246-260 attaches a skinned mesh to its skin through the "
            "parent link and falls back to a name search otherwise, which can "
            "leave the node unskinned with only a log line. Parent this mesh "
            "to the armature (Object > Parent > Object, Keep Transform).",
        )

    bones = getattr(getattr(rig, "data", None), "bones", None)
    if bones is None:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"{rig.name!r} has no armature data to read bones from.",
        )
    joints, non_deform = [], []
    for group in target.vertex_groups:
        bone = bones.get(group.name)
        if bone is None:
            # Blender's own ARMATURE modifier ignores a group that names no
            # bone, so dropping it here changes nothing that ships.
            continue
        (joints if bone.use_deform else non_deform).append(group.name)
    if non_deform:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} is weighted to "
            + ", ".join(repr(name) for name in sorted(non_deform))
            + ", which are bones with Deform switched off. Blendlink exports "
            "with export_def_bones=True, so those bones are not joints and the "
            "transferred weight would vanish -- the exporter reassigns the "
            "affected vertices to a fabricated neutral joint "
            "(primitive_extract.py:1580-1581). Enable Deform on those bones, "
            "or remove the groups.",
        )
    if not joints:
        return _lowering_refused(
            obj, bind.name, target_name,
            f"the deformer cage {target.name!r} carries no vertex group naming "
            f"a deform bone of {rig.name!r}, so there is nothing to transfer.",
        )
    # Every group naming a deform bone is a hazard, not only the ones the
    # lowering would write.  primitive_extract.py:1556-1557 matches groups to
    # joints BY NAME, so an unrelated authored group naming any deform bone
    # ships as a joint influence the measurement below does not model, and the
    # measured residual would then be describing a different mesh than the one
    # that ships.
    collisions = sorted(
        {group.name for group in obj.vertex_groups}.intersection(
            bone.name for bone in bones if bone.use_deform
        )
    )
    if collisions:
        return _lowering_refused(
            obj, bind.name, target_name,
            "this mesh already carries vertex group(s) "
            + ", ".join(repr(name) for name in collisions)
            + f" naming deform bones of {rig.name!r}. The exporter matches "
            "groups to joints by name, so those would ship as skin weights "
            "beside the derived ones -- rewriting authored data where the "
            "names coincide, and going unmeasured where they do not. Rename "
            "or remove those groups.",
        )

    # The frozen record is per object, and lowering the bind removes only the
    # bind's contribution.  Another moving deformer on the same mesh would stay
    # frozen behind a green tick.
    others = [
        entry for entry in frozen_record["modifiers"]
        if entry["name"] != bind.name
    ]
    if others:
        return _lowering_refused(
            obj, bind.name, target_name,
            "this mesh also freezes "
            + ", ".join(
                f"{entry['name']!r} ({entry['type'].lower().replace('_', ' ')})"
                for entry in others
            )
            + ". Lowering the SurfaceDeform alone would remove one defect and "
            "leave the others in place while the export succeeded, which reads "
            "as a guarantee it is not.",
        )

    identity = obj.get("blendlink_id")
    return {
        "code": "geometry.surface-deform-lowered-to-skin",
        "object": obj.name,
        **({"objectId": identity}
           if isinstance(identity, str) and identity else {}),
        "modifier": bind.name,
        "target": target.name,
        "armature": rig.name,
        "joints": sorted(joints),
        "falloff": float(getattr(bind, "falloff", 4.0)),
        "targetPerturbingModifiers": [
            {"name": item.name, "type": item.type}
            for item in target_live
            if item.type in _LOWERING_TARGET_PERTURBING
        ],
        "frameRange": [scene.frame_start, scene.frame_end],
        "outcome": "planned",
        "severity": "info",
    }


def deformer_lowering_plan(scene, objects=None, frozen=None):
    """Which frozen SURFACE_DEFORM binds can ship as glTF skins, and which cannot.

    Pure RNA: zero depsgraph evaluation and zero frame stepping, exactly like
    ``frozen_deformer_issues``, so the addon can show it live.  Every record in
    ``lower`` is a *proposal*.  ``verified`` stays False until
    ``verify_deformer_lowerings`` has measured it, and an unverified proposal
    must never suppress the frozen-deformer refusal.

    Scoped to objects that already produce a frozen-deformer refusal: a mesh
    whose bind provably does not move is not broken and needs no lowering.
    """
    def _empty():
        return {
            "lower": [], "refuse": [],
            "warnFraction": _DISPLACEMENT_WARN_FRACTION,
            "refuseFraction": _LOWERING_REFUSE_FRACTION,
            "verified": False,
        }

    if scene.frame_start == scene.frame_end:
        return _empty()
    scoped = tuple(scene.objects if objects is None else objects)
    records = (
        frozen_deformer_issues(scene, objects=scoped) if frozen is None
        else frozen
    )
    by_object = {item["object"]: item for item in records}
    if not by_object:
        return _empty()
    lower, refuse = [], []
    for obj in scoped:
        record = by_object.get(obj.name)
        if record is None:
            continue
        entry = _deformer_lowering_candidate(obj, record, scene)
        if entry is None:
            continue
        (lower if entry["outcome"] == "planned" else refuse).append(entry)
    plan = _empty()
    plan["lower"] = sorted(lower, key=lambda item: item["object"].casefold())
    plan["refuse"] = sorted(refuse, key=lambda item: item["object"].casefold())
    return plan


# ---------------------------------------------------------------------------
# Derivation, installation, measurement.
# ---------------------------------------------------------------------------


def _lowering_rest_cage(target):
    """Snapshot the cage: vertices, triangles, per-vertex group weights.

    Only the cage's own ARMATURE is muted -- MIRROR and every other class-A
    modifier stay, because they define the rest mesh the skin acts on.  Reading
    the base mesh instead would miss ellie's bottom cage entirely, whose 42
    evaluated vertices come from 22 base vertices through a MIRROR with merge,
    and whose flipped .L/.R groups exist only after that MIRROR runs.
    """
    with _applied_mesh(target) as mesh:
        if mesh is None:
            return None
        mesh.calc_loop_triangles()
        return {
            "co": [vertex.co.copy() for vertex in mesh.vertices],
            "weights": [
                {item.group: item.weight for item in vertex.groups}
                for vertex in mesh.vertices
            ],
            "triangles": [tuple(tri.vertices) for tri in mesh.loop_triangles],
            "groups": [group.name for group in target.vertex_groups],
        }


def _derive_lowering_weights(obj, target, joints):
    """Closest-point, face-interpolated weight transfer from the rest cage.

    Mechanism (a) -- reading SurfaceDeform's own bind -- is unavailable:
    Blender 5.2 registers 20 RNA properties on ``SurfaceDeformModifier`` and
    none of them is the bind array, so the interpolation must be
    reconstructed.  Measured against the alternatives on ellie, this one sits
    on the accuracy plateau: a falloff-weighted average over every cage polygon
    at exponents 2/4/8 returned byte-identical maxima, while nearest-VERTEX was
    1.6x worse on the bottom teeth.  ``poly_3d_calc`` is Blender's own
    barycentric routine rather than a second implementation of it.

    Returns ``(per_vertex_weights, facts)`` or ``(None, reason)``.
    """
    cage = _lowering_rest_cage(target)
    if cage is None or not cage["triangles"]:
        return None, (
            f"the deformer cage {target.name!r} evaluates to no triangles, so "
            "there is no surface to transfer weights from."
        )
    wanted = set(joints)
    tree = BVHTree.FromPolygons(
        [tuple(point) for point in cage["co"]],
        [list(triangle) for triangle in cage["triangles"]],
        all_triangles=True,
    )
    to_target = target.matrix_world.inverted() @ obj.matrix_world
    per_vertex = []
    farthest = 0.0
    unweighted = 0
    clamped = 0
    widest = 0
    for vertex in obj.data.vertices:
        location, _normal, index, distance = tree.find_nearest(
            to_target @ vertex.co,
        )
        if index is None:
            per_vertex.append({})
            unweighted += 1
            continue
        farthest = max(farthest, float(distance or 0.0))
        triangle = cage["triangles"][index]
        corners = [cage["co"][corner] for corner in triangle]
        blended = {}
        for share, corner in zip(
                poly_3d_calc(corners, Vector(location)), triangle):
            if share <= 0.0:
                continue
            for group_index, weight in cage["weights"][corner].items():
                name = cage["groups"][group_index]
                if name not in wanted or weight <= 0.0:
                    continue
                blended[name] = blended.get(name, 0.0) + share * weight
        blended = {
            name: value for name, value in blended.items()
            if value > _LOWERING_WEIGHT_EPSILON
        }
        widest = max(widest, len(blended))
        if len(blended) > _LOWERING_MAX_INFLUENCES:
            clamped += 1
            blended = dict(sorted(
                blended.items(), key=lambda item: (-item[1], item[0]),
            )[:_LOWERING_MAX_INFLUENCES])
        total = sum(blended.values())
        if total <= 0.0:
            per_vertex.append({})
            unweighted += 1
            continue
        per_vertex.append(
            {name: value / total for name, value in blended.items()}
        )
    if unweighted:
        return None, (
            f"{unweighted} of {len(per_vertex)} vertices land on no weighted "
            f"part of the deformer cage {target.name!r}, so their motion "
            "cannot be expressed as skin weights at all."
        )
    return per_vertex, {
        "cageVertices": len(cage["co"]),
        "cageTriangles": len(cage["triangles"]),
        "maxBindDistance": _rounded(farthest),
        "derivedInfluences": widest,
        "clampedVertices": clamped,
    }


def prepare_lowered_skins(derivations):
    """Install every verified lowering on a private mesh copy, for one export.

    Three mutations per object, two of them on the *Object* -- vertex groups
    and the modifier stack are Object-level, which is why material_compiler's
    Mesh-only ``data_swaps`` protocol covers half of this and why the Mesh half
    additionally renames the source aside (see below).

    Called from inside ``emit_gltf``, after ``with_compiled_materials`` has
    re-validated its own fingerprint.  Installing earlier would move
    ``_materialized_binding_hash``'s per-modifier digest
    (material_compiler.py:1453-1459) and abort a real export with a spurious
    "run Preview again".
    """
    if not derivations:
        return None
    changed = {"objects": []}
    try:
        for item in derivations:
            obj = bpy.data.objects.get(item["object"])
            if obj is None:
                raise RuntimeError(
                    f"lowered object {item['object']!r} disappeared before "
                    "installation"
                )
            original = obj.data
            mesh_name = original.name
            private = original.copy()
            state = {
                "object": obj, "name": item["object"], "original": original,
                "private": private, "meshName": mesh_name, "groups": [],
                "muted": [], "armature": None,
            }
            changed["objects"].append(state)
            # Rename aside rather than material_compiler's plain
            # ``private.name = original.name``: Blender keeps the incumbent ID
            # and suffixes the assignment, so that form ships a Mesh called
            # "X.001", and a lowered export would then carry different glTF
            # mesh names than the same scene exported without the lowering.
            # This is ``realize_unsupported_renderables``'s rename-aside
            # (export_scene.py:4443-4445), applied to a Mesh.
            original.name = f"{mesh_name}.blendlink-lowered-source"
            private.name = mesh_name
            obj.data = private
            if len(private.vertices) != len(item["weights"]):
                raise RuntimeError(
                    f"{obj.name}: derived weights cover "
                    f"{len(item['weights'])} vertices but the mesh has "
                    f"{len(private.vertices)}"
                )
            for name in item["joints"]:
                group = obj.vertex_groups.new(name=name)
                state["groups"].append(group)
                if group.name != name:
                    # Blender suffixes a colliding group name.  Measured trap:
                    # the duplicate is bone-less, the ARMATURE modifier ignores
                    # it and renormalises, so the geometry looks right and the
                    # only symptom is a spurious JOINTS_1 at export.
                    raise RuntimeError(
                        f"{obj.name}: derived vertex group {name!r} collided "
                        f"with an existing group and Blender renamed it to "
                        f"{group.name!r}"
                    )
            by_name = {group.name: group for group in state["groups"]}
            for index, entry in enumerate(item["weights"]):
                for name, weight in entry.items():
                    by_name[name].add([index], weight, "REPLACE")
            for modifier in obj.modifiers:
                if modifier.name != item["modifier"]:
                    continue
                state["muted"].append((modifier, modifier.show_viewport))
                modifier.show_viewport = False
            if not state["muted"]:
                raise RuntimeError(
                    f"{obj.name}: bind modifier {item['modifier']!r} "
                    "disappeared before installation"
                )
            rig = bpy.data.objects.get(item["armature"])
            if rig is None:
                raise RuntimeError(
                    f"{obj.name}: armature {item['armature']!r} disappeared "
                    "before installation"
                )
            armature = obj.modifiers.new(
                name=_LOWERING_ARMATURE_MODIFIER, type="ARMATURE",
            )
            state["armature"] = armature
            armature.object = rig
            armature.use_vertex_groups = True
            armature.use_bone_envelopes = False
            # Index 0 so a post-bind SUBSURF still subdivides a deformed cage,
            # matching the authored order the SurfaceDeform occupied.
            obj.modifiers.move(obj.modifiers.find(armature.name), 0)
        bpy.context.view_layer.update()
        return changed
    except BaseException:
        restore_lowered_skins(changed)
        raise


def restore_lowered_skins(changed) -> None:
    """Reverse ``prepare_lowered_skins`` exactly, collecting every failure.

    Order is load-bearing.  The vertex groups must go while the private Mesh is
    still installed: removing a group strips its deform layer from whatever
    Mesh is bound at that moment, and doing it after the swap-back would strip
    the authored one.
    """
    if not changed:
        return
    errors = []
    for state in reversed(changed.get("objects", ())):
        obj = state["object"]
        label = state["name"]
        try:
            if state["armature"] is not None:
                obj.modifiers.remove(state["armature"])
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"{label} armature: {error}")
        for modifier, show_viewport in reversed(state["muted"]):
            try:
                # The literal authored value: a driver re-asserts itself on the
                # next depsgraph update, exactly as
                # ``_shape_key_restoring_modifiers`` already relies on.
                modifier.show_viewport = show_viewport
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                errors.append(f"{label} bind mute: {error}")
        for group in reversed(state["groups"]):
            try:
                obj.vertex_groups.remove(group)
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                errors.append(f"{label} vertex group: {error}")
        try:
            if obj.data is not state["original"]:
                # ``is original`` means the swap never happened -- a rollback
                # from part-way through installation -- and there is nothing to
                # undo.  Anything else is someone else's Mesh and must not be
                # overwritten silently.
                if obj.data is not state["private"]:
                    raise RuntimeError(
                        "private Mesh binding changed before cleanup"
                    )
                obj.data = state["original"]
                if obj.data is not state["original"]:
                    raise RuntimeError("source Mesh did not restore exactly")
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"{label} Mesh restore: {error}")
        try:
            private = state["private"]
            if private.users != 0:
                raise RuntimeError(
                    f"private Mesh still has {private.users} users"
                )
            bpy.data.meshes.remove(private)
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"{label} private Mesh: {error}")
        try:
            # Only after the private copy is gone; the name is taken until then.
            state["original"].name = state["meshName"]
            if state["original"].name != state["meshName"]:
                raise RuntimeError(
                    f"source Mesh kept the name {state['original'].name!r}"
                )
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"{label} source Mesh name: {error}")
    if errors:
        raise RuntimeError(
            "lowered-skin restoration failed: " + "; ".join(errors)
        )
    bpy.context.view_layer.update()


def _lowering_evaluated_points(obj, matrix=None):
    """Evaluated vertices of the AUTHORED stack as plain float triples.

    Tuples rather than ``Vector`` on purpose: the sweep holds one frame's worth
    per object and the attribution pass caches a whole range.
    """
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(
        preserve_all_data_layers=True, depsgraph=depsgraph,
    )
    if mesh is None:
        return None
    try:
        if matrix is None:
            return [tuple(vertex.co) for vertex in mesh.vertices]
        return [tuple(matrix @ vertex.co) for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def _lowering_shipped_rest(obj, rig, joints):
    """What the exporter would ship for a lowered ``obj``: rest + skin weights.

    ``_applied_mesh`` is the exporter's own read (``nodes.py:294-330``): mute
    this object's ARMATURE modifiers, evaluate the viewport depsgraph,
    ``to_mesh``.  With the lowering installed that mutes the synthetic
    ARMATURE, the bind is already muted, and what comes back is exactly the
    rest mesh and the interpolated weights the glb carries -- including any
    interpolation a post-bind SUBSURF performed on the derived groups.

    Rest positions are returned in the ARMATURE object's space, which is where
    the pose matrices act.
    """
    wanted = {name: index for index, name in enumerate(joints)}
    lookup = [wanted.get(group.name) for group in obj.vertex_groups]
    widest = 0
    with _applied_mesh(obj) as mesh:
        if mesh is None:
            return None, "the lowered mesh does not evaluate"
        pre = rig.matrix_world.inverted() @ obj.matrix_world
        rest = []
        influences = []
        for vertex in mesh.vertices:
            pairs = [
                (lookup[item.group], float(item.weight))
                for item in vertex.groups
                if item.group < len(lookup)
                and lookup[item.group] is not None
                and item.weight > _LOWERING_WEIGHT_EPSILON
            ]
            widest = max(widest, len(pairs))
            total = sum(weight for _joint, weight in pairs)
            if total <= 0.0:
                return None, (
                    "a vertex of the lowered mesh carries no joint weight, so "
                    "the exporter would reassign it to a fabricated neutral "
                    "joint (primitive_extract.py:1580-1581)"
                )
            rest.append(pre @ vertex.co)
            influences.append(
                tuple((joint, weight / total) for joint, weight in pairs)
            )
    if widest > _LOWERING_MAX_INFLUENCES:
        return None, (
            f"the exported mesh would carry up to {widest} joint influences "
            f"per vertex. primitive_extract.py:1587 emits "
            f"{(widest + 3) // 4} joint sets for that, and three's GLTFLoader "
            "binds only JOINTS_0/WEIGHTS_0, so the extra weight would be "
            "dropped at runtime without a word. Limit the deformer cage's "
            "weights to 4 influences per vertex."
        )
    return {"rest": rest, "influences": influences, "maxInfluences": widest}, None


def _lowering_pose_matrices(rig, joints):
    """One skinning matrix per joint, in the armature object's space."""
    bones = rig.data.bones
    pose = rig.pose.bones
    matrices = []
    for name in joints:
        bone = bones.get(name)
        posed = pose.get(name)
        if bone is None or posed is None:
            return None
        matrices.append(posed.matrix @ bone.matrix_local.inverted())
    return matrices


def _lowering_skinned_points(shipped, matrices, rig_world):
    """Linear blend skinning in world space, as the runtime computes it."""
    out = []
    for position, influences in zip(shipped["rest"], shipped["influences"]):
        blended = Vector((0.0, 0.0, 0.0))
        for joint, weight in influences:
            blended += (matrices[joint] @ position) * weight
        out.append(tuple(rig_world @ blended))
    return out


def _lowering_worst(left, right):
    """Max Euclidean distance between two point lists, or ``None``."""
    if left is None or right is None or len(left) != len(right):
        return None
    worst = 0.0
    for (ax, ay, az), (bx, by, bz) in zip(left, right):
        dx, dy, dz = ax - bx, ay - by, az - bz
        squared = dx * dx + dy * dy + dz * dz
        if squared > worst:
            worst = squared
    return worst ** 0.5


def _lowering_frames(scene):
    """The frames to sample, and the stride that produced them."""
    span = list(range(int(scene.frame_start), int(scene.frame_end) + 1))
    stride = 1
    if len(span) > _LOWERING_MAX_SAMPLED_FRAMES:
        stride = -(-len(span) // _LOWERING_MAX_SAMPLED_FRAMES)
        span = span[::stride]
        if span[-1] != int(scene.frame_end):
            span.append(int(scene.frame_end))
    if _EXPORTER_FROZEN_FRAME not in span:
        # The frame the glb bakes, which a range starting at 1 never contains.
        span.insert(0, _EXPORTER_FROZEN_FRAME)
    return span, stride


def _lowering_message(record):
    """The artist-facing sentence, with both numbers in it."""
    joints = len(record["joints"])
    diagonal = record.get("bboxDiagonal") or 0.0
    residual = record.get("residual")
    frozen = record.get("frozenDeviation")
    head = (
        f"{record['object']}: its SurfaceDeform bind to {record['target']} was "
        f"lowered to glTF skin weights on {joints} joint"
        f"{'' if joints == 1 else 's'} of {record['armature']}."
    )
    if residual is None or frozen is None:
        return head
    head += (
        f" Blender and the website agree to {residual * 1000.0:.3f} mm "
        f"({_percent(residual, diagonal)} of the {diagonal:.3f} m "
        f"bounding-box diagonal, worst at frame {record.get('worstFrame')}), "
        f"against {frozen * 1000.0:.1f} mm ({_percent(frozen, diagonal)}) if "
        "it shipped as a static prop."
    )
    if record.get("severity") != "warn":
        return head
    names = ", ".join(
        f"{item['name']!r} ({item['type'].lower().replace('_', ' ')})"
        for item in record.get("targetPerturbingModifiers") or ()
    )
    attribution = record.get("targetPerturbation")
    if names and attribution is not None:
        return head + (
            f" That is above the 1% agreement line. The deformer cage's "
            f"{names} is not linear blend skinning and accounts for "
            f"{_percent(attribution, diagonal)} of it; the remainder is the "
            f"weight transfer itself, which the cage's resolution "
            f"({record.get('cageVertices')} vertices, "
            f"{record.get('cageTriangles')} triangles for "
            f"{record.get('exportedVertices')} bound vertices) bounds from "
            "below. Subdivide the cage, or remove those modifiers from it, if "
            "the website must match Blender."
        )
    return head + (
        " That is above the 1% agreement line. The deformer cage "
        f"({record.get('cageVertices')} vertices, "
        f"{record.get('cageTriangles')} triangles for "
        f"{record.get('exportedVertices')} bound vertices) is coarse relative "
        "to the bound mesh, which bounds how well any set of skin weights can "
        "reproduce the bind. Subdivide the cage if the website must match "
        "Blender."
    )


def _score_lowering(record, residual, frozen, worst_frame, diagonal):
    """Apply the shared 1%/10% lines plus the strict-improvement guard."""
    record["bboxDiagonal"] = _rounded(diagonal)
    record["residual"] = _rounded(residual)
    record["frozenDeviation"] = _rounded(frozen)
    record["worstFrame"] = worst_frame
    fraction = (residual / diagonal) if diagonal else None
    record["residualFraction"] = _rounded(fraction)
    record["frozenFraction"] = _rounded((frozen / diagonal) if diagonal else None)
    record["improvementRatio"] = _rounded(
        (frozen / residual) if residual > 0.0 else None
    )
    if fraction is None:
        record["outcome"] = "refused"
        record["severity"] = "refuse"
        record["reason"] = (
            f"{record['object']}: its bounding box is degenerate, so the "
            "residual cannot be expressed as a fraction of it and the lowering "
            "cannot be scored."
        )
        return
    if residual >= frozen:
        record["outcome"] = "refused"
        record["severity"] = "refuse"
        record["reason"] = (
            f"{record['object']}: lowering its SurfaceDeform bind to skin "
            f"weights leaves the website {_percent(residual, diagonal)} of the "
            f"bounding-box diagonal away from Blender, which is no better than "
            f"the {_percent(frozen, diagonal)} it already ships as a frozen "
            "prop. A lowering that is not a strict improvement is not worth "
            "the approximation."
        )
        return
    if fraction > _LOWERING_REFUSE_FRACTION:
        record["outcome"] = "refused"
        record["severity"] = "refuse"
        record["reason"] = (
            f"{record['object']}: its SurfaceDeform bind to "
            f"{record['target']} can be lowered to skin weights, but the "
            f"measured result differs from Blender by "
            f"{_percent(residual, diagonal)} of the bounding-box diagonal "
            f"(worst at frame {worst_frame}) -- above the "
            f"{_LOWERING_REFUSE_FRACTION * 100:.0f}% refusal line. It would "
            f"beat the {_percent(frozen, diagonal)} a frozen prop ships, but "
            "not by enough to publish silently. Subdivide the deformer cage, "
            "or skin this mesh to the armature directly."
        )
        return
    record["outcome"] = "lowered"
    record["severity"] = (
        "warn" if fraction > _DISPLACEMENT_WARN_FRACTION else "info"
    )
    record["message"] = _lowering_message(record)


def _refuse_lowering(record, reason):
    record["outcome"] = "refused"
    record["severity"] = "refuse"
    record["reason"] = f"{record['object']}: {reason}"


def verify_deformer_lowerings(scene, plan):
    """Measure every planned lowering end to end and score it.

    Mutates ``plan`` in place -- each record in ``plan["lower"]`` gains its
    measured residual and an ``outcome`` of ``"lowered"`` or ``"refused"`` --
    and returns the derivations the enactor needs, for the records that passed.

    One short install/restore transaction captures the shipped rest mesh and
    weights; the frame sweep afterwards evaluates only the AUTHORED stack and
    computes the shipped state by linear blend skinning.  That is both half the
    depsgraph work and the more honest oracle: re-evaluating the lowered stack
    in Blender would hide the subdivide-then-skin difference, because Blender
    skins first.
    """
    plan["verified"] = True
    planned = [
        record for record in plan.get("lower", ())
        if record.get("outcome") == "planned"
    ]
    if not planned:
        return []
    frames, stride = _lowering_frames(scene)
    for record in plan.get("lower", ()):
        record["sampledFrames"] = len(frames)
        record["frameStride"] = stride
        record["exhaustive"] = stride == 1
    restore_frame = scene.frame_current
    derivations = []
    installed = None
    try:
        scene.frame_set(_EXPORTER_FROZEN_FRAME)
        bpy.context.view_layer.update()
        for record in planned:
            obj = bpy.data.objects.get(record["object"])
            target = bpy.data.objects.get(record["target"])
            rig = bpy.data.objects.get(record["armature"])
            if obj is None or target is None or rig is None:
                _refuse_lowering(record, (
                    "the mesh, its deformer cage or its armature disappeared "
                    "before the lowering could be measured."
                ))
                continue
            weights, facts = _derive_lowering_weights(
                obj, target, record["joints"],
            )
            if weights is None:
                _refuse_lowering(record, facts)
                continue
            record.update(facts)
            derivations.append({
                "object": obj.name,
                "modifier": record["modifier"],
                "armature": rig.name,
                "joints": list(record["joints"]),
                "weights": weights,
                "record": record,
                # What the glb ships when the lowering is refused: the frame-0
                # evaluated mesh, carried by the node's own animated transform.
                "frozenLocal": _lowering_evaluated_points(obj),
                "diagonal": _bbox_diagonal(obj),
            })
        if derivations:
            installed = prepare_lowered_skins(derivations)
            scene.frame_set(_EXPORTER_FROZEN_FRAME)
            bpy.context.view_layer.update()
            for item in list(derivations):
                record = item["record"]
                obj = bpy.data.objects[item["object"]]
                rig = bpy.data.objects[item["armature"]]
                shipped, reason = _lowering_shipped_rest(
                    obj, rig, item["joints"],
                )
                if shipped is None:
                    _refuse_lowering(record, reason)
                    derivations.remove(item)
                    continue
                if item["frozenLocal"] is None or len(shipped["rest"]) != len(
                        item["frozenLocal"]):
                    _refuse_lowering(record, (
                        "the lowered stack evaluates to a different vertex "
                        "count than the authored one, so the two cannot be "
                        "compared vertex by vertex."
                    ))
                    derivations.remove(item)
                    continue
                record["exportedVertices"] = len(shipped["rest"])
                record["exportedInfluences"] = shipped["maxInfluences"]
                item["shipped"] = shipped
    finally:
        if installed is not None:
            restore_lowered_skins(installed)

    if not derivations:
        scene.frame_set(restore_frame)
        bpy.context.view_layer.update()
        return []

    try:
        worst = {item["object"]: [0.0, None, 0.0] for item in derivations}
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            for item in derivations:
                obj = bpy.data.objects[item["object"]]
                rig = bpy.data.objects[item["armature"]]
                authored = _lowering_evaluated_points(obj, obj.matrix_world)
                matrices = _lowering_pose_matrices(rig, item["joints"])
                if authored is None or matrices is None:
                    continue
                frozen = _lowering_worst(authored, [
                    tuple(obj.matrix_world @ Vector(point))
                    for point in item["frozenLocal"]
                ])
                residual = _lowering_worst(authored, _lowering_skinned_points(
                    item["shipped"], matrices, rig.matrix_world,
                ))
                entry = worst[item["object"]]
                if residual is not None and residual > entry[0]:
                    entry[0], entry[1] = residual, frame
                if frozen is not None and frozen > entry[2]:
                    entry[2] = frozen
        for item in derivations:
            residual, frame, frozen = worst[item["object"]]
            _score_lowering(
                item["record"], residual, frozen, frame, item["diagonal"],
            )
        _attribute_target_perturbation(scene, frames, derivations)
    finally:
        scene.frame_set(restore_frame)
        bpy.context.view_layer.update()
    return [
        item for item in derivations
        if item["record"].get("outcome") == "lowered"
    ]


def _attribute_target_perturbation(scene, frames, derivations):
    """Price the cage's non-LBS modifiers, for warn-severity records only.

    A second sweep, so it is spent only where the artist has a decision to
    make.  Measured on ellie this is the difference between "your Shrinkwrap
    costs 0.23%" and "your Shrinkwrap costs nothing and the cage is too
    coarse" -- the second is the bottom teeth, and without the attribution the
    artist would remove a modifier that changes nothing.

    Both states are evaluated inside the frame loop rather than diffing against
    a cached copy of the first sweep: caching would size peak memory by the
    artist's frame range, and this pass runs only for a warn.
    """
    wanted = [
        item for item in derivations
        if item["record"].get("severity") == "warn"
        and item["record"].get("targetPerturbingModifiers")
    ]
    if not wanted:
        return
    perturbers = []
    for item in wanted:
        target = bpy.data.objects.get(item["record"]["target"])
        if target is None:
            continue
        names = {
            entry["name"]
            for entry in item["record"]["targetPerturbingModifiers"]
        }
        perturbers.extend(
            (modifier, modifier.show_viewport)
            for modifier in target.modifiers
            if modifier.name in names and modifier.show_viewport
        )
    if not perturbers:
        return
    worst = {item["object"]: 0.0 for item in wanted}
    try:
        for frame in frames:
            scene.frame_set(frame)
            for modifier, _was in perturbers:
                modifier.show_viewport = False
            bpy.context.view_layer.update()
            pure = {
                item["object"]: _lowering_evaluated_points(
                    bpy.data.objects[item["object"]],
                    bpy.data.objects[item["object"]].matrix_world,
                )
                for item in wanted
            }
            for modifier, was in perturbers:
                modifier.show_viewport = was
            bpy.context.view_layer.update()
            for item in wanted:
                obj = bpy.data.objects[item["object"]]
                delta = _lowering_worst(
                    pure[item["object"]],
                    _lowering_evaluated_points(obj, obj.matrix_world),
                )
                if delta is not None and delta > worst[item["object"]]:
                    worst[item["object"]] = delta
    finally:
        # The literal authored value; a driver re-asserts itself on the next
        # depsgraph update.
        for modifier, was in reversed(perturbers):
            modifier.show_viewport = was
        bpy.context.view_layer.update()
    for item in wanted:
        item["record"]["targetPerturbation"] = _rounded(worst[item["object"]])
        item["record"]["message"] = _lowering_message(item["record"])


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
    # A second traversal on purpose. ``_shape_key_facts`` mutes ARMATURE
    # modifiers, which invalidates the dependency graph the loop above hands to
    # ``evaluated_material_uses`` (see that function's own note). Repeating the
    # cheap visibility gate costs less than making the tested material contract
    # depend on iteration order.
    shape_key_facts = []
    skin_approximation = []
    for obj in scoped_objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        facts = _shape_key_facts(obj)
        if facts is not None:
            shape_key_facts.append(facts)
        skin_record = _skin_approximation_record(obj)
        if skin_record is not None:
            skin_approximation.append(skin_record)
    _sample_shape_key_values(scene, shape_key_facts, full)
    shape_keys = [
        _finalize_shape_keys(facts, scene) for facts in shape_key_facts
    ]
    # Phase 0a's record stays exactly as it is: the mesh IS frozen as authored
    # and the artist must be told so, whether or not the exporter can repair it
    # for one export.  Phase 1 rides beside it as a separate, unverified
    # proposal; only the exporter's measurement can promote a proposal into a
    # reason not to refuse.
    frozen_deformers = frozen_deformer_issues(scene, objects=scoped_objects)
    return {
        "procedural": procedural,
        "instances": _analyze_instances(scene, scoped_objects),
        "materials": sorted(materials.values(), key=lambda item: item["material"].casefold()),
        # Phase 0c / 0d. Additive: shape keys the applied-modifier export path
        # drops, and ARMATURE options glTF has no form for.
        "shapeKeys": shape_keys,
        "skinApproximation": skin_approximation,
        # Phase 0a. Additive and independent of every sample above: this is
        # decided with no depsgraph evaluation, so it stays correct even when
        # the procedural audit is not run exhaustively.
        "frozenDeformers": frozen_deformers,
        # Phase 1. Also depsgraph-free: a *proposal* to lower a frozen
        # SurfaceDeform bind onto glTF skin weights, with ``verified`` False
        # until the exporter has measured the residual on the real lowered
        # mesh. Nothing acts on an unverified proposal.
        "deformerLowerings": deformer_lowering_plan(
            scene, objects=scoped_objects, frozen=frozen_deformers,
        ),
        "limits": {
            "maxAuditFrames": MAX_AUDIT_FRAMES,
            "maxAuditSnapshots": MAX_AUDIT_SNAPSHOTS,
            "maxMorphCacheBytes": MAX_MORPH_CACHE_BYTES,
        },
    }
