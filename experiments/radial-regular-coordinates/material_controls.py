# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Coordinated research atlas; no node/Final/full-scene qualification.
"""Actual EEVEE selected-coordinate controls and independent half-safe carriers."""
import hashlib,json,os
from pathlib import Path
import bpy,numpy as np
OUT=Path(os.environ['SCENETOWEB_RADIAL_MATERIAL_CONTROLS']).resolve();OUT.mkdir(parents=True,exist_ok=False)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash.decode()=='02f0899d78e3'
scene=bpy.data.scenes.new('Owned Radial selected-coordinate controls');scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None
scene.render.resolution_x=128;scene.render.resolution_y=4;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.dither_intensity=0
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA'
camera_data=bpy.data.cameras.new('Control orthographic');camera_data.type='ORTHO';camera_data.ortho_scale=32;camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
settings_path=os.environ.get('SCENETOWEB_RADIAL_MATERIAL_SETTINGS')
settings=([{'sides':s,'normalize':n,'point':p,'route':'literal'}for s in[3,8,12]for n in[False,True]for p in[(0.,0.),(1.,0.)]]if not settings_path else[{**entry,'point':entry['xy']}for entry in json.loads(Path(settings_path).read_text())['finals']])
assert 1<=len(settings)<=20
specs=[{**setting,'component':component}for setting in settings for component in['phase-magnitude','radius-magnitude','phase-negative','radius-negative','phase-residue','radius-residue']]
controls=[float(np.float32(.049123456)),float(np.float32(1.5678912))];vertices=[];faces=[]
for i in range(128):
 left=-16+i*.25;offset=len(vertices);vertices.extend([(left,-.5,0),(left+.25,-.5,0),(left+.25,.5,0),(left,.5,0)]);faces.append((offset,offset+1,offset+2,offset+3))
mesh=bpy.data.meshes.new('Owned atlas carriers');mesh.from_pydata(vertices,[],faces);owner=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(owner)
def math(tree,operation,a,b=None):
 node=tree.nodes.new('ShaderNodeMath');node.operation=operation
 for i,value in enumerate([a,b]):
  if value is None:continue
  if isinstance(value,(int,float)):node.inputs[i].default_value=value
  else:tree.links.new(value,node.inputs[i])
 return node.outputs[0]
