import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const experimentDir = dirname(fileURLToPath(import.meta.url))
const repositoryDir = resolve(experimentDir, '..', '..')
const sourcePath = resolve(
  repositoryDir,
  'artifacts/release-dogfood/next-corpus/sources/'
    + 'ellie-animation-official/ellie_animation/ellie_animation.blend',
)
const cliPath = resolve(repositoryDir, 'packages/blendlink/dist/cli.js')
const publicationRoot = resolve(experimentDir, 'output')
const evidenceDir = resolve(experimentDir, 'evidence')

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function listFiles(root) {
  if (!existsSync(root)) return []
  const files = []
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        files.push({
          path: relative(root, path).replaceAll('\\', '/'),
          bytes: statSync(path).size,
        })
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

const sourceBefore = sha256(sourcePath)
const result = spawnSync(
  process.execPath,
  [cliPath, 'plan', '--json'],
  {
    cwd: experimentDir,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  },
)
const sourceAfter = sha256(sourcePath)
const publicationFiles = listFiles(publicationRoot)

if (result.error) throw result.error
if (result.status !== 1) {
  throw new Error(`Expected the untouched Ellie plan to refuse with exit 1; got ${result.status}.`)
}
if (sourceBefore !== sourceAfter) {
  throw new Error(`The immutable Ellie source changed: ${sourceBefore} -> ${sourceAfter}.`)
}
if (publicationFiles.length !== 0) {
  throw new Error(
    `A refused plan must not publish files; found ${publicationFiles.map((file) => file.path).join(', ')}.`,
  )
}

const plan = JSON.parse(result.stdout)
const scene = plan.scenes?.[0]
if (!scene || scene.scene !== 'ellieUntouched' || scene.quality !== 'final') {
  throw new Error('The plan did not describe the expected ellieUntouched Final scene.')
}
if (scene.plan !== null) {
  throw new Error('The untouched Ellie source unexpectedly produced a publishable plan.')
}

const errors = Array.isArray(scene.inspection?.errors)
  ? scene.inspection.errors
  : []
const errorsByCode = Object.entries(
  errors.reduce((counts, error) => {
    const code = String(error?.code ?? 'unknown')
    counts[code] = (counts[code] ?? 0) + 1
    return counts
  }, {}),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([code, count]) => ({ code, count }))
const affectedMaterials = [...new Set(
  errors
    .filter((error) => error?.code === 'material.used-needs-bake')
    .map((error) => error.material),
)].sort()

if (errors.length === 0) {
  throw new Error('The refused plan did not explain which authored behavior would be lost.')
}

const evidence = {
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  command: 'node ../../packages/blendlink/dist/cli.js plan --json',
  exitCode: result.status,
  source: {
    path: relative(repositoryDir, sourcePath).replaceAll('\\', '/'),
    sha256Before: sourceBefore,
    sha256After: sourceAfter,
    unchanged: sourceBefore === sourceAfter,
  },
  result: {
    scene: scene.scene,
    quality: scene.quality,
    planIsNull: scene.plan === null,
    totalErrors: errors.length,
    errorsByCode,
    affectedMaterials,
    warningCount: Array.isArray(scene.inspection?.warnings)
      ? scene.inspection.warnings.length
      : 0,
    publicationFiles,
  },
}

mkdirSync(evidenceDir, { recursive: true })
writeFileSync(resolve(evidenceDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
writeFileSync(resolve(evidenceDir, 'stderr.txt'), result.stderr)
writeFileSync(resolve(evidenceDir, 'summary.json'), `${JSON.stringify(evidence, null, 2)}\n`)

console.log(
  `BLENDLINK_ELLIE_ZERO_CONFIG_REFUSAL_PASSED `
    + `errors=${errors.length} materials=${affectedMaterials.length} `
    + `source=${sourceBefore} publicationFiles=${publicationFiles.length}`,
)
