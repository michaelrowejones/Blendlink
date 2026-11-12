/* SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: Apache-2.0
 * Native material color math adapted from Cycles util/color.h. */
import * as TSL from 'three/tsl'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

type Node = any
const { abs, clamp, float, floor, max, min, select, vec3 } = TSL as unknown as Record<
  'abs' | 'clamp' | 'float' | 'floor' | 'max' | 'min' | 'select' | 'vec3', (...args: Node[]) => Node>

function literalVector(expression: TslIrExpression): number[] | null {
  if (expression.op === 'const_float' && typeof expression.value === 'number' && Number.isFinite(expression.value))
    return [expression.value, expression.value, expression.value]
  if (expression.op === 'const_vec3' && Array.isArray(expression.value) && expression.value.length === 3 &&
    expression.value.every(value => typeof value === 'number' && Number.isFinite(value))) return expression.value
  if (expression.op === 'combine') {
    const channels = ['x', 'y', 'z'].map(key => expression[key] as TslIrExpression)
    if (channels.every(channel => channel?.op === 'const_float' && typeof channel.value === 'number' && Number.isFinite(channel.value)))
      return channels.map(channel => channel.value as number)
  }
  if (expression.op === 'color_convert' && expression.mode === 'RGB')
    return literalVector(expression.input as TslIrExpression)
  return null
}

export function isUnitBoundedExpression(expression: TslIrExpression | undefined): boolean {
  if (!expression) return false
  const literal = literalVector(expression)
  if (literal) return literal.every(value => value >= 0 && value <= 1)
  const unit = (key: string): boolean => isUnitBoundedExpression(expression[key] as TslIrExpression)
  const finiteUnit = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  switch (expression.op) {
    case 'const_float': return finiteUnit(expression.value)
    case 'clamp01': return true
    case 'clamp_minmax': return ['min', 'max'].every(unit)
    case 'combine': return ['x', 'y', 'z'].every(unit)
    case 'separate': return unit('input')
    case 'color_convert': return unit('input')
    case 'color_ramp': return (['LINEAR', 'CONSTANT'].includes(String(expression.interpolation)) || expression.interpolation === 'EASE' && ['eevee-analytic', 'eevee-analytic-hidden'].includes(String(expression.sourceModel))) && Array.isArray(expression.stops) && expression.stops.length > 0 && expression.stops.every(stop =>
      !!stop && typeof stop === 'object' && Array.isArray(stop.color) && stop.color.slice(0, 3).every(finiteUnit))
    case 'ramp_lut': return Array.isArray(expression.values) && expression.values.length > 0 && expression.values.every((value, index) =>
      ((index % 4 === 3) === (expression.channel === 'alpha')) ? finiteUnit(value) : true)
    case 'tex_image': return Array.isArray(expression.pixels) && expression.pixels.length > 0 && expression.pixels.every((value, index) =>
      ((index % 4 === 3) === (expression.output === 'alpha')) ? finiteUnit(value) : true)
    case 'noise_normalized':
      if (expression.normalize !== true || expression.roughnessNode !== undefined || !['native-standard-f32', 'cycles-neon-fma'].includes(String(expression.perlinModel))) return false
      // Shared normalized bounds below; the builder independently validates its domain.
    case 'noise': return expression.normalize !== false && (expression.normalize === undefined || expression.normalize === true) &&
      ['noiseType', 'noise_type', 'type'].every(key => expression[key] === undefined || expression[key] === 'FBM') &&
      typeof expression.dimensions === 'number' && [1, 2, 3, 4].includes(expression.dimensions) && typeof expression.detail === 'number' && Number.isFinite(expression.detail) && expression.detail >= 0 && expression.detail <= 6 &&
      typeof expression.roughness === 'number' && Number.isFinite(expression.roughness) && expression.roughness >= 0 && expression.roughness <= 1 &&
      (expression.lacunarity === undefined || typeof expression.lacunarity === 'number' && Number.isFinite(expression.lacunarity) && expression.lacunarity > 0)
    case 'noise_fractal': return false // Signed/HDR family, regardless of an untrusted normalize annotation.
    case 'noise_varying': return expression.normalize === true &&
      ['noiseType', 'noise_type', 'type'].every(key => expression[key] === undefined || expression[key] === 'FBM') &&
      typeof expression.dimensions === 'number' && [1, 2, 3, 4].includes(expression.dimensions) &&
      typeof expression.detail === 'number' && Number.isFinite(expression.detail) && expression.detail >= 0 && expression.detail <= 2 &&
      (expression.lacunarity === undefined || typeof expression.lacunarity === 'number' && expression.lacunarity > 0 && expression.lacunarity <= 2) &&
      unit('roughnessNode')
    case 'tex_white_noise': return true
    case 'tex_checker': return expression.output === 'fac' || ['color1', 'color2'].every(unit)
    case 'mix_color': return expression.clampResult === true || expression.blendType === 'MIX' && expression.clampFactor !== false && ['a', 'b'].every(unit)
    case 'math': return ['MULTIPLY', 'MINIMUM', 'MAXIMUM'].includes(String(expression.operation)) && ['a', 'b'].every(unit)
    default: return false
  }
}

