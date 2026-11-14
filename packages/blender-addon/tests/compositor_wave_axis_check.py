# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned Blender 5.3 no-render Wave axis source admission and ownership controls.
# blendlink-headless-sentinel: SCENETOWEB_COMPOSITOR_WAVE_AXIS_POLICY_PASSED
from pathlib import Path
from array import array
import json,struct,sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph as graph,compositor_wave_axis as wave,compositor_static_matrix as matrix
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
positive=[];refusals=[];owned=[]
def setup():
 tree=bpy.data.node_groups.new('Owned Wave policy','CompositorNodeTree');owned.append(tree);tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 node=tree.nodes.new('ShaderNodeTexWave');node.wave_profile='SAW';sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs['Color'],sink.inputs[0]);return tree,node,sink

def extract(label,accepted):
 before=matrix._ownership();users=[(g.as_pointer(),g.users) for g in bpy.data.node_groups];frame=(scene.frame_current,scene.frame_subframe)
 result=graph.extract(scene)
 assert before==matrix._ownership() and users==[(g.as_pointer(),g.users) for g in bpy.data.node_groups] and frame==(scene.frame_current,scene.frame_subframe),label+' changed source ownership'
 assert result['status']==('extracted' if accepted else 'unsupported'),(label,result)
 if accepted:positive.append(label)
 else:
  assert any('wave' in d['code'] or d['code']=='animated-tree' for d in result['diagnostics']),(label,result);refusals.append(label)
 return result
for axis in ['X','Y']:
 for profile in ['SAW','TRI']:
  for output in ['Color','Fac']:
   tree,node,sink=setup();node.bands_direction=axis;node.wave_profile=profile;tree.links.new(node.outputs[output],sink.inputs[0]);result=extract(axis+'-'+profile+'-'+output,True);op=result['ops'][-1]
   assert op['properties']['wave_axis_model']==wave.MODEL and op['properties']['wave_axis_parameter_words']==[0x40a00000,0,0] and 'Vector' not in op['inputs']
# Native Wave outputs declare no muted links. Inspect actual RNA rather than
# permitting a generic bypass to literalize the implicit Uniform Vector.
for output in ['Color','Fac']:
 tree,node,sink=setup();tree.links.new(node.outputs[output],sink.inputs[0]);node.mute=True
 bypass=[link for link in node.internal_links if link.to_socket==node.outputs[output]]
 result=graph.extract(scene)
 assert not bypass and result['status']=='unsupported',(output,[(link.from_socket.identifier,link.to_socket.identifier) for link in bypass],result)
 refusals.append('native-muted-'+output)
for value in [0.,2**-16,-(2**-16),8.,-8.,float(struct.unpack('=f',struct.pack('=f',.1))[0])]:
 tree,node,sink=setup();node.inputs['Scale'].default_value=value;node.inputs['Phase Offset'].default_value=value;extract('literal-'+str(len(positive)),True)
tree,node,sink=setup();node.inputs['Vector'].default_value=(.125,-.75,.5);node.inputs['Detail'].default_value=13;extract('ignored-vector-and-dead-detail',True)
# A whole Wave inside an explicit group stays a field. Instance/reroute output
# traversal does not reinterpret its own implicit Vector as an interface value.
root,node,sink=setup();group=bpy.data.node_groups.new('Owned Wave group','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');inside=group.nodes.new('ShaderNodeTexWave');inside.wave_profile='TRI';out=group.nodes.new('NodeGroupOutput');group.links.new(inside.outputs['Color'],out.inputs[0]);instance=root.nodes.new('CompositorNodeGroup');instance.node_tree=group;reroute=root.nodes.new('NodeReroute');root.links.new(instance.outputs[0],reroute.inputs[0]);root.links.new(reroute.outputs[0],sink.inputs[0]);extract('group-reroute-field',True)
instance2=root.nodes.new('CompositorNodeGroup');instance2.node_tree=group;mix=root.nodes.new('ShaderNodeMixRGB');root.links.new(instance.outputs[0],mix.inputs[1]);root.links.new(instance2.outputs[0],mix.inputs[2]);root.links.new(mix.outputs[0],sink.inputs[0]);result=extract('repeated-group-shared-key',True)
assert len([op for op in result['ops'] if op['kind']=='wave-texture'])==2 and len(wave.table_keys(result['ops']))==1
from compositor_mask_domains import validate_mask_presentation
for count in [7,8]:
 issue=validate_mask_presentation({'compositor':result,'display':{'ops':[{'type':'Lut3DTransform'} for _ in range(count)]}})
 assert (issue is None)==(count==7)
for label,change in [('default-SIN',lambda n:setattr(n,'wave_profile','SIN')),('rings',lambda n:setattr(n,'wave_type','RINGS')),('diagonal',lambda n:setattr(n,'bands_direction','DIAGONAL')),('distortion',lambda n:setattr(n.inputs['Distortion'],'default_value',.1)),('negative-zero',lambda n:setattr(n.inputs['Scale'],'default_value',-0.)),('below-minimum',lambda n:setattr(n.inputs['Scale'],'default_value',2**-17)),('above-maximum',lambda n:setattr(n.inputs['Phase Offset'],'default_value',8.5)),('mapping',lambda n:setattr(n.texture_mapping,'translation',(1,0,0)))]:
 tree,node,sink=setup();change(node);extract(label,False)
