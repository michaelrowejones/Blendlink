# SPDX-License-Identifier: MIT
"""Inspect a failed private selected-field UV transaction in a real .blend.

Run Blender with the target .blend and pass:

  -- <bakelib directory> <object name> <material slot> <purpose>

This is a diagnostic prototype, not part of the Blendlink package. It keeps
the source Mesh untouched, runs the canonical private preparation on a copy,
and reports the exact positive-area triangle pairs behind any self-overlap.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


def _arguments():
    marker = sys.argv.index("--")
    values = sys.argv[marker + 1:]
    if len(values) != 4:
        raise RuntimeError(
            "expected: <bakelib directory> <object name> <slot> <purpose>"
        )
    return Path(values[0]), values[1], int(values[2]), values[3]


def _positive_overlap_pairs(bakelib, obj, uv_name: str, limit: int = 5):
    mesh = obj.data
    layer = mesh.uv_layers[uv_name]
    roots, display_numbers = bakelib._uv_polygon_islands(mesh, layer)
    zero_geometry = set(bakelib._zero_geometry_triangle_indices(obj))
    mesh.calc_loop_triangles()
    by_island = {}
    for triangle in mesh.loop_triangles:
        if triangle.index in zero_geometry:
            continue
        points = tuple(tuple(layer.data[index].uv) for index in triangle.loops)
        if abs(bakelib._signed_polygon_area(points)) <= bakelib._UV_OVERLAP_AREA_EPSILON:
            continue
        island = display_numbers[roots[triangle.polygon_index]]
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        by_island.setdefault(island, []).append({
            "triangle": triangle.index,
            "polygon": triangle.polygon_index,
            "points": points,
            "min_x": min(xs),
            "max_x": max(xs),
            "min_y": min(ys),
            "max_y": max(ys),
        })

    overlaps = []
    island_sizes = {}
    for island, triangles in sorted(by_island.items()):
        island_sizes[island] = len(triangles)
        ordered = sorted(
            triangles,
            key=lambda item: (item["min_x"], item["min_y"], item["triangle"]),
        )
        active = []
        for triangle in ordered:
            active = [
                candidate
                for candidate in active
                if candidate["max_x"] > triangle["min_x"]
            ]
            for candidate in active:
                if not bakelib._bounds_positive_overlap(triangle, candidate):
                    continue
                area = bakelib._triangle_intersection_area(
                    triangle["points"], candidate["points"],
                )
                if area <= bakelib._UV_OVERLAP_AREA_EPSILON:
                    continue
                overlaps.append({
                    "island": island,
                    "leftTriangle": candidate["triangle"],
                    "rightTriangle": triangle["triangle"],
                    "leftPolygon": candidate["polygon"],
                    "rightPolygon": triangle["polygon"],
                    "leftArea": abs(
                        bakelib._signed_polygon_area(candidate["points"])
                    ),
                    "rightArea": abs(
                        bakelib._signed_polygon_area(triangle["points"])
                    ),
                    "intersectionArea": area,
                    "leftPoints": candidate["points"],
                    "rightPoints": triangle["points"],
                })
                if len(overlaps) >= limit:
                    return island_sizes, overlaps
            active.append(triangle)
    return island_sizes, overlaps


def main():
    module_dir, object_name, slot_index, purpose = _arguments()
    sys.path.insert(0, str(module_dir))
    import bakelib

    source = bpy.data.objects.get(object_name)
    if source is None or source.type != "MESH":
        raise RuntimeError(f"missing Mesh object {object_name!r}")

    source_mesh = source.data
    private_mesh = source_mesh.copy()
    private_mesh.name = "BLENDLINK_UV_DIAGNOSTIC"
    source.data = private_mesh
    try:
        plan = bakelib.plan_material_texture_resolution(
            source, slot_index, purpose=purpose,
        )
        failure = None
        result = None
        try:
            result = bakelib.prepare_material_texture_uv(source, plan)
        except BaseException as error:
            failure = f"{type(error).__name__}: {error}"
        layers = [
            layer.name
            for layer in private_mesh.uv_layers
            if layer.name.startswith(bakelib.MATERIAL_ATLAS_UV)
        ]
        if not layers:
            raise RuntimeError("private preparation left no diagnostic UV layer")
        uv_name = layers[-1]
        complete_mask = {
            source.name: [True for _loop in private_mesh.uv_layers[uv_name].data],
        }
        issues = bakelib.pinned_uv_layout_issues(
            [source],
            uv_name,
            complete_mask,
            minimum_gutter=0.0,
        )
        island_sizes, overlaps = _positive_overlap_pairs(
            bakelib, source, uv_name,
        )
        print("BLENDLINK_UV_DIAGNOSTIC " + json.dumps({
            "failure": failure,
            "plan": plan,
            "result": result,
            "uvName": uv_name,
            "issues": issues,
            "islandTriangleCounts": island_sizes,
            "positiveOverlapPairs": overlaps,
        }, sort_keys=True))
    finally:
        source.data = source_mesh
        bpy.data.meshes.remove(private_mesh)


if __name__ == "__main__":
    main()
