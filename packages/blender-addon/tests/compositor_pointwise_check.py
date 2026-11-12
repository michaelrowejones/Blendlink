# SPDX-License-Identifier: GPL-3.0-or-later
"""Native spatial float-pixel references for compositor numeric/color utilities."""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_graph


def main(output):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 1
    import _cycles
    _cycles.set_device_override("CPU")
    scene.render.resolution_x = scene.render.resolution_y = 8
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    device = os.environ.get("BLENDLINK_COMPOSITOR_POINTWISE_DEVICE", "CPU")
    if hasattr(scene.render, "compositor_device"):
        scene.render.compositor_device = device
        scene.render.compositor_precision = "FULL"
    elif device != "CPU":
        raise AssertionError("This Blender has no selectable offline GPU compositor")
    scene.render.dither_intensity = 0
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "32"
    modern = hasattr(scene, "compositing_node_group")
    if modern:
        tree = bpy.data.node_groups.new("Native Pointwise", "CompositorNodeTree")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
    else:
        scene.use_nodes = True
        tree = scene.node_tree
    pixels = np.random.default_rng(71239).uniform(-0.5, 2.5, (8, 8, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, 0.125, 0.5, 1], np.float32), (8, 8))
    pixels[..., :3] = np.where((pixels[..., :3] > 0) & (pixels[..., :3] < 0.125), 0.125, pixels[..., :3])
    pixels[0] = [[-1, 0, 1, 0], [0, 0.5, 1, 0.125], [0.5, 1, 2, 0.5], [1, 2, -0.5, 1],
                 [2, 0.25, -1, 0.125], [-0.5, -0.25, -0.125, 1], [0.25, 0.25, 0.25, 1], [0.75, 0.5, 0.25, 0.5]]
    image = bpy.data.images.new("Pointwise input", width=8, height=8, alpha=True, float_buffer=True)
    image.alpha_mode = "PREMUL"
    image.colorspace_settings.name = "Linear Rec.709"
    image.pixels.foreach_set(pixels.ravel())
    rows = []
    prefix = "blender-" + str(bpy.app.version[0]) + "-" + str(bpy.app.version[1]) + "-" + device.lower()

    def reset():
        tree.nodes.clear()
        sink = tree.nodes.new("NodeGroupOutput" if modern else "CompositorNodeComposite")
        source = tree.nodes.new("CompositorNodeRLayers")
        separate = tree.nodes.new("CompositorNodeSeparateColor")
        tree.links.new(source.outputs["Image"], separate.inputs["Image"])
        return sink, source, separate

    def save(label, source, case_pixels=None, exact_alpha=True):
        active_pixels = pixels if case_pixels is None else case_pixels
        image.pixels.foreach_set(active_pixels.ravel())
        groups = len(bpy.data.node_groups)
        curve_settings = [(node.name, node.mapping.use_clip,
                           [[tuple(point.location) for point in curve.points] for curve in node.mapping.curves])
                          for node in tree.nodes if hasattr(node, "mapping")]
        program = compositor_graph.extract(scene)
        assert program["status"] == "extracted", program
        assert len(bpy.data.node_groups) == groups, "Curve extraction leaked a temporary node group"
        assert curve_settings == [(node.name, node.mapping.use_clip,
                                   [[tuple(point.location) for point in curve.points] for curve in node.mapping.curves])
                                  for node in tree.nodes if hasattr(node, "mapping")], "Extraction changed authored curves"
        replacement = tree.nodes.new("CompositorNodeImage")
        replacement.image = image
        for link in list(source.outputs["Image"].links):
            tree.links.new(replacement.outputs["Image"], link.to_socket)
        path = output / "native.exr"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        result = bpy.data.images.load(str(path), check_existing=False)
        result.alpha_mode = "PREMUL"
        expected = np.asarray(result.pixels[:], np.float32).reshape(8, 8, 4)
        assert np.isfinite(expected).all(), (label, "Native pointwise result is non-finite")
        case = prefix + "-" + label
        data = {"case": case, "blenderVersion": bpy.app.version_string,
                "blenderHash": bpy.app.build_hash.decode(), "compositorDevice": device,
                "width": 8, "height": 8, "colorSpace": "scene-linear", "exactAlpha": exact_alpha,
                "input": active_pixels.ravel().tolist(), "expected": expected.ravel().tolist(), "program": program}
        (output / (case + ".json")).write_text(json.dumps(data, separators=(",", ":")))
        rows.append({"case": case})
        bpy.data.images.remove(result)

    sink, source, separate = reset()
    node = tree.nodes.new("CompositorNodeRGBToBW")
    tree.links.new(source.outputs["Image"], node.inputs["Image"])
    tree.links.new(node.outputs[0], sink.inputs[0])
    save("rgb-to-bw", source)

    for gamma in (0, 0.5, 2, -1):
        sink, source, separate = reset()
        node = tree.nodes.new("ShaderNodeGamma" if modern else "CompositorNodeGamma")
        tree.links.new(source.outputs["Image"], node.inputs["Color" if modern else "Image"])
        node.inputs["Gamma"].default_value = gamma
        tree.links.new(node.outputs[0], sink.inputs[0])
        save("gamma-" + str(gamma), source)

    if modern:
        for mode in ("MINMAX", "RANGE"):
            for bounds in ((0, 1), (1, -1), (0.5, 0.5)):
                sink, source, separate = reset()
                node = tree.nodes.new("ShaderNodeClamp")
                node.clamp_type = mode
                node.inputs["Min"].default_value, node.inputs["Max"].default_value = bounds
                tree.links.new(separate.outputs["Red"], node.inputs["Value"])
                tree.links.new(node.outputs[0], sink.inputs[0])
                save("clamp-" + mode.lower() + "-" + str(bounds[0]) + "-" + str(bounds[1]), source)

    for vector in ((False, True) if modern else (False,)):
        for interpolation in (("LINEAR", "STEPPED", "SMOOTHSTEP", "SMOOTHERSTEP") if modern else ("LINEAR",)):
            for clamp_result in (False, True):
                for index, (low, high, target_low, target_high, steps) in enumerate((
                    (0, 1, -0.25, 1.5, 4), (1, -1, 2, -2, 2), (0.5, 0.5, 0.3, 0.9, 3),
                    (0, 1, 0.5, 0.5, 0), (-1, 2, -1, 2, 0),
                )):
                    sink, source, separate = reset()
                    node = tree.nodes.new("ShaderNodeMapRange" if modern else "CompositorNodeMapRange")
                    if modern:
                        node.data_type = "FLOAT_VECTOR" if vector else "FLOAT"
                        node.interpolation_type = interpolation
                        node.clamp = clamp_result
                    else:
                        node.use_clamp = clamp_result
                    names = ("Vector", "From_Min_FLOAT3", "From_Max_FLOAT3", "To_Min_FLOAT3", "To_Max_FLOAT3", "Steps_FLOAT3") if vector else (
                        "Value", "From Min", "From Max", "To Min", "To Max", "Steps")
                    sockets = {s.identifier: s for s in node.inputs}
                    for key, setting in zip(names[1:], (low, high, target_low, target_high, steps)):
                        if key not in sockets:
                            continue
                        sockets[key].default_value = (setting, setting * 0.5, -setting) if vector else setting
                    tree.links.new(source.outputs["Image"] if vector else separate.outputs["Red"], sockets[names[0]])
                    tree.links.new(node.outputs["Vector" if vector else "Result"] if modern else node.outputs[0], sink.inputs[0])
                    save("map-range-" + ("vector" if vector else "scalar") + "-" + interpolation.lower()
                         + "-" + str(int(clamp_result)) + "-" + str(index), source)
    if modern:
        for conversion in ("scalar-to-vector", "vector-to-scalar"):
            sink, source, separate = reset()
            node = tree.nodes.new("ShaderNodeMapRange")
            node.data_type = "FLOAT_VECTOR"
            tree.links.new(separate.outputs["Red"] if conversion == "scalar-to-vector" else source.outputs["Image"],
                           node.inputs["Vector"])
            if conversion == "vector-to-scalar":
                scalar = tree.nodes.new("ShaderNodeMath")
                scalar.operation = "ADD"
                scalar.inputs[1].default_value = 0
                tree.links.new(node.outputs["Vector"], scalar.inputs[0])
                tree.links.new(scalar.outputs[0], sink.inputs[0])
            else:
                tree.links.new(node.outputs["Vector"], sink.inputs[0])
            save(conversion, source)
    ramp_pixels = pixels.copy()
    ramp_pixels[..., 0] = np.linspace(-0.2, 1.2, 64, dtype=np.float32).reshape(8, 8)
    ramp_pixels[0, :, 0] = [-0.1, 0, 0.07, 0.43, 0.5, 0.91, 1, 1.1]
    for mode in ("RGB", "HSV", "HSL"):
        for interpolation in ("LINEAR", "CONSTANT", "EASE", "B_SPLINE", "CARDINAL"):
            for direction in (("NEAR", "FAR", "CW", "CCW") if mode != "RGB" else ("NEAR",)):
                for alpha in (False, True):
                    sink, source, separate = reset()
                    node = tree.nodes.new("ShaderNodeValToRGB" if modern else "CompositorNodeValToRGB")
                    ramp = node.color_ramp
                    ramp.elements[0].position = 0.07
                    ramp.elements[0].color = (0.92, 0.12, 0.37, 0.18)
                    ramp.elements[1].position = 0.91
                    ramp.elements[1].color = (0.22, 0.31, 0.95, 0.41)
                    middle = ramp.elements.new(0.43)
                    middle.color = (0.13, 0.88, 0.29, 0.79)
                    ramp.color_mode = mode
                    ramp.interpolation = interpolation
                    ramp.hue_interpolation = direction
                    tree.links.new(separate.outputs["Red"], node.inputs["Fac"])
                    tree.links.new(node.outputs["Alpha"] if alpha else node.outputs[0], sink.inputs[0])
                    save("ramp-" + mode.lower() + "-" + interpolation.lower() + "-" + direction.lower()
                         + ("-alpha" if alpha else "-color"), source, ramp_pixels, exact_alpha=alpha)
    for variant in ("two-linear", "two-ease", "two-constant", "duplicate", "narrow"):
        sink, source, separate = reset()
        node = tree.nodes.new("ShaderNodeValToRGB" if modern else "CompositorNodeValToRGB")
        ramp = node.color_ramp
        ramp.elements[0].position = 0.43
        ramp.elements[0].color = (0.9, 0.1, 0.25, 0.2)
        ramp.elements[1].position = 0.91
        ramp.elements[1].color = (0.1, 0.8, 0.6, 0.7)
        if variant in ("duplicate", "narrow"):
            middle = ramp.elements.new(0.43 if variant == "duplicate" else 0.43001)
            middle.color = (0.1, 0.4, 0.9, 0.4)
            ramp.interpolation = "LINEAR"
        else:
            ramp.interpolation = {"two-linear": "LINEAR", "two-ease": "EASE", "two-constant": "CONSTANT"}[variant]
        tree.links.new(separate.outputs["Red"], node.inputs["Fac"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        save("ramp-" + variant, source, ramp_pixels, exact_alpha=False)
    curve_types = ["CompositorNodeCurveRGB", "ShaderNodeRGBCurve", "ShaderNodeFloatCurve", "ShaderNodeVectorCurve"] if modern else (
        "CompositorNodeCurveRGB", "CompositorNodeCurveVec")
    for node_type in curve_types:
        compositor_rgb = node_type == "CompositorNodeCurveRGB"
        rgb = compositor_rgb or node_type == "ShaderNodeRGBCurve"
        scalar = node_type == "ShaderNodeFloatCurve"
        styles = ["identity", "combined" if rgb else "shaped", "channels", "horizontal", "nonunit", "unclipped"]
        if compositor_rgb:
            styles += ["film-like", "black-white"]
        for style in styles:
            for factor in ((1, 0.35, "spatial") if node_type != "CompositorNodeCurveVec" else (1,)):
                sink, source, separate = reset()
                node = tree.nodes.new(node_type)
                mapping = node.mapping
                mapping.initialize()
                if style == "nonunit":
                    mapping.use_clip = False
                    mapping.clip_min_x, mapping.clip_max_x = -1, 2
                    for curve in mapping.curves:
                        curve.points[0].location = (-1, -0.2)
                        curve.points[-1].location = (2, 1.3)
                if style == "unclipped":
                    mapping.use_clip = False
                if style == "horizontal":
                    mapping.extend = "HORIZONTAL"
                if style != "identity":
                    for index, curve in enumerate(mapping.curves):
                        if rgb and style == "combined" and index < 3:
                            continue
                        point = curve.points.new(0.37 if index != 3 else 0.52,
                                                 0.71 - index * 0.11)
                        point.handle_type = "VECTOR" if style == "channels" else "AUTO"
                if style == "film-like":
                    mapping.tone = "FILMLIKE"
                mapping.update()
                sockets = {s.identifier: s for s in node.inputs}
                if rgb:
                    tree.links.new(source.outputs["Image"], sockets["Image" if compositor_rgb else "Color"])
                    if style == "black-white":
                        sockets["Black Level"].default_value = (0.1, 0.04, 0.2, 1)
                        sockets["White Level"].default_value = (0.8, 1.2, 0.6, 1)
                elif scalar:
                    tree.links.new(separate.outputs["Red"], sockets["Value"])
                else:
                    tree.links.new(source.outputs["Image"], sockets["Vector"])
                factor_socket = sockets.get("Fac", sockets.get("Factor"))
                if factor_socket:
                    if factor == "spatial":
                        tree.links.new(separate.outputs["Red"], factor_socket)
                    else:
                        factor_socket.default_value = factor
                tree.links.new(node.outputs[0], sink.inputs[0])
                save("curves-" + node_type.lower() + "-" + style + "-" + str(factor), source)
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    print("BLENDLINK_COMPOSITOR_POINTWISE_CHECK_PASSED " + json.dumps({
        "blender": bpy.app.version_string, "device": device, "cases": len(rows)}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_POINTWISE_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-pointwise-") as directory:
        main(Path(directory))
