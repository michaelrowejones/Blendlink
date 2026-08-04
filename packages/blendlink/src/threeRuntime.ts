import * as THREE from 'three'
import { FlyControls } from 'three/addons/controls/FlyControls.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js'
import { fitGroundedBackgroundToCompiledRoot } from './threeRenderableBounds.js'
import {
  inspectThreeGroundedCameraSafety,
  repairPackageGroundedCameraFar,
} from './threeGroundedCameraSafety.js'
import {
  assertGltfRuntimeCompatibility,
  loadedThreeRuntimeProfile,
  THREE_NODE_MAX_SKIN_JOINTS,
  type GltfRuntimeCapabilityProfile,
} from './gltfRuntimeCompatibility.js'
export type { GltfRuntimeCapabilityProfile } from './gltfRuntimeCompatibility.js'
export { collectThreeTextureEvidence } from './threeTextureEvidence.js'
// The browser entry must reach every browser-side symbol. Fog and the
// performance monitor were reachable only through the Node/CLI root
// barrel, which is why the README told browsers to `import from
// 'blendlink'` and pull node:child_process, node:fs and sharp with it.
export { applyCompiledSceneFog } from './sceneFog.js'
export { createRuntimePerformanceMonitor } from './runtimePerformance.js'
export type {
  ThreeTextureDimensions,
  ThreeTextureDiscoveryEvidence,
  ThreeTextureEvidence,
  ThreeTextureEvidenceReport,
  ThreeTextureEvidenceSummary,
  ThreeTextureFormatEvidence,
  ThreeTextureMipEvidence,
  ThreeTextureMipSource,
  ThreeTextureResidentEvidence,
  ThreeTextureTargetFamily,
  ThreeWebGLTextureAllocationEvidence,
} from './threeTextureEvidence.js'
import {
  applyCompiledSceneEnvironment,
  applyCompiledSceneLook,
  applyCompiledSceneShadows,
  bindCompiledScene,
  configureCompiledSceneLoader,
  prepareCompiledSceneEnvironment,
  prepareCompiledSceneLook,
  prepareCompiledSceneShadows,
  resolveCompiledSceneShadowIntents,
  startCompiledScenePlayback,
  type CompiledSceneDescriptor,
  type CompiledSceneAnimationTransport,
  type CompiledSceneEnvironment,
  type CompiledSceneEnvironmentOptions,
  type CompiledSceneLook,
  type CompiledSceneLookOptions,
  type CompiledScenePlayback,
  type CompiledSceneShadowReport,
  type LoadedSceneLike,
  type Object3DLike,
  type SceneBindings,
} from './runtime.js'
import {
  installCompiledSceneCamera,
  type CompiledSceneCamera,
} from './cameraControls.js'
import { applyCompiledSceneFog, type CompiledSceneFog } from './sceneFog.js'
import {
  startCompiledSceneLods,
  type CompiledSceneLods,
  type LodObjectLike,
  type LodVectorLike,
} from './lodRuntime.js'
import {
  applyCompiledSceneInstances,
  type CompiledSceneInstances,
  type InstanceObjectLike,
} from './instanceRuntime.js'
import {
  applyCompiledSceneReflectionProbes,
  createThreeWebGLReflectionCapture,
  type ApplyReflectionProbesOptions,
  type CompiledReflectionProbes,
  type ReflectionProbeObjectLike,
  type ReflectionProbePublishedAsset,
  type ReflectionProbeRuntimeContext,
  type ReflectionProbeTextureResource,
  type ThreeWebGLReflectionCaptureNamespace,
} from './reflectionProbes.js'
import {
  isPreparationSafeThreeComponentAdapter,
  installThreeComponents,
  type InstalledThreeComponents,
  type ThreeComponentAdapterRegistry,
} from './threeComponents.js'
import type { PortableComponentRecord } from './components.js'
import type { AccessibilityService, InteractionService } from './componentRuntime.js'
import { DEFAULT_SCENE_RECIPE } from './sceneRecipe.js'
import { resolveRuntimeSceneDiagnostics } from './runtimeDiagnostics.js'
import {
  withMeshoptDecoderForLoad,
  type MeshoptWorkerOptions,
} from './meshoptWorkers.js'
import {
  createCompiledAssetUrlModifier,
  runtimeAssetGraphRoot,
} from './assetUrls.js'
import {
  installThreeRectAreaLights,
  type InstalledThreeRectAreaLights,
  type ThreeRectAreaLightReport,
} from './threeRectAreaLights.js'
import {
  createSceneInstallationCoordinator,
  type PreparedSceneInstallationState,
} from './preparedSceneInstallation.js'
import {
  installThreeStaticShadeFloorTextureSharing,
} from './threeMaterialCarriers.js'
import {
  installThreeTextureSampling,
  type InstalledThreeTextureSampling,
  type ThreeTextureAnisotropy,
  type ThreeTextureSamplingReport,
} from './threeTextureSampling.js'

export {
  defineThreeComponentAdapter,
  installThreeComponents,
} from './threeComponents.js'
export {
  installThreeStaticShadeFloorTextureSharing,
} from './threeMaterialCarriers.js'
export type {
  ThreeStaticShadeFloorTextureReport,
} from './threeMaterialCarriers.js'
export {
  installThreeTextureSampling,
} from './threeTextureSampling.js'
export type {
  InstalledThreeTextureSampling,
  ThreeTextureAnisotropy,
  ThreeTextureSamplingRenderer,
  ThreeTextureSamplingReport,
} from './threeTextureSampling.js'
export type {
  InstallThreeComponentsOptions,
  InstalledThreeComponents,
  ThreeComponentAdapter,
  ThreeComponentAdapterContext,
  ThreeComponentAdapterRegistry,
  ThreeComponentInstallation,
} from './threeComponents.js'
export type {
  AccessibilityService,
  InteractionService,
  PostEffectDescriptor,
  PostPipelineService,
  QualityService,
  RuntimeComponentServices,
  RuntimeQuality,
} from './componentRuntime.js'
export type { ThreeAccessibleControl } from './threeInteractions.js'
export type { ThreeAudioControl, ThreeAudioReadiness } from './threeAudio.js'
export type {
  InstalledThreeWebsiteSurfaces,
  ThreeWebsiteSurfaceBinding,
  WebsiteSurfaceCanvas,
  WebsiteSurfaceColorTreatment,
} from './threeWebsiteSurfaces.js'

/** The small interface emitted by `<scene>.baked.ts`. The implementation is
 * generated once and owned by the website, so published scenes remain usable
 * without a Blendlink-specific asset format or hosted runtime. */
export interface ThreeBakedSceneHandle {
  /** New Lighting-aware recipes expose readiness. Optional preserves older
   * artist-owned recipes until the explicit backed-up template migration. */
  readonly ready?: Promise<void>
  /** Template v7+: optional background promotion from the embedded bootstrap
   * to the selected baked atlas delivery tier. */
  readonly qualityReady?: Promise<void>
  /** Template v5+: upload decoded state textures before the first visible
   * frame. Optional keeps explicitly preserved older artist recipes valid. */
  prepare?(renderer: Pick<THREE.WebGLRenderer, 'initTexture' | 'capabilities'>): Promise<void>
  setState(name: string): boolean
  setStateAsync?(name: string): Promise<boolean>
  setLightGroup(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): boolean
  setLightGroupAsync?(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): Promise<boolean>
  /** Template v3+: register a material clone created by another installed
   * subsystem so baked states and Appearance shader layers remain connected. */
  trackMaterialClone?(
    source: THREE.Material,
    clone: THREE.Material,
  ): (transferred: boolean) => void
  readonly lightGroupNames: readonly string[]
  dispose(): void
}

export type ThreeBakedAtlasDeliveryQuality = 'authored' | 'adaptive' | number

export interface ThreeBakedSceneOptions {
  /** Approximate decoded RGBA+mipmap bytes retained by inactive loader-owned
   * state textures. Active/loading/transferred textures remain pinned. */
  textureCacheBytes?: number
  /** Attempt-scoped manager shared by package-owned scene companions. Older
   * generated recipes may ignore it until explicitly migrated. */
  loadingManager?: THREE.LoadingManager
  /** Template v9+: 'authored' (default) selects the highest advertised tier,
   * 'adaptive' uses viewport/device hints, and a positive finite number requests
   * the smallest advertised tier at or above that resolution. */
  atlasDeliveryQuality?: ThreeBakedAtlasDeliveryQuality
}

export type CreateThreeBakedScene = (
  root: THREE.Object3D,
  options?: ThreeBakedSceneOptions,
) => ThreeBakedSceneHandle

export interface ThreeSceneViewport {
  width: number
  height: number
}

export type ThreePresentationCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera

/** Either Three renderer family. WebGPURenderer's class type lives in
 * 'three/webgpu'; a structural stand-in here keeps that module out of
 * WebGL-only type graphs while the runtime's family assertion does the
 * real gatekeeping (isWebGLRenderer || isWebGPURenderer). */
export interface WebgpuRendererLike {
  readonly isWebGPURenderer: true
  domElement: HTMLCanvasElement
  render: (scene: THREE.Object3D, camera: THREE.Camera) => unknown
  setSize: (width: number, height: number, updateStyle?: boolean) => unknown
  dispose: () => void
}

export type CompiledSceneRendererOption =
  | THREE.WebGLRenderer
  | WebgpuRendererLike

/** Internal legacy view of either renderer family. Family gatekeeping is
 * runtime-structural: assertCompiledSceneRenderer admits exactly the two
 * families, and every family-sensitive seam branches on isWebGPURenderer
 * before touching WebGL-only surface. The static WebGLRenderer view keeps
 * those seams' structural parameter contracts unchanged for the classic
 * path. */
function legacyRendererView(
  renderer: CompiledSceneRendererOption,
): THREE.WebGLRenderer {
  return renderer as unknown as THREE.WebGLRenderer
}

export interface InstallThreeCompiledSceneOptions extends MeshoptWorkerOptions {
  descriptor: CompiledSceneDescriptor
  renderer: CompiledSceneRendererOption
  scene: THREE.Scene
  /** Application-owned manager. Blendlink never calls abort() on it. When
   * omitted, the one-call installer owns a private attempt-scoped manager.
   * Three may still coalesce same-URL FileLoader work across managers, so a
   * manager is not a process-wide request-isolation boundary. */
  loadingManager?: THREE.LoadingManager
  /** Rebase compiler-owned URLs beneath a Next/Vite base path or CDN root.
   * This is supported only with Blendlink's private loaders; application-owned
   * loaders/managers retain their own URL policy. */
  assetBaseUrl?: string | URL
  /** Abandon this installation. Requests initiated by the private manager are
   * asked to abort where Three and the browser support it; same-URL requests
   * coalesced across managers and non-abortable work are generation-gated and
   * disposed after they settle. */
  signal?: AbortSignal
  /** Reuse an application-owned loader when it has custom glTF plugins. */
  loader?: GLTFLoader
  /** Explicit semantic attestation for custom plugins on an application-owned
   * loader. A parser plugin name alone never grants support. Blendlink uses
   * only declared extensions that are also present on the loaded parser, and
   * applications should back this declaration with their browser smoke gate. */
  gltfRuntimeCapabilities?: GltfRuntimeCapabilityProfile
  /** Optional application-owned override. Without it, the one-call installer
   * creates a loader for KTX2 scenes, using `<scene-url-dir>/blendlink-basis/`.
   * Supplied loaders must already have a path and renderer support configured. */
  ktx2Loader?: KTX2Loader
  /** Import this from the generated `<scene>.baked.ts`. It is required only
   * when the descriptor publishes baked states or additive light groups. */
  createBakedScene?: CreateThreeBakedScene
  /** Override the generated recipe's device-aware 64/128/256 MiB inactive
   * texture LRU. The recipe validates non-negative finite bytes or Infinity. */
  bakedTextureCacheBytes?: number
  /** Baked atlas delivery tier policy. Defaults to predictable artist-owned
   * full quality; opt into 'adaptive' for the former viewport/device heuristic. */
  bakedAtlasDeliveryQuality?: ThreeBakedAtlasDeliveryQuality
  /** Initial CSS-pixel viewport used for camera composition. Defaults to the
   * renderer canvas client size when it is non-zero. */
  viewport?: ThreeSceneViewport
  /** Used only when Blender has no presentation camera. */
  fallbackCamera?: ThreePresentationCamera
  /** Default true. False is for frameworks that attach the root themselves;
   * authored runtime reflection capture then requires supplied probe textures. */
  addToScene?: boolean
  /** Default true for installThreeCompiledScene() and the legacy immediate
   * loaded seam. Detached preparation defaults false unless explicitly true:
   * framework adapters already own renderer sizing while Blendlink still
   * updates its authored camera and post-processing targets. */
  resizeRenderer?: boolean
  /** Override the material-programs transport (tests, custom hosting).
   * The default fetches descriptor.materialPrograms.url with byte-count
   * and hash verification; programs apply only on the WebGPU family. */
  loadMaterialPrograms?: () => Promise<
    import('./tslMaterialRuntime.js').MaterialProgramsDocument
  >
  /** Authored probes capture automatically by default. Supply textures or a
   * custom capture/assignment adapter to replace that standard WebGL route. */
  reflectionProbes?: ApplyReflectionProbesOptions<ReflectionProbeObjectLike>
  captureReflectionProbes?: boolean
  /** Explicit opt-in: preserve the existing conservative instance policy. */
  instantiateEligibleMeshes?: boolean
  /** Explicit application adapters for portable components outside Blendlink's
   * core artist-facing library. Enabled unknown components fail loudly unless
   * they are listed here. */
  componentAdapters?: ThreeComponentAdapterRegistry
  /** Route component navigation through the host application (analytics,
   * router, embedded preview policy) instead of relying on window.open(). */
  openComponentUrl?(url: string, target: string): unknown
  /** Reuse a site-owned audio loader when components publish audio sources. */
  componentAudioLoader?: Pick<THREE.AudioLoader, 'loadAsync'>
  /** Resolve authenticated/application-cached, application-owned 3D LUT assets. */
  loadComponentLut?(url: string): Promise<THREE.Data3DTexture>
  /** Advanced application input/accessibility adapters. Omit to use the
   * package-owned single-raycast Canvas host and ready-handle controls. */
  componentInteraction?: InteractionService<THREE.Object3D | THREE.Scene>
  componentAccessibility?: AccessibilityService<THREE.Object3D | THREE.Scene>
  /** Demand-mode host invalidation. Blendlink calls it when semantic input
   * starts a bounded animation or hover transition. */
  requestFrame?(): unknown
  /** Preview Studio opt-in. Uses Blender authoring evidence only where the
   * published recipe deliberately leaves presentation application-owned. */
  useAuthoringPreview?: boolean
  /** Default true: upload known textures and compile reachable shaders after
   * all scene policies and components are installed. */
  prewarm?: boolean
  /** Anisotropic filtering for material-bound, mipmapped glTF textures.
   * The one-call installer defaults private loaded resources to Needle's
   * balanced value `4`. Already-loaded/cache-owning seams default to
   * "authored"; opt in there explicitly and Blendlink will coordinate and
   * restore its shared-resource lease. A number is clamped to renderer
   * capability; "renderer-max" is an explicit quality opt-in. */
  textureAnisotropy?: ThreeTextureAnisotropy
  onWarning?(message: string): unknown
  /** Attempt-scoped item/preparation facts. Item totals may grow while Three
   * discovers dependencies and are not a byte percentage. */
  onProgress?(progress: ThreeSceneInstallationProgress): unknown
}

