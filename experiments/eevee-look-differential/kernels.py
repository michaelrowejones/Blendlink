# SPDX-License-Identifier: GPL-3.0-or-later
"""Research-only Blender ground truth; production graphs extracted before image injection."""

import bpy, numpy as np, pathlib, sys, json, math

repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / "artifacts/verification-look/compositor/kernel-browser-cases"
root.mkdir(parents=True, exist_ok=True)
bloom_quality_mode = "--bloom-quality" in sys.argv
if bloom_quality_mode:
    root = root.parent / "bloom-browser-cases"
    root.mkdir(exist_ok=True)
sys.path.insert(0, str(repo / "packages/blendlink/blender"))
import compositor_graph


def weights(radius):
    radius = np.float32(max(0, radius))
    scale = np.float32(1 / radius) if radius else np.float32(0)
    # Preserve source float32 arithmetic, including the otherwise cancellable Gaussian factor.
    a = np.float32(1.6)
    two = np.float32(2 * a * a)
    factor = np.float32(1 / np.sqrt(np.float32(np.pi) * two))
    values = []
    total = np.float32(0)
    for i in range(math.ceil(float(radius)) + 1):
        x = np.float32(np.float32(i) * scale)
        x = np.float32(x * np.float32(3 * a))
        w = np.float32(factor * np.exp(np.float32(-x * x / two)))
        values.append(w)
        total = np.float32(total + np.float32(w * (1 if i == 0 else 2)))
    return np.asarray(values, np.float32) / total


def blur(image, size):
    result = image.copy()
    for axis, radius in [(1, size[0]), (0, size[1])]:
        w = weights(radius)
        indices = np.arange(result.shape[axis])
        out = np.float32(result * w[0])
        for i in range(1, len(w)):
            out += (
                np.take(result, np.clip(indices + i, 0, len(indices) - 1), axis=axis)
                * w[i]
            )
            out += (
                np.take(result, np.clip(indices - i, 0, len(indices) - 1), axis=axis)
                * w[i]
            )
        result = out
    return result


scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 8
scene.render.resolution_y = 8
scene.render.resolution_percentage = 100
scene.render.compositor_device = "CPU"
scene.render.compositor_precision = "FULL"
scene.render.use_compositing = True
scene.render.dither_intensity = 0
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "32"
rng = np.random.default_rng(2917)
hdr = rng.uniform(-2, 16, (8, 8, 4)).astype(np.float32)
hdr[:, :, 3] = np.resize(np.array([0, 0.125, 0.5, 1], np.float32), (8, 8))
hdr[:, :, :3] *= hdr[:, :, 3, None]
impulse = np.zeros((8, 8, 4), np.float32)
impulse[4, 4] = [8, 2, 1, 0.5]
edge = np.zeros((8, 8, 4), np.float32)
edge[:, 0] = [8, 2, -1, 0.25]
edge[0, :] = [1, 6, -2, 0.75]
cases = []
for label, image in [("impulse", impulse), ("edge", edge), ("hdr", hdr)]:
    for radius in [(0, 0), (2, 2), (0.7, 2.3), (0, 3.5)]:
        cases.append(
            (
                "blur-" + label + "-" + str(radius[0]) + "-" + str(radius[1]),
                image,
                "CompositorNodeBlur",
                {
                    "Size": radius,
                    "Type": "GAUSS",
                    "Separable": True,
                    "Extend Bounds": False,
                },
                "Image",
            )
        )
for kind in ["BLOOM", "FOG_GLOW"]:
    for output in ["Image", "Glare", "Highlights"]:
        cases.append(
            (
                "glare-" + kind.lower() + "-" + output.lower(),
                hdr,
                "CompositorNodeGlare",
                {
                    "Type": kind,
                    "Quality": "HIGH",
                    "Size": 0.8,
                    "Highlights Threshold": 1.1,
                    "Highlights Smoothness": 0.4,
                    "Clamp Highlights": True,
                    "Maximum Highlights": 5.0,
                    "Strength": 1.4,
                    "Saturation": 0.65,
                    "Tint": (0.7, 1.1, 0.8, 1),
                },
                output,
            )
        )
