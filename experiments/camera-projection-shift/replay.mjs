// CPU-only forensic replay. Never rewrites or upgrades the failed producer report.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Matrix4, Vector3 } from 'three'

export function bottomUp(bytes, width, height, origin) {
  assert.ok(['top-left', 'bottom-left'].includes(origin))
  assert.equal(bytes.length, width * height * 16)
  const out = Buffer.alloc(bytes.length), stride = width * 16
  for (let y = 0; y < height; y++) {
    const source = origin === 'top-left' ? height - 1 - y : y
    bytes.copy(out, y * stride, source * stride, (source + 1) * stride)
  }
  return out
}

if (process.argv[2] === '--self-test') {
  const a = Buffer.alloc(2 * 3 * 16)
  for (let i = 0; i < 24; i++) a.writeUInt32LE(i + 1, i * 4)
  assert.deepEqual(bottomUp(a, 2, 3, 'bottom-left'), a)
  const flipped = bottomUp(a, 2, 3, 'top-left')
  assert.equal(flipped.readUInt32LE(0), 17)
  assert.equal(flipped.readUInt32LE(32), 9)
  assert.equal(flipped.readUInt32LE(64), 1)
  assert.deepEqual(bottomUp(flipped, 2, 3, 'top-left'), a)
  assert.throws(() => bottomUp(a, 2, 3, 'unknown'))
  console.log('CPU row-layout self-test passed')
} else {
  const [captureArg, nativeArg, outputArg] = process.argv.slice(2)
  assert.ok(captureArg && nativeArg && outputArg, 'capture directory, native directory and NEW output JSON required')
  const capture = resolve(captureArg), nativeDir = resolve(nativeArg)
  const sha = b => createHash('sha256').update(b).digest('hex'), pins = {}
  async function pinned(path) { const bytes = await readFile(path); pins[path] = sha(bytes); return bytes }
  const reportBytes = await pinned(join(capture, 'report.json')), report = JSON.parse(reportBytes)
  const nativeBytes = await pinned(join(nativeDir, 'native.json')), native = JSON.parse(nativeBytes)
  assert.equal(sha(nativeBytes), report.nativeReportSha256)
  assert.equal(report.status, 'failed'); assert.equal(report.sceneAcceptance, false)
  assert.equal(report.sourceSha256, native.sourceSha256)
  const packets = JSON.parse(await pinned(join(capture, 'camera-packets.json')))
  await pinned(join(capture, 'producer.mjs')); await pinned(join(capture, 'browser.js'))
  // Existing R1 source/native pins are historical evidence, never re-created.
  for (const [path, expected] of Object.entries(report.sourcePins)) {
    const retained = path.endsWith('/experiments/camera-projection-shift/browser.mjs') ? join(capture, 'producer.mjs')
      : path.endsWith('/experiments/camera-projection-shift/browser.js') ? join(capture, 'browser.js') : path
    assert.equal(sha(await readFile(retained)), expected, path)
  }
  const rows = [], layoutWitnesses = []
  const result = { schemaVersion: 1, status: 'CPU_LAYOUT_DIAGNOSIS_ONLY', originalCaptureStatus: report.status,
    sourceCommit: report.sourceCommit, sourceSha256: report.sourceSha256, nativeBuild: report.nativeBuild,
    reportSha256: sha(reportBytes), nativeReportSha256: sha(nativeBytes), supportCredit: 0,
    sceneAcceptance: false, automaticEnablement: false, originalReportUnchanged: true,
    missingBackends: ['webgl2'], rows, layoutWitnesses, pins,
    rule: 'WebGPU raw texture rows top-left; Blender Image.pixels rows bottom-left. Reverse whole rows only; no channel, value, pixel or tolerance adjustment.' }
  for (const api of report.apis) {
    assert.equal(api.actualBackend, 'webgpu', 'This forensic reader only scopes the retained WebGPU R1')
    async function bytesFor(row) {
      if (Array.isArray(row.words)) return Buffer.from(new Uint32Array(row.words).buffer)
      const bytes = await pinned(join(capture, row.file)); assert.equal(sha(bytes), row.sha256); return bytes
    }
    for (const row of api.rows) {
      const raw = await bytesFor(row), actual = bottomUp(raw, 64, 4, 'top-left')
      const expectedRow = native.rows.find(x => x.case === row.case && x.kind === row.kind && x.profile === 'SNORM10')
      assert.ok(expectedRow)
      const expected = await pinned(join(nativeDir, expectedRow.file)); assert.equal(sha(expected), expectedRow.sha256)
      const gate = row.kind === 'mask' ? 0 : report.fixedGates.otherMaxAbs
      assert.equal(report.fixedGates.maskMaxAbs, 0); assert.equal(report.fixedGates.otherMaxAbs, 1 / 1024)
      let maximum = 0, violations = 0
      for (let i = 0; i < actual.length; i += 4) {
        const a = actual.readFloatLE(i), b = expected.readFloatLE(i)
        assert.ok(Number.isFinite(a) && Number.isFinite(b))
        const d = Math.abs(a - b); maximum = Math.max(maximum, d); if (d > gate) violations++
      }
      rows.push({ backend: api.actualBackend, case: row.case, kind: row.kind, negative: row.negative,
        rawSha256: sha(raw), normalizedSha256: sha(actual), nativeSha256: expectedRow.sha256, gate, maximum, violations })
      assert.ok(row.negative ? violations > 0 : violations === 0)
      if (row.kind === 'position' && !row.negative) {
        const mask = await bytesFor(api.rows.find(x => x.case === row.case && x.kind === 'mask'))
        const packet = packets[row.case]
        // Independent native projection matrix, not the candidate camera factory.
        const worldToNdc = new Matrix4().set(...packet.projection)
          .multiply(new Matrix4().set(...packet.cameraWorldGltf).invert())
        let covered = 0, xMaxAbs = 0, topLeftYMaxAbs = 0, bottomLeftYMaxAbs = 0
        for (let p = 0; p < 256; p++) {
          if (mask.readFloatLE(p * 16) !== 1) continue
          covered++
          const rgb = [0, 1, 2].map(c => (raw.readFloatLE(p * 16 + c * 4) - .5) * 32)
          const ndc = new Vector3(rgb[0], rgb[2], -rgb[1]).applyMatrix4(worldToNdc)
          const x = 2 * ((p % 64) + .5) / 64 - 1, bottomY = 2 * (Math.floor(p / 64) + .5) / 4 - 1
          xMaxAbs = Math.max(xMaxAbs, Math.abs(ndc.x - x))
          topLeftYMaxAbs = Math.max(topLeftYMaxAbs, Math.abs(ndc.y + bottomY))
          bottomLeftYMaxAbs = Math.max(bottomLeftYMaxAbs, Math.abs(ndc.y - bottomY))
        }
        // Diagnostic discrimination, not a substitute for the unchanged field gates.
        assert.ok(covered > 0 && topLeftYMaxAbs < 1e-3 && bottomLeftYMaxAbs > 1)
        layoutWitnesses.push({ case: row.case, covered, xMaxAbs, topLeftYMaxAbs, bottomLeftYMaxAbs })
      }
    }
  }
  await pinned(import.meta.filename)
  assert.deepEqual(await readFile(join(capture, 'report.json')), reportBytes)
  await writeFile(resolve(outputArg), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ status: result.status, rows: rows.length, layoutWitnesses }))
}
