# SPDX-License-Identifier: GPL-3.0-or-later
"""Close the pinned exporter's temporary Mesh-to-private-Mesh ID reference."""
import contextlib
import importlib

import bpy


@contextlib.contextmanager
def temporary_mesh_backlinks(private_meshes):
    # Blender 5.3.43 adds an ID property to its non-Main to_mesh result. On
    # this profile to_mesh_clear does not release that property's ID user.
    # A Python reference to the temporary Mesh is already invalid afterward.
    exporter = importlib.import_module('io_scene_gltf2')
    if tuple(bpy.app.version[:3]) != (5, 3, 0) or tuple(exporter.bl_info['version']) != (5, 3, 43):
        yield
        return
    targets = {mesh.as_pointer(): mesh for mesh in private_meshes}
    module = importlib.import_module('io_scene_gltf2.blender.exp.obj_data')
    original = module.gather_mesh

    def gather(mesh, *args, **kwargs):
        owner = mesh.get('gltf2_original_mesh')
        owned = (isinstance(owner, bpy.types.Mesh)
                 and targets.get(owner.as_pointer()) == owner
                 and mesh.get('gltf2_mesh_applied') is True
                 and bpy.data.meshes.get(mesh.name) != mesh)
        try:
            return original(mesh, *args, **kwargs)
        finally:
            if owned:
                # Touch only the exact temporary backlink observed at entry.
                # Main/source/custom properties and foreign users stay intact.
                if (mesh.get('gltf2_original_mesh') != owner
                        or mesh.get('gltf2_mesh_applied') is not True
                        or bpy.data.meshes.get(mesh.name) == mesh):
                    raise RuntimeError('Exporter temporary Mesh ownership changed during gathering')
                del mesh['gltf2_original_mesh']
    module.gather_mesh = gather
    try:
        yield
    finally:
        if module.gather_mesh is not gather:
            raise RuntimeError('Exporter Mesh gather hook changed during export')
        module.gather_mesh = original
