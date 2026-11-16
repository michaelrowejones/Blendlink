# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only actual source/export association. No render or GPU module."""
import bpy,json,sys,hashlib,struct
from pathlib import Path
source,out,upstream,glb=map(lambda x:Path(x).resolve(),sys.argv[sys.argv.index('--')+1:])
sha=lambda b:hashlib.sha256(b).hexdigest();source_pin=sha(source.read_bytes());assert source_pin=='6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c'
bpy.ops.wm.open_mainfile(filepath=str(source));dg=bpy.context.evaluated_depsgraph_get()
def wordset(points):return sorted(set(struct.pack('<3f',*p).hex()for p in points))
def triangle_keys(points,triangles):
 words=[struct.pack('<3f',*p).hex()for p in points]
 result=[]
 for triangle in triangles:
  a,b,c=[words[i]for i in triangle];result.append(min(a+b+c,b+c+a,c+a+b))
 return sorted(result)
native=[]
for ob in bpy.data.objects:
 if ob.type!='MESH'or not any(s.material and s.material.name=='Material'for s in ob.material_slots):continue
 evaluated=ob.evaluated_get(dg);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=dg)
 try:
  positions=[list(v.co)for v in mesh.vertices];mesh.calc_loop_triangles();triangles=[list(t.vertices)for t in mesh.loop_triangles];loc=list(ob.data.texspace_location);size=list(ob.data.texspace_size)
  native.append({'name':ob.name,'mode':ob.mode,'positions':positions,'positionWordSet':wordset(positions),'triangleKeys':triangle_keys(positions,triangles),'sourceTexspace':{'location':loc,'size':size},'shapeKeys':ob.data.shape_keys is not None,'textureMesh':ob.data.texture_mesh.name if ob.data.texture_mesh else None,'modifiers':[{'type':m.type,'render':m.show_render,'viewport':m.show_viewport}for m in ob.modifiers],'matrix':[list(row)for row in ob.matrix_world]})
 finally:evaluated.to_mesh_clear()
raw=glb.read_bytes();json_len=struct.unpack_from('<I',raw,12)[0];document=json.loads(raw[20:20+json_len]);bin_start=20+json_len;bin_len,bin_type=struct.unpack_from('<II',raw,bin_start);assert bin_type==0x004e4942;blob=raw[bin_start+8:bin_start+8+bin_len]
meshes=[]
for mesh in document['meshes']:
 extras=mesh.get('extras',{}).get('blendlink_tsl_runtime')
 if not extras or 'texspace'not in extras:continue
 points=[];export_triangles=[]
 for primitive in mesh['primitives']:
  accessor=document['accessors'][primitive['attributes']['POSITION']];assert accessor['componentType']==5126 and accessor['type']=='VEC3'and'sparse'not in accessor
  view=document['bufferViews'][accessor['bufferView']];offset=view.get('byteOffset',0)+accessor.get('byteOffset',0);stride=view.get('byteStride',12)
  first_vertex=len(points)
  for i in range(accessor['count']):
   x,y,z=struct.unpack_from('<3f',blob,offset+i*stride);points.append([x,-z,y])
  if 'indices'in primitive:
   ia=document['accessors'][primitive['indices']];iv=document['bufferViews'][ia['bufferView']];io=iv.get('byteOffset',0)+ia.get('byteOffset',0);fmt={5121:'B',5123:'H',5125:'I'}[ia['componentType']];item=struct.calcsize(fmt);index=[struct.unpack_from('<'+fmt,blob,io+j*item)[0]+first_vertex for j in range(ia['count'])]
  else:index=list(range(first_vertex,len(points)))
  assert len(index)%3==0
  export_triangles.extend([index[i:i+3]for i in range(0,len(index),3)])
 key=wordset(points);bbox=extras['texspace'];same_positions=[o for o in native if o['positionWordSet']==key]
 exact=[o for o in same_positions if o['sourceTexspace']==bbox];topology=triangle_keys(points,export_triangles);full=[o for o in exact if o['triangleKeys']==topology]
 meshes.append({'exportedName':mesh.get('name'),'vertices':len(points),'uniquePositions':len(key),'positionMatches':[o['name']for o in same_positions],'exactPositionAndTexspaceMatches':[o['name']for o in exact],'exactOrientedTriangleAndTexspaceMatches':[o['name']for o in full],'triangles':len(export_triangles)})
paths=['source/blender/blenkernel/intern/object_update.cc','source/blender/blenkernel/intern/mesh_data_update.cc','source/blender/blenkernel/intern/mesh.cc','source/blender/modifiers/intern/MOD_bevel.cc','source/blender/draw/intern/shaders/draw_resource_finalize.bsl.hh','source/blender/draw/engines/eevee/shaders/eevee_geom_mesh.bsl.hh','source/blender/draw/engines/eevee/shaders/eevee_attributes_mesh_lib.bsl.hh']
report={'status':'CPU_SOURCE_EXPORT_ASSOCIATION_RESEARCH_ZERO_CREDIT','supportCredit':0,'sourceSha256':source_pin,'glbSha256':sha(raw),'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'depsgraphMode':dg.mode,'captureSha256':sha(Path(__file__).read_bytes()),'sourcePins':{p:sha((upstream/p).read_bytes())for p in paths},'owners':native,'meshes':meshes,'limits':['Oriented triangle-position multisets prove topology without requiring loop/index order; actual render CD_ORCO words still not directly observed.','Viewport/context depsgraph; render/view eligibility and independent native Emission Generated reference still required.','No GPU import/render; no source modification.']}
assert sha(source.read_bytes())==source_pin;report['sourcePreserved']=True;(out/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_ORCO_ASSOCIATION '+json.dumps({'owners':len(native),'meshes':len(meshes),'uniqueExact':sum(len(m['exactPositionAndTexspaceMatches'])==1 for m in meshes),'positionOnly':sum(bool(m['positionMatches'])for m in meshes)}))
