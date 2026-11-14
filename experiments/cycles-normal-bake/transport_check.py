"""CPU-only carrier/transaction control. Synthetic images are NOT bake/appearance evidence."""
from pathlib import Path
import json,sys,tempfile,hashlib
import bpy
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler
import bakelib
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine='CYCLES';scene.render.resolution_x=128;scene.render.resolution_y=128
mesh=bpy.data.meshes.new('ControlMesh');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2,3)]);mesh.update();uv=mesh.uv_layers.new(name='ArtistUV')
for loop,value in zip(uv.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=value
obj=bpy.data.objects.new('OwnedStaticReceiver',mesh);scene.collection.objects.link(obj);obj.scale=(-1,2,1)
mod=obj.modifiers.new('AuthoredRenderOnlyBevel','BEVEL');mod.width=.1;mod.segments=2;mod.show_viewport=False;mod.show_render=True
material=bpy.data.materials.new('ControlMaterial');tree=bakelib.ensure_shader_node_tree(material);tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial')
group=bpy.data.node_groups.new('AuthoredPrincipledGroup','ShaderNodeTree');group.interface.new_socket('Surface',in_out='OUTPUT',socket_type='NodeSocketShader');gout=group.nodes.new('NodeGroupOutput');root=group.nodes.new('ShaderNodeBsdfPrincipled');root.inputs['Coat Weight'].default_value=.5
group.links.new(root.outputs['BSDF'],gout.inputs['Surface']);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;tree.links.new(instance.outputs['Surface'],output.inputs['Surface'])
noise=group.nodes.new('ShaderNodeTexNoise');bump=group.nodes.new('ShaderNodeBump');group.links.new(noise.outputs['Fac'],bump.inputs['Height']);group.links.new(bump.outputs['Normal'],root.inputs['Normal']);group.links.new(bump.outputs['Normal'],root.inputs['Coat Normal']);obj.data.materials.append(material)
coord=group.nodes.new('ShaderNodeTexCoord');group.links.new(coord.outputs['UV'],root.inputs['Base Color'])
plan=compiler.plan_materials([obj],purpose='final',automatic_programs=True);assert not plan.errors,compiler.format_plan_errors(plan)
records=plan.decisions[0].channel_plan['channels'];assert {x['channel']for x in records if x.get('pass')=='NORMAL'}=={'Normal','Coat Normal'}
original=compiler._bake_material_channels
before={'mesh':obj.data,'materials':set(bpy.data.materials),'meshes':set(bpy.data.meshes),'groups':set(bpy.data.node_groups),'modifier':(mod.show_viewport,mod.show_render)}
def controlled_failure(decision,binding,owner,directory,created_materials,created_images,**kwargs):
 assert not mod.show_viewport and not mod.show_render
 compiler._material_bake_channel_material(decision,'normal',created_materials)
 raise RuntimeError('INTENTIONAL_NO_GPU_CONTROL')
compiler._bake_material_channels=controlled_failure
with tempfile.TemporaryDirectory(prefix='normal-transport-control-')as directory:
 try:compiler.with_compiled_materials(plan,str(Path(directory)/'not-published.glb'),lambda path:(_ for _ in ()).throw(AssertionError('emit must not run')))
 except compiler.MaterialCompileError as error:assert 'INTENTIONAL_NO_GPU_CONTROL'in str(error),str(error)
 else:raise AssertionError('Expected owned transaction failure')
compiler._bake_material_channels=original
assert obj.data is before['mesh'] and (mod.show_viewport,mod.show_render)==before['modifier']
assert set(bpy.data.materials)==before['materials'] and set(bpy.data.meshes)==before['meshes'] and set(bpy.data.node_groups)==before['groups']
print('CYCLES_NORMAL_CPU_TRANSACTION_PASSED')

# CPU-only export control substitutes labelled synthetic images for bake execution.
# Their normal values intentionally do not represent the authored Noise/Bump.
import numpy as np
original_attest=compiler._attest_generated_materials
captured={}
def capture_facts(path,facts):
 captured['facts']=facts
 import struct
 raw=Path(path).read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=raw[20+length+8:]
 fact=next(iter(facts.values()));m=obj.data;uv=m.uv_layers[fact['normalBasis']['uvName']];m.calc_tangents(uvmap=uv.name)
 native=[{'position':list(m.vertices[loop.vertex_index].co),'normal':list(m.corner_normals[i].vector),'tangent':list(loop.tangent),'sign':loop.bitangent_sign,'uv':list(uv.data[i].uv)}for i,loop in enumerate(m.loops)]
 emitted=[{key:compiler._accessor_values(doc,binary,int(index))[1]for key,index in primitive['attributes'].items()}for mesh in doc['meshes']for primitive in mesh['primitives']]
 Path('/tmp/scenetoweb-normal-basis-diagnostic.json').write_text(json.dumps({'native':native,'emitted':emitted,'primitive':doc['meshes'][0]['primitives'][0],'basis':fact['normalBasis']},indent=2))
 return original_attest(path,facts)
compiler._attest_generated_materials=capture_facts
def synthetic_products(decision,binding,owner,directory,created_materials,created_images,**kwargs):
 evidence=bakelib.prepare_material_texture_uv(owner,binding.materialization_plan,log=lambda x:None)
 products={'uvEvidence':evidence,'gates':{},'constants':{},'images':{}}
 for kind,rgb in [('normal',(.5,.5,1)),('coatNormal',(.7,.5,.95))]:
  pixels=np.empty((16,16,3),dtype=np.float32);pixels[:]=rgb
  saved=bakelib.save_channel_png(pixels,np.ones((16,16),dtype=bool),str(Path(directory)/(kind+'.png')),colorspace='data',label='synthetic transport only')
  image=bpy.data.images.load(saved['path']);image.colorspace_settings.name='Non-Color';created_images.append(image)
  products['images'][kind]={'saved':saved,'image':image,'uv':'unique','uvMaps':[]}
 return products
compiler._bake_material_channels=synthetic_products
with tempfile.TemporaryDirectory(prefix='normal-carrier-control-')as directory:
 out=Path(directory)/'synthetic-carrier.glb'
 def emit(path):return bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',export_materials='EXPORT',export_extras=True,export_yup=True,export_apply=False,export_tangents=True,export_animations=False)
 value,compilation=compiler.with_compiled_materials(plan,str(out),emit)
 assert value=={'FINISHED'} and out.is_file()
 raw=out.read_bytes();import struct
 length=struct.unpack_from('<I',raw,12)[0];document=json.loads(raw[20:20+length]);offset=20+length;binary=raw[offset+8:]
 exported=document['materials'][0];coat=exported['extensions']['KHR_materials_clearcoat'];assert exported['normalTexture']['index']!=coat['clearcoatNormalTexture']['index']
 assert exported['normalTexture'].get('texCoord',0)==coat['clearcoatNormalTexture'].get('texCoord',0)
 assert compilation.gltf_evidence[0]['materialBake']['normalBasis']['model']=='static-native-mikk-bake-basis-v1'
 fact=next(iter(captured['facts'].values()))
 primitives=[(mi,pi,primitive)for mi,mesh in enumerate(document['meshes'])for pi,primitive in enumerate(mesh['primitives'])if primitive.get('material')==0]
 import copy
 for mode in ['missing-tangent','wrong-tangent','swapped-coat','wrong-uv']:
  bad=copy.deepcopy(document);data=bytearray(binary)
  if mode=='missing-tangent':del bad['meshes'][0]['primitives'][0]['attributes']['TANGENT']
  elif mode=='wrong-tangent':
   accessor=bad['accessors'][bad['meshes'][0]['primitives'][0]['attributes']['TANGENT']];view=bad['bufferViews'][accessor['bufferView']];address=view.get('byteOffset',0)+accessor.get('byteOffset',0);struct.pack_into('<f',data,address,.321)
  elif mode=='swapped-coat':bad['materials'][0]['extensions']['KHR_materials_clearcoat']['clearcoatNormalTexture']['index']=bad['materials'][0]['normalTexture']['index']
  else:bad['materials'][0]['normalTexture']['texCoord']=3
  bad_material=bad['materials'][0];bad_primitives=[(mi,pi,primitive)for mi,mesh in enumerate(bad['meshes'])for pi,primitive in enumerate(mesh['primitives'])if primitive.get('material')==0]
  try:compiler._attest_material_bake_channels(bad,bytes(data),bad_material['pbrMetallicRoughness'],bad_material,fact,bad_primitives)
  except (compiler.MaterialCompileError,ValueError):pass
  else:raise AssertionError('Transport corruption passed: '+mode)
compiler._bake_material_channels=original;compiler._attest_generated_materials=original_attest
assert obj.data is before['mesh'] and (mod.show_viewport,mod.show_render)==before['modifier']
assert set(bpy.data.materials)==before['materials'] and set(bpy.data.meshes)==before['meshes'] and set(bpy.data.node_groups)==before['groups']
print('CYCLES_NORMAL_SYNTHETIC_CARRIER_PASSED_NO_BAKE_CREDIT')
