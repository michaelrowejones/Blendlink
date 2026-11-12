# SPDX-License-Identifier: GPL-3.0-or-later
"""Native Color Ramp shader tables, GPU shortcuts and constant-evaluation paths."""
import math
import struct
import bpy
if __package__:
    from .shader_domains import native_shader_input_evaluation
    from .shader_color_band import native_color_band
    from .legacy_ramp_data import hidden_ramp_stop, LegacyRampDataError
else:
    from shader_domains import native_shader_input_evaluation
    from shader_color_band import native_color_band
    from legacy_ramp_data import hidden_ramp_stop, LegacyRampDataError


def _f32(value):
    return struct.unpack('f', struct.pack('f', value))[0]


def emit_context_ramp(node, socket, *, incoming, refuse, evaluation_engine):
    ramp = node.color_ramp
    if socket.identifier not in {'Color', 'Alpha'}:
        refuse('Color Ramp has no verified output ' + socket.identifier)
    mode, interpolation = str(ramp.color_mode), str(ramp.interpolation)
    alpha = socket.identifier == 'Alpha'
    if mode not in {'RGB', 'HSV', 'HSL'} or interpolation not in {'LINEAR', 'CONSTANT', 'EASE', 'B_SPLINE', 'CARDINAL'}:
        refuse('Color Ramp has an unverified native color or interpolation model')
    legacy_single = evaluation_engine == 'EEVEE' and bpy.app.version < (4, 4, 0) and len(ramp.elements) == 1
    hidden = None
    if legacy_single and mode == 'RGB' and interpolation in {'LINEAR', 'CONSTANT', 'EASE'}:
        try: hidden = hidden_ramp_stop(node)
        except LegacyRampDataError as error: refuse(str(error))
    if legacy_single and hidden is None:
        color = [float(item) for item in ramp.elements[0].color]
        return {"op": "const_float", 'value': color[3]} if alpha else {"op": "const_vec3", 'value': color[:3]}
    if hidden is None and len(ramp.elements) == 1 and (not alpha or evaluation_engine == 'CYCLES'):
        color = [float(item) for item in ramp.elements[0].color]
        return {"op": "const_float", 'value': color[3]} if alpha else {"op": "const_vec3", 'value': color[:3]}
    incoming = incoming()
    stage = native_shader_input_evaluation(incoming)
    if bpy.app.version >= (5, 0, 0) and evaluation_engine in {'CYCLES', 'EEVEE'}:
        if stage == 'opaque': refuse('Color Ramp Factor has unverified native constant-evaluation eligibility')
        if stage == 'constant':
            # MF evaluation precedes both render engines. Native evaluate is
            # exact for literal inputs; do not use Python-double Math folding.
            if len(ramp.elements) == 1 or incoming.get('op') == 'const_float':
                factor = float(incoming.get('value', .5))
                if not math.isfinite(factor): refuse('Color Ramp Factor must be finite')
                color = [float(item) for item in ramp.evaluate(factor)]
                return {"op": "const_float", 'value': color[3]} if alpha else {"op": "const_vec3", 'value': color[:3]}
            if mode == 'RGB' and interpolation in {'LINEAR', 'CONSTANT'}:
                return None  # Existing analytic CPU color-band interpolation.
            refuse('Color Ramp nonliteral MF Factor needs a verified analytic evaluator for this interpolation')
    if evaluation_engine == 'CYCLES':
        values = [float(item) for index in range(257) for item in ramp.evaluate(index / 256)]
        lookup = 'FLOOR' if interpolation == 'CONSTANT' else 'LINEAR'
        return {"op": "ramp_lut", 'model': 'cycles', 'sourceEngine': evaluation_engine,
                'channel': 'alpha' if alpha else 'rgb', 'samples': 257, 'values': values,
                'sourceColorMode': mode, 'sourceInterpolation': interpolation,
                'sourceHueInterpolation': str(ramp.hue_interpolation), 'lookup': lookup,
                'sampling': {'method': 'native-cycles-257-table', 'lookup': lookup}, 'input': incoming}
    if evaluation_engine != 'EEVEE': return None
    if len(ramp.elements) == 1 and hidden is None:
        if alpha:
            # The4.4+ fast-path writes only Color; the GPU executor supplies
            # the Alpha output socket's authored default for its missing link.
            value = float(socket.default_value)
            if not math.isfinite(value): refuse('Color Ramp Alpha output default must be finite')
            return {"op": "const_float", 'value': value}
        return {"op": "const_vec3", 'value': [float(item) for item in ramp.elements[0].color[:3]]}
    if mode == 'RGB' and (len(ramp.elements) == 2 or hidden is not None) and interpolation in {'LINEAR', 'CONSTANT', 'EASE'}:
        stops = [{'position': float(item.position), 'color': list(item.color)} for item in ramp.elements]
        if hidden is not None: stops.append(hidden)
        span = _f32(stops[1]['position'] - stops[0]['position'])
        if span == 0 and interpolation != 'CONSTANT':
            refuse('Color Ramp coincident two-stop positions have no defined native EEVEE linear multiplier')
        try: multiplier = _f32(1 / span) if span else 0
        except OverflowError: refuse('Color Ramp native EEVEE multiplier exceeds finite float range')
        expression = {"op": "color_ramp", 'sourceModel': 'eevee-analytic-hidden' if hidden else 'eevee-analytic', 'interpolation': interpolation,
                      'stops': stops, 'input': incoming, 'mulBias': [multiplier, _f32(-multiplier * stops[0]['position'])]}
        return {"op": "ramp_alpha", 'input': expression} if alpha else expression
    values = [float(item) for index in range(257) for item in ramp.evaluate(index / 256)]
    try: band = native_color_band(values)
    except ValueError as error: refuse(str(error))
    return {"op": "ramp_lut", 'model': 'eevee-gpu', 'sourceEngine': evaluation_engine,
            'channel': 'alpha' if alpha else 'rgb', 'samples': 257, **band,
            'lookup': 'FLOOR' if interpolation == 'CONSTANT' else 'LINEAR',
            'sourceColorMode': mode, 'sourceInterpolation': interpolation,
            'sourceHueInterpolation': str(ramp.hue_interpolation), 'input': incoming}
