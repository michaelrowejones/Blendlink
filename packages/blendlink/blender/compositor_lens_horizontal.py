# SPDX-License-Identifier: GPL-3.0-or-later
"""Candidate bounded native 5.3 CPU horizontal Lens Distortion slice."""
import math
import platform
import struct
import sys
import bpy
if __package__:
    from .compositor_white_noise import _static, WhiteNoiseUnsupported
else:
    from compositor_white_noise import _static, WhiteNoiseUnsupported

MODEL = 'native-lens-horizontal-cpu-53-v1'
PROFILE = 'darwin-arm64-53-lens-horizontal-cpu-v1'
MAX_PIXELS = 4194304
DISPERSION_WORD = 0x3E4CCCCD  # Classroom's actual native float32 .2 input.

class LensHorizontalUnsupported(ValueError):
    pass

def word(value):
    return struct.unpack('=I', struct.pack('=f', value))[0]

def signature(node, scene):
    r = scene.render
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'
            or r.compositor_device != 'CPU'):
        raise LensHorizontalUnsupported('Horizontal Lens Distortion needs the pinned Blender 5.3 macOS arm64 CPU compositor profile')
    names = ['Image', 'Type', 'Distortion', 'Dispersion', 'Jitter', 'Fit']
    if (node.bl_idname != 'CompositorNodeLensdist' or node.mute
            or [s.identifier for s in node.inputs] != names):
        raise LensHorizontalUnsupported('Horizontal Lens Distortion needs its exact unmuted native 5.3 socket schema')
    try:
        _static(node)
    except WhiteNoiseUnsupported as error:
        raise LensHorizontalUnsupported(str(error)) from error
    width = r.resolution_x * r.resolution_percentage // 100
    height = r.resolution_y * r.resolution_percentage // 100
    if (not r.use_compositing or r.use_border or r.use_crop_to_border
            or r.pixel_aspect_x != 1 or r.pixel_aspect_y != 1
            or r.compositor_precision not in {'AUTO', 'FULL'}
            or not (4 <= width <= 8192 and 4 <= height <= 8192)
            or width * height > MAX_PIXELS):
        raise LensHorizontalUnsupported('Horizontal Lens Distortion needs a square-pixel zero-offset full frame, extents 4..8192 and at most 4194304 pixels')
    controls = []
    for name in names[1:]:
        s = node.inputs[name]
        if s.is_linked:
            raise LensHorizontalUnsupported('Horizontal Lens Distortion controls must be actual unlinked native literals')
        controls.append(s.default_value if name in {'Type', 'Jitter', 'Fit'} else word(s.default_value))
    if controls != ['Horizontal', 0, DISPERSION_WORD, False, False]:
        raise LensHorizontalUnsupported('Horizontal Lens Distortion currently needs Type Horizontal, raw +0 Distortion, native .2 Dispersion and false Jitter/Fit')
    if node.inputs['Image'].type != 'RGBA' or not node.inputs['Image'].is_linked:
        raise LensHorizontalUnsupported('Horizontal Lens Distortion needs a linked direct Render Layers Image')
    links = tuple((link.from_node.as_pointer(), link.from_socket.as_pointer(), link.is_valid,
                   getattr(link, 'is_muted', False)) for link in node.inputs['Image'].links)
    return (node.as_pointer(), node.id_data.as_pointer(), tuple(controls),
            (scene.as_pointer(), scene.frame_current, scene.frame_subframe, width, height,
             r.compositor_precision, r.engine, scene.compositing_node_group.as_pointer()), links)

def normalize(node, socket, op, scene, read, ops, fail):
    try:
        snapshot = signature(node, scene)
        if socket.identifier != 'Image' or socket.type != 'RGBA':
            raise LensHorizontalUnsupported('Horizontal Lens Distortion needs the original native Image output')
        image = read(node.inputs['Image'])
        upstream = next((item for item in ops if item['id'] == image.get('node')), {})
        if (image.get('kind') != 'ref' or image.get('type') != 'RGBA'
                or upstream.get('kind') != 'render-pass'
                or upstream.get('source', {}).get('nodeType') != 'CompositorNodeRLayers'
                or upstream.get('source', {}).get('output') != 'Image'):
            raise LensHorizontalUnsupported('Horizontal Lens Distortion currently needs direct Render Layers Image; computed/finite/transformed producers remain unqualified')
        op['inputs']['Image'] = {'name': 'Image', 'socketType': 'RGBA', 'value': image}
        op['properties'].update(lens_horizontal_model=MODEL, lens_horizontal_profile=PROFILE,
            lens_horizontal_version=[5, 3, 0], lens_horizontal_build=bpy.app.build_hash.decode(),
            lens_horizontal_type='Horizontal', lens_horizontal_controls=list(snapshot[2]),
            lens_horizontal_dispersion=struct.unpack('=f', struct.pack('=I', DISPERSION_WORD))[0],
            lens_horizontal_export_extent=list(snapshot[3][3:5]),
            lens_horizontal_requested_precision=snapshot[3][5], lens_horizontal_max_pixels=MAX_PIXELS)
        return snapshot
    except LensHorizontalUnsupported as error:
        fail(socket, str(error))

def check(node, scene, before):
    if signature(node, scene) != before:
        raise LensHorizontalUnsupported('Horizontal Lens Distortion source/context changed during extraction')

def validate_graph(program):
    fields = [op for op in program['ops'] if op.get('source', {}).get('nodeType') == 'CompositorNodeLensdist']
    if not fields:
        return None
    op = fields[0]
    if (len(fields) != 1 or program.get('output') != {'kind': 'ref', 'node': op['id'], 'type': 'RGBA'}
            or len(program['ops']) != 2
            or any(other is not op and other['kind'] != 'render-pass' for other in program['ops'])):
        return op, 'Horizontal Lens Distortion currently needs one terminal node with a direct Render Layers Image; downstream/computed graphs remain unqualified'
    return None
