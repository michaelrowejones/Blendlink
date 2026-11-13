import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Independent IEEE integer identities, not a replacement native oracle.
const reciprocal = Math.fround(1 / 100000)
let cases = 0, quotientDisagreements = 0, negativeShaderRemainders = 0
const check = point => {
  point = Math.fround(point)
  if (Math.abs(point) < 2 ** 24 || Math.abs(point) >= 2 ** 31) return
  assert.equal(point, point | 0)
  const q = Math.trunc(Math.fround(point * reciprocal)), product = q * 100000
  assert.ok(Math.abs(product) <= 2147400000)
  const integer = (point | 0) - (product | 0)
  assert.ok(integer >= -2147483648 && integer <= 2147483647)
  // Exact integer operands/products are within53 bits; binary64 computes
  // the exact real fused remainder before the single requiredf32 rounding.
  const fused = Math.fround(point - product)
  assert.equal(integer, fused)
  const native = Number(BigInt(point) % 100000n)
  const mfQuotient = Math.trunc(point / 100000)
  assert.equal((point | 0) - (mfQuotient * 100000 | 0), native)
  quotientDisagreements += q !== mfQuotient
  negativeShaderRemainders += point > 0 && integer < 0
  cases++
}
for (let quotient = 167; quotient <= 21474; quotient++)
  for (const delta of [-256, -128, -96, -64, -32, -1, 0, 1, 32, 64, 96, 128, 256])
    for (const sign of [-1, 1]) check(sign * (quotient * 100000 + delta))
let state = 0x38532a19
for (let index = 0; index < 262144; index++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  const point = 2 ** 24 + state % (2 ** 31 - 2 ** 24 - 128)
  check(point); check(-point)
}
assert.ok(quotientDisagreements > 100 && negativeShaderRemainders > 0)
const report = { cases, quotientDisagreements, negativeShaderRemainders,
  minMagnitude: 2 ** 24, maxMagnitudeExclusive: 2 ** 31, fixedPositiveDivisor: 100000, reciprocal,
  nativeProofRequired: true, note: 'Arithmetic identity/control evidence; native stage selection is proved separately by actual EEVEE graphs.' }
if (process.argv[2]) { const directory = resolve(process.argv[2]); mkdirSync(directory, { recursive: true }); writeFileSync(directory + '/integer-controls.json', JSON.stringify(report, null, 2)) }
console.log('BLENDLINK_MATH_MODULO_INTEGER_CONTROLS_PASSED ' + JSON.stringify(report))
