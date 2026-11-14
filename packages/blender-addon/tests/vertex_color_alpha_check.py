# SPDX-License-Identifier: GPL-3.0-or-later
"""No-render source/primitive/carrier policy and transaction regressions."""
from array import array
from pathlib import Path
import json
import os
import struct
import sys
import tempfile
import bpy

sys.path.insert(0, str(Path(__file__).parent))
from material_tsl_ir_check import compiler, base_material, read_glb_json
import vertex_color_alpha as alpha

assert tuple(bpy.app.version[:2]) == (5, 3)
for op in ('curve_native','noise_field_nearest','tex_image'):
    assert alpha.layers({'op':op,'pixels':[0.]*100000,'samples':[[0.,.5,1.]for _ in range(32768)]}) == set()
shared_alpha={'op':'vertex_color_alpha','model':alpha.MODEL,'sourceProfile':alpha.PROFILE,'layer':'Paint'}
assert alpha.layers({'body':shared_alpha,'annotations':[shared_alpha]*10000}) == {'Paint'}
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
mesh = bpy.data.meshes.new('Artist corner seam')
mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)], [], [(0,1,2),(0,2,3)])
paint = mesh.color_attributes.new(name='Render Paint', type='FLOAT_COLOR', domain='CORNER')
values = [0,.1,1/3, .25,.8,1]
paint.data.foreach_set('color', array('f', [v for a in values for v in (.125,.25,.5,a)]))
editor = mesh.color_attributes.new(name='Editor Paint', type='FLOAT_COLOR', domain='POINT')
editor.data.foreach_set('color', array('f', [.4,.3,.2,1]*4))
mesh.color_attributes.render_color_index = 0
mesh.color_attributes.active_color_index = 1
objects = []
for name in ('Owner A', 'Owner B'):
    obj = bpy.data.objects.new(name, mesh);scene.collection.objects.link(obj);objects.append(obj)
for index, layer in enumerate(('', 'Render Paint')):
    material, tree, bsdf = base_material('Artist alpha ' + str(index))
    color = tree.nodes.new('ShaderNodeVertexColor');color.layer_name = layer
    if index:
        group=bpy.data.node_groups.new('Artist alpha field group','ShaderNodeTree')
        group.interface.new_socket(name='Artist Alpha',in_out='OUTPUT',socket_type='NodeSocketFloat')
        field=group.nodes.new('ShaderNodeVertexColor');field.layer_name=layer
        output=group.nodes.new('NodeGroupOutput');reroute=group.nodes.new('NodeReroute')
        group.links.new(field.outputs['Alpha'],reroute.inputs[0]);group.links.new(reroute.outputs[0],output.inputs['Artist Alpha'])
        instance=tree.nodes.new('ShaderNodeGroup');instance.node_tree=group
        tree.links.new(instance.outputs['Artist Alpha'],bsdf.inputs['Roughness'])
    else:tree.links.new(color.outputs['Alpha'], bsdf.inputs['Roughness'])
    rgb = tree.nodes.new('ShaderNodeVertexColor');rgb.layer_name = 'Editor Paint'
    tree.links.new(rgb.outputs['Color'], bsdf.inputs['Base Color'])
    mesh.materials.append(material)
try:compiler.tsl_ir.emit_channel(bsdf.inputs['Roughness'],evaluation_engine='CYCLES')
except compiler.tsl_ir.TslIrRefusal as error:assert 'EEVEE Metal source profile' in str(error)
else:raise AssertionError('unqualified Cycles alpha source admitted')
mesh.polygons[0].material_index = 1
mesh.polygons[1].material_index = 0
objects[0].select_set(True);bpy.context.view_layer.objects.active = objects[0]

def snapshot():
    rgba = array('f', [0]) * (len(paint.data)*4);paint.data.foreach_get('color',rgba)
    return (rgba.tobytes(),mesh.users,tuple(m.users for m in mesh.materials),
        tuple((a.name,a.domain,a.data_type) for a in mesh.attributes),
        tuple(o.data.as_pointer() for o in objects),tuple(o.select_get() for o in objects),
        bpy.context.view_layer.objects.active.as_pointer(),scene.frame_current,
        mesh.color_attributes.active_color_index,mesh.color_attributes.render_color_index)

