/* SPDX-License-Identifier: MIT */
/** Fresh family transaction scheduled by the shared node-port runner. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { executeNodePortCommand, fingerprintNodePortInputs } from '../../scripts/lib/node-port-contract.mjs'
const root = resolve(import.meta.dirname, '../..'), out = resolve(process.argv[2])
assert.ok(process.argv[2]); await mkdir(out)
const manifest = JSON.parse(await readFile(join(root, 'node-ports/compositor-lens-horizontal.json')))
const before = await fingerprintNodePortInputs(root, manifest)
await writeFile(join(out, 'matrix-inputs.json'), JSON.stringify(before, null, 2) + '\n')
const run = async (id, args) => {
  const result = await executeNodePortCommand({ argv: [process.execPath, ...args], cwd: root,
    env: { BLENDLINK_BLENDER: process.env.BLENDLINK_BLENDER, SCENETOWEB_NATIVE_IDENTITY_POLICY: 'per-invocation-sha256-v1' },
    timeoutMs: 300000, logPath: join(out, id + '.log') })
  assert.equal(result.exitCode, 0, id + ' failed; inspect ' + result.logPath); assert.equal(result.timedOut, false); assert.equal(result.error, undefined)
}
const file = name => 'experiments/compositor-lens-horizontal/' + name
await run('policy', [file('policy.mjs'), join(out, 'policy')])
await run('native', [file('capture-native.mjs'), join(out, 'native')])
await run('cpu', [file('compare-cpu.mjs'), join(out, 'native'), join(out, 'cpu-comparison.json')])
await run('final', [file('export.mjs'), join(out, 'native'), join(out, 'final')])
for (const profile of ['metal', 'software']) {
  await run('sampling-' + profile, [file('run-browser.mjs'), join(out, 'native'), join(out, 'sampling-' + profile), profile])
  await run('baseline-' + profile, [file('run-browser.mjs'), join(out, 'native'), join(out, 'baseline-' + profile), profile, 'baseline', join(out, 'final')])
}
await run('public-native', [file('capture-public.mjs'), join(out, 'baseline-metal'), join(out, 'baseline-software'), join(out, 'public-native')])
for (const profile of ['metal', 'software']) await run('compare-' + profile, [file('run-browser.mjs'), join(out, 'native'), join(out, 'compare-' + profile), profile, 'compare', join(out, 'final'), join(out, 'public-native')])
assert.equal((await fingerprintNodePortInputs(root, manifest)).inputDigest, before.inputDigest, 'Lens inputs changed during the fresh matrix')
await run('close', [file('verify.mjs'), out, join(out, 'qualified.json')])
