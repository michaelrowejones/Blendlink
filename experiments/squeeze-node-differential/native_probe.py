# SPDX-License-Identifier: GPL-3.0-or-later
"""Research only: actual EEVEE viability of the legacy Squeeze GPU node."""
import bpy,hashlib,json,math,os
from pathlib import Path
import numpy as np

output=Path(os.environ['BLENDLINK_SQUEEZE_REFERENCES']).resolve();output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
engines={p.identifier for p in scene.render.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples=1
scene.render.resolution_x=scene.render.resolution_y=32;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.dither_intensity=0
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.world=None
bpy.ops.mesh.primitive_plane_add(size=2);owner=bpy.context.object
camera_data=bpy.data.cameras.new('Native Squeeze camera');camera_data.type='ORTHO';camera_data.ortho_scale=2
camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
material=bpy.data.materials.new('Native Squeeze');material.use_nodes=True;owner.data.materials.append(material)
tree=material.node_tree
pixels=np.ones((32,32,4),np.float32)
index=np.arange(1024).reshape(32,32)
pixels[:,:,0]=((index*73)%1024)/np.float32(64)-np.float32(8)
pixels[:,:,1]=((index*109)%1024)/np.float32(256)-np.float32(2)
pixels[:,:,2]=((index*193)%1024)/np.float32(1024)-np.float32(.5)
image=bpy.data.images.new('Exact native inputs',width=32,height=32,alpha=True,float_buffer=True)
image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(pixels.ravel());image.update()
packed=os.environ.get('BLENDLINK_SQUEEZE_PACKED')=='1'

def math_socket(operation, incoming, constant=None):
 node=tree.nodes.new('ShaderNodeMath');node.operation=operation;tree.links.new(incoming,node.inputs[0])
 if constant is not None:node.inputs[1].default_value=constant
 return node.outputs[0]

def packed_color(incoming):
 combine=tree.nodes.new('ShaderNodeCombineXYZ')
 for channel,multiplier in enumerate([1,256,65536]):
  value=incoming if multiplier==1 else math_socket('MULTIPLY',incoming,multiplier)
  if channel:value=math_socket('FRACT',value)
  digit=math_socket('DIVIDE',math_socket('FLOOR',math_socket('MULTIPLY',value,256)),256)
  tree.links.new(digit,combine.inputs[channel])
 return combine.outputs[0]

def state():
 def value(socket):
  item=getattr(socket,'default_value',None)
  if item is None or isinstance(item,(str,int,float,bool)):return item
  return tuple(item)
 return repr([(n.bl_idname,n.name,[(v.identifier,value(v)) for v in n.inputs],[(v.identifier,value(v)) for v in n.outputs]) for n in tree.nodes])+repr([(l.from_node.name,l.to_node.name,l.from_socket.identifier,l.to_socket.identifier) for l in tree.links])

image_snapshot=np.asarray(image.pixels[:],np.float32)
rows=[]
cases=[('default',0,1,0),('positive',1,1,0),('negative',-1,1,0),('zero-width',16,0,0),('reversed',1,-1,0),('center',.25,4,.25),('large-positive',100,100,-100),('large-negative',-100,100,100),('field',None,None,None)]
if packed:cases += [('near-center',.1250000149011612,100,.125),('tiny-width',1,2**-120,0),('calibration-0',None,None,None),('calibration-1',None,None,None),('calibration-2',None,None,None),('calibration-one',1,1,0)]
for name,value,width,center in cases:
 tree.nodes.clear();sink=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],sink.inputs['Surface'])
 node=tree.nodes.new('ShaderNodeSqueeze')
 actual=[]
 for socket,number in zip(node.inputs,[value,width,center]):
  if number is not None:socket.default_value=number
  actual.append(float(socket.default_value))
 if name=='field' or name.startswith('calibration-') and name!='calibration-one':
  source=tree.nodes.new('ShaderNodeTexImage');source.image=image;source.interpolation='Closest'
  coord=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coord.outputs['UV'],source.inputs['Vector'])
  separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(source.outputs['Color'],separate.inputs[0])
  for channel,socket in enumerate(node.inputs):tree.links.new(separate.outputs[channel],socket)
  values=pixels[:,:,0].astype(np.float64);widths=pixels[:,:,1].astype(np.float64);centers=pixels[:,:,2].astype(np.float64)
 else:values,widths,centers=actual
 incoming=node.outputs[0]
 if name.startswith('calibration-') and name!='calibration-one':
  digit=int(name.rsplit('-',1)[1])
  incoming=math_socket('FRACT',math_socket('MULTIPLY',math_socket('ADD',separate.outputs[0],8),1/4))
  if digit:incoming=math_socket('MULTIPLY',incoming,256**-digit)
  ideal=np.mod((pixels[:,:,0].astype(np.float64)+8)/4,1)/256**digit
 elif name=='calibration-one':
  constant=tree.nodes.new('ShaderNodeValue');constant.outputs[0].default_value=1;incoming=constant.outputs[0];ideal=np.float64(1)
 if packed:incoming=packed_color(incoming)
 tree.links.new(incoming,emission.inputs['Color'])
 before=state()
 scene.render.filepath=str(output/(name+'.exr'));bpy.ops.render.render(write_still=True)
 result=bpy.data.images.load(scene.render.filepath,check_existing=False);result.alpha_mode='PREMUL'
 rendered=np.asarray(result.pixels[:],np.float32).reshape(32,32,4)
 with np.errstate(over='ignore',invalid='ignore'):
  argument=np.negative(np.multiply(np.subtract(values,centers,dtype=np.float32),widths,dtype=np.float32),dtype=np.float32)
  power=np.power(float(np.float32(2.71828183)),argument.astype(np.float64)).astype(np.float32)
  candidate=np.divide(np.float32(1),np.add(np.float32(1),power,dtype=np.float32),dtype=np.float32)
  if not name.startswith('calibration-'):ideal=candidate.astype(np.float64)

 quantized=np.asarray(ideal,np.float16).astype(np.float32)
 if packed:
  assert np.all((rendered[:,:,:3]>=0)&(rendered[:,:,:3]<=1)) and np.all(rendered[:,:,:3]*256==np.floor(rendered[:,:,:3]*256)),name
  decoded=rendered[:,:,0].astype(np.float64)+rendered[:,:,1].astype(np.float64)/256+rendered[:,:,2].astype(np.float64)/65536
  lower=decoded;upper=np.minimum(1,decoded+2**-24)
  maximum=float(np.max(np.maximum(np.maximum(lower-ideal,ideal-upper),0)))
  if name.startswith('calibration'):
   assert np.array_equal(decoded,np.broadcast_to(ideal,(32,32))),name
   if name!='calibration-one':assert np.unique(ideal).size==256,name
 else:maximum=float(np.max(np.abs(rendered[:,:,0]-quantized)))
 assert np.isfinite(rendered).all(),name
 assert before==state(),'Render changed source defaults or links'
 assert np.array_equal(image_snapshot,np.asarray(image.pixels[:],np.float32)),'Render changed source image samples'
 # Viability only. A scene-half carrier is not a raw kernel certificate.
 assert maximum<=(2e-5 if packed else .001),(name,maximum)
 path=output/(name+'.rgba32f');rendered.astype('<f4').tofile(path)
 rows.append({'name':name,'actualControls':'independent image RGB fields' if name=='field' or name.startswith('calibration-') and name!='calibration-one' else actual,'center':rendered[16,16].tolist(),'minimum':float(rendered[:,:,0].min()),'maximum':float(rendered[:,:,0].max()),**({'maxVsIdealRoundedHalf':maximum} if not packed else {}),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),**({'decodedCenter':float(decoded[16,16]),'decodedMinimum':float(decoded.min()),'decodedMaximum':float(decoded.max()),'maxOutsideRawInterval':maximum} if packed else {})})
 bpy.data.images.remove(result)
assert (rows[0]['decodedCenter']==.5 and rows[1]['decodedCenter']>.7 and rows[2]['decodedCenter']<.3) if packed else (rows[0]['center'][0]==.5 and rows[1]['center'][0]>.7 and rows[2]['center'][0]<.3)
report={'schemaVersion':1,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'engine':scene.render.engine,'preferredBackend':bpy.context.preferences.system.gpu_backend,'sourcePreserved':True,'cases':rows,'packed':packed,'scope':'Native EEVEE raw24-bit interval vs independent staged Float32 equation; no browser parity claim' if packed else 'Native EEVEE viability only; half scene carrier not a raw precision or browser parity certificate'}
(output/'report.json').write_text(json.dumps(report,indent=2));print('BLENDLINK_SQUEEZE_NATIVE_VIABLE',json.dumps(report))
