# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Candidate horizontal Lens Distortion CPU sampling pilot; independent native oracle, zero qualification credit.
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
OUT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
blocked = [0]
def no_gpu(*args, **kwargs):
    blocked[0] += 1
    raise RuntimeError('CPU horizontal lens oracle forbids gpu.init')
gpu.init = no_gpu
try:
    gpu.init()
except RuntimeError:
    pass
assert blocked == [1]
blocked[0] = 0
rows = []
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
for index, (width, height) in enumerate([(8, 8), (13, 9), (17, 13), (26, 18)]):
    pixels = np.random.default_rng(71241 + index).uniform(-2, 4, (height, width, 4)).astype(np.float32)
    pixels[..., 3] = np.resize(np.asarray([0, .125, .5, 1, 1.5, -.5, .25, .75], np.float32), (height, width))
    folder = OUT / (str(width) + 'x' + str(height))
    oracle = NativeCompositorReference(folder, device='CPU', pixels=pixels, node_previews=False, image_only_scene=True)
    sink, source = oracle.reset()
    oracle.tree.links.new(source.outputs['Image'], sink.inputs[0])
    oracle.save('copy', source, exact_alpha=True)
    sink, source = oracle.reset()
    lens = oracle.tree.nodes.new('CompositorNodeLensdist')
    lens.inputs['Type'].default_value = 'Horizontal'
    lens.inputs['Dispersion'].default_value = .2
    oracle.tree.links.new(source.outputs['Image'], lens.inputs['Image'])
    oracle.tree.links.new(lens.outputs['Image'], sink.inputs[0])
    source_file = folder / 'saved-original.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(source_file))
    original_sha = sha(source_file)
    oracle.save('lens', source, exact_alpha=True)
    assert sha(source_file) == original_sha
    oracle.finish('CAPTURED_LENS_HORIZONTAL_CPU_PILOT')
    cases = [json.loads((folder / (row['case'] + '.json')).read_text()) for row in oracle.rows]
    copy, native = cases
    assert np.array_equal(np.asarray(copy['input'], np.float32).view(np.uint32), np.asarray(copy['expected'], np.float32).view(np.uint32))
    assert native['program']['status'] == 'extracted'
    rows.append({'width': width, 'height': height, 'folder': folder.name, 'sourceFile': str(source_file.relative_to(OUT)),
        'sourceSha256': original_sha, 'copy': copy['case'] + '.json', 'lens': native['case'] + '.json',
        'copySha256': sha(folder / (copy['case'] + '.json')), 'lensSha256': sha(folder / (native['case'] + '.json'))})
assert blocked == [0]
report = {'status': 'CAPTURED_LENS_HORIZONTAL_CPU_PILOT_ZERO_CREDIT', 'rows': rows, 'nativeRenders': 8,
    'version': list(bpy.app.version), 'build': bpy.app.build_hash.decode(), 'gpuInitializations': 0, 'supportCredit': 0}
(OUT / 'native.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
