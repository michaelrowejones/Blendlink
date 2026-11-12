# SPDX-License-Identifier: GPL-3.0-or-later
"""Conservative finite amplitude bounds for bounded native Noise recurrences.

The signed octave bound3 covers all four native gradients/scales and convex
fade interpolation. It is deliberately looser than the usual observed [-1,1].
Frequency/coordinate admission is separate; these bounds never grant a scale.
"""
import math

FRACTAL_TYPES = {'MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'}


def fractal_amplitude_bound(kind, detail, roughness, offset=0, gain=1):
    if kind not in FRACTAL_TYPES: raise ValueError('Unknown native fractal recurrence')
    if not all(math.isfinite(value) for value in [detail, roughness, offset, gain]):
        raise ValueError('Native fractal controls must be finite')
    detail = max(0, detail)
    roughness = max(0, roughness)
    if detail > 2 or roughness > 1 or abs(offset) > 1 or abs(gain) > 2:
        raise ValueError('Native fractal controls exceed the proven parameter domain')
    count = math.floor(detail)
    fraction = detail - count
    octave = 3.0
    shifted = abs(offset) + octave
    if kind == 'MULTIFRACTAL':
        value, power = 1.0, 1.0
        for _ in range(count + 1):
            value *= 1 + power * octave
            power *= roughness
        return value * (1 + fraction * power * octave)
    if kind == 'HETERO_TERRAIN':
        value, power = shifted, roughness
        for _ in range(count):
            value *= 1 + power * shifted
            power *= roughness
        return value * (1 + fraction * power * shifted)
    if kind == 'HYBRID_MULTIFRACTAL':
        # Only active positive weights contribute, and each is capped at1.
        return shifted * (sum(roughness ** index for index in range(count + 1)) + fraction * roughness ** (count + 1))
    # Ridged's squared signal is capped by the shifted octave bound and its
    # feedback weight is clamped[0,1]. Fractional detail is natively ignored.
    return shifted ** 2 * sum(roughness ** index for index in range(count + 1))
