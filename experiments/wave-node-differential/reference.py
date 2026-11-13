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
native = os.environ.get('BLENDLINK_WAVE_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ['BLENDLINK_WAVE_REFERENCES']).resolve()
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
camera_data = bpy.data.cameras.new('Wave Reference Camera')
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
    image = bpy.data.images.new('Exact Wave inputs', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
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
    material = bpy.data.materials.new('Native Wave ' + case['id'])
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    output = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], output.inputs['Surface'])
    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission
    source = exact_inputs(tree)
    if case['kind'] == 'image-control':
        affine = tree.nodes.new('ShaderNodeVectorMath')
        affine.operation = 'MULTIPLY_ADD'
        affine.inputs[1].default_value = (.25,) * 3
        affine.inputs[2].default_value = (.5,) * 3
        tree.links.new(source, affine.inputs[0])
        tree.links.new(affine.outputs[0], emission.inputs['Color'])
        return material, emission
    node = tree.nodes.new('ShaderNodeTexWave')
    node.wave_type = case['waveType']
    if node.wave_type == 'BANDS': node.bands_direction = case['direction']
    else: node.rings_direction = case['direction']
    node.wave_profile = case['profile']
    node.inputs['Scale'].default_value = .25
    node.inputs['Detail'].default_value = case['detail']
    node.inputs['Detail Roughness'].default_value = case['roughness']
    node.inputs['Detail Scale'].default_value = case.get('detailScale', 1)
    node.inputs['Phase Offset'].default_value = .375
    node.inputs['Distortion'].default_value = case.get('distortion', 1)
    tree.links.new(source, node.inputs['Vector'])
    if case.get('linked', True):
        components = tree.nodes.new('ShaderNodeSeparateXYZ')
        tree.links.new(source, components.inputs[0])
        tree.links.new(components.outputs[1], node.inputs['Distortion'])
        if case.get('liveKnobs'):
            tree.links.new(components.outputs[2], node.inputs['Scale'])
            tree.links.new(components.outputs[0], node.inputs['Phase Offset'])
            tree.links.new(components.outputs[1], node.inputs['Detail Scale'])
        if case.get('liveRoughness'):
            bounded = tree.nodes.new('ShaderNodeClamp')
            bounded.clamp_type = case.get('clampMode', 'MINMAX')
            tree.links.new(components.outputs[2], bounded.inputs['Value'])
            tree.links.new(bounded.outputs[0], node.inputs['Detail Roughness'])
    tree.links.new(node.outputs[case.get('output', 'Fac')], emission.inputs['Color'])
    return material, emission


records = []
with tempfile.TemporaryDirectory(prefix='blendlink-native-wave-') as temporary:
    only = os.environ.get('BLENDLINK_WAVE_ENGINE')
    for engine in ([only] if only else ['CYCLES', EEVEE]):
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        cases = [{'id': engine.lower() + '-constant-' + str(i), 'kind': 'constant', 'value': value}
                 for i, value in enumerate([[.1234567, 1.234567, 5.413859], [.3333333, 2.003, 12.3456]])]
        cases.append({'id': engine.lower() + '-image-control', 'kind': 'image-control'})
        for wave_type, directions in [('BANDS', ['X', 'Y', 'Z', 'DIAGONAL']), ('RINGS', ['X', 'Y', 'Z', 'SPHERICAL'])]:
            for direction in directions:
                for profile in ['SIN', 'SAW', 'TRI']:
                    index = len(cases)
                    cases.append({'id': f'{engine.lower()}-{wave_type.lower()}-{direction.lower()}-{profile.lower()}',
                                  'kind': 'wave', 'waveType': wave_type, 'direction': direction, 'profile': profile,
                                  'detail': [0, 1, 1.5, 2][index % 4], 'roughness': [0, .5, 1][index % 3],
                                  'detailScale': [0, .25, 1, 2][index % 4], 'output': 'Color' if index % 2 else 'Fac'})
        for profile in ['SIN', 'SAW', 'TRI']:
            for distortion in [-1, 0, 1.5]:
                cases.append({'id': f'{engine.lower()}-static-{profile.lower()}-{str(distortion).replace("-", "neg").replace(".", "_")}',
                              'kind': 'wave', 'waveType': 'BANDS', 'direction': 'DIAGONAL', 'profile': profile,
                              'detail': 1.5, 'roughness': .7, 'linked': False, 'distortion': distortion})
            cases.append({'id': f'{engine.lower()}-live-knobs-{profile.lower()}', 'kind': 'wave',
                          'waveType': 'RINGS', 'direction': 'SPHERICAL', 'profile': profile,
                          'detail': 2, 'roughness': .5, 'liveKnobs': True})
            for detail in [0, .5, 1, 1.5, 2]:
                cases.append({'id': f'{engine.lower()}-live-roughness-{profile.lower()}-{str(detail).replace(".", "_")}',
                              'kind': 'wave', 'waveType': 'BANDS', 'direction': 'DIAGONAL', 'profile': profile,
                              'detail': detail, 'roughness': .5, 'liveRoughness': True,
                              'clampMode': 'RANGE' if detail == 1.5 else 'MINMAX'})
        for case in cases:
            material, emission = make_material(case)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            before = (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            document = tsl_ir.emit_channel(emission.inputs['Color'])
            assert before == (len(bpy.data.materials), len(bpy.data.node_groups), len(material.node_tree.nodes))
            (OUTPUT / 'ir' / (case['id'] + '.json')).write_text(json.dumps(document))
            if engine == 'CYCLES':
                result = bakelib.bake_channel_field_pixels([proxy], size=SIZE, margin_px=0,
                    uv_layer='BLENDLINK_TILE_BAKE', label=case['id'], allow_hdr=True)
                raw = np.asarray(result['pixels'], np.float32).reshape(SIZE, SIZE, 3)
            else:
                scene.render.filepath = str(Path(temporary) / 'native.exr')
                bpy.ops.render.render(write_still=True)
                image = bpy.data.images.load(scene.render.filepath, check_existing=False)
                raw = np.asarray(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[..., :3]
                bpy.data.images.remove(image)
            pixels = np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1)) if case['kind'] == 'constant' else raw
            assert np.isfinite(pixels).all(), case['id']
            pixels.astype('<f4').tofile(OUTPUT / (case['id'] + '.f32'))
            case.update(engine=engine, minimum=pixels.min(axis=(0, 1)).tolist(), maximum=pixels.max(axis=(0, 1)).tolist())
            records.append(case)
            bpy.data.materials.remove(material, do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Exact Wave inputs') and not image.users: bpy.data.images.remove(image)
(OUTPUT / 'index.json').write_text(json.dumps({'blender': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(),
    'gpuBackend': bpy.context.preferences.system.gpu_backend, 'cyclesDevice': 'CPU', 'size': SIZE, 'cases': records,
    'nativeModuleHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(native).iterdir()
                           if path.suffix in {'.py', '.json'}} if native else {}}, indent=2))
print('BLENDLINK_WAVE_REFERENCES_PASSED ' + str(len(records)))
