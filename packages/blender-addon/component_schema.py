# SPDX-License-Identifier: GPL-3.0-or-later
"""Portable web-behaviour catalog shared by Blendlink's Blender UI.

The catalog is deliberately declarative.  Blender owns pleasant authoring,
the scene recipe owns portable intent, and the website runtime owns behavior.
Keeping labels, target rules, and value fields here prevents those three
layers from growing independent lists of almost-the-same components.
"""
from __future__ import annotations


COMPONENT_SCHEMA_VERSION = 1

# Portable JSON field -> Blender RNA editor property. Reference IDs/names are
# intentionally resolved through the dedicated ``reference_object`` pointer
# and therefore do not appear here. Keeping these bindings beside the catalog
# lets schema tests catch a new field whose editor was never connected.
COMPONENT_VALUE_BINDINGS = {
    "blendlink.bloom": {
        "mode": "bloom_mode", "intensity": "intensity",
        "threshold": "threshold", "radius": "radius",
    },
    "blendlink.vignette": {
        "intensity": "intensity", "softness": "softness", "color": "color",
    },
    "blendlink.chromatic-aberration": {
        "amount": "chromatic_amount", "mode": "chromatic_mode",
        "angle": "chromatic_angle", "centerX": "chromatic_center_x",
        "centerY": "chromatic_center_y",
    },
    "blendlink.pixelation": {
        "pixelSize": "pixel_size",
        "depthEdgeStrength": "pixel_depth_edge_strength",
        "normalEdgeStrength": "pixel_normal_edge_strength",
    },
    "blendlink.sharpen": {"amount": "sharpen_amount"},
    "blendlink.tilt-shift": {
        "focusPosition": "tilt_shift_focus_position",
        "angle": "tilt_shift_angle", "feather": "tilt_shift_feather",
        "strength": "tilt_shift_strength", "quality": "tilt_shift_quality",
    },
    "blendlink.ambient-occlusion": {
        "radiusMode": "ao_radius_mode", "worldRadius": "ao_world_radius",
        "screenRadius": "ao_screen_radius", "intensity": "ao_intensity",
        "color": "ao_color",
    },
    "blendlink.shadow-catcher": {
        "mode": "shadow_catcher_mode", "color": "shadow_catcher_color",
        "opacity": "shadow_catcher_opacity",
        "lightStrength": "shadow_catcher_light_strength",
        "includeDescendants": "shadow_catcher_include_descendants",
    },
    "blendlink.contact-shadows": {
        "autoFit": "contact_shadows_auto_fit",
        "darkness": "contact_shadows_darkness",
        "opacity": "contact_shadows_opacity",
        "blur": "contact_shadows_blur",
        "occludeBelowGround": "contact_shadows_occlude_below_ground",
        "backfaceShadows": "contact_shadows_backface_shadows",
        "updatePolicy": "contact_shadows_update_policy",
    },
    "blendlink.outline": {
        "visibleColor": "outline_visible_color",
        "hiddenColor": "outline_hidden_color",
        "strength": "outline_strength", "thickness": "outline_thickness",
        "xRay": "outline_xray",
    },
    "blendlink.color-grading": {
        "lutUrl": "color_grading_lut_url",
        "intensity": "color_grading_intensity",
        "tetrahedralInterpolation": "color_grading_tetrahedral",
    },
    "blendlink.depth-of-field": {
        "focusMode": "dof_focus_mode", "focusDistance": "dof_focus_distance",
        "focusRange": "dof_focus_range", "blurStrength": "dof_blur_strength",
    },
    "blendlink.kuwahara": {
        "strength": "kuwahara_strength", "brushScale": "kuwahara_brush_scale",
        "directionality": "kuwahara_directionality", "detail": "kuwahara_detail",
    },
    "blendlink.see-through": {
        "fadeDistance": "fade_distance", "minOpacity": "minimum_opacity",
        "duration": "duration",
    },
    "blendlink.open-url": {
        "label": "accessibility_label", "url": "url", "newTab": "new_tab",
    },
    "blendlink.hover": {"scale": "hover_scale", "duration": "duration"},
    "blendlink.website-surface": {
        "name": "website_surface_name",
        "colorTreatment": "website_surface_color_treatment",
    },
    "blendlink.hide-on-start": {},
    "blendlink.look-at": {"keepUp": "keep_up"},
    "blendlink.play-animation-on-click": {
        "label": "accessibility_label",
        "clip": "animation_clip", "loop": "animation_loop",
    },
    "blendlink.audio-source": {
        "url": "audio_url", "autoplay": "autoplay", "loop": "audio_loop",
        "volume": "volume", "spatial": "spatial",
        "minDistance": "min_distance", "maxDistance": "max_distance",
    },
    "blendlink.play-audio-on-click": {
        "label": "accessibility_label", "toggle": "toggle",
    },
}


