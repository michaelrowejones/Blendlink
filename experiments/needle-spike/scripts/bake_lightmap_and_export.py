"""Bake a tiny Needle lightmap trial, save the scene copy, and export it."""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

import bpy


def find_view3d_context() -> tuple[object, object, object]:
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            region = next(
                (candidate for candidate in area.regions if candidate.type == "WINDOW"),
                None,
            )
            if region is not None:
                return window, area, region
    raise RuntimeError("Needle lightmapping requires an open 3D View")


def run() -> dict[str, object]:
    separator = sys.argv.index("--")
    project_path = Path(sys.argv[separator + 1]).resolve()
    scene = bpy.context.scene

    # This deliberately models the intended hybrid scene: the ground is baked,
    # while the animated crate and its collider remain realtime/dynamic.
    for obj in scene.objects:
        if obj.type == "MESH":
            obj.NEEDLE_isLightmapped = obj.name == "Ground"
            obj.NEEDLE_lightmapScale = 1.0
            obj.select_set(obj.name == "Ground")
        elif obj.type == "LIGHT":
            # Needle requires lights to opt into the bake separately from meshes.
            obj.NEEDLE_isLightmapped = True
    bpy.context.view_layer.objects.active = scene.objects["Ground"]

    scene.NEEDLE_lightmapResolution = "128"
    scene.NEEDLE_lightmapQualityMode = "PREVIEW"
    scene.NEEDLE_lightmapUseDenoiser = False

    window, area, region = find_view3d_context()
    with bpy.context.temp_override(window=window, area=area, region=region):
        bake_result = bpy.ops.needle.bake_lightmaps(
            "EXEC_DEFAULT", resolution=128, selection_only=False, view_only=False
        )

    lightmap = bpy.data.images.get("NEEDLE_lightmap_image")
    if bake_result != {"FINISHED"} or lightmap is None or not lightmap.has_data:
        raise RuntimeError(f"Needle lightmap bake failed (operator: {bake_result})")

    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)

    with bpy.context.temp_override(window=window, area=area, region=region):
        export_result = bpy.ops.needle_scene.export("EXEC_DEFAULT", immediate=True)
    exported_scene = project_path / "assets" / "scene.glb"
    if export_result != {"FINISHED"} or not exported_scene.is_file():
        raise RuntimeError(f"Needle export failed (operator: {export_result})")

    ground = scene.objects["Ground"]
    return {
        "status": "ok",
        "baked": ["Ground"],
        "bakedLights": ["Sun", "WarmLamp"],
        "dynamic": ["Crate", "Crate-colonly"],
        "lightmap": {
            "name": lightmap.name,
            "size": list(lightmap.size),
            "packed": lightmap.packed_file is not None,
        },
        "groundUvLayers": [layer.name for layer in ground.data.uv_layers],
        "sceneGlbBytes": exported_scene.stat().st_size,
    }


def main() -> None:
    separator = sys.argv.index("--")
    project_path = Path(sys.argv[separator + 1]).resolve()
    result_path = project_path / "lightmap-result.json"
    try:
        result = run()
        print("NEEDLE_LIGHTMAP_READY", json.dumps(result, separators=(",", ":")))
    except Exception as exc:
        traceback.print_exc()
        result = {"status": "error", "message": str(exc)}
        print("NEEDLE_LIGHTMAP_FAILED", json.dumps(result, separators=(",", ":")))
    result_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    bpy.ops.wm.quit_blender()


if __name__ == "__main__":
    main()
