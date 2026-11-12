# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalize native Set Alpha and Alpha Convert without changing source nodes."""


def normalize_alpha_conversion(node, op, read, fail):
    set_alpha = node.bl_idname == "CompositorNodeSetAlpha"
    selector = node.inputs.get("Type")
    if selector is not None:
        if any(link.is_valid and not getattr(link, "is_muted", False) for link in selector.links):
            fail(selector, "Alpha conversion requires a fixed native mode selector")
        mode = selector.default_value
    elif set_alpha:
        mode = {"APPLY": "Apply Mask", "REPLACE_ALPHA": "Replace Alpha"}.get(node.mode)
    else:
        mode = {"STRAIGHT_TO_PREMUL": "To Premultiplied", "PREMUL_TO_STRAIGHT": "To Straight"}.get(node.mapping)
    allowed = {"Apply Mask", "Replace Alpha"} if set_alpha else {"To Premultiplied", "To Straight"}
    if mode not in allowed:
        fail(selector, "Alpha conversion has no verified native mode " + str(mode))
    op["properties"].update({"alpha_conversion_model": "native-alpha-v1", "alpha_mode": mode})
    for name in (("Image", "Alpha") if set_alpha else ("Image",)):
        incoming = node.inputs[name]
        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
