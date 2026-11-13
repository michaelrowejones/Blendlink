"""Independent native CPU staged mean, not Difference terminal pixels."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference

output = Path(os.environ['BLENDLINK_DIFFERENCE_MEAN_REFERENCES']).resolve(); rng = np.random.default_rng(618341)
triples = [(0, 0, 0)]
for exponent in range(-72, 4):
    for mantissa in (0, 1, 0x3fffff, 0x400000, 0x7ffffe, 0x7fffff):
        value = np.asarray(((exponent + 127) << 23) | mantissa, np.uint32).view(np.float32).item()
        if value > 12: continue
        triples.extend([(value, 0, 0), (0, value, 0), (0, 0, value), (value, value, value)])
while len(triples) < 16384:
    words = rng.integers((127 - 72) << 23, (127 + 4) << 23, 3, dtype=np.uint32)
    values = np.minimum(words.view(np.float32), np.float32(12))
    triples.append(tuple(float(v) for v in values))
pixels = np.ones((128, 128, 4), np.float32); pixels[..., :3] = np.asarray(triples[:16384], np.float32).reshape(128, 128, 3)
oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Independent CPU staged mean', image_only_scene=True, node_previews=False)
oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
sink, source = oracle.reset(); separate = oracle.separate(source.outputs['Image']); tree = oracle.tree
def math_node(operation, a, b=None):
    node = tree.nodes.new('ShaderNodeMath' if oracle.modern else 'CompositorNodeMath'); node.operation = operation
    tree.links.new(a, node.inputs[0])
    if b is not None: tree.links.new(b, node.inputs[1])
    return node
rg = math_node('ADD', separate.outputs['Red'], separate.outputs['Green'])
sum_node = math_node('ADD', rg.outputs[0], separate.outputs['Blue'])
mean = math_node('DIVIDE', sum_node.outputs[0]); mean.inputs[1].default_value = 3
tree.links.new(mean.outputs[0], sink.inputs[0]); oracle.save('difference-independent-staged-mean', source)
document = json.loads((output / (oracle.rows[0]['case'] + '.json')).read_text())
expected = np.asarray(document['expected'], np.float32).reshape(-1, 4)[:, 0]
a, b, c = [pixels.reshape(-1, 4)[:, i] for i in range(3)]
summed = np.float32(np.float32(a + b) + c)
ideal = (summed.astype(np.float64) / 3).astype(np.float32)
assert np.array_equal(expected.view(np.uint32), ideal.view(np.uint32))
(output / 'mean.json').write_text(json.dumps({'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(),
    'sourceDevice': 'CPU', 'sourceEngine': oracle.scene.render.engine, 'input': pixels.ravel().tolist(), 'expected': expected.tolist(),
    'width': 128, 'height': 128, 'count': len(expected), 'seed': 618341,
    'metric': 'Explicit native CPU ADD/ADD/DIVIDE, matching the pinned Difference CPU staged sum/3',
    'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}, separators=(',', ':')))
oracle.finish('BLENDLINK_DIFFERENCE_CPU_MEAN_RECORDED')
