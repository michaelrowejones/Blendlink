# SPDX-License-Identifier: MIT
"""Mark deliberately detached Splash outline colors as website-unlit."""
from __future__ import annotations

import bpy


MATERIALS = ("Outline", "Outline.001", "Outline.004")
MARKER_PROPERTY = "blendlink_material_source_version"
RESPONSE_PROPERTY = "blendlink_surface_response"


for material_name in MATERIALS:
    material = bpy.data.materials.get(material_name)
    if material is None or material.node_tree is None:
        raise RuntimeError(f"Missing expected Splash material {material_name!r}")
    markers = [
        node for node in material.node_tree.nodes
        if node.get(MARKER_PROPERTY) == 1
    ]
    if len(markers) != 1:
        raise RuntimeError(
            f"{material_name!r} has {len(markers)} Blendlink markers; expected one"
        )
    markers[0][RESPONSE_PROPERTY] = "UNLIT"

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)
print(
    "BLENDLINK_SPLASH_OUTLINE_RESPONSE_APPLIED "
    + ",".join(MATERIALS)
)
