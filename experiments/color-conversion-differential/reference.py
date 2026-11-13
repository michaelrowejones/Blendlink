# SPDX-License-Identifier: GPL-3.0-or-later
"""Native material color conversion pixels; the native node is the numeric oracle."""
import json
import platform
import hashlib
import os
import sys
import tempfile
from pathlib import Path
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
native = os.environ.get('BLENDLINK_COLOR_NATIVE_MODULES')
sys.path.insert(0, native or str(ROOT / 'packages/blender-addon'))
sys.path.insert(0, native or str(ROOT / 'packages/blendlink/blender'))
import bakelib
import tsl_ir

OUTPUT = Path(os.environ['BLENDLINK_COLOR_REFERENCES']).resolve()
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
camera_data = bpy.data.cameras.new('Color Reference Camera')
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



def exact_image(tree, unit, value=None):
    image = bpy.data.images.new('Exact color-conversion inputs', width=SIZE, height=SIZE, alpha=True, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'
    pixels = np.ones((SIZE * SIZE, 4), np.float32)
    index = np.arange(SIZE * SIZE)
    for channel, multiplier in enumerate([1, 613, 1019]):
        pixels[:, channel] = value[channel] if value else ((index * multiplier) % 2048) / np.float32(2048 if unit else 1024) - (0 if unit else .5)
    image.pixels.foreach_set(pixels.ravel())
    image.update()
    source = tree.nodes.new('ShaderNodeTexImage')
    source.image = image
    source.interpolation = 'Closest'
    coord = tree.nodes.new('ShaderNodeTexCoord')
    tree.links.new(coord.outputs['UV'], source.inputs['Vector'])
    return source.outputs['Color']


def source_qualified_noise_refusal(engine, uses_noise, reason, source_profile):
    """Accept only the declared unmeasured Cycles child-profile refusal."""
    expected = ('Normalized Noise has no verified live source precision profile for '
                'CYCLES on ' + sys.platform + '/' + platform.machine()
                + '; use source baking for this Cycles profile')
    return engine == 'CYCLES' and uses_noise and source_profile is None and reason == expected


def make_material(case):
    material = bpy.data.materials.new('Native Color ' + case['id'])
    tree = bakelib.ensure_shader_node_tree(material)
    tree.nodes.clear()
    sink = tree.nodes.new('ShaderNodeOutputMaterial')
    emission = tree.nodes.new('ShaderNodeEmission')
    tree.links.new(emission.outputs[0], sink.inputs['Surface'])
    if case['kind'] == 'constant':
        emission.inputs['Color'].default_value = (*case['value'], 1)
        return material, emission
    if case['stage'] == 'uv':
        source = tree.nodes.new('ShaderNodeTexCoord')
        incoming = source.outputs['UV']
    elif case['stage'] == 'image':
        incoming = exact_image(tree, case.get('unit', False))
    elif case['stage'] == 'texture':
        incoming = exact_image(tree, True, case['value'])
    elif case['stage'] == 'attribute':
        source = tree.nodes.new('ShaderNodeAttribute')
        source.attribute_type = 'OBJECT'
        source.attribute_name = 'color_input'
        proxy['color_input'] = case['value']
        incoming = source.outputs['Color']
    elif case.get('scalar'):
        source = tree.nodes.new('ShaderNodeValue')
        source.outputs[0].default_value = case['value'][0]
        incoming = source.outputs[0]
    elif 'alpha' in case:
        source = tree.nodes.new('ShaderNodeRGB')
        source.outputs[0].default_value = (*case['value'], case['alpha'])
        incoming = source.outputs[0]
    else:
        source = tree.nodes.new('ShaderNodeCombineXYZ')
        for index in range(3): source.inputs[index].default_value = case['value'][index]
        incoming = source.outputs[0]
    if case.get('composition'):
        composition = case['composition']
        if composition == 'noise':
            bounded = tree.nodes.new('ShaderNodeTexNoise')
            bounded.inputs['Scale'].default_value = 1
            bounded.inputs['Detail'].default_value = 0
            tree.links.new(incoming, bounded.inputs['Vector'])
            # Normalize does not prove RGB stays in [0,1]. This graph
            # intentionally authors a color clamp before its HSL consumer.
            clamp = tree.nodes.new('ShaderNodeMixRGB')
            clamp.blend_type = 'MIX'; clamp.use_clamp = True
            clamp.inputs['Fac'].default_value = 0
            tree.links.new(bounded.outputs['Color'], clamp.inputs['Color1'])
            incoming = clamp.outputs['Color']
        elif composition in {'ramp-linear', 'ramp-cardinal'}:
            bounded = tree.nodes.new('ShaderNodeValToRGB')
            bounded.color_ramp.interpolation = 'LINEAR' if composition == 'ramp-linear' else 'CARDINAL'
            bounded.color_ramp.elements[0].color = (.1, .2, .8, 1)
            bounded.color_ramp.elements[1].color = (.8, .2, .1, 1)
            if composition == 'ramp-cardinal':
                bounded.color_ramp.elements.new(.2).color = (.9, .7, .2, 1)
                bounded.color_ramp.elements.new(.8).color = (.7, .3, .9, 1)
            component = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(incoming, component.inputs[0])
            tree.links.new(component.outputs[0], bounded.inputs['Fac'])
            incoming = bounded.outputs['Color']
        else:
            bounded = tree.nodes.new('ShaderNodeMixRGB')
            bounded.blend_type = 'ADD'
            bounded.use_clamp = True
            bounded.inputs['Color1'].default_value = (.2, .8, .3, 1)
            bounded.inputs['Color2'].default_value = (.6, .3, .4, 1)
            component = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(incoming, component.inputs[0])
            tree.links.new(component.outputs[0], bounded.inputs['Fac'])
            incoming = bounded.outputs[0]
    if case['kind'] == 'ramp':
        ramp = tree.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.color_mode = case['mode']
        ramp.color_ramp.interpolation = case['interpolation']
        ramp.color_ramp.hue_interpolation = case.get('hue', 'NEAR')
        if 'alphaDefault' in case: ramp.outputs['Alpha'].default_value = case['alphaDefault']
        palette = [(.9, .08, .15, .1), (.8, .6, .1, .4), (.1, .7, .8, .7), (.4, .1, .9, .9)]
        ramp.color_ramp.elements[0].color = palette[0]
        ramp.color_ramp.elements[1].color = palette[-1]
        if case.get('hidden'):
            ramp.color_ramp.elements[0].position = .15
            ramp.color_ramp.elements[1].position = .85
        if case.get('count', 4) == 4:
            for position, color in zip([.2, .8], palette[1:3]): ramp.color_ramp.elements.new(position).color = color
        if case.get('count') == 1: ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
        if case.get('hidden') == 'reverse': ramp.color_ramp.elements[0].position = .95
        if case.get('hidden') == 'coincident': ramp.color_ramp.elements[0].position = .85
        if case.get('tinySpan'):
            ramp.color_ramp.elements[1].position = 1e-10
        if case['stage'] == 'constant':
            factor = tree.nodes.new('ShaderNodeValue')
            factor.outputs[0].default_value = case['factor']
            factor_output = factor.outputs[0]
            if case.get('tinySpan'):
                factor.outputs[0].default_value = 3e-11
                addition = tree.nodes.new('ShaderNodeMath')
                addition.operation = 'ADD'
                tree.links.new(factor_output, addition.inputs[0])
                addition.inputs[1].default_value = 2e-11
                factor_output = addition.outputs[0]
        else:
            factor = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(incoming, factor.inputs[0])
            factor_output = factor.outputs[0]
        tree.links.new(factor_output, ramp.inputs['Fac'])
        incoming = ramp.outputs[case['output']]
    elif case['kind'] != 'image-control':
        conversion = tree.nodes.new('ShaderNodeCombineColor' if case['direction'] == 'combine' else 'ShaderNodeSeparateColor')
        conversion.mode = case['mode']
        if case['direction'] == 'combine':
            components = tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(incoming, components.inputs[0])
            for index in range(3): tree.links.new(components.outputs[index], conversion.inputs[index])
            incoming = conversion.outputs[0]
        else:
            tree.links.new(incoming, conversion.inputs[0])
            components = tree.nodes.new('ShaderNodeCombineXYZ')
            for index in range(3): tree.links.new(conversion.outputs[index], components.inputs[index])
            incoming = components.outputs[0]
    if case.get('consumer'):
        if case['consumer'] == 'blackbody':
            consumer = tree.nodes.new('ShaderNodeBlackbody')
        else:
            consumer = tree.nodes.new('ShaderNodeFloatCurve')
            consumer.mapping.curves[0].points.new(.37, .75)
            consumer.mapping.update()
        tree.links.new(incoming, consumer.inputs['Temperature' if case['consumer'] == 'blackbody' else 'Value'])
        incoming = consumer.outputs[0]
    affine = tree.nodes.new('ShaderNodeVectorMath')
    affine.operation = 'MULTIPLY_ADD'
    affine.inputs[1].default_value = (.02,) * 3
    affine.inputs[2].default_value = (.5,) * 3
    if case.get('stage') == 'image' and case.get('mode') == 'HSV' and case.get('direction') == 'separate':
        # Signed HSV saturation grows near max(RGB)=0. Keep Hue strongly
        # encoded while carrying that finite signed range above zero.
        affine.inputs[1].default_value = (.2, .0001, .02)
        affine.inputs[2].default_value = (.2, .5, .5)
    tree.links.new(incoming, affine.inputs[0])
    tree.links.new(affine.outputs[0], emission.inputs['Color'])
    return material, emission


combine_values = [[0, 0, 0], [.2, .5, .7], [.6, 1, 1], [1, 1, .5], [-.2, .7, .8], [1.2, .7, .8],
                  [2, .4, 1.2], [.2, -.4, .7], [.2, 1.4, .7], [.2, .5, -.5], [.2, .5, 1.4], [.9, 3, .5]]
separate_values = [[0, 0, 0], [.5, .5, .5], [1, 1, 1], [.9, .3, .2], [.3, .9, .2], [.3, .2, .9],
                   [-.2, -.5, -.9], [1.4, .3, .8], [.2, .7, 1.5], [2, 1, 3], [0, -.5, -1],
                   [1.0002, .9997, 1.0001], [.25, .375, .5]]
records, refusals = [], []
with tempfile.TemporaryDirectory(prefix='blendlink-native-color-conversion-') as temporary:
    for engine in ['CYCLES', EEVEE]:
        scene.render.engine = engine
        if engine != 'CYCLES': scene.eevee.taa_render_samples = 1
        controls = [[.25, .5, .75]] if engine == 'CYCLES' else [[.1234567, 1.234567, 5.413859], [.3333333, 2.003, 12.3456]]
        cases = [{'id': engine.lower() + '-constant-' + str(i), 'kind': 'constant', 'value': value} for i, value in enumerate(controls)]
        cases += [{'id': engine.lower() + '-image-control-' + str(unit), 'kind': 'image-control', 'stage': 'image', 'unit': unit} for unit in [False, True]]
        for mode in ['RGB', 'HSV', 'HSL']:
            for value in [-1, 2]:
                cases.append({'id': f'{engine.lower()}-{mode.lower()}-scalar-{value}', 'kind': 'conversion',
                              'mode': mode, 'direction': 'separate', 'stage': 'constant', 'value': [value] * 3, 'scalar': True})
            for direction, values in [('combine', combine_values), ('separate', separate_values)]:
                for index, value in enumerate(values):
                    for stage in ['constant', 'attribute']:
                        if mode == 'HSL' and direction == 'separate' and stage == 'attribute':
                            if not all(0 <= item <= 1 for item in value): continue
                            stage = 'texture'
                        cases.append({'id': f'{engine.lower()}-{mode.lower()}-{direction}-{stage}-{index}', 'kind': 'conversion',
                                      'mode': mode, 'direction': direction, 'stage': stage, 'value': value})
                cases.append({'id': f'{engine.lower()}-{mode.lower()}-{direction}-dense', 'kind': 'conversion',
                              'mode': mode, 'direction': direction, 'stage': 'image', 'unit': direction == 'separate' and mode == 'HSL'})
            for alpha in [0, .25, .75, 1]:
                cases.append({'id': f'{engine.lower()}-{mode.lower()}-source-alpha-{alpha}', 'kind': 'conversion', 'mode': mode,
                              'direction': 'separate', 'stage': 'constant', 'value': [.2, .4, .7], 'alpha': alpha})
        for composition in ['noise', 'ramp-linear', 'ramp-cardinal', 'clamped-add']:
            cases.append({'id': f'{engine.lower()}-hsl-composed-{composition}', 'kind': 'conversion', 'mode': 'HSL',
                          'direction': 'separate', 'stage': 'image', 'unit': True, 'composition': composition})
        for consumer, value in [('blackbody', 6400), ('float-curve', -.3)]:
            cases.append({'id': f'{engine.lower()}-rgb-constant-consumed-{consumer}', 'kind': 'conversion', 'mode': 'RGB',
                          'direction': 'combine', 'stage': 'constant', 'value': [value] * 3, 'consumer': consumer})
        for mode in ['RGB', 'HSV', 'HSL']:
            for interpolation in ['LINEAR', 'CONSTANT', 'EASE', 'B_SPLINE', 'CARDINAL']:
                hues = ['NEAR', 'FAR', 'CW', 'CCW'] if mode != 'RGB' and interpolation == 'LINEAR' else ['NEAR']
                for hue in hues:
                    for output in ['Color', 'Alpha']:
                        cases.append({'id': f'{engine.lower()}-ramp-{mode.lower()}-{interpolation.lower()}-{hue.lower()}-{output.lower()}',
                                      'kind': 'ramp', 'stage': 'image', 'mode': mode, 'interpolation': interpolation, 'hue': hue, 'output': output})
            for output in ['Color', 'Alpha']:
                cases.append({'id': f'{engine.lower()}-ramp-{mode.lower()}-mf-literal-{output.lower()}', 'kind': 'ramp',
                              'stage': 'constant', 'value': [.37] * 3, 'factor': .37, 'mode': mode, 'interpolation': 'CARDINAL', 'output': output})
        for interpolation in ['LINEAR', 'CONSTANT', 'EASE']:
            for output in ['Color', 'Alpha']:
                cases.append({'id': f'{engine.lower()}-ramp-two-{interpolation.lower()}-{output.lower()}', 'kind': 'ramp',
                              'count': 2, 'stage': 'image', 'mode': 'RGB', 'interpolation': interpolation, 'output': output})
        for output in ['Color', 'Alpha']:
            cases.append({'id': f'{engine.lower()}-ramp-mf-tiny-span-{output.lower()}', 'kind': 'ramp', 'count': 2,
                          'stage': 'constant', 'value': [5e-11] * 3, 'factor': 5e-11, 'mode': 'RGB',
                          'interpolation': 'LINEAR', 'output': output, 'tinySpan': True})
        for stage in ['constant', 'image']:
            for output in ['Color', 'Alpha']:
                case = {'id': f'{engine.lower()}-ramp-single-{stage}-{output.lower()}', 'kind': 'ramp', 'count': 1,
                        'stage': stage, 'value': [.37] * 3, 'factor': .37, 'mode': 'RGB', 'interpolation': 'LINEAR', 'output': output}
                unsafe_copy = engine != 'CYCLES' and bpy.app.version < (4, 4, 0) and stage == 'image'
                if unsafe_copy:
                    material, emission = make_material(case)
                    try:
                        tsl_ir.emit_channel(emission.inputs['Color'])
                        raise AssertionError('Legacy ID-copy source preservation guard was bypassed')
                    except tsl_ir.TslIrRefusal as error:
                        assert 'references other Blender IDs' in str(error)
                        refusals.append({**case, 'reason': str(error)})
                    finally: bpy.data.materials.remove(material, do_unlink=True)
                else: cases.append(case)
        if engine != 'CYCLES' and bpy.app.version < (4, 4, 0):
            for history in ['forward', 'reverse', 'coincident']:
                for interpolation in ['LINEAR', 'CONSTANT', 'EASE']:
                    if history == 'coincident' and interpolation != 'CONSTANT': continue
                    for output in ['Color', 'Alpha']:
                        cases.append({'id': f'{engine.lower()}-ramp-hidden-{history}-{interpolation.lower()}-{output.lower()}',
                                      'kind': 'ramp', 'count': 1, 'stage': 'uv', 'hidden': history,
                                      'mode': 'RGB', 'interpolation': interpolation, 'output': output})
        for mode, interpolation in [('RGB', 'CARDINAL'), ('HSV', 'LINEAR'), ('HSL', 'LINEAR')]:
            for output in ['Color', 'Alpha']:
                case = {'id': f'{engine.lower()}-ramp-single-table-{mode.lower()}-{output.lower()}', 'kind': 'ramp', 'count': 1,
                        'stage': 'image', 'mode': mode, 'interpolation': interpolation, 'output': output}
                cases.append(case)
        cases.append({'id': engine.lower() + '-ramp-single-authored-alpha-default', 'kind': 'ramp', 'count': 1,
                      'stage': 'image', 'mode': 'RGB', 'interpolation': 'CARDINAL', 'output': 'Alpha', 'alphaDefault': .7})
        # Undefined constant saturation and unconstrained live HDR domains have
        # named compiler refusals, not numeric passes or fake sanitized colors.
        rejected = [[-.3, 0, .3], [.5, 1, 1.5]]
        for stage in ['constant', 'attribute']:
            for index, value in enumerate(rejected):
                case = {'id': f'{engine.lower()}-hsl-refused-{stage}-{index}', 'kind': 'conversion', 'mode': 'HSL',
                        'direction': 'separate', 'stage': stage, 'value': value}
                material, emission = make_material(case)
                try:
                    tsl_ir.emit_channel(emission.inputs['Color'])
                    raise AssertionError('Undefined or unbounded HSL was silently admitted: ' + case['id'])
                except tsl_ir.TslIrRefusal as error:
                    assert 'HSL' in str(error)
                    refusals.append({**case, 'reason': str(error)})
                finally: bpy.data.materials.remove(material, do_unlink=True)
        source_profile = tsl_ir._normalized_noise_source_profile(engine, sys.platform, platform.machine(), scene.cycles.device)
        expected_source_refusals = {case['id'] for case in cases
            if engine == 'CYCLES' and source_profile is None and case.get('composition') == 'noise'}
        observed_source_refusals = set()
        completed_cases = 0
        for case in cases:
            material, emission = make_material(case)
            proxy.data.materials.clear()
            proxy.data.materials.append(material)
            try:
                document = tsl_ir.emit_channel(emission.inputs['Color'])
            except tsl_ir.TslIrRefusal as error:
                if not source_qualified_noise_refusal(engine, case.get('composition') == 'noise', str(error), source_profile): raise
                observed_source_refusals.add(case['id'])
                refusals.append({**case, 'engine': engine, 'reason': str(error),
                                 'sourceQualification': 'unmeasured-cycles-normalized-child'})
                bpy.data.materials.remove(material, do_unlink=True)
                continue
            if case.get('consumer'):
                def collect(value):
                    if isinstance(value, dict):
                        return [value] + [item for child in value.values() for item in collect(child)]
                    if isinstance(value, list): return [item for child in value for item in collect(child)]
                    return []
                expressions = collect(document)
                if case['consumer'] == 'blackbody':
                    consumer = next(item for item in expressions if item.get('op') == 'spectral')
                    assert consumer['inputEvaluation'] == 'shader'
                    assert consumer['cyclesInputEvaluation'] == 'constant'
                    assert consumer['model'] == ('cycles' if engine == 'CYCLES' else 'eevee-table')
                else:
                    consumer = next(item for item in expressions if item.get('op') == 'curve_native')
                    assert consumer['model'] == ('cycles' if engine == 'CYCLES' else 'eevee-gpu')
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
            pixels = raw if case.get('stage') in {'image', 'uv'} else np.tile(raw[SIZE // 2, SIZE // 2, :3], (SIZE, SIZE, 1))
            assert np.isfinite(pixels).all(), case['id']
            pixels.astype('<f4').tofile(OUTPUT / (case['id'] + '.f32'))
            case['engine'] = engine
            case['minimum'] = pixels.min(axis=(0, 1)).tolist()
            case['maximum'] = pixels.max(axis=(0, 1)).tolist()
            if case.get('stage') == 'attribute': case['objectAttributes'] = {'color_input': case['value']}
            records.append(case)
            completed_cases += 1
            bpy.data.materials.remove(material, do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Exact color-conversion inputs') and not image.users: bpy.data.images.remove(image)
        assert observed_source_refusals == expected_source_refusals, (observed_source_refusals, expected_source_refusals)
        assert completed_cases + len(observed_source_refusals) == len(cases)
(OUTPUT / 'index.json').write_text(json.dumps({'blender': bpy.app.version_string, 'buildHash': bpy.app.build_hash.decode(),
    'gpuBackend': bpy.context.preferences.system.gpu_backend, 'cyclesDevice': 'CPU', 'size': SIZE, 'cases': records, 'refusals': refusals,
    'nativeModuleHashes': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(native).iterdir()
                           if path.suffix in {'.py', '.json'}} if native else {}}, indent=2))
print('BLENDLINK_COLOR_REFERENCES_PASSED ' + str(len(records)))
