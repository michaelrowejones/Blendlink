"""Read-only capability inventory for the Blender 4.5 DOGWALK splash file.

Run with Blender 5.2:

  blender.exe --background --factory-startup dogwalk.blend \
    --python inspect_source.py -- output/source-inventory.json

The source file is never saved.  The report intentionally separates authored
datablocks from evaluated instances because either count alone can hide a
transport gap.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

import bpy


SENTINEL = "##blendlink-dogwalk-source-audit "


def _counter(values):
    return dict(sorted(Counter(values).items()))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_value(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "items"):
        return {
            str(key): _json_value(child)
            for key, child in value.items()
        }
    if hasattr(value, "to_list"):
        return [_json_value(child) for child in value.to_list()]
    try:
        return [_json_value(child) for child in value]
    except TypeError:
        return repr(value)


def _custom_properties(owner):
    try:
        keys = sorted(owner.keys())
    except TypeError:
        return {}
    return {
        key: _json_value(owner[key])
        for key in keys
        if key != "_RNA_UI"
    }


def _animation_record(owner):
    animation = getattr(owner, "animation_data", None)
    if animation is None:
        return None
    action = getattr(animation, "action", None)
    tracks = list(getattr(animation, "nla_tracks", ()))
    drivers = list(getattr(animation, "drivers", ()))
    if action is None and not tracks and not drivers:
        return None
    return {
        "ownerType": type(owner).__name__,
        "owner": getattr(owner, "name", None),
        "action": action.name if action else None,
        "nlaTracks": [
            {
                "name": track.name,
                "mute": track.mute,
                "solo": track.is_solo,
                "strips": [
                    {
                        "name": strip.name,
                        "action": strip.action.name if strip.action else None,
                        "frameStart": strip.frame_start,
                        "frameEnd": strip.frame_end,
                    }
                    for strip in track.strips
                ],
            }
            for track in tracks
        ],
        "drivers": [
            {
                "dataPath": curve.data_path,
                "arrayIndex": curve.array_index,
                "expression": curve.driver.expression,
                "type": curve.driver.type,
                "variables": [
                    {
                        "name": variable.name,
                        "type": variable.type,
                        "targets": [
                            {
                                "idType": target.id_type,
                                "id": target.id.name if target.id else None,
                                "dataPath": target.data_path,
                                "boneTarget": target.bone_target,
                                "transformType": target.transform_type,
                                "transformSpace": target.transform_space,
                            }
                            for target in variable.targets
                        ],
                    }
                    for variable in curve.driver.variables
                ],
            }
            for curve in drivers
        ],
    }


def _safe_node_default(socket):
    if socket is None or socket.is_linked or not hasattr(socket, "default_value"):
        return None
    return _json_value(socket.default_value)


def _active_surface_node(material):
    if not material.use_nodes or not material.node_tree:
        return None
    outputs = [
        node
        for node in material.node_tree.nodes
        if node.type == "OUTPUT_MATERIAL" and node.is_active_output
    ]
    if not outputs:
        return None
    surface = outputs[0].inputs.get("Surface")
    if surface is None or not surface.is_linked:
        return None
    return surface.links[0].from_node


def _material_record(material, used_by):
    nodes = list(material.node_tree.nodes) if material.use_nodes and material.node_tree else []
    links = list(material.node_tree.links) if material.use_nodes and material.node_tree else []
    active = _active_surface_node(material)
    images = sorted(
        {
            node.image.name
            for node in nodes
            if node.type == "TEX_IMAGE" and node.image is not None
        }
    )
    principled = [node for node in nodes if node.type == "BSDF_PRINCIPLED"]
    return {
        "name": material.name,
        "usedBy": sorted(used_by),
        "users": material.users,
        "surfaceRenderMethod": (
            material.surface_render_method
            if hasattr(material, "surface_render_method")
            else getattr(material, "blend_method", None)
        ),
        "useNodes": material.use_nodes,
        "nodeTypes": _counter(node.bl_idname for node in nodes),
        "links": len(links),
        "activeSurfaceNode": (
            {
                "name": active.name,
                "type": active.bl_idname,
            }
            if active
            else None
        ),
        "principledDefaults": [
            {
                "name": node.name,
                "baseColor": _safe_node_default(node.inputs.get("Base Color")),
                "metallic": _safe_node_default(node.inputs.get("Metallic")),
                "roughness": _safe_node_default(node.inputs.get("Roughness")),
                "alpha": _safe_node_default(node.inputs.get("Alpha")),
            }
            for node in principled
        ],
        "images": images,
        "customProperties": _custom_properties(material),
    }


def _image_record(image):
    packed_files = list(getattr(image, "packed_files", ()))
    packed_bytes = sum(getattr(packed, "size", 0) for packed in packed_files)
    if not packed_files and image.packed_file is not None:
        packed_bytes = getattr(image.packed_file, "size", 0)
    resolved = bpy.path.abspath(image.filepath) if image.filepath else ""
    return {
        "name": image.name,
        "source": image.source,
        "fileFormat": image.file_format,
        "size": list(image.size),
        "colorspace": image.colorspace_settings.name,
        "alphaMode": image.alpha_mode,
        "packed": image.packed_file is not None or bool(packed_files),
        "packedFiles": len(packed_files),
        "packedBytes": packed_bytes,
        "filepath": resolved,
        "externalExists": bool(resolved and Path(resolved).exists()),
        "users": image.users,
    }


def _curve_record(obj, depsgraph):
    data = obj.data
    evaluated = obj.evaluated_get(depsgraph)
    mesh = None
    evaluated_stats = None
    try:
        mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
        evaluated_stats = {
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "polygons": len(mesh.polygons),
            "triangles": sum(max(len(polygon.vertices) - 2, 0) for polygon in mesh.polygons),
        }
    except (RuntimeError, TypeError, AttributeError) as error:
        evaluated_stats = {"error": str(error)}
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()
    return {
        "name": obj.name,
        "data": data.name,
        "hideRender": obj.hide_render,
        "visibleInViewLayer": obj.visible_get(),
        "dimensions": data.dimensions,
        "resolutionU": data.resolution_u,
        "renderResolutionU": data.render_resolution_u,
        "bevelDepth": data.bevel_depth,
        "bevelResolution": data.bevel_resolution,
        "extrude": data.extrude,
        "fillMode": data.fill_mode,
        "splines": len(data.splines),
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "modifiers": [
            {
                "name": modifier.name,
                "type": modifier.type,
                "showRender": modifier.show_render,
            }
            for modifier in obj.modifiers
        ],
        "evaluatedMesh": evaluated_stats,
    }


def _modifier_record(obj, modifier):
    record = {
        "object": obj.name,
        "name": modifier.name,
        "type": modifier.type,
        "showRender": modifier.show_render,
        "showViewport": modifier.show_viewport,
    }
    if modifier.type == "NODES":
        group = modifier.node_group
        record.update(
            {
                "nodeGroup": group.name if group else None,
                "nodeTypes": (
                    _counter(node.bl_idname for node in group.nodes)
                    if group
                    else {}
                ),
                "customProperties": _custom_properties(modifier),
            }
        )
    if modifier.type == "ARMATURE":
        record["armature"] = modifier.object.name if modifier.object else None
    return record


def _armature_record(obj):
    animation = _animation_record(obj)
    return {
        "name": obj.name,
        "data": obj.data.name,
        "bones": len(obj.data.bones),
        "poseBones": len(obj.pose.bones),
        "hideRender": obj.hide_render,
        "visibleInViewLayer": obj.visible_get(),
        "action": animation["action"] if animation else None,
        "nlaTracks": animation["nlaTracks"] if animation else [],
        "constraints": _counter(
            constraint.type
            for pose_bone in obj.pose.bones
            for constraint in pose_bone.constraints
        ),
    }


def _license_texts():
    records = []
    needles = ("license", "readme", "copyright", "creative commons", "cc-by", "cc0")
    for text in bpy.data.texts:
        body = text.as_string()
        if any(needle in (text.name + "\n" + body).lower() for needle in needles):
            records.append(
                {
                    "name": text.name,
                    "characters": len(body),
                    "excerpt": body[:4096],
                }
            )
    return records


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 1:
        raise RuntimeError("Expected one output JSON path after --")
    output = Path(argv[0]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    source = Path(bpy.data.filepath).resolve()
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = list(scene.objects)
    renderable_types = {
        "MESH",
        "CURVE",
        "CURVES",
        "SURFACE",
        "META",
        "FONT",
        "VOLUME",
        "GPENCIL",
        "GREASEPENCIL",
    }
    render_visible = [
        obj
        for obj in objects
        if obj.type in renderable_types and not obj.hide_render
    ]

    used_by = defaultdict(list)
    for obj in render_visible:
        for slot in obj.material_slots:
            if slot.material:
                used_by[slot.material.name].append(obj.name)

    instance_records = []
    for instance in depsgraph.object_instances:
        obj = instance.object
        original = obj.original if hasattr(obj, "original") else obj
        parent = instance.parent
        parent_original = (
            parent.original if parent and hasattr(parent, "original") else parent
        )
        instance_records.append(
            {
                "isInstance": instance.is_instance,
                "object": original.name if original else None,
                "type": original.type if original else None,
                "parent": parent_original.name if parent_original else None,
                "persistentId": [
                    value for value in instance.persistent_id if value != 2147483647
                ],
            }
        )

    animation_owners = []
    animation_candidates = (
        list(bpy.data.objects)
        + [obj.data for obj in bpy.data.objects if getattr(obj, "data", None)]
        + list(bpy.data.materials)
        + list(bpy.data.worlds)
        + list(bpy.data.node_groups)
        + list(bpy.data.collections)
        + list(bpy.data.scenes)
    )
    seen_animation_owners = set()
    for owner in animation_candidates:
        pointer = owner.as_pointer() if hasattr(owner, "as_pointer") else id(owner)
        if pointer in seen_animation_owners:
            continue
        seen_animation_owners.add(pointer)
        record = _animation_record(owner)
        if record:
            animation_owners.append(record)

    collection_instances = [
        {
            "name": obj.name,
            "collection": obj.instance_collection.name if obj.instance_collection else None,
            "hideRender": obj.hide_render,
            "visibleInViewLayer": obj.visible_get(),
            "collectionObjects": (
                len(obj.instance_collection.all_objects)
                if obj.instance_collection
                else 0
            ),
            "collectionObjectTypes": (
                _counter(item.type for item in obj.instance_collection.all_objects)
                if obj.instance_collection
                else {}
            ),
            "parent": obj.parent.name if obj.parent else None,
        }
        for obj in objects
        if obj.instance_type == "COLLECTION"
    ]

    modifiers = [
        _modifier_record(obj, modifier)
        for obj in objects
        for modifier in obj.modifiers
    ]
    custom_property_owners = []
    for owner in list(bpy.data.scenes) + objects + list(bpy.data.materials):
        props = _custom_properties(owner)
        if props:
            custom_property_owners.append(
                {
                    "ownerType": type(owner).__name__,
                    "owner": owner.name,
                    "properties": props,
                }
            )

    camera = scene.camera
    world_nodes = (
        list(scene.world.node_tree.nodes)
        if scene.world and scene.world.use_nodes and scene.world.node_tree
        else []
    )
    compositor_tree = getattr(scene, "compositing_node_group", None) or getattr(
        scene, "node_tree", None
    )
    report = {
        "schemaVersion": 1,
        "source": {
            "path": source.as_posix(),
            "bytes": source.stat().st_size,
            "mtimeNs": source.stat().st_mtime_ns,
            "sha256": _sha256(source),
        },
        "toolchain": {
            "blender": bpy.app.version_string,
            "version": list(bpy.app.version),
            "buildHash": bpy.app.build_hash.decode("utf8"),
            "buildDate": bpy.app.build_date.decode("utf8"),
            "platform": bpy.app.build_platform.decode("utf8"),
        },
        "scene": {
            "name": scene.name,
            "viewLayer": view_layer.name,
            "renderEngine": scene.render.engine,
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "frameCurrent": scene.frame_current,
            "fps": scene.render.fps / scene.render.fps_base,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "resolutionPercentage": scene.render.resolution_percentage,
            "pixelAspect": [scene.render.pixel_aspect_x, scene.render.pixel_aspect_y],
            "activeCamera": camera.name if camera else None,
            "world": scene.world.name if scene.world else None,
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": scene.view_settings.exposure,
            "gamma": scene.view_settings.gamma,
            "filmTransparent": scene.render.film_transparent,
            "compositor": {
                "enabled": bool(compositor_tree),
                "nodeTypes": (
                    _counter(node.bl_idname for node in compositor_tree.nodes)
                    if compositor_tree
                    else {}
                ),
            },
            "customProperties": _custom_properties(scene),
        },
        "camera": (
            {
                "name": camera.name,
                "data": camera.data.name,
                "type": camera.data.type,
                "lens": camera.data.lens,
                "sensorFit": camera.data.sensor_fit,
                "sensorWidth": camera.data.sensor_width,
                "clipStart": camera.data.clip_start,
                "clipEnd": camera.data.clip_end,
                "dof": camera.data.dof.use_dof,
                "matrixWorld": [list(row) for row in camera.matrix_world],
                "constraints": [
                    {
                        "name": constraint.name,
                        "type": constraint.type,
                        "target": constraint.target.name
                        if getattr(constraint, "target", None)
                        else None,
                    }
                    for constraint in camera.constraints
                ],
            }
            if camera
            else None
        ),
        "objects": {
            "total": len(objects),
            "byType": _counter(obj.type for obj in objects),
            "renderVisibleByType": _counter(obj.type for obj in render_visible),
            "hiddenRenderByType": _counter(
                obj.type for obj in objects if obj.hide_render
            ),
            "visibleInViewLayerByType": _counter(
                obj.type for obj in objects if obj.visible_get()
            ),
            "shapeKeys": sorted(
                obj.name
                for obj in objects
                if getattr(getattr(obj, "data", None), "shape_keys", None)
            ),
            "constraints": _counter(
                constraint.type for obj in objects for constraint in obj.constraints
            ),
            "collectionInstances": collection_instances,
        },
        "evaluated": {
            "objectInstances": len(instance_records),
            "realObjects": sum(not item["isInstance"] for item in instance_records),
            "instances": sum(item["isInstance"] for item in instance_records),
            "byType": _counter(item["type"] for item in instance_records),
            "instancesByType": _counter(
                item["type"] for item in instance_records if item["isInstance"]
            ),
            "instanceParents": _counter(
                item["parent"] for item in instance_records if item["isInstance"]
            ),
            "instanceObjects": _counter(
                item["object"] for item in instance_records if item["isInstance"]
            ),
        },
        "geometry": {
            "modifierTypes": _counter(item["type"] for item in modifiers),
            "modifiers": modifiers,
            "curves": [
                _curve_record(obj, depsgraph)
                for obj in objects
                if obj.type == "CURVE"
            ],
            "hairCurves": sorted(
                obj.name for obj in objects if obj.type == "CURVES"
            ),
            "particleSystems": [
                {
                    "object": obj.name,
                    "name": system.name,
                    "type": system.settings.type,
                    "renderType": system.settings.render_type,
                    "count": system.settings.count,
                }
                for obj in objects
                for system in obj.particle_systems
            ],
        },
        "materials": {
            "total": len(bpy.data.materials),
            "usedByRenderVisible": len(used_by),
            "nodeTypes": _counter(
                node.bl_idname
                for material in bpy.data.materials
                if material.use_nodes and material.node_tree
                for node in material.node_tree.nodes
            ),
            "records": [
                _material_record(material, used_by.get(material.name, []))
                for material in bpy.data.materials
            ],
        },
        "assets": {
            "images": [_image_record(image) for image in bpy.data.images],
            "libraries": [
                {
                    "path": bpy.path.abspath(library.filepath),
                    "exists": Path(bpy.path.abspath(library.filepath)).exists(),
                }
                for library in bpy.data.libraries
            ],
            "fonts": [
                {
                    "name": font.name,
                    "filepath": bpy.path.abspath(font.filepath),
                    "packed": font.packed_file is not None,
                }
                for font in bpy.data.fonts
            ],
        },
        "lighting": {
            "lights": [
                {
                    "object": obj.name,
                    "data": obj.data.name,
                    "type": obj.data.type,
                    "energy": obj.data.energy,
                    "color": list(obj.data.color),
                    "angle": getattr(obj.data, "angle", None),
                    "useShadow": obj.data.use_shadow,
                    "hideRender": obj.hide_render,
                }
                for obj in objects
                if obj.type == "LIGHT"
            ],
            "world": (
                {
                    "name": scene.world.name,
                    "useNodes": scene.world.use_nodes,
                    "nodeTypes": _counter(node.bl_idname for node in world_nodes),
                    "customProperties": _custom_properties(scene.world),
                }
                if scene.world
                else None
            ),
        },
        "animation": {
            "actions": [
                {
                    "name": action.name,
                    "users": action.users,
                    "frameRange": list(action.frame_range),
                    "slots": len(getattr(action, "slots", ())),
                    "fcurves": len(getattr(action, "fcurves", ())),
                }
                for action in bpy.data.actions
            ],
            "owners": animation_owners,
            "armatures": [
                _armature_record(obj) for obj in objects if obj.type == "ARMATURE"
            ],
            "driverCount": sum(
                len(owner["drivers"]) for owner in animation_owners
            ),
        },
        "authoredIntent": {
            "blendlinkRecipe": "blendlink_recipe" in scene,
            "blendlinkProperties": [
                record
                for record in custom_property_owners
                if any(
                    key.startswith("blendlink_")
                    for key in record["properties"]
                )
            ],
            "allCustomPropertyOwners": custom_property_owners,
        },
        "license": {
            "textBlocks": _license_texts(),
            "fileCopyright": scene.get("copyright"),
        },
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", "utf8")
    summary = {
        "output": output.as_posix(),
        "source": report["source"],
        "scene": report["scene"],
        "objects": report["objects"]["byType"],
        "renderVisible": report["objects"]["renderVisibleByType"],
        "evaluated": {
            key: report["evaluated"][key]
            for key in ("objectInstances", "realObjects", "instances", "instancesByType")
        },
        "materials": {
            "total": report["materials"]["total"],
            "usedByRenderVisible": report["materials"]["usedByRenderVisible"],
        },
        "images": {
            "total": len(report["assets"]["images"]),
            "packed": sum(item["packed"] for item in report["assets"]["images"]),
        },
        "animation": {
            "actions": len(report["animation"]["actions"]),
            "armatures": len(report["animation"]["armatures"]),
            "drivers": report["animation"]["driverCount"],
        },
        "licenseTextBlocks": len(report["license"]["textBlocks"]),
    }
    print(SENTINEL + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
