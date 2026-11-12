# SPDX-License-Identifier: GPL-3.0-or-later
"""Native camera/child worlds and shared cubic animation storage regression."""
import copy
import json
import math
import os
from pathlib import Path
import struct
import sys
import tempfile

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "blendlink/blender"))
import camera_axes
import glblib


def read_values(document, binary, accessor_index):
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    width = {"VEC3": 3, "VEC4": 4}[accessor["type"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return [struct.unpack_from("<" + "f" * width, binary, start + index * view.get("byteStride", width * 4)) for index in range(accessor["count"])]


def world_matrices(document, chunks, last=False):
    nodes = copy.deepcopy(document["nodes"])
    binary = glblib.binary_chunk(chunks, "native-camera-test")
    for animation in document.get("animations", []):
        for channel in animation["channels"]:
            target = channel["target"]
            if target["path"] not in {"translation", "rotation", "scale"}: continue
            sampler = animation["samplers"][channel["sampler"]]
            values = read_values(document, binary, sampler["output"])
            nodes[target["node"]][target["path"]] = values[-2 if sampler.get("interpolation") == "CUBICSPLINE" else -1] if last else values[1 if sampler.get("interpolation") == "CUBICSPLINE" else 0]
    parents = {child: index for index, node in enumerate(nodes) for child in node.get("children", [])}
    def world(index):
        node = nodes[index]
        if "matrix" in node: local = Matrix([node["matrix"][offset:offset+4] for offset in range(0, 16, 4)]).transposed()
        else:
            rotation = node.get("rotation", [0, 0, 0, 1])
            local = Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])), Quaternion((rotation[3], *rotation[:3])), Vector(node.get("scale", [1, 1, 1])))
        return world(parents[index]) @ local if index in parents else local
    return {node.get("name"): world(index) for index, node in enumerate(nodes)}


