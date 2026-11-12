# SPDX-License-Identifier: GPL-3.0-or-later
"""Native static separable Blur normalization and float32 filter tables."""
import ctypes
import ctypes.util
from functools import lru_cache
import math
import sys

import numpy as np


FILTERS = {"FLAT": "Flat", "TENT": "Tent", "QUAD": "Quadratic", "CUBIC": "Cubic",
           "GAUSS": "Gaussian", "CATROM": "Catrom", "MITCH": "Mitch"}


@lru_cache(maxsize=1)
def gaussian_float_math():
    """Use the process's scalar C functions, as RE_filter_value does.

    NumPy's float32 exp can use a different SIMD approximation on x86. A
    coefficient ULP is visible when gamma's filtered alpha is close to zero.
    """
    def libraries():
        yield None
        if sys.platform == "win32":
            yield "ucrtbase.dll"
        else:
            library = ctypes.util.find_library("m")
            if library:
                yield library
    for name in libraries():
        try:
            library = ctypes.CDLL(name, **({"winmode": 0x800} if sys.platform == "win32" and name else {}))
            functions = [getattr(library, symbol) for symbol in ("expf", "sqrtf")]
            for function in functions:
                function.argtypes = (ctypes.c_float,)
                function.restype = ctypes.c_float
            return tuple(functions)
        except (OSError, AttributeError):
            continue
    raise ValueError("Gaussian Blur requires the native scalar C expf and sqrtf functions")


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
        expf, sqrtf = gaussian_float_math()
        two_scale2 = f(2) * scale * scale
        x *= f(3) * scale
        return (f(1) / f(sqrtf(float(f(math.pi) * two_scale2)))) * f(expf(float(-x * x / two_scale2)))
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
        if node.use_variable_size:
            fail(node.inputs["Size"], "Variable-size legacy Blur requires its native per-pixel filter model")
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
        if node.use_relative:
            if mode == "Gaussian":
                fail(node.inputs["Image"], "Relative Gaussian Blur requires a verified resize-time native C filter table model")
            if node.aspect_correction not in {"NONE", "X", "Y"}:
                fail(node.inputs["Image"], "Relative Blur requires a verified native aspect correction mode")
            percent = [float(np.float32(value)) for value in (node.factor_x, node.factor_y)]
            if any(not math.isfinite(value) or value < 0 or value > 100 for value in percent):
                fail(node.inputs["Size"], "Relative Blur requires finite percentages between 0 and 100")
            op["properties"].update({"blur_relative_model": "legacy-percent-f32-v1",
                                     "blur_relative_percent": percent,
                                     "blur_relative_aspect": node.aspect_correction,
                                     "blur_relative_multiplier": float(np.float32(multiplier))})
            # Radius is resolved from the live input image extent, not frozen
            # from the Blender render settings at export time.
            radii = [0.0, 0.0]
        else:
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
    try:
        with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
            weights = [filter_weights(mode, radius, legacy_cpu) for radius in radii]
    except ValueError as error:
        fail(node.inputs["Size"], str(error))
    if any(not math.isfinite(value) for table in weights for value in table):
        fail(node.inputs["Size"], "Blur radius has no finite supported native filter table")
    op["properties"].update({"blur_model": "legacy-cpu-f32-v1" if legacy_cpu else "symmetric-separable-f32-v1",
                             "blur_weights": weights,
                             "blur_output_sampling_model": "native-texel-v1"})
    if mode == "Gaussian":
        op["properties"]["blur_gaussian_math"] = "native-c-f32-v1"
    if legacy and node.use_gamma_correction:
        op["properties"]["blur_gamma_model"] = "legacy-cpu-square-v1" if legacy_cpu else "legacy-gpu-square-v1"
    image = node.inputs["Image"]
    op["inputs"]["Image"] = {"name": image.name, "socketType": image.type, "value": read(image)}
    for name, kind, value in (("Size", "VECTOR", radii), ("Type", "MENU", mode),
                               ("Extend Bounds", "BOOLEAN", False), ("Separable", "BOOLEAN", True)):
        op["inputs"][name] = {"name": name, "socketType": kind,
                              "value": {"kind": "constant", "type": kind, "value": value}}
