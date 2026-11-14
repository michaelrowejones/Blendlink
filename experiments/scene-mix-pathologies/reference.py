# SPDX-License-Identifier: GPL-3.0-or-later
# Research-only untouched native image-field arithmetic.
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(sys.argv[sys.argv.index('--')+1]);OUT.mkdir(parents=True,exist_ok=True)
W,H=16,4
patterns=[0,0x80000000,0xbf800000,0x477fe000,0x7f800000,0xff800000,0x7fc00001,0xffc00001,1,0x80000001,0x00800000,0x80800000,0x3f800000,0x7f7fffff,0xff7fffff,0x3e000000]
a=np.array([[patterns[x],patterns[(x+3)%W],patterns[(x+7)%W],patterns[(x+9)%W]]for y in range(H)for x in range(W)],np.uint32)
b=np.tile(np.array([0x3e000000,0x3e800000,0x3f000000,0x3f400000],np.uint32),(W*H,1));f=np.array([[0x3f800000 if (x+y)%2 else 0]*3+[0x3f800000]for y in range(H)for x in range(W)],np.uint32)
oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((H,W,4),np.float32),node_previews=False)
images={};controls=[];rows=[]
for label,data in [('a',a),('b',b),('factor',f)]:
 image=bpy.data.images.new('Owned pathology '+label,width=W,height=H,alpha=True,float_buffer=True);image.alpha_mode='PREMUL';image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(data.view(np.float32).ravel());stored=np.empty(W*H*4,np.float32);image.pixels.foreach_get(stored);assert np.array_equal(stored.view(np.uint32),data.ravel());images[label]=image;(OUT/(label+'.rgba32f')).write_bytes(data.tobytes())
def render(label,source,sink):
 oracle.tree.links.new(source,sink.inputs[0]);oracle.scene.render.filepath=str(OUT/(label+'.exr'))
 for n in oracle.tree.nodes:n.show_preview=False
 bpy.ops.render.render(write_still=True);image=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);image.alpha_mode='PREMUL';result=np.empty(W*H*4,np.float32);image.pixels.foreach_get(result);bpy.data.images.remove(image);(OUT/(label+'.rgba32f')).write_bytes(result.tobytes());return result.view(np.uint32)
def im(label):
 n=oracle.tree.nodes.new('CompositorNodeImage');n.image=images[label];return n.outputs['Image']
for label,data in [('a',a),('b',b),('factor',f)]:
 sink,_=oracle.reset();words=render('copy-'+label,im(label),sink);controls.append({'input':label,'differences':int(np.count_nonzero(words!=data.ravel()))})
for route in ['a-b','b-a']:
 for factor in ['field','zero','one']:
  sink,_=oracle.reset();mix=oracle.tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False
  ai=next(s for s in mix.inputs if s.identifier=='A_Color');bi=next(s for s in mix.inputs if s.identifier=='B_Color');fi=next(s for s in mix.inputs if s.identifier=='Factor_Float');output=next(s for s in mix.outputs if s.identifier=='Result_Color');left,right=route.split('-');oracle.tree.links.new(im(left),ai);oracle.tree.links.new(im(right),bi)
  if factor=='field':
   separate=oracle.tree.nodes.new('CompositorNodeSeparateColor');separate.mode='RGB';oracle.tree.links.new(im('factor'),separate.inputs['Image']);oracle.tree.links.new(separate.outputs['Red'],fi)
  else:fi.default_value=0 if factor=='zero'else 1
  words=render(route+'-'+factor,output,sink);rows.append({'id':route+'-'+factor,'left':left,'right':right,'factor':factor,'file':route+'-'+factor+'.rgba32f','words':len(words)})
report={'status':'captured','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'width':W,'height':H,'patterns':patterns,'copyControls':controls,'rows':rows,'nativeRenders':9,'supportCredit':0,'finalCredit':0,'sdkChanges':False}
assert all(c['differences']==0 for c in controls),controls
(OUT/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_MIX_PATHOLOGIES',len(rows),controls)
