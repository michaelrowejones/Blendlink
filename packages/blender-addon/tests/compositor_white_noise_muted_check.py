# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned5.3 source policy; no render or numeric qualification.
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_WHITE_NOISE_MUTED_POLICY_PASSED
"""Refuse only the unqualified 5.3 White Noise type-changing mute edge."""
from pathlib import Path
from types import SimpleNamespace
import json,sys
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
import compositor_graph
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;scene.render.compositor_device='CPU'
positive=[];refusals=[]


def build(dimensions,output,linked=False):
    tree=bpy.data.node_groups.new('Owned White Noise mute '+dimensions+' '+output,'CompositorNodeTree')
    tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
    node=tree.nodes.new('ShaderNodeTexWhiteNoise');node.noise_dimensions=dimensions
    if node.inputs.get('Vector')is not None:node.inputs['Vector'].default_value=(.125,.25,.5)
    if node.inputs.get('W')is not None:node.inputs['W'].default_value=.25
    node.mute=True
    if linked:
        vector=tree.nodes.new('ShaderNodeCombineXYZ')
        for socket,value in zip(vector.inputs,(.125,.25,.5)):socket.default_value=value
        tree.links.new(vector.outputs[0],node.inputs['Vector'])
    sink=tree.nodes.new('NodeGroupOutput');tree.links.new(node.outputs[output],sink.inputs[0])
    return node,tree,sink


for dimensions in ['1D','2D','3D','4D']:
    for output in ['Value','Color']:
        node,tree,sink=build(dimensions,output)
        links=[link for link in node.internal_links if link.to_socket==node.outputs[output]]
        program=compositor_graph.extract(scene);label=dimensions+'-'+output
        if len(links)!=1:
            assert program['status']=='unsupported'and any(d['code']=='muted-mapping'for d in program['diagnostics']),(label,program)
            refusals.append(label+'-no-native-mapping')
        elif links[0].from_socket.type!=node.outputs[output].type:
            assert program['status']=='unsupported'and any(d['code']=='unsupported-white-noise-muted-bypass'for d in program['diagnostics']),(label,program)
            refusals.append(label+'-type-change')
        else:
            assert dimensions in {'1D','4D'}and output=='Value'
            assert program['status']=='extracted'and not program['ops'],(label,program)
            assert program['output']=={'kind':'convert','fromType':'VALUE','type':'RGBA','input':{'kind':'constant','type':'VALUE','value':.25}},program
            positive.append(label+'-same-type-W')

# A linked Vector does not qualify the Vector-to-Float mute conversion either.
for dimensions in ['2D','3D']:
    node,tree,sink=build(dimensions,'Value',True);program=compositor_graph.extract(scene)
    assert program['status']=='unsupported'and any(d['code']=='unsupported-white-noise-muted-bypass'for d in program['diagnostics']),program
    refusals.append(dimensions+'-linked-vector-type-change')

# Unmuted default2D is still its live field route; the new guard does not enter
# the normalizer or change any arithmetic/domain admission.
node,tree,sink=build('2D','Value');node.mute=False;scene.render.resolution_x=13;scene.render.resolution_y=9;scene.render.resolution_percentage=100
program=compositor_graph.extract(scene)
assert program['status']=='extracted'and program['ops'][0]['properties']['white_noise_model']=='native-compositor-white-noise-uniform-cpu-53-v1',program
positive.append('unmuted-default-field-unchanged')

# A different class keeps its existing mute behavior. This is a source policy
# boundary control, not qualification of additional native mute conversions.
tree=bpy.data.node_groups.new('Owned unrelated mute','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
other=tree.nodes.new('ShaderNodeMath');other.inputs[0].default_value=.25;other.mute=True;sink=tree.nodes.new('NodeGroupOutput');tree.links.new(other.outputs[0],sink.inputs[0])
program=compositor_graph.extract(scene);assert program['status']=='extracted'and not program['ops'],program
positive.append('other-node-unchanged')

# Exercise only the version policy branch with actual5.3 sockets. No older
# Blender execution, availability, arithmetic or numerical credit is asserted.
node,tree,sink=build('2D','Value');original=compositor_graph.bpy
try:
    for version in [(4,2,0),(5,2,0)]:
        compositor_graph.bpy=SimpleNamespace(app=SimpleNamespace(version=version,version_string='.'.join(map(str,version))),context=bpy.context)
        program=compositor_graph.extract(scene)
        assert program['status']=='extracted'and not any(d['code']=='unsupported-white-noise-muted-bypass'for d in program['diagnostics']),program
        positive.append('older-policy-bypass-'+'.'.join(map(str,version)))
finally:compositor_graph.bpy=original

# The preceding owned actual CPU counterexample is immutable diagnostic data:
# native muted2D Value is black, while the old extractor returned stored RGB
# [.125,.25,.5]. It is NOT evidence of a varying implicit field through mute.
counterexample={'nativeBuild':'02f0899d78e3','nativeBinarySha256':'53c8e8266f4e3f619a7c3e87c3a8d34a846339d50f55ebe193cf9ad3528153da',
 'reportSha256':'7b75f392276eceb616da5691c3371233baac52aa789e7b54598b4d7d8fc3408d',
 'rawFloat32Sha256':'213aec83b934358b1e12903a77b13a70be806e3f57b3f5f5b086fb5dd7c7ec2b',
 'guardArchiveRecordSha256':'8f357ce53910fc24cd652dfe5c198f0b5117bd9ab252212ba453199e0b69c7b3',
 'portCredit':0,'machineLocalIgnoredArtifacts':'/private/tmp/scenetoweb-white-noise-field-reader-next/artifacts/verification-white-noise-muted-source'}
print('BLENDLINK_COMPOSITOR_WHITE_NOISE_MUTED_POLICY_PASSED '+json.dumps({'positive':positive,'refusals':refusals,'renders':0,'gpuInitializationCalls':0,'portCredit':0,'historicalCounterexample':counterexample}))