before = snapshot()
out = Path(os.environ.get('SCENETOWEB_VERTEX_ALPHA_POLICY', tempfile.mkdtemp(prefix='vertex-alpha-policy-')))
out.mkdir(parents=True, exist_ok=True)
rows=[]
for repeat in range(2):
    plan=compiler.plan_materials(objects,purpose='final',automatic_programs=True)
    assert not plan.errors, compiler.format_plan_errors(plan)
    assert len(plan.lowerings)==2, [d.as_dict() for d in plan.decisions]
    overrides=compiler.exporter_overrides(plan)
    assert overrides.get('export_attributes') is True and 'export_vertex_color' not in overrides
    path=out/('source-'+str(repeat)+'.glb')
    def emit(destination):
        selected=list(bpy.context.selected_objects);active=bpy.context.view_layer.objects.active
        try:
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects: obj.select_set(True)
            bpy.context.view_layer.objects.active=objects[0]
            return bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,
                export_extras=True,export_animations=False,**overrides)
        finally:
            bpy.ops.object.select_all(action='DESELECT')
            for obj in selected:obj.select_set(True)
            bpy.context.view_layer.objects.active=active
    _, compilation = compiler.with_compiled_materials(plan,str(path),emit)
    assert 'vertexColorAlphaProof' not in json.dumps(compilation.as_dict())
    assert snapshot()==before, 'source/resource/selection ownership changed'
    doc=read_glb_json(path)
    assert 'vertexColorAlphaProof' not in json.dumps(doc)
    assert len(doc['meshes'])>=1
    count=0
    for exported in doc['meshes']:
        markers=exported['extras']['blendlink_tsl_runtime']['vertexColorAlpha']
        assert set(markers)=={'','Render Paint'}
        assert all(row['sourceLayer']=='Render Paint' and row['domain']=='CORNER' for row in markers.values())
        for primitive in exported['primitives']:
            assert 'COLOR_0' in primitive['attributes'], 'existing RGB transport was disabled'
            assert any(name.startswith(alpha.PREFIX) for name in primitive['attributes'])
            count+=1
    rows.append({'case':'shared-corner-two-material-repeat-'+str(repeat),'primitives':count})

# Raw source profile, missing layer, reserved-name and copy ownership controls.
private=mesh.copy();owned=bpy.data.objects.new('Owned policy copy',private);scene.collection.objects.link(owned)
try:
    installs={}
    bindings,proof=alpha.install(owned,{''},installs,material='Artist',slot=0,basis='gltf-y-up')
    assert bindings['']['sourceLayer']=='Render Paint' and proof['']['triangles']
    def refuse(requested, expected):
        try:alpha.install(owned,requested,{},material='Artist',slot=0,basis='gltf-y-up')
        except ValueError as error:assert expected in str(error),str(error)
        else:raise AssertionError('expected '+expected)
    refuse({'Absent'},'present FLOAT_COLOR')
    refuse({''},'collision')
    layer=private.color_attributes['Render Paint']
    rgba = array('f', [0]) * (len(layer.data)*4)
    layer.data.foreach_get('color',rgba)
    for word in (0x80000000,1,0xBF800000,0x40000000):
        raw=bytearray(rgba.tobytes());struct.pack_into('=I',raw,12,word)
        hostile=array('f');hostile.frombytes(raw);layer.data.foreach_set('color',hostile)
        back=array('f',[0])*len(rgba);layer.data.foreach_get('color',back)
        assert struct.unpack_from('=I',back.tobytes(),12)[0] == word
        refuse({''},'+0 or normal')
    layer.data.foreach_set('color',rgba)
    byte=private.color_attributes.new(name='Byte',type='BYTE_COLOR',domain='CORNER')
    refuse({'Byte'},'present FLOAT_COLOR')
finally:
    bpy.data.objects.remove(owned,do_unlink=True);bpy.data.meshes.remove(private)
assert snapshot()==before
# A duplicate oriented triangle cannot independently attest alpha versus UV/RGB.
ambiguous=bpy.data.meshes.new('Coincident source policy');ambiguous.from_pydata([(0,0,0),(1,0,0),(0,1,0)],[],[(0,1,2),(0,1,2)])
ambiguous.materials.append(mesh.materials[0]);ambiguous.color_attributes.new(name='Paint',type='FLOAT_COLOR',domain='CORNER')
owned=bpy.data.objects.new('Coincident source policy',ambiguous);scene.collection.objects.link(owned)
try:
    try:alpha.install(owned,{'Paint'},{},material=mesh.materials[0].name,slot=0,basis='gltf-y-up')
    except ValueError as error:assert 'coincident oriented triangles' in str(error)
    else:raise AssertionError('ambiguous alpha/other-field correlation passed')
finally:
    bpy.data.objects.remove(owned,do_unlink=True);bpy.data.meshes.remove(ambiguous)
# Actual POINT source takes the separate vertex-domain raw scalar route.
private=mesh.copy();owned=bpy.data.objects.new('Owned POINT policy',private);scene.collection.objects.link(owned)
try:
    bindings,proof=alpha.install(owned,{'Editor Paint'},{},material='Artist',slot=0,basis='blender-z-up')
    assert bindings['Editor Paint']['domain']=='POINT' and proof['Editor Paint']['triangles']
