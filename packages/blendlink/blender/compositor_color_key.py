# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only Color Key controls and strict native hue-boundary models."""
import math


def normalize_color_key(node, socket, op, read, bounds, fail):
    if op['properties'].get('evaluation_device') != 'CPU':
        fail(socket, 'Color Key currently requires CPU source compositing; native GPU hue threshold precision remains unported')
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
    op['properties'].update({'color_key_model': 'native-color-key-cpu-v1',
        'color_key_schema': 'modern' if modern else 'legacy', 'color_key_settings': settings})
    for name in ['Image', 'Key Color']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': name, 'socketType': incoming.type, 'value': read(incoming)}
