# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native CPU field capture; no GPU import or render invocation."""
import bpy,json,sys,hashlib
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:];source,out,upstream=map(lambda p:Path(p).resolve(),args)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pin=sha(source);assert pin=='6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c'
assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source))
objects=[];dg=bpy.context.evaluated_depsgraph_get()
for original in bpy.data.objects:
 if original.type!='MESH' or not any(slot.material and slot.material.name=='Material'for slot in original.material_slots):continue
 evaluated=original.evaluated_get(dg);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=dg)
 try:
  sample=[{'position':list(v.co),'undeformed':list(v.undeformed_co)}for v in list(mesh.vertices)[:4]]
  objects.append({'name':original.name,'vertices':len(mesh.vertices),'modifiers':[{'type':m.type,'render':m.show_render,'viewport':m.show_viewport}for m in original.modifiers],'rigidBody':original.rigid_body.type if original.rigid_body else None,'sample':sample,'attributes':[a.name for a in mesh.attributes]})
 finally:evaluated.to_mesh_clear()
# New private scene and meshes; never save or alter the original file.
scene=bpy.data.scenes.new('Owned ORCO CPU field controls');bpy.context.window.scene=scene
cases=[('small',[.031764864921569824,-.054061055183410645,.00013488531112670898],[.06554114818572998,.10858035087585449,.06714808940887451]),('nonuniform',[-.1,.3,-.7],[.3,1.7,.09]),('auto-flat',None,None)]
rows=[]
for id,location,size in cases:
 mesh=bpy.data.meshes.new('CPU '+id);mesh.from_pydata([(-.173,.071,-.09),(.135,-.101,.11),(.013,.151,.017),(-.021,-.133,.027)],[],[(0,1,2),(0,2,3)]);mesh.update()
 if id=='auto-flat':
  for v in mesh.vertices:v.co.z=0
  mesh.update()
 else:
  mesh.use_auto_texspace=False;mesh.texspace_location=location;mesh.texspace_size=size
 owner=bpy.data.objects.new('CPU '+id,mesh);scene.collection.objects.link(owner)
 # Evaluating the native texspace property triggers its native bbox policy.
 actual_location=list(mesh.texspace_location);actual_size=list(mesh.texspace_size)
 group=bpy.data.node_groups.new('CPU ORCO '+id,'GeometryNodeTree');group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
 inp=group.nodes.new('NodeGroupInput');outp=group.nodes.new('NodeGroupOutput');position=group.nodes.new('GeometryNodeInputPosition')
 sub=group.nodes.new('ShaderNodeVectorMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=actual_location;group.links.new(position.outputs['Position'],sub.inputs[0])
 div=group.nodes.new('ShaderNodeVectorMath');div.operation='DIVIDE';div.inputs[1].default_value=actual_size;group.links.new(sub.outputs['Vector'],div.inputs[0])
 store=group.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type='FLOAT_VECTOR';store.domain='POINT';store.inputs['Name'].default_value='native_cpu_orco';group.links.new(inp.outputs['Geometry'],store.inputs['Geometry']);group.links.new(div.outputs['Vector'],store.inputs['Value']);group.links.new(store.outputs['Geometry'],outp.inputs['Geometry'])
 modifier=owner.modifiers.new('CPU field oracle','NODES');modifier.node_group=group;bpy.context.view_layer.update();depsgraph=bpy.context.evaluated_depsgraph_get();result=owner.evaluated_get(depsgraph).to_mesh(preserve_all_data_layers=True,depsgraph=depsgraph)
 try:rows.append({'id':id,'location':actual_location,'size':actual_size,'positions':[list(v.co)for v in mesh.vertices],'nativeCpuRawOrco':[list(v.vector)for v in result.attributes['native_cpu_orco'].data]})
 finally:owner.evaluated_get(depsgraph).to_mesh_clear()
paths=['source/blender/blenkernel/intern/mesh.cc','source/blender/blenkernel/intern/mesh_data_update.cc','source/blender/makesrna/intern/rna_mesh.cc','source/blender/draw/intern/shaders/draw_resource_finalize.bsl.hh','source/blender/draw/engines/eevee/shaders/eevee_geom_mesh.bsl.hh','source/blender/draw/engines/eevee/shaders/eevee_attributes_mesh_lib.bsl.hh','source/blender/draw/intern/mesh_extractors/extract_mesh_vbo_orco.cc']
report={'status':'NATIVE_CPU_FIELD_RESEARCH_ZERO_SUPPORT_CREDIT','supportCredit':0,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceSha256':pin,'captureSha256':sha(__file__),'sourcePins':{p:sha(upstream/p)for p in paths},'actualOwners':objects,'cases':rows,'limits':['CPU Geometry Nodes vector-math field, not direct CD_ORCO memory observation.','MeshVertex.undeformed_co is inverse-transformed ORCO or position, not normalized source words.','No EEVEE coefficient/fused vertex arithmetic or interpolation proof; no GPU context/render used.']}
assert sha(source)==pin;report['sourcePreserved']=True;(out/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_ORCO_CPU_FIELD '+json.dumps({'owners':len(objects),'cases':len(rows),'supportCredit':0}))
