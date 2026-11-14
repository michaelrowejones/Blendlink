# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual CPU constant-unit regression for the dynamic GPU conversion seed."""
from array import array
from pathlib import Path
import json,os,struct,sys
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon/tests')]
from compositor_reference import NativeCompositorReference
OUT=Path(os.environ['SCENETOWEB_WHITE_NOISE_FIXED_SEED']);oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
sink,_=oracle.reset();tree=oracle.tree;node=tree.nodes.new('ShaderNodeTexWhiteNoise');assert node.noise_dimensions=='2D'
combine=tree.nodes.new('ShaderNodeCombineXYZ');words=[3211546309,3206384089,0];raw=array('f');raw.frombytes(struct.pack('=3I',*words));combine.inputs.foreach_set('default_value',raw)
tree.links.new(combine.outputs[0],node.inputs['Vector']);tree.links.new(node.outputs['Value'],sink.inputs[0]);oracle.scene.render.filepath=str(OUT/'fixed-seed.exr')
for item in tree.nodes:item.show_preview=False
bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False)
try:
    pixels=array('f',[0])*64;image.pixels.foreach_get(pixels);actual=list(struct.unpack('=64I',pixels.tobytes()));expected=[1062880625]*3+[1065353216]
    assert all(actual[index:index+4]==expected for index in range(0,64,4)),actual[:4]
finally:bpy.data.images.remove(image)
packet={'status':'RESEARCH_ONLY_NATIVE_FIXED_FAILED_SEED','sourceWords':words,'nativeRGBAWords':actual[:4],'comparedWords':64,'wordDifferences':0,'gpuInitializationCalls':0,'portCredit':0,'browserCredit':0,'savedFinalCredit':0}
(OUT/'fixed-seed.json').write_text(json.dumps(packet,indent=2)+'\n');print(json.dumps(packet))
