# SPDX-License-Identifier: GPL-3.0-or-later
"""Differential contract for render-used material bindings.

Run:
  blender --background --factory-startup --python-exit-code 1 \
    --python tests/evaluated_material_bindings_check.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import struct
import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_evaluated_material_bindings_check"
GLB_JSON_CHUNK = 0x4E4F534A


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE,
        ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def portable_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    return material


def unsupported_material(name):
    material = portable_material(name)
    tree = material.node_tree
    principled = tree.nodes.get("Principled BSDF")
    noise = tree.nodes.new("ShaderNodeTexNoise")
    tree.links.new(noise.outputs["Fac"], principled.inputs["Base Color"])
    return material


def triangle_object(name, materials):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0)),
        (),
        ((0, 1, 2),),
    )
    for material in materials:
        mesh.materials.append(material)
    mesh.polygons[0].material_index = 0
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def set_material_modifier(obj, material):
    tree = bpy.data.node_groups.new(
        f"{obj.name} Evaluated Material", "GeometryNodeTree",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    group_input = tree.nodes.new("NodeGroupInput")
    set_material = tree.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    group_output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(
        group_input.outputs["Geometry"], set_material.inputs["Geometry"],
    )
    tree.links.new(
        set_material.outputs["Geometry"], group_output.inputs["Geometry"],
    )
    modifier = obj.modifiers.new("Evaluated Material", "NODES")
    modifier.node_group = tree


def replace_with_empty_material_cube(obj):
    """Produce faces whose evaluated material table is exactly ``[None]``."""
    tree = bpy.data.node_groups.new(
        f"{obj.name} Empty Material Cube", "GeometryNodeTree",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    cube = tree.nodes.new("GeometryNodeMeshCube")
    set_material = tree.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = None
    group_output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(cube.outputs["Mesh"], set_material.inputs["Geometry"])
    tree.links.new(
        set_material.outputs["Geometry"], group_output.inputs["Geometry"],
    )
    modifier = obj.modifiers.new("Empty Evaluated Material", "NODES")
    modifier.node_group = tree


def deform_then_set_material(obj, material):
    """Return a rig that makes an enabled ARMATURE select ``material``."""
    armature_data = bpy.data.armatures.new(f"{obj.name} Armature")
    armature = bpy.data.objects.new(
        f"{obj.name} Armature", armature_data,
    )
    bpy.context.scene.collection.objects.link(armature)
    obj.parent = armature
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bone = armature_data.edit_bones.new("Mover")
    bone.head = (0.0, 0.0, 0.0)
    bone.tail = (0.0, 0.0, 1.0)
    bone_name = bone.name
    bpy.ops.object.mode_set(mode="OBJECT")

    group = obj.vertex_groups.new(name=bone_name)
    group.add(tuple(range(len(obj.data.vertices))), 1.0, "REPLACE")
    enabled = obj.modifiers.new("Enabled Armature", "ARMATURE")
    enabled.object = armature
    disabled = obj.modifiers.new("Disabled Armature", "ARMATURE")
    disabled.object = armature
    disabled.show_viewport = False

    tree = bpy.data.node_groups.new(
        f"{obj.name} Position Material", "GeometryNodeTree",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    group_input = tree.nodes.new("NodeGroupInput")
    position = tree.nodes.new("GeometryNodeInputPosition")
    separate = tree.nodes.new("ShaderNodeSeparateXYZ")
    compare = tree.nodes.new("FunctionNodeCompare")
    compare.data_type = "FLOAT"
    compare.operation = "GREATER_THAN"
    compare.inputs["B"].default_value = 0.0
    set_material = tree.nodes.new("GeometryNodeSetMaterial")
    set_material.inputs["Material"].default_value = material
    group_output = tree.nodes.new("NodeGroupOutput")
    tree.links.new(
        group_input.outputs["Geometry"], set_material.inputs["Geometry"],
    )
    tree.links.new(position.outputs["Position"], separate.inputs["Vector"])
    tree.links.new(separate.outputs["X"], compare.inputs["A"])
    tree.links.new(compare.outputs["Result"], set_material.inputs["Selection"])
    tree.links.new(
        set_material.outputs["Geometry"], group_output.inputs["Geometry"],
    )
    modifier = obj.modifiers.new("Position Material", "NODES")
    modifier.node_group = tree

    armature.pose.bones[bone_name].location.x = 4.0
    return armature, enabled, disabled


def glb_json(path):
    payload = Path(path).read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", payload, 0)
    expect(magic == b"glTF" and version == 2 and total_length == len(payload),
           f"stock exporter emitted a malformed GLB header: "
           f"{magic!r}, {version}, {total_length}, {len(payload)}")
    chunk_length, chunk_type = struct.unpack_from("<II", payload, 12)
    expect(chunk_type == GLB_JSON_CHUNK,
           f"stock exporter emitted first GLB chunk {chunk_type:#x}, not JSON")
    return json.loads(
        payload[20:20 + chunk_length].decode("utf8").rstrip(" \t\r\n\0"),
    )


def select_only(obj):
    select_objects(obj)


def select_objects(*objects):
    for candidate in bpy.context.selected_objects:
        candidate.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def export_stock(path):
    """Export with the material-relevant subset of Blendlink's owned kwargs."""
    return bpy.ops.export_scene.gltf(
        filepath=str(path),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_extras=True,
        export_cameras=False,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_draco_mesh_compression_enable=False,
        export_image_format="AUTO",
        export_lights=False,
    )


