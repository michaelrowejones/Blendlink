/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher, validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
const root = await realpath(resolve(import.meta.dirname, '../..'))
assert.ok(process.argv[2], 'A fresh policy evidence directory is required')
await mkdir(resolve(process.argv[2], '..'), { recursive: true }); await mkdir(resolve(process.argv[2]))
const directory = await realpath(resolve(process.argv[2])), script = join(root, 'packages/blender-addon/tests/compositor_lens_horizontal_check.py')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const inputs = async () => {
  const files = ['packages/blender-addon/tests/compositor_lens_horizontal_check.py', 'experiments/compositor-lens-horizontal/policy.mjs']
  for (const folder of ['packages/blendlink/blender', 'packages/blender-addon'])
    for (const name of await readdir(join(root, folder))) if (name.endsWith('.py') || name.endsWith('.json')) files.push(folder + '/' + name)
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file, hash(await readFile(join(root, file)))])))
}
const before = await inputs(), launcher = await createNodePortBlenderLauncher({
  blender: process.env.BLENDLINK_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender',
  directory: join(directory, 'active'), timeoutMs: 120000,
})
let log = '', complete = false
try {
  await new Promise((done, reject) => {
    const child = spawn(launcher.executable, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1', '--python', script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const consume = bytes => { log += bytes.toString(); if (log.length > 4 * 1024 * 1024) child.kill('SIGTERM') }
    child.stdout.on('data', consume); child.stderr.on('data', consume); child.once('error', reject)
    child.once('close', code => code === 0 ? done() : reject(Error('Horizontal lens source policy failed: ' + code)))
  })
  const rows = log.split('\n').filter(row => row.startsWith('SCENETOWEB_LENS_HORIZONTAL_SOURCE_POLICY_PASSED '))
  assert.equal(rows.length, 1)
  const policy = JSON.parse(rows[0].slice(rows[0].indexOf(' ') + 1))
  assert.equal(policy.positive.length, 2); assert.equal(policy.refusals.length, 14)
  assert.equal(policy.supportCredit, 0); assert.equal(policy.nativeRenders, 0); assert.equal(policy.gpuInitializations, 0)
  assert.deepEqual(policy.blockedPolicyCalls, { gpu: 0, render: 0 }); assert.deepEqual(await inputs(), before)
  await launcher.finalize()
  const archive = { identity: launcher.identity, proof: await archiveNativeLauncher(launcher, directory, true) }
  await validateNativeArchive(archive, directory, { expectedScripts: [{ path: script, invocations: 1 }], expectedFinalSources: [],
    helperInputs: { helper: join(root, 'scripts/lib/node-port-python.mjs'), bridge: join(root, 'scripts/node-port-blender.mjs') } })
  await writeFile(join(directory, 'archive.json'), JSON.stringify(archive, null, 2) + '\n')
  await writeFile(join(directory, 'policy.json'), JSON.stringify({ status: 'PASSED_LENS_HORIZONTAL_SOURCE_ONLY', policy, sourcePins: before,
    archiveSha256: hash(await readFile(join(directory, 'archive.json'))), supportCredit: 0 }, null, 2) + '\n')
  complete = true
  console.log(JSON.stringify({ directory, policy }))
} finally {
  try {
    await writeFile(join(directory, 'native.log'), log)
    if (!complete) await writeFile(join(directory, 'failed-native-archive.json'), JSON.stringify({ identity: launcher.identity, proof: await archiveNativeLauncher(launcher, directory, false) }, null, 2) + '\n')
  } finally { await launcher.dispose() }
}
