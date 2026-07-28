import type { FogRecipe, PresentationCameraRecipe, ReflectionProbeRecipe } from './sceneRecipe.js'
import type { SceneDiagnostics } from './sceneDiagnostics.js'
import type { RuntimeSceneDiagnostics } from './runtimeDiagnostics.js'
import type { SceneAssetGraph } from './sceneAssetGraph.js'
import {
  mainThreadMeshoptDecoder,
  resolveMeshoptWorkerPolicy,
  validateMeshoptWorkerOptions,
  withMeshoptDecoderForLoad,
  type MeshoptWorkerOptions,
} from './meshoptWorkers.js'
import {
  startAnimationSequence,
  type AnimationSequenceRecipe,
  type AnimationSequenceStrip,
} from './animationSequence.js'

/** Generated descriptors are emitted with `as const`. Runtime contracts never
 * mutate compiler output, so nested diagnostic evidence must accept the same
 * deeply immutable shape consumed from generated modules. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [TIndex in keyof T]: DeepReadonly<T[TIndex]> }
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T

export interface Object3DLike {
  name: string
  userData?: Record<string, unknown>
  /** Native Three PointLight marker; its shadow map has six cubemap faces. */
  isPointLight?: boolean
  visible?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  shadow?: LightShadowLike
  children?: Object3DLike[]
  traverse?(visitor: (object: Object3DLike) => void): void
}

/** Blender viewport evidence used only by authoring tools that explicitly
 * opt into a best-effort preview. It never changes a website's published
 * presentation policy by itself. */
export interface AuthoringPreview {
  look: Readonly<{
    toneMapping: 'agx' | 'neutral' | 'aces' | 'none'
    /** Blender exposure in stops. */
    exposure: number
    /** Preview-only correction in stops for the selected native Three.js
     * transform. The artist-authored exposure remains unchanged evidence. */
    previewExposureOffsetStops?: number
    sourceViewTransform: string
    exact: boolean
  }>
  shadows: Readonly<{ enabled: boolean }>
  /** False when Film > Transparent makes even an unclassified procedural
   * World irrelevant to the camera background. Lighting ownership remains a
   * separate decision. */
  worldBackgroundVisible?: boolean
  /** A safely classified constant Blender World. RGB is scene-linear and
   * strength remains separate so native preview adapters can translate
   * radiance without baking display transforms into the evidence. */
  world?: Readonly<{
    color: readonly [number, number, number]
    strength: number
    exact: boolean
    source: 'background' | 'world-color'
    /** False when Blender Film > Transparent hides the World from the
     * camera. The same radiance can still illuminate PBR materials. */
    backgroundVisible?: boolean
  }>
  /** Why a non-constant Blender World was deliberately not guessed. Preview
   * tools surface this only when source World ownership is actually needed. */
  worldWarning?: string
  warnings?: readonly string[]
}

export interface CompiledSceneDescriptor {
  url: string
  nodes: Readonly<Record<string, string>>
  /** Generated node key -> rename-stable ID. Runtime binding prefers this
   * over Three.js names, whose private collision suffixes are not an API. */
  nodeIds?: Readonly<Record<string, string>>
  objectsById?: Readonly<Record<string, string>>
  camera?: DeepReadonly<PresentationCameraRecipe> | null
  extras?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  optimization?: Readonly<{ geometry: 'meshopt' }> | null
  textureCompression?: Readonly<{ format: 'ktx2' }> | null
  /** Canonical baked texture URL -> verified alternatives. Generated baked
   * recipes select these without changing artist-owned atlas identities. */
  textureVariants?: DeepReadonly<Record<string, readonly {
    url: string
    format: 'png' | 'webp'
    width: number
    height: number
    bytes: number
    hash: string
    lossless: true
  }[]>>
  /** Direct evidence from the decoded GLB. External KTX2 scenes may require
   * a decoder without having a Blendlink optimization report. */
  requiresKtx2?: boolean
  /** Direct evidence from the decoded GLB. External Meshopt scenes may
   * require a decoder without having a Blendlink optimization report. */
  requiresMeshopt?: boolean
  /** Exact compiler-owned request graph. The current descriptor may still
   * point at a mutable directory until graph-addressed publication is enabled. */
  runtimeAssetGraph?: DeepReadonly<SceneAssetGraph> | null
  /** Exact sum of uncompressed EXT_meshopt_compression buffer-view bytes.
   * Generated descriptors use it to avoid worker startup for small scenes. */
  meshoptDecodedBytes?: number
  playback?: Readonly<{
    start: 'manual' | 'first' | 'named' | 'all'
    clip?: string
    loop: 'once' | 'repeat' | 'pingpong'
    speed: number
  }> | null
  /** A single opt-in Blender NLA track compiled over ordinary glTF clips. */
  animationSequence?: DeepReadonly<AnimationSequenceRecipe> | null
  look?: Readonly<{
    toneMapping: 'application' | 'agx' | 'neutral' | 'aces' | 'none'
    exposure: number
    background: 'application' | 'transparent' | 'color'
    backgroundColor?: readonly [number, number, number]
  }> | null
  fog?: DeepReadonly<FogRecipe> | null
  shadows?: Readonly<{
    preset: 'application' | 'off' | 'performance' | 'balanced' | 'soft' | 'crisp' | 'custom'
    filter: 'basic' | 'pcf' | 'vsm'
    mapSize: number
    maxDistance: number
    bias: number
    normalBias: number
    radius: number
    autoUpdate: boolean
  }> | null
  /** Additive Blender authoring evidence. Production runtime adapters ignore
   * it unless their high-level installer explicitly opts into preview mode. */
  authoringPreview?: DeepReadonly<AuthoringPreview> | null
  environment?: Readonly<{
    source: 'application' | 'image'
    imageName?: string
    lighting: 'application' | 'image' | 'none'
    background: 'application' | 'image' | 'grounded' | 'none'
    lightingIntensity: number
    lightingRotation: number
    backgroundIntensity: number
    backgroundRotation: number
    backgroundBlur: number
    groundHeight: number
    groundRadius: number
  }> | null
  environmentAsset?: DeepReadonly<{
    url: string
    sourceName: string
    format: 'hdr' | 'exr'
    bytes: number
    hash: string
    source: 'packed' | 'linked'
    optimized?: {
      url: string
      format: 'ktx2'
      codec: 'r11g11b10-zstd'
      bytes: number
      hash: string
      encoder: 'KTX-Software'
      encoderVersion: string
      minThreeRevision: 180
      fidelity: {
        width: number
        height: number
        relativeRmse: number
        meanRelativeError: number
        peakRelativeError: number
        maxErrorOverPeak: number
        logLuminanceRmseStops: number
        sourcePeak: number
        decodedPeak: number
        sourceMin: number
        negativeChannels: number
        invalidPixels: number
      }
    }
  }> | null
  /** The per-channel TSL IR programs sidecar (Phase 4 material runtime
   * transport): fetch by url, pin content by hash. Absent when no compiled
   * material carries IR. */
  materialPrograms?: DeepReadonly<{
    url: string
    bytes: number
    hash: string
    materials: number
  }> | null
  /** Named local-reflection captures. Mesh assignments remain portable glTF
   * extras (`blendlink_reflection_probe` = probe objectId). */
  reflectionProbes?: readonly DeepReadonly<ReflectionProbeRecipe>[] | null
  /** Published equirectangular sources keyed by reflection-probe recipe id.
   * The high-level Three installer resolves these automatically; generic
   * renderers consume them through the reflection-probe loader seam. */
  reflectionProbeAssets?: DeepReadonly<Record<string, {
    url: string
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
  }>> | null
  /** Versioned, browser-owned LOD/instance evidence. Full compiler evidence
   * remains in the generated manifest instead of entering application JS. */
  runtimeDiagnostics?: DeepReadonly<RuntimeSceneDiagnostics> | null
  /** @deprecated Compatibility input for generated bindings created before
   * runtimeDiagnostics v1. New bindings keep full sceneDiagnostics only in
   * their manifest. */
  sceneDiagnostics?: DeepReadonly<SceneDiagnostics> | null
  /** Baked-composition assets are ordinary published textures. The optional
   * official Three installer consumes them through the generated, user-owned
   * `createBakedScene()` recipe rather than hiding a proprietary runtime in
   * the GLB. */
  states?: DeepReadonly<Record<string, string | Record<string, string>>>
  bakeOutputs?: DeepReadonly<Record<string, 'appearance' | 'lighting'>>
  stateScales?: DeepReadonly<Record<string, Record<string, number>>>
  lightGroups?: DeepReadonly<Record<
    string,
    | { url: string; maxValue: number }
    | Record<string, { url: string; maxValue: number }>
  >>
  defaultState?: string | null
  stateVisibility?: DeepReadonly<Record<string, {
    hiddenObjectIds: readonly string[]
    hiddenObjectNames: readonly string[]
  }>>
  /** Exported collision inventory. Proxy-only meshes stay in the loaded graph
   * for physics adapters but must never render. */
  colliders?: readonly DeepReadonly<{
    name: string
    proxyOnly: boolean
    loadedName?: string
    id?: string
  }>[]
}

export interface CompiledSceneLoaderOptions extends MeshoptWorkerOptions {
  /** A Three.js KTX2Loader already configured with transcoder path and
   * detectSupport(renderer). Blendlink cannot infer the site's renderer. */
  ktx2Loader?: unknown
}

