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
rows=[]
for context in ['shader','compositor']:
    kind='ShaderNodeTree'if context=='shader'else'CompositorNodeTree'
    tree=bpy.data.node_groups.new('Actual bounded string policy '+context,kind)
    for spec in DEFINITIONS:
        if spec['kind']!='text':continue
        signal,text=build_operator(tree,spec,context)
        record=static_strings.evaluate_output(text);assert record['value']==spec['expectedString'],(spec['id'],record,spec['expectedString'])
    for label in ['case-byte-bound','input-bytes','output-bytes','computed-position','implicit-position','unsupported-producer','depth','visit-budget','animated-tree','slice-overflow']:
        tree.nodes.clear();tree.animation_data_clear();node=tree.nodes.new('FunctionNodeStringLength');signal=node.outputs['Length']
        if label=='case-byte-bound':
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
# Invalid Unicode/NUL cannot always be represented by RNA. These are explicitly
# private boundary controls, not actual native string numerical evidence.
private=[]
for value in ['A\x00B','\ud800']:
    try:static_strings._text(value)
    except static_strings.StaticStringUnsupported as error:private.append(str(error))
    else:raise AssertionError('Invalid host text admitted')
packet={'status':'PASSED_STATIC_STRING_POLICY','rows':rows,'privateHostBoundaryControls':private,'privateNumericalCredit':0,'positiveLogicalTextCases':sum(s['kind']=='text'for s in DEFINITIONS)*2}
out=Path(os.environ['SCENETOWEB_STRINGS_EVIDENCE']);out.mkdir(exist_ok=True,parents=True);(out/'policy.json').write_text(json.dumps(packet,indent=2)+'\n');print('SCENETOWEB_STATIC_STRING_POLICY_PASSED',len(rows))
