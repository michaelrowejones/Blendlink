# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_WHITE_NOISE_POLICY_PASSED
"""No-render native schema, raw-word, group-instance and ownership controls."""
from array import array
from pathlib import Path
import json
import struct
import sys
from types import SimpleNamespace
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
# Default fields have their own numerical qualification. This fixed family
# checks only source-route separation and grants zero field numeric credit.
node,vector,value=base();tree.links.remove(node.inputs['Vector'].links[0]);before=ownership();field_program=compositor_graph.extract(scene);assert ownership()==before
assert field_program['status']=='extracted',field_program
field_op=next(op for op in field_program['ops']if op['kind']=='white-noise-texture')
field_properties=field_op['properties'];assert 'Vector'not in field_op['inputs']
default_field_controls=[{'case':'implicit-default-field-model','status':field_program['status'],
    'model':field_properties['white_noise_model'],'profile':field_properties['white_noise_profile'],
    'coordinateModel':field_properties['white_noise_coordinate_model'],'dimension':field_properties['noise_dimensions'],
    'authoredInputs':list(field_op['inputs']), 'isField':field_properties['white_noise_model']=='native-compositor-white-noise-uniform-cpu-53-v1', 'fieldNumericCredit':0}]
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
interface_controls=[]
def interface_check(name,accepted):
    before=ownership();program=compositor_graph.extract(scene);assert ownership()==before,name+' source ownership changed'
    assert program['status']==('extracted'if accepted else'unsupported'),(name,program)
    if not accepted:assert any(d['code']=='unsupported-white-noise'for d in program['diagnostics']),(name,program)
    interface_controls.append({'case':name,'nativeAvailable':True,'status':program['status']})

# Native RNA reports a broad enum union: actual assignment is the authority.
# Uniform is available for compositor Vector; Normalized/Pixel are not native
# implicit-default enum values in this build. Do not invent support/refusal credit.
for mode in ['UNIFORM_IMAGE_COORDINATES','NORMALIZED_IMAGE_COORDINATES','PIXEL_IMAGE_COORDINATES']:
    try:incoming.default_input=mode
    except (TypeError,ValueError) as error:
        interface_controls.append({'case':'vector-'+mode,'nativeAvailable':False,'setterRefusal':str(error)});continue
    group.interface_update(bpy.context);interface_check('vector-'+mode,False)
    if mode=='UNIFORM_IMAGE_COORDINATES':
        override=tree.nodes.new('ShaderNodeCombineXYZ');override.inputs.foreach_set('default_value',raw([word(.25),word(.5),word(.75)]));tree.links.new(override.outputs[0],instances[0].inputs[incoming.identifier]);interface_check('vector-linked-override',True)
        tree.links.remove(instances[0].inputs[incoming.identifier].links[0]);tree.nodes.remove(override)
incoming.default_input='VALUE';incoming.structure_type='SINGLE';group.interface_update(bpy.context);interface_check('vector-single-value',True);incoming.structure_type='AUTO';group.interface_update(bpy.context)

float_group=bpy.data.node_groups.new('Artist fixed W interface','CompositorNodeTree');float_input=float_group.interface.new_socket(name='W',in_out='INPUT',socket_type='NodeSocketFloat');float_group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor')
float_entry=float_group.nodes.new('NodeGroupInput');float_exit=float_group.nodes.new('NodeGroupOutput');float_noise=float_group.nodes.new('ShaderNodeTexWhiteNoise');float_noise.noise_dimensions='1D';float_group.links.new(float_entry.outputs[0],float_noise.inputs['W']);float_group.links.new(float_noise.outputs['Color'],float_exit.inputs[0]);float_instance=tree.nodes.new('CompositorNodeGroup');float_instance.node_tree=float_group;tree.links.new(float_instance.outputs[0],sink.inputs[0]);interface_check('float-value-default',True)
for mode in ['SCENE_FRAME','SCENE_TIME','SCENE_SECONDS']:
    try:float_input.default_input=mode
    except (TypeError,ValueError) as error:
        interface_controls.append({'case':'float-'+mode,'nativeAvailable':False,'setterRefusal':str(error)});continue
    float_group.interface_update(bpy.context);interface_check('float-'+mode,False)
float_input.default_input='VALUE';tree.links.new(instances[0].outputs[0],sink.inputs[0])

# These impossible/corrupt native-schema boundaries cannot be authored by RNA;
# isolate them explicitly instead of claiming native numerical cases.
import compositor_white_noise as white_noise
for name,patch in [('unknown-default',{'default_input':'UNKNOWN'}),('unknown-structure',{'structure_type':'UNKNOWN'}),('field-structure',{'structure_type':'FIELD'}),('identifier-mismatch',{'identifier':'Other'}),('output-direction',{'in_out':'OUTPUT'}),('type-mismatch',{'socket_type':'NodeSocketFloat'})]:
    fields=dict(item_type='SOCKET',in_out='INPUT',identifier=incoming.identifier,socket_type='NodeSocketVector',default_input='VALUE',structure_type='AUTO');fields.update(patch)
    fake=SimpleNamespace(node=SimpleNamespace(node_tree=SimpleNamespace(bl_idname='CompositorNodeTree',interface=SimpleNamespace(items_tree=[SimpleNamespace(**fields)]))),identifier=incoming.identifier,type='VECTOR')
    try:white_noise._group_default(fake)
    except white_noise.WhiteNoiseUnsupported as error:assert 'White Noise'in str(error)
    else:raise AssertionError(name+' did not refuse')
    interface_controls.append({'case':name,'privateSchemaBoundary':True,'status':'unsupported'})
# Reachable source-hop budget, without constructing an unbounded graph.
for _ in range(18):
    previous=noise.inputs['Vector'].links[0].from_socket;reroute=group.nodes.new('NodeReroute');group.links.new(previous,reroute.inputs[0]);group.links.new(reroute.outputs[0],noise.inputs['Vector'])
check('source-depth-budget',False)
packet={'positiveControls':positives,'namedRefusals':refusals,'interfaceDefaultControls':interface_controls,'defaultFieldControls':default_field_controls,'renders':0,'portCredit':0}
print('BLENDLINK_COMPOSITOR_WHITE_NOISE_POLICY_PASSED '+json.dumps(packet))
