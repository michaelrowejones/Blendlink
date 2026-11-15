// Same-pixel Lens family adapter, following the shared owned-family contract.
import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { executeNodePortCommand, nodePortHash } from './node-port-contract.mjs'
import { assertClosedFamilyNativeIdentity } from './node-port-family-evidence.mjs'
export const LENS_HORIZONTAL_FAMILY = 'compositor-lens-horizontal'
const json = async path => JSON.parse(await readFile(path))
export function assertLensHorizontalControls(sampling, installed) {
  assert.deepEqual(sampling.controls.map(c => c.case), ['pixel-budget-before-rtt', 'mismatched-target', 'offset-target', 'scissor-target', 'source-extent', 'saved-original-dispose'])
  for (const c of sampling.controls.slice(0, 5)) {
    assert.equal(c.recovered, true); assert.equal(c.allocationPastPixelBudget, false); assert.equal(c.numericalCredit, 0)
    assert.match(c.error, c.case === 'pixel-budget-before-rtt' ? /Horizontal Lens Distortion.*pixel budget/
      : c.case === 'source-extent' ? /Lens Distortion.*matching source\/render image extents/ : /Horizontal Lens Distortion.*full-frame/)
  }
  const saved = sampling.controls[5]; assert.equal(saved.ownedTextures, 4); assert.deepEqual(saved.physicalDestroys, [1, 1, 1, 1]); assert.equal(saved.numericalCredit, 0)
  assert.match(saved.error, /Horizontal Lens Distortion.*(?:available renderer|allocation epoch changed)/)
  assert.deepEqual(sampling.rows.map(r => r.pixelRatio), [1, 1.25, 1, 2, 1, 1.25, 1, 2, 1, 1.25, 1, 2])
  assert.deepEqual(installed.controls.map(c => c.case), ['detached-dispose', 'cancel-before-ready'])
  for (const c of installed.controls) { assert.equal(c.callerRestored, true); assert.equal(c.numericalCredit, 0) }
  assert.equal(installed.controls[1].errorName, 'AbortError')
}
export function assertLensHorizontalScope({ manifest, profile, completedRuns = profile.runs }) {
  assert.equal(manifest.id, LENS_HORIZONTAL_FAMILY); assert.equal(manifest.nativeNode, 'CompositorNodeLensdist'); assert.equal(manifest.domain, 'compositor'); assert.equal(manifest.lifecycle, 'production')
  assert.deepEqual(manifest.evidence, { adapter: 'compositor-lens-horizontal-v1', productionCases: 4, calibrationCases: 0, refusedNativeCases: 0 })
  assert.equal(profile.id, 'mac-53'); assert.deepEqual(profile.hostPlatforms, ['darwin']); assert.equal(profile.blenderVersion, '5.3.0'); assert.equal(profile.blenderBuildHash, '02f0899d78e3'); assert.equal(profile.expectedStatus, undefined)
  assert.deepEqual(profile.nativeSource, { profile: 'darwin-arm64-53-lens-horizontal-cpu-v1', backend: null, evaluator: 'CPU-compositor' })
  assert.deepEqual(profile.runs.map(r => [r.id, r.adapter, r.args ?? []]), [['matrix', 'matrix', []]]); assert.deepEqual(completedRuns, profile.runs)
}
export function assertLensHorizontalReceipt(value) {
  const expected = { status: 'QUALIFIED_PARTIAL_HORIZONTAL_LENS_CPU_FINAL', supportCredit: 0, nativeGraphs: 4, savedFinalScenes: 4,
    nativeSamePixelCases: 20, nativeRenders: 40, browserCaseRuns: 48, primaryFloat32Words: 41760, supportingSamplingCases: 48, supportingSamplingWords: 41760,
    exactLinearWordDifferences: 0, resizeFrames: 48, installedCycles: 48, guardRefusals: 20, savedDisposeCases: 4, detachedDisposals: 4, cancellations: 4, uniqueActualPythonPrefixes: 8 }
  for (const [key, v] of Object.entries(expected)) assert.equal(value[key], v, key)
  for (const [key, python, final] of [['policy', 1, 0], ['native', 1, 0], ['final', 5, 4], ['publicNative', 1, 0]])
    assert.deepEqual(value.archives[key], { pythonInvocations: python, finalInvocations: final, uniqueCachePrefixes: python })
  assert.deepEqual(value.sourcePolicy, { positive: 2, refusals: 14, numericalCredit: 0 })
  for (const key of ['sampling', 'public']) assert.match(value.closedReaders[key], /^[a-f0-9]{64}$/)
  assert.equal(value.displayAudit.words, 41760); assert.equal(value.displayAudit.limit, 3e-5); assert.equal(value.displayAudit.bitExactClaim, false)
  assert.equal(value.displayAudit.alphaWordDifferences, 0); assert.equal(value.displayAudit.nonfiniteClassDifferences, 0)
  assert.ok(value.displayAudit.maxClampedAbsoluteError >= 0 && value.displayAudit.maxClampedAbsoluteError <= 3e-5)
  assert.match(value.runtimeFingerprint, /^[a-f0-9]{64}$/); assert.match(value.inputDigest, /^[a-f0-9]{64}$/)
  assert.deepEqual(value.runs.map(r => r.profile), ['metal', 'software'])
  for (const run of value.runs) { assert.deepEqual(run.apis.map(api => api.backend), ['webgpu', 'webgl2']); for (const api of run.apis) { assert.equal(api.cases, 12); assert.equal(api.gpu.api, api.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'); assert.match(JSON.stringify(api.gpu), run.profile === 'metal' ? /apple|metal/i : /swiftshader/i); if (run.profile === 'metal') assert.doesNotMatch(JSON.stringify(api.gpu), /swiftshader/i) } }
  return value
}
export function lensHorizontalSuitePlan({ root, evidence, blender }) {
  return { argv: [process.execPath, join(root, 'experiments/compositor-lens-horizontal/matrix.mjs'), join(evidence, 'proof')],
    env: { BLENDLINK_BLENDER: blender, SCENETOWEB_RUNTIME_TRANSACTION: null, SCENETOWEB_RUNTIME_TRANSACTION_SHA256: null, SCENETOWEB_NATIVE_IDENTITY_POLICY: 'per-invocation-sha256-v1' }, timeoutMs: 1200000 }
}
export function lensHorizontalReaderCommand({ root, evidence, output }) {
  return { argv: [process.execPath, join(root, 'experiments/compositor-lens-horizontal/verify.mjs'), join(evidence, 'proof'), output],
    env: { SCENETOWEB_RUNTIME_TRANSACTION: null, SCENETOWEB_RUNTIME_TRANSACTION_SHA256: null }, timeoutMs: 300000 }
}
export async function runLensHorizontalSuite(options) {
  const { root, evidence } = options, path = join(evidence, 'suite-matrix.json'); await assert.rejects(readFile(path), { code: 'ENOENT' })
  const result = await executeNodePortCommand({ ...lensHorizontalSuitePlan(options), cwd: root, logPath: join(evidence, 'family-matrix.log') })
  assert.equal(result.exitCode, 0, 'Lens matrix failed; inspect family-matrix.log'); assert.equal(result.timedOut, false); assert.equal(result.error, undefined)
  const bytes = await readFile(join(evidence, 'proof/qualified.json')); assertLensHorizontalReceipt(JSON.parse(bytes))
  await writeFile(path, JSON.stringify({ status: 'passed', family: LENS_HORIZONTAL_FAMILY, built: true, receiptSha256: nodePortHash(bytes), nativeGraphs: 4, savedFinalScenes: 4, browserCaseRuns: 48, reuseNative: false }, null, 2) + '\n', { flag: 'wx' })
}
async function finalSources(evidence) { const base = await realpath(evidence), report = await json(join(base, 'proof/final/final.json')); return Promise.all(report.rows.map(async row => { const path = await realpath(row.sourceFile); assert.ok(path.startsWith(base + sep)); return path })) }
export const lensHorizontalEvidenceAdapter = Object.freeze({ nativeOwnership: 'family', validate: assertLensHorizontalScope, finalSources,
  nativeFinalPaths: ['proof/policy/policy.json', 'proof/policy/archive.json', 'proof/native/native.json', 'proof/native/archive.json', 'proof/final/final.json', 'proof/final/archive.json', 'proof/public-native/native-public.json', 'proof/public-native/archive.json', 'proof/matrix-inputs.json', 'proof/baseline-metal/report.json', 'proof/baseline-software/report.json'],
  async read({ root, evidence, manifest, profile, completedRuns, nativeIdentity }) {
    assertLensHorizontalScope({ manifest, profile, completedRuns })
    const suite = await json(join(evidence, 'suite-matrix.json')); assert.equal(suite.status, 'passed'); assert.equal(suite.family, LENS_HORIZONTAL_FAMILY); assert.equal(suite.built, true); assert.equal(suite.reuseNative, false)
    const bytes = await readFile(join(evidence, 'proof/qualified.json')); assert.equal(nodePortHash(bytes), suite.receiptSha256); const first = assertLensHorizontalReceipt(JSON.parse(bytes))
    const output = join(evidence, 'adapter-closed.json'), result = await executeNodePortCommand({ ...lensHorizontalReaderCommand({ root, evidence, output }), cwd: root, logPath: join(evidence, 'adapter-closed.log') })
    assert.equal(result.exitCode, 0, 'Independent Lens close failed'); assert.equal(result.timedOut, false); assert.equal(result.error, undefined)
    const proof = assertLensHorizontalReceipt(await json(output)); assert.deepEqual(proof, first)
    const native = await json(join(evidence, 'proof/native/native.json'))
    for (const folder of ['policy', 'native', 'final', 'public-native']) assertClosedFamilyNativeIdentity(native, await json(join(evidence, 'proof', folder, 'archive.json')), nativeIdentity)
    const sources = await finalSources(evidence); assert.equal(sources.length, 4); assert.equal(new Set(sources).size, 4)
    return { status: 'qualified', productionCases: 4, calibrationCases: 0, nativeGraphs: 4, nativeSamePixelCases: 20, nativeRenders: 40, savedFinalScenes: 4,
      caseRuns: 48, productionCaseRuns: 48, primaryFloat32Words: 41760, productionFloat32Words: 41760, wordMismatches: 0, finalSources: sources,
      nativePythonOwnership: 'family', nativePythonProof: proof.archives, files: [{ path: relative(evidence, output), sha256: nodePortHash(await readFile(output)) }],
      actualIdentity: { nativeVersion: native.version, nativeBuild: native.build, nativeSource: profile.nativeSource, browsers: proof.runs } }
  } })
