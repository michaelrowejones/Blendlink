/* SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al. All Rights Reserved.
 * SPDX-FileCopyrightText: 2011-2022 Blender Foundation
 * SPDX-FileCopyrightText: 2026 Blendlink contributors
 * SPDX-License-Identifier: BSD-3-Clause
 * The product residual follows tslNativeNoisePrecision; affine coordinates also
 * retain the second residual through halfway/sticky-bit rounding. */
import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, abs, bitcast, float, select, uint } = TSL as unknown as Record<
  'Fn' | 'abs' | 'bitcast' | 'float' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>
const rounded = (value: TslEffectNode): TslEffectNode => {
  const bits = bitcast(value, 'uint').toVar()
  return bitcast(select(bits.equal(uint(0x7fc00000)), uint(0), bits), 'float').toVar()
}
const twoSum = (a: TslEffectNode, b: TslEffectNode): [TslEffectNode, TslEffectNode] => {
  const sum = rounded(a.add(b)), virtual = rounded(sum.sub(a))
  const carry = rounded(rounded(a.sub(rounded(sum.sub(virtual)))).add(rounded(b.sub(virtual))))
  return [sum, carry]
}

/** Affine-only finite coordinate FMA. Callers qualify matrix coefficients and
 * constant offsets (zero or |x|>=2^-50), half-integer pixel operands<=8192.5,
 * and bounded composed matrices. This is not an overflow/subnormal FMA API. */
export const buildCompositorCoordinateFma = Fn(([a, b, c]: TslEffectNode[]) => {
  const high = (value: TslEffectNode): TslEffectNode => bitcast(bitcast(value, 'uint').bitAnd(uint(0xfffff000)), 'float').toVar()
  const ah = high(a), bh = high(b), al = rounded(a.sub(ah)), bl = rounded(b.sub(bh))
  const product = rounded(a.mul(b))
  const error = rounded(rounded(rounded(rounded(rounded(ah.mul(bh)).sub(product))
    .add(rounded(ah.mul(bl)))).add(rounded(al.mul(bh)))).add(rounded(al.mul(bl))))
  const [sum, carry] = twoSum(product, c)
  const [residual, low] = twoSum(error, carry)
  const [first, firstCarry] = twoSum(sum, residual)
  const [tail, sticky] = twoSum(firstCarry, low)
  // Renormalize after cancellation before comparing the exact residual to the
  // next Float32 midpoint. Rounding away this sticky term changes a texel phase.
  const [candidate, lastCarry] = twoSum(first, tail)
  const [remaining, last] = twoSum(lastCarry, sticky)
  const word = bitcast(candidate, 'uint').toVar(), magnitude = word.bitAnd(uint(0x7fffffff)).toVar()
  const upward = remaining.greaterThan(0).or(remaining.equal(0).and(last.greaterThan(0)))
  const increasingWord = upward.equal(candidate.greaterThanEqual(0))
  const neighborWord = select(magnitude.equal(0), select(upward, uint(1), uint(0x80000001)),
    select(increasingWord, word.add(uint(1)), word.sub(uint(1))))
  const neighbor = bitcast(neighborWord, 'float').toVar()
  const midpointDistance = rounded(abs(neighbor.sub(candidate)).mul(.5))
  const stickyAway = remaining.greaterThan(0).and(last.greaterThan(0))
    .or(remaining.lessThan(0).and(last.lessThan(0)))
  const tieToEven = last.equal(0).and(word.bitAnd(uint(1)).notEqual(uint(0)))
  const cross = abs(remaining).greaterThan(midpointDistance)
    .or(abs(remaining).equal(midpointDistance).and(stickyAway.or(tieToEven)))
  return select(magnitude.equal(0), rounded(remaining.add(last)), select(cross, neighbor, candidate))
}).setLayout({ name: 'blendlinkCompositorCoordinateFmaV1', type: 'float', inputs: [
  { name: 'a', type: 'float' }, { name: 'b', type: 'float' }, { name: 'c', type: 'float' },
] })
