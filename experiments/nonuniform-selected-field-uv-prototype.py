# SPDX-License-Identifier: MIT
"""Real-Blender differential for selected-field UVs under object scale.

Run with:

  blender --background --factory-startup --python \
    experiments/nonuniform-selected-field-uv-prototype.py -- \
    packages/blendlink/blender

This is a disposable research fixture, not package code.  It compares the
current local-coordinate Smart Project path with a second disposable unwrap
proxy whose vertices are transformed by the receiver's world-linear matrix.
Only corner UVs are copied back from that proxy.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


RESOLUTION = 1024
UV_NAME = "BLENDLINK_NONUNIFORM_PROBE"


def _arguments() -> Path:
    marker = sys.argv.index("--")
    values = sys.argv[marker + 1:]
    if len(values) != 1:
        raise RuntimeError("expected: <bakelib directory>")
    return Path(values[0]).resolve()


def _reset() -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def _make_quad(name: str, scale_x: float):
    mesh = bpy.data.meshes.new(f"{name}.Mesh")
    mesh.from_pydata(
        (
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (1.0, 1.0, 0.0),
            (0.0, 1.0, 0.0),
        ),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    layer = mesh.uv_layers.new(name=UV_NAME)
    if layer is None:
        raise RuntimeError("could not create probe UV")
    mesh.uv_layers.active = layer
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.scale = (scale_x, 1.0, 1.0)
    bpy.context.view_layer.update()
    return obj


def _select_only(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def _smart_project_blendlink(bakelib, obj) -> None:
    bakelib.smart_project_private_uvs(
        [obj],
        uv_name=UV_NAME,
        log=lambda _message: None,
    )


def _smart_project_needle(obj) -> None:
    _select_only(obj)
    obj.data.uv_layers.active = obj.data.uv_layers[UV_NAME]
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(
            angle_limit=1.22,
            island_margin=0.01,
            scale_to_bounds=True,
            correct_aspect=True,
            margin_method="SCALED",
            area_weight=1.0,
        )
    finally:
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")


def _copy_uvs(source_obj, target_obj) -> None:
    source_mesh = source_obj.data
    target_mesh = target_obj.data
    if (
        len(source_mesh.vertices) != len(target_mesh.vertices)
        or len(source_mesh.polygons) != len(target_mesh.polygons)
        or len(source_mesh.loops) != len(target_mesh.loops)
    ):
        raise RuntimeError("unwrap proxy topology differs from receiver topology")
    source_signature = tuple(
        (loop.vertex_index, loop.edge_index) for loop in source_mesh.loops
    )
    target_signature = tuple(
        (loop.vertex_index, loop.edge_index) for loop in target_mesh.loops
    )
    if source_signature != target_signature:
        raise RuntimeError("unwrap proxy loop identity differs from receiver")
    source_layer = source_mesh.uv_layers.get(UV_NAME)
    target_layer = target_mesh.uv_layers.get(UV_NAME)
    if source_layer is None or target_layer is None:
        raise RuntimeError("unwrap proxy or receiver lost its private UV")
    for source_loop, target_loop in zip(source_layer.data, target_layer.data):
        target_loop.uv = source_loop.uv
        target_loop.pin_uv = False


def _smart_project_world_linear_proxy(bakelib, obj, projector) -> dict:
    proxy_mesh = obj.data.copy()
    proxy_mesh.name = f"{obj.data.name}.WorldLinearProxy"
    proxy = bpy.data.objects.new(f"{obj.name}.WorldLinearProxy", proxy_mesh)
    bpy.context.scene.collection.objects.link(proxy)
    linear = obj.matrix_world.to_3x3()
    determinant = float(linear.determinant())
    proxy_mesh.transform(linear.to_4x4())
    proxy.matrix_world = Matrix.Identity(4)
    bpy.context.view_layer.update()
    try:
        projector(bakelib, proxy) if projector is _smart_project_blendlink else projector(proxy)
        _copy_uvs(proxy, obj)
    finally:
        bpy.data.objects.remove(proxy, do_unlink=True)
        if bpy.data.meshes.get(proxy_mesh.name) is proxy_mesh:
            bpy.data.meshes.remove(proxy_mesh)
    return {
        "worldLinearDeterminant": determinant,
        "copiedBy": "validated-loop-index",
    }


def _finish_blendlink_pack(bakelib, obj) -> None:
    obj.data.uv_layers.active = obj.data.uv_layers[UV_NAME]
    held = bakelib.average_unpinned([obj], UV_NAME)
    if held:
        raise RuntimeError("probe unexpectedly produced pinned islands")
    bakelib.pack(
        [obj],
        margin_px=4,
        size=RESOLUTION,
        pin=True,
    )


def _finish_needle_pack(obj) -> None:
    _select_only(obj)
    prior_sync = bpy.context.tool_settings.use_uv_select_sync
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.context.tool_settings.use_uv_select_sync = True
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.average_islands_scale(scale_uv=True)
        bpy.ops.uv.pack_islands(
            margin=12.0 / RESOLUTION,
            rotate=False,
        )
    finally:
        bpy.context.tool_settings.use_uv_select_sync = prior_sync
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")


def _metrics(obj) -> dict:
    mesh = obj.data
    layer = mesh.uv_layers[UV_NAME]
    polygon = mesh.polygons[0]
    edges = []
    densities = []
    for offset, loop_index in enumerate(polygon.loop_indices):
        next_loop_index = polygon.loop_indices[
            (offset + 1) % len(polygon.loop_indices)
        ]
        loop = mesh.loops[loop_index]
        next_loop = mesh.loops[next_loop_index]
        local_start = mesh.vertices[loop.vertex_index].co
        local_end = mesh.vertices[next_loop.vertex_index].co
        world_start = obj.matrix_world @ local_start
        world_end = obj.matrix_world @ local_end
        world_length = float((world_end - world_start).length)
        uv_length = float(
            (layer.data[next_loop_index].uv - layer.data[loop_index].uv).length
        )
        density = uv_length * RESOLUTION / world_length
        densities.append(density)
        edges.append({
            "vertices": [loop.vertex_index, next_loop.vertex_index],
            "worldLength": world_length,
            "uvLength": uv_length,
            "texelsPerWorldUnit": density,
        })

    mesh.calc_loop_triangles()
    world_area = 0.0
    uv_area = 0.0
    for triangle in mesh.loop_triangles:
        points = [
            obj.matrix_world @ mesh.vertices[index].co
            for index in triangle.vertices
        ]
        world_area += 0.5 * (
            points[1] - points[0]
        ).cross(points[2] - points[0]).length
        uv_points = [
            tuple(layer.data[index].uv) for index in triangle.loops
        ]
        uv_area += abs(
            0.5
            * sum(
                uv_points[index][0] * uv_points[(index + 1) % 3][1]
                - uv_points[(index + 1) % 3][0] * uv_points[index][1]
                for index in range(3)
            )
        )
    coordinates = [tuple(item.uv) for item in layer.data]
    width = max(point[0] for point in coordinates) - min(
        point[0] for point in coordinates
    )
    height = max(point[1] for point in coordinates) - min(
        point[1] for point in coordinates
    )
    minimum = min(densities)
    maximum = max(densities)
    return {
        "objectScale": list(obj.scale),
        "uvBoundsSize": [width, height],
        "uvBoundsAspect": width / height if height else None,
        "worldArea": world_area,
        "uvArea": uv_area,
        "legacyAreaDensity": math.sqrt(
            uv_area * RESOLUTION * RESOLUTION / world_area
        ),
        "minimumDirectionalDensity": minimum,
        "maximumDirectionalDensity": maximum,
        "directionalAnisotropy": maximum / minimum,
        "edges": edges,
    }


def _run_case(bakelib, name: str, scale_x: float, family: str, proxy: bool):
    obj = _make_quad(name, scale_x)
    if family == "blendlink":
        projector = _smart_project_blendlink
        finisher = lambda target: _finish_blendlink_pack(bakelib, target)
    elif family == "needle":
        projector = _smart_project_needle
        finisher = _finish_needle_pack
    else:
        raise RuntimeError(f"unknown family {family}")
    proxy_evidence = None
    if proxy:
        proxy_evidence = _smart_project_world_linear_proxy(
            bakelib, obj, projector,
        )
    else:
        projector(bakelib, obj) if projector is _smart_project_blendlink else projector(obj)
    finisher(obj)
    result = _metrics(obj)
    result["family"] = family
    result["unwrapCoordinates"] = "world-linear-proxy" if proxy else "object-local"
    result["proxyEvidence"] = proxy_evidence
    return result


def main() -> None:
    module_dir = _arguments()
    sys.path.insert(0, str(module_dir))
    import bakelib

    _reset()
    cases = {}
    for scale_x in (100.0, -100.0):
        sign = "positive" if scale_x > 0.0 else "mirrored"
        for family in ("blendlink", "needle"):
            for proxy in (False, True):
                label = (
                    f"{family}.{sign}."
                    + ("world-linear-proxy" if proxy else "current-local")
                )
                cases[label] = _run_case(
                    bakelib,
                    label,
                    scale_x,
                    family,
                    proxy,
                )

    current = cases["blendlink.positive.current-local"]
    scalar = dict(current)
    scalar["design"] = "post-pack-uniform-island-normalization"
    scalar["directionalAnisotropyAfterAnyUniformScale"] = current[
        "directionalAnisotropy"
    ]
    if current["directionalAnisotropy"] < 90.0:
        raise AssertionError(
            "local-coordinate Blendlink control no longer exposes the scale flaw"
        )
    for sign in ("positive", "mirrored"):
        repaired = cases[f"blendlink.{sign}.world-linear-proxy"]
        if repaired["directionalAnisotropy"] > 1.001:
            raise AssertionError(
                f"world-linear Blendlink proxy did not normalize {sign} scale: "
                f"{repaired['directionalAnisotropy']}"
            )
        needle = cases[f"needle.{sign}.current-local"]
        if needle["directionalAnisotropy"] < 90.0:
            raise AssertionError(
                f"pinned Needle control unexpectedly normalized {sign} scale"
            )
        needle_proxy = cases[f"needle.{sign}.world-linear-proxy"]
        if needle_proxy["directionalAnisotropy"] < 90.0:
            raise AssertionError(
                "Needle scale_to_bounds control stopped demonstrating its "
                f"aspect-destroying behavior for {sign} scale"
            )
    print("BLENDLINK_NONUNIFORM_UV_PROBE " + json.dumps({
        "blenderVersion": bpy.app.version_string,
        "resolution": RESOLUTION,
        "cases": cases,
        "postPackScalarCounterexample": scalar,
    }, sort_keys=True))


if __name__ == "__main__":
    main()
