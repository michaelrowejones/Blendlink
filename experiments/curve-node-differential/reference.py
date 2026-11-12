# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material Curve Mapping pixels; the native node is the numeric oracle."""
import json
import hashlib
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native = os.environ.get('BLENDLINK_CURVE_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ['BLENDLINK_CURVE_REFERENCES']).resolve()
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
camera_data = bpy.data.cameras.new('Curve Reference Camera')
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


def configure_curve(node, style):
    mapping = node.mapping
    mapping.use_clip = False
    mapping.clip_min_x, mapping.clip_max_x = 0, 1
    mapping.clip_min_y, mapping.clip_max_y = 0, 1
    mapping.extend = 'HORIZONTAL' if style == 'horizontal' else 'EXTRAPOLATED'
    mapping.tone = 'FILMLIKE' if style == 'filmlike' else 'STANDARD'
    low, high = (2, 4) if style == 'nonunit' else (0, 1)
    if style == 'nonunit':
        mapping.clip_min_x, mapping.clip_max_x = 2, 4
        mapping.clip_min_y, mapping.clip_max_y = -2, 5
    if style == 'clip-y':
        mapping.clip_min_y, mapping.clip_max_y = .2, .6
    for index, curve in enumerate(mapping.curves):
        channel_identity = style in {'identity', 'combined-only'} and index < 3
        curve.points[0].location = (low, low if style == 'nonunit' else 0)
        curve.points[-1].location = (high, high if style == 'nonunit' else 1)
        if not channel_identity:
            px, py = [(.31, .69), (.63, .27), (.47, .78), (.42, .23)][index]
            curve.points.new(low + (high - low) * px, low + (high - low) * py if style == 'nonunit' else py)
        if style == 'unclipped':
            curve.points[0].location = (-.5, -.3 - .1 * index)
            curve.points[-1].location = (1.5, 1.4 + .1 * index)
        if style == 'asymmetric':
            curve.points[0].location = (-.2 * index, -.1 * index)
            curve.points[-1].location = (1 + .3 * index, 1 + .2 * index)
        for point in curve.points:
            point.select = False
    if style == 'black-white':
        mapping.black_level = (.12, .2, .3)
        mapping.white_level = (.72, 1.3, 1.7)
    mapping.use_clip = style not in {'unclipped', 'nonunit', 'asymmetric'}
    mapping.update()


def curve_state(node):
    mapping = node.mapping
    return [mapping.use_clip, mapping.extend, mapping.tone,
            *[float(getattr(mapping, key)) for key in ['clip_min_x', 'clip_max_x', 'clip_min_y', 'clip_max_y']],
            [[list(point.location) + [point.handle_type, point.select] for point in curve.points] for curve in mapping.curves]]


def material_for(case):
    material = bpy.data.materials.new('Native Curve ' + case['id'])
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    sink = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], sink.inputs['Surface'])
    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission, None
    if case['kind'] == 'image-control':
        node = None
    else:
        node = tree.nodes.new({'float': 'ShaderNodeFloatCurve', 'vector': 'ShaderNodeVectorCurve', 'rgb': 'ShaderNodeRGBCurve'}[case['kind']])
        configure_curve(node, case['style'])
    scalar = case['kind'] == 'float'
    input_socket = next((item for item in node.inputs if item.identifier == ('Value' if scalar else 'Vector' if case['kind'] == 'vector' else 'Color')), None) if node else None
    if node:
        factor_socket = next(item for item in node.inputs if item.identifier in {'Fac', 'Factor'})
        factor = tree.nodes.new('ShaderNodeValue')
        factor.outputs[0].default_value = case['factor']
        tree.links.new(factor.outputs[0], factor_socket)
    if case['stage'] == 'image':
        image = bpy.data.images.new('Curve exact input coordinates', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
        image.colorspace_settings.name = 'Non-Color'
        pixels = np.ones((SIZE * SIZE, 4), np.float32)
        index = np.arange(SIZE * SIZE)
        for channel, multiplier in enumerate([1, 613, 1019]):
            pixels[:, channel] = ((index * multiplier) % 2048) / np.float32(1024) - .5
        image.pixels.foreach_set(pixels.ravel())
        image.update()
        source = tree.nodes.new('ShaderNodeTexImage')
        source.image = image
        source.interpolation = 'Closest'
        coord = tree.nodes.new('ShaderNodeTexCoord')
        tree.links.new(coord.outputs['UV'], source.inputs['Vector'])
        output = source.outputs['Color']
        if scalar:
            separate = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(output, separate.inputs[0])
            output = separate.outputs[0]
        if node: tree.links.new(output, input_socket)
    elif case['stage'] == 'shader':
        source = tree.nodes.new('ShaderNodeAttribute')
        source.attribute_type = 'OBJECT'
        source.attribute_name = 'curve_input'
        proxy['curve_input'] = case['value'][0] if scalar else case['value']
        tree.links.new(source.outputs['Fac' if scalar else 'Color'], input_socket)
        if case.get('linkedFactor'):
            proxy['curve_factor'] = case['factor']
            factor_source = tree.nodes.new('ShaderNodeAttribute')
            factor_source.attribute_type = 'OBJECT'
            factor_source.attribute_name = 'curve_factor'
            tree.links.new(factor_source.outputs['Fac'], factor_socket)
    elif scalar:
        source = tree.nodes.new('ShaderNodeValue')
        source.outputs[0].default_value = case['value'][0]
        tree.links.new(source.outputs[0], input_socket)
    else:
        source = tree.nodes.new('ShaderNodeCombineXYZ')
        for index in range(3): source.inputs[index].default_value = case['value'][index]
        tree.links.new(source.outputs[0], input_socket)
    if case.get('nested'):
        previous = tree.nodes.new(node.bl_idname)
        configure_curve(previous, 'shape')
        previous_input = next(item for item in previous.inputs if item.identifier == input_socket.identifier)
        tree.links.new(input_socket.links[0].from_socket, previous_input)
        tree.links.new(previous.outputs[0], input_socket)
    if scalar:
        affine = tree.nodes.new('ShaderNodeMath')
        affine.operation = 'MULTIPLY_ADD'
        affine.inputs[1].default_value = .08
        affine.inputs[2].default_value = .5
    else:
        affine = tree.nodes.new('ShaderNodeVectorMath')
        affine.operation = 'MULTIPLY_ADD'
        affine.inputs[1].default_value = (.08,) * 3
        affine.inputs[2].default_value = (.5,) * 3
    tree.links.new(node.outputs[0] if node else output, affine.inputs[0])
    tree.links.new(affine.outputs[0], emission.inputs['Color'])
    return material, emission, node


specs = [('shape', [.173, .487, .819], 1), ('shape', [-.7, -.3, -.1], 1),
         ('shape', [1.1, 1.6, 2.0], 1), ('shape', [.173, .487, .819], 0),
         ('shape', [.173, .487, .819], .35), ('shape', [.173, .487, .819], -.5),
         ('shape', [.173, .487, .819], 1.5), ('horizontal', [-.7, .4, 1.7], 1),
         ('unclipped', [-.8, .2, 1.8], 1), ('clip-y', [.1, .4, .9], 1),
         ('nonunit', [1.5, 2.7, 4.3], 1), ('asymmetric', [-.3, .4, 1.8], 1),
         ('identity', [-.3, .39123, 1.7], 1)]
records = []
only = os.environ.get('BLENDLINK_CURVE_ENGINE')
with tempfile.TemporaryDirectory(prefix='blendlink-native-curves-') as temporary:
    for engine in ([only] if only else ['CYCLES', EEVEE]):
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        controls = [[.25, .5, .75]] if engine == 'CYCLES' else [[.1234567, 1.234567, 5.413859], [.3333333, 2.003, 12.3456]]
        cases = [{'id': engine.lower() + '-constant-' + str(i), 'kind': 'constant', 'value': value} for i, value in enumerate(controls)]
        cases.append({'id': engine.lower() + '-image-control', 'kind': 'image-control', 'stage': 'image'})
        for kind in ['float', 'vector', 'rgb']:
            selected = specs + ([('combined-only', [.173, .487, .819], 1), ('filmlike', [.173, .487, .819], .35),
                                 ('black-white', [.173, .487, .819], 1)] if kind == 'rgb' else [])
            for stage in ['constant', 'shader']:
                for i, (style, value, factor) in enumerate(selected):
                    cases.append({'id': f'{engine.lower()}-{kind}-{stage}-{style}-{i}', 'kind': kind,
                                  'stage': stage, 'style': style, 'value': value, 'factor': factor,
                                  'linkedFactor': stage == 'shader' and i == 4})
            cases.append({'id': f'{engine.lower()}-{kind}-dense-image', 'kind': kind, 'stage': 'image', 'style': 'shape', 'factor': .73})
            for stage in ['constant', 'shader']:
                cases.append({'id': f'{engine.lower()}-{kind}-nested-{stage}', 'kind': kind, 'stage': stage,
                              'style': 'shape', 'factor': .67, 'value': [.173, .487, .819], 'nested': True})
        for case in cases:
            material, emission, node = material_for(case)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            state = curve_state(node) if node else None
            groups = len(bpy.data.node_groups)
            document = tsl_ir.emit_channel(emission.inputs['Color'])
            def collect(value):
                if isinstance(value, dict):
                    return ([value] if value.get('op') == 'curve_native' else []) + [item for child in value.values() for item in collect(child)]
                if isinstance(value, list): return [item for child in value for item in collect(child)]
                return []
            expressions = collect(document)
            if node:
                expected_model = ('shader-mf' if bpy.app.version >= (5, 0, 0) and case['stage'] == 'constant'
                                  else 'cycles' if engine == 'CYCLES' else 'eevee-gpu')
                assert all(item['model'] == expected_model for item in expressions), [item['model'] for item in expressions]
                assert len(expressions) == (2 if case.get('nested') else 1)
                case['sourceModel'] = expected_model
            assert not node or state == curve_state(node), 'Emission mutated authored Curve Mapping'
            assert groups == len(bpy.data.node_groups), 'Emission leaked temporary node-tree IDs'
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
            pixels = raw if case.get('stage') == 'image' else np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1))
            assert np.isfinite(pixels).all(), case['id']
            pixels.astype('<f4').tofile(OUTPUT / (case['id'] + '.f32'))
            case['engine'] = engine
            case['minimum'] = pixels.min(axis=(0, 1)).tolist()
            case['maximum'] = pixels.max(axis=(0, 1)).tolist()
            if node:
                case['objectAttributes'] = {'curve_input': [case['value'][0]] * 3 if case['kind'] == 'float' else case['value'],
                                            'curve_factor': [case['factor']] * 3} if case['stage'] == 'shader' else None
            records.append(case)
            bpy.data.materials.remove(material, do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Curve exact input coordinates') and not image.users:
                    bpy.data.images.remove(image)
(OUTPUT / 'index.json').write_text(json.dumps({'blender': bpy.app.version_string,
    'buildHash': bpy.app.build_hash.decode(), 'gpuBackend': bpy.context.preferences.system.gpu_backend,
    'cyclesDevice': 'CPU', 'size': SIZE, 'cases': records,
    'nativeModuleHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in Path(native).iterdir() if path.suffix in {'.py', '.json'}} if native else {}}, indent=2))
print('BLENDLINK_CURVE_REFERENCES_PASSED ' + str(len(records)))
