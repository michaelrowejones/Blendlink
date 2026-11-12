# SPDX-License-Identifier: GPL-3.0-or-later
"""Unmarked native UV Tangent planning, ownership and source-domain refusals."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import bpy

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Tangent native basis');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0),(1,1,0)],[],[(0,1,2),(1,3,2)]);mesh.update()
for polygon in mesh.polygons:polygon.use_smooth=True
for name in ['EditUV','RenderUV']:
    uv=mesh.uv_layers.new(name=name)
    for point,xy in zip(uv.data,[(0,0),(1,0),(0,1),(1,0),(1,1),(0,1)]):point.uv=xy
mesh.uv_layers.active_index=0;mesh.uv_layers['RenderUV'].active_render=True
owner=bpy.data.objects.new('Tangent owner',mesh);bpy.context.scene.collection.objects.link(owner)
material=bpy.data.materials.new('Unmarked tangent');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
tangent=tree.nodes.new('ShaderNodeTangent');tangent.direction_type='UV_MAP';tree.links.new(tangent.outputs[0],bsdf.inputs['Base Color'])

def plan(module=compiler):return module.plan_materials([owner],purpose='final',automatic_programs=True)
eevee='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
for engine in [eevee]:
    bpy.context.scene.render.engine=engine
    result=plan();assert not result.errors,result.errors
    decision=result.decisions[0];assert decision.channel_plan['automatic'] and decision.transport=='program'
    channel=next(entry for entry in decision.channel_plan['channels'] if entry['channel']=='Base Color')
    ir=channel['tslIr']['output'];assert ir['op']=='tangent_native' and ir['uvMap']=='RenderUV',ir
    encoded=json.dumps(channel['tslIr'],sort_keys=True,separators=(',',':')).encode()
    assert channel['tslIrHash']==hashlib.sha256(encoded).hexdigest() and channel['tslIrBytes']==len(encoded)
    runtime=compiler._tsl_runtime_mesh_entry(decision,owner)
    assert runtime['uvChannels']['RenderUV']==1 and runtime['tangentFrame']['uvMap']=='RenderUV',runtime
    tangent.uv_map='EditUV';assert not plan().errors;tangent.uv_map=''

# Flat faces and a mixed source mesh retain the same independently checked
# corner-normal/Mikk-frame contract. Shading flags do not grant a cone proof.
for flags in [(False,False),(True,False),(True,True)]:
    for polygon,smooth in zip(mesh.polygons,flags):polygon.use_smooth=smooth
    mesh.update()
    result=plan();assert not result.errors,result.errors

bpy.context.scene.render.engine='CYCLES'
assert any('Cycles UV Tangent' in issue.problem for issue in plan().errors)
bpy.context.scene.render.engine=eevee
normal_tangent=tree.nodes.new('ShaderNodeTangent');normal_tangent.direction_type='UV_MAP';normal_tangent.uv_map='EditUV'
tree.links.new(normal_tangent.outputs[0],bsdf.inputs['Normal'])
result=plan();assert any('multiple UV tangent bases' in issue.problem for issue in result.errors),result.errors
tree.nodes.remove(normal_tangent)
other=material.copy();other.name='Second tangent basis'
next(node for node in other.node_tree.nodes if node.bl_idname=='ShaderNodeTangent').uv_map='EditUV'
mesh.materials.append(other);mesh.polygons[1].material_index=1
result=plan();assert any(issue.code=='material.tangent-basis-conflict' for issue in result.errors),result.errors
mesh.polygons[1].material_index=0;mesh.materials.pop(index=1);bpy.data.materials.remove(other)
owner.scale.x=.001;bpy.context.view_layer.update()
result=plan();assert any('condition bound' in issue.problem for issue in result.errors),result.errors
owner.scale.x=1;bpy.context.view_layer.update()
uv=mesh.uv_layers['RenderUV'];old=[tuple(point.uv) for point in uv.data]
for point in uv.data:point.uv=(0,0)
result=plan();assert any('nondegenerate UV' in issue.problem for issue in result.errors),result.errors
for point,xy in zip(uv.data,old):point.uv=xy
tangent.direction_type='RADIAL'
result=plan();assert result.errors and any('Radial Tangent' in issue.problem for issue in result.errors),result.errors
tangent.direction_type='UV_MAP'
assert not plan().errors
assert 'owner-dependent UV Tangent' in compiler._automatic_channel_bake_refusal(tree,bsdf,'Base Color')

name='blendlink_tangent_qualified_package_check'
spec=importlib.util.spec_from_file_location(name,addon/'__init__.py',submodule_search_locations=[str(addon)])
package=importlib.util.module_from_spec(spec);sys.modules[name]=package;spec.loader.exec_module(package)
assert not plan(package.material_compiler).errors
print('BLENDLINK_TANGENT_DOMAIN_PASSED '+bpy.app.version_string)
