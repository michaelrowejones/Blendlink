import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverBlender, type BlenderInstall } from './discover.js'
import { readBlendHeader } from './blendHeader.js'
import { ProgressEcho, progressEnabled } from './progress.js'
import type { PresentationMode, SceneRecipe } from './sceneRecipe.js'
import type { BlenderSceneDiagnostics } from './sceneDiagnostics.js'
import type { AuthoringPreview } from './runtime.js'
import type { AnimationSequenceRecipe } from './animationSequence.js'

const invokeModuleDirectory = dirname(fileURLToPath(import.meta.url))
const EXPORT_SCRIPT = [
  join(invokeModuleDirectory, 'blender', 'export_scene.py'),
  join(invokeModuleDirectory, '..', 'blender', 'export_scene.py'),
].find((candidate) => existsSync(candidate)) ??
  join(invokeModuleDirectory, 'blender', 'export_scene.py')

export interface BakeSettings {
  /** Atlas size in px. Default 2048. */
  size?: number
  /** Max adaptive samples. Default 128. */
  samples?: number
  /** Bake margin px (island spacing follows it). Default 48. */
  margin?: number
  /** Bake at N× the atlas size and box-resolve down — free anti-aliasing
   * (Cycles bakes have none) at zero runtime cost. 2 is the sweet spot. */
  supersample?: number
  /** OIDN-denoise the baked images before saving (runs after margin
   * dilation, so the bake-time-denoise margin bug does not apply). */
  denoise?: boolean
  /** Lighting states: each bakes with the listed collections hidden. */
  states?: Array<{ name: string; hideCollections?: string[] }>
  /** Named atlases. Objects auto-assign by nearest-camera proximity
   * (first declared atlas whose maxCameraDistance covers them; else the
   * catch-all without one) and override per-object via the blendlink_atlas
   * property. Omit for the single implicit atlas "main" sized by `size`. */
  atlases?: Record<string, {
    size?: number
    maxCameraDistance?: number
    targetDensity?: number
    margin?: number
    fitPolicy?: 'block' | 'scale'
    /** Lighting preserves realtime PBR with baked indirect GI; appearance
     * flattens the final authored look. Missing legacy values mean appearance. */
    bakeOutput?: 'lighting' | 'appearance'
  }>
  /** Internal Preview-quality escape hatch. Preview may show a reduced-detail
   * result while Final continues to enforce every authored block policy. */
  previewScaleToFit?: boolean
}

export interface ExportSettings {
  /** Export only this collection (and children); omit for the whole file. */
  collection?: string
  /** 'AUTO' embeds textures; 'NONE' skips image export (fast dev loops). */
  imageFormat?: 'AUTO' | 'NONE'
  /** 'baked': compile the per-atlas Lighting/Appearance recipe with Cycles. */
  mode?: 'standard' | 'baked'
  bake?: BakeSettings
  /** Curve sampling resolution for non-bezier splines. Default 64. */
  curveSamples?: number
  /** Escape hatch: raw exporter kwargs, RNA-filtered inside Blender. */
  exporterOverrides?: Record<string, unknown>
  /** Compute the bake plan (UV pack + density stats) and stop — no bake,
   * no GLB. The answer to "what is it planning to bake?". */
  planOnly?: boolean
  /** Select the scene-owned Preview profile. Config-driven legacy scenes
   * retain the historical draft transform in the Node sync layer. */
  draft?: boolean
  /** Internal: this compile feeds Blendlink's private authoring viewer, so
   * Blender-side authoring approximation warnings should be surfaced. */
  authoringPreview?: boolean
  /** Internal, conservative atlas-job cache supplied by sync. Public callers
   * may omit it; missing/stale files and incompatible fingerprints rebuild. */
  incremental?: IncrementalBakeCache
}

export interface BakeFingerprints {
  version: 1
  states: Record<string, Record<string, string>>
  lightGroups: Record<string, Record<string, string>>
}

/** Hashes of the exact PNG bytes produced for each safe cache unit. */
export interface BakeArtifactHashes {
  version: 1
  states: Record<string, Record<string, string>>
  lightGroups: Record<string, Record<string, string>>
}