export interface LoadedSceneLike<TRoot extends Object3DLike = Object3DLike> {
  scene: TRoot
  animations?: AnimationClipLike[]
  [key: string]: unknown
}

export interface AnimationClipLike {
  name: string
  duration?: number
  [key: string]: unknown
}

export interface AnimationActionLike {
  clampWhenFinished: boolean
  timeScale: number
  enabled?: boolean
  paused?: boolean
  time?: number
  weight?: number
  reset(): unknown
  setLoop(mode: unknown, repetitions: number): unknown
  play(): unknown
  stop?(): unknown
  setEffectiveWeight?(weight: number): unknown
  /** Three-compatible runtime activity signal. Generic adapters may omit it,
   * in which case scheduling remains conservatively continuous. */
  isRunning?(): boolean
}

export interface AnimationMixerLike {
  clipAction(clip: AnimationClipLike): AnimationActionLike
  update(deltaSeconds: number): unknown
  stopAllAction(): unknown
}

export type CompiledSceneAnimationPhase = 'idle' | 'playing' | 'paused' | 'finished'
export type CompiledSceneAnimationMode = 'clips' | 'sequence'

export interface CompiledSceneAnimationClip {
  readonly name: string
  readonly duration: number | null
}

export interface CompiledSceneAnimationState {
  readonly phase: CompiledSceneAnimationPhase
  readonly mode: CompiledSceneAnimationMode
  /** Authored clip/sequence seconds, independent of the configured speed. */
  readonly time: number
  /** Null only for a non-glTF/custom adapter that omitted clip duration. Such
   * playback remains conservatively continuous until explicitly stopped. */
  readonly duration: number | null
  readonly activeClips: readonly string[]
}

/**
 * Small application-facing animation surface. Blender owns clips, NLA timing,
 * loop, and speed; the website may control transport without taking ownership
 * of Three mixers/actions or importing an Animator/state-machine abstraction.
 */
export interface CompiledSceneAnimationTransport {
  readonly availableClips: readonly CompiledSceneAnimationClip[]
  readonly state: CompiledSceneAnimationState
  /** True only while authored playback still needs render-loop updates. */
  readonly requiresContinuousFrames: boolean
  /** Resume the current selection, start the first clip from idle, or restart
   * one exact named clip. An authored NLA sequence accepts no clip override. */
  play(clip?: string): void
  /** Start every ordinary glTF clip together. NLA sequences reject this. */
  playAll(): void
  pause(): void
  /** Seek in authored clip/sequence seconds and evaluate the pose immediately. */
  seek(timeSeconds: number): void
  /** Return to an idle start pose while retaining replay capability. */
  stop(): void
  /** Read `state` for the initial snapshot. Future notifications are
   * synchronous and serialized: reentrant commands queue a newer snapshot
   * until every listener observes the current one. Listener failures are
   * aggregated and thrown only after delivery completes. */
  subscribe(listener: (state: CompiledSceneAnimationState) => void): () => void
}

export interface CompiledScenePlayback<TMixer extends AnimationMixerLike = AnimationMixerLike>
  extends CompiledSceneAnimationTransport {
  mixer: TMixer
  clips: AnimationClipLike[]
  actions: AnimationActionLike[]
  update(deltaSeconds: number): void
  /** Permanently release the transport. Repeated disposal is a no-op. */
  dispose(): void
}

export interface CompiledScenePlaybackOptions<TMixer extends AnimationMixerLike = AnimationMixerLike> {
  createMixer(root: Object3DLike): TMixer
  /** Pass Three's LoopOnce, LoopRepeat, and LoopPingPong constants. */
  loopModes: { once: unknown; repeat: unknown; pingpong: unknown }
  /** Required only for an authored NLA sequence. Return a distinct clip for
   * every strip; convert additive strips with the host library's native tool. */
  createSequenceClip?(
    source: AnimationClipLike,
    strip: AnimationSequenceStrip,
  ): AnimationClipLike
  /** Demand-mode host invalidation after an imperative transport command. */
  requestFrame?(): unknown
}

export interface RendererLookLike {
  toneMapping?: unknown
  toneMappingExposure?: number
  setClearAlpha?(alpha: number): unknown
  /** Three.js exposes this alongside setClearAlpha(). It is required when
   * Blendlink owns transparency so the previous application value can be
   * restored without guessing. */
  getClearAlpha?(): number
  getContextAttributes?(): { alpha?: boolean } | null
  /** WebGPURenderer's surface-transparency choice: it has no
   * getContextAttributes(), so the transparency guard reads this public
   * constructor-mirrored flag instead. */
  alpha?: boolean
}

export interface SceneLookLike {
  background?: unknown
}

export interface EulerLike {
  x?: number
  y?: number
  z?: number
  set(x: number, y: number, z: number): unknown
}

export interface SceneEnvironmentLike extends SceneLookLike {
  environment?: unknown
  environmentIntensity?: number
  environmentRotation?: EulerLike
  backgroundIntensity?: number
  backgroundRotation?: EulerLike
  backgroundBlurriness?: number
  add?(object: unknown): unknown
  remove?(object: unknown): unknown
}

export interface EnvironmentTextureLike {
  mapping?: unknown
  minFilter?: unknown
  magFilter?: unknown
  needsUpdate?: boolean
  dispose?(): unknown
}

export interface CompiledSceneEnvironmentOptions {
  loaders: {
    hdr: { loadAsync(url: string): Promise<EnvironmentTextureLike> }
    exr: { loadAsync(url: string): Promise<EnvironmentTextureLike> }
    /** Three r180+ KTX2Loader, configured for the site's renderer. */
    ktx2?: { loadAsync(url: string): Promise<EnvironmentTextureLike> }
  }
  /** Defaults true. False always uses the byte-exact source. */
  preferOptimized?: boolean
  /** Receives a recoverable KTX2 load failure before the raw fallback loads. */
  onWarning?(message: string): unknown
  /** Pass Three's LinearFilter constant. KTX2Loader conservatively gives raw
   * packed-float DataTextures nearest filtering; Blendlink will not prefer the
   * derivative unless it can restore correct environment interpolation. */
  linearFilter?: unknown
  /** Pass Three's EquirectangularReflectionMapping constant. */
  equirectangularReflectionMapping: unknown
  /** Typically constructs three/addons/objects/GroundedSkybox and applies
   * any project-specific intensity/blur policy to its material. */
  createGroundedBackground?(
    texture: EnvironmentTextureLike,
    settings: { height: number; radius: number; intensity: number; rotation: number; blur: number },
  ): unknown
  /** Optional companion for adapters that allocate geometry/material resources
   * while constructing their grounded background. It runs after scene removal. */
  disposeGroundedBackground?(background: unknown): unknown
}

export interface CompiledSceneLook {
  /** Restore only values that are still owned by this application. Safe to call
   * repeatedly; later application/site changes are left untouched. */
  dispose(): void
}

export type PreparedCompiledSceneLookState =
  | 'prepared'
  | 'committed'
  | 'failed'
  | 'disposed'

export interface PreparedCompiledSceneLook {
  readonly state: PreparedCompiledSceneLookState
  commit(): CompiledSceneLook
  dispose(): void
}

export interface CompiledSceneEnvironment {
  texture: EnvironmentTextureLike | null
  source: 'optimized' | 'original' | null
  groundedBackground: unknown | null
  dispose(): void
}

export type PreparedCompiledSceneEnvironmentState =
  | 'prepared'
  | 'committed'
  | 'failed'
  | 'disposed'

/** Target-specific environment resources that are fully loaded but have not
 * changed the target Scene. `commit()` is synchronous and exact-once; either
 * the returned installed handle or this lease may release committed ownership. */
export interface PreparedCompiledSceneEnvironment {
  readonly state: PreparedCompiledSceneEnvironmentState
  readonly texture: EnvironmentTextureLike | null
  readonly source: 'optimized' | 'original' | null
  readonly groundedBackground: unknown | null
  commit(): CompiledSceneEnvironment
  dispose(): void
}

export interface ShadowMapSizeLike {
  width?: number
  height?: number
  set?(width: number, height: number): unknown
}

export interface LightShadowLike {
  mapSize?: ShadowMapSizeLike
  camera?: { far?: number; updateProjectionMatrix?(): unknown }
  bias?: number
  normalBias?: number
  radius?: number
}

export interface RendererShadowsLike {
  shadowMap?: { enabled?: boolean; autoUpdate?: boolean; needsUpdate?: boolean; type?: unknown }
}

export interface CompiledSceneShadowOptions {
  /** Pass Three's BasicShadowMap, PCFShadowMap, and VSMShadowMap constants. */
  shadowMapTypes: { basic: unknown; pcf: unknown; vsm: unknown }
}

export interface CompiledSceneShadowReport {
  lightsConfigured: number
  /** Exact configured shadow-map texels: six square faces for Point lights,
   * one for Spot and Directional lights. Renderer padding is not included. */
  shadowPixels: number
  /** Restore renderer/light shadow settings that are still owned by this
   * installation. Later application changes remain untouched. */
  dispose(): void
}

export type PreparedCompiledSceneShadowsState =
  | 'prepared'
  | 'committed'
  | 'failed'
  | 'disposed'

/** Root-local light policy prepared on an exclusively owned detached graph.
 * Renderer ownership is delayed until the exact-once synchronous commit. */
