# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned CPU Input Rotation constructor source policy; no render/GPU credit.
# blendlink-headless-sentinel: SCENETOWEB_INPUT_ROTATION_POLICY_PASSED
from array import array
from pathlib import Path
from unittest.mock import patch
import json,struct,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_input_rotation as helper,compositor_static_matrix as shared
OUT=Path(sys.argv[sys.argv.index('--')+1]);before=shared._ownership();old_ops=bpy.ops;old_init=gpu.init;calls={'gpu':0,'render':0};owned=[];positive=[];refusals=[];programs=[];complete=False;scene=bpy.context.scene;root_before=scene.compositing_node_group;render_before=(scene.render.compositor_device,scene.render.compositor_precision,scene.render.use_compositing);frame_before=scene.frame_current
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('Input Rotation policy forbids GPU initialization')
class RenderGuard:
 def __getattr__(self,name):
  def deny(*a,**k):calls['render']+=1;raise RuntimeError('Input Rotation policy forbids render/bake')
  return deny
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
bpy.ops=OpsGuard();gpu.init=deny_gpu

def write(node,words):
 values=array('f');values.frombytes(struct.pack('=3I',*words));node.path_resolve('rotation_euler',False).foreach_set(values)
def setup(words=(0x3dcccccd,0x3e4ccccd,0x3e99999a),lane='W'):
 scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.use_compositing=True
 tree=bpy.data.node_groups.new('Owned Input Rotation policy','CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('FunctionNodeInputRotation');write(node,words);separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(node.outputs['Rotation'],separate.inputs['Rotation']);sink=tree.nodes.new('NodeGroupOutput');tree.links.new(separate.outputs[lane],sink.inputs[0]);return tree,node,separate,sink

def nested_setup():
 tree,node,separate,sink=setup();nested=bpy.data.node_groups.new('Owned nested Input Rotation','CompositorNodeTree');owned.append(nested);nested.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');inner=nested.nodes.new('FunctionNodeInputRotation');write(inner,(0x3dcccccd,0x3e4ccccd,0x3e99999a));out=nested.nodes.new('NodeGroupOutput');nested.links.new(inner.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=nested;tree.links.new(instance.outputs[0],separate.inputs[0]);return tree,inner,separate,sink,instance,nested

def check(label,accepted,model=helper.MODEL,restore=True):
 ownership=shared._ownership();result=graph.extract(scene)
 assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  records=result['compileTimeRotations'];assert records and all(row['model']==model for row in records),(label,records)
  assert all(op['kind']=='value'and op['type']=='VALUE'for op in result['ops']if op['source']['nodeType']=='FunctionNodeRotationToQuaternion'),result
  assert all(row['rotationRuntimeTransport']is False for row in records);positive.append(label);programs.append({'case':label,'program':result})
 else:
  assert result['diagnostics'],label;refusals.append(label)
 if restore:assert ownership==shared._ownership(),label+' leaked ownership'
 return result
try:
 for action in (gpu.init,bpy.ops.render.render,bpy.ops.render.bake):
  try:action()
  except RuntimeError:pass
  else:raise AssertionError('Guard canary failed')
 assert calls=={'gpu':1,'render':2};calls={key:0 for key in calls}
 for label,words in [('zero',(0,0,0)),('min',(0x37800000,)*3),('one',(0x3f800000,)*3),('nonhalf',(0x3eaaaaab,0x3f000001,0x3f7fffff))]:
  for lane in ('W','X','Y','Z'):
   setup(words,lane);check(label+'-'+lane,True)
 for label,words in [
  ('negative-one-x',(0xbf800000,0,0)),('negative-one-y',(0,0xbf800000,0)),('negative-one-z',(0,0,0xbf800000)),
  ('negative-min-x',(0xb7800000,0,0)),('negative-min-y',(0,0xb7800000,0)),('negative-min-z',(0,0,0xb7800000)),
  ('positive-min-normal',(0x00800000,)*3),('negative-min-normal-y',(0,0x80800000,0)),
  ('mixed-eight',(0x41000000,0xc1000000,0x40c90fdb)),('mixed-negative-turn',(0xbf800000,0x40800000,0xc0c90fdb)),('near-turn-tie',(0x40c90fda,0xc0490fda,0x3f800001)),
  ('cancel-x-before',(1045243769,1056964608,1061158912)),('cancel-x-tie',(1045243770,1056964608,1061158912)),('cancel-x-after',(1045243771,1056964608,1061158912)),('cancel-z-tie',(1061158912,1056964608,1045243770))]:
  setup(words);check(label,True)
 tree,node,separate,sink=setup();combine=tree.nodes.new('CompositorNodeCombineColor');combine.mode='RGB'
 for source,name in zip(separate.outputs,('Red','Green','Blue','Alpha')):tree.links.new(source,combine.inputs[name])
 tree.links.new(combine.outputs[0],sink.inputs[0]);result=check('all-components-shared-cache',True);assert all(row['nativeEvaluations']==1 for row in result['compileTimeRotations'])
 tree,node,separate,sink=setup();route=tree.nodes.new('NodeReroute');tree.links.new(node.outputs[0],route.inputs[0]);tree.links.new(route.outputs[0],separate.inputs[0]);check('rotation-reroute',True)
 tree,node,separate,sink,instance,nested=nested_setup();check('nested-constructor',True)
 for value,label in [(0x80000000,'negative-zero'),(1,'subnormal'),(0x807fffff,'negative-subnormal'),(0x007fffff,'below-normal'),(0x41000001,'above-eight'),(0x7f800000,'infinity'),(0x7fc12345,'nan')]:
  setup((value,0,0));check(label,False)
 for label,words in [('positive-pi-output',(0x40490fdb,0,0)),('negative-pi-output',(0xc0490fdb,0,0)),('positive-turn-output',(0x40c90fdb,0,0)),('negative-turn-output',(0,0xc0c90fdb,0)),('positive-eight-output',(0x41000000,0,0)),('negative-eight-output',(0xc1000000,0,0)),('negative-min-normal-x-output',(0x80800000,0,0)),('negative-min-normal-z-output',(0,0,0x80800000))]:
  tree,node,separate,sink=setup(words);assert helper._raw_constructor(node)==words;result=check(label,False);assert any('pre-Float-store'in row['message']for row in result['diagnostics']),result
 tree,node,separate,sink=setup();node.mute=True;check('muted-constructor',False)
 tree,node,separate,sink=setup();node.keyframe_insert('rotation_euler',index=0,frame=1);check('animated-property',False);tree.animation_data_clear()
 tree,node,separate,sink=setup();node.driver_add('rotation_euler',0).driver.expression='1';check('driven-property',False);tree.animation_data_clear()
 tree,node,separate,sink=setup();scene.render.compositor_device='GPU';check('GPU-context',False)
 tree,node,separate,sink=setup();tree.links.remove(next(link for link in tree.links if link.to_node==separate));check('unlinked-rotation-default',False)
 tree,node,separate,sink=setup()
 try:helper.evaluate_output(node.outputs['Rotation'],scene,{})
 except helper.InputRotationUnsupported:refusals.append('opaque-rotation-output')
 else:raise AssertionError('Opaque Rotation reached scalar endpoint')
 for mutation in ('raw-property','root','frame'):
  tree,node,separate,sink=setup();native=helper._Evaluator.native
  def changed(self,expression):
   result=native(self,expression)
   if mutation=='raw-property':write(node,(0x3f000000,)*3)
   elif mutation=='root':scene.compositing_node_group=None
   else:scene.frame_current+=1
   return result
  with patch.object(helper._Evaluator,'native',changed):check('late-'+mutation,False,restore=False)
  scene.compositing_node_group=tree;scene.frame_current=frame_before
 for mutation in ('group-binding','group-mute','group-animation'):
  tree,node,separate,sink,instance,nested=nested_setup();native=helper._Evaluator.native
  alternate=bpy.data.node_groups.new('Owned replacement Rotation group','CompositorNodeTree');owned.append(alternate);alternate.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation')
  def changed(self,expression):
   result=native(self,expression)
   if mutation=='group-binding':instance.node_tree=alternate
   elif mutation=='group-mute':instance.mute=True
   else:node.keyframe_insert('rotation_euler',index=0,frame=1)
   return result
  with patch.object(helper._Evaluator,'native',changed):check('late-'+mutation,False,restore=False)
  nested.animation_data_clear()
 for mutation in ('angle','hash-seed','selection','delete-tree'):
  setup();carrier=helper._carrier_state;count=[0]
  def changed(tree,obj):
   count[0]+=1
   if count[0]==2:
    if mutation=='angle':write(next(n for n in tree.nodes if n.bl_idname=='FunctionNodeInputRotation'),(0x3f000000,)*3)
    elif mutation=='hash-seed':next(n for n in tree.nodes if n.bl_idname=='FunctionNodeHashValue').inputs['Seed'].default_value=1
    elif mutation=='selection':next(n for n in tree.nodes if n.bl_idname=='GeometryNodeStoreNamedAttribute').inputs['Selection'].default_value=False
    else:bpy.data.node_groups.remove(tree,do_unlink=True)
   return carrier(tree,obj)
  with patch.object(helper,'_carrier_state',changed):check('private-'+mutation,False)
 # Component recombination cannot smuggle an Input Rotation into normalization.
 for lane in ('W','X'):
  tree,node,separate,sink=setup();mixed=tree.nodes.new('FunctionNodeQuaternionToRotation');mixed.inputs['W'].default_value=1;tree.links.new(separate.outputs[lane],mixed.inputs['X']);terminal=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(mixed.outputs[0],terminal.inputs[0]);tree.links.new(terminal.outputs['W'],sink.inputs[0]);check('mixed-quaternion-'+lane,False)
 # Existing endpoint families still use their original native models.
 tree,node,separate,sink=setup();old=tree.nodes.new('FunctionNodeEulerToRotation');old.inputs[0].default_value=(.1,.2,.3);tree.links.new(old.outputs[0],separate.inputs[0]);check('old-Euler-unchanged',True,graph.static_euler.MODEL)
 tree,node,separate,sink=setup();old=tree.nodes.new('FunctionNodeEulerToRotation');old.inputs[0].default_value=(-1,0,0);tree.links.new(old.outputs[0],separate.inputs[0]);check('old-Euler-negative-refused',False)
 tree,node,separate,sink=setup();old=tree.nodes.new('FunctionNodeQuaternionToRotation');old.inputs['W'].default_value=1;old.inputs['X'].default_value=.25;old.inputs['Y'].default_value=.5;old.inputs['Z'].default_value=.75;tree.links.new(old.outputs[0],separate.inputs[0]);check('old-Quaternion-unchanged',True,graph.static_rotation.MODEL)
 # A typed producer signal is the only cross-family dispatch condition.
 # Once native evaluation starts, no ownership/budget/native failure may retry.
 for family in ('input','quaternion','euler'):
  for failure in ('native','ownership','recursion'):
   tree,node,separate,sink=setup()
   if family=='quaternion':
    producer=tree.nodes.new('FunctionNodeQuaternionToRotation');producer.inputs['W'].default_value=1;producer.inputs['X'].default_value=.25;producer.inputs['Y'].default_value=.5;producer.inputs['Z'].default_value=.75;tree.links.new(producer.outputs[0],separate.inputs[0])
   elif family=='euler':
    producer=tree.nodes.new('FunctionNodeEulerToRotation');producer.inputs[0].default_value=(.1,.2,.3);tree.links.new(producer.outputs[0],separate.inputs[0])
   calls_by_family={'input':0,'quaternion':0,'euler':0}
   def fail_native(self,expression):
    calls_by_family[family]+=1
    if failure=='recursion':raise RecursionError('Native recursion failure control')
    if failure=='ownership':raise shared.StaticMatrixUnsupported('Native ownership failure control')
    raise helper.InputRotationUnsupported('Native hard failure control')
   def unexpected(self,expression):raise AssertionError('Another family native evaluator retried a hard failure')
   classes={'input':helper._Evaluator,'quaternion':graph.static_rotation._Evaluator,'euler':graph.static_euler._Evaluator}
   with patch.object(classes['input'],'native',fail_native if family=='input'else unexpected),patch.object(classes['quaternion'],'native',fail_native if family=='quaternion'else unexpected),patch.object(classes['euler'],'native',fail_native if family=='euler'else unexpected):check('hard-'+family+'-'+failure,False)
   assert calls_by_family=={key:int(key==family)for key in calls_by_family},calls_by_family
 # Cached terminal reads must revalidate the actual constructor property.
 tree,node,separate,sink=setup();cache={};helper.evaluate_output(separate.outputs['W'],scene,cache);assert cache['evaluator'].native_evaluations==1;write(node,(0x3f000000,)*3)
 try:helper.evaluate_output(separate.outputs['X'],scene,cache)
 except helper.InputRotationUnsupported:refusals.append('cached-raw-property')
 else:raise AssertionError('Stale cached Input Rotation accepted')
 complete=True
finally:
 scene.compositing_node_group=root_before;scene.render.compositor_device,scene.render.compositor_precision,scene.render.use_compositing=render_before;scene.frame_current=frame_before
 for tree in reversed(owned):bpy.data.node_groups.remove(tree,do_unlink=True)
 bpy.ops=old_ops;gpu.init=old_init
 assert calls=={'gpu':0,'render':0};assert before==shared._ownership(),'Final source/context ownership changed'
 OUT.write_text(json.dumps({'status':'PASSED_INPUT_ROTATION_SOURCE_POLICY'if complete else'FAILED_INPUT_ROTATION_SOURCE_POLICY','positive':positive,'refusals':refusals,'programs':programs,'gpuInitializationCalls':calls['gpu'],'renderCalls':calls['render'],'ownershipRestored':True,'supportCredit':0},indent=2)+'\n')
 print(('SCENETOWEB_INPUT_ROTATION_POLICY_PASSED 'if complete else'SCENETOWEB_INPUT_ROTATION_POLICY_FAILED ')+json.dumps({'positive':len(positive),'refusals':len(refusals),'calls':calls}))
