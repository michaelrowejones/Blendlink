"""Render an unsaved, low-sample reference from the .blend passed to Blender."""

import sys
from pathlib import Path

import bpy


def arguments():
    try:
        separator = sys.argv.index("--")
    except ValueError as error:
        raise RuntimeError("Pass an output PNG after --") from error
    values = sys.argv[separator + 1 :]
    if len(values) != 1:
        raise RuntimeError("Expected exactly one output PNG after --")
    output = Path(values[0])
    if not output.is_absolute():
        raise RuntimeError(
            "Reference output must be an absolute path. Blender may change its "
            "process working directory before Python runs, so a relative path can "
            "write outside the intended evidence directory."
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    return str(output)


def select_cycles_gpu(scene):
    if scene.render.engine != "CYCLES":
        return "scene-engine"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
    except Exception as error:
        print(f"blendlink reference: Cycles preferences unavailable; using CPU: {error}")
        return "cpu"
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            preferences.compute_device_type = backend
            query = getattr(preferences, "get_devices_for_type", None)
            devices = list(query(backend)) if callable(query) else list(preferences.devices)
        except (TypeError, ValueError, RuntimeError):
            continue
        compatible = [device for device in devices if device.type == backend]
        if compatible:
            for device in preferences.devices:
                device.use = device.type == backend
            scene.cycles.device = "GPU"
            print(f"blendlink reference: using {backend}")
            return backend.lower()
    scene.cycles.device = "CPU"
    return "cpu"


scene = bpy.context.scene
scene.render.filepath = arguments()
if scene.render.is_movie_format:
    raise RuntimeError(
        "Reference capture needs a still-image output class. This .blend uses "
        f"{scene.render.image_settings.file_format}; invoke Blender with "
        "'--render-format PNG' before '--python render-scene-reference.py'. "
        "The CLI override is unsaved and does not change the artist file."
    )
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.use_compositing = False
scene.render.film_transparent = False
# Camera projection belongs to the .blend. Changing X/Y here silently changes
# perspective/orthographic framing and makes the reference incomparable with
# the GLB exported from the saved file. Preserve the authored aspect and only
# lower both dimensions by the same percentage when a source is very large.
if abs(float(scene.render.pixel_aspect_x) - float(scene.render.pixel_aspect_y)) > 1e-9:
    raise RuntimeError(
        "Blendlink reference capture requires square pixels; author a square-pixel "
        "render contract before comparing it with a browser Canvas."
    )
source_long_edge = max(scene.render.resolution_x, scene.render.resolution_y)
reference_percentage = min(
    int(scene.render.resolution_percentage),
    max(1, int(1440 * 100 / source_long_edge)),
)
scene.render.resolution_percentage = reference_percentage
print(
    "blendlink reference: preserving authored render aspect at "
    f"{scene.render.resolution_x}x{scene.render.resolution_y} "
    f"({reference_percentage}%)"
)
# A downloaded source may keep its working view layer active while disabling
# that layer for final renders. Blendlink compiles the active view-layer scope,
# so the reference must render that same scope instead of silently writing an
# empty transparent PNG.
active_view_layer = bpy.context.view_layer
if not active_view_layer.use:
    active_view_layer.use = True
    print(f"blendlink reference: enabled active view layer '{active_view_layer.name}' for this unsaved render")
if scene.render.engine == "CYCLES":
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
select_cycles_gpu(scene)
bpy.ops.render.render(write_still=True)
print(f"BLENDLINK_REFERENCE_RENDERED {scene.render.filepath}")
