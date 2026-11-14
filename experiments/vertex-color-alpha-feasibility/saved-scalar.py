# SPDX-License-Identifier: GPL-3.0-or-later
"""Saved artist source -> private Float scalar -> actual GLB, transport-only."""
from array import array
import bpy,json,os,struct,hashlib
from pathlib import Path
OUT=Path(os.environ['SCENETOWEB_VERTEX_ALPHA']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Artist painted quad');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2),(0,2,3)]);obj=bpy.data.objects.new('Artist painted quad',mesh);scene.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
paint=mesh.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain='POINT');paint.data.foreach_set('color',array('f',[.1,.2,.3,0,.4,.5,.6,.1,.7,.8,.9,1/3,.125,.25,.5,1]));mesh.color_attributes.active_color_index=0;mesh.color_attributes.render_color_index=0
material=bpy.data.materials.new('Artist alpha field');material.use_nodes=True;material.surface_render_method='DITHERED';mesh.materials.append(material);tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');bsdf=tree.nodes.new('ShaderNodeBsdfPrincipled');color=tree.nodes.new('ShaderNodeVertexColor');color.layer_name='Paint';tree.links.new(color.outputs['Alpha'],bsdf.inputs['Alpha']);tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
source=OUT/'artist-vertex-alpha.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source));sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_sha=sha(source)
# Reload actual saved source before creating any private transport data.
bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene;obj=bpy.data.objects['Artist painted quad'];mesh=obj.data;paint=mesh.color_attributes['Paint'];material=mesh.materials[0];tree=material.node_tree
snapshot=lambda:{'object':obj.as_pointer(),'mesh':mesh.as_pointer(),'meshUsers':mesh.users,'material':material.as_pointer(),'materialUsers':material.users,'tree':tree.as_pointer(),'treeUsers':tree.users,'attributes':[(a.name,a.data_type,a.domain)for a in mesh.attributes],'links':[(l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier)for l in tree.links],'frame':scene.frame_current,'active':bpy.context.view_layer.objects.active.as_pointer()if bpy.context.view_layer.objects.active else None,'selected':[o.as_pointer()for o in bpy.context.selected_objects]}
before=snapshot();original=array('f',[0])*(len(paint.data)*4);paint.data.foreach_get('color',original);raw=original.tobytes();alpha_bytes=b''.join(raw[i*16+12:i*16+16]for i in range(len(paint.data)));expected=list(struct.unpack('='+str(len(paint.data))+'I',alpha_bytes));private_obj=private_mesh=None
try:
 private_mesh=mesh.copy();private_obj=bpy.data.objects.new('Owned export-only alpha quad',private_mesh);scene.collection.objects.link(private_obj)
 scalar=private_mesh.attributes.new(name='_SCENETOWEB_VCOL_ALPHA',type='FLOAT',domain='POINT');alpha=array('f');alpha.frombytes(alpha_bytes);scalar.data.foreach_set('value',alpha);back=array('f',[0])*len(alpha);scalar.data.foreach_get('value',back);assert back.tobytes()==alpha_bytes
 for o in bpy.context.selected_objects:o.select_set(False)
 private_obj.select_set(True);bpy.context.view_layer.objects.active=private_obj
 glb=OUT/'artist-vertex-alpha.glb';bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_materials='EXPORT',export_vertex_color='NONE',export_all_vertex_colors=False,export_attributes=True,export_cameras=False,export_lights=False,export_animations=False)
 payload=glb.read_bytes();size,tag=struct.unpack_from('<II',payload,12);g=json.loads(payload[20:20+size]);binary=payload[28+size:];primitive=g['meshes'][0]['primitives'][0];semantic='_SCENETOWEB_VCOL_ALPHA';accessor=g['accessors'][primitive['attributes'][semantic]];view=g['bufferViews'][accessor['bufferView']];offset=view.get('byteOffset',0)+accessor.get('byteOffset',0);assert accessor['type']=='SCALAR'and accessor['componentType']==5126 and not accessor.get('normalized',False);assert view.get('byteStride',4)==4 and offset%4==0 and accessor['count']*4+accessor.get('byteOffset',0)<=view['byteLength']and view.get('byteOffset',0)+view['byteLength']<=len(binary);actual=list(struct.unpack_from('<'+str(accessor['count'])+'I',binary,offset));assert actual==expected,(actual,expected)
 # This is an actual asset custom attribute, not fabricated COLOR_0/VEC4.
 assert not any(name.startswith('COLOR_')for name in primitive['attributes'])
 descriptor={'semantic':semantic,'type':accessor['type'],'componentType':accessor['componentType'],'normalized':accessor.get('normalized',False),'count':accessor['count'],'wordValues':actual,'positionCount':g['accessors'][primitive['attributes']['POSITION']]['count']}
finally:
 if private_obj:bpy.data.objects.remove(private_obj,do_unlink=True)
 if private_mesh:bpy.data.meshes.remove(private_mesh)
 for o in bpy.context.selected_objects:o.select_set(False)
 obj.select_set(True);bpy.context.view_layer.objects.active=obj
assert snapshot()==before;after=array('f',[0])*len(original);paint.data.foreach_get('color',after);assert after.tobytes()==original.tobytes();assert sha(source)==source_sha
report={'status':'SAVED_VERTEX_ALPHA_SCALAR_TRANSPORT_PASSED','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'source':source.name,'sourceSha256':source_sha,'sourcePreserved':True,'sourceOwnershipRestored':True,'sourceRGBAWords':list(struct.unpack('=16I',original.tobytes())),'alphaWords':expected,'glb':glb.name,'glbSha256':sha(glb),'accessor':descriptor,'renders':0,'gpuInitializationCalls':0,'nativeShaderCredit':0,'browserCredit':0,'nodePortCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])
