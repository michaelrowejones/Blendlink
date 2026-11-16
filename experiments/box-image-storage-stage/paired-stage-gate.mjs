// SPDX-License-Identifier: GPL-3.0-or-later
// Additive acceptance of the unchanged diagnostic reader's declared positives.
import assert from 'node:assert/strict'

export function assertPairedStage(closed) {
  const apis = ['webgpu', 'webgl2'], images = ['Plaster-Overlay.png', 'Plaster-normal.png']
  const cases = ['plane-0', 'plane-1', 'plane-2', 'plane-3', 'source-Plane.021', 'source-Walls']
  assert.equal(closed.supportCredit, 0)
  assert.equal(closed.installedSceneCredit, 0)
  assert.equal(closed.fullArchvizCredit, 0)
  assert.equal(closed.bound, 2 ** -10)
  for (const field of ['nativeSha256', 'browserSha256']) assert.match(closed[field], /^[a-f0-9]{64}$/)
  const unique = rows => assert.equal(new Set(rows.map(r => JSON.stringify([r.api, r.id]))).size, rows.length)
  unique(closed.rows); unique(closed.lodRows)
  const one = (rows, where) => {
    const matches = rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value))
    assert.equal(matches.length, 1, 'Missing/duplicate capture: ' + JSON.stringify(where))
    return matches[0]
  }
  const pass = (row, exact, words) => {
    assert.equal(row.words, words)
    assert.equal(row.violations, 0)
    assert.ok(Number.isFinite(row.maxAbs) && row.maxAbs >= 0 && row.maxAbs <= (exact ? 0 : closed.bound))
    if (exact) assert.equal(row.differences, 0)
  }
  assert.equal(closed.lodRows.length, 44)
  for (const api of apis) for (const image of images) for (let level = 0; level < 11; level++)
    pass(one(closed.lodRows, { api, image, level, kind: 'linear' }), true, 256)
  assert.equal(closed.rows.length, 348)
  for (const api of apis) for (const name of cases) {
    pass(one(closed.rows, { api, case: name, profile: 'SNORM10', kind: 'input' }), true, 1024)
    for (const profile of ['SNORM10', 'SNORM16']) for (const kind of ['mask', 'normal', 'weights', 'face', 'position'])
      pass(one(closed.rows, { api, case: name, profile, kind }), ['mask', 'face'].includes(kind), 1024)
    for (const image of images) for (const frequency of [0.03125, 1, 8])
      pass(one(closed.rows, { api, case: name, image, frequency, profile: 'SNORM10', kind: 'sampler', policy: 'scene-aniso' }), false, 1024)
  }
  for (const api of apis) for (const policy of ['nomip', 'mip']) {
    const negative = closed.rows.filter(row => row.api === api && row.kind === 'sampler' && row.policy === policy)
    assert.equal(negative.length, 36)
    assert.ok(negative.some(row => row.violations > 0), 'Sampling negative no longer discriminates: ' + api + '/' + policy)
  }
  return { status: 'PAIRED_SAMPLING_STAGE_PASSED_NOT_MATERIAL_OR_SCENE_ACCEPTANCE',
    supportCredit: 0, installedSceneCredit: 0, fullArchvizCredit: 0,
    exactLodWords: 11264, sceneAnisotropicWords: 73728, bound: closed.bound }
}
