# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded native EEVEE legacy Squeeze; no guessed source backend or UV bounds."""
import math
import platform
import struct
import sys
import bpy

MODEL = 'eevee-squeeze-f32-v1'
SOURCE = 'linux-x86_64-opengl-trial-v1'
INPUT_MODEL = 'opaque-nearest-f32-data-or-literal-v1'
VERSIONS = {(5, 2, 0), (5, 3, 0)}


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


def _literal(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and abs(value) <= 16 and _f32(value) == value


def _metadata(expression, version):
    return (expression.get('op') == 'squeeze_native' and expression.get('model') == MODEL
        and expression.get('sourceEngine') == 'EEVEE' and expression.get('sourceProfile') == SOURCE
        and expression.get('inputModel') == INPUT_MODEL and expression.get('nativeGpuBackend') == 'OPENGL'
        and expression.get('nativeVersion') == list(version))


def scalar_bounds(expression, version, depth=0, work=None):
    work = {'nodes': 0, 'pixels': 0} if work is None else work
    work['nodes'] += 1
    if not isinstance(expression, dict) or depth > 8 or work['nodes'] > 64:
        return None
    if expression.get('op') == 'const_float' and _literal(expression.get('value')):
        return expression['value'], expression['value']
    if expression.get('op') == 'squeeze_native':
        return (0, 1) if valid_expression(expression, version, depth + 1, work) else None
    axis = {'x': 0, 'y': 1, 'z': 2}.get(expression.get('channel'))
    image = expression.get('input')
    if expression.get('op') != 'separate' or axis is None or not isinstance(image, dict):
        return None
    if (image.get('op') != 'tex_image' or image.get('sourceEngine') != 'EEVEE'
            or image.get('nativeGpuBackend') != 'OPENGL' or image.get('sourceImageStorage') != 'rgba32f'
            or image.get('sourceImageUploadRounding') != 'none' or image.get('interpolation') != 'Closest'
            or image.get('output') != 'color' or image.get('extension') not in {'REPEAT', 'EXTEND', 'CLIP'}
            or image.get('projection', 'flat') != 'flat'):
        return None
    vector = image.get('vector')
    if not isinstance(vector, dict) or vector.get('op') not in {'const_vec3', 'combine'}:
        return None
    if vector['op'] == 'const_vec3' and (not isinstance(vector.get('value'), list)
            or len(vector['value']) != 3 or not all(_literal(value) for value in vector['value'])):
        return None
    if vector['op'] == 'combine' and not all(isinstance(vector.get(axis), dict) and vector[axis].get('op') == 'const_float' and _literal(vector[axis].get('value')) for axis in ['x', 'y', 'z']):
        return None
    width, height, pixels = image.get('width'), image.get('height'), image.get('pixels')
    if (not all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in [width, height])
            or width * height > 1024 or not isinstance(pixels, list) or len(pixels) != width * height * 4):
        return None
    work['pixels'] += len(pixels)
    if work['pixels'] > 12288 or not all(_literal(value) for value in pixels) or any(pixels[index] != 1 for index in range(3, len(pixels), 4)):
        return None
    values = pixels[axis::4]
    if image['extension'] == 'CLIP': values = values + [0]
    return min(values), max(values)


def valid_expression(expression, version, depth=0, work=None):
    work = {'nodes': 0, 'pixels': 0} if work is None else work
    work['nodes'] += 1
    if depth > 8 or work['nodes'] > 64 or tuple(version) not in VERSIONS or not _metadata(expression, version): return False
    ranges = [scalar_bounds(expression.get(key), version, depth + 1, work) for key in ['value', 'width', 'center']]
    if any(value is None or max(map(abs, value)) > 16 for value in ranges): return False
    value, width, center = ranges
    delta = [_f32(value[0] - center[1]), _f32(value[1] - center[0])]
    return max(abs(_f32(d * w)) for d in delta for w in width) <= 24