COMPONENT_DEFINITIONS = {
    "blendlink.bloom": {
        "label": "Bloom",
        "category": "Effects",
        "description": "Add a soft glow around bright pixels in the website render; thresholds below 1 also work on the LDR fallback.",
        "keywords": ("glow", "emission", "post processing", "composer"),
        "phase": "post-hdr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline", "hdr-color"), "conflicts": (),
        "cost_level": "medium",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": ("bloom_mode", "intensity", "threshold", "radius"),
        "defaults": {
            "mode": "bright-pixels", "intensity": 0.5,
            "threshold": 0.8, "radius": 0.4,
        },
        "cost": "Full-screen effect · moderate GPU cost",
        "consequence": "Adds an HDR full-screen mip chain; Blendlink owns the website render pass while this effect is enabled.",
        "compatibility": "Three.js WebGL / Vanilla and R3F",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/BloomEffect.js~BloomEffect.html",
    },
    "blendlink.vignette": {
        "label": "Vignette",
        "category": "Effects",
        "description": "Gently darken or tint the frame edges.",
        "keywords": ("edges", "frame", "post processing", "composer"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": ("intensity", "softness", "color"),
        "defaults": {"intensity": 0.25, "softness": 0.55, "color": [0.0, 0.0, 0.0]},
        "cost": "Full-screen effect · low GPU cost",
        "consequence": "Blendlink owns the website render pass while this effect is enabled.",
        "compatibility": "Three.js WebGL / Vanilla and R3F",
        "support": "Built-in",
        # Blendlink's custom effect extends this concept with authored tint
        # and strict alpha preservation while remaining fuseable by pmndrs.
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/VignetteEffect.js~VignetteEffect.html",
    },
    "blendlink.chromatic-aberration": {
        "label": "Chromatic Aberration",
        "category": "Effects",
        "description": "Add restrained lens-like color separation to the website image.",
        "keywords": ("rgb split", "color fringe", "lens", "dispersion", "glitch"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "chromatic_amount", "chromatic_mode", "chromatic_angle",
            "chromatic_center_x", "chromatic_center_y",
        ),
        "defaults": {
            "amount": 0.0015, "mode": "radial", "angle": 0.0,
            "centerX": 0.5, "centerY": 0.5,
        },
        "cost": "Bounded full-screen color pass - low GPU cost",
        "consequence": "Strong values can reduce text and silhouette readability; Blendlink warns before publishing them.",
        "compatibility": "Three.js WebGL / directional and radial lens patterns",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/ChromaticAberrationEffect.js~ChromaticAberrationEffect.html",
    },
    "blendlink.pixelation": {
        "label": "Pixelation",
        "category": "Effects",
        "description": "Create a stable block-pixel look with optional geometry-aware edges.",
        "keywords": ("pixel art", "retro", "low resolution", "blocks", "8 bit", "geometry edges"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline", "depth", "normals"),
        "conflicts": (), "cost_level": "medium",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "pixel_size", "pixel_depth_edge_strength",
            "pixel_normal_edge_strength",
        ),
        "defaults": {
            "pixelSize": 6, "depthEdgeStrength": 0.0,
            "normalEdgeStrength": 0.0,
        },
        "cost": "Full-screen block sampling plus optional geometry edges - moderate GPU cost",
        "consequence": "CSS-pixel blocks stay visually stable when the browser device pixel ratio changes.",
        "compatibility": "Three.js WebGL / DPR-stable perspective and orthographic output",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/PixelationEffect.js~PixelationEffect.html",
    },
    "blendlink.sharpen": {
        "label": "Contrast-Adaptive Sharpen",
        "category": "Effects",
        "description": "Restore local clarity with a bounded FidelityFX-CAS-style pass.",
        "keywords": ("cas", "clarity", "crisp", "detail", "fidelityfx", "upsampling"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": ("sharpen_amount",),
        "defaults": {"amount": 0.35},
        "cost": "Fixed-footprint contrast-adaptive pass - low GPU cost",
        "consequence": "Shader work stays bounded; high amounts can still reveal halos or texture noise.",
        "compatibility": "Three.js WebGL / bounded FidelityFX-CAS-style policy",
        "support": "Built-in",
        "docs_url": "https://gpuopen.com/manuals/fidelityfx_sdk/techniques/contrast-adaptive-sharpening/",
    },
    "blendlink.tilt-shift": {
        "label": "Tilt Shift",
        "category": "Effects",
        "description": "Keep a controllable band sharp while smoothly blurring either side.",
        "keywords": ("miniature", "focus band", "lens blur", "photographic", "selective focus"),
        "phase": "post-hdr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (), "cost_level": "high",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "tilt_shift_focus_position", "tilt_shift_angle",
            "tilt_shift_feather", "tilt_shift_strength", "tilt_shift_quality",
        ),
        "defaults": {
            "focusPosition": 0.5, "angle": 0.0, "feather": 0.25,
            "strength": 0.7, "quality": "balanced",
        },
        "cost": "Separable HDR blur - high GPU cost at full quality",
        "consequence": "Quality changes only internal resolution and kernel policy, never the authored blur strength.",
        "compatibility": "Three.js WebGL / photographic pre-tone-map effect",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/TiltShiftEffect.js~TiltShiftEffect.html",
    },
    "blendlink.ambient-occlusion": {
        "label": "Ambient Occlusion",
        "category": "Effects",
        "description": "Add contact and crevice shading from the website camera.",
        "keywords": ("ao", "contact shadow", "grounding", "creases", "n8ao"),
        "phase": "post-depth", "cardinality": "one-per-scene",
        "requires": ("post-pipeline", "depth", "normals", "camera"),
        "conflicts": (), "cost_level": "high",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "ao_radius_mode", "ao_world_radius", "ao_screen_radius",
            "ao_intensity", "ao_color",
        ),
        "defaults": {
            "radiusMode": "world", "worldRadius": 1.0, "screenRadius": 32.0,
            "intensity": 2.0, "color": [0.0, 0.0, 0.0],
        },
        "cost": "Depth and normal sampling; high, scene-dependent GPU cost",
        "consequence": "Transparent geometry can require an additional draw while this depth-aware effect is enabled.",
        "compatibility": "Three.js WebGL / perspective and orthographic cameras",
        "support": "Built-in",
        "docs_url": "https://github.com/N8python/n8ao",
    },
    "blendlink.shadow-catcher": {
        "label": "Shadow Catcher",
        "category": "Rendering",
        "description": "Receive authored realtime shadows, add direct light, or act as an invisible depth occluder.",
        "keywords": ("shadow plane", "ground shadow", "mask", "occluder", "compositing"),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": (), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "fallback"},
        "fallbacks": {
            "tsl": "Mask and Occluder use standard Three materials; Additive requires the supported WebGL lighting seam.",
        },
        "targets": {"OBJECT"},
        "fields": (
            "shadow_catcher_mode", "shadow_catcher_color",
            "shadow_catcher_opacity", "shadow_catcher_light_strength",
            "shadow_catcher_include_descendants",
        ),
        "defaults": {
            "mode": "mask", "color": [0.0, 0.0, 0.0],
            "opacity": 0.5, "lightStrength": 6.6,
            "includeDescendants": True,
        },
        "cost": "Ordinary shadow/material rendering - low GPU cost",
        "consequence": "Temporarily replaces every descendant mesh material, then restores authored materials transactionally.",
        "compatibility": "Three.js WebGL / Vanilla and R3F; standard-material Mask and Occluder fallback",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/#api/en/materials/ShadowMaterial",
    },
    "blendlink.contact-shadows": {
        "label": "Contact Shadows",
        "category": "Rendering",
        "description": "Ground objects with a soft depth-derived shadow on an automatic scene plane or an authored Empty.",
        "keywords": (
            "ground shadow", "soft shadow", "product shadow",
            "contact", "grounding",
        ),
        "phase": "update", "cardinality": "one-per-scene",
        "requires": (), "conflicts": (), "cost_level": "high",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {
            "tsl": "Use the matched WebGL adapter; the Three.js TSL example has a different unverified kernel.",
        },
        "targets": {"SCENE", "OBJECT"},
        "fields": (
            "contact_shadows_auto_fit", "contact_shadows_darkness",
            "contact_shadows_opacity", "contact_shadows_blur",
            "contact_shadows_occlude_below_ground",
            "contact_shadows_backface_shadows",
            "contact_shadows_update_policy",
        ),
        "defaults": {
            "autoFit": True, "darkness": 0.5, "opacity": 0.5,
            "blur": 4.0, "occludeBelowGround": False,
            "backfaceShadows": True, "updatePolicy": "static",
        },
        "cost": "One depth mask and four blur passes per refresh - high transient GPU cost",
        "consequence": "Static settles after one valid refresh; Continuous repeats all five auxiliary passes every frame.",
        "compatibility": "Three.js WebGL / Vanilla and R3F demand or continuous rendering",
        "support": "Built-in",
        "docs_url": "https://threejs.org/examples/#webgl_shadow_contact",
    },
    "blendlink.outline": {
        "label": "Outline",
        "category": "Effects",
        "description": "Draw a readable silhouette around the rendered scene.",
        "keywords": ("edge", "silhouette", "stroke", "toon", "cel", "xray"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline", "depth", "camera"),
        "conflicts": (), "cost_level": "medium",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "outline_visible_color", "outline_hidden_color", "outline_strength",
            "outline_thickness", "outline_xray",
        ),
        "defaults": {
            "visibleColor": [0.0, 0.0, 0.0],
            "hiddenColor": [0.08, 0.08, 0.08],
            "strength": 3.0, "thickness": 1.0, "xRay": False,
        },
        "cost": "Depth-aware full-screen effect - moderate GPU cost",
        "consequence": "Every rendered mesh is outlined; X-Ray also reveals hidden silhouettes.",
        "compatibility": "Three.js WebGL / opaque and alpha-tested meshes",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/OutlineEffect.js~OutlineEffect.html",
    },
    "blendlink.color-grading": {
        "label": "Color Grade",
        "category": "Effects",
        "description": "Apply an authored 3D lookup table to the final website image.",
        "keywords": ("lut", "look", "grade", "film", "color correction", "cube"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (), "cost_level": "medium",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "color_grading_lut_url", "color_grading_intensity",
            "color_grading_tetrahedral",
        ),
        "defaults": {
            "lutUrl": "", "intensity": 1.0, "tetrahedralInterpolation": True,
        },
        "cost": "One 3D texture lookup; moderate GPU cost with tetrahedral interpolation",
        "consequence": "Loads one published LUT asset and grades the full frame after tone mapping.",
        "compatibility": "Three.js WebGL / published .cube or supported 3D LUT asset",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/LUT3DEffect.js~LUT3DEffect.html",
    },
    "blendlink.depth-of-field": {
        "label": "Depth of Field",
        "category": "Effects",
        "description": "Keep a chosen distance or scene object sharp while softening foreground and background.",
        "keywords": ("dof", "focus", "bokeh", "lens", "camera blur", "cinematic"),
        "phase": "post-depth", "cardinality": "one-per-scene",
        "requires": ("post-pipeline", "depth", "camera"),
        "conflicts": (), "cost_level": "high",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {},
        "targets": {"SCENE"},
        "fields": (
            "dof_focus_mode", "reference_object", "dof_focus_distance",
            "dof_focus_range", "dof_blur_strength",
        ),
        "defaults": {
            "focusMode": "distance", "focusDistance": 3.0,
            "focusRange": 2.0, "blurStrength": 1.0,
        },
        "cost": "Depth sampling plus multi-resolution blur - high GPU cost",
        "consequence": "Transparent surfaces may not focus like opaque geometry; Object mode follows its target every frame.",
        "compatibility": "Three.js WebGL / perspective cameras",
        "support": "Built-in",
        "docs_url": "https://pmndrs.github.io/postprocessing/public/docs/class/src/effects/DepthOfFieldEffect.js~DepthOfFieldEffect.html",
    },
    "blendlink.kuwahara": {
        "label": "Kuwahara Painterly Filter",
        "category": "Effects",
        "description": "Apply a bounded single-pass directional painterly approximation while retaining strong edges.",
        "keywords": ("paint", "painterly", "stylized", "brush", "anime", "anisotropic"),
        "phase": "post-ldr", "cardinality": "one-per-scene",
        "requires": ("post-pipeline",), "conflicts": (), "cost_level": "very-high",
        "adapters": {"webgl": "preview", "tsl": "preview"},
        "fallbacks": {"webgl": "Experimental Preview approximation: validate appearance, motion, and performance on target devices before publishing."},
        "targets": {"SCENE"},
        "fields": (
            "kuwahara_strength", "kuwahara_brush_scale",
            "kuwahara_directionality", "kuwahara_detail",
        ),
        "defaults": {
            "strength": 0.75, "brushScale": 4.0,
            "directionality": 0.75, "detail": 0.5,
        },
        "cost": "Single-pass full-resolution sector filter - very high GPU cost",
        "consequence": "Runtime quality changes sample count and filter radius, so appearance may change.",
        "compatibility": "Three.js WebGL Preview / validate animated cameras and target devices",
        "support": "Experimental Preview",
        "docs_url": "https://www.kyprianidis.com/p/pg2009/",
    },
    "blendlink.see-through": {
        "label": "Keep Visible Through Objects",
        "category": "Rendering",
        "description": "Keep this focal object visible by fading meshes between it and the website camera.",
        "keywords": ("xray", "occlusion", "fade", "transparent", "hero"),
        "phase": "update", "cardinality": "one-per-target",
        "requires": ("camera", "raycast"), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Provide a renderer-specific raycast and material adapter."},
        "targets": {"OBJECT"},
        "fields": ("fade_distance", "minimum_opacity", "duration"),
        "defaults": {"fadeDistance": 0.5, "minOpacity": 0.15, "duration": 0.12},
        "cost": "Camera raycast plus temporary transparent materials · low scene-dependent cost",
        "consequence": "Occluding materials are cloned and faded temporarily; the authored materials are restored on dispose.",
        "compatibility": "Three.js / perspective and orthographic cameras",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/Raycaster.html",
        "gizmos": ({
            "kind": "radius", "field": "fade_distance", "role": "clearance",
            "label": "Camera Clearance",
        },),
    },
    "blendlink.open-url": {
        "label": "Open Link on Click",
        "category": "Interaction",
        "description": "Open a web address when a visitor clicks this object.",
        "keywords": ("url", "website", "navigation", "button", "pointer"),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": ("pointer", "raycast", "dom-accessibility"), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Provide picking through a site adapter; the URL intent remains portable."},
        "targets": {"OBJECT"},
        "fields": ("accessibility_label", "url", "new_tab"),
        "defaults": {"label": "Open link", "url": "https://", "newTab": True},
        "cost": "Pointer interaction · negligible runtime cost",
        "consequence": "The renderer canvas becomes interactive and navigation follows the chosen browser target.",
        "compatibility": "Browser canvas / mouse, touch and pen",
        "support": "Built-in",
        "docs_url": "https://developer.mozilla.org/docs/Web/API/Window/open",
    },
    "blendlink.hover": {
        "label": "Emphasize on Hover",
        "category": "Interaction",
        "description": "Scale this object smoothly while the pointer is over it.",
        "keywords": ("rollover", "pointer", "highlight", "scale", "button"),
        "phase": "update", "cardinality": "one-per-target",
        "requires": ("pointer", "raycast"), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Provide picking through a site adapter; touch keeps the authored scale."},
        "targets": {"OBJECT"},
        "fields": ("hover_scale", "duration"),
        "defaults": {"scale": 1.08, "duration": 0.12},
        "cost": "Pointer interaction · negligible runtime cost",
        "consequence": "The website animates from the object's authored scale and restores it on dispose.",
        "compatibility": "Browser canvas / mouse, touch and pen",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/Raycaster.html",
    },
    "blendlink.website-surface": {
        "label": "Website Surface",
        "category": "Interaction",
        "description": "Let the website supply live pixels to Blender-authored geometry while preserving a fallback appearance.",
        "keywords": (
            "screen", "monitor", "canvas", "live texture",
            "application pixels", "website pixels",
        ),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": (), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "production", "tsl": "unavailable"},
        "fallbacks": {
            "tsl": "Use the verified WebGL adapter; WebGPU/TSL texture ownership has not been validated yet.",
        },
        "targets": {"MESH"},
        "fields": (
            "website_surface_name", "website_surface_color_treatment",
        ),
        "defaults": {"name": "surface", "colorTreatment": "display"},
        "cost": "One dynamic texture upload when application pixels change",
        "consequence": "The target must be one dedicated Realtime mesh with one material and UV0; Blendlink owns restoration and the application owns pixels.",
        "compatibility": "Three.js WebGL / Vanilla and R3F demand rendering",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/#api/en/textures/CanvasTexture",
    },
    "blendlink.hide-on-start": {
        "label": "Start Hidden",
        "category": "Interaction",
        "description": "Hide this object when the website scene first loads.",
        "keywords": ("visibility", "disable", "initial", "hidden"),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": (), "conflicts": (), "cost_level": "free",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "The intent is renderer-neutral, but Blendlink does not ship a TSL runtime adapter yet."},
        "targets": {"OBJECT"},
        "fields": (),
        "defaults": {},
        "cost": "No ongoing runtime cost",
        "consequence": "The website starts with this object's visibility disabled; authored Blender visibility is unchanged.",
        "compatibility": "Three.js / Vanilla and R3F",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/Object3D.html#visible",
    },
    "blendlink.look-at": {
        "label": "Look At Object",
        "category": "Motion",
        "description": "Keep this object aimed at another rename-safe scene object.",
        "keywords": ("track", "constraint", "billboard", "face", "target"),
        "phase": "update", "cardinality": "one-per-target",
        "requires": ("camera",), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "The intent is renderer-neutral, but Blendlink does not ship a TSL runtime adapter yet."},
        "targets": {"OBJECT"},
        "fields": ("reference_object", "keep_up"),
        "defaults": {"keepUp": True},
        "cost": "Updates every frame · low CPU cost",
        "consequence": "The website owns this object's rotation while enabled; its position and scale remain authored.",
        "compatibility": "Three.js / rename-safe object references",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/Object3D.html#lookAt",
    },
    "blendlink.play-animation-on-click": {
        "label": "Play Animation on Click",
        "category": "Animation",
        "description": "Play an exported Blender action when this object is clicked.",
        "keywords": ("action", "clip", "timeline", "trigger", "pointer"),
        "phase": "update", "cardinality": "one-per-target",
        "requires": ("animation", "pointer", "raycast"), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Provide picking through a site adapter; animation remains standard glTF."},
        "targets": {"OBJECT"},
        "fields": ("accessibility_label", "animation_clip", "animation_loop"),
        "defaults": {"label": "Play animation", "clip": "", "loop": False},
        "cost": "Pointer interaction plus one animation action",
        "consequence": "A website AnimationMixer owns the chosen clip after a visitor clicks the object.",
        "compatibility": "Exported glTF animation clips / browser canvas",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/AnimationMixer.html",
    },
    "blendlink.audio-source": {
        "label": "Audio Source",
        "category": "Audio",
        "description": "Load website audio on this object, optionally with predictable spatial falloff.",
        "keywords": ("sound", "music", "positional", "speaker", "media"),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": ("audio",), "conflicts": (), "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Web Audio is portable, but Blendlink does not ship a TSL runtime adapter yet."},
        "targets": {"OBJECT"},
        "fields": (
            "audio_url", "autoplay", "audio_loop", "volume", "spatial",
            "min_distance", "max_distance",
        ),
        "defaults": {
            "url": "", "autoplay": False, "loop": False, "volume": 1.0,
            "spatial": False, "minDistance": 2.0, "maxDistance": 50.0,
        },
        "cost": "Streams one audio asset; browsers may require a visitor gesture before playback",
        "consequence": "Spatial sound stays full-volume inside the inner radius, fades linearly, and is silent at the outer radius.",
        "compatibility": "Browser Web Audio / Three.js linear positional audio",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/PositionalAudio.html",
        "gizmos": (
            {
                "kind": "radius", "field": "min_distance", "role": "inner",
                "label": "Full Volume", "when": {"field": "spatial", "equals": True},
            },
            {
                "kind": "radius", "field": "max_distance", "role": "outer",
                "label": "Silent Beyond", "when": {"field": "spatial", "equals": True},
            },
        ),
    },
    "blendlink.play-audio-on-click": {
        "label": "Play Audio on Click",
        "category": "Audio",
        "description": "Play or toggle an Audio Source when this object is clicked.",
        "keywords": ("sound", "trigger", "pointer", "button", "toggle"),
        "phase": "initial", "cardinality": "one-per-target",
        "requires": ("audio", "pointer", "raycast"), "conflicts": (),
        "cost_level": "low",
        "adapters": {"webgl": "preview", "tsl": "unavailable"},
        "fallbacks": {"tsl": "Provide picking through a site adapter; playback remains Web Audio."},
        "targets": {"OBJECT"},
        "fields": ("accessibility_label", "reference_object", "toggle"),
        "defaults": {"label": "Play audio", "toggle": False},
        "cost": "Pointer interaction · negligible runtime cost",
        "consequence": "Clicking this object controls the referenced Audio Source; it does not duplicate the audio asset.",
        "compatibility": "Browser Web Audio / requires an Audio Source",
        "support": "Built-in",
        "docs_url": "https://threejs.org/docs/pages/Audio.html",
    },
}


