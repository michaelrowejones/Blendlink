# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh normalized Noise uses an explicit capability and preserves artist data."""
from pathlib import Path
import sys
import platform
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from color_ir import _unit_bounded
from shader_domains import native_shader_input_evaluation

assert tsl_ir._normalized_noise_source_profile('EEVEE', 'linux', 'x86_64') == 'native-standard-f32'
assert tsl_ir._normalized_noise_source_profile('CYCLES', 'darwin', 'arm64') == 'cycles-neon-fma'
assert tsl_ir._normalized_noise_source_profile('CYCLES', 'linux', 'x86_64') is None
assert tsl_ir._normalized_noise_source_profile('CYCLES', 'darwin', 'arm64', 'GPU') is None
engines = {item.identifier for item in bpy.context.scene.render.bl_rna.properties['engine'].enum_items}
bpy.context.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
material = bpy.data.materials.new('Native normalized Noise admission')
material.use_nodes = True
tree = material.node_tree
noise = tree.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = .15
noise.inputs['Detail'].default_value = 1
noise.normalize = True
coordinates = tree.nodes.new('ShaderNodeCombineXYZ')
tree.links.new(coordinates.outputs[0], noise.inputs['Vector'])
before = (len(bpy.data.materials), len(bpy.data.node_groups), len(tree.nodes), material.users)
def source_state():
    values = []
    for node in tree.nodes:
        for socket in node.inputs:
            if hasattr(socket, 'default_value'):
                value = socket.default_value
                if not isinstance(value, (str, float, int, bool, type(None))):
                    try: value = tuple(value)
                    except TypeError: value = str(value)
                values.append((node.name, socket.identifier, value))
    return (noise.noise_dimensions, noise.noise_type, noise.normalize, values,
            [(link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier) for link in tree.links])
def emit(output):
    state = source_state()
    try: return tsl_ir.emit_output(noise, noise.outputs[output])
    finally: assert state == source_state(), 'Extraction changed authored node values or links'
try:
    for dimensions in ['1D', '2D', '3D', '4D']:
        noise.noise_dimensions = dimensions
        for output in ['Fac', 'Color']:
            expression = emit(output)
            assert expression['op'] == 'noise_normalized' and expression['normalize'] is True
            assert expression['noiseType'] == 'FBM' and expression['dimensions'] == int(dimensions[0])
            assert expression['scale']['value'] == noise.inputs['Scale'].default_value
            assert expression['evaluationModel'] == ('shader-mf' if bpy.app.version >= (5, 0, 0) else 'shader')
            assert expression['perlinModel'] == ('mf-periodic-f32' if bpy.app.version >= (5,0,0) else 'eevee-metal-periodic-f32' if bpy.context.preferences.system.gpu_backend == 'METAL' else 'native-standard-f32')
            assert _unit_bounded(expression) == (dimensions in {'1D', '2D'})
            assert not _unit_bounded({**expression, 'normalize': False})
            assert not _unit_bounded({**expression, 'roughnessNode': {'op': 'const_float', 'value': .5}})
            assert native_shader_input_evaluation(expression) == 'constant'
    noise.noise_dimensions = '3D'
    for name, value, message in [('Detail', 7, 'exceeds the proven range'), ('Lacunarity', 3, '|Lacunarity| <= 2'),
                                 ('Distortion', 2, '[-1,1]')]:
        old = noise.inputs[name].default_value
        noise.inputs[name].default_value = value
        try:
            emit('Fac')
            raise AssertionError('Unproved normalized controls silently acquired native capability')
        except tsl_ir.TslIrRefusal as error: assert message in str(error), str(error)
        noise.inputs[name].default_value = old
    original_platform, original_machine = sys.platform, platform.machine
    try:
        sys.platform = 'linux'
        platform.machine = lambda: 'x86_64'
        with tsl_ir.emission_context(evaluation_engine='CYCLES'):
            try:
                emit('Fac')
                raise AssertionError('Unmeasured Cycles CPU silently inherited a live precision profile')
            except tsl_ir.TslIrRefusal as error:
                assert 'no verified live source precision profile' in str(error) and 'CYCLES' in str(error)
    finally:
        sys.platform, platform.machine = original_platform, original_machine
    if tsl_ir._normalized_noise_source_profile('CYCLES', sys.platform, platform.machine()) == 'cycles-neon-fma':
        # An unlinked Generated input requires shader evaluation even if a
        # particular mesh makes it spatially uniform.
        tree.links.remove(noise.inputs['Vector'].links[0])
        try:
            noise.inputs['Detail'].default_value = 2
            with tsl_ir.emission_context(evaluation_engine='CYCLES'):
                try:
                    emit('Color')
                    raise AssertionError('An unsafe software-GPU Cycles workload silently compiled')
                except tsl_ir.TslIrRefusal as error: assert 'needs source baking' in str(error)
            noise.inputs['Detail'].default_value = 1
            with tsl_ir.emission_context(evaluation_engine='CYCLES'):
                assert emit('Color')['perlinModel'] == 'cycles-neon-fma'
        finally:
            tree.links.new(coordinates.outputs[0], noise.inputs['Vector'])
            noise.inputs['Detail'].default_value = 1
    noise.inputs['Scale'].default_value = 80
    assert emit('Fac')['op'] == 'noise_normalized'
    noise.inputs['Scale'].default_value = 81
    assert emit('Fac')['op'] == 'noise', 'Measured high-scale approximation must remain separate'
    assert before == (len(bpy.data.materials), len(bpy.data.node_groups), len(tree.nodes), material.users)
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_NORMALIZED_TRANSLATION_PASSED explicit native capability, bounded controls and read-only extraction')
