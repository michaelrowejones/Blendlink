# SPDX-License-Identifier: GPL-3.0-or-later
"""GEO-EVAL-001: budgeted evaluated-geometry realization stays honest.

Grease Pencil strokes, Hair Curves, and childless legacy HAIR/PATH particle
parents realize to ordinary meshes through the depsgraph and ship through
the untouched stock exporter; over-budget or children-configured systems
keep the loud refusal with named numbers; the source scene restores exactly.

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/evaluated_geometry_check.py
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
EXPORTER_PATH = ADDON_DIR.parent / "blendlink" / "blender" / "export_scene.py"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_exporter():
    spec = importlib.util.spec_from_file_location(
        "blendlink_evaluated_geometry_exporter", EXPORTER_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def read_glb_json(path):
    raw = Path(path).read_bytes()
    expect(raw[:4] == b"glTF", "GLB magic missing")
    length = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20:20 + length])


def hair_object(name, collection, *, strands, points_per_strand):
    curves = bpy.data.hair_curves.new(f"{name} Data")
    curves.add_curves([points_per_strand] * strands)
    index = 0
    for strand in range(strands):
        for point_index in range(points_per_strand):
            point = curves.points[index]
            point.position = (
                strand * 0.3, 0.0, point_index * 0.1,
            )
            point.radius = 0.01
            index += 1
    obj = bpy.data.objects.new(name, curves)
    collection.objects.link(obj)
    return obj


def grease_pencil_object(name, collection):
    gp = bpy.data.grease_pencils.new(f"{name} Data")
    layer = gp.layers.new("Layer")
    frame = layer.frames.new(1)
    frame.drawing.add_strokes([6])
    for index, point in enumerate(frame.drawing.strokes[0].points):
        point.position = (index * 0.2, 0.1, 0.4)
        point.radius = 0.03
    obj = bpy.data.objects.new(name, gp)
    collection.objects.link(obj)
    obj["blendlink_id"] = "sketch-id"
    return obj


def particle_emitter(name, collection, *, count, child_type="NONE"):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.modifiers.new("Strand System", "PARTICLE_SYSTEM")
    system = obj.particle_systems[0]
    system.settings.type = "HAIR"
    system.settings.count = count
    system.settings.hair_length = 0.4
    system.settings.hair_step = 4
    system.settings.child_type = child_type
    return obj, system


def scene_snapshot():
    return {
        "objects": tuple(sorted(
            (obj.name, obj.hide_render) for obj in bpy.data.objects
        )),
        "meshes": tuple(sorted(mesh.name for mesh in bpy.data.meshes)),
        "hairCurves": tuple(sorted(
            item.name for item in bpy.data.hair_curves
        )),
    }


def invoke(exporter, root, result_name, *, plan_only):
    out_path = root / f"{result_name}.glb"
    settings_path = root / f"{result_name}.settings.json"
    result_path = root / f"{result_name}.result.json"
    settings = {"mode": "standard"}
    if plan_only:
        settings["planOnly"] = True
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
    scene = bpy.context.scene

    fur = hair_object(
        "Fur", scene.collection, strands=3, points_per_strand=5,
    )
    sketch = grease_pencil_object("Sketch", scene.collection)
    emitter, _system = particle_emitter(
        "Grass", scene.collection, count=12,
    )
    bpy.context.view_layer.update()

    # --- Plan-only reports the realization route without mutating --------
    before = scene_snapshot()
    with tempfile.TemporaryDirectory(prefix="blendlink-geo-eval-") as directory:
        root = Path(directory)
        _out, result_path = invoke(exporter, root, "plan", plan_only=True)
        result = json.loads(result_path.read_text(encoding="utf8"))
        realized = result["sidecar"]["diagnostics"].get("realizedGeometry")
        expect(
            realized is not None and not realized["refuse"],
            f"plan must carry the realization route: {realized}",
        )
        kinds = sorted(item["kind"] for item in realized["realize"])
        expect(
            kinds == ["greasePencil", "hairCurves", "particleStrands"],
            f"expected all three realization kinds: {kinds}",
        )
        expect(
            all(
                item["estimatedTriangles"] > 0
                and item["estimatedTriangles"] <= realized["budgetTriangles"]
                for item in realized["realize"]
            ),
            f"realization estimates must be within budget: {realized}",
        )
        expect(
            scene_snapshot() == before,
            "plan-only realization mutated the scene",
        )

        # --- Real export ships realized meshes and restores exactly -------
        out_path, result_path = invoke(exporter, root, "export", plan_only=False)
        expect(out_path.is_file(), "realized export emitted no GLB")
        document = read_glb_json(out_path)
        nodes = {node.get("name"): node for node in document.get("nodes", ())}
        meshes = document.get("meshes", ())

        def realized_triangles(node_name):
            node = nodes.get(node_name)
            expect(
                node is not None and node.get("mesh") is not None,
                f"realized node {node_name!r} missing from the GLB: "
                f"{sorted(nodes)}",
            )
            mesh = meshes[node["mesh"]]
            primitives = mesh.get("primitives", ())
            expect(primitives, f"realized node {node_name!r} has no primitives")
            accessors = document.get("accessors", ())
            total = 0
            for primitive in primitives:
                indices = primitive.get("indices")
                if indices is not None:
                    total += accessors[indices]["count"] // 3
            return total

        for node_name in ("Fur", "Sketch", "Grass.Strand System"):
            triangles = realized_triangles(node_name)
            expect(
                triangles > 0,
                f"realized node {node_name!r} shipped no triangles",
            )
        expect(
            "Fur.blendlink-realized-source" not in nodes,
            "the renamed realization source leaked into the GLB",
        )
        sketch_node = nodes.get("Sketch")
        expect(
            (sketch_node.get("extras") or {}).get("blendlink_id") == "sketch-id",
            f"realized carrier lost its blendlink_id: {sketch_node}",
        )
        export_result = json.loads(result_path.read_text(encoding="utf8"))
        executed = export_result["sidecar"]["diagnostics"]["realizedGeometry"]
        expect(
            all(
                item.get("realizedNode") and item.get("realizedTriangles", 0) > 0
                for item in executed["realize"]
            ),
            f"executed realization must record its nodes: {executed}",
        )
        expect(
            scene_snapshot() == before,
            "realized export did not restore the source scene exactly",
        )

        # --- Over-budget and children-configured systems keep refusing ----
        bpy.data.objects.remove(fur, do_unlink=True)
        bpy.data.objects.remove(sketch, do_unlink=True)
        bpy.data.objects.remove(emitter, do_unlink=True)
        heavy, _heavy_system = particle_emitter(
            "Meadow", scene.collection, count=50_000,
        )
        bpy.context.view_layer.update()
        try:
            invoke(exporter, root, "over-budget", plan_only=True)
        except SystemExit as error:
            message = str(error)
            expect(
                "realization budget" in message and "Meadow" in message,
                f"over-budget refusal must name the budget: {message}",
            )
        else:
            raise AssertionError("an over-budget particle system must refuse")

        heavy.particle_systems[0].settings.count = 10
        heavy.particle_systems[0].settings.child_type = "SIMPLE"
        bpy.context.view_layer.update()
        try:
            invoke(exporter, root, "children", plan_only=True)
        except SystemExit as error:
            expect(
                "children" in str(error),
                f"children refusal must be named: {error}",
            )
        else:
            raise AssertionError("children-configured particles must refuse")

    print("BLENDLINK_EVALUATED_GEOMETRY_CHECK_PASSED")


if __name__ == "__main__":
    main()
