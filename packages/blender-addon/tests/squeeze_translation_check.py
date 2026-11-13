# SPDX-License-Identifier: GPL-3.0-or-later
"""Source qualification, bounded Squeeze input transport and engine safety."""
from pathlib import Path
import copy
import json
import sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blender-addon'));sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import tsl_ir,squeeze_ir,shader_domains,engine_fallback,procedural
bpy.ops.wm.read_factory_settings(use_empty=True)
engines={item.identifier for item in bpy.context.scene.render.bl_rna.properties['engine'].enum_items}
bpy.context.scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
material=bpy.data.materials.new('Actual Squeeze admission');material.use_nodes=True
root=next(node for node in material.node_tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled')
node=material.node_tree.nodes.new('ShaderNodeSqueeze');material.node_tree.links.new(node.outputs['Value'],root.inputs['Base Color'])
def emission():return tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')
def state():return repr([(item.name,[(socket.identifier,getattr(socket,'default_value',None)) for socket in item.inputs]) for item in material.node_tree.nodes])+repr([(link.from_node.name,link.to_node.name,link.to_socket.identifier) for link in material.node_tree.links])
before=state()
assert 'ShaderNodeSqueeze' in engine_fallback._ENGINE_SENSITIVE
assert 'ShaderNodeSqueeze' in engine_fallback.channel_engine_difference(root,'Base Color','EEVEE','CYCLES',procedural._walk_channel_upstream)
assert engine_fallback.channel_engine_difference(root,'Roughness','EEVEE','CYCLES',procedural._walk_channel_upstream) is None
qualified=True
try:initial=emission()
except tsl_ir.TslIrRefusal as error:
 qualified=False
 assert any(text in str(error) for text in ['source attestation is N/A','has no verified live source profile','requires actual native GPU backend attestation','has no verified live source precision profile for actual GPU backend']),error
 print('BLENDLINK_SQUEEZE_SOURCE_ADMISSION_NA',str(error))
if qualified:
 result=initial['output'];assert result['op']=='squeeze_native' and result['nativeGpuBackend']=='OPENGL'
 assert shader_domains.native_shader_input_evaluation(result)=='shader','Squeeze has no native MF evaluator'
 assert squeeze_ir.valid_expression(result,bpy.app.version[:3])
 for values in [(0,0,0),(-1,-1,0),(.5,4,.5),(-8,2,.5)]:
  for incoming,value in zip(node.inputs,values):incoming.default_value=value
  assert emission()['output']['op']=='squeeze_native'
 for incoming,value in zip(node.inputs,[16,2,0]):incoming.default_value=value
 try:emission();raise AssertionError('Unqualified exponential argument admitted')
 except tsl_ir.TslIrRefusal as error:assert '<=24' in str(error),error
 for incoming,value in zip(node.inputs,[0,1,0]):incoming.default_value=value
 for bad in [dict(result,model='future'),dict(result,value={'op':'separate','channel':'x','input':{'op':'uv','range':[0,1]}})]:assert not squeeze_ir.valid_expression(bad,bpy.app.version[:3])
 try:tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='CYCLES');raise AssertionError('Cycles live support was not earned')
 except tsl_ir.TslIrRefusal as error:assert 'Cycles evaluates this node differently' in str(error),error
# A budget refusal must happen before reading native pixel storage.
from types import SimpleNamespace
class OversizeImage:
 source='FILE';type='IMAGE';is_float=True;use_half_precision=False;alpha_mode='STRAIGHT';size=(1025,1)
 colorspace_settings=SimpleNamespace(name='Non-Color',is_data=True)
 def as_pointer(self):return 174091
 @property
 def pixels(self):raise AssertionError('Oversize native image pixels were traversed')
image_node=SimpleNamespace(bl_idname='ShaderNodeTexImage',image=OversizeImage(),interpolation='Closest',projection='FLAT',extension='REPEAT')
try:
 squeeze_ir._source_images(SimpleNamespace(inputs=[None]),(),lambda *args,**kwargs:[(image_node,None)],lambda message:(_ for _ in ()).throw(ValueError(message)))
except ValueError as error:assert '1024 texels' in str(error)
else:raise AssertionError('Oversize image admitted')
# A wide rejected graph cannot repeatedly scan small images without a total cap.
class CappedImage(OversizeImage):
 size=(1024,1)
 def __init__(self,index):self.index=index
 def as_pointer(self):return self.index
 @property
 def pixels(self):
  read_images.append(self.index)
  return [0,0,0,1]*1024
read_images=[]
wide_images=[SimpleNamespace(bl_idname='ShaderNodeTexImage',image=CappedImage(index),interpolation='Closest',projection='FLAT',extension='REPEAT') for index in range(1,5)]
try:
 squeeze_ir._source_images(SimpleNamespace(inputs=[None]),(),lambda *args,**kwargs:[(item,None) for item in wide_images],lambda message:(_ for _ in ()).throw(ValueError(message)))
except ValueError as error:assert '12288 native pixel values' in str(error)
else:raise AssertionError('Wide native image inspection was unbounded')
assert read_images==[1,2,3],read_images
assert before==state(),'Qualification changed source values/links'
material.node_tree.links.remove(next(iter(root.inputs['Base Color'].links)))
assert engine_fallback.channel_engine_difference(root,'Base Color','EEVEE','CYCLES',procedural._walk_channel_upstream) is None
print('BLENDLINK_SQUEEZE_TRANSLATION_PASSED',bpy.app.version_string)
