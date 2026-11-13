# SPDX-License-Identifier: GPL-3.0-or-later
"""Native linked Noise roughness cannot silently acquire an upper clamp."""
from pathlib import Path
import platform
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
engines = {item.identifier for item in bpy.context.scene.render.bl_rna.properties['engine'].enum_items}
bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
material = bpy.data.materials.new('Native Noise parameter admission')
material.use_nodes = True
tree = material.node_tree
noise = tree.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 1
source = tree.nodes.new('ShaderNodeValue')
tree.links.new(source.outputs[0], noise.inputs['Roughness'])
try:
    source.outputs[0].default_value = 2
    assert source.outputs[0].default_value == 2, 'Native linked float was incorrectly limited by target UI range'
    for output in ['Fac', 'Color']:
        try:
            tsl_ir.emit_output(noise, noise.outputs[output])
            raise AssertionError('Native linked roughness above1 silently acquired an upper clamp')
        except tsl_ir.TslIrRefusal as error:
            assert 'native linked roughness is not upper-clamped' in str(error)
    for roughness in [0, .5, 1]:
        source.outputs[0].default_value = roughness
        expression = tsl_ir.emit_output(noise, noise.outputs['Fac'])
        assert expression['op'] == 'noise_normalized' and expression['roughness'] == roughness
    noise.normalize = False
    expression = tsl_ir.emit_output(noise, noise.outputs['Fac'])
    assert expression['op'] == 'noise_fractal' and expression['normalize'] is False
    for parameter, value, message in [('Lacunarity', 3, '|Lacunarity| <= 2'), ('Distortion', 2, '[-1,1]')]:
        previous = noise.inputs[parameter].default_value
        noise.inputs[parameter].default_value = value
        try:
            tsl_ir.emit_output(noise, noise.outputs['Fac'])
            raise AssertionError('Unnormalized noise inherited an unverified control range')
        except tsl_ir.TslIrRefusal as error: assert message in str(error)
        noise.inputs[parameter].default_value = previous
    coordinates = tree.nodes.new('ShaderNodeCombineXYZ')
    tree.links.new(coordinates.outputs[0], noise.inputs['Vector'])
    noise.noise_dimensions = '2D'
    shader_profile = tsl_ir._noise_shader_offset_profile(
        tsl_ir.get_evaluation_engine(), sys.platform, platform.machine(),
        bpy.context.preferences.system.gpu_backend, bpy.app.version, tsl_ir._noise_gpu_renderer())
    literal = tsl_ir.emit_output(noise, noise.outputs['Color'])
    assert literal['evaluationModel'] == ('shader-mf' if bpy.app.version >= (5, 0, 0) else 'shader')
    if bpy.app.version >= (5, 0, 0):
        assert literal['offsetModel'] == 'mf-f32' and literal['colorOffsets'][0][1] == 157.369384765625
    else:
        assert literal['offsetModel'] == (shader_profile or 'shader-folded')
    texture_coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(texture_coordinates.outputs['UV'], noise.inputs['Vector'])
    shader = tsl_ir.emit_output(noise, noise.outputs['Color'])
    assert shader['evaluationModel'] == 'shader' and shader['offsetModel'] == (shader_profile or 'shader-folded')
    noise.noise_dimensions = '4D'
    fourth = tsl_ir.emit_output(noise, noise.outputs['Color'])
    assert fourth['offsetModel'] == 'float4-f32' and fourth['colorOffsets'][1][2] == 162.05215454101562
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_PARAMETER_ADMISSION_PASSED native linked roughness range, named refusal and supported endpoints')
