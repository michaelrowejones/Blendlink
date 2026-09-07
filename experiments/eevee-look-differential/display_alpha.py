# SPDX-License-Identifier: GPL-3.0-or-later
"""RenderResult -> PNG16 alpha boundary, checked against explicit OCIO alternatives."""

import bpy, numpy as np, pathlib, sys, json

repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / "artifacts/verification-look/compositor/display-alpha-cases"
root.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(repo / "packages/blendlink/blender"))
import source_presentation as ocio

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 8
scene.render.resolution_y = 8
scene.render.resolution_percentage = 100
scene.render.compositor_device = "CPU"
scene.render.compositor_precision = "FULL"
scene.render.use_compositing = True
scene.render.dither_intensity = 0
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_depth = "16"
scene.render.image_settings.color_mode = "RGBA"
alphas = [0, 0.001, 0.0625, 0.125, 0.25, 0.5, 0.75, 1]
straight = np.array(
    [
        [0.02, 0.3, 2],
        [4, 0.5, 0.1],
        [-0.25, 0.4, 1],
        [0.1, 0.1, 0.1],
        [0.01, 0.04, 0.08],
        [16, 4, 1],
        [1, 0, 0],
        [0, 1, 0],
    ],
    np.float32,
)
pixels = np.ones((8, 8, 4), np.float32)
for y in range(8):
    for x, a in enumerate(alphas):
        pixels[y, x] = [*(straight[y] * (a if a else 1)), a]
image = bpy.data.images.new(
    "Premultiplied Alpha Ground Truth", width=8, height=8, alpha=True, float_buffer=True
)
image.alpha_mode = "PREMUL"
image.colorspace_settings.name = "Linear Rec.709"
image.pixels.foreach_set(pixels.ravel())
tree = bpy.data.node_groups.new("Alpha display identity", "CompositorNodeTree")
tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
scene.compositing_node_group = tree
source = tree.nodes.new("CompositorNodeImage")
source.image = image
sink = tree.nodes.new("NodeGroupOutput")
tree.links.new(source.outputs["Image"], sink.inputs[0])
cfg, _ = ocio.config_from_install()
rows = []
for view in ["AgX", "Filmic", "Standard"]:
    scene.view_settings.view_transform = view
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    ocio.export_source_presentation(scene, root / view)
    scene.render.filepath = str(root / (view + ".png"))
    bpy.ops.render.render(write_still=True)
    read = bpy.data.images.load(scene.render.filepath, check_existing=False)
    read.colorspace_settings.name = "Non-Color"
    read.alpha_mode = "STRAIGHT"
    rgba = np.array(read.pixels[:], np.float32).reshape(8, 8, 4)
    cpu = ocio.composed_processor(scene, cfg).getDefaultCPUProcessor()
    unpremul = pixels[:, :, :3].copy()
    mask = (pixels[:, :, 3] != 0) & (pixels[:, :, 3] != 1)
    unpremul[mask] /= pixels[:, :, 3][mask, None]
    values = np.ascontiguousarray(unpremul.reshape(-1, 3))
    cpu.applyRGB(values)
    values = values.reshape(8, 8, 3)
    direct = np.ascontiguousarray(pixels[:, :, :3].reshape(-1, 3))
    cpu.applyRGB(direct)
    direct = direct.reshape(8, 8, 3)
    repremul = values.copy()
    repremul[mask] *= pixels[:, :, 3][mask, None]
    error = float(abs(np.clip(values, 0, 1) - rgba[:, :, :3]).max())
    direct_error = float(abs(np.clip(direct, 0, 1) - rgba[:, :, :3]).max())
    row = {
        "view": view,
        "png16UnpremultiplyError": error,
        "png16DirectOcioError": direct_error,
        "alphaError": float(abs(pixels[:, :, 3] - rgba[:, :, 3]).max()),
    }
    rows.append(row)
    print(row, flush=True)
    d = {
        "version": 1,
        "case": "display-alpha-" + view,
        "width": 8,
        "height": 8,
        "orientation": "bottom row first, x fastest RGBA",
        "input": pixels.ravel().tolist(),
        "inputEncoding": "scene-linear premultiplied Linear Rec.709; alpha0 retains emissive RGB",
        "view": view,
        "expectedPngStraight": rgba.ravel().tolist(),
        "expectedDisplayStraightCpu": np.concatenate(
            [values, pixels[:, :, 3, None]], axis=2
        )
        .ravel()
        .tolist(),
        "expectedDisplayPremultipliedCpu": np.concatenate(
            [repremul, pixels[:, :, 3, None]], axis=2
        )
        .ravel()
        .tolist(),
        "comparison": row,
    }
    (root / (view + ".json")).write_text(json.dumps(d, separators=(",", ":")))
(root / "index.json").write_text(json.dumps(rows, indent=2))
