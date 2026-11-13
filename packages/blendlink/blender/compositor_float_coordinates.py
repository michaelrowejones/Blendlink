# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh two-component Uniform/Normalized float coordinates; legacy VECTOR remains float3."""
import platform
import sys

import bpy

MODEL = 'render-layer-float2-v1'
PROFILE = 'darwin-arm64-53-float2-v1'
SPATIAL = {'translate','image-affine','image-input','image-crop','alpha-crop','image-split','pixelate','blur','filter','glare'}


def normalize_float_coordinates(node, socket, op, scene, input_value, operations, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Image Coordinates float2 has no measured source profile for this build/platform')
    if (node.bl_idname != 'CompositorNodeImageCoordinates' or socket.identifier not in {'Uniform', 'Normalized'}
            or socket.type != 'VECTOR' or len(socket.default_value) != 2):
        fail(socket, 'Image Coordinates float2 qualifies only two-component Uniform/Normalized outputs')
    if (scene.render.use_border or scene.render.use_crop_to_border
            or scene.render.pixel_aspect_x != 1 or scene.render.pixel_aspect_y != 1):
        fail(socket, 'Image Coordinates float2 render borders and non-square pixels remain unqualified')
    if getattr(scene.render, 'compositor_device', 'CPU') == 'GPU' and getattr(bpy.context.preferences.system, 'gpu_backend', None) != 'METAL':
        fail(socket, 'Image Coordinates float2 GPU source requires the measured Metal backend')
    width = scene.render.resolution_x * scene.render.resolution_percentage // 100
    height = scene.render.resolution_y * scene.render.resolution_percentage // 100
    if not (1 <= width <= 8192 and 1 <= height <= 8192):
        fail(socket, 'Image Coordinates float2 needs full-frame extents in [1,8192] per axis')
    image = input_value(node.inputs['Image'])
    if len(operations) >= 2048 or image.get('kind') != 'ref' or image.get('type') != 'RGBA':
        fail(node.inputs['Image'], 'Image Coordinates float2 requires a bounded direct Render Layers Image reference')
    matches = [item for item in operations if item.get('id') == image.get('node')]
    if (len(matches) != 1 or matches[0].get('kind') != 'render-pass' or matches[0].get('type') != 'RGBA'
            or matches[0].get('source', {}).get('nodeType') != 'CompositorNodeRLayers'
            or matches[0].get('source', {}).get('output') != 'Image'
            or matches[0].get('pass', {}).get('pass') != 'Image'):
        fail(node.inputs['Image'], 'Image Coordinates float2 transformed/static/computed reference domains need separate proof')
    op['type'] = 'FLOAT_VECTOR2'
    op['properties'].update({'image_coordinates_model': MODEL, 'image_coordinates_source_profile': PROFILE,
                             'image_coordinates_native_version': list(bpy.app.version),
                             'image_coordinates_reference_model': 'full-frame-render-layer-v1'})
    op['inputs']['Image'] = {'name': 'Image', 'socketType': 'RGBA', 'value': image}

