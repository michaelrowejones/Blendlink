# SPDX-License-Identifier: GPL-3.0-or-later
"""Compile explicit Blender material intent to stock glTF materials.

The public seam is deliberately small:

``plan_materials`` inspects the exact export scope without mutation.
``with_compiled_materials`` revalidates that plan, installs private stock-glTF
materials for one export continuation, attests the emitted GLB, and restores
every source binding in ``finally``.

This production slice supports the visible ``Blendlink Web Color`` sink with
direct constant, vertex-color, image, and a deliberately narrow private
selected-field materialization. All UV, Cycles EMIT, coverage, save, and device
mechanics remain in canonical ``bakelib.py``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import heapq
import hashlib
import json
import math
import os
import struct
import tempfile
from typing import Callable

import bpy

if __package__:
    from .bakelib_loader import bakelib
    from . import glblib, procedural, tsl_ir
else:
    import bakelib
    import glblib
    import procedural
    import tsl_ir


PLAN_VERSION = 1
ATTESTATION_MODEL = "primitive-corner-v1"
MARKER_VERSION = 1
MARKER_NODE_PROPERTY = "blendlink_material_source_version"
MARKER_GROUP_PROPERTY = "blendlink_material_source_group_version"
MARKER_SURFACE_RESPONSE_PROPERTY = "blendlink_surface_response"
MARKER_GROUP_NAME = "Blendlink Web Color"
COLOR_INPUT = "Base Color"
ALPHA_INPUT = "Alpha"
GENERATED_MATERIAL_PREFIX = "BLENDLINK_WEB."
PRIVATE_COLOR_PREFIX = "_BLENDLINK_WEB_"
STATIC_SHADE_FLOOR_MODEL = "selected-intrinsic-static-shade-floor-v1"
MATERIAL_BAKE_PROPERTY = "blendlink_material_bake"
TSL_IR_PROPERTY = "blendlink_tsl_ir"
TSL_IR_BYTE_BUDGET = 262144
CHANNEL_PLAN_MODEL = "principled-channel-plan-v1"
PRIVATE_CHANNEL_PREFIX = "BLENDLINK_PRIVATE_CHANNEL."
MATERIAL_BAKE_RULE = "blendlink.lit.material-bake"
# The standalone TSL-program route: the carrier is a stock passthrough
# copy of the artist material (the runtime finds programs ONLY through
# blendlink_source_material extras on generated materials), and the
# sidecar carries the proven per-channel IR. No bake, no image products.
TSL_PROGRAM_RULE = "blendlink.stock.tsl-program"
TSL_PROGRAM_PLAN_MODEL = "tsl-program-plan-v1"


class MaterialCompileError(RuntimeError):
    """A selected material field could not be compiled truthfully."""


@dataclass(frozen=True)
class MaterialIssue:
    code: str
    material: str
    problem: str
    fix: str
    objects: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "material": self.material,
            "problem": self.problem,
            "fix": self.fix,
            "objects": list(self.objects),
        }


@dataclass(frozen=True)
class FieldSource:
    kind: str  # constant | vertexColor | image | materialized
    node_name: str
    socket_identifier: str
    socket_name: str
    value: tuple[float, float, float, float] | None = None
    attribute_name: str | None = None
    image_name: str | None = None
    image_hash: str | None = None
    image_mime: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    interpolation: str | None = None
    extension: str | None = None
    projection: str | None = None
    uv_mode: str | None = None  # activeRender | named
    uv_name: str | None = None
    material_hash: str | None = None
    materialization: str | None = None
    dependency_nodes: tuple[str, ...] = ()

    def fingerprint_dict(self) -> dict:
        return {
            "kind": self.kind,
            "node": self.node_name,
            "socket": self.socket_identifier,
            "socketName": self.socket_name,
            "value": list(self.value) if self.value is not None else None,
            "attribute": self.attribute_name,
            "image": self.image_name,
            "imageHash": self.image_hash,
            "imageMime": self.image_mime,
            "imageSize": (
                [self.image_width, self.image_height]
                if self.image_width is not None and self.image_height is not None else None
            ),
            "interpolation": self.interpolation,
            "extension": self.extension,
            "projection": self.projection,
            "uvMode": self.uv_mode,
            "uvName": self.uv_name,
            "materialHash": self.material_hash,
            "materialization": self.materialization,
            "dependencyNodes": list(self.dependency_nodes),
        }


@dataclass(frozen=True)
class SurfaceFactorization:
    """One exactly recognized source response lowered to stock glTF fields.

    The static floor is exact. The source Shader-to-RGB direct term is
    deliberately represented by ordinary metallic-roughness lighting, so that
    approximation is named rather than hidden behind the generic lit carrier.
    """

    model: str
    shade_value: float
    shade_color: tuple[float, float, float, float]
    proof_hash: str

    @property
    def base_color_factor(self) -> tuple[float, float, float]:
        return (self.shade_value,) * 3

    @property
    def emissive_factor(self) -> tuple[float, float, float]:
        return tuple(
            (1.0 - self.shade_value)
            + self.shade_value * self.shade_color[index]
            for index in range(3)
        )

    def fingerprint_dict(self) -> dict:
        return {
            "model": self.model,
            "shadeValue": self.shade_value,
            "shadeColor": list(self.shade_color),
            "proofHash": self.proof_hash,
            "baseColorFactor": list(self.base_color_factor),
            "emissiveFactor": list(self.emissive_factor),
            "textureOwnership": "sharedBaseAndEmissive",
            "exactTerms": ["selectedIntrinsic", "staticShadeFloor"],
            "approximateTerms": ["shaderToRgbDirectResponseAsMetallicRoughness"],
        }


@dataclass(frozen=True)
class MaterialBinding:
    object_name: str
    slot_index: int
    source_hash: str | None = None
    materialization_plan: dict | None = field(
        default=None, repr=False, compare=False,
    )
    color_attribute: str | None = None
    alpha_attribute: str | None = None
    alpha_mode: str | None = None  # OPAQUE | MASK | BLEND
    attribute_domain: str | None = None
    attribute_type: str | None = None
    attribute_values: int | None = None
    attribute_min: tuple[float, float, float, float] | None = None
    attribute_max: tuple[float, float, float, float] | None = None
    attribute_hash: str | None = None
    uv_name: str | None = None
    uv_index: int | None = None
    uv_distinct_values: int | None = None
    uv_min: tuple[float, float] | None = None
    uv_max: tuple[float, float] | None = None
    uv_hash: str | None = None
    # MTL-CONS-003: a Component or application adapter may need this object
    # to keep its own material; the opt-out forces a distinct generated
    # variant instead of joining the shared one.
    distinct_material: bool = False
    # Used only inside the in-process GLB attestation transaction. The stable
    # plan fingerprint carries the digest above rather than a potentially
    # enormous JSON list of authored UV corners.
    uv_values: tuple[tuple[float, float], ...] | None = field(
        default=None, repr=False, compare=False,
    )

    def fingerprint_dict(self) -> dict:
        return {
            "object": self.object_name,
            "slot": self.slot_index,
            "sourceHash": self.source_hash,
            "materializationPlan": self.materialization_plan,
            "colorAttribute": self.color_attribute,
            "alphaAttribute": self.alpha_attribute,
            "alphaMode": self.alpha_mode,
            "domain": self.attribute_domain,
            "type": self.attribute_type,
            "values": self.attribute_values,
            "min": list(self.attribute_min) if self.attribute_min is not None else None,
            "max": list(self.attribute_max) if self.attribute_max is not None else None,
            "hash": self.attribute_hash,
            "uvName": self.uv_name,
            "uvIndex": self.uv_index,
            "uvDistinctValues": self.uv_distinct_values,
            "uvMin": list(self.uv_min) if self.uv_min is not None else None,
            "uvMax": list(self.uv_max) if self.uv_max is not None else None,
            "uvHash": self.uv_hash,
            "distinctMaterial": self.distinct_material,
        }


@dataclass(frozen=True)
class MaterialDecision:
    material_name: str
    intent: str  # automatic | webColor | materialBake | tslProgram
    outcome: str  # preserved | lowered | blocked
    transport: str | None  # stock | factor | vertexColor | image | channels | program
    fidelity: str  # full-surface | selected-field
    surface_response: str | None  # lit | unlit
    bindings: tuple[MaterialBinding, ...]
    color: FieldSource | None = None
    alpha: FieldSource | None = None
    limitations: tuple[str, ...] = ()
    issues: tuple[MaterialIssue, ...] = ()
    surface_factorization: SurfaceFactorization | None = None
    channel_plan: dict | None = None

    def fingerprint_dict(self) -> dict:
        return {
            "material": self.material_name,
            "intent": self.intent,
            "outcome": self.outcome,
            "transport": self.transport,
            "fidelity": self.fidelity,
            "surfaceResponse": self.surface_response,
            "bindings": [binding.fingerprint_dict() for binding in self.bindings],
            "color": self.color.fingerprint_dict() if self.color else None,
            "alpha": self.alpha.fingerprint_dict() if self.alpha else None,
            "limitations": list(self.limitations),
            "issues": [issue.as_dict() for issue in self.issues],
            "surfaceFactorization": (
                self.surface_factorization.fingerprint_dict()
                if self.surface_factorization is not None else None
            ),
            "channelPlan": _channel_plan_fingerprint(self.channel_plan),
        }

    def as_dict(self) -> dict:
        result = {
            "intent": self.intent,
            "outcome": self.outcome,
            "fidelity": self.fidelity,
            "limitations": list(self.limitations),
        }
        if self.transport is not None:
            result["transport"] = self.transport
        if self.surface_response is not None:
            result["surfaceResponse"] = self.surface_response
        if self.color is not None:
            result["colorSource"] = {
                "node": self.color.node_name,
                "socket": self.color.socket_name,
                "kind": self.color.kind,
                **({
                    "materialization": self.color.materialization,
                } if self.color.materialization is not None else {}),
            }
        if self.alpha is not None:
            result["alphaSource"] = {
                "node": self.alpha.node_name,
                "socket": self.alpha.socket_name,
                "kind": self.alpha.kind,
            }
        if self.issues:
            result["issues"] = [issue.as_dict() for issue in self.issues]
        if self.surface_factorization is not None:
            result["surfaceFactorization"] = (
                self.surface_factorization.fingerprint_dict()
            )
        if self.channel_plan is not None:
            result["channels"] = self.channel_plan
        return result


@dataclass(frozen=True)
class MaterialPlan:
    purpose: str
    source_fingerprint: str
    decisions: tuple[MaterialDecision, ...]
    objects: tuple[object, ...]

    @property
    def errors(self) -> tuple[MaterialIssue, ...]:
        return tuple(
            issue for decision in self.decisions for issue in decision.issues
            if decision.outcome == "blocked"
        )

    @property
    def lowerings(self) -> tuple[MaterialDecision, ...]:
        return tuple(
            decision for decision in self.decisions if decision.outcome == "lowered"
        )

    def as_dict(self) -> dict:
        return {
            "schemaVersion": PLAN_VERSION,
            "purpose": self.purpose,
            "sourceFingerprint": self.source_fingerprint,
            "decisions": [decision.fingerprint_dict() for decision in self.decisions],
            "errors": [issue.as_dict() for issue in self.errors],
        }


@dataclass(frozen=True)
class MaterialCompilation:
    source_fingerprint: str
    lowered_materials: tuple[str, ...]
    generated_materials: tuple[str, ...]
    gltf_evidence: tuple[dict, ...]

    def as_dict(self) -> dict:
        return {
            "schemaVersion": PLAN_VERSION,
            "attestationModel": ATTESTATION_MODEL,
            "sourceFingerprint": self.source_fingerprint,
            "loweredMaterials": list(self.lowered_materials),
            "generatedMaterials": list(self.generated_materials),
            "gltfEvidence": list(self.gltf_evidence),
        }


def _active_tree(material):
    return getattr(material, "node_tree", None) if material is not None else None


def marker_nodes(material) -> list:
    tree = _active_tree(material)
    if tree is None:
        return []
    return [
        node for node in tree.nodes
        if node.get(MARKER_NODE_PROPERTY) is not None
    ]


def _marker_group():
    for group in bpy.data.node_groups:
        if group.get(MARKER_GROUP_PROPERTY) == MARKER_VERSION:
            return group
    group = bpy.data.node_groups.new(MARKER_GROUP_NAME, "ShaderNodeTree")
    group[MARKER_GROUP_PROPERTY] = MARKER_VERSION
    group.description = (
        "Blendlink compiler input. Links select intrinsic website color and alpha; "
        "the node does not participate in Blender's active Surface."
    )
    color = group.interface.new_socket(
        name=COLOR_INPUT, in_out="INPUT", socket_type="NodeSocketColor",
    )
    color.description = "Color/value field Blendlink should compile for the website"
    alpha = group.interface.new_socket(
        name=ALPHA_INPUT, in_out="INPUT", socket_type="NodeSocketFloat",
    )
    alpha.description = "Optional linear alpha/coverage field"
    alpha.default_value = 1.0
    alpha.min_value = 0.0
    alpha.max_value = 1.0
    return group


def ensure_marker_node(material):
    if material is None:
        raise MaterialCompileError("Choose a material before selecting Website Color.")
    if getattr(material, "library", None) is not None:
        raise MaterialCompileError(
            f'Material "{material.name}" is linked read-only. Make it local or create a library override first.'
        )
    material.use_nodes = True
    tree = material.node_tree
    markers = marker_nodes(material)
    if len(markers) > 1:
        raise MaterialCompileError(
            f'Material "{material.name}" has {len(markers)} Blendlink Web Color nodes. Keep one.'
        )
    if markers:
        marker = markers[0]
        if marker.get(MARKER_NODE_PROPERTY) != MARKER_VERSION:
            raise MaterialCompileError(
                f'Material "{material.name}" uses unsupported Web Color marker version '
                f'{marker.get(MARKER_NODE_PROPERTY)!r}; clear and recreate it.'
            )
        return marker
    marker = tree.nodes.new("ShaderNodeGroup")
    marker.node_tree = _marker_group()
    marker.name = MARKER_GROUP_NAME
    marker.label = MARKER_GROUP_NAME
    marker.width = 220
    marker[MARKER_NODE_PROPERTY] = MARKER_VERSION
    marker[MARKER_SURFACE_RESPONSE_PROPERTY] = "AUTO"
    active = tree.nodes.active
    if active is not None and active != marker:
        marker.location = (active.location.x + active.width + 80, active.location.y)
    return marker


def surface_response_setting(material) -> str:
    markers = marker_nodes(material)
    if len(markers) != 1:
        return "AUTO"
    return str(
        markers[0].get(MARKER_SURFACE_RESPONSE_PROPERTY, "AUTO")
    ).upper()


def set_surface_response(material, response: str):
    response = str(response).upper()
    if response not in {"AUTO", "LIT", "UNLIT"}:
        raise MaterialCompileError(
            f"Website Material surface response must be Automatic, Lit, or "
            f"Unlit, not {response!r}."
        )
    marker = ensure_marker_node(material)
    marker[MARKER_SURFACE_RESPONSE_PROPERTY] = response
    return marker


def eligible_outputs(node) -> tuple[tuple[str, str, str], ...]:
    if node is None:
        return ()
    return tuple(
        (socket.identifier, socket.name, socket.type)
        for socket in node.outputs
        if socket.enabled and socket.type in {"RGBA", "VALUE"}
    )


def set_web_source(
    material,
    source_node,
    socket_identifier: str,
    semantic: str,
    surface_response: str | None = None,
):
    semantic = semantic.upper()
    if semantic not in {"COLOR", "ALPHA"}:
        raise MaterialCompileError(f"Unsupported Website Material semantic {semantic!r}.")
    tree = _active_tree(material)
    if tree is None or source_node is None or source_node.id_data != tree:
        raise MaterialCompileError("Select a node in this material's root Shader Editor first.")
    if source_node.get(MARKER_NODE_PROPERTY) is not None:
        raise MaterialCompileError("Choose a source node, not the Blendlink Web Color sink.")
    source = next((
        socket for socket in source_node.outputs
        if socket.identifier == socket_identifier
    ), None)
    if source is None:
        raise MaterialCompileError(
            f'Output {socket_identifier!r} no longer exists on node "{source_node.name}".'
        )
    if source.type not in {"RGBA", "VALUE"}:
        raise MaterialCompileError(
            f'Output "{source.name}" is {source.type}, not a Color or Value field. '
            "Choose an upstream field before the Shader output."
        )
    marker = ensure_marker_node(material)
    if semantic == "COLOR" and surface_response is not None:
        set_surface_response(material, surface_response)
    target_name = COLOR_INPUT if semantic == "COLOR" else ALPHA_INPUT
    target = marker.inputs.get(target_name)
    if target is None:
        raise MaterialCompileError(
            f'Blendlink Web Color node is missing its "{target_name}" input; clear and recreate it.'
        )
    for link in list(target.links):
        tree.links.remove(link)
    tree.links.new(source, target)
    tree.nodes.active = marker
    marker.select = True
    return marker


def clear_web_source(material, semantic: str = "ALL") -> bool:
    semantic = semantic.upper()
    if semantic not in {"ALL", "COLOR", "ALPHA"}:
        raise MaterialCompileError(f"Unsupported Website Material semantic {semantic!r}.")
    tree = _active_tree(material)
    markers = marker_nodes(material)
    if tree is None or not markers:
        return False
    changed = False
    for marker in markers:
        if semantic in {"ALL", "COLOR"}:
            tree.nodes.remove(marker)
            changed = True
            continue
        alpha = marker.inputs.get(ALPHA_INPUT)
        for link in list(alpha.links if alpha is not None else ()):
            tree.links.remove(link)
            changed = True
    return changed


def _linked_source(marker, input_name: str):
    socket = marker.inputs.get(input_name)
    if socket is None or not socket.is_linked:
        return None
    link = socket.links[0]
    return link.from_node, link.from_socket


def _constant_rgba(node, socket) -> tuple[float, float, float, float] | None:
    if node.bl_idname == "ShaderNodeRGB" and socket.type == "RGBA":
        value = tuple(float(item) for item in socket.default_value)
        return value if len(value) == 4 else None
    if node.bl_idname == "ShaderNodeValue" and socket.type == "VALUE":
        value = float(socket.default_value)
        return (value, value, value, 1.0)
    return None


_MATERIALIZED_FIELD_NODES = frozenset({
    "NodeGroupInput",
    "NodeReroute",
    "ShaderNodeAttribute",
    "ShaderNodeBlackbody",
    "ShaderNodeBrightContrast",
    "ShaderNodeClamp",
    "ShaderNodeCombineColor",
    "ShaderNodeCombineRGB",
    "ShaderNodeCombineXYZ",
    "ShaderNodeGamma",
    "ShaderNodeGroup",
    "ShaderNodeHueSaturation",
    "ShaderNodeInvert",
    "ShaderNodeMapRange",
    "ShaderNodeMapping",
    "ShaderNodeMath",
    "ShaderNodeMix",
    "ShaderNodeMixRGB",
    "ShaderNodeObjectInfo",
    "ShaderNodeRGB",
    "ShaderNodeSeparateColor",
    "ShaderNodeSeparateRGB",
    "ShaderNodeSeparateXYZ",
    "ShaderNodeTexBrick",
    "ShaderNodeTexChecker",
    "ShaderNodeTexCoord",
    "ShaderNodeTexGradient",
    "ShaderNodeTexImage",
    "ShaderNodeTexMagic",
    "ShaderNodeTexNoise",
    "ShaderNodeTexVoronoi",
    "ShaderNodeTexWave",
    "ShaderNodeTexWhiteNoise",
    "ShaderNodeUVMap",
    "ShaderNodeValToRGB",
    "ShaderNodeValue",
    "ShaderNodeVectorMath",
    "ShaderNodeVertexColor",
    "ShaderNodeWavelength",
})
_MATERIALIZED_VIEW_NODES = frozenset({
    "ShaderNodeCameraData",
    "ShaderNodeFresnel",
    "ShaderNodeLayerWeight",
    "ShaderNodeLightPath",
})
_MATERIALIZED_SCENE_NODES = frozenset({
    "ShaderNodeAmbientOcclusion",
})
_MATERIALIZED_VIEW_TEXCOORD_OUTPUTS = frozenset({
    "Camera", "Reflection", "Window",
})


def _selected_output_closure(source_node, source_socket):
    """Return the exact upstream dependency closure of one selected output.

    Group instances are followed through the matching active Group Output.
    Linked inputs on a group instance are included conservatively because a
    nested Group Input may feed the selected result. Downstream presentation
    nodes are never visited.
    """
    nodes = []
    outputs = {}
    seen = set()

    def visit(node, output_socket):
        identifier = str(
            getattr(output_socket, "identifier", "") or output_socket.name
        )
        key = (node.as_pointer(), identifier)
        if key in seen:
            return
        seen.add(key)
        if node.as_pointer() not in outputs:
            nodes.append(node)
            outputs[node.as_pointer()] = set()
        outputs[node.as_pointer()].add(str(output_socket.name))

        if node.bl_idname == "ShaderNodeGroup":
            nested = getattr(node, "node_tree", None)
            if nested is None:
                raise MaterialCompileError(
                    f'Selected node group "{node.name}" has no node tree.'
                )
            group_outputs = [
                item for item in nested.nodes
                if item.type == "GROUP_OUTPUT"
                and getattr(item, "is_active_output", True)
            ]
            targets = []
            for group_output in group_outputs:
                target = next((
                    item for item in group_output.inputs
                    if (
                        getattr(item, "identifier", None) == identifier
                        or item.name == output_socket.name
                    )
                ), None)
                if target is not None:
                    targets.append(target)
            if not targets:
                raise MaterialCompileError(
                    f'Selected output "{node.name} -> {output_socket.name}" '
                    "does not resolve through an active Group Output."
                )
            for target in targets:
                for link in target.links:
                    visit(link.from_node, link.from_socket)
            for input_socket in node.inputs:
                for link in input_socket.links:
                    visit(link.from_node, link.from_socket)
            return

        for input_socket in node.inputs:
            for link in input_socket.links:
                visit(link.from_node, link.from_socket)

    visit(source_node, source_socket)
    return tuple(nodes), {
        pointer: tuple(sorted(names))
        for pointer, names in outputs.items()
    }


def _material_fingerprint(material) -> str:
    digest = hashlib.sha256()
    bakelib._fingerprint_material(digest, material, set())
    return digest.hexdigest()


def _classify_materialized_source(
    material_name: str,
    node,
    socket,
    semantic: str,
):
    if semantic != "color":
        return None, MaterialIssue(
            "material.selected-alpha-materialization-unavailable", material_name,
            f'Web Alpha selects "{node.name} -> {socket.name}", which requires '
            "procedural materialization.",
            "The first selected-field bake is opaque. Select a direct Value/"
            "attribute alpha, or keep the website result explicitly opaque.",
        )
    if socket.type not in {"RGBA", "VALUE"}:
        return None, MaterialIssue(
            "material.selected-field-type-unsupported", material_name,
            f'Web Color selects "{node.name} -> {socket.name}" with '
            f"{socket.type or 'unknown'} data.",
            "Select a Color or Value output. Shader, vector, and closure outputs "
            "cannot become a portable glTF base-color texture.",
        )
    material = bpy.data.materials.get(material_name)
    if material is None:
        return None, MaterialIssue(
            "material.source-missing", material_name,
            "The selected source material disappeared during planning.",
            "Restore the material binding and run Preview again.",
        )
    try:
        nodes, used_outputs = _selected_output_closure(node, socket)
    except MaterialCompileError as error:
        return None, MaterialIssue(
            "material.selected-field-group-invalid", material_name,
            str(error),
            "Repair the selected node-group output or select a top-level Color/"
            "Value field.",
        )

    animated = []
    animated_ids = {material.as_pointer(): material}
    for dependency in nodes:
        owner = getattr(dependency, "id_data", None)
        if owner is not None:
            animated_ids[owner.as_pointer()] = owner
        image = getattr(dependency, "image", None)
        if image is not None:
            animated_ids[image.as_pointer()] = image
    for value in animated_ids.values():
        if procedural._animated_id(value):
            animated.append(str(getattr(value, "name", type(value).__name__)))
    if animated:
        return None, MaterialIssue(
            "material.selected-field-animated", material_name,
            "The selected field depends on animated or driven data: "
            + ", ".join(sorted(animated, key=str.casefold)),
            "Remove that animation, choose one intentional static field, or "
            "publish the changing result through website runtime state.",
        )

    for dependency in nodes:
        node_type = dependency.bl_idname
        if node_type == "ShaderNodeShaderToRGB":
            return None, MaterialIssue(
                "material.selected-field-eevee-only", material_name,
                f'Selected field reaches EEVEE-only Shader to RGB '
                f'"{dependency.name}".',
                "Select an upstream intrinsic Color/Value field. Blendlink will "
                "not claim a Cycles bake can reproduce Shader to RGB.",
            )
        if node_type in _MATERIALIZED_VIEW_NODES:
            return None, MaterialIssue(
                "material.selected-field-view-dependent", material_name,
                f'Selected field reaches view/ray-dependent "{dependency.name}" '
                f"({dependency.bl_label or node_type}).",
                "Select an intrinsic field that remains valid as the website "
                "camera moves, or keep this material application-owned.",
            )
        if node_type in _MATERIALIZED_SCENE_NODES:
            return None, MaterialIssue(
                "material.selected-field-scene-dependent", material_name,
                f'Selected field reaches scene-dependent "{dependency.name}" '
                f"({dependency.bl_label or node_type}).",
                "Select the intrinsic material field before AO, lights, or "
                "shadows. Those belong to the website lighting path.",
            )
        if node_type == "ShaderNodeTexCoord":
            external_object = getattr(dependency, "object", None)
            if external_object is not None:
                return None, MaterialIssue(
                    "material.selected-field-external-object", material_name,
                    f'Texture Coordinate "{dependency.name}" reads explicit '
                    f'object "{external_object.name}", whose evaluated transform '
                    "is outside this first materialization plan.",
                    "Clear the Object field to use the material receiver's own "
                    "coordinates, or keep this field application-owned until "
                    "Blendlink can fingerprint external shader dependencies.",
                )
            view_outputs = sorted(
                set(used_outputs.get(dependency.as_pointer(), ()))
                & _MATERIALIZED_VIEW_TEXCOORD_OUTPUTS
            )
            if view_outputs:
                return None, MaterialIssue(
                    "material.selected-field-view-dependent", material_name,
                    f'Texture Coordinate "{dependency.name}" contributes '
                    + ", ".join(view_outputs)
                    + " coordinates to the selected field.",
                    "Use UV, Generated, Object, or Normal coordinates for a "
                    "reusable surface texture.",
                )
        if node_type == "ShaderNodeTexImage":
            image = getattr(dependency, "image", None)
            source = str(getattr(image, "source", "") or "")
            if image is None or source not in {"FILE", "GENERATED"}:
                return None, MaterialIssue(
                    "material.selected-field-image-unsupported", material_name,
                    f'Image Texture "{dependency.name}" uses '
                    f"{source or 'missing'} image data.",
                    "Use a static FILE or Generated image. Movie, sequence, tiled, "
                    "and viewer images need an explicit time/tile contract.",
                )
            if bool(getattr(image, "is_dirty", False)):
                return None, MaterialIssue(
                    "material.selected-field-image-dirty", material_name,
                    f'Image "{image.name}" has unsaved pixel edits, so its '
                    "selected-field bake input is ambiguous.",
                    "Save or pack the edited image before publishing.",
                )
            if source == "FILE":
                payload, payload_source = _image_payload(image)
                if payload is None:
                    return None, MaterialIssue(
                        "material.selected-field-image-bytes-unavailable",
                        material_name,
                        f'Image "{image.name}" cannot be evaluated because '
                        f"{payload_source}.",
                        "Pack the image into the .blend or restore its external "
                        "file before publishing.",
                    )
            else:
                size = tuple(
                    int(value) for value in getattr(image, "size", (0, 0))
                )
                if len(size) != 2 or min(size) <= 0:
                    return None, MaterialIssue(
                        "material.selected-field-image-invalid", material_name,
                        f'Generated image "{image.name}" has invalid size {size}.',
                        "Regenerate the image with non-zero dimensions before "
                        "publishing.",
                    )
        if node_type not in _MATERIALIZED_FIELD_NODES:
            return None, MaterialIssue(
                "material.selected-field-node-unsupported", material_name,
                f'Selected field reaches unproved node "{dependency.name}" '
                f"({dependency.bl_label or node_type}).",
                "Select an upstream intrinsic Color/Value field or wait for a "
                "test-validated materialization rule for this node.",
            )

    dependencies = tuple(sorted({
        dependency.bl_idname for dependency in nodes
    }))
    return FieldSource(
        "materialized",
        node.name,
        socket.identifier,
        socket.name,
        material_hash=_material_fingerprint(material),
        materialization="cyclesEmit",
        dependency_nodes=dependencies,
    ), None


def _encoded_image_info(payload: bytes):
    """Return the exact web MIME and dimensions without decoding pixels."""
    if payload.startswith(b"\x89PNG\r\n\x1a\n") and len(payload) >= 24 \
            and payload[12:16] == b"IHDR":
        width, height = struct.unpack(">II", payload[16:24])
        if width > 0 and height > 0:
            return "image/png", width, height
        return None
    if not payload.startswith(b"\xff\xd8"):
        return None
    # ISO/IEC 10918 marker walk. Dimensions live in a Start Of Frame segment;
    # entropy data begins at SOS and must never be interpreted as markers.
    sof_markers = {
        0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
        0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
    }
    offset = 2
    while offset + 1 < len(payload):
        if payload[offset] != 0xFF:
            offset += 1
            continue
        while offset < len(payload) and payload[offset] == 0xFF:
            offset += 1
        if offset >= len(payload):
            break
        marker = payload[offset]
        offset += 1
        if marker == 0xDA:  # Start Of Scan.
            break
        if marker in {0x01, 0xD8, 0xD9} or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(payload):
            break
        segment_length = struct.unpack_from(">H", payload, offset)[0]
        if segment_length < 2 or offset + segment_length > len(payload):
            break
        if marker in sof_markers and segment_length >= 7:
            height, width = struct.unpack_from(">HH", payload, offset + 3)
            if width > 0 and height > 0:
                return "image/jpeg", width, height
            return None
        offset += segment_length
    return None


def _image_payload(image):
    packed = getattr(image, "packed_file", None)
    if packed is not None:
        try:
            return bytes(packed.data), "packed image"
        except (AttributeError, BufferError, RuntimeError, TypeError, ValueError) as error:
            return None, f"its packed bytes cannot be read ({error})"
    try:
        path = image.filepath_from_user()
    except (AttributeError, RuntimeError, TypeError, ValueError):
        path = bpy.path.abspath(str(getattr(image, "filepath_raw", "") or ""))
    path = os.path.abspath(path) if path else ""
    if not path or not os.path.isfile(path):
        return None, f"its external file {path or '<empty>'!r} does not exist"
    try:
        with open(path, "rb") as handle:
            return handle.read(), path
    except OSError as error:
        return None, f"its external file {path!r} cannot be read ({error})"


def _classify_image_source(material_name: str, node, socket, semantic: str):
    if semantic != "color" or socket.name != "Color":
        return None, MaterialIssue(
            "material.image-alpha-unsupported", material_name,
            f'Web {semantic.title()} selects "{node.name} -> {socket.name}", but '
            "this direct image route is opaque and accepts only the Color output.",
            "Select the Image Texture Color output for Web Color and leave Web Alpha "
            "unconnected until image-alpha transport is available.",
        )
    image = getattr(node, "image", None)
    if image is None:
        return None, MaterialIssue(
            "material.image-missing", material_name,
            f'Image Texture "{node.name}" has no image.',
            "Assign a static PNG or JPEG before selecting its Color output.",
        )
    if getattr(node, "mute", False):
        return None, MaterialIssue(
            "material.image-muted", material_name,
            f'Image Texture "{node.name}" is muted, so its selected field is not stable.',
            "Unmute the Image Texture or select another direct field.",
        )
    if getattr(image, "source", None) != "FILE":
        return None, MaterialIssue(
            "material.image-source-unsupported", material_name,
            f'Image "{image.name}" uses {getattr(image, "source", "unknown")} source data.',
            "Use one static FILE image; generated, tiled, sequence, and movie sources "
            "must be materialized before publishing.",
        )
    if bool(getattr(image, "is_dirty", False)):
        return None, MaterialIssue(
            "material.image-dirty", material_name,
            f'Image "{image.name}" has unsaved pixel edits.',
            "Save or pack the edited image, then reload it before publishing so the "
            "selected bytes are unambiguous.",
        )
    tree = getattr(node, "id_data", None)
    if (tree is not None and procedural._animated_id(tree)) \
            or procedural._animated_id(image):
        return None, MaterialIssue(
            "material.image-animated", material_name,
            f'Image Texture "{node.name}" or its image has animation or drivers.',
            "Remove the animation or materialize one intentional still image before publishing.",
        )
    colorspace = str(getattr(getattr(image, "colorspace_settings", None), "name", ""))
    if colorspace != "sRGB":
        return None, MaterialIssue(
            "material.image-colorspace-unsupported", material_name,
            f'Image "{image.name}" is tagged {colorspace or "unknown"!r}, not sRGB.',
            "For Web Color, tag a color image sRGB. Non-Color/data textures cannot be "
            "relabelled as glTF base color without changing their meaning.",
        )
    alpha_mode = str(getattr(image, "alpha_mode", ""))
    if alpha_mode != "STRAIGHT":
        return None, MaterialIssue(
            "material.image-alpha-mode-unsupported", material_name,
            f'Image "{image.name}" uses {alpha_mode or "unknown"!r} alpha interpretation.',
            "Use Straight alpha for this opaque direct route, or materialize the intended color first.",
        )
    interpolation = str(getattr(node, "interpolation", ""))
    extension = str(getattr(node, "extension", ""))
    projection = str(getattr(node, "projection", ""))
    if interpolation != "Linear" or extension != "REPEAT" or projection != "FLAT":
        return None, MaterialIssue(
            "material.image-sampling-unsupported", material_name,
            f'Image Texture "{node.name}" uses {projection or "unknown"} projection, '
            f'{interpolation or "unknown"} interpolation, and {extension or "unknown"} extension.',
            "Use Flat projection, Linear interpolation, and Repeat extension for the "
            "first exact image route; materialize other sampling behavior explicitly.",
        )
    vector = node.inputs.get("Vector")
    uv_mode = "activeRender"
    uv_name = None
    if vector is not None and vector.is_linked:
        link = vector.links[0]
        uv_node = link.from_node
        if uv_node.bl_idname != "ShaderNodeUVMap" or link.from_socket.name != "UV":
            return None, MaterialIssue(
                "material.image-coordinates-unsupported", material_name,
                f'Image Texture "{node.name}" receives coordinates from '
                f'"{uv_node.name} -> {link.from_socket.name}".',
                "Connect one UV Map node directly, or leave Vector unconnected to use "
                "the active render UV. Mapping, Generated, Object, and procedural "
                "coordinates must be materialized first.",
            )
        uv_name = str(getattr(uv_node, "uv_map", "") or "")
        if not uv_name:
            return None, MaterialIssue(
                "material.image-uv-name-missing", material_name,
                f'UV Map node "{uv_node.name}" does not name a UV layer.',
                "Choose a named UV layer or disconnect Vector to use the active render UV.",
            )
        uv_mode = "named"
    payload, payload_source = _image_payload(image)
    if payload is None:
        return None, MaterialIssue(
            "material.image-bytes-unavailable", material_name,
            f'Image "{image.name}" cannot publish exact bytes because {payload_source}.',
            "Pack the image into the .blend or restore its external file before publishing.",
        )
    encoded = _encoded_image_info(payload)
    if encoded is None:
        return None, MaterialIssue(
            "material.image-format-unsupported", material_name,
            f'Image "{image.name}" is not an intact PNG or JPEG byte stream.',
            "Save or pack this color image as PNG/JPEG. Other formats require an "
            "explicit conversion route that can be attested.",
        )
    mime, width, height = encoded
    reported_size = tuple(int(value) for value in getattr(image, "size", (0, 0)))
    if reported_size != (width, height):
        return None, MaterialIssue(
            "material.image-dimensions-mismatch", material_name,
            f'Image "{image.name}" reports {reported_size}, but its selected bytes encode '
            f"{width}x{height}.",
            "Reload the image (or pack the intended file) before publishing.",
        )
    return FieldSource(
        "image", node.name, socket.identifier, socket.name,
        image_name=image.name,
        image_hash=hashlib.sha256(payload).hexdigest(),
        image_mime=mime,
        image_width=width,
        image_height=height,
        interpolation=interpolation,
        extension=extension,
        projection=projection,
        uv_mode=uv_mode,
        uv_name=uv_name,
    ), None


def _classify_source(material_name: str, linked, semantic: str):
    if linked is None:
        return None, None
    node, socket = linked
    if node.bl_idname == "ShaderNodeTexImage":
        return _classify_image_source(material_name, node, socket, semantic)
    constant = _constant_rgba(node, socket)
    if constant is not None:
        if semantic == "alpha" and socket.type != "VALUE":
            return None, MaterialIssue(
                "material.source-conversion-unsupported", material_name,
                f'Web Alpha selects the color output "{node.name} -> {socket.name}". '
                "Blendlink will not guess which color channel represents alpha.",
                "Select a Value output, or select the Alpha output of the same color attribute.",
            )
        if semantic == "alpha":
            scalar = constant[0]
            constant = (scalar, scalar, scalar, scalar)
        else:
            # Website Alpha owns coverage. Never leak an incidental RGBA
            # constant alpha through the separate Website Color contract.
            constant = (constant[0], constant[1], constant[2], 1.0)
        if any(not (0.0 <= value <= 1.0) for value in constant):
            return None, MaterialIssue(
                "material.source-range-unsupported", material_name,
                f'Web {semantic.title()} from "{node.name}" contains values outside 0..1.',
                "Clamp or map the selected field to 0..1 before publishing it.",
            )
        return FieldSource(
            "constant", node.name, socket.identifier, socket.name, value=constant,
        ), None
    expected_socket = "Color" if semantic == "color" else "Alpha"
    if node.bl_idname == "ShaderNodeVertexColor" and socket.name in {"Color", "Alpha"}:
        if socket.name != expected_socket:
            return None, MaterialIssue(
                "material.source-conversion-unsupported", material_name,
                f'Web {semantic.title()} selects "{node.name} -> {socket.name}", '
                f"but the direct route requires its {expected_socket} output.",
                f"Select {expected_socket}, or materialize the conversion explicitly before publishing.",
            )
        return FieldSource(
            "vertexColor", node.name, socket.identifier, socket.name,
            attribute_name=str(getattr(node, "layer_name", "") or ""),
        ), None
    if (node.bl_idname == "ShaderNodeAttribute"
            and getattr(node, "attribute_type", "GEOMETRY") == "GEOMETRY"
            and socket.name in {"Color", "Alpha", "Fac"}):
        if socket.name != expected_socket:
            return None, MaterialIssue(
                "material.source-conversion-unsupported", material_name,
                f'Web {semantic.title()} selects "{node.name} -> {socket.name}", '
                f"but the direct route requires its {expected_socket} output.",
                f"Select {expected_socket}, or materialize the conversion explicitly before publishing.",
            )
        return FieldSource(
            "vertexColor", node.name, socket.identifier, socket.name,
            attribute_name=str(getattr(node, "attribute_name", "") or ""),
        ), None
    return _classify_materialized_source(
        material_name, node, socket, semantic,
    )


def _requires_alpha(material) -> bool:
    tree = _active_tree(material)
    if tree is None:
        return float(getattr(material, "diffuse_color", (1, 1, 1, 1))[3]) < 0.9999
    for node in procedural.reachable_surface_nodes(tree):
        if node.bl_idname in {"ShaderNodeBsdfTransparent", "ShaderNodeHoldout"}:
            return True
        if node.bl_idname == "ShaderNodeBsdfPrincipled":
            alpha = node.inputs.get("Alpha")
            if alpha is not None:
                if not alpha.is_linked:
                    if float(alpha.default_value) < 0.9999:
                        return True
                else:
                    linked = alpha.links[0].from_node, alpha.links[0].from_socket
                    constant = _constant_rgba(*linked)
                    if constant is None or linked[1].type != "VALUE" \
                            or constant[0] < 0.9999:
                        return True
    # For node materials, the active Surface graph owns coverage. The viewport
    # diffuse alpha is legacy display metadata and must not create a false
    # publishing dependency when the reachable graph is opaque.
    return False


def _attribute_descriptor(obj, requested_name: str | None, slot_index: int | None = None):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = None
    try:
        try:
            mesh = evaluated.to_mesh(
                preserve_all_data_layers=True,
                depsgraph=bpy.context.evaluated_depsgraph_get(),
            )
        except TypeError:
            mesh = evaluated.to_mesh()
        attributes = getattr(mesh, "color_attributes", None)
        if attributes is None:
            return None
        if requested_name:
            attribute = attributes.get(requested_name)
        else:
            index = int(getattr(attributes, "render_color_index", -1))
            attribute = attributes[index] if 0 <= index < len(attributes) else None
            if attribute is None:
                attribute = getattr(attributes, "active_color", None)
        if attribute is None or attribute.domain not in {"POINT", "CORNER"} \
                or attribute.data_type not in {"FLOAT_COLOR", "BYTE_COLOR"}:
            return None
        polygons = [
            polygon for polygon in mesh.polygons
            if slot_index is None or int(polygon.material_index) == slot_index
        ]
        if attribute.domain == "CORNER":
            used_indices = {
                loop_index
                for polygon in polygons
                for loop_index in polygon.loop_indices
            }
        else:
            used_indices = {
                vertex_index
                for polygon in polygons
                for vertex_index in polygon.vertices
            }
        if not used_indices:
            used_indices = set(range(len(attribute.data)))
        colors = [
            tuple(float(component) for component in attribute.data[index].color)
            for index in sorted(used_indices)
            if 0 <= index < len(attribute.data)
        ]
        if not colors or any(
            len(color) != 4 or any(not math.isfinite(component) for component in color)
            for color in colors
        ):
            return None
        value_hash = hashlib.sha256()
        for color in colors:
            value_hash.update(struct.pack("<4d", *color))
        return {
            "name": attribute.name,
            "domain": attribute.domain,
            "type": attribute.data_type,
            "values": len(attribute.data),
            "min": tuple(min(color[index] for color in colors) for index in range(4)),
            "max": tuple(max(color[index] for color in colors) for index in range(4)),
            "hash": value_hash.hexdigest(),
            "alphaMode": (
                "OPAQUE"
                if all(abs(color[3] - 1.0) <= 1e-6 for color in colors)
                else "MASK"
                if all(
                    abs(color[3]) <= 1e-6
                    or abs(color[3] - 1.0) <= 1e-6
                    for color in colors
                )
                else "BLEND"
            ),
        }
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()


def _float32(value: float) -> float:
    rounded = struct.unpack("<f", struct.pack("<f", float(value)))[0]
    # Equality collapses signed zero in sets, so normalize its byte-level
    # representation on both sides of the compiler evidence contract.
    return 0.0 if rounded == 0.0 else rounded


def _uv_summary(values) -> dict | None:
    distinct = tuple(sorted({
        (_float32(value[0]), _float32(value[1])) for value in values
    }))
    if not distinct or any(
        not math.isfinite(component) for value in distinct for component in value
    ):
        return None
    digest = hashlib.sha256()
    for value in distinct:
        digest.update(struct.pack("<2f", *value))
    return {
        "values": distinct,
        "distinct": len(distinct),
        "min": tuple(min(value[index] for value in distinct) for index in range(2)),
        "max": tuple(max(value[index] for value in distinct) for index in range(2)),
        "hash": digest.hexdigest(),
    }


def _uv_descriptor(obj, source: FieldSource, slot_index: int):
    """Resolve the exact evaluated UV field Blender's exporter will gather."""
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = None
    try:
        try:
            mesh = evaluated.to_mesh(
                preserve_all_data_layers=True,
                depsgraph=bpy.context.evaluated_depsgraph_get(),
            )
        except TypeError:
            mesh = evaluated.to_mesh()
        layers = getattr(mesh, "uv_layers", None)
        if layers is None or len(layers) == 0:
            return None, "the evaluated mesh has no UV layers"
        if source.uv_mode == "named":
            layer_index = int(layers.find(source.uv_name or ""))
            if layer_index < 0:
                return None, f"named UV layer {source.uv_name!r} is absent after evaluation"
        else:
            render_indices = [
                index for index, layer in enumerate(layers)
                if bool(getattr(layer, "active_render", False))
            ]
            if len(render_indices) != 1:
                return None, (
                    "the evaluated mesh does not resolve exactly one active render UV "
                    f"layer (found {len(render_indices)})"
                )
            layer_index = render_indices[0]
        layer = layers[layer_index]
        polygons = [
            polygon for polygon in mesh.polygons
            if int(polygon.material_index) == slot_index
        ]
        if not polygons:
            return None, f"material slot {slot_index} owns no evaluated faces"
        loop_indices = sorted({
            int(loop_index)
            for polygon in polygons
            for loop_index in polygon.loop_indices
        })
        values = []
        for loop_index in loop_indices:
            if not (0 <= loop_index < len(layer.data)):
                return None, f"UV loop {loop_index} is outside layer {layer.name!r}"
            uv = tuple(float(component) for component in layer.data[loop_index].uv)
            if len(uv) != 2 or any(not math.isfinite(component) for component in uv):
                return None, f"UV layer {layer.name!r} contains malformed or non-finite values"
            # glTF's texture-coordinate convention has the opposite V axis to
            # Blender. This is the transform performed by the stock exporter.
            values.append((uv[0], 1.0 - uv[1]))
        summary = _uv_summary(values)
        if summary is None:
            return None, f"UV layer {layer.name!r} contains no finite used coordinates"
        return {
            "name": layer.name,
            "index": layer_index,
            **summary,
        }, None
    except (AttributeError, ReferenceError, RuntimeError, TypeError, ValueError) as error:
        return None, f"the evaluated UV field cannot be inspected ({error})"
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()


