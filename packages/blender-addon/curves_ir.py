# SPDX-License-Identifier: GPL-3.0-or-later
"""Native shader curve tables with explicit Cycles/EEVEE evaluation models."""
import math
import importlib.util
from pathlib import Path
import sys

import bpy

if __package__:
    from .shader_domains import native_shader_input_evaluation
    from .shader_color_band import native_color_band
    try:
        from .compositor_graph import copied_curve_mapping, curve_tables
    except ModuleNotFoundError as error:
        if error.name != __package__ + '.compositor_graph':
            raise
        # Source checkouts keep canonical backend helpers in a sibling folder;
        # staged/installed extensions use the ordinary relative import above.
        from .bakelib_loader import bakelib as _bakelib
        name = __package__ + '.compositor_graph'
        spec = importlib.util.spec_from_file_location(name, Path(_bakelib.__file__).with_name('compositor_graph.py'))
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        copied_curve_mapping, curve_tables = module.copied_curve_mapping, module.curve_tables
else:
    from shader_domains import native_shader_input_evaluation
    from shader_color_band import native_color_band
    from compositor_graph import copied_curve_mapping, curve_tables


def _socket(node, identifiers):
    return next(socket for socket in node.inputs if socket.identifier in identifiers)


def _point_domain(curves):
    # Cycles reads the first/last stored points, not the UI clipping rectangle.
    return [min(float(curve.points[0].location[0]) for curve in curves),
            max(float(curve.points[-1].location[0]) for curve in curves)]


def emit_curve(node, socket, *, emit_input, refuse, evaluation_engine):
    kinds = {'ShaderNodeFloatCurve': ('float', 'Value', 1),
             'ShaderNodeVectorCurve': ('vector', 'Vector', 3),
             'ShaderNodeRGBCurve': ('rgb', 'Color', 4)}
    kind, output, count = kinds[node.bl_idname]
    if socket.identifier != output:
        refuse('Curve output is inactive or unsupported')
    if evaluation_engine not in {'CYCLES', 'EEVEE'}:
        refuse('Shader curves require a Cycles or EEVEE source evaluation engine')
    if len(node.mapping.curves) != count:
        refuse('Curve Mapping has an unsupported native curve count')
    tone = str(node.mapping.tone)
    if tone not in {'STANDARD', 'FILMLIKE'}:
        refuse('Curve Mapping tone has no verified shader model')
    factor = emit_input(_socket(node, {'Fac', 'Factor'}))
    incoming = emit_input(_socket(node, {output}), as_vector=kind != 'float')
    model = 'cycles' if evaluation_engine == 'CYCLES' else 'eevee-gpu'
    if bpy.app.version >= (5, 0, 0):
        stages = [native_shader_input_evaluation(incoming), native_shader_input_evaluation(factor)]
        if 'opaque' in stages:
            refuse('Curve input has unverified native constant-evaluation eligibility')
        # Material MF folding was introduced in5.0 and precedes export to
        # either renderer. Earlier Cycles folds its own257-entry shader table.
        if all(stage == 'constant' for stage in stages): model = 'shader-mf'
    result = {"op": "curve_native", 'kind': kind, 'model': model,
              'sourceEngine': evaluation_engine, 'sourceTone': tone,
              'factor': factor, 'input': incoming, 'samples': 257}
    if model == 'cycles':
        sampling_domain = _point_domain(node.mapping.curves)
        with copied_curve_mapping(node) as mapping:
            curves = list(mapping.curves)
            domain = _point_domain(curves)
            low, high = sampling_domain
            if not all(math.isfinite(item) for item in [*sampling_domain, *domain]) or high <= low or domain[1] <= domain[0]:
                refuse('Cycles Curve Mapping requires finite nonzero horizontal domains')
            values = []
            for index in range(257):
                parameter = low + (high - low) * index / 256
                if kind == 'rgb':
                    combined = mapping.evaluate(curves[3], parameter)
                    color = [float(mapping.evaluate(curve, combined)) for curve in curves[:3]]
                elif kind == 'vector':
                    color = [float(mapping.evaluate(curve, parameter)) for curve in curves]
                else:
                    color = [float(mapping.evaluate(curves[0], parameter)), 0, 0]
                values.extend([*color, 1])
            result.update(domain=domain, samplingDomain=sampling_domain,
                          extrapolate=mapping.extend == 'EXTRAPOLATED', values=values,
                          sampling='native Cycles257-entry table; endpoint-table extrapolation')
    else:
        # Reuse read-only native cache transport, not compositor composition.
        data = curve_tables(node)
        rows = data['curve_values']
        result.update(ranges=data['curve_ranges'], slopes=data['curve_slopes'],
                      values=[float(rows[channel][index]) if channel < count else 1.0
                              for index in range(257) for channel in range(4)],
                      clip=data['curve_clip'], clipY=data['curve_clip_y'],
                      sampling='native shader MF per-curve tables and extrapolation')
        if model == 'eevee-gpu':
            if bpy.app.version < (4, 3, 0):
                # 4.2 constructs its cache with the clip rectangle's width,
                # before expanding each channel's minimum/maximum to its
                # control points. GPU normalization nevertheless uses those
                # expanded bounds. Public evaluate at the actual cache grid
                # recovers the raw native table without reading DNA memory.
                with copied_curve_mapping(node) as mapping:
                    mapping.use_clip = False
                    mapping.update()
                    span = float(mapping.clip_max_x - mapping.clip_min_x)
                    if not math.isfinite(span) or span <= 0:
                        refuse('Legacy shader GPU curves require a finite nonzero clipping width')
                    result['values'] = [float(mapping.evaluate(mapping.curves[channel],
                                           data['curve_ranges'][channel][0] + span * index / 256))
                                        if channel < count else 1.0
                                        for index in range(257) for channel in range(4)]
                    result['legacyCacheSpan'] = span
            try:
                result.update(native_color_band(result['values']))
            except ValueError as error:
                refuse(str(error))
            # Native shader RGB skips identity channel tables entirely. A
            # second quantized GPU lookup would otherwise change the color.
            result['rgbIdentity'] = kind == 'rgb' and node.mapping.extend == 'EXTRAPOLATED' and all(
                data['curve_ranges'][index] == [0.0, 1.0] and len(curve.points) == 2 and
                list(curve.points[0].location) == [0.0, 0.0] and
                list(curve.points[1].location) == [1.0, 1.0] and
                all(abs(slope - 1) < 1e-6 for slope in data['curve_slopes'][index])
                for index, curve in enumerate(node.mapping.curves[:3]))
            result['sampling'] = 'native shader GPU per-curve color band and extrapolation'
    if not all(math.isfinite(value) for value in result['values']):
        refuse('Curve Mapping produces nonfinite native table values')
    return result
