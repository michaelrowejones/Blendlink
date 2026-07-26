import { describe, expect, it, vi } from 'vitest'
import type { InstalledThreeCompiledScene } from './threeRuntime.js'
import { createCompiledScenePresentationStore } from './scenePresentation.js'

function deferred(): {
  promise: Promise<void>
  resolve(): void
  reject(reason: unknown): void
} {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function installedScene(options: {
  qualityReady?: Promise<void>
  baked?: boolean
} = {}): InstalledThreeCompiledScene {
  const control = Object.freeze({ id: 'cta' }) as unknown as
    InstalledThreeCompiledScene['components']['accessibleControls'][number]
  return {
    baked: options.baked === false
      ? null
      : { qualityReady: options.qualityReady } as InstalledThreeCompiledScene['baked'],
    components: {
      accessibleControls: Object.freeze([control]),
      postprocessing: true,
      audio: {
        readiness: { state: 'unavailable' },
        subscribe: () => ({ dispose() {} }),
        resume: async () => false,
      },
    },
    requiresContinuousFrames: false,
  } as InstalledThreeCompiledScene
}

describe('createCompiledScenePresentationStore', () => {
  it('maps progress and ready scene facts without inventing a percentage', () => {
    const store = createCompiledScenePresentationStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.onLoadStateChange({
      phase: 'loading', attempt: 1, item: '/scene.glb', itemsLoaded: 1, itemsTotal: 3,
    })
    expect(store.getSnapshot()).toMatchObject({
      phase: 'loading', attempt: 1, item: '/scene.glb', itemsLoaded: 1, itemsTotal: 3,
      scene: null, presentation: null, accessibleControls: [],
    })

    const scene = installedScene()
    store.onLoadStateChange({ phase: 'ready', attempt: 1, scene })
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready', attempt: 1, scene,
      accessibleControls: scene.components.accessibleControls,
      presentation: {
        baked: true,
        bakedQuality: 'ready',
        qualityError: null,
        presented: false,
        audio: { state: 'unavailable' },
        postprocessing: true,
        requiresContinuousFrames: false,
      },
    })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('reports background quality promotion without demoting the installed scene', async () => {
    const quality = deferred()
    const store = createCompiledScenePresentationStore()
    const scene = installedScene({ qualityReady: quality.promise })

    store.onLoadStateChange({ phase: 'ready', attempt: 1, scene })
    expect(store.getSnapshot().presentation?.bakedQuality).toBe('promoting')

    quality.reject('tier unavailable')
    await quality.promise.catch(() => {})
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      scene,
      presentation: {
        bakedQuality: 'failed',
        qualityError: new Error('tier unavailable'),
      },
    })
  })

  it('ignores late quality settlement after reset or a newer attempt', async () => {
    const firstQuality = deferred()
    const store = createCompiledScenePresentationStore()
    store.onLoadStateChange({
      phase: 'ready', attempt: 1, scene: installedScene({ qualityReady: firstQuality.promise }),
    })
    store.onLoadStateChange({
      phase: 'loading', attempt: 2, itemsLoaded: 0, itemsTotal: 0,
    })
    firstQuality.resolve()
    await firstQuality.promise
    expect(store.getSnapshot()).toMatchObject({ phase: 'loading', attempt: 2 })

    store.reset()
    expect(store.getSnapshot()).toMatchObject({ phase: 'idle', attempt: 0 })
  })

  it('keeps realtime scenes distinct from baked quality readiness', () => {
    const store = createCompiledScenePresentationStore()
    store.onLoadStateChange({
      phase: 'ready', attempt: 1, scene: installedScene({ baked: false }),
    })
    expect(store.getSnapshot().presentation).toMatchObject({
      baked: false,
      bakedQuality: 'not-applicable',
    })
  })

  it('merges renderer frame evidence without conflating it with pixel fidelity', () => {
    const store = createCompiledScenePresentationStore()
    store.onLoadStateChange({ phase: 'ready', attempt: 2, scene: installedScene() })
    store.onPresentationStateChange({ attempt: 2, quality: 'full', presented: true })
    expect(store.getSnapshot().presentation).toMatchObject({
      bakedQuality: 'ready',
      presented: true,
    })
    store.onPresentationStateChange({ attempt: 1, quality: 'failed', presented: false })
    expect(store.getSnapshot().presentation?.presented).toBe(true)
  })

  it('does not erase newer renderer evidence when quality promotion settles', async () => {
    const quality = deferred()
    const store = createCompiledScenePresentationStore()
    store.onLoadStateChange({
      phase: 'ready', attempt: 1, scene: installedScene({ qualityReady: quality.promise }),
    })
    store.onPresentationStateChange({ attempt: 1, quality: 'bootstrap', presented: true })

    quality.resolve()
    await quality.promise

    expect(store.getSnapshot().presentation).toMatchObject({
      bakedQuality: 'ready',
      presented: true,
    })
  })
})
