import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { COMPONENT_SOURCE_FILES, componentCasePairs, componentCaseIds, readCompositorComponentProfile,
  verifyCompositorComponentCurrentSources, validateCompositorComponentBrowser } from './lib/compositor-vector-component-profile.mjs'
const root = resolve(import.meta.dirname, '..'), hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceSha256 = Object.fromEntries(Object.entries(COMPONENT_SOURCE_FILES).map(([name, path]) => [name, hash(readFileSync(join(root, path)))]))
function fixture(body, device = 'CPU') {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-compositor-component-'))
  const write = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value))
  const source = { schemaVersion: 1, kind: 'blendlink-compositor-vector-component-v1', native: '5.3.0', hash: '02f0899d78e3',
    sourceVersion: [5, 3, 0], device, available: true, status: 'qualified-fixed-selection', selectionCases: 63, pairedSeparateCases: 63, controlCases: 2,
    sourcePreserved: true, nativeWordMismatches: 0, schemaRefusalCases: 4, sourceSha256: { ...sourceSha256 }, sourceEngine: 'CYCLES',
    nativeGpuProfile: { blenderHash: '02f0899d78e3', blenderVersion: [5, 3, 0], backend: 'METAL', vendor: 'synthetic-policy-fixture', renderer: 'policy-fixture' },
    packedSource: { status: 'qualified-zip-source', sourcePreserved: true, indices: [0, 1, 2],
      transports: ['default', 'literal', 'reroute', 'group-default', 'group-literal'], archiveSha256: 'a'.repeat(64),
      modules: { 'compositor_graph.py': sourceSha256['compositor_graph.py'], 'compositor_vector_component.py': sourceSha256['compositor_vector_component.py'] } },
    pairs: componentCasePairs(device).map(({ selection, separate }) => ({ selection, separate, nativeWordMismatches: 0 })) }
  const input = Array.from({ length: 364 }, (_, i) => [1, 2, 3, 1][i % 4])
  const pairs = componentCasePairs(device), byId = new Map(pairs.flatMap(pair => [[pair.selection, pair], [pair.separate, pair]]))
  const rows = componentCaseIds(device).map(name => ({ case: name }))
  for (const { case: name } of rows) {
    const pair = byId.get(name), selected = name === pair?.selection
    const expected = pair ? Array.from({ length: 364 }, (_, i) => i % 4 === 3 ? 1 : pair.index + 1)
      : name.endsWith('-image') ? input : Array.from({ length: 364 }, (_, i) => [.25, .5, .75, 1][i % 4])
    const op = { id: 'selection', kind: 'separate-vector', type: 'VALUE', source: { nodeType: selected ? 'FunctionNodeGetVectorComponent' : 'ShaderNodeSeparateXYZ', output: selected ? 'Value' : 'XYZ'[pair?.index ?? 0] },
      properties: selected ? { vector_component_model: 'native-fixed-vector-component-v1', vector_component_source_version: [5, 3, 0] } : {},
      inputs: { Vector: { socketType: 'VECTOR', value: { kind: 'constant', type: 'VECTOR', value: [1, 2, 3] } },
        ...(selected ? { Index: { socketType: 'INT', value: { kind: 'constant', type: 'INT', value: pair.index } } } : {}) } }
    write(name + '.json', { case: name, blenderHash: source.hash, compositorDevice: device, exactAlpha: true, width: 13, height: 7,
      input, expected, program: { status: 'extracted', ops: pair ? [op] : [] } })
  }
  const refusals = [...[-2147483648, -1, 3, 2147483647].map(index => ({ index })),
    ...['float', 'boolean', 'computed', 'field', 'group-field', 'animated', 'version'].map(selector => ({ selector }))]
  for (const refusal of refusals) refusal.program = { status: 'unsupported', diagnostics: [{
    code: refusal.selector === 'animated' ? 'animated-tree' : 'unsupported-vector-component', nodeType: 'FunctionNodeGetVectorComponent',
    message: refusal.selector === 'animated' ? 'animation or drivers' : refusal.selector === 'version' ? 'measured Blender 5.3.0' : 'fixed typed integer Index 0, 1 or 2' }] }
  write('qualification.json', source); write('index.json', rows); write('refusals.json', refusals)
  try { return body({ directory, source, rows, refusals, write }) } finally { rmSync(directory, { recursive: true, force: true }) }
}
function browser(profile) {
  return ['webgl2', 'webgpu'].map(backend => ({ backend, gpu: { backend, renderer: 'synthetic-policy-fixture' }, pageErrors: [], consoleErrors: [],
    rows: profile.caseIds.map(name => ({ case: name, blenderHash: '02f0899d78e3', max: 0, calibration: 0, channels: [0, 0, 0, 0], shaderErrors: [], exactAlpha: true })) }))
}

