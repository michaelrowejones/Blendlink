"""Non-production differential for Blendlink's hierarchical atlas packing.

Run with Blender after opening a fixture and pass one variant after ``--``.
The probe monkey-patches only the internal pack adapter in memory, computes the
real plan, and prints compact geometry/capacity measurements. It never saves.
"""

from __future__ import annotations

import json
import itertools
import hashlib
import math
import os
import re
import struct
import sys
import time

import bpy


REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "packages", "blender-addon"))
sys.path.insert(0, os.path.join(REPO, "packages", "blendlink", "blender"))

import bakelib  # noqa: E402
import export_scene  # noqa: E402


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
variant = args[0] if args else "baseline"

original_pack = bakelib._pack_selected_uv_islands
original_group_pack = bakelib._pack_receiver_groups_mutating
original_spacing_validator = bakelib.validate_receiver_group_spacing
original_allocate = bakelib.allocate_receiver_rectangles
allocation_records = []


def recording_allocate(rectangles, **kwargs):
    result = original_allocate(rectangles, **kwargs)
    allocation_records.append({
        "rectangles": [
            (str(name), float(width), float(height))
            for name, width, height in rectangles
        ],
        "edgeGutter": float(kwargs["edge_gutter"]),
        "receiverGutter": float(kwargs["receiver_gutter"]),
        "productionScale": float(result["scale"]),
        "ordering": result["ordering"],
        "scoring": result["scoring"],
    })
    return result


bakelib.allocate_receiver_rectangles = recording_allocate


def variant_pack(*, margin: float, rotate: bool, scale: bool = True,
                 shape_method: str = "CONCAVE") -> None:
    if shape_method == "AABB":
        if variant == "local-concave":
            shape_method = "CONCAVE"
        elif variant == "local-convex":
            shape_method = "CONVEX"
    if not scale and variant == "local-needle-margin":
        # Production passes (artist margin + 4px) / size. Needle's local
        # Smart Project target is max(3px, bake margin + 1px).
        margin = max(3.0, 16.0 + 1.0) / 4096.0
    original_pack(
        margin=margin,
        rotate=rotate,
        scale=scale,
        shape_method=shape_method,
    )


bakelib._pack_selected_uv_islands = variant_pack


custom_global = re.fullmatch(
    r"global-(\d+(?:\.\d+)?)-(aabb|convex|concave)", variant,
)
if (
    variant.startswith("global-")
    or variant.startswith("prior-global-")
    or custom_global
):
    prior_global = variant.startswith("prior-global-")
    requested_global_margin = (
        float(custom_global.group(1)) if custom_global else None
    )
    global_shape = (
        custom_global.group(2).upper()
        if custom_global
        else variant.removeprefix(
            "prior-global-" if prior_global else "global-"
        ).upper()
    )
    if global_shape not in {"AABB", "CONVEX", "CONCAVE"}:
        raise ValueError(f"unknown global shape {global_shape!r}")

    def global_pack(objects, margin_px, size, *, guard_px=4):
        """Replay the pre-hierarchy all-island pack without saving."""
        bakelib.select_only(objects)
        original_pack(
            margin=(
                (
                    requested_global_margin
                    if requested_global_margin is not None
                    else margin_px + guard_px
                    if prior_global
                    else bakelib.required_bake_gutter_px(
                        margin_px, guard_px=guard_px,
                    )
                ) / float(size)
            ),
            rotate=True,
            scale=True,
            shape_method=global_shape,
        )

    # The production hierarchical validator intentionally rejects interleaved
    # receiver envelopes. This differential measures the individual island
    # gutters separately below.
    bakelib._pack_receiver_groups_mutating = global_pack
    bakelib.validate_receiver_group_spacing = lambda *_args, **_kwargs: None

started = time.monotonic()
settings, recipe = export_scene.resolve_scene_recipe({"planOnly": True})
plan = export_scene.compute_bake_plan(settings, recipe)

names = {record["name"] for record in plan["objects"]}
rows = []
for obj in sorted(
        (obj for obj in bpy.context.scene.objects if obj.name in names),
        key=lambda item: item.name):
    layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
    area = bakelib.packed_uv_area(obj, bakelib.ATLAS_UV)
    bounds = bakelib._active_uv_bounds(obj)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    bounds_area = width * height
    rows.append({
        "name": obj.name,
        "uvArea": area,
        "boundsArea": bounds_area,
        "localFill": area / bounds_area,
        "width": width,
        "height": height,
        "aspect": max(width / height, height / width),
    })

uv_area = sum(row["uvArea"] for row in rows)
bounds_area = sum(row["boundsArea"] for row in rows)
atlas = plan["atlases"]["main"]
edge_gutter = atlas["paddingPx"] + 4
usable_area = (1.0 - 2.0 * edge_gutter / atlas["size"]) ** 2

islands = []
for obj in sorted(
        (obj for obj in bpy.context.scene.objects if obj.name in names),
        key=lambda item: item.name,
):
    for island_number, bounds in bakelib._receiver_island_bounds(obj):
        islands.append((obj.name, island_number, bounds))
same_owner = []
cross_owner = []
for index, (left_name, _left_number, left) in enumerate(islands):
    for right_name, _right_number, right in islands[index + 1:]:
        distance = bakelib._uv_bounds_tuple_distance(left, right)
        (same_owner if left_name == right_name else cross_owner).append(distance)
minimum_edge = min(
    min(bounds[0], bounds[1], 1.0 - bounds[2], 1.0 - bounds[3])
    for _name, _number, bounds in islands
)


