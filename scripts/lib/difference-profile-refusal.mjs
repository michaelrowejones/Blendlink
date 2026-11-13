import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const message = 'Difference Key GPU OpenGL source precision profile is unverified; use source baking'
const filename = /^[a-zA-Z0-9_.-]+\.json$/
// Independent retained native observation (artifact13995933757). A regression
// in the production admission predicate must not turn this required numerical
// profile into a refused-family success.
const requiredNumericalProfile = {
  platform: 'linux', architecture: 'x86_64', blenderVersion: [5, 2, 0], blenderHash: 'fbe6228777e7',
  requestedBackend: 'OPENGL', renderer: 'llvmpipe (LLVM 20.1.2, 256 bits)', vendor: 'Mesa',
  version: '4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4', deviceType: 'SOFTWARE', backend: 'OPENGL',
}
const pixels = record => {
  assert.ok(Number.isInteger(record.width) && record.width > 0)
  assert.ok(Number.isInteger(record.height) && record.height > 0)
  for (const key of ['input', 'expected']) {
    assert.ok(Array.isArray(record[key]))
    assert.equal(record[key].length, record.width * record.height * 4)
    assert.ok(record[key].every(value => typeof value === 'number' && Number.isFinite(value)))
  }
}

/** A refused source profile never completes the numerical Difference family.
 * Its independent control can still be sent through the browser separately. */
export function readDifferenceProfileRefusal(directory, rows, isMeasuredProfile) {
  const file = join(directory, 'qualification.json')
  if (!existsSync(file)) return null
  const qualification = JSON.parse(readFileSync(file, 'utf8'))
  if (qualification.status !== 'source-profile-refused') return null
  assert.equal(qualification.protocol, 'blendlink-difference-gpu-source-profile-v1')
  assert.equal(qualification.device, 'GPU'); assert.equal(qualification.backend, 'OPENGL')
  assert.equal(qualification.cases, 0); assert.equal(qualification.numericalDifferenceCases, 0)
  assert.equal(qualification.controlCases, 1); assert.equal(qualification.sourcePreserved, true)
  assert.ok(qualification.nativeGpuProfile && typeof qualification.nativeGpuProfile === 'object')
  assert.equal(qualification.nativeGpuProfile.requestedBackend, 'OPENGL')
  assert.notDeepEqual(qualification.nativeGpuProfile, requiredNumericalProfile,
    'The retained qualified profile requires numerical Difference coverage')
  assert.equal(isMeasuredProfile(qualification.nativeGpuProfile), false,
    'A qualified native profile cannot use the refused-family protocol')
  assert.equal(rows.length, 1)
  assert.match(rows[0].case, /^[a-zA-Z0-9_.-]+-difference-key-independent-control$/)
  const control = JSON.parse(readFileSync(join(directory, rows[0].case + '.json'), 'utf8'))
  assert.equal(control.compositorDevice, 'GPU'); assert.equal(control.program.status, 'extracted')
  assert.ok(control.program.ops.length > 0 && control.program.ops.every(op => op.kind === 'render-pass'))
  pixels(control)
  assert.equal(qualification.profileRefusals?.length, 2)
  assert.deepEqual(qualification.profileRefusals.map(item => item.output).sort(), ['Image', 'Matte'])
  for (const item of qualification.profileRefusals) {
    assert.match(item.file, filename); assert.equal(item.file, item.case + '.json')
    assert.match(item.sha256, /^[a-f0-9]{64}$/); assert.equal(item.reason, message)
    const bytes = readFileSync(join(directory, item.file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    const record = JSON.parse(bytes)
    assert.equal(record.case, item.case); assert.equal(record.output, item.output)
    assert.equal(record.compositorDevice, 'GPU'); assert.equal(record.sourcePreserved, true)
    assert.equal(record.program.status, 'unsupported')
    assert.deepEqual(record.nativeGpuProfile, qualification.nativeGpuProfile)
    assert.ok(typeof record.sourceFingerprint === 'string' && record.sourceFingerprint.includes('CompositorNodeDiffMatte'))
    assert.equal(record.diagnostics?.length, 1)
    const diagnostic = record.diagnostics[0]
    assert.equal(diagnostic.code, 'unsupported-difference-key')
    assert.equal(diagnostic.nodeType, 'CompositorNodeDiffMatte')
    assert.ok(typeof diagnostic.node === 'string' && diagnostic.node.length > 0)
    assert.equal(diagnostic.socket, item.output); assert.equal(diagnostic.message, message)
    assert.deepEqual(record.program.diagnostics, record.diagnostics)
    pixels(record); assert.deepEqual(record.input, control.input)
  }
  return qualification
}
