"""Emit a stable, read-only compatibility inventory for the open .blend.

Run with:
  blender --background --factory-startup scene.blend --python scripts/audit-blend-scene.py

The script never saves or mutates the source file. It is intentionally useful
before Blendlink owns a recipe for a third-party scene.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import bpy


SENTINEL = "##blendlink-scene-audit "


def _absolute(path: str) -> str:
    return bpy.path.abspath(path) if path else ""


def _image_record(image) -> dict:
    path = _absolute(image.filepath)
    packed = image.packed_file is not None
    return {
        "name": image.name,
        "source": image.source,
        "packed": packed,
        "path": path,
        "exists": bool(path and os.path.exists(path)),
    }


def _animation_record(owner) -> dict | None:
    animation = getattr(owner, "animation_data", None)
    if animation is None:
        return None
    action = getattr(animation, "action", None)
    drivers = list(getattr(animation, "drivers", ()))
    if action is None and not drivers:
        return None
    return {
        "name": owner.name,
        "action": action.name if action else None,
        "drivers": [
            {
                "path": curve.data_path,
                "expression": curve.driver.expression,
                "variables": [
                    {
                        "name": variable.name,
                        "type": variable.type,
                        "targets": [
                            {
                                "id": target.id.name if target.id else None,
                                "dataPath": target.data_path,
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


def main() -> None:
    scene = bpy.context.scene
    objects = list(scene.objects)
    images = [_image_record(image) for image in bpy.data.images]
    object_types = sorted({obj.type for obj in objects})
    libraries = [
        {
            "path": _absolute(library.filepath),
            "exists": os.path.exists(_absolute(library.filepath)),
        }
        for library in bpy.data.libraries
    ]
    repository = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repository / "packages" / "blendlink" / "blender"))
    sys.path.insert(0, str(repository / "packages" / "blender-addon"))
    import procedural  # pylint: disable=import-outside-toplevel

    diagnostics = procedural.analyze_scene(scene, full=False)["procedural"]
    procedural_routes = {
        route: sum(1 for item in diagnostics if item["route"] == route)
        for route in sorted({item["route"] for item in diagnostics})
    }
    animation_owners = [
        record for owner in (
            list(objects)
            + [obj.data for obj in objects if getattr(obj, "data", None)]
            + list(bpy.data.node_groups)
        )
        if (record := _animation_record(owner)) is not None
    ]
    payload = {
        "file": bpy.data.filepath,
        "blender": bpy.app.version_string,
        "scene": scene.name,
        "renderEngine": scene.render.engine,
        "objects": len(objects),
        "objectTypes": {
            kind: sum(1 for obj in objects if obj.type == kind)
            for kind in object_types
        },
        "collections": len(bpy.data.collections),
        "materials": len(bpy.data.materials),
        "images": len(images),
        "packedImages": sum(1 for image in images if image["packed"]),
        "missingImages": [
            image for image in images
            if image["source"] == "FILE"
            and not image["packed"]
            and not image["exists"]
        ],
        "cameras": [obj.name for obj in objects if obj.type == "CAMERA"],
        "activeCamera": scene.camera.name if scene.camera else None,
        "world": scene.world.name if scene.world else None,
        "worldUsesVolume": bool(
            scene.world
            and getattr(scene.world, "node_tree", None)
            and any(
                node.type == "OUTPUT_WORLD"
                and node.inputs.get("Volume")
                and node.inputs["Volume"].is_linked
                for node in scene.world.node_tree.nodes
            )
        ),
        "libraries": libraries,
        "geometryNodeModifiers": sum(
            1 for obj in objects for modifier in obj.modifiers
            if modifier.type == "NODES"
        ),
        "blendlinkProcedural": {
            "objects": len(diagnostics),
            "routes": procedural_routes,
            "timeDependent": [
                item["object"] for item in diagnostics
                if item["dependencies"]["animated"]
                or item["dependencies"]["animatedNodeGroups"]
                or any(
                    modifier["usesSceneTime"] or modifier["hasSimulation"]
                    for modifier in item["modifiers"]
                )
            ],
            "cameraDependent": [
                item["object"] for item in diagnostics
                if item["dependencies"]["camera"]
            ],
            "currentFrameBlocking": [
                {"object": item["object"], "route": item["route"], "reason": item["reason"]}
                for item in diagnostics if item["blocking"]
            ],
        },
        "armatures": sum(1 for obj in objects if obj.type == "ARMATURE"),
        "actions": len(bpy.data.actions),
        "animationOwners": animation_owners,
        "compositorNodes": bool(
            getattr(scene, "compositing_node_group", None)
            or getattr(scene, "node_tree", None)
        ),
        "blendlinkRecipe": "blendlink_recipe" in scene,
    }
    print(SENTINEL + json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()
