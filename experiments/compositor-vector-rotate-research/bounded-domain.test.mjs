/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import test from 'node:test'
import {coefficient, F, fromWord, literal, onLattice, stagedMatvec, word} from './bounded-domain.mjs'

test('rejects raw signed zero, subnormals, wide literals and coefficients outside the proposed bound', () => {
  for (const value of [-0, fromWord(1), 2 ** -17, 32, Infinity, NaN, .1]) assert.equal(literal(value), false)
  for (const value of [0, 2 ** -16, -(2 ** -16), F(.1), 16, -16]) assert.equal(literal(value), true)
  for (const value of [2 ** -64, -(2 ** -64), 4, Infinity, NaN]) assert.equal(coefficient(value), false)
  for (const value of [0, -0, 2 ** -63, -(2 ** -63), F(.3), 2, -2]) assert.equal(coefficient(value), true)
})

test('the proposed input/coefficient lattices keep every staged result normal or zero', () => {
  // Include cancellation, adjacent Float32 values, signs and both endpoints.
  const values = [0, 2 ** -16, -(2 ** -16), fromWord(word(2 ** -16) + 1),
    F(.1), F(-.1), 1, fromWord(word(1) - 1), 16, -16]
  const coefficients = [0, -0, 2 ** -63, -(2 ** -63), fromWord(word(2 ** -63) + 1), F(.3), F(-.3), 1, -1, 2, -2]
  let stages = 0
  for (const a of values) for (const b of values) for (const c of coefficients) {
    assert.ok(onLattice(a, -39)); assert.ok(onLattice(b, -39)); assert.ok(onLattice(c, -86))
    const output = stagedMatvec([a, b, a], [b, a, b], [[c, c, c], [-c, c, -c], [c, -c, c]], value => {
      stages++
      assert.ok(onLattice(value, -125))
      assert.ok(value === 0 || Math.abs(value) >= 2 ** -126)
      assert.ok(Number.isFinite(value) && Math.abs(value) <= 208)
    })
    for (const value of output) assert.notEqual(word(value), 0x80000000)
  }
  assert.equal(stages, 23100)
})

test('internal zero coefficient signs do not change the bounded final words', () => {
  const vectors = [[0, 0, 0], [F(.1), F(-.1), 1], [2 ** -16, 16, -16]]
  const centers = [[0, 0, 0], [F(.1), F(-.1), 1], [-(2 ** -16), 16, -16]]
  for (const vector of vectors) for (const center of centers) {
    const expected = stagedMatvec(vector, center, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]).map(word)
    for (let signs = 0; signs < 64; signs++) {
      let bit = 0
      const columns = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(column => column.map(value =>
        value === 0 ? signs & 1 << bit++ ? -0 : 0 : value))
      assert.deepEqual(stagedMatvec(vector, center, columns).map(word), expected)
    }
  }
})

test('a bounded coordinate error remains observable through an exact identity matrix', () => {
  const native = F(.1), browser = fromWord(word(native) + 1)
  assert.ok(Math.abs(native - browser) <= 2 ** -22)
  assert.equal(word(browser) - word(native), 1)
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const a = stagedMatvec([native, 0, 0], [0, 0, 0], identity)
  const b = stagedMatvec([browser, 0, 0], [0, 0, 0], identity)
  assert.notDeepEqual(a.map(word), b.map(word))
})

test('basis-output admission alone cannot establish the true-coefficient premise', () => {
  // A materialization that flushes a tiny coefficient could expose a zero.
  // This is a counterexample to the inference, not a claim about this native MF.
  const internal = 2 ** -140, exposed = 0
  assert.equal(coefficient(internal), false)
  assert.equal(coefficient(exposed), true)
  assert.notEqual(word(internal), word(exposed))
})
