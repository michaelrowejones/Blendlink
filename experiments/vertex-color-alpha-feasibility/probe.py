# SPDX-License-Identifier: GPL-3.0-or-later
"""Actual Blender5.3 glTF accessor feasibility only; no renders or node credit."""
from array import array
import bpy,json,os,struct,sys,hashlib
from pathlib import Path
OUT=Path(os.environ['SCENETOWEB_VERTEX_ALPHA']);OUT.mkdir(parents=True,exist_ok=True)
assert tuple(bpy.app.version)==(5,3,0)and bpy.app.build_hash==b'02f0899d78e3'
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('Artist painted quad');mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)],[],[(0,1,2),(0,2,3)]);obj=bpy.data.objects.new('Artist painted quad',mesh);scene.collection.objects.link(obj)
obj.select_set(True);bpy.context.view_layer.objects.active=obj
material=bpy.data.materials.new('Artist Vertex Alpha');material.use_nodes=True;material.surface_render_method='DITHERED';mesh.materials.append(material);tree=material.node_tree;tree.nodes.clear();output=tree.nodes.new('ShaderNodeOutputMaterial');bsdf=tree.nodes.new('ShaderNodeBsdfPrincipled');color=tree.nodes.new('ShaderNodeVertexColor');tree.links.new(bsdf.outputs['BSDF'],output.inputs['Surface']);color.layer_name='Paint'
# The FLOAT_COLOR custom carrier is original data, not a shader bake.
SOURCE=[(.1,.2,.3,0),(.4,.5,.6,.1),(.7,.8,.9,1/3),(.125,.25,.5,1)]
paint=mesh.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain='POINT');paint.data.foreach_set('color',array('f',[v for rgba in SOURCE for v in rgba]));mesh.color_attributes.active_color_index=0;mesh.color_attributes.render_color_index=0
private=mesh.attributes.new(name='_SCENETOWEB_TEST_RGBA',type='FLOAT_COLOR',domain='POINT');private.data.foreach_set('color',array('f',[v for rgba in SOURCE for v in rgba]))
def inspect(path):
 b=path.read_bytes();length,typ=struct.unpack_from('<II',b,12);assert typ==0x4e4f534a;g=json.loads(b[20:20+length]);bin_at=20+length;size,tag=struct.unpack_from('<II',b,bin_at);assert tag==0x004e4942;binary=b[bin_at+8:bin_at+8+size];rows=[]
 for primitive in g['meshes'][0]['primitives']:
  attrs={}
  for semantic,index in primitive['attributes'].items():
   if semantic.startswith('COLOR_')or semantic.startswith('_SCENETOWEB'):
    a=g['accessors'][index];v=g['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0);width=int(a['type'][-1]);code={5121:'B',5123:'H',5126:'f'}[a['componentType']];data=[list(struct.unpack_from('<'+str(width)+code,binary,offset+i*v.get('byteStride',width*struct.calcsize(code))))for i in range(a['count'])];attrs[semantic]={'type':a['type'],'componentType':a['componentType'],'normalized':a.get('normalized',False),'count':a['count'],'values':data}
  rows.append(attrs)
 return rows
rows=[]
for case,mode,both,custom in [('material-alpha-only','MATERIAL',False,False),('material-color-and-alpha','MATERIAL',True,False),('forced-active-alpha','ACTIVE',False,False),('private-float-alpha','NONE',False,True)]:
 for link in list(bsdf.inputs['Base Color'].links):tree.links.remove(link)
 for link in list(bsdf.inputs['Alpha'].links):tree.links.remove(link)
 tree.links.new(color.outputs['Alpha'],bsdf.inputs['Alpha'])
 if both:tree.links.new(color.outputs['Color'],bsdf.inputs['Base Color'])
 path=OUT/(case+'.glb');bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_materials='EXPORT',export_vertex_color=mode,export_all_vertex_colors=False,export_attributes=custom,export_cameras=False,export_lights=False,export_animations=False)
 rows.append({'case':case,'attributes':inspect(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size})
raw=array('f',[0])*16;paint.data.foreach_get('color',raw)
report={'status':'VERTEX_COLOR_ALPHA_GLTF_FEASIBILITY_CAPTURED','nativeVersion':list(bpy.app.version),'nativeBuild':bpy.app.build_hash.decode(),'sourceRGBA':list(raw),'sourceWords':list(struct.unpack('=16I',raw.tobytes())),'rows':rows,'renders':0,'gpuInitializationCalls':0,'nodePortCredit':0}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])
