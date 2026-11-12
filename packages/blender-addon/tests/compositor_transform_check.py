# SPDX-License-Identifier: GPL-3.0-or-later
"""Native integer Translate/Transform domains and exact downstream composition."""
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    pixels = np.random.default_rng(981731).uniform(-.4, 2, (7, 13, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (7, 13))
    device = os.environ.get("BLENDLINK_COMPOSITOR_TRANSFORM_DEVICE", "CPU")
    rows, refusals = [], []

    def new_oracle(data):
        result = NativeCompositorReference(output, pixels=data, device=device, name="Native integer transforms")
        engines = {item.identifier for item in result.scene.render.bl_rna.properties["engine"].enum_items}
        result.scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
        eevee = getattr(result.scene, "eevee", None)
        if hasattr(eevee, "taa_render_samples"):
            eevee.taa_render_samples = 1
        return result

    oracle = new_oracle(pixels)
    tree = oracle.tree

    def translate(value, x=2, y=-1, kind="CompositorNodeTranslate"):
        node = tree.nodes.new(kind)
        if oracle.modern:
            node.inputs["Interpolation"].default_value = "Nearest"
            node.inputs["Extension X"].default_value = "Clip"
            node.inputs["Extension Y"].default_value = "Clip"
        elif kind == "CompositorNodeTranslate":
            node.interpolation = "Nearest"
        else:
            node.filter_type = "NEAREST"
        node.inputs["X"].default_value, node.inputs["Y"].default_value = x, y
        tree.links.new(value, node.inputs["Image"])
        return node

    def blur(value):
        node = tree.nodes.new("CompositorNodeBlur")
        if oracle.modern:
            node.inputs["Type"].default_value = "Tent"
            node.inputs["Size"].default_value = (2, 3)
        else:
            node.filter_type = "TENT"
            node.size_x, node.size_y = 2, 3
        tree.links.new(value, node.inputs["Image"])
        return node

    def save(label, source, bits=False):
        oracle.save(label, source)
        path = output / (oracle.rows[-1]["case"] + ".json")
        document = json.loads(path.read_text())
        document.update(nativeSceneEngine=oracle.scene.render.engine, assertTextureCleanup=True,
                        assertMrtState=True, assertShaderCost={"maxPasses": 7, "maxFragmentBytes": 16000})
        if bits:
            document["requireFloat32Bits"] = True
        path.write_text(json.dumps(document, separators=(",", ":")))
        rows.append(oracle.rows[-1])
        return document

    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    save("transform-input-control", source, bits=True)
    for kind in ("CompositorNodeTranslate", "CompositorNodeTransform"):
        for x, y in ((0, 0), (2, -1), (-3, 2), (1, 0), (0, 1), (13, 0), (-13, 7), (8192, 0), (-8192, 0)):
            sink, source = oracle.reset()
            node = translate(source.outputs["Image"], x, y, kind)
            tree.links.new(node.outputs[0], sink.inputs[0])
            save("transform-" + kind.lower() + "-" + str(x) + "-" + str(y), source, bits=True)
        sink, source = oracle.reset()
        first = translate(source.outputs["Image"], 8192, -8192, kind)
        second = translate(first.outputs[0], -8192, 8192, kind)
        tree.links.new(second.outputs[0], sink.inputs[0])
        save("transform-" + kind.lower() + "-inverse-outside-canvas", source, bits=True)
        sink, source = oracle.reset()
        node = translate(oracle.color((.25, -.5, 1.5, .35)), 3, -2, kind)
        tree.links.new(node.outputs[0], sink.inputs[0])
        if kind == "CompositorNodeTransform" and bpy.app.version < (4, 5, 0) and device == "CPU":
            result = compositor_graph.extract(oracle.scene)
            assert result["status"] == "unsupported", result
            assert any("constant-image canvases" in item["message"] for item in result["diagnostics"]), result
            refusals.append({"case": "transform-compositornodetransform-constant-color", "diagnostics": result["diagnostics"]})
        else:
            save("transform-" + kind.lower() + "-constant-color", source)
    # Qualify both forms of native single-value Color input and both samplers.
    # Neither an identity transform nor unlinked defaults establishes a finite
    # CPU image canvas. The same restriction must be read-only and artist-named.
    if bpy.app.version < (4, 5, 0) and device == "CPU":
        for linked in (False, True):
            for interpolation in ("NEAREST", "BILINEAR"):
                for offset in (0, 3):
                    sink, source = oracle.reset()
                    node = tree.nodes.new("CompositorNodeTransform")
                    node.filter_type = interpolation
                    node.inputs["X"].default_value = offset
                    node.inputs["Y"].default_value = -2 if offset else 0
                    if linked:
                        tree.links.new(oracle.color((.25, -.5, 1.5, .35)), node.inputs["Image"])
                    else:
                        node.inputs["Image"].default_value = (.25, -.5, 1.5, .35)
                    tree.links.new(node.outputs[0], sink.inputs[0])
                    before = (node.filter_type, tuple(node.inputs["Image"].default_value), node.inputs["X"].default_value,
                              node.inputs["Y"].default_value, len(tree.nodes), len(tree.links))
                    result = compositor_graph.extract(oracle.scene)
                    assert result["status"] == "unsupported", result
                    assert any("constant-image canvases" in item["message"] and item["node"] == node.name
                               for item in result["diagnostics"]), result
                    assert before == (node.filter_type, tuple(node.inputs["Image"].default_value), node.inputs["X"].default_value,
                                      node.inputs["Y"].default_value, len(tree.nodes), len(tree.links))
                    refusals.append({"case": f"constant-transform-{int(linked)}-{interpolation.lower()}-{offset}",
                                     "diagnostics": result["diagnostics"]})

    for consumer in ("exposure", "posterize", "blur", "after-blur", "flip", "inverse-after-exposure", "over-constant", "over-same-origin"):
        sink, source = oracle.reset()
        first = translate(source.outputs["Image"])
        value = first.outputs[0]
        if consumer in ("exposure", "inverse-after-exposure"):
            node = tree.nodes.new("CompositorNodeExposure")
            node.inputs["Exposure"].default_value = 1.25
            tree.links.new(value, node.inputs["Image"])
            value = node.outputs[0]
            if consumer == "inverse-after-exposure":
                value = translate(value, -2, 1).outputs[0]
        elif consumer == "posterize":
            node = tree.nodes.new("CompositorNodePosterize")
            node.inputs["Steps"].default_value = 2
            tree.links.new(value, node.inputs["Image"])
            value = node.outputs[0]
        elif consumer == "blur":
            value = blur(value).outputs[0]
        elif consumer == "after-blur":
            node = blur(source.outputs["Image"])
            tree.links.new(node.outputs[0], first.inputs["Image"])
        elif consumer == "flip":
            node = tree.nodes.new("CompositorNodeFlip")
            if node.inputs.get("Flip X"):
                node.inputs["Flip X"].default_value = True
            else:
                node.axis = "X"
            tree.links.new(value, node.inputs["Image"])
            value = node.outputs[0]
        else:
            node = tree.nodes.new("CompositorNodeAlphaOver")
            background = oracle.color((.1, .2, .4, .8)) if consumer == "over-constant" else translate(source.outputs["Image"]).outputs[0]
            tree.links.new(background, node.inputs["Background"] if oracle.modern else node.inputs["Image"])
            tree.links.new(value, node.inputs["Foreground"] if oracle.modern else node.inputs["Image_001"])
            value = node.outputs[0]
        tree.links.new(value, sink.inputs[0])
        save("transform-consumer-" + consumer, source)

    # Identical native pixels with a full-frame field provider, matching the
    # runtime's TRAA/Bloom-style image-pass contract rather than a raw texture.
    for row in list(rows):
        if any(row["case"].endswith(suffix) for suffix in ("-2--1", "-consumer-blur")):
            original = output / (row["case"] + ".json")
            document = json.loads(original.read_text())
            document.update(case=document["case"] + "-declared-field", sourceAsPointwise=True, passExtentMode="input-texture")
            (output / (document["case"] + ".json")).write_text(json.dumps(document, separators=(",", ":")))
            rows.append({"case": document["case"]})

    # A bounded slice must refuse native semantics that it has not implemented.
    for feature in ("dynamic-offset", "bicubic", "relative-or-extend", "rotate", "scale", "cross-origin", "render-border"):
        sink, source = oracle.reset()
        node = translate(source.outputs["Image"], kind="CompositorNodeTransform" if feature in ("rotate", "scale") else "CompositorNodeTranslate")
        tree.links.new(node.outputs[0], sink.inputs[0])
        if feature == "dynamic-offset":
            tree.links.new(source.outputs["Image"], node.inputs["X"])
        elif feature == "bicubic":
            if oracle.modern:
                node.inputs["Interpolation"].default_value = "Bicubic"
            else:
                node.interpolation = "Bicubic"
        elif feature == "relative-or-extend":
            if oracle.modern:
                node.inputs["Extension X"].default_value = "Extend"
            else:
                node.use_relative = True
        elif feature in ("rotate", "scale"):
            node.inputs["Angle" if feature == "rotate" else "Scale"].default_value = .25 if feature == "rotate" else 1.5
        elif feature == "render-border":
            oracle.scene.render.use_border = True
        else:
            over = tree.nodes.new("CompositorNodeExposure")
            tree.links.new(source.outputs["Image"], over.inputs["Exposure"])
            tree.links.new(node.outputs[0], over.inputs["Image"])
            tree.links.new(over.outputs[0], sink.inputs[0])
        result = compositor_graph.extract(oracle.scene)
        assert result["status"] == "unsupported", (feature, result)
        if feature == "render-border":
            assert oracle.scene.render.use_border, "Read-only transform extraction changed the render border"
            oracle.scene.render.use_border = False

    for kind, consumer, declared in (("CompositorNodeTranslate", "blur", False),
                                     ("CompositorNodeTransform", "inverse", False),
                                     ("CompositorNodeTranslate", "blur", True),
                                     ("CompositorNodeTransform", "blur", True)):
        frames = []
        first = None
        for index, (width, height) in enumerate(((13, 7), (13, 7), (31, 9), (7, 13), (19, 11), (13, 7))):
            data = np.random.default_rng(7193 + width * 31 + height).uniform(-.4, 2, (height, width, 4)).astype(np.float32)
            data[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
            if index == 1:
                data = np.roll(data, 3, axis=1)
            oracle = new_oracle(data)
            tree = oracle.tree
            sink, source = oracle.reset()
            node = translate(source.outputs["Image"], kind=kind)
            value = node.outputs[0]
            if consumer == "blur":
                value = blur(value).outputs[0]
            else:
                exposure = tree.nodes.new("CompositorNodeExposure")
                exposure.inputs["Exposure"].default_value = 1.25
                tree.links.new(value, exposure.inputs["Image"])
                value = translate(exposure.outputs[0], -2, 1, kind).outputs[0]
            tree.links.new(value, sink.inputs[0])
            document = save(f"transform-resize-native-{kind.lower()}-{consumer}-{int(declared)}-{index}", source)
            first = first or document
            frame = {key: document[key] for key in ("width", "height", "input", "expected")}
            if width == 31:
                frame.update(pixelRatio=2, logicalWidth=width / 2, logicalHeight=height / 2)
            frames.append(frame)
            if index == 4:
                frames.append({"width": width, "height": height, "logicalWidth": width + 2,
                    "input": document["input"], "expected": [], "nativeOracle": False,
                    "expectError": "matching source/render image extents"})
        case = oracle.prefix + f"-transform-resize-{kind.lower()}-{consumer}-{int(declared)}"
        first.update(case=case, resizeFrames=frames, sourceAsPointwise=declared, passExtentMode="input-texture")
        (output / (case + ".json")).write_text(json.dumps(first, separators=(",", ":")))
        rows.append({"case": case})
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    (output / "refusals.json").write_text(json.dumps(refusals, indent=2))
    assert len(refusals) == (9 if bpy.app.version < (4, 5, 0) and device == "CPU" else 0), refusals
    print("BLENDLINK_COMPOSITOR_TRANSFORM_CHECK_PASSED " + json.dumps({"blender": bpy.app.version_string,
        "device": device, "cases": len(rows), "refusals": len(refusals), "sceneEngine": oracle.scene.render.engine}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_TRANSFORM_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-transform-") as directory:
        main(Path(directory))
