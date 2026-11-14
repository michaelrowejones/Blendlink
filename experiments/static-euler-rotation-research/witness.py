# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only native Euler pre-Float-store hash witnesses; no SDK admission."""
from array import array
import bpy,gpu,json,os,sys,struct,hashlib,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_static_matrix import _ownership
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_EULER_WITNESS']);OUT.mkdir(parents=True,exist_ok=True)
REPORT={'status':'RUNNING','credits':{'sdk':0,'support':0,'Final':0,'browser':0},'canaries':[],'calibration':[],'rows':[],'gpuInitializationCalls':0,'assumptions':'Pinned native build; round-to-nearest and XYZ source polynomial. Float-store agreement alone is not signed-zero evidence. Integer HashValue witness precedes Float storage; compositor INT hash transported as exact signed-high16/unsigned-low16 Float channels.'}
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
PINS=[Path(__file__),ROOT/'experiments/static-euler-rotation-research/run.mjs',ROOT/'experiments/static-euler-rotation-research/sources.json',ROOT/'packages/blendlink/blender/compositor_static_matrix.py',ROOT/'packages/blender-addon/tests/compositor_reference.py'];REPORT['sourceHashes']={str(p.relative_to(ROOT)):sha(p)for p in PINS}
def save(): (OUT/'report.json').write_text(json.dumps(REPORT,indent=2)+'\n')
def raw(words):
 a=array('f');a.frombytes(struct.pack('='+str(len(words))+'I',*words));return a
def words(values):return list(struct.unpack('='+str(len(values))+'I',values.tobytes()))
def fword(v):return struct.unpack('=I',struct.pack('=f',v))[0]
def fvalue(w):return struct.unpack('=f',struct.pack('=I',w))[0]
def read3(values):
 a=array('f',[0])*3;values.foreach_get(a);return words(a)
def read_rotation(node):
 # Native NodeTree.copy retains property bytes; remove other copied nodes so
 # public collection foreach_get sees homogeneous InputRotation storage.
 before=_ownership();private=None
 try:
  private=node.id_data.copy();selected=private.nodes[node.name]
  for item in list(private.nodes):
   if item!=selected:private.nodes.remove(item)
  a=array('f',[0])*3;private.nodes.foreach_get('rotation_euler',a);result=words(a)
 finally:
  if private is not None:bpy.data.node_groups.remove(private)
 assert before==_ownership();return result
def hash32(*items):
 m=0xffffffff;rot=lambda x,k:((x<<k)|(x>>(32-k)))&m;a=b=c=(0xdeadbeef+(len(items)<<2)+13)&m;a=(a+items[0])&m
 if len(items)>1:b=(b+items[1])&m
 c=((c^b)-rot(b,14))&m;a=((a^c)-rot(c,11))&m;b=((b^a)-rot(a,25))&m;c=((c^b)-rot(b,16))&m;a=((a^c)-rot(c,4))&m;b=((b^a)-rot(a,14))&m;c=((c^b)-rot(b,24))&m;return c
