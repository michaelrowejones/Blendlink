# SPDX-License-Identifier: GPL-3.0-or-later
"""Native compositor Normal constants and the legacy negative dot product."""
import math

from mathutils import Vector


def normalize_normal(node, socket, op, scene, read, fail):
    direction = [float(value) for value in node.outputs["Normal"].default_value]
    legacy = node.outputs.get("Dot") is not None
    if any(not math.isfinite(value) or abs(value) > 16 for value in direction):
        fail(socket, "Normal direction requires finite components with absolute value at most 16")
    if legacy and getattr(scene.render, "compositor_device", "CPU") == "GPU" and sum(v*v for v in direction) < 1e-30:
        fail(socket, "Legacy GPU Normal requires a proven nonzero direction")
    op["value"] = list(Vector(direction).normalized())
    op["properties"].update(normal_model="native-normal-direction-v1", normal_schema="legacy" if legacy else "modern")
    if socket.identifier == "Dot" and legacy:
        incoming = node.inputs["Normal"]
        op["inputs"]["Normal"] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
    elif socket.identifier != "Normal":
        fail(socket, "Normal has no verified output " + socket.identifier)
