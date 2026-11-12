# SPDX-License-Identifier: GPL-3.0-or-later
"""Source admission for the executable static 4D Noise coordinate subset."""
import math
import struct

MESSAGE = ('Static 4D Noise Color shader input arithmetic has no portable source precision model; '
           'use literal coordinates or source baking')


def _f32(value):
    try:
        return struct.unpack('f', struct.pack('f', value))[0]
    except OverflowError:
        return math.copysign(math.inf, value)


def constant_input(expression, depth=0, budget=None):
    """Return (Float32 value, all arithmetic exact), or None for opaque IR.

    The <=24 exponent-gap check prevents binary64 addition from accidentally
    certifying an exact Float32 sum after losing a much smaller addend itself.
    Unknown graphs stay outside this particular admission rule.
    """
    budget = [0] if budget is None else budget
    budget[0] += 1
    if not isinstance(expression, dict) or depth > 32 or budget[0] > 256:
        return None
    child = lambda key: constant_input(expression.get(key), depth + 1, budget)
    literal = lambda value: (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                             and _f32(value) == value and (value == 0 or abs(value) >= 2**-126))

    def binary(operation, a, b):
        if operation in {'ADD', 'SUBTRACT'}:
            right = b if operation == 'ADD' else -b
            wide = a + right
            exact = (a == 0 or right == 0 or abs(math.floor(math.log2(abs(a))) - math.floor(math.log2(abs(right)))) <= 24) and _f32(wide) == wide
        elif operation == 'MULTIPLY':
            wide = a * b; exact = _f32(wide) == wide
        elif operation == 'MINIMUM':
            return min(a, b), True
        elif operation == 'MAXIMUM':
            return max(a, b), True
        elif operation == 'DIVIDE' and b != 0:
            wide = a / b; exact = _f32(wide) == wide
        else:
            return None
        rounded = _f32(wide)
        return (rounded, exact) if math.isfinite(rounded) and (rounded == 0 or abs(rounded) >= 2**-126) else None

    op = expression.get('op')
    if op == 'const_float':
        value = expression.get('value'); return (value, True) if literal(value) else None
    if op == 'const_vec3':
        value = expression.get('value'); return (value, True) if isinstance(value, list) and len(value) == 3 and all(map(literal, value)) else None
    if op == 'combine':
        parts = [child(axis) for axis in ('x', 'y', 'z')]
        return ([part[0] for part in parts], all(part[1] for part in parts)) if all(part and isinstance(part[0], (int, float)) for part in parts) else None
    if op == 'separate':
        source = child('input'); axis = {'x': 0, 'y': 1, 'z': 2}.get(expression.get('channel'))
        return (source[0][axis], source[1]) if source and isinstance(source[0], list) and axis is not None else None
    if op == 'vector_scale':
        source, scale = child('input'), child('scale')
        if not source or not scale or not isinstance(source[0], list) or not isinstance(scale[0], (int, float)): return None
        values = [binary('MULTIPLY', value, scale[0]) for value in source[0]]
        return ([value[0] for value in values], source[1] and scale[1] and all(value[1] for value in values)) if all(values) else None
    if op not in {'math', 'vector_math'}:
        return None
    a, b = child('a'), child('b'); operation = expression.get('operation')
    if op == 'math' and operation == 'ABSOLUTE' and a and isinstance(a[0], (int, float)): return abs(a[0]), a[1]
    if not a or not b: return None
    c = child('c') if operation == 'MULTIPLY_ADD' else None

    def calculate(left, right, last=None):
        value = binary('MULTIPLY' if operation == 'MULTIPLY_ADD' else operation, left, right)
        if operation == 'MULTIPLY_ADD' and value and last is not None:
            result = binary('ADD', value[0], last)
            return (result[0], value[1] and result[1]) if result else None
        return value

    exact = a[1] and b[1] and (c is None or c[1])
    if op == 'math' and isinstance(a[0], (int, float)) and isinstance(b[0], (int, float)):
        if operation == 'MULTIPLY_ADD' and (not c or not isinstance(c[0], (int, float))): return None
        value = calculate(a[0], b[0], c[0] if c else None)
        return (value[0], exact and value[1]) if value else None
    if op == 'vector_math' and isinstance(a[0], list) and isinstance(b[0], list):
        if operation == 'MULTIPLY_ADD' and (not c or not isinstance(c[0], list)): return None
        values = [calculate(left, right, c[0][axis] if c else None) for axis, (left, right) in enumerate(zip(a[0], b[0]))]
        return ([value[0] for value in values], exact and all(value[1] for value in values)) if all(values) else None
    return None


def require_shader_constant_inputs(expression, refuse):
    if (expression.get('op') not in {'noise_fractal', 'noise_normalized'} or expression.get('dimensions') != 4
            or expression.get('output') != 'color' or expression.get('noiseType', 'FBM') != 'FBM'
            or expression.get('evaluationModel') == 'shader-mf' or expression.get('distortion', 0) != 0):
        return
    inputs = [constant_input(expression.get(key)) for key in ('input', 'w')]
    if all(inputs) and any(not value[1] for value in inputs):
        refuse(MESSAGE)
