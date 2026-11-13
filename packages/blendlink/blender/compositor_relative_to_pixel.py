# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured scalar Relative To Pixel with a domain-only image dependency."""
import math
import platform
import struct
import sys

import bpy

MODEL = 'scalar-render-size-f32-v1'
PROFILE = 'darwin-arm64-53-f32-v1'
DIMENSIONS = {'X', 'Y', 'Greater', 'Smaller'}


def _literal(value, operations):
    if not isinstance(value, dict) or value.get('type') != 'VALUE':
        return None
    if value.get('kind') == 'constant':
        number = value.get('value')
    elif value.get('kind') == 'ref':
        matches = [op for op in operations if op.get('id') == value.get('node')]
        if len(matches) != 1:
            return None
        source = matches[0]
        if (source.get('kind') != 'value' or source.get('type') != 'VALUE' or source.get('inputs') != {}
                or source.get('source', {}).get('nodeType') not in {'ShaderNodeValue', 'CompositorNodeValue'}
                or source.get('source', {}).get('output') != 'Value'):
            return None
        number = source.get('value')
    else:
        return None
    if (isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number)
            or number == 0 and math.copysign(1, number) < 0 or abs(number) > 65536 or number != 0 and abs(number) < 2**-126
            or struct.unpack('<f', struct.pack('<f', number))[0] != number):
        return None
    return number


def normalize_relative_to_pixel(node, socket, op, scene, input_value, operations, fail):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Relative To Pixel has no measured native profile for this build/platform')
    if (scene.render.use_border or scene.render.use_crop_to_border
            or scene.render.pixel_aspect_x != 1 or scene.render.pixel_aspect_y != 1):
        fail(socket, 'Relative To Pixel render borders and non-square pixel reference domains remain unqualified')
    if (node.data_type != 'FLOAT' or node.reference_dimension not in DIMENSIONS
            or socket.identifier != 'Float Value' or socket.type != 'VALUE'):
        fail(socket, 'Relative To Pixel currently requires scalar FLOAT X/Y/Greater/Smaller; vector/per-dimension/diagonal modes remain unqualified')
    image = input_value(node.inputs['Image'])
    if image.get('kind') != 'ref' or image.get('type') != 'RGBA':
        fail(node.inputs['Image'], 'Relative To Pixel currently requires a direct Render Layers Image reference, including group/reroute traversal')
    if len(operations) >= 2048:
        fail(socket, 'Relative To Pixel exceeds the bounded compositor operation budget')
    matches = [item for item in operations if item.get('id') == image.get('node')]
    if (len(matches) != 1 or matches[0].get('kind') != 'render-pass'
            or matches[0].get('source', {}).get('nodeType') != 'CompositorNodeRLayers'
            or matches[0].get('source', {}).get('output') != 'Image'
            or matches[0].get('pass', {}).get('pass') != 'Image'):
        fail(node.inputs['Image'], 'Relative To Pixel transformed, static-image or computed reference domains need separate display-size proof')
    incoming = input_value(node.inputs['Float Value'])
    if _literal(incoming, operations) is None:
        fail(node.inputs['Float Value'], 'Relative To Pixel currently requires normal-or-positive-zero exact Float32 literal/Value/group inputs (negative zero remains unqualified) with magnitude <=65536')
    op['properties'].update({'relative_to_pixel_model': MODEL, 'relative_to_pixel_reference_model': 'untransformed-render-layer-v1', 'relative_to_pixel_source_profile': PROFILE,
                             'relative_to_pixel_native_version': list(bpy.app.version),
                             'reference_dimension': node.reference_dimension, 'relative_to_pixel_image': image})
    # Image determines only reference size; native output is single if Value is single.
    # Keep it out of numeric inputs to retain downstream evaluator/domain behavior.
    op['inputs']['Value'] = {'name': 'Value', 'socketType': 'VALUE', 'value': incoming}
