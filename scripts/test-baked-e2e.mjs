import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { sceneRuntimePublicationDirectory } from '../packages/blendlink/dist/scenePublication.js'

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages', 'blendlink', 'dist', 'cli.js')
const discover = execFileSync(process.execPath, [cli, 'discover'], { encoding: 'utf8' }).trim().split(/\r?\n/)
const blender = discover.at(-1)
if (!blender) throw new Error('Blendlink did not discover Blender')

function readGlbJson(path) {
  const bytes = readFileSync(path)
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`not a glTF 2 GLB: ${path}`)
  }
  const jsonLength = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error(`GLB has no leading JSON chunk: ${path}`)
  }
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd())
}

const work = mkdtempSync(join(tmpdir(), 'blendlink-baked-e2e-'))
const publicationDirectory = join(work, 'public', 'models')
function removeActiveRuntimeGraph(currentManifest) {
  if (!currentManifest.runtimeAssetPublication) {
    throw new Error('baked e2e manifest has no addressed runtime publication')
  }
  const directory = sceneRuntimePublicationDirectory(
    publicationDirectory,
    currentManifest.runtimeAssetPublication,
  )
  if (!existsSync(directory)) {
    throw new Error(`addressed runtime publication is already missing: ${directory}`)
  }
  // `sceneRuntimePublicationDirectory` has already proved this is a canonical
  // descendant of the compiler-owned publication root for this temp fixture.
  rmSync(directory, { recursive: true })
}
// The compiler launches Blender repeatedly. Give every child process an empty,
// owned profile so a developer's enabled addons cannot alter the fixture,
// print misleading failures, access the network, or start helper processes.
// This mirrors the isolated addon archive-install gate.
const blenderUserResources = join(work, 'blender-user-resources')
mkdirSync(blenderUserResources, { recursive: true })
process.env.BLENDER_USER_RESOURCES = blenderUserResources
const blend = join(work, 'hero.blend')
execFileSync(blender, [
  '--background', '--factory-startup', '--python',
  join(root, 'scripts', 'make-baked-e2e-scene.py'), '--', blend,
], { stdio: 'inherit' })
writeFileSync(join(work, 'blendlink.config.mjs'), `export default {
  outDir: 'public/models',
  genDir: 'src/generated',
  urlPrefix: '/models',
  scenes: [{ file: 'hero.blend', name: 'hero' }],
}\n`)

execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const planOutput = execFileSync(process.execPath, [cli, 'plan', '--json'], { cwd: work, encoding: 'utf8' })
const plan = JSON.parse(planOutput).scenes[0]?.plan
if (!plan || !plan.atlases?.main || !Array.isArray(plan.errors) || plan.errors.length) {
  throw new Error(`invalid baked plan: ${JSON.stringify(plan)}`)
}
const galleryPlan = plan.objects?.find((entry) => entry.name === 'Gallery')
const dayDecorPlan = plan.objects?.find((entry) => entry.name === 'Day Decor')
if (
  plan.atlases.main.targetDensity !== 12 ||
  plan.atlases.main.targetAchievement < 1 ||
  galleryPlan?.artistWeight !== 1 ||
  dayDecorPlan?.artistWeight !== 0.5 ||
  galleryPlan.pxPerMeter < 12 ||
  dayDecorPlan.pxPerMeter < 6
) {
  throw new Error(`weighted density contract was not enforced: ${JSON.stringify({
    atlas: plan.atlases.main,
    gallery: galleryPlan,
    dayDecor: dayDecorPlan,
  })}`)
}
if (
  plan.atlasLayout?.version !== 1 || plan.atlasLayout?.encoding !== 'f32le-zlib-base64' ||
  plan.atlasLayout?.space !== 'blender-pack' ||
  !plan.atlasLayout.objects?.length ||
  plan.atlasLayout.objects.some((entry) => !entry.topologyHash || !entry.uvHash || !entry.data)
) {
  throw new Error(`plan did not publish topology-checked packed UV evidence: ${JSON.stringify(plan.atlasLayout)}`)
}

const manifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
const generatedModulePath = join(work, 'src', 'generated', 'hero.gen.ts')
const generatedModule = readFileSync(generatedModulePath, 'utf8')
if (!manifest.bakePlan || manifest.presentation !== 'hybrid' || manifest.recipe?.atlases?.[0]?.id !== 'main') {
  throw new Error('manifest is missing the embedded recipe or bakePlan')
}
if (
  manifest.bakePlan.atlasLayout?.space !== 'final-glb-decoded' ||
  !manifest.bakePlan.atlasLayout?.objects?.length
) {
  throw new Error('final manifest is missing exact post-optimization packed UV evidence')
}
if (
  !manifest.bakePlan.atlasLayout.objects.some((entry) => entry.id === 'materialless-accent-id') ||
  manifest.bakePlan.atlasLayout.unavailable?.some((entry) => entry.id === 'materialless-accent-id')
) {
  throw new Error(
    `material-less baked mesh did not retain final-accessor-attested UV evidence: ` +
    `${JSON.stringify(manifest.bakePlan.atlasLayout)}`,
  )
}
if (manifest.optimization?.geometry !== 'meshopt' || !Number.isFinite(manifest.optimization.maxBoundsError)) {
  throw new Error(`manifest is missing its verified Meshopt report: ${JSON.stringify(manifest.optimization)}`)
}
if (!Number.isFinite(manifest.stats?.drawCallsEstimate) || !Number.isFinite(manifest.stats?.gpuTextureBytes)) {
  throw new Error(`manifest is missing expanded web build statistics: ${JSON.stringify(manifest.stats)}`)
}
if (
  !manifest.stateVisibility?.dark?.hiddenObjectIds?.includes('day-decor-id') ||
  !manifest.stateVisibility?.dark?.hiddenObjectIds?.includes('key-light-id') ||
  !generatedModule.includes('stateVisibility:') ||
  !generatedModule.includes('defaultState: "lit"')
) {
  throw new Error(`full collection-state visibility was not generated: ${JSON.stringify(manifest.stateVisibility)}`)
}
if (manifest.environment?.format !== 'hdr' || manifest.environment?.source !== 'packed' || !manifest.environment?.bytes || !manifest.environment?.hash) {
  throw new Error(`manifest is missing the published packed HDR: ${JSON.stringify(manifest.environment)}`)
}
const environmentPath = join(work, 'public', 'models', basename(manifest.environment.url))
if (!existsSync(environmentPath) || readFileSync(environmentPath).length !== manifest.environment.bytes) {
  throw new Error(`published HDR bytes are missing or truncated: ${environmentPath}`)
}
const posterTransform = manifest.textureTransforms?.find((entry) => entry.name === 'Hero Poster')
if (posterTransform?.publishedWidth !== 16 || posterTransform?.publishedHeight !== 8) {
  throw new Error(`real Blender texture maximum was not enforced: ${JSON.stringify(manifest.textureTransforms)}`)
}
const posterDependency = manifest.externalDependencies?.find((entry) => /hero-poster\.png$/i.test(entry.path))
if (!posterDependency?.hash || posterDependency.volatile) {
  throw new Error(`linked poster dependency was not published: ${JSON.stringify(manifest.externalDependencies)}`)
}
const litUrl = manifest.states?.lit?.url
const darkUrl = manifest.states?.dark?.url
if (!litUrl || !darkUrl) throw new Error('two baked state URLs were not generated')
if (
  !Number.isFinite(manifest.stateScales?.lit?.main) ||
  !Number.isFinite(manifest.stateScales?.dark?.main) ||
  manifest.stateScales.lit.main <= 0 ||
  manifest.stateScales.dark.main <= 0 ||
  !generatedModule.includes('stateScales:')
) {
  throw new Error(
    `Appearance state range evidence is missing: ${JSON.stringify(manifest.stateScales)}`,
  )
}
const lit = join(work, 'public', 'models', basename(litUrl))
const dark = join(work, 'public', 'models', basename(darkUrl))
execFileSync(blender, [
  '--background', '--factory-startup', '--python',
  join(root, 'scripts', 'verify-baked-e2e-images.py'), '--', lit, dark,
], { stdio: 'inherit' })

