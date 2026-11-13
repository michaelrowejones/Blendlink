# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native shader pixels for spectral nodes; no copied math oracle."""
import json
import platform
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native_modules = os.environ.get("BLENDLINK_SPECTRAL_NATIVE_MODULES")
sys.path.insert(0, native_modules or str(ROOT / "packages/blender-addon"))
sys.path.insert(0, native_modules or str(ROOT / "packages/blendlink/blender"))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ["BLENDLINK_SPECTRAL_REFERENCES"]).resolve()
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
camera_data = bpy.data.cameras.new("Spectral Reference Camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = 2
camera = bpy.data.objects.new("Spectral Reference Camera", camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 2)
scene.camera = camera
scene.world = None
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.use_compositing = False
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "32"
scene.render.dither_intensity = 0
engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
eevee = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else "BLENDER_EEVEE_NEXT"
temperatures = [-100, 0, 799, 800, 801, 964.9, 965, 1167, 1449, 1902, 3315, 6365, 6500, 11999, 12000, 50000]
wavelengths = [0, 374.9, 375, 375.1, 379, 380, 381, 385, 450, 500, 540, 600, 700, 775, 779, 780, 781, 1000]
records, refusals = [], []
requested_count = 0
only_cycles = os.environ.get("BLENDLINK_SPECTRAL_CYCLES_ONLY") == "1"

def source_qualified_noise_refusal(engine, uses_noise, reason, source_profile):
    """Accept only the declared unmeasured Cycles child-profile refusal."""
    expected = ('Normalized Noise has no verified live source precision profile for '
                'CYCLES on ' + sys.platform + '/' + platform.machine()
                + '; use source baking for this Cycles profile')
    return engine == 'CYCLES' and uses_noise and source_profile is None and reason == expected


def material_for(kind, value=None, bounds=None):
    material = bpy.data.materials.new("Native spectral " + kind)
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    emission = tree.nodes.new("ShaderNodeEmission")
    tree.links.new(emission.outputs[0], output.inputs["Surface"])
    if kind == "constant":
        emission.inputs["Color"].default_value = (*value, 1) if value else (0.25, 0.5, 0.75, 1)
    else:
        coord = tree.nodes.new("ShaderNodeTexCoord")
        separate = tree.nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(coord.outputs["UV"], separate.inputs[0])
        if kind == "uv-gradient":
            combine = tree.nodes.new("ShaderNodeCombineXYZ")
            tree.links.new(separate.outputs[0], combine.inputs[0])
            tree.links.new(separate.outputs[1], combine.inputs[1])
            tree.links.new(combine.outputs[0], emission.inputs["Color"])
        else:
            spectral = tree.nodes.new("ShaderNodeBlackbody" if kind == "blackbody" else "ShaderNodeWavelength")
            if isinstance(value, dict) and value.get("noise"):
                source = tree.nodes.new("ShaderNodeCombineXYZ")
                noise = tree.nodes.new("ShaderNodeTexNoise")
                noise.inputs["Scale"].default_value = 1
                noise.inputs["Detail"].default_value = 0
                noise.inputs["Distortion"].default_value = 0
                tree.links.new(source.outputs[0], noise.inputs["Vector"])
                affine = tree.nodes.new("ShaderNodeMath")
                affine.operation = "MULTIPLY_ADD"
                tree.links.new(noise.outputs["Fac"], affine.inputs[0])
                affine.inputs[1].default_value = 11200
                affine.inputs[2].default_value = 800
                tree.links.new(affine.outputs[0], spectral.inputs[0])
                if kind == "noise-control":
                    tree.links.new(noise.outputs["Fac"], emission.inputs["Color"])
                    return material, emission
            elif bounds:
                affine = tree.nodes.new("ShaderNodeMath")
                affine.operation = "MULTIPLY_ADD"
                tree.links.new(separate.outputs[0], affine.inputs[0])
                affine.inputs[1].default_value = bounds[1] - bounds[0]
                affine.inputs[2].default_value = bounds[0]
                tree.links.new(affine.outputs[0], spectral.inputs[0])
            else:
                spectral.inputs[0].default_value = value
            tree.links.new(spectral.outputs[0], emission.inputs["Color"])
    return material, emission

with tempfile.TemporaryDirectory(prefix="blendlink-native-spectral-") as temporary:
    for engine in (["CYCLES"] if only_cycles else ["CYCLES", eevee]):
        scene.render.engine = engine
        if engine != "CYCLES":
            scene.eevee.taa_render_samples = 1
        cases = [("constant", None, None)]
        cases.append(("uv-gradient", None, None))
        if engine != "CYCLES":
            cases += [("constant", value, None) for value in [(0.1234567, 1.234567, 5.413859),
                        (0.00000123, 0.050123, 0.99999), (0.3333333, 2.003, 12.3456)]]
        cases += [("blackbody", value, None) for value in temperatures]
        cases.append(("blackbody", 6400, None))
        cases.append(("noise-control", {"noise": True}, None))
        cases.append(("blackbody", {"noise": True}, None))
        cases += [("wavelength", value, None) for value in wavelengths]
        if engine == "CYCLES":
            cases += [("blackbody", None, (800, 12000)), ("blackbody", None, (-500, 13000)),
                      ("wavelength", None, (370, 790)), ("wavelength", None, (380, 780))]
        else:
            cases += [("blackbody", None, (900, 1000)), ("blackbody", None, (6000, 7000)),
                      ("wavelength", None, (490, 510))]
        requested_count += len(cases)
        source_profile = tsl_ir._normalized_noise_source_profile(engine, sys.platform, platform.machine(), scene.cycles.device)
        expected_refusals = {engine.lower() + '-' + kind + '-' + str(index)
            for index, (kind, value, bounds) in enumerate(cases)
            if engine == 'CYCLES' and source_profile is None and isinstance(value, dict) and value.get('noise')}
        observed_refusals = set()
        for index, (kind, value, bounds) in enumerate(cases):
            label = engine.lower() + "-" + kind + "-" + str(index)
            material, emission = material_for(kind, value, bounds)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            try:
                document = tsl_ir.emit_channel(emission.inputs["Color"])
            except tsl_ir.TslIrRefusal as error:
                if not source_qualified_noise_refusal(engine, isinstance(value, dict) and value.get('noise'), str(error), source_profile): raise
                observed_refusals.add(label)
                refusals.append({'id': label, 'engine': engine, 'reason': str(error),
                                 'sourceQualification': 'unmeasured-cycles-normalized-child'})
                bpy.data.materials.remove(material, do_unlink=True)
                continue
            (OUTPUT / "ir" / (label + ".json")).write_text(json.dumps(document))
            if engine == "CYCLES":
                result = bakelib.bake_channel_field_pixels([proxy], size=SIZE, margin_px=0,
                    uv_layer="BLENDLINK_TILE_BAKE", label=label, allow_hdr=True)
                pixels = np.asarray(result["pixels"], np.float32).reshape(SIZE, SIZE, 3)
            else:
                # Uniform shaders make a native center pixel an exact constant
                # oracle, independent of TAA subpixel positions/quad edge AA.
                scene.render.filepath = str(Path(temporary) / "native.exr")
                bpy.ops.render.render(write_still=True)
                image = bpy.data.images.load(scene.render.filepath, check_existing=False)
                raw = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)
                pixels = (raw[:, :, :3] if bounds or kind == "uv-gradient" else
                          np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1)))
                bpy.data.images.remove(image)
            assert np.isfinite(pixels).all(), label
            pixels.astype("<f4").tofile(OUTPUT / (label + ".f32"))
            records.append({"id": label, "kind": kind, "engine": engine,
                            "value": value, "bounds": bounds,
                            "minimum": pixels.min(axis=(0, 1)).tolist(), "maximum": pixels.max(axis=(0, 1)).tolist()})
            bpy.data.materials.remove(material, do_unlink=True)
        assert observed_refusals == expected_refusals, (observed_refusals, expected_refusals)
assert len(records) + len(refusals) == requested_count
(OUTPUT / "index.json").write_text(json.dumps({"blender": bpy.app.version_string,
    "buildHash": bpy.app.build_hash.decode(), "cyclesDevice": "CPU", "size": SIZE, "cases": records, "refusals": refusals, "requestedCases": requested_count}, indent=2))
print("BLENDLINK_SPECTRAL_REFERENCES_PASSED " + str(len(records)))
