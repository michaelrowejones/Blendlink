# SPDX-License-Identifier: GPL-3.0-or-later
"""Native alpha-aware Invert, Alpha Over and Brightness/Contrast references."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference


def main(output):
    oracle = NativeCompositorReference(output,
        device=os.environ.get("BLENDLINK_COMPOSITOR_ALPHA_DEVICE", "CPU"), name="Native Alpha Utilities")
    tree = oracle.tree
    sink, source = oracle.reset()
    tree.links.new(source.outputs["Image"], sink.inputs[0])
    oracle.save("alpha-control", source, exact_alpha=True)
    factors = (-0.5, 0, 0.25, 1, 1.5, "spatial")
    for rgb in (False, True):
        for alpha in (False, True):
            for factor in factors:
                sink, source = oracle.reset()
                node = tree.nodes.new("CompositorNodeInvert")
                if oracle.modern:
                    node.inputs["Invert Color"].default_value = rgb
                    node.inputs["Invert Alpha"].default_value = alpha
                else:
                    node.invert_rgb, node.invert_alpha = rgb, alpha
                tree.links.new(source.outputs["Image"], node.inputs["Color"])
                incoming = oracle.separate(source.outputs["Image"]).outputs["Red"] if factor == "spatial" else oracle.value(factor)
                tree.links.new(incoming, node.inputs["Fac"])
                tree.links.new(node.outputs[0], sink.inputs[0])
                oracle.save("invert-" + str(int(rgb)) + "-" + str(int(alpha)) + "-" + str(factor), source,
                            exact_alpha=not alpha and not (oracle.modern and factor == "spatial"))
    if oracle.modern:
        sink, source = oracle.reset()
        channels = oracle.separate(source.outputs["Image"])
        node = tree.nodes.new("CompositorNodeInvert")
        tree.links.new(source.outputs["Image"], node.inputs["Color"])
        tree.links.new(channels.outputs["Red"], node.inputs["Invert Color"])
        tree.links.new(channels.outputs["Alpha"], node.inputs["Invert Alpha"])
        tree.links.new(node.outputs[0], sink.inputs[0])
        oracle.save("invert-dynamic-flags", source)
    for premultiply in ((False,) if oracle.modern else (False, True)):
        for brightness, contrast in ((0, 0), (25, 0), (-20, -30), (10, 35), (0, 80)):
            sink, source = oracle.reset()
            node = tree.nodes.new("CompositorNodeBrightContrast")
            if not oracle.modern:
                node.use_premultiply = premultiply
            tree.links.new(source.outputs["Image"], node.inputs["Image"])
            node.inputs["Bright"].default_value = brightness
            node.inputs["Contrast"].default_value = contrast
            tree.links.new(node.outputs[0], sink.inputs[0])
            oracle.save("brightness-contrast-" + str(int(premultiply)) + "-" + str(brightness) + "-" + str(contrast),
                        source, exact_alpha=True)
    settings = [(straight, 0, mode) for straight in (False, True)
                for mode in ("Over", "Disjoint Over", "Conjoint Over")] if oracle.modern else [
        (straight, mix, "Over") for straight in (False, True) for mix in (0, 0.35, 1)]
    for straight, premul, mode in settings:
        for factor in factors:
            for foreground in ("constant", "spatial"):
                sink, source = oracle.reset()
                node = tree.nodes.new("CompositorNodeAlphaOver")
                if oracle.modern:
                    node.inputs["Straight Alpha"].default_value = straight
                    node.inputs["Type"].default_value = mode
                else:
                    node.use_premultiply, node.premul = straight, premul
                channels = oracle.separate(source.outputs["Image"])
                incoming = channels.outputs["Red"] if factor == "spatial" else oracle.value(factor)
                tree.links.new(incoming, node.inputs["Fac"])
                back = source.outputs["Image"] if foreground == "constant" else oracle.color((0.1, 0.2, 0.4, 0.8))
                front = oracle.color((0.7, 0.2, 0.1, 0.35)) if foreground == "constant" else source.outputs["Image"]
                tree.links.new(back, node.inputs["Background"] if oracle.modern else node.inputs["Image"])
                tree.links.new(front, node.inputs["Foreground"] if oracle.modern else node.inputs["Image_001"])
                tree.links.new(node.outputs[0], sink.inputs[0])
                oracle.save("alpha-over-" + mode.lower().replace(" ", "-") + "-" + str(int(straight)) + "-" + str(premul) + "-" + str(factor) + "-" + foreground, source)
    if oracle.modern:
        sink, source = oracle.reset()
        node = tree.nodes.new("CompositorNodeAlphaOver")
        tree.links.new(oracle.color((0.1, 0.2, 0.4, 0.8)), node.inputs["Background"])
        tree.links.new(source.outputs["Image"], node.inputs["Foreground"])
        tree.links.new(oracle.separate(source.outputs["Image"]).outputs["Red"], node.inputs["Straight Alpha"])
        node.inputs["Fac"].default_value = 0.25
        tree.links.new(node.outputs[0], sink.inputs[0])
        oracle.save("alpha-over-dynamic-straight", source)
    oracle.finish("BLENDLINK_COMPOSITOR_ALPHA_CHECK_PASSED")


destination = os.environ.get("BLENDLINK_COMPOSITOR_ALPHA_REFERENCES")
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-alpha-") as directory:
        main(Path(directory))
