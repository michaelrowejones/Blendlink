# SPDX-License-Identifier: GPL-3.0-or-later
"""Native-vs-native diagnostic; this is not a runtime parity acceptance gate.

Compare one distorted Noise node with an authored graph containing its signed
warp octaves, Vector Math Multiply Add, and a zero-distortion final Noise.
Both sides remain native EEVEE nodes. Preserve all graphs, inputs and pixels.
"""
from pathlib import Path
import hashlib
import json
import os
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path(os.environ.get('BLENDLINK_NOISE_DISTORTION_DIAGNOSTIC',
                            ROOT/'artifacts/native-distortion-diagnostic')).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
os.environ['BLENDLINK_NOISE_REFERENCES'] = str(OUTPUT/'setup')
reference = Path(__file__).with_name('reference.py')
namespace = {'__file__': str(reference)}
exec(compile(reference.read_text().split('records = []')[0], str(reference), 'exec'), namespace)
bpy, np = namespace['bpy'], namespace['np']
scene = namespace['scene']; scene.render.engine = namespace['EEVEE']
scene.eevee.taa_render_samples = 1
rows = []
with tempfile.TemporaryDirectory() as temporary:
    for scale in [1, 40]:
        for profile, options in [('original', {}), ('separate', {'native_shader_f32': True}),
                                 ('fused', {'native_shader_fused': True})]:
            identifier = f'scale-{scale}-{profile}'
            case = {'id': identifier, 'kind': 'noise', 'stage': 'image', 'roughnessStage': 'image',
                    'dimensions': '3D', 'output': 'Color', 'normalize': True, 'type': 'FBM',
                    'Scale': scale, 'Detail': 2, 'Lacunarity': 1.7, 'Distortion': .37,
                    'Roughness': 1, 'oracleScale': .25}
            material, emission = namespace['make_material'](case)
            try:
                tree = material.node_tree
                original = next(n for n in tree.nodes if n.bl_idname == 'ShaderNodeTexNoise')
                coordinate = original.inputs['Vector'].links[0].from_socket
                roughness = original.inputs['Roughness'].links[0].from_socket
                scaled = tree.nodes.new('ShaderNodeVectorMath'); scaled.operation = 'SCALE'
                scaled.inputs['Scale'].default_value = scale; tree.links.new(coordinate, scaled.inputs[0])
                components = tree.nodes.new('ShaderNodeCombineXYZ')
                offsets = []
                for axis in range(3):
                    offset = namespace['tsl_ir']._noise_random_offset(axis, 3, **options); offsets.append(offset)
                    shifted = tree.nodes.new('ShaderNodeVectorMath'); shifted.operation = 'ADD'
                    shifted.inputs[1].default_value = offset; tree.links.new(scaled.outputs[0], shifted.inputs[0])
                    octave = tree.nodes.new('ShaderNodeTexNoise'); octave.noise_dimensions = '3D'
                    octave.normalize = False; octave.inputs['Scale'].default_value = 1
                    octave.inputs['Detail'].default_value = 0; tree.links.new(shifted.outputs[0], octave.inputs['Vector'])
                    tree.links.new(octave.outputs['Fac'], components.inputs[axis])
                warp = tree.nodes.new('ShaderNodeVectorMath'); warp.operation = 'MULTIPLY_ADD'
                warp.inputs[1].default_value = (.37,)*3; tree.links.new(components.outputs[0], warp.inputs[0])
                tree.links.new(scaled.outputs[0], warp.inputs[2])
                final = tree.nodes.new('ShaderNodeTexNoise'); final.noise_dimensions = '3D'; final.normalize = True
                final.inputs['Scale'].default_value = 1; final.inputs['Detail'].default_value = 2
                final.inputs['Lacunarity'].default_value = 1.7
                tree.links.new(warp.outputs[0], final.inputs['Vector']); tree.links.new(roughness, final.inputs['Roughness'])
                difference = tree.nodes.new('ShaderNodeVectorMath'); difference.operation = 'SUBTRACT'
                tree.links.new(original.outputs['Color'], difference.inputs[0]); tree.links.new(final.outputs['Color'], difference.inputs[1])
                amplify = tree.nodes.new('ShaderNodeVectorMath'); amplify.operation = 'MULTIPLY_ADD'
                amplify.inputs[1].default_value = (4096,)*3; amplify.inputs[2].default_value = (2,)*3
                tree.links.new(difference.outputs[0], amplify.inputs[0]); tree.links.new(amplify.outputs[0], emission.inputs['Color'])
                values = namespace['native_pixels'](material, temporary, identifier)
                assert np.isfinite(values).all() and values.min() > 0
                values.astype('<f4').tofile(OUTPUT/(identifier+'.f32'))
                graph = namespace['authored_graph_state'](material)
                images = {}
                for node in tree.nodes:
                    image = getattr(node, 'image', None)
                    if image is None or image.name in images: continue
                    pixels = np.empty(len(image.pixels), np.float32); image.pixels.foreach_get(pixels)
                    data = pixels.astype('<f4').tobytes(); digest = hashlib.sha256(data).hexdigest()
                    name = 'image-'+digest[:16]+'.f32'; (OUTPUT/name).write_bytes(data)
                    images[image.name] = {'file': name, 'sha256': digest, 'size': list(image.size),
                        'colorSpace': image.colorspace_settings.name, 'alphaMode': image.alpha_mode,
                        'halfPrecision': image.use_half_precision}
                (OUTPUT/(identifier+'.graph.json')).write_text(json.dumps({'graph': graph, 'images': images}, indent=2))
                error = np.abs(values-2)/4096
                rows.append({'id': identifier, 'scale': scale, 'offsetProfile': profile, 'offsets': offsets,
                    'maximumDelta': float(error.max()), 'meanDelta': float(error.mean()),
                    'nonzeroComponents': int(np.count_nonzero(error)), 'pixelFile': identifier+'.f32',
                    'graphFile': identifier+'.graph.json'})
            finally:
                bpy.data.materials.remove(material, do_unlink=True)
                for image in list(bpy.data.images):
                    if image.name.startswith('Exact Noise') and not image.users: bpy.data.images.remove(image)
(OUTPUT/'report.json').write_text(json.dumps({'diagnosticOnly': True, 'blender': bpy.app.version_string,
    'buildHash': bpy.app.build_hash.decode(), 'backend': bpy.context.preferences.system.gpu_backend,
    'renderer': namespace['tsl_ir']._noise_gpu_renderer(), 'size': namespace['SIZE'],
    'pixelEncoding': '4096 * (original Color - manual Color) + 2', 'rows': rows}, indent=2))
print('BLENDLINK_NATIVE_DISTORTION_DIAGNOSTIC_RETAINED', OUTPUT)
