# SPDX-License-Identifier: MIT
"""Factory-startup identity only. No source scenes, render, bake or GPU calls."""
import hashlib
import json
from pathlib import Path

import bpy
import io_scene_gltf2

root = Path(io_scene_gltf2.__file__).resolve().parent
files = []
for path in sorted(root.rglob("*.py")):
    files.append({"path": path.relative_to(root).as_posix(),
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
print("SCENETOWEB_RELEASE_NATIVE_IDENTITY " + json.dumps({
    "version": ".".join(str(x) for x in bpy.app.version),
    "buildHash": bpy.app.build_hash.decode("ascii"),
    "exporterVersion": list(io_scene_gltf2.bl_info["version"]),
    "exporterSourceFiles": files,
}, sort_keys=True))
