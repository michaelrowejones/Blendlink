/* SPDX-License-Identifier: MIT */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createNodePortBlenderLauncher } from '../../scripts/lib/node-port-python.mjs'
import { archiveNativeLauncher, validateNativeArchive } from '../../scripts/lib/native-proof-archive.mjs'
assert.ok(process.argv[2], 'Use capture-native.mjs FRESH_OUTPUT')
const root = await realpath(resolve(import.meta.dirname, '../..')), out = resolve(process.argv[2]); await mkdir(out)
const script = join(root, 'experiments/compositor-lens-horizontal/reference.py')
const launcher = await createNodePortBlenderLauncher({ blender: process.env.BLENDLINK_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender',
  directory: join(out, 'active'), timeoutMs: 180000 })
let log = '', complete = false
try {
  await new Promise((done, reject) => {
    const child = spawn(launcher.executable, ['--background', '--factory-startup', '-t', '1', '--python-exit-code', '1', '--python', script, '--', out], { cwd: root })
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log += bytes.toString(); if (log.length > 16 * 1024 * 1024) child.kill('SIGTERM') })
    child.once('error', reject); child.once('close', code => code === 0 ? done() : reject(Error('Native horizontal lens pilot failed ' + code)))
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
