# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_PIXELATE_PASSED
"""Actual native block means, partial edges, constants and finite canvases."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    device = os.environ.get('BLENDLINK_COMPOSITOR_PIXELATE_DEVICE', 'CPU')
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    def oracle_for(width, height):
        data = np.random.default_rng(9151 + width * 19 + height).uniform(-2, 4, (height, width, 4)).astype(np.float32)
        data[..., 3] = np.resize(np.asarray([0, -.5, .125, .5, 1, 2], np.float32), (height, width))
        return NativeCompositorReference(output, pixels=data, device=device, name='Native Pixelate', image_only_scene=True, node_previews=False)
    def pixelate(tree, color, size):
        node = tree.nodes.new('CompositorNodePixelate')
        if 'Size' in node.inputs: node.inputs['Size'].default_value = size
        else: node.pixel_size = size
        tree.links.new(color, node.inputs['Color'])
        return node
    def save(oracle, label, source):
        before = repr([(n.name, n.bl_idname, getattr(n, 'pixel_size', None), [(s.identifier, repr(getattr(s, 'default_value', None))) for s in n.inputs]) for n in oracle.tree.nodes])
        counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        assert compositor_graph.extract(oracle.scene)['status'] == 'extracted'
        assert before == repr([(n.name, n.bl_idname, getattr(n, 'pixel_size', None), [(s.identifier, repr(getattr(s, 'default_value', None))) for s in n.inputs]) for n in oracle.tree.nodes])
        assert counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(label, source)
        path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
        document.update(fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), assertTextureCleanup=True,
            assertMrtState=True, assertShaderCost={'maxPasses': 7, 'maxFragmentBytes': 22000})
        path.write_text(json.dumps(document, separators=(',', ':'))); rows.append(oracle.rows[-1])
        return document
    for width, height in ((8, 8), (13, 7), (4, 4)):
        oracle = oracle_for(width, height); tree = oracle.tree
        for size in (1, 2, 3, 4, 5, 8, 16):
            sink, source = oracle.reset(); node = pixelate(tree, source.outputs['Image'], size)
            tree.links.new(node.outputs[0], sink.inputs[0]); save(oracle, f'pixelate-{width}x{height}-{size}', source)
    oracle = oracle_for(8, 8); tree = oracle.tree
    for size in (1, 3, 16):
        for color in ((.125, .5, 2, -.5), (-1, 2, .375, 2), (0, 0, 0, 0)):
            sink, source = oracle.reset(); node = pixelate(tree, oracle.color(color), size)
            tree.links.new(node.outputs[0], sink.inputs[0]); save(oracle, f'pixelate-constant-{size}-{len(rows)}', source)
    for kind in ('exposure', 'posterize', 'before-blur', 'after-blur', 'cascade'):
        sink, source = oracle.reset(); color = source.outputs['Image']
        if kind == 'after-blur':
            blur = tree.nodes.new('CompositorNodeBlur')
            if oracle.modern: blur.inputs['Size'].default_value = (2, 3)
            else: blur.size_x, blur.size_y = 2, 3
            tree.links.new(color, blur.inputs['Image']); color = blur.outputs[0]
        node = pixelate(tree, color, 3); color = node.outputs[0]
        if kind == 'cascade': color = pixelate(tree, color, 2).outputs[0]
        elif kind != 'after-blur':
            post = tree.nodes.new({'exposure': 'CompositorNodeExposure', 'posterize': 'CompositorNodePosterize', 'before-blur': 'CompositorNodeBlur'}[kind])
            if kind == 'exposure': post.inputs['Exposure'].default_value = 1
            if kind == 'posterize': post.inputs['Steps'].default_value = 7
            if kind == 'before-blur':
                if oracle.modern: post.inputs['Size'].default_value = (2, 3)
                else: post.size_x, post.size_y = 2, 3
            tree.links.new(color, post.inputs['Image']); color = post.outputs[0]
        tree.links.new(color, sink.inputs[0]); save(oracle, 'pixelate-' + kind, source)
    for refusal in ('size', 'border', 'linked', 'half'):
        sink, source = oracle.reset(); node = pixelate(tree, source.outputs['Image'], 3); tree.links.new(node.outputs[0], sink.inputs[0])
        if refusal == 'size':
            if 'Size' in node.inputs: node.inputs['Size'].default_value = 17
            else: node.pixel_size = 17
        elif refusal == 'border': oracle.scene.render.use_border = True
        elif refusal == 'linked':
            if not oracle.modern: continue
            tree.links.new(oracle.value(3), node.inputs['Size'])
        elif refusal == 'half':
            if device != 'GPU' or 'HALF' not in oracle.scene.render.bl_rna.properties['compositor_precision'].enum_items.keys(): continue
            oracle.scene.render.compositor_precision = 'HALF'
        rejected = compositor_graph.extract(oracle.scene)
        assert rejected['status'] == 'unsupported' and any('Pixelate' in d['message'] for d in rejected['diagnostics']), (refusal, rejected)
        oracle.scene.render.use_border = False; oracle.scene.render.compositor_precision = 'FULL'
    oracle = oracle_for(8, 8); tree = oracle.tree
    sink, source = oracle.reset()
    group = bpy.data.node_groups.new('Artist Pixelate Group', 'CompositorNodeTree')
    group.interface.new_socket(name='Color', in_out='INPUT', socket_type='NodeSocketColor')
    group.interface.new_socket(name='Color', in_out='OUTPUT', socket_type='NodeSocketColor')
    group_input = group.nodes.new('NodeGroupInput'); group_output = group.nodes.new('NodeGroupOutput')
    grouped = pixelate(group, group_input.outputs[0], 3); group.links.new(grouped.outputs[0], group_output.inputs[0])
    instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
    tree.links.new(source.outputs['Image'], instance.inputs[0]); tree.links.new(instance.outputs[0], sink.inputs[0])
    save(oracle, 'pixelate-group', source)

    for size in (1, 3):
        oracle = oracle_for(16, 12); tree = oracle.tree
        oracle.scene.render.use_compositing = False; oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], np.float32).reshape(12, 16, 4)
        bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source = oracle.reset(); node = pixelate(tree, source.outputs['Image'], size)
        tree.links.new(node.outputs[0], sink.inputs[0]); unused = tree.nodes.new('CompositorNodeRLayers')
        save(oracle, 'pixelate-actual-eevee-' + str(size), unused)

    frames, first = [], None
    for index, (width, height) in enumerate(((8, 8), (8, 8), (12, 10), (7, 13), (4, 4), (8, 8))):
        oracle = oracle_for(width, height); tree = oracle.tree
        sink, source = oracle.reset(); node = pixelate(tree, source.outputs['Image'], 3)
        tree.links.new(node.outputs[0], sink.inputs[0]); document = save(oracle, f'pixelate-resize-native-{index}', source)
        first = first or document; frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
        if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
        frames.append(frame)
        if index == 3:
            frames.append({'width': width, 'height': height, 'logicalWidth': width + 2, 'input': document['input'],
                'expected': [], 'nativeOracle': False, 'expectError': 'matching source/render image extents'})
    for declared in (False, True):
        first.update(case=oracle.prefix + '-pixelate-responsive-' + str(int(declared)), resizeFrames=frames)
        if declared: first.update(sourceAsPointwise=True, passExtentMode='input-texture')
        (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    print('BLENDLINK_COMPOSITOR_PIXELATE_PASSED ' + json.dumps({'version': bpy.app.version_string, 'device': device, 'cases': len(rows)}))


if __name__ == '__main__':
    main(Path(os.environ.get('BLENDLINK_COMPOSITOR_PIXELATE_REFERENCES') or tempfile.mkdtemp(prefix='blendlink-native-pixelate-')))
