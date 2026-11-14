# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Pinned5.3 source admission only; no render/bake/clock qualification.
"""Owned no-render Scene Time dependency and export-intent regressions."""
from pathlib import Path
import hashlib,json,sys,tempfile
import bpy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'packages/blender-addon'),str(ROOT/'packages/blendlink/blender')]
import procedural,export_scene,material_compiler
assert tuple(bpy.app.version)==(5,3,0)
pins={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in ['packages/blender-addon/material_time.py','packages/blender-addon/procedural.py','packages/blendlink/blender/export_scene.py']}
rows=[]

def setup(engine):
 bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.engine=engine
 mesh=bpy.data.meshes.new('Owned temporal quad');mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)])
 obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
 material=bpy.data.materials.new('Owned temporal material');material.use_nodes=True;mesh.materials.append(material)
 tree=material.node_tree;root=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled');time=tree.nodes.new('GeometryNodeInputSceneTime')
 return obj,material,tree,root,time

def state(obj):
 def value(socket):
  v=getattr(socket,'default_value',None)
  if v is None or isinstance(v,(str,bool,int,float)):return v
  try:return tuple(v)
  except TypeError:return str(v)
 trees=[];seen=set()
 def visit(tree):
  if tree.as_pointer()in seen:return
  seen.add(tree.as_pointer());trees.append((tree.as_pointer(),[(n.as_pointer(),n.bl_idname,n.mute,[(s.identifier,value(s))for s in n.inputs])for n in tree.nodes],[(l.from_node.as_pointer(),l.from_socket.identifier,l.to_node.as_pointer(),l.to_socket.identifier,l.is_muted)for l in tree.links]))
  for n in tree.nodes:
   if getattr(n,'node_tree',None):visit(n.node_tree)
 for slot in obj.material_slots:
  if slot.material and slot.material.node_tree:visit(slot.material.node_tree)
 return repr((obj.data.as_pointer(),[(s.link,s.material.as_pointer()if s.material else None)for s in obj.material_slots],list(obj.items()),trees,len(bpy.data.meshes),len(bpy.data.materials),len(bpy.data.node_groups)))

def inspect_case(label,obj,material,expected):
 before=state(obj);found=procedural.material_scene_time_dependencies(material)
 assert bool(found)==expected,(label,found)
 assert state(obj)==before,label+' changed source ownership'
 rows.append(label)
 return found

def policy(label,obj,expected,settings=None):
 settings={'mode':'standard',**(settings or{})};before=state(obj);sidecar={'diagnostics':{}}
 try:plan,_=export_scene.plan_export_materials(settings,sidecar,{})
 except SystemExit as error:
  assert expected=='blocked'and 'material.scene-time-clock-unproven'in str(error),(label,error)
 else:
  assert expected!='blocked',(label,plan.as_dict())
  if expected:
   assert sidecar['diagnostics']['sceneTime'][0]['status']==expected,(label,sidecar)
   if expected=='private-inspection-only':assert 'PRIVATE PREVIEW ONLY'in sidecar['diagnostics']['sceneTime'][0]['message']
 assert state(obj)==before,label+' mutated source'
 rows.append(label)

