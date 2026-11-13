# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured modern compositor Gradient/Checker contracts, separate from EEVEE."""
import math
import platform
import struct
import sys

import bpy

MODEL = 'native-compositor-texture-v1'
PROFILE = 'darwin-arm64-compositor-texture-v1'
GRADIENT_MODES = {'LINEAR', 'QUADRATIC', 'EASING', 'DIAGONAL'}


def finite_word(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and (value != 0 or math.copysign(1, value) > 0) and abs(value) <= 2**16
            and (value == 0 or abs(value) >= 2**-125)
            and struct.unpack('<f', struct.pack('<f', value))[0] == value)


def literal(ref, operations, wanted):
    if len(operations) > 2048:
        return None
    by_id = {}
    for operation in operations:
        key = operation.get('id')
        if not isinstance(key, str) or key in by_id:
            return None
        by_id[key] = operation
    budget = 64

    def resolve(value, kind, depth=0):
        nonlocal budget
        budget -= 1
        if budget < 0 or depth > 8 or not isinstance(value, dict) or value.get('type') != kind:
            return None
        if value.get('kind') == 'constant':
            raw = value.get('value')
        elif value.get('kind') == 'ref':
            source = by_id.get(value.get('node'))
            if not source:
                return None
            native = source.get('source', {}).get('nodeType')
            if source.get('kind') in {'value', 'rgb'} and source.get('type') == kind and source.get('inputs') == {}:
                expected = {'VECTOR': ({'FunctionNodeInputVector'}, 'Vector'), 'VALUE': ({'ShaderNodeValue', 'CompositorNodeValue'}, 'Value'), 'RGBA': ({'CompositorNodeRGB'}, 'Color')}.get(kind)
                if not expected or native not in expected[0] or source.get('source', {}).get('output') != expected[1]:
                    return None
                raw = source.get('value')
            elif kind == 'VECTOR' and source.get('kind') == 'combine-vector' and native == 'ShaderNodeCombineXYZ':
                return [resolve(source.get('inputs', {}).get(axis, {}).get('value'), 'VALUE', depth+1) for axis in 'XYZ']
            else:
                return None
        else:
            return None
        if kind == 'VALUE':
            return raw if finite_word(raw) else None
        count = {'VECTOR': 3, 'RGBA': 4}.get(kind)
        return list(raw) if isinstance(raw, (list, tuple)) and len(raw) == count and all(finite_word(x) for x in raw) else None

    answer = resolve(ref, wanted)
    return None if isinstance(answer, list) and any(x is None for x in answer) else answer


def normalize_procedural_texture(node, socket, op, read, operations, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Procedural Texture requires the measured Blender 5.3.0 macOS arm64 compositor profile')
    output = socket.identifier
    if output not in {'Color', 'Fac'} or socket.type != ('RGBA' if output == 'Color' else 'VALUE'):
        fail(socket, 'Procedural Texture requires its native Color/Fac schema')
    if not node.inputs['Vector'].is_linked:
        fail(node.inputs['Vector'], 'Procedural Texture unlinked Vector uses native Uniform Image Coordinates; this default field is not yet qualified')
    mapping = node.texture_mapping
    if (list(mapping.translation) != [0, 0, 0] or list(mapping.rotation) != [0, 0, 0]
            or list(mapping.scale) != [1, 1, 1] or mapping.use_min or mapping.use_max):
        fail(socket, 'Procedural Texture requires identity texture mapping without min/max clipping')
    if op['properties'].get('evaluation_device') not in {'CPU', 'GPU'} or op['properties'].get('single_value_device') != 'CPU':
        fail(socket, 'Procedural Texture requires the measured modern compositor CPU/GPU evaluation stage')
    incoming = read(node.inputs['Vector'])
    if incoming.get('type') != 'VECTOR':
        fail(node.inputs['Vector'], 'Procedural Texture requires a typed Vector input')
    vector = literal(incoming, operations, 'VECTOR')
    if node.bl_idname == 'ShaderNodeTexGradient':
        mode = node.gradient_type
        if mode not in GRADIENT_MODES:
            fail(socket, 'Procedural Texture Gradient radial/sphere kernels require separate precision qualification')
        if vector is None:
            fail(socket, 'Procedural Texture Gradient currently requires bounded literal/Value/group vectors; general fields need a separate signed-zero/subnormal contract')
        if mode != 'LINEAR' and any(x * 16 != int(x * 16) for x in vector):
            fail(socket, 'Procedural Texture nonlinear/diagonal Gradient requires exact sixteenth-grid literal coordinates')
        op['properties']['gradient_type'] = mode
    elif node.bl_idname == 'ShaderNodeTexChecker':
        scale = read(node.inputs['Scale'])
        scale_value = literal(scale, operations, 'VALUE')
        if (vector is None or any(x * 16 != int(x * 16) or abs(x) > 16 for x in vector)
                or scale_value is None or not 0 <= scale_value <= 256 or scale_value != int(scale_value)):
            fail(socket, 'Procedural Texture Checker requires sixteenth-grid literal vectors within +/-16 and fixed integer Scale 0..256')
        op['inputs']['Scale'] = {'name': 'Scale', 'socketType': 'VALUE', 'value': scale}
        if output == 'Color':
            for key in ['Color1', 'Color2']:
                ref = read(node.inputs[key])
                if literal(ref, operations, 'RGBA') is None:
                    fail(node.inputs[key], 'Procedural Texture Checker Color inputs require finite bounded exact Float32 literal/group colors')
                op['inputs'][key] = {'name': key, 'socketType': 'RGBA', 'value': ref}
    else:
        fail(socket, 'Procedural Texture has no verified native node kind')
    op['inputs']['Vector'] = {'name': 'Vector', 'socketType': 'VECTOR', 'value': incoming}
    op['properties'].update(procedural_texture_model=MODEL, procedural_texture_profile=PROFILE,
                            procedural_texture_version=list(bpy.app.version), texture_mapping_model='identity-v1')
