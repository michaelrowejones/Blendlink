# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material integer/boolean pixels through the production IR emitter."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native = os.environ.get("BLENDLINK_UTILITY_NATIVE_MODULES")
sys.path.insert(0, native or str(ROOT / "packages/blender-addon"))
sys.path.insert(0, native or str(ROOT / "packages/blendlink/blender"))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ["BLENDLINK_UTILITY_REFERENCES"]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / "ir").mkdir(exist_ok=True)
SIZE = 64
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.cycles.samples = 1
scene.cycles.device = "CPU"
import _cycles
_cycles.set_device_override("CPU")
bakelib._CYCLES_GPU_BACKENDS = ()
proxy = bakelib.uv_tile_proxy([], window=(0, 0, 1, 1))
camera_data = bpy.data.cameras.new("Utility Reference Camera")
camera_data.type = "ORTHO"; camera_data.ortho_scale = 2
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera); camera.location = (0, 0, 2); scene.camera = camera
scene.world = None
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.use_compositing = False
scene.render.dither_intensity = 0
scene.view_settings.view_transform = "Raw"; scene.view_settings.look = "None"
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGBA"; scene.render.image_settings.color_depth = "32"
engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
EEVEE = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
probe = bpy.data.node_groups.new("Actual shader utility availability", "ShaderNodeTree")
capabilities = {}
for identifier in ("FunctionNodeInputBool", "FunctionNodeInputInt", "FunctionNodeInputVector", "FunctionNodeBooleanMath", "FunctionNodeIntegerMath", "FunctionNodeCompare"):
    try:
        node = probe.nodes.new(identifier); probe.nodes.remove(node)
        capabilities[identifier] = {"available": True}
    except RuntimeError as error:
        capabilities[identifier] = {"available": False, "reason": str(error)}
bpy.data.node_groups.remove(probe)


def material_for(case):
    material = bpy.data.materials.new("Native Utility " + case["id"])
    tree = bakelib.ensure_shader_node_tree(material); tree.nodes.clear()
    sink = tree.nodes.new("ShaderNodeOutputMaterial"); emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(emission.outputs[0], sink.inputs["Surface"])
    if case["kind"] == "constant":
        emission.inputs["Color"].default_value = (*case["value"], 1)
        return material, emission
    if case["kind"] == "vector-input":
        vector = tree.nodes.new("FunctionNodeInputVector"); vector.vector = case["value"]
        scale = tree.nodes.new("ShaderNodeVectorMath"); scale.operation = "SCALE"
        scale.inputs["Scale"].default_value = 1 / 64
        offset = tree.nodes.new("ShaderNodeVectorMath"); offset.operation = "ADD"
        offset.inputs[1].default_value = (.5, .5, .5)
        tree.links.new(vector.outputs[0], scale.inputs[0]); tree.links.new(scale.outputs[0], offset.inputs[0])
        tree.links.new(offset.outputs[0], emission.inputs["Color"])
        return material, emission
    def scalar(number, kind="INT"):
        node = tree.nodes.new("FunctionNodeInputBool" if kind == "BOOLEAN" else "FunctionNodeInputInt")
        if kind == "BOOLEAN": node.boolean = bool(number)
        else: node.integer = number
        return node.outputs[0]
    if case["kind"] == "input": output = scalar(case["value"][0], case["type"])
    else:
        boolean = case["kind"] == "boolean"
        node = tree.nodes.new("FunctionNodeBooleanMath" if boolean else "FunctionNodeIntegerMath")
        node.operation = case["operation"]
        inputs = [socket for socket in node.inputs if socket.enabled and not getattr(socket, "is_unavailable", False)]
        for index, (socket, number) in enumerate(zip(inputs, case["value"])):
            value = scalar(number, "BOOLEAN" if boolean else "INT")
            if case["stage"] == "shader":
                source = tree.nodes.new("ShaderNodeAttribute"); source.attribute_type = "OBJECT"; source.attribute_name = "utility_input_" + str(index)
                proxy[source.attribute_name] = number
                value = source.outputs["Fac"]
                if not boolean and case["operation"] in {"DIVIDE_ROUND", "LCM"}:
                    bounded = tree.nodes.new("ShaderNodeClamp"); bounded.inputs["Min"].default_value = -10000; bounded.inputs["Max"].default_value = 10000
                    tree.links.new(value, bounded.inputs[0]); value = bounded.outputs[0]
            tree.links.new(value, socket)
        output = node.outputs[0]
    if capabilities["FunctionNodeIntegerMath"]["available"] and case["kind"] != "boolean" and case.get("type") != "BOOLEAN":
        digits = tree.nodes.new("FunctionNodeIntegerMath"); digits.operation = "MODULO"
        tree.links.new(output, digits.inputs[0]); digits.inputs[1].default_value = 251
        output = digits.outputs[0]
    affine = tree.nodes.new("ShaderNodeMath"); affine.operation = "MULTIPLY_ADD"
    affine.inputs[1].default_value = 1 / (8589934592 if case.get("kind") == "input" and case.get("type") == "INT" and bpy.app.version < (5, 3, 0) else 1024)
    affine.inputs[2].default_value = 0.5
    tree.links.new(output, affine.inputs[0]); tree.links.new(affine.outputs[0], emission.inputs["Color"])
    return material, emission


