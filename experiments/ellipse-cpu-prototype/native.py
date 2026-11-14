# SPDX-License-Identifier: GPL-3.0-or-later
# Research-only actual CPU compositor. No production emitter changes, Final or browser proof.
import bpy,sys,json,hashlib,os,time
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
DEST=Path(sys.argv[sys.argv.index('--')+1]);specs=json.loads((DEST/'cases.json').read_text());rows=[]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
pins={str(p.relative_to(ROOT)):sha(p)for p in [Path(__file__),ROOT/'packages/blender-addon/tests/compositor_reference.py',*(ROOT/'packages/blendlink/blender').glob('*.py')]}
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash.decode()=='02f0899d78e3'
oracle=NativeCompositorReference(DEST,device='CPU',pixels=np.zeros((9,13,4),np.float32),node_previews=False)
# Remove only owned factory render geometry. This does not alter the native compositor.
for obj in list(bpy.data.objects):
 if obj.type!='CAMERA':bpy.data.objects.remove(obj,do_unlink=True)
for spec in specs:
 started=time.perf_counter();s=spec['settings'];w,h=spec['width'],spec['height'];sink,source=oracle.reset();node=oracle.tree.nodes.new('CompositorNodeEllipseMask');node.inputs['Operation'].default_value=s['operation'].capitalize()
 for name,key in [('Position','position'),('Size','size'),('Mask','mask'),('Value','value')]:node.inputs[name].default_value=s[key]
 assert node.inputs['Rotation'].default_value==0
 actual={'operation':s['operation'],'position':list(node.inputs['Position'].default_value),'size':list(node.inputs['Size'].default_value),'mask':node.inputs['Mask'].default_value,'value':node.inputs['Value'].default_value};assert actual==s,(spec['id'],actual,s)
 oracle.tree.links.new(node.outputs['Mask'],sink.inputs[0]);oracle.scene.render.resolution_percentage=100;oracle.scene.render.resolution_x=w;oracle.scene.render.resolution_y=h
 if min(w,h)<4:oracle.scene.render.resolution_x=w*2;oracle.scene.render.resolution_y=h*2;oracle.scene.render.resolution_percentage=50
 assert oracle.scene.render.engine=='CYCLES'and oracle.scene.cycles.device=='CPU'and oracle.scene.render.compositor_device=='CPU'and oracle.scene.render.compositor_precision=='FULL'
 for n in oracle.tree.nodes:n.show_preview=False
 exr=DEST/(spec['id']+'.exr');oracle.scene.render.filepath=str(exr);bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(str(exr),check_existing=False);image.alpha_mode='PREMUL';assert tuple(image.size)==(w,h),(spec['id'],tuple(image.size))
 data=np.empty(w*h*4,np.float32);image.pixels.foreach_get(data);bpy.data.images.remove(image);assert np.isfinite(data).all()
 raw=DEST/(spec['id']+'.rgba32f');raw.write_bytes(data.tobytes());rows.append({**spec,'file':raw.name,'sha256':sha(raw),'exrSha256':sha(exr),'elapsedSeconds':time.perf_counter()-started})
 (DEST/'native-progress.json').write_text(json.dumps({'status':'running','rows':rows},indent=2))
assert pins=={p:sha(ROOT/p)for p in pins}
report={'status':'ELLIPSE_NATIVE_CPU_RESEARCH_CAPTURED','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'sourceDevice':'CPU','sceneDevice':'CYCLES_CPU','requestedPrecision':'FULL','rows':rows,'sourcePins':pins,'finalCredit':0,'browserCredit':0,'supportCredit':0}
(DEST/'native.json').write_text(json.dumps(report,indent=2)+'\n');print('ELLIPSE_NATIVE_CPU_RESEARCH_CAPTURED',len(rows))
