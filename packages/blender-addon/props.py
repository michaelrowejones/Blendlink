# SPDX-License-Identifier: GPL-3.0-or-later
"""Artist-owned scene recipe plus session-only UI state.

The canonical portable copy is the namespaced ``blendlink_recipe`` JSON
custom property. Native RNA properties make it pleasant to edit in Blender;
the JSON lets the headless exporter read the same intent without requiring
the addon to be installed in the export process.
"""
from __future__ import annotations

import json
import math
import re
import uuid

import bpy

from . import component_schema, component_validation, nla_sequence, probe_authoring
from .bakelib_loader import bakelib


RECIPE_PROPERTY = "blendlink_recipe"
RECIPE_SCHEMA_VERSION = 1
_loading_recipe = False

_SHADOW_PRESETS = {
    "APPLICATION": ("PCF", 1024, 50.0, -0.0005, 0.02, 1.0, True),
    "OFF": ("PCF", 1024, 50.0, -0.0005, 0.02, 1.0, True),
    "PERFORMANCE": ("BASIC", 512, 30.0, -0.0005, 0.02, 1.0, True),
    "BALANCED": ("PCF", 1024, 50.0, -0.0005, 0.02, 1.0, True),
    "SOFT": ("VSM", 2048, 50.0, -0.0001, 0.02, 4.0, True),
    "CRISP": ("PCF", 2048, 75.0, -0.0005, 0.01, 1.0, True),
}


def _redraw_view3d(self, context):
    for window in context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()


def _project_changed(self, context):
    if _loading_recipe or context is None or context.scene is None:
        return
    # The bake table is session-only derived UI. Advance its cheap source
    # token here so the next shared timer tick rebuilds exactly once.
    from . import handlers, validation
    handlers.mark_bake_table_changed()
    # Effective rendering and geometry routes depend on presentation/camera
    # intent. Show Checking immediately and rebuild the shared analysis cache.
    validation.mark_dirty()
    project = context.scene.blendlink_project
    if project.configured:
        try:
            write_recipe(context.scene)
        except ValueError:
            # Live editing may pass through a temporarily invalid value. The
            # last valid embedded settings remain intact, while recipe_error
            # and publish preflight keep the problem visible and blocking.
            pass


def _animation_sequence_source_changed(self, context):
    """Choose the first track only when the current selection is unusable."""
    source = getattr(self, "animation_sequence_source", None)
    animation = getattr(source, "animation_data", None) if source is not None else None
    tracks = tuple(getattr(animation, "nla_tracks", ()) or ())
    current = str(getattr(self, "animation_sequence_track", "") or "")
    if tracks and not any(track.name == current for track in tracks):
        self.animation_sequence_track = tracks[0].name
    elif not tracks and current:
        self.animation_sequence_track = ""
    _project_changed(self, context)


class BlendlinkAtlasSettings(bpy.types.PropertyGroup):
    atlas_id: bpy.props.StringProperty(name="ID", default="main", update=_project_changed)
    name: bpy.props.StringProperty(name="Name", default="Main", update=_project_changed)
    size: bpy.props.IntProperty(
        name="Resolution", default=2048, min=128, max=8192, subtype="PIXEL",
        update=_project_changed,
    )
    target_density: bpy.props.FloatProperty(
        name="Minimum Detail",
        description=(
            "Validation floor in atlas texels per world meter; it does not reserve "
            "space or reduce a successful pack to this value"
        ),
        default=256.0, min=1.0, max=8192.0, update=_project_changed,
    )
    margin: bpy.props.IntProperty(
        name="Padding", description="Bake dilation and island padding in atlas pixels",
        default=48, min=0, max=256, subtype="PIXEL", update=_project_changed,
    )
    fit_policy: bpy.props.EnumProperty(
        name="When Full",
        items=(
            ("BLOCK", "Stop and Explain", "Block export instead of silently reducing detail"),
            ("SCALE", "Scale to Fit", "Explicitly allow all islands to lose density"),
        ),
        default="BLOCK",
        update=_project_changed,
    )
    bake_output: bpy.props.EnumProperty(
        name="Bake Output",
        description=(
            "Choose whether this atlas stores lighting, the final visible "
            "appearance, or the surface material channels"
        ),
        items=(
            (
                "LIGHTING", "Bake Lighting (Recommended)",
                "Preserve PBR materials and bake indirect GI into a lightmap",
            ),
            (
                "APPEARANCE", "Bake Appearance",
                "Flatten the final stylized look into the atlas",
            ),
            (
                "MATERIAL", "Bake Material",
                "Bake the surface channels only, with no lighting, so "
                "deforming objects can share one atlas and lighting stays "
                "live on the website",
            ),
        ),
        # Existing .blend files have collection entries that predate this RNA
        # member. Their historical Combined bake is Appearance; creation
        # operators explicitly choose Lighting for every new atlas.
        default="APPEARANCE",
        update=_project_changed,
    )


class BlendlinkStateSettings(bpy.types.PropertyGroup):
    name: bpy.props.StringProperty(name="Name", default="state", update=_project_changed)
    hide_collections: bpy.props.StringProperty(
        name="Hidden Collections",
        description="Comma-separated collection names hidden while this state bakes",
        update=_project_changed,
    )


def hidden_collection_names(state) -> list[str]:
    """Decode the internal lighting-state collection list.

    New UI writes JSON so Blender collection names containing commas remain
    lossless. Comma-separated values remain readable for existing .blend files.
    """
    raw = str(getattr(state, "hide_collections", "") or "").strip()
    if not raw:
        return []
    values = None
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                values = [value for value in parsed if isinstance(value, str)]
        except json.JSONDecodeError:
            values = None
    if values is None:
        values = [name.strip() for name in raw.split(",") if name.strip()]
    result = []
    seen = set()
    for value in values:
        name = value.strip()
        if name and name not in seen:
            seen.add(name)
            result.append(name)
    return result


def scene_collections(scene) -> list:
    """Collections reachable from one Scene, including its unique root."""
    result = []
    stack = [scene.collection]
    seen = set()
    while stack:
        collection = stack.pop()
        pointer = collection.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        result.append(collection)
        stack.extend(collection.children)
    return result


def scene_collection_by_name(scene, name: str):
    return next(
        (collection for collection in scene_collections(scene) if collection.name == name),
        None,
    )


def set_hidden_collection_names(state, names) -> None:
    """Store a lossless, de-duplicated collection-name list in RNA."""
    values = []
    seen = set()
    for value in names:
        name = str(value).strip()
        if name and name not in seen:
            seen.add(name)
            values.append(name)
    state.hide_collections = json.dumps(values, ensure_ascii=False) if values else ""


class BlendlinkCompositionSettings(bpy.types.PropertyGroup):
    name: bpy.props.StringProperty(name="Name", default="Desktop", update=_project_changed)
    width: bpy.props.IntProperty(
        name="Width", default=1440, min=1, max=16384, subtype="PIXEL", update=_project_changed,
    )
    height: bpy.props.IntProperty(
        name="Height", default=900, min=1, max=16384, subtype="PIXEL", update=_project_changed,
    )
    safe_margin: bpy.props.FloatProperty(
        name="Safe Margin",
        description="Fraction of every edge reserved for page copy and controls",
        default=0.08,
        min=0.0,
        max=0.45,
        subtype="FACTOR",
        update=_project_changed,
    )


def _owner_scene(owner):
    scene = getattr(owner, "id_data", None)
    return scene if isinstance(scene, bpy.types.Scene) else None


def _scene_has_object(owner, obj) -> bool:
    if obj is None:
        return True
    scene = _owner_scene(owner)
    return bool(scene is not None and scene.objects.get(obj.name) is obj)


def _has_stable_identity(obj) -> bool:
    value = obj.get("blendlink_id")
    return isinstance(value, str) and bool(value)


def _can_reference_with_identity(obj) -> bool:
    return bool(getattr(obj, "is_editable", True) or _has_stable_identity(obj))


def _require_scene_object(
    owner, obj, label: str, *, editable: bool = False, stable_identity: bool = False,
) -> None:
    if obj is None:
        return
    if not _scene_has_object(owner, obj):
        raise ValueError(f"{label} {obj.name!r} does not belong to this scene")
    if editable and not getattr(obj, "is_editable", True):
        raise ValueError(f"{label} {obj.name!r} is linked and cannot be edited")
    if stable_identity and not _can_reference_with_identity(obj):
        raise ValueError(
            f"{label} {obj.name!r} is linked but has no persistent web identity. "
            "Open its source .blend with Blendlink enabled and save it once"
        )


def _camera_poll(self, obj):
    return obj is None or (
        obj.type == "CAMERA"
        and _scene_has_object(self, obj)
        and _can_reference_with_identity(obj)
    )


def _probe_empty_poll(self, obj):
    return obj is None or (
        obj.type == "EMPTY"
        and _scene_has_object(self, obj)
        and getattr(obj, "is_editable", True)
    )


def _probe_image_poll(self, image):
    return image is None or image.type not in {"RENDER_RESULT", "COMPOSITING"}


def _scene_object_poll(self, obj):
    return obj is None or (
        _scene_has_object(self, obj) and _can_reference_with_identity(obj)
    )


def _probe_changed(self, context):
    helper = self.probe_object
    if helper is not None and helper.type == "EMPTY":
        try:
            _require_scene_object(self, helper, "Reflection Probe helper", editable=True)
            _require_scene_object(
                self, self.anchor, "Reflection Probe anchor", stable_identity=True,
            )
        except ValueError as error:
            project = getattr(_owner_scene(self), "blendlink_project", None)
            if project is not None:
                project.recipe_error = str(error)
            print(f"blendlink addon: {error}")
            return
        self.object_id = _stable_id(helper)
        helper.empty_display_type = "SPHERE" if self.shape == "SPHERE" else "CUBE"
        helper.empty_display_size = float(self.influence)
        helper.show_in_front = True
        helper["blendlink_probe"] = True
        helper["blendlink_probe_id"] = _slug(self.name)
        helper["blendlink_probe_shape"] = self.shape.lower()
        helper["blendlink_probe_resolution"] = int(self.resolution)
        helper["blendlink_probe_source"] = probe_authoring.mode_of(self).lower()
        helper["blendlink_probe_samples"] = int(self.samples)
        helper["blendlink_probe_influence"] = float(self.influence)
        helper["blendlink_probe_intensity"] = float(self.intensity)
    probe_authoring.mark_dirty(_owner_scene(self))
    _project_changed(self, context)


def _reflection_probe_index_changed(self, context):
    """Refresh the cached active-probe guide without rewriting the recipe.

    The collection index is editor state, not publish intent.  It still
    selects which consequence gizmo is shown, so changing it must invalidate
    the shared validation/overlay cache immediately.
    """
    if context is None:
        return
    from . import validation
    validation.mark_dirty()
    _redraw_view3d(self, context)


def _component_reference_changed(self, context):
    """Commit an artist's pointer edit without erasing unresolved imports.

    Hydration runs with ``_loading_recipe`` and must retain a raw stable ID when
    its object is not present in this Scene. An explicit UI clear happens
    outside hydration, so remove the known ID/name pair at that moment.
    """
    if _loading_recipe:
        return
    key_pair = {
        "blendlink.look-at": ("targetId", "targetName"),
        "blendlink.play-audio-on-click": ("sourceId", "sourceName"),
        "blendlink.depth-of-field": ("focusTargetId", "focusTargetName"),
    }.get(str(getattr(self, "component_type", "") or ""))
    if key_pair is not None:
        try:
            values = _component_raw_values(self)
            reference = getattr(self, "reference_object", None)
            if reference is None:
                values.pop(key_pair[0], None)
                values.pop(key_pair[1], None)
            else:
                values[key_pair[0]] = _stable_id(reference)
                values[key_pair[1]] = reference.name
            self.raw_values = json.dumps(
                values, ensure_ascii=False, allow_nan=False, sort_keys=True,
                separators=(",", ":"),
            )
        except (AttributeError, RuntimeError, TypeError, ValueError) as error:
            scene = _owner_scene(self)
            project = getattr(scene, "blendlink_project", None)
            if project is not None:
                project.recipe_error = str(error)
            print(f"blendlink addon: component reference could not be stored: {error}")
            return
    _project_changed(self, context)


class BlendlinkReflectionProbeSettings(bpy.types.PropertyGroup):
    name: bpy.props.StringProperty(
        name="Name", default="Reflection Probe", update=_probe_changed,
    )
    object_id: bpy.props.StringProperty(options={"HIDDEN"})
    probe_object: bpy.props.PointerProperty(
        name="Probe Helper",
        description="Exported Empty that positions the capture and previews its influence",
        type=bpy.types.Object,
        poll=_probe_empty_poll,
        update=_probe_changed,
    )
    shape: bpy.props.EnumProperty(
        name="Influence Shape",
        items=(
            ("BOX", "Box", "Preview a box influence; custom adapters may use it for parallax correction"),
            ("SPHERE", "Sphere", "Preview a radial influence around the probe"),
        ),
        default="BOX",
        update=_probe_changed,
    )
    capture_mode: bpy.props.EnumProperty(
        name="Reflection Source",
        description="Choose when and where this probe's equirectangular reflection texture is created",
        items=(
            (
                "RUNTIME", "Runtime Capture", "Capture once in Three.js when the website loads; no asset is stored",
                "RESTRICT_RENDER_OFF", 0,
            ),
            (
                "BAKED", "Blender Bake",
                "Render a lossless scene-linear EXR with Cycles and publish it with the website; "
                "this narrow offline-probe path is independent of the scene's presentation engine",
                "RENDER_RESULT", 1,
            ),
            (
                "CUSTOM", "Custom Texture", "Publish an authored 2:1 HDR, EXR, PNG, JPEG, or WebP image",
                "IMAGE_DATA", 2,
            ),
        ),
        default="RUNTIME",
        update=_probe_changed,
    )
    resolution: bpy.props.EnumProperty(
        name="Capture Detail",
        description="Resolution of each of the six cubemap faces",
        items=(
            ("64", "64 px / Fast", "24,576 captured pixels"),
            ("128", "128 px", "98,304 captured pixels"),
            ("256", "256 px / Recommended", "393,216 captured pixels; matches Three PMREM's ideal input"),
            ("512", "512 px / Detailed", "1,572,864 captured pixels"),
            ("1024", "1024 px / Expensive", "6,291,456 captured pixels"),
            ("2048", "2048 px / Very Expensive", "25,165,824 captured pixels"),
        ),
        default="256",
        update=_probe_changed,
    )
    samples: bpy.props.IntProperty(
        name="Bake Samples",
        description=(
            "Cycles samples used only by Blender Bake reflection capture; "
            "runtime capture does not use this value"
        ),
        default=128,
        min=1,
        max=16384,
        soft_max=2048,
        update=_probe_changed,
    )
    influence: bpy.props.FloatProperty(
        name="Influence Distance",
        description="Sphere radius or box half-extent; also becomes the suggested capture far plane",
        default=5.0,
        min=0.01,
        max=1000000.0,
        soft_max=100.0,
        subtype="DISTANCE",
        update=_probe_changed,
    )
    intensity: bpy.props.FloatProperty(
        name="Reflection Strength",
        description="Environment-map intensity on explicitly assigned standard materials",
        default=1.0,
        min=0.0,
        max=100.0,
        soft_max=4.0,
        update=_probe_changed,
    )
    anchor: bpy.props.PointerProperty(
        name="Capture Anchor",
        description="Optional object used as capture/parallax origin instead of the helper Empty",
        type=bpy.types.Object,
        poll=_scene_object_poll,
        update=_probe_changed,
    )
    custom_image: bpy.props.PointerProperty(
        name="Reflection Texture",
        description="A 2:1 equirectangular image; HDR/EXR preserves lighting range while LDR is useful for stylized reflections",
        type=bpy.types.Image,
        poll=_probe_image_poll,
        update=_probe_changed,
    )
    baked_image: bpy.props.PointerProperty(
        name="Baked Reflection",
        type=bpy.types.Image,
        poll=_probe_image_poll,
        update=_probe_changed,
        options={"HIDDEN"},
    )
    baked_source_hash: bpy.props.StringProperty(options={"HIDDEN"})
    baked_content_hash: bpy.props.StringProperty(options={"HIDDEN"})
    baked_at_utc: bpy.props.StringProperty(options={"HIDDEN"})
    derived_asset_path: bpy.props.StringProperty(options={"HIDDEN"})
    baked_width: bpy.props.IntProperty(default=0, options={"HIDDEN"})
    baked_height: bpy.props.IntProperty(default=0, options={"HIDDEN"})


