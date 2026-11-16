# SPDX-License-Identifier: GPL-3.0-or-later
"""CPU policy census for the saved original-BSDF color fixtures."""
import hashlib,json,sys
from pathlib import Path
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler,tsl_ir
out=Path(sys.argv[sys.argv.index('--')+1]).resolve();fixtures=json.loads((out/'fixtures.json').read_text());calls={'gpu':0,'render':0}
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('Color policy must not initialize GPU')
def deny_render(*a,**k):calls['render']+=1;raise RuntimeError('Color policy must not render')
gpu.init=deny_gpu;bpy.ops.render.render=deny_render
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();rows=[];refusals=[]
for fixture in fixtures['cases']:
 source=Path(fixture['sourceFile']);assert sha(source)==fixture['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(source));owner=bpy.context.scene.objects['Owned BOX source geometry'];material=owner.data.materials[0];tree=material.node_tree
 assert not tree.nodes['Principled BSDF'].inputs['Normal'].is_linked and tree.nodes['Principled BSDF'].inputs['Base Color'].is_linked
 plan=compiler.plan_materials([owner],purpose='final',automatic_programs=True);assert not plan.errors,compiler.format_plan_errors(plan)
 entries=[item for d in plan.lowerings for item in d.channel_plan['channels']];color=next(e for e in entries if e['channel']=='Base Color');alpha=next(e for e in entries if e['channel']=='Alpha')
 assert color.get('tslIr') and alpha.get('tslIr') and alpha['tslIr']['output']=={'op':'const_float','value':1.0}
 needs={'uvMaps':set(),'colorLayers':set(),'objectAttributes':set(),'objectInfo':set(),'geometryContext':set(),'tangentFrames':set(),'requiresNodeRendererPrograms':set(),'usesActiveUv':False,'usesGenerated':False,'objectSpace':False}
 # Reuse the production owner runtime-extras builder rather than an asserted marker.
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
 try:compiler.with_compiled_materials(plan,str(out/(fixture['id']+'-never-written.glb')),probe)
 except ProbeFinished:pass
 else:raise AssertionError('Private carrier probe did not run')
 assert owner.data==original_data and owner.material_slots[0].material==original_material and len(source_root.inputs['Base Color'].links)==source_links
 saved_alpha=source_root.inputs['Alpha'].default_value;source_root.inputs['Alpha'].default_value=.5
 try:
  negative=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
  assert negative.errors and 'Alpha1' in compiler.format_plan_errors(negative)
 finally:source_root.inputs['Alpha'].default_value=saved_alpha
 box=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeTexImage' and node.projection=='BOX');saved_blend=box.projection_blend;box.projection_blend=.1
 try:
  negative=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
  assert negative.errors,('Unsupported BOX blend silently fell back',[(d.route,d.status,d.channel_plan) for d in negative.lowerings])
 finally:box.projection_blend=saved_blend
 rows.append({'id':fixture['id'],'sourceSha256':sha(source),'alpha':alpha['tslIr']['output'],'requiredPrograms':sorted(needs['requiresNodeRendererPrograms']),'privateCarrierNeutralizedOnlyOwnedCopy':True,'sourceBindingsRestoredAfterFailure':True,'fractionalAlphaRefused':True,'unsupportedBlendRefused':True})
 assert sha(source)==fixture['sourceSha256']
assert calls=={'gpu':0,'render':0}
(out/'source-policy.json').write_text(json.dumps({'status':'PASSED_SAVED_COLOR_SOURCE_POLICY_NO_GPU','supportCredit':0,'calls':calls,'rows':rows,'scriptSha256':sha(__file__)},indent=2)+'\n')
