"""Fresh-process ordering probe for Blender 5.2 and Needle's UV pipeline.

This is research-only evidence. Run Blender once per process; the script prints
one SHA-256 over object-name-addressed UV coordinates.
"""

from __future__ import annotations

import hashlib
import json
import sys

import bpy


args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
mode = args[0] if args else "needle"


def add_plane(name: str, width: float, height: float):
    mesh = bpy.data.meshes.new(name + ".Mesh")
    mesh.from_pydata(
        [
            (-width / 2, -height / 2, 0),
            (width / 2, -height / 2, 0),
            (width / 2, height / 2, 0),
            (-width / 2, height / 2, 0),
        ],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()
    uv = mesh.uv_layers.new(name="UVMap")
    for loop, coordinate in zip(
        uv.data,
        ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
    ):
        loop.uv = coordinate
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True)
    return obj


# Repeated dimensions deliberately create stable-sort and qsort ties. The
# semantic identity is the object name, not creation or iteration position.
objects = [
    add_plane(f"Receiver{i:02}", 1.0 + (i % 3), 1.0 + ((i // 3) % 2))
    for i in range(24)
]
bpy.context.view_layer.objects.active = objects[-1]

bpy.ops.object.mode_set(mode="EDIT")
bpy.context.tool_settings.use_uv_select_sync = True
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.select_all(action="SELECT")

if mode in {"needle", "lightmap"}:
    bpy.ops.uv.average_islands_scale(scale_uv=True)
    bpy.ops.uv.lightmap_pack(
        PREF_CONTEXT="ALL_FACES",
        PREF_PACK_IN_ONE=True,
        PREF_NEW_UVLAYER=False,
        PREF_BOX_DIV=12,
        PREF_MARGIN_DIV=0.1,
    )
if mode == "needle":
    bpy.ops.uv.pack_islands(margin=0.01, rotate=False)
elif mode == "pack-cardinal":
    bpy.ops.uv.pack_islands(
        margin=0.01,
        rotate=True,
        rotate_method="CARDINAL",
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        shape_method="AABB",
    )
elif mode == "pack-none":
    bpy.ops.uv.pack_islands(
        margin=0.01,
        rotate=False,
        scale=True,
        merge_overlap=False,
        margin_method="FRACTION",
        shape_method="AABB",
    )
elif mode != "lightmap":
    raise RuntimeError(f"unknown mode: {mode}")

bpy.ops.object.mode_set(mode="OBJECT")
payload = []
for obj in sorted(objects, key=lambda item: item.name):
    payload.append([
        obj.name,
        [
            [round(loop.uv.x, 8), round(loop.uv.y, 8)]
            for loop in obj.data.uv_layers.active.data
        ],
    ])
encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
print("UV_SOURCE_AUDIT " + json.dumps({
    "mode": mode,
    "sha256": hashlib.sha256(encoded).hexdigest(),
}, sort_keys=True))