export type ThreeSceneInstallationProgress = Readonly<{
  phase: 'loading' | 'preparing'
  item?: string
  itemsLoaded: number
  itemsTotal: number
}>

export interface ThreeCompiledSceneInstallationTask {
  readonly promise: Promise<InstalledThreeCompiledScene>
  /** Idempotently abandon the attempt. This always prevents a ready result;
   * immediate work cancellation remains limited to requests actually owned by
   * manager-abortable loaders. */
  cancel(): void
}

export interface ThreeCompiledScenePreparationTask {
  readonly promise: Promise<PreparedThreeCompiledScene>
  /** Idempotently abandon loading/preparation. Non-abortable decoder/compiler
   * work remains generation-gated and keeps its detached resources until that
   * work actually settles. */
  cancel(): void
}

export interface ThreeCompiledSceneCommitHost {
  /** Synchronously install host-owned camera/render state. The returned lease
   * is rolled back before Blendlink releases prepared scene resources. */
  activate?(
    scene: InstalledThreeCompiledScene,
  ): { dispose(): void } | void
  /** Called once only after the full scene transaction commits. */
  requestFrame?(): unknown
}

/** A renderer-capability-specific scene candidate whose asynchronous work is
 * complete while application presentation-owned Scene/renderer policy remains
 * unchanged. Preparation may populate renderer-internal shader/texture caches;
 * it is not a GPU fence and does not claim the first frame cannot compile. */
export interface PreparedThreeCompiledScene {
  readonly generation: number
  readonly state: PreparedSceneInstallationState
  readonly takesRenderOwnership: boolean
  commit(host?: ThreeCompiledSceneCommitHost): InstalledThreeCompiledScene
  dispose(): void
}

interface LoadedThreeCompiledSceneInstallationMode {
  /** Bindings prepared by the detached transaction. The inner installation
   * borrows them and must not dispose them independently. */
  bindings?: SceneBindings<THREE.Object3D>
  /** Delay controls, component lifecycle hooks, and renderer presentation
   * ownership until the outer transaction's synchronous commit. */
  deferActivation?: boolean
  /** The detached transaction sizes camera/composer resources explicitly but
   * leaves application-owned camera/renderer presentation untouched. */
  deferInitialResize?: boolean
  /** Artist-owned tone mapping used to plan the detached post stack without
   * reading the application's current renderer state as authored intent. */
  presentationToneMapping?: THREE.ToneMapping
}

export interface InstalledThreeCompiledScene {
  loaded: GLTF
  root: THREE.Object3D
  bindings: SceneBindings<THREE.Object3D>
  camera: ThreePresentationCamera
  baked: ThreeBakedSceneHandle | null
  playback: CompiledScenePlayback | null
  /** Stable application-facing subset of playback; renderer/mixer ownership
   * remains inside the installed scene. */
  readonly animation: CompiledSceneAnimationTransport | null
  cameraController: CompiledSceneCamera<THREE.Object3D> | null
  look: CompiledSceneLook
  fog: CompiledSceneFog | null
  shadows: CompiledSceneShadowReport
  environment: CompiledSceneEnvironment
  reflectionProbes: CompiledReflectionProbes | null
  /** Optional authored Three Rect Area lowering. These direct lights are
   * shadowless and affect live Standard/Physical receivers. Counts cover
   * unique visible materials under this compiled root only; like every Three
   * scene light, the installed lights can also illuminate eligible application
   * siblings. Keep Blendlink's one-compiled-scene-per-Canvas ownership rule. */
  rectAreaLights: ThreeRectAreaLightReport
  /** Inspectable sampling decision for imported material textures. */
  textureSampling: ThreeTextureSamplingReport
  /** Phase 4 TSL program application report; null off the WebGPU family
   * or when the scene ships no materialPrograms pointer. */
  tslMaterials: {
    materials: number
    applied: number
    skipped: readonly { material: string; channel?: string; reason: string }[]
  } | null
  lods: CompiledSceneLods | null
  instances: CompiledSceneInstances | null
  components: InstalledThreeComponents
  /** Convenience projection of Components' named live-pixel receivers. */
  websiteSurfaces: InstalledThreeComponents['websiteSurfaces']
  /** Conservative live signal. False means Blendlink can prove its installed
   * systems are idle; unknown/custom imperative work remains true. */
  readonly requiresContinuousFrames: boolean
  /** The only per-frame call required by authored animation, controls, and LODs. */
  update(deltaSeconds: number): void
  /** The one render-loop call. It selects the artist-authored post-processing
   * chain when components require it, otherwise calls renderer.render(). */
  render(deltaSeconds?: number): void
  /** Resize the renderer and camera projection without silently reframing an
   * artist-authored composition. Explicit camera fit remains caller-controlled. */
  resize(width: number, height: number): void
  setState(name: string): boolean
  setStateAsync(name: string): Promise<boolean>
  setLightGroup(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): boolean
  setLightGroupAsync(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): Promise<boolean>
  dispose(): void
}

function applicationAnimationTransport(
  playback: CompiledScenePlayback,
): CompiledSceneAnimationTransport {
  // Do not return the playback object with a narrower TypeScript annotation:
  // JavaScript callers would still receive mixer/actions/update/dispose.
  // This facade makes the ownership boundary true at runtime as well as in
  // declarations while preserving live getter state and terminal errors.
  return Object.freeze({
    get availableClips() { return playback.availableClips },
    get state() { return playback.state },
    get requiresContinuousFrames() { return playback.requiresContinuousFrames },
    play(clip?: string) { playback.play(clip) },
    playAll() { playback.playAll() },
    pause() { playback.pause() },
    seek(timeSeconds: number) { playback.seek(timeSeconds) },
    stop() { playback.stop() },
    subscribe(listener: Parameters<CompiledSceneAnimationTransport['subscribe']>[0]) {
      return playback.subscribe(listener)
    },
  })
}

interface LoadedWithBindings extends GLTF {
  blendlink?: SceneBindings<THREE.Object3D>
}

export const BLENDLINK_KTX2_TRANSCODER_DIRECTORY = 'blendlink-basis'

/** URL contract shared with internal `blendlink compile` publication. Query/hash
 * cache keys belong to the GLB. A declared runtime graph owns the transcoder
 * at its graph root even when the GLB itself is nested; legacy/external
 * descriptors without a graph retain the sibling convention. */
export function threeKtx2TranscoderPath(
  sceneUrl: string,
  descriptor?: CompiledSceneDescriptor,
): string {
  if (descriptor?.runtimeAssetGraph) {
    const root = runtimeAssetGraphRoot(descriptor)
    const serializedRoot = /^https?:\/\//i.test(sceneUrl)
      ? root.href
      : sceneUrl.startsWith('/')
        ? root.pathname
        : root.pathname.replace(/^\/+/, '')
    return `${serializedRoot}${BLENDLINK_KTX2_TRANSCODER_DIRECTORY}/`
  }
  const suffixIndex = [sceneUrl.indexOf('?'), sceneUrl.indexOf('#')]
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), sceneUrl.length)
  const assetPath = sceneUrl.slice(0, suffixIndex)
  const slash = assetPath.lastIndexOf('/')
  const filename = assetPath.slice(slash + 1)
  if (!filename) {
    throw new Error(
      `Blendlink cannot derive a KTX2 transcoder URL from scene URL "${sceneUrl}". ` +
        'Use a URL ending in the generated .glb file or supply an application-configured ktx2Loader.',
    )
  }
  return `${assetPath.slice(0, slash + 1)}${BLENDLINK_KTX2_TRANSCODER_DIRECTORY}/`
}

function visibilitySafeAdapterDescriptor(
  descriptor: CompiledSceneDescriptor,
): CompiledSceneDescriptor {
  const memberships = Object.values(descriptor.stateVisibility ?? {})
  if (memberships.length === 0) return descriptor
  const diagnostics = resolveRuntimeSceneDiagnostics(descriptor)
  if (!diagnostics) return descriptor
  const controlledIds = new Set(memberships.flatMap((entry) => [...entry.hiddenObjectIds]))
  const controlledNames = new Set<string>()
  for (const membership of memberships) {
    for (const name of membership.hiddenObjectNames) {
      controlledNames.add(name)
      controlledNames.add(name.replace(/\s/g, '_').replace(/[\[\]%$.:/]/g, ''))
    }
  }
  const controlled = (entry: { id?: string; name?: string; loadedName?: string }): boolean =>
    (entry.id !== undefined && controlledIds.has(entry.id))
    || (entry.name !== undefined && controlledNames.has(entry.name))
    || (entry.loadedName !== undefined && controlledNames.has(entry.loadedName))
  const chains = diagnostics.lodChains.filter(
    (chain) => !chain.levels.some((level) => controlled({
      ...(level.id ? { id: level.id } : {}),
      name: level.node,
      loadedName: level.loadedName,
    })),
  )
  const groups = diagnostics.instanceGroups.filter(
    (group) => !group.members.some((member) => controlled(member)),
  )
  if (chains.length === diagnostics.lodChains.length &&
      groups.length === diagnostics.instanceGroups.length) return descriptor
  // State composition owns these objects' visibility. InstancedMesh has no
  // per-instance visibility, and LOD update owns Object3D.visible outright,
  // so overlapping adapters are conservatively omitted rather than allowed
  // to re-show an artist-hidden state member.
  return {
    ...descriptor,
    runtimeDiagnostics: {
      ...diagnostics,
      lodChains: chains,
      instanceGroups: groups,
    },
  }
}

interface ResolvedAuthoringPreview {
  descriptor: CompiledSceneDescriptor
  defaultMeshShadows: boolean
  /** Blender Standard applies exposure before its display transform. Three's
   * NoToneMapping skips the exposure uniform entirely, while LinearToneMapping
   * performs the matching exposure-and-clamp operation. This substitution is
   * kept inside the preview seam so a published `none` recipe remains literal. */
  useLinearToneMapping: boolean
  world: ResolvedAuthoringPreviewWorld | null
  warnings: readonly string[]
}

interface ResolvedAuthoringPreviewWorld {
  color: readonly [number, number, number]
  strength: number
  useBackground: boolean
  useLighting: boolean
}

interface InstalledAuthoringPreviewWorld {
  dispose(): void
}

interface PreviewMeshShadowInstallation {
  mesh: THREE.Mesh
  key: 'castShadow' | 'receiveShadow'
  previous: boolean
}

/** Resolve the preview-only policy once at the high-level installation seam.
 * Every downstream adapter continues to consume the ordinary descriptor
 * contract, and explicit published ownership always wins. */
function resolveAuthoringPreview(
  descriptor: CompiledSceneDescriptor,
  enabled: boolean,
): ResolvedAuthoringPreview {
  const preview = descriptor.authoringPreview
  if (!enabled || !preview) {
    return {
      descriptor,
      defaultMeshShadows: false,
      useLinearToneMapping: false,
      world: null,
      warnings: [],
    }
  }

  const publishedLook = descriptor.look
  const useLook = !publishedLook || publishedLook.toneMapping === 'application'
  const publishedShadows = descriptor.shadows
  const useShadows = preview.shadows.enabled
    && (!publishedShadows || publishedShadows.preset === 'application')
  const publishedEnvironment = descriptor.environment
  const sourceOwnsWorldBackground = preview.worldBackgroundVisible !== false
    && (!publishedLook || publishedLook.background === 'application')
    && (!publishedEnvironment || publishedEnvironment.background === 'application')
  const sourceOwnsWorldLighting = (!publishedEnvironment || (
      publishedEnvironment.source === 'application'
      && publishedEnvironment.lighting === 'application'
    ))
  const useWorldBackground = !!preview.world && sourceOwnsWorldBackground
    && preview.world.backgroundVisible !== false
  const useWorldLighting = !!preview.world && sourceOwnsWorldLighting
  const world = preview.world && (useWorldBackground || useWorldLighting)
    ? {
        color: preview.world.color,
        strength: preview.world.strength,
        useBackground: useWorldBackground,
        useLighting: useWorldLighting,
      }
    : null
  const needsWorldWarning = !!preview.worldWarning
    && (sourceOwnsWorldBackground || sourceOwnsWorldLighting)
  if (!useLook && !useShadows && !world && !needsWorldWarning) {
    return {
      descriptor,
      defaultMeshShadows: false,
      useLinearToneMapping: false,
      world: null,
      warnings: [],
    }
  }

  const standardExposure = useLook
    && preview.look.toneMapping === 'none'
    && preview.look.exposure !== 0
    && preview.look.sourceViewTransform.trim().toLowerCase() === 'standard'
  const warnings = useLook ? [...(preview.warnings ?? [])] : []
  if (needsWorldWarning) warnings.push(preview.worldWarning!)
  if (useLook
      && preview.look.toneMapping === 'none'
      && preview.look.exposure !== 0
      && !standardExposure) {
    warnings.push(
      `Blender ${preview.look.sourceViewTransform || 'No Tone Mapping'} exposure cannot be ` +
        'represented by Three.js NoToneMapping; the exposure value is retained as evidence but ' +
        'does not affect this preview.',
    )
  }

  return {
    descriptor: {
      ...descriptor,
      ...(useLook
        ? {
            look: {
              ...(publishedLook ?? DEFAULT_SCENE_RECIPE.look),
              toneMapping: preview.look.toneMapping,
              // Keep Blender's authored exposure intact in the evidence. Any
              // measured native-transform correction belongs only to this
              // explicitly opted-in Preview Studio seam.
              exposure: preview.look.exposure
                + (preview.look.previewExposureOffsetStops ?? 0),
            },
          }
        : {}),
      ...(useShadows
        ? {
            shadows: {
              ...(publishedShadows ?? DEFAULT_SCENE_RECIPE.shadows),
              preset: 'custom' as const,
            },
          }
        : {}),
    },
    defaultMeshShadows: useShadows,
    useLinearToneMapping: standardExposure,
    world,
    warnings,
  }
}

