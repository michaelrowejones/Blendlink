# SPDX-License-Identifier: GPL-3.0-or-later
"""Renderer-dependent Color Ramp paths retain defined native semantics."""
from pathlib import Path
import sys
import bpy

ADDON = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADDON))
sys.path.insert(0, str(ADDON.parent / 'blendlink/blender'))
import tsl_ir

material = bpy.data.materials.new('Native Color Ramp Context')
material.use_nodes = True
tree = material.node_tree
ramp = tree.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.interpolation = 'CARDINAL'
coordinates = tree.nodes.new('ShaderNodeTexCoord')
separate = tree.nodes.new('ShaderNodeSeparateXYZ')
tree.links.new(coordinates.outputs['UV'], separate.inputs[0])
link = tree.links.new(separate.outputs[0], ramp.inputs['Fac'])
try:
    for engine in ['CYCLES', 'EEVEE']:
        with tsl_ir.emission_context(evaluation_engine=engine):
            dynamic = tsl_ir.emit_output(ramp, ramp.outputs['Color'])
            assert dynamic['op'] == 'ramp_lut'
            assert dynamic['model'] == ('cycles' if engine == 'CYCLES' else 'eevee-gpu')
            if engine == 'EEVEE':
                assert dynamic['tableStorage'] == ('rgba16f' if bpy.app.version < (5, 3, 0) else 'rgba32f')
            tree.links.remove(link)
            ramp.inputs['Fac'].default_value = .37
            literal = tsl_ir.emit_output(ramp, ramp.outputs['Color'])
            assert literal['op'] == ('const_vec3' if bpy.app.version >= (5, 0, 0) else 'ramp_lut')
            if literal['op'] == 'const_vec3':
                assert literal['value'] == list(ramp.color_ramp.evaluate(ramp.inputs['Fac'].default_value))[:3]
            constant = tree.nodes.new('ShaderNodeCombineXYZ')
            noise = tree.nodes.new('ShaderNodeTexNoise')
            tree.links.new(constant.outputs[0], noise.inputs['Vector'])
            link = tree.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
            if bpy.app.version >= (5, 0, 0):
                try:
                    tsl_ir.emit_output(ramp, ramp.outputs['Color'])
                    raise AssertionError('Nonliteral MF input silently used the Cycles table')
                except tsl_ir.TslIrRefusal as error:
                    assert 'nonliteral MF Factor' in str(error)
            tree.links.remove(link)
            link = tree.links.new(separate.outputs[0], ramp.inputs['Fac'])
            ramp.color_ramp.elements.remove(ramp.color_ramp.elements[-1])
            ramp.color_ramp.elements[0].color = (.2, .4, .6, .3)
            assert tsl_ir.emit_output(ramp, ramp.outputs['Color'])['op'] == 'const_vec3'
            if engine == 'EEVEE' and bpy.app.version >= (4, 4, 0):
                ramp.outputs['Alpha'].default_value = .7
                alpha = tsl_ir.emit_output(ramp, ramp.outputs['Alpha'])
                assert alpha['op'] == 'const_float' and alpha['value'] == ramp.outputs['Alpha'].default_value
            else:
                assert tsl_ir.emit_output(ramp, ramp.outputs['Alpha'])['op'] == 'const_float'
            if engine == 'EEVEE' and bpy.app.version < (4, 4, 0):
                ramp.color_ramp.interpolation = 'LINEAR'
                for output in ['Color', 'Alpha']:
                    result = tsl_ir.emit_output(ramp, ramp.outputs[output])
                    expression = result['input'] if output == 'Alpha' else result
                    assert expression['sourceModel'] == 'eevee-analytic-hidden'
                    assert len(expression['stops']) == 2
                ramp.color_ramp.interpolation = 'CARDINAL'
            # Color is independent of Factor for one stop: an unsupported dead
            # upstream node must not block or add a UV dependency to its color.
            unported = tree.nodes.new('ShaderNodeTexVoronoi')
            unported.feature = 'F2'
            tree.links.new(unported.outputs['Distance'], ramp.inputs['Fac'])
            assert tsl_ir.emit_output(ramp, ramp.outputs['Color'])['op'] == 'const_vec3'
            ramp.color_ramp.elements.new(1)
            link = tree.links.new(separate.outputs[0], ramp.inputs['Fac'])
finally:
    bpy.data.materials.remove(material, do_unlink=True)
print('BLENDLINK_RAMP_CONTEXT_PASSED native tables, literal MF, named limits and dead Factor pruning')