export interface BakedTextureVariant {
  path: string
  width: number
  height: number
  bytes: number
  hash: string
}

export interface IncrementalBakeCache {
  fingerprints: BakeFingerprints
  artifacts: BakeArtifactHashes
  /** Previous published files, addressed by state then atlas. */
  states: Record<string, Record<string, string>>
  /** Decode scales for normalized state atlases, addressed identically to
   * `states`. Lighting requires them; legacy Appearance may omit scale 1. */
  stateScales: Record<string, Record<string, number>>
  /** Previous additive files and their decode scale, by light group/atlas. */
  lightGroups: Record<string, Record<string, { path: string; maxValue: number }>>
  /** Finalized lower-resolution PNG tiers. These are produced only by
   * bakelib so their coverage/background/color contract matches the source. */
  stateVariants: Record<string, Record<string, BakedTextureVariant[]>>
  lightGroupVariants: Record<string, Record<string, BakedTextureVariant[]>>
}

export interface IncrementalBakeReport {
  totalJobs: number
  reusedJobs: number
  rebuiltJobs: number
  /** Stable job IDs: `state:<name>:<atlas>` or `light:<name>:<atlas>`. */
  reused: string[]
  rebuilt: string[]
  invalidated: Array<{
    job: string
    reason:
      | 'no-prior-fingerprint'
      | 'dependencies-changed'
      | 'no-prior-artifact-hash'
      | 'artifact-not-provided'
      | 'artifact-missing'
      | 'artifact-changed'
      | 'delivery-variant-not-provided'
      | 'delivery-variant-missing'
      | 'delivery-variant-changed'
  }>
  /** Local build evidence. Exact GPU names are deliberately excluded so a
   * generated website manifest does not publish a developer's machine ID. */
  execution?: {
    profile: 'preview' | 'final'
    durationMs: number
    samples: number
    supersample: number
    denoise: boolean
    deviceClass: 'cpu' | 'gpu'
    backend: string
    jobs: Array<{
      job: string
      status: 'reused' | 'rebuilt'
      durationMs: number
      /** Cycles image edge before the resolved output is downsampled. */
      effectiveSize: number
    }>
  }
}

