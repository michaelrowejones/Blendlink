# SPDX-License-Identifier: GPL-3.0-or-later
"""Native emission observations of saved original color, plus independent masks."""
import hashlib,json,sys
from pathlib import Path
import bpy,numpy as np,gpu
assert bpy.app.version==(5,3,0) and bpy.app.build_hash==b'02f0899d78e3'
source,out=map(lambda p:Path(p).resolve(),sys.argv[sys.argv.index('--')+1:][:2]);fixtures=json.loads((source/'fixtures.json').read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
report={'status':'RUNNING','supportCredit':0,'materialCredit':0,'sceneCredit':0,'rows':[],'scriptSha256':sha(__file__),'fixtureSha256':sha(source/'fixtures.json'),'gate':{'rgbMaxAbs':2**-10,'alphaExact':True,'scope':'Original color field only, not whole BSDF, NormalMap, camera or scene parity'}}
try:
 for case in fixtures['cases']:
  path=Path(case['sourceFile']);assert sha(path)==case['sourceSha256'];bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene;owner=scene.objects['Owned BOX source geometry'];material=owner.data.materials[0].copy();owner.data.materials[0]=material;t=material.node_tree;color=t.nodes['Principled BSDF'].inputs['Base Color'].links[0].from_socket
  sink=t.nodes.new('ShaderNodeOutputMaterial');sink.is_active_output=True;sink.target='ALL';emit=t.nodes.new('ShaderNodeEmission');emit.inputs['Strength'].default_value=1;t.links.new(emit.outputs[0],sink.inputs['Surface']);white=t.nodes.new('ShaderNodeRGB');white.outputs[0].default_value=(1,1,1,1)
  scale=t.nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs['Scale'].default_value=.03125;t.links.new(t.nodes['Mapping'].outputs['Vector'],scale.inputs[0]);encoded=t.nodes.new('ShaderNodeVectorMath');encoded.operation='ADD';encoded.inputs[1].default_value=(.5,.5,.5);t.links.new(scale.outputs[0],encoded.inputs[0])
  for width,height in [(64,4),(128,8)]:
   scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='NONE'
   for kind,signal in [('mask',white.outputs[0]),('mapping',encoded.outputs[0]),('color',color)]:
    t.links.new(signal,emit.inputs['Color']);id=case['id']+'-'+kind+'-'+str(width);scene.render.filepath=str(out/(id+'.exr'));bpy.ops.render.render(write_still=True);image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.use_half_precision=False;values=np.empty(width*height*4,np.float32);image.pixels.foreach_get(values);bpy.data.images.remove(image);assert np.isfinite(values).all() and np.all(values[3::4]==1)
    file=id+'.rgba32f';(out/file).write_bytes(values.astype('<f4').tobytes());report['rows'].append({'id':id,'case':case['id'],'kind':kind,'width':width,'height':height,'file':file,'sha256':sha(out/file),'words':len(values)});(out/'partial.json').write_text(json.dumps(report,indent=2)+'\n')
  assert sha(path)==case['sourceSha256']
 report['gpu']={'backend':gpu.platform.backend_type_get(),'renderer':gpu.platform.renderer_get()};assert report['gpu']['backend']=='METAL';report['sourcePreserved']=True;report['status']='CAPTURED_SAVED_ORIGINAL_COLOR_OBSERVATIONS'
finally:(out/'reference.json').write_text(json.dumps(report,indent=2)+'\n')
