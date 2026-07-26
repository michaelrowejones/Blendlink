"""Report source structure for Cube receivers with divergent evaluated UVs."""

import json

import bpy


NAMES = [
    "Beam2", "Beam2.001", "Beam3", "Beam4", "Beam5", "Bench",
    "Cube.003", "Cube.004", "Cube.006", "Cube.007", "Cube.008", "Desk",
    "Dresser", "Shelf", "Window Board", "Wooden_Chair",
    "Computer", "Bird Cage", "Potted Plant - Bracken",
]


def modifier_record(modifier):
    record = {
        "name": modifier.name,
        "type": modifier.type,
        "showRender": modifier.show_render,
        "showViewport": modifier.show_viewport,
    }
    for key in (
        "levels", "render_levels", "width", "segments", "thickness",
        "offset", "use_even_offset", "use_quality_normals", "uv_smooth",
    ):
        if hasattr(modifier, key):
            value = getattr(modifier, key)
            record[key] = value if isinstance(value, (str, int, float, bool)) else str(value)
    node_group = getattr(modifier, "node_group", None)
    if node_group is not None:
        record["nodeGroup"] = node_group.name
    return record


records = []
for name in NAMES:
    obj = bpy.data.objects.get(name)
    if obj is None:
        records.append({"name": name, "missing": True})
        continue
    mesh = obj.data
    records.append({
        "name": name,
        "mesh": mesh.name,
        "vertices": len(mesh.vertices),
        "loops": len(mesh.loops),
        "polygons": len(mesh.polygons),
        "uvLayers": [
            {
                "name": layer.name,
                "activeRender": layer.active_render,
                "activeClone": layer.active_clone,
            }
            for layer in mesh.uv_layers
        ],
        "modifiers": [modifier_record(modifier) for modifier in obj.modifiers],
    })

print("BLENDLINK_EVALUATED_UV_OBJECTS " + json.dumps(records, sort_keys=True))
