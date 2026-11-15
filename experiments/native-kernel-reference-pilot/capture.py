# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned actual EEVEE references with independent film/carrier calibration."""
import bpy,gpu,json,hashlib,sys,struct,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(parents=True,exist_ok=True)
SCHEMA='--schema-only'in sys.argv;CONTRACT=json.loads(Path(__file__).with_name('contract.json').read_text())
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def defaults(node):
 return {s.identifier:(list(s.default_value)if hasattr(s.default_value,'__len__')and not isinstance(s.default_value,str)else s.default_value)for s in node.inputs if hasattr(s,'default_value')}
def configure(tree,case):
 if case=='gradient-radial':
  n=tree.nodes.new('ShaderNodeTexGradient');n.gradient_type='RADIAL';out='Fac'
 elif case=='noise-fbm3-default':
  n=tree.nodes.new('ShaderNodeTexNoise');n.noise_dimensions='3D';n.noise_type='FBM';n.normalize=True;out='Fac'
 else:
  n=tree.nodes.new('ShaderNodeTexVoronoi');n.voronoi_dimensions='3D';n.feature='F1'if'-f1-'in case else'F2';n.distance='EUCLIDEAN';n.normalize=False;out='Distance'
 initial=defaults(n)
 settings={}if case=='gradient-radial'else({'Scale':5,'Detail':2,'Roughness':.5,'Lacunarity':2,'Distortion':0}if case=='noise-fbm3-default'else{'Scale':5,'Detail':0,'Roughness':.5,'Lacunarity':2,'Smoothness':1,'Exponent':.5,'Randomness':1})
 for name,value in settings.items():
  if name not in initial:
   assert name in {'Smoothness','Exponent'},(case,name,list(initial));continue # Native F1/F2 Euclidean schema omits these inactive controls.
  assert initial[name]==value,(case,name,initial[name],value);next(s for s in n.inputs if s.identifier==name).default_value=value
 return n,out,{'case':case,'nodeType':n.bl_idname,'defaults':initial,'settings':settings,'properties':{name:getattr(n,name)for name in ['gradient_type','noise_dimensions','noise_type','normalize','voronoi_dimensions','feature','distance']if hasattr(n,name)}}
probe=bpy.data.materials.new('Owned kernel RNA probe');probe.use_nodes=True;schema=[]
try:
 for case in CONTRACT['caseIds']:
  probe.node_tree.nodes.clear();n,out,row=configure(probe.node_tree,case);row['scalarOutput']=out;schema.append(row)
