# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned artist graph/source admission fixture. No render/GPU initialization."""
from pathlib import Path
import json,sys,hashlib,struct
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender'),str(Path(__file__).parent)]
import material_compiler as compiler
from audit import audit
OUT=Path(sys.argv[sys.argv.index('--')+1]).resolve();OUT.mkdir(parents=True,exist_ok=True)
assert bpy.app.version==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
calls={'gpu':0,'render':0}
def deny_gpu(*a,**k):calls['gpu']+=1;raise RuntimeError('Noise preview source fixture denies GPU initialization')
def deny_render(*a,**k):calls['render']+=1;raise RuntimeError('Noise preview source fixture denies rendering')
gpu.init=deny_gpu;bpy.ops.render.render=deny_render
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.name='Owned Noise Color Preview';scene.render.engine='BLENDER_EEVEE';assert bpy.context.preferences.system.gpu_backend=='METAL'
scene.eevee.taa_render_samples=1;scene.render.resolution_x=scene.render.resolution_y=64;scene.render.resolution_percentage=100;scene.render.film_transparent=False;scene.render.use_compositing=False;scene.render.use_sequencer=False
scene.view_settings.view_transform='Raw';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.world=None
mesh=bpy.data.meshes.new('Owned UV Canvas Mesh');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update();uv=mesh.uv_layers.new(name='UVMap')
for polygon in mesh.polygons:
 for loop in polygon.loop_indices:
  x,y,_=mesh.vertices[mesh.loops[loop].vertex_index].co;uv.data[loop].uv=((x+1)/2,(y+1)/2)
obj=bpy.data.objects.new('Owned UV Noise Canvas',mesh);scene.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
mat=bpy.data.materials.new('Owned Default Noise Color');mat.use_nodes=True;mesh.materials.append(mat);tree=mat.node_tree;tree.nodes.clear()
uvnode=tree.nodes.new('ShaderNodeUVMap');uvnode.uv_map='UVMap';noise=tree.nodes.new('ShaderNodeTexNoise');noise.noise_dimensions='3D';noise.noise_type='FBM';noise.normalize=True
for name,value in [('Scale',5.),('Detail',2.),('Roughness',.5),('Lacunarity',2.),('Distortion',0.)]:noise.inputs[name].default_value=value
surface=tree.nodes.new('ShaderNodeBsdfPrincipled');surface.inputs['Base Color'].default_value=(0,0,0,1);surface.inputs['Specular IOR Level'].default_value=0;surface.inputs['Roughness'].default_value=1;surface.inputs['Emission Strength'].default_value=1
output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(uvnode.outputs['UV'],noise.inputs['Vector']);tree.links.new(noise.outputs['Color'],surface.inputs['Emission Color']);tree.links.new(surface.outputs['BSDF'],output.inputs['Surface'])
camdata=bpy.data.cameras.new('Owned Preview Camera');camdata.type='ORTHO';camdata.ortho_scale=2;camera=bpy.data.objects.new('Owned Preview Camera',camdata);scene.collection.objects.link(camera);camera.location=(0,0,2);scene.camera=camera;camera['blendlink_id']='owned-noise-camera'
scene['blendlink_recipe']=json.dumps({'schemaVersion':1,'presentation':'realtime','atlases':[{'id':'main','name':'Main','size':128,'targetDensity':1,'margin':4,'fitPolicy':'block','bakeOutput':'appearance'}],'preview':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'final':{'samples':1,'supersample':1,'denoise':False,'resolutionScale':1},'states':[{'name':'default'}],'optimization':{'geometry':'meshopt','textures':'none'},'camera':{'objectId':'owned-noise-camera','objectName':camera.name,'behavior':'fixed','framing':'authored','compositions':[{'name':'Noise Color Canvas','width':64,'height':64,'safeMargin':0}]}})
source=OUT/'noise-color.blend';bpy.ops.wm.save_as_mainfile(filepath=str(source));pin=hashlib.sha256(source.read_bytes()).hexdigest()
plan=compiler.plan_materials([obj],purpose='final',automatic_programs=True);assert not plan.errors,compiler.format_plan_errors(plan)
programs=[]
for decision in plan.lowerings:
 for item in decision.channel_plan['channels']:
  if item.get('tslIr'):programs.append({'material':decision.material_name,'channel':item['channel'],'ir':item['tslIr']})
def nodes(v):
 if isinstance(v,dict):
  if 'op'in v:yield v
  for x in v.values():yield from nodes(x)
 elif isinstance(v,list):
  for x in v:yield from nodes(x)
noise_ir=[n for p in programs for n in nodes(p['ir'])if n.get('op')=='noise_normalized'];assert len(noise_ir)==1,(programs,plan.as_dict())
ir=noise_ir[0];assert ir['dimensions']==3 and ir['noiseType']=='FBM'and ir['normalize']is True and ir['detail']==2 and ir['roughness']==.5 and ir['lacunarity']==2 and ir['output']=='color'
assert ir['evaluationModel']=='shader'and ir['offsetModel']=='shader-folded'and ir['perlinModel']=='eevee-metal-periodic-f32';expected=audit();assert ir['colorOffsets']==expected['colorOffsets'];assert calls=={'gpu':0,'render':0};assert hashlib.sha256(source.read_bytes()).hexdigest()==pin
source_hashes={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in [Path(__file__),Path(__file__).parent/'audit.py',*(ROOT/'packages/blender-addon').glob('*.py'),*(ROOT/'packages/blender-addon').glob('*.json'),*(ROOT/'packages/blendlink/blender').glob('*.py')]}
record={'status':'SAVED_OWNED_NOISE_COLOR_PRODUCTION_GRAPH','sourceFile':str(source),'sourceSha256':pin,'sourcePreserved':True,'sourceHashes':source_hashes,'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'engine':scene.render.engine,'gpuBackendPreference':bpy.context.preferences.system.gpu_backend,'gpuInitializationCalls':calls['gpu'],'calls':calls,'programs':programs,'plan':plan.as_dict(),'audit':expected,'supportCredit':0};(OUT/'fixture.json').write_text(json.dumps(record,indent=2)+'\n');print('OWNED_NOISE_COLOR_FIXTURE_SAVED')
