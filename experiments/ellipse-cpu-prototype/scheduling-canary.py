# SPDX-License-Identifier: GPL-3.0-or-later
# Retained native-only scheduling observation; no source admission or browser credit.
import sys,json
from pathlib import Path
import bpy,numpy as np
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'packages/blender-addon/tests'));sys.path.insert(0,str(root/'packages/blendlink/blender'))
from compositor_reference import NativeCompositorReference
out=root/'artifacts/verification-ellipse-source-layout-review/zero-domain';o=NativeCompositorReference(out,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False);rows=[]
for size in [(0,.5),(.5,.5)]:
 for operation in ['Add','Subtract','Multiply','Not']:
  sink,source=o.reset();n=o.tree.nodes.new('CompositorNodeEllipseMask');n.inputs['Operation'].default_value=operation;n.inputs['Mask'].default_value=.25;n.inputs['Value'].default_value=.75;n.inputs['Size'].default_value=size;info=o.tree.nodes.new('CompositorNodeImageInfo');o.tree.links.new(n.outputs['Mask'],info.inputs['Image']);o.tree.links.new(info.outputs['Dimensions'],sink.inputs[0]);o.scene.render.filepath=str(out/'native.exr');bpy.ops.render.render(write_still=True);image=bpy.data.images.load(o.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';data=np.empty(13*9*4,np.float32);image.pixels.foreach_get(data);bpy.data.images.remove(image);unique=np.unique(data.reshape(-1,4),axis=0).tolist();expected=[0,0,0,1]if size[0]==0 else[13,9,0,1];assert unique==[expected],(size,operation,unique);rows.append({'size':size,'operation':operation,'nativeDimensionsRGBA':unique[0]})
(out/'report.json').write_text(json.dumps({'status':'native-ellipse-zero-domain-canary-only','device':'CPU','sceneEngine':'CYCLES','precision':'FULL','rows':rows,'sourceAdmissionCredit':0,'browserCredit':0,'numericCoverageCredit':0},indent=2)+'\n');print('ELLIPSE_ZERO_DOMAIN_CANARY_PASSED',json.dumps(rows))
