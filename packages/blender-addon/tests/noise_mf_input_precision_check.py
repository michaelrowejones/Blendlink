# SPDX-License-Identifier: GPL-3.0-or-later
"""MF staticness cannot certify generic browser arithmetic rounding."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import native_distortion_mf_inputs, NATIVE_MF_NOISE_INPUT_MESSAGE, NATIVE_SHADER_NOISE_INPUT_MESSAGE
material=bpy.data.materials.new('MF input precision');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links
root=nodes.new('ShaderNodeTexNoise');root.inputs['Scale'].default_value=1;root.inputs['Detail'].default_value=2;root.inputs['Distortion'].default_value=.37
point=nodes.new('ShaderNodeCombineXYZ')
for socket,value in zip(point.inputs,[.125,-.375,.625]):socket.default_value=value
inner=nodes.new('ShaderNodeTexNoise');inner.inputs['Scale'].default_value=1;inner.inputs['Detail'].default_value=0;links.new(point.outputs[0],inner.inputs['Vector'])
clamp=nodes.new('ShaderNodeClamp');links.new(inner.outputs['Fac'],clamp.inputs['Value']);links.new(clamp.outputs[0],root.inputs['Roughness'])
first=nodes.new('ShaderNodeMath');first.operation='ADD';first.inputs[0].default_value=1e8;first.inputs[1].default_value=1
second=nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;links.new(first.outputs[0],second.inputs[0])
third=nodes.new('ShaderNodeMath');third.operation='SUBTRACT';third.inputs[1].default_value=1;links.new(second.outputs[0],third.inputs[0])
bad_point=nodes.new('ShaderNodeCombineXYZ');bad_point.inputs[1].default_value=-.375;bad_point.inputs[2].default_value=.625;links.new(third.outputs[0],bad_point.inputs[0])
scaled=nodes.new('ShaderNodeMath');scaled.operation='MULTIPLY';scaled.inputs[1].default_value=.01;links.new(inner.outputs['Fac'],scaled.inputs[0])
mixed=nodes.new('ShaderNodeMath');mixed.operation='ADD';links.new(scaled.outputs[0],mixed.inputs[0]);links.new(third.outputs[0],mixed.inputs[1])
exact=nodes.new('ShaderNodeMath');exact.operation='MULTIPLY_ADD';exact.inputs[0].default_value=-.375;exact.inputs[1].default_value=.5;exact.inputs[2].default_value=.125
def emit():
    before=(len(nodes),[(x.from_node.name,x.from_socket.identifier,x.to_node.name,x.to_socket.identifier) for x in links])
    try:return tsl_ir.emit_output(root,root.outputs['Color'])
    finally:assert before==(len(nodes),[(x.from_node.name,x.from_socket.identifier,x.to_node.name,x.to_socket.identifier) for x in links])
try:
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        if bpy.app.version < (5,0,0):
            root.noise_dimensions='1D'
            for axis in ['w','rho']:
                links.new(exact.outputs[0],root.inputs['W']);links.new(inner.outputs['Fac'],clamp.inputs['Value'])
                if axis=='w':links.new(third.outputs[0],root.inputs['W'])
                else:links.new(mixed.outputs[0],clamp.inputs['Value'])
                try:emit();raise AssertionError('Shader constant arithmetic acquired a portable scalar profile')
                except tsl_ir.TslIrRefusal as error:assert str(error)==NATIVE_SHADER_NOISE_INPUT_MESSAGE,str(error)
        if bpy.app.version >= (5,0,0):
            for dimension,axis in [('3D','x'),('4D','x'),('4D','w'),('1D','w'),('3D','rho')]:
                root.noise_dimensions=dimension
                links.new(inner.outputs['Fac'],clamp.inputs['Value'])
                if root.inputs.get('Vector'):links.new(point.outputs[0],root.inputs['Vector'])
                if root.inputs.get('W'):links.new(exact.outputs[0],root.inputs['W'])
                if axis=='x':links.new(bad_point.outputs[0],root.inputs['Vector'])
                elif axis=='w':links.new(third.outputs[0],root.inputs['W'])
                else:
                    links.new(mixed.outputs[0],clamp.inputs['Value'])
                    assert tsl_ir._fold_constant_scalar(tsl_ir.emit_input(root.inputs['Roughness'])) is None
                try:emit();raise AssertionError('MF arithmetic staging bypassed the source certificate')
                except tsl_ir.TslIrRefusal as error:assert str(error)==NATIVE_MF_NOISE_INPUT_MESSAGE,str(error)
            links.new(inner.outputs['Fac'],clamp.inputs['Value'])
            for dimension in ['1D','2D','3D','4D']:
                root.noise_dimensions=dimension
                if root.inputs.get('Vector'):links.new(point.outputs[0],root.inputs['Vector'])
                if root.inputs.get('W'):links.new(exact.outputs[0],root.inputs['W'])
                if bpy.context.preferences.system.gpu_backend=='METAL':
                    result=emit();assert result['evaluationModel']=='shader-mf' and native_distortion_mf_inputs(result)
                else:
                    try:emit();raise AssertionError('MF arithmetic certificate widened the GPU backend')
                    except tsl_ir.TslIrRefusal as error:assert 'requires verified Metal' in str(error)
finally:bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_MF_INPUT_PRECISION_PASSED coordinate/W/Rho islands, exact default plumbing, immutable source')
