# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Same-pixel native CPU references for actual public installed Lens inputs; no scene-beauty credit.
from pathlib import Path
import hashlib
import json
import sys
import bpy
import gpu
import numpy as np
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
import source_presentation
OUT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
config = json.loads((OUT / 'inputs.json').read_text())
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
blocked = [0]
def no_gpu(*args, **kwargs):
    blocked[0] += 1
    raise RuntimeError('CPU public lens reference forbids gpu.init')
gpu.init = no_gpu
rows = []
for baseline in config['baselines']:
    assert sha(baseline['path']) == baseline['sha256']
    report = json.loads(Path(baseline['path']).read_text())
    assert report['phase'] == 'baseline'
    for api in report['apis']:
        assert api['status'] == 'LENS_PUBLIC_BASELINE_PASSED_ZERO_CREDIT'
        for row in api['rows']:
            path = Path(row['baselinePixelsFile'])
            assert sha(path) == row['baselinePixelsSha256']
            width, height = row['width'], row['height']
            data = np.frombuffer(path.read_bytes(), np.float32).copy().reshape(height, width, 4)
            assert np.isfinite(data).all()
            folder = OUT / row['id']
            oracle = NativeCompositorReference(folder, device='CPU', pixels=data, node_previews=False, image_only_scene=True)
            ocio_config, ocio_path = source_presentation.config_from_install()
            processor = source_presentation.composed_processor(oracle.scene, ocio_config)
            assert processor.getDefaultCPUProcessor().isNoOp() and source_presentation.serialize_ops(processor) == []
            sink, source = oracle.reset()
            oracle.tree.links.new(source.outputs['Image'], sink.inputs[0])
            oracle.save('copy', source, exact_alpha=True)
            sink, source = oracle.reset()
            lens = oracle.tree.nodes.new('CompositorNodeLensdist')
            lens.inputs['Type'].default_value = 'Horizontal'
            lens.inputs['Dispersion'].default_value = .2
            oracle.tree.links.new(source.outputs['Image'], lens.inputs['Image'])
            oracle.tree.links.new(lens.outputs['Image'], sink.inputs[0])
            oracle.save('lens', source, exact_alpha=True)
            oracle.finish('CAPTURED_PUBLIC_LENS_CPU_REFERENCE')
            copy, expected = [json.loads((folder / (entry['case'] + '.json')).read_text()) for entry in oracle.rows]
            assert np.array_equal(np.asarray(copy['expected'], np.float32).view(np.uint32), data.ravel().view(np.uint32))
            linear = np.asarray(expected['expected'], np.float32)
            linear_path = folder / 'linear.rgba32f'
            linear_path.write_bytes(linear.tobytes())
            display = linear.reshape(-1, 4).copy()
            for pixel in display:
                if pixel[3] != 0 and pixel[3] != 1:
                    pixel[:3] = np.asarray(pixel[:3] * np.float32(np.float32(1) / pixel[3]), dtype=np.float32)
                    pixel[:3] = np.asarray(pixel[:3] * pixel[3], dtype=np.float32)
            display_path = folder / 'display.rgba32f'
            display_path.write_bytes(display.tobytes())
            rows.append({'id': row['id'], 'width': width, 'height': height, 'moduleExport': row['moduleExport'],
                'baselineFile': str(path), 'baselineSha256': sha(path), 'linearFile': str(linear_path), 'linearSha256': sha(linear_path),
                'displayFile': str(display_path), 'displaySha256': sha(display_path), 'words': len(linear), 'copyWordDifferences': 0})
assert blocked == [0]
report = {'status': 'CAPTURED_PUBLIC_LENS_CPU_REFERENCES_ZERO_SUPPORT_CREDIT', 'rows': rows, 'nativeRenders': len(rows) * 2,
    'version': list(bpy.app.version), 'build': bpy.app.build_hash.decode(), 'gpuInitializations': 0, 'supportCredit': 0,
    'displayContract': 'existing-ocio-png-clamp01-3e-5', 'ocioProcessorIsNoOp': True,
    'ocioConfigSha256': sha(ocio_path), 'sceneBeautyCredit': 0, 'imageProducerCredit': 0}
(OUT / 'native-public.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'nativeRenders': report['nativeRenders']}))
