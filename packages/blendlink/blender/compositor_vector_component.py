# SPDX-License-Identifier: GPL-3.0-or-later
"""Fixed native Get Vector Component, preserving typed selector provenance."""
import bpy


def _source_version():
    return tuple(bpy.app.version[:3])


def normalize_vector_component(node, socket, op, read, ops, fail):
    if _source_version() != (5, 3, 0):
        fail(socket, "Get Vector Component requires the measured Blender 5.3.0 compositor schema")
    if ([(item.identifier, item.type) for item in node.inputs] != [("Vector", "VECTOR"), ("Index", "INT")]
            or [(item.identifier, item.type) for item in node.outputs] != [("Value", "VALUE")]
            or socket.identifier != "Value"):
        fail(socket, "Get Vector Component has an unverified compositor socket schema")
    incoming = node.inputs["Index"]
    selector = read(incoming)
    index = None
    if selector.get("type") == "INT":
        if selector.get("kind") == "constant":
            index = selector.get("value")
        elif selector.get("kind") == "ref":
            source = next((item for item in ops if item["id"] == selector.get("node")), None)
            if source and source["kind"] == "utility-constant" and source["type"] == "INT":
                index = source.get("value")
    if type(index) is not int or index not in (0, 1, 2):
        fail(incoming, "Get Vector Component requires a fixed typed integer Index 0, 1 or 2; converted, computed, live and out-of-range selectors are unqualified")
    op["properties"].update(vector_component_model="native-fixed-vector-component-v1",
        vector_component_source_version=list(_source_version()))
    op["inputs"]["Index"] = {"name": incoming.name, "socketType": incoming.type, "value": selector}
    incoming = node.inputs["Vector"]
    op["inputs"]["Vector"] = {"name": incoming.name, "socketType": incoming.type, "value": read(incoming)}
