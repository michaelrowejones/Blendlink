import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const ordered = word => word & 0x80000000 ? 0x80000000 - (word & 0x7fffffff) : 0x80000000 + word
export function compare(actualBytes, nativeBytes, maxAbs, maxUlp = Infinity) {
  assert.equal(actualBytes.length, nativeBytes.length)
  let maxError = 0, maxUlpError = 0, differences = 0, violations = 0
  for (let i = 0; i < nativeBytes.length; i += 4) {
    const a = actualBytes.readFloatLE(i), b = nativeBytes.readFloatLE(i)
    assert.ok(Number.isFinite(a) && Number.isFinite(b), 'Nonfinite native/browser result')
    const aw = actualBytes.readUInt32LE(i), bw = nativeBytes.readUInt32LE(i), error = Math.abs(a - b), ulp = Math.abs(ordered(aw) - ordered(bw))
    maxError = Math.max(maxError, error); maxUlpError = Math.max(maxUlpError, ulp)
    if (aw !== bw) differences++
    if (error > maxAbs || ulp > maxUlp) violations++
  }
  return { words: nativeBytes.length / 4, differences, violations, maxAbs: maxError, maxUlp: maxUlpError }
}

export async function closePrototype(nativeDir, browserDir, { diagnosticOnly = false } = {}) {
  const native = JSON.parse(await readFile(join(nativeDir, 'native.json'))), browser = JSON.parse(await readFile(join(browserDir, 'browser.json'))), contract = JSON.parse(await readFile(join(nativeDir, 'contract.json')))
  assert.equal(native.status, 'CAPTURED_BOX_SOURCE_AND_SAMPLER_RESEARCH')
  const normals = new Set(contract.samplerCases.map(row => JSON.stringify(row.normal)))
  assert.equal(native.actualEeveeRenders, contract.samplerCases.length / 2 + normals.size)
  assert.equal(native.windowControls.length, normals.size)
  for (const control of native.windowControls) {
    assert.equal(control.wordDifferences, 0)
    assert.equal(control.sha256, sha(await readFile(join(nativeDir, control.file))))
  }
  const root = resolve(import.meta.dirname, '../..'), script = join(import.meta.dirname, 'capture.py')
  await validateNativeArchive(JSON.parse(await readFile(join(nativeDir, 'native-archive.json'))), nativeDir,
    { expectedFinalSources: [], expectedScripts: [{ path: script, invocations: 1 }],
      helperInputs: { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') } })
  assert.equal(native.contractSha256, sha(await readFile(join(nativeDir, 'contract.json'))))
  assert.equal(native.captureSha256, sha(await readFile(script)))
  assert.equal(native.nativeSourceSha256, sha(await readFile(native.nativeSource)))
  assert.equal(native.oracleSha256, sha(await readFile(join(root, 'experiments/native-f32-oracle-research/framebuffer_oracle.py'))))
  assert.equal(native.sourceSha256, sha(await readFile(native.source)))
  for (const image of native.images) assert.equal(image.sha256, sha(await readFile(join(nativeDir, image.file))))
  assert.equal(browser.nativeSha256, sha(await readFile(join(nativeDir, 'native.json'))))
  const rows = [], browserMipEffects = []
  for (const api of browser.apis) {
    assert.equal(api.status, 'CAPTURED_EXPERIMENTAL_BOX_RESEARCH')
    assert.deepEqual(api.errors, []); if (!diagnosticOnly) assert.deepEqual(api.pageErrors, [])
    for (const n of native.rows) {
      const b = api.rows.find(row => row.id === n.id); assert.ok(b)
      const actual = await readFile(join(browserDir, b.file)), reference = await readFile(join(nativeDir, n.file))
      assert.equal(sha(actual), b.sha256); assert.equal(sha(reference), n.sha256)
      const weight = n.id.startsWith('weights-')
      rows.push({ api: api.backend, id: n.id, kind: weight ? 'weights' : 'sampler-diagnostic', ...compare(actual, reference, weight ? contract.gates.weightMaxAbs : contract.gates.samplerDiagnosticMaxAbs, weight ? contract.gates.weightMaxUlp : Infinity) })
    }
  }
  for (const api of browser.apis) for (const n of native.rows.filter(row => row.mode === 'nomip')) {
    const reference = native.rows.find(row => row.image === n.image && row.mode === 'mip' && row.frequency === n.frequency && JSON.stringify(row.normal) === JSON.stringify(n.normal)); assert.ok(reference)
    const a = api.rows.find(row => row.id === n.id), b = api.rows.find(row => row.id === reference.id)
    browserMipEffects.push({ api: api.backend, id: n.id, ...compare(await readFile(join(browserDir, a.file)), await readFile(join(browserDir, b.file)), 0) })
  }
  return { status: diagnosticOnly ? 'DIAGNOSTIC_ONLY_AFTER_FAILED_CLOSURE_ZERO_CREDIT' : 'EXPERIMENTAL_BOX_COMPARISON_ZERO_PORT_CREDIT', browserErrors: browser.apis.map(api => ({ api: api.backend, pageErrors: api.pageErrors, shaderErrors: api.errors })), supportCredit: 0, actualMaterialCredit: 0, finalExportCredit: 0, nativeSha256: browser.nativeSha256, browserSha256: sha(await readFile(join(browserDir, 'browser.json'))), weightViolations: rows.filter(r => r.kind === 'weights').reduce((sum, r) => sum + r.violations, 0), samplerDiagnosticViolations: rows.filter(r => r.kind !== 'weights').reduce((sum, r) => sum + r.violations, 0), rows, browserMipEffects }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  assert.ok(process.argv[5] === undefined || process.argv[5] === '--diagnostic-only', 'Unknown reader option')
  const closed = await closePrototype(resolve(process.argv[2]), resolve(process.argv[3]), { diagnosticOnly: process.argv[5] === '--diagnostic-only' }); await writeFile(resolve(process.argv[4]), JSON.stringify(closed, null, 2) + '\n'); console.log(JSON.stringify({ status: closed.status, weightViolations: closed.weightViolations, samplerDiagnosticViolations: closed.samplerDiagnosticViolations }))
}