with tempfile.TemporaryDirectory(prefix="blendlink-camera-axes-") as temporary:
    root = Path(os.environ.get("BLENDLINK_CAMERA_AXES_REFERENCES", temporary)); root.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene; scene.frame_start = 1; scene.frame_end = 3
    rig = bpy.data.objects.new("Native camera rig", None); scene.collection.objects.link(rig)
    rig.location = (2, -3, 4); rig.rotation_euler = (.1, .2, -.3); rig.scale = (1.2, .8, 1.4)
    camera = bpy.data.objects.new("Native camera", bpy.data.cameras.new("Native camera data")); scene.collection.objects.link(camera); camera.parent = rig; scene.camera = camera
    mesh = bpy.data.meshes.new("Native camera child mesh"); mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
    child = bpy.data.objects.new("Native camera child", mesh); scene.collection.objects.link(child); child.parent = camera
    nested = bpy.data.objects.new("Native nested camera", bpy.data.cameras.new("Nested camera data")); scene.collection.objects.link(nested); nested.parent = camera
    nested.location = (1, -.3, 2); nested.rotation_euler = (.12, -.43, .2); nested.scale = (.8, -1.3, 2.1)
    untouched = bpy.data.objects.new("Unrelated ordinary object", mesh); scene.collection.objects.link(untouched); untouched.location = (-2, 3, 1)
    expected = {}
    for frame in (1, 3):
        camera.location = (3 + frame, -5, 8); camera.rotation_euler = (.5, .2 + frame * .1, -.1); camera.scale = (-1.2, 2, .6)
        child.location = (1, 2, -3 + frame * .2); child.rotation_euler = (.2, -.3, .4); child.scale = (.7, 1.4, 1.1)
        for obj in (camera, child):
            for property in ("location", "rotation_euler", "scale"): obj.keyframe_insert(data_path=property, frame=frame)
        scene.frame_set(frame); bpy.context.view_layer.update()
        expected[frame] = {obj.name: obj.matrix_world.copy() for obj in (camera, child, nested, untouched)}
    scene.frame_set(1)
    change = Matrix.Rotation(-math.pi / 2, 4, "X")
    rows = []
    for yup in (True, False):
        path = str(root / ("camera-yup.glb" if yup else "camera-zup.glb"))
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=yup, export_cameras=True, export_animations=True, export_frame_range=True, export_force_sampling=True)
        before, old_chunks, _ = glblib.read_document(path, "native-camera-before")
        camera_axes.canonicalize_camera_axes(path, export_yup=yup)
        document, chunks, _ = glblib.read_document(path, "native-camera-after")
        # Unrelated camera-free transforms and every original binary byte stay exact.
        assert next(node for node in document["nodes"] if node.get("name") == untouched.name) == next(node for node in before["nodes"] if node.get("name") == untouched.name)
        assert glblib.binary_chunk(chunks, "test").startswith(glblib.binary_chunk(old_chunks, "test"))
        for frame in (1, 3):
            worlds = world_matrices(document, chunks, last=frame == 3)
            for name, native in expected[frame].items():
                desired = change @ native if yup else native
                if yup and name not in {camera.name, nested.name}: desired = desired @ change.inverted()
                maximum = max(abs(worlds[name][r][c] - desired[r][c]) for r in range(4) for c in range(4))
                assert maximum < 8e-6, (bpy.app.version_string, yup, frame, name, maximum, worlds[name], desired)
                rows.append({"yup": yup, "frame": frame, "node": name, "maximum": maximum, "native": [list(row) for row in native]})
    (root / "native-camera-worlds.json").write_text(json.dumps({"blender": bpy.app.version_string, "rows": rows}, indent=2))

    # Matrix-authored nodes and shared CUBICSPLINE accessors: tangent rotation
    # is linear and unnormalized, and the ordinary object's sampler stays exact.
    path = str(root / "cubic-camera.glb")
    rotation_rows = [(0, 0, 0, 0), (.2, -.3, .4, .8426149), (2, -3, 4, 5)]
    payload = struct.pack("<13f", 0, *(item for row in rotation_rows for item in row))
    document = {
        "asset": {"version": "2.0"},
        "nodes": [{"name": "camera", "camera": 0}, {"name": "ordinary"},
            {"name": "matrix camera", "camera": 0, "matrix": [value for column in Matrix.Identity(4).transposed() for value in column]}],
        "cameras": [{"type": "perspective", "perspective": {"yfov": 1, "znear": .1}}],
        "buffers": [{"byteLength": len(payload)}],
        "bufferViews": [{"buffer": 0, "byteLength": 4}, {"buffer": 0, "byteOffset": 4, "byteLength": 48}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "SCALAR", "min": [0], "max": [0]},
            {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC4"}],
        "animations": [{"samplers": [{"input": 0, "output": 1, "interpolation": "CUBICSPLINE"}],
            "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}},
                {"sampler": 0, "target": {"node": 1, "path": "rotation"}}]}],
    }
    glblib.write_document(path, document, [[glblib.GLB_JSON_CHUNK, b""], [glblib.GLB_BINARY_CHUNK, payload]], 0, "test")
    camera_axes.canonicalize_camera_axes(path, export_yup=False)
    result, chunks, _ = glblib.read_document(path, "test")
    channels = result["animations"][0]["channels"]; samplers = result["animations"][0]["samplers"]
    assert channels[1]["sampler"] == 0 and samplers[0]["output"] == 1
    actual = read_values(result, glblib.binary_chunk(chunks, "test"), samplers[channels[0]["sampler"]]["output"])
    half = math.sqrt(.5)
    for source, rewritten in zip(rotation_rows, actual):
        x, y, z, w = source
        independent = [half * (x + w), half * (y + z), half * (z - y), half * (w - x)]
        assert max(abs(a - b) for a, b in zip(rewritten, independent)) < 1e-6, (source, rewritten, independent)
    assert abs(sum(value * value for value in actual[2]) - sum(value * value for value in rotation_rows[2])) < 2e-5
    assert result["nodes"] == document["nodes"], "Static/matrix-authored node transforms must remain exact"
    left = copy.deepcopy(document)
    left["nodes"][0]["children"] = [1]
    left["nodes"].append({"name": "unrelated"})
    left["animations"][0]["channels"][0]["target"]["node"] = 1
    left["animations"][0]["channels"][1]["target"]["node"] = 3
    glblib.write_document(path, left, [[glblib.GLB_JSON_CHUNK, b""], [glblib.GLB_BINARY_CHUNK, payload]], 0, "test")
    camera_axes.canonicalize_camera_axes(path, export_yup=True)
    result, chunks, _ = glblib.read_document(path, "test")
    animation = result["animations"][0]
    output = animation["samplers"][animation["channels"][0]["sampler"]]["output"]
    actual = read_values(result, glblib.binary_chunk(chunks, "test"), output)
    for source, rewritten in zip(rotation_rows, actual):
        x, y, z, w = source
        independent = [half * (x + w), half * (y - z), half * (z + y), half * (w - x)]
        assert max(abs(a - b) for a, b in zip(rewritten, independent)) < 1e-6
    assert animation["channels"][1]["sampler"] == 0
    # No animation correction is needed for purely static cameras, even with
    # matrix-authored nodes and arbitrary extra GLB chunks.
    static = copy.deepcopy(document); static.pop("animations")
    glblib.write_document(path, static, [[glblib.GLB_JSON_CHUNK, b""], [glblib.GLB_BINARY_CHUNK, payload], [0x12345678, b"test"]], 0, "test")
    before = Path(path).read_bytes()
    for yup in (True, False):
        camera_axes.canonicalize_camera_axes(path, export_yup=yup)
        assert Path(path).read_bytes() == before

    # Every cubic tangent vector receives the same axis permutation; shared
    # ordinary outputs remain byte-exact for scale and child translation too.
    for target, operation, expected in [(0, "scale", lambda v: (v[0], v[2], v[1])),
            (1, "translation", lambda v: (v[0], -v[2], v[1]))]:
        vectors = [(0, 0, 0), (-2, 3, .5), (4, -5, 6)]
        packed = struct.pack("<10f", 0, *(value for vector in vectors for value in vector))
        data = copy.deepcopy(document)
        data["nodes"][0]["children"] = [1]
        data["nodes"].append({"name": "unrelated"})
        data["buffers"][0]["byteLength"] = len(packed)
        data["bufferViews"][1]["byteLength"] = 36
        data["accessors"][1]["type"] = "VEC3"
        data["animations"][0]["channels"] = [{"sampler": 0, "target": {"node": target, "path": operation}}, {"sampler": 0, "target": {"node": 3, "path": operation}}]
        glblib.write_document(path, data, [[glblib.GLB_JSON_CHUNK, b""], [glblib.GLB_BINARY_CHUNK, packed]], 0, "test")
        camera_axes.canonicalize_camera_axes(path, export_yup=True)
        data, chunks, _ = glblib.read_document(path, "test")
        channel = data["animations"][0]["channels"][0]
        output = data["animations"][0]["samplers"][channel["sampler"]]["output"]
        assert read_values(data, glblib.binary_chunk(chunks, "test"), output) == [expected(vector) for vector in vectors]
        assert data["animations"][0]["channels"][1]["sampler"] == 0
        assert glblib.binary_chunk(chunks, "test").startswith(packed)
    print("BLENDLINK_CAMERA_AXES_PASSED " + bpy.app.version_string)
