import * as TSL from 'three/tsl'
import type { TslEffectNode } from './tslPostEffects.js'
const { Fn, If, bitcast, float, int, select, uint } = TSL as unknown as Record<
  'Fn' | 'If' | 'bitcast' | 'float' | 'int' | 'select' | 'uint', (...values: TslEffectNode[]) => TslEffectNode>
const magnitude = (word: TslEffectNode) => word.bitAnd(uint(0x7fffffff))
const exponent = (word: TslEffectNode) => word.shiftRight(uint(23)).bitAnd(uint(255))
const sign = (word: TslEffectNode) => word.bitAnd(uint(0x80000000))
const asFloat = (word: TslEffectNode) => bitcast(word, 'float')
const asWord = (value: TslEffectNode) => bitcast(value, 'uint').toVar()

export function lumaNormalizeWord(word: TslEffectNode) {
  const e = exponent(word).toVar(), zero = magnitude(word).equal(uint(0))
  const mantissa = select(zero, uint(0x800000), word.bitAnd(uint(0x7fffff))
    .bitOr(select(e.equal(uint(0)), uint(0), uint(0x800000)))).toVar()
  const power = select(e.equal(uint(0)), int(-126), int(e).sub(127)).toVar()
  for (const shift of [16, 8, 4, 2, 1]) {
    const take = mantissa.lessThan(uint(2 ** (24 - shift))).toVar()
    mantissa.assign(select(take, mantissa.shiftLeft(uint(shift)), mantissa))
    power.subAssign(select(take, int(shift), int(0)))
  }
  return { mantissa, power, zero }
}

/** Private binary32 gradual product. 12-bit limbs retain the exact 48-bit
 * significand product; integer remainder comparisons perform one RNE rounding,
 * including underflow. Ordinary normal products use hardware in the wrapper. */
const productBits = Fn(([a, b]: TslEffectNode[]) => {
  const x = lumaNormalizeWord(a), y = lumaNormalizeWord(b)
  const x0 = x.mantissa.bitAnd(uint(4095)), x1 = x.mantissa.shiftRight(uint(12))
  const y0 = y.mantissa.bitAnd(uint(4095)), y1 = y.mantissa.shiftRight(uint(12))
  const p0 = x0.mul(y0).toVar(), middle = x0.mul(y1).add(x1.mul(y0)).add(p0.shiftRight(uint(12))).toVar()
  const upper = x1.mul(y1).add(middle.shiftRight(uint(12))).toVar()
  const lower = p0.bitAnd(uint(4095)).bitOr(middle.bitAnd(uint(4095)).shiftLeft(uint(12))).toVar()
  const lo = lower.bitOr(upper.bitAnd(uint(255)).shiftLeft(uint(24))).toVar()
  const hi = upper.shiftRight(uint(8)).toVar(), high = upper.greaterThanEqual(uint(0x800000)).toVar()
  const power = x.power.add(y.power).add(select(high, int(1), int(0))).toVar()
  const base = select(high, int(24), int(23)), underflow = power.lessThan(int(-126))
  const shift = base.add(select(underflow, int(-126).sub(power), int(0))).toVar()
  // Every inactive shift remains defined, including products far below minsub.
  const small = select(shift.greaterThan(int(31)), int(31), shift).toVar()
  const q0 = select(shift.equal(int(32)), hi,
    lo.shiftRight(uint(small)).bitOr(hi.shiftLeft(uint(int(32).sub(small))))).toVar()
  const rem0 = select(shift.equal(int(32)), lo, lo.bitAnd(uint(1).shiftLeft(uint(small)).sub(uint(1)))).toVar()
  const half0 = select(shift.equal(int(32)), uint(0x80000000), uint(1).shiftLeft(uint(small.sub(1))))
  const round0 = rem0.greaterThan(half0).or(rem0.equal(half0).and(q0.bitAnd(uint(1)).notEqual(uint(0))))
  const rawLarge = shift.sub(32), large = select(rawLarge.lessThan(int(1)), int(1),
    select(rawLarge.greaterThan(int(16)), int(16), rawLarge)).toVar()
  const q1 = hi.shiftRight(uint(large)).toVar(), rem1 = hi.bitAnd(uint(1).shiftLeft(uint(large)).sub(uint(1))).toVar()
  const half1 = uint(1).shiftLeft(uint(large.sub(1)))
  const round1 = rem1.greaterThan(half1).or(rem1.equal(half1).and(lo.notEqual(uint(0))
    .or(q1.bitAnd(uint(1)).notEqual(uint(0)))))
  const tooSmall = shift.greaterThan(int(48)), wide = shift.greaterThan(int(32))
  const q = select(tooSmall, uint(0), select(wide, q1, q0))
  const up = select(tooSmall, false, select(wide, round1, round0))
  const rounded = q.add(select(up, uint(1), uint(0))).toVar()
  const packed = select(underflow, rounded, select(power.greaterThan(int(127)), uint(0x7f800000),
    uint(power.add(127)).shiftLeft(uint(23)).add(rounded.sub(uint(0x800000)))))
  return select(x.zero.or(y.zero), uint(0), packed).bitOr(sign(a).bitXor(sign(b)))
}).setLayout({ name: 'blendlinkLumaGradualProductBitsV1', type: 'uint', inputs: [
  { name: 'a', type: 'uint' }, { name: 'b', type: 'uint' },
] })

