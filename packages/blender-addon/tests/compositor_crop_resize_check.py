# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_CROP_RESIZE_PASSED
"""Pinned modern CPU resized Crop finite windows and terminal realization."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    device = os.environ.get('BLENDLINK_COMPOSITOR_CROP_RESIZE_DEVICE', 'CPU')
    if bpy.app.version[:2] not in {(5, 2), (5, 3)} or device != 'CPU':
        reason = 'Resized Crop currently qualifies only Blender 5.2/5.3 CPU; legacy/GPU finite windows remain separate'
        (output / 'index.json').write_text('[]')
        print('BLENDLINK_COMPOSITOR_CROP_RESIZE_NOT_APPLICABLE ' + json.dumps({'version': bpy.app.version_string, 'device': device, 'reason': reason}))
        print('BLENDLINK_COMPOSITOR_CROP_RESIZE_PASSED ' + json.dumps({'cases': 0, 'reason': reason}))
        return
    rows = []
    def new_oracle(width=8, height=8):
        pixels = np.random.default_rng(433851 + width * 131 + height).uniform(-.5, 3, (height, width, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([0, -.5, .125, .5, 1, 2], np.float32), (height, width))
        oracle = NativeCompositorReference(output, pixels=pixels, device=device, name='Native resized Crop', image_only_scene=True)
        oracle.scene.render.engine = 'BLENDER_EEVEE'; oracle.scene.eevee.taa_render_samples = 1
        return oracle
    def crop(oracle, tree, color, rectangle=None):
        node = tree.nodes.new('CompositorNodeCrop')
        if rectangle is not None:
            for key, number in zip(('X', 'Y', 'Width', 'Height'), rectangle): node.inputs[key].default_value = number
        assert node.inputs['Alpha Crop'].default_value is False
        tree.links.new(color, node.inputs['Image'])
        return node.outputs[0]
    def save(oracle, label, source):
        tree = oracle.tree
        before = repr([(node.name, node.bl_idname,
            [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs]) for node in tree.nodes])
        original = np.asarray(oracle.image.pixels[:], np.float32).tobytes()
        counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        program = compositor_graph.extract(oracle.scene); assert program['status'] == 'extracted', program
        assert before == repr([(node.name, node.bl_idname,
            [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs]) for node in tree.nodes])
        assert original == np.asarray(oracle.image.pixels[:], np.float32).tobytes()
        assert counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(label, source)
        path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
        document.update(assertTextureCleanup=True, assertMrtState=True,
            assertShaderCost={'maxPasses': 5, 'maxFragmentBytes': 16000},
            fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(document, separators=(',', ':'))); rows.append(oracle.rows[-1])
        return document
    rectangles = [None, (0, 0, 8, 8), (2, 2, 4, 4), (2, 1, 4, 3), (-2, -3, 6, 4),
                  (6, 2, 6, 4), (-2, -2, 12, 12), (3, 2, 1, 1), (2, 1, 0, 3),
                  (2, 1, -5, -6), (100, 100, 40, 50)]
    for width, height in ((8, 8), (13, 7), (16, 12)):
        oracle = new_oracle(width, height); tree = oracle.tree
        for index, rectangle in enumerate(rectangles):
            sink, source = oracle.reset(); color = crop(oracle, tree, source.outputs['Image'], rectangle)
            tree.links.new(color, sink.inputs[0]); save(oracle, f'crop-size-{width}x{height}-{index}', source)
    oracle = new_oracle(); tree = oracle.tree
    # This is a source-emitter refusal unit, not evidence from a future Blender.
    # Current real RNA/scene are untouched while only the helper's version view
    # is replaced, proving schema resemblance alone cannot admit a future model.
    sink, source = oracle.reset(); crop(oracle, tree, source.outputs[0])
    candidate = next(node for node in tree.nodes if node.bl_idname == 'CompositorNodeCrop')
    scope = compositor_graph.normalize_crop.__globals__; original_bpy = scope['bpy']
    class VersionRefused(Exception): pass
    def refuse(_socket, message): raise VersionRefused(message)
    try:
        scope['bpy'] = SimpleNamespace(app=SimpleNamespace(version=(5, 4, 0)))
        try:
            compositor_graph.normalize_crop(candidate, {}, oracle.scene, lambda _socket: None, refuse)
            raise AssertionError('An unmeasured source version was admitted')
        except VersionRefused as error: assert 'unqualified rectangle/empty-window semantics' in str(error)
    finally: scope['bpy'] = original_bpy
    oracle.scene.render.compositor_device = 'GPU'
    tree.links.new(candidate.outputs[0], sink.inputs[0])
    rejected = compositor_graph.extract(oracle.scene)
    assert rejected['status'] == 'unsupported' and 'modern CPU compositor' in str(rejected), rejected
    oracle.scene.render.compositor_device = 'CPU'
    for kind in ('constant', 'after-exposure', 'before-exposure', 'before-posterize', 'before-invert', 'before-over', 'group'):
        sink, source = oracle.reset(); color = source.outputs['Image']
        if kind == 'constant': color = oracle.color((-.25, .5, 2, 0))
        if kind == 'after-exposure':
            node = tree.nodes.new('CompositorNodeExposure'); node.inputs['Exposure'].default_value = 1
            tree.links.new(color, node.inputs['Image']); color = node.outputs[0]
        if kind == 'group':
            group = bpy.data.node_groups.new('Artist resized Crop', 'CompositorNodeTree')
            group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
            group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
            incoming = group.nodes.new('NodeGroupInput'); outgoing = group.nodes.new('NodeGroupOutput')
            cropped = crop(oracle, group, incoming.outputs[0], (2, 1, 4, 3)); group.links.new(cropped, outgoing.inputs[0])
            instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
            tree.links.new(color, instance.inputs[0]); color = instance.outputs[0]
        else: color = crop(oracle, tree, color, (2, 1, 4, 3))
        if kind.startswith('before-'):
            node = tree.nodes.new({'before-exposure': 'CompositorNodeExposure', 'before-posterize': 'CompositorNodePosterize',
                'before-invert': 'CompositorNodeInvert', 'before-over': 'CompositorNodeAlphaOver'}[kind])
            if kind == 'before-exposure': node.inputs['Exposure'].default_value = 1
            if kind == 'before-posterize': node.inputs['Steps'].default_value = 7
            if kind == 'before-over': tree.links.new(oracle.color((.25, .5, .75, 1)), node.inputs['Background'])
            tree.links.new(color, node.inputs['Foreground' if kind == 'before-over' else 'Color' if kind == 'before-invert' else 'Image'])
            color = node.outputs[0]
        tree.links.new(color, sink.inputs[0]); save(oracle, 'crop-size-' + kind, source)

    # An authored Image has its own canvas even when larger/smaller than output.
    for source_width, source_height in ((4, 4), (7, 5), (16, 12)):
        image = bpy.data.images.new('Artist finite crop', width=source_width, height=source_height, alpha=True, float_buffer=True)
        image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
        image.pixels.foreach_set(np.random.default_rng(1094 + source_width).uniform(-.5, 3, source_width * source_height * 4).astype(np.float32))
        for effect in (False, True):
            sink, unused = oracle.reset(); source = tree.nodes.new('CompositorNodeImage'); source.image = image
            color = crop(oracle, tree, source.outputs[0], (1, 1, 3, 2))
            if effect:
                node = tree.nodes.new('CompositorNodeInvert'); tree.links.new(color, node.inputs['Color']); color = node.outputs[0]
            tree.links.new(color, sink.inputs[0]); save(oracle, f'crop-size-static-{source_width}x{source_height}-{int(effect)}', unused)
    for kind in ('blur', 'flip', 'translate', 'cascade', 'mixed-field'):
        sink, source = oracle.reset(); color = crop(oracle, tree, source.outputs[0], (2, 1, 4, 3))
        node = tree.nodes.new({'blur': 'CompositorNodeBlur', 'flip': 'CompositorNodeFlip', 'translate': 'CompositorNodeTranslate',
            'cascade': 'CompositorNodeCrop', 'mixed-field': 'CompositorNodeAlphaOver'}[kind])
        if kind == 'mixed-field': tree.links.new(source.outputs[0], node.inputs['Background'])
        tree.links.new(color, node.inputs['Foreground' if kind == 'mixed-field' else 'Image'])
        tree.links.new(node.outputs[0], sink.inputs[0]); rejected = compositor_graph.extract(oracle.scene)
        assert rejected['status'] == 'unsupported' and any('Crop' in item['message'] for item in rejected['diagnostics']), rejected

    # Capture actual EEVEE Render Layers input separately, without synthetic
    # image replacement, for both the untouched default and an odd cropped size.
    for index, rectangle in enumerate((None, (2, 1, 4, 3))):
        oracle = new_oracle(16, 12); tree = oracle.tree
        oracle.scene.render.use_compositing = False; oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], np.float32).reshape(12, 16, 4)
        bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source = oracle.reset(); color = crop(oracle, tree, source.outputs[0], rectangle)
        tree.links.new(color, sink.inputs[0]); unused = tree.nodes.new('CompositorNodeRLayers')
        save(oracle, 'crop-size-actual-eevee-render-layers-' + str(index), unused)

    for mode in ('inside', 'clamped', 'static'):
        frames, first = [], None
        for index, (width, height) in enumerate(((8, 8), (8, 8), (12, 10), (7, 13), (4, 4), (8, 8))):
            oracle = new_oracle(width, height); tree = oracle.tree
            sink, source = oracle.reset(); color = source.outputs[0]
            if mode == 'static':
                image = bpy.data.images.new('Same authored finite Image', width=7, height=5, alpha=True, float_buffer=True)
                image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
                image.pixels.foreach_set(np.random.default_rng(1741).uniform(-.5, 2, 7 * 5 * 4).astype(np.float32))
                node = tree.nodes.new('CompositorNodeImage'); node.image = image; color = node.outputs[0]
            color = crop(oracle, tree, color, (100, 100, 40, 50) if mode == 'clamped' else (2, 1, 4, 3))
            post = tree.nodes.new('CompositorNodeInvert'); tree.links.new(color, post.inputs['Color'])
            tree.links.new(post.outputs[0], sink.inputs[0]); document = save(oracle, f'crop-size-resize-{mode}-native-{index}', source)
            first = first or document; frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
            if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
            frames.append(frame)
            if index == 3 and mode != 'static':
                frames.append({'width': width, 'height': height, 'logicalWidth': width + 2, 'input': document['input'],
                    'expected': [], 'nativeOracle': False, 'expectError': 'matching source/render image extents'})
        first.update(case=oracle.prefix + '-crop-size-responsive-' + mode, resizeFrames=frames,
            sourceAsPointwise=True, passExtentMode='input-texture', assertStaticImageCache=False)
        (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    print('BLENDLINK_COMPOSITOR_CROP_RESIZE_PASSED ' + json.dumps({'version': bpy.app.version_string, 'device': device, 'cases': len(rows)}))


destination = os.environ.get('BLENDLINK_COMPOSITOR_CROP_RESIZE_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-crop-resize-') as directory: main(Path(directory))
