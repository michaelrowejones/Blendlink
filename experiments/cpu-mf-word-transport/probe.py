# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only raw-word stage localization. No SDK/port or generic MF credit."""
from array import array
import bpy,json,os,sys,struct,time,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'));sys.path.insert(0,str(ROOT/'experiments/cpu-mf-attribute-oracle'))
from compositor_reference import NativeCompositorReference
from oracle import snapshot
OUT=Path(os.environ['SCENETOWEB_MF_WORDS']);OUT.mkdir(parents=True,exist_ok=True)
def raw(words):
 a=array('f');a.frombytes(struct.pack('='+str(len(words))+'I',*words));return a
def read(collection,property,count):
 a=array('f',[0])*count;collection.foreach_get(property,a);return list(struct.unpack('='+str(count)+'I',a.tobytes()))
def seed(collection,property,words):collection.foreach_set(property,raw(words));return read(collection,property,len(words))
def scalar(node,word):return seed(node.outputs,'default_value',[word])[0]
def hash32(*words):
 m=0xffffffff;rot=lambda x,k:((x<<k)|(x>>(32-k)))&m;a=b=c=(0xdeadbeef+(len(words)<<2)+13)&m
 a=(a+words[0])&m
 if len(words)>1:b=(b+words[1])&m
 c=((c^b)-rot(b,14))&m;a=((a^c)-rot(c,11))&m;b=((b^a)-rot(a,25))&m;c=((c^b)-rot(b,16))&m;a=((a^c)-rot(c,4))&m;b=((b^a)-rot(a,14))&m;c=((c^b)-rot(b,24))&m;return c
hashword=lambda word:hash32(hash32(word),0)
WORDS=[0,0x80000000,1,0x007fffff,0x80000001,0x807fffff,0x00800000,0x3dcccccd]
geometry=[]
def gn(kind,word):
 before=snapshot();scene=mesh=obj=tree=None
 try:
  scene=bpy.data.scenes.new('Owned word transport scene');mesh=bpy.data.meshes.new('Owned word point');mesh.from_pydata([(0,0,0)],[],[])
  input_attr=mesh.attributes.new('input','FLOAT','POINT');stored_input=seed(input_attr.data,'value',[word])
  obj=bpy.data.objects.new('Owned word point',mesh);scene.collection.objects.link(obj);tree=bpy.data.node_groups.new('Owned word graph','GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');entry=tree.nodes.new('NodeGroupInput');exit=tree.nodes.new('NodeGroupOutput')
  source=None;stored=None
  if kind=='named':
   n=tree.nodes.new('GeometryNodeInputNamedAttribute');n.data_type='FLOAT';n.inputs['Name'].default_value='input';source=next(s for s in n.outputs if s.type=='VALUE'and s.enabled and not s.is_unavailable)
  else:
   n=tree.nodes.new('ShaderNodeValue');stored=scalar(n,word);source=n.outputs[0]
   if kind=='matrix':
    combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(source,combine.inputs[0]);tree.links.new(combine.outputs[0],separate.inputs[0]);source=separate.outputs[0]
   elif kind=='multiply':
    mul=tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.use_clamp=False;tree.links.new(source,mul.inputs[0]);mul.inputs[1].default_value=-1;source=mul.outputs[0]
  geo=entry.outputs[0]
  for label,typ,signal in [('float','FLOAT',source),('hash','INT',None)]:
   if typ=='INT':
    h=tree.nodes.new('FunctionNodeHashValue');h.data_type='FLOAT';h.inputs['Seed'].default_value=0;tree.links.new(source,next(s for s in h.inputs if s.identifier=='Value'and s.type=='VALUE'));signal=h.outputs['Hash']
   store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=typ;store.domain='POINT';store.inputs['Name'].default_value=label;store.inputs['Selection'].default_value=True;tree.links.new(geo,store.inputs['Geometry']);tree.links.new(signal,next(s for s in store.inputs if s.name=='Value'and s.enabled and not s.is_unavailable));geo=store.outputs['Geometry']
  tree.links.new(geo,exit.inputs[0]);mod=obj.modifiers.new('Owned word modifier','NODES');mod.node_group=tree
  with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
   evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
   try:
    output_word=read(result.attributes['float'].data,'value',1)[0];retained_input=read(result.attributes['input'].data,'value',1)[0];ints=array('i',[0]);result.attributes['hash'].data.foreach_get('value',ints);witness=struct.unpack('=I',ints.tobytes())[0]
   finally:evaluated.to_mesh_clear()
  row={'producer':kind,'requestedWord':word,'storedProducerWord':stored,'storedMeshInputWord':stored_input[0],'retainedMeshInputWord':retained_input,'attributeWord':output_word,'hashWitness':witness,'hashMatchesStoredSourceWord':witness==hashword(word),'hashMatchesAttributeWord':witness==hashword(output_word)}
 finally:
  if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
  if mesh is not None:bpy.data.meshes.remove(mesh)
  if tree is not None:bpy.data.node_groups.remove(tree)
  if scene is not None:bpy.data.scenes.remove(scene)
 assert before==snapshot();return row
