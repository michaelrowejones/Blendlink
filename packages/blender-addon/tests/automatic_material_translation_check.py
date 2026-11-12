# SPDX-License-Identifier: GPL-3.0-or-later
"""Automatic EEVEE programs and static channel fallback, including real export."""

import sys
import tempfile
from unittest.mock import patch
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).parent))
from material_tsl_ir_check import (
    compiler,
    base_material,
    quad_object,
    emit_selected,
    read_glb_json,
)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    obj = quad_object("Automatic receiver", bpy.context.scene.collection)
    material, tree, root = base_material("Automatic hybrid")
    obj.data.materials.append(material)
    root.inputs["Coat Weight"].default_value = 0.3
    root.inputs["Specular IOR Level"].default_value = 0.27
    assert (
        compiler.plan_materials([obj], automatic_programs=True).decisions[0].intent
        == "automatic"
    )
    brick = tree.nodes.new("ShaderNodeTexBrick")
    uv = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(uv.outputs["UV"], brick.inputs["Vector"])
    tree.links.new(brick.outputs["Color"], root.inputs["Base Color"])
    math = tree.nodes.new("ShaderNodeMath")
    math.operation = "MULTIPLY"
    math.inputs[0].default_value = 0.7
    math.inputs[1].default_value = 0.8
    tree.links.new(math.outputs[0], root.inputs["Roughness"])
    before = (len(tree.nodes), len(tree.links), tuple(material.keys()))
    plan = compiler.plan_materials([obj], purpose="preview", automatic_programs=True)
    decision = plan.decisions[0]
    assert decision.outcome == "lowered", decision.as_dict()
    channels = {entry["channel"]: entry for entry in decision.channel_plan["channels"]}
    assert channels["Base Color"]["route"] == "bake", channels
    assert channels["Roughness"]["route"] == "program", channels
    assert channels["Roughness"]["tslIrHash"], channels
    assert not plan.errors, plan.errors
    assert (len(tree.nodes), len(tree.links), tuple(material.keys())) == before
    old_fingerprint = plan.source_fingerprint
    math.inputs[0].default_value = 0.4
    assert (
        compiler.plan_materials(
            [obj], purpose="preview", automatic_programs=True
        ).source_fingerprint
        != old_fingerprint
    )
    math.inputs[0].default_value = 0.7
    material["blendlink_live_translation"] = False
    assert (
        compiler.plan_materials([obj], automatic_programs=True).decisions[0].intent
        == "automatic"
    )
    del material["blendlink_live_translation"]
    # An EEVEE-only root must never be sent to the Cycles field baker.
    original_output = next(
        node for node in tree.nodes if node.type == "OUTPUT_MATERIAL"
    )
    original_output.target = "EEVEE"
    cycles_output = tree.nodes.new("ShaderNodeOutputMaterial")
    cycles_output.target = "CYCLES"
    cycles_root = tree.nodes.new("ShaderNodeBsdfPrincipled")
    tree.links.new(cycles_root.outputs[0], cycles_output.inputs["Surface"])
    separate = compiler.plan_materials([obj], automatic_programs=True).decisions[0]
    assert not any(
        item.get("route") == "bake" for item in separate.channel_plan["channels"]
    )
    tree.nodes.remove(cycles_output)
    tree.nodes.remove(cycles_root)
    original_output.target = "ALL"
    # Neither a live program nor a static fallback may freeze keyed inputs.
    math.inputs[0].keyframe_insert(data_path="default_value", frame=1)
    animated = compiler.plan_materials([obj], automatic_programs=True).decisions[0]
    assert animated.outcome == "preserved", animated.as_dict()
    assert all(
        item.get("route") == "refused" for item in animated.channel_plan["channels"]
    )
    assert any(
        "animation" in item.get("tslIrRefusal", "")
        for item in animated.channel_plan["channels"]
    )
    tree.animation_data_clear()
    plan = compiler.plan_materials([obj], purpose="preview", automatic_programs=True)
    with tempfile.TemporaryDirectory(prefix="blendlink-automatic-") as directory:
        path = Path(directory) / "hybrid.glb"
        _value, compilation = compiler.with_compiled_materials(
            plan, str(path), emit_selected([obj])
        )
        assert path.is_file()
        document = read_glb_json(path)
        carrier = document["materials"][0]
        assert carrier["pbrMetallicRoughness"].get("baseColorTexture"), carrier
        assert (
            abs(
                carrier["extensions"]["KHR_materials_clearcoat"]["clearcoatFactor"]
                - 0.3
            )
            < 1e-6
        ), carrier
        print("AUTOMATIC_HYBRID_EXPORTED", compilation.generated_materials)
    assert obj.material_slots[0].material is material
    assert (len(tree.nodes), len(tree.links), tuple(material.keys())) == before
    print("BLENDLINK_AUTOMATIC_TRANSLATION_CHECK_PASSED")


if __name__ == "__main__":
    # A real channel-size limit continues to exercise automatic fallback as
    # node coverage grows. Brick itself is now a supported live program.
    with patch.object(compiler, "TSL_IR_BYTE_BUDGET", 512):
        main()
