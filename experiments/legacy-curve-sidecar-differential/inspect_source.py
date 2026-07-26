"""Print the properties that distinguish the Blender 3.6 legacy Curve blockers."""

import json

import bpy


NAMES = (
    "GEO-electrical_wire.blue",
    "GEO-electrical_wire.blue.001",
    "GEO-electrical_wire.brown.001",
    "GEO-electrical_wire.red",
    "GEO-electrical_wire.red.001",
)

depsgraph = bpy.context.evaluated_depsgraph_get()
records = []
for name in NAMES:
    obj = bpy.data.objects[name]
    curve = obj.data
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    records.append({
        "name": name,
        "objectLibrary": obj.library.filepath if obj.library else None,
        "dataLibrary": curve.library.filepath if curve.library else None,
        "dimensions": curve.dimensions,
        "bevelMode": curve.bevel_mode,
        "bevelDepth": curve.bevel_depth,
        "bevelObject": curve.bevel_object.name if curve.bevel_object else None,
        "taperObject": curve.taper_object.name if curve.taper_object else None,
        "extrude": curve.extrude,
        "fillMode": curve.fill_mode,
        "resolutionU": curve.resolution_u,
        "splines": [
            {
                "type": spline.type,
                "points": len(spline.points),
                "cyclic": spline.use_cyclic_u,
                "resolutionU": spline.resolution_u,
                "radii": [point.radius for point in spline.points],
            }
            for spline in curve.splines
        ],
        "modifiers": [
            {
                "name": modifier.name,
                "type": modifier.type,
                "showRender": modifier.show_render,
                "showViewport": modifier.show_viewport,
            }
            for modifier in obj.modifiers
        ],
        "meshVertices": None if mesh is None else len(mesh.vertices),
    })
    if mesh is not None:
        evaluated.to_mesh_clear()

print("##LEGACY_CURVES " + json.dumps(records, sort_keys=True))
