# SPDX-License-Identifier: GPL-3.0-or-later
"""Two external images in real Principled/surface programs share pinned assets."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np

addon = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(addon)); sys.path.insert(0, str(addon.parent / "blendlink/blender"))
import material_compiler as compiler
import bakelib
import export_scene


def main(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene; scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"; scene.cycles.samples = 1
    import _cycles
    _cycles.set_device_override("CPU"); bakelib._CYCLES_GPU_BACKENDS = ()
    images = []
    for image_index, label in enumerate(["Shared Paint A", "Shared Paint B"]):
        image = bpy.data.images.new(label, width=129, height=129, alpha=True, float_buffer=False)
        image.colorspace_settings.name = "Non-Color"; image.alpha_mode = "STRAIGHT"
        pixels = np.ones((129, 129, 4), np.float32)
        y, x = np.indices((129, 129))
        pixels[..., :3] = np.stack((x / 128, y / 128, ((x + 2*y) % 129) / 128), axis=-1) if image_index == 0 else np.stack((((2*x+y) % 129) / 128, (128-x) / 128, (128-y) / 128), axis=-1)
        image.pixels.foreach_set(pixels.ravel()); image.file_format = "PNG"
        image.filepath_raw = str(directory / (label + ".png")); image.save(); image.pack()
        images.append(image)
    objects, expected = [], {}
    small = bpy.data.images.new("Embedded Pattern B", width=3, height=3, alpha=True, float_buffer=False)
    small.colorspace_settings.name = "Non-Color"; small.alpha_mode = "STRAIGHT"
    small_pixels = np.ones((3, 3, 4), np.float32); sy, sx = np.indices((3, 3))
    small_pixels[..., :3] = np.stack((sx/2, sy/2, ((sx+2*sy)%3)/2), axis=-1)
    small.pixels.foreach_set(small_pixels.ravel()); small.file_format = "PNG"; small.filepath_raw = str(directory/"Embedded Pattern B.png"); small.save(); small.pack()
    cases = [("Two Images Quarter", .25, False, (-1, -2)), ("Two Images Three Quarters", .75, False, (-2, -1)), ("Two Images Surface Emission", .5, True, (0, -1)),
        ("Two Images Positive Boundary", .25, False, (1, 2)), ("Two Images Signed Zero", .25, False, (0, -0.0)),
        ("Two Images Negative Inside", .25, False, (-1 + 1/129, -2 + 1/129)), ("Two Images Negative Outside", .25, False, (-1 - 1/129, -2 - 1/129))]
    cases = [(*case, "constant") for case in cases] + [
        ("Two Images Authored UV", .25, False, (.23, .74), "uv"),
        ("Two Images Mapped UV", .25, False, (.23, .74), "mapped-uv"),
        ("Embedded And External UV", .25, False, (.23, .74), "embedded-uv"),
        ("Embedded And External Constant", .25, False, (-1, -2), "embedded-constant")]
    for index, (name, factor, surface, coordinates, coordinate_kind) in enumerate(cases):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
        uv = mesh.uv_layers.new(name="UVMap")
        uses_uv = coordinate_kind.endswith("uv")
        for loop in mesh.loops: uv.data[loop.index].uv = coordinates if uses_uv else [(0, 0), (1, 0), (1, 1), (0, 1)][loop.vertex_index]
        obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj); obj.location.x = index * 3
        obj["blendlink_id"] = "multi-image-" + str(index)
        material = bpy.data.materials.new(name); material.use_nodes = True; tree = material.node_tree; tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        root = tree.nodes.new("ShaderNodeEmission" if surface else "ShaderNodeBsdfPrincipled")
        tree.links.new(root.outputs[0], output.inputs["Surface"])
        mix = tree.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MIX"; mix.inputs[0].default_value = factor
        vector = tree.nodes.new("ShaderNodeCombineXYZ")
        vector.inputs["X"].default_value, vector.inputs["Y"].default_value = coordinates
        vector_output = vector.outputs[0]
        if uses_uv:
            source = tree.nodes.new("ShaderNodeUVMap"); source.uv_map = "UVMap"; vector_output = source.outputs[0]
        if coordinate_kind == "mapped-uv":
            mapping = tree.nodes.new("ShaderNodeVectorMath"); mapping.operation = "MULTIPLY_ADD"
            mapping.inputs[1].default_value = (.5, .25, 1); mapping.inputs[2].default_value = (-1, -2, 0)
            tree.links.new(vector_output, mapping.inputs[0]); vector_output = mapping.outputs[0]
        selected_images = [images[0], small] if coordinate_kind.startswith("embedded") else images
        for image_index, image in enumerate(selected_images):
            texture = tree.nodes.new("ShaderNodeTexImage"); texture.image = image
            texture.interpolation = "Closest" if image_index == (1 if factor == .75 else 0) else "Linear"
            tree.links.new(vector_output, texture.inputs["Vector"])
            tree.links.new(texture.outputs["Color"], mix.inputs[image_index + 1])
        tree.links.new(mix.outputs[0], root.inputs["Color" if surface else "Base Color"])
        if not surface: tree.links.new(mix.outputs[0], root.inputs["Roughness"])
        compiler.set_tsl_ir(material, True)
        mesh.materials.append(material); objects.append(obj)
        # A private native EMIT copy measures the actual authored image/mix
        # field without changing the material that is saved/exported below.
        oracle = material.copy(); oracle.name = "Private Multi Image Oracle"
        oracle_tree = oracle.node_tree
        oracle_output = next(node for node in oracle_tree.nodes if node.type == "OUTPUT_MATERIAL")
        oracle_mix = next(node for node in oracle_tree.nodes if node.bl_idname == "ShaderNodeMixRGB")
        emission = oracle_tree.nodes.new("ShaderNodeEmission")
        oracle_tree.links.new(oracle_mix.outputs[0], emission.inputs["Color"])
        oracle_tree.links.new(emission.outputs[0], oracle_output.inputs["Surface"])
        proxy = bakelib.uv_tile_proxy(["UVMap"], window=(0, 0, 1, 1))
        if uses_uv:
            for loop in proxy.data.uv_layers["UVMap"].data: loop.uv = coordinates
        proxy.data.materials.append(oracle)
        pixels = np.asarray(bakelib.bake_channel_field_pixels([proxy], size=16, margin_px=0,
            uv_layer="BLENDLINK_TILE_BAKE", label=name, allow_hdr=True)["pixels"], np.float32).reshape(16, 16, 3)
        assert np.isfinite(pixels).all() and np.max(np.ptp(pixels, axis=(0, 1))) < 1e-6, "Constant explicit image coordinates must give a uniform native reference"
        expected[name] = {"rgb": pixels[8, 8].tolist(), "channel": "Emission" if surface else "Base Color", "coordinates": list(coordinates), "coordinateKind": coordinate_kind,
            "externalImages": [image.name for image in selected_images if image.size[0] > 128]}
        bakelib.remove_uv_tile_proxy(proxy); bpy.data.materials.remove(oracle)
    assert max(abs(a-b) for a,b in zip(expected["Two Images Quarter"]["rgb"], expected["Two Images Positive Boundary"]["rgb"])) > .1, "Native negative-integer Closest selection must be distinguishable from the positive boundary"
    before = [(obj.name, tuple(obj.data.materials), [(len(mat.node_tree.nodes), len(mat.node_tree.links)) for mat in obj.data.materials]) for obj in objects]
    plan = compiler.plan_materials(objects, purpose="preview")
    assert not plan.errors, [error.as_dict() for error in plan.errors]
    for decision in plan.decisions:
        channels = {item["channel"]: item for item in decision.channel_plan["channels"]}
        for channel in [expected[decision.material_name]["channel"]] + ([] if "Emission" in decision.material_name else ["Roughness"]):
            names = set(); compiler._collect_texture_ref_images(channels[channel]["tslIr"], names)
            assert names == set(expected[decision.material_name]["externalImages"]), (decision.material_name, channel, channels[channel])
    published = export_scene.publish_material_programs(plan, str(directory / "native.glb"))
    document = json.loads(Path(published["path"]).read_text())
    assert set(document["images"]) == {image.name for image in images}, document["images"]
    for metadata in document["images"].values():
        payload = (directory / metadata["file"]).read_bytes()
        assert len(payload) == metadata["bytes"] and hashlib.sha256(payload).hexdigest()[:16] == metadata["hash"]
        assert (metadata["width"], metadata["height"], metadata["colorSpace"]) == (129, 129, "Non-Color")
    assert before == [(obj.name, tuple(obj.data.materials), [(len(mat.node_tree.nodes), len(mat.node_tree.links)) for mat in obj.data.materials]) for obj in objects]
    scene["blendlink_recipe"] = json.dumps({"schemaVersion":1,"presentation":"realtime",
        "atlases":[{"id":"main","name":"Main","size":256,"targetDensity":8,"margin":4,"fitPolicy":"block","bakeOutput":"lighting"}],
        "states":[{"name":"default"}],"preview":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1},
        "final":{"samples":1,"supersample":1,"denoise":False,"resolutionScale":1}})
    bpy.ops.wm.save_as_mainfile(filepath=str(directory / "Two Native Images.blend"))
    (directory / "native-reference.json").write_text(json.dumps({"blender":bpy.app.version_string,"expected":expected},indent=2))
    print("BLENDLINK_MULTI_IMAGE_PROGRAM_PASSED " + bpy.app.version_string)


destination = os.environ.get("BLENDLINK_MULTI_IMAGE_FIXTURE")
if destination: main(destination)
else:
    with tempfile.TemporaryDirectory(prefix="blendlink-multi-image-") as temporary: main(temporary)