def _binding_map(objects) -> dict:
    bindings = {}

    def add(material, obj, slot_index, issue=None):
        entry = bindings.setdefault(material.as_pointer(), {
            "material": material,
            "bindings": [],
            "issues": [],
        })
        if not any(
            bound_obj == obj and bound_slot == slot_index
            for bound_obj, bound_slot in entry["bindings"]
        ):
            entry["bindings"].append((obj, slot_index))
        if issue is not None and issue not in entry["issues"]:
            entry["issues"].append(issue)

    for obj in sorted(objects, key=lambda item: item.name.casefold()):
        if getattr(obj, "hide_render", False):
            continue
        slots = tuple(getattr(obj, "material_slots", ()))
        if getattr(obj, "type", None) != "MESH":
            raw_selected_materials = set()
            for slot_index, slot in enumerate(slots):
                material = slot.material
                if material is None:
                    continue
                issue = None
                if marker_nodes(material):
                    raw_selected_materials.add(material.as_pointer())
                    issue = MaterialIssue(
                        "material.binding-type-unsupported", material.name,
                        f'Object "{obj.name}" is {obj.type}; the direct material compiler '
                        "currently installs export-only bindings on Mesh objects only.",
                        "Convert this renderable object to a Mesh for export, or clear its Website Color selection.",
                        (obj.name,),
                    )
                add(material, obj, slot_index, issue)
            has_geometry_nodes = any(
                getattr(modifier, "type", None) == "NODES"
                for modifier in getattr(obj, "modifiers", ())
            )
            if has_geometry_nodes:
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                mesh = None
                try:
                    mesh = evaluated.to_mesh()
                    for evaluated_index, evaluated_material in enumerate(mesh.materials):
                        source_material = (
                            getattr(evaluated_material, "original", None)
                            if evaluated_material is not None else None
                        ) or evaluated_material
                        if source_material is None or not marker_nodes(source_material) \
                                or source_material.as_pointer() in raw_selected_materials:
                            continue
                        issue = MaterialIssue(
                            "material.evaluated-binding-unsupported", source_material.name,
                            f'Object "{obj.name}" is {obj.type} and creates selected Website '
                            f'Material "{source_material.name}" through evaluated Geometry Nodes. '
                            "No editable source Mesh slot owns that binding.",
                            "Convert/apply the evaluated result to a Mesh before publishing, "
                            "or clear its Website Color selection.",
                            (obj.name,),
                        )
                        add(source_material, obj, evaluated_index, issue)
                except (AttributeError, RuntimeError, TypeError) as error:
                    raise MaterialCompileError(
                        f'Cannot inspect evaluated Geometry Nodes materials for "{obj.name}": {error}'
                    ) from error
                finally:
                    if mesh is not None:
                        evaluated.to_mesh_clear()
            continue

        try:
            material_uses = procedural.evaluated_material_uses(obj)
        except procedural.EvaluatedMaterialUseError as error:
            raise MaterialCompileError(str(error)) from error
        for use in material_uses:
            material = use.material
            if material is None:
                continue
            if use.source_slot_index is not None:
                add(material, obj, use.source_slot_index)
                continue
            if not marker_nodes(material):
                # Automatic materials are not mutated. Keep the evaluated index
                # as plan evidence even when a modifier generated/reordered the
                # binding; artist-selected lowerings take the loud path below.
                add(material, obj, use.evaluated_slot_index)
                continue
            issue = MaterialIssue(
                "material.evaluated-binding-unsupported", material.name,
                f'Object "{obj.name}" assigns selected Website Material '
                f'"{material.name}" through evaluated geometry at slot '
                f"{use.evaluated_slot_index}; no identical source Mesh slot "
                "owns that binding.",
                "Apply or realize the material assignment into the source Mesh "
                "before publishing.",
                (obj.name,),
            )
            for source_index in (
                    use.source_candidate_indices
                    or (use.evaluated_slot_index,)):
                add(material, obj, source_index, issue)
    for entry in bindings.values():
        entry["bindings"].sort(key=lambda item: (item[0].name.casefold(), item[1]))
    return bindings


# Modifiers a rest-basis UV-space channel bake is independent of:
# pure deformers move positions but never touch topology or UV layouts,
# SUBSURF refines topology while interpolating the authored UVs, and the
# data-only kinds edit weights/normals/masks. Topology GENERATORS
# (Mirror/Array/Solidify/Skin/Screw), particles, and UV-mutating
# modifiers (UVProject/UVWarp) stay refused by name — their evaluated
# UV layout diverges from the packed base layer.
_DEFORMING_MODIFIERS = frozenset({
    "ARMATURE", "SUBSURF", "LATTICE", "CORRECTIVE_SMOOTH", "SHRINKWRAP",
    "SURFACE_DEFORM", "CURVE", "SMOOTH", "LAPLACIANSMOOTH",
    "LAPLACIANDEFORM", "SIMPLE_DEFORM", "CAST", "HOOK", "WARP", "WAVE",
    "MESH_DEFORM", "VERTEX_WEIGHT_MIX", "VERTEX_WEIGHT_EDIT",
    "VERTEX_WEIGHT_PROXIMITY", "MASK", "NORMAL_EDIT", "DATA_TRANSFER",
    "WEIGHTED_NORMAL",
})


def _deforming_receiver(obj) -> bool:
    """A binding the deforming-receiver relaxation applies to: its
    modifiers are all pose/topology-refinement (Armature/Subdivision) and
    its UV-space channel bakes stay valid across poses."""
    modifiers = list(getattr(obj, "modifiers", ()) or ())
    if any(modifier.type not in _DEFORMING_MODIFIERS for modifier in modifiers):
        return False
    if modifiers:
        return True
    return bool(
        procedural._animated_id(obj)
        or procedural._animated_id(getattr(obj, "data", None))
    )


def _materialized_binding_hash(obj, *, rest_basis: bool = False) -> str:
    digest = hashlib.sha256()
    if rest_basis:
        # Deforming receivers: the evaluated depsgraph contributor is
        # pose/frame-dependent, so variant identity fingerprints the BASE
        # datablock the private bake copy derives from — the UV layout and
        # topology the UV-space channel bake actually depends on.
        mesh = obj.data
        digest.update(str(mesh.name).encode("utf8"))
        digest.update(str(len(mesh.vertices)).encode("utf8"))
        digest.update(str(len(mesh.polygons)).encode("utf8"))
        digest.update(str(len(mesh.loops)).encode("utf8"))
        for modifier in obj.modifiers:
            digest.update(f"{modifier.type}:{modifier.name}".encode("utf8"))
        from array import array
        for layer in mesh.uv_layers:
            digest.update(str(layer.name).encode("utf8"))
            buffer = array("f", bytes(8 * len(mesh.loops)))
            layer.data.foreach_get("uv", buffer)
            digest.update(buffer.tobytes())
        return digest.hexdigest()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bakelib._fingerprint_object_contributor(
        digest,
        obj,
        depsgraph,
        set(),
        include_atlas=True,
    )
    return digest.hexdigest()


def _materialized_binding_issues(
    material, raw_bindings, *,
    deforming_receivers: bool = False,
    slot_scoped: bool = False,
) -> list[MaterialIssue]:
    """Shared per-binding constraints for baked receivers.

    deforming_receivers is the per-channel Material bake's relaxation
    (user-approved 2026-07-28): UV-space channel bakes are valid across
    poses, so Armature/Subdivision modifiers, animated transforms, and rig
    constraints stop refusing THERE — variant identity switches to the
    rest-basis fingerprint. The selected-field materialization route keeps
    every constraint: it mutates and freezes the receiver."""
    object_names = tuple(sorted({
        obj.name for obj, _slot in raw_bindings
    }))
    if len(raw_bindings) != 1:
        return [MaterialIssue(
            "material.selected-field-binding-count", material.name,
            f"The first selected-field bake needs one object/material binding; "
            f'"{material.name}" is used by {len(raw_bindings)} bindings.',
            "Make the selected material unique to one static object for now, or "
            "use a direct constant/image/vertex-color field. Shared native-object "
            "atlas support will be added only with per-binding context tests.",
            object_names,
        )]
    obj, slot_index = raw_bindings[0]
    issues = []
    if not slot_scoped and (len(obj.material_slots) != 1 or slot_index != 0):
        # The per-channel Material bake is slot-scoped (split-receiver
        # bakes, user-approved 2026-07-28); the selected-field
        # materialization route still requires whole-mesh ownership.
        issues.append(MaterialIssue(
            "material.selected-field-slot-ownership", material.name,
            f'Object "{obj.name}" has {len(obj.material_slots)} material slots; '
            "the first selected-field bake requires one slot owning the complete mesh.",
            "Split this material receiver into one static one-material object, or "
            "use a direct portable field.",
            (obj.name,),
        ))
    polygons = getattr(obj.data, "polygons", None)
    if polygons is None:
        # Non-mesh receivers (Curve/Text) previously crashed here instead
        # of refusing by name.
        issues.append(MaterialIssue(
            "material.selected-field-binding-type", material.name,
            f'Object "{obj.name}" is not a mesh receiver.',
            "Convert the receiver to a mesh or use a direct portable field.",
            (obj.name,),
        ))
        return issues
    if slot_scoped:
        # Slot-scoped bakes need the slot to own at least one face; other
        # slots' faces bake through their own materials.
        if not any(
            int(polygon.material_index) == slot_index for polygon in polygons
        ):
            issues.append(MaterialIssue(
                "material.selected-field-face-ownership", material.name,
                f'Object "{obj.name}" gives slot {slot_index} no faces to bake.',
                "Assign faces to the material slot or remove the unused slot.",
                (obj.name,),
            ))
    elif len(polygons) == 0 or any(
        int(polygon.material_index) != slot_index
        for polygon in polygons
    ):
        issues.append(MaterialIssue(
            "material.selected-field-face-ownership", material.name,
            f'Object "{obj.name}" does not give the selected slot every source face.',
            "Use one complete one-material mesh for this first materialization "
            "route. Blendlink will not bake unrelated slots into the same texture.",
            (obj.name,),
        ))
    modifiers = [
        modifier.name for modifier in obj.modifiers
        if not (deforming_receivers and modifier.type in _DEFORMING_MODIFIERS)
    ]
    if modifiers:
        issues.append(MaterialIssue(
            "material.selected-field-modifiers-unsupported", material.name,
            f'Object "{obj.name}" has unapplied modifier(s): '
            + ", ".join(modifiers),
            "Apply the modifiers or use a direct field. A later evaluated-mesh "
            "transaction will support topology-changing modifiers without touching "
            "the artist source.",
            (obj.name,),
        ))
    if getattr(obj.data, "shape_keys", None) is not None \
            and not deforming_receivers:
        # Shape keys are deformation (facial blend shapes): the rest-basis
        # UV-space bake is independent of them, so the bake intent passes;
        # the freezing materialization route still refuses.
        issues.append(MaterialIssue(
            "material.selected-field-shape-keys-unsupported", material.name,
            f'Object "{obj.name}" has shape keys.',
            "Use a direct portable material field, or apply/copy the intended "
            "static shape before selecting a baked Website Color.",
            (obj.name,),
        ))
    animated = [
        label for label, value in (
            ("object", obj),
            ("mesh", obj.data),
        )
        if procedural._animated_id(value)
    ]
    if deforming_receivers:
        # Object-level animation is pose — UV-space bakes hold. Animated
        # MESH data can drive the UV layout itself, so it stays refused.
        animated = [label for label in animated if label != "object"]
    if animated:
        issues.append(MaterialIssue(
            "material.selected-field-binding-animated", material.name,
            f'Object "{obj.name}" has animated or driven '
            + " and ".join(animated)
            + " data.",
            "Use a direct portable field for changing geometry, or publish one "
            "intentional static receiver.",
            (obj.name,),
        ))
    if (
        len(obj.constraints) > 0 and not deforming_receivers
    ) or getattr(obj, "instance_type", "NONE") != "NONE":
        issues.append(MaterialIssue(
            "material.selected-field-context-unsupported", material.name,
            f'Object "{obj.name}" uses constraints or instancing that can change '
            "its material evaluation context.",
            "Apply/realize one intentional static receiver before selecting this "
            "field for materialization.",
            (obj.name,),
        ))
    return issues


_LIT_SURFACE_NODES = frozenset({
    "ShaderNodeBsdfAnisotropic",
    "ShaderNodeBsdfDiffuse",
    "ShaderNodeBsdfGlass",
    "ShaderNodeBsdfGlossy",
    "ShaderNodeBsdfHair",
    "ShaderNodeBsdfHairPrincipled",
    "ShaderNodeBsdfPrincipled",
    "ShaderNodeBsdfRefraction",
    "ShaderNodeBsdfSheen",
    "ShaderNodeBsdfToon",
    "ShaderNodeBsdfTranslucent",
    "ShaderNodeEeveeSpecular",
    "ShaderNodeSubsurfaceScattering",
})
_UNLIT_SURFACE_NODES = frozenset({
    "ShaderNodeBackground",
    "ShaderNodeEmission",
})
_PORTABLE_SELECTED_FIELD_BSDF_NODES = frozenset({
    "ShaderNodeBsdfDiffuse",
    "ShaderNodeBsdfPrincipled",
})
_EEVEE_RESPONSE_NODES = frozenset({
    "ShaderNodeAmbientOcclusion",
    "ShaderNodeShaderToRGB",
})


def _matching_socket(sockets, reference):
    identifier = str(getattr(reference, "identifier", "") or "")
    if identifier:
        matched = next((
            socket for socket in sockets
            if str(getattr(socket, "identifier", "") or "") == identifier
        ), None)
        if matched is not None:
            return matched
    return next((
        socket for socket in sockets
        if socket.name == reference.name
    ), None)


def _single_input_source(input_socket):
    links = tuple(input_socket.links)
    if len(links) != 1:
        return None
    return links[0].from_node, links[0].from_socket


def _socket_targets(output_socket):
    return {
        (
            link.to_node.as_pointer(),
            str(getattr(link.to_socket, "identifier", "")
                or link.to_socket.name),
        )
        for link in output_socket.links
    }


def _target_key(input_socket):
    return (
        input_socket.node.as_pointer(),
        str(getattr(input_socket, "identifier", "") or input_socket.name),
    )


def _group_constant_input(group, group_input, target_input, size: int):
    """Resolve one literal operation input or one unlinked group-instance input."""
    links = tuple(target_input.links)
    if not links:
        value = target_input.default_value
    elif len(links) == 1 and links[0].from_node == group_input:
        external = _matching_socket(group.inputs, links[0].from_socket)
        if external is None or external.is_linked:
            return None
        value = external.default_value
    else:
        return None
    try:
        result = (
            (float(value),)
            if size == 1 else tuple(float(item) for item in value)
        )
    except (TypeError, ValueError):
        return None
    if len(result) != size or any(not math.isfinite(item) for item in result):
        return None
    return result


def _recognize_static_shade_floor(material, color_link):
    """Recognize one exact, name-agnostic Eevee response factorization.

    Accepted source topology:

      selected I -> group input
      d = ColorRamp(ShaderToRGB(Diffuse))
      shaded = I * (d + staticShadeColor)
      result = mix(I, shaded, staticShadeValue)
      result -> Emission -> active Surface

    No post-processing or alternative closure is accepted. The selected field
    remains artist-owned. Only the static floor is exact; the dynamic ``d``
    term is deliberately lowered to ordinary stock-glTF PBR.
    """
    if color_link is None:
        return None
    tree = _active_tree(material)
    if tree is None or procedural._animated_id(material) \
            or procedural._animated_id(tree):
        return None
    source_node, source_socket = color_link
    source_links = tuple(
        link for link in source_socket.links
        if link.to_node.get(MARKER_NODE_PROPERTY) is None
    )
    if len(source_links) != 1:
        return None
    source_link = source_links[0]
    group = source_link.to_node
    group_tree = getattr(group, "node_tree", None)
    if group.bl_idname != "ShaderNodeGroup" or group_tree is None \
            or bool(getattr(group, "mute", False)) \
            or procedural._animated_id(group_tree):
        return None

    active_outputs = [
        node for node in tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
        and getattr(node, "is_active_output", True)
    ]
    if len(active_outputs) != 1:
        return None
    output = active_outputs[0]
    surface = output.inputs.get("Surface")
    surface_source = _single_input_source(surface) if surface is not None else None
    if surface_source is None or surface_source[0] != group:
        return None
    if any(
        socket != surface and socket.is_linked for socket in output.inputs
    ):
        return None

    group_inputs = [
        node for node in group_tree.nodes
        if node.bl_idname == "NodeGroupInput"
    ]
    group_outputs = [
        node for node in group_tree.nodes
        if node.bl_idname == "NodeGroupOutput"
        and getattr(node, "is_active_output", True)
    ]
    if len(group_inputs) != 1 or len(group_outputs) != 1:
        return None
    group_input = group_inputs[0]
    group_output = group_outputs[0]
    selected_internal = _matching_socket(
        group_input.outputs, source_link.to_socket,
    )
    surface_internal = _matching_socket(
        group_output.inputs, surface_source[1],
    )
    if selected_internal is None or surface_internal is None:
        return None
    emission_source = _single_input_source(surface_internal)
    if emission_source is None:
        return None
    emission, emission_output = emission_source
    if emission.bl_idname != "ShaderNodeEmission" or emission.mute:
        return None
    emission_color = emission.inputs.get("Color")
    emission_strength = emission.inputs.get("Strength")
    if emission_color is None or emission_strength is None \
            or emission_strength.is_linked \
            or abs(float(emission_strength.default_value) - 1.0) > 1e-9:
        return None
    if _socket_targets(emission_output) != {_target_key(surface_internal)}:
        return None

    mix_source = _single_input_source(emission_color)
    if mix_source is None:
        return None
    mix, mix_output = mix_source
    if mix.bl_idname != "ShaderNodeMixRGB" or mix.mute \
            or mix.blend_type != "MIX" or bool(mix.use_clamp):
        return None
    mix_fac = mix.inputs.get("Fac")
    mix_a = mix.inputs.get("Color1")
    mix_b = mix.inputs.get("Color2")
    if mix_fac is None or mix_a is None or mix_b is None \
            or _single_input_source(mix_a) != (group_input, selected_internal):
        return None
    shade_value = _group_constant_input(group, group_input, mix_fac, 1)
    if shade_value is None or not (0.0 < shade_value[0] < 1.0):
        return None
    if _socket_targets(mix_output) != {_target_key(emission_color)}:
        return None

    multiply_source = _single_input_source(mix_b)
    if multiply_source is None:
        return None
    multiply, multiply_output = multiply_source
    if multiply.bl_idname != "ShaderNodeMixRGB" or multiply.mute \
            or multiply.blend_type != "MULTIPLY" or bool(multiply.use_clamp):
        return None
    multiply_fac = multiply.inputs.get("Fac")
    multiply_a = multiply.inputs.get("Color1")
    multiply_b = multiply.inputs.get("Color2")
    if multiply_fac is None or multiply_a is None or multiply_b is None \
            or multiply_fac.is_linked \
            or abs(float(multiply_fac.default_value) - 1.0) > 1e-9:
        return None
    multiply_sources = (
        _single_input_source(multiply_a),
        _single_input_source(multiply_b),
    )
    selected_source = (group_input, selected_internal)
    if multiply_sources.count(selected_source) != 1:
        return None
    add_input = multiply_b if multiply_sources[0] == selected_source else multiply_a
    add_source = _single_input_source(add_input)
    if add_source is None:
        return None
    add, add_output = add_source
    if add.bl_idname != "ShaderNodeMixRGB" or add.mute \
            or add.blend_type != "ADD" or bool(add.use_clamp):
        return None
    add_fac = add.inputs.get("Fac")
    add_a = add.inputs.get("Color1")
    add_b = add.inputs.get("Color2")
    if add_fac is None or add_a is None or add_b is None \
            or add_fac.is_linked \
            or abs(float(add_fac.default_value) - 1.0) > 1e-9:
        return None
    if _socket_targets(add_output) != {_target_key(add_input)} \
            or _socket_targets(multiply_output) != {_target_key(mix_b)}:
        return None

    def dynamic_response(input_socket):
        ramp_source = _single_input_source(input_socket)
        if ramp_source is None:
            return None
        ramp, ramp_output = ramp_source
        if ramp.bl_idname != "ShaderNodeValToRGB" or ramp.mute:
            return None
        ramp_fac = ramp.inputs.get("Fac")
        shader_source = (
            _single_input_source(ramp_fac) if ramp_fac is not None else None
        )
        if shader_source is None:
            return None
        conversion, conversion_output = shader_source
        if conversion.bl_idname != "ShaderNodeShaderToRGB" or conversion.mute:
            return None
        shader_input = conversion.inputs.get("Shader")
        diffuse_source = (
            _single_input_source(shader_input)
            if shader_input is not None else None
        )
        if diffuse_source is None:
            return None
        diffuse, diffuse_output = diffuse_source
        if diffuse.bl_idname != "ShaderNodeBsdfDiffuse" or diffuse.mute \
                or any(socket.is_linked for socket in diffuse.inputs):
            return None
        if _socket_targets(diffuse_output) != {_target_key(shader_input)} \
                or _socket_targets(conversion_output) != {_target_key(ramp_fac)} \
                or _socket_targets(ramp_output) != {_target_key(input_socket)}:
            return None
        if any(
            output_socket != conversion_output and output_socket.is_linked
            for output_socket in conversion.outputs
        ) or any(
            output_socket != ramp_output and output_socket.is_linked
            for output_socket in ramp.outputs
        ):
            return None
        return ramp, conversion, diffuse

    dynamic_a = dynamic_response(add_a)
    dynamic_b = dynamic_response(add_b)
    if (dynamic_a is None) == (dynamic_b is None):
        return None
    dynamic = dynamic_a or dynamic_b
    shade_input = add_b if dynamic_a is not None else add_a
    shade_color = _group_constant_input(
        group, group_input, shade_input, 4,
    )
    if shade_color is None or any(
        value < 0.0 or value > 1.0 for value in shade_color
    ):
        return None

    expected_selected_targets = {
        _target_key(mix_a),
        _target_key(
            multiply_a
            if multiply_sources[0] == selected_source else multiply_b
        ),
    }
    if _socket_targets(selected_internal) != expected_selected_targets:
        return None
    for node in (mix, multiply, add, emission, *dynamic):
        if getattr(node, "mute", False):
            return None

    ramp = dynamic[0]
    proof = {
        "model": STATIC_SHADE_FLOOR_MODEL,
        "shadeValue": shade_value[0],
        "shadeColor": list(shade_color),
        "mixNodes": [
            {"type": "ShaderNodeMixRGB", "blend": "MIX", "factor": "static"},
            {"type": "ShaderNodeMixRGB", "blend": "MULTIPLY", "factor": 1.0},
            {"type": "ShaderNodeMixRGB", "blend": "ADD", "factor": 1.0},
        ],
        "dynamic": [
            "ShaderNodeBsdfDiffuse",
            "ShaderNodeShaderToRGB",
            "ShaderNodeValToRGB",
        ],
        "ramp": {
            "colorMode": ramp.color_ramp.color_mode,
            "hueInterpolation": ramp.color_ramp.hue_interpolation,
            "interpolation": ramp.color_ramp.interpolation,
            "elements": [
                {
                    "position": float(element.position),
                    "color": [float(value) for value in element.color],
                }
                for element in ramp.color_ramp.elements
            ],
        },
    }
    encoded = json.dumps(
        proof, sort_keys=True, separators=(",", ":"),
    ).encode("utf8")
    return SurfaceFactorization(
        STATIC_SHADE_FLOOR_MODEL,
        shade_value[0],
        shade_color,
        hashlib.sha256(encoded).hexdigest(),
    )


