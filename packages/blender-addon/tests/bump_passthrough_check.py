# SPDX-License-Identifier: GPL-3.0-or-later
"""No-height Bump copies data; a linked Height never silently becomes identity."""
from pathlib import Path
import sys
import os
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import material_compiler as compiler
import tsl_ir

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('No-height triangle');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
owner=bpy.data.objects.new('No-height owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('No-height material');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
bump=tree.nodes.new('ShaderNodeBump');compiler.set_tsl_ir(material,True)
def emit():return tsl_ir.emit_output(bump,bump.outputs[0])
def plan():return compiler.plan_materials([owner],purpose='final',automatic_programs=True)
base=emit();assert base['op']=='bump_passthrough_native' and base['input']['output']=='normal',base
# Native skips all inactive controls when Height is unlinked, even if they
# would have required an unavailable input function on a real height path.
unsupported=tree.nodes.new('ShaderNodeTexEnvironment')
for name in ['Strength','Distance']:
    tree.links.new(unsupported.outputs[0],bump.inputs[name])
bump.invert=True;bump.inputs['Height'].default_value=-123
assert emit()==base
for channel in ['Normal','Coat Normal']:
    bsdf.inputs['Coat Weight'].default_value=1
    tree.links.new(bump.outputs[0],bsdf.inputs[channel]);result=plan()
    assert not result.errors,result.as_dict()
    entry=next(item for item in result.decisions[0].channel_plan['channels'] if item['channel']==channel)
    assert entry['tslIr']['output']['op']=='normal_view_native',entry
    tree.links.remove(bsdf.inputs[channel].links[0])
vector=tree.nodes.new('ShaderNodeCombineXYZ')
for values in [(0,0,0),(.2,-.7,3)]:
    for socket,value in zip(vector.inputs,values):socket.default_value=value
    tree.links.new(vector.outputs[0],bump.inputs['Normal'])
    field=emit();assert field['input']['op']=='combine',field
    assert [field['input'][key]['value'] for key in ['x','y','z']]==[socket.default_value for socket in vector.inputs],field
    tree.links.new(bump.outputs[0],bsdf.inputs['Base Color']);assert not plan().errors
    tree.links.remove(bsdf.inputs['Base Color'].links[0])
    tree.links.new(bump.outputs[0],bsdf.inputs['Normal']);result=plan()
    assert result.errors and any('unit-normal' in issue.problem for issue in result.errors),result.as_dict()
    tree.links.remove(bsdf.inputs['Normal'].links[0])
tree.links.remove(bump.inputs['Normal'].links[0])
normal=tree.nodes.new('ShaderNodeNewGeometry');tree.links.new(normal.outputs['Normal'],bump.inputs['Normal'])
tree.links.new(bump.outputs[0],bsdf.inputs['Normal']);assert not plan().errors
# Even a linked constant height follows Blender's derivative path.
height=tree.nodes.new('ShaderNodeValue');height.outputs[0].default_value=0
tree.links.new(height.outputs[0],bump.inputs['Height']);result=plan()
assert result.errors and 'unlinked Strength' in str(result.as_dict()),result.as_dict()
# Source inspection never removes links or rewrites source input data.
assert bump.inputs['Height'].links[0].from_node==height and bump.invert
assert bump.inputs['Height'].default_value==-123
# Installed extensions import siblings through a package namespace; the real
# Final export above uses the standalone-module route. Exercise both seams.
tree.links.remove(bump.inputs['Height'].links[0])
import importlib.util
package='blendlink_bump_passthrough_check'
root=Path(os.environ.get('BLENDLINK_BUMP_ADDON_ROOT',Path(__file__).resolve().parents[1]))
spec=importlib.util.spec_from_file_location(package,root/'__init__.py',submodule_search_locations=[str(root)])
addon=importlib.util.module_from_spec(spec);sys.modules[package]=addon;spec.loader.exec_module(addon)
qualified=addon.material_compiler.plan_materials([owner],purpose='final',automatic_programs=True)
assert not qualified.errors,qualified.as_dict()
assert 'bump_passthrough_native' in str(qualified.decisions[0].channel_plan),qualified.as_dict()
print('BLENDLINK_BUMP_PASSTHROUGH_PASSED '+bpy.app.version_string)
