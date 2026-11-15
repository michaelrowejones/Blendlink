# SPDX-License-Identifier: GPL-3.0-or-later
"""Native GN/export ownership and saved Edit Mode regression; no renders."""
import importlib.util
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import bpy

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scenetoweb_export_mesh_ownership_check', root.parent / 'blendlink/blender/export_scene.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
compiler = exporter.material_compiler
ownership = compiler.mesh_export_ownership
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new('Source Mesh')
mesh.from_pydata([(-1,0,0),(1,0,0),(0,1,0)], [], [(0,1,2)])
mesh['artist_intent'] = 'preserve'
obj = bpy.data.objects.new('GN Receiver',mesh)
bpy.context.scene.collection.objects.link(obj)
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
material = bpy.data.materials.new('Selected Color')
material.use_nodes = True
rgb = material.node_tree.nodes.new('ShaderNodeRGB')
material.node_tree.links.new(rgb.outputs[0],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
compiler.set_web_source(material,rgb,rgb.outputs[0].identifier,'COLOR')
mesh.materials.append(material)
tree = bpy.data.node_groups.new('Geometry And Instance','GeometryNodeTree')
for direction in ['INPUT','OUTPUT']:
    tree.interface.new_socket(name='Geometry',in_out=direction,socket_type='NodeSocketGeometry')
source = tree.nodes.new('NodeGroupInput')
output = tree.nodes.new('NodeGroupOutput')
instance = tree.nodes.new('GeometryNodeGeometryToInstance')
join = tree.nodes.new('GeometryNodeJoinGeometry')
tree.links.new(source.outputs['Geometry'],instance.inputs[0])
tree.links.new(source.outputs['Geometry'],join.inputs[0])
tree.links.new(instance.outputs[0],join.inputs[0])
tree.links.new(join.outputs[0],output.inputs[0])
obj.modifiers.new('Authored Geometry Nodes','NODES').node_group=tree
bpy.context.view_layer.update()
before_meshes = set(bpy.data.meshes)
before_materials = set(bpy.data.materials)
before_properties = dict(mesh.items())
with tempfile.TemporaryDirectory(prefix='scenetoweb-export-mesh-') as directory:
    directory = Path(directory)
    settings = directory/'settings.json'
    settings.write_text('{}')
    out = directory/'scene.glb'
    result = directory/'result.json'
    exporter.parse_argv=lambda:(str(out),str(settings),str(result))
    bpy.ops.object.mode_set(mode='EDIT')
    # The low-level transaction refuses Blender's ignored Edit Mode data swap
    # rather than reaching emit or publishing a misleading artifact.
    plan = compiler.plan_materials((obj,),purpose='final')
    out.write_bytes(b'last-good')
    try:
        compiler.with_compiled_materials(plan,str(out),lambda _: (_ for _ in ()).throw(AssertionError('must not emit')))
    except compiler.MaterialCompileError as error:
        assert 'leave Edit Mode' in str(error), str(error)
    else:
        raise AssertionError('ignored private Mesh assignment was accepted')
    assert out.read_bytes()==b'last-good' and obj.mode=='EDIT' and obj.data==mesh
    assert set(bpy.data.meshes)==before_meshes
    exporter.main()
    assert out.read_bytes()[:4]==b'glTF' and json.loads(result.read_text())['ok']
    assert obj.mode=='EDIT' and bpy.context.view_layer.objects.active==obj and obj.select_get()
    assert obj.data==mesh and dict(mesh.items())==before_properties
    assert set(bpy.data.meshes)==before_meshes and set(bpy.data.materials)==before_materials
    import source_export_mode
    try:
        with source_export_mode.object_mode():
            assert obj.mode=='OBJECT'
            raise ValueError('forced worker failure')
    except ValueError as error:
        assert 'forced worker failure' in str(error)
    else:
        raise AssertionError('worker failure was swallowed')
    assert obj.mode=='EDIT' and obj.data==mesh
    bpy.ops.object.mode_set(mode='OBJECT')
    # A late foreign owner must keep the strict cleanup refusal and prior GLB.
    late = []
    late_output = directory/'late-user.glb'
    late_output.write_bytes(b'last-good-late-user')
    def foreign_emit(path):
        foreign = bpy.data.objects.new('Late Foreign Owner',obj.data)
        bpy.context.scene.collection.objects.link(foreign)
        foreign.hide_render=True
        late.append(foreign)
        return bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',export_apply=True,
            export_extras=True,use_selection=True,use_active_scene=True)
    try:
        compiler.with_compiled_materials(compiler.plan_materials((obj,),purpose='final'),str(late_output),foreign_emit)
    except compiler.MaterialCompileError as error:
        assert 'private Mesh still has 1 users' in str(error),str(error)
    else:
        raise AssertionError('late foreign Mesh user was silently discarded')
    assert late_output.read_bytes()==b'last-good-late-user' and obj.data==mesh
    foreign = late[0]
    held_mesh = foreign.data
    assert held_mesh!=mesh and held_mesh.users==1
    bpy.data.objects.remove(foreign,do_unlink=True)
    assert held_mesh.users==0
    bpy.data.meshes.remove(held_mesh)
    assert set(bpy.data.meshes)==before_meshes
    # Unknown users and changed temporary ownership are never force-cleared.
    if tuple(bpy.app.version[:3])==(5,3,0):
        import io_scene_gltf2.blender.exp.obj_data as native
        original = native.gather_mesh
        private = mesh.copy()
        foreign = bpy.data.objects.new('Foreign User',private)
        bpy.context.scene.collection.objects.link(foreign)
        with ownership.temporary_mesh_backlinks((private,)):
            pass
        assert private.users==1 and foreign.data==private
        # A fake non-Main temporary is sufficient to test the refusal boundary;
        # the positive real GN export above exercises the actual native object.
        class Temporary:
            name='Not A Main Mesh'
            def __init__(self):self.props={'gltf2_original_mesh':private,'gltf2_mesh_applied':True}
            def get(self,key):return self.props.get(key)
            def __delitem__(self,key):del self.props[key]
        temp = Temporary()
        with patch.object(native,'gather_mesh',side_effect=lambda *_args,**_kwargs:temp.props.update(gltf2_original_mesh=mesh)):
            try:
                with ownership.temporary_mesh_backlinks((private,)):
                    native.gather_mesh(temp)
            except RuntimeError as error:
                assert 'ownership changed' in str(error),str(error)
            else:
                raise AssertionError('changed temporary ownership was accepted')
        assert native.gather_mesh is original and temp.props['gltf2_original_mesh']==mesh
        assert foreign.data==private and private.users==1
        bpy.data.objects.remove(foreign,do_unlink=True)
        assert private.users==0
        bpy.data.meshes.remove(private)
print('BLENDLINK_EXPORT_MESH_OWNERSHIP_PASSED')