for identifier in ['Scale','Phase Offset','Distortion','Vector','Detail','Detail Scale','Detail Roughness']:
 tree,node,sink=setup();source=tree.nodes.new('ShaderNodeCombineXYZ' if identifier=='Vector' else 'ShaderNodeValue');tree.links.new(source.outputs[0],node.inputs[identifier]);extract('linked-'+identifier,False)
for label,change,restore in [('border',lambda:setattr(scene.render,'use_border',True),lambda:setattr(scene.render,'use_border',False)),('pixel-aspect',lambda:setattr(scene.render,'pixel_aspect_x',2),lambda:setattr(scene.render,'pixel_aspect_x',1)),('GPU',lambda:setattr(scene.render,'compositor_device','GPU'),lambda:setattr(scene.render,'compositor_device','CPU')),('small',lambda:setattr(scene.render,'resolution_percentage',10),lambda:setattr(scene.render,'resolution_percentage',100))]:
 tree,node,sink=setup();change();extract(label,False);restore()
for kind in ['CompositorNodeFlip','CompositorNodeBlur']:
 tree,node,sink=setup();spatial=tree.nodes.new(kind);image=next(s for s in spatial.inputs if s.identifier=='Image');tree.links.new(node.outputs['Color'],image);tree.links.new(spatial.outputs[0],sink.inputs[0]);extract('spatial-'+kind,False)
# Different output sockets/instances share a numeric key; distinct keys are
# bounded independently from the total number of source operations.
for label,count,distinct in [('nine-distinct-keys',9,True),('source-operation-limit',129,False)]:
 tree,node,sink=setup();leaves=[]
 for index in range(count):
  current=tree.nodes.new('ShaderNodeTexWave');current.wave_profile='SAW';current.inputs['Scale'].default_value=float(index if distinct else 0);leaves.append(current.outputs['Fac'])
 while len(leaves)>1:
  next_level=[]
  for index in range(0,len(leaves),2):
   if index+1==len(leaves):next_level.append(leaves[index]);continue
   add=tree.nodes.new('ShaderNodeMath');add.operation='ADD';tree.links.new(leaves[index],add.inputs[0]);tree.links.new(leaves[index+1],add.inputs[1]);next_level.append(add.outputs[0])
  leaves=next_level
 tree.links.new(leaves[0],sink.inputs[0]);extract(label,False)
tree,node,sink=setup();node.inputs['Scale'].keyframe_insert('default_value',frame=1);extract('animated',False);tree.animation_data_clear()
# A later private Matrix evaluation must not leave an earlier Wave literal stale.
tree,node,sink=setup();color=tree.nodes.new('CompositorNodeCombineColor');tree.links.new(node.outputs['Fac'],color.inputs[0]);constructor=tree.nodes.new('FunctionNodeCombineMatrix');constructor.inputs[0].default_value=1;separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(constructor.outputs[0],separate.inputs[0]);tree.links.new(separate.outputs[0],color.inputs[1]);tree.links.new(color.outputs[0],sink.inputs[0]);native=matrix._Evaluator.native;called=[]
def later(self,expression):
 result=native(self,expression);node.inputs['Scale'].default_value=6;called.append(True);return result
extract('cross-family-unchanged',True)
matrix._Evaluator.native=later
try:extract('cross-family-source-mutation',False);assert called
finally:matrix._Evaluator.native=native
# Reaching an inner Wave is not enough if a later family changes the route
# which made it contribute. Keep group/reroute provenance stable as well.
for mode in ['group-mute','reroute-relink']:
 tree,node,sink=setup();color=tree.nodes.new('CompositorNodeCombineColor');tree.links.new(color.outputs[0],sink.inputs[0]);replacement=tree.nodes.new('ShaderNodeValue');replacement.outputs[0].default_value=.75
 if mode=='group-mute':
  group=bpy.data.node_groups.new('Owned mutation group','CompositorNodeTree');owned.append(group);group.interface.new_socket(name='Factor',in_out='OUTPUT',socket_type='NodeSocketFloat');inner=group.nodes.new('ShaderNodeTexWave');inner.wave_profile='SAW';out=group.nodes.new('NodeGroupOutput');group.links.new(inner.outputs['Fac'],out.inputs[0]);target=tree.nodes.new('CompositorNodeGroup');target.node_tree=group;tree.links.new(target.outputs[0],color.inputs[0])
 else:
  target=tree.nodes.new('NodeReroute');tree.links.new(node.outputs['Fac'],target.inputs[0]);tree.links.new(target.outputs[0],color.inputs[0])
 constructor=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(constructor.outputs[0],separate.inputs[0]);tree.links.new(separate.outputs[0],color.inputs[1]);original=matrix._Evaluator.native
 def changed_route(self,expression):
  result=original(self,expression)
  if mode=='group-mute':target.mute=True
  else:tree.links.new(replacement.outputs[0],target.inputs[0])
  return result
 matrix._Evaluator.native=changed_route
 try:extract('cross-family-'+mode,False)
 finally:matrix._Evaluator.native=original
# Shared raw reader classification runs before Python promotion. Its generic
# native storage controls are qualified independently; this tests Wave's bounds.
for word in [0x80000000,1,0x7fc12345]:
 tree,node,sink=setup();original=wave._raw
 def raw(sockets,kind):return [(word,),(0,),(0,)]
 wave._raw=raw
 try:extract('injected-reader-word-'+hex(word),False)
 finally:wave._raw=original
print('SCENETOWEB_COMPOSITOR_WAVE_AXIS_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'nativeRenders':0,'gpuInitializations':0,'injectedReaderWordControls':3,'supportCredit':0}))
