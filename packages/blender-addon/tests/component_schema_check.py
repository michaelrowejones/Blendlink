# SPDX-License-Identifier: GPL-3.0-or-later
"""Fast bpy-free contract for the artist-facing component catalog."""
import importlib.util
from pathlib import Path


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "component_schema.py"
SPEC = importlib.util.spec_from_file_location("blendlink_component_schema_check", SCHEMA_PATH)
SCHEMA = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCHEMA)


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


expect(SCHEMA.validate_catalog() == (), f"invalid catalog: {SCHEMA.validate_catalog()}")
expect(
    [item[0] for item in SCHEMA.search_catalog("glow", target_mode="SCENE")]
    == ["blendlink.bloom"],
    "artist task search did not find Bloom",
)
expect(
    [item[0] for item in SCHEMA.search_catalog("moderate gpu", target_mode="SCENE")]
    == [
        "blendlink.bloom", "blendlink.pixelation", "blendlink.outline",
        "blendlink.color-grading",
    ],
    "catalog search did not include the artist-facing cost description",
)
expect(
    [item[0] for item in SCHEMA.search_catalog(
        "pointer audio", target_mode="SELECTION",
    )] == ["blendlink.play-audio-on-click"],
    "token search did not combine component metadata",
)
expect(
    SCHEMA.search_catalog("glow", target_mode="SELECTION") == (),
    "scene-only effect leaked into the object catalog",
)
expect(
    SCHEMA.definition("blendlink.bloom")["requires"]
    == ("post-pipeline", "hdr-color")
    and SCHEMA.definition("blendlink.bloom")["phase"] == "post-hdr"
    and SCHEMA.definition("blendlink.bloom")["cost_level"] == "medium",
    "Bloom runtime capability metadata drifted",
)
expect(
    SCHEMA.support_badge(SCHEMA.definition("blendlink.bloom"))
    # Bloom is implemented on the TSL post pipeline
    # (threeWebgpuPostPipeline.ts); the badge said Unavailable, which is the
    # sentence an artist actually reads in Blender.
    == "WebGL Preview · WebGPU/TSL Preview"
    and SCHEMA.cost_badge(SCHEMA.definition("blendlink.bloom"))
    == "Medium GPU cost"
    and SCHEMA.target_badge(SCHEMA.definition("blendlink.bloom"))
    == "Scene effect",
    "artist-facing support, target, or cost badges drifted",
)
expect(
    "blendlink.bloom" in {
        item[0] for item in SCHEMA.search_catalog(
            "webgpu preview", target_mode="SCENE",
        )
    },
    "catalog search did not include adapter support",
)
expect(
    SCHEMA.definition("blendlink.see-through")["gizmos"] == ({
        "kind": "radius", "field": "fade_distance", "role": "clearance",
        "label": "Camera Clearance",
    },),
    "see-through gizmo metadata drifted",
)
expect(
    tuple(item["field"] for item in SCHEMA.definition("blendlink.audio-source")["gizmos"])
    == ("min_distance", "max_distance"),
    "spatial-audio gizmo metadata drifted",
)
expect(
    [item[0] for item in SCHEMA.search_catalog("paint", target_mode="SCENE")]
    == ["blendlink.kuwahara"]
    and [item[0] for item in SCHEMA.search_catalog("grounding", target_mode="SCENE")]
    == ["blendlink.ambient-occlusion", "blendlink.contact-shadows"]
    and [item[0] for item in SCHEMA.search_catalog("bokeh", target_mode="SCENE")]
    == ["blendlink.depth-of-field"]
    and [item[0] for item in SCHEMA.search_catalog("xray", target_mode="SCENE")]
    == ["blendlink.outline"],
    "Batch 1 effects are not discoverable by artist outcome",
)
expect(
    SCHEMA.definition("blendlink.ambient-occlusion")["requires"]
    == ("post-pipeline", "depth", "normals", "camera")
    and SCHEMA.definition("blendlink.ambient-occlusion")["phase"] == "post-depth"
    and SCHEMA.definition("blendlink.ambient-occlusion")["cost_level"] == "high"
    and SCHEMA.definition("blendlink.kuwahara")["adapters"]
    == {"webgl": "preview", "tsl": "preview"}
    and "Experimental Preview approximation"
    in SCHEMA.definition("blendlink.kuwahara")["fallbacks"]["webgl"],
    "Batch 1 capability, cost, or preview support metadata drifted",
)
expect(
    [item[0] for item in SCHEMA.search_catalog("rgb split", target_mode="SCENE")]
    == ["blendlink.chromatic-aberration"]
    and [item[0] for item in SCHEMA.search_catalog("pixel art", target_mode="SCENE")]
    == ["blendlink.pixelation"]
    and [item[0] for item in SCHEMA.search_catalog("fidelityfx", target_mode="SCENE")]
    == ["blendlink.sharpen"]
    and [item[0] for item in SCHEMA.search_catalog("miniature", target_mode="SCENE")]
    == ["blendlink.tilt-shift"],
    "Batch 2 effects are not discoverable by artist outcome",
)
expect(
    SCHEMA.definition("blendlink.chromatic-aberration")["phase"] == "post-ldr"
    and SCHEMA.definition("blendlink.pixelation")["requires"]
    == ("post-pipeline", "depth", "normals")
    and SCHEMA.definition("blendlink.sharpen")["cost_level"] == "low"
    and SCHEMA.definition("blendlink.tilt-shift")["phase"] == "post-hdr"
    and "never" in SCHEMA.definition("blendlink.tilt-shift")["consequence"],
    "Batch 2 phase, capability, cost, or quality policy drifted",
)
expect(
    SCHEMA.definition("blendlink.bloom")["defaults"]["mode"] == "bright-pixels"
    and SCHEMA.definition("blendlink.bloom")["defaults"]["threshold"] == 0.8
    and SCHEMA.COMPONENT_VALUE_BINDINGS["blendlink.bloom"]["mode"] == "bloom_mode"
    and SCHEMA.definition("blendlink.depth-of-field")["defaults"] == {
        "focusMode": "distance", "focusDistance": 3.0,
        "focusRange": 2.0, "blurStrength": 1.0,
    },
    "Bloom selection or depth-of-field authoring defaults drifted",
)
batch_defaults = {
    "blendlink.ambient-occlusion": {
        "radiusMode": "world", "worldRadius": 1.0, "screenRadius": 32.0,
        "intensity": 2.0, "color": [0.0, 0.0, 0.0],
    },
    "blendlink.shadow-catcher": {
        "mode": "mask", "color": [0.0, 0.0, 0.0],
        "opacity": 0.5, "lightStrength": 6.6,
        "includeDescendants": True,
    },
    "blendlink.contact-shadows": {
        "autoFit": True, "darkness": 0.5, "opacity": 0.5,
        "blur": 4.0, "occludeBelowGround": False,
        "backfaceShadows": True, "updatePolicy": "static",
    },
    "blendlink.outline": {
        "visibleColor": [0.0, 0.0, 0.0],
        "hiddenColor": [0.08, 0.08, 0.08],
        "strength": 3.0, "thickness": 1.0, "xRay": False,
    },
    "blendlink.color-grading": {
        "lutUrl": "", "intensity": 1.0, "tetrahedralInterpolation": True,
    },
    "blendlink.depth-of-field": {
        "focusMode": "distance", "focusDistance": 3.0,
        "focusRange": 2.0, "blurStrength": 1.0,
    },
    "blendlink.kuwahara": {
        "strength": 0.75, "brushScale": 4.0,
        "directionality": 0.75, "detail": 0.5,
    },
    "blendlink.chromatic-aberration": {
        "amount": 0.0015, "mode": "radial", "angle": 0.0,
        "centerX": 0.5, "centerY": 0.5,
    },
    "blendlink.pixelation": {
        "pixelSize": 6, "depthEdgeStrength": 0.0,
        "normalEdgeStrength": 0.0,
    },
    "blendlink.sharpen": {"amount": 0.35},
    "blendlink.tilt-shift": {
        "focusPosition": 0.5, "angle": 0.0, "feather": 0.25,
        "strength": 0.7, "quality": "balanced",
    },
}
expect(
    all(SCHEMA.definition(component_type)["defaults"] == defaults
        for component_type, defaults in batch_defaults.items()),
    "Blender effect defaults drifted from the portable TypeScript contract",
)
expect(
    [item[0] for item in SCHEMA.search_catalog(
        "shadow plane", target_mode="SELECTION",
    )] == ["blendlink.shadow-catcher", "blendlink.contact-shadows"]
    and SCHEMA.definition("blendlink.shadow-catcher")["targets"] == {"OBJECT"}
    and SCHEMA.definition("blendlink.shadow-catcher")["phase"] == "initial"
    and SCHEMA.COMPONENT_VALUE_BINDINGS["blendlink.shadow-catcher"] == {
        "mode": "shadow_catcher_mode",
        "color": "shadow_catcher_color",
        "opacity": "shadow_catcher_opacity",
        "lightStrength": "shadow_catcher_light_strength",
        "includeDescendants": "shadow_catcher_include_descendants",
    },
    "Shadow Catcher discoverability or authoring contract drifted",
)
expect(
    [item[0] for item in SCHEMA.search_catalog(
        "application pixels", target_mode="SELECTION",
    )] == ["blendlink.website-surface"]
    and SCHEMA.definition("blendlink.website-surface")["defaults"] == {
        "name": "surface", "colorTreatment": "display",
    }
    and SCHEMA.COMPONENT_VALUE_BINDINGS["blendlink.website-surface"] == {
        "name": "website_surface_name",
        "colorTreatment": "website_surface_color_treatment",
    },
    "Website Surface discoverability or authoring contract drifted",
)
expect(
    [item[0] for item in SCHEMA.search_catalog(
        "soft shadow", target_mode="SCENE",
    )] == ["blendlink.contact-shadows"]
    and [item[0] for item in SCHEMA.search_catalog(
        "soft shadow", target_mode="SELECTION",
    )] == ["blendlink.contact-shadows"]
    and SCHEMA.definition("blendlink.contact-shadows")["targets"]
    == {"SCENE", "OBJECT"}
    and SCHEMA.definition("blendlink.contact-shadows")["cardinality"]
    == "one-per-scene"
    and SCHEMA.COMPONENT_VALUE_BINDINGS["blendlink.contact-shadows"] == {
        "autoFit": "contact_shadows_auto_fit",
        "darkness": "contact_shadows_darkness",
        "opacity": "contact_shadows_opacity",
        "blur": "contact_shadows_blur",
        "occludeBelowGround": "contact_shadows_occlude_below_ground",
        "backfaceShadows": "contact_shadows_backface_shadows",
        "updatePolicy": "contact_shadows_update_policy",
    },
    "Contact Shadows discoverability or authoring contract drifted",
)

print("BLENDLINK_COMPONENT_SCHEMA_CHECK_PASSED")
