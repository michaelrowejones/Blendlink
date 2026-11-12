# SPDX-License-Identifier: GPL-3.0-or-later
"""Linked Wave distortion preserves its live graph and named octave limits."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
material = bpy.data.materials.new('Wave admission')
material.use_nodes = True
tree = material.node_tree
node = tree.nodes.new('ShaderNodeTexWave')
source = tree.nodes.new('ShaderNodeValue')
source.outputs[0].default_value = -.7
link = tree.links.new(source.outputs[0], node.inputs['Distortion'])
try:
    for output in ['Fac', 'Color']:
        result = tsl_ir.emit_output(node, node.outputs[output])
        assert result['op'] == 'tex_wave' and result['distortionNode']['value'] == source.outputs[0].default_value
    for detail in [-.5, 3]:
        node.inputs['Detail'].default_value = detail
        assert node.inputs['Detail'].default_value == detail, 'Native RNA parameter boundary changed'
        try:
            tsl_ir.emit_output(node, node.outputs['Fac'])
            raise AssertionError('Unsupported negative/high-octave detail was silently clamped or admitted')
        except tsl_ir.TslIrRefusal as error: assert 'outside the proven range [0,2]' in str(error)
    node.inputs['Detail'].default_value = 2
    detail_link = tree.links.new(source.outputs[0], node.inputs['Detail'])
    try:
        tsl_ir.emit_output(node, node.outputs['Fac'])
        raise AssertionError('Dynamic octave count was accepted without a proven kernel')
    except tsl_ir.TslIrRefusal as error: assert 'linked Detail' in str(error)
    tree.links.remove(detail_link)
    roughness_link = tree.links.new(source.outputs[0], node.inputs['Detail Roughness'])
    try:
        tsl_ir.emit_output(node, node.outputs['Fac'])
        raise AssertionError('Unbounded or negative roughness silently acquired a clamp')
    except tsl_ir.TslIrRefusal as error: assert 'proven [0,1]' in str(error)
    source.outputs[0].default_value = .5
    assert 'detailRoughnessNode' in tsl_ir.emit_output(node, node.outputs['Fac'])
    tree.links.remove(link)
    node.inputs['Distortion'].default_value = 0
    result = tsl_ir.emit_output(node, node.outputs['Fac'])
    assert result['detail'] == 0 and 'distortionNode' not in result and 'detailRoughnessNode' not in result, 'Dead zero-distortion noise added an octave dependency'
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_WAVE_TRANSLATION_PASSED live distortion, retained octave limits and zero-distortion dead-input pruning')
