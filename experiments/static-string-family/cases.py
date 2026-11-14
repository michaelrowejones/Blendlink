# SPDX-License-Identifier: GPL-3.0-or-later
"""One authored literal census and native graph construction; no node emulation."""
import json
from pathlib import Path
DEFINITIONS=json.loads((Path(__file__).parent/'cases.json').read_text())


def cases(context):
    rows=[{'case':'calibration','kind':'control','expectedInt':2049,'saved':True}]
    for spec in DEFINITIONS:
        if context not in spec.get('contexts',['shader','CPU','GPU']):continue
        if spec['kind']=='parse':
            for witness,expected in [('consumed-length',spec['expectedLength']),('value-length',len(str(spec['expectedValue']))),('value-whole-match',1)]:
                rows.append({**spec,'case':spec['id']+'-'+witness,'witness':witness,'expectedInt':expected,'expectedString':str(spec['expectedValue']),'saved':bool(spec.get('saved'))and witness!='value-length'})
        elif spec['kind']=='text':
            rows.append({**spec,'case':spec['id']+'-length','witness':'length','expectedInt':len(spec['expectedString'])})
            if spec['expectedString']:
                rows.append({**spec,'case':spec['id']+'-whole-match','witness':'whole-match','expectedInt':1,'saved':False})
        else:rows.append({**spec,'case':spec['id']})
    return rows


def _source(tree,text):
    node=tree.nodes.new('FunctionNodeInputString');node.string=text
    assert node.string==text,'Native RNA changed authored text'
    return node.outputs['String']


def active_socket(sockets, identifier, kind):
    values=[s for s in sockets if s.identifier==identifier and s.type==kind and s.enabled and not s.is_unavailable]
    assert len(values)==1,(identifier,kind,[(s.identifier,s.type,s.enabled,s.is_unavailable)for s in sockets])
    return values[0]


def parser_witness_endpoints(scalar, text, witness):
    endpoint=scalar if witness=='consumed-length'else active_socket(text.node.inputs,'Value','INT').links[0].from_socket
    while endpoint.node.bl_idname=='NodeReroute':
        links=[link for link in endpoint.node.inputs[0].links if link.is_valid and not link.is_muted]
        assert len(links)==1;endpoint=links[0].from_socket
    parser=endpoint.node
    assert parser.bl_idname in {'FunctionNodeStringToValue','ShaderNodeGroup','CompositorNodeGroup'}
    def output(name):
        if parser.bl_idname=='FunctionNodeStringToValue':return active_socket(parser.outputs,name,'INT')
        # Authored group interface identifiers are Socket_N, unlike native
        # parser IDs. These fixture interfaces have unique typed labels.
        matches=[s for s in parser.outputs if s.name==name and s.type=='INT'and s.enabled and not s.is_unavailable]
        assert len(matches)==1;return matches[0]
    return output('Value'),output('Length')


def _conversion(tree,kind,inputs,spec=None):
    spec=spec or {};node=tree.nodes.new(kind);node.data_type='INT'
    for name,value in inputs.items():
        socket=active_socket(node.inputs,name,'STRING'if name=='String'else'INT')
        if name=='String':tree.links.new(_source(tree,value),socket)
        elif name in spec.get('sourceLengths',{}):
            source=tree.nodes.new('FunctionNodeStringLength');tree.links.new(_source(tree,spec['sourceLengths'][name]),source.inputs['String']);tree.links.new(source.outputs['Length'],socket)
        elif spec.get('inputInts')or name=='Base'and not 2<=value<=36 or name=='Padding'and value<0:
            source=tree.nodes.new('FunctionNodeInputInt');source.integer=value;tree.links.new(source.outputs['Integer'],socket)
        else:socket.default_value=value;assert socket.default_value==value
    return node