export const lumaGradualMultiplyBits = Fn(([a, b]: TslEffectNode[]) => {
  const raw = asWord(asFloat(a).mul(asFloat(b)))
  const aAbs = magnitude(a), bAbs = magnitude(b), aExp = exponent(a), bExp = exponent(b)
  const tiny = aExp.equal(uint(0)).and(aAbs.notEqual(uint(0))).or(bExp.equal(uint(0)).and(bAbs.notEqual(uint(0))))
    .or(exponent(raw).equal(uint(0)).and(aAbs.notEqual(uint(0))).and(bAbs.notEqual(uint(0))))
  const exceptional = aExp.equal(uint(255)).or(bExp.equal(uint(255)))
  // Keep the integer fallback outside the ordinary normal-pixel path. A
  // select would evaluate both arguments on WGSL and erase this fast path.
  const product = raw.toVar()
  If(tiny.and(exceptional.not()), () => { product.assign(productBits(a, b)) })
  const finite = select(aAbs.equal(uint(0)).or(bAbs.equal(uint(0))), sign(a).bitXor(sign(b)), product)
  const infinity = uint(0x7f800000).bitOr(sign(a).bitXor(sign(b)))
  const nan = aAbs.greaterThan(uint(0x7f800000)).or(bAbs.greaterThan(uint(0x7f800000)))
  return select(exceptional, select(nan.or(aAbs.equal(uint(0))).or(bAbs.equal(uint(0))), raw, infinity), finite)
}).setLayout({ name: 'blendlinkLumaGradualMultiplyBitsV1', type: 'uint', inputs: [
  { name: 'a', type: 'uint' }, { name: 'b', type: 'uint' },
] })

function scaledTiny(word: TslEffectNode): TslEffectNode {
  const e = exponent(word), safe = select(e.greaterThan(uint(26)), uint(26), e)
  const tiny = asWord(float(word.bitAnd(uint(0x7fffff))).mul(2 ** -49)).bitOr(sign(word))
  const normal = word.bitAnd(uint(0x807fffff)).bitOr(safe.add(uint(100)).shiftLeft(uint(23)))
  return asFloat(select(e.equal(uint(0)), tiny, normal))
}

/** Below2^-100, scaling by2^100 keeps every possible sum normal on the GPU.
 * A subnormal final sum is an exact integer multiple of2^-149 with at most23
 * significant bits, so its integer descale loses no rounding information. */
const tinySumBits = Fn(([a, b]: TslEffectNode[]) => {
  const sum = asWord(scaledTiny(a).add(scaledTiny(b))), e = exponent(sum)
  const rawShift = int(101).sub(int(e)), shift = select(rawShift.lessThan(int(1)), int(1),
    select(rawShift.greaterThan(int(24)), int(24), rawShift))
  const subnormal = sum.bitAnd(uint(0x7fffff)).bitOr(uint(0x800000)).shiftRight(uint(shift)).bitOr(sign(sum))
  const normal = sum.sub(uint(100 << 23))
  return select(magnitude(sum).equal(uint(0)), sum, select(e.greaterThan(uint(100)), normal, subnormal))
}).setLayout({ name: 'blendlinkLumaGradualTinySumBitsV1', type: 'uint', inputs: [
  { name: 'a', type: 'uint' }, { name: 'b', type: 'uint' },
] })

export const lumaGradualAddBits = Fn(([a, b]: TslEffectNode[]) => {
  const aAbs = magnitude(a), bAbs = magnitude(b), aZero = aAbs.equal(uint(0)), bZero = bAbs.equal(uint(0))
  const raw = asWord(asFloat(a).add(asFloat(b)))
  const tiny = exponent(a).lessThanEqual(uint(26)).and(exponent(b).lessThanEqual(uint(26)))
  const sum = raw.toVar()
  If(tiny, () => { sum.assign(tinySumBits(a, b)) })
  return select(aZero.and(bZero), sign(a).bitAnd(sign(b)), select(aZero, b, select(bZero, a,
    select(magnitude(sum).equal(uint(0)), uint(0), sum))))
}).setLayout({ name: 'blendlinkLumaGradualAddBitsV1', type: 'uint', inputs: [
  { name: 'a', type: 'uint' }, { name: 'b', type: 'uint' },
] })

/** IEEE finite ordering, including gradual operands and equality of±zero. */
export function lumaGradualLess(a: TslEffectNode, b: TslEffectNode): TslEffectNode {
  const aa = magnitude(a), bb = magnitude(b), negativeA = sign(a).notEqual(uint(0)), negativeB = sign(b).notEqual(uint(0))
  return aa.lessThanEqual(uint(0x7f800000)).and(bb.lessThanEqual(uint(0x7f800000)))
    .and(aa.notEqual(uint(0)).or(bb.notEqual(uint(0))))
    .and(select(negativeA.notEqual(negativeB), negativeA, select(negativeA, aa.greaterThan(bb), aa.lessThan(bb))))
}

/** Coefficients are the independently validated native Rec.709 Float32 tuple. */
export const lumaGradualDotBits = Fn(([color, weights]: TslEffectNode[]) => {
  const p = ['r', 'g', 'b'].map(channel => lumaGradualMultiplyBits(asWord(color[channel]), asWord(weights[channel])))
  return lumaGradualAddBits(lumaGradualAddBits(p[0], p[1]), p[2])
}).setLayout({ name: 'blendlinkLumaGradualDotBitsV1', type: 'uint', inputs: [
  { name: 'color', type: 'vec3' }, { name: 'weights', type: 'vec3' },
] })