cases = []
for engine in ["CYCLES", EEVEE]:
    cases.append({"id": engine.lower() + "-constant", "engine": engine, "kind": "constant", "value": [.25, .5, .75]})
    if capabilities["FunctionNodeInputVector"]["available"]:
        for index, values in enumerate([[0,0,0],[.25,.5,.75],[-8,4,16],[-1.234567,.3333333,2**-24]]):
            cases.append({"id": engine.lower()+"-vector-input-"+str(index), "engine":engine,
                          "kind":"vector-input", "value":values})
    for type, selected in [("BOOLEAN", [False, True]), ("INT", [-2147483648, -16777217, -1, 0, 1, 16777217, 2147483647])]:
        if not capabilities["FunctionNodeInputBool" if type == "BOOLEAN" else "FunctionNodeInputInt"]["available"]: continue
        for number in selected:
            cases.append({"id": engine.lower() + "-input-" + type.lower() + "-" + str(number).lower(), "engine": engine, "kind": "input", "type": type, "value": [number]})
    for operation in (["AND", "OR", "NOT", "XOR", "XNOR", "NAND", "NOR", "IMPLY", "NIMPLY"] if capabilities["FunctionNodeBooleanMath"]["available"] and capabilities["FunctionNodeInputBool"]["available"] else []):
        for stage in ["constant", "shader"]:
            for index, values in enumerate([[0, 0], [0, 1], [1, 0], [1, 1]]):
                cases.append({"id": f"{engine.lower()}-boolean-{operation.lower()}-{stage}-{index}", "engine": engine,
                              "kind": "boolean", "operation": operation, "stage": stage, "value": values})
    for operation in (["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "MULTIPLY_ADD", "ABSOLUTE", "NEGATE", "POWER", "MINIMUM", "MAXIMUM", "SIGN", "DIVIDE_ROUND", "DIVIDE_FLOOR", "DIVIDE_CEIL", "FLOORED_MODULO", "MODULO", "GCD", "LCM"] if capabilities["FunctionNodeIntegerMath"]["available"] and capabilities["FunctionNodeInputInt"]["available"] else []):
        for stage in ["constant", "shader"]:
            selected = [[7, 3, -2], [-7, -3, 2], [-2, 0, 0], [-2, -3, 4]]
            if stage == "constant": selected += [[2147483647, 2, 11], [50000, 50000, -50000]]
            for index, values in enumerate(selected):
                if operation == "DIVIDE_ROUND" and stage == "constant" and index == 4: continue
                cases.append({"id": f"{engine.lower()}-integer-{operation.lower()}-{stage}-{index}", "engine": engine,
                              "kind": "integer", "operation": operation, "stage": stage, "value": values})
selected_kinds = os.environ.get("BLENDLINK_UTILITY_KINDS")
if selected_kinds:
    selected = set(selected_kinds.split(","))
    assert selected <= {"constant", "input", "vector-input", "boolean", "integer"}, selected
    cases = [case for case in cases if case["kind"] in selected]
records = []
with tempfile.TemporaryDirectory(prefix="blendlink-native-utilities-") as temporary:
    for case in cases:
        scene.render.engine = case["engine"]
        if case["engine"] != "CYCLES": scene.eevee.taa_render_samples = 1
        material, emission = material_for(case)
        proxy.data.materials.clear(); proxy.data.materials.append(material)
        document = tsl_ir.emit_channel(emission.inputs["Color"])
        (OUTPUT / "ir" / (case["id"] + ".json")).write_text(json.dumps(document))
        if case["engine"] == "CYCLES":
            result = bakelib.bake_channel_field_pixels([proxy], size=SIZE, margin_px=0, uv_layer="BLENDLINK_TILE_BAKE", label=case["id"], allow_hdr=True)
            raw = np.asarray(result["pixels"], np.float32).reshape(SIZE, SIZE, 3)
        else:
            scene.render.filepath = str(Path(temporary) / "native.exr"); bpy.ops.render.render(write_still=True)
            image = bpy.data.images.load(scene.render.filepath, check_existing=False)
            raw = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., :3]
            bpy.data.images.remove(image)
        pixels = np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1))
        assert np.isfinite(pixels).all(), case["id"]
        pixels.astype("<f4").tofile(OUTPUT / (case["id"] + ".f32"))
        if case.get("stage") == "shader": case["objectAttributes"] = {"utility_input_" + str(index): [number] * 3 for index, number in enumerate(case["value"])}
        records.append(case); bpy.data.materials.remove(material, do_unlink=True)
(OUTPUT / "index.json").write_text(json.dumps({"blender": bpy.app.version_string, "buildHash": bpy.app.build_hash.decode(),
    "size": SIZE, "cases": records, "nativeCapabilities": capabilities,"nativeModuleHashes": {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in Path(native).iterdir() if path.suffix in {".py", ".json"}} if native else {}}, indent=2))
print("BLENDLINK_UTILITY_REFERENCES_PASSED " + str(len(records)))
