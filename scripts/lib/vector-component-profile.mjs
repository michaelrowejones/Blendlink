import assert from 'node:assert/strict'

const builds = { '4.2.0': 'a51f293548ad', '5.2.0': 'fbe6228777e7', '5.3.0': '02f0899d78e3' }
const contexts = ['ShaderNodeTree', 'CompositorNodeTree', 'GeometryNodeTree']

/** Creation/planning evidence cannot replace numerical native graph coverage. */
export function validateVectorComponentSource(record) {
  assert.ok(Array.isArray(record.version)); const version = record.version.join('.')
  assert.ok(Object.hasOwn(builds, version)); assert.equal(record.hash, builds[version])
  assert.equal(record.native.replace(/ LTS$/, ''), version); assert.equal(record.numericalCases, 0)
  assert.deepEqual(record.contexts.map(item => item.tree), contexts)
  if (version !== '5.3.0') {
    assert.equal(record.status, 'native-node-absent')
    for (const context of record.contexts) {
      assert.equal(context.available, false); assert.match(context.reason, /FunctionNodeGetVectorComponent undefined/)
    }
    return { status: 'native-node-absent', native: record.native, numericalCases: 0, contexts: contexts.length }
  }
  assert.equal(record.status, 'qualified-source-selection'); assert.equal(record.packedSourcePlan, 'qualified')
  assert.equal(record.sourcePreserved, true)
  for (const context of record.contexts) {
    assert.equal(context.available, true)
    assert.deepEqual(context.inputs, [['Vector', 'VECTOR'], ['Index', 'INT']]); assert.deepEqual(context.outputs, [['Value', 'VALUE']])
  }
  assert.deepEqual(record.fixedIndices, [0, 1, 2])
  assert.deepEqual(record.fixedSelectorTransport, ['unlinked', 'typed-int', 'reroute', 'group-default', 'group-typed-int'])
  const refused = record.refusals
  assert.deepEqual(refused.invalidIndices, [-2147483648, -1, 3, 2147483647])
  for (const key of ['computed', 'dynamic', 'float', 'boolean', 'groupDynamic', 'animation']) assert.equal(refused[key], true)
  assert.deepEqual(refused.unmeasuredVersions, [[4, 2, 0], [5, 2, 0], [5, 3, 1], [5, 4, 0], [6, 0, 0]])
  assert.equal(refused.socketSchemaMutations, 4)
  return { status: record.status, native: record.native, numericalCases: 0, liveContext: 'shader', fixedIndices: [0, 1, 2] }
}

const caseIds = () => {
  const ids = ['carrier-control', 'uv-control']
  for (const source of ['constant', 'uv', 'object']) for (let index = 0; index < 3; index++)
    for (const selector of ['default', 'literal', 'group-default', 'group-literal']) ids.push(`${source}-${index}-${selector}`)
  for (let vector = 0; vector < 2; vector++) for (let index = 0; index < 3; index++) ids.push(`constant-extra-${vector}-${index}`)
  return ids.sort()
}

/** Half-target native comparisons and exact raw algebraic checks stay separate. */
export function validateVectorComponentBrowser(record) {
  assert.equal(record.built, true); assert.equal(record.provenance.mode, 'built')
  assert.equal(record.native, '5.3.0'); assert.equal(record.nativeHash, builds['5.3.0'])
  assert.equal(record.nativeSelectionGraphs, 42); assert.equal(record.independentCarrierControls, 2)
  assert.equal(record.nativeComponentVsSeparateBitMismatches, 0)
  assert.deepEqual(record.carrierAllowance, { absolute: 6e-6, additional: 'one native scene-target half ULP' })
  assert.equal(record.nativeCarrierCalibration.independentSocketUvFormula, true)
  assert.equal(record.nativeCarrierCalibration.halfRepresentable, true)
  assert.ok(Number.isFinite(record.nativeCarrierCalibration.maximumBudgetRatio) && record.nativeCarrierCalibration.maximumBudgetRatio >= 0 && record.nativeCarrierCalibration.maximumBudgetRatio <= 1)
  assert.deepEqual(record.failures, []); assert.equal(record.rows.length, 88); assert.equal(record.rawSelectionRows.length, 84)
  assert.deepEqual(record.environments.map(item => item.backend).sort(), ['webgl2', 'webgpu'])
  for (const backend of ['webgpu', 'webgl2']) {
    const environment = record.environments.find(item => item.backend === backend)
    assert.ok(environment.gpu && Object.keys(environment.gpu).length > 1); assert.equal(environment.deviceLoss, null)
    assert.deepEqual(environment.resourceCheck, { outputTargetTextures: 1, addedProgramTextures: 0 })
    const rows = record.rows.filter(row => row.backend === backend)
    assert.deepEqual(rows.map(row => row.id).sort(), caseIds())
    for (const row of rows) assert.ok(Number.isFinite(row.maximum) && row.maximum >= 0 && Number.isFinite(row.ratio) && row.ratio >= 0 && row.ratio <= 1)
    const raw = record.rawSelectionRows.filter(row => row.backend === backend)
    assert.deepEqual(raw.map(row => row.id).sort(), caseIds().filter(id => !id.endsWith('-control')))
    for (const row of raw) { assert.equal(row.mismatches, 0); assert.equal(row.maximum, 0); assert.equal(row.zeroSignClaim, false) }
  }
  return { status: 'qualified', nativeSelectionGraphs: 42, independentCarrierControls: 2,
    nativeCarrierReads: 88, rawAlgebraicReads: 84, rawMaximumError: 0 }
}
