import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import type { CompiledSceneDescriptor } from './runtime.js'
import type { CompiledSceneRendererPresentationState } from './scenePresentation.js'
import type { InstalledThreeWebsiteSurfaces } from './threeWebsiteSurfaces.js'
import {
  startThreeCompiledScenePreparation,
  type CreateThreeBakedScene,
  type InstalledThreeCompiledScene,
  type InstallThreeCompiledSceneOptions,
  type PreparedThreeCompiledScene,
  type ThreeBakedAtlasDeliveryQuality,
  type ThreeCompiledScenePreparationTask,
  type ThreeSceneInstallationProgress,
} from './threeRuntime.js'

interface CanvasInstallSlot {
  mountedOwner: symbol | null
  tail: Promise<void>
}

interface RenderedInstallRequest {
  renderer: object
  world: object
  retryKey: R3FCompiledSceneProps['retryKey']
  bakedAtlasDeliveryQuality: R3FCompiledSceneProps['bakedAtlasDeliveryQuality']
  generation: number
}

const compiledSceneSlots = new WeakMap<object, CanvasInstallSlot>()
// Needle Engine 5.1.7 caps its engine/composer delta at 100 ms. Keep the same
// stability bound at Blendlink's R3F ownership seam without changing the
// application's clock or the exact low-level playback.update(delta) API.
const MAX_RUNTIME_FRAME_DELTA_SECONDS = 0.1

function canvasInstallSlot(world: object): CanvasInstallSlot {
  const known = compiledSceneSlots.get(world)
  if (known) return known
  const created: CanvasInstallSlot = { mountedOwner: null, tail: Promise.resolve() }
  compiledSceneSlots.set(world, created)
  return created
}

type R3FOwnedInstallKey =
  | 'descriptor'
  | 'renderer'
  | 'scene'
  | 'createBakedScene'
  | 'viewport'
  | 'addToScene'
  | 'signal'
  | 'onProgress'
  | 'requestFrame'

/** Stable association between generated scene data and Blendlink's R3F
 * lifecycle adapter. Define it once at module scope; the returned component
 * can then be mounted in any application-owned WebGL Canvas. */
export interface R3FCompiledSceneDefinition extends Omit<
  InstallThreeCompiledSceneOptions,
  R3FOwnedInstallKey
> {
  descriptor: CompiledSceneDescriptor
  createBakedScene?: CreateThreeBakedScene
  /** React DevTools label. Defaults to BlendlinkScene. */
  displayName?: string
}

export interface R3FCompiledSceneProps {
  /** Optional application-owned behavior that must not observe a partially
   * installed scene. Children mount only after the scene reaches ready. */
  children?: ReactNode
  /** Advanced borrowed handle called after the GLB, baked default state,
   * authored presentation, and portable components are installed. The
   * component retains lifecycle/disposal ownership; callers must not dispose
   * this handle while mounted. Prefer ready children plus `useScene()` for the
   * ownership-safe application interface. */
  onReady?(scene: InstalledThreeCompiledScene): void
  /** Facts for application-owned loading/error presentation. Item counts are
   * not byte percentages and may grow as dependencies are discovered. */
  onLoadStateChange?(state: R3FCompiledSceneLoadState): void
  /** Renderer-facing presentation facts kept separate from transport/install
   * progress: bootstrap readiness, atomic full-quality promotion, and the
   * first completed R3F frame. */
  onPresentationStateChange?(state: R3FCompiledScenePresentationState): void
  /** Changing this value starts a fresh attempt. Reset the application's Error
   * Boundary in the same interaction when retrying a render-thrown failure. */
  retryKey?: string | number
  /** Override this Canvas host's baked atlas tier without redefining the
   * generated scene component. Omitted keeps the definition/default policy. */
  bakedAtlasDeliveryQuality?: ThreeBakedAtlasDeliveryQuality
}

export type R3FCompiledSceneNodes<
  TDescriptor extends CompiledSceneDescriptor,
> = Readonly<{
  [TKey in keyof TDescriptor['nodes']]: THREE.Object3D
}>

type AuthoredWebsiteSurfaceName<TDescriptor extends CompiledSceneDescriptor> =
  Extract<
    NonNullable<TDescriptor['components']>[number],
    { readonly type: 'blendlink.website-surface' }
  > extends infer TComponent
    ? TComponent extends { readonly values: { readonly name: infer TName extends string } }
      ? TName
      : never
    : never

