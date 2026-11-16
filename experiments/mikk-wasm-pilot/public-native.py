# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only actual public native Mikk witness. No shader kernel, render or save."""
import bpy,json,hashlib,struct,sys
from pathlib import Path
source,frozen,output=map(Path,sys.argv[sys.argv.index('--')+1:]);output.mkdir(exist_ok=False)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pin=sha(source);assert pin=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False)
rows=[]
for name in ['Walls','Plane.021']:
 d=json.loads((frozen/(name+'.json')).read_text());obj=bpy.data.objects[name]
 mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()),preserve_all_data_layers=True,depsgraph=bpy.context.evaluated_depsgraph_get())
 try:
  assert [loop.vertex_index for loop in mesh.loops]==d['cornerVertices']
  assert [list(polygon.loop_indices)for polygon in mesh.polygons]==d['faces']
  actual={'positions':[list(v.co)for v in mesh.vertices],'cornerNormals':[list(n.vector)for n in mesh.corner_normals],'cornerUvs':[list(v.uv)for v in mesh.uv_layers[d['uvName']].data]}
  for key,values in actual.items():
   assert len(values)==len(d[key]);assert b''.join(struct.pack('<f',v)for x in values for v in x)==b''.join(struct.pack('<f',v)for x in d[key]for v in x),key
  row={'id':name,'inputDatasetSha256':sha(frozen/(name+'.json')),'originalInputWordsExact':True}
  try:
   mesh.calc_tangents(uvmap=d['uvName']);data=b''.join(struct.pack('<Iffff',loop.index,*loop.tangent,loop.bitangent_sign)for loop in mesh.loops)
   p=output/(name+'.public.bin');p.write_bytes(data);row.update(status='computed',loops=len(mesh.loops),file=p.name,sha256=sha(p))
  except RuntimeError as e:row.update(status='refused',error=str(e))
  rows.append(row)
 finally:bpy.data.meshes.remove(mesh)
assert sha(source)==pin
r={'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceSha256':pin,'sourceUnchanged':True,'renderCalls':0,'saveCalls':0,'producerSha256':sha(__file__),'rows':rows};(output/'report.json').write_text(json.dumps(r,indent=2)+'\n');print('SCENETOWEB_MIKK_PUBLIC_CPU '+json.dumps(r))
