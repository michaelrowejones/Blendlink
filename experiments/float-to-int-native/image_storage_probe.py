# SPDX-License-Identifier: GPL-3.0-or-later
"""RESEARCH ONLY: actual saved/reopened existing compositor Image payload words."""
import bpy,hashlib,json,os,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).parent));sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
from values import controls
import compositor_graph
output=Path(os.environ['BLENDLINK_FLOAT_TO_INT_IMAGE_STORAGE']).resolve();output.mkdir(parents=True,exist_ok=True)
items=[item for item in controls() if item['domain']=='finite-int32-conversion' and abs(item['value'])<=2**24 and (int(item['word'],16)&0x7fffffff==0 or int(item['word'],16)&0x7f800000!=0)]
words=np.ones((8,8,4),np.float32).view(np.uint32);words[:,:,:3]=np.resize(np.asarray([int(item['word'],16) for item in items],np.uint32),(8,8,1));words[:,:,3]=0x3f800000
requested=words.tobytes();rows=[]
def pixels(image):
 data=np.empty(len(image.pixels),np.float32);image.pixels.foreach_get(data);return data.tobytes()
for variant in ['generated-unpacked','generated-packed-default','generated-packed-exr']:
 bpy.ops.wm.read_factory_settings(use_empty=False);scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL';scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
 tree=bpy.data.node_groups.new('Actual saved Image','CompositorNodeTree');tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
 sink=tree.nodes.new('NodeGroupOutput');node=tree.nodes.new('CompositorNodeImage');image=bpy.data.images.new('Authored float words',width=8,height=8,alpha=True,float_buffer=True);image.colorspace_settings.name='Non-Color';image.alpha_mode='STRAIGHT';image.use_half_precision=False;image.pixels.foreach_set(words.view(np.float32).ravel());node.image=image;tree.links.new(node.outputs['Image'],sink.inputs[0])
 assert pixels(image)==requested
 if variant=='generated-packed-exr':image.file_format='OPEN_EXR'
 if variant!='generated-unpacked':image.pack()
 before={'kind':image.source,'isFloat':image.is_float,'format':image.file_format,'pixelSha256':hashlib.sha256(pixels(image)).hexdigest(),'packedHeaders':[bytes(entry.packed_file.data)[:16].hex() for entry in image.packed_files]}
 path=output/(variant+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path));source_sha=hashlib.sha256(path.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene;image=bpy.data.images['Authored float words'];after_bytes=pixels(image)
 program=compositor_graph.extract(scene)
 payload_equal=None
 if program['status']=='extracted':
  import base64,zlib
  records=list(program.get('images',{}).values());assert len(records)==1
  actual=zlib.decompress(base64.b64decode(records[0]['data']));payload_equal=actual==requested
  (output/(variant+'.program.json')).write_text(json.dumps(program,indent=2)+'\n')
 rows.append({'variant':variant,'file':path.name,'sourceSha256':source_sha,'before':before,'reopened':{'kind':image.source,'isFloat':image.is_float,'format':image.file_format,'pixelSha256':hashlib.sha256(after_bytes).hexdigest(),'wordMismatches':int(sum(a!=b for a,b in zip(np.frombuffer(requested,np.uint32),np.frombuffer(after_bytes,np.uint32))))},'existingExtractorStatus':program['status'],'existingExtractorDiagnostics':program.get('diagnostics'),'publishedPayloadMatchesRequestedWords':payload_equal,'sourceFilePreserved':hashlib.sha256(path.read_bytes()).hexdigest()==source_sha})
report={'status':'RESEARCH_ONLY','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'requestedPixelSha256':hashlib.sha256(requested).hexdigest(),'rows':rows}
(output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('BLENDLINK_FLOAT_TO_INT_IMAGE_STORAGE_CAPTURED '+json.dumps(rows))
