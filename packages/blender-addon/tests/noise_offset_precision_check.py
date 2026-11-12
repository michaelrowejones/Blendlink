# SPDX-License-Identifier: GPL-3.0-or-later
"""Native source precision must not inherit the exporting OS's runtime model."""
from pathlib import Path
import platform
import struct
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir

profile = tsl_ir._noise_shader_offset_profile
assert profile('CYCLES', 'linux', 'x86_64', 'OPENGL', (4, 2, 0)) == 'cycles-legacy-linux-x64-f32'
assert profile('CYCLES', 'linux', 'AMD64', 'NONE', (4, 2, 0)) == 'cycles-legacy-linux-x64-f32'
for version in [(5, 2, 0), (5, 3, 0)]:
    assert profile('CYCLES', 'linux', 'x86_64', 'OPENGL', version) is None
    assert profile('EEVEE', 'linux', 'x86_64', 'OPENGL', version) == 'eevee-opengl-f32'
assert profile('CYCLES', 'darwin', 'arm64', 'METAL', (4, 2, 0)) is None
assert profile('EEVEE', 'darwin', 'arm64', 'METAL', (4, 2, 0)) is None
assert profile('UNKNOWN', 'linux', 'x86_64', 'OPENGL', (4, 2, 0)) is None
for version in [(4, 2, 0), (5, 2, 0), (5, 3, 0)]:
    for engine in ['CYCLES', 'EEVEE']:
        assert profile(engine, 'win32', 'AMD64', 'OPENGL', version) is None
        assert profile(engine, 'darwin', 'arm64', 'OPENGL', version) is None
folded = tsl_ir._noise_random_offset(3, 3)
staged = tsl_ir._noise_random_offset(3, 3, native_shader_f32=True)
f32 = lambda value: struct.unpack('f', struct.pack('f', value))[0]
assert f32(folded[2]) == 193.4084014892578
assert staged[2] == 193.40841674804688
assert staged == tsl_ir._noise_random_offset(3, 3, native_mf=True)

engine = bpy.context.scene.render.engine
material = bpy.data.materials.new('Native Noise offset precision')
material.use_nodes = True
tree = material.node_tree
node = tree.nodes.new('ShaderNodeTexNoise')
node.normalize = False
node.inputs['Scale'].default_value = 40
coordinate = tree.nodes.new('ShaderNodeTexCoord')
tree.links.new(coordinate.outputs['UV'], node.inputs['Vector'])
try:
    bpy.context.scene.render.engine = 'CYCLES'
    expression = tsl_ir.emit_output(node, node.outputs['Color'])
    expected = profile('CYCLES', sys.platform, platform.machine(), bpy.context.preferences.system.gpu_backend, bpy.app.version)
    assert expression['evaluationModel'] == 'shader'
    assert expression['offsetModel'] == (expected or 'shader-folded')
    assert f32(expression['colorOffsets'][0][2]) == (staged[2] if expected else f32(folded[2]))
finally:
    bpy.context.scene.render.engine = engine
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_OFFSET_PRECISION_PASSED named source profiles, seeded boundary and actual native graph')
