# SPDX-License-Identifier: GPL-3.0-or-later
"""Native sibling-node comparison and existing owned scalar transport research."""
import bpy,json,os,sys,hashlib,struct
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon'))
import vertex_color_alpha as transport
from material_compiler import _accessor_values
OUT=Path(os.environ['SCENETOWEB_ATTRIBUTE_ALPHA']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.render.resolution_x=scene.render.resolution_y=64;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.world=None
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.render.dither_intensity=0;scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.exr_codec='NONE'
geometry=json.loads((ROOT/'experiments/vertex-color-alpha/fixture-geometry.json').read_text());mesh=bpy.data.meshes.new('Owned named-alpha mesh');mesh.from_pydata(geometry['nodeVertices'],[],geometry['triangles']);obj=bpy.data.objects.new('Owned named-alpha artist object',mesh);scene.collection.objects.link(obj);material=bpy.data.materials.new('Owned Attribute Alpha');material.use_nodes=True;mesh.materials.append(material);tree=material.node_tree;tree.nodes.clear();sink=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],sink.inputs['Surface']);attribute=tree.nodes.new('ShaderNodeAttribute');attribute.attribute_type='GEOMETRY';vertex=tree.nodes.new('ShaderNodeVertexColor')
camera_data=bpy.data.cameras.new('Owned calibrated camera');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new('Owned calibrated camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
def render(label,output):
 for link in list(emission.inputs['Color'].links):tree.links.remove(link)
 tree.links.new(output,emission.inputs['Color']);scene.render.filepath=str(OUT/(label+'.exr'));bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False)
 try:values=array('f',[0])*(64*64*4);image.pixels.foreach_get(values)
 finally:bpy.data.images.remove(image)
 path=OUT/(label+'.rgba32f');path.write_bytes(values.tobytes());return path,values
# Independent native sample-center ramp before comparing either field node.
geo=tree.nodes.new('ShaderNodeNewGeometry');sep=tree.nodes.new('ShaderNodeSeparateXYZ');combine=tree.nodes.new('ShaderNodeCombineXYZ');tree.links.new(geo.outputs['Position'],sep.inputs[0]);combine.inputs['Z'].default_value=.5
for axis in ['X','Y']:
 add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';add.inputs[1].default_value=1;mul=tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=.5;tree.links.new(sep.outputs[axis],add.inputs[0]);tree.links.new(add.outputs[0],mul.inputs[0]);tree.links.new(mul.outputs[0],combine.inputs[axis])
