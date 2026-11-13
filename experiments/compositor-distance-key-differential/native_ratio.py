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

output = Path(os.environ['BLENDLINK_DISTANCE_RATIO_REFERENCES']).resolve(); rng = np.random.default_rng(74133)
a = [0.0]; d = [.1]
for exponent in range(-74, 5):
    for mantissa in (0, 1, 0x1fffff, 0x3fffff, 0x400000, 0x7ffffe, 0x7fffff):
        word = ((exponent + 127) << 23) | mantissa
        value = np.asarray(word, np.uint32).view(np.float32).item()
        if value > 16: continue
        for divisor in (.1, .125, .25, .75, 1 / 64, 1): a.append(value); d.append(divisor)
while len(a) < 16384:
    word = int(rng.integers((127 - 74) << 23, (127 + 4) << 23))
    divisor = int(rng.integers((127 - 6) << 23, (127 << 23) + 1))
    a.append(np.asarray(word, np.uint32).view(np.float32).item()); d.append(np.asarray(divisor, np.uint32).view(np.float32).item())
a, d = np.asarray(a[:16384], np.float32), np.asarray(d[:16384], np.float32)
pixels = np.zeros((128, 128, 4), np.float32); pixels[..., 0] = a.reshape(128, 128); pixels[..., 1] = d.reshape(128, 128); pixels[..., 3] = 1
oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Independent CPU ratio', image_only_scene=True, node_previews=False)
oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
sink, source = oracle.reset(); separate = oracle.separate(source.outputs['Image'])
node = oracle.tree.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath'); node.operation = 'DIVIDE'
for name, incoming in [('Red', node.inputs[0]), ('Green', node.inputs[1])]: oracle.tree.links.new(separate.outputs[name], incoming)
oracle.tree.links.new(node.outputs[0], sink.inputs[0]); oracle.save('ratio-independent-field', source)
document = json.loads((output / (oracle.rows[0]['case'] + '.json')).read_text())
expected = np.asarray(document['expected'], np.float32).reshape(-1, 4)[:, 0]
ideal = (a.astype(np.float64) / d.astype(np.float64)).astype(np.float32)
assert np.array_equal(expected.view(np.uint32), ideal.view(np.uint32)), 'Native CPU ratio differs from independent mathematical control'
control_a = np.asarray([0.0, -0.0, 2 ** -74, 16.0], np.float32)
control_d = np.asarray([.1, .1, .1, 1 / 64], np.float32)
control_expected = (control_a.astype(np.float64) / control_d.astype(np.float64)).astype(np.float32)
(output / 'sqrt.json').write_text(json.dumps({'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(),
    'sourceDevice': 'CPU', 'sourceEngine': oracle.scene.render.engine, 'inputWords': a.view(np.uint32).tolist(),
    'divisorWords': d.view(np.uint32).tolist(), 'expected': expected.tolist(), 'seed': 74133, 'count': len(a), 'width': 128, 'height': 128,
    'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'ratioBitControls': {'inputWords': control_a.view(np.uint32).tolist(), 'divisorWords': control_d.view(np.uint32).tolist(),
        'expected': control_expected.tolist(), 'evidenceKind': 'independent-ieee-bit-control-not-native-graph'}}, separators=(',', ':')))
oracle.finish('BLENDLINK_DISTANCE_CPU_RATIO_RECORDED')
