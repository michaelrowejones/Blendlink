# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned CPU-MF InputRotation/EulerToRotation twins; research, not port evidence."""
from pathlib import Path
from array import array
import json,struct,sys,hashlib
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(Path(__file__).resolve().parent))
import compositor_static_matrix as shared
from compositor_static_euler import _hash_word
from raw_float_array import raw_float_array_words
OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.parent.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def raw(owner,name):
 return raw_float_array_words(owner,name,3)
def write(owner,name,words):
 buf=array('f');buf.frombytes(struct.pack('=3I',*words));owner.path_resolve(name,False).foreach_set(buf);assert raw(owner,name)==tuple(words)
def state(tree,obj):
 return (tuple((n.as_pointer(),n.bl_idname,n.mute)for n in tree.nodes),tuple((l.from_socket.as_pointer(),l.to_socket.as_pointer(),l.is_muted,l.is_valid)for l in tree.links),tuple((n.as_pointer(),raw(n,'rotation_euler'))for n in tree.nodes if n.bl_idname=='FunctionNodeInputRotation'),tuple((n.as_pointer(),raw(n.inputs['Euler'],'default_value'))for n in tree.nodes if n.bl_idname=='FunctionNodeEulerToRotation'),tuple((n.as_pointer(),n.data_type,n.inputs['Seed'].default_value)for n in tree.nodes if n.bl_idname=='FunctionNodeHashValue'),tuple((n.as_pointer(),n.data_type,n.domain,n.inputs['Name'].default_value,n.inputs['Selection'].default_value)for n in tree.nodes if n.bl_idname=='GeometryNodeStoreNamedAttribute'),tuple((m.as_pointer(),m.type,m.node_group.as_pointer())for m in obj.modifiers))