def _infer_surface_response(material, color_link):
    """Classify how one selected intrinsic field reaches the active Surface."""
    if color_link is None:
        return None, None
    tree = _active_tree(material)
    if tree is None:
        return None, "the material has no active shader tree"
    source_node, source_socket = color_link
    responses = set()
    blockers = set()
    blocked_boundary_candidates = {}
    seen = set()

    def matching_socket(sockets, reference):
        identifier = str(getattr(reference, "identifier", "") or "")
        if identifier:
            matched = next((
                socket for socket in sockets
                if str(getattr(socket, "identifier", "") or "") == identifier
            ), None)
            if matched is not None:
                return matched
        return next((
            socket for socket in sockets
            if socket.name == reference.name
        ), None)

    def link_key(link):
        return (
            link.from_node.as_pointer(),
            str(getattr(link.from_socket, "identifier", "")
                or link.from_socket.name),
            link.to_node.as_pointer(),
            str(getattr(link.to_socket, "identifier", "")
                or link.to_socket.name),
        )

    def upstream_has_lit_shader(
        current_tree, node, output_socket, group_stack=(), walked=None,
    ):
        walked = walked if walked is not None else set()
        identifier = str(
            getattr(output_socket, "identifier", "") or output_socket.name
        )
        key = (
            "shader",
            current_tree.as_pointer(),
            node.as_pointer(),
            identifier,
            tuple(group.as_pointer() for _tree, group in group_stack),
        )
        if key in walked:
            return False
        walked.add(key)
        if node.bl_idname in _LIT_SURFACE_NODES:
            return True
        if node.bl_idname == "ShaderNodeGroup" \
                and node.node_tree is not None:
            nested_stack = group_stack + ((current_tree, node),)
            for group_output in node.node_tree.nodes:
                if group_output.bl_idname != "NodeGroupOutput" \
                        or not getattr(group_output, "is_active_output", True):
                    continue
                internal_input = matching_socket(
                    group_output.inputs, output_socket,
                )
                if internal_input is None:
                    continue
                for link in internal_input.links:
                    if upstream_has_lit_shader(
                        node.node_tree,
                        link.from_node,
                        link.from_socket,
                        nested_stack,
                        walked,
                    ):
                        return True
            return False
        if node.bl_idname == "NodeGroupInput":
            if not group_stack:
                return False
            outer_tree, group = group_stack[-1]
            external_input = matching_socket(group.inputs, output_socket)
            if external_input is None:
                return False
            return any(
                upstream_has_lit_shader(
                    outer_tree,
                    link.from_node,
                    link.from_socket,
                    group_stack[:-1],
                    walked,
                )
                for link in external_input.links
            )
        return any(
            upstream_has_lit_shader(
                current_tree,
                link.from_node,
                link.from_socket,
                group_stack,
                walked,
            )
            for input_socket in node.inputs
            for link in input_socket.links
        )

    def upstream_has_lit_conversion(
        current_tree, node, output_socket, group_stack=(), walked=None,
    ):
        """Find a BSDF converted to color before it joins the selected field."""
        walked = walked if walked is not None else set()
        identifier = str(
            getattr(output_socket, "identifier", "") or output_socket.name
        )
        key = (
            "conversion",
            current_tree.as_pointer(),
            node.as_pointer(),
            identifier,
            tuple(group.as_pointer() for _tree, group in group_stack),
        )
        if key in walked:
            return False
        walked.add(key)
        if node.bl_idname == "ShaderNodeShaderToRGB":
            shader = node.inputs.get("Shader")
            return shader is not None and any(
                upstream_has_lit_shader(
                    current_tree,
                    link.from_node,
                    link.from_socket,
                    group_stack,
                )
                for link in shader.links
            )
        if node.bl_idname == "ShaderNodeGroup" \
                and node.node_tree is not None:
            nested_stack = group_stack + ((current_tree, node),)
            for group_output in node.node_tree.nodes:
                if group_output.bl_idname != "NodeGroupOutput" \
                        or not getattr(group_output, "is_active_output", True):
                    continue
                internal_input = matching_socket(
                    group_output.inputs, output_socket,
                )
                if internal_input is None:
                    continue
                for link in internal_input.links:
                    if upstream_has_lit_conversion(
                        node.node_tree,
                        link.from_node,
                        link.from_socket,
                        nested_stack,
                        walked,
                    ):
                        return True
            return False
        if node.bl_idname == "NodeGroupInput":
            if not group_stack:
                return False
            outer_tree, group = group_stack[-1]
            external_input = matching_socket(group.inputs, output_socket)
            if external_input is None:
                return False
            return any(
                upstream_has_lit_conversion(
                    outer_tree,
                    link.from_node,
                    link.from_socket,
                    group_stack[:-1],
                    walked,
                )
                for link in external_input.links
            )
        return any(
            upstream_has_lit_conversion(
                current_tree,
                link.from_node,
                link.from_socket,
                group_stack,
                walked,
            )
            for input_socket in node.inputs
            for link in input_socket.links
        )

    def parallel_lit_conversion(
        current_tree, target, incoming_link, group_stack,
    ):
        incoming_key = link_key(incoming_link)
        return any(
            link_key(candidate) != incoming_key
            and upstream_has_lit_conversion(
                current_tree,
                candidate.from_node,
                candidate.from_socket,
                group_stack,
            )
            for input_socket in target.inputs
            for candidate in input_socket.links
        )

    def visit_output(
        current_tree, node, output_socket, response, group_stack=(),
        boundary_candidate=None,
    ):
        if current_tree == tree and output_socket.type in {"RGBA", "VALUE"}:
            boundary_candidate = (node, output_socket)
        identifier = str(
            getattr(output_socket, "identifier", "") or output_socket.name
        )
        candidate_key = (
            (
                boundary_candidate[0].as_pointer(),
                str(getattr(boundary_candidate[1], "identifier", "")
                    or boundary_candidate[1].name),
            )
            if boundary_candidate is not None else None
        )
        key = (
            current_tree.as_pointer(),
            node.as_pointer(),
            identifier,
            response,
            tuple(group.as_pointer() for _tree, group in group_stack),
            candidate_key,
        )
        if key in seen:
            return
        seen.add(key)
        for link in output_socket.links:
            target = link.to_node
            if target.get(MARKER_NODE_PROPERTY) is not None:
                continue
            if target.bl_idname == "ShaderNodeGroup" \
                    and target.node_tree is not None:
                for group_input in target.node_tree.nodes:
                    if group_input.bl_idname != "NodeGroupInput":
                        continue
                    internal_output = matching_socket(
                        group_input.outputs, link.to_socket,
                    )
                    if internal_output is not None and internal_output.is_linked:
                        visit_output(
                            target.node_tree,
                            group_input,
                            internal_output,
                            response,
                            group_stack + ((current_tree, target),),
                            boundary_candidate,
                        )
                continue
            if target.bl_idname == "NodeGroupOutput":
                if not group_stack \
                        or not getattr(target, "is_active_output", True):
                    continue
                outer_tree, group = group_stack[-1]
                external_output = matching_socket(
                    group.outputs, link.to_socket,
                )
                if external_output is not None and external_output.is_linked:
                    visit_output(
                        outer_tree,
                        group,
                        external_output,
                        response,
                        group_stack[:-1],
                        boundary_candidate,
                    )
                continue
            if target.bl_idname == "ShaderNodeOutputMaterial":
                if link.to_socket.name == "Surface" \
                        and getattr(target, "is_active_output", True):
                    # Blender permits a Color socket to connect directly to
                    # Surface; that conversion is lighting-independent.
                    responses.add(response or "unlit")
                continue
            if target.bl_idname in _EEVEE_RESPONSE_NODES:
                blockers.add(
                    f"the selected field passes through Eevee-only "
                    f"{target.bl_label or target.name}"
                )
                if boundary_candidate is not None:
                    blocked_boundary_candidates[candidate_key] = (
                        boundary_candidate
                    )
            if target.bl_idname in _LIT_SURFACE_NODES \
                    and target.bl_idname not in \
                    _PORTABLE_SELECTED_FIELD_BSDF_NODES:
                blockers.add(
                    f"the selected field feeds non-portable "
                    f"{target.bl_label or target.name}"
                )
                if boundary_candidate is not None:
                    blocked_boundary_candidates[candidate_key] = (
                        boundary_candidate
                    )
            next_response = response
            if next_response is None and parallel_lit_conversion(
                current_tree, target, link, group_stack,
            ):
                blockers.add(
                    "the selected field converges with an Eevee-only "
                    "BSDF-to-Shader-to-RGB response"
                )
                if boundary_candidate is not None:
                    blocked_boundary_candidates[candidate_key] = (
                        boundary_candidate
                    )
            if next_response is None:
                if target.bl_idname in _LIT_SURFACE_NODES:
                    next_response = "lit"
                elif target.bl_idname in _UNLIT_SURFACE_NODES:
                    next_response = "unlit"
            for target_output in target.outputs:
                if target_output.is_linked:
                    visit_output(
                        current_tree,
                        target,
                        target_output,
                        next_response,
                        group_stack,
                        boundary_candidate,
                    )

    visit_output(tree, source_node, source_socket, None)
    if blockers:
        eligible_candidates = []
        source_key = (
            source_node.as_pointer(),
            str(getattr(source_socket, "identifier", "")
                or source_socket.name),
        )
        for candidate_key, candidate in blocked_boundary_candidates.items():
            if candidate_key == source_key:
                continue
            candidate_source, candidate_issue = _classify_materialized_source(
                material.name, candidate[0], candidate[1], "color",
            )
            if candidate_issue is None and candidate_source is not None:
                eligible_candidates.append(candidate)
        unique_candidates = {
            (
                candidate[0].as_pointer(),
                str(getattr(candidate[1], "identifier", "")
                    or candidate[1].name),
            ): candidate
            for candidate in eligible_candidates
        }
        problem = "; ".join(sorted(blockers))
        if len(unique_candidates) == 1:
            candidate = next(iter(unique_candidates.values()))
            socket_type = {
                "RGBA": "Color",
                "VALUE": "Value",
            }.get(candidate[1].type, candidate[1].type or "unknown")
            problem += (
                f'; the unique complete intrinsic candidate immediately before '
                f'that response is "{candidate[0].name} -> '
                f'{candidate[1].name} ({socket_type})". Select that output as '
                f'Website Color to '
                "preserve its pattern and masks; Blendlink will not change the "
                "artist-selected socket automatically"
            )
        return None, problem
    if responses == {"lit"}:
        return "lit", None
    if responses == {"unlit"}:
        return "unlit", None
    if responses == {"lit", "unlit"}:
        return None, (
            "the selected field reaches both lit and unlit branches of the "
            "active Surface"
        )
    return None, "the selected field does not reach the active Surface"


def _plan_selected_material(
    material, raw_bindings, binding_issues=(), *, purpose: str,
) -> MaterialDecision:
    object_names = tuple(sorted({obj.name for obj, _slot in raw_bindings}))
    markers = marker_nodes(material)
    if not markers:
        if material_bake_requested(material):
            return _plan_material_bake(
                material, raw_bindings, binding_issues, purpose=purpose,
            )
        if tsl_ir_requested(material):
            # The standalone route (plan-doc 8b gap 1): before this
            # branch existed, set_tsl_ir without the bake fell through to
            # the automatic/preserved return below -- a total silent
            # no-op with no channel plan, no sidecar and no evidence.
            return _plan_tsl_program(
                material, raw_bindings, binding_issues, purpose=purpose,
            )
        return MaterialDecision(
            material.name, "automatic", "preserved", "stock", "full-surface", None,
            tuple(MaterialBinding(obj.name, slot) for obj, slot in raw_bindings),
        )
    issues = list(binding_issues)
    if tsl_ir_requested(material) and not material_bake_requested(material):
        issues.append(MaterialIssue(
            "material.tsl-conflicts-with-web-color", material.name,
            "TSL Program and a Blendlink Web Color marker are both set.",
            "Clear one intent: the Web Color marker lowers one selected "
            "field, while a TSL Program translates proven channels.",
            object_names,
        ))
        return MaterialDecision(
            material.name, "tslProgram", "blocked", None, "per-channel", None,
            tuple(MaterialBinding(obj.name, slot) for obj, slot in raw_bindings),
            issues=tuple(issues),
        )
    if material_bake_requested(material):
        issues.append(MaterialIssue(
            "material.bake-conflicts-with-web-color", material.name,
            "Material Bake and a Blendlink Web Color marker are both set.",
            "Clear one intent: the Web Color marker lowers one selected field, "
            "while Material Bake carries every Principled channel.",
            object_names,
        ))
        return MaterialDecision(
            material.name, "materialBake", "blocked", None, "per-channel", None,
            tuple(MaterialBinding(obj.name, slot) for obj, slot in raw_bindings),
            issues=tuple(issues),
        )
    if len(markers) != 1:
        issues.append(MaterialIssue(
            "material.source-ambiguous", material.name,
            f"Material has {len(markers)} Blendlink Web Color nodes.",
            "Keep exactly one Blendlink Web Color node.", object_names,
        ))
        return MaterialDecision(
            material.name, "webColor", "blocked", None, "selected-field", None,
            tuple(MaterialBinding(obj.name, slot) for obj, slot in raw_bindings),
            issues=tuple(issues),
        )
    marker = markers[0]
    if marker.get(MARKER_NODE_PROPERTY) != MARKER_VERSION:
        issues.append(MaterialIssue(
            "material.source-version-unsupported", material.name,
            f"Web Color marker version {marker.get(MARKER_NODE_PROPERTY)!r} is unsupported.",
            "Clear and recreate the Blendlink Web Color node.", object_names,
        ))
    if marker.type != "GROUP" or marker.node_tree is None \
            or marker.node_tree.get(MARKER_GROUP_PROPERTY) != MARKER_VERSION:
        issues.append(MaterialIssue(
            "material.source-invalid", material.name,
            "The marked node is not a valid Blendlink Web Color sink.",
            "Clear and recreate the Blendlink Web Color node.", object_names,
        ))
    color_link = _linked_source(marker, COLOR_INPUT)
    if color_link is None:
        issues.append(MaterialIssue(
            "material.color-unconnected", material.name,
            "Blendlink Web Color is not connected.",
            "Connect a Color/Value output or clear the Web Color node.", object_names,
        ))
    color, color_issue = _classify_source(material.name, color_link, "color")
    if color_issue:
        issues.append(MaterialIssue(
            color_issue.code, color_issue.material, color_issue.problem,
            color_issue.fix, object_names,
        ))
    response_setting = str(
        marker.get(MARKER_SURFACE_RESPONSE_PROPERTY, "AUTO")
    ).upper()
    if response_setting not in {"AUTO", "LIT", "UNLIT"}:
        issues.append(MaterialIssue(
            "material.selected-field-surface-response-invalid",
            material.name,
            f"Website Material surface response {response_setting!r} is unsupported.",
            "Choose Automatic, Lit, or Unlit in Blendlink Web Material.",
            object_names,
        ))
    surface_response = None
    surface_factorization = None
    if color_issue is None and color is not None:
        if response_setting in {"LIT", "UNLIT"}:
            surface_response = response_setting.lower()
            response_problem = None
        else:
            if color.kind == "materialized":
                surface_factorization = _recognize_static_shade_floor(
                    material, color_link,
                )
            if surface_factorization is not None:
                surface_response = "lit"
                response_problem = None
            else:
                surface_response, response_problem = _infer_surface_response(
                    material, color_link,
                )
        if response_problem is not None:
            issues.append(MaterialIssue(
                "material.selected-field-surface-response-ambiguous",
                material.name,
                f"Blendlink cannot choose an automatic portable surface "
                f"response for Website Color: {response_problem}.",
                "Select a complete intrinsic field and a supported response "
                "strategy, or explicitly choose Lit/Unlit when a stock-glTF "
                "approximation is intentional.",
                object_names,
            ))
    alpha_link = _linked_source(marker, ALPHA_INPUT)
    alpha, alpha_issue = _classify_source(material.name, alpha_link, "alpha")
    if alpha_issue:
        issues.append(MaterialIssue(
            alpha_issue.code, alpha_issue.material, alpha_issue.problem,
            alpha_issue.fix, object_names,
        ))
    if alpha is None and _requires_alpha(material):
        issues.append(MaterialIssue(
            "material.alpha-unresolved", material.name,
            "The active Surface uses transparency, but Website Alpha is not connected.",
            "Connect the matching Alpha field or make the selected website result explicitly opaque.",
            object_names,
        ))
    if alpha is None:
        alpha = FieldSource(
            "constant", marker.name, "opaque", "Opaque", value=(1.0, 1.0, 1.0, 1.0),
        )
    if color is not None and color.kind == "vertexColor" \
            and alpha.kind == "constant" and alpha.value is not None \
            and alpha.value[0] < 1.0:
        issues.append(MaterialIssue(
            "material.alpha-packing-unavailable", material.name,
            "A constant Website Alpha below 1 would be multiplied by the selected "
            "color attribute's stored alpha in stock glTF.",
            "Select the same attribute's Alpha output, use opaque Website Alpha, "
            "or wait for private alpha packing.",
            object_names,
        ))
    if color is not None and color.kind == "image" and (
        alpha.kind != "constant" or alpha.value is None
        or any(abs(value - 1.0) > 1e-9 for value in alpha.value)
    ):
        issues.append(MaterialIssue(
            "material.image-alpha-unsupported", material.name,
            "The selected Image Texture has a non-opaque Website Alpha. This "
            "first direct image route proves color bytes and UV sampling only.",
            "Leave Web Alpha unconnected (opaque), or wait for an attested image-alpha route.",
            object_names,
        ))
    if color is not None and color.kind == "materialized":
        issues.extend(_materialized_binding_issues(material, raw_bindings))
        if alpha.kind != "constant" or alpha.value is None \
                or any(abs(value - 1.0) > 1e-9 for value in alpha.value):
            issues.append(MaterialIssue(
                "material.selected-alpha-materialization-unavailable", material.name,
                "The first selected-field bake publishes opaque color only, but "
                "Website Alpha is not a constant one.",
                "Leave Web Alpha unconnected and make the active surface opaque, "
                "or use a direct field until straight-alpha materialization is "
                "separately proved.",
                object_names,
            ))

    planned_bindings = []
    if color is not None:
        for obj, slot in raw_bindings:
            if not getattr(obj, "is_editable", True):
                issues.append(MaterialIssue(
                    "material.binding-read-only", material.name,
                    f'Object "{obj.name}" is linked read-only, so Blendlink cannot install '
                    "a private export-only material binding.",
                    "Make the object local or create a library override before selecting Web Color.",
                    (obj.name,),
                ))
            color_attribute = None
            alpha_attribute = None
            alpha_mode = (
                "OPAQUE"
                if alpha.kind == "constant"
                and alpha.value is not None
                and abs(alpha.value[0] - 1.0) <= 1e-9
                else "MASK"
                if alpha.kind == "constant"
                and alpha.value is not None
                and abs(alpha.value[0]) <= 1e-9
                else "BLEND"
            )
            descriptor = None
            uv_descriptor = None
            source_hash = None
            materialization_plan = None
            if color.kind == "materialized":
                try:
                    source_hash = _materialized_binding_hash(obj)
                    materialization_plan = bakelib.plan_material_texture_resolution(
                        obj,
                        slot,
                        purpose=purpose,
                    )
                except (AttributeError, ReferenceError, RuntimeError, TypeError, ValueError) as error:
                    issues.append(MaterialIssue(
                        "material.selected-field-fingerprint-unavailable",
                        material.name,
                        f'Object "{obj.name}" cannot be fingerprinted for a '
                        f"restored selected-field bake: {error}",
                        "Repair/apply the object so its evaluated Mesh and material "
                        "dependencies can be inspected, then run Preview again.",
                        (obj.name,),
                    ))
            if color.kind == "vertexColor":
                descriptor = _attribute_descriptor(obj, color.attribute_name, slot)
                if descriptor is None:
                    wanted = color.attribute_name or "active render color"
                    issues.append(MaterialIssue(
                        "material.attribute-missing", material.name,
                        f'Object "{obj.name}" has no supported {wanted!r} color attribute after evaluation.',
                        "Add the attribute to this mesh, select another Website Color, or split the material.",
                        (obj.name,),
                    ))
                else:
                    color_attribute = descriptor["name"]
            if alpha.kind == "vertexColor":
                alpha_descriptor = _attribute_descriptor(obj, alpha.attribute_name, slot)
                if alpha_descriptor is None:
                    wanted = alpha.attribute_name or "active render color"
                    issues.append(MaterialIssue(
                        "material.alpha-attribute-missing", material.name,
                        f'Object "{obj.name}" has no supported {wanted!r} alpha attribute after evaluation.',
                        "Add the attribute or choose a constant/matching Website Alpha.", (obj.name,),
                    ))
                else:
                    alpha_attribute = alpha_descriptor["name"]
                    alpha_mode = alpha_descriptor["alphaMode"]
                    if color.kind != "vertexColor" or alpha_attribute != color_attribute:
                        issues.append(MaterialIssue(
                            "material.alpha-packing-unavailable", material.name,
                            f'Object "{obj.name}" selects alpha from {alpha_attribute!r}, but the current '
                            "direct route can preserve alpha only from the same RGBA color attribute.",
                            "Use the same Color Attribute for Web Color and Alpha, or wait for private alpha packing.",
                            (obj.name,),
                        ))
            if color.kind == "image":
                uv_descriptor, uv_problem = _uv_descriptor(obj, color, slot)
                if uv_descriptor is None:
                    issues.append(MaterialIssue(
                        "material.image-uv-unsupported", material.name,
                        f'Object "{obj.name}" cannot carry Image Texture "{color.node_name}": '
                        f"{uv_problem}.",
                        "Create the requested UV layer on the evaluated mesh, assign faces "
                        "to this material slot, and make the intended UV active for render "
                        "(or name it in a direct UV Map node).",
                        (obj.name,),
                    ))
            planned_bindings.append(MaterialBinding(
                object_name=obj.name,
                slot_index=slot,
                source_hash=source_hash,
                materialization_plan=materialization_plan,
                color_attribute=color_attribute,
                alpha_attribute=alpha_attribute,
                alpha_mode=alpha_mode,
                attribute_domain=descriptor["domain"] if descriptor else None,
                attribute_type=descriptor["type"] if descriptor else None,
                attribute_values=descriptor["values"] if descriptor else None,
                attribute_min=descriptor["min"] if descriptor else None,
                attribute_max=descriptor["max"] if descriptor else None,
                attribute_hash=descriptor["hash"] if descriptor else None,
                uv_name=uv_descriptor["name"] if uv_descriptor else None,
                uv_index=uv_descriptor["index"] if uv_descriptor else None,
                uv_distinct_values=uv_descriptor["distinct"] if uv_descriptor else None,
                uv_min=uv_descriptor["min"] if uv_descriptor else None,
                uv_max=uv_descriptor["max"] if uv_descriptor else None,
                uv_hash=uv_descriptor["hash"] if uv_descriptor else None,
                uv_values=uv_descriptor["values"] if uv_descriptor else None,
            ))

    outcome = "blocked" if issues else "lowered"
    transport = None if issues else (
        "vertexColor" if color and color.kind == "vertexColor"
        else "image" if color and color.kind in {"image", "materialized"}
        else "factor"
    )
    limitations = (
        (
            "Publishes the complete selected intrinsic field and its exactly "
            "factored static shade floor as ordinary glTF Base Color and "
            "Emission. The source Shader-to-RGB direct-light ramp is "
            "approximated by stock metallic-roughness lighting; AO, grain, "
            "transparency, view dependence, and post-response transforms are "
            "not accepted by this exact response family.",
        )
        if surface_factorization is not None else (
            "Publishes the selected intrinsic field with its directly portable "
            "or explicitly chosen lit/unlit website response. Exact downstream "
            "Shader-to-RGB or AO shading, authored shadow appearance, view "
            "transform, grain, and compositor effects are not transported.",
        )
    )
    return MaterialDecision(
        material.name,
        "webColor",
        outcome,
        transport,
        "selected-field",
        surface_response,
        tuple(planned_bindings or (
            MaterialBinding(obj.name, slot) for obj, slot in raw_bindings
        )),
        color,
        alpha,
        limitations,
        tuple(issues),
        surface_factorization,
    )


# --- MTL-BAKE-001: the per-channel Material bake -----------------------------
#
# A Material bake captures a needsBake material's individual Principled
# inputs into images so the published material stays ordinary lit glTF
# pbrMetallicRoughness — the remedy for `material.used-needs-bake` that does
# not flatten the surface to an unlit Appearance atlas.  Routing is per
# channel: constants stay factors, only unrecognised graphs bake, metallic
# and roughness pack into one ORM image, baked alpha rides base colour's A,
# and an HDR emissive field carries KHR_materials_emissive_strength.  The
# artist opts in per material; every channel decision stays visible in the
# plan.  Bake mechanics live in bakelib — this section orchestrates.

_CHANNEL_REFUSED_ROUTINGS = {
    "viewDependent": (
        "changes with the viewer, so a baked channel would freeze one view"
    ),
    "sceneDependent": (
        "captures scene lighting, which a Material bake input must never "
        "include — the runtime would light it again"
    ),
    "unknown": "contains a node Blendlink has not classified for baking",
}

# Report order and per-channel bake colorspace.  glTF samples ORM and normal
# textures linearly; base colour and emissive decode as sRGB.
_CHANNEL_BAKE_KINDS = (
    ("Base Color", "baseColor", "srgb"),
    ("Metallic", "metallic", "data"),
    ("Roughness", "roughness", "data"),
    ("Alpha", "alpha", "data"),
    ("Emission", "emission", "srgb"),
    ("Normal", "normal", "data"),
)


def material_bake_requested(material) -> bool:
    """Whether the artist opted this material into the per-channel bake."""
    try:
        return bool(material is not None and material.get(MATERIAL_BAKE_PROPERTY))
    except (AttributeError, TypeError):
        return False


def set_material_bake(material, enabled: bool) -> None:
    if enabled:
        material[MATERIAL_BAKE_PROPERTY] = True
    elif MATERIAL_BAKE_PROPERTY in material.keys():
        del material[MATERIAL_BAKE_PROPERTY]


def tsl_ir_requested(material) -> bool:
    """Whether per-channel TSL IR evidence was requested for this material.

    The IR rides the channel plan additively: every channel keeps its
    existing carrier (factor/bake), and the attached document is evidence
    for the future TSL runtime, not a route.
    """
    try:
        return bool(material is not None and material.get(TSL_IR_PROPERTY))
    except (AttributeError, TypeError):
        return False


def set_tsl_ir(material, enabled: bool) -> None:
    if enabled:
        material[TSL_IR_PROPERTY] = True
    elif TSL_IR_PROPERTY in material.keys():
        del material[TSL_IR_PROPERTY]


def _attach_tsl_ir(tree, channels, *, surface_resolved: bool = False) -> None:
    """Additive per-channel TSL IR for an opted-in material's channel plan.

    Every channel record — bake, factor, and refused alike — gains either
    {tslIr, tslIrHash, tslIrBytes} or {tslIrRefusal}.  Routes never
    change.  The serialized size is budgeted per channel (embedded-pixel
    image IR is bounded upstream at 128x128, but chains can stack), and
    the hash is over the canonical JSON so consumers can attest content
    without rehashing Blender-side floats.
    """
    import hashlib
    import json as _json

    # Production emission carries over-budget images as texture_ref ops
    # against published assets; the harness contract stays embedded-only.
    tsl_ir.set_texture_ref_emission(True)
    try:
        if surface_resolved:
            _attach_surface_tsl_ir(tree, channels, hashlib, _json)
        else:
            _attach_tsl_ir_documents(tree, channels, hashlib, _json)
    finally:
        tsl_ir.set_texture_ref_emission(False)


def _attach_surface_tsl_ir(tree, channels, hashlib, _json) -> None:
    """Per-channel IR for a surface-resolved plan: the fold's documents
    keyed onto the plan records (the merged Emission record carries the
    radiance document, strength ships as 1)."""
    tsl_ir.drain_approximations()
    try:
        emitted = tsl_ir.emit_surface(tree)
    except (tsl_ir.TslIrRefusal, RecursionError) as refusal:
        tsl_ir.drain_approximations()
        for entry in channels:
            entry["tslIrRefusal"] = str(refusal) or "surface emission failed"
        return
    # One emission covers every channel, so per-channel attribution is
    # not recoverable here: every surviving channel carries the full
    # list. That over-marks (a Base Color approximation also marks
    # Roughness) and never under-marks -- the safe direction for a
    # fidelity claim.
    surface_approximations = tsl_ir.drain_approximations()
    fold_channels = emitted.get("channels", {})
    mapping = {
        "Base Color": "Base Color", "Metallic": "Metallic",
        "Roughness": "Roughness", "Alpha": "Alpha",
        "Emission": "Emission Color",
    }
    for entry in channels:
        document = fold_channels.get(mapping.get(entry.get("channel")))
        if document is None:
            entry["tslIrRefusal"] = (
                f"channel {entry.get('channel')!r} has no surface fold"
            )
            continue
        encoded = _json.dumps(
            document, sort_keys=True, separators=(",", ":"),
        )
        if len(encoded) > TSL_IR_BYTE_BUDGET:
            entry["tslIrRefusal"] = (
                f"IR serializes to {len(encoded)} bytes, over the "
                f"{TSL_IR_BYTE_BUDGET}-byte channel budget"
            )
            continue
        referenced_images = set()
        _collect_texture_ref_images(document, referenced_images)
        if len(referenced_images) > 1:
            entry["tslIrRefusal"] = (
                f"channel references {len(referenced_images)} large "
                "images; the texture transport carries one per channel"
            )
            continue
        entry["tslIr"] = document
        entry["tslIrHash"] = hashlib.sha256(
            encoded.encode("utf8"),
        ).hexdigest()
        entry["tslIrBytes"] = len(encoded)
        # The surface emission ran once for every channel, so each surviving
        # entry carries its own copy of the surface-wide list (drained above,
        # before this loop). Deliberately INSIDE the plan fingerprint -- the
        # fingerprint strips only tslIr -- so a change in approximation
        # status churns variant identity like any other plan change.
        if surface_approximations:
            entry["tslIrApproximations"] = [
                dict(item) for item in surface_approximations
            ]


def _collect_texture_ref_images(value, names) -> None:
    if isinstance(value, dict):
        if value.get("op") == "texture_ref":
            image = value.get("image") or {}
            names.add(str(image.get("name")))
        for item in value.values():
            _collect_texture_ref_images(item, names)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_texture_ref_images(item, names)


def _attach_tsl_ir_documents(tree, channels, hashlib, _json) -> None:
    # Residue guard: a prior emission that refused midway may have
    # declared approximations that never drained; they belong to nobody.
    tsl_ir.drain_approximations()
    try:
        root, stack = tsl_ir.find_principled_root(tree)
    except tsl_ir.TslIrRefusal as refusal:
        for entry in channels:
            entry["tslIrRefusal"] = str(refusal)
        return
    except RecursionError:
        for entry in channels:
            entry["tslIrRefusal"] = (
                "surface resolution exceeded the recursion bound"
            )
        return
    for entry in channels:
        channel_name = entry.get("channel")
        if channel_name == "Emission":
            # The plan merges Emission Color + Strength into one record;
            # per-socket radiance IR lands with the runtime consumer.
            entry["tslIrRefusal"] = (
                "merged Emission record; per-socket IR lands with the "
                "runtime consumer"
            )
            continue
        socket = procedural._node_input(root, channel_name)
        if socket is None:
            entry["tslIrRefusal"] = f"channel {channel_name!r} not found"
            continue
        try:
            document = tsl_ir.emit_channel(socket, stack)
        except tsl_ir.TslIrRefusal as refusal:
            tsl_ir.drain_approximations()
            entry["tslIrRefusal"] = str(refusal)
            continue
        except RecursionError:
            # Deep pathological graphs must degrade to a named refusal,
            # never a planner crash.
            tsl_ir.drain_approximations()
            entry["tslIrRefusal"] = (
                "IR emission exceeded the recursion bound"
            )
            continue
        # Drained IMMEDIATELY after emission, before the budget checks below
        # can `continue`: a channel refused for size must not leave its
        # declared approximations behind for the next channel to claim.
        approximations = tsl_ir.drain_approximations()
        encoded = _json.dumps(
            document, sort_keys=True, separators=(",", ":"),
        )
        if len(encoded) > TSL_IR_BYTE_BUDGET:
            entry["tslIrRefusal"] = (
                f"IR serializes to {len(encoded)} bytes, over the "
                f"{TSL_IR_BYTE_BUDGET}-byte channel budget"
            )
            continue
        referenced_images = set()
        _collect_texture_ref_images(document, referenced_images)
        if len(referenced_images) > 1:
            entry["tslIrRefusal"] = (
                f"channel references {len(referenced_images)} large "
                "images; the texture transport carries one per channel"
            )
            continue
        entry["tslIr"] = document
        entry["tslIrHash"] = hashlib.sha256(
            encoded.encode("utf8"),
        ).hexdigest()
        entry["tslIrBytes"] = len(encoded)
        # Attached only when the IR ships (an approximation of a refused
        # channel is moot) and inside the plan fingerprint, same as the
        # surface path.
        if approximations:
            entry["tslIrApproximations"] = approximations


def _channel_plan_fingerprint(channel_plan):
    """The channel plan with IR payloads stripped for hashing.

    The tslIrHash stays (it pins the content); the IR body must never
    enter plan fingerprints or generated-material variant identity —
    megabyte payloads and float-repr drift would churn both.
    """
    if not channel_plan:
        return channel_plan
    stripped = dict(channel_plan)
    stripped["channels"] = [
        {key: value for key, value in entry.items() if key != "tslIr"}
        for entry in channel_plan.get("channels", ())
    ]
    return stripped


def _channel_probe_stats(main, probe) -> dict:
    """Numeric agreement between two float bake results.

    Equal-resolution inputs compare texel-exact; a half-resolution probe is
    box-downsampled first.  The stats are the recorded measurement; callers
    own which of them gate.
    """
    import numpy as np

    a = np.asarray(main, dtype=np.float32)
    b = np.asarray(probe, dtype=np.float32)
    if a.shape != b.shape:
        factor = a.shape[0] // b.shape[0]
        a = a.reshape(
            b.shape[0], factor, b.shape[1], factor, a.shape[2],
        ).mean(axis=(1, 3))
    diff = np.abs(a - b)
    return {
        "meanAbs": float(diff.mean()),
        "p99Abs": float(np.percentile(diff, 99.0)),
        "maxAbs": float(diff.max()),
    }


def _principled_root_of(material):
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return None, None
    nodes = procedural.reachable_surface_nodes(tree)
    root = procedural._single_principled_surface_root(nodes)
    if root is None or root.id_data.as_pointer() != tree.as_pointer():
        return tree, None
    return tree, root


