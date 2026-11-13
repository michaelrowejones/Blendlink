import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const builds = { '4.2.0': 'a51f293548ad', '5.2.0': 'fbe6228777e7', '5.3.0': '02f0899d78e3' }
export const COMPONENT_SOURCE_FILES = {
  'compositor_vector_component_check.py': 'packages/blender-addon/tests/compositor_vector_component_check.py',
  'compositor_component_packaged.py': 'packages/blender-addon/tests/compositor_component_packaged.py',
  'compositor_graph.py': 'packages/blendlink/blender/compositor_graph.py',
  'compositor_vector_component.py': 'packages/blendlink/blender/compositor_vector_component.py',
}
export function componentCasePairs(device) {
  assert.ok(['CPU', 'GPU'].includes(device))
  const prefix = 'blender-5-3-' + device.toLowerCase(), pairs = []
  for (let vector = 0; vector < 4; vector++) for (let index = 0; index < 3; index++)
    for (const transport of ['default', 'literal', 'reroute', 'group-default', 'group-literal']) {
      const selection = `${prefix}-component-${vector}-${index}-${transport}`
      pairs.push({ selection, separate: selection + '-separate', index })
    }
  for (let index = 0; index < 3; index++) {
    const selection = `${prefix}-component-amplified-${index}`
    pairs.push({ selection, separate: selection + '-separate', index })
  }
  return pairs
}
export function componentCaseIds(device) {
  const prefix = 'blender-5-3-' + device.toLowerCase()
  return [`${prefix}-component-independent-image`, `${prefix}-component-independent-constant`,
    ...componentCasePairs(device).flatMap(pair => [pair.selection, pair.separate])].sort()
}
export function verifyCompositorComponentCurrentSources(qualification, root) {
  for (const [name, path] of Object.entries(COMPONENT_SOURCE_FILES))
    assert.equal(qualification.sourceSha256[name], hash(readFileSync(join(root, path))), 'Stale Component source: ' + name)
}
export function readCompositorComponentProfile(directory, rows = json(join(directory, 'index.json'))) {
  const proof = json(join(directory, 'qualification.json')), version = proof.sourceVersion?.join('.')
  assert.equal(proof.schemaVersion, 1); assert.equal(proof.kind, 'blendlink-compositor-vector-component-v1')
  assert.ok(Object.hasOwn(builds, version)); assert.equal(proof.hash, builds[version])
  assert.equal(proof.native.replace(/ LTS$/, ''), version)
  assert.ok(['CPU', 'GPU'].includes(proof.device)); assert.ok(Array.isArray(rows))
  assert.deepEqual(Object.keys(proof.sourceSha256).sort(), Object.keys(COMPONENT_SOURCE_FILES).sort())
  for (const value of Object.values(proof.sourceSha256)) assert.match(value, /^[a-f0-9]{64}$/)
  const base = { native: proof.native, device: proof.device, sourceSha256: proof.sourceSha256,
    qualificationSha256: hash(readFileSync(join(directory, 'qualification.json'))) }
  if (proof.status === 'native-node-absent') {
    assert.ok(['4.2.0', '5.2.0'].includes(version)); assert.equal(proof.available, false)
    assert.match(proof.reason, /FunctionNodeGetVectorComponent undefined/)
    assert.equal(rows.length, 0)
    for (const key of ['selectionCases', 'pairedSeparateCases', 'controlCases']) assert.equal(proof[key], 0)
    assert.ok(!proof.pairs && !proof.packedSource)
    return { ...base, status: proof.status, numericalComponentCases: 0, caseIds: [] }
  }
  assert.equal(version, '5.3.0'); assert.equal(proof.status, 'qualified-fixed-selection'); assert.equal(proof.available, true)
  assert.equal(proof.selectionCases, 63); assert.equal(proof.pairedSeparateCases, 63); assert.equal(proof.controlCases, 2)
  assert.equal(proof.sourcePreserved, true); assert.equal(proof.nativeWordMismatches, 0); assert.equal(proof.schemaRefusalCases, 4)
  assert.ok(['CYCLES', 'BLENDER_EEVEE'].includes(proof.sourceEngine))
  const packed = proof.packedSource
  assert.equal(packed.status, 'qualified-zip-source'); assert.equal(packed.sourcePreserved, true)
  assert.deepEqual(packed.indices, [0, 1, 2]); assert.deepEqual(packed.transports, ['default', 'literal', 'reroute', 'group-default', 'group-literal'])
  assert.match(packed.archiveSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(Object.keys(packed.modules).sort(), ['compositor_graph.py', 'compositor_vector_component.py'])
  for (const [name, value] of Object.entries(packed.modules)) assert.equal(value, proof.sourceSha256[name])
  if (proof.device === 'GPU') {
    assert.equal(proof.nativeGpuProfile.blenderHash, proof.hash); assert.deepEqual(proof.nativeGpuProfile.blenderVersion, [5, 3, 0])
    assert.ok(['METAL', 'OPENGL', 'VULKAN'].includes(proof.nativeGpuProfile.backend))
    for (const field of ['vendor', 'renderer']) assert.ok(typeof proof.nativeGpuProfile[field] === 'string' && proof.nativeGpuProfile[field].length)
  }
  const expectedPairs = componentCasePairs(proof.device), expectedIds = componentCaseIds(proof.device)
  assert.equal(proof.pairs.length, 63); assert.deepEqual(rows.map(row => row.case).sort(), expectedIds)
  const files = new Map()
  for (const row of rows) {
    assert.match(row.case, /^[a-z0-9-]+$/); assert.ok(!files.has(row.case))
    const record = json(join(directory, row.case + '.json'))
    assert.equal(record.case, row.case); assert.equal(record.blenderHash, proof.hash); assert.equal(record.compositorDevice, proof.device)
    assert.equal(record.width, 13); assert.equal(record.height, 7); assert.equal(record.exactAlpha, true)
    for (const values of [record.input, record.expected]) { assert.equal(values.length, 364); assert.ok(values.every(Number.isFinite)) }
    assert.equal(record.program.status, 'extracted'); files.set(row.case, record)
  }
  for (const [position, pair] of proof.pairs.entries()) {
    assert.equal(pair.nativeWordMismatches, 0)
    const expected = expectedPairs[position]
    assert.equal(pair.selection, expected.selection); assert.equal(pair.separate, expected.separate)
    const a = files.get(pair.selection), b = files.get(pair.separate)
    assert.deepEqual(new Uint32Array(new Float32Array(a.expected).buffer), new Uint32Array(new Float32Array(b.expected).buffer))
    const nodes = a.program.ops.filter(op => op.source.nodeType === 'FunctionNodeGetVectorComponent')
    assert.equal(nodes.length, 1); const op = nodes[0]
    assert.equal(op.kind, 'separate-vector'); assert.equal(op.type, 'VALUE'); assert.equal(op.source.output, 'Value')
    assert.equal(op.properties.vector_component_model, 'native-fixed-vector-component-v1')
    assert.deepEqual(op.properties.vector_component_source_version, [5, 3, 0])
    assert.equal(op.inputs.Vector.socketType, 'VECTOR'); assert.equal(op.inputs.Vector.value.type, 'VECTOR')
    assert.equal(op.inputs.Index.socketType, 'INT'); assert.equal(op.inputs.Index.value.type, 'INT')
    const selector = op.inputs.Index.value
    const literal = selector.kind === 'ref' ? a.program.ops.find(node => node.id === selector.node) : null
    assert.ok(selector.kind === 'constant' || literal?.kind === 'utility-constant' && literal.type === 'INT')
    assert.equal(selector.kind === 'constant' ? selector.value : literal.value, expected.index)
    assert.ok(!b.program.ops.some(op => op.source.nodeType === 'FunctionNodeGetVectorComponent'))
    assert.ok(b.program.ops.some(op => op.source.nodeType === 'ShaderNodeSeparateXYZ'))
  }
  const prefix = 'blender-5-3-' + proof.device.toLowerCase()
  const image = files.get(prefix + '-component-independent-image'), constant = files.get(prefix + '-component-independent-constant')
  assert.deepEqual(image.expected, image.input)
  assert.ok(constant.expected.every((value, index) => value === [.25, .5, .75, 1][index % 4]))
  const refusals = json(join(directory, 'refusals.json')); assert.equal(refusals.length, 11)
  assert.deepEqual(refusals.slice(0, 4).map(row => row.index), [-2147483648, -1, 3, 2147483647])
  assert.deepEqual(refusals.slice(4).map(row => row.selector), ['float', 'boolean', 'computed', 'field', 'group-field', 'animated', 'version'])
  for (const row of refusals) {
    assert.equal(row.program.status, 'unsupported')
    const diagnostic = row.program.diagnostics.at(-1)
    if (row.selector === 'animated') { assert.equal(diagnostic.code, 'animated-tree'); assert.match(diagnostic.message, /animation or drivers/) }
    else { assert.equal(diagnostic.code, 'unsupported-vector-component'); assert.equal(diagnostic.nodeType, 'FunctionNodeGetVectorComponent'); assert.match(diagnostic.message, row.selector === 'version' ? /measured Blender 5.3.0/ : /fixed typed integer Index 0, 1 or 2/) }
  }
  return { ...base, status: proof.status, numericalComponentCases: 63, pairedSeparateCases: 63, controlCases: 2, caseIds: expectedIds }
}

export function validateCompositorComponentBrowser(records, profiles) {
  const qualified = profiles.filter(profile => profile.status === 'qualified-fixed-selection')
  assert.ok(qualified.length > 0, 'Native absence cannot become a numerical Component pass')
  const ids = qualified.flatMap(profile => profile.caseIds).sort(); assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(records.map(record => record.backend).sort(), ['webgl2', 'webgpu'])
  for (const record of records) {
    assert.ok(!record.error && !record.failure); assert.deepEqual(record.pageErrors, []); assert.deepEqual(record.consoleErrors, [])
    assert.ok(record.gpu && Object.keys(record.gpu).length)
    assert.deepEqual(record.rows.map(row => row.case).sort(), ids)
    for (const row of record.rows) {
      assert.equal(row.blenderHash, builds['5.3.0']); assert.equal(row.max, 0); assert.equal(row.calibration, 0)
      assert.deepEqual(row.channels, [0, 0, 0, 0]); assert.deepEqual(row.shaderErrors, []); assert.equal(row.exactAlpha, true)
    }
  }
  return { status: 'qualified', nativeComponentCases: qualified.length * 63, pairedSeparateCases: qualified.length * 63,
    independentControlCases: qualified.length * 2, browserReadbacks: ids.length * 2, maximumAbsoluteError: 0, browserZeroSignClaim: false }
}
