# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Float32 cancellation regression for six fresh Noise controls."""
from pathlib import Path
import json
import os
import tempfile
ROOT=Path(__file__).resolve().parents[2]
OUTPUT=Path(os.environ.get('BLENDLINK_NOISE_SCALAR_FOLD_EVIDENCE',ROOT/'artifacts/native-noise-scalar-folds')).resolve()
OUTPUT.mkdir(parents=True,exist_ok=True);os.environ['BLENDLINK_NOISE_REFERENCES']=str(OUTPUT)
source=Path(__file__).with_name('reference.py');ns={'__file__':str(source)}
exec(compile(source.read_text().split('records = []')[0],str(source),'exec'),ns)
bpy,np,compiler=ns['bpy'],ns['np'],ns['tsl_ir'];ns['scene'].render.engine=ns['EEVEE'];ns['scene'].eevee.taa_render_samples=1
rows=[]
for parameter,kind in [('Detail','FBM'),('Roughness','FBM'),('Lacunarity','FBM'),('Scale','FBM'),('Offset','HETERO_TERRAIN'),('Gain','HYBRID_MULTIFRACTAL')]:
    case={'id':'linked-'+parameter.lower()+'-fold-zero','kind':'noise','stage':'constant','dimensions':'3D','output':'Color',
          'normalize':kind=='FBM','type':kind,'Scale':1,'Detail':2,'Roughness':.5,'Lacunarity':2,'Offset':1,'Gain':1,'oracleScale':.0625}
    material,emission=ns['make_material'](case)
    try:
        tree=material.node_tree;root=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeTexNoise')
        first=tree.nodes.new('ShaderNodeMath');first.operation='SUBTRACT';first.inputs[0].default_value=1e8;first.inputs[1].default_value=1
        second=tree.nodes.new('ShaderNodeMath');second.operation='SUBTRACT';second.inputs[1].default_value=1e8;tree.links.new(first.outputs[0],second.inputs[0])
        third=tree.nodes.new('ShaderNodeMath');third.operation='ADD';third.inputs[1].default_value=1;tree.links.new(second.outputs[0],third.inputs[0]);tree.links.new(third.outputs[0],root.inputs[parameter])
        expression=compiler.emit_input(root.inputs[parameter]);folded=compiler._fold_constant_scalar(expression);assert folded==0
        before=ns['authored_graph_state'](material)
        reason=f'Noise linked {parameter} requires literal float32/Clamp inputs; arithmetic folding needs source baking'
        try:compiler.emit_channel(emission.inputs['Color']);raise AssertionError('A double fold certified '+parameter)
        except compiler.TslIrRefusal as error:assert str(error)==reason,str(error)
        assert before==ns['authored_graph_state'](material)
        with tempfile.TemporaryDirectory() as temporary:
            retained=ns['retain_refused_native_graph'](material,case,ns['EEVEE'],temporary)
            original=np.fromfile(OUTPUT/retained['nativePixels']['file'],dtype='<f4').reshape(ns['SIZE'],ns['SIZE'],3)
            socket=root.inputs[parameter];default=socket.default_value;tree.links.remove(socket.links[0]);socket.default_value=0
            zero=ns['native_pixels'](material,temporary,'literal-zero-'+parameter);zero.astype('<f4').tofile(OUTPUT/(parameter.lower()+'-zero.f32'))
            maximum=float(np.abs(original-zero).max())
            if bpy.app.version >= (5,0,0):assert maximum>1e-4,(parameter,maximum)
            socket.default_value=default;tree.links.new(third.outputs[0],socket);assert before==ns['authored_graph_state'](material)
            affine=tree.nodes.new('ShaderNodeMath');affine.operation='MULTIPLY_ADD';affine.inputs[1].default_value=.125;affine.inputs[2].default_value=.5
            tree.links.new(third.outputs[0],affine.inputs[0]);tree.links.new(affine.outputs[0],emission.inputs['Color'])
            control=ns['native_pixels'](material,temporary,'scalar-control-'+parameter);control.astype('<f4').tofile(OUTPUT/(parameter.lower()+'-control.f32'))
            unique=np.unique(control);assert len(unique)==1 and np.isfinite(unique).all();native=float((unique[0]-.5)/.125)
            if bpy.app.version >= (5,0,0):assert native==1,(parameter,unique)
            else:assert native in {0,1},(parameter,unique)
        rows.append({'parameter':parameter,'kind':kind,'pythonDoubleFold':folded,'nativeScalar':native,
            'controlEncoding':'.5 + .125 * scalar','nativeVersusLiteralZeroMaximum':maximum,
            'sourceRefusal':reason,'expression':expression,**retained})
    finally:
        bpy.data.materials.remove(material,do_unlink=True)
        for image in list(bpy.data.images):
            if image.name.startswith('Exact Noise') and not image.users:bpy.data.images.remove(image)
(OUTPUT/'report.json').write_text(json.dumps({'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),
    'gpuBackend':bpy.context.preferences.system.gpu_backend,'gpuRenderer':compiler._noise_gpu_renderer(),'rows':rows},indent=2))
print('BLENDLINK_NATIVE_NOISE_SCALAR_FOLDING_PASSED 6 authored controls, native scalar and zero-variant pixels retained')
