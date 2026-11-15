# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native CPU Displace/Translate branch comparison, no source credit."""
from pathlib import Path
from array import array
import hashlib,json,os,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2]
blocked=[0]
def no_gpu(*args,**kwargs):blocked[0]+=1;raise RuntimeError('Displace CPU feasibility forbids gpu.init')
gpu.init=no_gpu
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard did not refuse')
assert blocked==[1];blocked[0]=0
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'packages/blendlink/blender')]
from compositor_reference import NativeCompositorReference
import compositor_graph
DEST=Path(os.environ['SCENETOWEB_DISPLACE_CPU_OUTPUT']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
plan=json.loads(Path(__file__).with_name('cpu-plan.json').read_text());assert plan['supportCredit']==0
paths=[Path(__file__).resolve(),Path(__file__).with_name('cpu-plan.json'),Path(__file__).with_name('sources.json'),ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(path.relative_to(ROOT)):sha(path)for path in paths}
word=lambda v:struct.unpack('=I',struct.pack('=f',v))[0]
value=lambda v:struct.unpack('=f',struct.pack('=I',v))[0]
rows=[];renders=0;oracle=None;size=None;compared=0
for row in plan['cases']:
 width,height=row['width'],row['height']
 if size!=(width,height):
  yy,xx=np.mgrid[:height,:width];pixels=np.stack([(xx%5)/4,(yy%5)/4,((xx+3*yy)%9)/8,np.ones_like(xx)],axis=-1).astype(np.float32)
  oracle=NativeCompositorReference(DEST,device='CPU',pixels=pixels,node_previews=False);size=(width,height)
  assert oracle.scene.render.engine=='CYCLES'and oracle.scene.cycles.device=='CPU'
 outputs={};control_status=None
 for kind,node_type in [('displace','CompositorNodeDisplace'),('translate','CompositorNodeTranslate')]:
  sink,_=oracle.reset();image=oracle.tree.nodes.new('CompositorNodeImage');image.image=oracle.image;node=oracle.tree.nodes.new(node_type);oracle.tree.links.new(image.outputs['Image'],node.inputs['Image']);oracle.tree.links.new(node.outputs['Image'],sink.inputs[0])
  node.inputs['Interpolation'].default_value=row['interpolation']
  for name in ('Extension X','Extension Y'):node.inputs[name].default_value='Clip'
  x,y=map(value,row['displacementWords'])
  if kind=='displace':
   node.inputs['Displacement'].default_value=(x,y);stored=array('f',[0,0]);node.inputs['Displacement'].default_value.foreach_get(stored);assert list(struct.unpack('=2I',stored.tobytes()))==row['displacementWords']
   control_status=compositor_graph.extract(oracle.scene)['status'];assert control_status=='unsupported','Owned generated-image control must not acquire production admission'
  else:node.inputs['X'].default_value=x;node.inputs['Y'].default_value=y
  assert oracle.scene.render.compositor_device=='CPU'and oracle.scene.render.compositor_precision=='FULL'and oracle.scene.render.engine=='CYCLES'and oracle.scene.cycles.device=='CPU'
  for group in bpy.data.node_groups:
   for current in group.nodes:current.show_preview=False
  path=DEST/(row['case']+'-'+kind+'.exr');oracle.scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);renders+=1
  loaded=bpy.data.images.load(str(path),check_existing=False)
  try:actual=array('f',[0])*(width*height*4);loaded.pixels.foreach_get(actual)
  finally:bpy.data.images.remove(loaded)
  raw=DEST/(row['case']+'-'+kind+'.rgba32f');raw.write_bytes(actual.tobytes());outputs[kind]={'path':raw.name,'sha256':sha(raw),'bytes':raw.stat().st_size}
 a=(DEST/outputs['displace']['path']).read_bytes();b=(DEST/outputs['translate']['path']).read_bytes();assert len(a)==width*height*16
 mismatches=sum(a[i:i+4]!=b[i:i+4]for i in range(0,len(a),4));assert mismatches==0,(row['case'],mismatches)
 if row['setting']=='origin':assert a==pixels.tobytes(),'Native origin identity did not preserve independent image words'
 if row['setting']=='maximum':assert a==bytes(len(a)),'Native far-outside Clip did not produce exact transparent black'
 compared+=len(a)//4;rows.append({**row,'outputs':outputs,'wordDifferences':mismatches,'comparedWords':len(a)//4,'sourceExtractionStatus':control_status,'sourceConsumerCredit':0})
assert renders==2*len(plan['cases'])and blocked==[0]
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in paths}
report={'schemaVersion':1,'status':'RESEARCH_EXACT_DISPLACE_TRANSLATE_CPU_BRANCH','supportCredit':0,'sourceConsumerCredit':0,'savedFinalCredit':0,'browserCredit':0,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'stage':'CYCLES CPU carrier + CPU compositor FULL OPEN_EXR32','sourceHashes':pins,'plan':plan,'rows':rows,'nativeRenders':renders,'comparedWords':compared,'wordDifferences':0,'gpuInitGuardProved':True,'gpuInitializationCalls':0,'limits':['Generated finite Image control is deliberately unadmitted; this does not qualify Render Layers source consumers','No native GPU/EEVEE, saved Final or browser proof','Actual native Displace vs actual native Translate; not a host replacement kernel']}
(DEST/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),renders,compared)
