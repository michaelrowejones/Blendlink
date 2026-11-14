# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_WHITE_NOISE_POLICY_PASSED
"""No-render native schema, raw-word, group-instance and ownership controls."""
from array import array
from pathlib import Path
import json
import struct
import sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.compositor_device='CPU'
tree=bpy.data.node_groups.new('Artist White Noise controls','CompositorNodeTree')
tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree

def raw(words):
    values=array('f');values.frombytes(struct.pack('='+str(len(words))+'I',*words));return values
def word(value):return struct.unpack('=I',struct.pack('=f',value))[0]
def state():
    return (scene.as_pointer(),scene.frame_current,scene.frame_subframe,scene.render.engine,scene.render.compositor_device,
        bpy.context.view_layer.objects.active.as_pointer()if bpy.context.view_layer.objects.active else None,
        tuple(sorted(obj.as_pointer()for obj in bpy.context.selected_objects)))

def ownership():
    return (state(),tuple((name,tuple(sorted((item.as_pointer(),item.users)for item in getattr(bpy.data,name))))
        for name in ['scenes','node_groups','objects','meshes','materials','images','collections']))

positives=[];refusals=[]
def check(name,accepted=True):
    before=ownership();program=compositor_graph.extract(scene);assert ownership()==before,name+' source ownership changed'
    if accepted:
        assert program['status']=='extracted',(name,program)
        op=next(op for op in program['ops']if op['kind']=='white-noise-texture')
        assert all(value['value']['kind']=='constant'for value in op['inputs'].values())
        positives.append(name);return op
    assert program['status']=='unsupported',(name,program)
    assert any(d['code'] in {'unsupported-white-noise','animated-tree'}for d in program['diagnostics']),(name,program)
    refusals.append(name)

def base(dim='4D',output='Color'):
    tree.animation_data_clear();tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput')
    node=tree.nodes.new('ShaderNodeTexWhiteNoise');assert node.noise_dimensions=='2D';node.noise_dimensions=dim
    vector=tree.nodes.new('ShaderNodeCombineXYZ');vector.inputs.foreach_set('default_value',raw([word(.1),word(-.8),word(1/3)]))
    if dim != '1D':tree.links.new(vector.outputs[0],node.inputs['Vector'])
    value=tree.nodes.new('ShaderNodeValue');value.outputs.foreach_set('default_value',raw([word(.5678912)]))
    if dim in {'1D','4D'}:tree.links.new(value.outputs[0],node.inputs['W'])
    tree.links.new(node.outputs[output],sink.inputs[0])
    return node,vector,value

for dimension in ['1D','2D','3D','4D']:
    for output in ['Value','Color']:
        node,vector,value=base(dimension,output);op=check(dimension+'-'+output)
        assert op['properties']['noise_dimensions']==int(dimension[0])
for bits in [0,0x00800000,0x80800000,0x7f7fffff,0xff7fffff]:
    node,vector,value=base('1D','Value');value.outputs.foreach_set('default_value',raw([bits]));op=check('raw-normal-'+hex(bits))
    assert word(op['inputs']['W']['value']['value'])==bits
for bits in [0x80000000,1,0x80000001,0x007fffff]:
    node,vector,value=base('1D','Value');value.outputs.foreach_set('default_value',raw([bits]));check('raw-refusal-'+hex(bits),False)
for bits in [0x7f800000,0xff800000,0x7fc12345]:
    node,vector,value=base('1D','Value');value.outputs.foreach_set('default_value',raw([bits]))
    stored=array('f',[0]);value.outputs.foreach_get('default_value',stored);actual=struct.unpack('=I',stored.tobytes())[0]
    # RNA setters may clamp Inf before storage; test what the artist node
    # actually stores, never claim a nonfinite source refusal from a normal one.
    if actual in {0x7f7fffff,0xff7fffff}:check('RNA-clamped-source-'+hex(bits))
    else:check('stored-nonfinite-'+hex(actual),False)
for axis in range(3):
    node,vector,value=base();words=[word(.1),word(.2),word(.3)];words[axis]=1
    vector.inputs.foreach_set('default_value',raw(words));check('combine-subnormal-'+str(axis),False)
node,vector,value=base();tree.links.remove(node.inputs['Vector'].links[0]);check('implicit-coordinates',False)
node,vector,value=base('1D');node.inputs['W'].keyframe_insert(data_path='default_value',frame=1);check('animated-source',False)
node,vector,value=base('1D');computed=tree.nodes.new('ShaderNodeMath');tree.links.new(computed.outputs[0],node.inputs['W']);check('computed-source',False)
node,vector,value=base('1D');tree.links.new(vector.outputs[0],node.inputs['W']);check('implicit-vector-cast',False)
node,vector,value=base();scene.render.compositor_device='GPU';check('unqualified-gpu-authored-source',False);scene.render.compositor_device='CPU'

# Vector group defaults copy all three native stored words; distinct instances
# and generated identifiers bind through the actual group rather than labels.
group=bpy.data.node_groups.new('Artist fixed seeds','CompositorNodeTree')
incoming=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketVector')
group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor')
source=group.nodes.new('NodeGroupInput');target=group.nodes.new('NodeGroupOutput');noise=group.nodes.new('ShaderNodeTexWhiteNoise');noise.noise_dimensions='3D'
group.links.new(source.outputs[incoming.identifier],noise.inputs['Vector']);group.links.new(noise.outputs['Color'],target.inputs[0])
tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');instances=[]
for values in [[word(.1),word(-.8),word(1/3)],[word(.2),word(.4),word(.6)]]:
    instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs.foreach_set('default_value',raw(values));instances.append(instance)
observed=[]
for index,instance in enumerate(instances):
    tree.links.new(instance.outputs[0],sink.inputs[0]);op=check('group-instance-'+str(index));observed.append(op['inputs']['Vector']['value']['value'])
assert observed[0]!=observed[1]
instances[0].inputs.foreach_set('default_value',raw([1,word(.2),word(.3)]));tree.links.new(instances[0].outputs[0],sink.inputs[0]);check('group-default-subnormal',False)
instances[0].inputs.foreach_set('default_value',raw([0x80000000,word(.2),word(.3)]));check('group-default-negative-zero',False)
instances[0].inputs.foreach_set('default_value',raw([0,word(.2),word(.3)]));reroute=group.nodes.new('NodeReroute');group.links.new(source.outputs[incoming.identifier],reroute.inputs[0]);group.links.new(reroute.outputs[0],noise.inputs['Vector']);check('group-reroute')
# Reachable source-hop budget, without constructing an unbounded graph.
for _ in range(18):
    previous=noise.inputs['Vector'].links[0].from_socket;reroute=group.nodes.new('NodeReroute');group.links.new(previous,reroute.inputs[0]);group.links.new(reroute.outputs[0],noise.inputs['Vector'])
check('source-depth-budget',False)
packet={'positiveControls':positives,'namedRefusals':refusals,'renders':0,'portCredit':0}
print('BLENDLINK_COMPOSITOR_WHITE_NOISE_POLICY_PASSED '+json.dumps(packet))
