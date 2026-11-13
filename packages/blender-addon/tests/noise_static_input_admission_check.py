# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only stage qualification for fresh static 4D Color coordinates."""
import json
import sys
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_static_inputs import constant_input, MESSAGE


def literal(value): return {'op': 'const_float', 'value': value}


for direction in (-1, 1):
    expression = {'op': 'math', 'operation': 'SUBTRACT', 'b': literal(direction), 'a': {
        'op': 'math', 'operation': 'SUBTRACT', 'b': literal(1e8), 'a': {
            'op': 'math', 'operation': 'ADD', 'a': literal(1e8), 'b': literal(direction)}}}
    assert constant_input(expression) == (-direction, False)
assert constant_input({'op': 'math', 'operation': 'ADD', 'a': literal(2**80), 'b': literal(1)}) == (2**80, False)
assert constant_input({'op': 'math', 'operation': 'MULTIPLY', 'a': literal(.5), 'b': literal(.25)}) == (.125, True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0, 0) else 'BLENDER_EEVEE'
material = bpy.data.materials.new('Noise input stage admission'); material.use_nodes = True
tree = material.node_tree; tree.nodes.clear()
noise = tree.nodes.new('ShaderNodeTexNoise'); noise.noise_dimensions = '4D'; noise.noise_type = 'FBM'; noise.normalize = False
noise.inputs['Scale'].default_value = 1
noise.inputs['Detail'].default_value = 0
source = tree.nodes.new('ShaderNodeCombineXYZ')
tree.links.new(source.outputs[0], noise.inputs['Vector'])
emission = tree.nodes.new('ShaderNodeEmission'); tree.links.new(noise.outputs['Color'], emission.inputs['Color'])
cases = []
for direction in (-1, 1):
    first = tree.nodes.new('ShaderNodeMath'); first.operation = 'ADD'; first.inputs[0].default_value = 1e8; first.inputs[1].default_value = direction
    second = tree.nodes.new('ShaderNodeMath'); second.operation = 'SUBTRACT'; tree.links.new(first.outputs[0], second.inputs[0]); second.inputs[1].default_value = 1e8
    third = tree.nodes.new('ShaderNodeMath'); third.operation = 'SUBTRACT'; tree.links.new(second.outputs[0], third.inputs[0]); third.inputs[1].default_value = direction
    tree.links.new(third.outputs[0], source.inputs[0])
    before = (len(tree.nodes), len(tree.links), float(source.inputs[0].default_value))
    try:
        document = tsl_ir.emit_channel(emission.inputs['Color'])
        assert bpy.app.version >= (5, 0, 0), document
        assert document['output']['evaluationModel'] == 'shader-mf', document
        cases.append('native-mf-admitted')
    except tsl_ir.TslIrRefusal as error:
        assert bpy.app.version < (5, 0, 0) and str(error) == MESSAGE, str(error)
        cases.append('shader-input-refused')
    assert before == (len(tree.nodes), len(tree.links), float(source.inputs[0].default_value))
    tree.links.remove(next(iter(source.inputs[0].links)))

first.inputs[0].default_value, first.inputs[1].default_value = .125, .25
tree.links.new(first.outputs[0], source.inputs[0])
assert tsl_ir.emit_channel(emission.inputs['Color'])['output']['op'] == 'noise_fractal'
print('BLENDLINK_NOISE_STATIC_INPUT_ADMISSION_CHECK_PASSED ' + json.dumps({'blender': bpy.app.version_string, 'cases': cases}))
