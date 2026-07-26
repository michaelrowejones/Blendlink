"""Research-only probe for repeated Blender Bevel UV evaluation."""

from __future__ import annotations

import hashlib
import json
import math
import sys

import bpy


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
name = args[0] if args else "Cube.003"
runs = int(args[1]) if len(args) > 1 else 12
preserve_all_data_layers = (
    args[2].lower() not in {"0", "false", "no", "display"}
    if len(args) > 2
    else True
)
obj = bpy.data.objects.get(name)
if obj is None or obj.type != "MESH":
    raise RuntimeError(f"missing mesh object {name!r}")

depsgraph = bpy.context.evaluated_depsgraph_get()
evaluated = obj.evaluated_get(depsgraph)
captures = []
for _run in range(runs):
    mesh = bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=preserve_all_data_layers,
        depsgraph=depsgraph,
    )
    try:
        layers = []
        flat = []
        for layer in mesh.uv_layers:
            values = []
            for loop in layer.data:
                values.extend((float(loop.uv.x), float(loop.uv.y)))
            layers.append((layer.name, values))
            flat.extend(values)
        payload = json.dumps(layers, separators=(",", ":")).encode("utf-8")
        captures.append({
            "sha256": hashlib.sha256(payload).hexdigest(),
            "values": flat,
            "layers": [layer.name for layer in mesh.uv_layers],
            "vertices": len(mesh.vertices),
            "loops": len(mesh.loops),
            "polygons": len(mesh.polygons),
        })
    finally:
        bpy.data.meshes.remove(mesh)

reference = captures[0]["values"]
comparisons = []
for capture in captures:
    deltas = [abs(a - b) for a, b in zip(reference, capture["values"])]
    changed = [delta for delta in deltas if delta != 0.0]
    comparisons.append({
        "sha256": capture["sha256"],
        "changedScalars": len(changed),
        "maxAbsDelta": max(changed, default=0.0),
        "minAbsDelta": min(changed, default=0.0),
        "nonFinite": sum(not math.isfinite(value) for value in capture["values"]),
    })

print("BLENDLINK_BEVEL_EVALUATION " + json.dumps({
    "object": name,
    "preserveAllDataLayers": preserve_all_data_layers,
    "modifiers": [modifier.type for modifier in obj.modifiers],
    "layers": captures[0]["layers"],
    "vertices": captures[0]["vertices"],
    "loops": captures[0]["loops"],
    "polygons": captures[0]["polygons"],
    "uniqueHashes": sorted({capture["sha256"] for capture in captures}),
    "comparisons": comparisons,
}, sort_keys=True))