export interface PreparedCompiledSceneShadows {
  readonly state: PreparedCompiledSceneShadowsState
  readonly lightsConfigured: number
  readonly shadowPixels: number
  commit(): CompiledSceneShadowReport
  dispose(): void
}

export interface CompiledSceneLookOptions {
  toneMappings?: { agx: unknown; neutral: unknown; aces: unknown; none: unknown }
  /** Typically `(rgb) => new THREE.Color().setRGB(...rgb)`. */
  createColor?(linearRgb: readonly [number, number, number]): unknown
}

export interface SceneBindings<TObject extends Object3DLike = Object3DLike> {
  byName: Record<string, TObject>
  byId: Record<string, TObject>
  object(idOrName: string): TObject
  /** Per-Blender-object shadow intent resolved onto any private primitive
   * wrappers created by a loader. Intent deliberately stops at the next
   * authored object boundary; Blender shadow toggles are not inherited. */
  shadowIntent?(object: Object3DLike): Readonly<{
    cast?: boolean
    receive?: boolean
  }> | undefined
  /** Restore only authored visibility/shadow values still owned by this
   * binding. Later application changes are deliberately left untouched. */
  dispose(): void
}

export interface CompiledSceneShadowIntent {
  cast?: boolean
  receive?: boolean
}

/** Resolve per-object intent through loader-private primitive wrappers only.
 * The next authored object is a hard boundary because Blender parenting does
 * not make cast/receive settings inherit. Kept renderer-agnostic so cached or
 * application-owned bindings can use the exact same rule. */
export function resolveCompiledSceneShadowIntents(
  root: Object3DLike,
  authoredObjects: ReadonlySet<Object3DLike>,
  explicitIntents: ReadonlyMap<Object3DLike, CompiledSceneShadowIntent>,
): Map<Object3DLike, CompiledSceneShadowIntent> {
  const resolvedIntents = new Map<Object3DLike, CompiledSceneShadowIntent>()
  const visit = (
    object: Object3DLike,
    inherited: CompiledSceneShadowIntent,
  ): void => {
    const own = explicitIntents.get(object)
    const base = authoredObjects.has(object) ? {} : inherited
    const resolved = {
      cast: own?.cast ?? base.cast,
      receive: own?.receive ?? base.receive,
    }
    if (resolved.cast !== undefined || resolved.receive !== undefined) {
      resolvedIntents.set(object, resolved)
    }
    for (const child of object.children ?? []) visit(child, resolved)
  }
  visit(root, {})
  return resolvedIntents
}

export function configureCompiledSceneLoader(
  loader: {
    setMeshoptDecoder?(decoder: unknown): unknown
    setKTX2Loader?(loader: unknown): unknown
  },
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneLoaderOptions = {},
): void {
  if (descriptor.requiresMeshopt === true || descriptor.optimization?.geometry === 'meshopt') {
    if (!loader.setMeshoptDecoder) {
      throw new Error(
        'This Blendlink scene uses Meshopt compression, but the supplied loader ' +
          'does not expose setMeshoptDecoder(). Use Three.js GLTFLoader or turn ' +
          'Geometry Compression off in Blender.',
      )
    }
    // Validate explicit policy without touching Worker/Blob/URL. The actual
    // browser capability decision belongs to the awaited high-level load.
    validateMeshoptWorkerOptions(options)
    if (!options.meshoptDecoder) {
      resolveMeshoptWorkerPolicy(descriptor.meshoptDecodedBytes, options, {
        canCreateWorkers: false,
      })
    }
    // Configuration is intentionally side-effect free. High-level load seams
    // replace this adapter with a leased worker decoder only while a large GLB
    // is actually loading.
    loader.setMeshoptDecoder(options.meshoptDecoder ?? mainThreadMeshoptDecoder)
  }
  if (descriptor.requiresKtx2 === true || descriptor.textureCompression?.format === 'ktx2') {
    if (!loader.setKTX2Loader) {
      throw new Error(
        'This Blendlink scene uses KTX2 GPU textures, but the supplied loader ' +
          'does not expose setKTX2Loader(). Use Three.js GLTFLoader or set GPU Textures to Original in Blender.',
      )
    }
    if (!options.ktx2Loader) {
      throw new Error(
        'This Blendlink scene uses KTX2 GPU textures. Pass a shared Three.js KTX2Loader through ' +
          '{ ktx2Loader } after calling setTranscoderPath() and detectSupport(renderer).',
      )
    }
    loader.setKTX2Loader(options.ktx2Loader)
  }
}

/** Resolve artist-authored startup intent and return one transport/render-loop
 * object. A Manual scene with exported clips returns an idle transport so the
 * website can play it later; a scene with no animation still returns null. */
