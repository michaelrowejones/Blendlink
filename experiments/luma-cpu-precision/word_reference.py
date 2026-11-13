# SPDX-License-Identifier: GPL-3.0-or-later
"""Native finite binary32 product/add fields, including gradual underflow."""
import hashlib,json,os,sys
from pathlib import Path
import bpy
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
from compositor_luminance_key import _cpu_profile
output=Path(os.environ['BLENDLINK_LUMA_WORD_REFERENCES']).resolve();rng=np.random.default_rng(913741)
boundaries=[0,0x80000000,1,0x80000001,0x7fffff,0x807fffff,0x800000,0x80800000,0x800001,0x80800001,0xffffff,0x80ffffff,
 0x1000000,0x81000000,0x33800000,0xb3800000,0x3f000000,0xbf000000,0x3f800000,0xbf800000,0x7f000000,0xff000000]
for operation in ['MULTIPLY','ADD']:
 profile_before=_cpu_profile()
 pairs=[(a,b)for a in boundaries for b in boundaries]
 while len(pairs)<16384:
  if len(pairs)%2:
   exponent=int(rng.integers(0,28));a=(exponent<<23)|int(rng.integers(0,0x800000));b=a^0x80000000
   b=(b+int(rng.integers(-8,9)))&0xffffffff
  else:a=int(rng.integers(0,0xff000000));b=int(rng.integers(0,0xff000000))
  if a&0x7f800000==0x7f800000 or b&0x7f800000==0x7f800000:continue
  value=np.asarray([a,b],np.uint32).view(np.float32).astype(np.float64)
  result=value[0]*value[1]if operation=='MULTIPLY'else value[0]+value[1]
  if abs(result)>np.finfo(np.float32).max:continue
  pairs.append((a,b))
 words=np.asarray(pairs[:16384],np.uint32)
 # Remove boundary products that overflow; duplicate independent finite controls.
 values=words.view(np.float32).astype(np.float64)
 results=values[:,0]*values[:,1]if operation=='MULTIPLY'else values[:,0]+values[:,1]
 valid=np.isfinite(results)&(abs(results)<=np.finfo(np.float32).max)
 words[~valid]=[0x3f000000,0x3f800000]
 pixels=np.zeros((128,128,4),np.float32);pixels[...,0]=words[:,0].view(np.float32).reshape(128,128);pixels[...,1]=words[:,1].view(np.float32).reshape(128,128);pixels[...,3]=1
 oracle=NativeCompositorReference(output/operation.lower(),pixels=pixels,device='CPU',name='Independent Luma binary32 '+operation,image_only_scene=True,node_previews=False)
 requested_engine=os.environ.get('BLENDLINK_LUMA_CPU_ORACLE_ENGINE')
 assert requested_engine in (None,'CYCLES')
 oracle.scene.render.engine=requested_engine or ('BLENDER_EEVEE'if oracle.modern else'BLENDER_EEVEE_NEXT')
 if requested_engine:oracle.scene.cycles.samples=1;oracle.scene.cycles.use_denoising=False
 sink,source=oracle.reset();parts=oracle.separate(source.outputs['Image']);node=oracle.tree.nodes.new('ShaderNodeMath'if oracle.modern else'CompositorNodeMath');node.operation=operation
 oracle.tree.links.new(parts.outputs['Red'],node.inputs[0]);oracle.tree.links.new(parts.outputs['Green'],node.inputs[1]);oracle.tree.links.new(node.outputs[0],sink.inputs[0]);oracle.save('luma-word-'+operation.lower(),source)
 record=json.loads((oracle.output/(oracle.rows[-1]['case']+'.json')).read_text());expected=np.asarray(record['expected'],np.float32).reshape(-1,4)[:,0]
 ideal=words.view(np.float32).astype(np.float64);ideal=(ideal[:,0]*ideal[:,1]if operation=='MULTIPLY'else ideal[:,0]+ideal[:,1]).astype(np.float32)
 mismatches=np.count_nonzero(expected.view(np.uint32)!=ideal.view(np.uint32))
 profile=_cpu_profile()
 assert profile_before==profile,'Float32 mode changed during actual native compositor tasks'
 model_words=words.copy()
 if profile['mode']=='ftz-daz-rne':
  model_words=np.where((model_words&0x7f800000)==0,model_words&0x80000000,model_words).astype(np.uint32)
 operands=model_words.view(np.float32).astype(np.float64)
 model=(operands[:,0]*operands[:,1]if operation=='MULTIPLY'else operands[:,0]+operands[:,1]).astype(np.float32).view(np.uint32)
 if profile['mode']=='ftz-daz-rne':model=np.where((model&0x7f800000)==0,model&0x80000000,model).astype(np.uint32)
 profile_mismatches=np.count_nonzero(expected.view(np.uint32)!=model)
 assert profile_mismatches==0,('Actual native task vs actual mode certificate',operation,profile,profile_mismatches)
 (oracle.output/'word.json').write_text(json.dumps({'operation':operation.lower(),'native':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),'sourceDevice':'CPU','sourceEngine':oracle.scene.render.engine,'inputWords':words[:,0].tolist(),'divisorWords':words[:,1].tolist(),'expected':expected.tolist(),'expectedWords':expected.view(np.uint32).tolist(),'sourceCpuProfile':profile,'profileStableAcrossNativeTasks':True,'profileModelMismatches':int(profile_mismatches),'mathematicalGradualMismatches':int(mismatches),'seed':913741,'count':len(expected),'width':128,'height':128,'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},separators=(',',':')))
 if bpy.app.version<(5,3,0):assert mismatches==0,('Native gradual primitive mismatch',operation,mismatches)
 oracle.finish('BLENDLINK_LUMA_CPU_WORD_RECORDED')
