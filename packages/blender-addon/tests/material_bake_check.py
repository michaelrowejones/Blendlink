# SPDX-License-Identifier: GPL-3.0-or-later
"""MTL-BAKE-001: the per-channel Material bake stays lit, honest, restored.

Covers the whole route: per-channel planning (factors stay factors, only
unrecognised graphs bake, refusals stay named), the compile transaction
through Blender's stock glTF exporter (ORM pack, HDR emissive strength,
tangent normal, REPEAT tile sampler), byte-level attestation, the wrap gate
refusing a non-period-1 tile, and exact source-scene restoration.

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/material_bake_check.py
"""
from __future__ import annotations

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
    "blendlink_material_bake_procedural", ADDON_DIR / "procedural.py",
)
sys.modules["procedural"] = procedural
compiler = load_module(
    "blendlink_material_bake_compiler", ADDON_DIR / "material_compiler.py",
)
import bakelib  # noqa: E402


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def quad_object(name, collection, uv_scale=1.0):
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
        layer.data[loop_index].uv = (
            corner[0] * uv_scale, corner[1] * uv_scale,
        )
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def base_material(name):
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    principled = tree.nodes.get("Principled BSDF")
    return material, tree, principled


def read_glb_json(path):
    raw = Path(path).read_bytes()
    expect(raw[:4] == b"glTF", "GLB magic missing")
    length = struct.unpack_from("<I", raw, 12)[0]
    document = json.loads(raw[20:20 + length])
    offset = 20 + length
    binary = b""
    if offset < len(raw):
        chunk_length, chunk_type = struct.unpack_from("<II", raw, offset)
        if chunk_type == 0x004E4942:
            binary = raw[offset + 8:offset + 8 + chunk_length]
    return document, binary


def channel_record(decision, name):
    return next(
        (
            item for item in (decision.channel_plan or {}).get("channels", ())
            if item["channel"] == name
        ),
        None,
    )


