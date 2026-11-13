# SPDX-License-Identifier: GPL-3.0-or-later
"""Preserve one explicit Mikk tangent UV basis on private export meshes.

The stock exporter computes tangents from the active edit UV, then rounds
them before welding. Shader nodes can request the active-render UV instead.
This adapter is opt-in, accepts the actual private mesh/name bindings, and
restores both exporter methods after every exit. It does not change active UV
selection or authored data. A caller must provide private export copies.
"""
import contextlib
import importlib
import bpy
import numpy as np


@contextlib.contextmanager
def exact_tangents(mesh_uv_names):
    if not mesh_uv_names:
        yield
        return
    version=bpy.app.version[:2]
    if version not in {(4,2),(5,2),(5,3)}:
        raise ValueError('Exact Mikk tangent export is not verified for Blender '+bpy.app.version_string)
    for mesh_name,uv_name in mesh_uv_names.items():
        mesh=bpy.data.meshes.get(mesh_name)
        if mesh is None or not isinstance(uv_name,str) or not uv_name or mesh.uv_layers.get(uv_name) is None:
            raise ValueError('Exact tangent export needs its actual named UV basis on mesh '+mesh_name)
    module_name='gltf2_blender_gather_primitives_extract' if version==(4,2) else 'primitive_extract'
    module=importlib.import_module('io_scene_gltf2.blender.exp.'+module_name)
    creator=module.PrimitiveCreator
    tangent_method,sign_method='_PrimitiveCreator__get_tangents','_PrimitiveCreator__get_bitangent_signs'
    original_tangents,original_signs=getattr(creator,tangent_method,None),getattr(creator,sign_method,None)
    if not callable(original_tangents) or not callable(original_signs) or not callable(getattr(creator,'zup2yup',None)):
        raise ValueError('The native exporter has no verified exact-tangent interface')
    seen=set()

    def tangents(instance):
        mesh=instance.blender_mesh
        if mesh.name not in mesh_uv_names:return original_tangents(instance)
        if instance.key_blocks or instance.armature:
            raise ValueError('Exact tangent export has no verified skin/morph binding')
        uv_name=mesh_uv_names[mesh.name]
        try:mesh.calc_tangents(uvmap=uv_name)
        except RuntimeError as error:raise ValueError('Native Mikk tangent computation failed for '+mesh.name+': '+str(error)) from error
        values=np.empty(len(mesh.loops)*3,dtype=np.float32)
        mesh.loops.foreach_get('tangent',values)
        values=values.reshape(-1,3)
        if not np.isfinite(values).all() or np.any(np.abs(np.sum(values*values,axis=1)-1)>2e-4):
            raise ValueError('Native Mikk tangent data must contain finite unit vectors')
        instance.tangents=values
        if instance.export_settings['gltf_yup']:creator.zup2yup(instance.tangents)
        seen.add(mesh.name)

    def signs(instance):
        mesh=instance.blender_mesh
        if mesh.name not in mesh_uv_names:return original_signs(instance)
        # The tangent getter just calculated this same explicitly named basis.
        values=np.empty(len(mesh.loops),dtype=np.float32)
        mesh.loops.foreach_get('bitangent_sign',values)
        if not np.isfinite(values).all() or np.any((values!=1)&(values!=-1)):
            raise ValueError('Native Mikk tangent handedness must be exactly -1 or +1')
        instance.signs=values

    setattr(creator,tangent_method,tangents);setattr(creator,sign_method,signs)
    try:
        yield
        if set(mesh_uv_names)-seen:
            raise ValueError('The native exporter did not bind exact tangents for mesh '+', '.join(sorted(set(mesh_uv_names)-seen)))
    finally:
        setattr(creator,tangent_method,original_tangents);setattr(creator,sign_method,original_signs)
