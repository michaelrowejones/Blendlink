# SPDX-License-Identifier: GPL-3.0-or-later
"""Real RNA captures prove inactive-default-independent Channel Matte audit.

BLENDLINK_CHANNEL_MATTE_AUDIT_REFERENCES selects retained output. Optional
BLENDLINK_CHANNEL_MATTE_FULL_CATALOG compares against a full/control catalog.
No compiler/runtime sources or user preferences are changed.
"""
from pathlib import Path
import gc,hashlib,importlib.util,json,os,tempfile
import bpy
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('blendlink_node_audit',root/'scripts/audit-node-coverage.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
assert bpy.app.version[:2] in {(5,2),(5,3)},bpy.app.version_string


def channel(catalog):
    return next(node for node in catalog['domains']['compositor']['nodes'] if node['id']=='CompositorNodeChannelMatte')


def union(node):
    return {name:sorted(menu['available']) for name,menu in node['enums'].items()}


def shifted_defaults(tree,identifier):
    node=tree.nodes.new(identifier)
    if identifier=='CompositorNodeChannelMatte':
        # These defaults are inactive in the actual native RGB/Max initial state.
        # Every subsequent BFS candidate is still a real registered RNA node.
        active={'Color Space','Limit Method','RGB Key Channel'}
        for name,choices in audit.CHANNEL_MATTE_MENUS.items():
            if name not in active:
                node.inputs[name].default_value=next(value for value in choices if value!=node.inputs[name].default_value)
    return node


def main(destination):
    budgets=json.loads((root/'docs/node-capabilities.json').read_text()).get('nativeEnumerationBudgets',{})
    budgets['compositor:CompositorNodeChannelMatte']={'states':2048,'transitions':100000}
    rows=[];baseline=None
    for label,factory in [('default',None),('shifted-inactive',shifted_defaults),('repeat-default',None)]:
        catalog=audit.native_catalog(enumeration_budgets=budgets,_node_factory=factory)
        native=channel(catalog);explored=native['enumStateExploration'];scope=explored['semanticScope']
        assert explored['status']=='complete' and explored['stateCount']==48 and not explored['failures'],explored
        assert scope['appliedStates']==48 and scope['genericFallbackStates']==0,scope
        assert len(explored['representativeStates'])==48
        expected_inputs=catalog['socketSchemas'][native['defaultSocketSchema']]['inputs']
        for state in explored['representativeStates']:
            assert set(state['settings'])==set(state['activeSelectors'])
            projected=catalog['socketSchemas'][state['socketSchema']]
            expected_active=set(state['activeSelectors'])
            for original,socket in zip(expected_inputs,projected['inputs']):
                assert all(socket[key]==original[key] for key in ['identifier','type','socketClass','enabled','unavailable'])
                inactive=socket['type']=='MENU' and 'inputs:'+socket['identifier'] not in expected_active
                assert ('default' not in socket)==inactive,(state,socket)
        if baseline is None:
            baseline={'digest':explored['stateDigest'],'menus':union(native),'defaultSchema':native['defaultSocketSchema']}
        else:
            assert explored['stateDigest']==baseline['digest'],'Inactive defaults changed the semantic state digest'
            assert union(native)==baseline['menus'],'An active native menu value disappeared'
            assert (native['defaultSocketSchema']==baseline['defaultSchema'])==(factory is None),'Raw initial defaults were normalized'
        rows.append({'capture':label,'native':catalog['blenderVersion'],'hash':catalog['blenderBuildHash'],
            'stateCount':explored['stateCount'],'stateDigest':explored['stateDigest'],
            'defaultSocketSchema':native['defaultSocketSchema'],'transitions':explored['transitions'],
            'semanticScope':scope,'menuUnion':union(native)})
        (destination/(label+'.json')).write_text(json.dumps(catalog,indent=2)+'\n')
        del catalog;gc.collect()
    comparison=os.environ.get('BLENDLINK_CHANNEL_MATTE_FULL_CATALOG')
    if comparison:
        contents=Path(comparison).read_bytes();reference=json.loads(contents);native=channel(reference)
        assert union(native)==baseline['menus'],'Semantic menu union differs from full/control native audit'
        comparison={'path':str(Path(comparison).resolve()),'sha256':hashlib.sha256(contents).hexdigest(),
            'native':reference['blenderVersion'],'stateCount':native['enumStateExploration']['stateCount'],
            'status':native['enumStateExploration']['status'],'identicalObservedMenuUnion':True}
    report={'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'captures':rows,
        'comparison':comparison,'auditSourceSha256':hashlib.sha256((root/'scripts/audit-node-coverage.py').read_bytes()).hexdigest()}
    (destination/'qualification.json').write_text(json.dumps(report,indent=2)+'\n')
    print('BLENDLINK_CHANNEL_MATTE_SEMANTIC_AUDIT_PASSED',json.dumps({'native':bpy.app.version_string,
        'captures':len(rows),'states':48,'digest':baseline['digest'],'comparison':comparison}))


output=os.environ.get('BLENDLINK_CHANNEL_MATTE_AUDIT_REFERENCES')
if output:
    destination=Path(output).resolve();destination.mkdir(parents=True,exist_ok=True);main(destination)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-channel-matte-audit-') as directory:main(Path(directory))
