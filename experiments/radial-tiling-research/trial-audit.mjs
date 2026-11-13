// SPDX-License-Identifier: Apache-2.0
// Regenerate the compact private research receipt from retained, hash-checked data.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertActualApis } from './trial-domain.mjs'
const root = resolve(import.meta.dirname, '../..'), base = join(root, 'artifacts/radial')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = { proofRole: 'PRIVATE_RADIAL_KERNEL_TRIAL_NOT_PRODUCTION_ADMISSION', baseResearchCommit: 'aa2ee522dccd47a90138b2cc16bd48965f1e519b', publicOpcodes: 0, emittedPrograms: 0, finalSiteProofs: 0, numerical: {}, native: {}, cost: {}, failedCandidate: {} }
for (const profile of ['software', 'metal']) {
  const name = 'trial-final-portable-' + profile, bytes = await readFile(join(base, name, 'report.json')), data = JSON.parse(bytes)
  assert.equal(data.proofRole, 'PRIVATE_RADIAL_UNROUNDED_KERNEL_TRIAL'); assert.equal(data.status, 'bounded-candidate-passed-with-explicit-exclusions'); assert.equal(data.profile, profile); assert.equal(data.variant, 'portable-trig-v1')
  assertActualApis(data.initializations); assert.deepEqual(data.executions, [])
  for (const [file, pin] of Object.entries(data.sourcePins)) assert.equal(sha(await readFile(join(root, file))), pin)
  for (const row of data.rows) {
    assert.equal(row.failedSamples, 0)
    assert.equal(sha(await readFile(join(base, name, row.rawFile))), row.rawSha256)
    assert.equal(sha(await readFile(join(base, name, row.fragmentShaderFile))), row.fragmentShaderSha256)
  }
  receipt.numerical[profile] = { report: name + '/report.json', sha256: sha(bytes), sourcePins: data.sourcePins, candidate: data.candidate, kernelTolerance: data.kernelTolerance, nativeCarrierBudget: data.nativeCarrierBudget, actualApis: data.initializations, outputPlanes: data.rows.length, fieldPlanes: data.rows.filter(row => row.nativeSourceStage === 'native-shader-field').length, qualifiedScalarSamples: data.rows.reduce((n, row) => n + row.qualifiedSamples, 0), candidateFailures: 0, maximumCandidateError: Math.max(...data.rows.map(row => row.maximum)), nativeUnqualifiedSamples: data.rows.reduce((n, row) => n + row.nativeUnqualifiedSamples, 0), outsideCandidateSamples: data.rows.reduce((n, row) => n + row.outsideCandidateSamples, 0), rawNonfiniteSamples: data.rows.reduce((n, row) => n + row.rawNonfiniteSamples, 0), literalFailedSamples: data.rows.reduce((n, row) => n + row.literalFailedSamples, 0), literalFailureRows: data.rows.filter(row => row.literalFailedSamples).map(row => ({ id: row.id, nativeVersion: row.nativeVersion, backend: row.backend, nonfiniteSamples: row.rawNonfiniteSamples, maximumFiniteError: row.literalMaximum, rawFile: row.rawFile, sha256: row.rawSha256 })) }
  const costName = 'cost-final-portable-' + profile, costBytes = await readFile(join(base, costName, 'report.json')), cost = JSON.parse(costBytes)
  assert.equal(cost.status, 'completed-frame-cost-recorded'); assert.equal(cost.proofRole, 'PRIVATE_RADIAL_COMPLETED_FRAME_COST_TRIAL'); assert.equal(cost.rows.length, 0)
  assert.deepEqual(cost.costs.map(row => row.backend).sort(), ['webgl2', 'webgpu'])
  for (const [file, pin] of Object.entries(cost.sourcePins)) assert.equal(sha(await readFile(join(root, file))), pin)
  for (const api of cost.costs) for (const row of api.rows) assert.equal(sha(await readFile(join(base, costName, row.fragmentShaderFile))), row.fragmentShaderSha256)
  receipt.cost[profile] = { report: costName + '/report.json', sha256: sha(costBytes), role: cost.proofRole, concurrency: 'Team CPU/native/GPU work was held for this final capture; desktop idle state is not instrumented.', method: '10 submitted 1920x1080 RGBA32F draws plus one-pixel completion readback, three samples; wall-clock, not GPU timestamps or full-scene FPS.', actualApis: cost.initializations, rows: cost.costs.flatMap(api => api.rows.map(row => ({ backend: api.backend, mode: row.mode, firstCompletedMs: row.firstCompletedMs, completedFrameSamplesMs: row.completedFrameSamplesMs, medianCompletedFrameMs: row.medianCompletedFrameMs, fragmentShaderBytes: row.fragmentShaderBytes, fragmentShaderSha256: row.fragmentShaderSha256 }))) }
}
for (const version of ['52', '53']) {
  const directory = join(base, 'trial-reference' + version), bytes = await readFile(join(directory, 'index.json')), data = JSON.parse(bytes)
  assert.equal(data.fixtureSha256, sha(await readFile(join(import.meta.dirname, 'trial_reference.py')))); assert.equal(data.sourceReloadPreserved, true)
  for (const row of data.cases) for (const [file, hash] of [['decoded', 'sha256'], ['packed', 'packedSha256'], ['coarse', 'coarseSha256'], ['finiteBandMask', 'finiteBandMaskSha256']]) assert.equal(sha(await readFile(join(directory, row[file]))), row[hash])
  receipt.native[version] = { indexSha256: sha(bytes), fixtureSha256: data.fixtureSha256, nativeVersion: data.version, buildHash: data.buildHash, nativeGpuProfile: data.nativeGpuProfile, outputPlanes: data.cases.length, sourceBlendSha256: data.sourceBlendSha256, sourcePreserved: data.sourcePreserved, sourceReloadPreserved: true, calibrations: data.calibrations.map(row => ({ id: row.id, maximumError: row.maximumError, calibratedBound: row.calibratedBound })) }
}
const failedBytes = await readFile(join(base, 'trial-intrinsic-software-v3/report.json')), failed = JSON.parse(failedBytes)
assert.equal(failed.status, 'failed'); assert.equal(failed.variant, 'intrinsic-v1'); assert.equal(failed.kernelTolerance, 2e-5)
for (const row of failed.rows) assert.equal(sha(await readFile(join(base, 'trial-intrinsic-software-v3', row.rawFile))), row.rawSha256)
receipt.failedCandidate = { report: 'trial-intrinsic-software-v3/report.json', sha256: sha(failedBytes), status: failed.status, variant: failed.variant, outputPlanes: failed.rows.length, qualifiedFailures: failed.rows.reduce((n, row) => n + row.failedSamples, 0), maximumCandidateError: Math.max(...failed.rows.map(row => row.maximum)), actualApis: failed.initializations, note: 'Immutable original snapshot/raw pixels retained. Original Sides3/5 corpus; subsequent closed-API/provenance checks were added without changing this failed math candidate.' }
await writeFile(join(import.meta.dirname, 'trial-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log('BLENDLINK_RADIAL_RESEARCH_RECEIPT_VERIFIED', '1280 output-plane comparisons, production admission remains0')
