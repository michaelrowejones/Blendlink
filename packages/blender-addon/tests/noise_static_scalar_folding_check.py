# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Noise cannot certify scalar controls through Python-double folds."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import float32_safe_noise_scalar
literal=lambda value:{'op':'const_float','value':value}
assert float32_safe_noise_scalar(literal(.5))
assert not float32_safe_noise_scalar(literal(.1)), 'Non-float32 claimed literal acquired a proof'
assert not float32_safe_noise_scalar(literal(float('inf')))
assert not float32_safe_noise_scalar({'op':'math','operation':'ADD','a':literal(0),'b':literal(0),'range':[0,0]})
assert not float32_safe_noise_scalar({'op':'clamp_minmax','value':literal(.5),'min':literal(1),'max':literal(0)})
material=bpy.data.materials.new('Noise scalar source folding');material.use_nodes=True
nodes=material.node_tree.nodes;links=material.node_tree.links
noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=2
first=nodes.new('ShaderNodeMath');first.operation='SUBTRACT';first.inputs[0].default_value=1e8;first.inputs[1].default_value=1
second=nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;links.new(first.outputs[0],second.inputs[0])
third=nodes.new('ShaderNodeMath');third.operation='ADD';third.inputs[1].default_value=1;links.new(second.outputs[0],third.inputs[0])
value=nodes.new('ShaderNodeValue');value.outputs[0].default_value=.5
clamp=nodes.new('ShaderNodeClamp');links.new(value.outputs[0],clamp.inputs['Value'])
def emit():
    state=(len(nodes),[(x.from_node.name,x.from_socket.identifier,x.to_node.name,x.to_socket.identifier) for x in links])
    try:return tsl_ir.emit_output(noise,noise.outputs['Fac'])
    finally:assert state==(len(nodes),[(x.from_node.name,x.from_socket.identifier,x.to_node.name,x.to_socket.identifier) for x in links])
try:
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        for name,kind in [('Detail','FBM'),('Roughness','FBM'),('Lacunarity','FBM'),('Scale','FBM'),('Offset','HETERO_TERRAIN'),('Gain','HYBRID_MULTIFRACTAL')]:
            noise.noise_type=kind;links.new(third.outputs[0],noise.inputs[name])
            expression=tsl_ir.emit_input(noise.inputs[name])
            assert tsl_ir._fold_constant_scalar(expression)==0 and not float32_safe_noise_scalar(expression)
            try:emit();raise AssertionError('Double arithmetic certified '+name)
            except tsl_ir.TslIrRefusal as error:assert str(error)==f'Noise linked {name} requires literal float32/Clamp inputs; arithmetic folding needs source baking'
            clamp.clamp_type='MINMAX';clamp.inputs['Min'].default_value=1;clamp.inputs['Max'].default_value=0
            links.new(clamp.outputs[0],noise.inputs[name])
            try:emit();raise AssertionError('Reversed MINMAX Clamp acquired a selection certificate')
            except tsl_ir.TslIrRefusal as error:assert 'literal float32/Clamp inputs' in str(error)
            for mode in ['MINMAX','RANGE']:
                clamp.clamp_type=mode
                clamp.inputs['Min'].default_value=0 if mode=='MINMAX' else 1
                clamp.inputs['Max'].default_value=1 if mode=='MINMAX' else 0
                links.new(clamp.outputs[0],noise.inputs[name]);result=emit()
                assert result['op'] in {'noise_normalized','noise_fractal'}
                assert result['scale']['value']==.5 if name=='Scale' else result[name.lower()]==.5
            links.remove(noise.inputs[name].links[0])
        noise.noise_type='FBM'
        assert noise.inputs.get('Offset') is None and noise.inputs.get('Gain') is None
        assert emit()['op']=='noise_normalized', 'Mode-dependent absent sockets acquired a refusal'
finally:bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_STATIC_SCALAR_FOLDING_PASSED 6 controls, literal/Clamp selection, mode-dependent sockets')
