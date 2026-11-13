# SPDX-License-Identifier: GPL-3.0-or-later
"""Real 5.3 EEVEE Get Vector Component vs independent Separate XYZ graphs."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
modules = Path(os.environ.get("BLENDLINK_VECTOR_COMPONENT_MODULES", ROOT / "packages/blender-addon"))
sys.path.insert(0, str(ROOT / "packages/blendlink/blender")); sys.path.insert(0, str(modules))
import bakelib
import tsl_ir
from shader_domains import native_shader_input_evaluation

assert bpy.app.version[:3] == (5, 3, 0), "Numeric references require the actually available source node"
output = Path(os.environ["BLENDLINK_VECTOR_COMPONENT_REFERENCES"]).resolve()
output.mkdir(parents=True, exist_ok=True); (output / "ir").mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene; scene.render.engine = "BLENDER_EEVEE"; scene.eevee.taa_render_samples = 1
proxy = bakelib.uv_tile_proxy([], window=(0, 0, 1, 1))
camera_data = bpy.data.cameras.new("Component reference camera"); camera_data.type = "ORTHO"; camera_data.ortho_scale = 2
camera = bpy.data.objects.new(camera_data.name, camera_data); scene.collection.objects.link(camera)
camera.location = (0, 0, 2); scene.camera = camera; scene.world = None
scene.render.resolution_x = scene.render.resolution_y = SIZE = 64; scene.render.resolution_percentage = 100
scene.render.use_compositing = False; scene.render.dither_intensity = 0
scene.view_settings.view_transform = "Raw"; scene.view_settings.look = "None"
scene.render.image_settings.file_format = "OPEN_EXR"; scene.render.image_settings.color_mode = "RGBA"; scene.render.image_settings.color_depth = "32"


def material_for(case, control):
    material = bpy.data.materials.new(case["id"] + (" independent Separate" if control else " actual Component"))
    tree = bakelib.ensure_shader_node_tree(material); tree.nodes.clear()
    sink = tree.nodes.new("ShaderNodeOutputMaterial"); emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(emission.outputs[0], sink.inputs["Surface"])
    if case["kind"] == "carrier-control":
        emission.inputs["Color"].default_value = (.25, .5, .75, 1)
        return material, emission
    if case["kind"] == "uv-control":
        coordinate = tree.nodes.new("ShaderNodeTexCoord"); tree.links.new(coordinate.outputs["UV"], emission.inputs["Color"])
        return material, emission
    if case["vector"] == "uv":
        coordinate = tree.nodes.new("ShaderNodeTexCoord"); vector = coordinate.outputs["UV"]
    elif case["vector"] == "object":
        attribute = tree.nodes.new("ShaderNodeAttribute"); attribute.attribute_type = "OBJECT"; attribute.attribute_name = "component_vector"
        proxy[attribute.attribute_name] = case["values"]; vector = attribute.outputs["Vector"]
    else:
        constant = tree.nodes.new("FunctionNodeInputVector"); constant.vector = case["values"]; vector = constant.outputs[0]
    if control:
        component = tree.nodes.new("ShaderNodeSeparateXYZ"); tree.links.new(vector, component.inputs["Vector"])
        value = component.outputs[case["index"]]
    elif case["selector"].startswith("group"):
        group = bpy.data.node_groups.new("Actual component group", "ShaderNodeTree")
        group.interface.new_socket(name="Vector", in_out="INPUT", socket_type="NodeSocketVector")
        group.interface.new_socket(name="Index", in_out="INPUT", socket_type="NodeSocketInt")
        group.interface.new_socket(name="Value", in_out="OUTPUT", socket_type="NodeSocketFloat")
        incoming = group.nodes.new("NodeGroupInput"); outgoing = group.nodes.new("NodeGroupOutput"); nested = group.nodes.new("FunctionNodeGetVectorComponent")
        group.links.new(incoming.outputs["Vector"], nested.inputs["Vector"]); group.links.new(incoming.outputs["Index"], nested.inputs["Index"])
        group.links.new(nested.outputs[0], outgoing.inputs[0]); component = tree.nodes.new("ShaderNodeGroup"); component.node_tree = group
        tree.links.new(vector, component.inputs["Vector"]); component.inputs["Index"].default_value = case["index"]
        if case["selector"] == "group-literal":
            literal = tree.nodes.new("FunctionNodeInputInt"); literal.integer = case["index"]; tree.links.new(literal.outputs[0], component.inputs["Index"])
        value = component.outputs[0]
    else:
        component = tree.nodes.new("FunctionNodeGetVectorComponent"); component.inputs["Index"].default_value = case["index"]
        tree.links.new(vector, component.inputs["Vector"])
        if case["selector"] == "literal":
            literal = tree.nodes.new("FunctionNodeInputInt"); literal.integer = case["index"]; tree.links.new(literal.outputs[0], component.inputs["Index"])
        value = component.outputs[0]
    # Exactly representable encoding keeps signed/HDR values in EEVEE's
    # nonnegative emission carrier; it is identical in both native graphs.
    scale = tree.nodes.new("ShaderNodeMath"); scale.operation = "MULTIPLY"; scale.inputs[1].default_value = 1 / 1024
    offset = tree.nodes.new("ShaderNodeMath"); offset.operation = "ADD"; offset.inputs[1].default_value = .5
    tree.links.new(value, scale.inputs[0]); tree.links.new(scale.outputs[0], offset.inputs[0]); tree.links.new(offset.outputs[0], emission.inputs["Color"])
    return material, emission


def render(material, path):
    proxy.data.materials.clear(); proxy.data.materials.append(material); scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path), check_existing=False)
    pixels = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., :3].copy()
    bpy.data.images.remove(image); assert np.isfinite(pixels).all(); return pixels


def carrier_formula(case):
    """Independent socket/UV values, not fitted to either native output."""
    uv = np.zeros((SIZE, SIZE, 3), np.float32)
    uv[..., 0] = (np.arange(SIZE, dtype=np.float32)[None, :] + np.float32(.5)) / np.float32(SIZE)
    uv[..., 1] = (np.arange(SIZE, dtype=np.float32)[:, None] + np.float32(.5)) / np.float32(SIZE)
    if case["kind"] == "carrier-control": return np.broadcast_to(np.float32([.25, .5, .75]), uv.shape).copy()
    if case["kind"] == "uv-control": return uv
    value = uv[..., case["index"]] if case["vector"] == "uv" else np.full((SIZE, SIZE), np.float32(case["values"][case["index"]]), np.float32)
    encoded = np.float32(np.float32(value * np.float32(1 / 1024)) + np.float32(.5))
    return np.repeat(encoded[..., None], 3, axis=2)


cases = [{"id": "carrier-control", "kind": "carrier-control"}, {"id": "uv-control", "kind": "uv-control"}]
for source in ("constant", "uv", "object"):
    for index in range(3):
        for selector in ("default", "literal", "group-default", "group-literal"):
            values = [-128, .25, 256] if source == "constant" else [-8, 4, 16]
            cases.append({"id": f"{source}-{index}-{selector}", "kind": "component", "vector": source,
                "index": index, "selector": selector, "values": values,
                **({"objectAttributes": {"component_vector": values}} if source == "object" else {})})
for vector_index, values in enumerate([[0, 0, 0], [-1.234567, .3333333, 2 ** -24]]):
    for index in range(3): cases.append({"id": f"constant-extra-{vector_index}-{index}", "kind": "component",
        "vector": "constant", "index": index, "selector": "default", "values": values})
with tempfile.TemporaryDirectory(prefix="blendlink-component-oracle-") as temporary:
    for case in cases:
        groups = set(bpy.data.node_groups)
        material, emission = material_for(case, False)
        before = repr([(node.bl_idname, node.name, [(socket.identifier, repr(getattr(socket, "default_value", None))) for socket in node.inputs]) for node in material.node_tree.nodes])
        document = tsl_ir.emit_channel(emission.inputs["Color"])
        assert before == repr([(node.bl_idname, node.name, [(socket.identifier, repr(getattr(socket, "default_value", None))) for socket in node.inputs]) for node in material.node_tree.nodes])
        actual = render(material, Path(temporary) / "actual.exr")
        independent, independent_emission = material_for(case, True)
        expected = render(independent, Path(temporary) / "independent.exr")
        assert np.array_equal(actual.view(np.uint32), expected.view(np.uint32)), case
        assert np.array_equal(expected, expected.astype(np.float16).astype(np.float32)), "Native target no longer stores representable half values"
        ideal = carrier_formula(case)
        half_ulp = np.maximum(2.0 ** (np.floor(np.log2(np.where(np.abs(expected) > 0, np.abs(expected), 2 ** -14))) - 10), 2 ** -24)
        error = np.abs(expected.astype(np.float64) - ideal.astype(np.float64))
        ratio = float(np.max(error / (half_ulp + 6e-6)))
        assert ratio <= 1, (case, ratio)
        case["independentNativeCarrierCalibration"] = {"halfRepresentable": True, "maximumAbsoluteError": float(np.max(error)), "maximumBudgetRatio": ratio}
        assert document == tsl_ir.emit_channel(independent_emission.inputs["Color"]), case
        case["nativeComponentVsSeparateBitMismatches"] = 0
        case["evaluationStage"] = native_shader_input_evaluation(document["output"])
        expected.astype("<f4").tofile(output / (case["id"] + ".f32"))
        case["nativePixelSha256"] = hashlib.sha256((output / (case["id"] + ".f32")).read_bytes()).hexdigest()
        (output / "ir" / (case["id"] + ".json")).write_text(json.dumps(document))
        bpy.data.materials.remove(material, do_unlink=True); bpy.data.materials.remove(independent, do_unlink=True)
        for group in set(bpy.data.node_groups) - groups: bpy.data.node_groups.remove(group)
import gpu
if hasattr(gpu, "init"):
    gpu.init()
native_gpu_platform = {"backend": gpu.platform.backend_type_get(), "renderer": gpu.platform.renderer_get(),
    "vendor": gpu.platform.vendor_get()}
assert native_gpu_platform["backend"] in {"METAL", "OPENGL", "VULKAN"}, native_gpu_platform
(output / "index.json").write_text(json.dumps({"native": bpy.app.version_string, "hash": bpy.app.build_hash.decode(),
    "nativeGpuPlatform": native_gpu_platform,
    "sourceEngine": scene.render.engine, "size": SIZE, "cases": cases,
    "nativeCarrierCalibration": {"independentSocketUvFormula": True, "halfRepresentable": True,
        "maximumBudgetRatio": max(case["independentNativeCarrierCalibration"]["maximumBudgetRatio"] for case in cases)},
    "fixtureSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "nativeModules": {name: hashlib.sha256((modules / name).read_bytes()).hexdigest() for name in ["tsl_ir.py", "vector_component_ir.py"]}}, indent=2))
print("BLENDLINK_VECTOR_COMPONENT_REFERENCES_PASSED " + str(len(cases)))
