# SPDX-License-Identifier: GPL-3.0-or-later
"""Time the real Cube bake-geometry preparation without running Cycles.

This is a diagnostic probe, not production code. It deliberately prints before
and after every expensive seam so an outer timeout still identifies the active
operation.
"""

import json
import hashlib
import os
import sys
import time
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))

import bakelib  # noqa: E402
import export_scene  # noqa: E402


def object_summary(value):
    if not isinstance(value, (list, tuple)):
        return None
    objects = [item for item in value if getattr(item, "type", None) == "MESH"]
    if not objects:
        return None
    return {
        "objects": len(objects),
        "polygons": sum(len(obj.data.polygons) for obj in objects),
        "loops": sum(len(obj.data.loops) for obj in objects),
        "names": [obj.name for obj in objects[:5]],
    }


def selected_summary():
    return object_summary([
        obj for obj in bpy.context.selected_objects if obj.type == "MESH"
    ])


def install_timer(module, name, *, selected=False):
    original = getattr(module, name)

    def measured(*args, **kwargs):
        summary = selected_summary() if selected else (
            object_summary(args[0]) if args else None
        )
        started = time.perf_counter()
        print("BLENDLINK_PROFILE_START " + json.dumps({
            "name": name,
            "summary": summary,
        }, sort_keys=True), flush=True)
        try:
            return original(*args, **kwargs)
        finally:
            print("BLENDLINK_PROFILE_END " + json.dumps({
                "name": name,
                "seconds": round(time.perf_counter() - started, 6),
                "summary": summary,
            }, sort_keys=True), flush=True)

    setattr(module, name, measured)


for function_name in (
    "freeze_evaluated_meshes",
    "ensure_authored_uvs",
    "stage_atlas_layers",
    "repair_evaluated_atlas_uvs",
    "average_unpinned",
    "pinned_uv_layout_issues",
    "pack_with_evaluated_uv_repair",
    "_pack_receiver_groups",
    "_pack_receiver_groups_mutating",
    "validate_receiver_group_spacing",
):
    install_timer(bakelib, function_name)

install_timer(bakelib, "_pack_selected_uv_islands", selected=True)

settings, recipe = export_scene.resolve_scene_recipe({
    "planOnly": True,
    "draft": False,
})
bakelib.remove_checker_overrides(bpy.data.objects)
export_scene.remove_noimp_objects()

started = time.perf_counter()
print("BLENDLINK_PROFILE_BEGIN", flush=True)
layout = export_scene.bake_prepare_geometry(
    settings["bake"], settings["bake"].get("supersample", 1),
)
print("BLENDLINK_PROFILE_COMPLETE " + json.dumps({
    "seconds": round(time.perf_counter() - started, 6),
    "atlases": {
        name: {
            "objects": len(entry["objects"]),
            "size": entry["size"],
            "margin": entry["margin"],
        }
        for name, entry in layout.items() if not name.startswith("_")
    },
    "errors": layout.get("_errors", []),
}, sort_keys=True), flush=True)


def install_named_timer(name, describe):
    original = getattr(bakelib, name)

    def measured(*args, **kwargs):
        detail = describe(*args, **kwargs)
        started = time.perf_counter()
        print("BLENDLINK_FINGERPRINT_START " + json.dumps({
            "name": name,
            "detail": detail,
        }, sort_keys=True), flush=True)
        try:
            return original(*args, **kwargs)
        finally:
            print("BLENDLINK_FINGERPRINT_END " + json.dumps({
                "name": name,
                "seconds": round(time.perf_counter() - started, 6),
                "detail": detail,
            }, sort_keys=True), flush=True)

    setattr(bakelib, name, measured)


install_named_timer(
    "_fingerprint_object_contributor",
    lambda _digest, obj, *_args, **_kwargs: {
        "object": obj.name,
        "type": obj.type,
    },
)
install_named_timer(
    "_fingerprint_mesh",
    lambda _digest, mesh, *_args, **_kwargs: {
        "mesh": mesh.name,
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
        "loops": len(mesh.loops),
        "attributes": [attribute.name for attribute in mesh.attributes],
    },
)
install_named_timer(
    "_fingerprint_image",
    lambda _digest, image, *_args, **_kwargs: {
        "image": image.name,
        "size": list(image.size),
        "filepath": image.filepath,
        "packed": bool(bakelib.packed_image_payloads(image)),
    },
)
install_named_timer(
    "_fingerprint_node_tree",
    lambda _digest, tree, *_args, **_kwargs: {
        "tree": getattr(tree, "name", None),
        "nodes": len(tree.nodes) if tree is not None else 0,
    },
)
install_named_timer(
    "_fingerprint_depsgraph_instances",
    lambda *_args, **_kwargs: {},
)
install_named_timer(
    "_fingerprint_collection_instance_sources",
    lambda *_args, **_kwargs: {},
)

fingerprint_settings = {
    key: value for key, value in settings["bake"].items() if key != "states"
}
pipeline_digest = hashlib.sha256()
for module_path in (Path(export_scene.__file__).resolve(), Path(bakelib.__file__).resolve()):
    pipeline_digest.update(module_path.read_bytes())
fingerprint_settings["pipelineSignature"] = pipeline_digest.hexdigest()[:16]
entry = layout["main"]
export_scene.configure_atlas_bake(
    bpy.context.scene,
    entry["margin"] * settings["bake"].get("supersample", 1),
    entry["bakeOutput"],
    emit=True,
    fixed_camera_appearance=bool(settings["bake"].get("fixedCameraAppearance")),
)
fingerprint_started = time.perf_counter()
print("BLENDLINK_FINGERPRINT_BEGIN", flush=True)
fingerprint = bakelib.fingerprint_bake_dependencies(
    bpy.context.scene,
    layout,
    fingerprint_settings,
    "main",
    "state:default",
)
print("BLENDLINK_FINGERPRINT_COMPLETE " + json.dumps({
    "fingerprint": fingerprint,
    "seconds": round(time.perf_counter() - fingerprint_started, 6),
}, sort_keys=True), flush=True)

if "--guide-size" in sys.argv:
    option = sys.argv.index("--guide-size")
    guide_size = int(sys.argv[option + 1])
    export_scene.bake_engine(1)
    guide_started = time.perf_counter()
    print("BLENDLINK_GUIDE_BEGIN " + json.dumps({
        "objects": len(entry["objects"]),
        "size": guide_size,
    }, sort_keys=True), flush=True)
    guide, normal = export_scene.bake_denoise_guides(
        entry["objects"], guide_size, "main", entry["margin"],
    )
    print("BLENDLINK_GUIDE_COMPLETE " + json.dumps({
        "normal": normal is not None,
        "seconds": round(time.perf_counter() - guide_started, 6),
        "size": guide_size,
    }, sort_keys=True), flush=True)
    bpy.data.images.remove(guide)
