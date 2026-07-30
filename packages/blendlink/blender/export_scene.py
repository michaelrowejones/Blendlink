# SPDX-License-Identifier: GPL-3.0-or-later
#
# blendlink export script. This file imports bpy and is therefore licensed
# GPL-3.0-or-later, unlike the rest of the blendlink package (MIT). It runs
# inside the user's Blender via:
#
#   blender -b <file.blend> --factory-startup --python-exit-code 13 \
#     --python export_scene.py -- <out.glb> <settings.json> <result.json>
#
# Contract with the Node invoker:
# - The ONLY trusted outputs are the process exit code, the result JSON file,
#   and the single sentinel line "BLENDLINK_OK <sha-unused>" on stdout.
# - Unknown exporter kwargs are dropped via RNA introspection and reported in
#   the result JSON (the glTF exporter's signature churns across versions;
#   passing a stale kwarg raises TypeError and aborts the export).

import hashlib
import json
import math
import os
import re
import shutil
import struct
import sys
import time

import bmesh
import bpy

# Shared bake primitives live in bakelib.py beside this script — the ONE
# home for logic external pipelines also import. Never inline a copy here.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib  # noqa: E402
try:
    import glblib  # noqa: E402
    import material_compiler  # noqa: E402
    import nla_sequence  # noqa: E402
    import probe_authoring  # noqa: E402
    import procedural  # noqa: E402
    import tsl_ir  # noqa: E402
    import weblights  # noqa: E402
except ModuleNotFoundError:
    # Source-tree convenience. Published builds place the canonical addon
    # module beside this script in dist/blender.
    addon_source = os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "..", "blender-addon",
    ))
    sys.path.insert(0, addon_source)
    import glblib  # noqa: E402
    import material_compiler  # noqa: E402
    import nla_sequence  # noqa: E402
    import probe_authoring  # noqa: E402
    import procedural  # noqa: E402
    import tsl_ir  # noqa: E402
    import weblights  # noqa: E402


def artifact_filename_token(value: str) -> str:
    """Cross-platform, traversal-proof token for an artist-facing label.

    Display names remain manifest keys. The hash makes punctuation/unicode
    normalization collision-free while the bounded ASCII stem keeps files
    recognizable in Finder/Explorer.
    """
    label = str(value)
    stem = re.sub(r"[^A-Za-z0-9]+", "-", label).strip("-").lower()[:48] or "unnamed"
    return f"{stem}-{hashlib.sha256(label.encode('utf8')).hexdigest()[:8]}"

progress = bakelib.progress
quantize_half_pow2 = bakelib.quantize_half_pow2
save_dithered = bakelib.save_dithered
save_denoised = bakelib.save_denoised
save_resolved = bakelib.save_resolved
image_coverage = bakelib.image_coverage
flatten_saved_background = bakelib.flatten_saved_background

RECIPE_PROPERTY = "blendlink_recipe"
RECIPE_SCHEMA_VERSION = 1

GLB_JSON_CHUNK = glblib.GLB_JSON_CHUNK
BLENDER_DEFAULT_MATERIAL_MARKER = "blender-default-material"


def _read_glb_document(path: str, purpose: str):
    """Compatibility seam for tests and existing normalization passes."""
    return glblib.read_document(path, purpose)


def _write_glb_document(
    path: str, document: dict, chunks: list, json_index: int, purpose: str,
) -> None:
    """Compatibility seam for tests and existing normalization passes."""
    glblib.write_document(path, document, chunks, json_index, purpose)


def _scaled_atlas_size(size: int, scale: float) -> int:
    """Power-of-two profile size with a readable Preview floor.

    Never upscale beyond the artist's Final size, but avoid reducing a small
    atlas below 256px where full-window previews become visually misleading.
    """
    requested = max(128, min(8192, int(size * scale)))
    readable_floor = min(size, 256)
    value = max(readable_floor, requested)
    return min(size, 2 ** round(math.log2(value)))


def _scaled_atlas_margin(margin: int, scale: float) -> int:
    """Keep artist-authored pixel padding proportional to quality size."""
    if margin <= 0:
        return 0
    return max(1, int(math.floor(margin * scale + 0.5)))


def _website_surface_uv0_error(mesh) -> str | None:
    """Validate UV0 without importing the optional authoring add-on."""
    if not mesh.uv_layers or len(mesh.uv_layers[0].data) != len(mesh.loops):
        return (
            "Open the UV Editing workspace, unwrap this dedicated surface, "
            "then fit UV0 to the full 0-1 square."
        )
    coordinates = [
        (float(item.uv[0]), float(item.uv[1]))
        for item in mesh.uv_layers[0].data
    ]
    if not coordinates or any(
        not math.isfinite(value)
        for coordinate in coordinates
        for value in coordinate
    ):
        return (
            "UV0 contains non-finite coordinates. In the UV Editor, select all "
            "screen faces, unwrap again, then fit them to the full 0-1 square."
        )
    minimum_u = min(coordinate[0] for coordinate in coordinates)
    maximum_u = max(coordinate[0] for coordinate in coordinates)
    minimum_v = min(coordinate[1] for coordinate in coordinates)
    maximum_v = max(coordinate[1] for coordinate in coordinates)
    collapsed_axes = [
        axis for axis, minimum, maximum in (
            ("U", minimum_u, maximum_u),
            ("V", minimum_v, maximum_v),
        )
        if maximum - minimum <= 1e-6
    ]
    if collapsed_axes:
        return (
            f"UV0 is collapsed in {' and '.join(collapsed_axes)}. In the UV Editor, "
            "select all screen faces, unwrap again, then fit them to the full "
            "0-1 square."
        )
    if minimum_u < -1e-5 or minimum_v < -1e-5 \
            or maximum_u > 1.0 + 1e-5 or maximum_v > 1.0 + 1e-5:
        return (
            "UV0 leaves the ordinary 0-1 square, which would repeat or clamp "
            "application pixels. In the UV Editor, select all screen faces and "
            "fit them inside the full 0-1 square."
        )
    if minimum_u > 1e-4 or minimum_v > 1e-4 \
            or maximum_u < 1.0 - 1e-4 or maximum_v < 1.0 - 1e-4:
        return (
            "UV0 does not span the full 0-1 square, so application pixels would "
            "be cropped. In the UV Editor, select all screen faces and scale the "
            "UV bounds to the complete square."
        )
    mesh.calc_loop_triangles()
    uv0 = mesh.uv_layers[0]
    uv_area = 0.0
    for triangle in mesh.loop_triangles:
        a, b, c = (
            tuple(uv0.data[loop_index].uv)
            for loop_index in triangle.loops
        )
        uv_area += 0.5 * abs(
            (b[0] - a[0]) * (c[1] - a[1])
            - (b[1] - a[1]) * (c[0] - a[0])
        )
    if uv_area <= 1e-10:
        return (
            "UV0 has no usable texture area; every renderable triangle is "
            "collapsed in UV space. In the UV Editor, select all screen faces "
            "and unwrap them so the triangles fill the 0-1 square with visible area."
        )
    return None


def validate_website_surface_components(recipe: dict, scene) -> None:
    """Refuse Website Surfaces the runtime cannot own safely.

    The add-on validates the same contract while the artist edits the scene,
    but publish also runs without the add-on being enabled.  Keep this
    compiler-side guard independent of add-on RNA so stale recipe JSON cannot
    turn into a missing or partly configured browser surface.
    """
    components = recipe.get("components", [])
    if not isinstance(components, list):
        raise SystemExit("web presentation components must be a list")

    surface_names = set()
    for index, component in enumerate(components):
        if not isinstance(component, dict) \
                or component.get("type") != "blendlink.website-surface":
            continue
        values = component.get("values")
        if not isinstance(values, dict):
            raise SystemExit(f"Website Surface {index + 1} values must be an object")
        name = values.get("name")
        if not isinstance(name, str) or len(name) > 64 \
                or re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", name) is None:
            raise SystemExit(
                f"Website Surface {index + 1} name must be lowercase kebab-case "
                "(for example 'monitor-screen')"
            )
        if name in surface_names:
            raise SystemExit(f"Website Surface name {name!r} is used more than once")
        surface_names.add(name)
        treatment = values.get("colorTreatment", "display")
        if treatment not in {"display", "surface"}:
            raise SystemExit(
                f"Website Surface {name!r} colorTreatment must be display or surface"
            )

        # Disabled records remain round-trippable authoring data and do not
        # install at runtime, matching the add-on's validation boundary.
        if component.get("enabled") is False:
            continue
        target = component.get("target")
        object_id = target.get("objectId") if isinstance(target, dict) \
            and target.get("kind") == "object" else None
        if not isinstance(object_id, str) or not object_id.strip():
            raise SystemExit(f"Website Surface {name!r} needs a stable Mesh target")
        matches = [obj for obj in scene.objects if obj.get("blendlink_id") == object_id]
        if len(matches) != 1:
            raise SystemExit(
                f"Website Surface {name!r} target no longer resolves to exactly one "
                "Blender object; reassign it in Web Behaviors"
            )
        obj = matches[0]
        if obj.type != "MESH":
            raise SystemExit(f"Website Surface {name!r} needs a Mesh target")
        if not bool(obj.get("blendlink_dynamic", False)):
            raise SystemExit(
                f"Website Surface {name!r} on {obj.name!r} must be Realtime; "
                "choose Realtime in Blendlink's Object controls"
            )
        if len(obj.data.materials) != 1 or obj.data.materials[0] is None:
            raise SystemExit(
                f"Website Surface {name!r} on {obj.name!r} needs exactly one material; "
                "separate the screen faces into a dedicated mesh"
            )
        if not obj.data.polygons:
            raise SystemExit(
                f"Website Surface {name!r} on {obj.name!r} has no renderable faces"
            )
        if any(polygon.material_index != 0 for polygon in obj.data.polygons):
            raise SystemExit(
                f"Website Surface {name!r} on {obj.name!r} uses more than one material binding"
            )
        uv0_error = _website_surface_uv0_error(obj.data)
        if uv0_error is not None:
            raise SystemExit(
                f"Website Surface {name!r} on {obj.name!r}: {uv0_error}"
            )


