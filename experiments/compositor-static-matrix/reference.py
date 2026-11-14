# SPDX-License-Identifier: GPL-3.0-or-later
"""Frozen CPU compositor references; actual Matrix classes stay in saved source."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_static_matrix as matrix,compositor_graph
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_STATIC_MATRIX_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
case_path=ROOT/'experiments/compositor-static-matrix/cases.json';CASES=json.loads(case_path.read_text())
paths=[Path(__file__),ROOT/'experiments/compositor-static-matrix/policy.py',case_path,ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(p.relative_to(ROOT)):sha(p)for p in paths}
f32=lambda word:struct.unpack('=f',struct.pack('=I',word))[0]
WORDS=[0,0x3dcccccd,0xbdcccccd,0x3eaaaaab,0x00800000,0x80800000,0x7f7fffff,0xff7fffff,
       0x45001000,0x44fc0400,0x3f4ccccd,0xbf4ccccd,0x3f000001,0x3effffff,0x37800000,0xb7800000]
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False)
rows=[]
def grouped(tree,color,route):
 group=bpy.data.node_groups.new('Artist '+route,'CompositorNodeTree');group.interface.new_socket(name='Number',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Result',in_out='OUTPUT',socket_type='NodeSocketMatrix'if route=='matrix-group'else'NodeSocketFloat')
 entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');combine=group.nodes.new('FunctionNodeCombineMatrix');group.links.new(entry.outputs[0],combine.inputs[0]);transpose=group.nodes.new('FunctionNodeTransposeMatrix');group.links.new(combine.outputs[0],transpose.inputs[0]);source=transpose.outputs[0]
 if route=='float-group':
  separate=group.nodes.new('FunctionNodeSeparateMatrix');group.links.new(source,separate.inputs[0]);source=separate.outputs[0]
 group.links.new(source,exit.inputs[0]);terminals=[]
 for channel,value in enumerate([.25,.75]):
  instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=value;reroute=tree.nodes.new('NodeReroute');tree.links.new(instance.outputs[0],reroute.inputs[0]);source=reroute.outputs[0]
  if route=='matrix-group':
   separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(source,separate.inputs[0]);source=separate.outputs[0];terminals.append((source,()))
  else:terminals.append((next(n for n in group.nodes if n.bl_idname=='FunctionNodeSeparateMatrix').outputs[0],(instance,)))
  tree.links.new(source,color.inputs[channel])
 color.inputs[2].default_value=1
 return terminals,[0x3e800000,0x3f400000,0x3f800000,0x3f800000]
for definition in CASES:
 sink,_=oracle.reset();tree=oracle.tree;color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[3].default_value=1;tree.links.new(color.outputs[0],sink.inputs[0])
 if definition['route']=='direct':
  combine=tree.nodes.new('FunctionNodeCombineMatrix')
  for socket,word in zip(combine.inputs,WORDS):socket.default_value=f32(word)
  assert list(matrix._raw_scalars(combine.inputs))==WORDS,'Native source RNA changed requested storage words'
  source=combine.outputs[0]
  if definition['transpose']:
   transpose=tree.nodes.new('FunctionNodeTransposeMatrix');tree.links.new(source,transpose.inputs[0]);source=transpose.outputs[0]
  separate=tree.nodes.new('FunctionNodeSeparateMatrix');tree.links.new(source,separate.inputs[0]);terminals=[];wanted=[]
  for channel,index in enumerate(definition['indices']):
   tree.links.new(separate.outputs[index],color.inputs[channel]);terminals.append((separate.outputs[index],()));wanted.append(WORDS[(index%4)*4+index//4]if definition['transpose']else WORDS[index])
  wanted += [0]*(3-len(wanted))+[0x3f800000]
 else:terminals,wanted=grouped(tree,color,definition['route'])
 before=matrix._ownership();cache={};private=[matrix.evaluate_output(socket,oracle.scene,cache,stack)['word']for socket,stack in terminals]
 assert private==wanted[:len(terminals)]and before==matrix._ownership(),(definition,private,wanted)
 assert cache['evaluator'].native_evaluations==(1 if definition['route']=='direct'else 2)
 program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program
 assert len(program['compileTimeMatrices'])==len(terminals)and all(op['kind']in{'value','combine-color'}for op in program['ops'])
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
 source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 oracle.scene.render.filepath=str(DEST/(label+'.exr'))
 for node in tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
 try:
  assert tuple(image.size)==(4,4);raw=np.empty(64,np.float32);image.pixels.foreach_get(raw)
  assert np.isfinite(raw).all()and np.array_equal(raw.view(np.uint32).reshape(16,4),np.tile(wanted,(16,1))),(label,raw.view(np.uint32).reshape(16,4)[0].tolist(),wanted)
  pixel=DEST/(label+'.rgba32f');pixel.write_bytes(raw.tobytes())
 finally:bpy.data.images.remove(image)
 yy,xx=np.mgrid[:4,:4];control=np.stack([xx/16,yy/16,(xx+3*yy)/64,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
 row={**definition,'rgbaWords':wanted,'privateMFWords':private,'nativeEvaluations':cache['evaluator'].native_evaluations,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel.name,'pixelSha256':sha(pixel),'inputFile':input_file.name,'inputSha256':sha(input_file)}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
assert pins=={str(path.relative_to(ROOT)):sha(path)for path in paths},'Native sources changed during capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_STATIC_MATRIX','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'wordDifferences':0,'inputWords':WORDS,'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
