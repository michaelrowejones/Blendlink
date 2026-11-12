# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Object Info pixels and saved shared-mesh scenes for runtime proof.

BLENDLINK_OBJECT_INFO_REFERENCES retains fixtures; otherwise use a temp folder.
Run with factory Blender and --python-exit-code 1. References use Cycles CPU.
"""
import json
import math
import os
from pathlib import Path
import sys
import tempfile

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon.parent / "blendlink" / "blender"))
sys.path.insert(0, str(addon))
import material_compiler as compiler
import procedural
import tsl_ir
import tsl_object_info


def main(root):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.cycles.device = "CPU"
    import _cycles
    _cycles.set_device_override("CPU")
    scene.render.resolution_x, scene.render.resolution_y = 128, 64
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    scene.render.dither_intensity = 0
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1, 25
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    mesh = bpy.data.meshes.new("Shared Object Info two-slot surface")
    mesh.from_pydata([(-.8,-.8,0),(0,-.8,0),(.8,-.8,0),(-.8,.8,0),(0,.8,0),(.8,.8,0)], [], [(0,1,4,3),(1,2,5,4)])
    mesh.polygons[1].material_index = 1
    materials, nodes = [], []
    for slot, index in enumerate((11, 23)):
        material = bpy.data.materials.new(f"Object Info Slot {slot}")
        material.use_nodes = True
        material.pass_index = index
        tree = material.node_tree
        tree.nodes.clear()
        info = tree.nodes.new("ShaderNodeObjectInfo")
        emission = tree.nodes.new("ShaderNodeEmission")
        sink = tree.nodes.new("ShaderNodeOutputMaterial")
        tree.links.new(emission.outputs[0], sink.inputs["Surface"])
        materials.append(material)
        nodes.append((tree, info, emission))
        mesh.materials.append(material)
    parent = bpy.data.objects.new("Authored parent transform", None)
    scene.collection.objects.link(parent)
    parent.location = (.15,-.2,.3)
    parent.rotation_euler = (.05,.1,.08)
    parent.scale = (1.15,.9,1.2)
    objects = []
    for name, x, color, index in (("InfoOwnerA", -1.5, (.8,.35,.1,.4), 7),
                                   ("InfoOwnerB", 1.5, (.1,.6,.9,.75), 13)):
        obj = bpy.data.objects.new(name, mesh)
        obj.parent = parent
        obj.location.x = x
        obj.color = color
        obj.pass_index = index
        scene.collection.objects.link(obj)
        objects.append(obj)
    obj = objects[0]
    obj.keyframe_insert("location", frame=1)
    obj.location.x = -.9
    obj.keyframe_insert("location", frame=25)
    for curve in procedural._action_fcurves(obj.animation_data.action, getattr(obj.animation_data, "action_slot", None))[0]:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    camera_data = bpy.data.cameras.new("Native Object Info Camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 6
    camera = bpy.data.objects.new("Native Object Info Camera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0,0,10)
    camera.rotation_euler = (0,0,0)
    scene.camera = camera
    for item in scene.objects:
        item["blendlink_id"] = "object-info-" + item.name.lower().replace(" ", "-")
    scene["blendlink_recipe"] = json.dumps({"schemaVersion":1,"presentation":"realtime",
        "atlases":[{"id":"main","name":"Main","size":256,"targetDensity":8,"margin":4,"fitPolicy":"block","bakeOutput":"lighting"}],
        "states":[{"name":"default"}],"playback":{"start":"first","loop":"once","speed":1},
        "preview":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1},
        "final":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1}})
    results = []
    for field in ("Location", "Color", "Alpha", "Object Index", "Material Index", "Random"):
        slug = field.lower().replace(" ", "-")
        for tree, info, emission in nodes:
            for link in tuple(emission.inputs["Color"].links):
                tree.links.remove(link)
            source = info.outputs[field]
            if field == "Location":
                scale = tree.nodes.new("ShaderNodeVectorMath"); scale.operation = "SCALE"
                scale.inputs["Scale"].default_value = .05
                tree.links.new(source, scale.inputs[0])
                bias = tree.nodes.new("ShaderNodeVectorMath"); bias.operation = "ADD"
                bias.inputs[1].default_value = (.5,.5,.5)
                tree.links.new(scale.outputs["Vector"], bias.inputs[0]); source = bias.outputs["Vector"]
            elif field in {"Object Index", "Material Index"}:
                arithmetic = tree.nodes.new("ShaderNodeMath"); arithmetic.operation = "MULTIPLY_ADD"
                arithmetic.inputs[1].default_value = .01; arithmetic.inputs[2].default_value = .1
                tree.links.new(source, arithmetic.inputs[0]); source = arithmetic.outputs[0]
            tree.links.new(source, emission.inputs["Color"])
            ir = tsl_ir.emit_output(info, info.outputs[field])
            assert ir["op"] == ("attribute_object" if field == "Random" else "object_info"), ir
        scene.frame_set(1)
        bpy.context.view_layer.update()
        blend = root / f"{slug}.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        for frame in (1,25):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            scene.render.filepath = str(root / f"{slug}-{frame}.exr")
            bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(scene.render.filepath, check_existing=False)
            taps = []
            for owner in objects:
                for polygon in mesh.polygons:
                    center = owner.matrix_world @ polygon.center
                    uv = world_to_camera_view(scene, camera, center)
                    x, y = int(uv.x*128), int(uv.y*64)
                    rgb = list(image.pixels[(y*128+x)*4:(y*128+x)*4+3])
                    if field == "Location": expected = [float(v)*.05+.5 for v in owner.matrix_world.translation]
                    elif field == "Color": expected = list(owner.color[:3])
                    elif field == "Alpha": expected = [float(owner.color[3])]*3
                    elif field == "Object Index": expected = [owner.pass_index*.01+.1]*3
                    elif field == "Material Index": expected = [materials[polygon.material_index].pass_index*.01+.1]*3
                    else: expected = [tsl_ir.object_random_number(owner.name)]*3
                    assert max(abs(a-b) for a,b in zip(rgb,expected)) < 3e-6, (field,owner.name,frame,rgb,expected)
                    taps.append({"owner":owner.name,"slot":polygon.material_index,"x":x,"y":y,"rgb":rgb,
                                 "worldLocation":list(owner.matrix_world.translation)})
            bpy.data.images.remove(image)
            results.append({"field":field,"slug":slug,"frame":frame,"blend":str(blend),"taps":taps})
    scene.frame_set(1)
    # Named refusals cover data that a core glTF transform clip cannot carry.
    obj.color = (.8,.35,.1,.4)
    obj.keyframe_insert("color",frame=1)
    try:
        tsl_object_info.owner_metadata(obj, {"color"})
        raise AssertionError("Animated object color silently became a static uniform")
    except ValueError as error:
        assert "timeline" in str(error)
    assert tsl_object_info.owner_metadata(obj, {"location"})
    document = {"version":bpy.app.version_string,"width":128,"height":64,
                "nativeEngine":"Cycles CPU","cases":results,"refusals":{"animatedColor":True}}
    (root / "index.json").write_text(json.dumps(document,indent=2))
    print("BLENDLINK_OBJECT_INFO_TRANSLATION_CHECK_PASSED",bpy.app.version_string,len(results),"native frames")


output = os.environ.get("BLENDLINK_OBJECT_INFO_REFERENCES")
if output:
    directory = Path(output); directory.mkdir(parents=True, exist_ok=True); main(directory)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-native-object-info-") as temporary:
        main(Path(temporary))
