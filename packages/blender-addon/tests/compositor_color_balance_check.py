# SPDX-License-Identifier: GPL-3.0-or-later
"""Real compositor float-pixel references for legacy and socket Color Balance.

Set BLENDLINK_COLOR_BALANCE_REFERENCES to retain the extracted browser programs
and native EXR pixel arrays; otherwise this discovered headless suite is temporary.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import compositor_graph


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def expected_grade(pixels, model, mode, factor, settings):
    color = pixels[..., :3].astype(np.float64)
    vector = lambda key, default: np.asarray(settings.get(key, default), dtype=np.float64)[:3]
    scalar = lambda key, default: float(settings.get(key, default))
    if mode == "Lift/Gamma/Gain":
        source = color
        if model == "legacy-srgb":
            source = np.where(color < 0.0031308, np.maximum(color, 0) * 12.92,
                              1.055 * np.maximum(color, 0) ** (1 / 2.4) - 0.055)
        lift = vector("Color Lift", [1, 1, 1]) + scalar("Base Lift", 0)
        gained = np.maximum(((source - 1) * (2 - lift) + 1)
                            * vector("Color Gain", [1, 1, 1]) * scalar("Base Gain", 1), 0)
        if model == "legacy-srgb":
            gained = np.where(gained < 0.04045, gained / 12.92,
                              ((gained + 0.055) / 1.055) ** 2.4)
        gamma = vector("Color Gamma", [1, 1, 1]) * scalar("Base Gamma", 1)
        gamma = np.where(gamma == 0, 1e-6, gamma) if model == "legacy-srgb" else np.maximum(gamma, 1e-6)
        balanced = gained ** (1 / gamma)
    else:
        balanced = np.maximum(color * vector("Color Slope", [1, 1, 1]) * scalar("Base Slope", 1)
                              + vector("Color Offset", [0, 0, 0]) + scalar("Base Offset", 0), 0)
        balanced = balanced ** (vector("Color Power", [1, 1, 1]) * scalar("Base Power", 1))
    expected = pixels.astype(np.float64).copy()
    expected[..., :3] = color + min(factor, 1) * (balanced - color)
    return expected


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
    if hasattr(scene.render, "compositor_device"):
        scene.render.compositor_device = "CPU"
    if hasattr(scene.render, "compositor_precision"):
        scene.render.compositor_precision = "FULL"
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
        tree = bpy.data.node_groups.new("Native Color Balance", "CompositorNodeTree")
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
        sink = tree.nodes.new("NodeGroupOutput")
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        sink = tree.nodes.new("CompositorNodeComposite")
    source = tree.nodes.new("CompositorNodeRLayers")
    grade = tree.nodes.new("CompositorNodeColorBalance")
    grade.name = "Final Artist Grade"
    socket_model = grade.inputs.get("Type") is not None
    model = "linear" if socket_model else "legacy-srgb"
    tree.links.new(source.outputs["Image"], grade.inputs["Image"])
    tree.links.new(grade.outputs[0], sink.inputs[0])
    factor_node = tree.nodes.new("ShaderNodeValue" if socket_model else "CompositorNodeValue")
    tree.links.new(factor_node.outputs[0], grade.inputs["Fac"])
    image_node = tree.nodes.new("CompositorNodeImage")
    rng = np.random.default_rng(64083)
    pixels = rng.uniform(-0.4, 3.5, (8, 8, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, 0.125, 0.5, 1], np.float32), (8, 8))
    pixels[..., :3] *= pixels[..., 3, None]
    pixels[0, :4] = [[-0.2, 0.01, 0.8, 1], [0.0031308, 0.04045, 0.5, 1],
                     [2, -0.1, 0.5, 0.5], [0, 0, 0, 0]]
    lgg = {"Color Lift": [0.86, 1.12, 1.04, 0.25],
           "Color Gamma": [0.8, 1.2, 1.05, 0.5], "Color Gain": [1.1, 0.9, 1.3, 0.75]}
    cdl = {"Color Offset": [0.03, 0.04, 0.02, 0], "Base Offset": -0.08,
           "Color Power": [0.8, 1.4, 1.1, 0.5], "Color Slope": [1.2, 0.9, 1.05, 0.25]}
    cases = [("lgg-neutral", "Lift/Gamma/Gain", 1, {}),
             *[("lgg-" + label, "Lift/Gamma/Gain", factor, lgg)
               for label, factor in [("full", 1), ("partial", 0.37), ("zero", 0),
                                     ("negative-factor", -0.25), ("over-factor", 1.5)]],
             ("cdl-full", "Offset/Power/Slope (ASC-CDL)", 1, cdl),
             ("cdl-partial", "Offset/Power/Slope (ASC-CDL)", 0.45, cdl),
             ("lgg-zero-gamma", "Lift/Gamma/Gain", 1, {"Color Gamma": [0, 0, 0, 1]})]
    if socket_model:
        cases.append(("lgg-base-controls", "Lift/Gamma/Gain", 0.73,
                      {**lgg, "Base Lift": 0.06, "Base Gamma": 0.9, "Base Gain": 1.1}))
    rows = []
    for label, mode, factor, settings in cases:
        case_pixels = pixels.copy()
        if label == "lgg-zero-gamma":
            case_pixels[..., :3] = [0.01, 0.02, 0.03]
            case_pixels[..., :3] *= case_pixels[..., 3, None]
        if socket_model:
            grade.inputs["Type"].default_value = mode
            for name, default in [("Base Lift", 0), ("Base Gamma", 1), ("Base Gain", 1),
                                  ("Base Offset", 0), ("Base Power", 1), ("Base Slope", 1),
                                  ("Color Lift", [1, 1, 1, 1]), ("Color Gamma", [1, 1, 1, 1]),
                                  ("Color Gain", [1, 1, 1, 1]), ("Color Offset", [0, 0, 0, 1]),
                                  ("Color Power", [1, 1, 1, 1]), ("Color Slope", [1, 1, 1, 1])]:
                grade.inputs[name].default_value = settings.get(name, default)
        else:
            grade.correction_method = "LIFT_GAMMA_GAIN" if mode == "Lift/Gamma/Gain" else "OFFSET_POWER_SLOPE"
            # Legacy setters synchronize the other grading model. Set only
            # the active controls so resetting inactive defaults cannot undo it.
            parameters = [("lift", [1, 1, 1]), ("gamma", [1, 1, 1]), ("gain", [1, 1, 1])] if mode == "Lift/Gamma/Gain" else [
                ("offset", [0, 0, 0]), ("power", [1, 1, 1]), ("slope", [1, 1, 1])]
            for name, default in parameters:
                setattr(grade, name, settings.get("Color " + name.title(), default)[:3])
            if mode != "Lift/Gamma/Gain":
                grade.offset_basis = settings.get("Base Offset", 0)
        factor_node.outputs[0].default_value = factor
        tree.links.new(source.outputs["Image"], grade.inputs["Image"])
        program = compositor_graph.extract(scene)
        expect(program["status"] == "extracted", program)
        expect(program["ops"][-1]["properties"]["color_balance_model"] == model, program)
        image = bpy.data.images.new("Premultiplied HDR", width=8, height=8, alpha=True, float_buffer=True)
        image.alpha_mode = "PREMUL"
        image.colorspace_settings.name = "Linear Rec.709"
        image.pixels.foreach_set(case_pixels.ravel())
        image_node.image = image
        tree.links.new(image_node.outputs["Image"], grade.inputs["Image"])
        scene.render.filepath = str(output / (label + ".exr"))
        bpy.ops.render.render(write_still=True)
        read = bpy.data.images.load(scene.render.filepath, check_existing=False)
        read.alpha_mode = "PREMUL"
        actual = np.asarray(read.pixels[:], np.float32).reshape(8, 8, 4)
        expected = expected_grade(case_pixels, model, mode, factor, settings)
        error = float(np.max(np.abs(actual - expected)))
        expect(np.isfinite(actual).all() and error < 2e-5,
               f"{label} {model}: native Color Balance differs from normalized math by {error}")
        expect(np.array_equal(actual[..., 3], case_pixels[..., 3]), "Color Balance changed alpha")
        data = {"case": model + "-" + label, "blenderVersion": bpy.app.version_string,
                "blenderHash": bpy.app.build_hash.decode(), "device": "CPU", "width": 8, "height": 8,
                "orientation": "bottom-row-first, x-fastest RGBA", "colorSpace": "scene-linear", "exactAlpha": True,
                "input": case_pixels.ravel().tolist(), "expected": actual.ravel().tolist(), "program": program}
        (output / (data["case"] + ".json")).write_text(json.dumps(data, separators=(",", ":")))
        rows.append({"case": data["case"], "nativeMathError": error})
        bpy.data.images.remove(read)
        image_node.image = None
        bpy.data.images.remove(image)
    if socket_model:
        tree.links.new(source.outputs["Image"], grade.inputs["Image"])
        unused = tree.nodes.new("CompositorNodeLensdist")
        tree.links.new(unused.outputs["Image"], grade.inputs["Input Temperature"])
        grade.inputs["Type"].default_value = "Lift/Gamma/Gain"
        expect(compositor_graph.extract(scene)["status"] == "extracted",
               "An unused White Point branch incorrectly blocked Lift/Gamma/Gain")
        grade.inputs["Type"].default_value = "White Point"
        refused = compositor_graph.extract(scene)
        expect(refused["status"] == "unsupported" and
               refused["diagnostics"][-1]["code"] == "unsupported-color-balance-mode", refused)
        grade.inputs["Type"].default_value = "Lift/Gamma/Gain"
        mode = tree.interface.new_socket(name="Dynamic mode", in_out="INPUT", socket_type="NodeSocketMenu")
        incoming = tree.nodes.new("NodeGroupInput")
        tree.links.new(incoming.outputs[mode.identifier], grade.inputs["Type"])
        refused = compositor_graph.extract(scene)
        expect(refused["status"] == "unsupported" and
               refused["diagnostics"][-1]["code"] == "dynamic-color-balance-mode", refused)
        for link in list(grade.inputs["Type"].links):
            tree.links.remove(link)
        grade.inputs["Color Lift"].keyframe_insert(data_path="default_value", frame=1)
    else:
        tree.links.new(source.outputs["Image"], grade.inputs["Image"])
        grade.keyframe_insert(data_path="lift", frame=1)
    animated = compositor_graph.extract(scene)
    expect(animated["status"] == "unsupported" and
           animated["diagnostics"][-1]["code"] == "animated-tree", animated)
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    print("BLENDLINK_COLOR_BALANCE_CHECK_PASSED " + json.dumps({"model": model, "cases": len(rows),
                                                              "maxError": max(row["nativeMathError"] for row in rows)}))


destination = os.environ.get("BLENDLINK_COLOR_BALANCE_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-color-balance-") as directory:
        main(Path(directory))
