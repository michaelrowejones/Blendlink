# SPDX-License-Identifier: GPL-3.0-or-later
"""Export-scoped geometry/basis identity across owned private mesh copies."""
import hashlib
import bpy
import numpy as np


def mesh_signature(mesh, uv_name=None):
    """Materials and unrelated atlas UVs may change; required geometry may not."""
    digest=hashlib.sha256()
    for collection,attribute,width,dtype in [
        (mesh.vertices,'co',3,np.float32),
        (mesh.loops,'vertex_index',1,np.int32),
        (mesh.polygons,'loop_start',1,np.int32),
        (mesh.polygons,'loop_total',1,np.int32),
        (mesh.corner_normals,'vector',3,np.float32),
    ]:
        values=np.empty(len(collection)*width,dtype=dtype)
        collection.foreach_get(attribute,values)
        digest.update(str((attribute,len(collection),width)).encode())
        digest.update(values.tobytes())
    if uv_name is not None:
        layer=mesh.uv_layers.get(uv_name)
        if not isinstance(uv_name,str) or not uv_name or layer is None:
            raise ValueError('Exact tangent export needs its actual named UV basis on mesh '+mesh.name)
        values=np.empty(len(mesh.loops)*2,np.float32)
        layer.data.foreach_get('uv',values)
        digest.update(uv_name.encode());digest.update(values.tobytes())
    return digest.digest()


class ExportTargets:
    """A request belongs to an object or fixed mesh, never a guessed alias."""
    def __init__(self,mesh_targets,object_targets=None):
        self.entries=[];self.seen=set()
        remaining=dict(mesh_targets)
        for name,uv_name in (object_targets or {}).items():
            obj=bpy.data.objects.get(name)
            if obj is None or obj.type!='MESH':
                raise ValueError('Exact geometry export needs its actual owner '+name)
            self.entries.append((('object',name),obj,obj.data,uv_name,mesh_signature(obj.data,uv_name)))
            remaining.pop(obj.data.name,None)
        for name,uv_name in remaining.items():
            mesh=bpy.data.meshes.get(name)
            if mesh is None:raise ValueError('Exact geometry export needs its actual mesh '+name)
            self.entries.append((('mesh',name),None,mesh,uv_name,mesh_signature(mesh,uv_name)))

    def _current(self,entry):
        key,obj,mesh,_uv,_signature=entry
        if obj is not None:
            current=bpy.data.objects.get(key[1])
            if current is None or current.as_pointer()!=obj.as_pointer() or current.type!='MESH':
                raise ValueError('Exact geometry export owner changed: '+key[1])
            return current.data
        current=bpy.data.meshes.get(key[1])
        if current is None or current.as_pointer()!=mesh.as_pointer():
            raise ValueError('Exact geometry export mesh changed: '+key[1])
        return current

    def _verify(self,entry,mesh):
        if mesh_signature(mesh,entry[3])!=entry[4]:
            raise ValueError('Exact geometry export geometry, normals or named UV basis changed for '+entry[0][1])

    def matching(self,mesh):
        result=[]
        for entry in self.entries:
            current=self._current(entry)
            if current.as_pointer()!=mesh.as_pointer():continue
            self._verify(entry,current);result.append(entry)
        return result

    def uv_bindings(self):
        result={}
        for entry in self.entries:
            mesh=self._current(entry);self._verify(entry,mesh)
            uv=entry[3]
            if mesh.name in result and result[mesh.name]!=uv:
                raise ValueError('One private mesh has conflicting Mikk tangent basis ownership')
            result[mesh.name]=uv
        return result

    def mark(self,entries):self.seen.update(entry[0] for entry in entries)

    def require_seen(self,kind):
        missing=[]
        for entry in self.entries:
            mesh=self._current(entry);self._verify(entry,mesh)
            if entry[0] not in self.seen:missing.append(mesh.name)
        if missing:raise ValueError('The native exporter did not bind exact '+kind+' for mesh '+', '.join(sorted(set(missing))))
