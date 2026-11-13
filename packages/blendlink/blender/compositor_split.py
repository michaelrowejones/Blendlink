# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed native Split controls on matching, unshifted finite input canvases."""
import ctypes
import ctypes.util
from functools import lru_cache
import math
import struct
import sys

import bpy


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


@lru_cache(maxsize=1)
def _trig():
    names = ['ucrtbase.dll'] if sys.platform == 'win32' else [None, ctypes.util.find_library('m')]
    for name in names:
        if name is None and sys.platform == 'win32': continue
        try:
            library = ctypes.CDLL(name, **({'winmode': 0x800} if sys.platform == 'win32' else {}))
            functions = [library.sinf, library.cosf]
            for function in functions:
                function.argtypes = [ctypes.c_float]; function.restype = ctypes.c_float
            return functions
        except (OSError, AttributeError): continue
    raise ValueError('Split cannot resolve the producing CPU native fixed-angle functions')


def _source_version():
    return tuple(bpy.app.version[:3])


def normalize_split(node, socket, op, scene, read, single, fail):
    if _source_version() not in {(4, 2, 0), (5, 2, 0), (5, 3, 0)}:
        fail(socket, 'Split requires a measured Blender 4.2.0, 5.2.0 or 5.3.0 source model')
    if scene.render.use_border:
        fail(socket, 'Split render-border windows require separate native canvas transport')
    device = getattr(scene.render, 'compositor_device', 'CPU')
    if device == 'GPU' and getattr(scene.render, 'compositor_precision', 'AUTO') not in {'AUTO', 'FULL'}:
        fail(socket, 'Split requires Full or final-render Automatic compositor precision')
    modern = node.inputs.get('Position') is not None
    if modern:
        if node.inputs['Position'].is_linked or node.inputs['Rotation'].is_linked:
            fail(socket, 'Split requires fixed unlinked Position and Rotation settings')
        position = list(node.inputs['Position'].default_value); rotation = float(node.inputs['Rotation'].default_value)
        if (len(position) != 2 or any(not math.isfinite(value) or not 0 <= value <= 1 or 0 < value < 2 ** -50 for value in position)
                or not math.isfinite(rotation) or abs(rotation) > _f32(math.tau)):
            fail(socket, 'Split requires normalized Position and Rotation within one full turn; extremely small nonzero parameters remain unqualified')
        sinf, cosf = _trig(); normal = [-sinf(rotation), cosf(rotation)]
        if any(not math.isfinite(value) or 0 < abs(value) < 2 ** -50 for value in normal):
            fail(socket, 'Split angle coefficients are too small for the live projection model')
        if device == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
            fail(socket, 'Split rotated GPU lines need a verified native projection model; use the CPU compositor or source baking')
        op['properties'].update(split_model='native-line-f32-v1', split_position=position, split_normal=normal,
            split_rotation=rotation)
    else:
        if node.axis not in {'X', 'Y'} or type(node.factor) is not int or not 0 <= node.factor <= 100:
            fail(socket, 'Legacy Split requires a fixed X/Y axis and percentage in [0,100]')
        op['properties'].update(split_model='legacy-cpu-axis-v1' if device == 'CPU' else 'legacy-gpu-axis-v1',
            split_axis=node.axis, split_factor=node.factor)
    for name in ('Image', 'Image_001'):
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': incoming.name, 'socketType': incoming.type, 'value': read(incoming)}
    if all(single(incoming['value']) for incoming in op['inputs'].values()):
        fail(socket, 'Split requires at least one finite image input; constant-only native canvases need a separate model')


def validate_split_domains(program):
    changed = {}
    def incoming(value):
        if value['kind'] == 'convert': return incoming(value['input'])
        return changed.get(value.get('node'), False)
    for op in program['ops']:
        inherited = any(incoming(item['value']) for item in op['inputs'].values())
        if op['kind'] == 'image-split' and inherited:
            return op, 'Split requires matching unshifted input canvases; transformed/resized windows remain unqualified'
        changed[op['id']] = inherited or op['kind'] in {'translate', 'image-affine', 'image-crop'}
    return None
