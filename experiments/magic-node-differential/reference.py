# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual EEVEE Magic nodes, with independent input and native residual controls."""
import hashlib
import json
import os
import platform
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
native=os.environ.get('BLENDLINK_MAGIC_NATIVE_MODULES')
sys.path.insert(0,native or str(ROOT/'packages/blender-addon'))
sys.path.insert(0,native or str(ROOT/'packages/blendlink/blender'))
import bakelib
import tsl_ir
import magic_bounds
OUTPUT=Path(os.environ['BLENDLINK_MAGIC_REFERENCES']).resolve();OUTPUT.mkdir(parents=True,exist_ok=True);(OUTPUT/'ir').mkdir(exist_ok=True)
SIZE=64
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.cycles.device='CPU';scene.cycles.samples=1
import _cycles
_cycles.set_device_override('CPU');bakelib._CYCLES_GPU_BACKENDS=()
proxy=bakelib.uv_tile_proxy([],window=(0,0,1,1))
data=bpy.data.cameras.new('Magic Native Camera');data.type='ORTHO';data.ortho_scale=2
camera=bpy.data.objects.new(data.name,data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
scene.world=None;scene.render.resolution_x=scene.render.resolution_y=SIZE;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
engines={x.identifier for x in scene.render.bl_rna.properties['engine'].enum_items};scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
if hasattr(getattr(scene,'eevee',None),'taa_render_samples'):scene.eevee.taa_render_samples=1


def pixels(material,path):
 proxy.data.materials.clear();proxy.data.materials.append(material)
 scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(str(path),check_existing=False);image.alpha_mode='PREMUL'
 result=np.asarray(image.pixels[:],np.float32).reshape(SIZE,SIZE,4)[...,:3].copy();bpy.data.images.remove(image)
 assert np.isfinite(result).all()
 return result


def source_state(material):
 def default(socket):
  if not hasattr(socket,'default_value'):return None
  value=socket.default_value
  if isinstance(value,(str,int,float,bool)) or value is None:return value
  if isinstance(value,bpy.types.ID):return [value.bl_rna.identifier,value.name_full]
  return list(value)
 nodes=[]
 for node in material.node_tree.nodes:
  properties={name:getattr(node,name) for name in ['operation','turbulence_depth','interpolation','extension','clamp_type'] if hasattr(node,name)}
  if node.bl_idname=='ShaderNodeTexImage':
   image=node.image;properties['image']=[image.name_full,image.colorspace_settings.name,image.colorspace_settings.is_data,image.alpha_mode,image.use_half_precision,list(image.size),hashlib.sha256(np.asarray(image.pixels[:],dtype='<f4').tobytes()).hexdigest()]
  nodes.append([node.name,node.bl_idname,properties,[[socket.identifier,default(socket)] for socket in node.inputs],[[socket.identifier,default(socket)] for socket in node.outputs]])
 return json.dumps([nodes,[(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in material.node_tree.links]],sort_keys=True)


def material_for(case):
 material=bpy.data.materials.new('Actual Magic '+case['id']);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
 output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],output.inputs['Surface'])
 if case['kind']=='constant':emission.inputs['Color'].default_value=(*case['value'],1);return material,emission,None
 coordinates=tree.nodes.new('ShaderNodeTexCoord')
 if case['kind']=='uv-gradient':tree.links.new(coordinates.outputs['UV'],emission.inputs['Color']);return material,emission,None
 if case['stage']=='constant':
  source=tree.nodes.new('ShaderNodeCombineXYZ')
  for i,v in enumerate(case.get('coordinate',[.173,-.375,.625])):source.inputs[i].default_value=v
  incoming=source.outputs[0]
 elif case['stage'] in {'image','carrier','shader-constant'}:
  image=bpy.data.images.new('Exact Magic coordinates',width=SIZE,height=SIZE,float_buffer=True,alpha=True);image.colorspace_settings.name='Non-Color'
  if hasattr(image,'use_half_precision'):image.use_half_precision=False
  values=np.ones((SIZE*SIZE,4),np.float32);index=np.arange(SIZE*SIZE)
  for channel,multiplier in enumerate([1,613,1019]):
   values[:,channel]=((index*multiplier)%4096)/np.float32(4096) if case['stage']=='carrier' else ((index*multiplier)%2048)/np.float32(1024)-.5 if case['stage']=='image' else 0
  image.pixels.foreach_set(values.ravel());image.update()
  source=tree.nodes.new('ShaderNodeTexImage');source.image=image;source.interpolation='Closest';tree.links.new(coordinates.outputs['UV'],source.inputs['Vector']);incoming=source.outputs['Color']
  if case['stage']=='shader-constant':
   add=tree.nodes.new('ShaderNodeVectorMath');add.operation='ADD';tree.links.new(incoming,add.inputs[0]);add.inputs[1].default_value=case['coordinate'];incoming=add.outputs[0]
 else:incoming=coordinates.outputs['Generated' if case['stage']=='generated' else 'UV']
 if case['kind']=='input-control':tree.links.new(incoming,emission.inputs['Color']);return material,emission,None
 magic=tree.nodes.new('ShaderNodeTexMagic');magic.turbulence_depth=case['depth'];magic.inputs['Scale'].default_value=case.get('scale',5);magic.inputs['Distortion'].default_value=case.get('distortion',1)
 assert magic.turbulence_depth==case['depth']
 assert magic.inputs['Scale'].default_value==float(np.float32(case.get('scale',5)))
 assert magic.inputs['Distortion'].default_value==float(np.float32(case.get('distortion',1)))
 if case['stage']!='default':tree.links.new(incoming,magic.inputs['Vector'])
 for key,axis,limits in [('scale',0,(-8,8)),('distortion',1,(.25,1))]:
  if case.get('linked-'+key):
   separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(incoming,separate.inputs[0])
   if key=='distortion' and case.get('negative-linked-distortion'):limits=(-.5,-.25)
   clamp=tree.nodes.new('ShaderNodeClamp');clamp.clamp_type='MINMAX';clamp.inputs['Min'].default_value=limits[0];clamp.inputs['Max'].default_value=limits[1]
   control=separate.outputs[axis]
   if key=='distortion' and case.get('negative-linked-distortion'):
    subtract=tree.nodes.new('ShaderNodeMath');subtract.operation='SUBTRACT';subtract.inputs[1].default_value=.75;tree.links.new(control,subtract.inputs[0]);control=subtract.outputs[0]
   tree.links.new(control,clamp.inputs['Value']);tree.links.new(clamp.outputs[0],magic.inputs[key.capitalize()])
 socket=next(s for s in magic.outputs if s.identifier==('Fac' if case['output']=='fac' else 'Color'))
 affine=tree.nodes.new('ShaderNodeVectorMath');affine.operation='MULTIPLY_ADD';tree.links.new(socket,affine.inputs[0]);affine.inputs[1].default_value=(case.get('outputAffineScale',1),)*3;affine.inputs[2].default_value=(case.get('outputAffineBias',0),)*3
 tree.links.new(affine.outputs[0],emission.inputs['Color'])
 return material,emission,affine


