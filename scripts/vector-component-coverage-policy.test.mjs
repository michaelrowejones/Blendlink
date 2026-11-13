import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateVectorComponentSource, validateVectorComponentBrowser } from './lib/vector-component-profile.mjs'
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
const clone = value => structuredClone(value)
const contexts = ['ShaderNodeTree', 'CompositorNodeTree', 'GeometryNodeTree']
function source() {
  return { native: '5.3.0', version: [5, 3, 0], hash: '02f0899d78e3', numericalCases: 0, status: 'qualified-source-selection',
    packedSourcePlan: 'qualified', sourcePreserved: true,
    contexts: contexts.map(tree => ({ tree, available: true, inputs: [['Vector', 'VECTOR'], ['Index', 'INT']], outputs: [['Value', 'VALUE']] })),
    fixedIndices: [0, 1, 2], fixedSelectorTransport: ['unlinked', 'typed-int', 'reroute', 'group-default', 'group-typed-int'],
    refusals: { invalidIndices: [-2147483648, -1, 3, 2147483647], computed: true, dynamic: true, float: true, boolean: true,
      groupDynamic: true, animation: true, unmeasuredVersions: [[4, 2, 0], [5, 2, 0], [5, 3, 1], [5, 4, 0], [6, 0, 0]], socketSchemaMutations: 4 } }
}
function browser() {
  const ids = ['carrier-control', 'uv-control']
  for (const vector of ['constant', 'uv', 'object']) for (let i = 0; i < 3; i++) for (const selector of ['default', 'literal', 'group-default', 'group-literal']) ids.push(`${vector}-${i}-${selector}`)
  for (let v = 0; v < 2; v++) for (let i = 0; i < 3; i++) ids.push(`constant-extra-${v}-${i}`)
  const backends = ['webgpu', 'webgl2']
  return { built: true, provenance: { mode: 'built' }, native: '5.3.0', nativeHash: '02f0899d78e3', nativeSelectionGraphs: 42,
    independentCarrierControls: 2, nativeComponentVsSeparateBitMismatches: 0, failures: [],
    carrierAllowance: { absolute: 6e-6, additional: 'one native scene-target half ULP' },
    nativeCarrierCalibration: { independentSocketUvFormula: true, halfRepresentable: true, maximumBudgetRatio: .7 },
    environments: backends.map(backend => ({ backend, gpu: { api: backend, vendor: 'measured-test-profile' }, deviceLoss: null,
      resourceCheck: { outputTargetTextures: 1, addedProgramTextures: 0 } })),
    rows: backends.flatMap(backend => ids.map(id => ({ backend, id, maximum: .0003, ratio: .7 }))),
    rawSelectionRows: backends.flatMap(backend => ids.filter(id => !id.endsWith('-control')).map(id => ({ backend, id, mismatches: 0, maximum: 0, zeroSignClaim: false }))) }
}

test('Vector Component source qualification requires actual schemas, typed/group boundaries and explicit zero numeric coverage', () => {
  const valid = source(); assert.equal(validateVectorComponentSource(valid).liveContext, 'shader')
  for (const mutate of [r => r.version[2]++, r => r.contexts[0].inputs[1][1] = 'VALUE', r => r.refusals.groupDynamic = false,
    r => r.refusals.socketSchemaMutations = 0, r => r.fixedSelectorTransport.pop(), r => r.numericalCases = 42, r => delete r.packedSourcePlan]) {
    const changed = clone(valid); mutate(changed); assert.throws(() => validateVectorComponentSource(changed))
  }
})
test('known native absence cannot become a modern control-only numerical success', () => {
  for (const [version, hash] of [['4.2.0', 'a51f293548ad'], ['5.2.0', 'fbe6228777e7']]) {
    const record = { native: version, version: version.split('.').map(Number), hash, numericalCases: 0, status: 'native-node-absent',
      contexts: contexts.map(tree => ({ tree, available: false, reason: 'Error: Node type FunctionNodeGetVectorComponent undefined' })) }
    assert.equal(validateVectorComponentSource(record).numericalCases, 0)
    const changed = clone(record); changed.contexts[0].available = true; assert.throws(() => validateVectorComponentSource(changed))
  }
  const fake = source(); fake.status = 'native-node-absent'; assert.throws(() => validateVectorComponentSource(fake))
})
test('native half-target allowance never substitutes for exact raw controls or both APIs', () => {
  const valid = browser(); assert.equal(validateVectorComponentBrowser(valid).rawMaximumError, 0)
  for (const mutate of [r => r.rawSelectionRows[0].maximum = 1e-8, r => r.rawSelectionRows[0].mismatches = 1,
    r => r.rows[0].ratio = 1.001, r => r.rows[0].id = 'wrong-case', r => r.carrierAllowance.absolute = .01,
    r => r.nativeCarrierCalibration.independentSocketUvFormula = false,
    r => r.rows = r.rows.filter(row => row.backend === 'webgpu'), r => r.built = false,
    r => r.environments[0].resourceCheck.addedProgramTextures = 1]) {
    const changed = clone(valid); mutate(changed); assert.throws(() => validateVectorComponentBrowser(changed))
  }
})
test('metadata and fresh native canaries retain fixed shader scope, absence and separate proof roles', () => {
  const map = JSON.parse(read('docs/node-capabilities.json')), key = 'shader:FunctionNodeGetVectorComponent', entry = map.entries[key]
  assert.equal(entry.category, 'partial'); assert.deepEqual(entry.runtimeOps, ['separate'])
  assert.deepEqual(entry.verification.nativeNumericVersions, ['5.3.0']); assert.deepEqual(entry.verification.nativeAbsentVersions, ['4.2.0', '5.2.0'])
  assert.equal(entry.verification.browserNativeCarrierReadbacks, 176); assert.equal(entry.verification.browserRawAlgebraicReadbacks, 168)
  assert.equal(entry.verification.nativeTargetAllowanceIsNodePrecision, false); assert.equal(entry.verification.rawMaximumAbsoluteError, 0)
  assert.equal(entry.verification.freshHostedOpenGL, 'pending'); assert.ok(!map.knownUnsupported.includes(key))
  assert.ok(map.knownUnsupported.includes('compositor:FunctionNodeGetVectorComponent'))
  const gate = read('scripts/test-node-parity.mjs')
  for (const name of ['validateVectorComponentSource', 'validateVectorComponentBrowser', 'shaderSourceQualifications', "qualification.status === 'native-node-absent'"]) assert.ok(gate.includes(name))
  const workflow = read('.github/workflows/static-noise.yml'), job = workflow.split('  native-vector-component:\n')[1]
  assert.ok(job); assert.match(job, /blender-5\.3\.0-linux-x64\.tar\.xz/)
  assert.match(job, /dacb8264197a3f7fda6001285a5a506fc97ee943881261c2c3bd63c882f22e05/)
  for (const text of ['sha256sum --check --strict', 'check-vector-component-profile.mjs --source', 'check-vector-component-profile.mjs --browser', 'run.mjs --built', 'record.gpuPlatform.backend, "OPENGL"']) assert.ok(job.includes(text), text)
  assert.doesNotMatch(job, /--reuse-reference|--disable-gpu-watchdog/)
  assert.equal((workflow.match(/check-vector-component-profile\.mjs --absent/g) || []).length, 2)
})
