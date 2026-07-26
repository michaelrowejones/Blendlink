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
const sourceSync = resolve(repository, 'packages/blendlink/src/sync.ts')
const distSync = resolve(repository, 'packages/blendlink/dist/sync.js')
const sourcePlanManifest = resolve(
  repository,
  'packages/blendlink/src/planManifest.ts',
)
const distPlanManifest = resolve(
  repository,
  'packages/blendlink/dist/planManifest.js',
)
const source =
  'C:/Users/micha/Downloads/TrapX - Stylized Painting Shader.blend'
const publishedGlb = resolve(output, 'blendlink/trapxUntouched.glb')
const publishedManifest = resolve(
  output,
  'generated/trapxUntouched.manifest.json',
)
const publishedModule = resolve(output, 'generated/trapxUntouched.gen.ts')
const publishedBakedRecipe = resolve(
  output,
  'generated/trapxUntouched.baked.ts',
)
const retainedManifest = JSON.parse(await readFile(publishedManifest, 'utf8'))
const runtimeAssetEntries = retainedManifest.runtimeAssetGraph?.entries
if (!Array.isArray(runtimeAssetEntries) || runtimeAssetEntries.length === 0) {
  throw new Error('The retained manifest has no runtime asset graph entries.')
}
const runtimePublication = retainedManifest.runtimeAssetPublication
if (
  !runtimePublication?.bundlePath ||
  !runtimePublication?.scenePath
) {
  throw new Error('The retained manifest has no immutable runtime publication.')
}
const runtimeAssetPaths = Object.fromEntries(
  runtimeAssetEntries.flatMap((entry) => [
    [
      `stableRuntime:${entry.path}`,
      resolve(output, 'blendlink', entry.path),
    ],
    [
      `immutableRuntime:${entry.path}`,
      resolve(output, 'blendlink', runtimePublication.bundlePath, entry.path),
    ],
  ]),
)
const retainedPublicationPaths = {
  ...runtimeAssetPaths,
  manifest: publishedManifest,
  generatedModule: publishedModule,
  bakedRecipeModule: publishedBakedRecipe,
}
const stableSceneKey = `stableRuntime:${runtimePublication.scenePath}`
const evidencePath = resolve(output, 'blendlink-compile-evidence.json')
const sha256 = async (path) =>
  createHash('sha256').update(await readFile(path)).digest('hex')
const hashPaths = async (paths) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [
        name,
        { path, sha256: await sha256(path) },
      ]),
    ),
  )
await mkdir(output, { recursive: true })

const sourceBefore = await sha256(source)
const retainedPublicationBefore = await hashPaths(retainedPublicationPaths)
const args = [cli, 'compile', 'trapxUntouched', '--force']
const leaseRegistry = resolve(root, 'output', 'publication-leases')
const result = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: {
    ...process.env,
    BLENDLINK_PUBLICATION_LEASE_REGISTRY: leaseRegistry,
  },
})
const sourceAfter = await sha256(source)
const retainedPublicationAfter = await hashPaths(retainedPublicationPaths)
const retainedPublicationUnchanged = Object.keys(retainedPublicationPaths)
  .every(
    (name) =>
      retainedPublicationBefore[name].sha256 ===
      retainedPublicationAfter[name].sha256,
  )
const report = {
  schemaVersion: 1,
  classification:
    'untouched zero-configuration Blendlink Final compile refusal; no source mutation or application material adapter',
  command: `node ${args.map((value) => JSON.stringify(value)).join(' ')}`,
  cwd: root,
  environment: {
    BLENDLINK_PUBLICATION_LEASE_REGISTRY: leaseRegistry,
  },
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
  retainedPreFixStructuralFloor: {
    path: publishedGlb,
    sha256Before: retainedPublicationBefore[stableSceneKey].sha256,
    sha256After: retainedPublicationAfter[stableSceneKey].sha256,
    unchanged:
      retainedPublicationBefore[stableSceneKey].sha256 ===
      retainedPublicationAfter[stableSceneKey].sha256,
    classification:
      'retained pre-fix stock/Needle-equivalent structural floor; not a successful publication under the current Final gate',
  },
  retainedPreFixPublication: {
    runtimeAssetGraph: {
      fingerprint: retainedManifest.runtimeAssetGraph.fingerprint,
      entryCount: runtimeAssetEntries.length,
      entries: runtimeAssetEntries,
    },
    before: retainedPublicationBefore,
    after: retainedPublicationAfter,
    unchanged: retainedPublicationUnchanged,
    scope:
      `all ${runtimeAssetEntries.length} retained runtime asset graph ` +
      `${runtimeAssetEntries.length === 1 ? 'entry' : 'entries'} at stable and immutable ` +
      'paths, the manifest, generated scene module, and baked recipe module',
  },
  identities: {
    cli: { path: cli, sha256: await sha256(cli) },
    exporter: { path: exporter, sha256: await sha256(exporter) },
    sourceSync: { path: sourceSync, sha256: await sha256(sourceSync) },
    distSync: { path: distSync, sha256: await sha256(distSync) },
    sourcePlanManifest: {
      path: sourcePlanManifest,
      sha256: await sha256(sourcePlanManifest),
    },
    distPlanManifest: {
      path: distPlanManifest,
      sha256: await sha256(distPlanManifest),
    },
  },
}
await writeFile(
  evidencePath,
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
console.log(
  JSON.stringify(
    {
      exitCode: report.exitCode,
      sourceUnchanged: report.source.unchanged,
      retainedPreFixStructuralFloorUnchanged:
        report.retainedPreFixStructuralFloor.unchanged,
      retainedPreFixPublicationUnchanged:
        report.retainedPreFixPublication.unchanged,
      stdout: report.stdout,
      stderr: report.stderr,
      identities: report.identities,
      evidence: evidencePath,
    },
    null,
    2,
  ),
)
if (result.error) throw result.error
if (sourceBefore !== sourceAfter) {
  throw new Error('The source .blend changed during the compile attempt.')
}
if (!retainedPublicationUnchanged) {
  throw new Error('The rejected compile changed the retained publication.')
}
if (result.status !== 1) {
  throw new Error(`Expected the untouched Final compile to refuse with exit 1.`)
}
if (!/Blendlink Material Fidelity refused to publish trapxUntouched/.test(result.stderr)) {
  throw new Error('The compile did not emit the expected Material Fidelity refusal.')
}
