# SPDX-License-Identifier: GPL-3.0-or-later
"""One CPU policy case per worker; persistent native operator denial first."""
import hashlib,json,sys,time
from pathlib import Path
import bpy,gpu
assert bpy.app.background,'CPU policy guards belong to a disposable headless worker'

calls={'gpu':0,'render':0,'bake':0}
class NativeWorkDenied(RuntimeError):pass
def deny_gpu(*args,**kwargs):
 calls['gpu']+=1;raise NativeWorkDenied('Policy worker forbids native GPU initialization')
def deny_render(*args,**kwargs):
 calls['render']+=1;raise NativeWorkDenied('Policy worker forbids native rendering')
def deny_bake(*args,**kwargs):
 calls['bake']+=1;raise NativeWorkDenied('Policy worker forbids native baking')
# bpy.ops.<submodule> creates a fresh proxy until assigned on bpy.ops itself.
# Set the persistent module, not merely a temporary proxy's operator attribute.
operators={};original_types={}
for name,required,optional,deny in [('render',['render'],['opengl'],deny_render),('object',['bake'],['bake_image'],deny_bake)]:
 module=getattr(bpy.ops,name);available=set(dir(module));assert all(op in available for op in required)
 for op in required+[op for op in optional if op in available]:
  original_types[name+'.'+op]=type(getattr(module,op)).__name__;setattr(module,op,deny);operators[(name,op)]=deny
 setattr(bpy.ops,name,module)
gpu.init=deny_gpu
def verify_denials():
 assert gpu.init is deny_gpu
 for (module,op),deny in operators.items():assert getattr(getattr(bpy.ops,module),op) is deny
verify_denials()
self_tests={}
for name,lookup in [('gpu.init',lambda:gpu.init)]+[(module+'.'+op,lambda module=module,op=op:getattr(getattr(bpy.ops,module),op)) for module,op in operators]:
 try:lookup()()
 except NativeWorkDenied:self_tests[name]='REFUSED_BEFORE_NATIVE_CALL'
 else:raise AssertionError('Native-work denial did not persist at '+name)
self_test_counts=dict(calls)
assert self_test_counts['gpu']==1 and self_test_counts['render']>=1 and self_test_counts['bake']>=1
calls.update(gpu=0,render=0,bake=0)
guards={'status':'PERSISTENT_NATIVE_LOOKUP_DENIAL_SELFTEST_PASSED','operators':self_tests,'selfTestDeniedCalls':self_test_counts,'originalOperatorTypes':original_types,'nativeGpuRenderBakeCalls':0}
args=sys.argv[sys.argv.index('--')+1:]
if args==['--check-deny']:
 print('SCENETOWEB_POLICY_DENY_SELFTEST '+json.dumps(guards,sort_keys=True),flush=True);sys.exit(0)
assert len(args)==2 and args[1].startswith('--case=')
selected=args[1].split('=',1)[1];assert selected in {'plane-1','source-Plane.021','source-Walls'}
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler
out=Path(args[0]).resolve();fixtures=json.loads((out/'fixtures.json').read_text());cases=[c for c in fixtures['cases'] if c['id']==selected];assert len(cases)==1
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();rows=[];timings=[]
def timed(phase,action):
 started=time.monotonic();print('SCENETOWEB_POLICY_PHASE '+json.dumps({'case':selected,'phase':phase,'event':'begin'}),flush=True)
 try:return action()
 finally:
  record={'case':selected,'phase':phase,'seconds':time.monotonic()-started};timings.append(record);print('SCENETOWEB_POLICY_PHASE '+json.dumps(record),flush=True)