export interface BakePlan {
  supersample: number
  atlasSize: number
  marginPx: number
  samples: number
  /** Ray origin used for camera-dependent Appearance shading. Active Camera is
   * inferred only for a fixed/authored camera with all-Appearance atlases. */
  appearanceViewFrom?: 'above-surface' | 'active-camera'
  /** Sum of packed UV areas (0..1) — atlas occupancy. */
  occupancy: number
  states: string[]
  lightGroups: string[]
  bakeCount: number
  /** Per-atlas summary when atlases are declared (or the implicit main). */
  atlases?: Record<string, {
    size: number
    /** The authored composition contract for every receiver in this atlas. */
    bakeOutput?: 'lighting' | 'appearance'
    occupancy: number
    objects: number
    targetDensity?: number
    requiredOccupancy?: number
    achievedDensity?: number
    targetAchievement?: number
    paddingPx?: number
    fitPolicy?: 'block' | 'scale'
    /** Decoded RGBA8 upper bound for one mipmapped active texture. Network
     * compression does not reduce this WebGL residency estimate. */
    estimatedGpuBytesRgba8Mipmapped?: number
    compositionDetail?: {
      worstObject: string
      camera: string
      composition: string
      cssWidth: number
      cssHeight: number
      atlasTexelsPerCssPixelAt1x: number
      atlasTexelsPerDevicePixelAt2x: number
    }
  }>
  objects: Array<{
    name: string
    /** Which atlas the object landed in (property override or proximity). */
    atlas?: string
    /** Appearance owns the visible Surface; Lighting keeps the live material. */
    bakeOutput?: 'lighting' | 'appearance'
    areaM2: number
    uvShare: number
    pxPerMeter: number
    /** Distance from the scene camera to the object center (null: no camera). */
    cameraDistance: number | null
    /** px/m × distance — equal values = equal perceived quality. */
    screenDensity: number | null
    /** Auto texel weight (camera-distance, median-normalized, quantized). */
    autoWeight: number
    /** Artist texel_weight custom property (1 = default, 0 = excluded). */
    artistWeight: number
    /** Worst artist-declared responsive composition. Below 1 means the atlas
     * is provably magnified at that output pixel density. */
    compositionDetail?: {
      camera: string
      composition: string
      cssWidth: number
      cssHeight: number
      atlasTexelsPerCssPixelAt1x: number
      atlasTexelsPerDevicePixelAt2x: number
    }
    /** True when the mesh carried a BLENDLINK_ATLAS_AUTHORED layer and the
     * pack reused its islands instead of re-deriving from the first UV. */
    authored?: boolean
    /** Authored only: true when at least one island is pinned — pinned
     * islands hold position and scale; the rest packs around them. */
    pinned?: boolean
  }>
  /** Compressed, topology-checked corner UVs from the exact pack that ships.
   * The Blender addon applies this evidence; it never asks Blender's packer
   * to make a second approximation of the published layout. */
  atlasLayout?: {
    version: 1
    encoding: 'f32le-zlib-base64'
    /** Plan-only is the Blender pack; published manifests are finalized from
     * the decoded post-optimization GLB. */
    space?: 'blender-pack' | 'final-glb-decoded'
    objects: Array<{
      name: string
      id?: string
      atlas: string
      topologyHash: string
      loopCount: number
      uvHash: string
      data: string
    }>
    unavailable?: Array<{ name: string; id?: string; reason: string }>
  }
  /** In the GLB for physics, but kept out of the atlas and bake. */
  collisionProxies: string[]
  /** Mixed scenes: meshes that keep real materials and runtime lighting
   * (explicit blendlink_dynamic, armature-deformed, or transparent). */
  dynamicObjects: Array<{ name: string; reason: string }>
  /** Decoded RGBA8 upper bound for one active texture per populated atlas,
   * including full mip chains. States cached by an application cost more. */
  estimatedActiveAtlasGpuBytesRgba8Mipmapped?: number
  warnings: string[]
  /** Reasons a final bake is blocked. Plan-only calls return these so the
   * artist can revise layout before spending time in Cycles. */
  errors?: string[]
}

export interface BlendSidecar {
  fps: number
  /** Opt-in NLA strip schedule; Action samples themselves remain in the GLB. */
  animationSequence?: AnimationSequenceRecipe
  markers: Array<{ name: string; frame: number; time: number }>
  empties: Array<{ name: string; displayType: string; size: number }>
  curves: Array<{
    name: string
    kind: 'bezier' | 'points'
    cyclic: boolean
    points: Array<
      | [number, number, number]
      | { co: [number, number, number]; handleLeft: [number, number, number]; handleRight: [number, number, number] }
    >
  }>
  textures: Array<{
    name: string
    width: number
    height: number
    colorSpace: string
    maxSize?: number
    /** Artist override; absent means inherit the scene's semantic policy. */
    compression?: 'none' | 'etc1s' | 'uastc'
  }>
  /** Blender viewport/display evidence for explicitly opted-in authoring
   * previews. It is not a production presentation recipe. */
  authoringPreview?: AuthoringPreview
  /** Canonical Blender-to-web light decisions. Snake-case field names match
   * the JSON emitted by the shared Python policy used by the addon/exporter. */
  lightDiagnostics?: {
    lights: Array<{
      object_name: string
      data_name: string
      source_type: string
      web_type: string | null
      status: 'exact' | 'approximated' | 'notExported'
      visibility: {
        exported: boolean
        code: string
        detail: string
        hidden_collections: string[]
      }
      detail: string
      reasons: string[]
      source_energy: number | null
      source_exposure: number | null
      expected_web_intensity: number | null
      expected_three_power: number | null
      /** Artist-facing consequence classification from canonical weblights.py. */
      outcome?: 'exact' | 'approximated' | 'bakeOnly' | 'notPublished'
      remedy?: string
    }>
    warnings: Array<{
      code: string
      message: string
      object_name: string
      severity: 'WARNING' | 'ERROR'
      blocking: boolean
    }>
  }
  /** Unpacked images, libraries, fonts, caches, and other Blender file refs. */
  externalDependencies?: Array<{
    path: string
    relativeToBlend: boolean
    exists: boolean
    bytes: number
    hash: string | null
    volatile: boolean
    /** Absent means conservatively build-reachable. False is emitted only
     * when Blender proves the path is confined to unbound material graphs. */
    reachable?: false
    reachabilityReason?: 'unbound-material'
  }>
  /** Evaluated Geometry Nodes, shared-mesh, and topology evidence captured
   * before the temporary export scene is frozen or baked. */
  diagnostics?: BlenderSceneDiagnostics
}

