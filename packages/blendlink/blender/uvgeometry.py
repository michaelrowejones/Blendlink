# SPDX-License-Identifier: GPL-3.0-or-later
"""Pure UV/atlas geometry: no Blender, no mesh RNA, no I/O.

Everything here is ordinary numbers in and ordinary numbers out, which
makes it the one part of the bake pipeline that can be proved without
launching Blender. It lives in its own module for exactly that reason -
inside bakelib it sat behind a module-scope `import bpy`, so the MaxRects
receiver allocator that decides where every object lands in the atlas
could only be exercised by running a complete Cycles bake. Both of its
expensive lessons (the 8192-page VRAM regression, and the fixed-pixel
gutter contract saturating at a too-small atlas) were learned that way.

bakelib re-exports these names, so callers and monkeypatching test
fixtures keep addressing them as `bakelib.<name>`.

NOTE: export_scene hashes every module in this directory into the bake
cache's pipelineSignature, so an algorithm change here correctly
invalidates baked pixels.
"""
from __future__ import annotations

import math


_RECEIVER_RECTANGLE_ORDERINGS = (
    "area", "max-side", "height", "width", "perimeter", "aspect",
)
_RECEIVER_RECTANGLE_SCORINGS = ("short-side", "area")
_RECEIVER_RECTANGLE_EPSILON = 1e-12


def _receiver_rectangles_intersect(left, right) -> bool:
    epsilon = _RECEIVER_RECTANGLE_EPSILON
    return not (
        left[0] + left[2] <= right[0] + epsilon
        or right[0] + right[2] <= left[0] + epsilon
        or left[1] + left[3] <= right[1] + epsilon
        or right[1] + right[3] <= left[1] + epsilon
    )


def _receiver_rectangle_contains(outer, inner) -> bool:
    epsilon = _RECEIVER_RECTANGLE_EPSILON
    return (
        outer[0] <= inner[0] + epsilon
        and outer[1] <= inner[1] + epsilon
        and outer[0] + outer[2] + epsilon >= inner[0] + inner[2]
        and outer[1] + outer[3] + epsilon >= inner[1] + inner[3]
    )


def _prune_receiver_free_rectangles(rectangles) -> list[tuple[float, ...]]:
    """Remove duplicate/contained MaxRects regions deterministically."""
    unique = []
    for rectangle in rectangles:
        if rectangle not in unique:
            unique.append(rectangle)
    return [
        rectangle
        for index, rectangle in enumerate(unique)
        if not any(
            index != other_index
            and _receiver_rectangle_contains(other, rectangle)
            for other_index, other in enumerate(unique)
        )
    ]


