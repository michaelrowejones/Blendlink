# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded EEVEE surface specialization; never a universal Light Path value."""
import platform
import sys
import math
import struct
import bpy

MODEL = 'eevee53-white-shadow-branch-v1'
PROFILE = 'blender53-macos-metal-shadow-transparent-v1'


def _visible_principled(expression):
    if (expression.get('kind')=='principled' and not expression['stack']
            and not expression['node'].inputs['Alpha'].is_linked):
        return expression['node']
    if expression.get('kind')=='mix' and not expression['fac_stack'] and not expression['fac_socket'].is_linked:
        if expression['a'].get('kind')=='transparent':
            leaf=expression['b']
            if leaf.get('kind')=='principled' and not leaf['stack'] and not leaf['node'].inputs['Alpha'].is_linked and leaf['node'].inputs['Alpha'].default_value==1:
                return leaf['node']
        if expression['b'].get('kind')=='transparent':
            leaf=expression['a']
            if leaf.get('kind')=='principled' and not leaf['stack'] and not leaf['node'].inputs['Alpha'].is_linked and leaf['node'].inputs['Alpha'].default_value==1:
                return leaf['node']
    return None


def primary_surface(expression, ir):
    """Terminal direct Is Shadow Ray mix with a white shadow closure only."""
    if (ir.get_evaluation_engine() != 'EEVEE' or tuple(bpy.app.version) != (5, 3, 0)
            or bpy.app.build_hash != b'02f0899d78e3' or sys.platform != 'darwin'
            or platform.machine() != 'arm64'
            or bpy.context.preferences.system.gpu_backend != 'METAL'
            or expression.get('kind') != 'mix'):
        return None
    fac = expression['fac_socket']
    if expression['fac_stack'] or fac.node.mute:
        return None
    source = ir._socket_source(fac)
    if source is None:
        return None
    node, socket = source
    if (node.bl_idname != 'ShaderNodeLightPath' or node.mute
            or socket.identifier != 'Is Shadow Ray' or socket.type != 'VALUE'):
        return None
    # Keep this first scope on the actual authored Archviz dual-output shape:
    # its Cycles closure is precisely the non-shadow branch. Other output
    # arrangements need their own carrier and installed-render controls.
    primary_link = ir._resolve_shader_link(fac.node.inputs[1], ())
    try:
        cycles_link = ir._active_surface_link(fac.node.id_data, 'CYCLES')
    except ir.TslIrRefusal:
        return None
    if primary_link != cycles_link:
        return None
    resolved = ir._resolve_shader_link(fac.node.inputs[2], ())
    if resolved is None:
        return None
    transparent, _output, stack = resolved
    if (stack or transparent.bl_idname != 'ShaderNodeBsdfTransparent' or transparent.mute
            or expression['b'].get('kind') != 'transparent'
            or transparent.inputs['Color'].is_linked
            or tuple(transparent.inputs['Color'].default_value) != (1., 1., 1., 1.)):
        return None
    weight = transparent.inputs.get('Weight')
    if weight is not None and (weight.is_linked or weight.default_value != 0):
        return None
    for owner in (fac.node, node, transparent):
        ir._require_static_tree(owner)
    if _visible_principled(expression['a']) is None:
        return None
    return expression['a']


def wrap_alpha(value, ir):
    alpha = ir._fold_constant_scalar(value)
    if alpha is None or not math.isfinite(alpha) or not 0 < alpha <= 1:
        ir._refuse('White shadow exclusion requires a static visible Alpha in (0, 1]')
    alpha=struct.unpack('<f',struct.pack('<f',alpha))[0]
    if not 0 < alpha <= 1:
        ir._refuse('White shadow exclusion visible Alpha underflowed Float32')
    return {'op': 'shadow_exclusion_native', 'model': MODEL, 'sourceProfile': PROFILE, 'input': {'op':'const_float','value':alpha}, 'visibleAlpha':alpha}
