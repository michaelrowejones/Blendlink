# SPDX-License-Identifier: GPL-3.0-or-later
"""Native White Point constant/variable Bradford paths and authored-domain guards."""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import PyOpenColorIO as OCIO

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get("BLENDLINK_COMPOSITOR_WHITEPOINT_DEVICE", "CPU"), name="Native White Point")
    if os.environ.get("OCIO"):
        # Custom working-space oracle: the image and EXR must carry the scene's
        # linear space so there is no implicit image conversion outside the graph.
        config = OCIO.Config.CreateFromFile(os.environ["OCIO"])
        working_space = config.getColorSpace("scene_linear").getName()
        oracle.image.colorspace_settings.name = working_space
        # Changing a generated image's colorspace invalidates its pixel buffer.
        oracle.image.pixels.foreach_set(oracle.pixels.ravel())
        oracle.scene.render.image_settings.linear_colorspace_settings.name = working_space
    tree = oracle.tree
    parameters = ("Input Temperature", "Input Tint", "Output Temperature", "Output Tint")
    sink, source = oracle.reset()
    node = tree.nodes.new("CompositorNodeColorBalance")
    if node.inputs.get("Type") is None:
        (Path(output) / "not-applicable.json").write_text(json.dumps({"blender": bpy.app.version_string,
            "reason": "This native Color Balance node has no White Point mode"}))
        print("BLENDLINK_COMPOSITOR_WHITEPOINT_CHECK_PASSED " + json.dumps({"blender": bpy.app.version_string,
            "status": "not-applicable", "cases": 0, "reason": "No native White Point mode"}))
        return

    def math(operation, a, b):
        node = tree.nodes.new("ShaderNodeMath" if oracle.modern else "CompositorNodeMath")
        node.operation = operation
        for socket, value in zip(node.inputs, (a, b)):
            tree.links.new(oracle.value(value) if isinstance(value, (float, int)) else value, socket)
        return node.outputs[0]

    def graph(values, factor, *, linked=False, constant=False, spatial=None):
        sink, source = oracle.reset()
        node = tree.nodes.new("CompositorNodeColorBalance")
        node.inputs["Type"].default_value = "White Point"
        tree.links.new(oracle.color((0.25, 0.5, 0.75, -0.25)) if constant else source.outputs["Image"], node.inputs["Image"])
        for name, value in zip(parameters, values):
            if linked:
                tree.links.new(oracle.value(value), node.inputs[name])
            else:
                node.inputs[name].default_value = value
        red = None
        if spatial is not None or factor == "spatial":
            red = oracle.separate(source.outputs["Image"]).outputs["Red"]
        if spatial is not None:
            name = parameters[spatial]
            temperature = name.endswith("Temperature")
            variable = math("ADD", math("MULTIPLY", red, 4500 if temperature else 90), 6500 if temperature else 0)
            variable = math("MINIMUM", math("MAXIMUM", variable, 1800 if temperature else -150),
                            100000 if temperature else 150)
            tree.links.new(variable, node.inputs[name])
        tree.links.new(red if factor == "spatial" else oracle.value(factor), node.inputs["Fac"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source

    def save(label, node, source):
        unused = tree.nodes.new("CompositorNodeImage")
        unused.image = oracle.image
        settings = [socket.default_value for socket in node.inputs if socket.type in {"VALUE", "MENU"}]
        groups, users = len(bpy.data.node_groups), oracle.image.users
        oracle.save(label, source, exact_alpha=True)
        assert groups == len(bpy.data.node_groups), "White Point extraction leaked an owned node group"
        assert users + 1 == oracle.image.users, "Only the reference Image node may add an image user"
        assert settings == [socket.default_value for socket in node.inputs if socket.type in {"VALUE", "MENU"}]

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    oracle.save("white-point-control", source, exact_alpha=True)
    controls = ((6500, 10, 6500, 10), (6500, 0, 2700, -20), (2700, -20, 6500, 10),
                (1800, -150, 100000, 150), (100000, 150, 1800, -150),
                (10000, -75, 4000, 85), (100000, -150, 1800, 150), (1800, 150, 100000, -150))
    for index, values in enumerate(controls):
        for linked in (False, True):
            for factor in (-0.5, 0, 0.35, 1, 1.5, "spatial"):
                node, source = graph(values, factor, linked=linked)
                save("white-point-" + str(index) + "-" + str(int(linked)) + "-" + str(factor), node, source)
            node, source = graph(values, 0.35, linked=linked, constant=True)
            save("white-point-" + str(index) + "-" + str(int(linked)) + "-constant", node, source)
    for spatial in range(4):
        for constant in (False, True):
            node, source = graph((6500, 10, 4000, -20), "spatial", linked=True, constant=constant, spatial=spatial)
            save("white-point-spatial-" + str(spatial) + "-" + str(int(constant)), node, source)
    for name, value in (("Input Temperature", 0), ("Output Temperature", 1666.6666),
                        ("Input Tint", -151), ("Output Tint", 151)):
        node, source = graph((6500, 10, 4000, -20), 1)
        tree.links.new(oracle.value(value), node.inputs[name])
        result = compositor_graph.extract(oracle.scene)
        assert result["status"] == "unsupported", result
        assert any(row["code"] == "white-point-domain" for row in result["diagnostics"]), result
    node, source = graph((6500, 10, 4000, -20), 1)
    tree.links.new(oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs["Input Temperature"])
    result = compositor_graph.extract(oracle.scene)
    assert result["status"] == "unsupported", result
    # Even individually bounded UI ranges can cross a Bradford source pole.
    # Keep fixed negative-LMS settings above, but refuse this ambiguous pair.
    node, source = graph((6500, 10, 4000, -20), 1, spatial=0)
    red = oracle.separate(source.outputs["Image"]).outputs["Red"]
    tint = math("MINIMUM", math("MAXIMUM", math("MULTIPLY", red, 150), -150), 150)
    tree.links.new(tint, node.inputs["Input Tint"])
    result = compositor_graph.extract(oracle.scene)
    assert result["status"] == "unsupported", result
    assert any("native adaptation pole" in row["message"] for row in result["diagnostics"]), result
    # A few finite sample probes cannot certify an arbitrary OCIO transform as
    # linear. The extractor must inspect optimized operations and reject sRGB.
    node, source = graph((6500, 10, 4000, -20), 1)
    original_config = os.environ.get("OCIO")
    config_path = original_config or str(Path(bpy.utils.resource_path("LOCAL"))
        / "datafiles/colormanagement/config.ocio")
    config = OCIO.Config.CreateFromFile(config_path)
    config.setRole("scene_linear", "sRGB")
    config.setSearchPath(":".join(str(Path(config_path).parent / entry)
        for entry in config.getSearchPath().split(":")))
    with tempfile.TemporaryDirectory(prefix="blendlink-whitepoint-nonlinear-") as temporary:
        try:
            custom = Path(temporary) / "config.ocio"
            custom.write_text(config.serialize())
            os.environ["OCIO"] = str(custom)
            result = compositor_graph.extract(oracle.scene)
            assert result["status"] == "unsupported", result
            assert any("matrix-only" in row["message"] for row in result["diagnostics"]), result
        finally:
            if original_config is None:
                os.environ.pop("OCIO", None)
            else:
                os.environ["OCIO"] = original_config
    oracle.finish("BLENDLINK_COMPOSITOR_WHITEPOINT_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_WHITEPOINT_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-white-point-") as directory:
        main(Path(directory))
