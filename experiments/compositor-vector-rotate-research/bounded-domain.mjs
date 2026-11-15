/* SPDX-License-Identifier: MIT */
// Research-only host contract. No source admission or renderer support.
const storage = new ArrayBuffer(4), floats = new Float32Array(storage), words = new Uint32Array(storage)
export const F = Math.fround
export function word(value) { floats[0] = value; return words[0] }
export function fromWord(value) { words[0] = value; return floats[0] }
export function literal(value) {
  const bits = word(value), magnitude = bits & 0x7fffffff
  return Number.isFinite(value) && F(value) === value && bits !== 0x80000000
    && (magnitude === 0 || Math.abs(value) >= 2 ** -16 && Math.abs(value) <= 16)
}
export function coefficient(value) {
  return Number.isFinite(value) && F(value) === value
    && (value === 0 || Math.abs(value) >= 2 ** -63 && Math.abs(value) <= 2)
}
export function stagedMatvec(vector, center, columns, observe = () => {}) {
  if (vector.length !== 3 || center.length !== 3 || columns.length !== 3
    || ![...vector, ...center].every(literal)
    || !columns.every(column => column.length === 3 && column.every(coefficient)))
    throw Error('Vector Rotate research requires bounded raw Float32 inputs and reviewed coefficients')
  const stage = value => { const result = F(value); observe(result); return result }
  const delta = vector.map((value, lane) => stage(value - center[lane]))
  return [0, 1, 2].map(lane => {
    const products = columns.map((column, index) => stage(column[lane] * delta[index]))
    return stage(stage(stage(products[0] + products[1]) + products[2]) + center[lane])
  })
}

/** A Float32 word is a multiple of 2^power without floating-point division. */
export function onLattice(value, power) {
  const bits = word(value), exponent = (bits >>> 23) & 255, fraction = bits & 0x7fffff
  if (exponent === 255) return false
  if (exponent === 0 && fraction === 0) return true
  const significand = BigInt(exponent ? fraction | 0x800000 : fraction)
  const shift = (exponent ? exponent - 127 - 23 : -149) - power
  return shift >= 0 || significand % (1n << BigInt(-shift)) === 0n
}
