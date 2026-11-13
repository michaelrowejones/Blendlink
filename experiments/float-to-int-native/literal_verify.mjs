// Verify complete native -> saved Final -> built browser receipts without
// granting credit to the earlier private kernels, controls or absent versions.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { hash } from '../../scripts/lib/runtime-provenance.mjs'
import { assertLiteralFinal, assertLiteralQualification } from './literal_protocol.mjs'

const root = resolve(import.meta.dirname, '../..')
const directory = resolve(process.argv[2] ?? join(root, 'artifacts/float-to-int'))
const output = resolve(process.argv[3] ?? join(directory, 'literal-built-qualification.json'))
const read = async path => JSON.parse(await readFile(path, 'utf8'))
const pin = async (path, expected) => assert.equal(hash(await readFile(path)), expected, 'Proof input changed: ' + path)
const receipts = [], nativeReceipts = []
let builtCaseRuns = 0
for (const device of ['CPU', 'GPU']) {
  const folder = join(directory, 'literal53-' + device.toLowerCase())
  const nativePath = join(folder, 'qualification.json')
  const native = assertLiteralQualification(await read(nativePath))
  assert.equal(native.device, device)
  for (const [path, digest] of Object.entries(native.sourceHashes)) await pin(join(root, path), digest)
  for (const row of native.cases) {
    await pin(join(folder, row.programFile), row.programSha256)
    await pin(join(folder, row.pixelFile), row.pixelSha256)
    if (row.sourceFile) await pin(join(folder, row.sourceFile), row.sourceSha256)
  }
  const finalPath = join(folder, 'final-proof.json')
  const final = assertLiteralFinal(await read(finalPath), native, { built: true, nativeSha256: hash(await readFile(nativePath)) })
  nativeReceipts.push({ device, qualification: { path: relative(root, nativePath), sha256: hash(await readFile(nativePath)) },
    final: { path: relative(root, finalPath), sha256: hash(await readFile(finalPath)) },
    nativeGraphs: native.cases.length, savedFinalScenes: final.rows.length, sourceHashes: native.sourceHashes, exporterInputs: final.provenance })
  for (const entry of final.provenance) {
    await pin(join(root, entry.source), entry.sha256)
    await pin(join(root, entry.artifact), entry.sha256)
  }
  for (const row of final.rows) for (const key of ['manifest', 'glb', 'presentation']) await pin(row[key + 'Path'], row[key + 'Sha256'])
  for (const profile of ['metal', 'software']) for (const phase of ['raw', 'final']) {
    const path = join(folder, 'browser-' + phase + '-' + profile, 'report.json')
    const report = await read(path)
    assert.equal(report.status, 'PASSED_LITERAL_BUILT_PROOF')
    assert.equal(report.built, true); assert.equal(report.final, phase === 'final')
    assert.equal(report.profile, profile); assert.equal(report.sourceDevice, device)
    assert.equal(report.provenance.nativeQualificationSha256, hash(await readFile(nativePath)))
    if (phase === 'final') assert.equal(report.provenance.finalProofSha256, hash(await readFile(finalPath)))
    await pin(join(import.meta.dirname, 'literal_run.mjs'), report.provenance.runnerSha256)
    await pin(join(import.meta.dirname, 'literal_protocol.mjs'), report.provenance.protocolSha256)
    for (const [name, digest] of Object.entries(report.provenance.fixturePins)) await pin(join(import.meta.dirname, name), digest)
    assert.ok(report.provenance.modules.length > 100)
    for (const module of report.provenance.modules) {
      assert.equal(module.emitterMatchesSource, true)
      await pin(join(root, 'packages/blendlink/src', module.name + '.ts'), module.sourceSha256)
      await pin(join(report.provenance.snapshot.directory, module.name + '.js'), module.testedSnapshotSha256)
    }
    assert.equal(report.missingAdapterControl.refused, true)
    assert.deepEqual(report.rows.map(row => row.backend).sort(), ['webgl2', 'webgpu'])
    const wanted = (phase === 'final' ? final.rows : native.cases).map(row => row.case).sort()
    for (const row of report.rows) {
      assert.equal(row.gpu.api, row.backend === 'webgpu' ? 'WebGPU' : 'WebGL2')
      const identity = JSON.stringify(row.gpu)
      if (profile === 'metal') { assert.match(identity, /apple|metal/i); assert.doesNotMatch(identity, /swiftshader/i) }
      else assert.match(identity, /swiftshader/i)
      assert.deepEqual(row.errors, []); assert.deepEqual(row.pageErrors, [])
      assert.deepEqual(row.rows.map(result => result.case).sort(), wanted)
      for (const result of row.rows) {
        assert.equal(result.wordMismatches, 0); assert.equal(result.remainingTextures, 0)
        if (phase === 'final') {
          assert.equal(result.pinRejected, true); assert.ok(result.meshCount > 0)
          assert.equal(result.pipeline, 'blender-compositor'); assert.equal(result.sourceMaterialsPreserved, true)
        }
      }
      assert.equal(row.negatives.length, 10)
      assert.equal(new Set(row.negatives.map(result => result.kind)).size, 10)
      for (const negative of row.negatives) {
        assert.match(negative.error, /Float to Integer/); assert.equal(negative.remainingTextures, 0)
      }
      builtCaseRuns += row.rows.length
    }
    receipts.push({ path: relative(root, path), sha256: hash(await readFile(path)), sourceDevice: device, profile, phase,
      browserVersion: report.browserVersion, apis: report.rows.map(row => ({ backend: row.backend, gpu: row.gpu, cases: row.rows.length })) })
  }
}
assert.equal(builtCaseRuns, 1376)
const result = { status: 'QUALIFIED_LITERAL_BUILT_PORT',
  sourceProfile: 'Blender 5.3.0 02f0899d78e3 macOS arm64 native CPU MF, including GPU single values',
  nativeGraphs: 312, savedFinalScenes: 32, builtCaseRuns, primaryFloat32Words: builtCaseRuns * 8 * 8 * 4,
  wordMismatches: 0, nativeReceipts, receipts,
  reviewedInputs: Object.fromEntries(await Promise.all(['packages/blendlink/src/tslCompositorFloatToInt.ts',
    'packages/blendlink/src/tslSourceCompositor.ts', 'experiments/float-to-int-native/literal_export.test.ts',
    'experiments/float-to-int-native/literal_run.mjs', 'experiments/float-to-int-native/literal_browser.js',
    'experiments/float-to-int-native/literal_protocol.mjs', 'experiments/float-to-int-native/literal_verify.mjs']
    .map(async path => [path, hash(await readFile(join(root, path)))]))),
  upstream: (await read(join(import.meta.dirname, 'sources.json'))).primarySources.filter(source => source.revision === '02f0899d78e3'),
  refusalChecks: { distinctCasesPerApiTransaction: 10, missingWebGpuAdapterRefused: true, resourcesAllocatedByRefusals: 0,
    cases: ['model', 'version', 'source-profile', 'evaluator', 'subnormal', 'nonfinite', 'f64', 'magnitude', 'color-conversion', 'depth'] },
  rawArtifacts: { machineLocal: true, ignored: true, directory: 'artifacts/float-to-int', immutableRuntimeSnapshotsCommitted: false },
  reproduction: { native: 'BLENDLINK_FLOAT_TO_INT_REFERENCES=<cpu-or-gpu-directory> BLENDLINK_FLOAT_TO_INT_DEVICE=<CPU-or-GPU> BLENDLINK_FLOAT_TO_INT_ADDON=$PWD/packages/blendlink/dist/addon <Blender-5.3> --background --factory-startup -t 1 --python-exit-code 1 --python packages/blender-addon/tests/compositor_float_to_int_check.py',
    final: 'BLENDLINK_FLOAT_TO_INT_REFERENCES=<directory> BLENDLINK_FLOAT_TO_INT_BUILT=1 BLENDLINK_BLENDER=<Blender-5.3> node node_modules/vitest/vitest.mjs run experiments/float-to-int-native/literal_export.test.ts',
    browser: 'BLENDLINK_FLOAT_TO_INT_REFERENCES=<directory> BLENDLINK_TEST_PROFILE=<metal-or-software> node experiments/float-to-int-native/literal_run.mjs --built [--final]',
    verify: 'node experiments/float-to-int-native/literal_verify.mjs artifacts/float-to-int experiments/float-to-int-native/literal-evidence.json' },
  scope: 'Partial compositor port: literal/group/Value constants only, exact normal-or-zero Float32 within +/-2^24; all four modes. No image, field, shader-context or general-platform qualification.',
  performance: 'No per-frame readback, owned textures or render targets in this opcode. Literal resolution is bounded to 2048 operations, depth 8 and 64 input visits. Browser disposal and reapply are checked; no FPS claim.' }
await writeFile(output, JSON.stringify(result, null, 2) + '\n')
console.log('SCENETOWEB_FLOAT_TO_INT_QUALIFIED ' + JSON.stringify({ nativeGraphs: result.nativeGraphs, savedFinalScenes: result.savedFinalScenes, builtCaseRuns, wordMismatches: 0 }))
