# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual native Modulo -> Clamp -> scalar consumer graphs."""
from pathlib import Path
import hashlib,json,os,tempfile
ROOT=Path(os.environ.get('BLENDLINK_MODULO_COMPOSITION_ROOT',Path(__file__).resolve().parents[2])).resolve()
OUT=Path(os.environ['BLENDLINK_MODULO_COMPOSITION_REFERENCE']).resolve();OUT.mkdir(parents=True,exist_ok=True);(OUT/'ir').mkdir(exist_ok=True)
os.environ['BLENDLINK_NOISE_REFERENCES']=str(OUT)
reference=ROOT/'experiments/noise-fractal-differential/reference.py';ns={'__file__':str(reference)}
shared=Path(os.environ.get('BLENDLINK_MODULO_COMPOSITION_SHARED_REFERENCE',reference))
exec(compile(shared.read_text().split('records = []')[0],str(shared),'exec'),ns)
bpy,np,compiler=ns['bpy'],ns['np'],ns['tsl_ir'];scene=ns['scene'];scene.render.engine=ns['EEVEE'];scene.eevee.taa_render_samples=1
from math_modulo_native_ir import REFUSAL
rows=[];refusals=[]
controls=[{'id':'constant-0','kind':'constant','value':[5.413859,.99999,.25]},
          {'id':'constant-1','kind':'constant','value':[.173,.625,1]},
          {'id':'image-control','kind':'image-control','stage':'image'}]
