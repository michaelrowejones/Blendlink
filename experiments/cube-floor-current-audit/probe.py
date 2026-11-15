# SPDX-License-Identifier: GPL-3.0-or-later
"""Owned original Floor source inspection; no evaluated geometry/render/bake."""
from pathlib import Path
from array import array
from unittest.mock import patch
import hashlib,json,sys
import bpy,gpu
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[sys.argv.index('--')+1]);SOURCE=Path(sys.argv[sys.argv.index('--')+2])
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler,procedural
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
expected='a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e';assert sha(SOURCE)==expected
counts={'gpu':0,'render':0,'evaluate':0};old_ops=bpy.ops;old_init=gpu.init;old_context=bpy.context
class RenderGuard:
 def __getattr__(self,name):
  def denied(*args,**kwargs):counts['render']+=1;raise RuntimeError('Floor audit forbids render/bake')
  return denied
class ContextGuard:
 def __getattr__(self,name):return no_eval if name=='evaluated_depsgraph_get'else getattr(old_context,name)
class OpsGuard:
 def __getattr__(self,name):return RenderGuard()if name=='render'else getattr(old_ops,name)
def no_gpu(*args,**kwargs):counts['gpu']+=1;raise RuntimeError('Floor audit forbids GPU initialization')
def no_eval(*args,**kwargs):counts['evaluate']+=1;raise RuntimeError('Floor audit forbids evaluated geometry')
def plain(x):
 if isinstance(x,(bool,int,float,str))or x is None:return x
 try:return list(x)
 except TypeError:return str(x)
def fingerprint(obj):
 mesh=obj.data;result={'object':obj.as_pointer(),'mesh':mesh.as_pointer(),'matrix':[list(v)for v in obj.matrix_world], 'materials':[(s.link,s.material.as_pointer()if s.material else None)for s in obj.material_slots], 'modifiers':[],'arrays':{}}
 for modifier in obj.modifiers:
  result['modifiers'].append({p.identifier:plain(getattr(modifier,p.identifier))for p in modifier.bl_rna.properties if p.identifier not in {'rna_type'}and p.type in {'BOOLEAN','INT','FLOAT','STRING','ENUM'}})
 for key,items,prop,size,kind in [('position',mesh.vertices,'co',3,'f'),('edge',mesh.edges,'vertices',2,'i'),('loop_vertex',mesh.loops,'vertex_index',1,'i'),('loop_edge',mesh.loops,'edge_index',1,'i'),('face_material',mesh.polygons,'material_index',1,'i'),('face_smooth',mesh.polygons,'use_smooth',1,'b'),('face_hide',mesh.polygons,'hide',1,'b')]:
  values=array(kind,[0])*(len(items)*size);items.foreach_get(prop,values);result['arrays'][key]=hashlib.sha256(values.tobytes()).hexdigest()
 for uv in mesh.uv_layers:
  values=array('f',[0])*(len(uv.data)*2);uv.data.foreach_get('uv',values);result['arrays']['uv:'+uv.name]=hashlib.sha256(values.tobytes()).hexdigest()
 return result
bpy.ops=OpsGuard();gpu.init=no_gpu;bpy.context=ContextGuard()
try:
 with patch.object(procedural,'evaluated_material_uses',no_eval),patch.object(compiler,'_materialized_binding_hash',no_eval):
  for action,key in [(gpu.init,'gpu'),(bpy.ops.render.render,'render'),(bpy.ops.render.bake,'render'),(bpy.context.evaluated_depsgraph_get,'evaluate'),(lambda:procedural.evaluated_material_uses(None),'evaluate'),(lambda:compiler._materialized_binding_hash(None),'evaluate')]:
   try:action()
   except RuntimeError:pass
   else:raise AssertionError('Guard did not refuse '+key)
  assert counts=={'gpu':1,'render':2,'evaluate':3}
  counts={k:0 for k in counts}
  with bpy.data.libraries.load(str(SOURCE),link=False)as(available,owned):owned.objects=['Floor']
  floor=owned.objects[0];assert floor.name=='Floor'and not floor.users_collection
  before=fingerprint(floor);mesh=floor.data;material=floor.material_slots[0].material
  bpy.context.scene.render.engine='CYCLES';bpy.context.scene.render.use_simplify=False
  root,stack=compiler.tsl_ir.find_principled_root(material.node_tree,target='CYCLES')
  channels=[]
  for socket in root.inputs:
   if not socket.enabled:continue
   sources=[]
   for node,output in procedural._walk_channel_upstream(socket,group_stack=stack):
    props={key:plain(getattr(node,key))for key in ['uv_map','attribute_name','vector_type','space','operation','data_type','blend_type','noise_dimensions','noise_type','normalize','invert','interpolation','projection','projection_blend','extension']if hasattr(node,key)}
    
    props['unlinkedInputs']={s.identifier:plain(s.default_value)for s in node.inputs if hasattr(s,'default_value')and not s.is_linked}
    if getattr(node,'image',None):
     image=node.image;props['image']={'name':image.name,'size':list(image.size),'colorspace':image.colorspace_settings.name,'packed':bool(image.packed_file),'packedSha256':hashlib.sha256(bytes(image.packed_file.data)).hexdigest()if image.packed_file else None}
    sources.append({'node':node.name,'class':node.bl_idname,'output':output.name,'tree':node.id_data.name,'properties':props})
   if sources:channels.append({'channel':socket.name,'sources':sources})
  triangles=compiler._simple_normal_receiver_triangles(floor);assert triangles==8_388_608
  with patch.object(procedural,'evaluated_material_uses',no_eval),patch.object(compiler,'_materialized_binding_hash',no_eval):
   plan=compiler.plan_materials([floor],purpose='final',automatic_programs=True)
  issues=[i.as_dict()for i in plan.errors];assert any(i['code']=='material.normal-bake-geometry-budget'for i in issues)
  after=fingerprint(floor);assert before==after;assert counts=={'gpu':0,'render':0,'evaluate':0};assert sha(SOURCE)==expected
  report={'schemaVersion':1,'status':'OBSERVED_ORIGINAL_FLOOR_SOURCE_ONLY','native':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode()},'source':{'path':str(SOURCE),'sha256Before':expected,'sha256After':sha(SOURCE),'ownedUnlinkedCopy':True,'sourceOwnershipPreserved':before==after},'sourceState':before,'floor':{'vertices':len(mesh.vertices),'edges':len(mesh.edges),'faces':len(mesh.polygons),'loops':len(mesh.loops),'bounds':[[min(v.co[i]for v in mesh.vertices)for i in range(3)],[max(v.co[i]for v in mesh.vertices)for i in range(3)]],'uvs':[{'name':uv.name,'activeRender':uv.active_render}for uv in mesh.uv_layers],'attributes':[{'name':a.name,'type':a.data_type,'domain':a.domain}for a in mesh.attributes],'material':material.name,'principled':root.name,'principledOwner':root.id_data.name,'groupAncestry':[n.name for n in stack],'renderTrianglesExact':triangles,'receiverBudget':compiler.NORMAL_BAKE_TRIANGLE_BUDGET},'contributingChannels':channels,'issues':issues,'decisionChannels':[(d.channel_plan or{}).get('channels',[])for d in plan.decisions],'guards':{'allCanariesRefused':True,**counts},'supportCredit':0,'finalCredit':0,'browserCredit':0}
  OUT.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n');print(report['status'])
finally:bpy.ops=old_ops;gpu.init=old_init;bpy.context=old_context