def raw_evaluated_materials(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = None
    try:
        mesh = evaluated.to_mesh(
            preserve_all_data_layers=True,
            depsgraph=depsgraph,
        )
        return (
            tuple(mesh.materials),
            tuple(polygon.material_index for polygon in mesh.polygons),
        )
    finally:
        if mesh is not None:
            evaluated.to_mesh_clear()


def used_material_names(document):
    materials = document.get("materials", ())
    return [
        materials[primitive["material"]].get("name")
        for mesh in document.get("meshes", ())
        for primitive in mesh.get("primitives", ())
        if "material" in primitive
    ]


def run():
    addon = load_addon()
    procedural = sys.modules[f"{PACKAGE}.procedural"]
    compiler = sys.modules[f"{PACKAGE}.material_compiler"]
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        used = portable_material("Used Portable")
        unused = unsupported_material("Unused Unsupported")
        obj = triangle_object("One Used Slot", (used, unused))

        with tempfile.TemporaryDirectory(
                prefix="blendlink-evaluated-material-bindings-") as temp:
            fixture = Path(temp) / "one-used-slot.blend"
            output = Path(temp) / "one-used-slot.glb"
            bpy.ops.wm.save_as_mainfile(filepath=str(fixture), check_existing=False)
            expect(fixture.is_file(), "minimal source .blend was not generated")

            select_only(obj)
            export_stock(output)
            document = glb_json(output)
            exported_names = [
                item.get("name") for item in document.get("materials", ())
            ]
            expect(
                exported_names == [used.name],
                "stock Blender exported a material with no primitive faces: "
                f"{exported_names}",
            )
            primitives = [
                primitive
                for mesh in document.get("meshes", ())
                for primitive in mesh.get("primitives", ())
            ]
            expect(
                len(primitives) == 1
                and primitives[0].get("material") == 0,
                f"stock Blender did not emit exactly one used material primitive: "
                f"{primitives}",
            )

            report = procedural.analyze_scene(
                bpy.context.scene, full=False, objects=(obj,),
            )
            report_names = [item["material"] for item in report["materials"]]
            expect(
                report_names == [used.name],
                "attached-but-unused unsupported material became render-used: "
                f"{report_names}",
            )

            plan = compiler.plan_materials((obj,), purpose="inspect")
            plan_names = [item.material_name for item in plan.decisions]
            expect(
                plan_names == [used.name],
                "material compiler planned a slot with no evaluated faces: "
                f"{plan_names}",
            )

        modifier_obj = triangle_object(
            "Modifier Keeps Used Slot", (used, unused),
        )
        modifier_obj.modifiers.new("Triangulate", "TRIANGULATE")
        modifier_report = procedural.analyze_scene(
            bpy.context.scene, full=False, objects=(modifier_obj,),
        )
        expect(
            [item["material"] for item in modifier_report["materials"]]
            == [used.name],
            "evaluated modifier reintroduced an attached unused material: "
            f"{modifier_report['materials']}",
        )
        with tempfile.TemporaryDirectory(
                prefix="blendlink-evaluated-material-modifier-") as temp:
            modifier_output = Path(temp) / "modifier.glb"
            select_only(modifier_obj)
            export_stock(modifier_output)
            modifier_document = glb_json(modifier_output)
            expect(
                [
                    item.get("name")
                    for item in modifier_document.get("materials", ())
                ] == [used.name],
                "Blendlink's modifier-used materials diverged from stock GLB: "
                f"{modifier_document.get('materials', ())}",
            )

        evaluated_material = portable_material("Evaluated Website Material")
        selected = evaluated_material.node_tree.nodes.new("ShaderNodeRGB")
        compiler.set_web_source(
            evaluated_material,
            selected,
            selected.outputs["Color"].identifier,
            "COLOR",
        )
        generated_obj = triangle_object(
            "Geometry Nodes Material", (used, unused),
        )
        set_material_modifier(generated_obj, evaluated_material)
        bpy.context.view_layer.update()
        generated_report = procedural.analyze_scene(
            bpy.context.scene, full=False, objects=(generated_obj,),
        )
        expect(
            [item["material"] for item in generated_report["materials"]]
            == [evaluated_material.name],
            "evaluated-only material use was not reported exactly: "
            f"{generated_report['materials']}",
        )
        generated_plan = compiler.plan_materials(
            (generated_obj,), purpose="inspect",
        )
        evaluated_decision = next(
            (
                item for item in generated_plan.decisions
                if item.material_name == evaluated_material.name
            ),
            None,
        )
        expect(
            evaluated_decision is not None
            and evaluated_decision.outcome == "blocked"
            and any(
                issue.code == "material.evaluated-binding-unsupported"
                for issue in evaluated_decision.issues
            ),
            "evaluated-only selected material did not fail loudly at its "
            f"unowned source binding: {generated_plan.as_dict()}",
        )
        with tempfile.TemporaryDirectory(
                prefix="blendlink-evaluated-material-generated-") as temp:
            generated_output = Path(temp) / "generated.glb"
            select_only(generated_obj)
            export_stock(generated_output)
            generated_document = glb_json(generated_output)
            expect(
                [
                    item.get("name")
                    for item in generated_document.get("materials", ())
                ] == [evaluated_material.name],
                "Blendlink's evaluated-only material diverged from stock GLB: "
                f"{generated_document.get('materials', ())}",
            )

        requested_cell = os.environ.get(
            "BLENDLINK_EVALUATED_MATERIAL_CELL", "",
        )
        if requested_cell in ("", "none-fallback"):
            fallback_material = unsupported_material(
                "Source Fallback Material",
            )
            fallback_obj = triangle_object(
                "Evaluated None Falls Back", (fallback_material,),
            )
            replace_with_empty_material_cube(fallback_obj)
            bpy.context.view_layer.update()
            raw_materials, raw_indices = raw_evaluated_materials(fallback_obj)
            expect(
                raw_materials == (None,) and set(raw_indices) == {0},
                "fallback fixture did not produce the exporter's exact [None] "
                f"material-table trigger: {raw_materials}, {raw_indices}",
            )
            fallback_uses = procedural.evaluated_material_uses(fallback_obj)
            expect(
                [
                    (
                        use.material.name if use.material is not None else None,
                        use.source_slot_index,
                    )
                    for use in fallback_uses
                ] == [(fallback_material.name, 0)],
                "Blendlink did not mirror stock [None] material fallback: "
                f"{fallback_uses}",
            )
            fallback_report = procedural.analyze_scene(
                bpy.context.scene, full=False, objects=(fallback_obj,),
            )
            expect(
                [
                    (item["material"], item["status"])
                    for item in fallback_report["materials"]
                ] == [(fallback_material.name, "needsBake")],
                "the [None] fallback did not retain its actual Needs Bake "
                f"preflight consequence: {fallback_report['materials']}",
            )
            fallback_plan = compiler.plan_materials(
                (fallback_obj,), purpose="inspect",
            )
            expect(
                [item.material_name for item in fallback_plan.decisions]
                == [fallback_material.name],
                "the [None] fallback did not retain source ownership in the "
                f"material plan: {fallback_plan.as_dict()}",
            )
            with tempfile.TemporaryDirectory(
                    prefix="blendlink-evaluated-material-none-") as temp:
                fallback_output = Path(temp) / "fallback.glb"
                select_only(fallback_obj)
                export_stock(fallback_output)
                fallback_document = glb_json(fallback_output)
                expect(
                    used_material_names(fallback_document)
                    == [fallback_material.name],
                    "stock [None] material fallback did not export the source "
                    f"slot: {fallback_document.get('materials', ())}",
                )

        if requested_cell in ("", "skin-armature"):
            skin_source = unsupported_material("Skin Source Material")
            skin_deformed = portable_material("Skin Deformed Material")
            skin_obj = triangle_object(
                "Skin Evaluation Ownership", (skin_source,),
            )
            for vertex in skin_obj.data.vertices:
                vertex.co.x -= 3.0
            armature, enabled_armature, disabled_armature = (
                deform_then_set_material(skin_obj, skin_deformed)
            )
            bpy.context.view_layer.update()
            enabled_materials, enabled_indices = raw_evaluated_materials(
                skin_obj,
            )
            enabled_used = {
                (
                    getattr(enabled_materials[index], "original", None)
                    or enabled_materials[index]
                )
                for index in enabled_indices
                if index < len(enabled_materials)
            }
            expect(
                enabled_used == {skin_deformed},
                "skin fixture did not make enabled armature evaluation choose "
                f"the deformed material: {enabled_materials}, {enabled_indices}",
            )
            original_states = (
                enabled_armature.show_viewport,
                disabled_armature.show_viewport,
            )
            expect(
                original_states == (True, False),
                f"skin fixture lost its mixed ARMATURE states: {original_states}",
            )
            with tempfile.TemporaryDirectory(
                    prefix="blendlink-evaluated-material-skin-source-") as temp:
                skin_fixture = Path(temp) / "skin-source.blend"
                bpy.ops.wm.save_as_mainfile(
                    filepath=str(skin_fixture), check_existing=False,
                )
                expect(
                    skin_fixture.is_file() and not bpy.data.is_dirty,
                    "skinned source fixture was not saved cleanly before "
                    "temporary material inspection",
                )
            skin_uses = procedural.evaluated_material_uses(skin_obj)
            expect(
                (
                    enabled_armature.show_viewport,
                    disabled_armature.show_viewport,
                ) == original_states,
                "Blendlink did not restore every ARMATURE show_viewport value "
                "after evaluated material inspection",
            )
            expect(
                not bpy.data.is_dirty,
                "temporary ARMATURE suppression dirtied the saved source file",
            )
            expect(
                [
                    use.material.name if use.material is not None else None
                    for use in skin_uses
                ] == [skin_source.name],
                "Blendlink did not evaluate material ownership with skin "
                f"ARMATURE modifiers disabled: {skin_uses}",
            )
            skin_report = procedural.analyze_scene(
                bpy.context.scene, full=False, objects=(skin_obj,),
            )
            expect(
                [
                    (item["material"], item["status"])
                    for item in skin_report["materials"]
                ] == [(skin_source.name, "needsBake")],
                "skin suppression did not retain the stock primitive's actual "
                f"Needs Bake consequence: {skin_report['materials']}",
            )
            skin_plan = compiler.plan_materials(
                (skin_obj,), purpose="inspect",
            )
            expect(
                [item.material_name for item in skin_plan.decisions]
                == [skin_source.name],
                "skin suppression did not retain stock source ownership in "
                f"the material plan: {skin_plan.as_dict()}",
            )
            expect(
                (
                    enabled_armature.show_viewport,
                    disabled_armature.show_viewport,
                ) == original_states,
                "repeated preflight did not restore every ARMATURE "
                "show_viewport value",
            )
            expect(
                not bpy.data.is_dirty,
                "repeated material preflight dirtied the saved source file",
            )
            with tempfile.TemporaryDirectory(
                    prefix="blendlink-evaluated-material-skin-") as temp:
                skin_output = Path(temp) / "skin.glb"
                select_objects(skin_obj, armature)
                export_stock(skin_output)
                skin_document = glb_json(skin_output)
                expect(
                    (
                        enabled_armature.show_viewport,
                        disabled_armature.show_viewport,
                    ) == original_states,
                    "stock exporter did not restore every ARMATURE "
                    "show_viewport value",
                )
                expect(
                    not bpy.data.is_dirty,
                    "stock-export-equivalent material inspection dirtied the "
                    "saved source file",
                )
                expect(
                    used_material_names(skin_document)
                    == [skin_source.name],
                    "Blendlink's skin ownership did not agree with the stock "
                    f"GLB primitive material: {used_material_names(skin_document)}",
                )

        print(
            "BLENDLINK_EVALUATED_MATERIAL_BINDINGS_PASSED "
            f"blender={bpy.app.version_string} "
            "used=1 unused=1 evaluatedOnly=1 noneFallback=1 skinArmature=1",
        )
    finally:
        addon.unregister()


if __name__ == "__main__":
    run()
