# SPDX-License-Identifier: GPL-3.0-or-later
"""An oversized Cubic image must not silently become hardware LinearFilter."""
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir
material = bpy.data.materials.new("Cubic Transport Guard")
material.use_nodes = True
node = material.node_tree.nodes.new("ShaderNodeTexImage")
node.image = bpy.data.images.new("Large Cubic", width=129, height=129, alpha=True)
tsl_ir.set_texture_ref_emission(True)
for interpolation in ("Cubic", "Smart"):
    node.interpolation = interpolation
    try:
        tsl_ir.emit_output(node, node.outputs["Color"])
    except tsl_ir.TslIrRefusal as error:
        assert "no proven cubic sampler" in str(error), error
    else:
        raise AssertionError(f"Large {interpolation} image silently entered linear texture transport")
node.image.scale(16, 16)
for interpolation in ("Cubic", "Smart"):
    node.interpolation = interpolation
    expression = tsl_ir.emit_output(node, node.outputs["Color"])
    assert expression["op"] == "tex_image" and expression["interpolation"] == "Cubic"
tsl_ir.set_texture_ref_emission(False)
bpy.data.images.remove(node.image)
bpy.data.materials.remove(material)
print("BLENDLINK_IMAGE_CUBIC_TRANSPORT_PASSED oversized Cubic/Smart refusal, canonical embedded cubic retained")
