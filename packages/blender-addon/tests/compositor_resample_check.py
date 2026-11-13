# SPDX-License-Identifier: GPL-3.0-or-later
"""Native default Bilinear translation, deferred domains and branch realization."""
import json
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    output.mkdir(parents=True, exist_ok=True)
    device = os.environ.get('BLENDLINK_COMPOSITOR_RESAMPLE_DEVICE', 'CPU')
    if device == 'GPU' and bpy.context.preferences.system.gpu_backend != 'METAL':
        probe = NativeCompositorReference(output / 'unsupported-backend-check', device='GPU', node_previews=False)
        sink, source = probe.reset()
        node = probe.tree.nodes.new('CompositorNodeTranslate')
        if node.inputs.get('Interpolation') is not None:
            node.inputs['Interpolation'].default_value = 'Bilinear'
        else:
            node.interpolation = 'Bilinear'
        probe.tree.links.new(source.outputs['Image'], node.inputs['Image'])
        probe.tree.links.new(node.outputs[0], sink.inputs[0])
        extracted = compositor_graph.extract(probe.scene)
        assert extracted['status'] == 'unsupported' and any('verified native GPU sampler' in item['message']
            for item in extracted['diagnostics']), extracted
        reason = {'blender': bpy.app.version_string, 'device': device, 'cases': 0,
                  'status': 'unsupported-backend-model',
                  'reason': 'Native filtered GPU sampler is not yet calibrated on this backend',
                  'diagnostics': extracted['diagnostics'],
                  'backend': bpy.context.preferences.system.gpu_backend}
        (output / 'index.json').write_text('[]')
        (output / 'not-applicable.json').write_text(json.dumps(reason, indent=2))
        print('BLENDLINK_COMPOSITOR_RESAMPLE_NOT_APPLICABLE', json.dumps(reason))
        print('BLENDLINK_COMPOSITOR_RESAMPLE_CHECK_PASSED', json.dumps(reason))
        return
    rows, refusals = [], []

    def new_oracle(width, height, pattern='random'):
        y, x = np.indices((height, width))
        pixels = (np.stack((x, y, x * 2 + y, np.ones_like(x)), -1).astype(np.float32) if pattern == 'ramp'
                  else np.random.default_rng(71391 + width).uniform(-.5, 2, (height, width, 4)).astype(np.float32))
        if pattern == 'hdr':
            pixels[..., :3] *= 64
        if pattern != 'ramp':
            pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
        result = NativeCompositorReference(output, pixels=pixels, device=device, name='Native Bilinear image domains', node_previews=False)
        engines = {item.identifier for item in result.scene.render.bl_rna.properties['engine'].enum_items}
        result.scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        if hasattr(getattr(result.scene, 'eevee', None), 'taa_render_samples'):
            result.scene.eevee.taa_render_samples = 1
        return result

    def translate(value, x, y, kind='CompositorNodeTranslate', interpolation='Bilinear'):
        node = tree.nodes.new(kind)
        if interpolation is not None:
            if node.inputs.get('Interpolation') is not None:
                node.inputs['Interpolation'].default_value = interpolation
            elif kind == 'CompositorNodeTranslate':
                node.interpolation = interpolation
            else:
                node.filter_type = interpolation.upper()
        node.inputs['X'].default_value, node.inputs['Y'].default_value = x, y
        tree.links.new(value, node.inputs['Image'])
        return node.outputs[0]

    def save(label, source, **extra):
        extracted = compositor_graph.extract(oracle.scene)
        if extracted['status'] != 'extracted':
            assert bpy.app.version < (4, 5, 0) and device == 'CPU', (label, extracted)
            assert any('area-of-interest/data-window' in item['message'] for item in extracted['diagnostics']), (label, extracted)
            refusals.append({'case': label, 'diagnostics': extracted['diagnostics']})
            return None
        oracle.save(label, source)
        row = oracle.rows[-1]
        path = output / (row['case'] + '.json')
        doc = json.loads(path.read_text())
        doc.update(nativeSceneEngine=oracle.scene.render.engine, nativeGpuBackend=doc['program']['ops'][0]['properties'].get('native_gpu_backend'),
                   assertTextureCleanup=True, assertMrtState=True,
                   assertShaderCost={'maxPasses': 10, 'maxFragmentBytes': 24000}, **extra)
        path.write_text(json.dumps(doc, separators=(',', ':')))
        rows.append(row)
        return doc

    for width, height in ((13, 7), (31, 9)):
        for pattern in ('random', 'ramp', 'hdr'):
            oracle = new_oracle(width, height, pattern)
            tree = oracle.tree
            sink, source = oracle.reset()
            tree.links.new(source.outputs['Image'], sink.inputs[0])
            save(f'resample-{width}-{height}-{pattern}-input-control', source, requireFloat32Bits=True)
            for kind in ('CompositorNodeTranslate', 'CompositorNodeTransform'):
                for index, (dx, dy) in enumerate(((0, 0), (2, -1), (.1, .2), (.25, .75), (.5, -.5), (-.5, .5),
                    (1 / 512, 0), (-1 / 512, 0), (.501953125, -.501953125), (1.2, -2.3), (-.1, -.2), (12.75, 6.75))):
                    sink, source = oracle.reset()
                    value = translate(source.outputs['Image'], dx, dy, kind)
                    tree.links.new(value, sink.inputs[0])
                    save(f'resample-{width}-{height}-{pattern}-{kind.lower()}-{index}', source)
    for pattern in ('random', 'ramp', 'hdr'):
        oracle = new_oracle(13, 7, pattern)
        tree = oracle.tree
        for kind in ('CompositorNodeTranslate', 'CompositorNodeTransform'):
            for index, (dx, dy) in enumerate(((.5, 0), (-.5, 0), (.5001, 0), (-.5001, 0), (.4999, 0), (-.4999, 0), (.1, -.2))):
                sink, source = oracle.reset()
                value = translate(source.outputs['Image'], dx, dy, kind, 'Nearest')
                tree.links.new(value, sink.inputs[0])
                save(f'resample-nearest-{pattern}-{kind.lower()}-{index}', source, requireFloat32Bits=True)
    # Independent larger physical extents exercise reciprocal/FMA rounding and
    # sampler phases beyond the small image corpus, including the live bound.
    for width, height in ((127, 9), (509, 5), (1920, 5), (8192, 4)):
        oracle = new_oracle(width, height)
        tree = oracle.tree
        for index, (dx, dy) in enumerate(((.1, .2), (.501953125, -.501953125), (.5, -.5))):
            sink, source = oracle.reset()
            value = translate(source.outputs['Image'], dx, dy, interpolation='Nearest' if index == 2 else 'Bilinear')
            tree.links.new(value, sink.inputs[0])
            save(f'resample-physical-extent-{width}-{height}-{index}', source)
    oracle = new_oracle(13, 7)
    tree = oracle.tree
    for consumer in ('inverse', 'outside-inverse', 'exposure', 'posterize', 'flip', 'blur', 'after-blur',
                     'alpha-over-unmoved-background', 'alpha-over-moved-background', 'alpha-over-two-moved', 'alpha-over-constant',
                     'default-setting', 'bilinear-to-nearest', 'nearest-to-bilinear', 'alpha-over-same-origin-options'):
        sink, source = oracle.reset()
        value = translate(source.outputs['Image'], .1, .2)
        if consumer == 'default-setting':
            value = translate(source.outputs['Image'], .1, .2, interpolation=None)
        elif consumer == 'bilinear-to-nearest':
            value = translate(value, 0, 0, interpolation='Nearest')
        elif consumer == 'nearest-to-bilinear':
            value = translate(translate(source.outputs['Image'], 1, -1, interpolation='Nearest'), .1, .2)
        elif consumer == 'alpha-over-same-origin-options':
            node = tree.nodes.new('CompositorNodeAlphaOver')
            tree.links.new(value, node.inputs['Background'] if node.inputs.get('Background') else node.inputs['Image'])
            tree.links.new(translate(value, 0, 0, interpolation='Nearest'), node.inputs['Foreground'] if node.inputs.get('Foreground') else node.inputs['Image_001'])
            value = node.outputs[0]
        elif consumer in ('inverse', 'outside-inverse'):
            if consumer == 'outside-inverse':
                value = translate(source.outputs['Image'], 8192, -8192)
                value = translate(value, -8192, 8192)
            else:
                value = translate(value, -.1, -.2)
        elif consumer in ('exposure', 'posterize', 'flip', 'blur', 'after-blur'):
            kind = {'exposure': 'CompositorNodeExposure', 'posterize': 'CompositorNodePosterize', 'flip': 'CompositorNodeFlip',
                    'blur': 'CompositorNodeBlur', 'after-blur': 'CompositorNodeBlur'}[consumer]
            node = tree.nodes.new(kind)
            if consumer == 'exposure': node.inputs['Exposure'].default_value = 1.25
            elif consumer == 'posterize': node.inputs['Steps'].default_value = 3
            elif consumer == 'flip':
                if node.inputs.get('Flip X'): node.inputs['Flip X'].default_value = True
                else: node.axis = 'X'
            else:
                if node.inputs.get('Type'):
                    node.inputs['Type'].default_value = 'Tent';node.inputs['Size'].default_value = (2, 3)
                else: node.filter_type = 'TENT';node.size_x, node.size_y = 2, 3
            tree.links.new(source.outputs['Image'] if consumer == 'after-blur' else value, node.inputs['Image'])
            value = translate(node.outputs[0], .1, .2) if consumer == 'after-blur' else node.outputs[0]
        else:
            node = tree.nodes.new('CompositorNodeAlphaOver')
            background = (oracle.color((.1, .2, .4, .8)) if consumer == 'alpha-over-constant' else
                          translate(source.outputs['Image'], .3, -.4) if consumer in ('alpha-over-moved-background', 'alpha-over-two-moved') else source.outputs['Image'])
            foreground = source.outputs['Image'] if consumer == 'alpha-over-moved-background' else value
            tree.links.new(background, node.inputs['Background'] if node.inputs.get('Background') else node.inputs['Image'])
            tree.links.new(foreground, node.inputs['Foreground'] if node.inputs.get('Foreground') else node.inputs['Image_001'])
            value = node.outputs[0]
        tree.links.new(value, sink.inputs[0]);save('resample-consumer-' + consumer, source)
    for declared, consumer in ((False, 'translation'), (True, 'translation'), (False, 'cross-origin')):
        frames, first = [], None
        for index, (width, height) in enumerate(((13, 7), (13, 7), (31, 9), (7, 13), (19, 11), (13, 7))):
            oracle = new_oracle(width, height)
            if index == 1:
                oracle.pixels = np.roll(oracle.pixels, 3, axis=1)
                oracle.image.pixels.foreach_set(oracle.pixels.ravel())
            tree = oracle.tree
            sink, source = oracle.reset()
            value = translate(source.outputs['Image'], .1, .2)
            if consumer == 'cross-origin':
                node = tree.nodes.new('CompositorNodeAlphaOver')
                tree.links.new(translate(source.outputs['Image'], .3, -.4), node.inputs['Background'] if node.inputs.get('Background') else node.inputs['Image'])
                tree.links.new(value, node.inputs['Foreground'] if node.inputs.get('Foreground') else node.inputs['Image_001'])
                value = node.outputs[0]
            tree.links.new(value, sink.inputs[0])
            document = save(f'resample-resize-native-{consumer}-{int(declared)}-{index}', source)
            first = first or document
            frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
            if index == 2:
                frame.update(pixelRatio=2, logicalWidth=width / 2, logicalHeight=height / 2)
            frames.append(frame)
            if index == 4:
                frames.append({'width': width, 'height': height, 'logicalWidth': width + 2,
                    'input': document['input'], 'expected': [], 'nativeOracle': False,
                    'expectError': 'matching source/render image extents'})
        case = oracle.prefix + f'-resample-resize-{consumer}-{int(declared)}'
        first.update(case=case, resizeFrames=frames, sourceAsPointwise=declared, passExtentMode='input-texture')
        (output / (case + '.json')).write_text(json.dumps(first, separators=(',', ':')))
        rows.append({'case': case})
    expected_refusals = set()
    if bpy.app.version < (4, 5, 0) and device == 'CPU':
        expected_refusals = {f'resample-{width}-{height}-{pattern}-compositornodetransform-{index}'
            for width, height in ((13, 7), (31, 9)) for pattern in ('random', 'ramp', 'hdr') for index in range(1, 12)}
        expected_refusals.update(('resample-consumer-outside-inverse', 'resample-consumer-nearest-to-bilinear'))
    assert {item['case'] for item in refusals} == expected_refusals, refusals
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    print('BLENDLINK_COMPOSITOR_RESAMPLE_CHECK_PASSED', json.dumps({'blender': bpy.app.version_string, 'device': device, 'cases': len(rows), 'refusals': len(refusals)}))


if __name__ == '__main__':
    destination = os.environ.get('BLENDLINK_COMPOSITOR_RESAMPLE_REFERENCES')
    if destination: main(Path(destination))
    else:
        with tempfile.TemporaryDirectory(prefix='blendlink-compositor-resample-') as temporary: main(Path(temporary))