if (!manifest.bakeFingerprints || manifest.incrementalBake?.rebuiltJobs !== 2) {
  throw new Error(`first build did not publish its bake dependency graph: ${JSON.stringify(manifest.incrementalBake)}`)
}
const firstExecution = manifest.incrementalBake?.execution
if (
  firstExecution?.profile !== 'final' ||
  !Number.isFinite(firstExecution.durationMs) || firstExecution.durationMs < 0 ||
  !['cpu', 'gpu'].includes(firstExecution.deviceClass) ||
  typeof firstExecution.backend !== 'string' ||
  firstExecution.jobs?.length !== 2 ||
  firstExecution.jobs.some((job) =>
    job.status !== 'rebuilt' || !Number.isFinite(job.durationMs) ||
    job.durationMs < 0 || !Number.isInteger(job.effectiveSize) || job.effectiveSize < 1
  )
) {
  throw new Error(`first build did not publish truthful privacy-safe bake timing evidence: ${JSON.stringify(firstExecution)}`)
}
if (!manifest.bakeArtifactHashes?.states?.lit?.main || !manifest.bakeArtifactHashes?.states?.dark?.main) {
  throw new Error(`first build did not publish exact atlas byte hashes: ${JSON.stringify(manifest.bakeArtifactHashes)}`)
}
if (
  !generatedModule.includes(`${litUrl}?v=${manifest.bakeArtifactHashes.states.lit.main}`) ||
  !generatedModule.includes(`${darkUrl}?v=${manifest.bakeArtifactHashes.states.dark.main}`)
) {
  throw new Error('generated state URLs are not cache-busted by exact atlas hashes')
}
const initialStateHashes = JSON.stringify(manifest.bakeArtifactHashes.states)

// Cache identity must not depend on whether an earlier state in this same
// invocation was rebuilt. A second forced compile of byte-identical input
// should reuse both jobs immediately; this is the direct regression for the
// former sequential fingerprint-then-bake ordering.
execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const unchangedManifest = JSON.parse(readFileSync(
  join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8',
))
if (
  unchangedManifest.incrementalBake?.totalJobs !== 2 ||
  unchangedManifest.incrementalBake?.reusedJobs !== 2 ||
  unchangedManifest.incrementalBake?.rebuiltJobs !== 0 ||
  unchangedManifest.incrementalBake?.execution?.jobs?.length !== 2 ||
  unchangedManifest.incrementalBake.execution.jobs.some((job) => job.status !== 'reused') ||
  JSON.stringify(unchangedManifest.bakeFingerprints?.states) !==
    JSON.stringify(manifest.bakeFingerprints.states) ||
  JSON.stringify(unchangedManifest.bakeArtifactHashes?.states) !== initialStateHashes
) {
  throw new Error(`unchanged second build did not reuse stable state identities: ${JSON.stringify({
    firstFingerprints: manifest.bakeFingerprints,
    secondFingerprints: unchangedManifest.bakeFingerprints,
    firstHashes: manifest.bakeArtifactHashes,
    secondHashes: unchangedManifest.bakeArtifactHashes,
    incremental: unchangedManifest.incrementalBake,
  })}`)
}

// A camera-lens edit changes the .blend and forces compilation, but it cannot
// change baked pixels or packing. Every state-atlas job must reuse the exact
// published file and skip Cycles.
execFileSync(blender, [
  blend, '--background', '--python-expr',
  `import bpy; bpy.data.cameras['Camera'].lens += 1; bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`,
], { stdio: 'inherit' })
execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const cachedManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (
  cachedManifest.incrementalBake?.totalJobs !== 2 ||
  cachedManifest.incrementalBake?.reusedJobs !== 2 ||
  cachedManifest.incrementalBake?.rebuiltJobs !== 0 ||
  cachedManifest.incrementalBake?.reused?.length !== 2
) {
  throw new Error(`camera-only edit did not reuse every atlas job: ${JSON.stringify({
    incremental: cachedManifest.incrementalBake,
    beforeFingerprints: manifest.bakeFingerprints,
    afterFingerprints: cachedManifest.bakeFingerprints,
    beforeUvs: manifest.bakePlan?.atlasLayout?.objects?.map((entry) => [entry.name, entry.uvHash]),
    afterUvs: cachedManifest.bakePlan?.atlasLayout?.objects?.map((entry) => [entry.name, entry.uvHash]),
  })}`)
}
if (
  cachedManifest.incrementalBake?.execution?.jobs?.length !== 2 ||
  cachedManifest.incrementalBake.execution.jobs.some((job) => job.status !== 'reused')
) {
  throw new Error(`cached build did not distinguish measured reuse work: ${JSON.stringify(cachedManifest.incrementalBake?.execution)}`)
}

