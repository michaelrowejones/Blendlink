# SPDX-License-Identifier: GPL-3.0-or-later
"""Varying Noise requires an executable scalar-and-unit-range contract."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_varying_ir import unit_roughness
from shader_domains import native_shader_input_evaluation as stage

material = bpy.data.materials.new('Varying Noise admission')
material.use_nodes = True
tree = material.node_tree
node = tree.nodes.new('ShaderNodeTexNoise')
node.inputs['Scale'].default_value = 1
coordinate = tree.nodes.new('ShaderNodeTexCoord')
separate = tree.nodes.new('ShaderNodeSeparateXYZ')
tree.links.new(coordinate.outputs['UV'], separate.inputs[0])
clamp = tree.nodes.new('ShaderNodeClamp')
tree.links.new(separate.outputs[0], clamp.inputs['Value'])
tree.links.new(clamp.outputs[0], node.inputs['Roughness'])
try:
    for kind in ['FBM', 'MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL']:
        node.noise_type = kind
        for normalize in ([True, False] if kind == 'FBM' else [False]):
            node.normalize = normalize
            result = tsl_ir.emit_output(node, node.outputs['Fac'])
            assert result['op'] == ('noise_varying_native' if normalize and tsl_ir.get_evaluation_engine() == 'EEVEE' else 'noise_varying') and result['noiseType'] == kind and result['normalize'] == normalize
            assert result['roughness'] == 1 and unit_roughness(result['roughnessNode'])
            assert stage(result) == 'shader'
    node.inputs['Detail'].default_value = 3
    try:
        tsl_ir.emit_output(node, node.outputs['Fac'])
        raise AssertionError('Varying Roughness inherited static Detail bounds')
    except tsl_ir.TslIrRefusal as error: assert 'static Detail <= 2' in str(error)
    node.inputs['Detail'].default_value = 2
    tree.links.new(separate.outputs[0], node.inputs['Roughness'])
    try:
        tsl_ir.emit_output(node, node.outputs['Fac'])
        raise AssertionError('Unknown Roughness bounds were treated as a unit range')
    except tsl_ir.TslIrRefusal as error: assert 'proven [0,1]' in str(error)
    for expression in [{'op': 'const_vec3', 'value': [.25, .5, .75]}, {'op': 'uv', 'range': [0, 1]}]:
        assert not unit_roughness(expression)
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_VARYING_TRANSLATION_PASSED actual native links, unit scalar proof, named domains and opcode')
