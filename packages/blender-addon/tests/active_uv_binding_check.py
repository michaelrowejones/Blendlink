# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh default UV is owner-bound; named maps and authoring selection stay intact."""
import sys
from pathlib import Path
from types import SimpleNamespace
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import tsl_ir
import material_compiler
import shader_domains

bpy.ops.wm.read_factory_settings(use_empty=True)
material=bpy.data.materials.new('Active UV Binding');material.use_nodes=True
tree=material.node_tree;root=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
coordinate=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coordinate.outputs['UV'],root.inputs['Base Color'])
document=tsl_ir.emit_channel(root.inputs['Base Color'])
assert document['output']=={'op':'uv_active'},document
assert shader_domains.native_shader_input_evaluation(document['output'])=='shader'
# Fresh owner binding does not erase White Noise's varying-coordinate warning.
white=tree.nodes.new('ShaderNodeTexWhiteNoise');white.noise_dimensions='3D'
tree.links.new(coordinate.outputs['UV'],white.inputs['Vector'])
tsl_ir.drain_approximations();tsl_ir.emit_output(white,white.outputs['Value'])
assert tsl_ir.drain_approximations(),'Unquantized source UV lost its White Noise approximation'
quantized=tree.nodes.new('ShaderNodeVectorMath');quantized.operation='FLOOR'
tree.links.new(coordinate.outputs['UV'],quantized.inputs[0]);tree.links.new(quantized.outputs['Vector'],white.inputs['Vector'])
tsl_ir.emit_output(white,white.outputs['Value']);assert not tsl_ir.drain_approximations()
tree.nodes.remove(white);tree.nodes.remove(quantized)
uv=tree.nodes.new('ShaderNodeUVMap');tree.links.new(uv.outputs[0],root.inputs['Base Color'])
assert tsl_ir.emit_channel(root.inputs['Base Color'])['output']=={'op':'uv_active'}
uv.uv_map='EditUV'
assert tsl_ir.emit_channel(root.inputs['Base Color'])['output']=={'op':'uv','uvMap':'EditUV'}
mesh=bpy.data.meshes.new('UV Owner Data');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
for name in ['EditUV','RenderUV']:mesh.uv_layers.new(name=name)
mesh.uv_layers['RenderUV'].active_render=True;mesh.uv_layers.active_index=0
owner=bpy.data.objects.new('Render UV1 Owner',mesh);bpy.context.scene.collection.objects.link(owner)
other=bpy.data.objects.new('Render UV0 Owner',mesh.copy());bpy.context.scene.collection.objects.link(other)
other.data.uv_layers['EditUV'].active_render=True;other.data.uv_layers.active_index=1
decision=SimpleNamespace(material_name=material.name,channel_plan={'channels':[{'tslIr':document}]})
for obj,name,index in [(owner,'RenderUV',1),(other,'EditUV',0)]:
 before=(obj.data.uv_layers.active_index,[(v.name,v.active_render) for v in obj.data.uv_layers])
 entry=material_compiler._tsl_runtime_mesh_entry(decision,obj)
 assert entry['activeRenderUv']=={'schemaVersion':1,'model':'source-active-render-v1','uvMap':name,'channel':index},entry
 assert entry['uvChannels'][name]==index
 assert before==(obj.data.uv_layers.active_index,[(v.name,v.active_render) for v in obj.data.uv_layers])
for i in range(3):mesh.uv_layers.new(name='Extra '+str(i))
mesh.uv_layers[-1].active_render=True
try:material_compiler._tsl_runtime_mesh_entry(decision,owner)
except material_compiler.MaterialCompileError as error:assert 'first four' in str(error),error
else:raise AssertionError('Unsupported active UV slot silently defaulted')
while mesh.uv_layers:mesh.uv_layers.remove(mesh.uv_layers[-1])
try:material_compiler._tsl_runtime_mesh_entry(decision,owner)
except material_compiler.MaterialCompileError as error:assert 'active render UV' in str(error),error
else:raise AssertionError('Missing active render UV silently defaulted')
# A private bake UV must not replace a live channel's source selection.
mesh.uv_layers.new(name='EditUV');mesh.uv_layers.new(name='RenderUV')
mesh.uv_layers['RenderUV'].active_render=True
source_uv_state={'activeRenderUv':'RenderUV'}
mesh.uv_layers.new(name='PrivateBakeUV').active_render=True
entry=material_compiler._tsl_runtime_mesh_entry(decision,owner,source_uv_state=source_uv_state)
assert entry['activeRenderUv']['uvMap']=='RenderUV' and entry['activeRenderUv']['channel']==1,entry
# Exercise the hybrid transaction: only the large roughness/metallic graph bakes,
# creating an atlas while Base Color keeps the source render UV live.
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
from material_tsl_ir_check import base_material,quad_object,emit_selected,read_glb_json
bpy.ops.object.select_all(action='DESELECT')
obj=quad_object('Hybrid active UV owner',bpy.context.scene.collection)
obj.select_set(True);bpy.context.view_layer.objects.active=obj
obj.data.uv_layers[0].name='EditUV'
obj.data.uv_layers.new(name='RenderUV').active_render=True
mat,tree,root=base_material('Hybrid source UV')
obj.data.materials.append(mat)
texcoord=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(texcoord.outputs['UV'],root.inputs['Base Color'])
brick=tree.nodes.new('ShaderNodeTexBrick');tree.links.new(brick.outputs['Fac'],root.inputs['Roughness'])
tree.links.new(brick.outputs['Fac'],root.inputs['Metallic'])
previous_engine=bpy.context.scene.render.engine
try:
 bpy.context.scene.render.engine='CYCLES'
 bpy.context.view_layer.update()
 with patch.object(material_compiler,'TSL_IR_BYTE_BUDGET',512):
  plan=material_compiler.plan_materials([obj],purpose='preview',automatic_programs=True)
  channels={item['channel']:item for item in plan.decisions[0].channel_plan['channels']}
  assert channels['Base Color']['route']=='program' and channels['Roughness']['route']=='bake',channels
  with tempfile.TemporaryDirectory(prefix='blendlink-active-uv-hybrid-') as directory:
   path=Path(directory)/'hybrid.glb'
   material_compiler.with_compiled_materials(plan,str(path),emit_selected([obj]))
   gltf=read_glb_json(path)
   entries=[item['extras']['blendlink_tsl_runtime'] for item in gltf['meshes'] if item.get('extras',{}).get('blendlink_tsl_runtime')]
   assert entries and all(item['activeRenderUv']['uvMap']=='RenderUV' for item in entries),entries
   assert all(item['activeRenderUv']['channel']==item['uvChannels']['RenderUV'] for item in entries),entries
 assert next(layer.name for layer in obj.data.uv_layers if layer.active_render)=='RenderUV'
finally:bpy.context.scene.render.engine=previous_engine
print('BLENDLINK_ACTIVE_UV_BINDING_PASSED '+bpy.app.version_string)
