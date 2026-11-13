# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh EEVEE Magic models; legacy tex_magic documents stay unchanged."""
import math
import bpy
if __package__:
    from .noise_static_inputs import constant_input, has_inexact_constant_island
    from .shader_domains import native_shader_input_evaluation
else:
    from noise_static_inputs import constant_input, has_inexact_constant_island
    from shader_domains import native_shader_input_evaluation

_VERIFIED_SOURCE_VERSIONS={(4,2,0),(5,2,0),(5,3,0)}


def _source_version():
    return tuple(bpy.app.version)


def scalar_shape(expression, depth=0, budget=None):
    budget=[0] if budget is None else budget;budget[0]+=1
    if not isinstance(expression,dict) or depth>32 or budget[0]>256:return False
    op=expression.get('op');child=lambda key:scalar_shape(expression.get(key),depth+1,budget)
    if op in {'const_float','separate','rgb_to_bw','math_modulo_native'}:return True
    if op=='clamp01':return child('input')
    if op=='clamp_minmax':return all(child(key) for key in ['value','min','max'])
    if op=='math':return child('a') and all(child(key) for key in ['b','c'] if key in expression)
    if op in {'noise','noise_fractal','noise_normalized','noise_varying','noise_varying_native','tex_white_noise'}:return expression.get('output')!='color'
    if op in {'tex_image','texture_ref'}:return expression.get('output')=='alpha'
    if op in {'tex_checker','tex_magic_native'}:return expression.get('output')=='fac'
    return False


def control_range(expression):
    item=constant_input(expression)
    if item is not None and item[1] and isinstance(item[0],(int,float)):return item[0],item[0]
    if not scalar_shape(expression):return None
    if expression.get('op')=='clamp01':return 0,1
    if expression.get('op')=='clamp_minmax':
        limits=[constant_input(expression.get(key)) for key in ['min','max']]
        if all(item is not None and item[1] and isinstance(item[0],(int,float)) for item in limits) and limits[0][0]<=limits[1][0]:
            return limits[0][0],limits[1][0]
    return None


def _has_image(value):
    if isinstance(value,dict):
        return value.get('op') in {'tex_image','texture_ref','tex_image_native'} or any(_has_image(child) for key,child in value.items() if key not in {'pixels','values'})
    return isinstance(value,(list,tuple)) and any(_has_image(child) for child in value)


def _source_data_images(node):
    """Qualify actual RNA data images without changing legacy tex_image IR.

    Image-bearing groups remain explicit until their source-context binding is
    separately proved. Default mesh coordinates and image-free groups do not
    require this image certificate.
    """
    colorspaces=set();seen=set();count=[0]
    def socket(incoming,depth=0):
        count[0]+=1
        if depth>32 or count[0]>256:return False
        links=[link for link in incoming.links if link.is_valid and not getattr(link,'is_muted',False)]
        if not links:return True
        source=links[0].from_node
        if source.as_pointer() in seen:return True
        seen.add(source.as_pointer())
        if source.bl_idname=='ShaderNodeGroup':return False
        if source.bl_idname=='ShaderNodeTexImage':
            image=source.image
            if image is None or not image.is_float or image.use_half_precision or image.alpha_mode!='STRAIGHT' or source.interpolation!='Closest' or image.colorspace_settings.name not in {'Non-Color','Raw'} or not image.colorspace_settings.is_data:return False
            if image.size[0]*image.size[1]>128*128 or any(not math.isfinite(value) or index%4==3 and value!=1 for index,value in enumerate(image.pixels)):
                return False
            colorspaces.add(image.colorspace_settings.name);return True
        return all(socket(item,depth+1) for item in source.inputs if item.is_linked)
    return sorted(colorspaces) if all(socket(node.inputs[key]) for key in ['Vector','Scale','Distortion']) and colorspaces else None


def emit_magic(node, socket, *, vector, scalar, refuse, evaluation_engine):
    if evaluation_engine != 'EEVEE':
        refuse('Magic Texture native live translation requires EEVEE; use source baking for Cycles')
    version=_source_version()
    if version not in _VERIFIED_SOURCE_VERSIONS:
        refuse('Magic Texture native live translation requires verified Blender 4.2.0, 5.2.0 or 5.3.0; this source version has no qualified precision model')
    output = {'Color': 'color', 'Fac': 'fac', 'Factor': 'fac'}.get(socket.identifier)
    depth = int(node.turbulence_depth)
    if output is None or not 0 <= depth <= 10:
        refuse('Magic Texture requires Color/Factor and native depth 0..10')
    expression = {'op': 'tex_magic_native', 'model': 'eevee-magic-f32-v1', 'sourceEngine': 'EEVEE',
        'nativeVersion':list(version),'depth': depth, 'output': output, 'vector': vector(node.inputs['Vector']),
        'scale': scalar(node.inputs['Scale']), 'distortion': scalar(node.inputs['Distortion'])}
    for key, limit in [('scale',8),('distortion',1)]:
        interval=control_range(expression[key])
        if interval is None or any(not math.isfinite(value) or abs(value)>limit for value in interval):
            refuse('Magic Texture '+key+' requires exact static controls or an authored scalar Clamp within magnitude '+str(limit))
        if key=='distortion' and interval!=(0,0) and not (interval[0]>=.25 or interval[0]>=-.5 and interval[1]<=-.25):
            refuse('Magic Texture nonzero Distortion must stay in [.25,1] or [-.5,-.25]; use source baking outside the verified band')
    if any(has_inexact_constant_island(expression[key],refuse=refuse) for key in ['vector','scale','distortion']):
        refuse('Magic Texture inputs require portable exact constant arithmetic islands; use literal/exact plumbing or source baking')
    constant = all(native_shader_input_evaluation(expression[key]) == 'constant' for key in ['vector','scale','distortion'])
    expression['evaluationModel'] = 'mf' if constant and version >= (5,0,0) else 'shader'
    if expression['evaluationModel'] == 'mf':
        if any(constant_input(expression[key]) is None or not constant_input(expression[key])[1] for key in ['scale','distortion']):
            refuse('Magic Texture MF controls require independently exact static Float32 arithmetic')
        item = constant_input(expression['vector'])
        if item is None or not item[1] or not isinstance(item[0], list) or max(map(abs,item[0])) > 16:
            refuse('Magic Texture MF coordinates require exact static Float32 vectors within magnitude 16')
    if any(_has_image(expression[key]) for key in ['vector','scale','distortion']):
        colorspaces=_source_data_images(node)
        if not colorspaces:
            refuse('Magic Texture image inputs require qualified direct opaque nearest float data images in Non-Color/Raw with Half Precision off; use mesh coordinates or source baking')
        expression.update(sourceSamples='native-float-data-v1',sourceColorSpaces=colorspaces)
    expression['nativeGpuBackend'] = bpy.context.preferences.system.gpu_backend
    if expression['nativeGpuBackend'] not in {'METAL','OPENGL'}:
        refuse('Magic Texture source GPU backend has no verified live precision model')
    return expression
