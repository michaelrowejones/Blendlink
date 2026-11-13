# SPDX-License-Identifier: GPL-3.0-or-later
import bpy,json,os
from pathlib import Path
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1;scene.cycles.use_denoising=False
import _cycles
_cycles.set_device_override('CPU')
scene.world=None;scene.render.resolution_x=scene.render.resolution_y=8;scene.render.resolution_percentage=100;scene.render.use_compositing=False;scene.render.dither_intensity=0
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
bpy.ops.mesh.primitive_plane_add(size=2);owner=bpy.context.object
camera_data=bpy.data.cameras.new('c');camera_data.type='ORTHO';camera_data.ortho_scale=2;camera=bpy.data.objects.new('c',camera_data);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera
material=bpy.data.materials.new('Squeeze Cycles native counter');material.use_nodes=True;owner.data.materials.append(material)
tree=material.node_tree;tree.nodes.clear();sink=tree.nodes.new('ShaderNodeOutputMaterial');emit=tree.nodes.new('ShaderNodeEmission');squeeze=tree.nodes.new('ShaderNodeSqueeze');tree.links.new(squeeze.outputs[0],emit.inputs['Color']);tree.links.new(emit.outputs[0],sink.inputs['Surface'])
scene.render.filepath=str(Path(os.environ['BLENDLINK_SQUEEZE_CYCLES']).with_suffix('.exr'));bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(scene.render.filepath,check_existing=False);rgba=list(image.pixels)[(4*8+4)*4:(4*8+4)*4+4]
record={'version':list(bpy.app.version),'engine':scene.render.engine,'controls':[float(s.default_value) for s in squeeze.inputs],'nativeRgba':rgba,'sameGraphEevee':[.5,.5,.5,1]}
Path(os.environ['BLENDLINK_SQUEEZE_CYCLES']).write_text(json.dumps(record,indent=2));print('BLENDLINK_SQUEEZE_CYCLES_OBSERVATION',json.dumps(record))
