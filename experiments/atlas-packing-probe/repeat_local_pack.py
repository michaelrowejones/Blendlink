# SPDX-License-Identifier: GPL-3.0-or-later
"""Prototype: repeat the real receiver pack from one byte-identical UV snapshot.

Run with Blender after opening the Cube Diorama appearance fixture. This is a
debugging probe, not production or test-suite code.
"""

import hashlib
import base64
import bmesh
import json
import math
import re
import struct
import sys
import zlib
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
BLENDER_DIR = ROOT / "packages" / "blendlink" / "blender"
sys.path.insert(0, str(BLENDER_DIR))

import bakelib  # noqa: E402
import export_scene  # noqa: E402


def uv_snapshot(objects):
    return {
        obj.name: [tuple(loop.uv) for loop in obj.data.uv_layers.active.data]
        for obj in objects
    }


def restore_uvs(objects, snapshot):
    for obj in objects:
        layer = obj.data.uv_layers.active
        for loop, coordinate in zip(layer.data, snapshot[obj.name]):
            loop.uv = coordinate


def uv_hash(objects):
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode("utf8"))
        digest.update(b"\0")
        for loop in obj.data.uv_layers.active.data:
            digest.update(struct.pack("<ff", loop.uv.x, loop.uv.y))
    return digest.hexdigest()


def rectangle_hash(rectangles):
    digest = hashlib.sha256()
    for name, width, height in rectangles:
        digest.update(str(name).encode("utf8"))
        digest.update(b"\0")
        digest.update(struct.pack("<dd", float(width), float(height)))
    return digest.hexdigest()


def object_hash(obj):
    geometry = hashlib.sha256()
    uv = hashlib.sha256()
    atlas = hashlib.sha256()
    has_atlas = False
    mesh = obj.data
    geometry.update(struct.pack("<III", len(mesh.vertices), len(mesh.loops), len(mesh.polygons)))
    for vertex in mesh.vertices:
        geometry.update(struct.pack("<fff", *vertex.co))
    for loop in mesh.loops:
        geometry.update(struct.pack("<II", loop.vertex_index, loop.edge_index))
    for polygon in mesh.polygons:
        geometry.update(struct.pack("<II", polygon.loop_start, polygon.loop_total))
    for layer in mesh.uv_layers:
        uv.update(layer.name.encode("utf8"))
        uv.update(b"\0")
        for loop in layer.data:
            value = struct.pack("<ff?", loop.uv.x, loop.uv.y, loop.pin_uv)
            uv.update(value)
            if layer.name == bakelib.ATLAS_UV:
                atlas.update(value)
                has_atlas = True
    return {
        "geometry": geometry.hexdigest(),
        "uv": uv.hexdigest(),
        "atlas": atlas.hexdigest() if has_atlas else None,
    }


def stage_hash(objects):
    return {
        obj.name: object_hash(obj)
        for obj in sorted(objects, key=lambda item: item.name)
    }


def encoded_uv_layers(obj):
    mesh = obj.data
    return {
        layer.name: {
            "active": mesh.uv_layers.active == layer,
            "activeRender": bool(layer.active_render),
            "loops": len(layer.data),
            "data": base64.b64encode(zlib.compress(b"".join(
                struct.pack("<ff?", loop.uv.x, loop.uv.y, loop.pin_uv)
                for loop in layer.data
            ), 9)).decode("ascii"),
        }
        for layer in mesh.uv_layers
    }


def modifier_info(obj):
    fields = (
        "affect", "segments", "width", "limit_method", "clamp_overlap",
        "loop_slide", "mark_seam", "mark_sharp", "harden_normals",
        "levels", "render_levels", "uv_smooth", "boundary_smooth",
        "decimate_type", "ratio",
    )
    return [
        {
            "name": modifier.name,
            "type": modifier.type,
            **{
                field: getattr(modifier, field)
                for field in fields if hasattr(modifier, field)
            },
        }
        for modifier in obj.modifiers
    ]


