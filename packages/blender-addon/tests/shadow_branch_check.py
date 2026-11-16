# SPDX-License-Identifier: GPL-3.0-or-later
"""Pinned source/profile tests; actual ray-pass numerical proof is separate."""
import json
from pathlib import Path
import sys
import platform
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'blendlink' / 'blender'))
import tsl_ir as ir
import material_compiler as compiler

bpy.context.scene.render.engine = 'BLENDER_EEVEE' if bpy.app.version >= (5,3,0) else 'BLENDER_EEVEE_NEXT'
material = bpy.data.materials.new('Shadow Branch Test')
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
out = tree.nodes.new('ShaderNodeOutputMaterial')
out.target = 'EEVEE'
surface = tree.nodes.new('ShaderNodeBsdfPrincipled')
surface.inputs['Alpha'].default_value = .25
cycles = tree.nodes.new('ShaderNodeOutputMaterial')
cycles.target = 'CYCLES'
tree.links.new(surface.outputs[0], cycles.inputs['Surface'])
shadow = tree.nodes.new('ShaderNodeBsdfTransparent')
mix = tree.nodes.new('ShaderNodeMixShader')
light = tree.nodes.new('ShaderNodeLightPath')
tree.links.new(surface.outputs[0], mix.inputs[1])
tree.links.new(shadow.outputs[0], mix.inputs[2])
tree.links.new(light.outputs['Is Shadow Ray'], mix.inputs[0])
tree.links.new(mix.outputs[0], out.inputs['Surface'])

def emit():
    return ir.emit_surface(tree, target='EEVEE')

eligible = (tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
            and sys.platform=='darwin' and platform.machine()=='arm64'
            and bpy.context.preferences.system.gpu_backend=='METAL')
if not eligible:
    try: emit()
    except ir.TslIrRefusal: pass
    else: raise AssertionError('Unqualified source profile admitted a shadow branch')
    print('SCENETOWEB_SHADOW_BRANCH_SOURCE_CHECK_PASSED '+json.dumps({'positiveCases':0,'refusalCases':1,'numericalCredit':0,'renderCalls':0,'bakeCalls':0}))
    raise SystemExit(0)

alpha = emit()['channels']['Alpha']['output']
assert alpha['op'] == 'shadow_exclusion_native'
assert alpha['input'] == {'op':'const_float','value':.25}
mesh = bpy.data.meshes.new('Shadow Triangle')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
obj = bpy.data.objects.new('Shadow Owner',mesh)
bpy.context.scene.collection.objects.link(obj)
mesh.materials.append(material)
decision = compiler.plan_materials([obj], purpose='final', automatic_programs=True).decisions[0]
assert decision.outcome == 'lowered', [i.problem for i in decision.issues]
assert next(c for c in decision.channel_plan['channels'] if c['channel']=='Alpha')['tslIr']['output']['op']=='shadow_exclusion_native'
assert alpha['visibleAlpha']==.25
assert out.inputs['Surface'].links[0].from_node==mix

def refused():
    try: emit()
    except ir.TslIrRefusal: return
    raise AssertionError('Unqualified Light Path graph was admitted')

# An authored, identical Cycles primary closure is part of the carrier contract.
cycles_link = cycles.inputs['Surface'].links[0]
tree.links.remove(cycles_link);refused()
tree.links.new(shadow.outputs[0],cycles.inputs['Surface']);refused()
tree.links.new(surface.outputs[0],cycles.inputs['Surface'])
# Blender bypasses a muted Mix to its first closure. That ordinary primary
# program remains portable, but must not acquire shadow exclusion.
mix.mute=True
assert emit()['channels']['Alpha']['output']['op'] != 'shadow_exclusion_native'
mix.mute=False
light.mute=True;refused();light.mute=False
shadow.mute=True;refused();shadow.mute=False
tree.links.new(light.outputs['Is Camera Ray'],mix.inputs[0]);refused()
tree.links.new(light.outputs['Is Shadow Ray'],mix.inputs[0])
shadow.inputs['Color'].default_value=(.99,1,1,1);refused()
shadow.inputs['Color'].default_value=(1,1,1,1)
surface.inputs['Alpha'].default_value=0;refused()
surface.inputs['Alpha'].default_value=.25
coords=tree.nodes.new('ShaderNodeTexCoord');separate=tree.nodes.new('ShaderNodeSeparateXYZ')
tree.links.new(coords.outputs['Generated'],separate.inputs[0])
alpha_link=tree.links.new(separate.outputs['X'],surface.inputs['Alpha']);refused()
tree.links.remove(alpha_link)
shadow.inputs['Color'].keyframe_insert('default_value',frame=1);refused()
tree.animation_data_clear()
# A standalone field does not acquire a universal primary-ray constant.
try: ir.emit_output(light,light.outputs['Is Shadow Ray'])
except ir.TslIrRefusal: pass
else: raise AssertionError('General Light Path field unexpectedly admitted')
print('SCENETOWEB_SHADOW_BRANCH_SOURCE_CHECK_PASSED '+json.dumps({'profile':'5.3-macos-metal','numericalCredit':0,'renderCalls':0,'bakeCalls':0}))