// A Realtime object must export at its new transform without leaving a ghost
// in either atlas or invalidating otherwise-identical bake jobs.
execFileSync(blender, [
  blend, '--background', '--python-expr',
  `import bpy; bpy.data.objects['Poster'].location.x += 0.75; bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`,
], { stdio: 'inherit' })
execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const dynamicManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (
  dynamicManifest.incrementalBake?.reusedJobs !== 2 ||
  JSON.stringify(dynamicManifest.bakeArtifactHashes.states) !== initialStateHashes
) {
  throw new Error(`Realtime object movement invalidated or changed baked pixels: ${JSON.stringify(dynamicManifest.incrementalBake)}`)
}

// Linked file bytes are part of the whole-scene skip gate even when the
// .blend is untouched. Because this texture belongs only to a Realtime mesh,
// both atlas jobs remain safely reusable.
const posterPath = join(work, 'hero-poster.png')
execFileSync(blender, [
  '--background', '--factory-startup', '--python-expr',
  `import bpy; image=bpy.data.images.new('Changed Poster', width=64, height=32); image.generated_color=(0.1,0.8,0.3,1); image.filepath_raw=${JSON.stringify(posterPath)}; image.file_format='PNG'; image.save()`,
], { stdio: 'inherit' })
execFileSync(process.execPath, [cli, 'compile'], { cwd: work, stdio: 'inherit' })
const linkedManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
const changedPosterDependency = linkedManifest.externalDependencies?.find((entry) => /hero-poster\.png$/i.test(entry.path))
if (
  !changedPosterDependency?.hash || changedPosterDependency.hash === posterDependency.hash ||
  linkedManifest.incrementalBake?.reusedJobs !== 2
) {
  throw new Error(`linked texture drift did not rebuild metadata/GLB while reusing safe atlas jobs: ${JSON.stringify(linkedManifest.incrementalBake)}`)
}

// A failed optimizer/typegen run can leave a new GLB beside an old manifest.
// The ordinary (non-force) retry must detect both GLB and module byte drift,
// rebuild, and never leave that inconsistent set permanently "up to date".
const glbPath = join(work, 'public', 'models', 'hero.glb')
const modulePath = generatedModulePath
writeFileSync(glbPath, Buffer.concat([readFileSync(glbPath), Buffer.from('broken-glb-stage')]))
writeFileSync(modulePath, readFileSync(modulePath, 'utf8') + '\n// broken-module-stage\n')
execFileSync(process.execPath, [cli, 'compile'], { cwd: work, stdio: 'inherit' })
const retryManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
const hash16 = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)
if (
  hash16(readFileSync(glbPath)) !== retryManifest.hash ||
  hash16(readFileSync(modulePath)) !== retryManifest.generatedModuleHash ||
  readFileSync(modulePath, 'utf8').includes('broken-module-stage')
) {
  throw new Error('ordinary compile did not self-heal a split/partial published artifact set')
}

// Addressed graph directories are immutable. Recovery removes the complete
// graph, never one file within it. The stable compatibility mirror is not
// publication authority, but its hash-checked independent job remains a safe
// incremental cache: rebuild exactly the missing state and reuse the other.
removeActiveRuntimeGraph(retryManifest)
unlinkSync(lit)
execFileSync(process.execPath, [cli, 'compile'], { cwd: work, stdio: 'inherit' })
const repairedManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (
  repairedManifest.incrementalBake?.reusedJobs !== 1 ||
  repairedManifest.incrementalBake?.rebuiltJobs !== 1 ||
  !existsSync(lit)
) {
  throw new Error(`missing atlas was not repaired selectively: ${JSON.stringify(repairedManifest.incrementalBake)}`)
}

