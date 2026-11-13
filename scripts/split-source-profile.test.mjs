import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { readSplitSourceProfile } from './lib/split-source-profile.mjs'

const root = new URL('..', import.meta.url)
function fixture(run, { refused = true, native = '5.2.0 LTS', device = 'GPU', backend = 'OPENGL' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-split-profile-')), input = [.2, .3, .4, 2]
  const control = { case: 'native-split-independent-control', width: 1, height: 1, input, expected: input,
    blenderVersion: native, blenderHash: 'fbe6228777e7', compositorDevice: device,
    program: { status: 'extracted', ops: [{ kind: 'render-pass' }] } }
  const rows = [{ case: control.case }]
  const qualification = { protocol: 'blendlink-split-source-profile-v1', status: refused ? 'source-profile-refused' : 'qualified',
    native, hash: control.blenderHash, device, sourceBackend: backend, sourcePreserved: true,
    cases: refused ? 0 : 2, numericalSplitCases: refused ? 0 : 1, controlCases: 1, profileRefusals: [] }
  const message = 'Split rotated GPU lines need a verified native projection model; use the CPU compositor or source baking'
  const diagnostic = { code: 'unsupported-split-domain', nodeType: 'CompositorNodeSplit', node: 'Artist Split', socket: 'Image', message }
  const record = { ...control, case: 'native-split-field', expected: [-.25, 1, .75, 2], output: 'Image', sourcePreserved: true,
    sourceBackend: backend, sourceFingerprint: 'Artist Split CompositorNodeSplit', diagnostics: [diagnostic],
    program: refused ? { status: 'unsupported', diagnostics: [diagnostic] } : { status: 'extracted', ops: [{ kind: 'image-split', type: 'RGBA',
      source: { nodeType: 'CompositorNodeSplit', output: 'Image' }, properties: { evaluation_device: device, native_gpu_backend: backend,
        split_model: native.startsWith('4.') ? device === 'CPU' ? 'legacy-cpu-axis-v1' : 'legacy-gpu-axis-v1' : 'native-line-f32-v1' } }] } }
  const file = record.case + '.json'
  const saveRecord = () => {
    const bytes = JSON.stringify(record); writeFileSync(join(directory, file), bytes)
    if (refused) qualification.profileRefusals = [{ file, reason: message, sha256: createHash('sha256').update(bytes).digest('hex') }]
  }
  saveRecord()
  if (!refused) rows.push({ case: record.case })
  const save = () => {
    writeFileSync(join(directory, control.case + '.json'), JSON.stringify(control))
    writeFileSync(join(directory, 'index.json'), JSON.stringify(rows))
    writeFileSync(join(directory, 'qualification.json'), JSON.stringify(qualification))
  }
  save()
  try { run({ directory, rows, qualification, control, record, save, saveRecord }) }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

test('a modern unqualified GPU source retains hashed native Split pixels without claiming numeric Split coverage', () => fixture(({ directory, rows }) => {
  const profile = readSplitSourceProfile(directory, rows)
  assert.equal(profile.numericalSplitCases, 0); assert.equal(profile.controlCases, 1)
  const result = spawnSync(process.execPath, ['scripts/check-split-profile.mjs', directory], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /REFUSAL_VERIFIED numericalSplitCases=0/)
  assert.doesNotMatch(result.stdout, /NUMERICAL_SOURCE_VERIFIED/)
  assert.equal(JSON.parse(readFileSync(join(directory, 'source-profile-summary.json'))).cases, 0)
}))

test('Metal, CPU and legacy GPU profiles require actual Split programs rather than control-only admission', () => {
  for (const options of [{ device: 'CPU' }, { backend: 'METAL' }, { native: '4.2.0' }]) fixture(({ directory, rows }) =>
    assert.throws(() => readSplitSourceProfile(directory, rows), /requires numerical Split/), options)
  for (const options of [{ device: 'CPU' }, { backend: 'METAL' }, { native: '4.2.0' }, { native: '4.2.0', device: 'CPU' }])
    fixture(({ directory, rows, record, saveRecord }) => {
      assert.equal(readSplitSourceProfile(directory, rows).numericalSplitCases, 1)
      record.program.ops = [{ kind: 'render-pass' }]; saveRecord()
      assert.throws(() => readSplitSourceProfile(directory, rows), /cannot replace numerical/)
    }, { ...options, refused: false })
  fixture(({ directory, rows }) => assert.throws(() => readSplitSourceProfile(directory, rows), /requires explicit source refusal/), { refused: false })
})

test('source refusal independently validates native profile, exact diagnostics, preservation and retained output', () => {
  for (const mutate of [r => { r.diagnostics[0].message = 'another error' }, r => { r.diagnostics[0].nodeType = 'CompositorNodeViewer' },
    r => { r.diagnostics[0].code = 'unsupported-transform-mode' }, r => { r.sourcePreserved = false },
    r => { r.sourceFingerprint = '' }, r => { r.expected = r.input }, r => { r.expected.pop() },
    r => { r.sourceBackend = 'METAL' }, r => { r.blenderHash = 'aaaaaaaaaaaa' }])
    fixture(({ directory, rows, record, save, saveRecord }) => {
      mutate(record); saveRecord(); save(); assert.throws(() => readSplitSourceProfile(directory, rows))
    })
  fixture(({ directory, rows, qualification }) => {
    writeFileSync(join(directory, qualification.profileRefusals[0].file), '{}')
    assert.throws(() => readSplitSourceProfile(directory, rows))
  })
})

test('unknown future protocols, missing/extra cases and unsafe paths fail closed', () => {
  for (const patch of [{ protocol: 'future' }, { status: 'not-applicable' }, { native: '5.4.0' }, { native: '5.2.1' },
    { numericalSplitCases: 1 }, { controlCases: 0 }, { sourcePreserved: false }, { profileRefusals: [] }])
    fixture(({ directory, rows, qualification, save }) => {
      Object.assign(qualification, patch); save(); assert.throws(() => readSplitSourceProfile(directory, rows))
    })
  fixture(({ directory, rows, qualification, save }) => {
    assert.throws(() => readSplitSourceProfile(directory, [...rows, rows[0]]))
    qualification.profileRefusals[0].file = '../outside.json'; save(); assert.throws(() => readSplitSourceProfile(directory, rows))
  })
})

test('Split catalog and native canaries distinguish partial image semantics from Viewer/control-only coverage', () => {
  const capability = JSON.parse(readFileSync(new URL('../docs/node-capabilities.json', import.meta.url)))
  const split = capability.entries['compositor:CompositorNodeSplit']
  assert.equal(split.category, 'partial'); assert.deepEqual(split.runtimeOps, ['image-split'])
  assert.deepEqual(split.modes.axis.partial, ['X', 'Y']); assert.ok(!capability.knownUnsupported.includes('compositor:CompositorNodeSplit'))
  for (const version of ['4.2.0', '5.2.0', '5.3.0']) {
    const catalog = JSON.parse(readFileSync(new URL('../docs/node-coverage/blender-' + version + '.json', import.meta.url)))
    const node = catalog.domains.compositor.nodes.find(node => node.id === 'CompositorNodeSplit')
    assert.equal(node.enumStateExploration.status, 'complete')
    assert.deepEqual(Object.keys(node.enums), version === '4.2.0' ? ['axis'] : [])
  }
  const workflow = readFileSync(new URL('../.github/workflows/static-noise.yml', import.meta.url), 'utf8')
  for (const family of ['Split', 'Split source profile', 'Split legacy']) assert.ok(workflow.includes('- family: ' + family + '\n'))
  assert.match(workflow, /node scripts\/check-split-profile\.mjs/)
  const gate = readFileSync(new URL('../scripts/test-node-parity.mjs', import.meta.url), 'utf8')
  assert.match(gate, /split-gpu-independent-control/); assert.match(gate, /readSplitSourceProfile/)
})
