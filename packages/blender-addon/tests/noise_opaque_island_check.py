# SPDX-License-Identifier: GPL-3.0-or-later
"""Native-backed read-only source admission for mixed Noise coordinate inputs."""
from pathlib import Path
import json
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_static_inputs import constant_input, has_inexact_constant_island, ISLAND_MESSAGE, INSPECTION_MESSAGE
literal = lambda value: {'op': 'const_float', 'value': value}
def refuse(message): raise tsl_ir.TslIrRefusal(message)

def island(direction):
    return {'op':'math','operation':'SUBTRACT','a':{'op':'math','operation':'SUBTRACT',
        'a':{'op':'math','operation':'ADD','a':literal(1e8),'b':literal(direction)},'b':literal(1e8)},'b':literal(direction)}
for direction in (-1,1):
    unsafe = island(direction)
    opaque = {'op':'math','operation':'ADD','a':{'op':'separate','channel':'y','input':{'op':'tex_image'}},'b':unsafe}
    assert constant_input(opaque) is None and has_inexact_constant_island(opaque,refuse=refuse)
    assert not has_inexact_constant_island({'op':'math','operation':'ADD','a':{'op':'separate','channel':'y','input':{'op':'tex_image'}},
        'b':{'op':'math','operation':'MULTIPLY','a':literal(.5),'b':literal(.25)}},refuse=refuse)
    assert not has_inexact_constant_island({'op':'noise_normalized','evaluationModel':'shader-mf','input':unsafe},refuse=refuse)
# Unknown operators and image/kernel boundaries do not acquire a universal
# arithmetic claim from this particular witness scanner.
assert not has_inexact_constant_island({'op':'tex_image','vector':island(1)},refuse=refuse)
cycle={'op':'math'};cycle['a']=cycle
try:has_inexact_constant_island(cycle,refuse=refuse);raise AssertionError('Unbounded input inspection admitted')
except tsl_ir.TslIrRefusal as error:assert str(error)==INSPECTION_MESSAGE

scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0,0) else 'BLENDER_EEVEE'
material=bpy.data.materials.new('Mixed Noise arithmetic admission');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links;nodes.clear()
image=bpy.data.images.new('Mixed Noise exact input',width=1,height=1,alpha=True,float_buffer=True)
image.colorspace_settings.name='Non-Color';image.use_half_precision=False;image.pixels[:]=(.25,.5,.75,1)
texture=nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Closest'
noise=nodes.new('ShaderNodeTexNoise');noise.noise_dimensions='4D';noise.noise_type='FBM';noise.normalize=False;noise.inputs['Detail'].default_value=0
components=nodes.new('ShaderNodeSeparateXYZ');links.new(texture.outputs['Color'],components.inputs[0])
links.new(texture.outputs['Color'],noise.inputs['Vector'])
emission=nodes.new('ShaderNodeEmission');links.new(noise.outputs['Color'],emission.inputs['Color'])
cases=[]
for direction in (-1,1):
    first=nodes.new('ShaderNodeMath');first.operation='ADD';first.inputs[0].default_value=1e8;first.inputs[1].default_value=direction
    second=nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;links.new(first.outputs[0],second.inputs[0])
    third=nodes.new('ShaderNodeMath');third.operation='SUBTRACT';third.inputs[1].default_value=direction;links.new(second.outputs[0],third.inputs[0])
    add=nodes.new('ShaderNodeMath');add.operation='ADD';links.new(components.outputs[1],add.inputs[0]);links.new(third.outputs[0],add.inputs[1]);links.new(add.outputs[0],noise.inputs['W'])
    before=(len(nodes),len(links),len(bpy.data.materials),len(bpy.data.node_groups))
    try:tsl_ir.emit_channel(emission.inputs['Color']);raise AssertionError('Mixed opaque inexact arithmetic admitted')
    except tsl_ir.TslIrRefusal as error:assert str(error)==ISLAND_MESSAGE,str(error)
    assert before==(len(nodes),len(links),len(bpy.data.materials),len(bpy.data.node_groups))
    first.inputs[0].default_value=.125;first.inputs[1].default_value=.25;links.new(first.outputs[0],add.inputs[1])
    assert tsl_ir.emit_channel(emission.inputs['Color'])['output']['op']=='noise_fractal'
    cases.append(direction)
print('BLENDLINK_NOISE_OPAQUE_ISLAND_CHECK_PASSED '+json.dumps({'blender':bpy.app.version_string,'cases':cases}))
