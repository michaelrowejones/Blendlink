# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded EEVEE affine-UV Bump Height with explicit source owner admission."""
import math
import struct
import json
import bpy
from mathutils import Vector

if __package__:
    from . import geometry_ir
else:
    import geometry_ir

MODEL='eevee-affine-uv-v1'


def offset_width(width):
    """Native modern codegen prints the derivative argument with C %g."""
    if type(width) not in (int,float) or not math.isfinite(width) or not .1 <= width <= 10 or struct.unpack('f',struct.pack('f',width))[0] != width:
        raise ValueError('Bump Height needs an actual Float32 Filter Width within [.1,10]')
    return struct.unpack('f',struct.pack('f',float(format(width,'.6g'))))[0]


def analyse_height(expression, uv_bounds=None):
    """Prove affine structure without replacing the authored operation tree."""
    count=0;uv=None
    def walk(value,depth=0):
        nonlocal count,uv
        count+=1
        if depth>8 or count>63 or not isinstance(value,dict):
            raise ValueError('Bump Height exceeds the verified affine expression budget')
        operation=value.get('op')
        if operation=='const_float':
            amount=value.get('value')
            if type(amount) not in (int,float) or not math.isfinite(amount) or abs(amount)>1:
                raise ValueError('Bump Height needs finite literal controls within [-1,1]')
            return (0,0,float(amount)),(float(amount),float(amount)),False
        if operation=='separate' and value.get('channel') in {'x','y'}:
            source=value.get('input',{})
            if not isinstance(source,dict):raise ValueError('Bump Height needs an actual UV expression')
            kind=source.get('op')
            if kind=='uv_active' and 'uvMap' not in source:key=('uv_active',None)
            elif kind=='uv' and isinstance(source.get('uvMap'),str) and source['uvMap']:key=('uv',source['uvMap'])
            else:raise ValueError('Bump Height needs an actual active-render or named UV binding')
            if uv is not None and uv!=key:raise ValueError('Bump Height currently needs one shared UV source')
            uv=key;axis=0 if value['channel']=='x' else 1
            return ((1,0,0) if axis==0 else (0,1,0)),(uv_bounds[axis] if uv_bounds is not None else (-2,2)),True
        if operation!='math' or value.get('operation') not in {'ADD','SUBTRACT','MULTIPLY'}:
            raise ValueError('Bump Height currently supports affine UV Add/Subtract/Multiply only')
        a,ar,av=walk(value.get('a'),depth+1);b,br,bv=walk(value.get('b'),depth+1)
        if not av and not bv:
            raise ValueError('Bump Height constant math needs separate native constant-folding proof')
        if value['operation']=='MULTIPLY':
            if av and bv:raise ValueError('Bump Height multiplication must have one literal scalar operand')
            if (value['b'] if av else value['a']).get('op')!='const_float':
                raise ValueError('Bump Height multiplication needs its actual literal scalar factor')
            factor=b[2] if av else a[2];coefficients=tuple(item*factor for item in (a if av else b))
            values=[x*y for x in ar for y in br];ranges=(min(values),max(values))
        else:
            sign=1 if value['operation']=='ADD' else -1
            coefficients=tuple(x+sign*y for x,y in zip(a,b))
            ranges=(ar[0]+br[0],ar[1]+br[1]) if sign==1 else (ar[0]-br[1],ar[1]-br[0])
        if max(abs(item) for item in coefficients[:2])>1:
            raise ValueError('Bump Height affine UV slopes exceed magnitude one')
        if uv_bounds is not None and max(abs(item) for item in ranges)>4:
            raise ValueError('Bump Height intermediate range exceeds the verified finite domain')
        return coefficients,ranges,av or bv
    coefficients,ranges,varying=walk(expression)
    return {'uv':uv,'coefficients':coefficients,'range':ranges,'varying':varying}


