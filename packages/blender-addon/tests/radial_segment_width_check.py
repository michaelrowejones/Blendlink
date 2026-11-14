# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires matrix-owned native references and actual saved Final/browser proofs.
"""Independent native compositor and EEVEE field references for Radial Width."""
import hashlib,json,os,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[3];FAMILY=ROOT/'experiments/radial-segment-width';sys.path[:0]=[str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blender-addon/tests'),str(FAMILY)]
import compositor_graph,tsl_ir
from compositor_reference import NativeCompositorReference
from native_shader import capture_shader_width
DEST=Path(os.environ['SCENETOWEB_RADIAL_WIDTH_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True);DEVICE=os.environ.get('SCENETOWEB_RADIAL_WIDTH_DEVICE','CPU')
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
files=sorted({Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',FAMILY/'native_shader.py',FAMILY/'cases.json',FAMILY/'numeric-contract.json',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py')});source_hashes={str(p.relative_to(ROOT)):sha(p)for p in files}
# Create the actual native shader atlas first; this function never calls SDK IR.
oracle=NativeCompositorReference(DEST,device=DEVICE,name='Artist Radial Width',image_only_scene=True);scene,tree=oracle.scene,oracle.tree;scene.render.engine='BLENDER_EEVEE';scene.world=None
shader_values,shader_report=capture_shader_width(DEST/'native-shader')
material=bpy.data.materials.new('Artist Radial Width');material.use_nodes=True;owner=next(o for o in scene.objects if o.type=='MESH');owner.data.clear_geometry();owner.data.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);owner.location=(0,0,0);owner.rotation_euler=(0,0,0);owner.scale=(1,1,1);owner.data.materials.clear();owner.data.materials.append(material);scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=2;scene.camera.location=(0,0,2);scene.camera.rotation_euler=(0,0,0)
pixels=np.zeros((8,8,4),np.float32);pixels[:,:,:2]=np.random.default_rng(7189).uniform(-2,2,(8,8,2));pixels[:,:,3]=1;pixels[0,:4,:2]=[[0,0],[1,-0.],[-1,-1],[2**-30,2**-30]]
image=bpy.data.images.new('Actual varying Vector',width=8,height=8,alpha=True,float_buffer=True);image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT';image.use_half_precision=False;image.pixels.foreach_set(pixels.ravel());image.pack()
specs=json.loads((FAMILY/'cases.json').read_text())
def setup(spec):
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');target=tree;node=target.nodes.new('ShaderNodeRadialTiling');node.normalize=spec['normalize'];node.inputs['Sides'].default_value=spec['sides'];node.inputs['Roundness'].default_value=1
 if spec['route']=='image-field':
  incoming=target.nodes.new('CompositorNodeImage');incoming.image=image;target.links.new(incoming.outputs['Image'],node.inputs['Vector'])
 if spec['route'] in ['value','reroute']:
  source=target.nodes.new('ShaderNodeValue');source.outputs[0].default_value=spec['sides'];value=source.outputs[0]
  if spec['route']=='reroute':reroute=target.nodes.new('NodeReroute');target.links.new(value,reroute.inputs[0]);value=reroute.outputs[0]
  target.links.new(value,node.inputs['Sides'])
 if spec['route']=='group':
  group=bpy.data.node_groups.new('Artist Sides Group','CompositorNodeTree');group.interface.new_socket(name='Sides',in_out='INPUT',socket_type='NodeSocketFloat');group.interface.new_socket(name='Sides',in_out='OUTPUT',socket_type='NodeSocketFloat');entry=group.nodes.new('NodeGroupInput');out=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],out.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=spec['sides'];target.links.new(instance.outputs[0],node.inputs['Sides'])
 tree.links.new(node.outputs['Segment Width'],sink.inputs[0])
 shader=material.node_tree;shader.nodes.clear();surface=shader.nodes.new('ShaderNodeBsdfPrincipled');out=shader.nodes.new('ShaderNodeOutputMaterial');shader.links.new(surface.outputs[0],out.inputs['Surface']);native=shader.nodes.new('ShaderNodeRadialTiling');native.normalize=spec['normalize'];native.inputs['Sides'].default_value=spec['sides'];native.inputs['Roundness'].default_value=1;coord=shader.nodes.new('ShaderNodeTexCoord');shader.links.new(coord.outputs['Object'],native.inputs['Vector']);shader.links.new(native.outputs['Segment Width'],surface.inputs['Base Color'])
 return node,sink,surface
