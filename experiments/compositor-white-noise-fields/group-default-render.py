# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU 13x9 group-default counterexample, without GPU initialization."""
from array import array
from pathlib import Path
import json,os,struct,sys
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'experiments/compositor-white-noise')]
from compositor_reference import NativeCompositorReference
from hash_reference import expected,word,f32
import compositor_graph
OUT=Path(os.environ['SCENETOWEB_GROUP_DEFAULT_RENDER']);oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False);tree=oracle.tree;sink,_=oracle.reset()
group=bpy.data.node_groups.new('Owned implicit group default','CompositorNodeTree');seed=group.interface.new_socket(name='Seed',in_out='INPUT',socket_type='NodeSocketVector');seed.default_input='UNIFORM_IMAGE_COORDINATES';group.interface.new_socket(name='Noise',in_out='OUTPUT',socket_type='NodeSocketColor')
entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');noise=group.nodes.new('ShaderNodeTexWhiteNoise');assert noise.noise_dimensions=='2D';group.links.new(entry.outputs[0],noise.inputs['Vector']);group.links.new(noise.outputs['Color'],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs[0],sink.inputs[0])
program=compositor_graph.extract(oracle.scene);assert program['status']=='unsupported'and any(d['code']=='unsupported-white-noise'for d in program['diagnostics']),program
oracle.scene.render.filepath=str(OUT/'implicit-group.exr')
for node in tree.nodes:node.show_preview=False
bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False)
try:
    pixels=array('f',[0])*(13*9*4);image.pixels.foreach_get(pixels);actual=list(struct.unpack('='+str(len(pixels))+'I',pixels.tobytes()))
finally:bpy.data.images.remove(image)
wanted=[]
for y in range(9):
    for x in range(13):wanted+=expected([word(f32((2*x+1-13)/13)),word(f32((2*y+1-9)/13))],'Color')
assert actual==wanted,'Native implicit group did not use the source Uniform coordinate field'
wrong=expected([0,0],'Color');differences=sum(value!=wrong[i%4]for i,value in enumerate(actual));assert differences>0
packet={'status':'RESEARCH_ONLY_NATIVE_GROUP_IMPLICIT_COUNTEREXAMPLE','width':13,'height':9,'sourceInterface':{'default_input':seed.default_input,'structure_type':seed.structure_type},'preFixLiteralWouldBe':[0,0,0],'nativeExpectedFieldWordDifferences':0,'nativeDifferencesFromWrongLiteral':differences,'comparedWords':len(actual),'postFixStatus':program['status'],'diagnostics':program['diagnostics'],'gpuInitializationCalls':0,'portCredit':0}
(OUT/'report.json').write_text(json.dumps(packet,indent=2)+'\n');print(json.dumps(packet))
