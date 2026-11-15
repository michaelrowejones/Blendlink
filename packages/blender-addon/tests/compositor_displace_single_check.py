# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned Blender 5.3 Displace candidate source admission; no rendering or GPU work.
# blendlink-headless-sentinel: SCENETOWEB_DISPLACE_SINGLE_SOURCE_POLICY_PASSED
from pathlib import Path
from array import array
import json,struct,sys
import bpy,gpu
# Actual source policy forbids GPU initialization and render operators. Prove
# both guards first, then reset counters before any source extraction.
blocked={'gpu':0,'render':0}
def no_gpu(*args,**kwargs):
 blocked['gpu']+=1;raise RuntimeError('Displace source policy forbids gpu.init')
gpu.init=no_gpu
original_ops=bpy.ops
class RenderGuard:
 def __getattr__(self,name):
  def denied(*args,**kwargs):
   blocked['render']+=1;raise RuntimeError('Displace source policy forbids render operators')
  return denied
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(original_ops,name)
bpy.ops=OpsGuard()
for label,action in [('gpu',gpu.init),('render',bpy.ops.render.render)]:
 try:action()
 except RuntimeError as error:assert 'Displace source policy forbids'in str(error)
 else:raise AssertionError('Forbidden call was not blocked: '+label)
assert blocked=={'gpu':1,'render':1};blocked={'gpu':0,'render':0}
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
positive=[];refusals=[];omissions=[]
def setup(field=True):
 tree=bpy.data.node_groups.new('Owned Displace source','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('CompositorNodeDisplace');sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs['Image'],sink.inputs[0])
 if field:
  image=tree.nodes.new('CompositorNodeRLayers');tree.links.new(image.outputs['Image'],node.inputs['Image'])
 return tree,node,sink

def check(label,accepted):
 before=[(g.as_pointer(),g.users)for g in bpy.data.node_groups];frame=(scene.frame_current,scene.frame_subframe)
 result=compositor_graph.extract(scene)
 assert before==[(g.as_pointer(),g.users)for g in bpy.data.node_groups]and frame==(scene.frame_current,scene.frame_subframe),(label,'changed source ownership')
 assert result['status']==('extracted'if accepted else'unsupported'),(label,result)
 if accepted:
  positive.append(label);op=next(op for op in result['ops']if op['source']['nodeType']=='CompositorNodeDisplace');assert op['kind']=='translate'and op['properties']['displace_model']=='native-displace-single-domain-cpu-53-v1'
 else:
  refusals.append(label);assert any('displace'in d['code']or d['code']=='animated-tree'for d in result['diagnostics']),(label,result)
 return result
for field in [False,True]:
 for mode in ['Nearest','Bilinear']:
  for values in [(0,0),(.25,-.5),(8192,-8192),(2**-16,-2**-16)]:
   tree,node,sink=setup(field);node.inputs['Interpolation'].default_value=mode;node.inputs['Displacement'].default_value=values;stored=array('f',[0,0]);node.inputs['Displacement'].default_value.foreach_get(stored);assert stored.tobytes()==struct.pack('=2f',*values);check(('field'if field else'constant')+'-'+mode+'-'+str(len(positive)),True)
# Actual native whole-node group/reroute and constant RGB paths.
tree,node,sink=setup();route=tree.nodes.new('NodeReroute');tree.links.new(node.outputs[0],route.inputs[0]);tree.links.new(route.outputs[0],sink.inputs[0]);check('rerouted-output',True)
tree,node,sink=setup(False);rgb=tree.nodes.new('CompositorNodeRGB');rgb.outputs[0].default_value=(.125,.25,.5,1);tree.links.new(rgb.outputs[0],node.inputs['Image']);check('native-RGB-copy',True)
tree,unused,sink=setup(False);group=bpy.data.node_groups.new('Owned inner Displace','CompositorNodeTree');group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');inner=group.nodes.new('CompositorNodeDisplace');inner.inputs['Displacement'].default_value=(.25,-.5);image=group.nodes.new('CompositorNodeRLayers');end=group.nodes.new('NodeGroupOutput');group.links.new(image.outputs['Image'],inner.inputs['Image']);group.links.new(inner.outputs[0],end.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs[0],sink.inputs[0]);check('whole-node-group',True)
for word in [0x80000000,1,0x7fffff,0x7fc12345]:
 tree,node,sink=setup();stored=array('f');stored.frombytes(struct.pack('=2I',word,0));node.inputs['Displacement'].default_value.foreach_set(stored)
 actual=array('f',[0,0]);node.inputs['Displacement'].default_value.foreach_get(actual);assert struct.unpack('=2I',actual.tobytes())[0]==word
 check('raw-word-'+hex(word),False)
for identifier,value in [('Interpolation','Bicubic'),('Interpolation','Anisotropic'),('Extension X','Repeat'),('Extension Y','Extend')]:
 tree,node,sink=setup();node.inputs[identifier].default_value=value;check('menu-'+identifier+'-'+value,False)
tree,node,sink=setup();vector=tree.nodes.new('ShaderNodeCombineXYZ');tree.links.new(vector.outputs[0],node.inputs['Displacement']);check('linked-displacement',False)
tree,node,sink=setup();node.inputs['Displacement'].default_value=(2**-17,0);check('below-minimum',False)
tree,node,sink=setup();node.inputs['Displacement'].default_value=(8193,0);check('above-maximum',False)
tree,node,sink=setup();extra=tree.nodes.new('CompositorNodeTranslate');tree.links.new(node.outputs[0],extra.inputs['Image']);tree.links.new(extra.outputs[0],sink.inputs[0]);check('downstream-transform',False)
tree,node,sink=setup();scene.render.compositor_device='GPU';check('GPU-authoring',False);scene.render.compositor_device='CPU'
tree,node,sink=setup();scene.render.resolution_x=8192;scene.render.resolution_y=8192;check('pixel-budget',False);scene.render.resolution_x=13;scene.render.resolution_y=9
tree,node,sink=setup();scene.render.use_compositing=False;disabled=compositor_graph.extract(scene);assert disabled['status']=='disabled'and not disabled['ops'];omissions.append('disabled-root');scene.render.use_compositing=True
for menu,setting in [('Interpolation','Nearest'),('Extension X','Repeat'),('Extension Y','Extend')]:
 tree,node,sink=setup();original=compositor_graph.displace_single.normalize
 def changed(*args,**kwargs):
  result=original(*args,**kwargs);node.inputs[menu].default_value=setting;return result
 compositor_graph.displace_single.normalize=changed
 try:check('late-menu-'+menu,False)
 finally:compositor_graph.displace_single.normalize=original
# Only the shared used-field topology guard can detect a later route mutation;
# the Displace node's own raw words and direct inputs remain unchanged.
for mode in ['group-mute','reroute-relink']:
 tree,node,sink=setup();replacement=tree.nodes.new('CompositorNodeRGB')
 if mode=='group-mute':
  group=bpy.data.node_groups.new('Owned late group','CompositorNodeTree');group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');inside=group.nodes.new('CompositorNodeDisplace');source=group.nodes.new('CompositorNodeRLayers');end=group.nodes.new('NodeGroupOutput');group.links.new(source.outputs['Image'],inside.inputs['Image']);group.links.new(inside.outputs[0],end.inputs[0]);target=tree.nodes.new('CompositorNodeGroup');target.node_tree=group;tree.links.new(target.outputs[0],sink.inputs[0])
 else:
  target=tree.nodes.new('NodeReroute');tree.links.new(node.outputs[0],target.inputs[0]);tree.links.new(target.outputs[0],sink.inputs[0])
 original=compositor_graph.displace_single.normalize
 def changed_route(*args,**kwargs):
  result=original(*args,**kwargs)
  if mode=='group-mute':target.mute=True
  else:tree.links.new(replacement.outputs[0],target.inputs[0])
  return result
 compositor_graph.displace_single.normalize=changed_route
 try:check('late-'+mode,False)
 finally:compositor_graph.displace_single.normalize=original
tree,node,sink=setup();node.inputs['Displacement'].keyframe_insert('default_value',frame=1);check('animated-source',False)
assert blocked=={'gpu':0,'render':0},blocked
print('SCENETOWEB_DISPLACE_SINGLE_SOURCE_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'omissions':omissions,'nativeRenders':0,'gpuInitializations':0,'supportCredit':0,'guardsProved':['gpu.init','render-operator-call'],'blockedPolicyCalls':blocked}))
