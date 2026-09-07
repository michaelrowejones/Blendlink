# SPDX-License-Identifier: GPL-3.0-or-later
"""Extract production programs, then evaluate identical HDR+alpha inputs in Blender.
All JSON pixel arrays are row-major, bottom row first, RGBA, scene-linear floats.
"""

import bpy, numpy as np, pathlib, sys, json, time

repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / "artifacts/verification-look/compositor/browser-cases"
root.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(repo / "packages/blendlink/blender"))
import compositor_graph

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
rng = np.random.default_rng(2187)
pixels = np.ones((8, 8, 4), np.float32)
pixels[:, :, :3] = rng.uniform(-0.5, 4, (8, 8, 3))
pixels[:, :, 3] = np.resize(np.array([0, 0.125, 0.5, 1], np.float32), (8, 8))
pixels[:, :, :3] *= pixels[:, :, 3, None]
pixels[0, :4, :] = [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1], [2, -0.5, 0.25, 1]]
image = bpy.data.images.new(
    "Exact HDR Premultiplied Input", width=8, height=8, alpha=True, float_buffer=True
)
image.alpha_mode = "PREMUL"
image.colorspace_settings.name = "Linear Rec.709"
image.pixels.foreach_set(pixels.ravel())
cases = [
    ("identity", None, {}),
    ("exposure", "CompositorNodeExposure", {"Exposure": 1.3}),
    ("bright-positive", "CompositorNodeBrightContrast", {"Bright": 17, "Contrast": 35}),
    (
        "bright-negative",
        "CompositorNodeBrightContrast",
        {"Bright": -13, "Contrast": -44},
    ),
    ("gamma", "ShaderNodeGamma", {"Gamma": 1.7}),
    (
        "invert-color",
        "CompositorNodeInvert",
        {"Fac": 0.37, "Invert Color": True, "Invert Alpha": False},
    ),
    (
        "invert-alpha",
        "CompositorNodeInvert",
        {"Fac": 0.6, "Invert Color": False, "Invert Alpha": True},
    ),
    (
        "hsv",
        "CompositorNodeHueSat",
        {"Hue": 0.73, "Saturation": 1.4, "Value": 0.8, "Fac": 0.61},
    ),
    ("mixrgb-mix", "ShaderNodeMixRGB", {"Fac": 0.4}),
    ("mixrgb-add", "ShaderNodeMixRGB", {"Fac": 0.4}),
    ("mixrgb-mult", "ShaderNodeMixRGB", {"Fac": 0.4}),
    ("mix-mix", "ShaderNodeMix", {"Factor_Float": 0.4}),
    ("mix-add", "ShaderNodeMix", {"Factor_Float": 0.4}),
    ("mix-mult", "ShaderNodeMix", {"Factor_Float": 0.4}),
    ("alpha-over", "CompositorNodeAlphaOver", {"Fac": 0.6, "Straight Alpha": False}),
    (
        "alpha-over-straight",
        "CompositorNodeAlphaOver",
        {"Fac": 0.6, "Straight Alpha": True},
    ),
    ("cast-color-value", "ShaderNodeMath", {}),
    ("constant-glare-Image", "CompositorNodeGlare", {"Type": "Bloom"}),
    ("constant-glare-Glare", "CompositorNodeGlare", {"Type": "Bloom"}),
    ("constant-glare-Highlights", "CompositorNodeGlare", {"Type": "Bloom"}),
]
constant = [0.2, 0.4, 0.8, 0.3]
summary = []
for label, kind, settings in cases:
    tree = bpy.data.node_groups.new(label, "CompositorNodeTree")
    tree.interface.new_socket(
        name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
    )
    scene.compositing_node_group = tree
    source = tree.nodes.new("CompositorNodeRLayers")
    source.name = "Browser Input"
    sink = tree.nodes.new("NodeGroupOutput")
    if kind is None:
        tree.links.new(source.outputs["Image"], sink.inputs[0])
    else:
        op = tree.nodes.new(kind)
        if kind == "ShaderNodeMix":
            op.data_type = "RGBA"
            op.blend_type = {"mix": "MIX", "add": "ADD", "mult": "MULTIPLY"}[
                label.split("-")[-1]
            ]
            op.inputs["B"].default_value = constant
            source_input = next(s for s in op.inputs if s.identifier == "A_Color")
        elif kind == "ShaderNodeMixRGB":
            op.blend_type = {"mix": "MIX", "add": "ADD", "mult": "MULTIPLY"}[
                label.split("-")[-1]
            ]
            op.inputs["Color2"].default_value = constant
            source_input = op.inputs["Color1"]
        elif kind == "CompositorNodeAlphaOver":
            op.inputs["Foreground"].default_value = constant
            source_input = op.inputs["Background"]
        elif kind == "ShaderNodeMath":
            op.operation = "MULTIPLY"
            op.inputs[1].default_value = 1
            source_input = op.inputs[0]
        else:
            source_input = (
                op.inputs["Image"] if "Image" in op.inputs else op.inputs["Color"]
            )
        for key, setting in settings.items():
            next(s for s in op.inputs if s.identifier == key).default_value = setting
        tree.links.new(source.outputs["Image"], source_input)
        if label.startswith("constant-glare-"):
            color = tree.nodes.new("CompositorNodeRGB")
            color.outputs[0].default_value = [2, 1, 0.5, 0.4]
            exposure = tree.nodes.new("CompositorNodeExposure")
            exposure.inputs["Exposure"].default_value = 1
            tree.links.new(color.outputs[0], exposure.inputs["Image"])
            tree.links.new(exposure.outputs[0], source_input)
        output = (
            next((s for s in op.outputs if s.identifier == "Result_Color"), None)
            if kind == "ShaderNodeMix"
            else op.outputs[0]
        )
        if label.startswith("constant-glare-"):
            output = op.outputs[label.split("-")[-1]]
        tree.links.new(output, sink.inputs[0])
    program = compositor_graph.extract(scene)
    assert program["status"] == "extracted", program
    # Replace only after production extraction; browser receives RenderLayers Image.
    destinations = [link.to_socket for link in source.outputs["Image"].links]
    source_image = tree.nodes.new("CompositorNodeImage")
    source_image.image = image
    for destination in destinations:
        tree.links.new(source_image.outputs["Image"], destination)
    scene.render.filepath = str(root / (label + ".exr"))
    started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    read = bpy.data.images.load(scene.render.filepath, check_existing=False)
    read.alpha_mode = "PREMUL"
    expected = np.asarray(read.pixels[:], np.float32).reshape(8, 8, 4)
    assert np.isfinite(expected).all(), label
    if label == "identity":
        assert np.max(np.abs(pixels - expected)) < 1e-6, np.max(
            np.abs(pixels - expected)
        )
    data = {
        "version": 1,
        "case": label,
        "blenderVersion": bpy.app.version_string,
        "device": "CPU",
        "precision": "FULL",
        "width": 8,
        "height": 8,
        "orientation": "bottom-row-first, x-fastest, RGBA",
        "colorSpace": "scene-linear Linear Rec.709",
        "alpha": "premultiplied input and output, no display transform",
        "input": pixels.ravel().tolist(),
        "expected": expected.ravel().tolist(),
        "program": program,
    }
    (root / (label + ".json")).write_text(json.dumps(data, separators=(",", ":")))
    summary.append(
        {
            "case": label,
            "seconds": time.monotonic() - started,
            "outputMin": float(expected.min()),
            "outputMax": float(expected.max()),
        }
    )
    print("CASE_READY", label, flush=True)
    bpy.data.images.remove(read)
    # Metadata differs from executed graph deliberately; both are reproducible.
    scene.compositing_node_group = None
    bpy.data.node_groups.remove(tree)
(root / "index.json").write_text(json.dumps(summary, indent=2))
print("BROWSER_COMPOSITOR_CASES_READY", len(summary), flush=True)
