"""Render one-variable Eevee controls without saving the Splash source .blend.

Blender 5.2 narrows the source scene's output-format setter to its saved
FFMPEG value.  The control scene therefore starts as a fresh in-memory scene,
links the exact artist-owned objects/world/camera, and copies the render,
Eevee, color-management, view-layer, and compositor state.  Only the PNG
transport differs from the artist scene.

Run from the repository root:

    blender.exe --background <splash.blend> \
      --python experiments/splash-visual-fidelity-differential/render-source-controls.py

Optional arguments after ``--``:

    --output <directory>
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import platform
import sys
import time
from pathlib import Path
from typing import Any

import bpy


SCRIPT_PATH = Path(__file__).resolve()
REPOSITORY_ROOT = SCRIPT_PATH.parents[2]
DEFAULT_OUTPUT = SCRIPT_PATH.parent / "output" / "source-controls"
PACKED_NOISE_IMAGES = ("noiseA.jpg", "noiseB.jpg", "noiseC.jpg", "noiseD.jpg", "noiseE.jpg")


def parse_arguments() -> argparse.Namespace:
    script_arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args(script_arguments)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def relative_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        return str(path.resolve())


def json_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, "to_tuple"):
        return list(value.to_tuple())
    try:
        return list(value)
    except TypeError:
        return str(value)


def copy_scalar_properties(source: Any, target: Any, skip: set[str] | None = None) -> dict[str, Any]:
    skip = skip or set()
    copied: list[str] = []
    skipped: dict[str, str] = {}
    for prop in source.bl_rna.properties:
        name = prop.identifier
        if (
            name == "rna_type"
            or name in skip
            or prop.is_readonly
            or prop.type in {"POINTER", "COLLECTION"}
        ):
            continue
        try:
            value = getattr(source, name)
            if getattr(prop, "is_array", False):
                value = value[:]
            setattr(target, name, value)
            copied.append(name)
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            skipped[name] = repr(error)
    return {"copied": copied, "skipped": skipped}


def copy_curve_mapping(source: Any, target: Any) -> None:
    target.initialize()
    target.black_level = tuple(source.black_level)
    target.white_level = tuple(source.white_level)
    target.tone = source.tone
    for source_curve, target_curve in zip(source.curves, target.curves):
        while len(target_curve.points) > 2:
            target_curve.points.remove(target_curve.points[-2])
        target_curve.points[0].location = source_curve.points[0].location[:]
        target_curve.points[-1].location = source_curve.points[-1].location[:]
        for source_point in source_curve.points[1:-1]:
            target_point = target_curve.points.new(*source_point.location)
            target_point.handle_type = source_point.handle_type
        target_curve.points[0].handle_type = source_curve.points[0].handle_type
        target_curve.points[-1].handle_type = source_curve.points[-1].handle_type
    target.update()


def sync_layer_collections(source: Any, target: Any) -> None:
    for name in ("exclude", "holdout", "indirect_only", "hide_viewport"):
        setattr(target, name, getattr(source, name))
    target_children = {child.name: child for child in target.children}
    for source_child in source.children:
        target_child = target_children.get(source_child.name)
        if target_child is None:
            raise RuntimeError(f"Control view layer is missing collection {source_child.name!r}.")
        sync_layer_collections(source_child, target_child)


def create_control_scene(source: bpy.types.Scene) -> tuple[bpy.types.Scene, dict[str, Any]]:
    control = bpy.data.scenes.new("Blendlink Splash Source Control")
    bpy.context.window.scene = control
    control.render.engine = source.render.engine

    for child in source.collection.children:
        control.collection.children.link(child)
    for obj in source.collection.objects:
        control.collection.objects.link(obj)
    control.camera = source.camera
    control.world = source.world

    for name in ("frame_start", "frame_end", "frame_step", "frame_current", "frame_subframe"):
        setattr(control, name, getattr(source, name))

    copy_report: dict[str, Any] = {}
    copy_report["render"] = copy_scalar_properties(
        source.render,
        control.render,
        {"engine", "filepath", "image_settings", "ffmpeg", "bake"},
    )
    copy_report["eevee"] = copy_scalar_properties(source.eevee, control.eevee)

    control.render.image_settings.file_format = "PNG"
    for name in ("color_mode", "color_depth", "color_management", "compression"):
        setattr(control.render.image_settings, name, getattr(source.render.image_settings, name))

    copy_report["display"] = copy_scalar_properties(source.display_settings, control.display_settings)
    copy_report["sequencer_colorspace"] = copy_scalar_properties(
        source.sequencer_colorspace_settings,
        control.sequencer_colorspace_settings,
    )
    copy_report["view"] = copy_scalar_properties(
        source.view_settings,
        control.view_settings,
        {"curve_mapping"},
    )
    # Setting the transform resets the look, so enforce this dependency order.
    control.view_settings.view_transform = source.view_settings.view_transform
    control.view_settings.look = source.view_settings.look
    control.view_settings.exposure = source.view_settings.exposure
    control.view_settings.gamma = source.view_settings.gamma
    control.view_settings.use_curve_mapping = source.view_settings.use_curve_mapping
    copy_curve_mapping(source.view_settings.curve_mapping, control.view_settings.curve_mapping)

    if len(source.view_layers) != 1:
        raise RuntimeError(
            f"This differential expects one authored view layer, found {len(source.view_layers)}."
        )
    source_layer = source.view_layers[0]
    control_layer = control.view_layers[0]
    control_layer.name = source_layer.name
    copy_report["view_layer"] = copy_scalar_properties(
        source_layer,
        control_layer,
        {"name", "layer_collection", "objects", "cycles", "eevee"},
    )
    if hasattr(source_layer, "eevee") and hasattr(control_layer, "eevee"):
        copy_report["view_layer_eevee"] = copy_scalar_properties(
            source_layer.eevee,
            control_layer.eevee,
        )
    sync_layer_collections(source_layer.layer_collection, control_layer.layer_collection)

    if source.compositing_node_group is not None:
        control.compositing_node_group = source.compositing_node_group.copy()
        for node in control.compositing_node_group.nodes:
            if node.bl_idname == "CompositorNodeRLayers":
                node.scene = control
                node.layer = control_layer.name

    control.frame_set(source.frame_current, subframe=source.frame_subframe)
    return control, copy_report


def render_control(scene: bpy.types.Scene, output: Path) -> dict[str, Any]:
    scene.render.filepath = str(output)
    started = time.perf_counter()
    bpy.ops.render.render(write_still=True, scene=scene.name)
    elapsed_seconds = time.perf_counter() - started
    if not output.is_file():
        raise RuntimeError(f"Blender reported completion but did not write {output}.")
    return {
        "path": relative_path(output),
        "sha256": sha256(output),
        "bytes": output.stat().st_size,
        "elapsedSeconds": round(elapsed_seconds, 3),
    }


def neutralize_packed_noise_images() -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for image_name in PACKED_NOISE_IMAGES:
        image = bpy.data.images.get(image_name)
        if image is None:
            raise RuntimeError(f"Expected packed Splash image {image_name!r} is missing.")
        if image.packed_file is None and not image.packed_files:
            raise RuntimeError(f"Expected {image_name!r} to be packed in the source .blend.")
        width, height = image.size[:]
        pixels = image.pixels[:]
        pixel_count = len(pixels) // 4
        if pixel_count == 0:
            raise RuntimeError(f"Expected {image_name!r} to contain pixels.")
        means = [
            sum(pixels[channel::4]) / pixel_count
            for channel in range(4)
        ]
        image.pixels[:] = means * pixel_count
        image.update()
        reports.append(
            {
                "name": image_name,
                "size": [width, height],
                "pixelCount": pixel_count,
                "sceneLinearMeanRgba": [round(value, 9) for value in means],
                "colorspace": image.colorspace_settings.name,
            }
        )
    return reports


def main() -> None:
    arguments = parse_arguments()
    output_directory = arguments.output.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)

    source = bpy.context.scene
    source_path = Path(bpy.data.filepath).resolve()
    source_hash_before = sha256(source_path)
    source_look = {
        "engine": source.render.engine,
        "frame": source.frame_current,
        "resolution": [
            source.render.resolution_x,
            source.render.resolution_y,
            source.render.resolution_percentage,
        ],
        "viewTransform": source.view_settings.view_transform,
        "look": source.view_settings.look,
        "exposure": source.view_settings.exposure,
        "gamma": source.view_settings.gamma,
        "useCurveMapping": source.view_settings.use_curve_mapping,
        "compositor": source.compositing_node_group.name
        if source.compositing_node_group is not None
        else None,
    }
    control, copy_report = create_control_scene(source)

    rendered: dict[str, Any] = {}
    rendered["baselineA"] = render_control(control, output_directory / "baseline-a.png")
    rendered["baselineB"] = render_control(control, output_directory / "baseline-b.png")

    sun_objects = [
        obj
        for obj in control.objects
        if obj.type == "LIGHT" and obj.data.type == "SUN" and obj.visible_get()
    ]
    if len(sun_objects) != 1:
        raise RuntimeError(f"Expected one visible Sun control, found {len(sun_objects)}.")
    sun = sun_objects[0]
    source_sun_shadow = sun.data.use_shadow
    sun.data.use_shadow = False
    rendered["sunShadowsDisabled"] = render_control(
        control,
        output_directory / "sun-shadows-disabled.png",
    )
    sun.data.use_shadow = source_sun_shadow

    neutralized_images = neutralize_packed_noise_images()
    rendered["packedNoiseNeutralized"] = render_control(
        control,
        output_directory / "packed-noise-neutralized.png",
    )

    source_hash_after = sha256(source_path)
    if source_hash_before != source_hash_after:
        raise RuntimeError("The source .blend changed during the in-memory control render.")

    evidence = {
        "schemaVersion": 1,
        "kind": "blendlink-splash-retained-source-eevee-controls",
        "status": "prototype",
        "scope": (
            "Fixture-specific one-variable controls for the exact Blender 4.0 Splash "
            "derivative; these do not validate a general material compiler."
        ),
        "createdUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "toolchain": {
            "blender": bpy.app.version_string,
            "blenderVersion": list(bpy.app.version),
            "blenderBuildHash": bpy.app.build_hash.decode("utf-8")
            if isinstance(bpy.app.build_hash, bytes)
            else str(bpy.app.build_hash),
            "python": platform.python_version(),
        },
        "source": {
            "path": relative_path(source_path),
            "sha256Before": source_hash_before,
            "sha256After": source_hash_after,
            "saved": False,
            "look": source_look,
        },
        "controlScene": {
            "transportDeviation": (
                "Fresh in-memory scene and PNG output only; exact source collections, "
                "objects, world, camera, render/Eevee state, Filmic look/curves, "
                "view-layer exclusions, and copied compositor are retained."
            ),
            "resolvedLook": {
                "viewTransform": control.view_settings.view_transform,
                "look": control.view_settings.look,
                "exposure": control.view_settings.exposure,
                "gamma": control.view_settings.gamma,
                "useCurveMapping": control.view_settings.use_curve_mapping,
            },
            "copyReport": copy_report,
        },
        "variables": {
            "baselineA": "No authored behavior changed.",
            "baselineB": "No authored behavior changed; repeatability control.",
            "sunShadowsDisabled": {
                "onlyChange": f"{sun.name}.data.use_shadow",
                "from": source_sun_shadow,
                "to": False,
            },
            "packedNoiseNeutralized": {
                "onlyChange": (
                    "Packed noiseA-E image pixels replaced in memory with each image's "
                    "own scene-linear mean; Sun shadow setting restored first."
                ),
                "images": neutralized_images,
            },
        },
        "renders": rendered,
    }
    evidence_path = output_directory / "render-evidence.json"
    evidence_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(f"BLENDLINK_SOURCE_CONTROLS={evidence_path}")
    print(f"BLENDLINK_SOURCE_SHA256={source_hash_after}")


if __name__ == "__main__":
    main()
