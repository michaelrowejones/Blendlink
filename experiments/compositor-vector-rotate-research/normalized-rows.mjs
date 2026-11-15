/* SPDX-License-Identifier: MIT */
// Research-only private consumer rows. The old Normalized producer is unchanged.
import {F, word} from './bounded-domain.mjs'
function validatePixel(index, extent) {
  if (!Number.isInteger(extent) || extent < 1 || extent > 8192
    || !Number.isInteger(index) || index < 0 || index >= extent)
    throw Error('Normalized coordinate research requires a pixel within extent [1,8192]')
}
export function normalizedCoordinate(index, extent) { validatePixel(index, extent); return F((index + .5) / extent) }
export function normalizedRows(width, height) {
  // Match the existing owned row resource; do not widen its physical domain.
  if (![width, height].every(value => Number.isInteger(value) && value >= 4 && value <= 8192))
    throw Error('Normalized row research requires physical extents [4,8192]')
  const stride = Math.max(width, height), rows = new Float32Array(stride * 2)
  for (let x = 0; x < width; x++) rows[x] = normalizedCoordinate(x, width)
  for (let y = 0; y < height; y++) rows[stride + y] = normalizedCoordinate(y, height)
  return rows
}
/** Independent integer round-to-nearest-even of the exact half-center ratio. */
export function exactNormalizedWord(index, extent) {
  // Validate separately from the arithmetic under test.
  validatePixel(index, extent)
  const numerator = BigInt(index * 2 + 1), denominator = BigInt(extent * 2)
  let exponent = -1
  while ((numerator << BigInt(-exponent)) < denominator) exponent--
  const scaled = numerator << BigInt(23 - exponent)
  let significand = scaled / denominator
  const remainder = scaled % denominator
  if (remainder * 2n > denominator || remainder * 2n === denominator && significand % 2n !== 0n) significand++
  if (significand === 1n << 24n) { significand >>= 1n; exponent++ }
  return ((exponent + 127) * 0x800000 + Number(significand - (1n << 23n))) >>> 0
}
export function assertExactNormalized(index, extent) {
  if (word(normalizedCoordinate(index, extent)) !== exactNormalizedWord(index, extent))
    throw Error('Normalized coordinate research failed exact rational rounding')
}
