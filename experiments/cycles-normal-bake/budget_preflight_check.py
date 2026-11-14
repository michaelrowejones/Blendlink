"""CPU/no-render SIMPLE budget checks; original Floor is never evaluated."""
from pathlib import Path
import hashlib,json,sys
from unittest.mock import patch
import bpy
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import material_compiler as compiler
import procedural
source=Path(sys.argv[sys.argv.index('--')+1]);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash=='a9906942c7100612cdcbc086b31179c96d1125c034140b39a87b9fe9fe65ab7e'
with bpy.data.libraries.load(str(source),link=False)as(catalog,owned):owned.objects=['Floor','Beam2']
floor,wood=owned.objects
bpy.context.scene.render.engine='CYCLES';bpy.context.scene.render.use_simplify=False
state=lambda obj:(obj.data.as_pointer(),tuple((m.as_pointer(),m.show_viewport,m.show_render,getattr(m,'levels',None),getattr(m,'render_levels',None))for m in obj.modifiers),tuple(s.material.as_pointer()if s.material else None for s in obj.material_slots))
before=[state(obj)for obj in owned.objects]
assert compiler._simple_normal_receiver_triangles(floor)==8_388_608
assert compiler._simple_normal_receiver_triangles(wood)is None
# If planning touches the general evaluated-material or materialized mesh
# paths, fail instead of allocating the real high-resolution Floor.
def forbidden(*args,**kwargs):raise AssertionError('Floor preflight attempted evaluated mesh allocation')
with patch.object(procedural,'evaluated_material_uses',forbidden),patch.object(compiler,'_materialized_binding_hash',forbidden),patch.object(bpy.types.Object,'evaluated_get',forbidden,create=True):
 plan=compiler.plan_materials([floor],purpose='final',automatic_programs=True)
 assert any(issue.code=='material.normal-bake-geometry-budget'and issue.objects==('Floor',)and '8,388,608'in issue.problem for issue in plan.errors),[i.as_dict()for i in plan.errors]
# Small independent actual native mesh controls prove the admitted formula.
material=bpy.data.materials.new('Small SIMPLE test')
mesh=bpy.data.meshes.new('Small regular quad');mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)]);mesh.materials.append(material)
obj=bpy.data.objects.new('Small regular receiver',mesh);bpy.context.scene.collection.objects.link(obj)
sub=obj.modifiers.new('Render SIMPLE','SUBSURF');sub.subdivision_type='SIMPLE'
counts=[]
for level in (1,2,3):
 sub.levels=level;sub.render_levels=level
 expected=compiler._simple_normal_receiver_triangles(obj);graph=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(graph);actual=evaluated.to_mesh()
 try:assert expected==len(actual.loops)-2*len(actual.polygons)==2*4**level
 finally:evaluated.to_mesh_clear()
 counts.append(expected)
# Hidden source faces remain object-mode render geometry. Compare the actual
# tiny native result; do not infer their count from viewport edit visibility.
mesh.polygons[0].hide=True
assert compiler._simple_normal_receiver_triangles(obj)==128
graph=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(graph);actual=evaluated.to_mesh()
try:assert len(actual.loops)-2*len(actual.polygons)==128
finally:evaluated.to_mesh_clear()
mesh.polygons[0].hide=False
# RNA animation belongs to the object ID even when the animated path names a
# modifier. Both keyed levels and a driven render-enable flag decline early.
sub.keyframe_insert(data_path='render_levels',frame=1)
assert compiler._simple_normal_receiver_triangles(obj)is None;obj.animation_data_clear()
sub.driver_add('show_render').driver.expression='1'
assert compiler._simple_normal_receiver_triangles(obj)is None;obj.animation_data_clear()
if hasattr(sub,'use_adaptive_subdivision'):
 sub.use_adaptive_subdivision=True;assert compiler._simple_normal_receiver_triangles(obj)is None;sub.use_adaptive_subdivision=False
