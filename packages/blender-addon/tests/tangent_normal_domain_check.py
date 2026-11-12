# SPDX-License-Identifier: GPL-3.0-or-later
"""Automatic image-driven EEVEE normal planning and unsafe-domain refusals."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import bpy
import numpy as np

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler as compiler
import tsl_ir
import normal_input_bounds

clamped={'op':'mix_color','blendType':'MIX','clampFactor':True,'clampResult':True,
         'factor':{'op':'const_float','value':.5},
         'a':{'op':'const_vec3','value':[2,2,2]},'b':{'op':'const_vec3','value':[3,3,3]}}
assert normal_input_bounds.bounds(clamped)==[(1,1)]*3
clamped['a']['value']=[-3,-3,-3];clamped['b']['value']=[-2,-2,-2]
assert normal_input_bounds.bounds(clamped)==[(0,0)]*3

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;eevee='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE';scene.render.engine=eevee
mesh=bpy.data.meshes.new('Native tangent normal');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update();mesh.polygons[0].use_smooth=True
for name in ['EditUV','RenderUV']:
    uv=mesh.uv_layers.new(name=name)
    for value,xy in zip(uv.data,[(0,0),(1,0),(0,1)]):value.uv=xy
mesh.uv_layers.active_index=0;mesh.uv_layers['RenderUV'].active_render=True
owner=bpy.data.objects.new('Native normal owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Unmarked native tangent normal');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
node=tree.nodes.new('ShaderNodeNormalMap');node.space='TANGENT';node.uv_map='EditUV';node.inputs['Color'].default_value=(.8,.6,.9,1)
tree.links.new(node.outputs[0],bsdf.inputs['Normal'])

def plan(module=compiler):return module.plan_materials([owner],purpose='final',automatic_programs=True)
assert not plan().errors
node.inputs['Color'].default_value=(.5,.5,.5,1)
assert any('nonzero native normal' in issue.problem for issue in plan().errors)
node.inputs['Color'].default_value=(.5,.5,.5000001,1)
assert plan().errors
node.inputs['Color'].default_value=(.8,.6,.9,1)
owner.scale.x=.1;bpy.context.view_layer.update()
assert any('poorly conditioned' in issue.problem for issue in plan().errors)
owner.scale.x=1;bpy.context.view_layer.update()

with tempfile.TemporaryDirectory(prefix='blendlink-normal-range-') as directory:
    image=bpy.data.images.new('Opaque normal byte PNG',width=257,height=257,alpha=True,float_buffer=False,is_data=True)
    image.colorspace_settings.name='Non-Color';image.file_format='PNG';image.filepath_raw=str(Path(directory)/'normal.png')
    values=np.tile(np.asarray([.75,.4,.9,1],np.float32),257*257);image.pixels.foreach_set(values);image.save();image.pack()
    texture=tree.nodes.new('ShaderNodeTexImage');texture.image=image;tree.links.new(texture.outputs['Color'],node.inputs['Color'])
    result=plan();assert not result.errors,result.errors
    decision=result.decisions[0];assert decision.channel_plan['automatic']
    channel=next(channel for channel in decision.channel_plan['channels'] if channel['channel']=='Normal')
    ir=channel['tslIr']['output']['input']
    assert ir['op']=='normal_map_tangent_native' and ir['frame']['uvMap']=='EditUV'
    assert ir['color']['op']=='texture_ref' and ir['color']['vector']=={'op':'uv_active'},ir
    extras=compiler._tsl_runtime_mesh_entry(decision,owner)
    assert extras['uvChannels']=={'EditUV':0,'RenderUV':1},extras
    assert extras['activeRenderUv']=={'schemaVersion':1,'model':'source-active-render-v1','uvMap':'RenderUV','channel':1},extras
    values[3::4]=.5;image.pixels.foreach_set(values)
    assert any('opaque image' in issue.problem for issue in plan().errors)
    values[3::4]=1;image.pixels.foreach_set(values)
    assert not plan().errors
    name='blendlink_tangent_normal_qualified_check'
    spec=importlib.util.spec_from_file_location(name,addon/'__init__.py',submodule_search_locations=[str(addon)])
    package=importlib.util.module_from_spec(spec);sys.modules[name]=package;spec.loader.exec_module(package)
    assert not plan(package.material_compiler).errors

# Existing serialized/verified Cycles normal-map behavior stays on its legacy
# opcode; the fresh EEVEE frame must not accidentally replace that route.
tree.nodes.remove(texture);node.uv_map='';scene.render.engine='CYCLES'
legacy=tsl_ir.emit_output(node,node.outputs[0]);assert legacy['op']=='normal_map',legacy
print('BLENDLINK_TANGENT_NORMAL_DOMAIN_PASSED '+bpy.app.version_string)
