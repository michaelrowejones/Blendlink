# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Matrix-owned pinned5.3 source-policy proof; no renderer or numerical qualification by itself.
"""Public helper bound/refusal controls, without changing production code."""
import bpy,json,sys,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/dist/blender'),str(ROOT/'packages/blendlink/dist/addon'),str(ROOT/'experiments/static-string-family')]
import static_strings
from cases import DEFINITIONS,build_operator,_source
# Exercise the canonical source layout under a fresh package, so staged
# top-level imports cannot mask a broken addon-sibling fallback.
import importlib,types
source_package='scenetoweb_static_string_source_probe'
package=types.ModuleType(source_package);package.__path__=[str(ROOT/'packages/blendlink/blender')]
sys.modules[source_package]=package
source_graph=importlib.import_module(source_package+'.compositor_graph')
assert Path(source_graph.static_strings.__file__).resolve()==ROOT/'packages/blender-addon/static_strings.py'
assert source_graph.static_strings.MODEL==static_strings.MODEL
source_tree=bpy.data.node_groups.new('Owned source-layout string import','CompositorNodeTree')
source_length=source_tree.nodes.new('FunctionNodeStringLength');source_length.inputs['String'].default_value='Aé🙂'
assert source_graph.static_strings.evaluate_output(source_length.outputs['Length'])['value']==3
bpy.data.node_groups.remove(source_tree)
# Extract a direct Boolean Match edge, independent of selector folding. This
# catches accidentally serializing its Result as INT in the compositor route.
probe=bpy.data.node_groups.new('Owned direct Boolean Match type','CompositorNodeTree');probe.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
match=probe.nodes.new('FunctionNodeMatchString');match.inputs['String'].default_value='SceneToWeb';match.inputs['Operation'].default_value='Ends With';match.inputs['Key'].default_value='Web'
terminal=probe.nodes.new('NodeGroupOutput');probe.links.new(match.outputs['Result'],terminal.inputs[0])
scene=bpy.context.scene;previous=scene.compositing_node_group
try:
    scene.compositing_node_group=probe;program=source_graph.extract(scene)
    assert program['status']=='extracted',program
    assert program['output']=={'kind':'convert','fromType':'BOOLEAN','type':'RGBA','input':{'kind':'constant','type':'BOOLEAN','value':True}},program
    assert any(row['type']=='BOOLEAN' and any(source['nodeType']=='FunctionNodeMatchString' for source in row['sources'])for row in program['compileTimeStrings']),program
finally:
    scene.compositing_node_group=previous;bpy.data.node_groups.remove(probe)

rows=[]
for context in ['shader','compositor']:
    kind='ShaderNodeTree'if context=='shader'else'CompositorNodeTree'
    tree=bpy.data.node_groups.new('Actual bounded string policy '+context,kind)
    for spec in DEFINITIONS:
        if spec['kind']!='text':continue
        signal,text=build_operator(tree,spec,context)
        record=static_strings.evaluate_output(text);assert record['value']==spec['expectedString'],(spec['id'],record,spec['expectedString'])
    for spec in DEFINITIONS:
        if spec['kind']!='parse':continue
        value,_=build_operator(tree,dict(spec,witness='value'),context);consumed,_=build_operator(tree,dict(spec,witness='consumed-length'),context)
        record=static_strings.evaluate_output(value);length_record=static_strings.evaluate_output(consumed)
        assert record['type']=='INT'and record['value']==spec['expectedValue']and length_record['type']=='INT'and length_record['value']==spec['expectedLength'],(spec['id'],record,length_record)
        if context=='shader':
            import tsl_ir
            assert tsl_ir.emit_output(value.node,value)=={'op':'typed_const','type':'INT','value':spec['expectedValue']}
    for spec in DEFINITIONS:
        if spec['kind']!='match':continue
        signal,_=build_operator(tree,spec,context)
        record=static_strings.evaluate_output(signal)
        assert record['type']=='BOOLEAN' and record['value'] is spec['expectedBool'],(spec['id'],record)
        if context=='shader':
            import tsl_ir
            expression=tsl_ir.emit_output(signal.node,signal)
            assert expression=={'op':'typed_const','type':'BOOLEAN','value':spec['expectedBool']},expression
    for label in ['case-byte-bound','input-bytes','output-bytes','computed-position','implicit-position','unsupported-producer','depth','visit-budget','animated-tree','slice-overflow','match-key-bytes','match-source-bytes','match-animated-tree']:
        tree.nodes.clear();tree.animation_data_clear();node=tree.nodes.new('FunctionNodeStringLength');signal=node.outputs['Length']
        if label.startswith('match-'):
            source=tree.nodes.new('FunctionNodeMatchString');signal=source.outputs['Result']
            if label=='match-key-bytes':tree.links.new(_source(tree,'é'*2049),source.inputs['Key'])
            elif label=='match-source-bytes':tree.links.new(_source(tree,'x'*4097),source.inputs['String'])
            else:
                value=tree.nodes.new('ShaderNodeValue');value.outputs[0].keyframe_insert(data_path='default_value',frame=1)
        elif label=='case-byte-bound':
            source=tree.nodes.new('FunctionNodeSetStringCase');tree.links.new(_source(tree,'é'*2049),source.inputs['String']);source.inputs['Case'].default_value='Uppercase';tree.links.new(source.outputs[0],node.inputs['String'])
        elif label=='input-bytes':tree.links.new(_source(tree,'x'*4097),node.inputs['String'])
        elif label=='output-bytes':
            source=tree.nodes.new('FunctionNodeReplaceString');tree.links.new(_source(tree,'A'*2048),source.inputs['String']);source.inputs['Find'].default_value='A';source.inputs['Replace'].default_value='BBB';tree.links.new(source.outputs[0],node.inputs['String'])
        elif label in ['computed-position','implicit-position','slice-overflow']:
            source=tree.nodes.new('FunctionNodeSliceString');source.inputs['String'].default_value='ABCD';source.inputs['Length'].default_value=2;tree.links.new(source.outputs[0],node.inputs['String'])
            if label=='computed-position':
                arithmetic=tree.nodes.new('FunctionNodeIntegerMath');arithmetic.operation='ADD';arithmetic.inputs[0].default_value=1;arithmetic.inputs[1].default_value=1;tree.links.new(arithmetic.outputs[0],source.inputs['Position'])
            elif label=='implicit-position':
                value=tree.nodes.new('ShaderNodeValue');value.outputs[0].default_value=1;tree.links.new(value.outputs[0],source.inputs['Position'])
            else:source.inputs['Position'].default_value=2147483647;source.inputs['Length'].default_value=1
        elif label=='unsupported-producer':
            source=tree.nodes.new('FunctionNodeValueToString');tree.links.new(source.outputs[0],node.inputs['String'])
        elif label=='depth':
            previous=None
            for i in range(12):
                source=tree.nodes.new('FunctionNodeReverseString');source.inputs['String'].default_value='AB'
                if previous:tree.links.new(previous,source.inputs['String'])
                previous=source.outputs[0]
            tree.links.new(previous,node.inputs['String'])
        elif label=='visit-budget':
            leaf=tree.nodes.new('FunctionNodeInputString');leaf.string='A';previous=leaf.outputs[0]
            for i in range(7):
                source=tree.nodes.new('FunctionNodeReplaceString');source.inputs['Replace'].default_value='';tree.links.new(previous,source.inputs['String']);tree.links.new(previous,source.inputs['Find']);previous=source.outputs[0]
            signal=previous
        else:
            node.inputs['String'].default_value='AB';value=tree.nodes.new('ShaderNodeValue');value.outputs[0].keyframe_insert(data_path='default_value',frame=1)
        try:static_strings.evaluate_output(signal)
        except static_strings.StaticStringUnsupported as error:rows.append({'context':context,'kind':label,'error':str(error)})
        else:raise AssertionError('Unqualified static string was admitted '+context+' '+label)
