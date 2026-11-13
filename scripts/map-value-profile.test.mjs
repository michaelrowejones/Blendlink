import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { readMapValueSourceProfile, verifyMapValueCurrentSources } from './lib/map-value-profile.mjs'

function fixture(run, absent = false) {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-map-value-profile-')), input = [.25, .5, 2, -1]
  const rows = absent ? [] : [{ case: 'native-map-value-independent-control' }, { case: 'native-map-value-numeric' }]
  const source = { nodeType: 'CompositorNodeMapValue', output: 'Value' }
  const op = { id: 'map', kind: 'map-value', type: 'VALUE', source, inputs: {}, properties: { evaluation_device: 'CPU',
    map_value_model: 'native-legacy-map-value-f32-v1', map_value_domain_model: 'finite-normal-or-zero-v1', map_value_domain: { kind: 'fixed' } } }
  const qualification = absent ? { status: 'native-node-absent', protocol: 'blendlink-map-value-native-absence-v1',
    nodeType: 'CompositorNodeMapValue', native: '5.2.0 LTS', hash: 'fbe6228777e7', cases: 0, nativeApplicable: false, fixtureSha256: 'a'.repeat(64),
    contexts: Object.fromEntries(['root', 'group'].map(name => [name, { creatable: false, reason: 'Error: Node type CompositorNodeMapValue undefined\n' }])) }
    : { status: 'qualified', native: '4.2.0', hash: 'a51f293548ad', device: 'CPU', sourceBackend: 'METAL',
      cases: 2, sourcePreserved: true, copiedPackageQualifiedProbe: true, profileRefusals: [],
      sources: Object.fromEntries(['compositor_graph.py', 'compositor_map_value.py', 'compositor_map_value_check.py', 'compositor_map_value_domain.py'].map(name => [name, 'a'.repeat(64)])) }
  const record = (name, program) => ({ case: name, blenderVersion: qualification.native, blenderHash: qualification.hash,
    compositorDevice: qualification.device, exactAlpha: true, width: 1, height: 1, input, expected: input, program })
  const control = record(rows[0]?.case, { status: 'extracted', ops: [{ id: 'pass', kind: 'render-pass' }], output: { kind: 'ref', node: 'pass' } })
  const numeric = record(rows[1]?.case, { status: 'extracted', ops: [op], output: { kind: 'ref', node: 'map' } })
  const save = () => {
    writeFileSync(join(directory, 'index.json'), JSON.stringify(rows)); writeFileSync(join(directory, 'qualification.json'), JSON.stringify(qualification))
    if (!absent) { writeFileSync(join(directory, control.case + '.json'), JSON.stringify(control)); writeFileSync(join(directory, numeric.case + '.json'), JSON.stringify(numeric)) }
  }
  const sourceRefusal = () => {
    rows.splice(1); control.compositorDevice = 'GPU'
    Object.assign(qualification, { status: 'source-profile-refused', protocol: 'blendlink-map-value-gpu-source-profile-v1',
      device: 'GPU', sourceBackend: 'OPENGL', cases: 0, numericalMapValueCases: 0, controlCases: 1 })
    const message = 'Map Value currently requires CPU source compositing or the verified Metal GPU source backend'
    const native = { case: 'native-refusal', native: qualification.native, device: 'GPU', sourceBackend: 'OPENGL',
      sourcePreserved: true, width: 1, height: 1, input, expected: input, program: { status: 'unsupported', blenderVersion: qualification.native,
        diagnostics: [{ code: 'unsupported-map-value', nodeType: 'CompositorNodeMapValue', socket: 'Value', node: 'Artist Map Value', message }] } }
    const bytes = JSON.stringify(native); writeFileSync(join(directory, native.case + '.json'), bytes)
    qualification.profileRefusals = [{ file: native.case + '.json', sha256: createHash('sha256').update(bytes).digest('hex'), reason: message }]
    save(); return native
  }
  save()
  try { run({ directory, rows, qualification, control, numeric, save, sourceRefusal }) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('counts only reachable numerical Map Value graphs with all four Python source hashes', () => fixture(({ directory, rows }) => {
  const result = readMapValueSourceProfile(directory, rows); assert.equal(result.numericalMapValueCases, 1); assert.equal(result.controlCases, 1)
}))
test('rejects controls-only, stale domains, missing source hashes and unrelated output graphs', () => {
  for (const change of [f => { f.rows.splice(1); f.qualification.cases = 1 },
    f => { delete f.qualification.sources['compositor_map_value_domain.py'] },
    f => { delete f.numeric.program.ops[0].properties.map_value_domain_model },
    f => { f.numeric.program.output = { kind: 'constant', type: 'VALUE', value: 1 } }]) fixture(f => { change(f); f.save(); assert.throws(() => readMapValueSourceProfile(f.directory, f.rows)) })
})
test('verifies native absence independently of a pass sentinel', () => fixture(({ directory, rows, qualification, save }) => {
  assert.equal(readMapValueSourceProfile(directory, rows).numericalMapValueCases, 0)
  qualification.native = '5.3.0'; save(); assert.equal(readMapValueSourceProfile(directory, rows).status, 'native-node-absent')
}, true))
test('rejects fabricated modern N/A and unknown native versions/schemas', () => {
  for (const change of [q => { q.native = '4.2.0' }, q => { q.native = '5.4.0' }, q => { delete q.protocol },
    q => { q.nodeType = 'OtherNode' }, q => { delete q.contexts.group }, q => { q.contexts.root.creatable = true },
    q => { q.contexts.root.reason = 'unrelated renderer failure' }, q => { q.cases = 1 }])
    fixture(({ directory, rows, qualification, save }) => { change(qualification); save(); assert.throws(() => readMapValueSourceProfile(directory, rows)) }, true)
})
test('separates a hashed native GPU refusal from its input-only control', () => fixture(f => {
  f.sourceRefusal(); const result = readMapValueSourceProfile(f.directory, f.rows)
  assert.equal(result.numericalMapValueCases, 0); assert.equal(result.controlCases, 1)
}))
test('rejects changed/missing/unsafe refusal evidence and fabricated qualified source refusals', () => {
  for (const change of [f => { f.qualification.sourceBackend = 'METAL' }, f => { f.qualification.device = 'CPU' },
    f => { f.qualification.profileRefusals = [] }, f => { f.qualification.profileRefusals[0].file = '../escape.json' },
    f => { writeFileSync(join(f.directory, f.qualification.profileRefusals[0].file), '{}') },
    f => { f.rows.push({ case: 'extra' }) }, f => { f.qualification.numericalMapValueCases = 1 }])
    fixture(f => { f.sourceRefusal(); change(f); f.save(); assert.throws(() => readMapValueSourceProfile(f.directory, f.rows)) })
})
test('rejects unknown status, duplicate/unsafe numeric rows and unqualified GPU numerical claims', () => {
  for (const change of [f => { f.qualification.status = 'passed' }, f => { f.qualification.device = 'GPU'; f.qualification.sourceBackend = 'OPENGL' },
    f => { f.rows[1].case = f.rows[0].case }, f => { f.rows[1].case = '../outside' }])
    fixture(f => { change(f); f.save(); assert.throws(() => readMapValueSourceProfile(f.directory, f.rows)) })
})
test('CLI requires the expected outcome and cannot turn native absence into numerical coverage', () => fixture(({ directory }) => {
  const output = execFileSync(process.execPath, ['scripts/check-map-value-profile.mjs', '--expect', 'native-node-absent', directory], { encoding: 'utf8' })
  assert.match(output, /status=native-node-absent numericalMapValueCases=0 independentControls=0/)
  assert.throws(() => execFileSync(process.execPath, ['scripts/check-map-value-profile.mjs', '--expect', 'qualified', directory], { stdio: 'pipe' }))
}, true))
test('current-source verification checks all four captured files and the absence fixture independently', () => {
  for (const absent of [false, true]) fixture(({ directory, qualification, rows, save }) => {
    const files = { 'compositor_graph.py': 'packages/blendlink/blender/compositor_graph.py',
      'compositor_map_value.py': 'packages/blendlink/blender/compositor_map_value.py',
      'compositor_map_value_domain.py': 'packages/blendlink/blender/compositor_map_value_domain.py',
      'compositor_map_value_check.py': 'packages/blender-addon/tests/compositor_map_value_check.py' }
    const root = join(directory, 'candidate')
    for (const [name, path] of Object.entries(files)) {
      const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, name)
      const digest = createHash('sha256').update(name).digest('hex')
      if (absent && name === 'compositor_map_value_check.py') qualification.fixtureSha256 = digest
      else if (!absent) qualification.sources[name] = digest
    }
    save(); const profile = readMapValueSourceProfile(directory, rows); verifyMapValueCurrentSources(profile, root)
    const changed = absent ? files['compositor_map_value_check.py'] : files['compositor_map_value_domain.py']
    writeFileSync(join(root, changed), 'stale source'); assert.throws(() => verifyMapValueCurrentSources(profile, root), /Stale native/)
  }, absent)
})
test('catalog and legacy/N-A canaries keep numerical, GPU refusal and native absence distinct', () => {
  const cap = JSON.parse(readFileSync(new URL('../docs/node-capabilities.json', import.meta.url)))
  const entry = cap.entries['compositor:CompositorNodeMapValue']
  assert.equal(entry.category, 'partial'); assert.deepEqual(entry.runtimeOps, ['map-value'])
  assert.ok(!cap.knownUnsupported.includes('compositor:CompositorNodeMapValue'))
  assert.equal(entry.verification.nativePythonSourceHashes, 4)
  for (const version of ['4.2.0', '5.2.0', '5.3.0']) {
    const catalog = JSON.parse(readFileSync(new URL('../docs/node-coverage/blender-' + version + '.json', import.meta.url)))
    const node = catalog.domains.compositor.nodes.find(node => node.id === 'CompositorNodeMapValue')
    if (version === '4.2.0') assert.equal(node.enumStateExploration.status, 'complete')
    else assert.equal(node, undefined)
  }
  const workflow = readFileSync(new URL('../.github/workflows/static-noise.yml', import.meta.url), 'utf8')
  for (const family of ['Map Value', 'Map Value source profile', 'Map Value modern absence'])
    assert.ok(workflow.includes('- family: ' + family + '\n'))
  assert.match(workflow, /map-value\n\s+profile_expected: qualified\n\s+blender_version: '4\.2\.0'/)
  assert.match(workflow, /map-value-source-profile\n\s+profile_expected: source-profile-refused\n\s+blender_version: '4\.2\.0'/)
  assert.match(workflow, /map-value-native-absent\n\s+profile_expected: native-node-absent/)
  assert.match(workflow, /check-map-value-profile\.mjs --current-sources --expect/)
  assert.match(workflow, /if \[ "\$SOURCE_PROFILE_EXPECTED" = "native-node-absent" \]; then[\s\S]*?exit 0/)
})
