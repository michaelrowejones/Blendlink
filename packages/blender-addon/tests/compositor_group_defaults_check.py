# blendlink-headless-suite: manual Requires pinned Blender 5.3 source policy; no numerical render credit.
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_GROUP_DEFAULTS_POLICY_PASSED
# SPDX-License-Identifier: GPL-3.0-or-later
"""Concrete independent leaf-path and public cross-context interface probes."""
from pathlib import Path
import json,os,sys
import bpy
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
scene=bpy.context.scene;scene.render.compositor_device='CPU';rows=[]

def build(case,socket_type,default,operation):
    tree=bpy.data.node_groups.new('Owned generic '+case,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
    group=bpy.data.node_groups.new('Owned inner '+case,'CompositorNodeTree');seed=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type=socket_type);seed.default_input=default;group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketFloat')
    entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput')
    if operation=='math':
        node=group.nodes.new('ShaderNodeMath');node.operation='ADD';node.inputs[1].default_value=.25;group.links.new(entry.outputs[0],node.inputs[0]);terminal=node.outputs[0]
    elif operation=='vector':
        node=group.nodes.new('ShaderNodeSeparateXYZ');group.links.new(entry.outputs[0],node.inputs[0]);terminal=node.outputs['X']
    elif operation=='selector':
        node=group.nodes.new('GeometryNodeIndexSwitch');node.data_type='FLOAT';node.inputs[1].default_value=.25;node.inputs[2].default_value=.75;group.links.new(entry.outputs[0],node.inputs['Index']);terminal=node.outputs[0]
    elif operation=='string':
        node=group.nodes.new('FunctionNodeValueToString');node.data_type='INT';length=group.nodes.new('FunctionNodeStringLength');group.links.new(entry.outputs[0],next(s for s in node.inputs if s.identifier=='Value' and s.type=='INT' and s.enabled and not s.is_unavailable));group.links.new(node.outputs[0],length.inputs[0]);terminal=length.outputs[0]
    elif operation=='matrix':
        combine=group.nodes.new('FunctionNodeCombineMatrix');separate=group.nodes.new('FunctionNodeSeparateMatrix');group.links.new(entry.outputs[0],combine.inputs[0]);group.links.new(combine.outputs[0],separate.inputs[0]);terminal=separate.outputs[0]
    elif operation=='quaternion':
        combine=group.nodes.new('FunctionNodeQuaternionToRotation');combine.inputs['X'].default_value=1;separate=group.nodes.new('FunctionNodeRotationToQuaternion');group.links.new(entry.outputs[0],combine.inputs['W']);group.links.new(combine.outputs[0],separate.inputs[0]);terminal=separate.outputs['W']
    group.links.new(terminal,exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;sink=tree.nodes.new('NodeGroupOutput');tree.links.new(instance.outputs[0],sink.inputs[0]);return tree,group,seed,instance

import compositor_group_defaults as policy,compositor_static_matrix as matrix
positive=[];refusals=[]
for operation,kind,implicit in [('math','NodeSocketFloat','SCENE_FRAME'),('vector','NodeSocketVector','UNIFORM_IMAGE_COORDINATES'),('selector','NodeSocketInt','SCENE_FRAME'),('string','NodeSocketInt','SCENE_FRAME'),('matrix','NodeSocketFloat','SCENE_FRAME'),('quaternion','NodeSocketFloat','SCENE_FRAME')]:
    for mode in ['VALUE','implicit','linked']:
        tree,group,seed,instance=build(operation+'-'+mode,kind,'VALUE'if mode=='VALUE'else implicit,operation)
        if mode=='linked':
            producer=tree.nodes.new('FunctionNodeInputInt'if kind=='NodeSocketInt'else 'ShaderNodeCombineXYZ'if kind=='NodeSocketVector'else 'ShaderNodeValue')
            if kind=='NodeSocketInt':producer.integer=1
            if kind=='NodeSocketFloat':producer.outputs[0].default_value=1
            tree.links.new(producer.outputs[0],instance.inputs[0])
        program=compositor_graph.extract(scene)
        if mode=='implicit':
            assert program['status']=='unsupported',(operation,mode,program);refusals.append(operation+'-'+mode)
            assert any('group'in d['message'].lower() for d in program['diagnostics']),program
        else:
            assert program['status']=='extracted',(operation,mode,program);positive.append(operation+'-'+mode)
# Every native input family remains legal with literal VALUE interfaces.
for kind in ['NodeSocketFloat','NodeSocketVector','NodeSocketInt','NodeSocketBool','NodeSocketColor','NodeSocketString','NodeSocketMenu','NodeSocketMatrix','NodeSocketRotation']:
    group=bpy.data.node_groups.new('Owned type '+kind,'CompositorNodeTree');group.interface.new_socket(name='Seed',in_out='INPUT',socket_type=kind)
    node=scene.compositing_node_group.nodes.new('CompositorNodeGroup');node.node_tree=group;policy.validate_input(node.inputs[0]);positive.append('schema-'+kind)
# A public cross-tree copy has an unsupported forced-structure enum. Even a
# valid link does not qualify its domain; no private DNA setters are used.
for structure in ['FIELD','GRID','DYNAMIC','LIST']:
    geometry=bpy.data.node_groups.new('Owned geometry '+structure,'GeometryNodeTree');source=geometry.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketFloat');source.structure_type=structure
    tree,group,seed,instance=build('copy-'+structure,'NodeSocketFloat','VALUE','math');copied=group.interface.copy(source);group.interface_update(bpy.context)
    value=tree.nodes.new('ShaderNodeValue');tree.links.new(value.outputs[0],instance.inputs[copied.identifier])
    try:policy.validate_input(instance.inputs[copied.identifier]);raise AssertionError('Copied structure accepted')
    except policy.GroupDefaultUnsupported as error:assert 'structure'in str(error)
    refusals.append('linked-copied-'+structure)
# Cached private-MF results cannot outlive an interface-only mutation.
for timing in ['after-cache','during-private-evaluation']:
    tree,group,seed,instance=build('stale-'+timing,'NodeSocketFloat','VALUE','matrix');endpoint=next(n for n in group.nodes if n.bl_idname=='FunctionNodeSeparateMatrix').outputs[0];cache={}
    if timing=='after-cache':
        matrix.evaluate_output(endpoint,scene,cache,stack=(instance,));seed.default_input='SCENE_FRAME'
    else:
        evaluator=matrix._Evaluator(scene,None);cache['evaluator']=evaluator;original=evaluator.native
        def changed(expression):
            result=original(expression);seed.default_input='SCENE_FRAME';return result
        evaluator.native=changed
    try:matrix.evaluate_output(endpoint,scene,cache,stack=(instance,));raise AssertionError('Stale interface accepted')
    except matrix.StaticMatrixUnsupported as error:assert 'changed'in str(error)or'implicit'in str(error),(timing,str(error))
    refusals.append('stale-interface-'+timing)

# A generic earlier branch is not part of a later unrelated private-MF recipe.
# Capture its group interfaces too, including memoized output returns. No render
# or authored tree is sent into the private evaluator; mutations are owned test
# handler controls and the real private one-point CPU-MF evaluation still runs.
for mode in ['unchanged','default-input','structure','memoized-default','inactive-default']:
    tree,group,seed,instance=build('generic-before-mf-'+mode,'NodeSocketFloat','VALUE','math')
    instance.inputs[0].default_value=.5
    combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(combine.outputs[0],separate.inputs[0])
    addition=tree.nodes.new('ShaderNodeMath');addition.operation='ADD'
    first=instance.outputs[0]
    if mode=='inactive-default':
        selected=tree.nodes.new('GeometryNodeSwitch');selected.input_type='FLOAT';selected.inputs['Switch'].default_value=False;selected.inputs['False'].default_value=.25
        tree.links.new(first,selected.inputs['True']);first=selected.outputs[0]
    tree.links.new(first,addition.inputs[0]);tree.links.new(separate.outputs[0],addition.inputs[1]);terminal=addition.outputs[0]
    if mode=='memoized-default':
        again=tree.nodes.new('ShaderNodeMath');again.operation='ADD';tree.links.new(terminal,again.inputs[0]);tree.links.new(instance.outputs[0],again.inputs[1]);terminal=again.outputs[0]
    sink=next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput');tree.links.new(terminal,sink.inputs[0])
    original=matrix._Evaluator.native;calls=[]
    def changed_generic(self,expression):
        result=original(self,expression)
        if mode=='structure':seed.structure_type='SINGLE'
        elif mode!='unchanged':seed.default_input='SCENE_FRAME'
        calls.append(mode);return result
    matrix._Evaluator.native=changed_generic
    try:program=compositor_graph.extract(scene)
    finally:matrix._Evaluator.native=original
    assert calls==[mode],(mode,calls,program)
    if mode in {'unchanged','inactive-default'}:
        assert program['status']=='extracted',(mode,program);positive.append('generic-mf-'+mode)
    else:
        assert program['status']=='unsupported',(mode,program)
        assert any(d['code']=='group-interface-changed' for d in program['diagnostics']),(mode,program)
        refusals.append('generic-mf-'+mode)

# Selector/string helpers traverse their own contributing group edges rather
# than compositor_graph.input_value. A late unrelated MF handler must not leave
# either earlier pure policy result cached from an implicit group input.
for operation in ['selector','string']:
    tree=bpy.data.node_groups.new('Owned helper close '+operation,'CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
    group=bpy.data.node_groups.new('Owned helper source '+operation,'CompositorNodeTree');seed=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketInt');seed.default_input='VALUE';group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketInt')
    entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=1
    if operation=='selector':
        early=tree.nodes.new('GeometryNodeIndexSwitch');early.data_type='FLOAT';tree.links.new(instance.outputs[0],early.inputs['Index']);early.inputs[1].default_value=.25;early.inputs[2].default_value=.75;first=early.outputs[0]
    else:
        formatter=tree.nodes.new('FunctionNodeValueToString');formatter.data_type='INT';tree.links.new(instance.outputs[0],next(s for s in formatter.inputs if s.identifier=='Value'and s.type=='INT'and s.enabled and not s.is_unavailable));early=tree.nodes.new('FunctionNodeStringLength');tree.links.new(formatter.outputs[0],early.inputs[0]);first=early.outputs[0]
    combine=tree.nodes.new('FunctionNodeCombineMatrix');separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(combine.outputs[0],separate.inputs[0]);addition=tree.nodes.new('ShaderNodeMath');addition.operation='ADD';tree.links.new(first,addition.inputs[0]);tree.links.new(separate.outputs[0],addition.inputs[1]);sink=tree.nodes.new('NodeGroupOutput');tree.links.new(addition.outputs[0],sink.inputs[0])
    original=matrix._Evaluator.native;calls=[]
    def changed_helper(self,expression):
        result=original(self,expression);seed.default_input='SCENE_FRAME';calls.append(operation);return result
    matrix._Evaluator.native=changed_helper
    try:program=compositor_graph.extract(scene)
    finally:matrix._Evaluator.native=original
    assert calls==[operation],(operation,calls,program)
    assert program['status']=='unsupported'and any(d['code']=='static-policy-source-changed'for d in program['diagnostics']),(operation,program)
    refusals.append('late-helper-group-'+operation)
# Unrelated Shader groups retain their established default semantics.
material=bpy.data.materials.new('Owned shader policy');material.use_nodes=True;group=bpy.data.node_groups.new('Owned shader group','ShaderNodeTree');group.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketFloat');instance=material.node_tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;policy.validate_input(instance.inputs[0]);assert policy.interface_signature(instance)is None;positive.append('shader-unchanged')

# Version guard is independent of the unavailable older native binaries; this
# is a host policy boundary check, not older-version numerical qualification.
from types import SimpleNamespace
original_bpy=policy.bpy
try:
    for version in [(4,5,0),(5,0,0),(5,2,0)]:
        policy.bpy=SimpleNamespace(app=SimpleNamespace(version=version))
        fake=SimpleNamespace(bl_idname='CompositorNodeGroup')
        assert policy.interface_signature(fake)is None
        policy.validate_input(SimpleNamespace(node=fake))
finally:policy.bpy=original_bpy


# Source extension aliases load canonical policies before addon-authored ones.
import importlib,types
alias='scenetoweb_group_policy_source_alias'
package=types.ModuleType(alias);package.__path__=[str(ROOT/'packages/blendlink/blender')];sys.modules[alias]=package
aliased=importlib.import_module(alias+'.compositor_graph')
assert aliased.group_defaults is sys.modules[alias+'.compositor_group_defaults']
assert aliased.static_selection._group_input is aliased.group_defaults.validate_input
positive.append('canonical-source-package-alias')

# Only contributing edges are guarded; an inactive implicit-default branch is
# still pruned by the existing source-derived static selector.
tree,group,seed,instance=build('inactive-implicit','NodeSocketFloat','SCENE_FRAME','math')
switch=tree.nodes.new('GeometryNodeSwitch');switch.input_type='FLOAT';switch.inputs['Switch'].default_value=False;switch.inputs['False'].default_value=.25
tree.links.new(instance.outputs[0],switch.inputs['True']);sink=next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput');tree.links.new(switch.outputs[0],sink.inputs[0])
program=compositor_graph.extract(scene);assert program['status']=='extracted'and program['output']['input']['value']==.25,program;positive.append('inactive-implicit-pruned')
# SINGLE is a legal literal schema, without qualifying any linked field cast.
seed.default_input='VALUE';seed.structure_type='SINGLE';policy.validate_input(instance.inputs[0]);positive.append('literal-SINGLE')
print('BLENDLINK_COMPOSITOR_GROUP_DEFAULTS_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'renders':0,'gpuInitializationCalls':0}))
