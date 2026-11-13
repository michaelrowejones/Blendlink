import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const safe = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const gpuMessage = 'Map Value currently requires CPU source compositing or the verified Metal GPU source backend'
const allowedRefusals = new Set([gpuMessage,
  'Map Value GPU implicit color/vector averaging currently requires Offset zero; use explicit channel separation for nonzero Offset because native fused averaging remains unported',
  'Map Value requires explicit channel separation for legacy scalar conversions farther upstream, within the qualified 256-input dependency budget',
  'Map Value requires fixed safe inputs or authored Min/Max input bounds away from zero, with finite normal-or-zero add/multiply results; unknown fields and underflow/overflow need source evaluation'])
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const sources = {
  'compositor_graph.py': 'packages/blendlink/blender/compositor_graph.py',
  'compositor_map_value.py': 'packages/blendlink/blender/compositor_map_value.py',
  'compositor_map_value_check.py': 'packages/blender-addon/tests/compositor_map_value_check.py',
  'compositor_map_value_domain.py': 'packages/blendlink/blender/compositor_map_value_domain.py',
}
function hashes(q) {
  assert.deepEqual(Object.keys(q.sources).sort(), Object.keys(sources).sort())
  for (const digest of Object.values(q.sources)) assert.match(digest, /^[a-f0-9]{64}$/)
}
export function verifyMapValueCurrentSources(profile, root) {
  const records = profile.status === 'native-node-absent'
    ? { 'compositor_map_value_check.py': profile.fixtureSha256 } : profile.sources
  for (const [name, expected] of Object.entries(records))
    assert.equal(createHash('sha256').update(readFileSync(join(root, sources[name]))).digest('hex'), expected, 'Stale native Map Value source: ' + name)
}
function pixels(record) {
  assert.ok(Number.isInteger(record.width) && record.width > 0 && record.width <= 8192)
  assert.ok(Number.isInteger(record.height) && record.height > 0 && record.height <= 8192)
  for (const key of ['input', 'expected']) {
    assert.ok(Array.isArray(record[key])); assert.equal(record[key].length, record.width * record.height * 4)
    assert.ok(record[key].every(value => typeof value === 'number' && Number.isFinite(value)))
  }
}
function native(qualification) {
  assert.match(qualification.native, /^(?:4\.2\.0|5\.[23]\.0)(?:\D|$)/)
  assert.match(qualification.hash, /^[a-f0-9]{12,40}$/)
}
function refusals(directory, qualification, control, sourceOnly = false) {
  assert.ok(Array.isArray(qualification.profileRefusals))
  if (sourceOnly) assert.equal(qualification.profileRefusals.length, 1)
  const names = new Set()
  for (const item of qualification.profileRefusals) {
    assert.match(item.file, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/); assert.ok(!names.has(item.file)); names.add(item.file)
    assert.match(item.sha256, /^[a-f0-9]{64}$/); assert.ok(allowedRefusals.has(item.reason))
    if (sourceOnly) assert.equal(item.reason, gpuMessage)
    const bytes = readFileSync(join(directory, item.file)); assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
    const record = JSON.parse(bytes)
    assert.equal(item.file, record.case + '.json'); assert.equal(record.native, qualification.native)
    assert.equal(record.device, qualification.device); assert.equal(record.sourceBackend, qualification.sourceBackend)
    assert.equal(record.sourcePreserved, true); assert.equal(record.program.status, 'unsupported')
    assert.equal(record.program.blenderVersion, qualification.native); assert.equal(record.program.diagnostics?.length, 1)
    const diagnostic = record.program.diagnostics[0]
    assert.equal(diagnostic.code, 'unsupported-map-value'); assert.equal(diagnostic.nodeType, 'CompositorNodeMapValue')
    assert.equal(diagnostic.socket, 'Value'); assert.equal(diagnostic.message, item.reason)
    assert.ok(typeof diagnostic.node === 'string' && diagnostic.node.length > 0)
    pixels(record); assert.equal(record.width, control.width); assert.equal(record.height, control.height)
    assert.deepEqual(record.input, control.input)
  }
}

/** Independently distinguishes numerical source coverage, native absence and
 * a control-only GPU source refusal. A pass sentinel cannot select the result. */
