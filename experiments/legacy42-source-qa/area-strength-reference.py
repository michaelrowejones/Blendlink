"""Independent native Area power/exposure contract, not Three radiometric parity."""
import bpy, hashlib, json, math, os
from pathlib import Path
import numpy as np

output=Path(os.environ['BLENDLINK_QA_AREA_REFERENCE']);output.mkdir(parents=True,exist_ok=True)
assert bpy.app.version[:3] in {(4,2,0),(5,2,0),(5,3,0)}, 'Unmeasured native source version'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0,0) else 'BLENDER_EEVEE'
scene.eevee.taa_render_samples=1;scene.world=None;scene.render.resolution_x=scene.render.resolution_y=65;scene.render.resolution_percentage=100
scene.eevee.light_threshold=1e-7  # Remove the separately modeled energy-dependent Eevee influence fade.
scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
bpy.ops.mesh.primitive_plane_add(size=2)
plane=bpy.context.object;material=bpy.data.materials.new('Independent Lambertian receiver');material.use_nodes=True;plane.data.materials.append(material)
tree=material.node_tree;tree.nodes.clear();diffuse=tree.nodes.new('ShaderNodeBsdfDiffuse');diffuse.inputs['Color'].default_value=(1,1,1,1);diffuse.inputs['Roughness'].default_value=0
sink=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(diffuse.outputs[0],sink.inputs['Surface'])
cam_data=bpy.data.cameras.new('Strength camera');cam_data.type='ORTHO';cam_data.ortho_scale=1
cam=bpy.data.objects.new('Strength camera',cam_data);scene.collection.objects.link(cam);cam.location=(0,0,4);scene.camera=cam
data=bpy.data.lights.new('Measured native rectangle','AREA');data.shape='RECTANGLE';data.use_shadow=False
light=bpy.data.objects.new('Measured native rectangle',data);scene.collection.objects.link(light);light.location=(0,0,2)
rows=[]
cases=[('unit',1,1,10,(1,1,1),1),('wide',2,2,10,(1,1,1),1),('wide-power4',2,2,40,(1,1,1),1),
       ('scaled',1,1,10,(2,3,1),1),('unit-scale',1,1,10,(1,1,1),.01)]
if hasattr(data,'normalize'):
    cases += [('unnormalized',2,2,10,(1,1,1),1),('exposure',1,1,10,(1,1,1),1)]
for label,width,height,energy,scale,unit in cases:
    data.size=width;data.size_y=height;data.energy=energy;light.scale=scale;scene.unit_settings.scale_length=unit
    if hasattr(data,'normalize'):data.normalize=label!='unnormalized'
    if hasattr(data,'exposure'):data.exposure=1 if label=='exposure' else 0
    scene.render.filepath=str(output/(label+'.exr'));bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(scene.render.filepath,check_existing=False);pixels=np.asarray(image.pixels[:],np.float32).reshape(65,65,4)
    value=float(pixels[32,32,0]);pixels.astype('<f4').tofile(output/(label+'.rgba32f'));bpy.data.images.remove(image)
    a=width*scale[0]/2;b=height*scale[1]/2;distance=2
    projection=2*a/math.sqrt(a*a+distance*distance)*math.atan(b/math.sqrt(a*a+distance*distance))+2*b/math.sqrt(b*b+distance*distance)*math.atan(a/math.sqrt(b*b+distance*distance))
    area=width*height*scale[0]*scale[1];effective=energy*(2 if label=='exposure' else 1)
    radiance=effective/math.pi/(1 if label=='unnormalized' else area)
    ideal=radiance*projection/math.pi
    rows.append(dict(label=label,width=width,height=height,energy=energy,scale=scale,unitScale=unit,nativeCenter=value,
        independentlyIntegratedLambertian=ideal,relativeError=abs(value-ideal)/ideal,worldArea=area))
document={'version':list(bpy.app.version),'hash':bpy.app.build_hash.decode(),'sourceEngine':scene.render.engine,'lightThreshold':scene.eevee.light_threshold,
    'properties':{'exposure':hasattr(data,'exposure'),'normalize':hasattr(data,'normalize')},'rows':rows,
    'sha256': {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.glob('*.rgba32f'))},
    'scope':'Native source normalization/exposure only; not browser radiometry or general transformed-light parity'}
(output/'reference.json').write_text(json.dumps(document,indent=2));print('BLENDLINK_AREA_STRENGTH_REFERENCE',json.dumps(document))

assert all(np.isfinite(row['nativeCenter']) and row['relativeError'] < .002 for row in rows), 'Native source normalization disagrees with independent center integral'
by_name={row['label']:row for row in rows}
assert by_name['wide-power4']['nativeCenter']==4*by_name['wide']['nativeCenter']
assert by_name['unit-scale']['nativeCenter']==by_name['unit']['nativeCenter']
if hasattr(data,'normalize'):
    assert by_name['unnormalized']['nativeCenter']==4*by_name['wide']['nativeCenter']
    assert by_name['exposure']['nativeCenter']==2*by_name['unit']['nativeCenter']
print('BLENDLINK_AREA_STRENGTH_REFERENCE_PASSED',len(rows))