def _authored_uv_tile_area(obj, uv_maps, uses_active) -> tuple[float, list]:
    """UV-space triangle area of the channel's driving map, in tile units.

    The sum approximates how many 0..1 tiles the surface spans (overlap
    counts multiplicity, which is correct for density).  Also returns the
    referenced layers missing from this mesh.
    """
    mesh = obj.data
    missing = [name for name in uv_maps if mesh.uv_layers.get(name) is None]
    layers = [mesh.uv_layers[name] for name in uv_maps if name not in missing]
    if uses_active or not layers:
        active = next(
            (layer for layer in mesh.uv_layers if layer.active_render),
            mesh.uv_layers[0] if len(mesh.uv_layers) else None,
        )
        if active is None:
            missing.append("<active render UV map>")
        elif all(layer.name != active.name for layer in layers):
            layers.append(active)
    area = 0.0
    if layers:
        mesh.calc_loop_triangles()
        layer = layers[0]
        data = layer.data
        for triangle in mesh.loop_triangles:
            loops = triangle.loops
            (ax, ay) = data[loops[0]].uv
            (bx, by) = data[loops[1]].uv
            (cx, cy) = data[loops[2]].uv
            area += abs(
                (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            ) * 0.5
    return area, missing


def _authored_uv_bounds(obj, uv_maps, uses_active):
    mesh = obj.data
    layers = [
        mesh.uv_layers[name] for name in uv_maps
        if mesh.uv_layers.get(name) is not None
    ]
    if uses_active or not layers:
        active = next(
            (layer for layer in mesh.uv_layers if layer.active_render),
            mesh.uv_layers[0] if len(mesh.uv_layers) else None,
        )
        if active is not None and all(
                layer.name != active.name for layer in layers):
            layers.append(active)
    lo = [math.inf, math.inf]
    hi = [-math.inf, -math.inf]
    for layer in layers:
        for item in layer.data:
            u, v = item.uv
            lo[0] = min(lo[0], u)
            lo[1] = min(lo[1], v)
            hi[0] = max(hi[0], u)
            hi[1] = max(hi[1], v)
    if lo[0] is math.inf:
        return None
    return (lo[0], lo[1], hi[0], hi[1])


def _synthesize_surface_routing(tree):
    """Channel routing for a surface-resolvable non-Principled material.

    The Mix-Shader fold (user-approved 2026-07-28) projects the closure
    tree onto the Principled channel vector, so the planner can reuse the
    entire principled pipeline: the whole Surface socket classifies once
    (conservative union of every contributing space), fold-constant
    channels become factors, and everything else routes with the surface
    class. Returns the routing dict, a {"reason": ...} refusal, or None
    when the surface does not resolve at all."""
    if tree is None:
        return None
    try:
        tsl_ir.resolve_surface(tree)
    except (tsl_ir.TslIrRefusal, RecursionError) as refusal:
        return {"reason": str(refusal) or "surface resolution failed"}
    output = next(
        (node for node in tree.nodes
         if node.bl_idname == "ShaderNodeOutputMaterial"
         and getattr(node, "is_active_output", True)),
        None,
    )
    surface_socket = output.inputs.get("Surface") if output is not None else None
    if surface_socket is None or not surface_socket.is_linked:
        return None
    surface_record = procedural._classify_channel("Surface", surface_socket)
    routing_kind = str(surface_record.get("routing") or "unknown")
    if routing_kind in ("viewDependent", "sceneDependent", "unknown"):
        reasons = "; ".join(surface_record.get("reasons") or ()) or routing_kind
        return {"reason": (
            f"The mixed surface classifies as {routing_kind}: {reasons}"
        )}
    emitted = None
    tsl_ir.set_texture_ref_emission(True)
    try:
        emitted = tsl_ir.emit_surface(tree)
    except (tsl_ir.TslIrRefusal, RecursionError):
        # Channels bake without fold-constant detection (and without the
        # IR upgrade); the projection tap does not need IR emission.
        emitted = None
    finally:
        tsl_ir.set_texture_ref_emission(False)
    fold_channels = (emitted or {}).get("channels", {})

    def record(name, document):
        expression = (document or {}).get("output") or {}
        op = expression.get("op")
        if op == "const_float":
            return {
                "channel": name, "linked": False, "routing": "constant",
                "value": round(float(expression["value"]), 6),
            }
        if op == "const_vec3":
            return {
                "channel": name, "linked": False, "routing": "constant",
                "value": [round(float(item), 6) for item in expression["value"]],
            }
        return {
            "channel": name,
            "linked": True,
            "routing": routing_kind,
            "uvMaps": list(surface_record.get("uvMaps") or ()),
            "usesActiveUv": bool(surface_record.get("usesActiveUv")),
            "animated": bool(surface_record.get("animated")),
            "reasons": list(surface_record.get("reasons") or ()),
        }

    channels = [
        record(name, fold_channels.get(name))
        for name in (
            "Base Color", "Metallic", "Roughness", "Alpha", "Emission Color",
        )
    ]
    channels.append(record(
        "Emission Strength",
        fold_channels.get("Emission Strength")
        or {"output": {"op": "const_float", "value": 1.0}},
    ))
    return {
        "model": procedural.CHANNEL_ROUTING_MODEL,
        "surfaceRoot": "principled",
        "surfaceResolved": True,
        "channels": channels,
    }


def _object_attribute_names(tree) -> tuple[str, ...]:
    """Names of per-object Attribute OBJECT properties the surface samples
    (the shared-material per-object-tint pattern)."""
    if tree is None:
        return ()
    names = set()
    for node in procedural.reachable_surface_nodes(tree):
        if getattr(node, "bl_idname", "") == "ShaderNodeAttribute" \
                and str(getattr(node, "attribute_type", "")) == "OBJECT":
            name = str(getattr(node, "attribute_name", "") or "")
            if name:
                names.add(name)
    return tuple(sorted(names))


def _plan_tsl_program(
    material, raw_bindings, binding_issues=(), *, purpose: str,
) -> MaterialDecision:
    """The standalone TSL-program route: translate, never bake.

    The carrier is a stock passthrough copy of the artist material (the
    compile transaction stamps the runtime identity extras on it), and
    the programs sidecar carries whatever per-channel IR the emitter
    proves. Channels that refuse keep the shipped carrier BY NAME --
    routes never change at runtime, fidelity only upgrades. A material
    with no proven channel stays `preserved` rather than `blocked`: an
    unproven program must not block the whole export, because the artist
    material ships stock either way and the named refusals on the channel
    plan are the evidence."""
    object_names = tuple(sorted({obj.name for obj, _slot in raw_bindings}))
    bindings = tuple(
        MaterialBinding(obj.name, slot) for obj, slot in raw_bindings
    )
    issues = list(binding_issues)
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        # Nothing to translate; the stock export already carries a
        # node-less material faithfully.
        return MaterialDecision(
            material.name, "tslProgram", "preserved", "stock",
            "per-channel", None, bindings, issues=tuple(issues),
        )
    # Principled roots take the per-channel emitters; anything else takes
    # the surface fold, exactly like the bake's IR attachment.
    surface_resolved = False
    try:
        tsl_ir.find_principled_root(tree)
    except (tsl_ir.TslIrRefusal, RecursionError):
        surface_resolved = True
    channels = [
        {"channel": name}
        for name in (
            "Base Color", "Metallic", "Roughness", "Alpha", "Emission",
        )
    ]
    _attach_tsl_ir(tree, channels, surface_resolved=surface_resolved)
    for entry in channels:
        entry["route"] = "program" if "tslIr" in entry else "refused"
    channel_plan = {
        "model": TSL_PROGRAM_PLAN_MODEL,
        "channels": channels,
        **({"surfaceResolved": True} if surface_resolved else {}),
    }
    if not any("tslIr" in entry for entry in channels):
        issues.append(MaterialIssue(
            "material.tsl-program-unproven", material.name,
            "No channel of this material has a proven TSL program; each "
            "refusal is named on the channel plan.",
            "Simplify the refusing channels or clear the TSL Program "
            "intent.",
            object_names,
        ))
        return MaterialDecision(
            material.name, "tslProgram", "preserved", "stock",
            "per-channel", None, bindings,
            issues=tuple(issues), channel_plan=channel_plan,
        )
    return MaterialDecision(
        material.name, "tslProgram", "lowered", "program",
        "per-channel", None, bindings,
        issues=tuple(issues), channel_plan=channel_plan,
    )


def _plan_material_bake(
    material, raw_bindings, binding_issues=(), *, purpose: str,
) -> MaterialDecision:
    """Route every Principled channel of one opted-in material."""
    object_names = tuple(sorted({obj.name for obj, _slot in raw_bindings}))
    issues = list(binding_issues)
    tree, root = _principled_root_of(material)
    routing = (
        procedural.material_channel_routing(
            tree, procedural.reachable_surface_nodes(tree),
        )
        if tree is not None else None
    )
    if root is None or routing is None or routing["surfaceRoot"] != "principled":
        # Mix-Shader fold (user-approved 2026-07-28): a surface-resolvable
        # closure tree plans through the SAME pipeline with synthesized
        # routing (the whole-Surface classification + fold constants); the
        # projection tap bakes its folded channels.
        synthesized = _synthesize_surface_routing(tree)
        if synthesized is not None \
                and synthesized.get("surfaceRoot") == "principled":
            routing = synthesized
        else:
            reason = (
                f"{synthesized['reason']} (surface-resolved planning)"
                if synthesized is not None and synthesized.get("reason")
                else routing["reason"]
                if routing and routing.get("reason")
                else "The material has no single root-level Principled "
                     "BSDF surface."
            )
            issues.append(MaterialIssue(
                "material.bake-surface-unsupported", material.name, reason,
                "Route the surface through one root-level Principled BSDF, "
                "or use an Appearance bake for deliberately flattened "
                "output.",
                object_names,
            ))
            return MaterialDecision(
                material.name, "materialBake", "blocked", None,
                "per-channel", None,
                tuple(
                    MaterialBinding(obj.name, slot)
                    for obj, slot in raw_bindings
                ),
                issues=tuple(issues),
            )

    routed = {entry["channel"]: entry for entry in routing["channels"]}
    channels = []
    needs_unique = False
    needs_tile = False
    tile_uv_maps = set()
    tile_uses_active = False
    limitations = []

    def refuse(channel_name, entry, extra=None):
        detail = _CHANNEL_REFUSED_ROUTINGS.get(
            entry.get("routing"), "cannot be carried by a Material bake",
        ) if extra is None else extra
        reasons = list(entry.get("reasons") or ())
        issues.append(MaterialIssue(
            "material.channel-refused", material.name,
            f"The {channel_name} channel {detail}."
            + (f" ({'; '.join(reasons)})" if reasons else ""),
            "Keep the object Realtime, simplify this channel, or use an "
            "Appearance bake for deliberately flattened output.",
            object_names,
        ))
        channels.append({
            "channel": channel_name,
            "route": "refused",
            "reasons": reasons or [detail],
        })

    def route_bake(channel_name, entry, colorspace, pack=None,
                   bake_pass="EMIT"):
        nonlocal needs_unique, needs_tile, tile_uses_active
        if entry.get("animated"):
            refuse(
                channel_name, entry,
                extra=(
                    "is animated or driven; a baked channel freezes its "
                    "input, which would silently discard the animation"
                ),
            )
            return None
        routing_kind = entry.get("routing")
        if routing_kind in _CHANNEL_REFUSED_ROUTINGS:
            refuse(channel_name, entry)
            return None
        record = {
            "channel": channel_name,
            "route": "bake",
            "colorspace": colorspace,
            "pass": bake_pass,
        }
        if pack is not None:
            record["pack"] = pack
        if routing_kind == "unique":
            needs_unique = True
            record["uv"] = "unique"
        else:
            # tileable and uniform graphs bake one 0..1 tile.
            needs_tile = True
            record["uv"] = "tile"
            record["uvMaps"] = sorted(entry.get("uvMaps") or ())
            record["usesActiveUv"] = bool(
                entry.get("usesActiveUv") or not (entry.get("uvMaps") or ())
            )
            tile_uv_maps.update(entry.get("uvMaps") or ())
            if entry.get("usesActiveUv") or not (entry.get("uvMaps") or ()):
                tile_uses_active = True
        channels.append(record)
        return record

    # --- Base Color + Alpha (alpha rides base colour's A) ---
    base_entry = routed.get("Base Color")
    alpha_entry = routed.get("Alpha")
    alpha_baked = False
    alpha_factor = 1.0
    if alpha_entry is not None and alpha_entry.get("route") != "refused":
        if not alpha_entry["linked"]:
            value = alpha_entry.get("value")
            alpha_factor = float(value) if isinstance(value, (int, float)) else 1.0
            channels.append({
                "channel": "Alpha", "route": "factor", "value": alpha_factor,
            })
        else:
            record = route_bake("Alpha", alpha_entry, "data")
            alpha_baked = record is not None
    if base_entry is not None:
        if not base_entry["linked"] and not alpha_baked:
            channels.append({
                "channel": "Base Color", "route": "factor",
                "value": base_entry.get("value"),
            })
        elif not base_entry["linked"] and alpha_baked:
            # Baked alpha needs an RGBA carrier; a constant base colour
            # becomes the factor over a white carrier.
            channels.append({
                "channel": "Base Color", "route": "factor-over-carrier",
                "value": base_entry.get("value"),
            })
        else:
            route_bake("Base Color", base_entry, "srgb")

    # --- Metallic + Roughness (ORM pack) ---
    for channel_name in ("Metallic", "Roughness"):
        entry = routed.get(channel_name)
        if entry is None:
            continue
        if not entry["linked"]:
            channels.append({
                "channel": channel_name, "route": "factor",
                "value": entry.get("value"),
            })
        else:
            route_bake(channel_name, entry, "data", pack="orm")

    # --- Emission: colour and strength merge into one radiance field ---
    emission_color = routed.get("Emission Color")
    emission_strength = routed.get("Emission Strength")
    if emission_color is not None and emission_strength is not None:
        if not emission_color["linked"] and not emission_strength["linked"]:
            channels.append({
                "channel": "Emission", "route": "factor",
                "value": emission_color.get("value"),
                "strength": emission_strength.get("value"),
            })
        else:
            merged = {
                "channel": "Emission",
                "linked": True,
                "routing": "uniform",
                "spaces": sorted(
                    set(emission_color.get("spaces") or ())
                    | set(emission_strength.get("spaces") or ())
                ),
                "uvMaps": sorted(
                    set(emission_color.get("uvMaps") or ())
                    | set(emission_strength.get("uvMaps") or ())
                ),
                "usesActiveUv": bool(
                    emission_color.get("usesActiveUv")
                    or emission_strength.get("usesActiveUv")
                ),
                "animated": bool(
                    emission_color.get("animated")
                    or emission_strength.get("animated")
                ),
                "reasons": list(dict.fromkeys(
                    list(emission_color.get("reasons") or ())
                    + list(emission_strength.get("reasons") or ())
                )),
            }
            severity = {
                "unknown": 6, "viewDependent": 5, "sceneDependent": 4,
                "unique": 3, "tileable": 2, "uniform": 1, "constant": 0,
            }
            merged["routing"] = max(
                (
                    emission_color.get("routing", "uniform"),
                    emission_strength.get("routing", "uniform"),
                ),
                key=lambda kind: severity.get(kind, 6),
            )
            route_bake("Emission", merged, "srgb")

    # --- Normal (tangent-space NORMAL pass) ---
    normal_entry = routed.get("Normal")
    if normal_entry is not None and normal_entry["linked"]:
        route_bake("Normal", normal_entry, "data", bake_pass="NORMAL")

    # Per-object attributes make every baked field object-dependent: tile
    # bakes evaluate on a shared proxy carrying no per-object properties,
    # so these materials bake per binding on the Unique route, and the
    # property values fold into variant identity below.
    object_attribute_names = _object_attribute_names(tree)
    if object_attribute_names and needs_tile:
        needs_unique = True

    # One material shares one UV strategy: the ORM pack and the base/alpha
    # carrier each merge several channels into one image, so a mixed
    # tile/unique material collapses conservatively to the Unique route.
    if needs_unique and needs_tile:
        for record in channels:
            if record.get("route") == "bake" and record.get("uv") == "tile":
                record["uv"] = "unique"
                record.pop("uvMaps", None)
                record.pop("usesActiveUv", None)
        needs_tile = False
        limitations.append(
            "Tileable channels share this material's Unique unwrap because "
            "another channel needs one; per-channel UV mixing is a later "
            "optimization."
        )

    # --- Per-binding resolution and UV validation ---
    planned_bindings = []
    tile_resolution = None
    wrap_gate_window = None
    if not issues:
        for obj, slot in raw_bindings:
            if needs_unique:
                break
            missing = _authored_uv_tile_area(
                obj, sorted(tile_uv_maps), tile_uses_active,
            )[1] if needs_tile else []
            if missing:
                issues.append(MaterialIssue(
                    "material.channel-uv-missing", material.name,
                    f'Object "{obj.name}" is missing the UV maps this '
                    f"material's channels sample: {', '.join(missing)}.",
                    "Author the referenced UV maps on every bound mesh.",
                    object_names,
                ))
        if needs_unique:
            issues.extend(_materialized_binding_issues(
                material, raw_bindings,
                deforming_receivers=True,
                slot_scoped=True,
            ))
    if not issues:
        for obj, slot in raw_bindings:
            resolution_plan = None
            source_hash = None
            if needs_unique:
                source_hash = _materialized_binding_hash(
                    obj, rest_basis=_deforming_receiver(obj),
                )
                if object_attribute_names:
                    # Bindings with different per-object attribute values
                    # must never share a bake variant.
                    extra = hashlib.sha256()
                    extra.update(source_hash.encode("utf8"))
                    for name in object_attribute_names:
                        extra.update(
                            f"{name}={obj.get(name)!r}".encode("utf8"),
                        )
                    source_hash = extra.hexdigest()
                resolution_plan = bakelib.plan_material_texture_resolution(
                    obj, slot, purpose=purpose,
                )
            if needs_tile:
                plan = bakelib.plan_material_texture_resolution(
                    obj, slot, purpose=purpose,
                )
                target_pixels = (
                    plan.get("targetProjectedPixels")
                    or plan.get("fallbackResolution", 1024) ** 2
                )
                tile_area, _missing = _authored_uv_tile_area(
                    obj, sorted(tile_uv_maps), tile_uses_active,
                )
                per_tile = math.sqrt(
                    max(float(target_pixels), 1.0)
                    / max(float(tile_area), 1.0)
                )
                candidate = bakelib._bounded_power_of_two(per_tile, 64, 2048)
                tile_resolution = max(tile_resolution or 0, candidate)
                bounds = _authored_uv_bounds(
                    obj, sorted(tile_uv_maps), tile_uses_active,
                )
                if bounds is not None and (
                    bounds[0] < -1e-4 or bounds[1] < -1e-4
                    or bounds[2] > 1.0 + 1e-4 or bounds[3] > 1.0 + 1e-4
                ):
                    lo_u = math.floor(bounds[2]) - 1
                    lo_v = math.floor(bounds[3]) - 1
                    if (lo_u, lo_v) != (0, 0):
                        wrap_gate_window = (
                            float(lo_u), float(lo_v),
                            float(lo_u + 1), float(lo_v + 1),
                        )
                    else:
                        wrap_gate_window = (1.0, 1.0, 2.0, 2.0)
            planned_bindings.append(MaterialBinding(
                obj.name, slot,
                source_hash=source_hash,
                materialization_plan=resolution_plan,
                alpha_mode=(
                    "BLEND" if (alpha_baked or alpha_factor < 1.0 - 1e-9)
                    else "OPAQUE"
                ),
                distinct_material=bool(obj.get("blendlink_distinct_material")),
            ))
    else:
        planned_bindings = [
            MaterialBinding(obj.name, slot) for obj, slot in raw_bindings
        ]

    for record in channels:
        if record.get("route") == "bake":
            if record.get("uv") == "tile":
                record["resolution"] = tile_resolution or 64
                record["wrapGate"] = wrap_gate_window is not None
            else:
                record["resolution"] = "per-binding"

    if alpha_baked:
        limitations.append(
            "Baked alpha publishes as BLEND; MASK detection from baked "
            "coverage is not implemented yet."
        )
    if any(record.get("pack") == "orm" for record in channels):
        limitations.append(
            "The ORM occlusion channel stays a neutral white fill; ambient "
            "occlusion baking is a separate route."
        )

    # MTL-CONS-003 stage 1: one generated material per variant.  Tileable
    # and factor-only materials consolidate across every non-distinct
    # binding; Unique materials stay per-binding until the shared-atlas
    # pack lands.  Tileable materials are the separate population that can
    # never join a cross-material shared atlas.
    population = "factor"
    if any(
        record.get("route") == "bake" and record.get("uv") == "unique"
        for record in channels
    ):
        population = "unique"
    elif any(record.get("route") == "bake" for record in channels):
        population = "tileable"
    distinct_objects = sorted(
        binding.object_name for binding in planned_bindings
        if binding.distinct_material
    )
    surface_resolved = bool(routing.get("surfaceResolved"))
    if tsl_ir_requested(material):
        _attach_tsl_ir(tree, channels, surface_resolved=surface_resolved)
    channel_plan = {
        "model": CHANNEL_PLAN_MODEL,
        "channels": channels,
        **({"surfaceResolved": True} if surface_resolved else {}),
        "consolidation": {
            "population": population,
            "bindings": len(planned_bindings),
            "sharedMaterial": (
                population != "unique" and not distinct_objects
            ),
            **({
                "distinctObjects": distinct_objects,
            } if distinct_objects else {}),
        },
        **({
            "wrapGateWindow": list(wrap_gate_window),
        } if wrap_gate_window is not None else {}),
    }
    blocked = bool(issues)
    return MaterialDecision(
        material.name, "materialBake",
        "blocked" if blocked else "lowered",
        None if blocked else "channels",
        "per-channel",
        None if blocked else "lit",
        tuple(planned_bindings),
        limitations=tuple(limitations),
        issues=tuple(issues),
        channel_plan=channel_plan,
    )


_SURFACE_BAKE_KINDS = {
    "baseColor": "Base Color",
    "alpha": "Alpha",
    "metallic": "Metallic",
    "roughness": "Roughness",
    "emission": "Emission",
}


def _material_bake_channel_material(
    decision: MaterialDecision, kind: str, created_materials: list,
):
    """Private per-channel proxy: the channel's field through an isolated
    Emission sink, or a neutral Principled keeping only the Normal chain for
    the NORMAL pass.  The artist's graph is copied, never mutated."""
    if (decision.channel_plan or {}).get("surfaceResolved"):
        channel_name = _SURFACE_BAKE_KINDS.get(kind)
        if channel_name is None:
            raise MaterialCompileError(
                f"Surface-resolved bake has no {kind!r} channel material."
            )
        surface_source = bpy.data.materials.get(decision.material_name)
        if surface_source is None:
            raise MaterialCompileError(
                f'Material "{decision.material_name}" disappeared before '
                "its surface channel bake."
            )
        return _surface_channel_bake_material(
            surface_source, channel_name, created_materials,
        )
    source = bpy.data.materials.get(decision.material_name)
    if source is None:
        raise MaterialCompileError(
            f'Material "{decision.material_name}" disappeared before its '
            "channel bake."
        )
    try:
        material = source.copy()
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise MaterialCompileError(
            f'Cannot create a private channel material from '
            f'"{decision.material_name}": {error}'
        ) from error
    created_materials.append(material)
    material.name = f"{PRIVATE_CHANNEL_PREFIX}{kind}.{decision.material_name}"
    material["blendlink_private_materialization"] = "cyclesEmit"
    tree, root = _principled_root_of(material)
    if tree is None or root is None:
        raise MaterialCompileError(
            f'Private channel copy of "{decision.material_name}" lost its '
            "Principled root."
        )

    def channel_source(name):
        socket = procedural._node_input(root, name)
        if socket is None or not socket.is_linked:
            return None, (
                float(socket.default_value)
                if socket is not None
                and isinstance(socket.default_value, (int, float))
                else tuple(socket.default_value)
                if socket is not None else None
            )
        return socket.links[0].from_socket, None

    sources = {}
    if kind == "baseColor":
        sources["color"], _ = channel_source("Base Color")
    elif kind == "alpha":
        sources["value"], _ = channel_source("Alpha")
    elif kind == "metallic":
        sources["value"], _ = channel_source("Metallic")
    elif kind == "roughness":
        sources["value"], _ = channel_source("Roughness")
    elif kind == "emission":
        sources["color"], sources["colorConstant"] = channel_source(
            "Emission Color",
        )
        sources["strength"], sources["strengthConstant"] = channel_source(
            "Emission Strength",
        )
    elif kind == "normal":
        sources["normal"], _ = channel_source("Normal")
    else:
        raise MaterialCompileError(f"unsupported channel bake kind {kind!r}")

    for output in [
        item for item in tree.nodes
        if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "BLENDLINK_PRIVATE_CHANNEL_OUTPUT"
    if hasattr(output, "is_active_output"):
        output.is_active_output = True

    if kind == "normal":
        if sources["normal"] is None:
            raise MaterialCompileError(
                f'Channel bake for "{decision.material_name}" has no linked '
                "Normal input."
            )
        sink = tree.nodes.new("ShaderNodeBsdfPrincipled")
        sink.name = "BLENDLINK_PRIVATE_CHANNEL_NORMAL_SINK"
        tree.links.new(sources["normal"], sink.inputs["Normal"])
        tree.links.new(sink.outputs["BSDF"], output.inputs["Surface"])
        return material

    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "BLENDLINK_PRIVATE_CHANNEL_EMIT"
    emission.inputs["Strength"].default_value = 1.0
    if kind == "emission":
        if sources["color"] is not None:
            tree.links.new(sources["color"], emission.inputs["Color"])
        elif sources["colorConstant"] is not None:
            emission.inputs["Color"].default_value = tuple(
                sources["colorConstant"],
            )
        if sources["strength"] is not None:
            tree.links.new(sources["strength"], emission.inputs["Strength"])
        elif sources["strengthConstant"] is not None:
            emission.inputs["Strength"].default_value = float(
                sources["strengthConstant"],
            )
    else:
        key = "color" if kind == "baseColor" else "value"
        if sources[key] is None:
            raise MaterialCompileError(
                f'Channel bake for "{decision.material_name}" has no linked '
                f"{kind} input."
            )
        tree.links.new(sources[key], emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def atlas_channel_tap(source, kind: str, created_materials: list):
    """A private channel-tap material for one MATERIAL-ATLAS member.

    Two deliberate differences from the per-material bake's tap
    (`_material_bake_channel_material`): unlinked Base Color / Metallic /
    Roughness channels tap their CONSTANT value instead of refusing — the
    atlas page is the only carrier, there is no per-material glTF factor
    for a constant to ride — and a missing Normal chain returns ``None``
    so the caller bakes the flat geometry normal for that member instead
    of refusing. Principled roots take the per-channel tap; surface-
    resolvable trees take the fold tap; anything else raises with the
    material named, which refuses the whole atlas loudly.
    """
    tree, root = _principled_root_of(source)
    if tree is None:
        raise MaterialCompileError(
            f'Material-atlas member "{source.name}" has no node tree to tap.'
        )
    if root is None:
        # The fold tap covers Mix-Shader/emission/coerced-colour surfaces
        # exactly as the surface-resolved per-material bake does.
        channel_name = _SURFACE_BAKE_KINDS.get(kind)
        if channel_name is None:
            if kind == "normal":
                return None
            raise MaterialCompileError(
                f'Material-atlas member "{source.name}" has no {kind!r} '
                "surface channel."
            )
        return _surface_channel_bake_material(
            source, channel_name, created_materials,
        )
    try:
        material = source.copy()
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise MaterialCompileError(
            f'Cannot create a private atlas channel material from '
            f'"{source.name}": {error}'
        ) from error
    created_materials.append(material)
    material.name = f"{PRIVATE_CHANNEL_PREFIX}atlas.{kind}.{source.name}"
    material["blendlink_private_materialization"] = "cyclesEmit"
    tree, root = _principled_root_of(material)
    if tree is None or root is None:
        raise MaterialCompileError(
            f'Private atlas channel copy of "{source.name}" lost its '
            "Principled root."
        )

    def channel_source(name):
        socket = procedural._node_input(root, name)
        if socket is None or not socket.is_linked:
            return None, (
                float(socket.default_value)
                if socket is not None
                and isinstance(socket.default_value, (int, float))
                else tuple(socket.default_value)
                if socket is not None else None
            )
        return socket.links[0].from_socket, None

    for output in [
        item for item in tree.nodes
        if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "BLENDLINK_PRIVATE_CHANNEL_OUTPUT"
    if hasattr(output, "is_active_output"):
        output.is_active_output = True

    if kind == "normal":
        normal_source, _constant = channel_source("Normal")
        if normal_source is None:
            created_materials.remove(material)
            bpy.data.materials.remove(material)
            return None
        sink = tree.nodes.new("ShaderNodeBsdfPrincipled")
        sink.name = "BLENDLINK_PRIVATE_CHANNEL_NORMAL_SINK"
        tree.links.new(normal_source, sink.inputs["Normal"])
        tree.links.new(sink.outputs["BSDF"], output.inputs["Surface"])
        return material

    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "BLENDLINK_PRIVATE_CHANNEL_EMIT"
    emission.inputs["Strength"].default_value = 1.0
    if kind == "emission":
        color_source, color_constant = channel_source("Emission Color")
        strength_source, strength_constant = channel_source(
            "Emission Strength",
        )
        if color_source is not None:
            tree.links.new(color_source, emission.inputs["Color"])
        elif color_constant is not None:
            emission.inputs["Color"].default_value = tuple(color_constant)
        if strength_source is not None:
            tree.links.new(strength_source, emission.inputs["Strength"])
        elif strength_constant is not None:
            emission.inputs["Strength"].default_value = float(
                strength_constant,
            )
    else:
        socket_name = {
            "baseColor": "Base Color", "alpha": "Alpha",
            "metallic": "Metallic", "roughness": "Roughness",
        }[kind]
        linked_source, constant = channel_source(socket_name)
        if linked_source is not None:
            tree.links.new(linked_source, emission.inputs["Color"])
        elif isinstance(constant, tuple):
            emission.inputs["Color"].default_value = (
                tuple(constant[:3]) + (1.0,)
            )
        elif isinstance(constant, float):
            emission.inputs["Color"].default_value = (
                constant, constant, constant, 1.0,
            )
        else:
            raise MaterialCompileError(
                f'Material-atlas member "{source.name}" has no usable '
                f"{kind!r} channel."
            )
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def plan_materials(objects, *, purpose: str = "inspect") -> MaterialPlan:
    """Plan every used material binding in an already resolved export scope."""
    if purpose not in {"inspect", "preview", "final"}:
        raise ValueError(f"material compiler purpose must be inspect, preview, or final, not {purpose!r}")
    scoped_objects = tuple(objects)
    decisions = tuple(
        _plan_selected_material(
            entry["material"],
            entry["bindings"],
            entry["issues"],
            purpose=purpose,
        )
        for _pointer, entry in sorted(
            _binding_map(scoped_objects).items(),
            key=lambda item: item[1]["material"].name.casefold(),
        )
    )
    encoded = json.dumps(
        {
            "planVersion": PLAN_VERSION,
            "purpose": purpose,
            "decisions": [decision.fingerprint_dict() for decision in decisions],
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf8")
    return MaterialPlan(
        purpose,
        hashlib.sha256(encoded).hexdigest(),
        decisions,
        scoped_objects,
    )


def merge_diagnostics(records: list, plan: MaterialPlan) -> None:
    """Add optional compilation evidence to existing portability records."""
    by_name = {decision.material_name: decision for decision in plan.decisions}
    for record in records:
        decision = by_name.get(record.get("material"))
        if decision is not None:
            record["materialCompilation"] = decision.as_dict()


def format_plan_errors(plan: MaterialPlan) -> str:
    return "\n".join(
        f'- {issue.material}: {issue.problem} {issue.fix}'
        for issue in plan.errors
    )


def _copy_material_setting(source, target, name: str) -> None:
    if not hasattr(source, name) or not hasattr(target, name):
        return
    try:
        setattr(target, name, getattr(source, name))
    except (AttributeError, TypeError, ValueError) as error:
        raise MaterialCompileError(
            f'Cannot preserve material setting "{name}" from "{source.name}": {error}'
        ) from error


def _variant_key(decision: MaterialDecision, binding: MaterialBinding) -> str:
    return json.dumps({
        "material": decision.material_name,
        "transport": decision.transport,
        "surfaceResponse": decision.surface_response,
        "surfaceFactorization": (
            decision.surface_factorization.fingerprint_dict()
            if decision.surface_factorization is not None else None
        ),
        "color": decision.color.fingerprint_dict() if decision.color else None,
        "alpha": decision.alpha.fingerprint_dict() if decision.alpha else None,
        "colorAttribute": binding.color_attribute,
        "alphaAttribute": binding.alpha_attribute,
        "alphaMode": binding.alpha_mode,
        "sourceHash": binding.source_hash,
        "materializationPlan": binding.materialization_plan,
        "uvName": binding.uv_name,
        "uvIndex": binding.uv_index,
        "channelPlan": _channel_plan_fingerprint(decision.channel_plan),
        "distinctBinding": (
            binding.object_name if binding.distinct_material else None
        ),
    }, sort_keys=True, separators=(",", ":"))


def exporter_overrides(plan: MaterialPlan) -> dict:
    """Stock-exporter settings required by this exact material plan.

    Blender's native material-to-vertex-color bookkeeping is not reliable for
    multiple selected materials on one Mesh.  A private custom attribute is
    therefore the transport carrier; unrelated authored color layers are not.
    The finished GLB is rewritten back to ordinary ``COLOR_0`` and attested.
    """
    if any(decision.transport == "vertexColor" for decision in plan.lowerings):
        return {
            "export_attributes": True,
            "export_all_vertex_colors": False,
        }
    return {}


def _private_color_semantic(
    decision: MaterialDecision,
    binding: MaterialBinding,
) -> str:
    token = hashlib.sha256(
        _variant_key(decision, binding).encode("utf8")
    ).hexdigest()[:10].upper()
    return f"{PRIVATE_COLOR_PREFIX}{token}"


def _ensure_private_color_carrier(
    mesh,
    decision: MaterialDecision,
    binding: MaterialBinding,
    installed: dict,
) -> str:
    """Copy one selected RGBA field to a compiler-owned Mesh attribute."""
    semantic = _private_color_semantic(decision, binding)
    key = (mesh.as_pointer(), semantic)
    source_name = binding.color_attribute
    source = (
        mesh.color_attributes.get(source_name)
        if source_name and getattr(mesh, "color_attributes", None) is not None
        else None
    )
    if source is None or source.domain not in {"POINT", "CORNER"} \
            or source.data_type not in {"FLOAT_COLOR", "BYTE_COLOR"}:
        raise MaterialCompileError(
            f'Cannot materialize Website Color for "{decision.material_name}" on '
            f'"{mesh.name}": source Mesh attribute {source_name!r} is absent or '
            "not a POINT/CORNER color attribute. Apply the modifier that creates "
            "the field, or select a source Mesh color attribute."
        )
    previous = installed.get(key)
    if previous is not None:
        if previous != (source.name, source.domain, source.data_type):
            raise MaterialCompileError(
                f'Private Website Color carrier {semantic!r} on "{mesh.name}" '
                "resolved to two different source attributes."
            )
        return semantic
    if mesh.color_attributes.get(semantic) is not None:
        raise MaterialCompileError(
            f'Mesh "{mesh.name}" already owns reserved attribute {semantic!r}. '
            f"Rename attributes beginning with {PRIVATE_COLOR_PREFIX!r} before publishing."
        )

    try:
        carrier = mesh.color_attributes.new(
            name=semantic,
            type=source.data_type,
            domain=source.domain,
        )
        if len(carrier.data) != len(source.data):
            raise MaterialCompileError(
                f'Private Website Color carrier on "{mesh.name}" has '
                f"{len(carrier.data)} values, expected {len(source.data)}."
            )
        preserve_alpha = (
            decision.alpha is not None
            and decision.alpha.kind == "vertexColor"
        )
        for source_item, carrier_item in zip(source.data, carrier.data):
            color = tuple(float(component) for component in source_item.color)
            if len(color) != 4 or any(not math.isfinite(component) for component in color):
                raise MaterialCompileError(
                    f'Website Color source {source.name!r} on "{mesh.name}" '
                    "contains a non-finite or malformed value."
                )
            carrier_item.color = (
                color if preserve_alpha else (color[0], color[1], color[2], 1.0)
            )
    except MaterialCompileError:
        raise
    except (AttributeError, ReferenceError, RuntimeError, TypeError, ValueError) as error:
        raise MaterialCompileError(
            f'Cannot create private Website Color carrier on "{mesh.name}": {error}'
        ) from error
    installed[key] = (source.name, source.domain, source.data_type)
    return semantic


def _materialized_bake_material(
    decision: MaterialDecision,
    created_materials: list,
):
    source = bpy.data.materials.get(decision.material_name)
    selected = decision.color
    if source is None or selected is None or selected.kind != "materialized":
        raise MaterialCompileError(
            f'Materialized plan for "{decision.material_name}" no longer resolves.'
        )
    try:
        material = source.copy()
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise MaterialCompileError(
            f'Cannot create a private selected-field material from '
            f'"{decision.material_name}": {error}'
        ) from error
    created_materials.append(material)
    material.name = f"BLENDLINK_PRIVATE_SELECTED.{decision.material_name}"
    material["blendlink_private_materialization"] = "cyclesEmit"
    markers = marker_nodes(material)
    if len(markers) != 1:
        raise MaterialCompileError(
            f'Private copy of "{decision.material_name}" has {len(markers)} '
            "Blendlink Web Color markers."
        )
    linked = _linked_source(markers[0], COLOR_INPUT)
    if linked is None:
        raise MaterialCompileError(
            f'Private copy of "{decision.material_name}" lost its selected Web Color.'
        )
    node, socket = linked
    if node.name != selected.node_name \
            or socket.identifier != selected.socket_identifier:
        raise MaterialCompileError(
            f'Private copy of "{decision.material_name}" resolved Web Color as '
            f'"{node.name} -> {socket.name}", expected '
            f'"{selected.node_name} -> {selected.socket_name}".'
        )
    tree = _active_tree(material)
    if tree is None:
        raise MaterialCompileError(
            f'Private copy of "{decision.material_name}" has no shader tree.'
        )
    for output in [
        item for item in tree.nodes
        if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "BLENDLINK_PRIVATE_SELECTED_OUTPUT"
    if hasattr(output, "is_active_output"):
        output.is_active_output = True
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.name = "BLENDLINK_PRIVATE_SELECTED_EMIT"
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(socket, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _generated_material(
    decision: MaterialDecision,
    binding: MaterialBinding,
    created_materials: list,
    materialization: dict | None = None,
):
    variant = _variant_key(decision, binding)
    token = hashlib.sha256(variant.encode("utf8")).hexdigest()[:10]
    source_material = bpy.data.materials.get(decision.material_name)
    if source_material is None or decision.color is None or decision.alpha is None:
        raise MaterialCompileError(
            f'Material plan for "{decision.material_name}" no longer resolves.'
        )
    if decision.surface_response not in {"lit", "unlit"}:
        raise MaterialCompileError(
            f'Material plan for "{decision.material_name}" has no proven surface response.'
        )
    if decision.surface_factorization is not None and (
        decision.surface_response != "lit"
        or decision.color.kind != "materialized"
        or materialization is None
    ):
        raise MaterialCompileError(
            f'Static shade-floor plan for "{decision.material_name}" has no '
            "complete selected-intrinsic image materialization."
        )
    generated = bpy.data.materials.new(
        f"{GENERATED_MATERIAL_PREFIX}{token}.{decision.material_name}"
    )
    # Track ownership at the first successful allocation. Setup below can
    # fail, and cleanup must still remove this partially configured ID.
    created_materials.append(generated)
    generated.use_nodes = True
    generated["blendlink_source_material"] = decision.material_name
    response_rule = decision.surface_response
    if decision.surface_factorization is not None:
        material_rule = "blendlink.lit.selected-field-static-shade-floor"
    elif decision.transport == "vertexColor":
        material_rule = f"blendlink.{response_rule}.vertex-color"
    elif decision.color.kind == "materialized":
        material_rule = f"blendlink.{response_rule}.selected-field"
    elif decision.transport == "image":
        material_rule = f"blendlink.{response_rule}.image"
    else:
        material_rule = f"blendlink.{response_rule}.constant"
    generated["blendlink_material_rule"] = material_rule
    generated["blendlink_material_variant"] = token
    for setting in (
        "diffuse_color", "use_backface_culling", "alpha_threshold",
        "use_transparency_overlap", "surface_render_method", "blend_method",
    ):
        _copy_material_setting(source_material, generated, setting)
    tree = generated.node_tree
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")

    if decision.color.kind == "vertexColor":
        color_node = tree.nodes.new("ShaderNodeVertexColor")
        color_node.layer_name = binding.color_attribute or ""
        color_socket = color_node.outputs["Color"]
    elif decision.color.kind in {"image", "materialized"}:
        if decision.color.kind == "materialized":
            if materialization is None:
                raise MaterialCompileError(
                    f'Materialized image for "{decision.material_name}" is absent.'
                )
            image = materialization.get("image")
            interpolation = "Linear"
            extension = "EXTEND"
            projection = "FLAT"
            uv_name = materialization.get("uvName")
        else:
            image = bpy.data.images.get(decision.color.image_name or "")
            interpolation = decision.color.interpolation
            extension = decision.color.extension
            projection = decision.color.projection
            uv_name = (
                decision.color.uv_name
                if decision.color.uv_mode == "named" else None
            )
        if image is None:
            raise MaterialCompileError(
                f'Image {decision.color.image_name!r} for "{decision.material_name}" '
                "disappeared after planning."
            )
        color_node = tree.nodes.new("ShaderNodeTexImage")
        color_node.name = decision.color.node_name
        color_node.image = image
        color_node.interpolation = interpolation
        color_node.extension = extension
        color_node.projection = projection
        if uv_name:
            uv_node = tree.nodes.new("ShaderNodeUVMap")
            uv_node.uv_map = uv_name
            tree.links.new(uv_node.outputs["UV"], color_node.inputs["Vector"])
        color_socket = color_node.outputs["Color"]
    else:
        color_node = tree.nodes.new("ShaderNodeRGB")
        color_node.outputs["Color"].default_value = decision.color.value
        color_socket = color_node.outputs["Color"]

    alpha_is_vertex = decision.alpha.kind == "vertexColor"
    alpha_value = decision.alpha.value[0] if decision.alpha.value is not None else 1.0
    alpha_mode = binding.alpha_mode
    if alpha_mode not in {"OPAQUE", "MASK", "BLEND"}:
        raise MaterialCompileError(
            f'Material plan for "{decision.material_name}" has no proven alpha mode '
            f'for "{binding.object_name}[{binding.slot_index}]".'
        )
    uses_alpha = alpha_mode != "OPAQUE"
    alpha_socket = None
    if uses_alpha:
        if alpha_is_vertex:
            if decision.color.kind == "vertexColor" \
                    and binding.alpha_attribute == binding.color_attribute:
                alpha_socket = color_node.outputs["Alpha"]
            else:
                alpha_node = tree.nodes.new("ShaderNodeVertexColor")
                alpha_node.layer_name = binding.alpha_attribute or ""
                alpha_socket = alpha_node.outputs["Alpha"]
        else:
            alpha_node = tree.nodes.new("ShaderNodeValue")
            alpha_node.outputs["Value"].default_value = alpha_value
            alpha_socket = alpha_node.outputs["Value"]
        if alpha_mode == "MASK":
            clip = tree.nodes.new("ShaderNodeMath")
            clip.operation = "ROUND"
            tree.links.new(alpha_socket, clip.inputs[0])
            alpha_socket = clip.outputs[0]

    if decision.surface_response == "lit":
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
        principled.inputs["Metallic"].default_value = 0.0
        principled.inputs["Roughness"].default_value = 0.5
        base_color_socket = color_socket
        if decision.surface_factorization is not None:
            def multiply_color(source_socket, factor, name):
                multiply = tree.nodes.new("ShaderNodeMix")
                multiply.name = name
                multiply.data_type = "RGBA"
                multiply.blend_type = "MULTIPLY"
                multiply.clamp_factor = True
                multiply.clamp_result = False
                factor_input = next(
                    item for item in multiply.inputs
                    if item.identifier == "Factor_Float"
                )
                color_a = next(
                    item for item in multiply.inputs
                    if item.identifier == "A_Color"
                )
                color_b = next(
                    item for item in multiply.inputs
                    if item.identifier == "B_Color"
                )
                result = next(
                    item for item in multiply.outputs
                    if item.identifier == "Result_Color"
                )
                factor_input.default_value = 1.0
                color_b.default_value = tuple(factor) + (1.0,)
                tree.links.new(source_socket, color_a)
                return result

            base_color_socket = multiply_color(
                color_socket,
                decision.surface_factorization.base_color_factor,
                "BLENDLINK_WEB_INTRINSIC_DIRECT_FACTOR",
            )
            emissive_socket = multiply_color(
                color_socket,
                decision.surface_factorization.emissive_factor,
                "BLENDLINK_WEB_STATIC_SHADE_FACTOR",
            )
            tree.links.new(
                emissive_socket,
                principled.inputs["Emission Color"],
            )
            principled.inputs["Emission Strength"].default_value = 1.0
        tree.links.new(base_color_socket, principled.inputs["Base Color"])
        if uses_alpha:
            tree.links.new(alpha_socket, principled.inputs["Alpha"])
        tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        if uses_alpha:
            if hasattr(generated, "surface_render_method"):
                try:
                    generated.surface_render_method = "DITHERED"
                except (TypeError, ValueError) as error:
                    raise MaterialCompileError(
                        f'Cannot configure alpha blending for generated material '
                        f'"{generated.name}": {error}'
                    ) from error
            elif hasattr(generated, "blend_method"):
                generated.blend_method = "BLEND"
        return generated

    if not uses_alpha:
        background = tree.nodes.new("ShaderNodeBackground")
        tree.links.new(color_socket, background.inputs["Color"])
        tree.links.new(background.outputs["Background"], output.inputs["Surface"])
        return generated

    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    tree.links.new(transparent.outputs[0], mix.inputs[1])
    # The official unlit gatherer deliberately recognizes an RGBA socket
    # linked directly into the non-transparent Mix branch.
    tree.links.new(color_socket, mix.inputs[2])
    tree.links.new(alpha_socket, mix.inputs[0])
    tree.links.new(mix.outputs[0], output.inputs["Surface"])
    if hasattr(generated, "surface_render_method"):
        try:
            generated.surface_render_method = "DITHERED"
        except (TypeError, ValueError) as error:
            raise MaterialCompileError(
                f'Cannot configure alpha blending for generated material "{generated.name}": {error}'
            ) from error
    elif hasattr(generated, "blend_method"):
        generated.blend_method = "BLEND"
    return generated


def _read_glb(path: str) -> tuple[dict, bytes]:
    try:
        document, chunks, _json_index = glblib.read_document(
            path, "attest material output in",
        )
        binary = glblib.binary_chunk(chunks, "attest material output in")
    except (OSError, ValueError) as error:
        raise MaterialCompileError(str(error)) from error
    return document, binary


_ACCESSOR_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
}
_ACCESSOR_FORMATS = {
    5120: ("b", 1),
    5121: ("B", 1),
    5122: ("h", 2),
    5123: ("H", 2),
    5125: ("I", 4),
    5126: ("f", 4),
}


def _normalized_component(value, component_type: int):
    if component_type == 5120:
        return max(float(value) / 127.0, -1.0)
    if component_type == 5121:
        return float(value) / 255.0
    if component_type == 5122:
        return max(float(value) / 32767.0, -1.0)
    if component_type == 5123:
        return float(value) / 65535.0
    return float(value)


def _accessor_values(document: dict, binary: bytes, accessor_index: int):
    accessors = document.get("accessors") or []
    views = document.get("bufferViews") or []
    if not (0 <= accessor_index < len(accessors)):
        raise MaterialCompileError(f"glTF accessor {accessor_index} does not exist.")
    accessor = accessors[accessor_index]
    if accessor.get("sparse") is not None or accessor.get("bufferView") is None:
        raise MaterialCompileError(
            f"glTF accessor {accessor_index} uses unsupported sparse or missing storage."
        )
    component_type = int(accessor.get("componentType", -1))
    format_info = _ACCESSOR_FORMATS.get(component_type)
    components = _ACCESSOR_COMPONENTS.get(accessor.get("type"))
    view_index = int(accessor["bufferView"])
    if format_info is None or components is None or not (0 <= view_index < len(views)):
        raise MaterialCompileError(f"glTF accessor {accessor_index} has unsupported storage metadata.")
    view = views[view_index]
    if int(view.get("buffer", 0)) != 0:
        raise MaterialCompileError(f"glTF accessor {accessor_index} does not reference the GLB binary buffer.")
    code, component_bytes = format_info
    item_bytes = component_bytes * components
    stride = int(view.get("byteStride", item_bytes))
    if stride < item_bytes:
        raise MaterialCompileError(f"glTF accessor {accessor_index} has an invalid byte stride.")
    offset = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    count = int(accessor.get("count", 0))
    if count <= 0 or offset < 0 or offset + (count - 1) * stride + item_bytes > len(binary):
        raise MaterialCompileError(f"glTF accessor {accessor_index} points outside the GLB binary chunk.")
    unpack = struct.Struct("<" + code * components).unpack_from
    normalized = bool(accessor.get("normalized", False))
    result = []
    for item_index in range(count):
        values = unpack(binary, offset + item_index * stride)
        if normalized:
            values = tuple(_normalized_component(value, component_type) for value in values)
        else:
            values = tuple(float(value) for value in values)
        if any(not math.isfinite(value) for value in values):
            raise MaterialCompileError(f"glTF accessor {accessor_index} contains a non-finite value.")
        result.append(tuple(values))
    return accessor, tuple(result)


def _accessor_range(document: dict, binary: bytes, accessor_index: int):
    accessor, values = _accessor_values(document, binary, accessor_index)
    components = _ACCESSOR_COMPONENTS[accessor["type"]]
    minima = tuple(min(value[index] for value in values) for index in range(components))
    maxima = tuple(max(value[index] for value in values) for index in range(components))
    return accessor, minima, maxima


_UV_TRIANGLE_DOMAIN = b"blendlink:uv-geometry-triangle:v1\0"
_UV_ASSOCIATION_DOMAIN = b"blendlink:uv-geometry-association:v1\0"
_UV_TRIANGLE_DIGEST_BYTES = 32
_UV_TRIANGLE_SORT_CHUNK_RECORDS = 65_536


def _mesh_position_grid(
    document: dict,
    binary: bytes,
    mesh_index: int,
    accessor_cache: dict,
) -> dict:
    """Mirror glTF-Transform 4.4.1's mesh POSITION quantization volume."""
    meshes = document.get("meshes") or []
    if not (0 <= mesh_index < len(meshes)):
        raise MaterialCompileError(
            f"glTF mesh {mesh_index} does not exist for UV geometry evidence."
        )
    base_accessors = []
    relative_accessors = []
    for primitive in meshes[mesh_index].get("primitives") or []:
        attributes = primitive.get("attributes") or {}
        if attributes.get("POSITION") is not None:
            base_accessors.append(int(attributes["POSITION"]))
        for target in primitive.get("targets") or []:
            if target.get("POSITION") is not None:
                relative_accessors.append(int(target["POSITION"]))
    if not base_accessors:
        raise MaterialCompileError(
            f"glTF mesh {mesh_index} has no POSITION data for UV geometry evidence."
        )

    def values(accessor_index: int):
        if accessor_index not in accessor_cache:
            accessor_cache[accessor_index] = _accessor_values(
                document, binary, accessor_index,
            )
        accessor, result = accessor_cache[accessor_index]
        if accessor.get("type") != "VEC3":
            raise MaterialCompileError(
                f"glTF mesh {mesh_index} POSITION accessor {accessor_index} "
                f"uses {accessor.get('type')!r}, expected VEC3."
            )
        return result

    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    for accessor_index in base_accessors:
        for value in values(accessor_index):
            for component in range(3):
                minimum[component] = min(minimum[component], value[component])
                maximum[component] = max(maximum[component], value[component])

    if relative_accessors:
        relative_minimum = [math.inf, math.inf, math.inf]
        relative_maximum = [-math.inf, -math.inf, -math.inf]
        for accessor_index in relative_accessors:
            for value in values(accessor_index):
                for component in range(3):
                    relative_minimum[component] = min(
                        relative_minimum[component], value[component],
                    )
                    relative_maximum[component] = max(
                        relative_maximum[component], value[component],
                    )
        for component in range(3):
            minimum[component] = min(
                minimum[component],
                relative_minimum[component],
                relative_minimum[component] * 2.0,
                0.0,
            )
            maximum[component] = max(
                maximum[component],
                relative_maximum[component],
                relative_maximum[component] * 2.0,
                0.0,
            )

    if any(
        not math.isfinite(value)
        for value in (*minimum, *maximum)
    ):
        raise MaterialCompileError(
            f"glTF mesh {mesh_index} has non-finite POSITION bounds."
        )
    offset = tuple(
        minimum[component]
        + (maximum[component] - minimum[component]) / 2.0
        for component in range(3)
    )
    scale = max(
        (maximum[component] - minimum[component]) / 2.0
        for component in range(3)
    )
    if not math.isfinite(scale) or scale < 0.0:
        raise MaterialCompileError(
            f"glTF mesh {mesh_index} has an invalid POSITION scale {scale!r}."
        )
    return {
        "mesh": mesh_index,
        "bits": 14,
        "offset": offset,
        "scale": scale,
    }


def _canonical_position_code(value: float) -> int:
    clamped = min(1.0, max(-1.0, float(value)))
    magnitude = math.floor(abs(clamped) * 8191.0 + 0.5)
    return -magnitude if clamped < 0.0 else magnitude


def _canonical_triangle_rotation(corners: tuple[bytes, bytes, bytes]) -> bytes:
    return min(
        b"".join(corners[index:] + corners[:index])
        for index in range(3)
    )


def _hash_sorted_triangle_digests(digests, association_header: bytes) -> dict:
    chunk = []
    paths = []
    temporary = None
    triangle_count = 0

    def flush():
        nonlocal chunk, temporary
        if not chunk:
            return
        if temporary is None:
            temporary = tempfile.TemporaryDirectory(
                prefix="blendlink-material-attestation-",
            )
        chunk.sort()
        path = os.path.join(temporary.name, f"run-{len(paths)}.bin")
        with open(path, "wb") as stream:
            stream.write(b"".join(chunk))
        paths.append(path)
        chunk = []

    try:
        for digest in digests:
            if len(digest) != _UV_TRIANGLE_DIGEST_BYTES:
                raise MaterialCompileError(
                    f"UV triangle digest has {len(digest)} bytes; expected 32."
                )
            chunk.append(digest)
            triangle_count += 1
            if len(chunk) >= _UV_TRIANGLE_SORT_CHUNK_RECORDS:
                flush()

        result = hashlib.sha256()
        result.update(_UV_ASSOCIATION_DOMAIN)
        result.update(association_header)
        result.update(struct.pack("<Q", triangle_count))
        if not paths:
            for digest in sorted(chunk):
                result.update(digest)
            return {
                "hash": result.hexdigest(),
                "triangleCount": triangle_count,
            }

        flush()
        streams = []
        heap = []
        try:
            for index, path in enumerate(paths):
                stream = open(path, "rb")
                streams.append(stream)
                digest = stream.read(_UV_TRIANGLE_DIGEST_BYTES)
                if len(digest) != _UV_TRIANGLE_DIGEST_BYTES:
                    raise MaterialCompileError(
                        f"Sorted UV attestation run {path!r} is truncated."
                    )
                heapq.heappush(heap, (digest, index))
            while heap:
                digest, index = heapq.heappop(heap)
                result.update(digest)
                following = streams[index].read(_UV_TRIANGLE_DIGEST_BYTES)
                if following:
                    if len(following) != _UV_TRIANGLE_DIGEST_BYTES:
                        raise MaterialCompileError(
                            "Sorted UV attestation run ended with a partial digest."
                        )
                    heapq.heappush(heap, (following, index))
        finally:
            for stream in streams:
                stream.close()
        return {
            "hash": result.hexdigest(),
            "triangleCount": triangle_count,
        }
    finally:
        if temporary is not None:
            temporary.cleanup()


def _uv_geometry_association(
    document: dict,
    binary: bytes,
    primitive_entries,
    tex_coord: int,
) -> dict:
    accessor_cache = {}
    mesh_indices = sorted({
        mesh_index for mesh_index, _primitive_index, _primitive
        in primitive_entries
    })
    grids = [
        _mesh_position_grid(
            document, binary, mesh_index, accessor_cache,
        )
        for mesh_index in mesh_indices
    ]
    grid_by_mesh = {grid["mesh"]: grid for grid in grids}
    header = bytearray(struct.pack("<2I", tex_coord, len(grids)))
    for grid in grids:
        header.extend(struct.pack(
            "<I4dI",
            grid["mesh"],
            *grid["offset"],
            grid["scale"],
            grid["bits"],
        ))

    def accessor_values(accessor_index: int):
        if accessor_index not in accessor_cache:
            accessor_cache[accessor_index] = _accessor_values(
                document, binary, accessor_index,
            )
        return accessor_cache[accessor_index]

    def triangle_digests():
        for mesh_index, primitive_index, primitive in primitive_entries:
            mode = int(primitive.get("mode", 4))
            if mode != 4:
                raise MaterialCompileError(
                    f"Generated primitive {mesh_index}:{primitive_index} "
                    "is not TRIANGLES mode."
                )
            attributes = primitive.get("attributes") or {}
            position_index = attributes.get("POSITION")
            uv_index = attributes.get(f"TEXCOORD_{tex_coord}")
            if position_index is None or uv_index is None:
                raise MaterialCompileError(
                    f"Generated primitive {mesh_index}:{primitive_index} "
                    f"omits POSITION or TEXCOORD_{tex_coord}."
                )
            position_accessor, positions = accessor_values(int(position_index))
            uv_accessor, uvs = accessor_values(int(uv_index))
            if position_accessor.get("type") != "VEC3" \
                    or int(position_accessor.get("componentType", -1)) != 5126 \
                    or bool(position_accessor.get("normalized", False)):
                raise MaterialCompileError(
                    f"Generated primitive {mesh_index}:{primitive_index} "
                    "does not use source Float32 POSITION data."
                )
            if uv_accessor.get("type") != "VEC2" or len(uvs) != len(positions):
                raise MaterialCompileError(
                    f"Generated primitive {mesh_index}:{primitive_index} "
                    f"has count-mismatched TEXCOORD_{tex_coord} data."
                )
            if primitive.get("indices") is None:
                indices = tuple(range(len(positions)))
            else:
                index_accessor, index_values = accessor_values(
                    int(primitive["indices"]),
                )
                if index_accessor.get("type") != "SCALAR":
                    raise MaterialCompileError(
                        f"Generated primitive {mesh_index}:{primitive_index} "
                        "uses non-SCALAR indices."
                    )
                indices = tuple(int(value[0]) for value in index_values)
                if any(
                    float(index) != value[0]
                    for index, value in zip(indices, index_values)
                ):
                    raise MaterialCompileError(
                        f"Generated primitive {mesh_index}:{primitive_index} "
                        "contains non-integral indices."
                    )
            if not indices or len(indices) % 3:
                raise MaterialCompileError(
                    f"Generated primitive {mesh_index}:{primitive_index} "
                    f"has {len(indices)} rendered corners, expected triangles."
                )
            grid = grid_by_mesh[mesh_index]
            primitive_header = struct.pack(
                "<4I", mesh_index, primitive_index, mode, tex_coord,
            )
            for triangle in range(0, len(indices), 3):
                corners = []
                for vertex in indices[triangle:triangle + 3]:
                    if not (0 <= vertex < len(positions)):
                        raise MaterialCompileError(
                            f"Generated primitive {mesh_index}:{primitive_index} "
                            f"references out-of-range vertex {vertex}."
                        )
                    position = positions[vertex]
                    uv = uvs[vertex]
                    codes = tuple(
                        _canonical_position_code(
                            (
                                position[component] - grid["offset"][component]
                            ) / grid["scale"]
                            if grid["scale"] > 0.0 else 0.0
                        )
                        for component in range(3)
                    )
                    corners.append(struct.pack(
                        "<3h2f",
                        *codes,
                        _float32(uv[0]),
                        _float32(uv[1]),
                    ))
                digest = hashlib.sha256()
                digest.update(_UV_TRIANGLE_DOMAIN)
                digest.update(primitive_header)
                digest.update(_canonical_triangle_rotation(tuple(corners)))
                yield digest.digest()

    aggregate = _hash_sorted_triangle_digests(
        triangle_digests(), bytes(header),
    )
    return {
        "algorithm": "mesh-position14-uv-triangles-v1",
        **aggregate,
        "positionGrids": [{
            **grid,
            "offset": list(grid["offset"]),
        } for grid in grids],
    }


def _close_vector(actual, expected, tolerance: float) -> bool:
    return len(actual) == len(expected) and all(
        abs(float(left) - float(right)) <= tolerance
        for left, right in zip(actual, expected)
    )


def _resolve_generated_material(document: dict, generated_name: str, fact: dict):
    materials = document.get("materials") or []
    matches = [
        (index, material) for index, material in enumerate(materials)
        if material.get("name") == generated_name
        or (
            (material.get("extras") or {}).get("blendlink_source_material") == fact["source"]
            and (material.get("extras") or {}).get("blendlink_material_rule") == fact["rule"]
            and (material.get("extras") or {}).get("blendlink_material_variant") == fact["variant"]
        )
    ]
    if not matches:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": generated material '
            f'"{generated_name}" is absent. Blendlink cannot attest an omitted binding.'
        )
    if len(matches) != 1:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": expected one generated '
            f"stock glTF material, found {len(matches)}."
        )
    return matches[0]


def _buffer_view_payload(document: dict, binary: bytes, view_index: int) -> bytes:
    views = document.get("bufferViews") or []
    if not (0 <= view_index < len(views)):
        raise MaterialCompileError(f"glTF bufferView {view_index} does not exist.")
    view = views[view_index]
    if int(view.get("buffer", 0)) != 0:
        raise MaterialCompileError(
            f"glTF bufferView {view_index} does not reference the GLB binary buffer."
        )
    offset = int(view.get("byteOffset", 0))
    length = int(view.get("byteLength", -1))
    if offset < 0 or length < 0 or offset + length > len(binary):
        raise MaterialCompileError(f"glTF bufferView {view_index} points outside the GLB.")
    return binary[offset:offset + length]


# Three r184's GLTFLoader maps only TEXCOORD_0..3 onto geometry (its
# ATTRIBUTES table stops at 'uv3'); a material that asks for a higher
# channel gets vec2(0,0) and silently samples the atlas gutter, which is
# transparent. Blendlink refuses instead of shipping that.
MAX_BINDABLE_TEX_COORD = 3


def _sampled_uv_map_names(material) -> set:
    """UV maps a material samples by name through its shader graph."""
    names = set()
    tree = getattr(material, "node_tree", None) if material else None
    if tree is None:
        return names
    for node in tree.nodes:
        if node.bl_idname == "ShaderNodeUVMap" and node.uv_map:
            names.add(str(node.uv_map))
        # A Geometry-domain Attribute can address a UV layer by name.
        elif node.bl_idname == "ShaderNodeAttribute" \
                and getattr(node, "attribute_type", "GEOMETRY") == "GEOMETRY" \
                and node.attribute_name:
            names.add(str(node.attribute_name))
    return names


def _prune_unpublished_uv_layers(data_swaps, generated_facts, log=print) -> int:
    """Drop UV layers nothing in the published output samples.

    The private bake layer is appended after the artist's UV sets, so a mesh
    authored with five or six of them exports the atlas as TEXCOORD_4+ —
    past the TEXCOORD_0..3 that Three can bind.  Meshes routed entirely
    through the bake carry those authored sets for nothing.

    The keep set is deliberately conservative: every Blendlink-owned layer,
    every layer a surviving artist material names, every layer the TSL
    runtime resolves, and — whenever any artist material survives on the
    mesh — the active-render layer, because a texture with no explicit UV
    Map node samples it.  This mirrors the legacy appearance prune in
    export_scene.py, which collapses its atlas to TEXCOORD_0 the same way.
    """
    runtime_uv_names = {}
    for fact in generated_facts.values():
        for object_name, entry in (fact.get("tslRuntimeMeshes") or {}).items():
            runtime_uv_names.setdefault(object_name, set()).update(
                str(name) for name in (entry.get("uvChannels") or {})
            )

    # Transports other than the per-channel bake pin a TEXCOORD index at
    # PLAN time and attest against it, so reordering their layers would
    # invalidate evidence that is already fixed. Only meshes whose
    # generated materials all read their index back out of the emitted
    # glTF (the "channels" bake) are safe to prune.
    index_pinned_materials = {
        name for name, fact in generated_facts.items()
        if fact.get("transport") != "channels"
    }

    removed_total = 0
    for swap in data_swaps:
        mesh = swap["private"]
        layers = getattr(mesh, "uv_layers", None)
        if not layers or len(layers) <= 1:
            continue
        keep = {
            layer.name for layer in layers
            if layer.name.startswith(bakelib.MATERIAL_ATLAS_UV)
            or layer.name.startswith(bakelib.ATLAS_UV)
        }
        artist_material_present = False
        index_pinned = False
        for object_name in swap["objects"]:
            obj = bpy.data.objects.get(object_name)
            if obj is None:
                continue
            keep |= runtime_uv_names.get(object_name, set())
            for slot in obj.material_slots:
                material = slot.material
                if material is None:
                    continue
                if material.name in generated_facts:
                    if material.name in index_pinned_materials:
                        index_pinned = True
                    continue
                artist_material_present = True
                keep |= _sampled_uv_map_names(material)
        if index_pinned:
            continue
        if artist_material_present:
            active = next(
                (layer.name for layer in layers if layer.active_render),
                layers[0].name,
            )
            keep.add(active)
        doomed = [layer for layer in layers if layer.name not in keep]
        if not doomed or len(doomed) == len(layers):
            continue
        for layer in doomed:
            layers.remove(layer)
        removed_total += len(doomed)
        log(
            f"blendlink: pruned {len(doomed)} unpublished UV layer(s) from "
            f"{mesh.name!r}; kept {[layer.name for layer in layers]}"
        )

    if removed_total:
        # Layer order is the exporter's TEXCOORD order, so every recorded
        # index moved. Re-resolve them against the pruned meshes.
        for fact in generated_facts.values():
            for object_name, entry in (fact.get("tslRuntimeMeshes") or {}).items():
                channels = entry.get("uvChannels") or {}
                if not channels:
                    continue
                obj = bpy.data.objects.get(object_name)
                layer_names = [layer.name for layer in obj.data.uv_layers] \
                    if obj is not None else []
                for name in list(channels):
                    if name not in layer_names:
                        raise MaterialCompileError(
                            f'UV pruning removed {name!r} from "{object_name}", '
                            "which the TSL runtime resolves."
                        )
                    channels[name] = layer_names.index(name)
    return removed_total


def _refuse_unbindable_tex_coord(source: str, tex_coord: int, channel: str) -> None:
    if tex_coord <= MAX_BINDABLE_TEX_COORD:
        return
    raise MaterialCompileError(
        f'Material output mismatch for "{source}": the baked {channel} '
        f"texture samples TEXCOORD_{tex_coord}, but Three.js binds only "
        f"TEXCOORD_0..{MAX_BINDABLE_TEX_COORD}. A mesh carrying this "
        "material has too many UV maps for the private bake layer to land "
        "in a bindable channel; remove the UV maps the website does not "
        "use, or keep the object Realtime."
    )


def _attest_material_bake_texture(
    document: dict,
    binary: bytes,
    fact: dict,
    texture_info,
    image_fact: dict,
    channel: str,
) -> dict:
    """One channel texture: embedded bytes, MIME, dimensions, sampler wrap."""
    if not isinstance(texture_info, dict):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": the baked '
            f"{channel} channel did not emit its texture slot."
        )
    textures = document.get("textures") or []
    texture_index = int(texture_info.get("index", -1))
    if not (0 <= texture_index < len(textures)):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": {channel} '
            "texture is absent."
        )
    texture = textures[texture_index]
    images = document.get("images") or []
    image_index = int(texture.get("source", -1))
    if not (0 <= image_index < len(images)):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": {channel} '
            "texture source image is absent."
        )
    image = images[image_index]
    if image.get("uri") is not None or image.get("bufferView") is None:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": the baked '
            f"{channel} image is not embedded in the GLB."
        )
    payload = _buffer_view_payload(document, binary, int(image["bufferView"]))
    actual_hash = hashlib.sha256(payload).hexdigest()
    if image.get("mimeType") != image_fact["mime"] \
            or actual_hash != image_fact["sha256"]:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": baked '
            f"{channel} image bytes or MIME changed (got "
            f'{image.get("mimeType")!r}/{actual_hash}, expected '
            f'{image_fact["mime"]!r}/{image_fact["sha256"]}).'
        )
    encoded = _encoded_image_info(payload)
    if encoded != (
        image_fact["mime"], image_fact["width"], image_fact["height"],
    ):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": baked '
            f"{channel} image dimensions changed from "
            f"{image_fact['width']}x{image_fact['height']}."
        )
    samplers = document.get("samplers") or []
    sampler = {}
    if texture.get("sampler") is not None:
        sampler_index = int(texture["sampler"])
        if 0 <= sampler_index < len(samplers):
            sampler = samplers[sampler_index]
    expected_wrap = 33071 if image_fact.get("uv") == "unique" else 10497
    actual_wrap = (
        int(sampler.get("wrapS", 10497)), int(sampler.get("wrapT", 10497)),
    )
    if actual_wrap != (expected_wrap, expected_wrap):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": baked '
            f"{channel} sampler wrap {actual_wrap!r} does not match the "
            f'{image_fact.get("uv")} route.'
        )
    baked_tex_coord = int(texture_info.get("texCoord", 0))
    _refuse_unbindable_tex_coord(fact["source"], baked_tex_coord, channel)
    return {
        "textureIndex": texture_index,
        "imageSha256": actual_hash,
        "imageMime": image.get("mimeType"),
        "imageWidth": image_fact["width"],
        "imageHeight": image_fact["height"],
        "texCoord": baked_tex_coord,
        "wrap": expected_wrap,
    }


