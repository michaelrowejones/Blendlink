# SPDX-License-Identifier: GPL-3.0-or-later
"""Real native GLB ownership metadata for per-object live material programs.

Run: blender -b --factory-startup --python-exit-code 1 --python this_file.py
"""
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile

import bpy

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon.parent / "blendlink" / "blender"))
sys.path.insert(0, str(addon))
import material_compiler as compiler
import glblib


def main(directory):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bpy.data.meshes.new("Shared two-slot geometry")
    mesh.from_pydata([(-1, -1, 0), (0, -1, 0), (1, -1, 0),
                      (-1, 1, 0), (0, 1, 0), (1, 1, 0)], [],
                     [(0, 1, 4, 3), (1, 2, 5, 4)])
    for name in ("First slot", "Second slot"):
        mesh.materials.append(bpy.data.materials.new(name))
    mesh.polygons[1].material_index = 1
    objects = []
    for name, tint in (("Owner A", [0.8, 0.35, 0.1]), ("Owner B", [0.1, 0.6, 0.9])):
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj["tint"] = tint
        objects.append(obj)
    unrelated = bpy.data.objects.new("Unrelated parent", None)
    bpy.context.scene.collection.objects.link(unrelated)
    objects[0].parent = unrelated
    ir = {"schemaVersion": 1, "model": "blendlink-tsl-ir-v1",
          "output": {"op": "attribute_object", "name": "tint", "output": "color"}}
    decision = SimpleNamespace(material_name="Live tint", channel_plan={"channels": [{"tslIr": ir}]})
    entries = {obj.name: compiler._tsl_runtime_mesh_entry(decision, obj) for obj in objects}
    assert all(entry == {"schemaVersion": 1, "objectAttributes": ["tint"]} for entry in entries.values()), entries
    path = directory / "actual-native-owners.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_extras=True)
    compiler._stamp_tsl_runtime_extras(str(path), {"private-material": {
        "source": "Live tint", "tslRuntimeMeshes": entries,
    }})
    document, _, _ = glblib.read_document(str(path), "test object owners")
    nodes = {node["name"]: node for node in document["nodes"]}
    assert "blendlink_tsl_object" not in nodes[unrelated.name].get("extras", {})
    assert nodes[objects[0].name]["mesh"] == nodes[objects[1].name]["mesh"], "Native shared geometry was lost"
    for obj in objects:
        node = nodes[obj.name]
        assert node["extras"]["blendlink_tsl_object"] == {"schemaVersion": 1, "objectName": obj.name}, node
        assert node["extras"]["tint"] == list(obj["tint"])
        exported_mesh = document["meshes"][node["mesh"]]
        assert len(exported_mesh["primitives"]) == 2, exported_mesh
        assert exported_mesh["extras"]["blendlink_tsl_runtime"]["objectAttributes"] == ["tint"]
        assert "blendlink_tsl_object" not in obj, "GLB-only metadata mutated the artist object"
    plain = SimpleNamespace(material_name="Plain", channel_plan={"channels": [{"tslIr": {
        "output": {"op": "const_vec3", "value": [1, 0, 0]},
    }}]})
    assert compiler._tsl_runtime_mesh_entry(plain, objects[0]) is None
    print("BLENDLINK_NATIVE_TSL_OBJECT_OWNER_CHECK_PASSED", bpy.app.version_string)


with tempfile.TemporaryDirectory(prefix="blendlink-native-object-owner-") as temporary:
    main(Path(temporary))
