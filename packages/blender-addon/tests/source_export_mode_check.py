# SPDX-License-Identifier: GPL-3.0-or-later
"""Worker-owned exclusions preserve safe saved-mode handling; no renders."""
import importlib.util
import json
import tempfile
from pathlib import Path

import bpy

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('scenetoweb_source_mode_exporter',root.parent/'blendlink/blender/export_scene.py')
exporter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
import source_export_mode


def triangle(name):
    mesh=bpy.data.meshes.new(name+' Mesh')
    mesh.from_pydata([(-1,0,0),(1,0,0),(0,1,0)],[],[(0,1,2)])
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select(owner, objects):
    if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
    for obj in bpy.context.selected_objects:obj.select_set(False)
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=owner
    bpy.ops.object.mode_set(mode='EDIT')


with tempfile.TemporaryDirectory(prefix='scenetoweb-source-mode-') as directory:
    directory=Path(directory)
    # Actual plan and Final both deliberately delete the active -noimp helper.
    for plan_only in (True,False):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        published=triangle('Published')
        helper=triangle('Editing Helper-noimp')
        select(helper,[helper])
        source=directory/('plan-source.blend' if plan_only else 'final-source.blend')
        bpy.ops.wm.save_as_mainfile(filepath=str(source))
        source_bytes=source.read_bytes()
        settings=directory/'settings.json';settings.write_text(json.dumps({'planOnly':plan_only}))
        out=directory/'out.glb';result=directory/'result.json'
        exporter.parse_argv=lambda:(str(out),str(settings),str(result))
        exporter.main()
        report=json.loads(result.read_text())
        assert report['ok'] and 'Editing Helper-noimp' in report['excluded']
        assert bpy.data.objects.get('Editing Helper-noimp') is None
        assert bpy.context.mode=='OBJECT' and published.mode=='OBJECT'
        assert source.read_bytes()==source_bytes
        if not plan_only:assert out.read_bytes()[:4]==b'glTF'
    # Multi-object Edit Mode restores only surviving editing owners and data.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    owner=triangle('Editing Owner');peer=triangle('Editing Peer');helper=triangle('Selected Helper-noimp')
    select(owner,[owner,peer,helper])
    owner_mesh,peer_mesh=owner.data,peer.data
    with source_export_mode.object_mode() as removed:
        exporter.remove_noimp_objects(removal_journal=removed)
    assert owner.mode==peer.mode=='EDIT' and owner.data==owner_mesh and peer.data==peer_mesh
    assert bpy.context.view_layer.objects.active==owner and bpy.context.selected_objects==[owner,peer]
    bpy.ops.object.mode_set(mode='OBJECT')
    # Worker-owned deletion must not suppress a real body failure.
    helper=triangle('Failed Helper-noimp');select(helper,[helper])
    try:
        with source_export_mode.object_mode() as removed:
            exporter.remove_noimp_objects(removal_journal=removed)
            raise ValueError('intentional worker failure')
    except ValueError as error:assert 'intentional worker failure' in str(error)
    else:raise AssertionError('excluded owner suppressed worker failure')
    # Unjournaled disappearance and changed active/data ownership still refuse.
    for mutation in ('delete','active','data'):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        owner=triangle('Guarded Owner');other=triangle('Other');select(owner,[owner])
        try:
            with source_export_mode.object_mode():
                if mutation=='delete':bpy.data.objects.remove(owner,do_unlink=True)
                elif mutation=='active':bpy.context.view_layer.objects.active=other
                else:owner.data=other.data
        except RuntimeError as error:assert 'ownership changed' in str(error),str(error)
        else:raise AssertionError('unexpected '+mutation+' ownership change was accepted')
        assert other.mode=='OBJECT'
print('BLENDLINK_SOURCE_EXPORT_MODE_PASSED')
