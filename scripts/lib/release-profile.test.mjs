import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyReleaseProfileOutput, closeReleaseProfileWorkspace, validateReleaseNativeIdentity, validateReleaseProfile } from './release-profile.mjs'

const profile = JSON.parse(readFileSync(new URL('../../config/release-profiles/blender-5.3-macos-arm64.json', import.meta.url)))
const identity = { version: '5.3.0', buildHash: '02f0899d78e3', exporterVersion: [5, 3, 43],
  exporterSourceFiles: [{ path: '__init__.py', sha256: 'a'.repeat(64) }] }
const host = { platform: 'darwin', architecture: 'arm64' }
const complete = ['BLENDLINK_REAL_TOOLCHAINS_PASSED', 'BLENDLINK_CONSUMER_BUILDS_PASSED',
  'BLENDLINK_EXAMPLES_PASSED', 'package artifact passed:', 'BLENDLINK_DOGFOOD_PACKAGE_IDENTITY_PASSED',
  'BLENDLINK_FULL_TEST addon: passed', 'BLENDLINK_BAKED_E2E_PASSED'].join('\n')
const gap = 'BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE (5, 3, 43) controlled5.2.39 rule tests below do not qualify native exporter; actual version tested as unverified'
const prefix = 'BLENDLINK_MATERIAL_RELAXATIONS_POLICY_WITNESS '
const policySourceHashes = { 'procedural.py': 'b'.repeat(64), 'run_headless.py': 'c'.repeat(64) }
function witness() {
  return { schemaVersion: 1, blenderVersion: profile.blenderVersion,
    blenderBuildHash: profile.blenderBuildHash, exporterVersion: profile.gltfExporterVersion,
    controlledExporterVersion: [5, 2, 39], nativePositiveQualification: false,
    probeRestored: true, restoredExporterVersion: profile.gltfExporterVersion,
    productionFlags: Object.fromEntries(profile.materialPolicy.excludedFeatures.map(({ feature }) => [feature, false])),
    observations: Object.fromEntries(profile.materialPolicy.excludedFeatures.map(({ feature, status }) => [feature,
      { status, reasons: ['This stock material relaxation is verified only for exporter 5.2.39.'] }])),
    sourceSha256: policySourceHashes }
}
const scoped = output => classifyReleaseProfileOutput({ exitCode: 0, output,
  profile, identity, host, policySourceHashes })
const scopedOutput = (record = witness()) => complete + '\n' + gap + '\n' + prefix + JSON.stringify(record)
test('pins host, native build and actual exporter independently of legacy lanes', () => {
  assert.equal(validateReleaseProfile(profile), profile)
  validateReleaseNativeIdentity(identity, profile, host)
  for (const [key, value] of [['version', '5.2.0'], ['buildHash', 'fbe6228777e7'], ['exporterVersion', [5, 2, 39]]]) {
    assert.throws(() => validateReleaseNativeIdentity({ ...identity, [key]: value }, profile, host))
  }
  assert.throws(() => validateReleaseNativeIdentity(identity, profile, { ...host, architecture: 'x64' }))
  assert.throws(() => validateReleaseProfile({ ...profile, cyclesDevice: 'GPU' }))
})
test('an omnibus pass with legacy-only native-rule substitution blocks 5.3 qualification', () => {
  const result = classifyReleaseProfileOutput({ exitCode: 0, output: 'BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE (5, 3, 43)\nBLENDLINK_ADDON_TESTS_PASSED\n' })
  assert.equal(result.status, 'blocked-native-qualification'); assert.equal(result.completeLocalContract, false)
  assert.equal(result.nativeCoverageGaps.length, 1)
})
test('preflight cannot become a full contract or support promotion', () => {
  const result = classifyReleaseProfileOutput({ exitCode: 0, output: '', preflightOnly: true })
  assert.equal(result.status, 'preflight-passed'); assert.equal(result.completeLocalContract, false)
  assert.equal(result.productionCredit, false); assert.equal(result.supportPromotion, false); assert.equal(result.publicReleaseReady, false)
})
test('failed or terminated complete commands never pass even after a success sentinel', () => {
  for (const result of [{ exitCode: 1 }, { exitCode: null, signal: 'SIGTERM' }]) {
    assert.equal(classifyReleaseProfileOutput({ ...result, output: 'BLENDLINK_ADDON_TESTS_PASSED' }).status, 'failed')
  }
  assert.equal(classifyReleaseProfileOutput({ exitCode: 0, output: complete }).status, 'local-contract-passed')
})
test('missing full stages and accepted native shutdown failures cannot qualify', () => {
  assert.equal(classifyReleaseProfileOutput({ exitCode: 0, output: '' }).status, 'incomplete-contract')
  for (const marker of complete.split('\n')) {
    assert.equal(classifyReleaseProfileOutput({ exitCode: 0, output: complete.replace(marker, '') }).status, 'incomplete-contract')
  }
  assert.equal(classifyReleaseProfileOutput({ exitCode: 0,
    output: complete + '\naccepting the explicit success sentinel because Blender can fail during shutdown' }).status, 'failed')
})
test('focused reruns and desktop-only installation cannot become a complete contract', () => {
  for (const marker of ['BLENDLINK_HEADLESS_ONLY is set - running 25/184 suites. This is a focused rerun, not the gate.',
    'BLENDLINK_DESKTOP_SMOKE: installation and managed tools only']) {
    const value = classifyReleaseProfileOutput({ exitCode: 0, output: complete + '\n' + marker })
    assert.equal(value.status, 'incomplete-contract'); assert.equal(value.completeLocalContract, false)
  }
})
test('rejects incomplete, unsafe or duplicate native exporter source inventory', () => {
  for (const files of [[], [{ path: '../x.py', sha256: 'a'.repeat(64) }],
    [...identity.exporterSourceFiles, ...identity.exporterSourceFiles], [{ path: '__init__.py', sha256: 'bad' }]]) {
    assert.throws(() => validateReleaseNativeIdentity({ ...identity, exporterSourceFiles: files }, profile, host))
  }
})
test('checkout changes remain separate from native gaps and missing command stages', () => {
  const original = classifyReleaseProfileOutput({ exitCode: 1,
    output: 'BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE (5, 3, 43)' })
  const closed = closeReleaseProfileWorkspace(original, { sourceCommit: 'a', currentCommit: 'b', trackedChanges: ' M docs/progress.md\n' })
  assert.equal(closed.workspaceStable, false); assert.equal(closed.workspaceIssues.length, 2)
  assert.deepEqual(closed.nativeCoverageGaps, original.nativeCoverageGaps)
  assert.deepEqual(closed.missingStages, original.missingStages)
  assert.equal(closed.status, 'failed'); assert.equal(closed.completeLocalContract, false)
  const passed = classifyReleaseProfileOutput({ exitCode: 0, output: complete })
  assert.equal(closeReleaseProfileWorkspace(passed, { sourceCommit: 'a', currentCommit: 'a', trackedChanges: '' }).status, 'local-contract-passed')
  assert.equal(closeReleaseProfileWorkspace(passed, { sourceCommit: 'a', currentCommit: 'b', trackedChanges: '' }).status, 'failed')
})

