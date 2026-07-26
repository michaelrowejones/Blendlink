# SPDX-License-Identifier: GPL-3.0-or-later
"""Focused Blender/RNA contract for the second artist-effect batch."""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_component_batch2_check"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


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


def add_scene_component(project, component_id, component_type):
    component = project.components.add()
    component.component_id = component_id
    component.component_type = component_type
    component.target_kind = "SCENE"
    return component


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon = load_addon()
    props = sys.modules[f"{PACKAGE}.props"]
    schema = sys.modules[f"{PACKAGE}.component_schema"]
    validation = sys.modules[f"{PACKAGE}.component_validation"]
    scene = bpy.context.scene
    project = scene.blendlink_project

    expect(schema.validate_catalog() == (), f"invalid catalog: {schema.validate_catalog()}")
    expect(
        schema.validate_rna_bindings(props.BlendlinkComponentSettings) == (),
        "Batch 2 JSON fields are not connected to registered Blender RNA",
    )

    chromatic = add_scene_component(
        project, "component-chromatic", "blendlink.chromatic-aberration",
    )
    chromatic.raw_values = '{"futureLensModel":"anamorphic"}'
    chromatic.chromatic_amount = 0.012
    chromatic.chromatic_mode = "directional"
    chromatic.chromatic_angle = math.radians(15.0)
    chromatic.chromatic_center_x = 0.4
    chromatic.chromatic_center_y = 0.6

    pixelation = add_scene_component(
        project, "component-pixelation", "blendlink.pixelation",
    )
    pixelation.pixel_size = 8
    pixelation.pixel_depth_edge_strength = 0.5
    pixelation.pixel_normal_edge_strength = 0.25

    sharpen = add_scene_component(project, "component-sharpen", "blendlink.sharpen")
    sharpen.sharpen_amount = 0.4

    tilt_shift = add_scene_component(
        project, "component-tilt-shift", "blendlink.tilt-shift",
    )
    tilt_shift.tilt_shift_focus_position = 0.4
    tilt_shift.tilt_shift_angle = math.radians(-12.0)
    tilt_shift.tilt_shift_feather = 0.3
    tilt_shift.tilt_shift_strength = 0.75
    tilt_shift.tilt_shift_quality = "high"

    records = props.serialized_components(project)
    values = {record["type"]: record["values"] for record in records}
    expect(
        values["blendlink.chromatic-aberration"]["futureLensModel"] == "anamorphic"
        and abs(values["blendlink.chromatic-aberration"]["angle"] - 15.0) < 1e-6
        and values["blendlink.pixelation"]["pixelSize"] == 8
        and abs(values["blendlink.pixelation"]["depthEdgeStrength"] - 0.5) < 1e-6
        and abs(values["blendlink.sharpen"]["amount"] - 0.4) < 1e-6
        and abs(values["blendlink.tilt-shift"]["angle"] + 12.0) < 1e-6
        and values["blendlink.tilt-shift"]["quality"] == "high",
        f"Batch 2 values did not serialize faithfully: {values}",
    )
    issues = validation.validate_component(project, chromatic, scene=scene)
    expect(
        any(issue.code == "strong_chromatic_aberration" and not issue.blocking
            for issue in issues),
        f"strong chromatic amount did not produce a non-blocking warning: {issues}",
    )

    try:
        props._validate_component_values(
            "blendlink.pixelation",
            {"pixelSize": 5.5, "depthEdgeStrength": 0.0, "normalEdgeStrength": 0.0},
            "Imported Pixelation",
        )
    except ValueError as error:
        expect("whole number of CSS pixels" in str(error),
               f"fractional pixel failure was not actionable: {error}")
    else:
        raise AssertionError("fractional CSS-pixel size was silently rounded")

    props._hydrate_components(project, scene, records)
    hydrated = props.serialized_components(project)
    hydrated_values = {record["type"]: record["values"] for record in hydrated}
    expect(
        hydrated_values["blendlink.chromatic-aberration"]["futureLensModel"]
        == "anamorphic"
        and abs(hydrated_values["blendlink.chromatic-aberration"]["angle"] - 15.0) < 1e-6
        and hydrated_values["blendlink.pixelation"]["pixelSize"] == 8
        and hydrated_values["blendlink.tilt-shift"]["quality"] == "high",
        f"Batch 2 import lost authored or extension values: {hydrated_values}",
    )

    addon.unregister()
    print("BLENDLINK_COMPONENT_BATCH2_CHECK_PASSED")


if __name__ == "__main__":
    main()
