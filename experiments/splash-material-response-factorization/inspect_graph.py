"""Inspect the authored Splash material graphs without modifying the .blend.

Run from the repository root:

    blender.exe --background <splash.blend> --python \
      experiments/splash-material-response-factorization/inspect_graph.py

The script emits one deterministic JSON report beside this file.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import bpy


SCRIPT_PATH = Path(__file__).resolve()
OUTPUT_PATH = SCRIPT_PATH.parent / "graph-evidence.json"
TARGET_MATERIALS = (
    "DPM",
    "DPM.002",
    "DPM.003",
    "DPM.006",
    "DPM.007",
    "DPM.008",
    "Bush.001",
    "Bush.005",
    "Bush.006",
    "plantsDPM",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    try:
        return [round(float(item), 9) for item in value]
    except (TypeError, ValueError):
        return str(value)


def socket_report(socket) -> dict:
    result = {
        "name": socket.name,
        "identifier": socket.identifier,
        "type": socket.type,
        "linked": socket.is_linked,
    }
    if hasattr(socket, "default_value"):
        result["default"] = value(socket.default_value)
    return result


def node_report(node) -> dict:
    result = {
        "name": node.name,
        "label": node.label,
        "type": node.bl_idname,
        "mute": node.mute,
        "inputs": [socket_report(socket) for socket in node.inputs],
        "outputs": [socket_report(socket) for socket in node.outputs],
    }
    for attribute in (
        "attribute_name",
        "blend_type",
        "data_type",
        "operation",
        "interpolation_type",
        "clamp_factor",
        "clamp_result",
    ):
        if hasattr(node, attribute):
            result[attribute] = value(getattr(node, attribute))
    if node.bl_idname == "ShaderNodeTexImage" and node.image is not None:
        result["image"] = {
            "name": node.image.name,
            "size": list(node.image.size[:]),
            "packed": bool(node.image.packed_file or node.image.packed_files),
            "colorspace": node.image.colorspace_settings.name,
        }
    if node.bl_idname == "ShaderNodeGroup" and node.node_tree is not None:
        result["nodeTree"] = node.node_tree.name
    if node.bl_idname in {"ShaderNodeValToRGB", "ShaderNodeRGBCurve"}:
        if node.bl_idname == "ShaderNodeValToRGB":
            result["colorRamp"] = [
                {
                    "position": round(float(element.position), 9),
                    "color": value(element.color),
                }
                for element in node.color_ramp.elements
            ]
        else:
            node.mapping.initialize()
            result["curves"] = [
                [value(point.location) for point in curve.points]
                for curve in node.mapping.curves
            ]
    return result


def tree_report(tree) -> dict:
    links = []
    for link in tree.links:
        if not link.is_valid:
            continue
        links.append(
            {
                "fromNode": link.from_node.name,
                "fromSocket": link.from_socket.name,
                "fromIdentifier": link.from_socket.identifier,
                "toNode": link.to_node.name,
                "toSocket": link.to_socket.name,
                "toIdentifier": link.to_socket.identifier,
            }
        )
    return {
        "name": tree.name,
        "nodes": [node_report(node) for node in tree.nodes],
        "links": links,
    }


def reachable_trees(root):
    result = {}
    pending = [root]
    while pending:
        tree = pending.pop()
        if tree.name in result:
            continue
        result[tree.name] = tree_report(tree)
        for node in tree.nodes:
            if node.bl_idname == "ShaderNodeGroup" and node.node_tree is not None:
                pending.append(node.node_tree)
    return result


def marker_report(material) -> list[dict]:
    return [
        {
            "node": node.name,
            "nodeTree": material.node_tree.name,
            "sourceKind": node.get("blendlink_source_kind"),
            "surfaceResponse": node.get("blendlink_surface_response"),
        }
        for node in material.node_tree.nodes
        if node.get("blendlink_web_color") or node.get("blendlink_web_value")
    ]


def main() -> None:
    blend_path = Path(bpy.data.filepath).resolve()
    materials = {}
    for name in TARGET_MATERIALS:
        material = bpy.data.materials.get(name)
        if material is None or material.node_tree is None:
            materials[name] = {"missing": True}
            continue
        users = []
        for obj in bpy.context.scene.objects:
            if obj.type != "MESH":
                continue
            for slot_index, slot in enumerate(obj.material_slots):
                if slot.material == material:
                    users.append({"object": obj.name, "slot": slot_index})
        materials[name] = {
            "blendMethod": getattr(material, "surface_render_method", None),
            "markers": marker_report(material),
            "users": users,
            "trees": reachable_trees(material.node_tree),
        }

    report = {
        "schemaVersion": 1,
        "kind": "blendlink-splash-material-response-graph-evidence",
        "blender": bpy.app.version_string,
        "source": {"path": str(blend_path), "sha256": sha256(blend_path)},
        "world": (
            {
                "name": bpy.context.scene.world.name,
                "trees": reachable_trees(bpy.context.scene.world.node_tree),
            }
            if bpy.context.scene.world is not None
            and bpy.context.scene.world.node_tree is not None
            else None
        ),
        "materials": materials,
    }
    OUTPUT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"BLENDLINK_SPLASH_GRAPH_EVIDENCE={OUTPUT_PATH}")


if __name__ == "__main__":
    main()
