"""Disposable 512px Cycles bake for one dogfood shadow-caster hypothesis.

Run Blender with the dogfood .blend already open and pass one variant after
``--``. Nothing is saved back to the .blend or production artifact folders.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import struct
import sys
import zlib
from pathlib import Path

import bpy


REPO = Path(__file__).resolve().parents[1]
SITE = Path(r"C:\Users\micha\Documents\GitHub\MichaelRoweJonesSite")
MANIFEST = SITE / "src/generated/workbenchDogfood.manifest.json"
OUTPUT = REPO / "artifacts/corkboard-diagnosis/shadow-variants"
BAKELIB_DIR = REPO / "packages/blendlink/blender"
VARIANTS = {
    "baseline": set(),
    "no-monitor": {"Monitor"},
    "no-corkboard": {"CorkBoard"},
    "no-desk": {"Desk"},
    "no-suzanne": {"Suzanne.001"},
    "corkboard-separated": set(),
    "corkboard-no-shadow": set(),
    "source-corkboard-no-shadow-joined": set(),
    "source-corkboard-monitor-no-shadow-joined": set(),
    "no-light-interior": set(),
    "no-light-sun": set(),
    "no-light-area": set(),
    "no-light-lamp": set(),
    "light-baseline": set(),
    "light-no-suzanne": {"Suzanne.001"},
    "light-no-desk": {"Desk"},
    "light-no-base": {"Base"},
    "light-no-cube001": {"Cube.001"},
    "light-no-resume": {"Resume"},
    "light-no-corkboard": {"CorkBoard"},
    "light-no-monitor": {"Monitor"},
    "light-suzanne-no-shadow": set(),
    "light-direct": set(),
    "light-indirect": set(),
    "light-direct-no-corkboard": {"CorkBoard"},
    "light-indirect-no-corkboard": {"CorkBoard"},
    "light-corkboard-separated": set(),
    "light-corkboard-no-diffuse": set(),
}
HIDDEN_LIGHT = {
    "no-light-interior": "Interior Light",
    "no-light-sun": "Point",
    "no-light-area": "Point.001",
    "no-light-lamp": "lamp_bulb_fill",
}
SIZE = 512


def load_exporter():
    sys.path.insert(0, str(BAKELIB_DIR))
    spec = importlib.util.spec_from_file_location(
        "blendlink_shadow_variant_exporter", BAKELIB_DIR / "export_scene.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def packed_uvs(entry: dict) -> list[tuple[float, float]]:
    raw = zlib.decompress(base64.b64decode(entry["data"]))
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    return list(zip(values[::2], values[1::2]))


def sample(image, uv: tuple[float, float]) -> tuple[float, float, float]:
    x = max(0, min(image.size[0] - 1, int(uv[0] * image.size[0])))
    y = max(0, min(image.size[1] - 1, int(uv[1] * image.size[1])))
    offset = (y * image.size[0] + x) * 4
    return tuple(float(image.pixels[offset + channel]) for channel in range(3))


def luma(color: tuple[float, float, float]) -> float:
    return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    variant = argv[0] if argv else "baseline"
    if variant not in VARIANTS:
        raise RuntimeError(f"variant must be one of {', '.join(VARIANTS)}")
    excluded = VARIANTS[variant]
    OUTPUT.mkdir(parents=True, exist_ok=True)

    exporter = load_exporter()
    bakelib = exporter.bakelib
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries = {
        entry["name"]: entry
        for entry in manifest["bakePlan"]["atlasLayout"]["objects"]
    }
    scene = bpy.context.scene
    scene.frame_set(33)
    hidden_light = HIDDEN_LIGHT.get(variant)
    if hidden_light is not None:
        bpy.data.objects[hidden_light].hide_render = True

    baked = [bpy.data.objects[name] for name in entries]
    baked = bakelib.freeze_evaluated_meshes(baked)
    for obj in baked:
        mesh = obj.data
        old = mesh.uv_layers.get(bakelib.ATLAS_UV)
        if old is not None:
            mesh.uv_layers.remove(old)
        layer = mesh.uv_layers.new(name=bakelib.ATLAS_UV)
        values = packed_uvs(entries[obj.name])
        if len(values) != len(layer.data):
            raise RuntimeError(
                f"{obj.name}: manifest has {len(values)} loops; evaluated mesh has "
                f"{len(layer.data)}"
            )
        for index, value in enumerate(values):
            layer.data[index].uv = value
        mesh.uv_layers.active = layer
    if variant in {
        "source-corkboard-no-shadow-joined",
        "source-corkboard-monitor-no-shadow-joined",
    }:
        bpy.data.objects["CorkBoard"].visible_shadow = False
    if variant == "source-corkboard-monitor-no-shadow-joined":
        bpy.data.objects["Monitor"].visible_shadow = False
    if variant == "light-suzanne-no-shadow":
        bpy.data.objects["Suzanne.001"].visible_shadow = False

    # Match Final's contributor policy: Realtime meshes do not cast permanent
    # shadows into the appearance atlas. The background bake target remains a
    # contributor through its own proxy, exactly as the production build does.
    baked_names = set(entries)
    render_geometry = {
        "MESH", "CURVE", "FONT", "META", "SURFACE", "VOLUME",
        "POINTCLOUD", "CURVES",
    }
    for obj in scene.objects:
        if obj.type in render_geometry and obj.name not in baked_names:
            obj.hide_render = True

    background = bpy.data.objects["Cube"]
    background_proxy, background_hidden = bakelib.join_proxy(
        [background], "BLENDLINK_DIAG_BACKGROUND", "BLENDLINK_DEFAULT_SURFACE",
        private_materials=True,
    )
    separate_corkboard = variant in {
        "corkboard-separated", "corkboard-no-shadow",
        "light-corkboard-separated", "light-corkboard-no-diffuse",
    }
    main_objects = [
        obj for obj in baked
        if obj.name != "Cube" and obj.name not in excluded
        and not (separate_corkboard and obj.name == "CorkBoard")
    ]
    for name in excluded:
        bpy.data.objects[name].hide_render = True
    proxy, hidden = bakelib.join_proxy(
        main_objects, f"BLENDLINK_DIAG_{variant}", "BLENDLINK_DEFAULT_SURFACE",
        private_materials=True,
    )
    corkboard_contributor = None
    if separate_corkboard:
        corkboard_contributor = bakelib.join_proxy(
            [bpy.data.objects["CorkBoard"]], "BLENDLINK_DIAG_CORKBOARD",
            "BLENDLINK_DEFAULT_SURFACE", private_materials=True,
        )
        corkboard_contributor[0].visible_shadow = variant != "corkboard-no-shadow"
        if variant.startswith("light-corkboard"):
            corkboard_contributor[0].visible_shadow = False
        if variant == "light-corkboard-no-diffuse":
            corkboard_contributor[0].visible_diffuse = False

    exporter.bake_engine(32)
    scene.cycles.seed = 0
    scene.cycles.use_animated_seed = False
    image = bpy.data.images.new(
        f"dogfood-shadow-{variant}", width=SIZE, height=SIZE,
        alpha=True, float_buffer=True,
    )
    if variant.startswith("light-"):
        for light in (obj for obj in scene.objects if obj.type == "LIGHT"):
            light.hide_render = light.name != "lamp_bulb_fill"
        bakelib.swap_to_black_world()
        bakelib.mute_emission()
        pass_mode = (
            "direct" if "direct" in variant and "indirect" not in variant
            else "indirect" if "indirect" in variant
            else None
        )
        if pass_mode is None:
            exporter.bake_state(
                proxy, image, 6, emit=False, bake_output="appearance",
            )
        else:
            exporter.configure_atlas_bake(scene, 6, "appearance", emit=False)
            scene.render.bake.use_pass_direct = pass_mode == "direct"
            scene.render.bake.use_pass_indirect = pass_mode == "indirect"
            exporter.set_bake_targets(proxy, image)
            bpy.ops.object.bake(
                type="COMBINED", target="IMAGE_TEXTURES", margin=6,
                use_clear=True, uv_layer=bakelib.ATLAS_UV,
            )
    else:
        exporter.bake_state(proxy, image, 6, bake_output="appearance")

    # Center of the reported ghost and clear wall just above it. These final
    # UVs come from independent source-camera rays in identify-dogfood-pixels.
    ghost_uv = (0.630190, 0.402390)
    clear_uv = (0.622893, 0.402487)
    ghost = sample(image, ghost_uv)
    clear = sample(image, clear_uv)
    path = OUTPUT / f"{variant}.png"
    bakelib.save_dithered(image, str(path))
    print(
        "DOGFOOD_SHADOW_VARIANT", f"variant={variant}",
        f"excluded={','.join(sorted(excluded)) or '<none>'}",
        f"ghost={tuple(round(value, 6) for value in ghost)}",
        f"clear={tuple(round(value, 6) for value in clear)}",
        f"ghostToClear={luma(ghost) / max(luma(clear), 1e-9):.6f}",
        f"path={path}",
    )

    bakelib.release_proxy(proxy, hidden)
    if corkboard_contributor is not None:
        bakelib.release_proxy(*corkboard_contributor)
    bakelib.release_proxy(background_proxy, background_hidden)


if __name__ == "__main__":
    main()
