/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {fromWord, stagedMatvec, word} from './bounded-domain.mjs'
const root = resolve(import.meta.dirname, '../..'), sha = bytes => createHash('sha256').update(bytes).digest('hex')
const receipt = JSON.parse(await readFile(join(import.meta.dirname, 'receipt.json')))
const nativeBytes = await readFile(join(root, receipt.artifacts.directory, 'report.json'))
assert.equal(sha(nativeBytes), receipt.artifacts.reportSha256)
const native = JSON.parse(nativeBytes), coefficients = new Map()
const key = controls => JSON.stringify(controls)
for (const row of native.basisRows) coefficients.set(key(row.controls), row.columnWords.map(column => column.map(fromWord)))
for (const row of native.rows) {
  const d = row.inputs, controls = {mode: d.mode, invert: d.invert}
  Object.assign(controls, d.mode === 'EULER_XYZ' ? {rotation: d.rotation}
    : {angle: d.angle, ...(d.mode === 'AXIS_ANGLE' ? {axis: d.axis} : {})})
  assert.deepEqual(stagedMatvec(d.vector, d.center, coefficients.get(key(controls))).map(word), row.geometryFloatWords)
}
const compilerPath = join(import.meta.dirname, 'compiler-evidence.json'), compiler = JSON.parse(await readFile(compilerPath))
for (const [file, pin] of Object.entries(compiler.rawArtifacts)) {
  const bytes = await readFile(join(root, file)); assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256)
}
const normalized = JSON.parse(await readFile(join(import.meta.dirname, 'normalized-source-pins.json')))
for (const pin of normalized.nativeCompilerEvidence) {
  const bytes = await readFile(join(root, pin.path)); assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256)
}
const boundaryReceipt = JSON.parse(await readFile(join(import.meta.dirname, 'bounded-native-receipt.json')))
for (const [file, pin] of Object.entries(boundaryReceipt.artifactPins)) {
  const bytes = await readFile(join(root, boundaryReceipt.artifactDirectory, file))
  assert.equal(bytes.length, pin.bytes); assert.equal(sha(bytes), pin.sha256)
}
const boundary = JSON.parse(await readFile(join(root, boundaryReceipt.artifactDirectory, 'bounded-native.json')))
assert.equal(boundary.rows.length, 36)
const ids = []
for (const mode of ['X_AXIS', 'Y_AXIS', 'Z_AXIS']) for (const invert of [false, true])
  for (const angle of ['zero', 'min', 'min-next', 'negative-min', 'ordinary', 'max']) ids.push(`${mode}-${invert ? 'True' : 'False'}-${angle}`)
assert.deepEqual(boundary.rows.map(row => row.case), ids)
for (const row of boundary.rows) {
  assert.deepEqual(row.predictions.map(prediction => prediction.case), ['ordinary', 'bounds', 'centered'])
  for (const prediction of row.predictions)
    assert.deepEqual(stagedMatvec(prediction.vectorWords.map(fromWord), prediction.centerWords.map(fromWord),
      row.columnWords.map(column => column.map(fromWord))).map(word), prediction.actualWords)
}
const files = ['bounded-domain.mjs', 'bounded-domain.test.mjs', 'staged-matvec.mjs', 'staged-matvec.test.mjs',
  'normalized-rows.mjs', 'normalized-rows.test.mjs', 'normalized-source-pins.json', 'bounded-native-receipt.json',
  'close-bounded.mjs', 'compiler-evidence.json', 'bounded-proposal.md']
const inputs = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(join(import.meta.dirname, file)))])))
const threePackage = await readFile(join(root, 'node_modules/three/package.json'))
const result = {
  schemaVersion: 1, status: 'CLOSED_RESEARCH_ONLY_VECTOR_ROTATE_BOUNDED_PROTOTYPE', supportCredit: 0,
  sourceAdmissionCredit: 0, newNativeEvaluations: 0, nativeRenders: 0, browserCredit: 0, FinalCredit: 0,
  inheritedNativeReport: {path: receipt.artifacts.directory + '/report.json', sha256: sha(nativeBytes)},
  sameInputPredictions: native.rows.length, sameInputPredictedWords: native.rows.length * 3, mismatches: 0,
  hostControls: {tests: 10, stagedLatticeChecks: 23100, zeroSignVariants: 576,
    exactRationalExtentCount: 14, exactRationalPixels: [1, 2, 3, 4, 5, 7, 13, 19, 511, 1920, 4095, 4096, 8191, 8192].reduce((a, b) => a + b, 0)},
  additionalNativeBoundaryControls: {controlKeys: 36, basisComponentWords: 324, predictedComponentWords: 324,
    nativeRenders: 0, gpuInitializations: 0, compositorCredit: 0},
  hostIdentity: {node: process.version, threeVersion: JSON.parse(threePackage).version,
    threePackageSha256: sha(threePackage), packageLockSha256: sha(await readFile(join(root, 'package-lock.json')))},
  remainingBlockers: ['Arbitrary-axis/Euler basis output zero alone does not establish an internal zero coefficient; the first candidate must keep source-proven fixed-axis controls.',
    'The qualified Normalized coordinate field allows CPU word differences. A distinct exact-row consumer must retain real source/domain ownership before whole-graph CPU equality can be claimed.',
    'Actual CPU compositor, saved Final and both-API/profile renderer proofs remain unrun for this prototype.'],
  sourcePins: inputs,
}
await writeFile(join(import.meta.dirname, 'bounded-receipt.json'), JSON.stringify(result, null, 2) + '\n')
console.log(result.status)
