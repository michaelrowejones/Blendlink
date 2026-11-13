# SPDX-License-Identifier: GPL-3.0-or-later
"""RESEARCH ONLY: native image/constant Float to Integer; no production extraction."""
import bpy,hashlib,json,math,os,sys,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from values import controls,json_controls,word,from_word
output=Path(os.environ['BLENDLINK_FLOAT_TO_INT_OUTPUT']).resolve();output.mkdir(parents=True,exist_ok=True)
device=os.environ.get('BLENDLINK_FLOAT_TO_INT_DEVICE','CPU');assert device in {'CPU','GPU'}
constant_scope=os.environ.get('BLENDLINK_FLOAT_TO_INT_CONSTANT_SCOPE','FULL');assert constant_scope in {'SMOKE','FULL'}
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
if hasattr(scene,'compositing_node_group'):
 trial=bpy.data.node_groups.new('Actual compositor availability','CompositorNodeTree');scene.compositing_node_group=trial
else:scene.use_nodes=True;trial=scene.node_tree
try:trial.nodes.new('FunctionNodeFloatToInt')
except RuntimeError as error:
 report={'status':'NATIVE_NODE_UNAVAILABLE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'context':'CompositorNodeTree','deviceRequested':device,'numericalCases':0,'reason':str(error),'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 (output/'unavailable.json').write_text(json.dumps(report,indent=2)+'\n');print('BLENDLINK_FLOAT_TO_INT_COMPOSITOR_UNAVAILABLE '+json.dumps(report));sys.exit(0)
from compositor_reference import NativeCompositorReference
items=controls();height=width=8
pixels=np.ones((height,width,4),np.float32);requested=np.asarray([int(item['word'],16) for item in items],np.uint32)
pixels.view(np.uint32)[:,:,0]=np.resize(requested,(height,width));pixels.view(np.uint32)[:,:,1]=pixels.view(np.uint32)[:,:,0];pixels.view(np.uint32)[:,:,2]=pixels.view(np.uint32)[:,:,0]
reference=NativeCompositorReference(output,device=device,pixels=pixels,node_previews=False,image_only_scene=True)
scene,tree=reference.scene,reference.tree
engines={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items};scene.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT';scene.world=None
def read_image_words():
 storage=np.empty(height*width*4,np.float32);reference.image.pixels.foreach_get(storage);return [f'{int(bits):08x}' for bits in storage.view(np.uint32)]
storage_stages=[{'stage':'helper-construction','words':read_image_words()}]
reference.image.colorspace_settings.name='Non-Color';reference.image.alpha_mode='STRAIGHT';reference.image.use_half_precision=False
storage_stages.append({'stage':'flags-configured','words':read_image_words()})
import gpu
gpu.init();backend={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get()}
def image_bytes():
 actual=np.empty(height*width*4,np.float32);reference.image.pixels.foreach_get(actual);return actual.tobytes()
storage_stages.append({'stage':'gpu-init','words':read_image_words()})
reference.image.pixels.foreach_set(pixels.ravel())
source_bytes=image_bytes();storage_stages.append({'stage':'explicit-final-upload','words':read_image_words()})
(output/'source-staging.json').write_text(json.dumps({'requestedWords':[f'{int(bits):08x}' for bits in pixels.view(np.uint32).ravel()],'stages':storage_stages},indent=2)+'\n')
assert source_bytes==pixels.tobytes(),'Final source image upload changed requested Float32 words'
(output/'source-input.rgba32f').write_bytes(source_bytes)
def state():
 def value(socket):
  v=getattr(socket,'default_value',None)
  if v is None or isinstance(v,(str,bool,int)):return v
  if isinstance(v,float):return word(v)
  return tuple(word(float(x)) for x in v)
 return repr([(node.bl_idname,node.name,getattr(node,'rounding_mode',None),[(socket.identifier,value(socket)) for socket in node.inputs],[(socket.identifier,value(socket)) for socket in node.outputs]) for node in tree.nodes])+repr(sorted((link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links))
def reset():
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');return sink

def finish_color(sink,field):
 combine=tree.nodes.new('CompositorNodeCombineColor');combine.mode='RGB'
 for name in ['Red','Green','Blue']:tree.links.new(field,combine.inputs[name])
 combine.inputs['Alpha'].default_value=1;tree.links.new(combine.outputs[0],sink.inputs['Image'])
def image_input():
 source=tree.nodes.new('CompositorNodeImage');source.image=reference.image
 separate=tree.nodes.new('CompositorNodeSeparateColor');separate.mode='RGB';tree.links.new(source.outputs['Image'],separate.inputs['Image']);return separate.outputs['Red']
rows=[]
def render(name,**metadata):
 for node in tree.nodes:node.show_preview=False
 before=state();scene.render.filepath=str(output/(name+'.exr'))
 with reference._render_sampling() as profile:bpy.ops.render.render(write_still=True)
 result=bpy.data.images.load(scene.render.filepath,check_existing=False);result.alpha_mode='PREMUL';actual=np.empty(height*width*4,np.float32);result.pixels.foreach_get(actual);bpy.data.images.remove(result)
 assert state()==before and image_bytes()==source_bytes,'Native rendering changed authored source graph/image'
 raw=output/(name+'.rgba32f');raw.write_bytes(actual.tobytes());words=actual.view(np.uint32).reshape(height,width,4)
 row={'case':name,**metadata,'pixelFile':raw.name,'pixelSha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'exrFile':name+'.exr','exrSha256':hashlib.sha256((output/(name+'.exr')).read_bytes()).hexdigest(),'redWords':[f'{int(v):08x}' for v in words[:,:,0].ravel()],'alphaWords':sorted({f'{int(v):08x}' for v in words[:,:,3].ravel()}),'sourcePreserved':True,'renderProfile':profile}
 rows.append(row)
 # Save incrementally so an undefined control failure cannot erase prior evidence.
 (output/'progress.json').write_text(json.dumps({'completed':len(rows),'last':name},indent=2)+'\n')
# The identity control measures native image/type/output staging before the node.
sink=reset();finish_color(sink,image_input());render('identity-field',kind='identity-image')
for mode in ['ROUND','FLOOR','CEILING','TRUNCATE']:
 sink=reset();node=tree.nodes.new('FunctionNodeFloatToInt');node.rounding_mode=mode;tree.links.new(image_input(),node.inputs['Float']);finish_color(sink,node.outputs['Integer']);render(mode.lower()+'-image',kind='image-field',mode=mode)
 selected=items if constant_scope=='FULL' else [item for item in items if item['name'] in {'ordinary--0.5','ordinary-0.5','ordinary--0.0','ordinary-0.0','zero-normal-word-80000001','integer-limit--2147483648','integer-limit-2147483648'}]
 for index,item in enumerate(selected):
  sink=reset();node=tree.nodes.new('FunctionNodeFloatToInt');node.rounding_mode=mode
  try:node.inputs['Float'].default_value=item['value']
  except (ValueError,TypeError,OverflowError) as error:
   rows.append({'case':mode.lower()+'-constant-'+item['word'],'kind':'constant-rna-refusal','mode':mode,'input':{key:value for key,value in item.items() if key!='value'},'error':str(error)});continue
  # RNA readback is an observation, not a raw-memory attestation under FTZ.
  read=node.inputs['Float'].default_value;rna_word=f'{word(read):08x}'
  finish_color(sink,node.outputs['Integer']);render(mode.lower()+'-constant-'+item['word'],kind='constant',mode=mode,inputWord=item['word'],inputDomain=item['domain'],rnaReadWord=rna_word)
 for wanted in ['bf000000','3f000000','80000000','00000000','80000001','cf000000','4effffff']:
  item=next((value for value in items if value['word']==wanted),None)
  if item is None:continue
  sink=reset();node=tree.nodes.new('FunctionNodeFloatToInt');node.rounding_mode=mode;value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=item['value'];tree.links.new(value.outputs[0],node.inputs['Float']);finish_color(sink,node.outputs['Integer']);render(mode.lower()+'-linked-'+wanted,kind='linked-constant',mode=mode,inputWord=wanted,inputDomain=item['domain'],rnaReadWord=f'{word(value.outputs[0].default_value):08x}')
report={'status':'CAPTURED_RESEARCH_ONLY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':device,'gpu':backend,'engine':scene.render.engine,'constantScope':constant_scope,'width':width,'height':height,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'valuesSha256':hashlib.sha256((Path(__file__).parent/'values.py').read_bytes()).hexdigest(),'oracleHelperSha256':hashlib.sha256((ROOT/'packages/blender-addon/tests/compositor_reference.py').read_bytes()).hexdigest(),'sourceInputSha256':hashlib.sha256(source_bytes).hexdigest(),'sourcePreserved':image_bytes()==source_bytes,'controls':json_controls(),'rows':rows}
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('BLENDLINK_FLOAT_TO_INT_COMPOSITOR_CAPTURED '+json.dumps({'version':report['version'],'device':device,'cases':len(rows),'backend':backend}))