/** Install a constant Blender World only for Preview Studio ownership gaps.
 * The small scene-linear HDR equirectangular texture is shared by background
 * and environment. Unlike Scene.background=Color it passes through Three's
 * tone mapping/exposure path, and unlike AmbientLight it participates in the
 * PBR environment BRDF (including roughness-dependent specular). 64x32 keeps
 * the PMREM cube size at 16, Three's minimum supported LOD, while costing only
 * 32 KiB before the renderer creates its cached GPU derivatives. */
function installAuthoringPreviewWorld(
  scene: THREE.Scene,
  world: ResolvedAuthoringPreviewWorld | null,
): InstalledAuthoringPreviewWorld {
  if (!world) return { dispose() {} }
  if (!Number.isFinite(world.strength) || world.strength < 0
      || world.color.some((channel) => !Number.isFinite(channel) || channel < 0)) {
    throw new Error(
      'Blender authoringPreview.world needs finite, non-negative linear RGB channels and strength.',
    )
  }

  const previousBackground = scene.background
  const previousEnvironment = scene.environment
  const previousBackgroundIntensity = scene.backgroundIntensity
  const previousEnvironmentIntensity = scene.environmentIntensity
  const width = 64
  const height = 32
  const data = new Float32Array(width * height * 4)
  const red = world.color[0] * world.strength
  const green = world.color[1] * world.strength
  const blue = world.color[2] * world.strength
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = red
    data[offset + 1] = green
    data[offset + 2] = blue
    data[offset + 3] = 1
  }
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  )
  texture.name = 'Blendlink Preview World'
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  try {
    if (world.useBackground) {
      scene.background = texture
      scene.backgroundIntensity = 1
    }
    if (world.useLighting) {
      scene.environment = texture
      scene.environmentIntensity = 1
    }
  } catch (error) {
    if (world.useBackground && scene.background === texture) {
      scene.background = previousBackground
    }
    if (world.useBackground && scene.backgroundIntensity === 1) {
      scene.backgroundIntensity = previousBackgroundIntensity
    }
    if (world.useLighting && scene.environment === texture) {
      scene.environment = previousEnvironment
    }
    if (world.useLighting && scene.environmentIntensity === 1) {
      scene.environmentIntensity = previousEnvironmentIntensity
    }
    texture.dispose()
    throw error
  }

  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      // Identity checks preserve a background or environment claimed by a later
      // application owner instead of restoring stale preview state over it.
      const ownsBackground = world.useBackground
        && scene.background === texture
        && scene.backgroundIntensity === 1
      const ownsEnvironment = world.useLighting
        && scene.environment === texture
        && scene.environmentIntensity === 1
      if (ownsBackground) {
        scene.background = previousBackground
        scene.backgroundIntensity = previousBackgroundIntensity
      }
      if (ownsEnvironment) {
        scene.environment = previousEnvironment
        scene.environmentIntensity = previousEnvironmentIntensity
      }
      if (scene.background !== texture && scene.environment !== texture) texture.dispose()
    },
  }
}

/** Preview-only authoring convenience. glTF has no standard mesh shadow
 * flags, so Three defaults both off; Blender artists reasonably expect their
 * untagged render meshes to participate when source shadows are enabled.
 * Namespaced object overrides remain authoritative, and disposal never
 * clobbers a later owner. */
function defaultAuthoringPreviewMeshShadows(
  root: THREE.Object3D,
  descriptor: CompiledSceneDescriptor,
  bindings: SceneBindings<THREE.Object3D>,
  enabled: boolean,
): { dispose(): void } {
  if (!enabled) return { dispose() {} }

  // `SceneBindings.shadowIntent` was added after the cached-binding seam was
  // public. Preserve older/manual bindings without losing multi-primitive
  // intent: reconstruct the same boundary-aware map from descriptor evidence.
  let compatibilityIntents: Map<Object3DLike, {
    cast?: boolean
    receive?: boolean
  }> | null = null
  if (!bindings.shadowIntent) {
    const authoredObjects = new Set<Object3DLike>([
      ...Object.values(bindings.byName),
      ...Object.values(bindings.byId),
    ])
    const explicitIntents = new Map<Object3DLike, {
      cast?: boolean
      receive?: boolean
    }>()
    for (const [name, extras] of Object.entries(descriptor.extras ?? {})) {
      const alias = Object.entries(descriptor.nodes).find(
        ([, loadedName]) => loadedName === name,
      )?.[0]
      const id = descriptor.nodeIds?.[name]
        ?? (alias ? descriptor.nodeIds?.[alias] : undefined)
      const object = (id ? bindings.byId[id] : undefined)
        ?? bindings.byName[name]
        ?? (alias ? bindings.byName[alias] : undefined)
      if (!object) continue
      authoredObjects.add(object)
      const cast = typeof extras.blendlink_cast_shadow === 'boolean'
        ? extras.blendlink_cast_shadow
        : undefined
      const receive = typeof extras.blendlink_receive_shadow === 'boolean'
        ? extras.blendlink_receive_shadow
        : undefined
      if (cast !== undefined || receive !== undefined) {
        explicitIntents.set(object, { cast, receive })
      }
    }
    compatibilityIntents = resolveCompiledSceneShadowIntents(
      root, authoredObjects, explicitIntents,
    )
  }

  const installations: PreviewMeshShadowInstallation[] = []
  const install = (mesh: THREE.Mesh, key: 'castShadow' | 'receiveShadow'): void => {
    installations.push({ mesh, key, previous: mesh[key] })
    mesh[key] = true
  }
  const rollback = (conditional: boolean): unknown[] => {
    const errors: unknown[] = []
    for (const installation of installations.slice().reverse()) {
      try {
        if (!conditional || installation.mesh[installation.key] === true) {
          installation.mesh[installation.key] = installation.previous
        }
      } catch (error) {
        errors.push(error)
      }
    }
    return errors
  }

  try {
    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return
      const mesh = object as THREE.Mesh
      const intent = bindings.shadowIntent?.(mesh) ?? compatibilityIntents?.get(mesh)
      if (typeof intent?.cast !== 'boolean') {
        install(mesh, 'castShadow')
      }
      if (typeof intent?.receive !== 'boolean') {
        install(mesh, 'receiveShadow')
      }
    })
  } catch (error) {
    const rollbackErrors = rollback(false)
    throw new Error(
      `Could not default Preview Studio mesh shadows: ${errorMessage(error)}` +
        (rollbackErrors.length > 0
          ? `. Rollback also failed: ${rollbackErrors.map(errorMessage).join('; ')}`
          : ''),
    )
  }

  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      const errors = rollback(true)
      if (errors.length > 0) {
        throw new Error(
          `Could not fully dispose Preview Studio mesh shadows: ${errors.map(errorMessage).join('; ')}`,
        )
      }
    },
  }
}

function authoringPreviewShadowRoot(
  root: THREE.Object3D,
  enabled: boolean,
): Object3DLike {
  if (!enabled) return root
  return {
    name: root.name,
    traverse(visitor) {
      root.traverse((object) => {
        const light = object as THREE.Object3D & { shadow?: unknown }
        if (light.shadow && object.userData.blendlink_cast_shadow === false) return
        visitor(object)
      })
    },
  }
}

interface PmremGeneratorLike {
  compileEquirectangularShader(): unknown
  fromEquirectangular(texture: THREE.Texture): { texture: THREE.Texture; dispose(): void }
  dispose(): void
}

/** Both renderer families expose the same PMREM API; the WebGPU class loads
 * lazily so WebGL-only applications never bundle three/webgpu. */
async function createPmremGenerator(
  renderer: THREE.WebGLRenderer,
): Promise<PmremGeneratorLike> {
  if ((renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer) {
    const { PMREMGenerator } = await import('three/webgpu')
    return new PMREMGenerator(
      renderer as never,
    ) as unknown as PmremGeneratorLike
  }
  return new THREE.PMREMGenerator(renderer) as unknown as PmremGeneratorLike
}

function createThreePublishedReflectionLoader(
  renderer: THREE.WebGLRenderer,
  manager: THREE.LoadingManager,
) {
  const hdrLoader = new HDRLoader(manager)
  const exrLoader = new EXRLoader(manager)
  const textureLoader = new THREE.TextureLoader(manager)
  return async (
    asset: ReflectionProbePublishedAsset,
    context: ReflectionProbeRuntimeContext<ReflectionProbeObjectLike>,
  ): Promise<ReflectionProbeTextureResource> => {
    let source: THREE.Texture | null = null
    let target: { texture: THREE.Texture; dispose(): void } | null = null
    const generator = await createPmremGenerator(renderer)
    try {
      source = asset.format === 'hdr'
        ? await hdrLoader.loadAsync(asset.url)
        : asset.format === 'exr'
          ? await exrLoader.loadAsync(asset.url)
          : await textureLoader.loadAsync(asset.url)
      const image = source.image as { width?: number; height?: number } | undefined
      if (image?.width !== undefined && image.height !== undefined &&
          (image.width !== asset.width || image.height !== asset.height)) {
        throw new Error(
          `Reflection probe "${context.definition.name}" decoded ${image.width}x${image.height}; ` +
            `the manifest declares ${asset.width}x${asset.height}. Re-run blendlink compile.`,
        )
      }
      source.mapping = THREE.EquirectangularReflectionMapping
      source.colorSpace = asset.colorSpace === 'srgb'
        ? THREE.SRGBColorSpace
        : THREE.LinearSRGBColorSpace
      // The WebGPU generator's compile is async; awaiting is a no-op for the
      // synchronous WebGL generator.
      await generator.compileEquirectangularShader()
      target = generator.fromEquirectangular(source)
      if (!target.texture) {
        throw new Error(`Reflection probe "${context.definition.name}" produced no PMREM texture.`)
      }
      const owned = target
      target = null
      return { texture: owned.texture, dispose: () => owned.dispose() }
    } catch (error) {
      target?.dispose()
      throw new Error(
        `Could not load published reflection texture for "${context.definition.name}" ` +
          `from ${asset.url}: ${errorMessage(error)}`,
      )
    } finally {
      source?.dispose()
      generator.dispose()
    }
  }
}

function installationAbortError(cause?: unknown): Error {
  const error = new Error(
    'Blendlink scene installation was canceled.',
    cause === undefined ? undefined : { cause },
  )
  error.name = 'AbortError'
  return error
}

function throwIfInstallationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw installationAbortError()
}

function threeCompiledSceneLookOptions(
  resolvedPreview: Pick<ResolvedAuthoringPreview, 'useLinearToneMapping'>,
): CompiledSceneLookOptions {
  return {
    toneMappings: {
      agx: THREE.AgXToneMapping,
      neutral: THREE.NeutralToneMapping,
      aces: THREE.ACESFilmicToneMapping,
      none: resolvedPreview.useLinearToneMapping
        ? THREE.LinearToneMapping
        : THREE.NoToneMapping,
    },
    createColor: ([r, g, b]) => new THREE.Color().setRGB(r, g, b),
  }
}

function plannedThreeToneMapping(
  descriptor: CompiledSceneDescriptor,
  resolvedPreview: Pick<ResolvedAuthoringPreview, 'useLinearToneMapping'>,
): THREE.ToneMapping | undefined {
  const intent = descriptor.look?.toneMapping
  if (!intent || intent === 'application') return undefined
  return threeCompiledSceneLookOptions(resolvedPreview).toneMappings?.[intent] as
    | THREE.ToneMapping
    | undefined
}

function warnThreeInstallation(
  options: Pick<InstallThreeCompiledSceneOptions, 'onWarning'>,
  message: string,
): void {
  if (options.onWarning) options.onWarning(message)
  else console.warn(message)
}

function createThreeGroundedBackground(
  root: THREE.Object3D,
  options: Pick<InstallThreeCompiledSceneOptions, 'onWarning'>,
  texture: unknown,
  settings: {
    height: number
    radius: number
    intensity: number
    rotation: number
    blur: number
  },
): THREE.Object3D {
  const ground = new GroundedSkybox(
    texture as THREE.Texture,
    settings.height,
    settings.radius,
  )
  if (!fitGroundedBackgroundToCompiledRoot(ground, root, settings.height)) {
    ground.position.y = settings.height
    warnThreeInstallation(
      options,
      'Grounded Backdrop could not auto-fit because the compiled scene has no finite visible mesh bounds; ' +
        'the authored world origin remains the projection center.',
    )
  }
  ground.rotation.y = settings.rotation
  ground.material.color.setScalar(settings.intensity)
  if (settings.blur > 0) {
    warnThreeInstallation(
      options,
      'Three.js backgroundBlurriness applies only to Scene.background environment maps; ' +
        'GroundedSkybox is scene geometry, so grounded background blur cannot be represented and was ignored.',
    )
  }
  return ground
}

function disposeThreeGroundedBackground(value: unknown): void {
  const ground = value as THREE.Mesh
  ground.geometry?.dispose()
  const materials = Array.isArray(ground.material) ? ground.material : [ground.material]
  materials.forEach((material) => material?.dispose())
}

