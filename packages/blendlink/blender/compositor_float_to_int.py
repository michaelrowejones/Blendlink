# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh literal-only native MF Float to Integer; no image or field inference."""
import math
import platform
import struct
import sys

import bpy

MODEL = 'native-mf-f32-int24-v1'
INPUT_MODEL = 'literal-f32-normal-or-zero-v1'
SOURCE_PROFILE = 'darwin-arm64-mf-v1'
MODES = {'ROUND', 'FLOOR', 'CEILING', 'TRUNCATE'}


def literal_float(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and abs(value) <= 2**24
            and (value == 0 or abs(value) >= 2**-126)
            and struct.unpack('<f', struct.pack('<f', value))[0] == value)


def resolve_literal(value, operations):
    if len(operations) >= 2048:
        return None
    by_id = {}
    for operation in operations:
        identifier = operation.get('id')
        if not isinstance(identifier, str) or identifier in by_id:
            return None
        by_id[identifier] = operation
    remaining = 64

    def resolve(current, depth=0):
        nonlocal remaining
        remaining -= 1
        if remaining < 0 or depth > 8 or not isinstance(current, dict) or current.get('type') != 'VALUE':
            return None
        if current.get('kind') == 'constant':
            number = current.get('value')
            return number if literal_float(number) else None
        if current.get('kind') == 'convert':
            return resolve(current.get('input'), depth + 1) if current.get('fromType') == 'VALUE' else None
        if current.get('kind') == 'ref':
            identifier = current.get('node')
            source = by_id.get(identifier) if isinstance(identifier, str) else None
            if (not source or source.get('kind') != 'value' or source.get('type') != 'VALUE' or source.get('inputs') != {}
                    or source.get('source', {}).get('nodeType') not in {'ShaderNodeValue', 'CompositorNodeValue'}
                    or source.get('source', {}).get('output') != 'Value'):
                return None
            number = source.get('value')
            return number if literal_float(number) else None
        return None

    return resolve(value)


def normalize_float_to_int(node, socket, op, input_value, operations, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Float to Integer has no verified native literal profile for this Blender version/platform')
    if (node.bl_idname != 'FunctionNodeFloatToInt' or socket.identifier != 'Integer' or socket.type != 'INT'
            or len(node.inputs) != 1 or node.inputs[0].identifier != 'Float' or node.inputs[0].type != 'VALUE'
            or [(item.identifier, item.type) for item in node.outputs] != [('Integer', 'INT')]
            or node.rounding_mode not in MODES):
        fail(socket, 'Float to Integer requires its verified Blender 5.3 scalar schema and rounding mode')
    properties = op['properties']
    if properties.get('evaluation_device') not in {'CPU', 'GPU'} or properties.get('single_value_device') != 'CPU':
        fail(socket, 'Float to Integer literal inputs require the native CPU multi-function evaluator, including single values in GPU compositing')
    incoming = input_value(node.inputs[0])
    if resolve_literal(incoming, operations) is None:
        fail(node.inputs[0], 'Float to Integer currently requires exact Float32 literal/group constants that are normal or zero with magnitude <= 2^24; fields, images, implicit color/vector conversions and asserted intervals remain unqualified')
    properties.update({'float_to_int_model': MODEL, 'float_to_int_input_model': INPUT_MODEL,
                       'float_to_int_source_profile': SOURCE_PROFILE,
                       'float_to_int_native_version': list(bpy.app.version),
                       'rounding_mode': node.rounding_mode})
    op['inputs']['Float'] = {'name': 'Float', 'socketType': 'VALUE', 'value': incoming}
