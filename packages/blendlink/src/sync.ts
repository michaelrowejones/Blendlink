import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { exportBlend } from './invoke.js'
import type { ExportSettings, IncrementalBakeCache } from './invoke.js'
import { emitProgress } from './progress.js'
import { generateSceneModule, parseManifest, type SceneManifest } from './typegen.js'
import {
  assertConfigSourceRevisionCurrent,
  type ResolvedConfig,
  type ResolvedScene,
} from './config.js'
import { parseSceneRecipe, type SceneRecipe } from './sceneRecipe.js'
import {
  BAKED_RECIPE_TEMPLATE_VERSION,
  bakedRecipeBackupPath,
  inspectBakedRecipeTemplate,
} from './bakedRecipe.js'
import {
  createSceneAssetGraph,
  diffSceneAssetGraphs,
  inspectCompilerStagingDirectory,
  sceneAssetGraphPath,
  sceneAssetGraphIntegrityProblem,
} from './sceneAssetGraph.js'
import { auditCompiledSceneArtifact, type CompiledSceneAudit } from './compiledSceneAudit.js'
import {
  publicationRootsForScene,
  withPublicationScopes,
  type PublicationScopesLease,
} from './publicationScopes.js'
import {
  createSceneRuntimePublication,
  sceneRuntimePublicationForGraph,
  sceneRuntimePublicationDirectory,
  sceneRuntimePublicationProblem,
  sceneRuntimePublicationUrl,
  sealScenePublication,
} from './scenePublication.js'
import {
  readLocalPathProvenance,
  writeLocalPathProvenance,
} from './generatedProvenance.js'
import { inspectRealtimePlanMaterialDiagnostics } from './planManifest.js'

/** What the addon's build actions run; also shown to humans in the panel. */
const DEFAULT_SYNC_HINT = 'npx blendlink compile'
const KTX2_TRANSCODER_DIRECTORY = 'blendlink-basis'
const KTX2_THREE_FILES = [
  'basis_transcoder.js',
  'basis_transcoder.wasm',
  'README.md',
] as const
const runtimeRequire = createRequire(import.meta.url)

export interface SyncOutcome {
  scene: string
  action: 'exported' | 'built' | 'skipped'
  durationMs: number
  stats?: SceneManifest['stats']
  /** Human summary of what the vocabulary parser found ("3 colliders, 1 socket"). */
  vocabulary?: string
  warnings: string[]
}

function enforceRealtimeMaterialPublication(
  scene: Pick<ResolvedScene, 'name' | 'applicationMaterialAdapter'>,
  diagnostics: Parameters<typeof inspectRealtimePlanMaterialDiagnostics>[0],
  bakePlan: Parameters<typeof inspectRealtimePlanMaterialDiagnostics>[1]['bakePlan'],
): string[] {
  const inspection = inspectRealtimePlanMaterialDiagnostics(diagnostics, {
    ...(bakePlan ? { bakePlan } : {}),
    ...(scene.applicationMaterialAdapter
      ? { applicationMaterialAdapter: scene.applicationMaterialAdapter }
      : {}),
  })
  if (inspection.errors.length > 0) {
    const details = inspection.errors.flatMap((issue) => [
      `  - ${issue.material} (used by ${issue.usedBy.join(', ')}): ${issue.summary}`,
      ...issue.reasons.map((reason) => `      ${reason}`),
    ])
    throw new Error(
      `Blendlink Material Fidelity refused to publish ${scene.name}: ` +
        `${inspection.errors.length} used material` +
        `${inspection.errors.length === 1 ? '' : 's'} would lose authored surface behavior.\n` +
        `${details.join('\n')}\n` +
        'Open Material Fidelity in Blender and choose an evidenced Website Material, ' +
        'portable glTF, or supported Appearance route. The staged export was discarded; ' +
        'the previous publication was not changed.',
    )
  }
  return inspection.warnings.map((issue) =>
    `Material Fidelity accepted by applicationMaterialAdapter ` +
    `"${issue.acknowledgedBy}": ${issue.material} is used by ` +
    `${issue.usedBy.join(', ')} and still needs a website-owned material result. ` +
    `${issue.reasons.join(' ')} Keep this adapter covered by the application browser gate.`,
  )
}

function vocabularySummary(manifest: SceneManifest | null): string | undefined {
  const vocabulary = manifest?.vocabulary
  if (!vocabulary) return undefined
  const parts = (
    [
      ['collider', vocabulary.colliders?.length],
      ['LOD chain', vocabulary.lods?.length],
      ['socket', vocabulary.sockets?.length],
      ['hotspot', vocabulary.hotspots?.length],
      ['audio anchor', vocabulary.audio?.length],
      ['rigid body', vocabulary.physics?.length],
    ] as const
  )
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([label, count]) => `${count} ${label}${count === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(', ') : undefined
}

function blendBytesHashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

function artifactHashOf(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

function publishedAssetPath(
  scene: Pick<ResolvedScene, 'glbPath' | 'url'>,
  assetUrl: string,
  manifest?: Pick<
    SceneManifest,
    'url' | 'runtimeAssetGraph' | 'runtimeAssetPublication'
  >,
): string | null {
  try {
    const publication = manifest?.runtimeAssetPublication
    if (
      publication
      && sceneRuntimePublicationProblem(
        publication,
        manifest.runtimeAssetGraph,
      ) !== null
    ) return null
    const referenceUrl = publication ? manifest!.url : scene.url
    if (referenceUrl.includes('\\') || assetUrl.includes('\\')) return null
    const placeholderOrigin = 'https://blendlink.invalid/'
    const reference = new URL(referenceUrl, placeholderOrigin)
    const asset = new URL(assetUrl, reference)
    if (asset.origin !== reference.origin) return null
    const decodeSegments = (pathname: string): string[] => pathname.split('/').map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes('/') || decoded.includes('\\')) {
        throw new Error('encoded path separator')
      }
      return decoded
    })
    const referenceSegments = decodeSegments(reference.pathname)
    const assetSegments = decodeSegments(asset.pathname)
    const declaredSceneSegments = publication
      ? publication.scenePath.split('/')
      : [referenceSegments.at(-1)!]
    const encodedSceneSegments = referenceSegments.slice(
      -declaredSceneSegments.length,
    )
    if (
      encodedSceneSegments.length !== declaredSceneSegments.length
      || encodedSceneSegments.some(
        (segment, index) => segment !== declaredSceneSegments[index],
      )
    ) return null
    const rootSegments = referenceSegments.slice(
      0,
      -declaredSceneSegments.length,
    )
    if (
      assetSegments.length <= rootSegments.length
      || rootSegments.some(
        (segment, index) => assetSegments[index] !== segment,
      )
    ) return null
    const graphPath = assetSegments.slice(rootSegments.length).join('/')
    const localRoot = publication
      ? sceneRuntimePublicationDirectory(dirname(scene.glbPath), publication)
      : dirname(scene.glbPath)
    const localPath = resolve(localRoot, ...graphPath.split('/'))
    sceneAssetGraphPath(localRoot, localPath)
    return localPath
  } catch {
    return null
  }
}

function addressedRuntimeAssetUrl(
  scene: Pick<ResolvedScene, 'glbPath' | 'url'>,
  publication: NonNullable<SceneManifest['runtimeAssetPublication']>,
  legacyUrl: string,
): string {
  const legacyPath = publishedAssetPath(scene, legacyUrl)
  if (!legacyPath) {
    throw new Error(
      `Compiler-owned asset URL cannot be mapped into the scene graph: ${legacyUrl}`,
    )
  }
  const graphPath = sceneAssetGraphPath(dirname(scene.glbPath), legacyPath)
  return sceneRuntimePublicationUrl(scene.url, publication, graphPath)
}

function addressedTypegenAssetFields(
  scene: Pick<ResolvedScene, 'glbPath' | 'url'>,
  publication: NonNullable<SceneManifest['runtimeAssetPublication']>,
  fields: {
    atlasDelivery?: SceneManifest['atlasDelivery']
    textureVariants?: SceneManifest['textureVariants']
    environment?: SceneManifest['environment']
    materialPrograms?: SceneManifest['materialPrograms']
    reflectionProbeAssets?: SceneManifest['reflectionProbeAssets']
    states?: SceneManifest['states']
    lightGroups?: SceneManifest['lightGroups']
  },
): typeof fields {
  const address = (url: string): string =>
    addressedRuntimeAssetUrl(scene, publication, url)
  const atlasDelivery = fields.atlasDelivery
    ? {
        ...fields.atlasDelivery,
        entries: fields.atlasDelivery.entries.map((entry) => entry.embedded
          ? entry
          : {
              ...entry,
              source: address(entry.source),
              variant: {
                ...entry.variant,
                url: address(entry.variant.url),
              },
            }),
      }
    : undefined
  const textureVariants = fields.textureVariants
    ? Object.fromEntries(Object.entries(fields.textureVariants).map(
        ([source, variants]) => [
          address(source),
          variants.map((variant) => ({
            ...variant,
            url: address(variant.url),
          })),
        ],
      ))
    : undefined
  const environment = fields.environment
    ? {
        ...fields.environment,
        url: address(fields.environment.url),
        ...(fields.environment.optimized
          ? {
              optimized: {
                ...fields.environment.optimized,
                url: address(fields.environment.optimized.url),
              },
            }
          : {}),
      }
    : undefined
  const materialPrograms = fields.materialPrograms
    ? { ...fields.materialPrograms, url: address(fields.materialPrograms.url) }
    : undefined
  const reflectionProbeAssets = fields.reflectionProbeAssets
    ? Object.fromEntries(Object.entries(fields.reflectionProbeAssets).map(
        ([id, asset]) => [id, { ...asset, url: address(asset.url) }],
      ))
    : undefined
  const states = fields.states
    ? Object.fromEntries(Object.entries(fields.states).map(([name, state]) => [
        name,
        {
          ...state,
          ...(state.url ? { url: address(state.url) } : {}),
          ...(state.atlases
            ? {
                atlases: Object.fromEntries(Object.entries(state.atlases).map(
                  ([atlas, url]) => [atlas, address(url)],
                )),
              }
            : {}),
        },
      ]))
    : undefined
  const lightGroups = fields.lightGroups
    ? Object.fromEntries(Object.entries(fields.lightGroups).map(
        ([name, group]) => [
          name,
          {
            ...group,
            ...(group.url ? { url: address(group.url) } : {}),
            ...(group.atlases
              ? {
                  atlases: Object.fromEntries(Object.entries(group.atlases).map(
                    ([atlas, layer]) => [
                      atlas,
                      { ...layer, url: address(layer.url) },
                    ],
                  )),
                }
              : {}),
          },
        ],
      ))
    : undefined
  return {
    ...(atlasDelivery ? { atlasDelivery } : {}),
    ...(textureVariants ? { textureVariants } : {}),
    ...(environment ? { environment } : {}),
    ...(materialPrograms ? { materialPrograms } : {}),
    ...(reflectionProbeAssets ? { reflectionProbeAssets } : {}),
    ...(states ? { states } : {}),
    ...(lightGroups ? { lightGroups } : {}),
  }
}

function bakedRecipePath(modulePath: string): string {
  const path = modulePath.replace(/\.gen\.ts$/, '.baked.ts')
  if (path === modulePath) {
    throw new Error(`Generated scene module must end in .gen.ts: ${modulePath}`)
  }
  return path
}

function bakedRecipeMigrationWarning(path: string, sceneName: string): string | null {
  if (!existsSync(path)) return null
  const status = inspectBakedRecipeTemplate(readFileSync(path, 'utf8'))
  if (status.kind === 'current') return null
  if (status.kind === 'future') {
    return `generated recipe ${path} uses template v${status.version}, newer than this Blendlink ` +
      `release supports (v${BAKED_RECIPE_TEMPLATE_VERSION}); install a matching newer Blendlink release`
  }
  return `generated recipe ${path} predates baked composition template v${BAKED_RECIPE_TEMPLATE_VERSION} ` +
    `and was left untouched; run \`blendlink recipe update ${sceneName}\` to preserve its exact bytes at ` +
    `${bakedRecipeBackupPath(path, status)} and install the current editable template`
}

