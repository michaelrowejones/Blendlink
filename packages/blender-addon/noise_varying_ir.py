# SPDX-License-Identifier: GPL-3.0-or-later
"""Conservative scalar input and range proofs for native Noise controls."""
import math
import struct
if __package__:
    from .color_ir import _unit_bounded
else:
    from color_ir import _unit_bounded


def _scalar_structure(expression):
    if not isinstance(expression, dict): return False
    operation = expression.get('op')
    if operation in {'const_float', 'separate', 'rgb_to_bw', 'math_modulo_native'}: return True
    if operation == 'clamp01': return _scalar_structure(expression.get('input'))
    if operation == 'clamp_minmax':
        return all(_scalar_structure(expression.get(key)) for key in ['value', 'min', 'max'])
    if operation == 'math':
        return _scalar_structure(expression.get('a')) and all(
            _scalar_structure(expression[key]) for key in ['b', 'c'] if key in expression)
    if operation in {'noise', 'noise_fractal', 'noise_normalized', 'noise_varying', 'noise_varying_native', 'tex_white_noise'}:
        return expression.get('output') != 'color'
    if operation in {'tex_image', 'texture_ref'}: return expression.get('output') == 'alpha'
    if operation in {'tex_checker','tex_magic_native'}: return expression.get('output') == 'fac'
    if operation == 'ramp_lut': return expression.get('channel') == 'alpha'
    return False


def unit_roughness(expression):
    # Neither a claimed range annotation nor a unit RGB vector is a scalar
    # amplitude. Each language rechecks the actual executable child graph.
    return _scalar_structure(expression) and _unit_bounded(expression)


def float32_safe_noise_scalar(expression):
    """Selection-only literal plumbing needs no double arithmetic folding.

    Clamp and finite min/max select an existing float32 input. Arithmetic
    requires separately proved native stages; a Python-double result, including
    a result of zero, is not that proof.
    """
    return _selection_scalar(expression) is not None


def _selection_scalar(expression):
    if not isinstance(expression, dict): return None
    operation = expression.get('op')
    if operation == 'const_float':
        value = expression.get('value')
        if not isinstance(value, (int,float)) or isinstance(value,bool) or not math.isfinite(value): return None
        try: return value if struct.unpack('<f',struct.pack('<f',value))[0] == value else None
        except (OverflowError,struct.error): return None
    if operation == 'clamp01':
        value=_selection_scalar(expression.get('input'))
        return min(max(value,0),1) if value is not None else None
    if operation == 'clamp_minmax':
        value,low,high=(_selection_scalar(expression.get(key)) for key in ['value','min','max'])
        if value is None or low is None or high is None or low>high:return None
        return min(max(value,low),high)
    if operation == 'math' and expression.get('operation') in {'MINIMUM','MAXIMUM'}:
        a,b=(_selection_scalar(expression.get(key)) for key in ['a','b'])
        if a is None or b is None:return None
        return min(a,b) if expression['operation']=='MINIMUM' else max(a,b)
    return None


def native_distortion_mf_inputs(expression):
    """Narrow, independently replayable native-MF input grammar.

    A uniform texture/attribute is still a shader input. Claimed stage/range
    annotations cannot make it a native multi-function constant.
    """
    if not _exact_mf_noise_coordinates(expression) or not portable_noise_constant_arithmetic(expression): return False
    def constant(value):
        if not isinstance(value, dict): return False
        operation = value.get('op')
        if operation in {'const_float', 'const_vec3'}: return True
        if operation == 'noise_normalized':
            if value.get('perlinModel') != 'mf-periodic-f32' or value.get('evaluationModel') != 'shader-mf' or not _exact_mf_noise_coordinates(value): return False
        elif operation not in {'math', 'vector_math', 'mapping', 'vector_rotate', 'vector_scale',
                               'combine', 'separate', 'clamp01', 'clamp_minmax'}: return False
        children = []
        def collect(item):
            if isinstance(item, dict):
                if 'op' in item: children.append(item)
                else:
                    for child in item.values(): collect(child)
            elif isinstance(item, (list, tuple)):
                for child in item: collect(child)
        for key, item in value.items():
            if key != 'op': collect(item)
        return bool(children) and all(constant(child) for child in children)
    keys = ['input', 'scale', 'roughnessNode'] + (['w'] if expression.get('dimensions') == 4 else [])
    return all(constant(expression.get(key)) for key in keys)


NATIVE_MF_NOISE_INPUT_MESSAGE = ('Native normalized live Roughness nonzero Distortion requires exact MF coordinate inputs '
                               'and portable constant arithmetic; use source baking')
NATIVE_SHADER_NOISE_INPUT_MESSAGE = ('Native normalized live Roughness nonzero Distortion requires portable constant arithmetic; '
                                   'use exact inputs or source baking')
_PRECISION_OPERANDS = {
    'math':['a','b','c'],'vector_math':['a','b','c'],'mapping':['input','location','rotation','scale'],
    'vector_rotate':['input','center','axis','angle','rotation'],'vector_scale':['input','scale'],
    'combine':['x','y','z'],'separate':['input'],'clamp01':['input'],'clamp_minmax':['value','min','max'],
    'noise_normalized':['input','w','scale','roughnessNode'],'noise_varying_native':['input','w','scale','roughnessNode'],
}


def _precision_children(expression):
    return [expression[key] for key in _PRECISION_OPERANDS.get(expression.get('op'),[])
            if isinstance(expression.get(key),dict) and 'op' in expression[key]]


def portable_noise_constant_arithmetic(expression):
    if __package__:
        from .noise_static_inputs import constant_input
    else:
        from noise_static_inputs import constant_input
    transparent = {'const_float','const_vec3',*(_PRECISION_OPERANDS.keys()-{'noise_normalized','noise_varying_native'})}
    arithmetic = {'math','vector_math','mapping','vector_rotate','vector_scale'}
    def opaque(node,depth=0):
        return depth>32 or node.get('op') not in transparent or any(opaque(child,depth+1) for child in _precision_children(node))
    count=[0]
    def visit(node,depth=0):
        count[0]+=1
        if depth>32 or count[0]>256:return False
        if node.get('op') in arithmetic:
            result=constant_input(node)
            if result is not None and not result[1] or result is None and not opaque(node):return False
            if node.get('op')=='vector_math' and node.get('operation') not in {'ADD','SUBTRACT','MULTIPLY','MULTIPLY_ADD'} and not opaque(node):return False
        return all(visit(child,depth+1) for child in _precision_children(node))
    return visit(expression)


def _exact_mf_noise_coordinates(expression):
    if __package__:
        from .noise_static_inputs import constant_input
    else:
        from noise_static_inputs import constant_input
    def compatible(node,depth=0):
        return depth<=32 and not (node.get('op')=='vector_math' and node.get('operation') not in {'ADD','SUBTRACT','MULTIPLY','MULTIPLY_ADD'}) and all(compatible(child,depth+1) for child in _precision_children(node))
    if not compatible(expression.get('input',{})) or expression.get('dimensions')==4 and not compatible(expression.get('w',{})):return False
    point=constant_input(expression.get('input'))
    if not point or not point[1]:return False
    if expression.get('dimensions')==1:return isinstance(point[0],(int,float))
    if not isinstance(point[0],list) or len(point[0])!=3:return False
    if expression.get('dimensions')==4:
        w=constant_input(expression.get('w'))
        return w is not None and w[1] and isinstance(w[0],(int,float))
    return True
