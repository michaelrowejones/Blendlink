# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Channel Key admission; RGB channel arithmetic, no color guesswork."""
import math
import struct
import bpy


PROFILE = 'native-rgb-channel-key-pow2-v1'


def _f32(number):
    return struct.unpack('f', struct.pack('f', number))[0]


def _literal(value, ops):
    if not isinstance(value, dict) or value.get('type') != 'VALUE':
        return None
    if value.get('kind') == 'constant':
        number = value.get('value')
    elif value.get('kind') == 'ref':
        source = next((op for op in ops if op['id'] == value.get('node')), None)
        if not source or source['kind'] != 'value' or source['type'] != 'VALUE':
            return None
        number = source.get('value')
    else:
        return None
    return float(number) if isinstance(number, (int, float)) and not isinstance(number, bool) else None


def normalize_channel_key(node, socket, op, scene, read, ops, fail):
    if socket.identifier not in {'Image', 'Matte'}:
        fail(socket, 'Channel Key requires Image or Matte output')
    modern = node.inputs.get('Color Space') is not None

    def menu(name, attribute, allowed):
        incoming = node.inputs.get(name)
        if modern:
            if incoming.is_linked:
                fail(incoming, 'Channel Key requires fixed unlinked color-space, channel and limit-method menus')
            choice = incoming.default_value
        else:
            choice = getattr(node, attribute)
        if choice not in allowed:
            fail(incoming or socket, 'Channel Key has no verified ' + name + ' choice')
        return choice

    space = menu('Color Space', 'color_space', {'RGB', 'HSV', 'YUV', 'YCC', 'YCbCr'})
    if space != 'RGB':
        fail(socket, 'Channel Key currently requires RGB; HSV/YUV/YCbCr threshold conversion and legacy converted-color output remain unverified')
    key = menu('RGB Key Channel', 'matte_channel', {'R', 'G', 'B'})
    method = menu('Limit Method', 'limit_method', {'Single', 'Max'} if modern else {'SINGLE', 'MAX'}).upper()
    limit = menu('RGB Limit Channel', 'limit_channel', {'R', 'G', 'B'}) if method == 'SINGLE' else 'R'
    limits, sources = [], []
    for name, attribute in [('Minimum', 'limit_min'), ('Maximum', 'limit_max')]:
        incoming = node.inputs.get(name)
        value = read(incoming) if modern else {'kind': 'constant', 'type': 'VALUE', 'value': float(getattr(node, attribute))}
        number = _literal(value, ops)
        if number is None or not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, 'Channel Key limits require fixed finite scalar literals, Value nodes or constant group inputs within [0,1]')
        limits.append(number)
        sources.append('linked-literal' if modern and incoming.is_linked else 'socket-default' if modern else 'property')
        op['inputs'][name] = {'name': name, 'socketType': 'VALUE', 'value': value}
    minimum, maximum = limits
    span = _f32(maximum - minimum)
    if minimum >= maximum or span < 1/64 or math.frexp(span)[0] != .5:
        fail(socket, 'Channel Key requires ordered Minimum < Maximum with a power-of-two Float32 span within [1/64,1]; collapsed/reversed and other ramps need source evaluation')
    source_device = getattr(scene.render, 'compositor_device', 'CPU')
    if source_device not in {'CPU', 'GPU'}:
        fail(socket, 'Channel Key requires a known CPU or GPU source compositor')
    if source_device == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
        fail(socket, 'Channel Key currently requires CPU source compositing or the verified Metal GPU source backend; other GPU arithmetic profiles remain unverified')
    if source_device == 'GPU' and bpy.app.version[:2] not in {(4,2),(5,2),(5,3)}:
        fail(socket, 'Channel Key GPU arithmetic is verified for Blender4.2/5.2/5.3 only')
    op['properties'].update({'channel_key_model': PROFILE, 'channel_key_schema': 'modern' if modern else 'legacy',
        'channel_key_space': space, 'channel_key_channel': key, 'channel_key_limit_method': method,
        'channel_key_limit_channel': limit, 'channel_key_limits': limits,
        'channel_key_limit_sources': sources, 'channel_key_native_version': list(bpy.app.version[:3])})
    incoming = node.inputs['Image']
    op['inputs']['Image'] = {'name': incoming.name, 'socketType': incoming.type, 'value': read(incoming)}
