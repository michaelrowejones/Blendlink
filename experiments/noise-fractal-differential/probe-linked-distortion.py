# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native cancellation regression for Noise Distortion admission.

Python-double folding of (((1e8 + 1) - 1e8) - 1) returns zero, but modern
native MF float32 node stages return -1. Legacy Metal shader constant folding
returns zero in the measured 4.2 build. Check live, static normalized and signed
source families. Keep graphs, input images and native pixels;
refusing it must not replace the authored arithmetic with a D0 graph.
"""
from pathlib import Path
import json
import os
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path(os.environ.get('BLENDLINK_NOISE_DISTORTION_FOLD_EVIDENCE',
                            ROOT/'artifacts/native-distortion-linked-zero')).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
os.environ['BLENDLINK_NOISE_REFERENCES'] = str(OUTPUT)
source = Path(__file__).with_name('reference.py')
namespace = {'__file__': str(source)}
exec(compile(source.read_text().split('records = []')[0], str(source), 'exec'), namespace)
bpy, np, compiler = namespace['bpy'], namespace['np'], namespace['tsl_ir']
namespace['scene'].render.engine = namespace['EEVEE']
namespace['scene'].eevee.taa_render_samples = 1
rows=[]
for family in ['live','normalized','signed']:
    case = {'id': 'linked-distortion-zero-'+family, 'kind': 'noise', 'stage': 'image' if family=='live' else 'constant',
            'dimensions': '3D', 'output': 'Color', 'normalize': family!='signed', 'type': 'FBM', 'Scale': 1,
            'Detail': 2, 'Distortion': 0, 'Roughness': 1, 'oracleScale': .25}
    if family=='live': case['roughnessStage']='image'
    material, emission = namespace['make_material'](case)
    try:
        tree = material.node_tree
        root = next(node for node in tree.nodes if node.bl_idname == 'ShaderNodeTexNoise')
        first = tree.nodes.new('ShaderNodeMath'); first.operation = 'ADD'
        first.inputs[0].default_value = 1e8; first.inputs[1].default_value = 1
        second = tree.nodes.new('ShaderNodeMath'); second.operation = 'SUBTRACT'
        second.inputs[1].default_value = 1e8; tree.links.new(first.outputs[0], second.inputs[0])
        third = tree.nodes.new('ShaderNodeMath'); third.operation = 'SUBTRACT'
        third.inputs[1].default_value = 1; tree.links.new(second.outputs[0], third.inputs[0])
        tree.links.new(third.outputs[0], root.inputs['Distortion'])
        expression = compiler.emit_input(root.inputs['Distortion'])
        folded = compiler._fold_constant_scalar(expression)
        assert folded == 0
        before = namespace['authored_graph_state'](material)
        reason = ('Native normalized live Roughness requires literal float32 Distortion; linked arithmetic needs source baking' if family=='live'
                  else 'Native Noise requires literal float32 Distortion; linked arithmetic needs source baking')
        try:
            compiler.emit_channel(emission.inputs['Color'])
            raise AssertionError('An actually distorted native graph acquired a D0 certificate')
        except compiler.TslIrRefusal as error:
            assert str(error) == reason, str(error)
        assert before == namespace['authored_graph_state'](material), 'Refusal changed the authored graph'
        with tempfile.TemporaryDirectory() as temporary:
            retained = namespace['retain_refused_native_graph'](material, case, namespace['EEVEE'], temporary)
            original=np.fromfile(OUTPUT/retained['nativePixels']['file'],dtype='<f4').reshape(namespace['SIZE'],namespace['SIZE'],3)
            tree.links.remove(root.inputs['Distortion'].links[0])
            zero=namespace['native_pixels'](material,temporary,'literal-zero-control')
            zero.astype('<f4').tofile(OUTPUT/(family+'-zero-control.f32'))
            maximum_difference=float(np.abs(original-zero).max())
            if bpy.app.version >= (5,0,0): assert maximum_difference > .001, maximum_difference
            tree.links.new(third.outputs[0],root.inputs['Distortion'])
            assert before==namespace['authored_graph_state'](material)
            affine = tree.nodes.new('ShaderNodeMath'); affine.operation = 'MULTIPLY_ADD'
            affine.inputs[1].default_value = .125; affine.inputs[2].default_value = .5
            tree.links.new(third.outputs[0], affine.inputs[0]); tree.links.new(affine.outputs[0], emission.inputs['Color'])
            control = namespace['native_pixels'](material, temporary, 'distortion-control')
            control.astype('<f4').tofile(OUTPUT/(family+'-control.f32'))
            unique = np.unique(control)
            assert len(unique)==1 and np.isfinite(unique).all(), unique
            native_distortion = float((unique[0]-.5)/.125)
            if bpy.app.version >= (5,0,0): assert native_distortion == -1, unique
            elif bpy.context.preferences.system.gpu_backend=='METAL': assert native_distortion == 0, unique
        rows.append({'family':family,'blender': bpy.app.version_string,
            'buildHash': bpy.app.build_hash.decode(), 'gpuBackend': bpy.context.preferences.system.gpu_backend,
            'gpuRenderer': compiler._noise_gpu_renderer(), 'pythonDoubleFold': folded, 'nativeDistortion': native_distortion,
            'controlEncoding': '.5 + .125 * native Distortion', 'encodedControlUnique': unique.tolist(),
            'sourceRefusal': reason, 'expression': expression,'nativeVersusLiteralZeroMaximum':maximum_difference, **retained})
    finally:
        bpy.data.materials.remove(material, do_unlink=True)
        for image in list(bpy.data.images):
            if image.name.startswith('Exact Noise') and not image.users: bpy.data.images.remove(image)
(OUTPUT/'report.json').write_text(json.dumps({'rows':rows},indent=2))
print('BLENDLINK_NATIVE_DISTORTION_FOLDING_PASSED 3 source families, authored graphs retained')