def _maxrects_receiver_attempt(items, side: float, scoring: str):
    """Place fixed-orientation padded rectangles with one MaxRects heuristic."""
    if scoring not in _RECEIVER_RECTANGLE_SCORINGS:
        raise ValueError(f"unsupported receiver rectangle scoring {scoring!r}")
    free_rectangles = [(0.0, 0.0, float(side), float(side))]
    placements = {}
    for name, width, height in items:
        candidates = []
        for free_index, rectangle in enumerate(free_rectangles):
            if (
                width > rectangle[2] + _RECEIVER_RECTANGLE_EPSILON
                or height > rectangle[3] + _RECEIVER_RECTANGLE_EPSILON
            ):
                continue
            leftover_width = rectangle[2] - width
            leftover_height = rectangle[3] - height
            if scoring == "short-side":
                score = (
                    min(leftover_width, leftover_height),
                    max(leftover_width, leftover_height),
                )
            else:
                score = (
                    rectangle[2] * rectangle[3] - width * height,
                    min(leftover_width, leftover_height),
                )
            candidates.append((
                *score, rectangle[1], rectangle[0], free_index,
            ))
        if not candidates:
            return None
        free_index = min(candidates)[-1]
        chosen = free_rectangles[free_index]
        used = (chosen[0], chosen[1], width, height)
        placements[name] = used

        split = []
        for rectangle in free_rectangles:
            if not _receiver_rectangles_intersect(rectangle, used):
                split.append(rectangle)
                continue
            rectangle_right = rectangle[0] + rectangle[2]
            rectangle_top = rectangle[1] + rectangle[3]
            used_right = used[0] + used[2]
            used_top = used[1] + used[3]
            if used[0] > rectangle[0] + _RECEIVER_RECTANGLE_EPSILON:
                split.append((
                    rectangle[0], rectangle[1],
                    used[0] - rectangle[0], rectangle[3],
                ))
            if used_right < rectangle_right - _RECEIVER_RECTANGLE_EPSILON:
                split.append((
                    used_right, rectangle[1],
                    rectangle_right - used_right, rectangle[3],
                ))
            if used[1] > rectangle[1] + _RECEIVER_RECTANGLE_EPSILON:
                split.append((
                    rectangle[0], rectangle[1],
                    rectangle[2], used[1] - rectangle[1],
                ))
            if used_top < rectangle_top - _RECEIVER_RECTANGLE_EPSILON:
                split.append((
                    rectangle[0], used_top,
                    rectangle[2], rectangle_top - used_top,
                ))
        free_rectangles = _prune_receiver_free_rectangles([
            rectangle for rectangle in split
            if (
                rectangle[2] > _RECEIVER_RECTANGLE_EPSILON
                and rectangle[3] > _RECEIVER_RECTANGLE_EPSILON
            )
        ])
    return placements


def _ordered_receiver_rectangles(rectangles, mode: str):
    if mode == "area":
        key = lambda item: (-item[1] * item[2], -max(item[1], item[2]), item[0])
    elif mode == "max-side":
        key = lambda item: (-max(item[1], item[2]), -item[1] * item[2], item[0])
    elif mode == "height":
        key = lambda item: (-item[2], -item[1], item[0])
    elif mode == "width":
        key = lambda item: (-item[1], -item[2], item[0])
    elif mode == "perimeter":
        key = lambda item: (-(item[1] + item[2]), -item[1] * item[2], item[0])
    elif mode == "aspect":
        key = lambda item: (
            -max(item[1] / item[2], item[2] / item[1]),
            -item[1] * item[2], item[0],
        )
    else:
        raise ValueError(f"unsupported receiver rectangle ordering {mode!r}")
    return sorted(rectangles, key=key)


