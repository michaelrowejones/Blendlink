# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU-only native tangent topology/UV investigation; no renders/source saves."""
import hashlib,json,math,struct,subprocess,sys
from pathlib import Path
import bpy
from mathutils import Vector

args=sys.argv[sys.argv.index('--')+1:]
source,out,binary=Path(args[0]).resolve(),Path(args[1]).resolve(),Path(args[2]).resolve()
out.mkdir()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(source)=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
source_hash=sha(source)
report={'role':'Source-derived Mikk callback CPU model and API/export barrier controls, not native draw/GPU frame qualification',
 'nativeBuild':bpy.app.build_hash.decode(),'sourceSha256':source_hash,'producerSha256':sha(__file__),
 'mikkBinarySha256':sha(binary),'renderAttempts':0,'saveCalls':0,'supportCredit':0,'sceneAcceptance':False,'fixtures':[],'owners':[]}
(out/'producer.py').write_bytes(Path(__file__).read_bytes())

def data(mesh):
 mesh.calc_loop_triangles();uv=next(x for x in mesh.uv_layers if x.active_render)
 return {'positions':[list(v.co) for v in mesh.vertices],
  'cornerVertices':[x.vertex_index for x in mesh.loops],
  'cornerNormals':[list(x.vector) for x in mesh.corner_normals],
  'uvName':uv.name,'cornerUvs':[list(x.uv) for x in uv.data],
  'faces':[list(x.loop_indices) for x in mesh.polygons],
  'triangles':[{'loops':list(x.loops),'face':x.polygon_index} for x in mesh.loop_triangles]}

def face_model(d,mode):
 if mode=='all-triangles':return[x['loops'] for x in d['triangles']]
 # Independently construct the same interface shape required by draw's
 # all-layer Mikk call: authored quads stay quads; n-gons use loop triangles.
 result=[];seen=set()
 for tri in d['triangles']:
  face=d['faces'][tri['face']]
  if len(face)==4:
   if tri['face'] not in seen:result.append(face);seen.add(tri['face'])
  else:result.append(tri['loops'])
 return result

def evaluate(d,mode,stem):
 faces=face_model(d,mode);lines=[str(len(faces))]
 for face in faces:
  lines.append(str(len(face)))
  for loop in face:
   values=[loop,*d['positions'][d['cornerVertices'][loop]],*d['cornerNormals'][loop],*d['cornerUvs'][loop]]
   lines.append(' '.join(str(v) for v in values))
 payload=('\n'.join(lines)+'\n').encode();input_path=out/(stem+'-'+mode+'.mesh');input_path.write_bytes(payload)
 result=subprocess.run([str(binary)],input=payload,capture_output=True,check=True)
 path=out/(stem+'-'+mode+'.tangents');path.write_bytes(result.stdout)
 values={};writes={}
 for line in result.stdout.decode().splitlines():
  items=line.split();loop=int(items[0]);value=[struct.unpack('<f',struct.pack('<f',float(x)))[0] for x in items[1:]]
  values[loop]=value;writes.setdefault(loop,[]).append(value)
 repeat_disagreements=sum(any(max(abs(a-b) for a,b in zip(row,rows[0]))>1e-6 for row in rows[1:]) for rows in writes.values())
 return values,{'inputSha256':sha(input_path),'outputSha256':sha(path),'callbackFaces':len(faces),
  'callbackCorners':sum(map(len,faces)),'repeatedOriginalLoopDifferentOutputs':repeat_disagreements}

