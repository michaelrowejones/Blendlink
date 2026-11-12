/* SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al. All Rights Reserved.
 * SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: BSD-3-Clause
 * SIMD Perlin fade adapted from Cycles kernel/svm/noise.h. */
/** Bounded float32 arithmetic for the native Cycles SIMD Perlin kernel.
 * Uses Dekker's exact product residual and TwoSum to emulate fused multiply-add
 * through WebGL2 as well as WebGPU. Operands come from finite fade/gradient
 * ranges; this is not a general overflow/subnormal FMA contract. */
import { bitcast, uint, float, select, Fn } from 'three/tsl'
import type { TslExpression, TslExprLike } from './tslNodeRecipe.js'
const cast = bitcast as unknown as (value: TslExprLike, type: string) => TslExpression
const integer = uint as unknown as (value: TslExprLike) => TslExpression
const scalar = float as unknown as (value: TslExprLike) => TslExpression
const choose = select as unknown as (test: TslExpression, yes: TslExprLike, no: TslExprLike) => TslExpression
const shader = Fn as unknown as (callback: (inputs: TslExpression[]) => TslExpression) =>
  ((...inputs: TslExpression[]) => TslExpression) & { setLayout(layout: unknown): (...inputs: TslExpression[]) => TslExpression }
const rounded = (value: TslExpression): TslExpression => {
  const bits = cast(value, 'uint').toVar()
  return cast(choose(bits.equal(integer(0x7fc00000)), integer(0), bits), 'float')
}
export const buildNativeNoiseFma = shader(([a, b, c]) => {
  const hi = (value: TslExpression): TslExpression => cast(cast(value, 'uint').bitAnd(integer(0xfffff000)), 'float')
  const ah = hi(a!), bh = hi(b!), al = rounded(a!.sub(ah)), bl = rounded(b!.sub(bh))
  const product = rounded(a!.mul(b!))
  const error = rounded(rounded(rounded(rounded(rounded(ah.mul(bh)).sub(product)).add(rounded(ah.mul(bl)))).add(rounded(al.mul(bh)))).add(rounded(al.mul(bl))))
  const sum = rounded(product.add(c!)), v = rounded(sum.sub(product))
  const carry = rounded(rounded(product.sub(rounded(sum.sub(v)))).add(rounded(c!.sub(v))))
  return rounded(sum.add(rounded(error.add(carry))))
}).setLayout({ name: 'blendlinkNativeNoiseFmaV1', type: 'float', inputs: [
  { name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'c', type: 'float' },
] })
export function nativeCpuPerlinFade(t: TslExpression): TslExpression {
  const a = buildNativeNoiseFma(t, scalar(6), scalar(-15)), b = buildNativeNoiseFma(t, a, scalar(10))
  return rounded(rounded(t.mul(t)).mul(rounded(t.mul(b))))
}
