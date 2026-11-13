import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'

const { Fn, Loop, bitcast, int, select, uint } = TSL as unknown as Record<
  'Fn' | 'Loop' | 'bitcast' | 'int' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>

/** Correctly rounded square root of a nonnegative finite Float32 value.
 * Normalize x=M*2^(e-23), then take 24 radix-four digits of the exact integer
 * radicand M*2^(23+(e mod 2)). The remainder never exceeds 25 bits (27 before
 * subtraction), so two input uint words and uint32 arithmetic suffice.
 * For floor root q, nearest rounding increments iff remainder>q:
 * (q+1/2)^2-q^2=q+1/4; an integer radicand cannot be an exact half-way tie.
 * There are no floating arithmetic intermediates or intrinsic sqrt estimates.
 * This does not recover subnormals already lost by upstream GPU arithmetic. */
export const compositorCpuSqrt = Fn(([value]: TslEffectNode[]) => {
  const word = bitcast(value, 'uint').toVar(), field = word.shiftRight(uint(23)).bitAnd(uint(255)).toVar()
  const zero = word.bitAnd(uint(0x7fffffff)).equal(uint(0)).toVar()
  const mantissa = word.bitAnd(uint(0x7fffff)).toVar(), exponent = int(field).sub(int(127)).toVar()
  const subnormal = field.equal(uint(0))
  mantissa.assign(select(subnormal, select(zero, uint(0x800000), mantissa), mantissa.bitOr(uint(0x800000))))
  exponent.assign(select(subnormal, select(zero, int(0), int(-126)), exponent))
  for (const shift of [16, 8, 4, 2, 1]) {
    const move = mantissa.lessThan(uint(2 ** (24 - shift))).toVar()
    mantissa.assign(select(move, mantissa.shiftLeft(uint(shift)), mantissa))
    exponent.assign(select(move, exponent.sub(int(shift)), exponent))
  }
  const parity = uint(exponent.bitAnd(int(1))).toVar(), shift = parity.add(uint(23)).toVar()
  const high = mantissa.shiftRight(uint(32).sub(shift)).toVar(), low = mantissa.shiftLeft(shift).toVar()
  const root = uint(0).toVar(), remainder = uint(0).toVar()
  Loop({ start: int(0), end: int(24), type: 'int', name: 'digit' }, ({ digit }: TslEffectNode) => {
    const firstWord = digit.lessThan(int(8)).toVar()
    const highShift = select(firstWord, uint(14).sub(uint(digit).mul(uint(2))), uint(0))
    const lowShift = select(firstWord, uint(0), uint(46).sub(uint(digit).mul(uint(2))))
    const pair = select(firstWord, high.shiftRight(highShift), low.shiftRight(lowShift)).bitAnd(uint(3))
    remainder.assign(remainder.shiftLeft(uint(2)).bitOr(pair))
    const trial = root.shiftLeft(uint(2)).bitOr(uint(1)).toVar(), take = remainder.greaterThanEqual(trial).toVar()
    remainder.assign(select(take, remainder.sub(trial), remainder))
    root.assign(root.shiftLeft(uint(1)).bitOr(select(take, uint(1), uint(0))))
  })
  const roundedRoot = root.add(select(remainder.greaterThan(root), uint(1), uint(0)))
  const halfExponent = exponent.sub(int(parity)).div(int(2))
  const result = uint(halfExponent.add(int(127))).shiftLeft(uint(23)).add(roundedRoot.sub(uint(0x800000)))
  return bitcast(select(zero, word, result), 'float')
}).setLayout({ name: 'blendlinkCompositorCpuSqrtV1', type: 'float', inputs: [{ name: 'value', type: 'float' }] })
