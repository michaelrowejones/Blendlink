# SPDX-License-Identifier: GPL-3.0-or-later
"""Normalize fixed native image enhancement kernels across compositor schemas."""

FILTERS = {"SOFTEN": "Soften", "SHARPEN": "Box Sharpen", "SHARPEN_DIAMOND": "Diamond Sharpen",
           "LAPLACE": "Laplace", "SOBEL": "Sobel", "PREWITT": "Prewitt", "KIRSCH": "Kirsch", "SHADOW": "Shadow"}


def normalize_filter(node, op, scene, read, fail):
    device = getattr(scene.render, "compositor_device", "CPU")
    if device == "GPU" and getattr(scene.render, "compositor_precision", "AUTO") not in {"FULL", "AUTO"}:
        fail(node.inputs["Image"], "Filter requires Full or final-render Automatic compositor precision")
    selector = node.inputs.get("Type")
    if selector is None:
        mode, schema = FILTERS.get(node.filter_type), "legacy"
    else:
        if selector.is_linked:
            fail(selector, "Filter requires an unlinked fixed kernel type")
        mode, schema = selector.default_value, "modern"
    if mode not in FILTERS.values():
        fail(selector, "Filter has no verified native kernel " + str(mode))
    op["properties"].update(spatial_model="native-filter-v1", filter_type=mode, filter_schema=schema)
    for name in ("Image", "Fac"):
        incoming = next(item for item in node.inputs if item.identifier == name)
        op["inputs"][name] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
