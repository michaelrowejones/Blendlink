# SPDX-License-Identifier: GPL-3.0-or-later
"""Native full-precision static separable Blur kernels, borders, RGBA and schemas."""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    pixels = np.random.default_rng(72131).uniform(-.4, 2, (7, 13, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (7, 13))
    oracle = NativeCompositorReference(output, pixels=pixels.copy(),
        device=os.environ.get("BLENDLINK_COMPOSITOR_BLUR_DEVICE", "CPU"), name="Native Blur")
    tree = oracle.tree
    labels = {"FLAT": "Flat", "TENT": "Tent", "QUAD": "Quadratic", "CUBIC": "Cubic",
              "GAUSS": "Gaussian", "CATROM": "Catrom", "MITCH": "Mitch"}

    def graph(kind, radius, multiplier=1, constant=False):
        sink, source = oracle.reset()
        node = tree.nodes.new("CompositorNodeBlur")
        modern = node.inputs.get("Type") is not None
        if modern:
            node.inputs["Type"].default_value = labels.get(kind, "Fast Gaussian")
            node.inputs["Size"].default_value = radius
        else:
            node.filter_type = kind
            node.size_x, node.size_y = radius
            tree.links.new(oracle.value(multiplier), node.inputs["Size"])
        tree.links.new(oracle.color((.25, -.5, 1.5, .35)) if constant else source.outputs["Image"], node.inputs["Image"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source, modern

    def save(label, source):
        oracle.save(label, source)
        file = Path(output) / (oracle.rows[-1]["case"] + ".json")
        data = json.loads(file.read_text())
        data["assertTextureCleanup"] = True
        data["assertMrtState"] = "after-exposure" in label or "cascade" in label
        for operation in data["program"]["ops"]:
            if operation["kind"] == "blur":
                assert operation["properties"]["blur_output_sampling_model"] == "native-texel-v1", operation
        assert data["width"] == 13 and data["height"] == 7, data
        file.write_text(json.dumps(data, separators=(",", ":")))
        return data

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    save("blur-control", source)
    impulse = np.zeros_like(pixels)
    impulse[0, 0] = [2, -.25, .75, 1]
    impulse[0, -1] = [-.25, 1.5, .125, .5]
    impulse[-1, 0] = [.25, .5, 2, .25]
    impulse[-1, -1] = [1, 1, 1, -.25]
    impulse[3, 6] = [4, 2, .5, 1.5]
    for pattern, active in (("random", pixels), ("impulse", impulse)):
        oracle.pixels[:] = active
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        for kind in labels:
            for radius in ((0, 0), (0, 2), (2, 0), (1, 1), (2, 3), (7, 5), (128, 0)):
                node, source, modern = graph(kind, radius)
                data = save("blur-" + pattern + "-" + kind.lower() + "-" + str(radius[0]) + "-" + str(radius[1]), source)
                if kind == "GAUSS" and radius == (2, 3):
                    compatibility = copy.deepcopy(data)
                    grade = next(op for op in compatibility["program"]["ops"] if op["kind"] == "blur")
                    grade["properties"].pop("blur_model")
                    grade["properties"].pop("blur_weights")
                    grade["properties"].pop("blur_output_sampling_model")
                    grade["properties"].pop("blur_gaussian_math", None)
                    compatibility["case"] += "-schema1-compatibility"
                    (Path(output) / (compatibility["case"] + ".json")).write_text(json.dumps(compatibility, separators=(",", ":")))
                    oracle.rows.append({"case": compatibility["case"]})
            if modern:
                for radius in ((.25, .75), (2.25, 1.75), (.0001, 3.9999)):
                    node, source, _ = graph(kind, radius)
                    save("blur-" + pattern + "-" + kind.lower() + "-fraction-" + str(radius[0]) + "-" + str(radius[1]), source)
            elif pattern == "random":
                for multiplier in (-.5, 0, .25, .75, 1.5, 2):
                    node, source, _ = graph(kind, (3, 2), multiplier)
                    save("blur-" + kind.lower() + "-multiplier-" + str(multiplier), source)
    oracle.pixels[:] = pixels
    oracle.image.pixels.foreach_set(oracle.pixels.ravel())
    for kind in labels:
        node, source, modern = graph(kind, (2, 3), constant=True)
        save("blur-" + kind.lower() + "-constant-image", source)
        oracle.scene.render.compositor_precision = "AUTO"
        node, source, _ = graph(kind, (2, 3))
        save("blur-" + kind.lower() + "-automatic-final-precision", source)
        oracle.scene.render.compositor_precision = "FULL"
    if modern:
        node, source, _ = graph("GAUSS", (2, 3))
        node.inputs["Separable"].default_value = False
        save("blur-gaussian-separable-disabled", source)
    else:
        reference = json.loads((Path(output) / (oracle.prefix + "-blur-random-gauss-2-3.json")).read_text())
        for aspect in ("X", "Y"):
            node, source, _ = graph("GAUSS", (2, 3))
            node.aspect_correction = aspect
            data = save("blur-gaussian-absolute-aspect-" + aspect.lower(), source)
            assert data["expected"] == reference["expected"], "Aspect correction changed absolute native radii"
    for kind in ("GAUSS", "MITCH"):
        node, source, _ = graph(kind, (2, 3))
        exposure = tree.nodes.new("CompositorNodeExposure")
        exposure.inputs["Exposure"].default_value = 1.25
        tree.links.new(source.outputs["Image"], exposure.inputs["Image"])
        tree.links.new(exposure.outputs[0], node.inputs["Image"])
        save("blur-" + kind.lower() + "-after-exposure", source)
    first, source, _ = graph("GAUSS", (2, 3))
    second = tree.nodes.new("CompositorNodeBlur")
    if modern:
        second.inputs["Type"].default_value = "Mitch"
        second.inputs["Size"].default_value = (3, 1)
    else:
        second.filter_type = "MITCH"
        second.size_x, second.size_y = 3, 1
    tree.links.new(first.outputs[0], second.inputs["Image"])
    sink = next(n for n in tree.nodes if n.bl_idname == ("NodeGroupOutput" if oracle.modern else "CompositorNodeComposite"))
    tree.links.new(second.outputs[0], sink.inputs[0])
    save("blur-cascade-gaussian-mitch", source)
    for feature in (("extended", "recursive", "nonseparable", "field") if modern else
                    ("extended", "recursive", "bokeh", "relative", "variable", "field")):
        node, source, _ = graph("FAST_GAUSS" if feature == "recursive" else "GAUSS" if feature == "relative" else "FLAT", (2, 3))
        if feature == "field":
            tree.links.new(oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs["Size"])
        elif modern:
            node.inputs["Extend Bounds" if feature == "extended" else "Separable"].default_value = feature == "extended"
        elif feature != "recursive":
            setattr(node, {"extended": "use_extended_bounds", "bokeh": "use_bokeh", "gamma": "use_gamma_correction",
                           "relative": "use_relative", "variable": "use_variable_size"}[feature], True)
        result = compositor_graph.extract(oracle.scene)
        assert result["status"] == "unsupported" and any(d["code"] == "unsupported-blur-mode" for d in result["diagnostics"]), (feature, result)
    # A float32 reciprocal can overflow at subnormal radii. Refuse nonfinite
    # reconstructed tables rather than serialize NaNs or assume an identity.
    tiny = float(np.nextafter(np.float32(0), np.float32(1)))
    node, source, _ = graph("GAUSS", (tiny, 2) if modern else (3, 2), multiplier=tiny)
    size_value = node.inputs["Size"].default_value[0] if modern else node.inputs["Size"].links[0].from_socket.default_value
    if size_value > 0:
        result = compositor_graph.extract(oracle.scene)
        assert result["status"] == "unsupported" and "finite supported native filter table" in result["diagnostics"][-1]["message"], result
    precision_modes = {item.identifier for item in oracle.scene.render.bl_rna.properties["compositor_precision"].enum_items}
    if oracle.device == "GPU" and "HALF" in precision_modes:
        node, source, _ = graph("GAUSS", (2, 3))
        oracle.scene.render.compositor_precision = "HALF"
        result = compositor_graph.extract(oracle.scene)
        assert result["status"] == "unsupported" and "precision" in result["diagnostics"][-1]["message"], result
        oracle.scene.render.compositor_precision = "FULL"
    node, source, _ = graph("GAUSS", (2, 3))
    if modern:
        node.inputs["Size"].keyframe_insert(data_path="default_value", frame=1)
    else:
        node.inputs["Size"].links[0].from_socket.keyframe_insert(data_path="default_value", frame=1)
    assert compositor_graph.extract(oracle.scene)["status"] == "unsupported", "Animated Blur settings were frozen"
    oracle.finish("BLENDLINK_COMPOSITOR_BLUR_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-blur-") as directory:
        main(Path(directory))