class BlendlinkComponentSettings(bpy.types.PropertyGroup):
    """One versioned portable website behavior.

    Components live in the scene recipe even when they target an object. This
    keeps the authored contract in one diffable place while stable object IDs
    preserve the target through Blender renames.
    """

    component_id: bpy.props.StringProperty(options={"HIDDEN"})
    component_type: bpy.props.StringProperty(options={"HIDDEN"})
    schema_version: bpy.props.IntProperty(
        default=component_schema.COMPONENT_SCHEMA_VERSION, options={"HIDDEN"},
    )
    enabled: bpy.props.BoolProperty(name="Enabled", default=True, update=_project_changed)
    target_kind: bpy.props.EnumProperty(
        name="Target",
        items=(
            ("SCENE", "Scene", "Apply once to the complete website scene"),
            ("OBJECT", "Object", "Apply to one rename-safe Blender object"),
        ),
        default="OBJECT",
        options={"HIDDEN"},
        update=_project_changed,
    )
    target_object: bpy.props.PointerProperty(
        name="Object",
        description="Rename-safe object that owns this website behavior",
        type=bpy.types.Object,
        poll=_scene_object_poll,
        update=_project_changed,
    )
    target_id: bpy.props.StringProperty(options={"HIDDEN"})
    target_name: bpy.props.StringProperty(options={"HIDDEN"})
    expanded: bpy.props.BoolProperty(default=False, options={"SKIP_SAVE"})
    # Unknown third-party component values remain round-trippable even when
    # this Blendlink install has no Blender editor or website adapter for them.
    raw_values: bpy.props.StringProperty(default="{}", options={"HIDDEN"})

    bloom_mode: bpy.props.EnumProperty(
        name="What Blooms",
        description="Bloom every bright pixel or only objects with emissive materials",
        items=(
            (
                "bright-pixels", "Bright Pixels",
                "Bloom every pixel brighter than Threshold; best for general highlights",
            ),
            (
                "emissive-objects", "Emissive Objects",
                "Bloom exported objects whose materials emit light; avoids unstable collection references",
            ),
        ),
        default="bright-pixels", update=_project_changed,
    )
    intensity: bpy.props.FloatProperty(
        name="Intensity", default=0.5, min=0.0, soft_max=4.0, update=_project_changed,
    )
    threshold: bpy.props.FloatProperty(
        name="Threshold",
        description="Linear brightness required to Bloom; values below 1 also work on the LDR fallback",
        default=0.8, min=0.0, soft_max=10.0,
        update=_project_changed,
    )
    radius: bpy.props.FloatProperty(
        name="Scatter", default=0.4, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    softness: bpy.props.FloatProperty(
        name="Softness", default=0.55, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    color: bpy.props.FloatVectorProperty(
        name="Color", subtype="COLOR", size=3, default=(0.0, 0.0, 0.0),
        min=0.0, max=1.0, update=_project_changed,
    )
    chromatic_amount: bpy.props.FloatProperty(
        name="Amount",
        description="Maximum RGB separation in normalized image units; 0.001 is about one pixel across a 1000-pixel image",
        default=0.0015, min=0.0, max=0.05, soft_max=0.01,
        precision=4, step=1, update=_project_changed,
    )
    chromatic_mode: bpy.props.EnumProperty(
        name="Pattern",
        description="Split colors in one direction or outward from a lens center",
        items=(
            ("directional", "Directional", "Use a single artist-chosen split direction"),
            ("radial", "Radial", "Increase separation outward from a lens center"),
        ),
        default="radial", update=_project_changed,
    )
    chromatic_angle: bpy.props.FloatProperty(
        name="Direction",
        description="Direction of the color split",
        subtype="ANGLE", default=0.0, min=-math.pi, max=math.pi,
        update=_project_changed,
    )
    chromatic_center_x: bpy.props.FloatProperty(
        name="Center X", description="Horizontal lens center from left to right",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    chromatic_center_y: bpy.props.FloatProperty(
        name="Center Y", description="Vertical lens center from bottom to top",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    pixel_size: bpy.props.IntProperty(
        name="Pixel Size",
        description="Block size in CSS pixels; remains visually stable when browser DPR changes",
        default=6, min=1, max=256, soft_max=64,
        update=_project_changed,
    )
    pixel_depth_edge_strength: bpy.props.FloatProperty(
        name="Depth Edges",
        description="Emphasize boundaries at different camera depths; zero disables this treatment",
        default=0.0, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    pixel_normal_edge_strength: bpy.props.FloatProperty(
        name="Normal Edges",
        description="Emphasize changes in surface direction; zero disables this treatment",
        default=0.0, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    sharpen_amount: bpy.props.FloatProperty(
        name="Amount",
        description="Bounded contrast-adaptive sharpening; modest values avoid halos and amplified texture noise",
        default=0.35, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    tilt_shift_focus_position: bpy.props.FloatProperty(
        name="Focus Position", description="Center of the sharp band across the frame",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    tilt_shift_angle: bpy.props.FloatProperty(
        name="Angle", description="Rotation of the sharp band",
        subtype="ANGLE", default=0.0, min=-math.pi, max=math.pi,
        update=_project_changed,
    )
    tilt_shift_feather: bpy.props.FloatProperty(
        name="Feather", description="Smooth transition width from sharp to blurred image",
        default=0.25, min=0.001, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    tilt_shift_strength: bpy.props.FloatProperty(
        name="Strength", description="Maximum blur away from the focus band",
        default=0.7, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    tilt_shift_quality: bpy.props.EnumProperty(
        name="Quality",
        description="Internal resolution and blur kernel only; never changes authored strength",
        items=(
            ("low", "Low", "Lowest internal cost for constrained mobile devices"),
            ("balanced", "Balanced", "Recommended quality and performance balance"),
            ("high", "High", "Highest internal blur quality for capable devices"),
        ),
        default="balanced", update=_project_changed,
    )
    ao_radius_mode: bpy.props.EnumProperty(
        name="Radius Units",
        description="World units preserve physical scale; Screen pixels suit cameras that cross very different scales",
        items=(
            ("world", "World Units", "Measure occlusion reach in Blender world units"),
            ("screen", "Screen Pixels", "Keep occlusion reach stable in rendered pixels"),
        ),
        default="world", update=_project_changed,
    )
    ao_world_radius: bpy.props.FloatProperty(
        name="World Radius",
        description="How far ambient occlusion reaches in Blender world units",
        default=1.0, min=0.000001, max=100000.0, soft_max=10.0,
        subtype="DISTANCE", update=_project_changed,
    )
    ao_screen_radius: bpy.props.FloatProperty(
        name="Screen Radius",
        description="How far ambient occlusion reaches in rendered pixels",
        default=32.0, min=1.0, max=256.0, soft_max=64.0,
        update=_project_changed,
    )
    ao_intensity: bpy.props.FloatProperty(
        name="Strength",
        description="Artistic darkness of ambient occlusion",
        default=2.0, min=0.0, max=20.0, soft_max=5.0,
        update=_project_changed,
    )
    ao_color: bpy.props.FloatVectorProperty(
        name="Tint", description="Ambient occlusion tint in linear RGB",
        subtype="COLOR", size=3, default=(0.0, 0.0, 0.0),
        min=0.0, max=1.0, update=_project_changed,
    )
    shadow_catcher_mode: bpy.props.EnumProperty(
        name="Mode",
        description="Choose received-shadow mask, additive direct light, or invisible depth",
        items=(
            ("mask", "Shadow Mask", "Show realtime shadows received from authored lights"),
            ("additive", "Additive Light", "Blend direct point/spot lighting over the page"),
            ("occluder", "Invisible Occluder", "Write depth without drawing color"),
        ),
        default="mask", update=_project_changed,
    )
    shadow_catcher_color: bpy.props.FloatVectorProperty(
        name="Shadow Tint", description="Linear RGB tint used by Shadow Mask mode",
        subtype="COLOR", size=3, default=(0.0, 0.0, 0.0),
        min=0.0, max=1.0, update=_project_changed,
    )
    shadow_catcher_opacity: bpy.props.FloatProperty(
        name="Shadow Opacity", description="Mask strength used by Shadow Mask mode",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    shadow_catcher_light_strength: bpy.props.FloatProperty(
        name="Additive Light Strength",
        description="Direct-light multiplier used only in Additive Light mode",
        default=6.6, min=0.0, max=20.0, soft_max=10.0,
        update=_project_changed,
    )
    shadow_catcher_include_descendants: bpy.props.BoolProperty(
        name="Include Child Meshes",
        description="Apply this catcher to renderable children as one authored receiver",
        default=True, update=_project_changed,
    )
    contact_shadows_auto_fit: bpy.props.BoolProperty(
        name="Fit to Scene",
        description="Automatically size and place the receiver from visible scene geometry",
        default=True, update=_project_changed,
    )
    contact_shadows_darkness: bpy.props.FloatProperty(
        name="Darkness",
        description="Depth-mask strength before the blurred shadow is composited",
        default=0.5, min=0.0, max=20.0, soft_max=2.0,
        update=_project_changed,
    )
    contact_shadows_opacity: bpy.props.FloatProperty(
        name="Opacity",
        description="Final opacity of the contact-shadow receiver",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    contact_shadows_blur: bpy.props.FloatProperty(
        name="Blur",
        description="Softness using the matched two-scale Gaussian blur",
        default=4.0, min=0.0, max=100.0, soft_max=16.0,
        update=_project_changed,
    )
    contact_shadows_occlude_below_ground: bpy.props.BoolProperty(
        name="Hide Below Ground",
        description="Write invisible ground depth so geometry below the receiver does not show through",
        default=False, update=_project_changed,
    )
    contact_shadows_backface_shadows: bpy.props.BoolProperty(
        name="Backface Shadows",
        description="Let backfaces contribute at reduced strength",
        default=True, update=_project_changed,
    )
    contact_shadows_update_policy: bpy.props.EnumProperty(
        name="Update",
        description="Static settles after one refresh; Continuous follows animated or moving geometry",
        items=(
            ("static", "Static", "Render once, then let a demand Canvas settle"),
            ("continuous", "Continuous", "Refresh all five auxiliary passes every frame"),
        ),
        default="static", update=_project_changed,
    )
    outline_visible_color: bpy.props.FloatVectorProperty(
        name="Visible Color", description="Color for visible silhouettes",
        subtype="COLOR", size=3, default=(0.0, 0.0, 0.0),
        min=0.0, max=1.0, update=_project_changed,
    )
    outline_hidden_color: bpy.props.FloatVectorProperty(
        name="Hidden Color", description="Color for occluded silhouettes when X-Ray is enabled",
        subtype="COLOR", size=3, default=(0.08, 0.08, 0.08),
        min=0.0, max=1.0, update=_project_changed,
    )
    outline_strength: bpy.props.FloatProperty(
        name="Strength", description="Contrast of the outline",
        default=3.0, min=0.0, max=100.0, soft_max=10.0,
        update=_project_changed,
    )
    outline_thickness: bpy.props.FloatProperty(
        name="Thickness", description="Approximate outline width in rendered pixels",
        default=1.0, min=0.0, max=16.0, soft_max=4.0,
        update=_project_changed,
    )
    outline_xray: bpy.props.BoolProperty(
        name="X-Ray", description="Also draw silhouettes hidden behind other geometry",
        default=False, update=_project_changed,
    )
    color_grading_lut_url: bpy.props.StringProperty(
        name="LUT URL",
        description="Site-relative or HTTPS URL of a published .cube or supported 3D LUT asset",
        default="", subtype="NONE", update=_project_changed,
    )
    color_grading_intensity: bpy.props.FloatProperty(
        name="Intensity", description="Blend between the ungraded image and the LUT",
        default=1.0, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    color_grading_tetrahedral: bpy.props.BoolProperty(
        name="Tetrahedral Interpolation",
        description="Use more accurate 3D LUT interpolation at a modest GPU cost",
        default=True, update=_project_changed,
    )
    dof_focus_mode: bpy.props.EnumProperty(
        name="Focus With",
        description="Use a fixed camera distance or follow a rename-stable scene object",
        items=(
            ("distance", "Distance", "Focus at a fixed distance from the website camera"),
            ("object", "Object", "Follow a scene object's position as the focus target"),
        ),
        default="distance", update=_project_changed,
    )
    dof_focus_distance: bpy.props.FloatProperty(
        name="Focus Distance", description="Sharp distance from the website camera",
        default=3.0, min=0.000001, max=1000000.0, soft_max=100.0,
        subtype="DISTANCE", update=_project_changed,
    )
    dof_focus_range: bpy.props.FloatProperty(
        name="Focus Range", description="Depth around the focus plane that remains sharp",
        default=2.0, min=0.000001, max=1000000.0, soft_max=100.0,
        subtype="DISTANCE", update=_project_changed,
    )
    dof_blur_strength: bpy.props.FloatProperty(
        name="Blur Strength", description="Maximum foreground and background blur",
        default=1.0, min=0.0, max=20.0, soft_max=5.0,
        update=_project_changed,
    )
    kuwahara_strength: bpy.props.FloatProperty(
        name="Strength", description="Blend between the original image and painterly result",
        default=0.75, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    kuwahara_brush_scale: bpy.props.FloatProperty(
        name="Brush Scale", description="Size of coherent painted regions in rendered pixels",
        default=4.0, min=1.0, max=32.0, soft_max=12.0,
        update=_project_changed,
    )
    kuwahara_directionality: bpy.props.FloatProperty(
        name="Directionality", description="How strongly image structure guides brush direction",
        default=0.75, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    kuwahara_detail: bpy.props.FloatProperty(
        name="Detail", description="Retain small features while simplifying low-contrast regions",
        default=0.5, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    fade_distance: bpy.props.FloatProperty(
        name="Subject Clearance",
        description="Keep objects inside this distance of the focal object fully visible",
        default=0.5, min=0.0, soft_max=10.0,
        subtype="DISTANCE", update=_project_changed,
    )
    minimum_opacity: bpy.props.FloatProperty(
        name="Minimum Opacity", default=0.15, min=0.0, max=1.0,
        subtype="FACTOR", update=_project_changed,
    )
    url: bpy.props.StringProperty(
        name="Web Address", default="https://", subtype="NONE", update=_project_changed,
    )
    accessibility_label: bpy.props.StringProperty(
        name="Accessible Label",
        description="Human-facing name used by application-owned links and buttons",
        update=_project_changed,
    )
    new_tab: bpy.props.BoolProperty(name="Open in New Tab", default=True, update=_project_changed)
    hover_scale: bpy.props.FloatProperty(
        name="Hover Scale", default=1.08, min=0.01, soft_min=0.5, soft_max=2.0,
        update=_project_changed,
    )
    website_surface_name: bpy.props.StringProperty(
        name="Website Name",
        description="Stable lowercase name used by application code, for example monitor-screen",
        default="surface", maxlen=64, update=_project_changed,
    )
    website_surface_color_treatment: bpy.props.EnumProperty(
        name="Color Treatment",
        description="Display shows pixels unlit; Surface keeps the authored material response",
        items=(
            ("display", "Display", "Show application pixels without scene lighting or tone mapping"),
            ("surface", "Surface", "Keep the authored material's lighting response"),
        ),
        default="display", update=_project_changed,
    )
    duration: bpy.props.FloatProperty(
        name="Transition", default=0.12, min=0.0, soft_max=2.0,
        subtype="TIME", update=_project_changed,
    )
    reference_object: bpy.props.PointerProperty(
        name="Target",
        description="Rename-safe object referenced by this behavior",
        type=bpy.types.Object,
        poll=_scene_object_poll,
        update=_component_reference_changed,
    )
    keep_up: bpy.props.BoolProperty(name="Keep Upright", default=True, update=_project_changed)
    animation_clip: bpy.props.StringProperty(
        name="Animation", description="Exact exported Blender action / glTF clip name",
        update=_project_changed,
    )
    animation_loop: bpy.props.BoolProperty(name="Loop", default=False, update=_project_changed)
    audio_url: bpy.props.StringProperty(
        name="Audio URL", description="Site-relative or HTTPS audio asset URL",
        update=_project_changed,
    )
    autoplay: bpy.props.BoolProperty(
        name="Play on Load", default=False,
        description="Browsers may wait for the visitor's first gesture",
        update=_project_changed,
    )
    audio_loop: bpy.props.BoolProperty(name="Loop", default=False, update=_project_changed)
    volume: bpy.props.FloatProperty(
        name="Volume", default=1.0, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    spatial: bpy.props.BoolProperty(name="Spatial Audio", default=False, update=_project_changed)
    min_distance: bpy.props.FloatProperty(
        name="Full Volume Within", default=2.0, min=0.0, soft_max=50.0,
        subtype="DISTANCE", update=_project_changed,
    )
    max_distance: bpy.props.FloatProperty(
        name="Silent Beyond", default=50.0, min=0.001, soft_max=500.0,
        subtype="DISTANCE", update=_project_changed,
    )
    toggle: bpy.props.BoolProperty(
        name="Click Again to Stop", default=False, update=_project_changed,
    )


def _world_environment_image(scene):
    world = scene.world
    tree = bakelib.active_shader_node_tree(world)
    if tree is None:
        return None
    return next(
        (node.image for node in tree.nodes
         if node.type == "TEX_ENVIRONMENT" and node.image is not None),
        None,
    )


def _look_background_changed(self, context):
    if self.background_mode != "APPLICATION" and self.environment_background in {"IMAGE", "GROUNDED"}:
        self.environment_background = "NONE"
    _project_changed(self, context)


def _environment_background_changed(self, context):
    if self.environment_background in {"IMAGE", "GROUNDED"} and self.background_mode != "APPLICATION":
        self.background_mode = "APPLICATION"
    _project_changed(self, context)


class BlendlinkProjectSettings(bpy.types.PropertyGroup):
    configured: bpy.props.BoolProperty(default=False, options={"HIDDEN"})
    recipe_error: bpy.props.StringProperty(default="", options={"HIDDEN", "SKIP_SAVE"})
    presentation: bpy.props.EnumProperty(
        name="Web Presentation",
        items=(
            ("HYBRID", "Hybrid", "Bake the environment; keep moving, transparent, or designated objects realtime"),
            ("REALTIME", "Realtime", "Export Blender materials and light the whole scene in Three.js"),
            ("BAKED", "Fully Baked", "Capture every eligible visible mesh into baked atlases"),
        ),
        default="HYBRID",
        update=_project_changed,
    )
    final_samples: bpy.props.IntProperty(
        name="Final Samples", default=128, min=1, max=16384, update=_project_changed,
    )
    final_supersample: bpy.props.IntProperty(
        name="Final Supersample", default=2, min=1, max=4, update=_project_changed,
    )
    final_denoise: bpy.props.BoolProperty(name="Denoise Final", default=True, update=_project_changed)
    preview_samples: bpy.props.IntProperty(
        name="Preview Samples", default=16, min=1, max=4096, update=_project_changed,
    )
    preview_scale: bpy.props.FloatProperty(
        name="Preview Resolution", default=0.25, min=0.0625, max=1.0,
        subtype="FACTOR", update=_project_changed,
    )
    atlases: bpy.props.CollectionProperty(type=BlendlinkAtlasSettings)
    atlas_index: bpy.props.IntProperty(default=0)
    states: bpy.props.CollectionProperty(type=BlendlinkStateSettings)
    state_index: bpy.props.IntProperty(default=0)
    reflection_probes: bpy.props.CollectionProperty(type=BlendlinkReflectionProbeSettings)
    reflection_probe_index: bpy.props.IntProperty(
        default=0, update=_reflection_probe_index_changed,
    )
    components: bpy.props.CollectionProperty(type=BlendlinkComponentSettings)
    component_index: bpy.props.IntProperty(default=0)
    main_camera: bpy.props.PointerProperty(
        name="Website Camera",
        description="Camera the website should use as its authored starting view",
        type=bpy.types.Object,
        poll=_camera_poll,
        update=_project_changed,
    )
    camera_behavior: bpy.props.EnumProperty(
        name="Web Camera",
        items=(
            ("FIXED", "Fixed", "Preserve the authored Blender view; the page does not move it"),
            ("ORBIT", "Orbit", "Orbit around the chosen target from this authored starting view"),
            ("FREE", "Free", "Use this as the starting view, then let the visitor move freely"),
        ),
        default="FIXED",
        update=_project_changed,
    )
    camera_target: bpy.props.PointerProperty(
        name="Orbit Target",
        description="Rename-stable scene object the website camera orbits",
        type=bpy.types.Object,
        poll=_scene_object_poll,
        update=_project_changed,
    )
    camera_framing: bpy.props.EnumProperty(
        name="Initial Framing",
        items=(
            ("AUTHORED", "Preserve Authored View", "Keep the exact camera transform from Blender"),
            ("FIT_SCENE", "Fit Visible Scene", "Move once along the authored viewing angle to protect the whole scene and page-safe margins"),
            ("FIT_TARGET", "Fit Target", "Move once along the authored viewing angle to protect the target and page-safe margins"),
        ),
        default="AUTHORED",
        update=_project_changed,
    )
    compositions: bpy.props.CollectionProperty(type=BlendlinkCompositionSettings)
    composition_index: bpy.props.IntProperty(default=0)
    animation_start: bpy.props.EnumProperty(
        name="When the Page Loads",
        items=(
            ("MANUAL", "Start Still", "The website starts animations explicitly"),
            ("FIRST", "Play First Clip", "Play the first exported animation clip"),
            ("NAMED", "Play Named Clip", "Play one named Blender action / exported clip"),
            ("ALL", "Play All Clips", "Play all exported clips together"),
        ),
        default="MANUAL",
        update=_project_changed,
    )
    animation_clip: bpy.props.StringProperty(
        name="Clip",
        description="Exact Blender action / exported glTF clip name",
        update=_project_changed,
    )
    animation_loop: bpy.props.EnumProperty(
        name="After Playing",
        items=(
            ("REPEAT", "Loop", "Jump back to the beginning and continue"),
            ("ONCE", "Hold Last Frame", "Play once and hold the final pose"),
            ("PINGPONG", "Ping-Pong", "Alternate forward and backward"),
        ),
        default="REPEAT",
        update=_project_changed,
    )
    animation_speed: bpy.props.FloatProperty(
        name="Speed",
        description="Website playback speed multiplier",
        default=1.0,
        min=0.05,
        max=4.0,
        soft_min=0.25,
        soft_max=2.0,
        update=_project_changed,
    )
    animation_sequence_enabled: bpy.props.BoolProperty(
        name="Use NLA Sequence",
        description=(
            "Play one chosen Blender NLA track as an ordered website timeline "
            "composed from its exported Actions"
        ),
        default=False,
        update=_project_changed,
    )
    animation_sequence_name: bpy.props.StringProperty(
        name="Sequence Name", default="Website Sequence", update=_project_changed,
    )
    animation_sequence_source: bpy.props.PointerProperty(
        name="Source",
        description="Object or Armature whose selected NLA track owns the website timeline",
        type=bpy.types.Object,
        poll=_scene_object_poll,
        update=_animation_sequence_source_changed,
    )
    animation_sequence_track: bpy.props.StringProperty(
        name="NLA Track",
        description="Exact NLA track to publish; edit its strips in Blender's NLA Editor",
        update=_project_changed,
    )
    animation_sequence_loop: bpy.props.BoolProperty(
        name="Loop Sequence", default=False, update=_project_changed,
    )
    animation_sequence_speed: bpy.props.FloatProperty(
        name="Sequence Speed",
        description="Whole-timeline website playback multiplier",
        default=1.0,
        min=0.05,
        max=4.0,
        soft_min=0.25,
        soft_max=2.0,
        update=_project_changed,
    )
    animation_sequence_easing: bpy.props.EnumProperty(
        name="Blend Shape",
        description="Portable easing used by every NLA strip Blend In/Out envelope",
        items=(
            ("EASE_IN_OUT", "Smooth", "Smooth acceleration and deceleration"),
            ("LINEAR", "Linear", "Constant-rate blend matching Blender's default influence ramp"),
            ("EASE_IN", "Ease In", "Accelerate into each strip"),
            ("EASE_OUT", "Ease Out", "Decelerate out of each strip"),
        ),
        default="EASE_IN_OUT",
        update=_project_changed,
    )
    tone_mapping: bpy.props.EnumProperty(
        name="Tone Mapping",
        items=(
            ("APPLICATION", "Website Default", "Leave renderer tone mapping unchanged"),
            ("AGX", "AgX", "Film-like highlight rolloff close to Blender's default view"),
            ("NEUTRAL", "PBR Neutral", "Preserve product and base-color accuracy"),
            ("ACES", "ACES Filmic", "Cinematic highlight rolloff widely used in Three.js"),
            ("NONE", "None", "No tone mapping; useful for graphic/stylized scenes"),
        ),
        default="APPLICATION",
        update=_project_changed,
    )
    look_exposure: bpy.props.FloatProperty(
        name="Exposure",
        description="Website exposure in photographic stops",
        default=0.0,
        min=-10.0,
        max=10.0,
        soft_min=-3.0,
        soft_max=3.0,
        update=_project_changed,
    )
    background_mode: bpy.props.EnumProperty(
        name="Background",
        items=(
            ("APPLICATION", "Page Controls It", "Do not override the website scene background"),
            ("TRANSPARENT", "Transparent", "Let the HTML/CSS page show behind the canvas"),
            ("COLOR", "Solid Color", "Publish one scene-owned linear-sRGB background color"),
        ),
        default="APPLICATION",
        update=_look_background_changed,
    )
    background_color: bpy.props.FloatVectorProperty(
        name="Color",
        description="Website scene background in linear sRGB",
        subtype="COLOR",
        size=3,
        min=0.0,
        max=1.0,
        default=(0.05, 0.05, 0.05),
        update=_project_changed,
    )
    fog_mode: bpy.props.EnumProperty(
        name="Distance Fog",
        items=(
            ("APPLICATION", "Website Default", "Leave the website scene fog untouched"),
            ("NONE", "Explicitly Off", "Clear fog when this scene is installed"),
            ("LINEAR", "Near / Far Fade", "Keep the foreground clear, then fade to a color over world distance"),
            ("EXPONENTIAL", "Atmospheric", "Increase haze smoothly with world distance"),
        ),
        default="APPLICATION",
        update=_project_changed,
    )
    fog_color: bpy.props.FloatVectorProperty(
        name="Fog Color", description="Website fog color in linear sRGB",
        subtype="COLOR", size=3, min=0.0, max=1.0,
        default=(0.05, 0.05, 0.05), update=_project_changed,
    )
    fog_near: bpy.props.FloatProperty(
        name="Starts At", description="Distance that remains completely clear",
        default=10.0, min=0.0, max=1000000.0, subtype="DISTANCE", update=_project_changed,
    )
    fog_far: bpy.props.FloatProperty(
        name="Fully Fogged At", description="Distance where the fog color completely replaces the surface",
        default=100.0, min=0.001, max=1000000.0, subtype="DISTANCE", update=_project_changed,
    )
    fog_density: bpy.props.FloatProperty(
        name="Density", description="Exponential fog density per Blender world unit",
        default=0.02, min=0.000001, max=100.0, soft_min=0.0001, soft_max=0.2,
        precision=6, update=_project_changed,
    )
    shadow_preset: bpy.props.EnumProperty(
        name="Realtime Shadows",
        items=(
            ("APPLICATION", "Website Default", "Leave the renderer's shadow policy unchanged"),
            ("OFF", "Off", "Disable realtime shadow maps for this scene"),
            ("PERFORMANCE", "Fast", "512px hard shadows with a short reach"),
            ("BALANCED", "Balanced", "1024px filtered shadows for most portfolio scenes"),
            ("SOFT", "Soft Studio", "2048px variance shadows with a broad soft edge"),
            ("CRISP", "Crisp Detail", "2048px filtered shadows with a tight edge"),
            ("CUSTOM", "Custom", "Choose filter, resolution, reach, and bias explicitly"),
        ),
        default="APPLICATION",
        update=_project_changed,
    )
    shadow_filter: bpy.props.EnumProperty(
        name="Filter",
        items=(
            ("BASIC", "Hard / Fast", "Basic unfiltered shadow maps"),
            ("PCF", "Filtered", "Percentage-closer filtering; robust general-purpose choice"),
            ("VSM", "Soft", "Variance shadows; softer but may leak around thin geometry"),
        ),
        default="PCF",
        update=_project_changed,
    )
    shadow_map_size: bpy.props.IntProperty(
        name="Map Resolution", default=1024, min=128, max=8192, subtype="PIXEL",
        update=_project_changed,
    )
    shadow_max_distance: bpy.props.FloatProperty(
        name="Reach", description="Farthest distance covered by each realtime shadow camera",
        default=50.0, min=0.1, max=100000.0, subtype="DISTANCE", update=_project_changed,
    )
    shadow_bias: bpy.props.FloatProperty(
        name="Bias", description="Small depth offset; use only to remove acne",
        default=-0.0005, min=-0.1, max=0.1, precision=6, update=_project_changed,
    )
    shadow_normal_bias: bpy.props.FloatProperty(
        name="Normal Bias", description="Moves receivers along their normals to reduce acne",
        default=0.02, min=0.0, max=10.0, precision=4, update=_project_changed,
    )
    shadow_radius: bpy.props.FloatProperty(
        name="Softness", description="Shadow filter radius",
        default=1.0, min=0.0, max=32.0, update=_project_changed,
    )
    shadow_auto_update: bpy.props.BoolProperty(
        name="Update Every Frame",
        description="Disable for static realtime lights, then request updates from website code when needed",
        default=True, update=_project_changed,
    )
    environment_source: bpy.props.EnumProperty(
        name="HDR Environment",
        items=(
            ("APPLICATION", "Website Provides It", "Do not publish or assign an environment asset"),
            ("IMAGE", "Publish Blender Image", "Copy one HDR/EXR source from the blend into website assets"),
        ),
        default="APPLICATION",
        update=_project_changed,
    )
    environment_image: bpy.props.PointerProperty(
        name="Image", description="Radiance HDR or OpenEXR environment to publish without color conversion",
        type=bpy.types.Image, update=_project_changed,
    )
    environment_lighting: bpy.props.EnumProperty(
        name="Lights Objects",
        items=(
            ("APPLICATION", "Website Decides", "Leave scene.environment unchanged"),
            ("IMAGE", "Use Published HDR", "Use the HDR for image-based lighting"),
            ("NONE", "No Environment Light", "Explicitly clear scene.environment"),
        ),
        default="APPLICATION", update=_project_changed,
    )
    environment_background: bpy.props.EnumProperty(
        name="Visible Background",
        items=(
            ("APPLICATION", "Website Decides", "Leave scene.background unchanged"),
            ("IMAGE", "Show Published HDR", "Show the equirectangular HDR behind the scene"),
            ("GROUNDED", "Grounded Backdrop", "Project the lower HDR hemisphere onto a ground plane"),
            ("NONE", "Hide Environment", "Clear any environment background while retaining optional lighting"),
        ),
        default="APPLICATION", update=_environment_background_changed,
    )
    environment_lighting_intensity: bpy.props.FloatProperty(
        name="Lighting Strength", default=1.0, min=0.0, max=100.0, soft_max=4.0,
        update=_project_changed,
    )
    environment_lighting_rotation: bpy.props.FloatProperty(
        name="Lighting Rotation",
        description=(
            "Rotate the environment's illumination around Z without rotating "
            "the visible background"
        ),
        # An ANGLE float stores RADIANS. Writing 360 here let the widget reach
        # about 20,600 degrees, and the recipe writer converts to degrees on
        # the way out - so a drag past one turn wrote a recipe this same module
        # then refused to load, and the scene reopened as never configured.
        default=0.0, min=-2.0 * math.pi, max=2.0 * math.pi,
        subtype="ANGLE", unit="ROTATION", update=_project_changed,
    )
    environment_background_intensity: bpy.props.FloatProperty(
        name="Background Strength", default=1.0, min=0.0, max=100.0, soft_max=4.0,
        update=_project_changed,
    )
    environment_background_rotation: bpy.props.FloatProperty(
        name="Background Rotation",
        description=(
            "Rotate the visible background around Z without rotating the "
            "illumination it casts"
        ),
        # Radians, for the same reason as Lighting Rotation above.
        default=0.0, min=-2.0 * math.pi, max=2.0 * math.pi,
        subtype="ANGLE", unit="ROTATION", update=_project_changed,
    )
    environment_background_blur: bpy.props.FloatProperty(
        name="Background Blur", default=0.0, min=0.0, max=1.0, subtype="FACTOR",
        update=_project_changed,
    )
    environment_ground_height: bpy.props.FloatProperty(
        name="Capture Height", description="Height of the camera that captured the HDR",
        default=2.0, min=0.01, max=100000.0, subtype="DISTANCE", update=_project_changed,
    )
    environment_ground_radius: bpy.props.FloatProperty(
        name="Backdrop Radius", description="Must contain the website camera throughout its motion",
        default=100.0, min=0.01, max=1000000.0, subtype="DISTANCE", update=_project_changed,
    )
    geometry_optimization: bpy.props.EnumProperty(
        name="Geometry Compression",
        items=(
            ("NONE", "Off", "Maximum compatibility; publish Blender's uncompressed geometry"),
            ("MESHOPT", "Meshopt", "Compress geometry, morph targets, and animation for fast web delivery"),
        ),
        default="NONE",
        update=_project_changed,
    )
    texture_optimization: bpy.props.EnumProperty(
        name="GPU Textures",
        items=(
            ("NONE", "Original", "Keep authored PNG, JPEG, and WebP textures"),
            (
                "KTX2", "KTX2 Auto",
                "Use compact compression for opaque color and high-fidelity compression for detail, data, and alpha",
            ),
        ),
        default="NONE",
        update=_project_changed,
    )


class BlendlinkBakeRow(bpy.types.PropertyGroup):
    """One row of the bake table, populated from the manifest plan plus the
    live scene (shading reflects current properties, not the stale plan)."""
    name: bpy.props.StringProperty()
    atlas: bpy.props.StringProperty()
    shading: bpy.props.StringProperty()
    density: bpy.props.StringProperty()
    weight: bpy.props.StringProperty()
    reason: bpy.props.StringProperty()
    planned: bpy.props.BoolProperty()
    authored: bpy.props.BoolProperty()
    pinned: bpy.props.BoolProperty()


class BlendlinkCheckRow(bpy.types.PropertyGroup):
    """One Web Checks row.

    The panel used to render a slice of the issue list and pick its detail
    from the active object, so an issue with no object - a duplicate atlas
    name, a lighting state pointing at a deleted collection - could never be
    inspected, and anything past the eighth row was unreachable. A real list
    needs real rows: this is what template_list scrolls and selects.
    """
    severity: bpy.props.StringProperty()
    message: bpy.props.StringProperty()
    object_name: bpy.props.StringProperty()
    fixable_numbered: bpy.props.BoolProperty()
    blocking: bpy.props.BoolProperty()
    remedy: bpy.props.StringProperty()


def _select_row_object(self, context):
    obj = context.scene.objects.get(self.name)
    if obj is None:
        print(f"blendlink addon: bake-table object {self.name!r} no longer exists")
        return
    if context.view_layer.objects.active == obj and obj.select_get():
        return
    if context.mode != "OBJECT":
        print(
            f"blendlink addon: switch to Object Mode to select bake-table object {obj.name!r}"
        )
        return
    if obj.name not in context.view_layer.objects:
        print(
            f"blendlink addon: bake-table object {obj.name!r} is outside the active view layer"
        )
        return
    try:
        if obj.hide_select or not obj.visible_get(view_layer=context.view_layer):
            print(
                f"blendlink addon: bake-table object {obj.name!r} is hidden or selection-disabled"
            )
            return
    except (AttributeError, RuntimeError) as error:
        print(f"blendlink addon: could not inspect bake-table object {obj.name!r}: {error}")
        return
    try:
        for selected in context.selected_objects:
            selected.select_set(False)
        obj.select_set(True)
        if not obj.select_get():
            print(f"blendlink addon: Blender did not select bake-table object {obj.name!r}")
            return
        context.view_layer.objects.active = obj
    except RuntimeError as error:
        print(f"blendlink addon: could not select bake-table object {obj.name!r}: {error}")


def _row_index_update(self, context):
    rows = self.bake_rows
    if 0 <= self.bake_row_index < len(rows):
        _select_row_object(rows[self.bake_row_index], context)


class BlendlinkSessionSettings(bpy.types.PropertyGroup):
    show_overlay: bpy.props.BoolProperty(
        name="Web Guides",
        description=(
            "Draw web roles, composition guides, selected component ranges, "
            "reflection influence, and realtime shadow reach in the viewport"
        ),
        default=True,
        update=_redraw_view3d,
    )
    bake_rows: bpy.props.CollectionProperty(type=BlendlinkBakeRow)
    bake_row_index: bpy.props.IntProperty(default=-1, update=_row_index_update)
    check_rows: bpy.props.CollectionProperty(type=BlendlinkCheckRow)
    check_row_index: bpy.props.IntProperty(default=-1)
    derived_asset_path: bpy.props.StringProperty(options={"SKIP_SAVE"})
    derived_asset_label: bpy.props.StringProperty(options={"SKIP_SAVE"})
    derived_asset_atlas: bpy.props.StringProperty(default="main", options={"SKIP_SAVE"})
    derived_asset_kind: bpy.props.StringProperty(options={"SKIP_SAVE"})
    derived_asset_content_hash: bpy.props.StringProperty(options={"SKIP_SAVE"})


def _slug(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value or "atlas"


def _stable_id(obj) -> str:
    current = obj.get("blendlink_id")
    if not isinstance(current, str) or not current:
        if not getattr(obj, "is_editable", True):
            raise ValueError(
                f"Linked object {obj.name!r} has no persistent web identity. "
                "Open its source .blend with Blendlink enabled and save it once"
            )
        current = str(uuid.uuid4())
        try:
            obj["blendlink_id"] = current
        except (AttributeError, RuntimeError, TypeError) as error:
            raise ValueError(
                f"Could not preserve {obj.name!r} across renames: {error}"
            ) from error
    return current


def _component_raw_values(component) -> dict:
    try:
        value = json.loads(component.raw_values or "{}")
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError(
            f"{component_schema.label(component.component_type)} stored extension "
            f"values are not valid JSON: {error}"
        ) from error
    if not isinstance(value, dict):
        raise ValueError(
            f"{component_schema.label(component.component_type)} stored extension "
            "values must be a JSON object"
        )
    return value


def _component_reference(component, obj, label: str, *, required: bool = False) -> dict:
    if obj is None:
        if required:
            raise ValueError(f"{component_schema.label(component.component_type)} needs a {label.lower()}")
        return {}
    _require_scene_object(component, obj, label, stable_identity=True)
    return {f"{label[0].lower() + label[1:]}Id": _stable_id(obj),
            f"{label[0].lower() + label[1:]}Name": obj.name}


def component_values(component, *, require_complete=True) -> dict:
    """Serialize one known editor without discarding unknown adapter data."""
    values = _component_raw_values(component)
    component_type = component.component_type
    if component_type == "blendlink.bloom":
        values.update(
            mode=str(component.bloom_mode),
            intensity=float(component.intensity),
            threshold=float(component.threshold),
            radius=float(component.radius),
        )
    elif component_type == "blendlink.vignette":
        values.update(
            intensity=float(component.intensity),
            softness=float(component.softness),
            color=[float(channel) for channel in component.color],
        )
    elif component_type == "blendlink.chromatic-aberration":
        values.update(
            amount=float(component.chromatic_amount),
            mode=str(component.chromatic_mode),
            angle=float(math.degrees(component.chromatic_angle)),
            centerX=float(component.chromatic_center_x),
            centerY=float(component.chromatic_center_y),
        )
    elif component_type == "blendlink.pixelation":
        values.update(
            pixelSize=int(component.pixel_size),
            depthEdgeStrength=float(component.pixel_depth_edge_strength),
            normalEdgeStrength=float(component.pixel_normal_edge_strength),
        )
    elif component_type == "blendlink.sharpen":
        values.update(amount=float(component.sharpen_amount))
    elif component_type == "blendlink.tilt-shift":
        values.update(
            focusPosition=float(component.tilt_shift_focus_position),
            angle=float(math.degrees(component.tilt_shift_angle)),
            feather=float(component.tilt_shift_feather),
            strength=float(component.tilt_shift_strength),
            quality=str(component.tilt_shift_quality),
        )
    elif component_type == "blendlink.ambient-occlusion":
        values.update(
            radiusMode=str(component.ao_radius_mode),
            worldRadius=float(component.ao_world_radius),
            screenRadius=float(component.ao_screen_radius),
            intensity=float(component.ao_intensity),
            color=[float(channel) for channel in component.ao_color],
        )
    elif component_type == "blendlink.shadow-catcher":
        values.update(
            mode=str(component.shadow_catcher_mode),
            color=[float(channel) for channel in component.shadow_catcher_color],
            opacity=float(component.shadow_catcher_opacity),
            lightStrength=float(component.shadow_catcher_light_strength),
            includeDescendants=bool(component.shadow_catcher_include_descendants),
        )
    elif component_type == "blendlink.contact-shadows":
        values.update(
            autoFit=bool(component.contact_shadows_auto_fit),
            darkness=float(component.contact_shadows_darkness),
            opacity=float(component.contact_shadows_opacity),
            blur=float(component.contact_shadows_blur),
            occludeBelowGround=bool(
                component.contact_shadows_occlude_below_ground
            ),
            backfaceShadows=bool(component.contact_shadows_backface_shadows),
            updatePolicy=str(component.contact_shadows_update_policy),
        )
    elif component_type == "blendlink.outline":
        values.update(
            visibleColor=[float(channel) for channel in component.outline_visible_color],
            hiddenColor=[float(channel) for channel in component.outline_hidden_color],
            strength=float(component.outline_strength),
            thickness=float(component.outline_thickness),
            xRay=bool(component.outline_xray),
        )
    elif component_type == "blendlink.color-grading":
        address = component.color_grading_lut_url.strip()
        if address.lower().startswith(("javascript:", "data:", "file:")) or (
            require_complete and not address
        ):
            raise ValueError("Color Grade needs a safe site-relative or HTTPS LUT URL")
        values.update(
            lutUrl=address,
            intensity=float(component.color_grading_intensity),
            tetrahedralInterpolation=bool(component.color_grading_tetrahedral),
        )
    elif component_type == "blendlink.depth-of-field":
        mode = str(component.dof_focus_mode)
        values.update(
            focusMode=mode,
            focusDistance=float(component.dof_focus_distance),
            focusRange=float(component.dof_focus_range),
            blurStrength=float(component.dof_blur_strength),
        )
        if mode == "object":
            values.update(_component_reference(
                component, component.reference_object, "focusTarget",
                required=require_complete,
            ))
        else:
            values.pop("focusTargetId", None)
            values.pop("focusTargetName", None)
    elif component_type == "blendlink.kuwahara":
        values.update(
            strength=float(component.kuwahara_strength),
            brushScale=float(component.kuwahara_brush_scale),
            directionality=float(component.kuwahara_directionality),
            detail=float(component.kuwahara_detail),
        )
    elif component_type == "blendlink.see-through":
        values.update(
            fadeDistance=float(component.fade_distance),
            minOpacity=float(component.minimum_opacity),
            duration=float(component.duration),
        )
    elif component_type == "blendlink.open-url":
        address = component.url.strip()
        if address.lower().startswith(("javascript:", "data:")) or (
            require_complete and not address
        ):
            raise ValueError("Open Link on Click needs a safe website address")
        values.update(
            label=component.accessibility_label.strip(),
            url=address,
            newTab=bool(component.new_tab),
        )
    elif component_type == "blendlink.hover":
        values.update(scale=float(component.hover_scale), duration=float(component.duration))
    elif component_type == "blendlink.website-surface":
        values.update(
            name=component.website_surface_name.strip(),
            colorTreatment=str(component.website_surface_color_treatment),
        )
    elif component_type == "blendlink.hide-on-start":
        pass
    elif component_type == "blendlink.look-at":
        values.update(_component_reference(
            component, component.reference_object, "target",
            required=require_complete,
        ))
        values["keepUp"] = bool(component.keep_up)
    elif component_type == "blendlink.play-animation-on-click":
        clip = component.animation_clip.strip()
        if require_complete and not clip:
            raise ValueError("Play Animation on Click needs an exported animation name")
        values.update(
            label=component.accessibility_label.strip(),
            clip=clip,
            loop=bool(component.animation_loop),
        )
    elif component_type == "blendlink.audio-source":
        address = component.audio_url.strip()
        if address.lower().startswith(("javascript:", "data:")) or (
            require_complete and not address
        ):
            raise ValueError("Audio Source needs a safe site-relative or HTTPS audio URL")
        if component.max_distance <= component.min_distance:
            raise ValueError("Audio Source Silent Beyond must be farther than Full Volume Within")
        values.update(
            url=address,
            autoplay=bool(component.autoplay),
            loop=bool(component.audio_loop),
            volume=float(component.volume),
            spatial=bool(component.spatial),
            minDistance=float(component.min_distance),
            maxDistance=float(component.max_distance),
        )
    elif component_type == "blendlink.play-audio-on-click":
        reference = _component_reference(
            component, component.reference_object, "source",
            required=require_complete,
        )
        values.update(
            reference,
            label=component.accessibility_label.strip(),
            toggle=bool(component.toggle),
        )
    return values


def _component_target_object(project, component):
    scene = _owner_scene(project)
    target = component.target_object
    if target is None and scene is not None and component.target_id:
        target = next(
            (obj for obj in scene.objects if obj.get("blendlink_id") == component.target_id),
            None,
        )
    if target is None:
        raise ValueError(
            f"{component_schema.label(component.component_type)} has no target object"
        )
    _require_scene_object(component, target, "Component target", stable_identity=True)
    return target


def _validate_website_surface_target(obj, name: str) -> None:
    """Protect the v1 runtime's exact material/UV ownership assumptions."""
    if obj.type != "MESH":
        raise ValueError(f"Website Surface {name!r} needs a Mesh target")
    if not bool(obj.get("blendlink_dynamic", False)):
        raise ValueError(
            f"Website Surface {name!r} on {obj.name!r} must be Realtime; "
            "choose Realtime in Blendlink's Object controls"
        )
    if len(obj.data.materials) != 1 or obj.data.materials[0] is None:
        raise ValueError(
            f"Website Surface {name!r} on {obj.name!r} needs exactly one material; "
            "separate the screen faces into a dedicated mesh"
        )
    if not obj.data.polygons:
        raise ValueError(
            f"Website Surface {name!r} on {obj.name!r} has no renderable faces"
        )
    if any(polygon.material_index != 0 for polygon in obj.data.polygons):
        raise ValueError(
            f"Website Surface {name!r} on {obj.name!r} uses more than one material binding"
        )
    uv0_issue = component_validation.website_surface_uv0_issue(obj.data)
    if uv0_issue is not None:
        raise ValueError(
            f"Website Surface {name!r} on {obj.name!r}: {uv0_issue[1]}"
        )


def serialized_components(project) -> list[dict]:
    result = []
    ids = set()
    placements = set()
    website_surface_names = set()
    for index, component in enumerate(project.components):
        component_id = component.component_id.strip()
        component_type = component.component_type.strip()
        if not component_id:
            raise ValueError(f"Web Behavior {index + 1} has no persistent identity")
        if component_id in ids:
            raise ValueError(f"Web Behavior identity {component_id!r} is used more than once")
        ids.add(component_id)
        if not re.fullmatch(r"[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+", component_type):
            raise ValueError(f"Web Behavior type {component_type!r} is not a namespaced identifier")
        if int(component.schema_version) != component_schema.COMPONENT_SCHEMA_VERSION:
            raise ValueError(
                f"{component_schema.label(component_type)} uses unsupported schema version "
                f"{component.schema_version}"
            )
        target_kind = component.target_kind
        if target_kind == "SCENE":
            target = {"kind": "scene"}
            placement = (component_type, "scene")
            if not component_schema.supports_target(component_type, "SCENE"):
                raise ValueError(f"{component_schema.label(component_type)} cannot target the Scene")
        else:
            obj = _component_target_object(project, component)
            target_type = "MESH" if obj.type == "MESH" else "OBJECT"
            if not component_schema.supports_target(component_type, target_type):
                raise ValueError(
                    f"{component_schema.label(component_type)} cannot target {obj.name!r} ({obj.type})"
                )
            object_id = _stable_id(obj)
            target = {"kind": "object", "objectId": object_id, "objectName": obj.name}
            placement = (component_type, object_id)
        if placement in placements:
            raise ValueError(
                f"{component_schema.label(component_type)} is already added to this target"
            )
        placements.add(placement)
        require_complete = bool(component.enabled)
        values = component_values(
            component, require_complete=require_complete,
        )
        _validate_component_values(
            component_type, values, f"Web Behavior {index + 1} values",
            require_complete=require_complete,
        )
        if component_type == "blendlink.website-surface":
            surface_name = values.get("name")
            if surface_name in website_surface_names:
                raise ValueError(
                    f"Website Surface name {surface_name!r} is already used in this scene"
                )
            website_surface_names.add(surface_name)
            if component.enabled:
                _validate_website_surface_target(obj, surface_name)
        result.append({
            "id": component_id,
            "type": component_type,
            "schemaVersion": int(component.schema_version),
            "enabled": bool(component.enabled),
            "target": target,
            "values": values,
        })
    return result


# Portable recipe spelling for every Bake Output the RNA enum offers.
# Deliberately a mapping and not a ternary: the previous
# `"lighting" if atlas.bake_output == "LIGHTING" else "appearance"` turned
# every value it did not recognise into Appearance, so adding a third Bake
# Output would have silently published a flattened Combined bake. Blender's
# RNA rejects an unknown enum string on assignment (measured: TypeError
# 'enum "SURFACE" not found'), so a mismatch here can only come from this
# table falling behind the enum above -- which the addon suite now asserts.
_BAKE_OUTPUT_RECIPE_VALUES = {
    "LIGHTING": "lighting",
    "APPEARANCE": "appearance",
    "MATERIAL": "material",
}

# What each Bake Output is called and what it means, for every artist-facing
# surface. Here for the same reason the recipe spelling above is here: the UI
# used the same two-way ternary the recipe used, so an atlas set to Bake
# Material was labelled "Appearance" in the atlas list, described as
# "Finished appearance" in its consequence box, and reported as "uses Bake
# Appearance" in the per-object rendering reason -- three lies about one
# setting the artist had just chosen. Adding a Bake Output means adding a row
# here; the add-on suite asserts this table covers the enum.
BAKE_OUTPUT_UI = {
    "LIGHTING": {
        "short": "Lighting",
        "headline": "Baked lighting, live materials",
        "icon": "LIGHT",
        "consequence": (
            "Preserves material detail and reflections while capturing "
            "indirect light and grounding."
        ),
        "phrase": "Bake Lighting, preserving PBR while baking indirect GI",
    },
    "APPEARANCE": {
        "short": "Appearance",
        "headline": "Finished appearance",
        "icon": "IMAGE_DATA",
        "consequence": (
            "Captures the final stylized look when realtime PBR cannot "
            "reproduce it faithfully."
        ),
        "phrase": "Bake Appearance to capture the final stylized look",
    },
    "MATERIAL": {
        "short": "Material",
        "headline": "Baked surface, no lighting",
        "icon": "MATERIAL",
        "consequence": (
            "Stores the surface channels only, so lighting stays live and "
            "deforming objects can share one atlas."
        ),
        "phrase": "Bake Material to store surface channels with live lighting",
    },
}


def bake_output_ui(value: str) -> dict:
    """Presentation for one Bake Output, or a loud unknown rather than a guess."""
    known = BAKE_OUTPUT_UI.get(value)
    if known is not None:
        return known
    return {
        "short": "Unknown",
        "headline": f"Unknown Bake Output {value!r}",
        "icon": "ERROR",
        "consequence": (
            "This atlas was authored by a newer Blendlink. Update the add-on "
            "before publishing, or choose a Bake Output this version knows."
        ),
        "phrase": f"an unknown Bake Output ({value})",
    }


def _recipe_bake_output(atlas_name: str, value: str) -> str:
    """Portable spelling of one atlas Bake Output, or a loud refusal."""
    try:
        return _BAKE_OUTPUT_RECIPE_VALUES[value]
    except KeyError:
        raise ValueError(
            f"Atlas {atlas_name!r} has Bake Output {value!r}, which this "
            f"Blendlink build cannot publish; choose one of "
            f"{', '.join(sorted(_BAKE_OUTPUT_RECIPE_VALUES))}, or install the "
            f"Blendlink version that added it"
        ) from None


def project_recipe(project) -> dict:
    _require_scene_object(
        project, project.main_camera, "Website Camera", stable_identity=True,
    )
    _require_scene_object(
        project, project.camera_target, "Orbit Target", stable_identity=True,
    )
    atlases = []
    atlas_ids = set()
    atlas_names = set()
    for index, atlas in enumerate(project.atlases):
        atlas_id = "main" if index == 0 else _slug(atlas.atlas_id or atlas.name)
        atlas_name = "Main" if index == 0 else atlas.name.strip()
        if not atlas_name:
            raise ValueError(f"Atlas {index + 1} needs a name")
        if atlas_id in atlas_ids:
            raise ValueError(f"Atlas identity {atlas_id!r} is used more than once")
        name_key = atlas_name.casefold()
        if name_key in atlas_names:
            raise ValueError(f"Atlas name {atlas_name!r} is used more than once")
        atlas_ids.add(atlas_id)
        atlas_names.add(name_key)
        atlases.append({
            "id": atlas_id,
            "name": atlas_name,
            "size": int(atlas.size),
            "targetDensity": float(atlas.target_density),
            "margin": int(atlas.margin),
            "fitPolicy": "scale" if atlas.fit_policy == "SCALE" else "block",
            "bakeOutput": _recipe_bake_output(atlas_name, atlas.bake_output),
        })
    states = []
    state_names = set()
    for index, state in enumerate(project.states):
        state_name = state.name.strip()
        if not state_name:
            raise ValueError(f"Lighting State {index + 1} needs a name")
        if state_name in state_names:
            raise ValueError(f"Lighting State name {state_name!r} is used more than once")
        state_names.add(state_name)
        hidden = hidden_collection_names(state)
        states.append({
            "name": state_name,
            **({"hideCollections": hidden} if hidden else {}),
        })
    reflection_probes = []
    for probe in project.reflection_probes:
        helper = probe.probe_object
        _require_scene_object(probe, helper, "Reflection Probe helper", editable=True)
        _require_scene_object(
            probe, probe.anchor, "Reflection Probe anchor", stable_identity=True,
        )
        object_id = _stable_id(helper) if helper is not None else probe.object_id
        if not object_id:
            continue
        anchor = probe.anchor
        source = probe_authoring.mode_of(probe).lower()
        texture = probe_authoring.image_record(probe)
        reflection_probes.append({
            "id": _slug(probe.name),
            "name": probe.name.strip() or "Reflection Probe",
            "objectId": object_id,
            "objectName": helper.name if helper is not None else "<missing probe helper>",
            "shape": probe.shape.lower(),
            "source": source,
            "resolution": int(probe.resolution),
            "samples": int(probe.samples),
            "influence": float(probe.influence),
            "intensity": float(probe.intensity),
            **({"texture": texture} if texture is not None else {}),
            **({
                "anchorId": _stable_id(anchor),
                "anchorName": anchor.name,
            } if anchor is not None else {}),
        })
    shadow = _SHADOW_PRESETS.get(project.shadow_preset, (
        project.shadow_filter, int(project.shadow_map_size), float(project.shadow_max_distance),
        float(project.shadow_bias), float(project.shadow_normal_bias),
        float(project.shadow_radius), bool(project.shadow_auto_update),
    ))
    owner_scene = _owner_scene(project)
    if owner_scene is None:
        raise ValueError("Animation Sequence cannot resolve its owning Scene")
    animation_sequence = nla_sequence.collect_project_sequence(project, owner_scene)
    recipe = {
        "schemaVersion": RECIPE_SCHEMA_VERSION,
        "presentation": project.presentation.lower(),
        "atlases": atlases,
        "preview": {
            "samples": int(project.preview_samples),
            "supersample": 1,
            "denoise": False,
            "resolutionScale": float(project.preview_scale),
        },
        "final": {
            "samples": int(project.final_samples),
            "supersample": int(project.final_supersample),
            "denoise": bool(project.final_denoise),
            "resolutionScale": 1.0,
        },
        "states": states or [{"name": "default"}],
        "playback": {
            "start": project.animation_start.lower(),
            **({"clip": project.animation_clip.strip()}
               if project.animation_start == "NAMED" and project.animation_clip.strip() else {}),
            "loop": project.animation_loop.lower(),
            "speed": float(project.animation_speed),
        },
        **({"animationSequence": animation_sequence}
           if animation_sequence is not None else {}),
        "look": {
            "toneMapping": project.tone_mapping.lower(),
            "exposure": float(project.look_exposure),
            "background": project.background_mode.lower(),
            **({"backgroundColor": [float(value) for value in project.background_color]}
               if project.background_mode == "COLOR" else {}),
        },
        "fog": {
            "mode": project.fog_mode.lower(),
            "color": [float(value) for value in project.fog_color],
            "near": float(project.fog_near),
            "far": float(project.fog_far),
            "density": float(project.fog_density),
        },
        "shadows": {
            "preset": project.shadow_preset.lower(),
            "filter": shadow[0].lower(),
            "mapSize": int(shadow[1]),
            "maxDistance": float(shadow[2]),
            "bias": float(shadow[3]),
            "normalBias": float(shadow[4]),
            "radius": float(shadow[5]),
            "autoUpdate": bool(shadow[6]),
        },
        "environment": {
            "source": project.environment_source.lower(),
            **({"imageName": project.environment_image.name}
               if project.environment_source == "IMAGE" and project.environment_image is not None else {}),
            "lighting": project.environment_lighting.lower(),
            "background": project.environment_background.lower(),
            "lightingIntensity": float(project.environment_lighting_intensity),
            "lightingRotation": float(project.environment_lighting_rotation * 180.0 / 3.141592653589793),
            "backgroundIntensity": (
                1.0 if project.environment_background == "GROUNDED"
                else float(project.environment_background_intensity)
            ),
            "backgroundRotation": float(project.environment_background_rotation * 180.0 / 3.141592653589793),
            "backgroundBlur": (
                0.0 if project.environment_background == "GROUNDED"
                else float(project.environment_background_blur)
            ),
            "groundHeight": float(project.environment_ground_height),
            "groundRadius": float(project.environment_ground_radius),
        },
        "reflectionProbes": reflection_probes,
        "components": serialized_components(project),
        "optimization": {
            "geometry": "meshopt" if project.geometry_optimization == "MESHOPT" else "none",
            "textures": "ktx2" if project.texture_optimization == "KTX2" else "none",
        },
    }
    camera = project.main_camera
    if camera is not None and camera.type == "CAMERA":
        target = project.camera_target
        compositions = []
        composition_names = set()
        for index, frame in enumerate(project.compositions):
            frame_name = frame.name.strip()
            if not frame_name:
                raise ValueError(f"Responsive Frame {index + 1} needs a name")
            if frame_name in composition_names:
                raise ValueError(f"Responsive Frame name {frame_name!r} is used more than once")
            composition_names.add(frame_name)
            compositions.append({
                "name": frame_name,
                "width": int(frame.width),
                "height": int(frame.height),
                "safeMargin": float(frame.safe_margin),
            })
        if not compositions:
            raise ValueError("Website Camera needs at least one Responsive Frame")
        recipe["camera"] = {
            "objectId": _stable_id(camera),
            "objectName": camera.name,
            "behavior": project.camera_behavior.lower(),
            "framing": project.camera_framing.lower().replace("_", "-"),
            **({
                "targetId": _stable_id(target),
                "targetName": target.name,
            } if target is not None else {}),
            "compositions": compositions,
        }
    return recipe


def write_recipe(scene) -> dict:
    project = scene.blendlink_project
    try:
        recipe = project_recipe(project)
    except ValueError as error:
        project.recipe_error = str(error)
        print(f"blendlink addon: scene settings could not be written: {error}")
        raise
    project.recipe_error = ""
    encoded = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    if scene.get(RECIPE_PROPERTY) != encoded:
        scene[RECIPE_PROPERTY] = encoded
    return recipe


def setup_project(scene):
    global _loading_recipe
    project = scene.blendlink_project
    _loading_recipe = True
    try:
        project.configured = True
        project.recipe_error = ""
        project.presentation = "HYBRID"
        project.final_samples = 128
        project.final_supersample = 2
        project.final_denoise = True
        project.preview_samples = 16
        project.preview_scale = 0.25
        project.atlases.clear()
        main = project.atlases.add()
        main.atlas_id = "main"
        main.name = "Main"
        main.size = 2048
        main.target_density = 256
        main.margin = 48
        main.fit_policy = "BLOCK"
        main.bake_output = "LIGHTING"
        project.atlas_index = 0
        project.states.clear()
        state = project.states.add()
        state.name = "default"
        project.state_index = 0
        project.reflection_probes.clear()
        project.reflection_probe_index = 0
        project.components.clear()
        project.component_index = 0
        project.main_camera = scene.camera if scene.camera and scene.camera.type == "CAMERA" else next(
            (obj for obj in scene.objects if obj.type == "CAMERA"), None,
        )
        project.camera_behavior = "FIXED"
        project.camera_framing = "AUTHORED"
        project.camera_target = None
        project.compositions.clear()
        desktop = project.compositions.add()
        desktop.name, desktop.width, desktop.height, desktop.safe_margin = "Desktop", 1440, 900, 0.08
        mobile = project.compositions.add()
        mobile.name, mobile.width, mobile.height, mobile.safe_margin = "Mobile", 390, 844, 0.08
        project.composition_index = 0
        project.animation_start = "MANUAL"
        project.animation_clip = ""
        project.animation_loop = "REPEAT"
        project.animation_speed = 1.0
        project.animation_sequence_enabled = False
        project.animation_sequence_name = "Website Sequence"
        project.animation_sequence_source = None
        project.animation_sequence_track = ""
        project.animation_sequence_loop = False
        project.animation_sequence_speed = 1.0
        project.animation_sequence_easing = "EASE_IN_OUT"
        project.tone_mapping = "APPLICATION"
        project.look_exposure = 0.0
        project.background_mode = "APPLICATION"
        world_color = scene.world.color if scene.world is not None else (0.05, 0.05, 0.05)
        project.background_color = tuple(world_color[:3])
        project.fog_mode = "APPLICATION"
        project.fog_color = tuple(world_color[:3])
        project.fog_near = 10.0
        project.fog_far = 100.0
        project.fog_density = 0.02
        project.shadow_preset = "APPLICATION"
        project.shadow_filter = "PCF"
        project.shadow_map_size = 1024
        project.shadow_max_distance = 50.0
        project.shadow_bias = -0.0005
        project.shadow_normal_bias = 0.02
        project.shadow_radius = 1.0
        project.shadow_auto_update = True
        world_environment = _world_environment_image(scene)
        project.environment_source = "IMAGE" if world_environment is not None else "APPLICATION"
        project.environment_image = world_environment
        project.environment_lighting = "IMAGE" if world_environment is not None else "APPLICATION"
        project.environment_background = "IMAGE" if world_environment is not None else "APPLICATION"
        project.environment_lighting_intensity = 1.0
        project.environment_lighting_rotation = 0.0
        project.environment_background_intensity = 1.0
        project.environment_background_rotation = 0.0
        project.environment_background_blur = 0.0
        project.environment_ground_height = 2.0
        project.environment_ground_radius = 100.0
        project.geometry_optimization = "NONE"
        project.texture_optimization = "NONE"
    finally:
        _loading_recipe = False
    recipe = write_recipe(scene)
    from . import handlers
    handlers.mark_bake_table_changed()
    return recipe


def _validate_recipe_number(record, key, path, minimum, maximum, *, integer=False):
    if key not in record:
        return
    value = record[key]
    valid_type = isinstance(value, int) if integer else isinstance(value, (int, float))
    if isinstance(value, bool) or not valid_type:
        expected = "an integer" if integer else "a number"
        raise ValueError(f"{path}.{key} must be {expected}")
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < minimum or numeric > maximum:
        raise ValueError(f"{path}.{key} must be between {minimum:g} and {maximum:g}")


def _validate_recipe_color(record, key, path):
    if key not in record:
        return
    value = record[key]
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{path}.{key} must be a three-number color")
    for component in value:
        if isinstance(component, bool) or not isinstance(component, (int, float)) \
                or not math.isfinite(float(component)) or not 0 <= float(component) <= 1:
            raise ValueError(f"{path}.{key} components must be between 0 and 1")


def _validate_json_value(value, path):
    """Reject JSON extensions such as NaN before they reach the web contract."""
    if value is None or isinstance(value, (str, bool)):
        return
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if math.isfinite(float(value)):
            return
        raise ValueError(f"{path} must be a finite JSON number")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _validate_json_value(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path} keys must be text")
            _validate_json_value(item, f"{path}.{key}")
        return
    raise ValueError(f"{path} must contain JSON-compatible values")


_COMPONENT_NUMBER_FIELDS = {
    "blendlink.bloom": {
        "intensity": (0, 100), "threshold": (0, 100), "radius": (0, 1),
    },
    "blendlink.vignette": {"intensity": (0, 1), "softness": (0, 1)},
    "blendlink.chromatic-aberration": {
        "amount": (0, 0.05), "angle": (-180, 180),
        "centerX": (0, 1), "centerY": (0, 1),
    },
    "blendlink.pixelation": {
        "pixelSize": (1, 256), "depthEdgeStrength": (0, 1),
        "normalEdgeStrength": (0, 1),
    },
    "blendlink.sharpen": {"amount": (0, 1)},
    "blendlink.tilt-shift": {
        "focusPosition": (0, 1), "angle": (-180, 180),
        "feather": (0.001, 1), "strength": (0, 1),
    },
    "blendlink.ambient-occlusion": {
        "worldRadius": (0.000001, 100000), "screenRadius": (1, 256),
        "intensity": (0, 20),
    },
    "blendlink.contact-shadows": {
        "darkness": (0, 20), "opacity": (0, 1), "blur": (0, 100),
    },
    "blendlink.outline": {"strength": (0, 100), "thickness": (0, 16)},
    "blendlink.color-grading": {"intensity": (0, 1)},
    "blendlink.depth-of-field": {
        "focusDistance": (0.000001, 1000000),
        "focusRange": (0.000001, 1000000), "blurStrength": (0, 20),
    },
    "blendlink.kuwahara": {
        "strength": (0, 1), "brushScale": (1, 32),
        "directionality": (0, 1), "detail": (0, 1),
    },
    "blendlink.see-through": {
        "fadeDistance": (0, 100000), "minOpacity": (0, 1), "duration": (0, 60),
    },
    "blendlink.hover": {"scale": (0.01, 100), "duration": (0, 60)},
    "blendlink.audio-source": {
        "volume": (0, 1), "minDistance": (0, 100000),
        "maxDistance": (0, 100000),
    },
}
_COMPONENT_BOOLEAN_FIELDS = {
    "blendlink.shadow-catcher": ("includeDescendants",),
    "blendlink.contact-shadows": (
        "autoFit", "occludeBelowGround", "backfaceShadows",
    ),
    "blendlink.outline": ("xRay",),
    "blendlink.color-grading": ("tetrahedralInterpolation",),
    "blendlink.open-url": ("newTab",),
    "blendlink.look-at": ("keepUp",),
    "blendlink.play-animation-on-click": ("loop",),
    "blendlink.audio-source": ("autoplay", "loop", "spatial"),
    "blendlink.play-audio-on-click": ("toggle",),
}
_COMPONENT_TEXT_FIELDS = {
    "blendlink.bloom": ("mode",),
    "blendlink.chromatic-aberration": ("mode",),
    "blendlink.tilt-shift": ("quality",),
    "blendlink.ambient-occlusion": ("radiusMode",),
    "blendlink.contact-shadows": ("updatePolicy",),
    "blendlink.color-grading": ("lutUrl",),
    "blendlink.depth-of-field": (
        "focusMode", "focusTargetId", "focusTargetName",
    ),
    "blendlink.open-url": ("label", "url"),
    "blendlink.look-at": ("targetId", "targetName"),
    "blendlink.play-animation-on-click": ("label", "clip"),
    "blendlink.audio-source": ("url",),
    "blendlink.play-audio-on-click": ("label", "sourceId", "sourceName"),
    "blendlink.website-surface": ("name", "colorTreatment"),
}
_COMPONENT_REQUIRED_TEXT_FIELDS = {
    "blendlink.color-grading": ("lutUrl",),
    "blendlink.open-url": ("url",),
    "blendlink.look-at": ("targetId",),
    "blendlink.play-animation-on-click": ("clip",),
    "blendlink.audio-source": ("url",),
    "blendlink.play-audio-on-click": ("sourceId",),
    "blendlink.website-surface": ("name",),
}
_COMPONENT_ENUM_FIELDS = {
    "blendlink.bloom": {"mode": {"bright-pixels", "emissive-objects"}},
    "blendlink.chromatic-aberration": {"mode": {"directional", "radial"}},
    "blendlink.tilt-shift": {"quality": {"low", "balanced", "high"}},
    "blendlink.ambient-occlusion": {"radiusMode": {"world", "screen"}},
    "blendlink.contact-shadows": {
        "updatePolicy": {"static", "continuous"},
    },
    "blendlink.depth-of-field": {"focusMode": {"distance", "object"}},
    "blendlink.website-surface": {
        "colorTreatment": {"display", "surface"},
    },
}


def _validate_component_values(
    component_type, values, path, *, require_complete=True,
):
    _validate_json_value(values, path)
    for key, (minimum, maximum) in _COMPONENT_NUMBER_FIELDS.get(component_type, {}).items():
        _validate_recipe_number(values, key, path, minimum, maximum)
    for key in _COMPONENT_BOOLEAN_FIELDS.get(component_type, ()):
        if key in values and not isinstance(values[key], bool):
            raise ValueError(f"{path}.{key} must be true or false")
    for key in _COMPONENT_TEXT_FIELDS.get(component_type, ()):
        if key in values and not isinstance(values[key], str):
            raise ValueError(f"{path}.{key} must be text")
    for key, options in _COMPONENT_ENUM_FIELDS.get(component_type, {}).items():
        if key in values and values[key] not in options:
            raise ValueError(
                f"{path}.{key} must be one of {', '.join(sorted(options))}"
            )
    if require_complete:
        for key in _COMPONENT_REQUIRED_TEXT_FIELDS.get(component_type, ()):
            if not isinstance(values.get(key), str) or not values[key].strip():
                raise ValueError(f"{path}.{key} is required")
    for color_key in {
        "blendlink.vignette": ("color",),
        "blendlink.ambient-occlusion": ("color",),
        "blendlink.outline": ("visibleColor", "hiddenColor"),
    }.get(component_type, ()):
        _validate_recipe_color(values, color_key, path)
    if component_type in {
        "blendlink.open-url", "blendlink.audio-source", "blendlink.color-grading",
    }:
        url_key = "lutUrl" if component_type == "blendlink.color-grading" else "url"
        address = str(values.get(url_key, "")).strip()
        scheme_match = re.match(r"^([a-z][a-z0-9+.-]*):", address, re.IGNORECASE)
        allowed_schemes = (
            {"http", "https", "mailto", "tel"}
            if component_type == "blendlink.open-url" else {"http", "https"}
        )
        if scheme_match and scheme_match.group(1).lower() not in allowed_schemes:
            allowed = ", ".join(sorted(allowed_schemes))
            raise ValueError(
                f"{path}.{url_key} uses an unsupported scheme; use {allowed} or a site-relative path"
            )
    if component_type == "blendlink.audio-source" \
            and "minDistance" in values and "maxDistance" in values \
            and float(values["maxDistance"]) <= float(values["minDistance"]):
        raise ValueError(f"{path}.maxDistance must be greater than minDistance")
    if component_type == "blendlink.depth-of-field" \
            and values.get("focusMode") == "object" \
            and require_complete \
            and (not isinstance(values.get("focusTargetId"), str)
                 or not values["focusTargetId"].strip()):
        raise ValueError(
            f"{path}.focusTargetId is required when focusMode is object"
        )
    if component_type == "blendlink.pixelation" and "pixelSize" in values \
            and (isinstance(values["pixelSize"], bool)
                 or not float(values["pixelSize"]).is_integer()):
        raise ValueError(f"{path}.pixelSize must be a whole number of CSS pixels")
    if component_type == "blendlink.website-surface" and "name" in values:
        name = values["name"]
        if not isinstance(name, str) or len(name) > 64 or not re.fullmatch(
            r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name,
        ):
            raise ValueError(
                f"{path}.name must be lowercase kebab-case, up to 64 characters"
            )


def _validate_recipe_components(recipe):
    raw_components = recipe.get("components")
    if raw_components is None:
        return
    if not isinstance(raw_components, list):
        raise ValueError("components must be an array")
    seen_ids = set()
    seen_placements = set()
    seen_website_surface_names = set()
    for index, raw_component in enumerate(raw_components):
        path = f"components[{index}]"
        if not isinstance(raw_component, dict):
            raise ValueError(f"{path} must be an object")
        component_id = raw_component.get("id")
        if not isinstance(component_id, str) or not component_id.strip() \
                or len(component_id) > 256:
            raise ValueError(f"{path}.id must be a non-empty stable identifier")
        if component_id in seen_ids:
            raise ValueError(f"duplicate component id {component_id!r}")
        seen_ids.add(component_id)
        component_type = raw_component.get("type")
        if not isinstance(component_type, str) or not re.fullmatch(
            r"[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+", component_type,
        ):
            raise ValueError(f"{path}.type must be a lowercase vendor-namespaced identifier")
        if raw_component.get("schemaVersion") != component_schema.COMPONENT_SCHEMA_VERSION:
            raise ValueError(
                f"{path}.schemaVersion must be {component_schema.COMPONENT_SCHEMA_VERSION}"
            )
        if not isinstance(raw_component.get("enabled"), bool):
            raise ValueError(f"{path}.enabled must be true or false")
        target = raw_component.get("target")
        if not isinstance(target, dict):
            raise ValueError(f"{path}.target must be an object")
        target_kind = target.get("kind")
        definition = component_schema.definition(component_type)
        if target_kind == "scene":
            placement = (component_type, "scene")
            if definition is not None and "SCENE" not in definition["targets"]:
                raise ValueError(f"{path}.target cannot be the Scene")
        elif target_kind == "object":
            object_id = target.get("objectId")
            if not isinstance(object_id, str) or not object_id.strip() \
                    or len(object_id) > 256:
                raise ValueError(f"{path}.target.objectId must be a stable object identifier")
            object_name = target.get("objectName")
            if object_name is not None and not isinstance(object_name, str):
                raise ValueError(f"{path}.target.objectName must be text")
            placement = (component_type, object_id)
            if definition is not None and not (
                {"OBJECT", "MESH"} & set(definition["targets"])
            ):
                raise ValueError(f"{path}.target cannot be an Object")
        else:
            raise ValueError(f"{path}.target.kind must be scene or object")
        if definition is not None \
                and definition.get("cardinality") == "one-per-scene":
            placement = (component_type, "scene")
        if placement in seen_placements:
            raise ValueError(
                f"{path} duplicates a one-per-scene behavior"
                if definition is not None
                and definition.get("cardinality") == "one-per-scene"
                else f"{path} duplicates this behavior on the same target"
            )
        seen_placements.add(placement)
        values = raw_component.get("values")
        if not isinstance(values, dict):
            raise ValueError(f"{path}.values must be an object")
        _validate_component_values(
            component_type, values, f"{path}.values",
            require_complete=bool(raw_component["enabled"]),
        )
        if component_type == "blendlink.website-surface":
            surface_name = values.get("name")
            if surface_name in seen_website_surface_names:
                raise ValueError(
                    f"{path}.values.name duplicates Website Surface {surface_name!r}"
                )
            seen_website_surface_names.add(surface_name)


def _validate_legacy_recipe_payload(recipe, scene=None) -> str:
    """Reject the complete payload before any RNA collection is mutated."""
    try:
        for key in (
            "preview", "final", "playback", "look", "fog", "shadows",
            "environment", "optimization", "animationSequence",
        ):
            if key in recipe and not isinstance(recipe[key], dict):
                raise ValueError(f"{key} must be an object")

        preview = recipe.get("preview") or {}
        final = recipe.get("final") or {}
        _validate_recipe_number(preview, "samples", "preview", 1, 4096, integer=True)
        _validate_recipe_number(preview, "resolutionScale", "preview", 0.0625, 1)
        _validate_recipe_number(final, "samples", "final", 1, 16384, integer=True)
        _validate_recipe_number(final, "supersample", "final", 1, 4, integer=True)
        if "denoise" in final and not isinstance(final["denoise"], bool):
            raise ValueError("final.denoise must be true or false")

        raw_atlases = recipe["atlases"]
        seen_atlases = set()
        for index, atlas in enumerate(raw_atlases):
            path = f"atlases[{index}]"
            if not isinstance(atlas, dict):
                raise ValueError(f"{path} must be an object")
            atlas_id = atlas.get("id")
            if not isinstance(atlas_id, str) or not atlas_id or _slug(atlas_id) != atlas_id:
                raise ValueError(f"{path}.id must be a lowercase stable slug")
            if atlas_id in seen_atlases:
                raise ValueError(f"duplicate atlas id {atlas_id!r}")
            seen_atlases.add(atlas_id)
            if "name" in atlas and (not isinstance(atlas["name"], str) or not atlas["name"].strip()):
                raise ValueError(f"{path}.name must be non-empty text")
            _validate_recipe_number(atlas, "size", path, 128, 8192, integer=True)
            _validate_recipe_number(atlas, "targetDensity", path, 1, 8192)
            _validate_recipe_number(atlas, "margin", path, 0, 256, integer=True)
            fit_policy = atlas.get("fitPolicy", "block")
            if fit_policy not in {"block", "scale"}:
                raise ValueError(f"{path}.fitPolicy must be block or scale, not {fit_policy!r}")
            bake_output = atlas.get("bakeOutput")
            if bake_output not in {None, "lighting", "appearance", "material"}:
                raise ValueError(
                    f"{path}.bakeOutput must be lighting, appearance or "
                    f"material, not {bake_output!r}"
                )

        states = recipe.get("states")
        if states is not None:
            if not isinstance(states, list) or not states:
                raise ValueError("states must be a non-empty array")
            seen_states = set()
            for index, state in enumerate(states):
                path = f"states[{index}]"
                if not isinstance(state, dict):
                    raise ValueError(f"{path} must be an object")
                name = state.get("name", "default")
                if not isinstance(name, str) or not name.strip():
                    raise ValueError(f"{path}.name must be non-empty text")
                if name in seen_states:
                    raise ValueError(f"duplicate lighting state {name!r}")
                seen_states.add(name)
                hidden = state.get("hideCollections", [])
                if not isinstance(hidden, list) or any(
                    not isinstance(item, str) or not item.strip() for item in hidden
                ):
                    raise ValueError(f"{path}.hideCollections must be an array of collection names")

        camera = recipe.get("camera")
        if camera is not None:
            if not isinstance(camera, dict):
                raise ValueError("camera must be an object")
            compositions = camera.get("compositions", [])
            if not isinstance(compositions, list):
                raise ValueError("camera.compositions must be an array")
            for index, frame in enumerate(compositions):
                path = f"camera.compositions[{index}]"
                if not isinstance(frame, dict):
                    raise ValueError(f"{path} must be an object")
                if "name" in frame and (not isinstance(frame["name"], str) or not frame["name"].strip()):
                    raise ValueError(f"{path}.name must be non-empty text")
                _validate_recipe_number(frame, "width", path, 1, 16384, integer=True)
                _validate_recipe_number(frame, "height", path, 1, 16384, integer=True)
                _validate_recipe_number(frame, "safeMargin", path, 0, 0.45)

        probes = recipe.get("reflectionProbes")
        if probes is not None:
            if not isinstance(probes, list):
                raise ValueError("reflectionProbes must be an array")
            for index, probe in enumerate(probes):
                path = f"reflectionProbes[{index}]"
                if not isinstance(probe, dict):
                    raise ValueError(f"{path} must be an object")
                if probe.get("shape", "box") not in {"box", "sphere"}:
                    raise ValueError(f"{path}.shape must be box or sphere")
                if str(probe.get("resolution", 256)) not in {"64", "128", "256", "512", "1024", "2048"}:
                    raise ValueError(f"{path}.resolution is unsupported")
                source = probe.get("source", "runtime")
                if source not in {"runtime", "baked", "custom"}:
                    raise ValueError(f"{path}.source must be runtime, baked, or custom")
                _validate_recipe_number(probe, "samples", path, 1, 16384, integer=True)
                _validate_recipe_number(probe, "influence", path, 0.01, 1000000)
                _validate_recipe_number(probe, "intensity", path, 0, 100)
                texture = probe.get("texture")
                if source == "runtime" and texture is not None:
                    raise ValueError(f"{path}.texture is only valid for baked/custom sources")
                if source in {"baked", "custom"}:
                    if not isinstance(texture, dict):
                        raise ValueError(f"{path}.texture is required for {source} source")
                    image_name = texture.get("imageName")
                    if not isinstance(image_name, str) or not image_name.strip():
                        raise ValueError(f"{path}.texture.imageName must be non-empty text")
                    if "width" not in texture or "height" not in texture:
                        raise ValueError(f"{path}.texture needs width and height evidence")
                    _validate_recipe_number(texture, "width", f"{path}.texture", 32, 8192, integer=True)
                    _validate_recipe_number(texture, "height", f"{path}.texture", 16, 4096, integer=True)
                    if int(texture["width"]) != int(texture["height"]) * 2:
                        raise ValueError(f"{path}.texture must be 2:1 equirectangular")
                    if texture.get("format") not in {"hdr", "exr", "png", "jpeg", "webp"}:
                        raise ValueError(f"{path}.texture.format is unsupported")
                    if texture.get("colorSpace") not in {"linear", "srgb"}:
                        raise ValueError(f"{path}.texture.colorSpace must be linear or srgb")
                    if source == "baked":
                        for key in ("sourceHash", "contentHash"):
                            value = texture.get(key)
                            if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{16,64}", value) is None:
                                raise ValueError(f"{path}.texture.{key} is not a valid content hash")
                    elif "sourceHash" in texture or "contentHash" in texture:
                        raise ValueError(
                            f"{path}.texture custom hashes are derived during publish, not authored"
                        )

        _validate_recipe_components(recipe)
        nla_sequence.validate_published_sequence(
            recipe.get("animationSequence"), scene,
        )

        playback = recipe.get("playback") or {}
        look = recipe.get("look") or {}
        fog = recipe.get("fog") or {}
        shadows = recipe.get("shadows") or {}
        environment = recipe.get("environment") or {}
        _validate_recipe_number(playback, "speed", "playback", 0.05, 4)
        _validate_recipe_number(look, "exposure", "look", -10, 10)
        _validate_recipe_color(look, "backgroundColor", "look")
        _validate_recipe_color(fog, "color", "fog")
        _validate_recipe_number(fog, "near", "fog", 0, 1000000)
        _validate_recipe_number(fog, "far", "fog", 0.001, 1000000)
        _validate_recipe_number(fog, "density", "fog", 0.000001, 100)
        _validate_recipe_number(shadows, "mapSize", "shadows", 128, 8192, integer=True)
        _validate_recipe_number(shadows, "maxDistance", "shadows", 0.1, 100000)
        _validate_recipe_number(shadows, "bias", "shadows", -0.1, 0.1)
        _validate_recipe_number(shadows, "normalBias", "shadows", 0, 10)
        _validate_recipe_number(shadows, "radius", "shadows", 0, 32)
        for key, minimum, maximum in (
            ("lightingIntensity", 0, 100), ("lightingRotation", -360, 360),
            ("backgroundIntensity", 0, 100), ("backgroundRotation", -360, 360),
            ("backgroundBlur", 0, 1), ("groundHeight", 0.01, 100000),
            ("groundRadius", 0.01, 1000000),
        ):
            _validate_recipe_number(environment, key, "environment", minimum, maximum)
    except (KeyError, TypeError, ValueError) as error:
        return str(error)
    return ""


def _scene_object_with_id(scene, object_id):
    if not isinstance(object_id, str) or not object_id:
        return None
    return next(
        (obj for obj in scene.objects if obj.get("blendlink_id") == object_id),
        None,
    )


def _hydrate_component_values(component, values, scene):
    """Populate a known RNA editor while retaining the complete JSON payload."""
    component.raw_values = json.dumps(
        values, ensure_ascii=False, allow_nan=False, sort_keys=True,
        separators=(",", ":"),
    )
    component_type = component.component_type
    if component_type == "blendlink.bloom":
        component.bloom_mode = str(values.get("mode", component.bloom_mode))
        component.intensity = float(values.get("intensity", component.intensity))
        component.threshold = float(values.get("threshold", component.threshold))
        component.radius = float(values.get("radius", component.radius))
    elif component_type == "blendlink.vignette":
        component.intensity = float(values.get("intensity", component.intensity))
        component.softness = float(values.get("softness", component.softness))
        if "color" in values:
            component.color = tuple(float(value) for value in values["color"])
    elif component_type == "blendlink.chromatic-aberration":
        component.chromatic_amount = float(
            values.get("amount", component.chromatic_amount)
        )
        component.chromatic_mode = str(values.get("mode", component.chromatic_mode))
        if "angle" in values:
            component.chromatic_angle = math.radians(float(values["angle"]))
        component.chromatic_center_x = float(
            values.get("centerX", component.chromatic_center_x)
        )
        component.chromatic_center_y = float(
            values.get("centerY", component.chromatic_center_y)
        )
    elif component_type == "blendlink.pixelation":
        component.pixel_size = int(values.get("pixelSize", component.pixel_size))
        component.pixel_depth_edge_strength = float(
            values.get("depthEdgeStrength", component.pixel_depth_edge_strength)
        )
        component.pixel_normal_edge_strength = float(
            values.get("normalEdgeStrength", component.pixel_normal_edge_strength)
        )
    elif component_type == "blendlink.sharpen":
        component.sharpen_amount = float(values.get("amount", component.sharpen_amount))
    elif component_type == "blendlink.tilt-shift":
        component.tilt_shift_focus_position = float(
            values.get("focusPosition", component.tilt_shift_focus_position)
        )
        if "angle" in values:
            component.tilt_shift_angle = math.radians(float(values["angle"]))
        component.tilt_shift_feather = float(
            values.get("feather", component.tilt_shift_feather)
        )
        component.tilt_shift_strength = float(
            values.get("strength", component.tilt_shift_strength)
        )
        component.tilt_shift_quality = str(
            values.get("quality", component.tilt_shift_quality)
        )
    elif component_type == "blendlink.ambient-occlusion":
        component.ao_radius_mode = str(values.get("radiusMode", component.ao_radius_mode))
        component.ao_world_radius = float(values.get("worldRadius", component.ao_world_radius))
        component.ao_screen_radius = float(values.get("screenRadius", component.ao_screen_radius))
        component.ao_intensity = float(values.get("intensity", component.ao_intensity))
        if "color" in values:
            component.ao_color = tuple(float(value) for value in values["color"])
    elif component_type == "blendlink.shadow-catcher":
        component.shadow_catcher_mode = str(
            values.get("mode", component.shadow_catcher_mode)
        )
        if "color" in values:
            component.shadow_catcher_color = tuple(
                float(value) for value in values["color"]
            )
        component.shadow_catcher_opacity = float(
            values.get("opacity", component.shadow_catcher_opacity)
        )
        component.shadow_catcher_light_strength = float(
            values.get(
                "lightStrength", component.shadow_catcher_light_strength,
            )
        )
        component.shadow_catcher_include_descendants = bool(
            values.get(
                "includeDescendants",
                component.shadow_catcher_include_descendants,
            )
        )
    elif component_type == "blendlink.contact-shadows":
        component.contact_shadows_auto_fit = bool(
            values.get("autoFit", component.contact_shadows_auto_fit)
        )
        component.contact_shadows_darkness = float(
            values.get("darkness", component.contact_shadows_darkness)
        )
        component.contact_shadows_opacity = float(
            values.get("opacity", component.contact_shadows_opacity)
        )
        component.contact_shadows_blur = float(
            values.get("blur", component.contact_shadows_blur)
        )
        component.contact_shadows_occlude_below_ground = bool(
            values.get(
                "occludeBelowGround",
                component.contact_shadows_occlude_below_ground,
            )
        )
        component.contact_shadows_backface_shadows = bool(
            values.get(
                "backfaceShadows",
                component.contact_shadows_backface_shadows,
            )
        )
        component.contact_shadows_update_policy = str(
            values.get(
                "updatePolicy", component.contact_shadows_update_policy,
            )
        )
    elif component_type == "blendlink.outline":
        if "visibleColor" in values:
            component.outline_visible_color = tuple(
                float(value) for value in values["visibleColor"]
            )
        if "hiddenColor" in values:
            component.outline_hidden_color = tuple(
                float(value) for value in values["hiddenColor"]
            )
        component.outline_strength = float(
            values.get("strength", component.outline_strength)
        )
        component.outline_thickness = float(
            values.get("thickness", component.outline_thickness)
        )
        component.outline_xray = bool(values.get("xRay", component.outline_xray))
    elif component_type == "blendlink.color-grading":
        component.color_grading_lut_url = str(
            values.get("lutUrl", component.color_grading_lut_url)
        )
        component.color_grading_intensity = float(
            values.get("intensity", component.color_grading_intensity)
        )
        component.color_grading_tetrahedral = bool(
            values.get(
                "tetrahedralInterpolation", component.color_grading_tetrahedral,
            )
        )
    elif component_type == "blendlink.depth-of-field":
        component.dof_focus_mode = str(
            values.get("focusMode", component.dof_focus_mode)
        )
        component.dof_focus_distance = float(
            values.get("focusDistance", component.dof_focus_distance)
        )
        component.dof_focus_range = float(
            values.get("focusRange", component.dof_focus_range)
        )
        component.dof_blur_strength = float(
            values.get("blurStrength", component.dof_blur_strength)
        )
        component.reference_object = _scene_object_with_id(
            scene, values.get("focusTargetId")
        )
    elif component_type == "blendlink.kuwahara":
        component.kuwahara_strength = float(
            values.get("strength", component.kuwahara_strength)
        )
        component.kuwahara_brush_scale = float(
            values.get("brushScale", component.kuwahara_brush_scale)
        )
        component.kuwahara_directionality = float(
            values.get("directionality", component.kuwahara_directionality)
        )
        component.kuwahara_detail = float(
            values.get("detail", component.kuwahara_detail)
        )
    elif component_type == "blendlink.see-through":
        component.fade_distance = float(values.get("fadeDistance", component.fade_distance))
        component.minimum_opacity = float(values.get("minOpacity", component.minimum_opacity))
        component.duration = float(values.get("duration", component.duration))
    elif component_type == "blendlink.open-url":
        component.accessibility_label = str(values.get("label", component.accessibility_label))
        component.url = str(values.get("url", component.url))
        component.new_tab = bool(values.get("newTab", component.new_tab))
    elif component_type == "blendlink.hover":
        component.hover_scale = float(values.get("scale", component.hover_scale))
        component.duration = float(values.get("duration", component.duration))
    elif component_type == "blendlink.website-surface":
        component.website_surface_name = str(
            values.get("name", component.website_surface_name)
        )
        component.website_surface_color_treatment = str(
            values.get(
                "colorTreatment", component.website_surface_color_treatment,
            )
        )
    elif component_type == "blendlink.look-at":
        component.reference_object = _scene_object_with_id(scene, values.get("targetId"))
        component.keep_up = bool(values.get("keepUp", component.keep_up))
    elif component_type == "blendlink.play-animation-on-click":
        component.accessibility_label = str(values.get("label", component.accessibility_label))
        component.animation_clip = str(values.get("clip", component.animation_clip))
        component.animation_loop = bool(values.get("loop", component.animation_loop))
    elif component_type == "blendlink.audio-source":
        component.audio_url = str(values.get("url", component.audio_url))
        component.autoplay = bool(values.get("autoplay", component.autoplay))
        component.audio_loop = bool(values.get("loop", component.audio_loop))
        component.volume = float(values.get("volume", component.volume))
        component.spatial = bool(values.get("spatial", component.spatial))
        component.min_distance = float(values.get("minDistance", component.min_distance))
        component.max_distance = float(values.get("maxDistance", component.max_distance))
    elif component_type == "blendlink.play-audio-on-click":
        component.accessibility_label = str(values.get("label", component.accessibility_label))
        component.reference_object = _scene_object_with_id(scene, values.get("sourceId"))
        component.toggle = bool(values.get("toggle", component.toggle))


def _hydrate_components(project, scene, raw_components):
    project.components.clear()
    for raw_component in raw_components or []:
        component = project.components.add()
        component.component_id = raw_component["id"]
        component.component_type = raw_component["type"]
        component.schema_version = int(raw_component["schemaVersion"])
        component.enabled = bool(raw_component["enabled"])
        target = raw_component["target"]
        if target["kind"] == "scene":
            component.target_kind = "SCENE"
            component.target_object = None
            component.target_id = ""
            component.target_name = ""
        else:
            component.target_kind = "OBJECT"
            component.target_id = str(target["objectId"])
            component.target_name = str(target.get("objectName", ""))
            component.target_object = _scene_object_with_id(scene, component.target_id)
        _hydrate_component_values(component, raw_component["values"], scene)
    project.component_index = 0


def load_legacy_recipe(scene) -> bool:
    """Hydrate native controls from canonical JSON.

    This deliberately replaces already-configured RNA when the embedded JSON
    differs. The JSON is the portable source of truth; otherwise an external
    migration or a newer Blendlink install can be silently overwritten by
    stale native controls on the next save.
    """
    global _loading_recipe
    project = scene.blendlink_project
    raw = scene.get(RECIPE_PROPERTY)
    if not isinstance(raw, str):
        return False
    try:
        recipe = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return False
    if not isinstance(recipe, dict) or recipe.get("schemaVersion") != RECIPE_SCHEMA_VERSION:
        return False
    presentation = recipe.get("presentation", "hybrid")
    raw_atlases = recipe.get("atlases")
    if presentation not in {"hybrid", "realtime", "baked"}:
        return False
    if not isinstance(raw_atlases, list) or not raw_atlases \
            or not isinstance(raw_atlases[0], dict) or raw_atlases[0].get("id") != "main":
        return False
    error = _validate_legacy_recipe_payload(recipe, scene)
    if error:
        if project.recipe_error != error:
            print(f"BLENDLINK_RECIPE_ERROR {error}")
        project.recipe_error = error
        return False
    project.recipe_error = ""
    _loading_recipe = True
    try:
        project.configured = True
        project.presentation = presentation.upper()
        preview = recipe.get("preview") or {}
        final = recipe.get("final") or {}
        project.preview_samples = int(preview.get("samples", 16))
        project.preview_scale = float(preview.get("resolutionScale", 0.25))
        project.final_samples = int(final.get("samples", 128))
        project.final_supersample = int(final.get("supersample", 2))
        project.final_denoise = bool(final.get("denoise", True))
        project.atlases.clear()
        for raw_atlas in raw_atlases:
            if not isinstance(raw_atlas, dict):
                continue
            atlas = project.atlases.add()
            atlas.atlas_id = str(raw_atlas.get("id", "atlas"))
            atlas.name = str(raw_atlas.get("name", atlas.atlas_id))
            atlas.size = int(raw_atlas.get("size", 2048))
            atlas.target_density = float(raw_atlas.get("targetDensity", 256))
            atlas.margin = int(raw_atlas.get("margin", 48))
            atlas.fit_policy = "SCALE" if raw_atlas.get("fitPolicy") == "scale" else "BLOCK"
            # Missing values are pre-lightmap recipes whose Combined bake
            # flattened the visible material and lighting into one texture.
            # Every other value passed the recipe validator above; an
            # exhaustive mapping (instead of the old two-way ternary that
            # silently rewrote unknowns as APPEARANCE) makes validator
            # drift a loud KeyError here rather than a flattened bake.
            atlas.bake_output = {
                None: "APPEARANCE",
                "lighting": "LIGHTING",
                "appearance": "APPEARANCE",
                "material": "MATERIAL",
            }[raw_atlas.get("bakeOutput")]
        project.states.clear()
        for raw_state in recipe.get("states") or [{"name": "default"}]:
            state = project.states.add()
            state.name = str(raw_state.get("name", "state"))
            set_hidden_collection_names(state, raw_state.get("hideCollections") or [])
        camera = recipe.get("camera")
        project.main_camera = None
        project.camera_target = None
        project.animation_sequence_enabled = False
        project.animation_sequence_source = None
        project.animation_sequence_track = ""
        project.camera_behavior = "FIXED"
        project.camera_framing = "AUTHORED"
        project.compositions.clear()
        playback = recipe.get("playback") or {}
        start = str(playback.get("start", "manual")).upper()
        project.animation_start = start if start in {"MANUAL", "FIRST", "NAMED", "ALL"} else "MANUAL"
        project.animation_clip = str(playback.get("clip", ""))
        loop = str(playback.get("loop", "repeat")).upper()
        project.animation_loop = loop if loop in {"ONCE", "REPEAT", "PINGPONG"} else "REPEAT"
        project.animation_speed = float(playback.get("speed", 1.0))
        sequence = recipe.get("animationSequence")
        project.animation_sequence_enabled = isinstance(sequence, dict)
        project.animation_sequence_name = (
            str(sequence.get("name", "Website Sequence"))
            if isinstance(sequence, dict) else "Website Sequence"
        )
        project.animation_sequence_source = None
        project.animation_sequence_track = ""
        project.animation_sequence_loop = False
        project.animation_sequence_speed = 1.0
        project.animation_sequence_easing = "EASE_IN_OUT"
        if isinstance(sequence, dict):
            source = sequence.get("source") or {}
            source_id = source.get("objectId") if isinstance(source, dict) else None
            project.animation_sequence_source = _scene_object_with_id(scene, source_id)
            project.animation_sequence_track = str(source.get("track", ""))
            project.animation_sequence_loop = bool(sequence.get("loop", False))
            project.animation_sequence_speed = float(sequence.get("speed", 1.0))
            strips = sequence.get("strips") or []
            easing = str(strips[0].get("easing", "ease-in-out")).upper().replace("-", "_")
            project.animation_sequence_easing = (
                easing if easing in nla_sequence.PORTABLE_EASING else "EASE_IN_OUT"
            )
        look = recipe.get("look") or {}
        tone_mapping = str(look.get("toneMapping", "application")).upper()
        project.tone_mapping = (
            tone_mapping if tone_mapping in {"APPLICATION", "AGX", "NEUTRAL", "ACES", "NONE"}
            else "APPLICATION"
        )
        project.look_exposure = float(look.get("exposure", 0.0))
        background = str(look.get("background", "application")).upper()
        project.background_mode = (
            background if background in {"APPLICATION", "TRANSPARENT", "COLOR"}
            else "APPLICATION"
        )
        background_color = look.get("backgroundColor")
        if isinstance(background_color, list) and len(background_color) == 3:
            project.background_color = tuple(float(value) for value in background_color)
        fog = recipe.get("fog") or {}
        fog_mode = str(fog.get("mode", "application")).upper()
        project.fog_mode = fog_mode if fog_mode in {
            "APPLICATION", "NONE", "LINEAR", "EXPONENTIAL"
        } else "APPLICATION"
        fog_color = fog.get("color")
        if isinstance(fog_color, list) and len(fog_color) == 3:
            project.fog_color = tuple(float(value) for value in fog_color)
        project.fog_near = float(fog.get("near", 10.0))
        project.fog_far = float(fog.get("far", 100.0))
        project.fog_density = float(fog.get("density", 0.02))
        shadows = recipe.get("shadows") or {}
        shadow_preset = str(shadows.get("preset", "application")).upper()
        project.shadow_preset = shadow_preset if shadow_preset in {
            "APPLICATION", "OFF", "PERFORMANCE", "BALANCED", "SOFT", "CRISP", "CUSTOM"
        } else "APPLICATION"
        shadow_filter = str(shadows.get("filter", "pcf")).upper()
        project.shadow_filter = shadow_filter if shadow_filter in {"BASIC", "PCF", "VSM"} else "PCF"
        project.shadow_map_size = int(shadows.get("mapSize", 1024))
        project.shadow_max_distance = float(shadows.get("maxDistance", 50.0))
        project.shadow_bias = float(shadows.get("bias", -0.0005))
        project.shadow_normal_bias = float(shadows.get("normalBias", 0.02))
        project.shadow_radius = float(shadows.get("radius", 1.0))
        project.shadow_auto_update = bool(shadows.get("autoUpdate", True))
        environment = recipe.get("environment") or {}
        environment_source = str(environment.get("source", "application")).upper()
        project.environment_source = environment_source if environment_source in {"APPLICATION", "IMAGE"} else "APPLICATION"
        image_name = environment.get("imageName")
        project.environment_image = bpy.data.images.get(image_name) if isinstance(image_name, str) else None
        environment_lighting = str(environment.get("lighting", "application")).upper()
        project.environment_lighting = environment_lighting if environment_lighting in {
            "APPLICATION", "IMAGE", "NONE"
        } else "APPLICATION"
        environment_background = str(environment.get("background", "application")).upper()
        project.environment_background = environment_background if environment_background in {
            "APPLICATION", "IMAGE", "GROUNDED", "NONE"
        } else "APPLICATION"
        project.environment_lighting_intensity = float(environment.get("lightingIntensity", 1.0))
        project.environment_lighting_rotation = float(environment.get("lightingRotation", 0.0)) * 3.141592653589793 / 180.0
        project.environment_background_intensity = float(environment.get("backgroundIntensity", 1.0))
        project.environment_background_rotation = float(environment.get("backgroundRotation", 0.0)) * 3.141592653589793 / 180.0
        project.environment_background_blur = float(environment.get("backgroundBlur", 0.0))
        project.environment_ground_height = float(environment.get("groundHeight", 2.0))
        project.environment_ground_radius = float(environment.get("groundRadius", 100.0))
        project.reflection_probes.clear()
        for raw_probe in recipe.get("reflectionProbes") or []:
            if not isinstance(raw_probe, dict):
                continue
            probe = project.reflection_probes.add()
            probe.name = str(raw_probe.get("name", "Reflection Probe"))
            probe.object_id = str(raw_probe.get("objectId", ""))
            probe.probe_object = next(
                (obj for obj in scene.objects if obj.get("blendlink_id") == probe.object_id
                 and obj.type == "EMPTY"),
                None,
            )
            shape = str(raw_probe.get("shape", "box")).upper()
            probe.shape = shape if shape in {"BOX", "SPHERE"} else "BOX"
            source = str(raw_probe.get("source", "runtime")).upper()
            probe.capture_mode = source if source in {"RUNTIME", "BAKED", "CUSTOM"} else "RUNTIME"
            resolution = str(raw_probe.get("resolution", 256))
            probe.resolution = resolution if resolution in {
                "64", "128", "256", "512", "1024", "2048"
            } else "256"
            probe.samples = int(raw_probe.get("samples", 128))
            probe.influence = float(raw_probe.get("influence", 5.0))
            probe.intensity = float(raw_probe.get("intensity", 1.0))
            texture = raw_probe.get("texture") or {}
            image_name = texture.get("imageName") if isinstance(texture, dict) else None
            image = bpy.data.images.get(image_name) if isinstance(image_name, str) else None
            if probe.capture_mode == "CUSTOM":
                probe.custom_image = image
            elif probe.capture_mode == "BAKED":
                probe.baked_image = image
                probe.baked_source_hash = str(texture.get("sourceHash", ""))
                probe.baked_content_hash = str(texture.get("contentHash", ""))
                probe.baked_width = int(texture.get("width", 0))
                probe.baked_height = int(texture.get("height", 0))
                if image is not None:
                    raw_path = str(getattr(image, "filepath", "") or "")
                    if raw_path.replace("\\", "/").startswith("//blendlink-derived/reflection-probes/"):
                        probe.derived_asset_path = raw_path.replace("\\", "/")
            anchor_id = raw_probe.get("anchorId")
            probe.anchor = next(
                (obj for obj in scene.objects if obj.get("blendlink_id") == anchor_id),
                None,
            )
        project.reflection_probe_index = 0
        _hydrate_components(project, scene, recipe.get("components"))
        optimization = recipe.get("optimization") or {}
        project.geometry_optimization = (
            "MESHOPT" if optimization.get("geometry") == "meshopt" else "NONE"
        )
        project.texture_optimization = (
            "KTX2" if optimization.get("textures") == "ktx2" else "NONE"
        )
        if isinstance(camera, dict):
            camera_id = camera.get("objectId")
            target_id = camera.get("targetId")
            project.main_camera = next(
                (obj for obj in scene.objects if obj.get("blendlink_id") == camera_id and obj.type == "CAMERA"),
                None,
            )
            project.camera_target = next(
                (obj for obj in scene.objects if obj.get("blendlink_id") == target_id),
                None,
            )
            behavior = str(camera.get("behavior", "fixed")).upper()
            project.camera_behavior = behavior if behavior in {"FIXED", "ORBIT", "FREE"} else "FIXED"
            framing = str(camera.get("framing", "authored")).upper().replace("-", "_")
            project.camera_framing = framing if framing in {
                "AUTHORED", "FIT_SCENE", "FIT_TARGET"
            } else "AUTHORED"
            for raw_frame in camera.get("compositions") or []:
                if not isinstance(raw_frame, dict):
                    continue
                frame = project.compositions.add()
                frame.name = str(raw_frame.get("name", "Frame"))
                frame.width = int(raw_frame.get("width", 1440))
                frame.height = int(raw_frame.get("height", 900))
                frame.safe_margin = float(raw_frame.get("safeMargin", 0.08))
        else:
            desktop = project.compositions.add()
            desktop.name, desktop.width, desktop.height, desktop.safe_margin = "Desktop", 1440, 900, 0.08
            mobile = project.compositions.add()
            mobile.name, mobile.width, mobile.height, mobile.safe_margin = "Mobile", 390, 844, 0.08
    except (AttributeError, TypeError, ValueError, OverflowError) as error:
        # Hydration is transactional from the artist's point of view. Invalid
        # embedded data must never leave `configured` true: save_pre would then
        # serialize the partial RNA state over the original recipe.
        project.configured = False
        project.atlases.clear()
        project.states.clear()
        project.compositions.clear()
        project.reflection_probes.clear()
        project.components.clear()
        project.atlas_index = 0
        project.state_index = 0
        project.composition_index = 0
        project.reflection_probe_index = 0
        project.component_index = 0
        project.main_camera = None
        project.camera_target = None
        message = f"Embedded settings contain an invalid value: {type(error).__name__}: {error}"
        project.recipe_error = message
        print(f"BLENDLINK_RECIPE_ERROR {message}")
        return False
    finally:
        _loading_recipe = False
    from . import handlers
    handlers.mark_bake_table_changed()
    return len(project.atlases) > 0


def session(context) -> BlendlinkSessionSettings:
    return context.window_manager.blendlink


def register_pointers():
    bpy.types.Scene.blendlink_project = bpy.props.PointerProperty(type=BlendlinkProjectSettings)
    bpy.types.WindowManager.blendlink = bpy.props.PointerProperty(type=BlendlinkSessionSettings)


def unregister_pointers():
    del bpy.types.Scene.blendlink_project
    del bpy.types.WindowManager.blendlink


classes = (
    BlendlinkAtlasSettings,
    BlendlinkStateSettings,
    BlendlinkCompositionSettings,
    BlendlinkReflectionProbeSettings,
    BlendlinkComponentSettings,
    BlendlinkProjectSettings,
    BlendlinkBakeRow,
    BlendlinkCheckRow,
    BlendlinkSessionSettings,
)
