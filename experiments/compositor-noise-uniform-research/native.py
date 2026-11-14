# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned no-GPU CPU research capture; never exports or mutates a user source."""
from array import array
from pathlib import Path
import hashlib,json,sys,struct
import bpy,numpy as np,gpu
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent;OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve()
sys.path[:0]=[str(HERE),str(ROOT/'packages/blender-addon/tests')]
from compositor_reference import NativeCompositorReference
from model import compare,word,F,offset
contract=json.loads((HERE/'contract.json').read_text());sources=json.loads((HERE/'sources.json').read_text())
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
source_paths=[HERE/'native.py',HERE/'model.py',HERE/'contract.json',HERE/'sources.json',ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'experiments/compositor-white-noise/hash_reference.py']
pins={str(p.relative_to(ROOT)):sha(p)for p in source_paths}
init_calls=0
original_init=gpu.init

def refuse_gpu(*args,**kwargs):
 global init_calls
 init_calls+=1
 raise AssertionError('Research capture must never initialize GPU')
gpu.init=refuse_gpu
rows=[];controls=[];renders=0

def capture(oracle,label):
 global renders
 path=OUT/(label+'.exr');oracle.scene.render.filepath=str(path)
 for node in oracle.tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True);renders+=1
 image=bpy.data.images.load(str(path),check_existing=False)
 try:
  assert tuple(image.size)==(oracle.width,oracle.height);pixels=array('f',[0])*(oracle.width*oracle.height*4);image.pixels.foreach_get(pixels)
 finally:bpy.data.images.remove(image)
 raw=OUT/(label+'.rgba32f');raw.write_bytes(pixels.tobytes());return list(pixels),{'pixelFile':raw.name,'pixelSha256':sha(raw),'exrFile':path.name,'exrSha256':sha(path)}

try:
 for width,height in contract['extents']:
  oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((height,width,4),np.float32),node_previews=False)
  oracle.scene.cycles.use_denoising=False
  sink,_=oracle.reset();image=oracle.tree.nodes.new('CompositorNodeImage');image.image=oracle.image;coordinates=oracle.tree.nodes.new('CompositorNodeImageCoordinates');oracle.tree.links.new(image.outputs['Image'],coordinates.inputs['Image']);oracle.tree.links.new(coordinates.outputs['Uniform'],sink.inputs[0])
  coords,files=capture(oracle,f'{width}x{height}-uniform');maximum=max(width,height)
  expected=[]
  for y in range(height):
   for x in range(width):expected.extend([F(F(F(F(x+.5)-F(width/2))/maximum)*2),F(F(F(F(y+.5)-F(height/2))/maximum)*2),0.,1.])
  assert list(map(word,coords))==list(map(word,expected))
  controls.append({'width':width,'height':height,**files,'wordDifferences':0})
  output_by_route={}
  for route in contract['routes']:
   sink,_=oracle.reset();noise=oracle.tree.nodes.new('ShaderNodeTexNoise')
   assert noise.noise_dimensions=='2D'and noise.noise_type=='FBM'and noise.normalize
   defaults={name:noise.inputs[name].default_value for name in ['Scale','Detail','Roughness','Lacunarity','Distortion']}
   assert defaults=={'Scale':5.,'Detail':2.,'Roughness':.5,'Lacunarity':2.,'Distortion':0.}
   assert not noise.inputs['Vector'].is_linked
   if route.startswith('scale-zero'):noise.inputs['Scale'].default_value=0
   terminal=noise.outputs['Fac'if route.endswith('fac')else'Color'];oracle.tree.links.new(terminal,sink.inputs[0])
   label=f'{width}x{height}-{route}';source=OUT/(label+'.blend')if(width,height)==(13,9)and route.startswith('default')else None
   if source:bpy.ops.wm.save_as_mainfile(filepath=str(source));source_sha=sha(source)
   actual,files=capture(oracle,label);metrics={model:compare(actual,coords,route,model,contract['precision'])for model in contract['models']}
   if route.endswith('fac'):
    for i in range(0,len(actual),4):
     if route.startswith('scale-zero')or coords[i]==0 and coords[i+1]==0:assert word(actual[i])==word(.5),(label,i,actual[i])
   row={'case':label,'width':width,'height':height,'route':route,'defaults':defaults,'vectorLinked':False,'nativeAlphaExact':all(word(v)==word(1)for v in actual[3::4]),**files,'models':metrics}
   if source:assert sha(source)==source_sha;row.update(sourceFile=source.name,sourceSha256=source_sha,sourcePreserved=True)
   rows.append(row);output_by_route[route]=actual
  for prefix in ['default','scale-zero']:
   assert all(word(a)==word(b)for a,b in zip(output_by_route[prefix+'-fac'][::4],output_by_route[prefix+'-color'][::4])), 'Native Color.red and Fac must agree'
 assert renders==contract['nativeRenders']and init_calls==0
 assert pins=={str(p.relative_to(ROOT)):sha(p)for p in source_paths}
 report={'schemaVersion':1,'status':'NOISE_UNIFORM_CPU_RESEARCH_CAPTURED','sourceProfile':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'engine':'CYCLES','compositor':'CPU','precision':'FULL'},'contractSha256':sha(HERE/'contract.json'),'sourceHashes':pins,'primarySources':sources,'offsetHypotheses':{str(seed):[hex(word(v))for v in offset(seed)]for seed in [2,3]},'coordinateControls':controls,'cases':rows,'nativeRenders':renders,'pythonGpuInitializationCalls':init_calls,'gpuRuns':0,'finalCredit':0,'browserCredit':0,'portCredit':0}
 (OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],renders)
finally:gpu.init=original_init
