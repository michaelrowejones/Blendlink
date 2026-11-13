import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
import { lumaNormalizeWord } from './tslCompositorLumaGradual.js'
const { Fn, Loop, bitcast, int, select, uint } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'bitcast' | 'int' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>

/** Luma-only RNE ratio: 0<=a<=1, including gradual subnormal words, and
 * 1/64<=d<=1. The quotient is finite. Normalize significands with integer
 * shifts; emit only the fractional digits representable at the actual output
 * exponent, then round the exact remainder once (including gradual results). */
export const compositorCpuLuminanceRatioBits = Fn(([a, d]: TslEffectNode[]) => {
  const x = lumaNormalizeWord(a), y = lumaNormalizeWord(d), numerator = x.mantissa, denominator = y.mantissa
  const shifted = numerator.lessThan(denominator).toVar()
  const exponent = x.power.sub(y.power).sub(select(shifted, int(1), int(0))).toVar()
  const digits = select(exponent.greaterThanEqual(int(-126)), int(23), exponent.add(int(149))).toVar()
  const remainder = select(shifted, numerator.shiftLeft(uint(1)), numerator).sub(denominator).toVar()
  const quotient = uint(1).toVar()
  Loop({ start: int(0), end: digits, type: 'int', name: 'lumaRatioDigit' }, () => {
    remainder.assign(remainder.shiftLeft(uint(1)))
    const take = remainder.greaterThanEqual(denominator).toVar()
    remainder.assign(select(take, remainder.sub(denominator), remainder))
    quotient.assign(quotient.shiftLeft(uint(1)).bitOr(select(take, uint(1), uint(0))))
  })
  const twice = remainder.shiftLeft(uint(1)).toVar()
  const roundUp = twice.greaterThan(denominator).or(twice.equal(denominator).and(quotient.bitAnd(uint(1)).notEqual(uint(0))))
  const rounded = quotient.add(select(roundUp, uint(1), uint(0)))
  const normal = uint(exponent.add(int(127))).shiftLeft(uint(23)).add(rounded.sub(uint(0x800000)))
  return select(x.zero, a, select(exponent.lessThan(int(-126)), rounded, normal))
}).setLayout({ name: 'blendlinkCompositorCpuLuminanceRatioBitsV1', type: 'uint', inputs: [
  { name: 'a', type: 'uint' }, { name: 'd', type: 'uint' },
] })

/** Normal-or-zero Float32 entry used by the explicitly FTZ source model. */
export const compositorCpuLuminanceRatio = Fn(([value, divisor]: TslEffectNode[]) =>
  bitcast(compositorCpuLuminanceRatioBits(bitcast(value, 'uint'), bitcast(divisor, 'uint')), 'float'))
  .setLayout({ name: 'blendlinkCompositorCpuLuminanceRatioV1', type: 'float', inputs: [
    { name: 'value', type: 'float' }, { name: 'divisor', type: 'float' },
  ] })
