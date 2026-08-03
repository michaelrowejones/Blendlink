# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless contract check for the bake atlas resolution ladder.

Gutters are fixed pixel amounts, so an island-dense receiver can saturate
the packer's margin loop at the recipe's atlas size and still prove its
contract one power of two up. When that happens the ACHIEVED size must be
the size every downstream consumer sees: the bake image allocation, the
plan's group sizes, and coverage all read the layout, while the atlas
config dict is rebuilt from the recipe on each call. Recording the growth
anywhere else packs UVs for the grown atlas and then bakes into the
recipe-sized image, halving every gutter the ladder just proved.
"""
import importlib.util
import sys
from pathlib import Path

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
BLENDER_DIR = ADDON_DIR.parent / "blendlink" / "blender"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bpy.ops.wm.read_factory_settings(use_empty=True)
bakelib = load("blendlink_bake_ladder_bakelib", BLENDER_DIR / "bakelib.py")
exporter = load("blendlink_bake_ladder_exporter", BLENDER_DIR / "export_scene.py")


def make_many_chart_mesh(name, count_side, quad_size):
    """One receiver whose charts are numerous enough to be margin-dominated.

    Measured on Blender 5.2: 100 such charts saturate the receiver pack's
    fixed-point margin loop at a 256px atlas and pack cleanly at 512px.
    """
    vertices = []
    faces = []
    for row in range(count_side):
        for column in range(count_side):
            base = len(vertices)
            x0, y0 = column * 1.0, row * 1.0
            vertices.extend([
                (x0, y0, 0), (x0 + quad_size, y0, 0),
                (x0 + quad_size, y0 + quad_size, 0), (x0, y0 + quad_size, 0),
            ])
            faces.append((base, base + 1, base + 2, base + 3))
    mesh = bpy.data.meshes.new(name + " Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index, coordinate in zip(
                polygon.loop_indices,
                ((0.0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.0, 0.1))):
            uv.data[loop_index].uv = coordinate
    mesh.uv_layers.active = uv
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
camera.location = (6, -6, 6)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

make_many_chart_mesh("Ladder Receiver", 10, 0.05)

RECIPE_SIZE = 256
MARGIN = 16
layout = exporter.bake_prepare_geometry(
    {"size": RECIPE_SIZE, "margin": MARGIN, "samples": 1}, 1,
)

group = layout["main"]
achieved = int(group["size"])
expect(
    achieved > RECIPE_SIZE,
    f"the layout still reports the recipe's {achieved}px. Either the ladder "
    "grew the atlas without recording the achieved size on the layout (the "
    "bake image would then be allocated at the recipe size, halving every "
    "gutter the ladder proved), or the island-dense fixture stopped "
    "saturating and must be re-tuned with more/smaller charts to keep this "
    "contract observable.",
)
expect(
    any("grew to" in warning for warning in layout.get("_warnings", [])),
    f"the ladder grew the atlas without saying so: {layout.get('_warnings')}",
)

# The invariant the bug broke: the layout's size IS the size the packed
# UVs prove their fixed-pixel gutter contract at. Validating at a smaller
# size fails, which is exactly what a stale layout size would cause the
# bake image allocation to do.
bakelib.validate_receiver_group_spacing(
    group["objects"], MARGIN, achieved, guard_px=4,
)

print("BLENDLINK_BAKE_LADDER_CHECK_PASSED")