def allocate_receiver_rectangles(
        rectangles, *, edge_gutter: float,
        receiver_gutter: float) -> dict:
    """Allocate receiver bounds with one uniform, fixed-orientation scale.

    ``rectangles`` contains ``(stable_name, width, height)`` tuples after each
    receiver's charts have been packed locally. MaxRects owns only the outer
    placement. It never rotates a receiver, changes its local UVs, or assigns
    independent scales, so surface/camera/artist density ratios remain exact.

    A receiver cell carries one trailing full gutter on both axes. Packing the
    cells in a bin enlarged by that same gutter makes the first/last real UV
    bounds land exactly on ``edge_gutter`` while every pair of real receiver
    bounds remains at least ``receiver_gutter`` apart. The caller still runs
    :func:`validate_receiver_group_spacing` after float32 UV storage.
    """
    edge = float(edge_gutter)
    gutter = float(receiver_gutter)
    if (
        not math.isfinite(edge) or edge < 0.0
        or not math.isfinite(gutter) or gutter < 0.0
    ):
        raise ValueError(
            "receiver rectangle gutters must be finite and non-negative"
        )
    normalized = []
    names = set()
    for name, width, height in rectangles:
        stable_name = str(name)
        resolved_width = float(width)
        resolved_height = float(height)
        if stable_name in names:
            raise ValueError(
                f"receiver rectangle names must be unique: {stable_name!r}"
            )
        if (
            not math.isfinite(resolved_width) or resolved_width <= 0.0
            or not math.isfinite(resolved_height) or resolved_height <= 0.0
        ):
            raise ValueError(
                f"{stable_name}: receiver rectangle dimensions must be finite "
                f"and positive, got {resolved_width} x {resolved_height}"
            )
        names.add(stable_name)
        normalized.append((stable_name, resolved_width, resolved_height))
    if not normalized:
        return {"scale": 1.0, "placements": {}, "ordering": None, "scoring": None}

    # The last cell's trailing gutter is outside the real receiver bounds and
    # can occupy the otherwise unused strip beyond the opposite edge gutter.
    side = 1.0 - 2.0 * edge + gutter
    if side <= 0.0:
        raise RuntimeError(
            "receiver atlas edge gutters leave no allocatable rectangle area"
        )
    ordered = {
        mode: _ordered_receiver_rectangles(normalized, mode)
        for mode in _RECEIVER_RECTANGLE_ORDERINGS
    }

    def attempt(scale: float):
        for mode in _RECEIVER_RECTANGLE_ORDERINGS:
            items = [
                (name, width * scale + gutter, height * scale + gutter)
                for name, width, height in ordered[mode]
            ]
            for scoring in _RECEIVER_RECTANGLE_SCORINGS:
                placements = _maxrects_receiver_attempt(items, side, scoring)
                if placements is not None:
                    return mode, scoring, placements
        return None

    zero = attempt(0.0)
    if zero is None:
        raise RuntimeError(
            f"{len(normalized)} receiver ownership gutters cannot fit in the "
            "atlas even at zero UV scale; increase Resolution, reduce Padding, "
            "or split the receivers across atlases"
        )

    low = 0.0
    low_result = zero
    high = 1.0
    while True:
        high_result = attempt(high)
        if high_result is None:
            break
        low = high
        low_result = high_result
        high *= 2.0
        if high > 1048576.0:
            raise RuntimeError(
                "receiver rectangle allocator could not establish a finite "
                "upper scale bound"
            )
    for _iteration in range(48):
        middle = (low + high) / 2.0
        middle_result = attempt(middle)
        if middle_result is None:
            high = middle
        else:
            low = middle
            low_result = middle_result

    # Leave sub-float32 headroom at a heuristic fit boundary. The explicit
    # pixel validator remains authoritative after Blender stores the UVs.
    scale = low * (1.0 - 1e-10)
    final_result = attempt(scale)
    if final_result is None:
        scale = low
        final_result = low_result
    mode, scoring, padded = final_result
    source = {name: (width, height) for name, width, height in normalized}
    placements = {}
    for name, cell in padded.items():
        width, height = source[name]
        minimum_u = edge + cell[0]
        minimum_v = edge + cell[1]
        placements[name] = (
            minimum_u,
            minimum_v,
            minimum_u + width * scale,
            minimum_v + height * scale,
        )

    epsilon = 2e-10
    for name, bounds in placements.items():
        if min(
            bounds[0], bounds[1], 1.0 - bounds[2], 1.0 - bounds[3],
        ) + epsilon < edge:
            raise RuntimeError(
                f"{name}: receiver rectangle allocator violated its edge gutter"
            )
    placement_items = sorted(placements.items())
    for index, (left_name, left) in enumerate(placement_items):
        for right_name, right in placement_items[index + 1:]:
            delta_u = max(left[0] - right[2], right[0] - left[2], 0.0)
            delta_v = max(left[1] - right[3], right[1] - left[3], 0.0)
            if math.hypot(delta_u, delta_v) + epsilon < gutter:
                raise RuntimeError(
                    "receiver rectangle allocator violated its ownership "
                    f"gutter between {left_name} and {right_name}"
                )
    return {
        "scale": scale,
        "placements": placements,
        "ordering": mode,
        "scoring": scoring,
    }


def _uv_bounds_tuple_distance(left, right) -> float:
    dx = max(left[0] - right[2], right[0] - left[2], 0.0)
    dy = max(left[1] - right[3], right[1] - left[3], 0.0)
    return math.hypot(dx, dy)
