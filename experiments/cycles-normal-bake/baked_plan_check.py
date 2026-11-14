"""No-render admission regression on an owned original Cube wood binding."""
from pathlib import Path
import hashlib,json,sys
import bpy
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler
import export_scene
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash=='a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e'
obj=bpy.data.objects['Beam2']
for item in bpy.context.scene.objects:
    if item.type=='MESH':item.hide_render=item!=obj
    item.select_set(item==obj)
bpy.context.view_layer.objects.active=obj
obj['blendlink_dynamic']=False
material=obj.material_slots[0].material
before=(obj.data.as_pointer(),material.as_pointer(),tuple((m.as_pointer(),m.name,m.show_viewport,m.show_render)for m in obj.modifiers),len(bpy.data.meshes),len(bpy.data.materials),len(bpy.data.node_groups))
def state():return(obj.data.as_pointer(),obj.material_slots[0].material.as_pointer(),tuple((m.as_pointer(),m.name,m.show_viewport,m.show_render)for m in obj.modifiers),len(bpy.data.meshes),len(bpy.data.materials),len(bpy.data.node_groups))
def plan(output='lighting',mode='baked'):
    return export_scene.plan_export_materials({'mode':mode,'bake':{'atlases':{'main':{'size':128,'bakeOutput':output}}}}, {'diagnostics':{}},{'use_selection':True})[0]
def static_normal(result):return any((d.channel_plan or{}).get('evaluatedStaticNormal')for d in result.lowerings)
# Establish that the actual source graph can use the new automatic receiver.
assert static_normal(plan(mode='procedural'))
rows=[]
for explicit in (False,True):
    compiler.set_material_bake(material,explicit)
    for output in ('lighting','appearance'):
        if output=='appearance'and not explicit:
            assert not plan(output).lowerings
            rows.append('unmarked appearance owner excluded')
            continue
        try:result=plan(output)
        except SystemExit as error:
            if output=='lighting':assert 'material.normal-bake-lighting-atlas-unproven'in str(error),str(error)
            else:assert 'compiled carrier could never ship'in str(error),str(error)
        else:raise AssertionError('Unqualified baked normal receiver admitted: '+str((explicit,output,static_normal(result))))
        rows.append(('explicit'if explicit else'automatic')+' '+output+' refused before mutation')
    obj['blendlink_dynamic']=True
    assert static_normal(plan()),'Realtime survivor must retain the qualified normal route'
    obj['blendlink_dynamic']=False
    rows.append(('explicit'if explicit else'automatic')+' realtime survivor admitted')
compiler.set_material_bake(material,False)
assert before==state(),'Planning changed native geometry/material/modifier ownership'
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('PASSED_CYCLES_NORMAL_BAKED_PLAN '+json.dumps({'liveNodeCredit':0,'renderCalls':0,'bakeCalls':0,'sourcePreserved':True,'nativeStatePreserved':True,'cases':rows}))
