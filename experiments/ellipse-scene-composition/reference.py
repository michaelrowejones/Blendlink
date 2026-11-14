# SPDX-License-Identifier: GPL-3.0-or-later
# Research-only unmodified native CPU operations, with independently captured Three pixels.
import bpy,sys,json,hashlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'));sys.path.insert(0,str(ROOT/'packages/blendlink/blender'))
from compositor_reference import NativeCompositorReference
import compositor_graph
DEST=Path(sys.argv[sys.argv.index('--')+1]);baseline=json.loads((DEST/'baseline.json').read_text());rows=[];controls=[];sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();report={'status':'running','supportCredit':0,'finalCredit':0,'rows':rows,'copyControls':controls}
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)

def render(label,w,h):
 for n in oracle.tree.nodes:n.show_preview=False
 path=DEST/(label+'.exr');oracle.scene.render.filepath=str(path);bpy.ops.render.render(write_still=True);image=bpy.data.images.load(str(path),check_existing=False);image.alpha_mode='PREMUL';assert tuple(image.size)==(w,h)
 values=np.empty(w*h*4,np.float32);image.pixels.foreach_get(values);bpy.data.images.remove(image);file=DEST/(label+'.rgba32f');file.write_bytes(values.tobytes());return file,values
for capture in baseline['rows']:
 for entry in capture['rows']:
  w,h=entry['width'],entry['height'];file=DEST/entry['baselineFile'];assert sha(file)==entry['baselineSha256'];data=np.frombuffer(file.read_bytes(),np.float32).copy();assert np.isfinite(data).all();oracle.scene.render.resolution_x=w;oracle.scene.render.resolution_y=h;oracle.scene.render.resolution_percentage=100
  image=bpy.data.images.new('Owned actual Three ScenePass',width=w,height=h,alpha=True,float_buffer=True);image.alpha_mode='PREMUL';image.colorspace_settings.name='Linear Rec.709';image.pixels.foreach_set(data)
  sink,_=oracle.reset();im=oracle.tree.nodes.new('CompositorNodeImage');im.image=image;oracle.tree.links.new(im.outputs['Image'],sink.inputs[0]);copyfile,copied=render(entry['id']+'-copy',w,h);diff=int(np.count_nonzero(copied.view(np.uint32)!=data.view(np.uint32)));controls.append({'id':entry['id'],'file':copyfile.name,'differences':diff,'sha256':sha(copyfile),'inputSha256':entry['baselineSha256']})
  for route in['image','alpha']:
   sink,_=oracle.reset();mask=oracle.tree.nodes.new('CompositorNodeEllipseMask');mask.inputs['Mask'].default_value=0;mask.inputs['Value'].default_value=1;mask.inputs['Position'].default_value=(.5,.5)if w==13 else(.35,.6);mask.inputs['Size'].default_value=(.8,.7)if w==13 else(.9,.55);oracle.tree.links.new(mask.outputs['Mask'],sink.inputs[0]);mask_program=compositor_graph.extract(oracle.scene);assert mask_program['status']=='extracted'
   im=oracle.tree.nodes.new('CompositorNodeImage');im.image=image;source=im.outputs['Image']
   if route=='alpha':
    separate=oracle.tree.nodes.new('CompositorNodeSeparateColor');separate.mode='RGB';oracle.tree.links.new(source,separate.inputs['Image']);source=separate.outputs['Alpha']
   mix=oracle.tree.nodes.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MIX';mix.clamp_factor=True;mix.clamp_result=False
   a=next(s for s in mix.inputs if s.identifier=='A_Color');b=next(s for s in mix.inputs if s.identifier=='B_Color');factor=next(s for s in mix.inputs if s.identifier=='Factor_Float');output=next(s for s in mix.outputs if s.identifier=='Result_Color');b.default_value=(.125,.25,.5,.75);oracle.tree.links.new(mask.outputs['Mask'],factor);oracle.tree.links.new(source,a);oracle.tree.links.new(output,sink.inputs[0]);out,values=render(entry['id']+'-'+route,w,h);rows.append({'id':entry['id'],'route':route,'width':w,'height':h,'inputSha256':entry['baselineSha256'],'file':out.name,'sha256':sha(out),'maskProgram':mask_program,'nativeClass':'ShaderNodeMix','nativeBlend':'MIX','factor':'exact native CompositorNodeEllipseMask binary0/1','sceneDevice':'CYCLES_CPU','compositorDevice':'CPU','precision':'FULL'})
  bpy.data.images.remove(image)
  (DEST/'native-progress.json').write_text(json.dumps(report,indent=2)+'\n')
report.update(status='captured',nativeBuild=bpy.app.build_hash.decode(),nativeVersion=list(bpy.app.version),baselineSha256=sha(DEST/'baseline.json'),fixtureSha256=sha(Path(__file__)),nativeRenders=len(rows)+len(controls));(DEST/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('CAPTURED_NATIVE_SCENE_IMAGE_COMPOSITION',len(rows),'copyDifferences',sum(r['differences']for r in controls))
