# SPDX-License-Identifier: MIT
"""Small authored scenes for the real artist/visitor acceptance flow."""
import json
import math
import sys
from pathlib import Path

import bpy

root = Path(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=False)
scene = bpy.context.scene
for obj in scene.objects:
    obj["blendlink_id"] = "ux-" + obj.name.lower()

recipe = {
    "schemaVersion": 1,
    "presentation": "hybrid",
    "atlases": [{"id": "main", "name": "Main", "size": 256,
                 "targetDensity": 8, "margin": 4, "fitPolicy": "block",
                 "bakeOutput": "appearance"}],
    "preview": {"samples": 1, "supersample": 1, "denoise": False, "resolutionScale": 1},
    "final": {"samples": 1, "supersample": 1, "denoise": False, "resolutionScale": 1},
    "states": [{"name": "default"}],
}
scene["blendlink_recipe"] = json.dumps(recipe)
bpy.ops.wm.save_as_mainfile(filepath=str(root / "Planning Scene.blend"))

cube = bpy.data.objects["Cube"]
cube.scale = (1, 0.65, 1.3)
scene.frame_start, scene.frame_end = 1, 49
scene.render.fps = 24
for frame, angle in ((1, 0), (25, math.pi), (49, math.tau)):
    cube.rotation_euler.z = angle
    cube.keyframe_insert(data_path="rotation_euler", frame=frame)
scene.frame_set(1)
recipe.update(presentation="realtime", playback={"start": "first", "loop": "repeat", "speed": 1})
recipe["camera"] = {
    "objectId": scene.camera["blendlink_id"], "objectName": scene.camera.name,
    "behavior": "fixed", "framing": "authored",
    "compositions": [{"name": "Desktop", "width": 1440, "height": 1000, "safeMargin": 0.08}],
}
scene["blendlink_recipe"] = json.dumps(recipe)
bpy.ops.wm.save_as_mainfile(filepath=str(root / "Scene With Spaces.blend"))

recipe["playback"]["start"] = "manual"
scene["blendlink_recipe"] = json.dumps(recipe)
bpy.ops.wm.save_as_mainfile(filepath=str(root / "Manual Scene.blend"))

recipe["playback"]["start"] = "first"
recipe["camera"].update(behavior="orbit", targetId=cube["blendlink_id"], targetName=cube.name)
scene["blendlink_recipe"] = json.dumps(recipe)
bpy.ops.wm.save_as_mainfile(filepath=str(root / "Orbit Scene.blend"))
print("BLENDLINK_PREVIEW_UX_FIXTURES_READY")
