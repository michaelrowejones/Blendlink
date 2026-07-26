import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { bindCompiledScene, type CompiledSceneDescriptor, type LoadedSceneLike, type Object3DLike } from './runtime.js'
import {
  createCompiledScenePresentationStore,
  type CompiledSceneLoadState,
  type CompiledSceneRendererPresentationState,
  type CompiledScenePresentationSnapshot,
  type CompiledScenePresentationStore,
} from './scenePresentation.js'

export type {
  CompiledSceneBakedQuality,
  CompiledSceneLoadState,
  CompiledScenePresentationFacts,
  CompiledScenePresentationSnapshot,
  CompiledScenePresentationStore,
  CompiledSceneRendererPresentationState,
} from './scenePresentation.js'

/** The complete lifecycle binding accepted by a generated R3F scene.
 * Functions are stable inside one retry epoch and synchronously revoked when
 * the application calls `retry()`. */
export interface CompiledScenePresentationSceneProps {
  readonly retryKey: number
  readonly onLoadStateChange: (state: CompiledSceneLoadState) => void
  readonly onPresentationStateChange: (
    state: CompiledSceneRendererPresentationState,
  ) => void
}

export interface UseCompiledScenePresentationResult extends CompiledScenePresentationSnapshot {
  /** Key the application-selected retry boundary and/or Blendlink scene with
   * this value. Blendlink does not choose whether the Canvas is remounted. */
  readonly retryKey: number
  /** Spread directly onto a generated R3F scene. */
  readonly sceneProps: Readonly<CompiledScenePresentationSceneProps>
  /** Exact aliases of the callbacks in `sceneProps`, retained for compatible
   * callback composition. */
  readonly onLoadStateChange: CompiledScenePresentationSceneProps['onLoadStateChange']
  readonly onPresentationStateChange:
    CompiledScenePresentationSceneProps['onPresentationStateChange']
  /** Revoke the current callbacks, return to Idle, and advance `retryKey`.
   * This does not infer that a failure is transient or choose fallback UI. */
  readonly retry: () => void
  /** Clear the presentation view only. Use `retry()` to restart an adapter. */
  readonly reset: () => void
}

interface CompiledScenePresentationBinding {
  readonly retryKey: number
  readonly sceneProps: Readonly<CompiledScenePresentationSceneProps>
}

/**
 * Observe one compiled scene without prescribing its loading screen.
 *
 * The application keeps ownership of DOM presentation, Error Boundary, Canvas,
 * analytics, and retry policy. Ready snapshots expose semantic controls,
 * renderer policy, and truthful background baked-quality settlement.
 *
 * One hook/store is intended to observe one scene lifecycle producer.
 */
export function useCompiledScenePresentation(
  providedStore?: CompiledScenePresentationStore,
): UseCompiledScenePresentationResult {
  const ownedStore = useRef<CompiledScenePresentationStore | null>(null)
  const lifecycle = useRef({
    leases: 0,
    generation: 0,
    epoch: 0,
    accepting: true,
  })
  const [retryKey, setRetryKey] = useState(0)
  if (ownedStore.current === null) {
    ownedStore.current = providedStore ?? createCompiledScenePresentationStore()
  } else if (providedStore && ownedStore.current !== providedStore) {
    throw new Error('useCompiledScenePresentation cannot change stores after mounting.')
  }
  const store = ownedStore.current
  useEffect(() => {
    const generation = ++lifecycle.current.generation
    lifecycle.current.leases += 1
    lifecycle.current.accepting = true
    return () => {
      lifecycle.current.leases -= 1
      lifecycle.current.accepting = false
      // React Strict Mode immediately performs setup -> cleanup -> setup in
      // development. Deferring disposal lets the second lease supersede the
      // probe cleanup while a real unmount still releases external listeners.
      queueMicrotask(() => {
        if (lifecycle.current.leases !== 0
            || lifecycle.current.generation !== generation) return
        lifecycle.current.accepting = false
        if (!providedStore) store.dispose()
      })
    }
  }, [providedStore, store])

  const binding = useRef<CompiledScenePresentationBinding | null>(null)
  if (binding.current === null || binding.current.retryKey !== retryKey) {
    const epoch = retryKey
    const sceneProps = Object.freeze<CompiledScenePresentationSceneProps>({
      retryKey: epoch,
      onLoadStateChange: (state) => {
        if (!lifecycle.current.accepting || lifecycle.current.epoch !== epoch) return
        store.onLoadStateChange(state)
      },
      onPresentationStateChange: (state) => {
        if (!lifecycle.current.accepting || lifecycle.current.epoch !== epoch) return
        store.onPresentationStateChange(state)
      },
    })
    binding.current = Object.freeze({ retryKey: epoch, sceneProps })
  }

  const retry = useCallback(() => {
    if (!lifecycle.current.accepting) return
    const nextEpoch = lifecycle.current.epoch + 1
    // This ref is the authority, so callbacks are revoked before React has to
    // commit the new key. Functional state alone cannot provide that guarantee
    // across multiple retries in one batch.
    lifecycle.current.epoch = nextEpoch
    setRetryKey(nextEpoch)
    store.reset()
  }, [store])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const sceneProps = binding.current.sceneProps
  return {
    ...snapshot,
    retryKey,
    sceneProps,
    onLoadStateChange: sceneProps.onLoadStateChange,
    onPresentationStateChange: sceneProps.onPresentationStateChange,
    retry,
    reset: store.reset,
  }
}

/** Adapt drei's useGLTF (or any equivalent hook) without taking an R3F
 * dependency. React remains isolated to this optional package subpath. The
 * resulting hook returns the familiar GLTF plus `blendlink.byId`, `byName`,
 * and a loud `object()` lookup. */
export function createUseBlendlink<TLoaded extends LoadedSceneLike<Object3DLike>>(
  useGLTF: (url: string) => TLoaded,
) {
  return function useBlendlink(descriptor: CompiledSceneDescriptor) {
    const loaded = useGLTF(descriptor.url)
    return Object.assign(loaded, {
      blendlink: bindCompiledScene(loaded.scene, descriptor),
    })
  }
}
