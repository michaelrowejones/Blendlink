# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded EEVEE primary Camera Data; raw scalar precision is not inferred."""
import math
import bpy
from mathutils import Vector
if __package__:
    from .geometry_ir import primary_context
else:
    from geometry_ir import primary_context

OUTPUTS = {'View Vector': 'view-vector', 'View Z Depth': 'z-depth', 'View Distance': 'distance'}
MODEL = 'eevee-primary-camera-v1'


def emit_camera_data(node, socket, *, engine, refuse):
    if engine != 'EEVEE':
        refuse('Camera Data live programs currently require EEVEE; use an intentional source material/appearance capture for Cycles')
    if bpy.app.version not in {(4, 2, 0), (5, 2, 0), (5, 3, 0)}:
        refuse('Camera Data has no verified shader model for this Blender version')
    if socket.identifier not in OUTPUTS:
        refuse('Camera Data has no verified output ' + socket.identifier)
    if socket.identifier != 'View Vector':
        refuse('Camera Data ' + socket.identifier + ' currently lacks a verified raw-unit clip/interpolant precision contract; use View Vector or choose an intentional source capture')
    return {"op": "camera_data_native", 'model': MODEL, 'sourceEngine': engine,
            'sourceVersion': list(bpy.app.version), 'output': OUTPUTS[socket.identifier],
            'camera': primary_context('camera', engine)}


def required(value):
    if isinstance(value, dict):
        return value.get('op') == 'camera_data_native' or any(
            required(child) for key, child in value.items()
            if not (value.get('op') == 'tex_image' and key == 'pixels'))
    return isinstance(value, (list, tuple)) and any(required(child) for child in value)


def validate_owner(obj):
    graph = bpy.context.evaluated_depsgraph_get()
    owner = obj.evaluated_get(graph)
    local = [Vector(point) for point in owner.bound_box]
    staging = [abs(owner.matrix_world[row][3]) + sum(
        abs(owner.matrix_world[row][axis]) * max(abs(point[axis]) for point in local)
        for axis in range(3)) for row in range(3)]
    if any(not math.isfinite(value) or value > 128 for value in staging):
        raise ValueError('Camera Data requires object-to-world absolute position staging at most 128 units; apply/recenter distant geometry or choose source capture')
    corners = [owner.matrix_world @ point for point in local]
    if len(corners) != 8 or any(not math.isfinite(value) or abs(value) > 64
                               for point in corners for value in point):
        raise ValueError('Camera Data requires actual world mesh bounds within +/-64 units; reduce scene scale or choose source capture')
    camera = bpy.context.scene.camera
    if camera is None:
        return  # The active web camera is independently checked on every draw.
    data = camera.data
    animation = data.animation_data
    if animation and (animation.action or animation.drivers or any(track.strips for track in animation.nla_tracks)):
        raise ValueError('Camera Data has no verified animated camera-data/projection binding; keep lens/projection settings static')
    position = camera.evaluated_get(graph).matrix_world.translation
    if any(not math.isfinite(value) or abs(value) > 64 for value in position):
        raise ValueError('Camera Data requires camera translation within +/-64 world units')
    lower = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    upper = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    distance = math.sqrt(sum(max(lower[axis] - position[axis], 0,
                                 position[axis] - upper[axis]) ** 2 for axis in range(3)))
    if distance < 1:
        raise ValueError('Camera Data requires the active camera at least 1 world unit from the mesh bounding box; move the camera back or choose source capture')
    if bpy.context.scene.render.pixel_aspect_x != 1 or bpy.context.scene.render.pixel_aspect_y != 1:
        raise ValueError('Camera Data currently requires square source render pixels')
    render = bpy.context.scene.render
    if render.use_multiview:
        raise ValueError('Camera Data currently requires a single primary source camera view')
    width = int(render.resolution_x * render.resolution_percentage / 100)
    height = int(render.resolution_y * render.resolution_percentage / 100)
    frame = list(data.view_frame(scene=bpy.context.scene))
    if data.type == 'PERSP':
        frame = [point / abs(point.z) for point in frame]
    footprint = max((max(point.x for point in frame) - min(point.x for point in frame)) / width,
                    (max(point.y for point in frame) - min(point.y for point in frame)) / height)
    if data.type == 'ORTHO':
        footprint /= distance
    if not math.isfinite(footprint) or footprint > 1 / 256:
        raise ValueError('Camera Data angular footprint is unproven: use a narrower field of view, reduce orthographic scale/move back, or enlarge the render/preview viewport')
