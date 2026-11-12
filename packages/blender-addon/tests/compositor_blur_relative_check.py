# SPDX-License-Identifier: GPL-3.0-or-later
"""Legacy relative Blur percentages, native rounding, extents and live resizes."""
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
    device = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_RELATIVE_DEVICE", "CPU")
    probe = NativeCompositorReference(output, device=device, name="Relative Blur capability")
    if not hasattr(probe.tree.nodes.new("CompositorNodeBlur"), "use_relative"):
        (output / "index.json").write_text("[]")
        print("BLENDLINK_COMPOSITOR_BLUR_RELATIVE_NOT_APPLICABLE " + json.dumps({"blender": bpy.app.version_string}))
        print("BLENDLINK_COMPOSITOR_BLUR_RELATIVE_CHECK_PASSED " + json.dumps({"cases": 0, "reason": "Legacy relative settings are unavailable"}))
        return
    rows = []
    filters = ("FLAT", "TENT", "QUAD", "CUBIC", "CATROM", "MITCH")

    def oracle_for(width, height, kernel=False):
        pixels = np.random.default_rng(71183 + width * 13 + height).uniform(-.4, 2, (height, width, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
        if kernel:
            pixels.fill(0)
            for row in range(height):
                pixels[row, width // 2, 0] = 2 ** row
        return NativeCompositorReference(output, pixels=pixels, device=device, name="Native relative Blur")

    def graph(oracle, kind, percent, aspect="NONE", multiplier=1, gamma=False):
        sink, source = oracle.reset()
        node = oracle.tree.nodes.new("CompositorNodeBlur")
        node.filter_type = kind
        node.use_relative = True
        node.factor_x, node.factor_y = percent
        node.aspect_correction = aspect
        node.use_gamma_correction = gamma
        oracle.tree.links.new(oracle.value(multiplier), node.inputs["Size"])
        oracle.tree.links.new(source.outputs["Image"], node.inputs["Image"])
        oracle.tree.links.new(node.outputs[0], sink.inputs[0])
        return node, source

    def add_relative(oracle, first, sink):
        second = oracle.tree.nodes.new("CompositorNodeBlur")
        second.filter_type = "MITCH"
        second.use_relative = True
        second.factor_x, second.factor_y = 25, 12.5
        second.aspect_correction = "X"
        oracle.tree.links.new(first.outputs[0], second.inputs["Image"])
        oracle.tree.links.new(second.outputs[0], sink.inputs[0])
        return second

    def save(oracle, label, source, kernel=False):
        oracle.save(label, source)
        case = oracle.rows[-1]["case"]
        path = output / (case + ".json")
        document = json.loads(path.read_text())
        assert any(op["properties"].get("blur_relative_model") == "legacy-percent-f32-v1" for op in document["program"]["ops"])
        # Gamma needs both pre/post transfer images when another spatial
        # filter follows it: pre,X,Y,post,X,Y plus the final output quad.
        passes = 7 if "resize-native" in label and "-1-cascade" in label else 6 if "cascade" in label else 4
        document.update(assertTextureCleanup=True, assertMrtState=True,
                        assertShaderCost={"maxPasses": passes, "maxFragmentBytes": 12000})
        if kernel:
            document["requireFloat32Bits"] = True
        path.write_text(json.dumps(document, separators=(",", ":")))
        rows.append({"case": case})
        return document

    for width, height in ((13, 7), (31, 9), (7, 13)):
        oracle = oracle_for(width, height)
        for kind in filters:
            for aspect in ("NONE", "X", "Y"):
                for index, percent in enumerate(((12.5, 25), (0, 40))):
                    node, source = graph(oracle, kind, percent, aspect)
                    save(oracle, f"blur-relative-{kind.lower()}-{width}-{height}-{aspect.lower()}-{index}", source)
        if (width, height) == (13, 7):
            for kind in filters:
                for multiplier in (-.5, 0, .25, .75, 1.5, 2):
                    node, source = graph(oracle, kind, (17.5, 25), multiplier=multiplier)
                    save(oracle, "blur-relative-" + kind.lower() + "-size-" + str(multiplier), source)
                boundary = np.float32(.5 / width * 100)
                for direction in (-1, 0, 1):
                    percent = float(np.nextafter(boundary, np.float32(-np.inf if direction < 0 else np.inf))) if direction else float(boundary)
                    node, source = graph(oracle, kind, (percent, 0))
                    save(oracle, "blur-relative-" + kind.lower() + "-rounding-" + str(direction), source)
        for kind in filters:
            for index, percent in enumerate(((0, 0), (0, 40), (12.5, 25))):
                node, source = graph(oracle, kind, percent, gamma=True)
                save(oracle, f"blur-relative-gamma-{kind.lower()}-{width}-{height}-{index}", source)
        for kind in ("TENT", "MITCH"):
            for consumer in ("posterize", "over-straight", "over-premultiplied", "relative-cascade", "absolute-cascade", "after-absolute-cascade", "after-exposure"):
                node, source = graph(oracle, kind, (12.5, 25))
                sink = next(node for node in oracle.tree.nodes if node.bl_idname == "CompositorNodeComposite")
                if consumer == "posterize":
                    post = oracle.tree.nodes.new("CompositorNodePosterize")
                    post.inputs["Steps"].default_value = 2
                    oracle.tree.links.new(node.outputs[0], post.inputs["Image"])
                    oracle.tree.links.new(post.outputs[0], sink.inputs[0])
                elif consumer.startswith("over-"):
                    post = oracle.tree.nodes.new("CompositorNodeAlphaOver")
                    post.use_premultiply, post.premul = consumer == "over-straight", 0
                    oracle.tree.links.new(oracle.color((.1, .2, .4, .8)), post.inputs["Image"])
                    oracle.tree.links.new(node.outputs[0], post.inputs["Image_001"])
                    oracle.tree.links.new(post.outputs[0], sink.inputs[0])
                elif consumer == "relative-cascade":
                    add_relative(oracle, node, sink)
                elif "absolute" in consumer:
                    absolute = oracle.tree.nodes.new("CompositorNodeBlur")
                    absolute.filter_type = "TENT"
                    absolute.size_x, absolute.size_y = 2, 3
                    if consumer.startswith("after-"):
                        oracle.tree.links.new(source.outputs["Image"], absolute.inputs["Image"])
                        oracle.tree.links.new(absolute.outputs[0], node.inputs["Image"])
                    else:
                        oracle.tree.links.new(node.outputs[0], absolute.inputs["Image"])
                        oracle.tree.links.new(absolute.outputs[0], sink.inputs[0])
                else:
                    exposure = oracle.tree.nodes.new("CompositorNodeExposure")
                    exposure.inputs["Exposure"].default_value = 1.25
                    oracle.tree.links.new(source.outputs["Image"], exposure.inputs["Image"])
                    oracle.tree.links.new(exposure.outputs[0], node.inputs["Image"])
                save(oracle, f"blur-relative-{kind.lower()}-{width}-{height}-{consumer}", source)
    oracle = oracle_for(257, 4, kernel=True)
    for kind in filters:
        for index, percent in enumerate(((50 * 256 / 257, 0), (2.25 / 257 * 100, 0))):
            node, source = graph(oracle, kind, percent)
            save(oracle, "blur-relative-kernel-" + kind.lower() + "-" + str(index), source, kernel=True)

    # Reuse one compiled graph while changing both the input image and viewport.
    # Include a bounded-domain failure, then recover to an earlier valid extent.
    variants = [(kind, gamma, cascade, False) for kind in ("TENT", "MITCH")
                for gamma in (False, True) for cascade in (False, True)]
    variants.append(("TENT", True, True, True))
    for kind, gamma, cascade, identity in variants:
        frames = []
        first = None
        rejected = (16, 600) if identity else (2200, 16)
        for width, height in ((13, 7), (13, 7), (31, 9), (7, 13), (4, 4), rejected, (13, 7)):
            if (width, height) == rejected:
                # Error-only frame, outside the certified native pixel domain.
                # 4.2 Metal can abort in this unbounded regime.
                frame = {"width": width, "height": height,
                         "input": np.tile(np.asarray([.25, .5, .75, 1], np.float32), width * height).tolist(),
                         "expected": [], "expectError": "resolved radii between 0 and 128",
                         "nativeOracle": False}
                frames.append(frame)
                continue
            oracle = oracle_for(width, height)
            node, source = graph(oracle, kind, (0, 0) if identity else (6, 5), gamma=gamma)
            if cascade:
                sink = next(node for node in oracle.tree.nodes if node.bl_idname == "CompositorNodeComposite")
                add_relative(oracle, node, sink)
            suffix = "-identity-cascade" if identity else "-cascade" if cascade else ""
            data = save(oracle, f"blur-relative-resize-native-{kind.lower()}-{int(gamma)}{suffix}-{width}-{height}", source)
            if first is None:
                first = data
            frame = {key: data[key] for key in ("width", "height", "input", "expected")}
            if width == 31:
                frame["pixelRatio"] = 2
            frames.append(frame)
        case = oracle.prefix + "-blur-relative-resize-" + kind.lower() + "-" + str(int(gamma)) + suffix
        first.update(case=case, resizeFrames=frames)
        (output / (case + ".json")).write_text(json.dumps(first, separators=(",", ":")))
        rows.append({"case": case})
    # Gaussian stays named unsupported: native C expf is not available to a
    # JavaScript resize callback, and replacing it with Math.exp is unverified.
    oracle = oracle_for(13, 7)
    node, source = graph(oracle, "GAUSS", (12.5, 25))
    result = compositor_graph.extract(oracle.scene)
    assert result["status"] == "unsupported" and "resize-time native C" in result["diagnostics"][-1]["message"], result
    node, source = graph(oracle, "TENT", (12.5, 25))
    node.keyframe_insert(data_path="factor_x", frame=1)
    assert compositor_graph.extract(oracle.scene)["status"] == "unsupported", "Animated relative Blur was frozen"
    (output / "index.json").write_text(json.dumps(rows, indent=2))
    print("BLENDLINK_COMPOSITOR_BLUR_RELATIVE_CHECK_PASSED " + json.dumps({"blender": bpy.app.version_string, "device": device, "cases": len(rows)}))


destination = os.environ.get("BLENDLINK_COMPOSITOR_BLUR_RELATIVE_REFERENCES")
if destination:
    output = Path(destination).resolve()
    output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-blur-relative-") as directory:
        main(Path(directory))
