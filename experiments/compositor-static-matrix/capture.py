# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent actual CPU compositor vs private CPU-MF copy/permutation pilot."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_static_matrix as matrix,compositor_graph
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_STATIC_MATRIX_CAPTURE']).resolve();DEST.mkdir(parents=True,exist_ok=True)
source_paths=[Path(__file__),ROOT/'experiments/compositor-static-matrix/policy.py',ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py')]
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
pins={str(path.relative_to(ROOT)):sha(path)for path in source_paths}
f32=lambda word:struct.unpack('=f',struct.pack('=I',word))[0]
# Hand-declared native storage words: no quantization, input repair, or expected
# values computed using the port. The transpose permutation is independently
# index-derived from the native columns-first schema.
WORDS=[0,0x3dcccccd,0xbdcccccd,0x3eaaaaab,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,
       0x45001000,0x44fc0400,0x3f4ccccd,0xbf4ccccd,0x3f000001,0x3effffff,0x37800000,0xb7800000]
assert len(WORDS)==16 and all(matrix._normal_word(word)for word in WORDS)
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
rows=[];render_count=0
for transpose in [False,True]:
 for chunk in range(6):
  sink,_=oracle.reset();tree=oracle.tree
  combine=tree.nodes.new('FunctionNodeCombineMatrix')
  for socket,word in zip(combine.inputs,WORDS):socket.default_value=f32(word)
  assert list(matrix._raw_scalars(combine.inputs))==WORDS,'Native source RNA clamped or changed requested storage words'
  previous=combine.outputs['Matrix']
  if transpose:
   node=tree.nodes.new('FunctionNodeTransposeMatrix');tree.links.new(previous,node.inputs['Matrix']);previous=node.outputs['Matrix']
  separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(previous,separate.inputs['Matrix'])
  color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[3].default_value=1
  indices=list(range(chunk*3,min(16,chunk*3+3)))
  for channel,index in enumerate(indices):tree.links.new(separate.outputs[index],color.inputs[channel])
  tree.links.new(color.outputs[0],sink.inputs[0])
  before=matrix._ownership();cache={};expected=[];private=[]
  for index in indices:
   expected.append(WORDS[(index%4)*4+index//4]if transpose else WORDS[index])
   private.append(matrix.evaluate_output(separate.outputs[index],oracle.scene,cache)['word'])
  assert private==expected,(transpose,chunk,'private MF',private,expected)
  assert cache['evaluator'].native_evaluations==1 and matrix._ownership()==before
  program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
  assert len(program['compileTimeMatrices'])==len(indices)and all(row['nativeEvaluations']==1 for row in program['compileTimeMatrices'])
  label=('transpose'if transpose else'combine')+'-'+str(chunk)
  program_path=DEST/(label+'.program.json');program_path.write_text(json.dumps(program,indent=2)+'\n')
  oracle.scene.render.filepath=str(DEST/(label+'.exr'))
  for node in tree.nodes:node.show_preview=False
  bpy.ops.render.render(write_still=True);render_count+=1
  image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
  try:
   assert tuple(image.size)==(4,4)
   raw=np.empty(4*4*4,np.float32);image.pixels.foreach_get(raw);actual=raw.view(np.uint32).reshape(16,4)
   assert np.isfinite(raw).all(),(label,'nonfinite native result')
   # RGB is direct scalar-copy output, alpha is the explicit exact1 carrier.
   wanted=expected+[0]*(3-len(indices))+[0x3f800000]
   assert np.array_equal(actual,np.tile(wanted,(16,1))),(label,actual[0].tolist(),wanted)
   pixel=DEST/(label+'.rgba32f');pixel.write_bytes(raw.tobytes())
  finally:bpy.data.images.remove(image)
  rows.append({'case':label,'transpose':transpose,'endpointIndices':indices,'expectedWords':expected,'privateMFWwords':private,'rgbaWords':wanted,'pixels':16,'wordDifferences':0,'program':program_path.name,'programSha256':sha(program_path),'pixelsFile':pixel.name,'pixelsSha256':sha(pixel)})
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in source_paths},'Pilot inputs changed during capture'
report={'schemaVersion':1,'status':'STATIC_MATRIX_CPU_COMPOSITOR_PILOT_PASSED','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceHashes':pins,
 'stage':'Actual CPU compositor FULL precision plus private Geometry Nodes CPU-MF attribute carrier, copy/permutation only',
 'device':'CPU','sceneEngine':oracle.scene.render.engine,'compositorPrecision':oracle.scene.render.compositor_precision,'outputStorage':'OPEN_EXR_RGBA32F',
 'inputWords':WORDS,'rows':rows,'endpointComparisons':32,'nativeRenders':render_count,'rgbaWords':len(rows)*16*4,'wordDifferences':0,'gpuInitializationCalls':0,'savedFinalCredit':0,'browserCredit':0,'nodePortCredit':0}
(DEST/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),report['endpointComparisons'],report['rgbaWords'])
