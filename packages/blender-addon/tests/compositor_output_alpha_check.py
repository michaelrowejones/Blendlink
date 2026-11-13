# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Composite output alpha is a boundary operation after image padding."""
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
    oracle = NativeCompositorReference(output, device=os.environ.get('BLENDLINK_COMPOSITOR_OUTPUT_ALPHA_DEVICE', 'CPU'),
        name='Composite output alpha', image_only_scene=True)
    scene, tree = oracle.scene, oracle.tree
    scene.render.engine = 'BLENDER_EEVEE' if bpy.app.version >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'
    source_refusals = []
    for use_alpha in ((True,) if oracle.modern else (True, False)):
        for mode in ('field', 'grade', 'translate', 'constant-zero', 'constant-hdr'):
            sink, source = oracle.reset()
            if not oracle.modern:
                sink.use_alpha = use_alpha
            value = source.outputs['Image']
            if mode == 'grade':
                grade = tree.nodes.new('CompositorNodeExposure')
                grade.inputs['Exposure'].default_value = 1
                tree.links.new(value, grade.inputs['Image'])
                value = grade.outputs[0]
            elif mode == 'translate':
                translated = tree.nodes.new('CompositorNodeTranslate')
                translated.inputs['X'].default_value = 2
                translated.inputs['Y'].default_value = -1
                tree.links.new(value, translated.inputs['Image'])
                value = translated.outputs[0]
            elif mode.startswith('constant-'):
                value = oracle.color((-.25, 2, .125, 0 if mode == 'constant-zero' else 2))
            tree.links.new(value, sink.inputs[0])
            before = compositor_graph.extract(scene)
            if before['status'] != 'extracted':
                # This fixture's output policy does not qualify an unrelated
                # native GPU sampler. Keep its authored graph and actual pixels
                # as an explicit source refusal, outside the numerical index.
                assert (oracle.modern and oracle.device == 'GPU' and mode == 'translate'
                    and bpy.context.preferences.system.gpu_backend != 'METAL'), before
                diagnostic = before['diagnostics'][-1]
                assert diagnostic['code'] == 'unsupported-transform-mode' and 'verified native GPU sampler' in diagnostic['message'], before
                replacement = tree.nodes.new('CompositorNodeImage'); replacement.image = oracle.image
                for link in list(source.outputs['Image'].links):
                    tree.links.new(replacement.outputs['Image'], link.to_socket)
                scene.render.filepath = str(output / 'refused-native.exr')
                with oracle._render_sampling():
                    bpy.ops.render.render(write_still=True)
                loaded = bpy.data.images.load(scene.render.filepath, check_existing=False); loaded.alpha_mode = 'PREMUL'
                native = np.asarray(loaded.pixels[:], np.float32)
                assert len(native) == oracle.width * oracle.height * 4 and np.isfinite(native).all()
                source_refusals.append({'case': mode, 'program': before, 'diagnostics': before['diagnostics'],
                    'device': oracle.device, 'backend': bpy.context.preferences.system.gpu_backend,
                    'width': oracle.width, 'height': oracle.height, 'input': oracle.pixels.ravel().tolist(),
                    'expected': native.tolist(), 'numericalCase': False})
                bpy.data.images.remove(loaded)
                continue
            assert before['status'] == 'extracted', before
            assert before.get('outputAlpha') == (None if use_alpha else 'legacy-composite-opaque-v1'), before
            oracle.save('composite-output-' + str(int(use_alpha)) + '-' + mode, source, exact_alpha=True)
            record = json.loads((output / (oracle.rows[-1]['case'] + '.json')).read_text())
            if not use_alpha:
                assert set(record['expected'][3::4]) == {1}, record['case']
            if not oracle.modern:
                assert sink.use_alpha == use_alpha, 'Extraction changed the artist output setting'
    # A tree with only a constant sink still needs the animation guard.
    if not oracle.modern:
        sink, source = oracle.reset()
        sink.use_alpha = False
        sink.keyframe_insert(data_path='use_alpha', frame=1)
        refused = compositor_graph.extract(scene)
        assert refused['status'] == 'unsupported' and refused['diagnostics'][-1]['code'] == 'animated-tree', refused
        tree.animation_data_clear()
    expected_refusals = int(oracle.modern and oracle.device == 'GPU'
        and bpy.context.preferences.system.gpu_backend != 'METAL')
    assert len(source_refusals) == expected_refusals, source_refusals
    (output / 'source-refusals.json').write_text(json.dumps(source_refusals, indent=2))
    oracle.finish('BLENDLINK_COMPOSITOR_OUTPUT_ALPHA_PASSED')


destination = os.environ.get('BLENDLINK_COMPOSITOR_OUTPUT_ALPHA_REFERENCES')
if destination:
    main(Path(destination).resolve())
else:
    with tempfile.TemporaryDirectory(prefix='blendlink-compositor-output-alpha-') as directory:
        main(Path(directory))
