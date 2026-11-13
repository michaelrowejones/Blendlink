"""Matched native tiny-mean controls; no source admission or fitted pixels."""
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'packages/blender-addon/tests'))
from compositor_reference import NativeCompositorReference, compositor_graph

output = Path(os.environ['BLENDLINK_DIFFERENCE_TINY_REFERENCES']).resolve(); rows = []; refusals = []
f = np.float32; minimum = f(np.finfo(f).tiny)
values = np.asarray([0, minimum, -minimum, np.nextafter(minimum, f(np.inf)), minimum * 2,
    minimum * 3, minimum * 4, 2 ** -120, 2 ** -100, 2 ** -80, 2 ** -74, 2 ** -72,
    2 ** -60, 2 ** -50, 1e-20, -1e-20], f)
for falloff in (0, .125):
    pixels = np.zeros((4, 16, 4), f); pixels[..., 0] = values
    pixels[..., 3] = 2 if falloff == 0 else f(2 ** 120)
    oracle = NativeCompositorReference(output, pixels=pixels, device='CPU', name='Tiny Difference mean', image_only_scene=True, node_previews=False)
    oracle.scene.render.engine = 'BLENDER_EEVEE' if oracle.modern else 'BLENDER_EEVEE_NEXT'; oracle.scene.eevee.taa_render_samples = 1
    for name in ('control', 'Image', 'Matte'):
        sink, source = oracle.reset(); color = source.outputs['Image']
        if name != 'control':
            node = oracle.tree.nodes.new('CompositorNodeDiffMatte')
            if oracle.modern: node.inputs['Tolerance'].default_value = 0; node.inputs['Falloff'].default_value = falloff
            else: node.tolerance = 0; node.falloff = falloff
            oracle.tree.links.new(color, node.inputs['Image 1']); oracle.tree.links.new(oracle.color((0, 0, 0, 1)), node.inputs['Image 2'])
            color = node.outputs[name]
        oracle.tree.links.new(color, sink.inputs[0])
        program = compositor_graph.extract(oracle.scene)
        if program['status'] == 'unsupported':
            assert name != 'control' and 'positive Tolerance' in str(program), program
            image = oracle.tree.nodes.new('CompositorNodeImage'); image.image = oracle.image
            for link in list(source.outputs['Image'].links): oracle.tree.links.new(image.outputs[0], link.to_socket)
            oracle.scene.render.filepath = str(output / ('refused-' + str(falloff) + '-' + name + '.exr'))
            with oracle._render_sampling(): bpy.ops.render.render(write_still=True)
            result = bpy.data.images.load(oracle.scene.render.filepath, check_existing=False); result.alpha_mode = 'PREMUL'
            expected = np.asarray(result.pixels[:], np.float32); assert np.isfinite(expected).all()
            raw = expected.astype('<f4').tobytes(); file = 'refused-' + str(falloff) + '-' + name + '.rgba32f'
            (output / file).write_bytes(raw); bpy.data.images.remove(result)
            refusals.append({'nativeOnly': True, 'program': program, 'expected': expected.tolist(), 'input': pixels.ravel().tolist(),
                'native': bpy.app.version_string, 'hash': bpy.app.build_hash.decode(), 'output': name,
                'controls': {'Tolerance': 0, 'Falloff': falloff, 'alpha': float(pixels[0, 0, 3])},
                'rawFloat32File': file, 'rawFloat32Sha256': hashlib.sha256(raw).hexdigest()})
            continue
        oracle.save('difference-tiny-' + str(falloff) + '-' + name, source)
        path = output / (oracle.rows[-1]['case'] + '.json'); record = json.loads(path.read_text())
        record.update(requireFloat32Bits=name == 'control', assertTextureCleanup=True,
            controls={'Tolerance': 0, 'Falloff': falloff, 'alpha': float(pixels[0, 0, 3])},
            fixtureSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        path.write_text(json.dumps(record, separators=(',', ':'))); rows.append(oracle.rows[-1])
(output / 'index.json').write_text(json.dumps(rows, indent=2))
(output / 'refusals.json').write_text(json.dumps(refusals, indent=2))
print('BLENDLINK_DIFFERENCE_TINY_RECORDED', bpy.app.version_string, len(rows))