for i in range(128):
 material=bpy.data.materials.new('Owned native Radial control '+str(i));material.use_nodes=True;tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(emission.outputs[0],output.inputs['Surface'])
 if i<len(specs):
  spec=specs[i];radial=tree.nodes.new('ShaderNodeRadialTiling');radial.normalize=spec['normalize'];radial.inputs['Sides'].default_value=spec['sides'];radial.inputs['Roundness'].default_value=1;radial.inputs['Vector'].default_value=spec['point'];assert tuple(radial.inputs['Vector'].default_value)==tuple(spec['point'])
  if spec.get('route','literal').startswith('group2'):
   radial.inputs['Vector'].default_value=(1.5,-1.5)
   group=bpy.data.node_groups.new('Actualmaterial3to2boundary','ShaderNodeTree');a=group.interface.new_socket(name='V',in_out='INPUT',socket_type='NodeSocketVector');a.dimensions=3;b=group.interface.new_socket(name='V',in_out='OUTPUT',socket_type='NodeSocketVector');b.dimensions=2;gi=group.nodes.new('NodeGroupInput');go=group.nodes.new('NodeGroupOutput');group.links.new(gi.outputs[0],go.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;instance.inputs[0].default_value=(*spec['point'],9);source=instance.outputs[0]
   if spec['route'].endswith('reroute'):
    reroute=tree.nodes.new('NodeReroute');tree.links.new(source,reroute.inputs[0]);source=reroute.outputs[0]
   tree.links.new(source,radial.inputs['Vector'])
  if spec.get('route')=='reroute':
   radial.inputs['Vector'].default_value=(1.5,-1.5);literal=tree.nodes.new('FunctionNodeInputVector');literal.vector=(*spec['point'],9);reroute=tree.nodes.new('NodeReroute');tree.links.new(literal.outputs[0],reroute.inputs[0]);tree.links.new(reroute.outputs[0],radial.inputs['Vector'])
  separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(radial.outputs['Segment Coordinates'],separate.inputs[0]);axis=separate.outputs[0 if spec['component'].startswith('phase')else 1]
  if spec['component'].endswith('negative'):scalar=math(tree,'LESS_THAN',axis,0)
  else:
   scalar=math(tree,'ABSOLUTE',axis)
   if spec['component'].endswith('residue'):scalar=math(tree,'GREATER_THAN',math(tree,'FRACT',math(tree,'MULTIPLY',scalar,268435456)),0)
 elif i<len(specs)+len(controls):
  literal=tree.nodes.new('ShaderNodeValue');literal.outputs[0].default_value=controls[i-len(specs)];scalar=literal.outputs[0]
 else:
  literal=tree.nodes.new('ShaderNodeValue');literal.outputs[0].default_value=0;scalar=literal.outputs[0]
 # Three exact-half10-bit digits encode multiples of2^-28 in[0,2).
 red=math(tree,'MULTIPLY',math(tree,'FLOOR',math(tree,'MULTIPLY',scalar,256)),1/1024)
 green=math(tree,'MULTIPLY',math(tree,'FLOOR',math(tree,'MULTIPLY',math(tree,'FRACT',math(tree,'MULTIPLY',scalar,256)),1024)),1/1024)
 blue=math(tree,'MULTIPLY',math(tree,'FLOOR',math(tree,'MULTIPLY',math(tree,'FRACT',math(tree,'MULTIPLY',scalar,262144)),1024)),1/1024)
 color=tree.nodes.new('ShaderNodeCombineXYZ')
 for c,value in enumerate([red,green,blue]):tree.links.new(value,color.inputs[c])
 tree.links.new(color.outputs[0],emission.inputs['Color']);owner.data.materials.append(material);mesh.polygons[i].material_index=i
scene.render.filepath=str(OUT/'atlas.exr');bpy.ops.render.render(write_still=True,scene=scene.name)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);raw=np.empty(128*4*4,np.float32);image.pixels.foreach_get(raw);bpy.data.images.remove(image);raw=raw.reshape(4,128,4)
assert np.isfinite(raw).all()and np.array_equal(raw[:,:,3],np.ones((4,128),np.float32))and all(np.array_equal(raw[0],raw[y])for y in range(1,4))
digits=raw[0,:,:3]*1024;assert np.array_equal(digits,np.floor(digits))and(digits>=0).all()and(digits<1024).all()and(digits[:,0]<512).all()
decoded=np.asarray(digits[:,0].astype(np.float64)/256+digits[:,1].astype(np.float64)/262144+digits[:,2].astype(np.float64)/268435456,np.float32)
assert np.array_equal(decoded[len(specs):len(specs)+2].view(np.uint32),np.asarray(controls,np.float32).view(np.uint32))
for i,spec in enumerate(specs):
 if spec['component'].endswith('residue'):assert decoded[i]==0,(spec,float(decoded[i]))
 if spec['component'].endswith('negative'):assert decoded[i]in[0,1]
(OUT/'packed.rgba32f').write_bytes(raw.tobytes());(OUT/'decoded.f32').write_bytes(decoded.tobytes());bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'actual-native-controls.blend'))
report={'schemaVersion':1,'status':'ACTUAL_EEVEE_RADIAL_SELECTED_COORDINATE_CONTROLS','sourceStage':('Actual EEVEE material/film with independent calibrated half-safe digit carrier for the ordinary/group settings in the pinned plan; separately labeled from PythonGPU directF32 kernel. No field or full-scene qualification.'if settings_path else'Actual EEVEE material/film with independent calibrated half-safe digit carrier; separately labeled from PythonGPU directF32 kernel. Literal origin/+X controls only, no field or Final qualification.'),'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'cases':[{**spec,'column':i,'decodedWord':int(decoded.view(np.uint32)[i])}for i,spec in enumerate(specs)],'independentCarrierControls':{'sourceWords':np.asarray(controls,np.float32).view(np.uint32).astype(np.uint64).tolist(),'actualWords':decoded[len(specs):len(specs)+2].view(np.uint32).astype(np.uint64).tolist()},'residueChecks':'All selected magnitudes have exact2^-28 grid residue0 in the native material graph; source magnitude/sign separate, signed-zero sign is not reconstructed.','logicalSettings':settings,'settingsSha256':hashlib.sha256(Path(settings_path).read_bytes()).hexdigest()if settings_path else None,'sourceFixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'files':{name:hashlib.sha256((OUT/name).read_bytes()).hexdigest()for name in['atlas.exr','packed.rgba32f','decoded.f32','actual-native-controls.blend']},'qualificationCredit':{'node':0,'actualFinal':0,'fullScene':0}}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print('RADIAL_ACTUAL_MATERIAL_RESEARCH_CAPTURED '+json.dumps({'cases':len(specs),'carrierControls':2,'supportCredit':0}))