function threeCompiledSceneEnvironmentOptions(
  root: THREE.Object3D,
  manager: THREE.LoadingManager,
  options: InstallThreeCompiledSceneOptions,
): CompiledSceneEnvironmentOptions {
  return {
    loaders: {
      hdr: new HDRLoader(manager),
      exr: new EXRLoader(manager),
      ...(options.ktx2Loader ? { ktx2: options.ktx2Loader } : {}),
    },
    linearFilter: THREE.LinearFilter,
    equirectangularReflectionMapping: THREE.EquirectangularReflectionMapping,
    onWarning: options.onWarning,
    createGroundedBackground: (texture, settings) =>
      createThreeGroundedBackground(root, options, texture, settings),
    disposeGroundedBackground: disposeThreeGroundedBackground,
  }
}

function presentationNeutralDescriptor(
  descriptor: CompiledSceneDescriptor,
): CompiledSceneDescriptor {
  return {
    ...descriptor,
    authoringPreview: null,
    look: descriptor.look
      ? { ...descriptor.look, toneMapping: 'application', background: 'application' }
      : null,
    environment: descriptor.environment
      ? {
          ...descriptor.environment,
          source: 'application',
          lighting: 'application',
          background: 'application',
        }
      : null,
    fog: descriptor.fog ? { ...descriptor.fog, mode: 'application' } : null,
    shadows: descriptor.shadows
      ? { ...descriptor.shadows, preset: 'application' }
      : null,
  }
}

interface DetachedEnvironmentPreview {
  dispose(): void
}

/** Borrow a prepared environment's texture/ground for detached probe capture
 * and shader preparation. Resource lifetime remains exclusively with the
 * target-specific prepared environment lease. */
function installDetachedEnvironmentPreview(
  scene: THREE.Scene,
  descriptor: CompiledSceneDescriptor,
  environment: {
    texture: unknown | null
    groundedBackground: unknown | null
  },
): DetachedEnvironmentPreview {
  const recipe = descriptor.environment
  if (!recipe) return { dispose() {} }
  const before = {
    environment: scene.environment,
    environmentIntensity: scene.environmentIntensity,
    environmentRotation: scene.environmentRotation.toArray(),
    background: scene.background,
    backgroundIntensity: scene.backgroundIntensity,
    backgroundRotation: scene.backgroundRotation.toArray(),
    backgroundBlurriness: scene.backgroundBlurriness,
  }
  const ground = environment.groundedBackground as THREE.Object3D | null
  let groundAdded = false
  let disposed = false
  const restore = (): void => {
    if (disposed) return
    disposed = true
    if (groundAdded && ground?.parent === scene) scene.remove(ground)
    scene.environment = before.environment
    scene.environmentIntensity = before.environmentIntensity
    scene.environmentRotation.fromArray(before.environmentRotation)
    scene.background = before.background
    scene.backgroundIntensity = before.backgroundIntensity
    scene.backgroundRotation.fromArray(before.backgroundRotation)
    scene.backgroundBlurriness = before.backgroundBlurriness
  }
  try {
    const yRadians = (degrees: number) => degrees * Math.PI / 180
    if (recipe.lighting === 'none') scene.environment = null
    else if (recipe.lighting === 'image') {
      scene.environment = environment.texture as THREE.Texture
      scene.environmentIntensity = recipe.lightingIntensity
      scene.environmentRotation.set(0, yRadians(recipe.lightingRotation), 0)
    }
    if (recipe.background === 'none') scene.background = null
    else if (recipe.background === 'image') {
      scene.background = environment.texture as THREE.Texture
      scene.backgroundIntensity = recipe.backgroundIntensity
      scene.backgroundBlurriness = recipe.backgroundBlur
      scene.backgroundRotation.set(0, yRadians(recipe.backgroundRotation), 0)
    } else if (recipe.background === 'grounded') {
      scene.background = null
      scene.add(ground!)
      groundAdded = true
    }
  } catch (error) {
    restore()
    throw error
  }
  return { dispose: restore }
}

function installDetachedLookPreview(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  descriptor: CompiledSceneDescriptor,
  resolvedPreview: Pick<ResolvedAuthoringPreview, 'useLinearToneMapping'>,
): CompiledSceneLook {
  let clearAlpha = renderer.getClearAlpha()
  // WebGPURenderer has no getContextAttributes(); omit the member entirely
  // and forward its public alpha flag so the look layer verifies surface
  // transparency through the branch that matches this renderer family.
  const rendererAlpha = (renderer as THREE.WebGLRenderer & { alpha?: boolean }).alpha
  const contextAttributes = typeof renderer.getContextAttributes === 'function'
    ? { getContextAttributes: () => renderer.getContextAttributes() }
    : typeof rendererAlpha === 'boolean' ? { alpha: rendererAlpha } : {}
  return applyCompiledSceneLook(
    {
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
      setClearAlpha(value) { clearAlpha = value },
      getClearAlpha() { return clearAlpha },
      ...contextAttributes,
    },
    scene,
    descriptor,
    threeCompiledSceneLookOptions(resolvedPreview),
  )
}

function validatePreparedGroundedCamera(
  camera: ThreePresentationCamera,
  cameraSource: 'Blender-authored' | 'application-owned' | 'package-created',
  ground: unknown | null,
  descriptor: CompiledSceneDescriptor,
): void {
  const groundedRecipe = descriptor.environment?.background === 'grounded'
    ? descriptor.environment
    : null
  if (!ground || !groundedRecipe) return
  const safety = inspectThreeGroundedCameraSafety(
    camera as THREE.Camera & { far: number; updateProjectionMatrix(): void },
    ground as THREE.Mesh<THREE.BufferGeometry>,
    groundedRecipe.groundRadius,
  )
  if (!safety.cameraInsideRadius) {
    const action = cameraSource === 'application-owned'
      ? 'Increase environment.groundRadius or move the application camera inside the projection.'
      : 'Increase Ground Radius in Blender or move the presentation camera inside the projection.'
    throw new Error(
      `${cameraSource} camera is ${safety.cameraDistance.toFixed(3)} units from the Grounded ` +
        `Backdrop center, outside its ${safety.radius.toFixed(3)} radius. ${action}`,
    )
  }
  if (safety.currentFar >= safety.requiredFar) return
  if (cameraSource === 'package-created') {
    repairPackageGroundedCameraFar(
      camera as THREE.Camera & { far: number; updateProjectionMatrix(): void },
      safety,
    )
    return
  }
  const action = cameraSource === 'application-owned'
    ? 'Increase camera.far in the website or reduce environment.groundRadius.'
    : 'Raise the Blender camera Clip End or reduce Ground Radius.'
  throw new Error(
    `${cameraSource} camera far plane ${safety.currentFar.toFixed(3)} clips ` +
      `${safety.clippedVertexCount} Grounded Backdrop vertices; at least ` +
      `${safety.requiredFar.toFixed(3)} is required for this view. ${action}`,
  )
}

function disposePreparedActivation(
  components: InstalledThreeComponents,
  camera: CompiledSceneCamera<THREE.Object3D> | null,
): void {
  const errors: unknown[] = []
  try { components.dispose() } catch (error) { errors.push(error) }
  try { camera?.dispose() } catch (error) { errors.push(error) }
  if (errors.length > 0) {
    throw new Error(
      `Could not roll back activated Blendlink scene behavior: ${errors.map(errorMessage).join('; ')}`,
    )
  }
}

interface DeferredPreparationResources {
  readonly resource: { label: string; dispose(): void }
  own(label: string, dispose: () => void): void
  /** End the non-cooperative async critical section. If cancellation already
   * requested disposal, every accumulated resource is released now. */
  unlock(): void
}

/** LoadingManager.abort() cannot cancel every decoder/compiler task. Keep the
 * detached graph alive until the async factory has actually stopped touching
 * it, even when the coordinator invalidates the generation immediately. */
function createDeferredPreparationResources(): DeferredPreparationResources {
  const entries: Array<{ label: string; dispose(): void; disposed: boolean }> = []
  let locked = true
  let disposalRequested = false
  let released = false

  const release = (): void => {
    if (released || locked || !disposalRequested) return
    released = true
    const errors: string[] = []
    for (const entry of entries.slice().reverse()) {
      if (entry.disposed) continue
      entry.disposed = true
      try { entry.dispose() } catch (error) {
        errors.push(`${entry.label}: ${errorMessage(error)}`)
      }
    }
    if (errors.length > 0) {
      throw new Error(`Could not release detached Blendlink preparation: ${errors.join('; ')}`)
    }
  }

  return {
    resource: {
      label: 'detached Blendlink scene preparation',
      dispose() {
        disposalRequested = true
        release()
      },
    },
    own(label, dispose) {
      const entry = { label, dispose, disposed: false }
      entries.push(entry)
      if (released || (disposalRequested && !locked)) {
        entry.disposed = true
        dispose()
      }
    },
    unlock() {
      if (!locked) return
      locked = false
      release()
    },
  }
}

class Ktx2WorkerCspError extends Error {
  constructor(directive: string) {
    super(
      `Blendlink's KTX2 decoder worker was blocked by Content Security Policy (${directive}). ` +
        `Three's Basis transcoder uses a Blob worker; allow \`worker-src blob:\` for this route, ` +
        'or pass an application-configured ktx2Loader that obeys the website policy.',
    )
    this.name = 'Ktx2WorkerCspError'
  }
}

/** A package-owned request failed even though Three's GLTFLoader recovered.
 * GLTFLoader r184 intentionally converts external image failures into null
 * textures; Blendlink refuses to publish that visibly incomplete result. */
export class ThreeCompiledSceneDependencyError extends Error {
  readonly urls: readonly string[]

  constructor(urls: Iterable<string>) {
    const allUrls = Object.freeze([...new Set(urls)])
    const shown = allUrls.slice(0, 5).map((url) => `"${url}"`).join(', ')
    const omitted = allUrls.length > 5 ? ` (and ${allUrls.length - 5} more)` : ''
    super(
      `Blendlink refused to publish Ready because its private loader reported ` +
        `${allUrls.length === 1 ? 'a failed scene dependency' : 'failed scene dependencies'}: ` +
        `${shown}${omitted}. Three's GLTF loader can otherwise recover with missing textures. ` +
        'Verify that publish included every companion file, that the deployment base path or CDN ' +
        'mapping is correct, and that the response permits CORS. Requests needing application ' +
        'headers or credentials must use an application-configured loader that enforces its own failures.',
    )
    this.name = 'ThreeCompiledSceneDependencyError'
    this.urls = allUrls
  }
}

interface Ktx2WorkerCspWatch {
  failure: Promise<never>
  dispose(): void
}

/** Three r184's WorkerPool does not reject when CSP asynchronously blocks its
 * Blob worker, which would otherwise leave the GLTF load pending forever. The
 * watch is deliberately limited to an enforced Blob worker violation during
 * a package-owned KTX2 load; application-owned loaders keep policy ownership. */
export function watchForKtx2WorkerCspViolation(
  target: EventTarget | null = typeof globalThis.addEventListener === 'function'
    ? globalThis
    : null,
): Ktx2WorkerCspWatch | null {
  if (!target) return null
  let rejectFailure!: (error: Ktx2WorkerCspError) => void
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject })
  const onViolation = (rawEvent: Event): void => {
    const event = rawEvent as SecurityPolicyViolationEvent
    // Chromium reports `blob`, while other engines may expose the full
    // `blob:<origin>/<uuid>` URL.
    if (event.disposition !== 'enforce' ||
        (event.blockedURI !== 'blob' && !event.blockedURI.startsWith('blob:'))) return
    if (!['worker-src', 'child-src', 'script-src'].includes(event.effectiveDirective)) return
    rejectFailure(new Ktx2WorkerCspError(event.effectiveDirective))
  }
  target.addEventListener('securitypolicyviolation', onViolation)
  return {
    failure,
    dispose() { target.removeEventListener('securitypolicyviolation', onViolation) },
  }
}

/** Start one cancelable load plus detached preparation attempt. */
export function startThreeCompiledScenePreparation(
  options: InstallThreeCompiledSceneOptions,
): ThreeCompiledScenePreparationTask {
  const controller = new AbortController()
  const externalSignal = options.signal
  const relayAbort = (): void => controller.abort()
  if (externalSignal?.aborted) relayAbort()
  else externalSignal?.addEventListener('abort', relayAbort, { once: true })

  const promise = prepareThreeCompiledSceneAttempt({ ...options, signal: controller.signal })
    .then((prepared) => {
      if (!controller.signal.aborted) return prepared
      prepared.dispose()
      throw installationAbortError()
    }, (error) => {
      // Keep the long-standing one-call/task cancellation surface stable.
      // The lower-level prepared transaction retains its structured state and
      // cleanup evidence as this AbortError's cause.
      if (controller.signal.aborted) throw installationAbortError(error)
      throw error
    })
    .finally(() => externalSignal?.removeEventListener('abort', relayAbort))

  return {
    promise,
    cancel() { controller.abort() },
  }
}

/** Start one cancelable installation attempt. Cancellation guarantees that no
 * ready handle is published; Three/browser support determines which pending
 * network requests can be stopped immediately. */
export function startThreeCompiledSceneInstallation(
  options: InstallThreeCompiledSceneOptions,
): ThreeCompiledSceneInstallationTask {
  const preparation = startThreeCompiledScenePreparation({
    ...options,
    // Preserve the imperative installer's historical renderer-sizing
    // ownership. Prepared/framework callers must opt in explicitly.
    resizeRenderer: options.resizeRenderer ?? true,
  })
  return {
    promise: preparation.promise.then((prepared) => prepared.commit()),
    cancel: preparation.cancel,
  }
}

/** Load and completely install one standard Three WebGL scene. This is the
 * artist-friendly seam; lower-level helpers remain exported for applications
 * that deliberately own individual policies. */
export async function installThreeCompiledScene(
  options: InstallThreeCompiledSceneOptions,
): Promise<InstalledThreeCompiledScene> {
  return startThreeCompiledSceneInstallation(options).promise
}

