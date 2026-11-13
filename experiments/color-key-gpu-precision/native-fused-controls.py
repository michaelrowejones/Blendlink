# SPDX-License-Identifier: GPL-3.0-or-later
"""Native GPU compositor controls plus compiler-source capture, no runtime patch."""
import json
import os
import sys
from pathlib import Path
import bpy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
p=json.loads(Path(os.environ['BLENDLINK_COLOR_KEY_PRIMITIVE_INPUT']).read_text())
output=Path(os.environ['BLENDLINK_COLOR_KEY_PRIMITIVE_OUTPUT']).resolve();output.parent.mkdir(parents=True,exist_ok=True)
pixels=np.asarray(p['input'],np.float32).reshape(p['height'],p['width'],4)
o=NativeCompositorReference(output.parent/'renders',device='GPU',pixels=pixels,image_only_scene=True,node_previews=False)
engines={item.identifier for item in o.scene.render.bl_rna.properties['engine'].enum_items}
o.scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
rows=[]
native_hsv=None
for name in ['independent','separate-hsv','key-boundary-image','key-boundary-matte','sat-reciprocal-below','sat-reciprocal-at','sat-reciprocal-above']:
 sink,_=o.reset();im=o.tree.nodes.new('CompositorNodeImage');im.image=o.image
 if name=='independent':value=im.outputs['Image']
 elif name=='separate-hsv':
  separate=o.separate(im.outputs['Image']);separate.mode='HSV'
  combine=o.tree.nodes.new('CompositorNodeCombineColor')
  for incoming,outgoing in zip(combine.inputs,separate.outputs):o.tree.links.new(outgoing,incoming)
  value=combine.outputs[0]
 else:
  key=o.tree.nodes.new('CompositorNodeColorMatte')
  key.inputs['Key Color'].default_value=(4,1,1,1) if name.startswith('sat-reciprocal') else (1,.25,.25,1)
  sat=np.float32(native_hsv[72,1]-np.float32(.75)) if native_hsv is not None else np.float32(0)
  if name.endswith('below'):sat=np.nextafter(sat,np.float32(-np.inf))
  if name.endswith('above'):sat=np.nextafter(sat,np.float32(np.inf))
  for label,attr,number in [('Hue','color_hue',1 if name.startswith('sat-reciprocal') else .1250000149011612),('Saturation','color_saturation',float(sat) if name.startswith('sat-reciprocal') else 1),('Value','color_value',1)]:
   if o.modern:key.inputs[label].default_value=number
   else:setattr(key,attr,number)
  o.tree.links.new(im.outputs['Image'],key.inputs['Image'])
  value=key.outputs['Matte' if name.endswith('matte') or name.startswith('sat-reciprocal') else 'Image']
 o.tree.links.new(value,sink.inputs[0]);o.scene.render.filepath=str(output.parent/'renders'/f'{name}.exr')
 with o._render_sampling():bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(o.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL'
 actual=np.asarray(image.pixels[:],np.float32)
 rows.append({'control':name,'values':actual.tolist(),'words':actual.view(np.uint32).tolist()})
 if name=='separate-hsv':native_hsv=actual.reshape(-1,4).copy()
 bpy.data.images.remove(image)
 if name=='sat-reciprocal-at':bpy.ops.wm.save_as_mainfile(filepath=str(output.parent/'saturation-reciprocal-counterexample.blend'))
import gpu
output.write_text(json.dumps({'blenderVersion':list(bpy.app.version),'blenderHash':bpy.app.build_hash.decode(),
 'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get(),'input':pixels.ravel().tolist(),
 'width':o.width,'height':o.height,'rows':rows},separators=(',',':')))
print('BLENDLINK_COLOR_KEY_FUSED_CONTROLS_PASSED',output)