export type R3FWebsiteSurfaceName<TDescriptor extends CompiledSceneDescriptor> =
  [AuthoredWebsiteSurfaceName<TDescriptor>] extends [never]
    ? string
    : AuthoredWebsiteSurfaceName<TDescriptor>

/** Ready-only application view of a compiled scene. Resource ownership and
 * disposal stay inside Blendlink; custom behavior receives only stable nodes
 * and the scene operations intended for application integration. */
export interface R3FCompiledSceneHandle<
  TDescriptor extends CompiledSceneDescriptor = CompiledSceneDescriptor,
> {
  readonly root: THREE.Object3D
  readonly camera: THREE.Camera
  readonly nodes: R3FCompiledSceneNodes<TDescriptor>
  readonly requiresContinuousFrames: boolean
  /** Bounded application transport for ordinary clips or the authored NLA
   * sequence. Blender retains timing/loop ownership; Blendlink retains mixer
   * and disposal ownership. */
  readonly animation: InstalledThreeCompiledScene['animation']
  /** Read-only evidence for optional authored shadowless Rect Area lights.
   * Blendlink retains LTC, synchronization, and disposal ownership. */
  readonly rectAreaLights: InstalledThreeCompiledScene['rectAreaLights']
  /** True when authored portable effects make Blendlink the Canvas render
   * owner. Application composers must refuse or deliberately coordinate. */
  readonly hasPostprocessing: boolean
  /** App-owned DOM links/buttons may bind these semantic scene actions. */
  readonly accessibleControls: InstalledThreeCompiledScene['components']['accessibleControls']
  /** App-owned enable-sound UI may observe and resume the scene's Web Audio
   * context without learning Three listener/source ownership. */
  readonly audio: InstalledThreeCompiledScene['components']['audio']
  /** Bind application-owned canvas pixels to a named Blender-authored Website
   * Surface without traversing nodes or mutating Three materials directly. */
  readonly websiteSurfaces: InstalledThreeWebsiteSurfaces<R3FWebsiteSurfaceName<TDescriptor>>
  /** Explicit application camera policy seam. Resize preserves authored
   * composition; callers may deliberately request a scene/target fit. */
  fitCamera(
    viewport: { width: number; height: number },
    scope?: 'scene' | 'target',
  ): ReturnType<NonNullable<InstalledThreeCompiledScene['cameraController']>['fit']> | null
  resetCamera(): boolean
  setState(name: string): Promise<boolean>
  setLightGroup(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): boolean
  setLightGroupAsync(
    name: string,
    options?: { strength?: number; color?: THREE.ColorRepresentation },
  ): Promise<boolean>
  /** Register application cleanup that must run before Blendlink disposes its
   * generated materials and scene resources. The returned function unregisters
   * it; cleanup functions must be idempotent. */
  addCleanup(cleanup: () => void): () => void
}

export type R3FCompiledSceneComponent<
  TDescriptor extends CompiledSceneDescriptor = CompiledSceneDescriptor,
> = ComponentType<R3FCompiledSceneProps> & {
  /** Read the installed scene from an application-owned child. Throws when
   * used outside this exact generated scene module or before readiness. */
  useScene(): R3FCompiledSceneHandle<TDescriptor>
}

export type R3FCompiledSceneLoadState =
  | (ThreeSceneInstallationProgress & { attempt: number })
  | { phase: 'ready'; attempt: number; scene: InstalledThreeCompiledScene }
  | { phase: 'failed'; attempt: number; error: Error; recoverable: boolean }

export type R3FCompiledScenePresentationState = CompiledSceneRendererPresentationState

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

interface RendererLossSubscription {
  /** Only classic WebGLRenderer offers a synchronous probe; the WebGPU
   * family reports an already-lost device through the hook shortly after
   * subscription instead. */
  alreadyLost: boolean
  unsubscribe(): void
}

/** Both WebGPURenderer backends — native (GPUDevice.lost) and the WebGL2
 * fallback (webglcontextlost) — route loss into the renderer's single public
 * onDeviceLost hook, so the WebGPU family chains that callback. Classic
 * WebGLRenderer keeps the DOM event plus its synchronous probe. */
