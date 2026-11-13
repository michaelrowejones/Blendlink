# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Difference Key image/matte, signed alpha and threshold boundaries."""
import hashlib
import json
import itertools
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
from compositor_difference_key import native_gpu_profile, is_measured_rne_profile, UNVERIFIED_GPU_MESSAGE, CPU_EXACT_MODEL


def fingerprint(tree):
    def value(item):
        if isinstance(item, bpy.types.ID):
            return {'idType': item.bl_rna.identifier, 'name': item.name_full}
        if item is None or isinstance(item, (bool, str)):
            return item
        if isinstance(item, (int, float)):
            assert math.isfinite(item), 'Nonfinite source default in fixture'
            return item
        return [value(part) for part in item]
    def sockets(items):
        return [(socket.identifier, value(socket.default_value) if hasattr(socket, 'default_value') else None)
                for socket in items]
    return repr([(node.name, node.bl_idname, sockets(node.inputs), sockets(node.outputs),
        [(name, value(getattr(node, name))) for name in ('tolerance', 'falloff') if hasattr(node, name)])
        for node in tree.nodes]) + repr([(link.from_node.name, link.from_socket.identifier,
            link.to_node.name, link.to_socket.identifier) for link in tree.links])


def association_probe_pixels():
    """Independent F32 association counterexamples; no native pixels fitted."""
    rng = np.random.default_rng(318927)
    threshold = np.float32(np.float32(.1) + np.float32(.1))
    target = np.float32(threshold * np.float32(3))
    selected, seen, directions = [], set(), {False: 0, True: 0}
    for _ in range(10000):
        a = np.float32(rng.uniform(.03, .45))
        b = np.float32(rng.uniform(.01, .55 - float(a)))
        center = np.float32(float(target) - float(a) - float(b))
        neighbors = [center]
        for direction in [-np.inf, np.inf]:
            current = center
            for _step in range(3):
                current = np.nextafter(current, np.float32(direction), dtype=np.float32)
                neighbors.append(current)
        for c in neighbors:
            for parts in itertools.permutations((a, b, c)):
                triple = tuple(float(part) for part in parts)
                if triple in seen or min(triple) <= 0 or len(set(triple)) != 3:
                    continue
                x, y, z = parts
                left = np.float32(np.float32(x + y) + z)
                right = np.float32(x + np.float32(y + z))
                left_mean, right_mean = np.float32(left / np.float32(3)), np.float32(right / np.float32(3))
                high = bool(left_mean > threshold)
                if high == bool(right_mean > threshold) or directions[high] == 8:
                    continue
                seen.add(triple); directions[high] += 1
                word = lambda number: int(np.asarray(number, np.float32).view(np.uint32))
                selected.append({'rgb': list(triple), 'rgbWords': [word(part) for part in parts],
                    'leftSum': float(left), 'rightSum': float(right), 'leftMean': float(left_mean),
                    'rightMean': float(right_mean), 'leftSumWord': word(left), 'rightSumWord': word(right),
                    'leftMeanWord': word(left_mean), 'rightMeanWord': word(right_mean), 'leftOpaque': high})
                if len(selected) == 16:
                    pixels = np.ones((8, 16, 4), np.float32)
                    pixels[..., :3] = np.asarray([record['rgb'] for record in selected], np.float32)[None, :, :]
                    pixels[..., 3] = 2
                    return pixels, {'seed': 318927, 'threshold': float(threshold),
                        'thresholdWord': word(threshold), 'directions': {'leftAbove': 8, 'rightAbove': 8},
                        'selection': 'NumPy Float32 left/right association only; actual native output is the oracle',
                        'triples': selected}
    raise AssertionError('Independent asymmetric threshold search found fewer than16 triples')


