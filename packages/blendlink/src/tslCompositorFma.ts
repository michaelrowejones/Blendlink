const F = Math.fround

// A Float32 product is exact in binary64. On the rare double-rounding boundary,
// use integer IEEE significands to round the fused multiply/add exactly once.
const bits = new DataView(new ArrayBuffer(4))
function parts(value: number): [bigint, number] {
  bits.setFloat32(0, value, false)
  const word = bits.getUint32(0, false), exponent = (word >>> 23) & 255
  return [BigInt((word & 0x7fffff) + (exponent ? 0x800000 : 0)) * (word >>> 31 ? -1n : 1n),
    exponent ? exponent - 150 : -149]
}
export function compositorFma32(a: number, b: number, c: number): number {
  const wide = a * b + c, rounded = F(wide)
  if (!Number.isFinite(rounded) || rounded === 0 || rounded === wide) return rounded
  bits.setFloat32(0, rounded, false)
  const word = bits.getUint32(0, false), direction = wide > rounded ? 1 : -1
  bits.setUint32(0, word + (rounded > 0 ? direction : -direction), false)
  const neighbor = bits.getFloat32(0, false)
  if ((rounded + neighbor) * .5 !== wide) return rounded
  const [am, ae] = parts(a), [bm, be] = parts(b), [cm, ce] = parts(c)
  const exponent = Math.min(ae + be, ce)
  let exact = (am * bm << BigInt(ae + be - exponent)) + (cm << BigInt(ce - exponent))
  const negative = exact < 0n
  if (negative) exact = -exact
  const shift = Math.max(0, exact.toString(2).length - 24, -149 - exponent)
  let head = exact >> BigInt(shift)
  if (shift) {
    const remainder = exact - (head << BigInt(shift)), half = 1n << BigInt(shift - 1)
    if (remainder > half || remainder === half && (head & 1n) !== 0n) head++
  }
  return (negative ? -1 : 1) * Number(head) * 2 ** (exponent + shift)
}