COMPONENT_CATEGORIES = tuple(dict.fromkeys(
    definition["category"] for definition in COMPONENT_DEFINITIONS.values()
))

_PHASES = {"initial", "update", "fixed", "post-depth", "post-hdr", "post-ldr"}
_CARDINALITIES = {"one-per-target", "many-per-target", "one-per-scene"}
_COST_LEVELS = {"free", "low", "medium", "high", "very-high"}
_SUPPORT_LEVELS = {"production", "preview", "fallback", "unavailable"}
_COST_BADGES = {
    "free": "No ongoing cost",
    "low": "Low runtime cost",
    "medium": "Medium GPU cost",
    "high": "High GPU cost",
    "very-high": "Very high GPU cost",
}


def cost_badge(value) -> str:
    return _COST_BADGES.get(value.get("cost_level"), "Unmeasured cost")


def support_badge(value) -> str:
    adapters = value.get("adapters", {})
    webgl = str(adapters.get("webgl", "unavailable")).title()
    tsl = str(adapters.get("tsl", "unavailable")).title()
    return f"WebGL {webgl} · WebGPU/TSL {tsl}"


def adapter_badge(value, adapter: str) -> str:
    label = {"webgl": "WebGL", "tsl": "WebGPU/TSL"}.get(adapter, adapter)
    level = str(value.get("adapters", {}).get(adapter, "unavailable")).title()
    return f"{label} {level}"


