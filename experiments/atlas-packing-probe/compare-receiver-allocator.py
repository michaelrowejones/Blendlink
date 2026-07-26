# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare receiver-rectangle policies on one real Blendlink bake plan.

Diagnostic only. Run Blender with a .blend, then this script. It captures the
exact rectangles passed to the production allocator and compares its bounded
portfolio with exhaustive fixed-orientation order and optional 90-degree
receiver rotation. No source scene is saved.
"""

import itertools
import json
import math
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))

import bakelib  # noqa: E402
import export_scene  # noqa: E402


captured = []
production_allocate = bakelib.allocate_receiver_rectangles
production_pack_selected = bakelib._pack_selected_uv_islands


local_shape = None
if "--local-shape" in sys.argv:
    local_shape = sys.argv[sys.argv.index("--local-shape") + 1]
local_margin_factor = 1.0
if "--local-margin-factor" in sys.argv:
    local_margin_factor = float(
        sys.argv[sys.argv.index("--local-margin-factor") + 1]
    )
local_rotate_method = None
if "--local-rotate-method" in sys.argv:
    local_rotate_method = sys.argv[
        sys.argv.index("--local-rotate-method") + 1
    ]
local_margin_method = None
if "--local-margin-method" in sys.argv:
    local_margin_method = sys.argv[
        sys.argv.index("--local-margin-method") + 1
    ]


def pack_selected_with_shape(*args, **kwargs):
    if kwargs.get("scale") is not False:
        return production_pack_selected(*args, **kwargs)
    kwargs["margin"] = float(kwargs["margin"]) * local_margin_factor
    if local_shape is not None:
        kwargs["shape_method"] = local_shape
    if local_rotate_method is None and local_margin_method is None:
        return production_pack_selected(*args, **kwargs)

    prior_sync = bpy.context.tool_settings.use_uv_select_sync
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        bpy.context.tool_settings.use_uv_select_sync = True
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.pack_islands(
            rotate=bool(kwargs.get("rotate", True)),
            rotate_method=local_rotate_method or "CARDINAL",
            scale=False,
            merge_overlap=False,
            margin_method=local_margin_method or "FRACTION",
            margin=float(kwargs["margin"]),
            shape_method=kwargs.get("shape_method", "AABB"),
        )
    finally:
        bpy.context.tool_settings.use_uv_select_sync = prior_sync
        bpy.ops.object.mode_set(mode="OBJECT")
    return None


def capture(rectangles, *, edge_gutter, receiver_gutter):
    result = production_allocate(
        rectangles,
        edge_gutter=edge_gutter,
        receiver_gutter=receiver_gutter,
    )
    captured.append({
        "rectangles": [list(item) for item in rectangles],
        "edgeGutter": edge_gutter,
        "receiverGutter": receiver_gutter,
        "production": result,
    })
    return result


bakelib.allocate_receiver_rectangles = capture
bakelib._pack_selected_uv_islands = pack_selected_with_shape
try:
    settings, recipe = export_scene.resolve_scene_recipe({
        "planOnly": True,
        "draft": False,
    })
    bakelib.remove_checker_overrides(bpy.data.objects)
    export_scene.remove_noimp_objects()
    plan = export_scene.compute_bake_plan(settings, recipe)
finally:
    bakelib.allocate_receiver_rectangles = production_allocate
    bakelib._pack_selected_uv_islands = production_pack_selected


def search(rectangles, edge, gutter, *, rotate, exhaustive_order):
    side = 1.0 - 2.0 * edge + gutter
    orientation_masks = range(1 << len(rectangles)) if rotate else (0,)

    def attempt(scale):
        best = None
        for mask in orientation_masks:
            oriented = []
            for index, (name, width, height) in enumerate(rectangles):
                swapped = bool(mask & (1 << index))
                if swapped:
                    width, height = height, width
                oriented.append((name, width, height, swapped))
            if exhaustive_order:
                orders = itertools.permutations(oriented)
            else:
                orders = (
                    tuple(
                        (name, width, height, swapped)
                        for name, width, height in bakelib._ordered_receiver_rectangles(
                            [(item[0], item[1], item[2]) for item in oriented], mode,
                        )
                        for swapped in [next(
                            source[3] for source in oriented if source[0] == name
                        )]
                    )
                    for mode in bakelib._RECEIVER_RECTANGLE_ORDERINGS
                )
            for order in orders:
                items = [
                    (name, width * scale + gutter, height * scale + gutter)
                    for name, width, height, _swapped in order
                ]
                for scoring in bakelib._RECEIVER_RECTANGLE_SCORINGS:
                    placements = bakelib._maxrects_receiver_attempt(
                        items, side, scoring,
                    )
                    if placements is not None:
                        candidate = {
                            "mask": mask,
                            "order": [item[0] for item in order],
                            "scoring": scoring,
                            "placements": placements,
                            "rotated": sorted(
                                item[0] for item in order if item[3]
                            ),
                        }
                        if best is None or (
                            candidate["rotated"], candidate["order"], scoring
                        ) < (
                            best["rotated"], best["order"], best["scoring"]
                        ):
                            best = candidate
        return best

    low = 0.0
    low_result = attempt(0.0)
    high = 1.0
    while attempt(high) is not None:
        low = high
        low_result = attempt(high)
        high *= 2.0
    for _iteration in range(48):
        middle = (low + high) / 2.0
        result = attempt(middle)
        if result is None:
            high = middle
        else:
            low = middle
            low_result = result
    return {"scale": low, **low_result}


comparisons = []
for capture_index, record in enumerate(captured):
    rectangles = [tuple(item) for item in record["rectangles"]]
    edge = record["edgeGutter"]
    gutter = record["receiverGutter"]
    allow_exhaustive = len(rectangles) <= 8
    variants = {
        "production": {
            key: value for key, value in record["production"].items()
            if key != "placements"
        },
        "fixedExhaustive": (
            search(
                rectangles, edge, gutter,
                rotate=False, exhaustive_order=True,
            ) if allow_exhaustive else None
        ),
        "rotatedPortfolio": search(
            rectangles, edge, gutter,
            rotate=True, exhaustive_order=False,
        ),
        "rotatedExhaustive": (
            search(
                rectangles, edge, gutter,
                rotate=True, exhaustive_order=True,
            ) if allow_exhaustive else None
        ),
    }
    for variant in variants.values():
        if isinstance(variant, dict):
            variant.pop("placements", None)
    comparisons.append({
        "capture": capture_index,
        "rectangles": record["rectangles"],
        "edgeGutter": edge,
        "receiverGutter": gutter,
        "variants": variants,
    })

print("BLENDLINK_RECEIVER_ALLOCATOR_COMPARISON " + json.dumps({
    "blend": bpy.data.filepath,
    "localShape": local_shape or "production-AABB",
    "localMarginFactor": local_margin_factor,
    "localMarginMethod": local_margin_method or "production-FRACTION",
    "localRotateMethod": local_rotate_method or "production-CARDINAL",
    "plan": {
        "atlases": plan.get("atlases"),
        "errors": plan.get("errors", []),
    },
    "comparisons": comparisons,
}, sort_keys=True))
