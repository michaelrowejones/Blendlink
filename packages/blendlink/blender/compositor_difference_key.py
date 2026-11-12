# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only fixed Difference Key controls and legacy CPU alpha semantics."""
import math


def normalize_difference_key(node, socket, op, scene, read, bounds, fail):
    modern = node.inputs.get('Tolerance') is not None
    settings = []
    for name, attribute in [('Tolerance', 'tolerance'), ('Falloff', 'falloff')]:
        incoming = node.inputs.get(name)
        if modern:
            read(incoming)
            interval = bounds(incoming)
            if interval is None or interval[0] != interval[1]:
                fail(incoming, 'Difference Key requires proven fixed scalar Tolerance and Falloff')
            number = interval[0]
        else: number = float(getattr(node, attribute))
        if not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, 'Difference Key requires finite Tolerance and Falloff in [0,1]')
        settings.append(number)
    if 0 < settings[1] < 1 / 64:
        fail(socket, 'Difference Key Falloff must be zero or at least 1/64 for live export')
    if socket.identifier not in {'Image', 'Matte'}:
        fail(socket, 'Difference Key requires Image or Matte output')
    op['properties'].update({'difference_key_model': 'native-difference-key-v1',
        'difference_key_schema': 'legacy-cpu' if not modern and getattr(scene.render, 'compositor_device', 'CPU') == 'CPU' else 'modern',
        'difference_key_settings': settings})
    for name in ['Image 1', 'Image 2']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': name, 'socketType': incoming.type, 'value': read(incoming)}
