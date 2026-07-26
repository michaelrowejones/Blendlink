# SPDX-License-Identifier: MIT
"""PROTOTYPE: export the same immutable fixture through competing designs."""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import bpy


NEEDLE_VERSION = "1.4.2"
NEEDLE_EXPORT_SHA256 = (
    "6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def identity(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": path.as_posix(),
        "bytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "sha256": sha256(path),
    }


def args() -> Path:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 1:
        raise SystemExit("expected: -- <output-directory>")
    result = Path(values[0]).resolve()
    result.mkdir(parents=True, exist_ok=True)
    return result


def source_inventory() -> dict:
    constraints = []
    transform_drivers = []
    unsupported_drivers = []
    for obj in bpy.context.scene.objects:
        for constraint in obj.constraints:
            constraints.append(
                {
                    "owner": obj.name,
                    "name": constraint.name,
                    "type": constraint.type,
                    "target": getattr(getattr(constraint, "target", None), "name", None),
                }
            )
        animation_data = getattr(obj, "animation_data", None)
        for curve in getattr(animation_data, "drivers", ()) if animation_data else ():
            record = {"owner": obj.name, "dataPath": curve.data_path}
            if curve.data_path in {"location", "rotation_euler", "rotation_quaternion", "scale"}:
                transform_drivers.append(record)
            else:
                unsupported_drivers.append(record)

    for material in bpy.data.materials:
        node_tree = material.node_tree
        animation_data = getattr(node_tree, "animation_data", None) if node_tree else None
        for curve in getattr(animation_data, "drivers", ()) if animation_data else ():
            display_path = curve.data_path
            for node in node_tree.nodes:
                for index, socket in enumerate(node.inputs):
                    numeric = f'nodes["{node.name}"].inputs[{index}]'
                    if display_path.startswith(numeric):
                        display_path = display_path.replace(
                            numeric,
                            f'nodes["{node.name}"].inputs["{socket.name}"]',
                            1,
                        )
            unsupported_drivers.append(
                {
                    "owner": material.name,
                    "dataPath": curve.data_path,
                    "displayPath": display_path,
                    "reason": (
                        "core glTF animation cannot target material properties "
                        "without KHR_animation_pointer"
                    ),
                }
            )

    return {
        "constraints": constraints,
        "transformDrivers": transform_drivers,
        "unsupportedDrivers": unsupported_drivers,
        "proposedDiagnostics": [
            {
                "severity": "error",
                "code": "animation.material-driver-not-portable",
                "message": (
                    f'{driver["owner"]}: driver "'
                    f'{driver.get("displayPath", driver["dataPath"])}" cannot be '
                    "transported by core glTF animation. Materialize a supported "
                    "static value, opt into a verified animation-pointer adapter, "
                    "or remove the driver before publish."
                ),
            }
            for driver in unsupported_drivers
        ],
    }


def export(
    output: Path,
    properties,
    name: str,
    overrides: dict,
) -> dict:
    filepath = output / f"{name}.glb"
    common = {
        # Exact ordinary stock-glTF call shape used by Needle 1.4.2.
        "filepath": str(filepath),
        "check_existing": False,
        "export_format": "GLB",
        "export_cameras": True,
        "export_lights": True,
        "use_active_scene": True,
        "gltf_export_id": "Needle Engine",
        "export_import_convert_lighting_mode": "COMPAT",
        "export_apply": True,
        "export_animations": True,
        "use_visible": False,
        "export_image_format": "AUTO",
        "export_jpeg_quality": 100,
    }
    requested = {**common, **overrides}
    missing = sorted(key for key in requested if key not in properties)
    if missing:
        raise RuntimeError(
            f"{name}: Blender 5.2 exporter lacks required properties {missing}"
        )
    before_frame = bpy.context.scene.frame_current
    started = time.perf_counter()
    result = bpy.ops.export_scene.gltf(**requested)
    duration = time.perf_counter() - started
    if result != {"FINISHED"}:
        raise RuntimeError(f"{name}: glTF export returned {result!r}")
    frame_after_operator = bpy.context.scene.frame_current
    # Blender 5.2's SCENE sampler can leave the in-memory scene at the end of
    # the sampled range when export_current_frame=True.  The prototype wraps
    # the stock call in the transaction Blendlink would need to own.
    if frame_after_operator != before_frame:
        bpy.context.scene.frame_set(before_frame)
        bpy.context.view_layer.update()
    if bpy.context.scene.frame_current != before_frame:
        raise RuntimeError(
            f"{name}: prototype could not restore current frame {before_frame}; "
            f"got {bpy.context.scene.frame_current}"
        )
    return {
        "artifact": identity(filepath),
        "requested": requested,
        "durationSeconds": duration,
        "frameBefore": before_frame,
        "frameAfterOperator": frame_after_operator,
        "frameAfterTransaction": bpy.context.scene.frame_current,
        "transactionRestoredFrame": frame_after_operator != before_frame,
    }


