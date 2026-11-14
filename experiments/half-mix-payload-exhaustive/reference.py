# SPDX-License-Identifier: GPL-3.0-or-later
# GPU-decoded half words are fed unchanged to the actual pinned native CPU kernel.
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
OUT=Path(sys.argv[sys.argv.index('--')+1]);W=H=256;oracle=NativeCompositorReference(OUT,device='CPU',pixels=np.zeros((H,W,4),np.float32),node_previews=False);rows=[];copies=[]
background=np.tile(np.array([.125,.25,.5,.75],np.float32),(W*H,1));factor=np.array([[(i+i//W)%2]*3+[1]for i in range(W*H)],np.float32)
def image(label,data):
 n=bpy.data.images.new('Owned '+label,width=W,height=H,alpha=True,float_buffer=True);n.alpha_mode='PREMUL';n.colorspace_settings.name='Non-Color';n.pixels.foreach_set(data.ravel());got=np.empty(W*H*4,np.float32);n.pixels.foreach_get(got);assert np.array_equal(got.view(np.uint32),data.ravel().view(np.uint32));return n
def im(img):
 n=oracle.tree.nodes.new('CompositorNodeImage');n.image=img;return n.outputs['Image']
def render(label,source,sink):
 oracle.tree.links.new(source,sink.inputs[0]);oracle.scene.render.filepath=str(OUT/(label+'.exr'))
 for n in oracle.tree.nodes:n.show_preview=False
 bpy.ops.render.render(write_still=True);n=bpy.data.images.load(oracle.scene.render.filepath,check_existing=False);n.alpha_mode='PREMUL';got=np.empty(W*H*4,np.float32);n.pixels.foreach_get(got);bpy.data.images.remove(n);(OUT/(label+'.rgba32f')).write_bytes(got.tobytes());return got.view(np.uint32)
backgrounds=[('zero',[0,0,0,0]),('one',[1,1,1,1]),('dyadic',[.125,.25,.5,.75])];fi=image('binary field',factor)
for backend in ['webgpu','webgl2']:
 decoded=np.frombuffer((OUT/(backend+'.decoded.rgba32f')).read_bytes(),np.float32).copy();assert len(decoded)==W*H*4;source=image('actual '+backend+' decoded half',decoded);sink,_=oracle.reset();got=render(backend+'-copy',im(source),sink);copies.append({'backend':backend,'wordDifferences':int(np.count_nonzero(got!=decoded.view(np.uint32)))})
 for bgname,bgvalue in backgrounds:
  bi=image('owned '+bgname+' background',np.tile(np.array(bgvalue,np.float32),(W*H,1)))
  for direction in ['a-b','b-a']:
   for factor_mode in ['zero','one','field']:
    sink,_=oracle.reset();mix=oracle.tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False;ai=next(s for s in mix.inputs if s.identifier=='A_Color');binput=next(s for s in mix.inputs if s.identifier=='B_Color');fin=next(s for s in mix.inputs if s.identifier=='Factor_Float');output=next(s for s in mix.outputs if s.identifier=='Result_Color');oracle.tree.links.new(im(source if direction=='a-b'else bi),ai);oracle.tree.links.new(im(bi if direction=='a-b'else source),binput)
    if factor_mode=='field':
     sep=oracle.tree.nodes.new('CompositorNodeSeparateColor');sep.mode='RGB';oracle.tree.links.new(im(fi),sep.inputs['Image']);oracle.tree.links.new(sep.outputs['Red'],fin)
    else:fin.default_value=0 if factor_mode=='zero'else 1
    label=backend+'-'+bgname+'-'+direction+'-'+factor_mode;got=render(label,output,sink);rows.append({'backend':backend,'backgroundName':bgname,'background':bgvalue,'direction':direction,'factor':factor_mode,'id':label,'file':label+'.rgba32f','words':len(got)})
  bpy.data.images.remove(bi)
 bpy.data.images.remove(source)
report={'status':'captured','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'rows':rows,'copyControls':copies,'nativeRenders':38,'halfEncodingsPerChannel':65536,'supportCredit':0,'finalCredit':0,'sdkChanges':False};assert all(r['wordDifferences']==0 for r in copies);(OUT/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_EXHAUSTIVE_HALF_MIX',len(rows))
