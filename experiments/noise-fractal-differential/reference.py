# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material color conversion pixels; the native node is the numeric oracle."""
import json
import hashlib
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native = os.environ.get('BLENDLINK_NOISE_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ['BLENDLINK_NOISE_REFERENCES']).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / 'ir').mkdir(exist_ok=True)
SIZE = 64
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.cycles.samples = 1
scene.cycles.device = 'CPU'
import _cycles
_cycles.set_device_override('CPU')
bakelib._CYCLES_GPU_BACKENDS = ()
proxy = bakelib.uv_tile_proxy([], window=(0, 0, 1, 1))
camera_data = bpy.data.cameras.new('Noise Reference Camera')
camera_data.type = 'ORTHO'
camera_data.ortho_scale = 2
camera = bpy.data.objects.new(camera_data.name, camera_data)
scene.collection.objects.link(camera)
camera.location = (0, 0, 2)
scene.camera = camera
scene.world = None
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.resolution_percentage = 100
scene.render.use_compositing = False
scene.render.film_transparent = False
scene.render.dither_intensity = 0
scene.view_settings.view_transform = 'Raw'
scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '32'
engines = {item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
EEVEE = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'



def exact_inputs(tree):
    image = bpy.data.images.new('Exact Noise inputs', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    values = np.ones((SIZE * SIZE, 4), np.float32)
    index = np.arange(SIZE * SIZE)
    for channel, multiplier in enumerate([1, 613, 1019]):
        values[:, channel] = ((index * multiplier) % 2048) / np.float32(1024) - .5
    image.pixels.foreach_set(values.ravel())
    image.update()
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
    return texture.outputs['Color']


def make_material(case):
    material = bpy.data.materials.new('Native Noise ' + case['id'])
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission
    if case['stage'] == 'constant':
        source = tree.nodes.new('ShaderNodeCombineXYZ')
        for index, value in enumerate([.173, -.375, .625]): source.inputs[index].default_value = value
        incoming = source.outputs[0]
    else:
        incoming = exact_inputs(tree)
    if case['kind'] == 'image-control':
        factor, bias = .25, .5
        raw = incoming
    else:
        node = tree.nodes.new('ShaderNodeTexNoise')
        node.noise_type = case.get('type', 'FBM')
        node.normalize = case.get('normalize', False)
        node.noise_dimensions = case['dimensions']
        for key, default in [('Scale', 1), ('Detail', 2), ('Roughness', .5), ('Lacunarity', 2), ('Distortion', 0), ('Offset', 0), ('Gain', 1)]:
            socket = node.inputs.get(key)
            if socket is not None: socket.default_value = case.get(key, default)
        if 'roughnessLinked' in case:
            roughness = tree.nodes.new('ShaderNodeValue')
            roughness.outputs[0].default_value = case['roughnessLinked']
            tree.links.new(roughness.outputs[0], node.inputs['Roughness'])
        components = tree.nodes.new('ShaderNodeSeparateXYZ')
        tree.links.new(incoming, components.inputs[0])
        if case['dimensions'] != '1D': tree.links.new(incoming, node.inputs['Vector'])
        if case['dimensions'] in {'1D', '4D'}:
            w = tree.nodes.new('ShaderNodeMath')
            w.operation = 'MULTIPLY_ADD'
            w.inputs[1].default_value = .5
            w.inputs[2].default_value = .125
            tree.links.new(components.outputs[1], w.inputs[0])
            tree.links.new(w.outputs[0], node.inputs['W'])
        raw = node.outputs[case['output']]
        factor, bias = case.get('oracleScale', .0625), .5
    affine = tree.nodes.new('ShaderNodeVectorMath')
    affine.operation = 'MULTIPLY_ADD'
    affine.inputs[1].default_value = (factor,) * 3
    affine.inputs[2].default_value = (bias,) * 3
    tree.links.new(raw, affine.inputs[0])
    tree.links.new(affine.outputs[0], emission.inputs['Color'])
    return material, emission


def native_pixels(material, temporary, label):
    proxy.data.materials.clear()
    proxy.data.materials.append(material)
    if scene.render.engine == 'CYCLES':
        result = bakelib.bake_channel_field_pixels([proxy], size=SIZE, margin_px=0,
            uv_layer='BLENDLINK_TILE_BAKE', label=label, allow_hdr=True)
        return np.asarray(result['pixels'], np.float32).reshape(SIZE, SIZE, 3)
    scene.render.filepath = str(Path(temporary) / 'native.exr')
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(scene.render.filepath, check_existing=False)
    raw = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., :3]
    bpy.data.images.remove(image)
    return raw


def add_residual_control(material, emission, coarse, scale):
    # The native half target supplies a coarse baseline only. Reevaluate the
    # same native noise subgraph after subtracting that baseline, so final
    # target quantization cannot hide shader-kernel arithmetic discrepancies.
    baseline = (coarse - np.float32(.5)) / np.float32(scale)
    assert np.array_equal(baseline, baseline.astype(np.float16).astype(np.float32))
    tree = material.node_tree
    image = bpy.data.images.new('Exact Noise residual baseline', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    values = np.ones((SIZE, SIZE, 4), np.float32)
    values[..., :3] = baseline
    image.pixels.foreach_set(values.ravel())
    image.update()
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Closest'
    coordinates = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
    affine = emission.inputs['Color'].links[0].from_node
    raw = affine.inputs[0].links[0].from_socket
    subtract = tree.nodes.new('ShaderNodeVectorMath')
    subtract.operation = 'SUBTRACT'
    tree.links.new(raw, subtract.inputs[0])
    tree.links.new(texture.outputs['Color'], subtract.inputs[1])
    tree.links.new(subtract.outputs[0], affine.inputs[0])
    affine.inputs[1].default_value = (16,) * 3


records = []
parameters = [
    {'Detail': 0, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1},
    {'Detail': .5, 'Roughness': .7, 'Lacunarity': 1.7, 'Scale': 1},
    {'Detail': 2, 'Roughness': 0, 'Lacunarity': 0, 'Scale': 4},
    {'Detail': 2.5, 'Roughness': .7, 'Lacunarity': -2, 'Scale': 1},
    {'Detail': 6, 'Roughness': 1, 'Lacunarity': 2, 'Scale': 40},
    {'Detail': 6, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 80},
    {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Distortion': -1},
    {'Detail': 2, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1, 'Distortion': 1},
    {'Detail': -.5, 'Roughness': .5, 'Lacunarity': 2, 'Scale': 1},
    {'Detail': 2.5, 'roughnessLinked': -.5, 'Lacunarity': 2, 'Scale': 1},
]
with tempfile.TemporaryDirectory(prefix='blendlink-native-noise-') as temporary:
    only = os.environ.get('BLENDLINK_NOISE_ENGINE')
    for engine in ([only] if only else ['CYCLES', EEVEE]):
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        cases = [{'id': engine.lower() + '-constant-' + str(i), 'kind': 'constant', 'value': value}
                 for i, value in enumerate([[.1234567, 1.234567, 5.413859], [.3333333, 2.003, 12.3456]])]
        cases.append({'id': engine.lower() + '-image-control', 'kind': 'image-control', 'stage': 'image'})
        for dimension in ['1D', '2D', '3D', '4D']:
            for output in ['Fac', 'Color']:
                for stage in ['constant', 'image']:
                    for index, settings in enumerate(parameters):
                        cases.append({'id': f'{engine.lower()}-fbm-raw-{dimension.lower()}-{output.lower()}-{stage}-{index}',
                                      'kind': 'noise', 'dimensions': dimension, 'output': output, 'stage': stage,
                                      'oracleScale': .0625, **settings})
        if engine != 'CYCLES':
            for dimension in ['1D', '2D', '3D', '4D']:
                for stage in ['constant', 'image']:
                    cases.append({'id': f'{engine.lower()}-fbm-residual-{dimension.lower()}-{stage}',
                                  'kind': 'noise', 'dimensions': dimension, 'output': 'Color', 'stage': stage,
                                  'oracleScale': .0625, 'residual': True, **parameters[4]})
        if os.environ.get('BLENDLINK_NOISE_RESIDUAL_ONLY'):
            cases = [case for case in cases if case['kind'] in {'constant', 'image-control'} or case.get('residual')]
        for case in cases:
            material, emission = make_material(case)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            if case.get('residual'):
                coarse = native_pixels(material, temporary, case['id'] + '-coarse')
                add_residual_control(material, emission, coarse, case['oracleScale'])
                case['oracleScale'] = 16
            before = (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            document = tsl_ir.emit_channel(emission.inputs['Color'])
            if case['kind'] == 'noise':
                def collect(value):
                    if isinstance(value, dict):
                        return ([value] if value.get('op') == 'noise_fractal' else []) + [item for child in value.values() for item in collect(child)]
                    if isinstance(value, list): return [item for child in value for item in collect(child)]
                    return []
                expressions = collect(document)
                assert expressions and all(expression['normalize'] is False for expression in expressions), case['id']
                expected_model = 'shader-mf' if bpy.app.version >= (5, 0, 0) and case['stage'] == 'constant' else 'shader'
                assert all(expression['evaluationModel'] == expected_model for expression in expressions), case['id']
                case['evaluationModel'] = expected_model
            assert before == (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            (OUTPUT / 'ir' / (case['id'] + '.json')).write_text(json.dumps(document))
            raw = native_pixels(material, temporary, case['id'])
            pixels = raw if case.get('stage') == 'image' else np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1))
            assert np.isfinite(pixels).all(), case['id']
            pixels.astype('<f4').tofile(OUTPUT / (case['id'] + '.f32'))
            case.update(engine=engine, minimum=pixels.min(axis=(0, 1)).tolist(), maximum=pixels.max(axis=(0, 1)).tolist())
            records.append(case)
            bpy.data.materials.remove(material, do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Exact Noise') and not image.users: bpy.data.images.remove(image)
(OUTPUT / 'index.json').write_text(json.dumps({'blender': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(),
    'gpuBackend': bpy.context.preferences.system.gpu_backend, 'cyclesDevice': 'CPU', 'size': SIZE, 'cases': records,
    'nativeModuleHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(native).iterdir()
                           if path.suffix in {'.py', '.json'}} if native else {}}, indent=2))
print('BLENDLINK_NOISE_REFERENCES_PASSED ' + str(len(records)))