export function startCompiledScenePlayback<TMixer extends AnimationMixerLike>(
  loaded: LoadedSceneLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledScenePlaybackOptions<TMixer>,
): CompiledScenePlayback<TMixer> | null {
  const listeners = new Set<(state: CompiledSceneAnimationState) => void>()
  const availableClips = Object.freeze((loaded.animations ?? []).map((clip) => Object.freeze({
    name: clip.name,
    duration: typeof clip.duration === 'number' && Number.isFinite(clip.duration)
      ? Math.max(0, clip.duration)
      : null,
  })))
  let disposed = false
  const ensureLive = (): void => {
    if (disposed) throw new Error('This Blendlink animation transport has been disposed.')
  }
  const requestFrame = (): void => { options.requestFrame?.() }

  const sequence = descriptor.animationSequence
  if (sequence) {
    if (!options.createSequenceClip) {
      throw new Error(
        `Blendlink animation sequence "${sequence.name}" needs a createSequenceClip adapter. ` +
          'The official Three.js installer supplies it automatically.',
      )
    }
    const running = startAnimationSequence(
      loaded.scene,
      loaded.animations ?? [],
      sequence as AnimationSequenceRecipe,
      {
        createMixer: options.createMixer,
        createStripClip: options.createSequenceClip,
        loopOnce: options.loopModes.once,
      },
    )
    let phase: CompiledSceneAnimationPhase = 'playing'
    const sequenceClips = Object.freeze([...new Set(
      sequence.strips.filter((strip) => !strip.muted).map((strip) => strip.clip),
    )])
    let activeClips: readonly string[] = sequenceClips
    const snapshot = (): CompiledSceneAnimationState => Object.freeze({
      phase,
      mode: 'sequence',
      time: running.time,
      duration: sequence.duration,
      activeClips,
    })
    const notify = createAnimationStateNotifier(listeners, snapshot)
    const transport: CompiledScenePlayback<TMixer> = {
      mixer: running.mixer,
      clips: [...running.clips],
      actions: running.actions as AnimationActionLike[],
      availableClips,
      get state() { return snapshot() },
      get requiresContinuousFrames() { return phase === 'playing' },
      play(clip) {
        ensureLive()
        if (clip !== undefined && clip !== sequence.name) {
          throw new Error(
            `Blendlink scene uses authored NLA sequence "${sequence.name}"; ` +
              `play() cannot select ordinary clip "${clip}". Remove the Website NLA Sequence ` +
              'in Blender when the application must select independent clips.',
          )
        }
        if (running.finished) {
          running.seek(0)
          running.resume()
        } else if (phase === 'paused') {
          running.resume()
        } else if (phase === 'idle' || phase === 'finished') {
          running.seek(0)
          running.resume()
        }
        activeClips = sequenceClips
        phase = 'playing'
        try { notify() } finally { requestFrame() }
      },
      playAll() {
        ensureLive()
        throw new Error(
          `Blendlink scene uses authored NLA sequence "${sequence.name}"; ` +
            'playAll() would bypass Blender-authored strip timing.',
        )
      },
      pause() {
        ensureLive()
        if (phase !== 'playing') return
        running.pause()
        phase = 'paused'
        notify()
      },
      seek(timeSeconds) {
        ensureLive()
        assertAnimationTransportTime(timeSeconds, 'seek')
        running.seek(timeSeconds)
        if (phase === 'finished' && running.time < sequence.duration) phase = 'paused'
        if (!sequence.loop && running.finished && phase === 'playing') phase = 'finished'
        try { notify() } finally { requestFrame() }
      },
      stop() {
        ensureLive()
        running.pause()
        running.seek(0)
        phase = 'idle'
        activeClips = Object.freeze([])
        try { notify() } finally { requestFrame() }
      },
      subscribe(listener) {
        ensureLive()
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      update(deltaSeconds) {
        ensureLive()
        assertAnimationTransportDelta(deltaSeconds)
        if (phase !== 'playing') return
        running.update(deltaSeconds)
        if (running.finished) phase = 'finished'
        try { notify() } catch (error) {
          if (phase === 'playing') requestFrame()
          throw error
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        running.stop()
        listeners.clear()
      },
    }
    return transport
  }

  const recipe = descriptor.playback ?? { start: 'manual', loop: 'repeat', speed: 1 }
  const available = loaded.animations ?? []
  if (available.length === 0) {
    if (recipe.start === 'manual') return null
    throw new Error(
      `Blendlink animation startup is set to ${recipe.start}, but this GLB contains no animation clips. ` +
        'Set When the Page Loads to Start Still in Blender or export an action.',
    )
  }
  if (recipe.start === 'named' && !available.some((candidate) => candidate.name === recipe.clip)) {
    throw new Error(
      `Blendlink autoplay clip "${recipe.clip ?? ''}" was not exported. ` +
        `Available clips: ${available.map((candidate) => candidate.name || '(unnamed)').join(', ') || 'none'}.`,
    )
  }

  const mixer = options.createMixer(loaded.scene)
  const clips: AnimationClipLike[] = []
  const actions: AnimationActionLike[] = []
  const actionByClip = new Map<AnimationClipLike, AnimationActionLike>()
  let phase: CompiledSceneAnimationPhase = 'idle'
  let time = 0
  let elapsed = 0
  let duration: number | null = 0
  let activeClips: readonly string[] = Object.freeze([])
  let allSelected = false

  const snapshot = (): CompiledSceneAnimationState => Object.freeze({
    phase,
    mode: 'clips',
    time,
    duration,
    activeClips,
  })
  const notify = createAnimationStateNotifier(listeners, snapshot)
  const actionFor = (clip: AnimationClipLike): AnimationActionLike => {
    let action = actionByClip.get(clip)
    if (!action) {
      action = mixer.clipAction(clip)
      actionByClip.set(clip, action)
    }
    return action
  }
  const clipDuration = (clip: AnimationClipLike): number | null =>
    typeof clip.duration === 'number' && Number.isFinite(clip.duration)
      ? Math.max(0, clip.duration)
      : null
  const configureSelection = (selected: readonly AnimationClipLike[], selectAll: boolean): void => {
    mixer.stopAllAction()
    clips.splice(0, clips.length, ...selected)
    actions.splice(0, actions.length)
    const loopMode = options.loopModes[recipe.loop]
    const repetitions = recipe.loop === 'once' ? 1 : Infinity
    const staticActions: AnimationActionLike[] = []
    for (const clip of selected) {
      const action = actionFor(clip)
      const localDuration = clipDuration(clip)
      const staticPose = localDuration === 0
      action.reset()
      action.timeScale = recipe.speed
      action.clampWhenFinished = staticPose || recipe.loop === 'once'
      action.setLoop(staticPose ? options.loopModes.once : loopMode, staticPose ? 1 : repetitions)
      action.paused = false
      action.play()
      actions.push(action)
      if (staticPose) staticActions.push(action)
    }
    allSelected = selectAll
    activeClips = Object.freeze(selected.map((clip) => clip.name))
    const selectedDurations = selected.map(clipDuration)
    duration = selectedDurations.some((value) => value === null)
      ? null
      : (selectedDurations as number[]).reduce((largest, value) => Math.max(largest, value), 0)
    time = 0
    elapsed = 0
    // A zero-span Action is a static authored sample, not an infinite
    // animation. Three's Repeat/PingPong paths divide by clip duration, so
    // sample it once through LoopOnce and keep the resulting pose paused.
    if (staticActions.length > 0) {
      mixer.update(0)
      for (const action of staticActions) action.paused = true
    }
    phase = duration === 0 ? 'finished' : 'playing'
    try { notify() } finally { requestFrame() }
  }
  const selectedClipForPlay = (name: string): AnimationClipLike => {
    const matches = available.filter((candidate) => candidate.name === name)
    if (matches.length === 0) {
      throw new Error(
        `Blendlink animation clip "${name}" was not exported. ` +
          `Available clips: ${available.map((candidate) => candidate.name || '(unnamed)').join(', ') || 'none'}.`,
      )
    }
    if (matches.length > 1) {
      throw new Error(
        `Blendlink animation clip name "${name}" is ambiguous (${matches.length} exported clips). ` +
          'Rename the Blender Actions so application transport names are unique.',
      )
    }
    return matches[0]!
  }

  const transport: CompiledScenePlayback<TMixer> = {
    mixer,
    clips,
    actions,
    availableClips,
    get state() { return snapshot() },
    get requiresContinuousFrames() { return phase === 'playing' },
    play(clip) {
      ensureLive()
      if (clip !== undefined) {
        configureSelection([selectedClipForPlay(clip)], false)
        return
      }
      if (phase === 'paused') {
        for (const action of actions) action.paused = false
        phase = 'playing'
        try { notify() } finally { requestFrame() }
        return
      }
      if (phase === 'playing') return
      if (clips.length > 0) {
        configureSelection([...clips], allSelected)
        return
      }
      configureSelection([available[0]!], false)
    },
    playAll() {
      ensureLive()
      configureSelection(available, true)
    },
    pause() {
      ensureLive()
      if (phase !== 'playing') return
      for (const action of actions) action.paused = true
      phase = 'paused'
      notify()
    },
    seek(timeSeconds) {
      ensureLive()
      assertAnimationTransportTime(timeSeconds, 'seek')
      const target = duration === null
        ? timeSeconds
        : duration > 0
          ? Math.min(timeSeconds, duration)
          : 0
      time = target
      elapsed = target
      for (const [index, action] of actions.entries()) {
        const localDuration = clipDuration(clips[index]!)
        const staticPose = localDuration === 0
        action.reset()
        action.timeScale = recipe.speed
        action.clampWhenFinished = staticPose || recipe.loop === 'once'
        action.setLoop(
          staticPose ? options.loopModes.once : options.loopModes[recipe.loop],
          staticPose || recipe.loop === 'once' ? 1 : Infinity,
        )
        action.play()
        action.time = localDuration === null
          ? target
          : animationClipSampleTime(target, localDuration, recipe.loop)
        action.paused = staticPose || phase !== 'playing'
      }
      mixer.update(0)
      if (phase === 'finished' && (duration === null || target < duration)) {
        for (const action of actions) action.paused = true
        phase = 'paused'
      } else if (recipe.loop === 'once' && duration !== null
          && target >= duration && phase === 'playing') {
        phase = 'finished'
      }
      try { notify() } finally { requestFrame() }
    },
    stop() {
      ensureLive()
      mixer.stopAllAction()
      clips.splice(0)
      actions.splice(0)
      activeClips = Object.freeze([])
      allSelected = false
      time = 0
      elapsed = 0
      duration = 0
      phase = 'idle'
      try { notify() } finally { requestFrame() }
    },
    update(deltaSeconds) {
      ensureLive()
      assertAnimationTransportDelta(deltaSeconds)
      if (phase !== 'playing') return
      mixer.update(deltaSeconds)
      elapsed += deltaSeconds * recipe.speed
      if (recipe.loop === 'once' && duration !== null && elapsed >= duration) {
        time = duration
        phase = 'finished'
      } else {
        time = duration === null
          ? elapsed
          : animationClipSampleTime(elapsed, duration, recipe.loop)
      }
      try { notify() } catch (error) {
        if (phase === 'playing') requestFrame()
        throw error
      }
    },
    subscribe(listener) {
      ensureLive()
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      mixer.stopAllAction()
      listeners.clear()
    },
  }
  if (recipe.start === 'all') configureSelection(available, true)
  else if (recipe.start === 'named') configureSelection([selectedClipForPlay(recipe.clip ?? '')], false)
  else if (recipe.start === 'first') configureSelection(available.slice(0, 1), false)
  return transport
}

function createAnimationStateNotifier(
  listeners: Set<(state: CompiledSceneAnimationState) => void>,
  snapshot: () => CompiledSceneAnimationState,
): () => void {
  let notifying = false
  let pending = false
  return () => {
    pending = true
    if (notifying) return
    notifying = true
    const failures: unknown[] = []
    try {
      while (pending) {
        pending = false
        const state = snapshot()
        // Reentrant commands queue their newer snapshot until every listener
        // has observed this one. No listener can therefore receive a stale
        // outer state after the nested state it caused.
        for (const listener of [...listeners]) {
          try { listener(state) } catch (error) { failures.push(error) }
        }
      }
    } finally {
      notifying = false
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        failures.length === 1
          ? `Blendlink animation observer failed: ${animationObserverMessage(failures[0])}`
          : `${failures.length} Blendlink animation observers failed: ` +
            failures.map(animationObserverMessage).join('; '),
      )
    }
  }
}

function animationObserverMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function assertAnimationTransportTime(value: number, operation: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Blendlink animation ${operation} needs a non-negative finite time in seconds; got ${value}.`,
    )
  }
}

function assertAnimationTransportDelta(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Blendlink playback update needs a non-negative delta in seconds; got ${value}.`)
  }
}

function positiveAnimationModulo(value: number, divisor: number): number {
  if (!(divisor > 0)) return 0
  return ((value % divisor) + divisor) % divisor
}

function animationClipSampleTime(
  time: number,
  duration: number,
  loop: 'once' | 'repeat' | 'pingpong',
): number {
  if (!(duration > 0)) return 0
  if (loop === 'once') return Math.min(Math.max(0, time), duration)
  if (loop === 'repeat') return positiveAnimationModulo(time, duration)
  const cycle = positiveAnimationModulo(time, duration * 2)
  return cycle <= duration ? cycle : duration * 2 - cycle
}

interface PropertyInstallation {
  target: object
  key: PropertyKey
  hadOwnValue: boolean
  previous: unknown
  installed: unknown
}

function installProperty(
  target: object,
  key: PropertyKey,
  installed: unknown,
  installations: PropertyInstallation[],
): void {
  const values = target as Record<PropertyKey, unknown>
  installations.push({
    target,
    key,
    hadOwnValue: Object.prototype.hasOwnProperty.call(target, key),
    previous: values[key],
    installed,
  })
  values[key] = installed
}