export type RectAreaLightDescriptorEvidence = Readonly<
  Record<string, unknown> & {
    schemaVersion: 1
    color: [number, number, number]
    size: [number, number]
  } & (
    | { power: number; intensity?: never }
    | { intensity: number; power?: never }
  )
>

export interface RectAreaLightContractEvidence {
  /** Blender source identity used for artist-facing diagnostics. */
  sourceObjectName: string
  /** Exact finalized glTF node name. V1 refuses ambiguous duplicate nodes. */
  nodeName: string
  /** Exact payload observed after attachment; additive v1 fields are retained. */
  descriptor: RectAreaLightDescriptorEvidence
  attachment: 'attached' | 'existing'
}

export interface ExportResult {
  ok: true
  glbPath: string
  blenderVersion: string
  exporterKwargsDropped: string[]
  warnings: string[]
  /** Objects removed by the -noimp convention (never silently). */
  excluded: string[]
  /** Blender-only data the GLB cannot carry. */
  sidecar: BlendSidecar
  /** Baked mode: state name → atlas group → final PNG path on disk.
   * Single-atlas scenes use the one implicit group "main". */
  bakedStates: Record<string, Record<string, string>>
  /** Per-atlas output intent. Missing entries are legacy appearance bakes. */
  bakeOutputs: Record<string, 'appearance' | 'lighting'>
  /** Decode scales for normalized Lighting and Appearance state atlases. */
  bakedStateScales: Record<string, Record<string, number>>
  /** Full collection-state membership; texture swaps alone cannot make
   * Blender-hidden geometry or lights disappear in Three. */
  bakedStateVisibility: Record<string, {
    hiddenObjectIds: string[]
    hiddenObjectNames: string[]
  }>
  /** Baked mode: light group → atlas group → additive layer + peak scale. */
  bakedLightGroups: Record<string, Record<string, { path: string; maxValue: number }>>
  /** Baked mode delivery tiers, kept separate from the artist-owned full PNG. */
  bakedVariants: {
    states: Record<string, Record<string, BakedTextureVariant[]>>
    lightGroups: Record<string, Record<string, BakedTextureVariant[]>>
  }
  /** Baked mode: the bake plan (planOnly runs produce ONLY this). */
  plan?: BakePlan
  /** Conservative per-atlas dependency fingerprints for the next sync. */
  bakeFingerprints?: BakeFingerprints
  /** Exact per-atlas output hashes; dependency equality alone cannot prove
   * a prior PNG was not truncated or modified on disk. */
  bakeArtifactHashes?: BakeArtifactHashes
  /** What the current bake reused versus rebuilt. */
  incrementalBake?: IncrementalBakeReport
  /** Artist-owned recipe embedded in the .blend, when configured. */
  recipe?: SceneRecipe | null
  presentation?: PresentationMode | null
  /** Raw HDR/EXR copied byte-for-byte from Blender and relocated beside the GLB. */
  environment?: {
    path: string
    sourceName: string
    format: 'hdr' | 'exr'
    bytes: number
    hash: string
    /** Linked files force sync: their bytes can change without changing the .blend. */
    source: 'packed' | 'linked'
  } | null
  /** Published equirectangular sources keyed by ergonomic probe id. Runtime
   * capture probes are intentionally absent. */
  reflectionProbeAssets: Record<string, {
    path: string
    sourceName: string
    mode: 'baked' | 'custom'
    format: 'hdr' | 'exr' | 'png' | 'jpeg' | 'webp'
    colorSpace: 'linear' | 'srgb'
    width: number
    height: number
    bytes: number
    hash: string
    source: 'packed' | 'linked'
    sourceHash?: string
  }>
  /** Finished-GLB truth used for light scope and Preview Studio shadows. */
  lightContract?: {
    exportedNodeNames: string[]
    publishedSourceObjectNames: string[]
    patchedNativeShadowOff: string[]
    shadowsEnabled: boolean
    /** Exact finalized-node evidence, later attested again after optimization. */
    rectAreaLights?: RectAreaLightContractEvidence[]
  }
  /** Non-mutating material defaults assigned to glTF primitives that had no
   * authored Blender material. */
  materialDefaults?: {
    patchedPrimitiveCount: number
    materialIndex: number | null
    primitives: string[]
  }
  durationMs: number
}

