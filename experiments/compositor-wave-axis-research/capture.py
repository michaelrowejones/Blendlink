# SPDX-License-Identifier: GPL-3.0-or-later
"""Research only: unchanged native5.3 Wave, CPU compositor FULL, no gpu.init."""
from pathlib import Path
from array import array
import hashlib,json,os,struct,sys
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon/tests'),str(ROOT/'packages/blendlink/blender'),str(ROOT/'packages/blender-addon')]
from compositor_reference import NativeCompositorReference
from compositor_white_noise import _raw
assert tuple(bpy.app.version)==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
OUT=Path(os.environ['SCENETOWEB_WAVE_AXIS_OUTPUT']).resolve();OUT.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
pinned={str(p.relative_to(ROOT)):sha(p) for p in [Path(__file__).resolve(),ROOT/'packages/blender-addon/tests/compositor_reference.py',ROOT/'packages/blendlink/blender/compositor_white_noise.py']}
reference=NativeCompositorReference(OUT,device='CPU',name='Owned Wave axis research',pixels=np.ones((9,13,4),np.float32),node_previews=False)
scene,tree=reference.scene,reference.tree
settings=[('default',5.,0.),('ordinary',.1,.3),('negative',-1.25,-.1),('zero-scale',0.,0.),('minimum',2**-16,.125),('scale-predecessor',float(np.nextafter(np.float32(5),np.float32(0))),0.),('scale-successor',float(np.nextafter(np.float32(5),np.float32(10))),0.)]
profiles=os.environ.get('SCENETOWEB_WAVE_AXIS_PROFILES','SAW,TRI').split(',')
assert profiles and len(profiles)==len(set(profiles)) and all(profile in {'SAW','TRI','SIN'} for profile in profiles)
cases=[]
for width,height in [(13,9),(9,13)]:
 for direction in ['X','Y']:
  for profile in profiles:
   for label,scale,phase in settings:cases.append((f'{width}x{height}-{direction}-{profile}-{label}',width,height,direction,profile,scale,phase))
for width,height in [(8192,4),(4,8192)]:
 for direction in ['X','Y']:
  for profile in profiles:cases.append((f'{width}x{height}-{direction}-{profile}-default',width,height,direction,profile,5.,0.))
plan_path=os.environ.get('SCENETOWEB_WAVE_AXIS_PLAN')
plan=None
if plan_path:
 plan_path=Path(plan_path).resolve();plan=json.loads(plan_path.read_text());pinned[str(plan_path.relative_to(ROOT))]=sha(plan_path)
 cases=[]
 for spec in plan['cases']:
  scale,phase,distortion=[struct.unpack('=f',struct.pack('=I',word))[0] for word in spec['parameterWords']]
  assert distortion==0 and spec['parameterWords'][2]==0
  cases.append((spec['case'],spec['width'],spec['height'],spec['axis'],spec['profile'],scale,phase))
rows=[]
for index,(name,width,height,direction,profile,scale,phase) in enumerate(cases):
 tree.nodes.clear();sink=tree.nodes.new('NodeGroupOutput');wave=tree.nodes.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction=direction;wave.wave_profile=profile
 wave.inputs['Scale'].default_value=scale;wave.inputs['Phase Offset'].default_value=phase;wave.inputs['Distortion'].default_value=0.
 assert not wave.inputs['Vector'].is_linked and not wave.inputs['Scale'].is_linked and not wave.inputs['Phase Offset'].is_linked
 words=_raw([wave.inputs['Scale'],wave.inputs['Phase Offset'],wave.inputs['Distortion']],'VALUE');flat=[part[0] for part in words]
 tree.links.new(wave.outputs['Fac'],sink.inputs[0]);scene.render.resolution_x=width;scene.render.resolution_y=height
 scene.render.filepath=str(OUT/'current.exr');bpy.ops.render.render(write_still=True)
 loaded=bpy.data.images.load(scene.render.filepath,check_existing=False);loaded.alpha_mode='PREMUL';raw=array('f',[0])*len(loaded.pixels);loaded.pixels.foreach_get(raw)
 assert len(raw)==width*height*4
 destination=OUT/(name+'.rgba32f');destination.write_bytes(raw.tobytes());bpy.data.images.remove(loaded)
 assert _raw([wave.inputs['Scale'],wave.inputs['Phase Offset'],wave.inputs['Distortion']],'VALUE')==words
 rows.append({'case':name,'width':width,'height':height,'axis':direction,'profile':profile,'parameterWords':flat,'nativeFile':destination.name,'nativeSha256':sha(destination),'nativeOutput':'Fac→native Float-to-RGBA','sourceClass':wave.bl_idname,'sourceVector':'native implicit Uniform','compositorDevice':scene.render.compositor_device,'precision':scene.render.compositor_precision,'sceneEngine':scene.render.engine})
for name,pin in pinned.items():assert sha(ROOT/name)==pin
(OUT/'report.json').write_text(json.dumps({'schemaVersion':1,'status':'RESEARCH_NATIVE_WAVE_AXES_CAPTURED','supportCredit':0,'native':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode()},'sourcePins':pinned,'plan':plan,'renderCount':len(rows),'rows':rows,'gpuInitCalls':0},indent=2)+'\n')
print('SCENETOWEB_WAVE_AXIS_NATIVE_CAPTURED '+str(len(rows)))
