# SPDX-License-Identifier: GPL-3.0-or-later
"""Exact static normal-bake UV and native Mikk basis association.

This is carrier/bake evidence, never live node numerical qualification.
"""
import hashlib
import struct
import numpy as np

_HEADER = b'scenetoweb-normal-bake-basis-v1\0'
_PACK = struct.Struct('<12f')

def _corner(position, normal, tangent, sign, uv, *, blender):
    if blender:
        position=(position[0],position[2],-position[1])
        normal=(normal[0],normal[2],-normal[1])
        tangent=(tangent[0],tangent[2],-tangent[1])
        uv=(uv[0],float(np.float32(1.0-uv[1])))
    values=(*position,*normal,*tangent,float(sign),*uv)
    if not np.isfinite(values).all() or sign not in (-1,1):
        raise ValueError('Normal bake basis needs finite vectors and native handedness')
    # Vertex welding may canonicalize signed zeros; geometric zero has one
    # physical direction/coordinate. Every nonzero Float32 component stays exact.
    return _PACK.pack(*(0.0 if value == 0.0 else value for value in values))

def _triangle(corners):
    return hashlib.sha256(min(b''.join(corners[i:]+corners[:i])for i in range(3))).digest()

def capture(obj,uv_name,hash_triangles):
    mesh=obj.data
    if mesh.shape_keys or obj.type!='MESH' or len(mesh.materials)!=1:
        raise ValueError('Normal bake basis only admits a static single-slot mesh')
    layer=mesh.uv_layers.get(uv_name)
    if layer is None:raise ValueError('Normal bake UV disappeared before basis capture')
    mesh.calc_loop_triangles();mesh.calc_tangents(uvmap=uv_name)
    def rows():
        for triangle in mesh.loop_triangles:
            if triangle.material_index!=0:raise ValueError('Normal bake basis slot ownership changed')
            corners=[]
            for index in triangle.loops:
                loop=mesh.loops[index]
                corners.append(_corner(mesh.vertices[loop.vertex_index].co,
                    mesh.corner_normals[index].vector,loop.tangent,loop.bitangent_sign,
                    layer.data[index].uv,blender=True))
            yield _triangle(corners)
    return {'model':'static-native-mikk-bake-basis-v1','mesh':mesh.name,'uvName':uv_name,
            'texCoord':list(mesh.uv_layers).index(layer),'association':hash_triangles(rows(),_HEADER)}

def attest(document,binary,primitives,expected,read_accessor,hash_triangles):
    tex_coord=int(expected['texCoord'])
    def rows():
        for _mesh,_primitive,primitive in primitives:
            if primitive.get('mode',4)!=4:raise ValueError('Normal bake basis requires triangle primitives')
            attributes=primitive.get('attributes')or{}
            required=['POSITION','NORMAL','TANGENT','TEXCOORD_'+str(tex_coord)]
            if any(name not in attributes for name in required):
                raise ValueError('Normal bake primitive omitted POSITION/NORMAL/TANGENT/UV basis')
            values=[read_accessor(document,binary,int(attributes[name]))[1]for name in required]
            if len({len(value)for value in values})!=1:raise ValueError('Normal bake basis accessor counts differ')
            if 'indices' in primitive:
                indices=[int(value[0])for value in read_accessor(document,binary,int(primitive['indices']))[1]]
            else:indices=list(range(len(values[0])))
            if len(indices)%3:raise ValueError('Normal bake triangle index census is incomplete')
            for start in range(0,len(indices),3):
                corners=[]
                for index in indices[start:start+3]:
                    if not 0<=index<len(values[0]):raise ValueError('Normal bake index is out of bounds')
                    position,normal,tangent,uv=(value[index]for value in values)
                    if len(position)!=3 or len(normal)!=3 or len(tangent)!=4 or len(uv)!=2:
                        raise ValueError('Normal bake basis accessor widths differ')
                    corners.append(_corner(position,normal,tangent[:3],tangent[3],uv,blender=False))
                yield _triangle(corners)
    actual=hash_triangles(rows(),_HEADER)
    if actual!=expected['association']:
        raise ValueError('Normal bake native POSITION/NORMAL/TANGENT/UV triangle association changed')
    return {'model':expected['model'],'uvName':expected['uvName'],'texCoord':tex_coord,'association':actual}


def validate_encoding(native, delivery, surface, decoded):
    native=np.asarray(native,dtype=np.float32);decoded=np.asarray(decoded,dtype=np.float32)
    delivery=np.asarray(delivery,dtype=bool);surface=np.asarray(surface,dtype=bool)
    if native.shape!=decoded.shape or native.ndim!=3 or native.shape[2]!=3 or delivery.shape!=native.shape[:2] or surface.shape!=delivery.shape:
        raise ValueError('Normal PNG native/decoded/mask shapes differ')
    if not surface.any() or not np.all(~surface|delivery) or not np.isfinite(native[delivery]).all() or not np.isfinite(decoded[delivery]).all():
        raise ValueError('Normal PNG requires finite delivery and actual surface coverage')
    error=float(np.abs(native[delivery]-decoded[delivery]).max())
    if error>1/255+1e-7:raise ValueError('Normal PNG exceeds one data quantization step')
    reference=native[surface]*2-1;actual=decoded[surface]*2-1
    length=np.linalg.norm(reference,axis=1);actual_length=np.linalg.norm(actual,axis=1)
    if float(length.min())<.5 or float(length.max())>1.01 or float(actual_length.min())<=0:
        raise ValueError('Normal PNG has a degenerate or unproved actual surface direction')
    cosine=np.sum(reference*actual,axis=1)/(length*actual_length)
    angle=float(np.degrees(np.arccos(np.clip(cosine,-1,1))).max())
    if not np.isfinite(angle) or angle>1:raise ValueError('Normal PNG exceeds one degree of surface direction error')
    return {'model':'cycles-normal-png-encoding-v2','maxEncodedError':error,'maxSurfaceAngularDegrees':angle,
            'deliveryTexels':int(delivery.sum()),'actualSurfaceTexels':int(surface.sum()),
            'minimumSurfaceNormalLength':float(length.min()),
            'scope':'Surface direction and full delivery quantization only; no margin-direction/filtering/LOD or whole-material lighting claim'}