def _attest_material_bake_channels(
    document: dict,
    binary: bytes,
    pbr: dict,
    emitted: dict,
    fact: dict,
    primitive_entries=(),
) -> dict:
    """Per-channel texture attestation for one material-bake carrier."""
    bake = fact.get("materialBake") or {}
    planned = bake.get("images") or {}
    channel_evidence = {}

    def attest_page_rect(kind, image_fact, texture_info):
        """A shared-page member must sample ITS rect, proven from the
        emitted accessors: with N materials on one page every whole-image
        byte check passes by construction, so the sub-rect claim is the
        accessor min/max of this carrier's TEXCOORD lying inside the
        planned rect (glTF V runs downward, so the rect's v-band flips).
        The AABB is the honest granularity here -- the full triangle-hash
        association is the image transport's machinery and a separate
        gap."""
        rect = image_fact.get("pageRect")
        page = image_fact.get("page")
        if not rect or not page:
            return None
        x0, y0, size = (int(rect[0]), int(rect[1]), int(rect[2]))
        page = int(page)
        tex_coord = int(texture_info.get("texCoord", 0) or 0)
        tolerance = 1.0 / page
        u_min = x0 / page - tolerance
        u_max = (x0 + size) / page + tolerance
        v_min = 1.0 - (y0 + size) / page - tolerance
        v_max = 1.0 - y0 / page + tolerance
        checked = 0
        for _mesh_index, _primitive_index, primitive in primitive_entries:
            attributes = primitive.get("attributes") or {}
            accessor_index = attributes.get(f"TEXCOORD_{tex_coord}")
            if accessor_index is None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": a '
                    f"page-member primitive lacks TEXCOORD_{tex_coord}."
                )
            # TEXCOORD accessors are not required to publish min/max
            # (only POSITION is), so the range is computed from the
            # payload bytes like the vertex-color attestation does.
            _accessor, low, high = _accessor_range(
                document, binary, int(accessor_index),
            )
            if low[0] < u_min or high[0] > u_max                     or low[1] < v_min or high[1] > v_max:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": '
                    f"{kind} UVs [{low[0]:.4f},{low[1]:.4f}].."
                    f"[{high[0]:.4f},{high[1]:.4f}] escape the attested "
                    f"page rect ({x0},{y0})+{size}/{page}."
                )
            checked += 1
        if checked == 0:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": page '
                "rect attestation found no primitives to check."
            )
        return {
            "pageRect": [x0, y0, size],
            "page": page,
            "primitivesChecked": checked,
        }

    slots = {
        "baseColor": pbr.get("baseColorTexture"),
        "orm": pbr.get("metallicRoughnessTexture"),
        "normal": emitted.get("normalTexture"),
        "emissive": emitted.get("emissiveTexture"),
    }
    for kind, texture_info in slots.items():
        image_fact = planned.get(kind)
        if image_fact is None:
            if texture_info is not None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": an '
                    f"unplanned {kind} texture shipped."
                )
            continue
        channel_evidence[kind] = _attest_material_bake_texture(
            document, binary, fact, texture_info, image_fact, kind,
        )
        rect_evidence = attest_page_rect(kind, image_fact, texture_info)
        if rect_evidence is not None:
            channel_evidence[kind].update(rect_evidence)
    if emitted.get("occlusionTexture") is not None:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": an unplanned '
            "occlusion texture shipped."
        )
    emissive_fact = planned.get("emissive")
    if emissive_fact is None:
        # The emissive factor has to be attested whether or not an image
        # shipped, because glTF multiplies the two. A carrier that drops its
        # emissive image and keeps emissiveFactor at the identity does not
        # stop emitting -- it emits FULL WHITE. That is the exact failure the
        # constant-channel elision would introduce, and until this branch
        # existed nothing in either language could see it: the whole check
        # below sat under "if an emissive image was planned".
        #
        # Measured on the ellie character: every generated carrier that plans
        # no emissive image emits (0, 0, 0), and the one material in the scene
        # that is genuinely emissive white (ellie.highlights) is not compiled
        # and never reaches this attestation. So black is the invariant here,
        # not merely the common case. When the elision starts folding a
        # non-zero constant emission into the factor it must record the
        # expected value on the plan and this branch must compare against it
        # -- widening it silently would give the elision back the hole.
        emitted_factor = tuple(emitted.get("emissiveFactor", (0.0, 0.0, 0.0)))
        if not _close_vector(emitted_factor, (0.0, 0.0, 0.0), 1e-6):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": no emissive '
                f"texture was planned, but emissive factor {emitted_factor!r} "
                "is not black, so the material emits light the bake never "
                "measured."
            )
        extensions = emitted.get("extensions") or {}
        if "KHR_materials_emissive_strength" in extensions:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": no emissive '
                "texture was planned, but KHR_materials_emissive_strength "
                "shipped."
            )
    if emissive_fact is not None:
        emitted_factor = tuple(emitted.get("emissiveFactor", (0.0, 0.0, 0.0)))
        if not _close_vector(emitted_factor, (1.0, 1.0, 1.0), 1e-6):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": baked '
                f"emissive factor {emitted_factor!r} is not the identity."
            )
        strength = float(emissive_fact.get("strength", 1.0))
        extensions = emitted.get("extensions") or {}
        emitted_strength = float(
            (extensions.get("KHR_materials_emissive_strength") or {}).get(
                "emissiveStrength", 1.0,
            ),
        )
        if abs(emitted_strength - strength) > 1e-4:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": '
                f"KHR_materials_emissive_strength {emitted_strength!r} does "
                f"not match the normalized bake peak {strength!r}."
            )
        channel_evidence["emissive"]["emissiveStrength"] = emitted_strength
    return {
        "materialBake": {
            "channels": bake.get("channels"),
            "gates": bake.get("gates"),
            "textures": channel_evidence,
            **({
                "uvEvidence": bake["uvEvidence"],
            } if bake.get("uvEvidence") else {}),
        },
    }


def _attest_image_transport(
    document: dict,
    binary: bytes,
    pbr: dict,
    emitted: dict,
    fact: dict,
    primitive_entries,
    uvs_by_mesh: dict,
    *,
    texture_info: dict | None = None,
    image_fact: dict | None = None,
    expected_tex_coord: int | None = None,
    channel: str = "base color",
) -> dict:
    texture_info = (
        pbr.get("baseColorTexture")
        if texture_info is None else texture_info
    )
    image_fact = fact["image"] if image_fact is None else image_fact
    expected_tex_coord = (
        fact["texCoord"]
        if expected_tex_coord is None else expected_tex_coord
    )
    if not isinstance(texture_info, dict):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": selected '
            f"{channel} Image Texture did not emit its texture slot."
        )
    if texture_info.get("extensions"):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": baseColorTexture '
            "gained an unproven texture-coordinate transform."
        )
    unexpected_emissive = (
        emitted.get("emissiveTexture") is not None
        and fact.get("emissiveImage") is None
    )
    if any(
        emitted.get(name) is not None
        for name in ("normalTexture", "occlusionTexture")
    ) or unexpected_emissive \
            or pbr.get("metallicRoughnessTexture") is not None:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": generated image '
            "material emitted an unexpected companion texture."
        )
    textures = document.get("textures") or []
    texture_index = int(texture_info.get("index", -1))
    if not (0 <= texture_index < len(textures)):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": base color texture is absent.'
        )
    texture = textures[texture_index]
    if texture.get("extensions"):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": image transport '
            "was replaced by an unproven texture extension."
        )
    images = document.get("images") or []
    image_index = int(texture.get("source", -1))
    if not (0 <= image_index < len(images)):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": texture source image is absent.'
        )
    image = images[image_index]
    if image.get("uri") is not None or image.get("bufferView") is None:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": selected image is not '
            "embedded in the GLB."
        )
    payload = _buffer_view_payload(document, binary, int(image["bufferView"]))
    actual_hash = hashlib.sha256(payload).hexdigest()
    if image.get("mimeType") != image_fact["mime"] or actual_hash != image_fact["sha256"]:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": selected image bytes '
            f'or MIME changed (got {image.get("mimeType")!r}/{actual_hash}, expected '
            f'{image_fact["mime"]!r}/{image_fact["sha256"]}).'
        )
    encoded = _encoded_image_info(payload)
    if encoded != (
        image_fact["mime"], image_fact["width"], image_fact["height"],
    ):
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": selected image '
            f"dimensions changed from {image_fact['width']}x{image_fact['height']}."
        )

    samplers = document.get("samplers") or []
    sampler = {}
    if texture.get("sampler") is not None:
        sampler_index = int(texture["sampler"])
        if not (0 <= sampler_index < len(samplers)):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": sampler is absent.'
            )
        sampler = samplers[sampler_index]
    actual_sampler = {
        "magFilter": int(sampler.get("magFilter", 9729)),
        "minFilter": int(sampler.get("minFilter", 9987)),
        "wrapS": int(sampler.get("wrapS", 10497)),
        "wrapT": int(sampler.get("wrapT", 10497)),
    }
    expected_wrap = (
        33071 if image_fact.get("extension") == "EXTEND" else 10497
    )
    expected_sampler = {
        "magFilter": 9729,
        "minFilter": 9987,
        "wrapS": expected_wrap,
        "wrapT": expected_wrap,
    }
    if actual_sampler != expected_sampler:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": image sampler '
            f"{actual_sampler!r} does not match the selected Linear/"
            f"{image_fact.get('extension') or 'REPEAT'} contract "
            f"{expected_sampler!r}."
        )
    tex_coord = int(texture_info.get("texCoord", 0))
    if tex_coord != expected_tex_coord:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": image uses '
            f"TEXCOORD_{tex_coord}, expected TEXCOORD_{expected_tex_coord}."
        )
    _refuse_unbindable_tex_coord(fact["source"], tex_coord, channel)

    all_actual_values = []
    for mesh_index in sorted(uvs_by_mesh):
        mesh_primitives = [
            primitive
            for entry_mesh, _primitive_index, primitive in primitive_entries
            if entry_mesh == mesh_index
        ]
        actual_values = []
        for primitive in mesh_primitives:
            attributes = primitive.get("attributes") or {}
            uv_index = attributes.get(f"TEXCOORD_{tex_coord}")
            position_index = attributes.get("POSITION")
            if uv_index is None or position_index is None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": image primitive '
                    f"omits TEXCOORD_{tex_coord} or POSITION."
                )
            uv_accessor, values = _accessor_values(document, binary, int(uv_index))
            position_accessor = (document.get("accessors") or [])[int(position_index)]
            if uv_accessor.get("type") != "VEC2" \
                    or uv_accessor.get("count") != position_accessor.get("count"):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": TEXCOORD_{tex_coord} '
                    "is not count-matched VEC2 data."
                )
            actual_values.extend(values)
        actual = _uv_summary(actual_values)
        expected = _uv_summary(
            value
            for binding in uvs_by_mesh[mesh_index]
            for value in binding["values"]
        )
        if actual is None or expected is None \
                or actual["hash"] != expected["hash"] \
                or actual["distinct"] != expected["distinct"] \
                or not _close_vector(actual["min"], expected["min"], 1e-7) \
                or not _close_vector(actual["max"], expected["max"], 1e-7):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": TEXCOORD_{tex_coord} '
                f"numeric evidence differs from the selected UV field on mesh {mesh_index}."
            )
        all_actual_values.extend(actual["values"])
    aggregate = _uv_summary(all_actual_values)
    if aggregate is None:
        raise MaterialCompileError(
            f'Material output mismatch for "{fact["source"]}": no image UV values were attested.'
        )
    return {
        "imageSha256": actual_hash,
        "imageMime": image_fact["mime"],
        "imageWidth": image_fact["width"],
        "imageHeight": image_fact["height"],
        "sampler": actual_sampler,
        "texCoord": tex_coord,
        "uvHash": aggregate["hash"],
        "uvDistinctValues": aggregate["distinct"],
        "uvMin": list(aggregate["min"]),
        "uvMax": list(aggregate["max"]),
        "uvGeometryAssociation": _uv_geometry_association(
            document, binary, primitive_entries, tex_coord,
        ),
    }


