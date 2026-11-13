# SPDX-License-Identifier: GPL-3.0-or-later
"""A shared output root must not authorize an unproved EEVEE→Cycles capture."""
import sys
from pathlib import Path
from unittest.mock import patch
import bpy

sys.path.insert(0, str(Path(__file__).parent))
from material_tsl_ir_check import compiler, base_material, quad_object

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
eevee = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
scene.render.engine = eevee
obj = quad_object("Engine fallback receiver", scene.collection)
material, tree, root = base_material("Engine-sensitive automatic fallback")
obj.data.materials.append(material)
blackbody = tree.nodes.new("ShaderNodeBlackbody")
blackbody.inputs[0].default_value = 2000
tree.links.new(blackbody.outputs[0], root.inputs["Base Color"])
before = (len(tree.nodes), len(tree.links), tuple(material.keys()), scene.render.engine)
with patch.object(compiler, "TSL_IR_BYTE_BUDGET", 256):
    plan = compiler.plan_materials([obj], purpose="preview", automatic_programs=True)
    decision = plan.decisions[0]
    assert decision.outcome == "blocked", decision.as_dict()
    assert any(issue.code == "material.automatic-fallback-engine-unproven" for issue in decision.issues), decision.as_dict()
    assert not any(item.get("route") == "bake" and item["channel"] == "Base Color" for item in decision.channel_plan["channels"]), decision.as_dict()
    assert any("ShaderNodeBlackbody" in issue.problem for issue in decision.issues), decision.as_dict()
    # ALL+Cycles already evaluates the original nodes with the eventual bake
    # engine, so a size-only refusal remains eligible for static fallback.
    scene.render.engine = "CYCLES"
    same = compiler.plan_materials([obj], purpose="preview", automatic_programs=True).decisions[0]
    assert same.outcome != "blocked", same.as_dict()
    assert any(item.get("route") == "bake" and item["channel"] == "Base Color" for item in same.channel_plan["channels"]), same.as_dict()
    scene.render.engine = eevee
    # An explicit artist-selected Material bake retains its documented Cycles
    # intent; this gate applies only to automatic fallback from live programs.
    compiler.set_material_bake(material, True)
    explicit = compiler.plan_materials([obj], purpose="preview", automatic_programs=True).decisions[0]
    assert not any(issue.code == "material.automatic-fallback-engine-unproven" for issue in explicit.issues), explicit.as_dict()
    compiler.set_material_bake(material, False)
assert before == (len(tree.nodes), len(tree.links), tuple(material.keys()), scene.render.engine), "Fallback inspection mutated source state"

# The per-channel walk must not block a different channel merely because a
# translated Base Color contains an engine-sensitive node.
math = tree.nodes.new("ShaderNodeMath"); math.operation = "MULTIPLY"
tree.links.new(math.outputs[0], root.inputs["Roughness"])
assert compiler._automatic_channel_bake_refusal(tree, root, "Roughness") is None
assert "ShaderNodeBlackbody" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color")
tree.links.remove(root.inputs["Base Color"].links[0])
image = tree.nodes.new("ShaderNodeTexImage"); image.interpolation = "Closest"
tree.links.new(image.outputs["Color"], root.inputs["Base Color"])
assert "ShaderNodeTexImage" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color"), "Shared ALL output does not prove native Cycles/EEVEE image-boundary equivalence"
scene.render.engine = "CYCLES"
assert compiler._automatic_channel_bake_refusal(tree, root, "Base Color") is None
scene.render.engine = eevee
tree.links.remove(root.inputs["Base Color"].links[0])
transform = tree.nodes.new("ShaderNodeVectorTransform"); transform.vector_type = "NORMAL"
tree.links.new(transform.outputs[0], root.inputs["Base Color"])
assert "ShaderNodeVectorTransform" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color"), "Camera/identity normal EEVEE evaluation must not silently switch to Cycles"
tree.links.remove(root.inputs["Base Color"].links[0])
noise = tree.nodes.new("ShaderNodeTexNoise")
tree.links.new(noise.outputs["Color"], root.inputs["Base Color"])
for noise_type in ("FBM", "MULTIFRACTAL", "HETERO_TERRAIN", "HYBRID_MULTIFRACTAL", "RIDGED_MULTIFRACTAL"):
    noise.noise_type = noise_type
    assert "ShaderNodeTexNoise" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color"), "Shared ALL output does not prove noise CPU/GPU seed or evaluator equivalence"
scene.render.engine = "CYCLES"
assert compiler._automatic_channel_bake_refusal(tree, root, "Base Color") is None
scene.render.engine = eevee
# Group walls do not hide a native engine difference from the guard.
tree.links.remove(root.inputs["Base Color"].links[0])
group = bpy.data.node_groups.new("Nested engine difference", "ShaderNodeTree")
group.interface.new_socket(name="Color", in_out="OUTPUT", socket_type="NodeSocketColor")
inner = group.nodes.new("ShaderNodeBlackbody"); output = group.nodes.new("NodeGroupOutput")
group.links.new(inner.outputs[0], output.inputs[0])
instance = tree.nodes.new("ShaderNodeGroup"); instance.node_tree = group
tree.links.new(instance.outputs[0], root.inputs["Base Color"])
assert "ShaderNodeBlackbody" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color")
# Actual native 4.2/5.2/5.3 EEVEE returns Strength for every Light Falloff
# output. Cycles Linear/Constant depend on ray distance, and Smooth changes
# even Quadratic. An ALL output is not an equivalent channel bake.
tree.links.remove(root.inputs["Base Color"].links[0])
falloff = tree.nodes.new("ShaderNodeLightFalloff")
falloff.inputs["Strength"].default_value = 2
falloff.inputs["Smooth"].default_value = 1
for socket in falloff.outputs:
    tree.links.new(socket, root.inputs["Base Color"])
    before = (len(tree.nodes), len(tree.links), tuple(material.keys()), scene.render.engine)
    assert "ShaderNodeLightFalloff" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color")
    assert compiler._automatic_channel_bake_refusal(tree, root, "Roughness") is None
    decision = compiler.plan_materials([obj], purpose="preview", automatic_programs=True).decisions[0]
    assert any(issue.code == "material.automatic-fallback-engine-unproven" for issue in decision.issues), decision.as_dict()
    assert not any(item.get("route") == "bake" and item["channel"] == "Base Color" for item in decision.channel_plan["channels"]), decision.as_dict()
    assert before == (len(tree.nodes), len(tree.links), tuple(material.keys()), scene.render.engine)
scene.render.engine = "CYCLES"
assert compiler._automatic_channel_bake_refusal(tree, root, "Base Color") is None
scene.render.engine = eevee
tree.links.remove(root.inputs["Base Color"].links[0])
inner_falloff = group.nodes.new("ShaderNodeLightFalloff")
group.links.new(inner_falloff.outputs["Linear"], output.inputs[0])
tree.links.new(instance.outputs[0], root.inputs["Base Color"])
assert "ShaderNodeLightFalloff" in compiler._automatic_channel_bake_refusal(tree, root, "Base Color")
print("BLENDLINK_AUTOMATIC_ENGINE_FALLBACK_PASSED " + bpy.app.version_string)