bpy.context.scene.keyframe_insert(data_path='render.use_simplify',frame=1)
assert compiler._simple_normal_receiver_triangles(obj)is None;bpy.context.scene.animation_data_clear()
# A viewport-only SIMPLE modifier changes neither render count nor slot zero.
viewport=obj.modifiers.new('Viewport only SIMPLE','SUBSURF');viewport.subdivision_type='SIMPLE';viewport.show_render=False;viewport.levels=1
assert compiler._simple_normal_receiver_triangles(obj)==128
uses=procedural.evaluated_material_uses(obj)
assert len(uses)==1 and uses[0].source_slot_index==0 and uses[0].material==material
viewport.show_viewport=False
graph=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(graph);actual=evaluated.to_mesh()
try:assert len(actual.loops)-2*len(actual.polygons)==128
finally:evaluated.to_mesh_clear()
obj.modifiers.remove(viewport)
normal=obj.modifiers.new('Topology-preserving normals','NORMAL_EDIT');assert compiler._simple_normal_receiver_triangles(obj)is None
normal.no_polynors_fix=True;assert compiler._simple_normal_receiver_triangles(obj)==128
normal.show_render=False;normal.show_viewport=False
for kind in ('BEVEL','DECIMATE','TRIANGULATE','MIRROR'):
 modifier=obj.modifiers.new('Unproved '+kind,kind);assert compiler._simple_normal_receiver_triangles(obj)is None;obj.modifiers.remove(modifier)
sub.subdivision_type='CATMULL_CLARK';assert compiler._simple_normal_receiver_triangles(obj)is None;sub.subdivision_type='SIMPLE'
sub.show_render=False;assert compiler._simple_normal_receiver_triangles(obj)is None;sub.show_render=True
bpy.context.scene.render.use_simplify=True;assert compiler._simple_normal_receiver_triangles(obj)is None;bpy.context.scene.render.use_simplify=False
mesh.polygons[0].material_index=1;assert compiler._simple_normal_receiver_triangles(obj)is None;mesh.polygons[0].material_index=0
obj.material_slots[0].link='OBJECT';assert compiler._simple_normal_receiver_triangles(obj)is None;obj.material_slots[0].link='DATA'
sub2=obj.modifiers.new('Second SIMPLE','SUBSURF');sub2.subdivision_type='SIMPLE';sub2.render_levels=1;sub2.levels=1
assert compiler._simple_normal_receiver_triangles(obj)==512
invalid=bpy.data.meshes.new('Nonmanifold quad control');invalid.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3),(0,1,2,3)]);invalid.materials.append(material)
prior=obj.data;obj.data=invalid;assert compiler._simple_normal_receiver_triangles(obj)is None;obj.data=prior
# These malformed/loose source arrays are never sent through native evaluation.
# The fast path must decline them rather than claim OpenSubdiv's output count.
for name,vertices,edges,faces in [
 ('Loose vertex',[(0,0,0),(1,0,0),(1,1,0),(0,1,0),(2,2,2)],[],[(0,1,2,3)]),
 ('Loose edge',[(0,0,0),(1,0,0),(1,1,0),(0,1,0),(2,2,2),(3,3,3)],[(4,5)],[(0,1,2,3)]),
 ('Opposed duplicate faces',[(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3),(3,2,1,0)])]:
 malformed=bpy.data.meshes.new(name);malformed.from_pydata(vertices,edges,faces);malformed.materials.append(material);obj.data=malformed
 assert compiler._simple_normal_receiver_triangles(obj)is None,name
obj.data=prior
for path,value in [('vertex_index',999),('edge_index',999)]:
 original=getattr(mesh.loops[0],path);setattr(mesh.loops[0],path,value)
 assert compiler._simple_normal_receiver_triangles(obj)is None,path
 setattr(mesh.loops[0],path,original)
original=tuple(mesh.edges[0].vertices);mesh.edges[0].vertices=(0,0)
assert compiler._simple_normal_receiver_triangles(obj)is None;mesh.edges[0].vertices=original
assert before==[state(item)for item in owned.objects]
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('PASSED_NORMAL_BUDGET_PREFLIGHT '+json.dumps({'liveNodeCredit':0,'renderCalls':0,'bakeCalls':0,'floorEvaluated':False,'floorSourceFaces':4096,'floorRenderTriangles':8388608,'smallNativeCounts':counts,'hiddenFaceNativeTriangles':128,'viewportOnlySlotBindingPreserved':True,'renderEquivalentViewportOnlyTriangles':128,'sourceAndOwnedStatePreserved':True}))
