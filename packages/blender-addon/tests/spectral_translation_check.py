# SPDX-License-Identifier: GPL-3.0-or-later
"""Spectral extraction preserves native models and authored node trees."""
import json
import os
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tsl_ir

material = bpy.data.materials.new("Native spectral extraction")
material.use_nodes = True
tree = material.node_tree
principled = next(node for node in tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
blackbody = tree.nodes.new("ShaderNodeBlackbody")
wavelength = tree.nodes.new("ShaderNodeWavelength")
coord = tree.nodes.new("ShaderNodeTexCoord")
separate = tree.nodes.new("ShaderNodeSeparateXYZ")
tree.links.new(coord.outputs["UV"], separate.inputs[0])
original_engine = bpy.context.scene.render.engine
engines = [item.identifier for item in bpy.context.scene.render.bl_rna.properties["engine"].enum_items]
eevee = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
try:
    for engine in ("CYCLES", eevee):
        bpy.context.scene.render.engine = engine
        for node in (blackbody, wavelength):
            tree.links.new(node.outputs[0], principled.inputs["Base Color"])
            before = (len(tree.nodes), len(tree.links), len(bpy.data.node_groups))
            doc = tsl_ir.emit_channel(principled.inputs["Base Color"])
            expression = doc["output"]
            assert expression["op"] == "spectral", doc
            assert len(expression["matrix"]) == 9
            assert (len(tree.nodes), len(tree.links), len(bpy.data.node_groups)) == before
            expected = "cycles" if engine == "CYCLES" or (node == blackbody and
                        bpy.app.version >= (5, 0, 0)) else "eevee-table"
            assert expression["model"] == expected, expression
            json.dumps(doc, allow_nan=False)
            if node == wavelength:
                assert expression["samples"] == (81 if engine == "CYCLES" else 257)
        link = tree.links.new(separate.outputs[0], blackbody.inputs[0])
        tree.links.new(blackbody.outputs[0], principled.inputs["Base Color"])
        dynamic = tsl_ir.emit_channel(principled.inputs["Base Color"])["output"]
        assert dynamic["model"] == ("cycles" if engine == "CYCLES" else "eevee-table")
        tree.links.remove(link)
    blackbody.inputs[0].keyframe_insert(data_path="default_value", frame=1)
    try:
        tsl_ir.emit_channel(principled.inputs["Base Color"])
        raise AssertionError("Animated spectral input froze into a static program")
    except tsl_ir.TslIrRefusal as error:
        assert "animat" in str(error).lower()
    tree.animation_data_clear()
    previous = os.environ.get("OCIO")
    os.environ["OCIO"] = str(Path(__file__).with_name("missing-spectral-config.ocio"))
    try:
        try:
            tsl_ir.emit_channel(principled.inputs["Base Color"])
            raise AssertionError("Missing working-space config was silently guessed")
        except tsl_ir.TslIrRefusal as error:
            assert "working-space" in str(error)
    finally:
        if previous is None:
            os.environ.pop("OCIO", None)
        else:
            os.environ["OCIO"] = previous
finally:
    bpy.context.scene.render.engine = original_engine
print("BLENDLINK_SPECTRAL_TRANSLATION_PASSED live inputs, native models, ownership and named refusals")
