/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { hash } from '../../scripts/lib/runtime-provenance.mjs'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher, validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
const root = await realpath(resolve(import.meta.dirname, '../..')), [metal, software, destination, ...extra] = process.argv.slice(2)
assert.ok(destination && !extra.length, 'Use capture-public.mjs METAL_BASELINE SOFTWARE_BASELINE FRESH_OUTPUT')
const out = resolve(destination); await mkdir(out)
const baselines = []
for (const [i, dir] of [metal, software].entries()) {
  const path = join(await realpath(resolve(dir)), 'report.json'), bytes = await readFile(path), report = JSON.parse(bytes)
  assert.equal(report.profile, i ? 'software' : 'metal'); assert.equal(report.phase, 'baseline')
  assert.equal(report.status, 'LENS_HORIZONTAL_ALL_APIS_PILOT_PASSED_ZERO_CREDIT'); assert.deepEqual(report.apis.map(api => api.backend), ['webgpu', 'webgl2'])
  baselines.push({ path, sha256: hash(bytes) })
}
await writeFile(join(out, 'inputs.json'), JSON.stringify({ baselines }, null, 2) + '\n')
const script = join(root, 'experiments/compositor-lens-horizontal/reference-public.py')
const launcher = await createNodePortBlenderLauncher({ blender: process.env.BLENDLINK_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender', directory: join(out, 'active'), timeoutMs: 180000 })
let log = '', complete = false
try {
  await new Promise((done, reject) => {
    const child = spawn(launcher.executable, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1', '--python', script, '--', out], { cwd: root })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes.toString(); if (log.length > 16 * 1024 * 1024) child.kill('SIGTERM') })
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(Error('Public native reference failed ' + code)))
  })
  await launcher.finalize(); complete = true
} finally {
  try {
    await writeFile(join(out, 'native.log'), log)
    const archive = { identity: launcher.identity, proof: await archiveNativeLauncher(launcher, out, complete) }
    await writeFile(join(out, 'archive.json'), JSON.stringify(archive, null, 2) + '\n')
    if (complete) await validateNativeArchive(archive, out, { expectedScripts: [{ path: script, invocations: 1 }], expectedFinalSources: [],
      helperInputs: { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') } })
  } finally { await launcher.dispose() }
}
console.log(JSON.stringify({ out, status: 'CAPTURED_PUBLIC_LENS_CPU_REFERENCES_ZERO_SUPPORT_CREDIT' }))
