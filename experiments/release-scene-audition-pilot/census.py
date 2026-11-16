# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only authored scene/camera/animation/visibility census. No evaluated mesh, GPU, render or save."""
import bpy,json,hashlib,sys,collections
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'packages/blender-addon'))
import weblights
source=Path(bpy.data.filepath);sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();before=sha(source)
out=Path(sys.argv[sys.argv.index('--')+1]);assert not out.exists()
with out.with_suffix('.producer.py').open('xb')as f:f.write(Path(__file__).read_bytes())
def anim(id):
 a=getattr(id,'animation_data',None)
 return bool(a and(a.action or a.drivers or any(t.strips for t in a.nla_tracks)))
def value(v):
 if isinstance(v,(str,bool,int,float))or v is None:return v
 try:return list(v)
 except:return str(v)
scene=bpy.context.scene;camera=scene.camera;objects=[]
for obj in scene.objects:
 visibility=[]
 for layer in scene.view_layers:
  v=weblights.render_visibility(obj,scene,view_layer=layer)
  visibility.append({'layer':layer.name,'enabled':layer.use,'exported':v.exported,'reason':str(v)})
 objects.append({'name':obj.name,'type':obj.type,'hideRender':obj.hide_render,'animation':anim(obj),'dataAnimation':anim(obj.data),'matrixWorld':[list(row)for row in obj.matrix_world],'materials':[s.material.name if s.material else None for s in obj.material_slots],'authoredPolygons':len(obj.data.polygons)if obj.type=='MESH'else None,'authoredMaterialPolygonCounts':dict(collections.Counter(p.material_index for p in obj.data.polygons))if obj.type=='MESH'else None,'modifiers':[{'type':m.type,'name':m.name,'showRender':m.show_render,'levels':getattr(m,'levels',None),'renderLevels':getattr(m,'render_levels',None)}for m in obj.modifiers],'visibility':visibility})
r={'schemaVersion':1,'producerSha256':sha(__file__),'sourceSha256':before,'nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'scene':scene.name,'frame':scene.frame_current,'frameRange':[scene.frame_start,scene.frame_end],'activeViewLayer':bpy.context.view_layer.name,'viewLayers':[{'name':l.name,'use':l.use}for l in scene.view_layers],'objectTypes':dict(collections.Counter(o['type']for o in objects)),'camera':None if camera is None else {'name':camera.name,'type':camera.data.type,'lens':camera.data.lens,'shift':[camera.data.shift_x,camera.data.shift_y],'dof':camera.data.dof.use_dof,'animation':anim(camera),'opticsAnimation':anim(camera.data)},'sourcePresentation':{'viewTransform':scene.view_settings.view_transform,'look':scene.view_settings.look,'exposure':scene.view_settings.exposure,'gamma':scene.view_settings.gamma,'dimensions':[scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage],'worldVolumeLinked':bool(scene.world and scene.world.use_nodes and any(n.type=='OUTPUT_WORLD'and n.inputs['Volume'].is_linked for n in scene.world.node_tree.nodes))},'objects':objects,'imageClosure':[{'name':i.name,'filepath':i.filepath,'packed':bool(i.packed_file),'users':i.users,'size':list(i.size)}for i in bpy.data.images if i.source=='FILE'],'libraryPaths':[l.filepath for l in bpy.data.libraries],'renderCalls':0,'saveCalls':0,'gpuCalls':0,'sourceUnchanged':sha(source)==before}
assert r['sourceUnchanged'];out.write_text(json.dumps(r,indent=2)+'\n');print('SCENETOWEB_AUDITION_CPU_CENSUS '+json.dumps({'scene':r['scene'],'objects':len(objects),'animatedObjects':[o['name']for o in objects if o['animation']or o['dataAnimation']],'sourceUnchanged':True}))
