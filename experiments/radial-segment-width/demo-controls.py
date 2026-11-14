# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only source controls; no renders, export or numerical qualification."""
import bpy,json,hashlib,math,os
from pathlib import Path
out=Path(os.environ['SCENETOWEB_RADIAL_DEMO_OUTPUT']).resolve();out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;source=Path(bpy.data.filepath);before=hashlib.sha256(source.read_bytes()).hexdigest();assert before=='bfc3cea66963e84c4468e8fac6b0313ef72265cafa5df36cf0f03d21479d1e3c'
value=lambda v:v if isinstance(v,(int,float,str,bool))or v is None else list(v)
group=bpy.data.node_groups['Radial Tiling'];mapping=next(n for n in group.nodes if n.bl_idname=='ShaderNodeMapRange');radial=next(n for n in group.nodes if n.bl_idname=='ShaderNodeRadialTiling');coord=next(n for n in group.nodes if n.bl_idname=='ShaderNodeTexCoord');mix=next(n for n in group.nodes if n.bl_idname=='ShaderNodeMix');radius=next(n for n in group.nodes if n.bl_idname=='ShaderNodeVectorMath'and n.operation=='DISTANCE')
instances=[]
for material in bpy.data.materials:
 if not material.node_tree:continue
 for node in material.node_tree.nodes:
  if getattr(node,'node_tree',None)==group:
   instances.append({'material':material.name,'node':node.name,'inputs':{s.name:value(s.default_value)for s in node.inputs if hasattr(s,'default_value')}})
assert len(instances)==2
for row in instances:assert row['inputs']=={'Scale':2.0,'Inner Ring Sides':3.0,'Outer Ring Sides':8.0,'Ring Limit':.5,'Roundness':1.0},row
assert mapping.interpolation_type=='STEPPED'and mapping.clamp is False and mapping.data_type=='FLOAT'
assert mapping.inputs['From Min'].default_value==0 and mapping.inputs['From Max'].default_value==1 and mapping.inputs['Steps'].default_value==1
assert radial.normalize is True and coord.object is None and coord.from_instancer is False and mix.data_type=='FLOAT'and radius.operation=='DISTANCE'
objects=[]
for owner in scene.objects:
 if owner.type!='MESH':continue
 assert len(owner.modifiers)==0 and owner.data.shape_keys is None and list(owner.scale)==[1,1,1]
 points=[tuple(v.co)for v in owner.data.vertices];assert all(p[2]==0 for p in points)
 xs=[p[0]*2 for p in points];ys=[p[1]*2 for p in points];maximum=math.hypot(max(map(abs,xs)),max(map(abs,ys)));assert 1<maximum<1.5
 objects.append({'name':owner.name,'sourceLocalXYBounds':[[min(p[0]for p in points),max(p[0]for p in points)],[min(p[1]for p in points),max(p[1]for p in points)]],'scaledXYBounds':[[min(xs),max(xs)],[min(ys),max(ys)]],'maximumRadius':maximum,'modifierCount':0,'shapeKeys':False})
assert len(objects)==2
nodes=[]
for node in group.nodes:
 props={key:getattr(node,key)for key in ['operation','data_type','factor_mode','interpolation_type','clamp','clamp_factor','clamp_result','normalize','from_instancer']if hasattr(node,key)}
 nodes.append({'name':node.name,'type':node.bl_idname,'properties':props,'inputs':[{'id':s.identifier,'type':s.type,'value':value(s.default_value)if hasattr(s,'default_value')else None}for s in node.inputs]})
links=sorted([l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier]for l in group.links)
controls={'instances':instances,'nodes':nodes,'links':links,'objects':objects};control_bytes=json.dumps(controls,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
packet={'schemaVersion':1,'role':'Read-only native RNA and geometry control extraction plus pinned-source algebraic derivation; zero render/numerical/Final/scene acceptance credit.','native':{'version':list(bpy.app.version),'build':bpy.app.build_hash.decode(),'autoexecEnabled':bpy.context.preferences.filepaths.use_scripts_auto_execute},'source':{'path':str(source),'sha256Before':before,'sha256After':hashlib.sha256(source.read_bytes()).hexdigest()},'controlsSha256':hashlib.sha256(control_bytes).hexdigest(),'controls':controls,'derived':{'radiusDomain':[0,max(row['maximumRadius']for row in objects)],'steppedMap':'4 + 4 * floor(2 * radius)','sidesExpression':'steppedMap > 4 ? steppedMap : 3','reachableSides':[3,8,12],'radialSettings':{'Roundness':1,'Normalize':True,'output':'Segment Coordinates'},'kernelBranch':'regular full-roundness (integer Sides), not fractional circular','transitions':[.5,1],'limits':'Radius-to-bin classification still needs native/browser precision tests near the transition circles. Source analysis does not establish branch or image parity.'},'fixtureSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'numericalCases':0,'nativeRenders':0,'finalExports':0,'browserRuns':0,'originalPreserved':True}
assert packet['source']['sha256Before']==packet['source']['sha256After'];(out/'demo-derivation.json').write_text(json.dumps(packet,indent=2)+'\n');print('RADIAL_DEMO_DERIVED',packet['controlsSha256'],packet['derived'])
