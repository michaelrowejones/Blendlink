# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact exporter seam, restoration, context guards and source-plan ownership."""
import importlib
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import bpy
import numpy as np

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import geometry_export
import geometry_ir
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh=bpy.data.meshes.new('Exact geometry')
mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
mesh.polygons[0].use_smooth=True
mesh.normals_split_custom_set([(.1234567,.2345678,.964267),(.2,.1,.974679),(.1,.2,.974679)])
owner=bpy.data.objects.new('Exact owner',mesh);bpy.context.scene.collection.objects.link(owner)
owner2=bpy.data.objects.new('Shared owner',mesh);bpy.context.scene.collection.objects.link(owner2)
bpy.context.view_layer.update()
geometry_ir.validate_owner(owner,{'normal'})
assert geometry_ir.normal_model(owner)=='object'
owner2.hide_render=True
assert geometry_ir.normal_model(owner)=='world-vertex'
owner2.hide_render=False
plan=SimpleNamespace(decisions=[SimpleNamespace(channel_plan={'op':'geometry_context','output':'normal'},bindings=[SimpleNamespace(object_name=owner.name)])])
module=importlib.import_module('io_scene_gltf2.blender.exp.'+('gltf2_blender_gather_primitives_extract' if bpy.app.version[:2]==(4,2) else 'primitive_extract'))
creator=module.PrimitiveCreator;name='_PrimitiveCreator__get_normals';original=getattr(creator,name)
expected=np.empty(len(mesh.loops)*3,np.float32);mesh.corner_normals.foreach_get('vector',expected);expected=expected.reshape(-1,3)
for yup in [False,True]:
    probe=SimpleNamespace(blender_mesh=mesh,key_blocks=[],armature=None,export_settings={'gltf_yup':yup})
    before=mesh.users
    with geometry_export.exact_normals(plan):getattr(creator,name)(probe)
    actual=probe.normals.copy()
    if yup:actual=actual[:,[0,2,1]];actual[:,1]*=-1
    assert np.array_equal(actual,expected),(actual,expected)
    assert getattr(creator,name) is original and mesh.users==before
try:
    with geometry_export.exact_normals(plan):raise RuntimeError('intentional export failure')
except RuntimeError:pass
assert getattr(creator,name) is original
try:
    with geometry_export.exact_normals(plan):pass
except ValueError as error:assert 'did not bind' in str(error)
else:raise AssertionError('An exporter bypass silently accepted rounded normals')
assert getattr(creator,name) is original

# A successful cached validation must not survive a later, independent plan.
@geometry_ir.cached_plan
def validate():geometry_ir.validate_owner(owner,{'normal'})
validate();modifier=owner.modifiers.new('Unproved deformation','DISPLACE')
try:validate()
except ValueError as error:assert 'modifiers' in str(error)
else:raise AssertionError('A source edit survived the plan-scoped validation cache')
owner.modifiers.remove(modifier)
owner.scale=(1,.001,1);bpy.context.view_layer.update()
try:validate()
except ValueError as error:assert 'condition bound' in str(error)
else:raise AssertionError('An extreme normal-transform condition was admitted')
owner.scale=(1,1,1);bpy.context.view_layer.update()
owner2.hide_render=False;owner2.keyframe_insert(data_path='hide_render',frame=1)
owner2.hide_render=True;owner2.keyframe_insert(data_path='hide_render',frame=3)
try:geometry_ir.normal_model(owner)
except ValueError as error:assert 'animated render-visibility' in str(error)
else:raise AssertionError('A changing native geometry-user count was admitted')
owner2.animation_data_clear();owner2.hide_render=False

camera=bpy.data.objects.new('Reflected view',bpy.data.cameras.new('Reflected view'))
bpy.context.scene.collection.objects.link(camera);bpy.context.scene.camera=camera;camera.scale.x=-1;bpy.context.view_layer.update()
for output in geometry_ir.VIEW_OUTPUTS:
    try:geometry_ir.validate_owner(owner,{output})
    except ValueError as error:assert 'reflected/sheared' in str(error)
    else:raise AssertionError('An unverified reflected camera projection was admitted for '+output)
camera.scale.x=1;camera.data.shift_x=.1;bpy.context.view_layer.update()
try:geometry_ir.validate_owner(owner,{'window'})
except ValueError as error:assert 'shifted/cropped' in str(error)
else:raise AssertionError('An unverified shifted Window projection was admitted')
camera.data.shift_x=0;bpy.context.scene.render.engine='CYCLES'
material=bpy.data.materials.new('Native normal program');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
source=tree.nodes.new('ShaderNodeNewGeometry');tree.links.new(source.outputs['Normal'],bsdf.inputs['Base Color'])
compiler.set_tsl_ir(material,True)
def planned(owners):
    plan=compiler.plan_materials(owners,purpose='final',automatic_programs=True)
    assert len(plan.decisions)==1
    return plan.decisions[0]
def records(value):
    if isinstance(value,dict):
        if value.get('op')=='geometry_context':yield value
        for child in value.values():yield from records(child)
    elif isinstance(value,list):
        for child in value:yield from records(child)
shared=planned([owner,owner2])
assert not shared.issues,shared.issues
assert {item['normalTransform'] for item in records(shared.channel_plan)}=={'object'}
for entry in shared.channel_plan['channels']:
    if 'tslIr' in entry:
        encoded=json.dumps(entry['tslIr'],sort_keys=True,separators=(',',':')).encode()
        assert entry['tslIrHash']==hashlib.sha256(encoded).hexdigest() and entry['tslIrBytes']==len(encoded)
owner2.hide_render=True
single=planned([owner]);assert {item['normalTransform'] for item in records(single.channel_plan)}=={'world-vertex'}
owner2.hide_render=False
owner3=bpy.data.objects.new('Separate geometry same material',mesh.copy());bpy.context.scene.collection.objects.link(owner3)
mixed=planned([owner,owner2,owner3])
assert any(issue.code=='material.geometry-context-unproven' and 'mixes shared' in issue.problem for issue in mixed.issues),mixed.issues
assert 'UV-bake ray context' in compiler._automatic_channel_bake_refusal(tree,bsdf,'Base Color')
# Installed extensions load siblings as a package, without the source checkout's
# bare module names. Exercise that actual namespace as well as CLI imports.
name='blendlink_geometry_package_check'
spec=importlib.util.spec_from_file_location(name,addon/'__init__.py',submodule_search_locations=[str(addon)])
package=importlib.util.module_from_spec(spec);sys.modules[name]=package;spec.loader.exec_module(package)
packaged=package.material_compiler.plan_materials([owner,owner2],purpose='final',automatic_programs=True)
assert not packaged.errors,packaged.errors
assert {item['normalTransform'] for item in records(packaged.decisions[0].channel_plan)}=={'object'}
print('BLENDLINK_GEOMETRY_EXPORT_PASSED '+bpy.app.version_string)