cases=[{'id':'constant-linear','kind':'constant','value':[.25,.5,.75]},{'id':'uv-gradient','kind':'uv-gradient'}, {'id':'magic-image-input','kind':'input-control','stage':'image'},
       {'id':'carrier-rgb-grid','kind':'input-control','stage':'carrier','targetAbsoluteBound':2**-10,'tolerance':0}]
for stage in ['constant','image','generated']:
 for depth in range(11):
  for output in ['color','fac']:cases.append({'id':f'magic-{stage}-depth{depth}-{output}','kind':'magic','stage':stage,'depth':depth,'output':output})
for stage in ['default','uv']:
 for depth in [0,2,10]:
  for output in ['color','fac']:cases.append({'id':f'magic-{stage}-depth{depth}-{output}','kind':'magic','stage':stage,'depth':depth,'output':output})
for distortion in [-1,-.5,-.25,0,.25,.5]:
 for depth in [0,2,10]:
  for output in ['color','fac']:cases.append({'id':f'magic-image-d{distortion}-depth{depth}-{output}','kind':'magic','stage':'image','depth':depth,'output':output,'distortion':distortion})
for scale in [-8,0,.5,8]:
 for depth in [0,2,10]:
  for output in ['color','fac']:cases.append({'id':f'magic-image-s{scale}-depth{depth}-{output}','kind':'magic','stage':'image','depth':depth,'output':output,'scale':scale})
