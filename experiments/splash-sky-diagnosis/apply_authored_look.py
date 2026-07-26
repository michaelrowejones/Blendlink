"""Apply the exact source scene display transform to a rendered sRGB PNG."""

from __future__ import annotations

import pathlib
import sys

import bpy


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
source_blend = pathlib.Path(args[0]).resolve()
input_png = pathlib.Path(args[1]).resolve()
output_png = pathlib.Path(args[2]).resolve()
output_png.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(source_blend))
authored = bpy.context.scene
image = bpy.data.images.load(str(input_png), check_existing=False)
stage = bpy.data.scenes.new("Blendlink Authored Look Control")
try:
    stage.display_settings.display_device = authored.display_settings.display_device
    stage.view_settings.view_transform = authored.view_settings.view_transform
    stage.view_settings.look = authored.view_settings.look
    stage.view_settings.exposure = authored.view_settings.exposure
    stage.view_settings.gamma = authored.view_settings.gamma
    stage.view_settings.use_curve_mapping = authored.view_settings.use_curve_mapping
    stage.render.image_settings.file_format = "PNG"
    stage.render.image_settings.color_mode = "RGBA"
    stage.render.image_settings.color_depth = "8"
    image.save_render(str(output_png), scene=stage)
finally:
    bpy.data.scenes.remove(stage)
    bpy.data.images.remove(image)

print(f"BLENDLINK_SPLASH_AUTHORED_LOOK={output_png}")
