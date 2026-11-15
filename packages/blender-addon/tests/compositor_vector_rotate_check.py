# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned CPU fixed-axis Vector Rotate policy; no render/GPU/support credit.
# blendlink-headless-sentinel: SCENETOWEB_COMPOSITOR_VECTOR_ROTATE_POLICY_PASSED
from array import array
from pathlib import Path
import json,struct,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
calls=[0]
def deny(*args,**kwargs):calls[0]+=1;raise RuntimeError('Vector Rotate source policy denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('Missing GPU deny guard')
calls[0]=0
import compositor_graph as graph,compositor_vector_rotate as rotate,compositor_static_matrix as shared
scene=bpy.context.scene;original=scene.compositing_node_group;owned=[];positives=[];refusals=[];programs=[]
def setup(field=False):
 r=scene.render;r.use_compositing=True;r.compositor_device='CPU';r.compositor_precision='FULL';r.use_border=False;r.use_crop_to_border=False;r.use_multiview=False;r.pixel_aspect_x=r.pixel_aspect_y=1;r.resolution_x=13;r.resolution_y=9;r.resolution_percentage=100
 tree=bpy.data.node_groups.new('Owned Vector Rotate policy','CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('ShaderNodeVectorRotate');node.rotation_type='Z_AXIS';node.inputs['Angle'].default_value=.9;node.inputs['Vector'].default_value=(.1,.2,.3);node.inputs['Center'].default_value=(.5,-.5,0)
 sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs['Vector'],sink.inputs[0])
 if field:
  image=tree.nodes.new('CompositorNodeRLayers');coordinates=tree.nodes.new('CompositorNodeImageCoordinates');tree.links.new(image.outputs['Image'],coordinates.inputs['Image']);tree.links.new(coordinates.outputs['Normalized'],node.inputs['Vector'])
 return tree,node,sink
def extract(label,accepted,mutating=False):
 before=shared._ownership();result=graph.extract(scene)
 if not mutating:assert shared._ownership()==before,label+' changed source ownership'
 else:assert {k:[row[:2]for row in rows]for k,rows in shared._ownership()['ids'].items()}=={k:[row[:2]for row in rows]for k,rows in before['ids'].items()},label+' leaked owned IDs'
 assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  ops=[op for op in result['ops']if op['kind']=='vector-rotate-cpu'];assert len(ops)==1 and ops[0]['properties']['vector_rotate_model']==rotate.MODEL
  positives.append(label)
  programs.append({'case':label,'program':result})
 else:
  assert any('vector-rotate'in row['code']or row['code']=='animated-tree'for row in result['diagnostics']),(label,result)
  refusals.append(label)
 return result
try:
 for mode in ['X_AXIS','Y_AXIS','Z_AXIS']:
  for invert in [False,True]:
   for field in [False,True]:
    tree,node,sink=setup(field);node.rotation_type=mode;node.invert=invert;extract(mode+'-'+str(invert)+'-'+str(field),True)
 for angle in [0,2**-16,-(2**-16),1,-1]:
  tree,node,sink=setup();node.inputs['Angle'].default_value=angle;extract('angle-'+str(angle),True)
 for case,raw_word,accepted in [('positive-zero',0,True),('negative-zero',0x80000000,False),('subnormal',1,False)]:
  tree,node,sink=setup(True);separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(node.outputs['Vector'],separate.inputs[0]);combine=tree.nodes.new('CompositorNodeCombineColor');combine.mode='RGB';tree.links.new(separate.outputs['X'],combine.inputs['Red']);raw=array('f');raw.frombytes(struct.pack('=4I',0,raw_word,0,0x3f800000));combine.inputs.foreach_set('default_value',raw);stored=array('f',[0])*4;combine.inputs.foreach_get('default_value',stored);assert struct.unpack('=4I',stored.tobytes())==(0,raw_word,0,0x3f800000);tree.links.new(combine.outputs[0],sink.inputs[0]);extract('presentation-'+case,accepted)
 tree,node,sink=setup(True);group=bpy.data.node_groups.new('Owned Rotate nested','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector');inner=group.nodes.new('ShaderNodeVectorRotate');inner.rotation_type='X_AXIS';inner.inputs['Angle'].default_value=.9;entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],inner.inputs['Vector']);group.links.new(inner.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;coordinates=next(n for n in tree.nodes if n.bl_idname=='CompositorNodeImageCoordinates');tree.links.new(coordinates.outputs['Normalized'],instance.inputs[0]);route=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],route.inputs[0]);tree.links.new(route.outputs[0],sink.inputs[0]);extract('group-reroute',True)
 for mode in ['AXIS_ANGLE','EULER_XYZ']:
  tree,node,sink=setup();node.rotation_type=mode;extract('mode-'+mode,False)
 for label,value in [('negative-zero',-0.),('tiny',2**-17),('wide',2.)]:
  tree,node,sink=setup();node.inputs['Angle'].default_value=value;extract('angle-'+label,False)
 for name in ['Center','Vector']:
  for bits,label in [(0x80000000,'negative-zero'),(1,'subnormal'),(0x41800001,'above-16')]:
   tree,node,sink=setup();raw=array('f');raw.frombytes(struct.pack('=3I',bits,0,0));node.inputs[name].default_value.foreach_set(raw);extract(name+'-'+label,False)
 for name in ['Center','Angle']:
  tree,node,sink=setup();source=tree.nodes.new('ShaderNodeValue');tree.links.new(source.outputs[0],node.inputs[name]);extract('linked-'+name,False)
 tree,node,sink=setup(True);coordinates=next(n for n in tree.nodes if n.bl_idname=='CompositorNodeImageCoordinates');tree.links.new(coordinates.outputs['Uniform'],node.inputs['Vector']);extract('uniform-field',False)
 tree,node,sink=setup();node.mute=True;extract('muted',False)
 tree,node,sink=setup();node.inputs['Angle'].keyframe_insert('default_value',frame=1);extract('animated',False);tree.animation_data_clear()
 for attribute,value in [('compositor_device','GPU'),('use_border',True),('use_multiview',True),('pixel_aspect_y',2),('resolution_x',8193)]:
  tree,node,sink=setup();setattr(scene.render,attribute,value);extract('context-'+attribute,False)
 for mutation in ['angle','center','root','reroute']:
  tree,node,sink=setup(True);route=tree.nodes.new('NodeReroute');coordinates=next(n for n in tree.nodes if n.bl_idname=='CompositorNodeImageCoordinates');tree.links.new(coordinates.outputs['Normalized'],route.inputs[0]);tree.links.new(route.outputs[0],node.inputs['Vector']);native=rotate._native_columns
  def changed(*args):
   result=native(*args)
   if mutation=='angle':node.inputs['Angle'].default_value=.5
   elif mutation=='center':node.inputs['Center'].default_value=(0,0,0)
   elif mutation=='root':scene.compositing_node_group=None
   else:tree.links.new(coordinates.outputs['Uniform'],route.inputs[0])
   return result
  rotate._native_columns=changed
  try:extract('during-native-'+mutation,False,True)
  finally:rotate._native_columns=native;scene.compositing_node_group=tree
 for private_mutation in ['angle','delete-tree']:
  tree,node,sink=setup();state=rotate._carrier_state;checks=[0]
  def changed_carrier(tree,obj):
   checks[0]+=1
   if checks[0]==2:
    if private_mutation=='angle':next(n for n in tree.nodes if n.bl_idname=='ShaderNodeVectorRotate').inputs['Angle'].default_value=.5
    else:bpy.data.node_groups.remove(tree,do_unlink=True)
   return state(tree,obj)
  rotate._carrier_state=changed_carrier
  try:extract('private-carrier-'+private_mutation,False)
  finally:rotate._carrier_state=state
 assert calls[0]==0
 report={'status':'SCENETOWEB_COMPOSITOR_VECTOR_ROTATE_POLICY_PASSED','positives':positives,'refusals':refusals,'programs':programs,'gpuInitializations':0,'nativeRenders':0,'supportCredit':0}
 if '--'in sys.argv:Path(sys.argv[sys.argv.index('--')+1]).write_text(json.dumps(report,indent=2)+'\n')
 print(report['status'],len(positives),len(refusals))
finally:
 scene.compositing_node_group=original
 for tree in reversed(owned):bpy.data.node_groups.remove(tree,do_unlink=True)
