# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Float32 compositor matrix constants, without mathutils angle wrapping."""
import ctypes
import ctypes.util
from functools import lru_cache
import math
import struct
import sys


def f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


@lru_cache(maxsize=1)
def native_trigonometry():
    """AngleRadian<float> calls scalar C sin/cos, not Matrix.Rotation's wrapper."""
    # Windows LoadLibrary requires a DLL name; the POSIX process handle
    # (None) is not a valid candidate there. Use the existing system UCRT.
    names = ['ucrtbase.dll'] if sys.platform == 'win32' else [None]
    if sys.platform != 'win32':
        library = ctypes.util.find_library('m')
        if library:
            names.append(library)
    for name in names:
        try:
            library = ctypes.CDLL(name, **({'winmode': 0x800} if sys.platform == 'win32' and name else {}))
            functions = [getattr(library, symbol) for symbol in ('sinf', 'cosf')]
            for function in functions:
                function.argtypes = (ctypes.c_float,)
                function.restype = ctypes.c_float
            return tuple(functions)
        except (OSError, AttributeError):
            continue
    raise ValueError('Affine compositor transforms require native scalar C sinf/cosf')


def native_affine_matrix(angle=0.0, scale=(1.0, 1.0), translation=(0.0, 0.0)):
    """Row-major BLI from_loc_rot_scale<float3x3>, for bounded static inputs.

    Native sinf/cosf preserve the authored Float32 angle, including endpoint
    residuals. In particular, Matrix.Rotation performs a different angle wrap.
    This helper does not authorize any node, interpolation or image-window mode.
    """
    angle, sx, sy, tx, ty = map(f32, (angle, *scale, *translation))
    if not all(math.isfinite(value) for value in (angle, sx, sy, tx, ty)):
        raise ValueError('Affine compositor parameters must be finite')
    if abs(angle) > f32(math.tau) or not all(.125 <= value <= 8 for value in (sx, sy)) or max(abs(tx), abs(ty)) > 8192:
        raise ValueError('Affine compositor parameters exceed the bounded angle/scale/translation domain')
    sinf, cosf = native_trigonometry()
    sine, cosine = sinf(angle), cosf(angle)
    return [f32(cosine * sx), f32(-sine * sy), tx,
            f32(sine * sx), f32(cosine * sy), ty, 0.0, 0.0, 1.0]


def multiply_affine(a, b):
    """BLI's scalar float3x3 composition, in row-major transport order."""
    return [f32(f32(f32(a[row * 3] * b[column]) + f32(a[row * 3 + 1] * b[column + 3]))
                + f32(a[row * 3 + 2] * b[column + 6])) for row in range(3) for column in range(3)]


def is_translation_only(node, bounds):
    if node.bl_idname != 'CompositorNodeTransform':
        return False
    return all(bounds(node.inputs[name]) == (number, number) for name, number in (('Angle', 0), ('Scale', 1)))


def normalize_affine(node, op, scene, read, fail):
    if bpy_version_legacy():
        fail(node.inputs['Image'], 'Affine image transforms require the verified modern deferred-domain model; legacy immediate canvases remain unqualified')
    if scene.render.use_border:
        fail(node.inputs['Image'], 'Affine render-border/crop windows require native data/display-window transport')
    if any(node.inputs.get(name) is None for name in ('Interpolation', 'Extension X', 'Extension Y')):
        fail(node.inputs['Image'], 'Affine transforms require the verified modern sampling-menu schema')
    for name in ('Interpolation', 'Extension X', 'Extension Y'):
        if node.inputs[name].is_linked:
            fail(node.inputs[name], 'Affine sampling settings require fixed unlinked menus')
    mode = node.inputs['Interpolation'].default_value
    if mode not in ('Nearest', 'Bilinear') or any(node.inputs[name].default_value != 'Clip' for name in ('Extension X', 'Extension Y')):
        fail(node.inputs['Image'], 'Affine transforms currently require Nearest/Bilinear and Clip extension')
    import bpy
    device = getattr(scene.render, 'compositor_device', 'CPU')
    if device == 'GPU' and bpy.context.preferences.system.gpu_backend != 'METAL':
        fail(node.inputs['Image'], 'Affine GPU image sampling requires a calibrated native Metal model')

    def scalar(name):
        socket = node.inputs[name]
        if socket.is_linked:
            fail(socket, 'Affine parameters currently require fixed unlinked values')
        number = float(socket.default_value)
        if not math.isfinite(number):
            fail(socket, 'Affine parameters must be finite')
        return number

    kind = node.bl_idname
    angle, scale, translation = 0.0, (1.0, 1.0), (0.0, 0.0)
    if kind == 'CompositorNodeScale':
        socket = node.inputs.get('Type')
        if socket is None or socket.is_linked or socket.default_value != 'Relative':
            fail(socket or node.inputs['Image'], 'Scale currently requires fixed Relative sizing; absolute/render-size windows remain unqualified')
        scale = (scalar('X'), scalar('Y'))
    else:
        angle = scalar('Angle' if node.inputs.get('Angle') is not None else 'Degr')
        if kind == 'CompositorNodeTransform':
            scale = (scalar('Scale'),) * 2
            translation = (scalar('X'), scalar('Y'))
    try:
        matrix = native_affine_matrix(angle, scale, translation)
    except ValueError as error:
        fail(node.inputs['Image'], str(error))
    image = read(node.inputs['Image'])
    if image.get('type') != 'RGBA' or image.get('kind') == 'convert' and image.get('fromType') != 'RGBA':
        fail(node.inputs['Image'], 'Affine transforms currently require Color image fields')
    op['kind'] = 'image-affine'
    op['properties'].update({'image_domain_model': 'deferred-affine-f32-v1', 'image_affine_matrix': matrix,
        'image_sampling_model': 'modern-cpu-v1' if device == 'CPU' else 'modern-metal-v1', 'image_interpolation': mode,
        'affine_angle': f32(angle), 'affine_scale': [f32(value) for value in scale],
        'affine_translation': [f32(value) for value in translation]})
    op['inputs']['Image'] = {'name': 'Image', 'socketType': 'RGBA', 'value': image}


def bpy_version_legacy():
    import bpy
    return bpy.app.version < (4, 5, 0)
