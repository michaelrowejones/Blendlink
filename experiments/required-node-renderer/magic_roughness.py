# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual authored Magic Roughness carrier and independent scalar witness."""
import hashlib
import json
import os
from pathlib import Path
import bpy
import gpu
import numpy as np
out=Path(os.environ['BLENDLINK_REQUIRED_RENDERER_EVIDENCE']).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
scene.render.resolution_x=32;scene.render.resolution_y=32;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.world=None
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
if hasattr(getattr(scene,'eevee',None),'taa_render_samples'):scene.eevee.taa_render_samples=1
camera=bpy.data.objects.new('Carrier Camera',bpy.data.cameras.new('Carrier Camera'));scene.collection.objects.link(camera)
camera.data.type='ORTHO';camera.data.ortho_scale=2;camera.location=(0,0,3);scene.camera=camera;camera['blendlink_id']='carrier-camera'
light=bpy.data.objects.new('Carrier Sun',bpy.data.lights.new('Carrier Sun','SUN'));scene.collection.objects.link(light);light.data.energy=3;light['blendlink_id']='carrier-sun'
mesh=bpy.data.meshes.new('Magic Roughness Plane');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update()
uv=mesh.uv_layers.new(name='Carrier UV')
for item,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):item.uv=value
owner=bpy.data.objects.new('Magic Roughness Owner',mesh);scene.collection.objects.link(owner);owner['blendlink_id']='carrier-owner'
material=bpy.data.materials.new('Magic Roughness Artist');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;surface=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled')
surface.inputs['Base Color'].default_value=(.125,.25,.5,1);surface.inputs['Metallic'].default_value=0
coords=tree.nodes.new('ShaderNodeTexCoord');magic=tree.nodes.new('ShaderNodeTexMagic');magic.turbulence_depth=2
magic.inputs['Scale'].default_value=1;magic.inputs['Distortion'].default_value=1
tree.links.new(coords.outputs['UV'],magic.inputs['Vector']);tree.links.new(magic.outputs['Fac'],surface.inputs['Roughness'])
scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],
 'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],
 'camera':{'objectId':'carrier-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'Desktop','width':32,'height':32,'safeMargin':0}]}})
source=out/'MagicRoughness.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source));source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
# The saved Principled source remains authored. A private material copy turns
# the same upstream Roughness socket into an independent native scalar witness.
copy=material.copy();mesh.materials[0]=copy;tree=copy.node_tree;surface=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled');sink=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial')
emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(surface.inputs['Roughness'].links[0].from_socket,emission.inputs['Color']);tree.links.new(emission.outputs[0],sink.inputs['Surface'])
if bpy.app.background:gpu.init()
backend={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'vendor':gpu.platform.vendor_get()}
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.filepath=str(out/'native.exr')
bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.asarray(image.pixels[:],np.float32).reshape(32,32,4).copy();bpy.data.images.remove(image)
assert np.isfinite(pixels).all() and float(pixels[16,16,0])<.9
pixels.astype('<f4').tofile(out/'native.rgba32f');assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
(out/'native.json').write_text(json.dumps({'kind':'native-Magic-Roughness-channel-witness-not-whole-BSDF-parity','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'sourceBackend':backend,'sourceSha256':source_hash,'nativeCenter':pixels[16,16].tolist(),'nativeRange':[float(pixels[:,:,:3].min()),float(pixels[:,:,:3].max())],'width':32,'height':32},indent=2))
print('BLENDLINK_MAGIC_REQUIRED_RENDERER_NATIVE_PASSED')
