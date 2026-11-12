# SPDX-License-Identifier: GPL-3.0-or-later
"""Native hue modes retain hue direction, alpha and renderer table semantics."""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


def refusal(work, message):
    try:
        work()
    except tsl_ir.TslIrRefusal as error:
        expect(message in str(error), f"Expected {message!r}, got {error}")
    else:
        raise AssertionError(f"Expected refusal naming {message!r}")


material = bpy.data.materials.new("Native ColorRamp Translation")
material.use_nodes = True
tree = material.node_tree
tree.nodes.clear()
node = tree.nodes.new("ShaderNodeValToRGB")
ramp = node.color_ramp
ramp.elements[0].color = (0.92, 0.12, 0.37, 0.18)
ramp.elements[0].position = 0.07
ramp.elements[1].color = (0.22, 0.31, 0.95, 0.41)
ramp.elements[1].position = 0.91
middle = ramp.elements.new(0.43)
middle.color = (0.14, 0.81, 0.38, 0.83)
for mode in ("HSV", "HSL"):
    ramp.color_mode = mode
    for hue in ("NEAR", "FAR", "CW", "CCW"):
        ramp.hue_interpolation = hue
        native_samples = []
        for interpolation in ("LINEAR", "CONSTANT", "EASE", "B_SPLINE", "CARDINAL"):
            ramp.interpolation = interpolation
            native_samples.append(tuple(ramp.evaluate(0.37)))
            for output, channel in (("Color", "rgb"), ("Alpha", "alpha")):
                tsl_ir.drain_approximations()
                expression = tsl_ir.emit_output(node, node.outputs[output])
                expect(expression["op"] == "ramp_lut", f"{mode} lost its native evaluator")
                expect(expression["sourceColorMode"] == mode, "Native hue color space was lost")
                expect(expression["sourceHueInterpolation"] == hue, "Native hue direction was lost")
                expect(expression["sourceInterpolation"] == interpolation, "Source interpolation audit was lost")
                expect(expression["channel"] == channel, "Alpha output was lost")
                expect(len(expression["values"]) == 4 * expression["samples"], "Malformed native RGBA table")
                expect(expression["samples"] == 257, "Native Cycles table size was lost")
                expect(expression["sampling"]["method"] == "native-cycles-257-table", "Native sampling provenance was lost")
                expect(expression["lookup"] == ("FLOOR" if interpolation == "CONSTANT" else "LINEAR"),
                       "Native shader lookup interpolation was lost")
                expect(not tsl_ir.drain_approximations(), "Exact native table port was mislabeled as an additional approximation")
        # Blender's hue-space evaluator ignores this UI property; a direct
        # RGB CONSTANT branch would silently give entirely different colors.
        expect(all(sample == native_samples[0] for sample in native_samples),
               "Native hue interpolation semantics changed; revisit mode proofs")

ramp.color_mode = "RGB"
for interpolation in ("LINEAR", "CONSTANT"):
    ramp.interpolation = interpolation
    tsl_ir.drain_approximations()
    expression = tsl_ir.emit_output(node, node.outputs["Color"])
    expect(expression["op"] == "color_ramp", "Analytic RGB ramp was replaced with an approximation")
    expect(not tsl_ir.drain_approximations(), "Analytic RGB ramp was labeled approximate")

# Native Cycles uses the same sampled table even for very sharp stop
# intervals. Preserve that authored renderer behavior rather than inserting
# extra detail that the original shader itself never evaluated.
ramp.elements.remove(middle)
ramp.color_mode = "HSV"
ramp.interpolation = "LINEAR"
ramp.hue_interpolation = "FAR"
ramp.elements[0].position = 0.5
ramp.elements[1].position = 0.50001
expression = tsl_ir.emit_output(node, node.outputs["Color"])
for index in (0, 127, 128, 129, 256):
    expect(expression["values"][index * 4:index * 4 + 4] == list(ramp.evaluate(index / 256)),
           "Native sharp-stop table was silently resampled")

bpy.data.materials.remove(material)
print("BLENDLINK_COLOR_RAMP_TRANSLATION_PASSED native hue directions/modes, alpha and exact renderer table provenance")