def resolve_scene_recipe(config_settings: dict) -> tuple[dict, dict | None]:
    """Let the .blend own presentation intent while config owns integration.

    Older files without a recipe retain their config-driven behavior. A file
    that does contain a recipe is validated loudly; silently falling back to
    config would make Blender's visible controls lie to the artist.
    """
    raw = bpy.context.scene.get(RECIPE_PROPERTY)
    if raw is None:
        return config_settings, None
    if not isinstance(raw, str):
        raise SystemExit(f"{RECIPE_PROPERTY} must be JSON text; run Set Up Blendlink Scene again")
    try:
        recipe = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise SystemExit(f"invalid {RECIPE_PROPERTY}: {error}") from error
    if not isinstance(recipe, dict):
        raise SystemExit(f"{RECIPE_PROPERTY} must contain an object")
    if recipe.get("schemaVersion") != RECIPE_SCHEMA_VERSION:
        raise SystemExit(
            f"{RECIPE_PROPERTY} schemaVersion {recipe.get('schemaVersion')!r} is not "
            f"supported; expected {RECIPE_SCHEMA_VERSION}"
        )
    presentation = recipe.get("presentation")
    if presentation not in {"hybrid", "realtime", "baked"}:
        raise SystemExit("web presentation must be hybrid, realtime, or baked")
    raw_atlases = recipe.get("atlases")
    if not isinstance(raw_atlases, list) or not raw_atlases:
        raise SystemExit("web presentation must contain the Main atlas")
    if not isinstance(raw_atlases[0], dict) or raw_atlases[0].get("id") != "main":
        raise SystemExit("the first web atlas must be the undeletable 'main' atlas")
    validate_website_surface_components(recipe, bpy.context.scene)
    ids = set()
    for index, atlas in enumerate(raw_atlases):
        if not isinstance(atlas, dict):
            raise SystemExit(f"web atlas {index + 1} must be an object")
        atlas_id = atlas.get("id")
        if not isinstance(atlas_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", atlas_id):
            raise SystemExit(f"web atlas {index + 1} has invalid id {atlas_id!r}")
        if atlas_id in ids:
            raise SystemExit(f"duplicate web atlas id {atlas_id!r}")
        ids.add(atlas_id)
        size = atlas.get("size")
        density = atlas.get("targetDensity")
        margin = atlas.get("margin")
        if not isinstance(size, (int, float)) or not 128 <= size <= 8192:
            raise SystemExit(f"web atlas {atlas_id!r} size must be 128..8192")
        if not isinstance(density, (int, float)) or not 1 <= density <= 8192:
            raise SystemExit(f"web atlas {atlas_id!r} targetDensity must be 1..8192")
        if not isinstance(margin, (int, float)) or not 0 <= margin <= 256:
            raise SystemExit(f"web atlas {atlas_id!r} margin must be 0..256")
        if atlas.get("fitPolicy") not in {"block", "scale"}:
            raise SystemExit(f"web atlas {atlas_id!r} fitPolicy must be block or scale")
        bake_output = atlas.get("bakeOutput")
        if bake_output is not None and bake_output not in {"appearance", "lighting"}:
            raise SystemExit(
                f"web atlas {atlas_id!r} bakeOutput must be appearance or lighting"
            )

    quality_name = "preview" if config_settings.get("draft") else "final"
    quality = recipe.get(quality_name)
    if not isinstance(quality, dict):
        raise SystemExit(f"web presentation is missing its {quality_name} quality profile")
    samples = quality.get("samples")
    supersample = quality.get("supersample")
    if not isinstance(samples, (int, float)) or not 1 <= samples <= 16384:
        raise SystemExit(f"{quality_name}.samples must be 1..16384")
    if not isinstance(supersample, (int, float)) or not 1 <= supersample <= 4:
        raise SystemExit(f"{quality_name}.supersample must be 1..4")
    if not isinstance(quality.get("denoise"), bool):
        raise SystemExit(f"{quality_name}.denoise must be true or false")
    scale = float(quality.get("resolutionScale", 1.0))
    if not 0.0625 <= scale <= 1.0:
        raise SystemExit(f"{quality_name}.resolutionScale must be 0.0625..1")

    states = recipe.get("states") or [{"name": "default"}]
    if not isinstance(states, list):
        raise SystemExit("web presentation states must be a list")
    state_names = set()
    for index, state in enumerate(states):
        if not isinstance(state, dict) or not isinstance(state.get("name"), str) or not state["name"].strip():
            raise SystemExit(f"lighting state {index + 1} needs a name")
        if state["name"] in state_names:
            raise SystemExit(f"duplicate lighting state {state['name']!r}")
        state_names.add(state["name"])
        hidden = state.get("hideCollections", [])
        if not isinstance(hidden, list) or not all(isinstance(name, str) for name in hidden):
            raise SystemExit(f"lighting state {state['name']!r} hideCollections must contain names")
        if any(not name.strip() for name in hidden):
            raise SystemExit(f"lighting state {state['name']!r} contains an empty collection name")
        if len(hidden) != len(set(hidden)):
            raise SystemExit(f"lighting state {state['name']!r} hides the same collection more than once")
        missing = [name for name in hidden if bpy.data.collections.get(name) is None]
        if missing:
            raise SystemExit(
                f"lighting state {state['name']!r} references missing/renamed collection(s): "
                + ", ".join(repr(name) for name in missing)
            )

    try:
        nla_sequence.validate_published_sequence(
            recipe.get("animationSequence"), bpy.context.scene,
        )
    except ValueError as error:
        raise SystemExit(f"Animation Sequence is invalid: {error}") from error

    optimization = recipe.get("optimization", {"geometry": "none"})
    if not isinstance(optimization, dict) \
            or optimization.get("geometry") not in {"none", "meshopt"}:
        raise SystemExit("geometry optimization must be none or meshopt")

    camera = recipe.get("camera")
    presentation_camera = None
    if camera is not None:
        if not isinstance(camera, dict):
            raise SystemExit("presentation camera must be an object")
        camera_id = camera.get("objectId")
        if not isinstance(camera_id, str) or not camera_id.strip():
            raise SystemExit("presentation camera needs a stable objectId")
        matches = [obj for obj in bpy.context.scene.objects
                   if obj.get("blendlink_id") == camera_id]
        if len(matches) != 1 or matches[0].type != "CAMERA":
            raise SystemExit(
                f"presentation camera {camera.get('objectName', camera_id)!r} no longer "
                "resolves to exactly one exported Blender camera"
            )
        presentation_camera = matches[0]
        behavior = camera.get("behavior")
        if behavior not in {"fixed", "orbit", "free"}:
            raise SystemExit("presentation camera behavior must be fixed, orbit, or free")
        framing = camera.get("framing", "authored")
        if framing not in {"authored", "fit-scene", "fit-target"}:
            raise SystemExit("presentation camera framing must be authored, fit-scene, or fit-target")
        target_id = camera.get("targetId")
        if behavior == "orbit" and not isinstance(target_id, str):
            raise SystemExit("orbit presentation camera needs a target object")
        if framing == "fit-target" and not isinstance(target_id, str):
            raise SystemExit("fit-target presentation camera needs a target object")
        if target_id is not None:
            targets = [obj for obj in bpy.context.scene.objects
                       if obj.get("blendlink_id") == target_id]
            if len(targets) != 1:
                raise SystemExit("presentation camera target no longer resolves to one object")
        compositions = camera.get("compositions")
        if not isinstance(compositions, list) or not compositions:
            raise SystemExit("presentation camera needs at least one responsive composition")
        composition_names = set()
        for index, frame in enumerate(compositions):
            if not isinstance(frame, dict):
                raise SystemExit(f"camera composition {index + 1} must be an object")
            name = frame.get("name")
            if not isinstance(name, str) or not name.strip():
                raise SystemExit(f"camera composition {index + 1} needs a name")
            if name in composition_names:
                raise SystemExit(f"duplicate camera composition {name!r}")
            composition_names.add(name)
            width, height, safe = frame.get("width"), frame.get("height"), frame.get("safeMargin")
            if not isinstance(width, (int, float)) or not 1 <= width <= 16384:
                raise SystemExit(f"camera composition {name!r} width must be 1..16384")
            if not isinstance(height, (int, float)) or not 1 <= height <= 16384:
                raise SystemExit(f"camera composition {name!r} height must be 1..16384")
            if not isinstance(safe, (int, float)) or not 0 <= safe <= 0.45:
                raise SystemExit(f"camera composition {name!r} safeMargin must be 0..0.45")

    fog = recipe.get("fog")
    if fog is not None:
        if not isinstance(fog, dict):
            raise SystemExit("distance fog must be an object")
        if fog.get("mode") not in {"application", "none", "linear", "exponential"}:
            raise SystemExit("distance fog mode must be application, none, linear, or exponential")
        color = fog.get("color")
        if not isinstance(color, list) or len(color) != 3 \
                or not all(isinstance(value, (int, float)) and 0 <= value <= 1 for value in color):
            raise SystemExit("distance fog color must contain three linear RGB values from 0..1")
        near, far, density = fog.get("near"), fog.get("far"), fog.get("density")
        if not isinstance(near, (int, float)) or not 0 <= near <= 1000000:
            raise SystemExit("distance fog near must be 0..1000000")
        if not isinstance(far, (int, float)) or not 0.001 <= far <= 1000000:
            raise SystemExit("distance fog far must be 0.001..1000000")
        if far <= near:
            raise SystemExit("distance fog far must exceed near")
        if not isinstance(density, (int, float)) or not 0.000001 <= density <= 100:
            raise SystemExit("distance fog density must be 0.000001..100")

    shadows = recipe.get("shadows")
    if shadows is not None:
        if not isinstance(shadows, dict):
            raise SystemExit("realtime shadows must be an object")
        if shadows.get("preset") not in {
                "application", "off", "performance", "balanced", "soft", "crisp", "custom"}:
            raise SystemExit("realtime shadow preset is not supported")
        if shadows.get("filter") not in {"basic", "pcf", "vsm"}:
            raise SystemExit("realtime shadow filter must be basic, pcf, or vsm")
        shadow_ranges = {
            "mapSize": (128, 8192), "maxDistance": (0.1, 100000),
            "bias": (-0.1, 0.1), "normalBias": (0, 10), "radius": (0, 32),
        }
        for key, (minimum, maximum) in shadow_ranges.items():
            value = shadows.get(key)
            if not isinstance(value, (int, float)) or not minimum <= value <= maximum:
                raise SystemExit(f"realtime shadows {key} must be {minimum}..{maximum}")
        if not isinstance(shadows.get("autoUpdate"), bool):
            raise SystemExit("realtime shadows autoUpdate must be true or false")

    environment = recipe.get("environment")
    if environment is not None:
        if not isinstance(environment, dict):
            raise SystemExit("HDR environment must be an object")
        source = environment.get("source")
        lighting = environment.get("lighting")
        background = environment.get("background")
        if source not in {"application", "image"}:
            raise SystemExit("HDR environment source must be application or image")
        if lighting not in {"application", "image", "none"}:
            raise SystemExit("HDR environment lighting must be application, image, or none")
        if background not in {"application", "image", "grounded", "none"}:
            raise SystemExit("HDR environment background must be application, image, grounded, or none")
        image_name = environment.get("imageName")
        if source == "image":
            if not isinstance(image_name, str) or not image_name.strip():
                raise SystemExit("published HDR environment needs a Blender image")
            if bpy.data.images.get(image_name) is None:
                raise SystemExit(f"HDR environment image {image_name!r} no longer exists")
        if source != "image" and (lighting == "image" or background in {"image", "grounded"}):
            raise SystemExit("choose a published HDR image before assigning environment lighting/background")
        look_background = (recipe.get("look") or {}).get("background", "application")
        if look_background != "application" and background in {"image", "grounded"}:
            raise SystemExit(
                "visible HDR background conflicts with the explicit Website Look background; "
                "choose which one owns the backdrop"
            )
        environment_ranges = {
            "lightingIntensity": (0, 100), "lightingRotation": (-360, 360),
            "backgroundIntensity": (0, 100), "backgroundRotation": (-360, 360),
            "backgroundBlur": (0, 1), "groundHeight": (0.01, 100000),
            "groundRadius": (0.01, 1000000),
        }
        for key, (minimum, maximum) in environment_ranges.items():
            value = environment.get(key)
            if not isinstance(value, (int, float)) or not minimum <= value <= maximum:
                raise SystemExit(f"HDR environment {key} must be {minimum}..{maximum}")

    reflection_probes = recipe.get("reflectionProbes", [])
    if not isinstance(reflection_probes, list):
        raise SystemExit("reflectionProbes must be a list")
    probe_ids = set()
    probe_object_ids = set()
    reflection_scene_fingerprint = None
    for index, probe in enumerate(reflection_probes):
        if not isinstance(probe, dict):
            raise SystemExit(f"reflection probe {index + 1} must be an object")
        probe_id = probe.get("id")
        if not isinstance(probe_id, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", probe_id):
            raise SystemExit(f"reflection probe {index + 1} has invalid id {probe_id!r}")
        if probe_id in probe_ids:
            raise SystemExit(f"duplicate reflection probe id {probe_id!r}")
        probe_ids.add(probe_id)
        object_id = probe.get("objectId")
        if not isinstance(object_id, str) or not object_id.strip():
            raise SystemExit(f"reflection probe {probe_id!r} needs a stable objectId")
        if object_id in probe_object_ids:
            raise SystemExit(f"duplicate reflection probe objectId {object_id!r}")
        probe_object_ids.add(object_id)
        matches = [obj for obj in bpy.context.scene.objects
                   if obj.get("blendlink_id") == object_id]
        if len(matches) != 1 or matches[0].type != "EMPTY":
            raise SystemExit(
                f"reflection probe {probe.get('name', probe_id)!r} no longer resolves "
                "to exactly one helper Empty"
            )
        helper = matches[0]
        if probe.get("shape") not in {"box", "sphere"}:
            raise SystemExit(f"reflection probe {probe_id!r} shape must be box or sphere")
        source = probe.get("source", "runtime")
        if source not in {"runtime", "baked", "custom"}:
            raise SystemExit(
                f"reflection probe {probe_id!r} source must be runtime, baked, or custom"
            )
        resolution = probe.get("resolution")
        if isinstance(resolution, bool) or not isinstance(resolution, int) \
                or not 64 <= resolution <= 2048 or resolution & (resolution - 1):
            raise SystemExit(
                f"reflection probe {probe_id!r} resolution must be a power of two from 64..2048"
            )
        samples = probe.get("samples", 128)
        if isinstance(samples, bool) or not isinstance(samples, int) or not 1 <= samples <= 16384:
            raise SystemExit(f"reflection probe {probe_id!r} samples must be 1..16384")
        influence = probe.get("influence")
        if not isinstance(influence, (int, float)) or not 0.01 <= influence <= 1000000:
            raise SystemExit(f"reflection probe {probe_id!r} influence must be 0.01..1000000")
        intensity = probe.get("intensity")
        if not isinstance(intensity, (int, float)) or not 0 <= intensity <= 100:
            raise SystemExit(f"reflection probe {probe_id!r} intensity must be 0..100")
        anchor_id = probe.get("anchorId")
        anchor = None
        if anchor_id is not None:
            anchors = [obj for obj in bpy.context.scene.objects
                       if obj.get("blendlink_id") == anchor_id]
            if len(anchors) != 1:
                raise SystemExit(
                    f"reflection probe {probe_id!r} anchor no longer resolves to one object"
                )
            anchor = anchors[0]
        texture = probe.get("texture")
        if source == "runtime":
            if texture is not None:
                raise SystemExit(
                    f"reflection probe {probe_id!r} runtime source must not declare a texture"
                )
            continue
        if not isinstance(texture, dict):
            raise SystemExit(f"reflection probe {probe_id!r} {source} source needs a texture")
        image_name = texture.get("imageName")
        if not isinstance(image_name, str) or not image_name.strip():
            raise SystemExit(f"reflection probe {probe_id!r} texture needs a Blender imageName")
        image = bpy.data.images.get(image_name)
        if image is None:
            raise SystemExit(
                f"reflection probe {probe_id!r} image {image_name!r} no longer exists"
            )
        evidence = probe_authoring.inspect_image(image)
        if not evidence.valid:
            raise SystemExit(f"reflection probe {probe_id!r}: {evidence.issue}")
        if evidence.width != texture.get("width") or evidence.height != texture.get("height"):
            raise SystemExit(
                f"reflection probe {probe_id!r} image dimensions changed to "
                f"{evidence.width}x{evidence.height}; refresh its Blender settings"
            )
        if evidence.format != texture.get("format") \
                or evidence.color_space != texture.get("colorSpace"):
            raise SystemExit(
                f"reflection probe {probe_id!r} image format/color-space evidence changed; "
                "refresh its Blender settings"
            )
        if source == "baked":
            content_hash = texture.get("contentHash")
            source_hash = texture.get("sourceHash")
            if not isinstance(content_hash, str) or re.fullmatch(
                    r"[0-9a-f]{16,64}", content_hash) is None \
                    or not isinstance(source_hash, str) or re.fullmatch(
                        r"[0-9a-f]{16,64}", source_hash) is None:
                raise SystemExit(
                    f"reflection probe {probe_id!r} has invalid Blender Bake hash evidence; "
                    "bake it again"
                )
            if evidence.content_hash != content_hash:
                raise SystemExit(
                    f"reflection probe {probe_id!r} baked bytes changed "
                    f"({evidence.content_hash}; expected {content_hash!r}); bake it again"
                )
            if reflection_scene_fingerprint is None:
                reflection_scene_fingerprint = bakelib.fingerprint_reflection_scene_dependencies(
                    bpy.context.scene, view_layer=bpy.context.view_layer,
                )
            capture = anchor or helper
            assigned_receivers = tuple(
                obj for obj in bpy.context.scene.objects
                if obj.type == "MESH"
                and obj.get("blendlink_reflection_probe") == object_id
            )
            current_source_hash = bakelib.fingerprint_reflection_probe_dependencies(
                bpy.context.scene,
                capture.matrix_world.translation,
                resolution,
                samples,
                view_layer=bpy.context.view_layer,
                scene_fingerprint=reflection_scene_fingerprint,
                excluded_objects=assigned_receivers,
            )
            if current_source_hash != source_hash:
                raise SystemExit(
                    f"reflection probe {probe_id!r} is stale (scene {current_source_hash}; "
                    f"bake {source_hash!r}); bake it again before publishing"
                )
        elif "sourceHash" in texture or "contentHash" in texture:
            raise SystemExit(
                f"reflection probe {probe_id!r} custom hashes are derived during publish, "
                "not authored"
            )
    for obj in bpy.context.scene.objects:
        assigned_probe = obj.get("blendlink_reflection_probe")
        if assigned_probe is not None and assigned_probe not in probe_object_ids:
            raise SystemExit(
                f"object {obj.name!r} references a missing reflection probe; "
                "reassign or clear it in Blender"
            )

    # Fixed-camera opaque view inputs are a compiler decision, not per-object
    # website configuration.  It is enabled only when one authored Blender
    # camera remains the active render camera and every atlas owns complete
    # Appearance.  Mixed Lighting atlases and fitted/orbit/free cameras retain
    # the conservative Realtime policy.
    fixed_camera_appearance = bool(
        presentation_camera is not None
        and presentation_camera == bpy.context.scene.camera
        and camera.get("behavior") == "fixed"
        and camera.get("framing", "authored") == "authored"
        and all(
            atlas.get("bakeOutput", "appearance") == "appearance"
            for atlas in raw_atlases
        )
    )

    # These are the only config values allowed to affect exported art.
    effective = {
        key: config_settings[key]
        for key in (
            "collection", "imageFormat", "curveSamples", "exporterOverrides",
            "planOnly", "draft", "authoringPreview", "incremental",
        )
        if key in config_settings
    }
    if recipe.get("animationSequence") is not None:
        effective["_animationSequence"] = True
    if presentation == "realtime":
        effective["mode"] = "standard"
        return effective, recipe
    if presentation == "hybrid" and not has_bakeable_meshes(
            fixed_camera_appearance=fixed_camera_appearance):
        effective["mode"] = "standard"
        effective["_presentationWarnings"] = [
            "Realtime-only Hybrid scene: every published render mesh is set to "
            "Realtime (or otherwise excluded from baking), so Blendlink skipped "
            "atlas baking and exported the live materials."
        ]
        return effective, recipe

    preview_scale_to_fit = quality_name == "preview" and any(
        atlas["fitPolicy"] == "block" for atlas in raw_atlases
    )
    atlases = {}
    for atlas in raw_atlases:
        authored_size = int(atlas["size"])
        resolved_size = _scaled_atlas_size(authored_size, scale)
        resolved_scale = resolved_size / authored_size
        atlases[atlas["id"]] = {
            "size": resolved_size,
            # Preview deliberately spends fewer pixels. Scale the target with
            # the atlas so its capacity check answers "does this preview fit?"
            # rather than falsely enforcing Final density on a quarter-size map.
            "targetDensity": float(atlas["targetDensity"]) * resolved_scale,
            # Pixel-authored padding must shrink with Preview resolution.
            # Leaving 48px on a quarter-size atlas can make Blender's
            # fractional pack margin collapse every island to zero area.
            "margin": _scaled_atlas_margin(
                int(atlas["margin"]), resolved_scale,
            ),
            "fitPolicy": "scale" if quality_name == "preview" else atlas["fitPolicy"],
            # Compatibility is intentional: recipes written before this
            # field flattened Combined color into an unlit material.
            "bakeOutput": atlas.get("bakeOutput", "appearance"),
        }
    effective["mode"] = "baked"
    effective["bake"] = {
        "size": atlases["main"]["size"],
        "samples": int(quality.get("samples", 128)),
        "margin": atlases["main"]["margin"],
        "supersample": int(quality.get("supersample", 1)),
        "denoise": bool(quality.get("denoise", False)),
        "states": states,
        "atlases": atlases,
        **({"fixedCameraAppearance": True} if fixed_camera_appearance else {}),
        **({"previewScaleToFit": True} if preview_scale_to_fit else {}),
    }
    return effective, recipe


def parse_argv() -> tuple[str, str, str]:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 3:
        raise SystemExit("expected: -- <out.glb> <settings.json> <result.json>")
    return args[0], args[1], args[2]


def publish_environment(recipe: dict | None, out_path: str) -> dict | None:
    """Copy authored HDR bytes unchanged beside the GLB.

    This deliberately does not call Image.save(): saving would route the data
    through Blender color-management/output settings. Packed files expose the
    original payload; linked files are copied byte-for-byte.
    """
    environment = recipe.get("environment") if recipe else None
    if not isinstance(environment, dict) or environment.get("source") != "image":
        return None
    image_name = environment.get("imageName")
    image = bpy.data.images.get(image_name)
    if image is None:
        raise SystemExit(f"HDR environment image {image_name!r} no longer exists")
    raw_path = bpy.path.abspath(image.filepath, library=image.library)
    extension = os.path.splitext(raw_path)[1].lower()
    if extension not in {".hdr", ".exr"}:
        if image.file_format == "HDR":
            extension = ".hdr"
        elif image.file_format in {"OPEN_EXR", "OPEN_EXR_MULTILAYER"}:
            extension = ".exr"
        else:
            raise SystemExit(
                f"HDR environment {image.name!r} uses {image.file_format or 'an unknown format'}; "
                "choose a Radiance .hdr or OpenEXR .exr image"
            )
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", image.name).strip("-") or "environment"
    published_path = f"{out_path}.environment.{slug}{extension}"
    packed_payloads = bakelib.packed_image_payloads(image)
    if packed_payloads:
        if len(packed_payloads) != 1:
            raise SystemExit(
                f"packed HDR environment {image.name!r} has multiple views or tiles; "
                "choose one equirectangular image"
            )
        payload = packed_payloads[0][1]
        if not payload:
            raise SystemExit(f"packed HDR environment {image.name!r} contains no bytes")
        with open(published_path, "wb") as handle:
            handle.write(payload)
    else:
        if not raw_path or not os.path.isfile(raw_path):
            raise SystemExit(
                f"HDR environment {image.name!r} points to missing file {raw_path!r}; "
                "relink it or pack it into the .blend"
            )
        shutil.copyfile(raw_path, published_path)
    with open(published_path, "rb") as handle:
        content_hash = hashlib.sha256(handle.read()).hexdigest()[:16]
    return {
        "path": published_path,
        "sourceName": image.name,
        "format": extension[1:],
        "bytes": os.path.getsize(published_path),
        "hash": content_hash,
        "source": "packed" if packed_payloads else "linked",
    }


def _collect_program_image_names(value, names) -> None:
    if isinstance(value, dict):
        if value.get("op") == "texture_ref":
            image = value.get("image") or {}
            names.add(str(image.get("name")))
        for item in value.values():
            _collect_program_image_names(item, names)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_program_image_names(item, names)


_PROGRAM_IMAGE_MIME = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
}


def _publish_program_image(name: str, out_path: str) -> dict:
    """Publish one texture_ref source image beside the GLB, exact bytes."""
    image = bpy.data.images.get(name)
    if image is None:
        raise SystemExit(
            f"TSL program image {name!r} no longer exists in the file"
        )
    file_format = str(getattr(image, "file_format", "") or "")
    if file_format not in _PROGRAM_IMAGE_MIME:
        raise SystemExit(
            f"TSL program image {name!r} uses format {file_format!r}; the "
            "texture transport publishes PNG/JPEG/WebP source bytes only"
        )
    mime, extension = _PROGRAM_IMAGE_MIME[file_format]
    published_path = (
        f"{out_path}.tex.{artifact_filename_token(name)}{extension}"
    )
    packed_payloads = bakelib.packed_image_payloads(image)
    if packed_payloads:
        if len(packed_payloads) != 1:
            raise SystemExit(
                f"packed TSL program image {name!r} has multiple sources"
            )
        payload = packed_payloads[0][1]
        if not payload:
            raise SystemExit(
                f"packed TSL program image {name!r} contains no bytes"
            )
        with open(published_path, "wb") as handle:
            handle.write(payload)
    else:
        raw_path = bpy.path.abspath(image.filepath) if image.filepath else ""
        if not raw_path or not os.path.isfile(raw_path):
            raise SystemExit(
                f"TSL program image {name!r} points to missing file "
                f"{raw_path!r}; relink it or pack it into the .blend"
            )
        shutil.copyfile(raw_path, published_path)
    return {
        "path": published_path,
        "file": os.path.basename(published_path),
        "bytes": os.path.getsize(published_path),
        "hash": bakelib.file_sha256(published_path)[:16],
        "mime": mime,
        "width": int(image.size[0]),
        "height": int(image.size[1]),
        "colorSpace": str(image.colorspace_settings.name),
    }


def publish_material_programs(material_plan, out_path: str) -> dict | None:
    """Publish the per-channel TSL IR programs beside the GLB.

    This sidecar is the Phase 4 material runtime's program transport: IR
    bodies never inline into the generated module (the per-channel 256 KB
    budget exists precisely because they can be large), and tslIrHash pins
    content end to end. texture_ref source images publish as hash-pinned
    exact-byte assets beside the GLB, listed in the document's images map
    (runtime resolves the basenames against the sidecar URL). No lowered
    material with IR means no file.
    """
    if material_plan is None:
        return None
    materials = {}
    for decision in getattr(material_plan, "lowerings", ()) or ():
        channels = {}
        for item in (decision.channel_plan or {}).get("channels", ()):
            ir = item.get("tslIr")
            if not ir:
                continue
            channels[str(item.get("channel"))] = {
                "tslIr": ir,
                "tslIrHash": item.get("tslIrHash"),
                "tslIrBytes": item.get("tslIrBytes"),
            }
        if channels:
            materials[decision.material_name] = {"channels": channels}
    if not materials:
        return None
    image_names = set()
    for entry in materials.values():
        _collect_program_image_names(entry["channels"], image_names)
    images = {}
    texture_paths = []
    for name in sorted(image_names):
        published = _publish_program_image(name, out_path)
        texture_paths.append(published.pop("path"))
        images[name] = published
    document = {
        "schemaVersion": 1,
        "model": "blendlink-material-programs-v1",
        "materials": materials,
        **({"images": images} if images else {}),
    }
    published_path = f"{out_path}.materials.json"
    payload = json.dumps(
        document, sort_keys=True, separators=(",", ":"),
    ).encode("utf8")
    with open(published_path, "wb") as handle:
        handle.write(payload)
    return {
        "path": published_path,
        "bytes": len(payload),
        "hash": hashlib.sha256(payload).hexdigest()[:16],
        "materials": len(materials),
        **({"texturePaths": texture_paths} if texture_paths else {}),
    }


def publish_reflection_probe_assets(recipe: dict | None, out_path: str) -> dict:
    """Publish exact authored/baked equirectangular bytes beside the GLB.

    Runtime-capture probes intentionally produce no file. Source validation
    and baked staleness have already passed in resolve_scene_recipe(); this
    stage independently re-verifies the copied bytes so a manifest never
    points at a partial or mismatched artifact.
    """
    assets = {}
    probes = recipe.get("reflectionProbes", []) if isinstance(recipe, dict) else []
    extension_by_format = {
        "hdr": ".hdr", "exr": ".exr", "png": ".png",
        "jpeg": ".jpg", "webp": ".webp",
    }
    for probe in probes:
        source_mode = probe.get("source", "runtime")
        if source_mode == "runtime":
            continue
        probe_id = probe["id"]
        texture = probe.get("texture")
        if not isinstance(texture, dict):
            raise SystemExit(f"reflection probe {probe_id!r} needs texture evidence")
        image_name = texture.get("imageName")
        image = bpy.data.images.get(image_name)
        if image is None:
            raise SystemExit(
                f"reflection probe {probe_id!r} image {image_name!r} no longer exists"
            )
        evidence = probe_authoring.inspect_image(image)
        if not evidence.valid:
            raise SystemExit(f"reflection probe {probe_id!r}: {evidence.issue}")
        extension = extension_by_format[evidence.format]
        published_path = (
            f"{out_path}.probe.{artifact_filename_token(probe_id)}{extension}"
        )
        if evidence.source == "packed":
            packed_payloads = bakelib.packed_image_payloads(image)
            if len(packed_payloads) != 1:
                raise SystemExit(
                    f"packed reflection texture {image.name!r} no longer has exactly one source"
                )
            payload = packed_payloads[0][1]
            if not payload:
                raise SystemExit(
                    f"packed reflection texture {image.name!r} contains no bytes"
                )
            with open(published_path, "wb") as handle:
                handle.write(payload)
        else:
            if not evidence.path or not os.path.isfile(evidence.path):
                raise SystemExit(
                    f"reflection texture {image.name!r} points to missing file "
                    f"{evidence.path!r}"
                )
            shutil.copyfile(evidence.path, published_path)
        published_hash = bakelib.file_sha256(published_path)
        published_bytes = os.path.getsize(published_path)
        if published_hash != evidence.content_hash or published_bytes != evidence.bytes:
            raise RuntimeError(
                f"reflection probe {probe_id!r} publication changed source bytes "
                f"({published_hash}/{published_bytes}; expected "
                f"{evidence.content_hash}/{evidence.bytes})"
            )
        assets[probe_id] = {
            "path": published_path,
            "sourceName": image.name,
            "mode": source_mode,
            "format": evidence.format,
            "colorSpace": evidence.color_space,
            "width": evidence.width,
            "height": evidence.height,
            "bytes": published_bytes,
            "hash": published_hash,
            "source": evidence.source,
            **({"sourceHash": texture["sourceHash"]}
               if source_mode == "baked" else {}),
        }
    return assets


def missing_libraries() -> list[str]:
    return sorted(
        library.filepath
        for library in bpy.data.libraries
        if any(getattr(block, "is_missing", False) for block in library.users_id)
    )


def yup(vector) -> list[float]:
    """Blender Z-up world → glTF/three Y-up: (x, y, z) → (x, z, -y)."""
    return [round(vector[0], 6), round(vector[2], 6), round(-vector[1], 6)]


def analyze_authoring_preview_world(scene) -> tuple[dict | None, str | None]:
    """Classify constant World evidence and explain every unsupported graph.

    World shader graphs are a render program, not a background color. Guessing
    at linked inputs or intermediate nodes would make a preview look plausible
    while misrepresenting the artist's scene. A direct constant Background is
    the one node-based case whose linear radiance can cross this seam without
    interpretation. The legacy non-node World color is constant by definition.
    """
    world = scene.world
    if world is None:
        return None, None

    tree = bakelib.active_shader_node_tree(world)
    if tree is None:
        color = [float(world.color[index]) for index in range(3)]
        if not all(math.isfinite(value) for value in color):
            return None, "Blender's non-node World color is non-finite"
        return {
            "color": color,
            "strength": 1.0,
            "exact": True,
            "source": "world-color",
        }, None

    outputs = [
        node for node in tree.nodes
        if node.type == "OUTPUT_WORLD"
        and bool(getattr(node, "is_active_output", False))
        and not bool(getattr(node, "mute", False))
    ]
    if len(outputs) != 1:
        return None, (
            "Blender's World needs exactly one active, unmuted World Output "
            f"for automatic Preview lighting; found {len(outputs)}"
        )

    surface = outputs[0].inputs.get("Surface")
    if surface is None or not surface.is_linked or len(surface.links) != 1:
        return None, (
            "Blender's active World Surface is not connected through one "
            "unambiguous shader link"
        )
    background = surface.links[0].from_node
    if background.type != "BACKGROUND" or bool(getattr(background, "mute", False)):
        return None, (
            "Preview Studio only carries a direct, unmuted constant Background; "
            f"the active World uses {background.name!r}"
        )

    color_input = background.inputs.get("Color")
    strength_input = background.inputs.get("Strength")
    if color_input is None or strength_input is None:
        return None, "Blender's World Background has no portable Color/Strength inputs"
    if color_input.is_linked or strength_input.is_linked:
        linked = []
        if color_input.is_linked:
            linked.append("Color")
        if strength_input.is_linked:
            linked.append("Strength")
        return None, (
            "Preview Studio does not guess linked or procedural World inputs "
            f"({', '.join(linked)} is linked); publish an HDR environment or "
            "use a direct constant Background"
        )

    # Shader socket defaults are already scene-linear. Applying AgX, exposure,
    # or an sRGB conversion here would turn display values back into lighting
    # and make the browser illuminate the scene twice.
    color = [float(color_input.default_value[index]) for index in range(3)]
    strength = float(strength_input.default_value)
    if not all(math.isfinite(value) for value in (*color, strength)):
        return None, "Blender's World Background contains non-finite values"
    if any(value < 0 for value in (*color, strength)):
        return None, "Blender's World Background contains negative radiance"
    return {
        "color": color,
        "strength": strength,
        "exact": True,
        "source": "background",
    }, None


def collect_authoring_preview_world(scene) -> dict | None:
    """Compatibility helper returning the classified constant World only."""
    world, _reason = analyze_authoring_preview_world(scene)
    return world


def collect_authoring_preview(
    scene, published_light_objects: list | tuple | None = None, view_layer=None,
) -> dict:
    """Describe the Blender look Preview Studio can safely approximate.

    This is evidence, not a production rendering policy. Website recipes still
    own their look and shadows. Preview Studio may opt into this metadata when
    those recipe fields are application-owned so an artist's first preview
    resembles the scene they were just working on.
    """
    view = scene.view_settings
    display = scene.display_settings
    warnings = []

    # These are the closest native Three.js mappings. Khronos PBR Neutral is a
    # shared transform; Standard is the absence of tone mapping. Three's
    # built-in AgX is an older analytic approximation of Blender 5.x's current
    # OCIO AgX. A measured scalar-ramp fit improves the authoring preview
    # without changing the artist's exposure evidence or the published recipe.
    # Blender's older Filmic and Raw transforms have no exact native equivalent,
    # so keep the preview useful while saying so loudly.
    view_transform = str(view.view_transform)
    mapping = {
        "AgX": ("agx", False),
        "Khronos PBR Neutral": ("neutral", True),
        "Standard": ("none", True),
        "Filmic": ("aces", False),
        "Raw": ("none", False),
    }
    tone_mapping, exact = mapping.get(view_transform, ("none", False))
    if view_transform not in mapping:
        warnings.append(
            f"Blender view transform {view_transform!r} has no Preview Studio mapping; "
            "using no tone mapping"
        )
    elif view_transform == "AgX":
        warnings.append(
            "Three.js AgX is not identical to Blender 5.x OCIO AgX; "
            "Preview Studio applies a measured -0.28-stop calibration. "
            "Verify the final website visually"
        )
    elif not exact:
        substitute = "ACES" if tone_mapping == "aces" else "no tone mapping"
        warnings.append(
            f"Blender {view_transform} has no exact Three.js display transform; "
            f"Preview Studio uses {substitute}"
        )

    look = str(view.look)
    if look not in {"", "None"}:
        exact = False
        warnings.append(
            f"Blender look {look!r} is not reproduced by Preview Studio; "
            "choose None for the closest authoring preview"
        )

    gamma = float(view.gamma)
    if not math.isclose(gamma, 1.0, rel_tol=0.0, abs_tol=1e-6):
        exact = False
        warnings.append(
            f"Blender display gamma {gamma:g} is not reproduced by Preview Studio; "
            "using gamma 1"
        )

    display_device = str(display.display_device)
    if display_device != "sRGB":
        exact = False
        warnings.append(
            f"Blender display device {display_device!r} is not reproduced by Preview Studio; "
            "the browser uses sRGB"
        )

    if bool(getattr(view, "use_curve_mapping", False)):
        exact = False
        warnings.append(
            "Blender's display curve is not reproduced by Preview Studio; "
            "disable Use Curves or verify the final website visually"
        )

    if bool(getattr(view, "use_white_balance", False)):
        exact = False
        warnings.append(
            "Blender's display white balance is not reproduced by Preview Studio; "
            "disable White Balance or verify the final website visually"
        )

    shadow_candidates = (
        published_light_objects
        if published_light_objects is not None
        else scene.objects
    )
    shadows_enabled = any(
        obj.type == "LIGHT"
        and (
            published_light_objects is not None
            or weblights.render_visibility(
                obj, scene, view_layer=view_layer,
            ).exported
        )
        and obj.data.type in {"POINT", "SPOT", "SUN"}
        and bool(
            obj.get("blendlink_cast_shadow")
            if isinstance(obj.get("blendlink_cast_shadow"), bool)
            else getattr(obj.data, "use_shadow", False)
        )
        for obj in shadow_candidates
    )
    world, world_reason = analyze_authoring_preview_world(scene)
    world_background_visible = not bool(
        getattr(getattr(scene, "render", None), "film_transparent", False)
    )
    if world is not None:
        world = {
            **world,
            "backgroundVisible": world_background_visible,
        }
    preview = {
        "look": {
            "toneMapping": tone_mapping,
            "exposure": float(view.exposure),
            **({"previewExposureOffsetStops": -0.28}
               if view_transform == "AgX" else {}),
            "sourceViewTransform": view_transform,
            "exact": exact,
        },
        "shadows": {"enabled": shadows_enabled},
        # This remains useful when a procedural World cannot be classified:
        # Film Transparent means its unsupported background graph is not a
        # camera-visible Preview Studio dependency, even though its lighting
        # may still matter.
        "worldBackgroundVisible": world_background_visible,
        "warnings": warnings,
        **({"world": world} if world is not None else {}),
    }
    if world_reason:
        preview["worldWarning"] = "Blender World preview omitted: " + world_reason
    return preview


def authoring_preview_warning_messages(
    preview: dict, recipe: dict | None,
) -> list[str]:
    """Surface only evidence Preview Studio will actually consume.

    Explicit website look/environment ownership always wins in the runtime.
    Applying the same ownership gate in the compiler prevents a harmless
    unsupported Blender display setting or World graph from appearing as a
    false preview warning when the published recipe deliberately replaces it.
    """
    published_look = recipe.get("look") if isinstance(recipe, dict) else None
    use_look = not isinstance(published_look, dict) \
        or published_look.get("toneMapping", "application") == "application"
    messages = list(preview.get("warnings", ())) if use_look else []

    environment = recipe.get("environment") if isinstance(recipe, dict) else None
    source_owns_background = (
        preview.get("worldBackgroundVisible", True) is not False
        and
        (not isinstance(published_look, dict)
         or published_look.get("background", "application") == "application")
        and (
            not isinstance(environment, dict)
            or environment.get("background", "application") == "application"
        )
    )
    source_owns_lighting = (
        not isinstance(environment, dict)
        or (
            environment.get("source", "application") == "application"
            and environment.get("lighting", "application") == "application"
        )
    )
    world_warning = preview.get("worldWarning")
    if world_warning and (source_owns_background or source_owns_lighting):
        messages.append(world_warning)
    return messages


def evaluated_non_bezier_curve_points(
    obj, spline, matrix, depsgraph=None,
) -> list[list[float]]:
    """Sample evaluated Curve geometry without inventing a lossy fallback.

    Blender may return ``None`` for a render-enabled Curve whose modifier
    result is empty or whose linked legacy data cannot be evaluated. Raw
    spline points are not equivalent to the evaluated surface: they omit
    bevels, Geometry Nodes, and modifiers. Refuse with source context instead
    of either crashing on ``None.vertices`` or publishing misleading points.
    """
    if depsgraph is None:
        depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    if mesh is None:
        library = (
            getattr(obj, "library", None)
            or getattr(getattr(obj, "data", None), "library", None)
        )
        library_path = (
            os.path.normpath(bpy.path.abspath(library.filepath))
            if library is not None
            else "<local .blend>"
        )
        data_name = getattr(getattr(obj, "data", None), "name", "<unnamed>")
        raise SystemExit(
            f"Blendlink cannot compile render-visible Curve {obj.name!r} "
            f"(data {data_name!r}, spline type {spline.type}; source library "
            f"'{library_path}'): Blender returned no evaluated Mesh. Blendlink "
            "will not substitute raw spline points because that would discard "
            "bevels, Geometry Nodes, modifiers, or other evaluated geometry "
            "and misrepresent the artist's scene. If this Curve is "
            "intentionally empty, disable it for renders. Otherwise, repair "
            "the modifier or linked data so it evaluates, make a local "
            "website-owned copy or Library Override, or convert a "
            "website-owned copy to Mesh, then retry. Blendlink did not modify "
            "the linked source."
        )
    try:
        return [yup(matrix @ vertex.co) for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def collect_sidecar(
    settings: dict, recipe: dict | None = None,
    export_kwargs: dict | None = None,
) -> dict:
    """Blender-only data the GLB cannot carry.

    - timeline markers (scroll-scrub waypoints), scene fps
    - empty display types/sizes (collider primitives, anchor semantics)
    - curves: bezier control points + handles, or evaluated points —
      glTF has no curve primitive (spec gap open since 2018), so this is
      the data every studio re-derives with a pasted Python snippet.
    """
    scene = bpy.context.scene
    scoped_objects = diagnostic_export_objects(
        scene, view_layer=bpy.context.view_layer,
        export_kwargs=export_kwargs,
    )
    fps = scene.render.fps / scene.render.fps_base

    markers = [
        {"name": marker.name, "frame": marker.frame, "time": round(marker.frame / fps, 4)}
        for marker in scene.timeline_markers
    ]

    empties = []
    for obj in scoped_objects:
        if obj.type != "EMPTY":
            continue
        empties.append({
            "name": obj.name,
            "displayType": obj.empty_display_type,
            "size": round(obj.empty_display_size, 6),
        })

    curves = []
    sample_count = int(settings.get("curveSamples", 64))
    for obj in scoped_objects:
        if obj.type != "CURVE" or obj.hide_render:
            continue
        matrix = obj.matrix_world
        for index, spline in enumerate(obj.data.splines):
            name = obj.name if index == 0 else f"{obj.name}.{index:03d}"
            if spline.type == "BEZIER":
                points = [
                    {
                        "co": yup(matrix @ point.co),
                        "handleLeft": yup(matrix @ point.handle_left),
                        "handleRight": yup(matrix @ point.handle_right),
                    }
                    for point in spline.bezier_points
                ]
                curves.append({
                    "name": name,
                    "kind": "bezier",
                    "cyclic": spline.use_cyclic_u,
                    "points": points,
                })
            else:
                # NURBS/poly: evaluate uniformly through a temporary mesh so
                # the browser reconstructs with CatmullRom without needing
                # Blender's basis functions.
                sampled = evaluated_non_bezier_curve_points(
                    obj, spline, matrix,
                )
                if len(sampled) > sample_count:
                    step = max(1, len(sampled) // sample_count)
                    sampled = sampled[::step]
                curves.append({
                    "name": name,
                    "kind": "points",
                    "cyclic": spline.use_cyclic_u,
                    "points": sampled,
                })

    textures = []
    for image in bpy.data.images:
        if image.type in {"RENDER_RESULT", "COMPOSITING"} or image.users == 0:
            continue
        width, height = int(image.size[0]), int(image.size[1])
        max_size = image.get("blendlink_max_size")
        compression = image.get("blendlink_texture_compression")
        if compression not in {"none", "etc1s", "uastc"}:
            compression = None
        textures.append({
            "name": image.name,
            "width": width,
            "height": height,
            "colorSpace": image.colorspace_settings.name,
            **({"maxSize": int(max_size)} if isinstance(max_size, (int, float)) and max_size > 0 else {}),
            **({"compression": compression} if compression else {}),
        })

    camera_recipe = recipe.get("camera") if isinstance(recipe, dict) else None
    fixed_camera = bool(
        isinstance(camera_recipe, dict)
        and camera_recipe.get("behavior") == "fixed"
        and scene.camera is not None
        and camera_recipe.get("objectId") == scene.camera.get("blendlink_id")
    )
    light_analysis = weblights.analyze_scene(
        scene, view_layer=bpy.context.view_layer,
    )
    return {
        "fps": fps,
        **({"animationSequence": recipe["animationSequence"]}
           if isinstance(recipe, dict) and recipe.get("animationSequence") is not None
           else {}),
        "markers": markers,
        "empties": empties,
        "curves": curves,
        "textures": textures,
        "authoringPreview": collect_authoring_preview(
            scene, view_layer=bpy.context.view_layer,
        ),
        "lightDiagnostics": light_analysis.as_dict(),
        "externalDependencies": collect_external_dependencies(scoped_objects),
        "diagnostics": procedural.analyze_scene(
            scene, full=True, fixed_camera=fixed_camera,
            objects=scoped_objects,
        ),
    }


def volatile_dependency_path(path: str) -> bool:
    return any(token in path for token in ("#", "<UDIM>", "<UVTILE>")) \
        or os.path.isdir(os.path.normpath(path))


def _node_tree_closure(node_tree) -> set:
    """Return a shader/node-group tree and every nested group it reaches."""
    trees = set()
    pending = [node_tree] if node_tree is not None else []
    while pending:
        current = pending.pop()
        if current is None or current in trees:
            continue
        trees.add(current)
        for node in getattr(current, "nodes", ()):
            nested = getattr(node, "node_tree", None)
            if nested is not None and nested not in trees:
                pending.append(nested)
    return trees


def _images_in_node_trees(node_trees) -> set:
    return {
        image
        for node_tree in node_trees
        for node in getattr(node_tree, "nodes", ())
        for image in (getattr(node, "image", None),)
        if image is not None
    }


def _object_materials(objects) -> set | None:
    """Conservatively collect source and evaluated materials for export scope.

    A Geometry Nodes result can expose a material absent from the source
    object's slots. If evaluation fails, return ``None`` and disable the
    unreachable classification rather than under-reporting a dependency.
    """
    materials = set()
    try:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in objects:
            for candidate in (obj, obj.evaluated_get(depsgraph)):
                for slot in getattr(candidate, "material_slots", ()):
                    material = getattr(slot, "material", None)
                    if material is not None:
                        materials.add(material)
    except (AttributeError, ReferenceError, RuntimeError, TypeError):
        return None
    return materials


def _unbound_material_image_paths(objects) -> dict[str, str]:
    """Prove paths used only by materials outside this GLB's object scope.

    Blender's global ``blend_paths`` includes every used datablock, including
    materials left behind by an addon or an artist experiment. The proof is
    deliberately narrow: local single-file Images only, every direct ID user
    must be an owning Material or inside its node-tree closure, no exported
    source/evaluated material may own the image, and active
    World/compositor/light/modifier graphs must not reach it. Any ambiguity
    stays build-reachable.
    """
    reachable_materials = _object_materials(objects)
    if reachable_materials is None:
        return {}

    image_materials = {}
    all_material_trees = set()
    for material in bpy.data.materials:
        trees = _node_tree_closure(getattr(material, "node_tree", None))
        all_material_trees.update(trees)
        for image in _images_in_node_trees(trees):
            image_materials.setdefault(image, set()).add(material)
    if not image_materials:
        return {}

    protected_images = set()
    scene = bpy.context.scene
    for root in (
        getattr(getattr(scene, "world", None), "node_tree", None),
        getattr(scene, "node_tree", None),
    ):
        protected_images.update(_images_in_node_trees(_node_tree_closure(root)))
    for obj in objects:
        protected_images.update(_images_in_node_trees(_node_tree_closure(
            getattr(getattr(obj, "data", None), "node_tree", None),
        )))
        for modifier in getattr(obj, "modifiers", ()):
            protected_images.update(_images_in_node_trees(_node_tree_closure(
                getattr(modifier, "node_group", None),
            )))

    candidates = {}
    try:
        direct_users = bpy.data.user_map(subset=set(image_materials))
    except (AttributeError, RuntimeError, TypeError):
        return {}
    for image, owners in image_materials.items():
        if (
            not owners
            or owners.intersection(reachable_materials)
            or image in protected_images
            or getattr(image, "source", None) != "FILE"
            or getattr(image, "library", None) is not None
            or getattr(image, "packed_file", None) is not None
        ):
            continue
        users = set(direct_users.get(image, ()))
        if not users or not users.issubset(
            all_material_trees.union(image_materials.get(image, ())),
        ):
            continue
        raw_path = getattr(image, "filepath", "")
        if not raw_path:
            continue
        absolute = os.path.normcase(os.path.normpath(bpy.path.abspath(raw_path)))
        candidates.setdefault(absolute, set()).add(image)

    # Multiple Image datablocks may point to one path. Suppress impact only
    # when every local Image at that path independently passed the proof.
    all_path_images = {}
    for image in bpy.data.images:
        if (
            getattr(image, "source", None) != "FILE"
            or getattr(image, "library", None) is not None
            or getattr(image, "packed_file", None) is not None
            or not getattr(image, "filepath", "")
        ):
            continue
        absolute = os.path.normcase(os.path.normpath(
            bpy.path.abspath(image.filepath),
        ))
        all_path_images.setdefault(absolute, set()).add(image)
    return {
        path: "unbound-material"
        for path, images in candidates.items()
        if images == all_path_images.get(path)
    }


def collect_external_dependencies(objects=None) -> list[dict]:
    """Hash every unpacked file Blender says the scene depends on.

    Paths inside the project are stored relative to the .blend so committed
    manifests remain portable across machines. Sequences/UDIM patterns are
    marked volatile: a cheap unchanged-scene skip cannot prove their set of
    files unchanged, so sync intentionally asks Blender again.
    """
    blend_dir = os.path.dirname(bpy.data.filepath)
    unreachable = _unbound_material_image_paths(objects) if objects is not None else {}
    output = []
    seen = set()
    for raw_path in bpy.utils.blend_paths(absolute=True, packed=False, local=False):
        absolute = os.path.normpath(raw_path)
        key = os.path.normcase(absolute)
        if not absolute or key in seen:
            continue
        seen.add(key)
        try:
            relative = os.path.relpath(absolute, blend_dir)
            inside = relative != os.pardir and not relative.startswith(os.pardir + os.sep)
        except ValueError:
            relative, inside = absolute, False
        stored_path = relative if inside else absolute
        volatile = volatile_dependency_path(raw_path)
        exists = os.path.isfile(absolute)
        reachability_reason = unreachable.get(key)
        output.append({
            "path": stored_path,
            "relativeToBlend": inside,
            "exists": exists,
            "bytes": os.path.getsize(absolute) if exists else 0,
            "hash": bakelib.file_sha256(absolute) if exists else None,
            "volatile": volatile,
            **({
                "reachable": False,
                "reachabilityReason": reachability_reason,
            } if reachability_reason else {}),
        })
    return sorted(output, key=lambda item: (item["relativeToBlend"], item["path"]))


def has_volatile_external_dependencies() -> bool:
    return any(
        volatile_dependency_path(path)
        for path in bpy.utils.blend_paths(absolute=True, packed=False, local=False)
    )


# .NNN-tolerant like every other suffix: the un-tolerant version shipped
# RefGrid-noimp.001 to the web while the addon blessed it (conformance
# fixture cases lock all three parsers together now).
NOIMP_PATTERN = re.compile(r"[-_]noimp(\.\d{3})?$", re.IGNORECASE)
# Collision-only proxies ship in the GLB (physics needs the geometry) but
# never render — keep them out of the atlas pack and the bake.
COLONLY_PATTERN = re.compile(r"[-_](conv)?colonly(\.\d{3})?$", re.IGNORECASE)
EXACT_ANCHOR_PATTERN = re.compile(r"^(?:SOCKET|HOTSPOT|AUDIO)[-_].+$")
BLENDLINK_ROLE_VALUES = frozenset({
    "col", "convcol", "colonly", "convcolonly", "rigid", "noimp",
})
# UV-layer names live in bakelib (the one home); the addon mirrors them.
ATLAS_UV = bakelib.ATLAS_UV


def explicit_blendlink_role(properties) -> str | None:
    """Return a recognized explicit role, which outranks every name token."""
    role = properties.get("blendlink_role") if properties is not None else None
    if not isinstance(role, str):
        return None
    normalized = role.lower().strip()
    return normalized if normalized in BLENDLINK_ROLE_VALUES else None


def is_noimp_designation(name: str, properties=None) -> bool:
    """Exporter-side noimp parser; locked to the shared conformance fixture."""
    role = explicit_blendlink_role(properties)
    if role is not None:
        return role == "noimp"
    if EXACT_ANCHOR_PATTERN.match(name):
        return False
    return bool(NOIMP_PATTERN.search(name))


def is_collision_proxy_designation(name: str, properties=None) -> bool:
    """Exporter-side collision-only parser with the same property precedence."""
    role = explicit_blendlink_role(properties)
    if role is not None:
        return role in ("colonly", "convcolonly")
    if EXACT_ANCHOR_PATTERN.match(name):
        return False
    return bool(COLONLY_PATTERN.search(name))


def is_collision_proxy(obj) -> bool:
    return is_collision_proxy_designation(obj.name, obj)


# ---------------------------------------------------------------------------
# Baked-unlit mode ("the bake is the painting")
#
# Evaluate modifiers, pack one non-overlapping atlas, then follow Needle's
# native multi-object Cycles path so every selected receiver retains Blender's
# object-scoped shader context. Save through the dithered Standard-view render
# path (plain image saves never dither and band), rebuild materials unlit, and
# export.
# ---------------------------------------------------------------------------


def texel_weight_of(obj) -> float:
    return bakelib.texel_weight_of(obj)


def dynamic_reason(obj, *, fixed_camera_appearance: bool = False) -> str | None:
    """Shared with the addon's artist-facing Bake/Realtime explanation."""
    return procedural.effective_dynamic_reason(
        obj, fixed_camera_appearance=fixed_camera_appearance,
    )


def final_material_binding_key(source, output: str, atlas: str, lightmap_channel):
    """Identity of one material binding in the exported website scene.

    Three.js shares one Material instance for every primitive that references
    the same glTF material index. Runtime lightmaps are assigned on that
    instance, so source-material identity alone is insufficient: Realtime,
    Appearance, and each Lighting atlas/UV channel need separate ownership.
    """
    source_key = source.as_pointer() if source is not None else None
    return (source_key, output, str(atlas), lightmap_channel)


def _neutral_pbr_material(name: str):
    """Explicit dielectric white used by material-less Lighting primitives.

    Omitting a glTF material asks GLTFLoader for its shared default, whose
    metallic factor is 1. That suppresses diffuse lightMap contribution and
    also recreates the cross-object sharing bug this material fork prevents.
    """
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    principled = tree.nodes.get("Principled BSDF")
    if principled is None:
        principled = tree.nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 1.0
    return material


def fork_lighting_materials(objects, atlas_for=None, channel_for=None) -> dict:
    """Give every Lighting binding an export-owned PBR material datablock.

    Copies are shared only by the complete `(source, output, atlas, channel)`
    key. Realtime objects retain the source material, while Lighting objects
    on other atlases or TEXCOORD channels receive different glTF material
    indices. All changes happen after geometry is frozen in the disposable
    background export scene; the artist's saved .blend is never modified.
    """
    atlas_for = atlas_for or (
        lambda obj: obj.get("blendlink_atlas", "main")
    )
    channel_for = channel_for or lightmap_uv_channel
    generated = {}

    def generated_for(source, group, channel):
        key = final_material_binding_key(source, "lighting", group, channel)
        material = generated.get(key)
        if material is not None:
            return material
        if source is None:
            material = _neutral_pbr_material(
                f"BLENDLINK_LIGHTING_NEUTRAL.{group}.UV{channel}"
            )
        else:
            material = source.copy()
            material.name = f"{source.name}.BLENDLINK_LIGHTING.{group}.UV{channel}"
        generated[key] = material
        return material

    for obj in objects:
        group = str(atlas_for(obj))
        channel = int(channel_for(obj))
        if not obj.material_slots:
            obj.data.materials.append(generated_for(None, group, channel))
            continue
        for slot in obj.material_slots:
            slot.material = generated_for(slot.material, group, channel)
    return generated


def rebuild_baked_materials(objects, baked_by_group, atlas_for=None) -> dict:
    """Give baked originals group-owned unlit materials without touching sources.

    A Blender Material datablock can be shared by baked and Realtime objects.
    Mutating that datablock in place turns the Realtime object into an atlas
    sampler too, so every baked `(source material, atlas)` receives a generated
    copy. Material-less meshes and explicit empty slots share one neutral
    generated material per atlas. The source .blend is opened in a disposable
    background process, but source-material ownership must still remain intact
    until glTF export has serialized both sides of a mixed scene.

    Returns the generated material map, primarily so the headless suite can
    assert ownership and neutral-slot behavior without running Cycles.
    """
    atlas_for = atlas_for or (
        lambda obj: obj.get("blendlink_atlas", next(iter(baked_by_group), "main"))
    )
    generated = {}

    def rebuild_unlit(material, image) -> None:
        tree = bakelib.ensure_shader_node_tree(material)
        nodes = tree.nodes
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        background = nodes.new("ShaderNodeBackground")
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = ATLAS_UV
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        tree.links.new(uv.outputs["UV"], texture.inputs["Vector"])
        tree.links.new(texture.outputs["Color"], background.inputs["Color"])
        tree.links.new(background.outputs["Background"], output.inputs["Surface"])

    def generated_for(source, group):
        key = final_material_binding_key(source, "appearance", group, 0)
        material = generated.get(key)
        if material is not None:
            return material
        if group not in baked_by_group:
            raise RuntimeError(
                f"baked object references atlas {group!r}, but no default-state image exists"
            )
        if source is None:
            material = bpy.data.materials.new(f"BLENDLINK_BAKED_NEUTRAL.{group}")
        else:
            material = source.copy()
            material.name = f"{source.name}.BLENDLINK_BAKED.{group}"
        rebuild_unlit(material, baked_by_group[group])
        generated[key] = material
        return material

    for obj in objects:
        group = str(atlas_for(obj))
        # No material slots means glTF would create a lit default material and
        # the state atlas would have no texture binding. Add one explicit slot.
        if not obj.material_slots:
            obj.data.materials.append(generated_for(None, group))
            continue
        for slot in obj.material_slots:
            slot.material = generated_for(slot.material, group)

    return generated


def render_meshes(*, fixed_camera_appearance: bool = False) -> list:
    """The BAKED mesh set: everything the atlas pack and bake touch.
    Dynamic (lit) meshes still export — they are simply not in here."""
    return [
        obj for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render
        and weblights.view_layer_includes_object(
            obj, bpy.context.scene, bpy.context.view_layer,
        )
        and len(obj.data.polygons) > 0 and not is_collision_proxy(obj)
        and texel_weight_of(obj) > 0.0
        and dynamic_reason(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        ) is None
    ]


def visible_render_meshes(*, fixed_camera_appearance: bool = False) -> list:
    """Render meshes excluding anything in a render-hidden collection —
    collection hide_render does not set obj.hide_render, and native bake
    receivers must respect state hideCollections (geometry states, not just
    lights)."""
    return [
        obj for obj in render_meshes(
            fixed_camera_appearance=fixed_camera_appearance,
        )
        if weblights.render_visibility(
            obj, bpy.context.scene, view_layer=bpy.context.view_layer,
        ).exported
    ]


def has_bakeable_meshes(*, fixed_camera_appearance: bool = False) -> bool:
    """Whether Hybrid presentation has any mesh left for an atlas job.

    Pure Realtime is a valid Hybrid outcome. Excluded ``-noimp`` objects have
    not been removed when the scene recipe is resolved, so discount them here
    to match the later export route instead of scheduling an empty bake.
    """
    excluded = {obj.name for obj in noimp_objects()}
    return any(
        obj.name not in excluded
        for obj in render_meshes(
            fixed_camera_appearance=fixed_camera_appearance,
        )
    )


def camera_positions() -> list:
    """World positions of EVERY scene camera — density and atlas assignment
    both want the worst case over authored viewpoints, not just the active
    camera (a compact/portrait camera can approach closer than the main)."""
    return [
        obj.matrix_world.translation.copy()
        for obj in bpy.context.scene.objects
        if obj.type == "CAMERA"
    ]


def nearest_camera_distance(obj, cameras: list):
    """Distance from the object's bounds center to the closest camera, or
    None when the scene has no cameras. Floored at 0.2m."""
    if not cameras:
        return None
    from mathutils import Vector

    center = obj.matrix_world @ (
        0.125 * sum((Vector(corner) for corner in obj.bound_box), Vector())
    )
    return max(min((position - center).length for position in cameras), 0.2)


def _presentation_camera_and_compositions(recipe: dict | None):
    """Resolve the one camera whose authored responsive frames ship.

    Generic camera-distance weighting intentionally considers every Blender
    camera. Composition evidence is narrower: it must describe the actual
    presentation camera and declared CSS frames, never an arbitrary viewport.
    """
    camera_recipe = recipe.get("camera") if isinstance(recipe, dict) else None
    if not isinstance(camera_recipe, dict):
        return None, []
    object_id = str(camera_recipe.get("objectId", ""))
    object_name = str(camera_recipe.get("objectName", ""))
    camera = next((
        obj for obj in bpy.context.scene.objects
        if obj.type == "CAMERA" and object_id
        and str(obj.get("blendlink_id", "")) == object_id
    ), None)
    if camera is None and object_name:
        candidate = bpy.context.scene.objects.get(object_name)
        if candidate is not None and candidate.type == "CAMERA":
            camera = candidate
    compositions = []
    for raw in camera_recipe.get("compositions", []):
        if not isinstance(raw, dict):
            continue
        width = int(raw.get("width", 0))
        height = int(raw.get("height", 0))
        if width > 0 and height > 0:
            compositions.append({
                "name": str(raw.get("name", "Composition")),
                "width": width,
                "height": height,
            })
    return camera, compositions


def composition_texel_evidence(
    obj, px_per_meter: float, recipe: dict | None,
) -> dict | None:
    """Worst declared-frame atlas sampling at DPR 1 and DPR 2.

    The metric is atlas texels per browser output pixel, not a visual-quality
    score. Values below one prove magnification. It uses the object's bounds
    centre because the atlas plan's existing camera-distance weighting uses
    that same stable representative point.
    """
    camera, compositions = _presentation_camera_and_compositions(recipe)
    if camera is None or not compositions or px_per_meter <= 0:
        return None
    from mathutils import Vector

    center = obj.matrix_world @ (
        0.125 * sum((Vector(corner) for corner in obj.bound_box), Vector())
    )
    local_center = camera.matrix_world.inverted() @ center
    depth = -float(local_center.z)
    if depth <= 1e-6:
        return None
    camera_data = camera.data
    candidates = []
    for composition in compositions:
        if camera_data.type == "ORTHO":
            world_height = float(camera_data.ortho_scale)
            if world_height <= 0:
                continue
            output_pixels_per_meter = composition["height"] / world_height
        elif camera_data.type == "PERSP":
            vertical_fov = float(camera_data.angle_y)
            denominator = 2.0 * depth * math.tan(vertical_fov / 2.0)
            if denominator <= 0:
                continue
            output_pixels_per_meter = composition["height"] / denominator
        else:
            continue
        texels_per_css_pixel = px_per_meter / output_pixels_per_meter
        candidates.append((texels_per_css_pixel, composition))
    if not candidates:
        return None
    ratio, composition = min(candidates, key=lambda item: item[0])
    return {
        "camera": camera.name,
        "composition": composition["name"],
        "cssWidth": composition["width"],
        "cssHeight": composition["height"],
        "atlasTexelsPerCssPixelAt1x": round(ratio, 3),
        "atlasTexelsPerDevicePixelAt2x": round(ratio / 2.0, 3),
    }


def rgba8_mip_chain_bytes(size: int) -> int:
    """Exact square RGBA8 byte upper bound including the full mip chain."""
    total = 0
    edge = max(1, int(size))
    while True:
        total += edge * edge * 4
        if edge == 1:
            return total
        edge = max(1, edge // 2)


def atlas_config(bake: dict) -> dict:
    """Declared atlases, or the implicit single atlas 'main'. Each entry:
    {size, maxCameraDistance?}. Users configure ATLASES; objects are
    auto-assigned by proximity and overridden per-object — never a
    hand-maintained object list in the config."""
    atlases = bake.get("atlases")
    if not atlases:
        # Old config-driven scenes predate separated lightmaps. Preserve their
        # Combined/unlit output unless the artist migrates through a recipe.
        return {"main": {
            "size": int(bake.get("size", 2048)),
            "bakeOutput": "appearance",
        }}
    resolved = {}
    for name, entry in atlases.items():
        bake_output = entry.get("bakeOutput", "appearance")
        if bake_output not in {"appearance", "lighting"}:
            raise SystemExit(
                f"atlas {name!r} bakeOutput must be appearance or lighting, "
                f"not {bake_output!r}"
            )
        resolved[name] = {
            "size": int(entry.get("size", 2048)),
            "bakeOutput": bake_output,
        }
        for key in ("targetDensity", "margin", "fitPolicy"):
            if key in entry:
                resolved[name][key] = entry[key]
        if "maxCameraDistance" in entry:
            resolved[name]["maxCameraDistance"] = float(entry["maxCameraDistance"])
    return resolved


def lightmap_uv_channel(obj) -> int:
    """Return the glTF TEXCOORD index of the derived atlas UV.

    Blender's glTF exporter maps UV-layer order directly to ``TEXCOORD_n``.
    TEXCOORD_0 remains the authored material UV; Blendlink supports a lightmap
    on channels 1..3. Blocking here is deliberately earlier than Cycles so an
    artist never waits through a bake that the runtime cannot bind.
    """
    index = obj.data.uv_layers.find(ATLAS_UV)
    if index < 0:
        raise RuntimeError(f"{obj.name}: derived lightmap UV {ATLAS_UV!r} is missing")
    if index == 0:
        raise RuntimeError(
            f"{obj.name}: lighting output needs an authored material UV before "
            f"{ATLAS_UV!r}; unwrap the mesh and resync"
        )
    if index > 3:
        raise RuntimeError(
            f"{obj.name}: lightmap UV would export as TEXCOORD_{index}, but Blendlink "
            "supports lightmap channels 1..3; remove or consolidate unused UV maps "
            "before syncing"
        )
    return index


def stamp_bake_output_metadata(obj, bake_output: str) -> int | None:
    """Stamp the node extras consumed by the generated Three adapter."""
    if bake_output not in {"appearance", "lighting"}:
        raise RuntimeError(f"unsupported atlas bake output {bake_output!r}")
    obj["blendlink_bake_output"] = bake_output
    if bake_output == "appearance":
        if "blendlink_lightmap_uv" in obj:
            del obj["blendlink_lightmap_uv"]
        return None
    channel = lightmap_uv_channel(obj)
    obj["blendlink_lightmap_uv"] = channel
    return channel


def light_group_output_issue(bake_outputs: dict, light_group_names) -> str | None:
    """Explain the unsupported additive-lighting/output combination."""
    lighting_atlases = sorted(
        name for name, output in bake_outputs.items() if output == "lighting"
    )
    names = sorted(set(light_group_names))
    if not lighting_atlases or not names:
        return None
    return (
        "Additive Light Groups cannot target Lighting atlas(es) "
        f"{', '.join(lighting_atlases)}: Three.js lightMap composition does not "
        "support Blendlink's additive bounced layers. Switch those atlases to "
        "Bake Appearance or remove Light Groups. Affected Light Groups: "
        + ", ".join(names)
    )


def assign_atlases(meshes: list, atlases: dict) -> tuple:
    """group -> [objects], plus warnings. Precedence per object: the
    blendlink_atlas property wins; else the first declared atlas whose
    maxCameraDistance covers the object's nearest-camera distance; else
    the catch-all (last atlas without a threshold). The resolved group is
    stamped back as blendlink_atlas so it ships in the GLB extras for the
    runtime (the export scene is disposable; the .blend is never saved).
    """
    names = list(atlases)
    # Scene recipes reserve `main` as the predictable default. Legacy
    # proximity configs have no reserved name and retain their last
    # threshold-free catch-all behavior.
    catch_all = "main" if "main" in atlases else next(
        (name for name in reversed(names) if "maxCameraDistance" not in atlases[name]),
        names[-1],
    )
    cameras = camera_positions()
    groups = {name: [] for name in names}
    warnings = []
    for obj in meshes:
        override = obj.get("blendlink_atlas")
        group = None
        if isinstance(override, str):
            if override in atlases:
                group = override
            else:
                warnings.append(
                    f"{obj.name}: blendlink_atlas '{override}' is not a declared "
                    f"atlas ({', '.join(names)}) — auto-assigned instead"
                )
        if group is None:
            group = catch_all
            distance = nearest_camera_distance(obj, cameras)
            if distance is not None:
                for name in names:
                    threshold = atlases[name].get("maxCameraDistance")
                    if threshold is not None and distance <= threshold:
                        group = name
                        break
        obj["blendlink_atlas"] = group
        groups[group].append(obj)
    return groups, warnings


def compute_texel_weights(meshes: list) -> dict:
    """auto (camera-distance, median-normalized, clamped, quantized) × artist.

    The auto weight equalizes texels-per-SCREEN-pixel: required linear
    density is proportional to 1/distance, taken as the WORST CASE over
    every authored camera. Scenes without a camera get a flat baseline
    (artist weights still apply).
    """
    cameras = camera_positions()
    raw = {}
    for obj in meshes:
        distance = nearest_camera_distance(obj, cameras)
        raw[obj.name] = 1.0 / distance if distance is not None else 1.0
    values = sorted(raw.values())
    median = values[len(values) // 2] if values else 1.0
    weights = {}
    for obj in meshes:
        normalized = raw[obj.name] / median if median > 0 else 1.0
        auto = quantize_half_pow2(min(max(normalized, 0.25), 4.0))
        weights[obj.name] = {"auto": auto, "artist": texel_weight_of(obj)}
    return weights


def bake_prepare_geometry(bake: dict, supersample: int = 1) -> dict:
    """Freeze, unwrap-fallback, then per-atlas average + weight + pack.

    Returns the layout: {group: {objects, size, margin}} at FINAL
    resolution (bake-time images are ×supersample; the pack margin is a
    fraction, identical at both scales). The config margin is authored
    against the LARGEST declared atlas and scales down per group, so a
    small background atlas never spends 40% of itself on gutters.
    """
    fixed_camera_appearance = bool(bake.get("fixedCameraAppearance"))
    meshes = render_meshes(
        fixed_camera_appearance=fixed_camera_appearance,
    )
    if not meshes:
        raise SystemExit(
            "baked mode: no bakeable meshes in the scene (every render mesh "
            "is dynamic, zero-weight, or a collision proxy)"
        )
    # Two-phase evaluate-then-assign: interleaving dirties the depsgraph
    # mid-loop and makes inter-object modifiers order-dependent.
    meshes = bakelib.freeze_evaluated_meshes(meshes)
    if not meshes:
        raise SystemExit(
            "baked mode: every bakeable mesh evaluates to empty geometry at "
            f"frame {bpy.context.scene.frame_current}"
        )
    # Unwrapped meshes get a real projection — Blender's default UV reset
    # maps every face to the full unit square, which shatters the pack.
    bakelib.ensure_authored_uvs(meshes)
    # Atlas workspace layer per mesh. Meshes carrying the artist's
    # BLENDLINK_ATLAS_AUTHORED layer (the addon's Materialize operator)
    # contribute its islands and pin flags instead of the first UV layer —
    # opt-in by presence.
    authored = set(bakelib.stage_atlas_layers(meshes))
    # Evaluated modifiers can create real faces whose inherited corner UVs
    # collapse to a line. Repair each fully unpinned derived workspace. Keep
    # pinned failures as plan errors so the island validator below can still
    # aggregate every artist-owned overlap, gutter, and collapse in one pass.
    evaluated_uv_errors = []
    for obj in sorted(meshes, key=lambda item: item.name):
        try:
            bakelib.repair_evaluated_atlas_uvs([obj], ATLAS_UV)
        except RuntimeError as error:
            evaluated_uv_errors.append(str(error))

    atlases = atlas_config(bake)
    groups, assign_warnings = assign_atlases(meshes, atlases)
    reference = max(entry["size"] for entry in atlases.values())
    base_margin = int(bake.get("margin", 48))
    weights = compute_texel_weights(meshes)
    layout = {
        "_warnings": assign_warnings,
        "_errors": evaluated_uv_errors,
        "_authored": authored,
        "_held": {},
        "_lightmap_uv": {},
    }
    for name, entry in atlases.items():
        objs = groups[name]
        margin = int(entry.get("margin", max(1, round(base_margin * entry["size"] / reference))))
        layout[name] = {
            "objects": objs,
            "size": entry["size"],
            "margin": margin,
            "bakeOutput": entry["bakeOutput"],
        }
        if not objs:
            continue
        if entry["bakeOutput"] == "lighting":
            for obj in objs:
                try:
                    layout["_lightmap_uv"][obj.name] = lightmap_uv_channel(obj)
                except RuntimeError as error:
                    layout["_errors"].append(str(error))
        # Baseline: equalize px/m across THIS atlas (authored UV scales are
        # arbitrary), then apply texel weights as island pre-scales —
        # pack_islands(scale=True) preserves relative island scale, so the
        # pre-scale IS the weight (Unity Scale-in-Lightmap semantics).
        # Islands the artist PINNED in an authored layer sit this out
        # entirely: not averaged, not weighted, and pack(pin=True) locks
        # them in place while the rest packs around them.
        held = bakelib.average_unpinned(objs, ATLAS_UV)
        layout["_held"].update(held)
        required_gutter = bakelib.required_bake_gutter_px(
            margin * supersample,
            guard_px=4 * supersample,
        ) / (entry["size"] * supersample)
        pinned_issues = bakelib.pinned_uv_layout_issues(
            objs, ATLAS_UV, held, minimum_gutter=required_gutter,
        )
        for issue in pinned_issues:
            if issue["kind"] == "self-overlap":
                layout["_errors"].append(
                    f"{name}: {issue['object']} pinned authored atlas island "
                    f"{issue['island']} overlaps itself; repair the folded or "
                    "stacked UVs, or unpin the island, before syncing"
                )
            elif issue["kind"] == "overlap":
                left = f"{issue['object']} island {issue['island']}"
                right = f"{issue['otherObject']} island {issue['otherIsland']}"
                layout["_errors"].append(
                    f"{name}: pinned authored atlas UVs overlap between {left} "
                    f"and {right}; move or unpin one island before syncing"
                )
            elif issue["kind"] == "out-of-bounds":
                minimum_u, minimum_v, maximum_u, maximum_v = issue["bounds"]
                layout["_errors"].append(
                    f"{name}: {issue['object']} pinned authored atlas island "
                    f"{issue['island']} reaches outside 0..1 "
                    f"(U {minimum_u:.6g}..{maximum_u:.6g}, "
                    f"V {minimum_v:.6g}..{maximum_v:.6g}); move or unpin it "
                    "before syncing"
                )
            elif issue["kind"] == "insufficient-edge-gutter":
                minimum_u, minimum_v, maximum_u, maximum_v = issue["bounds"]
                required_px = issue["requiredGutter"] * entry["size"]
                layout["_errors"].append(
                    f"{name}: {issue['object']} pinned authored atlas island "
                    f"{issue['island']} does not leave the required "
                    f"{required_px:.3g}px edge gutter at {entry['size']}px "
                    f"(U {minimum_u:.6g}..{maximum_u:.6g}, "
                    f"V {minimum_v:.6g}..{maximum_v:.6g}); move it inward "
                    "or unpin it before syncing"
                )
            elif issue["kind"] == "insufficient-gutter":
                left = f"{issue['object']} island {issue['island']}"
                right = f"{issue['otherObject']} island {issue['otherIsland']}"
                actual_px = issue["distance"] * entry["size"]
                required_px = issue["requiredGutter"] * entry["size"]
                layout["_errors"].append(
                    f"{name}: pinned authored atlas UVs leave only "
                    f"{actual_px:.3g}px between {left} and {right}; "
                    f"the bake/mipmap padding contract requires "
                    f"{required_px:.3g}px; move or unpin one island before syncing"
                )
            elif issue["kind"] == "degenerate":
                layout["_errors"].append(
                    f"{name}: {issue['object']} pinned authored atlas island "
                    f"{issue['island']} contains a collapsed zero-area UV "
                    "triangle; unfold or unpin it before syncing"
                )
            else:
                layout["_errors"].append(
                    f"{name}: {issue['object']} pinned authored atlas island "
                    f"{issue['island']} contains NaN or infinite UV coordinates; "
                    "repair or unpin it before syncing"
                )
        if pinned_issues:
            # Do not ask Blender's packer to reinterpret a layout we already
            # know cannot bake. Plan callers still receive the exact authored
            # coordinates plus actionable errors; final callers block below.
            continue
        post_pack_repairs, final_held = bakelib.pack_with_evaluated_uv_repair(
            objs,
            ATLAS_UV,
            lambda obj: weights[obj.name]["auto"] * weights[obj.name]["artist"],
            margin * supersample,
            entry["size"] * supersample,
            held=held,
            pin=True,
            delivery_size=entry["size"],
            guard_px=4 * supersample,
        )
        layout["_held"].update(final_held)
        for repair in post_pack_repairs:
            if repair["strategy"] == "sampleable-regular-polygon-rescue":
                action = (
                    f"regularized {repair['rescuePolygonCount']} fully unpinned "
                    "micro-polygon(s), preserved a measured minimum triangle "
                    f"inradius of {repair['packedInradiusDeliveryTexels']:.3g} "
                    "delivery texels, and repacked the complete atlas"
                    + (
                        " with one bounded adaptive enlargement"
                        if repair.get("adaptiveRepack") else ""
                    )
                )
            elif repair.get("rescuePolygonCount"):
                action = (
                    "Smart Projected the fully unpinned derived atlas layer, "
                    f"locally projected {repair['rescuePolygonCount']} tiny "
                    "polygon(s) still collapsed by Blender, and repacked the "
                    "complete atlas"
                )
            else:
                action = (
                    "Smart Projected the fully unpinned derived atlas layer "
                    "and repacked the complete atlas"
                )
            layout["_warnings"].append(
                f"{repair['object']}: atlas packing collapsed "
                f"{repair['triangleCount']} evaluated surface triangle(s) at "
                f"float32 UV precision; Blendlink {action}. Authored UV layers "
                "were preserved"
            )
    layout["_errors"].extend(packed_atlas_coverage_errors(layout))
    return layout


def packed_atlas_coverage_errors(layout: dict) -> list[str]:
    """Reject populated atlases whose packer produced no usable UV area."""
    errors = []
    for name, entry in layout.items():
        if name.startswith("_") or not entry["objects"]:
            continue
        coverage = sum(bakelib.packed_uv_area(obj) for obj in entry["objects"])
        covered_texels = coverage * entry["size"] * entry["size"]
        if covered_texels < 1.0:
            errors.append(
                f"{name}: atlas packing collapsed every UV island below one "
                f"output texel of usable area ({covered_texels:.3g} texels) "
                f"at {entry['size']}px with {entry['margin']}px artist padding "
                "on both receiver islands plus the 4px bake guard; lower "
                "Padding or increase Resolution. "
                "Blendlink refused to publish an empty atlas"
            )
    return errors


def bake_engine(samples: int) -> dict:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    # Bake-time denoising darkens island margins (denoise runs before the
    # margin fill — blender/blender#94573); adaptive samples instead.
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    scene.cycles.use_auto_tile = False
    # Normalize every scene-level bake option we rely on. bpy.ops.object.bake
    # accepts explicit overrides for some of these but inherits the rest from
    # the artist's file; a saved cage/selected-to-active setting must never
    # leak into a website lightmap.
    bake = scene.render.bake
    bake.use_clear = True
    bake.use_selected_to_active = False
    bake.use_cage = False
    bake.cage_extrusion = 0.0
    bake.max_ray_distance = 0.0
    bake.margin_type = "EXTEND"
    return bakelib.configure_cycles_compute_device(
        scene,
        log=print,
        purpose="bake",
    )


def configure_atlas_bake(
        scene, margin_px: int, bake_output: str, *, emit: bool = True,
        fixed_camera_appearance: bool = False) -> None:
    """Dispatch to bakelib's canonical output-specific bake mechanics."""
    if bake_output == "appearance":
        bakelib.configure_combined_bake(
            scene, margin_px, emit=emit,
            view_from=(
                "ACTIVE_CAMERA" if fixed_camera_appearance else "ABOVE_SURFACE"
            ),
        )
    elif bake_output == "lighting":
        bakelib.configure_lighting_bake(scene, margin_px)
    else:
        raise RuntimeError(f"unsupported atlas bake output {bake_output!r}")


def bake_state(
        objects, image, margin_px: int, emit: bool = True,
        bake_output: str = "appearance",
        fixed_camera_appearance: bool = False) -> None:
    scene = bpy.context.scene
    # Light-group layers pass emit=False: surface self-emission already
    # lives in the base state, and mute_emission cannot reach node-driven
    # (linked) emission — baking it into every layer would add N+1 copies
    # of the monitor glow at runtime.
    configure_atlas_bake(
        scene, margin_px, bake_output, emit=emit,
        fixed_camera_appearance=fixed_camera_appearance,
    )
    bakelib.bake_objects_to_image(
        objects,
        image,
        bake_type="DIFFUSE" if bake_output == "lighting" else "COMBINED",
        margin_px=margin_px,
        uv_layer=ATLAS_UV,
    )


def bake_denoise_guides(objects, size: int, group: str, margin_px: int) -> tuple:
    """Bake the albedo guide for OIDN; deliberately omit a normal guide.

    Unguided OIDN can mistake authored micro-texture for noise. The one-sample
    diffuse-color bake protects that detail without claiming an invalid normal
    coordinate frame; the returned normal slot is intentionally ``None``.
    """
    scene = bpy.context.scene
    prior_samples = scene.cycles.samples
    prior_adaptive = scene.cycles.use_adaptive_sampling
    scene.cycles.samples = 1
    scene.cycles.use_adaptive_sampling = False
    try:
        albedo = bpy.data.images.new(
            f"blendlink-albedo-{group}", width=size, height=size,
            alpha=True, float_buffer=True,
        )
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
        bakelib.bake_objects_to_image(
            objects, albedo, bake_type="DIFFUSE", margin_px=margin_px,
            uv_layer=ATLAS_UV,
        )
        # Blender's ordinary NORMAL bake is encoded in 0..1 and OBJECT mode
        # gives every receiver a different coordinate frame. OIDN requires a
        # signed common world/view frame, so connecting that image would be a
        # false guide. Albedo-only is the truthful shippable contract until a
        # common-space normal differential exists.
        return albedo, None
    finally:
        scene.cycles.samples = prior_samples
        scene.cycles.use_adaptive_sampling = prior_adaptive


def _active_scene_collections_by_name() -> dict:
    result = {}
    stack = [bpy.context.scene.collection]
    seen = set()
    while stack:
        collection = stack.pop()
        pointer = collection.as_pointer()
        if pointer in seen:
            continue
        seen.add(pointer)
        result[collection.name] = collection
        stack.extend(collection.children)
    return result


def hide_collections(names: list) -> list:
    """Render-hide the named collections, returning prior values — an
    unconditional un-hide on restore would expose collections the artist
    authored hidden."""
    if not isinstance(names, list) or not all(isinstance(name, str) and name.strip() for name in names):
        raise RuntimeError("lighting state hideCollections must contain non-empty collection names")
    if len(names) != len(set(names)):
        raise RuntimeError("lighting state hideCollections contains a duplicate collection name")
    scene_collections = _active_scene_collections_by_name()
    resolved = [(name, scene_collections.get(name)) for name in names]
    missing = [name for name, collection in resolved if collection is None]
    if missing:
        raise RuntimeError(
            "lighting state references missing/renamed collection(s): "
            + ", ".join(repr(name) for name in missing)
        )
    blocked = [
        collection for _, collection in resolved
        if not collection.hide_render and not getattr(collection, "is_editable", True)
    ]
    if blocked:
        raise RuntimeError(
            "lighting state cannot hide linked/read-only collection(s): "
            + ", ".join(repr(collection.name) for collection in blocked)
            + "; make them local or author the visibility in their source .blend"
        )
    saved = []
    for _, collection in resolved:
        saved.append((collection, collection.hide_render))
        if not collection.hide_render:
            collection.hide_render = True
    return saved


def state_visibility(names: list, export_collection: str | None = None) -> dict:
    """Stable runtime membership matching Blender collection-path visibility.

    Only renderable exported objects are toggled. Empty-parent visibility is
    deliberately not used as a shortcut because Three visibility cascades
    through hierarchy while Blender collection links do not.
    """
    hidden_names = set(names)
    scene_collections = _active_scene_collections_by_name()
    for name in names:
        collection = scene_collections.get(name)
        if collection is None:
            raise RuntimeError(f"lighting state references collection {name!r} outside this scene")
    if export_collection:
        exported_collection = scene_collections.get(export_collection)
        if exported_collection is None:
            raise RuntimeError(f"export collection {export_collection!r} is not in this scene")
        exported = set(exported_collection.all_objects)
    else:
        exported = set(bpy.context.scene.objects)
    impacted = {
        obj for obj in exported
        if not obj.hide_render
        and weblights.render_visibility(
            obj, bpy.context.scene, view_layer=bpy.context.view_layer,
        ).exported
        and not weblights.render_visibility(
            obj, bpy.context.scene, view_layer=bpy.context.view_layer,
            additionally_hidden=hidden_names,
        ).exported
    }
    renderable_types = {"MESH", "LIGHT", "CURVE", "FONT", "META", "SURFACE"}
    objects = {obj for obj in impacted if obj.type in renderable_types}
    for obj in objects:
        visible_descendants = [
            child.name for child in obj.children_recursive
            if child in exported and child.type in renderable_types
            and not child.hide_render and child not in impacted
        ]
        if visible_descendants:
            raise RuntimeError(
                f"lighting state cannot hide parent {obj.name!r} without also hiding its "
                "visible exported descendants in Three.js: "
                + ", ".join(sorted(visible_descendants))
                + ". Put the hierarchy on the same state collection path or unparent it."
            )
    return {
        "hiddenObjectIds": sorted({
            obj.get("blendlink_id") for obj in objects
            if isinstance(obj.get("blendlink_id"), str)
        }),
        "hiddenObjectNames": sorted(
            obj.name for obj in objects
            if not isinstance(obj.get("blendlink_id"), str)
        ),
    }


def restore_collections(saved: list) -> None:
    errors = []
    for collection, value in saved:
        try:
            if collection.hide_render != value:
                collection.hide_render = value
        except Exception as error:
            errors.append(f"{collection.name}: {type(error).__name__}: {error}")
    if errors:
        raise RuntimeError(
            "could not restore lighting-state collection visibility: " + "; ".join(errors)
        )


def _socket_may_emit(socket, *, color=False) -> bool:
    if socket is None:
        return False
    if socket.is_linked:
        return True
    value = socket.default_value
    if color:
        return max(float(component) for component in value[:3]) > 1e-6
    return float(value) > 1e-6


def material_may_emit(material) -> bool:
    """Whether a connected surface graph has a nonzero/linked emitter."""
    tree = bakelib.active_shader_node_tree(material)
    if tree is None:
        return False
    for node in procedural.reachable_surface_nodes(tree, "OUTPUT_MATERIAL"):
        if node.type == "EMISSION":
            if _socket_may_emit(node.inputs.get("Strength")) \
                    and _socket_may_emit(node.inputs.get("Color"), color=True):
                return True
        elif node.type == "BSDF_PRINCIPLED":
            color = node.inputs.get("Emission Color") or node.inputs.get("Emission")
            strength = node.inputs.get("Emission Strength")
            if _socket_may_emit(strength) and _socket_may_emit(color, color=True):
                return True
    return False


def emissive_mesh_contributors(objects) -> list[tuple[str, str]]:
    """Named renderable mesh/material pairs that may light a Cycles bake."""
    contributors = set()
    for obj in objects:
        if (obj.type != "MESH" or obj.hide_render
                or not weblights.render_visibility(
                    obj, bpy.context.scene, view_layer=bpy.context.view_layer,
                ).exported):
            continue
        used_slots = {polygon.material_index for polygon in obj.data.polygons}
        for index in used_slots:
            if index >= len(obj.material_slots):
                continue
            material = obj.material_slots[index].material
            if material_may_emit(material):
                contributors.add((obj.name, material.name))
    return sorted(contributors)


def world_may_light(scene) -> str | None:
    """Name a non-black connected Blender World lighting contributor."""
    world = scene.world
    if world is None:
        return None
    tree = bakelib.active_shader_node_tree(world)
    if tree is None:
        return world.name if max(float(value) for value in world.color[:3]) > 1e-6 else None
    backgrounds = []
    for node in procedural.reachable_surface_nodes(tree, "OUTPUT_WORLD"):
        if node.type != "BACKGROUND":
            continue
        if _socket_may_emit(node.inputs.get("Strength")) \
                and _socket_may_emit(node.inputs.get("Color"), color=True):
            backgrounds.append(node.name)
    if not backgrounds:
        return None
    return f"{world.name} ({', '.join(sorted(set(backgrounds)))})"


def lighting_preflight_warnings(
        scene, lighting_atlases, recipe=None, objects=None) -> list[str]:
    """Warn when indirect-only Lighting relies on non-portable contributors.

    Mesh emission can be conditional (for example through Light Path nodes),
    so named contributors are warnings rather than blockers. A published HDR
    explicitly assigned to environment lighting is the portable World owner.
    """
    atlas_names = sorted(set(lighting_atlases))
    if not atlas_names:
        return []
    suffix = (
        "Add/export an equivalent Blender Light object for realtime lighting, "
        "publish the HDR environment, or choose Bake Appearance."
    )
    warnings = []
    contributors = emissive_mesh_contributors(
        list(objects) if objects is not None else list(scene.objects)
    )
    if contributors:
        names = ", ".join(
            f"{object_name} / {material_name}"
            for object_name, material_name in contributors[:8]
        )
        if len(contributors) > 8:
            names += f", +{len(contributors) - 8} more"
        warnings.append(
            "Bake Lighting preflight: emissive mesh materials may illuminate the "
            "Cycles bake, but Three.js emissive materials only look self-lit and do "
            f"not light nearby meshes. Contributor(s): {names}. {suffix}"
        )
    environment = recipe.get("environment") if isinstance(recipe, dict) else None
    published_world = isinstance(environment, dict) \
        and environment.get("source") == "image" \
        and environment.get("lighting") == "image"
    world = world_may_light(scene)
    if world is not None and not published_world:
        warnings.append(
            f"Bake Lighting preflight: Blender World {world} illuminates the Cycles "
            "scene, but no published HDR environment owns Three.js lighting. " + suffix
        )
    return warnings


def density_balance_warnings(objects: list[dict], has_camera: bool) -> list[str]:
    """Compare detail only among objects competing for the same atlas.

    Independent atlases have independent pixel budgets. Comparing a lone
    background member with Main can therefore call it a space hog and suggest
    lowering a weight that cannot give one pixel back to Main. Per-atlas
    medians keep this diagnostic both mathematically true and actionable.
    """
    metric = "screenDensity" if has_camera else "pxPerMeter"
    by_atlas: dict[str, list[dict]] = {}
    for entry in objects:
        if entry.get(metric):
            by_atlas.setdefault(str(entry.get("atlas", "main")), []).append(entry)

    warnings = []
    density_label = "screen density" if has_camera else "texel density"
    for atlas in sorted(by_atlas):
        members = by_atlas[atlas]
        # With no competing member there is no relative allocation problem.
        if len(members) < 2:
            continue
        densities = sorted(float(entry[metric]) for entry in members)
        median = densities[len(densities) // 2]
        if median <= 0:
            continue
        for entry in members:
            value = float(entry[metric])
            ratio = value / median
            if ratio < 0.5:
                consequence = (
                    "it will look blurry at its closest approach"
                    if has_camera else "it will carry less texture detail than its peers"
                )
                warnings.append(
                    f"{entry['name']} sits {median / value:.1f}x below the median "
                    f"{density_label} in atlas {atlas!r} — {consequence} "
                    "(raise its texel_weight)"
                )
            elif ratio > 2.0:
                warnings.append(
                    f"{entry['name']} sits {ratio:.1f}x above the median "
                    f"{density_label} in atlas {atlas!r} — it is taking detail from other "
                    "members (lower its texel_weight)"
                )
    return warnings



def compute_bake_plan(settings: dict, recipe: dict | None = None) -> dict:
    """Everything an artist wants to know BEFORE the bake, computed from the
    UV pack alone (no Cycles work): per-object texel density, atlas share,
    occupancy, and the state list. The re-bake causes on record are density
    discovered too late and one object hogging the atlas — this is the lint.
    """
    bake = settings.get("bake", {})
    size = int(bake.get("size", 2048))
    margin_px = int(bake.get("margin", 48))
    states = bake.get("states") or [{"name": "default"}]
    supersample = max(1, int(bake.get("supersample", 1)))
    # Match the final bake pack. The four-pixel dilation guard means a 1x
    # preview is not byte-for-byte layout evidence for a 2x final bake.
    layout = bake_prepare_geometry(bake, supersample)

    cameras = camera_positions()
    fixed_camera_appearance = bool(bake.get("fixedCameraAppearance"))
    meshes = render_meshes(
        fixed_camera_appearance=fixed_camera_appearance,
    )
    weights = compute_texel_weights(meshes)
    group_of = {
        obj.name: name
        for name, entry in layout.items() if not name.startswith("_")
        for obj in entry["objects"]
    }
    atlas_layout = bakelib.capture_packed_uv_evidence(meshes, group_of)
    group_size = {
        name: entry["size"]
        for name, entry in layout.items() if not name.startswith("_")
    }
    atlas_specs = atlas_config(bake)
    authored = layout.get("_authored", set())
    held = layout.get("_held", {})
    objects = []
    group_uv = {name: 0.0 for name in group_size}
    for obj in meshes:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.transform(obj.matrix_world)
        surface = sum(face.calc_area() for face in bm.faces)
        uv_area = bakelib.packed_uv_area(obj)
        bm.free()
        group = group_of.get(obj.name, next(iter(group_size)))
        atlas_px = group_size[group]
        group_uv[group] += uv_area
        px_per_meter = ((uv_area * atlas_px * atlas_px) / surface) ** 0.5 if surface > 0 else 0.0
        distance = nearest_camera_distance(obj, cameras)
        entry = weights.get(obj.name, {"auto": 1.0, "artist": 1.0})
        record = {
            "name": obj.name,
            "atlas": group,
            "bakeOutput": atlas_specs[group]["bakeOutput"],
            "areaM2": round(surface, 3),
            "uvShare": round(uv_area, 5),
            "pxPerMeter": round(px_per_meter, 1),
            "cameraDistance": round(distance, 2) if distance is not None else None,
            # Equal perceived quality = equal px/m x distance.
            "screenDensity": round(px_per_meter * distance, 1) if distance is not None else None,
            "autoWeight": entry["auto"],
            "artistWeight": entry["artist"],
        }
        composition_detail = composition_texel_evidence(obj, px_per_meter, recipe)
        if composition_detail is not None:
            record["compositionDetail"] = composition_detail
        if atlas_specs[group]["bakeOutput"] == "lighting":
            lightmap_uv = layout.get("_lightmap_uv", {}).get(obj.name)
            if lightmap_uv is not None:
                record["lightmapUv"] = lightmap_uv
        # Authored-layer trail (additive fields): an honored layer must be
        # visible in the plan, never a silent exporter-side decision.
        if obj.name in authored:
            record["authored"] = True
            record["pinned"] = bool(held.get(obj.name))
        objects.append(record)
    camera_position = cameras[0] if cameras else None
    total_uv = max(group_uv.values()) if group_uv else 0.0

    # Worst perceived quality first — the offender list leads.
    objects.sort(key=lambda entry: entry["screenDensity"] if entry["screenDensity"] is not None else entry["pxPerMeter"])
    warnings = density_balance_warnings(objects, camera_position is not None)
    errors = list(layout.get("_errors", []))
    planned_group_lights = []
    hidden_group_lights = []
    for obj in bpy.context.scene.objects:
        if obj.type != "LIGHT" or not getattr(obj, "lightgroup", ""):
            continue
        visibility = weblights.render_visibility(
            obj, bpy.context.scene, view_layer=bpy.context.view_layer,
        )
        if visibility.exported:
            planned_group_lights.append(obj)
        else:
            hidden_group_lights.append((obj, visibility))
    light_groups = sorted({obj.lightgroup for obj in planned_group_lights})
    if hidden_group_lights:
        warnings.append(
            "interactive light-group lights ignored because they are not "
            "render-visible: " + "; ".join(
                f"{obj.name} ({visibility.detail})"
                for obj, visibility in hidden_group_lights
            )
        )
    instanced_group_lights = sorted({
        entry["object"].name
        for entry in collect_instance_source_occurrences(
            bpy.context.scene, view_layer=bpy.context.view_layer,
        ).values()
        if entry["object"].type == "LIGHT"
        and getattr(entry["object"], "lightgroup", "")
        and any(item["visible"] for item in entry["occurrences"])
    })
    if instanced_group_lights:
        errors.append(
            "interactive Light Groups on Collection Instance source lights "
            "cannot preserve per-occurrence transforms yet: "
            + ", ".join(instanced_group_lights)
        )
    collision_proxies = sorted(
        obj.name for obj in bpy.context.scene.objects
        if obj.type == "MESH" and is_collision_proxy(obj)
    )
    dynamic_objects = []
    automatic_camera_bakes = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        reason = dynamic_reason(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        )
        if reason:
            dynamic_objects.append({"name": obj.name, "reason": reason})
        camera_reason = (
            procedural.fixed_camera_appearance_bake_reason(obj)
            if fixed_camera_appearance else None
        )
        if camera_reason:
            automatic_camera_bakes.append(f"{obj.name} ({camera_reason})")
    if automatic_camera_bakes:
        warnings.append(
            "Automatic fixed-camera Appearance capture will bake opaque "
            "camera-dependent shading from the authored active camera: "
            + ", ".join(sorted(automatic_camera_bakes))
        )
    populated = [name for name, entry in layout.items()
                 if not name.startswith("_") and entry["objects"]]
    light_group_issue = light_group_output_issue(
        {
            name: atlas_specs[name]["bakeOutput"]
            for name in populated
        },
        light_groups,
    )
    if light_group_issue:
        errors.append(light_group_issue)
    warnings.extend(lighting_preflight_warnings(
        bpy.context.scene,
        [
            name for name in populated
            if atlas_specs[name]["bakeOutput"] == "lighting"
        ],
        recipe,
    ))
    atlas_summaries = {}
    active_atlas_gpu_bytes = 0
    for name in group_size:
        spec = atlas_specs[name]
        target = spec.get("targetDensity")
        required_occupancy = None
        target_achievement = None
        achieved_density = None
        if target is not None:
            atlas_objects = [entry for entry in objects if entry["atlas"] == name]
            required_pixels = sum(
                entry["areaM2"]
                * (float(target) * entry["autoWeight"] * entry["artistWeight"]) ** 2
                for entry in atlas_objects
            )
            margin = int(spec.get("margin", layout[name]["margin"]))
            usable_side = max(1, group_size[name] - margin * 2)
            required_occupancy = required_pixels / (usable_side * usable_side)
            ratios = [
                (entry["pxPerMeter"] /
                 (float(target) * entry["autoWeight"] * entry["artistWeight"]), entry)
                for entry in atlas_objects
                if entry["autoWeight"] * entry["artistWeight"] > 0
            ]
            if ratios:
                target_achievement, worst = min(ratios, key=lambda pair: pair[0])
                achieved_density = min(entry["pxPerMeter"] for entry in atlas_objects)
            else:
                worst = None
            message = None
            if required_occupancy > 1:
                message = (
                    f"{name} needs {required_occupancy:.2f}x its usable area to hold "
                    f"{target:g} px/m at {group_size[name]}px; increase its resolution, "
                    "lower Minimum Detail, move hero objects to another atlas, or explicitly choose Scale to Fit"
                )
            elif target_achievement is not None and target_achievement < 0.95:
                message = (
                    f"{name} only reaches {target_achievement * 100:.0f}% of its density target "
                    f"on {worst['name']}; increase its resolution, lower Minimum Detail, "
                    "edit the atlas layout, or explicitly choose Scale to Fit"
                )
            if message:
                if spec.get("fitPolicy", "block") == "block":
                    errors.append(message)
                else:
                    prefix = (
                        "Preview only — Scale to Fit: "
                        if bake.get("previewScaleToFit") else "Scale to Fit: "
                    )
                    warnings.append(prefix + message)
        atlas_objects = [entry for entry in objects if entry["atlas"] == name]
        composition_entries = [
            (entry["compositionDetail"]["atlasTexelsPerCssPixelAt1x"], entry)
            for entry in atlas_objects if "compositionDetail" in entry
        ]
        worst_composition = min(composition_entries, key=lambda pair: pair[0]) \
            if composition_entries else None
        gpu_bytes = rgba8_mip_chain_bytes(group_size[name])
        active_atlas_gpu_bytes += gpu_bytes
        atlas_summaries[name] = {
            "size": group_size[name],
            "bakeOutput": spec["bakeOutput"],
            **({
                "lightmapUvChannels": sorted({
                    entry["lightmapUv"] for entry in objects
                    if entry["atlas"] == name and "lightmapUv" in entry
                }),
            } if spec["bakeOutput"] == "lighting" else {}),
            "occupancy": round(group_uv[name], 4),
            "objects": len(layout[name]["objects"]),
            **({"targetDensity": float(target)} if target is not None else {}),
            **({"requiredOccupancy": round(required_occupancy, 4)} if required_occupancy is not None else {}),
            **({"achievedDensity": round(achieved_density, 1)} if achieved_density is not None else {}),
            **({"targetAchievement": round(target_achievement, 4)} if target_achievement is not None else {}),
            "paddingPx": int(spec.get("margin", layout[name]["margin"])),
            "fitPolicy": spec.get("fitPolicy", "scale"),
            # Upper bound after browser decode/upload. Transfer compression is
            # intentionally not confused with GPU residency.
            "estimatedGpuBytesRgba8Mipmapped": gpu_bytes,
            **({
                "compositionDetail": {
                    "worstObject": worst_composition[1]["name"],
                    **worst_composition[1]["compositionDetail"],
                },
            } if worst_composition else {}),
        }
        if worst_composition is not None:
            ratio, worst = worst_composition
            detail = worst["compositionDetail"]
            if ratio < 1.0:
                warnings.append(
                    f"{name} magnifies {worst['name']} to {ratio:.2f} atlas texels "
                    f"per CSS pixel in {detail['composition']} at DPR 1. Split the "
                    "visual tier, raise atlas resolution, or reduce the declared output size"
                )
            elif ratio < 2.0:
                warnings.append(
                    f"{name} gives {worst['name']} {ratio:.2f} atlas texels per CSS "
                    f"pixel in {detail['composition']}; a DPR 2 display will magnify it "
                    "below one texel per device pixel. Consider a higher-resolution or "
                    "separate hero atlas"
                )
    return {
        "supersample": supersample,
        "atlasSize": size,
        "marginPx": margin_px,
        "samples": int(bake.get("samples", 128)),
        **({
            "appearanceViewFrom": (
                "active-camera" if fixed_camera_appearance else "above-surface"
            ),
        } if any(
            spec["bakeOutput"] == "appearance"
            for spec in atlas_specs.values()
        ) else {}),
        # Compat number: the fullest atlas. Per-atlas detail rides below.
        "occupancy": round(total_uv, 4),
        "atlases": atlas_summaries,
        "dynamicObjects": dynamic_objects,
        "states": [state["name"] for state in states],
        "lightGroups": light_groups,
        "bakeCount": (len(states) + len(light_groups)) * max(len(populated), 1),
        "estimatedActiveAtlasGpuBytesRgba8Mipmapped": active_atlas_gpu_bytes,
        "objects": objects,
        "atlasLayout": atlas_layout,
        "collisionProxies": collision_proxies,
        "warnings": warnings + layout.get("_warnings", []),
        "errors": errors,
    }


def bake_light_groups(
    targets: dict, images: dict, margins: dict, final_sizes: dict,
    grouped_lights: dict, out_glb: str, bake_outputs: dict,
    progress_start: float, progress_step: float,
    denoise: bool = False, guides: dict | None = None,
    reused: dict | None = None, skipped: set | None = None,
    variants: dict | None = None,
    timings: list | None = None,
    supersample: int = 1,
    fixed_camera_appearance: bool = False,
) -> dict:
    """Solo-bake each light group's full contribution (direct + indirect).

    Cycles cannot bake light-group AOVs, but a Combined bake with only that
    group's lights enabled IS its contribution, by linearity. World goes
    black and unlinked emission is muted so nothing else leaks in. Layers
    are peak-normalized to survive 8-bit PNG; maxValue rides the manifest so
    the runtime can rescale (layer * maxValue * tint * strength, added in
    linear space).
    """
    scene = bpy.context.scene
    all_lights = [obj for obj in scene.objects if obj.type == "LIGHT"]
    lights_prev = [(light, light.hide_render) for light in all_lights]
    original_world, black = bakelib.swap_to_black_world()
    muted = bakelib.mute_emission()

    layers = reused or {}
    skipped = skipped or set()
    variants = variants if variants is not None else {}
    try:
        for index, (name, lights) in enumerate(sorted(grouped_lights.items())):
            if all((name, group) in skipped for group in targets):
                print(f"blendlink bake cache: reused every atlas for light group {name!r}")
                continue
            progress(progress_start + index * progress_step, f"baking light group '{name}'")
            for light, _ in lights_prev:
                light.hide_render = light not in lights
            layers.setdefault(name, {})
            for group, objects in targets.items():
                if (name, group) in skipped:
                    continue
                job_started = time.perf_counter()
                image = images[group]
                # emit=False: node-driven emission escapes mute_emission and
                # would stamp itself into EVERY layer plus the base state.
                bake_state(
                    objects, image, margins[group], emit=False,
                    bake_output=bake_outputs[group],
                    fixed_camera_appearance=fixed_camera_appearance,
                )

                # Normalize to a high percentile, not the global max: one hot
                # bulb-filament texel would otherwise crush the whole room's
                # contribution into the bottom bits of an 8-bit PNG.
                covered = bakelib.require_image_coverage(
                    image, f"light group {name!r} atlas {group!r}",
                )
                peak = bakelib.normalize_bake_image(image, covered)
                suffix = "" if group == "main" else f".{group}"
                layer_path = out_glb + f".light.{artifact_filename_token(name)}{suffix}.png"
                guide_albedo, guide_normal = (guides or {}).get(group, (None, None))
                delivery = save_resolved(
                    image, layer_path, final_sizes[group], denoise=denoise,
                    albedo=guide_albedo, normal=guide_normal,
                )
                layers[name][group] = {"path": layer_path, "maxValue": peak}
                variants.setdefault(name, {})[group] = delivery
                if timings is not None:
                    timings.append({
                        "job": f"light:{name}:{group}",
                        "status": "rebuilt",
                        "durationMs": round((time.perf_counter() - job_started) * 1000),
                        "effectiveSize": int(final_sizes[group] * supersample),
                    })
    finally:
        for light, old in lights_prev:
            light.hide_render = old
        bakelib.restore_emission(muted)
        bakelib.restore_world(original_world, black)
    return layers


def run_baked_mode(settings: dict, out_glb: str) -> dict:
    bake_started = time.perf_counter()
    bake = settings.get("bake", {})
    fixed_camera_appearance = bool(bake.get("fixedCameraAppearance"))
    size = int(bake.get("size", 2048))
    samples = int(bake.get("samples", 128))
    margin_px = int(bake.get("margin", 48))
    # Cycles bakes have no edge anti-aliasing; baking at N× and box-resolving
    # down (Blender's bilinear scale on an exact 2× grid IS a box filter) is
    # the standard workaround — quality at zero runtime cost.
    supersample = max(1, int(bake.get("supersample", 1)))
    denoise = bool(bake.get("denoise", False))
    bake_size = size * supersample
    bake_margin = margin_px * supersample
    states = bake.get("states") or [{"name": "default", "hideCollections": []}]
    incremental = settings.get("incremental") if isinstance(settings.get("incremental"), dict) else {}
    previous_fingerprints = incremental.get("fingerprints") or {}
    previous_artifacts = incremental.get("artifacts") or {}
    previous_states = incremental.get("states") or {}
    previous_state_scales = incremental.get("stateScales") or {}
    previous_light_groups = incremental.get("lightGroups") or {}
    previous_state_variants = incremental.get("stateVariants") or {}
    previous_light_variants = incremental.get("lightGroupVariants") or {}
    fingerprint_settings = {key: value for key, value in bake.items() if key != "states"}
    pipeline_digest = hashlib.sha256()
    for module_path in (os.path.abspath(__file__), os.path.abspath(bakelib.__file__)):
        with open(module_path, "rb") as module_file:
            pipeline_digest.update(module_file.read())
    fingerprint_settings["pipelineSignature"] = pipeline_digest.hexdigest()[:16]
    fingerprints = {"version": 1, "states": {}, "lightGroups": {}}
    reused_jobs = []
    invalidated_jobs = []
    job_timings = []
    if previous_fingerprints and previous_fingerprints.get("version") != 1:
        print(
            "blendlink bake cache: fingerprint version is incompatible; "
            "rebuilding every atlas job"
        )
        previous_fingerprints = {}
        previous_states = {}
        previous_state_scales = {}
        previous_light_groups = {}
        previous_state_variants = {}
        previous_light_variants = {}
    if previous_artifacts and previous_artifacts.get("version") != 1:
        print(
            "blendlink bake cache: artifact hash version is incompatible; "
            "rebuilding every atlas job"
        )
        previous_artifacts = {}
    if incremental and has_volatile_external_dependencies():
        print(
            "blendlink bake cache: linked sequence/UDIM/directory dependency is volatile; "
            "rebuilding every atlas job"
        )
        previous_fingerprints = {}
        previous_artifacts = {}
        previous_states = {}
        previous_state_scales = {}
        previous_light_groups = {}
        previous_state_variants = {}
        previous_light_variants = {}

    def artifact_reuse_failure(path, expected_hash):
        if not expected_hash:
            return "no-prior-artifact-hash"
        if not path:
            return "artifact-not-provided"
        if not os.path.isfile(path):
            return "artifact-missing"
        return None if bakelib.file_sha256(path) == expected_hash else "artifact-changed"

    def variant_reuse_failure(entries, sizes):
        """Integrity-check every required reduced atlas before reusing a job."""
        if not sizes:
            return None
        if not isinstance(entries, list):
            return "delivery-variant-not-provided"
        by_size = {
            int(entry.get("width", 0)): entry
            for entry in entries if isinstance(entry, dict)
        }
        for size in sizes:
            entry = by_size.get(int(size))
            if entry is None or not entry.get("path") or not entry.get("hash"):
                return "delivery-variant-not-provided"
            if int(entry.get("height", 0)) != int(size):
                return "delivery-variant-changed"
            if not os.path.isfile(entry["path"]):
                return "delivery-variant-missing"
            if bakelib.file_sha256(entry["path"]) != entry["hash"]:
                return "delivery-variant-changed"
        return None

    def reuse_variants(entries, canonical_path, sizes):
        """Copy an already-attested tier set into this invocation's output set."""
        by_size = {int(entry["width"]): entry for entry in entries}
        published = []
        for size in sizes:
            source = by_size[int(size)]
            destination = bakelib.delivery_variant_path(canonical_path, size)
            shutil.copyfile(source["path"], destination)
            published.append({
                "path": destination,
                "width": int(size),
                "height": int(size),
                "bytes": os.path.getsize(destination),
                "hash": bakelib.file_sha256(destination),
            })
        return published

    progress(0.10, "preparing and packing bake atlas charts")
    layout = bake_prepare_geometry(bake, supersample)
    if layout.get("_errors"):
        raise RuntimeError(
            "Atlas layout validation blocked before baking:\n  - "
            + "\n  - ".join(layout["_errors"])
        )
    atlas_of = {
        obj.name: name
        for name, entry in layout.items() if not name.startswith("_")
        for obj in entry["objects"]
    }
    atlas_layout = bakelib.capture_packed_uv_evidence(
        [obj for name, entry in layout.items() if not name.startswith("_")
         for obj in entry["objects"]],
        atlas_of,
    )
    groups = {
        name: entry for name, entry in layout.items()
        if not name.startswith("_") and entry["objects"]
    }
    bake_outputs = {
        name: entry["bakeOutput"] for name, entry in groups.items()
    }
    print(
        "blendlink bake: atlas outputs: "
        + ", ".join(f"{name}={output}" for name, output in bake_outputs.items())
    )
    output_issue = light_group_output_issue(
        bake_outputs,
        {
            obj.lightgroup for obj in bpy.context.scene.objects
            if obj.type == "LIGHT" and not obj.hide_render
            and getattr(obj, "lightgroup", "")
        },
    )
    if output_issue:
        raise RuntimeError(output_issue)
    progress(0.11, "selecting the Cycles compute backend")
    bake_device = bake_engine(samples)

    warnings = list(layout.get("_warnings", []))
    non_mesh = sorted(
        obj.name for obj in bpy.context.scene.objects
        if obj.type in ("CURVE", "FONT", "META", "SURFACE") and not obj.hide_render
    )
    if non_mesh:
        warnings.append(
            "renderable non-mesh objects are not baked and will render lit "
            f"(convert to mesh): {', '.join(non_mesh)}"
        )
    # Auto-dynamic must never be a surprise: name each lit mesh and why.
    dynamic = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        reason = dynamic_reason(
            obj, fixed_camera_appearance=fixed_camera_appearance,
        )
        if reason:
            dynamic.append(f"{obj.name} ({reason})")
    dynamic.sort()
    if dynamic:
        warnings.append(
            "dynamic (lit at runtime, excluded from the bake): " + ", ".join(dynamic)
        )
    automatic_camera_bakes = sorted(
        f"{obj.name} ({procedural.fixed_camera_appearance_bake_reason(obj)})"
        for obj in bpy.context.scene.objects
        if fixed_camera_appearance and obj.type == "MESH" and not obj.hide_render
        and procedural.fixed_camera_appearance_bake_reason(obj)
    )
    if automatic_camera_bakes:
        warnings.append(
            "automatic fixed-camera Appearance capture uses Cycles Active Camera "
            "view rays for opaque camera-dependent shading: "
            + ", ".join(automatic_camera_bakes)
            + ". These objects return to Realtime if the website camera becomes "
            "orbit/free or the atlas changes to Bake Lighting"
        )
    forced_baked = sorted(
        f"{obj.name} ({procedural.forced_bake_risk(obj)})"
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and not obj.hide_render
        and procedural.forced_bake_risk(obj)
    )
    if forced_baked:
        warnings.append(
            "explicit Baked overrides freeze normally-Realtime behavior: "
            + ", ".join(forced_baked)
        )

    # Lights assigned to a Cycles Light Group become interactive: excluded
    # from the base/state bakes, then solo-baked as additive contribution
    # layers (light adds linearly — Quake lightstyles' 30-year-old exploit).
    grouped_lights = {}
    hidden_grouped_lights = []
    for obj in bpy.context.scene.objects:
        if obj.type == "LIGHT" and getattr(obj, "lightgroup", ""):
            visibility = weblights.render_visibility(
                obj, bpy.context.scene, view_layer=bpy.context.view_layer,
            )
            if visibility.exported:
                grouped_lights.setdefault(obj.lightgroup, []).append(obj)
            else:
                hidden_grouped_lights.append((obj, visibility))
    if hidden_grouped_lights:
        warnings.append(
            "interactive light-group lights ignored because they are not "
            "render-visible: " + "; ".join(
                f"{obj.name} ({visibility.detail})"
                for obj, visibility in sorted(
                    hidden_grouped_lights, key=lambda item: item[0].name.casefold(),
                )
            )
        )
    instanced_group_lights = sorted({
        entry["object"].name
        for entry in collect_instance_source_occurrences(
            bpy.context.scene, view_layer=bpy.context.view_layer,
        ).values()
        if entry["object"].type == "LIGHT"
        and getattr(entry["object"], "lightgroup", "")
        and any(item["visible"] for item in entry["occurrences"])
    })
    if instanced_group_lights:
        raise RuntimeError(
            "Interactive Light Groups on Collection Instance source lights "
            "cannot preserve per-occurrence transforms yet. Keep these lights "
            "directly in the scene or clear their Light Group: "
            + ", ".join(instanced_group_lights)
        )
    visibility_states = [
        state["name"] for state in states if state.get("hideCollections")
    ]
    if grouped_lights and visibility_states:
        raise RuntimeError(
            "Additive Light Groups cannot be combined with lighting states that hide "
            "collections: the layer's bounce/shadows would be wrong for different geometry. "
            f"Visibility-changing states: {', '.join(visibility_states)}. "
            "Use full lighting states, or keep collection visibility identical and use Light Groups."
        )

    state_paths = {}
    state_variants = {}
    state_scales = {}
    state_visibility_membership = {
        state["name"]: state_visibility(
            state.get("hideCollections", []), settings.get("collection"),
        )
        for state in states
    }
    group_layers = {}
    light_variants = {}
    # alpha=True is the coverage contract: bake use_clear resets to
    # transparent, Cycles writes opaque texels, the background flatten
    # reads the difference. One image per atlas group.
    images = {
        name: bpy.data.images.new(
            f"blendlink-bake-{name}",
            width=entry["size"] * supersample, height=entry["size"] * supersample,
            alpha=True, float_buffer=True,
        )
        for name, entry in groups.items()
    }
    margins = {name: entry["margin"] * supersample for name, entry in groups.items()}
    final_sizes = {name: entry["size"] for name, entry in groups.items()}

    def build_bake_targets() -> dict:
        """Visible receivers per atlas, evaluated in their native objects.

        Every atlas receiver remains render-visible while only the current
        group's receivers are selected. This matches Blender's and Needle's
        multi-object bake semantics: other groups still cast shadows and
        contribute bounce, while Object Attributes, Object Info, generated
        coordinates, and transforms retain their per-object context.
        """
        targets = {}
        for name, entry in groups.items():
            visible = [
                obj for obj in entry["objects"]
                if weblights.render_visibility(
                    obj, bpy.context.scene, view_layer=bpy.context.view_layer,
                ).exported
            ]
            if visible:
                targets[name] = visible
        return targets

    def state_file(state_name: str, group: str) -> str:
        suffix = "" if group == "main" else f".{group}"
        return out_glb + f".state.{artifact_filename_token(state_name)}{suffix}.png"

    # No populated atlas means no bake jobs. Counting a phantom job here made
    # the manifest claim work was rebuilt while its explicit job lists were
    # empty, hiding the exact no-bake condition the UI is meant to explain.
    bake_jobs = (len(states) + len(grouped_lights)) * len(groups)
    per_job = 0.6 / max(bake_jobs, 1)
    job = 0
    state_guides = {}
    light_guides = {}
    target_objects = {
        obj for entry in groups.values() for obj in entry["objects"]
    }
    # Anything that is not a baked target must not cast a permanent ghost,
    # bounce, reflection, or double-occluding collision shadow into the
    # atlas. It still exports after this scoped visibility override restores.
    render_geometry_types = {
        "MESH", "CURVE", "FONT", "META", "SURFACE", "VOLUME",
        "POINTCLOUD", "CURVES",
    }
    excluded_contributors = [
        (obj, obj.hide_render)
        for obj in bpy.context.scene.objects
        if obj.type in render_geometry_types and obj not in target_objects and not obj.hide_render
        and (
            obj.type != "MESH" or is_collision_proxy(obj)
            or dynamic_reason(obj) is not None
        )
    ]
    for obj, _ in excluded_contributors:
        obj.hide_render = True
    if excluded_contributors:
        print(
            "blendlink bake: temporarily excluded non-target render contributors: "
            + ", ".join(obj.name for obj, _ in excluded_contributors)
        )
    try:
        grouped_flat = [light for lights in grouped_lights.values() for light in lights]
        grouped_prev = [(light, light.hide_render) for light in grouped_flat]
        for light, _ in grouped_prev:
            light.hide_render = True
        try:
            # Fingerprint the complete job set before executing any bake.
            # Blender's bake operator is allowed to mutate transient evaluated
            # state even though bakelib restores every authored datablock. If a
            # later fingerprint were taken after an earlier dirty job, its
            # identity could depend on whether that earlier job was rebuilt or
            # reused. This two-phase boundary makes cache identity a pure
            # function of the prepared source scene and requested visibility.
            progress(0.12, "fingerprinting all bake dependencies before execution")
            for state in states:
                saved_collections = hide_collections(
                    state.get("hideCollections", [])
                )
                try:
                    fingerprints["states"][state["name"]] = {}
                    for name in groups:
                        configure_atlas_bake(
                            bpy.context.scene, margins[name],
                            bake_outputs[name], emit=True,
                            fixed_camera_appearance=fixed_camera_appearance,
                        )
                        fingerprints["states"][state["name"]][name] = (
                            bakelib.fingerprint_bake_dependencies(
                                bpy.context.scene, layout,
                                fingerprint_settings, name,
                                f"state:{state['name']}",
                            )
                        )
                finally:
                    restore_collections(saved_collections)

            # State fingerprints intentionally exclude interactive grouped
            # lights. Restore their authored visibility for the light-layer
            # identities, matching the execution contract below, then hide
            # them again before any base-state bake starts.
            for light, old in grouped_prev:
                light.hide_render = old
            for light_name in sorted(grouped_lights):
                fingerprints["lightGroups"][light_name] = {}
                for name in groups:
                    configure_atlas_bake(
                        bpy.context.scene, margins[name], bake_outputs[name],
                        emit=False,
                        fixed_camera_appearance=fixed_camera_appearance,
                    )
                    fingerprints["lightGroups"][light_name][name] = (
                        bakelib.fingerprint_bake_dependencies(
                            bpy.context.scene, layout, fingerprint_settings,
                            name, f"light:{light_name}",
                        )
                    )
            for light, _ in grouped_prev:
                light.hide_render = True

            for state in states:
                saved_collections = hide_collections(state.get("hideCollections", []))
                state_paths[state["name"]] = {}
                state_variants[state["name"]] = {}
                state_scales[state["name"]] = {}
                dirty = []
                for name in groups:
                    path = state_file(state["name"], name)
                    configure_atlas_bake(
                        bpy.context.scene, margins[name], bake_outputs[name], emit=True,
                        fixed_camera_appearance=fixed_camera_appearance,
                    )
                    fingerprint = fingerprints["states"][state["name"]][name]
                    previous_fingerprint = (
                        (previous_fingerprints.get("states") or {})
                        .get(state["name"], {}).get(name)
                    )
                    previous_artifact_hash = (
                        (previous_artifacts.get("states") or {})
                        .get(state["name"], {}).get(name)
                    )
                    previous_path = (previous_states.get(state["name"]) or {}).get(name)
                    previous_scale = (
                        (previous_state_scales.get(state["name"]) or {}).get(name)
                    )
                    previous_variants = (
                        (previous_state_variants.get(state["name"]) or {}).get(name)
                    )
                    expected_variant_sizes = bakelib.delivery_variant_sizes(final_sizes[name])
                    job_name = f"state:{state['name']}:{name}"
                    reason = (
                        "no-prior-fingerprint" if not previous_fingerprint else
                        "dependencies-changed" if previous_fingerprint != fingerprint else
                        "scale-not-provided" if (
                            isinstance(previous_scale, bool)
                            or not isinstance(previous_scale, (int, float))
                            or previous_scale <= 0
                        ) else
                        artifact_reuse_failure(previous_path, previous_artifact_hash)
                    )
                    if reason is None:
                        reason = variant_reuse_failure(
                            previous_variants, expected_variant_sizes,
                        )
                    if reason is None:
                        reuse_started = time.perf_counter()
                        shutil.copyfile(previous_path, path)
                        state_variants[state["name"]][name] = reuse_variants(
                            previous_variants, path, expected_variant_sizes,
                        )
                        state_scales[state["name"]][name] = float(previous_scale)
                        reused_jobs.append(job_name)
                        job_timings.append({
                            "job": job_name,
                            "status": "reused",
                            "durationMs": round((time.perf_counter() - reuse_started) * 1000),
                            "effectiveSize": int(final_sizes[name] * supersample),
                        })
                        print(f"blendlink bake cache: reused state {state['name']!r} atlas {name!r}")
                    else:
                        if reason == "dependencies-changed":
                            print(
                                f"blendlink bake cache: invalidated state {state['name']!r} "
                                f"atlas {name!r} ({previous_fingerprint} -> {fingerprint})"
                            )
                        elif reason == "no-prior-fingerprint":
                            print(
                                f"blendlink bake cache: no compatible fingerprint for state "
                                f"{state['name']!r} atlas {name!r}; rebuilding"
                            )
                        else:
                            print(
                                f"blendlink bake cache: prior state {state['name']!r} "
                                f"atlas {name!r} failed integrity ({reason}); rebuilding"
                            )
                        invalidated_jobs.append({"job": job_name, "reason": reason})
                        dirty.append(name)
                    state_paths[state["name"]][name] = path
                    job += 1
                # Resolve receivers per state so hideCollections changes
                # geometry, not just lights. A fully reusable state never
                # enters Cycles.
                targets = build_bake_targets() if dirty else {}
                try:
                    state_job_started = {}
                    if denoise:
                        for guide_index, name in enumerate(dirty):
                            guide_key = (state["name"], name)
                            if name in targets and guide_key not in state_guides:
                                state_job_started[name] = time.perf_counter()
                                progress(
                                    0.14 + max(0, job - len(dirty) + guide_index) * per_job,
                                    f"baking denoise albedo guide "
                                    f"{state['name']}/{name} at "
                                    f"{final_sizes[name] * supersample}px",
                                )
                                state_guides[guide_key] = bake_denoise_guides(
                                    targets[name], final_sizes[name] * supersample,
                                    name, margins[name],
                                )
                    for name in dirty:
                        # A state-specific denoise guide is part of rebuilding
                        # this output job. Include it in the measured duration
                        # instead of hiding potentially substantial GPU work.
                        job_started = state_job_started.get(name, time.perf_counter())
                        progress(
                            0.15 + max(0, job - len(dirty)) * per_job,
                            f"baking {state['name']}/{name} at {final_sizes[name] * supersample}px",
                        )
                        if name in targets:
                            bake_state(
                                targets[name], images[name], margins[name],
                                bake_output=bake_outputs[name],
                                fixed_camera_appearance=fixed_camera_appearance,
                            )
                        else:
                            bakelib.clear_image(images[name])
                        covered = (
                            bakelib.require_image_coverage(
                                images[name],
                                f"state {state['name']!r} atlas {name!r}",
                            )
                            if name in targets else image_coverage(images[name])
                        )
                        appearance_over_white = (
                            bakelib.clipped_fraction(images[name], covered)
                            if bake_outputs[name] == "appearance" else 0.0
                        )
                        state_scale = bakelib.normalize_bake_image(images[name], covered)
                        state_scales[state["name"]][name] = state_scale
                        if appearance_over_white > 0.001:
                            print(
                                f"blendlink bake: state {state['name']!r} atlas {name!r} "
                                f"preserved {appearance_over_white * 100:.1f}% HDR texels with "
                                f"runtime scale {state_scale:.4g} instead of clipping them"
                            )
                        residual_clip = bakelib.clipped_fraction(images[name], covered)
                        if residual_clip > 0.001:
                            warnings.append(
                                f"state '{state['name']}' atlas '{name}': "
                                f"{residual_clip * 100:.2f}% extreme texels still exceed 1.0 "
                                "after robust HDR range preservation; reduce isolated light or "
                                "emission spikes to keep every highlight"
                            )
                        guide_albedo, guide_normal = state_guides.get(
                            (state["name"], name), (None, None),
                        )
                        state_variants[state["name"]][name] = save_resolved(
                            images[name], state_paths[state["name"]][name], final_sizes[name],
                            denoise=denoise, albedo=guide_albedo, normal=guide_normal,
                        )
                        job_timings.append({
                            "job": f"state:{state['name']}:{name}",
                            "status": "rebuilt",
                            "durationMs": round((time.perf_counter() - job_started) * 1000),
                            "effectiveSize": int(final_sizes[name] * supersample),
                        })
                finally:
                    restore_collections(saved_collections)
        finally:
            for light, old in grouped_prev:
                light.hide_render = old

        if grouped_lights:
            progress(
                0.15 + job * per_job,
                "checking interactive light-group bake cache",
            )
            reused_layers = {}
            skipped_layers = set()
            for light_name in sorted(grouped_lights):
                for name in groups:
                    configure_atlas_bake(
                        bpy.context.scene, margins[name], bake_outputs[name], emit=False,
                        fixed_camera_appearance=fixed_camera_appearance,
                    )
                    fingerprint = fingerprints["lightGroups"][light_name][name]
                    previous_fingerprint = (
                        (previous_fingerprints.get("lightGroups") or {})
                        .get(light_name, {}).get(name)
                    )
                    previous_artifact_hash = (
                        (previous_artifacts.get("lightGroups") or {})
                        .get(light_name, {}).get(name)
                    )
                    previous_layer = (previous_light_groups.get(light_name) or {}).get(name)
                    previous_variants = (
                        (previous_light_variants.get(light_name) or {}).get(name)
                    )
                    expected_variant_sizes = bakelib.delivery_variant_sizes(final_sizes[name])
                    job_name = f"light:{light_name}:{name}"
                    previous_path = previous_layer.get("path") if isinstance(previous_layer, dict) else None
                    reason = (
                        "no-prior-fingerprint" if not previous_fingerprint else
                        "dependencies-changed" if previous_fingerprint != fingerprint else
                        artifact_reuse_failure(previous_path, previous_artifact_hash)
                    )
                    if reason is None:
                        reason = variant_reuse_failure(
                            previous_variants, expected_variant_sizes,
                        )
                    if reason is not None:
                        if reason == "dependencies-changed":
                            print(
                                f"blendlink bake cache: invalidated light group {light_name!r} "
                                f"atlas {name!r} ({previous_fingerprint} -> {fingerprint})"
                            )
                        elif reason == "no-prior-fingerprint":
                            print(
                                f"blendlink bake cache: no compatible fingerprint for light group "
                                f"{light_name!r} atlas {name!r}; rebuilding"
                            )
                        else:
                            print(
                                f"blendlink bake cache: prior light group {light_name!r} "
                                f"atlas {name!r} failed integrity ({reason}); rebuilding"
                            )
                        invalidated_jobs.append({
                            "job": job_name,
                            "reason": reason,
                        })
                        continue
                    suffix = "" if name == "main" else f".{name}"
                    path = out_glb + f".light.{artifact_filename_token(light_name)}{suffix}.png"
                    reuse_started = time.perf_counter()
                    shutil.copyfile(previous_path, path)
                    light_variants.setdefault(light_name, {})[name] = reuse_variants(
                        previous_variants, path, expected_variant_sizes,
                    )
                    reused_layers.setdefault(light_name, {})[name] = {
                        "path": path, "maxValue": float(previous_layer.get("maxValue", 1.0)),
                    }
                    skipped_layers.add((light_name, name))
                    reused_jobs.append(job_name)
                    job_timings.append({
                        "job": job_name,
                        "status": "reused",
                        "durationMs": round((time.perf_counter() - reuse_started) * 1000),
                        "effectiveSize": int(final_sizes[name] * supersample),
                    })
            dirty_light_jobs = len(grouped_lights) * len(groups) - len(skipped_layers)
            targets = build_bake_targets() if dirty_light_jobs else {}
            if denoise and dirty_light_jobs:
                for name in targets:
                    if name not in light_guides:
                        progress(
                            0.15 + job * per_job,
                            f"baking shared denoise albedo guide for interactive "
                            f"lights/{name} at {final_sizes[name] * supersample}px",
                        )
                        light_guides[name] = bake_denoise_guides(
                            targets[name], final_sizes[name] * supersample,
                            name, margins[name],
                        )
            group_layers = bake_light_groups(
                targets, images, margins, final_sizes, grouped_lights, out_glb,
                bake_outputs,
                progress_start=0.15 + job * per_job, progress_step=per_job,
                denoise=denoise, guides=light_guides,
                reused=reused_layers, skipped=skipped_layers,
                variants=light_variants,
                timings=job_timings, supersample=supersample,
                fixed_camera_appearance=fixed_camera_appearance,
            )
    finally:
        for obj, was_hidden in excluded_contributors:
            obj.hide_render = was_hidden
        for image in images.values():
            if image.name in bpy.data.images:
                bpy.data.images.remove(image)
        for albedo, normal in [*state_guides.values(), *light_guides.values()]:
            for guide in (albedo, normal):
                if guide is not None and guide.name in bpy.data.images:
                    bpy.data.images.remove(guide)

    # Appearance atlases retain the legacy "bake is the painting" material
    # replacement. Lighting atlases instead ship authored PBR graphs plus a
    # separate TEXCOORD_n; the runtime binds the state PNG as lightMap.
    progress(0.78, "finalizing appearance materials and PBR lightmaps")
    first_state = states[0]["name"]
    baked_by_group = {}
    for name in groups:
        if bake_outputs[name] != "appearance":
            continue
        # Embed a useful 1024px-or-smaller bootstrap for fast first paint,
        # while the canonical full PNG and all bakelib-authored tiers remain
        # external delivery choices. The runtime promotes only when the
        # actual viewport/device policy needs more detail.
        bootstrap_candidates = [
            variant for variant in state_variants[first_state][name]
            if int(variant["width"]) <= 1024
        ]
        bootstrap = (
            max(bootstrap_candidates, key=lambda variant: int(variant["width"]))["path"]
            if bootstrap_candidates else state_paths[first_state][name]
        )
        baked = bpy.data.images.load(bootstrap, check_existing=False)
        baked.colorspace_settings.name = "sRGB"
        baked_by_group[name] = baked
        if bootstrap != state_paths[first_state][name]:
            print(
                f"blendlink delivery: embedded {baked.size[0]}px bootstrap for "
                f"appearance atlas {name!r}; canonical {final_sizes[name]}px remains external"
            )

    baked_objects = render_meshes(
        fixed_camera_appearance=fixed_camera_appearance,
    )
    appearance_objects = [
        obj for obj in baked_objects
        if bake_outputs[atlas_of[obj.name]] == "appearance"
    ]
    if appearance_objects:
        rebuild_baked_materials(
            appearance_objects,
            baked_by_group,
            atlas_for=lambda obj: atlas_of[obj.name],
    )
    lighting_objects = []
    for obj in baked_objects:
        output = bake_outputs[atlas_of[obj.name]]
        if output == "appearance":
            # Legacy output: atlas becomes TEXCOORD_0 because its generated
            # unlit material has no reason to ship the source UV sets.
            mesh = obj.data
            for layer in [layer for layer in mesh.uv_layers if layer.name != ATLAS_UV]:
                mesh.uv_layers.remove(layer)
            mesh.uv_layers.active_index = 0
            mesh.uv_layers[0].active_render = True
            stamp_bake_output_metadata(obj, output)
        else:
            channel = stamp_bake_output_metadata(obj, output)
            lighting_objects.append(obj)
            print(
                f"blendlink bake: {obj.name} preserves authored PBR materials; "
                f"{ATLAS_UV} exports as TEXCOORD_{channel}"
            )
    if lighting_objects:
        fork_lighting_materials(
            lighting_objects,
            atlas_for=lambda obj: atlas_of[obj.name],
            channel_for=lambda obj: obj["blendlink_lightmap_uv"],
        )

    artifact_hashes = {
        "version": 1,
        "states": {
            state_name: {
                group: bakelib.file_sha256(path)
                for group, path in by_group.items()
            }
            for state_name, by_group in state_paths.items()
        },
        "lightGroups": {
            light_name: {
                group: bakelib.file_sha256(layer["path"])
                for group, layer in by_group.items()
            }
            for light_name, by_group in group_layers.items()
        },
    }
    all_jobs = [
        f"state:{state_name}:{group}"
        for state_name, by_group in fingerprints["states"].items()
        for group in by_group
    ] + [
        f"light:{light_name}:{group}"
        for light_name, by_group in fingerprints["lightGroups"].items()
        for group in by_group
    ]
    reused_set = set(reused_jobs)
    rebuilt_jobs = [name for name in all_jobs if name not in reused_set]
    return {
        "states": {name: path for name, path in state_paths.items()},
        "stateScales": state_scales,
        "bakeOutputs": bake_outputs,
        "lightmapUvs": {
            name: {
                obj.name: int(obj["blendlink_lightmap_uv"])
                for obj in groups[name]["objects"]
            }
            for name, output in bake_outputs.items() if output == "lighting"
        },
        "stateVisibility": state_visibility_membership,
        "lightGroups": group_layers,
        "variants": {
            "states": state_variants,
            "lightGroups": light_variants,
        },
        "warnings": warnings,
        "fingerprints": fingerprints,
        "artifacts": artifact_hashes,
        "incremental": {
            "totalJobs": bake_jobs,
            "reusedJobs": len(reused_jobs),
            "rebuiltJobs": bake_jobs - len(reused_jobs),
            "reused": reused_jobs,
            "rebuilt": rebuilt_jobs,
            "invalidated": invalidated_jobs,
            "execution": {
                "profile": "preview" if settings.get("draft") else "final",
                "durationMs": round((time.perf_counter() - bake_started) * 1000),
                "samples": samples,
                "supersample": supersample,
                "denoise": denoise,
                **bake_device,
                "jobs": job_timings,
            },
        },
        "atlasLayout": atlas_layout,
    }


def collect_instance_source_occurrences(scene, view_layer=None) -> dict:
    """Compatibility seam for the addon's canonical instance traversal."""
    return weblights.collect_instance_source_occurrences(
        scene, view_layer=view_layer,
    )


def published_instance_source_objects(
    scene, exported_node_names: set[str], view_layer=None,
) -> list:
    """Visible instance sources whose root instance survived final GLB scope."""
    records = collect_instance_source_occurrences(scene, view_layer=view_layer)
    objects = []
    for entry in records.values():
        if any(
            occurrence["visible"]
            and occurrence["root"].name in exported_node_names
            for occurrence in entry["occurrences"]
        ):
            objects.append(entry["object"])
    return objects


def _object_in_gltf_export_scope(obj, view_layer, export_kwargs: dict | None) -> bool:
    """Mirror the stock exporter's object-scope gates that affect instances.

    Source objects are shared by every Collection Instance. A visible instance
    outside a selection/collection export must not keep that source enabled for
    a render-hidden instance inside the actual export scope.
    """
    if not export_kwargs:
        return True
    if bool(export_kwargs.get("use_selection")):
        select_get = getattr(obj, "select_get", None)
        if not callable(select_get) or not bool(select_get()):
            return False
    if bool(export_kwargs.get("use_visible")):
        visible_get = getattr(obj, "visible_get", None)
        try:
            if not callable(visible_get) or not bool(
                visible_get(view_layer=view_layer)
            ):
                return False
        except (RuntimeError, TypeError):
            return False

    collection_name = export_kwargs.get("collection")
    if isinstance(collection_name, str) and collection_name:
        collection = bpy.data.collections.get(collection_name)
        if collection is None:
            raise ValueError(
                f"glTF export collection {collection_name!r} does not exist"
            )
        if obj.name not in collection.all_objects:
            return False

    if bool(export_kwargs.get("use_active_collection")):
        active_layer = getattr(view_layer, "active_layer_collection", None)
        collection = getattr(active_layer, "collection", None)
        if collection is None:
            return False
        members = (
            collection.all_objects
            if bool(export_kwargs.get("use_active_collection_with_nested"))
            else collection.objects
        )
        if obj.name not in members:
            return False
    return True


def diagnostic_export_objects(
    scene, view_layer=None, export_kwargs: dict | None = None,
) -> tuple:
    """Objects whose source fidelity can affect the stock GLB export scope.

    Collection/selection gates and Blender render/view-layer visibility are
    applied before expensive procedural/material analysis. Visible Collection
    Instance sources are included because their meshes and materials can
    publish even when the source collection is not directly in
    ``scene.objects``.
    """
    objects = {}
    for obj in scene.objects:
        if not _object_in_gltf_export_scope(obj, view_layer, export_kwargs):
            continue
        if not weblights.render_visibility(
            obj, scene, view_layer=view_layer,
        ).exported:
            continue
        objects[obj.as_pointer()] = obj

    for identity, entry in collect_instance_source_occurrences(
        scene, view_layer=view_layer,
    ).items():
        if any(
            occurrence["visible"]
            and _object_in_gltf_export_scope(
                occurrence["root"], view_layer, export_kwargs,
            )
            for occurrence in entry["occurrences"]
        ):
            objects[identity] = entry["object"]
    return tuple(sorted(objects.values(), key=lambda obj: obj.name.casefold()))


def _grease_pencil_stroke_evidence(obj) -> dict:
    """Count stored drawings without pretending they are stock-glTF meshes.

    Blender 4.2's legacy Grease Pencil frames expose ``strokes`` directly;
    current Blender frames expose them through ``frame.drawing``.  Supporting
    both inspection shapes keeps the refusal truthful across Blendlink's
    Blender compatibility floor.  An unfamiliar nonempty representation is a
    hard inspection error rather than an excuse to approve lossy export.
    """
    layers = getattr(getattr(obj, "data", None), "layers", ())
    stored_frames = 0
    nonempty_frames = 0
    stored_strokes = 0
    stored_points = 0
    for layer in layers:
        for frame in getattr(layer, "frames", ()):
            stored_frames += 1
            drawing = getattr(frame, "drawing", None)
            strokes = getattr(
                drawing if drawing is not None else frame, "strokes", None,
            )
            if strokes is None:
                raise RuntimeError(
                    f"cannot inspect Grease Pencil drawing {obj.name!r}: "
                    f"frame {getattr(frame, 'frame_number', 'unknown')} exposes "
                    "neither drawing.strokes nor strokes"
                )
            count = len(strokes)
            stored_strokes += count
            stored_points += sum(
                len(getattr(stroke, "points", ())) for stroke in strokes
            )
            if count:
                nonempty_frames += 1
    return {
        "storedFrames": stored_frames,
        "nonemptyFrames": nonempty_frames,
        "storedStrokes": stored_strokes,
        "storedPoints": stored_points,
    }


def _hair_curves_evidence(obj, depsgraph) -> dict:
    """Count authored and evaluated modern Hair Curves before stock glTF drops them."""
    data = getattr(obj, "data", None)
    if data is None:
        raise RuntimeError(
            f"cannot inspect Hair Curves object {obj.name!r}: it has no data-block"
        )
    try:
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_data = evaluated.data
        authored_curves = len(data.curves)
        authored_points = len(data.points)
        evaluated_curves = len(evaluated_data.curves)
        evaluated_points = len(evaluated_data.points)
    except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
        raise RuntimeError(
            f"cannot inspect evaluated Hair Curves geometry {obj.name!r}: {error}"
        ) from error
    return {
        "authoredCurves": authored_curves,
        "authoredPoints": authored_points,
        "evaluatedCurves": evaluated_curves,
        "evaluatedPoints": evaluated_points,
    }


def unsupported_renderable_issues(objects) -> list[dict]:
    """Return proven renderable data that Blender's stock glTF drops.

    This is deliberately narrower than an object-type allowlist.  Empties and
    application anchors are useful transform nodes, while legacy
    Curve/Surface/Font objects have a stock exporter conversion path. Grease
    Pencil, modern Hair Curves, and render-visible legacy HAIR/PATH particle
    systems are evidenced losses: Blender 5.2 keeps the owning nodes/emitters
    but emits no corresponding renderable geometry. Scope and render
    visibility are resolved by ``diagnostic_export_objects`` before callers
    cross this interface.
    """
    issues = []
    depsgraph = None
    for obj in objects:
        object_type = getattr(obj, "type", None)
        for particle_system in getattr(obj, "particle_systems", ()):
            settings = getattr(particle_system, "settings", None)
            if settings is None \
                    or getattr(settings, "type", None) != "HAIR" \
                    or getattr(settings, "render_type", None) != "PATH" \
                    or int(getattr(settings, "count", 0)) <= 0:
                continue
            modifier = next((
                item for item in getattr(obj, "modifiers", ())
                if getattr(item, "type", None) == "PARTICLE_SYSTEM"
                and getattr(item, "particle_system", None) == particle_system
            ), None)
            if modifier is not None and not getattr(modifier, "show_render", True):
                continue
            issues.append({
                "code": "geometry.legacy-particle-path-unsupported",
                "object": obj.name,
                "objectType": obj.type,
                "system": particle_system.name,
                "particleType": settings.type,
                "renderType": settings.render_type,
                "particleCount": int(settings.count),
                "hairSteps": int(getattr(settings, "hair_step", 5)),
                "childType": str(getattr(settings, "child_type", "NONE")),
            })
        if object_type in {"GREASEPENCIL", "GPENCIL"}:
            evidence = _grease_pencil_stroke_evidence(obj)
            if evidence["storedStrokes"] == 0:
                continue
            issues.append({
                "code": "geometry.grease-pencil-unsupported",
                "object": obj.name,
                "objectType": obj.type,
                **evidence,
            })
            continue
        if object_type != "CURVES":
            continue
        if depsgraph is None:
            depsgraph = bpy.context.evaluated_depsgraph_get()
        evidence = _hair_curves_evidence(obj, depsgraph)
        if evidence["evaluatedCurves"] == 0 or evidence["evaluatedPoints"] == 0:
            continue
        issues.append({
            "code": "geometry.hair-curves-unsupported",
            "object": obj.name,
            "objectType": obj.type,
            **evidence,
        })
    return issues


def realizable_renderable_plan(objects) -> dict:
    """Split unsupported renderables into budgeted realizations and refusals.

    GEO-EVAL-001: Grease Pencil, Hair Curves, and childless legacy HAIR/PATH
    particle parents realize to ordinary meshes through the depsgraph when
    their deterministic triangle estimate fits ``MAX_REALIZED_TRIANGLES``.
    Everything else keeps the loud refusal — evaluated strand counts are
    unbounded by nature, and an over-budget scene must name its numbers
    instead of publishing a payload surprise.  This runs for plan-only and
    real exports alike and must never mutate the scene.
    """
    realize = []
    refuse = []
    for issue in unsupported_renderable_issues(objects):
        code = issue["code"]
        if code == "geometry.hair-curves-unsupported":
            triangles = bakelib.estimate_realized_strand_triangles(
                issue["evaluatedCurves"], issue["evaluatedPoints"],
            )
            entry = {**issue, "kind": "hairCurves",
                     "estimatedTriangles": triangles}
            if triangles <= bakelib.MAX_REALIZED_TRIANGLES:
                realize.append(entry)
            else:
                refuse.append(entry)
            continue
        if code == "geometry.grease-pencil-unsupported":
            triangles = bakelib.estimate_realized_strand_triangles(
                issue["storedStrokes"], issue["storedPoints"],
            )
            entry = {**issue, "kind": "greasePencil",
                     "estimatedTriangles": triangles}
            if triangles <= bakelib.MAX_REALIZED_TRIANGLES:
                realize.append(entry)
            else:
                refuse.append(entry)
            continue
        if code == "geometry.legacy-particle-path-unsupported":
            keys_per_parent = issue["hairSteps"] + 1
            triangles = bakelib.estimate_realized_strand_triangles(
                issue["particleCount"],
                issue["particleCount"] * keys_per_parent,
            )
            entry = {**issue, "kind": "particleStrands",
                     "estimatedTriangles": triangles}
            if issue["childType"] != "NONE":
                entry["refusalReason"] = "children"
                refuse.append(entry)
            elif triangles > bakelib.MAX_REALIZED_TRIANGLES:
                entry["refusalReason"] = "budget"
                refuse.append(entry)
            else:
                realize.append(entry)
            continue
        refuse.append(dict(issue))
    return {
        "budgetTriangles": bakelib.MAX_REALIZED_TRIANGLES,
        "profileSides": bakelib.REALIZED_PROFILE_SIDES,
        "realize": realize,
        "refuse": refuse,
    }


def enforce_supported_renderable_transport(objects) -> None:
    """Refuse a healthy-looking GLB that silently lost authored artwork.

    Renderables the realization route carries within budget are not
    refused; ``realize_unsupported_renderables`` emits them as ordinary
    meshes before the stock exporter runs.
    """
    issues = realizable_renderable_plan(objects)["refuse"]
    if not issues:
        return
    grease_pencil = [
        item for item in issues
        if item["code"] == "geometry.grease-pencil-unsupported"
    ]
    hair_curves = [
        item for item in issues
        if item["code"] == "geometry.hair-curves-unsupported"
    ]
    particle_paths = [
        item for item in issues
        if item["code"] == "geometry.legacy-particle-path-unsupported"
    ]
    details = []
    if particle_paths:
        configured_particles = sum(
            item["particleCount"] for item in particle_paths
        )
        examples = ", ".join(
            f"{item['object']!r}/{item['system']!r}"
            for item in particle_paths[:8]
        )
        remainder = len(particle_paths) - 8
        if remainder > 0:
            examples += f" (+{remainder} more)"
        details.append(
            f"  - {len(particle_paths)} render-visible legacy HAIR/PATH "
            f"particle system(s) are configured for {configured_particles} "
            f"parent particle(s): {examples}. Blender's stock glTF exporter "
            "can expand object/collection particle instances, but it does not "
            "serialize legacy particle paths as renderable primitives; the "
            "emitter mesh can survive while this artwork disappears. Convert "
            "the paths to an ordinary mesh or card representation and visually "
            "validate its material/alpha before publishing, or keep the scene "
            "blocked until a dedicated particle adapter can prove paths, "
            "children, thickness, materials, animation, and payload cost."
        )
    if grease_pencil:
        total_frames = sum(item["nonemptyFrames"] for item in grease_pencil)
        total_strokes = sum(item["storedStrokes"] for item in grease_pencil)
        examples = ", ".join(repr(item["object"]) for item in grease_pencil[:8])
        remainder = len(grease_pencil) - 8
        if remainder > 0:
            examples += f" (+{remainder} more)"
        details.append(
            f"  - {len(grease_pencil)} render-visible Grease Pencil object(s) "
            f"contain {total_strokes} stored stroke(s) across {total_frames} "
            f"nonempty drawing frame(s): {examples}. Blender's stock glTF "
            "exporter keeps their transform nodes but emits no renderable mesh, "
            "so publishing would silently remove this artwork. Create and "
            "visually validate a mesh or baked-still proxy, then mark the "
            "original source -noimp (or blendlink_role='noimp'); otherwise keep "
            "the scene blocked until a dedicated Grease Pencil adapter can prove "
            "strokes, fills, opacity, depth order, and animation."
        )
    if hair_curves:
        total_curves = sum(item["evaluatedCurves"] for item in hair_curves)
        total_points = sum(item["evaluatedPoints"] for item in hair_curves)
        examples = ", ".join(repr(item["object"]) for item in hair_curves[:8])
        remainder = len(hair_curves) - 8
        if remainder > 0:
            examples += f" (+{remainder} more)"
        details.append(
            f"  - {len(hair_curves)} render-visible Hair Curves object(s) evaluate "
            f"to {total_curves} curve(s) and {total_points} point(s): {examples}. "
            "Blender's stock glTF exporter keeps their transform nodes but emits "
            "no renderable mesh, so publishing would silently remove the hair/fur. "
            "Create and visually validate mesh strands/cards or a baked-still "
            "proxy, then mark the original source -noimp (or "
            "blendlink_role='noimp'); otherwise keep the scene blocked until a "
            "dedicated Hair Curves adapter can prove evaluated strands, radii, "
            "materials, Geometry Nodes, and animation."
        )
    budgeted = [item for item in issues if item.get("estimatedTriangles")]
    if budgeted:
        examples = "; ".join(
            f"{item['object']!r}"
            + (f"/{item['system']!r}" if item.get("system") else "")
            + f" estimates {item['estimatedTriangles']} triangle(s)"
            + (
                " and configures particle children, which realization does "
                "not carry yet"
                if item.get("refusalReason") == "children" else ""
            )
            for item in budgeted[:8]
        )
        details.append(
            f"  - Evaluated-geometry realization budget: "
            f"{bakelib.MAX_REALIZED_TRIANGLES} triangles per object "
            f"({bakelib.REALIZED_PROFILE_SIDES}-side strand profile). "
            f"{examples}. Reduce strand/point/particle counts or split the "
            "object to enter the realization route."
        )
    raise SystemExit("Unsupported renderable geometry blocked:\n" + "\n".join(details))


def realize_unsupported_renderables(scene, *, view_layer, export_kwargs, log=print):
    """Emit budgeted unsupported renderables as ordinary meshes for one export.

    Grease Pencil and Hair Curves objects are replaced by a same-named mesh
    carrier (the source is renamed aside and render-hidden so bindings stay
    rename-stable); childless legacy HAIR/PATH particle systems add one new
    ``emitter.system`` strand mesh beside their surviving emitter.  Sources
    are read, never written beyond name/visibility; ``restore`` reverses
    everything after the exporter runs, success or failure.
    """
    objects = diagnostic_export_objects(
        scene, view_layer=view_layer, export_kwargs=export_kwargs,
    )
    plan = realizable_renderable_plan(objects)
    if not plan["realize"]:
        return None
    changed = {"hosts": [], "renamed": [], "hidden": []}
    try:
        for entry in plan["realize"]:
            source = scene.objects.get(entry["object"])
            if source is None:
                raise RuntimeError(
                    f"realizable object {entry['object']!r} disappeared "
                    "before realization"
                )
            label = (
                f"{entry['object']}/{entry['system']}"
                if entry.get("system") else entry["object"]
            )
            if entry["kind"] == "particleStrands":
                strand_curves = None
                strand_source = None
                try:
                    strand_curves = bakelib.build_particle_strand_curves(
                        source, entry["system"], label=label,
                    )
                    strand_source = bpy.data.objects.new(
                        f"BLENDLINK_REALIZE_SOURCE.{label}", strand_curves,
                    )
                    scene.collection.objects.link(strand_source)
                    bpy.context.view_layer.update()
                    mesh = bakelib.realize_object_to_mesh_data(
                        strand_source, kind="strands", label=label, log=log,
                    )
                finally:
                    if strand_source is not None and bpy.data.objects.get(
                            strand_source.name) is strand_source:
                        bpy.data.objects.remove(strand_source, do_unlink=True)
                    bakelib.remove_particle_strand_curves(strand_curves)
                host = bpy.data.objects.new(
                    f"{entry['object']}.{entry['system']}", mesh,
                )
                host.matrix_world = source.matrix_world.copy()
                scene.collection.objects.link(host)
                changed["hosts"].append(host)
                entry["realizedNode"] = host.name
                entry["realizedTriangles"] = sum(
                    len(polygon.vertices) - 2 for polygon in mesh.polygons
                )
                continue
            kind = (
                "greasePencil" if entry["kind"] == "greasePencil"
                else "strands"
            )
            mesh = bakelib.realize_object_to_mesh_data(
                source, kind=kind, label=label, log=log,
            )
            original_name = source.name
            source.name = f"{original_name}.blendlink-realized-source"
            changed["renamed"].append((source, original_name))
            if not source.hide_render:
                source.hide_render = True
                changed["hidden"].append(source)
            host = bpy.data.objects.new(original_name, mesh)
            host.matrix_world = source.matrix_world.copy()
            for key in source.keys():
                if str(key).startswith("blendlink_"):
                    host[key] = source[key]
            scene.collection.objects.link(host)
            changed["hosts"].append(host)
            entry["realizedNode"] = host.name
            entry["realizedTriangles"] = sum(
                len(polygon.vertices) - 2 for polygon in mesh.polygons
            )
        bpy.context.view_layer.update()
        changed["plan"] = plan
        return changed
    except BaseException:
        restore_realized_renderables(changed)
        raise


def restore_realized_renderables(changed) -> None:
    """Reverse ``realize_unsupported_renderables`` exactly, collecting errors."""
    if not changed:
        return
    errors = []
    for host in changed.get("hosts", ()):
        try:
            mesh = getattr(host, "data", None)
            if bpy.data.objects.get(host.name) is host:
                bpy.data.objects.remove(host, do_unlink=True)
            if mesh is not None and bpy.data.meshes.get(mesh.name) is mesh:
                bpy.data.meshes.remove(mesh)
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"realized host: {error}")
    for source in changed.get("hidden", ()):
        try:
            source.hide_render = False
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"realized source visibility: {error}")
    for source, original_name in changed.get("renamed", ()):
        try:
            source.name = original_name
        except (AttributeError, ReferenceError, RuntimeError, TypeError) as error:
            errors.append(f"realized source name: {error}")
    if errors:
        raise RuntimeError(
            "realized-geometry restoration failed: " + "; ".join(errors)
        )


def noimp_objects() -> set:
    """Directly excluded objects plus their complete parent hierarchy."""
    roots = []
    for obj in bpy.context.scene.objects:
        if is_noimp_designation(obj.name, obj):
            roots.append(obj)
    for entry in collect_instance_source_occurrences(
        bpy.context.scene, view_layer=bpy.context.view_layer,
    ).values():
        obj = entry["object"]
        if is_noimp_designation(obj.name, obj):
            roots.append(obj)
    excluded = set(roots)
    for root in roots:
        excluded.update(root.children_recursive)
    return excluded


def remove_noimp_objects() -> list[str]:
    """Godot's -noimp convention: never export object or descendants.

    The blendlink_role custom property is the explicit override channel. The
    complete removed set is returned so exclusion is never silent.
    """
    excluded = noimp_objects()
    removed = [obj.name for obj in excluded]

    def parent_depth(obj) -> int:
        """Blender 5.2 removed Object.parent_recursive; compute it portably."""
        depth = 0
        parent = obj.parent
        seen = set()
        while parent is not None and parent.as_pointer() not in seen:
            seen.add(parent.as_pointer())
            depth += 1
            parent = parent.parent
        return depth

    # Remove deepest descendants first so unlinking a parent cannot obscure
    # an explicitly reported child from this disposable export transaction.
    for obj in sorted(excluded, key=parent_depth, reverse=True):
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    return sorted(removed)


def enforce_export_render_visibility(
    scene, view_layer=None, export_kwargs: dict | None = None,
) -> list[list]:
    """Make Blender's complete render visibility legible to its glTF exporter.

    Blender's ``use_renderable`` filter handles an object's own render toggle
    and directly linked hidden collections, but Blender 5.x does not account
    for a visible child collection beneath a render-hidden ancestor, and it
    ignores source-object ``hide_render`` while expanding Collection Instances.
    The throwaway export transaction stamps direct objects and temporarily
    unlinks fully hidden instance sources, then restores every exact flag and
    collection membership even when export fails.
    """
    changed = []
    sources = collect_instance_source_occurrences(scene, view_layer=view_layer)
    candidates = {}
    scene_identities = set()
    for obj in scene.objects:
        pointer = getattr(obj, "as_pointer", None)
        identity = int(pointer()) if callable(pointer) else id(obj)
        candidates[identity] = obj
        scene_identities.add(identity)
    for identity, entry in sources.items():
        candidates.setdefault(identity, entry["object"])

    def scoped_visibility(identity, obj):
        direct_in_scope = identity in scene_identities \
            and _object_in_gltf_export_scope(obj, view_layer, export_kwargs)
        scoped_instance_occurrences = tuple(
            item for item in sources.get(identity, {}).get("occurrences", ())
            if _object_in_gltf_export_scope(
                item["root"], view_layer, export_kwargs,
            )
        )
        direct_visibility = (
            weblights.render_visibility(obj, scene, view_layer=view_layer)
            if direct_in_scope
            else None
        )
        return direct_in_scope, scoped_instance_occurrences, direct_visibility

    # Preflight the occurrence-level cases before mutating any datablock. An
    # object-level hide/unlink transaction cannot preserve one visible source
    # occurrence while removing another, and an exception after partial
    # mutation would leave the caller without a restore journal.
    for identity, obj in candidates.items():
        direct_in_scope, scoped_instance_occurrences, direct_visibility = \
            scoped_visibility(identity, obj)
        if not direct_in_scope and not scoped_instance_occurrences:
            continue
        surviving_occurrences = tuple(
            item for item in scoped_instance_occurrences
            if weblights.render_visibility(
                item["root"], scene, view_layer=view_layer,
            ).exported
        )
        occurrence_states = [
            bool(item["visible"]) for item in surviving_occurrences
        ]
        scoped_states = (
            ([bool(direct_visibility.exported)]
             if direct_visibility is not None else [])
            + occurrence_states
        )
        if scoped_states and any(scoped_states) and not all(scoped_states):
            occurrence_paths = sorted({
                " / ".join(collection.name for collection in item["collections"])
                for item in surviving_occurrences
            })
            raise RuntimeError(
                "Blendlink cannot preserve mixed direct/Collection Instance "
                f"render visibility for {obj.name!r}: Blender's glTF exporter "
                "filters this source object as one unit and would publish an "
                "extra or missing occurrence. Make all occurrences consistently "
                "render-visible/hidden, or realize the intended instance before "
                "publishing. Instance paths: "
                + ("; ".join(occurrence_paths) or "<none>")
            )

    for identity, obj in candidates.items():
        direct_in_scope, scoped_instance_occurrences, direct_visibility = \
            scoped_visibility(identity, obj)
        # Do not mutate unselected/out-of-collection data the stock exporter
        # cannot visit. This matters for linked read-only libraries as well as
        # keeping the transaction as small as possible.
        if not direct_in_scope and not scoped_instance_occurrences:
            continue
        instance_visible = any(
            item["visible"] for item in scoped_instance_occurrences
        )
        if (direct_visibility and direct_visibility.exported) or instance_visible:
            continue
        source_occurrences = scoped_instance_occurrences
        if direct_visibility is not None:
            detail = direct_visibility.detail
        elif source_occurrences:
            paths = sorted({
                " / ".join(collection.name for collection in item["collections"])
                for item in source_occurrences
            })
            detail = (
                "all Collection Instance source paths are render-hidden: "
                + "; ".join(paths)
            )
        else:
            detail = "no render-visible export path"
        print(
            f"blendlink: excluding render-hidden {obj.type.lower()} "
            f"{obj.name!r}: {detail}"
        )
        # Blender 5.2's glTF exporter honors hide_render for direct objects but
        # ignores it while expanding Collection Instances. Fully hidden source
        # objects therefore have to leave the throwaway export graph. Preserve
        # every exact membership so authored data is restored on success/fail.
        unlink_source = bool(scoped_instance_occurrences) and not instance_visible
        if obj.hide_render and not unlink_source:
            continue
        record = [obj, bool(obj.hide_render), []]
        changed.append(record)
        try:
            obj.hide_render = True
            if unlink_source:
                for collection in tuple(obj.users_collection):
                    collection.objects.unlink(obj)
                    record[2].append(collection)
        except Exception as error:
            restore_export_render_visibility(changed)
            raise RuntimeError(
                f"could not enforce render visibility for {obj.name!r}: "
                f"{type(error).__name__}: {error}"
            ) from error
    return changed


def restore_export_render_visibility(changed: list[list]) -> None:
    """Restore temporary object flags and Collection Instance memberships."""
    errors = []
    for record in reversed(changed):
        obj, previous = record[:2]
        collections = record[2] if len(record) > 2 else ()
        for collection in collections:
            try:
                if obj.name not in collection.objects:
                    collection.objects.link(obj)
            except Exception as error:
                errors.append(
                    f"{obj.name} -> {getattr(collection, 'name', 'collection')}: "
                    f"{type(error).__name__}: {error}"
                )
        try:
            obj.hide_render = previous
        except Exception as error:
            errors.append(f"{obj.name}: {type(error).__name__}: {error}")
    if errors:
        raise RuntimeError(
            "could not restore render visibility after glTF export: "
            + "; ".join(errors)
        )


def _blender_default_gltf_material() -> dict:
    """The stock glTF representation of a new Blender default material.

    glTF's *implicit* material is white, fully metallic, and rough. Blender's
    material-less render surface is instead the familiar neutral-grey
    dielectric. Leaving a primitive without ``material`` therefore makes an
    otherwise valid export turn dark under ordinary World/environment light.

    These values intentionally mirror Blender 5.x's own export of a newly
    created default material. The generated marker is namespaced evidence for
    downstream inspection; it is not authored back into the .blend.
    """
    return {
        "name": "Blendlink Blender Default",
        "doubleSided": True,
        "pbrMetallicRoughness": {
            "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
            "metallicFactor": 0.0,
            "roughnessFactor": 0.5,
        },
        "extras": {
            "blendlink_generated": BLENDER_DEFAULT_MATERIAL_MARKER,
        },
    }


def normalize_materialless_glb(path: str) -> dict:
    """Replace only glTF's implicit materials with Blender's explicit default.

    This happens after Blender has finished exporting so no object, material
    slot, shared mesh datablock, or linked library is mutated. Existing
    primitive material indices and material documents are left semantically
    unchanged; every missing binding shares one small generated material.
    Unknown GLB chunks and the binary geometry chunk pass through unchanged.
    """
    document, chunks, json_index = _read_glb_document(
        path, "normalize material-less",
    )

    missing = []
    for mesh_index, mesh in enumerate(document.get("meshes", [])):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            if "material" not in primitive:
                missing.append((mesh_index, primitive_index, primitive))
    if not missing:
        return {
            "patchedPrimitiveCount": 0,
            "materialIndex": None,
            "primitives": [],
        }

    materials = document.setdefault("materials", [])
    generated = _blender_default_gltf_material()
    generated_index = next((
        index for index, material in enumerate(materials)
        if material.get("extras", {}).get("blendlink_generated")
        == BLENDER_DEFAULT_MATERIAL_MARKER
    ), None)
    if generated_index is None:
        generated_index = len(materials)
        materials.append(generated)
    elif materials[generated_index] != generated:
        raise ValueError(
            f"cannot normalize material-less GLB {path!r}: its existing "
            "Blendlink default material does not match the exporter contract"
        )

    labels = []
    for mesh_index, primitive_index, primitive in missing:
        primitive["material"] = generated_index
        mesh_name = document["meshes"][mesh_index].get("name", f"mesh {mesh_index}")
        labels.append(f"{mesh_name}[{primitive_index}]")

    _write_glb_document(path, document, chunks, json_index, "materials")

    return {
        "patchedPrimitiveCount": len(missing),
        "materialIndex": generated_index,
        "primitives": labels,
    }


def normalize_light_shadow_extras_glb(
    path: str, scene, view_layer=None, export_kwargs: dict | None = None,
) -> tuple[dict, list, list, set[str]]:
    """Finalize package-owned light facts in one completed-GLB transaction.

    KHR_lights_punctual has no shadow field. Preview Studio enables a global
    shadow recipe when any published light uses shadows, so every exported
    light whose native ``use_shadow`` is false needs an explicit namespaced
    opt-out. Patching the completed GLB avoids mutating linked or shared
    Blender objects and also gives diagnostics the final selection/collection
    export scope instead of guessing it before the exporter runs. Explicit
    Area-light source plans remain ordinary glTF nodes; their validated
    Three-specific descriptor is attached to exactly one finalized node extra.
    Automatic plans safely remain bake-only when the exporter cannot identify
    one unambiguous node, while an explicit Three Rect Area request stays a
    loud contract. No source ID property, linked datablock, or
    application-owned manifest is mutated.
    """
    document, chunks, json_index = _read_glb_document(
        path, "normalize light shadows in",
    )
    document_node_names = {
        node["name"] for node in document.get("nodes", [])
        if isinstance(node.get("name"), str) and node["name"]
    }
    exported_names = []
    patched_names = []
    published_punctual_objects = []
    published_punctual_identities = set()
    published_rect_area_objects = []
    rect_area_fallbacks = []
    shadows_enabled = False
    changed = False
    light_definitions = document.get("extensions", {}).get(
        "KHR_lights_punctual", {},
    ).get("lights", [])
    for node in document.get("nodes", []):
        light_reference = node.get("extensions", {}).get(
            "KHR_lights_punctual", {},
        ).get("light")
        if not isinstance(light_reference, int):
            continue
        object_name = node.get("name")
        if not isinstance(object_name, str) or not object_name:
            raise ValueError(
                f"cannot normalize light shadows in GLB {path!r}: "
                "an exported punctual-light node has no object name"
            )
        get_object = getattr(getattr(scene, "objects", None), "get", None)
        obj = get_object(object_name) if callable(get_object) else next((
            candidate for candidate in getattr(scene, "objects", ())
            if getattr(candidate, "name", None) == object_name
        ), None)
        if obj is None:
            obj = bpy.data.objects.get(object_name)
        if obj is None and 0 <= light_reference < len(light_definitions):
            data_name = light_definitions[light_reference].get("name")
            light_data = bpy.data.lights.get(data_name) if data_name else None
            matches = [
                candidate for candidate in bpy.data.objects
                if candidate.type == "LIGHT" and candidate.data is light_data
            ]
            if len(matches) == 1:
                obj = matches[0]
        if obj is None or getattr(obj, "type", None) != "LIGHT":
            raise ValueError(
                f"cannot normalize light shadows in GLB {path!r}: exported "
                f"punctual-light node {object_name!r} does not resolve to a "
                "Blender light object"
            )
        exported_names.append(object_name)
        pointer = getattr(obj, "as_pointer", None)
        identity = int(pointer()) if callable(pointer) else id(obj)
        if identity not in published_punctual_identities:
            published_punctual_identities.add(identity)
            published_punctual_objects.append(obj)

        authored = obj.get("blendlink_cast_shadow")
        authored = authored if isinstance(authored, bool) else None
        native_shadow = bool(getattr(obj.data, "use_shadow", True))
        shadows_enabled = shadows_enabled or (
            authored if authored is not None else native_shadow
        )
        desired = authored
        if desired is None and not native_shadow:
            desired = False
            if obj.name not in patched_names:
                patched_names.append(obj.name)
        if desired is None:
            continue
        extras = node.setdefault("extras", {})
        if not isinstance(extras, dict):
            raise ValueError(
                f"cannot normalize light contract in GLB {path!r}: "
                f"{object_name!r} has non-object node extras"
            )
        existing = extras.get("blendlink_cast_shadow")
        if existing is not None and existing is not desired:
            raise ValueError(
                f"cannot normalize light shadows in GLB {path!r}: "
                f"{object_name!r} exported conflicting blendlink_cast_shadow "
                f"value {existing!r} (expected {desired!r})"
            )
        if existing is None:
            extras["blendlink_cast_shadow"] = desired
            changed = True

    nodes_by_name = {}
    for node in document.get("nodes", []):
        name = node.get("name")
        if isinstance(name, str) and name:
            nodes_by_name.setdefault(name, []).append(node)

    rect_area_evidence = []
    expected_rect_node_ids = set()
    export_objects = diagnostic_export_objects(
        scene,
        view_layer=view_layer,
        export_kwargs=export_kwargs,
    )
    for obj in export_objects:
        if getattr(obj, "type", None) != "LIGHT":
            continue
        plan = weblights.plan_rect_area_light(obj, scene)
        if plan.refusals:
            details = "; ".join(issue.detail for issue in plan.refusals)
            raise ValueError(
                f"cannot publish Rect Area light {obj.name!r}: {details}"
            )
        if plan.descriptor is None:
            continue
        get_scene_object = getattr(getattr(scene, "objects", None), "get", None)
        scene_object = (
            get_scene_object(obj.name) if callable(get_scene_object) else next((
                candidate for candidate in getattr(scene, "objects", ())
                if candidate is obj
            ), None)
        )
        if scene_object is not obj:
            detail = (
                "the Area light is sourced through a Collection Instance. Rect "
                "Area v1 cannot yet prove the composed instance transform or "
                "Eevee micro-size thresholds from the source object alone."
            )
            if plan.mode == weblights.AREA_LIGHT_MODE_AUTO:
                rect_area_fallbacks.append({
                    "sourceObjectName": obj.name,
                    "code": "rect-area-instance-transform-unproven",
                    "detail": detail,
                })
                continue
            raise ValueError(
                f"cannot attach Rect Area descriptor for {obj.name!r} in GLB "
                f"{path!r}: {detail}"
            )
        matches = nodes_by_name.get(obj.name, [])
        if len(matches) != 1:
            detail = (
                f"the finished GLB contains {len(matches)} nodes named "
                f"{obj.name!r}; Rect Area v1 requires exactly one. Collection "
                "instance or duplicate-node expansion is ambiguous."
            )
            if plan.mode == weblights.AREA_LIGHT_MODE_AUTO:
                rect_area_fallbacks.append({
                    "sourceObjectName": obj.name,
                    "code": "rect-area-final-node-ambiguous",
                    "detail": detail,
                })
                continue
            raise ValueError(
                f"cannot attach Rect Area descriptor for {obj.name!r} in GLB "
                f"{path!r}: {detail}"
            )
        node = matches[0]
        punctual_reference = node.get("extensions", {}).get(
            "KHR_lights_punctual", {},
        ).get("light")
        if isinstance(punctual_reference, int):
            raise ValueError(
                f"cannot attach Rect Area descriptor for {obj.name!r}: its "
                "finalized node is already a KHR_lights_punctual light"
            )
        extras = node.setdefault("extras", {})
        if not isinstance(extras, dict):
            raise ValueError(
                f"cannot attach Rect Area descriptor for {obj.name!r}: its "
                "finalized node extras are not an object"
            )
        expected = plan.descriptor.as_dict()
        descriptor_key = "blendlink_rect_area_light"
        if descriptor_key not in extras:
            extras["blendlink_rect_area_light"] = expected
            actual = expected
            attachment = "attached"
            changed = True
        else:
            existing = extras[descriptor_key]
            try:
                parsed = weblights.parse_rect_area_light_descriptor(existing)
            except ValueError as error:
                raise ValueError(
                    f"cannot attach Rect Area descriptor for {obj.name!r}: "
                    f"existing node extra is invalid: {error}"
                ) from error
            if parsed.as_dict() != expected:
                raise ValueError(
                    f"cannot attach Rect Area descriptor for {obj.name!r}: "
                    f"existing node extra conflicts with the compiled source "
                    f"plan (existing {parsed.as_dict()!r}, expected {expected!r})"
                )
            # Preserve additive v1 fields and attest the exact serialized
            # payload downstream rather than silently canonicalizing it here.
            actual = existing
            attachment = "existing"
        expected_rect_node_ids.add(id(node))
        published_rect_area_objects.append(obj)
        exported_names.append(obj.name)
        rect_area_evidence.append({
            "sourceObjectName": obj.name,
            "nodeName": node["name"],
            "descriptor": actual,
            "attachment": attachment,
        })

    # A descriptor that did not come from an in-scope validated source plan is a
    # tampered or stale contract. Reject it before the runtime can double-light
    # an ordinary/punctual node.
    for node in document.get("nodes", []):
        extras = node.get("extras")
        if not isinstance(extras, dict) \
                or "blendlink_rect_area_light" not in extras:
            continue
        if id(node) not in expected_rect_node_ids:
            raise ValueError(
                f"cannot normalize light contract in GLB {path!r}: node "
                f"{node.get('name', '(unnamed)')!r} contains an unattested "
                "blendlink_rect_area_light descriptor"
            )

    if changed:
        _write_glb_document(path, document, chunks, json_index, "light-contract")

    # Re-read the serialized JSON when bytes changed. This proves the Blender
    # attachment transaction itself; Node typegen performs a second exact
    # attestation after every optimizer/texture transform.
    finalized_document = (
        _read_glb_document(path, "attest finalized light contract in")[0]
        if changed else document
    )
    finalized_by_name = {}
    for node in finalized_document.get("nodes", []):
        name = node.get("name")
        if isinstance(name, str) and name:
            finalized_by_name.setdefault(name, []).append(node)
    for evidence in rect_area_evidence:
        matches = finalized_by_name.get(evidence["nodeName"], [])
        if len(matches) != 1 or matches[0].get("extras", {}).get(
                "blendlink_rect_area_light") != evidence["descriptor"]:
            raise ValueError(
                f"serialized GLB {path!r} did not retain the exact Rect Area "
                f"descriptor for {evidence['sourceObjectName']!r}"
            )

    published_objects = [
        *published_punctual_objects,
        *(
            obj for obj in published_rect_area_objects
            if obj not in published_punctual_objects
        ),
    ]
    return {
        "exportedNodeNames": exported_names,
        "publishedSourceObjectNames": [obj.name for obj in published_objects],
        "patchedNativeShadowOff": patched_names,
        "shadowsEnabled": shadows_enabled,
        "rectAreaLights": rect_area_evidence,
        "rectAreaFallbacks": rect_area_fallbacks,
    }, published_punctual_objects, published_rect_area_objects, document_node_names


def bevel_uv_reproducibility_warnings(
    objects, export_kwargs: dict,
    blender_version: tuple[int, ...] | None = None,
) -> list[str]:
    """Name the evidenced Blender 5.2 Bevel/UV byte-stability hazard.

    Blender 5.2's evaluated Bevel UVs can differ by microscopic float values
    between otherwise identical fresh processes. The stock glTF exporter
    preserves those floats and exact-byte vertex deduplication can therefore
    change accessor counts and GLB hashes while topology stays fixed. Do not
    hide that by rounding artist-authored or baked-atlas UVs.
    """
    version = tuple(blender_version or bpy.app.version)
    if version[:2] != (5, 2):
        return []
    if not export_kwargs.get("export_apply") or not export_kwargs.get("export_texcoords"):
        return []
    affected = sorted({
        obj.name
        for obj in objects
        if getattr(obj, "type", None) == "MESH"
        and len(getattr(getattr(obj, "data", None), "uv_layers", ())) > 0
        and any(
            modifier.type == "BEVEL" and modifier.show_viewport
            for modifier in getattr(obj, "modifiers", ())
        )
    })
    if not affected:
        return []
    preview = ", ".join(affected[:8])
    remainder = len(affected) - 8
    return [
        "Blender 5.2 Bevel UV reproducibility warning: evaluated UV floats can "
        "vary microscopically across unchanged forced rebuilds, changing split-vertex "
        "counts and exact GLB/cache hashes even when topology and rendered triangles "
        "stay stable. Blendlink preserves authored UV bytes instead of silently "
        "rounding them; prefer ordinary no-op compile caching. Affected exported "
        f"meshes: {preview}" + (f" (+{remainder} more)" if remainder > 0 else "")
    ]


def gltf_export_contract(out_path: str, settings: dict) -> tuple[dict, list[str]]:
    """Resolve the stock Blender glTF exporter interface for this version.

    Blender renames exporter properties between supported releases. Keeping
    feature detection behind one seam prevents every export mode from learning
    those version details. Realtime light policy itself lives in weblights.py
    so the compiler and the addon's artist-facing diagnostics cannot drift.
    """
    supported = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    overrides = settings.get("exporterOverrides", {})
    owned = weblights.exporter_policy(supported, overrides)
    animation_owned = nla_sequence.exporter_policy(
        supported, overrides, bool(settings.get("_animationSequence")),
    )
    evaluated_material_owned = {
        "export_apply": True,
        "export_skins": True,
    }
    missing_evaluated_material = sorted(
        set(evaluated_material_owned) - supported
    )
    if missing_evaluated_material:
        raise RuntimeError(
            "This Blender glTF exporter cannot enforce Blendlink's "
            "evaluated-material contract; missing exporter option(s): "
            + ", ".join(missing_evaluated_material)
        )
    conflicting_evaluated_material = sorted(
        key for key, expected in evaluated_material_owned.items()
        if key in overrides and overrides[key] != expected
    )
    if conflicting_evaluated_material:
        raise ValueError(
            "exporterOverrides cannot replace Blendlink's evaluated-material "
            f"contract ({', '.join(conflicting_evaluated_material)}). Blendlink "
            "owns applied-modifier and skin evaluation so material preflight "
            "matches the stock GLB."
        )

    desired = {
        "filepath": out_path,
        "export_format": "GLB",
        **evaluated_material_owned,
        "export_yup": True,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_extras": True,
        "export_cameras": True,
        "export_animations": True,
        "export_morph": True,
        # Ship only deforming joints. Control rigs (CloudRig et al.) carry
        # thousands of mechanism/control bones; exporting them wholesale
        # produced an 1867-joint skin whose matrix buffer (119KB) exceeds
        # the 64KB uniform-block limit on BOTH web render backends — the
        # character could never skin. Deform-only is the standard
        # game-export contract; the exporter keeps required parents.
        "export_def_bones": True,
        # Compression happens post-export in Node where the library version is
        # controlled; the exporter's Draco path has a history of UV corruption.
        "export_draco_mesh_compression_enable": False,
        "export_image_format": settings.get("imageFormat", "AUTO"),
        # Blender's SPEC mode converts ideal white watts using 683 lm/W. That
        # is standards-correct photometry, but makes an existing Eevee/Cycles
        # light exactly 683x brighter when loaded by Three. COMPAT preserves
        # the artist-authored Blender presentation (and is Needle's choice).
        **owned,
        # NLA Sequence trims reference individually exported, zero-based
        # Actions. Own these version-sensitive exporter switches in one place.
        **animation_owned,
    }
    collection = settings.get("collection")
    if collection:
        desired["collection"] = collection
    desired.update(overrides)

    kwargs = {key: value for key, value in desired.items() if key in supported}
    dropped = sorted(set(desired) - supported)
    return kwargs, dropped


def apply_material_exporter_contract(material_plan, export_kwargs: dict) -> bool:
    """Apply compiler settings; report whether authored attributes were requested."""
    preserve_custom_attributes = bool(export_kwargs.get("export_attributes", False))
    required = material_compiler.exporter_overrides(material_plan)
    if not required:
        return preserve_custom_attributes
    supported = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    missing = sorted(set(required) - supported)
    if missing:
        raise SystemExit(
            "Website material compilation blocked: this Blender glTF exporter "
            "cannot carry selected vertex colors because it lacks "
            + ", ".join(missing)
            + ". Upgrade to a supported Blender release."
        )
    export_kwargs.update(required)
    return preserve_custom_attributes


def enforce_pointer_animation_policy(
    settings: dict, issues: list[dict], frame: float,
) -> list[str]:
    """Allow a truthful still only in Blendlink's private authoring preview.

    The stock glTF/Three path exports the evaluated value but cannot play
    KHR_animation_pointer.  Preview Studio may therefore show that current
    Blender frame as a static diagnostic convenience.  A connected website
    preview is integration evidence and Final is publish evidence, so both
    retain the hard blocker.
    """
    if not issues:
        return []
    private_authoring_preview = (
        settings.get("draft") is True
        and settings.get("authoringPreview") is True
    )
    if private_authoring_preview:
        frame_label = f"{frame:g}"
        return [
            "PRIVATE PREVIEW ONLY — unsupported property animation on "
            f'{item["object"]!r} is frozen at Blender frame {frame_label}: '
            f'{item["reason"]}. Final builds and connected-site previews remain '
            "blocked. Animate this value in website code, remove its property "
            "animation, or explicitly Bake an eligible mesh material."
            for item in issues
        ]
    raise SystemExit(
        "Property animation blocked (standard Three.js does not bind "
        "KHR_animation_pointer):\n  - " + "\n  - ".join(
            f'{item["object"]}: {item["reason"]}' for item in issues
        )
        + "\nAnimate these values in website code, remove the property animation, "
        "or explicitly choose Baked to freeze an animated mesh material."
    )


def plan_export_materials(
    settings: dict, sidecar: dict, export_kwargs: dict,
) -> tuple[material_compiler.MaterialPlan, tuple]:
    """Plan Website Material intent against the exact stock-export scope.

    Both plan-only inspection and a real export use this seam.  Keeping scope
    resolution, JSON-safe diagnostic merging, and blocking policy together
    prevents ``blendlink plan`` from approving an intent that Preview/Final
    would later reject.  ``plan_materials`` is inspection-only; generated
    materials and temporary bindings remain exclusive to the real export
    continuation in ``with_compiled_materials``.
    """
    export_objects = diagnostic_export_objects(
        bpy.context.scene, view_layer=bpy.context.view_layer,
        export_kwargs=export_kwargs,
    )
    enforce_supported_renderable_transport(export_objects)
    realization_plan = realizable_renderable_plan(export_objects)
    if realization_plan["realize"]:
        sidecar["diagnostics"]["realizedGeometry"] = realization_plan
    purpose = "preview" if settings.get("draft") else "final"
    compile_objects = export_objects
    if settings.get("mode") == "baked":
        atlas_specs = atlas_config(settings.get("bake") or {})
        full_plan = material_compiler.plan_materials(
            export_objects, purpose=purpose,
        )
        selected = [
            decision for decision in full_plan.decisions
            if decision.intent == "webColor"
        ]
        lighting_atlases = sorted(
            name for name, spec in atlas_specs.items()
            if spec["bakeOutput"] == "lighting"
        )
        if selected and lighting_atlases:
            raise SystemExit(
                "Website material compilation blocked:\n  - Selected-field Website "
                "Material transport is not yet composited with Lighting atlases "
                f"({', '.join(lighting_atlases)}). Those atlases retain the live base "
                "material, so silently replacing it would change the lighting formula. "
                "Use all-Appearance atlases, clear the Web Color selection, or publish "
                "these objects through Realtime. Selected materials: "
                + ", ".join(sorted(decision.material_name for decision in selected))
            )
        # Appearance baking owns the complete active Surface of static meshes.
        # Compile only exact survivors of the same render_meshes() predicate
        # used by the pack, bake, and later material replacement transaction.
        baked_pointers = {
            obj.as_pointer()
            for obj in render_meshes(
                fixed_camera_appearance=bool(
                    (settings.get("bake") or {}).get("fixedCameraAppearance")
                ),
            )
        }
        compile_objects = tuple(
            obj for obj in export_objects
            if obj.as_pointer() not in baked_pointers
        )
    material_plan = material_compiler.plan_materials(
        compile_objects, purpose=purpose,
    )
    material_compiler.merge_diagnostics(
        sidecar["diagnostics"].setdefault("materials", []), material_plan,
    )
    if material_plan.errors:
        raise SystemExit(
            "Website material compilation blocked:\n"
            + material_compiler.format_plan_errors(material_plan)
        )
    if any(
        decision.transport in {"image", "channels"}
        for decision in material_plan.lowerings
    ) and export_kwargs.get("export_image_format", "AUTO") != "AUTO":
        raise SystemExit(
            "Website material compilation blocked:\n  - Direct Image Texture Website "
            "Color and the per-channel Material bake require Blender's AUTO image "
            "format so the attested PNG/JPEG bytes ship exactly. Remove the "
            "imageFormat override or clear the selection."
        )
    return material_plan, export_objects


def main() -> None:
    bakelib.ensure_progress_heartbeat()
    out_path, settings_path, result_path = parse_argv()
    with open(settings_path, "r", encoding="utf-8") as handle:
        settings = json.load(handle)
    settings, recipe = resolve_scene_recipe(settings)

    # The addon's checker override is viewport-only inspection, but freeze
    # and glTF export evaluate the VIEWPORT depsgraph — strip leftovers
    # before anything evaluates, or the checker material bakes and ships.
    stripped = bakelib.remove_checker_overrides(bpy.data.objects)
    strip_warnings = (
        [f"removed {stripped} leftover checker-override modifier(s) "
         "(the addon's viewport UV inspection — never baked or exported)"]
        if stripped else []
    )

    if settings.get("planOnly"):
        kwargs, dropped = gltf_export_contract(out_path, settings)
        warnings = list(strip_warnings)
        warnings.extend(settings.get("_presentationWarnings", []))
        missing = missing_libraries()
        if missing:
            warnings.append(f"missing linked libraries: {', '.join(missing)}")
        excluded = remove_noimp_objects()
        sidecar = collect_sidecar(settings, recipe, export_kwargs=kwargs)
        _material_plan, export_objects = plan_export_materials(
            settings, sidecar, kwargs,
        )
        apply_material_exporter_contract(_material_plan, kwargs)
        warnings.extend(bevel_uv_reproducibility_warnings(
            export_objects,
            kwargs,
        ))
        plan = compute_bake_plan(settings, recipe) if settings.get("mode") == "baked" else None
        result = {
            "ok": True,
            "blenderVersion": bpy.app.version_string,
            "exporterKwargsDropped": dropped,
            "warnings": warnings,
            "collection": settings.get("collection"),
            "excluded": excluded,
            "sidecar": sidecar,
            "baked": {},
            "plan": plan,
            "recipe": recipe,
            "presentation": recipe.get("presentation") if recipe else None,
        }
        with open(result_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle)
        print("BLENDLINK_OK plan")
        return

    collection = settings.get("collection")
    kwargs, dropped = gltf_export_contract(out_path, settings)

    warnings = list(strip_warnings)
    warnings.extend(settings.get("_presentationWarnings", []))
    missing = missing_libraries()
    if missing:
        warnings.append(f"missing linked libraries: {', '.join(missing)}")

    excluded = remove_noimp_objects()
    sidecar = collect_sidecar(settings, recipe, export_kwargs=kwargs)
    material_plan, export_objects = plan_export_materials(settings, sidecar, kwargs)
    preserve_custom_attributes = apply_material_exporter_contract(material_plan, kwargs)
    warnings.extend(bevel_uv_reproducibility_warnings(
        export_objects,
        kwargs,
    ))
    if material_plan.lowerings or settings.get("mode") == "standard":
        planned_material_names = {
            decision.material_name for decision in material_plan.decisions
        }
        for material in sidecar["diagnostics"].get("materials", []):
            if settings.get("mode") != "standard" \
                    and material.get("material") not in planned_material_names:
                continue
            compilation = material.get("materialCompilation") or {}
            if compilation.get("outcome") == "lowered":
                surface_response = compilation.get(
                    "surfaceResponse", "explicit",
                )
                warnings.append(
                    f"material {material.get('material', 'unnamed')!r}: explicit "
                    f"Blendlink Web Color will compile through "
                    f"{compilation.get('transport', 'stock glTF')} as a selected field; "
                    f"its website response is {surface_response}. Exact downstream "
                    "Shader-to-RGB or AO shading, authored shadow appearance, view "
                    "transform, grain, and compositor effects are not transported"
                )
                continue
            if material.get("status") == "exact":
                continue
            reasons = " ".join(material.get("reasons", [])[:2])
            warnings.append(
                f"material {material.get('material', 'unnamed')!r}: "
                f"{material.get('label', 'glTF approximation')} — {reasons}"
            )
    pointer_blockers = procedural.pointer_animation_issues(
        bpy.context.scene,
        allow_forced_bake=settings.get("mode") == "baked",
        objects=diagnostic_export_objects(
            bpy.context.scene, view_layer=bpy.context.view_layer,
            export_kwargs=kwargs,
        ),
    )
    warnings.extend(enforce_pointer_animation_policy(
        settings, pointer_blockers, bpy.context.scene.frame_current_final,
    ))
    blockers = [
        item for item in sidecar["diagnostics"]["procedural"]
        if item.get("blocking")
    ]
    if blockers:
        raise SystemExit(
            "Geometry Fidelity blocked:\n  - " + "\n  - ".join(
                f'{item["object"]}: {item["reason"]}' for item in blockers
            )
        )
    # Phase 1. A frozen SurfaceDeform bind whose cage is itself LBS-skinned can
    # ship as an ordinary glTF skin instead of a static prop. analyze_scene has
    # already produced the depsgraph-free proposal; this is the only place that
    # measures it, because measuring costs a frame sweep and two evaluated
    # meshes per object. The measurement writes the residual and an outcome
    # back into every record, refuses above the shared 10% line, and returns
    # the derivations the enactor installs inside emit_gltf. A proposal that is
    # never verified -- or that verification refuses -- suppresses nothing.
    lowering_plan = sidecar["diagnostics"].get("deformerLowerings") or {}
    lowering_derivations = []
    if lowering_plan.get("lower"):
        progress(0.30, "measuring deformer lowerings")
        lowering_derivations = procedural.verify_deformer_lowerings(
            bpy.context.scene, lowering_plan,
        )
        sidecar["diagnostics"]["deformerLowerings"] = lowering_plan
    lowered_objects = {
        record["object"] for record in lowering_plan.get("lower", ())
        if lowering_plan.get("verified") and record.get("outcome") == "lowered"
    }
    # Every successful lowering warns, not only the ones over the 1% line. This
    # is a mutation the exporter chose to make to the artist's mesh, priced but
    # still an approximation, and an approximation that reports itself only
    # when it is large is a silent one the rest of the time.
    warnings.extend(
        record["message"] for record in lowering_plan.get("lower", ())
        if record.get("outcome") == "lowered" and record.get("message")
    )
    # Phase 0a/0c. These diagnostics are computed in analyze_scene and would
    # otherwise ride the manifest with a zero exit code -- a record that says
    # "refuse" and does not refuse is worse than no record, because it reads
    # as a guarantee. Enacted here, beside the procedural blockers, so every
    # geometry refusal leaves by the same door.
    #
    # The one exemption is an object whose entire frozen contribution the
    # verified Phase 1 lowering removes. Its frozenDeformers record stays in
    # the manifest -- the authored mesh really is frozen -- next to the
    # deformerLowerings record that says by how much the export repaired it.
    lowering_refusals = [
        record for record in (
            list(lowering_plan.get("lower", ()))
            + list(lowering_plan.get("refuse", ()))
        )
        if record.get("outcome") == "refused"
    ]
    frozen_deformers = [
        item for item in (sidecar["diagnostics"].get("frozenDeformers") or [])
        if item["object"] not in lowered_objects
    ]
    if frozen_deformers:
        attempted = {
            record["object"]: record["reason"]
            for record in lowering_refusals if record.get("reason")
        }
        raise SystemExit(
            "Geometry Fidelity blocked:\n  - " + "\n  - ".join(
                f'{item["object"]}: {item["reason"]}'
                + (
                    "\n    Blendlink tried to lower this to skin weights and "
                    f'could not: {attempted[item["object"]]}'
                    if item["object"] in attempted else ""
                )
                for item in frozen_deformers
            )
        )
    dropped_shape_keys = [
        item for item in (sidecar["diagnostics"].get("shapeKeys") or [])
        if item.get("severity") == "refuse"
    ]
    if dropped_shape_keys:
        raise SystemExit(
            "Shape Key transport blocked:\n  - " + "\n  - ".join(
                f'{item["object"]}: {item.get("reason", "shape keys are dropped")}'
                for item in dropped_shape_keys
            )
        )
    environment_asset = publish_environment(recipe, out_path)
    reflection_probe_assets = publish_reflection_probe_assets(recipe, out_path)

    baked_report = {}
    plan = None
    if settings.get("mode") == "baked":
        # The plan rides along on every real sync so the manifest can carry
        # per-object density — the addon shows it next to the Lightmap Scale
        # slider. The UV prep it runs is idempotent; the bake re-runs it.
        plan = compute_bake_plan(settings, recipe)
        if plan.get("errors"):
            raise SystemExit("bake plan blocked:\n  - " + "\n  - ".join(plan["errors"]))
        baked_report = run_baked_mode(settings, out_path)
        # The inspectable UVs must describe the actual second/final pack,
        # never rely on the plan pass merely being deterministic.
        plan["atlasLayout"] = baked_report.pop("atlasLayout")
        warnings.extend(baked_report.pop("warnings", []))

    progress(0.82, "writing glTF")
    sequence_export_restore = nla_sequence.prepare_action_export(
        recipe.get("animationSequence") if isinstance(recipe, dict) else None,
        bpy.context.scene,
    )
    render_visibility_restore = None
    realized_restore = None
    material_compilation = None
    try:
        realized_restore = realize_unsupported_renderables(
            bpy.context.scene, view_layer=bpy.context.view_layer,
            export_kwargs=kwargs,
        )
        if realized_restore is not None:
            sidecar["diagnostics"]["realizedGeometry"] = realized_restore["plan"]
        render_visibility_restore = enforce_export_render_visibility(
            bpy.context.scene, view_layer=bpy.context.view_layer,
            export_kwargs=kwargs,
        )
        def emit_gltf(filepath=out_path):
            export_kwargs = dict(kwargs)
            export_kwargs["filepath"] = filepath
            # Phase 1's mutation lands here and nowhere earlier. It adds an
            # ARMATURE modifier and swaps in a private Mesh, both of which feed
            # material_compiler's planning fingerprint
            # (material_compiler.py:1453-1459), so installing it before
            # with_compiled_materials re-validates that fingerprint would abort
            # a real export with a spurious "run Preview again". Inside emit it
            # nests strictly LIFO within the material transaction and the outer
            # finally below.
            lowered = procedural.prepare_lowered_skins(lowering_derivations)
            # Object Info Random rides node extras: Cycles derives it from
            # the object NAME, so the compiler stamps the same hash as a
            # transient custom property (export_extras carries it into
            # extras, GLTFLoader lands it in userData, and the TSL runtime's
            # attribute_object uniform reads it per draw). Stamped on every
            # mesh object rather than only bound ones so a shared material
            # always finds each object's own value; removed afterwards
            # because the artist's scene is not ours to annotate.
            stamped_random = []
            for stamped_obj in bpy.context.scene.objects:
                if stamped_obj.type != "MESH":
                    continue
                if tsl_ir.OBJECT_RANDOM_PROPERTY in stamped_obj:
                    continue
                stamped_obj[tsl_ir.OBJECT_RANDOM_PROPERTY] = (
                    tsl_ir.object_random_number(stamped_obj.name)
                )
                stamped_random.append(stamped_obj)
            try:
                return bpy.ops.export_scene.gltf(**export_kwargs)
            finally:
                for stamped_obj in stamped_random:
                    try:
                        del stamped_obj[tsl_ir.OBJECT_RANDOM_PROPERTY]
                    except (KeyError, ReferenceError):
                        pass
                procedural.restore_lowered_skins(lowered)

        if material_plan.lowerings:
            _export_result, material_compilation = material_compiler.with_compiled_materials(
                material_plan,
                out_path,
                emit_gltf,
                preserve_custom_attributes=preserve_custom_attributes,
            )
        else:
            emit_gltf()
    finally:
        try:
            nla_sequence.restore_action_export(sequence_export_restore)
        finally:
            try:
                if render_visibility_restore is not None:
                    restore_export_render_visibility(render_visibility_restore)
            finally:
                if realized_restore is not None:
                    restore_realized_renderables(realized_restore)
    if material_compilation is not None:
        sidecar["diagnostics"]["materialCompilation"] = material_compilation.as_dict()
    material_programs_asset = publish_material_programs(
        material_plan if material_plan.lowerings else None, out_path,
    )
    (
        light_contract,
        published_light_objects,
        published_rect_area_objects,
        exported_node_names,
    ) = normalize_light_shadow_extras_glb(
        out_path,
        bpy.context.scene,
        view_layer=bpy.context.view_layer,
        export_kwargs=kwargs,
    )
    material_defaults = normalize_materialless_glb(out_path)
    if material_defaults["patchedPrimitiveCount"]:
        preview = ", ".join(material_defaults["primitives"][:8])
        remainder = material_defaults["patchedPrimitiveCount"] - 8
        warnings.append(
            "assigned Blender's neutral default PBR material to "
            f'{material_defaults["patchedPrimitiveCount"]} material-less glTF '
            f"primitive(s): {preview}"
            + (f" (+{remainder} more)" if remainder > 0 else "")
        )

    # Selection/collection export settings can omit otherwise render-visible
    # lights. Base the artist-facing diagnostics and global Preview shadow
    # decision on the finished GLB rather than promising lights that did not
    # actually publish.
    published_light_names = set(light_contract["publishedSourceObjectNames"])
    instance_source_objects = published_instance_source_objects(
        bpy.context.scene, exported_node_names,
        view_layer=bpy.context.view_layer,
    )
    scene_object_identities = {
        obj.as_pointer() for obj in bpy.context.scene.objects
    }
    visible_instance_identities = {
        obj.as_pointer() for obj in instance_source_objects
    }
    invalid_instance_publications = sorted(
        obj.name for obj in (
            *published_light_objects,
            *published_rect_area_objects,
        )
        if obj.as_pointer() not in scene_object_identities
        and obj.as_pointer() not in visible_instance_identities
    )
    if invalid_instance_publications:
        raise RuntimeError(
            "finished GLB contains Collection Instance lights with no "
            "render-visible source occurrence in the exported root scope: "
            + ", ".join(invalid_instance_publications)
        )
    sidecar["lightDiagnostics"] = weblights.analyze_scene(
        bpy.context.scene,
        published_object_names=published_light_names,
        published_source_objects=published_light_objects,
        published_rect_area_objects=published_rect_area_objects,
        instance_source_objects=instance_source_objects,
        view_layer=bpy.context.view_layer,
        rect_area_artifact_fallbacks={
            item["sourceObjectName"]: weblights.RectAreaLightIssue(
                item["code"], item["detail"],
            )
            for item in light_contract.get("rectAreaFallbacks", [])
        },
    ).as_dict()
    sidecar["authoringPreview"] = collect_authoring_preview(
        bpy.context.scene,
        published_light_objects=[
            *published_light_objects,
            *published_rect_area_objects,
        ],
        view_layer=bpy.context.view_layer,
    )
    warnings.extend(
        item["message"]
        for item in sidecar.get("lightDiagnostics", {}).get("warnings", [])
    )
    if settings.get("authoringPreview"):
        warnings.extend(
            "Authoring preview: " + message
            for message in authoring_preview_warning_messages(
                sidecar.get("authoringPreview", {}), recipe,
            )
        )

    result = {
        "ok": True,
        "blenderVersion": bpy.app.version_string,
        "exporterKwargsDropped": dropped,
        "warnings": warnings,
        "collection": collection,
        "excluded": excluded,
        "sidecar": sidecar,
        "baked": baked_report,
        "plan": plan,
        "recipe": recipe,
        "presentation": recipe.get("presentation") if recipe else None,
        "environment": environment_asset,
        "materialPrograms": material_programs_asset,
        "reflectionProbeAssets": reflection_probe_assets,
        "lightContract": light_contract,
        "materialDefaults": material_defaults,
    }
    with open(result_path, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    print("BLENDLINK_OK export")


if __name__ == "__main__":
    main()
