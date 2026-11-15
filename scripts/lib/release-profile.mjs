import assert from 'node:assert/strict'

const materialExclusions = [
  { feature: 'alphaClipMath', status: 'needsBake' },
  { feature: 'constantIridescence', status: 'approximated' },
  { feature: 'contextualSheenWeight', status: 'approximated' },
  { feature: 'fixedCameraUnlit', status: 'needsBake' },
]
const materialGapMarker = 'BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE (5, 3, 43) controlled5.2.39 rule tests below do not qualify native exporter; actual version tested as unverified'
const materialWitnessPrefix = 'BLENDLINK_MATERIAL_RELAXATIONS_POLICY_WITNESS '

export function validateReleaseProfile(value) {
  assert.equal(value?.schemaVersion, 1)
  assert.equal(value.id, 'blender-5.3-macos-arm64')
  assert.equal(value.platform, 'darwin')
  assert.equal(value.architecture, 'arm64')
  assert.equal(value.blenderVersion, '5.3.0')
  assert.equal(value.blenderBuildHash, '02f0899d78e3')
  assert.deepEqual(value.gltfExporterVersion, [5, 3, 43])
  assert.equal(value.cyclesDevice, 'CPU')
  assert.ok(typeof value.scope === 'string' && value.scope.length > 40)
  const policy = value.materialPolicy
  assert.deepEqual(Object.keys(policy ?? {}).sort(), ['controlledExporterVersion', 'excludedFeatures',
    'kind', 'nativePositiveQualification', 'requiredFeatures'])
  assert.equal(policy.kind, 'conservative-unqualified-stock-relaxations-v1')
  assert.deepEqual(policy.controlledExporterVersion, [5, 2, 39])
  assert.equal(policy.nativePositiveQualification, false)
  assert.deepEqual(policy.excludedFeatures, materialExclusions)
  assert.ok(Array.isArray(policy.requiredFeatures) && new Set(policy.requiredFeatures).size === policy.requiredFeatures.length)
  assert.ok(policy.requiredFeatures.every(feature => materialExclusions.some(item => item.feature === feature)))
  return value
}

export function validateReleaseNativeIdentity(identity, profile, { platform, architecture }) {
  validateReleaseProfile(profile)
  assert.equal(platform, profile.platform, 'Release profile host platform mismatch')
  assert.equal(architecture, profile.architecture, 'Release profile host architecture mismatch')
  assert.equal(identity?.version, profile.blenderVersion, 'Release profile Blender version mismatch')
  assert.equal(identity.buildHash, profile.blenderBuildHash, 'Release profile native build mismatch')
  assert.deepEqual(identity.exporterVersion, profile.gltfExporterVersion, 'Release profile glTF exporter mismatch')
  assert.ok(Array.isArray(identity.exporterSourceFiles) && identity.exporterSourceFiles.length > 0)
  const paths = new Set()
  for (const file of identity.exporterSourceFiles) {
    assert.ok(typeof file.path === 'string' && file.path.endsWith('.py') && !file.path.startsWith('/')
      && !file.path.includes('\\') && file.path.split('/').every(part => part && part !== '.' && part !== '..'))
    assert.ok(!paths.has(file.path), 'Duplicate exporter source path')
    paths.add(file.path)
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
  }
  assert.ok(paths.has('__init__.py'), 'Missing exporter entry point')
  return identity
}

