// CPU-only reader of frozen R2; consumes no GPU and never changes capture bytes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const [captureArg, nativeArg] = process.argv.slice(2)
assert.ok(captureArg && nativeArg)
const capture = resolve(captureArg), nativeDir = resolve(nativeArg)
const sha = b => createHash('sha256').update(b).digest('hex')
const reportBytes = await readFile(join(capture, 'report.json')), r = JSON.parse(reportBytes)
assert.equal(r.status, 'passed'); assert.equal(r.sceneAcceptance, false); assert.equal(r.automaticEnablement, false); assert.equal(r.supportCredit, 0)
const nativeBytes = await readFile(join(nativeDir, 'native.json')), native = JSON.parse(nativeBytes)
assert.equal(sha(nativeBytes), r.nativeReportSha256)
assert.equal(r.sourceSha256, native.sourceSha256); assert.equal(r.nativeBuild, native.nativeBuild)
for (const [path, expected] of Object.entries(r.sourcePins)) {
  const suffix = path.split('/packages/blendlink/src/')[1]
  const retained = suffix ? join(capture, 'source/packages/blendlink/src', suffix)
    : path.endsWith('/experiments/camera-projection-shift/browser.mjs') ? join(capture, 'producer.mjs')
      : path.endsWith('/experiments/camera-projection-shift/browser.js') ? join(capture, 'browser.js')
        : path.endsWith('/camera-packets.json') ? join(capture, 'camera-packets.json') : path
  assert.equal(sha(await readFile(retained)), expected, path)
}
assert.equal(r.fixedGates.maskMaxAbs, 0); assert.equal(r.fixedGates.otherMaxAbs, 1 / 1024)
assert.deepEqual(r.apis.map(a => a.actualBackend).sort(), ['webgl2', 'webgpu'])
const summary = []
for (const api of r.apis) {
  assert.deepEqual(api.pageErrors, []); assert.deepEqual(api.errors, [])
  assert.equal(api.readbackOrigin, api.actualBackend === 'webgpu' ? 'top-left' : 'bottom-left')
  assert.equal(api.nativeOrigin, 'bottom-left')
  const calibration = await readFile(join(capture, api.calibration.rawFile))
  assert.equal(sha(calibration), api.calibration.rawSha256)
  let calibrationMaximum = 0
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) {
    const expected = [2 * (x + .5) / 64 - 1, (api.actualBackend === 'webgpu' ? -1 : 1) * (2 * (y + .5) / 4 - 1), .25, 1]
    for (let c = 0; c < 4; c++) calibrationMaximum = Math.max(calibrationMaximum, Math.abs(calibration.readFloatLE((y * 64 + x) * 16 + c * 4) - expected[c]))
  }
  assert.equal(api.calibration.gate, 2 ** -20); assert.equal(api.calibration.maximum, calibrationMaximum)
  assert.ok(calibrationMaximum <= 2 ** -20)
  const identities = []
  for (const row of api.rows) {
    const key = row.case + '|' + row.kind + '|' + row.negative; assert.ok(!identities.includes(key)); identities.push(key)
    const raw = await readFile(join(capture, row.rawFile)), normalized = await readFile(join(capture, row.file))
    assert.equal(raw.length, 4096); assert.equal(normalized.length, 4096)
    assert.equal(sha(raw), row.rawSha256); assert.equal(sha(normalized), row.sha256)
    for (let y = 0; y < 4; y++) {
      const rawY = api.actualBackend === 'webgpu' ? 3 - y : y
      assert.deepEqual(normalized.subarray(y * 1024, (y + 1) * 1024), raw.subarray(rawY * 1024, (rawY + 1) * 1024))
    }
    const reference = native.rows.find(x => x.case === row.case && x.kind === row.kind && x.profile === 'SNORM10')
    assert.ok(reference)
    const expected = await readFile(join(nativeDir, reference.file)); assert.equal(sha(expected), reference.sha256)
    const gate = row.kind === 'mask' ? 0 : 1 / 1024
    let maximum = 0, violations = 0
    for (let i = 0; i < 4096; i += 4) {
      const a = normalized.readFloatLE(i), b = expected.readFloatLE(i)
      assert.ok(Number.isFinite(a) && Number.isFinite(b))
      const delta = Math.abs(a - b); maximum = Math.max(maximum, delta); if (delta > gate) violations++
    }
    assert.equal(row.gate, gate); assert.equal(row.maximum, maximum); assert.equal(row.violations, violations)
    assert.ok(row.negative ? row.kind === 'position' && violations > 0 : violations === 0)
    summary.push({ backend: api.actualBackend, case: row.case, kind: row.kind, negative: row.negative, maximum, violations })
  }
  const expectedIdentities = ['source-Plane.021', 'source-Walls'].flatMap(id => [...['mask', 'normal', 'face', 'position'].map(kind => id + '|' + kind + '|false'), id + '|position|true'])
  assert.deepEqual(identities.sort(), expectedIdentities.sort())
}
assert.deepEqual(await readFile(join(capture, 'report.json')), reportBytes)
console.log(JSON.stringify({ status: 'VERIFIED_FROZEN_CAMERA_FIELD_CONTROL', reportSha256: sha(reportBytes), rows: summary.length, sceneAcceptance: false, supportCredit: 0, summary }))
