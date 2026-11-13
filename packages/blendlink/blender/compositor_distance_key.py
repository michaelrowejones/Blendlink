# SPDX-License-Identifier: GPL-3.0-or-later
"""Measured RGB Distance Key schemas; no authored graph/state mutation."""
import math

import bpy


def _fixed_scalar(socket):
    if not socket.is_linked:
        return float(socket.default_value)
    links = [link for link in socket.links if link.is_valid and not getattr(link, 'is_muted', False)]
    if len(links) == 1 and links[0].from_node.bl_idname in {'ShaderNodeValue', 'CompositorNodeValue'}:
        return float(links[0].from_socket.default_value)
    return None


def normalize_distance_key(node, socket, op, scene, read, single, fail):
    if bpy.app.version[:3] not in {(4, 2, 0), (5, 2, 0), (5, 3, 0)}:
        fail(socket, 'Distance Key requires a measured Blender 4.2, 5.2 or 5.3 source model')
    modern = node.inputs.get('Color Space') is not None
    if modern:
        space = node.inputs['Color Space']
        if space.is_linked:
            fail(space, 'Distance Key requires a fixed unlinked RGB color-space menu')
        color_space = space.default_value
    else:
        color_space = node.channel
    if color_space != 'RGB':
        fail(socket, 'Distance Key YCC has distinct legacy/modern distance and image conversion semantics; this profile supports RGB only')
    settings = []
    for name, attribute in [('Tolerance', 'tolerance'), ('Falloff', 'falloff')]:
        incoming = node.inputs.get(name)
        number = _fixed_scalar(incoming) if modern else float(getattr(node, attribute))
        if number is None or not math.isfinite(number) or not 0 <= number <= 1:
            fail(incoming or socket, 'Distance Key requires fixed finite Tolerance/Falloff in [0,1]; linked controls must be literal Value nodes')
        settings.append(number)
    if 0 < settings[1] < 1 / 64:
        fail(socket, 'Distance Key Falloff must be zero or at least 1/64 for live export')
    if 0 < settings[0] < 2 ** -50:
        fail(socket, 'Distance Key Tolerance must be zero or at least 2^-50; subnormal distance-boundary transport remains unqualified')
    if modern and settings[0] == 0:
        fail(socket, 'Modern Distance Key with zero Tolerance is not qualified for live export; use a supported positive Tolerance or source baking')
    if not modern and settings[0] == 0 and settings[1] != 0:
        fail(socket, 'Legacy Distance Key with zero Tolerance and positive Falloff requires preserved subnormal distances; use positive Tolerance, zero Falloff or source baking')
    device = getattr(scene.render, 'compositor_device', 'CPU')
    if not modern and device == 'GPU' and settings[1] == 0:
        fail(socket, 'Legacy GPU Distance Key zero Falloff is not yet supported; use the CPU compositor or source baking')
    if socket.identifier not in {'Image', 'Matte'}:
        fail(socket, 'Distance Key requires Image or Matte output')
    op['properties'].update(distance_key_model='native-rgb-distance-cpu-v1',
        distance_key_schema='modern' if modern else 'legacy', distance_key_settings=settings)
    for name in ['Image', 'Key Color']:
        incoming = node.inputs[name]
        op['inputs'][name] = {'name': name, 'socketType': incoming.type, 'value': read(incoming)}
    if device == 'GPU' and (not modern or not all(single(item['value']) for item in op['inputs'].values())):
        fail(socket, "Distance Key GPU fields do not yet match Blender's threshold decisions; use the CPU compositor or source baking")
