import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const cli = resolve(repository, 'packages/blendlink/dist/cli.js')
const exporter = resolve(
  repository,
  'packages/blendlink/dist/blender/export_scene.py',
)
const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')
const args = [cli, 'plan', 'dogwalkUntouched', '--json']
const result = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
const parsed = JSON.parse(result.stdout)
const report = {
  schemaVersion: 1,
  classification:
    'untouched Blendlink Final planner result; no source mutation or adapter',
  command: `node ${args.map((value) => JSON.stringify(value)).join(' ')}`,
  cwd: root,
  exitCode: result.status,
  signal: result.signal,
  stderr: result.stderr,
  result: parsed,
  identities: {
    cli: { path: cli, sha256: await sha256(cli) },
    exporter: { path: exporter, sha256: await sha256(exporter) },
    source: {
      path: 'C:/Users/micha/Downloads/blender-4.5-splash.blend',
      sha256:
        '7f8718cfd89baf59151cc4ba431eeab38b9ff260ffa0054d93293f228a70cc36',
    },
  },
}
await writeFile(
  resolve(output, 'blendlink-plan-evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(
  JSON.stringify(
    {
      exitCode: report.exitCode,
      scenes: parsed.scenes.length,
      plan: parsed.scenes[0]?.plan,
      errors: parsed.scenes[0]?.inspection?.errors?.length,
      errorCodes: [
        ...new Set(
          parsed.scenes[0]?.inspection?.errors?.map((error) => error.code),
        ),
      ],
      evidence: resolve(output, 'blendlink-plan-evidence.json'),
    },
    null,
    2,
  ),
)
if (result.error) throw result.error
if (result.status !== 1) {
  throw new Error(`Expected untouched DOGWALK plan to refuse with exit 1`)
}
