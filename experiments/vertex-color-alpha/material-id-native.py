# SPDX-License-Identifier: GPL-3.0-or-later
"""Diagnostic only: unchanged saved geometry/camera, independent flat IDs."""
from array import array
from pathlib import Path
import bpy
import hashlib
import json
import os

source=Path(os.environ['SCENETOWEB_ALPHA_ID_SOURCE']).resolve()
out=Path(os.environ['SCENETOWEB_ALPHA_ID_OUTPUT']).resolve();out.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
before=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source))
scene=bpy.context.scene
assert scene.render.engine=='BLENDER_EEVEE' and scene.camera is not None
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
owners={name:index for index,name in enumerate(('Artist Field Owner','Artist Shared Field Owner'),1)}
for name,index in owners.items():bpy.data.objects[name].pass_index=index
for index,name in enumerate(('Artist Vertex Alpha 0','Artist Vertex Alpha 1'),1):
    material=bpy.data.materials[name];tree=material.node_tree;tree.nodes.clear()
    output=tree.nodes.new('ShaderNodeOutputMaterial');emission=tree.nodes.new('ShaderNodeEmission')
    combine=tree.nodes.new('ShaderNodeCombineXYZ');combine.inputs['Y'].default_value=index/4
    info=tree.nodes.new('ShaderNodeObjectInfo');scale=tree.nodes.new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=.25
    tree.links.new(info.outputs['Object Index'],scale.inputs[0]);tree.links.new(scale.outputs[0],combine.inputs['X'])
    tree.links.new(combine.outputs[0],emission.inputs['Color']);tree.links.new(emission.outputs[0],output.inputs['Surface'])
scene.render.resolution_x=scene.render.resolution_y=96;scene.render.resolution_percentage=100
scene.eevee.taa_render_samples=1;scene.render.use_compositing=False;scene.render.use_sequencer=False
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32';scene.render.image_settings.color_mode='RGBA'
exr=out/'material-ids.exr';scene.render.filepath=str(exr);bpy.ops.render.render(write_still=True)
image=bpy.data.images.load(str(exr),check_existing=False)
try:
    pixels=array('f',[0])*(96*96*4);image.pixels.foreach_get(pixels)
finally:bpy.data.images.remove(image)
raw=out/'material-ids.rgba32f';raw.write_bytes(pixels.tobytes())
assert sha(source)==before
report={'status':'DIAGNOSTIC_NATIVE_ALPHA_MATERIAL_IDS','sourceFile':str(source),'sourceSha256':before,
    'width':96,'height':96,'format':'R=ownerIndex/4; G=sourceMaterialIndex/4; B=0; A=1',
    'owners':owners,'materials':{'Artist Vertex Alpha 0':1,'Artist Vertex Alpha 1':2},
    'rawFile':raw.name,'rawSha256':sha(raw),'exrSha256':sha(exr),'portCredit':0,'qualificationCredit':0,
    'changes':'Private loaded process only: material outputs replaced by flat IDs and object pass_index assigned. No geometry/camera/input-alpha edits; original saved file unchanged.'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