for distortion in [-.5,-.25,0,.25,.5]:
 for depth in [0,2,10]:
  for output in ['color','fac']:cases.append({'id':f'magic-constant-d{distortion}-depth{depth}-{output}','kind':'magic','stage':'constant','depth':depth,'output':output,'distortion':distortion})
for scale in [-8,0,.5,8]:
 for depth in [2,10]:
  for output in ['color','fac']:cases.append({'id':f'magic-constant-s{scale}-depth{depth}-{output}','kind':'magic','stage':'constant','depth':depth,'output':output,'scale':scale})
for depth in [0,2,10]:
 for output in ['color','fac']:cases.append({'id':f'magic-image-linked-depth{depth}-{output}','kind':'magic','stage':'image','depth':depth,'output':output,'linked-scale':True,'linked-distortion':True})
for depth in [0,2,10]:
 for output in ['color','fac']:cases.append({'id':f'magic-image-negative-linked-depth{depth}-{output}','kind':'magic','stage':'image','depth':depth,'output':output,'linked-scale':True,'linked-distortion':True,'negative-linked-distortion':True})
period=np.float32(2*np.pi)
for name,value in [('period-low',np.nextafter(period,np.float32(0))),('period',period),('period-high',np.nextafter(period,np.float32(np.inf))),('band-negative',np.float32(-32)),('band-positive',np.float32(32))]:
 for output in ['color','fac']:cases.append({'id':f'magic-seam-{name}-{output}','kind':'magic','stage':'shader-constant','depth':2,'output':output,'scale':1,'coordinate':[float(value),-.375,.625]})
if bpy.app.version>=(5,0,0):
 for output in ['color','fac']:cases.append({'id':f'magic-mf-limit-{output}','kind':'magic','stage':'constant','depth':10,'output':output,'scale':8,'coordinate':[16,-16,15.5]})
for case in cases:
 if case.get('depth')==0 or case.get('distortion')==0:case.update(outputAffineScale=.125,outputAffineBias=.5)
 if case.get('distortion')==-1:case['expectedRefusal']='Magic Texture nonzero Distortion must stay'
