import type {
  InstalledThreeCompiledScene,
  ThreeSceneInstallationProgress,
} from './threeRuntime.js'
import type { ThreeAudioReadiness } from './threeAudio.js'

const NO_CONTROLS: InstalledThreeCompiledScene['components']['accessibleControls'] = Object.freeze([])

/** Structurally compatible with the state reported by Blendlink's R3F
 * adapter, without making this application model depend on React or R3F. */
export type CompiledSceneLoadState =
  | (ThreeSceneInstallationProgress & { attempt: number })
  | { phase: 'ready'; attempt: number; scene: InstalledThreeCompiledScene }
  | { phase: 'failed'; attempt: number; error: Error; recoverable: boolean }

export type CompiledSceneBakedQuality =
  | 'not-applicable'
  | 'promoting'
  | 'ready'
  | 'failed'

/** Renderer adapter evidence. `presented` means the adapter completed and
 * observed a browser frame after installation; it is not a pixel-fidelity
 * oracle or a guarantee that the display compositor showed every GPU result. */
export type CompiledSceneRendererPresentationState = Readonly<{
  attempt: number
  quality: 'loading' | 'bootstrap' | 'full' | 'failed'
  presented: boolean
  error?: Error
}>

/** Ready-only renderer facts. `bakedQuality: 'ready'` means that no tracked
 * promotion remains; it deliberately does not claim that a browser frame has
 * been presented to the screen. */
export interface CompiledScenePresentationFacts {
  readonly baked: boolean
  readonly bakedQuality: CompiledSceneBakedQuality
  readonly qualityError: Error | null
  readonly presented: boolean
  readonly audio: ThreeAudioReadiness
  readonly postprocessing: boolean
  readonly requiresContinuousFrames: boolean
}

/** Application-facing facts for loading UI and semantic DOM controls. */
export interface CompiledScenePresentationSnapshot {
  readonly phase: 'idle' | CompiledSceneLoadState['phase']
  readonly attempt: number
  readonly item?: string
  readonly itemsLoaded: number
  readonly itemsTotal: number
  readonly error: Error | null
  readonly recoverable: boolean
  readonly scene: InstalledThreeCompiledScene | null
  readonly accessibleControls: InstalledThreeCompiledScene['components']['accessibleControls']
  readonly presentation: CompiledScenePresentationFacts | null
}

export interface CompiledScenePresentationStore {
  /** Pass directly to an adapter's `onLoadStateChange` prop. */
  readonly onLoadStateChange: (state: CompiledSceneLoadState) => void
  /** Pass to an adapter's renderer-presentation callback when supported. */
  readonly onPresentationStateChange: (state: CompiledSceneRendererPresentationState) => void
  readonly getSnapshot: () => CompiledScenePresentationSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Return to idle and ignore any late quality-promotion settlement. */
  readonly reset: () => void
  readonly dispose: () => void
}

const IDLE_SNAPSHOT: CompiledScenePresentationSnapshot = Object.freeze({
  phase: 'idle',
  attempt: 0,
  itemsLoaded: 0,
  itemsTotal: 0,
  error: null,
  recoverable: false,
  scene: null,
  accessibleControls: NO_CONTROLS,
  presentation: null,
})

/**
 * Create the framework-neutral application model behind the React helper.
 * It converts attempt-scoped installer events and a background baked-quality
 * promise into one stable, subscribable snapshot while ignoring late work.
 */