def emit(node, *, emit_scalar, emit_vector, refuse, engine):
    if engine != 'EEVEE':
        refuse('Bump Height live translation currently uses EEVEE; Cycles appearance uses baking')
    if tuple(bpy.app.version[:2]) not in {(4,2),(5,2),(5,3)} or bpy.context.preferences.system.gpu_backend != 'METAL':
        refuse('Bump Height currently needs the measured Blender 4.2/5.2/5.3 Metal EEVEE source profile')
    for name in ('Strength','Distance','Filter Width'):
        socket=node.inputs.get(name)
        if socket and socket.is_linked:
            refuse('Bump Height currently needs unlinked Strength, Distance and Filter Width controls')
    normal=emit_vector(node.inputs['Normal']) if node.inputs['Normal'].is_linked else geometry_ir.primary_context('normal',engine)
    if normal.get('op')!='geometry_context' or normal.get('output')!='normal' or normal.get('sourceEngine')!='EEVEE':
        refuse('Bump Height currently needs the primary EEVEE geometry normal')
    strength=float(node.inputs['Strength'].default_value);distance=float(node.inputs['Distance'].default_value)
    width=float(node.inputs['Filter Width'].default_value) if node.inputs.get('Filter Width') else 1.0
    if not math.isfinite(strength) or not -1<=strength<=2 or not math.isfinite(distance) or abs(distance)>1:
        refuse('Bump Height currently needs Strength within [-1,2] and Distance within [-1,1]')
    height=emit_scalar(node.inputs['Height'])
    try: analyse_height(height); derivative_width=offset_width(width)
    except ValueError as error: refuse(str(error))
    return {"op": "bump_height_native", 'model':MODEL, 'sourceEngine':engine,
            'sourceVersion':'.'.join(str(value) for value in bpy.app.version[:2]), 'sourceGpuBackend':'METAL',
            'height':height,'normal':normal,'position':geometry_ir.primary_context('position',engine),
            'strength':strength,'distance':distance,'filterWidth':width,'offsetWidth':derivative_width,
            'invert':bool(node.invert)}


def requirements(value,result):
    if isinstance(value,dict):
        if value.get('op')=='bump_height_native':result.append(value)
        for child in value.values():requirements(child,result)
    elif isinstance(value,(list,tuple)):
        for child in value:requirements(child,result)


def validate_owner(obj,expression):
    """Source half of the same planar/UV/strength proof used on decoded GLBs.

    View precision is checked again against the actual renderer on every draw.
    Cached source mesh inspection follows the compiler's existing plan scope.
    """
    geometry_ir.validate_owner(obj,{'normal','position'})
    cache=geometry_ir._validation_cache.get()
    key=('bump-height',obj.as_pointer(),json.dumps(expression,sort_keys=True,separators=(',',':')))
    if cache is not None and key in cache:return
    graph=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(graph)
    mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=graph)
    try:
        analysis=analyse_height(expression['height']);key=analysis['uv'];layer=None
        if key:
            layer=next((item for item in mesh.uv_layers if item.active_render),None) if key[0]=='uv_active' else mesh.uv_layers.get(key[1])
            if layer is None:raise ValueError('Bump Height needs its actual authored UV layer')
        bounds=[[math.inf,-math.inf],[math.inf,-math.inf]]
        if layer:
            for loop in layer.data:
                for axis,value in enumerate(loop.uv):
                    if not math.isfinite(value) or abs(value)>2:raise ValueError('Bump Height UVs exceed the verified [-2,2] domain')
                    bounds[axis][0]=min(bounds[axis][0],value);bounds[axis][1]=max(bounds[axis][1],value)
            analysis=analyse_height(expression['height'],bounds)
        if max(abs(value) for value in analysis['range'])>2:raise ValueError('Bump Height range exceeds the verified [-2,2] domain')
        mesh.calc_loop_triangles();base=None;origin=None;maximum=0
        for vertex in mesh.vertices:
            if max(abs(value) for value in vertex.co)>64 or max(abs(value) for value in evaluated.matrix_world@vertex.co)>64:
                raise ValueError('Bump Height positions exceed the verified local/world magnitude 64')
        for triangle in mesh.loop_triangles:
            normal=triangle.normal
            points=[mesh.vertices[mesh.loops[index].vertex_index].co for index in triangle.loops]
            if base is None:base=normal.copy();origin=points[0].copy()
            if normal.dot(base)<.999999 or any(abs((point-origin).dot(base))>1e-5 for point in points):
                raise ValueError('Bump Height currently requires a planar primary triangle surface')
            if any(mesh.corner_normals[index].vector.normalized().dot(normal)<.999999 for index in triangle.loops):
                raise ValueError('Bump Height currently requires geometric flat normals')
            a,b=points[1]-points[0],points[2]-points[0]
            cross=a.cross(b);area=cross.length_squared
            if area <= 1e-10*a.length_squared*b.length_squared:
                raise ValueError('Bump Height triangle basis is poorly conditioned')
            if layer:
                uv=[layer.data[index].uv for index in triangle.loops]
                slopes=analysis['coefficients'];h=[slopes[0]*value.x+slopes[1]*value.y for value in uv]
                gradient=(b.cross(cross)*(h[1]-h[0])+cross.cross(a)*(h[2]-h[0]))/area
                maximum=max(maximum,gradient.length)
        inverse=evaluated.matrix_world.to_3x3().inverted().transposed()
        bound=maximum*math.sqrt(sum(value*value for row in inverse for value in row))/.9
        if bound*abs(expression['distance'])*max(1,expression['strength'])>.1:
            raise ValueError('Bump Height effective world slope times Distance exceeds the verified .1 bound')
    finally:evaluated.to_mesh_clear()
    if cache is not None:cache[key]=True
