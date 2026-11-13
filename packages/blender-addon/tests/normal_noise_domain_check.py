# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual source coordinates, fresh Noise inputs and zero-normal refusals."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import material_compiler as compiler
import normal_noise_bounds

def noise_models(value):
    if isinstance(value,dict):
        if value.get('op')=='noise_normalized':yield value['perlinModel']
        for child in value.values():yield from noise_models(child)
    elif isinstance(value,list):
        for child in value:yield from noise_models(child)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Native finite Noise coordinates');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update();mesh.polygons[0].use_smooth=True
layer=mesh.uv_layers.new(name='Normal frame')
for value,xy in zip(layer.data,[(0,0),(1,0),(0,1)]):value.uv=xy
owner=bpy.data.objects.new('Bounded Noise normal owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Unmarked Noise normal');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
normal=tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Color'].default_value=(.8,.6,.9,1)
noise=tree.nodes.new('ShaderNodeTexNoise');noise.normalize=True;noise.inputs['Scale'].default_value=.15;noise.inputs['Detail'].default_value=1
coordinate=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coordinate.outputs['Object'],noise.inputs['Vector'])
tree.links.new(normal.outputs[0],bsdf.inputs['Normal']);tree.links.new(noise.outputs['Fac'],normal.inputs['Strength'])
def plan():return compiler.plan_materials([owner],purpose='final',automatic_programs=True)
for dimension in ['1D','2D','3D','4D']:
    noise.noise_dimensions=dimension
    result=plan();assert not result.errors,result.errors
    models=set(noise_models(result.decisions[0].channel_plan))
    assert models and models<={'native-standard-f32','mf-periodic-f32','eevee-metal-periodic-f32'},models
noise.noise_dimensions='3D'
tree.links.new(coordinate.outputs['Object'],noise.inputs['Vector'])
for vertex in mesh.vertices:vertex.co.x+=1000000
mesh.update();bpy.context.view_layer.update()
result=plan();assert any('non-periodic' in issue.problem for issue in result.errors),result.as_dict()
for vertex in mesh.vertices:vertex.co.x-=1000000
mesh.update();bpy.context.view_layer.update()
assert not plan().errors
tree.links.remove(normal.inputs['Strength'].links[0]);normal.inputs['Strength'].default_value=.125
tree.links.new(noise.outputs['Color'],normal.inputs['Color'])
assert not plan().errors
normal.inputs['Strength'].default_value=1
assert any('nonzero native normal' in issue.problem for issue in plan().errors)
normal.inputs['Strength'].default_value=.125
noise.normalize=False
assert any('no verified finite range' in issue.problem for issue in plan().errors)
noise.normalize=True
assert not plan().errors
for name,value in [('Scale',80),('Detail',6),('Distortion',.2)]:
    old=noise.inputs[name].default_value;noise.inputs[name].default_value=value
    assert any('higher frequencies need native coordinate transport proof' in issue.problem for issue in plan().errors)
    noise.inputs[name].default_value=old
noise.inputs['Scale'].default_value=.3;noise.inputs['Detail'].default_value=.1;noise.inputs['Roughness'].default_value=1;noise.inputs['Lacunarity'].default_value=0
assert any('actual coordinate frequency' in issue.problem for issue in plan().errors)
noise.inputs['Scale'].default_value=.15;noise.inputs['Detail'].default_value=1;noise.inputs['Roughness'].default_value=.5;noise.inputs['Lacunarity'].default_value=2
scaled=tree.nodes.new('ShaderNodeVectorMath');scaled.operation='SCALE';scaled.inputs['Scale'].default_value=80
tree.links.new(coordinate.outputs['Object'],scaled.inputs[0]);tree.links.new(scaled.outputs['Vector'],noise.inputs['Vector'])
assert any('actual coordinate frequency' in issue.problem for issue in plan().errors)
tree.links.new(coordinate.outputs['Object'],noise.inputs['Vector'])
assert not plan().errors
tree.links.remove(noise.inputs['Vector'].links[0])
assert not plan().errors  # Flat-mesh Generated Z is constant despite tiny texspace thickness.
tree.links.new(coordinate.outputs['Object'],noise.inputs['Vector'])
sample={'op':'noise_normalized','normalize':True,'noiseType':'FBM','perlinModel':'eevee-metal-periodic-f32',
        'dimensions':3,'detail':1,'roughness':.5,'lacunarity':2,'scale':{'op':'const_float','value':.15},'output':'fac'}
for model in ['native-standard-f32','mf-periodic-f32','eevee-metal-periodic-f32']:
    assert normal_noise_bounds.amplitude({**sample,'perlinModel':model})==[(-1.01,2.01)]*3
for model in ['eevee-periodic-f32','cycles-neon-periodic-fma','unknown']:
    try:normal_noise_bounds.amplitude({**sample,'perlinModel':model})
    except ValueError:pass
    else:raise AssertionError('Unproved Normal Noise precision model silently admitted: '+model)
print('BLENDLINK_NORMAL_NOISE_DOMAIN_PASSED '+bpy.app.version_string)
