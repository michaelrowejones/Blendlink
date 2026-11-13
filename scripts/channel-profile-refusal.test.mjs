import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readChannelProfileRefusal } from './lib/channel-profile-refusal.mjs'

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-channel-profile-')), input = [.2, .3, .4, 2]
  const rows = [{ case: 'native-channel-key-independent-control' }]
  const qualification = { status: 'source-profile-refused', protocol: 'blendlink-channel-gpu-source-profile-v1',
    device: 'GPU', sourceBackend: 'OPENGL', native: '5.2.0 LTS', hash: 'fbe6228777e7', sourcePreserved: true,
    cases: 0, numericalChannelCases: 0, controlCases: 1, profileRefusals: [] }
  writeFileSync(join(directory, rows[0].case + '.json'), JSON.stringify({ compositorDevice: 'GPU',
    width: 1, height: 1, input, expected: input, program: { status: 'extracted', ops: [{ kind: 'render-pass' }] } }))
  for (const output of ['Image', 'Matte']) {
    const diagnostic = { code: 'unsupported-channel-key', nodeType: 'CompositorNodeChannelMatte', node: 'Artist Channel Key', socket: output,
      message: 'Channel Key currently requires CPU source compositing or the verified Metal GPU source backend; other GPU arithmetic profiles remain unverified' }
    const record = { case: 'native-refusal-' + output.toLowerCase(), output, compositorDevice: 'GPU', sourceBackend: 'OPENGL',
      blenderVersion: qualification.native, blenderHash: qualification.hash, sourcePreserved: true,
      program: { status: 'unsupported', diagnostics: [diagnostic] }, diagnostics: [diagnostic], width: 1, height: 1, input, expected: input }
    const bytes = JSON.stringify(record), file = record.case + '.json'; writeFileSync(join(directory, file), bytes)
    qualification.profileRefusals.push({ file, reason: diagnostic.message, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  const save = () => writeFileSync(join(directory, 'qualification.json'), JSON.stringify(qualification)); save()
  try { run({ directory, rows, qualification, save }) } finally { rmSync(directory, { recursive: true, force: true }) }
}

test('separates unqualified native Channel Key outputs from an independent control', () => fixture(({ directory, rows }) => {
  assert.equal(readChannelProfileRefusal(directory, rows).numericalChannelCases, 0)
}))
test('requires numerical coverage for qualified Metal and rejects changed or missing native refusals', () => {
  fixture(({ directory, rows, qualification, save }) => {
    qualification.sourceBackend = 'METAL'; save(); assert.throws(() => readChannelProfileRefusal(directory, rows), /requires numerical/)
  })
  fixture(({ directory, rows, qualification, save }) => {
    qualification.profileRefusals.pop(); save(); assert.throws(() => readChannelProfileRefusal(directory, rows))
  })
  fixture(({ directory, rows, qualification }) => {
    writeFileSync(join(directory, qualification.profileRefusals[0].file), '{}'); assert.throws(() => readChannelProfileRefusal(directory, rows))
  })
})
test('rejects extra numerical rows and unsafe evidence paths', () => fixture(({ directory, rows, qualification, save }) => {
  assert.throws(() => readChannelProfileRefusal(directory, [...rows, { case: 'numerical' }]))
  qualification.profileRefusals[0].file = '../outside.json'; save(); assert.throws(() => readChannelProfileRefusal(directory, rows))
}))
