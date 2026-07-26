"""Read-only inventory of the selected Splash sky material and receiver."""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys

import bpy
from mathutils import Vector


SOURCE = pathlib.Path(
    sys.argv[sys.argv.index("--") + 1]
    if "--" in sys.argv
    else "artifacts/release-dogfood/blender-4-splash/fixtures/"
    "blender-4.0-splash-selected-sky.blend"
).resolve()


def socket_value(socket):
    value = getattr(socket, "default_value", None)
    if hasattr(value, "__len__") and not isinstance(value, str):
        return [float(item) for item in value]
    if isinstance(value, (int, float, bool, str)):
        return value
    return None


def tree_inventory(tree):
    return {
        "name": tree.name,
        "nodes": [
            {
                "name": node.name,
                "label": node.label,
                "type": node.bl_idname,
                "properties": {
                    key: node[key]
                    for key in sorted(node.keys())
                    if key.startswith("blendlink_")
                },
                "inputs": [
                    {
                        "name": socket.name,
                        "identifier": socket.identifier,
                        "default": socket_value(socket),
                    }
                    for socket in node.inputs
                ],
                "outputs": [
                    {
                        "name": socket.name,
                        "identifier": socket.identifier,
                        "default": socket_value(socket),
                    }
                    for socket in node.outputs
                ],
                "sky": (
                    {
                        "skyType": node.sky_type,
                        "sunDirection": list(node.sun_direction),
                        "sunElevation": node.sun_elevation,
                        "sunRotation": node.sun_rotation,
                        "altitude": node.altitude,
                        "airDensity": node.air_density,
                        "dustDensity": node.dust_density,
                        "ozoneDensity": node.ozone_density,
                        "sunDisc": node.sun_disc,
                        "sunSize": node.sun_size,
                        "sunIntensity": node.sun_intensity,
                    }
                    if node.bl_idname == "ShaderNodeTexSky"
                    else None
                ),
                "image": (
                    {
                        "name": node.image.name,
                        "filepath": bpy.path.abspath(node.image.filepath),
                        "source": node.image.source,
                        "colorspace": node.image.colorspace_settings.name,
                        "alphaMode": node.image.alpha_mode,
                        "size": list(node.image.size),
                        "interpolation": node.interpolation,
                        "extension": node.extension,
                    }
                    if getattr(node, "image", None) is not None
                    else None
                ),
                "groupTree": (
                    node.node_tree.name if getattr(node, "node_tree", None) else None
                ),
            }
            for node in tree.nodes
        ],
        "links": [
            {
                "fromNode": link.from_node.name,
                "fromSocket": link.from_socket.name,
                "toNode": link.to_node.name,
                "toSocket": link.to_socket.name,
            }
            for link in tree.links
        ],
    }


source_bytes = SOURCE.read_bytes()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))

material = bpy.data.materials["DP-SkyPaint.MAT"]
obj = bpy.data.objects["DP-SkyPaint.GEO"]
mesh = obj.data
mesh.calc_loop_triangles()

trees = [tree_inventory(material.node_tree)]
seen = {material.node_tree.as_pointer()}
queue = [material.node_tree]
while queue:
    tree = queue.pop(0)
    for node in tree.nodes:
        nested = getattr(node, "node_tree", None)
        if nested is not None and nested.as_pointer() not in seen:
            seen.add(nested.as_pointer())
            trees.append(tree_inventory(nested))
            queue.append(nested)

world_bounds = [obj.matrix_world @ Vector(vector) for vector in obj.bound_box]
result = {
    "blenderVersion": bpy.app.version_string,
    "source": str(SOURCE),
    "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
    "engine": bpy.context.scene.render.engine,
    "viewSettings": {
        "viewTransform": bpy.context.scene.view_settings.view_transform,
        "look": bpy.context.scene.view_settings.look,
        "exposure": bpy.context.scene.view_settings.exposure,
        "gamma": bpy.context.scene.view_settings.gamma,
    },
    "material": {
        "name": material.name,
        "blendMethod": getattr(material, "surface_render_method", None),
        "properties": {key: material[key] for key in sorted(material.keys())},
        "trees": trees,
    },
    "object": {
        "name": obj.name,
        "vertexCount": len(mesh.vertices),
        "polygonCount": len(mesh.polygons),
        "loopTriangleCount": len(mesh.loop_triangles),
        "materialNames": [
            slot.material.name if slot.material else None for slot in obj.material_slots
        ],
        "uvLayers": [
            {"name": layer.name, "activeRender": layer.active_render}
            for layer in mesh.uv_layers
        ],
        "colorAttributes": [
            {
                "name": attribute.name,
                "domain": attribute.domain,
                "dataType": attribute.data_type,
            }
            for attribute in mesh.color_attributes
        ],
        "worldBounds": {
            "min": [
                min(float(point[axis]) for point in world_bounds) for axis in range(3)
            ],
            "max": [
                max(float(point[axis]) for point in world_bounds) for axis in range(3)
            ],
        },
    },
}

print("BLENDLINK_SPLASH_SKY_INVENTORY=" + json.dumps(result, sort_keys=True))
