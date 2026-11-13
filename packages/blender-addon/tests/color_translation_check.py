# SPDX-License-Identifier: GPL-3.0-or-later
"""Native shader color schemas and finite HSL admission contracts."""
import json
from pathlib import Path
import sys
import platform
import bpy

ADDON = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ADDON))
sys.path.insert(0, str(ADDON.parent / 'blendlink/blender'))
import tsl_ir

material = bpy.data.materials.new('Native shader color translation')
material.use_nodes = True
tree = material.node_tree
combine = tree.nodes.new('ShaderNodeCombineColor')
separate = tree.nodes.new('ShaderNodeSeparateColor')
assert [item.identifier for item in combine.inputs] == ['Red', 'Green', 'Blue']
assert [item.identifier for item in separate.outputs] == ['Red', 'Green', 'Blue']
assert len(combine.outputs) == 1 and len(separate.inputs) == 1
source = tree.nodes.new('ShaderNodeCombineXYZ')
for index, value in enumerate([.2, .4, .7]): source.inputs[index].default_value = value
tree.links.new(source.outputs[0], separate.inputs[0])
try:
    for engine in ['CYCLES', 'EEVEE']:
        with tsl_ir.emission_context(evaluation_engine=engine):
            for mode in ['RGB', 'HSV', 'HSL']:
                combine.mode = separate.mode = mode
                before = (len(tree.nodes), len(tree.links), len(bpy.data.node_groups))
                combined = tsl_ir.emit_output(combine, combine.outputs[0])
                assert combined['op'] == 'color_convert' and combined['mode'] == mode
                assert combined['direction'] == 'combine' and combined['sourceEngine'] == engine
                for index, socket in enumerate(separate.outputs):
                    split = tsl_ir.emit_output(separate, socket)
                    assert split['op'] == 'separate' and split['channel'] == ['x', 'y', 'z'][index]
                    assert split['input']['op'] == 'color_convert' and split['input']['mode'] == mode
                    assert split['input']['direction'] == 'separate'
                    json.dumps(split, allow_nan=False)
                assert before == (len(tree.nodes), len(tree.links), len(bpy.data.node_groups))
            separate.mode = 'HSL'
            for values in [[-.3, 0, .3], [.5, 1, 1.5]]:
                for index, value in enumerate(values): source.inputs[index].default_value = value
                try:
                    tsl_ir.emit_output(separate, separate.outputs[0])
                    raise AssertionError('Native saturation singularity was admitted')
                except tsl_ir.TslIrRefusal as error:
                    assert 'undefined saturation' in str(error)
            attribute = tree.nodes.new('ShaderNodeAttribute')
            attribute.attribute_type = 'OBJECT'
            attribute.attribute_name = 'unbounded_color'
            link = tree.links.new(attribute.outputs['Color'], separate.inputs[0])
            try:
                tsl_ir.emit_output(separate, separate.outputs[0])
                raise AssertionError('Arbitrary object property acquired a unit color range')
            except tsl_ir.TslIrRefusal as error:
                assert 'bounds are unknown' in str(error)
            tree.links.remove(link)
            # Reconnect a valid static input for the next engine.
            for index, value in enumerate([.2, .4, .7]): source.inputs[index].default_value = value
            tree.links.new(source.outputs[0], separate.inputs[0])
            coordinates = tree.nodes.new('ShaderNodeTexCoord')
            noise = tree.nodes.new('ShaderNodeTexNoise')
            noise.inputs['Scale'].default_value = 1
            noise.inputs['Detail'].default_value = 0
            tree.links.new(coordinates.outputs['UV'], noise.inputs['Vector'])
            tree.links.new(noise.outputs['Color'], separate.inputs[0])
            # This positive shader fixture targets EEVEE. Fresh Cycles on
            # unmeasured CPU profiles must keep its named bake qualification.
            if engine == 'CYCLES' and tsl_ir._normalized_noise_source_profile(
                    engine, sys.platform, platform.machine(), bpy.context.scene.cycles.device) is None:
                try:
                    tsl_ir.emit_output(separate, separate.outputs[0])
                    raise AssertionError('Unmeasured Cycles Noise inherited an EEVEE source profile')
                except tsl_ir.TslIrRefusal as error:
                    assert 'no verified live source precision profile' in str(error) and 'CYCLES' in str(error)
            with tsl_ir.emission_context(evaluation_engine='EEVEE'):
                try:
                    tsl_ir.emit_output(separate, separate.outputs[0])
                    raise AssertionError('Normalized 3D Noise acquired a false unit HSL range')
                except tsl_ir.TslIrRefusal as error: assert 'bounds are unknown' in str(error)
                # A real authored Clamp, rather than Normalize, restores a
                # portable unit input for downstream saturation arithmetic.
                clamp = tree.nodes.new('ShaderNodeClamp')
                tree.links.new(noise.outputs['Fac'], clamp.inputs['Value'])
                tree.links.new(clamp.outputs[0], separate.inputs[0])
                assert tsl_ir.emit_output(separate, separate.outputs[0])['input']['inputDomain'] == 'unit-bounded-live'
                tree.links.new(noise.outputs['Color'], separate.inputs[0])
            noise.normalize = False
            signed_noise = tsl_ir.emit_output(noise, noise.outputs['Color'])
            assert signed_noise['op'] == 'noise_fractal' and signed_noise['normalize'] is False
            try:
                tsl_ir.emit_output(separate, separate.outputs[0])
                raise AssertionError('Unnormalized noise acquired a unit HSL range')
            except tsl_ir.TslIrRefusal as error: assert 'bounds are unknown' in str(error)
            noise.normalize = True
            noise.noise_type = 'MULTIFRACTAL'
            multifractal = tsl_ir.emit_output(noise, noise.outputs['Color'])
            assert multifractal['op'] == 'noise_fractal' and multifractal['noiseType'] == 'MULTIFRACTAL'
            try:
                tsl_ir.emit_output(separate, separate.outputs[0])
                raise AssertionError('Multifractal noise acquired a unit HSL range')
            except tsl_ir.TslIrRefusal as error: assert 'bounds are unknown' in str(error)
            ramp = tree.nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.interpolation = 'CARDINAL'
            ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
            ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
            for position in [.2, .8]: ramp.color_ramp.elements.new(position).color = (1, 1, 1, 1)
            ramp_coordinate = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(coordinates.outputs['UV'], ramp_coordinate.inputs[0])
            tree.links.new(ramp_coordinate.outputs[0], ramp.inputs['Fac'])
            peak = max(ramp.color_ramp.evaluate(index / 256)[0] for index in range(257))
            assert peak == 1, ('Native Cardinal clipping changed', peak)
            tree.links.new(ramp.outputs['Color'], separate.inputs[0])
            sampled = tsl_ir.emit_output(separate, separate.outputs[0])['input']
            assert sampled['input']['op'] == 'ramp_lut'
            assert sampled['inputDomain'] == 'unit-bounded-live'
            assert all(0 <= value <= 1 for index, value in enumerate(sampled['input']['values']) if index % 4 < 3)
            blend = tree.nodes.new('ShaderNodeMixRGB')
            blend.blend_type = 'ADD'
            blend.inputs['Color1'].default_value = (.8, .8, .8, 1)
            blend.inputs['Color2'].default_value = (.8, .8, .8, 1)
            tree.links.new(blend.outputs[0], separate.inputs[0])
            try:
                tsl_ir.emit_output(separate, separate.outputs[0])
                raise AssertionError('Unclamped Add blend acquired unit HSL bounds')
            except tsl_ir.TslIrRefusal as error: assert 'bounds are unknown' in str(error)
            blend.use_clamp = True
            assert tsl_ir.emit_output(separate, separate.outputs[0])['input']['inputDomain'] == 'unit-bounded-live'
            tree.links.new(source.outputs[0], separate.inputs[0])
finally:
    bpy.data.materials.remove(material, do_unlink=True)
print('BLENDLINK_COLOR_TRANSLATION_PASSED RGB/HSV/HSL, native three-channel schemas, finite admission and ownership')