def _ir_runtime_needs(value, needs) -> None:
    """Walk one channel's TSL IR collecting what the Phase 4 material
    runtime must resolve per mesh: named UV maps, named vertex-color
    layers, Generated texspace, and object-space coordinates."""
    if isinstance(value, dict):
        op = value.get("op")
        if op == "uv" and value.get("uvMap"):
            needs["uvMaps"].add(str(value["uvMap"]))
        if op == "vertex_color" and value.get("layer"):
            needs["colorLayers"].add(str(value["layer"]))
        if op in ("generated", "object_coords"):
            needs["objectSpace"] = True
        if op == "generated":
            needs["texspace"] = True
        for item in value.values():
            _ir_runtime_needs(item, needs)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _ir_runtime_needs(item, needs)


def _tsl_runtime_mesh_entry(decision, obj):
    """Mesh-level application data for the TSL IR route, or None when the
    material's channel IR needs none of it.

    The UV layer order equals the exported TEXCOORD order (the same
    convention _uv_descriptor attests for image transport). Vertex-color
    sampling is only honest when the referenced layer IS the exported
    COLOR_0 (the active color attribute) — anything else refuses by name
    instead of silently sampling the wrong layer. Auto texspace is read
    from the mesh as last computed; the Track C GLB differential cell is
    the ground-truth gate for staleness.
    """
    needs = {
        "uvMaps": set(), "colorLayers": set(),
        "texspace": False, "objectSpace": False,
    }
    for item in (decision.channel_plan or {}).get("channels", ()):
        ir = item.get("tslIr")
        if ir:
            _ir_runtime_needs(ir, needs)
    if not needs["uvMaps"] and not needs["colorLayers"] \
            and not needs["texspace"] and not needs["objectSpace"]:
        return None
    mesh = getattr(obj, "data", None)
    if mesh is None:
        raise MaterialCompileError(
            f'TSL IR runtime data for "{decision.material_name}" needs mesh '
            f'data on "{getattr(obj, "name", "?")}", which has none.'
        )
    entry = {"schemaVersion": 1}
    if needs["uvMaps"]:
        layers = getattr(mesh, "uv_layers", None)
        uv_channels = {}
        for name in sorted(needs["uvMaps"]):
            index = int(layers.find(name)) if layers is not None else -1
            if index < 0:
                raise MaterialCompileError(
                    f'TSL IR for "{decision.material_name}" references UV map '
                    f'{name!r}, which is absent on mesh "{mesh.name}".'
                )
            uv_channels[name] = index
        entry["uvChannels"] = uv_channels
    if needs["colorLayers"]:
        attributes = getattr(mesh, "color_attributes", None)
        active = getattr(attributes, "active_color", None) \
            if attributes is not None else None
        active_name = getattr(active, "name", None)
        for layer in sorted(needs["colorLayers"]):
            if layer != active_name:
                raise MaterialCompileError(
                    f'TSL IR for "{decision.material_name}" samples '
                    f'vertex-color layer {layer!r}, but the exported COLOR_0 '
                    f'on mesh "{mesh.name}" is {active_name!r}. Make '
                    f'{layer!r} the active color attribute or remove the '
                    "dependency."
                )
        entry["colorLayers"] = {
            layer: "color" for layer in sorted(needs["colorLayers"])
        }
    if needs["texspace"]:
        entry["texspace"] = {
            "location": [float(c) for c in mesh.texspace_location],
            "size": [float(c) for c in mesh.texspace_size],
        }
    if needs["objectSpace"]:
        entry["objectSpace"] = "gltf-y-up"
    return entry


def _stamp_tsl_runtime_extras(path: str, generated_facts: dict) -> None:
    """Stamp mesh-level TSL runtime extras onto every exported mesh whose
    material's channel IR needs them (uvName->TEXCOORD map, COLOR_0
    layer map, Generated texspace, geometry basis). Mesh extras ride the
    same GLB the runtime loads — no sidecar threading, and identity stays
    extras-based like the generated-material ownership keys."""
    staged = {
        name: fact for name, fact in generated_facts.items()
        if fact.get("tslRuntimeMeshes")
    }
    if not staged:
        return
    try:
        document, chunks, json_index = glblib.read_document(
            path, "stamp TSL runtime extras in",
        )
    except (OSError, ValueError) as error:
        raise MaterialCompileError(str(error)) from error
    nodes = document.get("nodes") or []
    meshes = document.get("meshes") or []
    changed = False
    for _generated_name, fact in sorted(staged.items()):
        for object_name, entry in sorted(fact["tslRuntimeMeshes"].items()):
            mesh_indices = {
                int(node["mesh"]) for node in nodes
                if node.get("name") == object_name and "mesh" in node
            }
            if not mesh_indices:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": '
                    f"binding {object_name} resolved to no glTF mesh node "
                    "for TSL runtime extras."
                )
            for mesh_index in sorted(mesh_indices):
                if not (0 <= mesh_index < len(meshes)):
                    raise MaterialCompileError(
                        f'Material output mismatch for "{fact["source"]}": '
                        f"glTF node {object_name} references missing mesh "
                        f"{mesh_index}."
                    )
                extras = meshes[mesh_index].setdefault("extras", {})
                existing = extras.get("blendlink_tsl_runtime")
                if existing is not None and existing != entry:
                    raise MaterialCompileError(
                        f'TSL runtime extras conflict on mesh {mesh_index} '
                        f'("{fact["source"]}" via {object_name}): two '
                        "bindings demand different uv/texspace contracts "
                        "for one shared mesh. Give the objects separate "
                        "mesh data."
                    )
                extras["blendlink_tsl_runtime"] = entry
                changed = True
    if not changed:
        return
    try:
        glblib.write_document(
            path, document, chunks, json_index, "tsl-runtime-extras",
        )
    except OSError as error:
        raise MaterialCompileError(
            f"Cannot atomically stamp TSL runtime extras into {path!r}: "
            f"{error}"
        ) from error


def _rewrite_private_color_carriers(
    path: str,
    generated_facts: dict,
    preserve_custom_attributes: bool,
) -> None:
    """Replace compiler carriers with standard COLOR_0, then erase the seam.

    The stock Blender 5.2 exporter can whiten COLOR_0 when more than one
    material on a Mesh selects vertex color.  It does preserve custom
    attributes correctly.  This JSON-only transaction retains the exporter's
    own split/accessor indexing while making the selected carrier the public
    glTF semantic.  Binary bytes and unknown chunks are left untouched.
    """
    carrier_semantics = {
        fact["carrierSemantic"]
        for fact in generated_facts.values()
        if fact.get("carrierSemantic")
    }
    if not carrier_semantics:
        return
    try:
        document, chunks, json_index = glblib.read_document(
            path, "rewrite Website Color in",
        )
        binary = glblib.binary_chunk(chunks, "rewrite Website Color in")
    except (OSError, ValueError) as error:
        raise MaterialCompileError(str(error)) from error

    meshes = document.get("meshes") or []
    for generated_name, fact in sorted(generated_facts.items()):
        semantic = fact.get("carrierSemantic")
        if not semantic:
            continue
        material_index, _material = _resolve_generated_material(
            document, generated_name, fact,
        )
        primitives = [
            primitive
            for mesh in meshes
            for primitive in (mesh.get("primitives") or [])
            if primitive.get("material") == material_index
        ]
        if not primitives:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": no primitive '
                "uses the generated material."
            )
        for primitive in primitives:
            attributes = primitive.get("attributes") or {}
            carrier_index = attributes.get(semantic)
            position_index = attributes.get("POSITION")
            if carrier_index is None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": Blender '
                    f"did not export private color carrier {semantic}. Ensure this "
                    "Blender version supports custom glTF attributes."
                )
            if position_index is None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": primitive has no POSITION.'
                )
            carrier, _minimum, _maximum = _accessor_range(
                document, binary, int(carrier_index),
            )
            accessors = document.get("accessors") or []
            if not (0 <= int(position_index) < len(accessors)):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": POSITION accessor is absent.'
                )
            position = accessors[int(position_index)]
            if carrier.get("count") != position.get("count"):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": private color '
                    "carrier and POSITION accessor counts differ."
                )
            component_type = int(carrier.get("componentType", -1))
            normalized = bool(carrier.get("normalized", False))
            supported_storage = (
                (component_type in {5121, 5123} and normalized)
                or (component_type == 5126 and not normalized)
            )
            if carrier.get("type") != "VEC4" or not supported_storage:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": private color '
                    f"carrier uses unsupported {carrier.get('type')}/"
                    f"{component_type}/normalized={normalized} storage."
                )
            # Generated material primitives are compiler-owned. Replacing the
            # exporter's guessed/masked COLOR_0 here is intentional.
            attributes["COLOR_0"] = carrier_index

    # Compiler attributes are Mesh-wide, so Blender may attach them to stock
    # primitives too. Remove every carrier we created only after all generated
    # primitives have been rewired.
    for mesh in meshes:
        for primitive in mesh.get("primitives") or []:
            attributes = primitive.get("attributes") or {}
            for semantic in carrier_semantics:
                attributes.pop(semantic, None)
            if not preserve_custom_attributes:
                for semantic in tuple(attributes):
                    if semantic.startswith("_"):
                        attributes.pop(semantic, None)
    leaked = sorted({
        semantic
        for mesh in meshes
        for primitive in (mesh.get("primitives") or [])
        for semantic in (primitive.get("attributes") or {})
        if semantic.startswith(PRIVATE_COLOR_PREFIX)
    })
    if leaked:
        raise MaterialCompileError(
            "Material output contains attributes in Blendlink's reserved private "
            f"namespace: {', '.join(leaked)}. Rename the authored attributes."
        )
    try:
        glblib.write_document(
            path, document, chunks, json_index, "website-color",
        )
    except OSError as error:
        raise MaterialCompileError(
            f"Cannot atomically rewrite Website Color GLB {path!r}: {error}"
        ) from error


def _rewrite_factorized_shared_textures(
    path: str,
    generated_facts: dict,
) -> None:
    """Collapse exporter-duplicated Texture records onto one selected image.

    Blender 5.2 correctly extracts the two independent linear factors but
    allocates two glTF Texture records when one Image Texture feeds Base Color
    and Emission through separate recognized multiply nodes. The records point
    at the same embedded image and equivalent sampler. Repointing the
    emissive TextureInfo to the base Texture record is a lossless stock-glTF
    JSON normalization; no image bytes, shader semantics, or source data move.
    """
    factorized = {
        name: fact for name, fact in generated_facts.items()
        if fact.get("surfaceFactorization") is not None
    }
    if not factorized:
        return
    try:
        document, chunks, json_index = glblib.read_document(
            path, "normalize factorized material textures in",
        )
    except (OSError, ValueError) as error:
        raise MaterialCompileError(str(error)) from error
    textures = document.get("textures") or []
    samplers = document.get("samplers") or []

    def sampler_contract(texture):
        if texture.get("sampler") is None:
            return ("absent",)
        index = int(texture["sampler"])
        if not (0 <= index < len(samplers)):
            raise MaterialCompileError(
                "Factorized material texture references a missing sampler."
            )
        sampler = samplers[index]
        sampler_keys = {
            "magFilter", "minFilter", "wrapS", "wrapT",
            "name", "extensions", "extras",
        }
        if set(sampler) - sampler_keys or sampler.get("extensions") \
                or sampler.get("extras"):
            raise MaterialCompileError(
                "Factorized material sampler carries unproved extension, "
                "extras, or fields."
            )
        return (
            "explicit",
            json.dumps(sampler, sort_keys=True, separators=(",", ":")),
        )

    changed = False
    for generated_name, fact in sorted(factorized.items()):
        _material_index, emitted = _resolve_generated_material(
            document, generated_name, fact,
        )
        pbr = emitted.get("pbrMetallicRoughness") or {}
        base_info = pbr.get("baseColorTexture")
        emissive_info = emitted.get("emissiveTexture")
        if not isinstance(base_info, dict) or not isinstance(emissive_info, dict):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": exporter '
                "did not emit both factorized Base Color and Emission textures."
            )
        texture_info_keys = {"index", "texCoord", "extensions", "extras"}
        if set(base_info) - texture_info_keys \
                or set(emissive_info) - texture_info_keys \
                or base_info.get("extensions") \
                or emissive_info.get("extensions") \
                or base_info.get("extras") != emissive_info.get("extras") \
                or int(base_info.get("texCoord", 0)) \
                != int(emissive_info.get("texCoord", 0)):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": exporter '
                "gave the shared intrinsic texture two coordinate contracts."
            )
        base_index = int(base_info.get("index", -1))
        emissive_index = int(emissive_info.get("index", -1))
        if not (0 <= base_index < len(textures)) \
                or not (0 <= emissive_index < len(textures)):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": factorized '
                "texture record is absent."
            )
        base_texture = textures[base_index]
        emissive_texture = textures[emissive_index]
        texture_keys = {"sampler", "source", "name", "extensions", "extras"}
        if set(base_texture) - texture_keys \
                or set(emissive_texture) - texture_keys \
                or base_texture.get("extensions") \
                or emissive_texture.get("extensions") \
                or base_texture.get("extras") \
                or emissive_texture.get("extras") \
                or base_texture.get("source") != emissive_texture.get("source") \
                or base_texture.get("name") != emissive_texture.get("name") \
                or sampler_contract(base_texture) \
                != sampler_contract(emissive_texture):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": exporter '
                "did not produce byte-identical-image/equivalent-sampler "
                "textures that can be safely shared."
            )
        if emissive_index != base_index:
            emissive_info["index"] = base_index
            changed = True
        fact["textureNormalization"] = {
            "model": "stock-gltf-shared-texture-v1",
            "baseTextureIndex": base_index,
            "exporterEmissiveTextureIndex": emissive_index,
            "duplicateTextureRecordRetained": emissive_index != base_index,
        }
    if not changed:
        return
    try:
        glblib.write_document(
            path, document, chunks, json_index, "shared-material-texture",
        )
    except OSError as error:
        raise MaterialCompileError(
            f"Cannot atomically normalize factorized GLB {path!r}: {error}"
        ) from error


def _attest_generated_materials(path: str, generated_facts: dict) -> tuple[dict, ...]:
    document, binary = _read_glb(path)
    materials = document.get("materials") or []
    meshes = document.get("meshes") or []
    nodes = document.get("nodes") or []
    evidence = []
    for generated_name, fact in sorted(generated_facts.items()):
        material_index, emitted = _resolve_generated_material(
            document, generated_name, fact,
        )
        expected_unlit = fact["surfaceResponse"] == "unlit"
        emitted_unlit = (
            "KHR_materials_unlit" in (emitted.get("extensions") or {})
        )
        # A "program" carrier is the artist graph exported stock: its
        # surface response, textures and PBR factors are the glTF
        # exporter's own derivation, not values this plan computed, so
        # they are recorded as observed rather than asserted. Identity
        # (extras, single generated match, source-not-shipped, binding
        # ownership) stays fully asserted -- that is what the runtime
        # depends on.
        stock_program_carrier = fact["transport"] == "program"
        if not stock_program_carrier and emitted_unlit != expected_unlit:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": the generated material '
                f'{"exported" if emitted_unlit else "did not export"} '
                "KHR_materials_unlit, but its proven surface response is "
                f'{fact["surfaceResponse"]!r}.'
            )
        extras = emitted.get("extras") or {}
        if extras.get("blendlink_source_material") != fact["source"] \
                or extras.get("blendlink_material_rule") != fact["rule"] \
                or extras.get("blendlink_material_variant") != fact["variant"]:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": generated ownership extras changed.'
            )
        if any(material.get("name") == fact["source"] for material in materials):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": the source material also shipped.'
            )

        expected_meshes = set()
        binding_labels = []
        binding_primitives = []
        ranges_by_mesh = {}
        uvs_by_mesh = {}
        for binding in sorted(fact["bindings"]):
            object_name, slot_index = binding
            binding_label = f"{object_name}[{slot_index}]"
            binding_labels.append(binding_label)
            binding_nodes = [
                node for node in nodes
                if node.get("name") == object_name and node.get("mesh") is not None
            ]
            if not binding_nodes:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": binding '
                    f'{object_name}[{slot_index}] resolved to no glTF mesh node.'
                )
            binding_range = fact["bindingRanges"].get(binding)
            binding_uv = fact["bindingUvs"].get(binding)
            binding_occurrences = []
            for binding_node in binding_nodes:
                mesh_index = int(binding_node["mesh"])
                if not (0 <= mesh_index < len(meshes)):
                    raise MaterialCompileError(
                        f'Material output mismatch for "{fact["source"]}": binding '
                        f'{object_name}[{slot_index}] references a missing glTF mesh.'
                    )
                expected_meshes.add(mesh_index)
                generated_primitive_indices = [
                    primitive_index
                    for primitive_index, primitive in enumerate(
                        meshes[mesh_index].get("primitives") or []
                    )
                    if primitive.get("material") == material_index
                ]
                if not generated_primitive_indices:
                    raise MaterialCompileError(
                        f'Material output mismatch for "{fact["source"]}": binding '
                        f"{binding_label} has no generated primitive on mesh {mesh_index}."
                    )
                binding_occurrences.append({
                    "mesh": mesh_index,
                    "primitives": generated_primitive_indices,
                })
                if binding_range is not None:
                    ranges_by_mesh.setdefault(mesh_index, []).append(binding_range)
                if binding_uv is not None:
                    uvs_by_mesh.setdefault(mesh_index, []).append(binding_uv)
            binding_primitives.append({
                "binding": binding_label,
                "occurrences": sorted(
                    binding_occurrences,
                    key=lambda item: (item["mesh"], item["primitives"]),
                ),
            })

        primitive_entries = [
            (mesh_index, primitive_index, primitive)
            for mesh_index, mesh in enumerate(meshes)
            for primitive_index, primitive in enumerate(
                mesh.get("primitives") or []
            )
            if primitive.get("material") == material_index
        ]
        primitives = [
            primitive
            for _mesh_index, _primitive_index, primitive in primitive_entries
        ]
        if not primitives:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": no primitive uses the generated material.'
            )
        primitive_meshes = {
            mesh_index
            for mesh_index, _primitive_index, _primitive in primitive_entries
        }
        if primitive_meshes != expected_meshes:
            missing = sorted(expected_meshes - primitive_meshes)
            unexpected = sorted(primitive_meshes - expected_meshes)
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": generated binding mesh '
                f"ownership differs (missing {missing}, unexpected {unexpected})."
            )

        pbr = emitted.get("pbrMetallicRoughness") or {}
        image_evidence = {}
        if fact["transport"] == "image":
            image_evidence = _attest_image_transport(
                document, binary, pbr, emitted, fact, primitive_entries, uvs_by_mesh,
            )
        elif fact["transport"] == "channels":
            image_evidence = _attest_material_bake_channels(
                document, binary, pbr, emitted, fact,
                primitive_entries,
            )
        elif stock_program_carrier:
            image_evidence = {}
        elif pbr.get("baseColorTexture") is not None:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": direct selected field '
                "unexpectedly emitted a base-color texture."
            )
        factorization_evidence = {}
        factorization = fact.get("surfaceFactorization")
        if factorization is not None:
            if expected_unlit or fact["transport"] != "image" \
                    or fact.get("emissiveImage") is None:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": static '
                    "shade-floor plan is not a lit shared-image carrier."
                )
            extensions = emitted.get("extensions") or {}
            if extensions:
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": static '
                    f"shade-floor carrier gained material extensions {sorted(extensions)}."
                )
            emissive_info = emitted.get("emissiveTexture")
            if not isinstance(emissive_info, dict):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": static '
                    "shade-floor image did not emit emissiveTexture."
                )
            base_info = pbr.get("baseColorTexture")
            if not isinstance(base_info, dict) \
                    or base_info.get("index") != emissive_info.get("index"):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": Base '
                    "Color and Emission did not reuse one content-attested "
                    "selected-intrinsic texture."
                )
            attested_emissive = _attest_image_transport(
                document,
                binary,
                pbr,
                emitted,
                fact,
                primitive_entries,
                uvs_by_mesh,
                texture_info=emissive_info,
                image_fact=fact["emissiveImage"],
                expected_tex_coord=fact["emissiveTexCoord"],
                channel="emissive static shade-floor",
            )
            emitted_emissive_factor = tuple(
                emitted.get("emissiveFactor", (0.0, 0.0, 0.0))
            )
            if not _close_vector(
                emitted_emissive_factor, fact["emissiveFactor"], 1e-6,
            ):
                raise MaterialCompileError(
                    f'Material output mismatch for "{fact["source"]}": '
                    f"emissiveFactor {emitted_emissive_factor!r} != exact "
                    f"static-floor factor {fact['emissiveFactor']!r}."
                )
            factorization_evidence = {
                "surfaceFactorization": factorization,
                "textureNormalization": fact.get("textureNormalization"),
                "sharedTextureIndex": int(base_info["index"]),
                "emissiveFactor": list(emitted_emissive_factor),
                "emissiveImageSha256": attested_emissive["imageSha256"],
                "emissiveImageMime": attested_emissive["imageMime"],
                "emissiveImageWidth": attested_emissive["imageWidth"],
                "emissiveImageHeight": attested_emissive["imageHeight"],
                "emissiveSampler": attested_emissive["sampler"],
                "emissiveTexCoord": attested_emissive["texCoord"],
                "emissiveUvHash": attested_emissive["uvHash"],
                "emissiveUvDistinctValues": attested_emissive[
                    "uvDistinctValues"
                ],
                "emissiveUvMin": attested_emissive["uvMin"],
                "emissiveUvMax": attested_emissive["uvMax"],
                "emissiveUvGeometryAssociation": attested_emissive[
                    "uvGeometryAssociation"
                ],
            }
        emitted_factor = tuple(pbr.get("baseColorFactor", (1.0, 1.0, 1.0, 1.0)))
        if not stock_program_carrier \
                and not _close_vector(emitted_factor, fact["baseColorFactor"], 1e-6):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": baseColorFactor '
                f'{emitted_factor!r} != selected {fact["baseColorFactor"]!r}.'
            )
        emitted_metallic = float(pbr.get("metallicFactor", 1.0))
        emitted_roughness = float(pbr.get("roughnessFactor", 1.0))
        if not stock_program_carrier and not expected_unlit and (
            abs(emitted_metallic - fact["metallicFactor"]) > 1e-6
            or abs(emitted_roughness - fact["roughnessFactor"]) > 1e-6
        ):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": generated '
                f"PBR factors metallic={emitted_metallic!r}, "
                f"roughness={emitted_roughness!r} do not match "
                f'{fact["metallicFactor"]!r}/{fact["roughnessFactor"]!r}.'
            )
        emitted_alpha = emitted.get("alphaMode", "OPAQUE")
        if not stock_program_carrier and emitted_alpha != fact["alphaMode"]:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": alphaMode '
                f'{emitted_alpha!r} != selected {fact["alphaMode"]!r}.'
            )
        emitted_double_sided = bool(emitted.get("doubleSided", False))
        if not stock_program_carrier \
                and emitted_double_sided != fact["doubleSided"]:
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": doubleSided '
                f'{emitted_double_sided!r} != selected {fact["doubleSided"]!r}.'
            )

        if fact["transport"] == "vertexColor" and any(
            "COLOR_0" not in (primitive.get("attributes") or {}) for primitive in primitives
        ):
            raise MaterialCompileError(
                f'Material output mismatch for "{fact["source"]}": a generated vertex-color '
                "primitive omitted COLOR_0."
            )
        attested_color_min = None
        attested_color_max = None
        attested_color_tolerance = 0.0
        if fact["transport"] == "vertexColor":
            for mesh_index in sorted(expected_meshes):
                mesh_primitives = [
                    primitive
                    for entry_mesh, _primitive_index, primitive
                    in primitive_entries
                    if entry_mesh == mesh_index
                ]
                actual_min = [math.inf] * _ACCESSOR_COMPONENTS[fact["color0Type"]]
                actual_max = [-math.inf] * len(actual_min)
                for primitive in mesh_primitives:
                    attributes = primitive.get("attributes") or {}
                    color_index = attributes["COLOR_0"]
                    position_index = attributes.get("POSITION")
                    if position_index is None:
                        raise MaterialCompileError(
                            f'Material output mismatch for "{fact["source"]}": primitive has no POSITION.'
                        )
                    color_accessor, color_min, color_max = _accessor_range(
                        document, binary, color_index,
                    )
                    position_accessor = (document.get("accessors") or [])[position_index]
                    if color_accessor.get("count") != position_accessor.get("count"):
                        raise MaterialCompileError(
                            f'Material output mismatch for "{fact["source"]}": COLOR_0 and '
                            "POSITION accessor counts differ."
                        )
                    expected_type = fact["color0Type"]
                    if color_accessor.get("type") != expected_type:
                        raise MaterialCompileError(
                            f'Material output mismatch for "{fact["source"]}": COLOR_0 is '
                            f'{color_accessor.get("type")!r}, expected {expected_type}.'
                        )
                    for index in range(len(actual_min)):
                        actual_min[index] = min(actual_min[index], color_min[index])
                        actual_max[index] = max(actual_max[index], color_max[index])
                expected_ranges = ranges_by_mesh.get(mesh_index) or []
                if not expected_ranges:
                    raise MaterialCompileError(
                        f'Material output mismatch for "{fact["source"]}": source color range is absent.'
                    )
                expected_min = tuple(
                    min(item["min"][index] for item in expected_ranges)
                    for index in range(len(actual_min))
                )
                expected_max = tuple(
                    max(item["max"][index] for item in expected_ranges)
                    for index in range(len(actual_max))
                )
                tolerance = (
                    1.0 / 255.0 + 1e-6
                    if any(item["type"] == "BYTE_COLOR" for item in expected_ranges)
                    else 1e-5
                )
                if not _close_vector(actual_min, expected_min, tolerance) \
                        or not _close_vector(actual_max, expected_max, tolerance):
                    raise MaterialCompileError(
                        f'Material output mismatch for "{fact["source"]}": COLOR_0 numeric '
                        f'range {tuple(actual_min)!r}..{tuple(actual_max)!r} does not match '
                        f"the selected source {expected_min!r}..{expected_max!r}."
                    )
                if attested_color_min is None:
                    attested_color_min = list(actual_min)
                    attested_color_max = list(actual_max)
                else:
                    for index in range(len(actual_min)):
                        attested_color_min[index] = min(
                            attested_color_min[index], actual_min[index],
                        )
                        attested_color_max[index] = max(
                            attested_color_max[index], actual_max[index],
                        )
                attested_color_tolerance = max(attested_color_tolerance, tolerance)
        evidence.append({
            "sourceMaterial": fact["source"],
            "generatedMaterial": generated_name,
            # The SHIPPED name: identical to generatedMaterial except for
            # composed lighting-owned carriers, where the lighting fork's
            # per-(atlas, channel) copy is what actually exports (matched
            # above by extras). Downstream verification must check the
            # artifact, not the pre-fork datablock.
            "emittedMaterial": emitted.get("name"),
            "transport": fact["transport"],
            "surfaceResponse": fact["surfaceResponse"],
            "unlit": emitted_unlit,
            **({
                "metallicFactor": emitted_metallic,
                "roughnessFactor": emitted_roughness,
            } if not emitted_unlit else {}),
            "primitiveCount": len(primitives),
            "color0": all("COLOR_0" in (primitive.get("attributes") or {}) for primitive in primitives),
            **({"color0Type": fact["color0Type"]}
               if fact["transport"] == "vertexColor" else {}),
            **({
                "color0Min": attested_color_min,
                "color0Max": attested_color_max,
                "color0Tolerance": attested_color_tolerance,
            } if fact["transport"] == "vertexColor" else {}),
            "alphaMode": emitted_alpha,
            **({
                "baseColorFactor": list(fact["baseColorFactor"]),
            } if not stock_program_carrier else {
                "baseColorFactor": list(emitted_factor),
                "observedOnly": True,
            }),
            "doubleSided": emitted_double_sided,
            "bindings": binding_labels,
            "bindingPrimitives": binding_primitives,
            **({
                "materialization": fact["materialization"],
                "materializationEvidence": fact["materializationEvidence"],
            } if fact.get("materialization") else {}),
            **image_evidence,
            **factorization_evidence,
        })
    return tuple(evidence)


_CHANNEL_KIND_BY_NAME = {
    "Base Color": "baseColor",
    "Alpha": "alpha",
    "Metallic": "metallic",
    "Roughness": "roughness",
    "Emission": "emission",
    "Normal": "normal",
}


def _privatize_surface_groups(tree) -> None:
    """Give every reachable group instance a private tree copy so tap
    surgery can never touch shared group trees (harness-measured
    pattern, scene_coverage._privatize_groups)."""
    for node in tree.nodes:
        nested = getattr(node, "node_tree", None)
        if node.bl_idname == "ShaderNodeGroup" and nested is not None:
            node.node_tree = nested.copy()
            _privatize_surface_groups(node.node_tree)


class _SurfaceTapBuilder:
    """Node-surgery helpers for the surface projection tap: thread inner
    sockets out through privatized group walls and compose the folded
    channel graph at the root."""

    def __init__(self, tree):
        self.tree = tree
        self.counter = 0

    def thread(self, socket, stack):
        for instance in reversed(list(stack)):
            inner_tree = instance.node_tree
            name = f"TSL_TAP.{self.counter}"
            self.counter += 1
            inner_tree.interface.new_socket(
                name, in_out="OUTPUT", socket_type="NodeSocketColor",
            )
            group_output = next(
                (item for item in inner_tree.nodes
                 if item.type == "GROUP_OUTPUT"
                 and getattr(item, "is_active_output", True)),
                None,
            )
            if group_output is None:
                group_output = inner_tree.nodes.new("NodeGroupOutput")
            tap_input = group_output.inputs.get(name)
            if tap_input is None:
                raise MaterialCompileError(
                    "surface tap: the group output did not gain its socket"
                )
            inner_tree.links.new(socket, tap_input)
            socket = instance.outputs.get(name)
            if socket is None:
                raise MaterialCompileError(
                    "surface tap: the instance did not expose the tap"
                )
        return socket

    def input_or_thread(self, socket, stack):
        if socket.is_linked:
            return self.thread(socket.links[0].from_socket, stack)
        return None

    def constant_color(self, rgb):
        node = self.tree.nodes.new("ShaderNodeRGB")
        node.outputs[0].default_value = (
            float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0,
        )
        return node.outputs[0]

    def constant_value(self, value):
        node = self.tree.nodes.new("ShaderNodeValue")
        node.outputs[0].default_value = float(value)
        return node.outputs[0]

    def channel_socket(self, node, name, stack, *, color):
        socket = procedural._node_input(node, name)
        if socket is None:
            raise MaterialCompileError(
                f"surface tap: Principled input {name!r} not found"
            )
        threaded = self.input_or_thread(socket, stack)
        if threaded is not None:
            return threaded
        value = socket.default_value
        if color:
            return self.constant_color(tuple(value)[:3])
        return self.constant_value(float(value))

    def clamp01(self, source):
        node = self.tree.nodes.new("ShaderNodeClamp")
        node.inputs["Min"].default_value = 0.0
        node.inputs["Max"].default_value = 1.0
        self.tree.links.new(source, node.inputs["Value"])
        return node.outputs["Result"]

    def math(self, operation, a_source, b_source=None, b_value=None):
        node = self.tree.nodes.new("ShaderNodeMath")
        node.operation = operation
        self.tree.links.new(a_source, node.inputs[0])
        if b_source is not None:
            self.tree.links.new(b_source, node.inputs[1])
        elif b_value is not None:
            node.inputs[1].default_value = float(b_value)
        return node.outputs["Value"]

    def one_minus(self, source):
        node = self.tree.nodes.new("ShaderNodeMath")
        node.operation = "SUBTRACT"
        node.inputs[0].default_value = 1.0
        self.tree.links.new(source, node.inputs[1])
        return node.outputs["Value"]

    def scale_color(self, color_source, scale_source):
        node = self.tree.nodes.new("ShaderNodeVectorMath")
        node.operation = "SCALE"
        self.tree.links.new(color_source, node.inputs[0])
        self.tree.links.new(scale_source, node.inputs["Scale"])
        return node.outputs["Vector"]

    def lerp(self, fac_source, a_source, b_source, *, color):
        node = self.tree.nodes.new("ShaderNodeMix")
        node.data_type = "RGBA" if color else "FLOAT"
        node.clamp_factor = True
        factor_input = next(
            item for item in node.inputs
            if item.name == "Factor" and item.enabled
        )
        self.tree.links.new(fac_source, factor_input)
        wanted = "RGBA" if color else "VALUE"
        a_input = next(
            item for item in node.inputs
            if item.name == "A" and item.type == wanted
        )
        b_input = next(
            item for item in node.inputs
            if item.name == "B" and item.type == wanted
        )
        self.tree.links.new(a_source, a_input)
        self.tree.links.new(b_source, b_input)
        return next(
            item for item in node.outputs
            if item.name == "Result" and item.type == wanted
        )


_SURFACE_TAP_CHANNELS = {
    "Base Color": True,   # name -> is color channel
    "Metallic": False,
    "Roughness": False,
    "Alpha": False,
    "Emission": True,     # the folded radiance vector
}


def _surface_channel_source(builder, expression, channel_name):
    """Root-level socket computing one folded surface channel — the node
    mirror of tsl_ir._fold_surface/_leaf_channels (the projection model
    the harness measured byte-exact on the splash corpus), extended to
    lit-lit mixes as a per-channel parameter lerp."""
    kind = expression.get("kind")
    color = _SURFACE_TAP_CHANNELS[channel_name]
    if kind == "mix":
        a_expr, b_expr = expression["a"], expression["b"]
        a_transparent = a_expr.get("kind") == "transparent"
        b_transparent = b_expr.get("kind") == "transparent"
        if a_transparent and b_transparent:
            return None
        fac_socket = expression["fac_socket"]
        fac = builder.input_or_thread(fac_socket, expression["fac_stack"])
        if fac is None:
            fac = builder.constant_value(fac_socket.default_value)
        if b_transparent or a_transparent:
            lit = a_expr if b_transparent else b_expr
            base = _surface_channel_source(builder, lit, channel_name)
            if channel_name != "Alpha" or base is None:
                return base
            coverage = builder.clamp01(fac)
            if b_transparent:
                coverage = builder.one_minus(coverage)
            return builder.math("MULTIPLY", base, b_source=coverage)
        a_source = _surface_channel_source(builder, a_expr, channel_name)
        b_source = _surface_channel_source(builder, b_expr, channel_name)
        if a_source is None or b_source is None:
            raise MaterialCompileError(
                "surface tap: a nested fully-transparent branch reached a "
                "channel lerp"
            )
        return builder.lerp(fac, a_source, b_source, color=color)
    if kind == "principled":
        node, stack = expression["node"], expression["stack"]
        if channel_name == "Emission":
            return builder.scale_color(
                builder.channel_socket(
                    node, "Emission Color", stack, color=True,
                ),
                builder.channel_socket(
                    node, "Emission Strength", stack, color=False,
                ),
            )
        return builder.channel_socket(node, channel_name, stack, color=color)
    if kind == "diffuse":
        if channel_name == "Base Color":
            socket = expression["node"].inputs["Color"]
            threaded = builder.input_or_thread(socket, expression["stack"])
            return threaded if threaded is not None else \
                builder.constant_color(tuple(socket.default_value)[:3])
        constants = {
            "Metallic": 0.0, "Roughness": 1.0, "Alpha": 1.0,
        }
        if channel_name == "Emission":
            return builder.constant_color((0.0, 0.0, 0.0))
        return builder.constant_value(constants[channel_name])
    if kind == "glossy":
        if channel_name == "Base Color":
            socket = expression["node"].inputs["Color"]
            threaded = builder.input_or_thread(socket, expression["stack"])
            return threaded if threaded is not None else \
                builder.constant_color(tuple(socket.default_value)[:3])
        if channel_name == "Roughness":
            socket = expression["node"].inputs["Roughness"]
            threaded = builder.input_or_thread(socket, expression["stack"])
            return threaded if threaded is not None else \
                builder.constant_value(float(socket.default_value))
        if channel_name == "Metallic":
            return builder.constant_value(1.0)
        if channel_name == "Alpha":
            return builder.constant_value(1.0)
        return builder.constant_color((0.0, 0.0, 0.0))
    if kind == "emission":
        if channel_name == "Emission":
            node = expression["node"]
            color_socket = node.inputs["Color"]
            strength_socket = node.inputs["Strength"]
            color_source = builder.input_or_thread(
                color_socket, expression["stack"],
            ) or builder.constant_color(tuple(color_socket.default_value)[:3])
            strength_source = builder.input_or_thread(
                strength_socket, expression["stack"],
            ) or builder.constant_value(float(strength_socket.default_value))
            return builder.scale_color(color_source, strength_source)
        constants = {"Metallic": 0.0, "Roughness": 1.0, "Alpha": 1.0}
        if channel_name == "Base Color":
            return builder.constant_color((0.0, 0.0, 0.0))
        return builder.constant_value(constants[channel_name])
    if kind == "coerced_color":
        if channel_name == "Emission":
            return builder.thread(expression["socket"], expression["stack"])
        constants = {"Metallic": 0.0, "Roughness": 1.0, "Alpha": 1.0}
        if channel_name == "Base Color":
            return builder.constant_color((0.0, 0.0, 0.0))
        return builder.constant_value(constants[channel_name])
    if kind == "transparent":
        return None
    raise MaterialCompileError(
        f"surface tap: leaf {kind!r} has no channel projection"
    )


