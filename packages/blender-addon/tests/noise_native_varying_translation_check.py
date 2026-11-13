# SPDX-License-Identifier: GPL-3.0-or-later
"""New EEVEE live-amplitude capability; actual scalar bounds and old IR preserved."""
from pathlib import Path
import ast
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import unit_roughness, native_distortion_mf_inputs
from color_ir import _unit_bounded
from shader_domains import native_shader_input_evaluation
reference=Path(__file__).resolve().parents[3]/'experiments/noise-fractal-differential/reference.py'
function=next(node for node in ast.parse(reference.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=='native_live_distortion_refusal')
namespace={};exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(reference),'exec'),namespace)
qualifies=namespace['native_live_distortion_refusal']
reason='Native normalized live Roughness nonzero Distortion requires verified Metal 1D shader or native MF inputs; use source baking'
case={'kind':'noise','normalize':True,'type':'FBM','roughnessStage':'image','Distortion':.37}
assert qualifies(case,'BLENDER_EEVEE',True,reason)
for changes in [{'normalize':False},{'type':'MULTIFRACTAL'},{'Distortion':0},{'roughnessStage':None}]:
    assert not qualifies({**case,**changes},'BLENDER_EEVEE',True,reason)
assert not qualifies(case,'CYCLES',True,reason)
assert not qualifies(case,'UNKNOWN',True,reason)
assert not qualifies(case,'BLENDER_EEVEE',False,reason)
assert not qualifies(case,'BLENDER_EEVEE',True,reason+' unrelated suffix')
assert not qualifies({**case,'dimensions':'1D'},'BLENDER_EEVEE',True,reason)
assert qualifies({**case,'dimensions':'1D'},'BLENDER_EEVEE',True,reason,'OPENGL',(5,3,0))
assert not qualifies({**case,'dimensions':'3D','stage':'constant'},'BLENDER_EEVEE',True,reason,'METAL',(5,3,0))
assert qualifies({**case,'dimensions':'3D','stage':'constant'},'BLENDER_EEVEE',True,reason,'METAL',(4,2,0))
mf_reason='Native normalized live Roughness nonzero Distortion requires exact MF coordinate inputs and portable constant arithmetic; use source baking'
precision={**case,'dimensions':'3D','stage':'constant','inputCancellationAxis':'rho'}
assert qualifies(precision,'BLENDER_EEVEE',True,mf_reason,'METAL',(5,3,0))
assert not qualifies({**precision,'inputCancellationAxis':'unknown'},'BLENDER_EEVEE',True,mf_reason,'METAL',(5,3,0))
assert not qualifies({**precision,'inputCancellationAxis':'x'},'BLENDER_EEVEE',True,mf_reason,'METAL',(5,3,0))
assert qualifies({**precision,'inputCancellationAxis':'x'},'BLENDER_EEVEE',True,mf_reason,'OPENGL',(5,3,0))
assert not qualifies(precision,'BLENDER_EEVEE',True,mf_reason+' unrelated suffix','METAL',(5,3,0))
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
        noise.noise_dimensions='3D'
        for name,value,message in [('Detail',3,'static Detail <= 2'),('Scale',81,'exceeds the proven range'),('Distortion',.37,'requires verified Metal'),('Distortion',-1,'requires verified Metal'),('Distortion',1,'requires verified Metal')]:
            old=noise.inputs[name].default_value;noise.inputs[name].default_value=value
            try:
                emit();raise AssertionError('Native varying inherited broader static controls')
            except tsl_ir.TslIrRefusal as error:assert message in str(error),str(error)
            finally:noise.inputs[name].default_value=old
        noise.noise_dimensions='1D'
        for distortion in [-1,.37,1,2**-35]:
            noise.inputs['Distortion'].default_value=distortion
            if bpy.context.preferences.system.gpu_backend=='METAL':
                result=emit('Color')
                assert result['distortionModel']=='metal-1d-fma-f32-v1' and result['distortion']==noise.inputs['Distortion'].default_value
                assert len(result['distortionOffsets'])==1 and len(result['distortionOffsets'][0])==1
            else:
                try:emit();raise AssertionError('Unmeasured shader backend admitted nonzero Distortion')
                except tsl_ir.TslIrRefusal as error:assert 'requires verified Metal' in str(error)
        literal_distortion=nodes.new('ShaderNodeValue');literal_distortion.outputs[0].default_value=.37
        links.new(literal_distortion.outputs[0],noise.inputs['Distortion'])
        if bpy.context.preferences.system.gpu_backend=='METAL':
            assert emit('Color')['distortionModel']=='metal-1d-fma-f32-v1'
        else:
            try:emit();raise AssertionError('Value link widened the measured source backend')
            except tsl_ir.TslIrRefusal as error:assert 'requires verified Metal' in str(error)
        links.remove(noise.inputs['Distortion'].links[0])
        noise.inputs['Distortion'].default_value=0;noise.noise_dimensions='3D'
        links.new(separate.outputs[0],noise.inputs['Roughness'])
        try:
            emit();raise AssertionError('Unproven scalar Roughness was admitted')
        except tsl_ir.TslIrRefusal as error:assert 'proven [0,1]' in str(error)
        links.new(clamp.outputs[0],noise.inputs['Roughness'])
        # Python-double folding says zero; native node-by-node float32 says
        # -1. This must not silently enter the zero-Distortion capability.
        first=nodes.new('ShaderNodeMath');first.operation='ADD';first.inputs[0].default_value=1e8;first.inputs[1].default_value=1
        second=nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;links.new(first.outputs[0],second.inputs[0])
        third=nodes.new('ShaderNodeMath');third.operation='SUBTRACT';third.inputs[1].default_value=1;links.new(second.outputs[0],third.inputs[0]);links.new(third.outputs[0],noise.inputs['Distortion'])
        assert tsl_ir._fold_constant_scalar(tsl_ir.emit_input(noise.inputs['Distortion']))==0
        try:
            emit();raise AssertionError('Double-folded zero acquired a native D0 certificate')
        except tsl_ir.TslIrRefusal as error:assert 'literal float32 Distortion' in str(error)
        links.remove(noise.inputs['Roughness'].links[0])
        for normalized in [True,False]:
            noise.normalize=normalized
            try:
                emit();raise AssertionError('Static normalized/signed Noise inherited double-folded Distortion')
            except tsl_ir.TslIrRefusal as error:assert str(error)=='Native Noise requires literal float32 Distortion; linked arithmetic needs source baking'
        noise.normalize=True;links.new(clamp.outputs[0],noise.inputs['Roughness'])
        literal=nodes.new('ShaderNodeValue');literal.outputs[0].default_value=-0.0;links.new(literal.outputs[0],noise.inputs['Distortion'])
        assert 'distortion' not in emit(),'Exact literal Value link lost D0 admission'
        links.remove(noise.inputs['Roughness'].links[0]);literal.outputs[0].default_value=.37
        for normalized in [True,False]:
            noise.normalize=normalized;result=emit()
            assert result['op']==('noise_normalized' if normalized else 'noise_fractal')
            assert result['distortion']==literal.outputs[0].default_value
        literal.outputs[0].default_value=0;noise.normalize=True;links.new(clamp.outputs[0],noise.inputs['Roughness'])
        links.remove(noise.inputs['Distortion'].links[0])
        noise.normalize=False;assert emit()['op']=='noise_varying'
        noise.noise_type='MULTIFRACTAL';assert emit()['op']=='noise_varying'
        noise.noise_type='FBM';noise.normalize=True
        literal=nodes.new('ShaderNodeCombineXYZ');literal.inputs[0].default_value=.125;literal.inputs[1].default_value=.25;literal.inputs[2].default_value=.375
        rho=nodes.new('ShaderNodeTexNoise');rho.inputs['Scale'].default_value=1;rho.inputs['Detail'].default_value=0
        links.new(literal.outputs[0],rho.inputs['Vector']);links.new(rho.outputs['Fac'],clamp.inputs['Value']);links.new(literal.outputs[0],noise.inputs['Vector'])
        for dimension in ['1D','2D','3D','4D']:
            noise.noise_dimensions=dimension;noise.inputs['Distortion'].default_value=.37
            if bpy.app.version >= (5,0,0) and bpy.context.preferences.system.gpu_backend=='METAL':
                result=emit('Color');assert result['evaluationModel']=='shader-mf'
                assert result['distortionModel']=='native-mf-f32-v1' and native_distortion_mf_inputs(result)
                forged={**result,'input':{'op':'uv','constant':True},'evaluationModel':'shader-mf'}
                assert not native_distortion_mf_inputs(forged)
            elif dimension!='1D' or bpy.context.preferences.system.gpu_backend!='METAL':
                try:emit();raise AssertionError('Unmeasured native MF source admitted nonzero Distortion')
                except tsl_ir.TslIrRefusal as error:assert 'requires verified Metal' in str(error)
finally:bpy.data.materials.remove(material)
print('BLENDLINK_NATIVE_VARYING_NOISE_TRANSLATION_PASSED EEVEE-only capability, scalar proof, named limits, old Cycles/raw serialization')
