"""PROTOTYPE: render an exact source-object visibility inventory.

Invoked by run.mjs inside Blender. The source .blend is opened by Blender
before this script runs. No source datablock is saved.
"""

from __future__ import annotations

import json
import importlib.util
import math
import pathlib
import sys

import bpy
import numpy as np
import OpenImageIO as oiio
from mathutils import Vector


def _args_after_separator() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def _collection_paths(collection: bpy.types.Collection) -> list[list[str]]:
    paths: list[list[str]] = []

    def visit(current: bpy.types.Collection, suffix: list[str], seen: set[int]) -> None:
        pointer = current.as_pointer()
        if pointer in seen:
            return
        parents = [
            candidate
            for candidate in bpy.data.collections
            if current in candidate.children[:]
        ]
        if current == bpy.context.scene.collection or not parents:
            paths.append([current.name, *suffix])
            return
        next_seen = {*seen, pointer}
        for parent in parents:
            visit(parent, [current.name, *suffix], next_seen)

    visit(collection, [], set())
    return paths


def _layer_collection_paths(
    root: bpy.types.LayerCollection,
) -> dict[int, list[dict[str, object]]]:
    result: dict[int, list[dict[str, object]]] = {}

    def visit(node: bpy.types.LayerCollection, path: list[str], blocked: bool) -> None:
        node_path = [*path, node.name]
        node_blocked = blocked or bool(node.exclude)
        result.setdefault(node.collection.as_pointer(), []).append(
            {
                "path": node_path,
                "excluded": node_blocked,
                "hideViewport": bool(node.hide_viewport),
                "holdout": bool(node.holdout),
                "indirectOnly": bool(node.indirect_only),
            }
        )
        for child in node.children:
            visit(child, node_path, node_blocked)

    visit(root, [], False)
    return result


def _render_participates(
    obj: bpy.types.Object,
    layer_paths: dict[int, list[dict[str, object]]],
) -> bool:
    if obj.hide_render:
        return False
    for collection in obj.users_collection:
        if collection.hide_render:
            continue
        paths = layer_paths.get(collection.as_pointer(), [])
        if any(not bool(path["excluded"]) for path in paths):
            return True
    return False


def _world_bounds(obj: bpy.types.Object) -> list[list[float]]:
    return [
        [float(value) for value in obj.matrix_world @ Vector(corner)]
        for corner in obj.bound_box
    ]