# Conversion schemas and resource guards are tested before native render.
for context in ['shader','compositor']:
    tree=bpy.data.node_groups.new('Owned integer string conversion bounds '+context,'ShaderNodeTree'if context=='shader'else'CompositorNodeTree')
    for identifier in ['FunctionNodeStringToValue','FunctionNodeValueToString']:
        node=tree.nodes.new(identifier)
        for dtype in ['FLOAT','INT']:
            node.data_type=dtype
            if dtype=='FLOAT':
                try:static_strings.evaluate_output(node.outputs[0])
                except static_strings.StaticStringUnsupported as error:assert 'FLOAT mode'in str(error)
                else:raise AssertionError('FLOAT conversion admitted')
            else:
                from cases import active_socket
                if identifier=='FunctionNodeValueToString':
                    padding=active_socket(node.inputs,'Padding','INT');padding.default_value=4096
                    assert len(static_strings.evaluate_output(node.outputs['String'])['value'])==4096
                    padding.default_value=4097
                    try:static_strings.evaluate_output(node.outputs['String'])
                    except static_strings.StaticStringUnsupported as error:assert '4096-byte'in str(error)
                    else:raise AssertionError('Oversized integer Padding admitted')
    # C++ digit syntax stays ASCII: Unicode digits, whitespace and a plus do
    # not become valid prefixes; negative zero still consumes both characters.
    for text,expected in [('-0',(0,2)),('-', (0,0)),('+12',(0,0)),(' 12',(0,0)),('٠12',(0,0)),('12🙂',(12,2)),('',(0,0))]:
        node=tree.nodes.new('FunctionNodeStringToValue');node.data_type='INT';node.inputs['String'].default_value=text
        assert tuple(static_strings.evaluate_output(node.outputs[name])['value']for name in ['Value','Length'])==expected
    # Every declared radix uses the same exact digit/classification path.
    for base in range(2,37):
        digit='0123456789abcdefghijklmnopqrstuvwxyz'[base-1]
        parser=tree.nodes.new('FunctionNodeStringToValue');parser.data_type='INT';parser.inputs['String'].default_value=digit;parser.inputs['Base'].default_value=base
        assert static_strings.evaluate_output(parser.outputs['Value'])['value']==base-1
        formatter=tree.nodes.new('FunctionNodeValueToString');formatter.data_type='INT';formatter.inputs['Value'].default_value=base-1;formatter.inputs['Base'].default_value=base
        assert static_strings.evaluate_output(formatter.outputs['String'])['value']==digit

# Invalid Unicode/NUL cannot always be represented by RNA. These are explicitly
# private boundary controls, not actual native string numerical evidence.
private=[]
for value in ['A\x00B','\ud800']:
    try:static_strings._text(value)
    except static_strings.StaticStringUnsupported as error:private.append(str(error))
    else:raise AssertionError('Invalid host text admitted')
packet={'status':'PASSED_STATIC_STRING_POLICY','rows':rows,'privateHostBoundaryControls':private,'privateNumericalCredit':0,'positiveLogicalTextCases':sum(s['kind']=='text'for s in DEFINITIONS)*2,'positiveLogicalBooleanMatchCases':sum(s['kind']=='match'for s in DEFINITIONS)*2}
out=Path(os.environ['SCENETOWEB_STRINGS_EVIDENCE']);out.mkdir(exist_ok=True,parents=True);(out/'policy.json').write_text(json.dumps(packet,indent=2)+'\n');print('SCENETOWEB_STATIC_STRING_POLICY_PASSED',len(rows))
