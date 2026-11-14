# SPDX-License-Identifier: GPL-3.0-or-later
"""One authored literal census and native graph construction; no node emulation."""
import json
from pathlib import Path
DEFINITIONS=json.loads((Path(__file__).parent/'cases.json').read_text())


def cases(context):
    rows=[{'case':'calibration','kind':'control','expectedInt':2049,'saved':True}]
    for spec in DEFINITIONS:
        if context not in spec.get('contexts',['shader','CPU','GPU']):continue
        if spec['kind']=='text':
            rows.append({**spec,'case':spec['id']+'-length','witness':'length','expectedInt':len(spec['expectedString'])})
            if spec['expectedString']:
                rows.append({**spec,'case':spec['id']+'-whole-match','witness':'whole-match','expectedInt':1,'saved':False})
        else:rows.append({**spec,'case':spec['id']})
    return rows


def _source(tree,text):
    node=tree.nodes.new('FunctionNodeInputString');node.string=text
    assert node.string==text,'Native RNA changed authored text'
    return node.outputs['String']


def build_operator(tree,spec,context):
    import bpy
    if spec['kind']=='compare':
        node=tree.nodes.new('FunctionNodeCompare');node.data_type='STRING';node.operation=spec['operation']
        active=[s for s in node.inputs if s.enabled and not s.is_unavailable]
        assert len(active)==2
        for socket,key in zip(active,['A','B']):tree.links.new(_source(tree,spec['inputs'][key]),socket)
        return node.outputs[0],None
    if spec['kind']=='control':
        node=tree.nodes.new('FunctionNodeInputInt');node.integer=spec['expectedInt'];return node.outputs[0],None
    node=tree.nodes.new(spec['nodeType'])
    for name,value in spec['inputs'].items():
        if name=='string':node.string=value;assert node.string==value
        elif node.inputs[name].type=='STRING':tree.links.new(_source(tree,value),node.inputs[name])
        else:node.inputs[name].default_value=value;assert node.inputs[name].default_value==value,(spec['id'],name,value,node.inputs[name].default_value)
    signal=node.outputs[spec.get('output','String')]
    if spec.get('route')=='mute':
        node.mute=True;assert len([link for link in node.internal_links if link.to_socket==signal])==1,'No native mute bypass'
    if spec.get('route')=='reroute':
        route=tree.nodes.new('NodeReroute');tree.links.new(signal,route.inputs[0]);signal=route.outputs[0]
    if spec.get('route')=='group':
        # The same actual group ID is reused by separately bound source instances.
        name='Shared Static String Reverse '+context;group=bpy.data.node_groups.get(name)
        if group is None:
            group=bpy.data.node_groups.new(name,tree.bl_idname);group.interface.new_socket(name='Text',in_out='INPUT',socket_type='NodeSocketString');group.interface.new_socket(name='Text',in_out='OUTPUT',socket_type='NodeSocketString');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');reverse=group.nodes.new('FunctionNodeReverseString');group.links.new(entry.outputs[0],reverse.inputs['String']);group.links.new(reverse.outputs['String'],out.inputs[0])
        tree.nodes.remove(node);node=tree.nodes.new('ShaderNodeGroup'if context=='shader'else'CompositorNodeGroup');node.node_tree=group;node.name='Bound String '+spec['groupInstance'];tree.links.new(_source(tree,spec['inputs']['String']),node.inputs['Text']);signal=node.outputs['Text']
    return signal,signal if spec['kind']=='text'else None


def build(tree,spec,context):
    scalar,text=build_operator(tree,spec,context)
    if spec['kind']=='text':
        if spec['witness']=='length':
            node=tree.nodes.new('FunctionNodeStringLength');tree.links.new(text,node.inputs['String']);scalar=node.outputs['Length']
        else:
            node=tree.nodes.new('FunctionNodeFindInString');tree.links.new(_source(tree,spec['expectedString']),node.inputs['Search']);node.inputs['Mode'].default_value='From Start';tree.links.new(text,node.inputs['String']);scalar=node.outputs['Count']
    if spec['kind']=='selector':
        node=tree.nodes.new('GeometryNodeIndexSwitch');node.data_type='INT';node.index_switch_items.new()
        for socket,value in zip(node.inputs[1:],[17,2049,4095]):socket.default_value=value
        tree.links.new(scalar,node.inputs[0]);scalar=node.outputs[0]
    return scalar,text


def encode(tree,scalar):
    """Independent byte carrier; the source INT operator remains untouched."""
    def math(operation,a,b):
        node=tree.nodes.new('ShaderNodeMath');node.operation=operation
        for index,value in enumerate([a,b]):
            if isinstance(value,(int,float)):node.inputs[index].default_value=value
            else:tree.links.new(value,node.inputs[index])
        return node.outputs[0]
    def integer(operation):
        node=tree.nodes.new('FunctionNodeIntegerMath');node.operation=operation;tree.links.new(scalar,node.inputs[0]);node.inputs[1].default_value=256
        return node.outputs[0]
    # Extract the two nonnegative bytes in the existing exact integer path.
    # Float FLOORED_MODULO can generate-0 for n=0 on Metal; that is an old
    # arithmetic-carrier counterexample, not a reason to relax string proof.
    low=math('MULTIPLY',integer('MODULO'),1/256)
    high=math('MULTIPLY',integer('DIVIDE'),1/256)
    color=tree.nodes.new('ShaderNodeCombineXYZ');tree.links.new(low,color.inputs['X']);tree.links.new(high,color.inputs['Y']);color.inputs['Z'].default_value=.25
    return color.outputs[0]
