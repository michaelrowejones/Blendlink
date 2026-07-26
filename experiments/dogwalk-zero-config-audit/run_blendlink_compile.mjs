import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const cli = resolve(repository, 'packages/blendlink/dist/cli.js')
const source = 'C:/Users/micha/Downloads/blender-4.5-splash.blend'
const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')
const sourceBefore = await sha256(source)
const args = [cli, 'compile', 'dogwalkUntouched', '--force']
const result = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
const sourceAfter = await sha256(source)
const report = {
  schemaVersion: 1,
  classification:
    'untouched Blendlink Final compile attempt; expected loud material-portability refusal',
  command: `node ${args.map((value) => JSON.stringify(value)).join(' ')}`,
  cwd: root,
  exitCode: result.status,
  signal: result.signal,
  stdout: result.stdout,
  stderr: result.stderr,
  source: {
    path: source,
    sha256Before: sourceBefore,
    sha256After: sourceAfter,
    unchanged: sourceBefore === sourceAfter,
  },
  cli: { path: cli, sha256: await sha256(cli) },
}
await writeFile(
  resolve(output, 'blendlink-compile-evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(
  JSON.stringify(
    {
      exitCode: report.exitCode,
      sourceUnchanged: report.source.unchanged,
      stdout: report.stdout,
      stderr: report.stderr,
      evidence: resolve(output, 'blendlink-compile-evidence.json'),
    },
    null,
    2,
  ),
)
if (result.error) throw result.error
if (result.status !== 1) {
  throw new Error(`Expected untouched DOGWALK compile to refuse with exit 1`)
}