async function prepareThreeCompiledSceneAttempt(
  options: InstallThreeCompiledSceneOptions,
): Promise<PreparedThreeCompiledScene> {
  assertCompiledSceneRenderer(options.renderer)
  throwIfInstallationAborted(options.signal)
  if (options.loadingManager && options.loader
      && options.loader.manager !== options.loadingManager) {
    throw new Error(
      'Blendlink received a GLTFLoader and a different loadingManager. Configure the loader ' +
        'with the same manager or let the application-owned loader retain loading ownership.',
    )
  }
  if (options.assetBaseUrl !== undefined
      && (options.loadingManager || options.loader || options.ktx2Loader)) {
    throw new Error(
      'Blendlink assetBaseUrl requires package-owned loaders so every compiler-owned request ' +
        'is rebased consistently. Configure URL policy on the application-owned loader/manager instead.',
    )
  }
  const ownsManager = !options.loadingManager && !options.loader
  const manager = options.loadingManager ?? options.loader?.manager ?? new THREE.LoadingManager()
  const needsKtx2 = options.descriptor.requiresKtx2 === true
    || options.descriptor.textureCompression?.format === 'ktx2'
    || options.descriptor.environmentAsset?.optimized?.format === 'ktx2'
  const needsMeshopt = options.descriptor.requiresMeshopt === true
    || options.descriptor.optimization?.geometry === 'meshopt'
  let ownedKtx2Loader: KTX2Loader | null = null
  let loaded: LoadedWithBindings | null = null
  let sceneLoad: Promise<LoadedWithBindings> | null = null
  let phase: ThreeSceneInstallationProgress['phase'] = 'loading'
  let itemsLoaded = 0
  let itemsTotal = 0
  let progressActive = true
  let dependencyErrorsActive = true
  const failedDependencies = new Set<string>()
  const report = (item?: string): void => {
    if (!progressActive || !options.onProgress) return
    try {
      options.onProgress({
        phase,
        ...(item ? { item } : {}),
        itemsLoaded,
        itemsTotal,
      })
    } catch (error) {
      console.error('Blendlink onProgress callback failed:', error)
    }
  }
  if (ownsManager) {
    manager.onStart = (url, loadedCount, totalCount) => {
      itemsLoaded = loadedCount
      itemsTotal = totalCount
      report(url)
    }
    manager.onProgress = (url, loadedCount, totalCount) => {
      itemsLoaded = loadedCount
      itemsTotal = totalCount
      report(url)
    }
    manager.onError = (url) => {
      if (dependencyErrorsActive) failedDependencies.add(url)
    }
    if (options.assetBaseUrl !== undefined) {
      const basisPrefix = threeKtx2TranscoderPath(
        options.descriptor.url,
        options.descriptor,
      )
      manager.setURLModifier(createCompiledAssetUrlModifier(
        options.descriptor,
        options.assetBaseUrl,
        [basisPrefix],
      ))
    }
  }
  const abortOwnedRequests = (): void => {
    if (!ownsManager) return
    try { manager.abort() } catch (error) {
      console.error('Blendlink could not abort its private loading manager:', error)
    }
  }
  options.signal?.addEventListener('abort', abortOwnedRequests, { once: true })
  const loader = options.loader ?? new GLTFLoader(manager)
  const suppliedLoader = options.loader
    ? loader as GLTFLoader & {
        ktx2Loader?: KTX2Loader | null
        meshoptDecoder?: NonNullable<MeshoptWorkerOptions['meshoptDecoder']> | null
      }
    : null
  const applicationKtx2Loader = suppliedLoader?.ktx2Loader ?? undefined
  const applicationMeshoptDecoder = suppliedLoader?.meshoptDecoder ?? undefined
  try {
    if (needsKtx2 && !options.ktx2Loader && !applicationKtx2Loader) {
      ownedKtx2Loader = createOwnedKtx2Loader(
        options.descriptor,
        legacyRendererView(options.renderer),
        manager,
      )
    }
    // Match Needle's application-loader contract: public decoder fields that
    // are already configured remain authoritative unless the paired explicit
    // Blendlink option replaces them. Treating an existing Meshopt decoder as
    // an explicit option also makes package worker knobs reject loudly instead
    // of silently taking over the application's worker lifecycle.
    const ktx2Loader = options.ktx2Loader
      ?? applicationKtx2Loader
      ?? ownedKtx2Loader
      ?? undefined
    const meshoptDecoder = options.meshoptDecoder ?? applicationMeshoptDecoder
    const loaderOptions = {
      ...(ktx2Loader ? { ktx2Loader } : {}),
      ...(options.meshoptWorkerCount !== undefined
        ? { meshoptWorkerCount: options.meshoptWorkerCount }
        : {}),
      ...(options.meshoptWorkerThresholdBytes !== undefined
        ? { meshoptWorkerThresholdBytes: options.meshoptWorkerThresholdBytes }
        : {}),
      ...(meshoptDecoder !== undefined ? { meshoptDecoder } : {}),
    }
    configureCompiledSceneLoader(loader, options.descriptor, loaderOptions)
    const cspWatch = ownedKtx2Loader ? watchForKtx2WorkerCspViolation() : null
    try {
      sceneLoad = needsMeshopt
        ? withMeshoptDecoderForLoad(
            loader,
            options.descriptor.meshoptDecodedBytes,
            loaderOptions,
            () => loader.loadAsync(options.descriptor.url),
          )
        : loader.loadAsync(options.descriptor.url)
      loaded = await (cspWatch
        ? Promise.race([sceneLoad, cspWatch.failure])
        : sceneLoad) as LoadedWithBindings
      throwIfInstallationAborted(options.signal)
      if (failedDependencies.size > 0) {
        throw new ThreeCompiledSceneDependencyError(failedDependencies)
      }
    } catch (error) {
      if (error instanceof Ktx2WorkerCspError) {
        // LoadingManager.abort() cannot cancel parse/transcode work that has
        // already escaped into Three r184's KTX2 WorkerPool. The outer cleanup
        // immediately disposes the package-owned KTX2Loader (terminating that
        // pool); this observer owns either settlement of the losing GLTF load.
        // A late graph is disposed, while a late rejection is deliberately
        // consumed so the actionable CSP failure remains the primary error.
        if (sceneLoad) observeLateKtx2CspSceneLoad(sceneLoad)
        abortOwnedRequests()
        throw error
      }
      if (error instanceof ThreeCompiledSceneDependencyError) throw error
      if (ownedKtx2Loader) {
        const path = threeKtx2TranscoderPath(
          options.descriptor.url,
          options.descriptor,
        )
        throw new Error(
          `Blendlink could not load the KTX2 scene. Its automatic transcoder URL is "${path}". ` +
            'Run `blendlink compile` and publish the generated blendlink-basis directory beside the GLB, ' +
            `or pass an application-configured ktx2Loader. ${errorMessage(error)}`,
        )
      }
      throw error
    } finally {
      cspWatch?.dispose()
    }
    const ownedTextureAnisotropy = options.textureAnisotropy ?? 4
    const effectiveOptions = ktx2Loader === options.ktx2Loader
      ? { ...options, textureAnisotropy: ownedTextureAnisotropy, loadingManager: manager }
      : {
          ...options,
          textureAnisotropy: ownedTextureAnisotropy,
          ktx2Loader,
          loadingManager: manager,
        }
    phase = 'preparing'
    report()
    return ownLoadedThreePreparedResources(
      await prepareLoadedThreeCompiledScene(loaded, effectiveOptions),
      loaded,
      ownedKtx2Loader,
    )
  } catch (error) {
    const disposalErrors = loaded ? disposeLoadedThreeResources(loaded) : []
    if (ownedKtx2Loader) {
      try { ownedKtx2Loader.dispose() } catch (disposeError) { disposalErrors.push(disposeError) }
    }
    if (disposalErrors.length > 0) {
      throw new Error(
        `Could not prepare the Blendlink scene: ${errorMessage(error)}. ` +
          `Loaded glTF cleanup also failed: ${disposalErrors.map(errorMessage).join('; ')}`,
      )
    }
    throw error
  } finally {
    // The private manager remains useful to generated recipes for optional
    // background quality promotion, but installation progress is attempt-
    // scoped and terminal once this promise settles. Late manager items must
    // not regress an R3F/application lifecycle from ready back to preparing.
    progressActive = false
    dependencyErrorsActive = false
    options.signal?.removeEventListener('abort', abortOwnedRequests)
  }
}

/** Install an already loaded GLTF. R3F and other cache-owning applications can
 * cross this seam without loading the asset a second time. */
