import * as THREE from 'three'
import type {
  Effect as PostEffect,
  EffectComposer as PostEffectComposer,
  Pass as PostPass,
} from 'postprocessing'
import { componentDefinition, type PortableComponentRecord } from './components.js'
import {
  RuntimeComponentDisposalError,
  installRuntimeComponents,
  type InstalledRuntimeComponents,
  type AccessibilityService,
  type InteractionService,
  type PostEffectDescriptor,
  type PostPipelineService,
  type RuntimeComponentInstallation,
  type RuntimeComponentServices,
  type RuntimeQuality,
} from './componentRuntime.js'
import {
  createThreeInteractionServices,
  type InstalledThreeInteractionServices,
  type ThreeAccessibleControl,
} from './threeInteractions.js'
import {
  createThreeAudioCoordinator,
  type ThreeAudioControl,
  type ThreeAudioCoordinator,
} from './threeAudio.js'
import {
  installThreeShadowCatcher,
  type ThreeShadowCatcherMode,
} from './threeShadowCatcher.js'
import {
  installThreeContactShadows,
  type ThreeContactShadowUpdatePolicy,
} from './threeContactShadows.js'
import type { SceneBindings } from './runtime.js'
import {
  createThreeWebsiteSurfaces,
  type InstalledThreeWebsiteSurfaces,
  type ThreeWebsiteSurfaces,
  type WebsiteSurfaceColorTreatment,
} from './threeWebsiteSurfaces.js'

/** An application may add a component without forking the generated scene
 * contract.  It is intentionally explicit: an enabled unknown component is a
 * publish error until the site elects to provide its adapter. */
export type ThreeComponentAdapter = (
  context: ThreeComponentAdapterContext,
) => ThreeComponentInstallation | Promise<ThreeComponentInstallation>

export type ThreeComponentAdapterRegistry = Readonly<Record<string, ThreeComponentAdapter>>

const PREPARATION_SAFE_COMPONENT_ADAPTERS = new WeakSet<ThreeComponentAdapter>()

/** Certify a custom adapter for Blendlink's detached atomic path. The factory
 * may allocate resources and mutate only its detached target; live DOM,
 * renderer, application-service, and global work belongs in synchronous
 * activate(), with a synchronous idempotent dispose() inverse. Legacy
 * immediate installers still accept unwrapped adapters. */
export function defineThreeComponentAdapter<TAdapter extends ThreeComponentAdapter>(
  adapter: TAdapter,
): TAdapter {
  PREPARATION_SAFE_COMPONENT_ADAPTERS.add(adapter)
  return adapter
}

/** @internal Runtime guard used by the atomic scene transaction. */
export function isPreparationSafeThreeComponentAdapter(
  adapter: ThreeComponentAdapter,
): boolean {
  return PREPARATION_SAFE_COMPONENT_ADAPTERS.has(adapter)
}

export interface ThreeComponentInstallation {
  /** Complete live Canvas integration after detached preparation. Activation
   * must be synchronous; Blendlink calls it at most once and supplies the
   * committed Scene/camera so adapters never have to retain staging globals. */
  activate?(scene?: THREE.Scene, camera?: THREE.Camera): void
  update?(deltaSeconds: number): void
  fixedUpdate?(fixedDeltaSeconds: number): void
  resize?(width: number, height: number): void
  beforeRender?(): void
  afterRender?(): void
  setQuality?(quality: RuntimeQuality): void
  isActive?(): boolean
  dispose?(): void
}

export interface ThreeComponentAdapterContext {
  component: Readonly<PortableComponentRecord>
  target: THREE.Object3D | THREE.Scene
  /** `undefined` is deliberate for a Scene-targeted component. */
  object: THREE.Object3D | undefined
  root: THREE.Object3D
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  bindings: SceneBindings<THREE.Object3D>
  animations: readonly THREE.AnimationClip[]
  /** Narrow, renderer-neutral services keep custom semantic adapters from
   * depending on an EffectComposer or another engine implementation detail. */
  services: RuntimeComponentServices<THREE.Object3D | THREE.Scene>
  /** Store a source made by audio-source so a later click component can refer
   * to it by its stable component ID. */
  audioSources: ReadonlyMap<string, ThreeAudio>
  /** Ask an application-owned demand renderer for a frame after an external
   * event (for example WebGL context restoration). Custom adapters may use
   * this without taking ownership of Canvas or the render loop. */
  requestFrame?(): unknown
}

export interface InstallThreeComponentsOptions {
  components?: readonly Readonly<PortableComponentRecord>[] | null
  root: THREE.Object3D
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  /** Tone mapping prepared by the detached compiled-look transaction. Post
   * effects use this value for HDR transfer planning without adopting the
   * application renderer's current value as Blendlink-owned state. */
  presentationToneMapping?: THREE.ToneMapping
  bindings: SceneBindings<THREE.Object3D>
  animations?: readonly THREE.AnimationClip[]
  adapters?: ThreeComponentAdapterRegistry
  /** Avoids making URL navigation an implicit global in embedded apps/tests. */
  openUrl?(url: string, target: string): unknown
  /** Reuse a site-configured loader (credentials, CDN, cache) when desired. */
  audioLoader?: Pick<THREE.AudioLoader, 'loadAsync'>
  /** Optional authenticated/cached, application-owned LUT resolver. Blendlink
   * does not dispose returned textures. Standard .cube and .3dl URLs use
   * Three's official loaders and Blendlink ownership when this hook is absent. */
  loadLut?(url: string): Promise<THREE.Data3DTexture>
  /** Shared attempt manager for package-owned audio and LUT loaders. */
  loadingManager?: THREE.LoadingManager
  /** Receives capability fallbacks and scene-dependent cost warnings. */
  onWarning?(message: string): unknown
  /** Optional application-owned input adapter. Omit for Blendlink's one-
   * listener/one-raycast Three canvas host. Application-owned services retain
   * their own registration/activation semantics: deferActivation does not
   * delay their addTarget()/addControl() calls, so a host using detached
   * preparation must supply services whose registration is staging-safe. */
  interaction?: InteractionService<THREE.Object3D | THREE.Scene>
  /** Optional application-owned accessible control publisher. The default
   * registry is exposed through InstalledThreeComponents.accessibleControls. */
  accessibility?: AccessibilityService<THREE.Object3D | THREE.Scene>
  requestFrame?(): unknown
  /** Prepare component resources and registrations without activating
   * package-owned Canvas listeners, authored autoplay, or adapter activate()
   * hooks. Defaults to false for backward-compatible immediate behavior. */
  deferActivation?: boolean
}

export interface InstalledThreeComponents {
  readonly count: number
  readonly postprocessing: boolean
  /** Resolved offscreen MSAA sample count. Zero means the direct renderer path
   * or a device that exposes no multisampled render-target support. */
  readonly antialiasingSamples: number
  /** Whether the resolved stack adds final SMAA for edges created after the
   * scene's multisampled color target has already been resolved. */
  readonly postEdgeAntialiasing: boolean
  /** Actual pmndrs SMAA preset selected by runtime quality. `off` means the
   * pass is unnecessary or intentionally suppressed to preserve Pixelation. */
  readonly postEdgeAntialiasingPreset: PostEdgeAntialiasingPreset
  /** Resolved semantic order, useful in Preview diagnostics and performance
   * captures. Empty when the scene uses the direct renderer path. */
  readonly postprocessingOrder: readonly string[]
  /** False only when the installed component set declares no per-frame work
   * and owns no post-processing pipeline. */
  readonly requiresContinuousFrames: boolean
  /** Semantic controls only; the application decides which DOM links/buttons
   * render them and owns routing, analytics, and layout. */
  readonly accessibleControls: readonly ThreeAccessibleControl[]
  /** Observable Web Audio policy state. The website owns any enable-sound UI
   * and should call resume() directly from its trusted activation handler. */
  readonly audio: ThreeAudioControl
  /** Named Blender-authored receivers for application-owned canvas pixels. */
  readonly websiteSurfaces: InstalledThreeWebsiteSurfaces
  /** Idempotently complete deferred live integration. A detached installer may
   * supply the application's committed scene/camera so the post pipeline drops
   * every staging reference before renderer ownership becomes visible. */
  activate(scene?: THREE.Scene, camera?: THREE.Camera): void
  update(deltaSeconds: number): void
  fixedUpdate(fixedDeltaSeconds: number): void
  resize(width: number, height: number): void
  setQuality(quality: RuntimeQuality): void
  /** Render with the owned post-processing chain when present, otherwise
   * delegate directly to the supplied renderer. */
  render(deltaSeconds?: number): void
  dispose(): void
}

export type PostEdgeAntialiasingPreset = 'off' | 'low' | 'medium' | 'high'

type ObjectComponent = Readonly<PortableComponentRecord> & {
  target: Extract<PortableComponentRecord['target'], { kind: 'object' }>
}

interface MutableContext extends ThreeComponentAdapterContext {
  audioSourcesMutable: Map<string, ThreeAudio>
  websiteSurfaces: ThreeWebsiteSurfaces
}

type ThreeAudio = THREE.Audio<GainNode> | THREE.PositionalAudio

interface SharedAudioListener {
  listener: THREE.AudioListener
  owners: number
  blendlinkOwned: boolean
}

interface AudioListenerState {
  shared: SharedAudioListener | null
  camera: THREE.Camera
  pendingOwnedAttachment: boolean
  coordinator: ThreeAudioCoordinator
  contextLease: RuntimeComponentInstallation | null
}

interface SharedHiddenState {
  authored: boolean
  owners: number
}

interface SharedLookAtState {
  authored: THREE.Quaternion
  lastApplied: THREE.Quaternion
  owners: number
}

const AUDIO_LISTENER_KEY = '__blendlink_audio_listener'
const AUDIO_LISTENER_STATE_KEY = '__blendlink_audio_listener_state'
const HIDDEN_STATES = new WeakMap<THREE.Object3D, SharedHiddenState>()
const LOOK_AT_STATES = new WeakMap<THREE.Object3D, SharedLookAtState>()

interface SeeThroughEntry {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
  installed: THREE.Material | THREE.Material[]
  originals: THREE.Material[]
  clones: THREE.Material[]
  requests: Map<symbol, { blocked: boolean; opacity: number }>
}

const SEE_THROUGH_STATES = new WeakMap<THREE.Mesh, SeeThroughEntry>()

/** Install portable artist components against a standard Three scene. The
 * returned handle owns every listener, post-process target, temporary mixer,
 * and authored mutation it makes; it never takes over an application's render
 * loop or renderer disposal. */
