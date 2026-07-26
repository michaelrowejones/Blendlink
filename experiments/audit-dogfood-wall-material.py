"""Read-only material-coordinate audit for the dogfood Wall bake."""

from __future__ import annotations

import bpy


def walk(tree, prefix="", seen=None):
    seen = seen or set()
    if tree is None or tree.as_pointer() in seen:
        return
    seen.add(tree.as_pointer())
    for node in tree.nodes:
        if node.type in {
            "TEX_COORD", "MAPPING", "TEX_NOISE", "TEX_VORONOI", "TEX_MUSGRAVE",
            "FRESNEL", "LAYER_WEIGHT", "GEOMETRY", "UVMAP", "TEX_IMAGE",
        }:
            details = []
            if node.type == "TEX_COORD":
                details.append(f"object={getattr(node.object, 'name', None)}")
            if node.type == "UVMAP":
                details.append(f"uv_map={node.uv_map}")
            vector = node.inputs.get("Vector")
            if vector is not None:
                if vector.links:
                    link = vector.links[0]
                    details.append(
                        f"vector={link.from_node.name}.{link.from_socket.name}"
                    )
                else:
                    details.append("vector=<implicit-generated>")
            print(
                "DOGFOOD_WALL_NODE",
                f"path={prefix}{node.name}", f"type={node.type}", *details,
            )
        if node.type == "GROUP" and node.node_tree is not None:
            walk(node.node_tree, prefix=f"{prefix}{node.name}/", seen=seen)
    for link in tree.links:
        if link.from_node.type == "TEX_COORD":
            print(
                "DOGFOOD_WALL_COORD_LINK",
                f"path={prefix}{link.from_node.name}",
                f"output={link.from_socket.name}",
                f"to={link.to_node.name}.{link.to_socket.name}",
            )


wall = bpy.data.objects["Wall"]
print("DOGFOOD_WALL_BOUNDS", *(tuple(corner) for corner in wall.bound_box))
for slot in wall.material_slots:
    material = slot.material
    print("DOGFOOD_WALL_MATERIAL", material.name if material else "<none>")
    if material and material.use_nodes:
        walk(material.node_tree)
