// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { assertActualApis, assertNativeStage, qualifies } from './trial-domain.mjs'

test('witnessed native sector, origin and signed-zero cases remain outside the trial', () => {
  assert.equal(qualifies(-.8090168833732605, .5877854228019714, 5), false)
  assert.equal(qualifies(0, 0, 5), false)
  assert.equal(qualifies(1, -0, 5), false)
  assert.equal(qualifies(-0, 1, 5), false)
  assert.equal(qualifies(1, 0, 5), false)
  assert.equal(qualifies(2 ** -20, 2 ** -20, 5), false)
  assert.equal(qualifies(1, .25, 5), true)
  assert.equal(qualifies(.25, 1, 12), true)
})

test('finite input/range proof cannot be replaced by annotations or coercion', () => {
  for (const [x, y, sides] of [[Infinity, 1, 5], [NaN, 1, 5], [1, undefined, 5], ['1', .25, 5], [1, .25, '5'], [1, .25, 2], [1, .25, 5.5], [1, .25, 13], [2.0001, .25, 5]]) assert.equal(qualifies(x, y, sides), false)
  assertNativeStage('image-field'); assertNativeStage('literal')
  for (const stage of ['default', 'native-mf', 'shader', undefined]) assert.throws(() => assertNativeStage(stage))
})

test('fallback WebGL2 cannot impersonate two actual API comparisons', () => {
  const records = [5.2, 5.3].flatMap(n => ['webgpu', 'webgl2'].map(backend => ({ nativeVersion: [5, Math.round((n - 5) * 10), 0], requestedBackend: backend, backend })))
  assertActualApis(records)
  assert.throws(() => assertActualApis(records.map(row => ({ ...row, backend: 'webgl2' }))))
  assert.throws(() => assertActualApis(records.slice(0, 3)))
})
