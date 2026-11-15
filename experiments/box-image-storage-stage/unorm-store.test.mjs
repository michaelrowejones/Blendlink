// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateMipModels as original } from './model-check.mjs'
import { evaluateMipModels as corrected } from './model-check-unorm-store.mjs'
import { roundEven } from './mip-model-unorm-store.mjs'

test('a Float32 normalized input is above the half threshold before an invented extra rounding', () => {
    const input = Math.fround(.5 / 255), scaled = input * 255
    assert.ok(scaled > .5)
    assert.equal(Math.fround(scaled), .5)
    assert.equal(roundEven(scaled), 1)
    assert.equal(roundEven(Math.fround(scaled)), 0)
})

const native = process.env.BOX_STORAGE_NATIVE
test('single normalized-store correction closes every sampled Non-Color LOD while retaining sRGB failures', { skip: native ? false : 'Requires immutable storage-stage native artifacts' }, async () => {
    const before = await original(native), after = await corrected(native)
    const rows = result => result.rows.filter(row => row.model === 'native-paired-shared-srgb')
    const normal = rows(after).filter(row => row.image === 'Plaster-normal.png')
    assert.equal(normal.length, 11)
    assert.ok(normal.every(row => row.violations === 0))
    assert.ok(normal.every(row => row.maxAbs < .000287))
    for (const level of [1, 3, 5, 7]) assert.ok(rows(before).find(row => row.image === 'Plaster-normal.png' && row.level === level).violations > 0)
    const srgb = result => rows(result).filter(row => row.image === 'Plaster-Overlay.png')
    assert.deepEqual(srgb(after), srgb(before))
    assert.ok(srgb(after).some(row => row.violations > 0))
    assert.equal(after.supportCredit, 0)
    assert.ok(after.fetchBaseAlias.every(row => row.violations === 0))
})