function restoreProperty(installation: PropertyInstallation, conditional: boolean): void {
  const values = installation.target as Record<PropertyKey, unknown>
  if (conditional && !Object.is(values[installation.key], installation.installed)) return
  if (installation.hadOwnValue) values[installation.key] = installation.previous
  else {
    // Assign first so prototype setters receive the previous value, then avoid
    // leaving a new own-property behind when this began as inherited/absent.
    values[installation.key] = installation.previous
    if (Object.prototype.hasOwnProperty.call(installation.target, installation.key) &&
        Object.is(values[installation.key], installation.previous)) {
      delete values[installation.key]
    }
  }
}

function propertyStillInstalled(installation: PropertyInstallation): boolean {
  const values = installation.target as Record<PropertyKey, unknown>
  return Object.is(values[installation.key], installation.installed)
}

function cleanupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function attemptCleanup(errors: unknown[], cleanup: () => void): void {
  try {
    cleanup()
  } catch (error) {
    errors.push(error)
  }
}

function throwFirstCleanupError(context: string, errors: unknown[]): void {
  if (errors.length === 0) return
  throw new Error(`${context}: ${errors.map(cleanupErrorMessage).join('; ')}`)
}

/** Apply only the look choices the artist explicitly took ownership of.
 * "application" leaves existing renderer/scene values untouched. The returned
 * handle restores this adapter's values only while they are still installed. */
function installCompiledSceneLook(
  renderer: RendererLookLike,
  scene: SceneLookLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneLookOptions,
): CompiledSceneLook {
  const look = descriptor.look
  if (!look) return { dispose() {} }

  let toneMapping: unknown
  if (look.toneMapping !== 'application') {
    if (!options.toneMappings) {
      throw new Error(
        'This Blendlink scene owns tone mapping. Pass Three\'s AgXToneMapping, NeutralToneMapping, ' +
          'ACESFilmicToneMapping, and NoToneMapping constants to applyCompiledSceneLook().',
      )
    }
    toneMapping = options.toneMappings[look.toneMapping]
  }

  let background: unknown
  let clearAlpha: number | null = null
  if (look.background === 'transparent') {
    if (!renderer.setClearAlpha || !renderer.getClearAlpha) {
      throw new Error(
        'This Blendlink scene requests a transparent page background, but the supplied renderer ' +
          'does not expose both setClearAlpha() and getClearAlpha() for lifecycle-safe restoration.',
      )
    }
    const attributesAlpha = renderer.getContextAttributes
      ? renderer.getContextAttributes()?.alpha
      // WebGPURenderer has no getContextAttributes(); it reports the same
      // choice through its public alpha property (constructor default true).
      : renderer.alpha
    if (attributesAlpha === false) {
      throw new Error(
        'This Blendlink scene requests a transparent page background. Construct the Three renderer ' +
          'with { alpha: true } before applying the scene look.',
      )
    }
    background = null
    clearAlpha = 0
  } else if (look.background === 'color') {
    if (!look.backgroundColor || !options.createColor) {
      throw new Error(
        'This Blendlink scene owns a solid background color. Pass createColor(rgb) to ' +
          'applyCompiledSceneLook() so the renderer adapter can construct its native Color.',
      )
    }
    // Construct the native value before touching renderer or scene state. A
    // throwing application adapter therefore cannot leave a half-applied look.
    background = options.createColor(look.backgroundColor)
    if (renderer.setClearAlpha && renderer.getClearAlpha) clearAlpha = 1
  }

  const toneInstallations: PropertyInstallation[] = []
  const backgroundInstallations: PropertyInstallation[] = []
  const previousClearAlpha = clearAlpha === null ? null : renderer.getClearAlpha!()
  try {
    if (look.toneMapping !== 'application') {
      installProperty(renderer, 'toneMapping', toneMapping, toneInstallations)
      installProperty(renderer, 'toneMappingExposure', 2 ** look.exposure, toneInstallations)
    }
    if (look.background !== 'application') {
      installProperty(scene, 'background', background, backgroundInstallations)
    }
    if (clearAlpha !== null) renderer.setClearAlpha!(clearAlpha)
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (clearAlpha !== null && previousClearAlpha !== null) {
      attemptCleanup(rollbackErrors, () => { renderer.setClearAlpha!(previousClearAlpha) })
    }
    for (const installation of [...toneInstallations, ...backgroundInstallations].reverse()) {
      attemptCleanup(rollbackErrors, () => restoreProperty(installation, false))
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Could not apply the Blendlink scene look: ${cleanupErrorMessage(error)}. ` +
          `Rollback also failed: ${rollbackErrors.map(cleanupErrorMessage).join('; ')}`,
      )
    }
    throw error
  }

  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      const cleanupErrors: unknown[] = []
      if (toneInstallations.every(propertyStillInstalled)) {
        for (const installation of toneInstallations.slice().reverse()) {
          attemptCleanup(cleanupErrors, () => restoreProperty(installation, true))
        }
      }
      let ownsClearAlpha = clearAlpha === null
      if (clearAlpha !== null) {
        try {
          ownsClearAlpha = Object.is(renderer.getClearAlpha!(), clearAlpha)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      const ownsBackground = backgroundInstallations.every(propertyStillInstalled) && ownsClearAlpha
      if (ownsBackground) {
        if (clearAlpha !== null && previousClearAlpha !== null) {
          attemptCleanup(cleanupErrors, () => { renderer.setClearAlpha!(previousClearAlpha) })
        }
        for (const installation of backgroundInstallations.slice().reverse()) {
          attemptCleanup(cleanupErrors, () => restoreProperty(installation, true))
        }
      }
      throwFirstCleanupError('Could not fully dispose the Blendlink scene look', cleanupErrors)
    },
  }
}

/** Resolve and validate artist-owned look values without touching the live
 * renderer or Scene. The returned target-specific lease snapshots application
 * state only when its synchronous commit runs. */
export function prepareCompiledSceneLook(
  renderer: RendererLookLike,
  scene: SceneLookLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneLookOptions,
): PreparedCompiledSceneLook {
  const look = descriptor.look
  let preparedColor: unknown
  if (look?.toneMapping !== undefined && look.toneMapping !== 'application'
      && !options.toneMappings) {
    throw new Error(
      'This Blendlink scene owns tone mapping. Pass Three\'s AgXToneMapping, NeutralToneMapping, ' +
        'ACESFilmicToneMapping, and NoToneMapping constants to applyCompiledSceneLook().',
    )
  }
  if (look?.background === 'transparent') {
    if (!renderer.setClearAlpha || !renderer.getClearAlpha) {
      throw new Error(
        'This Blendlink scene requests a transparent page background, but the supplied renderer ' +
          'does not expose both setClearAlpha() and getClearAlpha() for lifecycle-safe restoration.',
      )
    }
    if (renderer.getContextAttributes?.()?.alpha === false) {
      throw new Error(
        'This Blendlink scene requests a transparent page background. Construct the Three renderer ' +
          'with { alpha: true } before applying the scene look.',
      )
    }
  } else if (look?.background === 'color') {
    if (!look.backgroundColor || !options.createColor) {
      throw new Error(
        'This Blendlink scene owns a solid background color. Pass createColor(rgb) to ' +
          'applyCompiledSceneLook() so the renderer adapter can construct its native Color.',
      )
    }
    preparedColor = options.createColor(look.backgroundColor)
  }

  let state: PreparedCompiledSceneLookState = 'prepared'
  let installed: CompiledSceneLook | null = null
  return {
    get state() { return state },
    commit() {
      if (state !== 'prepared') {
        throw new Error(`This prepared Blendlink scene look is ${state}; commit() may run exactly once.`)
      }
      try {
        const inner = installCompiledSceneLook(renderer, scene, descriptor, {
          ...options,
          ...(look?.background === 'color'
            ? { createColor: () => preparedColor }
            : {}),
        })
        state = 'committed'
        let disposed = false
        installed = {
          dispose() {
            if (disposed) return
            disposed = true
            state = 'disposed'
            inner.dispose()
          },
        }
        return installed
      } catch (error) {
        state = 'failed'
        throw error
      }
    },
    dispose() {
      if (state === 'disposed') return
      if (state === 'committed') {
        installed?.dispose()
        return
      }
      state = 'disposed'
    },
  }
}

/** Compatibility seam: prepare pure look values, then commit them without an
 * asynchronous gap. */
export function applyCompiledSceneLook(
  renderer: RendererLookLike,
  scene: SceneLookLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneLookOptions,
): CompiledSceneLook {
  return prepareCompiledSceneLook(renderer, scene, descriptor, options).commit()
}

/** Apply an explicit scene-wide shadow budget to each participating light.
 * A namespaced per-light `blendlink_cast_shadow=false` remains authoritative;
 * the scene preset owns quality and budget, not whether an artist-disabled
 * source light starts casting. Mesh intent is applied by bindCompiledScene(). */
function applyCompiledSceneShadowsNow(
  renderer: RendererShadowsLike,
  root: Object3DLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneShadowOptions,
): CompiledSceneShadowReport {
  const recipe = descriptor.shadows
  const noOp = (): CompiledSceneShadowReport => ({
    lightsConfigured: 0,
    shadowPixels: 0,
    dispose() {},
  })
  if (!recipe || recipe.preset === 'application') return noOp()
  if (!renderer.shadowMap) {
    throw new Error(
      'This Blendlink scene owns realtime shadow quality, but the supplied renderer does not expose shadowMap.',
    )
  }
  const installations: PropertyInstallation[] = []
  const projectionCameras = new Set<NonNullable<LightShadowLike['camera']>>()
  const install = (target: object, key: PropertyKey, value: unknown) => {
    installProperty(target, key, value, installations)
  }
  const rollback = (conditional: boolean): unknown[] => {
    const errors: unknown[] = []
    for (const installation of installations.slice().reverse()) {
      attemptCleanup(errors, () => restoreProperty(installation, conditional))
    }
    for (const camera of projectionCameras) {
      attemptCleanup(errors, () => { camera.updateProjectionMatrix?.() })
    }
    return errors
  }
  if (recipe.preset === 'off') {
    install(renderer.shadowMap, 'enabled', false)
    let disposed = false
    return {
      lightsConfigured: 0,
      shadowPixels: 0,
      dispose() {
        if (disposed) return
        disposed = true
        throwFirstCleanupError('Could not fully dispose Blendlink shadows', rollback(true))
      },
    }
  }
  let lightsConfigured = 0
  let shadowPixels = 0
  const configure = (object: Object3DLike) => {
    const shadow = object.shadow
    if (!shadow) return
    if (object.userData?.blendlink_cast_shadow === false) return
    lightsConfigured += 1
    shadowPixels += recipe.mapSize ** 2 * (object.isPointLight ? 6 : 1)
    install(object, 'castShadow', true)
    if (shadow.mapSize) {
      install(shadow.mapSize, 'width', recipe.mapSize)
      install(shadow.mapSize, 'height', recipe.mapSize)
    }
    install(shadow, 'bias', recipe.bias)
    install(shadow, 'normalBias', recipe.normalBias)
    install(shadow, 'radius', recipe.radius)
    if (shadow.camera) {
      install(shadow.camera, 'far', recipe.maxDistance)
      projectionCameras.add(shadow.camera)
      shadow.camera.updateProjectionMatrix?.()
    }
  }
  try {
    install(renderer.shadowMap, 'enabled', true)
    install(renderer.shadowMap, 'type', options.shadowMapTypes[recipe.filter])
    install(renderer.shadowMap, 'autoUpdate', recipe.autoUpdate)
    install(renderer.shadowMap, 'needsUpdate', true)
    if (root.traverse) root.traverse(configure)
    else walk(root, configure)
  } catch (error) {
    const rollbackErrors = rollback(false)
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Could not apply Blendlink shadows: ${cleanupErrorMessage(error)}. ` +
          `Rollback also failed: ${rollbackErrors.map(cleanupErrorMessage).join('; ')}`,
      )
    }
    throw error
  }
  let disposed = false
  return {
    lightsConfigured,
    shadowPixels,
    dispose() {
      if (disposed) return
      disposed = true
      throwFirstCleanupError('Could not fully dispose Blendlink shadows', rollback(true))
    },
  }
}

