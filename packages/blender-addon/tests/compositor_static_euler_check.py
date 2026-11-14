# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires pinned Blender5.3 CPU static Euler policy; full native/Final/browser family proof is separate.
# blendlink-headless-sentinel: BLENDLINK_STATIC_EULER_POLICY_PASSED
"""Source admission/cache/typed router and native hash guard policy; no render credit."""
from array import array
import bpy,json,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph,compositor_static_euler as euler,compositor_static_rotation as rotation,compositor_static_matrix as matrix
scene=bpy.context.scene;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL'
tree=bpy.data.node_groups.new('Owned Euler Policy','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree;positive=[];refusals=[]
def words(values):return list(struct.unpack('='+str(len(values))+'I',values.tobytes()))
def raw(items):
 result=array('f');result.frombytes(struct.pack('='+str(len(items))+'I',*items));return result
def setup(angles=(0,0,0),input_words=None):
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');constructor=tree.nodes.new('FunctionNodeEulerToRotation');separate=tree.nodes.new('FunctionNodeRotationToQuaternion');color=tree.nodes.new('CompositorNodeCombineColor');color.inputs[3].default_value=1
 constructor.inputs.foreach_set('default_value',raw(input_words)if input_words is not None else array('f',angles));tree.links.new(constructor.outputs[0],separate.inputs[0])
 for name,target in zip(euler.COMPONENTS[:3],color.inputs):tree.links.new(separate.outputs[name],target)
 tree.links.new(color.outputs[0],sink.inputs[0]);return constructor,separate,sink,color

def extracted(label):
 before=matrix._ownership();program=compositor_graph.extract(scene);assert program['status']=='extracted',(label,program);assert before==matrix._ownership();records=program['compileTimeRotations'];assert len(records)==3 and all(r['model']==euler.MODEL and r['preFloatStoreHashGuard']and r['nativeEvaluations']==1 for r in records);assert program['ops']and all(op['kind']in {'value','combine-color'}for op in program['ops']);positive.append(label);return program

def refused(label):
 before=matrix._ownership();program=compositor_graph.extract(scene);assert program['status']=='unsupported',(label,program);assert before==matrix._ownership();assert any(r['code']in {'unsupported-static-rotation','animated-tree'}for r in program['diagnostics']),(label,program);refusals.append(label)

setup();program=extracted('zero-identity');assert [r['word']for r in program['compileTimeRotations']]==[0x3f800000,0,0]
for label,angles in [('axis-min',(2**-16,0,0)),('axis-next-min',(struct.unpack('=f',struct.pack('=I',0x37800001))[0],0,0)),('axis-max',(0,0,1)),('asymmetric',(.1,.2,.3)),('all-min',(2**-16,)*3),('all-max',(1,1,1)),('symmetric',(.5,.5,.5)),('zero-x',(0,.5,.75)),('mixed-min',(2**-16,1,.1))]:setup(angles);extracted(label)
constructor,separate,sink,color=setup((.1,.2,.3));group=bpy.data.node_groups.new('Owned Euler Opaque Group','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;reroute=tree.nodes.new('NodeReroute');tree.links.new(constructor.outputs[0],instance.inputs[0]);tree.links.new(instance.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],separate.inputs[0]);extracted('opaque-group-reroute')
for label,word in [('negative-zero',0x80000000),('positive-subnormal',1),('negative-subnormal',0x80000001),('nonfinite',0x7f800000),('nan',0x7fc00000),('negative-angle',0xbdcccccd),('below-min',0x377fffff),('above-max',0x3f800001)]:setup(input_words=[word,0,0]);refused(label)
constructor,separate,sink,color=setup();value=tree.nodes.new('FunctionNodeInputVector');value.vector=(.1,.2,.3);tree.links.new(value.outputs[0],constructor.inputs[0]);refused('linked-vector-literal')
constructor,separate,sink,color=setup();combine=tree.nodes.new('ShaderNodeCombineXYZ');tree.links.new(combine.outputs[0],constructor.inputs[0]);refused('computed-vector')
constructor,separate,sink,color=setup();other=tree.nodes.new('FunctionNodeInputRotation');tree.links.new(other.outputs[0],separate.inputs[0]);refused('input-rotation-unsafe-reader')
constructor,separate,sink,color=setup();tree.links.remove(separate.inputs[0].links[0]);refused('unlinked-rotation-default')
constructor,separate,sink,color=setup();constructor.mute=True;refused('muted-euler')
constructor,separate,sink,color=setup();scene.render.compositor_device='GPU';refused('GPU-source');scene.render.compositor_device='CPU'
constructor,separate,sink,color=setup();constructor.inputs[0].keyframe_insert('default_value',frame=1);refused('animation');tree.animation_data_clear()
constructor,separate,sink,color=setup((.1,.2,.3));cache={};euler.evaluate_output(separate.outputs['W'],scene,cache);constructor.inputs.foreach_set('default_value',array('f',(.2,.2,.3)))
try:euler.evaluate_output(separate.outputs['W'],scene,cache);raise AssertionError('Changed Euler vector accepted')
except euler.StaticEulerUnsupported as error:assert 'changed'in str(error)
refusals.append('changed-euler-raw-cache')
constructor,separate,sink,color=setup((.1,.2,.3));cache={};original=euler._hash_word;euler._hash_word=lambda word:original(word)^1;before=matrix._ownership()
try:
 try:euler.evaluate_output(separate.outputs['W'],scene,cache);raise AssertionError('Bad pre-store hash guard accepted')
 except euler.StaticEulerUnsupported as error:assert 'hash guard'in str(error)
 assert before==matrix._ownership()and not cache['evaluator'].results
finally:euler._hash_word=original
refusals.append('hash-guard-no-cache-commit')
# Only the explicit typed producer signal selects Euler. Every old-route failure
# (including budget/native/source errors) remains a hard refusal.
for label,message in [('old-native-hard-error','Static Quaternion private evaluation changed source/context ownership'),('old-budget-hard-error','Static Quaternion exceeds16 evaluated islands per extraction'),('old-source-hard-error','Static Quaternion source Float storage changed during extraction')]:
 constructor,separate,sink,color=setup();original_q=rotation.evaluate_output;original_e=euler.evaluate_output;calls=[]
 def hard(*args,**kwargs):raise rotation.StaticRotationUnsupported(message)
 def forbidden(*args,**kwargs):calls.append(True);raise AssertionError('Hard old-route refusal fell through to Euler')
 rotation.evaluate_output=hard;euler.evaluate_output=forbidden
 try:refused(label);assert not calls
 finally:rotation.evaluate_output=original_q;euler.evaluate_output=original_e
# Q path/model remains exact and cannot be evaluated under Euler's profile.
constructor,separate,sink,color=setup();q=tree.nodes.new('FunctionNodeQuaternionToRotation');q.inputs['W'].default_value=-1;tree.links.new(q.outputs[0],separate.inputs[0]);program=compositor_graph.extract(scene);assert program['status']=='extracted'and all(r['model']==rotation.MODEL for r in program['compileTimeRotations'])
try:euler.evaluate_output(separate.outputs['W'],scene,{});raise AssertionError('Q producer entered Euler evaluator')
except euler.NotEulerRoute:pass
refusals.append('quaternion-profile-separate')
# Interleave distinct private families: later MF work changes an earlier
# already-emitted literal. Only the final whole-extraction snapshot closes this.
for first,later in [('quaternion','matrix'),('matrix','euler'),('euler','quaternion')]:
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');color=tree.nodes.new('CompositorNodeCombineColor');color.inputs[3].default_value=1;tree.links.new(color.outputs[0],sink.inputs[0]);earlier=None
 def family(kind):
  if kind=='matrix':
   c=tree.nodes.new('FunctionNodeCombineMatrix');c.inputs[0].default_value=1;s=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(c.outputs[0],s.inputs[0]);return c,s.outputs[0],matrix._Evaluator
  c=tree.nodes.new('FunctionNodeQuaternionToRotation'if kind=='quaternion'else'FunctionNodeEulerToRotation');s=tree.nodes.new('FunctionNodeRotationToQuaternion')
  if kind=='quaternion':c.inputs['W'].default_value=1
  else:c.inputs.foreach_set('default_value',array('f',(.1,.2,.3)))
  tree.links.new(c.outputs[0],s.inputs[0]);return c,s.outputs['W'],rotation._Evaluator if kind=='quaternion'else euler._Evaluator
 earlier,first_output,_=family(first);_,later_output,klass=family(later);tree.links.new(first_output,color.inputs[0]);tree.links.new(later_output,color.inputs[1]);original_native=klass.native;called=[]
 def mutate_after_private(self,expression):
  result=original_native(self,expression);called.append(True)
  if first=='euler':earlier.inputs.foreach_set('default_value',array('f',(.2,.2,.3)))
  elif first=='matrix':earlier.inputs[0].default_value=.5
  else:earlier.inputs['W'].default_value=.5
  return result
 klass.native=mutate_after_private
 try:
  program=compositor_graph.extract(scene);assert called and program['status']=='unsupported',(first,later,program);assert any(d['code']=='static-island-source-changed'and 'changed'in d['message']for d in program['diagnostics']),program
 finally:klass.native=original_native
 refusals.append('interleave-'+first+'-then-'+later)
assert euler._hash_word(0)!=euler._hash_word(0x80000000)
print('BLENDLINK_STATIC_EULER_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'compositorRenderCredit':0,'browserCredit':0,'inputRotationAdmitted':False}))
