# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual luminance-key Image/Matte output, alpha and threshold boundaries."""
import hashlib
import json
import math
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference
import compositor_graph


def fingerprint(tree):
    def default(socket):
        value = getattr(socket, 'default_value', None)
        if value is None or isinstance(value, (str, bool)):
            return value
        if isinstance(value, (float, int)):
            assert math.isfinite(value)
            return value
        if isinstance(value, bpy.types.ID):
            return [value.bl_rna.identifier, value.name_full]
        return list(value)
    return repr([(node.name, node.bl_idname,
        [[(socket.identifier, default(socket)) for socket in sockets] for sockets in [node.inputs, node.outputs]],
        [(name, getattr(node, name)) for name in ('limit_min', 'limit_max') if hasattr(node, name)]) for node in tree.nodes]) + repr([
        (link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier) for link in tree.links])


def main(output):
    pixels = np.random.default_rng(713951).uniform(-2, 4, (7, 13, 4)).astype(np.float32)
    pixels[..., 3] = np.asarray([-1, -.5, -0., 0, 2**-20, .125, .3, .5, .75, 1, 1.5, 2, 3], np.float32)[None, :]
    levels = np.asarray([-.5, 0, .125, .25, .5, .75, 1, 2], np.float32)
    pixels[0, :8, :3] = levels[:, None]
    pixels[1, :3, :3] = np.eye(3, dtype=np.float32)
    pixels[2, :6, :3] = np.asarray([np.nextafter(np.float32(.25), np.float32(-np.inf)), .25,
        np.nextafter(np.float32(.25), np.float32(np.inf)), np.nextafter(np.float32(.75), np.float32(-np.inf)),
        .75, np.nextafter(np.float32(.75), np.float32(np.inf))])[:, None]
    oracle = NativeCompositorReference(output, name='Native Luminance Key', pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE', 'CPU'), image_only_scene=True)
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    requested_engine = os.environ.get('BLENDLINK_LUMA_CPU_ORACLE_ENGINE')
    if requested_engine is not None:
        assert oracle.device == 'CPU' and requested_engine == 'CYCLES', 'Only an explicit CPU-only Cycles empty-scene oracle is allowed'
        oracle.scene.render.engine = requested_engine
        oracle.scene.cycles.samples = 1
        oracle.scene.cycles.use_denoising = False
    tree = oracle.tree

    def setup(low, high, field=True, linked=False):
        sink, source = oracle.reset()
        node = tree.nodes.new('CompositorNodeLumaMatte')
        node.name = 'Artist Luminance Key'
        tree.links.new(source.outputs['Image'] if field else oracle.color((.3, -.125, 2, .4)), node.inputs['Image'])
        if oracle.modern:
            for name, value in [('Minimum', low), ('Maximum', high)]:
                if linked: tree.links.new(oracle.value(value), node.inputs[name])
                else: node.inputs[name].default_value = value
        else:
            # RNA can constrain property assignment; retain and test the
            # actual authored result rather than inventing a native setting.
            node.limit_min, node.limit_max = low, high
        return sink, source, node

    cpu_profiles = set()
    def save(label, source):
        before = fingerprint(tree)
        groups = [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
        for operation in result['ops']:
            profile = operation.get('properties', {}).get('luminance_key_cpu_profile')
            if profile is not None: cpu_profiles.add(json.dumps(profile, sort_keys=True))
        assert before == fingerprint(tree), 'Extraction changed authored nodes or links'
        assert groups == [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        oracle.save(label, source)

    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0])
    save('luminance-key-independent-control', source)
    settings = [(0, 1), (.25, .75), (.5, .5 + 1/64)]
    if oracle.modern: settings.append((.75, .25))
    for low, high in settings:
        for output_name in ['Image', 'Matte']:
            for field in [True, False]:
                for linked in ([False, True] if oracle.modern else [False]):
                    sink, source, node = setup(low, high, field, linked)
                    tree.links.new(node.outputs[output_name], sink.inputs[0])
                    save(f'luminance-key-{low}-{high}-{output_name.lower()}-{field}-{linked}'.lower(), source)
    # Scalar Matte participates in a separate image graph; Image is a full
    # premultiplied-color result, including the output alpha multiplication.
    sink, source, node = setup(.125, .75)
    alpha = tree.nodes.new('CompositorNodeSetAlpha')
    if oracle.modern: alpha.inputs['Type'].default_value = 'Replace Alpha'
    else: alpha.mode = 'REPLACE_ALPHA'
    tree.links.new(source.outputs['Image'], alpha.inputs['Image'])
    tree.links.new(node.outputs['Matte'], alpha.inputs['Alpha'])
    tree.links.new(alpha.outputs[0], sink.inputs[0]); save('luminance-key-matte-to-alpha', source)
    for output_name in ['Image', 'Matte']:
        sink, source, node = setup(.125, .75)
        second = tree.nodes.new('CompositorNodeLumaMatte')
        tree.links.new(node.outputs['Image'], second.inputs['Image'])
        tree.links.new(second.outputs[output_name], sink.inputs[0])
        save('luminance-key-cascade-' + output_name.lower(), source)
    for placement, output_name in [('before', 'Image'), ('before', 'Matte'), ('after', 'Image')]:
        sink, source, node = setup(.125, .75)
        translation = tree.nodes.new('CompositorNodeTranslate')
        if oracle.modern:
            translation.inputs['Interpolation'].default_value = 'Nearest'
            translation.inputs['Extension X'].default_value = translation.inputs['Extension Y'].default_value = 'Clip'
        else: translation.interpolation = 'Nearest'
        translation.inputs['X'].default_value = 2
        translation.inputs['Y'].default_value = -1
        if placement == 'before':
            tree.links.new(source.outputs['Image'], translation.inputs['Image'])
            tree.links.new(translation.outputs['Image'], node.inputs['Image'])
            tree.links.new(node.outputs[output_name], sink.inputs[0])
        else:
            tree.links.new(node.outputs['Image'], translation.inputs['Image'])
            tree.links.new(translation.outputs['Image'], sink.inputs[0])
        save('luminance-key-translate-' + placement + '-' + output_name.lower(), source)
    group = bpy.data.node_groups.new('Artist Luminance Group', 'CompositorNodeTree')
    group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
    for name, kind in [('Image', 'NodeSocketColor'), ('Matte', 'NodeSocketFloat')]:
        group.interface.new_socket(name=name, in_out='OUTPUT', socket_type=kind)
    group_input, group_output = group.nodes.new('NodeGroupInput'), group.nodes.new('NodeGroupOutput')
    group_key = group.nodes.new('CompositorNodeLumaMatte')
    group.links.new(group_input.outputs['Image'], group_key.inputs['Image'])
    for name in ['Image', 'Matte']: group.links.new(group_key.outputs[name], group_output.inputs[name])
    for output_name in ['Image', 'Matte']:
        sink, source = oracle.reset()
        instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
        tree.links.new(source.outputs['Image'], instance.inputs['Image'])
        tree.links.new(instance.outputs[output_name], sink.inputs[0])
        save('luminance-key-group-' + output_name.lower(), source)

    # Single-valued bounds are not single-valued evaluation. A spatial Math
    # field clamped to exactly one still keeps a modern GPU Luma on GPU.
    if oracle.modern:
        measured_cpu = bool(cpu_profiles)
        for threshold_source in ['values', 'field-minimum', 'field-maximum']:
            for output_name in ['Image', 'Matte']:
                low, high = (1, 0) if threshold_source != 'field-maximum' else (0, 1)
                sink, source, node = setup(low, high, field=False, linked=True)
                tree.links.new(oracle.color((.1414213478565216,) * 3 + (1,)), node.inputs['Image'])
                if threshold_source != 'values':
                    fixed = tree.nodes.new('ShaderNodeMath'); fixed.operation = 'MAXIMUM'; fixed.use_clamp = True
                    tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'], fixed.inputs[0]); fixed.inputs[1].default_value = 1
                    tree.links.new(fixed.outputs[0], node.inputs['Minimum' if threshold_source == 'field-minimum' else 'Maximum'])
                tree.links.new(node.outputs[output_name], sink.inputs[0])
                extracted = compositor_graph.extract(oracle.scene)
                assert extracted['status'] == 'extracted', extracted
                operation = next(op for op in extracted['ops'] if op['kind'] == 'luminance-key')
                assert {'Image', 'Minimum', 'Maximum'} == set(operation['inputs']), operation
                cpu_expected = measured_cpu and (oracle.device == 'CPU' or threshold_source == 'values')
                assert operation['properties']['luminance_key_model'] == ('native-luminance-key-cpu-rne-v1' if cpu_expected else 'native-luminance-key-v1'), operation
                save('luminance-key-threshold-' + threshold_source + '-' + output_name.lower(), source)
    legacy_reverse_rna = None
    if not oracle.modern and oracle.device == 'CPU':
        sink, source, node = setup(.75, .25)
        legacy_reverse_rna = {'requested': [.75, .25], 'assigned': [node.limit_min, node.limit_max]}
        assert node.limit_min <= node.limit_max, 'Review newly authorable legacy reversed-ramp RNA'
        # The current RNA setter constrains reverse assignment. Separately
        # test admission of a hypothetical persisted reverse state, without
        # pretending that this mock node is an actual native pixel oracle.
        from types import SimpleNamespace
        helper = compositor_graph._sibling('compositor_luminance_key')
        image_socket = SimpleNamespace(name='Image', type='RGBA')
        simulated = SimpleNamespace(inputs={'Image': image_socket}, limit_min=.75, limit_max=.25)
        operation = {'properties': {}, 'inputs': {}}
        helper.normalize_luminance_key(simulated, SimpleNamespace(identifier='Image'), operation, oracle.scene,
            lambda incoming: {'kind': 'constant', 'type': 'RGBA', 'value': [.1, .2, .3, 1]}, None,
            lambda incoming, message: (_ for _ in ()).throw(AssertionError(message)), lambda incoming: True)
        assert operation['properties']['luminance_key_model'] == 'native-luminance-key-v1', operation
        assert operation['properties']['luminance_key_exact_qualification']['reason'] == 'unmeasured legacy reversed CPU ramp'

    refusals = []
    for low, high in [(.5, .5), (.5, .5 + 1/128)]:
        sink, source, node = setup(low, high)
        tree.links.new(node.outputs['Image'], sink.inputs[0]); before = fingerprint(tree)
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any('threshold separation' in item['message'] for item in result['diagnostics']), result
        assert before == fingerprint(tree)
        refusals.append(result['diagnostics'])
    if oracle.modern:
        sink, source, node = setup(0, 1)
        tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'], node.inputs['Minimum'])
        tree.links.new(node.outputs['Image'], sink.inputs[0]); result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any('fixed scalar' in item['message'] for item in result['diagnostics']), result
        refusals.append(result['diagnostics'])
    bpy.data.node_groups.remove(group)

    # Independent binary alpha scaling exposes one-ULP matte errors without
    # relying on an additional product-rounding boundary. Original rows above
    # retain their authored source values and native expected pixels.
    ordinary_cases = len(oracle.rows)
    experimental_precision = os.environ.get('BLENDLINK_LUMA_CPU_EXACT_EXPERIMENT') == '1'
    capture_precision = bool(cpu_profiles) or experimental_precision
    original = oracle.pixels.copy()
    try:
        colors = np.asarray([[.1414213478565216] * 3, [.1, .2, .3], [1, .53125, .25],
            [.2, .8, .15], [.15] * 3, [.2] * 3, [.3] * 3, [.7, .2, .3],
            [.25, .5, .75], [.1] * 3, [.5] * 3, [0] * 3, [1] * 3], np.float32)
        hdr = original.copy(); hdr[..., :3] = colors[None, :, :]
        hdr[..., 3] = np.asarray([1, 2**20, 2**40, 2**60, -2**40, 1e10, 0], np.float32)[:, None]
        for data, tag, settings in [(hdr, 'hdr', [(.1, .2), (.1, .3), (.125, .75), (0, 1), (0, .3)]),
                (None, 'tiny-ftz', [(0, 1), (0, .1), (2**-100, .125)])]:
            if data is None:
                data = hdr.copy()
                values = np.asarray([0, -0., 2**-149, 2**-140, 2**-127, 2**-126,
                    2**-125, 2**-120, 2**-100, 2**-74, 2**-50, .1, .5], np.float32)
                data[..., :3] = values[None, :, None]; data[..., 3] = np.float32(2**120)
            oracle.pixels[:] = data; oracle.image.pixels.foreach_set(data.ravel()); oracle.image.update()
            for low, high in settings:
                for name in ['Image', 'Matte']:
                    # Modern GPU single values fold through the CPU model;
                    # spatial GPU arithmetic retains the older GPU contract.
                    for field in (([True, False] if oracle.device == 'CPU' else [False] if oracle.modern else []) if capture_precision else []):
                        sink, source, node = setup(low, high, field)
                        if not field:
                            constant = (.1414213478565216,) * 3 + (2**60,) if tag == 'hdr' else (2**-125,) * 3 + (2**120,)
                            tree.links.new(oracle.color(constant), node.inputs['Image'])
                        tree.links.new(node.outputs[name], sink.inputs[0])
                        save(f'luminance-key-cpu-{tag}-{low}-{high}-{name.lower()}-{field}'.lower(), source)
    finally:
        oracle.pixels[:] = original; oracle.image.pixels.foreach_set(original.ravel()); oracle.image.update()

    # Unqualified CPU sources retain explicit legacy precision, never a new-model claim.
    if oracle.device == 'CPU':
        helper = compositor_graph._sibling('compositor_luminance_key')
        from types import SimpleNamespace
        sink, source, node = setup(.1, .2); tree.links.new(node.outputs['Image'], sink.inputs[0])
        before = fingerprint(tree); original_bpy, original_coefficients, original_profile, original_sys = helper.bpy, helper._cpu_coefficients, helper._cpu_profile, helper.sys
        try:
            helper.bpy = SimpleNamespace(app=SimpleNamespace(version=(5, 2, 1)))
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'extracted' and any(op['properties'].get('luminance_key_exact_qualification', {}).get('reason') == 'unmeasured source version' for op in rejected['ops']), rejected
            helper.bpy = original_bpy
            helper._cpu_coefficients = lambda: [.3, .6, .1]
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'extracted' and any(op['properties'].get('luminance_key_precision') == 'legacy-unqualified-cpu-v1' for op in rejected['ops']), rejected
            helper._cpu_coefficients = original_coefficients
            def unknown_profile(): raise ValueError('independent unmeasured mixed Float32 mode')
            helper._cpu_profile = unknown_profile
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'extracted' and any(op['properties'].get('luminance_key_precision') == 'legacy-unqualified-cpu-v1' for op in rejected['ops']), rejected
            def unmeasured_combination():
                profile = original_profile().copy()
                profile['mode'] = 'gradual-rne' if profile['mode'] == 'ftz-daz-rne' else 'ftz-daz-rne'
                return profile
            helper._cpu_profile = unmeasured_combination
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'extracted' and any(op['properties'].get('luminance_key_precision') == 'legacy-unqualified-cpu-v1' for op in rejected['ops']), rejected
            helper._cpu_profile = original_profile
            helper.sys = SimpleNamespace(platform='win32')
            rejected = compositor_graph.extract(oracle.scene)
            assert rejected['status'] == 'extracted' and any(op['properties'].get('luminance_key_exact_qualification', {}).get('reason') == 'unmeasured CPU/compiler profile' for op in rejected['ops']), rejected
        finally:
            helper.bpy, helper._cpu_coefficients, helper._cpu_profile, helper.sys = original_bpy, original_coefficients, original_profile, original_sys
        assert fingerprint(tree) == before, 'CPU precision refusal changed authored values or links'
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    paths = [Path(__file__).resolve(), Path(compositor_graph.__file__).resolve(),
        Path(compositor_graph.__file__).with_name('compositor_luminance_key.py')]
    (output / 'qualification.json').write_text(json.dumps({'sourcePreserved': True,
        'sceneEngine': oracle.scene.render.engine, 'blenderVersion': list(bpy.app.version),
        'legacyReverseRna': legacy_reverse_rna, 'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend,
        'cases': len(oracle.rows), 'refusals': len(refusals), 'cpuProfiles': [json.loads(profile) for profile in sorted(cpu_profiles)],
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    if oracle.device == 'CPU':
        helper = compositor_graph._sibling('compositor_luminance_key')
        actual_profile = helper._cpu_profile()
        precision_files = []
        production_exact_cases = 0
        for row in oracle.rows[ordinary_cases:]:
            filename = row['case'] + '.json'
            record = json.loads((output / filename).read_text())
            keys = [op for op in record['program']['ops'] if op['kind'] == 'luminance-key']
            assert len(keys) == 1, record['case']
            if keys[0]['properties']['luminance_key_model'] == 'native-luminance-key-cpu-rne-v1': production_exact_cases += 1
            else:
                assert experimental_precision and keys[0]['properties']['luminance_key_precision'] == 'legacy-unqualified-cpu-v1'
            precision_files.append({'case': row['case'], 'file': filename,
                'sha256': hashlib.sha256((output / filename).read_bytes()).hexdigest()})
        qualification = {'schemaVersion': 1, 'kind': 'blendlink-luma-cpu-precision-qualification-v1',
            'productionAdmission': 'PRODUCTION_QUALIFIED' if cpu_profiles else 'SOURCE_ADMISSION_NA',
            'ordinaryCases': ordinary_cases, 'precisionCases': len(precision_files),
            'productionExactCases': production_exact_cases, 'experimentalKernelTrial': experimental_precision,
            'sourceCpuProfile': actual_profile, 'sourceCoefficients': helper._cpu_coefficients(), 'sourceVersion': list(bpy.app.version),
            'sourceBuildHash': bpy.app.build_hash.decode(), 'sourceEngine': oracle.scene.render.engine,
            'sourcePreserved': True, 'files': precision_files}
        (output / 'precision-qualification.json').write_text(json.dumps(qualification, indent=2))
        print('BLENDLINK_LUMA_CPU_EXACT_' + qualification['productionAdmission'] + ' precisionCases=' + str(len(precision_files)) + ' productionExactCases=' + str(production_exact_cases), flush=True)
    oracle.finish('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-luminance-key-') as directory: main(Path(directory))