function bakedRecipeRequirement(manifest: SceneManifest | null): string | null {
  if (Object.values(manifest?.bakeOutputs ?? {}).includes('lighting')) return 'a Lighting atlas'
  for (const scales of Object.values(manifest?.stateScales ?? {})) {
    for (const [group, scale] of Object.entries(scales)) {
      if (manifest?.bakeOutputs?.[group] !== 'lighting' && !Object.is(scale, 1)) {
        return 'a normalized Appearance state'
      }
    }
  }
  return null
}

function assertLightingRecipeCurrent(
  manifest: SceneManifest | null,
  path: string,
  sceneName: string,
): void {
  const requirement = bakedRecipeRequirement(manifest)
  if (!requirement || !existsSync(path)) return
  const status = inspectBakedRecipeTemplate(readFileSync(path, 'utf8'))
  if (status.kind === 'current') return
  const action = status.kind === 'future'
    ? 'Install the matching newer Blendlink release.'
    : `Run \`blendlink recipe update ${sceneName}\` first; it will preserve the exact editable file at ${bakedRecipeBackupPath(path, status)}.`
  throw new Error(
    `Scene "${sceneName}" contains ${requirement}, but ${path} is not the supported ` +
      `baked recipe template v${BAKED_RECIPE_TEMPLATE_VERSION}. ${action} ` +
      'Blendlink did not publish or preview the incomplete baked composition.',
  )
}

type PublishCandidate =
  | { finalPath: string; sourcePath: string }
  | { finalPath: string; content: string | Uint8Array }

function ktx2RuntimeAssetsRequired(manifest: SceneManifest): boolean {
  return manifest.requiresKtx2 === true
    || manifest.textureCompression?.format === 'ktx2'
    || manifest.environment?.optimized?.format === 'ktx2'
}

