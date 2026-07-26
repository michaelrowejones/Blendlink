"""Minimized Blender-process probe for receiver-local UV packing stability."""

import hashlib
import json
import pathlib
import sys

import bpy


REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "packages" / "blendlink" / "dist" / "blender"))
import bakelib  # noqa: E402


def normalized_hash(obj):
    layer = obj.data.uv_layers.active
    coordinates = [tuple(loop.uv) for loop in layer.data]
    minimum_u = min(point[0] for point in coordinates)
    minimum_v = min(point[1] for point in coordinates)
    width = max(point[0] for point in coordinates) - minimum_u
    height = max(point[1] for point in coordinates) - minimum_v
    normalized = [
        [round((point[0] - minimum_u) / width, 7),
         round((point[1] - minimum_v) / height, 7)]
        for point in coordinates
    ]
    payload = json.dumps(normalized, separators=(",", ":")).encode("utf-8")
    return {
        "sha256": hashlib.sha256(payload).hexdigest(),
        "width": width,
        "height": height,
        "loopCount": len(coordinates),
    }


arguments = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
target_name = arguments[0] if arguments else "Potted Plant - Bracken"
target_area = float(arguments[1]) if len(arguments) > 1 else None
target = bpy.data.objects.get(target_name)
if target is None or target.type != "MESH":
    raise RuntimeError(f"missing mesh target {target_name!r}")

target = bakelib.freeze_evaluated_meshes([target])[0]
bakelib.ensure_authored_uvs([target])
bakelib.stage_atlas_layers([target])
bakelib.average_unpinned([target], bakelib.ATLAS_UV)
if target_area is not None:
    source_area = bakelib.packed_uv_area(target, bakelib.ATLAS_UV)
    scale = (target_area / source_area) ** 0.5
    for loop in target.data.uv_layers.active.data:
        loop.uv *= scale
layer_name = target.data.uv_layers.active.name
source = [tuple(loop.uv) for loop in target.data.uv_layers.active.data]
results = []
for _run in range(2):
    layer = target.data.uv_layers.get(layer_name)
    target.data.uv_layers.active = layer
    for loop, coordinate in zip(layer.data, source):
        loop.uv = coordinate
    bakelib.select_only([target])
    bakelib._pack_selected_uv_islands(
        margin=20.0 / 4096.0,
        rotate=True,
        scale=False,
        shape_method="AABB",
    )
    results.append(normalized_hash(target))

print("BLENDLINK_LOCAL_PACK " + json.dumps({
    "object": target_name,
    "targetArea": target_area,
    "stableWithinProcess": results[0]["sha256"] == results[1]["sha256"],
    "runs": results,
}, sort_keys=True))
