"""Independent tiny-distance control; never admits a new runtime profile."""
import json
import hashlib
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference, compositor_graph

output = Path(os.environ['BLENDLINK_DISTANCE_ZERO_REFERENCES']).resolve()
f = np.float32; edge = f(2 ** -75)
falloff = f(float(os.environ.get('BLENDLINK_DISTANCE_ZERO_FALLOFF', '0')))
alpha = f(float(os.environ.get('BLENDLINK_DISTANCE_ZERO_ALPHA', '2')))
values = np.asarray([0, 1e-20, -1e-20, np.nextafter(edge, f(0)), edge, np.nextafter(edge, f(np.inf)),
    2 ** -74, 2 ** -80, 1e-18, -1e-18, 2 ** -63, 2 ** -64], np.float32)
pixels = np.zeros((4, len(values), 4), np.float32); pixels[..., 0] = values; pixels[..., 3] = alpha
oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Tiny zero distance', image_only_scene=True, node_previews=False)
oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
tree = oracle.tree
counterexamples = []
for name in ('control', 'Image', 'Matte'):
    sink, source = oracle.reset(); color = source.outputs[0]
    if name != 'control':
        node = tree.nodes.new('CompositorNodeDistanceMatte')
        if oracle.modern: node.inputs['Tolerance'].default_value = 0; node.inputs['Falloff'].default_value = float(falloff)
        else: node.tolerance = 0; node.falloff = float(falloff)
        tree.links.new(color, node.inputs['Image']); tree.links.new(oracle.color((0, 0, 0, 0)), node.inputs['Key Color'])
        color = node.outputs[name]
    tree.links.new(color, sink.inputs[0])
    program = compositor_graph.extract(oracle.scene)
    if program['status'] == 'unsupported':
        assert (oracle.modern or falloff != 0) and 'zero Tolerance' in str(program), program
        replacement = tree.nodes.new('CompositorNodeImage'); replacement.image = oracle.image
        for link in list(source.outputs['Image'].links): tree.links.new(replacement.outputs[0], link.to_socket)
        for node in tree.nodes: node.show_preview = False
        oracle.scene.render.filepath = str(output / ('native-only-' + name + '.exr'))
        with oracle._render_sampling(): bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); image.alpha_mode = 'PREMUL'
        actual = np.asarray(image.pixels[:], np.float32).reshape(oracle.height, oracle.width, 4)
        assert np.isfinite(actual).all()
        raw = actual.astype('<f4').tobytes(); file = 'native-only-' + name + '.rgba32f'; (output / file).write_bytes(raw)
        counterexamples.append({'case': name, 'nativeOnly': True, 'version': bpy.app.version_string,
            'buildHash': bpy.app.build_hash.decode(), 'program': program, 'input': pixels.tolist(), 'expected': actual.tolist(),
            'rawFloat32File': file, 'rawFloat32Sha256': hashlib.sha256(raw).hexdigest(),
            'controls': {'Tolerance': 0, 'Falloff': float(falloff), 'inputAlpha': float(alpha)},
            'fixtureSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
        bpy.data.images.remove(image); continue
    oracle.save('distance-tiny-zero-' + name, source)
    path = output / (oracle.rows[-1]['case'] + '.json'); document = json.loads(path.read_text())
    document['requireFloat32Bits'] = name == 'control'; document['assertTextureCleanup'] = True
    document['zeroDistanceControls'] = {'Tolerance': 0, 'Falloff': float(falloff), 'inputAlpha': float(alpha)}
    path.write_text(json.dumps(document, separators=(',', ':')))
(output / 'native-counterexamples.json').write_text(json.dumps(counterexamples, indent=2))
oracle.finish('BLENDLINK_TINY_DISTANCE_RECORDED')
