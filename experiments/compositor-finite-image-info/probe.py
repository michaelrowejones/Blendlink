# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned CPU-only finite Image Info semantic probe. No production credit."""
import sys,json,hashlib,struct
from array import array
from pathlib import Path
import bpy,gpu
import numpy as np
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
calls=[]
def deny(*args,**kwargs):calls.append('gpu.init');raise AssertionError('GPU initialization denied')
gpu.init=deny
try:gpu.init()
except AssertionError:pass
assert calls==['gpu.init'];calls.clear()
ref=NativeCompositorReference(OUT,device='CPU',node_previews=False,image_only_scene=True)
scene=ref.scene;tree=ref.tree;scene.cycles.use_denoising=False;scene.render.resolution_x=13;scene.render.resolution_y=9
# Original authored finite sizes intentionally differ from final render extent.
rows=[];render_count=0
for case,kind,size in [('blank-5x3','blank',(5,3)),('blank-zero-negative','blank',(0,-2)),('generated-7x4','image',(7,4)),('packed-byte-3x5','png',(3,5)),('blank-scaled-control','scaled',(5,3))]:
 for output in ['Dimensions','Resolution','Location','Rotation','Scale']:
  tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');info=tree.nodes.new('CompositorNodeImageInfo');owned=None
  if kind in {'blank','scaled'}:
   node=tree.nodes.new('CompositorNodeBlankImage');node.inputs['Size'].default_value=size;node.inputs['Color'].default_value=(.25,.5,.75,1);source=node.outputs['Image']
   if kind=='scaled':
    transform=tree.nodes.new('CompositorNodeTransform');tree.links.new(source,transform.inputs['Image']);transform.inputs['Scale'].default_value=2;source=transform.outputs['Image']
  else:
   node=tree.nodes.new('CompositorNodeImage');owned=bpy.data.images.new('owned '+case,width=size[0],height=size[1],alpha=True,float_buffer=kind!='png');owned.colorspace_settings.name='Linear Rec.709' if kind!='png'else'sRGB';owned.alpha_mode='PREMUL';owned.pixels.foreach_set(np.tile(np.array([.25,.5,.75,1],np.float32),size[0]*size[1]));node.image=owned
   if kind=='png':
    owned.filepath_raw=str(OUT/'authored.png');owned.file_format='PNG';owned.save();bpy.data.images.remove(owned);owned=bpy.data.images.load(str(OUT/'authored.png'),check_existing=False);owned.pack();node.image=owned
   source=node.outputs['Image']
  actual_size=list(node.inputs['Size'].default_value)if kind in {'blank','scaled'}else list(node.image.size)
  tree.links.new(source,info.inputs['Image']);tree.links.new(info.outputs[output],sink.inputs[0]);before=[(n.as_pointer(),n.bl_idname,n.mute)for n in tree.nodes]
  path=OUT/(case+'-'+output+'.exr');scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);render_count+=1
  image=bpy.data.images.load(str(path),check_existing=False)
  try:
   image.alpha_mode='PREMUL';pixels=array('f',[0])*(13*9*4);image.pixels.foreach_get(pixels);words=np.frombuffer(pixels.tobytes(),np.uint32).reshape(-1,4);assert np.all(words==words[0]);pixel_file=case+'-'+output+'.rgba32f';(OUT/pixel_file).write_bytes(pixels.tobytes());rows.append({'case':case,'producer':kind,'requestedSourceSize':list(size),'actualSourceSize':actual_size,'output':output,'rgba':list(pixels[:4]),'words':[int(x)for x in words[0]],'pixelFile':pixel_file,'pixelSha256':hashlib.sha256(pixels.tobytes()).hexdigest()})
  finally:bpy.data.images.remove(image)
  assert before==[(n.as_pointer(),n.bl_idname,n.mute)for n in tree.nodes]
  if owned:bpy.data.images.remove(owned,do_unlink=True)
assert not calls
report={'status':'OBSERVED_FINITE_IMAGE_INFO_NATIVE_CPU','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'nativeRenders':render_count,'gpuInitializationCalls':len(calls),'gpuInitGuardProved':True,'supportCredit':0,'finalCredit':0,'browserCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],render_count)
