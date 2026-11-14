# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native source schemas and no-render static Matrix source policy."""
import bpy,sys,json,struct,os
from array import array
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
import compositor_graph,compositor_static_matrix as matrix
scene=bpy.context.scene;scene.render.use_compositing=True;scene.render.compositor_device='CPU'
original=scene.compositing_node_group
schema=[];positives=[];refusals=[]
def build(name='Source Matrix'):
 tree=bpy.data.node_groups.new(name,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');output=tree.nodes.new('NodeGroupOutput');combine=tree.nodes.new('FunctionNodeCombineMatrix');transpose=tree.nodes.new('FunctionNodeTransposeMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix')
 for index,label in enumerate(matrix.COLUMNS):combine.inputs[label].default_value=(index+1)/16
 tree.links.new(combine.outputs['Matrix'],transpose.inputs['Matrix']);tree.links.new(transpose.outputs['Matrix'],separate.inputs['Matrix']);tree.links.new(separate.outputs[0],output.inputs[0]);scene.compositing_node_group=tree
 return tree,combine,transpose,separate

def extract(tree):scene.compositing_node_group=tree;return compositor_graph.extract(scene)
try:
 for domain in ['CompositorNodeTree','GeometryNodeTree']:
  tree=bpy.data.node_groups.new('Owned schema '+domain,domain)
  for kind in sorted(matrix.NODES):
   node=tree.nodes.new(kind);schema.append({'domain':domain,'nodeType':kind,'inputs':[(s.identifier,s.type)for s in node.inputs],'outputs':[(s.identifier,s.type)for s in node.outputs]})
  bpy.data.node_groups.remove(tree)
 tree,combine,transpose,separate=build();cache={}
 before=matrix._ownership()
 for i,socket in enumerate(separate.outputs):
  record=matrix.evaluate_output(socket,scene,cache,select=compositor_graph.static_selection.static_selection);expected=((i%4)*4+i//4+1)/16
  assert record['value']==expected,(i,record,expected)
 assert cache['evaluator'].native_evaluations==1 and before==matrix._ownership()
 result=extract(tree);assert result['status']=='extracted',result;assert result['ops'][0]['kind']=='value'and result['ops'][0]['source']['nodeType']=='FunctionNodeSeparateMatrix';assert result['ops'][0]['value']==1/16
 assert all(row['matrixRuntimeTransport']is False for row in result['compileTimeMatrices']);positives.append('all16-one-native-island-and-existing-value-op')
 # A second extraction must own a fresh evaluator and reread changed literals.
 combine.inputs[0].default_value=.75;fresh=extract(tree);assert fresh['ops'][0]['value']==.75;positives.append('fresh-extraction-no-global-cache')
 for label,change in [('gpu',lambda:setattr(scene.render,'compositor_device','GPU')),('negative-zero',lambda:setattr(combine.inputs[0],'default_value',-0.0)),('arithmetic',lambda:tree.links.new(tree.nodes.new('ShaderNodeMath').outputs[0],combine.inputs[0])),('unlinked-matrix',lambda:tree.links.remove(separate.inputs['Matrix'].links[0])),('animated',lambda:combine.inputs[0].keyframe_insert('default_value',frame=1))]:
  scene.render.compositor_device='CPU';node_tree,c,t,s=build('Refusal '+label);tree,combine,transpose,separate=node_tree,c,t,s;change();result=extract(tree);assert result['status']=='unsupported',(label,result);assert any(d['code']in{'unsupported-static-matrix','animated-tree'}for d in result['diagnostics']);refusals.append(label)
  if tree.animation_data:tree.animation_data_clear()
 scene.render.compositor_device='CPU'
 # The bit predicate is checked before scalar promotion. RNA setters may flush
 # subnormals, so those storage exclusions are calibrated independently.
 for word in [0x80000000,1,0x007fffff,0x80000001,0x7f800000,0x7fc00000]:assert not matrix._normal_word(word),hex(word)
 for word in [0,0x00800000,0x80800000,0x3dcccccd,0x7f7fffff,0xff7fffff]:assert matrix._normal_word(word),hex(word)
 positives.append('raw-word-domain-pre-promotion')
 # Reusing a cache after an authored source edit must refuse, not silently
 # return the previously evaluated endpoint.
 tree,combine,transpose,separate=build('Cache mutation');cache={}
 matrix.evaluate_output(separate.outputs[0],scene,cache)
 combine.inputs[0].default_value=.875
 try:matrix.evaluate_output(separate.outputs[0],scene,cache);raise AssertionError('stale scalar cache accepted')
 except matrix.StaticMatrixUnsupported as error:assert 'changed' in str(error)
 refusals.append('same-extraction-source-mutation')
 tree,combine,transpose,separate=build('Depth bound');previous=combine.outputs[0]
 for _ in range(20):
  extra=tree.nodes.new('FunctionNodeTransposeMatrix');tree.links.new(previous,extra.inputs[0]);previous=extra.outputs[0]
 tree.links.new(previous,separate.inputs[0])
 result=extract(tree);assert result['status']=='unsupported'and any('depth16'in d['message']for d in result['diagnostics']),result
 refusals.append('source-depth-limit')
 # Native mute bypass is respected rather than applying a muted transpose.
 tree,combine,transpose,separate=build('Muted transpose');transpose.mute=True
 assert matrix.evaluate_output(separate.outputs[1],scene,{})['value']==2/16
 positives.append('actual-muted-typed-bypass')
 # Nested copy islands preserve component recipes without per-component
 # depsgraph evaluation or replacing native Separate/Combine operations.
 tree,combine,transpose,separate=build('Nested copy island');outer_combine=tree.nodes.new('FunctionNodeCombineMatrix');outer_separate=tree.nodes.new('FunctionNodeSeparateMatrix')
 for source,target in zip(separate.outputs,outer_combine.inputs):tree.links.new(source,target)
 tree.links.new(outer_combine.outputs[0],outer_separate.inputs[0]);cache={}
 for index,socket in enumerate(outer_separate.outputs):assert matrix.evaluate_output(socket,scene,cache)['value']==((index%4)*4+index//4+1)/16
 assert cache['evaluator'].native_evaluations==1
 positives.append('nested-combine-separate-copy-island')
 # Adversarial copied/recombined DAG: every Combine references16 distinct
 # components of its predecessor. Twenty actual Matrix nodes remain below the
 # source-node budget, but old nested tuples rehashed shared descendants16^L.
 tree=bpy.data.node_groups.new('Adversarial shared Matrix DAG','CompositorNodeTree');scene.compositing_node_group=tree;separates=[]
 for layer in range(10):
  combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(combine.outputs[0],separate.inputs[0])
  if separates:
   for source,target in zip(separates[-1].outputs,combine.inputs):tree.links.new(source,target)
  separates.append(separate)
 evaluator=matrix._Evaluator(scene,None);cache={'evaluator':evaluator}
 evaluator.resolve(separates[0].outputs[0]);evaluator.resolve(separates[3].outputs[0])
 assert len(evaluator.recipes)<128 and max(evaluator.recipe_heights)<=16
 def no_native(_):raise AssertionError('Over-depth DAG reached private native evaluation')
 evaluator.native=no_native
 try:matrix.evaluate_output(separates[6].outputs[0],scene,cache);raise AssertionError('Cached full source depth was bypassed')
 except matrix.StaticMatrixUnsupported as error:assert 'including cached subtree'in str(error),str(error)
 assert evaluator.native_evaluations==0
 # Exercise the actual compositor caller's natural RGB endpoint order too.
 tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');exit=tree.nodes.new('NodeGroupOutput');color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';tree.links.new(color.outputs[0],exit.inputs[0])
 for source,target in zip([separates[i].outputs[0]for i in [0,3,6]],list(color.inputs)[:3]):tree.links.new(source,target)
 rejected=extract(tree);assert rejected['status']=='unsupported'and any(d['code']=='unsupported-static-matrix'and'including cached subtree'in d['message']for d in rejected['diagnostics']),rejected
 refusals.append('cached-source-subtree-depth')
 # Source-hop depth also includes reroute edges that create NO recipe nodes.
 tree,combine,transpose,separate=build('Cached reroute source depth');value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=.25;source=value.outputs[0]
 for _ in range(7):
  reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
 tree.links.new(source,combine.inputs[0]);evaluator=matrix._Evaluator(scene,None);evaluator.resolve(source);evaluator.native=no_native
 try:matrix.evaluate_output(separate.outputs[0],scene,{'evaluator':evaluator});raise AssertionError('Cached reroute depth was bypassed')
 except matrix.StaticMatrixUnsupported as error:assert 'including cached subtree'in str(error),str(error)
 assert evaluator.native_evaluations==0
 refusals.append('cached-source-route-depth')
 # Instrument a literal word independently: constructing/looking up higher
 # shared recipes must never hash descendants again. No huge DAG is attempted.
 class HashWord(int):
  calls=0
  def __hash__(self):HashWord.calls+=1;return super().__hash__()
 flat=matrix._Evaluator(scene,None);leaf=flat.recipe('float',HashWord(0x3e800000));children=(leaf,)*16;HashWord.calls=0
 for _ in range(4):
  root=flat.recipe('combine',children);children=tuple(flat.recipe('component',root,index)for index in range(16));flat.results[root]=tuple(range(16));assert flat.results[root][0]==0
 assert HashWord.calls==0 and len(flat.recipes)==69
 try:
  for _ in range(5):
   root=flat.recipe('combine',children);children=tuple(flat.recipe('component',root,index)for index in range(16))
  raise AssertionError('Flat recipe height budget bypassed')
 except matrix.StaticMatrixUnsupported as error:assert 'flat recipe depth16'in str(error),str(error)
 assert HashWord.calls==0 and max(flat.recipe_heights)<=16
 positives.append('flat-DAG-hash-work-independent-of-descendants')
 # A broad shallow source can exceed64 nodes without exceeding depth16;
 # equal literal values/recipe interning must not erase authored source cost.
 tree=bpy.data.node_groups.new('Broad source Matrix budget','CompositorNodeTree');scene.compositing_node_group=tree;outer=tree.nodes.new('FunctionNodeCombineMatrix');terminal=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(outer.outputs[0],terminal.inputs[0])
 for branch in range(4):
  combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(combine.outputs[0],separate.inputs[0])
  for target in combine.inputs:
   value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=.25;tree.links.new(value.outputs[0],target)
  for index in range(4):tree.links.new(separate.outputs[index],outer.inputs[branch*4+index])
 evaluator=matrix._Evaluator(scene,None);evaluator.native=no_native
 try:matrix.evaluate_output(terminal.outputs[0],scene,{'evaluator':evaluator});raise AssertionError('Broad source node budget bypassed')
 except matrix.StaticMatrixUnsupported as error:assert 'exceeds64'in str(error),str(error)
 assert evaluator.native_evaluations==0
 refusals.append('broad-source-node-budget')
 # Linked source group binding must stay instance-specific, not a cached group definition.
 group=bpy.data.node_groups.new('Bound Matrix source','CompositorNodeTree');group.interface.new_socket(name='Number',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Matrix',in_out='OUTPUT',socket_type='NodeSocketMatrix');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');combine=group.nodes.new('FunctionNodeCombineMatrix');group.links.new(entry.outputs[0],combine.inputs[0]);group.links.new(combine.outputs[0],out.inputs[0])
 tree=bpy.data.node_groups.new('Bound Matrix instances','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');terminal=tree.nodes.new('NodeGroupOutput');cache={}
 for value in [.25,.75]:
  instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=value;reroute=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],reroute.inputs[0]);separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(reroute.outputs[0],separate.inputs[0]);scene.compositing_node_group=tree
  record=matrix.evaluate_output(separate.outputs[0],scene,cache,select=compositor_graph.static_selection.static_selection);assert record['value']==value
 assert cache['evaluator'].native_evaluations==2;positives.append('group-instance-and-matrix-reroute-binding')
 # foreach_set preserves raw source words without scalar RNA setter flushing.
 # No init_socket, FPU mutation or output normalization is involved.
 for word in [0x80000000,1,0x80000001]:
  raw=array('f');raw.frombytes(struct.pack('=I',word));instance.inputs.foreach_set('default_value',raw)
  stored=array('f',[0]);instance.inputs.foreach_get('default_value',stored);assert stored.tobytes()==raw.tobytes(),(hex(word),stored.tobytes().hex(),raw.tobytes().hex())
  try:matrix.evaluate_output(separate.outputs[0],scene,{});raise AssertionError('raw invalid source accepted '+hex(word))
  except matrix.StaticMatrixUnsupported as error:assert 'normal Float32'in str(error)
 refusals.append('raw-nonnormal-stored-inputs')
 # Opaque matrices can cross a group input/output; no runtime Matrix is emitted.
 passthrough=bpy.data.node_groups.new('Matrix passthrough','CompositorNodeTree');passthrough.interface.new_socket(name='Matrix',in_out='INPUT',socket_type='NodeSocketMatrix');passthrough.interface.new_socket(name='Matrix',in_out='OUTPUT',socket_type='NodeSocketMatrix');pentry=passthrough.nodes.new('NodeGroupInput');pout=passthrough.nodes.new('NodeGroupOutput');passthrough.links.new(pentry.outputs[0],pout.inputs[0])
 tree,combine,transpose,separate=build('Matrix group boundary');instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=passthrough;tree.links.new(transpose.outputs[0],instance.inputs[0]);tree.links.new(instance.outputs[0],separate.inputs[0])
 assert matrix.evaluate_output(separate.outputs[1],scene,{})['value']==5/16
 positives.append('opaque-matrix-group-binding')
 # Even a literal island with NO GroupInput dependency must retain its original
 # initial instance chain throughout private evaluation.
 inner,combine,transpose,separate=build('Literal island inside group')
 outer=bpy.data.node_groups.new('Initial source binding','CompositorNodeTree');outer.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');outer_exit=outer.nodes.new('NodeGroupOutput');instance=outer.nodes.new('CompositorNodeGroup');instance.node_tree=inner;outer.links.new(instance.outputs[0],outer_exit.inputs[0]);scene.compositing_node_group=outer
 cache={};evaluator=matrix._Evaluator(scene,None);cache['evaluator']=evaluator;native=evaluator.native
 replacement=bpy.data.node_groups.new('Changed literal island','CompositorNodeTree');replacement.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
 def changed_binding(recipe):
  words=native(recipe);instance.node_tree=replacement;return words
 evaluator.native=changed_binding
 try:
  try:matrix.evaluate_output(separate.outputs[0],scene,cache,(instance,));raise AssertionError('stale initial instance binding accepted')
  except matrix.StaticMatrixUnsupported as error:assert 'changed' in str(error),str(error)
 finally:instance.node_tree=inner
 refusals.append('same-extraction-initial-group-binding-mutation')
finally:scene.compositing_node_group=original
report={'status':'STATIC_MATRIX_SOURCE_POLICY_PASSED','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'schemas':schema,'positives':positives,'refusals':refusals,'gpuInitializationCalls':0,'renders':0,'nodePortCredit':0}
p=Path(os.environ['SCENETOWEB_STATIC_MATRIX_POLICY']);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(positives),len(refusals))
