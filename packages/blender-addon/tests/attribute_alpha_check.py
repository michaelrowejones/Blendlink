# SPDX-License-Identifier: GPL-3.0-or-later
# blendlink-headless-suite: manual Named Attribute Alpha profile and carrier controls.
import bpy,sys,json,os,tempfile
from pathlib import Path
from array import array
sys.path.insert(0,str(Path(__file__).parent))
from material_tsl_ir_check import compiler,base_material
import vertex_color_alpha as transport
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE'
material,tree,bsdf=base_material('Owned named Attribute Alpha policy')
attribute=tree.nodes.new('ShaderNodeAttribute');attribute.attribute_type='GEOMETRY';attribute.attribute_name='Paint'
vertex=tree.nodes.new('ShaderNodeVertexColor');vertex.layer_name='Paint'
def emit(node,engine='EEVEE'):
 for link in list(bsdf.inputs['Roughness'].links):tree.links.remove(link)
 tree.links.new(node.outputs['Alpha'],bsdf.inputs['Roughness'])
 return compiler.tsl_ir.emit_channel(bsdf.inputs['Roughness'],evaluation_engine=engine)
def refuse(fn,part):
 try:fn()
 except(compiler.tsl_ir.TslIrRefusal,ValueError)as error:assert part in str(error),(part,str(error))
 else:raise AssertionError('Expected named refusal '+part)
named=emit(attribute);assert named==emit(vertex), 'new source must use the identical qualified IR/model/layer'
for name in ['Paint','color','Color','Named Artist Alpha']:
 attribute.attribute_name=name;vertex.layer_name=name;assert emit(attribute)==emit(vertex)
attribute.attribute_name='';refuse(lambda:emit(attribute),'explicit nonempty')
attribute.attribute_name='temperature';refuse(lambda:emit(attribute),'native alpha one')
attribute.attribute_name='Paint'
for kind in ['OBJECT','INSTANCER','VIEW_LAYER']:
 attribute.attribute_type=kind;refuse(lambda:emit(attribute),'has no cell yet')
attribute.attribute_type='GEOMETRY';refuse(lambda:emit(attribute,'CYCLES'),'EEVEE Metal source profile')
# Existing GEOMETRY Color and Fac paths remain unchanged.
for output in ['Color','Fac']:
 for link in list(bsdf.inputs['Base Color'].links):tree.links.remove(link)
 tree.links.new(attribute.outputs[output],bsdf.inputs['Base Color']);assert compiler.tsl_ir.emit_channel(bsdf.inputs['Base Color'],evaluation_engine='EEVEE')
# Actual opaque group/reroute source still resolves the same named field.
group=bpy.data.node_groups.new('Owned named Alpha group','ShaderNodeTree');group.interface.new_socket(name='Alpha',in_out='OUTPUT',socket_type='NodeSocketFloat');gfield=group.nodes.new('ShaderNodeAttribute');gfield.attribute_type='GEOMETRY';gfield.attribute_name='Paint';reroute=group.nodes.new('NodeReroute');sink=group.nodes.new('NodeGroupOutput');group.links.new(gfield.outputs['Alpha'],reroute.inputs[0]);group.links.new(reroute.outputs[0],sink.inputs[0]);instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group;assert emit(instance)==named
mesh=bpy.data.meshes.new('Owned named Alpha policy mesh');mesh.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)]);mesh.materials.append(material);owner=bpy.data.objects.new('Owned named Alpha policy',mesh);scene.collection.objects.link(owner)
for domain in ['POINT','CORNER']:
 layer=mesh.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain=domain);layer.data.foreach_set('color',array('f',[.125,.25,.5,.1]*len(layer.data)))
 before=array('f',[0])*(4*len(layer.data));layer.data.foreach_get('color',before);copy=mesh.copy();private=bpy.data.objects.new('Owned private named Alpha policy',copy);scene.collection.objects.link(private)
 try:
  bindings,proof=transport.install(private,{'Paint'},{},material=material.name,slot=0,basis='gltf-y-up');assert bindings['Paint']['domain']==domain and proof['Paint']['triangles'];refuse(lambda:transport.install(private,{'Missing'},{},material=material.name,slot=0,basis='gltf-y-up'),'present FLOAT_COLOR')
 finally:bpy.data.objects.remove(private,do_unlink=True);bpy.data.meshes.remove(copy)
 after=array('f',[0])*len(before);layer.data.foreach_get('color',after);assert after.tobytes()==before.tobytes();mesh.color_attributes.remove(layer)
byte=mesh.color_attributes.new(name='Byte',type='BYTE_COLOR',domain='POINT');refuse(lambda:transport.install(owner,{'Byte'},{},material=material.name,slot=0,basis='gltf-y-up'),'present FLOAT_COLOR')
owner.modifiers.new('Unqualified source topology','SUBSURF');refuse(lambda:transport.install(owner,{'Byte'},{},material=material.name,slot=0,basis='gltf-y-up'),'bounded static primary Mesh')
report={'status':'PASSED_ATTRIBUTE_ALPHA_POLICY','sourceIRIdentical':True,'nativeRenders':0,'supportCredit':0}
path=Path(os.environ.get('SCENETOWEB_ATTRIBUTE_ALPHA_POLICY',tempfile.mkdtemp(prefix='attribute-alpha-policy-')));path.mkdir(parents=True,exist_ok=True);(path/'policy.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])
