# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned CPU default Noise source policy; no render/GPU/support credit.
# blendlink-headless-sentinel: SCENETOWEB_COMPOSITOR_NOISE_POLICY_PASSED
from pathlib import Path
import json,sys,copy
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_noise as noise,compositor_static_matrix as matrix
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100;scene.render.use_compositing=True
positive=[];refusals=[];owned=[]
def setup():
 scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.use_compositing=True;scene.render.use_border=False;scene.render.use_crop_to_border=False;scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1;scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
 tree=bpy.data.node_groups.new('Owned Noise policy','CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('ShaderNodeTexNoise');sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs['Color'],sink.inputs[0]);return tree,node,sink

def extract(label,accepted,*,external_mutation=False):
 before=matrix._ownership();users=[(g.as_pointer(),g.users)for g in bpy.data.node_groups];frame=(scene.frame_current,scene.frame_subframe)
 result=graph.extract(scene)
 after=matrix._ownership()
 if external_mutation:
  assert {k:[r[:2]for r in v]for k,v in before['ids'].items()}=={k:[r[:2]for r in v]for k,v in after['ids'].items()},label+' changed owned ID identities'
 else:assert before==after,label+' changed owned IDs'
 if not external_mutation:assert users==[(g.as_pointer(),g.users)for g in bpy.data.node_groups]and frame==(scene.frame_current,scene.frame_subframe),label+' changed source ownership/frame'
 assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  fields=[op for op in result['ops']if op['kind']=='noise-texture'];assert fields and all(op['properties']['noise_model']==noise.MODEL for op in fields)
  positive.append(label)
 else:
  assert any('noise'in row['code']or row['code']in {'animated-tree','muted-mapping','unsupported-static-matrix'}for row in result['diagnostics']),(label,result)
  refusals.append(label)
 return result

try:
 for precision in ['AUTO','FULL']:
  for output in ['Fac','Color']:
   tree,node,sink=setup();scene.render.compositor_precision=precision;tree.links.new(node.outputs[output],sink.inputs[0]);extract(precision+'-'+output,True)
 tree,node,sink=setup();node.inputs['Vector'].default_value=(9,-11,7);extract('implicit-ignores-stored-vector',True)
 for name in ['Vector',*noise.DEFAULTS]:
  tree,node,sink=setup()
  source=tree.nodes.new('FunctionNodeInputVector')if name=='Vector'else tree.nodes.new('ShaderNodeValue')
  link=tree.links.new(source.outputs[0],node.inputs[name]);extract('linked-'+name,False)
  link.is_muted=True;assert link.is_muted;extract('muted-link-'+name,False)
 for name in noise.DEFAULTS:
  tree,node,sink=setup();node.inputs[name].default_value=0 if name!='Distortion'else .5;extract('changed-'+name,False)
 for attr,value in [('noise_dimensions','3D'),('noise_dimensions','4D'),('noise_type','MULTIFRACTAL'),('normalize',False),('mute',True)]:
  tree,node,sink=setup();setattr(node,attr,value);extract('mode-'+attr+'-'+str(value),False)
 for attr,value in [('compositor_device','GPU'),('use_border',True),('use_crop_to_border',True),('pixel_aspect_y',2),('resolution_percentage',10),('resolution_y',8193)]:
  tree,node,sink=setup();setattr(scene.render,attr,value);extract('context-'+attr,False)
 tree,node,sink=setup();node.inputs['Scale'].keyframe_insert('default_value',frame=1);extract('animated',False);tree.animation_data_clear()
 # A whole field inside a native group/reroute retains its field context.
 tree,node,sink=setup();group=bpy.data.node_groups.new('Owned Noise nested','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Factor',in_out='OUTPUT',socket_type='NodeSocketFloat');inner=group.nodes.new('ShaderNodeTexNoise');out=group.nodes.new('NodeGroupOutput');group.links.new(inner.outputs['Fac'],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;reroute=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],sink.inputs[0]);extract('native-group-reroute-field',True)
 # A qualified approximate leaf must not feed unbounded pointwise consumers.
 for label,node_type,input_name,value in [('multiply-1024','ShaderNodeMath',None,1024.),('exposure-plus10','CompositorNodeExposure','Exposure',10.),('gamma-half','ShaderNodeGamma','Gamma',.5),('map-range-amplification','ShaderNodeMapRange','To Max',1024.)]:
  tree,node,sink=setup();consumer=tree.nodes.new(node_type)
  if node_type=='ShaderNodeMath':consumer.operation='MULTIPLY';consumer.inputs[1].default_value=value
  else:consumer.inputs[input_name].default_value=value
  tree.links.new(node.outputs['Fac'if node_type in {'ShaderNodeMath','ShaderNodeMapRange'}else'Color'],consumer.inputs[0]);tree.links.new(consumer.outputs[0],sink.inputs[0]);extract('composition-'+label,False)
 for label in ['swapped-channels','mean-quarter']:
  tree,node,sink=setup();combine=tree.nodes.new('CompositorNodeCombineColor');combine.mode='RGB';tree.links.new(combine.outputs[0],sink.inputs[0])
  if label=='swapped-channels':
   separate=tree.nodes.new('CompositorNodeSeparateColor');separate.mode='RGB';tree.links.new(node.outputs['Color'],separate.inputs[0]);tree.links.new(separate.outputs['Green'],combine.inputs[0]);tree.links.new(separate.outputs['Red'],combine.inputs[1]);tree.links.new(separate.outputs['Blue'],combine.inputs[2])
  else:
   add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';tree.links.new(node.outputs['Fac'],add.inputs[0]);other=tree.nodes.new('ShaderNodeTexNoise');tree.links.new(other.outputs['Fac'],add.inputs[1]);half=tree.nodes.new('ShaderNodeMath');half.operation='MULTIPLY';half.inputs[1].default_value=.25;tree.links.new(add.outputs[0],half.inputs[0]);tree.links.new(half.outputs[0],combine.inputs[0])
  extract('composition-'+label,False)
 # Real private CPU MF evaluation occurs after the contributing Noise branch;
 # it may invoke handlers, so root/group/route/default snapshots must close.
 for mode in ['unchanged','group-mute','reroute-relink','root','disabled','frame','scalar-default']:
  tree,node,sink=setup();combine=tree.nodes.new('CompositorNodeCombineColor');tree.links.new(combine.outputs[0],sink.inputs[0]);replacement=tree.nodes.new('ShaderNodeValue');replacement.outputs[0].default_value=.75
  field=node
  if mode=='group-mute':
   group=bpy.data.node_groups.new('Owned mutation group','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Factor',in_out='OUTPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Color',in_out='OUTPUT',socket_type='NodeSocketColor');inner=group.nodes.new('ShaderNodeTexNoise');out=group.nodes.new('NodeGroupOutput');group.links.new(inner.outputs['Fac'],out.inputs[0]);group.links.new(inner.outputs['Color'],out.inputs[1]);target=tree.nodes.new('CompositorNodeGroup');target.node_tree=group;tree.links.new(target.outputs[0],combine.inputs[0]);color=target.outputs[1]
  else:
   target=tree.nodes.new('NodeReroute');tree.links.new(node.outputs['Fac'],target.inputs[0]);tree.links.new(target.outputs[0],combine.inputs[0]);color=node.outputs['Color']
  separate=tree.nodes.new('CompositorNodeSeparateColor');separate.mode='RGB';tree.links.new(color,separate.inputs[0]);tree.links.new(separate.outputs['Green'],combine.inputs[1]);tree.links.new(separate.outputs['Blue'],combine.inputs[2])
  constructor=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(constructor.outputs[0],separate.inputs[0]);tree.links.new(separate.outputs[0],combine.inputs[3]);original=matrix._Evaluator.native;called=[];oldframe=scene.frame_current
  other=bpy.data.node_groups.new('Owned replacement root','CompositorNodeTree');owned.append(other)
  def changed(self,expression):
   value=original(self,expression);called.append(True)
   if mode=='group-mute':target.mute=True
   elif mode=='reroute-relink':tree.links.new(replacement.outputs[0],target.inputs[0])
   elif mode=='root':scene.compositing_node_group=other
   elif mode=='disabled':scene.render.use_compositing=False
   elif mode=='frame':scene.frame_current=oldframe+1
   elif mode=='scalar-default':node.inputs['Scale'].default_value=6
   return value
  matrix._Evaluator.native=changed
  try:
   result=extract('late-'+mode,mode=='unchanged',external_mutation=mode in {'root','disabled','frame'});assert called
   if mode=='unchanged':folded_program=copy.deepcopy(result)
  finally:matrix._Evaluator.native=original;scene.compositing_node_group=tree;scene.render.use_compositing=True;scene.frame_current=oldframe
 # Actual private-MF Alpha1 fold plus isolated malformed-IR controls. These
 # do not call the native evaluator again or claim extra native pixel cases.
 assert noise.validate_noise_graph(folded_program)is None
 literal=next(op for op in folded_program['ops']if op['kind']=='value')
 inline=copy.deepcopy(folded_program);inline['ops']=[op for op in inline['ops']if op['id']!=literal['id']];inline['ops'][-1]['inputs']['Alpha']['value']={'kind':'constant','type':'VALUE','value':1.}
 assert noise.validate_noise_graph(inline)is None
 for mode in ['zero','nan','extra-edge','unused-op','wrong-type']:
  program=copy.deepcopy(folded_program);value=next(op for op in program['ops']if op['kind']=='value')
  if mode=='zero':value['value']=0.
  elif mode=='nan':value['value']=float('nan')
  elif mode=='extra-edge':value['inputs']['extra']={'name':'extra','socketType':'VALUE','value':{'kind':'ref','node':value['id'],'type':'VALUE'}}
  elif mode=='unused-op':
   extra=copy.deepcopy(value);extra['id']='unreachable-literal';program['ops'].insert(-1,extra)
  else:program['ops'][-1]['inputs']['Alpha']['value']['type']='INT'
  assert noise.validate_noise_graph(program)is not None,mode
 print('SCENETOWEB_COMPOSITOR_NOISE_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'renders':0,'gpuInitializationCalls':0,'portCredit':0,'injectedTopologyControls':5}))
finally:
 scene.compositing_node_group=None
 for tree in reversed(owned):
  if tree.name in bpy.data.node_groups:bpy.data.node_groups.remove(tree,do_unlink=True)
