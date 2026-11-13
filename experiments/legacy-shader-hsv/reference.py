# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual EEVEE4.2 legacy/modern HSV equivalence and independently calibrated pixels."""
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import tempfile
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
NATIVE=Path(os.environ.get('BLENDLINK_HSV_NATIVE_MODULES',ROOT/'packages/blender-addon'))
sys.path.insert(0,str(NATIVE));sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import bakelib
import tsl_ir
assert bpy.app.version==(4,2,0),'Legacy shader HSV classes are absent in modern Blender; no alias is manufactured'
OUTPUT=Path(os.environ['BLENDLINK_HSV_REFERENCES']).resolve();OUTPUT.mkdir(parents=True,exist_ok=True);(OUTPUT/'ir').mkdir(exist_ok=True)
SIZE=64
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=1
proxy=bakelib.uv_tile_proxy([],window=(0,0,1,1))
camera_data=bpy.data.cameras.new('HSV oracle camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
scene.world=None;scene.render.resolution_x=scene.render.resolution_y=SIZE;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.film_transparent=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'

def image_source(tree,values,label):
 image=bpy.data.images.new(label,width=SIZE,height=SIZE,float_buffer=True,alpha=True);image.colorspace_settings.name='Non-Color';image.use_half_precision=False
 image.pixels.foreach_set(values.ravel());image.update()
 node=tree.nodes.new('ShaderNodeTexImage');node.image=image;node.interpolation='Closest'
 coords=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coords.outputs['UV'],node.inputs['Vector'])
 return node.outputs['Color']

def field(case):
 values=np.ones((SIZE*SIZE,4),np.float32);index=np.arange(SIZE*SIZE)
 for channel,multiplier in enumerate([1,613,1019]):values[:,channel]=((index*multiplier)%4096)/np.float32(4096)
 if case['stage']=='extended':
  if case.get('direction')=='combine':values[:,:3]=values[:,:3]*np.float32(1.5)-np.float32(.25)
  else:
   values[:,:3]=values[:,:3]*np.float32(1.5)-np.float32(.5)
   # Preserve signed channels/HDR while keeping max away from the saturation pole.
   values[:,0]=values[:,0]+np.float32(1)
 return values.reshape(SIZE,SIZE,4)

def fingerprint(material):
 def default(socket):
  if not hasattr(socket,'default_value'):return None
  value=socket.default_value
  if isinstance(value,(float,int,bool,str)):return value
  if isinstance(value,bpy.types.ID):return [value.bl_rna.identifier,value.name_full]
  return list(value)
 rows=[]
 for node in material.node_tree.nodes:
  row=[node.name,node.bl_idname,getattr(node,'mode',None),[[s.identifier,default(s)]for s in node.inputs],[[s.identifier,default(s)]for s in node.outputs]]
  if node.bl_idname=='ShaderNodeTexImage':
   image=node.image
   row.append([node.interpolation,node.extension,image.name_full,image.colorspace_settings.name,image.colorspace_settings.is_data,image.use_half_precision,image.alpha_mode,list(image.size),image.users,hashlib.sha256(np.asarray(image.pixels[:],dtype='<f4').tobytes()).hexdigest()])
  rows.append(row)
 return json.dumps([rows,sorted((l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier)for l in material.node_tree.links)],sort_keys=True)

