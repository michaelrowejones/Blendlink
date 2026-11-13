# SPDX-License-Identifier: GPL-3.0-or-later
"""Read-only legacy Map Value controls. This is scalar mapping, not Mapping."""
import math
import bpy
if __package__:
    from .compositor_map_value_domain import MODEL as DOMAIN_MODEL, certify_domain
else:
    from compositor_map_value_domain import MODEL as DOMAIN_MODEL, certify_domain

PROFILE = 'native-legacy-map-value-f32-v1'
MAX_CONTROL = 1000


def normalize_map_value(node, socket, op, read, fail, operations=()):
    if bpy.app.version != (4, 2, 0):
        fail(socket, 'Map Value currently requires the verified Blender 4.2.0 legacy node; modern Map Range is a separate operation')
    if socket.identifier != 'Value' or socket.type != 'VALUE' or len(node.inputs) != 1 or node.inputs[0].identifier != 'Value' or node.inputs[0].type != 'VALUE':
        fail(socket, 'Map Value requires its native scalar Value input and output schema')
    minimum, maximum = bool(node.use_min), bool(node.use_max)
    controls = []
    for name, active in [('offset', True), ('size', True), ('min', minimum), ('max', maximum)]:
        values = getattr(node, name)
        if len(values) != 1:
            fail(socket, 'Map Value requires one scalar component per fixed control')
        number = float(values[0]) if active else None
        if active and (not math.isfinite(number) or abs(number) > MAX_CONTROL or 0 < abs(number) < 2**-126):
            fail(socket, 'Map Value controls require finite normal Float32 values within native +/-1000, with zero allowed')
        controls.append(number)
    device = op['properties'].get('evaluation_device')
    if device not in {'CPU', 'GPU'} or device == 'GPU' and op['properties'].get('native_gpu_backend') != 'METAL':
        fail(socket, 'Map Value currently requires CPU source compositing or the verified Metal GPU source backend')
    op['properties'].update({'map_value_model': PROFILE, 'map_value_native_version': list(bpy.app.version),
        'map_value_controls': controls, 'map_value_use_min': minimum, 'map_value_use_max': maximum})
    incoming = node.inputs['Value']
    value = read(incoming)
    mean = value.get('kind') == 'convert' and value.get('type') == 'VALUE' and value.get('fromType') in {'RGBA', 'VECTOR'}
    by_id, remaining = {entry['id']: entry for entry in operations}, [256]
    def qualified(v, boundary=False):
        remaining[0] -= 1
        if remaining[0] < 0 or not isinstance(v, dict):
            return False
        if v.get('kind') == 'convert':
            if v.get('type') == 'VALUE' and v.get('fromType') in {'RGBA', 'VECTOR'} and not boundary:
                return False
            return qualified(v.get('input'))
        if v.get('kind') == 'ref':
            source = by_id.get(v.get('node'))
            if not source:
                return False
            # Each fresh Map Value independently verifies its own boundary.
            return source['kind'] == 'map-value' or all(qualified(incoming['value']) for incoming in source.get('inputs', {}).values())
        return v.get('kind') == 'constant'
    if not qualified(value, True):
        fail(socket, 'Map Value requires explicit channel separation for legacy scalar conversions farther upstream, within the qualified 256-input dependency budget')
    if mean and device == 'GPU' and controls[0] != 0:
        fail(socket, 'Map Value GPU implicit color/vector averaging currently requires Offset zero; use explicit channel separation for nonzero Offset because native fused averaging remains unported')
    proof = certify_domain(value, operations, controls, minimum, maximum, device)
    if proof is None:
        fail(socket, 'Map Value requires fixed safe inputs or authored Min/Max input bounds away from zero, with finite normal-or-zero add/multiply results; unknown fields and underflow/overflow need source evaluation')
    op['properties'].update(map_value_domain_model=DOMAIN_MODEL, map_value_domain=proof)
    op['properties']['map_value_input_model'] = 'legacy-mean-v1' if mean else 'scalar-v1'
    op['inputs']['Value'] = {'name': incoming.name, 'socketType': incoming.type, 'value': value}