def _surface_channel_bake_material(
    material, channel_name: str, created_materials: list,
):
    """A private proxy whose surface EMITS one folded surface channel.

    The production port of the harness tap (measured byte-exact on the
    splash corpus for radiance), extended to the lit-lit projection
    class the ellie paint set measures as: per-channel parameter lerps
    over the closure tree, built as real nodes and threaded out of
    privatized groups."""
    copy = material.copy()
    copy.name = f"BLENDLINK_WEB_SURFACE.{material.name}.{channel_name}"
    created_materials.append(copy)
    tree = bakelib.active_shader_node_tree(copy)
    _privatize_surface_groups(tree)
    expression = tsl_ir.resolve_surface(tree)
    builder = _SurfaceTapBuilder(tree)
    source = _surface_channel_source(builder, expression, channel_name)
    if source is None:
        raise MaterialCompileError(
            f'Surface channel {channel_name!r} of "{material.name}" folds '
            "to nothing (fully transparent surface)."
        )
    for output in [
        item for item in tree.nodes
        if item.bl_idname == "ShaderNodeOutputMaterial"
    ]:
        tree.nodes.remove(output)
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    if hasattr(output, "is_active_output"):
        output.is_active_output = True
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(source, emission.inputs["Color"])
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return copy


def _split_slot_receiver(obj, slot_index: int):
    """A disposable receiver holding ONLY the slot's faces.

    Multi-slot meshes bake per slot (user-approved 2026-07-28): the split
    runs the unchanged single-slot pack/proof/bake pipeline, and the packed
    layer writes back onto the original private mesh's slot loops
    afterward. Per-slot packs may overlap in UV space — each glTF
    primitive samples its own material's texture. bmesh face deletion
    preserves the relative order of the remaining faces and their loops,
    which the sequential writeback depends on (and re-checks by count)."""
    import bmesh
    mesh = obj.data.copy()
    mesh.name = f"BLENDLINK_SLOT_SPLIT.{obj.data.name}.{slot_index}"
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        doomed = [
            face for face in bm.faces
            if int(face.material_index) != int(slot_index)
        ]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        bm.to_mesh(mesh)
    finally:
        bm.free()
    # Receivers start without any accumulated private atlas layers:
    # earlier slots' writebacks live on the original private mesh, and a
    # copy that carries them forces the UV resolver into suffixed names —
    # and, slot by slot, toward Blender's 8-layer limit. Stripping them
    # keeps every slot resolving the ONE canonical shared layer name.
    for stale in [
        layer for layer in mesh.uv_layers
        if layer.name.startswith(bakelib.MATERIAL_ATLAS_UV)
    ]:
        mesh.uv_layers.remove(stale)
    # The slot layout stays IDENTICAL to the source: downstream density
    # and validation flows re-measure against the binding's slot index,
    # so the split keeps every slot and only the faces change.
    receiver = bpy.data.objects.new(
        f"BLENDLINK_SLOT_RECEIVER.{obj.name}.{slot_index}", mesh,
    )
    receiver.matrix_world = obj.matrix_world.copy()
    # Per-object attributes (Attribute OBJECT) evaluate against the
    # RECEIVER during the bake; carry the source object's properties.
    for key in obj.keys():
        receiver[key] = obj[key]
    bpy.context.scene.collection.objects.link(receiver)
    return receiver


def _writeback_split_uv(obj, slot_index: int, receiver, uv_name: str) -> None:
    """Copy the packed atlas layer from the split receiver back onto the
    original private mesh's slot loops. The layer is shared across slots
    (disjoint loop sets); loops of never-baked slots stay zeroed."""
    source_layer = receiver.data.uv_layers.get(uv_name)
    if source_layer is None:
        raise MaterialCompileError(
            f'Split receiver for "{obj.name}"[{slot_index}] lost its packed '
            f"UV layer {uv_name!r}."
        )
    target_layer = obj.data.uv_layers.get(uv_name)
    if target_layer is None:
        target_layer = obj.data.uv_layers.new(name=uv_name, do_init=False)
        if target_layer is None or target_layer.name != uv_name:
            raise MaterialCompileError(
                f'Cannot create the packed UV layer {uv_name!r} on '
                f'"{obj.name}" (name collision or layer limit).'
            )
        from array import array
        zeros = array("f", bytes(8 * len(obj.data.loops)))
        target_layer.data.foreach_set("uv", zeros)
    source_data = source_layer.data
    source_index = 0
    for polygon in obj.data.polygons:
        if int(polygon.material_index) != int(slot_index):
            continue
        for loop_index in range(
            polygon.loop_start, polygon.loop_start + polygon.loop_total,
        ):
            if source_index >= len(source_data):
                raise MaterialCompileError(
                    f'Split writeback for "{obj.name}"[{slot_index}] ran out '
                    "of packed loops; the split changed face order."
                )
            target_layer.data[loop_index].uv = source_data[source_index].uv
            source_index += 1
    if source_index != len(source_data):
        raise MaterialCompileError(
            f'Split writeback for "{obj.name}"[{slot_index}] used '
            f"{source_index} of {len(source_data)} packed loops; the split "
            "and source disagree."
        )


def _remove_split_receiver(receiver) -> None:
    mesh = receiver.data
    bpy.data.objects.remove(receiver, do_unlink=True)
    if mesh is not None and mesh.users == 0:
        bpy.data.meshes.remove(mesh)


def _bake_material_channels(
    decision: MaterialDecision,
    binding: MaterialBinding,
    obj,
    temporary_directory: str,
    created_materials: list,
    created_images: list,
    log=print,
) -> dict:
    """Split-receiver wrapper: multi-slot bindings bake on a disposable
    single-slot split, and the packed layer writes back on success."""
    if bpy.context.mode != "OBJECT":
        # A scene saved mid-pose (character files routinely are) leaves
        # object-mode operators unpollable for the bake's selection flow.
        bpy.ops.object.mode_set(mode="OBJECT")
    split_state = {"receiver": None}
    try:
        products = _bake_material_channels_inner(
            decision, binding, obj, temporary_directory,
            created_materials, created_images, split_state, log=log,
        )
        if split_state["receiver"] is not None:
            _writeback_split_uv(
                obj, binding.slot_index, split_state["receiver"],
                str(products["uvEvidence"]["uvName"]),
            )
        return products
    finally:
        if split_state["receiver"] is not None:
            _remove_split_receiver(split_state["receiver"])


# Release verification sets this to gate every channel rather than one per
# variant; see _bake_material_channels_inner.
_EXHAUSTIVE_BAKE_GATES = os.environ.get("BLENDLINK_EXHAUSTIVE_BAKE_GATES") == "1"


def _constant_channel_value(result, *, tolerance: float = 1.0e-4):
    """The one value every COVERED texel carries, or None if it varies.

    rgbMin/rgbMax are already measured over the coverage mask, so an
    uncovered background (which save_channel_png fills deliberately) can
    never make a varying channel look constant, and a constant channel is
    detected without a second pass over the pixels.
    """
    low = result.get("rgbMin")
    high = result.get("rgbMax")
    if not low or not high or len(low) != len(high):
        return None
    if any(
        not math.isfinite(float(lo)) or not math.isfinite(float(hi))
        or float(hi) - float(lo) > tolerance
        for lo, hi in zip(low, high)
    ):
        return None
    return tuple(float(value) for value in low)


def _bake_material_channels_inner(
    decision: MaterialDecision,
    binding: MaterialBinding,
    obj,
    temporary_directory: str,
    created_materials: list,
    created_images: list,
    split_state: dict,
    log=print,
) -> dict:
    """Execute every planned channel bake for one variant.

    Gates: an exact same-resolution determinism re-bake, and — for tiling
    past 0..1 — the integer-window wrap probe that refuses a graph that is
    not period-1 instead of publishing a wrong repeat.

    The determinism re-bake doubles the cost of every channel it guards, so
    by default it runs once per VARIANT rather than once per channel: the
    Cycles sampler settings it protects against are shared by every channel
    of a variant, and the re-bake is the same measurement each time. The
    evidence records the scope, so a reader can tell a proved channel from
    a sampled one. BLENDLINK_EXHAUSTIVE_BAKE_GATES=1 restores per-channel
    gating; the wrap probe is unaffected and still runs wherever it applies.
    """
    plan = decision.channel_plan or {}
    records = {
        item["channel"]: item
        for item in plan.get("channels", ())
    }
    token = hashlib.sha256(
        _variant_key(decision, binding).encode("utf8")
    ).hexdigest()[:12]
    wrap_window = plan.get("wrapGateWindow")
    uv_evidence = None
    gates = {}
    # Channels that baked to one value everywhere: shipped as a factor
    # rather than a texture nobody can distinguish from it.
    constants = {}
    # One determinism re-bake proves the variant. The sampled channel is
    # the first in sorted order: stable across compiles, and predictable
    # for fixtures that assert the gate.
    baked_channels = sorted(
        record["channel"] for record in records.values()
        if (record.get("route") or record.get("transport")) != "factor"
    ) or sorted(records)
    determinism_gated = (
        set(baked_channels) if _EXHAUSTIVE_BAKE_GATES
        else {baked_channels[0]} if baked_channels else set()
    )
    determinism_proof = {
        "channel": baked_channels[0] if baked_channels else None,
        "stats": None,
    }
    # Coverage is a property of (receiver set, size, margin, uv layer), so
    # every channel of this variant - and every determinism re-bake - can
    # share one proved mask instead of paying for its own Cycles pass.
    coverage_cache = {}

    def ensure_unique_uv():
        nonlocal uv_evidence
        if uv_evidence is None:
            if binding.materialization_plan is None:
                raise MaterialCompileError(
                    f'Material bake binding {binding.object_name}'
                    f"[{binding.slot_index}] has no resolution plan."
                )
            receiver = obj
            needs_split = len(obj.material_slots) != 1 or any(
                int(polygon.material_index) != binding.slot_index
                for polygon in obj.data.polygons
            )
            if needs_split:
                split_state["receiver"] = _split_slot_receiver(
                    obj, binding.slot_index,
                )
                receiver = split_state["receiver"]
            uv_evidence = bakelib.prepare_material_texture_uv(
                receiver, binding.materialization_plan,
            )
            bpy.context.view_layer.update()
        return uv_evidence

    def bake_once(record, bake_material, resolution, *, allow_hdr):
        label = (
            f'{decision.material_name} {record["channel"]} channel'
        )
        if record.get("uv") == "unique":
            evidence = ensure_unique_uv()
            receiver = split_state["receiver"] or obj
            slot = receiver.material_slots[binding.slot_index]
            slot.link = "DATA"
            slot.material = bake_material
            receivers = [receiver]
            margin = int(evidence["margin"])
            uv_layer = str(evidence["uvName"])
            proxy = None
        else:
            proxy = bakelib.uv_tile_proxy(
                record.get("uvMaps") or [],
                window=(0.0, 0.0, 1.0, 1.0),
            )
            proxy.data.materials.append(bake_material)
            receivers = [proxy]
            margin = 0
            uv_layer = "BLENDLINK_TILE_BAKE"
        try:
            def run(size, window=None):
                targets = receivers
                window_proxy = None
                if window is not None:
                    window_proxy = bakelib.uv_tile_proxy(
                        record.get("uvMaps") or [],
                        window=window,
                    )
                    window_proxy.data.materials.append(bake_material)
                    targets = [window_proxy]
                try:
                    if record.get("pass") == "NORMAL":
                        return bakelib.bake_tangent_normal_field_pixels(
                            targets, size=size, margin_px=margin,
                            uv_layer=uv_layer, label=label, log=log,
                            coverage_cache=coverage_cache,
                        )
                    return bakelib.bake_channel_field_pixels(
                        targets, size=size, margin_px=margin,
                        uv_layer=uv_layer, label=label,
                        allow_hdr=allow_hdr, clamp_ldr=True, log=log,
                        coverage_cache=coverage_cache,
                    )
                finally:
                    if window_proxy is not None:
                        bakelib.remove_uv_tile_proxy(window_proxy)

            main = run(resolution)
            if record["channel"] in determinism_gated:
                repeat = run(resolution)
                determinism = _channel_probe_stats(
                    main["pixels"], repeat["pixels"],
                )
                if determinism["maxAbs"] > 1.0e-5:
                    raise MaterialCompileError(
                        f"{label}: two identical bakes disagreed by "
                        f"{determinism['maxAbs']:.6g}; the channel bake is "
                        "not deterministic and cannot be attested."
                    )
                determinism_proof["stats"] = determinism
                channel_gates = {
                    "determinism": determinism,
                    "determinismScope": (
                        "channel" if _EXHAUSTIVE_BAKE_GATES else "variant"
                    ),
                }
            else:
                # Not re-baked: this channel inherits the variant's proof.
                # Naming the source keeps the attestation honest rather
                # than implying a measurement that did not happen.
                channel_gates = {
                    "determinismScope": "variant",
                    "determinismSampledFrom": determinism_proof["channel"],
                }
            if record.get("uv") == "tile" and record.get("wrapGate") \
                    and wrap_window and record.get("pass") != "NORMAL":
                probe = run(resolution, window=tuple(wrap_window))
                wrap = _channel_probe_stats(main["pixels"], probe["pixels"])
                channel_gates["wrap"] = wrap
                if wrap["meanAbs"] > 1.0e-3 or wrap["p99Abs"] > 0.02:
                    raise MaterialCompileError(
                        f"{label}: this UV-driven graph is not period-1 — "
                        f"the {tuple(wrap_window)!r} UV window differs from "
                        f"the 0..1 tile (mean {wrap['meanAbs']:.4g}, p99 "
                        f"{wrap['p99Abs']:.4g}). One repeated tile would "
                        "publish a wrong pattern. Make the channel repeat "
                        "with period one (Blender's default Brick randomizes "
                        "per-brick colors, for example), keep the object "
                        "Realtime, or use an Appearance bake."
                    )
            gates[record["channel"]] = channel_gates
            return main
        finally:
            if proxy is not None:
                bakelib.remove_uv_tile_proxy(proxy)

    def resolution_of(record):
        if record.get("uv") == "unique":
            return int(ensure_unique_uv()["resolution"])
        return int(record["resolution"])

    import numpy as np

    images = {}

    def load_image(saved, image_kind, colorspace):
        try:
            image = bpy.data.images.load(saved["path"], check_existing=False)
        except (OSError, RuntimeError) as error:
            raise MaterialCompileError(
                f'Cannot load the baked {image_kind} channel PNG for '
                f'"{decision.material_name}": {error}'
            ) from error
        created_images.append(image)
        image.name = f"BLENDLINK_WEB_CHANNEL.{token}.{image_kind}"
        image.colorspace_settings.name = (
            "sRGB" if colorspace == "srgb" else "Non-Color"
        )
        image.alpha_mode = "STRAIGHT"
        return image

    base_record = records.get("Base Color")
    alpha_record = records.get("Alpha")
    alpha_baked = alpha_record is not None and alpha_record.get("route") == "bake"
    base_baked = base_record is not None and base_record.get("route") == "bake"
    carrier_record = (
        base_record if base_baked
        else alpha_record if alpha_baked else None
    )
    if base_baked or alpha_baked:
        carrier_resolution = resolution_of(carrier_record)
        if base_baked:
            base_material = _material_bake_channel_material(
                decision, "baseColor", created_materials,
            )
            base_result = bake_once(
                base_record, base_material, carrier_resolution,
                allow_hdr=False,
            )
            rgb = base_result["pixels"]
            coverage = base_result["coverage"]
        else:
            constant = records["Base Color"].get("value") \
                if records.get("Base Color") else None
            fill = (
                tuple(float(item) for item in constant[:3])
                if isinstance(constant, (list, tuple)) else (1.0, 1.0, 1.0)
            )
            rgb = np.empty(
                (carrier_resolution, carrier_resolution, 3), dtype=np.float32,
            )
            rgb[:, :, 0] = fill[0]
            rgb[:, :, 1] = fill[1]
            rgb[:, :, 2] = fill[2]
            coverage = None
        alpha_plane = None
        if alpha_baked:
            alpha_material = _material_bake_channel_material(
                decision, "alpha", created_materials,
            )
            alpha_result = bake_once(
                alpha_record, alpha_material, carrier_resolution,
                allow_hdr=False,
            )
            alpha_plane = alpha_result["pixels"][:, :, 0]
            if coverage is None:
                coverage = alpha_result["coverage"]
        if coverage is None:
            raise MaterialCompileError(
                f'Base colour carrier for "{decision.material_name}" has no '
                "bake coverage."
            )
        saved = bakelib.save_channel_png(
            rgb, coverage,
            os.path.join(temporary_directory, f"channel-{token}-base.png"),
            colorspace="srgb", alpha=alpha_plane,
            label=f"{decision.material_name} base colour carrier",
        )
        images["baseColor"] = {
            "saved": saved,
            "image": load_image(saved, "baseColor", "srgb"),
            "uv": carrier_record.get("uv"),
            "uvMaps": carrier_record.get("uvMaps") or [],
            "hasAlpha": alpha_plane is not None,
        }

    orm_records = [
        records[name] for name in ("Metallic", "Roughness")
        if name in records and records[name].get("route") == "bake"
    ]
    if orm_records:
        orm_resolution = resolution_of(orm_records[0])
        planes = {}
        coverage = None
        for record in orm_records:
            kind = _CHANNEL_KIND_BY_NAME[record["channel"]]
            bake_material = _material_bake_channel_material(
                decision, kind, created_materials,
            )
            result = bake_once(
                record, bake_material, orm_resolution, allow_hdr=False,
            )
            planes[record["channel"]] = result["pixels"][:, :, 0]
            coverage = result["coverage"]
        packed = bakelib.compose_channel_pack_pixels(
            orm_resolution,
            green=planes.get("Roughness"),
            blue=planes.get("Metallic"),
        )
        saved = bakelib.save_channel_png(
            packed, coverage,
            os.path.join(temporary_directory, f"channel-{token}-orm.png"),
            colorspace="data",
            label=f"{decision.material_name} ORM pack",
        )
        images["orm"] = {
            "saved": saved,
            "image": load_image(saved, "orm", "data"),
            "uv": orm_records[0].get("uv"),
            "uvMaps": orm_records[0].get("uvMaps") or [],
            "bakedChannels": sorted(planes),
        }

    emission_record = records.get("Emission")
    if emission_record is not None and emission_record.get("route") == "bake":
        emission_material = _material_bake_channel_material(
            decision, "emission", created_materials,
        )
        resolution = resolution_of(emission_record)
        result = bake_once(
            emission_record, emission_material, resolution, allow_hdr=True,
        )
        pixels = result["pixels"]
        strength = 1.0
        peak = float(max(result["rgbMax"]))
        if peak > 1.0 + 1.0e-6:
            strength = peak
            pixels = pixels / strength
        emissive_constant = _constant_channel_value(result)
        # BLACK ONLY, deliberately. glTF MULTIPLIES emissiveFactor by the
        # emissive texture, so a carrier that drops its image and keeps a
        # non-black factor does not stop emitting - it emits that colour
        # everywhere. The attestation below (_attest_material_bake_channels)
        # enforces "no planned emissive image => black factor" and its
        # comment names this elision as the exact hole it guards. Folding a
        # NON-zero constant into the factor is legitimate, but it has to
        # record the expected value on the plan and teach that branch to
        # compare against it; widening it silently would give the hole
        # back. Black needs none of that - it is already the attested
        # invariant - and on the ellie character black is 26 of the 38
        # constant textures.
        if emissive_constant is not None and any(
            abs(component) > 1.0e-6 for component in emissive_constant[:3]
        ):
            emissive_constant = None
        if emissive_constant is not None:
            # Indistinguishable from the texture it replaces, and the
            # carrier already knows how to take a value here.
            # A black channel never normalizes (that only fires above
            # 1.0), so strength is the identity and no
            # KHR_materials_emissive_strength ships - which the attestation
            # also requires when no emissive texture was planned.
            assert strength == 1.0, (
                f"{decision.material_name}: black emissive normalized to "
                f"{strength}"
            )
            constants["emissive"] = {
                "value": (0.0, 0.0, 0.0),
                "strength": 1.0,
            }
            log(
                f"blendlink: {decision.material_name} emits nothing across "
                "every covered texel; shipping no emissive texture instead "
                "of a black one"
            )
        else:
            saved = bakelib.save_channel_png(
                pixels, result["coverage"],
                os.path.join(
                    temporary_directory, f"channel-{token}-emissive.png",
                ),
                colorspace="srgb",
                label=f"{decision.material_name} emissive channel",
            )
            images["emissive"] = {
                "saved": saved,
                "image": load_image(saved, "emissive", "srgb"),
                "uv": emission_record.get("uv"),
                "uvMaps": emission_record.get("uvMaps") or [],
                "strength": strength,
            }

    normal_record = records.get("Normal")
    if normal_record is not None and normal_record.get("route") == "bake":
        normal_material = _material_bake_channel_material(
            decision, "normal", created_materials,
        )
        resolution = resolution_of(normal_record)
        result = bake_once(
            normal_record, normal_material, resolution, allow_hdr=False,
        )
        saved = bakelib.save_channel_png(
            result["pixels"], result["coverage"],
            os.path.join(temporary_directory, f"channel-{token}-normal.png"),
            colorspace="data",
            label=f"{decision.material_name} normal channel",
        )
        images["normal"] = {
            "saved": saved,
            "image": load_image(saved, "normal", "data"),
            "uv": normal_record.get("uv"),
            "uvMaps": normal_record.get("uvMaps") or [],
        }

    return {
        "token": token,
        "images": images,
        "constants": constants,
        "gates": gates,
        "uvEvidence": uv_evidence,
    }


MATERIAL_PAGE_KINDS = ("baseColor", "orm", "emissive", "normal")
# VRAM ceiling per page. The first live measurement (ellie, 2026-07-31)
# let a single page grow to 8192px to fit every member at scale >= 1 and
# the GPU texture budget quintupled -- PNG compresses empty page area,
# VRAM does not. Pages are now bounded bins.
MATERIAL_PAGE_MAX = 2048


def _pack_pow2_bin(page, members):
    """Quadtree (buddy) placement of pow2 squares into a pow2 bin.

    ``members`` is [(variant, size)] sorted largest-first. Every
    unique-route resolution is a power-of-two ladder value, so first-fit
    descending into quadrant splits packs with ZERO fragmentation: the
    placement succeeds exactly when the member areas fit, and rects are
    disjoint by construction. Returns {variant: (x, y, size)} or None.
    """
    free = {int(page): [(0, 0)]}
    rects = {}
    for variant, size in members:
        available = sorted(
            slot_size for slot_size, slots in free.items()
            if slot_size >= size and slots
        )
        if not available:
            return None
        slot_size = available[0]
        x, y = free[slot_size].pop()
        while slot_size > size:
            slot_size //= 2
            free.setdefault(slot_size, []).extend((
                (x + slot_size, y),
                (x, y + slot_size),
                (x + slot_size, y + slot_size),
            ))
        rects[variant] = (x, y, size)
    return rects


def _plan_material_pages(requests):
    """Arrange unique-route bake products onto bounded shared pages.

    Multi-bin, pow2, gutter-free: members separate by their own baked-in
    dilation margins, so bin VRAM equals member VRAM except the last
    bin's pow2 rounding -- the property the first single-page design
    lacked, measured as a 5x GPU-budget regression on ellie. Each bin is
    packed first-fit-descending at MATERIAL_PAGE_MAX, then shrunk to the
    smallest power of two that still fits (always succeeds for pow2
    squares whose areas fit). Bins left holding one member page nothing
    (no sharing win); non-pow2 or oversized resolutions stay private by
    name. Returns a list of {"page", "rects"} bins, or None when nothing
    shares.
    """
    sized = []
    for item in sorted(requests, key=lambda entry: entry["variant"]):
        size = int(item["resolution"])
        if size & (size - 1) or size > MATERIAL_PAGE_MAX:
            print(
                "blendlink material pages: "
                f"{item['variant'][:48]}... keeps private textures "
                f"(resolution {size} outside the pow2 page ladder)"
            )
            continue
        sized.append((item["variant"], size))
    if len(sized) < 2:
        return None
    sized.sort(key=lambda entry: (-entry[1], entry[0]))

    bins = []
    for variant, size in sized:
        placed = False
        for entry in bins:
            attempt = _pack_pow2_bin(
                MATERIAL_PAGE_MAX, entry["members"] + [(variant, size)],
            )
            if attempt is not None:
                entry["members"].append((variant, size))
                placed = True
                break
        if not placed:
            bins.append({"members": [(variant, size)]})

    plans = []
    for entry in bins:
        members = entry["members"]
        if len(members) < 2:
            continue
        area = sum(size * size for _v, size in members)
        largest = max(size for _v, size in members)
        page = largest
        while page * page < area:
            page *= 2
        rects = _pack_pow2_bin(page, members)
        if rects is None:
            # Cannot happen for pow2 squares whose areas fit; refuse
            # loudly rather than fall back to an unbounded page.
            raise MaterialCompileError(
                f"material page packing failed at {page}px for "
                f"{len(members)} pow2 members"
            )
        for variant, (x, y, size) in rects.items():
            if x < 0 or y < 0 or x + size > page or y + size > page:
                raise MaterialCompileError(
                    f"material page rect out of bounds: {variant!r}"
                )
        plans.append({"page": page, "rects": rects})
    return plans or None


def _load_raw_pixels(path):
    """A saved channel PNG's stored bytes as float32 (H, W, C).

    Loaded through a throwaway bpy image: ``pixels`` returns the stored
    values (byte/255) untransformed, so the page compose is a pure byte
    transplant -- an sRGB-encoded member stays sRGB-encoded on the page,
    a data member stays linear, and re-saving through the data path
    preserves every byte.
    """
    import numpy as np

    image = bpy.data.images.load(path, check_existing=False)
    try:
        width, height = int(image.size[0]), int(image.size[1])
        channels = int(image.channels)
        pixels = np.empty(width * height * channels, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        return pixels.reshape(height, width, channels)
    finally:
        bpy.data.images.remove(image)


def _compose_material_pages(page_plan, products_by_variant, out_dir):
    """Blit every member's channel PNGs into shared per-kind pages.

    Returns ``{kind: saved}`` (the ``save_channel_png`` records) plus the
    page token. Byte-pure: pixels are read raw and re-saved through the
    data path; encoding semantics ride the carrier's image colorspace
    exactly as they do for per-variant PNGs.
    """
    import numpy as np

    page = page_plan["page"]
    rects = page_plan["rects"]
    token_payload = json.dumps(
        {
            "model": "material-page-v1",
            "page": page,
            "members": {
                variant: list(rect) for variant, rect in sorted(
                    rects.items(),
                )
            },
            "images": {
                variant: {
                    kind: item["saved"]["sha256"]
                    for kind, item in sorted(
                        products_by_variant[variant]["images"].items(),
                    )
                }
                for variant in sorted(rects)
            },
        },
        sort_keys=True, separators=(",", ":"),
    )
    page_token = hashlib.sha256(token_payload.encode("utf8")).hexdigest()
    saved_pages = {}
    for kind in MATERIAL_PAGE_KINDS:
        members = [
            (variant, products_by_variant[variant]["images"].get(kind))
            for variant in sorted(rects)
        ]
        present = [(variant, item) for variant, item in members if item]
        if not present:
            continue
        has_alpha = any(
            bool(item["saved"].get("hasAlpha")) for _v, item in present
        )
        channel_count = 4 if has_alpha else 3
        plane = np.zeros((page, page, channel_count), dtype=np.float32)
        if has_alpha:
            plane[:, :, 3] = 1.0
        coverage = np.zeros((page, page), dtype=bool)
        for variant, item in present:
            x0, y0, size = rects[variant]
            member = _load_raw_pixels(item["saved"]["path"])
            if member.shape[0] != size or member.shape[1] != size:
                raise MaterialCompileError(
                    f"page member {variant!r} {kind} is "
                    f"{member.shape[1]}x{member.shape[0]}, planned {size}"
                )
            plane[y0:y0 + size, x0:x0 + size, :3] = member[:, :, :3]
            if has_alpha and member.shape[2] >= 4:
                plane[y0:y0 + size, x0:x0 + size, 3] = member[:, :, 3]
            coverage[y0:y0 + size, x0:x0 + size] = True
        # Same basename family as the per-variant channel PNGs (the glTF
        # texture name is the file basename, and the optimizer's
        # generated-name regex covers both families in one pattern).
        suffix = "base" if kind == "baseColor" else kind
        path = os.path.join(
            out_dir, f"page-{page_token[:12]}-{suffix}.png",
        )
        saved_pages[kind] = bakelib.save_channel_png(
            plane[:, :, :3], coverage, path,
            colorspace="data",
            alpha=plane[:, :, 3] if has_alpha else None,
            label=f"material page {kind}",
        )
    return saved_pages, page_token


def _remap_slot_uv_rect(obj, slot_index, uv_name, rect, page):
    """Scale one binding's packed 0..1 layout into its page rect.

    Rides the same polygon/loop walk shape as ``_writeback_split_uv``:
    only loops whose polygon carries ``slot_index`` move, which
    degenerates correctly to every loop on a single-slot mesh (the
    no-split case, where the packed layer already lives on ``obj``).
    """
    mesh = obj.data
    layer = mesh.uv_layers.get(uv_name)
    if layer is None:
        raise MaterialCompileError(
            f'Page remap: mesh "{mesh.name}" lost UV layer {uv_name!r}.'
        )
    x0, y0, size = rect
    scale = size / page
    offset_u = x0 / page
    offset_v = y0 / page
    for polygon in mesh.polygons:
        if int(polygon.material_index) != int(slot_index):
            continue
        for loop_index in polygon.loop_indices:
            u, v = layer.data[loop_index].uv
            layer.data[loop_index].uv = (
                offset_u + u * scale,
                offset_v + v * scale,
            )


def _generated_material_bake(
    decision: MaterialDecision,
    binding: MaterialBinding,
    created_materials: list,
    products: dict,
    page_images: dict | None = None,
):
    """Ordinary lit glTF pbrMetallicRoughness from the channel products,
    wired in the stock exporter's recognized arrangements."""
    variant = _variant_key(decision, binding)
    token = hashlib.sha256(variant.encode("utf8")).hexdigest()[:10]
    source_material = bpy.data.materials.get(decision.material_name)
    if source_material is None:
        raise MaterialCompileError(
            f'Material plan for "{decision.material_name}" no longer resolves.'
        )
    plan_records = {
        item["channel"]: item
        for item in (decision.channel_plan or {}).get("channels", ())
    }
    generated = bpy.data.materials.new(
        f"{GENERATED_MATERIAL_PREFIX}{token}.{decision.material_name}"
    )
    created_materials.append(generated)
    tree = bakelib.ensure_shader_node_tree(generated)
    generated["blendlink_source_material"] = decision.material_name
    generated["blendlink_material_rule"] = MATERIAL_BAKE_RULE
    generated["blendlink_material_variant"] = token
    for setting in (
        "diffuse_color", "use_backface_culling", "alpha_threshold",
        "use_transparency_overlap", "surface_render_method", "blend_method",
    ):
        _copy_material_setting(source_material, generated, setting)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])

    def image_node(entry, name):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.name = name
        node.image = entry["image"]
        node.interpolation = "Linear"
        node.projection = "FLAT"
        if entry.get("uv") == "unique":
            node.extension = "EXTEND"
            uv_name = products["uvEvidence"]["uvName"] \
                if products.get("uvEvidence") else None
        else:
            node.extension = "REPEAT"
            uv_maps = entry.get("uvMaps") or []
            uv_name = uv_maps[0] if uv_maps else None
        if uv_name:
            uv_node = tree.nodes.new("ShaderNodeUVMap")
            uv_node.uv_map = str(uv_name)
            tree.links.new(uv_node.outputs["UV"], node.inputs["Vector"])
        return node

    # Shared-page members bind the page images; the placement lives
    # entirely in the remapped UV loops, so no node changes are needed
    # (EXTEND clamps at the page border and the sub-rect is enforced by
    # the loops plus the attested rect).
    images = page_images if page_images is not None else products.get("images", {})
    uses_alpha = False

    base_entry = images.get("baseColor")
    if base_entry is not None:
        node = image_node(base_entry, "BLENDLINK_CHANNEL_BASE")
        tree.links.new(node.outputs["Color"], principled.inputs["Base Color"])
        if base_entry.get("hasAlpha"):
            tree.links.new(node.outputs["Alpha"], principled.inputs["Alpha"])
            uses_alpha = True
    else:
        base_record = plan_records.get("Base Color")
        if base_record is not None and base_record.get("route") == "factor":
            value = base_record.get("value")
            if isinstance(value, (list, tuple)) and len(value) >= 3:
                principled.inputs["Base Color"].default_value = (
                    float(value[0]), float(value[1]), float(value[2]),
                    float(value[3]) if len(value) > 3 else 1.0,
                )
    alpha_record = plan_records.get("Alpha")
    if alpha_record is not None and alpha_record.get("route") == "factor":
        alpha_value = float(alpha_record.get("value") or 1.0)
        if alpha_value < 1.0 - 1e-9:
            principled.inputs["Alpha"].default_value = alpha_value
            uses_alpha = True

    orm_entry = images.get("orm")
    if orm_entry is not None:
        node = image_node(orm_entry, "BLENDLINK_CHANNEL_ORM")
        separate = tree.nodes.new("ShaderNodeSeparateColor")
        separate.mode = "RGB"
        tree.links.new(node.outputs["Color"], separate.inputs["Color"])
        baked = set(orm_entry.get("bakedChannels") or ())
        if "Roughness" in baked:
            tree.links.new(
                separate.outputs["Green"], principled.inputs["Roughness"],
            )
        if "Metallic" in baked:
            tree.links.new(
                separate.outputs["Blue"], principled.inputs["Metallic"],
            )
    for channel_name, input_name in (
        ("Metallic", "Metallic"), ("Roughness", "Roughness"),
    ):
        record = plan_records.get(channel_name)
        if record is not None and record.get("route") == "factor":
            value = record.get("value")
            if isinstance(value, (int, float)):
                principled.inputs[input_name].default_value = float(value)

    emissive_entry = images.get("emissive")
    if emissive_entry is not None:
        node = image_node(emissive_entry, "BLENDLINK_CHANNEL_EMISSIVE")
        tree.links.new(
            node.outputs["Color"], principled.inputs["Emission Color"],
        )
        principled.inputs["Emission Strength"].default_value = float(
            emissive_entry.get("strength", 1.0),
        )
    elif (products.get("constants") or {}).get("emissive") is not None:
        emissive_constant = products["constants"]["emissive"]
        value = emissive_constant["value"]
        principled.inputs["Emission Color"].default_value = (
            float(value[0]), float(value[1]), float(value[2]), 1.0,
        )
        principled.inputs["Emission Strength"].default_value = float(
            emissive_constant.get("strength", 1.0),
        )
    else:
        record = plan_records.get("Emission")
        if record is not None and record.get("route") == "factor":
            value = record.get("value")
            if isinstance(value, (list, tuple)) and len(value) >= 3:
                principled.inputs["Emission Color"].default_value = (
                    float(value[0]), float(value[1]), float(value[2]),
                    float(value[3]) if len(value) > 3 else 1.0,
                )
            strength = record.get("strength")
            if isinstance(strength, (int, float)):
                principled.inputs["Emission Strength"].default_value = float(
                    strength,
                )

    normal_entry = images.get("normal")
    if normal_entry is not None:
        node = image_node(normal_entry, "BLENDLINK_CHANNEL_NORMAL")
        normal_map = tree.nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = 1.0
        if normal_entry.get("uv") == "unique" and products.get("uvEvidence"):
            normal_map.uv_map = str(products["uvEvidence"]["uvName"])
        elif normal_entry.get("uvMaps"):
            normal_map.uv_map = str(normal_entry["uvMaps"][0])
        tree.links.new(node.outputs["Color"], normal_map.inputs["Color"])
        tree.links.new(
            normal_map.outputs["Normal"], principled.inputs["Normal"],
        )

    if uses_alpha:
        if hasattr(generated, "surface_render_method"):
            try:
                generated.surface_render_method = "DITHERED"
            except (TypeError, ValueError) as error:
                raise MaterialCompileError(
                    f'Cannot configure alpha blending for generated material '
                    f'"{generated.name}": {error}'
                ) from error
        elif hasattr(generated, "blend_method"):
            generated.blend_method = "BLEND"
    return generated


