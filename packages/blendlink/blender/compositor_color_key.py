# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Color Key controls and independently certified grayscale inputs."""
import math
import struct


def grayscale_value(value, operations):
    """Prove the executable RGB shape, never an annotation claiming gray/unit.

    Replicated scalar links and fixed gray colors need no approximate HSV
    reciprocal: their finite native cmax == cmin, so H = S = 0 exactly.
    Keep the small Python/TS admission grammars independent and bounded.
    """
    by_id = {op.get('id'): op for op in operations}
    remaining = [256]
    def literal(v):
        if not isinstance(v, dict):
            return None
        if v.get('kind') == 'ref':
            op = by_id.get(v.get('node'), {})
            if op.get('kind') != 'value':
                return None
            v = {'kind': 'constant', 'type': op.get('type'), 'value': op.get('value')}
        number = v.get('value')
        if v.get('kind') != 'constant' or v.get('type') != 'VALUE' or not isinstance(number, (int, float)) or isinstance(number, bool):
            return None
        try:
            result = struct.unpack('<f', struct.pack('<f', number))[0]
            return result if math.isfinite(result) else None
        except (OverflowError, struct.error):
            return None
    def same(a, b, depth=0):
        left, right = literal(a), literal(b)
        if left is not None and right is not None:
            return left == right
        if depth > 32 or not isinstance(a, dict) or not isinstance(b, dict) or a.get('kind') != b.get('kind'):
            return False
        if a.get('kind') == 'ref':
            return a.get('node') == b.get('node')
        if a.get('type') != b.get('type'):
            return False
        if a.get('kind') == 'constant':
            return a.get('value') == b.get('value')
        return a.get('kind') == 'convert' and a.get('fromType') == b.get('fromType') and same(a.get('input'), b.get('input'), depth + 1)
    def walk(v, scalar=False, depth=0):
        remaining[0] -= 1
        if remaining[0] < 0 or depth > 32 or not isinstance(v, dict):
            return False
        kind, data_type = v.get('kind'), v.get('type')
        if kind == 'constant':
            number = v.get('value')
            if scalar:
                return data_type == 'VALUE' and isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number)
            return data_type == 'RGBA' and isinstance(number, list) and len(number) == 4 and all(
                isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in number
            ) and number[0] == number[1] == number[2]
        if kind == 'convert':
            original, incoming = v.get('fromType'), v.get('input')
            if scalar and data_type == 'VALUE':
                if original in ('RGBA', 'VECTOR'):
                    return isinstance(incoming, dict)  # Runtime conversion is a scalar dot product.
                return original == 'VALUE' and walk(incoming, True, depth + 1)
            if not scalar and data_type == 'RGBA':
                if original == 'VALUE':
                    return walk(incoming, True, depth + 1)
                return original == 'RGBA' and walk(incoming, False, depth + 1)
            return False
        if kind != 'ref' or v.get('node') not in by_id:
            return False
        op = by_id[v['node']]
        inputs, properties = op.get('inputs', {}), op.get('properties', {})
        if scalar:
            if op.get('kind') == 'value':
                return walk({'kind': 'constant', 'type': op.get('type'), 'value': op.get('value')}, True, depth + 1)
            if op.get('kind') in ('rgb-to-bw', 'separate-color'):
                return True  # These builders return an actual scalar/component.
            if op.get('kind') == 'math':
                return bool(inputs) and all(walk(incoming.get('value'), True, depth + 1) for incoming in inputs.values())
            return False
        if op.get('kind') in ('value', 'rgb'):
            return walk({'kind': 'constant', 'type': op.get('type'), 'value': op.get('value')}, False, depth + 1)
        if op.get('kind') == 'combine-color' and properties.get('mode') == 'RGB':
            channels = [inputs.get(name, {}).get('value') for name in ('Red', 'Green', 'Blue')]
            return all(walk(channel, True, depth + 1) for channel in channels) and same(channels[0], channels[1]) and same(channels[0], channels[2])
        return False
    return walk(value)


def normalize_color_key(node, socket, op, read, bounds, fail, operations=()):
    modern = node.inputs.get('Hue') is not None
    settings = []
    for name, attribute in [('Hue', 'color_hue'), ('Saturation', 'color_saturation'), ('Value', 'color_value')]:
        incoming = node.inputs.get(name)
        if modern:
            read(incoming)
            interval = bounds(incoming)
            if interval is None or interval[0] != interval[1]:
                fail(incoming, 'Color Key requires proven fixed scalar Hue, Saturation and Value thresholds')
            number = interval[0]
        else:
            number = float(getattr(node, attribute))
        if not math.isfinite(number) or not 0 <= number <= 1 or 0 < number < 2 ** -126:
            fail(incoming or socket, 'Color Key requires normal finite Float32 thresholds in [0,1], with zero allowed')
        settings.append(number)
    if socket.identifier not in {'Image', 'Matte'}:
        fail(socket, 'Color Key requires Image or Matte output')
    gpu = op['properties'].get('evaluation_device') == 'GPU'
    dead = gpu and (settings[1] == 0 or settings[2] == 0)
    for name in ['Image'] if dead else ['Image', 'Key Color']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': name, 'socketType': incoming.type, 'value': read(incoming)}
    model = 'native-color-key-cpu-v1'
    if gpu:
        if dead:
            model = 'native-color-key-dead-v1'
        elif all(grayscale_value(op['inputs'][name]['value'], operations) for name in ('Image', 'Key Color')):
            if 0 < settings[0] < 2 ** -125:
                fail(socket, 'Color Key GPU grayscale Hue must be zero or at least 2^-125 so its half threshold remains normal')
            model = 'native-color-key-gray-v1'
        else:
            fail(socket, 'Color Key currently requires CPU source compositing for chromatic RGB; native GPU hue threshold precision remains unported')
    op['properties'].update({'color_key_model': model,
        'color_key_schema': 'modern' if modern else 'legacy', 'color_key_settings': settings})
