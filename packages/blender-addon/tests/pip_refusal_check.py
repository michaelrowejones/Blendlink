# SPDX-License-Identifier: GPL-3.0-or-later
"""Permanent, attributed refusal contract derived from Blender Studio's Pip.

The CC-BY source binary is deliberately not required by this package test.
Instead, the adjacent conformance record names the exact inspected source and
this script constructs only the smallest graph that preserves the release-
critical consequences: two materials share two frame-driven node groups, the
active graph contains EEVEE-only Shader to RGB, and an unrelated direct-Python
driver remains restricted. The scratch scene is never saved.
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE_PATH = FIXTURE_DIR / "pip-refusal.json"
ATTRIBUTION_PATH = FIXTURE_DIR / "pip-refusal.license.md"
PACKAGE = "blendlink_pip_refusal_check"


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


def load_exporter():
    path = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"
    spec = importlib.util.spec_from_file_location(
        "blendlink_pip_refusal_exporter", path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def output_group(name, socket_type="NodeSocketColor"):
    tree = bpy.data.node_groups.new(name, "ShaderNodeTree")
    tree.interface.new_socket(
        name="Color", in_out="OUTPUT", socket_type=socket_type,
    )
    output = tree.nodes.new("NodeGroupOutput")
    output.is_active_output = True
    return tree, output


def add_frame_driver(tree):
    value = tree.nodes.new("ShaderNodeValue")
    value.name = "Value.001"
    curve = value.outputs[0].driver_add("default_value")
    curve.driver.type = "SCRIPTED"
    curve.driver.expression = "frame"
    return curve


def build_pip_consequence_fixture(fixture):
    topology = fixture["topology"]

    texture, texture_output = output_group("UT-texture")
    texture_driver = add_frame_driver(texture)
    texture.links.new(
        texture.nodes["Value.001"].outputs[0], texture_output.inputs["Color"],
    )

    toon, toon_output = output_group("SH-simple_toon")
    diffuse = toon.nodes.new("ShaderNodeBsdfDiffuse")
    shader_to_rgb = toon.nodes.new(topology["eeveeOnlyNode"])
    toon.links.new(diffuse.outputs[0], shader_to_rgb.inputs["Shader"])
    toon.links.new(shader_to_rgb.outputs["Color"], toon_output.inputs["Color"])

    seed, seed_output = output_group("SH-Seed")
    seed_driver = add_frame_driver(seed)
    toon_node = seed.nodes.new("ShaderNodeGroup")
    toon_node.node_tree = toon
    texture_node = seed.nodes.new("ShaderNodeGroup")
    texture_node.node_tree = texture
    mix = seed.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.5
    seed.links.new(toon_node.outputs["Color"], mix.inputs[1])
    seed.links.new(texture_node.outputs["Color"], mix.inputs[2])
    seed.links.new(mix.outputs["Color"], seed_output.inputs["Color"])

    materials = []
    for index, name in enumerate(topology["materials"]):
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        output.is_active_output = True
        group = tree.nodes.new("ShaderNodeGroup")
        group.node_tree = seed
        emission = tree.nodes.new("ShaderNodeEmission")
        tree.links.new(group.outputs["Color"], emission.inputs["Color"])
        if index == 0:
            transparent = tree.nodes.new("ShaderNodeBsdfTransparent")
            mix_shader = tree.nodes.new("ShaderNodeMixShader")
            mix_shader.inputs[0].default_value = 0.25
            tree.links.new(transparent.outputs[0], mix_shader.inputs[1])
            tree.links.new(emission.outputs[0], mix_shader.inputs[2])
            tree.links.new(mix_shader.outputs[0], output.inputs["Surface"])
        else:
            tree.links.new(emission.outputs[0], output.inputs["Surface"])
        materials.append(material)

    mesh = bpy.data.meshes.new("Pip Refusal Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2), (0, 2, 3)),
    )
    mesh.update()
    sphere = bpy.data.objects.new(topology["object"], mesh)
    bpy.context.scene.collection.objects.link(sphere)
    for material in materials:
        mesh.materials.append(material)
    for polygon, material_index in zip(mesh.polygons, (0, 1)):
        polygon.material_index = material_index

    invalid = topology["invalidDriver"]
    empty = bpy.data.objects.new(invalid["object"], None)
    bpy.context.scene.collection.objects.link(empty)
    invalid_curve = empty.driver_add(invalid["path"], invalid["index"])
    invalid_curve.driver.type = "SCRIPTED"
    invalid_curve.driver.expression = invalid["expression"]

    return sphere, (seed_driver, texture_driver), invalid_curve


def read_glb_json(path):
    payload = path.read_bytes()
    expect(len(payload) >= 20, "stock glTF probe emitted a truncated GLB")
    magic, version, declared_length = struct.unpack_from("<4sII", payload, 0)
    expect(
        magic == b"glTF" and version == 2 and declared_length == len(payload),
        "stock glTF probe emitted an invalid GLB header",
    )
    chunk_length, chunk_type = struct.unpack_from("<II", payload, 12)
    expect(chunk_type == 0x4E4F534A, "stock GLB does not start with a JSON chunk")
    return json.loads(payload[20:20 + chunk_length].decode("utf8").rstrip(" \t\r\n\0"))


def main():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf8"))
    attribution = ATTRIBUTION_PATH.read_text(encoding="utf8")
    source = fixture["source"]
    expect(fixture["schemaVersion"] == 1, "unsupported Pip fixture schema")
    expect(
        source["creator"] in attribution
        and source["publisher"] in attribution
        and source["license"] == "CC-BY-4.0"
        and source["licenseUrl"] in attribution
        and source["url"] in attribution
        and source["officialSha256"] in attribution
        and source["localBlender51ResaveSha256"] in attribution,
        "Pip refusal fixture lost its adjacent CC-BY attribution or source identity",
    )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    procedural = importlib.import_module(f"{PACKAGE}.procedural")
    exporter = load_exporter()
    try:
        expect(
            not bpy.context.preferences.filepaths.use_scripts_auto_execute,
            "Pip refusal check must start with Blender auto-execution disabled",
        )
        sphere, frame_drivers, invalid_curve = build_pip_consequence_fixture(fixture)
        scene = bpy.context.scene
        scene.frame_start = 1
        scene.frame_end = 250
        scene.frame_set(2)
        bpy.context.view_layer.update()

        expected_drivers = {
            (item["name"], item["path"], item["expression"])
            for item in fixture["topology"]["animatedNodeGroups"]
        }
        actual_drivers = {
            (
                tree.name,
                curve.data_path,
                curve.driver.expression,
            )
            for tree in bpy.data.node_groups
            for curve in (
                tree.animation_data.drivers if tree.animation_data else ()
            )
        }
        expect(
            actual_drivers == expected_drivers
            and all(curve.is_valid for curve in frame_drivers),
            f"Pip material-driver topology drifted: {actual_drivers}",
        )
        invalid = fixture["topology"]["invalidDriver"]
        expect(
            invalid_curve.data_path == invalid["path"]
            and invalid_curve.array_index == invalid["index"]
            and invalid_curve.driver.expression == invalid["expression"]
            and bpy.app.autoexec_fail
            and invalid["expression"] in bpy.app.autoexec_fail_message,
            "restricted direct-Python driver was not retained as explicit restricted evidence: "
            f"path={invalid_curve.data_path!r}, index={invalid_curve.array_index}, "
            f"expression={invalid_curve.driver.expression!r}, valid={invalid_curve.is_valid}, "
            f"autoexec_fail={bpy.app.autoexec_fail!r}, "
            f"autoexec_fail_message={bpy.app.autoexec_fail_message!r}",
        )

        diagnostics = procedural.analyze_scene(
            scene, full=False, objects=(sphere,),
        )
        materials = diagnostics["materials"]
        expected_materials = sorted(fixture["topology"]["materials"], key=str.casefold)
        expect(
            [item["material"] for item in materials] == expected_materials,
            f"Pip refusal plan omitted a used material: {materials}",
        )
        for material in materials:
            expect(
                material["status"] == "needsBake"
                and material["usedBy"] == [sphere.name]
                and any("Shader to RGB" in reason for reason in material["reasons"])
                and material["cyclesAppearance"]["status"] == "blocked"
                and any(
                    "EEVEE-only" in blocker and "Cycles Appearance" in blocker
                    for blocker in material["cyclesAppearance"]["blockers"]
                ),
                f"Pip material was not refused with the concrete EEVEE reason: {material}",
            )

        pointer_issues = procedural.pointer_animation_issues(
            scene, objects=(sphere,),
        )
        expect(
            len(pointer_issues) == 2
            and all(item["object"] == sphere.name for item in pointer_issues)
            and [item["reason"].split("'", 2)[1] for item in pointer_issues]
            == fixture["topology"]["materials"]
            and all("SH-Seed" in item["reason"] for item in pointer_issues),
            f"Pip material animation did not become an artist-named blocker: {pointer_issues}",
        )
        dynamic_reason = procedural.automatic_dynamic_reason(sphere)
        expect(
            dynamic_reason is not None
            and "MAT-shell" in dynamic_reason
            and "SH-Seed" in dynamic_reason,
            f"Pip frame-driven material was incorrectly treated as static: {dynamic_reason}",
        )

        try:
            exporter.enforce_pointer_animation_policy(
                {"draft": False, "authoringPreview": False},
                pointer_issues,
                scene.frame_current_final,
            )
        except SystemExit as error:
            message = str(error)
            expect(
                "KHR_animation_pointer" in message
                and sphere.name in message
                and "MAT-shell" in message
                and "MAT-shell_solid" in message
                and "SH-Seed" in message
                and "website code" in message,
                f"Pip Final refusal lost its artist-readable cause/remedy: {message}",
            )
        else:
            raise AssertionError("Pip Final incorrectly accepted frame-driven material state")

        preview = exporter.enforce_pointer_animation_policy(
            {"draft": True, "authoringPreview": True},
            pointer_issues,
            scene.frame_current_final,
        )
        expect(
            len(preview) == 2
            and all("PRIVATE PREVIEW ONLY" in item for item in preview)
            and all("frozen at Blender frame 2" in item for item in preview)
            and all("Final builds" in item for item in preview)
            and "MAT-shell" in preview[0]
            and "MAT-shell_solid" in preview[1],
            f"Pip private Preview did not disclose the frozen frame: {preview}",
        )

        with tempfile.TemporaryDirectory(prefix="blendlink-pip-refusal-") as directory:
            glb = Path(directory) / "stock-collapse-probe.glb"
            result = bpy.ops.export_scene.gltf(
                filepath=str(glb),
                export_format="GLB",
                export_animations=True,
                export_materials="EXPORT",
                export_extras=True,
                use_active_scene=True,
            )
            expect("FINISHED" in result and glb.is_file(), "stock glTF probe failed")
            document = read_glb_json(glb)
            exported_materials = {
                item.get("name") for item in document.get("materials", ())
            }
            expect(
                set(expected_materials) <= exported_materials
                and not document.get("animations")
                and not document.get("textures")
                and not document.get("images"),
                "stock glTF probe no longer models Pip's loadable but animation-free "
                f"material collapse: materials={exported_materials}, "
                f"animations={len(document.get('animations', ()))}, "
                f"textures={len(document.get('textures', ()))}, "
                f"images={len(document.get('images', ()))}",
            )

        expect(
            not bpy.context.preferences.filepaths.use_scripts_auto_execute,
            "Blendlink enabled Python auto-execution while inspecting Pip",
        )
        print("BLENDLINK_PIP_REFUSAL_CHECK_PASSED")
    finally:
        addon.unregister()


if __name__ == "__main__":
    main()
