# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Color Key strict HSV boundaries, signed alpha and field composition."""
import colorsys
import hashlib
import json
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
    return repr([(n.name, n.bl_idname,
        [(s.identifier, str(getattr(s, 'default_value', None))) for s in n.inputs],
        [(k, getattr(n, k)) for k in ('color_hue', 'color_saturation', 'color_value') if hasattr(n, k)]) for n in tree.nodes]) + repr([
        (l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in tree.links])


def main(output):
    pixels = np.random.default_rng(91421).uniform(-2, 4, (8, 16, 4)).astype(np.float32)
    pixels[..., 3] = np.asarray([-1, -.5, -0., 0, 2**-20, .125, .3, .5, .75, 1, 1.5, 2, 3, -.25, .1, .9], np.float32)[None, :]
    pixels[0, :, :3] = np.asarray([[0, 0, 0], [1, 1, 1], [-1, -1, -1], [1, 0, 0],
        [0, 1, 0], [0, 0, 1], [-2, 1, -1], [1, -2, -1]] * 2, np.float32)
    for i, hue in enumerate([0, .0625, .125, .25, .5, .875, .9375, 1]):
        pixels[1, i, :3] = colorsys.hsv_to_rgb(hue, .75, 1)
        pixels[1, i + 8, :3] = colorsys.hsv_to_rgb(hue, .75, 2)
    for axis in [0, 1, 2]:
        for column, value in enumerate([np.nextafter(np.float32(.25), -np.inf, dtype=np.float32), .25,
                np.nextafter(np.float32(.25), np.inf, dtype=np.float32), .5, .75, 1, 1.5, 2]):
            hsv = [0, .75, 1]; hsv[axis] = value
            pixels[axis + 2, column, :3] = colorsys.hsv_to_rgb(*hsv)
    pixels[5, 0, :3] = [.7, .2, .3]
    oracle = NativeCompositorReference(output, name='Native Color Key', pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_COLOR_KEY_DEVICE', 'CPU'), image_only_scene=True)
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    assert oracle.device == 'CPU', 'The qualified numerical Color Key corpus requires CPU source compositing'
    tree = oracle.tree

    def setup(settings=(.01, .1, .1), mode='field', linked=False, key_alpha=0):
        sink, source = oracle.reset()
        node = tree.nodes.new('CompositorNodeColorMatte'); node.name = 'Artist Color Key'
        color = oracle.color((1, .25, .25, -.5)) if mode == 'constant' else source.outputs['Image']
        if mode == 'both-field':
            channels = oracle.separate(source.outputs['Image']); combine = tree.nodes.new('CompositorNodeCombineColor')
            for incoming, name in zip(list(combine.inputs)[:3], ['Blue', 'Green', 'Red']):
                tree.links.new(channels.outputs[name], incoming)
            tree.links.new(oracle.value(key_alpha), combine.inputs[3]); key = combine.outputs[0]
        else: key = oracle.color((1, .25, .25, key_alpha))
        tree.links.new(color, node.inputs['Image']); tree.links.new(key, node.inputs['Key Color'])
        for name, attribute, number in zip(['Hue', 'Saturation', 'Value'],
                ['color_hue', 'color_saturation', 'color_value'], settings):
            if oracle.modern:
                if linked: tree.links.new(oracle.value(number), node.inputs[name])
                else: node.inputs[name].default_value = number
            else: setattr(node, attribute, number)
        return sink, source, node

    def save(label, source):
        before = fingerprint(tree)
        groups = [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
        assert before == fingerprint(tree), label
        assert groups == [(group.name, fingerprint(group)) for group in bpy.data.node_groups], label
        oracle.save(label, source, exact_alpha=True)

    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0])
    save('color-key-independent-control', source)
    # Measure the actual native HSV image first. Its component words select
    # thresholds at, below and above strict key boundaries, independently of
    # the browser's HSV implementation.
    sink, source = oracle.reset()
    channels = oracle.separate(source.outputs['Image']); channels.mode = 'HSV'
    combine = tree.nodes.new('CompositorNodeCombineColor')
    for incoming, outgoing in zip(list(combine.inputs), list(channels.outputs)):
        tree.links.new(outgoing, incoming)
    tree.links.new(combine.outputs[0], sink.inputs[0]); save('color-key-native-hsv-control', source)
    control = json.loads((output / (oracle.rows[-1]['case'] + '.json')).read_text())
    native_hsv = np.asarray(control['expected'], np.float32).reshape(8, 16, 4)
    for settings in [(.01, .1, .1), (.125, .25, .5), (.5, .5, 1), (1, 1, 1), (0, 1, 1), (1, 0, 1), (1, 1, 0)]:
        for name in ['Image', 'Matte']:
            for mode in ['field', 'constant', 'both-field']:
                sink, source, node = setup(settings, mode)
                tree.links.new(node.outputs[name], sink.inputs[0])
                save('color-key-' + '-'.join(map(str, settings)) + '-' + name.lower() + '-' + mode, source)
    for axis, row, column in [(0, 1, 1), (0, 1, 2), (0, 1, 6), (1, 3, 3), (2, 4, 3), (0, 5, 0), (1, 5, 0), (2, 5, 0)]:
        native = native_hsv[row, column, axis]
        if axis == 0:
            boundary = np.float32(2 * min(native, np.float32(1 - native)))
        else:
            boundary = abs(np.float32(native - [.0, .75, 1][axis]))
        assert 0 < boundary < 1, (axis, boundary)
        for direction in [-1, 0, 1]:
            threshold = boundary if direction == 0 else np.nextafter(boundary, np.float32(direction * np.inf))
            settings = [1, 1, 1]; settings[axis] = float(threshold)
            for name in ['Image', 'Matte']:
                sink, source, node = setup(settings)
                tree.links.new(node.outputs[name], sink.inputs[0])
                save(f'color-key-native-boundary-{axis}-{row}-{column}-{direction}-{name.lower()}', source)
    for name in ['Image', 'Matte']:
        sink, source, node = setup((.125, .25, .5), linked=oracle.modern, key_alpha=3)
        tree.links.new(node.outputs[name], sink.inputs[0]); save('color-key-ignored-key-alpha-' + name.lower(), source)
        sink, source, node = setup((.125, .25, .5))
        second = tree.nodes.new('CompositorNodeColorMatte')
        tree.links.new(node.outputs['Image'], second.inputs['Image'])
        tree.links.new(second.outputs[name], sink.inputs[0]); save('color-key-cascade-' + name.lower(), source)
    sink, source, node = setup((.125, .25, .5))
    alpha = tree.nodes.new('CompositorNodeSetAlpha')
    if oracle.modern: alpha.inputs['Type'].default_value = 'Replace Alpha'
    else: alpha.mode = 'REPLACE_ALPHA'
    tree.links.new(source.outputs['Image'], alpha.inputs['Image'])
    tree.links.new(node.outputs['Matte'], alpha.inputs['Alpha'])
    tree.links.new(alpha.outputs[0], sink.inputs[0]); save('color-key-matte-to-alpha', source)

    group = bpy.data.node_groups.new('Artist Color Key Group', 'CompositorNodeTree')
    group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
    group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    group.interface.new_socket(name='Matte', in_out='OUTPUT', socket_type='NodeSocketFloat')
    incoming = group.nodes.new('NodeGroupInput'); outgoing = group.nodes.new('NodeGroupOutput')
    key_node = group.nodes.new('CompositorNodeColorMatte')
    key_node.inputs['Key Color'].default_value = (1, .25, .25, 1)
    group.links.new(incoming.outputs['Image'], key_node.inputs['Image'])
    for name in ['Image', 'Matte']: group.links.new(key_node.outputs[name], outgoing.inputs[name])
    for name in ['Image', 'Matte']:
        sink, source = oracle.reset(); instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
        tree.links.new(source.outputs['Image'], instance.inputs['Image'])
        tree.links.new(instance.outputs[name], sink.inputs[0]); save('color-key-group-' + name.lower(), source)
    refusals = []
    sink, source, node = setup()
    tree.links.new(node.outputs[0], sink.inputs[0])
    oracle.scene.render.compositor_device = 'GPU'
    try:
        before = fingerprint(tree); result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any('CPU source compositing' in d['message'] for d in result['diagnostics']), result
        assert before == fingerprint(tree); refusals.append(result['diagnostics'])
    finally:
        oracle.scene.render.compositor_device = 'CPU'

    if oracle.modern:
        sink, source, node = setup()
        tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'], node.inputs['Hue'])
        tree.links.new(node.outputs[0], sink.inputs[0]); before = fingerprint(tree)
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'unsupported' and any('fixed scalar' in d['message'] for d in result['diagnostics']), result
        assert before == fingerprint(tree); refusals.append(result['diagnostics'])
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    paths = [Path(__file__).resolve(), Path(compositor_graph.__file__).resolve(),
        Path(compositor_graph.__file__).with_name('compositor_color_key.py'), Path(__file__).with_name('compositor_reference.py')]
    (output / 'qualification.json').write_text(json.dumps({'sourcePreservedDuringExtraction': True,
        'sceneEngine': oracle.scene.render.engine, 'blenderVersion': list(bpy.app.version),
        'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend, 'cases': len(oracle.rows),
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_COLOR_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_COLOR_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-color-key-') as directory: main(Path(directory))
