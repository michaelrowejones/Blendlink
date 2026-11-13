# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual artist-style saved packed-PNG scene and independent CPU references."""
import hashlib,json,os,struct,zlib
from pathlib import Path
import bpy
import numpy as np

out=Path(os.environ['BLENDLINK_COMPOSITOR_IMAGE_FINAL']).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=False)
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
scene.eevee.taa_render_samples=1
scene.render.resolution_percentage=100;scene.render.compositor_device='CPU';scene.render.compositor_precision='FULL'
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32'
modern=hasattr(scene,'compositing_node_group')
if modern:
    tree=bpy.data.node_groups.new('Artist Image Composition','CompositorNodeTree')
    tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor');scene.compositing_node_group=tree
else:scene.use_nodes=True;tree=scene.node_tree
tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput' if modern else 'CompositorNodeComposite')
large=os.environ.get('BLENDLINK_COMPOSITOR_IMAGE_1080P')=='1'
width,height=(1920,1080) if large else (12,6);y,x=np.mgrid[:height,:width]
pixels=np.stack([(x*17+y*41)%256,(x*57+y*13)%256,(x*31+y*7)%256,
    np.asarray([0,64,128,255],np.uint8)[x%4]],axis=-1).astype(np.uint8)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
encoded=bytes([137,80,78,71,13,10,26,10])+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))
encoded+=chunk(b'IDAT',zlib.compress(b''.join(bytes([0])+row.tobytes() for row in pixels[::-1])))+chunk(b'IEND',b'')
path=out/'Artist packed background.png';path.write_bytes(encoded)
image=bpy.data.images.load(str(path),check_existing=False);image.colorspace_settings.name='sRGB';image.alpha_mode='STRAIGHT';image.pack()
node=tree.nodes.new('CompositorNodeImage');node.image=image;node.name='Artist packed Image'
tree.links.new(node.outputs['Image'],sink.inputs[0])
def render(w,h):
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.filepath=str(out/'native.exr')
    bpy.ops.render.render(write_still=True)
    reference=bpy.data.images.load(scene.render.filepath,check_existing=False);reference.alpha_mode='PREMUL'
    values=list(reference.pixels[:]);bpy.data.images.remove(reference)
    return values
native_input=render(width,height)
native_input_sha=hashlib.sha256(np.asarray(native_input,dtype='<f4').tobytes()).hexdigest()
if large:native_input=None
grade=tree.nodes.new('CompositorNodeInvert');tree.links.new(node.outputs['Image'],grade.inputs['Color']);tree.links.new(grade.outputs[0],sink.inputs[0])
opaque=os.environ.get('BLENDLINK_COMPOSITOR_IMAGE_OPAQUE')=='1'
if opaque:
    assert not modern,'Legacy Composite opaque-output fixture requires Blender4.2'
    sink.use_alpha=False
expected=render(16,8)
source=out/'Artist Image.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source))
(out/'native-reference.json').write_text(json.dumps({'blender':bpy.app.version_string,'hash':bpy.app.build_hash.decode(),
    'width':16,'height':8,'imageWidth':width,'imageHeight':height,'nativeInput':native_input,'nativeInputSha256':native_input_sha,'expected':expected,
    'outputAlpha':'legacy-composite-opaque-v1' if opaque else None,
    'calibration':np.random.default_rng(4195).uniform(-.5,2,(8,16,4)).astype(np.float32).ravel().tolist()}))
print('BLENDLINK_STATIC_IMAGE_FINAL_SAVED',source)
