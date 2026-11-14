# SPDX-License-Identifier: GPL-3.0-or-later
"""Native shader float2 socket boundaries, represented as padded vec3.

Blender5.3 GPU codegen uses xy swizzles and (xy,0)/(xy,0,1) constructors.
This helper does not qualify float2's two-component mean or bool/int casts.
"""
MODEL = 'blender53-shader-float2-padded-v1'


def socket_width(socket):
    if getattr(socket, 'type', None) != 'VECTOR':
        return None
    value = getattr(socket, 'default_value', None)
    try:
        return len(value)
    except TypeError:
        # Reroute sockets need not expose a default array. Native explicitly
        # dimensioned sockets do, so never infer width from expression shape.
        return None


def is_vector2(socket):
    return socket_width(socket) == 2


def require_profile(refuse):
    import bpy
    if tuple(bpy.app.version) != (5, 3, 0) or bpy.app.build_hash != b'02f0899d78e3':
        refuse('shader native float2 needs pinned Blender5.3 socket/codegen profile')
    if __package__:
        from .tsl_ir import get_evaluation_engine
    else:
        from tsl_ir import get_evaluation_engine
    if get_evaluation_engine() != 'EEVEE':
        refuse('shader native float2 needs EEVEE codegen; Cycles socket conversions remain unqualified')


def padded(expression, refuse):
    require_profile(refuse)
    if expression.get('op') == 'native_vector2' and expression.get('model') == MODEL:
        return expression
    return {'op': 'native_vector2', 'model': MODEL, 'input': expression}


def convert_boundary(expression, source, target, refuse):
    """Return None for legacy non-2D links; otherwise a native projection."""
    source2, target2 = is_vector2(source), is_vector2(target)
    if not (source2 or target2):
        return None
    require_profile(refuse)
    from_type, to_type = getattr(source, 'type', ''), getattr(target, 'type', '')
    if (from_type not in {'VECTOR', 'RGBA'} or to_type not in {'VECTOR', 'RGBA'}
            or socket_width(source) == 4 or socket_width(target) == 4):
        refuse('shader native float2 conversion needs VECTOR3/RGBA or actual 2D sockets; scalar/INT/BOOLEAN casts remain unqualified')
    return padded(expression, refuse)