export function createCompiledScenePresentationStore(): CompiledScenePresentationStore {
  let snapshot = IDLE_SNAPSHOT
  let qualityGeneration = 0
  let audioSubscription: (() => void) | null = null
  let disposed = false
  const listeners = new Set<() => void>()

  const clearAudioSubscription = (): void => {
    audioSubscription?.()
    audioSubscription = null
  }

  const publish = (next: CompiledScenePresentationSnapshot): void => {
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener()
  }

  const onLoadStateChange = (state: CompiledSceneLoadState): void => {
    if (disposed) throw new Error('This compiled-scene presentation store has been disposed.')
    if (state.attempt < snapshot.attempt) return
    const generation = ++qualityGeneration
    clearAudioSubscription()

    if ('itemsLoaded' in state) {
      publish({
        phase: state.phase,
        attempt: state.attempt,
        ...(state.item === undefined ? {} : { item: state.item }),
        itemsLoaded: state.itemsLoaded,
        itemsTotal: state.itemsTotal,
        error: null,
        recoverable: false,
        scene: null,
        accessibleControls: NO_CONTROLS,
        presentation: null,
      })
      return
    }

    if ('error' in state) {
      publish({
        phase: 'failed',
        attempt: state.attempt,
        itemsLoaded: snapshot.attempt === state.attempt ? snapshot.itemsLoaded : 0,
        itemsTotal: snapshot.attempt === state.attempt ? snapshot.itemsTotal : 0,
        error: state.error,
        recoverable: state.recoverable,
        scene: null,
        accessibleControls: NO_CONTROLS,
        presentation: null,
      })
      return
    }

    const baked = state.scene.baked
    const qualityReady = baked?.qualityReady
    const presentation: CompiledScenePresentationFacts = Object.freeze({
      baked: baked !== null,
      bakedQuality: baked === null
        ? 'not-applicable'
        : qualityReady
          ? 'promoting'
          : 'ready',
      qualityError: null,
      presented: false,
      audio: state.scene.components.audio.readiness,
      postprocessing: state.scene.components.postprocessing,
      requiresContinuousFrames: state.scene.requiresContinuousFrames,
    })
    publish({
      phase: 'ready',
      attempt: state.attempt,
      itemsLoaded: snapshot.attempt === state.attempt ? snapshot.itemsLoaded : 0,
      itemsTotal: snapshot.attempt === state.attempt ? snapshot.itemsTotal : 0,
      error: null,
      recoverable: false,
      scene: state.scene,
      accessibleControls: state.scene.components.accessibleControls,
      presentation,
    })

    const audioDisposable = state.scene.components.audio.subscribe(() => {
      if (generation !== qualityGeneration || snapshot.scene !== state.scene || !snapshot.presentation) return
      publish({
        ...snapshot,
        presentation: Object.freeze({
          ...snapshot.presentation,
          audio: state.scene.components.audio.readiness,
        }),
      })
    })
    audioSubscription = () => audioDisposable.dispose()

    if (!qualityReady) return
    void qualityReady.then(
      () => {
        if (generation !== qualityGeneration || snapshot.scene !== state.scene || !snapshot.presentation) return
        publish({
          ...snapshot,
          presentation: Object.freeze({ ...snapshot.presentation, bakedQuality: 'ready' }),
        })
      },
      (reason: unknown) => {
        if (generation !== qualityGeneration || snapshot.scene !== state.scene || !snapshot.presentation) return
        const qualityError = reason instanceof Error ? reason : new Error(String(reason))
        publish({
          ...snapshot,
          presentation: Object.freeze({
            ...snapshot.presentation,
            bakedQuality: 'failed',
            qualityError,
          }),
        })
      },
    )
  }

  const onPresentationStateChange = (
    state: CompiledSceneRendererPresentationState,
  ): void => {
    if (disposed) throw new Error('This compiled-scene presentation store has been disposed.')
    if (state.attempt < snapshot.attempt) return
    if (!snapshot.presentation || state.attempt !== snapshot.attempt) return
    const bakedQuality: CompiledSceneBakedQuality = state.quality === 'full'
      ? 'ready'
      : state.quality === 'failed'
        ? 'failed'
        : snapshot.presentation.bakedQuality
    publish({
      ...snapshot,
      presentation: Object.freeze({
        ...snapshot.presentation,
        bakedQuality,
        qualityError: state.quality === 'failed'
          ? state.error ?? new Error('Full-quality promotion failed.')
          : snapshot.presentation.qualityError,
        presented: state.presented,
      }),
    })
  }

  return {
    onLoadStateChange,
    onPresentationStateChange,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) throw new Error('This compiled-scene presentation store has been disposed.')
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset() {
      if (disposed) throw new Error('This compiled-scene presentation store has been disposed.')
      ++qualityGeneration
      clearAudioSubscription()
      publish(IDLE_SNAPSHOT)
    },
    dispose() {
      if (disposed) return
      disposed = true
      ++qualityGeneration
      clearAudioSubscription()
      listeners.clear()
    },
  }
}
