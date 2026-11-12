# SPDX-License-Identifier: GPL-3.0-or-later
"""Authored live intent must not discard unsupported Bump normal channels."""
from pathlib import Path
import sys
import bpy

addon=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(addon));sys.path.insert(0,str(addon.parent/'blendlink/blender'))
import material_compiler as compiler

bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT' if bpy.app.version<(5,0) else 'BLENDER_EEVEE'
mesh=bpy.data.meshes.new('Required Bump surface');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.update()
owner=bpy.data.objects.new('Required Bump owner',mesh);scene.collection.objects.link(owner)
material=bpy.data.materials.new('Authored live Bump');material.use_nodes=True;mesh.materials.append(material)
tree=material.node_tree;bsdf=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
surface=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL')
bump=tree.nodes.new('ShaderNodeBump');height=tree.nodes.new('ShaderNodeValue');height.outputs[0].default_value=.3
tree.links.new(height.outputs[0],bump.inputs['Height']);compiler.set_tsl_ir(material,True)

def snapshot():
    records=[]
    for current in [tree]+[group for group in bpy.data.node_groups]:
        records.append((current.name,[(node.name,node.bl_idname) for node in current.nodes],
          [(link.from_node.name,link.from_socket.identifier,link.to_node.name,link.to_socket.identifier) for link in current.links],
          [(node.name,socket.identifier,tuple(socket.default_value) if hasattr(socket.default_value,'__iter__') else socket.default_value)
           for node in current.nodes for socket in node.inputs if hasattr(socket,'default_value')]))
    return records

def check(channel):
    before=snapshot();plan=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
    assert snapshot()==before,'Required-normal inspection changed the authored graph'
    assert plan.errors and plan.decisions[0].outcome=='blocked',plan.as_dict()
    assert any(issue.code=='material.normal-map-program-unproven' and 'Bump' in issue.problem and channel in issue.problem for issue in plan.errors),plan.as_dict()
    entry=next(entry for entry in plan.decisions[0].channel_plan['channels'] if entry['channel']==channel)
    assert entry['route']=='refused' and 'Bump' in entry['tslIrRefusal'],entry

for channel in ['Normal','Coat Normal']:
    bsdf.inputs['Coat Weight'].default_value=1 if channel=='Coat Normal' else 0
    tree.links.new(bump.outputs[0],bsdf.inputs[channel]);check(channel)
    tree.links.remove(bsdf.inputs[channel].links[0])
# An unused Bump must not block an otherwise supported marked material.
assert not compiler.plan_materials([owner],purpose='final',automatic_programs=True).errors

# Selected Principled roots can be enclosed in a group and receive the Bump
# from an outer Group Input. The real selected instance owns that resolution.
group=bpy.data.node_groups.new('Selected nested Principled','ShaderNodeTree')
group.interface.new_socket(name='Normal',in_out='INPUT',socket_type='NodeSocketVector')
group.interface.new_socket(name='Shader',in_out='OUTPUT',socket_type='NodeSocketShader')
input_node=group.nodes.new('NodeGroupInput');output_node=group.nodes.new('NodeGroupOutput')
nested=group.nodes.new('ShaderNodeBsdfPrincipled')
group.links.new(input_node.outputs['Normal'],nested.inputs['Normal']);group.links.new(nested.outputs[0],output_node.inputs['Shader'])
instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group
tree.links.new(instance.outputs['Shader'],surface.inputs['Surface']);tree.links.new(bump.outputs[0],instance.inputs['Normal'])
check('Normal')
# A surface fold has no per-leaf Normal channel. It must not lose the same
# reachable Bump merely because the selected root is a Mix Shader.
mix=tree.nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=.5
plain=tree.nodes.new('ShaderNodeBsdfPrincipled')
tree.links.new(instance.outputs[0],mix.inputs[1]);tree.links.new(plain.outputs[0],mix.inputs[2]);tree.links.new(mix.outputs[0],surface.inputs['Surface'])
def check_surface(required):
    before=snapshot();plan=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
    assert snapshot()==before
    assert plan.decisions[0].outcome=='blocked' and any(issue.code=='material.normal-map-program-unproven' and required in issue.problem for issue in plan.errors),plan.as_dict()
check_surface('ShaderNodeBump')
for identifier in ['ShaderNodeNormalMap','ShaderNodeTangent']:
    native=tree.nodes.new(identifier)
    if identifier=='ShaderNodeNormalMap':native.space='WORLD'
    tree.links.new(native.outputs['Normal' if identifier=='ShaderNodeNormalMap' else 'Tangent'],instance.inputs['Normal'])
    check_surface(identifier)
# A constant Mix endpoint leaves the other closure's normal response unused.
mix.inputs[0].default_value=1
assert not compiler.plan_materials([owner],purpose='final',automatic_programs=True).errors
mix.inputs[0].keyframe_insert('default_value',frame=1)
mix.inputs[0].default_value=0;mix.inputs[0].keyframe_insert('default_value',frame=2)
scene.frame_set(1);check_surface('ShaderNodeTangent')
tree.animation_data_clear()
mix.inputs[0].default_value=.5
group.links.remove(nested.inputs['Normal'].links[0])
direction=group.nodes.new('ShaderNodeCombineXYZ');direction.inputs['Z'].default_value=1
group.links.new(direction.outputs[0],nested.inputs['Normal']);check_surface('linked normal input')
group.links.remove(nested.inputs['Normal'].links[0])
group.links.new(input_node.outputs['Normal'],nested.inputs['Coat Normal']);nested.inputs['Coat Weight'].default_value=1
check_surface('ShaderNodeTangent')
nested.inputs['Coat Weight'].default_value=0
assert not compiler.plan_materials([owner],purpose='final',automatic_programs=True).errors
# Native normal functions used as projected colors remain ordinary supported
# color programs; the new rule targets the normals the surface fold omits.
color=tree.nodes.new('ShaderNodeNormalMap');color.space='WORLD';color.inputs['Color'].default_value=(.8,.6,.9,1)
tree.links.new(color.outputs[0],plain.inputs['Base Color'])
result=compiler.plan_materials([owner],purpose='final',automatic_programs=True)
assert not result.errors and result.decisions[0].outcome=='lowered',result.as_dict()
assert 'normal_map_native' in str(result.decisions[0].channel_plan),result.as_dict()
# The selected output owns the dependency set. An EEVEE-only Bump output
# must not poison this authored Cycles/ALL programme.
tree.links.new(plain.outputs[0],surface.inputs['Surface'])
other_output=tree.nodes.new('ShaderNodeOutputMaterial');other_output.target='EEVEE'
tree.links.new(bsdf.outputs[0],other_output.inputs['Surface']);tree.links.new(bump.outputs[0],bsdf.inputs['Normal'])
assert not compiler.plan_materials([owner],purpose='final',automatic_programs=True).errors
print('BLENDLINK_BUMP_REQUIRED_NORMAL_PASSED '+bpy.app.version_string)
