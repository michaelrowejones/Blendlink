# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only custom CORNER transport; original evaluated topology stays intact."""
import bpy, hashlib, inspect, json, math, struct, sys
from pathlib import Path
import io_scene_gltf2
source,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:])
out.mkdir()
sha=lambda b:hashlib.sha256(b).hexdigest()
floats=lambda values:struct.pack('<'+'f'*len(values),*values)
flat=lambda rows:[x for row in rows for x in row]
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
assert sha(source.read_bytes())=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
report={'status':'CAPTURED_CPU_TRANSPORT_NOT_FRAME_QUALIFICATION','supportCredit':0,'renderCalls':0,'sourceSaveCalls':0,'sourceSha256':sha(source.read_bytes()),'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'gltfExporterVersion':list(io_scene_gltf2.bl_info['version']),'producerSha256':sha(Path(__file__).read_bytes()),'rows':[]}
(out/'producer.py').write_bytes(Path(__file__).read_bytes())
exporter=Path(inspect.getfile(io_scene_gltf2)).parent/'blender/exp/primitive_extract.py'
report['exporterSource']={'path':str(exporter),'sha256':sha(exporter.read_bytes())}

def snapshot(mesh):
 mesh.calc_loop_triangles()
 return {'positions':sha(floats(flat([v.co for v in mesh.vertices]))),'normals':sha(floats(flat([v.vector for v in mesh.corner_normals]))),'corners':sha(b''.join(struct.pack('<I',x.vertex_index) for x in mesh.loops)),'polygons':[list(p.loop_indices) for p in mesh.polygons],'triangles':[list(t.loops) for t in mesh.loop_triangles],'uv':{u.name:sha(floats(flat([v.uv for v in u.data]))) for u in mesh.uv_layers}}

def transport(mesh,name):
 before=snapshot(mesh)
 normals=[list(v.vector) for v in mesh.corner_normals]
 tangents=[[(-1 if i%2 else 1)*.125,.25,(i%4+1)*.125] for i in range(len(mesh.loops))]
 signs=[1 if i%2 else -1 for i in range(len(mesh.loops))]
 loops=list(range(len(mesh.loops)))
 for attr_name,kind,values in [('_STW_FRAME_N','FLOAT_VECTOR',flat(normals)),('_STW_FRAME_T','FLOAT_VECTOR',flat(tangents)),('_STW_FRAME_SIGN','FLOAT',signs),('_STW_CORNER','FLOAT',loops)]:
  assert mesh.attributes.get(attr_name) is None
  attr=mesh.attributes.new(attr_name,kind,'CORNER');attr.data.foreach_set('vector' if kind=='FLOAT_VECTOR' else 'value',values)
  path=out/(name+attr_name+'.f32');path.write_bytes(floats(values))
 assert snapshot(mesh)==before,'Custom attributes changed private normals/topology/UV'
 positions=[list(v.co) for v in mesh.vertices]
 metadata={'name':name,'vertices':len(mesh.vertices),'loops':len(mesh.loops),'faces':len(mesh.polygons),'ngons':sum(len(p.vertices)>4 for p in mesh.polygons),'cornerVertices':[v.vertex_index for v in mesh.loops],'positions':positions,'triangles':before['triangles'],'before':before,'customVectorConventionExpected':'raw Blender XYZ (custom generic attributes are not POSITION/NORMAL)','attributes':{key:{'type':kind,'file':name+key+'.f32','sha256':sha((out/(name+key+'.f32')).read_bytes())} for key,kind in [('_STW_FRAME_N','VEC3'),('_STW_FRAME_T','VEC3'),('_STW_FRAME_SIGN','SCALAR'),('_STW_CORNER','SCALAR')]},'exports':[]}
 mat=bpy.data.materials.new(name+' neutral private PBR');mat.use_nodes=True
 mesh.materials.clear();mesh.materials.append(mat)
 for p in mesh.polygons:p.material_index=0
 assert snapshot(mesh)==before
 old_scene=bpy.context.window.scene
 scene=bpy.data.scenes.new(name+' private export scene');owner=bpy.data.objects.new(name,mesh);scene.collection.objects.link(owner)
 try:
  bpy.context.window.scene=scene;owner.select_set(True);bpy.context.view_layer.objects.active=owner
  for yup in [False,True]:
   path=out/(name+('-yup' if yup else '-zup')+'.glb')
   result=bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=yup,export_apply=False,export_normals=True,export_tangents=True,export_texcoords=True,export_attributes=True,export_materials='EXPORT',export_animations=False,export_skins=False,export_morph=False)
   assert result=={'FINISHED'}
   assert snapshot(mesh)==before,'Export changed private normals/topology/UV'
   metadata['exports'].append({'file':path.name,'yup':yup,'sha256':sha(path.read_bytes())})
 finally:
  bpy.context.window.scene=old_scene
  bpy.data.objects.remove(owner,do_unlink=True);bpy.data.scenes.remove(scene);mesh.materials.clear();bpy.data.materials.remove(mat)
 metadata['privateInputPreserved']=True
 path=out/(name+'.json');path.write_text(json.dumps(metadata,indent=2)+'\n')
 report['rows'].append({'name':name,'file':path.name,'sha256':sha(path.read_bytes())})

bpy.ops.wm.open_mainfile(filepath=str(source));dg=bpy.context.evaluated_depsgraph_get()
original={name:snapshot(bpy.data.objects[name].data) for name in ['Walls','Plane.021']}
for name in ['Walls','Plane.021']:
 owner=bpy.data.objects[name]
 mesh=bpy.data.meshes.new_from_object(owner.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
 try:transport(mesh,name)
 finally:bpy.data.meshes.remove(mesh)
 assert snapshot(owner.data)==original[name]
# Two triangles share points but have independent corner normals/UV seams.
mesh=bpy.data.meshes.new('Seam source');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0),(0,0,1)],[],[(0,1,2),(0,3,1)]);mesh.update()
uv=mesh.uv_layers.new(name='UVMap')
for item,xy in zip(uv.data,[(0,0),(1,0),(0,1),(.25,.25),(.25,.75),(.75,.25)]):item.uv=xy
try:transport(mesh,'seam')
finally:bpy.data.meshes.remove(mesh)
report['originalMeshBytesUnchanged']=all(snapshot(bpy.data.objects[name].data)==original[name] for name in original)
report['sourceUnchanged']=sha(source.read_bytes())==report['sourceSha256'];assert report['originalMeshBytesUnchanged'] and report['sourceUnchanged']
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_CORNER_TRANSPORT_CAPTURED '+json.dumps({'rows':len(report['rows']),'sourceUnchanged':True,'supportCredit':0}))
