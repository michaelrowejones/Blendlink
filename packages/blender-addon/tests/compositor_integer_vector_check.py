# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned CPU Int32 vector constructor source policy; no render/GPU credit.
# blendlink-headless-sentinel: SCENETOWEB_COMPOSITOR_INTEGER_VECTOR_POLICY_PASSED
from pathlib import Path
from unittest.mock import patch
import json,sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_integer_vector as helper
scene=bpy.context.scene;owned=[];positive=[];refusals=[]
def setup():
 scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.use_compositing=True
 tree=bpy.data.node_groups.new('Owned int3 policy','CompositorNodeTree');owned.append(tree)
 tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('FunctionNodeInputIntVector');node.vector_dimensions=3;node.vector=(-2147483648,2147483647,16777217)
 sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs[0],sink.inputs[0]);return tree,node,sink
def check(label,accepted):
 result=graph.extract(scene)
 assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  assert len(result['ops'])==1 and result['ops'][0]['type']=='INT_VECTOR3'and result['ops'][0]['kind']=='integer-vector',result
  assert result['ops'][0]['value']==[-2147483648,2147483647,16777217],result
  positive.append(label)
 else:
  assert any('integer-vector'in d['code']or d['code']=='animated-tree'or label=='vector-consumer'and d['code']=='unsupported-vector-math'for d in result['diagnostics']),(label,result)
  refusals.append(label)
 return result
def wrap(tree,node,sink,socket_type):
 group=bpy.data.node_groups.new('Actual artist int3 group','CompositorNodeTree');owned.append(group)
 group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketIntVector3D')
 group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type=socket_type)
 gi=group.nodes.new('NodeGroupInput');go=group.nodes.new('NodeGroupOutput');group.links.new(gi.outputs[0],go.inputs[0])
 instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group
 tree.links.new(node.outputs[0],instance.inputs[0]);tree.links.new(instance.outputs[0],sink.inputs[0]);return instance
try:
 for precision in ['AUTO','FULL']:
  tree,node,sink=setup();scene.render.compositor_precision=precision;check(precision+'-direct-RGBA',True)
 tree,node,sink=setup();reroute=tree.nodes.new('NodeReroute');tree.links.new(node.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],sink.inputs[0]);check('int3-reroute',True)
 for socket_type in ['NodeSocketIntVector3D','NodeSocketVector','NodeSocketColor']:
  tree,node,sink=setup();wrap(tree,node,sink,socket_type);check('group-'+socket_type,True)
 tree,node,sink=setup();unused=tree.nodes.new('FunctionNodeInputIntVector');unused.vector_dimensions=2;check('unused-unsupported-width-pruned',True)
 for socket_type in ['NodeSocketFloat','NodeSocketInt','NodeSocketBool']:
  tree,node,sink=setup();wrap(tree,node,sink,socket_type);check('conversion-'+socket_type,False)
 for node_type,socket_name in [('CompositorNodeBoxMask','Size'),('CompositorNodeBlankImage','Size')]:
  tree,node,sink=setup();consumer=tree.nodes.new(node_type)
  try:helper.validate_edge({'kind':'ref','type':'INT_VECTOR3','node':'owned'},consumer.inputs[socket_name])
  except helper.IntegerVectorUnsupported:refusals.append('conversion-'+consumer.inputs[socket_name].bl_idname)
  else:raise AssertionError('Other width was admitted')
 tree,node,sink=setup();node.vector_dimensions=2;check('constructor-width2',False)
 tree,node,sink=setup();node.mute=True;check('muted',False)
 tree,node,sink=setup();node.keyframe_insert('vector',index=0,frame=1);check('animated-property',False);tree.animation_data_clear()
 tree,node,sink=setup();node.driver_add('vector',0).driver.expression='1';check('driven-property',False);tree.animation_data_clear()
 tree,node,sink=setup();scene.render.compositor_device='GPU';check('GPU-context',False)
 tree,node,sink=setup();math=tree.nodes.new('ShaderNodeMath');tree.links.new(node.outputs[0],math.inputs[0]);tree.links.new(math.outputs[0],sink.inputs[0]);check('scalar-consumer',False)
 tree,node,sink=setup();vector=tree.nodes.new('ShaderNodeVectorMath');vector.operation='ADD';tree.links.new(node.outputs[0],vector.inputs[0]);tree.links.new(vector.outputs[0],sink.inputs[0]);check('vector-consumer',False)
 for mode in ['unchanged','raw-property','dimensions','group-mute','reroute-relink','root','frame','disabled']:
  tree,node,sink=setup();target=wrap(tree,node,sink,'NodeSocketIntVector3D')if mode=='group-mute'else tree.nodes.new('NodeReroute')
  if mode=='reroute-relink':tree.links.new(node.outputs[0],target.inputs[0]);tree.links.new(target.outputs[0],sink.inputs[0])
  alternate=tree.nodes.new('FunctionNodeInputIntVector');alternate.vector=(1,2,3);old_frame=scene.frame_current;calls=[];original=helper.validate_graph
  def later(program):
   result=original(program);calls.append(True)
   if mode=='raw-property':node.vector=(1,2,3)
   elif mode=='dimensions':node.vector_dimensions=2
   elif mode=='group-mute':target.mute=True
   elif mode=='reroute-relink':tree.links.new(alternate.outputs[0],target.inputs[0])
   elif mode=='root':scene.compositing_node_group=None
   elif mode=='frame':scene.frame_current=old_frame+1
   elif mode=='disabled':scene.render.use_compositing=False
   return result
  with patch.object(helper,'validate_graph',later):check('late-'+mode,mode=='unchanged')
  assert calls==[True];scene.frame_current=old_frame
 print('SCENETOWEB_COMPOSITOR_INTEGER_VECTOR_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'renders':0,'gpuInitializationCalls':0,'supportCredit':0}))
finally:
 scene.compositing_node_group=None
 for tree in reversed(owned):bpy.data.node_groups.remove(tree)
