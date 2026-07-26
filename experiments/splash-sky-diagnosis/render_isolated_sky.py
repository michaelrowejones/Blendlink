"""Render the exact authored sky receiver from the exact authored camera."""

from __future__ import annotations

import pathlib
import sys

import bpy


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
source = pathlib.Path(args[0]).resolve()
output = pathlib.Path(args[1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(source))
authored = bpy.context.scene
sky = bpy.data.objects["DP-SkyPaint.GEO"]
for obj in authored.objects:
    obj.hide_render = obj != sky and obj.type != "CAMERA"

scene = bpy.data.scenes.new("Blendlink Isolated Sky Control")
bpy.context.window.scene = scene
scene.render.engine = authored.render.engine
for child in authored.collection.children:
    scene.collection.children.link(child)
for obj in authored.collection.objects:
    scene.collection.objects.link(obj)
scene.world = authored.world
scene.camera = bpy.data.objects["Camera"]
scene.display_settings.display_device = authored.display_settings.display_device
scene.view_settings.view_transform = authored.view_settings.view_transform
scene.view_settings.look = authored.view_settings.look
scene.view_settings.exposure = authored.view_settings.exposure
scene.view_settings.gamma = authored.view_settings.gamma
scene.view_settings.use_curve_mapping = authored.view_settings.use_curve_mapping
if hasattr(scene, "eevee") and hasattr(authored, "eevee"):
    for name in authored.eevee.bl_rna.properties.keys():
        if name == "rna_type" or getattr(authored.eevee.bl_rna.properties[name], "is_readonly", False):
            continue
        try:
            setattr(scene.eevee, name, getattr(authored.eevee, name))
        except (AttributeError, TypeError):
            pass
scene.render.resolution_x = 1200
scene.render.resolution_y = 600
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = str(output)
scene.frame_set(1)
bpy.ops.render.render(write_still=True)
print(f"BLENDLINK_SPLASH_ISOLATED_SKY={output}")