def material_for(case):
 material=bpy.data.materials.new('Actual legacy HSV '+case['id']);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
 sink=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],sink.inputs['Surface'])
 if case['kind']=='constant':emission.inputs['Color'].default_value=(*case['value'],1);return material,emission,None,None,None
 if case['stage'] in {'unit','extended'}:incoming=image_source(tree,field(case),'Exact legacy HSV inputs')
 elif case['stage']=='uv':
  coords=tree.nodes.new('ShaderNodeTexCoord');incoming=coords.outputs['UV']
 else:
  source=tree.nodes.new('ShaderNodeRGB');source.outputs[0].default_value=(*case.get('value',[.8,.8,.8]),case.get('alpha',1));incoming=source.outputs[0]
 if case['kind']=='control':tree.links.new(incoming,emission.inputs['Color']);return material,emission,None,None,None
 direction=case['direction'];legacy=tree.nodes.new('ShaderNodeCombineHSV'if direction=='combine'else'ShaderNodeSeparateHSV')
 modern=tree.nodes.new('ShaderNodeCombineColor'if direction=='combine'else'ShaderNodeSeparateColor');modern.mode='HSV'
 for conversion in [legacy,modern]:
  if case['stage']!='default':
   if direction=='combine':
    components=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(incoming,components.inputs[0])
    for index in range(3):tree.links.new(components.outputs[index],conversion.inputs[index])
   else:tree.links.new(incoming,conversion.inputs[0])
 def result(conversion):
  if direction=='combine':return conversion.outputs[0]
  if 'channel'in case:return conversion.outputs[case['channel']]
  packed=tree.nodes.new('ShaderNodeCombineXYZ')
  for index in range(3):tree.links.new(conversion.outputs[index],packed.inputs[index])
  return packed.outputs[0]
 old_result=result(legacy);new_result=result(modern)
 affine=tree.nodes.new('ShaderNodeVectorMath');affine.operation='MULTIPLY_ADD';affine.inputs[1].default_value=(.125,)*3;affine.inputs[2].default_value=(.25,)*3
 tree.links.new(old_result,affine.inputs[0]);tree.links.new(affine.outputs[0],emission.inputs['Color'])
 return material,emission,affine,old_result,new_result

def pixels(material,path):
 proxy.data.materials.clear();proxy.data.materials.append(material);scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(str(path),check_existing=False);image.alpha_mode='PREMUL'
 raw=np.asarray(image.pixels[:],np.float32).reshape(SIZE,SIZE,4)[...,:3].copy();bpy.data.images.remove(image)
 assert np.isfinite(raw).all()
 return raw

combine_values=[[0,0,0],[.2,.5,.7],[.6,1,1],[1,1,.5],[-.2,.7,.8],[1.2,.7,.8],[2,.4,1.2],[.2,-.4,.7],[.2,1.4,.7],[.2,.5,-.5],[.2,.5,1.4],[.9,3,.5]]
separate_values=[[0,0,0],[.5,.5,.5],[1,1,1],[.9,.3,.2],[.3,.9,.2],[.3,.2,.9],[-.2,-.5,-.9],[1.4,.3,.8],[.2,.7,1.5],[2,1,3],[0,-.5,-1],[1.0002,.9997,1.0001],[.25,.375,.5]]
cases=[{'id':'constant-linear','kind':'constant','value':[.25,.5,.75]},
 {'id':'carrier-rgb-grid','kind':'control','stage':'unit','targetAbsoluteBound':2**-10},
 {'id':'uv-gradient','kind':'control','stage':'uv'},
 {'id':'signed-input-control','kind':'control','stage':'extended','direction':'separate'}]
for direction,values in [('combine',combine_values),('separate',separate_values)]:
 for index,value in enumerate(values):cases.append({'id':f'legacy-hsv-{direction}-constant-{index}','kind':'conversion','direction':direction,'stage':'constant','value':value})
 for stage in ['default','unit','extended','uv']:cases.append({'id':f'legacy-hsv-{direction}-{stage}','kind':'conversion','direction':direction,'stage':stage})
for stage in ['constant','unit','extended']:
 for channel in range(3):cases.append({'id':f'legacy-hsv-separate-{stage}-channel-{channel}','kind':'conversion','direction':'separate','stage':stage,'channel':channel,'value':[.25,.375,.5]})
