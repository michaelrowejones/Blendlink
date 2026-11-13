import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { readDifferencePrecisionProfile, readDifferenceTinyRefusals, validateDifferenceMeanReference } from './lib/difference-precision-evidence.mjs'

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-difference-exact-'))
  const control = { case: 'native-difference-exact-independent-control', width: 1, height: 1, input: [.25, .5, .75, 1], expected: [.25, .5, .75, 1],
    blenderVersion: '5.2.0 LTS', blenderHash: 'fbe6228777e7', compositorDevice: 'CPU', program: { status: 'extracted', ops: [{ kind: 'render-pass' }] } }
  const field = { ...control, case: 'native-difference-exact-field', program: { status: 'extracted', ops: [{ kind: 'difference-key', properties: {
    difference_key_model: 'native-difference-key-cpu-exact-v2', difference_key_native_version: [5, 2, 0],
    difference_key_settings: [.125, .25], evaluation_device: 'CPU', single_value_device: 'CPU',
  } }] } }
  const q = { native: control.blenderVersion, hash: control.blenderHash, sourceDevice: 'CPU', sourceModel: 'native-difference-key-cpu-exact-v2',
    numericalCpuExactCases: 1, controlCases: 1, sourcePreserved: true, nativeGpuFieldCases: 0 }
  const rows = [{ case: control.case }, { case: field.case }]
  const save = () => {
    for (const record of [control, field]) writeFileSync(join(directory, record.case + '.json'), JSON.stringify(record))
    writeFileSync(join(directory, 'qualification.json'), JSON.stringify(q))
  }; save()
  try { run({ directory, control, field, q, rows, save }) } finally { rmSync(directory, { recursive: true, force: true }) }
}
test('fresh CPU-v2 qualification cannot be replaced by controls, old models or GPU-field claims', () => fixture(({ directory, field, q, rows, save }) => {
  assert.equal(readDifferencePrecisionProfile(directory, rows).numericalCpuExactCases, 1)
  q.nativeGpuFieldCases = 1; save(); assert.throws(() => readDifferencePrecisionProfile(directory, rows)); q.nativeGpuFieldCases = 0
  field.program.ops[0].properties.difference_key_model = 'native-difference-key-v1'; save()
  assert.throws(() => readDifferencePrecisionProfile(directory, rows))
  field.program.ops = [{ kind: 'render-pass' }]; save(); assert.throws(() => readDifferencePrecisionProfile(directory, rows), /cannot replace/)
}))
test('mean evidence requires all 16k CPU values, measured identity, admitted range and exact staged arithmetic', () => {
  const record = { native: '5.2.0 LTS', hash: 'fbe6228777e7', sourceDevice: 'CPU', sourceEngine: 'BLENDER_EEVEE', count: 16384,
    width: 128, height: 128, fixtureSha256: 'a'.repeat(64), input: new Array(16384).fill([.25, .25, .25, 1]).flat(), expected: new Array(16384).fill(.25) }
  assert.equal(validateDifferenceMeanReference(record).nativeValues, 16384)
  for (const patch of [{ sourceDevice: 'GPU' }, { native: '5.2.1' }, { count: 0 }, { expected: [] }])
    assert.throws(() => validateDifferenceMeanReference({ ...record, ...patch }))
  record.expected[0] = .2500001; assert.throws(() => validateDifferenceMeanReference(record)); record.expected[0] = .25
  record.input[0] = -1; assert.throws(() => validateDifferenceMeanReference(record))
})
test('tiny-domain native refusals stay outside numerical coverage and require exact raw bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-difference-tiny-')), rows = [], refusals = []
  try {
    for (const falloff of [0, .125]) {
      const control = { case: 'tiny-' + falloff + '-control', blenderVersion: '5.2.0 LTS', blenderHash: 'fbe6228777e7',
        compositorDevice: 'CPU', requireFloat32Bits: true, controls: { Falloff: falloff }, width: 1, height: 1,
        input: [.25, 0, 0, 2], expected: [.25, 0, 0, 2], program: { status: 'extracted', ops: [{ kind: 'render-pass' }] } }
      rows.push({ case: control.case }); writeFileSync(join(directory, control.case + '.json'), JSON.stringify(control))
      for (const output of ['Image', 'Matte']) {
        const file = 'refused-' + falloff + '-' + output + '.rgba32f', bytes = Buffer.alloc(16)
        writeFileSync(join(directory, file), bytes)
        refusals.push({ nativeOnly: true, native: control.blenderVersion, hash: control.blenderHash, output,
          input: control.input, expected: [0, 0, 0, 0], controls: { Tolerance: 0, Falloff: falloff },
          rawFloat32File: file, rawFloat32Sha256: createHash('sha256').update(bytes).digest('hex'), program: {
            status: 'unsupported', diagnostics: [{ code: 'unsupported-difference-key', nodeType: 'CompositorNodeDiffMatte', socket: output, message: 'Requires positive Tolerance' }],
          } })
      }
    }
    writeFileSync(join(directory, 'refusals.json'), JSON.stringify(refusals))
    assert.equal(readDifferenceTinyRefusals(directory, rows).numericalDifferenceCases, 0)
    writeFileSync(join(directory, refusals[0].rawFloat32File), Buffer.alloc(16, 1))
    assert.throws(() => readDifferenceTinyRefusals(directory, rows))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
test('Difference catalog, central shards and canaries retain distinct proof roles', () => {
  const entry = JSON.parse(readFileSync(new URL('../docs/node-capabilities.json', import.meta.url))).entries['compositor:CompositorNodeDiffMatte']
  const proof = entry.verification.cpuExactV2
  assert.equal(proof.indexedRows, 413); assert.equal(proof.freshCpuV2Programs, 305); assert.equal(proof.existingGpuV1Programs, 90); assert.equal(proof.independentControls, 18)
  assert.equal(proof.indexedRows, proof.freshCpuV2Programs + proof.existingGpuV1Programs + proof.independentControls)
  assert.equal(proof.builtGraphChecks, 1652); assert.equal(proof.maximumAbsoluteError, 0); assert.equal(proof.meanPrimitiveReadbacks, 196608)
  assert.equal(proof.shaderSourceGateBytes, 16000); assert.equal(proof.nativeGpuFieldExpansion, false)
  assert.equal(entry.verification.llvmpipeRneModel.freshHostedArtifact, 14001349736)
  const gate = readFileSync(new URL('../scripts/test-node-parity.mjs', import.meta.url), 'utf8')
  for (const text of ['difference-cpu-precision', 'difference-cpu-fold-gpu', 'difference-tiny-cpu-independent-controls', 'independentArithmeticProofs', 'readDifferenceProfileRefusal']) assert.ok(gate.includes(text))
  const workflow = readFileSync(new URL('../.github/workflows/static-noise.yml', import.meta.url), 'utf8').split('  native-compositor:\n')[1]
  for (const text of ['Difference CPU precision legacy', 'BLENDLINK_DIFFERENCE_PRECISION_DEVICE', 'check-difference-precision.mjs --ordinary', 'native_tiny.py', 'native_mean.py', 'mean-run.mjs']) assert.ok(workflow.includes(text))
})
