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


FIELD_PROFILE = 'darwin-arm64-compositor-texture-field-v1'
FIELD_DEFAULT = 'implicit-uniform-full-frame-v1'
FIELD_LINKED = 'linked-render-layer-float2-v1'
SPATIAL = {'translate','image-affine','image-input','image-crop','alpha-crop','image-split','pixelate','blur','filter','glare'}

def coordinate_field(ref, operations):
    if not isinstance(ref, dict) or ref.get('kind') != 'convert' or ref.get('fromType') != 'FLOAT_VECTOR2' or ref.get('type') != 'VECTOR': return None
    source = ref.get('input', {})
    if source.get('kind') != 'ref' or source.get('type') != 'FLOAT_VECTOR2' or len(operations) > 2048: return None
    matches = [op for op in operations if op.get('id') == source.get('node')]
    if len(matches) != 1: return None
    op = matches[0];p = op.get('properties', {});output = op.get('source', {}).get('output')
    if (op.get('kind') != 'image-coordinates' or op.get('type') != 'FLOAT_VECTOR2'
            or op.get('source', {}).get('nodeType') != 'CompositorNodeImageCoordinates' or output not in {'Uniform','Normalized'}
            or p.get('image_coordinates_model') != 'render-layer-float2-v1' or p.get('image_coordinates_source_profile') != 'darwin-arm64-53-float2-v1'
            or p.get('image_coordinates_native_version') != [5,3,0] or p.get('image_coordinates_reference_model') != 'full-frame-render-layer-v1'): return None
    return output

def validate_texture_field_graph(program):
    fields = [op for op in program['ops'] if op.get('properties', {}).get('procedural_texture_coordinate_model') in {FIELD_DEFAULT, FIELD_LINKED}]
    if fields and any(op['kind'] in SPATIAL for op in program['ops']):
        return fields[0], 'Procedural Texture fields currently qualify pointwise full-frame consumers only; spatial/neighborhood domains remain unqualified'
    return None

def require_texture_field_domain(scene, socket, op, fail):
    if (scene.render.use_border or scene.render.use_crop_to_border or scene.render.pixel_aspect_x != 1 or scene.render.pixel_aspect_y != 1):
        fail(socket, 'Procedural Texture fields require full-frame display coordinates without borders or non-square pixels')
    width = scene.render.resolution_x * scene.render.resolution_percentage // 100
    height = scene.render.resolution_y * scene.render.resolution_percentage // 100
    if not (4 <= width <= 8192 and 4 <= height <= 8192):
        fail(socket, 'Procedural Texture fields require physical full-frame render extents in [4,8192]')
    if op['properties'].get('evaluation_device') == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
        fail(socket, 'Procedural Texture field GPU source requires the measured native Metal shader stage')
    op['properties']['procedural_texture_field_profile'] = FIELD_PROFILE

def easing_field_admitted(width, height, output):
    # Native and browser coordinate error plus correctly rounded native division.
    rmax = 1 - 0.5 / width if output == 'Normalized' else (width - 1) / max(width, height)
    upper = min(1.0, rmax + 2**-22 + 2**-24)
    # t=r*r; 3*t; 2*t*r; subtraction: <=7u absolute on [0,1].
    # Eight u leaves a conservative cushion for rounding in this admission test.
    return 1 - upper * upper * (3 - 2 * upper) > 8 * 2**-24

def checker_field_admitted(width, height, output, scale):
    """Conservative rational phase margin, never a repaired branch output."""
    if scale == 0: return True
    epsilon, shrink = 0.0000009999999974752427, 0.9999989867210388
    maximum = max(width, height)
    for dimension in [width, height]:
        for pixel in range(dimension):
            coordinate = (pixel + 0.5) / dimension if output == 'Normalized' else (2 * pixel + 1 - dimension) / maximum
            # Four ulps enclose the native rounded coordinate plus the shared
            # field's predeclared <=2ulp/2^-22 error, including exponent edges.
            coordinate_error = 0 if coordinate == 0 else min(2**(math.floor(math.log2(abs(coordinate)))-21), 2**-22 + 2**-24)
            phase = (coordinate * scale + epsilon) * shrink
            budget = coordinate_error * scale * shrink + 8 * 2**-24 * (abs(coordinate * scale) + epsilon) * shrink + 2**-38
            if math.floor(phase - budget) != math.floor(phase + budget): return False
    return True

