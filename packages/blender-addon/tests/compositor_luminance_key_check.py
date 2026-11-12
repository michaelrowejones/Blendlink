# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual luminance-key Image/Matte output, alpha and threshold boundaries."""
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
        device=os.environ.get('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_DEVICE', 'CPU'))
    engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
    oracle.scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
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

    def save(label, source):
        before = fingerprint(tree)
        groups = [(group.name, fingerprint(group)) for group in bpy.data.node_groups]
        result = compositor_graph.extract(oracle.scene)
        assert result['status'] == 'extracted', (label, result)
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
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    paths = [Path(__file__).resolve(), Path(compositor_graph.__file__).resolve(),
        Path(compositor_graph.__file__).with_name('compositor_luminance_key.py')]
    (output / 'qualification.json').write_text(json.dumps({'sourcePreserved': True,
        'sceneEngine': oracle.scene.render.engine, 'blenderVersion': list(bpy.app.version),
        'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend,
        'cases': len(oracle.rows), 'refusals': len(refusals),
        'sha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_LUMINANCE_KEY_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-luminance-key-') as directory: main(Path(directory))
