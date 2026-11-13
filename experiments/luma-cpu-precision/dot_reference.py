# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native CPU luminance/dot-stage oracle, without browser math."""
import hashlib,json,os,sys
from pathlib import Path
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
from source_presentation import config_from_install
from compositor_luminance_key import _cpu_profile
output=Path(os.environ['BLENDLINK_LUMA_DOT_REFERENCES']).resolve()
profile_before=_cpu_profile()
rng=np.random.default_rng(519317)
pixels=rng.uniform(-16,16,(128,128,4)).astype(np.float32);pixels[...,3]=1
controls=np.asarray([[.1414213478565216]*3,[.1,.2,.3],[1,.53125,.25],[.2,.8,.15],[0,0,0],[-0.,-0.,-0.]],np.float32)
pixels.reshape(-1,4)[:len(controls),:3]=controls
# Explicit word writes retain tiny source values even when Python's current
# Float32 conversions flush them. The native task remains the output oracle.
small=[0,0x80000000,1,0x80000001,0x400000,0x80400000,0x7fffff,0x807fffff,0x800000,0x80800000,0x800001,0x80800001,0x1000000,0x81000000,0x1000001,0x81000001]
triples=np.asarray([(a,b,c)for a in small for b,c in [(a,a),(a^0x80000000,a),(0,0),(a^0x80000000,0)]],np.uint32)
raw=pixels.view(np.uint32).reshape(-1,4);raw[len(controls):len(controls)+len(triples),:3]=triples
oracle=NativeCompositorReference(output,name='Independent CPU luminance stages',pixels=pixels,device='CPU',image_only_scene=True,node_previews=False)
requested_engine=os.environ.get('BLENDLINK_LUMA_CPU_ORACLE_ENGINE')
assert requested_engine in (None,'CYCLES')
oracle.scene.render.engine=requested_engine or ('BLENDER_EEVEE'if oracle.modern else'BLENDER_EEVEE_NEXT')
if requested_engine:oracle.scene.cycles.samples=1;oracle.scene.cycles.use_denoising=False
config,_=config_from_install();weights=np.asarray(config.getDefaultLumaCoefs(),np.float32)
tree=oracle.tree
sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeRGBToBW');tree.links.new(source.outputs['Image'],node.inputs[0]);tree.links.new(node.outputs[0],sink.inputs[0]);oracle.save('luma-dot-native',source)
native=json.loads((output/(oracle.rows[-1]['case']+'.json')).read_text());expected=np.asarray(native['expected'],np.float32).reshape(-1,4)[:,0]
sink,source=oracle.reset();components=oracle.separate(source.outputs['Image'])
def math_node(operation,a,b):
 node=tree.nodes.new('ShaderNodeMath'if oracle.modern else'CompositorNodeMath');node.operation=operation
 for value,socket in zip([a,b],node.inputs):
  if isinstance(value,(int,float,np.floating)):socket.default_value=float(value)
  else:tree.links.new(value,socket)
 return node.outputs[0]
products=[math_node('MULTIPLY',components.outputs[channel],coefficient)for channel,coefficient in zip(['Red','Green','Blue'],weights)]
staged=math_node('ADD',math_node('ADD',products[0],products[1]),products[2]);tree.links.new(staged,sink.inputs[0]);oracle.save('luma-dot-native-stages',source)
control=json.loads((output/(oracle.rows[-1]['case']+'.json')).read_text());staged_expected=np.asarray(control['expected'],np.float32).reshape(-1,4)[:,0]
a=pixels[...,:3].reshape(-1,3);product=(a*weights).astype(np.float32);model=((product[:,0]+product[:,1]).astype(np.float32)+product[:,2]).astype(np.float32)
assert np.array_equal(expected.view(np.uint32),staged_expected.view(np.uint32)),('Native actual dot vs actual native scalar stages',np.count_nonzero(expected.view(np.uint32)!=staged_expected.view(np.uint32)))
assert np.array_equal(expected.view(np.uint32),model.view(np.uint32)),('Native dot vs independent Float32 stages',np.count_nonzero(expected.view(np.uint32)!=model.view(np.uint32)))
profile_after=_cpu_profile()
assert profile_before==profile_after,'Float32 mode changed during actual native compositor tasks'
(output/'dot.json').write_text(json.dumps({'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'sourceDevice':'CPU','sourceEngine':oracle.scene.render.engine,'backend':bpy.context.preferences.system.gpu_backend,'weights':weights.tolist(),'input':a.ravel().tolist(),'expected':expected.tolist(),'inputWords':a.view(np.uint32).ravel().tolist(),'expectedWords':expected.view(np.uint32).tolist(),'seed':519317,'count':len(expected),'width':128,'height':128,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'nativeStagesBitIdentical':True,'sourceCpuProfile':profile_after,'profileStableAcrossNativeTasks':True,'profileModelMismatches':0},separators=(',',':')))
oracle.finish('BLENDLINK_LUMA_CPU_DOT_STAGES_RECORDED')
