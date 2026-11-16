# SPDX-License-Identifier: GPL-3.0-or-later
"""Native CPU projection/frustum data. No render, bake, source mutation or save."""
import hashlib,itertools,json,sys,struct
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'packages/blendlink/blender'))
from source_camera_projection import extract_camera_projection
source,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:2])
out.mkdir();sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(source)=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source));scene=bpy.context.scene
report={'sourceSha256':sha(source),'producerSha256':sha(__file__),
 'extractorSha256':sha(root/'packages/blendlink/blender/source_camera_projection.py'),
 'nativeBuild':bpy.app.build_hash.decode(),'renderAttempts':0,'saveCalls':0,
 'automaticEnablement':False,'supportCredit':0,'originalActiveCamera':scene.camera.name if scene.camera else None,
 'originalCameras':[],'cases':[]}
for camera in sorted((o for o in scene.objects if o.type=='CAMERA'),key=lambda o:o.name):
 report['originalCameras'].append(extract_camera_projection(scene,camera=camera))
original_optics=report['originalCameras'][0]
original_pose=scene.camera.matrix_world.copy()
# Synthetic private fixtures span source sensor fits, pixel aspects, and shifts.
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
camera=bpy.data.objects.new('Static projection CPU fixture',bpy.data.cameras.new('Fixture optics'))
scene.collection.objects.link(camera);scene.camera=camera;camera.data.lens=50
camera.data.clip_start=.1;camera.data.clip_end=1000;camera.data.ortho_scale=7
for kind,fit,extent,aspect,shift in itertools.product(
 ['PERSP','ORTHO'],['AUTO','HORIZONTAL','VERTICAL'],[(1920,1080),(1080,1920)],[(1,1),(2,1)],[(0,0),(.17,-.09)]):
 camera.data.type=kind;camera.data.sensor_fit=fit
 camera.data.shift_x,camera.data.shift_y=shift
 scene.render.resolution_x,scene.render.resolution_y=extent
 scene.render.resolution_percentage=100;scene.render.pixel_aspect_x,scene.render.pixel_aspect_y=aspect
 bpy.context.view_layer.update();snapshot=extract_camera_projection(scene)
 assert not snapshot['candidateRejectionReasons']
 matrix=camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),x=extent[0],y=extent[1],scale_x=aspect[0],scale_y=aspect[1])
 points=[[.2,-.3,-2],[1,.4,-10],[-.7,1,-6]]
 ndc=[]
 for point in points:
  clip=matrix@Vector((*point,1));ndc.append([clip[i]/clip.w for i in range(3)])
 snapshot['controlPoints']=points;snapshot['nativeNdc']=ndc
 snapshot['id']=f'{kind}-{fit}-{extent[0]}x{extent[1]}-pixel{aspect[0]}x{aspect[1]}-shift{shift[0]}x{shift[1]}'
 report['cases'].append(snapshot)
# A derived64x4 observation with the actual original optics/pose, explicitly
# outside the original border-enabled scene. No authored camera is edited.
for key,value in [('lens','lensMillimeters'),('sensor_fit','sensorFit'),('sensor_width','sensorWidthMillimeters'),('sensor_height','sensorHeightMillimeters'),('clip_start','clipNear'),('clip_end','clipFar')]:
 setattr(camera.data,key,original_optics[value])
camera.data.type=original_optics['cameraType'];camera.matrix_world=original_pose
scene.render.resolution_x=64;scene.render.resolution_y=4;scene.render.pixel_aspect_x=scene.render.pixel_aspect_y=1
for shift in [(0,0),tuple(original_optics['shift'])]:
 camera.data.shift_x,camera.data.shift_y=shift;bpy.context.view_layer.update()
 snapshot=extract_camera_projection(scene);snapshot['id']='derived-source-optics64x4-shift'+str(shift)
 snapshot['derivation']='Original optical data/pose in a fresh64x4 nonborder observation scene; not original scene admission'
 report['cases'].append(snapshot)
# Native CPU inverse projection rays, independent of the Three factory.
for snapshot in report['cases']:
 p=snapshot['projection'];matrix=Matrix([p[i:i+4] for i in range(0,16,4)])
 snapshot['nativeRays']=[]
 for x,y in [(-.7,-.4),(0,0),(.6,.8)]:
  a=matrix.inverted()@Vector((x,y,-1,1));b=matrix.inverted()@Vector((x,y,1,1))
  origin=a.to_3d()/a.w;end=b.to_3d()/b.w;direction=(end-origin).normalized()
  snapshot['nativeRays'].append({'ndc':[x,y],'nearPoint':list(origin),'direction':list(direction)})
# Stock glTF camera-only transport controls: it publishes no lens-shift field.
report['stockGltfControls']=[]
scene.render.resolution_x=1920;scene.render.resolution_y=1080;camera.matrix_world.identity()
camera.data.sensor_fit='AUTO';camera.data.lens=50;camera.data.sensor_width=36;camera.data.sensor_height=24
camera.data.shift_x=.17;camera.data.shift_y=-.09
for kind in ['PERSP','ORTHO']:
 camera.data.type=kind;camera.select_set(True);bpy.context.view_layer.objects.active=camera;bpy.context.view_layer.update()
 snapshot=extract_camera_projection(scene);path=out/(kind+'-camera.glb')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_cameras=True,
  export_materials='NONE',export_animations=False,export_skins=False,export_morph=False)
 payload=path.read_bytes();length=struct.unpack_from('<I',payload,12)[0];gltf=json.loads(payload[20:20+length])
 report['stockGltfControls'].append({'kind':kind,'sourceProjection':snapshot,'gltfCameras':gltf.get('cameras',[]),'glbSha256':sha(path)})
scene.render.use_border=True
report['borderControl']=extract_camera_projection(scene)
assert report['borderControl']['candidateRejectionReasons']
assert sha(source)==report['sourceSha256'];report['sourceUnchanged']=True
(out/'producer.py').write_bytes(Path(__file__).read_bytes())
(out/'source_camera_projection.py').write_bytes((root/'packages/blendlink/blender/source_camera_projection.py').read_bytes())
(out/'references.json').write_text(json.dumps(report,indent=2)+'\n')
print('CAMERA_SHIFT_CPU_REFERENCES '+json.dumps({'sourceUnchanged':True,'cases':len(report['cases']),'originalCameras':[(x['camera'],x['cameraType'],x['shift'],x['candidateRejectionReasons']) for x in report['originalCameras']]}))
