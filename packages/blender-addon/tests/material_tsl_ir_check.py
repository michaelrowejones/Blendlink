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
import sys
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

    plan = compiler.plan_materials(
        (evidence_obj, refused_obj, plain_obj), purpose="inspect",
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

    print("BLENDLINK_MATERIAL_TSL_IR_CHECK_PASSED")


if __name__ == "__main__":
    main()
