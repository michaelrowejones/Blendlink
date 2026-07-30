# SPDX-License-Identifier: GPL-3.0-or-later
"""MTLX-TSL-001 production seam: per-channel TSL IR rides the channel plan.

The `blendlink_tsl_ir` opt-in attaches each channel's compiled IR document
to its plan record as ADDITIVE evidence: routes never change, unproven
graphs refuse with named reasons, the serialized size is budgeted, and the
IR body stays out of plan fingerprints (only its hash enters).

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/material_tsl_ir_check.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
CANONICAL_BLENDER_DIR = ADDON_DIR.parent / "blendlink" / "blender"
sys.path.insert(0, str(CANONICAL_BLENDER_DIR))
sys.path.insert(0, str(ADDON_DIR))


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


procedural = load_module(
    "blendlink_tsl_ir_check_procedural", ADDON_DIR / "procedural.py",
)
sys.modules["procedural"] = procedural
tsl_ir = load_module(
    "blendlink_tsl_ir_check_tsl_ir", ADDON_DIR / "tsl_ir.py",
)
sys.modules["tsl_ir"] = tsl_ir
compiler = load_module(
    "blendlink_tsl_ir_check_compiler", ADDON_DIR / "material_compiler.py",
)
import bakelib  # noqa: E402


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def quad_object(name, collection):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    layer = mesh.uv_layers.new(name="Authored UVs")
    corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for loop_index, corner in enumerate(corners):
        layer.data[loop_index].uv = corner
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def base_material(name):
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    principled = tree.nodes.get("Principled BSDF")
    return material, tree, principled


def channel_record(decision, name):
    return next(
        (
            item for item in (decision.channel_plan or {}).get("channels", ())
            if item["channel"] == name
        ),
        None,
    )


def emit_selected(objects):
    def emit(output_path):
        selected_before = list(bpy.context.selected_objects)
        active_before = bpy.context.view_layer.objects.active
        try:
            bpy.ops.object.select_all(action="DESELECT")
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            return bpy.ops.export_scene.gltf(
                filepath=output_path,
                export_format="GLB",
                export_extras=True,
                export_image_format="AUTO",
                export_texcoords=True,
                use_selection=True,
            )
        finally:
            bpy.ops.object.select_all(action="DESELECT")
            for item in selected_before:
                if bpy.context.scene.objects.get(item.name) is item:
                    item.select_set(True)
            bpy.context.view_layer.objects.active = active_before
    return emit


def read_glb_json(path):
    raw = Path(path).read_bytes()
    expect(raw[:4] == b"glTF", "GLB magic missing")
    length = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + length])


def decision_for(plan, material_name):
    for decision in plan.lowerings:
        if decision.material_name == material_name:
            return decision
    raise AssertionError(f"no decision for {material_name!r}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fixtures = bpy.data.collections.new("TSL IR Fixtures")
    bpy.context.scene.collection.children.link(fixtures)

    # --- Opted-in material: proven graph + constant channels -------------
    evidence_obj = quad_object("Evidence Target", fixtures)
    evidence_material, tree, principled = base_material("TSL Evidence")
    coord = tree.nodes.new("ShaderNodeTexCoord")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coord.outputs["UV"], separate.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    tree.links.new(separate.outputs["X"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], principled.inputs["Base Color"])
    principled.inputs["Roughness"].default_value = 0.7
    evidence_obj.data.materials.append(evidence_material)
    compiler.set_material_bake(evidence_material, True)
    compiler.set_tsl_ir(evidence_material, True)

    # --- Opted-in material with an unproven channel graph ----------------
    refused_obj = quad_object("Refused Target", fixtures)
    refused_obj.location = (3.0, 0.0, 0.0)
    refused_material, refused_tree, refused_principled = base_material(
        "TSL Refused",
    )
    refused_coord = refused_tree.nodes.new("ShaderNodeTexCoord")
    voronoi = refused_tree.nodes.new("ShaderNodeTexVoronoi")
    voronoi.feature = "F2"
    refused_tree.links.new(
        refused_coord.outputs["UV"], voronoi.inputs["Vector"],
    )
    refused_tree.links.new(
        voronoi.outputs["Distance"], refused_principled.inputs["Roughness"],
    )
    refused_obj.data.materials.append(refused_material)
    compiler.set_material_bake(refused_material, True)
    compiler.set_tsl_ir(refused_material, True)

    # --- Bake opt-in WITHOUT the IR opt-in: no tslIr keys at all ---------
    plain_obj = quad_object("Plain Target", fixtures)
    plain_obj.location = (6.0, 0.0, 0.0)
    plain_material, _plain_tree, plain_principled = base_material(
        "TSL Absent",
    )
    plain_principled.inputs["Metallic"].default_value = 1.0
    plain_obj.data.materials.append(plain_material)
    compiler.set_material_bake(plain_material, True)

    # --- IR opt-in WITHOUT the bake: the standalone tslProgram route -----
    solo_obj = quad_object("Solo Target", fixtures)
    solo_obj.location = (9.0, 0.0, 0.0)
    solo_material, solo_tree, solo_principled = base_material("TSL Solo")
    solo_coord = solo_tree.nodes.new("ShaderNodeTexCoord")
    solo_separate = solo_tree.nodes.new("ShaderNodeSeparateXYZ")
    solo_tree.links.new(
        solo_coord.outputs["UV"], solo_separate.inputs["Vector"],
    )
    solo_tree.links.new(
        solo_separate.outputs["Y"], solo_principled.inputs["Roughness"],
    )
    solo_obj.data.materials.append(solo_material)
    compiler.set_tsl_ir(solo_material, True)

    # --- IR opt-in without the bake, nothing provable --------------------
    stuck_obj = quad_object("Stuck Target", fixtures)
    stuck_obj.location = (12.0, 0.0, 0.0)
    stuck_material, stuck_tree, stuck_principled = base_material("TSL Stuck")
    stuck_coord = stuck_tree.nodes.new("ShaderNodeTexCoord")
    stuck_voronoi = stuck_tree.nodes.new("ShaderNodeTexVoronoi")
    stuck_voronoi.feature = "F2"
    stuck_tree.links.new(
        stuck_coord.outputs["UV"], stuck_voronoi.inputs["Vector"],
    )
    for channel in ("Base Color", "Roughness", "Metallic", "Alpha"):
        stuck_tree.links.new(
            stuck_voronoi.outputs["Distance"],
            stuck_principled.inputs[channel],
        )
    stuck_obj.data.materials.append(stuck_material)
    compiler.set_tsl_ir(stuck_material, True)

    plan = compiler.plan_materials(
        (evidence_obj, refused_obj, plain_obj, solo_obj, stuck_obj),
        purpose="inspect",
    )

    evidence = decision_for(plan, "TSL Evidence")
    base = channel_record(evidence, "Base Color")
    expect(base is not None, "Base Color record missing")
    expect(base.get("route") == "bake", "ramp Base Color should bake")
    document = base.get("tslIr")
    expect(document is not None, "baked channel is missing tslIr evidence")
    expect(
        document.get("schemaVersion") == 1
        and document.get("model") == "blendlink-tsl-ir-v1"
        and isinstance(document.get("output"), dict),
        "tslIr document shape is wrong",
    )
    encoded = json.dumps(document, sort_keys=True, separators=(",", ":"))
    expect(
        base.get("tslIrHash")
        == hashlib.sha256(encoded.encode("utf8")).hexdigest(),
        "tslIrHash does not match the canonical serialization",
    )
    expect(
        base.get("tslIrBytes") == len(encoded),
        "tslIrBytes does not match the canonical serialization",
    )

    roughness = channel_record(evidence, "Roughness")
    expect(
        roughness is not None and roughness.get("route") == "factor",
        "constant Roughness should stay a factor",
    )
    expect(
        roughness.get("tslIr", {}).get("output", {}).get("op")
        == "const_float",
        "factor channels carry constant IR evidence too",
    )

    emission = channel_record(evidence, "Emission")
    expect(
        emission is not None
        and "merged Emission record" in emission.get("tslIrRefusal", ""),
        "merged Emission record must refuse IR by name",
    )

    refused = decision_for(plan, "TSL Refused")
    refused_roughness = channel_record(refused, "Roughness")
    expect(
        refused_roughness is not None
        and refused_roughness.get("tslIr") is None
        and refused_roughness.get("tslIrRefusal"),
        "unproven graphs must attach a named tslIrRefusal",
    )

    # --- Fingerprint honesty: hash in, body out --------------------------
    fingerprint = json.dumps(
        evidence.fingerprint_dict(), sort_keys=True, separators=(",", ":"),
    )
    expect(
        '"tslIr":' not in fingerprint,
        "the IR body must not enter plan fingerprints",
    )
    expect(
        '"tslIrHash":' in fingerprint,
        "the IR hash must pin content inside plan fingerprints",
    )
    # The record itself keeps the body (the sidecar carries it onward).
    expect(base.get("tslIr") is not None, "as-dict record lost the IR body")

    absent = decision_for(plan, "TSL Absent")
    absent_json = json.dumps(absent.channel_plan)
    expect(
        "tslIr" not in absent_json,
        "materials without the opt-in must carry no tslIr keys",
    )

    # --- The standalone route: IR without the bake is a real decision ----
    solo = decision_for(plan, "TSL Solo")
    expect(
        solo.intent == "tslProgram" and solo.outcome == "lowered"
        and solo.transport == "program",
        "IR without the bake must plan as a lowered tslProgram decision, "
        f"got {solo.intent}/{solo.outcome}/{solo.transport}",
    )
    solo_roughness = channel_record(solo, "Roughness")
    expect(
        solo_roughness is not None
        and solo_roughness.get("route") == "program"
        and solo_roughness.get("tslIr") is not None,
        "the solo route must carry program IR on its proven channel",
    )
    solo_base = channel_record(solo, "Base Color")
    expect(
        solo_base is not None and solo_base.get("route") == "program"
        and solo_base.get("tslIr", {}).get("output", {}).get("op")
        == "const_vec3",
        "constant channels ride the program route as constant IR",
    )
    expect(
        (solo.channel_plan or {}).get("model") == "tsl-program-plan-v1",
        "the solo route must carry its own plan model",
    )
    solo_fingerprint = json.dumps(
        solo.fingerprint_dict(), sort_keys=True, separators=(",", ":"),
    )
    expect(
        '"tslIr":' not in solo_fingerprint
        and '"tslIrHash":' in solo_fingerprint,
        "tslProgram fingerprints must strip bodies and keep hashes",
    )

    # Preserved decisions never enter plan.lowerings (that is the point:
    # an unproven program must not publish or install anything), so the
    # Stuck lookup goes through the full decision list.
    stuck = next(
        decision for decision in plan.decisions
        if decision.material_name == "TSL Stuck"
    )
    expect(
        stuck.intent == "tslProgram" and stuck.outcome == "preserved"
        and stuck.transport == "stock",
        "an unproven tslProgram must stay preserved (never block the "
        f"export), got {stuck.intent}/{stuck.outcome}/{stuck.transport}",
    )
    expect(
        any(
            issue.code == "material.tsl-program-unproven"
            for issue in stuck.issues
        ),
        "the unproven solo route must name its refusal",
    )
    stuck_channels = (stuck.channel_plan or {}).get("channels", ())
    expect(
        stuck_channels
        and all(entry.get("route") == "refused" for entry in stuck_channels)
        and all(entry.get("tslIrRefusal") for entry in stuck_channels),
        "every unproven channel must carry a named tslIrRefusal",
    )

    # --- The solo route through the REAL compile transaction -------------
    # Plan-level truth is above; this proves the carrier: one generated
    # passthrough copy per material carrying the runtime identity extras,
    # the artist material not shipped, the attestation accepting a stock
    # carrier whose PBR derivation it records instead of asserting, and
    # the slot restored afterwards.
    solo_plan = compiler.plan_materials((solo_obj,), purpose="final")
    expect(not solo_plan.errors, f"solo plan blocked: {solo_plan.errors}")
    original_slot_material = solo_obj.material_slots[0].material
    with tempfile.TemporaryDirectory(prefix="blendlink-tsl-solo-") as directory:
        out_path = Path(directory) / "tsl-solo.glb"
        _value, compilation = compiler.with_compiled_materials(
            solo_plan, str(out_path), emit_selected([solo_obj]),
        )
        expect(out_path.is_file(), "tsl solo compile emitted no GLB")
        expect(
            len(compilation.generated_materials) == 1,
            f"one solo material must generate one carrier: "
            f"{compilation.generated_materials}",
        )
        document = read_glb_json(out_path)
        shipped_names = [
            material.get("name")
            for material in document.get("materials", ())
        ]
        expect(
            "TSL Solo" not in shipped_names,
            f"the artist material must not ship beside its carrier: "
            f"{shipped_names}",
        )
        carriers = [
            material for material in document.get("materials", ())
            if (material.get("extras") or {}).get("blendlink_material_rule")
            == compiler.TSL_PROGRAM_RULE
        ]
        expect(
            len(carriers) == 1
            and (carriers[0]["extras"].get("blendlink_source_material")
                 == "TSL Solo"),
            f"exactly one program carrier with source extras must ship: "
            f"{carriers}",
        )
        evidence = next(
            item for item in compilation.gltf_evidence
            if item["sourceMaterial"] == "TSL Solo"
        )
        expect(
            evidence["transport"] == "program"
            and evidence.get("observedOnly") is True,
            f"program attestation must record observed PBR, not assert "
            f"planned values: {evidence}",
        )
    expect(
        solo_obj.material_slots[0].material is original_slot_material,
        "the compile transaction must restore the artist material binding",
    )

    print("BLENDLINK_MATERIAL_TSL_IR_CHECK_PASSED")


if __name__ == "__main__":
    main()
