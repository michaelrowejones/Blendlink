/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: Apache-2.0
 * Native FBM recurrence adapted from Cycles kernel/svm/fractal_noise.h. */
import { float, mix } from 'three/tsl'
import type { TslExpression, TslExprLike, TslIrExpression } from './tslNodeRecipe.js'
import { isUnitBoundedExpression } from './tslColorConversion.js'

const scalar = float as unknown as (value: TslExprLike) => TslExpression
const interpolate = mix as unknown as (a: TslExprLike, b: TslExprLike, factor: TslExprLike) => TslExpression

function scalarStructure(expression: TslIrExpression | undefined): boolean {
  if (!expression) return false
  const scalarChild = (key: string): boolean => scalarStructure(expression[key] as TslIrExpression)
  switch (expression.op) {
    case 'const_float': case 'separate': case 'rgb_to_bw': return true
    case 'clamp01': return scalarChild('input')
    case 'clamp_minmax': return ['value', 'min', 'max'].every(scalarChild)
    case 'math': return scalarChild('a') && ['b', 'c'].filter(key => key in expression).every(scalarChild)
    case 'noise': case 'noise_fractal': case 'noise_normalized': case 'noise_varying': case 'noise_varying_native': case 'tex_white_noise': return expression.output !== 'color'
    case 'tex_image': case 'texture_ref': return expression.output === 'alpha'
    case 'tex_checker': return expression.output === 'fac'
    case 'ramp_lut': return expression.channel === 'alpha'
    default: return false
  }
}

export function isUnitRoughnessExpression(expression: TslIrExpression | undefined): boolean {
  return scalarStructure(expression) && isUnitBoundedExpression(expression)
}

/** Fixed bounded loop, with runtime-proved unit Roughness. Native controls
 * use float32 amplitude/frequency updates and normalize each fractional
 * endpoint before interpolation. Legacy static opcode behavior stays separate. */
export function buildTslVaryingFbm(position: TslExpression, detail: number,
  lacunarity: number, roughness: TslExpression, normalize: boolean,
  octave: (position: TslExpression) => TslExpression): TslExpression {
  const bounded = Math.max(0, Math.fround(detail)), count = Math.floor(bounded), fraction = bounded - count
  let amplitude = scalar(1), total = scalar(0), sum = scalar(0), frequency = 1
  for (let index = 0; index <= count; index++) {
    sum = sum.add(octave(position.mul(frequency)).mul(amplitude)).toVar()
    total = total.add(amplitude).toVar()
    amplitude = amplitude.mul(roughness).toVar()
    frequency = Math.fround(frequency * Math.fround(lacunarity))
  }
  const normalized = (value: TslExpression, weight: TslExpression): TslExpression => value.mul(.5).div(weight).add(.5)
  if (fraction !== 0) {
    const extra = sum.add(octave(position.mul(frequency)).mul(amplitude)).toVar()
    return normalize ? interpolate(normalized(sum, total), normalized(extra, total.add(amplitude)), fraction)
      : interpolate(sum, extra, fraction)
  }
  return normalize ? normalized(sum, total) : sum
}
