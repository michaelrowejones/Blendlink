# SPDX-License-Identifier: GPL-3.0-or-later
"""Isolated EEVEE Depth, Normal and AOV oracle; EXR32 outputs, no display transform."""

import bpy, numpy as np, pathlib, json, sys

root = (
    pathlib.Path(__file__).resolve().parents[2] / "artifacts/verification-look/passes"
)
root.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 64
scene.render.resolution_y = 48
scene.render.resolution_percentage = 100
scene.eevee.taa_render_samples = 1
scene.render.compositor_device = "CPU"
scene.render.compositor_precision = "FULL"
scene.render.use_compositing = True
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "32"
scene.view_settings.view_transform = "Raw"
camera = bpy.data.cameras.new("Depth oracle camera")
obj = bpy.data.objects.new("Depth oracle camera", camera)
scene.collection.objects.link(obj)
obj.location = (0, 0, 5)
scene.camera = obj
camera.lens = 24
camera.ortho_scale = 8
camera.clip_start = 0.1
camera.clip_end = 100
bpy.ops.mesh.primitive_plane_add(size=4)
plane = bpy.context.object
plane.name = "Opaque depth and normal oracle"
mat = bpy.data.materials.new("Pass writer")
mat.use_nodes = True
plane.data.materials.append(mat)
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
diff.inputs["Color"].default_value = (0.8, 0.6, 0.4, 1)
nt.links.new(diff.outputs[0], out.inputs["Surface"])
normal = nt.nodes.new("ShaderNodeNormalMap")
normal.inputs["Color"].default_value = (0.2, 0.65, 0.9, 1)
normal.inputs["Strength"].default_value = 1
for name, kind in [("OracleColor", "COLOR"), ("OracleValue", "VALUE")]:
    aov = scene.view_layers[0].aovs.add()
    aov.name = name
    aov.type = kind
aw = nt.nodes.new("ShaderNodeOutputAOV")
aw.name = "OracleColor"
aw.aov_name = "OracleColor"
mix = nt.nodes.new("ShaderNodeMixRGB")
mix.blend_type = "SUBTRACT"
mix.inputs[0].default_value = 1
mix.inputs[1].default_value = (0.5, 2, 4, 0.35)
mix.inputs[2].default_value = (1, 0, 0, 1)
nt.links.new(mix.outputs[0], aw.inputs["Color"])
av = nt.nodes.new("ShaderNodeOutputAOV")
av.name = "OracleValue"
av.aov_name = "OracleValue"
av.inputs["Value"].default_value = -2.125
layer = scene.view_layers[0]
layer.use_pass_z = True
layer.use_pass_normal = True
tree = bpy.data.node_groups.new("Pass oracle output", "CompositorNodeTree")
tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
scene.compositing_node_group = tree
rl = tree.nodes.new("CompositorNodeRLayers")
sink = tree.nodes.new("NodeGroupOutput")
cases = [
    ("perspective-depth", "PERSP", "Depth", False),
    ("ortho-depth", "ORTHO", "Depth", False),
    ("base-normal", "ORTHO", "Normal", False),
    ("mapped-normal", "ORTHO", "Normal", True),
    ("aov-color", "ORTHO", "OracleColor", False),
    ("aov-value", "ORTHO", "OracleValue", False),
]
rows = []
for label, camtype, passname, mapped in cases:
    camera.type = camtype
    for link in list(diff.inputs["Normal"].links):
        nt.links.remove(link)
    if mapped:
        nt.links.new(normal.outputs["Normal"], diff.inputs["Normal"])
    tree.links.new(rl.outputs[passname], sink.inputs[0])
    scene.render.filepath = str(root / (label + ".exr"))
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(scene.render.filepath, check_existing=False)
    im.alpha_mode = "PREMUL"
    pixels = np.array(im.pixels[:], np.float32).reshape(48, 64, 4)
    row = {
        "case": label,
        "cameraType": camtype,
        "center": pixels[24, 32].tolist(),
        "offAxis": pixels[24, 42].tolist(),
        "background": pixels[0, 0].tolist(),
    }
    rows.append(row)
    print(row, flush=True)
    data = {
        "version": 1,
        "case": label,
        "width": 64,
        "height": 48,
        "orientation": "bottom row first, x fastest, raw RGBA",
        "camera": {
            "type": camtype,
            "matrixWorld": [list(row) for row in obj.matrix_world],
            "lens": camera.lens,
            "sensorWidth": camera.sensor_width,
            "orthoScale": camera.ortho_scale,
            "near": camera.clip_start,
            "far": camera.clip_end,
        },
        "planeSize": 4,
        "normalMapColor": [0.2, 0.65, 0.9],
        "normalMapEnabled": mapped,
        "pass": passname,
        "expected": pixels.ravel().tolist(),
        "samples": row,
    }
    (root / (label + ".json")).write_text(json.dumps(data, separators=(",", ":")))
(root / "index.json").write_text(json.dumps(rows, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(root / "pass-oracle.blend"))
