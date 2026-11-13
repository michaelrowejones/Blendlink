# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_DISTANCE_KEY_PASSED
"""Actual RGB Distance Key image/matte and strict native threshold probes."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import math
import itertools

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def threshold_vectors(threshold):
    """Search F32 reduction boundaries independently, never native output pixels."""
    f = np.float32; rng = np.random.default_rng(510733)
    target = f(threshold); square_target = float(target) ** 2
    chosen, seen, directions = [], set(), {False: 0, True: 0}
    for _ in range(12000):
        a = f(rng.uniform(.05, .7) * threshold); b = f(rng.uniform(.05, .7) * threshold)
        if float(a) ** 2 + float(b) ** 2 >= square_target: continue
        center = f(math.sqrt(square_target - float(a) ** 2 - float(b) ** 2))
        neighbors = [center]
        for direction in (-np.inf, np.inf):
            current = center
            for _step in range(3):
                current = np.nextafter(current, f(direction)); neighbors.append(current)
        for c in neighbors:
            for triple in itertools.permutations((a, b, c)):
                values = tuple(float(part) for part in triple)
                if values in seen: continue
                x, y, z = [f(part * part) for part in triple]
                left = f(f(x + y) + z); right = f(x + f(y + z))
                above = bool(f(np.sqrt(left)) > target)
                if above == bool(f(np.sqrt(right)) > target) or directions[above] == 8: continue
                chosen.append(values); seen.add(values); directions[above] += 1
                if len(chosen) == 16:
                    pixels = np.ones((8, 16, 4), np.float32); pixels[..., :3] = np.asarray(chosen, np.float32)[None, :, :]; pixels[..., 3] = 2
                    return pixels, {'threshold': float(target), 'seed': 510733, 'directions': directions,
                        'selection': 'NumPy F32 squared-distance association only; native EXR remains the oracle', 'rgb': chosen}
    raise AssertionError('Independent distance reduction search found too few probes')


def main(output):
    f = np.float32
    pixels = np.random.default_rng(873351).uniform(-.3, .3, (8, 16, 4)).astype(np.float32)
    pixels[..., 3] = np.asarray([-1, -.5, 0, .125, .25, .5, 1, 2] * 2, np.float32)
    levels = np.asarray([0, .1, .2, .125, .375, .5, 1, 2,
        np.nextafter(f(.1), f(-np.inf)), np.nextafter(f(.1), f(np.inf)),
        np.nextafter(f(.2), f(-np.inf)), np.nextafter(f(.2), f(np.inf)),
        np.nextafter(f(.125), f(-np.inf)), np.nextafter(f(.125), f(np.inf)), -.1, -.2], np.float32)
    for axis in range(3):
        pixels[axis, :, :3] = 0; pixels[axis, :, axis] = levels; pixels[axis, :, 3] = 2
    pixels[3, :, :3] = np.asarray([.1, .2, .3], np.float32)
    pixels[4, :, :3] = np.asarray([-.2, .125, -.1], np.float32)
    pixels[7, :, :3] = np.asarray([20, -20, 40], np.float32)
    oracle = NativeCompositorReference(output, pixels=pixels, device=os.environ.get('BLENDLINK_COMPOSITOR_DISTANCE_KEY_DEVICE', 'CPU'),
        name='Native RGB Distance Key', image_only_scene=True, node_previews=False)
    oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'
    oracle.scene.eevee.taa_render_samples = 1
    tree = oracle.tree; refusals, rows, profiles, probe_metadata = [], [], [], []
    def finish(marker):
        (output / 'index.json').write_text(json.dumps(rows, indent=2))
        (output / 'render-profile.json').write_text(json.dumps(profiles, indent=2))
        print(marker + ' ' + json.dumps({'version': bpy.app.version_string, 'device': oracle.device, 'cases': len(rows)}))
    def setup(tolerance=.1, falloff=.1, kind='field', linked=False, key_alpha=0):
        sink, source = oracle.reset(); image = source.outputs['Image']
        if kind == 'constant': image = oracle.color((.2, 0, 0, 2))
        if kind == 'both-field':
            separated = oracle.separate(image); combined = tree.nodes.new('CompositorNodeCombineColor')
            for socket, name in zip(list(combined.inputs)[:3], ['Blue', 'Green', 'Red']): tree.links.new(separated.outputs[name], socket)
            tree.links.new(oracle.value(-4), combined.inputs[3]); key = combined.outputs[0]
        else: key = oracle.color((0, 0, 0, key_alpha))
        node = tree.nodes.new('CompositorNodeDistanceMatte'); node.name = 'Artist Distance Key'
        if oracle.modern:
            for name, number in [('Tolerance', tolerance), ('Falloff', falloff)]:
                if linked: tree.links.new(oracle.value(number), node.inputs[name])
                else: node.inputs[name].default_value = number
            assert node.inputs['Color Space'].default_value == 'RGB'
        else: node.tolerance, node.falloff = tolerance, falloff; assert node.channel == 'RGB'
        tree.links.new(image, node.inputs['Image']); tree.links.new(key, node.inputs['Key Color'])
        return sink, source, node
    def save(label, source):
        before = repr([(node.name, node.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs],
            [(key, getattr(node, key)) for key in ('channel', 'tolerance', 'falloff') if hasattr(node, key)]) for node in tree.nodes])
        counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        program = compositor_graph.extract(oracle.scene); assert program['status'] == 'extracted', program
        assert before == repr([(node.name, node.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs],
            [(key, getattr(node, key)) for key in ('channel', 'tolerance', 'falloff') if hasattr(node, key)]) for node in tree.nodes])
        assert counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(label, source)
        path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
        document.update(assertTextureCleanup=True, assertMrtState=True,
            assertShaderCost={'maxPasses': 2, 'maxFragmentBytes': 16000}, fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(document, separators=(',', ':')))
        rows.append(oracle.rows[-1]); profiles.append(oracle.render_profiles[-1])
        return document
    def retain_refused(label, source, program):
        replacement = tree.nodes.new('CompositorNodeImage'); replacement.image = oracle.image
        for link in list(source.outputs['Image'].links): tree.links.new(replacement.outputs['Image'], link.to_socket)
        for node in tree.nodes: node.show_preview = False
        oracle.scene.render.filepath = str(output / (label + '.exr'))
        with oracle._render_sampling(): bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        actual = np.asarray(image.pixels[:], dtype='<f4').reshape(oracle.height, oracle.width, 4)
        raw = actual.tobytes(); words = label + '.rgba32f'; (output / words).write_bytes(raw)
        finite = np.isfinite(actual)
        json_rgba = actual.astype(object); json_rgba[~finite] = None
        authored = next(node for node in tree.nodes if node.bl_idname == 'CompositorNodeDistanceMatte')
        controls = {name: (authored.inputs[name].default_value if oracle.modern else getattr(authored, attribute))
            for name, attribute in [('Tolerance', 'tolerance'), ('Falloff', 'falloff')]}
        controls['Color Space'] = authored.inputs['Color Space'].default_value if oracle.modern else authored.channel
        record = {'case': label, 'program': program, 'nativeOnly': True, 'version': bpy.app.version_string,
            'buildHash': bpy.app.build_hash.decode(), 'compositorDevice': oracle.device, 'backend': backend,
            'input': oracle.pixels.tolist(), 'rgba': json_rgba.tolist(), 'controls': controls,
            'nonfiniteCount': int(np.count_nonzero(~finite)), 'rawFloat32File': words,
            'rawFloat32Sha256': hashlib.sha256(raw).hexdigest(), 'sourceFixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        bpy.data.images.remove(image); refusals.append(record)
    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0]); save('distance-key-independent-control', source)
    backend = getattr(bpy.context.preferences.system, 'gpu_backend', 'UNKNOWN')
    if oracle.device == 'GPU':
        for output_name in ('Image', 'Matte'):
            sink, source, node = setup(); tree.links.new(node.outputs[output_name], sink.inputs[0])
            program = compositor_graph.extract(oracle.scene)
            assert program['status'] == 'unsupported' and "do not yet match Blender's threshold decisions" in str(program), program
            retain_refused('gpu-field-' + output_name, source, program)
        if oracle.modern:
            for output_name in ('Image', 'Matte'):
                sink, source, node = setup(kind='constant'); tree.links.new(node.outputs[output_name], sink.inputs[0])
                save('distance-key-gpu-constant-cpu-fold-' + output_name, source)
        else:
            for output_name in ('Image', 'Matte'):
                sink, source, node = setup(.125, 0); tree.links.new(node.outputs[output_name], sink.inputs[0])
                program = compositor_graph.extract(oracle.scene)
                assert program['status'] == 'unsupported' and 'zero Falloff' in str(program), program
                retain_refused('legacy-gpu-zero-falloff-' + output_name, source, program)
        (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
        finish('BLENDLINK_COMPOSITOR_DISTANCE_KEY_UNVERIFIED_GPU')
        print('BLENDLINK_COMPOSITOR_DISTANCE_KEY_PASSED ' + json.dumps({'cases': len(rows), 'qualifiedCpuFoldCases': 2 if oracle.modern else 0,
            'qualifiedGpuFieldCases': 0, 'reason': 'Native GPU field distance model remains unqualified'}))
        return
    settings = [(.1, .1), (.125, .25), (0, .125), (.125, 0), (0, 0), (1, 1), (.5, 1/64)]
    for index, (tolerance, falloff) in enumerate(settings):
        for output_name in ('Image', 'Matte'):
            sink, source, node = setup(tolerance, falloff); tree.links.new(node.outputs[output_name], sink.inputs[0])
            if tolerance == 0 and (oracle.modern or falloff != 0):
                rejected = compositor_graph.extract(oracle.scene)
                assert rejected['status'] == 'unsupported' and 'zero Tolerance' in str(rejected), rejected
                retain_refused(f'{"modern" if oracle.modern else "legacy"}-cpu-zero-tolerance-{index}-' + output_name, source, rejected); continue
            if not oracle.modern and oracle.device == 'GPU' and falloff == 0:
                rejected = compositor_graph.extract(oracle.scene)
                assert rejected['status'] == 'unsupported' and 'zero Falloff' in str(rejected), rejected
                refusals.append({'case': f'legacy-gpu-zero-{index}-{output_name}', 'program': rejected}); continue
            save(f'distance-key-settings-{index}-{output_name}', source)
    for kind in ('constant', 'both-field', 'linked', 'key-alpha', 'group'):
        for output_name in ('Image', 'Matte'):
            sink, source, node = setup(kind=kind, linked=kind == 'linked' and oracle.modern, key_alpha=-4 if kind == 'key-alpha' else 0)
            if kind == 'group':
                group = bpy.data.node_groups.new('Artist Distance Key Group', 'CompositorNodeTree')
                group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
                group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor' if output_name == 'Image' else 'NodeSocketFloat')
                incoming = group.nodes.new('NodeGroupInput'); outgoing = group.nodes.new('NodeGroupOutput')
                nested = group.nodes.new('CompositorNodeDistanceMatte')
                group.links.new(incoming.outputs[0], nested.inputs['Image'])
                nested.inputs['Key Color'].default_value = (0, 0, 0, 0)
                group.links.new(nested.outputs[output_name], outgoing.inputs[0])
                instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
                tree.links.new(source.outputs['Image'], instance.inputs[0]); color = instance.outputs[0]
            else: color = node.outputs[output_name]
            tree.links.new(color, sink.inputs[0]); save(f'distance-key-{kind}-{output_name}', source)
    previous = oracle.pixels.copy(); amplified = np.zeros_like(previous)
    amplified[..., 0] = np.nextafter(f(.1), f(0))
    # Powers of two amplify a matte ULP by exact exponent scaling, independent
    # of incidental rounding in the final alpha product at decimal 1e20.
    amplified[..., 3] = np.resize(np.asarray([1e20, 2 ** 64, 2 ** 60, 1e10], np.float32), amplified.shape[:2])
    oracle.pixels = amplified; oracle.image.pixels.foreach_set(amplified.ravel())
    for output_name in ('Image', 'Matte'):
        sink, source, node = setup(kind='both-field'); tree.links.new(node.outputs[output_name], sink.inputs[0])
        save('distance-key-hdr-alpha-both-field-' + output_name, source)
    oracle.pixels = previous; oracle.image.pixels.foreach_set(previous.ravel())
    for refusal in ('ycc', 'tiny-falloff', 'linked-arithmetic'):
        sink, source, node = setup(); tree.links.new(node.outputs['Image'], sink.inputs[0])
        if refusal == 'ycc':
            if oracle.modern: node.inputs['Color Space'].default_value = 'YCC'
            else: node.channel = 'YCC'
        elif refusal == 'tiny-falloff':
            if oracle.modern: node.inputs['Falloff'].default_value = 1 / 128
            else: node.falloff = 1 / 128
        else:
            if not oracle.modern: continue
            math = tree.nodes.new('ShaderNodeMath'); math.operation = 'ADD'
            tree.links.new(oracle.value(.1), math.inputs[0]); tree.links.new(math.outputs[0], node.inputs['Tolerance'])
        rejected = compositor_graph.extract(oracle.scene); assert rejected['status'] == 'unsupported', rejected
        if refusal == 'ycc': retain_refused('ycc-native-only-Image', source, rejected)
        else: refusals.append({'case': refusal, 'program': rejected})
    # Actual EEVEE Render Layers input, captured separately without fixture Image
    # substitution, before and after pointwise exposure.
    for index in range(2):
        oracle.scene.render.use_compositing = False; oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], np.float32).reshape(oracle.height, oracle.width, 4)
        bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source, node = setup(); color = node.outputs['Image']
        if index:
            post = tree.nodes.new('CompositorNodeExposure'); post.inputs['Exposure'].default_value = 1
            tree.links.new(color, post.inputs['Image']); color = post.outputs[0]
        tree.links.new(color, sink.inputs[0]); unused = tree.nodes.new('CompositorNodeRLayers')
        save('distance-key-actual-eevee-' + str(index), unused)
    for index, threshold in enumerate((.2, .125, .375)):
        pixels, metadata = threshold_vectors(threshold); probe_metadata.append(metadata)
        oracle = NativeCompositorReference(output, pixels=pixels, device=os.environ.get('BLENDLINK_COMPOSITOR_DISTANCE_KEY_DEVICE', 'CPU'),
            name='Native Distance Key boundary vectors', image_only_scene=True, node_previews=False)
        oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
        tree = oracle.tree
        for probe, (tolerance, falloff) in enumerate(((.03125, 1), (.1, .1) if index == 0 else (.0625, .0625) if index == 1 else (.125, .25))):
            for output_name in ('Image', 'Matte'):
                sink, source, node = setup(tolerance, falloff); tree.links.new(node.outputs[output_name], sink.inputs[0])
                save(f'distance-key-boundary-{index}-{probe}-{output_name}', source)
    frames, first = [], None
    for index, (width, height) in enumerate(((8, 8), (8, 8), (12, 10), (7, 13), (8, 8))):
        resized = np.random.default_rng(5731 + width * 13 + height).uniform(-.3, .3, (height, width, 4)).astype(np.float32)
        resized[..., 3] = np.resize(np.asarray([-1, 0, .125, 1, 2], np.float32), (height, width))
        oracle = NativeCompositorReference(output, pixels=resized, device='CPU', name='Live Distance Key resize', image_only_scene=True, node_previews=False)
        oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
        tree = oracle.tree; sink, source, node = setup()
        tree.links.new(node.outputs['Image'], sink.inputs[0]); document = save(f'distance-key-resize-native-{index}', source)
        first = first or document; frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
        if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
        frames.append(frame)
    first.update(case=oracle.prefix + '-distance-key-responsive', resizeFrames=frames)
    (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    (output / 'independent-boundary-vectors.json').write_text(json.dumps(probe_metadata, indent=2))
    finish('BLENDLINK_COMPOSITOR_DISTANCE_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_DISTANCE_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-distance-key-') as directory: main(Path(directory))
