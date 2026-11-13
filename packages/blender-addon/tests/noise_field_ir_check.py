# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh source profile admission; native pixels are covered by the browser corpus."""
import copy
import importlib.util
import json
from types import SimpleNamespace as Node
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'noise_field_ir.py'
spec = importlib.util.spec_from_file_location('noise_field_profile_check', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
image = {'op':'tex_image','sourceEngine':'EEVEE','nativeGpuBackend':'METAL','sourceImageStorage':'rgba32f',
         'sourceImageUploadRounding':'none','width':1,'height':1,'pixels':[.51171875,.5,.25,1],
         'output':'color','interpolation':'Closest','extension':'REPEAT','vector':{'op':'uv_active'}}
expression = {'op':'noise_fractal','dimensions':4,'output':'color','detail':6,'roughness':1,'lacunarity':2,
              'evaluationModel':'shader','scale':{'op':'const_float','value':40},'input':image,
              'w':{'op':'math','operation':'MULTIPLY_ADD','a':{'op':'separate','channel':'y','input':copy.deepcopy(image)},
                   'b':{'op':'const_float','value':.5},'c':{'op':'const_float','value':.125}},
              'colorOffsets':[[112.125,119.25,126.5,145.75],[142.5,128.25,166.125,103.75]]}
def linked(node):
    return Node(links=[Node(from_node=node)])
image_source = Node(bl_idname='ShaderNodeTexImage', image=Node(is_float=True,use_half_precision=False,alpha_mode='STRAIGHT',colorspace_settings=Node(name='Non-Color',is_data=True)))
separate = Node(bl_idname='ShaderNodeSeparateXYZ',inputs=[linked(image_source)])
math_node = Node(bl_idname='ShaderNodeMath',operation='MULTIPLY_ADD',inputs=[linked(separate)])
native = Node(inputs={'Vector':linked(image_source),'W':linked(math_node)})
before = json.dumps(expression)
qualified = module.qualify_nearest_field(expression,node=native)
assert qualified['op'] == 'noise_field_nearest' and qualified['profile'] == 'finite-nearest-f32-v1'
assert qualified['kernel'] is expression and json.dumps(expression) == before
assert qualified['sourceColorSpace'] == 'Non-Color'


def changed(path, value):
    result = copy.deepcopy(expression)
    owner = result
    for key in path[:-1]: owner = owner[key]
    owner[path[-1]] = value
    return result


cases = [
    (['op'],'noise'), (['dimensions'],3), (['output'],'fac'), (['evaluationModel'],'shader-mf'),
    (['detail'],3), (['detail'],7), (['roughness'],1.1), (['distortion'],0), (['roughnessNode'],{'op':'uv'}),
    (['scale','value'],61.7), (['scale','futurePrecision'],'unverified'),
    (['input','sourceImageStorage'],'rgba16f'), (['input','sourceImageUploadRounding'],'nearest'),
    (['input','interpolation'],'Linear'), (['input','extension'],'CLIP'), (['input','output'],'alpha'),
    (['input','workingSpace'],'ACEScg'), (['input','vector'],{'op':'generated'}), (['input','width'],16385),
    (['input','pixels'],[2**-24,.5,.25,1]), (['input','pixels'],[.5,.5,.25,.5]),
    (['w','futurePrecision'],'unverified'), (['colorOffsets'],[[90000,0,0,0],[0,0,0,0]]),
]
for path, value in cases:
    candidate = changed(path,value)
    assert module.qualify_nearest_field(candidate,node=native) is candidate, (path,value)
assert module.qualify_nearest_field(expression) is expression
image_source.image.colorspace_settings.name='Linear Rec.709'
assert module.qualify_nearest_field(expression,node=native) is expression
image_source.image.colorspace_settings.name='Raw'
assert module.qualify_nearest_field(expression,node=native)['sourceColorSpace'] == 'Raw'
image_source.image.colorspace_settings.name='future-color'
assert module.qualify_nearest_field(expression,node=native) is expression
image_source.image.colorspace_settings.name='Non-Color'
image_source.image.colorspace_settings.is_data=False
assert module.qualify_nearest_field(expression,node=native) is expression
print('BLENDLINK_NOISE_FIELD_IR_CHECK_PASSED ' + str(len(cases) + 8))