/** Prepare every traversal-heavy, root-local shadow mutation while the loaded
 * graph is detached. The supplied renderer is validated but remains untouched
 * until commit(), which applies only the constant-size renderer policy. */
export function prepareCompiledSceneShadows(
  renderer: RendererShadowsLike,
  root: Object3DLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneShadowOptions,
): PreparedCompiledSceneShadows {
  const recipe = descriptor.shadows
  if (recipe && recipe.preset !== 'application' && !renderer.shadowMap) {
    throw new Error(
      'This Blendlink scene owns realtime shadow quality, but the supplied renderer does not expose shadowMap.',
    )
  }

  const stagedRenderer: RendererShadowsLike = renderer.shadowMap
    ? { shadowMap: { ...renderer.shadowMap } }
    : {}
  const rootInstallation = applyCompiledSceneShadowsNow(
    stagedRenderer,
    root,
    descriptor,
    options,
  )
  let state: PreparedCompiledSceneShadowsState = 'prepared'
  let installed: CompiledSceneShadowReport | null = null

  const releaseRoot = (): unknown[] => {
    try {
      rootInstallation.dispose()
      return []
    } catch (error) {
      return [error]
    }
  }

  return {
    get state() { return state },
    lightsConfigured: rootInstallation.lightsConfigured,
    shadowPixels: rootInstallation.shadowPixels,
    commit() {
      if (state !== 'prepared') {
        throw new Error(
          `This prepared Blendlink scene shadow policy is ${state}; commit() may run exactly once.`,
        )
      }
      let rendererInstallation: CompiledSceneShadowReport
      try {
        rendererInstallation = applyCompiledSceneShadowsNow(
          renderer,
          { name: 'Blendlink detached shadow renderer policy', children: [] },
          descriptor,
          options,
        )
      } catch (error) {
        state = 'failed'
        const cleanupErrors = releaseRoot()
        if (cleanupErrors.length > 0) {
          throw new Error(
            `Could not commit the prepared Blendlink scene shadows: ${cleanupErrorMessage(error)}. ` +
              `Detached light cleanup also failed: ${cleanupErrors.map(cleanupErrorMessage).join('; ')}`,
          )
        }
        throw error
      }

      state = 'committed'
      let disposed = false
      installed = {
        lightsConfigured: rootInstallation.lightsConfigured,
        shadowPixels: rootInstallation.shadowPixels,
        dispose() {
          if (disposed) return
          disposed = true
          state = 'disposed'
          const cleanupErrors: unknown[] = []
          attemptCleanup(cleanupErrors, () => rendererInstallation.dispose())
          cleanupErrors.push(...releaseRoot())
          throwFirstCleanupError(
            'Could not fully dispose prepared Blendlink scene shadows',
            cleanupErrors,
          )
        },
      }
      return installed
    },
    dispose() {
      if (state === 'disposed') return
      if (state === 'committed') {
        installed?.dispose()
        return
      }
      if (state === 'failed') {
        state = 'disposed'
        return
      }
      state = 'disposed'
      throwFirstCleanupError(
        'Could not dispose prepared Blendlink scene shadows',
        releaseRoot(),
      )
    },
  }
}

/** Compatibility seam: prepare detached light policy, then synchronously take
 * renderer ownership. Callers that need a presentation barrier should retain
 * the prepared handle and commit it with their other live mutations. */
export function applyCompiledSceneShadows(
  renderer: RendererShadowsLike,
  root: Object3DLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneShadowOptions,
): CompiledSceneShadowReport {
  return prepareCompiledSceneShadows(renderer, root, descriptor, options).commit()
}

interface EulerInstallation {
  target: object
  key: PropertyKey
  euler: EulerLike
  previous: readonly [number, number, number]
  installed: readonly [number, number, number]
}

function validateReadableEuler(euler: EulerLike | undefined, label: string): void {
  if (!euler) return
  if (![euler.x, euler.y, euler.z].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(
      `The supplied scene exposes ${label}, but it does not expose readable finite x/y/z values. ` +
        'Blendlink needs Three-compatible Euler state to restore the application rotation safely.',
    )
  }
}

function installEuler(
  target: object,
  key: PropertyKey,
  euler: EulerLike | undefined,
  installed: readonly [number, number, number],
  installations: EulerInstallation[],
): void {
  if (!euler) return
  const previous = [euler.x!, euler.y!, euler.z!] as const
  installations.push({ target, key, euler, previous, installed })
  euler.set(...installed)
}

function restoreEuler(installation: EulerInstallation, conditional: boolean): void {
  const current = (installation.target as Record<PropertyKey, unknown>)[installation.key]
  if (current !== installation.euler) return
  if (conditional) {
    const { euler, installed } = installation
    if (!Object.is(euler.x, installed[0]) || !Object.is(euler.y, installed[1]) || !Object.is(euler.z, installed[2])) {
      return
    }
  }
  installation.euler.set(...installation.previous)
}

function eulerStillInstalled(installation: EulerInstallation): boolean {
  const current = (installation.target as Record<PropertyKey, unknown>)[installation.key]
  const { euler, installed } = installation
  return current === euler && Object.is(euler.x, installed[0]) &&
    Object.is(euler.y, installed[1]) && Object.is(euler.z, installed[2])
}

function restoreOwnedGroup(
  properties: PropertyInstallation[],
  eulers: EulerInstallation[],
  errors: unknown[],
): boolean {
  if (!properties.every(propertyStillInstalled) || !eulers.every(eulerStillInstalled)) return false
  for (const installation of eulers.slice().reverse()) {
    attemptCleanup(errors, () => restoreEuler(installation, true))
  }
  for (const installation of properties.slice().reverse()) {
    attemptCleanup(errors, () => restoreProperty(installation, true))
  }
  return true
}

function requireEnvironmentTexture(value: EnvironmentTextureLike, url: string): EnvironmentTextureLike {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new Error(`The environment loader returned no texture for ${url}.`)
  }
  return value
}

function groundedBackgroundParent(background: unknown): { known: boolean; value: unknown } {
  if (!background || (typeof background !== 'object' && typeof background !== 'function')) {
    return { known: false, value: undefined }
  }
  if (!('parent' in background)) return { known: false, value: undefined }
  return { known: true, value: (background as { parent?: unknown }).parent }
}

/** Load and construct the published environment without changing the target
 * Scene. The returned lease can be committed synchronously after every other
 * scene prerequisite is ready. Current Three renderers perform PMREM
 * conversion automatically for equirectangular scene.environment. */