for alpha in [0,.25,.75,1]:cases.append({'id':f'legacy-hsv-alpha-{alpha}','kind':'conversion','direction':'separate','stage':'constant','value':[.2,.4,.7],'alpha':alpha})
records=[];baselines=[]
with tempfile.TemporaryDirectory(prefix='blendlink-legacy-hsv-')as temporary:
 for case in cases:
  material,emission,affine,old_result,new_result=material_for(case);before=fingerprint(material)
  with tsl_ir.emission_context(evaluation_engine='EEVEE'):document=tsl_ir.emit_channel(emission.inputs['Color'])
  assert before==fingerprint(material),case['id']
  payload=json.dumps(document).encode();(OUTPUT/'ir'/(case['id']+'.json')).write_bytes(payload)
  baseline=pixels(material,Path(temporary)/'baseline.exr')
  if case['kind']=='conversion':
   tree=material.node_tree;tree.links.new(new_result,affine.inputs[0]);modern=pixels(material,Path(temporary)/'modern.exr')
   assert np.array_equal(baseline,modern),'Legacy/modern native helpers differ: '+case['id']
   tree.links.new(old_result,affine.inputs[0]);assert before==fingerprint(material)
  baseline_name=case['id']+'-baseline.f32';baseline.astype('<f4').tofile(OUTPUT/baseline_name)
  record={**case,'engine':scene.render.engine,'legacyModernBitIdentical':case['kind']=='conversion'}
  if case['kind']=='conversion':
   legacy=next(node for node in material.node_tree.nodes if node.bl_idname in {'ShaderNodeCombineHSV','ShaderNodeSeparateHSV'})
   modern=next(node for node in material.node_tree.nodes if node.bl_idname in {'ShaderNodeCombineColor','ShaderNodeSeparateColor'})
   def conversions(value):
    if isinstance(value,dict):
     if value.get('op')=='color_convert':yield value
     for key,child in value.items():
      if value.get('op')!='tex_image'or key!='pixels':yield from conversions(child)
    elif isinstance(value,list):
     for child in value:yield from conversions(child)
   emitted=list(conversions(document))
   assert emitted and all(item['mode']=='HSV'and item['model']=='eevee-gpu'and item['sourceEngine']=='EEVEE'and item['direction']==case['direction']for item in emitted),case['id']
   record['sourceAdapter']={'actualLegacyClass':legacy.bl_idname,'legacyInputs':[socket.identifier for socket in legacy.inputs],
    'legacyOutputs':[socket.identifier for socket in legacy.outputs],'actualModernClass':modern.bl_idname,'modernMode':modern.mode,
    'emittedOp':emitted[0]['op'],'emittedModel':emitted[0]['model'],'sourceEvaluationEngine':emitted[0]['sourceEngine'],'sourceFingerprint':hashlib.sha256(before.encode()).hexdigest()}
  if affine is not None:
   assert baseline.min()>=0 and baseline.max()<1,(case['id'],baseline.min(),baseline.max())
   assert np.array_equal(baseline,baseline.astype(np.float16).astype(np.float32))
   tree=material.node_tree;values=np.ones((SIZE,SIZE,4),np.float32);values[...,:3]=baseline
   texture=image_source(tree,values,'Native HSV residual baseline')
   subtract=tree.nodes.new('ShaderNodeVectorMath');subtract.operation='SUBTRACT';tree.links.new(affine.outputs[0],subtract.inputs[0]);tree.links.new(texture,subtract.inputs[1])
   carrier=tree.nodes.new('ShaderNodeVectorMath');carrier.operation='MULTIPLY_ADD';carrier.inputs[1].default_value=(1024,)*3;carrier.inputs[2].default_value=(.5,)*3
   tree.links.new(subtract.outputs[0],carrier.inputs[0]);tree.links.new(carrier.outputs[0],emission.inputs['Color'])
   residual=pixels(material,Path(temporary)/'residual.exr')
   assert residual.min()>=0 and residual.max()<=1,(case['id'],residual.min(),residual.max())
   raw=baseline+(residual-np.float32(.5))/np.float32(1024)
   record.update(outputAffineScale=.125,outputAffineBias=.25,nativeResidualReconstruction={
    'baselineFile':baseline_name,'baselineSha256':hashlib.sha256((OUTPUT/baseline_name).read_bytes()).hexdigest(),
    'originalIrSha256':hashlib.sha256(payload).hexdigest(),'amplification':1024,'targetCalibration':'carrier-rgb-grid','quantizationBound':2**-10/1024+2**-22})
   baselines.append({'id':case['id'],'legacyModernBitIdentical':True,'sourceFingerprint':hashlib.sha256(before.encode()).hexdigest()})
  else:raw=baseline;record['renderHalf']=True
  raw.astype('<f4').tofile(OUTPUT/(case['id']+'.f32'));records.append(record)
  bpy.data.materials.remove(material,do_unlink=True)
  for image in list(bpy.data.images):
   if image.name.startswith(('Exact legacy HSV','Native HSV residual'))and not image.users:bpy.data.images.remove(image)
(OUTPUT/'index.json').write_text(json.dumps({'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),'gpuBackend':bpy.context.preferences.system.gpu_backend,
 'platform':sys.platform,'arch':platform.machine(),'size':SIZE,'cases':records,'baselines':baselines,
 'nativeModuleHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in NATIVE.iterdir()if p.suffix in{'.py','.json'}}},indent=2))
print('BLENDLINK_LEGACY_HSV_REFERENCES_PASSED '+str(len(records)))
