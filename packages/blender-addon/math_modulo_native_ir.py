# SPDX-License-Identifier: GPL-3.0-or-later
"""Qualified fixed-divisor remainder for native EEVEE large integer inputs.

The old `math` opcode intentionally retains its published semantics. This new
opcode is emitted only for independently bounded, finite Float32 inputs in the
same-sign integer band [2^24, 2^31), and the literal positive divisor100000.
"""
import math
import struct
try:
    from .noise_static_inputs import constant_input
    from .shader_domains import native_shader_input_evaluation
except ImportError:
    from noise_static_inputs import constant_input
    from shader_domains import native_shader_input_evaluation

MINIMUM = 2**24
LIMIT = 2**31
ZERO_REFUSAL = 'Native MF fixed100000 Modulo negative-zero composition has no portable Math stage; use source baking'
IMAGE_REFUSAL = 'Legacy Metal fixed100000 Modulo image input requires exactly-half payload; use source baking'
REFUSAL = 'EEVEE large fixed100000 Modulo input has no verified native precision profile; use source baking'


def _f32(value):
    try: return struct.unpack('f', struct.pack('f', value))[0]
    except OverflowError: return math.copysign(math.inf, value)


def _literal(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and _f32(value) == value


def input_bounds(expression):
    """Recompute bounds from data, never an author-supplied interval assertion.

    First live subset: nearest FULL float image plus one literal vector offset,
    followed by SeparateXYZ. Arbitrary arithmetic/association/filtering is not
    certified by this helper. RGB alpha1 makes all association modes identical.
    """
    if not isinstance(expression, dict): return None
    if expression.get('op') == 'const_float' and _literal(expression.get('value')):
        return (expression['value'], expression['value'])
    if expression.get('op') != 'separate' or expression.get('channel') not in ('x', 'y', 'z'): return None
    vector = expression.get('input', {})
    if not isinstance(vector, dict) or vector.get('op') != 'vector_math' or vector.get('operation') != 'ADD': return None
    image, offset = vector.get('a', {}), vector.get('b', {})
    if not isinstance(image, dict) or not isinstance(offset, dict) or image.get('op') != 'tex_image' or offset.get('op') != 'const_vec3': return None
    values = offset.get('value')
    if not isinstance(values, list) or len(values) != 3 or not all(map(_literal, values)): return None
    if (image.get('sourceEngine') != 'EEVEE' or image.get('nativeGpuBackend') != 'METAL'
            or image.get('sourceImageStorage') != 'rgba32f' or image.get('sourceImageUploadRounding') != 'none'
            or image.get('interpolation') != 'Closest' or image.get('output') != 'color'
            or image.get('extension') not in ('REPEAT', 'EXTEND', 'CLIP') or image.get('projection', 'flat') != 'flat'): return None
    if not isinstance(image.get('vector'), dict) or image['vector'].get('op') not in ('uv', 'uv_active'): return None
    width, height, pixels = image.get('width'), image.get('height'), image.get('pixels')
    if (not isinstance(width, int) or isinstance(width, bool) or not isinstance(height, int) or isinstance(height, bool)
            or width < 1 or height < 1 or width * height > 16384 or not isinstance(pixels, list)
            or len(pixels) != width * height * 4 or not all(map(_literal, pixels))
            or any(pixels[index] != 1 for index in range(3, len(pixels), 4))): return None
    axis = ('x', 'y', 'z').index(expression['channel'])
    channel = pixels[axis::4] + ([0] if image['extension'] == 'CLIP' else [])
    return (_f32(min(channel) + values[axis]), _f32(max(channel) + values[axis]))


def half_exact_image(expression):
    try:
        pixels = expression['input']['a']['pixels']
        return all(struct.unpack('e', struct.pack('e', value))[0] == value for value in pixels)
    except (KeyError, TypeError, OverflowError, struct.error): return False


def in_integer_band(bounds):
    return bounds is not None and (MINIMUM <= bounds[0] <= bounds[1] < LIMIT
                                   or -LIMIT < bounds[0] <= bounds[1] <= -MINIMUM)


def qualify_modulo(expression, *, engine, backend, version, refuse):
    if engine != 'EEVEE' or expression.get('operation') != 'MODULO': return expression
    divisor = expression.get('b', {})
    if divisor != {'op': 'const_float', 'value': 100000.0}: return expression
    original = expression['a']
    static = constant_input(original)
    incoming = {'op': 'const_float', 'value': static[0]} if static and static[1] and isinstance(static[0], (int, float)) else original
    bounds = input_bounds(incoming)
    if not in_integer_band(bounds):
        # A witnessed large input is not silently sent through rounded browser
        # subtraction. Unknown fields and ordinary domains retain old dispatch.
        witnessed = bounds or ((static[0], static[0]) if static and isinstance(static[0], (int, float)) else None)
        if witnessed and max(map(abs, witnessed)) >= MINIMUM: refuse(REFUSAL)
        return expression
    input_model = 'literal-f32-v1' if incoming['op'] == 'const_float' else 'metal-f32-image-v1'
    if version < (5,0,0) and incoming['op'] != 'const_float':
        if not half_exact_image(incoming): refuse(IMAGE_REFUSAL)
        input_model = 'metal-half-exact-image-v1'
    stage = native_shader_input_evaluation(original)
    if version >= (5, 0, 0) and stage == 'constant':
        if incoming['value'] < 0 and int(incoming['value']) % 100000 == 0: refuse(ZERO_REFUSAL)
        model = 'mf-fmod100000-v1'
    elif backend == 'METAL' and (stage == 'shader' or version < (5, 0, 0) and stage == 'constant'):
        model = 'metal-mod100000-v1'
    else:
        refuse(REFUSAL)
    return {"op": "math_modulo_native", 'precisionModel': model, 'inputModel': input_model, 'input': incoming}
