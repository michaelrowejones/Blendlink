# SPDX-License-Identifier: GPL-3.0-or-later
"""MTL-BAKE-001 primitives: isolated channel bakes stay numerically honest.

Covers the bake mechanics that the material compiler orchestrates but must
never copy: sRGB-versus-data PNG encoding, HDR emissive peak normalization,
the tile-proxy period-1 wrap gate (brick repeats, noise must not pretend
to), the tangent-space NORMAL pass, ORM channel packing, and exact scene
state restoration.

Run headless:
    blender --background --factory-startup --python-exit-code 1 \
        --python packages/blender-addon/tests/material_channel_bake_check.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
CANONICAL_BLENDER_DIR = ADDON_DIR.parent / "blendlink" / "blender"
sys.path.insert(0, str(CANONICAL_BLENDER_DIR))

import bakelib  # noqa: E402


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def quad_object(name):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        ((-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)),
        (),
        ((0, 1, 2, 3),),
    )
    mesh.update()
    layer = mesh.uv_layers.new(name="Authored UVs")
    corners = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for loop_index, corner in enumerate(corners):
        layer.data[loop_index].uv = corner
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def emission_material(name, build):
    """Private emission material; ``build(tree, emission)`` wires the field."""
    material = bpy.data.materials.new(name)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    build(tree, emission)
    return material


def raw_png_pixels(path):
    """Decoded PNG bytes as raw 0..1 floats (no colorspace conversion)."""
    import numpy as np

    image = bpy.data.images.load(str(path))
    try:
        image.colorspace_settings.name = "Non-Color"
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        return pixels.reshape(height, width, 4)[:, :, :3].copy()
    finally:
        bpy.data.images.remove(image)


def main():
    import numpy as np

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    engine_before = scene.render.engine
    bake_margin_before = scene.render.bake.margin
    normal_space_before = scene.render.bake.normal_space
    samples_before = scene.cycles.samples

    with tempfile.TemporaryDirectory(prefix="blendlink-channel-bake-") as directory:
        root = Path(directory)

        # --- sRGB versus data PNG encoding -------------------------------
        gray = emission_material(
            "Constant Gray",
            lambda tree, emission: emission.inputs["Color"].__setattr__(
                "default_value", (0.5, 0.5, 0.5, 1.0),
            ),
        )
        receiver = quad_object("Gray Receiver")
        receiver.data.materials.append(gray)

        srgb_result = bakelib.bake_channel_field_to_png(
            [receiver], str(root / "gray-srgb.png"),
            size=128, margin_px=0, uv_layer="Authored UVs",
            colorspace="srgb", label="gray srgb",
        )
        data_result = bakelib.bake_channel_field_to_png(
            [receiver], str(root / "gray-data.png"),
            size=128, margin_px=0, uv_layer="Authored UVs",
            colorspace="data", label="gray data",
        )
        srgb_raw = float(np.median(raw_png_pixels(srgb_result["path"])))
        data_raw = float(np.median(raw_png_pixels(data_result["path"])))
        # sRGB encode of linear 0.5 is ~0.7354; a raw data byte stays 0.5.
        expect(
            abs(srgb_raw - 0.7354) < 0.02,
            f"sRGB save must display-encode linear 0.5, got byte value {srgb_raw}",
        )
        expect(
            abs(data_raw - 0.5) < 0.008,
            f"data save must keep linear 0.5 exact, got byte value {data_raw}",
        )
        expect(
            srgb_result["colorspace"] == "srgb"
            and data_result["colorspace"] == "data",
            "channel save evidence must name its colorspace",
        )

        # --- HDR emissive peak normalization -----------------------------
        hot = emission_material(
            "Hot Emissive",
            lambda tree, emission: emission.inputs["Color"].__setattr__(
                "default_value", (3.0, 1.5, 0.75, 1.0),
            ),
        )
        hot_receiver = quad_object("Hot Receiver")
        hot_receiver.data.materials.append(hot)
        try:
            bakelib.bake_channel_field_to_png(
                [hot_receiver], str(root / "hot-clipped.png"),
                size=128, margin_px=0, uv_layer="Authored UVs",
                colorspace="srgb", label="hot clipped",
            )
        except RuntimeError as error:
            expect(
                "without clipping" in str(error),
                f"HDR refusal must name clipping: {error}",
            )
        else:
            raise AssertionError("an above-one channel must refuse without allow_hdr")
        hot_result = bakelib.bake_channel_field_to_png(
            [hot_receiver], str(root / "hot.png"),
            size=128, margin_px=0, uv_layer="Authored UVs",
            colorspace="srgb", allow_hdr=True, label="hot emissive",
        )
        expect(
            abs(hot_result["emissiveStrength"] - 3.0) < 1.0e-3,
            f"HDR peak must become the emissive strength: {hot_result}",
        )
        hot_raw = raw_png_pixels(hot_result["path"])
        expect(
            float(hot_raw[:, :, 0].max()) > 0.99,
            "normalized HDR red channel must reach the top of the PNG range",
        )

        # --- Tile-proxy period-1 wrap gate --------------------------------
        # Checker at scale 4 has period 0.5 and no randomness, so it must
        # repeat across integer windows.  Blender's default Brick texture is
        # deliberately NOT the positive case: it hashes the integer brick
        # index into a per-brick Color1/Color2 blend, so windows 3..4 differ
        # from 0..1 — the wrap gate correctly demotes it to the Unique route
        # unless the artist authors equal brick colors.
        def checker_field(tree, emission):
            coord = tree.nodes.new("ShaderNodeTexCoord")
            checker = tree.nodes.new("ShaderNodeTexChecker")
            checker.inputs["Scale"].default_value = 4.0
            tree.links.new(coord.outputs["UV"], checker.inputs["Vector"])
            tree.links.new(checker.outputs["Color"], emission.inputs["Color"])

        def noise_field(tree, emission):
            coord = tree.nodes.new("ShaderNodeTexCoord")
            noise = tree.nodes.new("ShaderNodeTexNoise")
            tree.links.new(coord.outputs["UV"], noise.inputs["Vector"])
            tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])

        def tile_pixels(material, window):
            proxy = bakelib.uv_tile_proxy([], window=window)
            try:
                proxy.data.materials.append(material)
                result = bakelib.bake_channel_field_pixels(
                    [proxy],
                    size=128, margin_px=0, uv_layer="BLENDLINK_TILE_BAKE",
                    label=f"tile {window}",
                )
                expect(
                    bool(result["coverage"].all()),
                    "a full quad tile bake must cover every texel",
                )
                return result["pixels"]
            finally:
                bakelib.remove_uv_tile_proxy(proxy)

        checker_material = emission_material("Checker Field", checker_field)
        checker_tile = tile_pixels(checker_material, (0.0, 0.0, 1.0, 1.0))
        checker_window = tile_pixels(checker_material, (3.0, 3.0, 4.0, 4.0))
        checker_diff = np.abs(checker_tile - checker_window)
        expect(
            float(checker_diff.mean()) < 1.0e-3
            and float((checker_diff > 0.05).mean()) < 0.005,
            f"scale-4 checker must repeat across integer UV windows: "
            f"mean {float(checker_diff.mean())}, "
            f"outliers {float((checker_diff > 0.05).mean())}",
        )

        noise_material = emission_material("Noise Field", noise_field)
        noise_tile = tile_pixels(noise_material, (0.0, 0.0, 1.0, 1.0))
        noise_window = tile_pixels(noise_material, (3.0, 3.0, 4.0, 4.0))
        noise_diff = np.abs(noise_tile - noise_window)
        expect(
            float(noise_diff.mean()) > 0.05,
            f"UV-driven noise must fail the wrap gate: mean {float(noise_diff.mean())}",
        )

        # --- Tangent-space NORMAL pass ------------------------------------
        flat = bpy.data.materials.new("Flat Normal")
        bakelib.ensure_shader_node_tree(flat)
        flat_receiver = quad_object("Flat Receiver")
        flat_receiver.data.materials.append(flat)
        normal_result = bakelib.bake_tangent_normal_to_png(
            [flat_receiver], str(root / "flat-normal.png"),
            size=128, margin_px=0, uv_layer="Authored UVs",
            label="flat normal",
        )
        normal_raw = raw_png_pixels(normal_result["path"])
        center = normal_raw[48:80, 48:80].reshape(-1, 3).mean(axis=0)
        expect(
            abs(float(center[0]) - 0.5) < 0.01
            and abs(float(center[1]) - 0.5) < 0.01
            and float(center[2]) > 0.98,
            f"a flat surface must bake the identity tangent normal, got {center}",
        )

        # --- ORM channel packing ------------------------------------------
        packed = bakelib.compose_channel_pack_pixels(
            64,
            green=np.full((64, 64), 0.75, dtype=np.float32),
            blue=np.full((64, 64), 0.25, dtype=np.float32),
        )
        orm_saved = bakelib.save_channel_png(
            packed, np.ones((64, 64), dtype=bool), str(root / "orm.png"),
            colorspace="data", label="orm pack",
        )
        orm_raw = raw_png_pixels(orm_saved["path"]).reshape(-1, 3).mean(axis=0)
        expect(
            float(orm_raw[0]) > 0.99
            and abs(float(orm_raw[1]) - 0.75) < 0.008
            and abs(float(orm_raw[2]) - 0.25) < 0.008,
            f"ORM pack must keep R=occlusion fill, G=roughness, B=metallic: {orm_raw}",
        )

    # --- Exact state restoration and no leaks -----------------------------
    expect(
        scene.render.engine == engine_before
        and scene.render.bake.margin == bake_margin_before
        and scene.render.bake.normal_space == normal_space_before
        and scene.cycles.samples == samples_before,
        "channel bakes must restore engine, bake RNA, and Cycles samples",
    )
    leaked = [
        image.name for image in bpy.data.images
        if image.name.startswith("BLENDLINK_CHANNEL")
    ] + [
        material.name for material in bpy.data.materials
        if material.name.startswith("BLENDLINK_CHANNEL")
    ] + [
        obj.name for obj in bpy.data.objects
        if obj.name.startswith("BLENDLINK_TILE_PROXY")
    ]
    expect(not leaked, f"channel bake primitives leaked datablocks: {leaked}")

    print("BLENDLINK_MATERIAL_CHANNEL_BAKE_CHECK_PASSED")


if __name__ == "__main__":
    main()
