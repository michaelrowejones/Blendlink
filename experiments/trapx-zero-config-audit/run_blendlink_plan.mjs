import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const repository = resolve(root, '../..')
const output = resolve(root, 'output')
const cli = resolve(repository, 'packages/blendlink/dist/cli.js')
const exporter = resolve(
  repository,
  'packages/blendlink/dist/blender/export_scene.py',
)
const source =
  'C:/Users/micha/Downloads/TrapX - Stylized Painting Shader.blend'
const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')
await mkdir(output, { recursive: true })

const sourceBefore = await sha256(source)
const args = [cli, 'plan', 'trapxUntouched', '--json']
const result = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
const sourceAfter = await sha256(source)
let parsed = null
let parseError = null
try {
  parsed = JSON.parse(result.stdout)
} catch (error) {
  parseError = String(error)
}
const report = {
  schemaVersion: 1,
  classification:
    'untouched zero-configuration Blendlink Final planner result; no source mutation or application material adapter',
  command: `node ${args.map((value) => JSON.stringify(value)).join(' ')}`,
  cwd: root,
  exitCode: result.status,
  signal: result.signal,
  stdout: result.stdout,
  stderr: result.stderr,
  parseError,
  result: parsed,
  identities: {
    cli: { path: cli, sha256: await sha256(cli) },
    exporter: { path: exporter, sha256: await sha256(exporter) },
    source: {
      path: source,
      sha256Before: sourceBefore,
      sha256After: sourceAfter,
      unchanged: sourceBefore === sourceAfter,
    },
  },
}
await writeFile(
  resolve(output, 'blendlink-plan-evidence.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)

const scene = parsed?.scenes?.[0]
console.log(
  JSON.stringify(
    {
      exitCode: report.exitCode,
      sourceUnchanged: report.identities.source.unchanged,
      scenes: parsed?.scenes?.length ?? null,
      plan: scene?.plan ?? null,
      errors: scene?.inspection?.errors?.length ?? null,
      errorCodes: [
        ...new Set(
          scene?.inspection?.errors?.map((error) => error.code) ?? [],
        ),
      ],
      warnings: scene?.inspection?.warnings?.length ?? null,
      parseError,
      evidence: resolve(output, 'blendlink-plan-evidence.json'),
    },
    null,
    2,
  ),
)
if (result.error) throw result.error
if (sourceBefore !== sourceAfter) {
  throw new Error('The source .blend changed during the read-only plan.')
}
if (parseError) throw new Error(parseError)
if (![0, 1].includes(result.status)) {
  throw new Error(`Unexpected Blendlink plan exit code ${result.status}`)
}