export async function prepareCompiledSceneEnvironment(
  scene: SceneEnvironmentLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneEnvironmentOptions,
): Promise<PreparedCompiledSceneEnvironment> {
  const recipe = descriptor.environment
  if (!recipe) {
    let state: PreparedCompiledSceneEnvironmentState = 'prepared'
    let installed: CompiledSceneEnvironment | null = null
    return {
      get state() { return state },
      texture: null,
      source: null,
      groundedBackground: null,
      commit() {
        if (state !== 'prepared') {
          throw new Error(`This prepared Blendlink scene environment is ${state}; commit() may run exactly once.`)
        }
        state = 'committed'
        let disposed = false
        installed = {
          texture: null,
          source: null,
          groundedBackground: null,
          dispose() {
            if (disposed) return
            disposed = true
            state = 'disposed'
          },
        }
        return installed
      },
      dispose() {
        if (state === 'disposed') return
        if (state === 'committed') installed?.dispose()
        state = 'disposed'
      },
    }
  }
  const needsImage = recipe.lighting === 'image' || recipe.background === 'image' || recipe.background === 'grounded'
  const asset = descriptor.environmentAsset
  if (needsImage && (recipe.source !== 'image' || !asset)) {
    throw new Error(
      'This Blendlink scene uses a published HDR environment, but its generated descriptor has no environmentAsset. Re-run blendlink compile.',
    )
  }
  if (recipe.background === 'grounded' &&
      (!options.createGroundedBackground || !scene.add || !scene.remove)) {
    throw new Error(
      'This Blendlink scene requests a grounded HDR backdrop. Pass createGroundedBackground() ' +
        '(using three/addons/objects/GroundedSkybox) and a scene with add() and remove().',
    )
  }
  if (recipe.lighting === 'image') validateReadableEuler(scene.environmentRotation, 'environmentRotation')
  if (recipe.background === 'image') validateReadableEuler(scene.backgroundRotation, 'backgroundRotation')

  let texture: EnvironmentTextureLike | null = null
  let loadedSource: 'optimized' | 'original' | null = null
  let groundedBackground: unknown | null = null

  try {
    if (needsImage) {
      const publishedAsset = asset!
      const optimized = publishedAsset.optimized
      if (options.preferOptimized !== false && optimized && options.loaders.ktx2) {
        if (options.linearFilter === undefined) {
          const message =
            `Packed-float KTX2 environment needs Three.LinearFilter to avoid nearest-filtered lighting; ` +
            `using the byte-exact ${publishedAsset.format.toUpperCase()} fallback. Pass linearFilter: THREE.LinearFilter.`
          if (options.onWarning) options.onWarning(message)
          else console.warn(message)
        } else {
          let optimizedCandidate: EnvironmentTextureLike | null = null
          let optimizedCleanupError: unknown = null
          try {
            optimizedCandidate = requireEnvironmentTexture(
              await options.loaders.ktx2.loadAsync(optimized.url),
              optimized.url,
            )
            optimizedCandidate.minFilter = options.linearFilter
            optimizedCandidate.magFilter = options.linearFilter
            optimizedCandidate.needsUpdate = true
            texture = optimizedCandidate
            loadedSource = 'optimized'
          } catch (error) {
            if (optimizedCandidate) {
              try {
                optimizedCandidate.dispose?.()
              } catch (cleanupError) {
                optimizedCleanupError = cleanupError
              }
            }
            texture = null
            loadedSource = null
            const message =
              `Packed-float KTX2 environment failed to load; using the byte-exact ${publishedAsset.format.toUpperCase()} fallback. ` +
              `${cleanupErrorMessage(error)}` +
              (optimizedCleanupError ? ` Candidate cleanup also failed: ${cleanupErrorMessage(optimizedCleanupError)}` : '')
            if (options.onWarning) options.onWarning(message)
            else console.warn(message)
          }
        }
      }
      if (!texture) {
        const loader = options.loaders[publishedAsset.format]
        if (!loader) {
          throw new Error(`No ${publishedAsset.format.toUpperCase()} loader was supplied for ${publishedAsset.url}.`)
        }
        texture = requireEnvironmentTexture(await loader.loadAsync(publishedAsset.url), publishedAsset.url)
        loadedSource = 'original'
      }
      texture.mapping = options.equirectangularReflectionMapping
    }

    const yRadians = (degrees: number) => degrees * Math.PI / 180
    if (recipe.background === 'grounded') {
      const candidate = options.createGroundedBackground!(texture!, {
        height: recipe.groundHeight,
        radius: recipe.groundRadius,
        intensity: recipe.backgroundIntensity,
        rotation: yRadians(recipe.backgroundRotation),
        blur: recipe.backgroundBlur,
      })
      if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
        throw new Error('createGroundedBackground() did not return a Three-compatible background object.')
      }
      groundedBackground = candidate
    }
  } catch (error) {
    const cleanupErrors: unknown[] = []
    if (groundedBackground && options.disposeGroundedBackground) {
      attemptCleanup(cleanupErrors, () => options.disposeGroundedBackground!(groundedBackground))
    }
    if (texture) attemptCleanup(cleanupErrors, () => { texture?.dispose?.() })
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not prepare the Blendlink scene environment: ${cleanupErrorMessage(error)}. ` +
          `Preparation cleanup also failed: ${cleanupErrors.map(cleanupErrorMessage).join('; ')}`,
      )
    }
    throw error
  }

  let state: PreparedCompiledSceneEnvironmentState = 'prepared'
  let installed: CompiledSceneEnvironment | null = null
  const disposeUncommitted = (): void => {
    const cleanupErrors: unknown[] = []
    if (groundedBackground && options.disposeGroundedBackground) {
      attemptCleanup(cleanupErrors, () => options.disposeGroundedBackground!(groundedBackground))
    }
    if (texture) attemptCleanup(cleanupErrors, () => { texture?.dispose?.() })
    throwFirstCleanupError('Could not dispose the prepared Blendlink scene environment', cleanupErrors)
  }

  return {
    get state() { return state },
    texture,
    source: loadedSource,
    groundedBackground,
    commit() {
      if (state !== 'prepared') {
        throw new Error(`This prepared Blendlink scene environment is ${state}; commit() may run exactly once.`)
      }
      const lightingProperties: PropertyInstallation[] = []
      const lightingEulers: EulerInstallation[] = []
      const backgroundProperties: PropertyInstallation[] = []
      const backgroundEulers: EulerInstallation[] = []
      let groundedAdded = false

      try {
        const yRadians = (degrees: number) => degrees * Math.PI / 180
        if (recipe.lighting === 'none') installProperty(scene, 'environment', null, lightingProperties)
        else if (recipe.lighting === 'image') {
          installProperty(scene, 'environment', texture, lightingProperties)
          installProperty(scene, 'environmentIntensity', recipe.lightingIntensity, lightingProperties)
          installEuler(
            scene,
            'environmentRotation',
            scene.environmentRotation,
            [0, yRadians(recipe.lightingRotation), 0],
            lightingEulers,
          )
        }

        if (recipe.background === 'none') installProperty(scene, 'background', null, backgroundProperties)
        else if (recipe.background === 'image') {
          installProperty(scene, 'background', texture, backgroundProperties)
          installProperty(scene, 'backgroundIntensity', recipe.backgroundIntensity, backgroundProperties)
          installProperty(scene, 'backgroundBlurriness', recipe.backgroundBlur, backgroundProperties)
          installEuler(
            scene,
            'backgroundRotation',
            scene.backgroundRotation,
            [0, yRadians(recipe.backgroundRotation), 0],
            backgroundEulers,
          )
        } else if (recipe.background === 'grounded') {
          installProperty(scene, 'background', null, backgroundProperties)
          scene.add!(groundedBackground)
          groundedAdded = true
        }
      } catch (error) {
        state = 'failed'
        const rollbackErrors: unknown[] = []
        for (const installation of [...lightingEulers, ...backgroundEulers].reverse()) {
          attemptCleanup(rollbackErrors, () => restoreEuler(installation, false))
        }
        for (const installation of [...lightingProperties, ...backgroundProperties].reverse()) {
          attemptCleanup(rollbackErrors, () => restoreProperty(installation, false))
        }
        let groundDetached = !groundedBackground
        if (groundedBackground && scene.remove) {
          try {
            scene.remove(groundedBackground)
            groundDetached = true
          } catch (cleanupError) {
            rollbackErrors.push(cleanupError)
          }
        }
        let groundedDisposed = groundDetached
        if (groundedBackground && groundDetached && options.disposeGroundedBackground) {
          try {
            options.disposeGroundedBackground(groundedBackground)
          } catch (cleanupError) {
            groundedDisposed = false
            rollbackErrors.push(cleanupError)
          }
        }
        if (texture && groundDetached && groundedDisposed &&
            scene.environment !== texture && scene.background !== texture) {
          attemptCleanup(rollbackErrors, () => { texture?.dispose?.() })
        }
        if (rollbackErrors.length > 0) {
          throw new Error(
            `Could not commit the prepared Blendlink scene environment: ${cleanupErrorMessage(error)}. ` +
              `Rollback also failed: ${rollbackErrors.map(cleanupErrorMessage).join('; ')}`,
          )
        }
        throw error
      }

      state = 'committed'
      let disposed = false
      installed = {
        texture,
        source: loadedSource,
        groundedBackground,
        dispose() {
          if (disposed) return
          disposed = true
          state = 'disposed'
          const cleanupErrors: unknown[] = []
          restoreOwnedGroup(lightingProperties, lightingEulers, cleanupErrors)
          restoreOwnedGroup(backgroundProperties, backgroundEulers, cleanupErrors)

          let resourcesTransferred = false
          let groundDetached = !groundedAdded
          if (groundedBackground && groundedAdded) {
            const parent = groundedBackgroundParent(groundedBackground)
            resourcesTransferred = parent.known && parent.value !== null
              && parent.value !== undefined && parent.value !== scene
            if (!resourcesTransferred) {
              if (!parent.known || parent.value === undefined || parent.value === scene) {
                try {
                  scene.remove!(groundedBackground)
                  groundDetached = true
                } catch (error) {
                  cleanupErrors.push(error)
                }
              } else {
                groundDetached = true
              }
            }
          }

          let groundResourcesDisposed = !groundedBackground
            || resourcesTransferred || !options.disposeGroundedBackground
          if (groundedBackground && !resourcesTransferred && groundDetached
              && options.disposeGroundedBackground) {
            try {
              options.disposeGroundedBackground(groundedBackground)
              groundResourcesDisposed = true
            } catch (error) {
              groundResourcesDisposed = false
              cleanupErrors.push(error)
            }
          }

          if (texture && !resourcesTransferred && groundDetached && groundResourcesDisposed &&
              scene.environment !== texture && scene.background !== texture) {
            attemptCleanup(cleanupErrors, () => { texture?.dispose?.() })
          }
          throwFirstCleanupError('Could not fully dispose the Blendlink scene environment', cleanupErrors)
        },
      }
      return installed
    },
    dispose() {
      if (state === 'disposed') return
      if (state === 'committed') {
        installed?.dispose()
        return
      }
      if (state === 'failed') {
        state = 'disposed'
        return
      }
      state = 'disposed'
      disposeUncommitted()
    },
  }
}

/** Load and atomically assign the published equirectangular environment. This
 * compatibility seam prepares every resource first and then commits without
 * an asynchronous gap. */
export async function applyCompiledSceneEnvironment(
  scene: SceneEnvironmentLike,
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneEnvironmentOptions,
): Promise<CompiledSceneEnvironment> {
  const prepared = await prepareCompiledSceneEnvironment(scene, descriptor, options)
  return prepared.commit()
}

/** Index a loaded scene using both readable Blender names and rename-stable
 * Blendlink IDs. This is deliberately renderer-agnostic: Three.js and R3F
 * objects both satisfy the tiny structural contract. */
export function bindCompiledScene<TObject extends Object3DLike>(
  root: TObject,
  descriptor: CompiledSceneDescriptor,
): SceneBindings<TObject> {
  const all: Record<string, TObject> = {}
  const loadedById: Record<string, TObject> = {}
  const visit = (object: Object3DLike) => {
    if (object.name) all[object.name] = object as TObject
    const id = object.userData?.blendlink_id
    if (typeof id === 'string') {
      if (loadedById[id] && loadedById[id] !== object) {
        throw new Error(
          `Blendlink loaded duplicate stable object ID "${id}"; run Set Up Blendlink Scene in Blender to repair IDs.`,
        )
      }
      loadedById[id] = object as TObject
    }
  }
  if (root.traverse) root.traverse(visit)
  else walk(root, visit)
  const byName = Object.fromEntries(
    Object.entries(descriptor.nodes)
      .map(([key, loadedName]) => [key, (
        descriptor.nodeIds?.[key] ? loadedById[descriptor.nodeIds[key]!] : undefined
      ) ?? all[loadedName]])
      .filter((entry): entry is [string, TObject] => entry[1] !== undefined),
  )
  const byId = Object.fromEntries(
    Object.entries(descriptor.objectsById ?? {})
      .map(([id, loadedName]) => [id, loadedById[id] ?? all[loadedName]])
      .filter((entry): entry is [string, TObject] => entry[1] !== undefined),
  )
  const installations: PropertyInstallation[] = []
  const authoredObjects = new Set<Object3DLike>([
    ...Object.values(byName),
    ...Object.values(byId),
    ...Object.values(loadedById),
  ])
  const shadowIntents = new Map<Object3DLike, CompiledSceneShadowIntent>()
  let resolvedShadowIntents = new Map<Object3DLike, CompiledSceneShadowIntent>()
  const install = (target: object, key: PropertyKey, value: unknown): void => {
    // An object can have authored visibility and also be a proxy-only collider.
    // Collapse that chain into one original -> final installation so cleanup
    // never mistakes an intermediate value for a later application owner.
    const existing = installations.find((entry) => entry.target === target && entry.key === key)
    if (existing) {
      existing.installed = value
      ;(target as Record<PropertyKey, unknown>)[key] = value
      return
    }
    installProperty(target, key, value, installations)
  }
  try {
    for (const [loadedName, extras] of Object.entries(descriptor.extras ?? {})) {
      const object = (descriptor.nodeIds?.[loadedName]
        ? loadedById[descriptor.nodeIds[loadedName]!]
        : undefined) ?? all[loadedName]
      if (!object) continue
      authoredObjects.add(object)
      if (typeof extras.blendlink_active === 'boolean') {
        install(object, 'visible', extras.blendlink_active)
      }
      const cast = typeof extras.blendlink_cast_shadow === 'boolean'
        ? extras.blendlink_cast_shadow
        : undefined
      const receive = typeof extras.blendlink_receive_shadow === 'boolean'
        ? extras.blendlink_receive_shadow
        : undefined
      if (cast !== undefined || receive !== undefined) {
        shadowIntents.set(object, { cast, receive })
      }
    }
    // Blender mesh nodes with several glTF primitives load as a Group whose
    // generated Mesh children do the actual drawing. Carry an object's
    // shadow intent through only those loader-private wrappers. The next
    // authored Blender object is a hard boundary: these toggles are per
    // object, not inherited through Blender parenting.
    resolvedShadowIntents = resolveCompiledSceneShadowIntents(
      root, authoredObjects, shadowIntents,
    )
    const applyShadowIntent = (object: Object3DLike): void => {
      const resolved = resolvedShadowIntents.get(object)
      if (resolved?.cast !== undefined) install(object, 'castShadow', resolved.cast)
      if (resolved?.receive !== undefined) install(object, 'receiveShadow', resolved.receive)
      for (const child of object.children ?? []) applyShadowIntent(child)
    }
    applyShadowIntent(root)
    for (const collider of descriptor.colliders ?? []) {
      if (!collider.proxyOnly) continue
      const object = (collider.id ? byId[collider.id] : undefined)
        ?? (collider.id ? loadedById[collider.id] : undefined)
        ?? (collider.loadedName ? all[collider.loadedName] : undefined)
        ?? all[collider.name]
      if (object) install(object, 'visible', false)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const installation of installations.slice().reverse()) {
      attemptCleanup(rollbackErrors, () => restoreProperty(installation, false))
    }
    if (rollbackErrors.length > 0) {
      throw new Error(
        `Could not bind the Blendlink scene: ${cleanupErrorMessage(error)}. ` +
          `Rollback also failed: ${rollbackErrors.map(cleanupErrorMessage).join('; ')}`,
      )
    }
    throw error
  }
  let disposed = false
  return {
    byName,
    byId,
    object(idOrName) {
      const found = byId[idOrName] ?? byName[idOrName] ?? all[idOrName]
      if (!found) throw new Error(`Blendlink object "${idOrName}" is not present in the loaded scene`)
      return found
    },
    shadowIntent(object) {
      return resolvedShadowIntents.get(object)
    },
    dispose() {
      if (disposed) return
      disposed = true
      const cleanupErrors: unknown[] = []
      for (const installation of installations.slice().reverse()) {
        attemptCleanup(cleanupErrors, () => restoreProperty(installation, true))
      }
      throwFirstCleanupError('Could not fully dispose Blendlink scene bindings', cleanupErrors)
    },
  }
}

/** One-call Three.js loader adapter; pass a GLTFLoader instance. */
export async function loadCompiledScene<TLoaded extends LoadedSceneLike>(
  loader: {
    loadAsync(url: string): Promise<TLoaded>
    setMeshoptDecoder?(decoder: unknown): unknown
    setKTX2Loader?(loader: unknown): unknown
  },
  descriptor: CompiledSceneDescriptor,
  options: CompiledSceneLoaderOptions = {},
): Promise<TLoaded & { blendlink: SceneBindings<TLoaded['scene']> }> {
  configureCompiledSceneLoader(loader, descriptor, options)
  const needsMeshopt = descriptor.requiresMeshopt === true
    || descriptor.optimization?.geometry === 'meshopt'
  const loaded = needsMeshopt
    ? await withMeshoptDecoderForLoad(
        loader as typeof loader & { setMeshoptDecoder(decoder: unknown): unknown },
        descriptor.meshoptDecodedBytes,
        options,
        () => loader.loadAsync(descriptor.url),
      )
    : await loader.loadAsync(descriptor.url)
  return Object.assign(loaded, { blendlink: bindCompiledScene(loaded.scene, descriptor) })
}

function walk(object: Object3DLike, visitor: (object: Object3DLike) => void): void {
  visitor(object)
  for (const child of object.children ?? []) walk(child, visitor)
}
