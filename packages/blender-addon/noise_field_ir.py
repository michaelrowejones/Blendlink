# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh, finite nearest-image specialization; no native output is evaluated."""
import math
import struct


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


def _finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def _scalar(value):
    return isinstance(value, dict) and value.get('op') == 'const_float' and set(value) <= {'op', 'value'} and _finite(value.get('value'))


def _qualifies(ir):
    if (ir.get('op') not in {'noise_fractal', 'noise_normalized'} or ir.get('dimensions') != 4
            or ir.get('output') != 'color' or ir.get('evaluationModel') != 'shader' or ir.get('noiseType', 'FBM') != 'FBM'
            or set(ir) - {'op','normalize','output','dimensions','detail','roughness','lacunarity','scale','noiseType',
                          'evaluationModel','offsetModel','perlinModel','input','w','colorOffsets'}):
        return False
    if (not _finite(ir.get('detail')) or not 4 <= ir['detail'] <= 6
            or not _finite(ir.get('roughness')) or not 0 <= ir['roughness'] <= 1
            or not _finite(ir.get('lacunarity', 2)) or abs(ir.get('lacunarity', 2)) > 2):
        return False
    if ir['op'] == 'noise_normalized':
        if ir.get('normalize') is not True or ir.get('perlinModel') not in {'native-standard-f32','mf-periodic-f32','eevee-metal-periodic-f32'}:
            return False
    elif ir.get('normalize', False) is not False or ir.get('perlinModel', 'native-standard-f32') != 'native-standard-f32':
        return False
    image, w, scale = ir.get('input'), ir.get('w'), ir.get('scale')
    allowed = {'op','sourceEngine','sourceImageStorage','sourceImageUploadRounding','nativeGpuBackend',
               'width','height','pixels','interpolation','extension','output','projection','vector'}
    if (not isinstance(image, dict) or image.get('op') != 'tex_image' or set(image) - allowed
            or image.get('sourceImageStorage') != 'rgba32f' or image.get('sourceImageUploadRounding') != 'none'
            or image.get('output') != 'color' or image.get('interpolation') != 'Closest' or image.get('extension') != 'REPEAT'
            or image.get('projection', 'flat') != 'flat' or image.get('sourceEngine') not in {'CYCLES','EEVEE'}
            or image.get('sourceEngine') == 'EEVEE' and image.get('nativeGpuBackend') not in {'METAL','OPENGL'}
            or not _scalar(scale) or scale['value'] not in {40,80}):
        return False
    uv = image.get('vector', {})
    if uv.get('op') not in {'uv','uv_active'} or set(uv) - {'op','channel'} or uv.get('channel', 0) != 0:
        return False
    width, height, pixels = image.get('width'), image.get('height'), image.get('pixels')
    if (not isinstance(width, int) or isinstance(width, bool) or not isinstance(height, int) or isinstance(height, bool)
            or width < 1 or height < 1 or width * height > 16384 or not isinstance(pixels, list) or len(pixels) != width * height * 4):
        return False
    constant_w = _scalar(w) and abs(w['value']) <= 2 and _f32(w['value']) == w['value'] and _f32(w['value'] * scale['value']) == w['value'] * scale['value']
    if not constant_w:
        if (not isinstance(w, dict) or w.get('op') != 'math' or w.get('operation') != 'MULTIPLY_ADD'
                or set(w) - {'op','operation','a','b','c'} or not _scalar(w.get('b')) or w['b']['value'] != .5
                or not _scalar(w.get('c')) or w['c']['value'] != .125):
            return False
        channel = w.get('a', {})
        if (channel.get('op') != 'separate' or channel.get('channel') != 'y' or set(channel) - {'op','channel','input'}
                or channel.get('input') != image):
            return False
    for index, value in enumerate(pixels):
        if (not _finite(value) or abs(value) > 2 or _f32(value) != value or 0 < abs(value) < 2 ** -14
                or struct.unpack('e', struct.pack('e', value))[0] != value
                or _f32(value * scale['value']) != value * scale['value'] or index % 4 == 3 and value != 1):
            return False
    low, high = [math.inf] * 4, [-math.inf] * 4
    for index in range(0, len(pixels), 4):
        y = pixels[index + 1]
        value = w['value'] if constant_w else _f32(_f32(y * .5) + .125)
        if value != (w['value'] if constant_w else y * .5 + .125) or _f32(value * scale['value']) != value * scale['value']:
            return False
        for axis, coordinate in enumerate([*pixels[index:index + 3], value]):
            number = _f32(coordinate * scale['value'])
            low[axis], high[axis] = min(low[axis], number), max(high[axis], number)
    offsets = ir.get('colorOffsets')
    if (not isinstance(offsets, list) or len(offsets) != 2 or any(not isinstance(offset, list) or len(offset) != 4
            or any(not _finite(value) or _f32(value) != value or 0 < abs(value) < 2 ** -126 for value in offset) for offset in offsets)):
        return False
    detail = _f32(ir['detail'])
    count = math.floor(detail)
    for offset in [[0,0,0,0], *offsets]:
        start = [_f32(value + offset[axis]) for axis, value in enumerate(low)]
        end = [_f32(value + offset[axis]) for axis, value in enumerate(high)]
        frequency = 1
        for _ in range(count + (1 if detail != count else 0) + 1):
            for a, b in zip(start, end):
                values = [_f32(a * frequency), _f32(b * frequency)]
                if any(not math.isfinite(value) or abs(value) >= 90000 or 0 < abs(value) < 2 ** -126 for value in values):
                    return False
            frequency = _f32(frequency * ir.get('lacunarity', 2))
    return True


def _native_data_source(node, expression):
    """The IR payload alone cannot attest native color-management stages.

    This first profile earns direct data images and their same-image W chain.
    Groups/reroutes/color-managed images keep the original precise kernel.
    """
    def linked(socket):
        links = getattr(socket, 'links', ())
        return links[0].from_node if len(links) == 1 else None
    if node is None:
        return False
    source = linked(node.inputs.get('Vector'))
    image = getattr(source, 'image', None)
    if (getattr(source, 'bl_idname', '') != 'ShaderNodeTexImage' or image is None
            or not getattr(image, 'is_float', False) or getattr(image, 'use_half_precision', False)
            or image.colorspace_settings.name not in {'Non-Color','Raw'} or not image.colorspace_settings.is_data
            or getattr(image, 'alpha_mode', 'STRAIGHT') != 'STRAIGHT'):
        return False
    if expression['w'].get('op') == 'const_float':
        return image.colorspace_settings.name
    math_node = linked(node.inputs.get('W'))
    if getattr(math_node, 'bl_idname', '') != 'ShaderNodeMath' or math_node.operation != 'MULTIPLY_ADD':
        return False
    separate = linked(math_node.inputs[0])
    return image.colorspace_settings.name if getattr(separate, 'bl_idname', '') == 'ShaderNodeSeparateXYZ' and linked(separate.inputs[0]) == source else False


def qualify_nearest_field(expression, *, node=None):
    """Keep every unqualified/old kernel unchanged; source alone opts in."""
    if not _qualifies(expression):
        return expression
    colorspace = _native_data_source(node, expression)
    if not colorspace:
        return expression
    return {"op": "noise_field_nearest", 'profile': 'finite-nearest-f32-v1',
            'sourceSamples': 'native-float-data-v1', 'sourceColorSpace': colorspace, 'kernel': expression}
