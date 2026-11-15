/* SPDX-License-Identifier: MIT */
/** Actual saved-original Final export; numerical/installed qualification stays separate. */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher, validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
import { resolveConfig } from '../../packages/blendlink/dist/config.js'
import { syncAll, verifyAll, publishedAssetPath } from '../../packages/blendlink/dist/sync.js'
import { parseManifest } from '../../packages/blendlink/dist/typegen.js'
const root = await realpath(resolve(import.meta.dirname, '../..')), native = await realpath(resolve(process.argv[2]))
assert.ok(process.argv[3], 'Use export.mjs NATIVE FRESH_OUTPUT')
const out = resolve(process.argv[3]); await mkdir(out)
const report = JSON.parse(await readFile(join(native, 'native.json'))), hash = bytes => createHash('sha256').update(bytes).digest('hex'), provenance = []
assert.equal(report.status, 'CAPTURED_LENS_HORIZONTAL_CPU_PILOT_ZERO_CREDIT')
for (const folder of ['packages/blender-addon', 'packages/blendlink/blender']) for (const name of (await readdir(join(root, folder))).filter(n => /\.(py|json)$/.test(n)).sort()) {
  const source = join(root, folder, name), artifact = join(root, folder === 'packages/blender-addon' ? 'packages/blendlink/dist/addon' : 'packages/blendlink/dist/blender', name)
  const bytes = await readFile(source); assert.deepEqual(await readFile(artifact), bytes); provenance.push({ source, artifact, sha256: hash(bytes) })
}
for (const row of report.rows) assert.equal(hash(await readFile(join(native, row.sourceFile))), row.sourceSha256)
const launcher = await createNodePortBlenderLauncher({ blender: process.env.BLENDLINK_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender', directory: join(out, 'active'), timeoutMs: 180000 })
let passed = false
const policyScript = join(root, 'packages/blender-addon/tests/compositor_lens_horizontal_check.py')
try {
  // The same guarded transaction owns the real source policy and Final calls.
  // Archive closure then independently checks an exact nonempty script census.
  let policyLog = ''
  await new Promise((done, reject) => {
    const child = spawn(launcher.executable, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1', '--python', policyScript], { cwd: root })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { policyLog += bytes.toString(); if (policyLog.length > 4 * 1024 * 1024) child.kill('SIGTERM') })
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(Error('Final source preflight failed: ' + code)))
  })
  await writeFile(join(out, 'source-policy.log'), policyLog)
  const policyRows = policyLog.split('\n').filter(row => row.startsWith('SCENETOWEB_LENS_HORIZONTAL_SOURCE_POLICY_PASSED '))
  assert.equal(policyRows.length, 1)
  const policy = JSON.parse(policyRows[0].slice(policyRows[0].indexOf(' ') + 1))
  assert.equal(policy.positive.length, 2); assert.equal(policy.refusals.length, 14); assert.equal(policy.supportCredit, 0)
  assert.deepEqual(policy.blockedPolicyCalls, { gpu: 0, render: 0 })
  const config = resolveConfig({ blenderPath: launcher.executable, outDir: 'public/models', genDir: 'src/generated',
    scenes: report.rows.map((row, i) => ({ name: 'lensFinal' + i, file: join(native, row.sourceFile) })) }, join(out, 'compiled'))
  await syncAll(config, { force: true }); assert.deepEqual((await verifyAll(config)).filter(issue => issue.severity !== 'warning'), [])
  const rows = []
  for (const [i, scene] of config.scenes.entries()) {
    const original = report.rows[i], manifestBytes = await readFile(scene.manifestPath), manifest = parseManifest(manifestBytes.toString())
    assert.ok(manifest.sourcePresentation)
    const presentationPath = publishedAssetPath(scene, manifest.sourcePresentation.url, manifest), presentationBytes = await readFile(presentationPath)
    const presentation = JSON.parse(presentationBytes), expected = JSON.parse(await readFile(join(native, original.folder, original.lens))).program
    for (const key of ['status', 'ops', 'passes', 'output']) assert.deepEqual(presentation.compositor[key], expected[key])
    assert.equal(presentation.display.view, 'Raw'); assert.deepEqual(presentation.display.ops, [])
    assert.equal(hash(await readFile(join(native, original.sourceFile))), original.sourceSha256)
    const row = { ...original, sourceFile: join(native, original.sourceFile), moduleExport: 'lensFinal' + i,
      manifestPath: scene.manifestPath, manifestSha256: hash(manifestBytes), presentationPath, presentationSha256: hash(presentationBytes) }
    for (const [role, file] of [['glb', scene.glbPath], ['module', scene.modulePath]]) { row[role + 'Path'] = file; row[role + 'Sha256'] = hash(await readFile(file)) }
    rows.push(row)
  }
  await writeFile(join(out, 'final.json'), JSON.stringify({ status: 'EXPORTED_LENS_HORIZONTAL_SAVED_ORIGINALS_ZERO_SUPPORT_CREDIT',
    sourcePreserved: true, provenance, nativeReportSha256: hash(await readFile(join(native, 'native.json'))), rows, supportCredit: 0, browserCredit: 0 }, null, 2) + '\n')
  passed = true
} finally {
  try {
    await launcher.finalize()
    const archive = { identity: launcher.identity, proof: await archiveNativeLauncher(launcher, out, passed) }
    await writeFile(join(out, 'archive.json'), JSON.stringify(archive, null, 2) + '\n')
    if (passed) await validateNativeArchive(archive, out, { expectedScripts: [{ path: policyScript, invocations: 1 }], expectedFinalSources: report.rows.map(row => join(native, row.sourceFile)),
      helperInputs: { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') } })
  } finally { await launcher.dispose() }
}
console.log(JSON.stringify({ out, status: 'EXPORTED_LENS_HORIZONTAL_SAVED_ORIGINALS_ZERO_SUPPORT_CREDIT', scenes: report.rows.length }))