function subscribeRendererLoss(
  renderer: THREE.WebGLRenderer,
  onLost: () => void,
): RendererLossSubscription {
  const identity = renderer as THREE.WebGLRenderer & {
    isWebGPURenderer?: boolean
    onDeviceLost?: (info: unknown) => void
  }
  if (identity.isWebGPURenderer) {
    const previous = identity.onDeviceLost
    const chained = (info: unknown) => {
      previous?.call(renderer, info)
      onLost()
    }
    identity.onDeviceLost = chained
    return {
      alreadyLost: false,
      unsubscribe() {
        // Restore only while the slot is still ours; an application that
        // replaced the hook after mount owns it now.
        if (identity.onDeviceLost === chained) identity.onDeviceLost = previous
      },
    }
  }
  renderer.domElement.addEventListener('webglcontextlost', onLost)
  return {
    alreadyLost: renderer.getContext().isContextLost(),
    unsubscribe() {
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
    },
  }
}

/**
 * Create the complete React Three Fiber adapter for one compiled scene.
 *
 * The host owns Canvas, routing, fallbacks, and when this component is loaded.
 * Blendlink owns loader setup, late-load disposal, resize, camera handoff,
 * updates, conditional post-processing render ownership, errors, and cleanup.
 */
export function createR3FCompiledScene<
  const TDescriptor extends CompiledSceneDescriptor,
