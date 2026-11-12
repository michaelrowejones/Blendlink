# SPDX-License-Identifier: GPL-3.0-or-later
"""Native linked Noise roughness cannot silently acquire an upper clamp."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
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
        assert expression['op'] == 'noise' and expression['roughness'] == roughness
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_PARAMETER_ADMISSION_PASSED native linked roughness range, named refusal and supported endpoints')
