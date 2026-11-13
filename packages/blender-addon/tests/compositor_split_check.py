# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_COMPOSITOR_SPLIT_PASSED
"""Actual native Split boundaries, finite canvases, RGBA and responsive extents."""
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    rows, profiles, refusals = [], [], []
    device = os.environ.get('BLENDLINK_COMPOSITOR_SPLIT_DEVICE', 'CPU')
    def new_oracle(width=8, height=8):
        pixels = np.random.default_rng(77653 + width * 13 + height).uniform(-.5, 3, (height, width, 4)).astype(np.float32)
        pixels[..., 3] = np.resize(np.asarray([-.5, 0, .125, 1, 2], np.float32), (height, width))
        oracle = NativeCompositorReference(output, pixels=pixels, device=device, name='Native Split', image_only_scene=True, node_previews=False)
        oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
        return oracle
    def split(oracle, tree, a, b, setting=None):
        node = tree.nodes.new('CompositorNodeSplit'); node.name = 'Artist Split'
        if setting is not None:
            if oracle.modern: node.inputs['Position'].default_value, node.inputs['Rotation'].default_value = setting
            else: node.axis, node.factor = setting
        tree.links.new(a, node.inputs['Image']); tree.links.new(b, node.inputs['Image_001'])
        return node
    def save(oracle, label, source, *, bit=False):
        def state():
            return repr([(node.name, node.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs],
                [(name, getattr(node, name)) for name in ('axis', 'factor') if hasattr(node, name)]) for node in oracle.tree.nodes])
        before = state(); counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        program = compositor_graph.extract(oracle.scene); assert program['status'] == 'extracted', program
        assert state() == before and counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(label, source); path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
        document.update(requireFloat32Bits=bit, assertMrtState=True, assertTextureCleanup=True,
            assertShaderCost={'maxPasses': 8, 'maxFragmentBytes': 18000}, assertStaticImageCache=False,
            fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(document, separators=(',', ':')))
        rows.append(oracle.rows[-1]); profiles.append(oracle.render_profiles[-1]); return document
    oracle = new_oracle(); tree = oracle.tree
    backend = getattr(bpy.context.preferences.system, 'gpu_backend', 'UNKNOWN')
    sink, source = oracle.reset(); tree.links.new(source.outputs[0], sink.inputs[0]); save(oracle, 'split-independent-control', source, bit=True)
    if oracle.modern and device == 'GPU' and backend != 'METAL':
        sink, source = oracle.reset(); node = split(oracle, tree, source.outputs[0], oracle.color((-.25, 1, .75, 2)))
        tree.links.new(node.outputs[0], sink.inputs[0])
        def fingerprint():
            return repr(([(n.name, n.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None))) for s in n.inputs])
                for n in tree.nodes], [(link.from_node.name, link.from_socket.identifier, link.to_node.name,
                    link.to_socket.identifier) for link in tree.links]))
        before = fingerprint(); rejected = compositor_graph.extract(oracle.scene)
        message = 'Split rotated GPU lines need a verified native projection model; use the CPU compositor or source baking'
        assert rejected['status'] == 'unsupported' and len(rejected['diagnostics']) == 1, rejected
        assert rejected['diagnostics'][0]['message'] == message and fingerprint() == before, rejected
        links = [(link.from_socket, link.to_socket) for link in tree.links]
        source_links = [(link.from_socket, link.to_socket) for link in source.outputs['Image'].links]
        image = tree.nodes.new('CompositorNodeImage'); image.image = oracle.image
        try:
            for _, target in source_links: tree.links.new(image.outputs['Image'], target)
            oracle.scene.render.filepath = str(output / 'source-profile-refused.exr')
            with oracle._render_sampling(): bpy.ops.render.render(write_still=True)
            reference = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False)
            try:
                reference.alpha_mode = 'PREMUL'; expected = np.asarray(reference.pixels[:], np.float32)
                assert np.isfinite(expected).all()
            finally: bpy.data.images.remove(reference)
        finally:
            tree.nodes.remove(image); tree.links.clear()
            for incoming, target in links: tree.links.new(incoming, target)
        assert fingerprint() == before
        record = {'case': oracle.prefix + '-split-source-profile-refused-image', 'output': 'Image',
            'width': oracle.width, 'height': oracle.height, 'input': oracle.pixels.ravel().tolist(), 'expected': expected.tolist(),
            'program': rejected, 'diagnostics': rejected['diagnostics'], 'sourcePreserved': True, 'sourceFingerprint': before,
            'blenderVersion': bpy.app.version_string, 'blenderHash': bpy.app.build_hash.decode(), 'compositorDevice': device,
            'sourceBackend': backend}
        contents = json.dumps(record, separators=(',', ':')).encode(); filename = record['case'] + '.json'
        (output / filename).write_bytes(contents)
        qualification = {'protocol': 'blendlink-split-source-profile-v1', 'status': 'source-profile-refused',
            'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(), 'device': device, 'sourceBackend': backend,
            'cases': 0, 'numericalSplitCases': 0, 'controlCases': 1, 'sourcePreserved': True,
            'profileRefusals': [{'file': filename, 'sha256': hashlib.sha256(contents).hexdigest(), 'reason': message}]}
        (output / 'qualification.json').write_text(json.dumps(qualification, indent=2))
        (output / 'refusals.json').write_text(json.dumps([rejected], indent=2))
        (output / 'index.json').write_text(json.dumps(rows, indent=2))
        (output / 'render-profile.json').write_text(json.dumps(profiles, indent=2))
        print('BLENDLINK_COMPOSITOR_SPLIT_SOURCE_PROFILE_REFUSED ' + json.dumps({'cases': 0, 'controlCases': 1,
            'numericalSplitCases': 0, 'backend': backend})); return
    for width, height in ((8, 8), (13, 7), (100, 4)):
        oracle = new_oracle(width, height); tree = oracle.tree
        settings = [(position, angle) for position in ((.5, .5), (.53, .53), (0, 0), (1, 1))
            for angle in (0, math.pi / 4, math.pi / 2, -math.pi / 4, math.pi, .17, 1.23, -2.8)] if oracle.modern else [
            (axis, factor) for axis in ('X', 'Y') for factor in (0, 25, 50, 53, 100)]
        for index, setting in enumerate([None] + settings):
            sink, source = oracle.reset(); node = split(oracle, tree, source.outputs[0], oracle.color((-.25, 1, .75, 2)), setting)
            tree.links.new(node.outputs[0], sink.inputs[0]); save(oracle, f'split-{width}x{height}-{index}', source, bit=True)
    oracle = new_oracle(); tree = oracle.tree
    for kind in ('both-fields', 'first-constant', 'after-exposure', 'before-exposure', 'before-flip', 'after-flip', 'before-blur', 'after-blur', 'group', 'scalar-field'):
        sink, source = oracle.reset(); a = source.outputs[0]; b = oracle.color((-.25, 1, .75, 2))
        if kind == 'both-fields':
            separate = oracle.separate(a); combine = tree.nodes.new('CompositorNodeCombineColor')
            for incoming, name in zip(list(combine.inputs), ['Blue', 'Green', 'Red', 'Alpha']): tree.links.new(separate.outputs[name], incoming)
            b = combine.outputs[0]
        if kind == 'first-constant': a, b = b, a
        if kind == 'scalar-field': b = oracle.separate(a).outputs['Alpha']
        if kind.startswith('after-'):
            node = tree.nodes.new({'after-exposure': 'CompositorNodeExposure', 'after-flip': 'CompositorNodeFlip', 'after-blur': 'CompositorNodeBlur'}[kind])
            if kind == 'after-exposure': node.inputs['Exposure'].default_value = 1
            if kind == 'after-blur':
                if oracle.modern: node.inputs['Size'].default_value = (2, 3)
                else: node.size_x, node.size_y = 2, 3
            tree.links.new(a, node.inputs['Image']); a = node.outputs[0]
        if kind == 'group':
            group = bpy.data.node_groups.new('Artist Split Group', 'CompositorNodeTree')
            group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
            group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
            incoming = group.nodes.new('NodeGroupInput'); outgoing = group.nodes.new('NodeGroupOutput')
            node = group.nodes.new('CompositorNodeSplit'); group.links.new(incoming.outputs[0], node.inputs['Image'])
            node.inputs['Image_001'].default_value = (-.25, 1, .75, 2); group.links.new(node.outputs[0], outgoing.inputs[0])
            instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group; tree.links.new(a, instance.inputs[0]); color = instance.outputs[0]
        else: color = split(oracle, tree, a, b).outputs[0]
        if kind.startswith('before-'):
            node = tree.nodes.new({'before-exposure': 'CompositorNodeExposure', 'before-flip': 'CompositorNodeFlip', 'before-blur': 'CompositorNodeBlur'}[kind])
            if kind == 'before-exposure': node.inputs['Exposure'].default_value = 1
            if kind == 'before-blur':
                if oracle.modern: node.inputs['Size'].default_value = (2, 3)
                else: node.size_x, node.size_y = 2, 3
            tree.links.new(color, node.inputs['Image']); color = node.outputs[0]
        tree.links.new(color, sink.inputs[0]); save(oracle, 'split-' + kind, source)
    for kind in ('both-constant', 'translated', 'linked-position', 'border'):
        sink, source = oracle.reset(); a = source.outputs[0]; b = oracle.color((-.25, 1, .75, 2))
        if kind == 'both-constant': a = oracle.color((.125, .5, 2, 0))
        if kind == 'translated':
            move = tree.nodes.new('CompositorNodeTranslate'); move.inputs['X'].default_value = 2
            if oracle.modern: move.inputs['Interpolation'].default_value = 'Nearest'
            else: move.interpolation = 'Nearest'
            tree.links.new(a, move.inputs['Image']); a = move.outputs[0]
        node = split(oracle, tree, a, b); tree.links.new(node.outputs[0], sink.inputs[0])
        if kind == 'linked-position':
            if not oracle.modern: continue
            tree.links.new(oracle.value(.5), node.inputs['Rotation'])
        if kind == 'border': oracle.scene.render.use_border = True
        rejected = compositor_graph.extract(oracle.scene); assert rejected['status'] == 'unsupported' and 'Split' in str(rejected), rejected
        refusals.append({'case': kind, 'program': rejected}); oracle.scene.render.use_border = False
    if device == 'CPU':
        for size in ((4, 4), (8, 8), (16, 12)):
            image = bpy.data.images.new('Artist Split Image', width=size[0], height=size[1], alpha=True, float_buffer=True)
            image.alpha_mode = 'PREMUL'; image.colorspace_settings.name = 'Linear Rec.709'
            image.pixels.foreach_set(np.random.default_rng(7781 + size[0]).uniform(-.5, 3, size[0] * size[1] * 4).astype(np.float32))
            sink, unused = oracle.reset(); source = tree.nodes.new('CompositorNodeImage'); source.image = image
            node = split(oracle, tree, source.outputs[0], oracle.color((-.25, 1, .75, 2))); tree.links.new(node.outputs[0], sink.inputs[0])
            save(oracle, f'split-static-{size[0]}x{size[1]}', unused)
            sink, unused = oracle.reset(); source = tree.nodes.new('CompositorNodeImage'); source.image = image
            other = tree.nodes.new('CompositorNodeImage'); other.image = image
            post = tree.nodes.new('CompositorNodeExposure'); post.inputs['Exposure'].default_value = 1
            tree.links.new(other.outputs[0], post.inputs['Image'])
            node = split(oracle, tree, source.outputs[0], post.outputs[0]); tree.links.new(node.outputs[0], sink.inputs[0])
            save(oracle, f'split-static-two-fields-{size[0]}x{size[1]}', unused)
        # Independently mismatching static canvases and Render Layers/static
        # branches remain refused instead of rescaling one branch silently.
        for mixed in (False, True):
            sink, layers = oracle.reset(); a = tree.nodes.new('CompositorNodeImage'); a.image = image
            if mixed: b = layers.outputs[0]
            else:
                smaller = bpy.data.images.new('Unmatched Split Image', width=4, height=4, alpha=True, float_buffer=True)
                smaller.alpha_mode = 'PREMUL'; smaller.colorspace_settings.name = 'Linear Rec.709'
                other = tree.nodes.new('CompositorNodeImage'); other.image = smaller; b = other.outputs[0]
            node = split(oracle, tree, a.outputs[0], b); tree.links.new(node.outputs[0], sink.inputs[0])
            rejected = compositor_graph.extract(oracle.scene); assert rejected['status'] == 'unsupported', rejected
            refusals.append({'case': 'mixed-render-static' if mixed else 'mismatched-static', 'program': rejected})
    # A real EEVEE Render Layers source is captured independently. The unused
    # reader keeps save() from replacing this source with its adversarial Image.
    for effect in (False, True):
        oracle = new_oracle(16, 12); tree = oracle.tree
        oracle.scene.render.use_compositing = False; oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], np.float32).reshape(12, 16, 4)
        bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source = oracle.reset(); node = split(oracle, tree, source.outputs[0], oracle.color((-.25, 1, .75, 2)))
        color = node.outputs[0]
        if effect:
            post = tree.nodes.new('CompositorNodeExposure'); post.inputs['Exposure'].default_value = 1
            tree.links.new(color, post.inputs['Image']); color = post.outputs[0]
        tree.links.new(color, sink.inputs[0]); unused = tree.nodes.new('CompositorNodeRLayers')
        save(oracle, 'split-actual-eevee-render-layers-' + str(int(effect)), unused)
    frames, first = [], None
    for index, (width, height) in enumerate(((8, 8), (8, 8), (12, 10), (7, 13), (8, 8))):
        oracle = new_oracle(width, height); tree = oracle.tree; sink, source = oracle.reset()
        node = split(oracle, tree, source.outputs[0], oracle.color((-.25, 1, .75, 2))); tree.links.new(node.outputs[0], sink.inputs[0])
        document = save(oracle, f'split-resize-native-{index}', source, bit=True); first = first or document
        frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
        if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
        frames.append(frame)
        if index == 3: frames.append({'width': width, 'height': height, 'logicalWidth': width + 2,
            'input': document['input'], 'expected': [], 'nativeOracle': False, 'expectError': 'matching source/render image extents'})
    first.update(case=oracle.prefix + '-split-responsive', resizeFrames=frames, sourceAsPointwise=True, passExtentMode='input-texture')
    (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    (output / 'render-profile.json').write_text(json.dumps(profiles, indent=2))
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    (output / 'qualification.json').write_text(json.dumps({'protocol': 'blendlink-split-source-profile-v1',
        'status': 'qualified', 'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(), 'device': device,
        'sourceBackend': backend, 'sourcePreserved': True, 'cases': len(rows), 'numericalSplitCases': len(rows) - 1,
        'controlCases': 1}, indent=2))
    print('BLENDLINK_COMPOSITOR_SPLIT_PASSED ' + json.dumps({'version': bpy.app.version_string, 'device': device, 'cases': len(rows)}))


destination = os.environ.get('BLENDLINK_COMPOSITOR_SPLIT_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-split-') as directory: main(Path(directory))
