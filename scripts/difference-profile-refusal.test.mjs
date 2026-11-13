import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readDifferenceProfileRefusal } from './lib/difference-profile-refusal.mjs'

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-difference-profile-'))
  const input = [.2, .2, .2, 2]
  const rows = [{ case: 'native-difference-key-independent-control' }]
  const profile = { requestedBackend: 'OPENGL', renderer: null }
  const qualification = { status: 'source-profile-refused', protocol: 'blendlink-difference-gpu-source-profile-v1',
    device: 'GPU', backend: 'OPENGL', cases: 0, numericalDifferenceCases: 0, controlCases: 1,
    sourcePreserved: true, nativeGpuProfile: profile, profileRefusals: [] }
  writeFileSync(join(directory, rows[0].case + '.json'), JSON.stringify({ compositorDevice: 'GPU',
    width: 1, height: 1, input, expected: input, program: { status: 'extracted', ops: [{ kind: 'render-pass' }] } }))
  for (const output of ['Image', 'Matte']) {
    const diagnostic = { code: 'unsupported-difference-key', nodeType: 'CompositorNodeDiffMatte',
      node: 'Artist Difference Key', socket: output,
      message: 'Difference Key GPU OpenGL source precision profile is unverified; use source baking' }
    const record = { case: 'native-refusal-' + output.toLowerCase(), output, compositorDevice: 'GPU',
      sourcePreserved: true, sourceFingerprint: 'Artist CompositorNodeDiffMatte', nativeGpuProfile: profile,
      program: { status: 'unsupported', diagnostics: [diagnostic] }, diagnostics: [diagnostic],
      width: 1, height: 1, input, expected: input }
    const bytes = JSON.stringify(record), file = record.case + '.json'
    writeFileSync(join(directory, file), bytes)
    qualification.profileRefusals.push({ case: record.case, file, output,
      reason: diagnostic.message, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const save = () => writeFileSync(join(directory, 'qualification.json'), JSON.stringify(qualification))
  save()
  try { run({ directory, rows, qualification, save }) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('records two native source refusals separately from their independent control', () => fixture(({ directory, rows }) => {
  assert.equal(readDifferenceProfileRefusal(directory, rows, () => false).numericalDifferenceCases, 0)
}))
test('rejects a missing output, changed native pixels and a qualified profile claiming refusal', () => {
  fixture(({ directory, rows, qualification, save }) => {
    qualification.profileRefusals.pop(); save()
    assert.throws(() => readDifferenceProfileRefusal(directory, rows, () => false))
  })
  fixture(({ directory, rows, qualification }) => {
    writeFileSync(join(directory, qualification.profileRefusals[0].file), '{}')
    assert.throws(() => readDifferenceProfileRefusal(directory, rows, () => false))
  })
  fixture(({ directory, rows }) => assert.throws(() => readDifferenceProfileRefusal(directory, rows, () => true)))
  fixture(({ directory, rows, qualification, save }) => {
    qualification.nativeGpuProfile = { platform: 'linux', architecture: 'x86_64', blenderVersion: [5, 2, 0],
      blenderHash: 'fbe6228777e7', requestedBackend: 'OPENGL', renderer: 'llvmpipe (LLVM 20.1.2, 256 bits)',
      vendor: 'Mesa', version: '4.5 (Core Profile) Mesa 25.2.8-0ubuntu0.24.04.4', deviceType: 'SOFTWARE', backend: 'OPENGL' }
    save()
    assert.throws(() => readDifferenceProfileRefusal(directory, rows, () => false), /requires numerical Difference/)
  })
})
test('rejects extra numerical rows and refusal paths outside the evidence directory', () => fixture(({ directory, rows, qualification, save }) => {
  assert.throws(() => readDifferenceProfileRefusal(directory, [...rows, { case: 'numerical' }], () => false))
  qualification.profileRefusals[0].file = '../native.json'; save()
  assert.throws(() => readDifferenceProfileRefusal(directory, rows, () => false))
}))
