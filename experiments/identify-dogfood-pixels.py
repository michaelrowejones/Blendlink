"""Read-only camera ray probe for the Blendlink dogfood fidelity investigation."""

from __future__ import annotations

import sys
import base64
import json
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Vector, geometry


SITE_ROOT = Path(r"C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite")
MANIFEST_PATH = SITE_ROOT / "src/generated/workbenchDogfood.manifest.json"
FINAL_GLB_PATH = SITE_ROOT / "public/models/workbench-dogfood/workbench-dogfood.glb"
DIAG_ROOT = Path(__file__).resolve().parents[1] / "artifacts/corkboard-diagnosis/current"
_STATE_SAMPLE = None
_LIGHT_SAMPLE = None


def final_uvs(object_name: str) -> list[Vector]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entry = next(
        item for item in manifest["bakePlan"]["atlasLayout"]["objects"]
        if item["name"] == object_name
    )
    raw = zlib.decompress(base64.b64decode(entry["data"]))
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    return [Vector((values[index], values[index + 1], 0.0))
            for index in range(0, len(values), 2)]


def interpolate_uv(obj, face_index: int, location: Vector, uvs: list[Vector]):
    mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    polygon = mesh.polygons[face_index]
    loops = list(polygon.loop_indices)
    vertices = [obj.matrix_world @ mesh.vertices[mesh.loops[index].vertex_index].co
                for index in loops]
    best = None
    for index in range(1, len(loops) - 1):
        triangle = (0, index, index + 1)
        points = [vertices[item] for item in triangle]
        closest = geometry.closest_point_on_tri(location, *points)
        distance = (closest - location).length
        uv = geometry.barycentric_transform(
            location, *points, *(uvs[loops[item]] for item in triangle),
        )
        if best is None or distance < best[0]:
            best = (distance, uv)
    return best[1] if best else None


def sample_state(uv: Vector):
    global _STATE_SAMPLE
    if _STATE_SAMPLE is None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        relative = manifest["states"]["default"]["atlases"]["main"].lstrip("/")
        image = bpy.data.images.load(str(SITE_ROOT / "public" / relative), check_existing=False)
        image.colorspace_settings.name = "sRGB"
        scale = float(manifest["stateScales"]["default"]["main"])
        _STATE_SAMPLE = image, scale
    image, scale = _STATE_SAMPLE
    width, height = image.size
    x = max(0, min(width - 1, int(uv.x * width)))
    y = max(0, min(height - 1, int(uv.y * height)))
    offset = (y * width + x) * 4
    stored = tuple(float(image.pixels[offset + channel]) for channel in range(3))
    return (x, y), stored, tuple(value * scale for value in stored), scale


def sample_light_group(uv: Vector):
    global _LIGHT_SAMPLE
    if _LIGHT_SAMPLE is None:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        entry = manifest["lightGroups"]["Lamp Pool"]["atlases"]["main"]
        relative = entry["url"].lstrip("/")
        image = bpy.data.images.load(str(SITE_ROOT / "public" / relative), check_existing=False)
        image.colorspace_settings.name = "sRGB"
        _LIGHT_SAMPLE = image, float(entry["maxValue"])
    image, scale = _LIGHT_SAMPLE
    width, height = image.size
    x = max(0, min(width - 1, int(uv.x * width)))
    y = max(0, min(height - 1, int(uv.y * height)))
    offset = (y * width + x) * 4
    stored = tuple(float(image.pixels[offset + channel]) for channel in range(3))
    return stored, tuple(value * scale for value in stored), scale


def atlas_owners(point: Vector) -> list[tuple[str, int]]:
    """Return evaluated source polygons whose final packed UV covers point."""
    owners = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    for entry in manifest["bakePlan"]["atlasLayout"]["objects"]:
        obj = bpy.data.objects.get(entry["name"])
        if obj is None:
            continue
        mesh = obj.evaluated_get(depsgraph).data
        uvs = final_uvs(obj.name)
        if len(uvs) != len(mesh.loops):
            continue
        for polygon in mesh.polygons:
            loops = list(polygon.loop_indices)
            for index in range(1, len(loops) - 1):
                a, b, c = (uvs[loops[item]] for item in (0, index, index + 1))
                if geometry.intersect_point_tri_2d(point.xy, a.xy, b.xy, c.xy):
                    owners.append((obj.name, polygon.index))
                    break
    return owners


def ray_for(camera: bpy.types.Object, scene: bpy.types.Scene, u: float, v: float):
    # Blender returns camera-frame corners in local space. Interpolating the
    # min/max X/Y frame extents is sufficient for the unshifted perspective
    # camera used by the dogfood scene.
    frame = camera.data.view_frame(scene=scene)
    minimum_x = min(corner.x for corner in frame)
    maximum_x = max(corner.x for corner in frame)
    minimum_y = min(corner.y for corner in frame)
    maximum_y = max(corner.y for corner in frame)
    local = Vector((
        minimum_x + (maximum_x - minimum_x) * u,
        maximum_y - (maximum_y - minimum_y) * v,
        frame[0].z,
    ))
    origin = camera.matrix_world.translation
    direction = (camera.matrix_world.to_quaternion() @ local).normalized()
    return origin, direction


