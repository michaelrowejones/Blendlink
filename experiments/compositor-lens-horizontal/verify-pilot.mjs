/* SPDX-License-Identifier: MIT */
/** Independently close archived research words; never promote a node/Final. */
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureRuntimeProvenance, hash } from '../../scripts/lib/runtime-provenance.mjs'
import { validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
const root = await realpath(resolve(import.meta.dirname, '../..'))
const [nativeArg, policyArg, metalArg, softwareArg, outputArg, ...extra] = process.argv.slice(2)
assert.ok(outputArg && !extra.length, 'Use verify-pilot.mjs NATIVE POLICY METAL SOFTWARE OUTPUT')
const native = await realpath(resolve(nativeArg)), policy = await realpath(resolve(policyArg)), reports = [await realpath(resolve(metalArg)), await realpath(resolve(softwareArg))]
const json = async path => JSON.parse(await readFile(path))
const helperInputs = { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') }
const expectedExtents = [[8, 8], [13, 9], [17, 13], [26, 18]]
const n = await json(join(native, 'native.json'))
assert.equal(n.status, 'CAPTURED_LENS_HORIZONTAL_CPU_PILOT_ZERO_CREDIT')
assert.deepEqual(n.version, [5, 3, 0]); assert.equal(n.build, '02f0899d78e3')
assert.equal(n.nativeRenders, 8); assert.equal(n.gpuInitializations, 0); assert.equal(n.supportCredit, 0)
assert.deepEqual(n.rows.map(row => [row.width, row.height]), expectedExtents)
await validateNativeArchive(await json(join(native, 'archive.json')), native, {
  expectedScripts: [{ path: join(root, 'experiments/compositor-lens-horizontal/reference.py'), invocations: 1 }], expectedFinalSources: [], helperInputs,
})
const source = await json(join(policy, 'policy.json'))
assert.equal(source.status, 'PASSED_LENS_HORIZONTAL_SOURCE_ONLY'); assert.equal(source.supportCredit, 0)
assert.deepEqual(source.policy.positive, ['classroom-original-controls', 'rerouted-output'])
assert.equal(source.policy.refusals.length, 14); assert.equal(source.policy.nativeRenders, 0); assert.equal(source.policy.gpuInitializations, 0)
assert.deepEqual(source.policy.blockedPolicyCalls, { gpu: 0, render: 0 })
assert.equal(hash(await readFile(join(policy, 'archive.json'))), source.archiveSha256)
for (const [file, sha256] of Object.entries(source.sourcePins)) assert.equal(hash(await readFile(join(root, file))), sha256)
await validateNativeArchive(await json(join(policy, 'archive.json')), policy, {
  expectedScripts: [{ path: join(root, 'packages/blender-addon/tests/compositor_lens_horizontal_check.py'), invocations: 1 }], expectedFinalSources: [], helperInputs,
})
const cases = []
for (const row of n.rows) {
  assert.equal(row.folder, row.width + 'x' + row.height); assert.equal(row.sourceFile, row.folder + '/saved-original.blend')
  assert.equal(hash(await readFile(join(native, row.sourceFile))), row.sourceSha256)
  const records = []
  for (const role of ['copy', 'lens']) {
    assert.equal(row[role], 'blender-5-3-cpu-' + role + '.json')
    const bytes = await readFile(join(native, row.folder, row[role])); assert.equal(hash(bytes), row[role + 'Sha256'])
    const record = JSON.parse(bytes)
    assert.equal(record.width, row.width); assert.equal(record.height, row.height)
    assert.equal(record.blenderHash, '02f0899d78e3'); assert.equal(record.compositorDevice, 'CPU'); assert.equal(record.colorSpace, 'scene-linear')
    assert.equal(record.input.length, row.width * row.height * 4); assert.equal(record.expected.length, record.input.length)
    records.push(record)
  }
  const [copy, lens] = records
  assert.deepEqual(new Uint32Array(new Float32Array(copy.expected).buffer), new Uint32Array(new Float32Array(copy.input).buffer))
  assert.deepEqual(lens.input, copy.input)
  const op = lens.program.ops.find(item => item.source.nodeType === 'CompositorNodeLensdist')
  assert.deepEqual(op.properties.lens_horizontal_controls, ['Horizontal', 0, 0x3e4ccccd, false, false])
  cases.push(new Uint32Array(new Float32Array(lens.expected).buffer))
}
const { provenance } = await captureRuntimeProvenance({ root, built: true, label: 'Independent horizontal lens pilot close' })
const fingerprint = modules => hash(JSON.stringify(modules.map(m => ({ name: m.name, source: m.sourceSha256, built: m.emitterSha256 }))))
const runtimeFingerprint = fingerprint(provenance.modules), browserReports = []
let words = 0, frames = 0
for (const [profileIndex, directory] of reports.entries()) {
  const reportBytes = await readFile(join(directory, 'report.json')), report = JSON.parse(reportBytes), profile = profileIndex ? 'software' : 'metal'
  assert.equal(report.profile, profile); assert.equal(report.status, 'LENS_HORIZONTAL_ALL_APIS_PILOT_PASSED_ZERO_CREDIT')
  assert.equal(report.nativeReportSha256, hash(await readFile(join(native, 'native.json'))))
  assert.equal(report.supportCredit, 0); assert.equal(report.savedFinalCredit, 0)
  assert.equal(fingerprint(report.provenance.modules), runtimeFingerprint)
  for (const module of report.provenance.modules)
    assert.equal(hash(await readFile(join(directory, 'runtime', module.name + '.js'))), module.testedSnapshotSha256)
  assert.deepEqual(report.apis.map(api => api.backend), ['webgpu', 'webgl2'])
  for (const api of report.apis) {
    assert.equal(api.status, 'LENS_HORIZONTAL_BROWSER_PILOT_PASSED_ZERO_CREDIT'); assert.equal(api.rows.length, 12); assert.equal(api.resizeFrames, 12)
    assert.equal(api.gpu.api, api.backend === 'webgpu' ? 'WebGPU' : 'WebGL2')
    if (profile === 'metal') { assert.match(JSON.stringify(api.gpu), /apple|metal/i); assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i) }
    else assert.match(JSON.stringify(api.gpu), /swiftshader/i)
    assert.equal(api.supportCredit, 0); assert.equal(api.savedFinalCredit, 0); assert.equal(api.ownedTextures, 4); assert.equal(api.remainingOwnedTextures, 0)
    assert.equal(api.recovery, true); assert.match(api.invalidTargetRefusal, /Horizontal Lens Distortion.*full-frame/)
    for (const key of ['errors', 'pageErrors', 'httpErrors']) assert.deepEqual(api[key], [])
    for (const [i, row] of api.rows.entries()) {
      const index = i % 4, expected = cases[index]
      assert.equal(row.cycle, Math.floor(i / 4)); assert.deepEqual([row.width, row.height], expectedExtents[index])
      assert.equal(row.file, api.backend + '-' + i + '.rgba32f'); assert.equal(row.words, expected.length); assert.equal(row.wordDifferences, 0)
      const bytes = await readFile(join(directory, row.file)); assert.equal(hash(bytes), row.sha256); assert.equal(bytes.length, expected.byteLength)
      const actual = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
      assert.deepEqual(actual, expected, `${profile}/${api.backend}/${i} archived native words differ`)
      words += actual.length; frames++
    }
  }
  browserReports.push({ profile, sha256: hash(reportBytes) })
}
assert.equal(frames, 48); assert.equal(words, 41760)
const result = { status: 'LENS_HORIZONTAL_SAMPLING_PILOT_CLOSED_ZERO_SUPPORT_CREDIT', nativeGraphs: 4, nativeRenders: 8,
  sourcePolicy: { positive: 2, refusals: 14 }, browserCaseRuns: frames, comparedFloat32Words: words,
  wordDifferences: 0, ownedTexturesPerInstance: 4, remainingOwnedTextures: 0, runtimeFingerprint, browserReports,
  sourcePolicySha256: hash(await readFile(join(policy, 'policy.json'))), nativeReportSha256: hash(await readFile(join(native, 'native.json'))),
  supportCredit: 0, savedFinalCredit: 0, productionCredit: false, supportPromotion: false }
await writeFile(resolve(outputArg), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
