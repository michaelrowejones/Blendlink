# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact-word 3D compositor Vector Math literal slice; no shader-parity inference."""
import math
import platform
import struct
import sys
import bpy

MODEL = 'native-compositor-vector-math-literals-v1'
PROFILE = 'darwin-arm64-53-vector-math-v1'
MODES = {'ADD', 'SUBTRACT', 'MULTIPLY', 'MULTIPLY_ADD', 'DIVIDE', 'SCALE', 'CROSS_PRODUCT', 'DOT_PRODUCT', 'MINIMUM', 'MAXIMUM', 'ABSOLUTE', 'FLOOR', 'CEIL', 'FRACTION', 'ROUND', 'SIGN'}
SIMPLE_MODES = {'ADD', 'SUBTRACT', 'MULTIPLY', 'SCALE', 'MINIMUM', 'MAXIMUM', 'ABSOLUTE', 'FLOOR', 'CEIL', 'FRACTION', 'ROUND', 'SIGN'}
UNARY = {'ABSOLUTE', 'FLOOR', 'CEIL', 'FRACTION', 'ROUND', 'SIGN'}


def input_names(mode):
    return ['Vector'] + ([] if mode in UNARY else ['Scale'] if mode == 'SCALE' else ['Vector_001', 'Vector_002'] if mode == 'MULTIPLY_ADD' else ['Vector_001'])


def dyadic(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) <= 16 and value * 16 == int(value * 16) and (value != 0 or math.copysign(1, value) > 0)


def normal_word(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) <= 2**16 and (value == 0 or abs(value) >= 2**-32) and (value != 0 or math.copysign(1, value) > 0) and struct.unpack('<f', struct.pack('<f', value))[0] == value


def admitted(mode, values):
    """Simple modes round one Float32 primitive per stage; compound modes stay dyadic."""
    a, b = values['Vector'], values.get('Vector_001')
    predicate = normal_word if mode in SIMPLE_MODES else dyadic
    if not all(predicate(x) for value in values.values() for x in (value if isinstance(value, list) else [value])):
        return False
    negative_zero = lambda x: x == 0 and math.copysign(1, x) < 0
    if mode == 'CEIL' and any(-1 < x < 0 for x in a): return False
    if mode in {'MULTIPLY', 'MULTIPLY_ADD', 'DOT_PRODUCT', 'CROSS_PRODUCT', 'SCALE'}:
        pairs = [(x, values['Scale']) for x in a] if mode == 'SCALE' else [(x, y) for x, y in zip(a, b)]
        if mode == 'CROSS_PRODUCT': pairs = [(a[i], b[j]) for i in range(3) for j in range(3) if i != j]
        if any(negative_zero(x*y) for x, y in pairs): return False
    if mode == 'DIVIDE':
        for x, y in zip(a, b):
            if y and (math.frexp(abs(y))[0] != .5 or negative_zero(x/y)): return False
    return True


def normalize_vector_math(node, socket, op, read, operations, fail, literal):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3' or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Vector Math requires the measured Blender 5.3 macOS arm64 source profile')
    mode = node.operation
    if mode not in MODES: fail(socket, 'Vector Math mode requires separate native precision qualification')
    output_type = 'VALUE' if mode == 'DOT_PRODUCT' else 'VECTOR'
    if socket.type != output_type or socket.identifier != ('Value' if output_type == 'VALUE' else 'Vector') or output_type == 'VECTOR' and len(socket.default_value) != 3:
        fail(socket, 'Vector Math requires the active native 3D Vector or Dot Value output schema')
    if op['properties'].get('evaluation_device') not in {'CPU', 'GPU'} or op['properties'].get('single_value_device') != 'CPU':
        fail(socket, 'Vector Math requires the measured modern CPU single-value evaluator')
    if op['properties'].get('evaluation_device') == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
        fail(socket, 'Vector Math GPU source requires the measured native Metal backend')
    values = {}
    for key in input_names(mode):
        incoming = node.inputs[key]; kind = 'VALUE' if key == 'Scale' else 'VECTOR'
        if incoming.type != kind or kind == 'VECTOR' and len(incoming.default_value) != 3:
            fail(incoming, 'Vector Math requires its native 3D typed inputs')
        ref = read(incoming)
        resolved = literal(ref, operations, kind)
        if resolved is None: fail(incoming, 'Vector Math requires bounded literal/Value/CombineXYZ/group input provenance; fields and computed expressions need separate proof')
        values[key] = resolved
        op['inputs'][key] = {'name': incoming.name, 'socketType': kind, 'value': ref}
    if not admitted(mode, values): fail(socket, 'Vector Math needs bounded normal Float32 simple-mode inputs, sixteenth-grid compound inputs, safe signed zero, and power-of-two nonzero divisors')
    op['properties'].update(vector_math_model=MODEL, vector_math_profile=PROFILE, vector_math_version=list(bpy.app.version), operation=mode)