def source_profile(refuse):
    version = tuple(bpy.app.version)
    if version == (4, 2, 0):
        refuse('Squeeze Value source attestation is N/A in Blender 4.2 background export; use verified Blender 5.2/5.3. Automatic Cycles baking cannot preserve this EEVEE node')
    if version != (5, 2, 0) or sys.platform != 'linux' or platform.machine() != 'x86_64':
        refuse('Squeeze Value has no verified live source profile for this Blender version/platform; automatic Cycles baking is not equivalent')
    import gpu
    try:
        if bpy.app.background: gpu.init()
        backend = gpu.platform.backend_type_get()
    except Exception as error:
        refuse('Squeeze Value requires actual native GPU backend attestation: ' + str(error))
    if backend != 'OPENGL' or 'llvmpipe' not in gpu.platform.renderer_get().lower():
        refuse('Squeeze Value has no verified live source precision profile for actual GPU backend ' + str(backend))
    return version


def _source_images(node, stack, walk, refuse):
    seen, visited = set(), set()
    pixel_values = 0
    for incoming in node.inputs:
        for source, _output in walk(incoming, group_stack=stack):
            visited.add(source.as_pointer() if hasattr(source, 'as_pointer') else id(source))
            if len(visited) > 64:
                refuse('Squeeze Value input inspection is limited to 64 native nodes; simplify this input graph')
            if source.bl_idname != 'ShaderNodeTexImage': continue
            image = source.image
            if image is not None and image.as_pointer() in seen: continue
            if image is not None: seen.add(image.as_pointer())
            if (image is None or image.source not in {'FILE', 'GENERATED'} or image.type != 'IMAGE'
                    or not image.is_float or image.use_half_precision or image.alpha_mode != 'STRAIGHT'
                    or image.colorspace_settings.name != 'Non-Color' or not image.colorspace_settings.is_data
                    or source.interpolation != 'Closest' or source.projection != 'FLAT'
                    or source.extension not in {'REPEAT', 'EXTEND', 'CLIP'}):
                refuse('Squeeze Value image inputs require static opaque nearest Non-Color full-float images; Half Precision, other color processing and animated image sources remain unqualified')
            if image.size[0] * image.size[1] > 1024:
                refuse('Squeeze Value nearest data images are limited to 1024 texels; larger payloads have no qualified live work/precision domain')
            pixel_values += image.size[0] * image.size[1] * 4
            if pixel_values > 12288:
                refuse('Squeeze Value input inspection is limited to 12288 native pixel values; simplify these image inputs')
            pixels = list(image.pixels)
            if not all(_literal(value) for value in pixels) or any(pixels[index] != 1 for index in range(3, len(pixels), 4)):
                refuse('Squeeze Value image inputs require actual finite opaque Float32 pixels within magnitude 16 and at most 1024 texels')


def emit_squeeze(node, output, *, scalar, refuse, evaluation_engine, stack=(), walk):
    if evaluation_engine != 'EEVEE':
        refuse('Squeeze Value live translation requires EEVEE; Cycles evaluates this node differently')
    if output.identifier != 'Value': refuse('Squeeze Value has no verified output ' + output.identifier)
    version = source_profile(refuse)
    # Reject large/native-processed images before generic IR image extraction
    # or pixel-array reconstruction. Inspection stays scoped to these inputs.
    _source_images(node, stack, walk, refuse)
    expression = {'op': 'squeeze_native', 'model': MODEL, 'sourceEngine': 'EEVEE',
        'sourceProfile': SOURCE, 'nativeVersion': list(version), 'nativeGpuBackend': 'OPENGL', 'inputModel': INPUT_MODEL,
        'value': scalar(node.inputs['Value']), 'width': scalar(node.inputs['Width']), 'center': scalar(node.inputs['Center'])}
    if not valid_expression(expression, version):
        refuse('Squeeze Value requires exact Float32 literals, direct scalar channels of qualified nearest data images with literal coordinates, or verified Squeeze outputs; inputs must stay within magnitude 16 and |(Value-Center)*Width| <=24; images are limited to 1024 texels and bounded validation work')
    return expression
