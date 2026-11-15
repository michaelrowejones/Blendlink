# SPDX-License-Identifier: GPL-3.0-or-later
"""Real nested export, private-copy attestation, refusal and restoration."""
import importlib,json,struct,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import bpy
import numpy as np

addon=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(addon),str(addon.parent/'blendlink/blender')]
import geometry_export,tangent_export,export_precision

bpy.ops.wm.read_factory_settings(use_empty=True)
source=bpy.data.meshes.new('Authored precision source')
source.from_pydata([(0,0,0),(1,.1,.25),(1.2,1,.5),(.2,.9,.25)],[],[(0,1,2,3)]);source.update()
source.polygons[0].use_smooth=True
source.normals_split_custom_set([(-.15,-.24,.958),(-.2,-.21,.957),(-.18,-.26,.948),(-.16,-.23,.96)])
for name,values in [('EditUV',[(0,0),(1,0),(1,1),(0,1)]),('RenderUV',[(.1,.2),(-.55,-.4),(-1.15,.25),(-.5,.85)])]:
 layer=source.uv_layers.new(name=name)
 for item,value in zip(layer.data,values):item.uv=value
source.uv_layers.active_index=0;source.uv_layers['RenderUV'].active_render=True
before=export_precision.mesh_signature(source,'RenderUV')
private=source.copy();owner=bpy.data.objects.new('Private precision owner',private);bpy.context.scene.collection.objects.link(owner);owner.select_set(True);bpy.context.view_layer.objects.active=owner
plan=SimpleNamespace(decisions=[SimpleNamespace(channel_plan={'op':'geometry_context','output':'normal'},bindings=[SimpleNamespace(object_name=owner.name)])])
module=importlib.import_module('io_scene_gltf2.blender.exp.'+('gltf2_blender_gather_primitives_extract'if bpy.app.version[:2]==(4,2)else'primitive_extract'))
creator=module.PrimitiveCreator;names=['_PrimitiveCreator__get_normals','_PrimitiveCreator__get_tangents','_PrimitiveCreator__get_bitangent_signs'];originals=[getattr(creator,name)for name in names]
def restored():assert all(getattr(creator,name)is old for name,old in zip(names,originals))
def export(path):
 return bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=False,export_normals=True,export_tangents=True,export_texcoords=True,export_materials='NONE',export_animations=False,export_skins=False,export_morph=False)
def accessor(document,binary,index):
 item=document['accessors'][index];view=document['bufferViews'][item['bufferView']];columns={'VEC3':3,'VEC4':4}[item['type']]
 assert item['componentType']==5126
 return np.ndarray((item['count'],columns),np.float32,buffer=binary,offset=view.get('byteOffset',0)+item.get('byteOffset',0),strides=(view.get('byteStride',columns*4),4)).copy()

with tempfile.TemporaryDirectory(prefix='scenetoweb-nested-export-precision-')as directory:
 path=Path(directory)/'nested.glb'
 with geometry_export.exact_normals(plan),tangent_export.exact_tangents({private.name:'RenderUV'},object_bindings={owner.name:'RenderUV'}):
  outer=[getattr(creator,name)for name in names]
  later=private.copy();owner.data=later
  # Bake-only atlas UVs/material changes are allowed; the required named
  # geometry/normal/tangent UV basis stays byte-identical.
  later.uv_layers.new(name='Private Lighting Atlas')
  with geometry_export.exact_normals(plan),tangent_export.exact_tangents({later.name:'RenderUV'},object_bindings={owner.name:'RenderUV'}):
   assert 'FINISHED'in export(path)
  assert all(getattr(creator,name)is old for name,old in zip(names,outer))
  owner.data=private
 restored()
 raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];document=json.loads(raw[20:20+length]);binary=raw[28+length:]
 source.calc_tangents(uvmap='RenderUV')
 expected={tuple(source.vertices[loop.vertex_index].co):(tuple(source.corner_normals[loop.index].vector),tuple(loop.tangent)+(loop.bitangent_sign,))for loop in source.loops}
 for mesh in document['meshes']:
  for primitive in mesh['primitives']:
   p,n,t=(accessor(document,binary,primitive['attributes'][key])for key in ['POSITION','NORMAL','TANGENT'])
   assert np.array_equal(n,np.asarray([expected[tuple(point)][0]for point in p],np.float32))
   assert np.array_equal(t,np.asarray([expected[tuple(point)][1]for point in p],np.float32))
 bpy.data.meshes.remove(later)

 # A valid inner export must not satisfy an unrelated unseen outer request.
 unseen=private.copy();other=bpy.data.objects.new('Unselected precision owner',unseen);bpy.context.scene.collection.objects.link(other)
 try:
  with tangent_export.exact_tangents({private.name:'RenderUV',unseen.name:'RenderUV'},object_bindings={owner.name:'RenderUV',other.name:'RenderUV'}):
   with tangent_export.exact_tangents({private.name:'RenderUV'},object_bindings={owner.name:'RenderUV'}):export(Path(directory)/'missing.glb')
 except ValueError as error:assert 'did not bind exact tangents'in str(error),str(error)
 else:raise AssertionError('Nested export lost an outer missing-seen guard')
 restored();bpy.data.objects.remove(other,do_unlink=True);bpy.data.meshes.remove(unseen)

 for change in ['uv','position','normal','conflicting-uv','throw']:
  later=None
  try:
   with geometry_export.exact_normals(plan),tangent_export.exact_tangents({private.name:'RenderUV'},object_bindings={owner.name:'RenderUV'}):
    if change=='throw':raise RuntimeError('intentional nested export failure')
    later=private.copy();owner.data=later
    if change=='uv':later.uv_layers['RenderUV'].data[0].uv.x+=.125
    if change=='position':later.vertices[0].co.z+=.125;later.update()
    if change=='normal':later.normals_split_custom_set([(0,0,1)]*len(later.loops))
    uv='EditUV'if change=='conflicting-uv'else'RenderUV'
    with geometry_export.exact_normals(plan),tangent_export.exact_tangents({later.name:uv},object_bindings={owner.name:uv}):export(Path(directory)/'must-refuse.glb')
  except RuntimeError as error:assert change=='throw'and'intentional'in str(error)
  except ValueError as error:
   assert change!='throw'
   assert ('conflicting'in str(error))if change=='conflicting-uv'else('changed'in str(error)),(change,str(error))
  else:raise AssertionError(change+' was silently accepted')
  finally:
   owner.data=private
   if later is not None:bpy.data.meshes.remove(later)
  restored()

assert export_precision.mesh_signature(source,'RenderUV')==before
assert source.uv_layers.active_index==0 and source.uv_layers['RenderUV'].active_render
assert private.uv_layers.active_index==0 and private.uv_layers['RenderUV'].active_render
print('BLENDLINK_NESTED_EXPORT_PRECISION_PASSED '+bpy.app.version_string)
