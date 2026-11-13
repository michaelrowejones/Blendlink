# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_STATIC_SELECTION_POLICY_PASSED
"""Native typed static selection, lazy dependency and refusal policy checks."""
import bpy,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'packages/blendlink/dist/blender'));sys.path.insert(0,str(ROOT/'packages/blendlink/dist/addon'))
import static_selection,tsl_ir,procedural,compositor_graph


def shader():
 material=bpy.data.materials.new('Static native shader');material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
 sink=tree.nodes.new('ShaderNodeOutputMaterial');root=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(root.outputs[0],sink.inputs['Surface'])
 return tree,root


def compositor():
 scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.use_compositing=True
 tree=bpy.data.node_groups.new('Static native compositor','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 return scene,tree,tree.nodes.new('NodeGroupOutput')


def choose(node,index):
 if node.bl_idname=='GeometryNodeSwitch':node.inputs[0].default_value=bool(index)
 elif node.bl_idname=='GeometryNodeIndexSwitch':node.inputs[0].default_value=index
 else:node.inputs[0].default_value=node.enum_items[index].name


def build(tree,kind,mode,index=0):
 n=tree.nodes.new(kind)
 setattr(n,'input_type' if kind=='GeometryNodeSwitch' else 'data_type',mode)
 choose(n,index)
 return n


if tuple(bpy.app.version)!=(5,3,0) or bpy.app.build_hash!=b'02f0899d78e3':
 print('BLENDLINK_STATIC_SELECTION_POLICY_NA '+json.dumps({'version':list(bpy.app.version),'numericalCases':0}))
 print('BLENDLINK_STATIC_SELECTION_POLICY_PASSED not-applicable');sys.exit(0)

count=0
for context in ['shader','compositor']:
 for kind in sorted(static_selection.NODES):
  for mode in ['FLOAT','INT','BOOLEAN','VECTOR','RGBA']:
   for index in [0,1]:
    if context=='shader':tree,root=shader();target=root.inputs['Base Color']
    else:scene,tree,sink=compositor();target=sink.inputs[0]
    node=build(tree,kind,mode,index);selected=static_selection.static_selection(node,node.outputs[0]);assert selected['input']==node.inputs[index+1]
    tree.links.new(node.outputs[0],target)
    if context=='shader':
     doc=tsl_ir.emit_channel(target,evaluation_engine='EEVEE');assert doc['output']
    else:
     doc=compositor_graph.extract(scene);assert doc['status']=='extracted',doc;assert doc['compileTimeSelections'][0]['selectedIndex']==index
    count+=1
# Unsupported inactive graphs must not enter emission or either dependency walk.
tree,root=shader();node=build(tree,'GeometryNodeSwitch','RGBA',0)
node.inputs[1].default_value=(.125,.25,.5,1)
bad=tree.nodes.new('ShaderNodeTexSky');tree.links.new(bad.outputs[0],node.inputs[2]);tree.links.new(node.outputs[0],root.inputs['Base Color'])
assert tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')['output']['op']=='const_vec3'
assert bad not in procedural.reachable_surface_nodes(tree)
assert not any(n==bad for n,s in procedural._walk_channel_upstream(root.inputs['Base Color']))
choose(node,1)
try:tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')
except tsl_ir.TslIrRefusal:pass
else:raise AssertionError('Selected unsupported shader branch was admitted')
# Linked actual Bool and native Boolean Math are constant selectors, Float coercions are not.
choose(node,0);boolean=tree.nodes.new('FunctionNodeInputBool');boolean.boolean=True
negate=tree.nodes.new('FunctionNodeBooleanMath');negate.operation='NOT';tree.links.new(boolean.outputs[0],negate.inputs[0]);tree.links.new(negate.outputs[0],node.inputs[0])
assert static_selection.static_selection(node,node.outputs[0])['metadata']['selectedIndex']==0
value=tree.nodes.new('ShaderNodeValue');tree.links.new(value.outputs[0],node.inputs[0])
try:static_selection.static_selection(node,node.outputs[0])
except static_selection.SelectionUnsupported as error:assert 'conversion' in str(error)
else:raise AssertionError('Implicit selector conversion admitted')
# All native Boolean Math truth-table operations have typed constant selectors.
truth={'AND':lambda a,b:a and b,'OR':lambda a,b:a or b,'NOT':lambda a,b:not a,'XOR':lambda a,b:a!=b,'XNOR':lambda a,b:a==b,'NAND':lambda a,b:not(a and b),'NOR':lambda a,b:not(a or b),'IMPLY':lambda a,b:not a or b,'NIMPLY':lambda a,b:a and not b}
boolean_cases=0
for operation,expected in truth.items():
 for a in [False,True]:
  for b in [False,True]:
   tree,_=shader();switch=build(tree,'GeometryNodeSwitch','RGBA');math=tree.nodes.new('FunctionNodeBooleanMath');math.operation=operation;math.inputs[0].default_value=a
   if len(math.inputs)>1:math.inputs[1].default_value=b
   tree.links.new(math.outputs[0],switch.inputs[0]);assert static_selection.static_selection(switch,switch.outputs[0])['selector']==expected(a,b)
   boolean_cases+=1
# The same authored group can select different dependencies in different instances.
tree,root=shader();group=bpy.data.node_groups.new('Shared selection group','ShaderNodeTree')
for name,kind in [('Choice','NodeSocketBool'),('A','NodeSocketColor'),('B','NodeSocketColor')]:group.interface.new_socket(name=name,in_out='INPUT',socket_type=kind)
group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketColor')
incoming=group.nodes.new('NodeGroupInput');outgoing=group.nodes.new('NodeGroupOutput');switch=build(group,'GeometryNodeSwitch','RGBA')
for a,b in [(incoming.outputs['Choice'],switch.inputs[0]),(incoming.outputs['A'],switch.inputs[1]),(incoming.outputs['B'],switch.inputs[2]),(switch.outputs[0],outgoing.inputs[0])]:group.links.new(a,b)
instances=[];bad=tree.nodes.new('ShaderNodeTexSky')
for choice in [False,True]:
 instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;instance.inputs['Choice'].default_value=choice;instance.inputs['A'].default_value=(.125,.25,.5,1);instance.inputs['B'].default_value=(.75,.5,.25,1)
 tree.links.new(bad.outputs[0],instance.inputs['A' if choice else 'B']);instances.append(instance)
mix=tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='ADD';mix.inputs[0].default_value=1
for instance,socket in zip(instances,mix.inputs[1:]):tree.links.new(instance.outputs[0],socket)
tree.links.new(mix.outputs[0],root.inputs['Base Color']);assert bad not in procedural.reachable_surface_nodes(tree)
assert not any(n==bad for n,s in procedural._walk_channel_upstream(root.inputs['Base Color']));assert tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')['output']
instances[1].inputs['Choice'].default_value=False
assert bad in procedural.reachable_surface_nodes(tree)
assert any(n==bad for n,s in procedural._walk_channel_upstream(root.inputs['Base Color']))
try:tsl_ir.emit_channel(root.inputs['Base Color'],evaluation_engine='EEVEE')
except tsl_ir.TslIrRefusal:pass
else:raise AssertionError('Per-instance selected unsupported branch was admitted')
# Out-of-range indexes and animated trees retain named refusals.
node=build(tree,'GeometryNodeIndexSwitch','FLOAT',0);node.inputs[0].default_value=-1
try:static_selection.static_selection(node,node.outputs[0])
except static_selection.SelectionUnsupported as error:assert 'outside' in str(error)
else:raise AssertionError('Invalid index admitted')
node.inputs[0].default_value=0;node.inputs[0].keyframe_insert(data_path='default_value',frame=1)
try:static_selection.static_selection(node,node.outputs[0])
except static_selection.SelectionUnsupported as error:assert 'animation' in str(error)
else:raise AssertionError('Animated selector admitted')
print('BLENDLINK_STATIC_SELECTION_POLICY_PASSED '+json.dumps({'typedSelections':count,'booleanTruthTableCases':boolean_cases,'sharedGroupInstances':2}))