old_init=gpu.init;old_ops=bpy.ops;calls={'gpu':0,'render':0}
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('No GPU initialization in InputRotation CPU-MF research')
class RenderGuard:
 def __getattr__(self,name):
  def deny(*a,**k):calls['render']+=1;raise RuntimeError('No render/bake in InputRotation research')
  return deny
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
bpy.ops=OpsGuard();gpu.init=deny_gpu
report={'status':'OBSERVED_INPUT_ROTATION_NATIVE_TWINS','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'supportCredit':0,'gpuCredit':0,'renderCredit':0,'sourceHashes':{str(p.relative_to(ROOT)):sha(p)for p in (ROOT/'packages/blendlink/blender').glob('*.py')},'rawCalibration':[],'twins':[]};before=shared._ownership();scene=mesh=obj=tree=calibration=None
try:
 for action in (gpu.init,bpy.ops.render.render,bpy.ops.render.bake):
  try:action()
  except RuntimeError:pass
  else:raise AssertionError('Canary not refused')
 assert calls=={'gpu':1,'render':2};calls={key:0 for key in calls};report['guardCanariesRefused']=True
 calibration=bpy.data.node_groups.new('Owned public raw API calibration','CompositorNodeTree');rot=calibration.nodes.new('FunctionNodeInputRotation');vec=calibration.nodes.new('FunctionNodeInputVector');vr=calibration.nodes.new('ShaderNodeVectorRotate')
 for label,owner,name in [('rotation-euler',rot,'rotation_euler'),('vector',vec,'vector'),('Vector',vr.inputs['Vector'],'default_value'),('Center',vr.inputs['Center'],'default_value')]:
  for bits in [(0x80000000,1,0x80000001),(0x007fffff,0x807fffff,0x00800000),(0x3e800000,0xbf000000,0x3f800000)]:
   write(owner,name,bits);row={'target':label,'inputWords':bits,'rawWords':raw(owner,name),'indexedFalseDoubleBytes':struct.pack('=d',float(owner.path_resolve(name+'[1]',False))).hex()};assert row['rawWords']==bits;report['rawCalibration'].append(row)
 report['readerRefusals']=[]
 for label,owner,name,length in [('indexed',rot,'rotation_euler[1]',3),('width',rot,'rotation_euler',4),('missing',rot,'unknown_array',3),('scalar',vr.inputs['Angle'],'default_value',1),('bool-length',rot,'rotation_euler',True)]:
  try:raw_float_array_words(owner,name,length)
  except ValueError:report['readerRefusals'].append(label)
  else:raise AssertionError('Raw reader accepted '+label)
 bpy.data.node_groups.remove(calibration);calibration=None
 scene=bpy.data.scenes.new('Owned InputRotation twin scene');mesh=bpy.data.meshes.new('Owned InputRotation twin point');mesh.from_pydata([(0,0,0)],[],[]);obj=bpy.data.objects.new('Owned InputRotation twin point',mesh);scene.collection.objects.link(obj)
 samples=[(3078619136, 0, 0), (0, 3078619136, 0), (0, 0, 3078619136), (3212836864, 0, 0), (0, 3212836864, 0), (0, 0, 3212836864), (1090519040, 0, 0), (0, 1090519040, 0), (0, 0, 1090519040), (3238002688, 0, 0), (0, 3238002688, 0), (0, 0, 3238002688), (1078530011, 0, 0), (0, 1078530011, 0), (0, 0, 1078530011), (3226013659, 0, 0), (0, 3226013659, 0), (0, 0, 3226013659), (1086918619, 0, 0), (0, 1086918619, 0), (0, 0, 1086918619), (3234402267, 0, 0), (0, 3234402267, 0), (0, 0, 3234402267), (8388608, 0, 0), (0, 8388608, 0), (0, 0, 8388608), (2155872256, 0, 0), (0, 2155872256, 0), (0, 0, 2155872256), (8388608, 8388608, 8388608), (2155872256, 2155872256, 2155872256), (8388608, 2155872256, 8388608), (3212836864, 1082130432, 3234402267), (1090519040, 3238002688, 1086918619), (1045243769, 1056964608, 1061158912), (1045243770, 1056964608, 1061158912), (1045243771, 1056964608, 1061158912), (1061158912, 1056964608, 1045243770), (1086918618, 3226013658, 1065353217)]
 for sample in samples:
  tree=bpy.data.node_groups.new('Owned native InputRotation/Euler twins','GeometryNodeTree');tree.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');tree.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');gi=tree.nodes.new('NodeGroupInput');go=tree.nodes.new('NodeGroupOutput');geometry=gi.outputs[0]
  for model in ['input','euler']:
   constructor=tree.nodes.new('FunctionNodeInputRotation'if model=='input'else'FunctionNodeEulerToRotation');owner,name=(constructor,'rotation_euler')if model=='input'else(constructor.inputs['Euler'],'default_value');write(owner,name,sample)
   separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(constructor.outputs['Rotation'],separate.inputs['Rotation'])
   for lane in ('W','X','Y','Z'):
    signal=separate.outputs[lane];hashed=tree.nodes.new('FunctionNodeHashValue');hashed.data_type='FLOAT';hashed.inputs['Seed'].default_value=0;tree.links.new(signal,shared._active(hashed.inputs,'Value','VALUE'))
    for data_type,label,source in [('FLOAT','f',signal),('INT','h',hashed.outputs['Hash'])]:
     store=tree.nodes.new('GeometryNodeStoreNamedAttribute');store.data_type=data_type;store.domain='POINT';store.inputs['Selection'].default_value=True;store.inputs['Name'].default_value=model+label+lane;tree.links.new(geometry,store.inputs['Geometry']);tree.links.new(source,shared._active(store.inputs,'Value','VALUE'if data_type=='FLOAT'else'INT'));geometry=store.outputs[0]
  tree.links.new(geometry,go.inputs[0]);modifier=obj.modifiers.new('Owned twin MF','NODES');modifier.node_group=tree;assert len(tree.nodes)==30;prior=state(tree,obj)
  with bpy.context.temp_override(scene=scene,view_layer=scene.view_layers[0]):
   evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());result=evaluated.to_mesh()
   try:
    assert len(result.vertices)==1 and not len(result.edges)and not len(result.polygons)
    row={'inputWords':sample,'results':{}}
    for model in ['input','euler']:
     words=[];hashes=[]
     for lane in ('W','X','Y','Z'):
      f=result.attributes[model+'f'+lane];h=result.attributes[model+'h'+lane];assert f.data_type=='FLOAT'and h.data_type=='INT'and f.domain==h.domain=='POINT'and len(f.data)==len(h.data)==1
      buf=array('f',[0]);f.data.foreach_get('value',buf);word=struct.unpack('=I',buf.tobytes())[0];buf=array('i',[0]);h.data.foreach_get('value',buf);words.append(word);hashes.append(buf[0]&0xffffffff)
     row['results'][model]={'words':words,'hashes':hashes,'storedHashMatches':all(_hash_word(w)==h for w,h in zip(words,hashes)),'normalPositiveZero':all(shared._normal_word(w)for w in words)}
    row['exactTwinWords']=row['results']['input']['words']==row['results']['euler']['words'];row['exactTwinHashes']=row['results']['input']['hashes']==row['results']['euler']['hashes'];assert row['exactTwinWords']and row['exactTwinHashes'];assert state(tree,obj)==prior
    report['twins'].append(row)
   finally:evaluated.to_mesh_clear()
  obj.modifiers.remove(modifier);bpy.data.node_groups.remove(tree);tree=None
finally:
 for collection,item in [(bpy.data.objects,obj),(bpy.data.meshes,mesh),(bpy.data.node_groups,tree),(bpy.data.node_groups,calibration),(bpy.data.scenes,scene)]:
  if item is not None:
   try:collection.remove(item,do_unlink=True)
   except ReferenceError:pass
 report['ownershipRestored']=before==shared._ownership();assert report['ownershipRestored'];report['gpuInitializationCalls']=calls['gpu'];report['renderCalls']=calls['render'];assert calls=={'gpu':0,'render':0};bpy.ops=old_ops;gpu.init=old_init
 report['sourceUnchanged']=all(sha(ROOT/p)==h for p,h in report['sourceHashes'].items());assert report['sourceUnchanged'];OUT.write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_INPUT_ROTATION_TWINS '+json.dumps({'twins':len(report['twins']),'rawCalibration':len(report['rawCalibration']),'ownershipRestored':report['ownershipRestored'],'calls':calls}))
