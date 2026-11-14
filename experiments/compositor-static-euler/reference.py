# SPDX-License-Identifier: GPL-3.0-or-later
"""Unchanged actual CPU compositor Euler construction vs guarded private MF words."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph,compositor_static_euler as euler,compositor_static_matrix as shared
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_STATIC_EULER_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True);case_path=ROOT/'experiments/compositor-static-euler/cases.json';CASES=json.loads(case_path.read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=[Path(__file__),ROOT/'experiments/compositor-static-euler/policy.py',case_path,ROOT/'packages/blender-addon/tests/compositor_static_euler_check.py',ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')];pins={str(p.relative_to(ROOT)):sha(p)for p in paths}
def floats(words):
 raw=array('f');raw.frombytes(struct.pack('='+str(len(words))+'I',*words));return raw
def forbidden(*args,**kwargs):raise AssertionError('CPU Euler reference must not initialize GPU')
gpu.init=forbidden
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False);rows=[];calibration=[];renders=0

def image_words(label):
 global renders
 oracle.scene.render.filepath=str(DEST/(label+'.exr'))
 for node in oracle.tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True);renders+=1;image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
 try:
  assert tuple(image.size)==(4,4);pixels=np.empty(64,np.float32);image.pixels.foreach_get(pixels);actual=pixels.view(np.uint32).reshape(16,4);assert np.isfinite(pixels).all()and np.array_equal(actual,np.tile(actual[0],(16,1)));return pixels
 finally:bpy.data.images.remove(image)

def hash_carrier(source,label):
 tree=oracle.tree;sink=next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput');original=sink.inputs[0].links[0].from_socket if sink.inputs[0].links else None;before=set(tree.nodes)
 try:
  h=tree.nodes.new('FunctionNodeHashValue');h.data_type='FLOAT';h.inputs['Seed'].default_value=0;tree.links.new(source,next(s for s in h.inputs if s.name=='Value'and s.enabled and not s.is_unavailable));low=tree.nodes.new('FunctionNodeBitMath');low.operation='AND';low.inputs['B'].default_value=65535;tree.links.new(h.outputs['Hash'],low.inputs['A']);high=tree.nodes.new('FunctionNodeIntegerMath');high.operation='DIVIDE_FLOOR';high.inputs[1].default_value=65536;tree.links.new(h.outputs['Hash'],high.inputs[0]);color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[2].default_value=123;color.inputs[3].default_value=1;tree.links.new(low.outputs[0],color.inputs[0]);tree.links.new(high.outputs[0],color.inputs[1]);tree.links.new(color.outputs[0],sink.inputs[0]);pixels=image_words(label);values=pixels.reshape(16,4)[0];lo,hi,marker,alpha=map(float,values);assert lo==int(lo)and hi==int(hi)and 0<=lo<=65535 and -32768<=hi<=32767 and marker==123 and alpha==1;hash_word=((int(hi)<<16)|int(lo))&0xffffffff;file=DEST/(label+'.rgba32f');file.write_bytes(pixels.tobytes());return{'hashWord':hash_word,'carrierWords':pixels.view(np.uint32).reshape(16,4)[0].tolist(),'pixelFile':file.name,'pixelSha256':sha(file)}
 finally:
  for node in set(tree.nodes)-before:tree.nodes.remove(node)
  if original:tree.links.new(original,sink.inputs[0])

for word in [0,0x80000000,1,0x007fffff,0x80000001,0x807fffff,0x00800000,0x3dcccccd]:
 sink,_=oracle.reset();value=oracle.tree.nodes.new('ShaderNodeValue');value.outputs.foreach_set('default_value',floats([word]));stored=array('f',[0]);value.outputs.foreach_get('default_value',stored);assert struct.unpack('=I',stored.tobytes())[0]==word;row={'sourceWord':word,**hash_carrier(value.outputs[0],'calibration-'+str(word))};assert row['hashWord']==euler._hash_word(word);calibration.append(row)
assert len({r['hashWord']for r in calibration})==8
for definition in CASES:
 sink,_=oracle.reset();tree=oracle.tree;route=definition['route'];constructor=tree.nodes.new('FunctionNodeEulerToRotation');constructor.inputs.foreach_set('default_value',floats(definition['inputWords']));assert list(euler._raw_euler(constructor))==definition['inputWords'];source=constructor.outputs['Rotation'];stack=()
 if route=='producer-group':
  group=bpy.data.node_groups.new('Artist Euler Literal','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');exit=group.nodes.new('NodeGroupOutput');inside=group.nodes.new('FunctionNodeEulerToRotation');inside.inputs.foreach_set('default_value',floats(definition['inputWords']));group.links.new(inside.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;source=instance.outputs[0];constructor=inside
 elif route=='rotation-group':
  group=bpy.data.node_groups.new('Artist Rotation Pass','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);source=instance.outputs[0]
 elif route=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
 if route=='endpoint-group':
  group=bpy.data.node_groups.new('Artist Euler Endpoints','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation')
  for name in euler.COMPONENTS:group.interface.new_socket(name=name,in_out='OUTPUT',socket_type='NodeSocketFloat')
  entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');separate=group.nodes.new('FunctionNodeRotationToQuaternion');group.links.new(entry.outputs[0],separate.inputs[0])
  for name in euler.COMPONENTS:group.links.new(separate.outputs[name],exit.inputs[name])
  instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);outputs=instance.outputs;stack=(instance,)
 else:
  separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(source,separate.inputs[0]);outputs=separate.outputs
 color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[3].default_value=1
 for channel,index in enumerate(definition['indices']):tree.links.new(outputs[euler.COMPONENTS[index]],color.inputs[channel])
 tree.links.new(color.outputs[0],sink.inputs[0]);before=shared._ownership();cache={};private=[euler.evaluate_output(separate.outputs[euler.COMPONENTS[index]],oracle.scene,cache,stack,compositor_graph.static_selection.static_selection)['word']for index in definition['indices']];assert before==shared._ownership();assert cache['evaluator'].native_evaluations==1
 if 'manualQuaternionWords'in definition:assert private==[definition['manualQuaternionWords'][i]for i in definition['indices']]
 program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program;assert len(program['compileTimeRotations'])==len(definition['indices']);assert all(op['kind']in{'value','combine-color'}for op in program['ops']);assert [r['word']for r in program['compileTimeRotations']]==private;assert all(r['model']==euler.MODEL and r['preFloatStoreHashGuard']and r['eulerInputWords']==definition['inputWords']for r in program['compileTimeRotations'])
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n');source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 pixels=image_words(label);wanted=private+[0]*(3-len(private))+[0x3f800000];assert np.array_equal(pixels.view(np.uint32).reshape(16,4),np.tile(wanted,(16,1))),(label,pixels.view(np.uint32)[:4],wanted);pixel_file=DEST/(label+'.rgba32f');pixel_file.write_bytes(pixels.tobytes())
 witnesses=[]
 for position,index in enumerate(definition['indices']):
  witness={'componentIndex':index,**hash_carrier(outputs[euler.COMPONENTS[index]],label+'.hash-'+str(index))};assert witness['hashWord']==euler._hash_word(private[position]);witnesses.append(witness)
 assert list(euler._raw_euler(constructor))==definition['inputWords'];assert shared._ownership()==before;assert compositor_graph.extract(oracle.scene)['compileTimeRotations']==program['compileTimeRotations']
 yy,xx=np.mgrid[:4,:4];control=np.stack([xx/16,yy/16,(xx+3*yy)/64,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes());row={**definition,'rgbaWords':wanted,'privateMFWords':private,'nativeEvaluations':1,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel_file.name,'pixelSha256':sha(pixel_file),'inputFile':input_file.name,'inputSha256':sha(input_file),'hashWitnesses':witnesses}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
assert pins=={str(p.relative_to(ROOT)):sha(p)for p in paths},'Source closure changed during native capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_STATIC_EULER','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'wordDifferences':0,'privateMFEndpointComparisons':sum(len(r['indices'])for r in rows),'hashCalibration':calibration,'nativeCPURenders':renders,'gpuInitializationCalls':0,'finalCredit':0,'browserCredit':0};(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),report['privateMFEndpointComparisons'],renders)