// Existence alone is not integrity. A present but truncated stable fallback
// must fail Blender-free CI. After removing the current complete immutable
// graph, compilation may reuse only the other hash-valid atlas job.
writeFileSync(dark, Buffer.from('corrupted atlas fixture'))
const corruptedVerify = spawnSync(process.execPath, [cli, 'verify'], { cwd: work, encoding: 'utf8' })
if (
  corruptedVerify.status !== 1 ||
  !/stable compatibility asset graph integrity failed/.test(
    corruptedVerify.stdout + corruptedVerify.stderr,
  )
) {
  throw new Error(`verify accepted a corrupt baked atlas: ${corruptedVerify.status} ${corruptedVerify.stdout} ${corruptedVerify.stderr}`)
}
removeActiveRuntimeGraph(repairedManifest)
execFileSync(process.execPath, [cli, 'compile'], { cwd: work, stdio: 'inherit' })
const integrityManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (
  integrityManifest.incrementalBake?.reusedJobs !== 1 ||
  integrityManifest.incrementalBake?.rebuiltJobs !== 1 ||
  !integrityManifest.incrementalBake?.invalidated?.some((entry) => entry.reason === 'artifact-changed') ||
  readFileSync(dark).length <= 'corrupted atlas fixture'.length
) {
  throw new Error(`corrupt atlas was not repaired selectively: ${JSON.stringify(integrityManifest.incrementalBake)}`)
}

// Renderer ray-visibility flags change bounce/shadows and therefore every
// affected atlas fingerprint.
execFileSync(blender, [
  blend, '--background', '--python-expr',
  `import bpy; bpy.data.objects['Gallery'].visible_shadow=False; bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`,
], { stdio: 'inherit' })
execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const rayManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (rayManifest.incrementalBake?.reusedJobs !== 0 || rayManifest.incrementalBake?.rebuiltJobs !== 2) {
  throw new Error(`ray-visibility edit reused stale atlas jobs: ${JSON.stringify(rayManifest.incrementalBake)}`)
}

// A material edit is a real pixel dependency. It must invalidate rather than
// ship the old lightmaps, proving the cache fails toward extra work, not stale
// output.
execFileSync(blender, [
  blend, '--background', '--python-expr',
  `import bpy; bpy.data.materials['Plaster'].diffuse_color[0] = 0.2; bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(blend)})`,
], { stdio: 'inherit' })
execFileSync(process.execPath, [cli, 'compile', '--force'], { cwd: work, stdio: 'inherit' })
const invalidatedManifest = JSON.parse(readFileSync(join(work, 'src', 'generated', 'hero.manifest.json'), 'utf8'))
if (
  invalidatedManifest.incrementalBake?.reusedJobs !== 0 ||
  invalidatedManifest.incrementalBake?.rebuiltJobs !== 2
) {
  throw new Error(`material edit reused stale atlas jobs: ${JSON.stringify(invalidatedManifest.incrementalBake)}`)
}

// Prove the quality gate itself: the same scene at an unattainable density
// must return an inspectable plan and a non-zero status before Cycles starts.
execFileSync(blender, [
  '--background', '--factory-startup', '--python',
  join(root, 'scripts', 'make-baked-e2e-scene.py'), '--', blend, '16',
], { stdio: 'ignore' })
const blockedRun = spawnSync(process.execPath, [cli, 'plan', '--json'], { cwd: work, encoding: 'utf8' })
const blockedPlan = JSON.parse(blockedRun.stdout).scenes[0]?.plan
if (blockedRun.status !== 1 || !blockedPlan?.errors?.length || !/density target/.test(blockedPlan.errors[0])) {
  throw new Error(`unattainable atlas was not blocked: ${blockedRun.status} ${JSON.stringify(blockedPlan)}`)
}

