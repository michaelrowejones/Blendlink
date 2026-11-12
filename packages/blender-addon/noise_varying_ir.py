# SPDX-License-Identifier: GPL-3.0-or-later
"""Conservative scalar-and-range proof for live native Noise Roughness."""
if __package__:
    from .color_ir import _unit_bounded
else:
    from color_ir import _unit_bounded


def _scalar_structure(expression):
    if not isinstance(expression, dict): return False
    operation = expression.get('op')
    if operation in {'const_float', 'separate', 'rgb_to_bw'}: return True
    if operation == 'clamp01': return _scalar_structure(expression.get('input'))
    if operation == 'clamp_minmax':
        return all(_scalar_structure(expression.get(key)) for key in ['value', 'min', 'max'])
    if operation == 'math':
        return _scalar_structure(expression.get('a')) and all(
            _scalar_structure(expression[key]) for key in ['b', 'c'] if key in expression)
    if operation in {'noise', 'noise_fractal', 'noise_normalized', 'noise_varying', 'noise_varying_native', 'tex_white_noise'}:
        return expression.get('output') != 'color'
    if operation in {'tex_image', 'texture_ref'}: return expression.get('output') == 'alpha'
    if operation == 'tex_checker': return expression.get('output') == 'fac'
    if operation == 'ramp_lut': return expression.get('channel') == 'alpha'
    return False


def unit_roughness(expression):
    # Neither a claimed range annotation nor a unit RGB vector is a scalar
    # amplitude. Each language rechecks the actual executable child graph.
    return _scalar_structure(expression) and _unit_bounded(expression)