export async function prepareLoadedThreeCompiledScene(
  loaded: LoadedWithBindings,
  options: InstallThreeCompiledSceneOptions,
): Promise<PreparedThreeCompiledScene> {
  assertCompiledSceneRenderer(options.renderer)
  throwIfInstallationAborted(options.signal)
  const runtimeCompatibility = loadedThreeRuntimeProfile(
    loaded.parser,
    options.gltfRuntimeCapabilities,
  )
  // The joint ceiling is a property of the renderer, not of the parser or the
  // artifact: the classic WebGLRenderer uploads bone matrices through a
  // texture and has no limit, while the node-material renderers (WebGPU and
  // its WebGL2 fallback alike) bind a uniform buffer that holds 1024. Deciding
  // it here is the only place both the artifact and the renderer are known.
  // An application that has measured its own ceiling can still state one.
  const nodeMaterialRenderer = Boolean(
    (options.renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer,
  )
  assertGltfRuntimeCompatibility(
    runtimeCompatibility.json,
    nodeMaterialRenderer &&
      options.gltfRuntimeCapabilities?.maxSkinJoints === undefined
      ? {
          ...runtimeCompatibility.profile,
          maxSkinJoints: THREE_NODE_MAX_SKIN_JOINTS,
        }
      : runtimeCompatibility.profile,
  )
  if (loaded.scene.parent) {
    throw new Error(
      `Atomic Blendlink preparation requires exclusive ownership of a detached GLTF root, ` +
        `but "${loaded.scene.name || 'the loaded scene'}" is already parented. ` +
        'Unmount its current owner or provide a separately owned clone before preparing it.',
    )
  }

  const enabledComponents = (options.descriptor.components ?? [])
    .filter((component) => component.enabled)
  if (enabledComponents.length > 0 &&
      (options.componentInteraction || options.componentAccessibility)) {
    throw new Error(
      'Atomic Blendlink preparation cannot use application-owned interaction/accessibility ' +
        'services until they expose deferred registration. Omit those services to use Blendlink\'s ' +
        'package-owned Canvas host, or install the scene imperatively with an explicitly staged adapter.',
    )
  }
  const customAdapterTypes = new Set(Object.keys(options.componentAdapters ?? {}))
  const activeCustomAdapters = enabledComponents
    .filter((component) => {
      const adapter = options.componentAdapters?.[component.type]
      return customAdapterTypes.has(component.type)
        && (!adapter || !isPreparationSafeThreeComponentAdapter(adapter))
    })
    .map((component) => component.type)
  if (activeCustomAdapters.length > 0) {
    throw new Error(
      'Atomic Blendlink preparation cannot prove that these application component adapters are ' +
        `staging-safe: ${[...new Set(activeCustomAdapters)].sort().join(', ')}. ` +
        'Wrap two-phase adapters with defineThreeComponentAdapter(), keeping all live work in ' +
        'synchronous activate() and its inverse in synchronous dispose().',
    )
  }

  const coordinator = createSceneInstallationCoordinator()
  let commitHost: ThreeCompiledSceneCommitHost | undefined
  let presentationActive = false
  let activeRequestFrame: (() => unknown) | undefined
  const bufferedRequestFrame = (): void => {
    if (!presentationActive || !activeRequestFrame) return
    try { activeRequestFrame() } catch (error) {
      console.error('Blendlink requestFrame callback failed:', error)
    }
  }

  const transaction = await coordinator.prepare(async (context) => {
    const resources = createDeferredPreparationResources()
    context.own(resources.resource)
    try {
      const resolvedPreview = resolveAuthoringPreview(
        options.descriptor,
        options.useAuthoringPreview === true,
      )
      const descriptor = resolvedPreview.descriptor
      if (resolvedPreview.warnings.length > 0) {
        for (const message of resolvedPreview.warnings) warnThreeInstallation(options, message)
      }
      const root = loaded.scene
      const ownsBindings = !loaded.blendlink
      const bindings = loaded.blendlink ?? bindCompiledScene(root, descriptor)
      if (ownsBindings) {
        resources.own('compiled scene bindings', () => bindings.dispose())
      }

      const ownsManager = !options.loadingManager && !options.loader
      const loadingManager = options.loadingManager
        ?? options.loader?.manager
        ?? new THREE.LoadingManager()
      const abortOwnedRequests = (): void => {
        if (!ownsManager) return
        try { loadingManager.abort() } catch (error) {
          console.error('Blendlink could not abort its private loading manager:', error)
        }
      }
      context.signal.addEventListener('abort', abortOwnedRequests, { once: true })
      resources.own('private loading-manager abort listener', () => {
        context.signal.removeEventListener('abort', abortOwnedRequests)
      })

      const stagingScene = new THREE.Scene()
      const environmentCandidate = await prepareCompiledSceneEnvironment(
        options.scene,
        descriptor,
        threeCompiledSceneEnvironmentOptions(root, loadingManager, options),
      )
      resources.own('prepared compiled environment', () => environmentCandidate.dispose())
      context.throwIfCancelled()

      const stagingEnvironment = installDetachedEnvironmentPreview(
        stagingScene,
        descriptor,
        environmentCandidate,
      )
      resources.own('detached environment preview', () => stagingEnvironment.dispose())

      const lookOptions = threeCompiledSceneLookOptions(resolvedPreview)
      const lookCandidate = prepareCompiledSceneLook(
        legacyRendererView(options.renderer),
        options.scene,
        descriptor,
        lookOptions,
      )
      resources.own('prepared compiled look', () => lookCandidate.dispose())
      const stagingLook = installDetachedLookPreview(
        stagingScene,
        legacyRendererView(options.renderer),
        descriptor,
        resolvedPreview,
      )
      resources.own('detached look preview', () => stagingLook.dispose())

      const stagingPreviewWorld = installAuthoringPreviewWorld(
        stagingScene,
        resolvedPreview.world,
      )
      resources.own('detached authoring preview world', () => stagingPreviewWorld.dispose())
      const stagingFog = applyCompiledSceneFog(stagingScene, descriptor, {
        createFog: (recipe) => recipe.mode === 'linear'
          ? new THREE.Fog(new THREE.Color().setRGB(...recipe.color), recipe.near, recipe.far)
          : new THREE.FogExp2(new THREE.Color().setRGB(...recipe.color), recipe.density),
      })
      if (stagingFog) resources.own('detached compiled fog', () => stagingFog.dispose())

      const previewMeshShadows = defaultAuthoringPreviewMeshShadows(
        root,
        descriptor,
        bindings,
        resolvedPreview.defaultMeshShadows,
      )
      resources.own('detached preview mesh shadows', () => previewMeshShadows.dispose())
      const shadowsCandidate = prepareCompiledSceneShadows(
        legacyRendererView(options.renderer),
        authoringPreviewShadowRoot(root, resolvedPreview.defaultMeshShadows),
        descriptor,
        {
          shadowMapTypes: {
            basic: THREE.BasicShadowMap,
            pcf: THREE.PCFShadowMap,
            vsm: THREE.VSMShadowMap,
          },
        },
      )
      resources.own('prepared compiled shadows', () => shadowsCandidate.dispose())

      const viewport = validViewport(options.viewport)
        ?? validViewport({
          width: options.renderer.domElement.clientWidth,
          height: options.renderer.domElement.clientHeight,
        })
      const inner = await installLoadedThreeCompiledSceneNow(
        loaded,
        {
          ...options,
          descriptor: presentationNeutralDescriptor(descriptor),
          scene: stagingScene,
          loadingManager,
          addToScene: true,
          // Detached/framework preparation treats renderer dimensions as
          // application-owned unless the caller explicitly opts in.
          resizeRenderer: options.resizeRenderer === true,
          useAuthoringPreview: false,
          signal: context.signal,
          requestFrame: bufferedRequestFrame,
        },
        {
          bindings,
          deferActivation: true,
          deferInitialResize: true,
          ...(plannedThreeToneMapping(descriptor, resolvedPreview) === undefined
            ? {}
            : {
                presentationToneMapping: plannedThreeToneMapping(
                  descriptor,
                  resolvedPreview,
                ),
              }),
        },
      )
      const disposeInner = inner.dispose.bind(inner)
      resources.own('detached compiled scene runtime', disposeInner)
      context.throwIfCancelled()

      const cameraSource = inner.cameraController?.camera
        ? 'Blender-authored'
        : options.fallbackCamera
          ? 'application-owned'
          : 'package-created'
      validatePreparedGroundedCamera(
        inner.camera,
        cameraSource,
        environmentCandidate.groundedBackground,
        descriptor,
      )

      const addToScene = options.addToScene ?? true
      let previousRootParent: THREE.Object3D | null = null
      context.stage({
        label: addToScene
          ? 'attach prepared root to the application scene'
          : 'release prepared root for application ownership',
        apply() {
          previousRootParent = root.parent
          if (addToScene) options.scene.add(root)
          else root.removeFromParent()
        },
        rollback() {
          if (root.parent === options.scene) options.scene.remove(root)
          if (previousRootParent && root.parent !== previousRootParent) {
            previousRootParent.add(root)
          }
        },
      })

      const inertEnvironment = inner.environment
      context.stage({
        label: 'commit compiled environment',
        apply() { inner.environment = environmentCandidate.commit() },
        rollback() {
          environmentCandidate.dispose()
          inner.environment = inertEnvironment
        },
      })

      const inertLook = inner.look
      context.stage({
        label: 'commit compiled look',
        apply() { inner.look = lookCandidate.commit() },
        rollback() {
          lookCandidate.dispose()
          inner.look = inertLook
        },
      })

      let livePreviewWorld: InstalledAuthoringPreviewWorld | null = null
      context.stage({
        label: 'commit authoring preview world',
        apply() {
          livePreviewWorld = installAuthoringPreviewWorld(
            options.scene,
            resolvedPreview.world,
          )
        },
        rollback() {
          livePreviewWorld?.dispose()
          livePreviewWorld = null
        },
      })

      context.stage({
        label: 'commit compiled fog',
        apply() {
          inner.fog = applyCompiledSceneFog(options.scene, descriptor, {
            createFog: (recipe) => recipe.mode === 'linear'
              ? new THREE.Fog(
                  new THREE.Color().setRGB(...recipe.color),
                  recipe.near,
                  recipe.far,
                )
              : new THREE.FogExp2(
                  new THREE.Color().setRGB(...recipe.color),
                  recipe.density,
                ),
          })
        },
        rollback() {
          inner.fog?.dispose()
          inner.fog = null
        },
      })

      const inertShadows = inner.shadows
      context.stage({
        label: 'commit compiled shadows',
        apply() { inner.shadows = shadowsCandidate.commit() },
        rollback() {
          shadowsCandidate.dispose()
          inner.shadows = inertShadows
        },
      })

      context.stage({
        label: 'activate compiled camera and components',
        apply() {
          if (viewport) inner.resize(viewport.width, viewport.height)
          inner.cameraController?.activate()
          inner.components.activate(options.scene, inner.camera)
        },
        rollback() {
          disposePreparedActivation(inner.components, inner.cameraController)
        },
      })

      let hostLease: { dispose(): void } | null = null
      context.stage({
        label: 'activate application scene host',
        apply() {
          const lease = commitHost?.activate?.(inner)
          if (lease !== undefined &&
              (!lease || typeof lease.dispose !== 'function')) {
            throw new Error(
              'ThreeCompiledSceneCommitHost.activate() must return void or a synchronous dispose() lease.',
            )
          }
          hostLease = lease ?? null
        },
        rollback() {
          hostLease?.dispose()
          hostLease = null
        },
      })

      context.stage({
        label: 'publish the first prepared frame request',
        apply() {
          activeRequestFrame = commitHost?.requestFrame ?? options.requestFrame
          presentationActive = true
          bufferedRequestFrame()
        },
        rollback() {
          presentationActive = false
          activeRequestFrame = undefined
        },
      })

      resources.unlock()
      return inner
    } catch (error) {
      try {
        resources.unlock()
      } catch (cleanupError) {
        throw new Error(
          `Could not prepare the detached Blendlink scene: ${errorMessage(error)}. ` +
            `Cleanup also failed: ${errorMessage(cleanupError)}`,
          { cause: error },
        )
      }
      throw error
    }
  }, options.signal ? { signal: options.signal } : {})

  let preparedFacade!: PreparedThreeCompiledScene
  // The resource journal retained the original bound method. From this point,
  // all public disposal must pass through the transaction so live mutations
  // roll back before detached resources are released.
  preparedFacade = {
    generation: transaction.generation,
    get state() { return transaction.state },
    get takesRenderOwnership() {
      return transaction.value.components.postprocessing
    },
    commit(host) {
      commitHost = host
      try {
        return transaction.commit()
      } finally {
        commitHost = undefined
      }
    },
    dispose() {
      transaction.dispose()
    },
  }
  transaction.value.dispose = () => preparedFacade.dispose()
  return preparedFacade
}

/** Install an already loaded GLTF immediately after its detached candidate is
 * ready. Framework adapters should call prepareLoadedThreeCompiledScene() and
 * commit from their synchronous layout/application ownership phase instead. */
export async function installLoadedThreeCompiledScene(
  loaded: LoadedWithBindings,
  options: InstallThreeCompiledSceneOptions,
): Promise<InstalledThreeCompiledScene> {
  return installLoadedThreeCompiledSceneNow(loaded, options)
}

async function installLoadedThreeCompiledSceneNow(
  loaded: LoadedWithBindings,
  options: InstallThreeCompiledSceneOptions,
  mode: LoadedThreeCompiledSceneInstallationMode = {},
): Promise<InstalledThreeCompiledScene> {
  assertCompiledSceneRenderer(options.renderer)
  throwIfInstallationAborted(options.signal)
  const resolvedPreview = resolveAuthoringPreview(
    options.descriptor,
    options.useAuthoringPreview === true,
  )
  const descriptor = resolvedPreview.descriptor
  const { scene } = options
  const renderer = legacyRendererView(options.renderer)
  const loadingManager = options.loadingManager ?? options.loader?.manager ?? new THREE.LoadingManager()
  if (resolvedPreview.warnings.length > 0) {
    const warn = options.onWarning ?? ((message: string) => console.warn(message))
    for (const message of resolvedPreview.warnings) warn(message)
  }
  const adapterDescriptor = visibilitySafeAdapterDescriptor(descriptor)
  const root = loaded.scene
  const ownsBindings = !mode.bindings && !loaded.blendlink
  const bindings = mode.bindings ?? loaded.blendlink ?? bindCompiledScene(root, descriptor)
  const addToScene = options.addToScene ?? true
  const cleanups: Array<() => void> = []
  let baked: ThreeBakedSceneHandle | null = null
  let look: CompiledSceneLook = { dispose() {} }
  let fog: CompiledSceneFog | null = null
  let shadows: CompiledSceneShadowReport = {
    lightsConfigured: 0, shadowPixels: 0, dispose() {},
  }
  let environment: CompiledSceneEnvironment = {
    texture: null, source: null, groundedBackground: null, dispose() {},
  }
  let cameraController: CompiledSceneCamera<THREE.Object3D> | null = null
  let playback: CompiledScenePlayback | null = null
  let reflectionProbes: CompiledReflectionProbes | null = null
  let rectAreaLights: InstalledThreeRectAreaLights | null = null
  let textureSampling: InstalledThreeTextureSampling | null = null
  let lods: CompiledSceneLods | null = null
  let instances: CompiledSceneInstances | null = null
  let components: InstalledThreeComponents | null = null
  let disposed = false

  const register = (cleanup: () => void): void => { cleanups.push(cleanup) }
  const rollback = (): unknown[] => {
    const errors: unknown[] = []
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    return errors
  }

  if (ownsBindings) register(() => bindings.dispose())

  try {
    const staticShadeFloorTextures =
      installThreeStaticShadeFloorTextureSharing(root)
    register(() => staticShadeFloorTextures.dispose())
    textureSampling = installThreeTextureSampling(
      root,
      renderer,
      options.textureAnisotropy ?? 'authored',
    )
    register(() => textureSampling?.dispose())

    // Phase 4 Track C: a shipped materialPrograms pointer is the artist's
    // compile-time opt-in, so the programs apply automatically on the
    // WebGPU renderer family. The WebGL family has no node materials to
    // apply them with — its shipped carriers already render faithfully.
    let tslMaterials:
      | import('./tslMaterialRuntime.js').InstalledTslMaterials
      | null = null
    if (
      descriptor.materialPrograms
      && (renderer as { isWebGPURenderer?: boolean }).isWebGPURenderer
    ) {
      const { installTslMaterials } = await import('./tslMaterialRuntime.js')
      tslMaterials = await installTslMaterials({
        root,
        descriptor: descriptor as Parameters<typeof installTslMaterials>[0]['descriptor'],
        ...(options.loadMaterialPrograms
          ? { loadPrograms: options.loadMaterialPrograms }
          : {}),
      })
      register(() => tslMaterials?.dispose())
    }

    const hasBakedAssets = Object.keys(descriptor.states ?? {}).length > 0
      || Object.keys(descriptor.lightGroups ?? {}).length > 0
    if (hasBakedAssets && !options.createBakedScene) {
      throw new Error(
        'This scene publishes baked states or light groups. Import createBakedScene from the ' +
          'generated `<scene>.baked.ts` file and pass it to installThreeCompiledScene().',
      )
    }
    if (options.createBakedScene) {
      baked = options.createBakedScene(
        root,
        {
          ...(options.bakedTextureCacheBytes === undefined
            ? {}
            : { textureCacheBytes: options.bakedTextureCacheBytes }),
          ...(options.bakedAtlasDeliveryQuality === undefined
            ? {}
            : { atlasDeliveryQuality: options.bakedAtlasDeliveryQuality }),
          loadingManager,
        },
      )
      register(() => baked?.dispose())
      if (baked.ready) await baked.ready
      throwIfInstallationAborted(options.signal)
      if (options.prewarm !== false && baked.prepare) await baked.prepare(renderer)
      throwIfInstallationAborted(options.signal)
    }

    // Area descriptors live inside the GLB. Prepare Three's shared LTC
    // textures and create the shadowless children while the loaded root is
    // still outside the application scene, so neither reflection capture nor
    // first paint can observe a missing light set.
    rectAreaLights = await installThreeRectAreaLights(root, renderer, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.prewarm === false ? { prewarm: false } : {}),
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
    })
    register(() => rectAreaLights?.dispose())
    throwIfInstallationAborted(options.signal)

    // Keep the root out of an application's active render loop until the
    // default baked state is decoded. This prevents a one-frame no-GI pop and
    // turns atlas 404s into installer failures with full recipe context.
    if (addToScene) {
      scene.add(root)
      register(() => { if (root.parent === scene) scene.remove(root) })
    }

    environment = await applyCompiledSceneEnvironment(scene, descriptor, {
      loaders: {
        hdr: new HDRLoader(loadingManager),
        exr: new EXRLoader(loadingManager),
        ...(options.ktx2Loader ? { ktx2: options.ktx2Loader } : {}),
      },
      linearFilter: THREE.LinearFilter,
      equirectangularReflectionMapping: THREE.EquirectangularReflectionMapping,
      onWarning: options.onWarning,
      createGroundedBackground: (texture, settings) => {
        const ground = new GroundedSkybox(
          texture as THREE.Texture,
          settings.height,
          settings.radius,
        )
        if (!fitGroundedBackgroundToCompiledRoot(ground, root, settings.height)) {
          ground.position.y = settings.height
          const message =
            'Grounded Backdrop could not auto-fit because the compiled scene has no finite visible mesh bounds; ' +
            'the authored world origin remains the projection center.'
          if (options.onWarning) options.onWarning(message)
          else console.warn(message)
        }
        ground.rotation.y = settings.rotation
        ground.material.color.setScalar(settings.intensity)
        if (settings.blur > 0) {
          const message =
            'Three.js backgroundBlurriness applies only to Scene.background environment maps; ' +
            'GroundedSkybox is scene geometry, so grounded background blur cannot be represented and was ignored.'
          if (options.onWarning) options.onWarning(message)
          else console.warn(message)
        }
        return ground
      },
      disposeGroundedBackground: (value) => {
        const ground = value as THREE.Mesh
        ground.geometry?.dispose()
        const materials = Array.isArray(ground.material) ? ground.material : [ground.material]
        materials.forEach((material) => material?.dispose())
      },
    })
    register(() => environment.dispose())
    throwIfInstallationAborted(options.signal)

    // Environment owns the HDR/image layer; look is deliberately applied
    // afterwards so an authored color or transparent canvas remains visible
    // when the environment recipe says Background: None.
    look = applyCompiledSceneLook(renderer, scene, descriptor, {
      toneMappings: {
        agx: THREE.AgXToneMapping,
        neutral: THREE.NeutralToneMapping,
        aces: THREE.ACESFilmicToneMapping,
        none: resolvedPreview.useLinearToneMapping
          ? THREE.LinearToneMapping
          : THREE.NoToneMapping,
      },
      createColor: ([r, g, b]) => new THREE.Color().setRGB(r, g, b),
    })
    register(() => look.dispose())

    const previewWorld = installAuthoringPreviewWorld(scene, resolvedPreview.world)
    register(() => previewWorld.dispose())

    fog = applyCompiledSceneFog(scene, descriptor, {
      createFog: (recipe) => recipe.mode === 'linear'
        ? new THREE.Fog(new THREE.Color().setRGB(...recipe.color), recipe.near, recipe.far)
        : new THREE.FogExp2(new THREE.Color().setRGB(...recipe.color), recipe.density),
    })
    if (fog) register(() => fog?.dispose())

    shadows = applyCompiledSceneShadows(
      renderer,
      authoringPreviewShadowRoot(root, resolvedPreview.defaultMeshShadows),
      descriptor,
      {
      shadowMapTypes: {
        basic: THREE.BasicShadowMap,
        pcf: THREE.PCFShadowMap,
        vsm: THREE.VSMShadowMap,
      },
      },
    )
    register(() => shadows.dispose())
    const previewMeshShadows = defaultAuthoringPreviewMeshShadows(
      root,
      descriptor,
      bindings,
      resolvedPreview.defaultMeshShadows,
    )
    register(() => previewMeshShadows.dispose())

    const viewport = validViewport(options.viewport)
      ?? validViewport({
        width: renderer.domElement.clientWidth,
        height: renderer.domElement.clientHeight,
      })
    cameraController = installCompiledSceneCamera(root, bindings, descriptor, {
      createControls: ({ behavior, camera, targetPosition }) => {
        const threeCamera = camera as THREE.Camera
        if (behavior === 'free') {
          if (typeof window === 'undefined') {
            throw new Error('Blendlink Free camera controls require a browser window and interactive canvas.')
          }
          const controls = new FlyControls(threeCamera, renderer.domElement)
          const sceneRadius = measureBounds(root).radius
          controls.dragToLook = true
          controls.movementSpeed = Math.max(sceneRadius, 0.01)
          controls.rollSpeed = Math.PI / 3
          let savedPosition = threeCamera.position.clone()
          let savedQuaternion = threeCamera.quaternion.clone()
          return {
            update: (deltaSeconds = 0) => controls.update(deltaSeconds),
            dispose: () => controls.dispose(),
            saveState: () => {
              savedPosition = threeCamera.position.clone()
              savedQuaternion = threeCamera.quaternion.clone()
            },
            reset: () => {
              threeCamera.position.copy(savedPosition)
              threeCamera.quaternion.copy(savedQuaternion)
              threeCamera.updateMatrixWorld(true)
            },
          }
        }

        const controls = new OrbitControls(threeCamera, renderer.domElement)
        controls.enableDamping = true
        if (targetPosition) controls.target.fromArray(targetPosition)
        controls.update()
        controls.saveState()
        let requiresContinuousFrames = false
        const requestControlsFrame = (): void => {
          requiresContinuousFrames = true
          options.requestFrame?.()
        }
        // OrbitControls performs input mutations from its own DOM listeners,
        // outside React/R3F's event system. Its `change` event is therefore
        // the wake edge for demand-mode hosts. `update()` is Three's own
        // activity proof: true while input/damping changed the camera and
        // false once the control has actually settled.
        controls.addEventListener('start', requestControlsFrame)
        controls.addEventListener('change', requestControlsFrame)
        return {
          update: () => {
            requiresContinuousFrames = controls.update()
          },
          get requiresContinuousFrames() { return requiresContinuousFrames },
          dispose: () => {
            controls.removeEventListener('start', requestControlsFrame)
            controls.removeEventListener('change', requestControlsFrame)
            controls.dispose()
            requiresContinuousFrames = false
          },
          saveState: () => controls.saveState(),
          reset: () => controls.reset(),
          setTarget: (x, y, z) => {
            controls.target.set(x, y, z)
            requestControlsFrame()
          },
        }
      },
      getWorldPosition: (object) => object.getWorldPosition(new THREE.Vector3()).toArray(),
      getViewDirection: (camera) => (camera as THREE.Camera)
        .getWorldDirection(new THREE.Vector3()).toArray(),
      measureBounds: measureBounds,
      ...(viewport ? { initialViewport: viewport } : {}),
      ...(mode.deferActivation ? { deferActivation: true } : {}),
    })
    if (cameraController) register(() => cameraController?.dispose())
    const authoredCamera = cameraController?.camera
    if (authoredCamera && !isPerspectiveCamera(authoredCamera)
        && !isOrthographicCamera(authoredCamera)) {
      throw new Error(
        'The authored Blendlink presentation camera did not load as a Three-compatible PerspectiveCamera or OrthographicCamera.',
      )
    }
    const cameraSource = authoredCamera
      ? 'Blender-authored'
      : options.fallbackCamera
        ? 'application-owned'
        : 'package-created'
    const camera: ThreePresentationCamera = authoredCamera as ThreePresentationCamera | undefined
      ?? options.fallbackCamera
      ?? createFallbackCamera(root, viewport)

    const groundedBackground = environment.groundedBackground
    const groundedRecipe = descriptor.environment?.background === 'grounded'
      ? descriptor.environment
      : null
    if (groundedBackground && groundedRecipe) {
      const safety = inspectThreeGroundedCameraSafety(
        camera as THREE.Camera & { far: number; updateProjectionMatrix(): void },
        groundedBackground as THREE.Mesh<THREE.BufferGeometry>,
        groundedRecipe.groundRadius,
      )
      if (!safety.cameraInsideRadius) {
        const action = cameraSource === 'application-owned'
          ? 'Increase environment.groundRadius or move the application camera inside the projection.'
          : 'Increase Ground Radius in Blender or move the presentation camera inside the projection.'
        throw new Error(
          `${cameraSource} camera is ${safety.cameraDistance.toFixed(3)} units from the Grounded ` +
            `Backdrop center, outside its ${safety.radius.toFixed(3)} radius. ${action}`,
        )
      }
      if (safety.currentFar < safety.requiredFar) {
        if (cameraSource === 'package-created') {
          repairPackageGroundedCameraFar(
            camera as THREE.Camera & { far: number; updateProjectionMatrix(): void },
            safety,
          )
        } else {
          const action = cameraSource === 'application-owned'
            ? 'Increase camera.far in the website or reduce environment.groundRadius.'
            : 'Raise the Blender camera Clip End or reduce Ground Radius.'
          throw new Error(
            `${cameraSource} camera far plane ${safety.currentFar.toFixed(3)} clips ` +
              `${safety.clippedVertexCount} Grounded Backdrop vertices; at least ` +
              `${safety.requiredFar.toFixed(3)} is required for this view. ${action}`,
          )
        }
      }
    }

    playback = startCompiledScenePlayback(loaded as unknown as LoadedSceneLike, descriptor, {
      createMixer: (object) => new THREE.AnimationMixer(object as THREE.Object3D) as unknown as
        import('./runtime.js').AnimationMixerLike,
      loopModes: {
        once: THREE.LoopOnce,
        repeat: THREE.LoopRepeat,
        pingpong: THREE.LoopPingPong,
      },
      createSequenceClip: (source, strip) => {
        const clip = (source as unknown as THREE.AnimationClip).clone()
        clip.name = `${source.name}__blendlink_sequence_${strip.order}`
        if (strip.blend === 'add') {
          // A trimmed additive strip should enter at zero delta. The helper's
          // frame/fps pair is just a time conversion, so fps=1 lets the
          // canonical clipStart seconds serve as the reference pose exactly.
          THREE.AnimationUtils.makeClipAdditive(clip, strip.clipStart, clip, 1)
        }
        return clip as unknown as import('./runtime.js').AnimationClipLike
      },
      ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
    })
    if (playback) register(() => playback?.dispose())

    lods = startCompiledSceneLods(
      root as unknown as LodObjectLike,
      camera as unknown as LodObjectLike,
      adapterDescriptor,
      {
      createVector3: () => new THREE.Vector3() as unknown as LodVectorLike,
      },
    )
    if (lods) register(() => lods?.stop())

    if (options.instantiateEligibleMeshes) {
      instances = applyCompiledSceneInstances(root as unknown as InstanceObjectLike, adapterDescriptor, {
        createInstancedMesh: (geometry, material, count) => new THREE.InstancedMesh(
          geometry as THREE.BufferGeometry,
          material as THREE.Material | THREE.Material[],
          count,
        ),
      })
      if (instances) register(() => instances?.stop())
    }

    const probeDefinitions = descriptor.reflectionProbes ?? []
    if (probeDefinitions.length > 0) {
      const supplied = options.reflectionProbes ?? {}
      const hasExplicitAssignments = Object.values(descriptor.extras ?? {}).some(
        (extras) => typeof extras.blendlink_reflection_probe === 'string',
      )
      if (hasBakedAssets && hasExplicitAssignments && !supplied.assignTexture &&
          !supplied.trackMaterialClone && !baked?.trackMaterialClone) {
        throw new Error(
          'This scene combines baked materials with local reflection probes, but its editable ' +
            'baked recipe predates material-clone tracking. Run `blendlink recipe update <scene>` ' +
            'and rebuild, or supply an assignTexture() adapter that coordinates both systems.',
        )
      }
      const cloneTrackers: Array<NonNullable<typeof supplied.trackMaterialClone>> = [
        ...(baked?.trackMaterialClone
          ? [(
              source: import('./reflectionProbes.js').ReflectionProbeMaterialLike,
              clone: import('./reflectionProbes.js').ReflectionProbeMaterialLike,
            ) => baked!.trackMaterialClone!(source as THREE.Material, clone as THREE.Material)]
          : []),
        ...(supplied.trackMaterialClone ? [supplied.trackMaterialClone] : []),
      ]
      const trackMaterialClone: typeof supplied.trackMaterialClone = cloneTrackers.length > 0
        ? (source, clone, context) => {
            const releases: Array<(transferred: boolean) => void> = []
            try {
              for (const tracker of cloneTrackers) {
                const release = tracker(source, clone, context)
                if (release) releases.push(release)
              }
            } catch (error) {
              for (const release of releases.reverse()) release(false)
              throw error
            }
            return (transferred) => {
              const errors: unknown[] = []
              for (const release of releases.reverse()) {
                try { release(transferred) } catch (error) { errors.push(error) }
              }
              if (errors.length > 0) {
                throw new Error(
                  'Could not release tracked reflection material clones: ' +
                    errors.map(errorMessage).join('; '),
                )
              }
            }
          }
        : undefined
      const hasRuntimeCapture = probeDefinitions.some(
        (definition) => (definition.source ?? 'runtime') === 'runtime',
      )
      const capture = supplied.capture ?? (
        hasRuntimeCapture && (options.captureReflectionProbes ?? true) && addToScene
          ? createThreeWebGLReflectionCapture({
              THREE: THREE as unknown as ThreeWebGLReflectionCaptureNamespace,
              renderer,
              scene,
            })
          : undefined
      )
      const loadTexture = supplied.loadTexture ?? (
        Object.keys(descriptor.reflectionProbeAssets ?? {}).length > 0
          ? createThreePublishedReflectionLoader(renderer, loadingManager)
          : undefined
      )
      reflectionProbes = await applyCompiledSceneReflectionProbes(
        root as THREE.Object3D & ReflectionProbeObjectLike,
        descriptor,
        {
          ...supplied,
          ...(capture ? { capture } : {}),
          ...(loadTexture ? { loadTexture } : {}),
          ...(trackMaterialClone ? { trackMaterialClone } : {}),
        },
      )
      register(() => reflectionProbes?.dispose())
      throwIfInstallationAborted(options.signal)
    }

    const perspectiveBefore = isPerspectiveCamera(camera)
      ? camera.aspect
      : null
    const orthographicBefore = isOrthographicCamera(camera)
      ? { left: camera.left, right: camera.right }
      : null
    let perspectiveInstalled = perspectiveBefore
    let orthographicInstalled = orthographicBefore
    let projectionTouched = false
    register(() => {
      if (!projectionTouched) return
      if (isPerspectiveCamera(camera) && perspectiveBefore !== null
          && perspectiveInstalled !== null && Object.is(camera.aspect, perspectiveInstalled)) {
        camera.aspect = perspectiveBefore
        camera.updateProjectionMatrix()
      } else if (isOrthographicCamera(camera) && orthographicBefore
          && orthographicInstalled
          && Object.is(camera.left, orthographicInstalled.left)
          && Object.is(camera.right, orthographicInstalled.right)) {
        camera.left = orthographicBefore.left
        camera.right = orthographicBefore.right
        camera.updateProjectionMatrix()
      }
    })

    const resize = (width: number, height: number): void => {
      const next = requiredViewport({ width, height })
      if (options.resizeRenderer !== false) renderer.setSize(next.width, next.height, false)
      if (isPerspectiveCamera(camera)) {
        camera.aspect = next.width / next.height
        camera.updateProjectionMatrix()
        perspectiveInstalled = camera.aspect
        projectionTouched = true
      } else {
        const verticalSpan = camera.top - camera.bottom
        const horizontalCenter = (camera.left + camera.right) / 2
        const horizontalSpan = verticalSpan * (next.width / next.height)
        camera.left = horizontalCenter - horizontalSpan / 2
        camera.right = horizontalCenter + horizontalSpan / 2
        camera.updateProjectionMatrix()
        orthographicInstalled = { left: camera.left, right: camera.right }
        projectionTouched = true
      }
    }
    if (viewport && !mode.deferInitialResize) resize(viewport.width, viewport.height)

    components = await installThreeComponents({
      // Generated descriptors are `as const`; the component installer never
      // mutates them, but accepts the canonical portable record shape.
      components: descriptor.components as unknown as readonly PortableComponentRecord[] | undefined,
      root,
      scene,
      camera,
      renderer,
      ...(mode.presentationToneMapping === undefined
        ? {}
        : { presentationToneMapping: mode.presentationToneMapping }),
      bindings,
      animations: loaded.animations ?? [],
      ...(options.componentAdapters ? { adapters: options.componentAdapters } : {}),
      ...(options.openComponentUrl ? { openUrl: options.openComponentUrl } : {}),
      ...(options.componentAudioLoader ? { audioLoader: options.componentAudioLoader } : {}),
      ...(options.loadComponentLut ? { loadLut: options.loadComponentLut } : {}),
      ...(options.componentInteraction ? { interaction: options.componentInteraction } : {}),
      ...(options.componentAccessibility ? { accessibility: options.componentAccessibility } : {}),
      ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
      loadingManager,
      ...(options.onWarning ? { onWarning: options.onWarning } : {}),
      ...(mode.deferActivation ? { deferActivation: true } : {}),
    })
    register(() => components?.dispose())
    throwIfInstallationAborted(options.signal)
    if (viewport) components.resize(viewport.width, viewport.height)

    // Components and baked recipes can replace or introduce materials. Audit
    // only their finalized live receiver set, then synchronize world-scaled
    // rectangle dimensions immediately before the shader barrier.
    rectAreaLights.auditReceivers()
    rectAreaLights.sync()

    if (options.prewarm !== false) {
      const compileAsync = (renderer as THREE.WebGLRenderer & {
        compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>
      }).compileAsync
      if (typeof compileAsync === 'function') {
        await compileAsync.call(renderer, addToScene ? scene : root, camera)
        throwIfInstallationAborted(options.signal)
      }
    }

    const animation = playback ? applicationAnimationTransport(playback) : null
    return {
      loaded,
      root,
      bindings,
      camera,
      baked,
      playback,
      animation,
      cameraController,
      look,
      fog,
      shadows,
      environment,
      reflectionProbes,
      rectAreaLights: rectAreaLights.report,
      textureSampling: textureSampling.report,
      tslMaterials: tslMaterials
        ? {
            materials: tslMaterials.materials,
            applied: tslMaterials.applied,
            skipped: tslMaterials.skipped,
          }
        : null,
      lods,
      instances,
      components,
      websiteSurfaces: components.websiteSurfaces,
      get requiresContinuousFrames() {
        return playback?.requiresContinuousFrames === true
          || cameraController?.requiresContinuousFrames === true
          // LOD selection depends on camera distance. The host application may
          // move an otherwise non-interactive authored camera, so a present
          // LOD adapter is not provably idle without a future activity lease.
          || lods !== null
          || components?.requiresContinuousFrames === true
      },
      update(deltaSeconds) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
          throw new Error(`Blendlink scene update needs a non-negative delta in seconds; got ${deltaSeconds}.`)
        }
        playback?.update(deltaSeconds)
        cameraController?.update(deltaSeconds)
        lods?.update()
        instances?.update()
        components?.update(deltaSeconds)
        rectAreaLights?.sync()
      },
      render(deltaSeconds) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        components?.render(deltaSeconds)
      },
      resize(width, height) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        resize(width, height)
        components?.resize(width, height)
      },
      setState(name) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        return baked?.setState(name) ?? false
      },
      async setStateAsync(name) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        if (!baked) return false
        return baked.setStateAsync ? baked.setStateAsync(name) : baked.setState(name)
      },
      setLightGroup(name, lightOptions) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        return baked?.setLightGroup(name, lightOptions) ?? false
      },
      async setLightGroupAsync(name, lightOptions) {
        if (disposed) throw new Error('This installed Blendlink scene has been disposed.')
        if (!baked) return false
        return baked.setLightGroupAsync
          ? baked.setLightGroupAsync(name, lightOptions)
          : baked.setLightGroup(name, lightOptions)
      },
      dispose() {
        if (disposed) return
        disposed = true
        const errors = rollback()
        if (errors.length > 0) {
          throw new Error(
            'Could not fully dispose the installed Blendlink scene: ' +
              errors.map((error) => error instanceof Error ? error.message : String(error)).join('; '),
          )
        }
      },
    }
  } catch (error) {
    const rollbackErrors = rollback()
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Could not install the Blendlink scene: ${error instanceof Error ? error.message : String(error)}. ` +
          `Rollback also failed: ${rollbackErrors.map((item) =>
            item instanceof Error ? item.message : String(item)).join('; ')}`,
      )
    }
    throw error
  }
}

function measureBounds(object: THREE.Object3D): { center: [number, number, number]; radius: number } {
  const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere())
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
    const center = object.getWorldPosition(new THREE.Vector3())
    return { center: center.toArray(), radius: 1 }
  }
  return { center: sphere.center.toArray(), radius: sphere.radius }
}

function createFallbackCamera(
  root: THREE.Object3D,
  viewport: ThreeSceneViewport | null,
): THREE.PerspectiveCamera {
  const aspect = viewport ? viewport.width / viewport.height : 1
  const { center, radius } = measureBounds(root)
  const camera = new THREE.PerspectiveCamera(45, aspect, Math.max(0.01, radius / 1000), radius * 100)
  const focus = new THREE.Vector3().fromArray(center)
  const offset = new THREE.Vector3(1, 0.65, 1.6).normalize().multiplyScalar(radius * 3)
  camera.position.copy(focus).add(offset)
  camera.lookAt(focus)
  camera.updateProjectionMatrix()
  return camera
}

function isPerspectiveCamera(camera: unknown): camera is THREE.PerspectiveCamera {
  const candidate = camera as { isCamera?: unknown; isPerspectiveCamera?: unknown } | null
  return candidate?.isCamera === true && candidate.isPerspectiveCamera === true
}

function isOrthographicCamera(camera: unknown): camera is THREE.OrthographicCamera {
  const candidate = camera as { isCamera?: unknown; isOrthographicCamera?: unknown } | null
  return candidate?.isCamera === true && candidate.isOrthographicCamera === true
}

function validViewport(value: ThreeSceneViewport | undefined): ThreeSceneViewport | null {
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height)
      || value.width <= 0 || value.height <= 0) return null
  return { width: value.width, height: value.height }
}

function requiredViewport(value: ThreeSceneViewport): ThreeSceneViewport {
  const viewport = validViewport(value)
  if (!viewport) {
    throw new Error(`Blendlink viewport needs positive finite width/height; got ${value.width} x ${value.height}.`)
  }
  return viewport
}

function ownLoadedThreePreparedResources(
  prepared: PreparedThreeCompiledScene,
  loaded: GLTF,
  ownedKtx2Loader: KTX2Loader | null = null,
): PreparedThreeCompiledScene {
  let resourcesDisposed = false
  const releaseResources = (): unknown[] => {
    if (resourcesDisposed) return []
    resourcesDisposed = true
    const errors = disposeLoadedThreeResources(loaded)
    if (ownedKtx2Loader) {
      try { ownedKtx2Loader.dispose() } catch (error) { errors.push(error) }
    }
    return errors
  }
  const throwCombined = (action: string, cause: unknown, cleanupErrors: unknown[]): never => {
    throw new Error(
      `${action}: ${errorMessage(cause)}.` +
        (cleanupErrors.length > 0
          ? ` Loaded glTF cleanup also failed: ${cleanupErrors.map(errorMessage).join('; ')}`
          : ''),
      { cause },
    )
  }
  const disposePreparedAndResources = (): void => {
    const errors: unknown[] = []
    try { prepared.dispose() } catch (error) { errors.push(error) }
    errors.push(...releaseResources())
    if (errors.length > 0) {
      throw new Error(
        'Could not fully dispose the prepared Blendlink scene and its loaded glTF resources: ' +
          errors.map(errorMessage).join('; '),
      )
    }
  }
  return {
    get generation() { return prepared.generation },
    get state() { return prepared.state },
    get takesRenderOwnership() { return prepared.takesRenderOwnership },
    commit(host) {
      let installed: InstalledThreeCompiledScene
      try {
        installed = prepared.commit(host)
      } catch (error) {
        // A duplicate commit must not tear resources out from under the
        // already committed installation; every failed pre-commit generation
        // has no live owner and can release immediately.
        const cleanupErrors = prepared.state === 'committed'
          ? []
          : releaseResources()
        return throwCombined(
          'Could not commit the prepared Blendlink scene',
          error,
          cleanupErrors,
        )
      }
      const disposeInstallation = installed.dispose.bind(installed)
      let installedDisposed = false
      installed.dispose = () => {
        if (installedDisposed) return
        installedDisposed = true
        const errors: unknown[] = []
        try { disposeInstallation() } catch (error) { errors.push(error) }
        errors.push(...releaseResources())
        if (errors.length > 0) {
          throw new Error(
            'Could not fully dispose the installed Blendlink scene and its loaded glTF resources: ' +
              errors.map(errorMessage).join('; '),
          )
        }
      }
      return installed
    },
    dispose: disposePreparedAndResources,
  }
}

function ownLoadedThreeResources(
  installed: InstalledThreeCompiledScene,
  ownedKtx2Loader: KTX2Loader | null = null,
): InstalledThreeCompiledScene {
  const disposeInstallation = installed.dispose.bind(installed)
  let resourcesDisposed = false
  installed.dispose = () => {
    if (resourcesDisposed) return
    resourcesDisposed = true
    const errors: unknown[] = []
    try { disposeInstallation() } catch (error) { errors.push(error) }
    errors.push(...disposeLoadedThreeResources(installed.loaded))
    if (ownedKtx2Loader) {
      try { ownedKtx2Loader.dispose() } catch (error) { errors.push(error) }
    }
    if (errors.length > 0) {
      throw new Error(
        'Could not fully dispose the installed Blendlink scene and its loaded glTF resources: ' +
          errors.map(errorMessage).join('; '),
      )
    }
  }
  return installed
}

function createOwnedKtx2Loader(
  descriptor: CompiledSceneDescriptor,
  renderer: THREE.WebGLRenderer,
  manager: THREE.LoadingManager,
): KTX2Loader {
  const transcoderPath = threeKtx2TranscoderPath(descriptor.url, descriptor)
  const loader = new KTX2Loader(manager)
  try {
    loader.setTranscoderPath(transcoderPath)
    loader.detectSupport(renderer)
    return loader
  } catch (error) {
    let cleanupError: unknown = null
    try { loader.dispose() } catch (disposeError) { cleanupError = disposeError }
    throw new Error(
      `Blendlink could not configure Three's KTX2Loader for "${transcoderPath}". ` +
        'detectSupport(renderer) needs a renderer with compressed-texture capability ' +
        'detection — for WebGPURenderer that means after `await renderer.init()` — or ' +
        `pass an application-configured ktx2Loader. ${errorMessage(error)}` +
        (cleanupError ? ` Loader cleanup also failed: ${errorMessage(cleanupError)}` : ''),
    )
  }
}

