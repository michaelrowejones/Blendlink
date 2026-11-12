# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded native translation domains, Bilinear resampling and input priorities."""
import math

import bpy

def _f32(value):
    import struct
    return struct.unpack("f", struct.pack("f", value))[0]


def normalize_transform(node, op, scene, read, bounds, fail):
    if scene.render.use_border:
        fail(node.inputs["Image"], "Translate render-border/crop windows require native data/display-window transport")
    modern = node.inputs.get("Interpolation") is not None
    transform = node.bl_idname == "CompositorNodeTransform"
    if modern:
        for name in ("Interpolation", "Extension X", "Extension Y"):
            if node.inputs[name].is_linked:
                fail(node.inputs[name], "Transform sampling settings require fixed unlinked menus")
        interpolation = node.inputs["Interpolation"].default_value
        extensions = [node.inputs[name].default_value for name in ("Extension X", "Extension Y")]
    else:
        interpolation = {"NEAREST": "Nearest", "BILINEAR": "Bilinear", "BICUBIC": "Bicubic"}.get(node.filter_type) if transform else node.interpolation
        extensions = ["Clip", "Clip"]
        if not transform and (node.use_relative or node.wrap_axis != "NONE"):
            fail(node.inputs["Image"], "Translate relative/wrapped coordinates require a separate native image-domain model")
    if interpolation not in ("Nearest", "Bilinear") or extensions != ["Clip", "Clip"]:
        fail(node.inputs["Image"], "Translate requires Nearest or Bilinear interpolation and Clip extension on both axes")

    def scalar(name):
        read(node.inputs[name])
        domain = bounds(node.inputs[name])
        if domain is None or domain[0] != domain[1] or not math.isfinite(domain[0]):
            fail(node.inputs[name], "Transform " + name + " requires a proven constant scalar")
        return domain[0]

    if transform and (scalar("Angle") != 0 or scalar("Scale") != 1):
        fail(node.inputs["Image"], "Transform rotation/scale require native affine extent realization; this model supports translation only")
    delta = [scalar(name) for name in ("X", "Y")]
    if any(abs(value) > 8192 for value in delta):
        fail(node.inputs["X"], "Translate requires pixel offsets between -8192 and 8192")
    device = getattr(scene.render, "compositor_device", "CPU")
    backend = getattr(bpy.context.preferences.system, "gpu_backend", "UNKNOWN")
    # Existing integer Nearest exports remain portable to their already proved
    # backends. New filtered domains require an independently calibrated sampler.
    filtered = interpolation == "Bilinear" or any(value != int(value) for value in delta)
    if filtered and device == "GPU" and backend != "METAL":
        fail(node.inputs["Image"], "Filtered/fractional Translate requires a verified native GPU sampler; this backend has not been calibrated")
    model = ("legacy-" if bpy.app.version < (4, 5, 0) else "modern-") + ("cpu-v1" if device == "CPU" else "metal-v1")
    image = read(node.inputs["Image"])
    if image.get("kind") == "convert" and image.get("fromType") != "RGBA":
        fail(node.inputs["Image"], "Translate currently requires a Color image field")
    op["kind"] = "translate"
    op["properties"].update({"image_domain_model": "native-translation-v2",
        "image_translation": [_f32(number) for number in delta], "image_interpolation": interpolation,
        "image_sampling_model": model})
    op["inputs"]["Image"] = {"name": "Image", "socketType": "RGBA", "value": image}


def origin_conflict(program, single_values):
    """Track finite windows without premature cropping; qualify known consumers.

    Alpha Over chooses background, foreground, then factor, matching native
    declarations/legacy canvas selection. Other unequal-domain consumers remain
    refused until their native domain priorities and typed sampling are proved.
    """
    origins = {}

    def origin(value):
        if value.get("kind") == "constant":
            return None
        if value.get("kind") == "convert":
            return origin(value["input"])
        return origins.get(value.get("node"))

    for op in program["ops"]:
        if op["id"] in single_values:
            # Unlike Translate's explicit single-element copy, legacy Transform
            # runs Scale + Rotate + Translate through canvas-dependent CPU ops.
            # A captured 4.2 Linux graph returned black where macOS returned
            # its color. Do not choose one host's result for fresh IR.
            if (bpy.app.version < (4, 5, 0)
                    and op["kind"] == "translate"
                    and op["source"]["nodeType"] == "CompositorNodeTransform"
                    and op["properties"].get("evaluation_device") == "CPU"):
                return op, "Legacy CPU Transform constant-image canvases have platform-dependent native output; a finite image input is required"
            origins[op["id"]] = None
            continue
        if op["kind"] == "render-pass":
            origins[op["id"]] = (0, 0)
            continue
        incoming = {origin(value["value"]) for value in op["inputs"].values()} - {None}
        if len(incoming) > 1 and op["kind"] != "alpha-over":
            return op, "Inputs with different image origins require a verified native cross-domain input priority"
        if incoming and op["kind"] == "alpha-over":
            if len(incoming) > 1 and op["properties"].get("evaluation_device") == "GPU" and op["properties"].get("native_gpu_backend") != "METAL":
                return op, "Cross-domain Alpha Over requires a verified native GPU sampler; this backend has not been calibrated"
            priority = ("Background", "Foreground", "Fac")
            selected = next((name for name in priority if name in op["inputs"] and origin(op["inputs"][name]["value"]) is not None), None)
            if selected is None:
                return op, "Cross-domain Alpha Over has no finite image domain"
            if any(value["value"]["type"] != "RGBA" and origin(value["value"]) is not None
                   and origin(value["value"]) != origin(op["inputs"][selected]["value"]) for value in op["inputs"].values()):
                return op, "Cross-domain Alpha Over currently requires Color image inputs"
            op["properties"]["image_domain_input"] = selected
            inherited = origin(op["inputs"][selected]["value"])
        else:
            inherited = next(iter(incoming)) if incoming else None
        if op["kind"] == "translate" and inherited is not None:
            delta = op["properties"]["image_translation"]
            if op["properties"].get("image_sampling_model") == "legacy-cpu-v1" and op["properties"].get("image_interpolation") == "Bilinear":
                if inherited != (0, 0) or op["source"]["nodeType"] == "CompositorNodeTransform" and any(delta):
                    return op, "Legacy CPU Bilinear sampling of shifted/intermediate Transform canvases requires native area-of-interest/data-window transport"
            legacy_cpu = op["properties"].get("image_sampling_model") == "legacy-cpu-v1"
            inherited = tuple(_f32(inherited[axis] + (math.trunc(delta[axis]) if legacy_cpu else delta[axis])) for axis in (0, 1))
            if any(abs(value) > 8192 for value in inherited):
                return op, "Composed Translate offsets must remain between -8192 and 8192 pixels"
        origins[op["id"]] = inherited
    return None
