# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native fractal schemas retain bounded controls and active inputs."""
from pathlib import Path
import math
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
from noise_fractal_ir import FRACTAL_TYPES, fractal_amplitude_bound
material = bpy.data.materials.new('Fractal admission')
material.use_nodes = True
tree = material.node_tree
node = tree.nodes.new('ShaderNodeTexNoise')
node.inputs['Scale'].default_value = 1
try:
    for kind in sorted(FRACTAL_TYPES):
        node.noise_type = kind
        for dimension in ['1D', '2D', '3D', '4D']:
            node.noise_dimensions = dimension
            for normalize in [True, False]:
                node.normalize = normalize
                for output in ['Fac', 'Color']:
                    before = (len(tree.nodes), len(bpy.data.node_groups), node.normalize)
                    result = tsl_ir.emit_output(node, node.outputs[output])
                    assert result['op'] == 'noise_fractal' and result['noiseType'] == kind and result['normalize'] is False
                    assert math.isfinite(result['amplitudeBound']) and result['amplitudeBound'] <= 128
                    assert before == (len(tree.nodes), len(bpy.data.node_groups), node.normalize)
        node.noise_dimensions = '3D'
        node.inputs['Detail'].default_value = 3
        try:
            tsl_ir.emit_output(node, node.outputs['Fac'])
            raise AssertionError('A new recurrence inherited the old FBM detail domain')
        except tsl_ir.TslIrRefusal as error: assert 'proven parameter domain' in str(error)
        node.inputs['Detail'].default_value = 2
        if kind != 'MULTIFRACTAL':
            node.inputs['Offset'].default_value = 2
            try:
                tsl_ir.emit_output(node, node.outputs['Fac'])
                raise AssertionError('Fractal offset exceeded its proved amplitude domain')
            except tsl_ir.TslIrRefusal as error: assert 'proven parameter domain' in str(error)
            node.inputs['Offset'].default_value = 0
    for kind, bound in [('MULTIFRACTAL', 64), ('HETERO_TERRAIN', 100), ('HYBRID_MULTIFRACTAL', 12), ('RIDGED_MULTIFRACTAL', 48)]:
        assert fractal_amplitude_bound(kind, 2, 1, 1, 2) == bound
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_FRACTAL_TRANSLATION_PASSED native modes/dimensions, inactive normalization, finite amplitudes and named limits')
