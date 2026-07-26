"""Differential check: ordinary subpixel topology must not be regularized.

Run with Blender 5.2:

    blender --background --factory-startup --python-exit-code 1 \
      --python experiments/ordinary-subpixel-precision-rescue-check.py

This is intentionally a standalone experiment rather than a release gate.
It exercises the real pack transaction on a well-conditioned 32x32 grid at a
16px delivery resolution. Many ordinary triangles have no delivery texel
center, but none are close to float32 collinearity, so the narrow precision
rescue must leave them alone.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import bpy


ROOT = Path(__file__).resolve().parents[1]
BAKELIB_PATH = ROOT / "packages" / "blendlink" / "blender" / "bakelib.py"
SPEC = importlib.util.spec_from_file_location(
    "blendlink_ordinary_subpixel_experiment_bakelib",
    BAKELIB_PATH,
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load canonical bakelib from {BAKELIB_PATH}")
bakelib = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = bakelib
SPEC.loader.exec_module(bakelib)


def main() -> None:
    divisions = 32
    vertices = [
        (column / divisions, row / divisions, 0.0)
        for row in range(divisions + 1)
        for column in range(divisions + 1)
    ]
    faces = []
    for row in range(divisions):
        for column in range(divisions):
            lower_left = row * (divisions + 1) + column
            lower_right = lower_left + 1
            upper_left = lower_left + divisions + 1
            upper_right = upper_left + 1
            faces.append((
                lower_left,
                lower_right,
                upper_right,
                upper_left,
            ))

    mesh = bpy.data.meshes.new("__Blendlink Ordinary Subpixel Grid Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(
        "__Blendlink Ordinary Subpixel Grid",
        mesh,
    )
    bpy.context.scene.collection.objects.link(obj)
    layer = mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = (vertex.x, vertex.y)
    mesh.uv_layers.active = layer
    mesh.update()

    held = bakelib.average_unpinned([obj], bakelib.ATLAS_UV)
    reports, final_held = bakelib.pack_with_evaluated_uv_repair(
        [obj],
        bakelib.ATLAS_UV,
        lambda _obj: 1.0,
        2,
        128,
        held=held,
        pin=True,
        delivery_size=16,
    )

    mesh.calc_loop_triangles()
    world_linear = obj.matrix_world.to_3x3()
    qualities = [
        bakelib._triangle_geometry_quality(mesh, triangle, world_linear)
        for triangle in mesh.loop_triangles
    ]
    packed_layer = mesh.uv_layers.get(bakelib.ATLAS_UV)
    missing_centers = [
        triangle.index
        for triangle in mesh.loop_triangles
        if not bakelib._uv_triangle_has_texel_center(
            [
                tuple(packed_layer.data[index].uv)
                for index in triangle.loops
            ],
            16,
        )
    ]
    precision_candidates = (
        bakelib._precision_sliver_unsampleable_uv_triangles(
            obj,
            bakelib.ATLAS_UV,
            16,
        )
    )
    evidence = {
        "deliverySize": 16,
        "gridDivisions": divisions,
        "triangleCount": len(mesh.loop_triangles),
        "trianglesWithoutDeliveryCenter": len(missing_centers),
        "minimumGeometryQuality": min(qualities),
        "precisionRescueCeiling": (
            bakelib._FLOAT32_UV_SAMPLEABILITY_RESCUE_CEILING
        ),
        "precisionCandidateCount": len(precision_candidates),
        "repairReportCount": len(reports),
        "heldReceiverCount": len(final_held),
    }
    if not missing_centers:
        raise AssertionError(
            "fixture drift: every ordinary grid triangle gained a delivery "
            f"texel center: {json.dumps(evidence, sort_keys=True)}"
        )
    if min(qualities) <= bakelib._FLOAT32_UV_SAMPLEABILITY_RESCUE_CEILING:
        raise AssertionError(
            "fixture drift: ordinary grid became precision-sensitive: "
            f"{json.dumps(evidence, sort_keys=True)}"
        )
    if precision_candidates or reports:
        raise AssertionError(
            "ordinary subpixel topology was selected or regularized: "
            f"{json.dumps(evidence, sort_keys=True)}"
        )
    if final_held:
        raise AssertionError(
            "ordinary unpinned grid unexpectedly acquired pinned ownership: "
            f"{json.dumps(evidence, sort_keys=True)}"
        )
    print(
        "BLENDLINK_ORDINARY_SUBPIXEL_PRECISION_RESCUE_CHECK_PASSED "
        + json.dumps(evidence, sort_keys=True)
    )


if __name__ == "__main__":
    main()
