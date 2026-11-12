# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_BUMP_HEIGHT_PASSED
"""Affine Height admission is tied to real source UVs, surface and controls."""
from pathlib import Path
import importlib.util
import sys
import bpy
import os
root=Path(os.environ.get('BLENDLINK_BUMP_HEIGHT_ADDON_ROOT',Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(root));sys.path.insert(0,str(root.parent/'blendlink/blender'))
import material_compiler as compiler
import tsl_ir
import bump_height_ir as height_ir
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Bounded Height surface');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update()
uv=mesh.uv_layers.new(name='Actual Height UV')
for loop,point in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=point
owner=bpy.data.objects.new('Bounded Height owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Bounded Height material');material.use_nodes=True;mesh.materials.append(material);compiler.set_tsl_ir(material,True)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
bump=tree.nodes.new('ShaderNodeBump');coordinates=tree.nodes.new('ShaderNodeTexCoord');separate=tree.nodes.new('ShaderNodeSeparateXYZ')
tree.links.new(coordinates.outputs['UV'],separate.inputs[0])
scale=tree.nodes.new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=.001
tree.links.new(separate.outputs['X'],scale.inputs[0]);tree.links.new(scale.outputs[0],bump.inputs['Height']);bump.inputs['Distance'].default_value=1
tree.links.new(bump.outputs[0],bsdf.inputs['Normal'])
def plan():
    before=source();result=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
    assert source()==before,'Height inspection changed authored nodes or controls'
    return result
def source():return sorted((node.name,[(socket.identifier,tuple(socket.default_value) if hasattr(socket.default_value,'__iter__') else socket.default_value) for socket in node.inputs if hasattr(socket,'default_value')]) for node in tree.nodes),sorted((link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in tree.links)
before=source()
qualified_profile=bpy.context.preferences.system.gpu_backend=='METAL' and tuple(bpy.app.version[:2]) in {(4,2),(5,2),(5,3)}
if not qualified_profile:
    result=plan();assert result.errors and 'measured Blender' in str(result.as_dict()),result.as_dict()
else:
    result=plan();assert not result.errors,result.as_dict()
    compiler.set_tsl_ir(material,False);automatic=plan()
    assert not automatic.errors and 'bump_height_native' in str(automatic.decisions[0].channel_plan),automatic.as_dict()
    compiler.set_tsl_ir(material,True)
    expression=tsl_ir.emit_output(bump,bump.outputs[0]);assert expression['op']=='bump_height_native' and expression['distance']==1,expression
    # The legacy Distance1 domain is earned by amplitude, not a hardcoded modern default.
    scale.inputs[1].default_value=1;result=plan();assert result.errors and 'effective world slope' in str(result.as_dict()),result.as_dict()
    scale.inputs[1].default_value=.001
    bump.inputs['Distance'].default_value=1000;result=plan();assert result.errors and 'Distance within' in str(result.as_dict()),result.as_dict()
    bump.inputs['Distance'].default_value=1
    if bump.inputs.get('Filter Width'):
        previous=bump.inputs['Filter Width'].default_value;bump.inputs['Filter Width'].default_value=.001
        result=plan();assert result.errors and 'Filter Width' in str(result.as_dict()),result.as_dict()
        bump.inputs['Filter Width'].default_value=previous
    uv.data[0].uv.x=3;result=plan();assert result.errors and 'UVs exceed' in str(result.as_dict()),result.as_dict()
    uv.data[0].uv.x=0
    # Repeated analysis and real property edits never reuse a stale owner proof.
    assert not plan().errors
    bend=tree.nodes.new('ShaderNodeMath');bend.operation='SINE';tree.links.new(scale.outputs[0],bend.inputs[0]);tree.links.new(bend.outputs[0],bump.inputs['Height'])
    result=plan();assert result.errors and 'affine UV' in str(result.as_dict()),result.as_dict()
    tree.links.new(scale.outputs[0],bump.inputs['Height']);tree.nodes.remove(bend)
    assert source()==before,'Height inspection changed authored nodes or controls'
    # A copied extension package must resolve its sibling helper without sys.path tricks.
    package='blendlink_bump_height_check';spec=importlib.util.spec_from_file_location(package,root/'__init__.py',submodule_search_locations=[str(root)])
    addon=importlib.util.module_from_spec(spec);sys.modules[package]=addon;spec.loader.exec_module(addon)
    result=addon.material_compiler.plan_materials([owner],purpose='final',automatic_programs=True)
    assert not result.errors,result.as_dict()
assert source()==before
print('BLENDLINK_BUMP_HEIGHT_PASSED '+bpy.app.version_string+' profile='+str(qualified_profile))
