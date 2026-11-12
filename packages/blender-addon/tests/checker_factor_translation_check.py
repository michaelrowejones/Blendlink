# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep native Checker Factor scalar across real material extraction."""
from pathlib import Path
import sys
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir

bpy.ops.wm.read_factory_settings(use_empty=True)
tree=bpy.data.node_groups.new('Checker scalar factor','ShaderNodeTree')
checker=tree.nodes.new('ShaderNodeTexChecker')
mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MIX'
mix.inputs['Color1'].default_value=(.2,.3,.9,1);mix.inputs['Color2'].default_value=(.9,.65,.55,1)
tree.links.new(checker.outputs['Fac'],mix.inputs['Fac'])
for engine in ('CYCLES','EEVEE'):
    with tsl_ir.emission_context(evaluation_engine=engine):
        ir=tsl_ir.emit_output(mix,mix.outputs[0])
    assert ir['op']=='mix_color' and ir['factor']['op']=='tex_checker' and ir['factor']['output']=='fac',ir
    tree.links.new(checker.outputs['Color'],mix.inputs['Fac'])
    with tsl_ir.emission_context(evaluation_engine=engine):
        color_factor=tsl_ir.emit_output(mix,mix.outputs[0])['factor']
    assert color_factor['op']=='rgb_to_bw' and color_factor['input']['op']=='tex_checker',color_factor
    assert color_factor['input'].get('output','color')=='color',color_factor
    tree.links.new(checker.outputs['Fac'],mix.inputs['Fac'])
print('BLENDLINK_CHECKER_FACTOR_TRANSLATION_PASSED '+bpy.app.version_string)
