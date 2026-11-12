# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material Separate/Combine Color, including bounded live HSL."""
import struct
import math
import bpy


def _literal_vector(expression):
    if expression.get('op') == 'const_float': return [expression['value']] * 3
    if expression.get('op') == 'const_vec3': return expression['value']
    if expression.get('op') == 'combine' and all(expression[key].get('op') == 'const_float' for key in ['x', 'y', 'z']):
        return [expression[key]['value'] for key in ['x', 'y', 'z']]
    if expression.get('op') == 'color_convert' and expression.get('mode') == 'RGB':
        return _literal_vector(expression['input'])
    return None


def _unit_bounded(expression):
    """Conservative convex bounds; arbitrary object uniforms are not colors."""
    op = expression.get('op')
    literal = _literal_vector(expression)
    if literal is not None: return all(0 <= value <= 1 for value in literal)
    if op == 'const_float': return 0 <= expression['value'] <= 1
    if op == 'clamp01': return True
    if op == 'clamp_minmax': return all(_unit_bounded(expression[key]) for key in ['min', 'max'])
    if op == 'combine': return all(_unit_bounded(expression[key]) for key in ['x', 'y', 'z'])
    if op == 'separate': return _unit_bounded(expression['input'])
    if op == 'color_convert': return _unit_bounded(expression['input'])
    if op == 'color_ramp':
        convex = expression.get('interpolation') in {'LINEAR', 'CONSTANT'} or (
            expression.get('interpolation') == 'EASE' and expression.get('sourceModel') in {'eevee-analytic', 'eevee-analytic-hidden'})
        return convex and all(
            0 <= value <= 1 for stop in expression['stops'] for value in stop['color'][:3])
    if op == 'ramp_lut':
        alpha = expression.get('channel') == 'alpha'
        return all(0 <= value <= 1 for index, value in enumerate(expression['values']) if (index % 4 == 3) == alpha)
    if op == 'tex_image':
        alpha = expression.get('output') == 'alpha'
        return all(0 <= value <= 1 for index, value in enumerate(expression['pixels'])
                   if (index % 4 == 3) == alpha)
    if op == 'noise_normalized' and (expression.get('normalize') is not True or 'roughnessNode' in expression or expression.get('perlinModel') not in {'native-standard-f32', 'cycles-neon-fma'}): return False
    if op in {'noise', 'noise_normalized'}:
        return (expression.get('normalize', True) is True
                and all(expression.get(key, 'FBM') == 'FBM' for key in ['noiseType', 'noise_type', 'type'])
                and expression.get('dimensions') in {1, 2, 3, 4}
                and isinstance(expression.get('detail'), (int, float)) and math.isfinite(expression['detail']) and 0 <= expression['detail'] <= 6
                and isinstance(expression.get('roughness'), (int, float)) and math.isfinite(expression['roughness']) and 0 <= expression['roughness'] <= 1
                and math.isfinite(expression.get('lacunarity', 2)) and expression.get('lacunarity', 2) > 0)
    if op == 'noise_fractal': return False  # Signed/HDR family; no normalized bounds can be inherited.
    if op == 'noise_varying':
        return (expression.get('normalize') is True
                and all(expression.get(key, 'FBM') == 'FBM' for key in ['noiseType', 'noise_type', 'type'])
                and expression.get('dimensions') in {1, 2, 3, 4}
                and isinstance(expression.get('detail'), (int, float)) and math.isfinite(expression['detail']) and 0 <= expression['detail'] <= 2
                and 0 < expression.get('lacunarity', 2) <= 2
                and _unit_bounded(expression.get('roughnessNode', {})))
    if op == 'tex_white_noise': return True
    if op == 'tex_checker':
        return expression.get('output') == 'fac' or all(_unit_bounded(expression[key]) for key in ['color1', 'color2'])
    if op == 'mix_color':
        if expression.get('clampResult') is True: return True
        return expression.get('blendType') == 'MIX' and expression.get('clampFactor', True) and all(
            _unit_bounded(expression[key]) for key in ['a', 'b'])
    if op == 'math' and expression.get('operation') in {'MULTIPLY', 'MINIMUM', 'MAXIMUM'}:
        return all(_unit_bounded(expression[key]) for key in ['a', 'b'])
    return False


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


def emit_color_conversion(node, socket, *, emit_input, refuse, evaluation_engine):
    mode = str(getattr(node, 'mode', 'RGB'))
    if mode not in {'RGB', 'HSV', 'HSL'}: refuse('Separate/Combine Color mode has no native model: ' + mode)
    if evaluation_engine not in {'CYCLES', 'EEVEE'}:
        refuse('Separate/Combine Color requires a Cycles or EEVEE source evaluation engine')
    separate = node.bl_idname in {'ShaderNodeSeparateColor', 'ShaderNodeSeparateRGB'}
    channel = {'Red': 'x', 'Green': 'y', 'Blue': 'z', 'R': 'x', 'G': 'y', 'B': 'z'}.get(socket.identifier)
    if separate:
        if channel is None: refuse('Separate Color has no native scalar output ' + socket.identifier)
        incoming = emit_input(node.inputs[0], as_vector=True)
    else:
        if socket.identifier not in {'Color', 'Image'}: refuse('Combine Color has no native color output ' + socket.identifier)
        incoming = {'op': 'combine', **{key: emit_input(node.inputs[index]) for index, key in enumerate(['x', 'y', 'z'])}}
    gpu = evaluation_engine == 'EEVEE'
    # These shader nodes have no material multi-function registration; literals
    # still use GPU evaluation in EEVEE. Cycles has its own constant folder.
    association = 'sum-first' if gpu and bpy.context.preferences.system.gpu_backend == 'METAL' else 'sequential'
    domain = 'finite-rgb'
    if separate and mode == 'HSL':
        literal = _literal_vector(incoming)
        if literal is not None:
            high, low = max(literal), min(literal)
            lightness = min(1, _f32(high + low) * .5)
            denominator = (_f32(2 - _f32(high + low)) if association == 'sum-first' else _f32(_f32(2 - high) - low)) if lightness > .5 else _f32(high + low)
            if high != low and denominator == 0:
                refuse('Separate HSL has undefined saturation for this non-gray native RGB extrema sum')
            domain = 'verified-static-nonsingular'
        elif _unit_bounded(incoming):
            domain = 'unit-bounded-live'
        else:
            refuse('Separate HSL requires a proven unit RGB range or verified nonsingular static RGB; live HDR bounds are unknown')
    expression = {"op": "color_convert", 'mode': mode, 'direction': 'separate' if separate else 'combine',
                  'model': 'eevee-gpu' if gpu else 'cycles', 'sourceEngine': evaluation_engine,
                  'input': incoming, 'hslUpperDivisor': association, 'inputDomain': domain,
                  'alpha': 'no exposed alpha socket; separate ignores input alpha, combine creates alpha1'}
    return {'op': 'separate', 'channel': channel, 'input': expression} if separate else expression