records=[];refusals=[];baselines=[]
with tempfile.TemporaryDirectory(prefix='blendlink-magic-native-') as temporary:
 for case in cases:
  material,emission,affine=material_for(case);proxy.data.materials.clear();proxy.data.materials.append(material)
  before=source_state(material)
  try:document=tsl_ir.emit_channel(emission.inputs['Color'])
  except tsl_ir.TslIrRefusal as error:
   if not case.get('expectedRefusal') or case['expectedRefusal'] not in str(error):raise
   assert before==source_state(material),case['id']
   filename=case['id']+'-refused.f32';raw=pixels(material,Path(temporary)/'refused.exr');payload=raw.astype('<f4').tobytes();(OUTPUT/filename).write_bytes(payload)
   refusals.append({**case,'reason':str(error),'nativePixels':filename,'nativePixelsSha256':hashlib.sha256(payload).hexdigest(),'sourceFingerprint':hashlib.sha256(before.encode()).hexdigest()})
   bpy.data.materials.remove(material,do_unlink=True)
   continue
  assert not case.get('expectedRefusal'),'Expected source refusal was silently admitted: '+case['id']
  expressions=[];magic_bounds.requirements(document,expressions)
  for expression in expressions:
   magic_bounds.validate_owner(proxy,expression)
   assert expression['evaluationModel']==('mf' if case['stage']=='constant' and bpy.app.version>=(5,0,0) else 'shader'),case['id']
  after=source_state(material)
  assert before==after,case['id']
  (OUTPUT/'ir'/(case['id']+'.json')).write_text(json.dumps(document));raw=pixels(material,Path(temporary)/'native.exr')
  raw.astype('<f4').tofile(OUTPUT/(case['id']+'.f32'))
  record={**case,'engine':scene.render.engine,'tolerance':case.get('tolerance',2e-5),'renderHalf':True}
  if affine is None:records.append(record)
  else:baselines.append(record)
  if affine is not None:
   # An independently measured native half baseline is subtracted from the
   # SAME native node before the render target, retaining its low residual.
   baseline=raw.copy()
   assert np.array_equal(baseline,baseline.astype(np.float16).astype(np.float32))
   # A smaller residual gain retains signed/HDR depth-zero results without
   # clipping the positive emission carrier. Its independent target bound is
   # unscaled back into raw Magic units, never added as a generic tolerance.
   amplification=1024
   tree=material.node_tree;image=bpy.data.images.new('Native Magic residual baseline',width=SIZE,height=SIZE,float_buffer=True,alpha=True);image.colorspace_settings.name='Non-Color'
   image.use_half_precision=False
   values=np.ones((SIZE,SIZE,4),np.float32);values[...,:3]=baseline;image.pixels.foreach_set(values.ravel());image.update()
   texture=tree.nodes.new('ShaderNodeTexImage');texture.image=image;texture.interpolation='Closest';coords=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coords.outputs['UV'],texture.inputs['Vector'])
   subtract=tree.nodes.new('ShaderNodeVectorMath');subtract.operation='SUBTRACT';tree.links.new(affine.outputs[0],subtract.inputs[0]);tree.links.new(texture.outputs['Color'],subtract.inputs[1])
   residual_carrier=tree.nodes.new('ShaderNodeVectorMath');residual_carrier.operation='MULTIPLY_ADD';tree.links.new(subtract.outputs[0],residual_carrier.inputs[0]);residual_carrier.inputs[1].default_value=(amplification,)*3;residual_carrier.inputs[2].default_value=(.5,)*3;tree.links.new(residual_carrier.outputs[0],emission.inputs['Color'])
   residual=pixels(material,Path(temporary)/'residual.exr')
   assert residual.min()>=0 and residual.max()<=1,case['id']
   assert np.array_equal(residual,residual.astype(np.float16).astype(np.float32)),case['id']
   reconstructed=baseline+(residual-np.float32(.5))/np.float32(amplification)
   identifier=case['id']+'-residual'
   # Reconstructed data is compared to the original actual IR after undoing
   # only that IR's authored affine output mapping, never copied Magic math.
   reconstructed.astype('<f4').tofile(OUTPUT/(identifier+'.f32'))
   (OUTPUT/'ir'/(identifier+'.json')).write_text(json.dumps(document))
   records.append({**case,'id':identifier,'engine':scene.render.engine,'tolerance':2e-5,'renderHalf':False,'nativeResidualReconstruction':{
       'amplification':amplification,'baselineFile':case['id']+'.f32','baselineSha256':hashlib.sha256(raw.astype('<f4').tobytes()).hexdigest(),
       'originalIrSha256':hashlib.sha256(json.dumps(document).encode()).hexdigest(),'sourceFingerprint':hashlib.sha256(before.encode()).hexdigest(),
       'targetCalibration':'carrier-rgb-grid','quantizationBound':2**-10/amplification+2**-22}})
  bpy.data.materials.remove(material,do_unlink=True)
  for image in list(bpy.data.images):
   if image.users==0 and image.name.startswith(('Exact Magic','Native Magic')):bpy.data.images.remove(image)
from compositor_gpu import native_gpu_profile
module_directory=Path(native) if native else Path(tsl_ir.__file__).parent
native_hashes={file.name:hashlib.sha256(file.read_bytes()).hexdigest() for file in module_directory.glob('*.py')}
sources=module_directory/'magic-native-sources.json'
(OUTPUT/'index.json').write_text(json.dumps({'size':SIZE,'cases':records,'baselines':baselines,'refusals':refusals,'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),'nativeVersion':list(bpy.app.version),'platform':sys.platform,'machine':platform.machine(),'nativeGpuProfile':native_gpu_profile(),'nativeModuleHashes':native_hashes,'pinnedSourceAuditSha256':hashlib.sha256(sources.read_bytes()).hexdigest() if sources.exists() else None,'sourcePreserved':True},indent=2))
print('BLENDLINK_MAGIC_REFERENCES_PASSED',len(records))
