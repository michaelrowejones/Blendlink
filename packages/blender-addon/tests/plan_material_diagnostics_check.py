# SPDX-License-Identifier: GPL-3.0-or-later
"""Plan-only must use the real export scope and never install materials."""
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
EXPORTER_PATH = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_exporter():
    spec = importlib.util.spec_from_file_location(
        "blendlink_plan_material_diagnostics_exporter", EXPORTER_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def triangle_object(name, collection):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(((-1, -1, 0), (1, -1, 0), (0, 1, 0)), (), ((0, 1, 2),))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def selected_constant_material(compiler, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    rgb = material.node_tree.nodes.new("ShaderNodeRGB")
    rgb.name = "Artist Constant"
    rgb.outputs["Color"].default_value = (0.15, 0.4, 0.8, 1.0)
    principled = material.node_tree.nodes.get("Principled BSDF")
    material.node_tree.links.new(
        rgb.outputs["Color"], principled.inputs["Base Color"],
    )
    compiler.set_web_source(material, rgb, rgb.outputs["Color"].identifier, "COLOR")
    return material


def selected_invalid_alpha_material(compiler, name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    output = tree.nodes.get("Material Output")
    tree.links.remove(output.inputs["Surface"].links[0])
    transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
    tree.links.new(transparent.outputs[0], output.inputs["Surface"])
    rgb = tree.nodes.new("ShaderNodeRGB")
    compiler.set_web_source(material, rgb, rgb.outputs["Color"].identifier, "COLOR")
    return material


def scene_snapshot():
    return {
        "objects": tuple(sorted(
            (obj.name, obj.as_pointer(), obj.data.as_pointer() if obj.data else None)
            for obj in bpy.data.objects
        )),
        "materials": tuple(sorted(
            (material.name, material.as_pointer()) for material in bpy.data.materials
        )),
        "bindings": tuple(sorted(
            (
                obj.name,
                tuple(
                    slot.material.name if slot.material is not None else None
                    for slot in obj.material_slots
                ),
            )
            for obj in bpy.data.objects
        )),
    }


def invoke_plan(
    exporter, root, collection_name, result_name, *, mode="standard", bake_output=None,
):
    out_path = root / f"{result_name}.glb"
    settings_path = root / f"{result_name}.settings.json"
    result_path = root / f"{result_name}.result.json"
    settings = {
        "mode": mode,
        "collection": collection_name,
        "planOnly": True,
    }
    if bake_output is not None:
        settings["bake"] = {
            "atlases": {
                "main": {"size": 128, "bakeOutput": bake_output},
            },
        }
    settings_path.write_text(json.dumps(settings), encoding="utf8")
    original_parse = exporter.parse_argv
    exporter.parse_argv = lambda: (str(out_path), str(settings_path), str(result_path))
    try:
        exporter.main()
    finally:
        exporter.parse_argv = original_parse
    return out_path, result_path


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    exporter = load_exporter()
    compiler = exporter.material_compiler

    published = bpy.data.collections.new("Published")
    rejected = bpy.data.collections.new("Rejected")
    bpy.context.scene.collection.children.link(published)
    bpy.context.scene.collection.children.link(rejected)

    valid_obj = triangle_object("Published Triangle", published)
    valid_material = selected_constant_material(compiler, "Published Web Color")
    valid_obj.data.materials.append(valid_material)

    invalid_obj = triangle_object("Rejected Triangle", rejected)
    invalid_material = selected_invalid_alpha_material(compiler, "Rejected Web Color")
    invalid_obj.data.materials.append(invalid_material)
    second_invalid_obj = triangle_object("Second Rejected Triangle", rejected)
    second_invalid_material = selected_invalid_alpha_material(compiler, "Second Rejected Web Color")
    second_invalid_obj.data.materials.append(second_invalid_material)
    bpy.context.view_layer.update()

    with tempfile.TemporaryDirectory(prefix="blendlink-plan-material-") as directory:
        root = Path(directory)
        before = scene_snapshot()
        out_path, result_path = invoke_plan(exporter, root, "Published", "accepted")
        expect(result_path.is_file(), "plan-only emitted no result JSON")
        expect(not out_path.exists(), "plan-only emitted a GLB")
        expect(scene_snapshot() == before, "plan-only changed source objects, meshes, or bindings")
        expect(
            not any(
                material.name.startswith(compiler.GENERATED_MATERIAL_PREFIX)
                for material in bpy.data.materials
            ),
            "plan-only leaked a generated compiler material",
        )

        result = json.loads(result_path.read_text(encoding="utf8"))
        records = result["sidecar"]["diagnostics"]["materials"]
        compiled = {
            item["material"]: item["materialCompilation"]
            for item in records if "materialCompilation" in item
        }
        expect(
            compiled.get("Published Web Color", {}).get("outcome") == "lowered"
            and compiled["Published Web Color"].get("transport") == "factor",
            f"plan-only omitted JSON-safe selected-field diagnostics: {compiled}",
        )
        expect(
            "Rejected Web Color" not in compiled,
            f"plan-only analyzed material outside the real collection scope: {compiled}",
        )
        expect(
            result["plan"] is None and result["collection"] == "Published",
            "standard plan-only reshaped the existing nullable BakePlan contract",
        )

        rejected_out = root / "rejected.glb"
        rejected_result = root / "rejected.result.json"
        invoke_plan(exporter, root, "Rejected", "rejected")
        rejected_report = json.loads(rejected_result.read_text(encoding="utf8"))
        rejected_records = rejected_report["sidecar"]["diagnostics"]["materials"]
        blocked = {
            record["material"]: record["materialCompilation"]
            for record in rejected_records
            if record.get("materialCompilation", {}).get("outcome") == "blocked"
        }
        expect(set(blocked) == {"Rejected Web Color", "Second Rejected Web Color"},
               f"inspection omitted independent blocked materials: {blocked}")
        expect(all(item.get("issues") and all(
            all(key in issue for key in ("code", "problem", "fix", "objects"))
            for issue in item["issues"]) for item in blocked.values()),
            f"inspection discarded structured compiler issues: {blocked}")
        expect(not rejected_out.exists(), "blocked plan-only emitted a GLB")
        expect(scene_snapshot() == before, "blocked plan-only mutated source scene state")

        # The same material decisions remain fatal to real Preview/Final export.
        # Inspection returning a report must not authorize an installation or
        # replace any last-known-good output.
        prior_output = b"last-known-good-artifact"
        rejected_out.write_bytes(prior_output)
        for draft in (False, True):
            strict_settings = {"mode": "standard", "collection": "Rejected", "draft": draft}
            kwargs, _dropped = exporter.gltf_export_contract(str(rejected_out), strict_settings)
            sidecar = exporter.collect_sidecar(strict_settings, None, export_kwargs=kwargs)
            try:
                exporter.plan_export_materials(strict_settings, sidecar, kwargs)
            except SystemExit as error:
                expect(all(name in str(error) for name in blocked),
                       f"real export refusal did not preserve all material failures: {error}")
            else:
                raise AssertionError("real export approved a blocked material inspection")
            expect(rejected_out.read_bytes() == prior_output,
                   "blocked export preflight replaced the prior artifact")
        expect(scene_snapshot() == before, "strict export preflight mutated source scene state")

        # Appearance owns a static material's complete active Surface, so its
        # selected-field marker is intentionally outside the executable plan.
        # The exact same material becomes compiler-owned when the object is a
        # live Hybrid survivor. Lighting atlases refuse either case because
        # they retain and illuminate the base material.
        compute_called = False
        original_compute = exporter.compute_bake_plan

        def fixture_compute(*_args, **_kwargs):
            nonlocal compute_called
            compute_called = True
            return {"schemaVersion": 1, "errors": [], "objects": []}

        exporter.compute_bake_plan = fixture_compute
        try:
            _out, static_result_path = invoke_plan(
                exporter, root, "Published", "appearance-static",
                mode="baked", bake_output="appearance",
            )
            static_result = json.loads(static_result_path.read_text(encoding="utf8"))
            static_record = next(
                item for item in static_result["sidecar"]["diagnostics"]["materials"]
                if item["material"] == "Published Web Color"
            )
            expect(
                "materialCompilation" not in static_record and compute_called,
                f"static Appearance material entered selected-field compilation: {static_record}",
            )

            compute_called = False
            valid_obj["blendlink_dynamic"] = True
            _out, live_result_path = invoke_plan(
                exporter, root, "Published", "appearance-live",
                mode="baked", bake_output="appearance",
            )
            live_result = json.loads(live_result_path.read_text(encoding="utf8"))
            live_record = next(
                item for item in live_result["sidecar"]["diagnostics"]["materials"]
                if item["material"] == "Published Web Color"
            )
            expect(
                live_record.get("materialCompilation", {}).get("outcome") == "lowered"
                and compute_called,
                f"live Appearance survivor did not enter compiler scope: {live_record}",
            )

            compute_called = False
            del valid_obj["blendlink_dynamic"]
            try:
                invoke_plan(
                    exporter, root, "Published", "lighting-blocked",
                    mode="baked", bake_output="lighting",
                )
            except SystemExit as error:
                expect(
                    "Lighting atlases" in str(error)
                    and "Published Web Color" in str(error),
                    f"Lighting selected-field refusal was vague: {error}",
                )
            else:
                raise AssertionError("Lighting atlas approved selected-field Web Color")
        finally:
            exporter.compute_bake_plan = original_compute
        expect(not compute_called, "blocked Lighting intent reached bake planning")
        expect(not (root / "lighting-blocked.glb").exists(), "blocked Lighting plan emitted a GLB")
        expect(not (root / "lighting-blocked.result.json").exists(), "blocked Lighting plan emitted success")
        expect(scene_snapshot() == before, "blocked baked plan mutated source scene state")

    # A non-Mesh Geometry Nodes result is not safe to silently omit merely
    # because Blender cannot return an evaluated Mesh. Keep this object-level
    # inspection failure distinct from per-material lowering decisions.
    inspection_collection = bpy.data.collections.new("Inspection Blocked")
    bpy.context.scene.collection.children.link(inspection_collection)
    text = bpy.data.curves.new("Authored Text", "FONT")
    text.body = "Artist text"
    uninspectable = bpy.data.objects.new("Uninspectable Text", text)
    inspection_collection.objects.link(uninspectable)
    tree = bpy.data.node_groups.new("Empty Evaluated Output", "GeometryNodeTree")
    tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    tree.nodes.new("NodeGroupOutput")
    uninspectable.modifiers.new("Authored Geometry Nodes", "NODES").node_group = tree
    bpy.context.view_layer.update()
    before = scene_snapshot()
    with tempfile.TemporaryDirectory(prefix="blendlink-binding-inspection-") as directory:
        root = Path(directory)
        output, report_path = invoke_plan(exporter, root, "Inspection Blocked", "binding-blocked")
        report = json.loads(report_path.read_text())
        issues = report["sidecar"]["diagnostics"]["materialBindingIssues"]
        expect(len(issues) == 1 and issues[0]["code"] == "material.binding-inspection-failed"
               and issues[0]["object"] == uninspectable.name
               and "inspect" in issues[0]["problem"] and "repair" in issues[0]["fix"],
               f"binding inspection lost object/cause/remedy: {issues}")
        expect(report["plan"] is None and any("incomplete" in warning for warning in report["warnings"]),
               "failed inspection claimed a complete bake estimate")
        expect(not output.exists() and scene_snapshot() == before,
               "inspection failure emitted geometry or changed source")
        original_compute = exporter.compute_bake_plan
        exporter.compute_bake_plan = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("incomplete inspection reached bake planning"))
        try:
            _, baked_report = invoke_plan(exporter, root, "Inspection Blocked", "binding-baked",
                                          mode="baked", bake_output="appearance")
            expect(json.loads(baked_report.read_text())["plan"] is None,
                   "incomplete material scope produced a bake estimate")
        finally:
            exporter.compute_bake_plan = original_compute
        original_plan = exporter.plan_export_materials
        exporter.plan_export_materials = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            TypeError("unexpected programmer failure"))
        try:
            try:
                invoke_plan(exporter, root, "Inspection Blocked", "unexpected-failure")
            except TypeError as error:
                expect("unexpected programmer" in str(error), "unexpected failure changed")
            else:
                raise AssertionError("plan serialized an unexpected programmer failure")
            expect(not (root / "unexpected-failure.result.json").exists(),
                   "unexpected failure emitted a successful protocol result")
        finally:
            exporter.plan_export_materials = original_plan
        output.write_bytes(b"last-known-good")
        for draft in (False, True):
            settings = {"mode": "standard", "collection": "Inspection Blocked", "draft": draft}
            kwargs, _ = exporter.gltf_export_contract(str(output), settings)
            sidecar = exporter.collect_sidecar(settings, None, export_kwargs=kwargs)
            try:
                exporter.plan_export_materials(settings, sidecar, kwargs)
            except compiler.MaterialBindingInspectionError as error:
                expect(error.object_name == uninspectable.name, "real refusal lost the owner")
            else:
                raise AssertionError("real export accepted unknown evaluated bindings")
            expect(output.read_bytes() == b"last-known-good" and scene_snapshot() == before,
                   "real refusal changed source or last-good output")

    print("BLENDLINK_PLAN_MATERIAL_DIAGNOSTICS_CHECK_PASSED")


if __name__ == "__main__":
    main()