hashword=lambda word:hash32(hash32(word),0)
def active(sockets,name):return next(s for s in sockets if s.name==name and s.enabled and not s.is_unavailable)
def make(tree,kind,input_words,route='direct'):
 if kind=='value':
  n=tree.nodes.new('ShaderNodeValue');n.outputs.foreach_set('default_value',raw(input_words[:1]));a=array('f',[0]);n.outputs.foreach_get('default_value',a);assert words(a)==input_words[:1];return[n.outputs[0]]
 n=tree.nodes.new('FunctionNodeInputRotation'if kind=='input'else'FunctionNodeEulerToRotation')
 if kind=='input':
  n.rotation_euler=tuple(map(fvalue,input_words));assert read_rotation(n)==input_words
 else:
  n.inputs.foreach_set('default_value',raw(input_words));a=array('f',[0])*3;n.inputs.foreach_get('default_value',a);assert words(a)==input_words
 source=n.outputs['Rotation']
 if route.startswith('group'):
  group=bpy.data.node_groups.new('Owned Euler Instance','CompositorNodeTree'if tree.bl_idname=='CompositorNodeTree'else'GeometryNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instances=[]
  for i in range(2):
   instance=tree.nodes.new('CompositorNodeGroup'if tree.bl_idname=='CompositorNodeTree'else'GeometryNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);instances.append(instance)
  source=instances[int(route[-1])].outputs[0]
 separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(source,separate.inputs[0]);return[separate.outputs[k]for k in ['W','X','Y','Z']]
def hash_node(tree,source):
 node=tree.nodes.new('FunctionNodeHashValue');node.data_type='FLOAT';node.inputs['Seed'].default_value=0;tree.links.new(source,active(node.inputs,'Value'));return node.outputs['Hash']
def geometry(kind,input_words):
 before=_ownership();scene=mesh=obj=tree=None
 try:
  scene=bpy.data.scenes.new('Owned Euler Witness');mesh=bpy.data.meshes.new('Owned Euler Point');mesh.from_pydata([(0,0,0)],[],[]);obj=bpy.data.objects.new('Owned Euler Object',mesh);scene.collection.objects.link(obj);tree=bpy.data.node_groups.new('Owned Euler Witness','GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');entry=tree.nodes.new('NodeGroupInput');exit=tree.nodes.new('NodeGroupOutput');source=make(tree,kind,input_words);geo=entry.outputs[0]
  for i,signal in enumerate(source):
   hashed=hash_node(tree,signal)
   for typ,name,node in [('FLOAT','f'+str(i),signal),('INT','h'+str(i),hashed)]:
    store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=typ;store.domain='POINT';store.inputs['Name'].default_value=name;store.inputs['Selection'].default_value=True;tree.links.new(geo,store.inputs['Geometry']);tree.links.new(node,active(store.inputs,'Value'));geo=store.outputs['Geometry']
  tree.links.new(geo,exit.inputs[0]);mod=obj.modifiers.new('Owned Euler MF','NODES');mod.node_group=tree
  with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
   evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
   try:
    output=[];hashes=[]
    for i in range(len(source)):
     a=array('f',[0]);result.attributes['f'+str(i)].data.foreach_get('value',a);output+=words(a);b=array('i',[0]);result.attributes['h'+str(i)].data.foreach_get('value',b);hashes.append(b[0]&0xffffffff)
   finally:evaluated.to_mesh_clear()
 finally:
  if obj is not None:bpy.data.objects.remove(obj,do_unlink=True)
  if mesh is not None:bpy.data.meshes.remove(mesh)
  if tree is not None:bpy.data.node_groups.remove(tree)
  if scene is not None:bpy.data.scenes.remove(scene)
 assert before==_ownership();return output,hashes
original=gpu.init
def forbidden(*args,**kwargs):REPORT['gpuInitializationCalls']+=1;raise AssertionError('CPU witness cannot initialize GPU')
gpu.init=forbidden
try:
 # Raw array read occurs before any numeric getter or rendering.
 tree=bpy.data.node_groups.new('Owned Euler Storage Canary','CompositorNodeTree')
 try:
  for kind in ['input','convert']:
   tree.nodes.clear();n=tree.nodes.new('FunctionNodeInputRotation'if kind=='input'else'FunctionNodeEulerToRotation');storage=n.rotation_euler if kind=='input'else n.inputs['Euler'].default_value
   for requested in [[0,0x80000000,1],[0x007fffff,0x80000001,0x807fffff],[0x37800000,0x3dcccccd,0x3f800000]]:
    if kind=='input':
     tree.nodes.foreach_set('rotation_euler',raw(requested));actual=read_rotation(n)
    else:
     n.inputs.foreach_set('default_value',raw(requested));a=array('f',[0])*3;n.inputs.foreach_get('default_value',a);actual=words(a)
    REPORT['canaries'].append({'producer':kind,'requestedWords':requested,'storedWords':actual});save();assert actual==requested
 finally:bpy.data.node_groups.remove(tree)
 oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
 def render(label,signals,hashes=False):
  tree=oracle.tree;sink=next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput');color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[3].default_value=1
  if hashes:
   h=hash_node(tree,signals[0]);low=tree.nodes.new('FunctionNodeBitMath');low.operation='AND';low.inputs['B'].default_value=65535;tree.links.new(h,low.inputs['A']);high=tree.nodes.new('FunctionNodeIntegerMath');high.operation='DIVIDE_FLOOR';high.inputs[1].default_value=65536;tree.links.new(h,high.inputs[0]);tree.links.new(low.outputs[0],color.inputs[0]);tree.links.new(high.outputs[0],color.inputs[1]);color.inputs[2].default_value=123
  else:
   for i,signal in enumerate(signals):tree.links.new(signal,color.inputs[i])
  tree.links.new(color.outputs[0],sink.inputs[0]);oracle.scene.render.filepath=str(OUT/(label+'.exr'))
  for n in tree.nodes:n.show_preview=False
  bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
  try:a=array('f',[0])*64;image.pixels.foreach_get(a);u=words(a);assert all(u[i:i+4]==u[:4]for i in range(0,64,4));result=u[:4]
  finally:bpy.data.images.remove(image)
  if hashes:
   low,high,marker,alpha=map(fvalue,result);assert low==int(low)and high==int(high)and 0<=low<65536 and -32768<=high<=32767 and marker==123 and alpha==1;return(((int(high)<<16)|int(low))&0xffffffff,result)
  return result
 for word in [0,0x80000000,1,0x007fffff,0x80000001,0x807fffff,0x00800000,0x3dcccccd]:
  stored,gh=geometry('value',[word]);oracle.reset();source=make(oracle.tree,'value',[word]);ch,carrier=render('calibration-'+str(word),source,True);row={'sourceWord':word,'geometryFloatWord':stored[0],'geometryHash':gh[0],'compositorHash':ch,'manualHash':hashword(word),'carrierWords':carrier};REPORT['calibration'].append(row);save();assert gh==[hashword(word)]and ch==hashword(word),row
 cases=[('zero',[0,0,0])]
 for axis in range(3):
  for name,value in [('min',2**-16),('next-min',fvalue(0x37800001)),('ordinary',.1),('max',1)]:
   q=[0,0,0];q[axis]=value;cases.append(('axis-'+str(axis)+'-'+name,q))
 for name,q in [('asymmetric',[.1,.2,.3]),('all-min',[2**-16]*3),('all-max',[1]*3),('symmetric',[.5]*3),('mixed',[2**-16,1,.1]),('zero-x',[0,.5,.75]),('zero-y',[.5,0,.75]),('zero-z',[.5,.75,0])]:cases.append((name,q))
 cancel=2*math.atan(math.tan(.5/2)*math.tan(.75/2));center=fword(cancel)
 for delta in [-1,0,1]:cases.append(('cancel-x-'+str(delta),[fvalue(center+delta),.5,.75]));cases.append(('cancel-z-'+str(delta),[.75,.5,fvalue(center+delta)]))
 cases.extend([('group-0',[.1,.2,.3]),('group-1',[1,2**-16,.5])])
 for kind in ['input','convert']:
  for label,angles in cases:
   input_words=list(map(fword,angles));gn,gh=geometry(kind,input_words);comp=[];ch=[];carriers=[];route=label if label.startswith('group')else'direct'
   for part,indices in enumerate([[0,1,2],[3]]):
    oracle.reset();signals=make(oracle.tree,kind,input_words,route);got=render(kind+'-'+label+'-raw-'+str(part),[signals[i]for i in indices]);comp+=got[:len(indices)]
   for i in range(4):
    oracle.reset();signals=make(oracle.tree,kind,input_words,route);actual,carrier=render(kind+'-'+label+'-hash-'+str(i),[signals[i]],True);ch.append(actual);carriers.append(carrier)
   row={'case':kind+'-'+label,'producer':kind,'route':route,'inputWords':input_words,'geometryFloatWords':gn,'compositorFloatWords':comp,'geometryHashWords':gh,'compositorHashWords':ch,'expectedHashOfStoredWords':list(map(hashword,gn)),'hashCarrierWords':carriers,'floatWordsExact':gn==comp,'preStoreHashesExact':gh==ch==list(map(hashword,gn)),'allOutputsNormalOrPositiveZero':all(w!=0x80000000 and ((w&0x7fffffff)==0 or 0x00800000<=(w&0x7fffffff)<0x7f800000)for w in gn)};REPORT['rows'].append(row);save()
 REPORT.update(status='CAPTURED_EULER_CPU_HASH_WITNESS_RESEARCH',version=list(bpy.app.version),build=bpy.app.build_hash.decode(),sceneEngine=oracle.scene.render.engine,compositorDevice=oracle.scene.render.compositor_device,compositorPrecision=oracle.scene.render.compositor_precision,nativeCPURenders=8+len(REPORT['rows'])*6,failures=[r['case']for r in REPORT['rows']if not(r['floatWordsExact']and r['preStoreHashesExact']and r['allOutputsNormalOrPositiveZero'])]);assert REPORT['sourceHashes']=={str(p.relative_to(ROOT)):sha(p)for p in PINS};save();print(REPORT['status'],len(REPORT['rows']),REPORT['failures'])
finally:gpu.init=original;save()
