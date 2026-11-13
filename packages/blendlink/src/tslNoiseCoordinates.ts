/* SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al. All Rights Reserved.
 * SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 SceneToWeb contributors
 * SPDX-License-Identifier: BSD-3-Clause
 * Native snoise coordinate reduction adapted from Cycles kernel/svm/noise.h. */
import { abs, bitcast, float, int, uint, mod, select, If, Fn } from 'three/tsl'
import type { TslExpression, TslExprLike } from './tslNodeRecipe.js'
import { buildNativeNoiseFma } from './tslNativeNoisePrecision.js'
const scalar = float as unknown as (value: TslExprLike) => TslExpression
const integer = int as unknown as (value: TslExprLike) => TslExpression
const word = uint as unknown as (value: TslExprLike) => TslExpression
const absolute = abs as unknown as (value: TslExprLike) => TslExpression
const cast = bitcast as unknown as (value: TslExprLike, type: string) => TslExpression
const remainder = mod as unknown as (a: TslExprLike, b: TslExprLike) => TslExpression
const choose = select as unknown as (test: TslExpression, a: TslExprLike, b: TslExprLike) => TslExpression
const branch = If as unknown as (test: TslExpression, body: () => void) => { Else(body: () => void): void }
type Mutable = TslExpression & { assign(value: TslExprLike): void }
const variable = (value: TslExpression): Mutable => value.toVar() as Mutable
const shader = Fn as unknown as (body: (inputs: TslExpression[]) => TslExpression) => {
  setLayout(layout: unknown): (input: TslExpression) => TslExpression
}
const correction = (point: TslExpression): TslExpression => choose(absolute(point).lessThan(1000000), scalar(0), scalar(.5))

/** Metal lowers EEVEE's compatible_mod to an f32 reciprocal followed by
 * a fused product/subtraction. Quotient conversion remains native int32. */
export const buildMetalShaderNoiseCoordinate = shader(([point]) => {
  const result = variable(point!)
  branch(scalar(100000).lessThanEqual(absolute(point!)), () => {
    const quotient = integer(point!.mul(Math.fround(1 / 100000))).toVar()
    result.assign(buildNativeNoiseFma(scalar(quotient).negate(), scalar(100000), point!).add(correction(point!)))
  })
  return result
}).setLayout({ name: 'blendlinkMetalShaderNoiseCoordinateV1', type: 'float', inputs: [{ name: 'point', type: 'float' }] })

/** Exact C fmodf(point,100000) for finite float32 inputs, followed by the
 * native correction. Integer mantissa/exponent reduction avoids the rounded
 * division used by compatible_mod, including large exponents. */
export const buildExactNoiseCoordinate = shader(([point]) => {
  const magnitude = absolute(point!), result = variable(point!)
  branch(scalar(100000).lessThanEqual(magnitude), () => {
    const bits = cast(magnitude, 'uint')
    const mantissa = bits.bitAnd(word(0x7fffff)).bitOr(word(0x800000)).toVar()
    const exponent = integer(bits.shiftRight(word(23))).sub(integer(150)).toVar()
    const positive = variable(scalar(0))
    branch(exponent.lessThan(integer(0)), () => {
      const shift = word(exponent.negate()).toVar()
      const denominator = word(1).shiftLeft(shift)
      const integral = remainder(mantissa.shiftRight(shift), word(100000))
      const fractional = scalar(mantissa.bitAnd(denominator.sub(word(1)))).div(scalar(denominator))
      positive.assign(scalar(integral).add(fractional))
    }).Else(() => {
      const value = variable(remainder(mantissa, word(100000))), power = word(exponent)
      // Split each modular product at 15 bits: both products stay below
      // 100000*32768 < 2^32. All seven exponent bits are sufficient for f32.
      for (let bit = 0; bit < 7; bit++) {
        const factor = word(Number((1n << BigInt(1 << bit)) % 100000n))
        branch(power.bitAnd(word(1 << bit)).greaterThan(word(0)), () => {
          const low = remainder(value.bitAnd(word(32767)).mul(factor), word(100000))
          const high = remainder(remainder(value.shiftRight(word(15)).mul(factor), word(100000)).mul(word(32768)), word(100000))
          value.assign(remainder(low.add(high), word(100000)))
        })
      }
      positive.assign(scalar(value))
    })
    result.assign(choose(point!.lessThan(0), positive.negate(), positive).add(correction(point!)))
  })
  return result
}).setLayout({ name: 'blendlinkExactNoiseCoordinateV1', type: 'float', inputs: [{ name: 'point', type: 'float' }] })