ramp_path,ramp=render('independent-ramp',combine.outputs[0]);assert all(ramp[4*(y*64+x)+i]==v for y in range(64)for x in range(64)for i,v in enumerate(((x+.5)/64,(y+.5)/64,.5,1))), 'Native sample centers differ; do not continue'
rows=[]
cases=[('zero','Paint','POINT',[0]*4),('one','Paint','POINT',[1]*4),('point-nonuniform','Paint','POINT',[0,.1,1/3,1]),('corner-seam','Paint','CORNER',[0,.1,1/3,.25,.8,1]),('reserved-color','color','POINT',[0,.1,1/3,1]),('reserved-temperature','temperature','POINT',[0,.1,1/3,1])]
for label,name,domain,alphas in cases:
 for layer in list(mesh.color_attributes):mesh.color_attributes.remove(layer)
 layer=mesh.color_attributes.new(name=name,type='FLOAT_COLOR',domain=domain);raw=array('f',[lane for value in alphas for lane in (.125,.25,.5,value)]);layer.data.foreach_set('color',raw);before=array('f',[0])*len(raw);layer.data.foreach_get('color',before);alpha_words=list(struct.unpack('='+str(len(before))+'I',before.tobytes()))[3::4]
 # An unrelated active render layer distinguishes explicit name from fallback.
 decoy=mesh.color_attributes.new(name='Unrelated render layer',type='FLOAT_COLOR',domain=domain);decoy.data.foreach_set('color',array('f',[1]*(len(decoy.data)*4)));mesh.color_attributes.active_color_index=1;mesh.color_attributes.render_color_index=1
 attribute.attribute_name=name;vertex.layer_name=name
 for link in list(emission.inputs['Color'].links):tree.links.remove(link)
 tree.links.new(attribute.outputs['Alpha'],emission.inputs['Color']);source=OUT/(label+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source));source_hash=sha(source)
 snapshot=lambda:(obj.data.as_pointer(),mesh.users,material.users,tree.users,len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.materials),[(l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier)for l in tree.links],[(a.name,a.domain,a.data_type)for a in mesh.attributes],mesh.color_attributes.active_color_index,mesh.color_attributes.render_color_index)
 source_snapshot=snapshot();attribute_path,a=render(label+'-attribute',attribute.outputs['Alpha']);vertex_path,b=render(label+'-vertex',vertex.outputs['Alpha']);tree.links.remove(emission.inputs['Color'].links[0]);tree.links.new(attribute.outputs['Alpha'],emission.inputs['Color'])
 aw=struct.unpack('='+str(len(a))+'I',a.tobytes());bw=struct.unpack('='+str(len(b))+'I',b.tobytes());differences=sum(x!=y for x,y in zip(aw,bw));max_abs=max(abs(x-y)for x,y in zip(a,b));assert(differences>0 if name=='temperature'else differences==0),(label,differences)
 private_mesh=mesh.copy();private_obj=bpy.data.objects.new('Owned export-only '+label,private_mesh);scene.collection.objects.link(private_obj);generated=None
 try:
  carriers,proof=transport.install(private_obj,{name},{},material=material.name,slot=0,basis='gltf-y-up');descriptor=carriers[name];scalar=private_mesh.attributes[descriptor['semantic']];stored=array('f',[0])*len(scalar.data);scalar.data.foreach_get('value',stored);assert list(struct.unpack('='+str(len(stored))+'I',stored.tobytes()))==alpha_words
  generated=material.copy();generated['blendlink_source_material']=material.name;generated['blendlink_material_variant']='attribute-research';private_mesh.materials[0]=generated
  selected=list(bpy.context.selected_objects);active=bpy.context.view_layer.objects.active
  for item in selected:item.select_set(False)
  private_obj.select_set(True);bpy.context.view_layer.objects.active=private_obj
  glb=OUT/(label+'.glb');bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_attributes=True,export_extras=True,export_vertex_color='NONE',export_animations=False,export_cameras=False,export_lights=False)
  payload=glb.read_bytes();size,tag=struct.unpack_from('<II',payload,12);document=json.loads(payload[20:20+size]);binary=payload[28+size:]
  fact={'source':material.name,'variant':'attribute-research','tslRuntimeMeshes':{private_obj.name:{'vertexColorAlpha':carriers,'vertexColorAlphaProof':{name:[proof[name]]}}}}
  transport.attest(document,binary,{generated.name:fact},_accessor_values)
 finally:
  private_obj.select_set(False);bpy.data.objects.remove(private_obj,do_unlink=True);bpy.data.meshes.remove(private_mesh)
  if generated:bpy.data.materials.remove(generated)
  for item in selected:item.select_set(True)
  bpy.context.view_layer.objects.active=active
 after=array('f',[0])*len(before);layer.data.foreach_get('color',after);assert after.tobytes()==before.tobytes()and snapshot()==source_snapshot and sha(source)==source_hash
 rows.append({'case':label,'name':name,'domain':domain,'alphaWords':alpha_words,'sourceFile':source.name,'sourceSha256':source_hash,'attributeFile':attribute_path.name,'attributeSha256':sha(attribute_path),'vertexFile':vertex_path.name,'vertexSha256':sha(vertex_path),'words':len(a),'wordDifferences':differences,'maxAbsDifference':max_abs,'expectedEquivalent':name!='temperature','ownedCarrier':descriptor,'actualIndexedGLBAttestation':True,'glb':glb.name,'glbSha256':sha(glb),'sourcePreserved':True,'ownershipRestored':True})
import gpu
report={'status':'CAPTURED_ATTRIBUTE_ALPHA_FEASIBILITY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'nativeBackend':gpu.platform.backend_type_get(),'nativeRenderer':gpu.platform.renderer_get(),'size':[64,64],'nativeRenders':13,'calibration':{'file':ramp_path.name,'sha256':sha(ramp_path),'exactPixels':4096},'rows':rows,'supportCredit':0,'FinalCredit':0,'browserCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
