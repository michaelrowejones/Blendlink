# SPDX-License-Identifier: GPL-3.0-or-later
"""Save owned original-color emission fixtures; no render/GPU initialization."""
import hashlib,json,sys
from pathlib import Path
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2]
source,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:2]);out.mkdir()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
source_sha=sha(source);assert source_sha=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
bpy.ops.wm.open_mainfile(filepath=str(source));original_scene=bpy.context.scene;original=bpy.data.materials['Plaster'];material=original.copy();material.name='Owned original Plaster color only';t=material.node_tree
principled=t.nodes['Principled BSDF']
# Preserve the original BSDF/color graph; disconnect only the unqualified normal
# in this explicitly derived fixture, never the artist's original file.
for link in list(principled.inputs['Normal'].links):t.links.remove(link)
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender'),str(ROOT/'experiments/box-image-storage-stage')]
import material_compiler as compiler
from geometry_fixture import fixture
scene,owner,camera,cases,activate,settings=fixture(original_scene)
records=[];calls={'gpu':0,'render':0}
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('BOX color fixture preparation must not initialize GPU')
def deny_render(*a,**k):calls['render']+=1;raise RuntimeError('BOX color fixture preparation must not render')
gpu.init=deny_gpu;bpy.ops.render.render=deny_render
for case in cases:
 if case['id'] not in {'plane-1','source-Walls','source-Plane.021'}:continue
 activate(case['id']);original_shift=[camera.data.shift_x,camera.data.shift_y];camera.data.shift_x=camera.data.shift_y=0
 owner.data.materials.clear();owner.data.materials.append(material);camera['blendlink_id']='owned-box-camera'
 scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':128,'targetDensity':1,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],'optimization':{'geometry':'meshopt','textures':'none'},'camera':{'objectId':'owned-box-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'Original Plaster color signal','width':64,'height':4,'safeMargin':0}]}})
 path=out/(case['id']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(path))
 plan=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
 if plan.errors:raise RuntimeError(compiler.format_plan_errors(plan))
 def nodes(v):
  if isinstance(v,dict):
   if 'op'in v:yield v
   for value in v.values():yield from nodes(value)
  elif isinstance(v,(list,tuple)):
   for value in v:yield from nodes(value)
 programs=[item['tslIr'] for d in plan.lowerings for item in d.channel_plan['channels'] if item.get('tslIr')]
 box=[n for program in programs for n in nodes(program) if n.get('op')=='texture_box_ref'];assert box and all(n['model']=='eevee-metal-box-color-mips-v1' for n in box)
 assert not any(n['op']=='normal_map_tangent_native' for program in programs for n in nodes(program))
 records.append({'id':case['id'],'observationCamera':{'originalShift':original_shift,'ownedShift':[0,0],'reason':'Explicit zero-shift color-only observation; the original camera remains unqualified and unchanged'},'sourceFile':str(path),'sourceSha256':sha(path),'programs':programs,'plan':plan.as_dict()})
assert len(records)==3 and calls=={'gpu':0,'render':0} and sha(source)==source_sha
(out/'fixtures.json').write_text(json.dumps({'status':'SAVED_OWNED_ORIGINAL_COLOR_ONLY_FIXTURES','sourceOriginal':str(source),'sourceOriginalSha256':source_sha,'sourceOriginalPreserved':True,'supportCredit':0,'materialCredit':0,'sceneCredit':0,'normalMap':'Original full material remains refused; only Normal is explicitly disconnected in the owned original-BSDF fixture; original artist source stays unchanged','calls':calls,'scriptSha256':sha(__file__),'cases':records},indent=2)+'\n')
print('SCENETOWEB_BOX_COLOR_FIXTURES_SAVED')