def normalize_procedural_texture(node, socket, op, read, operations, fail, scene=None):
    if (tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3'
            or sys.platform != 'darwin' or platform.machine() != 'arm64'):
        fail(socket, 'Procedural Texture requires the measured Blender 5.3.0 macOS arm64 compositor profile')
    output = socket.identifier
    if output not in {'Color', 'Fac'} or socket.type != ('RGBA' if output == 'Color' else 'VALUE'):
        fail(socket, 'Procedural Texture requires its native Color/Fac schema')
    mapping = node.texture_mapping
    if (list(mapping.translation) != [0, 0, 0] or list(mapping.rotation) != [0, 0, 0]
            or list(mapping.scale) != [1, 1, 1] or mapping.use_min or mapping.use_max):
        fail(socket, 'Procedural Texture requires identity texture mapping without min/max clipping')
    if op['properties'].get('evaluation_device') not in {'CPU', 'GPU'} or op['properties'].get('single_value_device') != 'CPU':
        fail(socket, 'Procedural Texture requires the measured modern compositor CPU/GPU evaluation stage')
    default = not node.inputs['Vector'].is_linked
    incoming = None if default else read(node.inputs['Vector'])
    field = 'Uniform' if default else coordinate_field(incoming, operations)
    if field:
        if scene is None: fail(socket, 'Procedural Texture field needs its native scene display-domain context')
        require_texture_field_domain(scene, socket, op, fail)
        op['properties'].update(procedural_texture_coordinate_model=FIELD_DEFAULT if default else FIELD_LINKED, procedural_texture_coordinate_output=field)
    if not default and incoming.get('type') != 'VECTOR':
        fail(node.inputs['Vector'], 'Procedural Texture requires a typed Vector input')
    vector = None if field else literal(incoming, operations, 'VECTOR')
    if node.bl_idname == 'ShaderNodeTexGradient':
        mode = node.gradient_type
        if field and mode == 'EASING':
            width = scene.render.resolution_x * scene.render.resolution_percentage // 100
            height = scene.render.resolution_y * scene.render.resolution_percentage // 100
            if not easing_field_admitted(width, height, field): fail(socket, 'Procedural Texture Easing field needs more separation from the native one endpoint at this extent; choose Linear/Quadratic or a smaller X extent')
        if field == 'Uniform' and mode == 'DIAGONAL':
            maximum = max(scene.render.resolution_x * scene.render.resolution_percentage // 100, scene.render.resolution_y * scene.render.resolution_percentage // 100)
            if maximum & (maximum - 1): fail(socket, 'Procedural Texture Uniform Diagonal field requires a power-of-two maximum physical extent to preserve native exact zero cancellation')
        if mode not in GRADIENT_MODES:
            fail(socket, 'Procedural Texture Gradient radial/sphere kernels require separate precision qualification')
        if vector is None and not field:
            fail(socket, 'Procedural Texture Gradient currently requires bounded literal/Value/group vectors; general fields need a separate signed-zero/subnormal contract')
        if not field and mode != 'LINEAR' and any(x * 16 != int(x * 16) for x in vector):
            fail(socket, 'Procedural Texture nonlinear/diagonal Gradient requires exact sixteenth-grid literal coordinates')
        op['properties']['gradient_type'] = mode
    elif node.bl_idname == 'ShaderNodeTexChecker':
        scale = read(node.inputs['Scale'])
        scale_value = literal(scale, operations, 'VALUE')
        if ((not field and (vector is None or any(x * 16 != int(x * 16) or abs(x) > 16 for x in vector)))
                or scale_value is None or not 0 <= scale_value <= 256 or scale_value != int(scale_value)):
            fail(socket, 'Procedural Texture Checker requires sixteenth-grid literal vectors within +/-16 and fixed integer Scale 0..256')
        if field:
            width = scene.render.resolution_x * scene.render.resolution_percentage // 100
            height = scene.render.resolution_y * scene.render.resolution_percentage // 100
            if not checker_field_admitted(width, height, field, scale_value):
                fail(socket, 'Procedural Texture Checker field is too close to a native floor boundary at this extent; choose another integer Scale or render extent')
        op['inputs']['Scale'] = {'name': 'Scale', 'socketType': 'VALUE', 'value': scale}
        if output == 'Color':
            for key in ['Color1', 'Color2']:
                ref = read(node.inputs[key])
                if literal(ref, operations, 'RGBA') is None:
                    fail(node.inputs[key], 'Procedural Texture Checker Color inputs require finite bounded exact Float32 literal/group colors')
                op['inputs'][key] = {'name': key, 'socketType': 'RGBA', 'value': ref}
    else:
        fail(socket, 'Procedural Texture has no verified native node kind')
    if not default: op['inputs']['Vector'] = {'name': 'Vector', 'socketType': 'VECTOR', 'value': incoming}
    op['properties'].update(procedural_texture_model=MODEL, procedural_texture_profile=PROFILE,
                            procedural_texture_version=list(bpy.app.version), texture_mapping_model='identity-v1')