for kind in ['value','matrix','named','multiply']:
 for word in WORDS:geometry.append(gn(kind,word))
# Actual CPU compositor and independently calibrated raw image/EXR sink.
import numpy as np
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
pattern=WORDS[:3]+[0x3f800000];storage=[]
for word in WORDS:
 image=bpy.data.images.new('Owned raw calibration',width=4,height=4,alpha=True,float_buffer=True);image.alpha_mode='PREMUL';image.colorspace_settings.name='Non-Color'
 try:
  rgba=[word,word,word,0x3f800000]*16;stored=seed(image.pixels,'',[])if False else None
  image.pixels.foreach_set(raw(rgba));before=array('f',[0])*64;image.pixels.foreach_get(before);before_words=list(struct.unpack('=64I',before.tobytes()))
  path=OUT/('storage-'+str(word)+'.exr');image.save_render(str(path),scene=oracle.scene);loaded=bpy.data.images.load(str(path),check_existing=False);loaded.alpha_mode='PREMUL'
  try:after=array('f',[0])*64;loaded.pixels.foreach_get(after);after_words=list(struct.unpack('=64I',after.tobytes()))
  finally:bpy.data.images.remove(loaded)
  storage.append({'requestedWord':word,'imageStoredWord':before_words[0],'exrReadWord':after_words[0],'allStoredWordsExact':before_words==rgba,'allExrWordsExact':after_words==rgba})
 finally:bpy.data.images.remove(image)
compositor=[]
for kind in ['value','matrix','multiply','image']:
 for word in WORDS:
  sink,_=oracle.reset();tree=oracle.tree;stored=None;owned=None
  if kind=='image':
   owned=bpy.data.images.new('Owned field input',width=4,height=4,alpha=True,float_buffer=True);owned.alpha_mode='PREMUL';owned.colorspace_settings.name='Non-Color';owned.pixels.foreach_set(raw([word,word,word,0x3f800000]*16));temp=array('f',[0])*64;owned.pixels.foreach_get(temp);stored=struct.unpack('=64I',temp.tobytes())[0];n=tree.nodes.new('CompositorNodeImage');n.image=owned;source=n.outputs['Image']
  else:
   n=tree.nodes.new('ShaderNodeValue');stored=scalar(n,word);source=n.outputs[0]
   if kind=='matrix':
    combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(source,combine.inputs[0]);tree.links.new(combine.outputs[0],separate.inputs[0]);source=separate.outputs[0]
   elif kind=='multiply':
    mul=tree.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.use_clamp=False;tree.links.new(source,mul.inputs[0]);mul.inputs[1].default_value=-1;source=mul.outputs[0]
  tree.links.new(source,sink.inputs[0]);oracle.scene.render.filepath=str(OUT/(kind+'-'+str(word)+'.exr'))
  for n in tree.nodes:n.show_preview=False
  bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
  try:
   a=array('f',[0])*64;image.pixels.foreach_get(a);words=list(struct.unpack('=64I',a.tobytes()));compositor.append({'producer':kind,'requestedWord':word,'storedProducerWord':stored,'rgbaWords':words[:4],'allPixelsIdentical':all(words[i:i+4]==words[:4]for i in range(0,64,4))})
  finally:
   bpy.data.images.remove(image)
   if owned:bpy.data.images.remove(owned,do_unlink=True)
report={'schemaVersion':1,'status':'CPU_MF_WORD_TRANSPORT_RESEARCH_CAPTURED','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'stage':'Geometry CPU-MF Float attribute vs actual CPU compositor FULL RGBA32F EXR, no generic port credit','words':WORDS,'geometry':geometry,'storage':storage,'compositor':compositor,'hashExpected':{str(word):hashword(word)for word in WORDS},'gpuInitializationCalls':0,'nativeCPURenders':len(compositor),'nodePortCredit':0,'sdkChanges':False}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(geometry),len(storage),len(compositor))