def main(output):
    pixels = np.random.default_rng(73195).uniform(-2, 4, (8, 16, 4)).astype(np.float32)
    pixels[..., 3] = np.asarray([-1, -.5, -0., 0, 2**-20, .125, .3, .5, .75, 1, 1.5, 2, 3, -.25, .1, .9], np.float32)[None, :]
    key = np.asarray([.25, .5, .75], np.float32)
    levels = np.asarray([0, .125, .25, .375, .5, 1, -.125, -.375,
        np.nextafter(np.float32(.125), np.float32(-np.inf)), np.nextafter(np.float32(.125), np.float32(np.inf)),
        np.nextafter(np.float32(.375), np.float32(-np.inf)), np.nextafter(np.float32(.375), np.float32(np.inf)),
        .5 + 1/64, .1, .2, 2], np.float32)
    for index, signs in enumerate([[1, 1, 1], [1, -1, 1], [-1, 1, -1]]):
        pixels[index, :, :3] = key + levels[:, None] * np.asarray(signs)
    pixels[4, :3, :3] = np.asarray([np.nextafter(np.float32(.2), np.float32(-np.inf)), .2,
        np.nextafter(np.float32(.2), np.float32(np.inf))])[:, None]
    pixels[4, :3, 3] = 2
    # Exercise the bounded CPU-mean shortcut: every such distance is already
    # beyond the greatest possible tolerance+falloff, while image HDR remains.
    pixels[5, :, :3] = [20, -20, 40]
    oracle = NativeCompositorReference(output, name='Native Difference Key', pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_DEVICE', 'CPU'), image_only_scene=True)
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    tree = oracle.tree

    def setup(tolerance, falloff, color_mode='field', linked=False, key_alpha=0, zero_key=False, constant_color=None):
        sink, source = oracle.reset()
        node = tree.nodes.new('CompositorNodeDiffMatte'); node.name = 'Artist Difference Key'
        color = source.outputs['Image'] if color_mode != 'constant' else oracle.color(
            constant_color if constant_color is not None else (.2, .2, .2, 2) if zero_key else (.375, .625, .875, -.5))
        if color_mode == 'both-field':
            channels = oracle.separate(source.outputs['Image'])
            combine = tree.nodes.new('CompositorNodeCombineColor')
            for incoming, name in zip(list(combine.inputs)[:3], ['Blue', 'Green', 'Red']):
                tree.links.new(channels.outputs[name], incoming)
            tree.links.new(oracle.value(-4), combine.inputs[3]); other = combine.outputs[0]
        else: other = oracle.color((0, 0, 0, key_alpha) if zero_key else (*key, key_alpha))
        tree.links.new(color, node.inputs['Image 1']); tree.links.new(other, node.inputs['Image 2'])
        if oracle.modern:
            for name, number in [('Tolerance', tolerance), ('Falloff', falloff)]:
                if linked: tree.links.new(oracle.value(number), node.inputs[name])
                else: node.inputs[name].default_value = number
        else: node.tolerance, node.falloff = tolerance, falloff
        return sink, source, node

    def save(label, source, cpu_fold=False):
        before = fingerprint(tree); groups = [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
        assert before == fingerprint(tree) and groups == [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        differences = [op for op in result['ops'] if op['kind'] == 'difference-key']
        for op in differences:
            expected_cpu = oracle.device == 'CPU' or oracle.modern and cpu_fold
            expected_rne = not expected_cpu and oracle.device == 'GPU' and bpy.context.preferences.system.gpu_backend == 'OPENGL'
            assert op['properties']['difference_key_model'] == (CPU_EXACT_MODEL if expected_cpu else 'native-difference-key-rne-v1' if expected_rne else 'native-difference-key-v1')
            if expected_cpu: assert op['properties']['difference_key_native_version'] == list(bpy.app.version[:3])
            if expected_rne:
                assert is_measured_rne_profile(op['properties'].get('difference_key_gpu_profile'))
            else:
                assert 'difference_key_gpu_profile' not in op['properties']
        oracle.save(label, source)

    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0])
    save('difference-key-independent-control', source)
    # Unsupported native source profiles are declared, with actual pixels and
    # both source refusals retained. The independent control is not a completed
    # Difference numerical family. Central gates inspect this explicit protocol.
    profile = native_gpu_profile()
    if (oracle.device == 'GPU' and bpy.context.preferences.system.gpu_backend == 'OPENGL'
            and not is_measured_rne_profile(profile)):
        refused = []
        for name in ['Image', 'Matte']:
            sink, source, node = setup(.1, .1)
            tree.links.new(node.outputs[name], sink.inputs[0])
            before = fingerprint(tree)
            program = compositor_graph.extract(oracle.scene)
            assert program['status'] == 'unsupported' and len(program['diagnostics']) == 1 and \
                program['diagnostics'][0]['message'] == UNVERIFIED_GPU_MESSAGE, program
            assert fingerprint(tree) == before, 'Unmeasured profile refusal changed source RNA'
            all_links = [(link.from_socket, link.to_socket) for link in tree.links]
            original_links = [(link.from_socket, link.to_socket) for link in source.outputs['Image'].links]
            replacement = tree.nodes.new('CompositorNodeImage'); replacement.image = oracle.image
            try:
                for incoming, target in original_links:
                    tree.links.new(replacement.outputs['Image'], target)
                oracle.scene.render.filepath = str(output / 'native-profile-refusal.exr')
                with oracle._render_sampling():
                    bpy.ops.render.render(write_still=True)
                result = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False)
                try:
                    result.alpha_mode = 'PREMUL'
                    expected = np.asarray(result.pixels[:], np.float32).reshape(oracle.height, oracle.width, 4)
                    assert np.isfinite(expected).all()
                finally:
                    bpy.data.images.remove(result)
            finally:
                tree.nodes.remove(replacement)
                tree.links.clear()
                for incoming, target in all_links:
                    tree.links.new(incoming, target)
            assert fingerprint(tree) == before, 'Native refusal oracle changed source RNA'
            filename = oracle.prefix + '-difference-key-profile-refused-' + name.lower() + '.json'
            payload = {'case': filename[:-5], 'program': program, 'sourceFingerprint': before,
                'sourcePreserved': True, 'width': oracle.width, 'height': oracle.height,
                'input': oracle.pixels.ravel().tolist(), 'expected': expected.ravel().tolist(),
                'nativeGpuProfile': profile, 'output': name, 'compositorDevice': oracle.device,
                'diagnostics': program['diagnostics']}
            contents = json.dumps(payload, separators=(',', ':')).encode()
            (output / filename).write_bytes(contents)
            refused.append({'case': payload['case'], 'file': filename, 'sha256': hashlib.sha256(contents).hexdigest(),
                'output': name, 'reason': UNVERIFIED_GPU_MESSAGE})
        (output / 'qualification.json').write_text(json.dumps({'status': 'source-profile-refused',
            'protocol': 'blendlink-difference-gpu-source-profile-v1', 'nativeGpuProfile': profile,
            'sceneEngine': oracle.scene.render.engine, 'device': oracle.device,
            'backend': bpy.context.preferences.system.gpu_backend, 'cases': 0, 'controlCases': len(oracle.rows),
            'numericalDifferenceCases': 0, 'sourcePreserved': True, 'profileRefusals': refused}, indent=2))
        (output / 'index.json').write_text(json.dumps(oracle.rows, indent=2))
        (output / 'render-profile.json').write_text(json.dumps(oracle.render_profiles, indent=2))
        print('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_SOURCE_PROFILE_REFUSED ' + json.dumps({
            'blender': bpy.app.version_string, 'device': oracle.device, 'cases': 0, 'controlCases': len(oracle.rows)}))
        return
    cpu_refusals = []
    for tolerance, falloff in [(0, .125), (.125, .25), (.5, 1/64), (.125, 0), (.1, .1)]:
        for name in ['Image', 'Matte']:
            for mode in ['field', 'constant', 'both-field']:
                sink, source, node = setup(tolerance, falloff, mode)
                tree.links.new(node.outputs[name], sink.inputs[0])
                if tolerance == 0 and (oracle.device == 'CPU' or oracle.modern and mode == 'constant'):
                    rejected = compositor_graph.extract(oracle.scene)
                    assert rejected['status'] == 'unsupported' and 'positive Tolerance' in str(rejected), rejected
                    cpu_refusals.append(rejected); continue
                save(f'difference-key-{tolerance}-{falloff}-{name.lower()}-{mode}', source, cpu_fold=mode == 'constant')
    for name in ['Image', 'Matte']:
        sink, source, node = setup(.125, .25, linked=oracle.modern, key_alpha=3)
        tree.links.new(node.outputs[name], sink.inputs[0]); save('difference-key-ignored-key-alpha-' + name.lower(), source)
        for mode in ['field', 'constant']:
            sink, source, node = setup(.1, .1, mode, zero_key=True)
            tree.links.new(node.outputs[name], sink.inputs[0]); save('difference-key-hdr-upper-boundary-' + name.lower() + '-' + mode, source, cpu_fold=mode == 'constant')
    for name in ['Image', 'Matte']:
        sink, source, node = setup(.125, .25)
        second = tree.nodes.new('CompositorNodeDiffMatte')
        tree.links.new(node.outputs['Image'], second.inputs['Image 1'])
        tree.links.new(oracle.color((.25, .5, .75, 0)), second.inputs['Image 2'])
        tree.links.new(second.outputs[name], sink.inputs[0]); save('difference-key-cascade-' + name.lower(), source)

    # Qualify the fresh OpenGL profile's dot3 association independently from
    # the original 39 graphs. A private image avoids stale texture-cache data.
    if oracle.device == 'GPU' and bpy.context.preferences.system.gpu_backend == 'OPENGL':
        supplement, association = association_probe_pixels()
        association['constantProbe'] = next(row for row in association['triples'] if row['leftOpaque'])
        (output / 'association-inputs.json').write_text(json.dumps(association, indent=2))
        original_image, original_pixels = oracle.image, oracle.pixels
        image = bpy.data.images.new('Difference association inputs', width=16, height=8, alpha=True, float_buffer=True)
        image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
        image.pixels.foreach_set(supplement.ravel()); image.update()
        try:
            oracle.image, oracle.pixels = image, supplement
            for name in ['Image', 'Matte']:
                sink, source, node = setup(.1, .1, zero_key=True)
                tree.links.new(node.outputs[name], sink.inputs[0])
                save('difference-key-hdr-association-' + name.lower(), source)
            # All inputs are actual literal nodes; modern native GPU requests
            # evaluate this through CPU. It must not acquire GPU dot3 order.
            for name in ['Image', 'Matte']:
                sink, source, node = setup(.1, .1, color_mode='constant', zero_key=True,
                    constant_color=(*association['constantProbe']['rgb'], 2))
                tree.links.new(node.outputs[name], sink.inputs[0])
                save('difference-key-hdr-association-constant-' + name.lower(), source, cpu_fold=True)
        finally:
            oracle.image, oracle.pixels = original_image, original_pixels
            tree.nodes.clear()
            bpy.data.images.remove(image)

    refusals = list(cpu_refusals)
    sink, source, node = setup(.125, 1/128); tree.links.new(node.outputs[0], sink.inputs[0])
    before = fingerprint(tree); result = compositor_graph.extract(oracle.scene)
    assert result['status'] == 'unsupported' and any('Falloff must be' in d['message'] for d in result['diagnostics']), result
    assert before == fingerprint(tree); refusals.append(result['diagnostics'])
    if oracle.modern:
        sink, source, node = setup(.125, .25)
        tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'], node.inputs['Tolerance'])
        tree.links.new(node.outputs['Image'], sink.inputs[0]); result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any('fixed scalar' in d['message'] for d in result['diagnostics']), result
        refusals.append(result['diagnostics'])
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    paths = [Path(__file__).resolve(), Path(compositor_graph.__file__).resolve(),
        Path(compositor_graph.__file__).with_name('compositor_difference_key.py')]
    (output / 'qualification.json').write_text(json.dumps({'sourcePreserved': True,
        'sceneEngine': oracle.scene.render.engine, 'blenderVersion': list(bpy.app.version),
        'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend, 'cases': len(oracle.rows),
        'nativeGpuProfile': native_gpu_profile(),
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-difference-key-') as directory: main(Path(directory))