def target_badge(value) -> str:
    targets = set(value.get("targets", ()))
    if targets == {"SCENE"}:
        return "Scene effect"
    if targets <= {"OBJECT", "MESH"}:
        return "Object behavior"
    return "Scene or object"


def definition(component_type: str):
    return COMPONENT_DEFINITIONS.get(component_type)


def label(component_type: str) -> str:
    value = definition(component_type)
    if value is not None:
        return value["label"]
    return component_type.rsplit(".", 1)[-1].replace("-", " ").title()


def supports_target(component_type: str, target_kind: str) -> bool:
    value = definition(component_type)
    if value is None:
        return True
    targets = value["targets"]
    return target_kind in targets or (target_kind == "MESH" and "OBJECT" in targets)


def known_types_for_target(target_kind: str) -> tuple[str, ...]:
    return tuple(
        component_type
        for component_type in COMPONENT_DEFINITIONS
        if supports_target(component_type, target_kind)
    )


def search_catalog(
    query: str = "", *, category: str = "ALL", target_mode: str = "ALL",
) -> tuple[tuple[str, dict], ...]:
    """Return the artist catalog in stable presentation order.

    Search is token based: every word must occur somewhere in the component's
    name, category, description, consequence, compatibility, or keywords.
    ``target_mode`` deliberately uses the UI's SCENE/SELECTION vocabulary so
    callers never need to know that mesh behaviors are also object records.
    """
    if target_mode not in {"ALL", "SCENE", "SELECTION"}:
        raise ValueError(f"Unknown component target mode {target_mode!r}")
    wanted_category = (category or "ALL").strip()
    tokens = tuple(token.casefold() for token in (query or "").split() if token)
    matches = []
    for component_type, value in COMPONENT_DEFINITIONS.items():
        if wanted_category != "ALL" and value["category"] != wanted_category:
            continue
        targets = value["targets"]
        if target_mode == "SCENE" and "SCENE" not in targets:
            continue
        if target_mode == "SELECTION" and not ({"OBJECT", "MESH"} & targets):
            continue
        searchable = " ".join((
            component_type,
            value["label"],
            value["category"],
            value["description"],
            value.get("cost", ""),
            value.get("consequence", ""),
            value.get("compatibility", ""),
            " ".join(value.get("keywords", ())),
            " ".join(value.get("requires", ())),
            " ".join(value.get("conflicts", ())),
            " ".join(value.get("targets", ())),
            support_badge(value),
            cost_badge(value),
            " ".join(value.get("fallbacks", {}).values()),
        )).casefold()
        if all(token in searchable for token in tokens):
            matches.append((component_type, value))
    return tuple(matches)