export async function installThreeComponents(
  options: InstallThreeComponentsOptions,
): Promise<InstalledThreeComponents> {
  const enabled = (options.components ?? []).filter((component) => component.enabled)
  if (enabled.length === 0) return inertComponents(
    options.renderer, options.scene, options.camera, options.requestFrame,
  )

  const needsPost = enabled.some((component) =>
    componentDefinition(component.type)?.requires.includes('post-pipeline') === true)
  let pipeline: ThreePostPipelineService | null = null
  let lifecycle: InstalledRuntimeComponents | null = null
  const ownedInteractions = createThreeInteractionServices({
    root: options.root,
    camera: options.camera,
    surface: options.renderer.domElement,
    ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
  })
  const audioSources = new Map<string, ThreeAudio>()
  const audioCoordinator = createThreeAudioCoordinator()
  const websiteSurfaces = createThreeWebsiteSurfaces({
    ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
  })
  const audioListenerState: AudioListenerState = {
    shared: null,
    camera: options.camera,
    pendingOwnedAttachment: false,
    coordinator: audioCoordinator,
    contextLease: null,
  }
  let disposed = false
  let committedScene = options.scene
  let committedCamera = options.camera

  try {
    if (needsPost) {
      pipeline = await ThreePostPipelineService.create(options)
    }
    const services: RuntimeComponentServices<THREE.Object3D | THREE.Scene> = {
      ...(pipeline ? { postPipeline: pipeline } : {}),
      interaction: options.interaction ?? ownedInteractions.interaction,
      accessibility: options.accessibility ?? ownedInteractions.accessibility,
    }
    const contextBase: Omit<MutableContext, 'component' | 'target' | 'object'> = {
      root: options.root,
      scene: options.scene,
      camera: options.camera,
      renderer: options.renderer,
      bindings: options.bindings,
      animations: options.animations ?? [],
      audioSources,
      audioSourcesMutable: audioSources,
      websiteSurfaces,
      services,
      ...(options.requestFrame ? { requestFrame: options.requestFrame } : {}),
    }
    // Runtime behavior must not depend on card order: sources precede their
    // audio triggers, then post effects follow semantic pipeline phase.
    const ordered = enabled.slice().sort((left, right) =>
      componentInstallPriority(left) - componentInstallPriority(right))
    lifecycle = await installRuntimeComponents(
      ordered.map((component) => ({
        component,
        install: async (): Promise<RuntimeComponentInstallation> => {
          const object = component.target.kind === 'object'
            ? resolveObject(component as ObjectComponent, options.bindings)
            : undefined
          const target = object ?? options.scene
          const context: MutableContext = { ...contextBase, component, target, object }
          const adapter = options.adapters?.[component.type] ?? CORE_ADAPTERS[component.type]
          if (!adapter) {
            const supplied = Object.keys(options.adapters ?? {}).sort().join(', ') || 'none'
            throw new Error(
              `Blendlink component "${component.type}" (${component.id}) is enabled but has no Three.js adapter. ` +
                `Add it to installThreeCompiledScene({ componentAdapters: { ... } }). Supplied adapters: ${supplied}.`,
            )
          }
          const installation = await adapter(
            contextWithApplicationHooks(context, options, audioListenerState),
          )
          return normalizeThreeInstallation(
            installation,
            () => ({ scene: committedScene, camera: committedCamera }),
          )
        },
      })),
      { deferActivation: true },
    )
    pipeline?.finalize()
  } catch (error) {
    const cleanupErrors = disposeRuntimeAndOwned(
      lifecycle, pipeline, audioListenerState, audioCoordinator, ownedInteractions,
      websiteSurfaces,
    )
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not install Blendlink components: ${message(error)}. ` +
          `Rollback also failed: ${cleanupErrors.map(message).join('; ')}`,
      )
    }
    throw error
  }

  let activated = false
  const installed: InstalledThreeComponents = {
    count: enabled.length,
    postprocessing: pipeline !== null,
    get requiresContinuousFrames() {
      return lifecycle?.requiresContinuousFrames ?? false
    },
    get accessibleControls() { return ownedInteractions.controls },
    audio: audioCoordinator,
    websiteSurfaces,
    get antialiasingSamples() { return pipeline?.multisampling ?? 0 },
    get postEdgeAntialiasing() { return pipeline?.postEdgeAntialiasing ?? false },
    get postEdgeAntialiasingPreset() { return pipeline?.postEdgeAntialiasingPreset ?? 'off' },
    postprocessingOrder: pipeline
      ? Object.freeze([...pipeline.resolvedOrder])
      : Object.freeze([]),
    activate(scene = options.scene, camera = options.camera) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      if (activated) return
      try {
        committedScene = scene
        committedCamera = camera
        pipeline?.activate(scene, camera)
        activatePreparedAudioListener(audioListenerState, camera)
        lifecycle?.activate()
        ownedInteractions.activate()
        activated = true
      } catch (error) {
        disposed = true
        const cleanupErrors = disposeRuntimeAndOwned(
          lifecycle, pipeline, audioListenerState, audioCoordinator, ownedInteractions,
          websiteSurfaces,
        )
        throw new Error(
          `Could not activate Blendlink components: ${message(error)}` +
            (cleanupErrors.length > 0
              ? `. Activation rollback also failed: ${cleanupErrors.map(message).join('; ')}`
              : ''),
          { cause: error },
        )
      }
    },
    update(deltaSeconds) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      lifecycle?.update?.(deltaSeconds)
    },
    fixedUpdate(fixedDeltaSeconds) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      lifecycle?.fixedUpdate?.(fixedDeltaSeconds)
    },
    resize(width, height) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      if (!positive(width) || !positive(height)) {
        throw new Error(`Blendlink component resize needs positive finite width/height; got ${width} x ${height}.`)
      }
      pipeline?.setSize(width, height)
      const pixelRatio = typeof options.renderer.getPixelRatio === 'function'
        ? options.renderer.getPixelRatio()
        : 1
      lifecycle?.resize?.(width, height, positive(pixelRatio) ? pixelRatio : 1)
    },
    setQuality(quality) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      pipeline?.setQuality(quality)
      lifecycle?.setQuality?.(quality)
    },
    render(deltaSeconds) {
      if (disposed) throw new Error('These installed Blendlink components have been disposed.')
      lifecycle?.beforeRender?.()
      try {
        if (pipeline) pipeline.render(deltaSeconds)
        else options.renderer.render(committedScene, committedCamera)
      } finally {
        lifecycle?.afterRender?.()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      const errors = disposeRuntimeAndOwned(
        lifecycle, pipeline, audioListenerState, audioCoordinator, ownedInteractions,
        websiteSurfaces,
      )
      if (errors.length > 0) {
        throw new Error(`Could not fully dispose Blendlink components: ${errors.map(message).join('; ')}`)
      }
    },
  }
  if (!options.deferActivation) installed.activate()
  return installed
}

function componentInstallPriority(component: Readonly<PortableComponentRecord>): number {
  if (component.type === 'blendlink.audio-source') return -100
  switch (componentDefinition(component.type)?.phase) {
    case 'post-depth': return 100
    case 'post-hdr': return 200
    case 'post-ldr': return 300
    default: return 0
  }
}

function contextWithApplicationHooks(
  context: MutableContext,
  options: InstallThreeComponentsOptions,
  audioListenerState: AudioListenerState,
): ThreeComponentAdapterContext {
  // The public context deliberately stays small. Core adapters obtain optional
  // browser/application services from these non-enumerable implementation
  // hooks so custom adapters cannot accidentally depend on undocumented state.
  Object.defineProperties(context, {
    __blendlinkOpenUrl: { value: options.openUrl, enumerable: false },
    __blendlinkAudioLoader: { value: options.audioLoader, enumerable: false },
    __blendlinkLoadingManager: { value: options.loadingManager, enumerable: false },
    __blendlinkAudioSourcesMutable: { value: context.audioSourcesMutable, enumerable: false },
    __blendlinkAudioListenerState: { value: audioListenerState, enumerable: false },
    __blendlinkAudioCoordinator: { value: audioListenerState.coordinator, enumerable: false },
    __blendlinkWebsiteSurfaces: { value: context.websiteSurfaces, enumerable: false },
  })
  return context
}

const CORE_ADAPTERS: Record<string, ThreeComponentAdapter> = {
  'blendlink.bloom': installBloom,
  'blendlink.chromatic-aberration': installChromaticAberration,
  'blendlink.pixelation': installPixelation,
  'blendlink.sharpen': installSharpen,
  'blendlink.tilt-shift': installTiltShift,
  'blendlink.ambient-occlusion': installAmbientOcclusion,
  'blendlink.shadow-catcher': installShadowCatcher,
  'blendlink.contact-shadows': installContactShadows,
  'blendlink.outline': installOutline,
  'blendlink.color-grading': installColorGrading,
  'blendlink.depth-of-field': installDepthOfField,
  'blendlink.kuwahara': installKuwahara,
  'blendlink.vignette': installVignette,
  'blendlink.see-through': installSeeThrough,
  'blendlink.open-url': installOpenUrl,
  'blendlink.hover': installHover,
  'blendlink.website-surface': installWebsiteSurface,
  'blendlink.hide-on-start': installHideOnStart,
  'blendlink.look-at': installLookAt,
  'blendlink.play-animation-on-click': installPlayAnimationOnClick,
  'blendlink.audio-source': installAudioSource,
  'blendlink.play-audio-on-click': installPlayAudioOnClick,
}

type PostprocessingModule = typeof import('postprocessing')

interface N8AOConfiguration {
  aoRadius: number
  intensity: number
  color: THREE.Color
  gammaCorrection: boolean
  screenSpaceRadius: boolean
  halfRes: boolean
  depthBufferType: number
}

interface N8AOPostPassLike extends PostPass {
  configuration: N8AOConfiguration
  firstFrame(): void
  configureAOPass(depthBufferType?: number, orthographic?: boolean): void
  configureDenoisePass(depthBufferType?: number, orthographic?: boolean): void
  configureEffectCompositer(depthBufferType?: number, orthographic?: boolean): void
  setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void
}

interface N8AOModule {
  N8AOPostPass: new (
    scene: THREE.Scene,
    camera: THREE.Camera,
    width?: number,
    height?: number,
  ) => N8AOPostPassLike
}

interface PipelineRegistration {
  id: string
  phase: PostEffectDescriptor['phase']
  effect?: PostEffect
  pass?: PostPass
  update?(deltaSeconds: number): void
  resize?(width: number, height: number, pixelRatio: number): void
  setQuality?(quality: RuntimeQuality): void
  rebind?(scene: THREE.Scene, camera: THREE.Camera): void
  beforeDispose?(): void
  afterDispose?(): void
  generatesHardPostEdges?: boolean
  intentionalPixelation?: boolean
  disposed: boolean
}

interface SharedPostRendererState {
  originalAutoClear: boolean
  autoClearOwners: number
  originalToneMapping: THREE.ToneMapping
  toneMappingOwners: number
}

const POST_RENDERER_STATE = new WeakMap<THREE.WebGLRenderer, SharedPostRendererState>()

class ThreePostPipelineService implements PostPipelineService {
  readonly resolvedOrder: string[] = ['scene-color']

  private readonly composer: PostEffectComposer
  private readonly renderPass: PostPass
  private readonly normalPass: import('postprocessing').NormalPass | null
  private readonly registrations = new Map<string, PipelineRegistration>()
  private readonly options: InstallThreeComponentsOptions
  private readonly originalAutoClear: boolean
  private readonly installedToneMapping: THREE.ToneMapping
  private readonly ownsToneMapping: boolean
  private readonly toneMappingEffect: PostEffect | null
  private edgeAntialiasingEffect: import('postprocessing').SMAAEffect | null = null
  private edgeAntialiasingPreset: PostEdgeAntialiasingPreset = 'off'
  private finalized = false
  private activated = false
  private disposed = false

  static async create(options: InstallThreeComponentsOptions): Promise<ThreePostPipelineService> {
    const post = await import('postprocessing')
    const needsAO = (options.components ?? []).some((component) =>
      component.enabled && component.type === 'blendlink.ambient-occlusion')
    const n8ao = needsAO ? await import('n8ao') as unknown as N8AOModule : null
    return new ThreePostPipelineService(post, n8ao, options)
  }

  private constructor(
    private readonly post: PostprocessingModule,
    private readonly n8ao: N8AOModule | null,
    options: InstallThreeComponentsOptions,
  ) {
    // Registration callbacks share this private copy. Activation replaces its
    // scene/camera targets, so no Blendlink post callback can keep consulting
    // the detached staging targets after the atomic commit.
    this.options = { ...options }
    const renderer = options.renderer
    this.originalAutoClear = renderer.autoClear
    const shared = POST_RENDERER_STATE.get(renderer)
    const inheritedToneMapping = shared?.toneMappingOwners
      ? shared.originalToneMapping
      : renderer.toneMapping
    const presentationToneMapping = options.presentationToneMapping ?? inheritedToneMapping
    const hdrTarget = supportsHalfFloatTarget(renderer)
    const toneMode = postToneMappingMode(post, presentationToneMapping)
    const transferToneMapping = hdrTarget
      && presentationToneMapping !== THREE.NoToneMapping
      && toneMode !== null

    if (!hdrTarget && (options.components ?? []).some((component) =>
      component.enabled && componentDefinition(component.type)?.requires.includes('hdr-color'))) {
      warn(options,
        'This device cannot render Blendlink post effects into a half-float color target. ' +
        'Bloom will use a compatible LDR fallback, so highlights already clipped by tone mapping cannot glow. ' +
        'A Threshold at or above 1 cannot select ordinary clamped highlights; lower Threshold below 1 or disable Bloom.')
    } else if (hdrTarget && presentationToneMapping !== THREE.NoToneMapping && toneMode === null) {
      warn(options,
        `The prepared presentation uses unsupported Three tone-mapping constant ${presentationToneMapping}. ` +
        'Blendlink left it in place, so HDR post effects run after that custom transform.')
    }

    this.installedToneMapping = transferToneMapping
      ? THREE.NoToneMapping
      : renderer.toneMapping
    this.ownsToneMapping = transferToneMapping
    this.toneMappingEffect = transferToneMapping
      ? new post.ToneMappingEffect({ mode: toneMode! })
      : null
    this.composer = new post.EffectComposer(renderer, {
      depthBuffer: true,
      stencilBuffer: false,
      multisampling: postMultisampling(renderer, 'balanced'),
      frameBufferType: hdrTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
    })
    // EffectComposer eagerly disables autoClear. Detached preparation must end
    // with the application renderer exactly as it found it; activation below
    // takes the durable, reference-counted ownership lease synchronously.
    renderer.autoClear = this.originalAutoClear
    this.renderPass = new post.RenderPass(options.scene, options.camera)
    this.composer.addPass(this.renderPass)
    const needsNormalBuffer = (options.components ?? []).some((component) =>
      component.enabled
      && component.type === 'blendlink.pixelation'
      && finite(component.values.normalEdgeStrength, 0) > 0)
    this.normalPass = needsNormalBuffer
      ? new post.NormalPass(options.scene, options.camera, { resolutionScale: 1 })
      : null
    if (this.normalPass) {
      this.composer.addPass(this.normalPass)
      this.resolvedOrder.push('scene-normals')
    }
  }

  async addEffect(effect: Readonly<PostEffectDescriptor>): Promise<RuntimeComponentInstallation> {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (this.finalized) throw new Error('Blendlink post effects must be registered before the pipeline is finalized.')
    if (this.registrations.has(effect.id)) {
      throw new Error(`Blendlink post effect ID ${effect.id} is registered more than once.`)
    }
    const registration = await this.createRegistration(effect)
    registration.generatesHardPostEdges = generatesHardPostEdges(effect.type)
    registration.intentionalPixelation = effect.type === 'blendlink.pixelation'
    this.registrations.set(effect.id, registration)
    return {
      update: registration.update
        ? (deltaSeconds) => registration.update?.(deltaSeconds)
        : undefined,
      resize: registration.resize
        ? (width, height, pixelRatio) => registration.resize?.(width, height, pixelRatio)
        : undefined,
      setQuality: registration.setQuality
        ? (quality) => registration.setQuality?.(quality)
        : undefined,
      dispose: () => {
        if (registration.disposed) return
        // Once finalized, the composer owns every Pass/Effect. Aggregate
        // disposal follows immediately after component lifecycle disposal.
        if (this.finalized) return
        this.registrations.delete(registration.id)
        disposeUnfinalizedRegistration(registration)
      },
    }
  }

  finalize(): void {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (this.finalized) return
    const registrations = [...this.registrations.values()]
      .sort((left, right) => phaseRank(left.phase) - phaseRank(right.phase)
        || left.id.localeCompare(right.id))

    for (const registration of registrations.filter((entry) => entry.pass)) {
      this.composer.addPass(registration.pass!)
      this.resolvedOrder.push(registration.id)
    }
    const effects = registrations.filter((entry): entry is PipelineRegistration & { effect: PostEffect } =>
      entry.effect !== undefined)
    const beforeTone = effects.filter((entry) => entry.phase !== 'post-ldr')
    const afterTone = effects.filter((entry) => entry.phase === 'post-ldr')
    if (this.toneMappingEffect) {
      // Tone mapping is an ordinary non-convolution effect and can share the
      // final HDR EffectPass with Bloom/DOF when pmndrs' compatibility rules
      // allow it, avoiding an otherwise needless fullscreen draw.
      beforeTone.push({
        id: 'tone-mapping', phase: 'post-hdr', effect: this.toneMappingEffect, disposed: false,
      })
    }
    addCompatibleEffectPasses(this.post, this.composer, this.options.camera, beforeTone, this.resolvedOrder)
    addCompatibleEffectPasses(this.post, this.composer, this.options.camera, afterTone, this.resolvedOrder)
    const hasPixelation = registrations.some((registration) => registration.intentionalPixelation)
    const needsPostEdgeAA = registrations.some((registration) => registration.generatesHardPostEdges)
      || (this.multisampling === 0
        && registrations.some((registration) => !registration.intentionalPixelation))
    if (!hasPixelation && needsPostEdgeAA) {
      // MSAA only covers scene rasterization. AO and Outline can create fresh
      // hard edges after that resolve, and SMAA also provides coverage when a
      // device exposes no offscreen MSAA. Pixelation takes priority over both:
      // final SMAA would smooth its authored grid, so any resolved Pixelation
      // suppresses this last pass. SMAA's default SRC blend preserves the
      // weighted RGBA result for transparent canvases.
      const effect = new this.post.SMAAEffect({ preset: this.post.SMAAPreset.MEDIUM })
      this.edgeAntialiasingEffect = effect
      this.applyEdgeAntialiasingQuality('balanced')
      this.composer.addPass(new this.post.EffectPass(this.options.camera, effect))
      this.resolvedOrder.push('post-edge-antialiasing')
    }
    this.finalized = true
  }

  activate(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) throw new Error('The Blendlink post pipeline has already been disposed.')
    if (!this.finalized) throw new Error('The Blendlink post pipeline must be finalized before activation.')
    if (this.activated) return

    // postprocessing owns the supported propagation path for RenderPass,
    // NormalPass, EffectPass, and custom passes. Rebind before the renderer
    // lease becomes visible so no committed frame retains the staging targets.
    this.options.scene = scene
    this.options.camera = camera
    this.composer.setMainScene(scene)
    this.composer.setMainCamera(camera)
    for (const registration of this.registrations.values()) {
      registration.rebind?.(scene, camera)
    }

    const renderer = this.options.renderer
    const shared = POST_RENDERER_STATE.get(renderer)
    const rendererState = shared ?? {
      originalAutoClear: renderer.autoClear,
      autoClearOwners: 0,
      originalToneMapping: renderer.toneMapping,
      toneMappingOwners: 0,
    }
    rendererState.autoClearOwners += 1
    if (this.ownsToneMapping) rendererState.toneMappingOwners += 1
    POST_RENDERER_STATE.set(renderer, rendererState)
    // Mark the lease before touching renderer properties so the outer
    // activation transaction can release it even if a host-defined setter
    // throws while the synchronous commit is being applied.
    this.activated = true
    renderer.autoClear = false
    if (this.ownsToneMapping) renderer.toneMapping = this.installedToneMapping
  }

  setSize(width: number, height: number): void { this.composer.setSize(width, height, false) }

  get multisampling(): number { return this.composer.multisampling }

  get postEdgeAntialiasing(): boolean { return this.edgeAntialiasingEffect !== null }

  get postEdgeAntialiasingPreset(): PostEdgeAntialiasingPreset {
    return this.edgeAntialiasingPreset
  }

  setQuality(quality: RuntimeQuality): void {
    this.composer.multisampling = postMultisampling(this.options.renderer, quality)
    this.applyEdgeAntialiasingQuality(quality)
  }

  render(deltaSeconds?: number): void { this.composer.render(deltaSeconds) }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    const registrations = [...this.registrations.values()].reverse()
    for (const registration of registrations) {
      try { registration.beforeDispose?.() } catch (error) { errors.push(error) }
    }
    if (!this.finalized) {
      for (const registration of registrations) {
        try { disposeUnfinalizedRegistration(registration, false) } catch (error) { errors.push(error) }
      }
      try { this.toneMappingEffect?.dispose() } catch (error) { errors.push(error) }
      try { this.edgeAntialiasingEffect?.dispose() } catch (error) { errors.push(error) }
    }
    try { this.composer.dispose() } catch (error) { errors.push(error) }
    for (const registration of registrations) {
      try { registration.afterDispose?.() } catch (error) { errors.push(error) }
      registration.disposed = true
    }
    if (this.activated) {
      releasePostRendererState(
        this.options.renderer,
        this.ownsToneMapping,
        this.installedToneMapping,
      )
    }
    if (errors.length > 0) {
      throw new Error(`Blendlink post-pipeline disposal failed: ${errors.map(message).join('; ')}`)
    }
  }

  private async createRegistration(
    descriptor: Readonly<PostEffectDescriptor>,
  ): Promise<PipelineRegistration> {
    switch (descriptor.type) {
      case 'blendlink.bloom': return createBloomEffect(this.post, descriptor, this.options)
      case 'blendlink.chromatic-aberration': return createChromaticAberrationEffect(
        this.post, descriptor, this.options,
      )
      case 'blendlink.pixelation': return createPixelationEffect(
        this.post, descriptor, this.options, this.normalPass,
      )
      case 'blendlink.sharpen': return createSharpenEffect(this.post, descriptor)
      case 'blendlink.tilt-shift': return createTiltShiftEffect(this.post, descriptor)
      case 'blendlink.vignette': return createVignetteEffect(this.post, descriptor)
      case 'blendlink.ambient-occlusion': {
        if (!this.n8ao) throw new Error('N8AO was not loaded for an enabled Ambient Occlusion component.')
        return createAmbientOcclusionPass(this.n8ao, descriptor, this.options)
      }
      case 'blendlink.outline': return createOutlineEffect(this.post, descriptor, this.options)
      case 'blendlink.color-grading': return createColorGradingEffect(this.post, descriptor, this.options)
      case 'blendlink.depth-of-field': return createDepthOfFieldEffect(this.post, descriptor, this.options)
      case 'blendlink.kuwahara': return createKuwaharaEffect(this.post, descriptor)
      default:
        throw new Error(
          `The Three.js post-pipeline does not implement semantic effect ${descriptor.type} (${descriptor.id}).`,
        )
    }
  }

  private applyEdgeAntialiasingQuality(quality: RuntimeQuality): void {
    if (!this.edgeAntialiasingEffect) {
      this.edgeAntialiasingPreset = 'off'
      return
    }
    const [preset, diagnostic] = quality === 'low'
      ? [this.post.SMAAPreset.LOW, 'low' as const]
      : quality === 'high'
        ? [this.post.SMAAPreset.HIGH, 'high' as const]
        : [this.post.SMAAPreset.MEDIUM, 'medium' as const]
    this.edgeAntialiasingEffect.applyPreset(preset)
    this.edgeAntialiasingPreset = diagnostic
  }
}

function generatesHardPostEdges(componentType: string): boolean {
  return componentType === 'blendlink.ambient-occlusion'
    || componentType === 'blendlink.outline'
}

function installBloom(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-hdr',
    values: context.component.values,
  })
}

function installChromaticAberration(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  return installScenePostEffect(context, 'post-ldr')
}

function installPixelation(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  return installScenePostEffect(context, 'post-ldr')
}

function installSharpen(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  return installScenePostEffect(context, 'post-ldr')
}

function installTiltShift(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  return installScenePostEffect(context, 'post-hdr')
}

function installScenePostEffect(
  context: ThreeComponentAdapterContext,
  phase: PostEffectDescriptor['phase'],
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase,
    values: context.component.values,
  })
}

function installVignette(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-ldr',
    values: context.component.values,
  })
}

function installAmbientOcclusion(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-depth',
    values: context.component.values,
  })
}

function installShadowCatcher(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation {
  const target = requireObjectTarget(context)
  const values = context.component.values
  const mode = string(values.mode, 'mask')
  if (mode !== 'mask' && mode !== 'additive' && mode !== 'occluder') {
    throw new Error(
      `Blendlink Shadow Catcher ${context.component.id} uses unsupported mode ${JSON.stringify(mode)}.`,
    )
  }
  const tint = color(values.color).toArray()
  const installed = installThreeShadowCatcher(target, {
    mode: mode as ThreeShadowCatcherMode,
    color: [tint[0]!, tint[1]!, tint[2]!],
    opacity: clamp(finite(values.opacity, 0.5), 0, 1),
    lightStrength: clamp(finite(values.lightStrength, 6.6), 0, 20),
    includeDescendants: boolean(values.includeDescendants, true),
  })
  return {
    // Mask/occluder use ordinary scene shadow/depth rendering. Additive is a
    // standard lit material; none requires a second Blendlink frame loop.
    isActive: () => false,
    dispose: () => installed.dispose(),
  }
}

function installContactShadows(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation {
  const target = context.object
  const values = context.component.values
  const autoFit = boolean(values.autoFit, true)
  if (!autoFit && !target) {
    throw new Error(
      `Blendlink Contact Shadows ${context.component.id} uses manual placement ` +
        'but targets the Scene. Move it to an Empty/group or enable Fit to Scene.',
    )
  }
  const updatePolicy = string(values.updatePolicy, 'static')
  if (updatePolicy !== 'static' && updatePolicy !== 'continuous') {
    throw new Error(
      `Blendlink Contact Shadows ${context.component.id} uses unsupported update policy ` +
        `${JSON.stringify(updatePolicy)}.`,
    )
  }
  const installed = installThreeContactShadows({
    scene: context.scene,
    root: context.root,
    ...(target ? { anchor: target } : {}),
    renderer: context.renderer,
    camera: context.camera,
    deferActivation: true,
    values: {
      autoFit,
      darkness: clamp(finite(values.darkness, 0.5), 0, 20),
      opacity: clamp(finite(values.opacity, 0.5), 0, 1),
      blur: clamp(finite(values.blur, 4), 0, 100),
      occludeBelowGround: boolean(values.occludeBelowGround, false),
      backfaceShadows: boolean(values.backfaceShadows, true),
      updatePolicy: updatePolicy as ThreeContactShadowUpdatePolicy,
    },
    ...(context.requestFrame ? { requestFrame: context.requestFrame } : {}),
  })
  return {
    activate: (scene, camera) => installed.activate(scene, camera),
    // R3F's direct path invokes update before its automatic render, while a
    // renderer-owning Vanilla/composer path invokes beforeRender. The deep
    // module coalesces both hooks into one refresh per host frame.
    update: () => installed.update(),
    beforeRender: () => installed.beforeRender(),
    isActive: () => installed.isActive(),
    dispose: () => installed.dispose(),
  }
}

function installOutline(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-ldr',
    values: context.component.values,
  })
}

function installColorGrading(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-ldr',
    values: context.component.values,
  })
}

function installDepthOfField(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  const mode = string(context.component.values.focusMode, 'distance')
  const focusObject = mode === 'object' ? resolveFocus(context) : undefined
  if (mode === 'object' && !focusObject) {
    throw new Error(
      `Blendlink Depth of Field ${context.component.id} uses Object focus but no focus target was selected.`,
    )
  }
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-depth',
    values: context.component.values,
    ...(focusObject ? { resources: { focusObject } } : {}),
  })
}

function installKuwahara(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation | Promise<ThreeComponentInstallation> {
  requireSceneTarget(context)
  return installPostEffect(context, {
    id: context.component.id,
    type: context.component.type,
    phase: 'post-ldr',
    values: context.component.values,
  })
}

async function installPostEffect(
  context: ThreeComponentAdapterContext,
  descriptor: Readonly<PostEffectDescriptor>,
): Promise<ThreeComponentInstallation> {
  const installation = await requirePostPipeline(context).addEffect(descriptor)
  return {
    update: installation.update
      ? (deltaSeconds) => installation.update?.(deltaSeconds)
      : undefined,
    fixedUpdate: installation.fixedUpdate
      ? (fixedDeltaSeconds) => installation.fixedUpdate?.(fixedDeltaSeconds)
      : undefined,
    resize: installation.resize
      ? (width, height) => {
          const ratio = typeof context.renderer.getPixelRatio === 'function'
            ? context.renderer.getPixelRatio()
            : 1
          installation.resize?.(width, height, positive(ratio) ? ratio : 1)
        }
      : undefined,
    beforeRender: installation.beforeRender ? () => installation.beforeRender?.() : undefined,
    afterRender: installation.afterRender ? () => installation.afterRender?.() : undefined,
    setQuality: installation.setQuality ? (quality) => installation.setQuality?.(quality) : undefined,
    dispose: () => installation.dispose(),
  }
}

function phaseRank(phase: PostEffectDescriptor['phase']): number {
  return phase === 'post-depth' ? 0 : phase === 'post-hdr' ? 1 : 2
}

function addCompatibleEffectPasses(
  post: PostprocessingModule,
  composer: PostEffectComposer,
  camera: THREE.Camera,
  registrations: Array<PipelineRegistration & { effect: PostEffect }>,
  resolvedOrder: string[],
): void {
  let group: Array<PipelineRegistration & { effect: PostEffect }> = []
  let convolution = false
  const flush = (): void => {
    if (group.length === 0) return
    composer.addPass(new post.EffectPass(camera, ...group.map((entry) => entry.effect)))
    resolvedOrder.push(...group.map((entry) => entry.id))
    group = []
    convolution = false
  }
  for (const registration of registrations) {
    const nextConvolution = (registration.effect.getAttributes()
      & post.EffectAttribute.CONVOLUTION) !== 0
    // pmndrs can fuse ordinary effects into one fullscreen triangle, but its
    // shader contract forbids two convolution effects in one EffectPass.
    if (convolution && nextConvolution) flush()
    group.push(registration)
    convolution ||= nextConvolution
  }
  flush()
}

function postToneMappingMode(
  post: PostprocessingModule,
  toneMapping: THREE.ToneMapping,
): import('postprocessing').ToneMappingMode | null {
  switch (toneMapping) {
    case THREE.LinearToneMapping: return post.ToneMappingMode.LINEAR
    case THREE.ReinhardToneMapping: return post.ToneMappingMode.REINHARD
    case THREE.CineonToneMapping: return post.ToneMappingMode.CINEON
    case THREE.ACESFilmicToneMapping: return post.ToneMappingMode.ACES_FILMIC
    case THREE.AgXToneMapping: return post.ToneMappingMode.AGX
    case THREE.NeutralToneMapping: return post.ToneMappingMode.NEUTRAL
    case THREE.NoToneMapping: return null
    default: return null
  }
}

function supportsHalfFloatTarget(renderer: THREE.WebGLRenderer): boolean {
  const capabilities = renderer.capabilities as THREE.WebGLCapabilities | undefined
  const extensions = renderer.extensions as (THREE.WebGLExtensions & {
    has?(name: string): boolean
  }) | undefined
  if (!capabilities || !extensions) return false
  const has = (name: string): boolean => {
    try {
      return typeof extensions.has === 'function'
        ? extensions.has(name)
        : extensions.get(name) !== null
    } catch {
      return false
    }
  }
  if (capabilities.isWebGL2) return has('EXT_color_buffer_float')
  return has('EXT_color_buffer_half_float') && has('OES_texture_half_float')
}

function postMultisampling(
  renderer: THREE.WebGLRenderer,
  quality: RuntimeQuality,
): number {
  const reported = Number((renderer.capabilities as THREE.WebGLCapabilities | undefined)?.maxSamples)
  if (!Number.isFinite(reported) || reported < 2) return 0
  const supported = Math.floor(reported)
  const desired = quality === 'low' ? 2 : quality === 'high' ? 8 : 4
  return Math.min(supported, desired)
}

function releasePostRendererState(
  renderer: THREE.WebGLRenderer,
  ownsToneMapping: boolean,
  installedToneMapping: THREE.ToneMapping,
): void {
  const state = POST_RENDERER_STATE.get(renderer)
  if (!state) return
  state.autoClearOwners = Math.max(0, state.autoClearOwners - 1)
  if (ownsToneMapping) state.toneMappingOwners = Math.max(0, state.toneMappingOwners - 1)
  if (ownsToneMapping && state.toneMappingOwners === 0
    && renderer.toneMapping === installedToneMapping) {
    renderer.toneMapping = state.originalToneMapping
  }
  if (state.autoClearOwners === 0 && renderer.autoClear === false) {
    renderer.autoClear = state.originalAutoClear
  }
  if (state.autoClearOwners === 0 && state.toneMappingOwners === 0) {
    POST_RENDERER_STATE.delete(renderer)
  }
}

function createBloomEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): PipelineRegistration {
  const values = descriptor.values
  const mode = string(values.mode, 'bright-pixels')
  const effectOptions: import('postprocessing').BloomEffectOptions = {
    intensity: clamp(finite(values.intensity, 0.5), 0, 100),
    luminanceThreshold: clamp(finite(values.threshold, 0.8), 0, 100),
    luminanceSmoothing: 0.05,
    radius: clamp(finite(values.radius, 0.4), 0, 1),
    mipmapBlur: true,
    levels: 7,
    resolutionScale: 0.5,
  }
  let effect: import('postprocessing').BloomEffect
  let beforeDispose: (() => void) | undefined
  if (mode === 'bright-pixels') {
    effect = new post.BloomEffect(effectOptions)
  } else if (mode === 'emissive-objects') {
    const selective = new post.SelectiveBloomEffect(options.scene, options.camera, effectOptions)
    const selected: THREE.Object3D[] = []
    options.root.traverse((object) => {
      if (isEmissiveRenderable(object)) selected.push(object)
    })
    selective.selection.set(selected)
    selective.ignoreBackground = true
    if (selected.length === 0) {
      warn(options,
        `Selective Bloom ${descriptor.id} found no exported mesh with visible emissive output; ` +
        'set Emission color/intensity on a material or use Bright Pixels mode.')
    }
    beforeDispose = () => selective.selection.clear()
    effect = selective
  } else {
    throw new Error(`Blendlink Bloom ${descriptor.id} uses unsupported mode ${JSON.stringify(mode)}.`)
  }
  const setQuality = (quality: RuntimeQuality): void => {
    effect.mipmapBlurPass.levels = quality === 'low' ? 5 : quality === 'balanced' ? 7 : 8
  }
  setQuality('balanced')
  return {
    id: descriptor.id, phase: descriptor.phase, effect, setQuality,
    ...(beforeDispose ? { beforeDispose } : {}), disposed: false,
  }
}

function isEmissiveRenderable(object: THREE.Object3D): boolean {
  const mesh = object as THREE.Mesh
  if (!mesh.isMesh) return false
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.some((material) => {
    const candidate = material as THREE.Material & {
      emissive?: THREE.Color
      emissiveIntensity?: number
      emissiveMap?: THREE.Texture | null
    }
    const intensity = finite(candidate.emissiveIntensity, 1)
    return intensity > 0 && Boolean(candidate.emissive)
      && (candidate.emissive!.r > 0 || candidate.emissive!.g > 0 || candidate.emissive!.b > 0)
  })
}

function createChromaticAberrationEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): PipelineRegistration {
  const values = descriptor.values
  const amount = clamp(finite(values.amount, 0.0015), 0, 0.05)
  const mode = string(values.mode, 'radial')
  let effect: PostEffect
  if (mode === 'directional') {
    const angle = THREE.MathUtils.degToRad(clamp(finite(values.angle, 0), -180, 180))
    effect = new post.ChromaticAberrationEffect({
      offset: new THREE.Vector2(Math.cos(angle) * amount, Math.sin(angle) * amount),
      radialModulation: false,
      modulationOffset: 0,
    })
  } else if (mode === 'radial') {
    effect = new post.Effect('BlendlinkRadialChromaticAberration', [
      'uniform float amount;',
      'uniform vec2 center;',
      'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {',
      '  vec2 fromCenter = uv - center;',
      '  vec2 roundSpace = vec2(fromCenter.x * aspect, fromCenter.y);',
      '  float distanceFromCenter = length(roundSpace);',
      '  vec2 direction = distanceFromCenter > 0.000001',
      '    ? vec2(roundSpace.x / max(aspect, 0.000001), roundSpace.y) / distanceFromCenter',
      '    : vec2(0.0);',
      '  vec2 shift = direction * amount * clamp(distanceFromCenter * 2.0, 0.0, 1.5);',
      '  vec2 redUv = clamp(uv + shift, vec2(0.0), vec2(1.0));',
      '  vec2 blueUv = clamp(uv - shift, vec2(0.0), vec2(1.0));',
      '  float red = texture2D(inputBuffer, redUv).r;',
      '  float blue = texture2D(inputBuffer, blueUv).b;',
      '  outputColor = vec4(red, inputColor.g, blue, inputColor.a);',
      '}',
    ].join('\n'), {
      blendFunction: post.BlendFunction.SRC,
      attributes: post.EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['amount', new THREE.Uniform(amount)],
        ['center', new THREE.Uniform(new THREE.Vector2(
          clamp(finite(values.centerX, 0.5), 0, 1),
          clamp(finite(values.centerY, 0.5), 0, 1),
        ))],
      ]),
    })
  } else {
    throw new Error(
      `Blendlink Chromatic Aberration ${descriptor.id} uses unsupported Pattern ${JSON.stringify(mode)}.`,
    )
  }
  if (amount > 0.01) {
    warn(options,
      `Chromatic Aberration ${descriptor.id} uses Amount ${amount}. Values above 0.01 can obscure ` +
      'fine silhouettes and reduce readability; verify the final page at phone size.')
  }
  return { id: descriptor.id, phase: descriptor.phase, effect, disposed: false }
}

function createPixelationEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
  normalPass: import('postprocessing').NormalPass | null,
): PipelineRegistration {
  const values = descriptor.values
  const cssPixelSize = clamp(finite(values.pixelSize, 6), 1, 256)
  const depthEdgeStrength = clamp(finite(values.depthEdgeStrength, 0), 0, 1)
  const normalEdgeStrength = clamp(finite(values.normalEdgeStrength, 0), 0, 1)
  const initialPixelRatio = typeof options.renderer.getPixelRatio === 'function'
    ? options.renderer.getPixelRatio()
    : 1
  const devicePixelSize = (): number => cssPixelSize * (
    positive(initialPixelRatio) ? initialPixelRatio : 1
  )

  if (depthEdgeStrength === 0 && normalEdgeStrength === 0) {
    const effect = new post.PixelationEffect(devicePixelSize())
    return {
      id: descriptor.id,
      phase: descriptor.phase,
      effect,
      resize: (_width, _height, pixelRatio) => {
        effect.granularity = cssPixelSize * (positive(pixelRatio) ? pixelRatio : 1)
      },
      disposed: false,
    }
  }
  if (normalEdgeStrength > 0 && !normalPass) {
    throw new Error(
      `Blendlink Pixelation ${descriptor.id} requested Normal Edges but the shared normal pass was not installed.`,
    )
  }

  const uniforms = new Map<string, THREE.Uniform>([
    ['pixelSize', new THREE.Uniform(devicePixelSize())],
    ['depthEdgeStrength', new THREE.Uniform(depthEdgeStrength)],
    ['normalEdgeStrength', new THREE.Uniform(normalEdgeStrength)],
    ['normalBuffer', new THREE.Uniform(normalPass?.texture ?? null)],
  ])
  const effect = new post.Effect('BlendlinkGeometryAwarePixelation', PIXELATION_FRAGMENT_SHADER, {
    blendFunction: post.BlendFunction.SRC,
    attributes: post.EffectAttribute.CONVOLUTION | post.EffectAttribute.DEPTH,
    uniforms,
  })
  const setQuality = (quality: RuntimeQuality): void => {
    if (normalPass) normalPass.resolution.scale = quality === 'low' ? 0.5 : 1
  }
  setQuality('balanced')
  if (countTransparentMeshes(options.root) > 0) {
    warn(options,
      `Geometry-aware Pixelation ${descriptor.id} uses the opaque depth/normal buffers. ` +
      'Transparent surfaces may not produce the same edge emphasis as opaque geometry.')
  }
  return {
    id: descriptor.id,
    phase: descriptor.phase,
    effect,
    resize: (_width, _height, pixelRatio) => {
      uniforms.get('pixelSize')!.value = cssPixelSize * (positive(pixelRatio) ? pixelRatio : 1)
    },
    setQuality,
    disposed: false,
  }
}

const PIXELATION_FRAGMENT_SHADER = `
uniform float pixelSize;
uniform float depthEdgeStrength;
uniform float normalEdgeStrength;
uniform sampler2D normalBuffer;

float blendlinkRelativeDepthDifference(const in vec2 a, const in vec2 b) {
  float viewA = getViewZ(readDepth(clamp(a, vec2(0.0), vec2(1.0))));
  float viewB = getViewZ(readDepth(clamp(b, vec2(0.0), vec2(1.0))));
  return abs(viewA - viewB) / max(min(abs(viewA), abs(viewB)), 0.0001);
}

float blendlinkNormalDifference(const in vec2 a, const in vec2 b) {
  vec3 normalA = normalize(texture2D(normalBuffer, clamp(a, vec2(0.0), vec2(1.0))).xyz * 2.0 - 1.0);
  vec3 normalB = normalize(texture2D(normalBuffer, clamp(b, vec2(0.0), vec2(1.0))).xyz * 2.0 - 1.0);
  return 1.0 - clamp(dot(normalA, normalB), 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 safeResolution = max(resolution, vec2(1.0));
  vec2 block = vec2(max(pixelSize, 1.0));
  vec2 cell = floor(uv * safeResolution / block) * block + block * 0.5;
  vec2 sampleUv = clamp(cell / safeResolution, vec2(0.0), vec2(1.0));
  vec2 stepUv = block / safeResolution;
  vec2 rightUv = sampleUv + vec2(stepUv.x, 0.0);
  vec2 upUv = sampleUv + vec2(0.0, stepUv.y);
  float depthEdge = max(
    blendlinkRelativeDepthDifference(sampleUv, rightUv),
    blendlinkRelativeDepthDifference(sampleUv, upUv)
  );
  float normalEdge = normalEdgeStrength > 0.0 ? max(
    blendlinkNormalDifference(sampleUv, rightUv),
    blendlinkNormalDifference(sampleUv, upUv)
  ) : 0.0;
  float edge = clamp(max(depthEdge * depthEdgeStrength, normalEdge * normalEdgeStrength) * 4.0, 0.0, 1.0);
  vec4 pixelColor = texture2D(inputBuffer, sampleUv);
  outputColor = vec4(pixelColor.rgb * (1.0 - edge * 0.82), pixelColor.a);
}`

/** Fixed 3x3 contrast-adaptive sharpening based on the public FidelityFX CAS
 * method. The artist control changes the bounded filter weights, never its
 * sample footprint. See https://gpuopen.com/fidelityfx-cas/ */
function createSharpenEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
): PipelineRegistration {
  const amount = clamp(finite(descriptor.values.amount, 0.35), 0, 1)
  const effect = new post.Effect('BlendlinkContrastAdaptiveSharpen', CAS_FRAGMENT_SHADER, {
    blendFunction: post.BlendFunction.SRC,
    attributes: post.EffectAttribute.CONVOLUTION,
    uniforms: new Map<string, THREE.Uniform>([
      ['amount', new THREE.Uniform(amount)],
    ]),
  })
  return { id: descriptor.id, phase: descriptor.phase, effect, disposed: false }
}

const CAS_FRAGMENT_SHADER = `
uniform float amount;

vec3 blendlinkCasSample(const in vec2 uv) {
  return texture2D(inputBuffer, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 north = blendlinkCasSample(uv + vec2(0.0, -texelSize.y));
  vec3 west = blendlinkCasSample(uv + vec2(-texelSize.x, 0.0));
  vec3 center = inputColor.rgb;
  vec3 east = blendlinkCasSample(uv + vec2(texelSize.x, 0.0));
  vec3 south = blendlinkCasSample(uv + vec2(0.0, texelSize.y));
  vec3 minimum = min(center, min(min(north, south), min(east, west)));
  vec3 maximum = max(center, max(max(north, south), max(east, west)));
  vec3 amplification = sqrt(clamp(min(minimum, 1.0 - maximum) / max(maximum, vec3(0.0001)), 0.0, 1.0));
  float peak = -1.0 / mix(8.0, 5.0, amount);
  vec3 weight = amplification * peak;
  vec3 sharpened = (north * weight + west * weight + east * weight + south * weight + center)
    / max(vec3(1.0) + 4.0 * weight, vec3(0.0001));
  outputColor = vec4(mix(center, clamp(sharpened, 0.0, 1.0), amount), inputColor.a);
}`

function createTiltShiftEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
): PipelineRegistration {
  const values = descriptor.values
  const authoredQuality = qualityRank(string(values.quality, 'balanced'))
  const effect = new post.TiltShiftEffect({
    offset: (clamp(finite(values.focusPosition, 0.5), 0, 1) - 0.5) * 2,
    rotation: THREE.MathUtils.degToRad(clamp(finite(values.angle, 0), -180, 180)),
    focusArea: 0.4,
    feather: clamp(finite(values.feather, 0.25), 0.001, 1),
    kernelSize: post.KernelSize.MEDIUM,
    resolutionScale: 0.5,
  })
  effect.blendMode.opacity.value = clamp(finite(values.strength, 0.7), 0, 1)
  const setQuality = (quality: RuntimeQuality): void => {
    const effective = Math.min(authoredQuality, qualityRank(quality))
    effect.blurPass.kernelSize = effective === 0
      ? post.KernelSize.SMALL
      : effective === 1
        ? post.KernelSize.MEDIUM
        : post.KernelSize.LARGE
    effect.resolution.scale = effective === 0 ? 0.35 : effective === 1 ? 0.5 : 1
  }
  setQuality('balanced')
  return { id: descriptor.id, phase: descriptor.phase, effect, setQuality, disposed: false }
}

function qualityRank(value: string): 0 | 1 | 2 {
  if (value === 'low') return 0
  if (value === 'balanced') return 1
  if (value === 'high') return 2
  throw new Error(`Unsupported Blendlink runtime quality ${JSON.stringify(value)}.`)
}

function createVignetteEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
): PipelineRegistration {
  const values = descriptor.values
  const effect = new post.Effect('BlendlinkVignette', [
    'uniform float intensity;',
    'uniform float softness;',
    'uniform vec3 tint;',
    'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {',
    '  float distanceToCenter = length((uv - 0.5) * 1.41421356237);',
    '  float edge = smoothstep(1.0 - softness, 1.0, distanceToCenter) * intensity;',
    '  outputColor = vec4(mix(inputColor.rgb, tint, edge), inputColor.a);',
    '}',
  ].join('\n'), {
    blendFunction: post.BlendFunction.SRC,
    uniforms: new Map<string, THREE.Uniform>([
      ['intensity', new THREE.Uniform(clamp(finite(values.intensity, 0.25), 0, 1))],
      ['softness', new THREE.Uniform(clamp(finite(values.softness, 0.55), 0.001, 1))],
      ['tint', new THREE.Uniform(color(values.color))],
    ]),
  })
  return { id: descriptor.id, phase: descriptor.phase, effect, disposed: false }
}

function createAmbientOcclusionPass(
  n8ao: N8AOModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): PipelineRegistration {
  const size = composerSize(options.renderer)
  const pass = new n8ao.N8AOPostPass(options.scene, options.camera, size.width, size.height)
  const values = descriptor.values
  const radiusMode = string(values.radiusMode, 'world')
  if (radiusMode !== 'world' && radiusMode !== 'screen') {
    throw new Error(`Blendlink Ambient Occlusion ${descriptor.id} uses unsupported Radius mode ${radiusMode}.`)
  }
  pass.configuration.gammaCorrection = false
  pass.configuration.screenSpaceRadius = radiusMode === 'screen'
  pass.configuration.aoRadius = radiusMode === 'screen'
    ? clamp(finite(values.screenRadius, 32), 1, 512)
    : clamp(finite(values.worldRadius, 1), 0.0001, 1_000_000)
  pass.configuration.intensity = clamp(finite(values.intensity, 2), 0, 100)
  // Blendlink colors are linear. N8AO 1.10.2 interprets this public field as
  // sRGB and converts it to linear during render, so adapt at the boundary.
  pass.configuration.color = color(values.color).convertLinearToSRGB()
  const setQuality = (quality: RuntimeQuality): void => {
    pass.configuration.halfRes = quality !== 'high'
    pass.setQualityMode(quality === 'low' ? 'Performance' : quality === 'balanced' ? 'Medium' : 'High')
  }
  const rebind = (scene: THREE.Scene, camera: THREE.Camera): void => {
    const targets = pass as unknown as { scene: THREE.Scene; camera: THREE.Camera }
    const wasOrthographic = (targets.camera as THREE.OrthographicCamera).isOrthographicCamera === true
    const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera === true
    const cameraModeChanged = wasOrthographic !== orthographic
    targets.scene = scene
    targets.camera = camera
    pass.firstFrame()
    if (cameraModeChanged) {
      const depthBufferType = pass.configuration.depthBufferType
      pass.configureAOPass(depthBufferType, orthographic)
      pass.configureDenoisePass(depthBufferType, orthographic)
      pass.configureEffectCompositer(depthBufferType, orthographic)
    }
  }
  setQuality('balanced')
  const transparentMeshes = countTransparentMeshes(options.root)
  if (transparentMeshes > 20) {
    warn(options,
      `Ambient Occlusion will inspect ${transparentMeshes} transparent meshes. N8AO may render transparent ` +
      'geometry an additional time; measure this scene on the target device or use baked occlusion.')
  }
  return { id: descriptor.id, phase: descriptor.phase, pass, setQuality, rebind, disposed: false }
}

function createOutlineEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): PipelineRegistration {
  const values = descriptor.values
  const authoredThickness = clamp(finite(values.thickness, 1), 0, 16)
  const thickness = Math.max(authoredThickness, 0.25)
  const kernelSize = thickness < 1
    ? post.KernelSize.VERY_SMALL
    : thickness < 2
      ? post.KernelSize.SMALL
      : thickness < 4
        ? post.KernelSize.MEDIUM
        : thickness < 8
          ? post.KernelSize.LARGE
          : thickness < 12
            ? post.KernelSize.VERY_LARGE
            : post.KernelSize.HUGE
  const selected: THREE.Object3D[] = []
  options.root.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Line | THREE.Points
    if ((renderable as THREE.Mesh).isMesh || (renderable as THREE.Line).isLine
      || (renderable as THREE.Points).isPoints) selected.push(object)
  })
  const selectionLayer = unusedOutlineLayer(options.scene)
  const effect = new post.OutlineEffect(options.scene, options.camera, {
    // The installed OutlineEffect default is SCREEN, where black is the
    // identity color. ALPHA makes artist-authored dark outlines visible.
    blendFunction: post.BlendFunction.ALPHA,
    edgeStrength: authoredThickness === 0 ? 0 : clamp(finite(values.strength, 3), 0, 100),
    kernelSize,
    blur: thickness > 1,
    xRay: boolean(values.xRay, false),
    resolutionScale: clamp(1 / Math.max(1, thickness * 0.75), 0.25, 1),
  })
  effect.visibleEdgeColor = color(values.visibleColor)
  effect.hiddenEdgeColor = color(values.hiddenColor)
  effect.selection.layer = selectionLayer
  preserveLayerMasks(selected, () => effect.selection.set(selected))
  const update = effect.update.bind(effect)
  effect.update = (renderer, inputBuffer, deltaTime) => {
    const cameraMask = options.camera.layers.mask
    preserveLayerMasks(selected, () => {
      try {
        // OutlineEffect's Selection toggles layer 0 to hide selected objects
        // from its occluder depth pass. That fails for application-authored
        // nonzero layers and leaves layer 0 enabled afterwards. During this
        // update only, put the selection exclusively on Blendlink's unused
        // layer and keep that layer out of the occluder camera mask. The
        // effect switches to the reserved layer for its mask pass itself.
        for (const object of selected) object.layers.set(selectionLayer)
        options.camera.layers.disable(selectionLayer)
        update(renderer, inputBuffer, deltaTime)
      } finally {
        options.camera.layers.mask = cameraMask
      }
    })
  }
  if (selected.length === 0) warn(options, `Outline ${descriptor.id} has no rendered objects to outline.`)
  const authoredScale = effect.resolution.scale
  const setQuality = (quality: RuntimeQuality): void => {
    const multiplier = quality === 'low' ? 0.5 : quality === 'balanced' ? 0.75 : 1
    effect.resolution.scale = clamp(authoredScale * multiplier, 0.25, 1)
  }
  setQuality('balanced')
  return {
    id: descriptor.id, phase: descriptor.phase, effect, setQuality,
    beforeDispose: () => preserveLayerMasks(selected, () => effect.selection.clear()),
    disposed: false,
  }
}

function preserveLayerMasks<T>(objects: readonly THREE.Object3D[], action: () => T): T {
  const masks = objects.map((object) => object.layers.mask)
  try {
    return action()
  } finally {
    objects.forEach((object, index) => { object.layers.mask = masks[index]! })
  }
}

function unusedOutlineLayer(scene: THREE.Scene): number {
  const used = new Set<number>()
  const visit = (object: THREE.Object3D): void => {
    // Cameras use layers as a visibility mask, not as occupied render
    // content. Package-created helpers may also mirror every camera layer;
    // neither consumes a layer that Outline can temporarily reserve.
    if (object.userData.blendlink_internal === true) return
    if ((object as THREE.Mesh).isMesh
      || (object as THREE.Line).isLine
      || (object as THREE.Points).isPoints) {
      for (let layer = 1; layer < 32; layer += 1) {
        if (object.layers.isEnabled(layer)) used.add(layer)
      }
    }
    for (const child of object.children) visit(child)
  }
  visit(scene)
  for (let layer = 31; layer >= 1; layer -= 1) {
    if (!used.has(layer)) return layer
  }
  throw new Error(
    'Blendlink Outline needs one temporary render layer, but the application scene uses all 31 non-default layers.',
  )
}

async function createColorGradingEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): Promise<PipelineRegistration> {
  const values = descriptor.values
  const url = safeUrl(values.lutUrl, 'LUT URL', new Set(['http', 'https', 'blob', 'data']))
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase()
  let texture: THREE.Data3DTexture
  const ownsTexture = options.loadLut === undefined
  if (options.loadLut) {
    texture = await options.loadLut(url)
    if (!(texture instanceof THREE.Data3DTexture)) {
      throw new Error(`Blendlink Color Grading ${descriptor.id} LUT resolver did not return a Data3DTexture.`)
    }
  } else if (extension === 'cube') {
    const { LUTCubeLoader } = await import('three/addons/loaders/LUTCubeLoader.js')
    texture = (await new LUTCubeLoader(options.loadingManager).loadAsync(url)).texture3D
  } else if (extension === '3dl') {
    const { LUT3dlLoader } = await import('three/addons/loaders/LUT3dlLoader.js')
    texture = (await new LUT3dlLoader(options.loadingManager).loadAsync(url)).texture3D
  } else {
    throw new Error(
      `Blendlink Color Grading ${descriptor.id} needs a .cube or .3dl LUT URL; got ${JSON.stringify(url)}.`,
    )
  }
  const effect = new post.LUT3DEffect(texture, {
    // LUT3DEffect defaults to SRC, whose shader ignores blend opacity.
    // NORMAL makes the authored intensity a real input/LUT interpolation.
    blendFunction: post.BlendFunction.NORMAL,
    tetrahedralInterpolation: boolean(values.tetrahedralInterpolation, true),
  })
  effect.blendMode.opacity.value = clamp(finite(values.intensity, 1), 0, 1)
  return {
    id: descriptor.id, phase: descriptor.phase, effect,
    ...(ownsTexture ? { afterDispose: () => texture.dispose() } : {}), disposed: false,
  }
}

function createDepthOfFieldEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
  options: InstallThreeComponentsOptions,
): PipelineRegistration {
  const values = descriptor.values
  const mode = string(values.focusMode, 'distance')
  if (mode !== 'distance' && mode !== 'object') {
    throw new Error(`Blendlink Depth of Field ${descriptor.id} uses unsupported focus mode ${mode}.`)
  }
  const effect = new post.DepthOfFieldEffect(options.camera, {
    focusDistance: clamp(finite(values.focusDistance, 3), 0, 1_000_000),
    focusRange: clamp(finite(values.focusRange, 2), 0.0001, 1_000_000),
    bokehScale: clamp(finite(values.blurStrength, 1), 0, 20),
    resolutionScale: 0.5,
  })
  const focusObject = descriptor.resources?.focusObject
  let update: ((deltaSeconds: number) => void) | undefined
  if (mode === 'object') {
    if (!(focusObject instanceof THREE.Object3D)) {
      throw new Error(`Blendlink Depth of Field ${descriptor.id} could not resolve its object focus target.`)
    }
    const target = new THREE.Vector3()
    focusObject.getWorldPosition(target)
    effect.target = target
    update = () => { focusObject.getWorldPosition(target) }
  }
  const setQuality = (quality: RuntimeQuality): void => {
    effect.resolution.scale = quality === 'low' ? 0.25 : quality === 'balanced' ? 0.5 : 1
  }
  setQuality('balanced')
  const camera = options.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera
  if ('near' in camera && 'far' in camera && camera.near > 0 && camera.far / camera.near > 100_000) {
    warn(options,
      `Depth of Field ${descriptor.id} uses camera near/far ${camera.near}/${camera.far}. ` +
      'This depth range can cause unstable focus edges; tighten the camera clipping range when possible.')
  }
  return {
    id: descriptor.id, phase: descriptor.phase, effect, setQuality,
    ...(update ? { update } : {}), disposed: false,
  }
}

/** Preview-only single-pass approximation of anisotropic sector filtering.
 * It estimates a local direction from immediate gradients, samples four sparse
 * sectors, and variance-weights their means. The fixed loop bound prevents an
 * artist slider from creating unbounded GPU work. */
function createKuwaharaEffect(
  post: PostprocessingModule,
  descriptor: Readonly<PostEffectDescriptor>,
): PipelineRegistration {
  const values = descriptor.values
  const uniforms = new Map<string, THREE.Uniform>([
    ['texelSize', new THREE.Uniform(new THREE.Vector2(1, 1))],
    ['strength', new THREE.Uniform(clamp(finite(values.strength, 0.75), 0, 1))],
    ['brushScale', new THREE.Uniform(clamp(finite(values.brushScale, 4), 1, 32))],
    ['directionality', new THREE.Uniform(clamp(finite(values.directionality, 0.75), 0, 1))],
    ['detail', new THREE.Uniform(clamp(finite(values.detail, 0.5), 0, 1))],
    ['sampleCount', new THREE.Uniform(12)],
    ['qualityScale', new THREE.Uniform(1)],
  ])
  const effect = new post.Effect('BlendlinkAnisotropicKuwahara', KUWAHARA_FRAGMENT_SHADER, {
    blendFunction: post.BlendFunction.SRC,
    attributes: post.EffectAttribute.CONVOLUTION,
    uniforms,
  })
  const baseSetSize = effect.setSize.bind(effect)
  effect.setSize = (width: number, height: number): void => {
    baseSetSize(width, height)
    ;(uniforms.get('texelSize')!.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height))
  }
  const setQuality = (quality: RuntimeQuality): void => {
    uniforms.get('sampleCount')!.value = quality === 'low' ? 8 : quality === 'balanced' ? 12 : 16
    uniforms.get('qualityScale')!.value = quality === 'low' ? 0.75 : quality === 'balanced' ? 1 : 1.15
  }
  setQuality('balanced')
  return { id: descriptor.id, phase: descriptor.phase, effect, setQuality, disposed: false }
}

const KUWAHARA_FRAGMENT_SHADER = `
uniform vec2 texelSize;
uniform float strength;
uniform float brushScale;
uniform float directionality;
uniform float detail;
uniform float sampleCount;
uniform float qualityScale;

float blendlinkLuma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void blendlinkSector(
  const in vec2 uv,
  const in float orientation,
  const in float anisotropy,
  const in float sectorAngle,
  out vec3 mean,
  out float variance
) {
  vec3 sum = vec3(0.0);
  vec3 sumSquared = vec3(0.0);
  float totalWeight = 0.0;
  float minorAxis = mix(1.0, 0.35, directionality * anisotropy);
  float radius = brushScale * qualityScale * mix(1.15, 0.65, detail * anisotropy);
  mat2 rotation = mat2(cos(orientation), -sin(orientation), sin(orientation), cos(orientation));
  for (int i = 0; i < 16; ++i) {
    if (float(i) >= sampleCount) continue;
    float fi = float(i);
    float ring = (floor(fi / 4.0) + 1.0) / 4.0;
    float fan = (mod(fi, 4.0) - 1.5) * 0.36;
    float angle = sectorAngle + fan;
    vec2 disk = vec2(cos(angle), sin(angle)) * ring;
    float radial = max(0.0, 1.0 - dot(disk, disk));
    float angular = max(0.0, cos(fan));
    float weight = max(0.0001, radial * radial * angular * angular);
    vec2 ellipse = rotation * vec2(disk.x, disk.y * minorAxis);
    vec2 sampleUv = clamp(uv + ellipse * radius * texelSize, vec2(0.0), vec2(1.0));
    vec3 sampleColor = texture2D(inputBuffer, sampleUv).rgb;
    sum += sampleColor * weight;
    sumSquared += sampleColor * sampleColor * weight;
    totalWeight += weight;
  }
  mean = sum / max(totalWeight, 0.0001);
  vec3 channelVariance = max(sumSquared / max(totalWeight, 0.0001) - mean * mean, vec3(0.0));
  variance = dot(channelVariance, vec3(0.299, 0.587, 0.114));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float left = blendlinkLuma(texture2D(inputBuffer, clamp(uv - vec2(texelSize.x, 0.0), vec2(0.0), vec2(1.0))).rgb);
  float right = blendlinkLuma(texture2D(inputBuffer, clamp(uv + vec2(texelSize.x, 0.0), vec2(0.0), vec2(1.0))).rgb);
  float down = blendlinkLuma(texture2D(inputBuffer, clamp(uv - vec2(0.0, texelSize.y), vec2(0.0), vec2(1.0))).rgb);
  float up = blendlinkLuma(texture2D(inputBuffer, clamp(uv + vec2(0.0, texelSize.y), vec2(0.0), vec2(1.0))).rgb);
  float gx = right - left;
  float gy = up - down;
  float jxx = gx * gx;
  float jyy = gy * gy;
  float jxy = gx * gy;
  float orientation = 0.5 * atan(2.0 * jxy, jxx - jyy);
  float anisotropy = clamp(sqrt((jxx - jyy) * (jxx - jyy) + 4.0 * jxy * jxy) / (jxx + jyy + 0.0001), 0.0, 1.0);

  vec3 m0; vec3 m1; vec3 m2; vec3 m3;
  float v0; float v1; float v2; float v3;
  blendlinkSector(uv, orientation, anisotropy, 0.0, m0, v0);
  blendlinkSector(uv, orientation, anisotropy, 1.57079632679, m1, v1);
  blendlinkSector(uv, orientation, anisotropy, 3.14159265359, m2, v2);
  blendlinkSector(uv, orientation, anisotropy, 4.71238898038, m3, v3);
  float w0 = 1.0 / pow(0.0001 + v0, 2.0);
  float w1 = 1.0 / pow(0.0001 + v1, 2.0);
  float w2 = 1.0 / pow(0.0001 + v2, 2.0);
  float w3 = 1.0 / pow(0.0001 + v3, 2.0);
  vec3 filtered = (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / max(w0 + w1 + w2 + w3, 0.0001);
  outputColor = vec4(mix(inputColor.rgb, filtered, strength), inputColor.a);
}`

function disposeUnfinalizedRegistration(
  registration: PipelineRegistration,
  runHooks = true,
): void {
  if (registration.disposed) return
  if (runHooks) registration.beforeDispose?.()
  registration.effect?.dispose()
  registration.pass?.dispose()
  if (runHooks) registration.afterDispose?.()
  registration.disposed = true
}

function countTransparentMeshes(root: THREE.Object3D): number {
  let count = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((material) => material.transparent || material.alphaTest > 0)) count += 1
  })
  return count
}

function warn(options: InstallThreeComponentsOptions, message: string): void {
  if (options.onWarning) options.onWarning(message)
  else console.warn(message)
}

function installWebsiteSurface(
  context: ThreeComponentAdapterContext,
): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const surfaces = implementationHook<ThreeWebsiteSurfaces>(
    context, '__blendlinkWebsiteSurfaces',
  )
  if (!surfaces) {
    throw new Error('Blendlink Website Surface is missing its scene-local ownership coordinator.')
  }
  const name = requiredString(
    context.component.values.name, `${context.component.type}.name`,
  )
  const colorTreatment = string(
    context.component.values.colorTreatment, 'display',
  ) as WebsiteSurfaceColorTreatment
  return surfaces.register({
    componentId: context.component.id,
    name,
    target: object,
    colorTreatment,
  })
}

function installHideOnStart(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const state = HIDDEN_STATES.get(object) ?? { authored: object.visible, owners: 0 }
  state.owners += 1
  HIDDEN_STATES.set(object, state)
  object.visible = false
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      state.owners = Math.max(0, state.owners - 1)
      if (state.owners > 0) return
      if (object.visible === false) object.visible = state.authored
      HIDDEN_STATES.delete(object)
    },
  }
}

function installLookAt(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const focus = resolveFocus(context)
  const state = LOOK_AT_STATES.get(object) ?? {
    authored: object.quaternion.clone(),
    lastApplied: object.quaternion.clone(),
    owners: 0,
  }
  state.owners += 1
  LOOK_AT_STATES.set(object, state)
  const point = new THREE.Vector3()
  let disposed = false
  return {
    update() {
      if (focus) focus.getWorldPosition(point)
      else context.camera.getWorldPosition(point)
      object.lookAt(point)
      state.lastApplied.copy(object.quaternion)
    },
    dispose() {
      if (disposed) return
      disposed = true
      state.owners = Math.max(0, state.owners - 1)
      if (state.owners > 0) return
      if (object.quaternion.equals(state.lastApplied)) object.quaternion.copy(state.authored)
      LOOK_AT_STATES.delete(object)
    },
  }
}

function installSeeThrough(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  // The component target is the point the camera should keep visible. Every
  // renderable between the active camera and that target becomes translucent;
  // this is more useful than making artists tag every potential wall.
  const focus = requireObjectTarget(context)
  const opacity = clamp(finite(context.component.values.minOpacity, 0.15), 0, 1)
  const clearance = Math.max(0, finite(context.component.values.fadeDistance, 0.5))
  const duration = Math.max(0, finite(context.component.values.duration, 0.12))
  const raycaster = new THREE.Raycaster()
  const cameraPosition = new THREE.Vector3()
  const focusPosition = new THREE.Vector3()
  const entries = new Map<THREE.Mesh, SeeThroughEntry>()
  const owner = Symbol(context.component.id)

  const ensureEntry = (mesh: THREE.Mesh): SeeThroughEntry => {
    const known = entries.get(mesh)
    if (known) return known
    let entry = SEE_THROUGH_STATES.get(mesh)
    if (!entry) {
      const original = mesh.material
      const originals = Array.isArray(original) ? original : [original]
      const installed = originals.map((material) => {
        const clone = material.clone()
        clone.name = material.name ? `${material.name} / Blendlink See Through` : 'Blendlink See Through'
        return clone
      })
      entry = {
        mesh,
        original,
        installed: Array.isArray(original) ? installed : installed[0]!,
        originals,
        clones: installed,
        requests: new Map(),
      }
      mesh.material = entry.installed
      SEE_THROUGH_STATES.set(mesh, entry)
    }
    entry.requests.set(owner, { blocked: true, opacity })
    entries.set(mesh, entry)
    return entry
  }

  const releaseEntry = (entry: SeeThroughEntry): void => {
    entry.requests.delete(owner)
    entries.delete(entry.mesh)
    if (entry.requests.size > 0) return
    if (entry.mesh.material === entry.installed) entry.mesh.material = entry.original
    for (const clone of entry.clones) clone.dispose()
    SEE_THROUGH_STATES.delete(entry.mesh)
  }

  const setBlockedMeshes = (blocked: Set<THREE.Mesh>): void => {
    for (const entry of entries.values()) {
      const request = entry.requests.get(owner)
      if (request) request.blocked = false
    }
    for (const mesh of blocked) {
      const request = ensureEntry(mesh).requests.get(owner)
      if (request) request.blocked = true
    }
  }

  const animate = (deltaSeconds: number): void => {
    const step = duration <= 0 ? 1 : clamp(Math.max(0, deltaSeconds) / duration, 0, 1)
    for (const entry of [...entries.values()]) {
      const active = [...entry.requests.values()].filter((request) => request.blocked)
      const blocked = active.length > 0
      let restored = true
      for (let index = 0; index < entry.clones.length; index += 1) {
        const clone = entry.clones[index]!
        const original = entry.originals[index]!
        const target = blocked
          ? Math.min(original.opacity, ...active.map((request) => request.opacity))
          : original.opacity
        clone.opacity += (target - clone.opacity) * step
        if (Math.abs(clone.opacity - target) < 0.001) clone.opacity = target
        clone.transparent = blocked || original.transparent || clone.opacity < 1
        clone.depthWrite = blocked ? false : original.depthWrite
        clone.needsUpdate = true
        if (clone.opacity !== original.opacity) restored = false
      }
      if (!blocked && restored) releaseEntry(entry)
    }
  }
  return {
    update(deltaSeconds) {
      context.camera.getWorldPosition(cameraPosition)
      focus.getWorldPosition(focusPosition)
      const direction = focusPosition.sub(cameraPosition)
      const distance = direction.length()
      const blocked = new Set<THREE.Mesh>()
      if (distance > Number.EPSILON) {
        raycaster.set(cameraPosition, direction.normalize())
        for (const hit of raycaster.intersectObject(context.root, true)) {
          if (hit.distance >= distance - clearance || isPartOf(hit.object, focus)) continue
          if ((hit.object as THREE.Mesh).isMesh) blocked.add(hit.object as THREE.Mesh)
        }
      }
      setBlockedMeshes(blocked)
      animate(deltaSeconds)
    },
    dispose() {
      for (const entry of [...entries.values()]) releaseEntry(entry)
    },
  }
}

function installOpenUrl(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const url = safeUrl(
    context.component.values.url, `${context.component.type}.url`,
    new Set(['http', 'https', 'mailto', 'tel']),
  )
  const target = boolean(context.component.values.newTab, true) ? '_blank' : '_self'
  const open = implementationHook<(url: string, target: string) => unknown>(context, '__blendlinkOpenUrl')
    ?? ((nextUrl, nextTarget) => globalThis.open?.(nextUrl, nextTarget, 'noopener'))
  const activate = () => { open(url, target) }
  return combineInstallations(
    onClick(context, object, activate),
    accessibleControl(context, object, 'link', activate, url, target),
  )
}

function installHover(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const multiplier = finite(context.component.values.scale, 1.08)
  if (multiplier <= 0) throw new Error(`Blendlink hover component ${context.component.id} needs a positive scale.`)
  const original = object.scale.clone()
  const installed = original.clone().multiplyScalar(multiplier)
  const duration = Math.max(0, finite(context.component.values.duration, 0.12))
  let hovering = false
  let progress = 0
  let lastApplied = original.clone()
  const interaction = onHover(context, object, (next) => { hovering = next }, () => {})
  return {
    isActive() { return Math.abs(progress - (hovering ? 1 : 0)) > 1e-5 },
    update(deltaSeconds) {
      const target = hovering ? 1 : 0
      if (duration <= 0) progress = target
      else if (target > progress) progress = Math.min(target, progress + Math.max(0, deltaSeconds) / duration)
      else progress = Math.max(target, progress - Math.max(0, deltaSeconds) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      lastApplied.copy(original).lerp(installed, eased)
      object.scale.copy(lastApplied)
    },
    dispose() {
      interaction.dispose?.()
      if (object.scale.equals(lastApplied)) object.scale.copy(original)
    },
  }
}

function installPlayAnimationOnClick(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const clipName = requiredString(context.component.values.clip, `${context.component.type}.clip`)
  const clip = context.animations.find((candidate) => candidate.name === clipName)
  if (!clip) {
    throw new Error(
      `Blendlink click-animation component ${context.component.id} references clip "${clipName}", ` +
        `but the GLB contains: ${context.animations.map((entry) => entry.name).join(', ') || 'none'}.`,
    )
  }
  const mixerRoot = resolveFocus(context) ?? context.root
  const mixer = new THREE.AnimationMixer(mixerRoot)
  const action = mixer.clipAction(clip)
  action.clampWhenFinished = boolean(context.component.values.clampWhenFinished, false)
  action.timeScale = finite(context.component.values.speed, 1)
  const loop = boolean(context.component.values.loop, false)
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
  const click = onClick(context, object, () => { action.reset().play() })
  const accessible = accessibleControl(
    context, object, 'button', () => { action.reset().play() },
  )
  return {
    isActive() { return action.isRunning() },
    update(deltaSeconds) { mixer.update(deltaSeconds) },
    dispose() {
      click.dispose?.()
      accessible.dispose?.()
      mixer.stopAllAction()
      mixer.uncacheRoot(mixerRoot)
    },
  }
}

async function installAudioSource(context: ThreeComponentAdapterContext): Promise<ThreeComponentInstallation> {
  const values = context.component.values
  const url = safeUrl(values.url, `${context.component.type}.url`, new Set(['http', 'https']))
  const listener = ensureAudioListener(context)
  const positional = boolean(values.spatial, false)
  const autoplay = boolean(values.autoplay, false)
  const audio = positional ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener)
  const parent = context.object ?? context.scene
  parent.add(audio)
  let installed = false
  try {
    const loader = implementationHook<Pick<THREE.AudioLoader, 'loadAsync'>>(context, '__blendlinkAudioLoader')
      ?? new THREE.AudioLoader(
        implementationHook<THREE.LoadingManager>(context, '__blendlinkLoadingManager'),
      )
    audio.setBuffer(await loader.loadAsync(url))
    audio.setLoop(boolean(values.loop, false))
    audio.setVolume(clamp(finite(values.volume, 1), 0, 1))
    if (audio instanceof THREE.PositionalAudio) {
      const fullVolumeWithin = Math.max(0, finite(values.minDistance, 2))
      const silentBeyond = Math.max(0, finite(values.maxDistance, 50))
      if (silentBeyond <= fullVolumeWithin) {
        throw new Error(
          `Silent Beyond (${silentBeyond}) must be farther than Full Volume Within (${fullVolumeWithin}).`,
        )
      }
      // Three/Web Audio defaults to inverse falloff, where maxDistance only
      // stops further attenuation.  Artists author an explicit audible range,
      // so use the portable Web Audio linear model with full rolloff: gain is
      // 1 through refDistance and exactly 0 at/after maxDistance.
      audio.setDistanceModel('linear')
      audio.setRolloffFactor(1)
      audio.setRefDistance(fullVolumeWithin)
      audio.setMaxDistance(silentBeyond)
    }
    const mutable = implementationHook<Map<string, ThreeAudio>>(context, '__blendlinkAudioSourcesMutable')
    mutable?.set(context.component.id, audio)
    installed = true
  } catch (error) {
    const cleanupErrors = disconnectAudio(audio, parent)
    throw new Error(
      `Blendlink audio source ${context.component.id} could not load "${url}": ${message(error)}` +
        (cleanupErrors.length > 0
          ? `. Audio rollback also failed: ${cleanupErrors.map(message).join('; ')}`
          : ''),
    )
  }
  return {
    activate() {
      if (autoplay) audio.play()
    },
    dispose() {
      if (!installed) return
      installed = false
      const mutable = implementationHook<Map<string, ThreeAudio>>(context, '__blendlinkAudioSourcesMutable')
      if (mutable?.get(context.component.id) === audio) mutable.delete(context.component.id)
      const errors = disconnectAudio(audio, parent)
      if (errors.length > 0) {
        throw new Error(`Could not disconnect audio source ${context.component.id}: ${errors.map(message).join('; ')}`)
      }
    },
  }
}

function installPlayAudioOnClick(context: ThreeComponentAdapterContext): ThreeComponentInstallation {
  const object = requireObjectTarget(context)
  const sourceId = string(context.component.values.sourceId, '')
  const sourceName = string(context.component.values.sourceName, '')
  const sources = context.audioSources
  const sourceObject = (sourceId ? context.bindings.byId[sourceId] : undefined)
    ?? (sourceName ? context.bindings.byName[sourceName] : undefined)
    ?? object
  const source = sources.get(sourceId) ?? [...sources.values()].find((audio) => audio.parent === sourceObject)
  if (!source) {
    throw new Error(
      `Blendlink click-audio component ${context.component.id} cannot find audio source ` +
        `"${sourceId || sourceName || 'on this object'}". Put audio-source before it or set sourceId.`,
    )
  }
  const activate = () => {
    if (boolean(context.component.values.toggle, false) && source.isPlaying) source.stop()
    else if (!source.isPlaying) {
      const audio = implementationHook<ThreeAudioCoordinator>(context, '__blendlinkAudioCoordinator')
      if (audio) audio.activate(() => { if (!source.isPlaying) source.play() })
      else source.play()
    }
  }
  return combineInstallations(
    onClick(context, object, activate),
    accessibleControl(context, object, 'button', activate),
  )
}

function resolveObject(component: ObjectComponent, bindings: SceneBindings<THREE.Object3D>): THREE.Object3D {
  const { objectId, objectName } = component.target
  const object = bindings.byId[objectId] ?? (objectName ? bindings.byName[objectName] : undefined)
  if (!object) {
    throw new Error(
      `Blendlink component ${component.id} targets object ID "${objectId}" (${objectName}), ` +
        'but it is not present in this loaded GLB. Re-export the scene after repairing its object identity.',
    )
  }
  return object
}

function resolveFocus(context: ThreeComponentAdapterContext): THREE.Object3D | undefined {
  const values = context.component.values
  const id = string(values.focusTargetId, '') || string(values.focusObjectId, '')
    || string(values.targetObjectId, '') || string(values.targetId, '')
  const name = string(values.focusTargetName, '') || string(values.focusObjectName, '')
    || string(values.targetObjectName, '') || string(values.targetName, '')
  if (!id && !name) return undefined
  const object = (id ? context.bindings.byId[id] : undefined) ?? (name ? context.bindings.byName[name] : undefined)
  if (!object) {
    throw new Error(
      `Blendlink component ${context.component.id} references focus object "${id || name}", but it is not loaded.`,
    )
  }
  return object
}

function requireObjectTarget(context: ThreeComponentAdapterContext): THREE.Object3D {
  if (!context.object) throw new Error(`Blendlink component ${context.component.id} (${context.component.type}) must target an object.`)
  return context.object
}

function requireSceneTarget(context: ThreeComponentAdapterContext): void {
  if (context.object) throw new Error(`Blendlink component ${context.component.id} (${context.component.type}) must target the Scene.`)
}

function requirePostPipeline(context: ThreeComponentAdapterContext): PostPipelineService {
  const service = context.services.postPipeline
  if (!service) {
    throw new Error(
      `Blendlink component ${context.component.id} requires the post-pipeline capability, ` +
        'but the active runtime did not provide it.',
    )
  }
  return service
}

function onClick(
  context: ThreeComponentAdapterContext,
  object: THREE.Object3D,
  callback: () => void,
): ThreeComponentInstallation {
  const interaction = context.services.interaction
  if (interaction) {
    return interaction.addTarget({ id: context.component.id, target: object, activate: callback })
  }
  const canvas = interactiveCanvas(context)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const handler: EventListener = (event): void => {
    if (raycast(canvas, event as PointerEvent, context.camera, raycaster, pointer, context.root, object)) callback()
  }
  canvas.addEventListener('click', handler)
  return { dispose: () => canvas.removeEventListener('click', handler) }
}

function onHover(
  context: ThreeComponentAdapterContext,
  object: THREE.Object3D,
  onChange: (hovering: boolean) => void,
  cleanup: () => void,
): ThreeComponentInstallation {
  const interaction = context.services.interaction
  if (interaction) {
    const registration = interaction.addTarget({
      id: context.component.id,
      target: object,
      hover: onChange,
    })
    return { dispose() { registration.dispose(); cleanup() } }
  }
  const canvas = interactiveCanvas(context)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let previous = false
  const handler: EventListener = (event): void => {
    const next = raycast(canvas, event as PointerEvent, context.camera, raycaster, pointer, context.root, object)
    if (next === previous) return
    previous = next
    onChange(next)
  }
  const leave: EventListener = (): void => { if (previous) { previous = false; onChange(false) } }
  canvas.addEventListener('pointermove', handler)
  canvas.addEventListener('pointerleave', leave)
  return {
    dispose() {
      canvas.removeEventListener('pointermove', handler)
      canvas.removeEventListener('pointerleave', leave)
      cleanup()
    },
  }
}

function accessibleControl(
  context: ThreeComponentAdapterContext,
  object: THREE.Object3D,
  role: 'button' | 'link',
  activate: () => void,
  href?: string,
  linkTarget?: '_self' | '_blank',
): ThreeComponentInstallation {
  const accessibility = context.services.accessibility
  if (!accessibility) return { dispose() {} }
  const authored = string(context.component.values.label, '').trim()
  const definition = componentDefinition(context.component.type)
  const label = authored || `${definition?.label ?? 'Scene action'}: ${object.name || 'unnamed object'}`
  return accessibility.addControl({
    id: context.component.id,
    target: object,
    role,
    label,
    ...(href ? { href } : {}),
    ...(linkTarget ? { linkTarget } : {}),
    activate,
  })
}

function combineInstallations(
  ...installations: ThreeComponentInstallation[]
): ThreeComponentInstallation {
  let disposed = false
  return { dispose() {
    if (disposed) return
    disposed = true
    const errors: unknown[] = []
    for (const installation of installations.slice().reverse()) {
      try { installation.dispose?.() } catch (error) { errors.push(error) }
    }
    if (errors.length > 0) {
      throw new Error(`Could not remove interactive action: ${errors.map(message).join('; ')}`)
    }
  } }
}

interface InteractiveCanvas {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

function interactiveCanvas(context: ThreeComponentAdapterContext): InteractiveCanvas {
  const canvas = context.renderer.domElement as unknown as Partial<InteractiveCanvas>
  if (!canvas.getBoundingClientRect || !canvas.addEventListener || !canvas.removeEventListener) {
    throw new Error(
      `Blendlink component ${context.component.id} (${context.component.type}) needs an interactive renderer canvas. ` +
        'Use this component in a browser WebGLRenderer or provide a custom adapter.',
    )
  }
  return canvas as InteractiveCanvas
}

function raycast(
  canvas: InteractiveCanvas,
  event: PointerEvent,
  camera: THREE.Camera,
  raycaster: THREE.Raycaster,
  pointer: THREE.Vector2,
  root: THREE.Object3D,
  target: THREE.Object3D,
): boolean {
  const rect = canvas.getBoundingClientRect()
  if (!positive(rect.width) || !positive(rect.height)) return false
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const nearest = raycaster.intersectObject(root, true).find((hit) => effectivelyVisible(hit.object))
  return nearest !== undefined && isPartOf(nearest.object, target)
}

function effectivelyVisible(object: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false
  }
  const renderable = object as THREE.Mesh | THREE.Line | THREE.Points
  if ((renderable as THREE.Mesh).isMesh || (renderable as THREE.Line).isLine || (renderable as THREE.Points).isPoints) {
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
    if (materials.length > 0 && materials.every((material) => material.visible === false)) return false
  }
  return true
}

function ensureAudioListener(context: ThreeComponentAdapterContext): THREE.AudioListener {
  const state = implementationHook<AudioListenerState>(context, '__blendlinkAudioListenerState')
  if (!state) throw new Error('Blendlink audio adapter is missing its listener ownership state.')
  if (state.shared) return state.shared.listener

  const stored = state.camera.userData[AUDIO_LISTENER_STATE_KEY]
  let shared = isSharedAudioListener(stored)
    && state.camera.userData[AUDIO_LISTENER_KEY] === stored.listener
    ? stored
    : null
  if (shared === null) {
    const known = state.camera.userData[AUDIO_LISTENER_KEY]
    if (known instanceof THREE.AudioListener) {
      // Respect an explicitly retained listener from an older integration.
      // Blendlink may borrow it, but must not remove or disconnect it.
      shared = { listener: known, owners: 0, blendlinkOwned: false }
    } else {
      const listener = new THREE.AudioListener()
      shared = { listener, owners: 0, blendlinkOwned: true }
      state.pendingOwnedAttachment = true
    }
    if (!state.pendingOwnedAttachment) {
      state.camera.userData[AUDIO_LISTENER_STATE_KEY] = shared
    }
  }
  shared.owners += 1
  state.shared = shared
  state.contextLease ??= state.coordinator.attach(shared.listener.context)
  return shared.listener
}

function activatePreparedAudioListener(state: AudioListenerState, camera: THREE.Camera): void {
  if (!state.pendingOwnedAttachment) return
  const shared = state.shared
  if (shared === null || !shared.blendlinkOwned) {
    throw new Error('Blendlink audio listener activation lost its prepared ownership state.')
  }
  const existing = camera.userData[AUDIO_LISTENER_KEY]
  if (existing instanceof THREE.AudioListener && existing !== shared.listener) {
    throw new Error(
      'Blendlink cannot activate prepared audio because the committed camera gained another AudioListener. ' +
      'Dispose the superseded scene generation before committing this one.',
    )
  }
  state.camera = camera
  camera.add(shared.listener)
  camera.userData[AUDIO_LISTENER_KEY] = shared.listener
  camera.userData[AUDIO_LISTENER_STATE_KEY] = shared
  state.pendingOwnedAttachment = false
}

function isSharedAudioListener(value: unknown): value is SharedAudioListener {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SharedAudioListener>
  return record.listener instanceof THREE.AudioListener
    && typeof record.owners === 'number' && Number.isInteger(record.owners) && record.owners >= 0
    && typeof record.blendlinkOwned === 'boolean'
}

function disconnectAudio(audio: ThreeAudio, parent: THREE.Object3D): unknown[] {
  const errors: unknown[] = []
  if (audio.isPlaying) {
    try { audio.stop() } catch (error) { errors.push(error) }
  }
  // Removing an Object3D does not release its WebAudio graph. Disconnect both
  // Three's source/panner chain and the gain node it connected to the listener.
  try { audio.disconnect() } catch (error) { errors.push(error) }
  try { audio.gain.disconnect() } catch (error) { errors.push(error) }
  try {
    if (audio.parent === parent) parent.remove(audio)
    else audio.removeFromParent()
  } catch (error) { errors.push(error) }
  return errors
}

function releaseAudioListener(state: AudioListenerState): unknown[] {
  const shared = state.shared
  if (shared === null) return []
  state.shared = null
  state.pendingOwnedAttachment = false
  const errors: unknown[] = []
  try { state.contextLease?.dispose() } catch (error) { errors.push(error) }
  state.contextLease = null
  if (shared.owners <= 0) {
    errors.push(new Error('Blendlink audio listener ownership underflowed.'))
    return errors
  }
  shared.owners -= 1
  if (shared.owners > 0) return errors

  if (state.camera.userData[AUDIO_LISTENER_STATE_KEY] === shared) {
    delete state.camera.userData[AUDIO_LISTENER_STATE_KEY]
  }
  if (!shared.blendlinkOwned) return errors
  if (state.camera.userData[AUDIO_LISTENER_KEY] === shared.listener) {
    delete state.camera.userData[AUDIO_LISTENER_KEY]
  }
  try { shared.listener.removeFromParent() } catch (error) { errors.push(error) }
  try { shared.listener.gain.disconnect() } catch (error) { errors.push(error) }
  return errors
}

function inertComponents(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  requestFrame?: () => unknown,
): InstalledThreeComponents {
  let disposed = false
  let committedScene = scene
  let committedCamera = camera
  const audio = createThreeAudioCoordinator()
  const websiteSurfaces = createThreeWebsiteSurfaces({
    ...(requestFrame ? { requestFrame } : {}),
  })
  const active = (): void => { if (disposed) throw new Error('These installed Blendlink components have been disposed.') }
  return {
    count: 0,
    postprocessing: false,
    antialiasingSamples: 0,
    postEdgeAntialiasing: false,
    postEdgeAntialiasingPreset: 'off',
    postprocessingOrder: [],
    requiresContinuousFrames: false,
    accessibleControls: [],
    audio,
    websiteSurfaces,
    activate(nextScene = committedScene, nextCamera = committedCamera) {
      active()
      committedScene = nextScene
      committedCamera = nextCamera
    },
    update() { active() },
    fixedUpdate() { active() },
    resize(width, height) {
      active()
      if (!positive(width) || !positive(height)) throw new Error(`Blendlink component resize needs positive finite width/height; got ${width} x ${height}.`)
    },
    setQuality() { active() },
    render() { active(); renderer.render(committedScene, committedCamera) },
    dispose() {
      if (!disposed) {
        websiteSurfaces.dispose()
        audio.dispose()
      }
      disposed = true
    },
  }
}

function disposeRuntimeAndOwned(
  lifecycle: InstalledRuntimeComponents | null,
  composer: ThreePostPipelineService | null,
  audioListenerState: AudioListenerState,
  audio: ThreeAudioCoordinator,
  interactions: InstalledThreeInteractionServices,
  websiteSurfaces: ThreeWebsiteSurfaces,
): unknown[] {
  const errors: unknown[] = []
  try {
    lifecycle?.dispose()
  } catch (error) {
    if (error instanceof RuntimeComponentDisposalError) errors.push(...error.errors)
    else errors.push(error)
  }
  if (composer) {
    try { composer.dispose() } catch (error) { errors.push(error) }
  }
  errors.push(...releaseAudioListener(audioListenerState))
  try { audio.dispose() } catch (error) { errors.push(error) }
  try { interactions.dispose() } catch (error) { errors.push(error) }
  try { websiteSurfaces.dispose() } catch (error) { errors.push(error) }
  return errors
}

function normalizeThreeInstallation(
  installation: ThreeComponentInstallation,
  committed: () => { scene: THREE.Scene; camera: THREE.Camera },
): RuntimeComponentInstallation {
  return {
    activate: installation.activate
      ? () => {
          const { scene, camera } = committed()
          installation.activate?.(scene, camera)
        }
      : undefined,
    update: installation.update ? (deltaSeconds) => installation.update?.(deltaSeconds) : undefined,
    fixedUpdate: installation.fixedUpdate
      ? (fixedDeltaSeconds) => installation.fixedUpdate?.(fixedDeltaSeconds)
      : undefined,
    resize: installation.resize ? (width, height) => installation.resize?.(width, height) : undefined,
    beforeRender: installation.beforeRender ? () => installation.beforeRender?.() : undefined,
    afterRender: installation.afterRender ? () => installation.afterRender?.() : undefined,
    setQuality: installation.setQuality ? (quality) => installation.setQuality?.(quality) : undefined,
    isActive: installation.isActive ? () => installation.isActive?.() ?? false : undefined,
    dispose: () => installation.dispose?.(),
  }
}

function isPartOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function color(value: unknown): THREE.Color {
  if (Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return new THREE.Color(value[0] as number, value[1] as number, value[2] as number)
  }
  return new THREE.Color(0, 0, 0)
}

function composerSize(renderer: THREE.WebGLRenderer): { width: number; height: number } {
  const width = renderer.domElement.clientWidth
  const height = renderer.domElement.clientHeight
  return { width: positive(width) ? width : 1, height: positive(height) ? height : 1 }
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function string(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function requiredString(value: unknown, label: string): string {
  const result = string(value, '')
  if (!result) throw new Error(`Blendlink component needs a non-empty ${label}.`)
  return result
}

function safeUrl(value: unknown, label: string, allowedSchemes: ReadonlySet<string>): string {
  const result = requiredString(value, label).trim()
  let parsed: URL
  try {
    parsed = new URL(result, 'https://blendlink.invalid/')
  } catch (error) {
    throw new Error(`Blendlink component ${label} is not a valid URL: ${message(error)}`)
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase()
  if (!allowedSchemes.has(scheme)) {
    throw new Error(
      `Blendlink component ${label} uses unsupported ${scheme}: URL. ` +
        `Allowed absolute schemes: ${[...allowedSchemes].join(', ')}; site-relative paths are also supported.`,
    )
  }
  return result
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)) }
function positive(value: number): boolean { return Number.isFinite(value) && value > 0 }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function implementationHook<T>(context: ThreeComponentAdapterContext, key: string): T | undefined {
  return (context as unknown as Record<string, T | undefined>)[key]
}
