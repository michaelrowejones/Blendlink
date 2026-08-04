# SPDX-License-Identifier: GPL-3.0-or-later
"""Viewport guides: draw what Blendlink sees and what authored choices cost.

Collider proxies as green wireframes, sockets as RGB axes, hotspots and audio
anchors as colored crosses, plus cached component ranges, reflection influence,
and shadow reach. Unit-primitive batches are built once and re-drawn per object
through gpu.matrix — never rebuilt or rediscovered per frame.
"""
from __future__ import annotations

import math

import blf
import bpy
import gpu
from bpy_extras import view3d_utils
from gpu_extras.batch import batch_for_shader

from . import prefs, presentation, validation

# Preserve handles across ``importlib.reload`` long enough for register() to
# remove the old callbacks. Reinitializing this dict would orphan them.
_handles = globals().get("_handles", {"view": None, "pixel": None})
_batches = globals().get("_batches", {})
_DRIVER_NAMESPACE_KEY = "blendlink.viewport-guide-handlers"


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


def _unit_cone(segments: int = 32):
    """Wire cone from the origin toward local -Z, with a unit-radius base."""
    coords = [(0.0, 0.0, 0.0)]
    for step in range(segments):
        angle = step / segments * math.tau
        coords.append((math.cos(angle), math.sin(angle), -1.0))
    indices = [
        (1 + step, 1 + (step + 1) % segments) for step in range(segments)
    ]
    indices.extend(
        (0, 1 + step) for step in range(0, segments, max(1, segments // 8))
    )
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
    batches = {}
    for name, (coords, indices) in (
        ("box", _unit_cube()),
        ("sphere", _unit_sphere()),
        ("cone", _unit_cone()),
        ("cross", _cross()),
    ):
        batches[name] = batch_for_shader(
            uniform, "LINES", {"pos": coords}, indices=indices,
        )
    axes_coords, axes_colors = _axes()
    batches["axes"] = batch_for_shader(
        flat, "LINES", {"pos": axes_coords, "color": axes_colors},
    )
    batches["shader_uniform"] = uniform
    batches["shader_flat"] = flat
    batches["shader_2d"] = gpu.shader.from_builtin("UNIFORM_COLOR")
    # Publish only a complete cache. A failed context initialization must not
    # leave a convincing-looking half-cache for the next frame.
    _batches.update(batches)


def _overlay_enabled(context) -> bool:
    space = context.space_data
    if space is None or space.type != "VIEW_3D" or not space.overlay.show_overlays:
        return False
    settings = getattr(context.window_manager, "blendlink", None)
    return bool(settings and settings.show_overlay)


def _resolved_matrix(item):
    resolver = getattr(item, "resolved_matrix", None)
    return resolver() if callable(resolver) else item.matrix


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
        if item.shape == "badge":
            continue
        matrix = _resolved_matrix(item)
        if matrix is None:
            continue
        with gpu.matrix.push_pop():
            gpu.matrix.multiply_matrix(matrix)
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
    _draw_composition_guides(context, region, rv3d)
    font_id = 0
    blf.size(font_id, 11.0)
    label_rows = {}
    for item in validation.result().overlay:
        if not item.label:
            continue
        matrix = _resolved_matrix(item)
        if matrix is None:
            continue
        world = matrix.translation
        screen = view3d_utils.location_3d_to_region_2d(region, rv3d, world)
        if screen is None:
            continue
        # Different consequences on the same selected object share a world
        # anchor. Stack by a small screen-space bucket so labels remain legible
        # without component-specific layout rules in the draw loop.
        bucket = (round(screen.x / 12.0), round(screen.y / 12.0))
        row = label_rows.get(bucket, 0)
        label_rows[bucket] = row + 1
        blf.position(
            font_id, screen.x + 8.0, screen.y + 4.0 + row * 15.0, 0.0,
        )
        blf.color(font_id, *item.color)
        blf.draw(font_id, item.label)


def _camera_frame_rect(context, camera):
    points = []
    for corner in camera.data.view_frame(scene=context.scene):
        world = camera.matrix_world @ corner
        screen = view3d_utils.location_3d_to_region_2d(
            context.region, context.region_data, world,
        )
        if screen is None:
            return None
        points.append(screen)
    return (
        min(point.x for point in points),
        min(point.y for point in points),
        max(point.x for point in points),
        max(point.y for point in points),
    )


def _composition_guide_state(context, region, rv3d):
    """Describe exact guides or an actionable reason they are not exact."""
    reference = getattr(context.scene, "blendlink_reference", None)
    project = getattr(context.scene, "blendlink_project", None)
    if (
        reference is None or not reference.show_composition_overlay
        or project is None or not project.configured or project.main_camera is None
        or not len(project.compositions)
    ):
        return None
    composition = project.compositions[
        min(project.composition_index, len(project.compositions) - 1)
    ]
    backing_width = round(composition.width * reference.device_pixel_ratio)
    backing_height = round(composition.height * reference.device_pixel_ratio)
    label = (
        f"{composition.name}  {composition.width}x{composition.height} CSS px  "
        f"@ {reference.device_pixel_ratio:g}x = {backing_width}x{backing_height} px"
    )
    if rv3d.view_perspective != "CAMERA":
        # The guide's own tooltip promises it appears in camera view. Drawing
        # it everywhere pinned two lines of orange text into every viewport
        # during modelling, UV work and weight painting, from the moment a
        # Website Camera existed, with no way to dismiss it but a checkbox in
        # Scene Properties.
        return None
    if context.scene.camera != project.main_camera:
        # In camera view through the WRONG camera the message is genuinely
        # about what the artist is looking at, so it stays.
        return {
            "exact": False,
            "label": label,
            "message": "Use Preview Selected Frame for the authored website camera crop",
        }
    frame_rect = _camera_frame_rect(context, project.main_camera)
    if frame_rect is None:
        return None
    render = context.scene.render
    render_aspect = (
        render.resolution_x * render.pixel_aspect_x
        / max(1e-9, render.resolution_y * render.pixel_aspect_y)
    )
    target_aspect = composition.width / max(1, composition.height)
    exact = math.isclose(render_aspect, target_aspect, rel_tol=1e-4, abs_tol=1e-4)
    if not exact:
        return {
            "exact": False,
            "label": label,
            "message": "Aspect is not applied; press Preview Selected Frame for an exact crop",
            "frame": frame_rect,
        }
    geometry = presentation.overlay_geometry(
        (0.0, 0.0, float(region.width), float(region.height)),
        frame_rect,
        float(composition.safe_margin),
    )
    return {
        "exact": True,
        "label": label,
        "message": f"Exact camera crop | page-safe inset {composition.safe_margin:.0%}",
        **geometry,
    }


def _rect_triangles(rect):
    left, bottom, right, top = rect
    return [
        (left, bottom, 0.0), (right, bottom, 0.0), (right, top, 0.0),
        (left, bottom, 0.0), (right, top, 0.0), (left, top, 0.0),
    ]


def _rect_lines(rect):
    left, bottom, right, top = rect
    return [
        (left, bottom, 0.0), (right, bottom, 0.0),
        (right, bottom, 0.0), (right, top, 0.0),
        (right, top, 0.0), (left, top, 0.0),
        (left, top, 0.0), (left, bottom, 0.0),
    ]


def _draw_screen_rect(rect, color, region, *, fill=False, width=1.5):
    _ensure_batches()
    if fill:
        shader = _batches["shader_2d"]
        batch = batch_for_shader(shader, "TRIS", {"pos": _rect_triangles(rect)})
        shader.bind()
        shader.uniform_float("color", color)
        batch.draw(shader)
        return
    shader = _batches["shader_uniform"]
    batch = batch_for_shader(shader, "LINES", {"pos": _rect_lines(rect)})
    shader.bind()
    shader.uniform_float("viewportSize", (float(region.width), float(region.height)))
    shader.uniform_float("lineWidth", width)
    shader.uniform_float("color", color)
    batch.draw(shader)


def _draw_composition_guides(context, region, rv3d):
    state = _composition_guide_state(context, region, rv3d)
    if state is None:
        return
    if state["exact"]:
        gpu.state.blend_set("ALPHA")
        for rect in state["crop"]:
            _draw_screen_rect(rect, (0.015, 0.02, 0.03, 0.72), region, fill=True)
        _draw_screen_rect(state["frame"], (0.25, 0.82, 1.0, 0.95), region, width=2.0)
        _draw_screen_rect(state["safe"], (1.0, 0.72, 0.18, 0.95), region, width=1.5)
        gpu.state.blend_set("NONE")
        text_x = max(12.0, state["frame"][0] + 10.0)
        text_y = min(region.height - 22.0, state["frame"][3] - 20.0)
        color = (0.82, 0.95, 1.0, 1.0)
    else:
        if "frame" in state:
            gpu.state.blend_set("ALPHA")
            _draw_screen_rect(state["frame"], (1.0, 0.28, 0.16, 0.95), region, width=2.0)
            gpu.state.blend_set("NONE")
        text_x, text_y = 16.0, region.height - 28.0
        color = (1.0, 0.48, 0.3, 1.0)
    font_id = 0
    blf.size(font_id, 12.0)
    blf.color(font_id, *color)
    blf.position(font_id, text_x, text_y, 0.0)
    blf.draw(font_id, state["label"])
    blf.size(font_id, 11.0)
    blf.position(font_id, text_x, text_y - 17.0, 0.0)
    blf.draw(font_id, state["message"])


def register():
    if bpy.app.background:
        return
    if (
        any(handle is not None for handle in _handles.values())
        or bpy.app.driver_namespace.get(_DRIVER_NAMESPACE_KEY)
    ):
        unregister()
    try:
        _handles["view"] = bpy.types.SpaceView3D.draw_handler_add(
            _draw_view, (), "WINDOW", "POST_VIEW",
        )
        _handles["pixel"] = bpy.types.SpaceView3D.draw_handler_add(
            _draw_pixel, (), "WINDOW", "POST_PIXEL",
        )
        # The driver namespace survives module reload. A newly imported module
        # can therefore remove callbacks owned by its predecessor.
        bpy.app.driver_namespace[_DRIVER_NAMESPACE_KEY] = dict(_handles)
    except Exception:
        unregister()
        raise


def unregister():
    stored = bpy.app.driver_namespace.pop(_DRIVER_NAMESPACE_KEY, None)
    sources = [stored, _handles] if isinstance(stored, dict) else [_handles]
    removed = set()
    errors = []
    for source in sources:
        for key, region_type in (("view", "WINDOW"), ("pixel", "WINDOW")):
            handle = source.get(key)
            if handle is None or id(handle) in removed:
                continue
            try:
                bpy.types.SpaceView3D.draw_handler_remove(handle, region_type)
            except (ReferenceError, RuntimeError, TypeError, ValueError) as error:
                errors.append(f"{key}: {type(error).__name__}: {error}")
            removed.add(id(handle))
    _handles.update(view=None, pixel=None)
    _batches.clear()
    if errors:
        print(
            "blendlink addon: viewport-guide handler cleanup could not remove "
            + "; ".join(errors)
        )
