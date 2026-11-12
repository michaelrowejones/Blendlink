# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only native source admission for the bounded EEVEE Modulo profile."""
import json
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from math_modulo_native_ir import qualify_modulo, input_bounds, in_integer_band, REFUSAL

literal = lambda value: {'op': 'const_float', 'value': value}
def refusal(message): raise tsl_ir.TslIrRefusal(message)
def qualify(value, **changes):
    return qualify_modulo({'op': 'math', 'operation': 'MODULO', 'a': literal(value), 'b': literal(100000)},
        engine=changes.get('engine', 'EEVEE'), backend=changes.get('backend', 'METAL'),
        version=changes.get('version', bpy.app.version), refuse=refusal)

for value in (2**24, -2**24, 1074100096, 1638499968, 2147483520, -2147483520):
    assert in_integer_band(input_bounds(literal(value)))
    assert qualify(value)['op'] == 'math_modulo_native'
for value in (2**31, -2**31):
    try: qualify(value); assert False
    except tsl_ir.TslIrRefusal as error: assert str(error) == REFUSAL
for value in (-1, .5, 100000, 2**24-1):
    assert qualify(value)['op'] == 'math'
assert qualify(1074100096, engine='CYCLES')['op'] == 'math'
try: qualify(1074100096, backend='OPENGL', version=(4,2,0)); assert False
except tsl_ir.TslIrRefusal as error: assert str(error) == REFUSAL

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5,0,0) else 'BLENDER_EEVEE'
material = bpy.data.materials.new('Modulo source admission'); material.use_nodes = True
tree = material.node_tree; tree.nodes.clear()
node = tree.nodes.new('ShaderNodeMath'); node.operation = 'MODULO'
node.inputs[0].default_value = 1638499968; node.inputs[1].default_value = 100000
emission = tree.nodes.new('ShaderNodeEmission'); tree.links.new(node.outputs[0], emission.inputs['Color'])
before = (len(tree.nodes), len(tree.links), tuple(input.default_value for input in node.inputs))
unknown_legacy = bpy.app.version < (5,0,0) and bpy.context.preferences.system.gpu_backend != 'METAL'
if unknown_legacy:
    try: tsl_ir.emit_channel(emission.inputs['Color']); assert False
    except tsl_ir.TslIrRefusal as error: assert str(error) == REFUSAL
    output = {'precisionModel': 'source-baking-unknown-native-backend'}
else:
    output = tsl_ir.emit_channel(emission.inputs['Color'])['output']
    assert output['op'] == 'math_modulo_native', output
    assert output['precisionModel'] == ('mf-fmod100000-v1' if bpy.app.version >= (5,0,0) else 'metal-mod100000-v1')
    node.use_clamp = True
    assert tsl_ir.emit_channel(emission.inputs['Color'])['output']['op'] == 'clamp01'
    node.use_clamp = False
assert before == (len(tree.nodes), len(tree.links), tuple(input.default_value for input in node.inputs))
print('BLENDLINK_MATH_MODULO_NATIVE_ADMISSION_CHECK_PASSED ' + json.dumps({'blender': bpy.app.version_string, 'model': output['precisionModel']}))
