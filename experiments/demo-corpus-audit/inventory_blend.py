"""Print a read-only capability inventory for the open Blender file.

Run with:
  blender --background --factory-startup scene.blend --python inventory_blend.py
  blender --background --factory-startup scene.blend --python inventory_blend.py \
    -- output/source-inventory.json

The script does not save the source file. Counts describe authored datablocks;
they are an ingest triage signal, not proof that every datablock contributes to
the active render.
"""

from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

import bpy


def counter(items):
    return dict(sorted(Counter(items).items()))


def resolved_path(path, library=None):
    return (
        Path(bpy.path.abspath(path, library=library)).resolve(strict=False)
        if path
        else None
    )


def external_path_record(name, path, library=None):
    resolved = resolved_path(path, library)
    return {
        "name": name,
        "authoredPath": path,
        "owningLibrary": library.name if library else None,
        "resolvedPath": resolved.as_posix() if resolved else None,
        "exists": resolved.is_file() if resolved else False,
    }


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def action_owner_count():
    return sum(
        1
        for item in list(bpy.data.objects)
        + list(bpy.data.materials)
        + list(bpy.data.worlds)
        + list(bpy.data.node_groups)
        if getattr(getattr(item, "animation_data", None), "action", None)
    )


def main():
    source = Path(bpy.data.filepath)
    scene = bpy.context.scene
    objects = list(scene.objects)
    node_trees = [
        material.node_tree
        for material in bpy.data.materials
        if material.use_nodes and material.node_tree
    ]
    node_trees += [
        world.node_tree
        for world in bpy.data.worlds
        if world.use_nodes and world.node_tree
    ]
    node_trees += list(bpy.data.node_groups)
    nodes = [node for tree in node_trees for node in tree.nodes]
    modifiers = [modifier for obj in objects for modifier in obj.modifiers]
    particle_systems = [
        (obj, system)
        for obj in objects
        for system in obj.particle_systems
    ]
    renderable_types = {"MESH", "CURVE", "CURVES", "SURFACE", "META", "FONT", "VOLUME", "GPENCIL", "GREASEPENCIL"}
    renderable = [obj for obj in objects if obj.type in renderable_types and not obj.hide_render]
    lights = [obj.data for obj in objects if obj.type == "LIGHT"]
    images = list(bpy.data.images)
    output = {
        "schemaVersion": 1,
        "source": {
            "path": source.as_posix(),
            "bytes": source.stat().st_size,
            "sha256": sha256_file(source),
        },
        "blender": bpy.app.version_string,
        "scene": {
            "name": scene.name,
            "renderEngine": scene.render.engine,
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "frameCurrent": scene.frame_current,
            "fps": scene.render.fps / scene.render.fps_base,
            "resolution": [scene.render.resolution_x, scene.render.resolution_y],
            "resolutionPercentage": scene.render.resolution_percentage,
            "camera": scene.camera.name if scene.camera else None,
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "compositor": bool(
                getattr(scene, "compositing_node_group", None)
                or getattr(scene, "node_tree", None)
            ),
        },
        "objects": {
            "total": len(objects),
            "byType": counter(obj.type for obj in objects),
            "renderVisibleByType": counter(obj.type for obj in renderable),
            "withShapeKeys": sum(
                1
                for obj in objects
                if getattr(getattr(obj, "data", None), "shape_keys", None)
            ),
            "withConstraints": sum(1 for obj in objects if len(obj.constraints)),
            "collectionInstances": sum(
                1 for obj in objects if obj.instance_type == "COLLECTION"
            ),
        },
        "materials": {
            "total": len(bpy.data.materials),
            "blendMethods": counter(
                getattr(material.surface_render_method, "name", str(material.surface_render_method))
                if hasattr(material, "surface_render_method")
                else getattr(material, "blend_method", "OPAQUE")
                for material in bpy.data.materials
            ),
            "nodeTypes": counter(node.bl_idname for node in nodes),
        },
        "geometry": {
            "modifierTypes": counter(modifier.type for modifier in modifiers),
            "geometryNodeModifiers": sum(1 for modifier in modifiers if modifier.type == "NODES"),
            "particleSystems": len(particle_systems),
            "legacyParticleSystems": [
                {
                    "object": obj.name,
                    "system": system.name,
                    "settings": system.settings.name,
                    "type": system.settings.type,
                    "renderType": system.settings.render_type,
                    "count": system.settings.count,
                    "hairLength": system.settings.hair_length,
                }
                for obj, system in particle_systems
            ],
        },
        "lighting": {
            "byType": counter(light.type for light in lights),
            "worldVolumeLinked": bool(
                scene.world
                and scene.world.use_nodes
                and scene.world.node_tree
                and (output := next(
                    (
                        node
                        for node in scene.world.node_tree.nodes
                        if node.type == "OUTPUT_WORLD" and node.is_active_output
                    ),
                    None,
                ))
                and output.inputs.get("Volume")
                and output.inputs["Volume"].is_linked
            ),
        },
        "animation": {
            "actions": len(bpy.data.actions),
            "actionNames": sorted(action.name for action in bpy.data.actions),
            "actionOwners": action_owner_count(),
            "armatures": sum(1 for obj in objects if obj.type == "ARMATURE"),
            "drivers": sum(
                len(getattr(getattr(item, "animation_data", None), "drivers", ()))
                for item in list(bpy.data.objects)
                + [obj.data for obj in objects if getattr(obj, "data", None)]
                + list(bpy.data.materials)
                + list(bpy.data.node_groups)
            ),
            "driversByOwnerKind": {
                "objects": sum(
                    len(getattr(getattr(obj, "animation_data", None), "drivers", ()))
                    for obj in bpy.data.objects
                ),
                "objectData": sum(
                    len(getattr(getattr(obj.data, "animation_data", None), "drivers", ()))
                    for obj in objects
                    if getattr(obj, "data", None)
                ),
                "materials": sum(
                    len(getattr(getattr(material, "animation_data", None), "drivers", ()))
                    for material in bpy.data.materials
                ),
                "nodeGroups": sum(
                    len(getattr(getattr(group, "animation_data", None), "drivers", ()))
                    for group in bpy.data.node_groups
                ),
            },
        },
        "assets": {
            "images": len(images),
            "packedImages": sum(image.packed_file is not None for image in images),
            "externalFileImages": sum(
                image.source == "FILE" and image.packed_file is None for image in images
            ),
            "libraries": len(bpy.data.libraries),
            "externalImages": [
                external_path_record(image.name, image.filepath, image.library)
                for image in images
                if image.source == "FILE" and image.packed_file is None
            ],
            "linkedLibraries": [
                # Blender normalizes loaded Library.filepath values against
                # the main file even when a nested library originally owned
                # the reference. Passing Library.parent here would double the
                # already-normalized prefix.
                external_path_record(library.name, library.filepath)
                for library in bpy.data.libraries
            ],
            # Content is intentionally not emitted: text blocks often contain
            # executable scripts. Names and sizes are enough to locate a
            # license/readme for deliberate inspection with autoexec disabled.
            "textBlocks": [
                {"name": text.name, "characters": len(text.as_string())}
                for text in bpy.data.texts
            ],
        },
        "blendlinkRecipe": "blendlink_recipe" in scene,
    }
    serialized = json.dumps(output, indent=2, sort_keys=True) + "\n"
    if "--" in sys.argv:
        arguments = sys.argv[sys.argv.index("--") + 1 :]
        if len(arguments) != 1:
            raise SystemExit(
                "inventory_blend.py accepts exactly one optional output JSON path"
            )
        destination = Path(arguments[0]).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(serialized, encoding="utf-8")
        print(f"##blendlink-demo-corpus-output {destination.as_posix()}")
    print("##blendlink-demo-corpus " + json.dumps(output, sort_keys=True))


if __name__ == "__main__":
    main()
