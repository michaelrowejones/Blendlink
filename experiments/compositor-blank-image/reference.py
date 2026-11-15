# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent CPU compositor references and unchanged saved Blank Image sources."""
from array import array
from pathlib import Path
import hashlib,json,os,struct,sys
import bpy,gpu,numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon/tests')]
import compositor_graph
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_BLANK_IMAGE_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
source_only=os.environ.get('SCENETOWEB_BLANK_IMAGE_SOURCE_ONLY')=='1'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=[Path(__file__).resolve(),Path(__file__).resolve().with_name('policy.py'),Path(__file__).resolve().with_name('cases.json'),Path(__file__).resolve().with_name('protocol.mjs'),Path(__file__).resolve().with_name('sources.json'),ROOT/'packages/blender-addon/tests/compositor_blank_image_check.py',ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')]
pins={str(p.relative_to(ROOT)):sha(p)for p in paths};definitions=json.loads(Path(__file__).resolve().with_name('cases.json').read_text());gpu_calls=[]
def deny(*args,**kwargs):gpu_calls.append(True);raise RuntimeError('Blank Image CPU reference denies GPU initialization')
gpu.init=deny
try:gpu.init()
except RuntimeError:pass
else:raise AssertionError('GPU guard absent')
gpu_calls.clear()
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
rows=[];groups=[]
for definition in definitions:
 width,height=definition['width'],definition['height'];scene=oracle.scene;scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.film_transparent=True;scene.world=None
 sink,_=oracle.reset();tree=oracle.tree;owner=tree;route=definition['route']
 if route=='group-reroute':
  owner=bpy.data.node_groups.new('Artist finite Blank Image group','CompositorNodeTree');groups.append(owner);owner.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');exit=owner.nodes.new('NodeGroupOutput');instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=owner;tree.links.new(instance.outputs[0],sink.inputs[0]);sink=exit
 node=owner.nodes.new('CompositorNodeBlankImage');color=array('f');color.frombytes(struct.pack('=4I',*definition['colorWords']));node.inputs['Color'].default_value.foreach_set(color);node.inputs['Size'].default_value.foreach_set(array('i',definition['size']))
 actual_color=array('f',[0])*4;actual_size=array('i',[0])*2;node.inputs['Color'].default_value.foreach_get(actual_color);node.inputs['Size'].default_value.foreach_get(actual_size);assert actual_color.tobytes()==color.tobytes()and list(actual_size)==definition['size']
 terminal=node.outputs['Image']
 if route in {'reroute','group-reroute'}:
  reroute=owner.nodes.new('NodeReroute');owner.links.new(terminal,reroute.inputs[0]);terminal=reroute.outputs[0]
 owner.links.new(terminal,sink.inputs[0])
 for group in bpy.data.node_groups:
  for item in group.nodes:item.show_preview=False
 before=([(g.as_pointer(),g.users)for g in bpy.data.node_groups],scene.frame_current,scene.frame_subframe,actual_color.tobytes(),actual_size.tobytes())
 program=compositor_graph.extract(scene);assert program['status']=='extracted',(definition['case'],program);assert len(program['ops'])==1 and program['ops'][0]['kind']=='blank-image'
 label=definition['case'];program_file=DEST/(label+'.program.json');program_file.write_text(json.dumps(program,sort_keys=True,indent=2)+'\n')
 if source_only:
  assert before==([(g.as_pointer(),g.users)for g in bpy.data.node_groups],scene.frame_current,scene.frame_subframe,actual_color.tobytes(),actual_size.tobytes())
  rows.append({**definition,'programFile':program_file.name,'programSha256':sha(program_file),'sourceOwnershipPreserved':True});continue
 source_file=DEST/(label+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 scene.render.filepath=str(DEST/(label+'.exr'));assert scene.render.engine=='CYCLES'and scene.cycles.device=='CPU'and scene.render.compositor_device=='CPU'and scene.render.compositor_precision=='FULL';bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False)
 try:
  image.alpha_mode='PREMUL';assert tuple(image.size)==(width,height);pixels=array('f',[0])*(width*height*4);image.pixels.foreach_get(pixels)
 finally:bpy.data.images.remove(image)
 assert all(np.isfinite(np.frombuffer(pixels.tobytes(),np.float32)))
 pixel_file=DEST/(label+'.rgba32f');pixel_file.write_bytes(pixels.tobytes())
 yy,xx=np.mgrid[:height,:width];control=np.stack([xx/16384,yy/16384,(xx+3*yy)/65536,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(label+'.input32f');input_file.write_bytes(control.tobytes())
 after_color=array('f',[0])*4;after_size=array('i',[0])*2;node.inputs['Color'].default_value.foreach_get(after_color);node.inputs['Size'].default_value.foreach_get(after_size);assert before==([(g.as_pointer(),g.users)for g in bpy.data.node_groups],scene.frame_current,scene.frame_subframe,after_color.tobytes(),after_size.tobytes())
 row={**definition,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel_file.name,'pixelSha256':sha(pixel_file),'inputFile':input_file.name,'inputSha256':sha(input_file),'sourceOwnershipPreserved':True}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
assert not gpu_calls
assert pins=={str(p.relative_to(ROOT)):sha(p)for p in paths}
report={'schemaVersion':1,'status':'CHECKED_BLANK_IMAGE_SOURCE_SETUP'if source_only else'CAPTURED_COMPOSITOR_BLANK_IMAGE','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':scene.render.engine,'resultPrecision':'CPU_FLOAT32','gpuInitGuardProved':True,'gpuInitializations':0,'nativeRenders':0 if source_only else len(rows),'finalCredit':0,'browserCredit':0,'sourceHashes':pins,'cases':rows}
(DEST/('source-check.json'if source_only else'qualification.json')).write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
