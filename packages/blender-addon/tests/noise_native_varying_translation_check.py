# SPDX-License-Identifier: GPL-3.0-or-later
"""New EEVEE live-amplitude capability; actual scalar bounds and old IR preserved."""
from pathlib import Path
import ast
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import unit_roughness
from color_ir import _unit_bounded
from shader_domains import native_shader_input_evaluation
reference=Path(__file__).resolve().parents[3]/'experiments/noise-fractal-differential/reference.py'
function=next(node for node in ast.parse(reference.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=='native_live_distortion_refusal')
namespace={};exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(reference),'exec'),namespace)
qualifies=namespace['native_live_distortion_refusal']
reason='Native normalized live Roughness requires Distortion = 0; nonzero Distortion needs source baking'
case={'kind':'noise','normalize':True,'type':'FBM','roughnessStage':'image','Distortion':.37}
assert qualifies(case,'BLENDER_EEVEE',True,reason)
for changes in [{'normalize':False},{'type':'MULTIFRACTAL'},{'Distortion':0},{'roughnessStage':None}]:
    assert not qualifies({**case,**changes},'BLENDER_EEVEE',True,reason)
assert not qualifies(case,'CYCLES',True,reason)
assert not qualifies(case,'UNKNOWN',True,reason)
assert not qualifies(case,'BLENDER_EEVEE',False,reason)
assert not qualifies(case,'BLENDER_EEVEE',True,reason+' unrelated suffix')
material=bpy.data.materials.new('Native live normalized Noise');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links
noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=1.5
coordinates=nodes.new('ShaderNodeTexCoord');separate=nodes.new('ShaderNodeSeparateXYZ');clamp=nodes.new('ShaderNodeClamp')
links.new(coordinates.outputs['UV'],separate.inputs[0]);links.new(separate.outputs[0],clamp.inputs['Value']);links.new(clamp.outputs[0],noise.inputs['Roughness'])
def state():
    return (noise.noise_dimensions,noise.noise_type,noise.normalize,noise.inputs['Scale'].default_value,noise.inputs['Detail'].default_value,
        [(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in links],len(nodes),material.users)
def emit(output='Fac'):
    before=state()
    try:return tsl_ir.emit_output(noise,noise.outputs[output])
    finally:assert before==state(),'Emission changed authored nodes, inputs or ownership'
try:
    for engine in ['EEVEE','CYCLES']:
        with tsl_ir.emission_context(evaluation_engine=engine):
            for dimension in ['1D','2D','3D','4D']:
                noise.noise_dimensions=dimension
                for output in ['Fac','Color']:
                    result=emit(output)
                    assert result['op']==('noise_varying_native' if engine=='EEVEE' else 'noise_varying')
                    assert result['roughness']==1 and unit_roughness(result['roughnessNode'])
                    assert result['normalize'] is True and native_shader_input_evaluation(result)=='shader'
                    if engine=='EEVEE':
                        assert result['sourceEngine']=='EEVEE' and result['nativeGpuBackend'] in {'METAL','OPENGL'}
                        assert result['perlinModel']==('eevee-metal-periodic-f32' if result['nativeGpuBackend']=='METAL' else 'native-standard-f32')
                        assert not _unit_bounded(result),'Normalize alone acquired a new output unit proof'
                        if output=='Fac':
                            assert unit_roughness({'op':'clamp_minmax','value':result,'min':{'op':'const_float','value':0},'max':{'op':'const_float','value':1}})
                    else:assert 'perlinModel' not in result,'Existing Cycles varying serialization changed'
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        for name,value,message in [('Detail',3,'static Detail <= 2'),('Scale',81,'exceeds the proven range'),('Distortion',.37,'requires Distortion = 0'),('Distortion',-1,'requires Distortion = 0'),('Distortion',1,'requires Distortion = 0')]:
            old=noise.inputs[name].default_value;noise.inputs[name].default_value=value
            try:
                emit();raise AssertionError('Native varying inherited broader static controls')
            except tsl_ir.TslIrRefusal as error:assert message in str(error),str(error)
            finally:noise.inputs[name].default_value=old
        links.new(separate.outputs[0],noise.inputs['Roughness'])
        try:
            emit();raise AssertionError('Unproven scalar Roughness was admitted')
        except tsl_ir.TslIrRefusal as error:assert 'proven [0,1]' in str(error)
        links.new(clamp.outputs[0],noise.inputs['Roughness'])
        noise.normalize=False;assert emit()['op']=='noise_varying'
        noise.noise_type='MULTIFRACTAL';assert emit()['op']=='noise_varying'
finally:bpy.data.materials.remove(material)
print('BLENDLINK_NATIVE_VARYING_NOISE_TRANSLATION_PASSED EEVEE-only capability, scalar proof, named limits, old Cycles/raw serialization')
