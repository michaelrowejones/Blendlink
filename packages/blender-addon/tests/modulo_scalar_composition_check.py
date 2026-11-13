# SPDX-License-Identifier: GPL-3.0-or-later
"""Remainder is scalar, and only an authored Clamp establishes unit bounds."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import unit_roughness
from color_ir import _unit_bounded
from normal_input_bounds import bounds,coefficients
from math_modulo_native_ir import qualified_modulo_scalar,REFUSAL
literal=lambda value:{'op':'const_float','value':value}
raw={'op':'math_modulo_native','precisionModel':'mf-fmod100000-v1','inputModel':'literal-f32-v1','input':literal(1638499968)}
clamped={'op':'clamp_minmax','value':raw,'min':literal(0),'max':literal(1)}
assert qualified_modulo_scalar(raw) and not _unit_bounded(raw) and not unit_roughness(raw)
assert unit_roughness(clamped) and bounds(clamped)==[(0,1)]*3
assert coefficients({'op':'const_vec3','value':[.75,.5,1]},clamped,'OPENGL')[0]>0
for changes in [{'precisionModel':'future'},{'inputModel':'future'},{'input':literal(1)},{'input':literal(-1e9)}]:
    invalid={**raw,**changes};assert not qualified_modulo_scalar(invalid)
    try:bounds({**clamped,'value':invalid,'range':[0,1]});raise AssertionError('Invalid remainder granted finite normal bounds')
    except ValueError:pass
material=bpy.data.materials.new('Modulo scalar composition');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links
modulo=nodes.new('ShaderNodeMath');modulo.operation='MODULO';modulo.inputs[0].default_value=1638499968;modulo.inputs[1].default_value=100000
clamp=nodes.new('ShaderNodeClamp');links.new(modulo.outputs[0],clamp.inputs['Value'])
noise=nodes.new('ShaderNodeTexNoise');noise.noise_dimensions='2D';noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=2
point=nodes.new('ShaderNodeCombineXYZ');point.inputs[0].default_value=.125;point.inputs[1].default_value=.25;links.new(point.outputs[0],noise.inputs['Vector'])
try:
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        known=bpy.app.version >= (5,0,0) or bpy.context.preferences.system.gpu_backend=='METAL'
        if known:
            links.new(modulo.outputs[0],noise.inputs['Roughness'])
            try:tsl_ir.emit_output(noise,noise.outputs['Fac']);raise AssertionError('Raw remainder acquired a unit certificate')
            except tsl_ir.TslIrRefusal as error:assert 'proven [0,1]' in str(error)
            links.new(clamp.outputs[0],noise.inputs['Roughness'])
            before=(len(nodes),len(links),tuple(x.default_value for x in modulo.inputs))
            expression=tsl_ir.emit_output(noise,noise.outputs['Fac'])
            assert expression['op']=='noise_varying_native' and unit_roughness(expression['roughnessNode'])
            assert before==(len(nodes),len(links),tuple(x.default_value for x in modulo.inputs))
            rgb=nodes.new('ShaderNodeCombineXYZ');rgb.inputs[1].default_value=.25;rgb.inputs[2].default_value=.5;links.new(modulo.outputs[0],rgb.inputs[0])
            hsl=nodes.new('ShaderNodeSeparateColor');hsl.mode='HSL';links.new(rgb.outputs[0],hsl.inputs[0])
            try:tsl_ir.emit_output(hsl,hsl.outputs[1]);raise AssertionError('Raw remainder acquired a unit HSL certificate')
            except tsl_ir.TslIrRefusal as error:assert 'bounds are unknown' in str(error)
            links.new(clamp.outputs[0],rgb.inputs[0]);assert tsl_ir.emit_output(hsl,hsl.outputs[1])['input']['inputDomain']=='unit-bounded-live'
            normal=nodes.new('ShaderNodeNormalMap');normal.space='TANGENT';normal.uv_map='UVMap';normal.inputs['Color'].default_value=(.75,.5,1,1)
            links.new(clamp.outputs[0],normal.inputs['Strength'])
            assert tsl_ir.emit_output(normal,normal.outputs[0])['op']=='normal_map_tangent_native'
            if bpy.app.version >= (5,0,0):
                noise.inputs['Distortion'].default_value=.37
                try:tsl_ir.emit_output(noise,noise.outputs['Fac']);raise AssertionError('Shape fix broadened the MF nonzero-D precision grammar')
                except tsl_ir.TslIrRefusal as error:assert 'exact MF coordinate inputs' in str(error)
        else:
            try:tsl_ir.emit_output(modulo,modulo.outputs[0]);raise AssertionError('Unknown legacy source backend acquired a Modulo profile')
            except tsl_ir.TslIrRefusal as error:assert str(error)==REFUSAL
finally:bpy.data.materials.remove(material)
print('BLENDLINK_MODULO_SCALAR_COMPOSITION_PASSED raw/HSL unit refusal, Clamp/Roughness/normal bounds, conservative MF')
