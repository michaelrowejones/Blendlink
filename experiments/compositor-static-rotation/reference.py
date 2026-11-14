# SPDX-License-Identifier: GPL-3.0-or-later
"""Untouched native CPU compositor normalization vs private Geometry CPU-MF."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph,compositor_static_rotation as rotation,compositor_static_matrix as shared
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_STATIC_ROTATION_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
case_path=ROOT/'experiments/compositor-static-rotation/cases.json';CASES=json.loads(case_path.read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=[Path(__file__),ROOT/'experiments/compositor-static-rotation/policy.py',case_path,ROOT/'packages/blender-addon/tests/compositor_static_rotation_check.py',ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')];pins={str(p.relative_to(ROOT)):sha(p)for p in paths}
def floats(words):
 raw=array('f');raw.frombytes(struct.pack('='+str(len(words))+'I',*words));return raw
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((4,4,4),np.float32),node_previews=False);rows=[]
for definition in CASES:
 sink,_=oracle.reset();tree=oracle.tree;route=definition['route'];constructor=tree.nodes.new('FunctionNodeQuaternionToRotation');constructor.inputs.foreach_set('default_value',floats(definition['inputWords']));assert list(shared._raw_scalars(constructor.inputs))==definition['inputWords']
 source=constructor.outputs['Rotation'];stack=()
 if route=='float-group':
  group=bpy.data.node_groups.new('Artist Quaternion Literals','CompositorNodeTree')
  for name in rotation.COMPONENTS:group.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')
  group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');inside=group.nodes.new('FunctionNodeQuaternionToRotation')
  for name in rotation.COMPONENTS:group.links.new(entry.outputs[name],inside.inputs[name])
  group.links.new(inside.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs.foreach_set('default_value',floats(definition['inputWords']));assert list(shared._raw_scalars(instance.inputs))==definition['inputWords'];source=instance.outputs[0]
 elif route=='rotation-group':
  group=bpy.data.node_groups.new('Artist Rotation Pass','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation');group.interface.new_socket(name='Rotation',in_out='OUTPUT',socket_type='NodeSocketRotation');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);source=instance.outputs[0]
 elif route=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
 elif route=='selector':
  switch=tree.nodes.new('GeometryNodeSwitch');switch.input_type='FLOAT';switch.inputs['False'].default_value=.5;switch.inputs['True'].default_value=1;tree.links.new(switch.outputs[0],constructor.inputs['X'])
 if route=='endpoint-group':
  group=bpy.data.node_groups.new('Artist Quaternion Endpoints','CompositorNodeTree');group.interface.new_socket(name='Rotation',in_out='INPUT',socket_type='NodeSocketRotation')
  for name in rotation.COMPONENTS:group.interface.new_socket(name=name,in_out='OUTPUT',socket_type='NodeSocketFloat')
  entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');separate=group.nodes.new('FunctionNodeRotationToQuaternion');group.links.new(entry.outputs[0],separate.inputs[0])
  for name in rotation.COMPONENTS:group.links.new(separate.outputs[name],exit.inputs[name])
  instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(source,instance.inputs[0]);outputs=instance.outputs;stack=(instance,)
 else:
  separate=tree.nodes.new('FunctionNodeRotationToQuaternion');tree.links.new(source,separate.inputs[0]);outputs=separate.outputs
 color=tree.nodes.new('CompositorNodeCombineColor');color.mode='RGB';color.inputs[3].default_value=1
 for channel,index in enumerate(definition['indices']):tree.links.new(outputs[rotation.COMPONENTS[index]],color.inputs[channel])
 tree.links.new(color.outputs[0],sink.inputs[0]);before=shared._ownership();cache={};private=[rotation.evaluate_output(separate.outputs[rotation.COMPONENTS[index]],oracle.scene,cache,stack,compositor_graph.static_selection.static_selection)['word']for index in definition['indices']];assert before==shared._ownership();assert cache['evaluator'].native_evaluations==1
 if 'manualQuaternionWords'in definition:assert private==[definition['manualQuaternionWords'][i]for i in definition['indices']],(definition,private)
 program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',program;assert len(program['compileTimeRotations'])==len(definition['indices']);assert all(op['kind']in{'value','combine-color'}for op in program['ops'])
 assert [r['word']for r in program['compileTimeRotations']]==private
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n');source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 oracle.scene.render.filepath=str(DEST/(label+'.exr'))
 for node in tree.nodes:node.show_preview=False
 bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
 try:
  assert tuple(image.size)==(4,4);pixels=np.empty(64,np.float32);image.pixels.foreach_get(pixels);actual=pixels.view(np.uint32).reshape(16,4);wanted=private+[0]*(3-len(private))+[0x3f800000];assert np.isfinite(pixels).all()and np.array_equal(actual,np.tile(wanted,(16,1))),(label,actual[0].tolist(),wanted)
  pixel_file=DEST/(label+'.rgba32f');pixel_file.write_bytes(pixels.tobytes())
 finally:bpy.data.images.remove(image)
 yy,xx=np.mgrid[:4,:4];control=np.stack([xx/16,yy/16,(xx+3*yy)/64,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
 row={**definition,'rgbaWords':wanted,'privateMFWords':private,'nativeEvaluations':1,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel_file.name,'pixelSha256':sha(pixel_file),'inputFile':input_file.name,'inputSha256':sha(input_file)}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
assert pins=={str(p.relative_to(ROOT)):sha(p)for p in paths},'Source closure changed during native capture'
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_STATIC_ROTATION','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'resultPrecision':'CPU_FLOAT32','sourceHashes':pins,'cases':rows,'wordDifferences':0,'privateMFEndpointComparisons':sum(len(r['indices'])for r in rows),'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows),report['privateMFEndpointComparisons'])
