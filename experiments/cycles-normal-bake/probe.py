"""Owned actual Cube material NORMAL bake probe, not whole-material/render parity."""
from pathlib import Path
import argparse,hashlib,json,sys,math
import bpy,numpy as np
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--output',required=True);p.add_argument('--active-coat',action='store_true');a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);ROOT=Path(a.root).resolve();out=Path(a.output).resolve();out.mkdir(exist_ok=True)
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler
import bakelib,procedural
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest();assert source_hash=='a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e'
scene=bpy.context.scene;obj=bpy.data.objects['Beam2'];original_material=obj.material_slots[0].material
old_res=(scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage)
scene.render.resolution_x=128;scene.render.resolution_y=128;scene.render.resolution_percentage=100
adjustments=['Owned Beam2 material-only export/bake at 128px scene-output control; actual bake size follows the existing density/UV ladder; full-scene rendering is not this proof.']
controlled=None
if a.active_coat:
 controlled=original_material.copy();controlled.name='OwnedActiveCoatCubeWood';compiler._privatize_surface_groups(controlled.node_tree);obj.material_slots[0].material=controlled
 root,stack=compiler.tsl_ir.find_principled_root(controlled.node_tree,target='CYCLES')
 group_input=root.inputs['Coat Weight'].links[0].from_socket
 instance=stack[-1];instance.inputs[group_input.name].default_value=.5
 height_bump=next(node for node,_socket in procedural._walk_channel_upstream(root.inputs['Normal'],group_stack=stack)if node.bl_idname=='ShaderNodeBump')
 coat=root.id_data.nodes.new('ShaderNodeBump');coat.name='OwnedIndependentCoatBump';coat.invert=not height_bump.invert;coat.inputs['Distance'].default_value=height_bump.inputs['Distance'].default_value*.5;coat.inputs['Strength'].default_value=height_bump.inputs['Strength'].default_value
 if height_bump.inputs['Height'].is_linked:root.id_data.links.new(height_bump.inputs['Height'].links[0].from_socket,coat.inputs['Height'])
 else:coat.inputs['Height'].default_value=height_bump.inputs['Height'].default_value
 root.id_data.links.new(coat.outputs['Normal'],root.inputs['Coat Normal'])
 adjustments.append('Explicit owned active-coat derivative: group Clearcoat=.5; separate inverted half-distance Bump for Coat Normal. Original Cube coat weight is0.')
def state():
 return {'mesh':obj.data.as_pointer(),'material':obj.material_slots[0].material.as_pointer(),'modifiers':[(m.name,m.show_viewport,m.show_render,getattr(m,'levels',None),getattr(m,'render_levels',None))for m in obj.modifiers],'vertices':len(obj.data.vertices),'uvs':[(x.name,x.active_render)for x in obj.data.uv_layers],'meshCount':len(bpy.data.meshes),'materialCount':len(bpy.data.materials),'groupCount':len(bpy.data.node_groups),'imageCount':len(bpy.data.images)}
before=state();plan=compiler.plan_materials([obj],purpose='preview',automatic_programs=True);assert not plan.errors,compiler.format_plan_errors(plan)
normals=[row['channel']for row in plan.decisions[0].channel_plan['channels']if row.get('pass')=='NORMAL'];assert 'Normal'in normals and ('Coat Normal'in normals)==a.active_coat
reference= bakelib.bake_tangent_normal_field_pixels;save=bakelib.save_channel_png;latest={};rows=[];counter=0;surface_cache={};contract=json.loads((ROOT/'experiments/cycles-normal-bake/numeric-contract.json').read_text())
def capture(*args,**kwargs):
 global counter
 result=reference(*args,**kwargs);counter+=1;label=kwargs['label']
 key=(tuple(owner.name for owner in args[0]),kwargs['size'],kwargs['uv_layer'])
 if 'surfaceCoverage' in result:surface_cache[key]=result['surfaceCoverage']
 if key not in surface_cache:
  white=bpy.data.materials.new('OWNED_ZERO_MARGIN_SURFACE_COVERAGE');tree=bakelib.ensure_shader_node_tree(white);tree.nodes.clear();sink=tree.nodes.new('ShaderNodeEmission');sink.inputs['Color'].default_value=(1,1,1,1);output=tree.nodes.new('ShaderNodeOutputMaterial');tree.links.new(sink.outputs['Emission'],output.inputs['Surface']);slots=[]
  try:
   for owner in args[0]:
    for slot in owner.material_slots:slots.append((slot,slot.link,slot.material));slot.link='DATA';slot.material=white
   core=bakelib.bake_channel_field_pixels(args[0],size=kwargs['size'],margin_px=0,uv_layer=kwargs['uv_layer'],label='Independent actual zero-margin surface coverage')
   surface_cache[key]=core['coverage']
  finally:
   for slot,link,material in reversed(slots):slot.link=link;slot.material=material
   bpy.data.materials.remove(white)
 result['surfaceCoverage']=surface_cache[key];latest[label]=result
 np.save(out/f'float-{counter}.npy',result['pixels']);np.save(out/f'coverage-{counter}.npy',result['coverage']);np.save(out/f'surface-coverage-{counter}.npy',result['surfaceCoverage']);return result
