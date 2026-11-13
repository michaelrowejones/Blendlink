import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile as callbackExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const execFile = promisify(callbackExecFile)
const discover = fileURLToPath(new URL('../discover-blender-build.mjs', import.meta.url)), acquire = fileURLToPath(new URL('../acquire-blender-build.mjs', import.meta.url))

test('CLIs reject unknown/duplicate/missing flags before attempting network or execution', async () => {
  for (const args of [['--feed', 'https://evil.example'], ['--output'], ['--output', '--unknown']]) await assert.rejects(execFile(process.execPath, [discover, ...args]), error => error.code === 1 && error.stderr.includes('BLENDLINK_BLENDER_DISCOVERY_FAILED: Usage:'))
  for (const args of [[], ['--discovery'], ['--discovery', 'file', '--cache-dir', 'cache', '--work-dir', 'work', '--platform', 'linux'], ['--discovery', 'a', '--discovery', 'b', '--cache-dir', 'cache', '--work-dir', 'work']]) await assert.rejects(execFile(process.execPath, [acquire, ...args]), error => error.code === 1 && error.stderr.includes('BLENDLINK_BLENDER_ACQUISITION_FAILED: Usage:'))
})

test('acquisition CLI reads a bounded discovery document and never accepts arbitrary executable paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'blendlink-build-cli-')); t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'oversized.json'); await writeFile(path, 'x'.repeat(64 * 1024 + 1))
  await assert.rejects(execFile(process.execPath, [acquire, '--discovery', path, '--cache-dir', join(directory, 'cache'), '--work-dir', join(directory, 'work')]), error => error.code === 1 && error.stderr.includes('Discovery document exceeds its byte budget'))
})
