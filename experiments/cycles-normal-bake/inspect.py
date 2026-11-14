"""CPU-only owned-copy Cube planning inspection; no bake/render/source save."""
from pathlib import Path
import argparse,hashlib,json,sys
import bpy
p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--output',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);root=Path(a.root).resolve();out=Path(a.output).resolve()
sys.path[:0]=[str(root/'packages/blender-addon'),str(root/'packages/blendlink/blender')]
import material_compiler as compiler
import procedural,bakelib
source=Path(bpy.data.filepath);before=hashlib.sha256(source.read_bytes()).hexdigest()
scope=[obj for obj in bpy.context.view_layer.objects if not obj.hide_render]
meshes=[obj for obj in scope if obj.type=='MESH']
def report(plan):return{'errors':[str(x) for x in plan.errors],'decisions':[{'material':d.material_name,'outcome':d.outcome,'issues':[{'code':i.code,'problem':i.problem}for i in d.issues],'channelPlan':d.channel_plan,'bindings':[{'object':b.object_name,'slot':b.slot_index} for b in d.bindings]}for d in plan.decisions]}
initial=compiler.plan_materials(meshes,purpose='final',automatic_programs=True)
materials=sorted({obj.material_slots[b.slot_index].material for d in initial.decisions for b in d.bindings for obj in meshes if obj.name==b.object_name},key=lambda x:x.name)
def socket_value(s):
 try:return list(s.default_value)
 except TypeError:return s.default_value
records=[]
for m in materials:
 tree,root_node=compiler._principled_root_of(m)
 try:root_node,root_stack=compiler.tsl_ir.find_principled_root(tree,target="CYCLES")
 except Exception:root_stack=()
 records.append({'material':m.name,'routing':procedural.material_channel_routing(tree,procedural.reachable_surface_nodes(tree)) if tree else None,'normalSources':{name:[(n.bl_idname,o.name)for n,o in procedural._walk_channel_upstream(root_node.inputs[name],group_stack=root_stack)]for name in ['Normal','Coat Normal'] if root_node and root_node.inputs.get(name)},'inputs':[{ 'name':s.name,'linked':s.is_linked,'value':socket_value(s) if hasattr(s,'default_value') else None,'sources':[{'node':link.from_node.name,'type':link.from_node.bl_idname,'socket':link.from_socket.name}for link in s.links]} for s in root_node.inputs]if root_node else None})
for m in materials:compiler.set_material_bake(m,True)
explicit=compiler.plan_materials(meshes,purpose='final',automatic_programs=True)
result={'proofRole':'CPU planning inspection only; zero numerical/bake/live-node credit','native':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode()},'source':{'copy':str(source),'sha256Before':before,'sha256After':hashlib.sha256(source.read_bytes()).hexdigest()},'engine':bpy.context.scene.render.engine,'initial':report(initial),'explicitBake':report(explicit),'materials':records,'objects':[{'name':obj.name,'scale':list(obj.scale),'vertices':len(obj.data.vertices),'polygons':len(obj.data.polygons),'uvs':[{'name':layer.name,'activeRender':layer.active_render}for layer in obj.data.uv_layers],'modifiers':[{'name':x.name,'type':x.type,'showRender':x.show_render,'showViewport':x.show_viewport,'levels':getattr(x,'levels',None),'renderLevels':getattr(x,'render_levels',None)}for x in obj.modifiers]}for obj in meshes]}
assert result['source']['sha256After']==before
out.write_text(json.dumps(result,indent=2,default=str)+'\n');print('CYCLES_NORMAL_INSPECTION_PASSED '+str(out))