def validate_catalog() -> tuple[str, ...]:
    """Return catalog authoring errors without importing Blender.

    This keeps schema mistakes visible in focused tests and lets the UI remain
    a thin presentation adapter over a fully described catalog.
    """
    errors = []
    required = (
        "label", "category", "description", "targets", "fields", "defaults",
        "cost", "consequence", "compatibility", "support", "docs_url",
        "phase", "cardinality", "requires", "conflicts", "cost_level",
        "adapters", "fallbacks",
    )
    for component_type, value in COMPONENT_DEFINITIONS.items():
        for key in required:
            if key not in value or value[key] in (None, ""):
                errors.append(f"{component_type} is missing {key}")
        if not value.get("targets") or not set(value["targets"]) <= {"SCENE", "OBJECT", "MESH"}:
            errors.append(f"{component_type} has invalid targets")
        if not str(value.get("docs_url", "")).startswith("https://"):
            errors.append(f"{component_type} docs_url must use HTTPS")
        if value.get("phase") not in _PHASES:
            errors.append(f"{component_type} has invalid lifecycle phase")
        if value.get("cardinality") not in _CARDINALITIES:
            errors.append(f"{component_type} has invalid cardinality")
        if value.get("cardinality") == "one-per-scene" and "SCENE" not in value.get("targets", ()):
            errors.append(f"{component_type} one-per-scene must target Scene")
        if value.get("cost_level") not in _COST_LEVELS:
            errors.append(f"{component_type} has invalid cost level")
        adapters = value.get("adapters")
        if not isinstance(adapters, dict) or set(adapters) != {"webgl", "tsl"}:
            errors.append(f"{component_type} must declare WebGL and TSL adapter support")
        elif not set(adapters.values()) <= _SUPPORT_LEVELS:
            errors.append(f"{component_type} has invalid adapter support")
        fallbacks = value.get("fallbacks")
        if not isinstance(fallbacks, dict) or not set(fallbacks) <= {"webgl", "tsl"}:
            errors.append(f"{component_type} has invalid adapter fallbacks")
        elif any(not isinstance(text, str) or not text.strip() for text in fallbacks.values()):
            errors.append(f"{component_type} has an empty adapter fallback")
        for conflict in value.get("conflicts", ()):
            if not isinstance(conflict, str) or "." not in conflict:
                errors.append(f"{component_type} has invalid conflict {conflict!r}")
        bindings = COMPONENT_VALUE_BINDINGS.get(component_type)
        if bindings is None:
            errors.append(f"{component_type} has no JSON/RNA value bindings")
            bindings = {}
        missing_defaults = set(value.get("defaults", {})) - set(bindings)
        if missing_defaults:
            errors.append(
                f"{component_type} defaults have no RNA binding: "
                + ", ".join(sorted(missing_defaults))
            )
        unknown_properties = set(bindings.values()) - set(value.get("fields", ()))
        if unknown_properties:
            errors.append(
                f"{component_type} bindings are not declared editor fields: "
                + ", ".join(sorted(unknown_properties))
            )
        for index, gizmo in enumerate(value.get("gizmos", ())):
            path = f"{component_type}.gizmos[{index}]"
            if not isinstance(gizmo, dict) or gizmo.get("kind") != "radius":
                errors.append(f"{path} has an unsupported kind")
                continue
            if gizmo.get("field") not in value.get("fields", ()):
                errors.append(f"{path}.field is not an editor field")
            if not gizmo.get("role") or not gizmo.get("label"):
                errors.append(f"{path} needs a role and label")
            condition = gizmo.get("when")
            if condition is not None and (
                not isinstance(condition, dict)
                or condition.get("field") not in value.get("fields", ())
                or "equals" not in condition
            ):
                errors.append(f"{path}.when is invalid")
    extra_bindings = set(COMPONENT_VALUE_BINDINGS) - set(COMPONENT_DEFINITIONS)
    if extra_bindings:
        errors.append(
            "bindings exist for unknown components: "
            + ", ".join(sorted(extra_bindings))
        )
    return tuple(errors)


def validate_rna_bindings(rna_owner) -> tuple[str, ...]:
    """Verify every declared editor field against registered Blender RNA.

    ``rna_owner`` may be the registered PropertyGroup type or a plain iterable
    of property names, keeping the catalog module bpy-free for fast tests.
    """
    try:
        names = {
            prop.identifier for prop in rna_owner.bl_rna.properties
        }
    except AttributeError:
        names = {str(name) for name in rna_owner}
    errors = []
    for component_type, definition in COMPONENT_DEFINITIONS.items():
        for field in definition.get("fields", ()):
            if field not in names:
                errors.append(
                    f"{component_type} editor field {field!r} is not registered RNA"
                )
        for json_key, attribute in COMPONENT_VALUE_BINDINGS.get(
            component_type, {},
        ).items():
            if attribute not in names:
                errors.append(
                    f"{component_type}.{json_key} binds missing RNA {attribute!r}"
                )
    return tuple(errors)