def main() -> None:
    output = args()
    source = Path(bpy.data.filepath).resolve()
    source_before = identity(source)
    if bpy.context.scene.frame_current != 10:
        raise RuntimeError(
            f"expected saved authored frame 10, got {bpy.context.scene.frame_current}"
        )
    properties = bpy.ops.export_scene.gltf.get_rna_type().properties
    defaults = {
        key: properties[key].default
        for key in (
            "export_current_frame",
            "export_rest_position_armature",
            "export_animation_mode",
            "export_force_sampling",
            "export_bake_animation",
            "export_frame_step",
            "export_pointer_animation",
        )
    }

    variants = {
        "needle-floor": export(output, properties, "needle-floor", {}),
        "one-pass-scene": export(
            output,
            properties,
            "one-pass-scene",
            {
                "export_current_frame": True,
                "export_rest_position_armature": False,
                "export_animation_mode": "SCENE",
                "export_force_sampling": True,
                "export_frame_range": True,
                "export_frame_step": 1,
                "export_pointer_animation": False,
                "export_anim_scene_split_object": False,
            },
        ),
        "dynamic-scene": export(
            output,
            properties,
            "dynamic-scene",
            {
                "export_current_frame": False,
                "export_rest_position_armature": True,
                "export_animation_mode": "SCENE",
                "export_force_sampling": True,
                "export_frame_range": True,
                "export_frame_step": 1,
                "export_pointer_animation": False,
                "export_anim_scene_split_object": False,
            },
        ),
        "static-current": export(
            output,
            properties,
            "static-current",
            {
                "export_current_frame": True,
                "export_rest_position_armature": False,
                "export_animations": False,
            },
        ),
        "current-rest-actions": export(
            output,
            properties,
            "current-rest-actions",
            {
                "export_current_frame": True,
                "export_rest_position_armature": True,
                "export_animation_mode": "ACTIONS",
                "export_force_sampling": True,
                "export_bake_animation": False,
                "export_frame_range": True,
                "export_frame_step": 1,
                "export_pointer_animation": False,
            },
        ),
        "one-pass-actions-baked": export(
            output,
            properties,
            "one-pass-actions-baked",
            {
                "export_current_frame": True,
                "export_rest_position_armature": False,
                "export_animation_mode": "ACTIONS",
                "export_force_sampling": True,
                "export_bake_animation": True,
                "export_frame_range": True,
                "export_frame_step": 1,
                "export_pointer_animation": False,
            },
        ),
    }
    source_after = identity(source)
    if source_after != source_before:
        raise RuntimeError("export variants changed the immutable source .blend")

    report = {
        "schemaVersion": 1,
        "classification": "prototype exporter differential; not shipped Blendlink behavior",
        "sourceBefore": source_before,
        "sourceAfter": source_after,
        "blender": {
            "version": bpy.app.version_string,
            "buildHash": (
                bpy.app.build_hash.decode()
                if isinstance(bpy.app.build_hash, bytes)
                else str(bpy.app.build_hash)
            ),
        },
        "exporterDefaults": defaults,
        "needle": {
            "version": NEEDLE_VERSION,
            "blenderExportPath": "blender_export.py",
            "blenderExportSha256": NEEDLE_EXPORT_SHA256,
            "behavior": (
                "passes none of current-frame, armature-rest, animation-mode, "
                "force-sampling, bake-all, frame-step, or animation-pointer flags"
            ),
        },
        "sourceInventory": source_inventory(),
        "variants": variants,
    }
    (output / "export-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        "BLENDLINK_AUTHORED_FRAME_VARIANTS_EXPORTED",
        f"variants={len(variants)}",
        f"sourceRestored={source_before == source_after}",
        f"diagnostics={len(report['sourceInventory']['proposedDiagnostics'])}",
    )


main()