/** `installThreeCompiledScene()` loads a private GLTF, unlike the cache-owning
 * `installLoadedThreeCompiledScene()` seam. Three does not release GPU assets
 * when an Object3D leaves a scene, so collect and dispose that private graph. */
function disposeLoadedThreeResources(loaded: GLTF): unknown[] {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const skeletons = new Set<THREE.Skeleton>()
  const roots = new Set<THREE.Object3D>([loaded.scene, ...(loaded.scenes ?? [])])

  const collectTextureValue = (value: unknown, seen: Set<object>): void => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
    if ((value as THREE.Texture).isTexture) {
      textures.add(value as THREE.Texture)
      return
    }
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((entry) => collectTextureValue(entry, seen))
      return
    }
    Object.values(value).forEach((entry) => collectTextureValue(entry, seen))
  }

  const collectMaterial = (material: THREE.Material): void => {
    if (materials.has(material)) return
    materials.add(material)
    for (const [key, value] of Object.entries(material)) {
      if (key === 'userData' || key === '_listeners') continue
      if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture)
      else if (Array.isArray(value)) {
        value.forEach((entry) => {
          if ((entry as THREE.Texture | null)?.isTexture) textures.add(entry as THREE.Texture)
        })
      }
    }
    const uniforms = (material as THREE.ShaderMaterial).uniforms
    if (uniforms) collectTextureValue(uniforms, new Set<object>())
  }

  for (const root of roots) {
    root.traverse((object) => {
      const renderable = object as THREE.Mesh
      if (renderable.geometry?.isBufferGeometry) geometries.add(renderable.geometry)
      const material = renderable.material
      if (Array.isArray(material)) material.forEach(collectMaterial)
      else if (material?.isMaterial) collectMaterial(material)
      const skeleton = (object as THREE.SkinnedMesh).skeleton
      if (skeleton) skeletons.add(skeleton)
    })
  }

  const errors: unknown[] = []
  for (const skeleton of skeletons) {
    try { skeleton.dispose() } catch (error) { errors.push(error) }
  }
  for (const geometry of geometries) {
    try { geometry.dispose() } catch (error) { errors.push(error) }
  }
  for (const material of materials) {
    try { material.dispose() } catch (error) { errors.push(error) }
  }
  for (const texture of textures) {
    try { texture.dispose() } catch (error) { errors.push(error) }
  }
  return errors
}

function observeLateKtx2CspSceneLoad(load: Promise<LoadedWithBindings>): void {
  void load.then((lateLoaded) => {
    const errors = disposeLoadedThreeResources(lateLoaded)
    if (errors.length > 0) {
      console.error(
        'Blendlink received a late glTF result after a KTX2 CSP failure, but could not ' +
          `fully dispose it: ${errors.map(errorMessage).join('; ')}`,
      )
    }
  }, () => {
    // Promise.race observes this rejection too, but keep an explicit terminal
    // rejection branch beside the late-success ownership path. The CSP error
    // already explains why this abandoned package load was terminated.
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertCompiledSceneRenderer(renderer: CompiledSceneRendererOption): void {
  const identity = renderer as THREE.WebGLRenderer & {
    isWebGLRenderer?: boolean
    isWebGPURenderer?: boolean
  }
  if (!identity.isWebGLRenderer && !identity.isWebGPURenderer) {
    throw new Error(
      'Blendlink\'s standard scene installer requires a Three renderer ' +
        '(WebGLRenderer, or an initialized WebGPURenderer). Renderer-like ' +
        'adapters need the full renderer surface: environment, shadows, ' +
        'probes, and lifecycle.',
    )
  }
}
