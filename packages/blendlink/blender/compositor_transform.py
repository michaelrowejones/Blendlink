# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded lossless integer translations with deferred image origins."""
import math


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
    if interpolation != "Nearest" or extensions != ["Clip", "Clip"]:
        fail(node.inputs["Image"], "Integer Translate currently requires Nearest interpolation and Clip extension on both axes")

    def scalar(name):
        read(node.inputs[name])
        domain = bounds(node.inputs[name])
        if domain is None or domain[0] != domain[1] or not math.isfinite(domain[0]):
            fail(node.inputs[name], "Transform " + name + " requires a proven constant scalar")
        return domain[0]

    if transform and (scalar("Angle") != 0 or scalar("Scale") != 1):
        fail(node.inputs["Image"], "Transform rotation/scale require native affine extent realization; this model supports translation only")
    delta = [scalar(name) for name in ("X", "Y")]
    if any(value != int(value) or abs(value) > 8192 for value in delta):
        fail(node.inputs["X"], "Translate requires integer pixel offsets between -8192 and 8192")
    image = read(node.inputs["Image"])
    if image.get("kind") == "convert" and image.get("fromType") != "RGBA":
        fail(node.inputs["Image"], "Translate currently requires a Color image field")
    op["kind"] = "translate"
    op["properties"].update({"image_domain_model": "deferred-integer-origin-v1", "image_translation": delta})
    op["inputs"]["Image"] = {"name": "Image", "socketType": "RGBA", "value": image}


def origin_conflict(program, single_values):
    """Refuse unequal origins rather than crop fields before native composition.

    Same-origin inputs retain their raw pixel domain through pointwise and
    neighborhood operations. Constants have no finite image window.
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
            origins[op["id"]] = None
            continue
        if op["kind"] == "render-pass":
            origins[op["id"]] = (0, 0)
            continue
        incoming = {origin(value["value"]) for value in op["inputs"].values()} - {None}
        if len(incoming) > 1:
            return op, "Inputs with different image origins require native cross-domain realization"
        inherited = next(iter(incoming)) if incoming else None
        if op["kind"] == "translate" and inherited is not None:
            delta = op["properties"]["image_translation"]
            inherited = tuple(inherited[axis] + delta[axis] for axis in (0, 1))
            if any(abs(value) > 8192 for value in inherited):
                return op, "Composed Translate offsets must remain between -8192 and 8192 pixels"
        origins[op["id"]] = inherited
    return None