def _object_id_color(object_index: int) -> tuple[float, float, float, float]:
    if object_index <= 0 or object_index >= 1000:
        raise RuntimeError(f"Unsupported prototype object index {object_index}")
    return (
        ((object_index % 10) + 1) / 11.0,
        (((object_index // 10) % 10) + 1) / 11.0,
        (((object_index // 100) % 10) + 1) / 11.0,
        1.0,
    )


def _render_object_id_pass(
    source_scene: bpy.types.Scene,
    indexed_objects: list[tuple[int, bpy.types.Object]],
    output_png: pathlib.Path,
    width: int,
    height: int,
) -> tuple[np.ndarray, str]:
    control_script = (
        pathlib.Path(__file__).resolve().parents[1]
        / "splash-visual-fidelity-differential"
        / "render-source-controls.py"
    )
    spec = importlib.util.spec_from_file_location(
        "blendlink_splash_source_controls",
        control_script,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import source-control helper {control_script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    scene, _copy_report = module.create_control_scene(source_scene)
    view_layer = bpy.context.view_layer
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_png)
    scene.render.film_transparent = False

    original_meshes: dict[str, bpy.types.Mesh] = {}
    private_meshes: list[bpy.types.Mesh] = []
    id_materials: list[bpy.types.Material] = []
    for object_index, obj in indexed_objects:
        original_meshes[obj.name] = obj.data
        private_mesh = obj.data.copy()
        private_meshes.append(private_mesh)
        obj.data = private_mesh
        private_mesh.materials.clear()
        material = bpy.data.materials.new(
            f"Blendlink Object ID {object_index:03d}"
        )
        id_materials.append(material)
        material.use_nodes = True
        material.node_tree.nodes.clear()
        output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
        emission = material.node_tree.nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = _object_id_color(object_index)
        emission.inputs["Strength"].default_value = 1.0
        material.node_tree.links.new(
            emission.outputs["Emission"],
            output.inputs["Surface"],
        )
        private_mesh.materials.append(material)
        for polygon in private_mesh.polygons:
            polygon.material_index = 0

    compositor = scene.compositing_node_group
    if compositor is None:
        raise RuntimeError(
            "Source-control scene has no compositor group for IndexOB extraction"
        )
    render_layer_node = compositor.nodes.new("CompositorNodeRLayers")
    render_layer_node.scene = scene
    render_layer_node.layer = view_layer.name
    image_output = render_layer_node.outputs.get("Image")
    if image_output is None:
        raise RuntimeError(
            "Render Layers node exposes no Image output; "
            f"available={[output.name for output in render_layer_node.outputs]}"
        )
    file_output = compositor.nodes.new("CompositorNodeOutputFile")
    if hasattr(file_output, "base_path"):
        file_output.base_path = str(output_png.parent)
        file_output.file_slots[0].path = f"{output_png.stem}-id-"
        file_input = file_output.inputs[0]
        file_format = file_output.format
    else:
        file_output.directory = str(output_png.parent)
        file_output.file_name = f"{output_png.stem}-id-####"
        file_item = file_output.file_output_items.new("RGBA", "Image")
        file_item.override_node_format = True
        file_input = file_output.inputs["Image"]
        file_format = file_item.format
    file_format.file_format = "OPEN_EXR"
    file_format.color_mode = "RGB"
    file_format.color_depth = "32"
    compositor.links.new(image_output, file_input)

    try:
        bpy.ops.render.render(write_still=True)
    finally:
        for _object_index, obj in indexed_objects:
            obj.data = original_meshes[obj.name]
        for private_mesh in private_meshes:
            bpy.data.meshes.remove(private_mesh)
        for material in id_materials:
            bpy.data.materials.remove(material)

    id_path = output_png.parent / (
        f"{output_png.stem}-id-{scene.frame_current:04d}.exr"
    )
    if not id_path.is_file():
        matches = sorted(output_png.parent.glob(f"{output_png.stem}-id-*.exr"))
        if len(matches) == 1:
            id_path = matches[0]
        else:
            raise RuntimeError(
                f"Compositor did not write one object-ID file; expected "
                f"{id_path}; matches={matches}"
            )
    if not id_path.is_file():
        raise RuntimeError(
            f"Compositor did not write object-ID file {id_path}"
        )
    id_buffer = oiio.ImageBuf(str(id_path))
    id_spec = id_buffer.spec()
    if (
        id_spec.width != width
        or id_spec.height != height
        or id_spec.nchannels < 3
    ):
        raise RuntimeError(
            "Unexpected object-ID image shape "
            f"{id_spec.width}x{id_spec.height}x{id_spec.nchannels}"
        )
    id_values = id_buffer.get_pixels(oiio.FLOAT)[:, :, :3]

    scaled = id_values * 11.0 - 1.0
    digits = np.rint(scaled).astype(np.int32)
    close_to_code = np.max(np.abs(scaled - digits), axis=2) <= 1e-2
    valid_digits = np.all((digits >= 0) & (digits <= 9), axis=2)
    decoded = (
        digits[:, :, 0]
        + 10 * digits[:, :, 1]
        + 100 * digits[:, :, 2]
    )
    decoded[~(close_to_code & valid_digits)] = 0
    return decoded, view_layer.name


def main() -> None:
    args = _args_after_separator()
    if len(args) != 2:
        raise RuntimeError(
            "Expected output JSON and preview PNG after '--'; "
            f"received {args!r}"
        )
    output_json = pathlib.Path(args[0]).resolve()
    output_png = pathlib.Path(args[1]).resolve()
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_png.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    width = 1200
    height = 600
    layer_paths = _layer_collection_paths(view_layer.layer_collection)

    objects = sorted(
        (obj for obj in scene.objects if obj.type == "MESH"),
        key=lambda obj: obj.name,
    )
    if len(objects) >= 32767:
        raise RuntimeError("IndexOB prototype only supports fewer than 32767 meshes")

    index_to_name: dict[int, str] = {}
    indexed_objects = []
    for index, obj in enumerate(objects, start=1):
        index_to_name[index] = obj.name
        indexed_objects.append((index, obj))
    decoded_ids, result_layer_name = _render_object_id_pass(
        scene,
        indexed_objects,
        output_png,
        width,
        height,
    )

    pixel_evidence: dict[str, dict[str, object]] = {}
    for object_index, object_name in index_to_name.items():
        ys, xs = np.where(decoded_ids == object_index)
        if len(xs) == 0:
            pixel_evidence[object_name] = {
                "rawObjectIdMatchedPixels": 0,
                "rawObjectIdBboxTopLeft": None,
            }
            continue
        top_ys = ys
        pixel_evidence[object_name] = {
            "rawObjectIdMatchedPixels": int(len(xs)),
            "rawObjectIdBboxTopLeft": [
                int(xs.min()),
                int(top_ys.min()),
                int(xs.max()),
                int(top_ys.max()),
            ],
        }

    depsgraph = bpy.context.evaluated_depsgraph_get()
    emitted_instances: dict[str, dict[str, object]] = {}
    for occurrence in depsgraph.object_instances:
        if not occurrence.is_instance or occurrence.parent is None:
            continue
        owner_name = occurrence.parent.original.name
        owner = emitted_instances.setdefault(
            owner_name,
            {
                "count": 0,
                "sourceNames": set(),
            },
        )
        owner["count"] = int(owner["count"]) + 1
        owner["sourceNames"].add(occurrence.object.original.name)

    records = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = None
        evaluated_vertices = None
        evaluated_polygons = None
        try:
            mesh = evaluated.to_mesh()
            if mesh is not None:
                evaluated_vertices = len(mesh.vertices)
                evaluated_polygons = len(mesh.polygons)
        finally:
            if mesh is not None:
                evaluated.to_mesh_clear()
        object_id_reliable = bool(evaluated_polygons and evaluated_polygons > 0)
        raw_pixel_evidence = pixel_evidence[obj.name]
        visible_pixels = (
            int(raw_pixel_evidence["rawObjectIdMatchedPixels"])
            if object_id_reliable
            else 0
        )
        visible_bbox = (
            raw_pixel_evidence["rawObjectIdBboxTopLeft"]
            if object_id_reliable
            else None
        )
        emitted = emitted_instances.get(
            obj.name,
            {
                "count": 0,
                "sourceNames": set(),
            },
        )

        memberships = []
        for collection in obj.users_collection:
            memberships.append(
                {
                    "collection": collection.name,
                    "collectionHideRender": bool(collection.hide_render),
                    "collectionPaths": _collection_paths(collection),
                    "viewLayerPaths": layer_paths.get(
                        collection.as_pointer(),
                        [],
                    ),
                }
            )

        records.append(
            {
                "name": obj.name,
                "dataName": obj.data.name if obj.data else None,
                "hideRender": bool(obj.hide_render),
                "hideViewport": bool(obj.hide_viewport),
                "hideGet": bool(obj.hide_get(view_layer=view_layer)),
                "visibleGet": bool(obj.visible_get(view_layer=view_layer)),
                "renderParticipates": _render_participates(obj, layer_paths),
                "memberships": memberships,
                "materials": [
                    slot.material.name if slot.material else None
                    for slot in obj.material_slots
                ],
                "modifiers": [
                    {
                        "name": modifier.name,
                        "type": modifier.type,
                        "showRender": bool(modifier.show_render),
                    }
                    for modifier in obj.modifiers
                ],
                "parent": obj.parent.name if obj.parent else None,
                "instanceType": obj.instance_type,
                "location": [float(value) for value in obj.location],
                "dimensions": [float(value) for value in obj.dimensions],
                "worldBounds": _world_bounds(obj),
                "evaluatedVertices": evaluated_vertices,
                "evaluatedPolygons": evaluated_polygons,
                "emittedInstanceCount": int(emitted["count"]),
                "emittedInstanceSourceNames": sorted(emitted["sourceNames"]),
                "objectIdReliable": object_id_reliable,
                "visiblePixels": visible_pixels,
                "bboxTopLeft": visible_bbox,
                **raw_pixel_evidence,
            }
        )

    evidence = {
        "prototype": "splash-object-completeness-v1",
        "sourceBlend": bpy.data.filepath,
        "blenderVersion": bpy.app.version_string,
        "blenderBuildHash": bpy.app.build_hash.decode(
            "utf-8",
            errors="replace",
        ),
        "scene": scene.name,
        "viewLayer": view_layer.name,
        "resultLayer": result_layer_name,
        "camera": scene.camera.name if scene.camera else None,
        "resolution": [width, height],
        "meshObjectCount": len(records),
        "renderParticipatingMeshCount": sum(
            1 for record in records if record["renderParticipates"]
        ),
        "pixelVisibleMeshCount": sum(
            1 for record in records if int(record["visiblePixels"]) > 0
        ),
        "geometryNodesEmitterCount": sum(
            1 for record in records
            if int(record["emittedInstanceCount"]) > 0
        ),
        "unassignedPixelCount": int(np.count_nonzero(decoded_ids == 0)),
        "objects": records,
    }
    output_json.write_text(
        json.dumps(evidence, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(
        "BLENDLINK_SPLASH_OBJECT_INVENTORY "
        f"objects={len(records)} "
        f"renderParticipating={evidence['renderParticipatingMeshCount']} "
        f"pixelVisible={evidence['pixelVisibleMeshCount']} "
        f"output={output_json}"
    )


if __name__ == "__main__":
    main()
