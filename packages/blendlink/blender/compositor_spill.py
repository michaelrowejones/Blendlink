# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Color Spill controls; inactive unspill settings stay untouched."""
import math


def normalize_spill(node, op, read, fail):
    modern = node.inputs.get('Spill Channel') is not None

    def menu(name, attribute, choices):
        socket = node.inputs.get(name)
        if modern:
            if socket.is_linked: fail(socket, 'Color Spill requires fixed unlinked channel/method choices')
            setting = socket.default_value
        else: setting = getattr(node, attribute)
        if setting not in choices: fail(socket, 'Color Spill has no verified ' + name + ' choice')
        return setting

    channel = menu('Spill Channel', 'channel', {'R','G','B'})
    method = menu('Limit Method', 'limit_method', {'Single','Average'} if modern else {'SIMPLE','AVERAGE'})
    method = {'SIMPLE':'Single','AVERAGE':'Average'}.get(method, method)
    limit = menu('Limit Channel', 'limit_channel', {'R','G','B'}) if method == 'Single' else 'R'
    if modern:
        ratio_socket = node.inputs['Limit Strength']
        if ratio_socket.is_linked: fail(ratio_socket, 'Color Spill currently requires fixed Limit Strength')
        ratio = float(ratio_socket.default_value)
        toggle = node.inputs['Use Spill Strength']
        if toggle.is_linked: fail(toggle, 'Color Spill currently requires fixed Use Spill Strength')
        custom = bool(toggle.default_value)
        strength_socket = node.inputs['Spill Strength']
        if custom and strength_socket.is_linked: fail(strength_socket, 'Color Spill currently requires fixed Spill Strength color')
        strength = list(strength_socket.default_value)[:3] if custom else None
    else:
        ratio, custom = float(node.ratio), bool(node.use_unspill)
        strength = [float(getattr(node, 'unspill_' + name)) for name in ('red','green','blue')] if custom else None
    if not math.isfinite(ratio) or not 0 <= ratio <= 2:
        fail(node.inputs['Image'], 'Color Spill Limit Strength requires a finite value in [0,2]')
    if strength is not None and any(not math.isfinite(value) or abs(value) > 2 for value in strength):
        fail(node.inputs['Image'], 'Color Spill custom RGB strength requires finite components in [-2,2]')
    op['properties'].update({'spill_model':'native-color-spill-v1','spill_schema':'modern' if modern else 'legacy',
        'spill_channel':channel,'spill_limit_method':method,'spill_limit_channel':limit,
        'spill_ratio':ratio,'spill_custom_strength':strength})
    for name in ['Image','Fac']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name':name,'socketType':incoming.type,'value':read(incoming)}
