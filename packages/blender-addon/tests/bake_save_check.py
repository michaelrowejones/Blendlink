# SPDX-License-Identifier: MIT
"""Real Blender regression checks for canonical atlas save/resolve mechanics."""

from __future__ import annotations

import importlib.util
import struct
import sys
import tempfile
import zlib
from pathlib import Path

import bpy
import numpy as np


ADDON_DIR = Path(__file__).resolve().parents[1]
BAKELIB_PATH = ADDON_DIR.parent / "blendlink" / "blender" / "bakelib.py"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load_bakelib():
    spec = importlib.util.spec_from_file_location("blendlink_bake_save_check", BAKELIB_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def make_float_image(name: str, size: int, rgb=(0.25, 0.5, 0.75)):
    image = bpy.data.images.new(
        name, width=size, height=size, alpha=True, float_buffer=True,
    )
    rgba = np.zeros((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = 1.0
    image.pixels.foreach_set(rgba.reshape(-1))
    image.update()
    return image


def saved_rgb_peak(path: Path) -> float:
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        pixels = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        return float(pixels.reshape(-1, 4)[:, :3].max())
    finally:
        bpy.data.images.remove(image)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bakelib = load_bakelib()
    expect(
        bakelib.delivery_variant_sizes(2048) == [256, 512, 1024],
        "delivery tiers are not predictable powers of two below the canonical atlas",
    )
    thin = np.zeros((8, 8), dtype=bool)
    thin[1, 6] = True
    reduced = bakelib.resize_coverage_any(thin, 2)
    expect(
        int(reduced.sum()) == 1 and bool(reduced[0, 1]),
        "coverage resolve erased or moved a thin island",
    )
    with tempfile.TemporaryDirectory(prefix="blendlink-bake-save-") as directory:
        root = Path(directory)
        # A legacy animation-authored scene may expose only FFMPEG as the
        # current output enum in Blender 5.2 (that state cannot be constructed
        # from a factory 5.2 scene). Forbid the old artist-scene helper and use
        # a distinctive supported format here so the regression still proves
        # structurally that both PNG and EXR belong to a private save scene.
        artist_scene = bpy.context.scene
        artist_settings = artist_scene.render.image_settings
        prior_artist_state = (
            artist_settings.file_format,
            artist_settings.color_mode,
            artist_settings.color_depth,
            artist_scene.render.dither_intensity,
            artist_scene.view_settings.view_transform,
            artist_scene.view_settings.look,
            artist_scene.view_settings.exposure,
        )
        artist_settings.file_format = "OPEN_EXR"
        artist_settings.color_mode = "RGBA"
        artist_settings.color_depth = "16"
        artist_scene.render.dither_intensity = 0.375
        expected_artist_state = (
            artist_settings.file_format,
            artist_settings.color_mode,
            artist_settings.color_depth,
            artist_scene.render.dither_intensity,
            artist_scene.view_settings.view_transform,
            artist_scene.view_settings.look,
            artist_scene.view_settings.exposure,
        )
        scene_names_before = {scene.name for scene in bpy.data.scenes}
        real_force_color_management = bakelib.force_color_management

        def reject_artist_scene_save(_scene):
            raise AssertionError("bake save borrowed the artist scene")

        bakelib.force_color_management = reject_artist_scene_save
        private_save_source = make_float_image(
            "BLENDLINK_PRIVATE_SAVE_SCENE", 8, rgb=(0.125, 0.5, 1.0),
        )
        try:
            private_png = root / "artist-ffmpeg.png"
            private_exr = root / "artist-ffmpeg.exr"
            bakelib.save_dithered(private_save_source, str(private_png))
            bakelib.save_linear_exr(private_save_source, str(private_exr))
            expect(
                private_png.is_file() and private_png.stat().st_size > 0
                and private_exr.is_file() and private_exr.stat().st_size > 0,
                "private save scene did not publish both PNG and EXR bytes",
            )
            expect(
                (
                    artist_settings.file_format,
                    artist_settings.color_mode,
                    artist_settings.color_depth,
                    artist_scene.render.dither_intensity,
                    artist_scene.view_settings.view_transform,
                    artist_scene.view_settings.look,
                    artist_scene.view_settings.exposure,
                ) == expected_artist_state,
                "bake save changed the artist's output or color-management settings",
            )
            expect(
                {scene.name for scene in bpy.data.scenes} == scene_names_before,
                "private image-save scene leaked into the artist file",
            )
        finally:
            bakelib.force_color_management = real_force_color_management
            bpy.data.images.remove(private_save_source)
            (
                artist_settings.file_format,
                artist_settings.color_mode,
                artist_settings.color_depth,
                artist_scene.render.dither_intensity,
                artist_scene.view_settings.view_transform,
                artist_scene.view_settings.look,
                artist_scene.view_settings.exposure,
            ) = prior_artist_state

        for label, denoise in (("plain", False), ("denoised", True)):
            source = make_float_image(f"BLENDLINK_SAVE_{label}", 16)
            output = root / f"{label}.png"
            try:
                bakelib.save_resolved(source, str(output), 8, denoise=denoise)
                peak = saved_rgb_peak(output)
                expect(
                    peak > 0.5,
                    f"{label} supersample resolve lost its live float RGB buffer: peak={peak}",
                )
                expect(
                    tuple(source.size) == (16, 16),
                    f"{label} resolve mutated the reusable bake target: {tuple(source.size)}",
                )
            finally:
                bpy.data.images.remove(source)

        # EMIT may report opaque alpha over untouched black texels. A
        # separately baked white signal mask must therefore be able to own
        # save/background coverage without changing every ordinary atlas call.
        emit_source = bpy.data.images.new(
            "BLENDLINK_SAVE_EMIT_SIGNAL", width=16, height=16,
            alpha=True, float_buffer=True,
        )
        emit_pixels = np.zeros((16, 16, 4), dtype=np.float32)
        emit_pixels[:, :, 3] = 1.0
        emit_pixels[4:12, 4:12, :3] = (0.2, 0.55, 0.85)
        emit_source.pixels.foreach_set(emit_pixels.reshape(-1))
        emit_source.update()
        emit_coverage = np.zeros((16, 16), dtype=bool)
        emit_coverage[4:12, 4:12] = True
        try:
            emit_output = root / "emit-explicit-coverage.png"
            bakelib.save_resolved(
                emit_source,
                str(emit_output),
                16,
                denoise=False,
                delivery_sizes=[],
                coverage=emit_coverage,
            )
            saved = bpy.data.images.load(str(emit_output), check_existing=False)
            try:
                saved_pixels = np.empty(16 * 16 * 4, dtype=np.float32)
                saved.pixels.foreach_get(saved_pixels)
                saved_rgb = saved_pixels.reshape(16, 16, 4)[:, :, :3]
                background = saved_rgb[~emit_coverage]
                expect(
                    float(np.ptp(background, axis=0).max()) <= (0.1 / 255.0)
                    and float(background.min()) > 0.1,
                    "explicit EMIT signal coverage left black or varying background texels",
                )
            finally:
                bpy.data.images.remove(saved)
        finally:
            bpy.data.images.remove(emit_source)

        # Resolution derivatives are finalized by bakelib as real delivery
        # artifacts, not approximated later by the Node compiler. Coverage is
        # conservatively resized and the invisible background stays exactly
        # constant after the resize/dither stage.
        tiered = bpy.data.images.new(
            "BLENDLINK_SAVE_DELIVERY_TIERS", width=512, height=512,
            alpha=True, float_buffer=True,
        )
        tiered_pixels = np.zeros((512, 512, 4), dtype=np.float32)
        tiered_pixels[120:392, 96:416, :3] = (0.2, 0.55, 0.85)
        tiered_pixels[120:392, 96:416, 3] = 1.0
        tiered.pixels.foreach_set(tiered_pixels.reshape(-1))
        tiered.update()
        try:
            tiered_output = root / "tiered.png"
            variants = bakelib.save_resolved(tiered, str(tiered_output), 512)
            expect(len(variants) == 1, f"512px atlas produced unexpected tiers: {variants}")
            variant = variants[0]
            variant_path = Path(variant["path"])
            expect(variant_path.name == "tiered.256.png", f"tier name is unstable: {variant_path}")
            expect(variant_path.is_file(), f"delivery tier was not written: {variant_path}")
            expect(variant["width"] == 256 and variant["height"] == 256, "tier dimensions are wrong")
            expect(len(variant["hash"]) == 16, "tier lacks an exact artifact hash")
            saved = bpy.data.images.load(str(variant_path), check_existing=False)
            try:
                pixels = np.empty(256 * 256 * 4, dtype=np.float32)
                saved.pixels.foreach_get(pixels)
                rgb = pixels.reshape(256, 256, 4)[:, :, :3]
                coverage = bakelib.resize_coverage_any(
                    tiered_pixels[:, :, 3] > 0.5, 256,
                )
                background = rgb[~coverage]
                expect(
                    float(np.ptp(background, axis=0).max()) <= (0.1 / 255.0),
                    "delivery tier background is not one exact post-lossy constant",
                )
            finally:
                bpy.data.images.remove(saved)
        finally:
            bpy.data.images.remove(tiered)

        # State atlases preserve linear values above display white by storing
        # a normalized PNG plus a runtime multiplier. This protects highlight
        # gradients without changing ordinary LDR bakes.
        hdr = make_float_image("BLENDLINK_SAVE_HDR_RANGE", 8, rgb=(0.5, 1.0, 2.0))
        try:
            coverage = bakelib.image_coverage(hdr)
            scale = bakelib.normalize_bake_image(hdr, coverage)
            expect(1.99 <= scale <= 2.01, f"HDR state scale lost its authored range: {scale}")
            normalized_output = root / "normalized-hdr.png"
            bakelib.save_resolved(hdr, str(normalized_output), 8)
            normalized_peak = saved_rgb_peak(normalized_output)
            expect(
                0.98 <= normalized_peak <= 1.001,
                f"normalized HDR state did not fill the PNG range: {normalized_peak}",
            )
            expect(
                normalized_peak * scale > 1.95,
                "normalized PNG and runtime scale cannot reconstruct the HDR highlight",
            )
        finally:
            bpy.data.images.remove(hdr)

        # Signal validation distinguishes an intentional black bake from a
        # structurally valid PNG whose colored source was lost during save.
        black = make_float_image("BLENDLINK_SAVE_TRUE_BLACK", 8, rgb=(0.0, 0.0, 0.0))
        try:
            black_output = root / "true-black.png"
            bakelib.save_resolved(black, str(black_output), 8)
            expect(saved_rgb_peak(black_output) < 0.01, "true-black bake gained RGB signal")
        finally:
            bpy.data.images.remove(black)

        real_save_dithered = bakelib.save_dithered
        def save_one_byte_instead(_source, path):
            def chunk(kind, payload):
                checksum = zlib.crc32(kind)
                checksum = zlib.crc32(payload, checksum) & 0xFFFFFFFF
                return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)

            raw = b"".join(b"\0" + bytes((1, 1, 1)) * 8 for _ in range(8))
            payload = (
                b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw))
                + chunk(b"IEND", b"")
            )
            Path(path).write_bytes(payload)

        colored = make_float_image("BLENDLINK_SAVE_COLORED_SOURCE", 8)
        bakelib.save_dithered = save_one_byte_instead
        corrupted_output = root / "corrupted.png"
        try:
            try:
                bakelib.save_resolved(colored, str(corrupted_output), 8)
            except RuntimeError as error:
                expect(
                    "valid-but-black PNG" in str(error),
                    f"saved-signal failure was vague: {error}",
                )
            else:
                raise AssertionError("colored source silently published a black PNG")
            corrupt_peak = saved_rgb_peak(corrupted_output)
            expect(
                0.0 < corrupt_peak <= (1.5 / 255.0),
                f"corrupt fixture was not a one-byte PNG signal: peak={corrupt_peak}",
            )
        finally:
            bakelib.save_dithered = real_save_dithered
            bpy.data.images.remove(colored)

    print("BLENDLINK_BAKE_SAVE_CHECK_PASSED")


if __name__ == "__main__":
    main()
