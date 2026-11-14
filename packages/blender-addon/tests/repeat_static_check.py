# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: SCENETOWEB_REPEAT_STATIC_POLICY_PASSED
import bpy,sys,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender'),str(ROOT/'experiments/shader-static-repeat')]
import tsl_ir,procedural
from cases import cases,build,build_case,unqualified_field_cases
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
material=bpy.data.materials.new('Repeat Policy');material.use_nodes=True;tree=material.node_tree
for row in cases():
 tree.nodes.clear();sink=tree.nodes.new('ShaderNodeBsdfPrincipled');signal=build_case(tree,row);tree.links.new(signal,sink.inputs['Base Color'])
 doc=tsl_ir.emit_channel(sink.inputs['Base Color'],evaluation_engine='EEVEE')
 encoded=json.dumps(doc)
 assert ('repeat_static'in encoded)==(row['iterations']>0),(row,doc)
# Unsupported inactive bodies are pruned at zero iterations; source stays intact.
tree.nodes.clear();sink=tree.nodes.new('ShaderNodeBsdfPrincipled');output,start,end=build(tree,{'kind':'scalar-step','iterations':0,'state':0});tree.links.new(output,sink.inputs['Base Color']);output_node=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(sink.outputs[0],output_node.inputs['Surface']);sky=tree.nodes.new('ShaderNodeTexSky');tree.links.new(sky.outputs[0],end.inputs[0]);assert tsl_ir.emit_channel(sink.inputs['Base Color'],evaluation_engine='EEVEE')['output']['op']=='const_float';assert sky not in procedural.reachable_surface_nodes(tree)
refusals=[]
for kind in ['iterations','float-count','body','animation','cycle']:
 tree.nodes.clear();tree.animation_data_clear();sink=tree.nodes.new('ShaderNodeBsdfPrincipled');output,start,end=build(tree,{'kind':'scalar-step','iterations':2,'state':0});tree.links.new(output,sink.inputs['Base Color'])
 if kind=='iterations':start.inputs['Iterations'].default_value=65
 if kind=='float-count':
  number=tree.nodes.new('ShaderNodeValue');number.outputs[0].default_value=2;tree.links.new(number.outputs[0],start.inputs['Iterations'])
 if kind=='body':next(n for n in tree.nodes if n.bl_idname=='ShaderNodeMath').operation='MULTIPLY'
 if kind=='animation':start.inputs['Iterations'].keyframe_insert(data_path='default_value',frame=1)
 if kind=='cycle':
  math=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeMath');tree.links.new(math.outputs[0],math.inputs[0])
 try:tsl_ir.emit_channel(sink.inputs['Base Color'],evaluation_engine='EEVEE')
 except (tsl_ir.TslIrRefusal,ValueError)as error:refusals.append({'kind':kind,'reason':str(error)})
 else:raise AssertionError(kind+' did not refuse')
# Retain the authored SNAP field fixtures as explicit refusals, not numerical coverage.
for name in ['scalar-field-2-0','vector-field-2-0','group-vector-field']:
 row=next(row for row in unqualified_field_cases()if row['case']==name)
 tree.nodes.clear();tree.animation_data_clear();sink=tree.nodes.new('ShaderNodeBsdfPrincipled');signal=build_case(tree,row);tree.links.new(signal,sink.inputs['Base Color'])
 try:tsl_ir.emit_channel(sink.inputs['Base Color'],evaluation_engine='EEVEE')
 except tsl_ir.TslIrRefusal as error:
  assert 'literal seeds'in str(error),(name,str(error));refusals.append({'kind':'group-vector-field'if row.get('group')else row['kind'],'reason':str(error)})
 else:raise AssertionError(name+' field seed did not refuse')
# Zero iterations forward the selected expression under its existing upstream contract.
for kind in ['scalar-field','vector-field']:
 tree.nodes.clear();sink=tree.nodes.new('ShaderNodeBsdfPrincipled');row={'kind':kind,'iterations':0,'state':0,'component':0};signal=build_case(tree,row);tree.links.new(signal,sink.inputs['Base Color'])
 encoded=json.dumps(tsl_ir.emit_channel(sink.inputs['Base Color'],evaluation_engine='EEVEE'));assert 'repeat_static'not in encoded and 'uv_active'in encoded
packet={'status':'PASSED_STATIC_REPEAT_POLICY','productionCases':len(cases()),'refusals':refusals,'zeroCountFieldForwardControls':2,'unqualifiedFieldResearchCases':len(unqualified_field_cases()),'privateNumericalCredit':0}
if os.environ.get('SCENETOWEB_REPEAT_REFERENCES'):
 path=Path(os.environ['SCENETOWEB_REPEAT_REFERENCES']);path.mkdir(parents=True,exist_ok=True);(path/'policy.json').write_text(json.dumps(packet,indent=2)+'\n')
print('SCENETOWEB_REPEAT_STATIC_POLICY_PASSED '+json.dumps(packet))