finally:
    bpy.data.objects.remove(owned,do_unlink=True);bpy.data.meshes.remove(private)
assert snapshot()==before
# Alpha-only opacity has no COLOR_0 and must retain the new scalar route;
# Color+Alpha opacity produces stock VEC4 and must fail before publication.
opacity_mesh=mesh.copy();opacity_material=mesh.materials[0].copy()
opacity_material.name='Owned opacity guard material'
opacity_mesh.materials.clear();opacity_mesh.materials.append(opacity_material)
for polygon in opacity_mesh.polygons:polygon.material_index=0
opacity_mesh.color_attributes.active_color_index=opacity_mesh.color_attributes.render_color_index
opacity_owner=bpy.data.objects.new('Owned opacity source',opacity_mesh);scene.collection.objects.link(opacity_owner)
try:
    tree=opacity_material.node_tree
    bsdf=next(node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled')
    for link in list(bsdf.inputs['Base Color'].links):tree.links.remove(link)
    bsdf.inputs['Base Color'].default_value=(.2,.3,.4,1)
    field=tree.nodes.new('ShaderNodeVertexColor');field.layer_name='Render Paint'
    tree.links.new(field.outputs['Alpha'],bsdf.inputs['Alpha'])
    opacity_material.surface_render_method='DITHERED'
    def emit_opacity(destination):
        selected=list(bpy.context.selected_objects);active=bpy.context.view_layer.objects.active
        try:
            bpy.ops.object.select_all(action='DESELECT');opacity_owner.select_set(True);bpy.context.view_layer.objects.active=opacity_owner
            value=bpy.ops.export_scene.gltf(filepath=destination,export_format='GLB',use_selection=True,
                export_extras=True,export_animations=False,**compiler.exporter_overrides(opacity_plan))
            document,chunks,_=compiler.glblib.read_document(destination,'inspect actual opacity COLOR_0')
            binary=compiler.glblib.binary_chunk(chunks,'inspect actual opacity COLOR_0')
            observed=[]
            for item in document['meshes']:
                for primitive in item['primitives']:
                    index=primitive['attributes'].get('COLOR_0')
                    if index is not None:
                        accessor,colors=compiler._accessor_values(document,binary,index)
                        observed.append({'type':accessor['type'],'componentType':accessor['componentType'],
                            'normalized':accessor.get('normalized',False),'alpha':[row[3]for row in colors]})
            (out/'actual-opacity-color-observation.json').write_text(json.dumps(observed,indent=2)+'\n')
            return value
        finally:
            bpy.ops.object.select_all(action='DESELECT')
            for obj in selected:obj.select_set(True)
            bpy.context.view_layer.objects.active=active
    opacity_plan=compiler.plan_materials([opacity_owner],purpose='final',automatic_programs=True)
    assert not opacity_plan.errors,compiler.format_plan_errors(opacity_plan)
    compiler.with_compiled_materials(opacity_plan,str(out/'alpha-only-safe.glb'),emit_opacity)
    safe=read_glb_json(out/'alpha-only-safe.glb')
    assert all(any(name.startswith(alpha.PREFIX) for name in primitive['attributes']) for m in safe['meshes'] for primitive in m['primitives'])
    assert opacity_owner.data==opacity_mesh and opacity_owner.data.materials[0]==opacity_material
    tree.links.new(field.outputs['Color'],bsdf.inputs['Base Color'])
    opacity_plan=compiler.plan_materials([opacity_owner],purpose='final',automatic_programs=True)
    assert not opacity_plan.errors,compiler.format_plan_errors(opacity_plan)
    rejected=out/'color-alpha-opacity-must-refuse.glb'
    try:compiler.with_compiled_materials(opacity_plan,str(rejected),emit_opacity)
    except compiler.MaterialCompileError as error:assert 'implicit vertex alpha would multiply opacity twice' in str(error),str(error)
    else:raise AssertionError('stock VEC4 plus scalar opacity published double-alpha material')
    assert not rejected.exists()
    assert opacity_owner.data==opacity_mesh and opacity_owner.data.materials[0]==opacity_material
finally:
    bpy.data.objects.remove(opacity_owner,do_unlink=True);bpy.data.meshes.remove(opacity_mesh);bpy.data.materials.remove(opacity_material)
assert snapshot()==before
(out/'policy.json').write_text(json.dumps({'status':'VERTEX_ALPHA_NO_RENDER_POLICY_PASSED','rows':rows,
    'renders':0,'nativeShaderCredit':0,'portCredit':0},indent=2)+'\n')
print('VERTEX_ALPHA_NO_RENDER_POLICY_PASSED')
