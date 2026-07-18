# SPDX-License-Identifier: GPL-3.0-or-later
"""Viewport overlay: draw what blendlink sees.

Collider proxies as green wireframes, sockets as RGB axes, hotspots and audio
anchors as colored crosses with labels. Unit-primitive batches are built once
and re-drawn per object through gpu.matrix — never rebuilt per frame.
"""
from __future__ import annotations

import math

import blf
import bpy
import gpu
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader

from . import prefs, validation

_handles = {"view": None, "pixel": None}
_batches = {}


def _unit_cube():
    corners = [
        (x, y, z)
        for x in (-0.5, 0.5)
        for y in (-0.5, 0.5)
        for z in (-0.5, 0.5)
    ]
    edges = [
        (0, 1), (2, 3), (4, 5), (6, 7),
        (0, 2), (1, 3), (4, 6), (5, 7),
        (0, 4), (1, 5), (2, 6), (3, 7),
    ]
    return corners, edges


def _unit_sphere(segments: int = 32):
    coords = []
    indices = []
    for axis in range(3):
        start = len(coords)
        for step in range(segments):
            angle = step / segments * math.tau
            cos_a, sin_a = 0.5 * math.cos(angle), 0.5 * math.sin(angle)
            if axis == 0:
                coords.append((0.0, cos_a, sin_a))
            elif axis == 1:
                coords.append((cos_a, 0.0, sin_a))
            else:
                coords.append((cos_a, sin_a, 0.0))
        indices.extend(
            (start + step, start + (step + 1) % segments) for step in range(segments)
        )
    return coords, indices


def _cross():
    s = 0.5
    coords = [(-s, 0, 0), (s, 0, 0), (0, -s, 0), (0, s, 0), (0, 0, -s), (0, 0, s)]
    indices = [(0, 1), (2, 3), (4, 5)]
    return coords, indices


def _axes():
    """Per-axis colored lines for sockets (X red, Y green, Z blue)."""
    coords = [(0, 0, 0), (1, 0, 0), (0, 0, 0), (0, 1, 0), (0, 0, 0), (0, 0, 1)]
    colors = [
        (0.95, 0.25, 0.30, 1.0), (0.95, 0.25, 0.30, 1.0),
        (0.35, 0.85, 0.30, 1.0), (0.35, 0.85, 0.30, 1.0),
        (0.25, 0.45, 0.95, 1.0), (0.25, 0.45, 0.95, 1.0),
    ]
    return coords, colors


def _ensure_batches():
    if _batches:
        return
    uniform = gpu.shader.from_builtin("POLYLINE_UNIFORM_COLOR")
    flat = gpu.shader.from_builtin("POLYLINE_FLAT_COLOR")
    for name, (coords, indices) in (
        ("box", _unit_cube()),
        ("sphere", _unit_sphere()),
        ("cross", _cross()),
    ):
        _batches[name] = batch_for_shader(uniform, "LINES", {"pos": coords}, indices=indices)
    axes_coords, axes_colors = _axes()
    _batches["axes"] = batch_for_shader(
        flat, "LINES", {"pos": axes_coords, "color": axes_colors},
    )
    _batches["shader_uniform"] = uniform
    _batches["shader_flat"] = flat


def _overlay_enabled(context) -> bool:
    space = context.space_data
    if space is None or space.type != "VIEW_3D" or not space.overlay.show_overlays:
        return False
    settings = getattr(context.window_manager, "blendlink", None)
    return bool(settings and settings.show_overlay)


def _draw_view():
    context = bpy.context
    if not _overlay_enabled(context):
        return
    items = validation.result().overlay
    if not items:
        return
    _ensure_batches()
    preferences = prefs.get_prefs()
    xray = bool(preferences and preferences.overlay_xray)

    gpu.state.blend_set("ALPHA")
    gpu.state.depth_test_set("NONE" if xray else "LESS_EQUAL")
    gpu.state.depth_mask_set(False)
    viewport = gpu.state.viewport_get()
    viewport_size = (viewport[2], viewport[3])

    uniform = _batches["shader_uniform"]
    flat = _batches["shader_flat"]
    for item in items:
        with gpu.matrix.push_pop():
            gpu.matrix.multiply_matrix(item.matrix)
            if item.shape == "axes":
                flat.bind()
                flat.uniform_float("viewportSize", viewport_size)
                flat.uniform_float("lineWidth", 2.0)
                _batches["axes"].draw(flat)
            else:
                uniform.bind()
                uniform.uniform_float("viewportSize", viewport_size)
                uniform.uniform_float("lineWidth", 2.0)
                uniform.uniform_float("color", item.color)
                _batches[item.shape].draw(uniform)

    gpu.state.depth_test_set("NONE")
    gpu.state.depth_mask_set(True)
    gpu.state.blend_set("NONE")


def _draw_pixel():
    context = bpy.context
    if not _overlay_enabled(context):
        return
    region = context.region
    rv3d = context.region_data
    if region is None or rv3d is None:
        return
    font_id = 0
    blf.size(font_id, 11.0)
    for item in validation.result().overlay:
        if not item.label:
            continue
        world = item.matrix.translation
        screen = view3d_utils.location_3d_to_region_2d(region, rv3d, world)
        if screen is None:
            continue
        blf.position(font_id, screen.x + 8.0, screen.y + 4.0, 0.0)
        blf.color(font_id, *item.color)
        blf.draw(font_id, item.label)


def register():
    if bpy.app.background:
        return
    _handles["view"] = bpy.types.SpaceView3D.draw_handler_add(
        _draw_view, (), "WINDOW", "POST_VIEW",
    )
    _handles["pixel"] = bpy.types.SpaceView3D.draw_handler_add(
        _draw_pixel, (), "WINDOW", "POST_PIXEL",
    )


def unregister():
    for key, region_type in (("view", "WINDOW"), ("pixel", "WINDOW")):
        if _handles[key] is not None:
            bpy.types.SpaceView3D.draw_handler_remove(_handles[key], region_type)
            _handles[key] = None
    _batches.clear()
