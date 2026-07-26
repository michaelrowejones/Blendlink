"""Read-only structural inventory for the private TrapX corpus scene.

Run Blender with --factory-startup --disable-autoexec and never save the file.
Only normalized JSON evidence is written under this experiment's ignored output
directory.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable

import bpy


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    try:
        return [json_value(item) for item in value]
    except TypeError:
        return str(value)


def custom_properties(owner: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    try:
        keys = sorted(key for key in owner.keys() if key != "_RNA_UI")
    except (AttributeError, TypeError):
        return result
    for key in keys:
        try:
            result[key] = json_value(owner[key])
        except Exception as exc:  # Evidence must name inaccessible data.
            result[key] = f"<unreadable: {type(exc).__name__}: {exc}>"
    return result


def matrix_rows(matrix: Any) -> list[list[float]]:
    return [[float(value) for value in row] for row in matrix]


def node_histogram(nodes: Iterable[Any]) -> dict[str, int]:
    return dict(sorted(Counter(node.bl_idname for node in nodes).items()))


def active_material_output(material: Any) -> dict[str, Any] | None:
    if not material.use_nodes or not material.node_tree:
        return None
    outputs = [
        node for node in material.node_tree.nodes
        if node.bl_idname == "ShaderNodeOutputMaterial"
    ]
    output = next((node for node in outputs if getattr(node, "is_active_output", False)), None)
    output = output or (outputs[0] if outputs else None)
    if output is None:
        return None
    surface = output.inputs.get("Surface")
    source = None
    if surface and surface.is_linked:
        link = surface.links[0]
        source = {
            "node": link.from_node.name,
            "nodeType": link.from_node.bl_idname,
            "socket": link.from_socket.name,
        }
    return {
        "node": output.name,
        "target": getattr(output, "target", None),
        "surface": source,
    }


def material_inventory() -> list[dict[str, Any]]:
    users: dict[Any, list[str]] = defaultdict(list)
    for obj in bpy.data.objects:
        for slot in obj.material_slots:
            if slot.material:
                users[slot.material].append(obj.name)

    records: list[dict[str, Any]] = []
    for material in sorted(bpy.data.materials, key=lambda item: item.name):
        tree = material.node_tree if material.use_nodes else None
        nodes = list(tree.nodes) if tree else []
        records.append({
            "name": material.name,
            "library": material.library.filepath if material.library else None,
            "users": material.users,
            "boundObjectCount": len(set(users.get(material, []))),
            "boundObjects": sorted(set(users.get(material, []))),
            "useNodes": bool(material.use_nodes),
            "surfaceRenderMethod": getattr(material, "surface_render_method", None),
            "blendMethod": getattr(material, "blend_method", None),
            "surfaceRenderMethodFallback": getattr(
                material, "surface_render_method", None
            ),
            "useTransparentShadow": getattr(material, "use_transparent_shadow", None),
            "showTransparentBack": getattr(material, "show_transparent_back", None),
            "useScreenRefraction": getattr(material, "use_screen_refraction", None),
            "displacementMethod": getattr(material, "displacement_method", None),
            "diffuseColor": json_value(material.diffuse_color),
            "metallic": float(material.metallic),
            "roughness": float(material.roughness),
            "nodeTypes": node_histogram(nodes),
            "activeOutput": active_material_output(material),
            "nodeGroups": sorted({
                node.node_tree.name
                for node in nodes
                if node.bl_idname == "ShaderNodeGroup" and node.node_tree
            }),
            "scriptNodes": [{
                "name": node.name,
                "mode": getattr(node, "mode", None),
                "filepath": getattr(node, "filepath", None),
            } for node in nodes if node.bl_idname == "ShaderNodeScript"],
            "customProperties": custom_properties(material),
        })
    return records


def node_group_inventory() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for group in sorted(bpy.data.node_groups, key=lambda item: item.name):
        nodes = list(group.nodes)
        records.append({
            "name": group.name,
            "treeType": group.bl_idname,
            "library": group.library.filepath if group.library else None,
            "users": group.users,
            "nodeTypes": node_histogram(nodes),
            "nestedGroups": sorted({
                node.node_tree.name
                for node in nodes
                if getattr(node, "node_tree", None)
            }),
            "scriptNodes": [{
                "name": node.name,
                "mode": getattr(node, "mode", None),
                "filepath": getattr(node, "filepath", None),
            } for node in nodes if node.bl_idname == "ShaderNodeScript"],
            "customProperties": custom_properties(group),
        })
    return records


def resolved_image_path(image: Any) -> str | None:
    if not image.filepath:
        return None
    try:
        return bpy.path.abspath(image.filepath, library=image.library)
    except Exception:
        return bpy.path.abspath(image.filepath)


def image_inventory() -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for image in sorted(bpy.data.images, key=lambda item: item.name):
        path = resolved_image_path(image)
        records.append({
            "name": image.name,
            "source": image.source,
            "type": image.type,
            "size": [int(value) for value in image.size],
            "channels": int(image.channels),
            "alphaMode": image.alpha_mode,
            "colorspace": image.colorspace_settings.name,
            "filepath": image.filepath,
            "resolvedPath": path,
            "exists": bool(path and os.path.exists(path)),
            "packed": image.packed_file is not None,
            "packedBytes": (
                len(image.packed_file.data)
                if image.packed_file is not None
                else None
            ),
            "library": image.library.filepath if image.library else None,
            "users": image.users,
            "customProperties": custom_properties(image),
        })
    return records


def object_inventory(scene: Any) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for obj in sorted(scene.objects, key=lambda item: item.name):
        records.append({
            "name": obj.name,
            "type": obj.type,
            "data": obj.data.name if obj.data else None,
            "library": obj.library.filepath if obj.library else None,
            "hideRender": bool(obj.hide_render),
            "hideViewport": bool(obj.hide_viewport),
            "visibleGet": bool(obj.visible_get()),
            "instanceType": obj.instance_type,
            "instanceCollection": (
                obj.instance_collection.name if obj.instance_collection else None
            ),
            "parent": obj.parent.name if obj.parent else None,
            "matrixWorld": matrix_rows(obj.matrix_world),
            "materialSlots": [
                slot.material.name if slot.material else None
                for slot in obj.material_slots
            ],
            "modifiers": [{
                "name": modifier.name,
                "type": modifier.type,
                "showRender": bool(modifier.show_render),
                "showViewport": bool(modifier.show_viewport),
                "nodeGroup": (
                    modifier.node_group.name
                    if modifier.type == "NODES" and modifier.node_group
                    else None
                ),
            } for modifier in obj.modifiers],
            "animation": {
                "action": (
                    obj.animation_data.action.name
                    if obj.animation_data and obj.animation_data.action
                    else None
                ),
                "nlaTracks": (
                    len(obj.animation_data.nla_tracks)
                    if obj.animation_data
                    else 0
                ),
                "drivers": (
                    len(obj.animation_data.drivers)
                    if obj.animation_data
                    else 0
                ),
            },
            "customProperties": custom_properties(obj),
        })
    return records


def camera_inventory(scene: Any) -> dict[str, Any] | None:
    camera = scene.camera
    if camera is None:
        return None
    data = camera.data
    return {
        "object": camera.name,
        "data": data.name,
        "type": data.type,
        "matrixWorld": matrix_rows(camera.matrix_world),
        "lens": float(data.lens),
        "sensorFit": data.sensor_fit,
        "sensorWidth": float(data.sensor_width),
        "sensorHeight": float(data.sensor_height),
        "shiftX": float(data.shift_x),
        "shiftY": float(data.shift_y),
        "clipStart": float(data.clip_start),
        "clipEnd": float(data.clip_end),
        "dof": {
            "enabled": bool(data.dof.use_dof),
            "focusObject": data.dof.focus_object.name if data.dof.focus_object else None,
            "focusDistance": float(data.dof.focus_distance),
            "apertureFstop": float(data.dof.aperture_fstop),
        },
        "customProperties": custom_properties(camera),
    }


def world_inventory(scene: Any) -> dict[str, Any] | None:
    world = scene.world
    if world is None:
        return None
    nodes = list(world.node_tree.nodes) if world.use_nodes and world.node_tree else []
    return {
        "name": world.name,
        "useNodes": bool(world.use_nodes),
        "color": json_value(world.color),
        "nodeTypes": node_histogram(nodes),
        "customProperties": custom_properties(world),
    }


def light_inventory(scene: Any) -> list[dict[str, Any]]:
    return [{
        "object": obj.name,
        "data": obj.data.name,
        "type": obj.data.type,
        "energy": float(obj.data.energy),
        "color": json_value(obj.data.color),
        "shape": getattr(obj.data, "shape", None),
        "size": getattr(obj.data, "size", None),
        "sizeY": getattr(obj.data, "size_y", None),
        "useShadow": getattr(obj.data, "use_shadow", None),
        "hideRender": bool(obj.hide_render),
        "matrixWorld": matrix_rows(obj.matrix_world),
        "customProperties": custom_properties(obj),
    } for obj in sorted(scene.objects, key=lambda item: item.name) if obj.type == "LIGHT"]


def scene_inventory(scene: Any) -> dict[str, Any]:
    render = scene.render
    cycles = getattr(scene, "cycles", None)
    eevee = getattr(scene, "eevee", None)
    objects = object_inventory(scene)
    compositor_tree = getattr(scene, "node_tree", None)
    if compositor_tree is None:
        compositor_tree = getattr(scene, "compositing_node_group", None)
    compositor_nodes = list(compositor_tree.nodes) if compositor_tree else []
    return {
        "name": scene.name,
        "renderEngine": render.engine,
        "frame": {
            "current": int(scene.frame_current),
            "subframe": float(scene.frame_subframe),
            "start": int(scene.frame_start),
            "end": int(scene.frame_end),
            "step": int(scene.frame_step),
            "fps": float(render.fps / render.fps_base),
        },
        "resolution": {
            "x": int(render.resolution_x),
            "y": int(render.resolution_y),
            "percentage": int(render.resolution_percentage),
            "pixelAspectX": float(render.pixel_aspect_x),
            "pixelAspectY": float(render.pixel_aspect_y),
        },
        "film": {
            "transparent": bool(render.film_transparent),
            "transparentGlass": getattr(render, "film_transparent_glass", None),
        },
        "colorManagement": {
            "displayDevice": scene.display_settings.display_device,
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": float(scene.view_settings.exposure),
            "gamma": float(scene.view_settings.gamma),
            "viewSettingsCustomProperties": custom_properties(scene.view_settings),
        },
        "cycles": {
            "device": getattr(cycles, "device", None),
            "samples": getattr(cycles, "samples", None),
            "useDenoising": getattr(cycles, "use_denoising", None),
            "previewSamples": getattr(cycles, "preview_samples", None),
        } if cycles else None,
        "eevee": {
            "taaRenderSamples": getattr(eevee, "taa_render_samples", None),
            "useGtao": getattr(eevee, "use_gtao", None),
            "useRaytracing": getattr(eevee, "use_raytracing", None),
        } if eevee else None,
        "camera": camera_inventory(scene),
        "world": world_inventory(scene),
        "lights": light_inventory(scene),
        "objectCounts": dict(sorted(Counter(item["type"] for item in objects).items())),
        "objects": objects,
        "collections": [{
            "name": collection.name,
            "hideRender": bool(collection.hide_render),
            "hideViewport": bool(collection.hide_viewport),
            "objectCount": len(collection.objects),
            "children": sorted(child.name for child in collection.children),
            "customProperties": custom_properties(collection),
        } for collection in sorted(bpy.data.collections, key=lambda item: item.name)],
        "viewLayers": [{
            "name": layer.name,
            "use": bool(layer.use),
            "usePassZ": bool(layer.use_pass_z),
            "usePassNormal": bool(layer.use_pass_normal),
            "usePassMist": bool(layer.use_pass_mist),
            "customProperties": custom_properties(layer),
        } for layer in scene.view_layers],
        "compositor": {
            "enabled": bool(scene.use_nodes),
            "nodeTypes": node_histogram(compositor_nodes),
        },
        "customProperties": custom_properties(scene),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(
        list(__import__("sys").argv)[list(__import__("sys").argv).index("--") + 1:]
    )
    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    images = image_inventory()
    materials = material_inventory()
    node_groups = node_group_inventory()
    report = {
        "schemaVersion": 1,
        "capturedAtUtc": datetime.now(timezone.utc).isoformat(),
        "execution": {
            "factoryStartup": True,
            "autoexecDisabled": True,
            "sourceSaved": False,
        },
        "source": {
            "path": str(source),
            "bytes": source.stat().st_size,
            "sha256": sha256(source),
            "blenderDataFilepath": bpy.data.filepath,
            "blendVersion": list(getattr(bpy.data, "version", ())),
            "isSaved": bool(bpy.data.is_saved),
            "isDirtyAtInventory": bool(bpy.data.is_dirty),
        },
        "toolchain": {
            "blenderVersion": bpy.app.version_string,
            "blenderVersionTuple": list(bpy.app.version),
            "buildHash": bpy.app.build_hash.decode(
                "ascii", errors="replace"
            ) if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash),
            "background": bool(bpy.app.background),
            "autoexecFail": bool(getattr(bpy.app, "autoexec_fail", False)),
            "autoexecFailMessage": getattr(bpy.app, "autoexec_fail_message", ""),
        },
        "activeScene": bpy.context.scene.name if bpy.context.scene else None,
        "scenes": [scene_inventory(scene) for scene in bpy.data.scenes],
        "materials": materials,
        "materialNodeTypeTotals": dict(sorted(Counter(
            node_type
            for material in materials
            for node_type, count in material["nodeTypes"].items()
            for _ in range(count)
        ).items())),
        "nodeGroups": node_groups,
        "nodeGroupTypeTotals": dict(sorted(Counter(
            node_type
            for group in node_groups
            for node_type, count in group["nodeTypes"].items()
            for _ in range(count)
        ).items())),
        "images": images,
        "missingExternalImages": [
            image["name"]
            for image in images
            if image["filepath"] and not image["packed"] and not image["exists"]
        ],
        "libraries": [{
            "name": library.name,
            "filepath": library.filepath,
            "resolvedPath": bpy.path.abspath(library.filepath),
            "exists": os.path.exists(bpy.path.abspath(library.filepath)),
        } for library in bpy.data.libraries],
        "texts": [{
            "name": text.name,
            "filepath": text.filepath,
            "isModified": bool(text.is_modified),
            "users": text.users,
        } for text in sorted(bpy.data.texts, key=lambda item: item.name)],
        "actions": [{
            "name": action.name,
            "frameRange": [float(value) for value in action.frame_range],
            "users": action.users,
        } for action in sorted(bpy.data.actions, key=lambda item: item.name)],
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        "BLENDLINK_TRAPX_INVENTORY_OK "
        f"sha256={report['source']['sha256']} "
        f"scenes={len(report['scenes'])} materials={len(materials)} "
        f"images={len(images)}"
    )


if __name__ == "__main__":
    main()
