# SPDX-License-Identifier: GPL-3.0-or-later
# Native CPU scheduling only; no source admission or port credit.
import bpy,json,sys,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(parents=True,exist_ok=True);oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False);rows=[]
for size in [(0,.5),(.5,0),(0,0),(.5,.5)]:
 for operation in ['Add','Subtract','Multiply','Not']:
  sink,_=oracle.reset();node=oracle.tree.nodes.new('CompositorNodeBoxMask');node.inputs['Operation'].default_value=operation;node.inputs['Mask'].default_value=.25;node.inputs['Value'].default_value=.75;node.inputs['Size'].default_value=size;info=oracle.tree.nodes.new('CompositorNodeImageInfo');oracle.tree.links.new(node.outputs['Mask'],info.inputs['Image']);oracle.tree.links.new(info.outputs['Dimensions'],sink.inputs[0]);label='box-'+str(len(rows));oracle.scene.render.filepath=str(OUT/(label+'.exr'));bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';pixels=np.empty(13*9*4,np.float32);image.pixels.foreach_get(pixels);bpy.data.images.remove(image);unique=np.unique(pixels.reshape(-1,4),axis=0).tolist();assert unique==[[13,9,0,1]],(size,operation,unique);rows.append({'size':size,'operation':operation,'nativeDimensionsRGBA':unique[0]})
report={'status':'OBSERVED_NATIVE_BOX_FULL_FRAME_SCHEDULING','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'nativeRenders':len(rows),'gpuInitializationCalls':0,'supportCredit':0,'finalCredit':0};(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'],len(rows))
