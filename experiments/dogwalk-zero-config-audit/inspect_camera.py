"""Capture exact evaluated Blender camera evidence at DOGWALK's authored frame."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import bpy


def _rows(matrix):
    return [[float(value) for value in row] for row in matrix]


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 1:
        raise RuntimeError("Expected one output JSON path after --")
    output = Path(argv[0]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.frame_set(85)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    source_camera = scene.camera
    evaluated_camera = source_camera.evaluated_get(depsgraph)
    data = evaluated_camera.data
    resolution_x = round(
        scene.render.resolution_x * scene.render.resolution_percentage / 100
    )
    resolution_y = round(
        scene.render.resolution_y * scene.render.resolution_percentage / 100
    )
    projection = evaluated_camera.calc_matrix_camera(
        depsgraph,
        x=resolution_x,
        y=resolution_y,
        scale_x=scene.render.pixel_aspect_x,
        scale_y=scene.render.pixel_aspect_y,
    )
    report = {
        "schemaVersion": 1,
        "classification": "research-only exact evaluated source-camera evidence",
        "source": bpy.data.filepath,
        "frame": scene.frame_current,
        "resolution": [resolution_x, resolution_y],
        "pixelAspect": [
            scene.render.pixel_aspect_x,
            scene.render.pixel_aspect_y,
        ],
        "camera": {
            "name": evaluated_camera.name,
            "worldMatrixRowsBlender": _rows(evaluated_camera.matrix_world),
            "projectionMatrixRows": _rows(projection),
            "lens": data.lens,
            "sensorFit": data.sensor_fit,
            "sensorWidth": data.sensor_width,
            "sensorHeight": data.sensor_height,
            "shiftX": data.shift_x,
            "shiftY": data.shift_y,
            "near": data.clip_start,
            "far": data.clip_end,
            "type": data.type,
        },
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", "utf8")
    print("BLENDLINK_DOGWALK_CAMERA " + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
