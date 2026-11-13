# SPDX-License-Identifier: GPL-3.0-or-later
"""Fresh EEVEE Geometry Normal slots use the verified camera-space adapter."""
from pathlib import Path
import sys
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink/blender'))
import material_compiler as compiler
import tsl_ir

bpy.ops.wm.read_factory_settings(use_empty=False)
owner = bpy.data.objects['Cube']
material = bpy.data.materials.new('Direct geometry normal')
material.use_nodes = True
owner.data.materials.clear(); owner.data.materials.append(material)
compiler.set_tsl_ir(material, True)
tree = material.node_tree
principled = next(node for node in tree.nodes if node.type == 'BSDF_PRINCIPLED')
geometry = tree.nodes.new('ShaderNodeNewGeometry')
principled.inputs['Coat Weight'].default_value = 1
for channel in ['Normal', 'Coat Normal']:
    tree.links.new(geometry.outputs['Normal'], principled.inputs[channel])
before = len(tree.nodes), len(tree.links)
eevee = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0) else 'BLENDER_EEVEE'
bpy.context.scene.render.engine = eevee
plan = compiler.plan_materials([owner], purpose='final', automatic_programs=True)
assert not plan.errors, plan.as_dict()
for channel in ['Normal', 'Coat Normal']:
    entry = next(item for item in plan.decisions[0].channel_plan['channels'] if item['channel'] == channel)
    output = entry['tslIr']['output']
    assert output['op'] == 'normal_view_native', output
    assert output['input']['op'] == 'geometry_context' and output['input']['sourceEngine'] == 'EEVEE'
    assert entry['tslIr']['viewDependent'] and entry['tslIr']['geometryDependent']
with tsl_ir.emission_context(evaluation_engine='CYCLES'):
    legacy = tsl_ir.emit_normal_channel(principled.inputs['Normal'])
assert legacy['output']['op'] == 'normal_view', legacy
assert before == (len(tree.nodes), len(tree.links))
print('BLENDLINK_GEOMETRY_NORMAL_CHANNEL_PASSED direct Normal/Coat; legacy Cycles route preserved')
