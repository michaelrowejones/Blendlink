# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-sentinel: BLENDLINK_DIFFERENCE_CPU_PRECISION_PASSED
"""Fresh CPU-exact Difference fields, HDR alpha and actual GPU CPU folding."""
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
from compositor_difference_key import CPU_EXACT_MODEL


def main(output):
    f = np.float32; rows = []; device = os.environ.get('BLENDLINK_DIFFERENCE_PRECISION_DEVICE', 'CPU')
    colors = np.asarray([[.1414213478565216] * 3, [.15] * 3, [.2] * 3, [.3] * 3,
        [np.nextafter(f(.1), f(0)), 0, 0], [.2, .8, .15], [.3, .6, .1], [.1, .2, .3],
        [.05, .2, .1], [.25, .5, .75], [0, 0, 0], [2 ** -80, 0, 0], [2 ** -72, 0, 0],
        [2 ** -50] * 3, [20, -20, 40], [-.2, .125, -.1]], f)
    pixels = np.ones((8, 16, 4), f); pixels[..., :3] = colors[None, :, :]
    pixels[..., 3] = np.asarray([0, 1, 2, 2 ** 20, 2 ** 40, 2 ** 60, -2 ** 60, 1e10], f)[:, None]
    oracle = NativeCompositorReference(output, pixels=pixels, device=device, name='CPU exact Difference', image_only_scene=True, node_previews=False)
    oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
    tree = oracle.tree
    def setup(tolerance=.1, falloff=.1, mode='field', constant=(.1414213478565216,) * 3 + (2 ** 60,)):
        sink, source = oracle.reset(); image = source.outputs['Image'] if mode != 'constant' else oracle.color(constant)
        if mode == 'both-field':
            separate = oracle.separate(image); combine = tree.nodes.new('CompositorNodeCombineColor')
            for incoming, name in zip(list(combine.inputs), ['Blue', 'Green', 'Red', 'Alpha']): tree.links.new(separate.outputs[name], incoming)
            other = combine.outputs[0]
        else: other = oracle.color((0, 0, 0, -4))
        node = tree.nodes.new('CompositorNodeDiffMatte'); node.name = 'Artist exact CPU Difference'
        tree.links.new(image, node.inputs['Image 1']); tree.links.new(other, node.inputs['Image 2'])
        if oracle.modern:
            for name, number in [('Tolerance', tolerance), ('Falloff', falloff)]:
                if mode == 'linked': tree.links.new(oracle.value(number), node.inputs[name])
                else: node.inputs[name].default_value = number
        else: node.tolerance, node.falloff = tolerance, falloff
        return sink, source, node
    def save(label, source, control=False):
        def state(): return repr([(node.name, node.bl_idname, [(s.identifier, repr(getattr(s, 'default_value', None))) for s in node.inputs]) for node in tree.nodes])
        before = state(); counts = len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes)
        program = compositor_graph.extract(oracle.scene); assert program['status'] == 'extracted', program
        for op in program['ops']:
            if op['kind'] == 'difference-key':
                assert op['properties']['difference_key_model'] == CPU_EXACT_MODEL, op
                assert op['properties']['difference_key_native_version'] == list(bpy.app.version[:3])
        assert before == state() and counts == (len(bpy.data.images), len(bpy.data.node_groups), len(bpy.data.scenes))
        oracle.save(label, source); path = output / (oracle.rows[-1]['case'] + '.json'); record = json.loads(path.read_text())
        record.update(requireFloat32Bits=control, assertMrtState=True, assertTextureCleanup=True,
            assertShaderCost={'maxPasses': 1, 'maxFragmentBytes': 16000},
            fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(record, separators=(',', ':'))); rows.append(oracle.rows[-1]); return record
    sink, source = oracle.reset(); tree.links.new(source.outputs['Image'], sink.inputs[0]); save('difference-exact-independent-control', source, True)
    if device == 'GPU' and not oracle.modern:
        (output / 'index.json').write_text(json.dumps(rows)); (output / 'not-applicable.json').write_text(json.dumps({
            'reason': 'Legacy GPU compositor does not CPU-fold single values', 'numericalCpuExactCases': 0, 'controlCases': 1}))
        print('BLENDLINK_DIFFERENCE_CPU_PRECISION_NOT_APPLICABLE'); print('BLENDLINK_DIFFERENCE_CPU_PRECISION_PASSED'); return
    if device == 'CPU':
        for index, (tolerance, falloff) in enumerate([(.1, .1), (.1, .3), (.125, .25), (.5, 1 / 64), (.125, 0), (2 ** -50, 1), (1, 1)]):
            for mode in ('field', 'both-field', 'linked'):
                for name in ('Image', 'Matte'):
                    sink, source, node = setup(tolerance, falloff, mode); tree.links.new(node.outputs[name], sink.inputs[0])
                    save(f'difference-exact-{index}-{mode}-{name}', source)
    for index, color in enumerate([(.1414213478565216,) * 3 + (2 ** 60,), (.15, .15, .15, -2 ** 60), (.2, .2, .2, 2 ** 60)]):
        for name in ('Image', 'Matte'):
            sink, source, node = setup(mode='constant', constant=color); tree.links.new(node.outputs[name], sink.inputs[0])
            save(f'difference-exact-single-{index}-{name}', source)
    if device == 'CPU':
        for name in ('Image', 'Matte'):
            sink, source = oracle.reset(); group = bpy.data.node_groups.new('Artist exact Difference group', 'CompositorNodeTree')
            group.interface.new_socket(name='Image', in_out='INPUT', socket_type='NodeSocketColor')
            group.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor' if name == 'Image' else 'NodeSocketFloat')
            incoming = group.nodes.new('NodeGroupInput'); outgoing = group.nodes.new('NodeGroupOutput'); nested = group.nodes.new('CompositorNodeDiffMatte')
            group.links.new(incoming.outputs[0], nested.inputs['Image 1']); nested.inputs['Image 2'].default_value = (0, 0, 0, -4)
            group.links.new(nested.outputs[name], outgoing.inputs[0]); instance = tree.nodes.new('CompositorNodeGroup'); instance.node_tree = group
            tree.links.new(source.outputs[0], instance.inputs[0]); tree.links.new(instance.outputs[0], sink.inputs[0])
            save('difference-exact-group-' + name, source)
        previous = oracle.pixels.copy(); safe = previous.copy(); safe[..., 3] = np.clip(safe[..., 3], -1, 2)
        oracle.pixels = safe; oracle.image.pixels.foreach_set(safe.ravel()); oracle.image.update()
        for name in ('Image', 'Matte'):
            sink, source, node = setup(); second = tree.nodes.new('CompositorNodeDiffMatte')
            tree.links.new(node.outputs['Image'], second.inputs['Image 1']); second.inputs['Image 2'].default_value = (.25, .5, .75, 1)
            tree.links.new(second.outputs[name], sink.inputs[0]); save('difference-exact-cascade-' + name, source)
        oracle.pixels = previous; oracle.image.pixels.foreach_set(previous.ravel()); oracle.image.update()
        oracle.scene.render.use_compositing = False; oracle.scene.render.filepath = str(output / 'scene-input.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        oracle.pixels = np.asarray(image.pixels[:], f).reshape(8, 16, 4); bpy.data.images.remove(image); oracle.scene.render.use_compositing = True
        sink, source, node = setup(); tree.links.new(node.outputs['Image'], sink.inputs[0]); unused = tree.nodes.new('CompositorNodeRLayers')
        save('difference-exact-real-eevee', unused)
        frames = []; first = None
        for index, (width, height) in enumerate(((8, 8), (8, 8), (12, 10), (7, 13), (8, 8))):
            resized = np.random.default_rng(59211 + width * 19 + height).uniform(-.2, .6, (height, width, 4)).astype(f)
            resized[..., 3] = np.resize(np.asarray([0, 1, 2, 2 ** 20, 2 ** 60, -2 ** 60], f), (height, width))
            oracle = NativeCompositorReference(output, pixels=resized, device='CPU', name='Responsive exact Difference', image_only_scene=True, node_previews=False)
            oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
            tree = oracle.tree; sink, source, node = setup(); tree.links.new(node.outputs['Image'], sink.inputs[0])
            record = save('difference-exact-resize-' + str(index), source); first = first or record
            frame = {key: record[key] for key in ('width', 'height', 'input', 'expected')}
            if width == 12: frame.update(pixelRatio=2, logicalWidth=6, logicalHeight=5)
            frames.append(frame)
        first.update(case=oracle.prefix + '-difference-exact-responsive', resizeFrames=frames)
        (output / (first['case'] + '.json')).write_text(json.dumps(first, separators=(',', ':'))); rows.append({'case': first['case']})
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    (output / 'qualification.json').write_text(json.dumps({'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(),
        'sourceDevice': device, 'sourceModel': CPU_EXACT_MODEL, 'numericalCpuExactCases': len(rows) - 1, 'controlCases': 1,
        'sourcePreserved': True, 'nativeGpuFieldCases': 0}, indent=2))
    print('BLENDLINK_DIFFERENCE_CPU_PRECISION_PASSED ' + json.dumps({'cases': len(rows), 'device': device}))


destination = os.environ.get('BLENDLINK_DIFFERENCE_PRECISION_REFERENCES')
if destination: main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-difference-exact-') as directory: main(Path(directory))