def ordered_float32_key(value):
    resolved = float(value)
    if not math.isfinite(resolved):
        raise ValueError(f"automatic atlas UV must be finite, got {resolved!r}")
    bits = struct.unpack("<I", struct.pack("<f", resolved))[0]
    return (~bits & 0xFFFFFFFF) if bits & 0x80000000 else (bits ^ 0x80000000)


def float32_from_ordered_key(key):
    resolved = int(key)
    bits = (
        resolved ^ 0x80000000
        if resolved & 0x80000000
        else ~resolved & 0xFFFFFFFF
    )
    return struct.unpack("<f", struct.pack("<I", bits))[0]


def guarded_ulp_bucket(value, bucket, guard):
    key = ordered_float32_key(value)
    lower = (key // bucket) * bucket
    remainder = key - lower
    if remainder <= guard:
        canonical = lower
    elif bucket - remainder <= guard:
        canonical = lower + bucket
    else:
        canonical = lower + bucket // 2
    return float32_from_ordered_key(canonical), abs(canonical - key)


def stage_probe(settings, workspace_strategy="copy"):
    stages = {}
    repairs = []
    averages = []
    packs = []
    allocations = []
    bevel_names = set()
    metrics = {}
    canonicalization = {
        "objects": 0, "coordinates": 0, "maxUlpDisplacement": 0,
        "maxAbsDisplacement": 0.0,
    }

    original_freeze = bakelib.freeze_evaluated_meshes
    original_ensure = bakelib.ensure_authored_uvs
    original_stage = bakelib.stage_atlas_layers
    original_repair = bakelib.repair_evaluated_atlas_uvs
    original_average = bakelib.average_unpinned
    original_pack = bakelib._pack_receiver_groups_mutating
    original_allocate = bakelib.allocate_receiver_rectangles

    def recording_freeze(objects, *args, **kwargs):
        bevel_names.update(
            obj.name for obj in objects
            if any(modifier.type == "BEVEL" for modifier in obj.modifiers)
        )
        result = original_freeze(objects, *args, **kwargs)
        stages["frozen"] = stage_hash(result)
        return result

    def recording_ensure(objects, *args, **kwargs):
        result = original_ensure(objects, *args, **kwargs)
        stages["authored"] = stage_hash(objects)
        return result

    def recording_stage(objects, *args, **kwargs):
        result = original_stage(objects, *args, **kwargs)
        authored_names = set(result)
        automatic = sorted(
            (obj for obj in objects if obj.name not in authored_names),
            key=lambda item: item.name,
        )
        if workspace_strategy.startswith("round-"):
            step = float(workspace_strategy.removeprefix("round-"))
            for obj in automatic:
                layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
                for loop in layer.data:
                    loop.uv.x = round(float(loop.uv.x) / step) * step
                    loop.uv.y = round(float(loop.uv.y) / step) * step
        elif re.fullmatch(r"ulp\d+g\d+", workspace_strategy):
            bucket, guard = map(
                int, re.fullmatch(r"ulp(\d+)g(\d+)", workspace_strategy).groups(),
            )
            if bucket < 4 or bucket & (bucket - 1) or guard < 1 or guard * 2 >= bucket:
                raise ValueError(
                    "ULP workspace strategy needs a power-of-two bucket >= 4 "
                    "and a positive guard smaller than half the bucket"
                )
            for obj in (item for item in automatic if item.name in bevel_names):
                canonicalization["objects"] += 1
                layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
                for loop in layer.data:
                    for component in ("x", "y"):
                        before = float(getattr(loop.uv, component))
                        after, ulps = guarded_ulp_bucket(before, bucket, guard)
                        setattr(loop.uv, component, after)
                        canonicalization["coordinates"] += 1
                        canonicalization["maxUlpDisplacement"] = max(
                            canonicalization["maxUlpDisplacement"], ulps,
                        )
                        canonicalization["maxAbsDisplacement"] = max(
                            canonicalization["maxAbsDisplacement"],
                            abs(after - before),
                        )
        elif (
            workspace_strategy == "smart"
            or re.fullmatch(r"smart-bevel(?:-\d+)?", workspace_strategy)
        ):
            projected = (
                automatic if workspace_strategy == "smart"
                else [obj for obj in automatic if obj.name in bevel_names]
            )
            angle_degrees = (
                int(workspace_strategy.rsplit("-", 1)[1])
                if re.fullmatch(r"smart-bevel-\d+", workspace_strategy)
                else 66
            )
            for obj in projected:
                layer = obj.data.uv_layers.get(bakelib.ATLAS_UV)
                obj.data.uv_layers.active = layer
                bakelib.select_only([obj])
                try:
                    bpy.ops.object.mode_set(mode="EDIT")
                    bpy.ops.mesh.select_all(action="SELECT")
                    bpy.ops.uv.smart_project(
                        angle_limit=math.radians(angle_degrees),
                        island_margin=0.0,
                    )
                finally:
                    if obj.mode != "OBJECT":
                        bpy.ops.object.mode_set(mode="OBJECT")
        elif workspace_strategy != "copy":
            raise ValueError(f"unknown workspace strategy {workspace_strategy!r}")
        stages["staged"] = stage_hash(objects)
        return result

    def recording_repair(objects, *args, **kwargs):
        before = stage_hash(objects)
        result = original_repair(objects, *args, **kwargs)
        repairs.append({
            "names": sorted(obj.name for obj in objects),
            "before": before,
            "after": stage_hash(objects),
            "reports": [
                {key: value for key, value in report.items() if not key.startswith("_")}
                for report in result
            ],
        })
        return result

    def recording_average(objects, *args, **kwargs):
        before = stage_hash(objects)
        result = original_average(objects, *args, **kwargs)
        averages.append({"before": before, "after": stage_hash(objects)})
        return result

    def recording_allocate(rectangles, **kwargs):
        result = original_allocate(rectangles, **kwargs)
        allocations.append({
            "rectangleHash": rectangle_hash(rectangles),
            "rectangles": {
                name: [float(width), float(height)]
                for name, width, height in rectangles
            },
            "scale": result["scale"],
            "ordering": result["ordering"],
            "scoring": result["scoring"],
        })
        return result

    def recording_pack(objects, *args, **kwargs):
        before = stage_hash(objects)
        result = original_pack(objects, *args, **kwargs)
        packs.append({"before": before, "after": stage_hash(objects)})
        return result

    bakelib.freeze_evaluated_meshes = recording_freeze
    bakelib.ensure_authored_uvs = recording_ensure
    bakelib.stage_atlas_layers = recording_stage
    bakelib.repair_evaluated_atlas_uvs = recording_repair
    bakelib.average_unpinned = recording_average
    bakelib._pack_receiver_groups_mutating = recording_pack
    bakelib.allocate_receiver_rectangles = recording_allocate
    try:
        layout = export_scene.bake_prepare_geometry(
            settings["bake"], settings["bake"].get("supersample", 1),
        )
        objects = layout["main"]["objects"]
        stages["final"] = stage_hash(objects)
        weights = export_scene.compute_texel_weights(objects)
        target = float(settings["bake"]["atlases"]["main"]["targetDensity"])
        ratios = []
        for obj in objects:
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            mesh.transform(obj.matrix_world)
            surface = sum(face.calc_area() for face in mesh.faces)
            mesh.free()
            uv_area = bakelib.packed_uv_area(obj)
            px_per_meter = (
                (uv_area * settings["bake"]["size"] ** 2 / surface) ** 0.5
                if surface > 0.0 else 0.0
            )
            weight = weights[obj.name]["auto"] * weights[obj.name]["artist"]
            ratios.append((round(px_per_meter, 1) / (target * weight), obj.name))
        metrics.update({
            "atlasUvHash": uv_hash(objects),
            "occupancy": sum(bakelib.packed_uv_area(obj) for obj in objects),
            "targetAchievement": min(ratios)[0],
            "targetWorstObject": min(ratios)[1],
        })
    finally:
        bakelib.freeze_evaluated_meshes = original_freeze
        bakelib.ensure_authored_uvs = original_ensure
        bakelib.stage_atlas_layers = original_stage
        bakelib.repair_evaluated_atlas_uvs = original_repair
        bakelib.average_unpinned = original_average
        bakelib._pack_receiver_groups_mutating = original_pack
        bakelib.allocate_receiver_rectangles = original_allocate
    return {
        "stages": stages,
        "repairs": repairs,
        "averages": averages,
        "packs": packs,
        "allocations": allocations,
        "metrics": metrics,
        "canonicalization": canonicalization,
    }


settings, _recipe = export_scene.resolve_scene_recipe({
    "planOnly": True,
    "draft": False,
})
bakelib.remove_checker_overrides(bpy.data.objects)
export_scene.remove_noimp_objects()

if "--freeze-one" in sys.argv:
    option = sys.argv.index("--freeze-one")
    if option + 1 >= len(sys.argv):
        raise SystemExit("--freeze-one requires an object name")
    object_name = sys.argv[option + 1]
    obj = bpy.data.objects.get(object_name)
    if obj is None or obj.type != "MESH":
        raise SystemExit(f"missing mesh object {object_name!r}")
    source = {
        "fingerprint": object_hash(obj),
        "layers": encoded_uv_layers(obj),
        "modifiers": modifier_info(obj),
    }
    frozen = bakelib.freeze_evaluated_meshes([obj])
    if frozen != [obj]:
        raise RuntimeError(f"{object_name}: evaluated freeze did not retain one mesh")
    print("BLENDLINK_FREEZE_ONE " + json.dumps({
        "blender": bpy.app.version_string,
        "name": object_name,
        "source": source,
        "frozen": {
            "fingerprint": object_hash(obj),
            "layers": encoded_uv_layers(obj),
            "attributes": [
                {
                    "name": attribute.name,
                    "domain": attribute.domain,
                    "dataType": attribute.data_type,
                }
                for attribute in obj.data.attributes
            ],
        },
    }, sort_keys=True))
    raise SystemExit(0)

if "--stages" in sys.argv:
    strategy = "copy"
    if "--workspace-strategy" in sys.argv:
        strategy_option = sys.argv.index("--workspace-strategy")
        strategy = sys.argv[strategy_option + 1]
    print("BLENDLINK_STAGE_FINGERPRINTS " + json.dumps(
        {
            "blender": bpy.app.version_string,
            "workspaceStrategy": strategy,
            **stage_probe(settings, workspace_strategy=strategy),
        },
        sort_keys=True,
    ))
    raise SystemExit(0)

layout = export_scene.bake_prepare_geometry(
    settings["bake"], settings["bake"].get("supersample", 1),
)
all_objects = sorted(layout["main"]["objects"], key=lambda item: item.name)


def run_probe(objects, repetitions):
    snapshot = uv_snapshot(objects)
    allocations = []
    original_allocate = bakelib.allocate_receiver_rectangles

    def recording_allocate(rectangles, **kwargs):
        result = original_allocate(rectangles, **kwargs)
        allocations.append({
            "rectangleHash": rectangle_hash(rectangles),
            "rectangles": {
                name: [float(width), float(height)]
                for name, width, height in rectangles
            },
            "scale": result["scale"],
            "ordering": result["ordering"],
            "scoring": result["scoring"],
        })
        return result

    bakelib.allocate_receiver_rectangles = recording_allocate
    results = []
    try:
        for _index in range(repetitions):
            restore_uvs(objects, snapshot)
            bakelib._pack_receiver_groups(
                objects,
                settings["bake"]["margin"],
                settings["bake"]["size"],
                guard_px=4,
            )
            record = allocations[-1]
            results.append({
                "uvHash": uv_hash(objects),
                "rectangleHash": record["rectangleHash"],
                "scale": record["scale"],
                "ordering": record["ordering"],
                "scoring": record["scoring"],
                "occupancy": sum(
                    bakelib.packed_uv_area(obj) for obj in objects
                ),
                "rectangles": record["rectangles"],
            })
    finally:
        bakelib.allocate_receiver_rectangles = original_allocate
        restore_uvs(objects, snapshot)
    return results


single = next(obj for obj in all_objects if obj.name == "Dresser")
print("BLENDLINK_REPEAT_LOCAL_PACK " + json.dumps({
    "blender": bpy.app.version_string,
    "single": run_probe([single], 12),
    "all": run_probe(all_objects, 6),
}, sort_keys=True))
