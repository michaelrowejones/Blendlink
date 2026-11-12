# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded terminal native affine domains; no intermediate-window claims."""
import json
import math
import os
import sys
import tempfile
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compositor_reference import NativeCompositorReference, compositor_graph


def main(output):
    device = os.environ.get('BLENDLINK_COMPOSITOR_AFFINE_DEVICE', 'CPU')
    rows, refusals = [], []

    def new_oracle(width, height, shifted=False):
        data = np.random.default_rng(379117 + width).uniform(-.5, 2, (height, width, 4)).astype(np.float32)
        data[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
        if shifted:
            data = np.roll(data, 3, axis=1)
        oracle = NativeCompositorReference(output, device=device, pixels=data, node_previews=False)
        engines = {item.identifier for item in oracle.scene.render.bl_rna.properties['engine'].enum_items}
        oracle.scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        if hasattr(getattr(oracle.scene, 'eevee', None), 'taa_render_samples'):
            oracle.scene.eevee.taa_render_samples = 1
        return oracle

    def affine(value, kind='CompositorNodeTransform', mode='Bilinear', angle=.4, scale=(1, 1), translation=(0, 0)):
        node = oracle.tree.nodes.new(kind)
        if node.inputs.get('Interpolation') is not None:
            node.inputs['Interpolation'].default_value = mode
            node.inputs['Extension X'].default_value = node.inputs['Extension Y'].default_value = 'Clip'
        elif hasattr(node, 'filter_type'):
            node.filter_type = mode.upper()
        if kind == 'CompositorNodeScale':
            if node.inputs.get('Type') is not None: node.inputs['Type'].default_value = 'Relative'
            else: node.space = 'RELATIVE'
            node.inputs['X'].default_value, node.inputs['Y'].default_value = scale
        else:
            node.inputs['Angle' if node.inputs.get('Angle') is not None else 'Degr'].default_value = angle
            if kind == 'CompositorNodeTransform':
                node.inputs['Scale'].default_value = scale[0]
                node.inputs['X'].default_value, node.inputs['Y'].default_value = translation
        oracle.tree.links.new(value, node.inputs['Image'])
        return node

    def save(label, source):
        oracle.save('affine-' + label, source)
        path = output / (oracle.rows[-1]['case'] + '.json')
        document = json.loads(path.read_text())
        document.update(nativeSceneEngine=oracle.scene.render.engine, assertTextureCleanup=True,
            assertMrtState=True, assertShaderCost={'maxPasses': 2, 'maxFragmentBytes': 25000})
        path.write_text(json.dumps(document, separators=(',', ':')))
        rows.append(oracle.rows[-1])
        return document

    legacy = bpy.app.version < (4, 5, 0)
    uncalibrated_gpu = device == 'GPU' and bpy.context.preferences.system.gpu_backend != 'METAL'
    if legacy or uncalibrated_gpu:
        oracle = new_oracle(13, 7)
        for kind in ('CompositorNodeTransform', 'CompositorNodeRotate', 'CompositorNodeScale'):
            sink, source = oracle.reset()
            node = affine(source.outputs['Image'], kind, scale=(.75, 1.25))
            oracle.tree.links.new(node.outputs[0], sink.inputs[0])
            before = (len(oracle.tree.nodes), len(oracle.tree.links))
            result = compositor_graph.extract(oracle.scene)
            assert result['status'] == 'unsupported', result
            expected = 'legacy immediate canvases' if legacy else 'calibrated native Metal model'
            assert any(expected in item['message'] for item in result['diagnostics']), result
            assert before == (len(oracle.tree.nodes), len(oracle.tree.links))
            refusals.append({'case': kind, 'diagnostics': result['diagnostics']})
        (output / 'index.json').write_text('[]')
        (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
        reason = 'Legacy immediate affine canvases are not qualified' if legacy else 'Native GPU sampler is not calibrated for this backend'
        (output / 'not-applicable.json').write_text(json.dumps({
            'status': 'unsupported-native-affine-model', 'cases': 0, 'refusals': 3,
            'device': device, 'backend': bpy.context.preferences.system.gpu_backend,
            'legacy': legacy, 'version': list(bpy.app.version), 'reason': reason,
            'diagnostics': [item for refusal in refusals for item in refusal['diagnostics']],
        }, indent=2))
        print('BLENDLINK_COMPOSITOR_AFFINE_NOT_APPLICABLE ' + json.dumps({'reason': reason}))
        print('BLENDLINK_COMPOSITOR_AFFINE_CHECK_PASSED ' + json.dumps({'cases': 0, 'refusals': len(refusals),
            'blender': bpy.app.version_string, 'device': device}))
        return

    for width, height in ((13, 7), (31, 9)):
        oracle = new_oracle(width, height)
        for mode in ('Nearest', 'Bilinear'):
            for kind in ('CompositorNodeTransform', 'CompositorNodeRotate'):
                for index, angle in enumerate((0, .1, .4, math.pi / 4, math.pi / 2, math.pi, -.4, math.tau)):
                    sink, source = oracle.reset()
                    node = affine(source.outputs['Image'], kind, mode, angle=angle)
                    oracle.tree.links.new(node.outputs[0], sink.inputs[0])
                    save(f'{width}-{height}-{mode}-{kind}-angle-{index}', source)
            for index, scale in enumerate(((.125, 8), (.5, .75), (.75, 1.25), (1.25, 2), (2, .5), (8, .125))):
                for kind in ('CompositorNodeTransform', 'CompositorNodeScale'):
                    sink, source = oracle.reset()
                    node = affine(source.outputs['Image'], kind, mode, angle=0, scale=scale)
                    oracle.tree.links.new(node.outputs[0], sink.inputs[0])
                    save(f'{width}-{height}-{mode}-{kind}-scale-{index}', source)
            for chain in ('inverse-rotation', 'scale-then-rotate', 'rotate-then-scale', 'translate-then-rotate',
                          'rotate-then-translate', 'combined', 'upstream-exposure', 'maximum-scale-chain', 'minimum-scale-chain'):
                sink, source = oracle.reset()
                value = source.outputs['Image']
                if chain == 'upstream-exposure':
                    exposure = oracle.tree.nodes.new('CompositorNodeExposure')
                    exposure.inputs['Exposure'].default_value = .25
                    oracle.tree.links.new(value, exposure.inputs['Image']); value = exposure.outputs[0]
                first = affine(value, 'CompositorNodeRotate', mode)
                value = first.outputs[0]
                if chain == 'inverse-rotation':
                    value = affine(value, 'CompositorNodeRotate', mode, angle=-.4).outputs[0]
                elif chain == 'rotate-then-scale':
                    value = affine(value, 'CompositorNodeScale', mode, scale=(.75, 1.25)).outputs[0]
                elif chain == 'scale-then-rotate':
                    value = affine(source.outputs['Image'], 'CompositorNodeScale', mode, scale=(.75, 1.25)).outputs[0]
                    value = affine(value, 'CompositorNodeRotate', mode).outputs[0]
                elif chain == 'translate-then-rotate':
                    value = affine(source.outputs['Image'], mode=mode, angle=0, translation=(.1, -.2)).outputs[0]
                    value = affine(value, 'CompositorNodeRotate', mode).outputs[0]
                elif chain == 'rotate-then-translate':
                    value = affine(value, mode=mode, angle=0, translation=(.1, -.2)).outputs[0]
                elif chain == 'combined':
                    value = affine(source.outputs['Image'], mode=mode, scale=(1.25, 1.25), translation=(.1, -.2)).outputs[0]
                elif chain in ('maximum-scale-chain', 'minimum-scale-chain'):
                    scale = 8 if chain == 'maximum-scale-chain' else .125
                    value = affine(source.outputs['Image'], mode=mode, angle=0, scale=(scale, scale)).outputs[0]
                    value = affine(value, mode=mode, angle=0, scale=(scale, scale)).outputs[0]
                oracle.tree.links.new(value, sink.inputs[0])
                save(f'{width}-{height}-{mode}-chain-{chain}', source)

    for kind in ('CompositorNodeTransform', 'CompositorNodeRotate', 'CompositorNodeScale'):
        for linked in (False, True):
            sink, source = oracle.reset()
            node = affine(source.outputs['Image'], kind, scale=(.75, 1.25))
            oracle.tree.links.remove(next(iter(node.inputs['Image'].links)))
            if linked:
                oracle.tree.links.new(oracle.color((.25, -.5, 1.5, .35)), node.inputs['Image'])
            else:
                node.inputs['Image'].default_value = (.25, -.5, 1.5, .35)
            oracle.tree.links.new(node.outputs[0], sink.inputs[0])
            save(f'constant-{kind}-{int(linked)}', source)

    for mode in ('Nearest', 'Bilinear'):
        for feature in ('blur', 'exposure', 'cross-domain', 'linked-angle', 'bicubic', 'extend', 'negative-scale',
                        'huge-angle', 'render-border', 'absolute-scale', 'composed-scale'):
            sink, source = oracle.reset()
            node = affine(source.outputs['Image'], 'CompositorNodeScale' if feature == 'absolute-scale' else 'CompositorNodeTransform', mode)
            value = node.outputs[0]
            if feature in ('blur', 'exposure', 'cross-domain'):
                consumer = oracle.tree.nodes.new({'blur': 'CompositorNodeBlur', 'exposure': 'CompositorNodeExposure', 'cross-domain': 'CompositorNodeAlphaOver'}[feature])
                oracle.tree.links.new(value, consumer.inputs['Foreground'] if feature == 'cross-domain' else consumer.inputs['Image'])
                if feature == 'cross-domain':
                    oracle.tree.links.new(source.outputs['Image'], consumer.inputs['Background'])
                value = consumer.outputs[0]
            elif feature == 'linked-angle': oracle.tree.links.new(oracle.value(.4), node.inputs['Angle'])
            elif feature == 'bicubic':
                if node.inputs.get('Interpolation') is not None: node.inputs['Interpolation'].default_value = 'Bicubic'
                else: node.filter_type = 'BICUBIC'
            elif feature == 'extend':
                if node.inputs.get('Extension X') is None: continue
                node.inputs['Extension X'].default_value = 'Extend'
            elif feature == 'negative-scale': node.inputs['Scale'].default_value = -1
            elif feature == 'huge-angle': node.inputs['Angle'].default_value = 12
            elif feature == 'render-border': oracle.scene.render.use_border = True
            elif feature == 'absolute-scale':
                if node.inputs.get('Type') is not None: node.inputs['Type'].default_value = 'Absolute'
                else: node.space = 'ABSOLUTE'
            elif feature == 'composed-scale':
                node.inputs['Scale'].default_value = 8
                value = affine(value, mode=mode, scale=(8, 8)).outputs[0]
                value = affine(value, mode=mode, scale=(8, 8)).outputs[0]
            oracle.tree.links.new(value, sink.inputs[0])
            before = (len(oracle.tree.nodes), len(oracle.tree.links), oracle.scene.render.use_border)
            result = compositor_graph.extract(oracle.scene)
            assert result['status'] == 'unsupported', (feature, result)
            assert before == (len(oracle.tree.nodes), len(oracle.tree.links), oracle.scene.render.use_border)
            refusals.append({'case': mode + '-' + feature, 'diagnostics': result['diagnostics']})
            oracle.scene.render.use_border = False

    for kind in ('CompositorNodeTransform', 'CompositorNodeRotate', 'CompositorNodeScale'):
        frames, first = [], None
        for index, (width, height) in enumerate(((13, 7), (13, 7), (31, 9), (7, 13), (19, 11), (13, 7))):
            oracle = new_oracle(width, height, index == 1)
            sink, source = oracle.reset()
            value = affine(source.outputs['Image'], kind, scale=(.75, 1.25)).outputs[0]
            oracle.tree.links.new(value, sink.inputs[0])
            document = save(f'resize-native-{kind}-{index}', source)
            first = first or document
            frame = {key: document[key] for key in ('width', 'height', 'input', 'expected')}
            if width == 31: frame.update(pixelRatio=2, logicalWidth=width / 2, logicalHeight=height / 2)
            frames.append(frame)
            if index == 4:
                frames.append({'width': width, 'height': height, 'logicalWidth': width + 2,
                    'input': document['input'], 'expected': [], 'nativeOracle': False,
                    'expectError': 'matching source/render image extents'})
        case = oracle.prefix + '-affine-resize-' + kind
        first.update(case=case, resizeFrames=frames, sourceAsPointwise=True, passExtentMode='input-texture')
        (output / (case + '.json')).write_text(json.dumps(first, separators=(',', ':')))
        rows.append({'case': case})
    (output / 'index.json').write_text(json.dumps(rows, indent=2))
    (output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
    print('BLENDLINK_COMPOSITOR_AFFINE_CHECK_PASSED ' + json.dumps({'cases': len(rows), 'refusals': len(refusals),
        'blender': bpy.app.version_string, 'device': device}))


destination = os.environ.get('BLENDLINK_COMPOSITOR_AFFINE_REFERENCES')
if destination:
    output = Path(destination).resolve(); output.mkdir(parents=True, exist_ok=True)
    main(output)
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-affine-') as directory:
        main(Path(directory))