function inspectMaterialPolicy({ profile, identity, host, policySourceHashes, lines, gapLines }) {
  const issues = []
  let witness = null
  try {
    validateReleaseNativeIdentity(identity, profile, host)
    assert.deepEqual(profile.materialPolicy.requiredFeatures, [], 'A required feature lacks positive native qualification')
    assert.deepEqual(gapLines, [materialGapMarker], 'Expected exactly the known version-policy marker')
    const rows = lines.filter(line => line.includes('BLENDLINK_MATERIAL_RELAXATIONS_POLICY_WITNESS'))
    assert.equal(rows.length, 1, 'Expected one native material-policy witness')
    assert.ok(rows[0].startsWith(materialWitnessPrefix), 'Malformed policy witness prefix')
    witness = JSON.parse(rows[0].slice(materialWitnessPrefix.length))
    assert.deepEqual(Object.keys(witness).sort(), ['schemaVersion', 'blenderVersion', 'blenderBuildHash',
      'exporterVersion', 'controlledExporterVersion', 'productionFlags', 'observations', 'probeRestored',
      'restoredExporterVersion', 'nativePositiveQualification', 'sourceSha256'].sort())
    assert.equal(witness.schemaVersion, 1)
    assert.equal(witness.blenderVersion, profile.blenderVersion)
    assert.equal(witness.blenderBuildHash, profile.blenderBuildHash)
    assert.deepEqual(witness.exporterVersion, profile.gltfExporterVersion)
    assert.deepEqual(witness.controlledExporterVersion, profile.materialPolicy.controlledExporterVersion)
    assert.equal(witness.probeRestored, true)
    assert.deepEqual(witness.restoredExporterVersion, profile.gltfExporterVersion)
    assert.equal(witness.nativePositiveQualification, false)
    assert.deepEqual(witness.productionFlags, Object.fromEntries(materialExclusions.map(({ feature }) => [feature, false])))
    assert.deepEqual(Object.keys(witness.observations).sort(), materialExclusions.map(item => item.feature))
    for (const { feature, status } of materialExclusions) {
      const observed = witness.observations[feature]
      assert.deepEqual(Object.keys(observed).sort(), ['reasons', 'status'])
      assert.equal(observed.status, status, 'Unexpected actual native-version outcome: ' + feature)
      assert.ok(Array.isArray(observed.reasons) && observed.reasons.some(reason =>
        typeof reason === 'string' && reason.includes('verified only') && reason.includes('5.2.39')),
      'Missing conservative native-version reason: ' + feature)
    }
    assert.deepEqual(Object.keys(policySourceHashes ?? {}).sort(), ['procedural.py', 'run_headless.py'])
    for (const value of Object.values(policySourceHashes)) assert.match(value, /^[a-f0-9]{64}$/)
    assert.deepEqual(witness.sourceSha256, policySourceHashes, 'Native witness producer/policy source drift')
  } catch (error) {
    issues.push(error.message)
  }
  return { verified: issues.length === 0, witness, issues }
}

export function classifyReleaseProfileOutput({ exitCode, signal, output, preflightOnly = false,
  profile, identity, host, policySourceHashes }) {
  // The omnibus suite deliberately substitutes the old exporter identity when
  // testing historical rule policy. A suite sentinel cannot certify those
  // rules against this newer native exporter.
  const lines = output.split(/\r?\n/)
  const gapLines = lines.filter(line => line.includes('BLENDLINK_MATERIAL_RELAXATIONS_NATIVE_NOT_APPLICABLE'))
  const nativeCoverageGaps = [...new Set(gapLines)]
  const policy = profile && !preflightOnly
    ? inspectMaterialPolicy({ profile, identity, host, policySourceHashes, lines, gapLines })
    : { verified: false, witness: null, issues: [] }
  const required = ['BLENDLINK_REAL_TOOLCHAINS_PASSED', 'BLENDLINK_CONSUMER_BUILDS_PASSED',
    'BLENDLINK_EXAMPLES_PASSED', 'package artifact passed:', 'BLENDLINK_DOGFOOD_PACKAGE_IDENTITY_PASSED',
    'BLENDLINK_FULL_TEST addon: passed', 'BLENDLINK_BAKED_E2E_PASSED']
  const missingStages = preflightOnly ? [] : required.filter(marker => !output.includes(marker))
  const nativeExitAccepted = output.includes('accepting the explicit success sentinel because Blender can fail during shutdown')
  const focusedExecution = output.includes('BLENDLINK_HEADLESS_ONLY is set') || output.includes('BLENDLINK_DESKTOP_SMOKE:')
  const blockedPolicy = (nativeCoverageGaps.length > 0 && !policy.verified)
    || Boolean(profile && !preflightOnly && !policy.verified)
  const status = signal || exitCode !== 0 || nativeExitAccepted ? 'failed'
    : blockedPolicy ? 'blocked-native-qualification'
    : missingStages.length || focusedExecution ? 'incomplete-contract'
    : preflightOnly ? 'preflight-passed' : 'local-contract-passed'
  return { status, nativeCoverageGaps, missingStages, nativeExitAccepted, focusedExecution,
    nativePolicyVerified: policy.verified, nativePolicyWitness: policy.witness,
    nativePolicyIssues: policy.issues,
    materialPolicyExclusions: profile?.materialPolicy?.excludedFeatures ?? [],
    nativePositiveQualification: false, productionCredit: false, supportPromotion: false,
    completeLocalContract: status === 'local-contract-passed',
    publicReleaseReady: false }
}

export function closeReleaseProfileWorkspace(result, { sourceCommit, currentCommit, trackedChanges }) {
  const workspaceIssues = []
  if (trackedChanges.trim()) workspaceIssues.push('Tracked source changed during the contract: ' + trackedChanges.trim())
  if (currentCommit !== sourceCommit) workspaceIssues.push('Source commit changed during the contract')
  const workspaceStable = workspaceIssues.length === 0
  return { ...result, workspaceStable, workspaceIssues,
    ...(!workspaceStable ? { status: 'failed', completeLocalContract: false } : {}) }
}
