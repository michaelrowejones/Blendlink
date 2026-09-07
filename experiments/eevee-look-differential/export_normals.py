# SPDX-License-Identifier: GPL-3.0-or-later
import pathlib, shutil
import bpy

root = pathlib.Path(__file__).resolve().parents[2] / "artifacts/verification-look"
bpy.ops.wm.open_mainfile(filepath=str(root / "normals/world-normal-fixture.blend"))
bpy.ops.export_scene.gltf(
    filepath=str(root / "browser/normals.glb"),
    export_format="GLB",
    export_tangents=True,
    export_cameras=True,
)
shutil.copyfile(root / "normals/fixture.json", root / "browser/normals.json")
