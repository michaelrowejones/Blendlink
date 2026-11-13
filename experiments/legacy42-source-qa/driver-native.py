"""Diagnostic source driver modifiers and actual frame dependence."""
from pathlib import Path
import json,os,sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blender-addon'))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages/blendlink/blender'))
import procedural
bpy.ops.wm.read_factory_settings(use_empty=True)
obj=bpy.data.objects.new('Static driver',None);bpy.context.scene.collection.objects.link(obj)
obj['source']=.2;obj['target']=.2
curve=obj.driver_add('["target"]');var=curve.driver.variables.new();var.name='source';var.type='SINGLE_PROP';var.targets[0].id=obj;var.targets[0].data_path='["source"]';curve.driver.expression='source'
rows=[]
def sample(label):
    values=[]
    for frame in [0,1,17,10000]:
        bpy.context.scene.frame_set(frame);values.append(float(obj.evaluated_get(bpy.context.evaluated_depsgraph_get())['target']))
    rows.append({'label':label,'values':values,'timeDependent':procedural._time_dependent_local_geometry(obj),'modifiers':[{'type':m.type,'mute':m.mute,'coefficients':list(m.coefficients) if m.type=='GENERATOR' else None} for m in curve.modifiers]})
sample('native-default')
if not curve.modifiers:curve.modifiers.new('GENERATOR')
curve.modifiers[0].coefficients=(0,1);sample('explicit-identity-generator')
curve.modifiers[0].coefficients=(.125,2);sample('explicit-nonidentity-generator')
curve.driver.expression='frame';sample('frame-expression')
report={'nativeVersion':list(bpy.app.version),'buildHash':bpy.app.build_hash.decode(),'rows':rows}
Path(os.environ['BLENDLINK_QA_DRIVER_REFERENCE']).write_text(json.dumps(report,indent=2))
print('BLENDLINK_NATIVE_DRIVER_REFERENCE',json.dumps(report))
