# SPDX-License-Identifier: GPL-3.0-or-later
"""Primary-surface Mikk UV tangent context with explicit basis ownership."""
import math
import struct
import bpy
from mathutils import Vector

if __package__:
    from . import geometry_ir
else:
    import geometry_ir


def requirements(value,result):
    if isinstance(value,dict):
        if value.get('op')=='tangent_native':result.append(value)
        for child in value.values():requirements(child,result)
    elif isinstance(value,(tuple,list)):
        for child in value:requirements(child,result)


def emit_tangent(node,*,engine,refuse):
    if node.direction_type!='UV_MAP':refuse('Radial Tangent still needs a proven nonzero axis/projection domain')
    return uv_frame(str(node.uv_map),engine=engine,refuse=refuse)


def uv_frame(uv_name,*,engine,refuse):
    if engine!='EEVEE':refuse('Cycles UV Tangent needs a verified triangulated native-normal Mikk basis; authored mesh tangents are not equivalent')
    context=geometry_ir.primary_context('normal',engine)
    return {"op": "tangent_native",'model':'primary-mikk-tangent-v1','sourceEngine':engine,
            'frameSource':'blender-mikk-uv-v1','uvMap':uv_name,'tangentStorage':context['normalStorage'],
            'normal':context}


def cone(values):
    axis=sum(values,Vector())
    if axis.length<1e-6:raise ValueError('UV Tangent has no nonzero interpolated frame cone')
    axis.normalize();cosine=min(axis.dot(value.normalized()) for value in values)
    if cosine<=.05:raise ValueError('UV Tangent has no nonzero interpolated frame cone')
    return axis,math.acos(min(1,cosine))


def frame_bound(mesh,uv_name,storage=None):
    cache=geometry_ir._validation_cache.get();key=('tangent-frame',mesh.as_pointer(),uv_name,storage)
    if cache is not None and key in cache:return cache[key]
    uv=mesh.uv_layers.get(uv_name)
    if uv is None:raise ValueError('UV Tangent needs its actual named UV map '+uv_name)
    mesh.calc_loop_triangles()
    for triangle in mesh.loop_triangles:
        a,b,c=(uv.data[index].uv for index in triangle.loops)
        if any(not math.isfinite(item) for point in (a,b,c) for item in point) or abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))<1e-8:
            raise ValueError('UV Tangent requires finite nondegenerate UV triangles')
    try:mesh.calc_tangents(uvmap=uv_name)
    except RuntimeError as error:raise ValueError('UV Tangent native Mikk computation failed: '+str(error)) from error
    bound={'sine':1.0,'normalCosine':1.0,'tangentCosine':1.0}
    for triangle in mesh.loop_triangles:
        indices=triangle.loops
        normals=[mesh.corner_normals[index].vector.copy() for index in indices]
        tangents=[mesh.loops[index].tangent.copy() for index in indices]
        if any(abs(value.length-1)>1e-4 for value in tangents) or any(mesh.loops[index].bitangent_sign not in {-1,1} for index in indices):
            raise ValueError('UV Tangent needs finite unit Mikk vectors and exact handedness')
        if len({mesh.loops[index].bitangent_sign for index in indices})!=1:
            raise ValueError('Native tangent frames need one handedness sign per triangle')
        divisor=511 if storage=='SNORM10' else 32767 if storage=='SNORM16' else 0
        if divisor:
            def pack(vector):return Vector(tuple(math.trunc(struct.unpack('f',struct.pack('f',value*divisor))[0])/divisor for value in vector))
            normals=[pack(value) for value in normals];tangents=[pack(value) for value in tangents]
        n,n_radius=cone(normals);t,t_radius=cone(tangents)
        separation=math.acos(min(1,abs(n.dot(t))))-n_radius-t_radius
        if separation<=.05:raise ValueError('UV Tangent cannot prove its tangent/normal interpolation stays independent')
        bound['sine']=min(bound['sine'],math.sin(separation))
        bound['normalCosine']=min(bound['normalCosine'],math.cos(n_radius))
        bound['tangentCosine']=min(bound['tangentCosine'],math.cos(t_radius))
    if cache is not None:cache[key]=bound
    return bound


def bind_owners(value,owners,uv_choices):
    entries=[];requirements(value,entries)
    for entry in entries:
        names=set()
        for owner in owners:
            mesh=owner.data
            layer=mesh.uv_layers.get(entry['uvMap']) if entry['uvMap'] else next((layer for layer in mesh.uv_layers if layer.active_render),None)
            if layer is None:raise ValueError('UV Tangent needs a bound active-render or named UV map')
            if mesh.uv_layers.find(layer.name)>3:raise ValueError('UV Tangent currently requires one of the first four exported UV channels')
            names.add(layer.name)
            previous=uv_choices.setdefault(mesh.as_pointer(),layer.name)
            if previous!=layer.name:raise ValueError('One mesh requests multiple UV tangent bases; this transport currently carries one explicit Mikk frame')
            frame_bound(mesh,layer.name,entry['tangentStorage'])
        if len(names)!=1:raise ValueError('One material has different UV tangent names across owners; use consistent named UV bases')
        entry['uvMap']=names.pop()


def export_bindings(plan):
    result={}
    for decision in plan.decisions:
        entries=[];requirements(decision.channel_plan,entries)
        for entry in entries:
            for binding in decision.bindings:
                mesh=bpy.data.objects[binding.object_name].data
                old=result.setdefault(mesh.name,entry['uvMap'])
                if old!=entry['uvMap']:raise ValueError('One private mesh has conflicting Mikk tangent basis ownership')
    return result


def conflicting_meshes(decisions):
    owners={};materials={}
    for decision in decisions:
        entries=[];requirements(decision.channel_plan,entries)
        for entry in entries:
            for binding in decision.bindings:
                mesh=bpy.data.objects[binding.object_name].data
                owners.setdefault(mesh.as_pointer(),set()).add(entry['uvMap'])
                materials.setdefault(mesh.as_pointer(),[]).append((decision.material_name,mesh.name))
    result={}
    for pointer,names in owners.items():
        if len(names)>1:
            for material,mesh in materials[pointer]:result.setdefault(material,set()).add(mesh)
    return result
