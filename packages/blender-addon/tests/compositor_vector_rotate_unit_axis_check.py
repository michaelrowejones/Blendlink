# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual CPU signed unit-axis Vector Rotate policy, no renders/GPU.
from array import array
from pathlib import Path
import json,struct,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_vector_rotate as rotate,compositor_static_matrix as shared
calls=[]
def deny(*args,**kwargs):calls.append(True);raise RuntimeError('Unit-axis policy denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard absent')
calls.clear();scene=bpy.context.scene;root_before=scene.compositing_node_group;owned=[];positives=[];refusals=[];programs=[]
def setup(field=False,defaults=False):
 r=scene.render;r.use_compositing=True;r.compositor_device='CPU';r.compositor_precision='FULL';r.use_border=False;r.use_crop_to_border=False;r.use_multiview=False;r.pixel_aspect_x=r.pixel_aspect_y=1;r.resolution_x=13;r.resolution_y=9;r.resolution_percentage=100
 tree=bpy.data.node_groups.new('Owned Vector Rotate unit-axis policy','CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;node=tree.nodes.new('ShaderNodeVectorRotate');assert node.rotation_type=='AXIS_ANGLE';sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs[0],sink.inputs[0])
 if not defaults:node.inputs['Vector'].default_value=(.1,.2,.3);node.inputs['Center'].default_value=(.5,-.5,.25);node.inputs['Angle'].default_value=.9
 if field:
  source=tree.nodes.new('CompositorNodeRLayers');coords=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(source.outputs['Image'],coords.inputs['Image']);tree.links.new(coords.outputs['Normalized'],node.inputs['Vector'])
 return tree,node
word=lambda v:struct.unpack('=I',struct.pack('=f',v))[0]
def extract(label,accepted):
 before=shared._ownership();result=graph.extract(scene);assert shared._ownership()==before,label+' leaked or changed source ownership';assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  op=next(op for op in result['ops']if op['kind']=='vector-rotate-cpu');assert op['properties']['vector_rotate_model']==rotate.UNIT_AXIS_MODEL and op['properties']['vector_rotate_profile']==rotate.UNIT_AXIS_PROFILE and op['properties']['vector_rotate_mode']=='AXIS_ANGLE';assert tuple(op['properties']['vector_rotate_axis_words'])in rotate.UNIT_AXES;positives.append(label);programs.append({'case':label,'program':result})
 else:assert any('vector-rotate'in row['code']or row['code']=='animated-tree'for row in result['diagnostics']),(label,result);refusals.append(label)
 return result
try:
 tree,node=setup(defaults=True);native=extract('native-defaults',True);assert next(op for op in native['ops']if op['kind']=='vector-rotate-cpu')['properties']['vector_rotate_angle_word']==0
 for axis in range(3):
  for sign in[-1,1]:
   for invert in[False,True]:
    for field in[False,True]:
     for name,angle in[('zero',0),('minimum',2**-16),('ordinary',.9)]:
      tree,node=setup(field);axis_value=[0,0,0];axis_value[axis]=sign;node.inputs['Axis'].default_value=axis_value;node.invert=invert;node.inputs['Angle'].default_value=angle;extract('axis-'+str(axis)+'-'+str(sign)+'-'+str(invert)+'-'+str(field)+'-'+name,True)
 tree,node=setup(True);group=bpy.data.node_groups.new('Owned unit-axis nested group','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector');inner=group.nodes.new('ShaderNodeVectorRotate');inner.inputs['Axis'].default_value=(0,-1,0);inner.inputs['Angle'].default_value=.9;inner.invert=True;entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],inner.inputs['Vector']);group.links.new(inner.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;coords=next(n for n in tree.nodes if n.bl_idname=='CompositorNodeImageCoordinates');tree.links.new(coords.outputs['Normalized'],instance.inputs[0]);route=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],route.inputs[0]);sink=next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput');tree.links.new(route.outputs[0],sink.inputs[0]);extract('group-reroute-negative-Y',True)
 for label,words in[('zero',[0,0,0]),('two-components',[word(1),word(1),0]),('half',[0,0,word(.5)]),('next-one',[0,0,word(1)+1]),('negative-zero',[0x80000000,0,word(1)]),('subnormal',[1,0,word(1)])]:
  tree,node=setup();raw=array('f');raw.frombytes(struct.pack('=3I',*words));node.inputs['Axis'].default_value.foreach_set(raw);stored=array('f',[0])*3;node.inputs['Axis'].default_value.foreach_get(stored);assert list(struct.unpack('=3I',stored.tobytes()))==words;extract('axis-'+label,False)
 tree,node=setup();value=tree.nodes.new('ShaderNodeCombineXYZ');value.inputs['Z'].default_value=1;tree.links.new(value.outputs[0],node.inputs['Axis']);extract('linked-axis',False)
 tree,node=setup();node.inputs['Axis'].keyframe_insert('default_value',index=2,frame=1);extract('animated-axis',False);tree.animation_data_clear()
 for mutation in['source-axis','private-axis','private-mode']:
  tree,node=setup(True)
  if mutation=='source-axis':
   method=rotate._native_columns
   def changed(*args):
    result=method(*args);node.inputs['Axis'].default_value=(1,0,0);return result
   rotate._native_columns=changed
   try:extract('late-source-axis',False)
   finally:rotate._native_columns=method
  else:
   method=rotate._carrier_state;count=[0]
   def changed(tree,obj):
    count[0]+=1
    if count[0]==2:
     target=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeVectorRotate')
     if mutation=='private-mode':target.rotation_type='EULER_XYZ'
     else:target.inputs['Axis'].default_value=(1,0,0)
    return method(tree,obj)
   rotate._carrier_state=changed
   try:extract('late-'+mutation,False)
   finally:rotate._carrier_state=method
 for control in['axis','angle']:
  tree,node=setup(True);method=rotate._carrier_state;count=[0];evaluations=[0]
  def before_evaluation(scene,*args):
   if scene.name.startswith('.SceneToWeb Vector Rotate '):evaluations[0]+=1
  def changed_initial(tree,obj):
   count[0]+=1
   if count[0]==1:
    target=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeVectorRotate')
    if control=='axis':target.inputs['Axis'].default_value=(1,0,0)
    else:target.inputs['Angle'].default_value=.5
   return method(tree,obj)
  bpy.app.handlers.depsgraph_update_pre.append(before_evaluation);rotate._carrier_state=changed_initial
  try:extract('initial-private-'+control,False);assert evaluations[0]==0,(control,evaluations)
  finally:rotate._carrier_state=method;bpy.app.handlers.depsgraph_update_pre.remove(before_evaluation)
 tree,node=setup(True);method=rotate.validate_graph;count=[0]
 def changed_graph(*args):
  count[0]+=1;result=method(*args)
  if count[0]==2:node.inputs['Axis'].default_value=(1,0,0)
  return result
 rotate.validate_graph=changed_graph
 try:extract('late-axis-EOF',False)
 finally:rotate.validate_graph=method
 assert not calls
 report={'status':'SCENETOWEB_VECTOR_ROTATE_UNIT_AXIS_POLICY_PASSED','positives':positives,'refusals':refusals,'programs':programs,'gpuInitializations':0,'nativeRenders':0,'supportCredit':0,'initialControlRefusalsBeforeEvaluation':2}
 Path(sys.argv[sys.argv.index('--')+1]).write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(positives),len(refusals))
finally:
 scene.compositing_node_group=root_before
 for tree in reversed(owned):bpy.data.node_groups.remove(tree,do_unlink=True)
