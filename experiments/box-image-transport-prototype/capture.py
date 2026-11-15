# SPDX-License-Identifier: GPL-3.0-or-later
"""Research source/sampler oracle. No actual EEVEE material or port credit."""
import hashlib,json,re,sys,time
from pathlib import Path
import bpy,numpy as np

ROOT=Path(__file__).resolve().parents[2]
args=sys.argv[sys.argv.index('--')+1:];source,out,upstream=map(lambda x:Path(x).resolve(),args[:3]);schema='--schema-only'in args
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
contract=json.loads((out/'contract.json').read_text());pin=sha(source);assert pin==contract['sourceSha256']
assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source))
tree=bpy.data.materials['Plaster'].node_tree;images=[]
for name in ['Image Texture','Image Texture.002']:
 node=tree.nodes[name];image=node.image
 assert node.projection=='BOX'and node.projection_blend==contract['blend']and node.interpolation=='Linear'and node.extension=='REPEAT'
 assert tuple(image.size)==(1024,1024)and image.packed_file and not image.is_float
 file=image.name;raw=bytes(image.packed_file.data);assert raw.startswith(b'\x89PNG\r\n\x1a\n');(out/file).write_bytes(raw)
 pixels=np.empty(1024*1024*4,np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(-1,4)
 images.append({'name':file,'file':file,'sha256':sha(out/file),'bytes':len(raw),'width':1024,'height':1024,'colorSpace':image.colorspace_settings.name,'alphaMode':image.alpha_mode,'channelRanges':[[float(pixels[:,i].min()),float(pixels[:,i].max())]for i in range(4)],'opaque':bool(np.all(pixels[:,3]==1))})
owners=[{'name':o.name,'matrix':list(o.matrix_world),'vertices':len(o.data.vertices),'polygons':len(o.data.polygons),'uvMaps':[v.name for v in o.data.uv_layers]}for o in bpy.data.objects if o.type=='MESH'and any(s.material and s.material.name=='Plaster'for s in o.material_slots)]
owners=[{**o,'matrix':[list(row)for row in o['matrix']]}for o in owners]
native=upstream/'source/blender/gpu/shaders/material/gpu_shader_material_tex_image.bsl.hh'
text=native.read_text();originals={name:re.search(r'void '+name+r'\(.*?\n\}',text,re.S).group(0)for name in['tex_box_blend','tex_box_sample_linear']}
def adapt(body):
 body=body.replace('float2','vec2').replace('float3','vec3').replace('float4','vec4')
 body=re.sub(r'\s*\[\[resource_table\]\] KernelGlobals & /\*kg\*/,','',body)
 return re.sub(r'\b(vec4|float) &(\w+)',r'out \1 \2',body)
functions={name:adapt(body)for name,body in originals.items()}
for name,body in originals.items():(out/(name+'.bsl.txt')).write_text(body)
for name,body in functions.items():(out/(name+'.glsl')).write_text(body)
report={'status':'SOURCE_ONLY_NO_GPU'if schema else'running','supportCredit':0,'actualMaterialCredit':0,'source':str(source),'sourceSha256':pin,'sourcePreserved':True,'images':images,'owners':owners,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'nativeSource':str(native),'nativeSourceSha256':sha(native),'captureSha256':sha(__file__),'contractSha256':sha(out/'contract.json'),'adaptation':'Type constructor spelling and output-reference/unused-resource ABI only; arithmetic expressions unchanged','rows':[]}
if not schema:
 import gpu
 sys.path.insert(0,str(ROOT/'experiments/native-f32-oracle-research'))
 from framebuffer_oracle import FramebufferOracle,initialize_metal,calibration
 report['oracleSha256']=sha(ROOT/'experiments/native-f32-oracle-research/framebuffer_oracle.py')
 report['gpu']=initialize_metal();oracle=FramebufferOracle(64);report['calibration']=calibration(oracle)
 weights=oracle.compile(functions['tex_box_blend']+'\nvoid main(){vec4 color;float alpha;tex_box_blend(sourceNormal.xyz,vec4(1,0,0,1),vec4(0,1,0,1),vec4(0,0,1,1),sourceNormal.w,color,alpha);fragColor=color;}',uniforms=['sourceNormal'])
 def save(case,actual,elapsed):
  file=case['id']+'.rgba32f';(out/file).write_bytes(actual.astype('<f4').tobytes());report['rows'].append({**case,'file':file,'sha256':sha(out/file),'words':actual.size,'finite':bool(np.isfinite(actual).all()),'drawAndReadbackMs':elapsed})
 for case in contract['weightCases']:
  start=time.perf_counter();actual=oracle.draw(weights,uniforms={'sourceNormal':case['normal']+[case['blend']]});save(case,actual,(time.perf_counter()-start)*1000)
 oracle.release()
 # Reuse the existing owned orthographic/emission/EXR capture pattern.
 # Actual EEVEE Image Texture chooses its own mip/anisotropic sampler.
 from mathutils import Vector
 scene=bpy.data.scenes.new('Owned BOX image sampler research');bpy.context.window.scene=scene
 scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
 scene.render.resolution_x=64;scene.render.resolution_y=4;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
 scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
 scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='NONE'
 mesh=bpy.data.meshes.new('Owned BOX geometry');owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner)
 camera_data=bpy.data.cameras.new('Owned BOX orthographic');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);scene.camera=camera
 material=bpy.data.materials.new('Owned actual BOX texture');material.use_nodes=True;t=material.node_tree;t.nodes.clear();sink=t.nodes.new('ShaderNodeOutputMaterial');emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface']);mesh.materials.append(material)
 tc=t.nodes.new('ShaderNodeTexCoord');field=t.nodes.new('ShaderNodeTexImage');field.interpolation='Closest';field.extension='EXTEND';t.links.new(tc.outputs['Window'],field.inputs['Vector'])
 # Reuse the native NoiseColor oracle's immutable nearest Float32 input
 # image. Window chooses a texel; image Color supplies exact input bits.
 fields={}
 for frequency in dict.fromkeys(case['frequency']for case in contract['samplerCases']):
  values=np.asarray([[[(x+.5)/64*frequency+.125,.375,.625,1]for x in range(64)]for y in range(4)],np.float32)
  image=bpy.data.images.new('Owned exact BOX coordinates '+str(frequency),width=64,height=4,alpha=True,float_buffer=True);image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT';image.use_half_precision=False;image.pixels.foreach_set(values.ravel());image.update();fields[frequency]=image
 texture=t.nodes.new('ShaderNodeTexImage');texture.projection='BOX';texture.projection_blend=contract['blend'];texture.interpolation='Linear';texture.extension='REPEAT';t.links.new(field.outputs['Color'],texture.inputs['Vector'])
 renders=0;controls=[];captured={}
 def plane(raw_normal):
  n=Vector(raw_normal).normalized();u=n.cross(Vector((0,0,1))if abs(n.z)<.99 else Vector((0,1,0))).normalized();v=n.cross(u).normalized()
  mesh.clear_geometry();mesh.from_pydata([tuple(u*x+v*y)for x,y in[(-2,-2),(2,-2),(2,2),(-2,2)]],[],[(0,1,2,3)]);mesh.update()
  camera.location=n*2;camera.rotation_euler=n.to_track_quat('Z','Y').to_euler()
 def render(id,signal):
  global renders
  t.links.new(signal,emit.inputs['Color']);scene.render.filepath=str(out/(id+'.exr'));started=time.perf_counter();bpy.ops.render.render(write_still=True);elapsed=(time.perf_counter()-started)*1000;renders+=1
  image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.use_half_precision=False;assert tuple(image.size)==(64,4);values=np.empty(1024,np.float32);image.pixels.foreach_get(values);bpy.data.images.remove(image);return values.reshape(256,4),elapsed
 for i,normal in enumerate(dict.fromkeys(tuple(case['normal'])for case in contract['samplerCases'])):
  plane(normal);field.image=fields[8];raw,elapsed=render('window-control-'+str(i),field.outputs['Color']);expected=np.asarray([[[(x+.5)/64*8+.125,.375,.625,1]for x in range(64)]for y in range(4)],np.float32).reshape(256,4)
  assert np.array_equal(raw.view(np.uint32),expected.view(np.uint32)),'Native Window input differs from exact pixel-center field'
  file='window-control-'+str(i)+'.rgba32f';(out/file).write_bytes(raw.astype('<f4').tobytes());controls.append({'normal':normal,'file':file,'sha256':sha(out/file),'milliseconds':elapsed,'wordDifferences':0})
 for case in contract['samplerCases']:
  key=(case['image'],case['frequency'],tuple(case['normal']))
  if key not in captured:
   plane(case['normal']);field.image=fields[case['frequency']];texture.image=bpy.data.images[case['image']];captured[key]=render(case['id'],texture.outputs['Color'])
  actual,elapsed=captured[key];save({**case,'nativeSampler':'actual EEVEE Linear BOX with native mip/anisotropy policy','nativeReferenceReusedAcrossBrowserPolicies':True},actual,elapsed)
 report['windowControls']=controls;report['actualEeveeRenders']=renders
 report['samplerContract']={'pixels':256,'nativeExtent':[64,4],'rowReduction':False,'inputField':'independently calibrated nearest RGBA32F input image; exact dyadic values; no Window arithmetic assumption','film':'actual EEVEE emission+Raw EXR; half-film image gate only','sourceSampleCallsPerPixel':3,'nativeEeveeAnisotropyParity':False,'browserPolicies':'compare both no-mip and mip variants against one actual EEVEE sampler reference','gpuTimestampMeasurement':False,'failedPriorResearch':'r1 GPUTexture.mipmap_mode binding SystemError retained; not used to select the native material sampler'}
 report['status']='CAPTURED_BOX_SOURCE_AND_SAMPLER_RESEARCH'
assert sha(source)==pin
(out/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_BOX_IMAGE_RESEARCH '+json.dumps({'status':report['status'],'rows':len(report['rows']),'sourcePreserved':True,'portCredit':0}))
