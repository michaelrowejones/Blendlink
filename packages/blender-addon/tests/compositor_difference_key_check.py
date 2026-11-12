# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Difference Key image/matte, signed alpha and threshold boundaries."""
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
    return repr([(node.name, node.bl_idname,
        [(socket.identifier, str(getattr(socket, 'default_value', None))) for socket in node.inputs],
        [(name, getattr(node, name)) for name in ('tolerance', 'falloff') if hasattr(node, name)]) for node in tree.nodes]) + repr([
        (link.from_node.name, link.from_socket.identifier, link.to_node.name, link.to_socket.identifier) for link in tree.links])


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
        device=os.environ.get('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_DEVICE', 'CPU'))
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    tree = oracle.tree

    def setup(tolerance, falloff, color_mode='field', linked=False, key_alpha=0, zero_key=False):
        sink, source = oracle.reset()
        node = tree.nodes.new('CompositorNodeDiffMatte'); node.name = 'Artist Difference Key'
        color = source.outputs['Image'] if color_mode != 'constant' else oracle.color((.2, .2, .2, 2) if zero_key else (.375, .625, .875, -.5))
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

    def save(label, source):
        before = fingerprint(tree); groups = [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
        assert before == fingerprint(tree) and groups == [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        oracle.save(label, source)

    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0])
    save('difference-key-independent-control', source)
    for tolerance, falloff in [(0, .125), (.125, .25), (.5, 1/64), (.125, 0), (.1, .1)]:
        for name in ['Image', 'Matte']:
            for mode in ['field', 'constant', 'both-field']:
                sink, source, node = setup(tolerance, falloff, mode)
                tree.links.new(node.outputs[name], sink.inputs[0])
                save(f'difference-key-{tolerance}-{falloff}-{name.lower()}-{mode}', source)
    for name in ['Image', 'Matte']:
        sink, source, node = setup(.125, .25, linked=oracle.modern, key_alpha=3)
        tree.links.new(node.outputs[name], sink.inputs[0]); save('difference-key-ignored-key-alpha-' + name.lower(), source)
        for mode in ['field', 'constant']:
            sink, source, node = setup(.1, .1, mode, zero_key=True)
            tree.links.new(node.outputs[name], sink.inputs[0]); save('difference-key-hdr-upper-boundary-' + name.lower() + '-' + mode, source)
    for name in ['Image', 'Matte']:
        sink, source, node = setup(.125, .25)
        second = tree.nodes.new('CompositorNodeDiffMatte')
        tree.links.new(node.outputs['Image'], second.inputs['Image 1'])
        tree.links.new(oracle.color((.25, .5, .75, 0)), second.inputs['Image 2'])
        tree.links.new(second.outputs[name], sink.inputs[0]); save('difference-key-cascade-' + name.lower(), source)

    refusals = []
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
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_DIFFERENCE_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-difference-key-') as directory: main(Path(directory))
