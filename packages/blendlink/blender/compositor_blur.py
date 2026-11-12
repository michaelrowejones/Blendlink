# SPDX-License-Identifier: GPL-3.0-or-later
"""Native static separable Blur normalization and float32 filter tables."""
import math

import numpy as np


FILTERS = {"FLAT": "Flat", "TENT": "Tent", "QUAD": "Quadratic", "CUBIC": "Cubic",
           "GAUSS": "Gaussian", "CATROM": "Catrom", "MITCH": "Mitch"}


def filter_value(kind, coordinate):
    # Blender 4.2 RE_filter_value / 5.2+ math::filter_kernel_value. The scale and
    # polynomial evaluation order are native float32, including negative lobes.
    f = np.float32
    x = f(abs(coordinate))
    if kind == "Flat":
        return f(1 if x <= 1 else 0)
    if kind == "Tent":
        return f(1) - x if x <= 1 else f(0)
    scale = f(1.6)
    if kind == "Gaussian":
        two_scale2 = f(2) * scale * scale
        x *= f(3) * scale
        return (f(1) / np.sqrt(f(math.pi) * two_scale2)) * np.exp(-x * x / two_scale2)
    x *= scale
    x2 = x * x
    if kind == "Quadratic":
        return f(.75) - x2 if x < .5 else f(.5) * (x - f(1.5)) * (x - f(1.5)) if x < 1.5 else f(0)
    if kind == "Cubic":
        return f(.5) * x * x2 - x2 + f(2) / f(3) if x < 1 else \
            (f(2) - x) * (f(2) - x) * (f(2) - x) / f(6) if x < 2 else f(0)
    if kind == "Catrom":
        return f(1.5) * x2 * x - f(2.5) * x2 + f(1) if x < 1 else \
            -f(.5) * x2 * x + f(2.5) * x2 - f(4) * x + f(2) if x < 2 else f(0)
    if kind == "Mitch":
        b = c = f(1) / f(3)
        p0 = (f(6) - f(2) * b) / f(6)
        p2 = (-f(18) + f(12) * b + f(6) * c) / f(6)
        p3 = (f(12) - f(9) * b - f(6) * c) / f(6)
        q0 = (f(8) * b + f(24) * c) / f(6)
        q1 = (-f(12) * b - f(48) * c) / f(6)
        q2 = (f(6) * b + f(30) * c) / f(6)
        q3 = (-b - f(6) * c) / f(6)
        return p0 + x2 * (p2 + x * p3) if x < 1 else q0 + x * (q1 + x * (q2 + x * q3)) if x < 2 else f(0)
    raise ValueError("Blur has no verified separable filter " + str(kind))


def filter_weights(kind, radius, legacy_cpu):
    f = np.float32
    count = math.ceil(radius)
    scale = f(1) / f(radius) if radius > 0 else f(0)
    if legacy_cpu:
        raw = [filter_value(kind, f(i) * scale) for i in range(-count, count + 1)]
        total = f(0)
        for item in raw:
            total += item
        inverse = f(1) / total
        return [float(item * inverse) for item in raw[count:]]
    raw = [filter_value(kind, f(i) * scale) for i in range(count + 1)]
    total = raw[0]
    for item in raw[1:]:
        total += item * f(2)
    return [float(item / total) for item in raw]


def normalize_blur(node, op, scene, read, bounds, fail):
    legacy = node.inputs.get("Type") is None
    device = getattr(scene.render, "compositor_device", "CPU")
    precision = getattr(scene.render, "compositor_precision", "AUTO")
    if device == "GPU" and precision not in {"FULL", "AUTO"}:
        fail(None, "Blur currently requires Full or final-render Automatic compositor precision")
    if legacy:
        if node.use_relative:
            fail(node.inputs["Size"], "Relative Blur requires an image-extent and resize-aware native radius model")
        if node.use_variable_size:
            fail(node.inputs["Size"], "Variable-size legacy Blur requires its native per-pixel filter model")
        if node.use_gamma_correction:
            fail(node.inputs["Image"], "Legacy Blur gamma correction requires its native premultiplied transfer model")
        if node.use_bokeh:
            fail(node.inputs["Image"], "Legacy Blur Bokeh requires its native two-dimensional filter model")
        mode = FILTERS.get(node.filter_type)
        extended = node.use_extended_bounds
        read(node.inputs["Size"])  # Enforce static/verified dependencies before folding a multiplier.
        domain = bounds(node.inputs["Size"])
        if domain is None or domain[0] != domain[1] or not math.isfinite(domain[0]):
            fail(node.inputs["Size"], "Legacy Blur Size requires a proven constant multiplier")
        multiplier = max(domain[0], 0)
        if device == "GPU":
            multiplier = min(multiplier, 1)
        radii = [float(np.float32(multiplier) * np.float32(radius)) for radius in (node.size_x, node.size_y)]
    else:
        for name in ("Type", "Extend Bounds", "Separable", "Size"):
            if node.inputs[name].is_linked:
                fail(node.inputs[name], "Blur " + name + " requires an unlinked constant setting; linked/per-pixel radii need a verified field model")
        mode = node.inputs["Type"].default_value
        extended = node.inputs["Extend Bounds"].default_value
        if not node.inputs["Separable"].default_value and mode != "Gaussian":
            fail(node.inputs["Separable"], "Nonseparable Blur requires its native two-dimensional filter model")
        radii = [max(float(value), 0) for value in node.inputs["Size"].default_value]
    if extended:
        fail(node.inputs["Image"], "Blur Extend Bounds requires transport of the expanded image domain")
    if mode not in FILTERS.values():
        fail(node.inputs.get("Type"), "Blur supports static separable Flat, Tent, Quadratic, Cubic, Gaussian, Catrom and Mitch; recursive Fast Gaussian needs its own model")
    if len(radii) != 2 or any(not math.isfinite(radius) or radius > 128 for radius in radii):
        fail(node.inputs["Size"], "Blur requires constant radii between 0 and 128 pixels per axis")
    legacy_cpu = legacy and device == "CPU"
    with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
        weights = [filter_weights(mode, radius, legacy_cpu) for radius in radii]
    if any(not math.isfinite(value) for table in weights for value in table):
        fail(node.inputs["Size"], "Blur radius has no finite supported native filter table")
    op["properties"].update({"blur_model": "legacy-cpu-f32-v1" if legacy_cpu else "symmetric-separable-f32-v1",
                             "blur_weights": weights})
    image = node.inputs["Image"]
    op["inputs"]["Image"] = {"name": image.name, "socketType": image.type, "value": read(image)}
    for name, kind, value in (("Size", "VECTOR", radii), ("Type", "MENU", mode),
                               ("Extend Bounds", "BOOLEAN", False), ("Separable", "BOOLEAN", True)):
        op["inputs"][name] = {"name": name, "socketType": kind,
                              "value": {"kind": "constant", "type": kind, "value": value}}
