"""Independent bounded native scalar ratio; no Distance IR or pixel fitting."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference
from compositor_luminance_key import _cpu_profile

profile_before = _cpu_profile()
output = Path(os.environ['BLENDLINK_LUMA_RATIO_REFERENCES']).resolve(); rng = np.random.default_rng(74133)
a = [0.0, -0.0]; d = [.1, .1]
for word in [1, 2, 3, 0x7ffff, 0x1fffff, 0x3fffff, 0x400000, 0x7ffffe, 0x7fffff]:
    for divisor in [.1, .125, .25, .75, 1/64, 1]:
        a.append(np.asarray(word,np.uint32).view(np.float32).item()); d.append(divisor)
for exponent in range(-126, 1):
    for mantissa in (0, 1, 0x1fffff, 0x3fffff, 0x400000, 0x7ffffe, 0x7fffff):
        word = ((exponent + 127) << 23) | mantissa
        value = np.asarray(word, np.uint32).view(np.float32).item()
        if value > 1: continue
        for divisor in (.1, .125, .25, .75, 1 / 64, 1): a.append(value); d.append(divisor)
while len(a) < 16384:
    word = int(rng.integers(0, 0x800000)) if len(a)%3==0 else int(rng.integers((127 - 126) << 23, 127 << 23))
    divisor = int(rng.integers((127 - 6) << 23, (127 << 23) + 1))
    a.append(np.asarray(word, np.uint32).view(np.float32).item()); d.append(np.asarray(divisor, np.uint32).view(np.float32).item())
a, d = np.asarray(a[:16384], np.float32), np.asarray(d[:16384], np.float32)
pixels = np.zeros((128, 128, 4), np.float32); pixels[..., 0] = a.reshape(128, 128); pixels[..., 1] = d.reshape(128, 128); pixels[..., 3] = 1
oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Independent CPU Luma ratio', image_only_scene=True, node_previews=False)
requested_engine = os.environ.get('BLENDLINK_LUMA_CPU_ORACLE_ENGINE')
assert requested_engine in (None, 'CYCLES')
oracle.scene.render.engine = requested_engine or ('BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT')
if requested_engine: oracle.scene.cycles.samples = 1; oracle.scene.cycles.use_denoising = False
sink, source = oracle.reset(); separate = oracle.separate(source.outputs['Image'])
node = oracle.tree.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath'); node.operation = 'DIVIDE'
for name, incoming in [('Red', node.inputs[0]), ('Green', node.inputs[1])]: oracle.tree.links.new(separate.outputs[name], incoming)
oracle.tree.links.new(node.outputs[0], sink.inputs[0]); oracle.save('ratio-independent-field', source)
document = json.loads((output / (oracle.rows[0]['case'] + '.json')).read_text())
expected = np.asarray(document['expected'], np.float32).reshape(-1, 4)[:, 0]
profile_after = _cpu_profile()
assert profile_before == profile_after, 'Float32 mode changed during actual native task'
model_a = a.view(np.uint32).copy()
if profile_after['mode'] == 'ftz-daz-rne':
    model_a = np.where((model_a & 0x7f800000) == 0, model_a & 0x80000000, model_a).astype(np.uint32)
ideal = (model_a.view(np.float32).astype(np.float64) / d.astype(np.float64)).astype(np.float32)
assert np.array_equal(expected.view(np.uint32), ideal.view(np.uint32)), 'Native CPU ratio differs from independent mathematical control'
control_a = np.asarray([0.0, -0.0, 2 ** -126, 1.0], np.float32)
control_d = np.asarray([.1, .1, .1, 1 / 64], np.float32)
control_expected = (control_a.astype(np.float64) / control_d.astype(np.float64)).astype(np.float32)
(output / 'ratio.json').write_text(json.dumps({'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(),
    'operation': 'ratio-ftz' if profile_after['mode'] == 'ftz-daz-rne' else 'ratio', 'sourceDevice': 'CPU', 'sourceEngine': oracle.scene.render.engine, 'sourceCpuProfile': profile_after, 'profileStableAcrossNativeTasks': True, 'inputWords': a.view(np.uint32).tolist(),
    'divisorWords': d.view(np.uint32).tolist(), 'expected': expected.tolist(), 'expectedWords': expected.view(np.uint32).tolist(), 'seed': 74133, 'count': len(a), 'width': 128, 'height': 128,
    'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'ratioBitControls': {'inputWords': control_a.view(np.uint32).tolist(), 'divisorWords': control_d.view(np.uint32).tolist(),
        'expected': control_expected.tolist(), 'evidenceKind': 'independent-ieee-bit-control-not-native-graph'}}, separators=(',', ':')))
oracle.finish('BLENDLINK_LUMA_CPU_RATIO_RECORDED')
