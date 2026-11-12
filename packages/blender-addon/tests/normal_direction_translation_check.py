# SPDX-License-Identifier: GPL-3.0-or-later
"""Engine-aware Normal direction/Dot routing, dormant dependencies and refusals."""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import tsl_ir
import material_compiler
import engine_fallback
import procedural

bpy.ops.wm.read_factory_settings(use_empty=True)
material=bpy.data.materials.new('Normal Direction Regression');material.use_nodes=True
mesh=bpy.data.meshes.new('Normal Direction Triangle');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
owner=bpy.data.objects.new('Normal Direction Owner',mesh);bpy.context.scene.collection.objects.link(owner);mesh.materials.append(material)
tree=material.node_tree;root=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
node=tree.nodes.new('ShaderNodeNormal');node.name='Artist alignment direction'
opaque=tree.nodes.new('ShaderNodeTexSky');tree.links.new(opaque.outputs[0],node.inputs['Normal'])
engines={item.identifier for item in bpy.context.scene.render.bl_rna.properties['engine'].enum_items}
eev='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
for engine in ['CYCLES',eev]:
    bpy.context.scene.render.engine=engine
    tree.links.new(node.outputs['Normal'],root.inputs['Base Color'])
    node.outputs['Normal'].default_value=(2,-3,4)
    before=(len(tree.nodes),len(tree.links),list(node.outputs['Normal'].default_value))
    emitted=tsl_ir.emit_channel(root.inputs['Base Color'])['output']
    expected=list(Vector((2,-3,4)).normalized()) if engine=='CYCLES' else [2,-3,4]
    assert emitted=={'op':'const_vec3','value':expected},emitted
    assert before==(len(tree.nodes),len(tree.links),list(node.outputs['Normal'].default_value))
    assert material_compiler.plan_materials([owner],automatic_programs=True).decisions[0].channel_plan['channels'][0]['route'] in {'program','portable'}
    tree.links.new(node.outputs['Dot'],root.inputs['Base Color'])
    try:tsl_ir.emit_channel(root.inputs['Base Color'])
    except tsl_ir.TslIrRefusal as error:assert 'ShaderNodeTexSky' in str(error),error
    else:raise AssertionError('Opaque Normal Dot normalization was admitted')
    tree.links.remove(node.inputs['Normal'].links[0]);node.inputs['Normal'].default_value=(1,-1,2)
    value=tsl_ir.emit_channel(root.inputs['Base Color'])['output']
    assert value['op']=='vector_math' and value['operation']=='DOT_PRODUCT',value
    node.inputs['Normal'].default_value=(0,0,0)
    try:tsl_ir.emit_channel(root.inputs['Base Color'])
    except tsl_ir.TslIrRefusal as error:assert node.name in str(error) and 'nonzero' in str(error),error
    else:raise AssertionError('Undefined zero Normal Dot input was frozen')
    tree.links.new(opaque.outputs[0],node.inputs['Normal'])
assert engine_fallback.channel_engine_difference(root,'Base Color','EEVEE','CYCLES',procedural._walk_channel_upstream)
tree.links.new(node.outputs['Normal'],root.inputs['Base Color'])
node.outputs['Normal'].keyframe_insert(data_path='default_value',index=0,frame=1)
try:tsl_ir.emit_channel(root.inputs['Base Color'])
except tsl_ir.TslIrRefusal as error:assert 'animation' in str(error),error
else:raise AssertionError('Animated Normal direction silently froze')
print('BLENDLINK_NORMAL_DIRECTION_TRANSLATION_PASSED '+bpy.app.version_string)
