/** Native Cycles fractal recurrences over a dimension-specific signed Perlin.
 * Adapted from intern/cycles/kernel/svm/fractal_noise.h (Apache-2.0).
 * Admission, source evaluation stage and coordinate transport live upstream.
 */
import { abs, clamp, float, min, select, Fn } from 'three/tsl'
import type { TslExpression, TslExprLike } from './tslNodeRecipe.js'

const scalar = float as unknown as (value: TslExprLike) => TslExpression
const absolute = abs as unknown as (value: TslExprLike) => TslExpression
const minimum = min as unknown as (a: TslExprLike, b: TslExprLike) => TslExpression
const clampNode = clamp as unknown as (value: TslExprLike, low: TslExprLike, high: TslExprLike) => TslExpression
const choose = select as unknown as (test: TslExpression, yes: TslExprLike, no: TslExprLike) => TslExpression
const shaderScope = Fn as unknown as (callback: (inputs: TslExpression[]) => TslExpression) =>
  (...inputs: TslExpression[]) => TslExpression
type MutableFloat = TslExpression & { assign(value: TslExprLike): TslExpression }

export interface NativeFractalParameters {
  type: string
  detail: number
  roughness: number
  lacunarity: number
  offset?: number
  gain?: number
}

/** A separate amplitude bound; it never grants coordinate/frequency ranges.
 * Native gradient/scaling bounds are below3 in every dimension. Fade weights
 * are convex, so3 also bounds each signed octave with rounding headroom. */
export function nativeFractalAmplitudeBound(parameters: NativeFractalParameters): number {
  if (!['MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'].includes(parameters.type) ||
    !Number.isFinite(parameters.detail) || !Number.isFinite(parameters.roughness) || parameters.detail > 2 || parameters.roughness > 1 ||
    parameters.type !== 'MULTIFRACTAL' && (!Number.isFinite(parameters.offset ?? 0) || Math.abs(parameters.offset ?? 0) > 1))
    return Infinity
  const count = Math.floor(Math.max(0, parameters.detail)), fraction = Math.max(0, parameters.detail) - count
  const ratio = Math.max(0, parameters.roughness), shifted = Math.abs(parameters.offset ?? 0) + 3
  if (parameters.type === 'MULTIFRACTAL') {
    let value = 1, power = 1
    for (let index = 0; index <= count; index++) { value *= 1 + 3 * power; power *= ratio }
    return value * (1 + fraction * power * 3)
  }
  if (parameters.type === 'HETERO_TERRAIN') {
    let value = shifted, power = ratio
    for (let index = 1; index <= count; index++) { value *= 1 + power * shifted; power *= ratio }
    return value * (1 + fraction * power * shifted)
  }
  let amplitudes = 0
  for (let index = 0; index <= count; index++) amplitudes += ratio ** index
  return parameters.type === 'HYBRID_MULTIFRACTAL'
    ? shifted * (amplitudes + fraction * ratio ** (count + 1))
    : shifted ** 2 * amplitudes
}

export function buildTslFractalNoise(position: TslExpression, parameters: NativeFractalParameters,
  octave: (position: TslExpression) => TslExpression, fail: (message: string) => never): TslExpression {
  const { type } = parameters
  if (!['MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'].includes(type))
    return fail('Noise has no verified fractal recurrence: ' + type)
  const usesOffset = type !== 'MULTIFRACTAL'
  const usesGain = type === 'HYBRID_MULTIFRACTAL' || type === 'RIDGED_MULTIFRACTAL'
  const { detail, roughness, lacunarity } = parameters
  const offset = usesOffset ? Math.fround(parameters.offset ?? 0) : 0
  const gain = usesGain ? Math.fround(parameters.gain ?? 1) : 1
  if (![detail, roughness, lacunarity, offset, gain].every(Number.isFinite) || detail > 2 || roughness > 1 ||
    Math.abs(lacunarity) > 2 || Math.abs(offset) > 1 || Math.abs(gain) > 2)
    return fail('Noise fractal recurrence exceeds its verified static parameter domain')
  if (nativeFractalAmplitudeBound({ ...parameters, offset, gain }) > 128)
    return fail('Noise fractal amplitude exceeds its verified finite bound')
  const bounded = Math.max(0, Math.fround(detail)), count = Math.floor(bounded), remainder = bounded - count
  const ratio = Math.max(0, Math.fround(roughness)), frequency = Math.fround(lacunarity)
  let p = position
  const advance = (): void => { p = p.mul(frequency).toVar() }
  if (type === 'MULTIFRACTAL') {
    let value = scalar(1), power = 1
    for (let index = 0; index <= count; index++) {
      value = value.mul(octave(p).mul(power).add(1))
      power = Math.fround(power * ratio)
      advance()
    }
    if (remainder !== 0) value = value.mul(octave(p).mul(Math.fround(remainder * power)).add(1))
    return value
  }
  if (type === 'HETERO_TERRAIN') {
    let value = octave(p).add(offset), power = ratio
    advance()
    for (let index = 1; index <= count; index++) {
      value = value.add(octave(p).add(offset).mul(power).mul(value))
      power = Math.fround(power * ratio)
      advance()
    }
    if (remainder !== 0) value = value.add(octave(p).add(offset).mul(power).mul(value).mul(remainder))
    return value
  }
  if (type === 'HYBRID_MULTIFRACTAL') return shaderScope(([point]) => {
    // Explicit feedback storage keeps each signal/condition in this scope.
    // Expanding the selected value/weight DAG duplicates conditional paths
    // and can overwhelm software shader compilers even with only3 octaves.
    let current = point!, power = 1
    const value = scalar(0).toVar() as MutableFloat, weight = scalar(1).toVar() as MutableFloat
    for (let index = 0; index <= count; index++) {
      const active = weight.greaterThan(.001).toVar(), boundedWeight = minimum(weight, 1).toVar()
      const signal = octave(current).add(offset).mul(power).toVar()
      value.assign(choose(active, value.add(boundedWeight.mul(signal)), value))
      weight.assign(choose(active, boundedWeight.mul(signal.mul(gain)), weight))
      power = Math.fround(power * ratio)
      current = current.mul(frequency).toVar()
    }
    if (remainder !== 0)
      value.assign(choose(weight.greaterThan(.001), value.add(minimum(weight, 1).mul(remainder).mul(octave(current).add(offset).mul(power))), value))
    return value
  })(position)
  // Native Ridged Multifractal deliberately ignores fractional detail.
  let signal = scalar(offset).sub(absolute(octave(p)))
  signal = signal.mul(signal)
  let value = signal, power = ratio
  for (let index = 1; index <= count; index++) {
    advance()
    const weight = clampNode(signal.mul(gain), 0, 1)
    const ridge = scalar(offset).sub(absolute(octave(p)))
    signal = ridge.mul(ridge).mul(weight)
    value = value.add(signal.mul(power))
    power = Math.fround(power * ratio)
  }
  return value
}