>(
  definition: R3FCompiledSceneDefinition & { descriptor: TDescriptor },
): R3FCompiledSceneComponent<TDescriptor> {
  const {
    descriptor,
    createBakedScene,
    displayName = 'BlendlinkScene',
    ...installOptions
  } = definition
  const ReadySceneContext = createContext<R3FCompiledSceneHandle<TDescriptor> | null>(null)

  const applicationHandle = (
    value: InstalledThreeCompiledScene,
    cleanups: { active: boolean; values: Set<() => void> },
  ): R3FCompiledSceneHandle<TDescriptor> => ({
    root: value.root,
    camera: value.camera,
    nodes: value.bindings.byName as R3FCompiledSceneNodes<TDescriptor>,
    get requiresContinuousFrames() { return value.requiresContinuousFrames },
    get animation() { return value.animation },
    get rectAreaLights() { return value.rectAreaLights },
    get hasPostprocessing() { return value.components.postprocessing },
    get accessibleControls() { return value.components.accessibleControls },
    get audio() { return value.components.audio },
    get websiteSurfaces() {
      return value.websiteSurfaces as InstalledThreeWebsiteSurfaces<
        R3FWebsiteSurfaceName<TDescriptor>
      >
    },
    fitCamera(viewport, scope) { return value.cameraController?.fit(viewport, scope) ?? null },
    resetCamera() {
      if (!value.cameraController) return false
      value.cameraController.reset()
      return true
    },
    setState(name) { return value.setStateAsync(name) },
    setLightGroup(name, options) { return value.setLightGroup(name, options) },
    setLightGroupAsync(name, options) { return value.setLightGroupAsync(name, options) },
    addCleanup(cleanup) {
      if (!cleanups.active) {
        cleanup()
        return () => {}
      }
      cleanups.values.add(cleanup)
      return () => { cleanups.values.delete(cleanup) }
    },
  })

  function R3FCompiledScene({
    children,
    onReady,
    onLoadStateChange,
    onPresentationStateChange,
    retryKey,
    bakedAtlasDeliveryQuality,
  }: R3FCompiledSceneProps = {}) {
    const renderer = useThree((state) => state.gl)
    const world = useThree((state) => state.scene)
    const size = useThree((state) => state.size)
    const set = useThree((state) => state.set)
    const get = useThree((state) => state.get)
    const frameloop = useThree((state) => state.frameloop)
    const invalidate = useThree((state) => state.invalidate)
    const renderedRequestRef = useRef<RenderedInstallRequest | null>(null)
    const renderedRequest = renderedRequestRef.current
    if (!renderedRequest
      || renderedRequest.renderer !== renderer
      || renderedRequest.world !== world
      || !Object.is(renderedRequest.retryKey, retryKey)
      || !Object.is(
        renderedRequest.bakedAtlasDeliveryQuality,
        bakedAtlasDeliveryQuality,
      )) {
      renderedRequestRef.current = {
        renderer,
        world,
        retryKey,
        bakedAtlasDeliveryQuality,
        generation: (renderedRequest?.generation ?? 0) + 1,
      }
    }
    const requestGeneration = renderedRequestRef.current!.generation
    const installed = useRef<InstalledThreeCompiledScene | null>(null)
    // R3F's demand-mode delta spans the time since its previous rendered
    // frame. That includes an arbitrarily long idle/loading interval. Track
    // whether Blendlink itself was continuously updating on the preceding
    // frame so the first wake frame establishes a fresh animation origin
    // instead of consuming dormant wall time.
    const continuouslyUpdating = useRef(false)
    const onReadyRef = useRef(onReady)
    const onLoadStateChangeRef = useRef(onLoadStateChange)
    const onPresentationStateChangeRef = useRef(onPresentationStateChange)
    const attemptRef = useRef(0)
    const presentationRef = useRef<{
      attempt: number
      quality: R3FCompiledScenePresentationState['quality']
      presented: boolean
      scheduled: boolean
      cancelled: boolean
      publish(): void
    } | null>(null)
    const [error, setError] = useState<unknown>(null)
    const [ownsRendering, setOwnsRendering] = useState(false)
    const [readyScene, setReadyScene] = useState<R3FCompiledSceneHandle<TDescriptor> | null>(null)
    const [readyGeneration, setReadyGeneration] = useState<number | null>(null)
    const pendingCommitRef = useRef<{
      attempt: number
      requestGeneration: number
      prepared: PreparedThreeCompiledScene
      applicationCleanups: { active: boolean; values: Set<() => void> }
      commit(): void
      fail(reason: unknown): void
      dispose(): void
    } | null>(null)
    const [preparedAttempt, setPreparedAttempt] = useState<number | null>(null)
    const blocksPresentation = readyGeneration !== requestGeneration

    useEffect(() => {
      onReadyRef.current = onReady
      onLoadStateChangeRef.current = onLoadStateChange
      onPresentationStateChangeRef.current = onPresentationStateChange
    }, [onLoadStateChange, onPresentationStateChange, onReady])

    useEffect(() => {
      let cancelled = false
      let task: ThreeCompiledScenePreparationTask | null = null
      const owner = Symbol(displayName)
      const slot = canvasInstallSlot(world)
      const applicationCleanups = { active: true, values: new Set<() => void>() }
      const attempt = ++attemptRef.current
      const presentation = {
        attempt,
        quality: 'loading' as R3FCompiledScenePresentationState['quality'],
        presented: false,
        scheduled: false,
        cancelled: false,
        publish() {
          const state: R3FCompiledScenePresentationState = {
            attempt: this.attempt,
            quality: this.quality,
            presented: this.presented,
          }
          try { onPresentationStateChangeRef.current?.(state) } catch (observerError) {
            console.error('Blendlink onPresentationStateChange callback failed:', observerError)
          }
        },
      }
      presentationRef.current = presentation
      presentation.publish()
      const failPresentation = (failure: Error): void => {
        if (presentation.cancelled || presentationRef.current !== presentation) return
        presentation.quality = 'failed'
        const state: R3FCompiledScenePresentationState = {
          attempt,
          quality: 'failed',
          presented: presentation.presented,
          error: failure,
        }
        try { onPresentationStateChangeRef.current?.(state) } catch (observerError) {
          console.error('Blendlink onPresentationStateChange callback failed:', observerError)
        }
      }
      const publishState = (state: R3FCompiledSceneLoadState): void => {
        // LoadingManager may deliver itemEnd/onProgress after aborting its
        // fetch. Once a replacement attempt exists, those facts belong only
        // to the abandoned generation and must not regress application UI.
        if (cancelled || attemptRef.current !== attempt) return
        try { onLoadStateChangeRef.current?.(state) } catch (observerError) {
          console.error('Blendlink onLoadStateChange callback failed:', observerError)
        }
      }
      const failAttempt = (reason: unknown): void => {
        if (cancelled) return
        const nextError = asError(reason)
        // Preparation can fail for deterministic authoring/schema/CSP/
        // capability reasons as well as transient network conditions. Until
        // those causes carry structured retry semantics, blanket
        // "recoverable" would tell an application to repeat known-bad work.
        publishState({ phase: 'failed', attempt, error: nextError, recoverable: false })
        failPresentation(nextError)
        setError(nextError)
      }
      if (slot.mountedOwner) {
        const ownershipError = new Error(
          'Only one Blendlink compiled scene may be mounted in an R3F Canvas at a time. ' +
            'Unmount the active scene before mounting another so camera, environment, and ' +
            'post-processing ownership stay deterministic.',
        )
        publishState({
          phase: 'failed', attempt, error: ownershipError, recoverable: false,
        })
        failPresentation(ownershipError)
        setError(ownershipError)
        return
      }
      slot.mountedOwner = owner
      setError(null)
      setReadyScene(null)
      setReadyGeneration(null)
      const contextLost = () => {
        if (cancelled) return
        const contextError = new Error(
          'The Blendlink rendering device was lost (WebGL context or WebGPU device). ' +
            'Remount the application-owned Canvas, then retry the scene.',
        )
        task?.cancel()
        publishState({ phase: 'failed', attempt, error: contextError, recoverable: true })
        failPresentation(contextError)
        setError(contextError)
      }
      const lossSubscription = subscribeRendererLoss(renderer, contextLost)
      if (lossSubscription.alreadyLost) {
        contextLost()
        lossSubscription.unsubscribe()
        if (slot.mountedOwner === owner) slot.mountedOwner = null
        presentation.cancelled = true
        if (presentationRef.current === presentation) presentationRef.current = null
        return
      }
      publishState({ phase: 'loading', attempt, itemsLoaded: 0, itemsTotal: 0 })
      const run = slot.tail.catch(() => {}).then(async () => {
        if (cancelled) return
        task = startThreeCompiledScenePreparation({
          ...installOptions,
          descriptor,
          renderer,
          scene: world,
          resizeRenderer: false,
          ...(createBakedScene ? { createBakedScene } : {}),
          ...(bakedAtlasDeliveryQuality === undefined
            ? {}
            : { bakedAtlasDeliveryQuality }),
          onProgress(progress) { publishState({ ...progress, attempt }) },
          requestFrame: invalidate,
        })
        try {
          const prepared = await task.promise
          if (cancelled) {
            prepared.dispose()
            return
          }
          const pending = {
            attempt,
            requestGeneration,
            prepared,
            applicationCleanups,
            commit() {
              if (cancelled || attemptRef.current !== attempt) {
                prepared.dispose()
                return
              }
              const value = prepared.commit({
                activate(scene) {
                  const currentSize = get().size
                  if (currentSize.width > 0 && currentSize.height > 0) {
                    scene.resize(currentSize.width, currentSize.height)
                  }
                  const previousCamera = get().camera
                  set({ camera: scene.camera })
                  return {
                    dispose() {
                      if (get().camera === scene.camera) set({ camera: previousCamera })
                    },
                  }
                },
                requestFrame: invalidate,
              })
              if (cancelled || attemptRef.current !== attempt) {
                value.dispose()
                return
              }
              installed.current = value
              continuouslyUpdating.current = false
              setOwnsRendering(value.components.postprocessing)
              setReadyScene(applicationHandle(value, applicationCleanups))
              setReadyGeneration(requestGeneration)
              presentation.quality = 'bootstrap'
              presentation.publish()
              const qualityReady = value.baked?.qualityReady ?? Promise.resolve()
              void qualityReady.then(() => {
                if (cancelled || presentation.cancelled ||
                    presentationRef.current !== presentation) return
                presentation.quality = 'full'
                presentation.publish()
                invalidate()
              }, (reason) => {
                if (cancelled || presentation.cancelled ||
                    presentationRef.current !== presentation) return
                failPresentation(asError(reason))
              })
              publishState({ phase: 'ready', attempt, scene: value })
              try { onReadyRef.current?.(value) } catch (observerError) {
                console.error('Blendlink onReady callback failed:', observerError)
              }
              if (pendingCommitRef.current === pending) pendingCommitRef.current = null
              setPreparedAttempt(null)
            },
            fail(reason: unknown) {
              try { prepared.dispose() } catch (cleanupError) {
                console.error('Blendlink prepared scene cleanup failed:', cleanupError)
              }
              if (pendingCommitRef.current === pending) pendingCommitRef.current = null
              setPreparedAttempt(null)
              failAttempt(reason)
            },
            dispose() {
              prepared.dispose()
            },
          }
          pendingCommitRef.current = pending
          setPreparedAttempt(attempt)
        } catch (reason: unknown) {
          failAttempt(reason)
        }
      })
      slot.tail = run.then(() => {}, () => {})

      return () => {
        cancelled = true
        lossSubscription.unsubscribe()
        presentation.cancelled = true
        if (presentationRef.current === presentation) presentationRef.current = null
        task?.cancel()
        const pending = pendingCommitRef.current
        if (pending?.attempt === attempt) {
          pendingCommitRef.current = null
          try { pending.dispose() } catch (cleanupError) {
            console.error('Blendlink prepared scene cleanup failed:', cleanupError)
          }
          setPreparedAttempt(null)
        }
        if (slot.mountedOwner === owner) slot.mountedOwner = null
        const value = installed.current
        installed.current = null
        continuouslyUpdating.current = false
        setReadyScene(null)
        setReadyGeneration(null)
        applicationCleanups.active = false
        const cleanupErrors: unknown[] = []
        for (const cleanup of [...applicationCleanups.values].reverse()) {
          try { cleanup() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
        }
        applicationCleanups.values.clear()
        for (const cleanupError of cleanupErrors) {
          console.error('Blendlink application scene cleanup failed:', cleanupError)
        }
        value?.dispose()
      }
    }, [
      bakedAtlasDeliveryQuality,
      get,
      invalidate,
      renderer,
      requestGeneration,
      retryKey,
      set,
      world,
    ])

    useLayoutEffect(() => {
      const pending = pendingCommitRef.current
      if (!pending || pending.attempt !== preparedAttempt ||
          pending.requestGeneration !== requestGeneration) return
      try {
        pending.commit()
      } catch (reason) {
        pending.fail(reason)
      }
    }, [preparedAttempt, requestGeneration])

    useEffect(() => {
      if (size.width > 0 && size.height > 0) {
        installed.current?.resize(size.width, size.height)
      }
    }, [size.height, size.width])

    useEffect(() => {
      // The installation Promise resolves while the priority-1 presentation
      // gate is still committed. An invalidate issued in that async callback
      // can be consumed by the gated frame before React commits
      // readyGeneration and lowers the subscriber priority. Schedule once
      // more from the committed ready generation so a static demand-mode
      // scene receives its first visible frame without waiting for input.
      if (!blocksPresentation && installed.current) invalidate()
    }, [blocksPresentation, invalidate])

    useFrame((_, delta) => {
      // A positive subscriber priority disables Fiber's automatic renderer.
      // Loading/preparation is detached; a layout-phase transaction commits
      // the complete root and renderer policy together. Keep the gate until
      // React has also published ready children. This is not a GPU fence or a
      // claim that compileAsync made the first frame nonblocking.
      if (blocksPresentation) return
      const value = installed.current
      if (!value) {
        continuouslyUpdating.current = false
        return
      }
      const wakingRuntime = value.requiresContinuousFrames
        && !continuouslyUpdating.current
      // The Canvas delta begins at the previous frame, which can predate an
      // interaction that made this runtime active. Starting that runtime at
      // zero prevents it from consuming time it did not own. Later long frames
      // use Needle's 100 ms ceiling so one-shot actions and component easing
      // cannot disappear completely between two rendered frames.
      const runtimeDelta = wakingRuntime
        ? 0
        : Math.min(delta, MAX_RUNTIME_FRAME_DELTA_SECONDS)
      value.update(runtimeDelta)
      continuouslyUpdating.current = value.requiresContinuousFrames
      // Positive priority disables Fiber's automatic renderer. Blendlink
      // takes ownership only when the authored component stack has a composer.
      if (ownsRendering) value.render(runtimeDelta)
      // Blendlink animation, camera controls, LODs, and portable components
      // mutate Three imperatively. Requeue only while the installed runtime can
      // prove one of those systems still needs continuous frames; unknown
      // custom work remains conservative.
      if (frameloop === 'demand' && value.requiresContinuousFrames) invalidate()
      const presentation = presentationRef.current
      if (presentation && !presentation.cancelled && !presentation.presented && !presentation.scheduled) {
        presentation.scheduled = true
        const afterFrame = () => {
          if (presentation.cancelled || presentationRef.current !== presentation) return
          presentation.presented = true
          presentation.publish()
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(afterFrame)
        else queueMicrotask(afterFrame)
      }
    }, blocksPresentation || ownsRendering ? 1 : 0)

    if (error) throw error
    if (!readyScene) return null
    return createElement(ReadySceneContext.Provider, { value: readyScene }, children)
  }

  R3FCompiledScene.displayName = displayName
  const component = R3FCompiledScene as R3FCompiledSceneComponent<TDescriptor>
  component.useScene = () => {
    const value = useContext(ReadySceneContext)
    if (!value) {
      throw new Error(
        `${displayName}.useScene() must be called by a child of ${displayName} after the compiled scene is ready.`,
      )
    }
    return value
  }
  return component
}