export function readMapValueSourceProfile(directory, rows) {
  const q = json(join(directory, 'qualification.json')); native(q)
  assert.ok(Array.isArray(rows))
  if (q.status === 'native-node-absent') {
    assert.equal(q.protocol, 'blendlink-map-value-native-absence-v1'); assert.equal(q.nodeType, 'CompositorNodeMapValue')
    assert.match(q.native, /^5\.[23]\.0(?:\D|$)/); assert.equal(q.nativeApplicable, false); assert.equal(q.cases, 0); assert.equal(rows.length, 0)
    assert.match(q.fixtureSha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(Object.keys(q.contexts).sort(), ['group', 'root'])
    for (const context of Object.values(q.contexts)) {
      assert.equal(context.creatable, false)
      assert.equal(context.reason.trim(), 'Error: Node type CompositorNodeMapValue undefined')
    }
    return { ...q, numericalMapValueCases: 0, controlCases: 0 }
  }
  assert.ok(q.status === 'qualified' || q.status === 'source-profile-refused', 'Unknown Map Value profile status')
  assert.match(q.native, /^4\.2\.0(?:\D|$)/); assert.equal(q.sourcePreserved, true)
  hashes(q)
  assert.ok(q.device === 'CPU' || q.device === 'GPU'); assert.match(q.sourceBackend, /^[A-Z][A-Z0-9_]*$/)
  const seen = new Set(), records = []
  for (const row of rows) {
    assert.match(row.case, safe); assert.ok(!seen.has(row.case)); seen.add(row.case)
    const record = json(join(directory, row.case + '.json'))
    assert.equal(record.case, row.case); assert.equal(record.blenderVersion, q.native)
    assert.equal(record.blenderHash, q.hash); assert.equal(record.compositorDevice, q.device)
    assert.equal(record.program.status, 'extracted'); assert.ok(Array.isArray(record.program.ops) && record.program.ops.length > 0)
    pixels(record); records.push(record)
  }
  const controls = records.filter(record => record.case.endsWith('-map-value-independent-control'))
  assert.equal(controls.length, 1)
  const control = controls[0]
  assert.equal(control.program.ops.length, 1); assert.equal(control.program.ops[0].kind, 'render-pass')
  assert.equal(control.program.output.kind, 'ref'); assert.equal(control.program.output.node, control.program.ops[0].id)
  const qualified = q.device === 'CPU' || q.sourceBackend === 'METAL'
  if (q.status === 'source-profile-refused') {
    assert.equal(q.protocol, 'blendlink-map-value-gpu-source-profile-v1'); assert.equal(qualified, false, 'Qualified source needs numerical Map Value coverage')
    assert.equal(q.device, 'GPU'); assert.equal(rows.length, 1); assert.equal(q.cases, 0)
    assert.equal(q.numericalMapValueCases, 0); assert.equal(q.controlCases, 1)
    refusals(directory, q, control, true)
    return q
  }
  assert.equal(qualified, true, 'Unqualified GPU source needs a named refusal')
  assert.equal(q.cases, rows.length); assert.ok(rows.length > 1); assert.equal(q.copiedPackageQualifiedProbe, true)
  let numerical = 0
  for (const record of records) {
    if (record === control) continue
    const byId = new Map(record.program.ops.map(op => [op.id, op])), visiting = new Set()
    let budget = 512
    function reachable(v) {
      assert.ok(--budget >= 0 && v)
      if (v.kind === 'convert') return reachable(v.input)
      if (v.kind === 'constant') return false
      assert.equal(v.kind, 'ref'); const op = byId.get(v.node); assert.ok(op && !visiting.has(v.node))
      if (op.kind === 'map-value') {
        assert.equal(op.type, 'VALUE'); assert.equal(op.source.nodeType, 'CompositorNodeMapValue'); assert.equal(op.source.output, 'Value')
        assert.equal(op.properties.evaluation_device, q.device); assert.equal(op.properties.map_value_model, 'native-legacy-map-value-f32-v1')
        assert.equal(op.properties.map_value_domain_model, 'finite-normal-or-zero-v1'); assert.ok(['fixed', 'bounded-field'].includes(op.properties.map_value_domain?.kind))
        return true
      }
      visiting.add(v.node)
      const found = Object.values(op.inputs).some(input => reachable(input.value))
      visiting.delete(v.node); return found
    }
    assert.equal(record.exactAlpha, true); assert.ok(reachable(record.program.output), 'Independent controls cannot replace reachable numerical Map Value cases'); numerical++
  }
  refusals(directory, q, control)
  assert.equal(numerical, rows.length - 1)
  return { ...q, numericalMapValueCases: numerical, controlCases: 1 }
}