if bloom_quality_mode:
    cases = []
    for width, height in [(8, 8), (31, 23), (32, 24)]:
        pixels = rng.uniform(-2, 16, (height, width, 4)).astype(np.float32)
        pixels[:, :, 3] = np.resize(
            np.array([0, 0.125, 0.5, 1], np.float32), (height, width)
        )
        pixels[:, :, :3] *= pixels[:, :, 3, None]
        pixels[height // 2, width // 2] = [64, 16, 8, 0.5]
        pixels[0, 0] = [8, 2, -1, 0.25]
        for quality in ["HIGH", "MEDIUM", "LOW"]:
            for output in ["Image", "Glare", "Highlights"]:
                settings = {
                    "Type": "BLOOM",
                    "Quality": quality,
                    "Size": 0.8,
                    "Highlights Threshold": 1.1,
                    "Highlights Smoothness": 0.4,
                    "Clamp Highlights": True,
                    "Maximum Highlights": 5.0,
                    "Strength": 1.4,
                    "Saturation": 0.65,
                    "Tint": (0.7, 1.1, 0.8, 1),
                }
                cases.append(
                    (
                        f"bloom-{width}x{height}-{quality.lower()}-{output.lower()}",
                        pixels,
                        "CompositorNodeGlare",
                        settings,
                        output,
                    )
                )
summary = []
for label, pixels, kind, settings, output in cases:
    height, width = pixels.shape[:2]
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    tree = bpy.data.node_groups.new(label, "CompositorNodeTree")
    tree.interface.new_socket(
        name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
    )
    scene.compositing_node_group = tree
    source = tree.nodes.new("CompositorNodeRLayers")
    source.name = "Browser Input"
    sink = tree.nodes.new("NodeGroupOutput")
    op = tree.nodes.new(kind)
    for key, value in settings.items():
        next(s for s in op.inputs if s.identifier == key).default_value = (
            {
                "GAUSS": "Gaussian",
                "BLOOM": "Bloom",
                "FOG_GLOW": "Fog Glow",
                "HIGH": "High",
                "MEDIUM": "Medium",
                "LOW": "Low",
            }.get(value, value)
            if isinstance(value, str)
            else value
        )
    tree.links.new(source.outputs["Image"], op.inputs["Image"])
    tree.links.new(op.outputs[output], sink.inputs[0])
    program = compositor_graph.extract(scene)
    image = bpy.data.images.new(
        label, width=width, height=height, alpha=True, float_buffer=True
    )
    image.alpha_mode = "PREMUL"
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(pixels.ravel())
    image_node = tree.nodes.new("CompositorNodeImage")
    image_node.image = image
    tree.links.new(image_node.outputs["Image"], op.inputs["Image"])
    scene.render.filepath = str(root / (label + ".exr"))
    bpy.ops.render.render(write_still=True)
    read = bpy.data.images.load(scene.render.filepath, check_existing=False)
    read.alpha_mode = "PREMUL"
    expected = np.asarray(read.pixels[:], np.float32).reshape(height, width, 4)
    data = {
        "version": 1,
        "case": label,
        "blenderVersion": bpy.app.version_string,
        "device": "CPU",
        "precision": "FULL",
        "width": width,
        "height": height,
        "orientation": "bottom-row-first, x-fastest, RGBA",
        "colorSpace": "scene-linear Linear Rec.709",
        "alpha": "premultiplied input and output, no display transform",
        "input": pixels.ravel().tolist(),
        "expected": expected.ravel().tolist(),
        "program": program,
        "settings": settings,
        "outputSocket": output,
    }
    row = {"case": label, "programStatus": program["status"]}
    if kind == "CompositorNodeBlur":
        actual = blur(pixels, settings["Size"])
        error = float(np.max(np.abs(actual - expected)))
        data["cpuPrototypeMaxError"] = error
        data["weightsX"] = weights(settings["Size"][0]).tolist()
        data["weightsY"] = weights(settings["Size"][1]).tolist()
        row["cpuPrototypeMaxError"] = error
    (root / (label + ".json")).write_text(json.dumps(data, separators=(",", ":")))
    summary.append(row)
    print("KERNEL_CASE_READY", row, flush=True)
    bpy.data.images.remove(read)
    scene.compositing_node_group = None
    bpy.data.node_groups.remove(tree)
    bpy.data.images.remove(image)
(root / "index.json").write_text(json.dumps(summary, indent=2))
