# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless addon test: register from source inside Blender, exercise the
operators on a scratch scene, assert the results, print a sentinel.

Run:  blender --background --factory-startup --python tests/run_headless.py --python-exit-code 1
"""
import copy
import hashlib
import importlib.util
import json
import math
import os
import struct
from contextlib import redirect_stdout
from io import StringIO
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bpy

ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_addon"


def load_addon():
    spec = importlib.util.spec_from_file_location(
        PACKAGE, ADDON_DIR / "__init__.py",
        submodule_search_locations=[str(ADDON_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    module.register()
    return module


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


class RecordingLayout:
    """Small bpy layout double for stable artist-facing text assertions."""

    def __init__(self, events=None):
        self.events = events if events is not None else []

    def row(self, **_kwargs):
        return RecordingLayout(self.events)

    def column(self, **_kwargs):
        return RecordingLayout(self.events)

    def box(self):
        return RecordingLayout(self.events)

    def label(self, *, text="", **_kwargs):
        self.events.append(("label", text))

    def operator(self, operator, *, text="", **_kwargs):
        self.events.append(("operator", operator, text))
        return SimpleNamespace()

    def operator_menu_enum(self, operator, prop, *, text="", **_kwargs):
        self.events.append(("operator_menu_enum", operator, prop, text))
        return SimpleNamespace()


def make_cube(name):
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def make_plane(name):
    """Create a dedicated single-face receiver with full-frame stock UV0."""
    bpy.ops.mesh.primitive_plane_add(size=2)
    obj = bpy.context.object
    obj.name = name
    return obj


def select_only(*objects):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[-1] if objects else None


def run_conformance(vocab):
    """Execute the SHARED vocabulary fixture — the same JSON vitest runs
    against vocabulary.ts. The hand-mirrored parsers drifted three ways
    once; this block is the Python half of the contract that stops it."""
    import json

    fixture_path = ADDON_DIR.parent / "blendlink" / "conformance" / "vocabulary.json"
    cases = json.loads(fixture_path.read_text(encoding="utf8"))["cases"]
    for index, case in enumerate(cases):
        result = vocab.classify(case["name"], case.get("extras"))
        expected = case["expect"]
        label = f"conformance[{index}] {case['name']}"
        if expected["kind"] == "none":
            expect(result is None, f"{label}: expected no classification, got {result}")
            continue
        expect(result is not None, f"{label}: expected {expected['kind']}, got None")
        expect(result.kind == expected["kind"],
               f"{label}: expected {expected['kind']}, got {result.kind}")
        if "shape" in expected:
            expect(result.shape == expected["shape"],
                   f"{label}: shape {result.shape} != {expected['shape']}")
        if "proxyOnly" in expected:
            expect(result.proxy_only == expected["proxyOnly"],
                   f"{label}: proxy_only {result.proxy_only} != {expected['proxyOnly']}")
        if "base" in expected and result.kind not in ("socket", "hotspot", "audio"):
            expect(result.base == expected["base"],
                   f"{label}: base {result.base!r} != {expected['base']!r}")
        if "lodIndex" in expected:
            expect(result.lod_index == expected["lodIndex"],
                   f"{label}: lod_index {result.lod_index} != {expected['lodIndex']}")
        if "anchorName" in expected:
            expect(result.anchor_name == expected["anchorName"],
                   f"{label}: anchor_name {result.anchor_name!r} != {expected['anchorName']!r}")
    print(f"conformance: {len(cases)} cases agree with vocabulary.ts")


def run_exporter_conformance(exporter):
    """Lock the exporter's filtering subset to the same shared fixture."""
    import json

    fixture_path = ADDON_DIR.parent / "blendlink" / "conformance" / "vocabulary.json"
    cases = json.loads(fixture_path.read_text(encoding="utf8"))["cases"]
    for index, case in enumerate(cases):
        expected = case["expect"]
        label = f"exporter conformance[{index}] {case['name']}"
        noimp = exporter.is_noimp_designation(case["name"], case.get("extras"))
        expect(noimp == (expected["kind"] == "noimp"),
               f"{label}: noimp filter disagrees with {expected}")
        collision_only = exporter.is_collision_proxy_designation(
            case["name"], case.get("extras"),
        )
        expected_collision_only = (
            expected["kind"] == "collider" and expected.get("proxyOnly") is True
        )
        expect(collision_only == expected_collision_only,
               f"{label}: collision-only filter disagrees with {expected}")

    pointer_issues = [
        {"object": "Animated Key", "reason": "light data values are animated or driven"},
        {"object": "World", "reason": "world values are animated or driven"},
    ]
    preview_warnings = exporter.enforce_pointer_animation_policy(
        {"draft": True, "authoringPreview": True}, pointer_issues, 17.25,
    )
    expect(
        len(preview_warnings) == len(pointer_issues)
        and all("PRIVATE PREVIEW ONLY" in warning for warning in preview_warnings)
        and "'Animated Key'" in preview_warnings[0]
        and "Blender frame 17.25" in preview_warnings[0]
        and "light data values are animated or driven" in preview_warnings[0]
        and "connected-site previews remain blocked" in preview_warnings[0]
        and "'World'" in preview_warnings[1],
        f"private Preview did not emit one loud current-frame warning per property: "
        f"{preview_warnings}",
    )
    expect(
        exporter.enforce_pointer_animation_policy(
            {"draft": True, "authoringPreview": True}, [], 17.25,
        ) == [],
        "private Preview invented a property-animation warning without an issue",
    )
    for label, settings in (
        ("Final", {"draft": False, "authoringPreview": True}),
        ("connected-site Preview", {"draft": True, "authoringPreview": False}),
        ("ordinary Final", {"draft": False, "authoringPreview": False}),
    ):
        try:
            exporter.enforce_pointer_animation_policy(settings, pointer_issues, 17.25)
        except SystemExit as error:
            message = str(error)
            expect(
                "KHR_animation_pointer" in message
                and "Animated Key: light data values are animated or driven" in message
                and "World: world values are animated or driven" in message,
                f"{label} property-animation blocker lost actionable detail: {message}",
            )
        else:
            raise AssertionError(
                f"{label} incorrectly accepted unsupported property animation"
            )

    scene = bpy.context.scene
    recipe_property = exporter.RECIPE_PROPERTY
    previous_recipe = scene.get(recipe_property)
    scene[recipe_property] = json.dumps({
        "schemaVersion": exporter.RECIPE_SCHEMA_VERSION,
        "presentation": "realtime",
        "atlases": [{
            "id": "main", "size": 2048, "targetDensity": 256,
            "margin": 16, "fitPolicy": "scale",
        }],
        "preview": {
            "samples": 16, "supersample": 1, "denoise": False,
            "resolutionScale": 0.25,
        },
        "final": {
            "samples": 128, "supersample": 1, "denoise": True,
            "resolutionScale": 1.0,
        },
        "optimization": {"geometry": "none"},
    })
    try:
        resolved, _recipe = exporter.resolve_scene_recipe({
            "draft": True, "authoringPreview": True,
        })
        expect(
            resolved.get("draft") is True
            and resolved.get("authoringPreview") is True,
            "scene-owned recipe discarded the private-Preview policy marker",
        )
    finally:
        if previous_recipe is None:
            del scene[recipe_property]
        else:
            scene[recipe_property] = previous_recipe
    print(f"exporter conformance: {len(cases)} cases agree with both vocabulary parsers")


def run_unsupported_renderable_export_test(exporter):
    """Nonempty drawing/hair nodes are not successful scene exports."""
    legacy_object = SimpleNamespace(
        name="Blendlink Legacy Drawing", type="GPENCIL",
        data=SimpleNamespace(layers=[SimpleNamespace(frames=[
            SimpleNamespace(frame_number=4, strokes=[object(), object()]),
        ])]),
    )
    expect(
        exporter.unsupported_renderable_issues([legacy_object]) == [{
            "code": "geometry.grease-pencil-unsupported",
            "object": legacy_object.name,
            "objectType": "GPENCIL",
            "storedFrames": 1,
            "nonemptyFrames": 1,
            "storedStrokes": 2,
            "storedPoints": 0,
        }],
        "legacy Blender Grease Pencil frame inspection drifted",
    )

    particle_host = make_cube("Blendlink Unsupported Legacy Path Hair")
    select_only(particle_host)
    bpy.ops.object.particle_system_add()
    particle_system = particle_host.particle_systems[-1]
    particle_settings = particle_system.settings
    particle_settings.type = "HAIR"
    particle_settings.render_type = "PATH"
    particle_settings.count = 8
    particle_settings.hair_length = 1.0
    particle_modifier = next(
        modifier for modifier in particle_host.modifiers
        if modifier.type == "PARTICLE_SYSTEM"
        and modifier.particle_system == particle_system
    )
    try:
        particle_issues = exporter.unsupported_renderable_issues([
            particle_host,
        ])
        expect(particle_issues == [{
            "code": "geometry.legacy-particle-path-unsupported",
            "object": particle_host.name,
            "objectType": "MESH",
            "system": particle_system.name,
            "particleType": "HAIR",
            "renderType": "PATH",
            "particleCount": 8,
            "hairSteps": int(particle_settings.hair_step),
            "childType": "NONE",
        }], f"legacy PATH particle evidence was incomplete: {particle_issues}")
        # GEO-EVAL-001: a childless in-budget PATH system realizes instead of
        # refusing; the gate stays silent and the plan names the route.
        exporter.enforce_supported_renderable_transport([particle_host])
        small_plan = exporter.realizable_renderable_plan([particle_host])
        expect(
            [item["kind"] for item in small_plan["realize"]]
            == ["particleStrands"]
            and not small_plan["refuse"],
            f"in-budget PATH particles must plan realization: {small_plan}",
        )

        particle_settings.count = 50_000
        try:
            exporter.enforce_supported_renderable_transport([particle_host])
        except SystemExit as error:
            particle_refusal = str(error)
        else:
            raise AssertionError(
                "over-budget legacy HAIR/PATH particles silently passed export planning"
            )
        expect(
            "Unsupported renderable geometry blocked" in particle_refusal
            and particle_host.name in particle_refusal
            and particle_system.name in particle_refusal
            and "legacy HAIR/PATH" in particle_refusal
            and "stock glTF" in particle_refusal
            and "ordinary mesh or card" in particle_refusal
            and "dedicated particle adapter" in particle_refusal
            and "realization budget" in particle_refusal,
            f"legacy PATH particle refusal lost its artist remedy: {particle_refusal}",
        )

        particle_settings.count = 8
        particle_settings.child_type = "SIMPLE"
        try:
            exporter.enforce_supported_renderable_transport([particle_host])
        except SystemExit as error:
            children_refusal = str(error)
        else:
            raise AssertionError(
                "children-configured HAIR/PATH particles silently passed export planning"
            )
        expect(
            "children" in children_refusal,
            f"children refusal must be named: {children_refusal}",
        )
        particle_settings.child_type = "NONE"
        particle_settings.count = 8

        with tempfile.TemporaryDirectory(prefix="blendlink-particle-path-") as tmp:
            output = str(Path(tmp) / "unsupported.glb")
            kwargs, _dropped = exporter.gltf_export_contract(output, {
                "exporterOverrides": {"use_selection": True},
            })
            result = bpy.ops.export_scene.gltf(**kwargs)
            expect("FINISHED" in result, f"stock particle PATH probe failed: {result}")
            document, _chunks, _json_index = exporter._read_glb_document(
                output, "inspect unsupported legacy PATH particles",
            )
            host_node = next(
                item for item in document.get("nodes", [])
                if item.get("name") == particle_host.name
            )
            expect(
                "mesh" in host_node
                and len(document.get("meshes", [])) == 1
                and len(document["meshes"][host_node["mesh"]].get("primitives", [])) == 1,
                "stock exporter unexpectedly gained legacy PATH geometry; "
                "re-evaluate Blendlink's refusal",
            )

        particle_modifier.show_render = False
        expect(
            exporter.unsupported_renderable_issues([particle_host]) == [],
            "render-disabled legacy PATH particles incorrectly blocked export",
        )
    finally:
        bpy.data.objects.remove(particle_host, do_unlink=True)
        if particle_settings.name in bpy.data.particles:
            bpy.data.particles.remove(particle_settings)

    hair_curves = getattr(bpy.data, "hair_curves", None)
    if hair_curves is not None:
        hair_data = hair_curves.new("Blendlink Unsupported Hair Data")
        hair_data.add_curves([3])
        for point, position in zip(
            hair_data.points,
            ((0.0, 0.0, 0.0), (0.0, 0.0, 0.5), (0.1, 0.0, 1.0)),
        ):
            point.position = position
        hair_material = bpy.data.materials.new("Blendlink Unsupported Hair Material")
        hair_data.materials.append(hair_material)
        hair_object = bpy.data.objects.new("Blendlink Unsupported Hair", hair_data)
        empty_hair_data = hair_curves.new("Blendlink Empty Hair Data")
        empty_hair_object = bpy.data.objects.new(
            "Blendlink Empty Hair", empty_hair_data,
        )
        bpy.context.scene.collection.objects.link(hair_object)
        bpy.context.scene.collection.objects.link(empty_hair_object)
        selected_before_hair = list(bpy.context.selected_objects)
        active_before_hair = bpy.context.view_layer.objects.active
        try:
            bpy.context.view_layer.update()
            hair_issues = exporter.unsupported_renderable_issues(
                [empty_hair_object, hair_object],
            )
            expect(hair_issues == [{
                "code": "geometry.hair-curves-unsupported",
                "object": hair_object.name,
                "objectType": "CURVES",
                "authoredCurves": 1,
                "authoredPoints": 3,
                "evaluatedCurves": 1,
                "evaluatedPoints": 3,
            }], f"Hair Curves transport evidence was incomplete: {hair_issues}")
            # GEO-EVAL-001: in-budget Hair Curves realize instead of refusing.
            exporter.enforce_supported_renderable_transport(
                [empty_hair_object, hair_object],
            )
            hair_plan = exporter.realizable_renderable_plan(
                [empty_hair_object, hair_object],
            )
            expect(
                [item["kind"] for item in hair_plan["realize"]]
                == ["hairCurves"]
                and not hair_plan["refuse"],
                f"in-budget Hair Curves must plan realization: {hair_plan}",
            )

            select_only(hair_object)
            with tempfile.TemporaryDirectory(prefix="blendlink-hair-curves-") as tmp:
                output = str(Path(tmp) / "unsupported.glb")
                kwargs, _dropped = exporter.gltf_export_contract(output, {
                    "exporterOverrides": {"use_selection": True},
                })
                hair_sidecar = {"diagnostics": {}}
                exporter.plan_export_materials(
                    {"draft": False, "mode": "standard"},
                    hair_sidecar,
                    kwargs,
                )
                expect(
                    [
                        item["kind"] for item in hair_sidecar["diagnostics"]
                        .get("realizedGeometry", {}).get("realize", [])
                    ] == ["hairCurves"],
                    "planning did not report the Hair Curves realization route",
                )
                result = bpy.ops.export_scene.gltf(**kwargs)
                expect("FINISHED" in result, f"stock Hair Curves probe failed: {result}")
                document, _chunks, _json_index = exporter._read_glb_document(
                    output, "inspect unsupported Hair Curves",
                )
                node = next(
                    item for item in document.get("nodes", [])
                    if item.get("name") == hair_object.name
                )
                expect(
                    "mesh" not in node,
                    "stock exporter unexpectedly gained Hair Curves mesh transport; "
                    "re-evaluate Blendlink's refusal",
                )

                hair_object.hide_render = True
                scoped = exporter.diagnostic_export_objects(
                    bpy.context.scene,
                    view_layer=bpy.context.view_layer,
                    export_kwargs=kwargs,
                )
                expect(
                    hair_object not in scoped
                    and exporter.unsupported_renderable_issues(scoped) == [],
                    "render-hidden Hair Curves incorrectly blocked the export scope",
                )
                hair_object.hide_render = False
            print("unsupported renderable: stock GLB kept the hair node without a mesh")
        finally:
            bpy.data.objects.remove(hair_object, do_unlink=True)
            bpy.data.objects.remove(empty_hair_object, do_unlink=True)
            bpy.data.hair_curves.remove(hair_data)
            bpy.data.hair_curves.remove(empty_hair_data)
            bpy.data.materials.remove(hair_material)
            select_only(*[
                obj for obj in selected_before_hair if obj.name in bpy.data.objects
            ])
            if (
                active_before_hair is not None
                and active_before_hair.name in bpy.data.objects
            ):
                bpy.context.view_layer.objects.active = active_before_hair
    else:
        print("unsupported renderable: current Blender has no Hair Curves API")

    grease_pencils = getattr(bpy.data, "grease_pencils", None)
    if grease_pencils is None:
        print("unsupported renderable: current Blender has no Grease Pencil 3 API")
        return

    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    drawing_data = grease_pencils.new("Blendlink Unsupported Drawing Data")
    drawing_object = bpy.data.objects.new(
        "Blendlink Unsupported Drawing", drawing_data,
    )
    empty_data = grease_pencils.new("Blendlink Empty Drawing Data")
    empty_object = bpy.data.objects.new("Blendlink Empty Drawing", empty_data)
    bpy.context.scene.collection.objects.link(drawing_object)
    bpy.context.scene.collection.objects.link(empty_object)
    try:
        layer = drawing_data.layers.new("Visible Art", set_active=True)
        frame = layer.frames.new(1)
        frame.drawing.add_strokes([2, 3])
        issues = exporter.unsupported_renderable_issues(
            [empty_object, drawing_object],
        )
        expect(
            issues == [{
                "code": "geometry.grease-pencil-unsupported",
                "object": drawing_object.name,
                "objectType": "GREASEPENCIL",
                "storedFrames": 1,
                "nonemptyFrames": 1,
                "storedStrokes": 2,
                "storedPoints": 5,
            }],
            f"Grease Pencil transport evidence was incomplete: {issues}",
        )
        # GEO-EVAL-001: in-budget Grease Pencil realizes instead of refusing.
        exporter.enforce_supported_renderable_transport(
            [empty_object, drawing_object],
        )
        drawing_plan = exporter.realizable_renderable_plan(
            [empty_object, drawing_object],
        )
        expect(
            [item["kind"] for item in drawing_plan["realize"]]
            == ["greasePencil"]
            and not drawing_plan["refuse"],
            f"in-budget Grease Pencil must plan realization: {drawing_plan}",
        )

        select_only(drawing_object)
        with tempfile.TemporaryDirectory(prefix="blendlink-grease-pencil-") as tmp:
            output = str(Path(tmp) / "unsupported.glb")
            kwargs, _dropped = exporter.gltf_export_contract(output, {
                "exporterOverrides": {"use_selection": True},
            })
            drawing_sidecar = {"diagnostics": {}}
            exporter.plan_export_materials(
                {"draft": False, "mode": "standard"},
                drawing_sidecar,
                kwargs,
            )
            expect(
                [
                    item["kind"] for item in drawing_sidecar["diagnostics"]
                    .get("realizedGeometry", {}).get("realize", [])
                ] == ["greasePencil"],
                "planning did not report the Grease Pencil realization route",
            )
            result = bpy.ops.export_scene.gltf(**kwargs)
            expect("FINISHED" in result, f"stock Grease Pencil probe failed: {result}")
            document, _chunks, _json_index = exporter._read_glb_document(
                output, "inspect unsupported Grease Pencil",
            )
            node = next(
                item for item in document.get("nodes", [])
                if item.get("name") == drawing_object.name
            )
            expect(
                "mesh" not in node,
                "stock exporter unexpectedly gained Grease Pencil mesh transport; "
                "re-evaluate Blendlink's refusal",
            )

            drawing_object.hide_render = True
            scoped = exporter.diagnostic_export_objects(
                bpy.context.scene, view_layer=bpy.context.view_layer,
                export_kwargs=kwargs,
            )
            expect(
                drawing_object not in scoped
                and exporter.unsupported_renderable_issues(scoped) == [],
                "render-hidden Grease Pencil incorrectly blocked the export scope",
            )
            drawing_object.hide_render = False
        print("unsupported renderable: stock GLB kept the drawing node without a mesh")
    finally:
        bpy.data.objects.remove(drawing_object, do_unlink=True)
        bpy.data.objects.remove(empty_object, do_unlink=True)
        bpy.data.grease_pencils.remove(drawing_data)
        bpy.data.grease_pencils.remove(empty_data)
        select_only(*[
            obj for obj in selected_before if obj.name in bpy.data.objects
        ])
        if active_before is not None and active_before.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = active_before


def run_deformer_lowering_tests(procedural):
    """Phase 1: SurfaceDeform -> glTF skin weights, predicate then measurement.

    Built as a synthetic rig rather than against ellie so the assertions can
    name exact outcomes.  The positive case is a cage that moves rigidly, where
    "static bind composed with LBS is LBS with derived weights" is exactly
    true, so the measured residual pins the derivation and the oracle rather
    than the accident of one character's cage resolution.
    """
    scene = bpy.context.scene
    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    created = []
    rig_data = bpy.data.armatures.new("Lowering Rig")
    rig = bpy.data.objects.new("Lowering Rig", rig_data)
    scene.collection.objects.link(rig)
    created.append(rig)
    try:
        select_only(rig)
        bpy.ops.object.mode_set(mode="EDIT")
        deform_bone = rig_data.edit_bones.new("DEF-Jaw")
        deform_bone.head, deform_bone.tail = (0.0, 0.0, 0.0), (0.0, 0.0, 1.0)
        control_bone = rig_data.edit_bones.new("CTRL-Jaw")
        control_bone.head, control_bone.tail = (1.0, 0.0, 0.0), (1.0, 0.0, 1.0)
        bpy.ops.object.mode_set(mode="OBJECT")
        rig_data.bones["CTRL-Jaw"].use_deform = False
        posed = rig.pose.bones["DEF-Jaw"]
        for frame, offset in ((1, 0.0), (10, 0.6)):
            posed.location = (0.0, offset, 0.0)
            posed.keyframe_insert("location", frame=frame)
        scene.frame_set(1)

        def build_pair(label, *, group="DEF-Jaw", parent=True):
            cage = make_cube(f"{label} Cage")
            created.append(cage)
            weights = cage.vertex_groups.new(name=group)
            weights.add(
                [vertex.index for vertex in cage.data.vertices], 1.0, "REPLACE",
            )
            cage.modifiers.new("Armature", "ARMATURE").object = rig
            bound = make_cube(f"{label} Bound")
            created.append(bound)
            bound.scale = (0.4, 0.4, 0.4)
            bpy.context.view_layer.update()
            if parent:
                bound.parent = rig
            select_only(bound)
            bind = bound.modifiers.new("SurfaceDeform", "SURFACE_DEFORM")
            bind.target = cage
            bpy.ops.object.surfacedeform_bind(modifier=bind.name)
            bpy.context.view_layer.update()
            return cage, bound, bind

        def plan_for(*objects):
            return procedural.deformer_lowering_plan(
                scene, objects=tuple(objects) + (rig,),
            )

        def record_for(plan, name):
            for key in ("lower", "refuse"):
                for item in plan[key]:
                    if item["object"] == name:
                        return item
            return None

        cage, bound, bind = build_pair("Lowering")
        expect(
            bind.is_bound,
            "the synthetic SurfaceDeform never bound, so nothing below is a test",
        )
        expect(
            [item["object"] for item in procedural.frozen_deformer_issues(
                scene, objects=(cage, bound, rig),
            )] == [bound.name],
            "Phase 0a did not name the synthetic bound mesh as frozen",
        )

        # 1. The depsgraph-free predicate admits it, and says so as a proposal.
        plan = plan_for(cage, bound)
        planned = record_for(plan, bound.name)
        expect(
            plan["verified"] is False
            and planned is not None
            and planned["outcome"] == "planned"
            and planned["joints"] == ["DEF-Jaw"]
            and planned["target"] == cage.name
            and planned["armature"] == rig.name,
            f"the lowering predicate did not admit a skinned cage: {planned}",
        )

        # 2. The measurement scores it, and the authored scene is untouched
        #    afterwards -- mesh identity, vertex groups, stack and datablock
        #    count all included.
        before = (
            bound.data.as_pointer(), bound.data.name,
            [group.name for group in bound.vertex_groups],
            [(item.type, item.name, item.show_viewport)
             for item in bound.modifiers],
            len(bpy.data.meshes),
        )
        derivations = procedural.verify_deformer_lowerings(scene, plan)
        after = (
            bound.data.as_pointer(), bound.data.name,
            [group.name for group in bound.vertex_groups],
            [(item.type, item.name, item.show_viewport)
             for item in bound.modifiers],
            len(bpy.data.meshes),
        )
        expect(
            before == after,
            f"measuring the lowering modified the authored scene: "
            f"{before} -> {after}",
        )
        measured = record_for(plan, bound.name)
        expect(
            plan["verified"] is True
            and measured["outcome"] == "lowered"
            and measured["severity"] == "info"
            and measured["exhaustive"] is True
            and measured["sampledFrames"] == 11
            and measured["exportedInfluences"] == 1
            and measured["residual"] < measured["frozenDeviation"]
            and measured["improvementRatio"] > 10.0
            and measured["residualFraction"] < 0.01
            and "was lowered to glTF skin weights" in measured["message"]
            and "if it shipped as a static prop" in measured["message"],
            f"a rigidly-moving cage did not measure as an accurate lowering: "
            f"{measured}",
        )
        expect(
            [item["object"] for item in derivations] == [bound.name],
            f"verification returned the wrong derivations: {derivations}",
        )

        # 3. Install for real, then restore exactly.
        installed = procedural.prepare_lowered_skins(derivations)
        expect(
            [(item.type, item.name, item.show_viewport)
             for item in bound.modifiers]
            == [("ARMATURE", "BLENDLINK_LOWERED_ARMATURE", True),
                ("SURFACE_DEFORM", "SurfaceDeform", False)]
            and [group.name for group in bound.vertex_groups] == ["DEF-Jaw"]
            and bound.data.name == before[1]
            and bound.data.as_pointer() != before[0],
            f"the installed lowering is not an ARMATURE over a muted bind on a "
            f"private mesh: "
            f"{[(m.type, m.name, m.show_viewport) for m in bound.modifiers]}",
        )
        procedural.restore_lowered_skins(installed)
        expect(
            (bound.data.as_pointer(), bound.data.name,
             [group.name for group in bound.vertex_groups],
             [(item.type, item.name, item.show_viewport)
              for item in bound.modifiers],
             len(bpy.data.meshes)) == before,
            "restore_lowered_skins did not put the authored scene back exactly",
        )

        # 4. A failure part-way through installation rolls the whole batch back.
        broken = [
            dict(derivations[0]),
            {**derivations[0], "object": "No Such Mesh"},
        ]
        raised = None
        try:
            procedural.prepare_lowered_skins(broken)
        except RuntimeError as error:
            raised = str(error)
        expect(
            raised is not None and "No Such Mesh" in raised
            and (bound.data.as_pointer(), [g.name for g in bound.vertex_groups],
                 [(m.type, m.name, m.show_viewport) for m in bound.modifiers],
                 len(bpy.data.meshes))
            == (before[0], before[2], before[3], before[4]),
            f"a half-installed lowering leaked into the authored scene: "
            f"{raised}",
        )

        # 5. Structural refusals the residual could never catch.  A post-bind
        #    LATTICE measures ~0 on ellie's zippers across the whole assigned
        #    clip and still breaks the lowering.
        lattice_data = bpy.data.lattices.new("Lowering Lattice")
        lattice = bpy.data.objects.new("Lowering Lattice", lattice_data)
        scene.collection.objects.link(lattice)
        created.append(lattice)
        post = bound.modifiers.new("Lattice", "LATTICE")
        post.object = lattice
        refused = record_for(plan_for(cage, bound, lattice), bound.name)
        expect(
            refused["outcome"] == "refused"
            and "run after 'SurfaceDeform'" in refused["reason"]
            and "'Lattice' (lattice)" in refused["reason"],
            f"a post-bind LATTICE was not refused on shape: {refused}",
        )
        bound.modifiers.remove(post)

        # 6. A cage weighted to a non-deform bone would have its weight
        #    silently reassigned to a fabricated neutral joint.
        stray = cage.vertex_groups.new(name="CTRL-Jaw")
        stray.add([0], 0.5, "REPLACE")
        refused = record_for(plan_for(cage, bound), bound.name)
        expect(
            refused["outcome"] == "refused"
            and "'CTRL-Jaw'" in refused["reason"]
            and "Deform switched off" in refused["reason"],
            f"a non-deform-bone cage group was not refused: {refused}",
        )
        cage.vertex_groups.remove(stray)

        # 7. Two binds, an unparented mesh, and a name collision.
        second = bound.modifiers.new("SurfaceDeform Alternate", "SURFACE_DEFORM")
        second.target = cage
        refused = record_for(plan_for(cage, bound), bound.name)
        expect(
            refused["outcome"] == "refused"
            and "2 bind modifiers" in refused["reason"],
            f"a branching pair of binds was not refused: {refused}",
        )
        bound.modifiers.remove(second)

        collision = bound.vertex_groups.new(name="DEF-Jaw")
        refused = record_for(plan_for(cage, bound), bound.name)
        expect(
            refused["outcome"] == "refused"
            and "already carries vertex group" in refused["reason"],
            f"a colliding authored vertex group was not refused: {refused}",
        )
        bound.vertex_groups.remove(collision)

        _orphan_cage, orphan, _orphan_bind = build_pair(
            "Orphan Lowering", parent=False,
        )
        refused = record_for(plan_for(_orphan_cage, orphan), orphan.name)
        expect(
            refused["outcome"] == "refused"
            and "tree.py:246-260" in refused["reason"],
            f"an unparented bound mesh was not refused: {refused}",
        )

        # 8. The predicate is back to admitting the clean pair, so none of the
        #    refusals above left state behind.
        expect(
            record_for(plan_for(cage, bound), bound.name)["outcome"]
            == "planned",
            "the clean pair stopped being lowerable after the refusal cases",
        )

        # 9. The measured bands. A cage that bends instead of moving rigidly
        #    breaks weight homogeneity, which is where the identity stops being
        #    exact -- so this is the case only a measurement can decide, and
        #    the one a "is the cage pure LBS?" predicate would get wrong.
        bend_rig_data = bpy.data.armatures.new("Bending Rig")
        bend_rig = bpy.data.objects.new("Bending Rig", bend_rig_data)
        scene.collection.objects.link(bend_rig)
        created.append(bend_rig)
        select_only(bend_rig)
        bpy.ops.object.mode_set(mode="EDIT")
        root = bend_rig_data.edit_bones.new("DEF-Root")
        root.head, root.tail = (0.0, 0.0, -1.0), (0.0, 0.0, 0.0)
        tip = bend_rig_data.edit_bones.new("DEF-Tip")
        tip.head, tip.tail = (0.0, 0.0, 0.0), (0.0, 0.0, 1.0)
        tip.parent = root
        bpy.ops.object.mode_set(mode="OBJECT")

        def build_bending_pair(label, degrees, *, smooth):
            if bend_rig.animation_data and bend_rig.animation_data.action:
                bpy.data.actions.remove(bend_rig.animation_data.action)
            hinge = bend_rig.pose.bones["DEF-Tip"]
            hinge.rotation_mode = "XYZ"
            for frame, angle in ((1, 0.0), (10, math.radians(degrees))):
                hinge.rotation_euler = (angle, 0.0, 0.0)
                hinge.keyframe_insert("rotation_euler", frame=frame)
            scene.frame_set(1)
            bend_cage = make_cube(f"{label} Cage")
            created.append(bend_cage)
            low = bend_cage.vertex_groups.new(name="DEF-Root")
            high = bend_cage.vertex_groups.new(name="DEF-Tip")
            for vertex in bend_cage.data.vertices:
                share = 0.5 + 0.5 * max(-1.0, min(1.0, vertex.co.z))
                high.add([vertex.index], share, "REPLACE")
                low.add([vertex.index], 1.0 - share, "REPLACE")
            bend_cage.modifiers.new("Armature", "ARMATURE").object = bend_rig
            if smooth:
                relax = bend_cage.modifiers.new(
                    "CorrectiveSmooth", "CORRECTIVE_SMOOTH",
                )
                relax.factor, relax.iterations = 0.9, 12
            bend_bound = make_cube(f"{label} Bound")
            created.append(bend_bound)
            bend_bound.scale = (0.6, 0.6, 0.6)
            bend_bound.parent = bend_rig
            bpy.context.view_layer.update()
            select_only(bend_bound)
            hinge_bind = bend_bound.modifiers.new(
                "SurfaceDeform", "SURFACE_DEFORM",
            )
            hinge_bind.target = bend_cage
            bpy.ops.object.surfacedeform_bind(modifier=hinge_bind.name)
            bpy.context.view_layer.update()
            bend_plan = procedural.deformer_lowering_plan(
                scene, objects=(bend_cage, bend_bound, bend_rig),
            )
            procedural.verify_deformer_lowerings(scene, bend_plan)
            return record_for(bend_plan, bend_bound.name)

        warned = build_bending_pair("Warn Band", 10.0, smooth=True)
        expect(
            warned["outcome"] == "lowered"
            and warned["severity"] == "warn"
            and 0.01 < warned["residualFraction"] <= 0.10
            and warned["targetPerturbation"] > 0.0
            and "corrective smooth" in warned["message"]
            and "accounts for" in warned["message"]
            and "above the 1% agreement line" in warned["message"],
            f"a 1-10% lowering did not warn with a leave-one-out attribution: "
            f"{warned}",
        )
        refused = build_bending_pair("Refuse Band", 45.0, smooth=True)
        expect(
            refused["outcome"] == "refused"
            and refused["severity"] == "refuse"
            and refused["residualFraction"] > 0.10
            # It IS an improvement on the frozen prop and is refused anyway:
            # "better than catastrophic" is not a publishable standard.
            and refused["improvementRatio"] > 1.0
            and "above the 10% refusal line" in refused["reason"],
            f"a >10% lowering was not refused: {refused}",
        )
        print("deformer lowering: SurfaceDeform lowered to skin weights, "
              "measured, and every structural refusal held")
    finally:
        for obj in reversed(created):
            data = obj.data
            if bpy.data.objects.get(obj.name) is obj:
                bpy.data.objects.remove(obj, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
        if bpy.data.armatures.get(rig_data.name) is rig_data \
                and rig_data.users == 0:
            bpy.data.armatures.remove(rig_data)
        select_only(*[
            obj for obj in selected_before if obj.name in bpy.data.objects
        ])
        if active_before is not None and active_before.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = active_before


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    props = sys.modules[f"{PACKAGE}.props"]
    vocab = sys.modules[f"{PACKAGE}.vocab"]
    validation = sys.modules[f"{PACKAGE}.validation"]
    procedural_module = sys.modules[f"{PACKAGE}.procedural"]
    ui = sys.modules[f"{PACKAGE}.ui"]
    ops = sys.modules[f"{PACKAGE}.ops"]
    syncstatus = sys.modules[f"{PACKAGE}.syncstatus"]
    handlers = sys.modules[f"{PACKAGE}.handlers"]
    previewrun = sys.modules[f"{PACKAGE}.previewrun"]
    syncrun = sys.modules[f"{PACKAGE}.syncrun"]
    presentation = sys.modules[f"{PACKAGE}.presentation"]
    presentation_ui = sys.modules[f"{PACKAGE}.presentation_ui"]
    ui_state = sys.modules[f"{PACKAGE}.ui_state"]
    weblights = sys.modules[f"{PACKAGE}.weblights"]
    known_issues = sys.modules[f"{PACKAGE}.known_issues"]
    ownership = sys.modules[f"{PACKAGE}.ownership"]
    nla_sequence_module = sys.modules[f"{PACKAGE}.nla_sequence"]
    components_ui = sys.modules.get(f"{PACKAGE}.components_ui")
    component_schema = sys.modules.get(f"{PACKAGE}.component_schema")
    component_validation = sys.modules.get(f"{PACKAGE}.component_validation")
    consequence_gizmos = sys.modules.get(f"{PACKAGE}.consequence_gizmos")
    run_conformance(vocab)

    # Portable Components are real registered RNA, not an untyped JSON field
    # bolted onto the export step.  This catches both a missing PropertyGroup
    # registration and a missing Scene collection pointer.
    expect(getattr(props.BlendlinkComponentSettings, "is_registered", False)
           and bpy.types.PropertyGroup.bl_rna_get_subclass_py(
               "BlendlinkComponentSettings"
           ) is props.BlendlinkComponentSettings,
           "portable Component PropertyGroup was not registered")
    expect(hasattr(bpy.context.scene.blendlink_project, "components")
           and bpy.context.scene.blendlink_project.bl_rna.properties["components"].type
           == "COLLECTION",
           "BlendlinkProjectSettings did not register its Components collection")

    # The workspace is intentionally shallow: publish/check actions stay in
    # the 3D View, while authored detail lives beside Blender's native data.
    panel_locations = (
        (ui.BLENDLINK_PT_main, "VIEW_3D", "UI", None),
        (ui.BLENDLINK_PT_project, "PROPERTIES", "WINDOW", "scene"),
        (ui.BLENDLINK_PT_atlases, "PROPERTIES", "WINDOW", "scene"),
        (ui.BLENDLINK_PT_bake_quality, "PROPERTIES", "WINDOW", "scene"),
        (ui.BLENDLINK_PT_lighting_states, "PROPERTIES", "WINDOW", "scene"),
        (ui.BLENDLINK_PT_look, "PROPERTIES", "WINDOW", "world"),
        (ui.BLENDLINK_PT_designation, "PROPERTIES", "WINDOW", "object"),
        (ui.BLENDLINK_PT_textures, "PROPERTIES", "WINDOW", "material"),
        (ui.BLENDLINK_PT_web_light, "PROPERTIES", "WINDOW", "data"),
        (presentation_ui.BLENDLINK_PT_visual_references,
         "PROPERTIES", "WINDOW", "scene"),
    )
    for panel, space, region, context in panel_locations:
        actual = (
            panel.bl_space_type,
            panel.bl_region_type,
            getattr(panel, "bl_context", "") or None,
        )
        expect(actual == (space, region, context),
               f"{panel.bl_idname} registered in the wrong editor context: {actual}")
    expect(ui.BLENDLINK_PT_camera.bl_parent_id == "BLENDLINK_PT_project"
           and ui.BLENDLINK_PT_atlases.bl_parent_id == "BLENDLINK_PT_project"
           and ui.BLENDLINK_PT_bake_quality.bl_parent_id == "BLENDLINK_PT_project"
           and ui.BLENDLINK_PT_lighting_states.bl_parent_id == "BLENDLINK_PT_project"
           and ui.BLENDLINK_PT_environment.bl_parent_id == "BLENDLINK_PT_look"
           and ui.BLENDLINK_PT_tag.bl_parent_id == "BLENDLINK_PT_designation"
           and presentation_ui.BLENDLINK_PT_visual_references.bl_parent_id
           == "BLENDLINK_PT_camera",
           "native Properties panel hierarchy drifted")
    expect("invoke" in ops.BLENDLINK_OT_set_texel_weight.__dict__,
           "Lightmap Scale must ask for the value before applying a batch edit")
    expect("invoke" not in ops.BLENDLINK_OT_open_derived_asset.__dict__,
           "Open Saved Image must not show an empty properties dialog")
    for operator in (
        ops.BLENDLINK_OT_open_preview_log,
        ops.BLENDLINK_OT_open_sync_log,
        presentation_ui.BLENDLINK_OT_open_reference_folder,
    ):
        poll_names = operator.poll.__func__.__code__.co_names
        expect("exists" not in poll_names,
               f"{operator.bl_idname} performs filesystem I/O while Blender draws")
    expect(
        "BLENDLINK_OT_build_reference_matrix"
        not in presentation_ui.BLENDLINK_OT_capture_reference_matrix.poll.__func__.__code__.co_names,
        "Capture Blender References delegates its tooltip to the wrong operator class",
    )

    # Area-light portability is automatic in the native Light Data tab, with
    # persistent Bake Only and Three Rect Area artist overrides. Automatic is
    # represented by absence of the namespaced property so old files acquire
    # the supported default without migration.
    authoring_area_data = bpy.data.lights.new(
        "Blendlink Area Authoring Data", type="AREA",
    )
    authoring_area = bpy.data.objects.new(
        "Blendlink Area Authoring", authoring_area_data,
    )
    bpy.context.scene.collection.objects.link(authoring_area)
    try:
        select_only(authoring_area)
        default_layout = RecordingLayout()
        expect(
            ui._draw_web_area_light_mode(default_layout, authoring_area)
            and any(
                event[0] == "operator_menu_enum"
                and event[1] == "blendlink.set_area_light_mode"
                and event[2] == "mode"
                and event[3] == "Automatic (Default)"
                for event in default_layout.events
            ),
            f"Area-light default choice was absent from Light Data UI: {default_layout.events}",
        )
        expect(
            weblights.AREA_LIGHT_MODE_PROPERTY not in authoring_area,
            "Automatic Area mode unexpectedly authored a migration property",
        )
        expect(
            bpy.ops.blendlink.set_area_light_mode(
                mode="BAKE_ONLY", object_name=authoring_area.name,
            ) == {"FINISHED"}
            and authoring_area.get(weblights.AREA_LIGHT_MODE_PROPERTY)
            == weblights.AREA_LIGHT_MODE_BAKE_ONLY,
            "Bake Only Area override did not persist its namespaced mode",
        )
        validation.recompute(bpy.context.scene)
        bake_only_diagnostic = validation.result().light_diagnostics[
            authoring_area.name
        ]
        bake_only_layout = RecordingLayout()
        ui._draw_web_area_light_mode(bake_only_layout, authoring_area)
        expect(
            bake_only_diagnostic["outcome"] == weblights.OUTCOME_BAKE_ONLY
            and any(
                event[0] == "operator_menu_enum"
                and event[3] == "Bake Only"
                for event in bake_only_layout.events
            ),
            "explicit Bake Only Area mode was not stable across validation/UI: "
            f"{bake_only_diagnostic}, {bake_only_layout.events}",
        )
        expect(
            bpy.ops.blendlink.set_area_light_mode(
                mode="THREE_RECT_AREA", object_name=authoring_area.name,
            ) == {"FINISHED"}
            and authoring_area.get(weblights.AREA_LIGHT_MODE_PROPERTY)
            == weblights.AREA_LIGHT_MODE_THREE_RECT,
            "Area-light opt-in operator did not author the namespaced exact mode",
        )
        validation.recompute(bpy.context.scene)
        authored_diagnostic = validation.result().light_diagnostics[
            authoring_area.name
        ]
        authored_fidelity = [
            item for item in validation.result().fidelity
            if item.object_name == authoring_area.name
            and item.route == "Runtime"
        ]
        expect(
            authored_diagnostic["outcome"] == weblights.OUTCOME_APPROXIMATED
            and authored_fidelity
            and not authored_fidelity[0].blocking,
            "valid Area opt-in deadlocked interactive validation before export: "
            f"{authored_diagnostic}, {authored_fidelity}",
        )
        enabled_layout = RecordingLayout()
        ui._draw_web_area_light_mode(enabled_layout, authoring_area)
        expect(any(
            event[0] == "operator_menu_enum"
            and event[3] == "Three Rect Area (Approximation)"
            for event in enabled_layout.events
        ), f"Area-light enabled choice was not visible: {enabled_layout.events}")
        expect(
            bpy.ops.blendlink.set_area_light_mode(
                mode="AUTO", object_name=authoring_area.name,
            ) == {"FINISHED"}
            and weblights.AREA_LIGHT_MODE_PROPERTY not in authoring_area,
            "Automatic Area choice left a stale authored override",
        )
        validation.recompute(bpy.context.scene)
        automatic_diagnostic = validation.result().light_diagnostics[
            authoring_area.name
        ]
        automatic_layout = RecordingLayout()
        ui._draw_web_area_light_mode(automatic_layout, authoring_area)
        expect(
            automatic_diagnostic["outcome"] == weblights.OUTCOME_APPROXIMATED
            and any(
                event[0] == "operator_menu_enum"
                and event[3] == "Automatic (Default)"
                for event in automatic_layout.events
            ),
            "Automatic Area mode was not restored across validation/UI: "
            f"{automatic_diagnostic}, {automatic_layout.events}",
        )
    finally:
        bpy.data.objects.remove(authoring_area, do_unlink=True)
        bpy.data.lights.remove(authoring_area_data)
    redraw_constants = handlers._tag_redraw_ui.__code__.co_consts
    expect(any(
        value == "PROPERTIES"
        or (isinstance(value, frozenset) and "PROPERTIES" in value)
        for value in redraw_constants
    ),
           "cached UI changes must redraw native Properties panels as well as the 3D View")
    redo_post = getattr(bpy.app.handlers, "redo_post", None)
    if redo_post is not None:
        expect(handlers._history_post in redo_post,
               "Redo did not register the same cache invalidation as Undo")
    popup_result = {"RUNNING_MODAL"}
    popup_context = SimpleNamespace(window_manager=SimpleNamespace(
        invoke_search_popup=lambda _operator: popup_result,
    ))
    expect(
        ops.BLENDLINK_OT_add_state_hidden_collection.invoke(
            SimpleNamespace(), popup_context, None,
        ) == popup_result,
        "lighting-state collection search discarded its modal lifecycle",
    )

    # Thumbnail preparation runs from the shared timer. A transient Blender
    # preview failure must stay retryable instead of memoizing a placeholder.
    class RetryPreviewImage:
        name = "Retry Thumbnail"

        def __init__(self):
            self.attempts = 0

        def as_pointer(self):
            return 202

        def preview_ensure(self):
            self.attempts += 1
            if self.attempts == 1:
                raise RuntimeError("preview is temporarily unavailable")

    retry_image = RetryPreviewImage()
    retry_material = SimpleNamespace(as_pointer=lambda: 101)
    retry_context = SimpleNamespace(material=retry_material, active_object=None)
    original_images_for_material = ui._images_for_material
    original_material_preview_token = ui._material_preview_token
    ui._images_for_material = lambda _material: [(retry_image, "Retry Material")]
    ui._material_preview_token = None
    preview_log = StringIO()
    try:
        with redirect_stdout(preview_log):
            first_preview = ui.prepare_active_material_previews(retry_context)
        token_after_failure = ui._material_preview_token
        second_preview = ui.prepare_active_material_previews(retry_context)
        token_after_success = ui._material_preview_token
        third_preview = ui.prepare_active_material_previews(retry_context)
    finally:
        ui._images_for_material = original_images_for_material
        ui._material_preview_token = original_material_preview_token
    expect(not first_preview and token_after_failure is None
           and second_preview and token_after_success == (101, (202,))
           and not third_preview and retry_image.attempts == 2
           and "could not prepare thumbnail" in preview_log.getvalue(),
           "transient material thumbnail failure was not loud and retryable")

    # --- website preview contract: independent process state + visible URL ---
    previewrun.reset_for_tests()
    source_path = str(Path(tempfile.gettempdir()) / "Blendlink Preview Source.blend")
    other_path = str(Path(tempfile.gettempdir()) / "Blendlink Other Source.blend")

    def source_event(**values):
        payload = {
            "schemaVersion": 1,
            "blendPath": source_path,
            "sessionId": "source-session",
            "generation": "generation-1",
            "fraction": 0.1,
            "label": "Building preview",
            "previewWatching": True,
            "previewUpdate": "building",
        }
        payload.update(values)
        previewrun._handle_line("##blendlink " + json.dumps(payload))

    source_event()
    expect(
        previewrun.matches_current_file(source_path)
        and not previewrun.matches_current_file(other_path)
        and previewrun.blend_path() == previewrun._canonical_blend_path(source_path)
        and previewrun.session_id() == "source-session"
        and previewrun.generation() == "generation-1",
        "Preview Studio did not retain canonical source/session identity",
    )
    expect(
        previewrun.is_updating() and previewrun.update_phase() == "building",
        "Preview Studio building phase was not presented as an active update",
    )
    source_event(
        generation=2,
        previewUpdate="loading",
        fraction=0.8,
        label="Loading scene",
    )
    expect(
        previewrun.is_updating()
        and previewrun.update_phase() == "loading"
        and previewrun.generation() == "2",
        "Preview Studio loading phase or generation was not retained",
    )
    source_event(
        generation="generation-2",
        previewUpdate="ready",
        previewUrl="http://localhost:5173/source",
        previewOwned=True,
        fraction=1,
        label="Preview ready",
    )
    expect(
        previewrun.is_ready_for_current_file(source_path)
        and not previewrun.is_ready_for_current_file(other_path)
        and previewrun.has_stale_session(other_path),
        "a preview for another .blend could still be presented as current",
    )

    # Events are rejected before any URL or generation can cross sessions.
    source_event(
        blendPath=other_path,
        sessionId="other-session",
        generation="foreign-generation",
        previewUpdate="ready",
        previewUrl="http://localhost:5173/foreign",
    )
    expect(
        previewrun.url() == "http://localhost:5173/source"
        and previewrun.session_id() == "source-session"
        and previewrun.generation() == "generation-2"
        and "another Blender file" in previewrun.last_message(),
        "foreign source progress replaced the current preview evidence",
    )
    source_event(
        sessionId="replacement-session",
        generation="replacement-generation",
        previewUpdate="ready",
        previewUrl="http://localhost:5173/replacement",
    )
    expect(
        previewrun.url() == "http://localhost:5173/source"
        and previewrun.session_id() == "source-session"
        and previewrun.generation() == "generation-2"
        and "another preview session" in previewrun.last_message(),
        "foreign session progress replaced the current preview evidence",
    )
    source_event(
        schemaVersion=2,
        previewUpdate="ready",
        previewUrl="http://localhost:5173/new-schema",
    )
    expect(
        previewrun.url() == "http://localhost:5173/source"
        and "unsupported progress protocol schema" in previewrun.last_message(),
        "an unsupported Preview Studio protocol silently changed state",
    )

    opened_urls = []
    real_browser_open = previewrun.webbrowser.open
    previewrun.webbrowser.open = lambda preview_url: opened_urls.append(preview_url)
    try:
        expect(
            not previewrun.open_browser() and not opened_urls,
            "Open Website exposed a preview bound to another or unsaved .blend",
        )
    finally:
        previewrun.webbrowser.open = real_browser_open

    # Replacing a stale session is ordered: request stop, wait for its child
    # to exit, then start the new source. An external website is not that child
    # and remains available while its Blendlink watcher is being replaced.
    previewrun.reset_for_tests()
    previewrun._state.update(
        running=True,
        ready=True,
        watching=True,
        url="http://localhost:8088/external",
        owns_server=False,
        blend_path=previewrun._canonical_blend_path(source_path),
        process=object(),
    )
    cancel_calls = []
    replacement_starts = []
    refresh_calls = []
    real_preview_cancel = previewrun.cancel
    real_preview_start = previewrun.start
    real_sync_refresh = syncstatus.refresh

    def fake_preview_cancel():
        cancel_calls.append("cancel")
        previewrun._state["cancel_requested"] = True

    def fake_preview_start(command, cwd, **options):
        replacement_starts.append((command, cwd, options))
        return None

    previewrun.cancel = fake_preview_cancel
    previewrun.start = fake_preview_start
    syncstatus.refresh = lambda force=False: refresh_calls.append(force) or False
    try:
        replacement_error = previewrun.replace(
            "replacement command",
            str(Path(other_path).parent),
            blend_path=other_path,
        )
        expect(
            replacement_error is None
            and cancel_calls == ["cancel"]
            and replacement_starts == [],
            "a stale preview was not stopped before its replacement started",
        )
        previewrun._finish(1)
    finally:
        previewrun.cancel = real_preview_cancel
        previewrun.start = real_preview_start
        syncstatus.refresh = real_sync_refresh
    expect(
        replacement_starts == [(
            "replacement command",
            str(Path(other_path).parent),
            {"blend_path": other_path, "session_id": None},
        )]
        and refresh_calls == [True]
        and previewrun.url() == "http://localhost:8088/external",
        "stale replacement did not preserve the external server or launch in order",
    )

    previewrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview ready",'
        '"previewUrl":"http://localhost:5173/hero"}'
    )
    expect(previewrun.is_ready(), "preview sentinel did not mark the website ready")
    expect(previewrun.url() == "http://localhost:5173/hero",
           f"preview URL was not retained: {previewrun.url()!r}")
    previewrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview ready — updates when you save",'
        '"previewUrl":"http://localhost:5173/live","previewOwned":true,'
        '"previewWatching":true,"previewUpdate":"ready"}'
    )
    expect(previewrun.is_ready() and previewrun.is_watching()
           and not previewrun.is_updating() and previewrun.update_error() == "",
           "live-preview ready state was not retained")
    previewrun._handle_line(
        '##blendlink {"fraction":0.05,"label":"Saved changes detected — updating preview",'
        '"previewUrl":"http://localhost:5173/live","previewOwned":true,'
        '"previewWatching":true,"previewUpdate":"updating"}'
    )
    expect(previewrun.is_ready() and previewrun.is_watching() and previewrun.is_updating(),
           "a save did not move the live preview into its updating state")
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview update failed — last good preview kept",'
        '"previewUrl":"http://localhost:5173/live","previewOwned":true,'
        '"previewWatching":true,"previewUpdate":"failed",'
        '"error":"Principled material export failed"}'
    )
    expect(previewrun.is_ready() and previewrun.is_watching()
           and not previewrun.is_updating()
           and previewrun.url() == "http://localhost:5173/live"
           and "Principled material export failed" in previewrun.update_error(),
           "a failed live update did not preserve the last good preview and error")
    refresh_calls = []
    real_sync_refresh = syncstatus.refresh
    syncstatus.refresh = lambda force=False: refresh_calls.append(force) or False
    try:
        previewrun._handle_line(
            '##blendlink {"fraction":1,"label":"Preview updated — watching saves",'
            '"previewUrl":"http://localhost:5173/live","previewOwned":true,'
            '"previewWatching":true,"previewUpdate":"ready"}'
        )
    finally:
        syncstatus.refresh = real_sync_refresh
    expect(previewrun.is_ready() and previewrun.is_watching()
           and not previewrun.is_updating() and previewrun.update_error() == ""
           and refresh_calls == [True],
           "a recovered live update did not clear its error and refresh published evidence")
    previewrun._state["running"] = True
    previewrun._finish(1)
    expect(not previewrun.is_ready() and previewrun.url() == ""
           and previewrun.update_error() == "",
           "a terminal preview failure retained dead last-good-preview state")
    previewrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview update failed — last good preview kept",'
        '"previewUrl":"http://localhost:5173/terminal","previewOwned":true,'
        '"previewWatching":true,"previewUpdate":"failed",'
        '"error":"Export failed before the watcher exited"}'
    )
    previewrun._state["running"] = True
    previewrun._finish(1)
    expect(not previewrun.is_ready() and previewrun.url() == ""
           and previewrun.update_error() == ""
           and "Export failed before the watcher exited" in previewrun.last_message(),
           "a terminal watcher failure was still presented as a recoverable live update")
    previewrun.reset_for_tests()
    previewrun._state.update(running=True, cancel_requested=True)
    previewrun._finish(1)
    expect(previewrun.was_canceled()
           and previewrun.progress()[1] == "Preview stopped"
           and previewrun.last_finished_at() > 0,
           "intentional preview cancellation was reported as a failure")
    syncrun.reset_for_tests()
    syncrun._state.update(running=True, cancel_requested=True)
    syncrun._finish(1)
    expect(syncrun.was_canceled()
           and syncrun.progress()[1] == "Website task canceled"
           and syncrun.last_finished_at() > 0,
           "intentional website-task cancellation was reported as a failure")
    syncrun.reset_for_tests()
    previewrun.reset_for_tests()
    previewrun._state.update(running=True, ready=False)
    expect(not ops.BLENDLINK_OT_sync_now.poll(bpy.context),
           "a second compiler could start while Preview Website was compiling")
    previewrun.reset_for_tests()
    syncrun._state["running"] = True
    expect(not ops.BLENDLINK_OT_browser_preview.poll(bpy.context),
           "Preview Website could start while another website build was running")
    syncrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview ready",'
        '"previewUrl":"http://localhost:8088/hero","previewOwned":false}'
    )
    previewrun._state["running"] = True
    previewrun._finish(0)
    expect(previewrun.is_ready() and previewrun.url() == "http://localhost:8088/hero",
           "a proven configured external preview was discarded when discovery exited")
    previewrun._state.update(
        running=True, watching=True, cancel_requested=True, canceled=False,
    )
    previewrun._finish(1)
    expect(previewrun.is_ready()
           and previewrun.url() == "http://localhost:8088/hero"
           and not previewrun.is_watching() and previewrun.was_canceled(),
           "stopping an external live watcher discarded the still-running website")
    previewrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview ready",'
        '"previewUrl":"http://localhost:5173/owned","previewOwned":true}'
    )
    previewrun._state["running"] = True
    previewrun._finish(0)
    expect(not previewrun.is_ready() and previewrun.url() == "",
           "an exited owned server retained a dead Open Website URL")
    previewrun.reset_for_tests()
    with tempfile.TemporaryDirectory(prefix="blendlink-preview-protocol-") as protocol_dir:
        protocol_log = Path(protocol_dir) / "preview.log"
        previewrun._state["log_path"] = str(protocol_log)
        captured = StringIO()
        malformed = '##blendlink {"fraction": nope}'
        with redirect_stdout(captured):
            previewrun._handle_line(malformed)
        diagnostic = captured.getvalue()
        tail = "\n".join(previewrun._state["tail"])
        persisted = protocol_log.read_text(encoding="utf8")
        expect("malformed progress protocol" in diagnostic and malformed in diagnostic,
               f"malformed preview protocol was not loud: {diagnostic!r}")
        expect("malformed progress protocol" in tail and malformed in tail,
               f"malformed preview protocol was not retained in tail: {tail!r}")
        expect("malformed progress protocol" in persisted and malformed in persisted,
               f"malformed preview protocol was not retained in log: {persisted!r}")
    previewrun.reset_for_tests()
    previewrun._handle_line(
        '##blendlink {"fraction":1,"label":"Preview ready",'
        '"previewUrl":"http://localhost:5173/shutdown","previewOwned":true}'
    )
    previewrun.shutdown()
    expect(not previewrun.is_ready() and previewrun.url() == ""
           and previewrun._state["opened_url"] == "",
           "disabling the addon retained a dead website-preview URL")
    refresh_calls = []
    real_sync_refresh = syncstatus.refresh
    syncstatus.refresh = lambda force=False: refresh_calls.append(force) or False
    try:
        previewrun.reset_for_tests()
        previewrun._state["running"] = True
        previewrun._finish(0)
    finally:
        syncstatus.refresh = real_sync_refresh
    expect(refresh_calls == [True],
           "website preview completion did not discover its newly written manifest")
    previewrun.reset_for_tests()

    # A disposable Preview Studio prefers the compatible CLI in a local
    # checkout containing the .blend, then falls back to the exact npm release
    # paired with the addon.  This mirrors an installed addon previewing an
    # unpublished development version without weakening release compatibility.
    addon_release = ops._addon_release_version()
    with tempfile.TemporaryDirectory(prefix="blendlink-local-preview-") as temporary:
        checkout = Path(temporary) / "Checkout With Spaces"
        installed_ops_file = Path(temporary) / "installed-addon" / "ops.py"
        local_package = checkout / "packages" / "blendlink"
        local_cli = local_package / "dist" / "cli.js"
        local_cli.parent.mkdir(parents=True)
        local_package.joinpath("package.json").write_text(json.dumps({
            "name": "blendlink", "version": addon_release,
        }), encoding="utf8")
        local_cli.write_text("// test CLI\n", encoding="utf8")
        preview_source = checkout / "experiments" / "Artist Scene.blend"
        preview_source.parent.mkdir(parents=True)

        original_ops_file = ops.__file__
        ops.__file__ = str(installed_ops_file)
        try:
            preview_command, preview_cwd = ops._preview_studio_command(str(preview_source))
            expect(str(local_cli.resolve()) in preview_command
                   and f"blendlink@{addon_release}" not in preview_command
                   and "preview" in preview_command
                   and "--no-open" in preview_command,
                   f"Preview Studio ignored its compatible local CLI: {preview_command!r}")
            expect(preview_cwd == str(preview_source.resolve().parent),
                   f"Preview Studio command used an unsafe working directory: {preview_cwd!r}")
            if os.name == "nt":
                expect(f'"{str(local_cli.resolve())}"' in preview_command
                       and f'"{str(preview_source.resolve())}"' in preview_command,
                       f"Preview Studio split a spaced Windows path: {preview_command!r}")

            local_package.joinpath("package.json").write_text(json.dumps({
                "name": "blendlink", "version": "9.9.9",
            }), encoding="utf8")
            captured = StringIO()
            with redirect_stdout(captured):
                fallback_command, _ = ops._preview_studio_command(str(preview_source))
            expect(f"blendlink@{addon_release}" in fallback_command
                   and "--yes" in fallback_command,
                   f"Preview Studio used a mismatched local CLI: {fallback_command!r}")
            expect("version 9.9.9" in captured.getvalue()
                   and f"requires {addon_release}" in captured.getvalue(),
                   f"Preview Studio silently skipped a mismatched local CLI: {captured.getvalue()!r}")

            local_package.joinpath("package.json").write_text(json.dumps({
                "name": "blendlink", "version": addon_release,
            }), encoding="utf8")
            local_cli.unlink()
            captured = StringIO()
            with redirect_stdout(captured):
                unbuilt_command, _ = ops._preview_studio_command(str(preview_source))
            expect(f"blendlink@{addon_release}" in unbuilt_command
                   and "dist/cli.js is missing" in captured.getvalue()
                   and "npm run build" in captured.getvalue(),
                   f"Preview Studio silently used an unbuilt local package: "
                   f"{unbuilt_command!r} / {captured.getvalue()!r}")
        finally:
            ops.__file__ = original_ops_file

    # --- first-run copy: truthful Blender setup + explicit app handoff ---
    expect(ops.BLENDLINK_OT_setup_website_export.poll(bpy.context),
           "first-time scene setup was not available")
    expect(not ops.BLENDLINK_OT_add_composition.poll(bpy.context)
           and not ops.BLENDLINK_OT_add_state.poll(bpy.context),
           "F3 could mutate scene settings before Blendlink setup")
    try:
        ops._save_before_publish(1, save_operation=lambda: {"CANCELLED"})
    except RuntimeError:
        pass
    else:
        raise AssertionError("a canceled Blender save still allowed website publishing")
    setup = ui._export_setup(False, "", None)
    expect([item["key"] for item in setup] == ["scene", "save", "project"]
           and not any(item["complete"] for item in setup),
           f"new-scene export setup did not name every prerequisite: {setup}")
    located = ui._export_setup(True, "C:/site/assets/hero.blend", "C:/site")
    expect(all(item["complete"] for item in located)
           and not any("browser" in item["label"].lower() or "website" in item["label"].lower()
                       for item in located),
           f"Blender-side setup overstated website readiness: {located}")

    with tempfile.TemporaryDirectory(prefix="blendlink-app-handoff-") as tmp:
        root = Path(tmp)
        integration_dir = root / "src" / "blendlink"
        integration_dir.mkdir(parents=True)
        r3f_path = integration_dir / "HeroScene.ts"
        r3f_path.write_text(
            "import { useThree } from '@react-three/fiber'\n"
            "export function HeroScene() { return null }\n",
            encoding="utf8",
        )
        syncstatus._state["handoff_cache"] = {}
        integration_reads = []
        real_path_read_text = Path.read_text

        def counted_path_read_text(path, *args, **kwargs):
            if path == r3f_path:
                integration_reads.append(path)
            return real_path_read_text(path, *args, **kwargs)

        Path.read_text = counted_path_read_text
        try:
            handoff = syncstatus._discover_website_handoff(
                root, root / "src" / "generated" / "hero.manifest.json",
            )
            repeated_handoff = syncstatus._discover_website_handoff(
                root, root / "src" / "generated" / "hero.manifest.json",
            )
        finally:
            Path.read_text = real_path_read_text
        expect(handoff["kind"] == "react-three-fiber"
               and handoff["path"] == "src/blendlink/HeroScene.ts"
               and "<HeroScene />" in handoff["instruction"]
               and "WebGL" in handoff["instruction"]
               and "ready" not in handoff,
               f"R3F hookup was not exact and non-certifying: {handoff}")
        expect(repeated_handoff == handoff and integration_reads == [r3f_path],
               "steady status polling reread an unchanged generated integration")
        syncstatus._state["website_handoff"] = handoff

        # Background Blender has no native system clipboard: its RNA setter is
        # a silent no-op. Copy operators must report that limitation instead of
        # claiming success, while an injected clipboard backend lets this suite
        # prove the exact artist-facing text requested by the real operator.
        clipboard_error = ops._copy_to_system_clipboard(
            bpy.context, handoff["instruction"],
        )
        expect(clipboard_error is not None and "background mode" in clipboard_error,
               f"headless clipboard failure was not explicit: {clipboard_error!r}")
        unavailable_failure = ""
        try:
            unavailable_result = bpy.ops.blendlink.copy_website_handoff()
        except RuntimeError as error:
            # Blender's Python operator wrapper raises an ERROR report even
            # though execute() returns CANCELLED; interactive artists see the
            # same report in Blender's status area.
            unavailable_result = {"CANCELLED"}
            unavailable_failure = str(error)
        expect(unavailable_result == {"CANCELLED"}
               and "background mode" in unavailable_failure,
               "website hookup did not fail loudly without a system clipboard")

        copied = []
        real_clipboard = ops._copy_to_system_clipboard

        def capture_clipboard(_context, text):
            copied.append(text)
            return None

        ops._copy_to_system_clipboard = capture_clipboard
        try:
            copy_result = bpy.ops.blendlink.copy_website_handoff()
        finally:
            ops._copy_to_system_clipboard = real_clipboard
        expect(copy_result == {"FINISHED"} and copied == [handoff["instruction"]],
               f"exact website hookup was not sent to the clipboard: {copied!r}")

        r3f_path.unlink()
        three_path = integration_dir / "ProductScene.ts"
        three_path.write_text(
            "export function installProductScene({ renderer, scene }) { return { renderer, scene } }\n",
            encoding="utf8",
        )
        vanilla = syncstatus._discover_website_handoff(
            root, root / "src" / "generated" / "product.manifest.json",
        )
        expect(vanilla["kind"] == "three"
               and "await installProductScene({ renderer, scene })" in vanilla["instruction"],
               f"Vanilla Three hookup was not exact: {vanilla}")

        missing = syncstatus._discover_website_handoff(
            root, root / "src" / "generated" / "missing.manifest.json",
        )
        expect(missing["kind"] == "missing"
               and "src/blendlink/MissingScene.ts" in missing["instruction"]
               and "npx blendlink connect" in missing["instruction"],
               f"missing integration did not retain an actionable required step: {missing}")
    syncstatus.reset()
    wrapped = ui._wrap_text(
        "This deliberately long artist-facing problem must remain readable in a narrow sidebar.",
        width=24,
    )
    expect(len(wrapped) > 1 and all(len(line) <= 24 for line in wrapped),
           f"sidebar copy did not wrap: {wrapped}")
    consequence, remedy = ui._message_sections(
        "Main cannot meet its density target; increase resolution or lower Minimum Detail",
        "fallback",
    )
    expect(consequence == "Main cannot meet its density target"
           and remedy.startswith("increase resolution"),
           f"issue consequence/remedy split failed: {(consequence, remedy)}")
    connect_copied = []
    real_clipboard = ops._copy_to_system_clipboard
    ops._copy_to_system_clipboard = (
        lambda _context, text: connect_copied.append(text) or None
    )
    try:
        connect_result = bpy.ops.blendlink.copy_connect_command()
    finally:
        ops._copy_to_system_clipboard = real_clipboard
    expect(connect_result == {"FINISHED"}
           and ops.WEBSITE_CONNECT_COMMAND == "npx blendlink connect"
           and connect_copied == [ops.WEBSITE_CONNECT_COMMAND],
           "website connect action did not expose the safe CLI command")
    expect(ops._website_task_command("FINAL") == "npx blendlink publish"
           and ops._website_task_command("PREVIEW") == "npx blendlink compile --preview"
           and ops._website_task_command("PLAN") == "npx blendlink plan"
           and ops._website_task_command("WATCH")
           == "npx blendlink compile --preview --watch",
           "connect / preview / publish commands drifted from the artist-facing workflow")
    try:
        ops._website_task_command("UNKNOWN")
    except ValueError as error:
        expect("Unsupported Blendlink website task" in str(error),
               f"unknown website task was not actionable: {error}")
    else:
        raise AssertionError("unknown website task silently selected a command")

    # Every discovery read enforces schemaVersion and reports rejected bytes.
    # Corrupt/unsupported files must never disappear behind a silent continue.
    with tempfile.TemporaryDirectory(prefix="blendlink-manifest-discovery-") as tmp:
        root = Path(tmp)
        (root / "blendlink.config.mjs").write_text("export default {}", encoding="utf8")
        blend_path = root / "Hero.blend"
        blend_path.write_bytes(b"blend")
        (root / "corrupt.manifest.json").write_text("{broken", encoding="utf8")
        (root / "unsupported.manifest.json").write_text(
            '{"generator":"blendlink","schemaVersion":999,'
            f'"sourceBlend":"{blend_path.as_posix()}"}}',
            encoding="utf8",
        )
        (root / "legacy.manifest.json").write_text(json.dumps({
            "generator": "blendlink",
            "schemaVersion": 2,
            "sourceBlend": str(blend_path),
        }), encoding="utf8")
        supported_path = root / "appearance.manifest.json"
        supported_path.write_text(json.dumps({
            "generator": "blendlink",
            "schemaVersion": 3,
            "sourceBlend": str(blend_path),
            "states": {
                "day": {
                    "atlases": {"main": "/models/hero.day.main.png"},
                    "default": True,
                },
            },
            "bakeOutputs": {"main": "appearance"},
            "stateScales": {"day": {"main": 2.5}},
        }), encoding="utf8")
        discovery_log = StringIO()
        with redirect_stdout(discovery_log):
            discovered = syncstatus._find_manifest(blend_path)
        rejection_text = "\n".join(syncstatus.manifest_rejections())
        expect(discovered == supported_path,
               "schema v3 Appearance manifest was not accepted by discovery")
        expect("invalid JSON" in discovery_log.getvalue()
               and "schemaVersion 999 is unsupported" in discovery_log.getvalue()
               and "schemaVersion 2 is unsupported; expected 3" in discovery_log.getvalue(),
               f"manifest discovery failures were not loud: {discovery_log.getvalue()!r}")
        expect("corrupt.manifest.json" in rejection_text
               and "unsupported.manifest.json" in rejection_text
               and "legacy.manifest.json" in rejection_text
               and "appearance.manifest.json" not in rejection_text,
               f"manifest discovery did not retain every rejection: {rejection_text}")
    syncstatus.reset()

    # --- tagging: multi-object, retag replaces the previous suffix ---
    crate = make_cube("Crate")
    fence = make_cube("Fence")
    select_only(crate, fence)

    # Blendlink links to Blender's native detail tabs instead of duplicating
    # those controls. Every supported destination must really select the
    # requested tab in the existing Properties editor.
    properties_area = ops._properties_area(bpy.context)
    expect(properties_area is not None,
           "factory workspace unexpectedly has no Properties editor")
    for target in ("SCENE", "WORLD", "OBJECT", "DATA", "MATERIAL"):
        result = bpy.ops.blendlink.open_properties_context(target=target)
        expect(result == {"FINISHED"}
               and properties_area.spaces.active.context == target,
               f"native Properties navigation did not open {target}")

    bpy.ops.blendlink.tag_collider(kind="colonly")
    expect(crate.name == "Crate-colonly", f"expected Crate-colonly, got {crate.name}")
    expect(fence.name == "Fence-colonly", f"expected Fence-colonly, got {fence.name}")
    select_only(crate)
    bpy.ops.blendlink.tag_collider(kind="convcol")
    expect(crate.name == "Crate-convcol", f"retag failed: {crate.name}")

    # Explicit roles outrank names. Every visible retag action must reconcile
    # that override so its success report matches the actual export meaning.
    precedence = make_cube("Precedence")
    precedence["blendlink_role"] = "noimp"
    select_only(precedence)
    bpy.ops.blendlink.tag_collider(kind="col")
    expect("blendlink_role" not in precedence
           and vocab.classify(precedence.name, dict(precedence.items())).kind == "collider",
           "Tag as Collider remained excluded by an older explicit role")
    precedence["blendlink_role"] = "noimp"
    bpy.ops.blendlink.tag_rigid(mass=2.0, friction=0.5)
    expect("blendlink_role" not in precedence
           and vocab.classify(precedence.name, dict(precedence.items())).kind == "rigid",
           "Tag as Rigid Body remained excluded by an older explicit role")
    precedence["blendlink_role"] = "noimp"
    bpy.ops.blendlink.set_lod(level=2, distance=20.0)
    expect("blendlink_role" not in precedence
           and vocab.classify(precedence.name, dict(precedence.items())).kind == "lod",
           "Set LOD Level remained excluded by an older explicit role")
    precedence["blendlink_role"] = "col"
    bpy.ops.blendlink.tag_noimp()
    expect("blendlink_role" not in precedence
           and vocab.classify(precedence.name, dict(precedence.items())).kind == "noimp",
           "Exclude from Web Export remained a collider through property precedence")
    precedence.name = "Precedence Explicit Only"
    precedence["blendlink_role"] = "noimp"
    bpy.ops.blendlink.clear_tag()
    expect("blendlink_role" not in precedence,
           "Clear Blendlink Tag did not clear an explicit-only role")

    # --- name-collision safety: never silently .001 the tag ---
    other = make_cube("Crate")
    select_only(other)
    result = bpy.ops.blendlink.tag_collider(kind="convcol")
    expect(result == {"FINISHED"}, "collision tag should finish with a warning")
    expect(other.name == "Crate", f"collision must skip rename, got {other.name}")
    rigid_collision = make_cube("Rigid Collision")
    rigid_blocker = make_cube("Rigid Collision-rigid")
    select_only(rigid_collision)
    bpy.ops.blendlink.tag_rigid()
    expect(rigid_collision.name == "Rigid Collision"
           and "blendlink_mass" not in rigid_collision,
           "rigid-body name collision partially tagged the object")
    lod_collision = make_cube("LOD Collision")
    lod_blocker = make_cube("LOD Collision_LOD1")
    select_only(lod_collision)
    bpy.ops.blendlink.set_lod(level=1, distance=10)
    expect(lod_collision.name == "LOD Collision"
           and "blendlink_lod_distance" not in lod_collision,
           "LOD name collision partially tagged the object")
    exclusion_collision = make_cube("Exclusion Collision")
    exclusion_blocker = make_cube("Exclusion Collision-noimp")
    select_only(exclusion_collision)
    bpy.ops.blendlink.tag_noimp()
    expect(exclusion_collision.name == "Exclusion Collision",
           "exclude name collision silently changed the object")
    exclusion_blocker["blendlink_role"] = "noimp"
    select_only(exclusion_blocker)
    bpy.ops.blendlink.clear_tag()
    expect(exclusion_blocker.name == "Exclusion Collision-noimp"
           and exclusion_blocker.get("blendlink_role") == "noimp",
           "Clear Tag removed property precedence before a failed rename")
    bpy.ops.blendlink.set_export_inclusion(include=True)
    expect(exclusion_blocker.name == "Exclusion Collision-noimp"
           and exclusion_blocker.get("blendlink_role") == "noimp",
           "Include in Website partially cleared an excluded object on name collision")
    for collision_object in (
        rigid_collision, rigid_blocker, lod_collision, lod_blocker,
        exclusion_collision, exclusion_blocker,
    ):
        collision_mesh = collision_object.data
        bpy.data.objects.remove(collision_object, do_unlink=True)
        bpy.data.meshes.remove(collision_mesh)
    select_only(fence)
    bpy.ops.blendlink.clear_tag()
    expect(fence.name == "Fence", f"clear_tag left {fence.name}")

    # --- rigid: props with native ui metadata ---
    barrel = make_cube("Barrel")
    select_only(barrel)
    bpy.ops.blendlink.tag_rigid(mass=12.5, friction=0.4)
    expect(barrel.name == "Barrel-rigid", barrel.name)
    expect(abs(barrel["blendlink_mass"] - 12.5) < 1e-6, "mass not set")
    ui_data = barrel.id_properties_ui("blendlink_mass").as_dict()
    expect("kilograms" in ui_data.get("description", ""), f"mass ui_data missing: {ui_data}")

    # --- LOD ---
    rock = make_cube("Rock")
    select_only(rock)
    bpy.ops.blendlink.set_lod(level=1, distance=12.0)
    expect(rock.name == "Rock_LOD1", rock.name)
    expect(abs(rock["blendlink_lod_distance"] - 12.0) < 1e-6, "lod_distance not set")
    rock_near = make_cube("Rock_LOD0")
    rock_near["blendlink_id"] = "lod-near"
    rock["blendlink_id"] = "lod-far"

    # --- anchors: parented empty, one undo step, hotspot props ---
    select_only(barrel)
    anchor_count = len(bpy.data.objects)
    for anchor_kind in ("SOCKET", "HOTSPOT", "AUDIO"):
        try:
            anchor_result = bpy.ops.blendlink.add_anchor(
                kind=anchor_kind, anchor_name="   ", parent_name=barrel.name,
            )
        except RuntimeError as error:
            expect("Give the anchor a name" in str(error),
                   f"blank {anchor_kind} failure was not actionable: {error}")
            anchor_result = {"CANCELLED"}
        expect(anchor_result == {"CANCELLED"},
               f"blank {anchor_kind} anchor name was accepted")
    expect(len(bpy.data.objects) == anchor_count,
           "blank anchor validation left orphan Blender objects")
    bpy.ops.blendlink.add_anchor(kind="SOCKET", anchor_name="Top")
    socket = bpy.context.active_object
    expect(socket.name == "SOCKET_Top", socket.name)
    expect(socket.parent == barrel, "socket not parented to active object")
    expect(socket.type == "EMPTY", "socket should be an empty")
    select_only(barrel)
    bpy.ops.blendlink.add_anchor(kind="HOTSPOT", anchor_name="Info")
    hotspot = bpy.context.active_object
    expect(hotspot["blendlink_title"] == "Info", "hotspot title prop missing")

    # --- noimp ---
    grid = make_cube("RefGrid")
    select_only(grid)
    bpy.ops.blendlink.tag_noimp()
    expect(grid.name == "RefGrid-noimp", grid.name)
    select_only(grid)
    bpy.ops.blendlink.set_export_inclusion(include=True)
    expect(vocab.classify(grid.name) is None, "Include in Web Scene did not clear -noimp")
    bpy.ops.blendlink.set_export_inclusion(include=False)
    expect(grid["blendlink_role"] == "noimp", "Exclude toggle did not author blendlink_role")

    # --- lint through the live scan: near-miss + numbered dup + fix ---
    make_cube("Wall-collonly")
    duped = make_cube("Zone-colonly.001")
    validation.recompute(bpy.context.scene)
    messages = [issue.message for issue in validation.result().issues]
    expect(any("did not match" in m for m in messages), f"near-miss lint missing: {messages}")
    expect(any("duplicate numbering" in m for m in messages), f"numbered lint missing: {messages}")
    grid["texel_weight"] = 1.5
    validation.recompute(bpy.context.scene)
    expect(any("bare texel_weight is deprecated" in issue.message
               for issue in validation.result().issues),
           "bare compatibility property did not produce a migration lint")
    deprecated_output = StringIO()
    with redirect_stdout(deprecated_output):
        expect(ui._prop_key(grid, "texel_weight") == "texel_weight",
               "bare property compatibility read disappeared before 1.0")
    expect(not deprecated_output.getvalue(),
           "drawing a deprecated compatibility property emitted a side effect")
    del grid["texel_weight"]
    grid["mass"] = 3.5
    select_only(grid)
    bpy.ops.blendlink.migrate_legacy_property(
        object_name=grid.name, property_name="mass",
    )
    expect("mass" not in grid and grid["blendlink_mass"] == 3.5,
           "legacy property migration wrote or retained the bare custom-property name")
    bpy.ops.blendlink.fix_numbered(object_name=duped.name)
    expect(duped.name == "Zone.001-colonly", f"fix_numbered produced {duped.name}")
    expect(vocab.classify(duped.name).kind == "collider", "fixed name should parse")

    # --- select-issue operator ---
    bpy.ops.blendlink.select_issue(object_name="Wall-collonly")
    expect(bpy.context.view_layer.objects.active.name == "Wall-collonly", "select_issue failed")

    # --- overlay scan produced draw items (no GPU needed for the data) ---
    validation.recompute(bpy.context.scene)
    kinds = {item.kind for item in validation.result().overlay}
    expect("collider" in kinds and "socket" in kinds and "hotspot" in kinds,
           f"overlay items incomplete: {kinds}")

    # --- sync status on an unsaved file ---
    syncstatus.refresh(force=True)
    expect(syncstatus.status()[0] == "NO_FILE", f"unsaved file status: {syncstatus.status()}")

    # Manifest status verifies the exact URL path and every declared content
    # hash. A same-named PNG elsewhere must never make the build look valid.
    with tempfile.TemporaryDirectory(prefix="blendlink-sync-integrity-") as integrity_dir:
        root = Path(integrity_dir)
        (root / "public" / "models").mkdir(parents=True)
        (root / "src" / "generated").mkdir(parents=True)
        glb = root / "public" / "models" / "Hero.glb"
        atlas_file = root / "public" / "models" / "Hero.default.png"
        atlas_tier_png = root / "public" / "models" / "Hero.default.256.png"
        atlas_tier_webp = root / "public" / "models" / "Hero.default.256.webp"
        atlas_full_webp = root / "public" / "models" / "Hero.default.webp"
        module_file = root / "src" / "generated" / "Hero.gen.ts"
        manifest_file = root / "src" / "generated" / "Hero.manifest.json"
        source_blend = root / "scenes" / "hero.blend"
        dependency_file = root / "scenes" / "textures" / "linked.png"
        dependency_file.parent.mkdir(parents=True)
        dependency_file.write_bytes(b"linked-A")
        glb.write_bytes(b"published glb")
        atlas_file.write_bytes(b"published atlas")
        atlas_tier_png.write_bytes(b"published 256 png")
        atlas_tier_webp.write_bytes(b"published 256 exact webp")
        atlas_full_webp.write_bytes(b"published full exact webp")
        module_file.write_text("export const hero = true\n", encoding="utf8")
        manifest = {
            "generator": "blendlink",
            "schemaVersion": 3,
            "sourceBlend": str(source_blend),
            "url": "/models/Hero.glb",
            "hash": syncstatus._hash_file(glb),
            "generatedModuleHash": syncstatus._hash_file(module_file),
            "stats": {"bytes": glb.stat().st_size},
            "states": {"default": {"url": "/models/Hero.default.png"}},
            "bakeArtifactHashes": {
                "version": 1,
                "states": {"default": {"main": syncstatus._hash_file(atlas_file)}},
                "lightGroups": {},
            },
            "textureVariants": {
                "/models/Hero.default.png": [{
                    "url": "/models/Hero.default.256.webp", "format": "webp",
                    "width": 256, "height": 256,
                    "bytes": atlas_tier_webp.stat().st_size,
                    "hash": syncstatus._hash_file(atlas_tier_webp), "lossless": True,
                }, {
                    "url": "/models/Hero.default.256.png", "format": "png",
                    "width": 256, "height": 256,
                    "bytes": atlas_tier_png.stat().st_size,
                    "hash": syncstatus._hash_file(atlas_tier_png), "lossless": True,
                }, {
                    "url": "/models/Hero.default.webp", "format": "webp",
                    "width": 1024, "height": 1024,
                    "bytes": atlas_full_webp.stat().st_size,
                    "hash": syncstatus._hash_file(atlas_full_webp), "lossless": True,
                }],
            },
            "externalDependencies": [{
                "path": "textures/linked.png", "relativeToBlend": True,
                "exists": True, "bytes": dependency_file.stat().st_size,
                "hash": syncstatus._hash_file(dependency_file), "volatile": False,
            }],
        }
        manifest_file.write_text("{}", encoding="utf8")
        syncstatus._state["root"] = root
        syncstatus._state["asset_hash_cache"] = {}
        expect(syncstatus._verify_declared_assets(manifest, manifest_file, force=True) == [],
               "valid published asset set failed integrity")
        declared_variant_checks = [
            check for check in syncstatus._declared_asset_checks(manifest, manifest_file)
            if check["label"].startswith("texture variant ")
        ]
        expect(
            len(declared_variant_checks) == 3
            and {check["url"] for check in declared_variant_checks} == {
                "/models/Hero.default.256.png",
                "/models/Hero.default.256.webp",
                "/models/Hero.default.webp",
            },
            f"not every PNG/WebP tier entered published integrity: {declared_variant_checks}",
        )
        atlas_tier_webp.write_bytes(b"modified 256 exact webp")
        variant_failures = syncstatus._verify_declared_assets(
            manifest, manifest_file, force=True,
        )
        expect(
            any("texture variant" in item and "bytes changed" in item
                for item in variant_failures),
            f"changed WebP tier did not invalidate published integrity: {variant_failures}",
        )
        atlas_tier_webp.write_bytes(b"published 256 exact webp")
        atlas_tier_png.unlink()
        variant_failures = syncstatus._verify_declared_assets(
            manifest, manifest_file, force=True,
        )
        expect(
            any("texture variant" in item and "missing" in item
                for item in variant_failures),
            f"missing PNG tier did not invalidate published integrity: {variant_failures}",
        )
        atlas_tier_png.write_bytes(b"published 256 png")
        malformed_variant = {
            "url": "/models/Hero.default.invalid.webp", "format": "webp",
            "width": 128, "height": 128, "bytes": 10,
            "hash": "not-a-content-hash", "lossless": True,
        }
        manifest["textureVariants"]["/models/Hero.default.png"].append(malformed_variant)
        variant_failures = syncstatus._verify_declared_assets(
            manifest, manifest_file, force=True,
        )
        expect(
            any("texture variant 4" in item and "no valid integrity hash" in item
                for item in variant_failures),
            f"malformed tier metadata was silently trusted: {variant_failures}",
        )
        malformed_variant.update({
            "url": "/models/Hero.default.webp",
            "bytes": atlas_full_webp.stat().st_size,
            "hash": syncstatus._hash_file(atlas_full_webp),
            "lossless": False,
        })
        variant_failures = syncstatus._verify_declared_assets(
            manifest, manifest_file, force=True,
        )
        expect(
            any("texture variant 4" in item and "invalid manifest metadata" in item
                and "lossless must be true" in item for item in variant_failures),
            f"invalid tier semantics were silently trusted: {variant_failures}",
        )
        manifest["textureVariants"]["/models/Hero.default.png"].pop()
        expect(syncstatus._verify_external_dependencies(manifest, force=True) == [],
               "valid relative external dependency failed integrity")
        dependency_file.write_bytes(b"linked-B")
        dependency_failures = syncstatus._verify_external_dependencies(manifest, force=True)
        expect(any("linked.png" in item and "changed" in item for item in dependency_failures),
               f"same-path external dependency edit did not invalidate sync: {dependency_failures}")
        dependency_file.write_bytes(b"linked-A")
        private_dependency = root.parent / "private-linked.blend"
        private_dependency.write_bytes(b"private-A")
        private_cache = root / "private-provenance"
        private_cache.mkdir()
        private_key = syncstatus._local_path_key(private_dependency)
        private_entry = {
            "path": f"external/{private_key}", "relativeToBlend": False,
            "localPathKey": private_key,
            "exists": True, "bytes": private_dependency.stat().st_size,
            "hash": syncstatus._hash_file(private_dependency), "volatile": False,
        }
        manifest["externalDependencies"] = [private_entry]
        missing_private = syncstatus._verify_external_dependencies(
            manifest, True, private_cache,
        )
        expect(any("no private path record" in item for item in missing_private),
               f"missing private provenance was not stale/loud: {missing_private}")
        (private_cache / f"{private_key}.json").write_text(json.dumps({
            "schemaVersion": 1, "key": private_key, "path": str(private_dependency),
        }), encoding="utf8")
        expect(syncstatus._verify_external_dependencies(manifest, True, private_cache) == [],
               "valid private dependency provenance failed integrity")
        private_dependency.write_bytes(b"private-B")
        private_failures = syncstatus._verify_external_dependencies(manifest, True, private_cache)
        expect(any(str(private_dependency) in item and "changed" in item
                   for item in private_failures),
               f"private dependency edit was not artist-readable: {private_failures}")
        private_dependency.write_bytes(b"private-A")
        manifest["externalDependencies"] = [{
            "path": "textures/linked.png", "relativeToBlend": True,
            "exists": True, "bytes": dependency_file.stat().st_size,
            "hash": syncstatus._hash_file(dependency_file), "volatile": False,
        }]
        manifest["externalDependencies"][0]["volatile"] = True
        expect(any("volatile" in item for item in syncstatus._verify_external_dependencies(manifest, True)),
               "volatile external dependency was presented as current")
        manifest["externalDependencies"][0]["volatile"] = False
        manifest["externalDependencies"][0]["exists"] = False
        expect(any("missing" in item for item in syncstatus._verify_external_dependencies(manifest, True)),
               "dependency missing at publish time was presented as current")
        manifest["externalDependencies"][0]["exists"] = True
        derived = syncstatus._collect_derived_assets(manifest)
        expect(derived[0]["path"] == str(atlas_file) and derived[0]["verified"],
               f"exact atlas URL did not resolve to verified bytes: {derived}")
        expected_variant_paths = {
            str(atlas_tier_png), str(atlas_tier_webp), str(atlas_full_webp),
        }
        derived_variants = {
            asset["path"] for asset in derived[1:]
            if " · " in asset.get("label", "") and asset.get("verified")
        }
        expect(
            derived_variants == expected_variant_paths
            and all(asset["kind"] == "state" and asset["atlas"] == "main"
                    for asset in derived[1:]),
            f"verified delivery variants were not artist-inspectable: {derived}",
        )
        session = bpy.context.window_manager.blendlink
        syncstatus._state["derived_assets"] = derived
        session.derived_asset_path = str(atlas_file)
        session.derived_asset_label = "default / main"
        session.derived_asset_kind = "state"
        session.derived_asset_content_hash = derived[0]["contentHash"]
        expect(syncstatus.verified_derived_asset(
            session.derived_asset_path, session.derived_asset_content_hash,
        ) is not None, "exact published-image byte identity was not actionable")
        atlas_file.write_bytes(b"modified atlas")
        syncstatus._state["asset_hash_cache"] = {}
        syncstatus._state["derived_assets"] = syncstatus._collect_derived_assets(manifest)
        syncstatus._clear_unverified_selection()
        expect(session.derived_asset_path == "" and session.derived_asset_content_hash == "",
               "integrity refresh left a stale modified-image selection actionable")
        atlas_file.write_bytes(b"published atlas")
        syncstatus._state["asset_hash_cache"] = {}

        ambiguous_atlas = root / "models" / atlas_file.name
        ambiguous_atlas.parent.mkdir()
        ambiguous_atlas.write_bytes(b"wrong conventional root")
        failures = syncstatus._verify_declared_assets(manifest, manifest_file, force=True)
        expect(any("state 'default' atlas 'main' bytes changed" in item for item in failures),
               f"ambiguous served roots hid a wrong atlas: {failures}")
        ambiguous_atlas.unlink()

        atlas_file.write_bytes(b"modified atlas")
        failures = syncstatus._verify_declared_assets(manifest, manifest_file, force=True)
        expect(any("state 'default' atlas 'main' bytes changed" in item for item in failures),
               f"modified atlas did not invalidate sync: {failures}")
        wrong = root / "unrelated" / atlas_file.name
        wrong.parent.mkdir()
        wrong.write_bytes(b"published atlas")
        atlas_file.unlink()
        expect(syncstatus._resolve_asset(
            root, "/models/Hero.default.png",
            manifest["bakeArtifactHashes"]["states"]["default"]["main"],
        ) is None, "unverified basename fallback selected an unrelated PNG")

        (root / "blendlink.config.mjs").write_text("export default {}\n", encoding="utf8")
        manifest["sourceBlend"] = str(root / "other" / "same.blend")
        manifest_file.write_text(__import__("json").dumps(manifest), encoding="utf8")
        expect(syncstatus._find_manifest(root / "same.blend") is None,
               "manifest discovery accepted an unrelated same-basename .blend")
    syncstatus._state["root"] = None
    syncstatus._state["asset_hash_cache"] = {}

    # Any cached evidence used by the polished panels must trigger redraw and
    # advance the lightweight table/UI revision, even when status/plan match.
    snapshot = syncstatus._ui_snapshot()
    evidence_token = syncstatus.change_token()
    ui_token = syncstatus._state["ui_token"]
    syncstatus._state["build_stats"] = {"bytes": 1234}
    syncstatus._state["manifest_content_hash"] = "stats-revision"
    expect(syncstatus._finish_refresh(snapshot, syncstatus._plan_source_snapshot())
           and syncstatus.change_token() == evidence_token
           and syncstatus._state["ui_token"] == ui_token + 1,
           "same-plan build statistics did not advance the UI revision")
    snapshot = syncstatus._ui_snapshot()
    evidence_token = syncstatus.change_token()
    ui_token = syncstatus._state["ui_token"]
    syncstatus._state["derived_assets"] = [{"kind": "state", "path": "cached.png"}]
    syncstatus._update_asset_signature()
    expect(syncstatus._finish_refresh(snapshot, syncstatus._plan_source_snapshot())
           and syncstatus.change_token() == evidence_token
           and syncstatus._state["ui_token"] == ui_token + 1,
           "same-plan published assets did not advance the UI revision")
    class ExplodingPlan:
        def __iter__(self):
            raise AssertionError("unchanged revision polling walked the full bake plan")

    snapshot = syncstatus._ui_snapshot()
    plan_source = syncstatus._plan_source_snapshot()
    syncstatus._state["bake_plan"] = ExplodingPlan()
    expect(not syncstatus._finish_refresh(snapshot, plan_source),
           "unchanged revision polling reported a false source change")
    syncstatus._state.update(
        bake_plan={"objects": [{"name": "stale"}]},
        plan={"stale": {"name": "stale"}},
        manifest={"generator": "blendlink", "stale": True},
        detail="stale-hash",
        hint="stale-command",
        build_stats={"bytes": 1234},
        optimization={"geometry": "meshopt"},
        texture_compression={"outputs": 1},
        texture_transforms=[{"name": "stale"}],
        incremental_bake={"reusedJobs": 1},
        derived_assets=[{"kind": "state", "path": "stale.png"}],
        asset_failures=["stale failure"],
        manifest_content_hash="stale-content",
        plan_signature="stale-plan",
        asset_signature="stale-assets",
    )
    syncstatus._clear_manifest_evidence(clear_content_hash=True)
    expect(syncstatus.bake_plan() is None
           and syncstatus._state["plan"] == {}
           and syncstatus._state["manifest"] is None
           and syncstatus._state["detail"] == ""
           and syncstatus._state["hint"] == ""
           and syncstatus._state["build_stats"] is None
           and syncstatus._state["optimization"] is None
           and syncstatus._state["texture_compression"] is None
           and syncstatus._state["texture_transforms"] == []
           and syncstatus._state["incremental_bake"] is None
           and syncstatus._state["derived_assets"] == []
           and syncstatus._state["asset_failures"] == []
           and syncstatus._state["manifest_content_hash"] == ""
           and syncstatus._state["plan_signature"] == ""
           and syncstatus._state["asset_signature"] == "",
           "losing a manifest left stale published evidence visible")

    # Exercise the real timer path as well as the clearing primitive: deleting
    # a previously loaded manifest must invalidate both lightweight revisions
    # and remove every projection before a panel can redraw stale evidence.
    with tempfile.TemporaryDirectory(prefix="blendlink-manifest-delete-") as tmp:
        root = Path(tmp)
        blend_path = root / "scene.blend"
        manifest_path = root / "src" / "generated" / "Scene.manifest.json"
        manifest_path.parent.mkdir(parents=True)
        (root / "blendlink.config.mjs").write_text("export default {}\n", encoding="utf8")
        blend_path.write_bytes(b"blend bytes")
        manifest_path.write_text(json.dumps({
            "generator": "blendlink",
            "schemaVersion": 3,
            "sourceBlend": str(blend_path),
            "blendBytesHash": syncstatus._hash_file(blend_path),
            "syncHint": "npx blendlink sync",
            "bakePlan": {"objects": [{"name": "Hero"}]},
            "stats": {"bytes": 11},
            "optimization": {"meshopt": True},
            "textureCompression": {"outputs": 1},
            "textureTransforms": [{"name": "Poster"}],
            "incrementalBake": {"reusedJobs": 1},
        }), encoding="utf8")
        real_bpy = syncstatus.bpy
        try:
            syncstatus.bpy = SimpleNamespace(
                data=SimpleNamespace(filepath=str(blend_path), is_dirty=False),
                context=bpy.context,
            )
            syncstatus.reset()
            syncstatus.refresh(force=True)
            expect(syncstatus._state["manifest"] is not None
                   and syncstatus.bake_plan() is not None
                   and syncstatus._state["build_stats"] is not None,
                   "manifest deletion fixture did not populate published evidence")
            real_hash_file = syncstatus._hash_file
            hash_calls = []
            def tracked_hash_file(path, length=16):
                hash_calls.append((str(path), length))
                return real_hash_file(path, length)
            syncstatus._hash_file = tracked_hash_file
            try:
                syncstatus.refresh(force=True)
            finally:
                syncstatus._hash_file = real_hash_file
            expect(not hash_calls,
                   f"forced metadata refresh rehashed unchanged scene/artifacts: {hash_calls}")
            syncstatus._state["bake_plan"] = ExplodingPlan()
            steady_change_token = syncstatus.change_token()
            steady_ui_token = syncstatus._state["ui_token"]
            expect(not syncstatus.refresh()
                   and syncstatus.change_token() == steady_change_token
                   and syncstatus._state["ui_token"] == steady_ui_token,
                   "steady timer refresh walked the bake plan or advanced a revision")
            previous_change_token = syncstatus.change_token()
            previous_ui_token = syncstatus._state["ui_token"]
            manifest_path.unlink()
            expect(syncstatus.refresh()
                   and syncstatus.status()[0] == "NO_MANIFEST"
                   and syncstatus._state["manifest_path"] is None
                   and syncstatus._state["manifest"] is None
                   and syncstatus._state["manifest_mtime"] == 0
                   and syncstatus._state["manifest_read_failure"] == ""
                   and syncstatus._state["manifest_rejections"] == []
                   and syncstatus._state["detail"] == ""
                   and syncstatus._state["hint"] == ""
                   and syncstatus.bake_plan() is None
                   and syncstatus._state["plan"] == {}
                   and syncstatus._state["build_stats"] is None
                   and syncstatus._state["optimization"] is None
                   and syncstatus._state["texture_compression"] is None
                   and syncstatus._state["texture_transforms"] == []
                   and syncstatus._state["incremental_bake"] is None
                   and syncstatus._state["derived_assets"] == []
                   and syncstatus._state["asset_failures"] == []
                   and syncstatus._state["manifest_content_hash"] == ""
                   and syncstatus._state["plan_signature"] == ""
                   and syncstatus._state["asset_signature"] == ""
                   and syncstatus.change_token() == previous_change_token + 1
                   and syncstatus._state["ui_token"] == previous_ui_token + 1,
                   "manifest deletion did not clear and revise all published evidence")
        finally:
            syncstatus.bpy = real_bpy
            syncstatus.reset()

    with tempfile.TemporaryDirectory(prefix="blendlink-manifest-ambiguity-") as tmp:
        root = Path(tmp)
        blend_path = root / "scene.blend"
        generated = root / "src" / "generated"
        generated.mkdir(parents=True)
        blend_path.write_bytes(b"scene")
        (root / "blendlink.config.mjs").write_text("export default {}\n", encoding="utf8")
        record = {
            "generator": "blendlink", "schemaVersion": 3,
            "sourceBlend": str(blend_path),
        }
        for name in ("Scene.manifest.json", "Stale.manifest.json"):
            (generated / name).write_text(json.dumps(record), encoding="utf8")
        expect(syncstatus._find_manifest(blend_path) is None
               and sum("multiple published results" in reason
                       for reason in syncstatus.manifest_rejections()) == 2,
               "ambiguous manifests were selected nondeterministically")
        syncstatus.reset()

    # --- sync runner: subprocess + progress protocol + exit handling ---
    syncrun = sys.modules[f"{PACKAGE}.syncrun"]
    with tempfile.TemporaryDirectory(prefix="blendlink-build-protocol-") as protocol_dir:
        protocol_log = Path(protocol_dir) / "build.log"
        syncrun._state["log_path"] = str(protocol_log)
        syncrun._state["tail"].clear()
        captured = StringIO()
        malformed = '##blendlink {"fraction": nope}'
        with redirect_stdout(captured):
            syncrun._handle_line(malformed)
        diagnostic = captured.getvalue()
        tail = "\n".join(syncrun._state["tail"])
        persisted = protocol_log.read_text(encoding="utf8")
        expect("malformed progress protocol" in diagnostic and malformed in diagnostic,
               f"malformed build protocol was not loud: {diagnostic!r}")
        expect("malformed progress protocol" in tail and malformed in tail,
               f"malformed build protocol was not retained in tail: {tail!r}")
        expect("malformed progress protocol" in persisted and malformed in persisted,
               f"malformed build protocol was not retained in log: {persisted!r}")
    work = Path(tempfile.mkdtemp(prefix="blendlink-syncrun-"))
    (work / "fake_sync.mjs").write_text(
        'const p = (fraction, label) => console.log("##blendlink " + JSON.stringify({ fraction, label }))\n'
        'p(0.2, "warming up")\n'
        'await new Promise(r => setTimeout(r, 150))\n'
        'p(0.7, "almost there")\n'
        'console.log("plain output line")\n'
        'p(1, "done")\n',
        encoding="utf8",
    )
    error = syncrun.start("node fake_sync.mjs", str(work))
    expect(error is None, f"syncrun.start failed: {error}")
    expect(syncrun.is_running(), "runner should be running")
    exit_code = syncrun.drain_blocking(timeout_seconds=60)
    expect(exit_code == 0, f"fake sync exited {exit_code}")
    fraction, label = syncrun.progress()
    expect(fraction == 1.0 and label == "done", f"progress ended at {fraction} {label!r}")
    expect(not syncrun.is_running(), "runner should have stopped")
    log_path = Path(syncrun.last_log_path())
    expect(log_path.exists() and "plain output line" in log_path.read_text(encoding="utf8"),
           "log file missing subprocess output")
    redraw_calls = []
    real_redraw_ui = handlers._tag_redraw_ui
    handlers._tag_redraw_ui = lambda: redraw_calls.append(True)
    try:
        syncrun._redraw()
    finally:
        handlers._tag_redraw_ui = real_redraw_ui
    expect(redraw_calls == [True],
           "completed website builds did not redraw native Properties evidence")

    # failing command surfaces a nonzero exit code
    error = syncrun.start("node -e \"process.exit(3)\"", str(work))
    expect(error is None, f"syncrun.start (fail case) errored: {error}")
    exit_code = syncrun.drain_blocking(timeout_seconds=60)
    expect(exit_code == 3, f"expected exit 3, got {exit_code}")

    # --- lightmap scale (texel weight) ---
    select_only(barrel)
    texel_token = handlers._bake_table_change_token
    bpy.ops.blendlink.set_texel_weight(weight=2.0)
    expect(abs(barrel["blendlink_texel_weight"] - 2.0) < 1e-6, "texel_weight not set")
    expect(handlers._bake_table_change_token == texel_token + 1,
           "lightmap-scale edits did not invalidate the live bake table")
    ui_data = barrel.id_properties_ui("blendlink_texel_weight").as_dict()
    expect("Lightmap scale" in ui_data.get("description", ""), f"texel_weight ui missing: {ui_data}")

    # --- bake-plan density readout (plan cached from the manifest) ---
    syncstatus._state["plan"] = {
        "Desk": {
            "name": "Desk", "pxPerMeter": 619.0, "uvShare": 0.031,
            "screenDensity": 249.0, "autoWeight": 2.0, "artistWeight": 1.0,
        },
    }
    entry = syncstatus.plan_for("Desk")
    expect(entry is not None and entry["pxPerMeter"] == 619.0, "plan_for lookup failed")
    expect(syncstatus.plan_for("Missing") is None, "plan_for must miss cleanly")
    lines = ui.density_summary(entry)
    expect(lines == ["619 px/m · 3.1% of atlas", "screen density 249 · auto 2x"],
           f"density summary wrong: {lines}")
    expect(ui.density_summary(None) == [], "empty plan should produce no lines")
    syncstatus._state["plan"] = {}
    syncstatus._state["incremental_bake"] = {
        "totalJobs": 2, "reusedJobs": 1, "rebuiltJobs": 1,
        "reused": ["state:lit:near"], "rebuilt": ["state:dark:near"],
        "invalidated": [{"job": "state:dark:near", "reason": "dependencies-changed"}],
        "execution": {
            "profile": "final", "durationMs": 75432, "samples": 128,
            "supersample": 2, "denoise": True,
            "deviceClass": "gpu", "backend": "optix",
            "jobs": [{
                "job": "state:dark:near", "status": "rebuilt",
                "durationMs": 74200, "effectiveSize": 4096,
            }],
        },
    }
    expect(syncstatus.incremental_bake()["rebuiltJobs"] == 1,
           "incremental bake report was not exposed to the UI")
    expect(ui._bake_duration_label(75432) == "1m 15s"
           and ui._bake_duration_label(432) == "0.4s",
           "measured bake duration labels are not artist-readable")

    # --- bake visibility: atlas/shading controls + exact published UV evidence ---
    bakelib = sys.modules[f"{PACKAGE}.bakelib"]

    # Blender 5+ owns an always-present shader tree and deprecates use_nodes;
    # older releases still need the switch when no tree exists. Keep both
    # branches executable without allowing modern reads/writes of that flag.
    shader_tree_sentinel = object()

    class ExistingShaderTree:
        name = "Existing Shader Tree"
        node_tree = shader_tree_sentinel

        @property
        def use_nodes(self):
            raise AssertionError("modern shader path read deprecated use_nodes")

        @use_nodes.setter
        def use_nodes(self, _value):
            raise AssertionError("modern shader path wrote deprecated use_nodes")

    existing_shader_owner = ExistingShaderTree()
    expect(
        bakelib.ensure_shader_node_tree(existing_shader_owner) is shader_tree_sentinel
        and bakelib.active_shader_node_tree(existing_shader_owner) is shader_tree_sentinel,
        "existing modern shader tree touched deprecated use_nodes",
    )

    class LegacyShaderTree:
        name = "Legacy Shader Tree"

        def __init__(self):
            self.node_tree = shader_tree_sentinel
            self.use_nodes = False

    canonical_bpy = bakelib.bpy
    try:
        bakelib.bpy = SimpleNamespace(app=SimpleNamespace(version=(4, 3, 0)))
        legacy_shader_owner = LegacyShaderTree()
        expect(
            bakelib.active_shader_node_tree(legacy_shader_owner) is None,
            "disabled Blender 4.x shader tree was treated as active",
        )
        legacy_shader_owner.use_nodes = True
        expect(
            bakelib.active_shader_node_tree(legacy_shader_owner) is shader_tree_sentinel,
            "enabled Blender 4.x shader tree was ignored",
        )
    finally:
        bakelib.bpy = canonical_bpy

    class DeferredShaderTree:
        name = "Deferred Shader Tree"

        def __init__(self, creates_tree=True):
            self.node_tree = None
            self.creates_tree = creates_tree
            self.enable_count = 0

        @property
        def use_nodes(self):
            return self.node_tree is not None

        @use_nodes.setter
        def use_nodes(self, value):
            self.enable_count += 1
            if value and self.creates_tree:
                self.node_tree = shader_tree_sentinel

    deferred_shader_owner = DeferredShaderTree()
    expect(
        bakelib.ensure_shader_node_tree(deferred_shader_owner) is shader_tree_sentinel
        and deferred_shader_owner.enable_count == 1,
        "legacy missing-tree fallback did not enable shader nodes exactly once",
    )
    broken_shader_owner = DeferredShaderTree(creates_tree=False)
    try:
        bakelib.ensure_shader_node_tree(broken_shader_owner)
    except RuntimeError as error:
        expect(
            "did not create a node tree" in str(error),
            f"missing shader-tree failure was not actionable: {error}",
        )
    else:
        raise AssertionError("missing shader tree failed silently")

    published_uvs = {}
    for obj, offset in ((crate, 0.125), (rock, 0.375)):
        previous = obj.data.uv_layers.get(bakelib.ATLAS_UV)
        if previous is not None:
            obj.data.uv_layers.remove(previous)
        layer = obj.data.uv_layers.new(name=bakelib.ATLAS_UV)
        source = obj.data.uv_layers[0]
        for target, original in zip(layer.data, source.data):
            target.uv = (original.uv.x * 0.25 + offset, original.uv.y * 0.25 + offset)
        published_uvs[obj.name] = [tuple(loop.uv) for loop in layer.data]
    crate["blendlink_id"] = "atlas-crate-stable-id"
    atlas_layout = bakelib.capture_packed_uv_evidence(
        [crate, rock], {crate.name: "near", rock.name: "far"},
    )
    atlas_layout["space"] = "final-glb-decoded"
    for obj in (crate, rock):
        obj.data.uv_layers.remove(obj.data.uv_layers.get(bakelib.ATLAS_UV))
    syncstatus._state["bake_plan"] = {
        "samples": 8, "marginPx": 12, "supersample": 1,
        "estimatedActiveAtlasGpuBytesRgba8Mipmapped": 436904,
        "atlases": {"near": {
                        "size": 256, "occupancy": 0.4, "objects": 1,
                        "estimatedGpuBytesRgba8Mipmapped": 349524,
                        "compositionDetail": {
                            "worstObject": "Crate-convcol",
                            "camera": "Website Camera",
                            "composition": "Desktop Hero",
                            "cssWidth": 1600, "cssHeight": 900,
                            "atlasTexelsPerCssPixelAt1x": 0.75,
                            "atlasTexelsPerDevicePixelAt2x": 0.375,
                        },
                    },
                    "far": {
                        "size": 128, "occupancy": 0.1, "objects": 1,
                        "estimatedGpuBytesRgba8Mipmapped": 87380,
                    }},
        "objects": [
            {"name": "Crate-convcol", "atlas": "near", "pxPerMeter": 512.0,
             "autoWeight": 2.0, "artistWeight": 1.0, "authored": True, "pinned": True},
            {"name": "Rock_LOD1", "atlas": "far", "autoWeight": 1.0, "artistWeight": 1.0},
        ],
        "dynamicObjects": [], "states": ["default"], "lightGroups": [], "bakeCount": 2,
        "atlasLayout": atlas_layout,
    }
    syncstatus._state["plan"] = {e["name"]: e for e in syncstatus._state["bake_plan"]["objects"]}
    atlas_evidence_layout = RecordingLayout()
    expect(ui._draw_active_atlas_gpu_estimate(
        atlas_evidence_layout, syncstatus._state["bake_plan"],
    ), "active atlas GPU evidence was not drawn")
    expect(ui._draw_atlas_plan_evidence(
        atlas_evidence_layout,
        "Near",
        syncstatus._state["bake_plan"]["atlases"]["near"],
        show_fix=True,
    ), "per-atlas plan evidence was not drawn")
    evidence_labels = [
        event[1] for event in atlas_evidence_layout.events if event[0] == "label"
    ]
    evidence_operators = [
        event[1:3] for event in atlas_evidence_layout.events if event[0] == "operator"
    ]
    expect(
        any("Active atlas GPU estimate" in label and "427 kB" in label
            and "RGBA8 mipmapped" in label for label in evidence_labels)
        and any("Near GPU estimate" in label and "341 kB" in label
                and "RGBA8 mipmapped" in label for label in evidence_labels),
        f"atlas GPU residency evidence was not artist-readable: {evidence_labels}",
    )
    expect(
        any("Worst screen detail" in label and "Crate-convcol" in label
            for label in evidence_labels)
        and any("Desktop Hero" in label and "1600×900" in label
                for label in evidence_labels)
        and any("0.75 atlas texels/CSS px" in label
                and "0.38/device px at DPR 2" in label
                for label in evidence_labels),
        f"compositionDetail worst-object evidence was hidden: {evidence_labels}",
    )
    expect(
        any(operator == "blendlink.select_issue" and text in {
            "Select Worst Object", "Select Worst",
        } for operator, text in evidence_operators)
        and any(operator == "blendlink.open_properties_context" and text in {
            "Fix in Texture Atlases", "Fix in Atlases",
        } for operator, text in evidence_operators),
        f"atlas evidence omitted Select/Fix affordances: {evidence_operators}",
    )
    empty_evidence_layout = RecordingLayout()
    expect(not ui._draw_atlas_plan_evidence(
        empty_evidence_layout, "Legacy", {}, show_fix=True,
    ) and empty_evidence_layout.events == [],
           "legacy plans invented unavailable GPU or composition evidence")
    select_only(crate)
    bpy.ops.blendlink.set_atlas(atlas="near")
    expect(crate["blendlink_atlas"] == "near", "set_atlas did not stamp the property")
    bpy.ops.blendlink.set_atlas(atlas="__AUTO__")
    expect("blendlink_atlas" not in crate, "set_atlas Auto did not remove the override")
    validation._state["dirty"] = False
    bpy.ops.blendlink.set_shading(mode="DYNAMIC")
    expect(crate["blendlink_dynamic"] == 1, "set_shading DYNAMIC failed")
    expect(validation.is_dirty(), "rendering-mode edits did not invalidate effective analysis")
    validation.recompute(bpy.context.scene)
    bpy.ops.blendlink.set_shading(mode="AUTO")
    expect("blendlink_dynamic" not in crate, "set_shading AUTO did not clear")
    validation.recompute(bpy.context.scene)
    bpy.ops.blendlink.select_atlas_objects(atlas="near")
    expect(crate.select_get(), "select_atlas_objects missed the near member")
    bpy.ops.blendlink.preview_atlas_uvs()
    expect(crate.data.uv_layers.get("BLENDLINK_ATLAS") is not None,
           "preview did not create the atlas UV layer")
    preview_layer_pointer = crate.data.uv_layers[ops.ATLAS_UV].as_pointer()
    expect(crate.data.uv_layers.active.name == "BLENDLINK_ATLAS",
           "preview did not activate the atlas UV layer")
    expect([tuple(loop.uv) for loop in crate.data.uv_layers[ops.ATLAS_UV].data]
           == published_uvs[crate.name],
           "preview did not reproduce the exact compressed published UV evidence")
    bad_layout = copy.deepcopy(atlas_layout)
    bad_layout["objects"][0]["topologyHash"] = "0" * 16
    refused = bakelib.apply_packed_uv_evidence([crate, rock], bad_layout)
    expect(any("topology differs" in item["reason"] for item in refused["skipped"]),
           f"topology mismatch was not refused: {refused}")
    crate_name = crate.name
    crate_id = crate["blendlink_id"]
    del crate["blendlink_id"]
    crate.name = f"{crate_name} moved"
    replacement_data = crate.data.copy()
    replacement = bpy.data.objects.new(crate_name, replacement_data)
    bpy.context.scene.collection.objects.link(replacement)
    stale_identity = bakelib.apply_packed_uv_evidence([crate, replacement], atlas_layout)
    expect(any("stable ID" in item["reason"] and "not present" in item["reason"]
               for item in stale_identity["skipped"]),
           f"same-name replacement received stale published UV evidence: {stale_identity}")
    bpy.data.objects.remove(replacement, do_unlink=True)
    bpy.data.meshes.remove(replacement_data)
    crate.name = crate_name
    crate["blendlink_id"] = crate_id
    bpy.ops.blendlink.preview_atlas_uvs()
    expect(crate.data.uv_layers[ops.ATLAS_UV].as_pointer() == preview_layer_pointer,
           "refreshing published UV evidence replaced the editable preview layer")
    ui_bake = sys.modules[f"{PACKAGE}.ui"]
    # ALWAYS visible — a poll-gated panel was invisible on external scenes
    # and read as broken.
    expect(not hasattr(ui_bake.BLENDLINK_PT_bake, "poll"),
           "bake panel must not be poll-gated")
    # Live authored overrides take precedence over the last plan and must use
    # the same artist-facing atlas-name resolver as every other surface.
    crate["blendlink_atlas"] = "near"
    bpy.ops.blendlink.refresh_bake_table()
    rows = bpy.context.window_manager.blendlink.bake_rows
    expect(len(rows) > 0, "bake table refresh produced no rows")
    crate_row = next((row for row in rows if row.name == crate.name), None)
    expect(crate_row is not None, "crate missing from bake table")
    expect(crate_row.shading == "baked", f"crate shading {crate_row.shading}")
    expect(crate_row.atlas == "Near", f"crate atlas label {crate_row.atlas}")
    expect(crate_row.authored and crate_row.pinned and crate_row.planned,
           "bake table hid authored/pinned plan ownership")
    expect("pinned islands stay locked" in ui._bake_row_uv_summary(crate_row),
           "active-row detail did not explain pinned atlas behavior")
    session = bpy.context.window_manager.blendlink
    expect(session.bake_row_index >= 0
           and session.bake_rows[session.bake_row_index].name == crate.name,
           "bake table refresh did not retain the active mesh row")
    del crate["blendlink_atlas"]

    # Scene selection is the primary Blender interaction. The msgbus target
    # reverse-syncs it into the table without requiring a refresh or row click.
    select_only(rock)
    handlers._on_active_object()
    expect(session.bake_row_index >= 0
           and session.bake_rows[session.bake_row_index].name == rock.name,
           "active-object msgbus callback did not reverse-sync the bake-table row")
    select_only(crate)
    handlers._on_active_object()

    # Automatic rebuild is token-gated: unchanged timer ticks do zero table
    # work, while either a live authoring token or published-plan token runs
    # exactly one rebuild.
    original_rebuild = ops.rebuild_bake_table
    rebuild_calls = []

    def counted_rebuild(context):
        rebuild_calls.append(handlers._bake_table_source_token())
        return original_rebuild(context)

    ops.rebuild_bake_table = counted_rebuild
    try:
        handlers.mark_bake_table_changed()
        expect(handlers._rebuild_bake_table_if_needed(bpy.context),
               "changed live token did not rebuild the bake table")
        expect(not handlers._rebuild_bake_table_if_needed(bpy.context)
               and len(rebuild_calls) == 1,
               f"unchanged table token rebuilt again: {rebuild_calls}")
        syncstatus._state["change_token"] += 1
        expect(handlers._rebuild_bake_table_if_needed(bpy.context)
               and len(rebuild_calls) == 2,
               "published plan/status token did not rebuild exactly once")
    finally:
        ops.rebuild_bake_table = original_rebuild

    # Timer failures remain pending for retry and print their cause. Swallowing
    # this would strand artists with a stale plan and no explanation.
    failed_calls = []

    def failed_rebuild(_context):
        failed_calls.append(True)
        raise RuntimeError("synthetic table failure")

    ops.rebuild_bake_table = failed_rebuild
    handlers.mark_bake_table_changed()
    failure_log = StringIO()
    try:
        with redirect_stdout(failure_log):
            first_failure = handlers._rebuild_bake_table_if_needed(bpy.context)
            second_failure = handlers._rebuild_bake_table_if_needed(bpy.context)
    finally:
        ops.rebuild_bake_table = original_rebuild
    expect(not first_failure and not second_failure and len(failed_calls) == 2,
           "failed bake-table rebuild consumed its token instead of retrying")
    expect("automatic bake-table rebuild failed: RuntimeError: synthetic table failure"
           in failure_log.getvalue(),
           f"automatic table failure was silent: {failure_log.getvalue()!r}")
    expect(handlers._rebuild_bake_table_if_needed(bpy.context),
           "automatic bake table did not heal after its failure cleared")

    filter_probe = type("FilterProbe", (), {
        "filter_name": "Crate",
        "bitflag_filter_item": 1 << 30,
        "use_filter_invert": False,
        "use_filter_sort_alpha": True,
    })()
    flags, order = ui.BLENDLINK_UL_bake_table.filter_items(
        filter_probe, bpy.context, session, "bake_rows",
    )
    crate_index = next(index for index, row in enumerate(rows) if row.name == crate.name)
    expect(flags[crate_index] != 0 and any(flag == 0 for flag in flags),
           "bake-table name filter did not isolate its matching row")
    expect(len(order) == len(rows), "bake-table alphabetical sort omitted rows")
    select_only(barrel)
    bpy.ops.blendlink.set_shading(mode="DYNAMIC")
    validation.mark_dirty()
    bpy.ops.blendlink.refresh_bake_table()
    expect(not validation.is_dirty(),
           "bake-table refresh persisted a pending rendering analysis")
    rows = bpy.context.window_manager.blendlink.bake_rows
    barrel_row = next((row for row in rows if row.name == barrel.name), None)
    expect(barrel_row is not None and barrel_row.shading == "realtime",
           "live dynamic override not reflected in the table")
    expect(bpy.context.window_manager.blendlink.bake_rows[
               bpy.context.window_manager.blendlink.bake_row_index
           ].name == barrel.name,
           "bake table did not follow the active mesh during refresh")
    bpy.ops.blendlink.set_shading(mode="AUTO")

    # --- UV control: one imported bake module, materialize, published preview,
    # checker cycle (inspect → materialize → edit → resync) ---
    expect(Path(bakelib.__file__).resolve()
           == (ADDON_DIR.parent / "blendlink" / "blender" / "bakelib.py").resolve(),
           f"source addon did not import canonical bakelib: {bakelib.__file__}")
    expect(ops.ATLAS_UV == bakelib.ATLAS_UV, "ATLAS_UV drifted from bakelib")
    expect(ops.AUTHORED_UV == bakelib.AUTHORED_UV, "AUTHORED_UV drifted from bakelib")
    expect(ops.CHECKER_MODIFIER == bakelib.CHECKER_MODIFIER,
           "CHECKER_MODIFIER drifted from bakelib")
    exporter_path = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"
    exporter_spec = importlib.util.spec_from_file_location("blendlink_export_scene", exporter_path)
    exporter = importlib.util.module_from_spec(exporter_spec)
    exporter_spec.loader.exec_module(exporter)
    run_exporter_conformance(exporter)
    run_unsupported_renderable_export_test(exporter)

    # Blender 5.2's evaluated Bevel UVs are not byte-reproducible across fresh
    # processes. Keep the detection narrow and never imply that Blendlink
    # rounded the authored UVs to hide the exporter limitation.
    bevel_uv_mesh = make_cube("Blendlink Bevel UV Reproducibility")
    bevel_uv_mesh.data.uv_layers.new(name="UVMap")
    bevel_uv = bevel_uv_mesh.modifiers.new(name="Website Bevel", type="BEVEL")
    reproducibility_warnings = exporter.bevel_uv_reproducibility_warnings(
        [bevel_uv_mesh],
        {"export_apply": True, "export_texcoords": True},
        blender_version=(5, 2, 0),
    )
    expect(
        len(reproducibility_warnings) == 1
        and bevel_uv_mesh.name in reproducibility_warnings[0]
        and "topology and rendered triangles stay stable" in reproducibility_warnings[0]
        and "preserves authored UV bytes" in reproducibility_warnings[0],
        f"Bevel UV reproducibility warning lost its narrow evidence: {reproducibility_warnings}",
    )
    bevel_uv.show_viewport = False
    expect(
        exporter.bevel_uv_reproducibility_warnings(
            [bevel_uv_mesh],
            {"export_apply": True, "export_texcoords": True},
            blender_version=(5, 2, 0),
        ) == []
        and exporter.bevel_uv_reproducibility_warnings(
            [bevel_uv_mesh],
            {"export_apply": True, "export_texcoords": True},
            blender_version=(5, 3, 0),
        ) == [],
        "Bevel UV warning escaped its enabled-modifier or Blender-5.2 scope",
    )
    bpy.data.objects.remove(bevel_uv_mesh, do_unlink=True)

    # --- punctual-light fidelity: Blender watts -> glTF compatibility units ---
    # Blender 5.2's SPEC exporter mode multiplies non-sun lights by the ideal
    # 683 lm/W efficacy. In Three that makes an ordinary Blender point light
    # exactly 683x brighter than the artist's Eevee/Cycles presentation.
    light_data = bpy.data.lights.new("Blendlink Light Fidelity", type="POINT")
    light_data.energy = 1000.0
    light_data.use_shadow = True
    light_object = bpy.data.objects.new("Blendlink Light Fidelity", light_data)
    bpy.context.scene.collection.objects.link(light_object)
    hidden_light_data = bpy.data.lights.new(
        "Blendlink Render Hidden Light", type="POINT",
    )
    hidden_light_data.energy = 5000.0
    hidden_light_object = bpy.data.objects.new(
        "Blendlink Render Hidden Light", hidden_light_data,
    )
    hidden_light_object.hide_render = True
    bpy.context.scene.collection.objects.link(hidden_light_object)
    hidden_light_collection = bpy.data.collections.new(
        "Blendlink Render Hidden Light Collection",
    )
    hidden_light_collection.hide_render = True
    bpy.context.scene.collection.children.link(hidden_light_collection)
    collection_hidden_data = bpy.data.lights.new(
        "Blendlink Collection Hidden Light", type="POINT",
    )
    collection_hidden_data.energy = 7500.0
    collection_hidden_object = bpy.data.objects.new(
        "Blendlink Collection Hidden Light", collection_hidden_data,
    )
    hidden_light_collection.objects.link(collection_hidden_object)
    hidden_light_parent = bpy.data.collections.new(
        "Blendlink Render Hidden Light Parent",
    )
    hidden_light_parent.hide_render = True
    bpy.context.scene.collection.children.link(hidden_light_parent)
    visible_hidden_child = bpy.data.collections.new(
        "Blendlink Visible Child Under Hidden Parent",
    )
    hidden_light_parent.children.link(visible_hidden_child)
    ancestor_hidden_data = bpy.data.lights.new(
        "Blendlink Ancestor Hidden Light", type="POINT",
    )
    ancestor_hidden_data.energy = 9000.0
    ancestor_hidden_object = bpy.data.objects.new(
        "Blendlink Ancestor Hidden Light", ancestor_hidden_data,
    )
    visible_hidden_child.objects.link(ancestor_hidden_object)
    spot_data = bpy.data.lights.new("Blendlink Spot Fidelity", type="SPOT")
    spot_data.energy = 200.0
    spot_data.exposure = -0.5
    spot_data.spot_size = 1.2
    spot_data.spot_blend = 0.25
    spot_data.use_shadow = False
    spot_data.use_custom_distance = True
    spot_data.cutoff_distance = 18.0
    spot_object = bpy.data.objects.new("Blendlink Spot Fidelity", spot_data)
    bpy.context.scene.collection.objects.link(spot_object)
    sun_data = bpy.data.lights.new("Blendlink Sun Fidelity", type="SUN")
    sun_data.energy = 3.0
    sun_data.exposure = 1.0
    sun_data.use_shadow = False
    sun_object = bpy.data.objects.new("Blendlink Sun Fidelity", sun_data)
    sun_object["blendlink_cast_shadow"] = True
    bpy.context.scene.collection.objects.link(sun_object)
    rect_parent = bpy.data.objects.new("Blendlink Rect Rotated Parent", None)
    rect_parent.rotation_euler = (0.35, -0.2, 0.6)
    bpy.context.scene.collection.objects.link(rect_parent)
    rect_square_data = bpy.data.lights.new(
        "Blendlink Rect Square Data", type="AREA",
    )
    rect_square_data.shape = "SQUARE"
    rect_square_data.size = 1.25
    rect_square_data.energy = 4.0
    rect_square_data.exposure = 1.0
    rect_square_data.normalize = True
    rect_square_object = bpy.data.objects.new(
        "Blendlink Rect Square", rect_square_data,
    )
    rect_square_object["blendlink_area_light_mode"] = "three-rect-area"
    rect_square_object.parent = rect_parent
    rect_square_object.scale = (2.0, 3.0, 1.0)
    bpy.context.scene.collection.objects.link(rect_square_object)
    rect_rectangle_data = bpy.data.lights.new(
        "Blendlink Rect Rectangle Data", type="AREA",
    )
    rect_rectangle_data.shape = "RECTANGLE"
    rect_rectangle_data.size = 2.0
    rect_rectangle_data.size_y = 3.5
    rect_rectangle_data.energy = 6.0
    rect_rectangle_data.exposure = 0.0
    rect_rectangle_data.normalize = False
    rect_rectangle_object = bpy.data.objects.new(
        "Blendlink Rect Rectangle", rect_rectangle_data,
    )
    rect_rectangle_object["blendlink_area_light_mode"] = "three-rect-area"
    rect_rectangle_object.parent = rect_parent
    rect_rectangle_object.scale = (1.5, 0.75, 1.0)
    bpy.context.scene.collection.objects.link(rect_rectangle_object)
    rect_omitted_data = bpy.data.lights.new(
        "Blendlink Rect Omitted Data", type="AREA",
    )
    rect_omitted_object = bpy.data.objects.new(
        "Blendlink Rect Omitted", rect_omitted_data,
    )
    rect_omitted_object["blendlink_area_light_mode"] = "three-rect-area"
    bpy.context.scene.collection.objects.link(rect_omitted_object)
    unselected_data = bpy.data.lights.new(
        "Blendlink Export Scope Omitted", type="POINT",
    )
    unselected_object = bpy.data.objects.new(
        "Blendlink Export Scope Omitted", unselected_data,
    )
    bpy.context.scene.collection.objects.link(unselected_object)
    other_scene = bpy.data.scenes.new("Blendlink Inactive Light Scene")
    other_scene_data = bpy.data.lights.new(
        "Blendlink Inactive Scene Light", type="POINT",
    )
    other_scene_data.energy = 12000.0
    other_scene_object = bpy.data.objects.new(
        "Blendlink Inactive Scene Light", other_scene_data,
    )
    other_scene.collection.objects.link(other_scene_object)
    layer_excluded_collection = bpy.data.collections.new(
        "Blendlink Active Layer Excluded Lights",
    )
    bpy.context.scene.collection.children.link(layer_excluded_collection)
    layer_excluded_data = bpy.data.lights.new(
        "Blendlink Active Layer Excluded Light", type="POINT",
    )
    layer_excluded_data.energy = 15000.0
    layer_excluded_object = bpy.data.objects.new(
        "Blendlink Active Layer Excluded Light", layer_excluded_data,
    )
    layer_excluded_collection.objects.link(layer_excluded_object)
    layer_excluded_mesh_data = bpy.data.meshes.new(
        "Blendlink Active Layer Excluded Mesh Data",
    )
    layer_excluded_mesh_data.from_pydata(
        [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        [], [(0, 1, 2)],
    )
    layer_excluded_mesh = bpy.data.objects.new(
        "Blendlink Active Layer Excluded Mesh", layer_excluded_mesh_data,
    )
    layer_excluded_material = bpy.data.materials.new(
        "Blendlink Active Layer Excluded Material",
    )
    layer_excluded_material.diffuse_color = (0.2, 0.3, 0.4, 1.0)
    layer_excluded_material.keyframe_insert(data_path="diffuse_color", frame=2)
    layer_excluded_mesh_data.materials.append(layer_excluded_material)
    layer_excluded_collection.objects.link(layer_excluded_mesh)
    layer_excluded = bpy.context.view_layer.layer_collection.children.get(
        layer_excluded_collection.name,
    )
    expect(layer_excluded is not None,
           "active View Layer did not expose its newly linked test collection")
    layer_excluded.exclude = True
    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active
    view = bpy.context.scene.view_settings
    display = bpy.context.scene.display_settings
    view_before = (
        view.view_transform, view.look, view.exposure, view.gamma,
        display.display_device,
    )
    world_before = bpy.context.scene.world
    render_engine_before = bpy.context.scene.render.engine
    film_transparent_before = bpy.context.scene.render.film_transparent
    curve_mapping_before = bool(getattr(view, "use_curve_mapping", False))
    white_balance_before = bool(getattr(view, "use_white_balance", False))
    preview_world = bpy.data.worlds.new("Blendlink Preview World")
    try:
        view.view_transform = "AgX"
        view.look = "None"
        view.exposure = 1.25
        view.gamma = 1.0
        display.display_device = "sRGB"

        # Preview World evidence is intentionally narrower than Blender's
        # shader language: a direct constant Background is exact, while a
        # linked value or any authored graph is omitted instead of guessed.
        bakelib.ensure_shader_node_tree(preview_world)
        preview_world.node_tree.nodes.clear()
        world_output = preview_world.node_tree.nodes.new("ShaderNodeOutputWorld")
        world_background = preview_world.node_tree.nodes.new("ShaderNodeBackground")
        world_background.inputs["Color"].default_value = (0.125, 0.25, 0.5, 1.0)
        world_background.inputs["Strength"].default_value = 2.75
        preview_world.node_tree.links.new(
            world_background.outputs["Background"], world_output.inputs["Surface"],
        )
        bpy.context.scene.world = preview_world
        node_world = exporter.collect_authoring_preview_world(bpy.context.scene)
        expect(
            node_world == {
                "color": [0.125, 0.25, 0.5],
                "strength": 2.75,
                "exact": True,
                "source": "background",
            },
            f"constant node World was not handed to Preview Studio exactly: {node_world}",
        )
        preview_with_world = exporter.collect_authoring_preview(bpy.context.scene)
        expect(
            preview_with_world.get("world") == {
                **node_world, "backgroundVisible": True,
            }, "authoring Preview omitted its exact constant World evidence",
        )
        bpy.context.scene.render.film_transparent = True
        transparent_preview = exporter.collect_authoring_preview(bpy.context.scene)
        expect(
            transparent_preview["world"]["backgroundVisible"] is False
            and transparent_preview["world"]["color"] == node_world["color"],
            "Film Transparent discarded World lighting or drew its background",
        )
        bpy.context.scene.render.film_transparent = False

        linked_strength = preview_world.node_tree.nodes.new("ShaderNodeValue")
        linked_strength.outputs["Value"].default_value = 4.0
        preview_world.node_tree.links.new(
            linked_strength.outputs["Value"], world_background.inputs["Strength"],
        )
        expect(
            exporter.collect_authoring_preview_world(bpy.context.scene) is None
            and "world" not in exporter.collect_authoring_preview(bpy.context.scene)
            and "world preview omitted" in exporter.collect_authoring_preview(
                bpy.context.scene,
            )["worldWarning"].lower()
            and "strength" in exporter.collect_authoring_preview(
                bpy.context.scene,
            )["worldWarning"].lower(),
            "linked World input was misleadingly reduced to a constant preview",
        )

        # Blender 5.2 deprecates switching a World back to legacy non-node
        # mode, so exercise that still-supported exporter branch with the
        # smallest data-only scene double instead of depending on deprecated
        # editor state mutation.
        legacy_world = exporter.collect_authoring_preview_world(SimpleNamespace(
            world=SimpleNamespace(use_nodes=False, color=(0.2, 0.3, 0.4)),
        ))
        expect(
            legacy_world is not None
            and legacy_world["source"] == "world-color"
            and legacy_world["exact"] is True
            and math.isclose(legacy_world["strength"], 1.0, rel_tol=0.0, abs_tol=1e-8)
            and all(math.isclose(actual, expected, rel_tol=0.0, abs_tol=1e-6)
                    for actual, expected in zip(legacy_world["color"], (0.2, 0.3, 0.4))),
            f"legacy constant World color did not cross the preview seam: {legacy_world}",
        )

        bpy.context.scene.world = world_before
        authoring_preview = exporter.collect_authoring_preview(bpy.context.scene)
        expect(authoring_preview["look"] == {
            "toneMapping": "agx",
            "exposure": 1.25,
            "previewExposureOffsetStops": -0.28,
            "sourceViewTransform": "AgX",
            "exact": False,
        } and authoring_preview["shadows"] == {"enabled": True}
               and any(
                   "-0.28-stop calibration" in warning
                   for warning in authoring_preview["warnings"]
               ),
               f"authoring Preview did not preserve Blender AgX/light intent: {authoring_preview}")
        preview_sidecar = exporter.collect_sidecar({}, None)
        expect(preview_sidecar["authoringPreview"] == authoring_preview
               and any(
                   item["object_name"] == light_object.name
                   for item in preview_sidecar["lightDiagnostics"]["lights"]
               ), "export sidecar omitted canonical authoring/light evidence")
        scoped_names = {
            obj.name for obj in exporter.diagnostic_export_objects(
                bpy.context.scene, view_layer=bpy.context.view_layer,
            )
        }
        scoped_materials = {
            item["material"]
            for item in preview_sidecar["diagnostics"]["materials"]
        }
        expect(layer_excluded_mesh.name not in scoped_names
               and layer_excluded_material.name not in scoped_materials,
               "active View Layer exclusions leaked into export material diagnostics")
        expect(any(
                   item["object"] == layer_excluded_mesh.name
                   for item in exporter.procedural.pointer_animation_issues(
                       bpy.context.scene,
                   )
               ) and not any(
                   item["object"] == layer_excluded_mesh.name
                   for item in exporter.procedural.pointer_animation_issues(
                       bpy.context.scene,
                       objects=exporter.diagnostic_export_objects(
                           bpy.context.scene, view_layer=bpy.context.view_layer,
                       ),
                   )
               ),
               "active View Layer exclusions leaked into pointer-animation policy")
        view.gamma = 1.2
        gamma_preview = exporter.collect_authoring_preview(bpy.context.scene)
        expect(not gamma_preview["look"]["exact"]
               and any("gamma" in warning.lower() for warning in gamma_preview["warnings"]),
               f"unsupported Blender gamma was silently presented as exact: {gamma_preview}")
        view.gamma = 1.0
        ownership_probe = {
            "warnings": ["unsupported look"],
            "worldWarning": "unsupported World",
        }
        expect(
            exporter.authoring_preview_warning_messages(
                ownership_probe, {
                    "look": {
                        "toneMapping": "neutral", "background": "color",
                    },
                    "environment": {
                        "source": "image", "lighting": "image",
                        "background": "image",
                    },
                },
            ) == [],
            "explicit website look/environment produced false authoring warnings",
        )
        expect(
            exporter.authoring_preview_warning_messages(
                ownership_probe, {
                    "look": {
                        "toneMapping": "application",
                        "background": "application",
                    },
                    "environment": {
                        "source": "application", "lighting": "application",
                        "background": "application",
                    },
                },
            ) == ["unsupported look", "unsupported World"],
            "application-owned preview evidence was silenced",
        )
        if hasattr(view, "use_curve_mapping"):
            view.use_curve_mapping = True
            curve_preview = exporter.collect_authoring_preview(bpy.context.scene)
            expect(not curve_preview["look"]["exact"]
                   and any("curve" in warning.lower()
                           for warning in curve_preview["warnings"]),
                   f"unsupported Blender display curve was labelled exact: {curve_preview}")
            view.use_curve_mapping = curve_mapping_before
        if hasattr(view, "use_white_balance"):
            view.use_white_balance = True
            white_preview = exporter.collect_authoring_preview(bpy.context.scene)
            expect(not white_preview["look"]["exact"]
                   and any("white balance" in warning.lower()
                           for warning in white_preview["warnings"]),
                   f"unsupported Blender white balance was labelled exact: {white_preview}")
            view.use_white_balance = white_balance_before

        # Enabling nodes in Cycles creates an ordinary Emission -> Light
        # Output graph. Blender's COMPAT exporter still takes Point/Spot
        # intensity from data.energy unless a Light Falloff node explicitly
        # owns Emission Strength, so the default graph remains predictable.
        try:
            bpy.context.scene.render.engine = "CYCLES"
            bakelib.ensure_shader_node_tree(light_data)
            bakelib.ensure_shader_node_tree(spot_data)
            expect(light_data.node_tree is not None
                   and spot_data.node_tree is not None,
                   "Cycles did not create default Point/Spot light node trees")
            cycles_analysis = exporter.weblights.analyze_scene(
                bpy.context.scene, view_layer=bpy.context.view_layer,
            )
            cycles_point = next(
                item for item in cycles_analysis.diagnostics
                if item.object_name == light_object.name
            )
            cycles_spot = next(
                item for item in cycles_analysis.diagnostics
                if item.object_name == spot_object.name
            )
            point_effective_energy = (
                light_data.energy * 2.0 ** light_data.exposure
            )
            spot_effective_energy = (
                spot_data.energy * 2.0 ** spot_data.exposure
            )
            expect(
                math.isclose(
                    cycles_point.expected_web_intensity,
                    point_effective_energy / (4.0 * math.pi),
                    rel_tol=1e-6,
                )
                and math.isclose(
                    cycles_point.expected_three_power,
                    point_effective_energy,
                    rel_tol=1e-6,
                ),
                "default Cycles Point nodes discarded numeric COMPAT "
                f"prediction: {cycles_point}",
            )
            expect(
                math.isclose(
                    cycles_spot.expected_web_intensity,
                    spot_effective_energy / (4.0 * math.pi),
                    rel_tol=1e-6,
                )
                and math.isclose(
                    cycles_spot.expected_three_power,
                    spot_effective_energy / 4.0,
                    rel_tol=1e-6,
                ),
                "default Cycles Spot nodes discarded numeric COMPAT "
                f"prediction: {cycles_spot}",
            )

            # Blender's exporter descends Shader Node Groups, while the
            # lightweight artist diagnostic intentionally treats that boundary
            # as opaque. Prove both halves: the UI must not guess a number, and
            # the real exporter must still publish the grouped Cycles strength.
            grouped_tree = bpy.data.node_groups.new(
                "Blendlink Grouped Light Graph", "ShaderNodeTree",
            )
            grouped_data = bpy.data.lights.new(
                "Blendlink Grouped Cycles Sun Data", type="SUN",
            )
            grouped_object = bpy.data.objects.new(
                "Blendlink Grouped Cycles Sun Object", grouped_data,
            )
            bpy.context.scene.collection.objects.link(grouped_object)
            try:
                grouped_tree.interface.new_socket(
                    name="Shader", in_out="OUTPUT",
                    socket_type="NodeSocketShader",
                )
                grouped_output = grouped_tree.nodes.new("NodeGroupOutput")
                grouped_emission = grouped_tree.nodes.new("ShaderNodeEmission")
                grouped_emission.inputs["Strength"].default_value = 7.0
                grouped_tree.links.new(
                    grouped_emission.outputs["Emission"],
                    grouped_output.inputs["Shader"],
                )
                grouped_data.energy = 1.0
                bakelib.ensure_shader_node_tree(grouped_data)
                grouped_nodes = grouped_data.node_tree.nodes
                grouped_nodes.clear()
                light_output = grouped_nodes.new("ShaderNodeOutputLight")
                group_node = grouped_nodes.new("ShaderNodeGroup")
                group_node.node_tree = grouped_tree
                grouped_data.node_tree.links.new(
                    group_node.outputs["Shader"], light_output.inputs["Surface"],
                )
                grouped_diagnostic = next(
                    item for item in exporter.weblights.analyze_scene(
                        bpy.context.scene, view_layer=bpy.context.view_layer,
                    ).diagnostics
                    if item.object_name == grouped_object.name
                )
                expect(
                    grouped_diagnostic.status
                    == exporter.weblights.STATUS_APPROXIMATED
                    and grouped_diagnostic.expected_web_intensity is None
                    and "Shader Node Group" in grouped_diagnostic.detail,
                    "grouped Cycles light graph received a false numeric "
                    f"website promise: {grouped_diagnostic}",
                )
                select_only(grouped_object)
                with tempfile.TemporaryDirectory(
                    prefix="blendlink-grouped-light-",
                ) as grouped_tmp:
                    grouped_glb = Path(grouped_tmp) / "grouped-light.glb"
                    grouped_kwargs, _ = exporter.gltf_export_contract(
                        str(grouped_glb), {
                            "imageFormat": "AUTO",
                            "exporterOverrides": {"use_selection": True},
                        },
                    )
                    grouped_restore = exporter.enforce_export_render_visibility(
                        bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=grouped_kwargs,
                    )
                    try:
                        bpy.ops.export_scene.gltf(**grouped_kwargs)
                    finally:
                        exporter.restore_export_render_visibility(grouped_restore)
                    grouped_bytes = grouped_glb.read_bytes()
                    grouped_json_length, grouped_json_type = struct.unpack_from(
                        "<II", grouped_bytes, 12,
                    )
                    expect(grouped_json_type == 0x4E4F534A,
                           "grouped Cycles light fixture has no glTF JSON chunk")
                    grouped_document = json.loads(
                        grouped_bytes[20:20 + grouped_json_length]
                        .decode("utf8").rstrip(" \0")
                    )
                    grouped_light = next(
                        item for item in grouped_document.get(
                            "extensions", {},
                        ).get("KHR_lights_punctual", {}).get("lights", [])
                        if item.get("name") == grouped_data.name
                    )
                    expect(
                        math.isclose(
                            float(grouped_light["intensity"]), 7.0,
                            rel_tol=1e-6,
                        ),
                        "Blender no longer exports grouped Cycles Sun strength "
                        f"through COMPAT as expected: {grouped_light}",
                    )
            finally:
                bpy.data.objects.remove(grouped_object, do_unlink=True)
                bpy.data.lights.remove(grouped_data)
                bpy.data.node_groups.remove(grouped_tree)
        finally:
            bpy.context.scene.render.engine = render_engine_before

        select_only(light_object)
        hidden_light_object.select_set(True)
        collection_hidden_object.select_set(True)
        ancestor_hidden_object.select_set(True)
        spot_object.select_set(True)
        sun_object.select_set(True)
        rect_parent.select_set(True)
        rect_square_object.select_set(True)
        rect_rectangle_object.select_set(True)
        with tempfile.TemporaryDirectory(prefix="blendlink-light-fidelity-") as tmp:
            light_glb = Path(tmp) / "light-fidelity.glb"
            light_kwargs, _light_dropped = exporter.gltf_export_contract(
                str(light_glb), {
                    "imageFormat": "AUTO",
                    "exporterOverrides": {"use_selection": True},
                },
            )
            lighting_mode = light_kwargs.get(
                "export_import_convert_lighting_mode",
                light_kwargs.get("convert_lighting_mode"),
            )
            expect(light_kwargs.get("export_lights") is True
                   and light_kwargs.get("use_renderable") is True
                   and light_kwargs.get("use_active_scene") is True
                   and lighting_mode == "COMPAT",
                   f"light-fidelity exporter policy was not owned: {light_kwargs}")
            for key, conflicting in (
                ("export_lights", False),
                ("use_renderable", False),
                ("use_active_scene", False),
                ("export_import_convert_lighting_mode", "SPEC"),
            ):
                if key not in light_kwargs:
                    continue
                try:
                    exporter.gltf_export_contract(str(light_glb), {
                        "exporterOverrides": {key: conflicting},
                    })
                except ValueError as error:
                    expect("light-fidelity contract" in str(error), str(error))
                else:
                    raise AssertionError(
                        f"exporter override silently replaced owned light setting {key}"
                    )
            for key in ("export_apply", "export_skins"):
                if key not in light_kwargs:
                    continue
                try:
                    exporter.gltf_export_contract(str(light_glb), {
                        "exporterOverrides": {key: False},
                    })
                except ValueError as error:
                    expect("evaluated-material contract" in str(error), str(error))
                else:
                    raise AssertionError(
                        "exporter override silently replaced evaluated-material "
                        f"setting {key}"
                    )

            # A normal scene export is active-scene-only, and active View
            # Layer exclusions must reach Blender's glTF exporter even though
            # that exporter does not consistently honor LayerCollection state.
            active_scene_glb = Path(tmp) / "active-scene-only.glb"
            active_scene_kwargs, _active_scene_dropped = \
                exporter.gltf_export_contract(
                    str(active_scene_glb), {"imageFormat": "AUTO"},
                )
            active_visibility_restore = \
                exporter.enforce_export_render_visibility(
                    bpy.context.scene,
                    view_layer=bpy.context.view_layer,
                    export_kwargs=active_scene_kwargs,
                )
            expect(
                layer_excluded_object.hide_render
                and any(
                    item[0] is layer_excluded_object
                    for item in active_visibility_restore
                ),
                "active LayerCollection exclusion was not translated for "
                "stock glTF export",
            )
            try:
                bpy.ops.export_scene.gltf(**active_scene_kwargs)
            finally:
                exporter.restore_export_render_visibility(
                    active_visibility_restore,
                )
            expect(
                not layer_excluded_object.hide_render,
                "temporary active LayerCollection visibility flag was not "
                "restored after export",
            )
            active_scene_bytes = active_scene_glb.read_bytes()
            active_json_length, active_json_type = struct.unpack_from(
                "<II", active_scene_bytes, 12,
            )
            expect(active_json_type == 0x4E4F534A,
                   "active-scene light fixture has no glTF JSON chunk")
            active_document = json.loads(
                active_scene_bytes[20:20 + active_json_length]
                .decode("utf8").rstrip(" \0")
            )
            active_light_names = {
                item.get("name")
                for item in active_document.get("extensions", {}).get(
                    "KHR_lights_punctual", {},
                ).get("lights", [])
            }
            expect(
                light_data.name in active_light_names
                and other_scene_data.name not in active_light_names
                and layer_excluded_data.name not in active_light_names,
                "active-scene or active View Layer light scope drifted: "
                f"{sorted(name for name in active_light_names if name)}",
            )
            visibility_restore = exporter.enforce_export_render_visibility(
                bpy.context.scene,
                view_layer=bpy.context.view_layer,
                export_kwargs=light_kwargs,
            )
            expect(
                ancestor_hidden_object.hide_render
                and any(item[0] is ancestor_hidden_object for item in visibility_restore),
                "hidden collection ancestor was not translated for stock glTF export",
            )
            expect(
                not any(
                    item[0] is layer_excluded_object
                    for item in visibility_restore
                ),
                "an unselected active-layer exclusion was mutated outside "
                "the selected glTF export scope",
            )
            try:
                bpy.ops.export_scene.gltf(**light_kwargs)
            finally:
                exporter.restore_export_render_visibility(visibility_restore)
            expect(
                not ancestor_hidden_object.hide_render,
                "temporary ancestor visibility flag was not restored after export",
            )
            glb = light_glb.read_bytes()
            json_length, json_type = struct.unpack_from("<II", glb, 12)
            expect(json_type == 0x4E4F534A,
                   "light-fidelity fixture has no glTF JSON chunk")
            document = json.loads(
                glb[20:20 + json_length].decode("utf8").rstrip(" \0")
            )
            exported_lights = document.get("extensions", {}).get(
                "KHR_lights_punctual", {},
            ).get("lights", [])
            expect(not any(
                item.get("name") in {
                    hidden_light_data.name, collection_hidden_data.name,
                    ancestor_hidden_data.name,
                }
                for item in exported_lights
            ), "object/collection/ancestor render-hidden Blender light leaked into the website GLB")
            exported_light = next(
                item for item in exported_lights
                if item.get("name") == light_data.name
            )
            expected_intensity = light_data.energy / (4.0 * math.pi)
            actual_intensity = float(exported_light["intensity"])
            expect(math.isclose(actual_intensity, expected_intensity, rel_tol=1e-6),
                   "point light exported "
                   f"{actual_intensity / expected_intensity:.6g}x brighter than "
                   "Blender-compatible glTF lighting")

            # Lock the root-cause ratio against Blender's real exporter as
            # well as Blendlink's chosen normal path. This is deliberately a
            # direct stock-exporter probe: gltf_export_contract() correctly
            # refuses callers that try to replace its owned COMPAT policy.
            lighting_key = (
                "export_import_convert_lighting_mode"
                if "export_import_convert_lighting_mode" in light_kwargs
                else "convert_lighting_mode"
            )
            spec_glb = Path(tmp) / "light-fidelity-spec-control.glb"
            spec_kwargs = {
                **light_kwargs,
                "filepath": str(spec_glb),
                lighting_key: "SPEC",
            }
            spec_visibility_restore = exporter.enforce_export_render_visibility(
                bpy.context.scene,
                view_layer=bpy.context.view_layer,
                export_kwargs=spec_kwargs,
            )
            try:
                bpy.ops.export_scene.gltf(**spec_kwargs)
            finally:
                exporter.restore_export_render_visibility(
                    spec_visibility_restore,
                )
            spec_bytes = spec_glb.read_bytes()
            spec_json_length, spec_json_type = struct.unpack_from(
                "<II", spec_bytes, 12,
            )
            expect(spec_json_type == 0x4E4F534A,
                   "SPEC control fixture has no glTF JSON chunk")
            spec_document = json.loads(
                spec_bytes[20:20 + spec_json_length]
                .decode("utf8").rstrip(" \0")
            )
            spec_light = next(
                item for item in spec_document.get("extensions", {}).get(
                    "KHR_lights_punctual", {},
                ).get("lights", [])
                if item.get("name") == light_data.name
            )
            spec_intensity = float(spec_light["intensity"])
            expect(
                math.isclose(
                    spec_intensity / actual_intensity, 683.0, rel_tol=1e-6,
                ),
                "Blender's SPEC/COMPAT point-light ratio changed; update the "
                "light-fidelity rationale and policy instead of compensating "
                f"blindly ({spec_intensity / actual_intensity:g}x)",
            )
            # Point, spot, and sun each exercise a different KHR punctual
            # contract. Keep the stock exporter's already-correct range and
            # cone mapping locked beside Blendlink's owned unit conversion.
            by_name = {item.get("name"): item for item in exported_lights}
            exported_spot = by_name[spot_data.name]
            expected_spot = spot_data.energy / (4.0 * math.pi) * 2 ** spot_data.exposure
            expect(math.isclose(
                float(exported_spot["intensity"]), expected_spot, rel_tol=1e-6,
            ) and math.isclose(
                float(exported_spot["range"]), spot_data.cutoff_distance, rel_tol=1e-6,
            ) and math.isclose(
                float(exported_spot["spot"]["outerConeAngle"]),
                spot_data.spot_size / 2.0, rel_tol=1e-6,
            ) and math.isclose(
                float(exported_spot["spot"]["innerConeAngle"]),
                spot_data.spot_size / 2.0 * (1.0 - spot_data.spot_blend),
                rel_tol=1e-6,
            ), f"spot light energy/range/cone drifted: {exported_spot}")
            exported_sun = by_name[sun_data.name]
            expected_sun = sun_data.energy * 2 ** sun_data.exposure
            expect(math.isclose(
                float(exported_sun["intensity"]), expected_sun, rel_tol=1e-6,
            ), f"sun irradiance drifted: {exported_sun}")
            stock_light_glb = light_glb.read_bytes()
            light_contract, published_light_objects, published_rect_area_objects, light_document_node_names = \
                exporter.normalize_light_shadow_extras_glb(
                    str(light_glb), bpy.context.scene,
                    view_layer=bpy.context.view_layer,
                    export_kwargs=light_kwargs,
                )
            normalized_glb = light_glb.read_bytes()
            normalized_json_length, _ = struct.unpack_from("<II", normalized_glb, 12)
            normalized_document = json.loads(
                normalized_glb[20:20 + normalized_json_length]
                .decode("utf8").rstrip(" \0")
            )
            normalized_nodes = {
                node.get("name"): node for node in normalized_document.get("nodes", [])
            }
            descriptor_key = "blendlink_rect_area_light"
            expected_square_descriptor = {
                "schemaVersion": 1,
                "color": [1.0, 1.0, 1.0],
                "size": [1.25, 1.25],
                "power": 8.0,
            }
            expected_rectangle_descriptor = {
                "schemaVersion": 1,
                "color": [1.0, 1.0, 1.0],
                "size": [2.0, 3.5],
                "intensity": 6.0 / math.pi,
            }
            square_node = normalized_nodes[rect_square_object.name]
            rectangle_node = normalized_nodes[rect_rectangle_object.name]
            square_descriptor = square_node.get("extras", {}).get(descriptor_key)
            rectangle_descriptor = rectangle_node.get("extras", {}).get(
                descriptor_key,
            )
            expect(
                square_descriptor == expected_square_descriptor
                and rectangle_descriptor is not None
                and rectangle_descriptor.get("schemaVersion") == 1
                and rectangle_descriptor.get("color") == [1.0, 1.0, 1.0]
                and rectangle_descriptor.get("size") == [2.0, 3.5]
                and set(rectangle_descriptor) == {
                    "schemaVersion", "color", "size", "intensity",
                }
                and math.isclose(
                    float(rectangle_descriptor["intensity"]),
                    expected_rectangle_descriptor["intensity"],
                    rel_tol=1e-12,
                ),
                "Rect Area normalized-power or intensity descriptor drifted: "
                f"{square_descriptor}, {rectangle_descriptor}",
            )
            expect(
                "KHR_lights_punctual" not in square_node.get("extensions", {})
                and "KHR_lights_punctual" not in rectangle_node.get("extensions", {})
                and (
                    rect_omitted_object.name not in normalized_nodes
                    or descriptor_key not in normalized_nodes[
                        rect_omitted_object.name
                    ].get("extras", {})
                ),
                "Rect Area descriptors must stay ordinary selected glTF nodes "
                "without inventing KHR punctual lights or leaking omitted opt-ins",
            )
            normalized_node_list = normalized_document.get("nodes", [])
            normalized_indices = {
                node.get("name"): index
                for index, node in enumerate(normalized_node_list)
                if isinstance(node.get("name"), str)
            }
            parent_node = normalized_nodes[rect_parent.name]
            rectangle_scale = rectangle_node.get("scale", [1.0, 1.0, 1.0])
            expect(
                normalized_indices[rect_square_object.name]
                in parent_node.get("children", [])
                and normalized_indices[rect_rectangle_object.name]
                in parent_node.get("children", [])
                and parent_node.get("rotation") is not None
                and parent_node.get("rotation") != [0.0, 0.0, 0.0, 1.0]
                and len({round(abs(float(value)), 6)
                         for value in rectangle_scale}) > 1,
                "rotated-parent or unequal Rect Area transform evidence was lost: "
                f"parent={parent_node}, rectangle={rectangle_node}",
            )
            rect_evidence = {
                item["sourceObjectName"]: item
                for item in light_contract["rectAreaLights"]
            }
            expect(
                set(rect_evidence) == {
                    rect_square_object.name, rect_rectangle_object.name,
                }
                and rect_evidence[rect_square_object.name] == {
                    "sourceObjectName": rect_square_object.name,
                    "nodeName": rect_square_object.name,
                    "descriptor": expected_square_descriptor,
                    "attachment": "attached",
                }
                and rect_evidence[rect_rectangle_object.name]["descriptor"]
                == rectangle_descriptor
                and rect_evidence[rect_rectangle_object.name]["attachment"]
                == "attached"
                and len(published_rect_area_objects) == 2
                and {item.as_pointer() for item in published_rect_area_objects}
                == {
                    rect_square_object.as_pointer(),
                    rect_rectangle_object.as_pointer(),
                }
                and descriptor_key not in rect_square_object
                and descriptor_key not in rect_rectangle_object,
                "finished Rect Area evidence was incomplete or mutated Blender "
                f"source objects: {light_contract['rectAreaLights']}",
            )
            expect(
                normalized_nodes[spot_object.name]["extras"][
                    "blendlink_cast_shadow"
                ] is False
                and normalized_nodes[sun_object.name]["extras"][
                    "blendlink_cast_shadow"
                ] is True,
                "native per-light shadow off or explicit Blendlink override was lost",
            )
            expect(
                light_contract["patchedNativeShadowOff"] == [spot_object.name]
                and unselected_object.name
                not in light_contract["publishedSourceObjectNames"]
                and rect_omitted_object.name
                not in light_contract["publishedSourceObjectNames"]
                and light_object.name in light_document_node_names
                and "blendlink_cast_shadow" not in spot_object,
                f"light GLB normalization mutated source or guessed export scope: {light_contract}",
            )
            scoped_analysis = exporter.weblights.analyze_scene(
                bpy.context.scene,
                published_object_names=set(
                    light_contract["publishedSourceObjectNames"],
                ),
                published_source_objects=published_light_objects,
                published_rect_area_objects=published_rect_area_objects,
            )
            omitted = next(
                item for item in scoped_analysis.diagnostics
                if item.object_name == unselected_object.name
            )
            expect(
                omitted.status == exporter.weblights.STATUS_NOT_EXPORTED
                and omitted.visibility.code == "exportScope",
                f"selection-omitted light was promised as published: {omitted}",
            )
            rect_diagnostics = {
                item.object_name: item for item in scoped_analysis.diagnostics
                if item.object_name in {
                    rect_square_object.name,
                    rect_rectangle_object.name,
                    rect_omitted_object.name,
                }
            }
            expect(
                rect_diagnostics[rect_square_object.name].outcome
                == exporter.weblights.OUTCOME_APPROXIMATED
                and rect_diagnostics[rect_rectangle_object.name].outcome
                == exporter.weblights.OUTCOME_APPROXIMATED
                and rect_diagnostics[rect_omitted_object.name].visibility.code
                == "exportScope"
                and not any(
                    warning.blocking
                    for warning in scoped_analysis.warnings
                    if warning.object_name in {
                        rect_square_object.name, rect_rectangle_object.name,
                    }
                ),
                "finished Rect Area evidence did not resolve final diagnostics: "
                f"{rect_diagnostics}, {scoped_analysis.warnings}",
            )

            # Existing node extras are untrusted input. Explicit JSON null,
            # unknown schemas, changed source facts, and descriptors on an
            # unattested node must all fail loudly before any GLB rewrite.
            conflict_cases = (
                (
                    "null", rect_square_object.name, None,
                    "existing node extra is invalid",
                ),
                (
                    "schema", rect_square_object.name,
                    {**expected_square_descriptor, "schemaVersion": 2},
                    "existing node extra is invalid",
                ),
                (
                    "strength", rect_square_object.name,
                    {**expected_square_descriptor, "power": 9.0},
                    "conflicts with the compiled source plan",
                ),
                (
                    "unattested", rect_parent.name,
                    expected_square_descriptor,
                    "contains an unattested",
                ),
            )
            for label, target_name, payload, expected_error in conflict_cases:
                conflict_glb = Path(tmp) / f"rect-area-{label}.glb"
                conflict_glb.write_bytes(stock_light_glb)
                conflict_document, conflict_chunks, conflict_json_index = \
                    exporter._read_glb_document(
                        str(conflict_glb), f"prepare {label} Rect Area fixture",
                    )
                conflict_node = next(
                    node for node in conflict_document.get("nodes", [])
                    if node.get("name") == target_name
                )
                conflict_node.setdefault("extras", {})[descriptor_key] = \
                    copy.deepcopy(payload)
                exporter._write_glb_document(
                    str(conflict_glb), conflict_document, conflict_chunks,
                    conflict_json_index, f"prepare-{label}-rect-area",
                )
                try:
                    exporter.normalize_light_shadow_extras_glb(
                        str(conflict_glb), bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=light_kwargs,
                    )
                except ValueError as error:
                    expect(
                        expected_error in str(error),
                        f"{label} Rect Area conflict produced the wrong failure: {error}",
                    )
                else:
                    raise AssertionError(
                        f"{label} Rect Area conflict was silently accepted"
                    )

            additive_glb = Path(tmp) / "rect-area-additive-v1.glb"
            additive_glb.write_bytes(stock_light_glb)
            additive_document, additive_chunks, additive_json_index = \
                exporter._read_glb_document(
                    str(additive_glb), "prepare additive Rect Area fixture",
                )
            additive_node = next(
                node for node in additive_document.get("nodes", [])
                if node.get("name") == rect_square_object.name
            )
            additive_descriptor = {
                **expected_square_descriptor,
                "futureAdditiveField": {"kept": True},
            }
            additive_node.setdefault("extras", {})[descriptor_key] = \
                additive_descriptor
            exporter._write_glb_document(
                str(additive_glb), additive_document, additive_chunks,
                additive_json_index, "prepare-additive-rect-area",
            )
            additive_contract, _, _, _ = \
                exporter.normalize_light_shadow_extras_glb(
                    str(additive_glb), bpy.context.scene,
                    view_layer=bpy.context.view_layer,
                    export_kwargs=light_kwargs,
                )
            additive_evidence = next(
                item for item in additive_contract["rectAreaLights"]
                if item["sourceObjectName"] == rect_square_object.name
            )
            expect(
                additive_evidence["attachment"] == "existing"
                and additive_evidence["descriptor"] == additive_descriptor,
                "valid additive v1 Rect Area fields were canonicalized away: "
                f"{additive_evidence}",
            )

        # Collection instances publish their source lights even though those
        # source objects are not members of scene.objects. Resolve the finished
        # glTF nodes back through bpy.data, patch every instance, and diagnose
        # the source once instead of aborting or silently dropping shadows.
        instance_collection = bpy.data.collections.new(
            "Blendlink Instanced Light Source",
        )
        instance_light_data = bpy.data.lights.new(
            "Blendlink Instanced Lamp Data", type="POINT",
        )
        instance_light_data.use_shadow = False
        instance_light_object = bpy.data.objects.new(
            "Blendlink Instanced Lamp Object", instance_light_data,
        )
        instance_collection.objects.link(instance_light_object)
        instance_area_data = bpy.data.lights.new(
            "Blendlink Instanced Area Data", type="AREA",
        )
        instance_area_object = bpy.data.objects.new(
            "Blendlink Instanced Area Object", instance_area_data,
        )
        instance_collection.objects.link(instance_area_object)
        instance_noimp_object = bpy.data.objects.new(
            "Blendlink Instanced Guide-noimp", None,
        )
        instance_collection.objects.link(instance_noimp_object)
        instance_hidden_collection = bpy.data.collections.new(
            "Blendlink Instanced Hidden Child",
        )
        instance_hidden_collection.hide_render = True
        instance_collection.children.link(instance_hidden_collection)
        instance_hidden_data = bpy.data.lights.new(
            "Blendlink Instanced Hidden Nested Data", type="POINT",
        )
        instance_hidden_object = bpy.data.objects.new(
            "Blendlink Instanced Hidden Nested Object", instance_hidden_data,
        )
        instance_hidden_collection.objects.link(instance_hidden_object)
        instance_a = bpy.data.objects.new("Blendlink Lamp Instance A", None)
        instance_b = bpy.data.objects.new("Blendlink Lamp Instance B", None)
        for index, instance in enumerate((instance_a, instance_b)):
            instance.instance_type = "COLLECTION"
            instance.instance_collection = instance_collection
            instance.location.x = float(index * 3)
            bpy.context.scene.collection.objects.link(instance)
        try:
            select_only(instance_a, instance_b)
            expect(
                instance_noimp_object in exporter.noimp_objects(),
                "a -noimp object inside a visible Collection Instance was "
                "not recognized by exporter exclusion",
            )
            with tempfile.TemporaryDirectory(
                prefix="blendlink-instanced-light-",
            ) as tmp:
                instance_glb = Path(tmp) / "instanced-light.glb"
                instance_kwargs, _instance_dropped = exporter.gltf_export_contract(
                    str(instance_glb), {
                        "imageFormat": "AUTO",
                        "exporterOverrides": {"use_selection": True},
                    },
                )
                instance_visibility_restore = \
                    exporter.enforce_export_render_visibility(
                        bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=instance_kwargs,
                    )
                expect(
                    instance_hidden_object.hide_render
                    and instance_hidden_collection.objects.get(
                        instance_hidden_object.name,
                    ) is None
                    and any(
                        item[0] is instance_hidden_object
                        for item in instance_visibility_restore
                    ),
                    "render-hidden nested Collection Instance light was not "
                    "translated for stock glTF export",
                )
                try:
                    bpy.ops.export_scene.gltf(**instance_kwargs)
                finally:
                    exporter.restore_export_render_visibility(
                        instance_visibility_restore,
                    )
                expect(
                    not instance_hidden_object.hide_render
                    and instance_hidden_collection.objects.get(
                        instance_hidden_object.name,
                    ) is instance_hidden_object,
                    "nested Collection Instance light visibility/membership "
                    "was not restored exactly after export",
                )
                instance_area_object[
                    exporter.weblights.AREA_LIGHT_MODE_PROPERTY
                ] = exporter.weblights.AREA_LIGHT_MODE_THREE_RECT
                try:
                    exporter.normalize_light_shadow_extras_glb(
                        str(instance_glb), bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=instance_kwargs,
                    )
                except ValueError as error:
                    message = str(error)
                    expect(
                        "sourced through a Collection Instance" in message
                        and "cannot yet prove the composed instance transform" in message
                        and "Eevee micro-size thresholds" in message,
                        "Collection Instance Rect Area produced the "
                        f"wrong refusal: {error}",
                    )
                else:
                    raise AssertionError(
                        "Collection Instance Rect Area was attached without a "
                        "proven composed transform"
                    )
                finally:
                    instance_area_object.pop(
                        exporter.weblights.AREA_LIGHT_MODE_PROPERTY, None,
                    )
                instance_contract, instance_sources, _instance_rect_sources, instance_document_node_names = \
                    exporter.normalize_light_shadow_extras_glb(
                        str(instance_glb), bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=instance_kwargs,
                    )
                instance_bytes = instance_glb.read_bytes()
                instance_json_length, instance_json_type = struct.unpack_from(
                    "<II", instance_bytes, 12,
                )
                expect(instance_json_type == 0x4E4F534A,
                       "collection-instance fixture has no glTF JSON chunk")
                instance_document = json.loads(
                    instance_bytes[20:20 + instance_json_length]
                    .decode("utf8").rstrip(" \0")
                )
                instance_exported_light_names = {
                    item.get("name")
                    for item in instance_document.get("extensions", {}).get(
                        "KHR_lights_punctual", {},
                    ).get("lights", [])
                }
                instance_source_evidence = \
                    exporter.published_instance_source_objects(
                        bpy.context.scene,
                        instance_document_node_names,
                        view_layer=bpy.context.view_layer,
                    )
                expect(
                    instance_contract["exportedNodeNames"].count(
                        instance_light_object.name,
                    ) == 2
                    and instance_contract["publishedSourceObjectNames"]
                    == [instance_light_object.name]
                    and instance_contract["patchedNativeShadowOff"]
                    == [instance_light_object.name]
                    and instance_contract["shadowsEnabled"] is False
                    and instance_contract["rectAreaFallbacks"] == [{
                        "sourceObjectName": instance_area_object.name,
                        "code": "rect-area-instance-transform-unproven",
                        "detail": (
                            "the Area light is sourced through a Collection "
                            "Instance. Rect Area v1 cannot yet prove the "
                            "composed instance transform or Eevee micro-size "
                            "thresholds from the source object alone."
                        ),
                    }]
                    and instance_sources == [instance_light_object]
                    and instance_hidden_data.name
                    not in instance_exported_light_names
                    and instance_area_data.name
                    not in instance_exported_light_names
                    and instance_area_object in instance_source_evidence
                    and instance_hidden_object not in instance_source_evidence
                    and "blendlink_cast_shadow" not in instance_light_object,
                    "collection-instance light scope/shadows were not finalized exactly: "
                    f"{instance_contract}",
                )
                instance_preview = exporter.collect_authoring_preview(
                    bpy.context.scene,
                    published_light_objects=instance_sources,
                )
                instance_analysis = exporter.weblights.analyze_scene(
                    bpy.context.scene,
                    published_object_names=set(
                        instance_contract["publishedSourceObjectNames"],
                    ),
                    published_source_objects=instance_sources,
                    instance_source_objects=instance_source_evidence,
                    view_layer=bpy.context.view_layer,
                    rect_area_artifact_fallbacks={
                        item["sourceObjectName"]:
                            exporter.weblights.RectAreaLightIssue(
                                item["code"], item["detail"],
                            )
                        for item in instance_contract["rectAreaFallbacks"]
                    },
                )
                instance_diagnostics = [
                    item for item in instance_analysis.diagnostics
                    if item.object_name == instance_light_object.name
                ]
                area_diagnostics = [
                    item for item in instance_analysis.diagnostics
                    if item.object_name == instance_area_object.name
                ]
                expect(
                    instance_preview["shadows"] == {"enabled": False},
                    f"instanced native shadow-off light enabled global shadows: {instance_preview}",
                )
                expect(
                    len(instance_diagnostics) == 1
                    and instance_diagnostics[0].visibility.code
                    == "collectionInstance",
                    "collection-instance source was omitted, duplicated, or labelled out of scene: "
                    f"{instance_diagnostics}",
                )
                expect(
                    len(area_diagnostics) == 1
                    and area_diagnostics[0].visibility.code
                    == "collectionInstance"
                    and area_diagnostics[0].outcome
                    == exporter.weblights.OUTCOME_BAKE_ONLY
                    and any(
                        item.object_name == instance_area_object.name
                        and item.code == "rect-area-auto-artifact-bake-only"
                        and not item.blocking
                        for item in instance_analysis.warnings
                    ),
                    "automatic instanced AREA without a proven composed transform "
                    "was not diagnosed exactly once as a safe artifact fallback: "
                    f"{area_diagnostics}",
                )
        finally:
            bpy.data.objects.remove(instance_a, do_unlink=True)
            bpy.data.objects.remove(instance_b, do_unlink=True)
            bpy.data.objects.remove(instance_noimp_object, do_unlink=True)
            bpy.data.objects.remove(instance_area_object, do_unlink=True)
            bpy.data.lights.remove(instance_area_data)
            bpy.data.objects.remove(instance_hidden_object, do_unlink=True)
            bpy.data.lights.remove(instance_hidden_data)
            bpy.data.objects.remove(instance_light_object, do_unlink=True)
            bpy.data.lights.remove(instance_light_data)
            bpy.data.collections.remove(instance_hidden_collection)
            bpy.data.collections.remove(instance_collection)

        # One source mesh can be hidden on its direct scene path yet visible
        # through a Collection Instance. Blender's stock glTF exporter emits
        # both occurrences; object-level hide/unlink cannot remove only one.
        # Blendlink must block before changing any authored datablock.
        mixed_hidden_parent = bpy.data.collections.new(
            "Blendlink Mixed Visibility Hidden Parent",
        )
        mixed_hidden_parent.hide_render = True
        mixed_source_collection = bpy.data.collections.new(
            "Blendlink Mixed Visibility Source",
        )
        bpy.context.scene.collection.children.link(mixed_hidden_parent)
        mixed_hidden_parent.children.link(mixed_source_collection)
        mixed_source = make_cube("Blendlink Mixed Visibility Mesh")
        for collection in list(mixed_source.users_collection):
            collection.objects.unlink(mixed_source)
        mixed_source_collection.objects.link(mixed_source)
        mixed_instance = bpy.data.objects.new(
            "Blendlink Mixed Visibility Instance", None,
        )
        mixed_instance.instance_type = "COLLECTION"
        mixed_instance.instance_collection = mixed_source_collection
        bpy.context.scene.collection.objects.link(mixed_instance)
        mixed_error = None
        try:
            with tempfile.TemporaryDirectory(
                    prefix="blendlink-mixed-visibility-") as mixed_tmp:
                mixed_kwargs, _ = exporter.gltf_export_contract(
                    str(Path(mixed_tmp) / "mixed.glb"), {"imageFormat": "AUTO"},
                )
                try:
                    exporter.enforce_export_render_visibility(
                        bpy.context.scene,
                        view_layer=bpy.context.view_layer,
                        export_kwargs=mixed_kwargs,
                    )
                except RuntimeError as error:
                    mixed_error = str(error)
            expect(
                mixed_error is not None
                and "mixed direct/Collection Instance" in mixed_error
                and mixed_source.name in mixed_error
                and not mixed_source.hide_render
                and mixed_source_collection.objects.get(mixed_source.name)
                    is mixed_source,
                f"mixed occurrence visibility was not blocked transactionally: {mixed_error}",
            )
        finally:
            bpy.data.objects.remove(mixed_instance, do_unlink=True)
            bpy.data.objects.remove(mixed_source, do_unlink=True)
            bpy.context.scene.collection.children.unlink(mixed_hidden_parent)
            bpy.data.collections.remove(mixed_source_collection)
            bpy.data.collections.remove(mixed_hidden_parent)
    finally:
        bpy.context.scene.world = world_before
        bpy.context.scene.render.film_transparent = film_transparent_before
        bpy.context.scene.render.engine = render_engine_before
        bpy.data.worlds.remove(preview_world)
        view.view_transform, view.look, view.exposure, view.gamma, display.display_device = view_before
        if hasattr(view, "use_curve_mapping"):
            view.use_curve_mapping = curve_mapping_before
        if hasattr(view, "use_white_balance"):
            view.use_white_balance = white_balance_before
        layer_excluded.exclude = False
        bpy.data.objects.remove(layer_excluded_mesh, do_unlink=True)
        bpy.data.meshes.remove(layer_excluded_mesh_data)
        bpy.data.materials.remove(layer_excluded_material)
        bpy.data.objects.remove(layer_excluded_object, do_unlink=True)
        bpy.data.lights.remove(layer_excluded_data)
        bpy.data.collections.remove(layer_excluded_collection)
        bpy.data.objects.remove(other_scene_object, do_unlink=True)
        bpy.data.lights.remove(other_scene_data)
        bpy.data.scenes.remove(other_scene)
        bpy.data.objects.remove(unselected_object, do_unlink=True)
        bpy.data.lights.remove(unselected_data)
        bpy.data.objects.remove(rect_omitted_object, do_unlink=True)
        bpy.data.lights.remove(rect_omitted_data)
        bpy.data.objects.remove(rect_rectangle_object, do_unlink=True)
        bpy.data.lights.remove(rect_rectangle_data)
        bpy.data.objects.remove(rect_square_object, do_unlink=True)
        bpy.data.lights.remove(rect_square_data)
        bpy.data.objects.remove(rect_parent, do_unlink=True)
        bpy.data.objects.remove(sun_object, do_unlink=True)
        bpy.data.lights.remove(sun_data)
        bpy.data.objects.remove(spot_object, do_unlink=True)
        bpy.data.lights.remove(spot_data)
        bpy.data.objects.remove(collection_hidden_object, do_unlink=True)
        bpy.data.lights.remove(collection_hidden_data)
        bpy.data.objects.remove(ancestor_hidden_object, do_unlink=True)
        bpy.data.lights.remove(ancestor_hidden_data)
        bpy.data.collections.remove(visible_hidden_child)
        bpy.data.collections.remove(hidden_light_parent)
        bpy.data.collections.remove(hidden_light_collection)
        bpy.data.objects.remove(hidden_light_object, do_unlink=True)
        bpy.data.lights.remove(hidden_light_data)
        bpy.data.objects.remove(light_object, do_unlink=True)
        bpy.data.lights.remove(light_data)
        for obj in selected_before:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if active_before and active_before.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = active_before

    # --- material-less render fidelity: Blender grey, never glTF metal ---
    # Needle offers a manual "Assign Default Material" operator that mutates
    # selected objects. Blendlink normalizes the finished GLB instead: source
    # slots, linked data, and intentional authored materials remain untouched.
    material_selection_before = list(bpy.context.selected_objects)
    material_active_before = bpy.context.view_layer.objects.active
    bpy.ops.mesh.primitive_cube_add(location=(-3.0, 0.0, 0.0))
    materialless_object = bpy.context.object
    materialless_object.name = "Blendlink Materialless Grey"
    materialless_mesh = materialless_object.data
    bpy.ops.mesh.primitive_cube_add(location=(3.0, 0.0, 0.0))
    authored_object = bpy.context.object
    authored_object.name = "Blendlink Authored Material"
    authored_mesh = authored_object.data
    authored_material = bpy.data.materials.new("Blendlink Authored PBR Control")
    bakelib.ensure_shader_node_tree(authored_material)
    authored_principled = authored_material.node_tree.nodes.get("Principled BSDF")
    authored_principled.inputs["Base Color"].default_value = (0.12, 0.34, 0.56, 1.0)
    authored_principled.inputs["Metallic"].default_value = 0.37
    authored_principled.inputs["Roughness"].default_value = 0.62
    authored_mesh.materials.append(authored_material)
    try:
        select_only(materialless_object, authored_object)
        with tempfile.TemporaryDirectory(prefix="blendlink-materialless-glb-") as tmp:
            material_glb = Path(tmp) / "materialless.glb"
            material_kwargs, _material_dropped = exporter.gltf_export_contract(
                str(material_glb), {
                    "imageFormat": "AUTO",
                    "exporterOverrides": {"use_selection": True},
                },
            )
            bpy.ops.export_scene.gltf(**material_kwargs)

            def inspect_glb(path):
                data = path.read_bytes()
                magic, version, byte_length = struct.unpack_from("<4sII", data, 0)
                expect(magic == b"glTF" and version == 2 and byte_length == len(data),
                       "materialless fixture is not a complete glTF 2.0 binary")
                chunks = []
                cursor = 12
                while cursor < len(data):
                    chunk_length, chunk_type = struct.unpack_from("<II", data, cursor)
                    payload = data[cursor + 8:cursor + 8 + chunk_length]
                    chunks.append((chunk_type, payload))
                    cursor += 8 + chunk_length
                json_payload = next(
                    payload for chunk_type, payload in chunks
                    if chunk_type == exporter.GLB_JSON_CHUNK
                )
                return (
                    json.loads(json_payload.decode("utf8").rstrip(" \t\r\n\0")),
                    [payload for chunk_type, payload in chunks
                     if chunk_type != exporter.GLB_JSON_CHUNK],
                )

            before_document, before_non_json_chunks = inspect_glb(material_glb)
            before_nodes = {node.get("name"): node for node in before_document["nodes"]}

            def primitive_for(document, nodes, object_name):
                return document["meshes"][nodes[object_name]["mesh"]]["primitives"][0]

            before_materialless = primitive_for(
                before_document, before_nodes, materialless_object.name,
            )
            before_authored = primitive_for(
                before_document, before_nodes, authored_object.name,
            )
            expect("material" not in before_materialless,
                   "stock Blender fixture unexpectedly supplied a materialless primitive")
            authored_index = before_authored["material"]
            authored_json = copy.deepcopy(before_document["materials"][authored_index])

            normalization = exporter.normalize_materialless_glb(str(material_glb))
            expect(normalization["patchedPrimitiveCount"] == 1
                   and normalization["primitives"]
                   == [f"{materialless_mesh.name}[0]"],
                   f"materialless normalization evidence drifted: {normalization}")
            normalized_bytes = material_glb.read_bytes()
            after_document, after_non_json_chunks = inspect_glb(material_glb)
            after_nodes = {node.get("name"): node for node in after_document["nodes"]}
            after_materialless = primitive_for(
                after_document, after_nodes, materialless_object.name,
            )
            after_authored = primitive_for(
                after_document, after_nodes, authored_object.name,
            )
            generated_material = after_document["materials"][
                after_materialless["material"]
            ]
            expect(generated_material == exporter._blender_default_gltf_material(),
                   f"materialless primitive did not receive Blender-default PBR: "
                   f"{generated_material}")
            expect(after_authored["material"] == authored_index
                   and after_document["materials"][authored_index] == authored_json,
                   "materialless normalization changed an authored material or its index")
            expect(after_non_json_chunks == before_non_json_chunks,
                   "materialless normalization changed GLB geometry/binary chunks")
            expect(exporter.normalize_materialless_glb(str(material_glb)) == {
                "patchedPrimitiveCount": 0,
                "materialIndex": None,
                "primitives": [],
            } and material_glb.read_bytes() == normalized_bytes,
                   "materialless normalization was not byte-stable when repeated")
            expect(len(materialless_mesh.materials) == 0
                   and authored_mesh.materials[0] is authored_material,
                   "post-export normalization mutated Blender material slots")
    finally:
        bpy.data.objects.remove(materialless_object, do_unlink=True)
        bpy.data.objects.remove(authored_object, do_unlink=True)
        bpy.data.meshes.remove(materialless_mesh)
        bpy.data.meshes.remove(authored_mesh)
        bpy.data.materials.remove(authored_material, do_unlink=True)
        for obj in material_selection_before:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if material_active_before and material_active_before.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = material_active_before

    authored_recipe = bpy.context.scene.get("blendlink_recipe")
    preview_recipe = {
        "schemaVersion": 1,
        "presentation": "hybrid",
        "atlases": [{
            "id": "main", "name": "Main", "size": 2048,
            "targetDensity": 256, "margin": 48, "fitPolicy": "block",
            "bakeOutput": "lighting",
        }, {
            "id": "background", "name": "Background", "size": 512,
            "targetDensity": 64, "margin": 12, "fitPolicy": "scale",
            "bakeOutput": "appearance",
        }],
        "preview": {
            "samples": 16, "supersample": 1, "denoise": False,
            "resolutionScale": 0.25,
        },
        "final": {
            "samples": 128, "supersample": 2, "denoise": True,
            "resolutionScale": 1.0,
        },
        "states": [{"name": "default"}],
        "optimization": {"geometry": "none", "textures": "none"},
    }
    bpy.context.scene["blendlink_recipe"] = json.dumps(preview_recipe)
    realtime_only_meshes = [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render and len(obj.data.polygons) > 0
    ]
    prior_dynamic = [
        (obj, "blendlink_dynamic" in obj, obj.get("blendlink_dynamic"))
        for obj in realtime_only_meshes
    ]
    try:
        preview_settings, _ = exporter.resolve_scene_recipe({"draft": True})
        final_settings, _ = exporter.resolve_scene_recipe({})
        for obj in realtime_only_meshes:
            obj["blendlink_dynamic"] = 1
        realtime_only_settings, _ = exporter.resolve_scene_recipe({"draft": True})
    finally:
        for obj, existed, value in prior_dynamic:
            if existed:
                obj["blendlink_dynamic"] = value
            elif "blendlink_dynamic" in obj:
                del obj["blendlink_dynamic"]
        if authored_recipe is None:
            del bpy.context.scene["blendlink_recipe"]
        else:
            bpy.context.scene["blendlink_recipe"] = authored_recipe
    expect(preview_settings["bake"]["atlases"]["main"]["fitPolicy"] == "scale"
           and preview_settings["bake"]["atlases"]["main"]["margin"] == 12
           and preview_settings["bake"]["margin"] == 12
           and preview_settings["bake"].get("previewScaleToFit") is True,
           "Preview quality did not scale atlas padding with its resolution")
    expect(preview_settings["bake"]["atlases"]["background"]["size"] == 256
           and preview_settings["bake"]["atlases"]["background"]["targetDensity"] == 32
           and preview_settings["bake"]["atlases"]["background"]["margin"] == 6,
           "small Preview atlas lost its readable floor or proportional settings")
    expect(final_settings["bake"]["atlases"]["main"]["fitPolicy"] == "block"
           and final_settings["bake"]["atlases"]["main"]["margin"] == 48
           and final_settings["bake"]["margin"] == 48
           and "previewScaleToFit" not in final_settings["bake"],
           "Final quality stopped enforcing the artist's atlas fit policy")
    expect(realtime_only_settings["mode"] == "standard"
           and "bake" not in realtime_only_settings
           and any("Realtime-only" in warning
                   for warning in realtime_only_settings.get("_presentationWarnings", [])),
           "Hybrid presentation with only Realtime meshes still scheduled an empty bake")
    hostile_token = exporter.artifact_filename_token("../Night: Interior/CON")
    expect("/" not in hostile_token and "\\" not in hostile_token and ":" not in hostile_token,
           f"published filename token is not cross-platform safe: {hostile_token}")
    expect(hostile_token != exporter.artifact_filename_token("Night Interior CON"),
           "filename normalization collision was not disambiguated")

    # --- separated lighting output: indirect-only bake + PBR/UV preservation ---
    expect(exporter.atlas_config({"size": 256})["main"]["bakeOutput"] == "appearance",
           "legacy bake settings no longer default to Appearance")
    expect(exporter.atlas_config({"atlases": {
        "main": {"size": 256, "bakeOutput": "lighting"},
    }})["main"]["bakeOutput"] == "lighting",
           "per-atlas Lighting output was not retained")
    invalid_output_blocked = False
    try:
        exporter.atlas_config({"atlases": {
            "main": {"size": 256, "bakeOutput": "mystery"},
        }})
    except SystemExit as error:
        invalid_output_blocked = "appearance or lighting" in str(error)
    expect(invalid_output_blocked, "invalid atlas bakeOutput did not fail loudly")
    light_group_issue = exporter.light_group_output_issue(
        {"main": "lighting", "painted": "appearance"}, {"Practical", "Accent"},
    )
    expect(light_group_issue is not None and "main" in light_group_issue
           and "Bake Appearance" in light_group_issue and "remove Light Groups" in light_group_issue,
           "Lighting atlas + additive Light Groups did not produce an actionable blocker")
    expect(exporter.light_group_output_issue(
        {"main": "appearance"}, {"Practical"},
    ) is None, "Appearance atlas unexpectedly rejected additive Light Groups")

    # Indirect-only Lighting cannot reproduce illumination from an emissive
    # mesh or an unpublished Blender World at runtime. Detect connected
    # contributors without flagging an unused scratch Emission node.
    preflight_emitter = make_cube("Neon Sign Contributor")
    emissive_material = bpy.data.materials.new("Neon Sign Emission")
    bakelib.ensure_shader_node_tree(emissive_material)
    emissive_material.node_tree.nodes.clear()
    emissive_output = emissive_material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emissive_shader = emissive_material.node_tree.nodes.new("ShaderNodeEmission")
    emissive_shader.inputs["Color"].default_value = (1.0, 0.1, 0.02, 1.0)
    emissive_shader.inputs["Strength"].default_value = 4.0
    emissive_material.node_tree.links.new(
        emissive_shader.outputs["Emission"], emissive_output.inputs["Surface"],
    )
    preflight_emitter.data.materials.append(emissive_material)

    preflight_inert = make_cube("Unused Emission Scratch")
    inert_material = bpy.data.materials.new("Unused Emission Material")
    bakelib.ensure_shader_node_tree(inert_material)
    inert_material.node_tree.nodes.new("ShaderNodeEmission")
    preflight_inert.data.materials.append(inert_material)

    principled_emitter = make_cube("Principled Neon Contributor")
    principled_emission = bpy.data.materials.new("Principled Neon Emission")
    bakelib.ensure_shader_node_tree(principled_emission)
    principled = principled_emission.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Emission Color"].default_value = (0.1, 0.4, 1.0, 1.0)
    principled.inputs["Emission Strength"].default_value = 3.0
    principled_emitter.data.materials.append(principled_emission)

    prior_preflight_world = bpy.context.scene.world
    preflight_world = bpy.data.worlds.new("Studio World Contributor")
    bakelib.ensure_shader_node_tree(preflight_world)
    world_background = preflight_world.node_tree.nodes.get("Background")
    world_background.inputs["Color"].default_value = (0.2, 0.3, 0.5, 1.0)
    world_background.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = preflight_world
    try:
        expect(exporter.material_may_emit(emissive_material),
               "connected emissive material was not recognized")
        expect(exporter.material_may_emit(principled_emission),
               "connected Principled emission was not recognized")
        expect(not exporter.material_may_emit(inert_material),
               "unused scratch Emission node produced a blanket false positive")
        preflight = exporter.lighting_preflight_warnings(
            bpy.context.scene, ["main"], None,
            objects=[preflight_emitter, principled_emitter, preflight_inert],
        )
        expect(len(preflight) == 2,
               f"Lighting preflight did not separate mesh and World contributors: {preflight}")
        emissive_warning = next(item for item in preflight if "emissive mesh" in item)
        world_warning = next(item for item in preflight if "Blender World" in item)
        expect(preflight_emitter.name in emissive_warning
               and emissive_material.name in emissive_warning
               and principled_emitter.name in emissive_warning
               and principled_emission.name in emissive_warning
               and preflight_inert.name not in emissive_warning,
               f"emissive warning did not name only connected contributors: {emissive_warning}")
        expect(preflight_world.name in world_warning and all(
            remedy in world_warning for remedy in (
                "Add/export", "publish the HDR environment", "choose Bake Appearance",
            )
        ), f"World warning omitted ownership or actionable remedies: {world_warning}")
        published = exporter.lighting_preflight_warnings(
            bpy.context.scene, ["main"], {
                "environment": {"source": "image", "lighting": "image"},
            }, objects=[preflight_emitter, principled_emitter, preflight_inert],
        )
        expect(len(published) == 1 and "emissive mesh" in published[0],
               f"published HDR did not resolve only the World warning: {published}")
        expect(exporter.lighting_preflight_warnings(
            bpy.context.scene, [], None,
            objects=[preflight_emitter, principled_emitter, preflight_inert],
        ) == [], "Appearance-only atlases received a Lighting preflight warning")
    finally:
        bpy.context.scene.world = prior_preflight_world
        bpy.data.worlds.remove(preflight_world)
        for obj in (preflight_emitter, principled_emitter, preflight_inert):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.materials.remove(emissive_material, do_unlink=True)
        bpy.data.materials.remove(principled_emission, do_unlink=True)
        bpy.data.materials.remove(inert_material, do_unlink=True)

    bakelib.configure_lighting_bake(bpy.context.scene, 12)
    bake_rna = bpy.context.scene.render.bake
    expect(not bake_rna.use_pass_direct and bake_rna.use_pass_indirect
           and not bake_rna.use_pass_color,
           "Lighting output is not DIFFUSE indirect-only")
    if hasattr(bake_rna, "view_from"):
        expect(bake_rna.view_from == "ABOVE_SURFACE",
               "Lighting bake inherited a camera-dependent view origin")
    bakelib.configure_combined_bake(
        bpy.context.scene, 12, view_from="ACTIVE_CAMERA",
    )
    expect(not hasattr(bake_rna, "view_from")
           or bake_rna.view_from == "ACTIVE_CAMERA",
           "fixed-camera Appearance did not use Blender's active-camera bake rays")
    exporter.configure_atlas_bake(
        bpy.context.scene, 12, "appearance",
        fixed_camera_appearance=False,
    )
    expect(not hasattr(bake_rna, "view_from")
           or bake_rna.view_from == "ABOVE_SURFACE",
           "ordinary Appearance inherited the fixed-camera bake origin")

    # Blender 5.2 wraps entries from Image.packed_files in ImagePackedFile;
    # exact bytes live on its nested PackedFile. Fingerprints/publication use
    # one canonical adapter rather than assuming either RNA shape.
    with tempfile.TemporaryDirectory(prefix="blendlink-packed-image-") as packed_tmp:
        packed_path = Path(packed_tmp) / "source.png"
        generated_packed = bpy.data.images.new(
            "__Blendlink Packed Source", width=2, height=2, alpha=True,
        )
        generated_packed.filepath_raw = str(packed_path)
        generated_packed.file_format = "PNG"
        generated_packed.save()
        expected_packed_bytes = packed_path.read_bytes()
        packed_image = bpy.data.images.load(str(packed_path), check_existing=False)
        packed_image.pack()
        packed_path.unlink()
        packed_payloads = bakelib.packed_image_payloads(packed_image)
        expect(len(packed_payloads) == 1
               and packed_payloads[0][1] == expected_packed_bytes,
               "Blender 5.2 ImagePackedFile bytes were not read exactly")
        packed_digest = hashlib.sha256()
        bakelib._fingerprint_image(packed_digest, packed_image)
        expect(packed_digest.digest() != hashlib.sha256().digest(),
               "packed image did not contribute to dependency fingerprint")
        bpy.data.images.remove(packed_image)
        bpy.data.images.remove(generated_packed)

    # Geometry Nodes can evaluate an authored mesh to zero faces at the bake
    # frame. Freezing must report and remove that mesh from the unwrap/pack
    # set instead of indexing a UV layer that cannot exist.
    frozen_visible = make_cube("__Blendlink Frozen Visible")
    frozen_empty = make_cube("__Blendlink Frozen Empty")
    empty_nodes = bpy.data.node_groups.new(
        "__Blendlink Empty Evaluated Geometry", "GeometryNodeTree",
    )
    empty_nodes.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    empty_nodes.nodes.new("NodeGroupOutput")
    empty_modifier = frozen_empty.modifiers.new("Empty at bake frame", "NODES")
    empty_modifier.node_group = empty_nodes
    freeze_messages = []
    kept_after_freeze = bakelib.freeze_evaluated_meshes(
        [frozen_visible, frozen_empty], log=freeze_messages.append,
    )
    expect(kept_after_freeze == [frozen_visible],
           f"evaluated-empty mesh remained in bake set: {kept_after_freeze}")
    expect(len(frozen_empty.data.polygons) == 0
           and any(frozen_empty.name in message and "evaluated-empty" in message
                   for message in freeze_messages),
           f"evaluated-empty mesh was not reported clearly: {freeze_messages}")
    bakelib.ensure_authored_uvs(kept_after_freeze)
    bakelib.stage_atlas_layers(kept_after_freeze)
    expect(frozen_visible.data.uv_layers.get(bakelib.ATLAS_UV) is not None,
           "remaining evaluated geometry did not reach atlas staging")
    bpy.data.objects.remove(frozen_visible, do_unlink=True)
    bpy.data.objects.remove(frozen_empty, do_unlink=True)
    bpy.data.node_groups.remove(empty_nodes)

    # Geometry Nodes may output only instances. Blender's ordinary evaluated
    # mesh conversion reports zero faces for that visible result, so bakelib
    # must realize it natively before freezing without replacing the authored
    # host Object or losing its materials.
    instance_source = make_cube("__Blendlink Instance Source")
    instance_material = bpy.data.materials.new("__Blendlink Instance Material")
    instance_source.data.materials.append(instance_material)
    host_mesh = bpy.data.meshes.new("__Blendlink Instance Host Mesh")
    host_mesh.from_pydata([(0, 0, 0), (2, 0, 0)], [], [])
    instance_host = bpy.data.objects.new("__Blendlink Instance Host", host_mesh)
    bpy.context.scene.collection.objects.link(instance_host)
    instance_host["blendlink_id"] = "instance-host-id"
    host_pointer = instance_host.as_pointer()
    host_matrix = instance_host.matrix_world.copy()
    instance_nodes = bpy.data.node_groups.new(
        "__Blendlink Instance Only Geometry", "GeometryNodeTree",
    )
    instance_nodes.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    instance_nodes.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    instance_input = instance_nodes.nodes.new("NodeGroupInput")
    object_info = instance_nodes.nodes.new("GeometryNodeObjectInfo")
    object_info.inputs["Object"].default_value = instance_source
    object_info.inputs["As Instance"].default_value = True
    instance_on_points = instance_nodes.nodes.new("GeometryNodeInstanceOnPoints")
    instance_output = instance_nodes.nodes.new("NodeGroupOutput")
    instance_nodes.links.new(
        instance_input.outputs["Geometry"], instance_on_points.inputs["Points"],
    )
    instance_nodes.links.new(
        object_info.outputs["Geometry"], instance_on_points.inputs["Instance"],
    )
    instance_nodes.links.new(
        instance_on_points.outputs["Instances"], instance_output.inputs["Geometry"],
    )
    instance_modifier = instance_host.modifiers.new("Instance only", "NODES")
    instance_modifier.node_group = instance_nodes
    direct_evaluated = instance_host.evaluated_get(
        bpy.context.evaluated_depsgraph_get(),
    )
    direct_mesh = bpy.data.meshes.new_from_object(
        direct_evaluated, preserve_all_data_layers=True,
        depsgraph=bpy.context.evaluated_depsgraph_get(),
    )
    expect(len(direct_mesh.polygons) == 0,
           "instance-only fixture unexpectedly converted without realization")
    bpy.data.meshes.remove(direct_mesh)
    realized = bakelib.freeze_evaluated_meshes([instance_host])
    expect(realized == [instance_host]
           and len(instance_host.data.polygons) == 12,
           f"instance-only Geometry Nodes output was lost: {len(instance_host.data.polygons)} faces")
    expect(instance_host.as_pointer() == host_pointer
           and instance_host.get("blendlink_id") == "instance-host-id"
           and instance_host.matrix_world == host_matrix,
           "instance realization replaced or mutated the authored host Object")
    expect([slot.material for slot in instance_host.material_slots] == [instance_material],
           "instance realization lost its material table")
    expect(len(instance_host.modifiers) == 0,
           "temporary or authored Geometry Nodes modifiers survived freezing")

    # Realizing instances collapses Object Info Random to the host object's
    # value. Block the evidenced shader route before mutating the artist's
    # object instead of silently changing Blender's rendered pattern.
    risky_tree = bakelib.ensure_shader_node_tree(instance_material)
    risky_tree.nodes.clear()
    risky_output = risky_tree.nodes.new("ShaderNodeOutputMaterial")
    risky_emission = risky_tree.nodes.new("ShaderNodeEmission")
    risky_object_info = risky_tree.nodes.new("ShaderNodeObjectInfo")
    risky_tree.links.new(
        risky_object_info.outputs["Random"], risky_emission.inputs["Strength"],
    )
    risky_tree.links.new(
        risky_emission.outputs["Emission"], risky_output.inputs["Surface"],
    )
    risky_mesh = host_mesh.copy()
    risky_host = bpy.data.objects.new(
        "__Blendlink Instance Random Risk", risky_mesh,
    )
    bpy.context.scene.collection.objects.link(risky_host)
    risky_modifier = risky_host.modifiers.new("Instance random risk", "NODES")
    risky_modifier.node_group = instance_nodes
    risky_error = None
    try:
        bakelib.freeze_evaluated_meshes([risky_host])
    except RuntimeError as error:
        risky_error = str(error)
    expect(
        risky_error is not None
        and "Object Info Random" in risky_error
        and risky_host.name in risky_error
        and len(risky_host.modifiers) == 1
        and risky_host.data is risky_mesh,
        f"per-instance shader identity was not blocked transactionally: {risky_error}",
    )
    bpy.data.objects.remove(risky_host, do_unlink=True)
    if risky_mesh.users == 0:
        bpy.data.meshes.remove(risky_mesh)
    bpy.data.objects.remove(instance_host, do_unlink=True)
    bpy.data.objects.remove(instance_source, do_unlink=True)
    bpy.data.node_groups.remove(instance_nodes)
    bpy.data.materials.remove(instance_material)

    # Solidify adds real rim triangles but propagates the plane boundary UVs
    # with zero area. The derived, fully unpinned atlas may be repaired; one
    # artist pin makes the whole layout immutable and must fail before any
    # other object is changed.
    def make_solidified_authored_plane(name, pinned=False):
        bpy.ops.mesh.primitive_plane_add(size=2.0)
        obj = bpy.context.active_object
        obj.name = name
        source = obj.data.uv_layers[0]
        authored = obj.data.uv_layers.new(name=bakelib.AUTHORED_UV)
        for index, loop in enumerate(authored.data):
            loop.uv = source.data[index].uv
            loop.pin_uv = pinned
        modifier = obj.modifiers.new("Evaluated UV regression", "SOLIDIFY")
        modifier.thickness = 0.2
        modifier.use_rim = True
        return obj

    solidified_unpinned = make_solidified_authored_plane(
        "__Blendlink A Solidify Unpinned",
    )
    solidified_pinned = make_solidified_authored_plane(
        "__Blendlink Z Solidify Pinned", pinned=True,
    )
    solidified = bakelib.freeze_evaluated_meshes(
        [solidified_unpinned, solidified_pinned],
    )
    bakelib.stage_atlas_layers(solidified)
    unpinned_bad = bakelib._nonzero_geometry_zero_uv_triangles(
        solidified_unpinned, bakelib.ATLAS_UV,
    )
    pinned_bad = bakelib._nonzero_geometry_zero_uv_triangles(
        solidified_pinned, bakelib.ATLAS_UV,
    )
    expect(unpinned_bad and pinned_bad,
           "Solidify fixture did not reproduce zero-area evaluated atlas UVs")
    authored_before = {
        obj.name: tuple(
            (tuple(loop.uv), bool(loop.pin_uv))
            for loop in obj.data.uv_layers.get(bakelib.AUTHORED_UV).data
        )
        for obj in solidified
    }
    atlas_before = {
        obj.name: tuple(
            (tuple(loop.uv), bool(loop.pin_uv))
            for loop in obj.data.uv_layers.get(bakelib.ATLAS_UV).data
        )
        for obj in solidified
    }
    try:
        bakelib.repair_evaluated_atlas_uvs(solidified)
        raise AssertionError("pinned evaluated UV collapse did not fail")
    except RuntimeError as error:
        expect(solidified_pinned.name in str(error)
               and "pinned" in str(error)
               and "zero-area" in str(error),
               f"pinned evaluated UV failure was not actionable: {error}")
    for obj in solidified:
        expect(tuple(
            (tuple(loop.uv), bool(loop.pin_uv))
            for loop in obj.data.uv_layers.get(bakelib.AUTHORED_UV).data
        ) == authored_before[obj.name],
               f"failed evaluated UV preflight changed authored UVs on {obj.name}")
        expect(tuple(
            (tuple(loop.uv), bool(loop.pin_uv))
            for loop in obj.data.uv_layers.get(bakelib.ATLAS_UV).data
        ) == atlas_before[obj.name],
               f"failed evaluated UV preflight partially changed {obj.name}")

    repair_messages = []
    repairs = bakelib.repair_evaluated_atlas_uvs(
        [solidified_unpinned], log=repair_messages.append,
    )
    # A Solidify shell projects its inner and outer surfaces onto each other,
    # so the whole-object Smart Project still self-overlaps. That layout used
    # to ship (this path has no post-pack injectivity proof); the fold rescue
    # now replaces it with per-face charts and, since this repair is a large
    # visible quality change, says so in the strategy.
    expect(repairs == [{
        "object": solidified_unpinned.name,
        "triangleCount": len(unpinned_bad),
        "strategy": "smart-project-whole-unpinned-object+lightmap-rescue",
    }], f"unexpected evaluated UV repair report: {repairs}")
    expect(not bakelib._nonzero_geometry_zero_uv_triangles(
        solidified_unpinned, bakelib.ATLAS_UV,
    ), "Smart Project left non-zero evaluated triangles with zero UV area")
    expect(any(solidified_unpinned.name in message
               and "authored UV layers were preserved" in message
               for message in repair_messages),
           f"evaluated UV repair was not logged clearly: {repair_messages}")
    expect(tuple(
        (tuple(loop.uv), bool(loop.pin_uv))
        for loop in solidified_unpinned.data.uv_layers.get(
            bakelib.AUTHORED_UV,
        ).data
    ) == authored_before[solidified_unpinned.name],
           "evaluated UV repair changed the authored layer")
    repaired_atlas = tuple(
        tuple(loop.uv)
        for loop in solidified_unpinned.data.uv_layers.get(bakelib.ATLAS_UV).data
    )
    expect(bakelib.repair_evaluated_atlas_uvs([solidified_unpinned]) == [],
           "revalidated evaluated UV repair was not idempotent")
    expect(tuple(
        tuple(loop.uv)
        for loop in solidified_unpinned.data.uv_layers.get(bakelib.ATLAS_UV).data
    ) == repaired_atlas,
           "idempotent evaluated UV repair changed the atlas")

    # Blender's whole-mesh Smart Project can quantize tiny, valid faces to a
    # single float32 UV point. Its selected-face mode has the same precision
    # failure, so the final bounded fallback projects only those polygons in
    # local coordinates. Keep an unaffected face as a mutation sentinel.
    rescue_mesh = bpy.data.meshes.new("__Blendlink Planar Rescue Mesh")
    rescue_mesh.from_pydata([
        (-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0),
        (-0.0036468962, 0.0021055541, 0.2682110965),
        (-0.0021055248, 0.0036469242, 0.2682110965),
        (-0.0042110775, 0.0000000015, 0.2682110965),
        (-0.0036468969, -0.0021055511, 0.2682110965),
        (0.0, -0.0042111040, 0.2682110965),
        (0.0036468962, -0.0021055541, 0.2682110965),
        (0.0042110775, 0.0, 0.2682110965),
        (0.0021055248, 0.0036469242, 0.2682110965),
    ], [], [
        (0, 1, 2),
        (3, 4, 5, 6),
        (7, 8, 9, 10),
    ])
    rescue_object = bpy.data.objects.new(
        "__Blendlink Planar Rescue", rescue_mesh,
    )
    bpy.context.scene.collection.objects.link(rescue_object)
    rescue_layer = rescue_mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for loop in rescue_layer.data:
        loop.uv = (0.5, 0.5)
    sentinel_polygon = rescue_mesh.polygons[0]
    for loop_index, uv in zip(
            sentinel_polygon.loop_indices, ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0))):
        rescue_layer.data[loop_index].uv = uv
    collapsed = bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    )
    expect(len(collapsed) == 4,
           f"planar rescue fixture did not expose four collapsed triangles: {collapsed}")
    sentinel_uv = tuple(
        tuple(rescue_layer.data[index].uv)
        for index in sentinel_polygon.loop_indices
    )
    rescued_polygons = bakelib._planar_rescue_collapsed_atlas_polygons(
        rescue_object, bakelib.ATLAS_UV, collapsed,
    )
    expect(rescued_polygons == [1, 2],
           f"planar rescue targeted unexpected polygons: {rescued_polygons}")
    expect(not bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    ), "local planar rescue left valid surface triangles collapsed")
    rescue_layer = rescue_mesh.uv_layers.get(bakelib.ATLAS_UV)
    expect(tuple(
        tuple(rescue_layer.data[index].uv)
        for index in sentinel_polygon.loop_indices
    ) == sentinel_uv, "local planar rescue changed an unaffected UV island")
    first_rescue_u = [
        rescue_layer.data[index].uv.x
        for index in rescue_mesh.polygons[1].loop_indices
    ]
    second_rescue_u = [
        rescue_layer.data[index].uv.x
        for index in rescue_mesh.polygons[2].loop_indices
    ]
    expect(max(first_rescue_u) < min(second_rescue_u),
           "local planar rescue did not separate temporary islands")

    for polygon_index in (1, 2):
        for loop_index in rescue_mesh.polygons[polygon_index].loop_indices:
            rescue_layer.data[loop_index].uv = (0.5, 0.5)
    minimum_bad = bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    )
    minimum_messages = []
    minimum_reports = bakelib._minimum_footprint_rescue_and_repack(
        [rescue_object], [(rescue_object, minimum_bad)],
        bakelib.ATLAS_UV, 16, 1024, pin=True,
        log=minimum_messages.append,
    )
    expect(len(minimum_reports) == 1,
           f"unexpected minimum-footprint report count: {minimum_reports}")
    minimum_report = minimum_reports[0]
    expect(
        minimum_report["object"] == rescue_object.name
        and minimum_report["triangleCount"] == len(minimum_bad)
        and minimum_report["rescuePolygonCount"] == 2
        and minimum_report["targetInradiusDeliveryTexels"] == 1.0
        and minimum_report["strategy"] == "sampleable-regular-polygon-rescue"
        and minimum_report["packedInradiusDeliveryTexels"] >= 0.75
        and minimum_report["minimumCoveredDeliveryTexelCenters"] >= 1,
        f"minimum-footprint report lost its sampleability evidence: {minimum_report}",
    )
    expect(not bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    ), "minimum-footprint repack collapsed a rescued polygon")
    expect(any("one-delivery-texel minimum" in message
               for message in minimum_messages),
           f"minimum-footprint repair was not reported: {minimum_messages}")

    # A UV triangle may remain numerically nonzero yet still cover no delivery
    # texel center. The Blender 4.0 Splash sky dome exposed this exact gap:
    # Smart Project produced an ultra-thin float32 strip, so the zero-area
    # predicate passed while adjacent triangles became non-injective. Exercise
    # the real pack seam with a stable, meaningful world-space sliver and
    # require the bounded sampleability rescue rather than a relaxed overlap
    # proof.
    unsampleable_mesh = bpy.data.meshes.new(
        "__Blendlink Nonzero Unsampleable Mesh",
    )
    unsampleable_mesh.from_pydata([
        (-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0), (1.0, 0.0, 0.0),
        (1.0, 0.0000021, 0.0), (0.0, 0.0000021, 0.0),
    ], [], [
        (0, 1, 2),
        (3, 4, 5, 6),
    ])
    unsampleable_object = bpy.data.objects.new(
        "__Blendlink Nonzero Unsampleable", unsampleable_mesh,
    )
    bpy.context.scene.collection.objects.link(unsampleable_object)
    unsampleable_layer = unsampleable_mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for loop_index, uv in zip(
            unsampleable_mesh.polygons[0].loop_indices,
            ((0.0, 0.0), (1.0, 0.0), (0.5, 1.0))):
        unsampleable_layer.data[loop_index].uv = uv
    for loop_index, uv in zip(
            unsampleable_mesh.polygons[1].loop_indices,
            ((2.0, 0.0), (3.0, 0.0), (3.0, 0.0000021), (2.0, 0.0000021))):
        unsampleable_layer.data[loop_index].uv = uv
    unsampleable_mesh.uv_layers.active = unsampleable_layer
    unsampleable_mesh.update()
    expect(not bakelib._nonzero_geometry_zero_uv_triangles(
        unsampleable_object, bakelib.ATLAS_UV,
    ), "nonzero-unsampleable fixture accidentally used a collapsed UV")
    unsampleable_held = bakelib.average_unpinned(
        [unsampleable_object], bakelib.ATLAS_UV,
    )
    unsampleable_messages = []
    unsampleable_reports, unsampleable_final_held = (
        bakelib.pack_with_evaluated_uv_repair(
            [unsampleable_object],
            bakelib.ATLAS_UV,
            lambda _obj: 1.0,
            16,
            1024,
            held=unsampleable_held,
            pin=True,
            delivery_size=1024,
            log=unsampleable_messages.append,
        )
    )
    expect(
        len(unsampleable_reports) == 1
        and unsampleable_reports[0]["strategy"]
        == "sampleable-regular-polygon-rescue"
        and unsampleable_reports[0]["minimumCoveredDeliveryTexelCenters"] >= 1
        and unsampleable_final_held == {},
        "nonzero but unsampleable packed UV did not receive the bounded "
        f"sampleability rescue: {unsampleable_reports}",
    )
    unsampleable_layer = unsampleable_mesh.uv_layers.get(bakelib.ATLAS_UV)
    unsampleable_mask = {
        unsampleable_object.name: [
            True for _loop in unsampleable_layer.data
        ],
    }
    expect(not bakelib.pinned_uv_layout_issues(
        [unsampleable_object],
        bakelib.ATLAS_UV,
        unsampleable_mask,
    ), "sampleability rescue did not restore a complete injective UV")
    bpy.data.objects.remove(unsampleable_object, do_unlink=True)

    # A missing delivery texel center is not, by itself, a repair request.
    # At a deliberately tiny delivery size, ordinary well-conditioned
    # topology will often land between samples. The precision rescue must
    # remain restricted to float32-sensitive geometry instead of silently
    # regularizing healthy artist-authored surfaces.
    ordinary_divisions = 32
    ordinary_vertices = [
        (
            column / ordinary_divisions,
            row / ordinary_divisions,
            0.0,
        )
        for row in range(ordinary_divisions + 1)
        for column in range(ordinary_divisions + 1)
    ]
    ordinary_faces = []
    for row in range(ordinary_divisions):
        for column in range(ordinary_divisions):
            lower_left = row * (ordinary_divisions + 1) + column
            lower_right = lower_left + 1
            upper_left = lower_left + ordinary_divisions + 1
            upper_right = upper_left + 1
            ordinary_faces.append((
                lower_left,
                lower_right,
                upper_right,
                upper_left,
            ))
    ordinary_mesh = bpy.data.meshes.new(
        "__Blendlink Ordinary Subpixel Grid Mesh",
    )
    ordinary_mesh.from_pydata(
        ordinary_vertices,
        [],
        ordinary_faces,
    )
    ordinary_mesh.update()
    ordinary_object = bpy.data.objects.new(
        "__Blendlink Ordinary Subpixel Grid",
        ordinary_mesh,
    )
    bpy.context.scene.collection.objects.link(ordinary_object)
    ordinary_layer = ordinary_mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for polygon in ordinary_mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = ordinary_mesh.vertices[
                ordinary_mesh.loops[loop_index].vertex_index
            ].co
            ordinary_layer.data[loop_index].uv = (vertex.x, vertex.y)
    ordinary_mesh.uv_layers.active = ordinary_layer
    ordinary_mesh.update()
    ordinary_held = bakelib.average_unpinned(
        [ordinary_object],
        bakelib.ATLAS_UV,
    )
    ordinary_reports, ordinary_final_held = (
        bakelib.pack_with_evaluated_uv_repair(
            [ordinary_object],
            bakelib.ATLAS_UV,
            lambda _obj: 1.0,
            2,
            128,
            held=ordinary_held,
            pin=True,
            delivery_size=16,
        )
    )
    ordinary_mesh.calc_loop_triangles()
    ordinary_world_linear = ordinary_object.matrix_world.to_3x3()
    ordinary_qualities = [
        bakelib._triangle_geometry_quality(
            ordinary_mesh,
            triangle,
            ordinary_world_linear,
        )
        for triangle in ordinary_mesh.loop_triangles
    ]
    ordinary_layer = ordinary_mesh.uv_layers.get(bakelib.ATLAS_UV)
    ordinary_missing_centers = [
        triangle.index
        for triangle in ordinary_mesh.loop_triangles
        if not bakelib._uv_triangle_has_texel_center(
            [
                tuple(ordinary_layer.data[index].uv)
                for index in triangle.loops
            ],
            16,
        )
    ]
    ordinary_precision_candidates = (
        bakelib._precision_sliver_unsampleable_uv_triangles(
            ordinary_object,
            bakelib.ATLAS_UV,
            16,
        )
    )
    expect(
        ordinary_missing_centers
        and min(ordinary_qualities)
        > bakelib._FLOAT32_UV_SAMPLEABILITY_RESCUE_CEILING
        and ordinary_precision_candidates == []
        and ordinary_reports == []
        and ordinary_final_held == {},
        "ordinary subpixel topology was selected or regularized by the "
        "narrow precision rescue: "
        f"missingCenters={len(ordinary_missing_centers)}, "
        f"minimumQuality={min(ordinary_qualities)}, "
        f"precisionCandidates={ordinary_precision_candidates}, "
        f"reports={ordinary_reports}, held={ordinary_final_held}",
    )
    bpy.data.objects.remove(ordinary_object, do_unlink=True)

    # A polygon may contain one exact-zero loop triangle and one visible
    # sibling. Smart Project can fold the sibling around the collinear corner;
    # regularize that one private polygon, then exclude only the zero triangle
    # from material density while retaining the conservative layout proof.
    mixed_mesh = bpy.data.meshes.new("__Blendlink Mixed Zero Polygon Mesh")
    mixed_mesh.from_pydata([
        (0.0, 0.0, 0.0), (1.0, 0.0, 0.0),
        (2.0, 0.0, 0.0), (0.0, 1.0, 0.0),
        (3.0, 0.0, 0.0), (4.0, 0.0, 0.0), (3.0, 1.0, 0.0),
    ], [], [
        (0, 1, 2, 3),
        (4, 5, 6),
    ])
    mixed_object = bpy.data.objects.new(
        "__Blendlink Mixed Zero Polygon", mixed_mesh,
    )
    bpy.context.scene.collection.objects.link(mixed_object)
    mixed_layer = mixed_mesh.uv_layers.new(name=bakelib.ATLAS_UV)
    for loop_index, uv in zip(
            mixed_mesh.polygons[0].loop_indices,
            ((0.0, 0.0), (0.5, 0.0), (1.0, 0.0), (0.0, 1.0))):
        mixed_layer.data[loop_index].uv = uv
    for loop_index, uv in zip(
            mixed_mesh.polygons[1].loop_indices,
            ((1.5, 0.0), (2.5, 0.0), (1.5, 1.0))):
        mixed_layer.data[loop_index].uv = uv
    mixed_mesh.uv_layers.active = mixed_layer
    mixed_mesh.update()
    mixed_candidates = bakelib._mixed_zero_world_area_polygon_triangles(
        mixed_object,
    )
    expect(
        len(mixed_candidates) == 1,
        f"mixed zero/visible polygon fixture drifted: {mixed_candidates}",
    )
    mixed_held = bakelib.average_unpinned(
        [mixed_object], bakelib.ATLAS_UV,
    )
    mixed_reports, mixed_final_held = bakelib.pack_with_evaluated_uv_repair(
        [mixed_object],
        bakelib.ATLAS_UV,
        lambda _obj: 1.0,
        16,
        256,
        held=mixed_held,
        pin=True,
        delivery_size=256,
    )
    expect(
        len(mixed_reports) == 1
        and mixed_reports[0]["strategy"]
        == "sampleable-regular-polygon-rescue"
        and mixed_final_held == {},
        f"mixed zero/visible polygon was not privately regularized: {mixed_reports}",
    )
    mixed_layer = mixed_mesh.uv_layers.get(bakelib.ATLAS_UV)
    mixed_mask = {
        mixed_object.name: [True for _loop in mixed_layer.data],
    }
    expect(not bakelib.pinned_uv_layout_issues(
        [mixed_object],
        bakelib.ATLAS_UV,
        mixed_mask,
    ), "mixed zero/visible polygon did not pass the final layout proof")
    mixed_coverage = bakelib.material_binding_packed_uv_coverage(
        mixed_object, 0, bakelib.ATLAS_UV,
    )
    expect(
        mixed_coverage["zeroWorldAreaTriangleCount"] == 1
        and mixed_coverage["uvArea"] > 0.0,
        "selected-field density did not exclude exactly the zero-world-area "
        f"triangle: {mixed_coverage}",
    )
    bpy.data.objects.remove(mixed_object, do_unlink=True)

    # Preserve a valid source layout when its only defect is one collapsed
    # polygon. The repair stages that polygon outside the source bounds so the
    # ordinary packer can own final placement; temporary out-of-bounds
    # coordinates are not a reason to discard every unaffected artist island.
    source_rescue_mesh = bpy.data.meshes.new(
        "__Blendlink Source Local Rescue Mesh",
    )
    source_rescue_mesh.from_pydata([
        (-2.0, -1.0, 0.0), (0.0, -1.0, 0.0), (-1.0, 1.0, 0.0),
        (1.0, -1.0, 0.0), (3.0, -1.0, 0.0), (2.0, 1.0, 0.0),
    ], [], [
        (0, 1, 2),
        (3, 4, 5),
    ])
    source_rescue_object = bpy.data.objects.new(
        "__Blendlink Source Local Rescue", source_rescue_mesh,
    )
    bpy.context.scene.collection.objects.link(source_rescue_object)
    source_layer = source_rescue_mesh.uv_layers.new(name="Artist Source UV")
    source_layer.active_render = True
    for loop_index, uv in zip(
            source_rescue_mesh.polygons[0].loop_indices,
            ((0.1, 0.1), (0.4, 0.1), (0.25, 0.4))):
        source_layer.data[loop_index].uv = uv
    for loop_index in source_rescue_mesh.polygons[1].loop_indices:
        source_layer.data[loop_index].uv = (0.8, 0.8)
    source_rescue_mesh.uv_layers.active = source_layer
    source_rescue_mesh.update()
    source_rescue_result = bakelib.prepare_material_texture_uv(
        source_rescue_object,
        {
            "policy": "fallback-no-camera",
            "purpose": "preview",
            "materialSlotIndex": 0,
            "resolutionCeiling": 128,
            "fallbackResolution": 128,
            "targetProjectedPixels": None,
            "densityThreshold": 0.95,
            "worldAreaM2": 4.0,
        },
    )
    expect(
        source_rescue_result["uvStrategy"]
        == "active-render-copy+local-degenerate-rescue"
        and source_rescue_result["uvGenerationSpace"] == "source-uv"
        and source_rescue_result["sourceLayoutIssues"] == ["degenerate"]
        and source_rescue_result["sourceRescuePolygonCount"] == 1
        and source_rescue_result["sourceRescueAttemptedPolygonCount"] == 1
        and source_rescue_result["repairCount"] == 0
        and source_rescue_result["uvRepairStrategies"] == []
        and source_rescue_result["uvArea"] > 0.0,
        "one collapsed source polygon discarded or failed the private local "
        f"repair path: {source_rescue_result}",
    )
    bpy.data.objects.remove(source_rescue_object, do_unlink=True)

    # The world-linear proxy seam bulk-validates exact loop topology before
    # copying any UV. Equal counts alone are insufficient: a same-size Mesh
    # with different corner identity must fail loudly and leave the receiver
    # untouched.
    topology_objects = []
    for label, face in (
            ("Source", (0, 1, 2, 3)),
            ("Changed", (0, 2, 1, 3))):
        mesh = bpy.data.meshes.new(
            f"__Blendlink Proxy Topology {label} Mesh",
        )
        mesh.from_pydata([
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (1.0, 1.0, 0.0),
            (0.0, 1.0, 0.0),
        ], [], [face])
        mesh.update()
        layer = mesh.uv_layers.new(name="Proxy Topology UV")
        for index, loop in enumerate(layer.data):
            loop.uv = (
                (0.1, 0.1),
                (0.9, 0.1),
                (0.9, 0.9),
                (0.1, 0.9),
            )[index]
        topology_objects.append(bpy.data.objects.new(
            f"__Blendlink Proxy Topology {label}",
            mesh,
        ))
    topology_target_before = tuple(
        tuple(loop.uv)
        for loop in topology_objects[1].data.uv_layers[
            "Proxy Topology UV"
        ].data
    )
    try:
        bakelib._validated_private_uv_layers(
            topology_objects[0],
            topology_objects[1],
            "Proxy Topology UV",
        )
    except RuntimeError as error:
        expect(
            "loop vertex_index at index 1" in str(error),
            f"proxy topology mismatch was not exact/actionable: {error}",
        )
    else:
        raise AssertionError("world-linear proxy accepted changed loop topology")
    expect(
        tuple(
            tuple(loop.uv)
            for loop in topology_objects[1].data.uv_layers[
                "Proxy Topology UV"
            ].data
        ) == topology_target_before,
        "failed world-linear topology preflight changed target UVs",
    )
    for topology_object in topology_objects:
        topology_mesh = topology_object.data
        bpy.data.objects.remove(topology_object)
        bpy.data.meshes.remove(topology_mesh)

    # Automatic private projection must measure geometry after the receiver's
    # complete world-linear transform. Local-coordinate Smart Project makes a
    # unit quad at (100, 1, 1) nearly square in UV space, producing 100x
    # directional texel-density skew. A disposable world-linear unwrap proxy
    # should keep the packed edge densities equal without touching the source
    # UV or object transform. Include a mirrored transform because proxy
    # normals may invert even though only its corner UVs are retained.
    for world_scale_x in (100.0, -100.0):
        density_mesh = bpy.data.meshes.new(
            f"__Blendlink World Density Mesh {world_scale_x}",
        )
        density_mesh.from_pydata([
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (1.0, 1.0, 0.0),
            (0.0, 1.0, 0.0),
        ], [], [
            (0, 1, 2, 3),
        ])
        density_mesh.update()
        density_object = bpy.data.objects.new(
            f"__Blendlink World Density {world_scale_x}",
            density_mesh,
        )
        bpy.context.scene.collection.objects.link(density_object)
        density_object.scale = (world_scale_x, 1.0, 1.0)
        density_source = density_mesh.uv_layers.new(
            name="Degenerate Source UV",
        )
        density_source.active_render = True
        for loop in density_source.data:
            # Degenerate plus out-of-bounds is deliberately not eligible for
            # the narrow local single-polygon rescue; it requires the complete
            # automatic Smart Project fallback under test.
            loop.uv = (2.0, 2.0)
        density_mesh.uv_layers.active = density_source
        density_mesh.update()
        bpy.context.view_layer.update()
        source_density_uvs = tuple(
            (tuple(loop.uv), bool(loop.pin_uv))
            for loop in density_source.data
        )
        # Adding/removing UV layers can replace Blender's RNA wrapper even
        # when the named layer survives. Do not retain it across preparation.
        del density_source
        source_density_matrix = tuple(
            value
            for row in density_object.matrix_world
            for value in row
        )
        density_result = bakelib.prepare_material_texture_uv(
            density_object,
            {
                "policy": "fallback-no-camera",
                "purpose": "preview",
                "materialSlotIndex": 0,
                "resolutionCeiling": 128,
                "fallbackResolution": 128,
                "targetProjectedPixels": None,
                "densityThreshold": 0.95,
                "worldAreaM2": abs(world_scale_x),
            },
        )
        packed_density_layer = density_mesh.uv_layers.get(
            density_result["uvName"],
        )
        density_polygon = density_mesh.polygons[0]
        directional_densities = []
        for offset, loop_index in enumerate(density_polygon.loop_indices):
            next_loop_index = density_polygon.loop_indices[
                (offset + 1) % len(density_polygon.loop_indices)
            ]
            loop = density_mesh.loops[loop_index]
            next_loop = density_mesh.loops[next_loop_index]
            world_start = (
                density_object.matrix_world
                @ density_mesh.vertices[loop.vertex_index].co
            )
            world_end = (
                density_object.matrix_world
                @ density_mesh.vertices[next_loop.vertex_index].co
            )
            world_length = (world_end - world_start).length
            uv_length = (
                packed_density_layer.data[next_loop_index].uv
                - packed_density_layer.data[loop_index].uv
            ).length
            directional_densities.append(
                uv_length * density_result["resolution"] / world_length
            )
        density_anisotropy = (
            max(directional_densities)
            / min(directional_densities)
        )
        expect(
            density_result["uvStrategy"] == "smart-project-fallback"
            and density_result["uvGenerationSpace"]
            == "world-linear-private-proxy"
            and density_result["repairCount"] == 0
            and density_result["uvRepairStrategies"] == []
            and density_anisotropy <= 1.001,
            "automatic selected-field UVs did not normalize directional "
            f"world density for scale {world_scale_x}: "
            f"anisotropy={density_anisotropy}, result={density_result}",
        )
        expect(
            tuple(
                (tuple(loop.uv), bool(loop.pin_uv))
                for loop in density_mesh.uv_layers.get(
                    "Degenerate Source UV",
                ).data
            ) == source_density_uvs,
            "world-linear unwrap changed the artist/source UV on "
            f"scale {world_scale_x}",
        )
        expect(
            tuple(
                value
                for row in density_object.matrix_world
                for value in row
            ) == source_density_matrix,
            "world-linear unwrap changed the receiver transform on "
            f"scale {world_scale_x}",
        )
        if world_scale_x > 0.0:
            object_ids_before_failure = {
                item.as_pointer() for item in bpy.data.objects
            }
            mesh_ids_before_failure = {
                item.as_pointer() for item in bpy.data.meshes
            }
            target_uvs_before_failure = tuple(
                tuple(loop.uv) for loop in packed_density_layer.data
            )
            original_projector = (
                bakelib._smart_project_private_uv_objects
            )

            def fail_world_projector(_objects, _uv_name):
                raise RuntimeError("forced world unwrap failure")

            bakelib._smart_project_private_uv_objects = (
                fail_world_projector
            )
            try:
                bakelib.smart_project_private_uvs(
                    [density_object],
                    density_result["uvName"],
                    world_linear=True,
                )
            except RuntimeError as error:
                expect(
                    "forced world unwrap failure" in str(error),
                    "world-linear unwrap hid its primary failure: "
                    f"{error}",
                )
            else:
                raise AssertionError(
                    "forced world-linear unwrap failure unexpectedly passed"
                )
            finally:
                bakelib._smart_project_private_uv_objects = (
                    original_projector
                )
            expect(
                {item.as_pointer() for item in bpy.data.objects}
                == object_ids_before_failure
                and {item.as_pointer() for item in bpy.data.meshes}
                == mesh_ids_before_failure,
                "failed world-linear unwrap leaked a temporary Object or Mesh",
            )
            packed_density_layer = density_mesh.uv_layers.get(
                density_result["uvName"],
            )
            expect(
                tuple(
                    tuple(loop.uv)
                    for loop in packed_density_layer.data
                ) == target_uvs_before_failure,
                "failed world-linear unwrap partially changed private UVs",
            )
        del packed_density_layer
        bpy.data.objects.remove(density_object, do_unlink=True)
        expect(
            density_mesh.users == 0,
            "world-linear density fixture Mesh retained an unexpected user",
        )
        bpy.data.meshes.remove(density_mesh)

    # Validate every world-linear proxy before copying any of them. A failure
    # during the second real topology/UV validation must leave the first
    # receiver untouched and remove both disposable proxy pairs.
    atomic_records = []
    for index in range(2):
        atomic_mesh = bpy.data.meshes.new(
            f"__Blendlink Atomic World Mesh {index}",
        )
        atomic_mesh.from_pydata([
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (1.0, 1.0, 0.0),
            (0.0, 1.0, 0.0),
        ], [], [
            (0, 1, 2, 3),
        ])
        atomic_mesh.update()
        atomic_layer = atomic_mesh.uv_layers.new(name="Atomic World UV")
        for loop_index, loop in enumerate(atomic_layer.data):
            loop.uv = (
                (2.0, 2.0),
                (3.0, 2.0),
                (3.0, 3.0),
                (2.0, 3.0),
            )[loop_index]
        atomic_object = bpy.data.objects.new(
            f"__Blendlink Atomic World {index}",
            atomic_mesh,
        )
        bpy.context.scene.collection.objects.link(atomic_object)
        atomic_object.scale = (100.0 if index == 0 else 1.0, 1.0, 1.0)
        atomic_records.append((atomic_object, atomic_mesh))
    bpy.context.view_layer.update()
    atomic_uvs_before = {
        atomic_object.name: tuple(
            tuple(loop.uv)
            for loop in atomic_mesh.uv_layers["Atomic World UV"].data
        )
        for atomic_object, atomic_mesh in atomic_records
    }
    atomic_object_ids_before = {
        item.as_pointer() for item in bpy.data.objects
    }
    atomic_mesh_ids_before = {
        item.as_pointer() for item in bpy.data.meshes
    }
    original_validator = bakelib._validated_private_uv_layers
    validation_calls = {"count": 0}

    def fail_second_world_validation(
            source_obj, target_obj, uv_name):
        validated = original_validator(source_obj, target_obj, uv_name)
        validation_calls["count"] += 1
        if validation_calls["count"] == 2:
            raise RuntimeError("forced second world validation failure")
        return validated

    bakelib._validated_private_uv_layers = fail_second_world_validation
    try:
        bakelib.smart_project_private_uvs(
            [record[0] for record in atomic_records],
            "Atomic World UV",
            world_linear=True,
        )
    except RuntimeError as error:
        expect(
            "forced second world validation failure" in str(error),
            f"second world validation failure was hidden: {error}",
        )
    else:
        raise AssertionError(
            "forced second world validation failure unexpectedly passed"
        )
    finally:
        bakelib._validated_private_uv_layers = original_validator
    expect(
        validation_calls["count"] == 2,
        "world-linear transaction did not reach the second validation",
    )
    expect(
        {item.as_pointer() for item in bpy.data.objects}
        == atomic_object_ids_before
        and {item.as_pointer() for item in bpy.data.meshes}
        == atomic_mesh_ids_before,
        "second world validation failure leaked a temporary Object or Mesh",
    )
    expect(
        all(
            tuple(
                tuple(loop.uv)
                for loop in atomic_mesh.uv_layers["Atomic World UV"].data
            ) == atomic_uvs_before[atomic_object.name]
            for atomic_object, atomic_mesh in atomic_records
        ),
        "second world validation failure partially copied an earlier proxy UV",
    )
    for atomic_object, atomic_mesh in atomic_records:
        bpy.data.objects.remove(atomic_object, do_unlink=True)
        expect(
            atomic_mesh.users == 0,
            "atomic world fixture Mesh retained an unexpected user",
        )
        bpy.data.meshes.remove(atomic_mesh)

    # A pinned authored layout owns its normalized placement, while the
    # required delivery gutter shrinks as resolution increases. Exercise the
    # full private selected-field transaction: this 0.045 UV-space gap cannot
    # satisfy 8px at 128 (0.0625), but it does satisfy 8px at 256 (0.03125).
    # Blendlink must retry the bounded next candidate instead of asking the
    # artist to repair an otherwise valid layout.
    gutter_retry_mesh = bpy.data.meshes.new(
        "__Blendlink Selected Field Gutter Retry Mesh",
    )
    gutter_retry_mesh.from_pydata([
        (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0),
        (2.0, 0.0, 0.0), (3.0, 0.0, 0.0), (2.0, 1.0, 0.0),
    ], [], [
        (0, 1, 2),
        (3, 4, 5),
    ])
    gutter_retry_object = bpy.data.objects.new(
        "__Blendlink Selected Field Gutter Retry", gutter_retry_mesh,
    )
    bpy.context.scene.collection.objects.link(gutter_retry_object)
    gutter_retry_layer = gutter_retry_mesh.uv_layers.new(
        name=bakelib.AUTHORED_UV,
    )
    for loop_index, uv in zip(
            gutter_retry_mesh.polygons[0].loop_indices,
            ((0.2, 0.2), (0.3, 0.2), (0.2, 0.3))):
        gutter_retry_layer.data[loop_index].uv = uv
        gutter_retry_layer.data[loop_index].pin_uv = True
    for loop_index, uv in zip(
            gutter_retry_mesh.polygons[1].loop_indices,
            ((0.345, 0.2), (0.445, 0.2), (0.345, 0.3))):
        gutter_retry_layer.data[loop_index].uv = uv
        gutter_retry_layer.data[loop_index].pin_uv = True
    gutter_retry_mesh.uv_layers.active = gutter_retry_layer
    gutter_retry_mesh.update()
    gutter_retry_messages = []
    gutter_retry_result = bakelib.prepare_material_texture_uv(
        gutter_retry_object,
        {
            "policy": "projected-camera-coverage",
            "purpose": "preview",
            "materialSlotIndex": 0,
            "resolutionCeiling": 256,
            "fallbackResolution": None,
            "targetProjectedPixels": 10000.0,
            "densityThreshold": 0.95,
            "worldAreaM2": 1.0,
        },
        log=gutter_retry_messages.append,
    )
    expect(
        gutter_retry_result["minimumCandidateResolution"] == 128
        and gutter_retry_result["resolution"] == 256
        and gutter_retry_result["uvGenerationSpace"] == "artist-authored"
        and gutter_retry_result["repairCount"] == 0
        and gutter_retry_result["uvRepairStrategies"] == []
        and gutter_retry_result["pinnedReceiver"],
        "resolution-dependent authored gutter did not advance from the "
        f"128px candidate to 256px: {gutter_retry_result}",
    )
    expect(
        any(
            "pinned authored UV gutter" in message
            and "128px" in message
            and "256px" in message
            for message in gutter_retry_messages
        ),
        "bounded authored-gutter retry was not reported to the artist: "
        f"{gutter_retry_messages}",
    )

    # A larger resolution cannot repair overlap. Preserve the existing loud,
    # immediate refusal and prove it never consumes another candidate.
    gutter_retry_layer = gutter_retry_mesh.uv_layers.get(
        bakelib.AUTHORED_UV,
    )
    for source_index, target_index in zip(
            gutter_retry_mesh.polygons[0].loop_indices,
            gutter_retry_mesh.polygons[1].loop_indices):
        gutter_retry_layer.data[target_index].uv = (
            gutter_retry_layer.data[source_index].uv
        )
    gutter_retry_mesh.update()
    overlap_messages = []
    try:
        bakelib.prepare_material_texture_uv(
            gutter_retry_object,
            {
                "policy": "projected-camera-coverage",
                "purpose": "preview",
                "materialSlotIndex": 0,
                "resolutionCeiling": 256,
                "fallbackResolution": None,
                "targetProjectedPixels": 10000.0,
                "densityThreshold": 0.95,
                "worldAreaM2": 1.0,
            },
            log=overlap_messages.append,
        )
    except RuntimeError as error:
        expect(
            "overlap" in str(error) and "at 128px" in str(error),
            f"non-resolution pinned failure was not immediate/actionable: {error}",
        )
        expect(
            not any("retrying the bounded" in message
                    for message in overlap_messages),
            "pinned overlap incorrectly consumed a larger resolution candidate: "
            f"{overlap_messages}",
        )
    else:
        raise AssertionError("pinned overlap incorrectly passed private UV preparation")

    # When delivery padding still cannot fit at the bounded ceiling, report
    # both the exact ceiling and the artist-owned layout action.
    gutter_retry_layer = gutter_retry_mesh.uv_layers.get(
        bakelib.AUTHORED_UV,
    )
    for loop_index, uv in zip(
            gutter_retry_mesh.polygons[1].loop_indices,
            ((0.32, 0.2), (0.42, 0.2), (0.32, 0.3))):
        gutter_retry_layer.data[loop_index].uv = uv
    gutter_retry_mesh.update()
    ceiling_messages = []
    try:
        bakelib.prepare_material_texture_uv(
            gutter_retry_object,
            {
                "policy": "projected-camera-coverage",
                "purpose": "preview",
                "materialSlotIndex": 0,
                "resolutionCeiling": 256,
                "fallbackResolution": None,
                "targetProjectedPixels": 10000.0,
                "densityThreshold": 0.95,
                "worldAreaM2": 1.0,
            },
            log=ceiling_messages.append,
        )
    except RuntimeError as error:
        expect(
            "256px resolution ceiling" in str(error)
            and "insufficient-gutter" in str(error)
            and "Repair/unpin" in str(error),
            f"pinned gutter ceiling failure was not artist-readable: {error}",
        )
        expect(
            sum("retrying the bounded" in message
                for message in ceiling_messages) == 1,
            "ceiling fixture did not make exactly one bounded 128->256 retry: "
            f"{ceiling_messages}",
        )
    else:
        raise AssertionError("under-padded pinned UV passed its resolution ceiling")
    bpy.data.objects.remove(gutter_retry_object, do_unlink=True)

    # Very thin positive-area geometry remains renderable, but it is a bounded
    # precision-rescue candidate when packing also leaves it without a delivery
    # texel center. Do not confuse that diagnostic with exact zero world area.
    rescue_mesh.vertices[2].co = (0.5, -0.9999999, 0.0)
    sentinel_polygon = rescue_mesh.polygons[0]
    rescue_layer = rescue_mesh.uv_layers.get(bakelib.ATLAS_UV)
    for loop_index in sentinel_polygon.loop_indices:
        rescue_layer.data[loop_index].uv = (0.5, 0.5)
    rescue_mesh.update()
    rescue_mesh.calc_loop_triangles()
    numerical_triangle = rescue_mesh.loop_triangles[0]
    numerical_quality = bakelib._triangle_geometry_quality(
        rescue_mesh,
        numerical_triangle,
        rescue_object.matrix_world.to_3x3(),
    )
    numerical_points = [
        tuple(rescue_layer.data[index].uv)
        for index in numerical_triangle.loops
    ]
    numerical_slivers = bakelib._precision_sliver_unsampleable_uv_triangles(
        rescue_object, bakelib.ATLAS_UV, 1024,
    )
    expect(
        numerical_slivers == [0],
        "near-collinear float32 triangle was not selected for bounded rescue: "
        f"{numerical_slivers}; quality={numerical_quality}; "
        f"uvArea={abs(bakelib._signed_polygon_area(numerical_points))}; "
        f"hasCenter={bakelib._uv_triangle_has_texel_center(numerical_points, 1024)}",
    )
    expect(0 in bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    ), "positive-area float32 sliver was incorrectly treated as zero geometry")
    sliver_scale_parent = bpy.data.objects.new(
        "__Blendlink Sliver Scale Parent", None,
    )
    bpy.context.scene.collection.objects.link(sliver_scale_parent)
    sliver_scale_parent.scale = (1.0, 10000000.0, 1.0)
    rescue_object.parent = sliver_scale_parent
    bpy.context.view_layer.update()
    expect(not bakelib._precision_sliver_unsampleable_uv_triangles(
        rescue_object, bakelib.ATLAS_UV, 1024,
    ), "inherited non-uniform scale left a well-conditioned world-space surface classified as a precision sliver")
    expect(0 in bakelib._nonzero_geometry_zero_uv_triangles(
        rescue_object, bakelib.ATLAS_UV,
    ), "inherited non-uniform scale hid a meaningful world-space collapsed-UV surface")
    bpy.data.objects.remove(rescue_object, do_unlink=True)
    bpy.data.objects.remove(sliver_scale_parent, do_unlink=True)

    # Exercise the post-pack repair transaction at its real boundary. Blender
    # stores UV layers as float32; translating/scaling a very thin but initially
    # valid triangle during a large multi-object pack can make two coordinates
    # identical. Collapse only the disposable derived layer to model that pack
    # result, then require whole-object reprojection + complete repack while the
    # authored layer remains byte-for-byte untouched.
    post_pack_layer = solidified_unpinned.data.uv_layers.get(bakelib.ATLAS_UV)
    for loop in post_pack_layer.data:
        loop.uv = (0.5, 0.5)
    post_pack_bad = bakelib._nonzero_geometry_zero_uv_triangles(
        solidified_unpinned, bakelib.ATLAS_UV,
    )
    expect(post_pack_bad,
           "post-pack repair fixture did not reproduce collapsed float32 UVs")
    held = bakelib.average_unpinned(
        [solidified_unpinned], bakelib.ATLAS_UV,
    )
    post_pack_messages = []
    post_pack_repairs, final_held = bakelib.pack_with_evaluated_uv_repair(
        [solidified_unpinned],
        bakelib.ATLAS_UV,
        lambda _obj: 1.0,
        16,
        1024,
        held=held,
        pin=True,
        log=post_pack_messages.append,
    )
    # Same Solidify inner/outer fold as above: the projection self-overlaps,
    # so the per-face rescue runs and reports itself.
    expect(post_pack_repairs == [{
        "object": solidified_unpinned.name,
        "triangleCount": len(post_pack_bad),
        "strategy": "smart-project-whole-unpinned-object+lightmap-rescue",
    }], f"unexpected post-pack repair report: {post_pack_repairs}")
    expect(final_held == {},
           f"post-pack repair invented pinned ownership: {final_held}")
    expect(not bakelib._nonzero_geometry_zero_uv_triangles(
        solidified_unpinned, bakelib.ATLAS_UV,
    ), "whole-object repair/repack left collapsed atlas triangles")
    expect(any("authored UV layers were preserved" in message
               for message in post_pack_messages),
           f"post-pack repair was not logged clearly: {post_pack_messages}")
    expect(tuple(
        (tuple(loop.uv), bool(loop.pin_uv))
        for loop in solidified_unpinned.data.uv_layers.get(
            bakelib.AUTHORED_UV,
        ).data
    ) == authored_before[solidified_unpinned.name],
           "post-pack repair changed the authored atlas layer")
    bpy.data.objects.remove(solidified_unpinned, do_unlink=True)
    bpy.data.objects.remove(solidified_pinned, do_unlink=True)

    lightmap_object = make_cube("__Blendlink Lightmap Export")
    lightmap_material = bpy.data.materials.new("__Blendlink Authored PBR")
    bakelib.ensure_shader_node_tree(lightmap_material)
    sentinel = lightmap_material.node_tree.nodes.new("ShaderNodeValue")
    sentinel.name = "Authored Graph Sentinel"
    lightmap_object.data.materials.append(lightmap_material)
    source_signature = sorted(
        (node.name, node.bl_idname) for node in lightmap_material.node_tree.nodes
    )
    lightmap_object.visible_shadow = False
    lightmap_object.visible_diffuse = False
    source_uv = lightmap_object.data.uv_layers[0]
    atlas_uv = lightmap_object.data.uv_layers.new(name=bakelib.ATLAS_UV)
    for index, loop in enumerate(atlas_uv.data):
        loop.uv = source_uv.data[index].uv
    channel = exporter.stamp_bake_output_metadata(lightmap_object, "lighting")
    expect(channel == 1 and lightmap_object["blendlink_lightmap_uv"] == 1,
           "Lighting object did not publish its TEXCOORD_1 binding")

    proxy, hidden = bakelib.join_proxy(
        [lightmap_object], "__Blendlink Private Proxy", "__Blendlink Neutral",
        private_materials=True,
    )
    proxy_material = proxy.material_slots[0].material
    expect(proxy_material is not lightmap_material,
           "bake proxy reused the exported PBR material datablock")
    expect(proxy_material.get("blendlink_bake_proxy_shadow_visible") is False
           and proxy_material.get("blendlink_bake_proxy_diffuse_visible") is False
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_SHADOW_PATH") is not None
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_SHADOW_TRANSPARENT") is not None
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_SHADOW_VISIBILITY") is not None
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_DIFFUSE_PATH") is not None
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_DIFFUSE_TRANSPARENT") is not None
           and proxy_material.node_tree.nodes.get("BLENDLINK_BAKE_DIFFUSE_VISIBILITY") is not None,
           "private proxy did not preserve source shadow/diffuse ray visibility")
    expect(lightmap_material.node_tree.nodes.get("BLENDLINK_BAKE_TARGET") is None
           and lightmap_material.node_tree.nodes.get("BLENDLINK_BAKE_SHADOW_PATH") is None
           and lightmap_material.node_tree.nodes.get("BLENDLINK_BAKE_DIFFUSE_PATH") is None
           and sorted((node.name, node.bl_idname)
                      for node in lightmap_material.node_tree.nodes) == source_signature,
           "bake proxy ray-visibility setup mutated the authored PBR graph")
    private_name = proxy_material.name
    bakelib.release_proxy(proxy, hidden)
    expect(not lightmap_object.hide_render and bpy.data.materials.get(private_name) is None,
           "private proxy cleanup leaked material data or visibility")

    # The outer receiver allocator is a pure deterministic seam. Its fixed
    # orientation and one global scale preserve every receiver's local UV
    # transform and density ratio. This rounded adversarial fixture also
    # proves the bounded MaxRects portfolio materially outperforms a simple
    # first-fit shelf without hiding rotation behind the interface.
    rectangle_fixture = [
        ("r00", 0.282, 0.098), ("r01", 0.228, 0.144),
        ("r02", 0.110, 0.252), ("r03", 0.189, 0.144),
        ("r04", 0.262, 0.152), ("r05", 0.154, 0.241),
        ("r06", 0.177, 0.244), ("r07", 0.316, 0.326),
        ("r08", 0.092, 0.282), ("r09", 0.174, 0.333),
        ("r10", 0.334, 0.328),
    ]
    rectangle_edge = 0.02
    rectangle_gutter = 0.03
    rectangle_allocation = bakelib.allocate_receiver_rectangles(
        rectangle_fixture,
        edge_gutter=rectangle_edge,
        receiver_gutter=rectangle_gutter,
    )
    for reordered in (
        list(reversed(rectangle_fixture)),
        rectangle_fixture[::2] + rectangle_fixture[1::2],
    ):
        expect(
            bakelib.allocate_receiver_rectangles(
                reordered,
                edge_gutter=rectangle_edge,
                receiver_gutter=rectangle_gutter,
            ) == rectangle_allocation,
            "receiver rectangle allocation changed with input order",
        )
    tied_rectangles = [
        ("Tie Z", 0.25, 0.20),
        ("Tie A", 0.25, 0.20),
        ("Tall", 0.15, 0.35),
        ("Wide", 0.35, 0.15),
    ]
    tied_allocation = bakelib.allocate_receiver_rectangles(
        tied_rectangles,
        edge_gutter=rectangle_edge,
        receiver_gutter=rectangle_gutter,
    )
    expect(
        tied_allocation == bakelib.allocate_receiver_rectangles(
            list(reversed(tied_rectangles)),
            edge_gutter=rectangle_edge,
            receiver_gutter=rectangle_gutter,
        )
        and tied_allocation["placements"]["Tie A"]
        != tied_allocation["placements"]["Tie Z"],
        "equal receiver dimensions did not use stable-name tie handling",
    )

    def shelf_fits(scale):
        side = 1.0 - 2.0 * rectangle_edge + rectangle_gutter
        items = sorted(
            ((name, width * scale + rectangle_gutter,
              height * scale + rectangle_gutter)
             for name, width, height in rectangle_fixture),
            key=lambda item: (-item[1] * item[2], -item[2], item[0]),
        )
        shelves = []
        used_height = 0.0
        for _name, width, height in items:
            for shelf in shelves:
                if (height <= shelf[1] + 1e-12
                        and shelf[0] + width <= side + 1e-12):
                    shelf[0] += width
                    break
            else:
                if width > side + 1e-12 or used_height + height > side + 1e-12:
                    return False
                shelves.append([width, height])
                used_height += height
        return True

    shelf_low, shelf_high = 0.0, 1.0
    while shelf_fits(shelf_high):
        shelf_low, shelf_high = shelf_high, shelf_high * 2.0
    for _iteration in range(48):
        shelf_middle = (shelf_low + shelf_high) / 2.0
        if shelf_fits(shelf_middle):
            shelf_low = shelf_middle
        else:
            shelf_high = shelf_middle
    expect(
        rectangle_allocation["scale"] > shelf_low * 1.30
        and rectangle_allocation["scale"] > 1.10,
        "MaxRects did not materially beat the deterministic shelf control: "
        f"maxrects={rectangle_allocation['scale']:.8g}, shelf={shelf_low:.8g}",
    )
    rectangle_sources = {
        name: (width, height) for name, width, height in rectangle_fixture
    }
    rectangle_items = sorted(rectangle_allocation["placements"].items())
    for name, bounds in rectangle_items:
        source_width, source_height = rectangle_sources[name]
        expect(
            math.isclose(
                (bounds[2] - bounds[0]) / source_width,
                rectangle_allocation["scale"], rel_tol=1e-10,
            )
            and math.isclose(
                (bounds[3] - bounds[1]) / source_height,
                rectangle_allocation["scale"], rel_tol=1e-10,
            )
            and min(
                bounds[0], bounds[1], 1.0 - bounds[2], 1.0 - bounds[3],
            ) >= rectangle_edge - 2e-10,
            f"receiver rectangle changed scale/aspect or edge gutter: {name}={bounds}",
        )
    for index, (left_name, left) in enumerate(rectangle_items):
        for right_name, right in rectangle_items[index + 1:]:
            expect(
                bakelib._uv_bounds_tuple_distance(left, right)
                >= rectangle_gutter - 2e-10,
                "receiver rectangles overlap or miss their gutter: "
                f"{left_name}/{right_name}",
            )

    # Hierarchical packing must still treat Blender receivers as distinct
    # owners. Exercise two disconnected charts per receiver and unequal
    # density weights through actual float32 UV storage.
    def make_grouped_pack_receiver(name):
        mesh = bpy.data.meshes.new(name + " Mesh")
        mesh.from_pydata(
            [(-2, -1, 0), (-1, -1, 0), (-1, 0, 0), (-2, 0, 0),
             (1, 0, 0), (2, 0, 0), (2, 1, 0), (1, 1, 0)],
            [], [(0, 1, 2, 3), (4, 5, 6, 7)],
        )
        mesh.update()
        uv = mesh.uv_layers.new(name=bakelib.ATLAS_UV)
        # Deliberately stacked source charts: the local owner pack must split
        # them before the receiver rectangles are globally allocated.
        for polygon in mesh.polygons:
            for loop_index, coordinate in zip(
                    polygon.loop_indices,
                    ((0.0, 0.0), (0.25, 0.0), (0.25, 0.25), (0.0, 0.25))):
                uv.data[loop_index].uv = coordinate
        mesh.uv_layers.active = uv
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj

    grouped_pack_a = make_grouped_pack_receiver("__Blendlink Group Pack A")
    grouped_pack_b = make_grouped_pack_receiver("__Blendlink Group Pack B")
    grouped_coordinates_before_failure = {
        obj.name: [
            tuple(loop.uv)
            for loop in obj.data.uv_layers[bakelib.ATLAS_UV].data
        ]
        for obj in (grouped_pack_a, grouped_pack_b)
    }
    production_allocator = bakelib.allocate_receiver_rectangles

    def fail_outer_allocation(*_args, **_kwargs):
        raise RuntimeError("injected receiver allocation failure")

    bakelib.allocate_receiver_rectangles = fail_outer_allocation
    try:
        try:
            bakelib._pack_receiver_groups(
                [grouped_pack_b, grouped_pack_a],
                margin_px=16, size=4096, guard_px=4,
            )
        except RuntimeError as error:
            expect(
                str(error) == "injected receiver allocation failure",
                f"allocator fault injection surfaced the wrong failure: {error}",
            )
        else:
            raise AssertionError("receiver allocator fault injection did not fail")
    finally:
        bakelib.allocate_receiver_rectangles = production_allocator
    for grouped_pack in (grouped_pack_a, grouped_pack_b):
        expect(
            [
                tuple(loop.uv)
                for loop in grouped_pack.data.uv_layers[bakelib.ATLAS_UV].data
            ] == grouped_coordinates_before_failure[grouped_pack.name],
            f"{grouped_pack.name}: allocator failure did not roll back local UV packing",
        )
    grouped_held = bakelib.average_unpinned(
        [grouped_pack_a, grouped_pack_b], bakelib.ATLAS_UV,
    )
    expect(not grouped_held, "un-pinned group-pack fixture unexpectedly held UVs")
    grouped_repairs, grouped_final_held = bakelib.pack_with_evaluated_uv_repair(
        [grouped_pack_a, grouped_pack_b], bakelib.ATLAS_UV,
        lambda obj: 2.0 if obj is grouped_pack_b else 1.0,
        margin_px=16, size=4096, held=grouped_held, pin=True,
        delivery_size=4096, guard_px=4,
    )
    expect(not grouped_repairs and not grouped_final_held,
           f"focused group pack needed unexpected repair: {grouped_repairs}")
    grouped_area_a = bakelib.packed_uv_area(grouped_pack_a)
    grouped_area_b = bakelib.packed_uv_area(grouped_pack_b)
    expect(
        math.isclose(grouped_area_b / grouped_area_a, 4.0, rel_tol=2e-3),
        "hierarchical receiver pack lost the 2x linear density weight: "
        f"areas={grouped_area_a:.8g}/{grouped_area_b:.8g}",
    )
    grouped_bounds_a = bakelib._active_uv_bounds(grouped_pack_a)
    grouped_bounds_b = bakelib._active_uv_bounds(grouped_pack_b)
    expect(
        bakelib._uv_bounds_tuple_distance(grouped_bounds_a, grouped_bounds_b) * 4096
        >= bakelib.required_bake_gutter_px(16) - 0.01,
        "hierarchical receiver rectangles overlap or miss the native bake gutter: "
        f"a={grouped_bounds_a}, b={grouped_bounds_b}",
    )
    for grouped_pack in (grouped_pack_a, grouped_pack_b):
        bounds = bakelib._active_uv_bounds(grouped_pack)
        edge_px = min(
            bounds[0], bounds[1], 1.0 - bounds[2], 1.0 - bounds[3],
        ) * 4096
        expect(edge_px >= 20.0 - 0.01,
               f"hierarchical receiver edge gutter collapsed: {bounds}")
    bpy.data.objects.remove(grouped_pack_a, do_unlink=True)
    bpy.data.objects.remove(grouped_pack_b, do_unlink=True)

    # Needle and Blender keep separate selected receivers in one shared image.
    # This is not merely a performance choice: joining collapses Object
    # Attribute/Object Info/Generated-coordinate context to one object. Prove
    # the package primitive retains exact per-object shader values, margins,
    # selection, and authored node-tree state.
    context_material = bpy.data.materials.new("__Blendlink Object Context")
    context_tree = bakelib.ensure_shader_node_tree(context_material)
    context_tree.nodes.clear()
    context_output = context_tree.nodes.new("ShaderNodeOutputMaterial")
    context_emission = context_tree.nodes.new("ShaderNodeEmission")
    context_attribute = context_tree.nodes.new("ShaderNodeAttribute")
    context_attribute.attribute_type = "OBJECT"
    context_attribute.attribute_name = "Tint"
    context_object_info = context_tree.nodes.new("ShaderNodeObjectInfo")
    context_sentinel = context_tree.nodes.new("ShaderNodeValue")
    context_sentinel.name = "Authored Active Node"
    for node in context_tree.nodes:
        node.select = node is context_sentinel
    context_tree.nodes.active = context_sentinel
    context_tree.links.new(
        context_attribute.outputs["Color"], context_emission.inputs["Color"],
    )
    context_tree.links.new(
        context_object_info.outputs["Alpha"], context_emission.inputs["Strength"],
    )
    context_tree.links.new(
        context_emission.outputs["Emission"], context_output.inputs["Surface"],
    )

    def make_context_plane(name, u_min, u_max, tint, alpha):
        mesh = bpy.data.meshes.new(name + " Mesh")
        mesh.from_pydata(
            [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0),
             (1.0, 1.0, 0.0), (-1.0, 1.0, 0.0)],
            [], [(0, 1, 2, 3)],
        )
        mesh.update()
        uv = mesh.uv_layers.new(name=bakelib.ATLAS_UV)
        coordinates = (
            (u_min, 0.1), (u_max, 0.1), (u_max, 0.9), (u_min, 0.9),
        )
        for loop in mesh.loops:
            uv.data[loop.index].uv = coordinates[loop.vertex_index]
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj["Tint"] = list(tint)
        obj.color = (1.0, 1.0, 1.0, alpha)
        obj.data.materials.append(context_material)
        return obj

    context_red = make_context_plane(
        "__Blendlink Context Red", 4 / 64, 25 / 64,
        (1.0, 0.0, 0.0, 1.0), 0.25,
    )
    context_green = make_context_plane(
        "__Blendlink Context Green", 35 / 64, 56 / 64,
        (0.0, 1.0, 0.0, 1.0), 0.75,
    )
    context_hidden_collection = bpy.data.collections.new(
        "__Blendlink Viewport Hidden Bake Receivers"
    )
    bpy.context.scene.collection.children.link(context_hidden_collection)
    for collection in list(context_green.users_collection):
        collection.objects.unlink(context_green)
    context_hidden_collection.objects.link(context_green)
    context_hidden_layer = bpy.context.view_layer.layer_collection.children[
        context_hidden_collection.name
    ]
    # These flags are artist interaction state, not render visibility. The
    # native receiver path must still bake this plane and restore all three.
    context_green.hide_select = True
    context_green.hide_viewport = True
    context_green.hide_set(True, view_layer=bpy.context.view_layer)
    context_hidden_collection.hide_viewport = True
    context_hidden_layer.hide_viewport = True
    context_image = bpy.data.images.new(
        "__Blendlink Object Context Target", width=64, height=32,
        alpha=True, float_buffer=True,
    )
    context_signature = sorted(
        (node.name, node.bl_idname, bool(node.select))
        for node in context_tree.nodes
    )
    previous_engine = bpy.context.scene.render.engine
    previous_samples = bpy.context.scene.cycles.samples
    previous_adaptive = bpy.context.scene.cycles.use_adaptive_sampling
    select_only(lightmap_object)
    try:
        bpy.context.scene.render.engine = "CYCLES"
        bpy.context.scene.cycles.samples = 1
        bpy.context.scene.cycles.use_adaptive_sampling = False
        bakelib.bake_objects_to_image(
            [context_red, context_green], context_image,
            bake_type="EMIT", margin_px=3,
        )
    finally:
        bpy.context.scene.render.engine = previous_engine
        bpy.context.scene.cycles.samples = previous_samples
        bpy.context.scene.cycles.use_adaptive_sampling = previous_adaptive
    context_pixels = list(context_image.pixels)

    def context_sample(x, y):
        offset = (y * context_image.size[0] + x) * 4
        return tuple(context_pixels[offset + channel] for channel in range(4))

    red_sample = context_sample(16, 16)
    green_sample = context_sample(48, 16)
    expect(
        abs(red_sample[0] - 0.25) < 0.01
        and red_sample[1] < 0.01
        and green_sample[0] < 0.01
        and abs(green_sample[1] - 0.75) < 0.01,
        f"native multi-object bake lost Object Attribute/Info context: "
        f"red={red_sample}, green={green_sample}",
    )
    expect(
        bakelib.required_bake_gutter_px(3) == 10,
        "native multi-object gutter did not reserve both 3px EXTEND bands plus guard",
    )
    red_row = [x for x in range(64) if context_sample(x, 16)[0] > 0.1]
    green_row = [x for x in range(64) if context_sample(x, 16)[1] > 0.1]
    expect(
        red_row and green_row
        and min(green_row) - max(red_row) - 1 >= 3,
        "native multi-object padding bands crossed the required gutter: "
        f"red={min(red_row)}..{max(red_row)}, "
        f"green={min(green_row)}..{max(green_row)}",
    )
    restored_context_signature = sorted(
        (node.name, node.bl_idname, bool(node.select))
        for node in context_tree.nodes
    )
    restored_context_active = context_tree.nodes.active
    expect(
        restored_context_signature == context_signature
        and restored_context_active is not None
        and restored_context_active.as_pointer() == context_sentinel.as_pointer()
        and context_tree.nodes.get("BLENDLINK_BAKE_TARGET") is None,
        "native multi-object bake did not restore the authored material graph: "
        f"before={context_signature}, after={restored_context_signature}, "
        f"active={getattr(restored_context_active, 'name', None)!r}",
    )
    expect(
        bpy.context.selected_objects == [lightmap_object]
        and bpy.context.view_layer.objects.active is lightmap_object,
        "native multi-object bake did not restore object selection/active state",
    )
    expect(
        context_green.hide_select
        and context_green.hide_viewport
        and context_green.hide_get(view_layer=bpy.context.view_layer),
        "native multi-object bake did not restore viewport-only receiver state",
    )
    expect(
        context_hidden_collection.hide_viewport
        and context_hidden_layer.hide_viewport,
        "native multi-object bake did not restore collection viewport state",
    )

    # A failed native bake must unwind every temporary mutation. Keep a
    # selected object with no active object (legal Blender state), add a null
    # material slot, and retain the viewport-hidden receiver so this exercises
    # the full transaction rather than only a pristine happy path.
    context_red.data.materials.append(None)
    select_only(lightmap_object)
    bpy.context.view_layer.objects.active = None
    failed_bake_error = None
    previous_engine = bpy.context.scene.render.engine
    try:
        bpy.context.scene.render.engine = "BLENDER_WORKBENCH"
        try:
            bakelib.bake_objects_to_image(
                [context_red, context_green], context_image,
                bake_type="EMIT", margin_px=3,
            )
        except RuntimeError as error:
            failed_bake_error = str(error)
    finally:
        bpy.context.scene.render.engine = previous_engine
    expect(
        failed_bake_error is not None
        and "does not support baking" in failed_bake_error,
        f"non-Cycles bake did not fail loudly: {failed_bake_error!r}",
    )
    expect(
        len(context_red.data.materials) == 2
        and context_red.data.materials[1] is None
        and context_tree.nodes.get("BLENDLINK_BAKE_TARGET") is None
        and sorted(
            (node.name, node.bl_idname, bool(node.select))
            for node in context_tree.nodes
        ) == context_signature,
        "failed native bake did not restore material slots/graph exactly",
    )
    expect(
        bpy.context.selected_objects == [lightmap_object]
        and bpy.context.view_layer.objects.active is None,
        "failed native bake did not restore selected-without-active state",
    )
    expect(
        context_green.hide_select
        and context_green.hide_viewport
        and context_green.hide_get(view_layer=bpy.context.view_layer)
        and context_hidden_collection.hide_viewport
        and context_hidden_layer.hide_viewport,
        "failed native bake did not restore viewport interaction state",
    )
    context_red.data.materials.pop(index=1)
    bpy.context.view_layer.objects.active = lightmap_object

    # The compositor guide contract is albedo-only until Blendlink can produce
    # a signed common-space normal. A Blender OBJECT normal image must never be
    # silently connected to OIDN.
    previous_engine = bpy.context.scene.render.engine
    guide_albedo = None
    try:
        bpy.context.scene.render.engine = "CYCLES"
        guide_albedo, guide_normal = exporter.bake_denoise_guides(
            [context_red, context_green], 64, "headless-contract", 3,
        )
        expect(
            guide_albedo is not None and guide_normal is None,
            "denoise guide route supplied a non-common-space normal",
        )
    finally:
        bpy.context.scene.render.engine = previous_engine
        if guide_albedo is not None and guide_albedo.name in bpy.data.images:
            bpy.data.images.remove(guide_albedo)

    # Blender's exporter maps UV layer order to TEXCOORD_n. Exercise a real
    # GLB so metadata and the secondary UV cannot drift apart unnoticed.
    with tempfile.TemporaryDirectory(prefix="blendlink-lightmap-glb-") as tmp:
        glb_path = Path(tmp) / "lightmap.glb"
        select_only(lightmap_object)
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path), export_format="GLB", use_selection=True,
            export_apply=True, export_texcoords=True, export_materials="EXPORT",
            export_extras=True,
        )
        glb = glb_path.read_bytes()
        magic, version, byte_length = struct.unpack_from("<4sII", glb, 0)
        json_length, json_type = struct.unpack_from("<II", glb, 12)
        expect(magic == b"glTF" and version == 2 and byte_length == len(glb)
               and json_type == 0x4E4F534A,
               "focused lightmap fixture did not produce a valid GLB")
        document = json.loads(glb[20:20 + json_length].decode("utf8").rstrip(" \0"))
        exported_node = next(
            node for node in document["nodes"]
            if node.get("extras", {}).get("blendlink_bake_output") == "lighting"
        )
        primitive = document["meshes"][exported_node["mesh"]]["primitives"][0]
        expect(exported_node["extras"].get("blendlink_lightmap_uv") == 1
               and "TEXCOORD_0" in primitive["attributes"]
               and "TEXCOORD_1" in primitive["attributes"],
               "GLB lost the authored/material UV or separate lightmap UV")
        exported_material = document["materials"][primitive["material"]]
        expect("pbrMetallicRoughness" in exported_material,
               "Lighting GLB flattened the authored material instead of exporting PBR")
    expect(sorted((node.name, node.bl_idname)
                  for node in lightmap_material.node_tree.nodes) == source_signature,
           "GLB export mutated the authored PBR graph")

    # Four authored UV maps would place the lightmap on unsupported channel 4;
    # catch this before the expensive Cycles stage.
    overflow_uvs = make_cube("__Blendlink Lightmap UV Overflow")
    while len(overflow_uvs.data.uv_layers) < 4:
        overflow_uvs.data.uv_layers.new(name=f"Authored {len(overflow_uvs.data.uv_layers)}")
    overflow_uvs.data.uv_layers.new(name=bakelib.ATLAS_UV)
    overflow_blocked = False
    try:
        exporter.lightmap_uv_channel(overflow_uvs)
    except RuntimeError as error:
        overflow_blocked = "TEXCOORD_4" in str(error) and "before syncing" in str(error)
    expect(overflow_blocked, "unsupported lightmap UV channel did not block before Cycles")

    bpy.data.objects.remove(lightmap_object, do_unlink=True)
    bpy.data.objects.remove(overflow_uvs, do_unlink=True)
    bpy.data.objects.remove(context_red, do_unlink=True)
    bpy.data.objects.remove(context_green, do_unlink=True)
    bpy.context.scene.collection.children.unlink(context_hidden_collection)
    bpy.data.collections.remove(context_hidden_collection)
    bpy.data.materials.remove(lightmap_material, do_unlink=True)
    bpy.data.materials.remove(context_material, do_unlink=True)
    bpy.data.images.remove(context_image)

    # Pinned authored UVs are an artist-owned escape hatch, so invalid locks
    # must stop before Cycles rather than silently publishing corrupt pixels.
    saved_mesh_visibility = [
        (obj, obj.hide_render) for obj in bpy.context.scene.objects
        if obj.type == "MESH"
    ]
    for obj, _ in saved_mesh_visibility:
        obj.hide_render = True
    pinned_fixtures = []

    def make_pinned_fixture(name, vertices, faces, uv_faces):
        mesh = bpy.data.meshes.new(name + " Mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        layer = mesh.uv_layers.new(name=bakelib.AUTHORED_UV)
        for polygon, coordinates in zip(mesh.polygons, uv_faces):
            for loop_index, coordinate in zip(polygon.loop_indices, coordinates):
                layer.data[loop_index].uv = coordinate
                layer.data[loop_index].pin_uv = True
        pinned_fixtures.append(obj)
        return obj

    try:
        folded = make_pinned_fixture(
            "__Blendlink Pinned Folded",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, -1, 0)],
            [(0, 1, 2), (1, 0, 3)],
            [
                [(0.1, 0.1), (0.4, 0.1), (0.1, 0.4)],
                [(0.4, 0.1), (0.1, 0.1), (0.1, 0.4)],
            ],
        )
        collapsed = make_pinned_fixture(
            "__Blendlink Pinned Partially Collapsed",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, -1, 0)],
            [(0, 1, 2), (1, 0, 3)],
            [
                [(0.1, 0.1), (0.4, 0.1), (0.1, 0.4)],
                [(0.4, 0.1), (0.1, 0.1), (0.25, 0.1)],
            ],
        )
        zero_geometry = make_pinned_fixture(
            "__Blendlink Pinned Zero Geometry",
            [
                (0, 0, 0), (1, 0, 0), (0, 1, 0),
                (2, 0, 0), (3, 0, 0), (4, 0, 0),
            ],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.25, 0.25), (0.5, 0.25), (0.25, 0.5)],
                [(0.25, 0.25), (0.5, 0.25), (0.25, 0.5)],
            ],
        )
        stacked = make_pinned_fixture(
            "__Blendlink Pinned Stacked",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0),
             (2, 0, 0), (3, 0, 0), (2, 1, 0)],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.55, 0.1), (0.85, 0.1), (0.55, 0.4)],
                [(0.55, 0.1), (0.85, 0.1), (0.55, 0.4)],
            ],
        )
        cross_object = make_pinned_fixture(
            "__Blendlink Pinned Cross Object",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0)],
            [(0, 1, 2)],
            [[(0.6, 0.15), (0.9, 0.15), (0.6, 0.45)]],
        )
        outside = make_pinned_fixture(
            "__Blendlink Pinned Outside",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0)],
            [(0, 1, 2)],
            [[(0.9, 0.7), (1.1, 0.7), (0.9, 0.9)]],
        )
        bbox_only = make_pinned_fixture(
            "__Blendlink Pinned BBox Contact",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0),
             (2, 0, 0), (3, 0, 0), (2, 1, 0)],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.0, 0.0), (0.6, 0.0), (0.0, 0.6)],
                [(1.0, 1.0), (0.4, 1.0), (1.0, 0.4)],
            ],
        )
        near_gutter = make_pinned_fixture(
            "__Blendlink Pinned Near Gutter",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0),
             (2, 0, 0), (3, 0, 0), (2, 1, 0)],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.2, 0.2), (0.3, 0.2), (0.2, 0.3)],
                [(0.32, 0.2), (0.42, 0.2), (0.32, 0.3)],
            ],
        )
        edge_gutter = make_pinned_fixture(
            "__Blendlink Pinned Edge Gutter",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0)],
            [(0, 1, 2)],
            [[(0.01, 0.6), (0.11, 0.6), (0.01, 0.7)]],
        )
        sufficient_gutter = make_pinned_fixture(
            "__Blendlink Pinned Sufficient Gutter",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0),
             (2, 0, 0), (3, 0, 0), (2, 1, 0)],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.2, 0.6), (0.3, 0.6), (0.2, 0.7)],
                [(0.4, 0.6), (0.5, 0.6), (0.4, 0.7)],
            ],
        )
        radial_spokes = 512
        radial_vertices = [(0.0, 0.0, 0.0)] + [
            (
                math.cos(2.0 * math.pi * index / radial_spokes),
                math.sin(2.0 * math.pi * index / radial_spokes),
                0.0,
            )
            for index in range(radial_spokes)
        ]
        radial_faces = [
            (0, index + 1, ((index + 1) % radial_spokes) + 1)
            for index in range(radial_spokes)
        ]
        radial_uvs = [
            [
                (0.5, 0.5),
                (
                    0.5 + 0.3 * math.cos(2.0 * math.pi * index / radial_spokes),
                    0.5 + 0.3 * math.sin(2.0 * math.pi * index / radial_spokes),
                ),
                (
                    0.5 + 0.3 * math.cos(
                        2.0 * math.pi * (index + 1) / radial_spokes
                    ),
                    0.5 + 0.3 * math.sin(
                        2.0 * math.pi * (index + 1) / radial_spokes
                    ),
                ),
            ]
            for index in range(radial_spokes)
        ]
        radial_fan = make_pinned_fixture(
            "__Blendlink Pinned Dense Radial Fan",
            radial_vertices,
            radial_faces,
            radial_uvs,
        )
        wrapped_boundary = [
            (0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8),
            (0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8),
        ]
        wrapped_winding = make_pinned_fixture(
            "__Blendlink Pinned Consistent Winding Overlap",
            [(0.0, 0.0, 0.0)] + [
                (
                    math.cos(2.0 * math.pi * index / len(wrapped_boundary)),
                    math.sin(2.0 * math.pi * index / len(wrapped_boundary)),
                    0.0,
                )
                for index in range(len(wrapped_boundary))
            ],
            [
                (0, index + 1, ((index + 1) % len(wrapped_boundary)) + 1)
                for index in range(len(wrapped_boundary))
            ],
            [
                [
                    (0.5, 0.5),
                    wrapped_boundary[index],
                    wrapped_boundary[(index + 1) % len(wrapped_boundary)],
                ]
                for index in range(len(wrapped_boundary))
            ],
        )

        # Packer-island fixtures. Every one marks the shared edge SEAM so
        # _uv_polygon_islands reports two topological islands; that isolates
        # _uv_welded_island_pairs as the only thing deciding whether a gutter
        # is owed, which is exactly the predicate under test. (Unseamed, the
        # 1e-7 in _uv_close would merge some of these topologically and the
        # pair would never be compared at all.)
        def mark_seam(obj, vertex_pair):
            target = tuple(sorted(vertex_pair))
            for edge in obj.data.edges:
                if tuple(sorted(edge.vertices)) == target:
                    edge.use_seam = True
                    return
            raise AssertionError(
                f"seam edge {vertex_pair} missing from {obj.name}")

        def packer_islands(obj):
            layer = obj.data.uv_layers[bakelib.AUTHORED_UV]
            roots, _numbers = bakelib._uv_polygon_islands(obj.data, layer)
            welded = bakelib._uv_welded_island_pairs(obj.data, layer, roots)
            return len(set(roots)), len(set(welded.values()))

        # Two triangles across shared edge (1, 2), bit-equal UVs on both
        # endpoints: one chart the packer moves rigidly.
        welded_seam = make_pinned_fixture(
            "__Blendlink Pinned Welded Seam",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0)],
            [(0, 1, 2), (1, 3, 2)],
            [
                [(0.2, 0.2), (0.4, 0.2), (0.2, 0.4)],
                [(0.4, 0.2), (0.4, 0.4), (0.2, 0.4)],
            ],
        )
        mark_seam(welded_seam, (1, 2))
        # The same UVs with the vertices split. No shared mesh edge, so the
        # packer separates these (measured 0.10 at margin 0.05) and the
        # gutter is genuinely owed. This is the configuration a sloppy
        # "distance == 0 means welded" predicate would wave through.
        split_touch = make_pinned_fixture(
            "__Blendlink Pinned Split Touch",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0),
             (1, 0, 0), (1, 1, 0), (0, 1, 0)],
            [(0, 1, 2), (3, 4, 5)],
            [
                [(0.2, 0.6), (0.4, 0.6), (0.2, 0.8)],
                [(0.4, 0.6), (0.4, 0.8), (0.2, 0.8)],
            ],
        )
        # Shared mesh edge, UVs off by a hair. Blender splits the island at
        # 1e-7, so an epsilon creeping into the predicate -- the precise
        # failure of the reverted 46ffe8b -- must not exempt these.
        near_welds = []
        for label, delta in (("1e-7", 1.0e-7), ("1e-5", 1.0e-5)):
            near_weld = make_pinned_fixture(
                f"__Blendlink Pinned Near Weld {label}",
                [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0)],
                [(0, 1, 2), (1, 3, 2)],
                [
                    [(0.5, 0.2), (0.7, 0.2), (0.5, 0.4)],
                    [(0.7 + delta, 0.2), (0.7 + delta, 0.4), (0.5 + delta, 0.4)],
                ],
            )
            mark_seam(near_weld, (1, 2))
            near_welds.append((label, delta, near_weld))
        # A fold whose hinge is a real weld: same packer island, so no gutter
        # is owed, but the two halves positively intersect. Exempting the
        # pair from the gutter must not exempt it from overlap -- this is the
        # assertion a "merge the BVHs instead" refactor would break.
        folded_weld = make_pinned_fixture(
            "__Blendlink Pinned Folded Weld",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0)],
            [(0, 1, 2), (1, 3, 2)],
            [
                [(0.5, 0.6), (0.7, 0.6), (0.5, 0.8)],
                [(0.7, 0.6), (0.55, 0.65), (0.5, 0.8)],
            ],
        )
        mark_seam(folded_weld, (1, 2))

        expect(packer_islands(welded_seam) == (2, 1),
               "a bit-welded seam did not collapse to one packer island while "
               f"staying two topological ones: {packer_islands(welded_seam)}")
        welded_seam_issues = bakelib.pinned_uv_layout_issues(
            [welded_seam], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(not welded_seam_issues,
               "two halves of one packer island were charged a gutter the "
               f"packer cannot open: {welded_seam_issues}")
        welded_seam.hide_render = True
        expect(packer_islands(split_touch) == (2, 2),
               "UV coincidence without surface adjacency was treated as a "
               f"weld: {packer_islands(split_touch)}")
        split_touch_issues = bakelib.pinned_uv_layout_issues(
            [split_touch], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(any(item["kind"] == "insufficient-gutter"
                   for item in split_touch_issues),
               "split vertices sharing a UV border were exempted from the "
               f"gutter the packer would give them: {split_touch_issues}")
        split_touch.hide_render = True
        for label, delta, near_weld in near_welds:
            expect(packer_islands(near_weld) == (2, 2),
                   f"a {label} UV mismatch was welded even though Blender "
                   f"splits it: {packer_islands(near_weld)}")
            near_weld_issues = bakelib.pinned_uv_layout_issues(
                [near_weld], bakelib.AUTHORED_UV, minimum_gutter=0.05,
            )
            expect(any(item["kind"] == "insufficient-gutter"
                       for item in near_weld_issues),
                   f"islands {delta} apart were exempted from the gutter: "
                   f"{near_weld_issues}")
            near_weld.hide_render = True
        expect(packer_islands(folded_weld) == (2, 1),
               "the folded fixture stopped being one packer island, so it no "
               f"longer tests the exemption: {packer_islands(folded_weld)}")
        folded_weld_issues = bakelib.pinned_uv_layout_issues(
            [folded_weld], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(any("overlap" in item["kind"] for item in folded_weld_issues),
               "a fold hinged on a weld passed the layout proof because the "
               f"pair was exempt from the gutter: {folded_weld_issues}")
        folded_weld.hide_render = True

        folded_issues = bakelib.pinned_uv_layout_issues(
            [folded], bakelib.AUTHORED_UV,
        )
        expect(any(item["kind"] == "self-overlap" for item in folded_issues),
               f"folded pinned island was not rejected: {folded_issues}")
        collapsed_issues = bakelib.pinned_uv_layout_issues(
            [collapsed], bakelib.AUTHORED_UV,
        )
        expect(any(item["kind"] == "degenerate" for item in collapsed_issues),
               f"partially collapsed pinned island was not rejected: {collapsed_issues}")
        zero_geometry_issues = bakelib.pinned_uv_layout_issues(
            [zero_geometry], bakelib.AUTHORED_UV,
        )
        expect(not any(
            item["kind"] == "degenerate" or "overlap" in item["kind"]
            for item in zero_geometry_issues
        ),
               "a nonzero-UV zero-world-area triangle blocked a UV proof even though it "
               f"cannot cover a rendered pixel: {zero_geometry_issues}")
        stacked_issues = bakelib.pinned_uv_layout_issues(
            [stacked, cross_object], bakelib.AUTHORED_UV,
        )
        expect(any(item["kind"] == "overlap"
                   and item["object"] == item["otherObject"]
                   for item in stacked_issues),
               f"same-object pinned islands were not rejected: {stacked_issues}")
        expect(any(item["kind"] == "overlap"
                   and item["object"] != item["otherObject"]
                   for item in stacked_issues),
               f"cross-object pinned islands were not rejected: {stacked_issues}")
        outside_issues = bakelib.pinned_uv_layout_issues(
            [outside], bakelib.AUTHORED_UV,
        )
        expect(any(item["kind"] == "out-of-bounds" for item in outside_issues),
               f"out-of-bounds pinned island was not rejected: {outside_issues}")
        bbox_issues = bakelib.pinned_uv_layout_issues(
            [bbox_only], bakelib.AUTHORED_UV,
        )
        expect(not any("overlap" in item["kind"] for item in bbox_issues),
               f"bbox-only contact was falsely rejected: {bbox_issues}")
        bbox_only.hide_render = True
        near_gutter_issues = bakelib.pinned_uv_layout_issues(
            [near_gutter], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(any(item["kind"] == "insufficient-gutter"
                   for item in near_gutter_issues),
               f"under-padded pinned islands were not rejected: {near_gutter_issues}")
        edge_gutter_issues = bakelib.pinned_uv_layout_issues(
            [edge_gutter], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(any(item["kind"] == "insufficient-edge-gutter"
                   for item in edge_gutter_issues),
               f"under-padded atlas edge was not rejected: {edge_gutter_issues}")
        sufficient_gutter_issues = bakelib.pinned_uv_layout_issues(
            [sufficient_gutter], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(not sufficient_gutter_issues,
               f"sufficient pinned gutter was falsely rejected: {sufficient_gutter_issues}")
        sufficient_gutter.hide_render = True
        expect(bakelib._segments_may_intersect(
            (0.0, 0.0002), (0.0002, 0.0002),
            (0.0001, 0.0001), (0.0001, 0.0003),
        ), "short proper boundary crossing was lost to a dimensionally invalid epsilon")
        original_triangle_clip = bakelib._triangle_intersection_area
        original_boundary_conflict = bakelib._boundary_segments_conflict
        radial_clip_calls = 0
        radial_boundary_calls = 0

        def counted_triangle_clip(left, right):
            nonlocal radial_clip_calls
            radial_clip_calls += 1
            return original_triangle_clip(left, right)

        def counted_boundary_conflict(left, right):
            nonlocal radial_boundary_calls
            radial_boundary_calls += 1
            return original_boundary_conflict(left, right)

        bakelib._triangle_intersection_area = counted_triangle_clip
        bakelib._boundary_segments_conflict = counted_boundary_conflict
        try:
            radial_issues = bakelib.pinned_uv_layout_issues(
                [radial_fan], bakelib.AUTHORED_UV, minimum_gutter=0.05,
            )
            radial_boundary_total = radial_boundary_calls
            radial_boundary_calls = 0
            parallel_count = 512
            parallel_segments = [
                {
                    "start": ("parallel-start", index),
                    "end": ("parallel-end", index),
                    "start_uv": (0.0, index * 0.0005),
                    "end_uv": (1.0, 0.5 + index * 0.0005),
                    "min_x": 0.0,
                    "max_x": 1.0,
                    "min_y": index * 0.0005,
                    "max_y": 0.5 + index * 0.0005,
                }
                for index in range(parallel_count)
            ]
            parallel_simple = bakelib._boundary_segments_are_simple(parallel_segments)
            parallel_boundary_calls = radial_boundary_calls
        finally:
            bakelib._triangle_intersection_area = original_triangle_clip
            bakelib._boundary_segments_conflict = original_boundary_conflict
        expect(not radial_issues,
               f"valid dense radial fan was falsely rejected: {radial_issues}")
        expect(radial_clip_calls < radial_spokes * 64,
               f"dense radial fan used {radial_clip_calls} exact triangle clips; "
               "the self-overlap broad phase regressed toward a pair scan")
        expect(radial_boundary_total < radial_spokes * 12,
               f"dense radial fan used {radial_boundary_total} boundary comparisons; "
               "the balanced event sweep regressed")
        expect(parallel_simple,
               "non-intersecting parallel boundary stress set was rejected")
        expect(parallel_boundary_calls < parallel_count * 12,
               f"parallel boundary stress used {parallel_boundary_calls} comparisons; "
               "active boundary lookup regressed toward a pair scan")
        island_count = 512
        synthetic_islands = [
            {
                "owner": (f"Synthetic Island {index:04d}", 1),
                "ordinal": index,
                "min_x": 0.0,
                "max_x": 1.0,
                "min_y": index * 0.0015,
                "max_y": index * 0.0015 + 0.0002,
            }
            for index in range(island_count)
        ]
        island_bounds_checks = 0
        original_island_bounds_near = bakelib._island_bounds_near

        def counted_island_bounds_near(left, right, padding):
            nonlocal island_bounds_checks
            island_bounds_checks += 1
            return original_island_bounds_near(left, right, padding)

        bakelib._island_bounds_near = counted_island_bounds_near
        try:
            synthetic_hierarchy = bakelib._island_bvh(synthetic_islands)
            synthetic_candidates = sum(
                len(bakelib._island_bvh_candidates(
                    synthetic_hierarchy, island, 0.0003,
                ))
                for island in synthetic_islands
            )
        finally:
            bakelib._island_bounds_near = original_island_bounds_near
        expect(synthetic_candidates == 0,
               f"wide separated island stress produced {synthetic_candidates} candidates")
        expect(island_bounds_checks < island_count * 40,
               f"wide separated island stress used {island_bounds_checks} bounds checks; "
               "the outer broad phase regressed toward a pair scan")
        print(
            "BLENDLINK_PINNED_SWEEP_COUNTS "
            f"triangles={radial_clip_calls}/{radial_spokes} "
            f"radialBoundary={radial_boundary_total}/{radial_spokes} "
            f"parallelBoundary={parallel_boundary_calls}/{parallel_count} "
            f"islandBounds={island_bounds_checks}/{island_count}"
        )
        radial_fan.hide_render = True
        wrapped_issues = bakelib.pinned_uv_layout_issues(
            [wrapped_winding], bakelib.AUTHORED_UV, minimum_gutter=0.05,
        )
        expect(any(item["kind"] == "self-overlap" for item in wrapped_issues),
               "consistent-orientation double-wrapped disk bypassed self-overlap validation: "
               f"{wrapped_issues}")
        wrapped_winding.hide_render = True

        invalid_bake = {"size": 256, "margin": 4, "samples": 1}
        invalid_plan = exporter.compute_bake_plan({"bake": invalid_bake})
        expect(any("overlaps itself" in item for item in invalid_plan["errors"]),
               f"plan did not block a folded pinned island: {invalid_plan['errors']}")
        expect(any("collapsed zero-area" in item for item in invalid_plan["errors"]),
               f"plan did not block a collapsed pinned island: {invalid_plan['errors']}")
        expect(any("overlap between" in item for item in invalid_plan["errors"]),
               f"plan did not block pinned island overlap: {invalid_plan['errors']}")
        expect(any("outside 0..1" in item for item in invalid_plan["errors"]),
               f"plan did not block out-of-bounds pins: {invalid_plan['errors']}")
        expect(any("edge gutter" in item for item in invalid_plan["errors"]),
               f"plan did not block missing pinned edge padding: {invalid_plan['errors']}")
        expect(any("padding contract requires" in item for item in invalid_plan["errors"]),
               f"plan did not block missing inter-island padding: {invalid_plan['errors']}")
        try:
            exporter.run_baked_mode(
                {"bake": invalid_bake},
                str(Path(tempfile.gettempdir()) / "blendlink-invalid-pins.glb"),
            )
        except RuntimeError as error:
            expect("Atlas layout validation blocked before baking" in str(error),
                   f"final bake failed for the wrong reason: {error}")
        else:
            raise AssertionError("final bake did not block invalid pinned atlas UVs")
    finally:
        for obj in pinned_fixtures:
            if obj.name in bpy.data.objects:
                bpy.data.objects.remove(obj, do_unlink=True)
        for mesh in list(bpy.data.meshes):
            if mesh.name.startswith("__Blendlink Pinned") and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for obj, hidden in saved_mesh_visibility:
            if obj.name in bpy.data.objects:
                obj.hide_render = hidden

    collapsed_mesh = bpy.data.meshes.new("__Blendlink Collapsed Coverage Mesh")
    collapsed_mesh.from_pydata(
        [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        [],
        [(0, 1, 2)],
    )
    collapsed_uv = collapsed_mesh.uv_layers.new(name=exporter.ATLAS_UV)
    # Nonzero but below one 128px output texel: this mirrors Blender's real
    # failed pack, which shrank the dogfood islands to ~1e-10 UV area rather
    # than producing exact mathematical zeroes.
    for loop, coordinate in zip(
        collapsed_uv.data,
        ((0.0, 0.0), (1.0 / 256.0, 0.0), (0.0, 1.0 / 64.0)),
    ):
        loop.uv = coordinate
    collapsed_object = bpy.data.objects.new(
        "__Blendlink Collapsed Coverage", collapsed_mesh,
    )
    try:
        coverage_errors = exporter.packed_atlas_coverage_errors({
            "main": {
                "objects": [collapsed_object],
                "size": 128,
                "margin": 12,
            },
        })
        collapsed_area = bakelib.packed_uv_area(collapsed_object)
        expect(collapsed_area > 0.0 and collapsed_area * 128 * 128 < 1.0,
               f"near-zero coverage fixture did not model a sub-texel pack: {collapsed_area}")
        expect(len(coverage_errors) == 1
               and "below one output texel" in coverage_errors[0]
               and "refused to publish an empty atlas" in coverage_errors[0],
               f"sub-texel populated atlas was not blocked loudly: {coverage_errors}")
    finally:
        bpy.data.objects.remove(collapsed_object)
        bpy.data.meshes.remove(collapsed_mesh)

    state_collection = bpy.data.collections.new("State Geometry")
    bpy.context.scene.collection.children.link(state_collection)
    saved_visibility = exporter.hide_collections([state_collection.name])
    expect(state_collection.hide_render, "state collection was not hidden")
    exporter.restore_collections(saved_visibility)
    expect(not state_collection.hide_render, "state collection visibility was not restored")
    visible_state_collection = bpy.data.collections.new("Visible State Geometry")
    bpy.context.scene.collection.children.link(visible_state_collection)
    multi_linked = make_cube("Multi Linked State Mesh")
    for collection in list(multi_linked.users_collection):
        collection.objects.unlink(multi_linked)
    state_collection.objects.link(multi_linked)
    visible_state_collection.objects.link(multi_linked)
    multi_saved = exporter.hide_collections([state_collection.name])
    expect(exporter.weblights.render_visibility(
               multi_linked, bpy.context.scene,
               view_layer=bpy.context.view_layer,
           ).exported,
           "one hidden collection path incorrectly hid a multi-linked visible mesh")
    exporter.restore_collections(multi_saved)
    bpy.data.objects.remove(multi_linked, do_unlink=True)
    render_hidden_state = make_cube("Render Hidden State Mesh")
    for collection in list(render_hidden_state.users_collection):
        collection.objects.unlink(render_hidden_state)
    state_collection.objects.link(render_hidden_state)
    render_hidden_state["blendlink_id"] = "render-hidden-state-id"
    render_hidden_state.hide_render = True
    expect(exporter.state_visibility([state_collection.name]) == {
        "hiddenObjectIds": [], "hiddenObjectNames": [],
    }, "state visibility published an object excluded by render visibility")
    bpy.data.objects.remove(render_hidden_state, do_unlink=True)
    state_parent = make_cube("State Parent Mesh")
    for collection in list(state_parent.users_collection):
        collection.objects.unlink(state_parent)
    state_collection.objects.link(state_parent)
    state_parent["blendlink_id"] = "state-parent-id"
    state_child = make_cube("Visible State Child")
    for collection in list(state_child.users_collection):
        collection.objects.unlink(state_child)
    visible_state_collection.objects.link(state_child)
    state_child.parent = state_parent
    state_child["blendlink_id"] = "state-child-id"
    try:
        exporter.state_visibility([state_collection.name])
    except RuntimeError as error:
        expect("visible exported descendants" in str(error), str(error))
    else:
        raise AssertionError("cross-collection parent visibility was silently made inexact")
    export_only_collection = bpy.data.collections.new("State Export Scope")
    bpy.context.scene.collection.children.link(export_only_collection)
    scoped = exporter.state_visibility(
        [state_collection.name], export_only_collection.name,
    )
    expect(scoped == {"hiddenObjectIds": [], "hiddenObjectNames": []},
           f"state visibility leaked outside the configured export collection: {scoped}")
    state_parent.parent = None
    bpy.data.objects.remove(state_parent, do_unlink=True)
    bpy.data.objects.remove(state_child, do_unlink=True)
    for invalid_names, label in [
        (["Missing State Collection"], "missing"),
        ([state_collection.name, state_collection.name], "duplicate"),
    ]:
        try:
            exporter.hide_collections(invalid_names)
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"{label} state collection was silently accepted")
    expect(not state_collection.hide_render,
           "failed state validation partially mutated collection visibility")
    foreign_state_scene = bpy.data.scenes.new("Foreign State Scene")
    foreign_state_collection = bpy.data.collections.new("Foreign State Collection")
    foreign_state_scene.collection.children.link(foreign_state_collection)
    expect(props.scene_collection_by_name(
        bpy.context.scene, foreign_state_collection.name,
    ) is None, "scene collection resolver accepted an off-scene collection")
    for operation in (
        lambda: exporter.hide_collections([foreign_state_collection.name]),
        lambda: exporter.state_visibility([foreign_state_collection.name]),
    ):
        try:
            operation()
        except RuntimeError:
            pass
        else:
            raise AssertionError("off-scene Lighting State collection was silently accepted")
    bpy.data.scenes.remove(foreign_state_scene)
    bpy.data.collections.remove(foreign_state_collection)
    excluded_parent = bpy.data.objects.new("Website Helper", None)
    excluded_parent["blendlink_role"] = "noimp"
    bpy.context.scene.collection.objects.link(excluded_parent)
    excluded_child = bpy.data.objects.new("Website Helper Child", None)
    bpy.context.scene.collection.objects.link(excluded_child)
    excluded_child.parent = excluded_parent
    excluded_set = exporter.noimp_objects()
    expect(excluded_parent in excluded_set and excluded_child in excluded_set,
           "web export exclusion did not include descendants")
    removed_noimp = exporter.remove_noimp_objects()
    expect({"Website Helper", "Website Helper Child"}.issubset(removed_noimp)
           and bpy.data.objects.get("Website Helper") is None
           and bpy.data.objects.get("Website Helper Child") is None,
           f"web export exclusion did not remove children first: {removed_noimp}")

    density_fixture = [
        {"name": "Main A", "atlas": "main", "screenDensity": 100.0,
         "pxPerMeter": 40.0},
        {"name": "Main B", "atlas": "main", "screenDensity": 100.0,
         "pxPerMeter": 40.0},
        {"name": "Main Hog", "atlas": "main", "screenDensity": 500.0,
         "pxPerMeter": 200.0},
        {"name": "Background Alone", "atlas": "background", "screenDensity": 900.0,
         "pxPerMeter": 360.0},
    ]
    camera_density_warnings = exporter.density_balance_warnings(
        density_fixture, has_camera=True,
    )
    expect(len(camera_density_warnings) == 1
           and "Main Hog" in camera_density_warnings[0]
           and "atlas 'main'" in camera_density_warnings[0]
           and all("Background Alone" not in item for item in camera_density_warnings),
           f"density advice compared independent atlas budgets: {camera_density_warnings}")
    texel_density_warnings = exporter.density_balance_warnings(
        density_fixture, has_camera=False,
    )
    expect(len(texel_density_warnings) == 1
           and "texel density" in texel_density_warnings[0],
           f"camera-free density advice used the wrong metric label: {texel_density_warnings}")
    expect(exporter.rgba8_mip_chain_bytes(4) == (4 * 4 + 2 * 2 + 1) * 4,
           "atlas GPU estimate omitted or double-counted a mip level")
    evidence_camera_data = bpy.data.cameras.new("Composition Evidence Camera")
    evidence_camera_data.type = "PERSP"
    evidence_camera_data.angle = math.pi / 2
    evidence_camera = bpy.data.objects.new(
        "Composition Evidence Camera", evidence_camera_data,
    )
    evidence_camera["blendlink_id"] = "composition-evidence-camera"
    bpy.context.scene.collection.objects.link(evidence_camera)
    evidence_object = make_cube("Composition Evidence Object")
    evidence_object.location = (0, 0, -2)
    bpy.context.view_layer.update()
    evidence = exporter.composition_texel_evidence(
        evidence_object,
        900.0,
        {"camera": {
            "objectId": "composition-evidence-camera",
            "objectName": evidence_camera.name,
            "compositions": [
                {"name": "Small", "width": 400, "height": 400},
                {"name": "Large", "width": 900, "height": 900},
            ],
        }},
    )
    expected_ratio = 900.0 / (
        900.0 / (4.0 * math.tan(evidence_camera_data.angle_y / 2.0))
    )
    expect(evidence is not None
           and evidence["composition"] == "Large"
           and abs(evidence["atlasTexelsPerCssPixelAt1x"] - expected_ratio) < 0.002
           and abs(evidence["atlasTexelsPerDevicePixelAt2x"] - expected_ratio / 2) < 0.002,
           f"composition-aware atlas evidence was not projection-derived: {evidence}")
    bpy.data.objects.remove(evidence_object, do_unlink=True)
    bpy.data.objects.remove(evidence_camera, do_unlink=True)
    bpy.data.cameras.remove(evidence_camera_data)

    animated_mesh = make_cube("Animated Bake Safety")
    animated_mesh.location.x = 0
    animated_mesh.keyframe_insert(data_path="location", frame=1)
    animated_mesh.location.x = 1
    animated_mesh.keyframe_insert(data_path="location", frame=2)
    expect("animated" in exporter.dynamic_reason(animated_mesh),
           "automatic baked/realtime safety ignored transform animation")
    nla_mesh = make_cube("NLA Bake Safety")
    nla_mesh.location.x = 0
    nla_mesh.keyframe_insert(data_path="location", frame=1)
    nla_mesh.location.x = 1
    nla_mesh.keyframe_insert(data_path="location", frame=2)
    nla_animation = nla_mesh.animation_data
    nla_action = nla_animation.action
    nla_track = nla_animation.nla_tracks.new()
    nla_track.name = "Website motion"
    nla_track.strips.new(nla_action.name, 1, nla_action)
    nla_animation.action = None
    expect("animated" in exporter.dynamic_reason(nla_mesh),
           "automatic baked/realtime safety ignored NLA-only transform animation")
    shape_mesh = make_cube("Shape Bake Safety")
    shape_mesh.shape_key_add(name="Basis")
    shape_mesh.shape_key_add(name="Smile")
    expect("shape-key" in exporter.dynamic_reason(shape_mesh),
           "automatic baked/realtime safety ignored morph targets")
    deform_mesh = make_cube("Modifier Bake Safety")
    deform_mesh.modifiers.new("Website Bend", "SIMPLE_DEFORM")
    expect("simple deform" in exporter.dynamic_reason(deform_mesh),
           "automatic baked/realtime safety ignored a non-armature deformer")
    cutout_mesh = make_cube("Cutout Bake Safety")
    cutout_material = bpy.data.materials.new("Linked Alpha Cutout")
    bakelib.ensure_shader_node_tree(cutout_material)
    cutout_principled = cutout_material.node_tree.nodes.get("Principled BSDF")
    cutout_alpha = cutout_material.node_tree.nodes.new("ShaderNodeValue")
    cutout_material.node_tree.links.new(
        cutout_alpha.outputs[0], cutout_principled.inputs["Alpha"],
    )
    cutout_mesh.data.materials.append(cutout_material)
    expect("alpha is linked" in exporter.dynamic_reason(cutout_mesh),
           "automatic baked/realtime safety ignored linked alpha/cutout material")

    # --- material portability: truthful stock glTF/Principled guidance ---
    portable_material = bpy.data.materials.new("Portable Principled")
    bakelib.ensure_shader_node_tree(portable_material)
    portable_principled = portable_material.node_tree.nodes.get("Principled BSDF")
    portable_result = procedural_module.analyze_material(portable_material)
    expect(portable_result["status"] == "exact",
           f"direct Principled material was not reported as exact glTF: {portable_result}")
    expect(procedural_module._gltf_exporter_version() == (5, 2, 39),
           "material compatibility fixtures require pinned glTF exporter 5.2.39")
    unverified_exporter_versions = ((4, 2, 0), (5, 2, 40), None)
    expect(portable_result["cyclesAppearance"] == {
        "status": "compatible",
        "blockers": [],
    }, f"direct Principled material was not reported as Cycles-compatible: {portable_result}")

    shader_to_rgb_material = bpy.data.materials.new("EEVEE Shader to RGB")
    bakelib.ensure_shader_node_tree(shader_to_rgb_material)
    shader_to_rgb_nodes = shader_to_rgb_material.node_tree.nodes
    shader_to_rgb_links = shader_to_rgb_material.node_tree.links
    shader_to_rgb_principled = shader_to_rgb_nodes.get("Principled BSDF")
    shader_to_rgb_output = shader_to_rgb_nodes.get("Material Output")
    shader_to_rgb = shader_to_rgb_nodes.new("ShaderNodeShaderToRGB")
    shader_to_rgb_emission = shader_to_rgb_nodes.new("ShaderNodeEmission")
    shader_to_rgb_links.remove(shader_to_rgb_output.inputs["Surface"].links[0])
    shader_to_rgb_links.new(shader_to_rgb_principled.outputs[0], shader_to_rgb.inputs["Shader"])
    shader_to_rgb_links.new(shader_to_rgb.outputs["Color"], shader_to_rgb_emission.inputs["Color"])
    shader_to_rgb_links.new(shader_to_rgb_emission.outputs[0], shader_to_rgb_output.inputs["Surface"])
    shader_to_rgb_result = procedural_module.analyze_material(shader_to_rgb_material)
    expect(shader_to_rgb_result["status"] == "needsBake",
           f"Shader to RGB graph was silently presented as portable: {shader_to_rgb_result}")
    expect(shader_to_rgb_result["cyclesAppearance"]["status"] == "blocked"
           and any("Shader to RGB" in blocker
                   and "EEVEE-only" in blocker
                   and "Cycles Appearance" in blocker
                   for blocker in shader_to_rgb_result["cyclesAppearance"]["blockers"]),
           f"Shader to RGB graph did not explain its Cycles bake blocker: {shader_to_rgb_result}")

    def portable_input(name):
        return next((
            socket for socket in portable_principled.inputs
            if socket.name == name or socket.identifier == name
        ), None)

    portable_material.node_tree.nodes.new("ShaderNodeTexNoise")
    scratch_result = procedural_module.analyze_material(portable_material)
    expect(scratch_result["status"] == "exact",
           "an unconnected scratch node incorrectly lowered material compatibility")
    # Blender 5.2 exposes Weight in the socket sequence but omits the disabled
    # socket from NodeInputs.get(), so find it by stable display/identifier.
    principled_weight = portable_input("Weight")
    if principled_weight is not None:
        expect(procedural_module.analyze_material(portable_material)["status"] == "exact",
               "the default Principled Weight produced a false portability warning")
        principled_weight.default_value = 0.5
        weight_result = procedural_module.analyze_material(portable_material)
        expect(weight_result["status"] == "approximated"
               and any("Weight" in reason for reason in weight_result["reasons"]),
               f"non-serialized Principled Weight was reported as exact: {weight_result}")
        principled_weight.default_value = 0.0
    thin_wall = portable_principled.inputs.get("Thin Wall")
    if thin_wall is not None:
        expect(procedural_module.analyze_material(portable_material)["status"] == "exact",
               "the default Principled Thin Wall produced a false portability warning")
        thin_wall.default_value = True
        thin_wall_result = procedural_module.analyze_material(portable_material)
        expect(thin_wall_result["status"] == "approximated"
               and any("Thin Wall" in reason for reason in thin_wall_result["reasons"]),
               f"non-serialized Principled Thin Wall was reported as exact: {thin_wall_result}")
        thin_wall.default_value = False
    for socket_name in ("Normal", "Coat Normal"):
        socket = portable_input(socket_name)
        if socket is None:
            continue
        original_value = tuple(socket.default_value)
        socket.default_value = (0.0, 0.0, 1.0)
        vector_result = procedural_module.analyze_material(portable_material)
        expect(vector_result["status"] == "approximated"
               and any(socket_name in reason for reason in vector_result["reasons"]),
               f"constant Principled {socket_name} vector was reported as exact: {vector_result}")
        socket.default_value = original_value
    subsurface = portable_principled.inputs.get("Subsurface Weight")
    if subsurface is not None:
        subsurface.default_value = 0.25
        approximation = procedural_module.analyze_material(portable_material)
        expect(approximation["status"] == "approximated"
               and any("Subsurface" in reason for reason in approximation["reasons"]),
               f"omitted Principled detail was not named as an approximation: {approximation}")
        subsurface.default_value = 0.0
    for socket_name, authored_value in (
        ("Subsurface Radius", (0.8, 0.4, 0.2)),
        ("Subsurface Scale", 0.02),
        ("Subsurface IOR", 1.2),
        ("Subsurface Anisotropy", 0.4),
        ("Diffuse Roughness", 0.35),
        ("Coat IOR", 1.2),
        ("Coat Tint", (0.7, 0.8, 0.9, 1.0)),
    ):
        socket = portable_input(socket_name)
        if socket is None:
            continue
        original_value = tuple(socket.default_value) if hasattr(
            socket.default_value, "__iter__"
        ) else socket.default_value
        socket.default_value = authored_value
        omission = procedural_module.analyze_material(portable_material)
        expect(omission["status"] == "approximated"
               and any(socket_name in reason for reason in omission["reasons"]),
               f"non-serialized Principled {socket_name} was reported as exact: {omission}")
        socket.default_value = original_value

    sheen_weight = portable_input("Sheen Weight")
    if sheen_weight is not None:
        original_sheen_weight = sheen_weight.default_value
        sheen_weight.default_value = 0.0
        expect(procedural_module.analyze_material(portable_material)["status"] == "exact",
               "disabled unlinked Sheen Weight was not recognized as exact")
        sheen_weight.default_value = 1.0
        full_sheen = procedural_module.analyze_material(portable_material)
        expect(full_sheen["status"] == "exact",
               f"full unlinked Sheen Weight was not recognized as exact: {full_sheen}")
        original_exporter_version_probe = procedural_module._gltf_exporter_version
        try:
            for unverified_version in unverified_exporter_versions:
                procedural_module._gltf_exporter_version = (
                    lambda version=unverified_version: version
                )
                unverified_sheen = procedural_module.analyze_material(portable_material)
                expect(unverified_sheen["status"] == "approximated"
                       and any("verified only" in reason and "5.2.39" in reason
                               for reason in unverified_sheen["reasons"]),
                       f"unverified exporter {unverified_version} silently inherited "
                       f"the Sheen Weight relaxation: {unverified_sheen}")
        finally:
            procedural_module._gltf_exporter_version = original_exporter_version_probe
        sheen_weight.default_value = 0.5
        partial_sheen = procedural_module.analyze_material(portable_material)
        expect(partial_sheen["status"] == "approximated"
               and any("full KHR_materials_sheen" in reason
                       for reason in partial_sheen["reasons"]),
               f"partial Sheen Weight did not name Blender's enable-gate loss: {partial_sheen}")
        sheen_driver = portable_material.node_tree.nodes.new("ShaderNodeValue")
        portable_material.node_tree.links.new(sheen_driver.outputs[0], sheen_weight)
        linked_sheen = procedural_module.analyze_material(portable_material)
        expect(linked_sheen["status"] == "needsBake"
               and any("Sheen Weight is linked" in reason
                       for reason in linked_sheen["reasons"]),
               f"linked Sheen Weight was presented as portable: {linked_sheen}")
        portable_material.node_tree.nodes.remove(sheen_driver)
        sheen_weight.default_value = original_sheen_weight

    thin_film_thickness = portable_input("Thin Film Thickness")
    thin_film_ior = portable_input("Thin Film IOR")
    iridescence_group = None
    if thin_film_thickness is not None and thin_film_ior is not None:
        original_thickness = thin_film_thickness.default_value
        original_thin_film_ior = thin_film_ior.default_value
        thin_film_thickness.default_value = 460.0
        thin_film_ior.default_value = 1.42
        unpaired_thin_film = procedural_module.analyze_material(portable_material)
        expect(unpaired_thin_film["status"] == "approximated"
               and any("glTF Material Output" in reason
                       for reason in unpaired_thin_film["reasons"]),
               f"unpaired Thin Film inputs were reported as exact: {unpaired_thin_film}")

        iridescence_tree = bpy.data.node_groups.new(
            "glTF Material Output Blendlink Test", "ShaderNodeTree",
        )
        iridescence_tree.interface.new_socket(
            name="Iridescence Factor",
            in_out="INPUT",
            socket_type="NodeSocketFloat",
        )
        iridescence_tree.interface.new_socket(
            name="Iridescence Thickness Minimum",
            in_out="INPUT",
            socket_type="NodeSocketFloat",
        )
        iridescence_group = portable_material.node_tree.nodes.new("ShaderNodeGroup")
        iridescence_group.node_tree = iridescence_tree
        iridescence_group.inputs["Iridescence Factor"].default_value = 0.64
        iridescence_group.inputs["Iridescence Thickness Minimum"].default_value = 120.0
        paired_thin_film = procedural_module.analyze_material(portable_material)
        expect(paired_thin_film["status"] == "exact",
               f"paired constant glTF iridescence was not recognized: {paired_thin_film}")
        original_exporter_version_probe = procedural_module._gltf_exporter_version
        try:
            for unverified_version in unverified_exporter_versions:
                procedural_module._gltf_exporter_version = (
                    lambda version=unverified_version: version
                )
                unverified_thin_film = procedural_module.analyze_material(portable_material)
                expect(unverified_thin_film["status"] == "approximated"
                       and any("verified only" in reason and "5.2.39" in reason
                               for reason in unverified_thin_film["reasons"]),
                       f"unverified exporter {unverified_version} silently inherited "
                       f"the thin-film relaxation: {unverified_thin_film}")
        finally:
            procedural_module._gltf_exporter_version = original_exporter_version_probe
        iridescence_tree.name = "Artist Iridescence Controls"
        noncanonical_iridescence = procedural_module.analyze_material(portable_material)
        expect(noncanonical_iridescence["status"] == "approximated",
               "an arbitrary unconnected group was mistaken for glTF Material Output")
        iridescence_tree.name = "glTF Material Output Blendlink Test"
        iridescence_group.inputs["Iridescence Factor"].default_value = 0.0
        disabled_iridescence = procedural_module.analyze_material(portable_material)
        expect(disabled_iridescence["status"] == "approximated",
               f"disabled glTF iridescence incorrectly made Thin Film exact: {disabled_iridescence}")
        iridescence_group.inputs["Iridescence Factor"].default_value = 0.64
        thin_film_driver = portable_material.node_tree.nodes.new("ShaderNodeValue")
        portable_material.node_tree.links.new(
            thin_film_driver.outputs[0], thin_film_thickness,
        )
        linked_thin_film = procedural_module.analyze_material(portable_material)
        expect(linked_thin_film["status"] == "needsBake"
               and any("constant glTF iridescence mapping" in reason
                       for reason in linked_thin_film["reasons"]),
               f"unverified linked Thin Film mapping was presented as exact: {linked_thin_film}")
        portable_material.node_tree.nodes.remove(thin_film_driver)
        portable_material.node_tree.nodes.remove(iridescence_group)
        iridescence_group = None
        bpy.data.node_groups.remove(iridescence_tree)
        thin_film_thickness.default_value = original_thickness
        thin_film_ior.default_value = original_thin_film_ior

    noise = next(node for node in portable_material.node_tree.nodes
                 if node.bl_idname == "ShaderNodeTexNoise")
    ramp = portable_material.node_tree.nodes.new("ShaderNodeValToRGB")
    portable_material.node_tree.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    portable_material.node_tree.links.new(ramp.outputs["Color"], portable_principled.inputs["Base Color"])
    procedural_result = procedural_module.analyze_material(portable_material)
    expect(procedural_result["status"] == "needsBake"
           and any("Color Ramp" in reason or "Noise" in reason
                   for reason in procedural_result["reasons"]),
           f"procedural Base Color was not reported as needing a bake: {procedural_result}")

    # Blendlink's fixed-camera capture primitive authors the same narrow
    # camera-ray/unlit grammar recognized by Blender glTF 5.2.39. The
    # diagnostic must accept that exact generated graph without blessing
    # arbitrary Mix Shader, Light Path, transparency, or emission graphs.
    fixed_card_image = bpy.data.images.new(
        "Fixed Camera Card RGBA", width=2, height=2, alpha=True,
    )
    fixed_card_material = bakelib._fixed_camera_card_material(
        "Fixed Camera Card Material", fixed_card_image,
    )
    fixed_tree = fixed_card_material.node_tree
    fixed_output = next(
        node for node in fixed_tree.nodes
        if node.type == "OUTPUT_MATERIAL" and node.is_active_output
    )
    outer_mix = fixed_output.inputs["Surface"].links[0].from_node
    inner_mix = outer_mix.inputs[2].links[0].from_node
    transparent = outer_mix.inputs[1].links[0].from_node
    emission = inner_mix.inputs[2].links[0].from_node
    light_path = inner_mix.inputs[0].links[0].from_node
    image_texture = outer_mix.inputs[0].links[0].from_node

    def replace_fixed_link(from_socket, to_socket):
        for old_link in list(to_socket.links):
            fixed_tree.links.remove(old_link)
        fixed_tree.links.new(from_socket, to_socket)

    fixed_card_result = procedural_module.analyze_material(fixed_card_material)
    expect(fixed_card_result["status"] == "approximated"
           and any("KHR_materials_unlit" in reason
                   and "per-ray" in reason
                   for reason in fixed_card_result["reasons"]),
           f"canonical fixed-camera unlit card was not accepted truthfully: {fixed_card_result}")

    original_exporter_version_probe = procedural_module._gltf_exporter_version
    try:
        for unverified_version in unverified_exporter_versions:
            procedural_module._gltf_exporter_version = (
                lambda version=unverified_version: version
            )
            unverified_fixed_card = procedural_module.analyze_material(
                fixed_card_material,
            )
            expect(unverified_fixed_card["status"] == "needsBake"
                   and any("camera-ray unlit" in reason
                           and "verified only" in reason
                           and "5.2.39" in reason
                           for reason in unverified_fixed_card["reasons"]),
                   f"unverified exporter {unverified_version} silently inherited "
                   f"the fixed-camera unlit relaxation: {unverified_fixed_card}")
    finally:
        procedural_module._gltf_exporter_version = original_exporter_version_probe

    replace_fixed_link(light_path.outputs["Is Shadow Ray"], inner_mix.inputs[0])
    shadow_ray_result = procedural_module.analyze_material(fixed_card_material)
    expect(shadow_ray_result["status"] == "needsBake",
           f"Is Shadow Ray was mistaken for the camera-ray unlit grammar: {shadow_ray_result}")
    replace_fixed_link(light_path.outputs["Is Camera Ray"], inner_mix.inputs[0])

    replace_fixed_link(emission.outputs[0], inner_mix.inputs[1])
    replace_fixed_link(transparent.outputs[0], inner_mix.inputs[2])
    reversed_inner_result = procedural_module.analyze_material(fixed_card_material)
    expect(reversed_inner_result["status"] == "needsBake",
           f"reversed camera-ray branches were presented as portable: {reversed_inner_result}")
    replace_fixed_link(transparent.outputs[0], inner_mix.inputs[1])
    replace_fixed_link(emission.outputs[0], inner_mix.inputs[2])

    replace_fixed_link(inner_mix.outputs[0], outer_mix.inputs[1])
    replace_fixed_link(transparent.outputs[0], outer_mix.inputs[2])
    reversed_outer_result = procedural_module.analyze_material(fixed_card_material)
    expect(reversed_outer_result["status"] == "needsBake",
           f"reversed alpha branches were presented as portable: {reversed_outer_result}")
    replace_fixed_link(transparent.outputs[0], outer_mix.inputs[1])
    replace_fixed_link(inner_mix.outputs[0], outer_mix.inputs[2])

    emission.inputs["Strength"].default_value = 2.0
    bright_emission_result = procedural_module.analyze_material(fixed_card_material)
    expect(bright_emission_result["status"] == "needsBake",
           f"discarded unlit Emission strength was presented as portable: {bright_emission_result}")
    emission.inputs["Strength"].default_value = 1.0

    second_image = bpy.data.images.new(
        "Separate Fixed Card Alpha", width=2, height=2, alpha=True,
    )
    second_texture = fixed_tree.nodes.new("ShaderNodeTexImage")
    second_texture.image = second_image
    replace_fixed_link(second_texture.outputs["Alpha"], outer_mix.inputs[0])
    separate_alpha_result = procedural_module.analyze_material(fixed_card_material)
    expect(separate_alpha_result["status"] == "needsBake",
           f"separate unlit RGB/alpha images were presented as portable: {separate_alpha_result}")
    replace_fixed_link(image_texture.outputs["Alpha"], outer_mix.inputs[0])
    fixed_tree.nodes.remove(second_texture)
    bpy.data.images.remove(second_image)

    procedural_alpha = fixed_tree.nodes.new("ShaderNodeTexNoise")
    replace_fixed_link(procedural_alpha.outputs["Fac"], outer_mix.inputs[0])
    procedural_alpha_result = procedural_module.analyze_material(fixed_card_material)
    expect(procedural_alpha_result["status"] == "needsBake",
           f"procedural unlit alpha was presented as portable: {procedural_alpha_result}")
    replace_fixed_link(image_texture.outputs["Alpha"], outer_mix.inputs[0])
    fixed_tree.nodes.remove(procedural_alpha)

    volume = fixed_tree.nodes.new("ShaderNodeEmission")
    fixed_tree.links.new(volume.outputs[0], fixed_output.inputs["Volume"])
    linked_volume_result = procedural_module.analyze_material(fixed_card_material)
    expect(linked_volume_result["status"] == "needsBake",
           f"linked Volume was hidden by the unlit Surface recognizer: {linked_volume_result}")
    fixed_tree.links.remove(fixed_output.inputs["Volume"].links[0])
    fixed_tree.nodes.remove(volume)

    fixed_camera = bpy.data.cameras.new("Fixed Card Camera Data")
    fixed_camera_object = bpy.data.objects.new("Fixed Card Camera", fixed_camera)
    bpy.context.scene.collection.objects.link(fixed_camera_object)
    bpy.context.scene.camera = fixed_camera_object
    fixed_camera_object.location.z = 5.0
    fixed_card_source = make_cube("Fixed Card Source")
    fixed_card = bakelib._fixed_camera_card_mesh(
        bpy.context.scene,
        fixed_card_source,
        fixed_card_image,
        fixed_card_material,
        (0, 0, 2, 2),
        2,
        2,
        "Fixed Camera Card Mesh",
        "Fixed Camera Card",
    )
    expect(fixed_card.visible_shadow is False
           and fixed_card.get("blendlink_cast_shadow") is False,
           "generated fixed-camera card did not carry its no-shadow intent")
    fixed_card_image.pixels.foreach_set([
        1.0, 0.0, 0.0, 1.0,
        0.0, 1.0, 0.0, 0.5,
        0.0, 0.0, 1.0, 0.25,
        1.0, 1.0, 1.0, 0.0,
    ])
    fixed_card_image.update()
    select_only(fixed_card)
    with tempfile.TemporaryDirectory(prefix="blendlink-fixed-card-unlit-") as tmp:
        source_png = Path(tmp) / "fixed-card.png"
        fixed_card_image.filepath_raw = str(source_png)
        fixed_card_image.file_format = "PNG"
        fixed_card_image.save()
        source_png_bytes = source_png.read_bytes()
        fixed_card_image.pack()
        output_glb = Path(tmp) / "fixed-card.glb"
        fixed_card_kwargs, _fixed_card_dropped = exporter.gltf_export_contract(
            str(output_glb), {
                "imageFormat": "AUTO",
                "exporterOverrides": {"use_selection": True},
            },
        )
        fixed_card_export = bpy.ops.export_scene.gltf(**fixed_card_kwargs)
        expect("FINISHED" in fixed_card_export,
               f"stock fixed-camera card export failed: {fixed_card_export}")
        fixed_document, fixed_chunks, _fixed_json_index = exporter._read_glb_document(
            str(output_glb), "inspect fixed-camera unlit material",
        )
        expect(len(fixed_document.get("materials", [])) == 1,
               "fixed-camera card export did not contain exactly one material")
        fixed_material = fixed_document["materials"][0]
        expect("KHR_materials_unlit" in fixed_material.get("extensions", {})
               and fixed_material.get("alphaMode") == "BLEND"
               and fixed_material.get("doubleSided") is True,
               f"stock fixed-camera material lost unlit/alpha/sidedness: {fixed_material}")
        base_color_texture = fixed_material.get(
            "pbrMetallicRoughness", {},
        ).get("baseColorTexture", {})
        fixed_texture = fixed_document["textures"][base_color_texture["index"]]
        fixed_sampler = fixed_document["samplers"][fixed_texture["sampler"]]
        expect(fixed_sampler == {
            "magFilter": 9729,
            "minFilter": 9987,
            "wrapS": 33071,
            "wrapT": 33071,
        }, f"fixed-camera card sampler drifted: {fixed_sampler}")
        fixed_image = fixed_document["images"][fixed_texture["source"]]
        fixed_view = fixed_document["bufferViews"][fixed_image["bufferView"]]
        fixed_binary = exporter.glblib.binary_chunk(
            fixed_chunks, "inspect fixed-camera unlit image",
        )
        image_start = fixed_view.get("byteOffset", 0)
        image_end = image_start + fixed_view["byteLength"]
        exported_png_bytes = fixed_binary[image_start:image_end]
        expect(fixed_image.get("mimeType") == "image/png"
               and exported_png_bytes.startswith(b"\x89PNG\r\n\x1a\n")
               and hashlib.sha256(exported_png_bytes).digest()
               == hashlib.sha256(source_png_bytes).digest(),
               "fixed-camera card did not preserve the exact source PNG bytes")
        fixed_node = next(
            node for node in fixed_document["nodes"]
            if node.get("name") == fixed_card.name
        )
        expect(fixed_node.get("extras", {}).get("blendlink_cast_shadow") is False,
               "stock GLB lost the generated card's namespaced no-shadow intent")

    fixed_card_mesh = fixed_card.data
    bpy.data.objects.remove(fixed_card, do_unlink=True)
    bpy.data.meshes.remove(fixed_card_mesh)
    bpy.data.objects.remove(fixed_card_source, do_unlink=True)
    bpy.data.objects.remove(fixed_camera_object, do_unlink=True)
    bpy.data.cameras.remove(fixed_camera)
    bpy.data.materials.remove(fixed_card_material)
    bpy.data.images.remove(fixed_card_image)

    alpha_clip_material = bpy.data.materials.new("Portable Alpha Clip Grammar")
    bakelib.ensure_shader_node_tree(alpha_clip_material)
    alpha_nodes = alpha_clip_material.node_tree.nodes
    alpha_links = alpha_clip_material.node_tree.links
    alpha_principled = alpha_nodes.get("Principled BSDF")
    alpha_image_node = alpha_nodes.new("ShaderNodeTexImage")
    alpha_image = bpy.data.images.new("Portable Alpha Clip Pixel", width=1, height=1)
    alpha_image_node.image = alpha_image
    alpha_math_nodes = []

    def clear_alpha_math():
        for item in list(alpha_math_nodes):
            alpha_nodes.remove(item)
        alpha_math_nodes.clear()

    def alpha_math(operation):
        item = alpha_nodes.new("ShaderNodeMath")
        item.operation = operation
        alpha_math_nodes.append(item)
        return item

    direct_greater = alpha_math("GREATER_THAN")
    direct_greater.inputs[1].default_value = 0.42
    alpha_links.new(alpha_image_node.outputs["Alpha"], direct_greater.inputs[0])
    alpha_links.new(direct_greater.outputs[0], alpha_principled.inputs["Alpha"])
    direct_greater_result = procedural_module.analyze_material(alpha_clip_material)
    expect(direct_greater_result["status"] == "exact",
           f"Blender 5.2 direct GREATER_THAN alpha clip was blocked: {direct_greater_result}")
    original_exporter_version_probe = procedural_module._gltf_exporter_version
    try:
        for unverified_version in unverified_exporter_versions:
            procedural_module._gltf_exporter_version = (
                lambda version=unverified_version: version
            )
            unverified_alpha_clip = procedural_module.analyze_material(
                alpha_clip_material,
            )
            expect(unverified_alpha_clip["status"] == "needsBake"
                   and any("verified only" in reason and "5.2.39" in reason
                           for reason in unverified_alpha_clip["reasons"]),
                   f"unverified exporter {unverified_version} silently inherited "
                   f"the alpha-clip relaxation: {unverified_alpha_clip}")
    finally:
        procedural_module._gltf_exporter_version = original_exporter_version_probe

    clear_alpha_math()
    direct_less = alpha_math("LESS_THAN")
    direct_less.inputs[0].default_value = 0.42
    alpha_links.new(alpha_image_node.outputs["Alpha"], direct_less.inputs[1])
    alpha_links.new(direct_less.outputs[0], alpha_principled.inputs["Alpha"])
    direct_less_result = procedural_module.analyze_material(alpha_clip_material)
    expect(direct_less_result["status"] == "exact",
           f"Blender 5.2 direct LESS_THAN alpha clip was blocked: {direct_less_result}")

    clear_alpha_math()
    rounded = alpha_math("ROUND")
    alpha_links.new(alpha_image_node.outputs["Alpha"], rounded.inputs[0])
    alpha_links.new(rounded.outputs[0], alpha_principled.inputs["Alpha"])
    rounded_result = procedural_module.analyze_material(alpha_clip_material)
    expect(rounded_result["status"] == "exact",
           f"Blender 5.2 ROUND alpha clip was blocked: {rounded_result}")

    for comparator_operation, source_input, cutoff_input in (
        ("LESS_THAN", 0, 1),
        ("GREATER_THAN", 1, 0),
    ):
        clear_alpha_math()
        comparator = alpha_math(comparator_operation)
        comparator.inputs[cutoff_input].default_value = 0.42
        alpha_links.new(alpha_image_node.outputs["Alpha"], comparator.inputs[source_input])
        subtract = alpha_math("SUBTRACT")
        subtract.inputs[0].default_value = 1.0
        alpha_links.new(comparator.outputs[0], subtract.inputs[1])
        alpha_links.new(subtract.outputs[0], alpha_principled.inputs["Alpha"])
        subtract_result = procedural_module.analyze_material(alpha_clip_material)
        expect(subtract_result["status"] == "exact",
               f"Blender 5.2 {comparator_operation}/SUBTRACT alpha clip was blocked: "
               f"{subtract_result}")

    clear_alpha_math()
    multiply = alpha_math("MULTIPLY")
    alpha_links.new(alpha_image_node.outputs["Alpha"], multiply.inputs[0])
    alpha_links.new(multiply.outputs[0], alpha_principled.inputs["Alpha"])
    multiply_result = procedural_module.analyze_material(alpha_clip_material)
    expect(multiply_result["status"] == "needsBake"
           and any("Math" in reason or multiply.name in reason
                   for reason in multiply_result["reasons"]),
           f"arbitrary alpha Math was silently blessed: {multiply_result}")

    clear_alpha_math()
    reused_clip = alpha_math("GREATER_THAN")
    reused_clip.inputs[1].default_value = 0.42
    alpha_links.new(alpha_image_node.outputs["Alpha"], reused_clip.inputs[0])
    alpha_links.new(reused_clip.outputs[0], alpha_principled.inputs["Alpha"])
    alpha_links.new(reused_clip.outputs[0], alpha_principled.inputs["Roughness"])
    reused_result = procedural_module.analyze_material(alpha_clip_material)
    expect(reused_result["status"] == "needsBake",
           f"alpha clip Math reused as an ordinary PBR input was blessed: {reused_result}")

    clear_alpha_math()
    alpha_noise = alpha_nodes.new("ShaderNodeTexNoise")
    noise_clip = alpha_math("GREATER_THAN")
    noise_clip.inputs[1].default_value = 0.42
    alpha_links.new(alpha_noise.outputs["Fac"], noise_clip.inputs[0])
    alpha_links.new(noise_clip.outputs[0], alpha_principled.inputs["Alpha"])
    noise_clip_result = procedural_module.analyze_material(alpha_clip_material)
    expect(noise_clip_result["status"] == "needsBake"
           and any("Noise Texture" in reason for reason in noise_clip_result["reasons"]),
           f"recognized clip topology hid its unsupported Noise source: {noise_clip_result}")

    mixed_material = bpy.data.materials.new("Mixed Website Shaders")
    bakelib.ensure_shader_node_tree(mixed_material)
    mixed_nodes = mixed_material.node_tree.nodes
    mixed_links = mixed_material.node_tree.links
    mixed_output = mixed_nodes.get("Material Output")
    mixed_nodes.remove(mixed_nodes.get("Principled BSDF"))
    mixed_shader = mixed_nodes.new("ShaderNodeMixShader")
    mixed_links.new(mixed_nodes.new("ShaderNodeBsdfPrincipled").outputs[0], mixed_shader.inputs[1])
    mixed_links.new(mixed_nodes.new("ShaderNodeBsdfPrincipled").outputs[0], mixed_shader.inputs[2])
    mixed_links.new(mixed_shader.outputs[0], mixed_output.inputs["Surface"])
    mixed_result = procedural_module.analyze_material(mixed_material)
    expect(mixed_result["status"] == "needsBake"
           and any("Mix Shader" in reason for reason in mixed_result["reasons"]),
           f"mixed shaders were silently presented as portable: {mixed_result}")

    nested_principled_material = bpy.data.materials.new("Nested Portable Principled")
    bakelib.ensure_shader_node_tree(nested_principled_material)
    nested_principled_nodes = nested_principled_material.node_tree.nodes
    nested_principled_nodes.remove(nested_principled_nodes.get("Principled BSDF"))
    portable_tree = bpy.data.node_groups.new("Portable Principled Group", "ShaderNodeTree")
    portable_tree.interface.new_socket(
        name="Shader", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    portable_group_output = portable_tree.nodes.new("NodeGroupOutput")
    portable_group_principled = portable_tree.nodes.new("ShaderNodeBsdfPrincipled")
    portable_tree.links.new(
        portable_group_principled.outputs[0], portable_group_output.inputs["Shader"],
    )
    portable_group = nested_principled_nodes.new("ShaderNodeGroup")
    portable_group.node_tree = portable_tree
    nested_principled_material.node_tree.links.new(
        portable_group.outputs["Shader"],
        nested_principled_nodes.get("Material Output").inputs["Surface"],
    )
    nested_portable_result = procedural_module.analyze_material(nested_principled_material)
    expect(nested_portable_result["status"] == "exact",
           f"a direct nested Principled group was not recognized: {nested_portable_result}")

    normal_material = bpy.data.materials.new("Website Normal Map")
    bakelib.ensure_shader_node_tree(normal_material)
    normal_nodes = normal_material.node_tree.nodes
    normal_links = normal_material.node_tree.links
    normal_principled = normal_nodes.get("Principled BSDF")
    normal_texture = normal_nodes.new("ShaderNodeTexImage")
    normal_image = bpy.data.images.new("Website Normal Pixel", width=1, height=1)
    normal_texture.image = normal_image
    normal_map = normal_nodes.new("ShaderNodeNormalMap")
    normal_links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
    normal_links.new(normal_map.outputs["Normal"], normal_principled.inputs["Normal"])
    normal_map_result = procedural_module.analyze_material(normal_material)
    expect(normal_map_result["status"] == "exact",
           f"validated image Normal Map path was not recognized: {normal_map_result}")
    normal_links.remove(normal_principled.inputs["Normal"].links[0])
    invalid_normal_source = normal_nodes.new("ShaderNodeRGB")
    normal_links.new(invalid_normal_source.outputs["Color"], normal_principled.inputs["Normal"])
    invalid_normal_result = procedural_module.analyze_material(normal_material)
    expect(invalid_normal_result["status"] == "needsBake"
           and any("Normal" in reason for reason in invalid_normal_result["reasons"]),
           f"arbitrary linked Normal vector was reported as exact: {invalid_normal_result}")

    coordinate_material = bpy.data.materials.new("Website Texture Coordinates")
    bakelib.ensure_shader_node_tree(coordinate_material)
    coordinate_nodes = coordinate_material.node_tree.nodes
    coordinate_links = coordinate_material.node_tree.links
    coordinate_principled = coordinate_nodes.get("Principled BSDF")
    coordinate_source = coordinate_nodes.new("ShaderNodeTexCoord")
    coordinate_texture = coordinate_nodes.new("ShaderNodeTexImage")
    coordinate_image = bpy.data.images.new("Website Coordinate Pixel", width=1, height=1)
    coordinate_texture.image = coordinate_image
    coordinate_links.new(coordinate_source.outputs["UV"], coordinate_texture.inputs["Vector"])
    coordinate_links.new(coordinate_texture.outputs["Color"], coordinate_principled.inputs["Base Color"])
    uv_coordinate_result = procedural_module.analyze_material(coordinate_material)
    expect(uv_coordinate_result["status"] == "exact",
           f"ordinary UV texture coordinates were not recognized: {uv_coordinate_result}")
    coordinate_links.remove(coordinate_texture.inputs["Vector"].links[0])
    coordinate_links.new(
        coordinate_source.outputs["Generated"], coordinate_texture.inputs["Vector"],
    )
    generated_coordinate_result = procedural_module.analyze_material(coordinate_material)
    expect(generated_coordinate_result["status"] == "needsBake"
           and any("Generated" in reason for reason
                   in generated_coordinate_result["reasons"]),
           f"non-UV Texture Coordinate path was reported as exact: {generated_coordinate_result}")

    attribute_material = bpy.data.materials.new("Website Shader Attribute")
    bakelib.ensure_shader_node_tree(attribute_material)
    attribute_nodes = attribute_material.node_tree.nodes
    attribute_node = attribute_nodes.new("ShaderNodeAttribute")
    attribute_node.attribute_name = "artist_mask"
    attribute_material.node_tree.links.new(
        attribute_node.outputs["Fac"],
        attribute_nodes.get("Principled BSDF").inputs["Roughness"],
    )
    attribute_result = procedural_module.analyze_material(attribute_material)
    expect(attribute_result["status"] == "needsBake"
           and any("Attribute" in reason for reason in attribute_result["reasons"]),
           f"arbitrary shader Attribute was reported as exact: {attribute_result}")

    tangent_material = bpy.data.materials.new("Website Radial Tangent")
    bakelib.ensure_shader_node_tree(tangent_material)
    tangent_nodes = tangent_material.node_tree.nodes
    tangent_node = tangent_nodes.new("ShaderNodeTangent")
    tangent_material.node_tree.links.new(
        tangent_node.outputs["Tangent"],
        tangent_nodes.get("Principled BSDF").inputs["Tangent"],
    )
    tangent_node.direction_type = "UV_MAP"
    uv_tangent_result = procedural_module.analyze_material(tangent_material)
    expect(uv_tangent_result["status"] == "approximated"
           and any("Tangent" in reason for reason in uv_tangent_result["reasons"]),
           f"unverified UV tangent pattern was reported as exact: {uv_tangent_result}")
    tangent_node.direction_type = "RADIAL"
    tangent_result = procedural_module.analyze_material(tangent_material)
    expect(tangent_result["status"] == "needsBake"
           and any("Tangent" in reason for reason in tangent_result["reasons"]),
           f"nonportable Tangent path was reported as exact: {tangent_result}")

    card_layout = RecordingLayout()
    ui._draw_material_compatibility(card_layout, {
        "status": "needsBake",
        "label": "Needs Bake",
        "summary": "Procedural shading cannot publish as editable glTF.",
        "reasons": ["Noise Texture feeds Base Color."],
    })
    card_text = " ".join(event[1] for event in card_layout.events if event[0] == "label")
    expect("Needs Bake" in card_text and "Noise Texture" in card_text,
           f"Web Material did not explain its portability result: {card_layout.events}")

    blocked_card = RecordingLayout()
    ui._draw_material_compatibility(blocked_card, shader_to_rgb_result)
    blocked_text = " ".join(event[1] for event in blocked_card.events if event[0] == "label")
    expect("EEVEE-only" in blocked_text
           and "proven EEVEE materialization route" in blocked_text
           and "Use an Appearance bake" not in blocked_text,
           f"Web Material offered an impossible Cycles bake remedy: {blocked_card.events}")

    blocked_fidelity = validation._material_fidelity({
        **shader_to_rgb_result,
        "usedBy": ["Website Shader Object"],
    })
    expect(blocked_fidelity.route == "Runtime"
           and "EEVEE-only" in blocked_fidelity.detail
           and "proven EEVEE materialization route" in blocked_fidelity.detail
           and "Bake Appearance" not in blocked_fidelity.detail,
           f"Fidelity diagnostics offered an impossible Cycles bake remedy: {blocked_fidelity}")

    bpy.data.materials.remove(portable_material, do_unlink=True)
    bpy.data.materials.remove(shader_to_rgb_material, do_unlink=True)
    bpy.data.materials.remove(mixed_material, do_unlink=True)
    bpy.data.materials.remove(nested_principled_material, do_unlink=True)
    bpy.data.materials.remove(normal_material, do_unlink=True)
    bpy.data.materials.remove(coordinate_material, do_unlink=True)
    bpy.data.materials.remove(attribute_material, do_unlink=True)
    bpy.data.materials.remove(tangent_material, do_unlink=True)
    bpy.data.materials.remove(alpha_clip_material, do_unlink=True)
    bpy.data.images.remove(alpha_image)
    bpy.data.images.remove(coordinate_image)
    bpy.data.images.remove(normal_image)
    bpy.data.node_groups.remove(portable_tree)
    nested_mesh = make_cube("Nested Glass Bake Safety")
    nested_material = bpy.data.materials.new("Nested Glass")
    bakelib.ensure_shader_node_tree(nested_material)
    nested_tree = bpy.data.node_groups.new("Nested Glass Group", "ShaderNodeTree")
    nested_tree.interface.new_socket(
        name="Shader", in_out="OUTPUT", socket_type="NodeSocketShader",
    )
    nested_output = nested_tree.nodes.new("NodeGroupOutput")
    nested_glass = nested_tree.nodes.new("ShaderNodeBsdfGlass")
    nested_tree.links.new(nested_glass.outputs[0], nested_output.inputs["Shader"])
    nested_group = nested_material.node_tree.nodes.new("ShaderNodeGroup")
    nested_group.node_tree = nested_tree
    nested_surface = nested_material.node_tree.nodes.get("Material Output")
    nested_material.node_tree.links.new(nested_group.outputs["Shader"], nested_surface.inputs["Surface"])
    nested_mesh.data.materials.append(nested_material)
    expect("view/ray dependent" in exporter.dynamic_reason(nested_mesh),
           "automatic baked/realtime safety ignored view-dependent shader in a node group")
    expect(procedural_module.fixed_camera_material_bake_reason(nested_material) is None
           and exporter.dynamic_reason(
               nested_mesh, fixed_camera_appearance=True,
           ) is not None,
           "fixed-camera policy flattened glass without an alpha/compositing contract")

    camera_dependent_mesh = make_cube("Fixed Camera Appearance Safety")
    camera_dependent_material = bpy.data.materials.new(
        "Opaque Fixed Camera Layer Weight",
    )
    bakelib.ensure_shader_node_tree(camera_dependent_material)
    camera_nodes = camera_dependent_material.node_tree.nodes
    camera_links = camera_dependent_material.node_tree.links
    camera_layer_weight = camera_nodes.new("ShaderNodeLayerWeight")
    camera_principled = camera_nodes.get("Principled BSDF")
    camera_links.new(
        camera_layer_weight.outputs["Facing"],
        camera_principled.inputs["Roughness"],
    )
    camera_dependent_mesh.data.materials.append(camera_dependent_material)
    camera_reason = procedural_module.fixed_camera_appearance_bake_reason(
        camera_dependent_mesh,
    )
    expect(camera_reason is not None and "Layer Weight" in camera_reason,
           f"opaque Layer Weight did not qualify for fixed-camera Appearance: {camera_reason}")
    expect(exporter.dynamic_reason(camera_dependent_mesh) is not None
           and exporter.dynamic_reason(
               camera_dependent_mesh, fixed_camera_appearance=True,
           ) is None,
           "fixed-camera Appearance context did not narrow only the contextual policy")
    camera_analysis = validation._rendering_analysis_for(
        camera_dependent_mesh, fixed_camera_appearance=True,
    )
    expect(camera_analysis.dynamic_reason is None
           and camera_analysis.automatic_bake_reason == camera_reason
           and validation._fidelity_for(
               camera_dependent_mesh, camera_analysis,
           )[0].route == "Bake",
           f"Blender UI analysis drifted from fixed-camera export policy: {camera_analysis}")
    expect(not validation._appearance_bake_owned(camera_dependent_mesh)
           and validation._appearance_bake_owned(
               camera_dependent_mesh, fixed_camera_appearance=True,
           ),
           "selected-field compiler ownership drifted from fixed-camera Appearance")
    camera_dependent_mesh["blendlink_dynamic"] = True
    expect(procedural_module.fixed_camera_appearance_bake_reason(
               camera_dependent_mesh,
           ) is None
           and exporter.dynamic_reason(
               camera_dependent_mesh, fixed_camera_appearance=True,
           ) == "explicitly marked Realtime",
           "artist Realtime intent did not override automatic fixed-camera capture")
    del camera_dependent_mesh["blendlink_dynamic"]
    animated_material_mesh = make_cube("Animated Material Bake Safety")
    animated_material = bpy.data.materials.new("Animated Website Material")
    animated_material.diffuse_color = (0.1, 0.2, 0.3, 1.0)
    animated_material.keyframe_insert(data_path="diffuse_color", frame=1)
    animated_material.diffuse_color = (0.8, 0.2, 0.1, 1.0)
    animated_material.keyframe_insert(data_path="diffuse_color", frame=2)
    animated_material_mesh.data.materials.append(animated_material)
    expect("animated or driven" in exporter.dynamic_reason(animated_material_mesh),
           "automatic baked/realtime safety ignored material animation")
    expect("material" in exporter.procedural.pointer_animation_reason(animated_material_mesh)
           and validation._fidelity_for(animated_material_mesh)[0].route == "Block",
           "unsupported material property animation was presented as portable Three animation")
    expect(any(item["object"] == animated_material_mesh.name
               for item in exporter.procedural.pointer_animation_issues(bpy.context.scene)),
           "material animation did not reach the export blocker contract")
    animated_material_mesh["blendlink_dynamic"] = 0
    expect(not any(item["object"] == animated_material_mesh.name for item in
                   exporter.procedural.pointer_animation_issues(
                       bpy.context.scene, allow_forced_bake=True,
                   )),
           "an explicit Baked material freeze remained blocked in baked mode")
    del animated_material_mesh["blendlink_dynamic"]
    pointer_light_data = bpy.data.lights.new("Animated Light Data", "POINT")
    pointer_light = bpy.data.objects.new("Animated Light Data", pointer_light_data)
    bpy.context.scene.collection.objects.link(pointer_light)
    pointer_light_data.energy = 10
    pointer_light_data.keyframe_insert(data_path="energy", frame=1)
    pointer_light_data.energy = 20
    pointer_light_data.keyframe_insert(data_path="energy", frame=2)
    expect(any(item["object"] == pointer_light.name for item in
               exporter.procedural.pointer_animation_issues(bpy.context.scene)),
           "animated light data did not reach the export blocker contract")
    bpy.data.objects.remove(pointer_light, do_unlink=True)
    bpy.data.lights.remove(pointer_light_data)
    prior_world = bpy.context.scene.world
    pointer_world = prior_world or bpy.data.worlds.new("Animated World Data")
    prior_world_color = tuple(pointer_world.color)
    bpy.context.scene.world = pointer_world
    pointer_world.color = (0.1, 0.1, 0.1)
    pointer_world.keyframe_insert(data_path="color", frame=1)
    pointer_world.color = (0.2, 0.1, 0.1)
    pointer_world.keyframe_insert(data_path="color", frame=2)
    expect(any(item["object"] == "World" for item in
               exporter.procedural.pointer_animation_issues(bpy.context.scene)),
           "animated World data did not reach the export blocker contract")
    pointer_world.animation_data_clear()
    if prior_world is None:
        bpy.context.scene.world = None
        bpy.data.worlds.remove(pointer_world)
    else:
        pointer_world.color = prior_world_color
    cutout_mesh["blendlink_dynamic"] = 0
    expect(exporter.dynamic_reason(cutout_mesh) is None,
           "explicit Baked intent did not override conservative automatic safety")
    expect("alpha is linked" in exporter.procedural.forced_bake_risk(cutout_mesh),
           "explicit Baked override hid its accepted fidelity risk")
    expect(validation._fidelity_for(cutout_mesh)[0].route == "Bake",
           "Fidelity UI disagreed with the exporter's explicit Baked consequence")
    validation.recompute(bpy.context.scene)
    expect(exporter.dynamic_reason(nested_mesh) in ui._dynamic_note(nested_mesh),
           "cached artist-facing Realtime explanation drifted from the exporter policy")
    expect("Baked override" in ui._dynamic_note(cutout_mesh),
           "cached artist-facing Baked explanation hid the accepted fidelity risk")
    for safety_fixture in (
            animated_mesh, nla_mesh, shape_mesh, deform_mesh, cutout_mesh,
            nested_mesh, camera_dependent_mesh, animated_material_mesh):
        safety_fixture.hide_render = True

    # --- baked material ownership: mixed scenes never share mutations ---
    shared_source = bpy.data.materials.new("Shared Baked Realtime Source")
    shared_sentinel = shared_source.node_tree.nodes.new("ShaderNodeValue")
    shared_sentinel.name = "Realtime Source Sentinel"
    shared_nodes_before = sorted(
        (node.name, node.bl_idname) for node in shared_source.node_tree.nodes
    )
    baked_owner = make_cube("Baked Shared Material Owner")
    realtime_owner = make_cube("Realtime Shared Material Owner")
    baked_owner.data.materials.append(shared_source)
    realtime_owner.data.materials.append(shared_source)
    materialless = make_cube("Materialless Baked Owner")
    empty_slot = make_cube("Empty Slot Baked Owner")
    empty_placeholder = bpy.data.materials.new("Empty Slot Placeholder")
    empty_slot.data.materials.append(empty_placeholder)
    empty_slot.material_slots[0].material = None
    baked_image = bpy.data.images.new(
        "Headless Baked Atlas", width=4, height=4, alpha=True,
    )
    generated_materials = exporter.rebuild_baked_materials(
        [baked_owner, materialless, empty_slot],
        {"main": baked_image},
        atlas_for=lambda _obj: "main",
    )
    baked_copy = baked_owner.material_slots[0].material
    expect(baked_copy is not shared_source,
           "baked owner mutated/reused a material shared with Realtime")
    expect(realtime_owner.material_slots[0].material is shared_source,
           "Realtime owner lost its authored shared material during baked rebuild")
    expect(sorted((node.name, node.bl_idname) for node in shared_source.node_tree.nodes)
           == shared_nodes_before,
           "baked rebuild mutated the Realtime source material node tree")
    expect(len(materialless.material_slots) == 1
           and materialless.material_slots[0].material is not None,
           "material-less baked mesh did not receive an explicit atlas material")
    expect(empty_slot.material_slots[0].material is materialless.material_slots[0].material,
           "empty slots did not reuse the neutral per-atlas baked material")
    for material in (baked_copy, materialless.material_slots[0].material):
        texture_nodes = [
            node for node in material.node_tree.nodes
            if node.bl_idname == "ShaderNodeTexImage"
        ]
        expect(len(texture_nodes) == 1 and texture_nodes[0].image is baked_image,
               f"generated baked material {material.name!r} has no atlas texture binding")
    for obj in (baked_owner, realtime_owner, materialless, empty_slot):
        bpy.data.objects.remove(obj, do_unlink=True)
    for material in {
            item.as_pointer(): item for item in generated_materials.values()
    }.values():
        bpy.data.materials.remove(material, do_unlink=True)
    bpy.data.materials.remove(shared_source, do_unlink=True)
    bpy.data.materials.remove(empty_placeholder, do_unlink=True)
    bpy.data.images.remove(baked_image)

    # --- Lighting material ownership: browser bindings never alias ---
    lighting_source = bpy.data.materials.new("Shared Lighting Realtime Source")
    bakelib.ensure_shader_node_tree(lighting_source)
    lighting_principled = lighting_source.node_tree.nodes.get("Principled BSDF")
    lighting_principled.inputs["Base Color"].default_value = (0.3, 0.45, 0.7, 1.0)
    lighting_principled.inputs["Metallic"].default_value = 0.25
    lighting_sentinel = lighting_source.node_tree.nodes.new("ShaderNodeValue")
    lighting_sentinel.name = "Lighting Source Sentinel"
    lighting_nodes_before = sorted(
        (node.name, node.bl_idname) for node in lighting_source.node_tree.nodes
    )

    realtime_binding = make_cube("Lighting Binding Realtime")
    realtime_binding.data.materials.append(lighting_source)
    realtime_binding["blendlink_dynamic"] = True

    lighting_main = make_cube("Lighting Binding Main UV1")
    lighting_detail = make_cube("Lighting Binding Detail UV1")
    lighting_main_uv2 = make_cube("Lighting Binding Main UV2")
    lighting_main_peer = make_cube("Lighting Binding Main UV1 Peer")
    for obj in (lighting_main, lighting_detail, lighting_main_uv2, lighting_main_peer):
        obj.data.materials.append(lighting_source)

    neutral_main = make_cube("Lighting Neutral Main")
    neutral_detail = make_cube("Lighting Neutral Detail")
    empty_main = make_cube("Lighting Empty Slot Main")
    empty_placeholder = bpy.data.materials.new("Lighting Empty Placeholder")
    empty_main.data.materials.append(empty_placeholder)
    empty_main.material_slots[0].material = None

    lighting_bindings = (
        (lighting_main, "main", 1),
        (lighting_detail, "detail", 1),
        (lighting_main_uv2, "main", 2),
        (lighting_main_peer, "main", 1),
        (neutral_main, "main", 1),
        (neutral_detail, "detail", 1),
        (empty_main, "main", 1),
    )
    for obj, atlas_name, expected_channel in lighting_bindings:
        obj["blendlink_atlas"] = atlas_name
        while len(obj.data.uv_layers) < expected_channel:
            obj.data.uv_layers.new(name=f"Authored UV {len(obj.data.uv_layers)}")
        obj.data.uv_layers.new(name=bakelib.ATLAS_UV)
        actual_channel = exporter.stamp_bake_output_metadata(obj, "lighting")
        expect(actual_channel == expected_channel,
               f"{obj.name} expected TEXCOORD_{expected_channel}, got {actual_channel}")

    lighting_generated = exporter.fork_lighting_materials(
        [entry[0] for entry in lighting_bindings],
        atlas_for=lambda obj: obj["blendlink_atlas"],
        channel_for=lambda obj: obj["blendlink_lightmap_uv"],
    )
    main_material = lighting_main.material_slots[0].material
    detail_material = lighting_detail.material_slots[0].material
    main_uv2_material = lighting_main_uv2.material_slots[0].material
    expect(realtime_binding.material_slots[0].material is lighting_source,
           "Lighting finalization replaced the Realtime object's authored material")
    expect(main_material is not lighting_source and detail_material is not lighting_source
           and main_uv2_material is not lighting_source,
           "Lighting meshes still reference the Realtime source material")
    expect(len({
        main_material.as_pointer(), detail_material.as_pointer(),
        main_uv2_material.as_pointer(),
    }) == 3,
           "Lighting bindings shared across atlas or lightmap UV channel")
    expect(lighting_main_peer.material_slots[0].material is main_material,
           "identical source/output/atlas/channel bindings did not reuse one private copy")
    expect(sorted((node.name, node.bl_idname) for node in lighting_source.node_tree.nodes)
           == lighting_nodes_before,
           "Lighting material forking mutated the authored/Realtime material graph")

    neutral_main_material = neutral_main.material_slots[0].material
    neutral_detail_material = neutral_detail.material_slots[0].material
    expect(neutral_main_material is not None and neutral_detail_material is not None
           and neutral_main_material is not neutral_detail_material,
           "materialless Lighting meshes did not receive per-binding neutral materials")
    expect(empty_main.material_slots[0].material is neutral_main_material,
           "an empty material slot did not reuse its binding's explicit neutral PBR material")
    for neutral in (neutral_main_material, neutral_detail_material):
        principled = neutral.node_tree.nodes.get("Principled BSDF")
        expect(principled is not None
               and abs(principled.inputs["Metallic"].default_value) < 1e-8,
               "materialless Lighting neutral is not an explicit dielectric PBR material")

    # Real glTF export proves copied Blender datablocks become distinct material
    # indices. That is the ownership boundary GLTFLoader uses in the browser.
    with tempfile.TemporaryDirectory(prefix="blendlink-lighting-bindings-glb-") as tmp:
        glb_path = Path(tmp) / "lighting-bindings.glb"
        export_objects = [
            realtime_binding, lighting_main, lighting_detail, lighting_main_uv2,
            lighting_main_peer, neutral_main, neutral_detail, empty_main,
        ]
        select_only(*export_objects)
        bpy.ops.export_scene.gltf(
            filepath=str(glb_path), export_format="GLB", use_selection=True,
            export_apply=True, export_texcoords=True, export_materials="EXPORT",
            export_extras=True,
        )
        glb = glb_path.read_bytes()
        json_length, json_type = struct.unpack_from("<II", glb, 12)
        expect(json_type == 0x4E4F534A, "Lighting binding fixture has no glTF JSON chunk")
        document = json.loads(glb[20:20 + json_length].decode("utf8").rstrip(" \0"))
        nodes = {node.get("name"): node for node in document["nodes"]}

        def primitive_for(name):
            node = nodes[name]
            return document["meshes"][node["mesh"]]["primitives"][0]

        realtime_primitive = primitive_for(realtime_binding.name)
        main_primitive = primitive_for(lighting_main.name)
        detail_primitive = primitive_for(lighting_detail.name)
        main_uv2_primitive = primitive_for(lighting_main_uv2.name)
        peer_primitive = primitive_for(lighting_main_peer.name)
        neutral_main_primitive = primitive_for(neutral_main.name)
        neutral_detail_primitive = primitive_for(neutral_detail.name)
        empty_main_primitive = primitive_for(empty_main.name)
        expect(len({
            realtime_primitive["material"], main_primitive["material"],
            detail_primitive["material"], main_uv2_primitive["material"],
        }) == 4,
               "GLB material indices alias Realtime, atlas, or UV-channel bindings")
        expect(peer_primitive["material"] == main_primitive["material"],
               "GLB failed to retain intentional sharing within one Lighting binding")
        expect("TEXCOORD_1" in main_primitive["attributes"]
               and "TEXCOORD_1" in detail_primitive["attributes"]
               and "TEXCOORD_2" in main_uv2_primitive["attributes"],
               "GLB Lighting binding channels disagree with published object metadata")
        expect(neutral_main_primitive["material"] == empty_main_primitive["material"]
               and neutral_main_primitive["material"] != neutral_detail_primitive["material"],
               "GLB neutral material ownership ignored the complete binding key")
        for primitive in (neutral_main_primitive, neutral_detail_primitive):
            neutral_pbr = document["materials"][primitive["material"]]["pbrMetallicRoughness"]
            expect(neutral_pbr.get("metallicFactor") == 0,
                   "materialless Lighting primitive exported GLTFLoader's metallic default")

    lighting_objects = [
        realtime_binding, lighting_main, lighting_detail, lighting_main_uv2,
        lighting_main_peer, neutral_main, neutral_detail, empty_main,
    ]
    for obj in lighting_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for material in {
            item.as_pointer(): item for item in lighting_generated.values()
    }.values():
        bpy.data.materials.remove(material, do_unlink=True)
    bpy.data.materials.remove(lighting_source, do_unlink=True)
    bpy.data.materials.remove(empty_placeholder, do_unlink=True)

    fingerprint_layout = {"near": {"objects": [crate]}}
    fingerprint_bake = {"size": 256, "samples": 8, "margin": 12}
    fingerprint = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    crate["Fingerprint Tint"] = (0.1, 0.2, 0.3, 1.0)
    object_attribute_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    crate["Fingerprint Tint"] = (0.1, 0.7, 0.3, 1.0)
    object_attribute_array_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(
        object_attribute_changed != fingerprint
        and object_attribute_array_changed != object_attribute_changed,
        "Object Attribute arrays failed to invalidate the bake fingerprint",
    )
    del crate["Fingerprint Tint"]
    crate.pass_index += 1
    object_index_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    crate.pass_index -= 1
    expect(object_index_changed != fingerprint,
           "Object Info Object Index failed to invalidate the bake fingerprint")
    camera_data = bpy.data.cameras.new("Fingerprint Camera")
    camera = bpy.data.objects.new("Fingerprint Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera_data.lens += 5
    camera_only = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(camera_only == fingerprint,
           "camera-only metadata should not invalidate unchanged baked pixels")
    quality_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout,
        {**fingerprint_bake, "size": 512},
        "near", "state:default",
    )
    expect(quality_changed != fingerprint,
           "bake setting values must participate in the dependency fingerprint")
    fingerprint_material = bpy.data.materials.new("Fingerprint Material")
    crate.data.materials.append(fingerprint_material)
    material_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(material_changed != fingerprint,
           "material dependency failed to invalidate the bake fingerprint")
    fingerprint_tree = bakelib.ensure_shader_node_tree(fingerprint_material)
    fingerprint_tree.nodes.clear()
    fingerprint_output = fingerprint_tree.nodes.new("ShaderNodeOutputMaterial")
    fingerprint_emission = fingerprint_tree.nodes.new("ShaderNodeEmission")
    authored_reserved_name = fingerprint_tree.nodes.new("ShaderNodeValue")
    authored_reserved_name.name = "BLENDLINK_BAKE_TARGET"
    fingerprint_tree.links.new(
        authored_reserved_name.outputs["Value"],
        fingerprint_emission.inputs["Strength"],
    )
    fingerprint_tree.links.new(
        fingerprint_emission.outputs["Emission"],
        fingerprint_output.inputs["Surface"],
    )
    reserved_name_initial = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    authored_reserved_name.outputs["Value"].default_value = 0.75
    reserved_name_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(
        reserved_name_changed != reserved_name_initial,
        "an authored node named like temporary bake plumbing bypassed the cache",
    )
    material_changed = reserved_name_changed
    crate.visible_shadow = False
    ray_visibility_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    crate.visible_shadow = True
    expect(ray_visibility_changed != material_changed,
           "Cycles ray visibility failed to invalidate the bake fingerprint")
    light_data = bpy.data.lights.new("Fingerprint Node Light", "POINT")
    bakelib.ensure_shader_node_tree(light_data)
    light_object = bpy.data.objects.new("Fingerprint Node Light", light_data)
    bpy.context.scene.collection.objects.link(light_object)
    ies_path = work / "fingerprint.ies"
    ies_path.write_text("IESNA:LM-63-1995\nTILT=NONE\n", encoding="utf8")
    ies_node = light_data.node_tree.nodes.new("ShaderNodeTexIES")
    ies_node.mode = "EXTERNAL"
    ies_node.filepath = str(ies_path)
    node_light_initial = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    light_data.node_tree.nodes.new("ShaderNodeValue")
    node_light_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(node_light_changed != node_light_initial,
           "Cycles light node-tree edits failed to invalidate the bake fingerprint")
    ies_path.write_text("IESNA:LM-63-2002\nTILT=NONE\n", encoding="utf8")
    external_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(external_changed != node_light_changed,
           "same-path external dependency edits reused a stale bake fingerprint")
    expect(exporter.volatile_dependency_path("//tiles/stone_<UDIM>.exr")
           and exporter.volatile_dependency_path("//sequence/frame_####.png"),
           "UDIM/sequence dependencies were not marked cache-volatile")
    layer_state_collection = bpy.context.view_layer.layer_collection.children.get(
        state_collection.name,
    )
    layer_state_collection.exclude = True
    layer_excluded = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    layer_state_collection.exclude = False
    expect(layer_excluded != external_changed,
           "ViewLayer collection flags failed to invalidate the bake fingerprint")
    instance_source_collection = bpy.data.collections.new("Fingerprint Instance Source")
    instance_source = make_cube("Fingerprint Instanced Mesh")
    for collection in list(instance_source.users_collection):
        collection.objects.unlink(instance_source)
    instance_source_collection.objects.link(instance_source)
    instance_material = bpy.data.materials.new("Fingerprint Instance Material")
    instance_source.data.materials.append(instance_material)
    instance_light_data = bpy.data.lights.new("Fingerprint Instanced Light", "POINT")
    instance_light = bpy.data.objects.new("Fingerprint Instanced Light", instance_light_data)
    instance_source_collection.objects.link(instance_light)
    collection_instance = bpy.data.objects.new("Fingerprint Collection Instance", None)
    collection_instance.instance_type = "COLLECTION"
    collection_instance.instance_collection = instance_source_collection
    bpy.context.scene.collection.objects.link(collection_instance)
    # Cycles still renders this root, but the viewport depsgraph omits its
    # occurrences. The authored collection-source traversal must keep cache
    # invalidation truthful without changing the artist's viewport state.
    collection_instance.hide_viewport = True
    collection_instance.hide_set(True, view_layer=bpy.context.view_layer)
    instance_initial = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    instance_material.diffuse_color = (0.9, 0.1, 0.2, 1.0)
    bpy.context.view_layer.update()
    instance_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(instance_changed != instance_initial,
           "collection-instance material edits reused a stale bake fingerprint")
    instance_light_data.energy += 100.0
    bpy.context.view_layer.update()
    instance_light_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(instance_light_changed != instance_changed,
           "collection-instanced light edits reused a stale bake fingerprint")
    instance_source.visible_shadow = False
    bpy.context.view_layer.update()
    instance_object_changed = bakelib.fingerprint_bake_dependencies(
        bpy.context.scene, fingerprint_layout, fingerprint_bake,
        "near", "state:default",
    )
    expect(instance_object_changed != instance_light_changed,
           "collection-instanced object ray settings reused a stale bake fingerprint")
    bpy.context.scene.render.bake.use_selected_to_active = True
    exporter.bake_engine(8)
    expect(not bpy.context.scene.render.bake.use_selected_to_active
           and not bpy.context.scene.render.bake.use_cage
           and bpy.context.scene.render.bake.margin_type == "EXTEND",
           "bake engine did not normalize artist-owned cage/margin settings")

    emission_material = bpy.data.materials.new("Linked Emission Regression")
    bakelib.ensure_shader_node_tree(emission_material)
    emission_node = emission_material.node_tree.nodes.new("ShaderNodeEmission")
    emission_driver = emission_material.node_tree.nodes.new("ShaderNodeValue")
    emission_material.node_tree.links.new(
        emission_driver.outputs[0], emission_node.inputs["Strength"],
    )
    expect(not hasattr(exporter, "mute_emission")
           and not hasattr(exporter, "covered_light_peak"),
           "exporter reintroduced bake mechanics outside canonical bakelib")
    muted_emission = bakelib.mute_emission()
    expect(not emission_node.inputs["Strength"].is_linked
           and emission_node.inputs["Strength"].default_value == 0,
           "linked material emission remained in additive light bounces")
    bakelib.restore_emission(muted_emission)
    expect(emission_node.inputs["Strength"].is_linked,
           "linked material emission graph was not restored exactly")
    import numpy as np
    sparse_rgb = np.zeros((10000, 3), dtype=np.float32)
    sparse_mask = np.zeros((100, 100), dtype=bool)
    sparse_mask[0, 0] = True
    sparse_rgb[0] = (4.0, 2.0, 1.0)
    expect(abs(bakelib.covered_light_peak(sparse_rgb, sparse_mask) - 4.0) < 1e-6,
           "light-layer normalization percentile included empty atlas texels")

    # Linear EXR preparation is a canonical save primitive too: HDR values
    # must survive an artist's display transform, settings must be restored,
    # and write failures must propagate instead of quietly degrading output.
    linear_image = bpy.data.images.new(
        "Linear EXR Contract", width=2, height=2, alpha=True, float_buffer=True,
    )
    linear_pixels = np.array([
        4.0, 2.0, 0.5, 1.0,
        1.0, 0.25, 0.125, 1.0,
        0.5, 1.0, 2.0, 1.0,
        0.0, 0.5, 1.0, 1.0,
    ], dtype=np.float32)
    linear_image.pixels.foreach_set(linear_pixels)
    linear_image.update()
    linear_source_check = np.empty(16, dtype=np.float32)
    linear_image.pixels.foreach_get(linear_source_check)
    expect(np.allclose(linear_source_check, linear_pixels),
           f"linear EXR fixture did not retain pixels: {linear_source_check.tolist()}")
    artist_image = {
        "filepath_raw": linear_image.filepath_raw,
        "file_format": linear_image.file_format,
        "colorspace": linear_image.colorspace_settings.name,
    }
    artist_render = {
        "file_format": bpy.context.scene.render.image_settings.file_format,
        "color_mode": bpy.context.scene.render.image_settings.color_mode,
        "color_depth": bpy.context.scene.render.image_settings.color_depth,
    }
    artist_color = {
        "view_transform": bpy.context.scene.view_settings.view_transform,
        "look": bpy.context.scene.view_settings.look,
        "exposure": bpy.context.scene.view_settings.exposure,
    }
    loaded_linear = None
    try:
        bpy.context.scene.view_settings.view_transform = "AgX"
        bpy.context.scene.view_settings.exposure = 2.0
        expected_color = {
            "view_transform": bpy.context.scene.view_settings.view_transform,
            "look": bpy.context.scene.view_settings.look,
            "exposure": bpy.context.scene.view_settings.exposure,
        }
        with tempfile.TemporaryDirectory(prefix="blendlink-linear-exr-") as exr_dir:
            exr_path = str(Path(exr_dir) / "linear.exr")
            bakelib.save_linear_exr(linear_image, exr_path)
            expect(Path(exr_path).is_file() and Path(exr_path).stat().st_size > 0,
                   "linear EXR save did not produce a file")
            expect({
                "view_transform": bpy.context.scene.view_settings.view_transform,
                "look": bpy.context.scene.view_settings.look,
                "exposure": bpy.context.scene.view_settings.exposure,
            } == expected_color,
                   "linear EXR save did not restore artist color management")
            expect({
                "filepath_raw": linear_image.filepath_raw,
                "file_format": linear_image.file_format,
                "colorspace": linear_image.colorspace_settings.name,
            } == artist_image,
                   "linear EXR save did not restore artist image metadata: "
                   f"expected {artist_image}, got "
                   f"{linear_image.filepath_raw, linear_image.file_format, linear_image.colorspace_settings.name}")
            expect({
                "file_format": bpy.context.scene.render.image_settings.file_format,
                "color_mode": bpy.context.scene.render.image_settings.color_mode,
                "color_depth": bpy.context.scene.render.image_settings.color_depth,
            } == artist_render,
                   "linear EXR save did not restore artist render settings")
            loaded_linear = bpy.data.images.load(exr_path, check_existing=False)
            # File-backed image buffers are lazy; scalar access forces the
            # EXR decode before the zero-copy bulk read below.
            _ = loaded_linear.pixels[0]
            round_trip = np.empty(16, dtype=np.float32)
            loaded_linear.pixels.foreach_get(round_trip)
            expect(np.allclose(
                round_trip.reshape(-1, 4)[:, :3],
                linear_pixels.reshape(-1, 4)[:, :3],
                rtol=1e-3, atol=1e-3,
            ), "linear EXR save changed HDR pixels: "
               f"{round_trip.reshape(-1, 4)[:, :3].tolist()}")
            bpy.data.images.remove(loaded_linear)
            loaded_linear = None

            class FailingImage:
                def save_render(self, _path, scene):
                    raise RuntimeError("synthetic EXR write failure")

            failed_loudly = False
            try:
                bakelib.save_linear_exr(
                    FailingImage(), str(Path(exr_dir) / "unwritten.exr"),
                )
            except RuntimeError:
                failed_loudly = True
            expect(failed_loudly, "linear EXR write failure was swallowed")
            expect({
                "view_transform": bpy.context.scene.view_settings.view_transform,
                "look": bpy.context.scene.view_settings.look,
                "exposure": bpy.context.scene.view_settings.exposure,
            } == expected_color,
                   "failed linear EXR save did not restore artist color management")
            expect({
                "filepath_raw": linear_image.filepath_raw,
                "file_format": linear_image.file_format,
                "colorspace": linear_image.colorspace_settings.name,
            } == artist_image,
                   "failed linear EXR save did not restore artist image metadata")
            expect({
                "file_format": bpy.context.scene.render.image_settings.file_format,
                "color_mode": bpy.context.scene.render.image_settings.color_mode,
                "color_depth": bpy.context.scene.render.image_settings.color_depth,
            } == artist_render,
                   "failed linear EXR save did not restore artist render settings")
    finally:
        if loaded_linear is not None:
            bpy.data.images.remove(loaded_linear)
        bpy.data.images.remove(linear_image)
        bakelib.restore_color_management(bpy.context.scene, artist_color)

    empty_bake = bpy.data.images.new(
        "Empty Populated Bake", width=4, height=4, alpha=True, float_buffer=True,
    )
    try:
        # Blender 5.2 initializes new float images as opaque black. Real bake
        # targets are cleared transparent before Cycles writes coverage, so
        # reproduce that contract rather than rejecting valid black texels.
        bakelib.clear_image(empty_bake)
        try:
            bakelib.require_image_coverage(
                empty_bake, "state 'default' atlas 'main'",
            )
        except RuntimeError as error:
            expect("Cycles produced no baked coverage" in str(error)
                   and "refused to publish an empty atlas" in str(error),
                   f"empty populated bake failed without useful context: {error}")
        else:
            raise AssertionError("empty populated bake was silently accepted")
    finally:
        bpy.data.images.remove(empty_bake)

    # Cycles EMIT fills target alpha even where no UV-covered texel was
    # written. Selected-field materialization therefore uses a separate
    # constant-white signal pass rather than silently treating opaque black
    # corners as valid coverage.
    signal_mask = bpy.data.images.new(
        "Emit Signal Coverage", width=4, height=4, alpha=True, float_buffer=True,
    )
    try:
        signal_pixels = np.zeros(4 * 4 * 4, dtype=np.float32)
        rgba = signal_pixels.reshape(4, 4, 4)
        rgba[:, :, 3] = 1.0
        rgba[1:3, 1:3, :3] = 1.0
        signal_mask.pixels.foreach_set(signal_pixels)
        signal_coverage = bakelib.image_signal_coverage(
            signal_mask, "selected-field white Emit mask",
        )
        expect(
            signal_coverage.tolist() == [
                [False, False, False, False],
                [False, True, True, False],
                [False, True, True, False],
                [False, False, False, False],
            ],
            "white Emit mask did not recover RGB-written UV coverage independently of alpha",
        )
    finally:
        bpy.data.images.remove(signal_mask)

    # Sparse atlases are legitimate (small/pinned hero islands). Coverage
    # below one percent must still receive the post-save constant background.
    with tempfile.TemporaryDirectory(prefix="blendlink-sparse-atlas-") as sparse_dir:
        sparse_path = str(Path(sparse_dir) / "sparse.png")
        sparse = bpy.data.images.new("Sparse Atlas", width=32, height=32, alpha=True)
        sparse_pixels = np.zeros(32 * 32 * 4, dtype=np.float32)
        sparse_pixels.reshape(32, 32, 4)[:, :, :3] = (0.1, 0.4, 0.8)
        sparse_pixels.reshape(32, 32, 4)[:, :, 3] = 1.0
        sparse.pixels.foreach_set(sparse_pixels)
        sparse.filepath_raw = sparse_path
        sparse.file_format = "PNG"
        sparse.save()
        bpy.data.images.remove(sparse)
        sparse_coverage = np.zeros((32, 32), dtype=bool)
        sparse_coverage[0, 0] = True
        bakelib.flatten_saved_background(
            sparse_path, sparse_coverage, label="sparse regression",
        )
        flattened = bpy.data.images.load(sparse_path, check_existing=False)
        flattened_pixels = np.empty(32 * 32 * 4, dtype=np.float32)
        flattened.pixels.foreach_get(flattened_pixels)
        flattened_rgb = flattened_pixels.reshape(32, 32, 4)[:, :, :3]
        bpy.data.images.remove(flattened)
        background = flattened_rgb[~sparse_coverage]
        expect(np.max(np.ptp(background, axis=0)) < 1e-6,
               "sub-one-percent atlas coverage left a non-constant background")

    # materialize: copies the preview into an editable authored layer
    select_only(crate)
    bpy.ops.blendlink.materialize_atlas_uvs()
    authored = crate.data.uv_layers.get(ops.AUTHORED_UV)
    expect(authored is not None, "materialize did not create the authored layer")
    expect(crate.data.uv_layers.active.name == ops.AUTHORED_UV,
           "authored layer should be active for editing")
    atlas_values = [tuple(d.uv) for d in crate.data.uv_layers.get(ops.ATLAS_UV).data]
    expect([tuple(d.uv) for d in authored.data] == atlas_values,
           "authored layer differs from the previewed pack")
    expect(not any(d.pin_uv for d in authored.data), "materialize must not pre-pin")

    # never silently overwrite: an artist edit survives a re-materialize
    authored.data[0].uv = (0.123, 0.456)
    bpy.ops.blendlink.materialize_atlas_uvs()
    authored = crate.data.uv_layers.get(ops.AUTHORED_UV)
    expect(abs(authored.data[0].uv[0] - 0.123) < 1e-6,
           "re-materialize silently overwrote the authored layer")
    bpy.ops.blendlink.materialize_atlas_uvs(overwrite=True)
    authored = crate.data.uv_layers.get(ops.AUTHORED_UV)
    expect(abs(authored.data[0].uv[0] - atlas_values[0][0]) < 1e-6,
           "overwrite=True did not refresh the authored layer")

    # Multi-object materialization is transactional. A later mesh at
    # Blender's UV-layer limit must not leave an earlier mesh modified.
    transaction_ready = make_cube("Materialize Transaction Ready")
    transaction_full = make_cube("Materialize Transaction Full")
    for transaction_obj in (transaction_ready, transaction_full):
        source = transaction_obj.data.uv_layers.active
        transaction_atlas = transaction_obj.data.uv_layers.new(name=ops.ATLAS_UV)
        expect(transaction_atlas is not None, "transaction fixture could not add atlas UVs")
        for target, original in zip(transaction_atlas.data, source.data):
            target.uv = original.uv
    exhausted = False
    for index in range(64):
        try:
            extra = transaction_full.data.uv_layers.new(name=f"Limit {index}")
        except RuntimeError:
            exhausted = True
            break
        if extra is None:
            exhausted = True
            break
    expect(exhausted, "transaction fixture did not reach Blender's UV-layer limit")
    ready_layers_before = tuple(layer.name for layer in transaction_ready.data.uv_layers)
    full_layers_before = tuple(layer.name for layer in transaction_full.data.uv_layers)
    select_only(transaction_ready, transaction_full)
    try:
        transaction_result = bpy.ops.blendlink.materialize_atlas_uvs()
    except RuntimeError as error:
        expect("no selected mesh was changed" in str(error),
               f"materialization failure was not actionable: {error}")
        transaction_result = {"CANCELLED"}
    expect("CANCELLED" in transaction_result,
           "UV-layer exhaustion did not cancel multi-object materialization")
    expect(tuple(layer.name for layer in transaction_ready.data.uv_layers) == ready_layers_before
           and tuple(layer.name for layer in transaction_full.data.uv_layers) == full_layers_before,
           "cancelled materialization partially changed the selected meshes")
    for transaction_obj in (transaction_ready, transaction_full):
        transaction_mesh = transaction_obj.data
        bpy.data.objects.remove(transaction_obj, do_unlink=True)
        bpy.data.meshes.remove(transaction_mesh)

    # Mesh attributes and UV layers share Blender's name namespace. A generic
    # attribute reserving the authored name must cancel loudly; accepting the
    # automatically renamed `.001` UV would report success while the exporter
    # continues to ignore it.
    collision_obj = make_cube("Materialize Attribute Name Collision")
    collision_mesh = collision_obj.data
    collision_source = collision_mesh.uv_layers.active
    collision_atlas = collision_mesh.uv_layers.new(name=ops.ATLAS_UV)
    expect(collision_atlas is not None, "collision fixture could not add atlas UVs")
    for target, original in zip(collision_atlas.data, collision_source.data):
        target.uv = original.uv
    collision_mesh.uv_layers.active = collision_source
    reserved = collision_mesh.attributes.new(
        name=ops.AUTHORED_UV, type="FLOAT", domain="POINT",
    )
    for index, item in enumerate(reserved.data):
        item.value = index + 0.25
    collision_layers_before = tuple(layer.name for layer in collision_mesh.uv_layers)
    collision_active_before = collision_mesh.uv_layers.active.name
    collision_attribute_before = tuple(item.value for item in reserved.data)
    collision_atlas_before = tuple(tuple(item.uv) for item in collision_atlas.data)
    select_only(collision_obj)
    try:
        collision_result = bpy.ops.blendlink.materialize_atlas_uvs()
    except RuntimeError as error:
        expect(ops.AUTHORED_UV in str(error) and "no selected mesh was changed" in str(error),
               f"name-collision failure was not actionable: {error}")
        collision_result = {"CANCELLED"}
    expect("CANCELLED" in collision_result,
           "reserved authored attribute name did not cancel materialization")
    expect(tuple(layer.name for layer in collision_mesh.uv_layers) == collision_layers_before,
           "name-collision cancellation left a suffixed UV layer")
    expect(collision_mesh.uv_layers.active.name == collision_active_before,
           "name-collision cancellation changed the active UV layer")
    reserved_after = collision_mesh.attributes.get(ops.AUTHORED_UV)
    expect(reserved_after is not None
           and reserved_after.domain == "POINT"
           and reserved_after.data_type == "FLOAT"
           and tuple(item.value for item in reserved_after.data) == collision_attribute_before,
           "name-collision cancellation changed the reserved generic attribute")
    expect(tuple(tuple(item.uv) for item in collision_atlas.data) == collision_atlas_before,
           "name-collision cancellation changed the published atlas UVs")
    bpy.data.objects.remove(collision_obj, do_unlink=True)
    bpy.data.meshes.remove(collision_mesh)
    select_only(crate)

    # Published inspection is immutable evidence. Local authored edits only
    # affect a future sync; they must never masquerade as the last build.
    authored = crate.data.uv_layers.get(ops.AUTHORED_UV)
    for d in authored.data:
        d.uv = (d.uv[0] * 0.2 + 0.75, d.uv[1] * 0.2 + 0.75)
        d.pin_uv = True
    pinned_values = [tuple(d.uv) for d in authored.data]
    bpy.ops.blendlink.preview_atlas_uvs()
    atlas = crate.data.uv_layers.get(ops.ATLAS_UV)
    expect([tuple(loop.uv) for loop in atlas.data] == published_uvs[crate.name],
           "local authored edits replaced exact published UV evidence")
    authored_drift = max(abs(d.uv[0] - x) + abs(d.uv[1] - y)
                         for d, (x, y) in zip(atlas.data, pinned_values))
    expect(authored_drift > 1e-3,
           "published evidence unexpectedly followed unsynced authored UV edits")

    # checker cycle: OFF → DENSITY → UVGRID → OFF, viewport-only
    expect(ops._checker_mode() == "OFF", "checker should start OFF")
    bpy.ops.blendlink.toggle_checker()
    expect(ops._checker_mode() == "DENSITY", "first toggle should be DENSITY")
    mod = next(m for m in crate.modifiers if m.name.startswith(ops.CHECKER_MODIFIER))
    expect(mod.show_render is False, "checker must be viewport-only")
    expect("-DENSITY-256px" in mod.node_group.name,
           f"unexpected checker group {mod.node_group.name}")
    material = bpy.data.materials.get(mod.node_group.name)
    expect(material is not None, "checker material missing")
    mapping = next(n for n in material.node_tree.nodes if n.type == "MAPPING")
    # 256px atlas, 8-texel cells, 32 generated cells per repeat → scale 1.0
    expect(abs(mapping.inputs["Scale"].default_value[0] - 1.0) < 1e-6,
           f"density scale wrong: {mapping.inputs['Scale'].default_value[0]}")
    bpy.ops.blendlink.toggle_checker()
    expect(ops._checker_mode() == "UVGRID", "second toggle should be UVGRID")
    bpy.ops.blendlink.toggle_checker()
    expect(ops._checker_mode() == "OFF", "third toggle should be OFF")
    expect(not any(m.name.startswith(ops.CHECKER_MODIFIER)
                   for o in bpy.data.objects for m in getattr(o, "modifiers", [])),
           "checker modifiers left behind after the OFF cycle")
    expect(not any(b.name.startswith("BLENDLINK-checker") for b in bpy.data.materials),
           "checker materials left behind after the OFF cycle")

    # Exact saved-image isolation uses the same viewport-only safety seam.
    saved = bpy.data.images.new("Saved Atlas Fixture", width=16, height=16)
    saved.generated_color = (0.2, 0.4, 0.8, 1.0)
    saved_path = Path(tempfile.gettempdir()) / "blendlink-saved-atlas-fixture.png"
    saved.filepath_raw = str(saved_path)
    saved.file_format = "PNG"
    saved.save()
    bpy.data.images.remove(saved)
    syncstatus._state["derived_assets"] = [{
        "kind": "state", "label": "default", "atlas": "near",
        "path": str(saved_path), "verified": True, "contentHash": "saved-v1",
    }]
    session = bpy.context.window_manager.blendlink
    session.derived_asset_path = str(saved_path)
    session.derived_asset_label = "default / near"
    session.derived_asset_atlas = "near"
    session.derived_asset_kind = "state"
    session.derived_asset_content_hash = "saved-v1"
    bpy.ops.blendlink.isolate_derived_asset()
    expect(ops._checker_mode() == "SAVED", "saved baked layer did not become the viewport override")
    syncstatus._state["derived_assets"] = [{
        "kind": "state", "label": "default", "atlas": "near",
        "path": str(saved_path), "verified": True, "contentHash": "saved-v2",
    }]
    expect(syncstatus._clear_unverified_selection(),
           "same-path published image replacement did not invalidate the old byte identity")
    expect(ops.reconcile_saved_asset_override(),
           "same-path published image replacement left stale saved pixels isolated")
    expect(ops._checker_mode() == "OFF" and not any(
        modifier.name.startswith(ops.CHECKER_MODIFIER)
        for obj in bpy.data.objects for modifier in getattr(obj, "modifiers", [])
    ), "stale saved-layer override survived an in-place rebuild")

    # cleanup strips strays (a modifier with no node group)
    rock.modifiers.new(name=ops.CHECKER_MODIFIER, type="NODES")
    bpy.ops.blendlink.checker_cleanup()
    expect(not any(m.name.startswith(ops.CHECKER_MODIFIER) for m in rock.modifiers),
           "cleanup missed a stray checker modifier")

    syncstatus._state["bake_plan"] = None
    syncstatus._state["plan"] = {}
    syncstatus._state["incremental_bake"] = None

    # --- designation card + copy-hint gating ---
    select_only(hotspot)
    expect(ui.BLENDLINK_PT_designation.poll(bpy.context), "designation card should show for the active object")
    text = ui.describe(vocab.classify(hotspot.name))
    expect("Interactive marker" in text, f"hotspot consequence wrong: {text}")
    text = ui.describe(vocab.classify("Crate-colonly"))
    expect("hidden in the web build" in text, f"colonly consequence wrong: {text}")
    text = ui.describe(vocab.classify("Anything", {"blendlink_role": "convcol"}))
    expect("convex-hull" in text, f"property-role consequence wrong: {text}")
    expect(ui.describe(None).startswith("No designation"), "no-designation text wrong")
    expect(not bpy.ops.blendlink.copy_sync_hint.poll(), "copy hint should be disabled without a manifest hint")

    # --- artist-owned web recipe: Main + selected exceptions + stable IDs ---
    procedural = make_cube("Procedural Sculpture")
    node_tree = bpy.data.node_groups.new("Website Procedural", "GeometryNodeTree")
    node_tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    node_tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    group_input = node_tree.nodes.new("NodeGroupInput")
    group_output = node_tree.nodes.new("NodeGroupOutput")
    node_tree.links.new(group_input.outputs["Geometry"], group_output.inputs["Geometry"])
    node_tree.nodes.new("GeometryNodeStoreNamedAttribute")
    node_tree.nodes.new("GeometryNodeInputSceneTime")
    modifier = procedural.modifiers.new("Website Procedural", "NODES")
    modifier.node_group = node_tree
    validation.recompute(bpy.context.scene)
    fidelity = [item for item in validation.result().fidelity
                if item.object_name == procedural.name]
    expect(any(item.route == "Cache" and item.blocking for item in fidelity),
           f"time-driven Geometry Nodes was not blocked for a finite cache decision: {fidelity}")
    expect(any(issue.object_name == procedural.name and "Geometry Conversion" in issue.message
               for issue in validation.result().issues),
           "blocking Geometry Nodes route did not reach Web Checks")
    procedural_module = __import__(
        f"{PACKAGE}.procedural", fromlist=["analyze_scene"]
    )
    record = next(item for item in procedural_module.analyze_scene(
        bpy.context.scene, full=False,
    )["procedural"]
                  if item["object"] == procedural.name)
    expect(len(record["samples"]) == 1 and "topologyChanged" in record["sourceDelta"],
           f"live Geometry Nodes report omitted its current topology delta: {record}")

    # Exhaustive publication is bounded by deterministic object-frame work,
    # not by a 120-frame timeline shortcut.  Evaluate two static Scene-Time
    # hosts over the untouched Blender Splash range and prove that the audit
    # sets each scene frame once, then snapshots every admitted object against
    # that shared dependency graph.
    batched_procedural = make_cube("Batched Procedural Sculpture")
    batched_modifier = batched_procedural.modifiers.new(
        "Website Procedural", "NODES",
    )
    batched_modifier.node_group = node_tree
    audit_scene = bpy.context.scene
    audit_old_start = audit_scene.frame_start
    audit_old_end = audit_scene.frame_end
    audit_old_frame = audit_scene.frame_current
    audit_scene.frame_start, audit_scene.frame_end = 1, 210
    audit_scene.frame_set(1)
    audit_frame_calls = []
    original_set_audit_frame = procedural_module._set_audit_frame

    def counting_set_audit_frame(scene, frame):
        audit_frame_calls.append(int(frame))
        original_set_audit_frame(scene, frame)

    procedural_module._set_audit_frame = counting_set_audit_frame
    try:
        batched_report = procedural_module.analyze_scene(
            audit_scene, full=True,
            objects=[procedural, batched_procedural],
        )
    finally:
        procedural_module._set_audit_frame = original_set_audit_frame
        audit_scene.frame_start, audit_scene.frame_end = (
            audit_old_start, audit_old_end,
        )
        audit_scene.frame_set(audit_old_frame)
    batched_records = {
        item["object"]: item for item in batched_report["procedural"]
    }
    expect(
        all(
            batched_records[name]["sampledExhaustively"]
            and len(batched_records[name]["samples"]) == 210
            and batched_records[name]["route"] == "Realize"
            for name in (procedural.name, batched_procedural.name)
        ),
        f"210-frame static Scene-Time hosts were not exhaustively realized: "
        f"{batched_records}",
    )
    expect(
        audit_frame_calls == [*range(1, 211), 1],
        f"procedural audit was not one scene-major traversal: "
        f"{audit_frame_calls[:8]} ... {audit_frame_calls[-8:]}",
    )
    expect(
        batched_report["limits"]["maxAuditSnapshots"]
        == procedural_module.MAX_AUDIT_SNAPSHOTS,
        f"procedural work budget was not reported: {batched_report['limits']}",
    )

    # A range whose admitted object-frame product crosses the budget remains
    # blocked after endpoint/current witnesses. Matching samples can reject,
    # but they can never bless an unvisited timeline as static.
    audit_scene.frame_start, audit_scene.frame_end = 1, 3001
    audit_scene.frame_set(1)
    over_budget_report = procedural_module.analyze_scene(
        audit_scene, full=True,
        objects=[procedural, batched_procedural],
    )
    audit_scene.frame_start, audit_scene.frame_end = (
        audit_old_start, audit_old_end,
    )
    audit_scene.frame_set(audit_old_frame)
    for item in over_budget_report["procedural"]:
        expect(
            not item["sampledExhaustively"]
            and item["route"] == "Block"
            and "6002 evaluated object-frame snapshots" in item["reason"]
            and "exceeds Blendlink" in item["reason"],
            f"over-budget temporal graph escaped the deterministic gate: {item}",
        )

    # Phase 0c/0d. Three findings, one of which refuses, and the refusal must
    # key on measured variation: ellie's two shape-key droppers are constant
    # and refusing them would refuse a correct export.
    sk_old_start = bpy.context.scene.frame_start
    sk_old_end = bpy.context.scene.frame_end
    sk_old_frame = bpy.context.scene.frame_current
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 10
    bpy.context.scene.frame_set(1)

    def shape_keyed_cube(name, *, value, muted=False):
        obj = make_cube(name)
        obj.shape_key_add(name="Basis", from_mix=False)
        key = obj.shape_key_add(name="Push", from_mix=False)
        for point in key.data:
            point.co.z += 0.5
        key.value = value
        key.mute = muted
        return obj, key

    def mask_half(obj):
        group = obj.vertex_groups.new(name="Keep")
        group.add([0, 1, 2, 3], 1.0, "REPLACE")
        modifier = obj.modifiers.new("Collar Mask", "MASK")
        modifier.vertex_group = "Keep"
        return modifier

    def shape_key_record(name, *, full, objects=None):
        return next(
            item for item in procedural_module.analyze_scene(
                bpy.context.scene, full=full, objects=objects,
            )["shapeKeys"]
            if item["object"] == name
        )

    # 1. Keys with no modifier survive, POSITION comes from the Basis cage, and
    #    an undeformed mesh matches that cage — so nothing is reported wrong.
    kept, _kept_key = shape_keyed_cube("Shape Key Kept", value=0.4)
    kept_record = shape_key_record(kept.name, full=True)
    expect(
        kept_record["positionSource"] == "basis"
        and kept_record["severity"] == "info"
        and kept_record["valueProof"] == "notRequired"
        and [item["transport"] for item in kept_record["keys"]]
        == ["skipped", "morphTarget"]
        and kept_record["basisDisplacement"] < 1e-6,
        f"a preserved shape key was not reported as a morph target: {kept_record}",
    )

    # 2. A non-zero CONSTANT value that the applied path drops must warn, never
    #    refuse: to_mesh bakes the constant blend into the exported positions,
    #    so nothing shipped is wrong. The culprit modifier is named by causal
    #    isolation, not inferred from its type.
    frozen, _frozen_key = shape_keyed_cube("Shape Key Frozen", value=0.6)
    frozen_mask = mask_half(frozen)
    frozen_record = shape_key_record(frozen.name, full=True)
    frozen_key_record = next(
        item for item in frozen_record["keys"] if item["name"] == "Push"
    )
    expect(
        frozen_record["severity"] == "warn"
        and frozen_record["positionSource"] == "evaluated"
        and frozen_record["restoredBy"] == [frozen_mask.name]
        and frozen_record["valueProof"] == "static"
        and frozen_key_record["transport"] == "frozen"
        and frozen_key_record["animation"] == "constant"
        and "lostDisplacement" not in frozen_key_record
        and "nothing shipped is wrong" in frozen_record["message"]
        and f'"{frozen_mask.name}" restores them' in frozen_record["message"],
        f"a constant dropped shape key was not reported honestly: {frozen_record}",
    )

    # 3. The same drop with a value that ACTUALLY animates is silently wrong and
    #    must refuse, naming the object, the metres lost, and the frozen value.
    animated, animated_key = shape_keyed_cube("Shape Key Animated", value=0.0)
    animated_mask = mask_half(animated)
    animated_key.value = 0.0
    animated_key.keyframe_insert("value", frame=1)
    animated_key.value = 1.0
    animated_key.keyframe_insert("value", frame=10)
    animated_record = shape_key_record(animated.name, full=True)
    animated_key_record = next(
        item for item in animated_record["keys"] if item["name"] == "Push"
    )
    expect(
        animated_record["severity"] == "refuse"
        and animated_record["valueProof"] == "exhaustive"
        and animated_record["frozenAtFrame"] == 0
        and animated_key_record["animation"] == "varying"
        and animated_key_record["valueRange"] == [0.0, 1.0]
        and animated_key_record["lostDisplacement"] > 0.0
        and "animates between 0.000 and 1.000" in animated_record["message"]
        and "mm of authored motion" in animated_record["message"]
        and f'"{animated_mask.name}" restores them' in animated_record["message"],
        f"an animated dropped shape key escaped the refusal: {animated_record}",
    )

    # 4. The live addon never moves the timeline, so it can warn but never
    #    refuse — the same asymmetry the procedural audit already relies on.
    #    Scoped to this one object so the frame calls counted here are the
    #    shape-key sampler's own and not the procedural audit's traversal.
    live_frame_calls = []
    live_original_set_audit_frame = procedural_module._set_audit_frame

    def live_counting_set_audit_frame(scene, frame):
        live_frame_calls.append(int(frame))
        live_original_set_audit_frame(scene, frame)

    procedural_module._set_audit_frame = live_counting_set_audit_frame
    try:
        live_record = shape_key_record(
            animated.name, full=False, objects=[animated],
        )
    finally:
        procedural_module._set_audit_frame = live_original_set_audit_frame
    expect(
        live_record["severity"] == "warn"
        and live_record["valueProof"] == "currentFrame"
        and live_frame_calls == [1, 1]
        and "constancy is unproven here" in live_record["message"],
        f"the live shape-key report refused on an unproven sample: "
        f"{live_record} {live_frame_calls}",
    )

    # 5. A muted key is dropped by Blender's own skip_sk AND contributes nothing
    #    to the evaluated mesh, so it is not a loss and must not be reported.
    muted, _muted_key = shape_keyed_cube("Shape Key Muted", value=1.0, muted=True)
    mask_half(muted)
    muted_record = shape_key_record(muted.name, full=True)
    expect(
        muted_record["severity"] == "info"
        and all(item["transport"] == "skipped" for item in muted_record["keys"])
        and "none is lost" in muted_record["message"],
        f"a muted shape key was reported as a loss: {muted_record}",
    )

    # 6. Phase 0d. Preserve Volume and Bone Envelopes warn; a plain ARMATURE
    #    emits no record at all, so a clean scene ships an empty section.
    bpy.ops.object.armature_add()
    skin_rig = bpy.context.active_object
    skin_rig.name = "Linearisation Rig"
    dqs_mesh = make_cube("Preserve Volume Mesh")
    dqs_modifier = dqs_mesh.modifiers.new("Armature", "ARMATURE")
    dqs_modifier.object = skin_rig
    dqs_modifier.use_deform_preserve_volume = True
    envelope_mesh = make_cube("Bone Envelope Mesh")
    envelope_modifier = envelope_mesh.modifiers.new("Armature", "ARMATURE")
    envelope_modifier.object = skin_rig
    envelope_modifier.use_bone_envelopes = True
    plain_mesh = make_cube("Linear Skin Mesh")
    plain_mesh.modifiers.new("Armature", "ARMATURE").object = skin_rig
    skin_report = procedural_module.analyze_scene(bpy.context.scene, full=False)
    skin_records = {
        item["object"]: item for item in skin_report["skinApproximation"]
    }
    expect(
        plain_mesh.name not in skin_records,
        f"a plain linear ARMATURE produced a needless record: {skin_records}",
    )
    expect(
        skin_records[dqs_mesh.name]["severity"] == "warn"
        and skin_records[dqs_mesh.name]["preserveVolume"] is True
        and skin_records[dqs_mesh.name]["boneEnvelopes"] is False
        and skin_records[dqs_mesh.name]["skinned"] is True
        and skin_records[dqs_mesh.name]["armature"] == skin_rig.name
        and skin_records[dqs_mesh.name]["exporterSelected"] == "Armature"
        and "linear blend skinning only"
        in skin_records[dqs_mesh.name]["message"],
        f"Preserve Volume linearisation was not reported: "
        f"{skin_records.get(dqs_mesh.name)}",
    )
    expect(
        skin_records[envelope_mesh.name]["boneEnvelopes"] is True
        and "primitive_extract.py:1557"
        in skin_records[envelope_mesh.name]["message"],
        f"Bone Envelopes had no exported-form report: "
        f"{skin_records.get(envelope_mesh.name)}",
    )
    # The exporter's {type: modifier} dict keeps only the LAST ARMATURE, so a
    # flag on an earlier one changes nothing that ships.
    shadowed = make_cube("Shadowed Preserve Volume Mesh")
    shadowed_first = shadowed.modifiers.new("Armature Preserve", "ARMATURE")
    shadowed_first.object = skin_rig
    shadowed_first.use_deform_preserve_volume = True
    shadowed.modifiers.new("Armature Linear", "ARMATURE").object = skin_rig
    shadowed_record = next(
        item for item in procedural_module.analyze_scene(
            bpy.context.scene, full=False,
        )["skinApproximation"]
        if item["object"] == shadowed.name
    )
    expect(
        shadowed_record["severity"] == "info"
        and shadowed_record["exporterSelected"] == "Armature Linear"
        and shadowed_record["preserveVolume"] is False
        and [item["exporterSelected"] for item in shadowed_record["modifiers"]]
        == [False, True]
        and "nothing is approximated" in shadowed_record["message"],
        f"the exporter's last-ARMATURE selection was misreported: "
        f"{shadowed_record}",
    )

    # 7. The additive contract: the historical keys are untouched and the two
    #    new ones are always arrays.
    additive_report = procedural_module.analyze_scene(
        bpy.context.scene, full=False,
    )
    expect(
        {"procedural", "instances", "materials", "limits", "shapeKeys",
         "skinApproximation", "deformerLowerings"} <= set(additive_report)
        and isinstance(additive_report["shapeKeys"], list)
        and isinstance(additive_report["skinApproximation"], list)
        and additive_report["deformerLowerings"]["verified"] is False,
        f"analyze_scene lost or renamed a diagnostics section: "
        f"{sorted(additive_report)}",
    )

    run_deformer_lowering_tests(procedural_module)

    bpy.context.scene.frame_start, bpy.context.scene.frame_end = (
        sk_old_start, sk_old_end,
    )
    bpy.context.scene.frame_set(sk_old_frame)

    # A driver can be an authoring constraint without being timeline
    # animation. Cube Diorama uses this exact shape for Book Thickness: one
    # static custom property drives a Geometry Nodes input. A long scene range
    # must not turn that into a false 10,000-frame cache blocker.
    static_driver_object = make_cube("Static Driver Geometry")
    static_driver_tree = bpy.data.node_groups.new(
        "Static Driver Pass Through", "GeometryNodeTree",
    )
    static_driver_tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    static_driver_tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    static_driver_input = static_driver_tree.nodes.new("NodeGroupInput")
    static_driver_output = static_driver_tree.nodes.new("NodeGroupOutput")
    static_driver_tree.links.new(
        static_driver_input.outputs["Geometry"],
        static_driver_output.inputs["Geometry"],
    )
    static_driver_modifier = static_driver_object.modifiers.new(
        "Static Driver Pass Through", "NODES",
    )
    static_driver_modifier.node_group = static_driver_tree
    static_driver_object["Book Thickness"] = 0.2
    static_driver_object["Driven Thickness"] = 0.2
    static_curve = static_driver_object.driver_add('["Driven Thickness"]')
    static_variable = static_curve.driver.variables.new()
    static_variable.name = "Book_Thickness"
    static_variable.type = "SINGLE_PROP"
    static_variable.targets[0].id = static_driver_object
    static_variable.targets[0].data_path = '["Book Thickness"]'
    static_curve.driver.expression = "Book_Thickness"
    static_old_start = bpy.context.scene.frame_start
    static_old_end = bpy.context.scene.frame_end
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 10000
    static_driver_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    static_driver_record = next(
        item for item in static_driver_report["procedural"]
        if item["object"] == static_driver_object.name
    )
    expect(static_driver_record["route"] == "Realize"
           and not static_driver_record["blocking"]
           and "estimatedMorphBytes" not in static_driver_record,
           f"static authoring driver became false timeline animation: {static_driver_record}")
    static_curve.driver.expression = "frame"
    time_driver_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    time_driver_record = next(
        item for item in time_driver_report["procedural"]
        if item["object"] == static_driver_object.name
    )
    expect(time_driver_record["route"] == "Block"
           and "exceeds Blendlink" in time_driver_record["reason"],
           f"frame-dependent driver escaped the finite timeline gate: {time_driver_record}")
    static_curve.driver.expression = "Book_Thickness"
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = static_old_start, static_old_end

    # Blender 5.x migrates legacy Auto Smooth to a static Geometry Nodes
    # compatibility group.  An ordinary Object transform action remains core
    # glTF animation and must not turn that local evaluated mesh into a false
    # morph/VAT cache candidate.  This reproduces the official Blender 2.82
    # splash scene's trainDoorL topology (Solidify + Auto Smooth + location).
    transform_host = make_cube("Transform Animated Auto Smooth Host")
    transform_host.modifiers.new("Legacy Solidify", "SOLIDIFY")
    transform_tree = bpy.data.node_groups.new(
        "Auto Smooth Compatibility", "GeometryNodeTree",
    )
    transform_tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    transform_tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    transform_input = transform_tree.nodes.new("NodeGroupInput")
    transform_output = transform_tree.nodes.new("NodeGroupOutput")
    transform_tree.links.new(
        transform_input.outputs["Geometry"], transform_output.inputs["Geometry"],
    )
    transform_tree.nodes.new("GeometryNodeSetShadeSmooth")
    transform_modifier = transform_host.modifiers.new("Auto Smooth", "NODES")
    transform_modifier.node_group = transform_tree
    transform_host.location.x = 0.0
    transform_host.keyframe_insert(data_path="location", frame=23)
    transform_host.location.x = 2.0
    transform_host.keyframe_insert(data_path="location", frame=270)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 23, 270
    expect(not procedural_module._time_dependent_local_geometry(transform_host),
           "portable Object location animation was coupled to local Geometry Nodes evaluation")
    expect(procedural_module.automatic_dynamic_reason(transform_host) is not None,
           "separating local geometry accidentally removed realtime transform safety")
    transform_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    transform_record = next(
        item for item in transform_report["procedural"]
        if item["object"] == transform_host.name
    )
    expect(transform_record["route"] == "Realize"
           and not transform_record["blocking"]
           and "estimatedMorphBytes" not in transform_record
           and "core glTF transform animation" in transform_record["reason"],
           f"transform-only Auto Smooth host became a false cache: {transform_record}")

    nla_transform_modifier = nla_mesh.modifiers.new(
        "Auto Smooth NLA Compatibility", "NODES",
    )
    nla_transform_modifier.node_group = transform_tree
    expect(not procedural_module._time_dependent_local_geometry(nla_mesh),
           "portable NLA transform animation was coupled to local Geometry Nodes evaluation")
    nla_transform_hidden = nla_mesh.hide_render
    nla_mesh.hide_render = False
    nla_transform_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    nla_transform_record = next(
        item for item in nla_transform_report["procedural"]
        if item["object"] == nla_mesh.name
    )
    nla_mesh.hide_render = nla_transform_hidden
    expect(nla_transform_record["route"] == "Realize"
           and not nla_transform_record["blocking"]
           and "core glTF transform animation" in nla_transform_record["reason"],
           f"NLA-only transform host became a false cache: {nla_transform_record}")

    # The separation is conditional on a local-space graph. A Self Object node
    # can expose the owner's moving transform to Geometry Nodes and therefore
    # keeps the finite-range audit conservative.
    self_object_node = transform_tree.nodes.new("GeometryNodeSelfObject")
    self_dependent_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    self_dependent_record = next(
        item for item in self_dependent_report["procedural"]
        if item["object"] == transform_host.name
    )
    expect(self_dependent_record["route"] == "Realize"
           and not self_dependent_record["blocking"]
           and self_dependent_record["sampledExhaustively"]
           and len(self_dependent_record["samples"]) == 248,
           f"Self Object transform dependency was not proven across its finite range: "
           f"{self_dependent_record}")
    transform_tree.nodes.remove(self_object_node)

    # Non-transform Object animation is deliberately different: custom
    # properties and modifier input paths can drive the evaluated graph and
    # must retain the bounded timeline gate.
    transform_host["blendlink_geometry_control"] = 0.0
    transform_host.keyframe_insert(
        data_path='["blendlink_geometry_control"]', frame=23,
    )
    transform_host["blendlink_geometry_control"] = 1.0
    transform_host.keyframe_insert(
        data_path='["blendlink_geometry_control"]', frame=270,
    )
    expect(procedural_module._time_dependent_local_geometry(transform_host),
           "non-transform Object animation escaped Geometry Nodes dependency analysis")
    controlled_report = procedural_module.analyze_scene(
        bpy.context.scene, full=True,
    )
    controlled_record = next(
        item for item in controlled_report["procedural"]
        if item["object"] == transform_host.name
    )
    expect(controlled_record["route"] == "Realize"
           and not controlled_record["blocking"]
           and controlled_record["sampledExhaustively"]
           and len(controlled_record["samples"]) == 248,
           f"non-transform Geometry Nodes control was not proven across its finite range: "
           f"{controlled_record}")
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = static_old_start, static_old_end

    # Attribute/material channels can animate with fixed vertices and indices.
    # They must have their own evidence instead of being mislabeled a safe still.
    appearance_before = procedural_module._mesh_snapshot(
        procedural.data, bpy.context.scene.frame_current,
    )
    color_attribute = procedural.data.attributes.new(
        "Website Tint", type="FLOAT_COLOR", domain="CORNER",
    )
    color_attribute.data[0].color = (0.1, 0.7, 0.2, 1.0)
    appearance_after = procedural_module._mesh_snapshot(
        procedural.data, bpy.context.scene.frame_current,
    )
    expect(appearance_before["topologyHash"] == appearance_after["topologyHash"]
           and appearance_before["positionHash"] == appearance_after["positionHash"]
           and appearance_before["appearanceHash"] != appearance_after["appearanceHash"],
           "procedural appearance evidence ignored a fixed-topology color attribute")

    animated_parent = bpy.data.objects.new("Animated Dependency Parent", None)
    bpy.context.scene.collection.objects.link(animated_parent)
    dependency_child = bpy.data.objects.new("Indirect Animated Dependency", None)
    bpy.context.scene.collection.objects.link(dependency_child)
    dependency_child.parent = animated_parent
    animated_parent.location.x = 0
    animated_parent.keyframe_insert(data_path="location", frame=1)
    animated_parent.location.x = 1
    animated_parent.keyframe_insert(data_path="location", frame=2)
    indirect_sources = procedural_module._animated_dependencies(
        bpy.context.scene, [dependency_child.name], [],
    )
    expect(animated_parent.name in indirect_sources,
           f"animated dependency ancestry was not detected: {indirect_sources}")

    # Shared Blender mesh data saves geometry bytes but not draw calls. The
    # diagnostic keeps stable member IDs and states the optional GPU-batch win.
    tree_a = make_cube("Tree A")
    tree_b = bpy.data.objects.new("Tree B", tree_a.data)
    bpy.context.scene.collection.objects.link(tree_b)
    tree_a["blendlink_id"], tree_b["blendlink_id"] = "tree-a", "tree-b"
    instance_report = __import__(
        f"{PACKAGE}.procedural", fromlist=["analyze_scene"]
    ).analyze_scene(bpy.context.scene, full=False)["instances"]
    trees = next(group for group in instance_report if group["meshData"] == tree_a.data.name)
    expect(trees["eligible"] and trees["drawCallsSeparate"] == 2
           and trees["drawCallsInstanced"] == 1,
           f"shared-mesh consequence was not explicit: {trees}")
    expect({member.get("id") for member in trees["members"]} == {"tree-a", "tree-b"},
           f"instance diagnostic lost stable member IDs: {trees}")
    tree_a.data.materials.append(bpy.data.materials.new("Tree Bark"))
    tree_a.data.materials.append(bpy.data.materials.new("Tree Leaves"))
    multi_report = __import__(
        f"{PACKAGE}.procedural", fromlist=["analyze_scene"]
    ).analyze_scene(bpy.context.scene, full=False)["instances"]
    multi_trees = next(group for group in multi_report if group["meshData"] == tree_a.data.name)
    expect(not multi_trees["eligible"] and any(
        "multiple glTF primitives" in reason for reason in multi_trees["reasons"]
    ), f"multi-primitive mesh was incorrectly offered to the single-mesh adapter: {multi_trees}")

    # A real Scene Time -> Mesh Line graph proves changing vertex/index counts
    # across the complete finite range. It must block rather than claim that a
    # core glTF morph cache can represent changing topology.
    topology_object = make_cube("Growing Line")
    topology_tree = bpy.data.node_groups.new("Changing Topology", "GeometryNodeTree")
    topology_tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    topology_output = topology_tree.nodes.new("NodeGroupOutput")
    topology_time = topology_tree.nodes.new("GeometryNodeInputSceneTime")
    topology_line = topology_tree.nodes.new("GeometryNodeMeshLine")
    topology_tree.links.new(topology_time.outputs["Frame"], topology_line.inputs["Count"])
    topology_tree.links.new(topology_line.outputs["Mesh"], topology_output.inputs["Geometry"])
    topology_modifier = topology_object.modifiers.new("Changing Topology", "NODES")
    topology_modifier.node_group = topology_tree
    old_start, old_end = bpy.context.scene.frame_start, bpy.context.scene.frame_end
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 3
    full_report = __import__(
        f"{PACKAGE}.procedural", fromlist=["analyze_scene"]
    ).analyze_scene(bpy.context.scene, full=True)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = old_start, old_end
    topology_record = next(item for item in full_report["procedural"]
                           if item["object"] == topology_object.name)
    expect(topology_record["sampledExhaustively"] and topology_record["topology"] == "changing"
           and topology_record["route"] == "Block",
           f"changing topology was not honestly blocked after a full finite audit: {topology_record}")

    # Shape-key animation lives on Mesh.shape_keys, not the Object or Mesh
    # animation_data. A pass-through GN modifier must still enter the finite
    # cache audit instead of being mistaken for a safe still realization.
    shape_object = make_cube("Shape Driven Geometry")
    shape_tree = bpy.data.node_groups.new("Shape Driven Pass Through", "GeometryNodeTree")
    shape_tree.interface.new_socket(
        name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry",
    )
    shape_tree.interface.new_socket(
        name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry",
    )
    shape_input = shape_tree.nodes.new("NodeGroupInput")
    shape_output = shape_tree.nodes.new("NodeGroupOutput")
    shape_tree.links.new(shape_input.outputs["Geometry"], shape_output.inputs["Geometry"])
    shape_modifier = shape_object.modifiers.new("Shape Driven Pass Through", "NODES")
    shape_modifier.node_group = shape_tree
    shape_object.shape_key_add(name="Basis")
    shape_key = shape_object.shape_key_add(name="Web Motion")
    shape_key.data[0].co.x += 0.5
    shape_key.value = 0.0
    shape_key.keyframe_insert(data_path="value", frame=1)
    shape_key.value = 1.0
    shape_key.keyframe_insert(data_path="value", frame=2)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 2
    shape_report = __import__(
        f"{PACKAGE}.procedural", fromlist=["analyze_scene"]
    ).analyze_scene(bpy.context.scene, full=True)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = old_start, old_end
    shape_record = next(item for item in shape_report["procedural"]
                        if item["object"] == shape_object.name)
    expect(shape_record["sampledExhaustively"] and shape_record["topology"] == "deforming"
           and shape_record["route"] == "Cache" and shape_record["blocking"],
           f"shape-key-driven GN deformation escaped the finite cache gate: {shape_record}")

    bpy.ops.object.camera_add()
    web_camera = bpy.context.active_object
    web_camera.name = "Hero Camera"
    bpy.context.scene.camera = web_camera
    camera_procedural = make_cube("Camera Culled Forest")
    camera_tree = bpy.data.node_groups.new("Camera Dependent", "GeometryNodeTree")
    camera_tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    camera_tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    camera_input = camera_tree.nodes.new("NodeGroupInput")
    camera_output = camera_tree.nodes.new("NodeGroupOutput")
    camera_tree.links.new(camera_input.outputs["Geometry"], camera_output.inputs["Geometry"])
    camera_tree.nodes.new("GeometryNodeInputActiveCamera")
    camera_modifier = camera_procedural.modifiers.new("Camera Dependent", "NODES")
    camera_modifier.node_group = camera_tree
    validation.recompute(bpy.context.scene)
    camera_fidelity = [item for item in validation.result().fidelity
                       if item.object_name == camera_procedural.name]
    expect(any(item.route == "Block" and "orbiting website camera" in item.detail
               for item in camera_fidelity),
           f"camera-dependent generated geometry was not protected: {camera_fidelity}")
    lod_fidelity = [item for item in validation.result().fidelity
                    if item.source == "LOD chain: Rock"]
    expect(lod_fidelity and "one of 2 levels visible" in lod_fidelity[0].detail
           and "2/2 levels have stable IDs" in lod_fidelity[0].detail,
           f"LOD runtime/draw-call consequence was not explained: {lod_fidelity}")
    focus = bpy.data.objects.new("Hero Focus", None)
    bpy.context.scene.collection.objects.link(focus)
    select_only(crate)
    validation._state["dirty"] = False
    bpy.ops.blendlink.set_initial_visibility(visible=False)
    expect(crate["blendlink_active"] is False and validation.is_dirty(),
           "initial web visibility did not invalidate conversion checks")
    validation._state["dirty"] = False
    bpy.ops.blendlink.set_shadows(mode="BOTH")
    expect(crate["blendlink_cast_shadow"] is True
           and crate["blendlink_receive_shadow"] is True
           and validation.is_dirty(),
           "portable shadow intent did not invalidate conversion checks")
    poster = bpy.data.images.new("Hero Poster", width=64, height=32)
    poster_material = bpy.data.materials.new("Poster Material")
    bakelib.ensure_shader_node_tree(poster_material)
    poster_node = poster_material.node_tree.nodes.new("ShaderNodeTexImage")
    poster_node.image = poster
    crate.data.materials.append(poster_material)
    bpy.ops.blendlink.set_texture_max_size(image_name=poster.name, max_size="512")
    expect(poster["blendlink_max_size"] == 512, "published texture maximum was not authored")
    bpy.ops.blendlink.set_texture_compression(image_name=poster.name, mode="UASTC")
    expect(poster["blendlink_texture_compression"] == "uastc",
           "artist-friendly texture compression override was not authored")
    expect(any(image == poster for image, _material in ui._images_for_object(crate)),
           "selected-object texture inventory missed a material image")
    with tempfile.TemporaryDirectory(prefix="blendlink-linked-image-") as linked_image_dir:
        library_path = Path(linked_image_dir) / "linked-image.blend"
        source_image = bpy.data.images.new("Linked Publish Texture", width=8, height=8)
        bpy.data.libraries.write(str(library_path), {source_image})
        bpy.data.images.remove(source_image)
        with bpy.data.libraries.load(str(library_path), link=True) as (data_from, data_to):
            data_to.images = ["Linked Publish Texture"]
        linked_image = bpy.data.images.get("Linked Publish Texture")
        expect(linked_image is not None and not linked_image.is_editable,
               "linked-image fixture did not create read-only Blender data")
        linked_results = []
        for operation in (
            lambda: bpy.ops.blendlink.set_texture_max_size(
                image_name=linked_image.name, max_size="512",
            ),
            lambda: bpy.ops.blendlink.set_texture_compression(
                image_name=linked_image.name, mode="UASTC",
            ),
        ):
            try:
                linked_results.append(operation())
            except RuntimeError as error:
                expect("linked/read-only" in str(error),
                       f"linked image failure was not actionable: {error}")
                linked_results.append({"CANCELLED"})
        expect(linked_results == [{"CANCELLED"}, {"CANCELLED"}],
               "linked image publish controls attempted a read-only write")
        bpy.data.images.remove(linked_image)
    select_only(crate, rock)
    bpy.ops.blendlink.setup_website_export()
    project = bpy.context.scene.blendlink_project
    expect(project.configured, "website export setup did not configure the scene")
    project.main_camera = None
    result = bpy.ops.blendlink.use_website_camera(camera_name=web_camera.name)
    expect(result == {"FINISHED"} and project.main_camera == web_camera,
           "website-camera remedy did not designate the existing Scene Camera")
    expect(len(project.atlases) == 1 and project.atlases[0].atlas_id == "main",
           "setup must create exactly one undeletable Main atlas")
    expect(project.atlases[0].bake_output == "LIGHTING",
           "new Main atlas must recommend the detail-preserving lighting bake")
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["schemaVersion"] == 1 and recipe["presentation"] == "hybrid",
           f"canonical recipe is wrong: {recipe}")
    expect(recipe["camera"]["objectId"] == web_camera["blendlink_id"],
           "scene camera did not become the rename-stable presentation camera")
    expect([frame["name"] for frame in recipe["camera"]["compositions"]]
           == ["Desktop", "Mobile"], "responsive composition defaults are missing")
    expect(recipe["camera"]["framing"] == "authored"
           and recipe["fog"]["mode"] == "application",
           "camera/fog defaults must preserve the authored page until explicitly enabled")
    expect(recipe["atlases"][0]["bakeOutput"] == "lighting",
           "Main atlas bake output was not stored in the canonical recipe")
    # An unmapped Bake Output must refuse, not quietly publish Appearance.
    # Blender's RNA rejects an unknown enum string on assignment, so the only
    # way to reach -- and the only way to test -- the mapping's failure branch
    # is to call it directly, exactly as a commit that grows the enum without
    # extending the table would. The coverage assertion is what makes that
    # commit safe: it fails here rather than shipping a flattened bake.
    atlas_enum_identifiers = {
        item.identifier
        for item in project.atlases[0].bl_rna.properties["bake_output"].enum_items
    }
    expect(set(props._BAKE_OUTPUT_RECIPE_VALUES) == atlas_enum_identifiers,
           "Bake Output enum and its portable spelling drifted apart; extend "
           f"props._BAKE_OUTPUT_RECIPE_VALUES to cover {atlas_enum_identifiers}")
    try:
        props._recipe_bake_output("Main", "SURFACE")
    except ValueError as error:
        expect("Main" in str(error) and "'SURFACE'" in str(error)
               and "LIGHTING" in str(error) and "APPEARANCE" in str(error),
               f"unmapped Bake Output refusal was not actionable: {error}")
    else:
        raise AssertionError("unmapped atlas Bake Output silently became Appearance")
    expect(not ops.BLENDLINK_OT_setup_website_export.poll(bpy.context)
           and ops.BLENDLINK_OT_add_composition.poll(bpy.context)
           and ops.BLENDLINK_OT_add_state.poll(bpy.context),
           "configured scenes exposed destructive setup or hid valid collection actions")

    # --- portable website Components: typed editors, stable targets, recipe ---
    bloom = project.components.add()
    bloom.component_id = "component-bloom"
    bloom.component_type = "blendlink.bloom"
    bloom.target_kind = "SCENE"
    bloom.bloom_mode = "emissive-objects"
    bloom.intensity = 0.85
    bloom.threshold = 1.25
    bloom.radius = 0.3

    hover = project.components.add()
    hover.component_id = "component-hover"
    hover.component_type = "blendlink.hover"
    hover.target_object = crate
    hover.hover_scale = 1.16
    hover.duration = 0.2

    website_screen = make_plane("Website Monitor Screen")
    website_screen.data.materials.clear()
    website_screen.data.materials.append(
        bpy.data.materials.new("Website Monitor Fallback")
    )
    website_screen["blendlink_dynamic"] = 1
    website_surface = project.components.add()
    website_surface.component_id = "component-website-surface"
    website_surface.component_type = "blendlink.website-surface"
    website_surface.target_object = website_screen
    website_surface.website_surface_name = "monitor-screen"
    website_surface.website_surface_color_treatment = "display"

    component_records = props.serialized_components(project)
    bloom_record = component_records[0]
    expect(bloom_record["id"] == "component-bloom"
           and bloom_record["type"] == "blendlink.bloom"
           and bloom_record["schemaVersion"] == 1
           and bloom_record["enabled"] is True
           and bloom_record["target"] == {"kind": "scene"}
           and bloom_record["values"]["mode"] == "emissive-objects"
           and abs(bloom_record["values"]["intensity"] - 0.85) < 1e-5
           and abs(bloom_record["values"]["threshold"] - 1.25) < 1e-5
           and abs(bloom_record["values"]["radius"] - 0.3) < 1e-5,
           f"scene Bloom did not serialize as portable intent: {bloom_record}")
    crate_component_id = crate.get("blendlink_id")
    expect(isinstance(crate_component_id, str) and crate_component_id,
           "object Component target did not receive a stable Blendlink identity")
    hover_record = component_records[1]
    expect(hover_record["type"] == "blendlink.hover"
           and hover_record["target"] == {
               "kind": "object", "objectId": crate_component_id,
               "objectName": crate.name,
           }
           and abs(hover_record["values"]["scale"] - 1.16) < 1e-5
           and abs(hover_record["values"]["duration"] - 0.2) < 1e-5,
           f"object Hover did not serialize its stable target and values: {hover_record}")
    website_surface_record = component_records[2]
    expect(
        website_surface_record["type"] == "blendlink.website-surface"
        and website_surface_record["target"]["objectId"]
        == website_screen["blendlink_id"]
        and website_surface_record["values"] == {
            "name": "monitor-screen", "colorTreatment": "display",
        },
        f"Website Surface did not serialize its stable target and values: {website_surface_record}",
    )
    exporter.validate_website_surface_components(
        {"components": [website_surface_record]}, bpy.context.scene,
    )

    # Website pixels use UV0 as their application-owned canvas address. Test
    # the artist workspace and add-on-free compiler independently so neither
    # path can silently crop, repeat, or collapse those pixels.
    website_uv0 = website_screen.data.uv_layers[0]
    website_uv0_original = tuple(tuple(item.uv) for item in website_uv0.data)
    for item in website_uv0.data:
        item.uv.x = 0.5
    collapsed_surface_issues = component_validation.validate_component(
        project, website_surface, scene=bpy.context.scene,
    )
    expect(any(
        issue.code == "website_surface_uv0_degenerate"
        and issue.blocking
        and "UV Editor" in issue.message
        and "0-1 square" in issue.message
        for issue in collapsed_surface_issues
    ), f"collapsed Website Surface UV0 was not actionable: {collapsed_surface_issues}")
    try:
        props.serialized_components(project)
    except ValueError as error:
        expect(
            "collapsed in U" in str(error)
            and "UV Editor" in str(error)
            and "0-1 square" in str(error),
            f"Website Surface serializer blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("Website Surface serializer accepted collapsed UV0")
    website_surface.enabled = False
    disabled_surface_record = next(
        record for record in props.serialized_components(project)
        if record["id"] == website_surface.component_id
    )
    exporter.validate_website_surface_components(
        {"components": [disabled_surface_record]}, bpy.context.scene,
    )
    expect(
        disabled_surface_record["enabled"] is False
        and disabled_surface_record["values"]["name"] == "monitor-screen"
        and any(
            issue.code == "website_surface_uv0_degenerate" and not issue.blocking
            for issue in component_validation.validate_component(
                project, website_surface, scene=bpy.context.scene,
            )
        ),
        "disabled Website Surface with unfinished UV0 did not remain round-trippable",
    )
    for item, coordinate in zip(website_uv0.data, website_uv0_original):
        item.uv = coordinate
    website_surface.enabled = True

    outside_coordinate = tuple(website_uv0.data[0].uv)
    website_uv0.data[0].uv.x = -0.25
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record]}, bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "leaves the ordinary 0-1 square" in str(error)
            and "UV Editor" in str(error),
            f"compiler out-of-range Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted out-of-range Website Surface UV0")
    website_uv0.data[0].uv = outside_coordinate

    for item in website_uv0.data:
        item.uv = (item.uv.x * 0.8 + 0.1, item.uv.y * 0.8 + 0.1)
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record]}, bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "does not span the full 0-1 square" in str(error)
            and "cropped" in str(error),
            f"compiler cropped Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted cropped Website Surface UV0")
    for item, coordinate in zip(website_uv0.data, website_uv0_original):
        item.uv = coordinate

    collinear_denominator = max(1, len(website_uv0.data) - 1)
    for index, item in enumerate(website_uv0.data):
        coordinate = index / collinear_denominator
        item.uv = (coordinate, coordinate)
    zero_area_surface_issues = component_validation.validate_component(
        project, website_surface, scene=bpy.context.scene,
    )
    expect(any(
        issue.code == "website_surface_uv0_zero_area"
        and issue.blocking
        and "no usable texture area" in issue.message
        and "UV Editor" in issue.message
        for issue in zero_area_surface_issues
    ), f"zero-area Website Surface UV0 was not actionable: {zero_area_surface_issues}")
    try:
        props.serialized_components(project)
    except ValueError as error:
        expect(
            "no usable texture area" in str(error) and "UV Editor" in str(error),
            f"Website Surface zero-area serializer blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("Website Surface serializer accepted zero-area UV0")
    website_surface.enabled = False
    zero_area_disabled_record = next(
        record for record in props.serialized_components(project)
        if record["id"] == website_surface.component_id
    )
    exporter.validate_website_surface_components(
        {"components": [zero_area_disabled_record]}, bpy.context.scene,
    )
    expect(any(
        issue.code == "website_surface_uv0_zero_area" and not issue.blocking
        for issue in component_validation.validate_component(
            project, website_surface, scene=bpy.context.scene,
        )
    ), "disabled zero-area Website Surface did not remain non-blocking")
    for item, coordinate in zip(website_uv0.data, website_uv0_original):
        item.uv = coordinate
    website_surface.enabled = True

    # Exercise the add-on-free compiler independently from RNA serialization.
    for index, item in enumerate(website_uv0.data):
        coordinate = 1.0 - index / collinear_denominator
        item.uv = (coordinate, coordinate)
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record]}, bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "no usable texture area" in str(error) and "UV Editor" in str(error),
            f"compiler zero-area Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted zero-area Website Surface UV0")
    for item, coordinate in zip(website_uv0.data, website_uv0_original):
        item.uv = coordinate

    finite_coordinate = tuple(website_uv0.data[0].uv)
    website_uv0.data[0].uv.x = float("nan")
    non_finite_surface_issues = component_validation.validate_component(
        project, website_surface, scene=bpy.context.scene,
    )
    expect(any(
        issue.code == "website_surface_uv0_non_finite"
        and issue.blocking
        and "non-finite" in issue.message
        for issue in non_finite_surface_issues
    ), f"non-finite Website Surface UV0 was not blocked: {non_finite_surface_issues}")
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record]}, bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "non-finite" in str(error) and "UV Editor" in str(error),
            f"compiler non-finite Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted non-finite Website Surface UV0")
    website_uv0.data[0].uv = finite_coordinate

    duplicate_surface = copy.deepcopy(website_surface_record)
    duplicate_surface["id"] = "component-website-surface-disabled-copy"
    duplicate_surface["enabled"] = False
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record, duplicate_surface]},
            bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "name 'monitor-screen' is used more than once" in str(error),
            f"compiler duplicate Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted duplicate Website Surface semantic names")
    website_screen["blendlink_dynamic"] = 0
    try:
        exporter.validate_website_surface_components(
            {"components": [website_surface_record]}, bpy.context.scene,
        )
    except SystemExit as error:
        expect(
            "must be Realtime" in str(error) and website_screen.name in str(error),
            f"compiler Realtime Website Surface blocker was not actionable: {error}",
        )
    else:
        raise AssertionError("compiler accepted a baked Website Surface target")
    website_surface_issues = component_validation.validate_component(
        project, website_surface, scene=bpy.context.scene,
    )
    expect(any(
        issue.code == "website_surface_not_realtime" and issue.blocking
        for issue in website_surface_issues
    ), f"baked Website Surface was not blocked: {website_surface_issues}")
    website_screen["blendlink_dynamic"] = 1

    ao = project.components.add()
    ao.component_id = "component-ao"
    ao.component_type = "blendlink.ambient-occlusion"
    ao.target_kind = "SCENE"
    ao.ao_radius_mode = "screen"
    ao.ao_screen_radius = 40.0
    ao.ao_intensity = 2.5

    shadow_catcher = project.components.add()
    shadow_catcher.component_id = "component-shadow-catcher"
    shadow_catcher.component_type = "blendlink.shadow-catcher"
    shadow_catcher.target_object = crate
    shadow_catcher.shadow_catcher_mode = "additive"
    shadow_catcher.shadow_catcher_light_strength = 7.25
    shadow_catcher.shadow_catcher_include_descendants = False

    contact_shadows = project.components.add()
    contact_shadows.component_id = "component-contact-shadows"
    contact_shadows.component_type = "blendlink.contact-shadows"
    contact_shadows.target_kind = "SCENE"
    contact_shadows.contact_shadows_auto_fit = True
    contact_shadows.contact_shadows_darkness = 0.65
    contact_shadows.contact_shadows_opacity = 0.55
    contact_shadows.contact_shadows_blur = 5.0
    contact_shadows.contact_shadows_occlude_below_ground = True
    contact_shadows.contact_shadows_backface_shadows = False
    contact_shadows.contact_shadows_update_policy = "static"

    outline = project.components.add()
    outline.component_id = "component-outline"
    outline.component_type = "blendlink.outline"
    outline.target_kind = "SCENE"
    outline.outline_strength = 4.0
    outline.outline_thickness = 1.5
    outline.outline_xray = True

    grade = project.components.add()
    grade.component_id = "component-color-grade"
    grade.component_type = "blendlink.color-grading"
    grade.target_kind = "SCENE"
    grade.color_grading_lut_url = "/looks/hero.cube"
    grade.color_grading_intensity = 0.8

    depth_of_field = project.components.add()
    depth_of_field.component_id = "component-dof"
    depth_of_field.component_type = "blendlink.depth-of-field"
    depth_of_field.target_kind = "SCENE"
    depth_of_field.dof_focus_mode = "object"
    depth_of_field.reference_object = focus
    depth_of_field.dof_focus_range = 1.5
    depth_of_field.dof_blur_strength = 1.25

    kuwahara = project.components.add()
    kuwahara.component_id = "component-kuwahara"
    kuwahara.component_type = "blendlink.kuwahara"
    kuwahara.target_kind = "SCENE"
    kuwahara.kuwahara_strength = 0.6
    kuwahara.kuwahara_brush_scale = 6.0
    kuwahara.kuwahara_directionality = 0.9
    kuwahara.kuwahara_detail = 0.4

    chromatic = project.components.add()
    chromatic.component_id = "component-chromatic"
    chromatic.component_type = "blendlink.chromatic-aberration"
    chromatic.target_kind = "SCENE"
    chromatic.raw_values = '{"futureLensModel":"anamorphic"}'
    chromatic.chromatic_amount = 0.012
    chromatic.chromatic_mode = "directional"
    chromatic.chromatic_angle = math.radians(15.0)
    chromatic.chromatic_center_x = 0.4
    chromatic.chromatic_center_y = 0.6

    pixelation = project.components.add()
    pixelation.component_id = "component-pixelation"
    pixelation.component_type = "blendlink.pixelation"
    pixelation.target_kind = "SCENE"
    pixelation.pixel_size = 8
    pixelation.pixel_depth_edge_strength = 0.5
    pixelation.pixel_normal_edge_strength = 0.25

    sharpen = project.components.add()
    sharpen.component_id = "component-sharpen"
    sharpen.component_type = "blendlink.sharpen"
    sharpen.target_kind = "SCENE"
    sharpen.sharpen_amount = 0.4

    tilt_shift = project.components.add()
    tilt_shift.component_id = "component-tilt-shift"
    tilt_shift.component_type = "blendlink.tilt-shift"
    tilt_shift.target_kind = "SCENE"
    tilt_shift.tilt_shift_focus_position = 0.4
    tilt_shift.tilt_shift_angle = math.radians(-12.0)
    tilt_shift.tilt_shift_feather = 0.3
    tilt_shift.tilt_shift_strength = 0.75
    tilt_shift.tilt_shift_quality = "high"

    component_records = props.serialized_components(project)
    batch_values = {record["type"]: record["values"] for record in component_records}
    focus_id = focus.get("blendlink_id")
    expect(
        batch_values["blendlink.ambient-occlusion"]["radiusMode"] == "screen"
        and abs(batch_values["blendlink.ambient-occlusion"]["screenRadius"] - 40.0) < 1e-5
        and batch_values["blendlink.shadow-catcher"]["mode"] == "additive"
        and abs(batch_values["blendlink.shadow-catcher"]["lightStrength"] - 7.25) < 1e-5
        and batch_values["blendlink.shadow-catcher"]["includeDescendants"] is False
        and batch_values["blendlink.contact-shadows"]["autoFit"] is True
        and abs(batch_values["blendlink.contact-shadows"]["darkness"] - 0.65) < 1e-5
        and abs(batch_values["blendlink.contact-shadows"]["opacity"] - 0.55) < 1e-5
        and abs(batch_values["blendlink.contact-shadows"]["blur"] - 5.0) < 1e-5
        and batch_values["blendlink.contact-shadows"]["occludeBelowGround"] is True
        and batch_values["blendlink.contact-shadows"]["backfaceShadows"] is False
        and batch_values["blendlink.contact-shadows"]["updatePolicy"] == "static"
        and batch_values["blendlink.outline"]["xRay"] is True
        and abs(batch_values["blendlink.outline"]["thickness"] - 1.5) < 1e-5
        and batch_values["blendlink.color-grading"]["lutUrl"] == "/looks/hero.cube"
        and abs(batch_values["blendlink.color-grading"]["intensity"] - 0.8) < 1e-5
        and batch_values["blendlink.color-grading"]["tetrahedralInterpolation"] is True
        and isinstance(focus_id, str) and focus_id
        and batch_values["blendlink.depth-of-field"]["focusTargetId"] == focus_id
        and batch_values["blendlink.depth-of-field"]["focusTargetName"] == focus.name
        and abs(batch_values["blendlink.kuwahara"]["brushScale"] - 6.0) < 1e-5,
        f"Batch 1 scene effects did not serialize portable artist intent: {batch_values}",
    )
    expect(
        abs(batch_values["blendlink.chromatic-aberration"]["amount"] - 0.012) < 1e-5
        and batch_values["blendlink.chromatic-aberration"]["mode"] == "directional"
        and abs(batch_values["blendlink.chromatic-aberration"]["angle"] - 15.0) < 1e-5
        and batch_values["blendlink.chromatic-aberration"]["futureLensModel"] == "anamorphic"
        and batch_values["blendlink.pixelation"]["pixelSize"] == 8
        and abs(batch_values["blendlink.pixelation"]["depthEdgeStrength"] - 0.5) < 1e-5
        and abs(batch_values["blendlink.pixelation"]["normalEdgeStrength"] - 0.25) < 1e-5
        and abs(batch_values["blendlink.sharpen"]["amount"] - 0.4) < 1e-5
        and abs(batch_values["blendlink.tilt-shift"]["focusPosition"] - 0.4) < 1e-5
        and abs(batch_values["blendlink.tilt-shift"]["angle"] + 12.0) < 1e-5
        and batch_values["blendlink.tilt-shift"]["quality"] == "high",
        f"Batch 2 scene effects did not serialize portable artist intent: {batch_values}",
    )
    # CollectionProperty growth can relocate its inline PropertyGroup storage.
    # Reacquire the record after adding the other effects instead of retaining
    # an RNA wrapper from before the collection grew (Blender 5.2 can otherwise
    # dereference stale storage when a pointer property is read).
    chromatic = next(
        item for item in project.components
        if item.component_id == "component-chromatic"
    )
    chromatic_issues = component_validation.validate_component(
        project, chromatic, scene=bpy.context.scene,
    )
    expect(any(
        issue.code == "strong_chromatic_aberration" and not issue.blocking
        and "readability" in issue.message
        for issue in chromatic_issues
    ), f"strong chromatic aberration did not surface an artist warning: {chromatic_issues}")
    try:
        props._validate_component_values(
            "blendlink.pixelation",
            {"pixelSize": 5.5, "depthEdgeStrength": 0.0, "normalEdgeStrength": 0.0},
            "Imported Pixelation",
        )
    except ValueError as error:
        expect("whole number of CSS pixels" in str(error),
               f"fractional Pixelation failure was not actionable: {error}")
    else:
        raise AssertionError("fractional CSS-pixel size was silently rounded")
    depth_of_field = next(
        item for item in project.components
        if item.component_id == "component-dof"
    )
    depth_of_field.dof_focus_mode = "distance"
    distance_focus = props.component_values(depth_of_field)
    expect("focusTargetId" not in distance_focus and "focusTargetName" not in distance_focus,
           f"distance-focused DOF retained a stale object reference: {distance_focus}")
    component_records = props.serialized_components(project)
    recipe_components = json.loads(bpy.context.scene["blendlink_recipe"])["components"]
    expect(recipe_components == component_records,
           "canonical scene recipe omitted or rewrote authored Components")

    # Names are artist-facing hints only. Renaming a target must retain the
    # stable objectId used by the website adapter.
    original_crate_name = crate.name
    crate.name = "Renamed Component Target"
    renamed_hover = props.serialized_components(project)[1]
    expect(renamed_hover["target"]["objectId"] == crate_component_id
           and renamed_hover["target"]["objectName"] == crate.name,
           f"Component target identity changed across an object rename: {renamed_hover}")
    crate.name = original_crate_name

    # Keep later recipe assertions focused on their own authored settings.
    project.components.clear()
    props._project_changed(project, bpy.context)
    expect(json.loads(bpy.context.scene["blendlink_recipe"])["components"] == [],
           "clearing authored Components did not update the canonical recipe")

    # The artist-facing operators cover both scene effects and selected-object
    # behavior, reject duplicates, and remove by stable component identity.
    # Keep Visible Through Objects marks the selected object as the focal
    # subject; it must not silently change that object's baked/realtime route.
    if components_ui is not None:
        expect(component_schema is not None and component_schema.validate_catalog() == (),
               f"Component catalog metadata is incomplete: "
               f"{component_schema.validate_catalog() if component_schema else 'not loaded'}")
        expect(component_schema.validate_rna_bindings(
            props.BlendlinkComponentSettings,
        ) == (),
               "Component catalog JSON/RNA bindings drifted from registered editors: "
               f"{component_schema.validate_rna_bindings(props.BlendlinkComponentSettings)}")
        expect(
            [item[0] for item in component_schema.search_catalog(
                "glow", target_mode="SCENE",
            )] == ["blendlink.bloom"]
            and [item[0] for item in component_schema.search_catalog(
                "pointer audio", target_mode="SELECTION",
            )] == ["blendlink.play-audio-on-click"],
            "searchable Component catalog did not match artist task vocabulary",
        )
        expect(
            len(component_schema.known_types_for_target("SCENE")) == 12
            and len(component_schema.known_types_for_target("OBJECT")) == 10
            and len(component_schema.known_types_for_target("MESH")) == 11,
            "registered artist catalog does not expose twelve scene effects, ten general "
            "object behaviors, and the Mesh-only Website Surface",
        )
        expect(
            components_ui.SCENE_CATALOG_ACTION_LABEL == "Browse Scene Effects"
            and components_ui.BEHAVIOR_CATALOG_ACTION_LABEL == "Browse Object Behaviors"
            and "Bloom or Vignette" not in components_ui.SCENE_EMPTY_MESSAGE
            and "catalog" in components_ui.SCENE_EMPTY_MESSAGE.lower()
            and "catalog" in components_ui.BEHAVIOR_EMPTY_MESSAGE.lower(),
            "N-panel component discoverability regressed to tiny or incomplete catalog copy",
        )
        expect(
            components_ui.PHYSICS_DESIGNATION_TITLE == "Physics Export Designations"
            and "not a bundled physics simulation" in
            components_ui.PHYSICS_DESIGNATION_NOTE,
            "Rigid Body and Collider are not clearly described as export designations",
        )
        physics_layout = RecordingLayout()
        components_ui._draw_physics_shortcuts(physics_layout)
        expect(
            ("label", "Physics Export Designations") in physics_layout.events
            and ("operator", "blendlink.tag_rigid", "Tag Rigid Body")
            in physics_layout.events
            and ("operator_menu_enum", "blendlink.tag_collider", "kind", "Tag Collider")
            in physics_layout.events,
            "physics designation panel did not render explicit tag-only actions",
        )
        expect(
            component_schema.definition("blendlink.see-through")["gizmos"][0]
            == {
                "kind": "radius", "field": "fade_distance", "role": "clearance",
                "label": "Camera Clearance",
            }
            and len(component_schema.definition("blendlink.audio-source")["gizmos"]) == 2,
            "component consequence gizmos are not declared by the shared schema",
        )
        expect(components_ui.BLENDLINK_OT_add_component.is_registered
               and components_ui.BLENDLINK_OT_remove_component.is_registered
               and components_ui.BLENDLINK_OT_browse_components.is_registered
               and components_ui.BLENDLINK_OT_copy_component.is_registered
               and components_ui.BLENDLINK_OT_copy_component_as_new.is_registered
               and components_ui.BLENDLINK_OT_paste_component_as_new.is_registered
               and components_ui.BLENDLINK_OT_paste_component_values.is_registered,
               "Component catalog/copy/paste operators were imported but not registered")
        expect(components_ui.BLENDLINK_PT_components_sidebar.is_registered,
               "3D View component catalog entry point was not registered")
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.bloom", target_mode="SCENE",
        ) == {"FINISHED"}
               and len(project.components) == 1
               and project.components[0].target_kind == "SCENE",
               "Add Component did not author a scene-wide Bloom")
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.bloom", target_mode="SCENE",
        ) == {"CANCELLED"} and len(project.components) == 1,
               "Add Component allowed duplicate scene effects")
        bloom_operator_id = project.components[0].component_id
        expect(bpy.ops.blendlink.remove_component(
            component_id=bloom_operator_id,
        ) == {"FINISHED"} and len(project.components) == 0,
               "Remove Component did not remove a scene effect by stable identity")

        contact_empty = bpy.data.objects.new("Contact Shadows Empty", None)
        bpy.context.scene.collection.objects.link(contact_empty)
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.contact-shadows", target_mode="SCENE",
        ) == {"FINISHED"} and len(project.components) == 1,
               "Contact Shadows was not available as an automatic Scene effect")
        select_only(contact_empty)
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.contact-shadows", target_mode="SELECTION",
        ) == {"CANCELLED"} and len(project.components) == 1,
               "one-per-scene Contact Shadows allowed a second Empty placement")
        contact_component_id = project.components[0].component_id
        expect(bpy.ops.blendlink.remove_component(
            component_id=contact_component_id,
        ) == {"FINISHED"} and len(project.components) == 0,
               "Contact Shadows could not be removed by stable identity")
        bpy.data.objects.remove(contact_empty, do_unlink=True)

        focal_object = make_cube("Component Focal Subject")
        focal_mesh = focal_object.data
        select_only(focal_object)
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.hover", target_mode="SELECTION",
        ) == {"FINISHED"}, "Add Component did not apply Hover to the selection")
        hover_components = [
            item for item in project.components
            if item.component_type == "blendlink.hover"
        ]
        expect(len(hover_components) == 1
               and hover_components[0].target_object == focal_object
               and hover_components[0].target_id == focal_object.get("blendlink_id"),
               "selected-object Component lost its pointer or stable target identity")
        source_hover = hover_components[0]
        source_hover.hover_scale = 1.24
        source_hover.duration = 0.31
        source_hover.raw_values = json.dumps({"studioNote": "preserve this extension"})
        expect(bpy.ops.blendlink.copy_component(
            component_id=source_hover.component_id,
        ) == {"FINISHED"}
               and components_ui._component_clipboard_text.startswith(
                   "BLENDLINK_COMPONENT_V1\n"
               )
               and components_ui._read_component_clipboard(bpy.context)[0]
               is not None,
               "Copy Component did not publish a safe versioned JSON clipboard")

        batch_object = make_cube("Component Batch Target")
        batch_mesh = batch_object.data
        missing_object = make_cube("Component Missing Target")
        missing_mesh = missing_object.data
        select_only(focal_object, batch_object)
        expect(bpy.ops.blendlink.copy_component_as_new(
            component_id=source_hover.component_id,
        ) == {"FINISHED"},
               "Copy as New did not apply the source Component to a selection")
        batch_result = components_ui._last_component_action.as_dict()
        pasted_hover = [
            item for item in project.components
            if item.component_type == "blendlink.hover"
            and item.target_object == batch_object
        ]
        expect(batch_result["summary"] == {"changed": 1, "skipped": 1, "errors": 0}
               and batch_result["skipped"][0]["code"] == "already_exists"
               and len(pasted_hover) == 1
               and pasted_hover[0].component_id != source_hover.component_id
               and abs(pasted_hover[0].hover_scale - 1.24) < 1e-5
               and props.component_values(pasted_hover[0])["studioNote"]
               == "preserve this extension",
               f"Paste as New lost stable-ID or extension-value guarantees: {batch_result}")

        source_hover.hover_scale = 1.41
        source_hover.duration = 0.19
        source_hover.raw_values = json.dumps({
            "studioNote": "updated without being swallowed",
            "vendorNested": {"enabled": True},
        })
        expect(bpy.ops.blendlink.copy_component(
            component_id=source_hover.component_id,
        ) == {"FINISHED"}, "Copy Component could not refresh its values")
        select_only(focal_object, batch_object, missing_object)
        expect(bpy.ops.blendlink.paste_component_values(
            component_id=source_hover.component_id,
        ) == {"FINISHED"}, "Paste Values did not batch-apply to same-type Components")
        values_result = components_ui._last_component_action.as_dict()
        expect(values_result["summary"] == {"changed": 1, "skipped": 2, "errors": 0}
               and {item["code"] for item in values_result["skipped"]}
               == {"already_matches", "missing_component"}
               and any(
                   item["target"] == missing_object.name
                   and item["code"] == "missing_component"
                   for item in values_result["skipped"]
               )
               and all(abs(item.hover_scale - 1.41) < 1e-5 for item in (
                   source_hover, pasted_hover[0],
               ))
               and props.component_values(pasted_hover[0])["vendorNested"]
               == {"enabled": True},
               f"Paste Values swallowed a field or target outcome: {values_result}")

        for component_id in [source_hover.component_id, pasted_hover[0].component_id]:
            expect(bpy.ops.blendlink.remove_component(
                component_id=component_id,
            ) == {"FINISHED"}, "Remove Component failed after a batch transfer")
        expect(len(project.components) == 0,
               "batch Component cleanup left records behind")

        # Unknown vendor records use the same safe clipboard and retain their
        # complete value object; no editor schema or eval()-based reconstruction
        # is required.
        vendor = project.components.add()
        vendor.component_id = "vendor-copy-source"
        vendor.component_type = "studio.sparkle"
        vendor.target_object = focal_object
        vendor.target_id = focal_object.get("blendlink_id")
        vendor.target_name = focal_object.name
        vendor.raw_values = json.dumps({
            "layers": [{"color": [1, 0.5, 0.25], "speed": 2}],
            "quality": "hero",
        })
        expect(bpy.ops.blendlink.copy_component(
            component_id=vendor.component_id,
        ) == {"FINISHED"}, "unknown vendor Component could not be copied")
        select_only(batch_object)
        expect(bpy.ops.blendlink.paste_component_as_new() == {"FINISHED"},
               "unknown vendor Component could not be pasted as new")
        vendor_copies = [
            item for item in project.components
            if item.component_type == "studio.sparkle"
        ]
        expect(len(vendor_copies) == 2
               and vendor_copies[0].component_id != vendor_copies[1].component_id
               and props.component_values(vendor_copies[0])
               == props.component_values(vendor_copies[1]),
               "unknown vendor Component values or stable identities were rewritten")
        for component_id in [item.component_id for item in vendor_copies]:
            expect(bpy.ops.blendlink.remove_component(
                component_id=component_id,
            ) == {"FINISHED"}, "unknown vendor Component cleanup failed")

        select_only(focal_object)
        expect("blendlink_dynamic" not in focal_object,
               "focal-object fixture unexpectedly began with a rendering-route override")
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.see-through", target_mode="SELECTION",
        ) == {"FINISHED"},
               "Keep Visible Through Objects could not mark a focal object")
        see_through = [
            item for item in project.components
            if item.component_type == "blendlink.see-through"
        ]
        expect(len(see_through) == 1 and see_through[0].target_object == focal_object
               and "blendlink_dynamic" not in focal_object,
               "Keep Visible Through Objects changed the focal object's web rendering route")
        prior_clearance = see_through[0].fade_distance
        try:
            incompatible_paste = bpy.ops.blendlink.paste_component_values(
                component_id=see_through[0].component_id,
            )
        except RuntimeError as error:
            incompatible_paste = {"CANCELLED"}
            expect("clipboard contains Sparkle" in str(error),
                   f"incompatible Paste Values raised an unclear error: {error}")
        expect(incompatible_paste == {"CANCELLED"}
               and components_ui._last_component_action.errors[0]["code"]
               == "different_type"
               and see_through[0].fade_distance == prior_clearance,
               "Paste Values silently applied or swallowed incompatible vendor fields")
        expect(bpy.ops.blendlink.remove_component(
            component_id=see_through[0].component_id,
        ) == {"FINISHED"} and len(project.components) == 0,
               "focal-object Component could not be removed")

        # Cards, Web Checks, and publish preflight share one read-only
        # component validator, so an attractive card can never mask a runtime
        # installation failure.
        select_only(focal_object)
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.open-url", target_mode="SELECTION",
        ) == {"FINISHED"}, "Open Link validation fixture could not be added")
        open_link = project.components[0]
        component_issues = component_validation.validate_project(
            project, scene=bpy.context.scene,
        )
        expect(any(
            issue.code == "invalid_url" and issue.blocking
            for issue in component_issues
        ), "shared Component validation accepted the placeholder URL")
        validation.recompute(bpy.context.scene)
        expect(any(
            "Website Component Open Link on Click" in issue.message
            for issue in validation.result().issues
        ) and "Open Link on Click" in ops._publish_settings_issue(bpy.context),
               "Component problems did not reach Web Checks and publish preflight")
        open_link.enabled = False
        expect(component_validation.first_blocking_issue(
            project, scene=bpy.context.scene,
        ) is None and not project.recipe_error
               and json.loads(bpy.context.scene["blendlink_recipe"])["components"][0]["enabled"] is False,
               "disabling an unfinished Component did not park its draft safely")
        open_link.enabled = True
        open_link.url = "https://example.com/work"
        open_link.new_tab = False
        open_link.accessibility_label = ""
        missing_label_issues = component_validation.validate_component(
            project, open_link, scene=bpy.context.scene,
        )
        expect(any(
            issue.code == "missing_accessible_label" and issue.blocking
            and issue.object_name == focal_object.name
            for issue in missing_label_issues
        ), "an enabled click action without an Accessible Label was not blocking")
        open_link.enabled = False
        parked_label_issue = next(
            issue for issue in component_validation.validate_component(
                project, open_link, scene=bpy.context.scene,
            )
            if issue.code == "missing_accessible_label"
        )
        expect(not parked_label_issue.blocking,
               "a disabled click-action draft could not park its missing label")
        open_link.enabled = True
        open_link.accessibility_label = "Open work example"
        good_payload = components_ui._write_component_clipboard(
            bpy.context, open_link,
        )
        malformed_payload = copy.deepcopy(good_payload)
        malformed_payload["values"]["newTab"] = "false"
        malformed_clipboard = (
            components_ui._CLIPBOARD_PREFIX
            + json.dumps(malformed_payload, separators=(",", ":"))
        )
        components_ui._component_clipboard_text = malformed_clipboard
        bpy.context.window_manager.clipboard = malformed_clipboard
        before_new_tab = open_link.new_tab
        malformed_result = components_ui.run_component_action(
            bpy.context, "PASTE_VALUES", component_id=open_link.component_id,
        )
        expect(malformed_result.as_dict()["summary"] == {
            "changed": 0, "skipped": 0, "errors": 1,
        } and "newTab must be true or false" in malformed_result.errors[0]["detail"]
               and open_link.new_tab == before_new_tab,
               f"malformed known clipboard value was coerced or mutated: "
               f"{malformed_result.as_dict()}")
        expect(bpy.ops.blendlink.remove_component(
            component_id=open_link.component_id,
        ) == {"FINISHED"} and len(project.components) == 0,
               "Open Link validation fixture cleanup failed")

        # Consequence guides are selected-only, scale-independent, live with
        # transforms, and honest about non-drawable zero radii.
        expect(consequence_gizmos is not None,
               "consequence-gizmo module was not imported")
        focal_object.location = (1.0, 2.0, 3.0)
        focal_object.scale = (2.0, 3.0, 4.0)
        bpy.context.view_layer.update()
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.see-through", target_mode="SELECTION",
        ) == {"FINISHED"}, "guide fixture could not add Keep Visible")
        guide_clearance = project.components[-1]
        guide_clearance.fade_distance = 2.0
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.audio-source", target_mode="SELECTION",
        ) == {"FINISHED"}, "guide fixture could not add Audio Source")
        guide_audio = project.components[-1]
        guide_audio.audio_url = "/audio/hero.ogg"
        guide_audio.spatial = True
        guide_audio.min_distance = 3.0
        guide_audio.max_distance = 12.0
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.hover", target_mode="SELECTION",
        ) == {"FINISHED"}, "interaction-guide fixture could not add Hover")
        guide_hover = project.components[-1]
        expect(bpy.ops.blendlink.add_component(
            component_type="blendlink.open-url", target_mode="SELECTION",
        ) == {"FINISHED"}, "interaction-guide fixture could not add Open Link")
        guide_link = project.components[-1]
        guide_link.url = "https://example.com/portfolio"
        guide_link.accessibility_label = "Open portfolio"
        guide_result = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=(focal_object,), light_diagnostics={},
        )
        expect(guide_result.counts.get("see-through") == 1
               and guide_result.counts.get("audio-range") == 2
               and guide_result.counts.get("interaction-target") == 1
               and not guide_result.issues,
               f"selected component consequences were incomplete: {guide_result}")
        interaction_item = next(
            item for item in guide_result.items
            if item.kind == "interaction-target"
        )
        expect(interaction_item.shape == "cross"
               and focal_object.name in interaction_item.label
               and "Emphasize on Hover" in interaction_item.label
               and 'Open Link on Click "Open portfolio"' in interaction_item.label
               and "Pick priority: nearest visible hit" in interaction_item.label,
               f"interaction target guide lost identity, label, or picking policy: "
               f"{interaction_item}")
        guide_link.accessibility_label = ""
        missing_label_result = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=(focal_object,), light_diagnostics={},
        )
        missing_label_item = next(
            item for item in missing_label_result.items
            if item.kind == "interaction-target"
        )
        expect("MISSING ACCESSIBLE LABEL" in missing_label_item.label
               and missing_label_item.color
               == consequence_gizmos._INTERACTION_WARNING,
               "viewport interaction guide hid a missing Accessible Label")
        guide_link.accessibility_label = "Open portfolio"
        clearance_item = next(
            item for item in guide_result.items if item.kind == "see-through"
        )
        clearance_scale = clearance_item.matrix.to_scale()
        expect(all(abs(value - 4.0) < 1e-5 for value in clearance_scale),
               f"object scale distorted a world-space clearance radius: {clearance_scale}")
        before_translation = clearance_item.resolved_matrix().translation.copy()
        focal_object.location.x += 5.0
        bpy.context.view_layer.update()
        after_translation = clearance_item.resolved_matrix().translation.copy()
        expect(abs(after_translation.x - before_translation.x - 5.0) < 1e-5,
               "cached consequence guide did not follow a live object transform")
        guide_clearance.fade_distance = 0.0
        zero_result = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=(focal_object,), light_diagnostics={},
        )
        expect(zero_result.counts.get("see-through", 0) == 0
               and not any("Keep Visible" in issue.message for issue in zero_result.issues),
               f"valid zero clearance became a false Web Check: {zero_result}")
        unselected_result = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=(), light_diagnostics={},
        )
        expect(not any(item.kind in {"see-through", "audio-range"}
                       for item in unselected_result.items),
               "large Component guides leaked beyond the current selection")
        expect(unselected_result.counts.get("interaction-target") == 1,
               "unselected interaction targets disappeared from the identity overlay")
        for component_id in (
            guide_clearance.component_id, guide_audio.component_id,
            guide_hover.component_id, guide_link.component_id,
        ):
            expect(bpy.ops.blendlink.remove_component(
                component_id=component_id,
            ) == {"FINISHED"}, "guide Component cleanup failed")

        prior_shadow_preset = project.shadow_preset
        project.shadow_preset = "BALANCED"
        guide_lights = []
        for name, light_type in (
            ("Guide Point", "POINT"),
            ("Guide Spot", "SPOT"),
            ("Guide Sun", "SUN"),
        ):
            data = bpy.data.lights.new(name, light_type)
            obj = bpy.data.objects.new(name, data)
            bpy.context.scene.collection.objects.link(obj)
            obj["blendlink_cast_shadow"] = True
            guide_lights.append(obj)
        guide_lights[1].data.spot_size = math.radians(60.0)
        shadow_result = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=tuple(guide_lights), light_diagnostics={},
        )
        shadow_items = [
            item for item in shadow_result.items if item.kind == "shadow-reach"
        ]
        expect(len(shadow_items) == 3
               and [item.shape for item in shadow_items]
               == ["sphere", "cone", "badge"]
               and "6 (" in shadow_items[0].label
               and "far clip" in shadow_items[2].label,
               f"Point/Spot/Sun shadow consequences were misleading: {shadow_items}")
        guide_lights[0]["blendlink_cast_shadow"] = False
        disabled_shadow = consequence_gizmos.build(
            bpy.context.scene, project=project,
            selected_objects=(guide_lights[0],), light_diagnostics={},
        )
        expect(len(disabled_shadow.items) == 1
               and disabled_shadow.items[0].shape == "cross"
               and "disabled" in disabled_shadow.items[0].label.lower(),
               "disabled realtime shadow did not use the explicit off guide")
        for obj in guide_lights:
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.lights.remove(data)
        project.shadow_preset = prior_shadow_preset

        bpy.data.objects.remove(focal_object, do_unlink=True)
        bpy.data.meshes.remove(focal_mesh)
        bpy.data.objects.remove(batch_object, do_unlink=True)
        bpy.data.meshes.remove(batch_mesh)
        bpy.data.objects.remove(missing_object, do_unlink=True)
        bpy.data.meshes.remove(missing_mesh)
        select_only(crate, rock)

    # Invalid live names keep the last valid embedded settings intact, remain
    # visible to Web Checks, and block unrelated mutations/publishing.
    bpy.ops.blendlink.add_state()
    invalid_state = project.states[project.state_index]
    last_valid_recipe = bpy.context.scene["blendlink_recipe"]
    invalid_state.name = project.states[0].name
    expect("used more than once" in project.recipe_error
           and bpy.context.scene["blendlink_recipe"] == last_valid_recipe
           and ops._publish_settings_issue(bpy.context) is not None,
           "duplicate Lighting State silently replaced the last valid publish settings")
    atlas_count = len(project.atlases)
    try:
        invalid_add_atlas = bpy.ops.blendlink.add_atlas()
    except RuntimeError as error:
        expect("Correct the scene setting first" in str(error),
               f"invalid-scene mutation failure was not actionable: {error}")
        invalid_add_atlas = {"CANCELLED"}
    expect(invalid_add_atlas == {"CANCELLED"} and len(project.atlases) == atlas_count,
           "unrelated Add Atlas partially mutated an invalid scene recipe")
    validation.recompute(bpy.context.scene)
    expect(any("Lighting State name" in issue.message for issue in validation.result().issues),
           "Web Checks did not surface duplicate Lighting State names")
    expect(bpy.ops.blendlink.remove_state() == {"FINISHED"}
           and len(project.states) == 1 and not project.recipe_error,
           "removing the duplicate Lighting State did not heal scene settings")

    second_frame = project.compositions[1]
    second_frame_name = second_frame.name
    second_frame.name = project.compositions[0].name
    expect("Responsive Frame name" in project.recipe_error,
           "duplicate Responsive Frame was not blocked before publishing")
    second_frame.name = "   "
    expect("needs a name" in project.recipe_error,
           "blank Responsive Frame was silently replaced by an internal fallback")
    second_frame.name = second_frame_name
    expect(not project.recipe_error, "correcting the Responsive Frame did not heal scene settings")

    bpy.ops.blendlink.add_atlas()
    validation_atlas = project.atlases[project.atlas_index]
    validation_atlas.name = "Main"
    expect("Atlas name" in project.recipe_error,
           "duplicate Atlas display name remained ambiguous")
    validation_atlas.name = "   "
    expect("needs a name" in project.recipe_error,
           "blank Atlas display name leaked an internal identity")
    validation_atlas.name = "Validation Atlas"
    expect(not project.recipe_error, "correcting the Atlas name did not heal scene settings")
    bpy.ops.blendlink.remove_atlas()

    # Reference-camera planning is read-only. New/mismatched identities block
    # until Save prepares the exact bytes the external tools will open.
    reference_camera_data = bpy.data.cameras.new("Unsaved Reference Camera")
    reference_camera = bpy.data.objects.new(
        "Unsaved Reference Camera", reference_camera_data,
    )
    bpy.context.scene.collection.objects.link(reference_camera)
    expect("blendlink_id" not in reference_camera,
           "new camera unexpectedly began with a persistent identity")
    try:
        presentation_ui._camera_records(bpy.context.scene, project, "ALL")
    except ValueError:
        pass
    else:
        raise AssertionError("comparison planning accepted an unsaved camera identity")
    expect("blendlink_id" not in reference_camera,
           "comparison planning mutated the scene while checking camera identities")
    reference_camera["blendlink_id"] = crate["blendlink_id"]
    duplicate_before = reference_camera["blendlink_id"]
    try:
        presentation_ui._camera_records(bpy.context.scene, project, "ALL")
    except ValueError:
        pass
    else:
        raise AssertionError("comparison planning accepted a scene-wide identity collision")
    expect(reference_camera["blendlink_id"] == duplicate_before,
           "comparison planning silently repaired a collision instead of asking for Save")
    handlers._save_pre("")
    scene_ids = [obj.get("blendlink_id") for obj in bpy.context.scene.objects]
    expect(all(isinstance(value, str) and value for value in scene_ids)
           and len(scene_ids) == len(set(scene_ids))
           and any(record["objectName"] == reference_camera.name
                   for record in presentation_ui._camera_records(
                       bpy.context.scene, project, "ALL",
                   )),
           "save preparation did not persist unique scene identities for comparison cameras")
    bpy.data.objects.remove(reference_camera, do_unlink=True)
    bpy.data.cameras.remove(reference_camera_data)

    # Camera scope uses the same explicit-role precedence, duplicate suffix,
    # and excluded-parent semantics as the exporter.
    def reference_camera_named(name):
        data = bpy.data.cameras.new(name)
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        return obj, data

    suffix_camera, suffix_data = reference_camera_named("Reference-noimp.001")
    explicit_camera, explicit_data = reference_camera_named("Explicit Reference")
    explicit_camera["blendlink_role"] = " NoImp "
    override_camera, override_data = reference_camera_named("Override-noimp")
    override_camera["blendlink_role"] = "rigid"
    excluded_root = bpy.data.objects.new("Excluded Camera Rig-noimp", None)
    bpy.context.scene.collection.objects.link(excluded_root)
    child_camera, child_data = reference_camera_named("Rig Child Camera")
    child_camera.parent = excluded_root
    ops._ensure_scene_ids(bpy.context.scene)
    published_names = {
        obj.name for obj in presentation_ui._reference_cameras(
            bpy.context.scene, project, "ALL",
        )
    }
    expect(suffix_camera.name not in published_names
           and explicit_camera.name not in published_names
           and child_camera.name not in published_names
           and override_camera.name in published_names,
           f"Published Camera scope drifted from exporter exclusion semantics: {published_names}")
    project.main_camera = child_camera
    expect("excluded from website publishing" in presentation_ui._camera_id_issue(
        bpy.context.scene, project, "PRESENTATION",
    ), "an excluded Website Camera entered the comparison plan")
    validation.recompute(bpy.context.scene)
    expect(any("Website Camera" in issue.message
               and "excluded from website publishing" in issue.message
               for issue in validation.result().issues),
           "Web Checks did not explain an excluded Website Camera")
    project.main_camera = web_camera
    for camera, data in (
        (suffix_camera, suffix_data),
        (explicit_camera, explicit_data),
        (override_camera, override_data),
        (child_camera, child_data),
    ):
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(data)
    bpy.data.objects.remove(excluded_root, do_unlink=True)

    foreign_scene = bpy.data.scenes.new("Foreign Blendlink Scene")
    foreign_camera_data = bpy.data.cameras.new("Foreign Website Camera")
    foreign_camera = bpy.data.objects.new("Foreign Website Camera", foreign_camera_data)
    foreign_scene.collection.objects.link(foreign_camera)
    foreign_target = bpy.data.objects.new("Foreign Orbit Target", None)
    foreign_scene.collection.objects.link(foreign_target)
    expect(not props._camera_poll(project, foreign_camera)
           and not props._scene_object_poll(project, foreign_target),
           "object pickers accepted pointers from another Blender scene")
    try:
        props._require_scene_object(project, foreign_target, "Orbit Target")
    except ValueError:
        pass
    else:
        raise AssertionError("scene serialization accepted a foreign object pointer")

    class LinkedWithoutIdentity(dict):
        name = "Linked Asset"
        is_editable = False

    try:
        props._stable_id(LinkedWithoutIdentity())
    except ValueError as error:
        expect("source .blend" in str(error),
               f"linked-identity remedy was not artist-facing: {error}")
    else:
        raise AssertionError("linked data was mutated to create an object identity")
    bpy.data.scenes.remove(foreign_scene)
    bpy.data.objects.remove(foreign_camera, do_unlink=True)
    bpy.data.cameras.remove(foreign_camera_data)
    bpy.data.objects.remove(foreign_target, do_unlink=True)

    validation._state["dirty"] = False
    project.presentation = "REALTIME"
    expect(validation.is_dirty(),
           "scene presentation edits did not invalidate effective rendering analysis")
    validation.recompute(bpy.context.scene)
    project.presentation = "HYBRID"
    expect(validation.is_dirty(),
           "returning to Hybrid did not invalidate effective rendering analysis")
    validation.recompute(bpy.context.scene)
    default_state = project.states[0]
    bpy.ops.blendlink.add_state_hidden_collection(collection_name=state_collection.name)
    expect(props.hidden_collection_names(default_state) == [state_collection.name],
           "lighting-state collection picker did not author the hidden collection")
    comma_collection = bpy.data.collections.new("State, With Comma")
    bpy.context.scene.collection.children.link(comma_collection)
    props.set_hidden_collection_names(
        default_state, [state_collection.name, comma_collection.name],
    )
    expect(props.hidden_collection_names(default_state) == [
        state_collection.name, comma_collection.name,
    ], "lighting-state storage lost a collection name containing a comma")
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["states"][0]["hideCollections"] == [
        state_collection.name, comma_collection.name,
    ], "lighting-state collection UI did not preserve the canonical recipe list")
    bpy.ops.blendlink.remove_state_hidden_collection(
        collection_name=comma_collection.name,
    )
    bpy.ops.blendlink.remove_state_hidden_collection(
        collection_name=state_collection.name,
    )
    bpy.data.collections.remove(comma_collection)

    legacy_scene = bpy.data.scenes.new("Blendlink Legacy Bake Output")
    try:
        legacy_scene["blendlink_recipe"] = json.dumps({
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [{
                "id": "main", "name": "Main", "size": 2048,
                "targetDensity": 256, "margin": 48, "fitPolicy": "block",
            }],
        })
        handlers._recipe_hydration_token = None
        legacy_context = SimpleNamespace(scene=legacy_scene)
        expect(handlers._hydrate_recipe_if_needed(legacy_context),
               "legacy recipe fixture did not schedule native-control hydration")
        expect(not handlers._hydrate_recipe_if_needed(legacy_context),
               "unchanged legacy recipe was hydrated more than once")
        expect(legacy_scene.blendlink_project.atlases[0].bake_output == "APPEARANCE",
               "missing legacy bakeOutput must preserve the flattened appearance bake")
        expect("load_legacy_recipe" not in ui.BLENDLINK_PT_main.draw.__code__.co_names,
               "sidebar draw must never hydrate or mutate the scene recipe")
    finally:
        bpy.data.scenes.remove(legacy_scene)

    canonical_scene = bpy.data.scenes.new("Blendlink Canonical Recipe Wins")
    try:
        props.setup_project(canonical_scene)
        expect(canonical_scene.blendlink_project.configured
               and canonical_scene.blendlink_project.atlases[0].bake_output == "LIGHTING",
               "canonical-recipe fixture did not start with configured native defaults")
        canonical_scene["blendlink_recipe"] = json.dumps({
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [
                {
                    "id": "main", "name": "Hero", "size": 4096,
                    "targetDensity": 160, "margin": 48,
                    "fitPolicy": "block", "bakeOutput": "appearance",
                },
                {
                    "id": "background", "name": "Background", "size": 512,
                    "targetDensity": 64, "margin": 12,
                    "fitPolicy": "block", "bakeOutput": "appearance",
                },
            ],
        }, separators=(",", ":"), sort_keys=True)
        handlers._recipe_hydration_token = None
        canonical_context = SimpleNamespace(scene=canonical_scene)
        expect(handlers._hydrate_recipe_if_needed(canonical_context),
               "configured stale native controls hid a changed canonical recipe")
        canonical_project = canonical_scene.blendlink_project
        expect(len(canonical_project.atlases) == 2
               and canonical_project.atlases[0].size == 4096
               and canonical_project.atlases[0].bake_output == "APPEARANCE"
               and canonical_project.atlases[1].atlas_id == "background"
               and canonical_project.atlases[1].size == 512,
               "canonical recipe did not replace stale configured native controls")
        expect(not handlers._hydrate_recipe_if_needed(canonical_context),
               "unchanged canonical recipe was hydrated more than once")
    finally:
        bpy.data.scenes.remove(canonical_scene)

    invalid_recipe_scene = bpy.data.scenes.new("Blendlink Invalid Bake Output")
    try:
        invalid_recipe_scene["blendlink_recipe"] = json.dumps({
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [{"id": "main", "bakeOutput": "future-output"}],
        })
        invalid_recipe_log = StringIO()
        with redirect_stdout(invalid_recipe_log):
            loaded = props.load_legacy_recipe(invalid_recipe_scene)
        expect(not loaded and not invalid_recipe_scene.blendlink_project.configured
               and "bakeOutput must be lighting or appearance" in invalid_recipe_log.getvalue()
               and "future-output" in invalid_recipe_scene.blendlink_project.recipe_error,
               "invalid serialized bakeOutput was silently rewritten as Appearance")
    finally:
        bpy.data.scenes.remove(invalid_recipe_scene)

    # Unknown vendor Components stay portable even when this Blendlink build
    # has no editor or runtime adapter for them. Hydration must retain every
    # JSON value so a save/open cycle never destroys third-party intent.
    vendor_component = {
        "id": "vendor-sparkle-1",
        "type": "studio.sparkle",
        "schemaVersion": 1,
        "enabled": False,
        "target": {"kind": "scene"},
        "values": {
            "quality": 7,
            "palette": ["ink", {"grain": 0.25}],
            "softMask": True,
            "optional": None,
        },
    }
    vendor_scene = bpy.data.scenes.new("Blendlink Vendor Component")
    try:
        vendor_scene["blendlink_recipe"] = json.dumps({
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [vendor_component],
        })
        expect(props.load_legacy_recipe(vendor_scene),
               "valid unknown vendor Component did not hydrate")
        vendor_project = vendor_scene.blendlink_project
        expect(len(vendor_project.components) == 1
               and props.serialized_components(vendor_project) == [vendor_component]
               and props.project_recipe(vendor_project)["components"] == [vendor_component],
               "unknown vendor Component values did not round-trip unchanged")
    finally:
        bpy.data.scenes.remove(vendor_scene)

    # Disabled built-in drafts are valid portable records: they retain typed
    # defaults and extension fields but may omit values required only when the
    # website behavior runs. Saving and reopening must not reject the whole
    # configured scene, coerce zero-distance audio, or resurrect a cleared
    # object reference from stale raw JSON.
    disabled_draft_scene = bpy.data.scenes.new("Blendlink Disabled Component Drafts")
    disabled_draft_mesh = bpy.data.meshes.new("Blendlink Disabled Draft Target Mesh")
    disabled_draft_target = bpy.data.objects.new(
        "Blendlink Disabled Draft Target", disabled_draft_mesh,
    )
    disabled_draft_scene.collection.objects.link(disabled_draft_target)
    disabled_draft_target["blendlink_id"] = "disabled-draft-target"
    disabled_draft_types = (
        "blendlink.open-url",
        "blendlink.look-at",
        "blendlink.play-animation-on-click",
        "blendlink.audio-source",
        "blendlink.play-audio-on-click",
    )
    try:
        disabled_draft_scene["blendlink_recipe"] = json.dumps({
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [{
                "id": f"disabled-draft-{index}",
                "type": component_type,
                "schemaVersion": 1,
                "enabled": False,
                "target": {
                    "kind": "object",
                    "objectId": "disabled-draft-target",
                    "objectName": disabled_draft_target.name,
                },
                "values": {},
            } for index, component_type in enumerate(disabled_draft_types)],
        })
        expect(props.load_legacy_recipe(disabled_draft_scene),
               "disabled built-in Component drafts did not hydrate on reopen")
        disabled_project = disabled_draft_scene.blendlink_project
        expect(len(disabled_project.components) == len(disabled_draft_types)
               and component_validation.first_blocking_issue(
                   disabled_project, scene=disabled_draft_scene,
               ) is None,
               "disabled incomplete Component drafts became publish blockers")
        disabled_records = props.serialized_components(disabled_project)
        expect(all(record["enabled"] is False for record in disabled_records)
               and props.write_recipe(disabled_draft_scene)["components"]
               == disabled_records,
               "disabled Component drafts could not be written after hydration")

        draft_look_at = next(
            item for item in disabled_project.components
            if item.component_type == "blendlink.look-at"
        )
        draft_look_at.raw_values = json.dumps({
            "targetId": "stale-reference", "targetName": "Deleted Target",
            "studioNote": "preserve",
        })
        expect(props.component_values(
            draft_look_at, require_complete=False,
        )["targetId"] == "stale-reference",
               "an unresolved imported reference was erased before the artist repaired it")
        draft_look_at.reference_object = disabled_draft_target
        draft_look_at.reference_object = None
        serialized_draft_values = props.component_values(
            draft_look_at, require_complete=False,
        )
        clipboard_draft_values = components_ui._component_values_for_clipboard(
            draft_look_at,
        )
        expect("targetId" not in serialized_draft_values
               and "targetName" not in serialized_draft_values
               and serialized_draft_values["studioNote"] == "preserve"
               and "targetId" not in clipboard_draft_values
               and "targetName" not in clipboard_draft_values
               and clipboard_draft_values["studioNote"] == "preserve",
               "clearing a known Component reference resurrected stale raw IDs")

        draft_audio = next(
            item for item in disabled_project.components
            if item.component_type == "blendlink.audio-source"
        )
        components_ui._hydrate_component_atomic(
            draft_audio, {"minDistance": 0, "maxDistance": 10},
            disabled_draft_scene,
        )
        expect(draft_audio.min_distance == 0
               and components_ui._component_values_for_clipboard(
                   draft_audio,
               )["minDistance"] == 0,
               "portable zero Full Volume distance was clamped by Blender RNA")

        draft_audio.audio_url = "/audio/valid.ogg"
        draft_audio.enabled = True
        before_failed_paste = components_ui._component_values_for_clipboard(
            draft_audio,
        )
        incomplete_paste_error = ""
        try:
            components_ui._hydrate_component_atomic(
                draft_audio, {"url": ""}, disabled_draft_scene,
            )
        except ValueError as error:
            incomplete_paste_error = str(error)
        expect("url is required" in incomplete_paste_error
               and components_ui._component_values_for_clipboard(draft_audio)
               == before_failed_paste,
               "enabled incomplete Paste Values reported success or failed to roll back")
        draft_audio.enabled = False

        prior_raw_values = draft_audio.raw_values
        draft_audio.raw_values = "{broken extension json"
        corrupt_issues = component_validation.validate_component(
            disabled_project, draft_audio, scene=disabled_draft_scene,
        )
        serialization_error = ""
        try:
            props.serialized_components(disabled_project)
        except ValueError as error:
            serialization_error = str(error)
        expect(any(issue.code == "invalid_values_json" and issue.blocking
                   for issue in corrupt_issues)
               and "not valid JSON" in serialization_error,
               "corrupt known-Component extension JSON was silently discarded")
        draft_audio.raw_values = prior_raw_values
    finally:
        bpy.data.scenes.remove(disabled_draft_scene)
        bpy.data.objects.remove(disabled_draft_target, do_unlink=True)
        bpy.data.meshes.remove(disabled_draft_mesh)

    malformed_recipes = (
        ("numeric", "preview.samples", {
            "schemaVersion": 1,
            "presentation": "hybrid",
            "preview": {"samples": "many"},
            "atlases": [{"id": "main", "name": "Main", "size": 2048}],
        }),
        ("state", "states[0]", {
            "schemaVersion": 1,
            "presentation": "hybrid",
            "atlases": [{"id": "main", "name": "Main", "size": 2048}],
            "states": ["not-a-state-record"],
        }),
        ("duplicate atlas", "duplicate atlas id", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}, {"id": "main"}],
        }),
        ("unstable atlas id", "lowercase stable slug", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}, {"id": "Hero Face"}],
        }),
        ("atlas policy", "fitPolicy", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main", "fitPolicy": "squeeze"}],
        }),
        ("atlas size", "between 128 and 8192", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main", "size": 64}],
        }),
        ("atlas record", "atlases[1] must be an object", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}, "not-an-atlas"],
        }),
        ("probe record", "reflectionProbes[0]", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}], "reflectionProbes": [42],
        }),
        ("composition record", "camera.compositions[0]", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}], "camera": {"compositions": [None]},
        }),
        ("component record", "components[0] must be an object", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}], "components": ["not-a-component"],
        }),
        ("component type case", "lowercase vendor-namespaced", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [{
                "id": "mixed-case", "type": "Blendlink.Bloom",
                "schemaVersion": 1, "enabled": True,
                "target": {"kind": "scene"}, "values": {},
            }],
        }),
        ("duplicate component id", "duplicate component id", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [{
                "id": "duplicate-component", "type": "blendlink.bloom",
                "schemaVersion": 1, "enabled": True,
                "target": {"kind": "scene"}, "values": {},
            }, {
                "id": "duplicate-component", "type": "studio.sparkle",
                "schemaVersion": 1, "enabled": True,
                "target": {"kind": "scene"}, "values": {},
            }],
        }),
        ("duplicate one-per-scene component", "duplicates a one-per-scene behavior", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [{
                "id": "bloom-a", "type": "blendlink.bloom",
                "schemaVersion": 1, "enabled": True,
                "target": {"kind": "scene"}, "values": {},
            }, {
                "id": "bloom-b", "type": "blendlink.bloom",
                "schemaVersion": 1, "enabled": True,
                "target": {"kind": "scene"}, "values": {},
            }],
        }),
        ("required component value", "components[0].values.url is required", {
            "schemaVersion": 1, "presentation": "hybrid",
            "atlases": [{"id": "main"}],
            "components": [{
                "id": "open-link", "type": "blendlink.open-url",
                "schemaVersion": 1, "enabled": True,
                "target": {
                    "kind": "object", "objectId": "missing-object",
                    "objectName": "Missing Object",
                },
                "values": {"newTab": True},
            }],
        }),
    )
    for label, expected_error, malformed_recipe in malformed_recipes:
        malformed_scene = bpy.data.scenes.new(f"Blendlink Malformed {label.title()}")
        try:
            original_recipe = json.dumps(malformed_recipe)
            malformed_scene["blendlink_recipe"] = original_recipe
            malformed_log = StringIO()
            with redirect_stdout(malformed_log):
                loaded = props.load_legacy_recipe(malformed_scene)
            malformed_project = malformed_scene.blendlink_project
            expect(
                not loaded
                and not malformed_project.configured
                and len(malformed_project.atlases) == 0
                and len(malformed_project.states) == 0
                and len(malformed_project.components) == 0
                and malformed_scene["blendlink_recipe"] == original_recipe
                and expected_error in malformed_project.recipe_error
                and "BLENDLINK_RECIPE_ERROR" in malformed_log.getvalue(),
                f"malformed {label} recipe left a partial configured scene",
            )
        finally:
            bpy.data.scenes.remove(malformed_scene)

    # --- authored/effective rendering intent stays visible, including mixes ---
    journey_auto = make_cube("Journey Automatic")
    journey_realtime = make_cube("Journey Realtime")
    journey_baked = make_cube("Journey Baked")
    journey_excluded = bpy.data.objects.new("Journey Guide-noimp", None)
    bpy.context.scene.collection.objects.link(journey_excluded)
    journey_realtime["blendlink_dynamic"] = True
    journey_realtime["blendlink_atlas"] = "hero"
    journey_realtime["blendlink_active"] = False
    journey_realtime["blendlink_cast_shadow"] = True
    journey_realtime["blendlink_receive_shadow"] = False
    journey_realtime["blendlink_reflection_probe"] = "studio-probe"
    journey_baked["blendlink_dynamic"] = False
    journey_baked["blendlink_atlas"] = "main"
    journey_baked["blendlink_cast_shadow"] = False
    journey_baked["blendlink_receive_shadow"] = False
    journey_selection = [
        journey_auto, journey_realtime, journey_baked, journey_excluded,
    ]
    summary = ui_state.summarize_selection(journey_selection)
    expect(summary["rendering"]["value"] == ui_state.MIXED
           and summary["rendering"]["counts"] == {
        "AUTO": 1, "DYNAMIC": 1, "BAKED": 1,
    }, f"mixed rendering selection was not truthful: {summary['rendering']}")
    expect(summary["atlas"]["value"] == ui_state.MIXED
           and summary["atlas"]["counts"] == {
               "AUTO": 1, "hero": 1, "main": 1,
           }, f"mixed atlas selection was not truthful: {summary['atlas']}")
    expect(summary["visibility"]["value"] == ui_state.MIXED
           and summary["visibility"]["counts"] == {
               "VISIBLE": 3, "HIDDEN": 1,
           }, f"mixed visibility selection was not truthful: {summary['visibility']}")
    expect(summary["shadows"]["value"] == ui_state.MIXED
           and summary["shadows"]["counts"] == {
               "AUTO": 1, "BOTH": 0, "CAST": 1, "RECEIVE": 0, "NONE": 1,
           }, f"mixed shadow selection was not truthful: {summary['shadows']}")
    expect(summary["reflections"]["value"] == ui_state.MIXED
           and summary["reflections"]["counts"] == {
               "SCENE": 2, "studio-probe": 1,
           }, f"mixed reflection selection was not truthful: {summary['reflections']}")
    expect(summary["inclusion"]["value"] == ui_state.MIXED
           and summary["inclusion"]["counts"] == {
               "INCLUDED": 3, "EXCLUDED": 1,
           }, f"mixed inclusion selection was not truthful: {summary['inclusion']}")
    collider_role = vocab.classify(crate.name, {key: crate[key] for key in crate.keys()})
    expect(ui._role_heading(collider_role, 2).startswith("This Object Role ·")
           and ui._role_heading(None, 2) == "This Object Role · No special web role",
           "multi-selection semantic detail was not labeled as active-object-only")

    # A dirty or missing analysis cache is an honest pending state. Drawing it
    # must never fall back to walking animation, modifiers, or material graphs.
    validation.mark_dirty()
    analyzer_calls = []
    real_dynamic_reason = validation.procedural.dynamic_reason
    real_forced_bake_risk = validation.procedural.forced_bake_risk

    def forbidden_draw_analysis(obj):
        analyzer_calls.append(obj.name)
        raise AssertionError(f"draw rescanned web-rendering policy for {obj.name}")

    validation.procedural.dynamic_reason = forbidden_draw_analysis
    validation.procedural.forced_bake_risk = forbidden_draw_analysis
    try:
        pending_layout = RecordingLayout()
        ui._draw_atlas_controls(
            pending_layout, journey_auto, bpy.context,
            selection=journey_selection, summaries=summary,
        )
        pending_mode, pending_reason = ui._effective_rendering(journey_auto, project)
    finally:
        validation.procedural.dynamic_reason = real_dynamic_reason
        validation.procedural.forced_bake_risk = real_forced_bake_risk
    pending_text = [event[-1] for event in pending_layout.events]
    expect(not analyzer_calls
           and pending_mode == "PENDING" and "pending" in pending_reason
           and any(text.startswith("Effective") and "Checking" in text
                   for text in pending_text)
           and not any(text.startswith("Atlas:") for text in pending_text),
           f"initial web-rendering analysis was not truthful and draw-pure: {pending_text}")

    validation.recompute(bpy.context.scene)
    cached_analysis = validation.result().rendering_analysis
    expect(all(item.name in cached_analysis for item in journey_selection if item.type == "MESH")
           and cached_analysis[journey_realtime.name].dynamic_reason
           == "explicitly marked Realtime",
           f"validation did not cache selected web-rendering facts: {cached_analysis}")
    rendering_source_before = handlers._bake_table_source_token()
    journey_auto["blendlink_dynamic"] = True
    validation.recompute(bpy.context.scene)
    expect(handlers._bake_table_source_token() != rendering_source_before,
           "changed rendering analysis did not invalidate the bake table")
    del journey_auto["blendlink_dynamic"]
    validation.recompute(bpy.context.scene)

    analyzer_calls.clear()
    validation.procedural.dynamic_reason = forbidden_draw_analysis
    validation.procedural.forced_bake_risk = forbidden_draw_analysis
    rendering_layout = RecordingLayout()
    try:
        ui._draw_atlas_controls(
            rendering_layout, journey_auto, bpy.context,
            selection=journey_selection, summaries=summary,
        )
        cached_effective = {
            item.name: ui._effective_rendering(item, project)
            for item in (journey_auto, journey_realtime, journey_baked)
        }
    finally:
        validation.procedural.dynamic_reason = real_dynamic_reason
        validation.procedural.forced_bake_risk = real_forced_bake_risk
    rendering_text = [event[-1] for event in rendering_layout.events]
    expect(not analyzer_calls
           and cached_effective[journey_auto.name][0] == "BAKED"
           and cached_effective[journey_realtime.name][0] == "DYNAMIC"
           and cached_effective[journey_baked.name][0] == "BAKED",
           f"cached effective rendering called procedural analyzers: {analyzer_calls}")
    expect(any(text.startswith("Mixed") and "Automatic" in text
               and "Realtime" in text and "Baked" in text
               for text in rendering_text),
           f"mixed rendering counts did not reach the object UI: {rendering_text}")
    expect(any(text.startswith("Atlas: Mixed") for text in rendering_text),
           f"mixed atlas counts did not reach the object UI: {rendering_text}")
    nonmesh_active_layout = RecordingLayout()
    ui._draw_atlas_controls(
        nonmesh_active_layout, journey_excluded, bpy.context,
        selection=journey_selection, summaries=summary,
    )
    expect(any(event[-1] == "Web Rendering · 3 meshes"
               for event in nonmesh_active_layout.events),
           "eligible selected meshes disappeared when the active object was not a mesh")

    runtime_layout = RecordingLayout()
    ui._draw_runtime_controls(
        runtime_layout, journey_auto, bpy.context,
        selection=journey_selection, summaries=summary,
    )
    runtime_text = [event[-1] for event in runtime_layout.events]
    expect(any(text.startswith("Mixed") and "visible" in text and "hidden" in text
               for text in runtime_text),
           f"mixed visibility counts did not reach the object UI: {runtime_text}")
    expect(any(text.startswith("Shadows: Mixed") for text in runtime_text),
           f"mixed shadow counts did not reach the object UI: {runtime_text}")
    expect(any(text.startswith("Reflections: Mixed") for text in runtime_text),
           f"mixed reflection counts did not reach the object UI: {runtime_text}")
    expect(ui._authored_rendering_mode(journey_auto) == "AUTO"
           and ui._authored_rendering_mode(journey_realtime) == "DYNAMIC"
           and ui._authored_rendering_mode(journey_baked) == "BAKED",
           "authored Automatic/Realtime/Baked state was not stable")
    effective, reason = ui._effective_rendering(journey_auto, project)
    expect(effective == "BAKED" and "Automatic" in reason,
           f"safe automatic mesh did not explain its baked result: {(effective, reason)}")
    effective, reason = ui._effective_rendering(journey_realtime, project)
    expect(effective == "DYNAMIC" and "explicitly marked Realtime" in reason,
           f"Realtime override did not explain its result: {(effective, reason)}")
    effective, reason = ui._effective_rendering(journey_baked, project)
    expect(effective == "BAKED" and "Main uses Bake Lighting" in reason
           and "preserving PBR" in reason,
           f"explicit Baked lighting consequence was stale: {(effective, reason)}")
    project.atlases[0].bake_output = "APPEARANCE"
    # Project edits deliberately show Checking until the shared timer refreshes
    # procedural evidence; simulate that timer before asserting the explanation.
    validation.recompute(bpy.context.scene)
    effective, reason = ui._effective_rendering(journey_baked, project)
    expect(effective == "BAKED" and "Main uses Bake Appearance" in reason
           and "final stylized look" in reason,
           f"explicit Baked appearance consequence was unclear: {(effective, reason)}")
    project.atlases[0].bake_output = "LIGHTING"
    project.presentation = "REALTIME"
    effective, reason = ui._effective_rendering(journey_baked, project)
    expect(effective == "DYNAMIC" and "Web Presentation is Realtime" in reason,
           f"scene-level Realtime did not explain the retained object choice: {(effective, reason)}")
    project.presentation = "HYBRID"
    for item in (journey_auto, journey_realtime, journey_baked):
        mesh = item.data
        bpy.data.objects.remove(item, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    bpy.data.objects.remove(journey_excluded, do_unlink=True)
    select_only(crate, rock)

    expect(presentation.parse_frame_spec(
        "start,3-7x2,end", current=4, start=1, end=10,
    ) == [1, 3, 5, 7, 10], "artist frame/pose expression resolved incorrectly")
    overlay_geometry = presentation.overlay_geometry(
        (0, 0, 1000, 800), (100, 100, 900, 700), 0.1,
    )
    expect(overlay_geometry["safe"] == (180, 160, 820, 640)
           and len(overlay_geometry["crop"]) == 4,
           f"responsive crop/safe geometry is wrong: {overlay_geometry}")
    matrix = presentation.build_reference_matrix(
        source_blend="hero.blend",
        cameras=[
            {"objectId": "camera-a", "objectName": "Hero"},
            {"objectId": "camera-b", "objectName": "Detail"},
        ],
        states=[
            {"name": "day", "hideCollections": []},
            {"name": "night", "hideCollections": ["Day Lights"]},
        ],
        compositions=[
            {"name": "Desktop", "width": 1000, "height": 600, "safeMargin": 0.1},
            {"name": "Mobile", "width": 400, "height": 800, "safeMargin": 0.08},
        ],
        frame_spec="1,5", current_frame=1, frame_start=1, frame_end=10,
        fps=24.0, device_pixel_ratio=2.0,
    )
    expect(matrix["matrix"] == {
        "cameraCount": 2, "lightingStateCount": 2, "compositionCount": 2,
        "poseCount": 2, "qualityCount": 2, "blenderReferenceCount": 16,
        "comparisonCount": 32,
    }, f"reference matrix did not build the complete cross product: {matrix['matrix']}")
    expect(all(cell["browser"]["status"] == "required" for cell in matrix["comparisons"]),
           "browser pixels were not left explicitly required")
    expect(matrix["browserAuditAdapter"]["export"] == "runVisualReferenceAudit"
           and matrix["browserAuditAdapter"]["comparisonSpace"] == "premultiplied-rgba",
           "reference matrix did not describe its concrete browser/diff adapter")
    expect({cell["quality"] for cell in matrix["comparisons"]} == {"preview", "final"},
           "reference matrix omitted Preview or Final")
    reference_settings = bpy.context.scene.blendlink_reference
    reference_settings.device_pixel_ratio = 0.5
    reference_settings.last_manifest = "C:/old-reference-folder/comparison-manifest.json"
    reference_settings.last_plan_signature = presentation_ui._matrix_input_signature(
        bpy.context.scene, project, reference_settings,
    )
    presentation_ui.prepare_cache(bpy.context.scene, force=True)
    expect(presentation_ui._plan_is_current(
        bpy.context.scene, project, reference_settings,
    ), "fresh comparison-plan evidence was not recognized")
    reference_settings.device_pixel_ratio = 1.0
    expect(not presentation_ui._plan_is_current(
        bpy.context.scene, project, reference_settings,
    ), "comparison counts stayed current after DPR changed")
    reference_settings.device_pixel_ratio = 0.5
    presentation_ui.prepare_cache(bpy.context.scene, force=True)
    expect(presentation_ui._plan_is_current(
        bpy.context.scene, project, reference_settings,
    ), "restoring comparison inputs did not restore its evidence signature")
    expect("last_manifest" not in
           presentation_ui.BLENDLINK_OT_open_reference_folder.execute.__code__.co_names,
           "Open Reference Folder still preferred an obsolete plan folder")
    prior_dimensions = (
        bpy.context.scene.render.resolution_x,
        bpy.context.scene.render.resolution_y,
    )
    prior_camera = bpy.context.scene.camera
    bpy.context.scene.camera = None
    bpy.ops.blendlink.preview_composition()
    expect(reference_settings.preview_active
           and bpy.context.scene.render.resolution_x == 720
           and bpy.context.scene.render.resolution_y == 450,
           "selected composition did not apply its DPR backing frame")
    handlers._save_pre("")
    expect(not reference_settings.preview_active
           and bpy.context.scene.camera is None
           and (
               bpy.context.scene.render.resolution_x,
               bpy.context.scene.render.resolution_y,
           ) == prior_dimensions
           and not reference_settings.last_plan_signature,
           "saving persisted a temporary Responsive Frame preview or stale plan evidence")
    bpy.context.scene.camera = prior_camera
    bpy.ops.blendlink.preview_composition()
    bpy.ops.blendlink.stop_composition_preview()
    expect(not reference_settings.preview_active and (
        bpy.context.scene.render.resolution_x,
        bpy.context.scene.render.resolution_y,
    ) == prior_dimensions, "composition preview did not restore render dimensions")
    validation._state["dirty"] = False
    history_table_token = handlers._bake_table_change_token
    handlers._active_object_token = (1, "stale")
    handlers._scene_inventory_token = (1, 1)
    handlers._recipe_hydration_token = (1, "stale")
    handlers._history_post(bpy.context.scene)
    expect(validation.is_dirty()
           and handlers._bake_table_change_token > history_table_token
           and handlers._active_object_token is None
           and handlers._scene_inventory_token is None
           and handlers._recipe_hydration_token is None,
           "Undo/Redo did not invalidate every cached artist-facing view")
    ops._set_checker_mode("SAVED")
    handlers._scene_inventory_token = (
        bpy.context.scene.as_pointer(), len(bpy.context.scene.objects) + 1,
    )
    handlers._depsgraph_update_post(
        bpy.context.scene, SimpleNamespace(updates=[]),
    )
    expect(ops.checker_mode_cached() is None,
           "object removal left the cached checker action stale")
    project.camera_behavior = "ORBIT"
    project.camera_target = focus
    project.camera_framing = "FIT_TARGET"
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["camera"]["targetId"] == focus["blendlink_id"]
           and recipe["camera"]["framing"] == "fit-target",
           "orbit target/framing was not stored by stable ID and explicit fit intent")
    project.geometry_optimization = "MESHOPT"
    project.texture_optimization = "KTX2"
    project.animation_start = "NAMED"
    project.animation_clip = "Hero Reveal"
    project.animation_loop = "ONCE"
    project.animation_speed = 0.75
    project.tone_mapping = "AGX"
    project.look_exposure = -1.0
    project.background_mode = "COLOR"
    project.background_color = (0.1, 0.2, 0.3)
    project.fog_mode = "LINEAR"
    project.fog_color = (0.2, 0.25, 0.3)
    project.fog_near = 8.0
    project.fog_far = 60.0
    look_recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(look_recipe["look"]["toneMapping"] == "agx"
           and look_recipe["look"]["exposure"] == -1.0
           and look_recipe["look"]["background"] == "color"
           and all(abs(a - b) < 1e-6 for a, b in zip(
               look_recipe["look"]["backgroundColor"], [0.1, 0.2, 0.3]
           )) and look_recipe["fog"]["mode"] == "linear"
           and look_recipe["fog"]["near"] == 8.0
           and look_recipe["fog"]["far"] == 60.0,
           "artist website look/fog was not stored in the scene recipe")
    project.shadow_preset = "SOFT"
    environment_image = bpy.data.images.new("Studio Environment", width=64, height=32, float_buffer=True)
    environment_image.filepath_raw = "//studio.hdr"
    environment_image.file_format = "HDR"
    project.environment_source = "IMAGE"
    project.environment_image = environment_image
    project.environment_lighting = "IMAGE"
    project.environment_background = "GROUNDED"
    project.environment_lighting_intensity = 1.5
    project.environment_ground_height = 1.7
    project.environment_ground_radius = 90.0
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["optimization"]["geometry"] == "meshopt",
           "artist geometry optimization choice was not stored in the scene recipe")
    expect(recipe["optimization"]["textures"] == "ktx2",
           "artist GPU texture optimization choice was not stored in the scene recipe")
    expect(recipe["playback"] == {
        "start": "named", "clip": "Hero Reveal", "loop": "once", "speed": 0.75,
    }, "artist animation startup intent was not stored in the scene recipe")

    # --- one-track NLA sequence: Blender stays the timeline editor ---
    nla_sequence_render_hidden = nla_mesh.hide_render
    nla_mesh.hide_render = False
    first_sequence_strip = nla_track.strips[0]
    first_sequence_strip.name = "Enter Strip"
    first_sequence_strip.extrapolation = "NOTHING"
    second_action = nla_action.copy()
    second_action.name = "Settle Action"
    second_sequence_strip = nla_track.strips.new(
        "Settle Strip", int(math.ceil(first_sequence_strip.frame_end + 2)), second_action,
    )
    second_sequence_strip.blend_type = "ADD"
    second_sequence_strip.extrapolation = "HOLD_FORWARD"
    second_sequence_strip.use_reverse = True
    second_sequence_strip.mute = True
    project.animation_sequence_source = nla_mesh
    project.animation_sequence_name = "Hero Story"
    project.animation_sequence_track = nla_track.name
    project.animation_sequence_loop = True
    project.animation_sequence_speed = 1.25
    project.animation_sequence_easing = "EASE_IN_OUT"
    project.animation_sequence_enabled = True
    sequence_recipe = props.write_recipe(bpy.context.scene)["animationSequence"]
    expect(sequence_recipe["name"] == "Hero Story"
           and sequence_recipe["source"]["objectId"] == nla_mesh["blendlink_id"]
           and sequence_recipe["source"]["track"] == "Website motion"
           and sequence_recipe["loop"] is True
           and abs(sequence_recipe["speed"] - 1.25) < 1e-6
           and [strip["order"] for strip in sequence_recipe["strips"]] == [0, 1]
           and [strip["clip"] for strip in sequence_recipe["strips"]]
           == [nla_action.name, second_action.name]
           and sequence_recipe["strips"][0]["extrapolation"] == "nothing"
           and sequence_recipe["strips"][1]["blend"] == "add"
           and sequence_recipe["strips"][1]["reverse"] is True
           and sequence_recipe["strips"][1]["muted"] is True
           and sequence_recipe["strips"][1]["easing"] == "ease-in-out",
           f"NLA sequence did not preserve portable strip metadata: {sequence_recipe}")
    nla_sequence_module.validate_published_sequence(
        sequence_recipe, bpy.context.scene,
    )
    nla_mesh.hide_render = True
    try:
        nla_sequence_module.validate_published_sequence(
            sequence_recipe, bpy.context.scene,
        )
    except ValueError as error:
        expect("disabled in renders" in str(error) and "camera icon" in str(error),
               f"hidden NLA source failure was not actionable: {error}")
    else:
        raise AssertionError("render-hidden NLA source was silently accepted")
    nla_mesh.hide_render = False
    prior_strip_name = second_sequence_strip.name
    second_sequence_strip.name = "Changed After Save"
    try:
        nla_sequence_module.validate_published_sequence(
            sequence_recipe, bpy.context.scene,
        )
    except ValueError as error:
        expect("no longer matches" in str(error),
               f"stale NLA metadata failure was not actionable: {error}")
    else:
        raise AssertionError("stale NLA metadata was silently published")
    second_sequence_strip.name = prior_strip_name
    prior_blend = second_sequence_strip.blend_type
    second_sequence_strip.blend_type = "COMBINE"
    try:
        nla_sequence_module.collect_project_sequence(project, bpy.context.scene)
    except ValueError as error:
        expect("Blender-only" in str(error) and "Replace or Add" in str(error),
               f"non-portable NLA blend failure was unclear: {error}")
    else:
        raise AssertionError("non-portable NLA blend was silently approximated")
    second_sequence_strip.blend_type = prior_blend
    supported_exporter_properties = {
        prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    sequence_export_policy = nla_sequence_module.exporter_policy(
        supported_exporter_properties, {}, True,
    )
    expect(sequence_export_policy.get("export_animation_mode") == "ACTIONS"
           and sequence_export_policy.get("export_anim_slide_to_zero") is True,
           f"NLA sequence Action export policy drifted: {sequence_export_policy}")
    try:
        nla_sequence_module.exporter_policy(set(), {}, True)
    except ValueError as error:
        expect("Update Blender" in str(error) and "export_animation_mode" in str(error),
               f"unsupported NLA exporter failure was unclear: {error}")
    else:
        raise AssertionError("unsupported glTF exporter silently accepted NLA Sequence")
    try:
        nla_sequence_module.exporter_policy(
            supported_exporter_properties,
            {"export_anim_slide_to_zero": False},
            True,
        )
    except ValueError as error:
        expect("conflicts" in str(error),
               f"conflicting NLA exporter override was unclear: {error}")
    else:
        raise AssertionError("conflicting NLA exporter override was accepted")
    with tempfile.TemporaryDirectory(prefix="blendlink-nla-sequence-") as sequence_tmp:
        sequence_glb = Path(sequence_tmp) / "sequence.glb"
        sequence_kwargs, _sequence_dropped = exporter.gltf_export_contract(
            str(sequence_glb), {"_animationSequence": True},
        )
        # With one authored strip muted, Blender already discovers the lone
        # live Action. Blendlink should stage only the otherwise missing one
        # and must not mutate either authored mute flag.
        authored_mutes = [strip.mute for strip in nla_track.strips]
        partial_restore = nla_sequence_module.prepare_action_export(
            sequence_recipe, bpy.context.scene,
        )
        expect(len(partial_restore["temporaryTracks"]) == 1
               and [strip.mute for strip in nla_track.strips] == authored_mutes,
               "Action staging changed authored mutes or duplicated an exportable Action")
        nla_sequence_module.restore_action_export(partial_restore)

        # The common two-live-strip case is skipped wholesale by Blender's
        # ACTIONS mode, so exercise the real export with both source Actions
        # supplied by muted, evaluation-neutral stash tracks.
        second_sequence_strip.mute = False
        export_sequence_recipe = nla_sequence_module.collect_project_sequence(
            project, bpy.context.scene,
        )
        authored_mutes = [strip.mute for strip in nla_track.strips]
        authored_track_count = len(nla_mesh.animation_data.nla_tracks)
        sequence_restore = nla_sequence_module.prepare_action_export(
            export_sequence_recipe, bpy.context.scene,
        )
        expect(len(sequence_restore["temporaryTracks"]) == 2
               and [strip.mute for strip in nla_track.strips] == authored_mutes,
               "multi-strip Action staging was incomplete or changed the NLA timeline")
        try:
            bpy.ops.export_scene.gltf(**sequence_kwargs)
        finally:
            nla_sequence_module.restore_action_export(sequence_restore)
        expect(len(nla_mesh.animation_data.nla_tracks) == authored_track_count
               and [strip.mute for strip in nla_track.strips] == authored_mutes
               and nla_mesh.hide_render is False,
               "temporary Action export did not restore exact authored NLA state")
        sequence_document, _chunks, _json_index = exporter._read_glb_document(
            str(sequence_glb), "inspect Animation Sequence",
        )
        exported_actions = {
            animation.get("name") for animation in sequence_document.get("animations", [])
        }
        expect({nla_action.name, second_action.name} <= exported_actions,
               f"NLA source Actions were not exported as named clips: {exported_actions}")
        for animation in sequence_document.get("animations", []):
            if animation.get("name") not in {nla_action.name, second_action.name}:
                continue
            starts = []
            for sampler in animation.get("samplers", []):
                accessor = sequence_document["accessors"][sampler["input"]]
                starts.extend(accessor.get("min", []))
            expect(starts and min(starts) >= -1e-7 and min(starts) <= 1e-7,
                   f"Action clip {animation.get('name')!r} was not slid to zero: {starts}")
        second_sequence_strip.mute = True
    project.animation_sequence_enabled = False
    nla_mesh.hide_render = nla_sequence_render_hidden
    expect(recipe["look"]["background"] == "application",
           "visible HDR background did not take clear ownership from Website Look")
    expect(recipe["shadows"]["preset"] == "soft"
           and recipe["shadows"]["filter"] == "vsm"
           and recipe["shadows"]["mapSize"] == 2048,
           "artist shadow preset was not resolved into a portable budget")
    expect(recipe["environment"]["imageName"] == environment_image.name
           and recipe["environment"]["lighting"] == "image"
           and recipe["environment"]["background"] == "grounded"
           and abs(recipe["environment"]["groundHeight"] - 1.7) < 1e-6,
           "independent HDR lighting/background intent was not stored")

    # --- named local reflection probes: visible volume + explicit assignment ---
    select_only(crate, rock)
    validation._state["dirty"] = False
    bpy.ops.blendlink.add_reflection_probe()
    expect(len(project.reflection_probes) == 1 and validation.is_dirty(),
           "reflection probe creation did not invalidate conversion checks")
    probe = project.reflection_probes[0]
    helper = probe.probe_object
    expect(helper is not None and helper.type == "EMPTY",
           "reflection probe did not create an exported helper Empty")
    expect(crate.get("blendlink_reflection_probe") == probe.object_id
           and rock.get("blendlink_reflection_probe") == probe.object_id,
           "selected meshes were not explicitly assigned to the new probe")
    probe.name = "Hero Reflections"
    probe.shape = "SPHERE"
    probe.resolution = "128"
    probe.influence = 12.0
    probe.intensity = 1.25
    probe.anchor = focus
    expect(helper.empty_display_type == "SPHERE"
           and abs(helper.empty_display_size - 12.0) < 1e-6
           and helper.get("blendlink_probe_resolution") == 128,
           "probe helper gizmo/metadata did not follow artist settings")
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["reflectionProbes"] == [{
        "id": "hero-reflections", "name": "Hero Reflections",
        "objectId": probe.object_id, "objectName": helper.name,
        "shape": "sphere", "source": "runtime", "resolution": 128,
        "samples": 128, "influence": 12.0,
        "intensity": 1.25, "anchorId": focus["blendlink_id"],
        "anchorName": focus.name,
    }], "named reflection probe contract was not stored in the scene recipe")

    # The UIList index is session-only, but it selects the active cached guide.
    # Switching probes must invalidate that cache without rewriting recipe
    # intent, and the next build must follow the selected probe.
    select_only(crate)
    bpy.ops.blendlink.add_reflection_probe()
    expect(len(project.reflection_probes) == 2,
           "active-probe guide fixture could not create a second probe")
    second_probe = project.reflection_probes[1]
    second_probe.name = "Secondary Reflections"
    second_probe.influence = 4.0
    validation._state["dirty"] = False
    project.reflection_probe_index = 0
    expect(validation.is_dirty(),
           "changing the active Reflection Probe did not invalidate its guide")
    first_probe_guide = consequence_gizmos.build(
        bpy.context.scene, project=project, selected_objects=(),
        light_diagnostics={},
    )
    validation._state["dirty"] = False
    project.reflection_probe_index = 1
    second_probe_guide = consequence_gizmos.build(
        bpy.context.scene, project=project, selected_objects=(),
        light_diagnostics={},
    )
    expect(validation.is_dirty()
           and "Hero Reflections" in first_probe_guide.items[0].label
           and "Secondary Reflections" in second_probe_guide.items[0].label,
           "active Reflection Probe selection kept a stale cached guide")
    bpy.ops.blendlink.remove_reflection_probe()
    expect(len(project.reflection_probes) == 1
           and project.reflection_probes[0].name == "Hero Reflections",
           "active-probe guide fixture did not restore the authored probe")
    crate["blendlink_reflection_probe"] = probe.object_id
    select_only(crate)
    validation._state["dirty"] = False
    bpy.ops.blendlink.clear_reflection_probe()
    expect("blendlink_reflection_probe" not in crate and validation.is_dirty(),
           "Use Scene Environment did not invalidate conversion checks")
    validation._state["dirty"] = False
    bpy.ops.blendlink.assign_reflection_probe()
    expect(crate.get("blendlink_reflection_probe") == probe.object_id
           and validation.is_dirty(),
           "Assign Selected did not invalidate conversion checks")

    # Selection tools remain safe when a member lives in an excluded collection,
    # and are unavailable in Edit Mode where Blender cannot select whole objects.
    excluded_collection = bpy.data.collections.new("Excluded Probe Members")
    bpy.context.scene.collection.children.link(excluded_collection)
    excluded_probe_member = make_cube("Excluded Probe Mesh")
    for collection in list(excluded_probe_member.users_collection):
        collection.objects.unlink(excluded_probe_member)
    excluded_collection.objects.link(excluded_probe_member)
    excluded_probe_member["blendlink_reflection_probe"] = probe.object_id
    excluded_layer = bpy.context.view_layer.layer_collection.children[excluded_collection.name]
    select_only(crate)
    excluded_probe_member.hide_select = True
    selected_hidden, skipped_hidden = ops._select_only(
        bpy.context, [excluded_probe_member],
    )
    expect(not selected_hidden and skipped_hidden == 1
           and crate.select_get() and not excluded_probe_member.select_get(),
           "failed member navigation destroyed the artist's prior selection")
    excluded_probe_member.hide_select = False
    excluded_layer.exclude = True
    select_only(crate)
    bpy.ops.object.mode_set(mode="EDIT")
    expect(not ops.BLENDLINK_OT_add_reflection_probe.poll(bpy.context)
           and not ops.BLENDLINK_OT_select_reflection_probe_members.poll(bpy.context)
           and not ops.BLENDLINK_OT_select_atlas_objects.poll(bpy.context)
           and not ops.BLENDLINK_OT_select_authored_atlas_members.poll(bpy.context)
           and not ops.BLENDLINK_OT_select_issue.poll(bpy.context),
           "whole-object selection tools remained available in Edit Mode")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.blendlink.select_reflection_probe_members()
    expect({obj.name for obj in bpy.context.selected_objects} == {crate.name, rock.name},
           "Select Assigned Meshes reached outside the active view layer")
    excluded_layer.exclude = False
    bpy.data.objects.remove(excluded_probe_member, do_unlink=True)
    bpy.context.scene.collection.children.unlink(excluded_collection)
    bpy.data.collections.remove(excluded_collection)

    validation._state["dirty"] = False
    bpy.ops.blendlink.remove_reflection_probe()
    expect(len(project.reflection_probes) == 0 and validation.is_dirty(),
           "reflection probe removal did not invalidate conversion checks")

    bpy.ops.blendlink.remove_composition()
    expect(len(project.compositions) == 1, "composition removal failed")
    bpy.ops.blendlink.add_composition()
    expect(len(project.compositions) == 2, "composition add failed")
    expect(all(isinstance(obj.get("blendlink_id"), str) for obj in bpy.context.scene.objects),
           "setup did not assign stable IDs")
    bpy.ops.blendlink.add_atlas()
    expect(len(project.atlases) == 2, "Add Atlas from Selection did not add an atlas")
    expect(project.atlases[1].bake_output == "LIGHTING",
           "new additional atlases must recommend the detail-preserving lighting bake")
    hero_id = project.atlases[1].atlas_id
    project.atlases[1].name = "Hero Face"
    expect(ops._atlas_display_name(project, hero_id) == "Hero Face"
           and ui._atlas_display_name(project, hero_id) == "Hero Face"
           and ui._atlas_display_name(project, "atlas-99") == "Atlas 99",
           "artist-facing atlas names leaked internal IDs")
    expect(crate["blendlink_atlas"] == hero_id and rock["blendlink_atlas"] == hero_id,
           "new atlas was not assigned to the selected meshes")
    bpy.ops.blendlink.select_authored_atlas_members(atlas_id=hero_id)
    expect({obj.name for obj in bpy.context.selected_objects} == {crate.name, rock.name},
           "Select Assigned Meshes did not use live authored atlas assignments")
    select_only(crate)
    bpy.ops.blendlink.set_atlas(atlas="__AUTO__")
    expect("blendlink_atlas" not in crate,
           "Move Selection to Main did not clear the authored atlas override")
    bpy.ops.blendlink.set_atlas(atlas=hero_id)
    expect(crate.get("blendlink_atlas") == hero_id,
           "Move Selection Here did not restore the artist-named atlas")
    select_only(crate, rock)
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["atlases"][0]["id"] == "main" and recipe["atlases"][1]["id"] == hero_id,
           "native atlas controls did not update canonical recipe JSON")
    project.atlases[1].bake_output = "APPEARANCE"
    recipe = json.loads(bpy.context.scene["blendlink_recipe"])
    expect(recipe["atlases"][1]["bakeOutput"] == "appearance",
           "artist Bake Appearance choice was not stored in the canonical recipe")
    bpy.ops.blendlink.remove_atlas()
    expect(len(project.atlases) == 1, "additional atlas was not removed")
    expect("blendlink_atlas" not in crate and "blendlink_atlas" not in rock,
           "removed-atlas members did not return to Main")
    select_only(crate)
    bpy.ops.blendlink.set_shading(mode="DYNAMIC")
    expect(crate["blendlink_dynamic"] == 1, "Realtime rendering designation failed")
    bpy.ops.blendlink.set_shading(mode="BAKED")
    expect(crate["blendlink_dynamic"] == 0, "Baked rendering designation failed")

    # --- one-owner explanations + evidence-gated Blender version warnings ---
    decisions = {item.key: item for item in ownership.decisions(project)}
    expect(decisions["camera"].owner == "BLEND",
           "designated presentation camera ownership was not explained")
    expect(decisions["background"].owner == "BLEND"
           and "HDR Environment owns" in decisions["background"].reason,
           "HDR/Website Look precedence did not use the generalized ownership contract")
    expect(decisions["fog"].owner == "BLEND"
           and "distance recipe" in decisions["fog"].reason,
           "scene-owned distance fog was not included in Website Ownership")
    expect(decisions["integration"].owner == "CONFIG"
           and decisions["artifacts"].owner == "OUTPUT",
           "project integration and derived artifacts did not name distinct owners")
    expect(known_issues.load_registry()["issues"] == [],
           "checked-in known-issue registry should stay empty without primary evidence")
    fixture_registry = known_issues.validate_registry({
        "schemaVersion": 1,
        "policy": "Primary evidence only.",
        "issues": [{
            "id": "fixture-export-regression",
            "summary": "Fixture export regression.",
            "action": "Use a supported patch release.",
            "severity": "warning",
            "minInclusive": "5.1.0",
            "maxExclusive": "5.1.3",
            "evidence": ["https://projects.blender.org/blender/blender/issues/123"],
        }],
    })
    expect(len(known_issues.matching((5, 1, 2), fixture_registry)) == 1
           and not known_issues.matching((5, 1, 3), fixture_registry),
           "bounded Blender known-issue matching drifted")
    unbounded_rejected = False
    try:
        known_issues.validate_registry({
            "schemaVersion": 1,
            "policy": "Primary evidence only.",
            "issues": [{
                "id": "unbounded-fixture",
                "summary": "Fixture export regression.",
                "action": "Use a supported patch release.",
                "severity": "warning",
                "minInclusive": "5.1.0",
                "evidence": ["https://projects.blender.org/blender/blender/issues/123"],
            }],
        })
    except ValueError as error:
        unbounded_rejected = (
            "issues[0].maxExclusive must be non-empty text" in str(error)
        )
    expect(unbounded_rejected,
           "known-issue registry accepted an interval without maxExclusive")

    addon.unregister()
    print("BLENDLINK_ADDON_TESTS_PASSED")


main()
