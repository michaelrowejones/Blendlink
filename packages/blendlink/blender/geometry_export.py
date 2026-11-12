# SPDX-License-Identifier: GPL-3.0-or-later
"""Preserve native split-normal precision for proven geometry programs.

The stock exporter rounds normals before vertex splitting. Restoring bytes
afterward cannot recover corners already welded together. This private,
version-scoped adapter runs only during one export and restores the exporter
method even when that export fails. No source data or preferences are changed.
"""
import contextlib
import importlib
import bpy
import numpy as np
import geometry_ir


@contextlib.contextmanager
def exact_normals(plan):
    objects=set()
    for decision in plan.decisions:
        outputs=set();geometry_ir.collect_outputs(decision.channel_plan,outputs)
        if outputs & geometry_ir.NORMAL_OUTPUTS:
            objects.update(binding.object_name for binding in decision.bindings)
    targets={bpy.data.objects[name].data.name for name in objects}
    if not targets:
        yield
        return
    version=bpy.app.version[:2]
    if version not in {(4,2),(5,2),(5,3)}:
        raise ValueError('Exact authored normal export is not verified for Blender '+bpy.app.version_string)
    name='gltf2_blender_gather_primitives_extract' if version==(4,2) else 'primitive_extract'
    module=importlib.import_module('io_scene_gltf2.blender.exp.'+name)
    creator=module.PrimitiveCreator
    method='_PrimitiveCreator__get_normals'
    original=getattr(creator,method,None)
    if not callable(original) or not callable(getattr(creator,'zup2yup',None)):
        raise ValueError('The native exporter has no verified exact-normal interface')
    seen=set()
    def read_native(instance):
        mesh=instance.blender_mesh
        if mesh.name not in targets:
            return original(instance)
        if instance.key_blocks or instance.armature:
            raise ValueError('Exact geometry normals have no verified skin/morph export binding')
        values=np.empty(len(mesh.loops)*3,dtype=np.float32)
        mesh.corner_normals.foreach_get('vector',values)
        instance.normals=values.reshape(-1,3)
        instance.morph_normals=[]
        if instance.export_settings['gltf_yup']:
            creator.zup2yup(instance.normals)
        seen.add(mesh.name)
    setattr(creator,method,read_native)
    try:
        yield
        if targets-seen:
            raise ValueError('The native exporter did not bind exact normals for mesh '+', '.join(sorted(targets-seen)))
    finally:setattr(creator,method,original)