function validateHslDomain(expression: TslIrExpression, fail: (message: string) => never): void {
  const input = expression.input as TslIrExpression
  if (expression.inputDomain === 'unit-bounded-live' && isUnitBoundedExpression(input)) return
  const literal = input && literalVector(input)
  if (expression.inputDomain !== 'verified-static-nonsingular' || !literal)
    return fail('Separate HSL has no verified finite input domain')
  const high = Math.max(...literal), low = Math.min(...literal)
  const sum = Math.fround(high + low), lightness = Math.min(1, sum * .5)
  const divisor = lightness > .5 ? (expression.hslUpperDivisor === 'sum-first' ? Math.fround(2 - sum)
    : Math.fround(Math.fround(2 - high) - low)) : sum
  if (high !== low && divisor === 0) fail('Separate HSL has undefined saturation for its static RGB extrema sum')
}

export function buildTslColorConversion(expression: TslIrExpression, incoming: TslExpression,
  fail: (message: string) => never): TslExpression {
  const { mode, direction, model } = expression
  if (!['RGB', 'HSV', 'HSL'].includes(String(mode)) || !['combine', 'separate'].includes(String(direction)) ||
    !['cycles', 'eevee-gpu'].includes(String(model))) return fail('Color conversion has no verified native mode, direction or source model')
  const color = incoming as Node
  if (mode === 'RGB') return color
  if (direction === 'combine') {
    const h = color.x, s = color.y, value = color.z
    if (mode === 'HSL') {
      const phase = h.mul(6)
      const basis = vec3(clamp(abs(phase.sub(3)).sub(1), 0, 1),
        clamp(float(2).sub(abs(phase.sub(2))), 0, 1), clamp(float(2).sub(abs(phase.sub(4))), 0, 1))
      return basis.sub(.5).mul(float(1).sub(abs(value.mul(2).sub(1))).mul(s)).add(value) as TslExpression
    }
    const hue = select(h.equal(1), 0, h).mul(6), index = floor(hue), fraction = hue.sub(index)
    const p = value.mul(float(1).sub(s)), q = value.mul(float(1).sub(s.mul(fraction)))
    const t = value.mul(float(1).sub(s.mul(float(1).sub(fraction))))
    const selected = select(index.equal(0), vec3(value, t, p), select(index.equal(1), vec3(q, value, p),
      select(index.equal(2), vec3(p, value, t), select(index.equal(3), vec3(p, q, value),
        select(index.equal(4), vec3(t, p, value), vec3(value, p, q))))))
    return select(s.equal(0), vec3(value), selected) as TslExpression
  }
  const high = max(color.x, max(color.y, color.z)), low = min(color.x, min(color.y, color.z))
  const delta = high.sub(low), gray = high.equal(low), safeDelta = select(gray, 1, delta)
  if (mode === 'HSL') {
    if (!['sequential', 'sum-first'].includes(String(expression.hslUpperDivisor))) return fail('Separate HSL has no native divisor association')
    validateHslDomain(expression, fail)
    const lightness = min(high.add(low).mul(.5), 1)
    const upper = expression.hslUpperDivisor === 'sum-first' ? float(2).sub(high.add(low)) : float(2).sub(high).sub(low)
    const divisor = select(lightness.greaterThan(.5), upper, high.add(low))
    const saturation = select(gray, 0, delta.div(select(gray, 1, divisor)))
    const hue = select(high.equal(color.x), color.y.sub(color.z).div(safeDelta).add(select(color.y.lessThan(color.z), 6, 0)),
      select(high.equal(color.y), color.z.sub(color.x).div(safeDelta).add(2), color.x.sub(color.y).div(safeDelta).add(4))).div(6)
    return vec3(select(gray, 0, hue), saturation, lightness) as TslExpression
  }
  const saturation = select(high.equal(0), 0, delta.div(select(high.equal(0), 1, high)))
  const distance = vec3(high).sub(color).div(safeDelta)
  const rawHue = select(high.equal(color.x), distance.z.sub(distance.y),
    select(high.equal(color.y), float(2).add(distance.x).sub(distance.z), float(4).add(distance.y).sub(distance.x))).div(6)
  return vec3(select(saturation.equal(0), 0, select(rawHue.lessThan(0), rawHue.add(1), rawHue)), saturation, high) as TslExpression
}
