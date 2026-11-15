/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import test from 'node:test'
import {word} from './bounded-domain.mjs'
import {exactNormalizedWord, normalizedCoordinate, normalizedRows} from './normalized-rows.mjs'

test('host half-center division agrees with independent integer RNE at odd, common, dyadic and boundary extents', () => {
  for (const extent of [1, 2, 3, 4, 5, 7, 13, 19, 511, 1920, 4095, 4096, 8191, 8192])
    for (let index = 0; index < extent; index++)
      assert.equal(word(normalizedCoordinate(index, extent)), exactNormalizedWord(index, extent), `${extent}:${index}`)
})

test('two row storage preserves independent rectangular extents and positive-zero padding', () => {
  for (const [width, height] of [[13, 9], [9, 13], [8192, 4], [4, 8192], [1920, 1080]]) {
    const rows = normalizedRows(width, height), stride = Math.max(width, height)
    assert.equal(rows.length, stride * 2)
    assert.ok(rows.byteLength <= 65536)
    for (let x = 0; x < width; x++) assert.equal(word(rows[x]), exactNormalizedWord(x, width))
    for (let y = 0; y < height; y++) assert.equal(word(rows[stride + y]), exactNormalizedWord(y, height))
    for (let x = width; x < stride; x++) assert.equal(word(rows[x]), 0)
    for (let y = height; y < stride; y++) assert.equal(word(rows[stride + y]), 0)
  }
})

test('refuses unsupported extents and indices without changing existing owner bounds', () => {
  for (const pair of [[1, 4], [4, 2], [8193, 4], [4, 8193], [4.5, 4], [NaN, 4]])
    assert.throws(() => normalizedRows(...pair), /physical extents/)
  for (const pair of [[-1, 4], [4, 4], [.5, 4], [0, 0], [0, 8193]])
    assert.throws(() => normalizedCoordinate(...pair), /pixel within extent/)
})
