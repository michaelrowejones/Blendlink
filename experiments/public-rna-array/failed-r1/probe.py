# SPDX-License-Identifier: GPL-3.0-or-later
# Research only: public path_resolve coerce=False raw array access; no evaluation.
from array import array
from pathlib import Path
import bpy,gpu,json,struct,sys,hashlib
OUT=Path(sys.argv[sys.argv.index('--')+1]);calls={'gpu':0,'render':0};old_init=gpu.init;old_ops=bpy.ops
class RenderGuard:
 def __getattr__(self,name):
  def deny(*args,**kwargs):calls['render']+=1;raise RuntimeError('Public RNA probe denies render/bake')
  return deny
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
def deny_gpu(*args,**kwargs):calls['gpu']+=1;raise RuntimeError('Public RNA probe denies GPU initialization')
def state():
 return {'ids':{name:[(x.as_pointer(),x.name,x.users)for x in getattr(bpy.data,name)]for name in ['scenes','objects','meshes','node_groups','materials']},'scene':bpy.context.scene.as_pointer(),'active':bpy.context.view_layer.objects.active.as_pointer()if bpy.context.view_layer.objects.active else None,'frame':bpy.context.scene.frame_current,'subframe':bpy.context.scene.frame_subframe,'selected':sorted(x.as_pointer()for x in bpy.context.selected_objects)}
def farray(words):
 a=array('f');a.frombytes(struct.pack('='+str(len(words))+'I',*words));return a
def words(a):return list(struct.unpack('='+str(len(a))+'I',a.tobytes()))
def read(prop):
 a=array('f',[0])*len(prop);prop.foreach_get(a);return words(a)
report={'status':'RESEARCH_PUBLIC_RNA_ARRAY','supportCredit':0,'renderCalls':0,'gpuInitializationCalls':0,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':[]};tree=None
bpy.ops=OpsGuard();gpu.init=deny_gpu
try:
 for action in [gpu.init,bpy.ops.render.render,bpy.ops.render.bake]:
  try:action()
  except RuntimeError:pass
  else:raise AssertionError('Denial canary failed')
 assert calls=={'gpu':1,'render':2};calls={key:0 for key in calls};report['guardCanariesRefused']=True
 before=state();tree=bpy.data.node_groups.new('Owned public RNA raw-array probe','CompositorNodeTree')
 vector=tree.nodes.new('FunctionNodeInputVector');rotation=tree.nodes.new('FunctionNodeInputRotation');rotate=tree.nodes.new('ShaderNodeVectorRotate');scalar=tree.nodes.new('ShaderNodeValue')
 targets=[('constructor-vector',vector,'vector'),('constructor-rotation-euler',rotation,'rotation_euler'),('vector-socket',rotate.inputs['Vector'],'default_value'),('center-socket',rotate.inputs['Center'],'default_value'),('rotation-socket',rotate.inputs['Rotation'],'default_value')]
 patterns=[[0x80000000,1,0x80000001],[0x007fffff,0x807fffff,0x00800000],[0x3e800000,0xbf000000,0x3f800000]]
 for label,owner,name in targets:
  row={'target':label,'ownerType':owner.bl_rna.identifier,'property':name}
  try:
   prop=owner.path_resolve(name,False);row['propertyObjectType']=type(prop).__name__;row['length']=len(prop);row['hasForeachGet']=hasattr(prop,'foreach_get');row['hasForeachSet']=hasattr(prop,'foreach_set');original=read(prop);row['patterns']=[]
   try:
    for pattern in patterns:
     wanted=(pattern+[0x3f000000]*len(prop))[:len(prop)];prop.foreach_set(farray(wanted));stored=read(prop)
     coerced=owner.path_resolve(name,True);promoted=[struct.pack('=d',float(x)).hex()for x in coerced]
     indexed=owner.path_resolve(name+'[1]',False);row['patterns'].append({'inputWords':wanted,'rawStoredWords':stored,'rawExact':wanted==stored,'coercedType':type(coerced).__name__,'coercedDoubleBytes':promoted,'indexedFalseDoubleBytes':struct.pack('=d',float(indexed)).hex(),'unchangedAfterCoercion':read(prop)==stored})
    row['allRawExact']=all(x['rawExact']and x['unchangedAfterCoercion']for x in row['patterns'])
   finally:prop.foreach_set(farray(original));assert read(prop)==original
  except Exception as error:row['error']=type(error).__name__+': '+str(error)
  report['rows'].append(row)
 try:
  value=scalar.outputs[0].path_resolve('default_value',False);report['scalar']={'type':type(value).__name__,'hasForeachGet':hasattr(value,'foreach_get')}
 except Exception as error:report['scalar']={'error':repr(error)}
finally:
 if tree is not None:bpy.data.node_groups.remove(tree,do_unlink=True)
 if 'before'in locals():report['ownershipRestored']=before==state();assert report['ownershipRestored']
 report['gpuInitializationCalls']=calls['gpu'];report['renderCalls']=calls['render'];assert calls=={'gpu':0,'render':0}
 bpy.ops=old_ops;gpu.init=old_init
 OUT.write_text(json.dumps(report,indent=2)+'\n')
 print('SCENETOWEB_PUBLIC_RNA_ARRAY_PROBE '+json.dumps(report))