test('positive Component evidence requires both native devices, exact controls and current ZIP-isolated source', () => {
  for (const device of ['CPU', 'GPU']) fixture(({ directory }) => {
    const profile = readCompositorComponentProfile(directory); verifyCompositorComponentCurrentSources(profile, root)
    assert.equal(profile.numericalComponentCases, 63); assert.equal(profile.caseIds.length, 128)
    const result = validateCompositorComponentBrowser(browser(profile), [profile])
    assert.equal(result.browserReadbacks, 256); assert.equal(result.browserZeroSignClaim, false)
  }, device)
})
test('availability N/A cannot become a 5.3 control-only numerical pass', () => {
  for (const [version, hash] of [['4.2.0', 'a51f293548ad'], ['5.2.0', 'fbe6228777e7']]) fixture(({ directory, source, write }) => {
    const absent = { schemaVersion: 1, kind: source.kind, native: version, hash, sourceVersion: version.split('.').map(Number), device: 'CPU',
      status: 'native-node-absent', available: false, selectionCases: 0, pairedSeparateCases: 0, controlCases: 0,
      reason: 'Node type FunctionNodeGetVectorComponent undefined', sourceSha256 }
    write('qualification.json', absent); write('index.json', [])
    const profile = readCompositorComponentProfile(directory); assert.equal(profile.numericalComponentCases, 0)
    assert.throws(() => validateCompositorComponentBrowser([], [profile]))
    absent.sourceVersion = [5, 3, 0]; absent.native = '5.3.0'; absent.hash = source.hash
    write('qualification.json', absent); assert.throws(() => readCompositorComponentProfile(directory))
  })
})
test('missing/duplicate/mispaired/unsafe cases, forged shape, bad controls and stale source refuse', () => {
  const mutations = [
    x => { x.source.schemaVersion++ }, x => { x.source.packedSource.status = 'not-tested' },
    x => { x.source.packedSource.modules['compositor_graph.py'] = '0'.repeat(64) },
    x => { x.source.packedSource.transports.pop() }, x => { x.source.schemaRefusalCases = 0 },
    x => { x.source.sourcePreserved = false }, x => { x.source.nativeWordMismatches = 1 },
    x => { x.rows.pop() }, x => { x.rows[1] = x.rows[0] }, x => { x.rows[0].case = '../unsafe' },
    x => { x.source.pairs[0].separate = x.source.pairs[1].separate },
    x => { x.refusals[4].program.diagnostics[0].code = 'unrelated-refusal' },
    x => { const file = x.rows[0].case + '.json', r = JSON.parse(readFileSync(join(x.directory, file))); r.expected[0] += 1; x.write(file, r) },
  ]
  for (const mutate of mutations) fixture(x => {
    mutate(x); x.write('qualification.json', x.source); x.write('index.json', x.rows); x.write('refusals.json', x.refusals)
    assert.throws(() => readCompositorComponentProfile(x.directory))
  })
  fixture(({ directory }) => { const profile = readCompositorComponentProfile(directory); profile.sourceSha256['compositor_graph.py'] = '0'.repeat(64); assert.throws(() => verifyCompositorComponentCurrentSources(profile, root)) })
})
test('one missing API, nonzero pixels/carrier/alpha, shader errors and backend errors cannot pass', () => {
  fixture(({ directory }) => {
    const profile = readCompositorComponentProfile(directory)
    for (const mutate of [r => r.pop(), r => { r[0].rows[0].max = 1e-8 }, r => { r[0].rows[0].calibration = 1e-8 },
      r => { r[0].rows[0].channels[3] = 1 }, r => { r[0].rows[0].exactAlpha = false },
      r => { r[0].rows[0].shaderErrors.push('shader failed') }, r => { r[0].consoleErrors.push('failed') },
      r => { r[0].rows[1] = r[0].rows[0] }, r => { r[0].rows[0].blenderHash = 'wrong' }]) {
      const result = browser(profile); mutate(result); assert.throws(() => validateCompositorComponentBrowser(result, [profile]))
    }
  })
})

test('registration keeps fixed compositor scope, version N/A, package source proof and both-device native gates', () => {
  const read = path => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n')
  const map = JSON.parse(read('docs/node-capabilities.json')), entry = map.entries['compositor:FunctionNodeGetVectorComponent']
  assert.equal(entry.category, 'partial'); assert.deepEqual(entry.runtimeOps, ['separate-vector'])
  assert.deepEqual(entry.verification.nativeNumericVersions, ['5.3.0'])
  assert.deepEqual(entry.verification.nativeAbsentVersions, ['4.2.0', '5.2.0'])
  assert.equal(entry.verification.nativeScenes, 256); assert.equal(entry.verification.physicalAndSoftwareReadbacks, 1024)
  assert.equal(entry.verification.browserZeroSignClaim, false); assert.equal(entry.verification.packedNamespaceSourceOnly, true)
  assert.equal(entry.verification.freshHostedOpenGL.status, 'qualified-opengl'); assert.equal(entry.verification.freshHostedOpenGL.artifact, 14029991998)
  assert.ok(!map.knownUnsupported.includes('compositor:FunctionNodeGetVectorComponent'))
  assert.ok(entry.limits.includes('computed/spatial')); assert.ok(entry.limits.includes('geometry execution'))
  const gate = read('scripts/test-node-parity.mjs')
  for (const text of ['readCompositorComponentProfile', 'verifyCompositorComponentCurrentSources', 'validateCompositorComponentBrowser',
    'compositorComponentQualifications', 'numericalComponentCases=0', 'BLENDLINK_COMPOSITOR_COMPONENT_PACKAGED_ADDON']) assert.ok(gate.includes(text), text)
  const workflow = read('.github/workflows/static-noise.yml').split('  native-vector-component:\n')[1]
  assert.ok(workflow); assert.match(workflow, /for device in CPU GPU/)
  for (const text of ['compositor_vector_component_check.py', 'check-compositor-component.mjs --source',
    'check-compositor-component.mjs --browser', 'compositor-CPU', 'compositor-GPU', '--gpu-backend opengl']) assert.ok(workflow.includes(text), text)
  assert.ok(read('package.json').includes('scripts/compositor-component-policy.test.mjs'))
})