for fixture in cases:
 source=Path(fixture['sourceFile']);assert timed('source-hash-before',lambda:sha(source))==fixture['sourceSha256']
 timed('open-saved-source',lambda:bpy.ops.wm.open_mainfile(filepath=str(source)));verify_denials()
 owner=bpy.context.scene.objects['Owned BOX source geometry'];material=owner.data.materials[0];tree=material.node_tree
 assert not tree.nodes['Principled BSDF'].inputs['Normal'].is_linked and tree.nodes['Principled BSDF'].inputs['Base Color'].is_linked
 plan=timed('positive-plan',lambda:compiler.plan_materials([owner],purpose='final',automatic_programs=True));assert not plan.errors,compiler.format_plan_errors(plan)
 entries=[item for d in plan.lowerings for item in d.channel_plan['channels']];color=next(e for e in entries if e['channel']=='Base Color');alpha=next(e for e in entries if e['channel']=='Alpha')
 assert color.get('tslIr') and alpha.get('tslIr') and alpha['tslIr']['output']=={'op':'const_float','value':1.0}
 needs={'uvMaps':set(),'colorLayers':set(),'objectAttributes':set(),'objectInfo':set(),'geometryContext':set(),'tangentFrames':set(),'requiresNodeRendererPrograms':set(),'usesActiveUv':False,'usesGenerated':False,'objectSpace':False}
 for e in entries:
  if e.get('tslIr'):compiler._ir_runtime_needs(e['tslIr'],needs)
 assert ('texture_box_ref','eevee-metal-box-color-mips-v1') in needs['requiresNodeRendererPrograms']
 original_data=owner.data;original_material=material;source_root=tree.nodes['Principled BSDF'];source_links=len(source_root.inputs['Base Color'].links)
 class ProbeFinished(Exception):pass
 def probe(_path):
  private=owner.material_slots[0].material
  assert private!=original_material and private.node_tree!=tree
  root=private.node_tree.nodes['Principled BSDF']
  assert not root.inputs['Base Color'].is_linked and tuple(root.inputs['Base Color'].default_value)==(1.,1.,1.,1.)
  assert not root.inputs['Alpha'].is_linked and root.inputs['Alpha'].default_value==1
  assert len(source_root.inputs['Base Color'].links)==source_links
  raise ProbeFinished()
 try:timed('private-carrier-restoration',lambda:compiler.with_compiled_materials(plan,str(out/(fixture['id']+'-never-written.glb')),probe))
 except ProbeFinished:pass
 else:raise AssertionError('Private carrier probe did not run')
 assert owner.data==original_data and owner.material_slots[0].material==original_material and len(source_root.inputs['Base Color'].links)==source_links
 saved_alpha=source_root.inputs['Alpha'].default_value;source_root.inputs['Alpha'].default_value=.5
 try:
  negative=timed('fractional-alpha-negative',lambda:compiler.plan_materials([owner],purpose='final',automatic_programs=True));assert negative.errors and 'Alpha1' in compiler.format_plan_errors(negative)
 finally:source_root.inputs['Alpha'].default_value=saved_alpha
 box=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeTexImage' and node.projection=='BOX');saved_blend=box.projection_blend;box.projection_blend=.1
 try:
  negative=timed('unsupported-blend-negative',lambda:compiler.plan_materials([owner],purpose='final',automatic_programs=True));assert negative.errors,'Unsupported BOX blend silently fell back'
 finally:box.projection_blend=saved_blend
 rows.append({'id':fixture['id'],'sourceSha256':timed('source-hash-after',lambda:sha(source)),'alpha':alpha['tslIr']['output'],'requiredPrograms':sorted(needs['requiresNodeRendererPrograms']),'privateCarrierNeutralizedOnlyOwnedCopy':True,'sourceBindingsRestoredAfterFailure':True,'fractionalAlphaRefused':True,'unsupportedBlendRefused':True})
 assert rows[-1]['sourceSha256']==fixture['sourceSha256']
verify_denials();assert calls=={'gpu':0,'render':0,'bake':0}
(out/('source-policy-'+selected+'.json')).write_text(json.dumps({'status':'PASSED_SINGLE_SAVED_COLOR_SOURCE_POLICY_NO_GPU','selectedCase':selected,'supportCredit':0,'calls':calls,'guards':guards,'timings':timings,'rows':rows,'scriptSha256':sha(__file__)},indent=2)+'\n')
print('SCENETOWEB_POLICY_CASE_COMPLETE '+selected,flush=True)
