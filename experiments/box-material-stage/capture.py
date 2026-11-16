# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual original color graph, observed through owned emission copies only."""
import hashlib,json,sys,time
from pathlib import Path
import bpy,numpy as np
ROOT=Path(__file__).resolve().parents[2]
source,out,retained=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:3])
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
assert sha(source)=='9f636b2e1a59b3d181f90caf1b1703658eeadebad57f3c6207737d2fe3ffd85e'
bpy.ops.wm.open_mainfile(filepath=str(source));source_scene=bpy.context.scene
original=bpy.data.materials['Plaster'];material=original.copy();material.name='Owned original Plaster color signal';t=material.node_tree
assert t.nodes['Texture Coordinate'].object is None
mapping=t.nodes['Mapping'];assert mapping.vector_type=='TEXTURE'
assert tuple(mapping.inputs['Location'].default_value)==(0,0,0) and tuple(mapping.inputs['Rotation'].default_value)==(0,0,0) and tuple(mapping.inputs['Scale'].default_value)==(2.5,2.5,2.5)
image=t.nodes['Image Texture'];assert image.projection=='BOX' and image.projection_blend==0.09966777265071869 and image.image.name=='Plaster-Overlay.png'
color=t.nodes['Principled BSDF'].inputs['Base Color'].links[0].from_socket
assert color.node.name=='Mix' and color.node.blend_type=='OVERLAY' and color.node.clamp_factor and not color.node.clamp_result
sys.path.insert(0,str(ROOT/'experiments/box-image-storage-stage'))
from geometry_fixture import fixture
scene,owner,camera,cases,activate,settings=fixture(source_scene)
retained_inputs=json.loads((retained/'geometry-inputs.json').read_text())
assert cases==retained_inputs['cases'] and settings==retained_inputs['sourceSettings']
(out/'geometry-inputs.json').write_text(json.dumps({'cases':cases,'sourceSettings':settings},indent=2)+'\n')
report={'status':'RUNNING_RESEARCH_ZERO_CREDIT','supportCredit':0,'materialCredit':0,'sceneCredit':0,'source':str(source),'sourceSha256':sha(source),'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceSettings':settings,'captureSha256':sha(__file__),'fixtureSha256':sha(ROOT/'experiments/box-image-storage-stage/geometry_fixture.py'),'retainedInputsSha256':sha(retained/'geometry-inputs.json'),'geometryInputsSha256':sha(out/'geometry-inputs.json'),'sceneSize':[64,4],'bound':2**-10,'normalFrame':'Original Normal Map remains unqualified/refused; the owned color signal does not claim BSDF or normal parity','rows':[]}
sink=t.nodes.new('ShaderNodeOutputMaterial');sink.is_active_output=True;sink.target='ALL'
emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface'])
white=t.nodes.new('ShaderNodeRGB');white.outputs[0].default_value=(1,1,1,1)
scale=t.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.03125;t.links.new(mapping.outputs['Vector'],scale.inputs[0])
encoded=t.nodes.new('ShaderNodeVectorMath');encoded.operation='ADD';encoded.inputs[1].default_value=(.5,.5,.5);t.links.new(scale.outputs['Vector'],encoded.inputs[0])
try:
 for case in cases:
    activate(case['id']);owner.data.materials.clear();owner.data.materials.append(material)
    for kind,signal in [('mask',white.outputs[0]),('mapping',encoded.outputs[0]),('color',color)]:
        t.links.new(signal,emit.inputs['Color']);id=case['id']+'-'+kind;scene.render.filepath=str(out/(id+'.exr'));started=time.perf_counter();bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.use_half_precision=False
        assert tuple(image.size)==(64,4);v=np.empty(1024,np.float32);image.pixels.foreach_get(v);bpy.data.images.remove(image);assert np.isfinite(v).all()
        file=id+'.rgba32f';(out/file).write_bytes(v.astype('<f4').tobytes());report['rows'].append({'id':id,'case':case['id'],'kind':kind,'file':file,'sha256':sha(out/file),'words':1024,'milliseconds':(time.perf_counter()-started)*1000})
        (out/'partial.json').write_text(json.dumps(report,indent=2)+'\n')
 report['status']='CAPTURED_ORIGINAL_PLASTER_COLOR_SIGNAL_RESEARCH'
finally:
 assert sha(source)==report['sourceSha256'];report['sourcePreserved']=True
 (out/'native.json').write_text(json.dumps(report,indent=2)+'\n')
print('SCENETOWEB_BOX_COLOR '+json.dumps({'status':report['status'],'rows':len(report['rows'])}))
