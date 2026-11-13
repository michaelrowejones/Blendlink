"""Independent native scalar square-root field; no Distance IR or pixel fitting."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference

output = Path(os.environ['BLENDLINK_DISTANCE_SQRT_REFERENCES']).resolve()
rng = np.random.default_rng(73419)
words = [0]
for exponent in range(1, 255):
    for mantissa in (0, 1, 2, 3, 0x1fffff, 0x200000, 0x3fffff, 0x400000, 0x400001, 0x7ffffd, 0x7ffffe, 0x7fffff):
        words.append((exponent << 23) | mantissa)
# Construct midpoint-neighbor inputs mathematically, before rendering. There
# is no native-pixel selection. Positive finite normal inputs span all exponents.
for root in rng.integers(1 << 23, 1 << 24, 1024):
    midpoint = (int(root) + .5) ** 2 / 2 ** 46
    for exponent in (-100, 0, 6):
        center = np.float32(midpoint * 2 ** exponent)
        for value in (np.nextafter(center, np.float32(0)), center, np.nextafter(center, np.float32(np.inf))):
            words.append(int(np.asarray(value, np.float32).view(np.uint32)))
while len(words) < 16384:
    words.append(int(rng.integers(0x800000, 0x7f800000)))
words = np.asarray(words[:16384], np.uint32)
pixels = np.zeros((128, 128, 4), np.float32); pixels[..., 0] = words.view(np.float32).reshape(128, 128); pixels[..., 3] = 1
oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Independent CPU square root', image_only_scene=True, node_previews=False)
oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
sink, source = oracle.reset(); separate = oracle.separate(source.outputs['Image'])
node = oracle.tree.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath'); node.operation = 'SQRT'
oracle.tree.links.new(separate.outputs['Red'], node.inputs[0]); oracle.tree.links.new(node.outputs[0], sink.inputs[0])
oracle.save('sqrt-independent-field', source)
document = json.loads((output / (oracle.rows[0]['case'] + '.json')).read_text())
expected = np.asarray(document['expected'], np.float32).reshape(-1, 4)[:, 0]
ideal = np.sqrt(words.view(np.float32).astype(np.float64)).astype(np.float32)
assert np.array_equal(expected.view(np.uint32), ideal.view(np.uint32)), 'Native CPU scalar sqrt differs from the independent mathematical control'
bit_words = {0, 0x80000000, 0x7fffff, 0x7ffffe}
for power in range(23):
    bit_words.update(word for word in (2 ** power - 1, 2 ** power, 2 ** power + 1) if 0 < word < 0x800000)
bit_words = np.asarray(sorted(bit_words), np.uint32)
bit_expected = np.sqrt(bit_words.view(np.float32).astype(np.float64)).astype(np.float32)
(output / 'sqrt.json').write_text(json.dumps({'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(),
    'sourceDevice': 'CPU', 'sourceEngine': oracle.scene.render.engine, 'inputWords': words.tolist(), 'expected': expected.tolist(),
    'seed': 73419, 'count': len(words), 'width': 128, 'height': 128,
    'bitControls': {'inputWords': bit_words.tolist(), 'expected': bit_expected.tolist(),
        'evidenceKind': 'independent-ieee-bit-control-not-native-graph',
        'oracle': 'Binary64 mathematical sqrt rounded once to Float32; raw input bits reconstructed on GPU; no native-subnormal graph admission'},
    'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, separators=(',', ':')))
oracle.finish('BLENDLINK_DISTANCE_CPU_SQRT_RECORDED')
