import {
  StrictMode,
  createElement,
  type ReactNode,
} from 'react'
import { act, createRoot } from '@react-three/fiber'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  useCompiledScenePresentation,
  type UseCompiledScenePresentationResult,
} from './react.js'
import type { InstalledThreeCompiledScene } from './threeRuntime.js'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

async function createHookRoot() {
  const canvas = {
    clientWidth: 640,
    clientHeight: 360,
    style: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  }
  let clearAlpha = 1
  const renderer = {
    isWebGLRenderer: true,
    domElement: canvas,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    capabilities: { getMaxAnisotropy: () => 8 },
    shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false, type: 0 },
    extensions: { has: () => false, get: () => null },
    setClearAlpha(value: number) { clearAlpha = value },
    getClearAlpha() { return clearAlpha },
    getContextAttributes: () => ({ alpha: true }),
    getContext: () => ({ isContextLost: () => false }),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    initTexture: vi.fn(),
  }
  const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const root = (() => {
    try { return createRoot(canvas as unknown as HTMLCanvasElement) }
    finally { clockDeprecation.mockRestore() }
  })()
  await root.configure({
    gl: renderer as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    size: { width: 640, height: 360, top: 0, left: 0 },
    frameloop: 'never',
    dpr: 1,
  })
  return root
}

function installedScene(): InstalledThreeCompiledScene {
  return {
    baked: null,
    components: {
      accessibleControls: Object.freeze([]),
      postprocessing: false,
      audio: {
        readiness: { state: 'unavailable' },
        subscribe: () => ({ dispose() {} }),
        resume: async () => false,
      },
    },
    requiresContinuousFrames: false,
  } as InstalledThreeCompiledScene
}

describe('useCompiledScenePresentation', () => {
  it('publishes lifecycle facts with stable scene props inside one retry epoch', async () => {
    const root = await createHookRoot()
    let current: UseCompiledScenePresentationResult | undefined

    function Probe(): ReactNode {
      current = useCompiledScenePresentation()
      return null
    }

    await act(async () => {
      root.render(createElement(Probe))
      await flush()
    })
    const initial = current!
    const initialProps = initial.sceneProps
    expect(initial).toMatchObject({ phase: 'idle', retryKey: 0 })
    expect(initial.onLoadStateChange).toBe(initialProps.onLoadStateChange)
    expect(initial.onPresentationStateChange).toBe(
      initialProps.onPresentationStateChange,
    )

    await act(async () => {
      initialProps.onLoadStateChange({
        phase: 'loading',
        attempt: 1,
        item: '/scene.glb',
        itemsLoaded: 1,
        itemsTotal: 2,
      })
      await flush()
    })
    expect(current).toMatchObject({
      phase: 'loading',
      retryKey: 0,
      itemsLoaded: 1,
      itemsTotal: 2,
    })
    expect(current!.sceneProps).toBe(initialProps)

    await act(async () => {
      initialProps.onLoadStateChange({
        phase: 'ready',
        attempt: 1,
        scene: installedScene(),
      })
      await flush()
    })
    expect(current).toMatchObject({ phase: 'ready', retryKey: 0 })
    expect(current!.sceneProps).toBe(initialProps)

    await act(async () => { root.unmount(); await flush() })
  })

  it('revokes stale callbacks synchronously and accepts attempt one after retry', async () => {
    const root = await createHookRoot()
    let current: UseCompiledScenePresentationResult | undefined

    function Probe(): ReactNode {
      current = useCompiledScenePresentation()
      return null
    }

    await act(async () => {
      root.render(createElement(Probe))
      await flush()
    })
    const stale = current!.sceneProps
    await act(async () => {
      stale.onLoadStateChange({
        phase: 'loading',
        attempt: 7,
        itemsLoaded: 2,
        itemsTotal: 3,
      })
      await flush()
    })

    await act(async () => {
      current!.retry()
      stale.onLoadStateChange({
        phase: 'failed',
        attempt: 8,
        error: new Error('late failure'),
        recoverable: false,
      })
      stale.onPresentationStateChange({
        attempt: 7,
        quality: 'failed',
        presented: false,
        error: new Error('late presentation failure'),
      })
      await flush()
    })

    expect(current).toMatchObject({
      phase: 'idle',
      retryKey: 1,
      error: null,
    })
    expect(current!.sceneProps).not.toBe(stale)
    expect(current!.sceneProps.onLoadStateChange).not.toBe(stale.onLoadStateChange)

    await act(async () => {
      current!.sceneProps.onLoadStateChange({
        phase: 'loading',
        attempt: 1,
        itemsLoaded: 0,
        itemsTotal: 1,
      })
      await flush()
    })
    expect(current).toMatchObject({
      phase: 'loading',
      retryKey: 1,
      attempt: 1,
    })

    await act(async () => { root.unmount(); await flush() })
  })

  it('advances monotonically across batched retries and ignores callbacks after unmount', async () => {
    const root = await createHookRoot()
    let current: UseCompiledScenePresentationResult | undefined

    function Probe(): ReactNode {
      current = useCompiledScenePresentation()
      return null
    }

    await act(async () => {
      root.render(createElement(Probe))
      await flush()
    })
    const first = current!.sceneProps

    await act(async () => {
      current!.retry()
      current!.retry()
      first.onLoadStateChange({
        phase: 'loading',
        attempt: 1,
        itemsLoaded: 1,
        itemsTotal: 1,
      })
      await flush()
    })

    expect(current).toMatchObject({ phase: 'idle', retryKey: 2 })
    const finalBinding = current!.sceneProps
    await act(async () => { root.unmount(); await flush() })
    expect(() => finalBinding.onLoadStateChange({
      phase: 'loading',
      attempt: 1,
      itemsLoaded: 0,
      itemsTotal: 0,
    })).not.toThrow()
  })

  it('reactivates the current binding after a Strict Mode effect probe', async () => {
    const root = await createHookRoot()
    let current: UseCompiledScenePresentationResult | undefined

    function Probe(): ReactNode {
      current = useCompiledScenePresentation()
      return null
    }

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Probe)))
      await flush()
    })
    await act(async () => {
      current!.sceneProps.onLoadStateChange({
        phase: 'loading',
        attempt: 1,
        itemsLoaded: 0,
        itemsTotal: 1,
      })
      await flush()
    })
    expect(current).toMatchObject({ phase: 'loading', retryKey: 0 })

    await act(async () => { root.unmount(); await flush() })
  })
})