for engine in ['BLENDER_EEVEE','CYCLES']:
 obj,material,tree,root,time=setup(engine);tree.links.new(time.outputs['Frame'],root.inputs['Base Color'])
 inspect_case(engine+' direct',obj,material,True)
 assert obj not in export_scene.render_meshes()
 assert procedural.fixed_camera_material_bake_reason(material)is None
 for label,settings in [('Final',{}),('connected preview',{'draft':True}),('authoring flag without draft',{'authoringPreview':True}),('automatic disabled',{'automaticMaterials':False}),('Automatic Appearance',{'mode':'baked'})]:policy(engine+' '+label,obj,'blocked',settings)
 policy(engine+' private inspection',obj,'private-inspection-only',{'draft':True,'authoringPreview':True})
 obj['blendlink_dynamic']=False
 assert obj in export_scene.render_meshes()and 'Scene Time'in procedural.forced_bake_risk(obj)
 policy(engine+' explicit Appearance',obj,'explicit-appearance-capture',{'mode':'baked'})
 policy(engine+' explicit flag without bake',obj,'blocked')
 policy(engine+' explicit Lighting',obj,'blocked',{'mode':'baked','bake':{'atlases':{'main':{'bakeOutput':'lighting'}}}})
 obj['blendlink_texel_weight']=0
 policy(engine+' Baked flag with no atlas receiver',obj,'blocked',{'mode':'baked'})
 del obj['blendlink_texel_weight'];del obj['blendlink_dynamic']
 # Time cannot acquire a clock-free exception by also feeding fixed-camera art.
 camera_data=tree.nodes.new('ShaderNodeCameraData');mix=tree.nodes.new('ShaderNodeMath');mix.operation='ADD';tree.links.new(time.outputs['Frame'],mix.inputs[0]);tree.links.new(camera_data.outputs[0],mix.inputs[1]);tree.links.new(mix.outputs[0],root.inputs['Base Color'])
 assert procedural.fixed_camera_material_bake_reason(material)is None
 assert procedural.effective_dynamic_reason(obj,fixed_camera_appearance=True)is not None
 rows.append(engine+' no fixed-camera clock exemption')
 # Reroute and native mute bypass read the selected output's actual input.
 reroute=tree.nodes.new('NodeReroute');tree.links.new(time.outputs['Seconds'],reroute.inputs[0]);tree.links.new(reroute.outputs[0],root.inputs['Base Color']);inspect_case(engine+' reroute',obj,material,True)
 math=tree.nodes.new('ShaderNodeMath');math.operation='ADD';constant=tree.nodes.new('ShaderNodeValue');constant.outputs[0].default_value=.25;tree.links.new(constant.outputs[0],math.inputs[0]);tree.links.new(time.outputs['Frame'],math.inputs[1]);tree.links.new(math.outputs[0],root.inputs['Base Color']);math.mute=True
 inspect_case(engine+' muted unused input',obj,material,False);policy(engine+' muted bypass Final',obj,None)
 tree.links.new(time.outputs['Frame'],math.inputs[0]);inspect_case(engine+' muted contributing input',obj,material,True)
 tree.links.new(time.outputs['Frame'],root.inputs['Base Color']);time.mute=True;inspect_case(engine+' muted Time',obj,material,False);time.mute=False
 # Unlinked scratch Time does not block a material or its capture ownership.
 tree.links.remove(root.inputs['Base Color'].links[0]);inspect_case(engine+' unlinked',obj,material,False);policy(engine+' unlinked Final',obj,None)
 # Reused group instances bind only the input that reaches the chosen output.
 group=bpy.data.node_groups.new('Owned reused temporal group','ShaderNodeTree')
 for name in ['Used','Unused']:group.interface.new_socket(name=name,in_out='INPUT',socket_type='NodeSocketFloat')
 group.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat')
 entry,out=group.nodes.new('NodeGroupInput'),group.nodes.new('NodeGroupOutput');group.links.new(entry.outputs['Used'],out.inputs['Value'])
 first,second=tree.nodes.new('ShaderNodeGroup'),tree.nodes.new('ShaderNodeGroup');first.node_tree=second.node_tree=group
 tree.links.new(time.outputs['Frame'],first.inputs['Unused']);tree.links.new(time.outputs['Frame'],second.inputs['Used']);tree.links.new(first.outputs['Value'],root.inputs['Base Color'])
 inspect_case(engine+' unused group input and instance',obj,material,False)
 tree.links.new(second.outputs['Value'],root.inputs['Base Color']);found=inspect_case(engine+' reused contributing group',obj,material,True);assert found[0]['instances']==[] # Source is outside this group.
 outer=bpy.data.node_groups.new('Owned nested temporal group','ShaderNodeTree');outer.interface.new_socket(name='Value',in_out='OUTPUT',socket_type='NodeSocketFloat');sink=outer.nodes.new('NodeGroupOutput');inner=outer.nodes.new('ShaderNodeGroup');inner.node_tree=group;clock=outer.nodes.new('GeometryNodeInputSceneTime');outer.links.new(clock.outputs['Seconds'],inner.inputs['Used']);outer.links.new(inner.outputs['Value'],sink.inputs['Value'])
 instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=outer;tree.links.new(instance.outputs['Value'],root.inputs['Base Color']);found=inspect_case(engine+' nested contributing group',obj,material,True);assert found[0]['instances']==[instance.name]
 # All qualified selector families prune only a fixed unselected branch.
 for identifier in ['GeometryNodeSwitch','GeometryNodeIndexSwitch','GeometryNodeMenuSwitch']:
  node=tree.nodes.new(identifier)
  if identifier=='GeometryNodeSwitch':node.input_type='FLOAT'
  else:node.data_type='FLOAT'
  tree.links.new(time.outputs['Frame'],node.inputs[2]);tree.links.new(node.outputs[0],root.inputs['Base Color'])
  node.inputs[0].default_value=False if identifier=='GeometryNodeSwitch'else 0 if identifier=='GeometryNodeIndexSwitch'else node.enum_items[0].name
  inspect_case(engine+' inactive '+identifier,obj,material,False);policy(engine+' inactive selector Final '+identifier,obj,None)
  node.inputs[0].default_value=True if identifier=='GeometryNodeSwitch'else 1 if identifier=='GeometryNodeIndexSwitch'else node.enum_items[1].name
  inspect_case(engine+' active '+identifier,obj,material,True)
 # A source-engine-inactive output is not a material dependency.
 original=next(n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial');original.target='CYCLES'
 alternate=tree.nodes.new('ShaderNodeOutputMaterial');alternate.target='EEVEE';plain=tree.nodes.new('ShaderNodeBsdfPrincipled');tree.links.new(plain.outputs[0],alternate.inputs['Surface'])
 assert bool(procedural.material_scene_time_dependencies(material,target='CYCLES'))
 assert not procedural.material_scene_time_dependencies(material,target='EEVEE')
 rows.append(engine+' inactive engine output');policy(engine+' source-engine output Final',obj,'blocked'if engine=='CYCLES'else None)
 # Time still depends on the clock when its owner also has animation.
 original.target='ALL';tree.nodes.remove(alternate);tree.links.new(time.outputs['Frame'],root.inputs['Base Color'])
 root.inputs['Roughness'].keyframe_insert(data_path='default_value',frame=1);inspect_case(engine+' animated owner',obj,material,True);policy(engine+' animated Time Final',obj,'blocked')
# Render-used source slots: an attached unused Time material is not a dependency.
for engine in ['BLENDER_EEVEE','CYCLES']:
 obj,material,tree,root,time=setup(engine);tree.links.new(time.outputs['Frame'],root.inputs['Base Color'])
 plain=bpy.data.materials.new('Owned used plain slot');plain.use_nodes=True
 obj.data.materials.clear();obj.data.materials.append(plain);obj.data.materials.append(material)
 assert not procedural.object_scene_time_dependencies(obj)
 assert procedural.dynamic_reason(obj)is None
 policy(engine+' unused attached material',obj,None)
 # A material-generating modifier can reference Time outside source slots;
 # admission inspects ID references and refuses uncertainty without a mesh copy.
 geometry=bpy.data.node_groups.new('Owned Time assignment','GeometryNodeTree');geometry.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry');geometry.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
 entry,out=geometry.nodes.new('NodeGroupInput'),geometry.nodes.new('NodeGroupOutput');assign=geometry.nodes.new('GeometryNodeSetMaterial');assign.inputs['Material'].default_value=material
 geometry.links.new(entry.outputs['Geometry'],assign.inputs['Geometry']);geometry.links.new(assign.outputs['Geometry'],out.inputs['Geometry'])
 obj.data.materials.pop(index=1);modifier=obj.modifiers.new('Owned referenced Time assignment','NODES');modifier.node_group=geometry
 before=state(obj);dependencies=procedural.object_scene_time_dependencies(obj)
 assert dependencies and dependencies[0]['unproven']and dependencies[0]['material']==material.name,dependencies
 assert state(obj)==before
 policy(engine+' evaluated-only Time material refused',obj,'blocked')
 # Nested referenced objects can introduce materials through their own native
 # modifiers; the reference census must close those IDs without evaluation.
 operand=bpy.data.objects.new('Owned temporal Boolean operand',obj.data.copy());operand.data.materials.clear();operand.data.materials.append(material)
 referenced=bpy.data.objects.new('Owned indirectly referenced object',obj.data.copy())
 boolean=referenced.modifiers.new('Owned indirect material introduction','BOOLEAN');boolean.object=operand
 info=geometry.nodes.new('GeometryNodeObjectInfo');info.inputs['Object'].default_value=referenced
 assign.inputs['Material'].default_value=None
 assert procedural.object_scene_time_dependencies(obj)
 policy(engine+' nested object modifier material refused',obj,'blocked')
 boolean.object=None
 collection=bpy.data.collections.new('Owned referenced parent collection');child=bpy.data.collections.new('Owned referenced child collection');collection.children.link(child);child.objects.link(operand)
 instance=bpy.data.objects.new('Owned collection instance',None);instance.instance_type='COLLECTION';instance.instance_collection=collection
 info.inputs['Object'].default_value=instance
 policy(engine+' nested collection instance material refused',obj,'blocked')
 # Custom Geometry Nodes ID inputs on referenced objects have the same closure.
 info.inputs['Object'].default_value=referenced
 nested=bpy.data.node_groups.new('Owned ID-bound material','GeometryNodeTree');socket=nested.interface.new_socket(name='Material',in_out='INPUT',socket_type='NodeSocketMaterial');nested.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry');nested.nodes.new('NodeGroupOutput')
 nested_modifier=referenced.modifiers.new('Owned indirect GN material','NODES');nested_modifier.node_group=nested;getattr(nested_modifier.properties.inputs,socket.identifier).value=material
 policy(engine+' referenced modifier custom material refused',obj,'blocked')
 # Web Color replaces downstream response only when that actual lowering
 # survives. The authored temporal Surface remains out of Automatic atlases.
 obj,material,tree,root,time=setup(engine);tree.links.new(time.outputs['Frame'],root.inputs['Base Color'])
 literal=tree.nodes.new('ShaderNodeRGB');literal.outputs[0].default_value=(.25,.5,.75,1)
 marker=material_compiler.set_web_source(material,literal,literal.outputs[0].identifier,'COLOR',surface_response='unlit')
 assert obj not in export_scene.render_meshes()
 policy(engine+' selected constant surviving realtime',obj,'selected-field-replacement')
 policy(engine+' selected constant surviving Hybrid',obj,'selected-field-replacement',{'mode':'baked'})
 material_compiler.set_web_source(material,time,time.outputs['Frame'].identifier,'COLOR',surface_response='unlit')
 policy(engine+' Time upstream selected field',obj,'blocked')
 tree.links.remove(marker.inputs[material_compiler.COLOR_INPUT].links[0])
 policy(engine+' stale marker is not capture authorization',obj,'blocked')
 # A selected Time field cannot evade admission merely because the original
 # authored Surface is constant and Automatic would otherwise bake it.
 tree.links.remove(root.inputs['Base Color'].links[0])
 material_compiler.set_web_source(material,time,time.outputs['Frame'].identifier,'COLOR',surface_response='unlit')
 assert obj not in export_scene.render_meshes()
 policy(engine+' selected Time on constant Surface',obj,'blocked',{'mode':'baked'})
 # Local and linked materials may share a name. Admission retains native ID
 # identity rather than resolving the first material with the same short name.
 obj,material,tree,root,time=setup(engine);tree.links.new(time.outputs['Frame'],root.inputs['Base Color'])
 literal=tree.nodes.new('ShaderNodeRGB');material_compiler.set_web_source(material,literal,literal.outputs[0].identifier,'COLOR',surface_response='unlit')
 with tempfile.TemporaryDirectory(prefix='scenetoweb-time-linked-')as directory:
  library=str(Path(directory)/'owned-material.blend');bpy.data.libraries.write(library,{material})
  with bpy.data.libraries.load(library,link=True)as(source,owned):owned.materials=[material.name]
  linked=owned.materials[0];tree.links.remove(root.inputs['Base Color'].links[0]);obj.data.materials[0]=linked
  assert linked.name==material.name and linked.as_pointer()!=material.as_pointer()
  dependencies=procedural.object_scene_time_dependencies(obj);assert dependencies[0]['materialPointer']==linked.as_pointer()
  policy(engine+' linked material identity',obj,'blocked')
assert pins=={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()for p in pins}
print('PASSED_SCENE_TIME_ADMISSION '+json.dumps({'cases':len(rows),'renderCalls':0,'bakeCalls':0,'clockImplementation':False,'numericalQualificationCredit':0,'sourcePreserved':True}))