def roi_mean_luma(path: Path, bounds: tuple[int, int, int, int]) -> float:
    import numpy as np

    image = bpy.data.images.load(str(path), check_existing=False)
    width, height = image.size
    left, top, right, bottom = bounds
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    region = pixels[height - bottom:height - top, left:right, :3]
    luma = np.dot(region, np.array((0.2126, 0.7152, 0.0722)))
    bpy.data.images.remove(image)
    return float(luma.mean())


def report_visual_repro() -> None:
    browser = DIAG_ROOT / "browser-high.png"
    reference = DIAG_ROOT / "blender-reference.png"
    patch = (442, 416, 668, 474)
    above = (442, 358, 668, 416)
    browser_patch = roi_mean_luma(browser, patch)
    browser_above = roi_mean_luma(browser, above)
    reference_patch = roi_mean_luma(reference, patch)
    reference_above = roi_mean_luma(reference, above)
    is_red = (
        browser_patch < browser_above * 0.65
        and 0.8 < reference_patch / reference_above < 1.2
    )
    print(
        "DOGFOOD_CORKBOARD_DUPLICATION_" + ("RED" if is_red else "GREEN"),
        f"roi={patch}", f"browserPatch={browser_patch:.6f}",
        f"browserAbove={browser_above:.6f}",
        f"referencePatch={reference_patch:.6f}",
        f"referenceAbove={reference_above:.6f}",
    )


def probe_final_glb(u: float, v: float) -> None:
    """Ray-hit the shipped geometry/UVs, independently of bake-plan evidence."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(FINAL_GLB_PATH))
    scene = bpy.context.scene
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.get("WEB_Camera_Compact")
    if camera is None:
        raise RuntimeError("final GLB did not import WEB_Camera_Compact")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    origin, direction = ray_for(camera, scene, u, v)
    hit, location, _normal, face, obj, _matrix = scene.ray_cast(
        depsgraph, origin, direction, distance=10_000,
    )
    if not hit:
        print("DOGFOOD_FINAL_GLB_MISS", f"u={u:.3f}", f"v={v:.3f}")
        return
    evaluated = obj.evaluated_get(depsgraph)
    polygon = evaluated.data.polygons[face]
    material = evaluated.data.materials[polygon.material_index]
    layer = evaluated.data.uv_layers.active
    if layer is None:
        raise RuntimeError(f"{obj.name}: final GLB ray hit has no UV layer")
    uvs = [Vector((item.uv.x, item.uv.y, 0.0)) for item in layer.data]
    uv = interpolate_uv(obj, face, location, uvs)
    print(
        "DOGFOOD_FINAL_GLB_HIT", f"u={u:.3f}", f"v={v:.3f}",
        f"object={obj.name}", f"triangle={face}",
        f"material={material.name if material else '<none>'}",
        f"uv=({uv.x:.6f},{uv.y:.6f})",
    )


def main() -> None:
    report_visual_repro()
    scene = bpy.context.scene
    scene.frame_set(33)
    camera = bpy.data.objects.get("WEB_Camera_Compact") or scene.camera
    if camera is None:
        raise RuntimeError("dogfood scene has no WEB_Camera_Compact or active camera")
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    depsgraph = bpy.context.evaluated_depsgraph_get()
    uv_cache = {}
    coordinates = [
        # Current browser artifact: the apparent repeated-cork rectangle on
        # the wall behind Suzanne and the monitor (1600x900 ROI below).
        (0.290, 0.475),
        (0.347, 0.430),
        (0.347, 0.533),
        (0.405, 0.590),
        (0.55, 0.15),
        (0.70, 0.15),
        (0.855, 0.20),
        (0.855, 0.40),
        (0.855, 0.65),
        (0.86, 0.80),
        (0.95, 0.40),
    ]
    for u, v in coordinates:
        origin, direction = ray_for(camera, scene, u, v)
        hit, location, _normal, face, obj, _matrix = scene.ray_cast(
            depsgraph, origin, direction, distance=10_000,
        )
        if hit:
            evaluated = obj.evaluated_get(depsgraph)
            polygon = evaluated.data.polygons[face]
            material = evaluated.data.materials[polygon.material_index]
            uvs = uv_cache.setdefault(obj.name, final_uvs(obj.name))
            uv = interpolate_uv(obj, face, location, uvs)
            pixel, stored, reconstructed, scale = sample_state(uv)
            light_stored, light_reconstructed, light_scale = sample_light_group(uv)
            print(
                "DOGFOOD_PIXEL_HIT",
                f"u={u:.3f}", f"v={v:.3f}", f"object={obj.name}",
                f"face={face}", f"distance={(location - origin).length:.3f}",
                f"atlas={obj.get('blendlink_atlas', 'main')}",
                f"material={material.name if material else '<none>'}",
                f"uv=({uv.x:.6f},{uv.y:.6f})", f"pixel={pixel}",
                f"owners={atlas_owners(uv)}",
                f"storedLinear={tuple(round(value, 4) for value in stored)}",
                f"reconstructed={tuple(round(value, 4) for value in reconstructed)}",
                f"scale={scale:.4f}",
                f"lampLinear={tuple(round(value, 4) for value in light_stored)}",
                f"lampReconstructed={tuple(round(value, 4) for value in light_reconstructed)}",
                f"lampScale={light_scale:.4f}",
            )
        else:
            print("DOGFOOD_PIXEL_MISS", f"u={u:.3f}", f"v={v:.3f}")
    probe_final_glb(0.347, 0.533)


if __name__ == "__main__":
    main()