def scene_snapshot():
    return {
        "objects": tuple(sorted(
            (obj.name, obj.data.as_pointer() if obj.data else None)
            for obj in bpy.data.objects
        )),
        "materials": tuple(sorted(
            material.name for material in bpy.data.materials
        )),
        "images": tuple(sorted(image.name for image in bpy.data.images)),
        "bindings": tuple(sorted(
            (
                obj.name,
                tuple(
                    slot.material.name if slot.material else None
                    for slot in obj.material_slots
                ),
            )
            for obj in bpy.data.objects
        )),
    }


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


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    fixtures = bpy.data.collections.new("Material Bake Fixtures")
    bpy.context.scene.collection.children.link(fixtures)

    camera_data = bpy.data.cameras.new("Bake Camera")
    camera = bpy.data.objects.new("Bake Camera", camera_data)
    camera.location = (0.0, -4.0, 0.0)
    camera.rotation_euler = (1.5707963, 0.0, 0.0)
    fixtures.objects.link(camera)
    bpy.context.scene.camera = camera

    # --- Tile route: checker Base Color over 0..3 authored UVs -----------
    tile_obj = quad_object("Tile Target", fixtures, uv_scale=3.0)
    tile_material, tile_tree, tile_principled = base_material("Tiled Channels")
    coord = tile_tree.nodes.new("ShaderNodeTexCoord")
    checker = tile_tree.nodes.new("ShaderNodeTexChecker")
    checker.inputs["Scale"].default_value = 4.0
    tile_tree.links.new(coord.outputs["UV"], checker.inputs["Vector"])
    tile_tree.links.new(
        checker.outputs["Color"], tile_principled.inputs["Base Color"],
    )
    tile_principled.inputs["Roughness"].default_value = 0.7
    tile_principled.inputs["Metallic"].default_value = 0.0
    tile_obj.data.materials.append(tile_material)
    compiler.set_material_bake(tile_material, True)
    # MTL-CONS-003 stage 1: a second binding of the same tileable material
    # must share one generated material, one bake, one texture.
    shared_obj = quad_object("Tile Sibling", fixtures, uv_scale=3.0)
    shared_obj.location = (3.0, 0.0, 0.0)
    shared_obj.data.materials.append(tile_material)

    # --- Unique route: world-space channels + HDR emissive + normal ------
    unique_obj = quad_object("Unique Target", fixtures)
    unique_material, unique_tree, unique_principled = base_material(
        "World Channels",
    )
    world_coord = unique_tree.nodes.new("ShaderNodeTexCoord")
    noise = unique_tree.nodes.new("ShaderNodeTexNoise")
    unique_tree.links.new(world_coord.outputs["Object"], noise.inputs["Vector"])
    unique_tree.links.new(
        noise.outputs["Color"], unique_principled.inputs["Base Color"],
    )
    voronoi = unique_tree.nodes.new("ShaderNodeTexVoronoi")
    unique_tree.links.new(
        world_coord.outputs["Object"], voronoi.inputs["Vector"],
    )
    # Voronoi Distance exceeds one; the range gate refuses unbounded scalar
    # channels, so the fixture authors a bounded 0..0.5 roughness field.
    half = unique_tree.nodes.new("ShaderNodeMath")
    half.operation = "MULTIPLY"
    half.inputs[1].default_value = 0.5
    unique_tree.links.new(voronoi.outputs["Distance"], half.inputs[0])
    unique_tree.links.new(
        half.outputs["Value"], unique_principled.inputs["Roughness"],
    )
    unique_principled.inputs["Metallic"].default_value = 0.25
    unique_principled.inputs["Emission Color"].default_value = (
        1.0, 0.5, 0.25, 1.0,
    )
    strength = unique_tree.nodes.new("ShaderNodeValue")
    strength.outputs[0].default_value = 3.0
    unique_tree.links.new(
        strength.outputs[0], unique_principled.inputs["Emission Strength"],
    )
    bump = unique_tree.nodes.new("ShaderNodeBump")
    bump_noise = unique_tree.nodes.new("ShaderNodeTexNoise")
    unique_tree.links.new(
        world_coord.outputs["Object"], bump_noise.inputs["Vector"],
    )
    unique_tree.links.new(bump_noise.outputs["Fac"], bump.inputs["Height"])
    unique_tree.links.new(
        bump.outputs["Normal"], unique_principled.inputs["Normal"],
    )
    unique_obj.data.materials.append(unique_material)
    compiler.set_material_bake(unique_material, True)

    # A second unique-route material: with two unique variants the shared
    # surface page forms (a lone unique variant deliberately pages
    # nothing), proving the 2-F path end to end.
    page_obj = quad_object("Page Sibling", fixtures)
    page_obj.location = (0.0, 3.0, 0.0)
    page_material, page_tree, page_principled = base_material(
        "World Channels Sibling",
    )
    page_coord = page_tree.nodes.new("ShaderNodeTexCoord")
    page_noise = page_tree.nodes.new("ShaderNodeTexNoise")
    page_noise.inputs["Scale"].default_value = 9.0
    page_tree.links.new(
        page_coord.outputs["Object"], page_noise.inputs["Vector"],
    )
    page_tree.links.new(
        page_noise.outputs["Color"], page_principled.inputs["Base Color"],
    )
    page_principled.inputs["Roughness"].default_value = 0.6
    page_obj.data.materials.append(page_material)
    compiler.set_material_bake(page_material, True)

    # --- Refusals stay named ---------------------------------------------
    refused_obj = quad_object("Refused Target", fixtures)
    refused_material, refused_tree, refused_principled = base_material(
        "Fresnel Refused",
    )
    fresnel = refused_tree.nodes.new("ShaderNodeFresnel")
    refused_tree.links.new(
        fresnel.outputs["Fac"], refused_principled.inputs["Metallic"],
    )
    refused_obj.data.materials.append(refused_material)
    compiler.set_material_bake(refused_material, True)

    bpy.context.view_layer.update()

    # --- Plan ------------------------------------------------------------
    # A TWO-SLOT object whose both slots are unique-route members: the
    # ellie watch/boots shape (split receivers, per-slot packed UVs, two
    # variants paging from one mesh) that single-slot quads cannot cover.
    twin_obj = quad_object("Twin Slots", fixtures)
    twin_obj.location = (3.0, 3.0, 0.0)
    twin_a, twin_a_tree, twin_a_principled = base_material("Twin Slot A")
    twin_a_coord = twin_a_tree.nodes.new("ShaderNodeTexCoord")
    twin_a_noise = twin_a_tree.nodes.new("ShaderNodeTexNoise")
    twin_a_noise.inputs["Scale"].default_value = 5.0
    twin_a_tree.links.new(
        twin_a_coord.outputs["Object"], twin_a_noise.inputs["Vector"],
    )
    twin_a_tree.links.new(
        twin_a_noise.outputs["Color"], twin_a_principled.inputs["Base Color"],
    )
    twin_b, twin_b_tree, twin_b_principled = base_material("Twin Slot B")
    twin_b_coord = twin_b_tree.nodes.new("ShaderNodeTexCoord")
    twin_b_noise = twin_b_tree.nodes.new("ShaderNodeTexNoise")
    twin_b_noise.inputs["Scale"].default_value = 13.0
    twin_b_tree.links.new(
        twin_b_coord.outputs["Object"], twin_b_noise.inputs["Vector"],
    )
    twin_b_tree.links.new(
        twin_b_noise.outputs["Color"], twin_b_principled.inputs["Base Color"],
    )
    twin_b_principled.inputs["Metallic"].default_value = 0.8
    # And a PARTIAL ORM: baked roughness beside the constant metallic.
    # The exporter synthesizes a packed metallicRoughness image for a
    # carrier that links only one SeparateColor lane, so partial-ORM
    # variants must keep private textures (measured on ellie.watch_metal
    # as two byte-divergent images under one page name).
    twin_b_rough = twin_b_tree.nodes.new("ShaderNodeTexNoise")
    twin_b_rough.inputs["Scale"].default_value = 4.0
    twin_b_tree.links.new(
        twin_b_coord.outputs["Object"], twin_b_rough.inputs["Vector"],
    )
    twin_b_tree.links.new(
        twin_b_rough.outputs["Fac"], twin_b_principled.inputs["Roughness"],
    )
    twin_obj.data.materials.append(twin_a)
    twin_obj.data.materials.append(twin_b)
    # Assign half the quad's single polygon... a quad has one polygon;
    # give the mesh a second face so each slot owns one.
    import bmesh
    twin_bm = bmesh.new()
    twin_bm.from_mesh(twin_obj.data)
    twin_bm.faces.ensure_lookup_table()
    result = bmesh.ops.subdivide_edges(
        twin_bm,
        edges=list(twin_bm.edges),
        cuts=1,
        use_grid_fill=True,
    )
    twin_bm.to_mesh(twin_obj.data)
    twin_bm.free()
    half = len(twin_obj.data.polygons) // 2
    for index, polygon in enumerate(twin_obj.data.polygons):
        polygon.material_index = 0 if index < half else 1
    compiler.set_material_bake(twin_a, True)
    compiler.set_material_bake(twin_b, True)

    plan = compiler.plan_materials(
        (tile_obj, shared_obj, unique_obj, page_obj, twin_obj, refused_obj),
        purpose="final",
    )
    decisions = {item.material_name: item for item in plan.decisions}

    tile_decision = decisions["Tiled Channels"]
    expect(
        tile_decision.outcome == "lowered"
        and tile_decision.transport == "channels"
        and tile_decision.fidelity == "per-channel",
        f"tile material must lower per-channel: {tile_decision.outcome}",
    )
    tile_base = channel_record(tile_decision, "Base Color")
    expect(
        tile_base["route"] == "bake" and tile_base["uv"] == "tile"
        and tile_base["wrapGate"] is True
        and isinstance(tile_base["resolution"], int),
        f"checker Base Color must bake one gated tile: {tile_base}",
    )
    tile_rough = channel_record(tile_decision, "Roughness")
    expect(
        tile_rough["route"] == "factor"
        and abs(tile_rough["value"] - 0.7) < 1e-6,
        f"constant Roughness must stay a factor: {tile_rough}",
    )
    consolidation = (tile_decision.channel_plan or {}).get("consolidation")
    expect(
        consolidation == {
            "population": "tileable", "bindings": 2, "sharedMaterial": True,
        },
        f"two tileable bindings must plan one shared material: {consolidation}",
    )
    unique_consolidation = (
        decisions["World Channels"].channel_plan or {}
    ).get("consolidation")
    expect(
        unique_consolidation is not None
        and unique_consolidation["population"] == "unique"
        and unique_consolidation["sharedMaterial"] is False,
        f"the Unique population must stay separate: {unique_consolidation}",
    )

    unique_decision = decisions["World Channels"]
    expect(
        unique_decision.outcome == "lowered",
        f"unique material must lower: {unique_decision.issues}",
    )
    unique_base = channel_record(unique_decision, "Base Color")
    unique_rough = channel_record(unique_decision, "Roughness")
    unique_emission = channel_record(unique_decision, "Emission")
    unique_normal = channel_record(unique_decision, "Normal")
    expect(
        unique_base["uv"] == "unique"
        and unique_rough["uv"] == "unique"
        and unique_rough.get("pack") == "orm"
        and unique_emission["route"] == "bake"
        and unique_normal["route"] == "bake"
        and unique_normal["pass"] == "NORMAL",
        f"world channels must route unique with ORM/normal: "
        f"{unique_decision.channel_plan}",
    )

    refused_decision = decisions["Fresnel Refused"]
    expect(
        refused_decision.outcome == "blocked"
        and any(
            issue.code == "material.channel-refused"
            and "Metallic" in issue.problem
            for issue in refused_decision.issues
        ),
        f"Fresnel Metallic must refuse by name: {refused_decision.issues}",
    )
    refused_record = channel_record(refused_decision, "Metallic")
    expect(
        refused_record["route"] == "refused",
        f"refused channel must stay visible in the plan: {refused_record}",
    )

    # --- Compile the two good materials through the real exporter --------
    compiler.set_material_bake(refused_material, False)
    good_plan = compiler.plan_materials(
        (tile_obj, shared_obj, unique_obj, page_obj, twin_obj),
        purpose="final",
    )
    expect(not good_plan.errors, f"good plan blocked: {good_plan.errors}")

    before = scene_snapshot()
    with tempfile.TemporaryDirectory(prefix="blendlink-material-bake-") as directory:
        out_path = Path(directory) / "material-bake.glb"
        _value, compilation = compiler.with_compiled_materials(
            good_plan,
            str(out_path),
            emit_selected(
                [tile_obj, shared_obj, unique_obj, page_obj, twin_obj],
            ),
        )
        expect(out_path.is_file(), "material bake emitted no GLB")
        expect(
            len(compilation.generated_materials) == 5,
            f"tile consolidation plus four page members: "
            f"{compilation.generated_materials}",
        )
        evidence_by_source = {
            item["sourceMaterial"]: item for item in compilation.gltf_evidence
        }
        tile_evidence = evidence_by_source["Tiled Channels"]
        unique_evidence = evidence_by_source["World Channels"]
        expect(
            tile_evidence["transport"] == "channels"
            and tile_evidence["materialBake"]["textures"]["baseColor"]["wrap"]
            == 10497,
            f"tile carrier must sample REPEAT: {tile_evidence['materialBake']}",
        )
        expect(
            "wrap" in tile_evidence["materialBake"]["gates"]["Base Color"]
            and "determinism"
            in tile_evidence["materialBake"]["gates"]["Base Color"],
            f"tile gates missing: {tile_evidence['materialBake']['gates']}",
        )
        expect(
            sorted(tile_evidence["bindings"])
            == ["Tile Sibling[0]", "Tile Target[0]"],
            f"the shared tile material must attest both bindings: "
            f"{tile_evidence['bindings']}",
        )
        unique_textures = unique_evidence["materialBake"]["textures"]
        expect(
            set(unique_textures) == {"baseColor", "orm", "normal", "emissive"}
            and all(
                item["wrap"] == 33071 for item in unique_textures.values()
            ),
            f"unique carrier textures wrong: {unique_textures}",
        )
        expect(
            abs(
                unique_textures["emissive"]["emissiveStrength"] - 3.0
            ) < 1e-3,
            f"HDR emissive strength lost: {unique_textures['emissive']}",
        )

        # --- Shared surface page (Phase 2 unit F) ------------------------
        # Eligibility follows the partial-ORM rule: World Channels bakes
        # roughness beside a CONSTANT metallic, so it keeps private
        # textures (the exporter would synthesize a divergent packed
        # metallicRoughness image, measured on ellie.watch_metal); the
        # sibling and Twin Slot A have no ORM at all and page together.
        sibling_evidence = evidence_by_source["World Channels Sibling"]
        unique_base = unique_evidence["materialBake"]["textures"]["baseColor"]
        sibling_base = sibling_evidence["materialBake"]["textures"][
            "baseColor"
        ]
        twin_a_evidence = evidence_by_source["Twin Slot A"]
        twin_a_base = twin_a_evidence["materialBake"]["textures"][
            "baseColor"
        ]
        expect(
            twin_a_base["imageSha256"] == sibling_base["imageSha256"],
            "two eligible members must share one baseColor page: "
            f"{twin_a_base['imageSha256'][:12]} vs "
            f"{sibling_base['imageSha256'][:12]}",
        )
        expect(
            twin_a_base.get("pageRect") and sibling_base.get("pageRect")
            and twin_a_base["pageRect"] != sibling_base["pageRect"]
            and twin_a_base.get("page") == sibling_base.get("page")
            and twin_a_base.get("primitivesChecked", 0) >= 1,
            f"page members must attest DISTINCT rects on one page: "
            f"{twin_a_base.get('pageRect')} vs {sibling_base.get('pageRect')}",
        )
        expect(
            "pageRect" not in unique_base
            and unique_base["imageSha256"] != sibling_base["imageSha256"],
            "a partial-ORM variant must keep private textures off the "
            f"page: {unique_base}",
        )
        twin_b_evidence = evidence_by_source["Twin Slot B"]
        twin_b_base = twin_b_evidence["materialBake"]["textures"][
            "baseColor"
        ]
        expect(
            "pageRect" not in twin_b_base
            and twin_b_base["imageSha256"] != sibling_base["imageSha256"],
            "the second partial-ORM variant must also stay private: "
            f"{twin_b_base}",
        )
        tile_base = tile_evidence["materialBake"]["textures"]["baseColor"]
        expect(
            "pageRect" not in tile_base
            and tile_base["imageSha256"] != unique_base["imageSha256"],
            "the tile route must keep its private REPEAT texture off the "
            "page",
        )

        document, binary = read_glb_json(out_path)
        tile_nodes = {
            node.get("name"): node for node in document.get("nodes", ())
            if node.get("name") in {"Tile Target", "Tile Sibling"}
        }
        tile_material_indices = {
            primitive.get("material")
            for node in tile_nodes.values()
            for primitive in document["meshes"][node["mesh"]]["primitives"]
        }
        expect(
            len(tile_nodes) == 2 and len(tile_material_indices) == 1,
            f"both tile bindings must reference one glTF material: "
            f"{tile_material_indices}",
        )
        generated = [
            material for material in document.get("materials", ())
            if (material.get("extras") or {}).get("blendlink_material_rule")
            == compiler.MATERIAL_BAKE_RULE
        ]
        expect(
            len(generated) == 5,
            f"GLB must carry five material-bake materials: "
            f"{[item.get('name') for item in document.get('materials', ())]}",
        )
        for material in generated:
            expect(
                "KHR_materials_unlit" not in (material.get("extensions") or {}),
                "a Material bake carrier must stay lit",
            )
        unique_emitted = next(
            material for material in generated
            if (material.get("extras") or {}).get("blendlink_source_material")
            == "World Channels"
        )
        pbr = unique_emitted.get("pbrMetallicRoughness") or {}
        expect(
            pbr.get("baseColorTexture") is not None
            and pbr.get("metallicRoughnessTexture") is not None
            and unique_emitted.get("normalTexture") is not None
            and unique_emitted.get("emissiveTexture") is not None,
            f"unique carrier lost a texture slot: {sorted(unique_emitted)}",
        )
        strength_ext = (
            unique_emitted.get("extensions") or {}
        ).get("KHR_materials_emissive_strength") or {}
        expect(
            abs(float(strength_ext.get("emissiveStrength", 1.0)) - 3.0) < 1e-3,
            f"GLB lost KHR_materials_emissive_strength: {strength_ext}",
        )

    expect(
        scene_snapshot() == before,
        "material bake compile did not restore the source scene exactly",
    )

    # --- A Component-owning object can refuse consolidation --------------
    shared_obj["blendlink_distinct_material"] = True
    distinct_plan = compiler.plan_materials(
        (tile_obj, shared_obj), purpose="final",
    )
    distinct_decision = next(
        item for item in distinct_plan.decisions
        if item.material_name == "Tiled Channels"
    )
    distinct_report = (distinct_decision.channel_plan or {})["consolidation"]
    expect(
        distinct_report["sharedMaterial"] is False
        and distinct_report.get("distinctObjects") == ["Tile Sibling"],
        f"the distinct opt-out must be named in the plan: {distinct_report}",
    )
    with tempfile.TemporaryDirectory(prefix="blendlink-distinct-") as directory:
        out_path = Path(directory) / "distinct.glb"
        _value, distinct_compilation = compiler.with_compiled_materials(
            distinct_plan,
            str(out_path),
            emit_selected([tile_obj, shared_obj]),
        )
        expect(
            len(distinct_compilation.generated_materials) == 2,
            f"a distinct binding must keep its own generated material: "
            f"{distinct_compilation.generated_materials}",
        )
    del shared_obj["blendlink_distinct_material"]

    leaked = [
        material.name for material in bpy.data.materials
        if material.name.startswith((
            compiler.GENERATED_MATERIAL_PREFIX,
            compiler.PRIVATE_CHANNEL_PREFIX,
        ))
    ] + [
        image.name for image in bpy.data.images
        if image.name.startswith("BLENDLINK_WEB_CHANNEL")
    ]
    expect(not leaked, f"material bake leaked datablocks: {leaked}")

    # --- Wrap gate refuses a non-period-1 tile at compile ----------------
    broken_obj = quad_object("Broken Tile Target", fixtures, uv_scale=3.0)
    broken_material, broken_tree, broken_principled = base_material(
        "Broken Tile",
    )
    broken_coord = broken_tree.nodes.new("ShaderNodeTexCoord")
    broken_noise = broken_tree.nodes.new("ShaderNodeTexNoise")
    broken_tree.links.new(
        broken_coord.outputs["UV"], broken_noise.inputs["Vector"],
    )
    broken_tree.links.new(
        broken_noise.outputs["Color"], broken_principled.inputs["Base Color"],
    )
    broken_obj.data.materials.append(broken_material)
    compiler.set_material_bake(broken_material, True)
    bpy.context.view_layer.update()

    broken_plan = compiler.plan_materials((broken_obj,), purpose="final")
    broken_decision = next(
        item for item in broken_plan.decisions
        if item.material_name == "Broken Tile"
    )
    expect(
        broken_decision.outcome == "lowered"
        and channel_record(broken_decision, "Base Color")["wrapGate"] is True,
        "UV noise must plan a gated tile candidate",
    )
    broken_before = scene_snapshot()
    with tempfile.TemporaryDirectory(prefix="blendlink-wrap-gate-") as directory:
        try:
            compiler.with_compiled_materials(
                broken_plan,
                str(Path(directory) / "broken.glb"),
                emit_selected([broken_obj]),
            )
        except compiler.MaterialCompileError as error:
            expect(
                "period-1" in str(error),
                f"wrap-gate refusal must name periodicity: {error}",
            )
        else:
            raise AssertionError(
                "a non-period-1 UV tile must refuse instead of publishing "
                "a wrong repeat"
            )
    expect(
        scene_snapshot() == broken_before,
        "wrap-gate refusal did not restore the source scene",
    )

    print("BLENDLINK_MATERIAL_BAKE_CHECK_PASSED")


if __name__ == "__main__":
    main()
