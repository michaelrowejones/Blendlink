// SPDX-License-Identifier: Apache-2.0
// Private trial certificate, not production source admission.
import assert from 'node:assert/strict'

export const candidate = Object.freeze({ sidesMinimum: 3, sidesMaximum: 12, maximumAbsCoordinate: 2, minimumRadius: 2 ** -10, minimumSectorDistanceRadians: 2 ** -10, rejectNegativeZeroComponents: true })

export function qualifies(x, y, sides) {
  if (!Number.isInteger(sides) || sides < candidate.sidesMinimum || sides > candidate.sidesMaximum) return false
  if (![x, y].every(Number.isFinite) || Math.max(Math.abs(x), Math.abs(y)) > candidate.maximumAbsCoordinate || Object.is(x, -0) || Object.is(y, -0) || Math.hypot(x, y) < candidate.minimumRadius) return false
  const angle = Math.atan2(y, x) + (y < 0 ? 2 * Math.PI : 0), segment = 2 * Math.PI / sides
  const local = ((angle % segment) + segment) % segment
  return Math.min(local, segment - local) >= candidate.minimumSectorDistanceRadians
}

export function assertNativeStage(stage) {
  assert.ok(['image-field', 'literal'].includes(stage), 'Unknown native source stage cannot be treated as shader-field evidence')
}

export function assertActualApis(records) {
  for (const version of ['5.2.0', '5.3.0']) {
    const rows = records.filter(row => row.nativeVersion.join('.') === version)
    assert.equal(rows.length, 2, 'Each native source needs two actual APIs')
    assert.deepEqual(rows.map(row => row.backend).sort(), ['webgl2', 'webgpu'])
    for (const row of rows) assert.equal(row.backend, row.requestedBackend, 'Actual renderer must match requested API')
  }
}