export class BlendExportError extends Error {
  constructor(
    message: string,
    readonly detail: { exitCode: number | null; stderrTail: string },
  ) {
    super(message)
  }
}

let optixCacheProbeSequence = 0

/**
 * Give OptiX a stable, writable local cache before Blender starts.
 *
 * OptiX normally chooses its own per-user directory. In restricted build
 * agents that directory can exist but be unwritable; Cycles then recompiles
 * kernels for every native multi-object bake receiver. Keep an explicit user
 * choice, otherwise use Blendlink's stable directory under the same temporary
 * root that already holds the export transaction.
 */
export function blenderProcessEnvironment(
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  temporaryRoot: string = tmpdir(),
): NodeJS.ProcessEnv {
  const configuredPath =
    baseEnvironment.BLENDLINK_OPTIX_CACHE_PATH?.trim() ||
    baseEnvironment.OPTIX_CACHE_PATH?.trim()
  const cachePath = resolve(configuredPath || join(temporaryRoot, 'blendlink-optix-cache'))
  const probePath = join(
    cachePath,
    `.blendlink-write-${process.pid}-${++optixCacheProbeSequence}`,
  )
  try {
    mkdirSync(cachePath, { recursive: true })
    writeFileSync(probePath, '', { flag: 'wx' })
    rmSync(probePath)
  } catch (error) {
    // A failed write can still leave the uniquely named probe behind. It is
    // package-owned and safe to remove; never touch any other cache entry.
    try {
      rmSync(probePath, { force: true })
    } catch {
      // Preserve the provisioning error below. Its remedy also resolves a
      // probe that could not be removed.
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new BlendExportError(
      `Blendlink could not provision a writable local OptiX cache at ${cachePath}. ` +
        'A missing cache can make Cycles compile kernels once per bake receiver. ' +
        'Set BLENDLINK_OPTIX_CACHE_PATH to a writable local directory and retry.',
      { exitCode: null, stderrTail: detail },
    )
  }
  return {
    ...baseEnvironment,
    OPTIX_CACHE_PATH: cachePath,
    BLENDLINK_PROGRESS: '1',
  }
}

export interface DeclaredExportSidecars {
  baked?: {
    states?: Record<string, Record<string, string>>
    lightGroups?: Record<string, Record<string, { path: string }>>
    variants?: {
      states?: Record<string, Record<string, BakedTextureVariant[]>>
      lightGroups?: Record<string, Record<string, BakedTextureVariant[]>>
    }
  }
  environment?: { path: string } | null
  reflectionProbeAssets?: Record<string, { path: string }> | null
}

/** A successful Blender result is a contract, not a hint. Returning a path
 * that was never written must abort before the GLB replaces the prior build. */
export function missingDeclaredSidecars(result: DeclaredExportSidecars): string[] {
  const missing: string[] = []
  for (const [state, groups] of Object.entries(result.baked?.states ?? {})) {
    for (const [group, path] of Object.entries(groups ?? {})) {
      if (!existsSync(path)) missing.push(`state ${JSON.stringify(state)} atlas ${JSON.stringify(group)}: ${path}`)
    }
  }
  for (const [light, groups] of Object.entries(result.baked?.lightGroups ?? {})) {
    for (const [group, layer] of Object.entries(groups ?? {})) {
      if (!existsSync(layer.path)) missing.push(`light group ${JSON.stringify(light)} atlas ${JSON.stringify(group)}: ${layer.path}`)
    }
  }
  for (const [state, groups] of Object.entries(result.baked?.variants?.states ?? {})) {
    for (const [group, variants] of Object.entries(groups ?? {})) {
      for (const variant of variants ?? []) {
        if (!existsSync(variant.path)) {
          missing.push(`state ${JSON.stringify(state)} atlas ${JSON.stringify(group)} ${variant.width}px variant: ${variant.path}`)
        }
      }
    }
  }
  for (const [light, groups] of Object.entries(result.baked?.variants?.lightGroups ?? {})) {
    for (const [group, variants] of Object.entries(groups ?? {})) {
      for (const variant of variants ?? []) {
        if (!existsSync(variant.path)) {
          missing.push(`light group ${JSON.stringify(light)} atlas ${JSON.stringify(group)} ${variant.width}px variant: ${variant.path}`)
        }
      }
    }
  }
  if (result.environment && !existsSync(result.environment.path)) {
    missing.push(`environment: ${result.environment.path}`)
  }
  for (const [probe, asset] of Object.entries(result.reflectionProbeAssets ?? {})) {
    if (!existsSync(asset.path)) missing.push(`reflection probe ${JSON.stringify(probe)}: ${asset.path}`)
  }
  return missing
}

/** Keep Blender's Python traceback visible even when stdout contains a long
 * exporter progress log. Process streams are ordered independently; joining
 * stderr before stdout and taking one tail can discard the real exception. */
export function blenderDiagnosticTail(stderr: string, stdout: string): string {
  const tail = (value: string, lines: number): string[] =>
    value.replace(/\r\n/g, '\n').split('\n').filter((line) => line.length > 0).slice(-lines)
  const stderrLines = tail(stderr, 40)
  const stdoutLines = tail(stdout, 20)
  return [
    ...(stderrLines.length ? ['Blender stderr (tail):', ...stderrLines] : []),
    ...(stdoutLines.length ? ['Blender stdout (tail):', ...stdoutLines] : []),
  ].join('\n')
}

/**
 * Run one headless export: `.blend` in, `.glb` out.
 *
 * Trust contract (from the hardened-invoker research): the exit code, the
 * result JSON file, and the BLENDLINK_OK sentinel are authoritative; stdout
 * is otherwise diagnostics. The GLB is written to a temp name and renamed
 * atomically so watchers never see a half-written file.
 */
export async function exportBlend(options: {
  blendPath: string
  outPath: string
  settings?: ExportSettings
  blender?: BlenderInstall
  timeoutMs?: number
  allowNewerFile?: boolean
}): Promise<ExportResult> {
  const started = Date.now()
  const blender = options.blender ?? (await discoverBlender())

  const header = readBlendHeader(options.blendPath)
  if (header.version && !options.allowNewerFile) {
    const [fileMajor, fileMinor] = header.version
    const [binMajor, binMinor] = blender.semver
    if (fileMajor > binMajor || (fileMajor === binMajor && fileMinor > binMinor)) {
      throw new BlendExportError(
        `${options.blendPath} was saved by Blender ${fileMajor}.${fileMinor}, ` +
          `newer than the discovered ${blender.version}. Opening it risks data ` +
          `loss. Install a matching Blender, or override with ` +
          `\`blendlink sync --allow-newer\` (API: allowNewerFile).`,
        { exitCode: null, stderrTail: '' },
      )
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'blendlink-'))
  const settingsPath = join(work, 'settings.json')
  const resultPath = join(work, 'result.json')
  const tempGlb = join(work, 'out.glb')
  writeFileSync(settingsPath, JSON.stringify(options.settings ?? {}))

  try {
    const args = [
      '-b',
      options.blendPath,
      '--factory-startup',
      '--python-exit-code',
      '13',
      '--python',
      EXPORT_SCRIPT,
      '--',
      tempGlb,
      settingsPath,
      resultPath,
    ]
    const { exitCode, stdout, stderr } = await run(blender.executable, args, options.timeoutMs ?? 300_000)

    // Trust the sentinel + artifacts over the exit code: Blender sometimes
    // crashes during process shutdown AFTER a fully successful export
    // (observed: EXCEPTION_ACCESS_VIOLATION freeing the scene on exit).
    const planOnly = options.settings?.planOnly === true
    const sentinel = stdout.includes('BLENDLINK_OK')
    const artifactsComplete = existsSync(resultPath) && (planOnly || existsSync(tempGlb))
    if (!sentinel || !artifactsComplete) {
      const stderrTail = blenderDiagnosticTail(stderr, stdout)
      throw new BlendExportError(
        exitCode === 13
          ? 'The export script failed inside Blender.'
          : `Blender exited abnormally (code ${exitCode}).`,
        { exitCode, stderrTail },
      )
    }

    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as Omit<
      ExportResult,
      | 'glbPath'
      | 'durationMs'
      | 'bakedStates'
      | 'bakeOutputs'
      | 'bakedStateScales'
      | 'bakedLightGroups'
      | 'bakedVariants'
    > & {
      baked?: {
        states?: Record<string, Record<string, string>>
        bakeOutputs?: ExportResult['bakeOutputs']
        stateScales?: ExportResult['bakedStateScales']
        stateVisibility?: ExportResult['bakedStateVisibility']
        lightGroups?: Record<string, Record<string, { path: string; maxValue: number }>>
        variants?: {
          states?: Record<string, Record<string, BakedTextureVariant[]>>
          lightGroups?: Record<string, Record<string, BakedTextureVariant[]>>
        }
        fingerprints?: BakeFingerprints
        artifacts?: BakeArtifactHashes
        incremental?: IncrementalBakeReport
      }
    }
    if (exitCode !== 0) {
      result.warnings = [
        ...result.warnings,
        `Blender crashed during shutdown (code ${exitCode}) after a successful export.`,
      ]
    }
    if (planOnly) {
      return {
        ...result,
        bakedStates: {},
        bakeOutputs: {},
        bakedStateScales: {},
        bakedStateVisibility: {},
        bakedLightGroups: {},
        bakedVariants: { states: {}, lightGroups: {} },
        reflectionProbeAssets: result.reflectionProbeAssets ?? {},
        bakeFingerprints: result.baked?.fingerprints,
        bakeArtifactHashes: result.baked?.artifacts,
        incrementalBake: result.baked?.incremental,
        glbPath: options.outPath,
        durationMs: Date.now() - started,
      }
    }
    const missingSidecars = missingDeclaredSidecars(result)
    if (missingSidecars.length > 0) {
      throw new BlendExportError(
        `Blender reported export sidecars that do not exist; the prior published build was left untouched:\n` +
          missingSidecars.map((entry) => `  - ${entry}`).join('\n'),
        { exitCode, stderrTail: blenderDiagnosticTail(stderr, stdout) },
      )
    }
    mkdirSync(dirname(options.outPath), { recursive: true })
    const staging = options.outPath + '.tmp-' + process.pid
    renameOrCopy(tempGlb, staging)
    renameSync(staging, options.outPath)

    // Baked-mode state/light textures are written beside the temp GLB; move
    // them out before the temp dir is destroyed. Python names every file as
    // <temp glb> + suffix, so the final path is the same suffix on the real
    // GLB path — shape-agnostic across single- and multi-atlas scenes.
    const outBase = options.outPath.replace(/\.glb$/i, '')
    const relocate = (tempPath: string): string => {
      if (!existsSync(tempPath)) {
        throw new Error(`Declared export sidecar disappeared before publication: ${tempPath}`)
      }
      const resolvedTemp = resolve(tempPath)
      const resolvedPrefix = resolve(tempGlb) + '.'
      if (!resolvedTemp.startsWith(resolvedPrefix)) {
        throw new Error(`Refusing to relocate an export sidecar outside the owned Blender output set: ${tempPath}`)
      }
      const suffix = tempPath
        .slice(tempGlb.length)
        .replace(/^\.glb/i, '')
        .replace(/^\.state\./, '.')
      const finalPath = outBase + suffix
      renameOrCopy(tempPath, finalPath)
      return finalPath
    }
    const bakedStates: Record<string, Record<string, string>> = {}
    for (const [state, byGroup] of Object.entries(result.baked?.states ?? {})) {
      for (const [group, tempPath] of Object.entries(byGroup ?? {})) {
        const finalPath = relocate(tempPath)
        ;(bakedStates[state] ??= {})[group] = finalPath
      }
    }
    const bakedLightGroups: Record<string, Record<string, { path: string; maxValue: number }>> = {}
    for (const [light, byGroup] of Object.entries(result.baked?.lightGroups ?? {})) {
      for (const [group, layer] of Object.entries(byGroup ?? {})) {
        const finalPath = relocate(layer.path)
        ;(bakedLightGroups[light] ??= {})[group] = { path: finalPath, maxValue: layer.maxValue }
      }
    }
    const bakedVariants: ExportResult['bakedVariants'] = { states: {}, lightGroups: {} }
    for (const [state, byGroup] of Object.entries(result.baked?.variants?.states ?? {})) {
      for (const [group, variants] of Object.entries(byGroup ?? {})) {
        ;(bakedVariants.states[state] ??= {})[group] = variants.map((variant) => ({
          ...variant,
          path: relocate(variant.path),
        }))
      }
    }
    for (const [light, byGroup] of Object.entries(result.baked?.variants?.lightGroups ?? {})) {
      for (const [group, variants] of Object.entries(byGroup ?? {})) {
        ;(bakedVariants.lightGroups[light] ??= {})[group] = variants.map((variant) => ({
          ...variant,
          path: relocate(variant.path),
        }))
      }
    }
    const environment = result.environment
      ? (() => {
          const finalPath = relocate(result.environment!.path)
          return { ...result.environment!, path: finalPath }
        })()
      : null
    const reflectionProbeAssets = Object.fromEntries(
      Object.entries(result.reflectionProbeAssets ?? {}).map(([id, asset]) => [
        id,
        { ...asset, path: relocate(asset.path) },
      ]),
    )

    return {
      ...result,
      bakedStates,
      bakeOutputs: result.baked?.bakeOutputs ?? {},
      bakedStateScales: result.baked?.stateScales ?? {},
      bakedStateVisibility: result.baked?.stateVisibility ?? {},
      bakedLightGroups,
      bakedVariants,
      bakeFingerprints: result.baked?.fingerprints,
      bakeArtifactHashes: result.baked?.artifacts,
      incrementalBake: result.baked?.incremental,
      environment,
      reflectionProbeAssets,
      glbPath: options.outPath,
      durationMs: Date.now() - started,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function renameOrCopy(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch {
    // Cross-device rename (temp dir on another volume): fall back to copy.
    writeFileSync(to, readFileSync(from))
  }
}

function run(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      // Always enable the internal protocol so legitimate silent Cycles work
      // can keep the inactivity watchdog alive. Direct CLI runs still stay
      // quiet because ProgressEcho only forwards records for an opted-in
      // wrapper such as the Blender add-on.
      env: blenderProcessEnvironment(),
    })
    let stdout = ''
    let stderr = ''
    // INACTIVITY timeout, not a wall-clock one: a legitimate 4K multi-state
    // bake exceeds any fixed budget, but a healthy Blender keeps talking
    // (Cycles sample logs, progress lines). Silence is the hang signal.
    let timer: NodeJS.Timeout
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        // Blender must die as a tree on Windows or helpers linger.
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
        reject(new BlendExportError(
          `Blender produced no output for ${timeoutMs}ms — treating it as hung.`,
          {
            exitCode: null,
            stderrTail: stderr.split('\n').slice(-15).join('\n'),
          },
        ))
      }, timeoutMs)
    }
    // Blender's stdout is captured for the sentinel contract, but progress
    // lines from the export script must stream live to whoever is watching.
    const echo = progressEnabled() ? new ProgressEcho() : null
    child.stdout.on('data', (data) => {
      stdout += data
      echo?.push(String(data))
      arm()
    })
    child.stderr.on('data', (data) => {
      stderr += data
      arm()
    })
    arm()

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stdout, stderr })
    })
  })
}
