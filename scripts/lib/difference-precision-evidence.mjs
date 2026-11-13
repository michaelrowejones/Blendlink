import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const model = 'native-difference-key-cpu-exact-v2'
const builds = { '4.2.0': 'a51f293548ad', '5.2.0': 'fbe6228777e7', '5.3.0': '02f0899d78e3' }
const safe = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
function identity(native, hash) {
  const version = native?.replace(/ LTS$/, '')
  assert.ok(Object.hasOwn(builds, version)); assert.equal(hash, builds[version]); return version
}
function pixels(record) {
  assert.ok(Number.isInteger(record.width) && record.width > 0 && Number.isInteger(record.height) && record.height > 0)
  for (const key of ['input', 'expected']) {
    assert.ok(Array.isArray(record[key])); assert.equal(record[key].length, record.width * record.height * 4)
    assert.ok(record[key].every(value => typeof value === 'number' && Number.isFinite(value)))
  }
}
function records(directory, rows) {
  assert.ok(rows.length > 0); const seen = new Set()
  return rows.map(row => {
    assert.match(row.case, safe); assert.ok(!seen.has(row.case)); seen.add(row.case)
    const record = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
    assert.equal(record.case, row.case); identity(record.blenderVersion, record.blenderHash)
    assert.equal(record.program.status, 'extracted'); pixels(record); return record
  })
}

/** Numerical CPU-v2 coverage is separate from legacy GPU's lack of CPU folding. */
export function readDifferencePrecisionProfile(directory, rows) {
  const values = records(directory, rows), controls = values.filter(record => record.case.endsWith('-difference-exact-independent-control'))
  assert.equal(controls.length, 1); assert.ok(controls[0].program.ops.length > 0 && controls[0].program.ops.every(op => op.kind === 'render-pass'))
  const unavailable = join(directory, 'not-applicable.json')
  if (existsSync(unavailable)) {
    const q = JSON.parse(readFileSync(unavailable, 'utf8'))
    assert.equal(q.reason, 'Legacy GPU compositor does not CPU-fold single values')
    assert.equal(q.numericalCpuExactCases, 0); assert.equal(q.controlCases, 1); assert.equal(rows.length, 1)
    assert.equal(controls[0].compositorDevice, 'GPU'); assert.equal(identity(controls[0].blenderVersion, controls[0].blenderHash), '4.2.0')
    return { status: 'not-applicable', numericalCpuExactCases: 0, controlCases: 1, sourceDevice: 'GPU', reason: q.reason }
  }
  const q = JSON.parse(readFileSync(join(directory, 'qualification.json'), 'utf8'))
  const version = identity(q.native, q.hash)
  assert.equal(q.sourceModel, model); assert.equal(q.sourcePreserved, true)
  assert.ok(['CPU', 'GPU'].includes(q.sourceDevice)); assert.ok(q.sourceDevice === 'CPU' || version !== '4.2.0')
  assert.equal(q.controlCases, 1); assert.equal(q.numericalCpuExactCases, rows.length - 1); assert.ok(rows.length > 1)
  assert.equal(q.nativeGpuFieldCases, 0)
  for (const record of values) {
    assert.equal(record.blenderVersion, q.native); assert.equal(record.blenderHash, q.hash); assert.equal(record.compositorDevice, q.sourceDevice)
    const ops = record.program.ops.filter(op => op.kind === 'difference-key')
    if (record !== controls[0]) assert.ok(ops.length > 0, 'Independent controls cannot replace CPU-v2 programs')
    for (const op of ops) {
      assert.equal(op.properties.difference_key_model, model)
      assert.deepEqual(op.properties.difference_key_native_version, version.split('.').map(Number))
      assert.equal(op.properties.evaluation_device, q.sourceDevice)
      assert.ok(op.properties.difference_key_settings[0] >= 2 ** -50)
      if (q.sourceDevice === 'GPU') assert.equal(op.properties.single_value_device, 'CPU')
    }
  }
  return { status: 'qualified', ...q }
}

