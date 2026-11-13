# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_CROP_PASSED
"""Actual native transparent Crop pixels, finite domains and responsive extents."""
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
    device = os.environ.get('BLENDLINK_COMPOSITOR_CROP_DEVICE', 'CPU')
    rows, profiles, refusal_records = [], [], []
    def oracle_for(width=8, height=8):
        pixels = np.random.default_rng(32513 + width * 13 + height).uniform(-.5, 3, (height, width, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([0, -.5, .125, .5, 1, 2], np.float32), (height, width))
        oracle = NativeCompositorReference(output, pixels=pixels, device=device, name='Native transparent Crop', image_only_scene=True)
        oracle.scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version < (5, 0) else 'BLENDER_EEVEE'
        oracle.scene.eevee.taa_render_samples = 1
        return oracle

    def crop(oracle, tree, color, rectangle, relative=False):
        node = tree.nodes.new('CompositorNodeCrop')
        if oracle.modern:
            for key, number in zip(('X', 'Y', 'Width', 'Height'), rectangle): node.inputs[key].default_value = number
            node.inputs['Alpha Crop'].default_value = True
        else:
            node.use_crop_size = False; node.relative = relative
            for key, number in zip(('min_x', 'max_y', 'max_x', 'min_y'), rectangle):
                setattr(node, ('rel_' if relative else '') + key, number)
        tree.links.new(color, node.inputs['Image'])
        return node

    def save(oracle, name, source, *, exact=True):
        def state():
            return repr([(node.name, node.bl_idname, list(node.items()),
                [(socket.identifier, repr(getattr(socket, 'default_value', None))) for socket in node.inputs],
                [(key, getattr(node, key)) for key in ('relative', 'use_crop_size', 'min_x', 'min_y', 'max_x', 'max_y',
                    'rel_min_x', 'rel_min_y', 'rel_max_x', 'rel_max_y') if hasattr(node, key)]) for node in oracle.tree.nodes])
        before = state()
        pixels = np.asarray(oracle.image.pixels[:], np.float32).tobytes()
        counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        compositor_graph.extract(oracle.scene)
        assert before == state()
        assert pixels == np.asarray(oracle.image.pixels[:], np.float32).tobytes()
        assert counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(name, source, exact_alpha=exact)
        path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
        document.update(assertTextureCleanup=True, assertMrtState=True,
                        assertShaderCost={'maxPasses': 7, 'maxFragmentBytes': 16000},
                        fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(document, separators=(',', ':')))
        rows.append(oracle.rows[-1]); profiles.append(oracle.render_profiles[-1])
        return document

    for width, height in ((8, 8), (13, 7)):
        oracle = oracle_for(width, height); tree = oracle.tree
        rectangles = [(0, 0, width, height), (2, 1, 4, 3), (6, 2, 12, 9), (3, 2, 1, 1),
                      (2, 1, 0, 3), (100, 100, 30, 20), (-2, -3, 6, 4), (2, 1, -5, -6), (0, 0, 1920, 1080)] if oracle.modern else [
                      (0, 0, width, height), (2, 1, 6, 4), (6, 2, 12, 9), (3, 2, 4, 3),
                      (2, 1, 2, 4), (100, 100, 130, 120), (6, 5, 2, 1)]
        for index, rectangle in enumerate(rectangles):
            sink, source = oracle.reset(); node = crop(oracle, tree, source.outputs['Image'], rectangle)
            tree.links.new(node.outputs[0], sink.inputs[0]); save(oracle, f'crop-mask-{width}x{height}-{index}', source)
        if not oracle.modern:
            fractions = [(.125, .25, .75, .875), (.75, .75, .25, .25), (0, 0, 1, 1)]
            if width == 13:
                edge = np.float32(3 / width)
                fractions += [(float(np.nextafter(edge, np.float32(direction))), 0, 1, 1) for direction in (-np.inf, np.inf)]
            for index, rectangle in enumerate(fractions):
                sink, source = oracle.reset(); node = crop(oracle, tree, source.outputs['Image'], rectangle, True)
                tree.links.new(node.outputs[0], sink.inputs[0]); save(oracle, f'crop-relative-{width}x{height}-{index}', source)

    oracle = oracle_for(); tree = oracle.tree
    rectangle = (2, 1, 4, 3) if oracle.modern else (2, 1, 6, 4)
    for kind in ('after-exposure', 'before-posterize', 'before-exposure', 'before-over', 'before-blur', 'after-blur', 'before-flip', 'after-flip', 'cascade', 'constant', 'group'):
        sink, source = oracle.reset(); color = source.outputs['Image']
        if kind == 'constant':
            color = oracle.color((-.25, .5, 2, 0))
            if not oracle.modern and device == 'CPU':
                node = crop(oracle, tree, color, rectangle); tree.links.new(node.outputs[0], sink.inputs[0])
                rejected = compositor_graph.extract(oracle.scene)
                assert rejected['status'] == 'unsupported' and 'finite image' in str(rejected)
                continue
        if kind in ('after-exposure', 'after-blur', 'after-flip'):
            previous = tree.nodes.new({'after-exposure': 'CompositorNodeExposure', 'after-blur': 'CompositorNodeBlur', 'after-flip': 'CompositorNodeFlip'}[kind])
            if kind == 'after-exposure': previous.inputs['Exposure'].default_value = 1
            if kind == 'after-blur':
                if oracle.modern: previous.inputs['Size'].default_value = (2, 3)
                else: previous.size_x, previous.size_y = 2, 3
            tree.links.new(color, previous.inputs['Image']); color = previous.outputs[0]
        if kind == 'group':
            group = bpy.data.node_groups.new('Artist Crop Group', 'CompositorNodeTree')
            group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
            group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
            group_input = group.nodes.new('NodeGroupInput'); group_output = group.nodes.new('NodeGroupOutput')
            node = crop(oracle, group, group_input.outputs[0], rectangle); group.links.new(node.outputs[0], group_output.inputs[0])
            instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
            tree.links.new(color, instance.inputs[0]); color = instance.outputs[0]
        else: color = crop(oracle, tree, color, rectangle).outputs[0]
        if kind == 'cascade': color = crop(oracle, tree, color, (0, 0, 4, 3)).outputs[0]
        if kind.startswith('before-'):
            post = tree.nodes.new({'before-posterize': 'CompositorNodePosterize', 'before-exposure': 'CompositorNodeExposure',
                'before-over': 'CompositorNodeAlphaOver', 'before-blur': 'CompositorNodeBlur', 'before-flip': 'CompositorNodeFlip'}[kind])
            if kind == 'before-exposure': post.inputs['Exposure'].default_value = 1
            if kind == 'before-posterize': post.inputs['Steps'].default_value = 7
            if kind == 'before-blur':
                if oracle.modern: post.inputs['Size'].default_value = (2, 3)
                else: post.size_x, post.size_y = 2, 3
            if kind == 'before-over':
                tree.links.new(oracle.color((.25, .5, .75, 1)), post.inputs['Background' if oracle.modern else 'Image'])
            tree.links.new(color, post.inputs['Foreground' if kind == 'before-over' and oracle.modern else 'Image_001' if kind == 'before-over' else 'Image'])
            color = post.outputs[0]
        tree.links.new(color, sink.inputs[0]); save(oracle, 'crop-mask-' + kind, source, exact=kind not in {'before-blur', 'after-blur'})

    # Source-level named refusals: resizing, dynamic settings, borders and
    # transformed input-local windows may not silently become a viewport mask.
    for refusal in ('resize', 'linked', 'border', 'translate', 'half'):
        sink, source = oracle.reset(); color = source.outputs['Image']
        if refusal == 'translate':
            move = tree.nodes.new('CompositorNodeTranslate'); move.inputs['X'].default_value = 2
            tree.links.new(color, move.inputs['Image']); color = move.outputs[0]
        node = crop(oracle, tree, color, rectangle); tree.links.new(node.outputs[0], sink.inputs[0])
        if refusal == 'resize':
            if oracle.modern: node.inputs['Alpha Crop'].default_value = False
            else: node.use_crop_size = True
            if oracle.modern and device == 'CPU':
                assert compositor_graph.extract(oracle.scene)['status'] == 'extracted'
                continue
        if refusal == 'linked':
            if not oracle.modern: continue
            tree.links.new(oracle.value(2), node.inputs['X'])
        if refusal == 'border': oracle.scene.render.use_border = True
        if refusal == 'half':
            if device != 'GPU' or 'HALF' not in oracle.scene.render.bl_rna.properties['compositor_precision'].enum_items.keys(): continue
            oracle.scene.render.compositor_precision = 'HALF'
        rejected = compositor_graph.extract(oracle.scene)
        backend = getattr(bpy.context.preferences.system, 'gpu_backend', 'UNKNOWN')
        upstream_translate = (refusal == 'translate' and oracle.modern and device == 'GPU' and backend != 'METAL'
            and any(item.get('code') == 'unsupported-transform-mode'
                and item.get('nodeType') == 'CompositorNodeTranslate'
                and item.get('message') == 'Filtered/fractional Translate requires a verified native GPU sampler; this backend has not been calibrated'
                for item in rejected['diagnostics']))
        assert rejected['status'] == 'unsupported' and (upstream_translate
            or any('Crop' in item['message'] for item in rejected['diagnostics'])), (refusal, rejected)
        refusal_records.append({'case': refusal, 'device': device, 'backend': backend,
            'upstreamTranslateDiagnostic': upstream_translate, 'diagnostics': rejected['diagnostics']})
        oracle.scene.render.use_border = False
        oracle.scene.render.compositor_precision = 'FULL'

    # CPU Static Image stays on its authored canvas, before terminal padding or
    # scaling. GPU Image input remains explicitly outside its existing port.
    if device == 'CPU':
        for source_width, source_height in ((4, 4), (8, 8), (16, 12)):
            image = bpy.data.images.new('Artist crop source', width=source_width, height=source_height, alpha=True, float_buffer=True)
            image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
            pixels = np.random.default_rng(903 + source_width).uniform(-.5, 3, (source_height, source_width, 4)).astype(np.float32)
            pixels[..., 3] = np.resize(np.asarray([0, -.5, .125, .5, 1, 2], np.float32), (source_height, source_width))
            image.pixels.foreach_set(pixels.ravel())
            for effect in (False, True):
                sink, unused = oracle.reset(); source = tree.nodes.new('CompositorNodeImage'); source.image = image
                node = crop(oracle, tree, source.outputs['Image'], rectangle); color = node.outputs[0]
                if effect:
                    post = tree.nodes.new('CompositorNodeExposure'); post.inputs['Exposure'].default_value = 1
                    tree.links.new(color, post.inputs['Image']); color = post.outputs[0]
                tree.links.new(color, sink.inputs[0]); save(oracle, f'crop-static-{source_width}x{source_height}-{int(effect)}', unused, exact=False)

    # Actual EEVEE Render Layers control, without the synthetic Image replacement
    # used for adversarial HDR fields above. Its input EXR is captured separately.
    for effect in (False, True):
        oracle = oracle_for(16, 12); tree = oracle.tree
        oracle.scene.render.use_compositing = False
        oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], np.float32).reshape(12, 16, 4)
        bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source = oracle.reset(); node = crop(oracle, tree, source.outputs['Image'], rectangle)
        color = node.outputs[0]
        if effect:
            post = tree.nodes.new('CompositorNodeExposure'); post.inputs['Exposure'].default_value = 1
            tree.links.new(color, post.inputs['Image']); color = post.outputs[0]
        tree.links.new(color, sink.inputs[0])
        unused = tree.nodes.new('CompositorNodeRLayers')
        save(oracle, 'crop-actual-eevee-render-layers-' + str(int(effect)), unused, exact=False)

    # Same compiled graph handles native re-renders at physical pixel extents,
    # including DPR2 and a rejected mismatching source extent then recovery.
    modes = ['pixels'] + (['relative'] if bpy.app.version < (5, 0) else []) + (['static'] if device == 'CPU' else [])
    for mode in modes:
        frames = []; first = None
        extents = ((8, 8), (8, 8), (12, 10), (8, 14) if mode == 'static' and bpy.app.version < (5, 0) else (7, 13), (8, 8))
        for index, (width, height) in enumerate(extents):
            oracle = oracle_for(width, height); tree = oracle.tree
            sink, source = oracle.reset(); color = source.outputs['Image']
            if mode == 'static':
                image = bpy.data.images.new('Responsive artist Image', width=4, height=4, alpha=True, float_buffer=True)
                image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
                image.pixels.foreach_set(np.random.default_rng(1741).uniform(-.5, 2, 64).astype(np.float32))
                static = tree.nodes.new('CompositorNodeImage'); static.image = image; color = static.outputs['Image']
            node = crop(oracle, tree, color, (.125, .25, .75, .875) if mode == 'relative' else rectangle, mode == 'relative')
            tree.links.new(node.outputs[0], sink.inputs[0])
            document = save(oracle, f'crop-resize-{mode}-native-{width}x{height}-{len(frames)}', source, exact=mode != 'static')
            first = first or document
            frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
            if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
            frames.append(frame)
            if index == 3 and mode != 'static':
                frames.append({'width': width, 'height': height, 'logicalWidth': width + 2,
                    'input': document['input'], 'expected': [], 'nativeOracle': False,
                    'expectError': 'matching source/render image extents'})
            if index == 3 and mode == 'static' and bpy.app.version < (5, 0):
                frames.append({'width': width, 'height': height, 'logicalWidth': width - 1,
                    'input': document['input'], 'expected': [], 'nativeOracle': False,
                    'expectError': 'even source and drawing-buffer dimensions'})
        first['case'] = oracle.prefix + '-crop-mask-responsive-' + mode; first['resizeFrames'] = frames
        first['assertStaticImageCache'] = False
        (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
        if mode != 'static':
            first.update(case=first['case'] + '-declared', sourceAsPointwise=True, passExtentMode='input-texture')
            (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    (output / 'render-profile.json').write_text(json.dumps(profiles, indent=2))
    (output / 'refusals.json').write_text(json.dumps(refusal_records, indent=2))
    print('BLENDLINK_COMPOSITOR_CROP_PASSED ' + json.dumps({'version': bpy.app.version_string, 'device': device, 'cases': len(rows)}))


destination = os.environ.get('BLENDLINK_COMPOSITOR_CROP_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-crop-') as directory: main(Path(directory))
