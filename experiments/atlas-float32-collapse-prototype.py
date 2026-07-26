"""PROTOTYPE — measure float32 UV collapse and bake coverage floors.

Question: what minimum packed UV footprint prevents Blender's atlas packer
from collapsing a valid tiny island, and what footprint actually receives a
bake sample?  This deliberately does not import or change Blendlink policy.

Run:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" \
    --background --python experiments/atlas-float32-collapse-prototype.py
"""

from __future__ import annotations

import json
import math
import sys

import bpy


ATLAS_SIZE = 4096
BAKE_SIZE = 64
PACK_MARGIN_PX = 4


def reset() -> None:
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def triangle_area(points) -> float:
    return abs(0.5 * (
        points[0][0] * (points[1][1] - points[2][1])
        + points[1][0] * (points[2][1] - points[0][1])
        + points[2][0] * (points[0][1] - points[1][1])
    ))


def edge_min(points) -> float:
    return min(math.dist(points[index], points[(index + 1) % 3]) for index in range(3))


def make_pack_mesh(small_span: float, large_count: int = 1):
    vertices = []
    faces = []
    for ordinal in range(large_count + 1):
        start = len(vertices)
        x = float(ordinal * 2)
        vertices.extend(((x, 0.0, 0.0), (x + 1.0, 0.0, 0.0), (x, 1.0, 0.0)))
        faces.append((start, start + 1, start + 2))
    mesh = bpy.data.meshes.new("AtlasFloat32Prototype")
    mesh.from_pydata(vertices, (), faces)
    mesh.update()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    layer = mesh.uv_layers.new(name="BLENDLINK_ATLAS")
    # Tiny island starts at zero, where float32 can retain far smaller deltas.
    tiny = ((0.0, 0.0), (small_span, 0.0), (0.0, small_span))
    for loop_index, uv in zip(mesh.polygons[0].loop_indices, tiny):
        layer.data[loop_index].uv = uv
    # Large islands are deliberately outside 0..1. Packing translates and
    # scales both sets, exposing the loss when the tiny island moves away
    # from zero into a coordinate with a larger float32 ULP.
    for ordinal, polygon in enumerate(mesh.polygons[1:]):
        base = 2.0 + (ordinal * 2.0)
        for loop_index, uv in zip(
            polygon.loop_indices,
            ((base, 0.0), (base + 1.0, 0.0), (base, 1.0)),
        ):
            layer.data[loop_index].uv = uv
    mesh.uv_layers.active = layer
    return obj, layer


def polygon_points(layer, polygon):
    return [tuple(layer.data[index].uv) for index in polygon.loop_indices]


def pack_object(obj) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(
        rotate=True,
        rotate_method="CARDINAL",
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        margin=(PACK_MARGIN_PX + 4) / ATLAS_SIZE,
        shape_method="CONCAVE",
    )
    bpy.ops.object.mode_set(mode="OBJECT")


def pack_sweep():
    records = []
    cases = (
        *((1, exponent) for exponent in (16, 20, 24)),
        (16, 17),
    )
    for large_count, exponent in cases:
        print(f"PROTOTYPE_PACK_START {large_count=} {exponent=}", flush=True)
        intended = 2.0 ** -exponent
        obj, layer = make_pack_mesh(intended, large_count)
        before = polygon_points(layer, obj.data.polygons[0])
        pack_object(obj)
        # UV operators replace the RNA wrapper even when the layer name
        # is unchanged; holding the old wrapper can crash Blender 5.x.
        layer = obj.data.uv_layers.get("BLENDLINK_ATLAS")
        after = polygon_points(layer, obj.data.polygons[0])
        large_after = polygon_points(layer, obj.data.polygons[1])
        records.append({
            "largeIslands": large_count,
            "inputExponent": exponent,
            "inputSpan": intended,
            "inputArea": triangle_area(before),
            "packedMinEdge": edge_min(after),
            "packedArea": triangle_area(after),
            "packedPixelSpan": edge_min(after) * ATLAS_SIZE,
            "largePackedMinEdge": edge_min(large_after),
            "collapsed": triangle_area(after) <= 1e-12,
        })
    return records


def make_bake_triangle(span_pixels: float, phase_x: float, phase_y: float):
    mesh = bpy.data.meshes.new("BakeCoveragePrototype")
    mesh.from_pydata(((0, 0, 0), (1, 0, 0), (0, 1, 0)), (), ((0, 1, 2),))
    mesh.update()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    layer = mesh.uv_layers.new(name="UVMap")
    base_x = (16.0 + phase_x) / BAKE_SIZE
    base_y = (16.0 + phase_y) / BAKE_SIZE
    span = span_pixels / BAKE_SIZE
    for loop_index, uv in zip(
        mesh.polygons[0].loop_indices,
        ((base_x, base_y), (base_x + span, base_y), (base_x, base_y + span)),
    ):
        layer.data[loop_index].uv = uv
    layer.active_render = True

    material = bpy.data.materials.new("BakeCoverageMaterial")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    image = bpy.data.images.new("BakeCoverage", BAKE_SIZE, BAKE_SIZE, alpha=False, float_buffer=False)
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    target.select = True
    nodes.active = target
    obj.data.materials.append(material)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    return obj, image


def bake_coverage_sweep():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.render.bake.use_clear = True
    scene.render.bake.margin = 0
    records = []
    spans = (2.0 ** -5, 0.5, 1.0, 2.0)
    phases = (0.0, 0.25, 0.5, 0.75)
    for span_pixels in spans:
        covered_counts = []
        for phase_x in phases:
            for phase_y in phases:
                reset()
                obj, image = make_bake_triangle(span_pixels, phase_x, phase_y)
                bpy.ops.object.bake(type="EMIT")
                pixels = list(image.pixels)
                covered = sum(
                    1 for index in range(0, len(pixels), 4)
                    if pixels[index] > 0.01
                )
                covered_counts.append(covered)
        records.append({
            "spanPixels": span_pixels,
            "triangleAreaPixels": 0.5 * span_pixels * span_pixels,
            "phaseSamples": len(covered_counts),
            "minimumCoveredPixels": min(covered_counts),
            "maximumCoveredPixels": max(covered_counts),
            "misses": sum(count == 0 for count in covered_counts),
            "coveredCounts": covered_counts,
        })
    return records


pack_result = [] if "--bake-only" in sys.argv else pack_sweep()
print("BLENDLINK_ATLAS_FLOAT32_PACK " + json.dumps(pack_result, sort_keys=True), flush=True)
result = {
    "atlasSize": ATLAS_SIZE,
    "bakeSize": BAKE_SIZE,
    "float32UlpAtOne": 2.0 ** -23,
    "numerical64UlpPixels": (64.0 * (2.0 ** -23)) * ATLAS_SIZE,
    "pack": pack_result,
    "bakeCoverage": bake_coverage_sweep(),
}
print("BLENDLINK_ATLAS_FLOAT32_PROTOTYPE " + json.dumps(result, sort_keys=True))
