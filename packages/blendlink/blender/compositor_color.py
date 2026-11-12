# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalize native pointwise color controls without mutating authored nodes."""
import bpy


def normalize_color_operation(node, op, read_input, device):
    op["properties"]["color_conversion_device"] = device
    for incoming in node.inputs:
        if not incoming.enabled or getattr(incoming, "is_unavailable", False):
            continue
        identifier = incoming.identifier.replace(" Lift", " Offset")
        op["inputs"][identifier] = {"name": incoming.name, "socketType": incoming.type,
                                     "value": read_input(incoming)}
    if node.bl_idname == "CompositorNodeHueSat":
        op["properties"]["legacy_hue_wrap"] = bpy.app.version < (4, 5, 0)
    if node.bl_idname == "CompositorNodePosterize":
        op["properties"]["legacy_posterize_reciprocal"] = bpy.app.version < (4, 5, 0)
    if node.bl_idname != "CompositorNodeColorCorrection":
        return

    # The renamed Offset sockets arrived with the newer negative-color gamut
    # rule. Older Lift sockets/properties retain their pre-gain fallback color.
    op["properties"]["color_correction_model"] = "modern" if node.inputs.get("Master Offset") is not None else "legacy"
    if node.inputs.get("Master Saturation") is not None:
        return

    def constant(name, socket_type, setting):
        op["inputs"][name] = {"name": name, "socketType": socket_type,
            "value": {"kind": "constant", "type": socket_type, "value": setting}}

    for region in ("Master", "Shadows", "Midtones", "Highlights"):
        for parameter in ("Saturation", "Contrast", "Gamma", "Gain", "Offset"):
            attribute = region.lower() + "_" + ("lift" if parameter == "Offset" else parameter.lower())
            constant(region + " " + parameter, "VALUE", float(getattr(node, attribute)))
    for label, attribute in (("Midtones Start", "midtones_start"), ("Midtones End", "midtones_end")):
        constant(label, "VALUE", float(getattr(node, attribute)))
    for channel in ("Red", "Green", "Blue"):
        constant("Apply On " + channel, "BOOLEAN", bool(getattr(node, channel.lower())))
