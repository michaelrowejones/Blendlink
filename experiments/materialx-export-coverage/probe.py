"""Measure what Blender's built-in MaterialX shader export actually preserves.

Blender can emit a MaterialX shader network through its USD exporter
(``generate_materialx_network``). three.js can load MaterialX through
``MaterialXLoader``. That pairing looks like a ready-made high-fidelity
material transport, so this probe measures whether it actually is one.

The probe is read-only with respect to the source ``.blend``: it opens the
file, inventories the shader node types used by render-visible meshes, exports
a USD/MaterialX network to a scratch directory, and reports which authored
node families reached the output.

Usage::

    blender --background --factory-startup <source.blend> \
        --python experiments/materialx-export-coverage/probe.py -- <out-dir>

Every reported line is prefixed ``PROBE::`` so it survives Blender's ordinary
stdout noise.
"""

import collections
import os
import re
import sys

import bpy

# MaterialX node-definition prefixes for the authored families that matter to a
# fidelity claim. Absence of every entry in a group means the family was lost.
TRACKED_FAMILIES = {
    "image texture": ("ND_image", "ND_tiledimage"),
    "vertex color / geometry property": ("geompropvalue",),
    "color ramp": ("ND_ramp", "ND_ramplr", "ND_ramptb"),
    "voronoi / cell noise": ("ND_worleynoise", "ND_cellnoise"),
    "uv placement": ("ND_place2d", "ND_texcoord"),
    "ambient occlusion": ("ND_ambientocclusion",),
    "fresnel": ("ND_fresnel",),
    "normal": ("ND_normal", "ND_normalmap"),
}


def emit(*parts):
    print("PROBE::" + " ".join(str(part) for part in parts))


def out_dir():
    if "--" in sys.argv:
        tail = sys.argv[sys.argv.index("--") + 1:]
        if tail:
            return tail[0]
    raise SystemExit("probe.py requires an output directory after `--`")


def used_materials():
    """Materials bound to render-visible meshes, matching export intent."""
    names = set()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        for slot in obj.material_slots:
            if slot.material is not None:
                names.add(slot.material.name)
    return names


def authored_node_census(material_names):
    """Count every shader node type reachable from the used materials."""
    census = collections.Counter()

    def walk(tree, seen):
        if tree is None or tree.as_pointer() in seen:
            return
        seen.add(tree.as_pointer())
        for node in tree.nodes:
            census[node.bl_idname] += 1
            walk(getattr(node, "node_tree", None), seen)

    for name in material_names:
        material = bpy.data.materials.get(name)
        if material is not None and material.use_nodes:
            walk(material.node_tree, set())
    return census


def main():
    destination = out_dir()
    os.makedirs(destination, exist_ok=True)

    emit("BLENDER", bpy.app.version_string)
    emit("SOURCE", bpy.data.filepath)

    materials = used_materials()
    census = authored_node_census(materials)
    emit("USED_MATERIALS", len(materials))
    emit("DISTINCT_NODE_TYPES", len(census))
    for node_id, count in census.most_common():
        emit("AUTHORED", node_id, count)

    # ASCII USD so the emitted network can be inspected textually.
    usda = os.path.join(destination, "materialx-probe.usda")
    bpy.ops.wm.usd_export(
        filepath=usda,
        export_materials=True,
        generate_materialx_network=True,
    )
    emit("EXPORT_BYTES", os.path.getsize(usda))

    with open(usda, "r", encoding="utf-8", errors="replace") as handle:
        document = handle.read()

    emitted = collections.Counter(re.findall(r'info:id\s*=\s*"([^"]+)"', document))
    emit("MATERIAL_PRIMS", len(re.findall(r"\bdef Material\b", document)))
    emit("NODEGRAPH_PRIMS", len(re.findall(r"\bdef NodeGraph\b", document)))
    for node_id, count in emitted.most_common():
        emit("EMITTED", node_id, count)

    for family, prefixes in TRACKED_FAMILIES.items():
        hits = sum(document.count(prefix) for prefix in prefixes)
        emit("FAMILY", family.replace(" ", "_"), hits)


if __name__ == "__main__":
    main()