function ktx2TranscoderSources(): Array<{ filename: string; sourcePath: string }> {
  const sources: Array<{ filename: string; sourcePath: string }> = KTX2_THREE_FILES.map((filename) => {
    try {
      return {
        filename,
        sourcePath: runtimeRequire.resolve(`three/addons/libs/basis/${filename}`),
      }
    } catch (error) {
      throw new Error(
        `Blendlink cannot publish ${filename} for KTX2 runtime decoding. Install the Three.js peer ` +
          'dependency with its examples/jsm/libs/basis assets intact, then run `blendlink sync` again. ' +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
  const licensePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'assets',
    'basis-apache-2.0.txt',
  )
  if (!existsSync(licensePath)) {
    throw new Error(
      `Blendlink's bundled Basis Universal Apache-2.0 license is missing from ${licensePath}. ` +
        'Reinstall Blendlink before publishing KTX2 runtime assets.',
    )
  }
  sources.push({ filename: 'LICENSE', sourcePath: licensePath })
  return sources
}

function ktx2TranscoderPublishCandidates(publishDirectory: string): PublishCandidate[] {
  return ktx2TranscoderSources().map(({ filename, sourcePath }) => ({
    finalPath: join(publishDirectory, KTX2_TRANSCODER_DIRECTORY, filename),
    content: readFileSync(sourcePath),
  }))
}

/** Publish the complete Three.js/Basis decoder beside an already-built GLB.
 * External pipelines use this after generic typegen detects
 * KHR_texture_basisu; internal sync includes the same candidates in its
 * larger artifact transaction. */
export async function publishKtx2RuntimeAssets(
  publishDirectory: string,
): Promise<string[]> {
  const directory = resolve(publishDirectory)
  return withPublicationScopes({
    roots: [directory],
    intent: 'ktx2-runtime',
    label: `${basename(directory)} / KTX2 runtime`,
    onWait(fact) {
      emitProgress(0, fact.message)
    },
  }, () => {
    const candidates = ktx2TranscoderPublishCandidates(directory)
    commitPublishedFiles(candidates, `ktx2-${process.pid}-${Date.now()}`)
    const problem = ktx2TranscoderIntegrityProblem(directory)
    if (problem) {
      throw new Error(`KTX2 runtime transcoder integrity failed after publication: ${problem}`)
    }
    return candidates.map((candidate) => candidate.finalPath)
  })
}

function ktx2TranscoderIntegrityProblem(publishDirectory: string): string | null {
  let sources: ReturnType<typeof ktx2TranscoderSources>
  try {
    sources = ktx2TranscoderSources()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  for (const { filename, sourcePath } of sources) {
    const publishedPath = join(publishDirectory, KTX2_TRANSCODER_DIRECTORY, filename)
    if (!existsSync(publishedPath)) return `${filename} is missing from ${publishedPath}`
    if (artifactHashOf(publishedPath) !== artifactHashOf(sourcePath)) {
      return `${publishedPath} does not match the installed Three.js/Basis runtime asset`
    }
  }
  return null
}

/** Commit a compiler-owned artifact set with rollback. Every next file is
 * prepared before any current file moves; a failed rename restores the whole
 * prior set, so an optimizer/typegen exception never breaks the live site. */
export function commitPublishedFiles(
  candidates: PublishCandidate[],
  token: string,
  renameFile: (oldPath: string, newPath: string) => void = renameSync,
): void {
  const finalPaths = new Set<string>()
  let preserveRecoveryFiles = false
  const prepared: Array<PublishCandidate & {
    nextPath: string
    backupPath: string
    backedUp: boolean
    installed: boolean
  }> = []
  try {
    for (const [index, candidate] of candidates.entries()) {
      const finalPath = resolve(candidate.finalPath)
      if (finalPaths.has(finalPath)) {
        throw new Error(`Publication transaction declares ${candidate.finalPath} more than once`)
      }
      finalPaths.add(finalPath)
      mkdirSync(dirname(candidate.finalPath), { recursive: true })
      const nextPath = `${candidate.finalPath}.blendlink-next-${token}-${index}`
      const backupPath = `${candidate.finalPath}.blendlink-backup-${token}-${index}`
      if (existsSync(nextPath) || existsSync(backupPath)) {
        throw new Error(`Refusing to reuse an existing publication transaction file for ${candidate.finalPath}`)
      }
      if ('sourcePath' in candidate) renameFile(candidate.sourcePath, nextPath)
      else writeFileSync(nextPath, candidate.content)
      prepared.push({ ...candidate, nextPath, backupPath, backedUp: false, installed: false })
    }
    for (const entry of prepared) {
      if (existsSync(entry.finalPath)) {
        renameFile(entry.finalPath, entry.backupPath)
        entry.backedUp = true
      }
      renameFile(entry.nextPath, entry.finalPath)
      entry.installed = true
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const entry of [...prepared].reverse()) {
      try {
        if (entry.installed && existsSync(entry.finalPath)) {
          renameFile(entry.finalPath, entry.nextPath)
        }
        if (entry.backedUp && existsSync(entry.backupPath)) {
          renameFile(entry.backupPath, entry.finalPath)
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length > 0) {
      preserveRecoveryFiles = true
      const recoveryPaths = prepared.flatMap((entry) =>
        [entry.nextPath, entry.backupPath].filter((path) => existsSync(path)),
      )
      const recoveryDetail = recoveryPaths.length > 0
        ? ` Recovery files preserved: ${recoveryPaths.join(', ')}`
        : ''
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Publication failed and rollback was incomplete.${recoveryDetail}`,
      )
    }
    throw error
  } finally {
    if (!preserveRecoveryFiles) {
      for (const entry of prepared) {
        rmSync(entry.nextPath, { force: true })
        rmSync(entry.backupPath, { force: true })
      }
    }
  }
}

export function externalDependenciesCurrent(
  manifest: SceneManifest,
  scene: Pick<ResolvedScene, 'blendPath'> & Partial<Pick<ResolvedScene, 'root'>>,
  options: { localProvenanceRoot?: string } = {},
): boolean {
  for (const dependency of manifest.externalDependencies ?? []) {
    // Retain proven residue in the manifest for artist cleanup without
    // making irrelevant addon/material files part of the build cache key.
    if (
      dependency.reachable === false &&
      dependency.reachabilityReason === 'unbound-material'
    ) continue
    if (dependency.volatile) return false
    const path = dependency.relativeToBlend
      ? resolve(dirname(scene.blendPath), dependency.path)
      : dependency.projectRelative
        ? scene.root
          ? resolve(scene.root, dependency.path)
          : null
        : dependency.localPathKey
          ? readLocalPathProvenance(dependency.localPathKey, {
              ...(options.localProvenanceRoot
                ? { cacheRoot: options.localProvenanceRoot }
                : {}),
            })
          : dependency.path
    // Private provenance never falls back to an opaque public label. Missing
    // local state is deliberately stale so dependency drift cannot pass.
    if (!path) return false
    const exists = existsSync(path)
    if (exists !== dependency.exists) return false
    if (exists && (
      readFileSync(path).byteLength !== dependency.bytes ||
      artifactHashOf(path) !== dependency.hash
    )) return false
  }
  return true
}

export function externalDependencyWarnings(
  dependencies: NonNullable<SceneManifest['externalDependencies']>,
): string[] {
  const missingReachable = dependencies.filter(
    (dependency) => !dependency.exists && !(
      dependency.reachable === false &&
      dependency.reachabilityReason === 'unbound-material'
    ),
  )
  const missingUnboundMaterials = dependencies.filter(
    (dependency) => !dependency.exists &&
      dependency.reachable === false &&
      dependency.reachabilityReason === 'unbound-material',
  )
  const preview = (items: typeof dependencies) => {
    const examples = items.slice(0, 3).map((dependency) => dependency.path).join(', ')
    return `${examples}${items.length > 3 ? ` (+${items.length - 3} more)` : ''}`
  }
  const warnings: string[] = []
  if (missingReachable.length) {
    warnings.push(
      `${missingReachable.length} Blender file reference` +
        `${missingReachable.length === 1 ? ' is' : 's are'} missing: ` +
        `${preview(missingReachable)}. The source may render differently on another machine; ` +
        'pack or relink intentional dependencies.',
    )
  }
  if (missingUnboundMaterials.length) {
    warnings.push(
      `${missingUnboundMaterials.length} unused Blender image reference` +
        `${missingUnboundMaterials.length === 1 ? ' is' : 's are'} missing: ` +
        `${preview(missingUnboundMaterials)}. ` +
        'Blendlink proved these images are referenced only by material graphs outside the ' +
        'exported render-visible object scope, so they cannot affect this build. Purge the ' +
        'unused data, or relink it before assigning those materials to exported objects.',
    )
  }
  return warnings
}

/** Combined hash of a scene's declared extra compiler inputs (for example an
 * external pipeline config), including path boundaries and missing state. */
function inputsHashOf(scene: ResolvedScene): string | null {
  if (!scene.inputs || scene.inputs.length === 0) return null
  const digest = createHash('sha256')
  for (const input of scene.inputs) {
    const label = relative(scene.root, input).replace(/\\/g, '/')
    digest.update(`${label.length}:${label}:`)
    if (!existsSync(input)) {
      digest.update('missing;')
      continue
    }
    const bytes = readFileSync(input)
    digest.update(`present:${bytes.byteLength}:`)
    digest.update(bytes)
  }
  return digest.digest('hex').slice(0, 16)
}

/** Legacy config scenes keep the historical quarter-size preview transform.
 * Scene-owned recipes select their explicit Preview profile in Blender. */
export function draftSettings(scene: ResolvedScene): ResolvedScene['settings'] {
  if (scene.settings.mode !== 'baked') return { ...scene.settings, draft: true }
  const bake = scene.settings.bake ?? {}
  const previewSize = (size: number) => Math.min(
    size,
    Math.max(Math.min(size, 256), Math.floor(size / 4)),
  )
  const previewMargin = (margin: number, scale: number) => margin === 0
    ? 0
    : Math.max(1, Math.round(margin * scale))
  const finalMainSize = bake.size ?? 2048
  const mainSize = previewSize(finalMainSize)
  const mainScale = mainSize / finalMainSize
  const atlases = bake.atlases
    ? Object.fromEntries(Object.entries(bake.atlases).map(([name, atlas]) => {
        const finalSize = atlas.size ?? 2048
        const size = previewSize(finalSize)
        const scale = size / finalSize
        return [name, {
          ...atlas,
          size,
          ...(atlas.targetDensity !== undefined
            ? { targetDensity: atlas.targetDensity * scale }
            : {}),
          ...(atlas.margin !== undefined
            ? { margin: previewMargin(atlas.margin, scale) }
            : {}),
          fitPolicy: 'scale' as const,
        }]
      }))
    : undefined
  const previewScaleToFit = Object.values(bake.atlases ?? {})
    .some((atlas) => atlas.fitPolicy === 'block')
  return {
    ...scene.settings,
    draft: true,
    bake: {
      ...bake,
      size: mainSize,
      samples: Math.max(8, Math.floor((bake.samples ?? 128) / 8)),
      ...(bake.margin !== undefined
        ? { margin: previewMargin(bake.margin, mainScale) }
        : {}),
      supersample: 1,
      ...(atlases ? { atlases } : {}),
      ...(previewScaleToFit ? { previewScaleToFit: true } : {}),
    },
  }
}

/** External scenes: artifacts owned by another pipeline; run its declared
 * build command when the .blend drifted, skip when everything matches. */
function syncExternalScene(
  scene: ResolvedScene,
  options: { force?: boolean },
  delegationEnvironment: Readonly<Record<string, string>>,
): SyncOutcome {
  const started = Date.now()
  const blendHash = existsSync(scene.blendPath) ? blendBytesHashOf(scene.blendPath) : null
  const inputsHash = inputsHashOf(scene)
  const manifest = readManifest(scene.manifestPath)
  const recipeWarning = bakedRecipeMigrationWarning(bakedRecipePath(scene.modulePath), scene.name)
  assertLightingRecipeCurrent(manifest, bakedRecipePath(scene.modulePath), scene.name)
  const inSync =
    blendHash !== null &&
    manifest?.blendBytesHash === blendHash &&
    manifest?.url === scene.url &&
    (inputsHash === null || manifest?.inputsHash === inputsHash) &&
    existsSync(scene.glbPath) &&
    existsSync(scene.modulePath)
  if (inSync && !options.force) {
    // Stamp the build command even when skipping, so the Blender addon can
    // show "run this" the moment the artist's next save causes drift.
    if (
      manifest
      && (
        (scene.build && manifest.syncHint !== scene.build)
        || (
          scene.configSource
          && manifest.configSourceHash !== scene.configSource.hash
        )
      )
    ) {
      if (scene.build) manifest.syncHint = scene.build
      if (scene.configSource) {
        manifest.configSourceHash = scene.configSource.hash
      }
      writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    }
    return {
      scene: scene.name,
      action: 'skipped',
      durationMs: Date.now() - started,
      warnings: recipeWarning ? [recipeWarning] : [],
    }
  }
  if (!scene.build) {
    return {
      scene: scene.name,
      action: 'skipped',
      durationMs: Date.now() - started,
      warnings: [
        ...(recipeWarning ? [recipeWarning] : []),
        'external scene is out of date but has no `build` command — run your pipeline, then `blendlink typegen <glb> --blend <file>` (or add `build` to the scene config so sync can do it)',
      ],
    }
  }
  emitProgress(0.03, `running build for ${scene.name}`)
  const result = spawnSync(scene.build, {
    shell: true,
    cwd: scene.root,
    stdio: 'inherit',
    env: { ...process.env, ...delegationEnvironment },
  })
  if (result.status !== 0) {
    throw new Error(`build command failed for "${scene.name}" (exit ${result.status}): ${scene.build}`)
  }
  const warnings: string[] = []
  if (recipeWarning) warnings.push(recipeWarning)
  emitProgress(0.95, 'stamping manifest')
  const rebuilt = readManifest(scene.manifestPath)
  assertConfigSourceRevisionCurrent(scene.configSource)
  assertLightingRecipeCurrent(rebuilt, bakedRecipePath(scene.modulePath), scene.name)
  const freshBlendHash = existsSync(scene.blendPath) ? blendBytesHashOf(scene.blendPath) : null
  if (!rebuilt || rebuilt.blendBytesHash !== freshBlendHash) {
    warnings.push(
      'build command finished but the manifest is not stamped with the current .blend — make sure it ends with `blendlink typegen <glb> --blend <file>`',
    )
  } else {
    // Stamp the build command (for the addon's "run this"), the duration
    // (for plan-time estimates), and the inputs hash (drift gate).
    rebuilt.syncHint = scene.build
    rebuilt.lastSyncDurationMs = Date.now() - started
    if (scene.configSource) {
      rebuilt.configSourceHash = scene.configSource.hash
    }
    const freshInputsHash = inputsHashOf(scene)
    if (freshInputsHash) rebuilt.inputsHash = freshInputsHash
    writeFileSync(scene.manifestPath, JSON.stringify(rebuilt, null, 2) + '\n')
  }
  emitProgress(1, `${scene.name} up to date`)
  return {
    scene: scene.name,
    action: 'built',
    durationMs: Date.now() - started,
    ...(rebuilt?.stats ? { stats: rebuilt.stats } : {}),
    ...(vocabularySummary(rebuilt) ? { vocabulary: vocabularySummary(rebuilt) } : {}),
    warnings,
  }
}

/** Hash every Python helper that can affect compiler output. The narrower
 * per-atlas fingerprint inside Blender separately hashes only pixel-affecting
 * bake code, so a diagnostics-only change rebuilds metadata without forcing
 * Cycles. */
export function pythonPipelineSignature(
  moduleDirectory = dirname(fileURLToPath(import.meta.url)),
): string {
  const directories = [
    join(moduleDirectory, 'blender'),
    join(moduleDirectory, '..', 'blender'),
  ]
  for (const directory of directories) {
    if (!existsSync(join(directory, 'export_scene.py')) || !existsSync(join(directory, 'bakelib.py'))) continue
    const files = readdirSync(directory)
      .filter((entry) => entry.endsWith('.py'))
      .map((entry) => join(directory, entry))
    // These policies are authored once in the addon and copied into dist. Add
    // their sources explicitly when TypeScript runs before a package build;
    // otherwise a diagnostics/export-policy edit could incorrectly reuse a
    // stale scene because the source hash never saw it.
    const addonSourceDirectory = join(moduleDirectory, '..', '..', 'blender-addon')
    for (const entry of [
      'glblib.py', 'material_compiler.py', 'nla_sequence.py', 'probe_authoring.py',
      'procedural.py', 'weblights.py',
    ]) {
      const source = join(addonSourceDirectory, entry)
      if (!files.some((path) => basename(path) === entry) && existsSync(source)) {
        files.push(source)
      }
    }
    const digest = createHash('sha256')
    for (const path of files.sort((left, right) => basename(left).localeCompare(basename(right)))) {
      digest.update(basename(path)).update(readFileSync(path))
    }
    return digest.digest('hex').slice(0, 16)
  }
  throw new Error('Blendlink Python pipeline assets are missing; run the package build again')
}

/** Hash the deterministic compiler stages that can change published bytes or
 * contracts without an artist/config edit. Released version bumps normally
 * catch this; hashing the actual modules also keeps development builds and
 * source installs honest. */
function compilerPipelineSignature(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const modules = [
    'sync', 'invoke', 'typegen', 'planManifest', 'atlasLayout', 'sceneRecipe', 'sceneDiagnostics', 'runtimeDiagnostics', 'loadedNames', 'vocabulary',
    'optimizer', 'textureCompression', 'environmentCompression', 'atlasDelivery',
    'performance', 'components', 'componentRuntime', 'sceneAssetGraph',
    'scenePublication', 'assetUrls',
  ]
  const digest = createHash('sha256')
  for (const name of modules) {
    const path = ['js', 'ts']
      .map((extension) => join(moduleDirectory, `${name}.${extension}`))
      .find((candidate) => existsSync(candidate))
    if (!path) throw new Error(`Blendlink compiler module ${name} is missing; run the package build again`)
    digest.update(readFileSync(path))
  }
  return digest.digest('hex').slice(0, 16)
}

function sourceHash(
  scene: ResolvedScene,
  settings: ResolvedScene['settings'],
  blenderVersion: string,
): string {
  const configDigest = createHash('sha256')
  let configFiles = 0
  for (const name of ['blendlink.config.mjs', 'blendlink.config.js']) {
    const path = join(scene.root, name)
    if (!existsSync(path)) continue
    configDigest.update(name).update(readFileSync(path))
    configFiles += 1
  }
  const digest = createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .update(JSON.stringify(settings))
    // Resolved settings are the semantic input, while the source config hash
    // is the publication fence. If an artist edits/removes/renames a scene
    // during a long export, the old resolved snapshot must not activate.
    .update(configFiles > 0 ? configDigest.digest('hex') : '')
    // `inputs` are explicit compiler dependencies, not merely watch hints.
    // Without this, an internal scene wakes on an input edit only to skip.
    .update(inputsHashOf(scene) ?? '')
    .update(blenderVersion)
    .update(compilerPipelineSignature())
    // Scene-owned Hybrid/Baked presentation is resolved inside Blender, so the
    // legacy external settings object can still say "standard". Include every
    // Blender-side compiler helper for every scene so Python tool changes can
    // never leave apparently fresh artifacts produced by older code.
    .update(pythonPipelineSignature())
  return digest.digest('hex').slice(0, 16)
}

function readManifest(path: string): SceneManifest | null {
  try {
    return parseManifest(readFileSync(path, 'utf8'))
  } catch (error) {
    // A schemaVersion mismatch is LOUD but self-healing: warn, treat the
    // scene as needing a sync, and the resync rewrites at the current
    // version. Silence here once meant blind-cast misreads.
    if (error instanceof Error && error.message.includes('schemaVersion')) {
      console.warn(`! ${path}: ${error.message}`)
      return null
    }
    return null
  }
}

/** Every compiler-owned sidecar referenced by the manifest must still exist
 * before an unchanged scene can be skipped. Checking only the GLB/module left
 * deleted state or light-group atlases permanently "up to date". */
function publishedArtifactsPresent(manifest: SceneManifest, scene: ResolvedScene): boolean {
  if (!existsSync(scene.glbPath) || artifactHashOf(scene.glbPath) !== manifest.hash) return false
  if (!existsSync(scene.modulePath) || !manifest.generatedModuleHash
      || artifactHashOf(scene.modulePath) !== manifest.generatedModuleHash) return false
  // Website setup imports this module for every presentation. Its generated
  // implementation reads the descriptor at runtime, so it is a no-op for a
  // Realtime scene and automatically becomes useful if the artist later adds
  // baked states. A pre-contract build missing it must self-heal, not skip.
  if (!existsSync(bakedRecipePath(scene.modulePath))) return false
  // The graph is the complete compiler-owned browser request closure. Refuse
  // the unchanged fast path when it predates that contract or when any
  // companion named by it has disappeared or changed.
  if (!manifest.runtimeAssetGraph) return false
  const publicationProblem = sceneRuntimePublicationProblem(
    manifest.runtimeAssetPublication,
    manifest.runtimeAssetGraph,
  )
  if (
    (manifest.runtimeAssetPublication && publicationProblem !== null)
    || (!scene.external && !manifest.runtimeAssetPublication)
  ) return false
  const runtimeDirectory = manifest.runtimeAssetPublication
    ? sceneRuntimePublicationDirectory(
        dirname(scene.glbPath),
        manifest.runtimeAssetPublication,
      )
    : dirname(scene.glbPath)
  const expectedScenePath = manifest.runtimeAssetPublication?.scenePath
    ?? sceneAssetGraphPath(dirname(scene.glbPath), scene.glbPath)
  if (sceneAssetGraphIntegrityProblem(runtimeDirectory, manifest.runtimeAssetGraph, {
    requiresKtx2: ktx2RuntimeAssetsRequired(manifest),
    expectedScenePath,
  }) !== null) return false
  if (
    manifest.runtimeAssetPublication
    && sceneAssetGraphIntegrityProblem(
      dirname(scene.glbPath),
      manifest.runtimeAssetGraph,
      {
        requiresKtx2: ktx2RuntimeAssetsRequired(manifest),
        expectedScenePath: sceneAssetGraphPath(
          dirname(scene.glbPath),
          scene.glbPath,
        ),
      },
    ) !== null
  ) return false
  if (ktx2RuntimeAssetsRequired(manifest)
      && (
        ktx2TranscoderIntegrityProblem(runtimeDirectory) !== null
        || (
          manifest.runtimeAssetPublication
          && ktx2TranscoderIntegrityProblem(dirname(scene.glbPath)) !== null
        )
      )) return false
  const present = (url: string | undefined, expectedHash?: string): boolean => {
    if (!url) return true
    const path = publishedAssetPath(scene, url, manifest)
    if (!path) return false
    return existsSync(path) && !!expectedHash && artifactHashOf(path) === expectedHash
  }

  if (!present(manifest.environment?.url, manifest.environment?.hash)
      || !present(manifest.environment?.optimized?.url, manifest.environment?.optimized?.hash)) {
    return false
  }
  if (Object.values(manifest.reflectionProbeAssets ?? {}).some(
    (asset) => !present(asset.url, asset.hash),
  )) return false
  if (Object.values(manifest.textureVariants ?? {}).some((variants) =>
    variants.some((variant) => !present(variant.url, variant.hash)),
  )) return false
  for (const [name, state] of Object.entries(manifest.states ?? {})) {
    if (!present(state.url, manifest.bakeArtifactHashes?.states[name]?.main)) return false
    if (Object.entries(state.atlases ?? {}).some(
      ([atlas, url]) => !present(url, manifest.bakeArtifactHashes?.states[name]?.[atlas]),
    )) return false
  }
  for (const [name, lightGroup] of Object.entries(manifest.lightGroups ?? {})) {
    if (!present(lightGroup.url, manifest.bakeArtifactHashes?.lightGroups[name]?.main)) return false
    if (Object.entries(lightGroup.atlases ?? {}).some(
      ([atlas, layer]) => !present(layer.url, manifest.bakeArtifactHashes?.lightGroups[name]?.[atlas]),
    )) return false
  }
  return true
}

/**
 * Map one addressed runtime artifact back to the pre-1.0 stable mirror.
 *
 * The stable file is never publication authority: generated consumers keep
 * pointing at the immutable graph. It is only a recovery cache after the
 * complete graph directory has been removed as instructed. Python receives
 * the manifest's bake fingerprints and artifact hashes and refuses stale
 * bytes, so an intact independent atlas can still avoid a costly Cycles job.
 */
function stableCompatibilityBakeCachePath(
  existing: SceneManifest,
  scene: ResolvedScene,
  addressedPath: string,
): string | undefined {
  if (!existing.runtimeAssetPublication || !existing.runtimeAssetGraph) return undefined
  try {
    const publishDirectory = dirname(scene.glbPath)
    const runtimeDirectory = sceneRuntimePublicationDirectory(
      publishDirectory,
      existing.runtimeAssetPublication,
    )
    const graphPath = sceneAssetGraphPath(runtimeDirectory, addressedPath)
    if (!existing.runtimeAssetGraph.entries.some((entry) => entry.path === graphPath)) {
      return undefined
    }
    const candidate = resolve(publishDirectory, ...graphPath.split('/'))
    if (sceneAssetGraphPath(publishDirectory, candidate) !== graphPath || !existsSync(candidate)) {
      return undefined
    }
    const status = lstatSync(candidate)
    return status.isFile() && !status.isSymbolicLink() ? candidate : undefined
  } catch {
    return undefined
  }
}

/** Resolve published manifest URLs back to an incremental bake input.
 * Prefer the immutable addressed graph. If its complete directory was
 * deliberately removed for repair, a safe stable-mirror path may seed the
 * same fingerprint/hash validation. Missing files are omitted so Python marks
 * only their independent atlas jobs dirty. */
function incrementalBakeCache(
  existing: SceneManifest | null,
  scene: ResolvedScene,
): IncrementalBakeCache | undefined {
  if (!existing?.bakeFingerprints || existing.bakeFingerprints.version !== 1) return undefined
  if (!existing.bakeArtifactHashes || existing.bakeArtifactHashes.version !== 1) return undefined
  const artifactPath = (url: string): string | undefined => {
    const path = publishedAssetPath(scene, url, existing)
    if (!path) return undefined
    return existsSync(path)
      ? path
      : stableCompatibilityBakeCachePath(existing, scene, path)
  }
  const deliveryVariants = (sourceUrl: string): NonNullable<IncrementalBakeCache['stateVariants']>[string][string] =>
    (existing.textureVariants?.[sourceUrl] ?? [])
      .filter((variant) => variant.format === 'png')
      .flatMap((variant) => {
        const path = artifactPath(variant.url)
        return path ? [{ ...variant, path }] : []
      })
  const states: IncrementalBakeCache['states'] = {}
  const stateVariants: IncrementalBakeCache['stateVariants'] = {}
  for (const [state, entry] of Object.entries(existing.states ?? {})) {
    if (entry.url) {
      const path = artifactPath(entry.url)
      if (path) states[state] = { main: path }
      ;(stateVariants[state] ??= {}).main = deliveryVariants(entry.url)
    }
    for (const [atlas, url] of Object.entries(entry.atlases ?? {})) {
      const path = artifactPath(url)
      if (path) (states[state] ??= {})[atlas] = path
      ;(stateVariants[state] ??= {})[atlas] = deliveryVariants(url)
    }
  }
  const lightGroups: IncrementalBakeCache['lightGroups'] = {}
  const lightGroupVariants: IncrementalBakeCache['lightGroupVariants'] = {}
  for (const [light, entry] of Object.entries(existing.lightGroups ?? {})) {
    if (entry.url) {
      const path = artifactPath(entry.url)
      if (path) {
        lightGroups[light] = {
          main: { path, maxValue: entry.maxValue ?? 1 },
        }
      }
      ;(lightGroupVariants[light] ??= {}).main = deliveryVariants(entry.url)
    }
    for (const [atlas, layer] of Object.entries(entry.atlases ?? {})) {
      const path = artifactPath(layer.url)
      if (path) {
        (lightGroups[light] ??= {})[atlas] = { path, maxValue: layer.maxValue }
      }
      ;(lightGroupVariants[light] ??= {})[atlas] = deliveryVariants(layer.url)
    }
  }
  return {
    fingerprints: existing.bakeFingerprints,
    artifacts: existing.bakeArtifactHashes,
    states,
    stateScales: existing.stateScales ?? {},
    lightGroups,
    stateVariants,
    lightGroupVariants,
  }
}

export interface SyncSceneOptions {
  force?: boolean
  draft?: boolean
  authoringPreview?: boolean
  allowNewerFile?: boolean
  /** Cancels waiting for another publisher. Once compilation starts, each
   * compiler stage retains its own truthful cancellation contract. */
  signal?: AbortSignal
}

export async function syncScene(
  scene: ResolvedScene,
  blender: BlenderInstall,
  options: SyncSceneOptions = {},
): Promise<SyncOutcome> {
  const roots = publicationRootsForScene(scene)
  const intent = scene.external
    ? 'external-build'
    : options.draft
      ? 'preview'
      : 'final'
  return withPublicationScopes({
    roots: [roots.assetRoot, roots.generatedRoot],
    intent,
    label: `${scene.name} / ${
      scene.external ? 'External build' : options.draft ? 'Preview' : 'Final'
    }`,
    signal: options.signal,
    onWait(fact) {
      emitProgress(0, fact.message)
    },
  }, (lease) => syncSceneWithPublicationLease(scene, blender, options, lease))
}

async function syncSceneWithPublicationLease(
  scene: ResolvedScene,
  blender: BlenderInstall,
  options: SyncSceneOptions,
  lease: PublicationScopesLease,
): Promise<SyncOutcome> {
  const started = Date.now()
  assertConfigSourceRevisionCurrent(scene.configSource)
  if (scene.external) {
    return syncExternalScene(
      scene,
      options,
      lease.delegationEnvironment,
    )
  }
  const qualitySettings = options.draft ? draftSettings(scene) : scene.settings
  const settings = options.authoringPreview
    ? { ...qualitySettings, authoringPreview: true as const }
    : qualitySettings
  const finalHash = sourceHash(scene, scene.settings, blender.version)
  const hash = sourceHash(scene, settings, blender.version)
  const blendBytesHashAtStart = createHash('sha256')
    .update(readFileSync(scene.blendPath))
    .digest('hex')
    .slice(0, 16)
  const existing = readManifest(scene.manifestPath)
  const recipeWarning = bakedRecipeMigrationWarning(bakedRecipePath(scene.modulePath), scene.name)
  assertLightingRecipeCurrent(existing, bakedRecipePath(scene.modulePath), scene.name)
  const publishedSetIsComplete = existing !== null &&
    externalDependenciesCurrent(existing, scene) &&
    publishedArtifactsPresent(existing, scene) &&
    existsSync(scene.glbPath) &&
    existsSync(scene.modulePath)
  const sameRevisionFinalIsCurrent = existing !== null &&
    publishedSetIsComplete &&
    existing.sourceHash === finalHash &&
    existing.draft !== true
  if (options.draft && !options.authoringPreview && sameRevisionFinalIsCurrent) {
    return {
      scene: scene.name,
      action: 'skipped',
      durationMs: Date.now() - started,
      warnings: [
        `retained the verified Final publication for ${scene.name}; the queued Preview ` +
          'belongs to the same source revision and cannot downgrade deployable bytes',
        ...(recipeWarning ? [recipeWarning] : []),
      ],
    }
  }
  const otherwiseCurrent = existing !== null &&
    existing.sourceHash === hash &&
    publishedSetIsComplete
  const forcedPreviousRuntimeAssetGraph = options.force && otherwiseCurrent
    ? existing?.runtimeAssetGraph
    : undefined
  if (!options.force && otherwiseCurrent) {
    if (existing && !existing.syncHint) {
      existing.syncHint = DEFAULT_SYNC_HINT
      writeFileSync(scene.manifestPath, JSON.stringify(existing, null, 2) + '\n')
    }
    return {
      scene: scene.name,
      action: 'skipped',
      durationMs: Date.now() - started,
      warnings: recipeWarning ? [recipeWarning] : [],
    }
  }

  const publishDirectory = resolve(dirname(scene.glbPath))
  mkdirSync(publishDirectory, { recursive: true })
  const stageDirectory = mkdtempSync(join(publishDirectory, '.blendlink-stage-'))
  const buildGlbPath = join(stageDirectory, basename(scene.glbPath))
  try {
  emitProgress(0.05, `exporting ${scene.name} with Blender`)
  // Scene-owned recipes resolve presentation mode inside Blender, so the
  // external config may still say "standard" for a baked/hybrid scene.
  // Presence of prior bake fingerprints is the authoritative cache signal;
  // realtime exports simply ignore the additive incremental payload.
  const incremental = incrementalBakeCache(existing, scene)
  const exportSettings: ExportSettings = incremental
    ? { ...settings, incremental }
    : settings
  const exported = await exportBlend({
    blendPath: scene.blendPath,
    outPath: buildGlbPath,
    settings: exportSettings,
    blender,
    ...(options.allowNewerFile ? { allowNewerFile: true } : {}),
  })
  // Reuse the exact diagnostics produced with this staged candidate. A
  // separate plan-only Blender pass would double evaluation cost and could
  // inspect a different saved revision. Realtime material loss must fail
  // before optimization or publication, while an explicit application
  // adapter retains the same visible acknowledgement as `blendlink plan`.
  const realtimeMaterialWarnings = enforceRealtimeMaterialPublication(
    scene,
    exported.sidecar.diagnostics,
    exported.plan,
  )
  let sceneRecipe: SceneRecipe | null = null
  if (exported.recipe) {
    const parsed = parseSceneRecipe(exported.recipe)
    if (!parsed.recipe) {
      throw new Error(
        'The Blendlink Web Presentation stored in the .blend is invalid:\n  - ' +
        parsed.diagnostics.map((entry) => `${entry.path}: ${entry.message}`).join('\n  - '),
      )
    }
    sceneRecipe = parsed.recipe
  }
  let textureTransforms: SceneManifest['textureTransforms']
  let textureCompression: SceneManifest['textureCompression']
  let rawAtlasDelivery: SceneManifest['atlasDelivery']
  let rawTextureVariants: ReadonlyMap<string, import('./atlasDelivery.js').TextureDeliveryVariant[]> = new Map()
  const textureWarnings: string[] = []
  let optimizedEnvironment: NonNullable<SceneManifest['environment']>['optimized']
  const protectedTextureNames = [
    ...Object.values(exported.bakedStates).flatMap((groups) => Object.values(groups)),
    ...Object.values(exported.bakedLightGroups).flatMap((groups) =>
      Object.values(groups).map((entry) => entry.path),
    ),
  ]
  if (protectedTextureNames.length > 0) {
    emitProgress(0.72, 'publishing resolution-aware, exact lossless atlas delivery variants')
    const {
      compileAtlasSidecarDelivery,
      convertEmbeddedBakedAtlasesToWebp,
      mergeAtlasDeliveryReports,
    } = await import('./atlasDelivery.js')
    const sourceVariants = new Map<string, import('./invoke.js').BakedTextureVariant[]>()
    for (const [state, groups] of Object.entries(exported.bakedStates)) {
      for (const [group, source] of Object.entries(groups)) {
        sourceVariants.set(source, exported.bakedVariants.states[state]?.[group] ?? [])
      }
    }
    for (const [light, groups] of Object.entries(exported.bakedLightGroups)) {
      for (const [group, layer] of Object.entries(groups)) {
        sourceVariants.set(layer.path, exported.bakedVariants.lightGroups[light]?.[group] ?? [])
      }
    }
    const deliverySourcePaths = [
      ...protectedTextureNames,
      ...[...sourceVariants.values()].flatMap((variants) => variants.map((variant) => variant.path)),
    ]
    const sidecars = await compileAtlasSidecarDelivery(deliverySourcePaths)
    const embedded = await convertEmbeddedBakedAtlasesToWebp(
      buildGlbPath,
      deliverySourcePaths,
    )
    const compiledVariants = new Map<string, import('./atlasDelivery.js').TextureDeliveryVariant[]>()
    for (const source of protectedTextureNames) {
      const variants: import('./atlasDelivery.js').TextureDeliveryVariant[] = []
      for (const tier of [...(sourceVariants.get(source) ?? [])].sort((a, b) => a.width - b.width)) {
        const webp = sidecars.variants.get(tier.path)
        if (webp) variants.push(webp)
        variants.push({
          url: tier.path,
          format: 'png',
          width: tier.width,
          height: tier.height,
          bytes: tier.bytes,
          hash: tier.hash,
          lossless: true,
        })
      }
      const fullWebp = sidecars.variants.get(source)
      if (fullWebp) variants.push(fullWebp)
      if (variants.length > 0) compiledVariants.set(source, variants)
    }
    rawTextureVariants = compiledVariants
    rawAtlasDelivery = mergeAtlasDeliveryReports(sidecars.report, embedded) ?? undefined
  }
  const texturePolicies = (exported.sidecar.textures ?? [])
    .filter((texture) => texture.maxSize !== undefined)
    .map((texture) => ({ name: texture.name, maxSize: texture.maxSize! }))
  if (texturePolicies.length > 0) {
    emitProgress(0.74, `enforcing ${texturePolicies.length} texture size limit(s)`)
    const { resizeTextures } = await import('./optimizer.js')
    const resized = await resizeTextures(buildGlbPath, texturePolicies)
    textureTransforms = resized.transforms
    textureWarnings.push(...resized.warnings)
  }
  const textureCompressionPolicies = (exported.sidecar.textures ?? [])
    .filter((texture) => texture.compression !== undefined)
    .map((texture) => ({ name: texture.name, override: texture.compression! }))
  if (sceneRecipe?.optimization.textures === 'ktx2' || textureCompressionPolicies.some((policy) => policy.override !== 'none')) {
    emitProgress(0.77, `compressing realtime material textures for the GPU`)
    const { compressTexturesKtx2 } = await import('./textureCompression.js')
    const compressed = await compressTexturesKtx2(buildGlbPath, {
      sceneKtx2: sceneRecipe?.optimization.textures === 'ktx2',
      policies: textureCompressionPolicies,
      protectedTextureNames,
      ...(exported.sidecar.diagnostics?.materialCompilation
        ? { materialCompilation: exported.sidecar.diagnostics.materialCompilation }
        : {}),
    })
    textureCompression = compressed.report ?? undefined
    textureWarnings.push(...compressed.warnings)
  }
  if (exported.environment && sceneRecipe?.optimization.textures === 'ktx2') {
    emitProgress(0.775, 'compressing the HDR environment with a verified raw fallback')
    const { compressEnvironmentKtx2 } = await import('./environmentCompression.js')
    const outputPath = exported.environment.path.replace(/\.(?:hdr|exr)$/i, '.ktx2')
    const compressed = await compressEnvironmentKtx2(exported.environment.path, outputPath, {
      blenderExecutable: blender.executable,
    })
    textureWarnings.push(...compressed.warnings)
    if (compressed.asset) {
      const { path, ...asset } = compressed.asset
      optimizedEnvironment = { ...asset, url: path }
    }
  }
  let optimizationReport: SceneManifest['optimization']
  if (sceneRecipe?.optimization.geometry === 'meshopt') {
    emitProgress(0.78, `optimizing ${scene.name} geometry with Meshopt`)
    const { optimizeMeshopt } = await import('./optimizer.js')
    optimizationReport = await optimizeMeshopt(buildGlbPath)
  }

  const declaredStagePaths = new Set<string>([resolve(buildGlbPath)])
  const toUrl = (path: string) => {
    const graphPath = sceneAssetGraphPath(stageDirectory, path)
    declaredStagePaths.add(resolve(path))
    const slash = scene.url.lastIndexOf('/')
    return `${slash >= 0 ? scene.url.slice(0, slash + 1) : ''}${graphPath}`
  }
  const textureVariants: NonNullable<SceneManifest['textureVariants']> = Object.fromEntries(
    [...rawTextureVariants.entries()].map(([source, variants]) => [
      toUrl(source),
      variants.map((variant) => ({ ...variant, url: toUrl(variant.url) })),
    ]),
  )
  const atlasDelivery: SceneManifest['atlasDelivery'] = rawAtlasDelivery
    ? {
        ...rawAtlasDelivery,
        entries: rawAtlasDelivery.entries.map((entry) => entry.embedded
          ? entry
          : {
              ...entry,
              source: toUrl(entry.source),
              variant: { ...entry.variant, url: toUrl(entry.variant.url) },
            }),
      }
    : undefined
  const environment = exported.environment
    ? {
        url: toUrl(exported.environment.path),
        sourceName: exported.environment.sourceName,
        format: exported.environment.format,
        bytes: exported.environment.bytes,
        hash: exported.environment.hash,
        source: exported.environment.source,
        ...(optimizedEnvironment
          ? { optimized: { ...optimizedEnvironment, url: toUrl(optimizedEnvironment.url) } }
          : {}),
      }
    : undefined
  const materialPrograms = exported.materialPrograms
    ? {
        url: toUrl(exported.materialPrograms.path),
        bytes: exported.materialPrograms.bytes,
        hash: exported.materialPrograms.hash,
        materials: exported.materialPrograms.materials,
      }
    : undefined
  const reflectionProbeAssets: NonNullable<SceneManifest['reflectionProbeAssets']> =
    Object.fromEntries(Object.entries(exported.reflectionProbeAssets ?? {}).map(([id, asset]) => {
      const { path, ...published } = asset
      return [id, { ...published, url: toUrl(path) }]
    }))
  // Single-atlas scenes keep the flat {url} shape; multi-atlas scenes carry
  // an additive `atlases` map (group → url). The first state is baked into
  // the GLB's materials — marked so a runtime never infers from key order.
  const states: NonNullable<SceneManifest['states']> = {}
  for (const [index, [state, byGroup]] of Object.entries(exported.bakedStates).entries()) {
    const groups = Object.keys(byGroup)
    const flat = groups.length === 1 && groups[0] === 'main'
    states[state] = {
      ...(flat
        ? { url: toUrl(byGroup['main']!) }
        : {
            atlases: Object.fromEntries(
              groups.map((group) => [group, toUrl(byGroup[group]!)]),
            ),
          }),
      ...(index === 0 ? { default: true as const } : {}),
    }
  }
  const lightGroups: NonNullable<SceneManifest['lightGroups']> = {}
  for (const [light, byGroup] of Object.entries(exported.bakedLightGroups)) {
    const groups = Object.keys(byGroup)
    const flat = groups.length === 1 && groups[0] === 'main'
    lightGroups[light] = flat
      ? { url: toUrl(byGroup['main']!.path), maxValue: byGroup['main']!.maxValue }
      : {
          atlases: Object.fromEntries(
            groups.map((group) => [
              group,
              { url: toUrl(byGroup[group]!.path), maxValue: byGroup[group]!.maxValue },
            ]),
          ),
        }
  }
  emitProgress(0.85, `generating types for ${scene.name}`)
  const typegenOptions = {
    glbPath: buildGlbPath,
    url: scene.url,
    exportName: scene.name,
    sourceBlend: scene.blendPath,
    provenanceRoot: scene.root,
    sourceHash: hash,
    ...(scene.configSource
      ? { configSourceHash: scene.configSource.hash }
      : {}),
    sidecar: exported.sidecar,
    ...(exported.lightContract
      ? { rectAreaLightContract: exported.lightContract.rectAreaLights ?? [] }
      : {}),
    excluded: exported.excluded,
    ...(sceneRecipe ? { recipe: sceneRecipe } : {}),
    ...(optimizationReport ? { optimization: optimizationReport } : {}),
    ...(textureCompression ? { textureCompression } : {}),
    ...(atlasDelivery ? { atlasDelivery } : {}),
    ...(Object.keys(textureVariants).length > 0 ? { textureVariants } : {}),
    ...(textureTransforms?.length ? { textureTransforms } : {}),
    ...(Object.keys(states).length > 0 ? { states } : {}),
    ...(Object.keys(exported.bakeOutputs ?? {}).length > 0
      ? { bakeOutputs: exported.bakeOutputs! }
      : {}),
    ...(Object.keys(exported.materialAtlases ?? {}).length > 0
      ? { materialAtlases: exported.materialAtlases! }
      : {}),
    ...(Object.keys(exported.bakedStateScales ?? {}).length > 0
      ? { stateScales: exported.bakedStateScales! }
      : {}),
    ...(Object.keys(exported.bakedStateVisibility).length > 0
      ? { stateVisibility: exported.bakedStateVisibility }
      : {}),
    ...(Object.keys(lightGroups).length > 0 ? { lightGroups } : {}),
    ...(exported.bakeFingerprints ? { bakeFingerprints: exported.bakeFingerprints } : {}),
    ...(exported.bakeArtifactHashes ? { bakeArtifactHashes: exported.bakeArtifactHashes } : {}),
    ...(exported.incrementalBake ? { incrementalBake: exported.incrementalBake } : {}),
    ...(environment ? { environment } : {}),
    ...(materialPrograms ? { materialPrograms } : {}),
    ...(Object.keys(reflectionProbeAssets).length > 0
      ? { reflectionProbeAssets }
      : {}),
    ...(exported.plan ? { bakePlan: exported.plan } : {}),
  } satisfies Parameters<typeof generateSceneModule>[0]
  let { manifest, module, localProvenance } = await generateSceneModule(typegenOptions)
  if (ktx2RuntimeAssetsRequired(manifest)) {
    for (const candidate of ktx2TranscoderPublishCandidates(stageDirectory)) {
      mkdirSync(dirname(candidate.finalPath), { recursive: true })
      const content = 'sourcePath' in candidate
        ? readFileSync(candidate.sourcePath)
        : candidate.content
      writeFileSync(candidate.finalPath, content)
      declaredStagePaths.add(resolve(candidate.finalPath))
    }
  }
  const runtimeCandidates: PublishCandidate[] = inspectCompilerStagingDirectory(
    stageDirectory,
    [...declaredStagePaths],
  ).map((asset) => ({
    sourcePath: asset.sourcePath,
    finalPath: join(publishDirectory, ...asset.path.split('/')),
  }))
  if (!runtimeCandidates.some((candidate) => resolve(candidate.finalPath) === resolve(scene.glbPath))) {
    throw new Error(`Compiler staging did not produce the declared GLB ${basename(scene.glbPath)}`)
  }
  const runtimeAssetGraph = createSceneAssetGraph(runtimeCandidates.map((candidate) => {
    const path = sceneAssetGraphPath(publishDirectory, candidate.finalPath)
    const content = 'sourcePath' in candidate ? readFileSync(candidate.sourcePath) : candidate.content
    return {
      path,
      role: resolve(candidate.finalPath) === resolve(scene.glbPath)
        ? 'scene' as const
        : path.startsWith(`${KTX2_TRANSCODER_DIRECTORY}/`)
          ? 'basis-runtime' as const
          : 'companion' as const,
      bytes: typeof content === 'string' ? new TextEncoder().encode(content) : content,
    }
  }), { requiresKtx2: ktx2RuntimeAssetsRequired(manifest) })
  const runtimeAssetPublication = sceneRuntimePublicationForGraph(
    scene.name,
    runtimeAssetGraph,
  )
  const addressedFields = addressedTypegenAssetFields(
    scene,
    runtimeAssetPublication,
    {
      ...(atlasDelivery ? { atlasDelivery } : {}),
      ...(Object.keys(textureVariants).length > 0 ? { textureVariants } : {}),
      ...(environment ? { environment } : {}),
      ...(materialPrograms ? { materialPrograms } : {}),
      ...(Object.keys(reflectionProbeAssets).length > 0
        ? { reflectionProbeAssets }
        : {}),
      ...(Object.keys(states).length > 0 ? { states } : {}),
      ...(Object.keys(lightGroups).length > 0 ? { lightGroups } : {}),
    },
  )
  ;({ manifest, module, localProvenance } = await generateSceneModule({
    ...typegenOptions,
    ...addressedFields,
    url: sceneRuntimePublicationUrl(
      scene.url,
      runtimeAssetPublication,
      runtimeAssetPublication.scenePath,
    ),
    runtimeAssetGraph,
  }))
  manifest.runtimeAssetPublication = runtimeAssetPublication
  // Audit the exact, fully transformed staged GLB before any generated file
  // can replace the website's last known-good artifact set. Blender source
  // scope is insufficient here: modifiers, collection selection, and later
  // optimizers can all turn an apparently non-empty .blend into an empty
  // default glTF scene. Plan-only inspection intentionally never reaches this
  // publication gate, so helper and asset-library files remain inspectable.
  await auditCompiledSceneArtifact({
    manifest,
    glbBytes: readFileSync(buildGlbPath),
  })
  const sealed = sealScenePublication({
    sourceDirectory: stageDirectory,
    destinationParent: join(publishDirectory, scene.name),
    graph: runtimeAssetGraph,
    requiresKtx2: ktx2RuntimeAssetsRequired(manifest),
  })
  const sealedPublication = createSceneRuntimePublication(scene.name, sealed)
  if (
    JSON.stringify(sealedPublication)
    !== JSON.stringify(runtimeAssetPublication)
  ) {
    throw new Error(
      `Sealed runtime publication for ${scene.name} does not match the compiled activation pointer.`,
    )
  }
  // Stamp the exact revision that produced this candidate. Reading the artist
  // file again here could bless an older export with a newer source hash when
  // Blender saves while compilation is in progress.
  manifest.blendBytesHash = blendBytesHashAtStart
  manifest.syncHint = DEFAULT_SYNC_HINT
  manifest.lastSyncDurationMs = Date.now() - started
  if (sceneRecipe) {
    manifest.recipe = sceneRecipe
    manifest.presentation = sceneRecipe.presentation
  }
  if (options.draft) {
    manifest.draft = true
  }
  const candidates: PublishCandidate[] = [...runtimeCandidates]
  candidates.push(
    { finalPath: scene.manifestPath, content: JSON.stringify(manifest, null, 2) + '\n' },
    { finalPath: scene.modulePath, content: module },
  )
  // Every generated consumer can import one stable composition seam. The
  // recipe is fully descriptor-driven and harmless for Realtime scenes, then
  // remains user-owned (shadcn model) after its first publication.
  const recipePath = bakedRecipePath(scene.modulePath)
  assertLightingRecipeCurrent(manifest, recipePath, scene.name)
  if (!existsSync(recipePath)) {
    const { renderBakedRecipe } = await import('./bakedRecipe.js')
    candidates.push({ finalPath: recipePath, content: renderBakedRecipe(scene.name) })
  }
  const currentSourceHash = sourceHash(scene, settings, blender.version)
  if (currentSourceHash !== hash) {
    throw new Error(
      `Blendlink refused to publish ${scene.name} because its source or declared compiler input ` +
        'changed while the scene was compiling. The completed candidate belongs to an older ' +
        'revision and was discarded; save-driven Preview will compile the newest revision, or ' +
        'rerun the command.',
    )
  }
  assertConfigSourceRevisionCurrent(scene.configSource)
  writeLocalPathProvenance(localProvenance)
  commitPublishedFiles(candidates, `${process.pid}-${Date.now()}`)
  emitProgress(1, `${scene.name} up to date`)

  const warnings = [
    ...realtimeMaterialWarnings,
    ...exported.warnings,
    ...textureWarnings,
    ...manifest.vocabulary.warnings,
  ]
  if (forcedPreviousRuntimeAssetGraph &&
      forcedPreviousRuntimeAssetGraph.fingerprint !== runtimeAssetGraph.fingerprint) {
    const drift = diffSceneAssetGraphs(forcedPreviousRuntimeAssetGraph, runtimeAssetGraph)
    const labels = [
      ...drift.changed.map((path) => `${path} changed`),
      ...drift.added.map((path) => `${path} added`),
      ...drift.removed.map((path) => `${path} removed`),
    ]
    const preview = labels.slice(0, 8).join(', ')
    warnings.unshift(
      'Forced rebuild changed exact runtime bytes despite unchanged declared inputs ' +
        `(${forcedPreviousRuntimeAssetGraph.fingerprint.slice(0, 12)} -> ` +
        `${runtimeAssetGraph.fingerprint.slice(0, 12)}; ${preview}` +
        `${labels.length > 8 ? `, +${labels.length - 8} more` : ''}). ` +
        'The published hashes are exact, but this toolchain did not reproduce the same cache key. ' +
        'Keep one generated artifact set and use ordinary no-op compile caching unless the rebuild was intentional.',
    )
  }
  if (!sceneRecipe) {
    warnings.unshift(
      'No Blendlink scene recipe is saved in this .blend. The generated starter can only use a ' +
        'diagnostic fallback camera/look, which may frame the wrong subject. In Blender, run Set Up ' +
        'Blendlink Scene, choose the Website Camera and rendering ownership, save, then rebuild.',
    )
  }
  // The public manifest deliberately replaces outside-project locations with
  // opaque keys. This compile still owns Blender's exact in-memory sidecar, so
  // keep immediate artist diagnostics readable without committing those paths.
  warnings.unshift(...externalDependencyWarnings(exported.sidecar.externalDependencies ?? []))
  const recipeMigrationWarning = bakedRecipeMigrationWarning(recipePath, scene.name)
  if (recipeMigrationWarning) warnings.push(recipeMigrationWarning)
  if (exported.excluded.length > 0) {
    warnings.push(`excluded by -noimp: ${exported.excluded.join(', ')}`)
  }
  if (manifest.draft) {
    warnings.push('preview-quality bake — run `blendlink compile` before committing')
  }
  if (exported.incrementalBake) {
    const result = exported.incrementalBake
    warnings.push(
      result.totalJobs === 0
        ? 'bake dependency graph had no populated atlas jobs'
        : `bake dependency graph: reused ${result.reusedJobs}/${result.totalJobs} atlas jobs; ` +
          `rebuilt ${result.rebuiltJobs}`,
    )
  }
  if (optimizationReport && optimizationReport.savedBytes < 0) {
    warnings.push(
      `Meshopt increased this small GLB by ${Math.abs(optimizationReport.savedBytes)} bytes; ` +
        'set Geometry Compression to Off unless faster decode/upload is still valuable.',
    )
  }
  if (textureCompression && textureCompression.savedBytes < 0) {
    warnings.push(
      `KTX2 increased embedded texture bytes by ${Math.abs(textureCompression.savedBytes)} bytes; ` +
        'GPU memory/upload savings may still justify it, or set GPU Textures to Original.',
    )
  }
  if (atlasDelivery && atlasDelivery.savedBytes > 0) {
    warnings.push(
      `lossless WebP atlas delivery saves ${(atlasDelivery.savedBytes / 1024 / 1024).toFixed(2)} MB ` +
        'with decoded-byte verification; canonical PNG sidecars remain available as fallbacks',
    )
  }
  return {
    scene: scene.name,
    action: 'exported',
    durationMs: Date.now() - started,
    stats: manifest.stats,
    ...(vocabularySummary(manifest) ? { vocabulary: vocabularySummary(manifest) } : {}),
    warnings,
  }
  } finally {
    const resolvedStage = resolve(stageDirectory)
    if (dirname(resolvedStage) !== publishDirectory || !basename(resolvedStage).startsWith('.blendlink-stage-')) {
      throw new Error(`Refusing to clean an unexpected compiler staging path: ${resolvedStage}`)
    }
    rmSync(resolvedStage, { recursive: true, force: true })
  }
}

export async function syncAll(
  config: ResolvedConfig,
  options: {
    force?: boolean
    only?: string
    draft?: boolean
    authoringPreview?: boolean
    allowNewerFile?: boolean
  } = {},
): Promise<SyncOutcome[]> {
  const scenes = options.only
    ? config.scenes.filter((scene) => scene.name === options.only)
    : config.scenes
  if (options.only && scenes.length === 0) {
    throw new Error(`No scene named "${options.only}" in blendlink.config.`)
  }
  const needsBlender = scenes.some((scene) => !scene.external)
  const blender = needsBlender
    ? await discoverBlender(config.blenderPath)
    : ({ version: 'none', executable: '' } as BlenderInstall)
  const outcomes: SyncOutcome[] = []
  for (const scene of scenes) {
    outcomes.push(await syncScene(scene, blender, options))
  }
  return outcomes
}

export interface VerifyIssue {
  scene: string
  problem: string
  fix: string
  /** Warnings are explicit accepted-risk evidence and do not block publish. */
  severity?: 'error' | 'warning'
}

export function isBlockingVerifyIssue(issue: VerifyIssue): boolean {
  return issue.severity !== 'warning'
}

export function materialCollapseVerificationIssue(
  scene: Pick<ResolvedScene, 'name' | 'applicationMaterialAdapter'>,
  audit: Pick<CompiledSceneAudit, 'materialPayloadCollapse' | 'materialPortability'>,
): VerifyIssue | null {
  const collapse = audit.materialPayloadCollapse
  if (!collapse.detected) return null
  const family = collapse.families[0]
  const share = collapse.totalRenderedTriangles > 0
    ? collapse.dominantAffectedTriangles / collapse.totalRenderedTriangles * 100
    : 0
  const cyclesBlocked = audit.materialPortability.cyclesAppearanceBlockedUsedMaterials
  const problem =
    `material appearance collapsed: all ${collapse.affectedTriangles.toLocaleString('en-US')} ` +
    'rendered triangles use Needs Bake materials but the GLB contains no meaningful ' +
    'PBR, texture, emissive, unlit, or material-extension payload. ' +
    `The dominant repeated graph family affects ${share.toFixed(1)}% ` +
    `(${family?.materials.slice(0, 3).join(', ') || 'unnamed materials'}).`
  const adapter = scene.applicationMaterialAdapter
  if (adapter?.acknowledgePayloadCollapse === true) {
    return {
      scene: scene.name,
      severity: 'warning',
      problem:
        `${problem} Accepted by the explicit website-owned material adapter: ` +
        adapter.description,
      fix:
        'Keep the adapter covered by the application browser gate and remove this acknowledgement ' +
        'when the GLB begins carrying the intended material payload.',
    }
  }
  return {
    scene: scene.name,
    severity: 'error',
    problem,
    fix: cyclesBlocked > 0
      ? `${cyclesBlocked} used material(s) are blocked from the current Cycles Appearance bake. ` +
        'Simplify to portable Principled inputs or use a proven EEVEE materialization route. ' +
        'If website code intentionally supplies every material, declare a named ' +
        'applicationMaterialAdapter acknowledgement and prove it in the application browser gate.'
      : 'Choose a proven Appearance bake/materialization route or simplify to portable Principled inputs. ' +
        'If website code intentionally supplies every material, declare a named ' +
        'applicationMaterialAdapter acknowledgement and prove it in the application browser gate.',
  }
}

/** Blender-free drift check for CI: sources vs committed artifacts. */
export async function verifyAll(
  config: ResolvedConfig,
  options: { only?: string; signal?: AbortSignal } = {},
): Promise<VerifyIssue[]> {
  const scenes = options.only
    ? config.scenes.filter((scene) => scene.name === options.only)
    : config.scenes
  if (options.only && scenes.length === 0) {
    throw new Error(`No scene named "${options.only}" in blendlink.config.`)
  }
  if (scenes.length === 0) return []
  const roots = scenes.flatMap((scene) => {
    const publicationRoots = publicationRootsForScene(scene)
    return [publicationRoots.assetRoot, publicationRoots.generatedRoot]
  })
  return withPublicationScopes({
    roots,
    intent: 'verify',
    label: options.only
      ? `${options.only} / Verify`
      : `${scenes.length} scene${scenes.length === 1 ? '' : 's'} / Verify`,
    signal: options.signal,
    onWait(fact) {
      emitProgress(0, fact.message)
    },
  }, () => verifyScenesWithPublicationLease(config, scenes))
}

async function verifyScenesWithPublicationLease(
  config: ResolvedConfig,
  scenes: readonly ResolvedScene[],
): Promise<VerifyIssue[]> {
  assertConfigSourceRevisionCurrent(config.configSource)
  const issues: VerifyIssue[] = []
  for (const scene of scenes) {
    const manifest = readManifest(scene.manifestPath)
    if (!manifest) {
      issues.push({
        scene: scene.name,
        problem: `missing generated manifest (${scene.manifestPath})`,
        fix: 'Run `blendlink sync` and commit the generated files.',
      })
      continue
    }
    if (!existsSync(scene.modulePath)) {
      // A deleted gen.ts previously passed verify and failed later as an
      // unrelated-looking TS error in the app build.
      issues.push({
        scene: scene.name,
        problem: `missing generated module (${scene.modulePath})`,
        fix: 'Run `blendlink sync` and commit the generated files.',
      })
      continue
    }
    if (
      scene.configSource
      && (
        !scene.external
        || manifest.configSourceHash !== undefined
      )
      && manifest.configSourceHash !== scene.configSource.hash
    ) {
      issues.push({
        scene: scene.name,
        problem:
          'the Blendlink config revision does not match the published artifacts',
        fix:
          'Run `blendlink compile` so Final uses the current paths, quality, and integration settings.',
      })
      continue
    }
    const publicationProblem = sceneRuntimePublicationProblem(
      manifest.runtimeAssetPublication,
      manifest.runtimeAssetGraph,
    )
    if (
      (manifest.runtimeAssetPublication && publicationProblem !== null)
      || (!scene.external && !manifest.runtimeAssetPublication)
    ) {
      issues.push({
        scene: scene.name,
        problem:
          `runtime asset publication integrity failed: ${publicationProblem}`,
        fix:
          'Run `blendlink compile` and commit the complete graph-addressed scene directory with its generated module.',
      })
      continue
    }
    const runtimeDirectory = manifest.runtimeAssetPublication
      ? sceneRuntimePublicationDirectory(
          dirname(scene.glbPath),
          manifest.runtimeAssetPublication,
        )
      : dirname(scene.glbPath)
    if (manifest.runtimeAssetPublication) {
      const expectedUrl = sceneRuntimePublicationUrl(
        scene.url,
        manifest.runtimeAssetPublication,
        manifest.runtimeAssetPublication.scenePath,
      )
      if (manifest.url !== expectedUrl) {
        issues.push({
          scene: scene.name,
          problem:
            `runtime asset publication URL is ${manifest.url}; expected ${expectedUrl}`,
          fix:
            'Run `blendlink compile`; the generated descriptor must point at its exact graph directory.',
        })
        continue
      }
    }
    const recipePath = bakedRecipePath(scene.modulePath)
    if (!existsSync(recipePath)) {
      issues.push({
        scene: scene.name,
        problem: `missing generated recipe (${recipePath})`,
        fix: scene.external
          ? 'Re-run `blendlink typegen`; the recipe is written once and remains yours to edit.'
          : 'Run `blendlink sync` and commit the generated recipe.',
      })
      continue
    }
    const recipeStatus = inspectBakedRecipeTemplate(readFileSync(recipePath, 'utf8'))
    if (recipeStatus.kind !== 'current') {
      issues.push({
        scene: scene.name,
        problem: recipeStatus.kind === 'future'
          ? `generated recipe template v${recipeStatus.version} is newer than supported v${BAKED_RECIPE_TEMPLATE_VERSION}`
          : `generated recipe predates baked composition template v${BAKED_RECIPE_TEMPLATE_VERSION}`,
        fix: recipeStatus.kind === 'future'
          ? 'Install the matching newer Blendlink release; the artist-owned recipe was not changed.'
          : `Run \`blendlink recipe update ${scene.name}\`; the exact current file will be preserved at ${bakedRecipeBackupPath(recipePath, recipeStatus)}.`,
      })
      continue
    }
    if (!manifest.generatedModuleHash || artifactHashOf(scene.modulePath) !== manifest.generatedModuleHash) {
      issues.push({
        scene: scene.name,
        problem: 'generated module bytes do not match the manifest',
        fix: 'Run `blendlink sync` and commit the generated module + manifest together.',
      })
      continue
    }
    if (!externalDependenciesCurrent(manifest, scene)) {
      issues.push({
        scene: scene.name,
        problem: 'an unpacked Blender dependency changed after the last sync',
        fix: 'Run `blendlink sync`; linked images/libraries/caches are compiler inputs too.',
      })
      continue
    }
    if (ktx2RuntimeAssetsRequired(manifest)) {
      const problem = ktx2TranscoderIntegrityProblem(runtimeDirectory)
        ?? (
          manifest.runtimeAssetPublication
            ? ktx2TranscoderIntegrityProblem(dirname(scene.glbPath))
            : null
        )
      if (problem) {
        issues.push({
          scene: scene.name,
          problem: `KTX2 runtime transcoder integrity failed: ${problem}`,
          fix: scene.external
            ? 'Install the Three.js peer dependency, rerun the external build/typegen pipeline, and commit the complete blendlink-basis directory beside the GLB.'
            : 'Install the Three.js peer dependency, run `blendlink sync`, and commit the complete blendlink-basis directory beside the GLB.',
        })
        continue
      }
    }
    if (manifest.environment) {
      const environmentPath = publishedAssetPath(
        scene,
        manifest.environment.url,
        manifest,
      )
      if (!environmentPath) {
        issues.push({
          scene: scene.name,
          problem: `published HDR environment URL is outside the scene publication directory: ${manifest.environment.url}`,
          fix: 'Run `blendlink sync`; compiler-owned asset URLs must stay relative to the generated GLB.',
        })
        continue
      }
      if (!existsSync(environmentPath)) {
        issues.push({
          scene: scene.name,
          problem: `published HDR environment is missing from ${environmentPath}`,
          fix: 'Run `blendlink sync` and commit the generated environment asset.',
        })
        continue
      }
      const environmentBytes = readFileSync(environmentPath)
      const environmentHash = createHash('sha256').update(environmentBytes).digest('hex').slice(0, 16)
      if (environmentBytes.byteLength !== manifest.environment.bytes || environmentHash !== manifest.environment.hash) {
        issues.push({
          scene: scene.name,
          problem: 'published HDR environment bytes do not match the manifest',
          fix: 'Run `blendlink sync` and commit source + artifacts together.',
        })
        continue
      }
      if (manifest.environment.optimized) {
        const optimizedPath = publishedAssetPath(
          scene,
          manifest.environment.optimized.url,
          manifest,
        )
        if (!optimizedPath) {
          issues.push({
            scene: scene.name,
            problem: `optimized environment URL is outside the scene publication directory: ${manifest.environment.optimized.url}`,
            fix: 'Run `blendlink sync`; compiler-owned asset URLs must stay relative to the generated GLB.',
          })
          continue
        }
        if (!existsSync(optimizedPath)) {
          issues.push({
            scene: scene.name,
            problem: `verified KTX2 environment is missing from ${optimizedPath}`,
            fix: 'Run `blendlink sync` and commit both the source and optimized environment assets.',
          })
          continue
        }
        const optimizedBytes = readFileSync(optimizedPath)
        const optimizedHash = createHash('sha256').update(optimizedBytes).digest('hex').slice(0, 16)
        if (
          optimizedBytes.byteLength !== manifest.environment.optimized.bytes ||
          optimizedHash !== manifest.environment.optimized.hash
        ) {
          issues.push({
            scene: scene.name,
            problem: 'verified KTX2 environment bytes do not match the manifest',
            fix: 'Run `blendlink sync` and commit source + optimized artifacts together.',
          })
          continue
        }
      }
    }
    if (manifest.materialPrograms) {
      const programsPath = publishedAssetPath(
        scene,
        manifest.materialPrograms.url,
        manifest,
      )
      if (!programsPath) {
        issues.push({
          scene: scene.name,
          problem: `material programs URL is outside the scene publication directory: ${manifest.materialPrograms.url}`,
          fix: 'Run `blendlink sync`; compiler-owned asset URLs must stay relative to the generated GLB.',
        })
        continue
      }
      if (!existsSync(programsPath)) {
        issues.push({
          scene: scene.name,
          problem: `material programs sidecar is missing from ${programsPath}`,
          fix: 'Run `blendlink sync` and commit the generated materials.json asset.',
        })
        continue
      }
      const programsBytes = readFileSync(programsPath)
      const programsHash = createHash('sha256').update(programsBytes).digest('hex').slice(0, 16)
      if (
        programsBytes.byteLength !== manifest.materialPrograms.bytes ||
        programsHash !== manifest.materialPrograms.hash
      ) {
        issues.push({
          scene: scene.name,
          problem: 'material programs sidecar bytes do not match the manifest',
          fix: 'Run `blendlink sync` and commit source + artifacts together.',
        })
        continue
      }
    }
    let reflectionProbeFailure: string | undefined
    for (const [probeId, asset] of Object.entries(manifest.reflectionProbeAssets ?? {})) {
      const path = publishedAssetPath(scene, asset.url, manifest)
      if (!path) {
        reflectionProbeFailure = `${probeId} URL is outside the scene publication directory: ${asset.url}`
      } else if (!existsSync(path)) {
        reflectionProbeFailure = `${probeId} is missing from ${path}`
      } else {
        const bytes = readFileSync(path)
        const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
        if (bytes.byteLength !== asset.bytes || hash !== asset.hash) {
          reflectionProbeFailure = `${probeId} bytes do not match the manifest`
        }
      }
      if (reflectionProbeFailure) break
    }
    if (reflectionProbeFailure) {
      issues.push({
        scene: scene.name,
        problem: `reflection probe asset integrity failed: ${reflectionProbeFailure}`,
        fix: 'Run `blendlink sync` and commit every generated reflection texture with its manifest.',
      })
      continue
    }
    let textureVariantFailure: string | undefined
    for (const [sourceUrl, variants] of Object.entries(manifest.textureVariants ?? {})) {
      for (const variant of variants) {
        const label = `${sourceUrl} ${variant.width}x${variant.height} ${variant.format}`
        const path = publishedAssetPath(scene, variant.url, manifest)
        if (variant.lossless !== true || (variant.format !== 'png' && variant.format !== 'webp')) {
          textureVariantFailure = `${label} has invalid lossless format metadata`
        } else if (!Number.isInteger(variant.width) || variant.width <= 0
          || !Number.isInteger(variant.height) || variant.height <= 0
          || !Number.isInteger(variant.bytes) || variant.bytes <= 0
          || !/^[0-9a-f]{16}$/i.test(variant.hash)) {
          textureVariantFailure = `${label} has malformed dimensions, byte count, or hash metadata`
        } else if (!path) {
          textureVariantFailure = `${label} URL is outside the scene publication directory: ${variant.url}`
        } else if (!existsSync(path)) {
          textureVariantFailure = `${label} is missing from ${path}`
        } else if (statSync(path).size !== variant.bytes || artifactHashOf(path) !== variant.hash) {
          textureVariantFailure = `${label} bytes do not match the manifest`
        }
        if (textureVariantFailure) break
      }
      if (textureVariantFailure) break
    }
    if (textureVariantFailure) {
      issues.push({
        scene: scene.name,
        problem: `texture variant integrity failed: ${textureVariantFailure}`,
        fix: 'Run `blendlink sync` and commit every generated PNG/WebP resolution tier with its manifest.',
      })
      continue
    }
    const bakedArtifacts: Array<{ job: string; url: string; expected?: string }> = []
    for (const [stateName, state] of Object.entries(manifest.states ?? {})) {
      if (state.url) bakedArtifacts.push({
        job: `state:${stateName}:main`, url: state.url,
        expected: manifest.bakeArtifactHashes?.states[stateName]?.main,
      })
      for (const [atlas, url] of Object.entries(state.atlases ?? {})) {
        bakedArtifacts.push({
          job: `state:${stateName}:${atlas}`, url,
          expected: manifest.bakeArtifactHashes?.states[stateName]?.[atlas],
        })
      }
    }
    for (const [lightName, light] of Object.entries(manifest.lightGroups ?? {})) {
      if (light.url) bakedArtifacts.push({
        job: `light:${lightName}:main`, url: light.url,
        expected: manifest.bakeArtifactHashes?.lightGroups[lightName]?.main,
      })
      for (const [atlas, layer] of Object.entries(light.atlases ?? {})) {
        bakedArtifacts.push({
          job: `light:${lightName}:${atlas}`, url: layer.url,
          expected: manifest.bakeArtifactHashes?.lightGroups[lightName]?.[atlas],
        })
      }
    }
    let bakedArtifactFailure: string | undefined
    for (const artifact of bakedArtifacts) {
      const path = publishedAssetPath(scene, artifact.url, manifest)
      if (!artifact.expected) {
        bakedArtifactFailure = `${artifact.job} has no published content hash`
      } else if (!path) {
        bakedArtifactFailure = `${artifact.job} URL is outside the scene publication directory: ${artifact.url}`
      } else if (!existsSync(path)) {
        bakedArtifactFailure = `${artifact.job} is missing from ${path}`
      } else if (artifactHashOf(path) !== artifact.expected) {
        bakedArtifactFailure = `${artifact.job} bytes do not match the manifest hash`
      }
      if (bakedArtifactFailure) break
    }
    if (bakedArtifactFailure) {
      issues.push({
        scene: scene.name,
        problem: `baked atlas integrity failed: ${bakedArtifactFailure}`,
        fix: 'Run `blendlink sync` and commit every generated state/light-group atlas with its manifest.',
      })
      continue
    }
    if (manifest.draft) {
      issues.push({
        scene: scene.name,
        problem: 'Preview-quality artifacts are committed instead of a Final build',
        fix: 'Run `blendlink compile` and commit the regenerated Final files.',
      })
      continue
    }
    if (scene.external) {
      const currentInputsHash = inputsHashOf(scene)
      if (currentInputsHash && manifest.inputsHash && manifest.inputsHash !== currentInputsHash) {
        issues.push({
          scene: scene.name,
          problem: 'a declared input file (e.g. the pipeline config) changed after the last sync',
          fix: scene.build
            ? `Run \`${scene.build}\` (or \`blendlink sync\`) and commit.`
            : 'Re-run your export pipeline and commit.',
        })
        continue
      }
    }
    if (!existsSync(scene.glbPath)) {
      issues.push({
        scene: scene.name,
        problem: `GLB missing from ${scene.glbPath} but listed in the manifest`,
        fix: 'This file should be committed — check .gitignore for *.glb, or run `blendlink sync`.',
      })
      continue
    }
    const glbBytes = readFileSync(scene.glbPath)
    const glbHash = createHash('sha256')
      .update(glbBytes)
      .digest('hex')
      .slice(0, 16)
    if (glbHash !== manifest.hash) {
      issues.push({
        scene: scene.name,
        problem: 'GLB on disk does not match the manifest hash',
        fix: 'Run `blendlink sync` and commit source + artifacts together.',
      })
    } else {
      try {
        const audit = await auditCompiledSceneArtifact({ manifest, glbBytes })
        const collapseIssue = materialCollapseVerificationIssue(scene, audit)
        if (collapseIssue) issues.push(collapseIssue)
      } catch (error) {
        issues.push({
          scene: scene.name,
          problem: `compiled GLB quality audit failed: ${error instanceof Error ? error.message : String(error)}`,
          fix: 'Run `blendlink sync`; if the rebuilt artifact still fails, report the exact audit error.',
        })
      }
    }
    // Keep established role-specific diagnostics above (KTX2, environment,
    // variants, baked atlases, and GLB) because they carry the best artist
    // remedy. The graph then closes the gap for every future companion that
    // has no dedicated manifest field.
    if (glbHash === manifest.hash) {
      if (manifest.runtimeAssetGraph) {
        const problem = sceneAssetGraphIntegrityProblem(
          runtimeDirectory,
          manifest.runtimeAssetGraph,
          {
            requiresKtx2: ktx2RuntimeAssetsRequired(manifest),
            expectedScenePath:
              manifest.runtimeAssetPublication?.scenePath
              ?? sceneAssetGraphPath(dirname(scene.glbPath), scene.glbPath),
          },
        )
        if (problem) {
          issues.push({
            scene: scene.name,
            problem: `runtime asset graph integrity failed: ${problem}`,
            fix: scene.external
              ? 'Re-run the external build/typegen pipeline and commit its complete runtime asset graph.'
              : 'Run `blendlink sync` and commit every generated runtime asset with its manifest.',
          })
          continue
        }
        if (manifest.runtimeAssetPublication) {
          const compatibilityProblem = sceneAssetGraphIntegrityProblem(
            dirname(scene.glbPath),
            manifest.runtimeAssetGraph,
            {
              requiresKtx2: ktx2RuntimeAssetsRequired(manifest),
              expectedScenePath: sceneAssetGraphPath(
                dirname(scene.glbPath),
                scene.glbPath,
              ),
            },
          )
          if (compatibilityProblem) {
            issues.push({
              scene: scene.name,
              problem:
                `stable compatibility asset graph integrity failed: ${compatibilityProblem}`,
              fix:
                'Run `blendlink compile`; the generated descriptor remains graph-addressed while Blendlink repairs the pre-1.0 stable compatibility files.',
            })
            continue
          }
        }
      } else if (!scene.external) {
        issues.push({
          scene: scene.name,
          problem: 'generated manifest is missing the complete runtime asset graph',
          fix: 'Run `blendlink sync` and commit every generated runtime asset with its manifest.',
        })
        continue
      }
    }
    // Blend-byte drift check: works Blender-free for synced AND external
    // scenes, as long as the manifest was stamped with blendBytesHash
    // (sync does this automatically; external pipelines via typegen --blend).
    if (manifest.blendBytesHash && existsSync(scene.blendPath)) {
      const blendBytesHash = createHash('sha256')
        .update(readFileSync(scene.blendPath))
        .digest('hex')
        .slice(0, 16)
      if (manifest.blendBytesHash !== blendBytesHash) {
        issues.push({
          scene: scene.name,
          problem: `${scene.blendPath} changed after the last sync`,
          fix: scene.external
            ? 'Re-run your export pipeline, then `blendlink typegen <glb> --blend <file>`, and commit.'
            : 'Run `blendlink sync` (requires Blender) and commit the regenerated artifacts.',
        })
      }
    }
  }
  assertConfigSourceRevisionCurrent(config.configSource)
  return issues
}
