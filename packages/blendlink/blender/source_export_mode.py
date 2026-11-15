# SPDX-License-Identifier: GPL-3.0-or-later
"""Prepare a saved worker scene for object-data export without saving it."""
import contextlib

import bpy


@contextlib.contextmanager
def object_mode():
    removed_objects = set()
    owner = bpy.context.view_layer.objects.active
    mode = owner.mode if owner is not None else 'OBJECT'
    if mode == 'OBJECT':
        yield removed_objects
        return
    source_data = owner.data
    owner_key = (owner.name, owner.as_pointer())
    selected = tuple((obj.name, obj.as_pointer(), obj, obj.data if obj.mode != 'OBJECT' else None)
                     for obj in bpy.context.selected_objects)
    if not bpy.ops.object.mode_set.poll():
        raise RuntimeError('Cannot prepare the saved scene for export; leave its current editing mode and save again')
    bpy.ops.object.mode_set(mode='OBJECT')
    if owner.mode != 'OBJECT':
        raise RuntimeError('Blender did not leave the saved editing mode for export')
    print(f'SceneToWeb export: prepared saved {mode} mode as Object Mode in the worker', flush=True)
    try:
        yield removed_objects
    finally:
        surviving = []
        for name, pointer, obj, editing_data in selected:
            current = bpy.data.objects.get(name)
            if current is not None and current.as_pointer() == pointer:
                if editing_data is not None and (obj.data != editing_data or obj.mode != 'OBJECT'):
                    raise RuntimeError('Source editing data ownership changed during export')
                surviving.append(obj)
            elif (name, pointer) not in removed_objects:
                raise RuntimeError('Source selection ownership changed during export; cannot restore editing mode safely')
        current_owner = bpy.data.objects.get(owner_key[0])
        owner_removed = current_owner is None and owner_key in removed_objects
        if owner_removed:
            # remove_noimp_objects journals only completed worker-owned
            # deletions. The saved owner cannot be restored; never select an
            # unrelated survivor as a replacement editing owner.
            if bpy.context.mode != 'OBJECT':
                raise RuntimeError('Editing mode changed after the worker excluded its source owner')
            print('SceneToWeb export: saved editing owner intentionally excluded; worker remains in Object Mode', flush=True)
        else:
            # Never enter Edit Mode on an unrelated or replaced source datablock.
            if (current_owner != owner or owner.data != source_data
                    or bpy.context.view_layer.objects.active != owner or owner.mode != 'OBJECT'
                    ):
                raise RuntimeError('Source mode ownership changed during export; cannot restore editing mode safely')
            for obj in bpy.context.selected_objects:
                obj.select_set(False)
            for obj in surviving:
                obj.select_set(True)
            bpy.ops.object.mode_set(mode=mode)
            if owner.mode != mode:
                raise RuntimeError('The source editing mode did not restore after export')
