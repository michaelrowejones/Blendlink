# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires pinned Blender5.3 CPU static quaternion policy; full native/Final/browser family proof is separate.
# blendlink-headless-sentinel: BLENDLINK_STATIC_ROTATION_POLICY_PASSED
"""Actual source graph and private CPU-MF policy; no compositor render/GPU credit."""
from array import array
import json,struct,sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph,compositor_static_rotation as rotation,compositor_static_matrix as matrix
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL'
tree=bpy.data.node_groups.new('Owned Quaternion Policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
positive=[];refusals=[]
def setup(q=(1,0,0,0),all_outputs=False):
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');constructor=tree.nodes.new('FunctionNodeQuaternionToRotation');separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(constructor.outputs['Rotation'],separate.inputs['Rotation'])
 raw=array('f',q);constructor.inputs.foreach_set('default_value',raw)
 if all_outputs:
  color=tree.nodes.new('CompositorNodeCombineColor')
  for name,target in zip(rotation.COMPONENTS,color.inputs):tree.links.new(separate.outputs[name],target)
  tree.links.new(color.outputs[0],sink.inputs[0])
 else:tree.links.new(separate.outputs['W'],sink.inputs[0])
 return constructor,separate,sink

def extracted(label):
 before=matrix._ownership();program=compositor_graph.extract(scene);assert program['status']=='extracted',(label,program);assert before==matrix._ownership(),label
 records=program['compileTimeRotations'];assert records and max(r['nativeEvaluations']for r in records)<=2,(label,records);positive.append(label);return program

def refused(label):
 before=matrix._ownership();program=compositor_graph.extract(scene);assert program['status']=='unsupported',(label,program);assert before==matrix._ownership(),label
 assert any(r['code']=='unsupported-static-rotation'or r['code']=='animated-tree'for r in program['diagnostics']),(label,program);refusals.append(label)

for component in range(4):
 for sign in (-1,1):
  q=[0]*4;q[component]=sign;setup(q,True);program=extracted('signed-basis-'+str(component)+'-'+str(sign));records={r['output']:r['word']for r in program['compileTimeRotations']};expected=[0]*4;expected[component]=0xbf800000 if sign<0 else 0x3f800000;assert [records[n]for n in rotation.COMPONENTS]==expected,records
setup((0,0,0,0),True);program=extracted('zero-identity');assert [r['word']for r in program['compileTimeRotations']]==[0x3f800000,0,0,0]
# Stable cross-language IDs must not depend on Python/JavaScript float formatting.
for label,scale in (('scale-min',2**-16),('scale-max',4)):
 setup((scale,0,0,0),True);extracted(label)
# Raw invalid scalar words seeded/read without a promoted float getter.
for label,word in [('negative-zero',0x80000000),('subnormal',1),('infinity',0x7f800000),('nan',0x7fc00000),('below-bound',0x37000000),('above-bound',0x40a00000)]:
 constructor,separate,sink=setup();raw=array('f');raw.frombytes(struct.pack('=4I',0x3f800000,word,0,0));constructor.inputs.foreach_set('default_value',raw);refused(label)
constructor,separate,sink=setup();tree.links.remove(separate.inputs['Rotation'].links[0]);refused('unlinked-rotation-default')
constructor,separate,sink=setup();value=tree.nodes.new('ShaderNodeValue');tree.links.new(value.outputs['Value'],separate.inputs['Rotation']);refused('implicit-Float-Rotation')
constructor,separate,sink=setup();math=tree.nodes.new('ShaderNodeMath');tree.links.new(math.outputs[0],constructor.inputs['X']);refused('computed-component')
constructor,separate,sink=setup();next_q=tree.nodes.new('FunctionNodeQuaternionToRotation');next_sep=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(separate.outputs['W'],next_q.inputs['W']);tree.links.new(next_q.outputs['Rotation'],next_sep.inputs['Rotation']);tree.links.new(next_sep.outputs['W'],sink.inputs[0]);refused('recombined-components')
constructor,separate,sink=setup();scene.render.compositor_device='GPU';refused('GPU-source');scene.render.compositor_device='CPU'
constructor,separate,sink=setup();constructor.inputs['X'].keyframe_insert('default_value',frame=1);refused('animation');tree.animation_data_clear()
constructor,separate,sink=setup();constructor.mute=True;refused('no-typed-constructor-mute')
# Opaque linked Rotation through a real group/reroute.
constructor,separate,sink=setup((-.5,.5,.5,.5));group=bpy.data.node_groups.new('Owned Rotation Pass','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;reroute=tree.nodes.new('NodeReroute');tree.links.new(constructor.outputs[0],instance.inputs[0]);tree.links.new(instance.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],separate.inputs[0]);extracted('opaque-group-reroute')
# Typed selector and source branch/cache consistency.
constructor,separate,sink=setup();switch=tree.nodes.new('GeometryNodeSwitch');switch.input_type='FLOAT';switch.inputs['False'].default_value=0;switch.inputs['True'].default_value=.5;tree.links.new(switch.outputs[0],constructor.inputs['X']);extracted('static-scalar-literal-selector')
cache={};rotation.evaluate_output(separate.outputs['W'],scene,cache,select=compositor_graph.static_selection.static_selection);switch.inputs['Switch'].default_value=True
try:rotation.evaluate_output(separate.outputs['W'],scene,cache,select=compositor_graph.static_selection.static_selection);raise AssertionError('Changed selector was accepted')
except rotation.StaticRotationUnsupported as error:assert 'changed'in str(error)
refusals.append('changed-selector-cache')
constructor,separate,sink=setup();cache={};rotation.evaluate_output(separate.outputs['W'],scene,cache);constructor.inputs['W'].default_value=.5
try:rotation.evaluate_output(separate.outputs['W'],scene,cache);raise AssertionError('Changed source word was accepted')
except rotation.StaticRotationUnsupported as error:assert 'changed'in str(error)
refusals.append('changed-source-cache')
# Group defaults stay specific to each actual instance, with no global cache.
constructor,separate,sink=setup();group=bpy.data.node_groups.new('Owned Literal Quaternion Group','CompositorNodeTree');group.interface.new_socket(name='W',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');inside=group.nodes.new('FunctionNodeQuaternionToRotation');group.links.new(entry.outputs[0],inside.inputs['W']);group.links.new(inside.outputs[0],exit.inputs[0]);color=tree.nodes.new('CompositorNodeCombineColor');tree.links.new(color.outputs[0],sink.inputs[0])
for index,value in enumerate((.5,-.5)):
 instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=value;endpoint=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(instance.outputs[0],endpoint.inputs[0]);tree.links.new(endpoint.outputs['W'],color.inputs[index])
program=extracted('group-instance-literal-binding');assert [r['value']for r in program['compileTimeRotations']]==[1,-1]
# An actual child source may not bypass its compositor ancestry.
try:rotation.evaluate_output(inside.outputs[0],scene,{});raise AssertionError('Missing group ancestry accepted')
except rotation.StaticRotationUnsupported as error:assert 'ancestry'in str(error)
refusals.append('missing-source-ancestry')
# Cached reroutes retain their transitive resolver-hop height.
constructor,separate,sink=setup();value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=.25;tail=value.outputs[0]
for _ in range(7):
 reroute=tree.nodes.new('NodeReroute');tree.links.new(tail,reroute.inputs[0]);tail=reroute.outputs[0]
tree.links.new(tail,constructor.inputs['X']);evaluator=rotation._Evaluator(scene,None);evaluator.resolve(tail)
try:rotation.evaluate_output(separate.outputs['W'],scene,{'evaluator':evaluator});raise AssertionError('Cached source depth accepted')
except rotation.StaticRotationUnsupported as error:assert 'depth16'in str(error)
refusals.append('cached-source-depth')
# Matrix remains copy-only; a quaternion endpoint cannot become a matrix literal.
constructor,separate,sink=setup();combine=tree.nodes.new('FunctionNodeCombineMatrix');sep_matrix=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(separate.outputs['W'],combine.inputs[0]);tree.links.new(combine.outputs[0],sep_matrix.inputs[0]);tree.links.new(sep_matrix.outputs[0],sink.inputs[0]);program=compositor_graph.extract(scene);assert program['status']=='unsupported'and any(r['code']=='unsupported-static-matrix'for r in program['diagnostics']),program;refusals.append('no-quaternion-into-matrix')
print('BLENDLINK_STATIC_ROTATION_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'privateMFOnly':True,'compositorRenderCredit':0,'browserCredit':0}))