// Separated Lighting is a distinct product contract, not just another PNG:
// Cycles publishes indirect irradiance + scale while the GLB keeps authored
// PBR textures and TEXCOORD_0 alongside the derived lightmap channel.
const lightingWork = mkdtempSync(join(tmpdir(), 'blendlink-lightmap-e2e-'))
const lightingBlend = join(lightingWork, 'lightmap.blend')
execFileSync(blender, [
  '--background', '--factory-startup', '--python',
  join(root, 'scripts', 'make-baked-e2e-scene.py'), '--',
  lightingBlend, '12', 'lighting',
], { stdio: 'inherit' })
writeFileSync(join(lightingWork, 'blendlink.config.mjs'), `export default {
  outDir: 'public/models',
  genDir: 'src/generated',
  urlPrefix: '/models',
  scenes: [{ file: 'lightmap.blend', name: 'lightmap' }],
}\n`)
execFileSync(process.execPath, [cli, 'compile', '--force'], {
  cwd: lightingWork,
  stdio: 'inherit',
})

const lightingManifest = JSON.parse(readFileSync(
  join(lightingWork, 'src', 'generated', 'lightmap.manifest.json'), 'utf8',
))
const lightingModule = readFileSync(
  join(lightingWork, 'src', 'generated', 'lightmap.gen.ts'), 'utf8',
)
if (
  lightingManifest.bakeOutputs?.main !== 'lighting' ||
  !Number.isFinite(lightingManifest.stateScales?.lit?.main) ||
  !Number.isFinite(lightingManifest.stateScales?.dark?.main) ||
  lightingManifest.stateScales.lit.main <= 0 ||
  lightingManifest.stateScales.dark.main <= 0
) {
  throw new Error(`lighting output/scale evidence is missing: ${JSON.stringify({
    bakeOutputs: lightingManifest.bakeOutputs,
    stateScales: lightingManifest.stateScales,
  })}`)
}
if (!lightingModule.includes('bakeOutputs:') || !lightingModule.includes('stateScales:')) {
  throw new Error('generated scene module omitted lighting output/scale contracts')
}

const lightingGlbPath = join(lightingWork, 'public', 'models', 'lightmap.glb')
const lightingDocument = readGlbJson(lightingGlbPath)
const galleryNode = lightingDocument.nodes?.find((node) => node.name === 'Gallery')
const lightmapChannel = galleryNode?.extras?.blendlink_lightmap_uv
if (
  galleryNode?.extras?.blendlink_bake_output !== 'lighting' ||
  !Number.isInteger(lightmapChannel) || lightmapChannel < 1 || lightmapChannel > 3 ||
  !Number.isInteger(galleryNode.mesh)
) {
  throw new Error(`Gallery is missing lighting node metadata: ${JSON.stringify(galleryNode)}`)
}
const galleryPrimitive = lightingDocument.meshes?.[galleryNode.mesh]?.primitives?.[0]
if (
  !galleryPrimitive?.attributes?.TEXCOORD_0 ||
  !galleryPrimitive?.attributes?.[`TEXCOORD_${lightmapChannel}`]
) {
  throw new Error(`Gallery lost material/lightmap UV separation: ${JSON.stringify({
    channel: lightmapChannel,
    attributes: galleryPrimitive?.attributes,
  })}`)
}
const galleryMaterial = lightingDocument.materials?.[galleryPrimitive.material]
if (
  !galleryMaterial?.pbrMetallicRoughness?.baseColorTexture ||
  !galleryMaterial?.normalTexture ||
  galleryMaterial?.extensions?.KHR_materials_unlit ||
  lightingDocument.extensionsUsed?.includes('KHR_materials_unlit')
) {
  throw new Error(`Gallery PBR material was flattened during lighting export: ${JSON.stringify(galleryMaterial)}`)
}

const lightingLit = join(
  lightingWork, 'public', 'models', basename(lightingManifest.states?.lit?.url ?? ''),
)
const lightingDark = join(
  lightingWork, 'public', 'models', basename(lightingManifest.states?.dark?.url ?? ''),
)
execFileSync(blender, [
  '--background', '--factory-startup', '--python',
  join(root, 'scripts', 'verify-baked-e2e-images.py'), '--', lightingLit, lightingDark,
], { stdio: 'inherit' })

console.log('BLENDLINK_BAKED_E2E_PASSED', work)
