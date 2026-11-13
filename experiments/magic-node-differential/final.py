# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored Magic material -> Final GLB, independent native emission oracle."""
import json
import os
from pathlib import Path
import bpy
import numpy as np
output=Path(os.environ['BLENDLINK_MAGIC_FINAL']).resolve();output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
scene.render.resolution_x=192;scene.render.resolution_y=64;scene.render.resolution_percentage=100
scene.render.use_compositing=False;scene.render.dither_intensity=0;scene.world=None
scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
if hasattr(getattr(scene,'eevee',None),'taa_render_samples'):scene.eevee.taa_render_samples=1
camera_data=bpy.data.cameras.new('Magic Camera');camera_data.type='ORTHO';camera_data.ortho_scale=6
camera=bpy.data.objects.new('Magic Camera',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,5);scene.camera=camera;camera['blendlink_id']='magic-camera'
light_data=bpy.data.lights.new('Magic Sun','SUN');light_data.energy=3
light=bpy.data.objects.new('Magic Sun',light_data);scene.collection.objects.link(light);light['blendlink_id']='magic-sun'
owners=[]
for index,(name,depth,kind) in enumerate([('Default Generated',2,'color'),('Explicit UV',10,'color'),('UV Factor',10,'fac')]):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update()
    uv=mesh.uv_layers.new(name='Magic UV')
    for item,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):item.uv=value
    owner=bpy.data.objects.new(name,mesh);scene.collection.objects.link(owner);owner.location.x=(index-1)*2;owner['blendlink_id']='magic-owner-'+str(index);owners.append(owner)
    material=bpy.data.materials.new(name);material.use_nodes=True;mesh.materials.append(material)
    tree=material.node_tree;surface=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled')
    magic=tree.nodes.new('ShaderNodeTexMagic');magic.turbulence_depth=depth
    if index:
        coordinate=tree.nodes.new('ShaderNodeTexCoord');tree.links.new(coordinate.outputs['UV'],magic.inputs['Vector'])
    socket=next(socket for socket in magic.outputs if socket.identifier==('Fac' if kind=='fac' else 'Color'))
    tree.links.new(socket,surface.inputs['Base Color'])
scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':256,'targetDensity':8,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],
    'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],
    'camera':{'objectId':'magic-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'Desktop','width':192,'height':64,'safeMargin':0}]}})
bpy.ops.wm.save_as_mainfile(filepath=str(output/'Magic.blend'))
# The saved artist scene stays Principled. Render copies of those very same
# upstream Magic graphs into an independent linear native emission carrier.
copies=[]
for owner in owners:
    material=owner.data.materials[0].copy();copies.append(material);owner.data.materials[0]=material
    tree=material.node_tree;surface=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled');sink=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeOutputMaterial')
    emission=tree.nodes.new('ShaderNodeEmission');tree.links.new(surface.inputs['Base Color'].links[0].from_socket,emission.inputs['Color']);tree.links.new(emission.outputs[0],sink.inputs['Surface'])
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.filepath=str(output/'native.exr')
bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
baseline=np.asarray(image.pixels[:],np.float32).reshape(64,192,4)[...,:3].copy();assert np.isfinite(baseline).all();baseline.astype('<f4').tofile(output/'coarse.f32');bpy.data.images.remove(image)
data=bpy.data.images.new('Private scene-color baseline',width=192,height=64,float_buffer=True,alpha=True);data.colorspace_settings.name='Non-Color';data.use_half_precision=False
rgba=np.ones((64,192,4),np.float32);rgba[...,:3]=baseline;data.pixels.foreach_set(rgba.ravel());data.update()
for material in copies:
    tree=material.node_tree;emission=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeEmission');original=emission.inputs['Color'].links[0].from_socket
    window=tree.nodes.new('ShaderNodeTexCoord');texture=tree.nodes.new('ShaderNodeTexImage');texture.image=data;texture.interpolation='Closest';tree.links.new(window.outputs['Window'],texture.inputs['Vector'])
    subtract=tree.nodes.new('ShaderNodeVectorMath');subtract.operation='SUBTRACT';tree.links.new(original,subtract.inputs[0]);tree.links.new(texture.outputs['Color'],subtract.inputs[1])
    carrier=tree.nodes.new('ShaderNodeVectorMath');carrier.operation='MULTIPLY_ADD';carrier.inputs[1].default_value=(512,)*3;carrier.inputs[2].default_value=(.5,)*3;tree.links.new(subtract.outputs[0],carrier.inputs[0]);tree.links.new(carrier.outputs[0],emission.inputs['Color'])
scene.render.filepath=str(output/'residual.exr');bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';residual=np.asarray(image.pixels[:],np.float32).reshape(64,192,4)[...,:3].copy();bpy.data.images.remove(image)
assert np.isfinite(residual).all() and residual.min()>=0 and residual.max()<=1
assert np.array_equal(residual,residual.astype(np.float16).astype(np.float32))
residual.astype('<f4').tofile(output/'residual.f32');(baseline+(residual-np.float32(.5))/np.float32(512)).astype('<f4').tofile(output/'native.f32')
# Calibrate the same full-scene Window lookup and native emission target with
# independently authored Float32 RGB values, without any Magic expression.
index=np.arange(192*64);grid=np.ones((64*192,4),np.float32)
for channel,multiplier in enumerate([1,613,1019]):grid[:,channel]=((index*multiplier)%4096)/np.float32(4096)
data.pixels.foreach_set(grid.ravel());data.update()
for material in copies:
    tree=material.node_tree;emission=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeEmission');texture=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeTexImage');tree.links.new(texture.outputs['Color'],emission.inputs['Color'])
scene.render.filepath=str(output/'calibration.exr');bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';calibration=np.asarray(image.pixels[:],np.float32).reshape(64,192,4)[...,:3].copy();bpy.data.images.remove(image)
maximum=float(np.max(np.abs(calibration-grid.reshape(64,192,4)[...,:3])));assert maximum<=2**-10,maximum
calibration.astype('<f4').tofile(output/'calibration.f32')
(output/'native.json').write_text(json.dumps({'width':192,'height':64,'materials':3,'blender':bpy.app.version_string,'sourceEngine':scene.render.engine,
    'nativeResidualReconstruction':{'amplification':512,'quantizationBound':2**-10/512+2**-22,'independentCalibrationMaximum':maximum}}))
print('BLENDLINK_MAGIC_FINAL_NATIVE_PASSED')
