import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, Loop, bitcast, int, select, uint } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'bitcast' | 'int' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>

/** Distance-only correctly rounded nonnegative ratio. The caller proves a=0
 * or a>=2^-74, a<=16, and 1/64<=d<=1, so the result is normal or zero.
 * Normalize 24-bit significands to [1,2), then emit 23 fractional quotient
 * bits using integer restoring division. Remainders fit 25 bits. Exact RNE
 * compares twice the final remainder to the divisor, including ties-to-even. */
export const compositorCpuDistanceRatio = Fn(([value, divisor]: TslEffectNode[]) => {
  const a = bitcast(value, 'uint').toVar(), d = bitcast(divisor, 'uint').toVar()
  const numerator = a.bitAnd(uint(0x7fffff)).bitOr(uint(0x800000)).toVar()
  const denominator = d.bitAnd(uint(0x7fffff)).bitOr(uint(0x800000)).toVar()
  const shifted = numerator.lessThan(denominator).toVar()
  const exponent = int(a.shiftRight(uint(23))).sub(int(d.shiftRight(uint(23))))
    .sub(select(shifted, int(1), int(0))).toVar()
  const remainder = select(shifted, numerator.shiftLeft(uint(1)), numerator).sub(denominator).toVar()
  const quotient = uint(1).toVar()
  Loop({ start: int(0), end: int(23), type: 'int', name: 'ratioDigit' }, () => {
    remainder.assign(remainder.shiftLeft(uint(1)))
    const take = remainder.greaterThanEqual(denominator).toVar()
    remainder.assign(select(take, remainder.sub(denominator), remainder))
    quotient.assign(quotient.shiftLeft(uint(1)).bitOr(select(take, uint(1), uint(0))))
  })
  const twice = remainder.shiftLeft(uint(1)).toVar()
  const roundUp = twice.greaterThan(denominator).or(twice.equal(denominator).and(quotient.bitAnd(uint(1)).notEqual(uint(0))))
  const rounded = quotient.add(select(roundUp, uint(1), uint(0)))
  const result = uint(exponent.add(int(127))).shiftLeft(uint(23)).add(rounded.sub(uint(0x800000)))
  return bitcast(select(a.bitAnd(uint(0x7fffffff)).equal(uint(0)), a, result), 'float')
}).setLayout({ name: 'blendlinkCompositorCpuDistanceRatioV1', type: 'float', inputs: [
  { name: 'value', type: 'float' }, { name: 'divisor', type: 'float' },
] })
