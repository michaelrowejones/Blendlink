import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const message = 'Channel Key currently requires CPU source compositing or the verified Metal GPU source backend; other GPU arithmetic profiles remain unverified'
const filename = /^[a-zA-Z0-9_.-]+\.json$/
function pixels(record) {
  assert.ok(Number.isInteger(record.width) && record.width > 0)
  assert.ok(Number.isInteger(record.height) && record.height > 0)
  for (const key of ['input', 'expected']) {
    assert.ok(Array.isArray(record[key])); assert.equal(record[key].length, record.width * record.height * 4)
    assert.ok(record[key].every(value => typeof value === 'number' && Number.isFinite(value)))
  }
}

/** Retain an unqualified GPU source as two hashed native refusals plus one
 * independent control. It never counts as numerical Channel Key coverage. */
export function readChannelProfileRefusal(directory, rows) {
  const file = join(directory, 'qualification.json')
  if (!existsSync(file)) return null
  const qualification = JSON.parse(readFileSync(file, 'utf8'))
  if (qualification.status !== 'source-profile-refused') return null
  assert.equal(qualification.protocol, 'blendlink-channel-gpu-source-profile-v1')
  assert.equal(qualification.device, 'GPU'); assert.equal(qualification.sourcePreserved, true)
  assert.ok(typeof qualification.sourceBackend === 'string' && qualification.sourceBackend.length > 0)
  assert.notEqual(qualification.sourceBackend, 'METAL', 'Qualified Metal source requires numerical Channel Key coverage')
  assert.match(qualification.native, /^\d+\.\d+\.\d+/); assert.match(qualification.hash, /^[a-f0-9]{12,40}$/)
  assert.equal(qualification.cases, 0); assert.equal(qualification.numericalChannelCases, 0); assert.equal(qualification.controlCases, 1)
  assert.equal(rows.length, 1); assert.match(rows[0].case, /^[a-zA-Z0-9_.-]+-channel-key-independent-control$/)
  const control = JSON.parse(readFileSync(join(directory, rows[0].case + '.json'), 'utf8'))
  assert.equal(control.compositorDevice, 'GPU'); assert.equal(control.program.status, 'extracted')
  assert.ok(control.program.ops.length > 0 && control.program.ops.every(op => op.kind === 'render-pass'))
  pixels(control)
  assert.equal(qualification.profileRefusals?.length, 2)
  const outputs = []
  for (const item of qualification.profileRefusals) {
    assert.match(item.file, filename); assert.match(item.sha256, /^[a-f0-9]{64}$/); assert.equal(item.reason, message)
    const bytes = readFileSync(join(directory, item.file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    const record = JSON.parse(bytes); assert.equal(item.file, record.case + '.json'); outputs.push(record.output)
    assert.equal(record.compositorDevice, 'GPU'); assert.equal(record.sourceBackend, qualification.sourceBackend)
    assert.equal(record.sourcePreserved, true); assert.equal(record.blenderVersion, qualification.native)
    assert.equal(record.blenderHash, qualification.hash); assert.equal(record.program.status, 'unsupported')
    assert.equal(record.diagnostics?.length, 1); assert.deepEqual(record.program.diagnostics, record.diagnostics)
    const diagnostic = record.diagnostics[0]
    assert.equal(diagnostic.code, 'unsupported-channel-key'); assert.equal(diagnostic.nodeType, 'CompositorNodeChannelMatte')
    assert.equal(diagnostic.socket, record.output); assert.equal(diagnostic.message, message)
    assert.ok(typeof diagnostic.node === 'string' && diagnostic.node.length > 0)
    pixels(record); assert.deepEqual(record.input, control.input)
  }
  assert.deepEqual(outputs.sort(), ['Image', 'Matte'])
  return qualification
}
