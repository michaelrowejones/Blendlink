# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual EEVEE -> calibrated raw intervals -> unchanged source Final recipes."""
import bpy,hashlib,json,os,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blender-addon'));sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import tsl_ir,squeeze_ir
output=Path(os.environ['BLENDLINK_SQUEEZE_REFERENCES']).resolve();output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;engines={p.identifier for p in scene.render.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=1
scene.render.resolution_x=scene.render.resolution_y=32;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.world=None
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
bpy.ops.mesh.primitive_plane_add(size=2);owner=bpy.context.object;owner.name='Actual Squeeze Owner';owner['blendlink_id']='squeeze-owner'
camera_data=bpy.data.cameras.new('Source Camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new('Source Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
try:
 version=squeeze_ir.source_profile(lambda message:(_ for _ in ()).throw(ValueError(message)))
except ValueError as error:
 assert any(text in str(error) for text in ['source attestation is N/A','has no verified live source profile','requires actual native GPU backend attestation','has no verified live source precision profile for actual GPU backend']),error
 (output/'not-applicable.json').write_text(json.dumps({'status':'SOURCE_ATTESTATION_NA','version':list(bpy.app.version),'productionCases':0,'reason':str(error),'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'nativeResearchRetained':'native_probe.py supports the actual native function independently'}));print('BLENDLINK_SQUEEZE_SOURCE_ATTESTATION_NA');sys.exit(0)
(output/'not-applicable.json').unlink(missing_ok=True)
import gpu
backend={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get()}
index=np.arange(1024).reshape(32,32);pixels=np.ones((32,32,4),np.float32)
pixels[:,:,0]=((index*73)%1024)/np.float32(64)-np.float32(8)
pixels[:,:,1]=((index*109)%1024)/np.float32(256)-np.float32(2)
pixels[:,:,2]=((index*193)%1024)/np.float32(1024)-np.float32(.5)
source=bpy.data.images.new('Packed exact Squeeze data',width=32,height=32,alpha=True,float_buffer=True);source.colorspace_settings.name='Non-Color';source.pixels.foreach_set(pixels.ravel());source.update()
source.save_render(str(output/'source.exr'),scene=scene)
bpy.data.images.remove(source);source=bpy.data.images.load(str(output/'source.exr'),check_existing=False);source.colorspace_settings.name='Non-Color';source.alpha_mode='STRAIGHT';source.use_half_precision=False
assert np.array_equal(np.asarray(source.pixels[:],np.float32),pixels.ravel()),'Native source EXR changed the exact image input'
source.pack();source_image_hash=hashlib.sha256(pixels.astype('<f4').tobytes()).hexdigest()

def state(tree):
 def value(s):
  v=getattr(s,'default_value',None)
  return v if v is None or isinstance(v,(str,bool,float,int)) else tuple(v)
 return repr([(n.bl_idname,n.name,[(s.identifier,value(s)) for s in n.inputs],[(s.identifier,value(s)) for s in n.outputs]) for n in tree.nodes])+repr(sorted((l.from_node.name,l.to_node.name,l.from_socket.identifier,l.to_socket.identifier) for l in tree.links))

def math_input(tree,operation,field,b):
 n=tree.nodes.new('ShaderNodeMath');n.operation=operation;tree.links.new(field,n.inputs[0]);n.inputs[1].default_value=b;return n.outputs[0]

def packed(tree,field):
 result=tree.nodes.new('ShaderNodeCombineXYZ')
 for channel,multiplier in enumerate([1,256,65536]):
  item=field if multiplier==1 else math_input(tree,'MULTIPLY',field,multiplier)
  if channel:item=math_input(tree,'FRACT',item,0)
  item=math_input(tree,'DIVIDE',math_input(tree,'FLOOR',math_input(tree,'MULTIPLY',item,256),0),256)
  tree.links.new(item,result.inputs[channel])
 return result.outputs[0]

def image_fields(tree,extension='REPEAT',constant=False,coordinates=(-2.25,1.75,0)):
 n=tree.nodes.new('ShaderNodeTexImage');n.image=source;n.interpolation='Closest';n.extension=extension
 if constant:
  vector=tree.nodes.new('ShaderNodeCombineXYZ');
  for socket,value in zip(vector.inputs,coordinates):socket.default_value=value
  tree.links.new(vector.outputs[0],n.inputs['Vector'])
 separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(n.outputs['Color'],separate.inputs[0]);return list(separate.outputs)

def node_value(tree,value=0,width=1,center=0):
 n=tree.nodes.new('ShaderNodeSqueeze')
 for socket,item in zip(n.inputs,[value,width,center]):
  if isinstance(item,(int,float)):socket.default_value=item
  else:tree.links.new(item,socket)
 return n.outputs[0]

rows=[]
refusals=[]
cases=['calibration','default','positive','negative','reversed','zero-width','image-value','image-all','group','cascade','instances','constant-coordinates','extend','clip','negative-integer','roughness-only','roughness-image']
cases += ['stress-d'+str(depth)+'-'+side for depth in range(2,9) for side in ['below','equal','above']]
for name in cases:
 source.colorspace_settings.name='Non-Color'
 material=bpy.data.materials.new('Artist Squeeze '+name);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
 sink=tree.nodes.new('ShaderNodeOutputMaterial');root=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(root.outputs[0],sink.inputs['Surface'])
 fields=image_fields(tree,extension='EXTEND' if name=='extend' else 'CLIP' if name=='clip' else 'REPEAT',constant=name!='calibration',coordinates=(-2,-1,0) if name=='negative-integer' else (-2.25,1.75,0) if name in {'constant-coordinates','extend','clip'} else (.25,.75,0))
 if name.startswith('stress-'):
  depth=int(name.split('-')[1][1:]);side=name.split('-')[2]
  field=float(np.nextafter(np.float32(.5),np.float32(-np.inf if side=='below' else np.inf))) if side!='equal' else .5
  for _ in range(depth):field=node_value(tree,field,16,.5)
 elif name=='calibration':field=math_input(tree,'MULTIPLY',math_input(tree,'ADD',fields[0],8),1/16)
 elif name in {'roughness-only','roughness-image'}:
  root.inputs['Base Color'].default_value=(.125,.25,.5,1);root.inputs['Metallic'].default_value=.25
  field=node_value(tree,fields[0] if name=='roughness-image' else 1)
 elif name in {'default','positive','negative','reversed','zero-width'}:
  field=node_value(tree,{'positive':1,'negative':-1,'reversed':1}.get(name,0),-1 if name=='reversed' else 0 if name=='zero-width' else 1)
 elif name=='image-all':field=node_value(tree,*fields)
 elif name=='cascade':field=node_value(tree,node_value(tree,fields[0]),-.5,.25)
 elif name=='instances':
  combine=tree.nodes.new('ShaderNodeCombineXYZ')
  for socket,controls in zip(combine.inputs,[(fields[0],1,0),(fields[0],-1,0),(.25,4,.25)]):tree.links.new(node_value(tree,*controls),socket)
  field=combine.outputs[0]
 elif name=='group':
  group=bpy.data.node_groups.new('Native Squeeze Group','ShaderNodeTree');group.interface.new_socket(name='Value',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat')
  incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput');group.links.new(node_value(group,incoming.outputs[0]),outgoing.inputs[0])
  instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;tree.links.new(fields[0],instance.inputs[0]);field=instance.outputs[0]
 else:field=node_value(tree,fields[0])
 channel_name='Roughness' if name.startswith('roughness-') else 'Base Color'
 tree.links.new(field,root.inputs[channel_name])
 owner.data.materials.clear();owner.data.materials.append(material)
 started=time.perf_counter();document=None;refusal=None
 try:document=tsl_ir.emit_channel(root.inputs[channel_name],evaluation_engine='EEVEE')
 except tsl_ir.TslIrRefusal as error:
  assert name.startswith('stress-') and depth>=5,str(error)
  assert 'bounded validation work' in str(error),error
  refusal=str(error)
 emission_ms=(time.perf_counter()-started)*1000
 timings=[]
 if name=='image-all':
  for _ in range(20):
   started=time.perf_counter();assert squeeze_ir.valid_expression(document['output'],version);timings.append((time.perf_counter()-started)*1000)
 if name!='calibration' and document is not None:assert 'squeeze_native' in json.dumps(document),name
 stable=state(tree);source_path=output/(name+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source_path));source_hash=hashlib.sha256(source_path.read_bytes()).hexdigest()
 before_nodes=set(tree.nodes);oracle_files=[]
 components=3 if name=='instances' else 1
 separate=tree.nodes.new('ShaderNodeSeparateXYZ') if components==3 else None
 if separate:tree.links.new(field,separate.inputs[0])
 try:
  for channel in range(components):
   oracle_field=separate.outputs[channel] if separate else field
   emit=tree.nodes.new('ShaderNodeEmission');tree.links.new(packed(tree,oracle_field),emit.inputs['Color']);tree.links.new(emit.outputs[0],sink.inputs['Surface'])
   scene.render.filepath=str(output/(name+'-'+str(channel)+'.exr'));bpy.ops.render.render(write_still=True)
   result=bpy.data.images.load(scene.render.filepath,check_existing=False);data=np.asarray(result.pixels[:],np.float32).reshape(32,32,4);bpy.data.images.remove(result)
   assert np.isfinite(data).all() and np.all(data[:,:,:3]*256==np.floor(data[:,:,:3]*256)),name
   path=output/(name+'-'+str(channel)+'.rgba32f');data.astype('<f4').tofile(path);oracle_files.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
  if name=='calibration':
   decoded=data[:,:,0].astype(np.float64)+data[:,:,1].astype(np.float64)/256+data[:,:,2].astype(np.float64)/65536
   assert np.array_equal(decoded,(pixels[:,:,0].astype(np.float64)+8)/16),'Native carrier calibration failed'
 finally:
  tree.links.new(root.outputs[0],sink.inputs['Surface'])
  for n in list(tree.nodes):
   if n not in before_nodes:tree.nodes.remove(n)
 assert stable==state(tree) and source_hash==hashlib.sha256(source_path.read_bytes()).hexdigest(),'Oracle changed source graph or saved bytes'
 assert np.array_equal(np.asarray(source.pixels[:],np.float32),pixels.ravel())
 if document is None:
  refusals.append({'id':name,'file':source_path.name,'sourceSha256':source_hash,'reason':refusal,'native':oracle_files,'sourcePreserved':True})
  continue
 ir_path=output/(name+'.ir.json');ir_path.write_text(json.dumps(document,indent=2))
 rows.append({'id':name,'channel':channel_name,'file':source_path.name,'sourceSha256':source_hash,'material':material.name,'ir':name+'.ir.json','irSha256':hashlib.sha256(ir_path.read_bytes()).hexdigest(),'native':oracle_files,'components':components,'sourceColorSpace':source.colorspace_settings.name,'warmEmissionMilliseconds':emission_ms,**({'sourceBoundCheckMilliseconds':{'minimum':min(timings),'maximum':max(timings),'median':float(np.median(timings)),'iterations':20,'imagePixels':1024,'pixelValuesPerValidation':12288}} if timings else {})})
report={'version':list(version),'build':bpy.app.build_hash.decode(),'engine':scene.render.engine,'backend':backend,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'pythonHashes':{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [ROOT/'packages/blender-addon/squeeze_ir.py',ROOT/'packages/blender-addon/tsl_ir.py',ROOT/'packages/blender-addon/shader_domains.py',ROOT/'packages/blender-addon/engine_fallback.py']},'imagePixelsSha256':source_image_hash,'width':32,'height':32,'interval':2**-24,'kernelBudget':2e-5,'sourcePreserved':True,'cases':rows,'refusedNativeCases':refusals}
(output/'references.json').write_text(json.dumps(report,indent=2));print('BLENDLINK_SQUEEZE_REFERENCES_PASSED',len(rows))