with tempfile.TemporaryDirectory() as temporary:
    for case in controls:
        material,emission=ns['make_material'](case)
        doc=compiler.emit_channel(emission.inputs['Color']);(OUT/'ir'/(case['id']+'.json')).write_text(json.dumps(doc))
        raw=ns['native_pixels'](material,temporary,case['id']);raw.astype('<f4').tofile(OUT/(case['id']+'.f32'));case['engine']=ns['EEVEE'];rows.append(case)
        bpy.data.materials.remove(material,do_unlink=True)
    for stage,point in [('literal',1074100096),('literal',1638499968),('literal',-1074100096),('literal',1000000000),('image',1638499968),('image',-1074100096)]:
        for consumer in ['clamp','noise','mix','curve','hsl']:
            identifier=f'{stage}-{point}-{consumer}'
            material=bpy.data.materials.new('Modulo composition '+identifier);material.use_nodes=True;tree=material.node_tree;tree.nodes.clear()
            emission=tree.nodes.new('ShaderNodeEmission');output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(emission.outputs[0],output.inputs['Surface'])
            modulo=tree.nodes.new('ShaderNodeMath');modulo.operation='MODULO';modulo.inputs[0].default_value=point;modulo.inputs[1].default_value=100000
            if stage=='image':
                incoming=ns['exact_inputs'](tree);image=incoming.node.image
                pixels=np.ones((64*64,4),np.float32);pixels[:,:3]=0;pixels[:,0]=(np.arange(64*64)%256-128)*16
                image.pixels.foreach_set(pixels.ravel());image.update()
                shift=tree.nodes.new('ShaderNodeVectorMath');shift.operation='ADD';shift.inputs[1].default_value=(point,0,0);tree.links.new(incoming,shift.inputs[0])
                separate=tree.nodes.new('ShaderNodeSeparateXYZ');tree.links.new(shift.outputs[0],separate.inputs[0]);tree.links.new(separate.outputs[0],modulo.inputs[0])
            clamp=tree.nodes.new('ShaderNodeClamp');tree.links.new(modulo.outputs[0],clamp.inputs['Value']);signal=clamp.outputs[0]
            if consumer=='clamp':raw=signal
            elif consumer=='noise':
                node=tree.nodes.new('ShaderNodeTexNoise');node.noise_dimensions='2D';node.inputs['Scale'].default_value=1;node.inputs['Detail'].default_value=1.5;node.inputs['Lacunarity'].default_value=1.7
                point_node=tree.nodes.new('ShaderNodeCombineXYZ')
                for socket,value in zip(point_node.inputs,[.173,-.375,.625]):socket.default_value=value
                tree.links.new(point_node.outputs[0],node.inputs['Vector']);tree.links.new(signal,node.inputs['Roughness']);raw=node.outputs['Color']
            elif consumer=='mix':
                modulo.use_clamp=True;node=tree.nodes.new('ShaderNodeMixRGB');node.blend_type='MIX';node.inputs[1].default_value=(.1,.25,.75,1);node.inputs[2].default_value=(.8,.4,.2,1)
                tree.links.new(modulo.outputs[0],node.inputs[0]);raw=node.outputs[0]
            elif consumer=='curve':
                node=tree.nodes.new('ShaderNodeFloatCurve');node.mapping.initialize();node.mapping.curves[0].points.new(.5,.75);node.mapping.update();node.inputs['Value'].default_value=.25
                tree.links.new(signal,node.inputs['Factor']);raw=node.outputs[0]
            else:
                combined=tree.nodes.new('ShaderNodeCombineXYZ');combined.inputs[1].default_value=.25;combined.inputs[2].default_value=.5;tree.links.new(signal,combined.inputs[0])
                node=tree.nodes.new('ShaderNodeSeparateColor');node.mode='HSL';tree.links.new(combined.outputs[0],node.inputs[0]);raw=node.outputs[1]
            affine=tree.nodes.new('ShaderNodeVectorMath');affine.operation='MULTIPLY_ADD';affine.inputs[1].default_value=(.25,)*3;affine.inputs[2].default_value=(.5,)*3
            tree.links.new(raw,affine.inputs[0]);tree.links.new(affine.outputs[0],emission.inputs['Color'])
            case={'id':identifier,'kind':'composition','consumer':consumer,'stage':stage,'engine':ns['EEVEE'],'oracleScale':.25}
            if consumer=='noise':
                coarse=ns['native_pixels'](material,temporary,identifier+'-coarse');ns['add_residual_control'](material,emission,coarse,.25,64);case['oracleScale']=64
            before=ns['authored_graph_state'](material)
            try:doc=compiler.emit_channel(emission.inputs['Color'])
            except compiler.TslIrRefusal as error:
                if not (bpy.app.version<(5,0,0) and bpy.context.preferences.system.gpu_backend!='METAL' and str(error)==REFUSAL):raise
                refusals.append({'id':identifier,'reason':str(error)});bpy.data.materials.remove(material,do_unlink=True);continue
            assert before==ns['authored_graph_state'](material)
            (OUT/'ir'/(identifier+'.json')).write_text(json.dumps(doc));(OUT/(identifier+'.graph.json')).write_text(json.dumps(before))
            raw=ns['native_pixels'](material,temporary,identifier);raw.astype('<f4').tofile(OUT/(identifier+'.f32'));rows.append(case)
            bpy.data.materials.remove(material,do_unlink=True)
            for image in list(bpy.data.images):
                if image.name.startswith('Exact Noise') and not image.users:bpy.data.images.remove(image)
(OUT/'index.json').write_text(json.dumps({'blender':bpy.app.version_string,'buildHash':bpy.app.build_hash.decode(),
 'gpuBackend':bpy.context.preferences.system.gpu_backend,'size':64,'cases':rows,'refusals':refusals,'requestedCases':33,
 'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'nativeModuleHashes':{path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(os.environ['BLENDLINK_NOISE_NATIVE_MODULES']).iterdir() if path.suffix in {'.py','.json'}} if os.environ.get('BLENDLINK_NOISE_NATIVE_MODULES') else {}},indent=2))
assert len(rows)+len(refusals)==33
print('BLENDLINK_MODULO_SCALAR_COMPOSITION_NATIVE_PASSED',len(rows),len(refusals))
