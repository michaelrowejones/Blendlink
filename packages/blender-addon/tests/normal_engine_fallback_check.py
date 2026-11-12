# SPDX-License-Identifier: GPL-3.0-or-later
"""ALL-root identity does not certify engine-specific normal evaluation."""
from pathlib import Path
import sys
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'blendlink/blender'))
import engine_fallback
import material_compiler
import procedural

bpy.ops.wm.read_factory_settings(use_empty=True)
material=bpy.data.materials.new('Shared ALL normal graph');material.use_nodes=True
tree=material.node_tree;root=next(node for node in tree.nodes if node.type=='BSDF_PRINCIPLED')
output=next(node for node in tree.nodes if node.type=='OUTPUT_MATERIAL');assert output.target=='ALL'
fields=[('ShaderNodeNewGeometry','Normal'),('ShaderNodeNewGeometry','Tangent'),
        ('ShaderNodeTexCoord','Normal'),('ShaderNodeTexCoord','Reflection'),
        ('ShaderNodeNormalMap','Normal'),('ShaderNodeBump','Normal'),('ShaderNodeTangent','Tangent')]
for identifier,name in fields:
    node=tree.nodes.new(identifier);tree.links.new(node.outputs[name],root.inputs['Base Color'])
    refusal=engine_fallback.channel_engine_difference(root,'Base Color','EEVEE','CYCLES',procedural._walk_channel_upstream)
    assert refusal and identifier in refusal,(identifier,refusal)
    assert engine_fallback.channel_engine_difference(root,'Roughness','EEVEE','CYCLES',procedural._walk_channel_upstream) is None
    assert engine_fallback.channel_engine_difference(root,'Base Color','CYCLES','CYCLES',procedural._walk_channel_upstream) is None
    if identifier in {'ShaderNodeNewGeometry','ShaderNodeTexCoord'}:
        assert 'UV-bake ray context' in material_compiler._automatic_channel_bake_refusal(tree,root,'Base Color')
    tree.nodes.remove(node)
# A world-position field has a separate primary-ray capture guard, but is not
# falsely described as a different engine's normal evaluator.
node=tree.nodes.new('ShaderNodeNewGeometry');tree.links.new(node.outputs['Position'],root.inputs['Base Color'])
assert engine_fallback.channel_engine_difference(root,'Base Color','EEVEE','CYCLES',procedural._walk_channel_upstream) is None
assert 'UV-bake ray context' in material_compiler._automatic_channel_bake_refusal(tree,root,'Base Color')
print('BLENDLINK_NORMAL_ENGINE_FALLBACK_PASSED '+bpy.app.version_string)
