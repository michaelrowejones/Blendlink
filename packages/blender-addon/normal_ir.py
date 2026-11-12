# SPDX-License-Identifier: GPL-3.0-or-later
"""Native primary-surface normal fields and conservative normalization proofs."""
import itertools
import math
import struct

import bpy
from mathutils import Vector

if __package__:
    from . import geometry_ir
else:
    import geometry_ir

SPACES = {'OBJECT', 'WORLD', 'BLENDER_OBJECT', 'BLENDER_WORLD'}
EPSILON = 1e-3


def channel_has_native_normal(root, channel, walk_channel):
    if root is None: return False
    names=('Emission Color','Emission Strength') if channel=='Emission' else (channel,)
    for name in names:
        socket=root.inputs.get(name)
        if socket is not None and any(node.bl_idname=='ShaderNodeNormalMap' and node.space in SPACES
                                      for node,output in walk_channel(socket)):
            return True
    return False


def scalar_literal(value):
    if isinstance(value,dict) and value.get('op')=='const_float':
        amount=value.get('value')
        if isinstance(amount,(int,float)) and math.isfinite(amount): return float(amount)
    return None


def vector_literal(value):
    if not isinstance(value,dict): return None
    if value.get('op')=='const_vec3':
        result=value.get('value')
        if isinstance(result,list) and len(result)==3 and all(isinstance(item,(int,float)) and math.isfinite(item) for item in result):
            return result
    if value.get('op')=='const_float':
        amount=scalar_literal(value)
        return [amount]*3 if amount is not None else None
    if value.get('op')=='combine':
        result=[scalar_literal(value.get(axis)) for axis in ('x','y','z')]
        return result if all(item is not None for item in result) else None
    if value.get('op')=='color_convert' and value.get('mode')=='RGB': return vector_literal(value.get('input'))
    return None


def decoded_color(color, engine, space, convention):
    result = Vector(tuple(2 * value - 1 for value in color))
    if space.startswith('BLENDER_'):
        if engine == 'CYCLES': result.y, result.z = -result.y, -result.z
        else: result.y, result.z = -2 * color[1] - 1, -2 * color[2] - 1
    if convention == 'DIRECTX': result.y = -result.y
    return result


def emit_normal_map(node, *, emit_vector, emit_scalar, refuse, engine):
    if node.space not in SPACES: refuse('Normal Map has no native object/world model for '+node.space)
    color = emit_vector(node.inputs['Color'])
    strength = emit_scalar(node.inputs['Strength'])
    witness, amount = vector_literal(color), scalar_literal(strength)
    if witness is None or amount is None:
        refuse('Object/World Normal Map currently requires a finite constant color/strength proof; the authored inputs remain intact')
    if any(not math.isfinite(value) or abs(value) > 16 for value in [*witness, amount]):
        refuse('Object/World Normal Map color and strength exceed the verified finite domain (absolute value at most 16)')
    convention, base = getattr(node,'convention','OPENGL'), getattr(node,'base','ORIGINAL')
    if convention not in {'OPENGL','DIRECTX'} or base not in {'ORIGINAL','DISPLACED'}:
        refuse('Normal Map has no verified convention/base selector')
    if engine not in {'CYCLES','EEVEE'}: refuse('Normal Map needs an explicit native source engine')
    decoded = decoded_color(witness, engine, node.space, convention)
    if engine == 'CYCLES' and node.space.endswith('OBJECT') and decoded.length < EPSILON:
        refuse('Cycles Object Normal Map needs a nonzero decoded normal before its object transform')
    return {"op": "normal_map_native",'model':'primary-normal-map-v1','space':node.space,
            'sourceEngine':engine,'convention':convention,'base':base,
            'color':color,'strength':strength,
            'normal':geometry_ir.primary_context('normal', engine)}


def requirements(value, result):
    if isinstance(value, dict):
        if value.get('op') == 'normal_map_native': result.append(value)
        for child in value.values(): requirements(child, result)
    elif isinstance(value, (tuple,list)):
        for child in value: requirements(child, result)


def packed_bounds(mesh, storage):
    cache=geometry_ir._validation_cache.get()
    key=('normal-map-bounds',mesh.as_pointer(),storage)
    if cache is not None and key in cache: return cache[key]
    divisor=511 if storage=='SNORM10' else 32767 if storage=='SNORM16' else None
    values=[tuple(normal.vector) for normal in mesh.corner_normals]
    bounds=([min(value[axis] for value in values) for axis in range(3)],
            [max(value[axis] for value in values) for axis in range(3)])
    if divisor:
        def pack(value): return math.trunc(struct.unpack('f',struct.pack('f',value*divisor))[0])/divisor
        bounds=([pack(value)-1e-6 for value in bounds[0]],[pack(value)+1e-6 for value in bounds[1]])
    if cache is not None: cache[key]=bounds
    return bounds


def certify_blend(color, strength, matrix, bounds):
    """A normal cone over eight packed-normal bounds avoids per-frame mesh scans.

    Normalized positive interpolation stays inside this cone. Checking both
    signs covers every primary front/back face without a saved camera witness.
    """
    magnitude=color.length
    a,b=1-max(strength,0),max(strength,0)
    if abs(abs(a)-b*magnitude)>EPSILON: return
    if magnitude<EPSILON:
        raise ValueError('Normal Map has a zero-length native normal blend')
    if callable(bounds): bounds=bounds()
    if bounds is None:
        raise ValueError('Normal Map needs actual bound normal data to certify its normalization')
    corners=[(matrix @ Vector(point)).normalized() for point in itertools.product(*zip(*bounds))]
    axis=sum(corners,Vector()).normalized()
    cosine=min(axis.dot(corner) for corner in corners)
    if cosine <= 0:
        raise ValueError('Normal Map cannot certify a nonzero blend over this normal cone')
    alignment=abs(axis.dot(color.normalized()))
    if alignment >= cosine-EPSILON:
        raise ValueError('Normal Map cannot certify a nonzero blend over this normal cone')


def validate_owner(obj, entries):
    if not entries: return
    matrix=obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world.to_3x3().inverted().transposed()
    for entry in entries:
        if entry['sourceEngine']!='EEVEE': continue
        color=decoded_color(vector_literal(entry['color']), 'EEVEE', entry['space'], entry['convention'])
        if entry['space'].endswith('OBJECT'): color=matrix @ color
        strength=scalar_literal(entry['strength'])
        certify_blend(color,strength,matrix,lambda:packed_bounds(obj.data,entry['normal']['normalStorage']))