finally:bpy.data.materials.remove(probe)
if SCHEMA:
 old=gpu.init;gpu.init=lambda *a,**k:(_ for _ in()).throw(RuntimeError('Schema probe prohibits GPU initialization'))
 try:(OUT/'schema.json').write_text(json.dumps({'status':'CHECKED_NATIVE_KERNEL_RNA_ONLY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'cases':schema,'renders':0,'gpuInitializations':0,'supportCredit':0,'scriptSha256':sha(__file__)},indent=2)+'\n')
 finally:gpu.init=old
 print('CHECKED_NATIVE_KERNEL_RNA_ONLY');sys.exit(0)
bpy.ops.wm.read_factory_settings(use_empty=True) # Remove only this process's factory Cube/Camera/Light before the owned scene.
# Same public EEVEE orthographic/emission atlas pattern as native_shader.py;
# oversized quad keeps raster boundaries outside every captured pixel.
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
scene.render.resolution_x=scene.render.resolution_y=8;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
mesh=bpy.data.meshes.new('Owned oversized calibration quad');mesh.from_pydata([(-2,-2,0),(2,-2,0),(2,2,0),(-2,2,0)],[],[(0,1,2,3)]);owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner)
camera_data=bpy.data.cameras.new('Owned exact orthographic');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
p=np.ones((8,8,4),np.float32)
for y in range(8):
 for x in range(8):p[y,x,:3]=[(x+.5)/8*4-2,(y+.5)/8*4-2,(x+y+1)/8-1]
(OUT/'input.rgba32f').write_bytes(p.astype('<f4').tobytes())
control_values=np.array([0,2**-42,np.nextafter(np.float32(2**-42),np.float32(1)),2**-32,np.nextafter(np.float32(.01),np.float32(1)),.049123456,.9876543,np.nextafter(np.float32(2),np.float32(0))],np.float32)
c=np.ones_like(p);c[:,:,:3]=np.resize(control_values,(8,8))[:,:,None]
images=[]
def image(name,pixels):
 im=bpy.data.images.new(name,width=8,height=8,alpha=True,float_buffer=True);im.colorspace_settings.name='Non-Color';im.alpha_mode='STRAIGHT';im.use_half_precision=False;im.pixels.foreach_set(pixels.ravel());im.update();im.pack();raw=np.empty(256,np.float32);im.pixels.foreach_get(raw);assert np.array_equal(raw.view(np.uint32),pixels.ravel().view(np.uint32));images.append((im,pixels.copy()));return im
source=image('Exact raw kernel input',p);calibration=image('Independent carrier values',c)
rows=[];renders=0

def material(name):
 m=bpy.data.materials.new(name);m.use_nodes=True;t=m.node_tree;t.nodes.clear();sink=t.nodes.new('ShaderNodeOutputMaterial');emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface']);owner.data.materials.clear();owner.data.materials.append(m);return m,t,emit

def input_node(tree,im):
 tex=tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.interpolation='Closest';tex.extension='EXTEND';uv=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(uv.outputs['Window'],tex.inputs['Vector']);return tex.outputs['Color']
def math(t,op,a,b=None,c=None):
 n=t.nodes.new('ShaderNodeMath');n.operation=op
 for i,v in enumerate([a,b,c]):
  if v is None:continue
  if isinstance(v,(int,float)):n.inputs[i].default_value=v
  else:t.links.new(v,n.inputs[i])
 return n.outputs[0]
def split(t,value):
 n=t.nodes.new('ShaderNodeSeparateXYZ');t.links.new(value,n.inputs[0]);return list(n.outputs)
def combine(t,values):
 n=t.nodes.new('ShaderNodeCombineXYZ')
 for i,v in enumerate(values):t.links.new(v,n.inputs[i])
 return n.outputs[0]
def carrier(t,v,plane):
 if plane==0:scales=[1024,2097152];base=v
 else:base=math(t,'FRACT',math(t,'MULTIPLY',v,4294967296));scales=[2048,4194304]
 red=math(t,'DIVIDE',math(t,'FLOOR',math(t,'MULTIPLY',base,scales[0])),2048)
 green=math(t,'DIVIDE',math(t,'FLOOR',math(t,'MULTIPLY',math(t,'FRACT',math(t,'MULTIPLY',base,scales[0])),2048)),2048)
 blue=math(t,'DIVIDE',math(t,'FLOOR',math(t,'MULTIPLY',math(t,'FRACT',math(t,'MULTIPLY',base,scales[1])),2048)),2048)
 return combine(t,[red,green,blue])
def render(name,emit,t,signal):
 global renders
 t.links.new(signal,emit.inputs['Color']);scene.render.filepath=str(OUT/(name+'.exr'));start=time.perf_counter();bpy.ops.render.render(write_still=True);elapsed=(time.perf_counter()-start)*1000;renders+=1
 im=bpy.data.images.load(scene.render.filepath,check_existing=False);im.use_half_precision=False;raw=np.empty(256,np.float32);im.pixels.foreach_get(raw);bpy.data.images.remove(im);raw=raw.reshape(8,8,4);assert np.isfinite(raw).all();assert np.array_equal(raw[:,:,3].view(np.uint32),np.ones((8,8),np.float32).view(np.uint32));path=OUT/(name+'.rgba32f');path.write_bytes(raw.astype('<f4').tobytes());rows.append({'id':name,'rawFile':path.name,'rawSha256':sha(path),'exrFile':name+'.exr','exrSha256':sha(OUT/(name+'.exr')),'milliseconds':elapsed});return raw

def decode(a,b):
 for raw in[a,b]:
  digits=raw[:,:,:3]*2048;assert np.array_equal(digits,np.floor(digits))and(digits>=0).all()and(digits<2048).all(),'Native film did not preserve exact 11-bit digit grid'
 da=a[:,:,:3].astype(np.float64)*2048;db=b[:,:,:3].astype(np.float64)*2048
 return(da[:,:,0]/2**10+da[:,:,1]/2**21+da[:,:,2]/2**32+db[:,:,0]/2**43+db[:,:,1]/2**54+db[:,:,2]/2**65).astype(np.float32)
# Both controls close before any kernel render. Never choose row orientation from node outputs.
m,t,e=material('Independent coordinate calibration');parts=split(t,input_node(t,source));coord=render('input-affine',e,t,combine(t,[math(t,'ADD',math(t,'MULTIPLY',v,.25),.5)for v in parts]));assert np.array_equal(((coord[:,:,:3]-.5)*4).view(np.uint32),p[:,:,:3].view(np.uint32)),'Native nearest input coordinates did not match exact bottom-row-first F32 grid'
m,t,e=material('Independent two-plane film carrier calibration');value=split(t,input_node(t,calibration))[0];a=render('carrier-known-plane0',e,t,carrier(t,value,0));b=render('carrier-known-plane1',e,t,carrier(t,value,1));known=decode(a,b);assert np.array_equal(known.view(np.uint32),c[:,:,0].view(np.uint32)),'Native small/zero/ordinary carrier calibration failed'
# Three independent calibration frames plus four*(range guard+eight planes).
case_rows=[]
for case in CONTRACT['eeveeCrosscheckCases']:
 m,t,e=material('Actual native '+case);n,out,s=configure(t,case);t.links.new(input_node(t,source),n.inputs['Vector']);signals=split(t,n.outputs['Color'])+[n.outputs[out]];t.links.new(n.outputs['Color'],e.inputs['Color']);scene_path=OUT/(case+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(scene_path));saved=sha(scene_path);node_signature=repr(s);original=set(t.nodes)
 valid=[]
 for v in signals:
  zero=math(t,'COMPARE',v,0,0);minimum=math(t,'MAXIMUM',math(t,'GREATER_THAN',v,2**-42),math(t,'COMPARE',v,2**-42,0));low=math(t,'MAXIMUM',zero,minimum);safe=math(t,'MULTIPLY',low,math(t,'LESS_THAN',v,2));valid.append(math(t,'SUBTRACT',1,safe))
 unsafe=valid[0]
 for v in valid[1:]:unsafe=math(t,'MAXIMUM',unsafe,v)
 guard=render(case+'-range',e,t,combine(t,[unsafe,unsafe,unsafe]));assert not np.any(guard[:,:,:3]),'Native scalar outside predeclared nonnegative carrier domain'
 captured=[]
 for lane,value in enumerate(signals):
  a=render(case+'-'+str(lane)+'-plane0',e,t,carrier(t,value,0));b=render(case+'-'+str(lane)+'-plane1',e,t,carrier(t,value,1));captured.append(decode(a,b))
 decoded=np.stack(captured,axis=2);file=OUT/(case+'.kernel-rgba32f');file.write_bytes(decoded.astype('<f4').tobytes());assert np.isfinite(decoded).all()and((decoded==0)|(decoded>=2**-42)).all()and(decoded<2).all()
 for node in list(t.nodes):
  if node not in original:t.nodes.remove(node)
 assert sha(scene_path)==saved and repr(s)==node_signature
 case_rows.append({'case':case,'sourceFile':scene_path.name,'sourceSha256':saved,'rawFile':file.name,'rawSha256':sha(file),'zeroWords':int(np.count_nonzero(decoded==0)),'source':s})
for im,pixels in images:
 raw=np.empty(256,np.float32);im.pixels.foreach_get(raw);assert np.array_equal(raw.view(np.uint32),pixels.ravel().view(np.uint32))
assert renders==CONTRACT['capture']['maximumRenders']==12
backend={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get()};assert backend['backend']=='METAL'
report={'schemaVersion':1,'status':'CAPTURED_NATIVE_EEVEE_KERNEL_REFERENCE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'backend':backend,'engine':scene.render.engine,'extent':[8,8],'samples':1,'filmAlpha':1,'view':'Raw','look':'None','exposure':0,'gamma':1,'renders':renders,'coordinateControl':'EXACT_WORDS_BEFORE_KERNELS','carrierCalibration':'EXACT_WORDS_BEFORE_KERNELS','carrierKnownWords':control_values.view(np.uint32).tolist(),'inputFile':'input.rgba32f','inputSha256':sha(OUT/'input.rgba32f'),'cases':case_rows,'captures':rows,'sourcePins':{str(p.relative_to(ROOT)):sha(p)for p in[Path(__file__),Path(__file__).with_name('contract.json')]},'supportCredit':0,'FinalCredit':0,'nativeCpuParityCredit':0,'zeroSignObservable':False,'scope':'Actual EEVEE scalar values carried through independently calibrated HALF-safe digit planes; original film alpha is not the kernel fourth lane.'}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_NATIVE_EEVEE_KERNEL_REFERENCE',renders)
