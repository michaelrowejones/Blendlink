"""Export DOGWALK through the exact stock-glTF settings used by Needle 1.4.2.

This is deliberately not called a coherent Needle export: the Needle
extensions and generated website host are not active.  It isolates the
geometry/material/animation floor that Needle's pinned ``blender_export.py``
delegates to Blender's exporter.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import time

import bpy


SENTINEL = "##blendlink-dogwalk-stock-floor "


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _identity(path: Path) -> dict:
    stat = path.stat()
    return {
        "path": path.as_posix(),
        "bytes": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "sha256": _sha256(path),
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) not in (2, 3):
        raise RuntimeError(
            "Expected output GLB, evidence JSON, and optional "
            "'static-current-frame', 'static-current-pose', or "
            "'current-pose-with-animations' mode after --"
        )
    glb_path = Path(argv[0]).resolve()
    evidence_path = Path(argv[1]).resolve()
    mode = argv[2] if len(argv) == 3 else "needle-floor"
    if mode not in {
        "needle-floor",
        "static-current-frame",
        "static-current-pose",
        "current-pose-with-animations",
    }:
        raise RuntimeError(f"Unknown export mode: {mode!r}")
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.parent.mkdir(parents=True, exist_ok=True)

    source_path = Path(bpy.data.filepath).resolve()
    source_before = _identity(source_path)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    requested = {
        "filepath": str(glb_path),
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
    if mode in {
        "static-current-frame",
        "static-current-pose",
        "current-pose-with-animations",
    }:
        requested.update(
            {
                "export_current_frame": True,
                "export_animations": mode == "current-pose-with-animations",
            }
        )
    if mode in {"static-current-pose", "current-pose-with-animations"}:
        requested["export_rest_position_armature"] = False
    kwargs = {key: value for key, value in requested.items() if key in props}
    dropped = sorted(set(requested) - set(kwargs))
    defaults = {
        name: props[name].default
        for name in (
            "export_gn_mesh",
            "export_current_frame",
            "export_animation_mode",
            "export_skins",
            "export_morph",
            "export_extras",
            "export_hierarchy_full_collections",
            "export_gpu_instances",
        )
        if name in props
    }

    started = time.perf_counter()
    result = bpy.ops.export_scene.gltf(**kwargs)
    duration = time.perf_counter() - started
    if result != {"FINISHED"}:
        raise RuntimeError(f"Stock glTF export did not finish: {result!r}")

    source_after = _identity(source_path)
    if source_before != source_after:
        raise RuntimeError("Stock export changed the immutable source .blend")
    evidence = {
        "schemaVersion": 1,
        "classification": (
            "research-only Needle-equivalent stock glTF floor; not a coherent "
            "Needle integration or Blendlink artifact"
            if mode == "needle-floor"
            else (
                "prototype static authored-frame/current-pose stock glTF; "
                "not shipped Blendlink behavior"
                if mode in {"static-current-pose", "current-pose-with-animations"}
                else "prototype static authored-frame stock glTF; not shipped Blendlink behavior"
            )
        ),
        "mode": mode,
        "sourceBefore": source_before,
        "sourceAfter": source_after,
        "blender": {
            "version": bpy.app.version_string,
            "buildHash": bpy.app.build_hash.decode("utf8"),
        },
        "scene": {
            "name": bpy.context.scene.name,
            "frameCurrentAfterExport": bpy.context.scene.frame_current,
            "frameRange": [
                bpy.context.scene.frame_start,
                bpy.context.scene.frame_end,
            ],
        },
        "needleSource": {
            "version": "1.4.2",
            "path": "blender_export.py",
            "sha256": "6272997cfb4f1d740ea33a7c2512983b9993dedf93c9c8240ca0ff7f82925d77",
            "settingsLines": "pinned source lines 374-416",
        },
        "exporter": {
            "requested": requested,
            "effective": kwargs,
            "dropped": dropped,
            "implicitDefaults": defaults,
            "durationSeconds": duration,
        },
        "glb": _identity(glb_path),
    }
    evidence_path.write_text(
        json.dumps(evidence, indent=2, sort_keys=True) + "\n", "utf8"
    )
    print(
        SENTINEL
        + json.dumps(
            {
                "durationSeconds": duration,
                "glb": evidence["glb"],
                "defaults": defaults,
                "sourceUnchanged": source_before == source_after,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
