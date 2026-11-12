# SPDX-License-Identifier: GPL-3.0-or-later
"""Keep the actual nested normalized child and qualify only its source refusal."""
import ast
from pathlib import Path
import platform
import sys
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tsl_ir
path=Path(__file__).resolve().parents[3]/'experiments/noise-fractal-differential/reference.py'
function=next(node for node in ast.parse(path.read_text()).body if isinstance(node,ast.FunctionDef) and node.name=='source_qualified_roughness_refusal')
namespace={'sys':sys,'platform':platform}
exec(compile(ast.fix_missing_locations(ast.Module(body=[function],type_ignores=[])),str(path),'exec'),namespace)
qualifies=namespace['source_qualified_roughness_refusal']
case={'id':'cycles-varying-real-normalized-child','kind':'noise','roughnessStage':'constant-function'}
material=bpy.data.materials.new('Nested normalized Roughness qualification');material.use_nodes=True
tree=material.node_tree;tree.nodes.clear()
coordinates=tree.nodes.new('ShaderNodeCombineXYZ')
for socket,value in zip(coordinates.inputs,[.375,-.173,.625]):socket.default_value=value
child=tree.nodes.new('ShaderNodeTexNoise');child.normalize=True
child.inputs['Scale'].default_value=1;child.inputs['Detail'].default_value=0
tree.links.new(coordinates.outputs[0],child.inputs['Vector'])
clamp=tree.nodes.new('ShaderNodeClamp');tree.links.new(child.outputs['Fac'],clamp.inputs['Value'])
outer=tree.nodes.new('ShaderNodeTexNoise');outer.normalize=False
outer.inputs['Scale'].default_value=1;outer.inputs['Detail'].default_value=1
for source,target in [(coordinates.outputs[0],outer.inputs['Vector']),(clamp.outputs[0],outer.inputs['Roughness'])]:tree.links.new(source,target)
def state():
    return (len(tree.nodes),[(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links],child.normalize,outer.normalize,child.inputs['Scale'].default_value,child.inputs['Detail'].default_value)
original=state();saved_platform,saved_machine=sys.platform,platform.machine
try:
    try:
        sys.platform='linux';platform.machine=lambda:'x86_64'
        with tsl_ir.emission_context(evaluation_engine='CYCLES'):
            try:
                tsl_ir.emit_output(outer,outer.outputs['Fac'])
                raise AssertionError('Unmeasured Cycles child profile silently admitted')
            except tsl_ir.TslIrRefusal as error:reason=str(error)
        assert qualifies(case,'CYCLES',True,reason,None)
        for changes in [{'kind':'constant'},{'roughnessStage':'image'}]:
            assert not qualifies({**case,**changes},'CYCLES',True,reason,None)
        assert not qualifies(case,'EEVEE',True,reason,None)
        assert not qualifies(case,'CYCLES',False,reason,None)
        assert not qualifies(case,'CYCLES',True,reason,'cycles-neon-fma')
        assert not qualifies(case,'CYCLES',True,reason+' unrelated suffix',None)
        assert not qualifies(case,'CYCLES',True,'Noise linked Roughness needs a proven [0,1] input',None)
    finally:
        sys.platform,platform.machine=saved_platform,saved_machine
    with tsl_ir.emission_context(evaluation_engine='EEVEE'):
        expression=tsl_ir.emit_output(outer,outer.outputs['Fac'])
    assert expression['op']=='noise_varying' and expression['normalize'] is False
    assert expression['roughnessNode']['op']=='clamp_minmax'
    nested=expression['roughnessNode']['value']
    assert nested['op']=='noise_normalized' and nested['normalize'] is True
    assert original==state(), 'Qualification changed authored nodes, links or native values'
finally:
    bpy.data.materials.remove(material)
print('BLENDLINK_NOISE_VARYING_PROFILE_REFUSAL_PASSED exact Cycles qualification; authored Clamp and normalized child retained')