def with_compiled_materials(
    plan: MaterialPlan,
    output_glb: str,
    emit: Callable[[str], object],
    *,
    emit_replaces_mesh_data: bool = False,
    preserve_custom_attributes: bool = False,
) -> tuple[object, MaterialCompilation]:
    """Install private lowerings for one export, attest, then restore."""
    if plan.errors:
        raise MaterialCompileError("Website material compilation blocked:\n" + format_plan_errors(plan))
    fresh = plan_materials(plan.objects, purpose=plan.purpose)
    if fresh.source_fingerprint != plan.source_fingerprint:
        raise MaterialCompileError(
            "Material graph, marker, attribute, or export scope changed after planning; run Preview again."
        )
    if not plan.lowerings:
        value = emit(output_glb)
        return value, MaterialCompilation(plan.source_fingerprint, (), (), ())
    output_glb = os.path.abspath(output_glb)
    output_directory = os.path.dirname(output_glb)
    if not os.path.isdir(output_directory):
        raise MaterialCompileError(
            f"Website material output directory does not exist: {output_directory}"
        )

    generated_by_variant = {}
    generated_facts = {}
    created_materials = []
    created_images = []
    carrier_installs = {}
    binding_entries = []
    data_swaps = []
    installed_bindings = []
    installed_binding_keys = set()
    temporary_directory = None
    staged_glb = None
    result = None
    primary_error = None
    try:
        # Validate the complete transaction before touching any object.
        for decision in plan.lowerings:
            source_material = bpy.data.materials.get(decision.material_name)
            if source_material is None:
                raise MaterialCompileError(
                    f'Material "{decision.material_name}" disappeared after planning.'
                )
            for binding in decision.bindings:
                obj = bpy.data.objects.get(binding.object_name)
                if obj is None or getattr(obj, "type", None) != "MESH" \
                        or not (0 <= binding.slot_index < len(obj.material_slots)):
                    raise MaterialCompileError(
                        f'Material binding {binding.object_name}[{binding.slot_index}] disappeared after planning.'
                    )
                slot = obj.material_slots[binding.slot_index]
                if slot.material != source_material:
                    raise MaterialCompileError(
                        f'Material binding {binding.object_name}[{binding.slot_index}] changed after planning.'
                    )
                binding_entries.append({
                    "decision": decision,
                    "binding": binding,
                    "source": source_material,
                    "oldLink": slot.link,
                    "oldMaterial": slot.material,
                })

        # Preserve instancing: objects that shared one source Mesh and require
        # the same complete slot substitution share one private Mesh copy.
        entries_by_object = {}
        for entry in binding_entries:
            entries_by_object.setdefault(entry["binding"].object_name, []).append(entry)
        copy_groups = {}
        for object_name, entries in entries_by_object.items():
            obj = bpy.data.objects.get(object_name)
            if obj is None:
                raise MaterialCompileError(
                    f'Material compiler object "{object_name}" disappeared before installation.'
                )
            signature = tuple(sorted(
                (
                    entry["binding"].slot_index,
                    _variant_key(entry["decision"], entry["binding"]),
                )
                for entry in entries
            ))
            copy_groups.setdefault((obj.data.as_pointer(), signature), {
                "original": obj.data,
                "objects": [],
            })["objects"].append(object_name)

        for _group_key, group in sorted(
            copy_groups.items(), key=lambda item: item[1]["objects"][0].casefold(),
        ):
            original_data = group["original"]
            try:
                private_data = original_data.copy()
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                raise MaterialCompileError(
                    f'Cannot create a private export mesh from "{original_data.name}": {error}'
                ) from error
            swap = {
                "objects": [],
                "original": original_data,
                "private": private_data,
                # Declared by callers whose emit runs the baked pipeline:
                # freeze_evaluated_meshes legitimately replaces obj.data
                # before the restore runs.
                "emitReplacedData": bool(emit_replaces_mesh_data),
            }
            data_swaps.append(swap)
            # Avoid publishing an implementation-prefixed Mesh name. Blender
            # may add a normal numeric suffix while the source ID is present.
            private_data.name = original_data.name
            for object_name in sorted(group["objects"], key=str.casefold):
                obj = bpy.data.objects.get(object_name)
                if obj is None or obj.data != original_data:
                    raise MaterialCompileError(
                        f'Material compiler object "{object_name}" changed before installation.'
                    )
                try:
                    obj.data = private_data
                except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                    raise MaterialCompileError(
                        f'Cannot install a private export mesh for "{object_name}": {error}'
                    ) from error
                swap["objects"].append(object_name)

        material_bake_products = {}
        deferred_bake_entries = []
        for entry in binding_entries:
            decision = entry["decision"]
            binding = entry["binding"]
            obj = bpy.data.objects.get(binding.object_name)
            if obj is None or not (0 <= binding.slot_index < len(obj.material_slots)):
                raise MaterialCompileError(
                    f'Material binding {binding.object_name}[{binding.slot_index}] disappeared during installation.'
                )
            binding_key = (binding.object_name, binding.slot_index)
            if decision.intent == "tslProgram":
                if binding_key not in installed_binding_keys:
                    installed_bindings.append(entry)
                    installed_binding_keys.add(binding_key)
                program_key = ("tslProgram", decision.material_name)
                generated = generated_by_variant.get(program_key)
                if generated is None:
                    # ONE carrier per material, deliberately: the runtime
                    # resolves programs by blendlink_source_material and
                    # the attestation requires exactly one generated
                    # match. Per-binding variance rides the per-object
                    # mesh extras, not the material.
                    program_variant = hashlib.sha256(json.dumps(
                        decision.fingerprint_dict(), sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf8")).hexdigest()[:10]
                    try:
                        generated = entry["source"].copy()
                    except (AttributeError, ReferenceError, RuntimeError,
                            TypeError) as error:
                        raise MaterialCompileError(
                            f'Cannot copy "{decision.material_name}" for '
                            f"the TSL program carrier: {error}"
                        ) from error
                    generated.name = (
                        f"{decision.material_name}.BLENDLINK_TSL."
                        f"{program_variant}"
                    )
                    generated["blendlink_source_material"] = (
                        decision.material_name
                    )
                    generated["blendlink_material_rule"] = TSL_PROGRAM_RULE
                    generated["blendlink_material_variant"] = program_variant
                    created_materials.append(generated)
                    generated_by_variant[program_key] = generated
                    generated_facts[generated.name] = {
                        "source": decision.material_name,
                        "rule": TSL_PROGRAM_RULE,
                        "variant": program_variant,
                        "transport": "program",
                        # The carrier is the artist graph exported stock;
                        # its surface response and PBR derivation belong
                        # to the glTF exporter's own contract, not this
                        # plan. The attestation records them as observed
                        # instead of asserting planned values.
                        "surfaceResponse": None,
                        "bindings": set(),
                        "bindingRanges": {},
                        "bindingUvs": {},
                    }
                fact = generated_facts[generated.name]
                fact["bindings"].add(binding_key)
                runtime_entry = _tsl_runtime_mesh_entry(decision, obj)
                if runtime_entry is not None:
                    fact.setdefault("tslRuntimeMeshes", {})[
                        binding.object_name
                    ] = runtime_entry
                slot = obj.material_slots[binding.slot_index]
                try:
                    slot.link = "DATA"
                    slot.material = generated
                except (AttributeError, ReferenceError, RuntimeError,
                        TypeError) as error:
                    raise MaterialCompileError(
                        f'Cannot install the TSL program carrier on '
                        f'{binding.object_name}[{binding.slot_index}]: '
                        f"{error}"
                    ) from error
                continue
            if decision.intent == "materialBake":
                if temporary_directory is None:
                    temporary_directory = tempfile.TemporaryDirectory(
                        prefix="blendlink-material-bake-",
                    )
                variant = _variant_key(decision, binding)
                if binding_key not in installed_binding_keys:
                    installed_bindings.append(entry)
                    installed_binding_keys.add(binding_key)
                products = material_bake_products.get(variant)
                if products is None:
                    try:
                        products = _bake_material_channels(
                            decision, binding, obj,
                            temporary_directory.name,
                            created_materials, created_images,
                        )
                    except (OSError, RuntimeError, TypeError, ValueError) as error:
                        raise MaterialCompileError(
                            f'Material bake failed for '
                            f'"{decision.material_name}" on '
                            f'{binding.object_name}[{binding.slot_index}]: '
                            f"{error}"
                        ) from error
                    material_bake_products[variant] = products
                # Carrier, fact and slot install are DEFERRED to the
                # second pass below: shared surface pages (Phase 2 unit
                # F) need every unique-route variant's products in hand
                # before any carrier binds an image.
                deferred_bake_entries.append(entry)
                continue
                continue
            materialization = None
            if decision.color is not None \
                    and decision.color.kind == "materialized":
                if binding.materialization_plan is None:
                    raise MaterialCompileError(
                        f'Materialized binding {binding.object_name}'
                        f"[{binding.slot_index}] has no resolution plan."
                    )
                if temporary_directory is None:
                    temporary_directory = tempfile.TemporaryDirectory(
                        prefix="blendlink-selected-field-",
                    )
                bake_material = _materialized_bake_material(
                    decision,
                    created_materials,
                )
                slot = obj.material_slots[binding.slot_index]
                if binding_key not in installed_binding_keys:
                    installed_bindings.append(entry)
                    installed_binding_keys.add(binding_key)
                try:
                    slot.link = "DATA"
                    slot.material = bake_material
                except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                    raise MaterialCompileError(
                        f'Cannot install the private selected-field bake material '
                        f'on {binding.object_name}[{binding.slot_index}]: {error}'
                    ) from error
                try:
                    uv_evidence = bakelib.prepare_material_texture_uv(
                        obj,
                        binding.materialization_plan,
                    )
                    bpy.context.view_layer.update()
                    token = hashlib.sha256(
                        _variant_key(decision, binding).encode("utf8")
                    ).hexdigest()[:12]
                    texture_path = os.path.join(
                        temporary_directory.name,
                        f"selected-{token}.png",
                    )
                    image_evidence = bakelib.bake_emit_field_to_png(
                        [obj],
                        texture_path,
                        size=int(uv_evidence["resolution"]),
                        margin_px=int(uv_evidence["margin"]),
                        uv_layer=str(uv_evidence["uvName"]),
                        label=(
                            f'{decision.material_name} on '
                            f'{binding.object_name}[{binding.slot_index}]'
                        ),
                    )
                except (OSError, RuntimeError, TypeError, ValueError) as error:
                    raise MaterialCompileError(
                        f'Selected-field materialization failed for '
                        f'"{decision.material_name}" on '
                        f'{binding.object_name}[{binding.slot_index}]: {error}'
                    ) from error
                try:
                    image = bpy.data.images.load(
                        image_evidence["path"],
                        check_existing=False,
                    )
                    created_images.append(image)
                    image.name = f"BLENDLINK_WEB_SELECTED.{token}"
                    image.colorspace_settings.name = "sRGB"
                    image.alpha_mode = "STRAIGHT"
                except (AttributeError, RuntimeError, TypeError, ValueError) as error:
                    raise MaterialCompileError(
                        f'Cannot load the private selected-field PNG for '
                        f'"{decision.material_name}": {error}'
                    ) from error
                uv_source = FieldSource(
                    "image",
                    decision.color.node_name,
                    decision.color.socket_identifier,
                    decision.color.socket_name,
                    uv_mode="named",
                    uv_name=str(uv_evidence["uvName"]),
                )
                uv_descriptor, uv_problem = _uv_descriptor(
                    obj,
                    uv_source,
                    binding.slot_index,
                )
                if uv_descriptor is None:
                    raise MaterialCompileError(
                        f'Private selected-field UV for "{decision.material_name}" '
                        f"cannot be attested: {uv_problem}."
                    )
                materialization = {
                    "image": image,
                    "imageEvidence": image_evidence,
                    "uvEvidence": uv_evidence,
                    "uvDescriptor": uv_descriptor,
                    "uvName": uv_evidence["uvName"],
                }
            carrier_semantic = None
            if decision.transport == "vertexColor":
                carrier_semantic = _ensure_private_color_carrier(
                    obj.data, decision, binding, carrier_installs,
                )
            key = _variant_key(decision, binding)
            generated = generated_by_variant.get(key)
            if generated is None:
                generated = _generated_material(
                    decision,
                    binding,
                    created_materials,
                    materialization=materialization,
                )
                generated_by_variant[key] = generated
                alpha_value = (
                    decision.alpha.value[0]
                    if decision.alpha is not None and decision.alpha.value is not None else 1.0
                )
                alpha_mode = binding.alpha_mode
                if alpha_mode not in {"OPAQUE", "MASK", "BLEND"}:
                    raise MaterialCompileError(
                        f'Material plan for "{decision.material_name}" has no '
                        f'proven alpha mode for "{binding.object_name}'
                        f'[{binding.slot_index}]".'
                    )
                uses_alpha = alpha_mode != "OPAQUE"
                rgb = (
                    decision.surface_factorization.base_color_factor
                    if decision.surface_factorization is not None
                    else
                    (1.0, 1.0, 1.0)
                    if decision.color is None or decision.color.kind in {
                        "vertexColor", "image", "materialized",
                    }
                    else decision.color.value[:3]
                )
                generated_facts[generated.name] = {
                    "source": decision.material_name,
                    "rule": generated.get("blendlink_material_rule"),
                    "variant": generated.get("blendlink_material_variant"),
                    "transport": decision.transport,
                    "surfaceResponse": decision.surface_response,
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.5,
                    "usesAlpha": uses_alpha,
                    "alphaMode": alpha_mode,
                    "baseColorFactor": tuple(rgb) + (alpha_value,),
                    "doubleSided": not bool(entry["source"].use_backface_culling),
                    "carrierSemantic": carrier_semantic,
                    "color0Type": "VEC4" if decision.transport == "vertexColor" else None,
                    "image": (
                        {
                            "name": materialization["image"].name,
                            "sha256": materialization["imageEvidence"]["sha256"],
                            "mime": materialization["imageEvidence"]["mime"],
                            "width": materialization["imageEvidence"]["width"],
                            "height": materialization["imageEvidence"]["height"],
                            "interpolation": "Linear",
                            "extension": "EXTEND",
                        }
                        if materialization is not None else {
                            "name": decision.color.image_name,
                            "sha256": decision.color.image_hash,
                            "mime": decision.color.image_mime,
                            "width": decision.color.image_width,
                            "height": decision.color.image_height,
                            "interpolation": decision.color.interpolation,
                            "extension": decision.color.extension,
                        }
                    ) if decision.transport == "image" else None,
                    "texCoord": (
                        materialization["uvDescriptor"]["index"]
                        if materialization is not None
                        else binding.uv_index
                    ) if decision.transport == "image" else None,
                    "surfaceFactorization": (
                        decision.surface_factorization.fingerprint_dict()
                        if decision.surface_factorization is not None else None
                    ),
                    "emissiveImage": (
                        {
                            "name": materialization["image"].name,
                            "sha256": materialization[
                                "imageEvidence"
                            ]["sha256"],
                            "mime": materialization[
                                "imageEvidence"
                            ]["mime"],
                            "width": materialization[
                                "imageEvidence"
                            ]["width"],
                            "height": materialization[
                                "imageEvidence"
                            ]["height"],
                            "interpolation": "Linear",
                            "extension": "EXTEND",
                        }
                        if decision.surface_factorization is not None else None
                    ),
                    "emissiveTexCoord": (
                        materialization["uvDescriptor"]["index"]
                        if decision.surface_factorization is not None else None
                    ),
                    "emissiveFactor": (
                        decision.surface_factorization.emissive_factor
                        if decision.surface_factorization is not None else None
                    ),
                    "materialization": (
                        decision.color.materialization
                        if materialization is not None else None
                    ),
                    "materializationEvidence": (
                        {
                            "coveredFraction": materialization["imageEvidence"][
                                "coveredFraction"
                            ],
                            "rgbMin": list(materialization["imageEvidence"]["rgbMin"]),
                            "rgbMax": list(materialization["imageEvidence"]["rgbMax"]),
                            "deviceClass": materialization["imageEvidence"][
                                "deviceClass"
                            ],
                            "backend": materialization["imageEvidence"]["backend"],
                            "measurementModel": materialization["uvEvidence"][
                                "measurementModel"
                            ],
                            "resolutionPolicy": materialization["uvEvidence"][
                                "policy"
                            ],
                            "sourceUnitSystem": materialization["uvEvidence"][
                                "sourceUnitSystem"
                            ],
                            "sourceMetersPerBlenderUnit": materialization[
                                "uvEvidence"
                            ]["sourceMetersPerBlenderUnit"],
                            "sourceWorldAreaBlenderUnitsSquared": materialization[
                                "uvEvidence"
                            ]["sourceWorldAreaBlenderUnitsSquared"],
                            "sourceWorldAreaSquareMeters": materialization[
                                "uvEvidence"
                            ]["sourceWorldAreaSquareMeters"],
                            "projectionMetric": materialization["uvEvidence"][
                                "projectionMetric"
                            ],
                            "cameraScope": materialization["uvEvidence"][
                                "cameraScope"
                            ],
                            "cameraSelection": materialization["uvEvidence"][
                                "cameraSelection"
                            ],
                            "selectedCameraName": materialization["uvEvidence"][
                                "selectedCameraName"
                            ],
                            "selectedCameraStableId": materialization[
                                "uvEvidence"
                            ]["selectedCameraStableId"],
                            "eligibleCameraCount": materialization["uvEvidence"][
                                "eligibleCameraCount"
                            ],
                            "projectingCameraCount": materialization[
                                "uvEvidence"
                            ]["projectingCameraCount"],
                            "targetPxPerMeter": materialization["uvEvidence"][
                                "targetPxPerMeter"
                            ],
                            "targetProjectedPixels": materialization[
                                "uvEvidence"
                            ]["targetProjectedPixels"],
                            "projectedCoverageFraction": materialization[
                                "uvEvidence"
                            ]["projectedCoverageFraction"],
                            "projectedTriangleAreaSumPixelAreaCapped": materialization[
                                "uvEvidence"
                            ]["projectedTriangleAreaSumPixelAreaCapped"],
                            "projectedTriangleAreaSumFractionCapped": materialization[
                                "uvEvidence"
                            ]["projectedTriangleAreaSumFractionCapped"],
                            "achievedPxPerMeter": materialization["uvEvidence"][
                                "achievedPxPerMeter"
                            ],
                            "achievedProjectedPixels": materialization[
                                "uvEvidence"
                            ]["achievedProjectedPixels"],
                            "achievedTexelsPerBlenderUnit": materialization[
                                "uvEvidence"
                            ]["achievedTexelsPerBlenderUnit"],
                            "achievedTexelsPerSourceMeter": materialization[
                                "uvEvidence"
                            ]["achievedTexelsPerSourceMeter"],
                            "allocatedBindingTexelArea": materialization[
                                "uvEvidence"
                            ]["allocatedBindingTexelArea"],
                            "resolution": materialization["uvEvidence"][
                                "resolution"
                            ],
                            "minimumCandidateResolution": materialization[
                                "uvEvidence"
                            ]["minimumCandidateResolution"],
                            "densityRatio": materialization["uvEvidence"][
                                "densityRatio"
                            ],
                            "densityMet": materialization["uvEvidence"][
                                "densityMet"
                            ],
                            "uvStrategy": materialization["uvEvidence"][
                                "uvStrategy"
                            ],
                            "uvGenerationSpace": materialization[
                                "uvEvidence"
                            ]["uvGenerationSpace"],
                            "sourceUvName": materialization["uvEvidence"][
                                "sourceUvName"
                            ],
                            "sourceLayoutIssues": materialization["uvEvidence"][
                                "sourceLayoutIssues"
                            ],
                            "sourceRescuePolygonCount": materialization[
                                "uvEvidence"
                            ]["sourceRescuePolygonCount"],
                            "sourceRescueAttemptedPolygonCount": materialization[
                                "uvEvidence"
                            ]["sourceRescueAttemptedPolygonCount"],
                            "repairCount": materialization["uvEvidence"][
                                "repairCount"
                            ],
                            "uvRepairStrategies": materialization[
                                "uvEvidence"
                            ]["uvRepairStrategies"],
                            "ignoredZeroAreaTriangles": materialization[
                                "uvEvidence"
                            ]["ignoredZeroAreaTriangles"],
                            "zeroWorldAreaTriangleCount": materialization[
                                "uvEvidence"
                            ]["zeroWorldAreaTriangleCount"],
                            "uvArea": materialization["uvEvidence"]["uvArea"],
                            "margin": materialization["uvEvidence"]["margin"],
                        }
                        if materialization is not None else None
                    ),
                    "bindings": set(),
                    "bindingRanges": {},
                    "bindingUvs": {},
                }
            fact = generated_facts[generated.name]
            if fact["carrierSemantic"] != carrier_semantic:
                raise MaterialCompileError(
                    f'Material carrier for "{decision.material_name}" changed between bindings.'
                )
            binding_key = (binding.object_name, binding.slot_index)
            fact["bindings"].add(binding_key)
            if binding.attribute_min is not None and binding.attribute_max is not None:
                minimum = list(binding.attribute_min)
                maximum = list(binding.attribute_max)
                if decision.transport == "vertexColor" and not fact["usesAlpha"]:
                    minimum[3] = 1.0
                    maximum[3] = 1.0
                fact["bindingRanges"][binding_key] = {
                    "min": tuple(minimum),
                    "max": tuple(maximum),
                    "type": binding.attribute_type,
                }
            runtime_uv = (
                materialization["uvDescriptor"]
                if materialization is not None else None
            )
            if runtime_uv is not None:
                fact["bindingUvs"][binding_key] = {
                    "name": runtime_uv["name"],
                    "index": runtime_uv["index"],
                    "values": runtime_uv["values"],
                    "distinct": runtime_uv["distinct"],
                    "min": runtime_uv["min"],
                    "max": runtime_uv["max"],
                    "hash": runtime_uv["hash"],
                }
            elif binding.uv_values is not None:
                fact["bindingUvs"][binding_key] = {
                    "name": binding.uv_name,
                    "index": binding.uv_index,
                    "values": binding.uv_values,
                    "distinct": binding.uv_distinct_values,
                    "min": binding.uv_min,
                    "max": binding.uv_max,
                    "hash": binding.uv_hash,
                }
            slot = obj.material_slots[binding.slot_index]
            if binding_key not in installed_binding_keys:
                installed_bindings.append(entry)
                installed_binding_keys.add(binding_key)
            try:
                slot.link = "DATA"
                slot.material = generated
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                raise MaterialCompileError(
                    f'Cannot install the private website material on '
                    f'{binding.object_name}[{binding.slot_index}]: {error}'
                ) from error

        # Prune before the export reads UV order: this is what keeps the
        # private bake layer inside the TEXCOORD_0..3 range Three can bind.

        # ---- Shared surface pages (Phase 2 unit F) ----
        # Unique-route variants (one achieved resolution across all four
        # kinds, EXTEND sampling, per-binding identity) pack onto shared
        # per-kind pages: the allocator arranges, native-size integer
        # rects anchor at the allocated origins (scale >= 1 guarantees
        # the fit), the blit is a pure byte transplant of the
        # already-gated channel PNGs, and each binding's packed 0..1
        # layout scales into its rect. Tile-route variants keep their
        # private REPEAT textures; a lone unique variant pages nothing.
        page_images_by_variant = {}
        if deferred_bake_entries:
            unique_variants = {}
            for entry in deferred_bake_entries:
                variant = _variant_key(entry["decision"], entry["binding"])
                products = material_bake_products[variant]
                if not products.get("uvEvidence") \
                        or variant in unique_variants:
                    continue
                orm_entry = products["images"].get("orm")
                if orm_entry is not None and not (
                    {"Metallic", "Roughness"}
                    <= set(orm_entry.get("bakedChannels") or ())
                ):
                    # A partial ORM (one channel baked, the other riding
                    # its glTF factor) links only one SeparateColor lane,
                    # and Blender's exporter then SYNTHESIZES a packed
                    # metallicRoughness image instead of passing the page
                    # bytes through -- two byte-divergent images under one
                    # page name, which the attestation refuses (measured
                    # on ellie.watch_metal). Such variants keep their
                    # private textures; single-source kinds never
                    # re-encode, so full-ORM and no-ORM members page
                    # safely.
                    print(
                        "blendlink material pages: "
                        f"{entry['decision'].material_name!r} keeps "
                        "private textures (partial ORM would re-encode "
                        "on export)"
                    )
                    continue
                unique_variants[variant] = {
                    "variant": variant,
                    "resolution": int(
                        products["uvEvidence"]["resolution"],
                    ),
                }
            page_plans = (
                _plan_material_pages(sorted(
                    unique_variants.values(),
                    key=lambda item: item["variant"],
                ))
                if len(unique_variants) >= 2 else None
            )
            for page_plan in page_plans or ():
                saved_pages, page_token = _compose_material_pages(
                    page_plan, material_bake_products,
                    temporary_directory.name,
                )
                page_colorspaces = {
                    "baseColor": "sRGB", "emissive": "sRGB",
                    "orm": "Non-Color", "normal": "Non-Color",
                }
                page_bpy_images = {}
                for kind, saved in saved_pages.items():
                    image = bpy.data.images.load(
                        saved["path"], check_existing=False,
                    )
                    created_images.append(image)
                    image.name = (
                        f"BLENDLINK_WEB_PAGE.{page_token[:12]}.{kind}"
                    )
                    image.colorspace_settings.name = page_colorspaces[kind]
                    image.alpha_mode = "STRAIGHT"
                    page_bpy_images[kind] = image
                remapped_variants = set()
                for entry in deferred_bake_entries:
                    variant = _variant_key(
                        entry["decision"], entry["binding"],
                    )
                    rect = page_plan["rects"].get(variant)
                    if rect is None or variant in remapped_variants:
                        continue
                    remapped_variants.add(variant)
                    products = material_bake_products[variant]
                    binding = entry["binding"]
                    remap_obj = bpy.data.objects.get(binding.object_name)
                    if remap_obj is None:
                        raise MaterialCompileError(
                            f'Page member object '
                            f'"{binding.object_name}" disappeared before '
                            "the UV remap."
                        )
                    _remap_slot_uv_rect(
                        remap_obj, binding.slot_index,
                        products["uvEvidence"]["uvName"],
                        rect, page_plan["page"],
                    )
                for variant in page_plan["rects"]:
                    rect = page_plan["rects"][variant]
                    products = material_bake_products[variant]
                    page_images_by_variant[variant] = {
                        kind: {
                            "image": page_bpy_images[kind],
                            "saved": saved_pages[kind],
                            "uv": "unique",
                            # The MEMBER's own alpha decides the carrier's
                            # Alpha link (an opaque member must not gain
                            # one); the page record's page-wide hasAlpha
                            # rides "saved" for the byte attestation.
                            "hasAlpha": bool(item.get("hasAlpha")),
                            **({
                                "strength": item["strength"],
                            } if "strength" in item else {}),
                            **({
                                "bakedChannels": item["bakedChannels"],
                            } if "bakedChannels" in item else {}),
                            "pageRect": [rect[0], rect[1], rect[2]],
                            "page": page_plan["page"],
                        }
                        for kind, item in products["images"].items()
                        if kind in saved_pages
                    }
                member_area = sum(
                    rect[2] * rect[2]
                    for rect in page_plan["rects"].values()
                )
                print(
                    "blendlink material pages: packed "
                    f"{len(page_plan['rects'])} variants onto "
                    f"{len(saved_pages)} {page_plan['page']}px pages "
                    f"({100 * member_area // (page_plan['page'] ** 2)}% "
                    "fill)"
                )

        for entry in deferred_bake_entries:
            decision = entry["decision"]
            binding = entry["binding"]
            obj = bpy.data.objects.get(binding.object_name)
            if obj is None or not (
                0 <= binding.slot_index < len(obj.material_slots)
            ):
                raise MaterialCompileError(
                    f'Material binding {binding.object_name}'
                    f'[{binding.slot_index}] disappeared before carrier '
                    "installation."
                )
            binding_key = (binding.object_name, binding.slot_index)
            variant = _variant_key(decision, binding)
            products = material_bake_products[variant]
            page_images = page_images_by_variant.get(variant)
            generated = generated_by_variant.get(variant)
            if generated is None:
                generated = _generated_material_bake(
                    decision, binding, created_materials, products,
                    page_images=page_images,
                )
                fact_images = (
                    page_images if page_images is not None
                    else products["images"]
                )
                generated_by_variant[variant] = generated
                plan_records = {
                    item["channel"]: item
                    for item in (decision.channel_plan or {}).get(
                        "channels", (),
                    )
                }
                base_record = plan_records.get("Base Color")
                alpha_record = plan_records.get("Alpha")
                alpha_factor = (
                    float(alpha_record.get("value") or 1.0)
                    if alpha_record is not None
                    and alpha_record.get("route") == "factor" else 1.0
                )
                has_base_image = "baseColor" in products["images"]
                base_factor = (1.0, 1.0, 1.0)
                if not has_base_image and base_record is not None \
                        and base_record.get("route") == "factor":
                    value = base_record.get("value")
                    if isinstance(value, (list, tuple)) and len(value) >= 3:
                        base_factor = tuple(
                            float(item) for item in value[:3]
                        )
                metallic_factor = 1.0 if "orm" in products["images"] and \
                    "Metallic" in (
                        products["images"]["orm"].get("bakedChannels") or ()
                    ) else 0.0
                roughness_factor = 1.0 if "orm" in products["images"] and \
                    "Roughness" in (
                        products["images"]["orm"].get("bakedChannels") or ()
                    ) else 0.5
                for name, key in (
                    ("Metallic", "metallic"), ("Roughness", "roughness"),
                ):
                    record = plan_records.get(name)
                    if record is not None \
                            and record.get("route") == "factor" \
                            and isinstance(
                                record.get("value"), (int, float),
                            ):
                        if name == "Metallic":
                            metallic_factor = float(record["value"])
                        else:
                            roughness_factor = float(record["value"])
                generated_facts[generated.name] = {
                    "source": decision.material_name,
                    "rule": generated.get("blendlink_material_rule"),
                    "variant": generated.get("blendlink_material_variant"),
                    "transport": "channels",
                    "surfaceResponse": "lit",
                    "metallicFactor": metallic_factor,
                    "roughnessFactor": roughness_factor,
                    "usesAlpha": binding.alpha_mode != "OPAQUE",
                    "alphaMode": binding.alpha_mode,
                    "baseColorFactor": tuple(base_factor) + (
                        alpha_factor if not products["images"].get(
                            "baseColor", {},
                        ).get("hasAlpha") else 1.0,
                    ),
                    "doubleSided": not bool(
                        entry["source"].use_backface_culling,
                    ),
                    "carrierSemantic": None,
                    "color0Type": None,
                    "image": None,
                    "texCoord": None,
                    "surfaceFactorization": None,
                    "emissiveImage": None,
                    "emissiveTexCoord": None,
                    "emissiveFactor": None,
                    "materialization": None,
                    "materializationEvidence": None,
                    "materialBake": {
                        # TSL IR stays out of the glTF attestation
                        # evidence by declared scope: the evidence
                        # verifier has no channels/IR model, and the
                        # per-channel bodies belong to the plan
                        # record, not the GLB byte attestation.
                        "channels": [
                            {
                                key: value
                                for key, value in item.items()
                                if not key.startswith("tslIr")
                            }
                            for item in
                            (decision.channel_plan or {}).get(
                                "channels", (),
                            )
                        ],
                        "gates": products["gates"],
                        "images": {
                            kind: {
                                "sha256": item["saved"]["sha256"],
                                **({
                                    "pageRect": list(item["pageRect"]),
                                    "page": int(item["page"]),
                                } if "pageRect" in item else {}),
                                "mime": item["saved"]["mime"],
                                "width": item["saved"]["width"],
                                "height": item["saved"]["height"],
                                "colorspace": item["saved"]["colorspace"],
                                "hasAlpha": bool(
                                    item["saved"].get("hasAlpha"),
                                ),
                                "uv": item.get("uv"),
                                **({
                                    "strength": item["strength"],
                                } if "strength" in item else {}),
                            }
                            for kind, item in fact_images.items()
                        },
                        **({
                            "uvEvidence": {
                                "uvName": products["uvEvidence"]["uvName"],
                                "resolution": products["uvEvidence"][
                                    "resolution"
                                ],
                                "margin": products["uvEvidence"]["margin"],
                                "uvStrategy": products["uvEvidence"][
                                    "uvStrategy"
                                ],
                                "densityMet": products["uvEvidence"][
                                    "densityMet"
                                ],
                            },
                        } if products.get("uvEvidence") else {}),
                    },
                    "bindings": set(),
                    "bindingRanges": {},
                    "bindingUvs": {},
                }
            fact = generated_facts[generated.name]
            fact["bindings"].add(binding_key)
            runtime_entry = _tsl_runtime_mesh_entry(decision, obj)
            if runtime_entry is not None:
                fact.setdefault("tslRuntimeMeshes", {})[
                    binding.object_name
                ] = runtime_entry
            slot = obj.material_slots[binding.slot_index]
            try:
                slot.link = "DATA"
                slot.material = generated
            except (AttributeError, ReferenceError, RuntimeError,
                    TypeError) as error:
                raise MaterialCompileError(
                    f'Cannot install the private website material on '
                    f'{binding.object_name}[{binding.slot_index}]: {error}'
                ) from error

        _prune_unpublished_uv_layers(data_swaps, generated_facts)
        try:
            bpy.context.view_layer.update()
        except (AttributeError, ReferenceError, RuntimeError) as error:
            raise MaterialCompileError(
                f"Cannot update evaluated material bindings before glTF export: {error}"
            ) from error
        descriptor, staged_glb = tempfile.mkstemp(
            prefix=f".{os.path.basename(output_glb)}.blendlink-material-",
            suffix=".glb",
            dir=output_directory,
        )
        os.close(descriptor)
        os.unlink(staged_glb)
        value = emit(staged_glb)
        _rewrite_private_color_carriers(
            staged_glb, generated_facts, preserve_custom_attributes,
        )
        _rewrite_factorized_shared_textures(staged_glb, generated_facts)
        # Runtime extras go in BEFORE attestation so the evidence hashes the
        # bytes the runtime will actually load.
        _stamp_tsl_runtime_extras(staged_glb, generated_facts)
        gltf_evidence = _attest_generated_materials(staged_glb, generated_facts)
        compilation = MaterialCompilation(
            plan.source_fingerprint,
            tuple(decision.material_name for decision in plan.lowerings),
            tuple(sorted(generated_facts)),
            gltf_evidence,
        )
        result = (value, compilation)
    except BaseException as error:
        primary_error = error

    cleanup_errors = []
    for entry in reversed(installed_bindings):
        binding = entry["binding"]
        try:
            obj = bpy.data.objects.get(binding.object_name)
            if obj is None or not (0 <= binding.slot_index < len(obj.material_slots)):
                raise RuntimeError("binding disappeared")
            slot = obj.material_slots[binding.slot_index]
            slot.link = entry["oldLink"]
            slot.material = entry["oldMaterial"]
            if slot.link != entry["oldLink"] or slot.material != entry["oldMaterial"]:
                raise RuntimeError("binding did not restore exactly")
        except (AttributeError, ReferenceError, RuntimeError, TypeError, ValueError) as error:
            cleanup_errors.append(
                f'{binding.object_name}[{binding.slot_index}] material restore failed: {error}'
            )
    for swap in reversed(data_swaps):
        private_data = swap["private"]
        original_data = swap["original"]
        for object_name in reversed(swap["objects"]):
            try:
                obj = bpy.data.objects.get(object_name)
                if obj is None:
                    raise RuntimeError("object disappeared")
                if obj.data != private_data:
                    # The baked pipeline now runs INSIDE emit (Phase 2
                    # unit E), and its freeze_evaluated_meshes replaces
                    # obj.data with a frozen evaluated Mesh for every
                    # atlas-owned receiver -- for a composed
                    # lighting-owned object that replacement is expected,
                    # not third-party interference. The artist datablock
                    # still restores; the frozen mesh is the background
                    # export process's own transient, exactly as it is on
                    # the uncompiled path.
                    if not swap.get("emitReplacedData"):
                        raise RuntimeError(
                            "private Mesh binding changed before cleanup"
                        )
                obj.data = original_data
                if obj.data != original_data:
                    raise RuntimeError("source Mesh did not restore exactly")
            except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
                cleanup_errors.append(f'{object_name} Mesh restore failed: {error}')
        try:
            if private_data.users != 0:
                raise RuntimeError(f"private Mesh still has {private_data.users} users")
            bpy.data.meshes.remove(private_data)
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            cleanup_errors.append(f'private Mesh cleanup failed: {error}')
    for generated in reversed(created_materials):
        try:
            generated_name = generated.name
            if bpy.data.materials.get(generated_name) == generated:
                bpy.data.materials.remove(generated, do_unlink=True)
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            cleanup_errors.append(f'generated material cleanup failed: {error}')
    for image in reversed(created_images):
        try:
            image_name = image.name
            if bpy.data.images.get(image_name) == image:
                if image.users != 0:
                    raise RuntimeError(
                        f"private image still has {image.users} users"
                    )
                bpy.data.images.remove(image)
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            cleanup_errors.append(f'generated image cleanup failed: {error}')
    if temporary_directory is not None:
        try:
            temporary_directory.cleanup()
        except OSError as error:
            cleanup_errors.append(f'generated texture staging cleanup failed: {error}')

    if cleanup_errors:
        if staged_glb is not None and os.path.exists(staged_glb):
            try:
                os.remove(staged_glb)
            except OSError as error:
                cleanup_errors.append(
                    f"staged GLB cleanup failed: {error}"
                )
        cleanup_error = MaterialCompileError(
            "Website material compiler could not restore Blender state:\n- "
            + "\n- ".join(cleanup_errors)
        )
        if primary_error is not None:
            raise cleanup_error from primary_error
        raise cleanup_error
    if primary_error is not None:
        if staged_glb is not None and os.path.exists(staged_glb):
            try:
                os.remove(staged_glb)
            except OSError as cleanup_failure:
                raise MaterialCompileError(
                    "Website material compiler could not remove its failed "
                    f"staging GLB: {cleanup_failure}"
                ) from primary_error
        raise primary_error.with_traceback(primary_error.__traceback__)
    if result is None:
        raise MaterialCompileError("Website material compilation produced no result.")
    if staged_glb is None or not os.path.isfile(staged_glb):
        raise MaterialCompileError(
            "Website material compilation produced no attested staging GLB."
        )
    try:
        os.replace(staged_glb, output_glb)
    except OSError as error:
        try:
            if os.path.exists(staged_glb):
                os.remove(staged_glb)
        except OSError as cleanup_failure:
            raise MaterialCompileError(
                f"Cannot publish the attested GLB to {output_glb!r}: {error}; "
                f"staging cleanup also failed: {cleanup_failure}"
            ) from error
        raise MaterialCompileError(
            f"Cannot atomically publish the attested GLB to {output_glb!r}: {error}"
        ) from error
    return result