/** These two input controls accompany four retained refused native images.
 * None is a completed numerical Difference program. */
export function readDifferenceTinyRefusals(directory, rows) {
  const controls = records(directory, rows); assert.equal(controls.length, 2)
  for (const record of controls) {
    assert.equal(record.compositorDevice, 'CPU'); assert.equal(record.requireFloat32Bits, true)
    assert.ok(record.case.endsWith('-control') && record.program.ops.length > 0 && record.program.ops.every(op => op.kind === 'render-pass'))
  }
  const refusals = JSON.parse(readFileSync(join(directory, 'refusals.json'), 'utf8')); assert.equal(refusals.length, 4)
  const combinations = []
  for (const record of refusals) {
    assert.equal(record.nativeOnly, true); identity(record.native, record.hash)
    assert.equal(record.program.status, 'unsupported'); assert.equal(record.controls.Tolerance, 0)
    assert.ok([0, .125].includes(record.controls.Falloff)); assert.ok(['Image', 'Matte'].includes(record.output))
    const control = controls.find(item => item.controls.Falloff === record.controls.Falloff)
    assert.ok(control); assert.equal(record.native, control.blenderVersion); assert.equal(record.hash, control.blenderHash)
    assert.deepEqual(record.input, control.input); assert.equal(record.expected.length, control.expected.length)
    assert.ok(record.expected.every(Number.isFinite)); assert.equal(record.program.diagnostics.length, 1)
    const diagnostic = record.program.diagnostics[0]
    assert.equal(diagnostic.code, 'unsupported-difference-key'); assert.equal(diagnostic.nodeType, 'CompositorNodeDiffMatte')
    assert.equal(diagnostic.socket, record.output); assert.match(diagnostic.message, /positive Tolerance/)
    assert.match(record.rawFloat32File, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.rgba32f$/)
    const bytes = readFileSync(join(directory, record.rawFloat32File))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.rawFloat32Sha256)
    assert.equal(bytes.length, record.expected.length * 4)
    const expected = new DataView(new ArrayBuffer(4))
    record.expected.forEach((value, index) => { expected.setFloat32(0, value, true); assert.equal(bytes.readUInt32LE(index * 4), expected.getUint32(0, true)) })
    combinations.push(record.controls.Falloff + ':' + record.output)
  }
  assert.deepEqual(combinations.sort(), ['0.125:Image', '0.125:Matte', '0:Image', '0:Matte'])
  return { status: 'source-domain-refused', numericalDifferenceCases: 0, independentControls: 2, nativeRefusals: 4 }
}

export function validateDifferenceMeanReference(record, expectedNative) {
  const version = identity(record.native, record.hash); if (expectedNative) assert.equal(version, expectedNative)
  assert.equal(record.sourceDevice, 'CPU'); assert.ok(['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'].includes(record.sourceEngine))
  assert.equal(record.count, 16384)
  assert.ok(Number.isInteger(record.width) && record.width > 0 && Number.isInteger(record.height) && record.height > 0)
  assert.equal(record.width * record.height, 16384); assert.ok(Array.isArray(record.input) && Array.isArray(record.expected))
  assert.equal(record.input.length, 16384 * 4); assert.equal(record.expected.length, 16384)
  assert.match(record.fixtureSha256, /^[a-f0-9]{64}$/)
  for (let index = 0; index < 16384; index++) {
    assert.equal(record.input[index * 4 + 3], 1)
    const rgb = record.input.slice(index * 4, index * 4 + 3)
    assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 12 && Math.fround(value) === value))
    const sum = Math.fround(Math.fround(rgb[0] + rgb[1]) + rgb[2])
    assert.ok(sum === 0 || sum >= 2 ** -72)
    assert.equal(record.expected[index], Math.fround(sum / 3))
  }
  return { native: record.native, hash: record.hash, nativeValues: 16384, sourceEvaluator: 'CPU' }
}
