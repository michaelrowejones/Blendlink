# SPDX-License-Identifier: GPL-3.0-or-later
"""Color Spill native fields, constants, alpha and legacy CPU factor semantics."""
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
        [(k, getattr(n, k)) for k in ('channel', 'limit_method', 'limit_channel', 'ratio',
            'use_unspill', 'unspill_red', 'unspill_green', 'unspill_blue') if hasattr(n, k)]) for n in tree.nodes]) + repr([
        (l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier) for l in tree.links])


def main(output):
    pixels = np.random.default_rng(81427).uniform(-2, 4, (8, 16, 4)).astype(np.float32)
    pixels[..., 3] = np.asarray([-1, -.5, -0., 0, 2**-20, .125, .3, .5, .75, 1, 1.5, 2, 3, -.25, .1, .9], np.float32)[None, :]
    pixels[0, :, :3] = np.asarray([[0, 0, 0], [1, 1, 1], [-1, -1, -1], [2, 1, 0],
        [0, 2, 1], [1, 0, 2], [-2, 1, -1], [1, -2, -1]] * 2, np.float32)
    oracle = NativeCompositorReference(output, name='Native Color Spill', pixels=pixels,
        device=os.environ.get('BLENDLINK_COMPOSITOR_SPILL_DEVICE', 'CPU'))
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    tree = oracle.tree

    def setup(channel='G', method='Single', limit='R', ratio=1, strength=None, factor=1, constant=False):
        sink, source = oracle.reset()
        node = tree.nodes.new('CompositorNodeColorSpill'); node.name = 'Artist Color Spill'
        tree.links.new(oracle.color((-.25, 2, .5, -.5)) if constant else source.outputs['Image'], node.inputs['Image'])
        tree.links.new(oracle.separate(source.outputs['Image']).outputs['Alpha'] if factor == 'field' else oracle.value(factor), node.inputs['Fac'])
        if oracle.modern:
            for name, value in [('Spill Channel', channel), ('Limit Method', method), ('Limit Channel', limit),
                    ('Limit Strength', ratio), ('Use Spill Strength', strength is not None),
                    ('Spill Strength', (*strength, .2) if strength is not None else (1, .5, .25, .2))]:
                node.inputs[name].default_value = value
        else:
            node.channel, node.limit_method, node.limit_channel = channel, {'Single':'SIMPLE','Average':'AVERAGE'}[method], limit
            node.ratio, node.use_unspill = ratio, strength is not None
            # Extraction must not perform the legacy renderer's mutation of
            # these inactive properties when custom strength is disabled.
            node.unspill_red, node.unspill_green, node.unspill_blue = strength or (1, .5, .25)
        tree.links.new(node.outputs['Image'], sink.inputs[0])
        return sink, source, node

    def save(label, source):
        before = fingerprint(tree)
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
        assert before == fingerprint(tree), label
        oracle.save(label, source, exact_alpha=True)

    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0])
    save('color-spill-independent-control', source)
    for channel in 'RGB':
        for method, limit in [('Single', 'R'), ('Single', 'G'), ('Single', 'B'), ('Average', 'R')]:
            for custom in [None, (.5, 1.25, -.25)]:
                sink, source, node = setup(channel, method, limit, strength=custom, factor='field')
                save(f'color-spill-{channel}-{method}-{limit}-custom{int(custom is not None)}'.lower(), source)
    for factor in [-.5, 0, .25, 1, 2]:
        for ratio in [0, .5, 2]:
            for constant in [False, True]:
                sink, source, node = setup(ratio=ratio, factor=factor, constant=constant)
                save(f'color-spill-factor{factor}-ratio{ratio}-constant{int(constant)}', source)
    for strength in [(-2, 2, -1), (0, 0, 0)]:
        sink, source, node = setup('B', 'Average', strength=strength, factor=.25)
        save('color-spill-strength-' + str(strength[0]), source)
    sink, source, node = setup(strength=(1, .5, .25), factor=.25)
    second = tree.nodes.new('CompositorNodeColorSpill')
    tree.links.new(node.outputs['Image'], second.inputs['Image'])
    tree.links.new(second.outputs[0], sink.inputs[0]); save('color-spill-cascade', source)
    if oracle.modern:
        sink, source, node = setup(method='Average')
        tree.links.new(oracle.color((1, 2, 3, 4)), node.inputs['Spill Strength'])
        save('color-spill-ignore-inactive-strength', source)

    refusals = []
    if oracle.modern:
        for name in ['Limit Strength', 'Use Spill Strength', 'Spill Strength']:
            sink, source, node = setup(strength=(1, .5, .25))
            tree.links.new(oracle.separate(source.outputs['Image']).outputs['Red'], node.inputs[name])
            before = fingerprint(tree); result = compositor_graph.extract(oracle.scene)
            assert result['status'] == 'unsupported' and any('Color Spill' in d['message'] for d in result['diagnostics']), result
            assert before == fingerprint(tree); refusals.append(result['diagnostics'])
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    paths = [Path(__file__).resolve(), Path(compositor_graph.__file__).resolve(),
        Path(compositor_graph.__file__).with_name('compositor_spill.py')]
    (output / 'qualification.json').write_text(json.dumps({'sourcePreservedDuringExtraction': True,
        'sceneEngine': oracle.scene.render.engine, 'blenderVersion': list(bpy.app.version),
        'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend, 'cases': len(oracle.rows),
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_SPILL_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_SPILL_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-color-spill-') as directory: main(Path(directory))
