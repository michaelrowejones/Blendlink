"""Connect an opened .blend file to this Needle project and export it.

Run this with Blender, not regular Python. The final command-line argument must
be the absolute path to the Needle web project.
"""

from __future__ import annotations

import sys
from pathlib import Path

import bpy


def main() -> None:
    try:
        separator = sys.argv.index("--")
        project_path = Path(sys.argv[separator + 1]).resolve()
    except (ValueError, IndexError) as exc:
        raise RuntimeError("Expected -- <absolute Needle project path>") from exc

    package_json = project_path / "package.json"
    if not package_json.is_file():
        raise RuntimeError(f"Not a Needle web project: {project_path}")

    scene = bpy.context.scene
    if not hasattr(scene, "needle_blend_settings"):
        raise RuntimeError("The Needle Blender add-on is not enabled")

    settings = scene.needle_blend_settings
    settings.projectPath = str(project_path)
    settings.mainScene = scene
    settings.exportOnSave = False
    settings.compressOnSave = False
    settings.useProgressive = False
    settings.useProgressiveMeshes = False
    settings.useRapier = False
    settings.vr = False
    settings.ar = False
    settings.quicklook = False
    settings.depthSensing = False
    settings.useNetworking = False
    settings.voip = False
    settings.orbitControls = True
    settings.autoFit = True
    settings.contactShadows = True

    # Persist the project connection in the experiment's copy of the scene.
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)

    result = bpy.ops.needle_scene.export("EXEC_DEFAULT", immediate=True)
    exported_scene = project_path / "assets" / "scene.glb"
    if result != {"FINISHED"} or not exported_scene.is_file():
        raise RuntimeError(
            f"Needle export did not produce {exported_scene} (operator: {result})"
        )

    print(f"NEEDLE_EXPORT_READY {exported_scene} {exported_scene.stat().st_size}")


if __name__ == "__main__":
    main()