def inspect(mesh,stem):
 d=data(mesh);(out/(stem+'.json')).write_text(json.dumps(d,separators=(',',':'))+'\n')
 row={'id':stem,'vertices':len(mesh.vertices),'loops':len(mesh.loops),'faces':len(mesh.polygons),
  'ngons':sum(len(x)>4 for x in d['faces']),'quads':sum(len(x)==4 for x in d['faces']),
  'triangles':len(d['triangles']),'uvName':d['uvName'],'datasetSha256':sha(out/(stem+'.json'))}
 areas=[]
 for tri in d['triangles']:
  a,b,c=[d['cornerUvs'][i] for i in tri['loops']]
  areas.append((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
 row['uvAreaBelow1eMinus8']=sum(abs(a)<1e-8 for a in areas);row['zeroUvArea']=sum(a==0 for a in areas)
 try:
  mesh.calc_tangents(uvmap=d['uvName']);public={x.index:[*x.tangent,x.bitangent_sign] for x in mesh.loops};row['publicApi']='computed'
 except RuntimeError as error:public=None;row['publicApi']='refused';row['publicError']=str(error)
 native,proof=evaluate(d,'native-face-model',stem);row['sourceCallbackModel']=proof
 triangulated,other=evaluate(d,'all-triangles',stem);row['allTrianglesModel']=other
 row['quadPreservationMaximumDifference']=max(max(abs(a-b) for a,b in zip(native[i],triangulated[i])) for i in native)
 if public is not None:row['publicVsSourceCallbackMaximumDifference']=max(max(abs(a-b) for a,b in zip(native[i],public[i])) for i in native)
 lengths=[Vector(t[:3]).length for t in native.values()]
 row['tangentLengthRange']=[min(lengths),max(lengths)]
 row['nonfiniteTangents']=sum(not all(math.isfinite(x) for x in t) for t in native.values())
 row['defaultPositiveXNegativeSignCorners']=sum(t==[1,0,0,-1] for t in native.values())
 row['zeroPositiveSignSentinelCorners']=sum(t==[0,0,0,1] for t in native.values())
 bad=[]
 for triangle_index,tri in enumerate(d['triangles']):
  for loop in tri['loops']:
   t=Vector(native[loop][:3]);n=Vector(d['cornerNormals'][loop])
   sine=t.cross(n).length/max(1e-30,t.length*n.length)
   if sine<.05:bad.append({'triangle':triangle_index,'loop':loop,'sine':sine,'tangent':native[loop],'normal':list(n)})
 row['nearlyParallelCornerReferences']=len(bad);row['parallelExamples']=bad[:4]
 row['_nativeValues']=native
 return row

def proxy_model(d,native,stem):
 faces=face_model(d,'native-face-model');mapping=[i for face in faces for i in face]
 mesh=bpy.data.meshes.new(stem+' private n-gons-only triangulation')
 mesh.from_pydata(d['positions'],[],[[d['cornerVertices'][i] for i in face] for face in faces]);mesh.update()
 uv=mesh.uv_layers.new(name=d['uvName'])
 for index,original in enumerate(mapping):uv.data[index].uv=d['cornerUvs'][original]
 for face in mesh.polygons:face.use_smooth=True
 mesh.normals_split_custom_set([d['cornerNormals'][i] for i in mapping])
 actual_normals=[list(x.vector) for x in mesh.corner_normals]
 assert all(list(uv.data[i].uv)==d['cornerUvs'][original] for i,original in enumerate(mapping))
 mesh.calc_tangents(uvmap=d['uvName'])
 def packed(v):return[math.trunc(struct.unpack('<f',struct.pack('<f',x*511))[0]) for x in v]
 nmax=0;tmax=0;signs=0;npacked=0;tpacked=0
 for index,original in enumerate(mapping):
  expected=native[original];actual=[*mesh.loops[index].tangent,mesh.loops[index].bitangent_sign]
  nmax=max(nmax,max(abs(a-b) for a,b in zip(actual_normals[index],d['cornerNormals'][original])))
  tmax=max(tmax,max(abs(a-b) for a,b in zip(actual[:3],expected[:3])))
  signs+=actual[3]!=expected[3]
  npacked+=packed(actual_normals[index])!=packed(d['cornerNormals'][original])
  tpacked+=packed(actual[:3])!=packed(expected[:3])
 result={'corners':len(mapping),'uvFloat32BytesPreserved':True,'normalMaximumDifference':nmax,
  'normalSnorm10ChangedCorners':npacked,'tangentMaximumDifference':tmax,
  'tangentSnorm10ChangedCorners':tpacked,'handednessChangedCorners':signs,
  'nativeNgonApiBarrierRemoved':True,'drawGpuFrameQualification':False}
 bpy.data.meshes.remove(mesh)
 return result

def stock_gltf_control(mesh,stem,native):
 for obj in bpy.context.selected_objects:obj.select_set(False)
 owner=bpy.data.objects.new('Owned '+stem,mesh);bpy.context.scene.collection.objects.link(owner)
 owner.select_set(True);bpy.context.view_layer.objects.active=owner
 path=out/(stem+'-stock.glb')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
  export_yup=False,export_normals=True,export_tangents=True,export_texcoords=True,
  export_materials='NONE',export_animations=False,export_skins=False,export_morph=False)
 payload=path.read_bytes();length=struct.unpack_from('<I',payload,12)[0]
 gltf=json.loads(payload[20:20+length]);binary=payload[28+length:]
 primitives=[primitive for mesh_ in gltf.get('meshes',[]) for primitive in mesh_['primitives']]
 has_tangents=all('TANGENT' in primitive['attributes'] for primitive in primitives)
 def accessor(index):
  a=gltf['accessors'][index];view=gltf['bufferViews'][a['bufferView']];width={'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
  assert a['componentType']==5126
  offset=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',width*4)
  return[struct.unpack_from('<'+'f'*width,binary,offset+i*stride) for i in range(a['count'])]
 result={'glbSha256':sha(path),'tangentAttributePresent':has_tangents}
 if has_tangents:
  expected={tuple(mesh.vertices[loop.vertex_index].co):native[loop.index] for loop in mesh.loops}
  differences=[]
  for primitive in primitives:
   for position,tangent in zip(accessor(primitive['attributes']['POSITION']),accessor(primitive['attributes']['TANGENT'])):
    differences.extend(abs(a-b) for a,b in zip(tangent,expected[tuple(position)]))
  result['stockAccessorVsNativeMaximumDifference']=max(differences)
 bpy.data.objects.remove(owner,do_unlink=True)
 return result

# Small authored controls, independent of original scene contents.
bpy.ops.wm.read_factory_settings(use_empty=True)
def fixture(name,vertices,faces,uvs):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
 for loop,xy in zip(uv.data,uvs):loop.uv=xy
 return mesh
fixtures=[
 fixture('ngon',[(0,0,0),(2,0,0),(2,1,0),(1,.4,0),(0,1,0)],[(0,1,2,3,4)],[(0,0),(1,0),(1,1),(.5,.4),(0,1)]),
 fixture('zero-uv-normal-parallel',[(0,0,0),(0,1,0),(0,0,1)],[(0,1,2)],[(0,0)]*3),
 fixture('tiny-uv',[(0,0,0),(1,0,0),(0,1,0)],[(0,1,2)],[(0,0),(1e-6,0),(0,1e-6)]),
 fixture('warped-quad',[(0,0,0),(1,0,.1),(1,1,.6),(0,1,0)],[(0,1,2,3)],[(0,0),(1,0),(.15,.8),(.1,1)]),
]
for mesh in fixtures:
 row=inspect(mesh,mesh.name);native=row.pop('_nativeValues');row['stockGltf']=stock_gltf_control(mesh,mesh.name,native);row['privateProxy']=proxy_model(data(mesh),native,mesh.name);report['fixtures'].append(row)
 assert row['nonfiniteTangents']==0
assert report['fixtures'][0]['publicApi']=='refused'
assert report['fixtures'][1]['nearlyParallelCornerReferences']==3
assert report['fixtures'][2]['publicApi']=='computed' and report['fixtures'][2]['uvAreaBelow1eMinus8']==1
# Actual immutable original, evaluated read-only. No material graph substitution.
bpy.ops.wm.open_mainfile(filepath=str(source));depsgraph=bpy.context.evaluated_depsgraph_get()
for name in ['Walls','Plane.021']:
 obj=bpy.data.objects[name];mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph),preserve_all_data_layers=True,depsgraph=depsgraph)
 row=inspect(mesh,name);native=row.pop('_nativeValues');row['privateProxy']=proxy_model(data(mesh),native,name);report['owners'].append(row);bpy.data.meshes.remove(mesh)
report['sourceUnchanged']=sha(source)==source_hash;assert report['sourceUnchanged']
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print('ARCHVIZ_TANGENT_CPU_AUDIT '+json.dumps(report))
