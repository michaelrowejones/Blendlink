# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured fixed-index Get Vector Component, lowered without new arithmetic."""


def _source_version():
    import bpy
    return tuple(bpy.app.version[:3])


def emit_vector_component(node, output, emit_input, refuse):
    if _source_version() != (5, 3, 0):
        refuse("Get Vector Component requires the qualified Blender 5.3.0 source schema")
    if (len(node.inputs) != 2 or len(node.outputs) != 1
            or [(socket.identifier, socket.type) for socket in node.inputs] != [("Vector", "VECTOR"), ("Index", "INT")]
            or [(socket.identifier, socket.type) for socket in node.outputs] != [("Value", "VALUE")]
            or output.identifier != "Value"):
        refuse("Get Vector Component has an unverified native socket schema")
    index = emit_input(node.inputs["Index"])
    if (index.get("op") != "typed_const" or index.get("type") != "INT"
            or type(index.get("value")) is not int):
        refuse("Get Vector Component requires a fixed literal integer Index; dynamic or computed selection is not qualified")
    if index["value"] not in (0, 1, 2):
        refuse("Get Vector Component requires Index 0, 1 or 2; out-of-range selection is not qualified")
    return {"op": "separate", "channel": ("x", "y", "z")[index["value"]],
            "input": emit_input(node.inputs["Vector"], as_vector=True)}
