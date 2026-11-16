# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual EEVEE Generated field, private BEVEL copies; never saves source."""
import bpy,json,sys,hashlib,time
import numpy as np
from pathlib import Path
from mathutils import Matrix,Vector
source,out,upstream=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:]);sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();pin=sha(source)
assert pin=='6785c3b4c5b50e2eab7b088914f6558b90aa3dad9cd105ef57d2973495c7b69c';assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source));original_scene=bpy.context.scene
owners=[]
for name in ['Cube','Cube.001']:
 original=bpy.data.objects[name];assert not original.data.shape_keys and not original.data.texture_mesh
 assert len(original.modifiers)==1 and all(m.type=='BEVEL'and m.show_render and m.show_viewport for m in original.modifiers)
 private=original.copy();private.data=original.data.copy();private.matrix_world=Matrix.Identity(4);owners.append((name,private))
scene=bpy.data.scenes.new('Owned ORCO Emission field');bpy.context.window.scene=scene;scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=1;scene.world=None;scene.render.resolution_x=64;scene.render.resolution_y=64;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.use_sequencer=False;scene.render.dither_intensity=0;scene.render.film_transparent=False
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='NONE'
flat=bpy.data.meshes.new('Owned flat source');flat.from_pydata([(-.173,.071,0),(.135,-.101,0),(.013,.151,0),(-.021,-.133,0)],[],[(0,1,2),(0,2,3)]);flat.update();fo=bpy.data.objects.new('Owned flat BEVEL',flat);bevel=fo.modifiers.new('Owned BEVEL','BEVEL');bevel.width=.01;bevel.segments=2;bevel.limit_method='NONE';owners.append(('flat-bevel',fo))
material=bpy.data.materials.new('Owned ORCO field');material.use_nodes=True;t=material.node_tree;t.nodes.clear();sink=t.nodes.new('ShaderNodeOutputMaterial');emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface']);coords=t.nodes.new('ShaderNodeTexCoord');geometry=t.nodes.new('ShaderNodeNewGeometry');scale=t.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.125;t.links.new(geometry.outputs['Position'],scale.inputs[0]);offset=t.nodes.new('ShaderNodeVectorMath');offset.operation='ADD';offset.inputs[1].default_value=(.5,.5,.5);t.links.new(scale.outputs['Vector'],offset.inputs[0]);white=t.nodes.new('ShaderNodeRGB');white.outputs[0].default_value=(1,1,1,1)
camera=bpy.data.objects.new('Owned ORCO camera',bpy.data.cameras.new('Owned ORCO camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='PERSP';camera.data.lens=50;camera.data.clip_start=.001;camera.data.clip_end=1000
report={'status':'running','supportCredit':0,'sourceSha256':pin,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'captureSha256':sha(__file__),'fieldGate':2**-10,'maskGate':0,'gateRole':'Existing native EEVEE half-film Emission field diagnostic bound; no final-scene acceptance','cases':[],'rows':[],'renderSnapshots':{}}
active_name=None
def render_snapshot(updated_scene,depsgraph=None):
 if depsgraph is None:return
 report.setdefault('observedHandlerModes',[]).append(depsgraph.mode)
 if depsgraph.mode!='RENDER'or active_name is None or active_name in report['renderSnapshots']:return
 mesh=owner.evaluated_get(depsgraph).data;mesh.calc_loop_triangles()
 report['renderSnapshots'][active_name]={'depsgraphMode':depsgraph.mode,'position':[list(mesh.vertices[loop.vertex_index].co)for loop in mesh.loops],'normal':[list(mesh.corner_normals[loop.index].vector)for loop in mesh.loops],'index':[i for triangle in mesh.loop_triangles for i in triangle.loops],'undeformedSample':[list(v.undeformed_co)for v in list(mesh.vertices)[:4]],'originalTexspace':{'location':list(owner.data.texspace_location),'size':list(owner.data.texspace_size)},'evaluatedTexspace':{'location':list(mesh.texspace_location),'size':list(mesh.texspace_size)},'metadataRole':'Render-depsgraph positions/normals/topology; undeformed sample is inverse RNA, not raw CD_ORCO.'}
bpy.app.handlers.depsgraph_update_post.append(render_snapshot)
bpy.app.handlers.frame_change_post.append(render_snapshot)
for name,owner in owners:
 active_name=name
 scene.collection.objects.link(owner);owner.hide_render=False;owner.data.materials.clear();owner.data.materials.append(material);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get();evaluated=owner.evaluated_get(dg);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=dg)
 try:
  mesh.calc_loop_triangles();points=[list(mesh.vertices[loop.vertex_index].co)for loop in mesh.loops];normals=[list(mesh.corner_normals[loop.index].vector)for loop in mesh.loops];index=[i for triangle in mesh.loop_triangles for i in triangle.loops];a=np.asarray(points,np.float32);center=Vector(((a.min(0)+a.max(0))*.5).tolist());radius=float(np.linalg.norm(a.max(0)-a.min(0)))*.5
  direction=Vector((1.2,-.7,1.3)).normalized();camera.matrix_world=direction.to_track_quat('Z','Y').to_matrix().to_4x4();camera.location=center+direction*radius*4;bpy.context.view_layer.update()
  report['cases'].append({'id':name,'basis':'blender-z-up','position':points,'normal':normals,'index':index,'modelMatrix':[list(row)for row in owner.matrix_world],'texspace':{'location':list(owner.data.texspace_location),'size':list(owner.data.texspace_size)},'camera':{'type':'PERSP','matrix':[list(row)for row in camera.matrix_world],'near':camera.data.clip_start,'far':camera.data.clip_end,'viewFrame':[list(v)for v in camera.data.view_frame(scene=scene)]}})
 finally:evaluated.to_mesh_clear()
 for kind,signal in [('mask',white.outputs['Color']),('position',offset.outputs['Vector']),('generated',coords.outputs['Generated'])]:
  t.links.new(signal,emit.inputs['Color']);id=name+'-'+kind;scene.render.filepath=str(out/(id+'.exr'));start=time.perf_counter();bpy.ops.render.render(write_still=True);image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.use_half_precision=False;pixels=np.empty(64*64*4,np.float32);image.pixels.foreach_get(pixels);bpy.data.images.remove(image);assert np.isfinite(pixels).all();file=id+'.rgba32f';(out/file).write_bytes(pixels.astype('<f4').tobytes());report['rows'].append({'id':id,'case':name,'kind':kind,'file':file,'sha256':sha(out/file),'milliseconds':(time.perf_counter()-start)*1000});(out/'partial.json').write_text(json.dumps(report,indent=2)+'\n')
 assert name in report['renderSnapshots'],'No actual Render-mode depsgraph snapshot for '+name
 snap=report['renderSnapshots'][name];expected=report['cases'][-1]
 assert snap['position']==expected['position']and snap['index']==expected['index'],'View/render evaluated geometry association differs'
 owner.hide_render=True
bpy.app.handlers.depsgraph_update_post.remove(render_snapshot)
bpy.app.handlers.frame_change_post.remove(render_snapshot)
paths=['source/blender/blenkernel/intern/object_update.cc','source/blender/blenkernel/intern/mesh.cc','source/blender/blenkernel/intern/mesh_data_update.cc','source/blender/modifiers/intern/MOD_bevel.cc','source/blender/draw/engines/eevee/shaders/eevee_attributes_mesh_lib.bsl.hh','source/blender/draw/engines/eevee/shaders/eevee_geom_mesh.bsl.hh']
report['sourcePins']={p:sha(upstream/p)for p in paths}
import gpu
report['gpu']={'backend':gpu.platform.backend_type_get(),'vendor':gpu.platform.vendor_get(),'renderer':gpu.platform.renderer_get()};assert report['gpu']['backend']=='METAL'
assert sha(source)==pin;report['sourcePreserved']=True;report['status']='NATIVE_EEVEE_ORCO_FIELD_RESEARCH_ZERO_CREDIT';(out/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('SCENETOWEB_ORCO_FIELD '+json.dumps({'cases':len(report['cases']),'rows':len(report['rows']),'supportCredit':0}))
