# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh EEVEE MF coordinates, rounded at each qualified arithmetic node.

This is not a generic shader constant folder. Only ordinary Float32 literals,
Combine/Separate, and separate ADD/SUBTRACT/MULTIPLY nodes enter this model.
Multiply Add, division, live fields, and arithmetic inside Roughness stay out.
"""
import math
import struct

MODEL = 'native-mf-f32-coordinates-v1'
_MAX_INTERMEDIATE = 2**31
_MAX_COORDINATE = 10**6


def evaluate_mf_coordinate(expression):
    count = [0]
    visiting = set()

    def ordinary(value):
        return (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                and (value == 0 or abs(value) >= 2**-126) and abs(value) <= _MAX_INTERMEDIATE)

    def f32(value):
        return struct.unpack('<f', struct.pack('<f', value))[0]

    def visit(node, depth=0):
        count[0] += 1
        if not isinstance(node, dict) or depth > 32 or count[0] > 256 or id(node) in visiting:
            return None
        visiting.add(id(node))
        try:
            op = node.get('op')
            if op == 'const_float':
                value = node.get('value')
                return value if ordinary(value) and f32(value) == value else None
            if op == 'const_vec3':
                value = node.get('value')
                return list(value) if isinstance(value, list) and len(value) == 3 and all(ordinary(v) and f32(v) == v for v in value) else None
            child = lambda key: visit(node.get(key), depth + 1)
            if op == 'combine':
                values = [child(key) for key in ('x', 'y', 'z')]
                return values if all(ordinary(v) for v in values) else None
            if op == 'separate':
                value, axis = child('input'), {'x': 0, 'y': 1, 'z': 2}.get(node.get('channel'))
                return value[axis] if isinstance(value, list) and axis is not None else None
            if op == 'vector_scale':
                a, b, operation = child('input'), child('scale'), 'MULTIPLY'
                if not isinstance(a, list) or not ordinary(b): return None
                b = [b] * 3
            elif op in {'math', 'vector_math'}:
                a, b, operation = child('a'), child('b'), node.get('operation')
                if operation not in {'ADD', 'SUBTRACT', 'MULTIPLY'}: return None
                if op == 'math' and (not ordinary(a) or not ordinary(b)): return None
                if op == 'vector_math' and (not isinstance(a, list) or not isinstance(b, list)): return None
            else:
                return None

            def binary(left, right):
                wide = left + right if operation == 'ADD' else left - right if operation == 'SUBTRACT' else left * right
                # Exclude underflow/overflow and nonordinary intermediates. For
                # bounded f32 operands binary64 represents products exactly;
                # additions round directly to f32 even across exponent gaps.
                return f32(wide) if ordinary(wide) and ordinary(f32(wide)) else None
            if isinstance(a, list):
                values = [binary(left, right) for left, right in zip(a, b)]
                return values if all(ordinary(v) for v in values) else None
            return binary(a, b)
        finally:
            visiting.remove(id(node))

    value = visit(expression)
    values = value if isinstance(value, list) else [value]
    return value if all(ordinary(v) and abs(v) <= _MAX_COORDINATE for v in values) else None


def canonicalize_mf_coordinates(expression):
    """Copy the IR only when a qualified inexact coordinate needs rounding.

    Keep its source expression in the versioned capability. The runtime
    independently evaluates that expression and checks the literal words.
    """
    if __package__:
        from .noise_static_inputs import constant_input
    else:
        from noise_static_inputs import constant_input
    result = dict(expression)
    sources = {}
    for key in ['input'] + (['w'] if expression.get('dimensions') == 4 else []):
        original = expression.get(key)
        exact = constant_input(original)
        if exact is not None and exact[1]:
            continue
        value = evaluate_mf_coordinate(original)
        scalar = expression.get('dimensions') == 1 or key == 'w'
        if value is None or scalar != isinstance(value, (int, float)):
            return None
        sources[key] = original
        result[key] = {'op': 'const_float' if scalar else 'const_vec3', 'value': value}
    if not sources:
        return None
    result['mfCoordinateSource'] = sources
    return result