test('the explicit profile accounts for conservative policy without granting native parity', () => {
  const result = scoped(scopedOutput())
  assert.equal(result.status, 'local-contract-passed')
  assert.equal(result.completeLocalContract, true)
  assert.equal(result.nativePolicyVerified, true)
  assert.deepEqual(result.nativeCoverageGaps, [gap])
  assert.deepEqual(result.materialPolicyExclusions, profile.materialPolicy.excludedFeatures)
  for (const key of ['nativePositiveQualification', 'productionCredit', 'supportPromotion', 'publicReleaseReady']) {
    assert.equal(result[key], false)
  }
  assert.equal(classifyReleaseProfileOutput({ exitCode: 0, output: scopedOutput() }).status, 'blocked-native-qualification')
})

test('known marker accounting requires the exact marker and one complete matching witness', () => {
  for (const output of [complete, complete + '\n' + gap,
    complete + '\n' + prefix + JSON.stringify(witness()),
    scopedOutput().replace('(5, 3, 43)', '(5, 3, 44)'),
    scopedOutput() + '\n' + gap,
    scopedOutput() + '\n' + prefix + JSON.stringify(witness()),
    complete + '\n' + gap + '\n' + prefix + '{broken-json',
    scopedOutput() + '\nBLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE unknown-feature']) {
    assert.equal(scoped(output).status, 'blocked-native-qualification')
  }
})

test('tampered native identity, enabled flags, missing policy observations and parity claims block', () => {
  const mutations = [
    w => { w.blenderVersion = '5.2.0' },
    w => { w.blenderBuildHash = 'other-build' },
    w => { w.exporterVersion = [5, 3, 44] },
    w => { w.controlledExporterVersion = [5, 2, 40] },
    w => { w.restoredExporterVersion = [5, 2, 39] },
    w => { w.probeRestored = false },
    w => { w.productionFlags.alphaClipMath = true },
    w => { w.productionFlags.unknown = false },
    w => { delete w.observations.constantIridescence },
    w => { w.observations.fixedCameraUnlit.status = 'exact' },
    w => { w.observations.alphaClipMath.reasons = [] },
    w => { w.nativePositiveQualification = true },
    w => { w.requiredFeatures = ['alphaClipMath'] },
    w => { w.sourceSha256 = { ...policySourceHashes, 'procedural.py': 'd'.repeat(64) } },
  ]
  for (const mutate of mutations) {
    const record = structuredClone(witness()); mutate(record)
    const result = scoped(scopedOutput(record))
    assert.equal(result.status, 'blocked-native-qualification')
    assert.equal(result.completeLocalContract, false)
    assert.ok(result.nativePolicyIssues.length > 0)
  }
})

test('required excluded features, profile drift, unverified identity and unpinned sources block', () => {
  for (const options of [
    { profile: { ...profile, materialPolicy: { ...profile.materialPolicy, requiredFeatures: ['fixedCameraUnlit'] } } },
    { profile: { ...profile, materialPolicy: { ...profile.materialPolicy, excludedFeatures: [] } } },
    { identity: { ...identity, exporterVersion: [5, 2, 39] } },
    { host: { ...host, architecture: 'x64' } },
    { policySourceHashes: {} },
  ]) {
    assert.equal(classifyReleaseProfileOutput({ exitCode: 0, output: scopedOutput(),
      profile, identity, host, policySourceHashes, ...options }).status, 'blocked-native-qualification')
  }
})

test('a valid policy witness cannot waive missing stages, focused execution or process failure', () => {
  for (const marker of complete.split('\n')) {
    assert.equal(scoped(scopedOutput().replace(marker, '')).status, 'incomplete-contract')
  }
  for (const note of ['BLENDLINK_HEADLESS_ONLY is set', 'BLENDLINK_DESKTOP_SMOKE:']) {
    assert.equal(scoped(scopedOutput() + '\n' + note).status, 'incomplete-contract')
  }
  assert.equal(scoped(scopedOutput() + '\naccepting the explicit success sentinel because Blender can fail during shutdown').status, 'failed')
  assert.equal(classifyReleaseProfileOutput({ exitCode: 1, output: scopedOutput(),
    profile, identity, host, policySourceHashes }).status, 'failed')
})
