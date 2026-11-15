import assert from 'node:assert/strict'
import test from 'node:test'
import { blend, samplerCases, weightCases } from './cases.mjs'

test('research corpus keeps actual stored blend and genuine off-axis/sign/tie controls', () => {
  assert.equal(new Uint32Array(new Float32Array([blend]).buffer)[0], 1036787358)
  assert.ok(weightCases.filter(c => c.normal.every(n => n !== 0)).length >= 10)
  for (let i = 0; i < 3; i++) for (const sign of [-1, 1])
    assert.ok(weightCases.some(c => c.normal[i] === sign && c.normal.filter(n => n !== 0).length === 1))
  assert.ok(weightCases.some(c => c.normal.every(n => n === 1)))
  assert.equal(new Set(samplerCases.map(c => c.id)).size, samplerCases.length)
  assert.equal(samplerCases.length, 48)
})
