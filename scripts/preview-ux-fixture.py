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
# Exercise automatic live material translation in the actual preview/export
# flow, including the newly supported XYZ Mapping rotation.
material = bpy.data.materials.new("Live Artist Checker")
material.use_nodes = True
tree = material.node_tree
principled = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
coordinates = tree.nodes.new("ShaderNodeTexCoord")
mapping = tree.nodes.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value = (0.19, -0.27, 0.31)
checker = tree.nodes.new("ShaderNodeTexChecker")
checker.inputs["Color1"].default_value = (0.025, 0.16, 0.8, 1)
checker.inputs["Color2"].default_value = (0.95, 0.45, 0.04, 1)
checker.inputs["Scale"].default_value = 5
tree.links.new(coordinates.outputs["UV"], mapping.inputs["Vector"])
tree.links.new(mapping.outputs["Vector"], checker.inputs["Vector"])
tree.links.new(checker.outputs["Color"], principled.inputs["Base Color"])
cube.data.materials.clear()
cube.data.materials.append(material)

# The same artist flow must build the authored image graph before display
# conversion, rather than silently omitting its grade.
scene.world.use_nodes = True
background = next(node for node in scene.world.node_tree.nodes if node.type == "BACKGROUND")
background.inputs["Color"].default_value = (0.04, 0.04, 0.04, 1)
background.inputs["Strength"].default_value = 1
scene.render.use_compositing = True
if hasattr(scene, "compositing_node_group"):
    compositor = bpy.data.node_groups.new("Website Artist Grade", "CompositorNodeTree")
    compositor.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = compositor
    sink = compositor.nodes.new("NodeGroupOutput")
else:
    scene.use_nodes = True
    compositor = scene.node_tree
    compositor.nodes.clear()
    sink = compositor.nodes.new("CompositorNodeComposite")
layers = compositor.nodes.new("CompositorNodeRLayers")
grade = compositor.nodes.new("CompositorNodeColorBalance")
if grade.inputs.get("Type") is not None:
    grade.inputs["Type"].default_value = "Offset/Power/Slope (ASC-CDL)"
    grade.inputs["Color Offset"].default_value = (0.25, 0, 0, 1)
else:
    grade.correction_method = "OFFSET_POWER_SLOPE"
    grade.offset = (0.25, 0, 0)
    grade.offset_basis = 0
compositor.links.new(layers.outputs["Image"], grade.inputs["Image"])
compositor.links.new(grade.outputs[0], sink.inputs[0])
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
