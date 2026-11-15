/* SPDX-License-Identifier: MIT */
/** Research close for actual saved Final/public installed numeric evidence.
 * A trusted node-port adapter and complete failure matrix are still required. */
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { captureRuntimeProvenance, hash } from '../../scripts/lib/runtime-provenance.mjs'
import { validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
import { exactMetric, displayMetric } from '../compositor-displace-single/browser-contract.mjs'
const root = await realpath(resolve(import.meta.dirname, '../..'))
const args = process.argv.slice(2)
assert.equal(args.length, 8, 'Use verify-public.mjs NATIVE FINAL PUBLIC_NATIVE METAL_BASELINE SOFTWARE_BASELINE METAL_COMPARE SOFTWARE_COMPARE OUTPUT')
const [native, final, publicNative, metalBaseline, softwareBaseline, metalCompare, softwareCompare] = await Promise.all(args.slice(0, 7).map(path => realpath(resolve(path))))
const json = async path => JSON.parse(await readFile(path)), fingerprint = modules => hash(JSON.stringify(modules.map(m => ({ name: m.name, source: m.sourceSha256, built: m.emitterSha256 }))))
const helpers = { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') }
const publication = await json(join(final, 'final.json')), original = await json(join(native, 'native.json'))
assert.equal(publication.status, 'EXPORTED_LENS_HORIZONTAL_SAVED_ORIGINALS_ZERO_SUPPORT_CREDIT')
assert.equal(publication.nativeReportSha256, hash(await readFile(join(native, 'native.json')))); assert.equal(publication.sourcePreserved, true)
assert.equal(publication.supportCredit, 0); assert.equal(publication.browserCredit, 0); assert.equal(publication.rows.length, 4)
for (const row of publication.provenance) for (const file of [row.source, row.artifact]) assert.equal(hash(await readFile(file)), row.sha256)
for (const [i, row] of publication.rows.entries()) {
  assert.equal(row.moduleExport, 'lensFinal' + i); assert.equal(row.sourceFile, join(native, original.rows[i].sourceFile)); assert.equal(row.sourceSha256, original.rows[i].sourceSha256)
  for (const role of ['source', 'glb', 'module', 'manifest', 'presentation'])
    assert.equal(hash(await readFile(row[role + (role === 'source' ? 'File' : 'Path')])), row[role + 'Sha256'])
  const expected = (await json(join(native, original.rows[i].folder, original.rows[i].lens))).program
  const presentation = await json(row.presentationPath)
  for (const key of ['status', 'ops', 'passes', 'output']) assert.deepEqual(presentation.compositor[key], expected[key])
  assert.equal(presentation.display.view, 'Raw'); assert.deepEqual(presentation.display.ops, [])
}
await validateNativeArchive(await json(join(final, 'archive.json')), final, { expectedScripts: [
  { path: join(root, 'packages/blender-addon/tests/compositor_lens_horizontal_check.py'), invocations: 1 }],
  expectedFinalSources: publication.rows.map(row => row.sourceFile), helperInputs: helpers })
const references = await json(join(publicNative, 'native-public.json'))
assert.equal(references.status, 'CAPTURED_PUBLIC_LENS_CPU_REFERENCES_ZERO_SUPPORT_CREDIT')
assert.deepEqual(references.version, [5, 3, 0]); assert.equal(references.build, '02f0899d78e3')
assert.equal(references.nativeRenders, 32); assert.equal(references.rows.length, 16); assert.equal(references.gpuInitializations, 0)
assert.equal(references.ocioProcessorIsNoOp, true); assert.equal(references.supportCredit, 0); assert.equal(references.sceneBeautyCredit, 0); assert.equal(references.imageProducerCredit, 0)
assert.equal(references.displayContract, 'existing-ocio-png-clamp01-3e-5')
await validateNativeArchive(await json(join(publicNative, 'archive.json')), publicNative, { expectedScripts: [
  { path: join(root, 'experiments/compositor-lens-horizontal/reference-public.py'), invocations: 1 }], expectedFinalSources: [], helperInputs: helpers })
const { provenance } = await captureRuntimeProvenance({ root, built: true, label: 'Independent public Lens pilot close' })
const runtimeFingerprint = fingerprint(provenance.modules), baselines = [metalBaseline, softwareBaseline], comparisons = [metalCompare, softwareCompare]
let words = 0, frames = 0, displayWords = 0, displayWordDifferences = 0, maxDisplayAbsolute = 0
const checkedReports = []
for (const [index, directory] of comparisons.entries()) {
  const profile = index ? 'software' : 'metal', baseline = await json(join(baselines[index], 'report.json')), report = await json(join(directory, 'report.json'))
  for (const [value, phase] of [[baseline, 'baseline'], [report, 'compare']]) {
    assert.equal(value.phase, phase); assert.equal(value.profile, profile); assert.equal(value.status, 'LENS_HORIZONTAL_ALL_APIS_PILOT_PASSED_ZERO_CREDIT')
    assert.equal(value.publicationSha256, hash(await readFile(join(final, 'final.json')))); assert.equal(fingerprint(value.provenance.modules), runtimeFingerprint)
    assert.equal(value.supportCredit, 0); assert.equal(value.savedFinalCredit, 0); assert.deepEqual(value.apis.map(api => api.backend), ['webgpu', 'webgl2'])
  }
  for (const module of report.provenance.modules) assert.equal(hash(await readFile(join(directory, 'runtime', module.name + '.js'))), module.testedSnapshotSha256)
  for (const api of report.apis) {
    const baselineApi = baseline.apis.find(row => row.backend === api.backend)
    assert.equal(api.status, 'LENS_PUBLIC_COMPARE_PASSED_ZERO_CREDIT'); assert.equal(api.rows.length, 12); assert.equal(api.callerRestored, true)
    assert.equal(api.supportCredit, 0); assert.equal(api.productionCredit, false); assert.deepEqual(api.errors, []); assert.deepEqual(api.pageErrors, []); assert.deepEqual(api.httpErrors, [])
    assert.equal(api.gpu.api, api.backend === 'webgpu' ? 'WebGPU' : 'WebGL2')
    if (profile === 'metal') { assert.match(JSON.stringify(api.gpu), /apple|metal/i); assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i) }
    else assert.match(JSON.stringify(api.gpu), /swiftshader/i)
    assert.equal(baselineApi.status, 'LENS_PUBLIC_BASELINE_PASSED_ZERO_CREDIT'); assert.equal(baselineApi.rows.length, 4)
    for (const [i, row] of api.rows.entries()) {
      const entry = publication.rows[Math.floor(i / 3)], control = baselineApi.rows[Math.floor(i / 3)]
      assert.equal(row.moduleExport, entry.moduleExport); assert.equal(row.cycle, i % 3)
      assert.equal(row.id, [profile, api.backend, entry.moduleExport, row.width + 'x' + row.height].join('--'))
      assert.equal(row.id, control.id); assert.equal(row.width, entry.width); assert.equal(row.height, entry.height)
      const reference = references.rows.find(r => r.id === row.id); assert.ok(reference)
      assert.equal(control.scenePassType, 'HalfFloatType'); assert.equal(control.scenePassSamples, 0); assert.equal(control.actualExportedProgram, true)
      assert.equal(hash(await readFile(control.baselinePixelsFile)), control.baselinePixelsSha256)
      assert.equal(control.baselinePixelsSha256, reference.baselineSha256)
      const buffers = {}
      for (const role of ['baseline', 'linear', 'display']) {
        const bytes = await readFile(reference[role + 'File']); assert.equal(hash(bytes), reference[role + 'Sha256'])
        assert.equal(bytes.length, row.width * row.height * 16); buffers[role] = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
      }
      const nativeCopy = await json(join(publicNative, row.id, 'blender-5-3-cpu-copy.json'))
      assert.deepEqual(new Uint32Array(new Float32Array(nativeCopy.expected).buffer), buffers.baseline)
      for (const role of ['linear', 'display']) {
        const file = row[role + 'PixelsFile'], bytes = await readFile(file)
        assert.equal(await realpath(file), await realpath(join(directory, api.backend + '-' + i + '.' + role + 'Pixels.rgba32f')))
        assert.equal(hash(bytes), row[role + 'PixelsSha256']); assert.equal(bytes.length, row.width * row.height * 16)
        const actual = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
        if (role === 'linear') { assert.deepEqual(actual, buffers.linear); assert.equal(row.wordDifferences, 0); words += actual.length }
        else {
          const metric = displayMetric(actual, buffers.display); assert.deepEqual(metric, row.display); assert.equal(metric.projectionAccepted, true)
          displayWords += actual.length; displayWordDifferences += metric.wordDifferences; maxDisplayAbsolute = Math.max(maxDisplayAbsolute, metric.maxClampedAbsoluteError)
        }
      }
      assert.equal(row.sameFrame, true); assert.equal(row.actualExportedProgram, true); assert.equal(row.probeDraws, 2)
      assert.ok(Number.isInteger(row.installedDraws) && row.installedDraws >= 1 && row.installedDraws <= 16); frames++
    }
  }
  checkedReports.push({ profile, sha256: hash(await readFile(join(directory, 'report.json'))) })
}
assert.equal(frames, 48); assert.equal(words, 41760); assert.equal(displayWords, words)
const result = { status: 'LENS_HORIZONTAL_PUBLIC_INSTALLED_PILOT_CLOSED_ZERO_SUPPORT_CREDIT', savedFinalScenes: 4,
  actualInputFrames: 16, nativeReferenceRenders: 32, installedCases: frames, exactLinearWords: words, linearWordDifferences: 0,
  displayWords, displayWordDifferences, maxDisplayClampedAbsoluteError: maxDisplayAbsolute,
  displayContract: 'existing-ocio-png-clamp01-3e-5', runtimeFingerprint, checkedReports,
  finalReportSha256: hash(await readFile(join(final, 'final.json'))), nativeReferenceSha256: hash(await readFile(join(publicNative, 'native-public.json'))),
  supportCredit: 0, productionCredit: false, supportPromotion: false, trustedAutomaticQualification: false }
await writeFile(resolve(args[7]), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result))
