import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const message = 'Split rotated GPU lines need a verified native projection model; use the CPU compositor or source baking'
const caseName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
function pixels(record) {
  assert.ok(Number.isInteger(record.width) && record.width > 0 && record.width <= 8192)
  assert.ok(Number.isInteger(record.height) && record.height > 0 && record.height <= 8192)
  for (const key of ['input', 'expected']) {
    assert.ok(Array.isArray(record[key])); assert.equal(record[key].length, record.width * record.height * 4)
    assert.ok(record[key].every(value => typeof value === 'number' && Number.isFinite(value)))
  }
}

/** Independent proof accounting: a source refusal has zero numerical Split
 * cases. Its hashed native image is retained outside the control-only index. */
export function readSplitSourceProfile(directory, rows) {
  const qualification = JSON.parse(readFileSync(join(directory, 'qualification.json'), 'utf8'))
  assert.equal(qualification.protocol, 'blendlink-split-source-profile-v1')
  assert.ok(['qualified', 'source-profile-refused'].includes(qualification.status))
  assert.match(qualification.native, /^(?:4\.2\.0|5\.[23]\.0)(?:\D|$)/)
  assert.match(qualification.hash, /^[a-f0-9]{12,40}$/)
  assert.ok(['CPU', 'GPU'].includes(qualification.device))
  assert.match(qualification.sourceBackend, /^[A-Z][A-Z0-9_]*$/)
  assert.equal(qualification.sourcePreserved, true); assert.equal(qualification.controlCases, 1)
  assert.ok(Array.isArray(rows) && rows.length > 0)
  const names = new Set(), records = []
  for (const row of rows) {
    assert.match(row.case, caseName); assert.ok(!names.has(row.case), 'Duplicate Split case'); names.add(row.case)
    const record = JSON.parse(readFileSync(join(directory, row.case + '.json'), 'utf8'))
    assert.equal(record.case, row.case); assert.equal(record.blenderVersion, qualification.native)
    assert.equal(record.blenderHash, qualification.hash); assert.equal(record.compositorDevice, qualification.device)
    assert.equal(record.program.status, 'extracted'); assert.ok(record.program.ops.length > 0); pixels(record)
    records.push(record)
  }
  const controls = records.filter(record => record.case.endsWith('-split-independent-control'))
  assert.equal(controls.length, 1)
  const control = controls[0]
  assert.ok(control.program.ops.every(op => op.kind === 'render-pass'), 'Independent control cannot contain Split or another effect')
  const modern = /^5\./.test(qualification.native)
  const qualifiedProfile = qualification.device === 'CPU' || !modern || qualification.sourceBackend === 'METAL'
  if (qualification.status === 'source-profile-refused') {
    assert.equal(qualifiedProfile, false, 'A qualified profile requires numerical Split coverage')
    assert.equal(qualification.device, 'GPU'); assert.equal(modern, true)
    assert.equal(rows.length, 1); assert.equal(qualification.cases, 0); assert.equal(qualification.numericalSplitCases, 0)
    assert.equal(qualification.profileRefusals?.length, 1)
    const item = qualification.profileRefusals[0]
    assert.match(item.file, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/); assert.match(item.sha256, /^[a-f0-9]{64}$/)
    assert.equal(item.reason, message)
    const bytes = readFileSync(join(directory, item.file))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    const record = JSON.parse(bytes)
    assert.match(record.case, caseName); assert.equal(item.file, record.case + '.json')
    assert.equal(record.output, 'Image'); assert.equal(record.compositorDevice, 'GPU')
    assert.equal(record.sourceBackend, qualification.sourceBackend); assert.equal(record.blenderVersion, qualification.native)
    assert.equal(record.blenderHash, qualification.hash); assert.equal(record.sourcePreserved, true)
    assert.ok(typeof record.sourceFingerprint === 'string' && record.sourceFingerprint.includes('CompositorNodeSplit'))
    assert.equal(record.program.status, 'unsupported'); assert.equal(record.diagnostics?.length, 1)
    assert.deepEqual(record.program.diagnostics, record.diagnostics)
    const diagnostic = record.diagnostics[0]
    assert.equal(diagnostic.code, 'unsupported-split-domain'); assert.equal(diagnostic.nodeType, 'CompositorNodeSplit')
    assert.equal(diagnostic.socket, 'Image'); assert.equal(diagnostic.message, message)
    assert.ok(typeof diagnostic.node === 'string' && diagnostic.node.length > 0)
    pixels(record); assert.equal(record.width, control.width); assert.equal(record.height, control.height)
    assert.deepEqual(record.input, control.input)
    assert.notDeepEqual(record.expected, control.expected, 'Retained native Split image cannot be replaced by its input control')
  } else {
    assert.equal(qualifiedProfile, true, 'Unverified modern GPU projection requires explicit source refusal')
    assert.equal(qualification.cases, rows.length); assert.ok(rows.length > 1)
    let numerical = 0
    for (const record of records) {
      const splits = record.program.ops.filter(op => op.kind === 'image-split')
      if (record !== control) assert.ok(splits.length > 0, 'Independent controls cannot replace numerical Split cases')
      for (const op of splits) {
        assert.equal(op.source.nodeType, 'CompositorNodeSplit'); assert.equal(op.source.output, 'Image'); assert.equal(op.type, 'RGBA')
        assert.equal(op.properties.evaluation_device, qualification.device)
        assert.equal(op.properties.split_model, modern ? 'native-line-f32-v1'
          : qualification.device === 'CPU' ? 'legacy-cpu-axis-v1' : 'legacy-gpu-axis-v1')
        if (modern && qualification.device === 'GPU') assert.equal(op.properties.native_gpu_backend, 'METAL')
      }
      if (splits.length) numerical++
    }
    assert.equal(qualification.numericalSplitCases, numerical); assert.equal(numerical, rows.length - 1)
    assert.ok(!qualification.profileRefusals || qualification.profileRefusals.length === 0)
  }
  return qualification
}
