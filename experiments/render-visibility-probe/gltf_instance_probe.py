"""Probe mixed direct/Collection-Instance visibility in Blender's glTF tree."""

from __future__ import annotations

import json
import struct
import sys
import tempfile
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "blendlink" / "blender"))
sys.path.insert(0, str(ROOT / "packages" / "blender-addon"))
import export_scene as exporter  # noqa: E402


def cube(name):
    mesh = bpy.data.meshes.new(f"{name} Mesh")
    mesh.from_pydata(
        [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5),
         (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5),
         (-0.5, -0.5, 0.5), (0.5, -0.5, 0.5),
         (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)],
        [],
        [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
         (1, 5, 6, 2), (2, 6, 7, 3), (4, 0, 3, 7)],
    )
    return bpy.data.objects.new(name, mesh)


def glb_document(path):
    data = path.read_bytes()
    length, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    return json.loads(data[20:20 + length])


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_active_scene=True,
        use_renderable=True,
        export_cameras=False,
        export_lights=True,
        check_existing=False,
    )
    document = glb_document(path)
    return [node.get("name") for node in document.get("nodes", [])]


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
hidden_parent = bpy.data.collections.new("Render-hidden Direct Parent")
hidden_parent.hide_render = True
source = bpy.data.collections.new("Shared Source")
scene.collection.children.link(hidden_parent)
hidden_parent.children.link(source)
source_obj = cube("Mixed Visibility Source")
source.objects.link(source_obj)
instance = bpy.data.objects.new("Visible Collection Instance", None)
instance.instance_type = "COLLECTION"
instance.instance_collection = source
instance.location.x = 2.0
scene.collection.objects.link(instance)
bpy.context.view_layer.update()

direct = exporter.weblights.render_visibility(
    source_obj, scene, view_layer=bpy.context.view_layer,
)
occurrences = exporter.collect_instance_source_occurrences(
    scene, view_layer=bpy.context.view_layer,
)[source_obj.as_pointer()]["occurrences"]

with tempfile.TemporaryDirectory(prefix="blendlink-gltf-visibility-") as tmp:
    tmp = Path(tmp)
    stock_names = export(tmp / "stock.glb")
    restore = exporter.enforce_export_render_visibility(
        scene,
        view_layer=bpy.context.view_layer,
        export_kwargs={"use_active_scene": True, "use_renderable": True},
    )
    try:
        blendlink_names = export(tmp / "blendlink.glb")
    finally:
        exporter.restore_export_render_visibility(restore)

result = {
    "directVisibility": direct.exported,
    "instanceOccurrenceVisibility": [item["visible"] for item in occurrences],
    "stockSourceNodeCount": stock_names.count(source_obj.name),
    "blendlinkSourceNodeCount": blendlink_names.count(source_obj.name),
    "stockNodes": stock_names,
    "blendlinkNodes": blendlink_names,
}
print("BLENDLINK_GLTF_MIXED_INSTANCE_PROBE=" + json.dumps(result, indent=2))
assert result["directVisibility"] is False
assert result["instanceOccurrenceVisibility"] == [True]
# This assertion documents the current bug: one render occurrence should ship,
# but stock Blender and the current transaction both emit direct + instanced.
assert result["stockSourceNodeCount"] == 2
assert result["blendlinkSourceNodeCount"] == 2
