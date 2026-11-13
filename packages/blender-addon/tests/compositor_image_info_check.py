# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Requires matrix-owned native references, Final exports and actual browser proof.
# blendlink-headless-sentinel: BLENDLINK_IMAGE_INFO_CHECK_PASSED
"""Native Image Info output metadata and explicit typed consumer references."""
import hashlib,json,os,sys
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'packages/blendlink/blender'));sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
import compositor_graph
from compositor_reference import NativeCompositorReference
DEST=Path(os.environ['SCENETOWEB_IMAGE_INFO_REFERENCES']).resolve();DEST.mkdir(parents=True,exist_ok=True);DEVICE=os.environ.get('SCENETOWEB_IMAGE_INFO_DEVICE','CPU')
sha=lambda path:hashlib.sha256(Path(path).read_bytes()).hexdigest()
SIZES=[(13,9,1),(26,18,2),(9,13,1),(18,26,2),(19,11,1),(38,22,2)];OUTPUTS=['Dimensions','Resolution','Location','Rotation','Scale'];ROUTES=['rgba','vector3','reroute','group']
source_paths=sorted({Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.py')});source_hashes={str(p.relative_to(ROOT)):sha(p)for p in source_paths}
rows=[]
def graph(oracle,output,route):
 tree=oracle.tree;sink,source=oracle.reset();node=tree.nodes.new('CompositorNodeImageInfo');tree.links.new(source.outputs['Image'],node.inputs['Image']);result=node.outputs[output]
 if route=='reroute':
  reroute=tree.nodes.new('NodeReroute');tree.links.new(result,reroute.inputs[0]);result=reroute.outputs[0]
 if route=='group':
  group=bpy.data.node_groups.new('Artist Metadata Group','CompositorNodeTree');group.interface.new_socket(name='Vector',in_out='INPUT',socket_type='NodeSocketVector');group.interface.new_socket(name='Vector',in_out='OUTPUT',socket_type='NodeSocketVector');entry=group.nodes.new('NodeGroupInput');exit=group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs[0],exit.inputs[0]);instance=tree.nodes.new('CompositorNodeGroup');instance.node_tree=group;tree.links.new(result,instance.inputs[0]);result=instance.outputs[0]
 if route in ['vector3','group','aspect']:
  separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(result,separate.inputs['Vector'])
  if route=='aspect':
   ratio=tree.nodes.new('ShaderNodeMath');ratio.operation='DIVIDE';tree.links.new(separate.outputs['X'],ratio.inputs[0]);tree.links.new(separate.outputs['Y'],ratio.inputs[1]);result=ratio.outputs[0]
  else:
   combined=tree.nodes.new('CompositorNodeCombineColor')
   for index,name in enumerate(['X','Y','Z']):tree.links.new(separate.outputs[name],combined.inputs[index])
   result=combined.outputs[0]
 tree.links.new(result,sink.inputs[0]);return source,node
for width,height,pixel_ratio in SIZES:
 yy,xx=np.mgrid[:height,:width];pixels=np.stack([xx%31/64,yy%37/64,(xx+3*yy)%41/64,np.ones_like(xx)],axis=-1).astype(np.float32)
 oracle=NativeCompositorReference(DEST,device=DEVICE,name='Artist Image Metadata',pixels=pixels);scene,tree=oracle.scene,oracle.tree;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
 # All native Image Info outputs allocate single values; input paths still need proof.
 for kind in ['unlinked','constant','transform','scalar-edge']:
  source,node=graph(oracle,'Dimensions','rgba')
  if kind=='unlinked':tree.links.remove(node.inputs['Image'].links[0])
  elif kind=='constant':
   color=tree.nodes.new('CompositorNodeRGB');tree.links.new(color.outputs[0],node.inputs['Image'])
  elif kind=='transform':
   transform=tree.nodes.new('CompositorNodeTransform');transform.inputs['Scale'].default_value=2;tree.links.new(source.outputs['Image'],transform.inputs['Image']);tree.links.new(transform.outputs[0],node.inputs['Image'])
  else:
   math=tree.nodes.new('ShaderNodeMath');math.operation='ADD';tree.links.new(node.outputs['Dimensions'],math.inputs[0]);tree.links.new(math.outputs[0],next(n for n in tree.nodes if n.bl_idname=='NodeGroupOutput').inputs[0])
  refused=compositor_graph.extract(scene);assert refused['status']=='unsupported',(kind,refused);assert any('Image Info' in row['message']for row in refused['diagnostics']),(kind,refused)
 signatures=[(output,route)for output in OUTPUTS for route in ROUTES]+[(output,'aspect')for output in ['Dimensions','Resolution']]
 for output,route in signatures:
  source,node=graph(oracle,output,route);label=f'{width}x{height}-{output.lower()}-{route}';case=f'blender-5-3-{DEVICE.lower()}-'+label
  save=(width==13 and route=='rgba')or(width==9 and route=='group')or(route=='aspect'and(width==13 and output=='Dimensions'or width==9 and output=='Resolution'))
  source_file=DEST/(label+'.blend')if save else None
  if source_file:bpy.ops.wm.save_as_mainfile(filepath=str(source_file));source_sha=sha(source_file)
  program=compositor_graph.extract(scene);assert program['status']=='extracted',(label,program);program_path=DEST/(case+'.program.json');program_path.write_text(json.dumps(program,indent=2)+'\n')
  scene.render.filepath=str(DEST/(case+'.exr'))
  for item in tree.nodes:item.show_preview=False
  bpy.ops.render.render(write_still=True);image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';actual=np.empty(width*height*4,np.float32);image.pixels.foreach_get(actual);bpy.data.images.remove(image)
  expected=[width,height,0,1]if output in ['Dimensions','Resolution']else[1,1,0,1]if output=='Scale'else[0,0,0,1]
  if route=='aspect':ratio=np.float32(width)/np.float32(height);expected=[ratio,ratio,ratio,1]
  assert np.array_equal(actual.reshape(-1,4),np.tile(np.array(expected,np.float32),(width*height,1))),(label,actual[:4],expected)
  pixel_path=DEST/(case+'.rgba32f');pixel_path.write_bytes(actual.tobytes());input_path=DEST/(case+'.input32f');input_path.write_bytes(pixels.tobytes())
  row={'case':case,'width':width,'height':height,'pixelRatio':pixel_ratio,'infoOutput':output,'route':route,'programFile':program_path.name,'programSha256':sha(program_path),'pixelFile':pixel_path.name,'pixelSha256':sha(pixel_path),'inputFile':input_path.name,'inputSha256':sha(input_path)}
  if source_file:assert sha(source_file)==source_sha;row.update(sourceFile=source_file.name,sourceSha256=source_sha)
  rows.append(row)
assert source_hashes=={str(p.relative_to(ROOT)):sha(p)for p in source_paths},'Native closure changed during capture'
(DEST/'qualification.json').write_text(json.dumps({'status':'native-image-info-qualified','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'device':DEVICE,'sourceHashes':source_hashes,'cases':rows},indent=2)+'\n')
print('BLENDLINK_IMAGE_INFO_CHECK_PASSED',DEVICE,len(rows))
