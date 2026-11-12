# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only, bounded luminance-key thresholds and source schema."""
import math

import bpy


def normalize_luminance_key(node, socket, op, scene, read, bounds, fail):
    if socket.identifier not in {"Image", "Matte"}:
        fail(socket, "Luminance Key requires Image or Matte output")
    modern = node.inputs.get("Minimum") is not None
    limits = []
    for name, attribute in (("Minimum", "limit_min"), ("Maximum", "limit_max")):
        incoming = node.inputs.get(name)
        if modern:
            read(incoming)
            interval = bounds(incoming)
            if interval is None or interval[0] != interval[1]:
                fail(incoming, "Luminance Key thresholds require proven fixed scalar inputs")
            number = interval[0]
        else:
            number = float(getattr(node, attribute))
        if not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, "Luminance Key thresholds require finite values in [0,1]")
        limits.append(number)
    if abs(limits[1] - limits[0]) < 1 / 64:
        fail(socket, "Luminance Key threshold separation must be at least 1/64; collapsed/narrow ramps need source evaluation")
    device = getattr(scene.render, "compositor_device", "CPU")
    op["properties"].update({"luminance_key_model": "native-luminance-key-v1",
        "luminance_key_schema": "legacy-branch" if not modern and device == "CPU" else "linear-ramp",
        "luminance_key_limits": limits})
    incoming = node.inputs["Image"]
    op["inputs"]["Image"] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