def checked_save(pixels,coverage,path,**kwargs):
 result=save(pixels,coverage,path,**kwargs);label=kwargs.get('label','')
 if label in latest:
  raw=bpy.data.images.load(result['path'],check_existing=False)
  try:
   raw.colorspace_settings.name='Non-Color';decoded=np.empty(raw.size[0]*raw.size[1]*4,dtype=np.float32);raw.pixels.foreach_get(decoded);decoded=decoded.reshape(raw.size[1],raw.size[0],4)[:,:,:3]
  finally:bpy.data.images.remove(raw)
  expected=np.asarray(pixels,dtype=np.float32).reshape(decoded.shape);mask=np.asarray(coverage,dtype=bool);error=float(np.abs(decoded[mask]-expected[mask]).max());core=np.asarray(latest[label]['surfaceCoverage'],dtype=bool);assert np.all(~core|mask);native=expected[core]*2-1;encoded=decoded[core]*2-1;length=np.linalg.norm(native,axis=1)
  assert np.isfinite(native).all()and float(length.min())>=contract['decodedNormal']['minimumReferenceLength']and float(length.max())<=contract['decodedNormal']['maximumReferenceLength']
  angular=np.degrees(np.arccos(np.clip(np.sum(native*encoded,axis=1)/(length*np.linalg.norm(encoded,axis=1)),-1,1)));maximum=float(angular.max())
  assert error<=contract['pngEncoding']['maxEncodedComponentError'],(label,error)
  assert maximum<=contract['decodedNormal']['maxAngularDegrees'],(label,maximum)
  rows.append({'channel':label,'maxEncodedError':error,'maxAngularDegrees':maximum,'expandedCoveredTexels':int(mask.sum()),'actualSurfaceTexels':int(core.sum()),'minimumSurfaceNormalLength':float(length.min()),'deviceClass':latest[label]['deviceClass'],'backend':latest[label]['backend'],'sha256':result['sha256'],'size':[result['width'],result['height']]})
 return result
bakelib.bake_tangent_normal_field_pixels=capture;bakelib.save_channel_png=checked_save
try:
 def emit(path):
  # The actual production exporter stamps this same source-name-derived field.
  prop=compiler.tsl_ir.OBJECT_RANDOM_PROPERTY;stamped=prop not in obj
  if stamped:obj[prop]=compiler.tsl_ir.object_random_number(obj.name)
  try:
   bakelib.select_only([obj]);return bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_materials='EXPORT',export_extras=True,export_yup=True,export_apply=False,export_tangents=True,export_animations=False)
  finally:
   if stamped:del obj[prop]
 value,compilation=compiler.with_compiled_materials(plan,str(out/'material.glb'),emit);assert value=={'FINISHED'};assert state()==before,(before,state())
 import export_scene
 material_programs=export_scene.publish_material_programs(plan,str(out/'material.glb'))
 assert len(rows)==len(normals)
 report={'status':'PASSED_OWNED_CUBE_NORMAL_BAKE_CARRIER','proofRole':'Actual owned Cube material normal bake/PNG/basis/carrier proof only; no live-node or whole-material lighting parity credit','version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'sourceHash':source_hash,'sourcePreserved':hashlib.sha256(source.read_bytes()).hexdigest()==source_hash,'engine':scene.render.engine,'adjustments':adjustments,'normalChannels':normals,'normalBakes':counter,'rows':rows,'compilation':compilation.as_dict(),'materialPrograms':material_programs,'stateRestored':state()==before,'numericContract':contract}
 (out/'report.json').write_text(json.dumps(report,indent=2,default=str)+'\n');print('OWNED_CUBE_NORMAL_BAKE_PASSED '+json.dumps(rows))
finally:
 bakelib.bake_tangent_normal_field_pixels=reference;bakelib.save_channel_png=save
 scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage=old_res
 if controlled is not None:
  obj.material_slots[0].material=original_material
  groups=[]
  def collect(tree):
   for node in tree.nodes:
    group=getattr(node,'node_tree',None)
    if group is not None and group.get('blendlink_private_export_group'):groups.append(group);collect(group)
  collect(controlled.node_tree);bpy.data.materials.remove(controlled)
  for group in groups:
   if group.users==0:bpy.data.node_groups.remove(group)
 assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
