# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires family-owned native references and actual Final/browser qualification.
# blendlink-headless-sentinel: SCENETOWEB_BOX_MASK_CPU_CAPTURE_PASSED
"""Independent actual CPU compositor pilot; no GPU initialization or browser credit."""
from array import array
import hashlib,json,os,struct,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph
from compositor_box_mask import read_box_scalar_words
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_BOX_MASK_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
paths=sorted({Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json')});source_hashes={str(p.relative_to(ROOT)):sha(p)for p in paths}
CASES_PATH=ROOT/'experiments/compositor-box-mask/cases.json';CASES=json.loads(CASES_PATH.read_text());source_hashes[str(CASES_PATH.relative_to(ROOT))]=sha(CASES_PATH)
rows=[];refusals=[]
def configure(oracle,operation='Add',position=(.5,.5),size=(.2,.1),mask=0,value=1,route='direct'):
 sink,source=oracle.reset();tree=oracle.tree
 if route=='group':
  group=bpy.data.node_groups.new('Artist Box Group','CompositorNodeTree');group.interface.new_socket(name='Mask',in_out='OUTPUT',socket_type='NodeSocketFloat');exit=group.nodes.new('NodeGroupOutput');instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs[0],sink.inputs[0]);tree=group;sink=exit
 node=tree.nodes.new('CompositorNodeBoxMask');node.inputs['Operation'].default_value=operation;node.inputs['Position'].default_value=position;node.inputs['Size'].default_value=size;node.inputs['Mask'].default_value=mask;node.inputs['Value'].default_value=value
 output=node.outputs['Mask']
 if route=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(output,reroute.inputs[0]);output=reroute.outputs[0]
 tree.links.new(output,sink.inputs[0]);return node
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
node=configure(oracle);groups=set(bpy.data.node_groups.keys());source_identity=(node.as_pointer(),oracle.tree.as_pointer(),oracle.tree.users,tuple((s.as_pointer(),s.identifier,len(s.links))for s in node.inputs));initial=read_box_scalar_words(node)
for index in range(128):assert read_box_scalar_words(node)==initial
assert set(bpy.data.node_groups.keys())==groups
assert source_identity==(node.as_pointer(),oracle.tree.as_pointer(),oracle.tree.users,tuple((s.as_pointer(),s.identifier,len(s.links))for s in node.inputs))
# Exact raw reader controls use homogeneous owned donor storage. Unlike the
# earlier research seeding experiment, no init_socket call or overwrite exists.
raw_controls=[];donor_tree=None;donor_owner=None
try:
 donor_tree=bpy.data.node_groups.new('Owned raw scalar controls','CompositorNodeTree')
 for name in ('Mask','Value','Rotation'):donor_tree.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')
 donor_owner=bpy.data.node_groups.new('Owned raw scalar owner','CompositorNodeTree');donor=donor_owner.nodes.new('CompositorNodeGroup');donor.node_tree=donor_tree
 for expected_words in ([0,0x80000000,1],[0x007fffff,0x80000001,0x807fffff],[0x3e800000,0x3f000000,0xbf800000]):
  stored=array('f');stored.frombytes(struct.pack('=3I',*expected_words));donor.inputs.foreach_set('default_value',stored)
  actual_words=read_box_scalar_words(donor);assert actual_words==list(expected_words),(expected_words,actual_words)
  raw_controls.append({'inputWords':list(expected_words),'actualWords':actual_words})
finally:
 if donor_owner:bpy.data.node_groups.remove(donor_owner,do_unlink=True)
 if donor_tree:bpy.data.node_groups.remove(donor_tree,do_unlink=True)
assert set(bpy.data.node_groups.keys())==groups
def flip_mask(oracle,node):
 flip=oracle.tree.nodes.new('CompositorNodeFlip');oracle.tree.links.new(node.outputs['Mask'],flip.inputs['Image']);oracle.tree.links.new(flip.outputs[0],next(n for n in oracle.tree.nodes if n.bl_idname=='NodeGroupOutput').inputs[0])
# Actual source-policy controls, without changing the numerical operator.
for label,change in [('gpu',lambda:setattr(oracle.scene.render,'compositor_device','GPU')),('rotation',lambda:setattr(node.inputs['Rotation'],'default_value',.25)),('negative-zero',lambda:setattr(node.inputs['Mask'],'default_value',-0.0)),('small',lambda:setattr(node.inputs['Value'],'default_value',2**-17)),('border',lambda:setattr(oracle.scene.render,'use_border',True)),('field',lambda:oracle.tree.links.new(oracle.value(.5),node.inputs['Mask'])),('flip',lambda:flip_mask(oracle,node)),('animated',lambda:node.inputs['Value'].keyframe_insert('default_value',frame=1))]:
 node=configure(oracle);oracle.scene.render.compositor_device='CPU';oracle.scene.render.use_border=False;change();result=compositor_graph.extract(oracle.scene);assert result['status']=='unsupported',(label,result);refusals.append({'case':label,'diagnostics':result['diagnostics']})
 if oracle.tree.animation_data:oracle.tree.animation_data_clear()
for definition in CASES:
 width,height,label=definition['width'],definition['height'],definition['case'];options=definition['settings']
 oracle.scene.render.resolution_percentage=100;oracle.scene.render.resolution_x=width;oracle.scene.render.resolution_y=height
 if width==2 and height==2:oracle.scene.render.resolution_x=oracle.scene.render.resolution_y=4;oracle.scene.render.resolution_percentage=50
 oracle.scene.render.compositor_device='CPU';oracle.scene.render.use_border=False;oracle.scene.render.compositor_precision=definition['precision']
 node=configure(oracle,**options,route=definition['route']);program=compositor_graph.extract(oracle.scene);assert program['status']=='extracted',(label,program)
 # RNA assignments must preserve requested F32 values; no silently clamped test data.
 expected={'position':options.get('position',[.5,.5]),'size':options.get('size',[.2,.1]),'mask':options.get('mask',0),'value':options.get('value',1)};properties=next(op['properties']for op in program['ops']if op['kind']=='box-mask')
 f32=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
 for field,value in expected.items():assert properties['box_mask_'+field]==([f32(x)for x in value]if isinstance(value,(list,tuple))else f32(value)),(label,field,properties)
 case=definition['case'];program_file=DEST/(case+'.program.json');program_file.write_text(json.dumps(program,indent=2)+'\n')
 source_file=DEST/(case+'.blend')if definition['saved']else None
 if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
 oracle.scene.render.filepath=str(DEST/(case+'.exr'))
 for item in oracle.tree.nodes:item.show_preview=False
 bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';assert tuple(image.size)==(width,height),(label,tuple(image.size))
 data=np.empty(width*height*4,np.float32);image.pixels.foreach_get(data);bpy.data.images.remove(image);assert np.isfinite(data).all();pixel_file=DEST/(case+'.rgba32f');pixel_file.write_bytes(data.tobytes())
 # Independent non-symmetric image-load control establishes readback orientation.
 yy,xx=np.mgrid[:height,:width];control=np.stack([xx%31/64,yy%37/64,(xx+3*yy)%41/64,np.ones_like(xx)],axis=-1).astype(np.float32);input_file=DEST/(case+'.input32f');input_file.write_bytes(control.tobytes())
 row={**definition,'programFile':program_file.name,'programSha256':sha(program_file),'pixelFile':pixel_file.name,'pixelSha256':sha(pixel_file),'inputFile':input_file.name,'inputSha256':sha(input_file)}
 if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
 rows.append(row)
assert source_hashes=={str(p.relative_to(ROOT)):sha(p)for p in [*paths,CASES_PATH]}
report={'schemaVersion':1,'status':'CAPTURED_COMPOSITOR_BOX_MASK','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':'CPU','sceneEngine':oracle.scene.render.engine,'requestedPrecision':oracle.scene.render.compositor_precision,'resultPrecision':'CPU_FLOAT32','sourceHashes':source_hashes,'scalarReadCycles':128,'scalarReadSourceUnchanged':True,'scalarReadGroupCensusRestored':True,'rawScalarControls':raw_controls,'cases':rows,'refusals':refusals,'finalCredit':0,'browserCredit':0}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_BOX_MASK_CPU_CAPTURE_PASSED',len(rows),len(refusals))