def build_operator(tree,spec,context):
    import bpy
    if spec['kind']=='parse':
        node=_conversion(tree,'FunctionNodeStringToValue',spec['inputs'])
        if spec.get('formatInput'):
            formatter=_conversion(tree,'FunctionNodeValueToString',spec['formatInput']);tree.links.new(formatter.outputs['String'],active_socket(node.inputs,'String','STRING'))
        if spec.get('route')=='conversion-group':
            name='Shared Static Integer Parser '+context;group=bpy.data.node_groups.get(name)
            if group is None:
                group=bpy.data.node_groups.new(name,tree.bl_idname)
                for label,direction,kind in [('String','INPUT','NodeSocketString'),('Base','INPUT','NodeSocketInt'),('Value','OUTPUT','NodeSocketInt'),('Length','OUTPUT','NodeSocketInt')]:group.interface.new_socket(name=label,in_out=direction,socket_type=kind)
                entry,out=group.nodes.new('NodeGroupInput'),group.nodes.new('NodeGroupOutput');parser=_conversion(group,'FunctionNodeStringToValue',{'String':'','Base':10})
                group.links.new(entry.outputs['String'],parser.inputs['String']);group.links.new(entry.outputs['Base'],parser.inputs['Base'])
                for label in ['Value','Length']:group.links.new(parser.outputs[label],out.inputs[label])
            tree.nodes.remove(node);node=tree.nodes.new('ShaderNodeGroup'if context=='shader'else'CompositorNodeGroup');node.node_tree=group;node.name='Bound Parser '+spec['groupInstance'];tree.links.new(_source(tree,spec['inputs']['String']),node.inputs['String']);node.inputs['Base'].default_value=spec['inputs']['Base']
        output='Length'if spec.get('witness')=='consumed-length'else'Value';signal=node.outputs[output]
        if spec.get('route')=='reroute':
            reroute=tree.nodes.new('NodeReroute');tree.links.new(signal,reroute.inputs[0]);signal=reroute.outputs[0]
        return signal,None
    if spec.get('dataType')=='INT'and spec['nodeType']=='FunctionNodeValueToString':
        node=_conversion(tree,spec['nodeType'],spec['inputs'],spec);return node.outputs['String'],node.outputs['String']
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
    if spec.get('menuSource'):
        menu=tree.nodes.new('FunctionNodeInputMenu');tree.links.new(menu.outputs['Menu'],node.inputs['Operation']);menu.value=spec['inputs']['Operation']
        assert menu.value==spec['inputs']['Operation']
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
    if spec.get('route')=='match-group':
        name='Shared Static Match Starts '+context;group=bpy.data.node_groups.get(name)
        if group is None:
            group=bpy.data.node_groups.new(name,tree.bl_idname)
            for label in ['Text','Key']:group.interface.new_socket(name=label,in_out='INPUT',socket_type='NodeSocketString')
            group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketBool')
            entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');match=group.nodes.new('FunctionNodeMatchString');match.inputs['Operation'].default_value='Starts With'
            group.links.new(entry.outputs['Text'],match.inputs['String']);group.links.new(entry.outputs['Key'],match.inputs['Key']);group.links.new(match.outputs['Result'],out.inputs[0])
        tree.nodes.remove(node);node=tree.nodes.new('ShaderNodeGroup'if context=='shader'else'CompositorNodeGroup');node.node_tree=group;node.name='Bound Match '+spec['groupInstance']
        tree.links.new(_source(tree,spec['inputs']['String']),node.inputs['Text']);tree.links.new(_source(tree,spec['inputs']['Key']),node.inputs['Key']);signal=node.outputs['Result']
    return signal,signal if spec['kind']=='text'else None


def build(tree,spec,context):
    scalar,text=build_operator(tree,spec,context)
    if spec['kind']=='parse'and spec['witness']!='consumed-length':
        formatter=_conversion(tree,'FunctionNodeValueToString',{'Value':0,'Base':10,'Padding':0});tree.links.new(scalar,active_socket(formatter.inputs,'Value','INT'));text=formatter.outputs['String']
    if spec['kind']=='text'or spec['kind']=='parse'and spec['witness']!='consumed-length':
        if spec['witness']in{'length','value-length'}:
            node=tree.nodes.new('FunctionNodeStringLength');tree.links.new(text,node.inputs['String']);scalar=node.outputs['Length']
        else:
            node=tree.nodes.new('FunctionNodeFindInString');tree.links.new(_source(tree,spec['expectedString']),node.inputs['Search']);node.inputs['Mode'].default_value='From Start';tree.links.new(text,node.inputs['String']);scalar=node.outputs['Count']
    if spec['kind']=='match':
        # An explicit native Boolean Switch maps the unchanged Result to INT.
        # This reuses qualified selector transport, with no implicit bool cast.
        node=tree.nodes.new('GeometryNodeSwitch');node.input_type='INT';node.inputs['False'].default_value=0;node.inputs['True'].default_value=1
        tree.links.new(scalar,node.inputs['Switch']);scalar=node.outputs[0]
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
