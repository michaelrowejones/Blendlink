# SPDX-License-Identifier: GPL-3.0-or-later
"""Headless contract check for responsive framing and reference capture."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import bpy


ADDON_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "blendlink_presentation_check"


def expect(condition, message):
    if not condition:
        raise AssertionError(message)


bpy.ops.wm.read_factory_settings(use_empty=True)
spec = importlib.util.spec_from_file_location(
    PACKAGE, ADDON_DIR / "__init__.py",
    submodule_search_locations=[str(ADDON_DIR)],
)
addon = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = addon
spec.loader.exec_module(addon)
addon.register()

presentation = sys.modules[f"{PACKAGE}.presentation"]
presentation_ui = sys.modules[f"{PACKAGE}.presentation_ui"]
overlay = sys.modules[f"{PACKAGE}.overlay"]
presentation_ui.re_register_category("Web Art")
expect(presentation_ui.BLENDLINK_PT_visual_references.bl_space_type == "PROPERTIES"
       and presentation_ui.BLENDLINK_PT_visual_references.bl_context == "scene",
       "visual-reference panel did not remain with scene-owned presentation settings")
presentation_ui.re_register_category("Blendlink")

scene = bpy.context.scene
bpy.ops.object.camera_add(location=(0.0, -6.0, 2.0), rotation=(1.25, 0.0, 0.0))
camera = bpy.context.object
camera.name = "Hero Camera"
camera["blendlink_id"] = "hero-camera-id"
scene.camera = camera
bpy.ops.mesh.primitive_cube_add()

bpy.ops.blendlink.setup_website_export()
project = scene.blendlink_project
while len(project.compositions) > 1:
    project.compositions.remove(len(project.compositions) - 1)
composition = project.compositions[0]
composition.name = "Tiny"
composition.width = 32
composition.height = 24
composition.safe_margin = 0.125

expect(
    presentation.parse_frame_spec(
        "start,3-7x2,end", current=4, start=1, end=10,
    ) == [1, 3, 5, 7, 10],
    "frame expression contract failed",
)
geometry = presentation.overlay_geometry((0, 0, 100, 80), (10, 10, 90, 70), 0.1)
expect(geometry["safe"] == (18.0, 16.0, 82.0, 64.0), "safe-zone geometry failed")

matrix = presentation.build_reference_matrix(
    source_blend="hero.blend",
    cameras=[{"objectId": "hero-camera-id", "objectName": "Hero Camera"}],
    states=[{"name": "default", "hideCollections": []}],
    compositions=[{"name": "Tiny", "width": 32, "height": 24, "safeMargin": 0.125}],
    frame_spec="current", current_frame=1, frame_start=1, frame_end=250,
    fps=24.0, device_pixel_ratio=1.0,
)
expect(matrix["matrix"]["blenderReferenceCount"] == 1, "source reference count failed")
expect(matrix["matrix"]["comparisonCount"] == 2, "Preview/Final cross product failed")
expect(
    all(cell["browser"]["status"] == "required" for cell in matrix["comparisons"]),
    "browser evidence must remain required",
)

reference_settings = scene.blendlink_reference
before = (scene.render.resolution_x, scene.render.resolution_y, scene.camera)
bpy.ops.blendlink.preview_composition()
expect(
    reference_settings.preview_active
    and (scene.render.resolution_x, scene.render.resolution_y) == (32, 24),
    "composition preview did not apply exact backing dimensions",
)
original_camera_frame_rect = overlay._camera_frame_rect
overlay._camera_frame_rect = lambda _context, _camera: (10.0, 10.0, 90.0, 70.0)
guide = overlay._composition_guide_state(
    SimpleNamespace(scene=scene),
    SimpleNamespace(width=100, height=80),
    SimpleNamespace(view_perspective="CAMERA"),
)
overlay._camera_frame_rect = original_camera_frame_rect
expect(guide["exact"] and guide["safe"] == (20.0, 17.5, 80.0, 62.5),
       f"camera-view overlay did not resolve the exact safe frame: {guide}")
bpy.ops.blendlink.stop_composition_preview()
expect(
    not reference_settings.preview_active
    and (scene.render.resolution_x, scene.render.resolution_y, scene.camera) == before,
    "composition preview did not restore prior render state",
)

scene.render.engine = "BLENDER_EEVEE"
with tempfile.TemporaryDirectory(prefix="blendlink-presentation-") as temporary:
    root = Path(temporary)
    manifest_path = root / "comparison-manifest.json"
    presentation_ui._write_manifest(manifest_path, matrix)
    prior = (scene.render.resolution_x, scene.render.resolution_y, scene.frame_current, scene.camera)
    presentation_ui._capture_matrix(bpy.context, matrix, root, manifest_path)
    expect(matrix["references"][0]["blender"]["status"] == "captured",
           "Blender reference was not marked captured")
    expect((root / matrix["references"][0]["blender"]["path"]).exists(),
           "Blender reference PNG was not written")
    expect(all(cell["browser"]["status"] == "required" for cell in matrix["comparisons"]),
           "Blender capture pretended browser evidence existed")
    persisted = json.loads(manifest_path.read_text(encoding="utf8"))
    expect(persisted["references"][0]["blender"]["status"] == "captured",
           "incremental manifest update was not persisted")
    expect((scene.render.resolution_x, scene.render.resolution_y, scene.frame_current, scene.camera) == prior,
           "reference capture did not restore Blender render state")

addon.unregister()
print("BLENDLINK_PRESENTATION_CHECK_PASSED")