def uv_boundary_segments(obj):
    layer = obj.data.uv_layers.active
    counts = {}
    originals = {}
    for polygon in obj.data.polygons:
        indices = list(polygon.loop_indices)
        for index, loop_index in enumerate(indices):
            next_loop_index = indices[(index + 1) % len(indices)]
            start = tuple(float(value) for value in layer.data[loop_index].uv)
            end = tuple(float(value) for value in layer.data[next_loop_index].uv)
            key = tuple(sorted((
                (round(start[0], 9), round(start[1], 9)),
                (round(end[0], 9), round(end[1], 9)),
            )))
            counts[key] = counts.get(key, 0) + 1
            originals[key] = (start, end)
    return [
        originals[key] for key, count in counts.items() if count % 2 == 1
    ]


def point_segment_distance(point, start, end):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    denominator = dx * dx + dy * dy
    if denominator == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    amount = max(0.0, min(
        1.0,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy)
        / denominator,
    ))
    return math.hypot(
        point[0] - (start[0] + amount * dx),
        point[1] - (start[1] + amount * dy),
    )


def segment_distance(left, right):
    return min(
        point_segment_distance(left[0], *right),
        point_segment_distance(left[1], *right),
        point_segment_distance(right[0], *left),
        point_segment_distance(right[1], *left),
    )


object_segments = {
    obj.name: uv_boundary_segments(obj)
    for obj in bpy.context.scene.objects if obj.name in names
}
cross_geometry_distances = (
    [
        segment_distance(left_segment, right_segment)
        for left_index, left_name in enumerate(sorted(object_segments))
        for right_name in sorted(object_segments)[left_index + 1:]
        for left_segment in object_segments[left_name]
        for right_segment in object_segments[right_name]
    ]
    if len(object_segments) <= 8 else []
)

receiver_bounds = [
    (
        row["name"],
        bakelib._active_uv_bounds(
            next(obj for obj in bpy.context.scene.objects if obj.name == row["name"])
        ),
    )
    for row in rows
]
receiver_distances = [
    bakelib._uv_bounds_tuple_distance(left, right)
    for index, (_left_name, left) in enumerate(receiver_bounds)
    for _right_name, right in receiver_bounds[index + 1:]
]


def minimum_px(values):
    return min(values) * atlas["size"] if values else None


uv_digest = hashlib.sha256()
for obj in sorted(
    (obj for obj in bpy.context.scene.objects if obj.name in names),
    key=lambda item: item.name,
):
    uv_digest.update(obj.name.encode("utf8"))
    for loop in obj.data.uv_layers.active.data:
        uv_digest.update(struct.pack("<ff", float(loop.uv.x), float(loop.uv.y)))


def exhaustive_outer_scale(record, *, rotate):
    rectangles = record["rectangles"]
    side = (
        1.0 - 2.0 * record["edgeGutter"] + record["receiverGutter"]
    )
    orientation_sets = (
        itertools.product((False, True), repeat=len(rectangles))
        if rotate else [tuple(False for _item in rectangles)]
    )
    candidates = []
    for orientations in orientation_sets:
        oriented = [
            (
                name,
                height if turned else width,
                width if turned else height,
            )
            for (name, width, height), turned
            in zip(rectangles, orientations)
        ]
        for permutation in itertools.permutations(oriented):
            for scoring in bakelib._RECEIVER_RECTANGLE_SCORINGS:
                def fits(scale):
                    return bakelib._maxrects_receiver_attempt(
                        [
                            (
                                name,
                                width * scale + record["receiverGutter"],
                                height * scale + record["receiverGutter"],
                            )
                            for name, width, height in permutation
                        ],
                        side,
                        scoring,
                    ) is not None

                low = 0.0
                high = 1.0
                while fits(high):
                    low = high
                    high *= 2.0
                for _iteration in range(48):
                    middle = (low + high) / 2.0
                    if fits(middle):
                        low = middle
                    else:
                        high = middle
                candidates.append({
                    "scale": low,
                    "rotated": [
                        name for (name, _width, _height), turned
                        in zip(rectangles, orientations) if turned
                    ],
                    "order": [name for name, _width, _height in permutation],
                    "scoring": scoring,
                })
    return max(candidates, key=lambda item: item["scale"])


allocator_evidence = None
if allocation_records:
    allocation_record = allocation_records[-1]
    allocator_evidence = {
        **allocation_record,
        "allPermutations": exhaustive_outer_scale(
            allocation_record, rotate=False,
        ),
        "allPermutationsAndRotations": exhaustive_outer_scale(
            allocation_record, rotate=True,
        ),
    }

print("BLENDLINK_PACK_PROBE " + json.dumps({
    "variant": variant,
    "seconds": time.monotonic() - started,
    "errors": plan["errors"],
    "occupancy": uv_area,
    "reportedOccupancy": plan["occupancy"],
    "targetAchievement": atlas.get("targetAchievement"),
    "uvHash": uv_digest.hexdigest(),
    "uvArea": uv_area,
    "boundsArea": bounds_area,
    "localChartFill": uv_area / bounds_area,
    "usableArea": usable_area,
    "globalRectangleFill": bounds_area / usable_area,
    "allocator": allocator_evidence,
    "spacingPx": {
        "edge": minimum_edge * atlas["size"],
        "sameOwner": minimum_px(same_owner),
        "crossOwner": minimum_px(cross_owner),
        "crossOwnerGeometry": minimum_px(cross_geometry_distances),
        "receiverEnvelope": minimum_px(receiver_distances),
    },
    "topWaste": sorted(
        rows,
        key=lambda row: row["boundsArea"] - row["uvArea"],
        reverse=True,
    )[:10],
}, sort_keys=True))
