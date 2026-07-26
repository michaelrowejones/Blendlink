"""Inspect DOGWALK's authored shadow-catcher proxy objects without mutation."""

from __future__ import annotations

import json
from pathlib import Path
import sys

import bpy


def _value(value):
    try:
        return list(value)
    except TypeError:
        return value


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) != 1:
        raise RuntimeError("Expected one output JSON path after --")
    output = Path(argv[0]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.frame_set(85)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects = []
    for source in sorted(
        (
            obj
            for obj in bpy.data.objects
            if obj.name.startswith("LGT-shadow_caster")
        ),
        key=lambda obj: obj.name,
    ):
        evaluated = source.evaluated_get(depsgraph)
        material_slots = []
        for slot in source.material_slots:
            material = slot.material
            if material is None:
                continue
            alpha_input = None
            if material.use_nodes:
                for node in material.node_tree.nodes:
                    if node.type == "BSDF_PRINCIPLED":
                        socket = node.inputs.get("Alpha")
                        if socket is not None:
                            alpha_input = {
                                "default": float(socket.default_value),
                                "links": [
                                    {
                                        "fromNode": link.from_node.name,
                                        "fromType": link.from_node.type,
                                        "fromSocket": link.from_socket.name,
                                    }
                                    for link in socket.links
                                ],
                            }
                        break
            material_slots.append(
                {
                    "name": material.name,
                    "surfaceRenderMethod": material.surface_render_method,
                    "useNodes": material.use_nodes,
                    "alphaInput": alpha_input,
                }
            )
        objects.append(
            {
                "name": source.name,
                "type": source.type,
                "hideRender": source.hide_render,
                "hideViewport": source.hide_viewport,
                "visibleGet": source.visible_get(),
                "collections": [collection.name for collection in source.users_collection],
                "displayType": source.display_type,
                "materialSlots": material_slots,
                "worldMatrixRows": [
                    [float(value) for value in row]
                    for row in evaluated.matrix_world
                ],
                "boundBoxLocal": [
                    [float(value) for value in corner]
                    for corner in evaluated.bound_box
                ],
                "customProperties": {
                    key: _value(source[key])
                    for key in source.keys()
                    if key != "_RNA_UI"
                },
            }
        )
    report = {
        "schemaVersion": 1,
        "classification": "research-only source shadow-caster evidence",
        "source": bpy.data.filepath,
        "frame": scene.frame_current,
        "objects": objects,
    }
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", "utf8")
    print("BLENDLINK_DOGWALK_SHADOW_CASTERS " + json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