refusals=[]
base={'sides':5,'normalize':False,'route':'default'}
for kind in ['coordinates','id','rotation','fractional','too-small','too-large','roundness','computed-sides','animated-input']:
 node,sink,surface=setup(base)
 if kind in ['coordinates','id','rotation']:tree.links.new(node.outputs[{'coordinates':'Segment Coordinates','id':'Segment ID','rotation':'Segment Rotation'}[kind]],sink.inputs[0])
 elif kind in ['fractional','too-small','too-large']:node.inputs['Sides'].default_value={'fractional':5.5,'too-small':1,'too-large':65}[kind]
 elif kind=='roundness':node.inputs['Roundness'].default_value=0
 elif kind=='computed-sides':
  math=tree.nodes.new('ShaderNodeMath');math.operation='ADD';math.inputs[0].default_value=2;math.inputs[1].default_value=3;tree.links.new(math.outputs[0],node.inputs['Sides'])
 else:node.inputs['Sides'].keyframe_insert(data_path='default_value',frame=1)
 p=compositor_graph.extract(scene);assert p['status']=='unsupported',(kind,p);assert p['diagnostics'];refusals.append({'kind':kind,'diagnostics':p['diagnostics']});tree.animation_data_clear()
rows=[]
for spec in specs:
 node,sink,surface=setup(spec)
 for item in tree.nodes:item.show_preview=False
 source=DEST/(spec['case']+'.blend')if spec['saved']else None
 if source:bpy.ops.wm.save_as_mainfile(filepath=str(source));source_sha=sha(source)
 program=compositor_graph.extract(scene);assert program['status']=='extracted',(spec,program);assert not any(op['source']['nodeType'] in ['CompositorNodeImage','CompositorNodeRLayers']for op in program['ops'])
 ir=tsl_ir.emit_channel(surface.inputs['Base Color']);assert ir['output']['op']=='radial_segment_width'
 pf=DEST/(spec['case']+'.program.json');pf.write_text(json.dumps(program,indent=2)+'\n');sf=DEST/(spec['case']+'.shader.json');sf.write_text(json.dumps(ir,indent=2)+'\n')
 scene.render.filepath=str(DEST/(spec['case']+'.exr'))
 with oracle._render_sampling():bpy.ops.render.render(write_still=True,scene=scene.name)
 native=bpy.data.images.load(scene.render.filepath,check_existing=False);native.alpha_mode='PREMUL';actual=np.empty(8*8*4,np.float32);native.pixels.foreach_get(actual);bpy.data.images.remove(native);assert np.isfinite(actual).all();assert np.array_equal(actual.reshape(-1,4)[:,3],np.ones(64,np.float32));assert np.array_equal(actual.reshape(-1,4)[:,:3],np.full((64,3),actual[0],np.float32))
 expected=np.float32(np.pi/spec['sides']);assert abs(int(actual.view(np.uint32)[0])-int(expected.view(np.uint32)))<=2
 pixel=DEST/(spec['case']+'.rgba32f');pixel.write_bytes(actual.tobytes());shader_actual=np.tile(np.array([shader_values[spec['sides'],spec['normalize']]]*3+[1],np.float32),(64,1));shader_pixel=DEST/(spec['case']+'.shader32f');shader_pixel.write_bytes(shader_actual.tobytes())
 if source:assert sha(source)==source_sha
 rows.append({**{key:spec[key]for key in ['case','sides','normalize','route']},'programFile':pf.name,'programSha256':sha(pf),'shaderIrFile':sf.name,'shaderIrSha256':sha(sf),'pixelFile':pixel.name,'pixelSha256':sha(pixel),'shaderPixelFile':shader_pixel.name,'shaderPixelSha256':sha(shader_pixel),**({'sourceFile':source.name,'sourceSha256':source_sha}if source else{})})
assert source_hashes=={str(p.relative_to(ROOT)):sha(p)for p in files}
report={'status':'native-radial-width-qualified','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'width':8,'height':8,'cases':rows,'refusals':refusals,'sourceHashes':source_hashes,'shaderAtlas':{'report':'native-shader/report.json','sha256':sha(DEST/'native-shader/report.json'),'data':shader_report}}
(DEST/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_RADIAL_WIDTH_NATIVE_PASSED',DEVICE,len(rows),'saved',sum(bool(r.get('sourceFile'))for r in rows))
