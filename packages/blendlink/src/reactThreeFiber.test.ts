import { Component, createElement, type ReactNode } from 'react'
import { act, advance, createRoot } from '@react-three/fiber'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createR3FCompiledScene } from './reactThreeFiber.js'
import { defineThreeComponentAdapter } from './threeComponents.js'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

function parserFixture() {
  return {
    json: { asset: { version: '2.0' } },
    plugins: {},
    extensions: {},
    options: {},
  }
}

describe('React Three Fiber compiled-scene adapter', () => {
  it('creates a stable named component without starting a browser load', () => {
    const descriptor = {
      url: '/models/hero.glb?v=content',
      nodes: {},
    } as const

    const Scene = createR3FCompiledScene({
      descriptor,
      displayName: 'HeroScene',
      prewarm: false,
    })

    expect(Scene.displayName).toBe('HeroScene')
    expect(typeof Scene).toBe('function')
    expect(typeof Scene.useScene).toBe('function')
  })

  it('does not label an unstructured installation failure as recoverable', async () => {
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
    const failure = new Error('deterministic malformed scene fixture')
    const Scene = createR3FCompiledScene({
      descriptor: { url: '/models/malformed.glb', nodes: {} },
      loader: {
        manager: new THREE.LoadingManager(),
        loadAsync: vi.fn(async () => { throw failure }),
      } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      prewarm: false,
    })
    const states: Array<{
      phase: string
      recoverable?: boolean
      error?: Error
    }> = []
    class Boundary extends Component<
      { children: ReactNode },
      { error: Error | null }
    > {
      state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) { return { error } }
      render() { return this.state.error ? null : this.props.children }
    }

    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    // R3F captures console.error while creating its reconciler root, so install
    // the expected Error Boundary sink before createRoot rather than render.
    const reactError = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    try {
      await act(async () => {
        root.render(createElement(
          Boundary,
          null,
          createElement(Scene, {
            onLoadStateChange: (state) => states.push(state),
          }),
        ))
        for (let index = 0; index < 12; index += 1) await Promise.resolve()
      })
      const failed = states.find((state) => state.phase === 'failed')
      expect(failed).toMatchObject({
        phase: 'failed',
        recoverable: false,
        error: failure,
      })
    } finally {
      await act(async () => { root.unmount() })
      reactError.mockRestore()
    }
  })

  it('publishes one failure, no ready state, and disposes private resources when the loaded parser refuses compatibility', async () => {
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
    const world = new THREE.Scene()
    const privateRoot = new THREE.Group()
    const privateGeometry = new THREE.BoxGeometry()
    const privateTexture = new THREE.Texture()
    const privateMaterial = new THREE.MeshStandardMaterial({ map: privateTexture })
    privateRoot.add(new THREE.Mesh(privateGeometry, privateMaterial))
    const disposeGeometry = vi.spyOn(privateGeometry, 'dispose')
    const disposeMaterial = vi.spyOn(privateMaterial, 'dispose')
    const disposeTexture = vi.spyOn(privateTexture, 'dispose')
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue({
      scene: privateRoot,
      scenes: [privateRoot],
      animations: [],
      cameras: [],
      asset: {},
      parser: {
        json: {
          asset: { version: '2.0' },
          extensionsUsed: ['KHR_node_visibility'],
          extensionsRequired: ['KHR_node_visibility'],
        },
        plugins: {},
        extensions: {},
        options: {},
      },
      userData: {},
    } as never)
    const Scene = createR3FCompiledScene({
      descriptor: { url: '/models/incompatible-private.glb', nodes: {} },
      prewarm: false,
    })
    const states: Array<{ phase: string; error?: Error }> = []
    class Boundary extends Component<
      { children: ReactNode },
      { error: Error | null }
    > {
      state = { error: null as Error | null }
      static getDerivedStateFromError(error: Error) { return { error } }
      render() { return this.state.error ? null : this.props.children }
    }

    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    const reactError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = (() => {
      try { return createRoot(canvas as unknown as HTMLCanvasElement) }
      finally { clockDeprecation.mockRestore() }
    })()
    await root.configure({
      gl: renderer as unknown as THREE.WebGLRenderer,
      scene: world,
      size: { width: 640, height: 360, top: 0, left: 0 },
      frameloop: 'never',
      dpr: 1,
    })
    try {
      await act(async () => {
        root.render(createElement(
          Boundary,
          null,
          createElement(Scene, {
            onLoadStateChange: (state) => states.push(state),
          }),
        ))
        for (let index = 0; index < 12; index += 1) await Promise.resolve()
      })

      expect(states.filter((state) => state.phase === 'failed')).toHaveLength(1)
      expect(states.filter((state) => state.phase === 'ready')).toHaveLength(0)
      expect(states.find((state) => state.phase === 'failed')?.error?.message)
        .toMatch(/runtime\.required-extension-unsupported.*KHR_node_visibility/s)
      expect(world.children).toEqual([])
      expect(privateRoot.parent).toBeNull()
      expect(disposeGeometry).toHaveBeenCalledOnce()
      expect(disposeMaterial).toHaveBeenCalledOnce()
      expect(disposeTexture).toHaveBeenCalledOnce()
    } finally {
      await act(async () => { root.unmount() })
      reactError.mockRestore()
      load.mockRestore()
    }
  })

  it('serializes a mounted Strict Mode-style effect replay and commits only the current attempt', async () => {
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
    const staleRoot = new THREE.Group()
    staleRoot.name = 'StaleStrictModeRoot'
    const currentRoot = new THREE.Group()
    currentRoot.name = 'CurrentStrictModeRoot'
    const manager = new THREE.LoadingManager()
    type Loaded = {
      scene: THREE.Group
      scenes: THREE.Group[]
      animations: never[]
      cameras: never[]
      asset: Record<string, never>
      parser: ReturnType<typeof parserFixture>
      userData: Record<string, never>
    }
    const pendingResolvers: Array<(loaded: Loaded) => void> = []
    const loadAsync = vi.fn(() => new Promise<Loaded>((resolve) => {
      pendingResolvers.push(resolve)
    }))
    const loaded = (scene: THREE.Group): Loaded => ({
      scene,
      scenes: [scene],
      animations: [],
      cameras: [],
      asset: {},
      parser: parserFixture(),
      userData: {},
    })
    const Scene = createR3FCompiledScene({
      descriptor: {
        url: '/models/strict-mode.glb',
        nodes: {},
        playback: { start: 'manual', loop: 'repeat', speed: 1 },
      },
      loader: { manager, loadAsync } as unknown as
        import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      prewarm: false,
    })
    const onReady = vi.fn()
    const loadStates: Array<{ phase: string; attempt: number }> = []
    const sceneElement = (retryKey: number) => createElement(Scene, {
      retryKey,
      onReady,
      onLoadStateChange: (state) => loadStates.push(state),
    })
    const world = new THREE.Scene()
    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    const root = (() => {
      try { return createRoot(canvas as unknown as HTMLCanvasElement) }
      finally { clockDeprecation.mockRestore() }
    })()
    await root.configure({
      gl: renderer as unknown as THREE.WebGLRenderer,
      scene: world,
      size: { width: 640, height: 360, top: 0, left: 0 },
      frameloop: 'never',
      dpr: 1,
    })

    const flush = async (): Promise<void> => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve()
    }
    await act(async () => { root.render(sceneElement(0)); await flush() })
    expect(loadAsync).toHaveBeenCalledTimes(1)

    // React Strict Mode's development probe is setup -> cleanup -> setup. The
    // custom R3F root used here does not enable Strict Effects itself, so a
    // retry-key change drives the same retained-instance Effect cleanup/setup
    // lifecycle explicitly while attempt one is pending.
    await act(async () => { root.render(sceneElement(1)); await flush() })

    // The current attempt is queued behind the abandoned one, preventing two
    // generations from mutating Canvas-global state concurrently.
    expect(loadAsync).toHaveBeenCalledTimes(1)
    await act(async () => { pendingResolvers[0]!(loaded(staleRoot)); await flush() })
    expect(loadAsync).toHaveBeenCalledTimes(2)
    expect(staleRoot.parent).toBeNull()

    await act(async () => { pendingResolvers[1]!(loaded(currentRoot)); await flush() })

    expect(loadAsync).toHaveBeenCalledTimes(2)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(loadStates.filter((state) => state.phase === 'loading').map((state) => state.attempt))
      .toEqual([1, 2])
    expect(loadStates.filter((state) => state.phase === 'ready').map((state) => state.attempt))
      .toEqual([2])
    expect(currentRoot.parent).toBe(world)
    expect(world.children.filter((child) => child === currentRoot)).toHaveLength(1)

    await act(async () => { root.unmount() })
    expect(currentRoot.parent).toBeNull()
  })

  it('does not render the live R3F world while the current scene attempt is preparing', async () => {
    const canvas = {
      clientWidth: 640,
      clientHeight: 360,
      style: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
    }
    let clearAlpha = 1
    const finishCompiles: Array<() => void> = []
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
      compileAsync: vi.fn(() => new Promise<void>((resolve) => {
        finishCompiles.push(resolve)
      })),
    }
    const loadedRoots = [new THREE.Group(), new THREE.Group()]
    loadedRoots[0]!.name = 'PreparingRoot'
    loadedRoots[1]!.name = 'RetryPreparingRoot'
    let loadIndex = 0
    const loadAsync = vi.fn(async () => {
      const loadedRoot = loadedRoots[loadIndex++]!
      return {
      scene: loadedRoot,
      scenes: [loadedRoot],
      animations: [],
      cameras: [],
      asset: {},
      parser: parserFixture(),
      userData: {},
      }
    })
    const Scene = createR3FCompiledScene({
      descriptor: {
        url: '/models/preparing.glb',
        nodes: {},
        playback: { start: 'manual', loop: 'repeat', speed: 1 },
      },
      loader: {
        manager: new THREE.LoadingManager(),
        loadAsync,
      } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      prewarm: true,
    })
    const onReady = vi.fn()
    const world = new THREE.Scene()
    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    const root = (() => {
      try { return createRoot(canvas as unknown as HTMLCanvasElement) }
      finally { clockDeprecation.mockRestore() }
    })()
    await root.configure({
      gl: renderer as unknown as THREE.WebGLRenderer,
      scene: world,
      size: { width: 640, height: 360, top: 0, left: 0 },
      frameloop: 'never',
      dpr: 1,
    })
    const flush = async (): Promise<void> => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve()
    }
    let store!: ReturnType<typeof root.render>
    await act(async () => {
      store = root.render(createElement(Scene, { retryKey: 0, onReady }))
      await flush()
    })
    expect(loadAsync).toHaveBeenCalledOnce()
    expect(loadedRoots[0]!.parent).toBeInstanceOf(THREE.Scene)
    expect(loadedRoots[0]!.parent).not.toBe(world)
    expect(world.children).not.toContain(loadedRoots[0])
    expect(renderer.compileAsync).toHaveBeenCalledOnce()

    advance(1, true, store.getState())
    expect(renderer.render).not.toHaveBeenCalled()
    expect(onReady).not.toHaveBeenCalled()

    await act(async () => {
      finishCompiles[0]!()
      await flush()
    })
    expect(onReady).toHaveBeenCalledOnce()
    expect(loadedRoots[0]!.parent).toBe(world)
    advance(2, true, store.getState())
    expect(renderer.render).toHaveBeenCalledTimes(1)

    renderer.render.mockClear()
    await act(async () => {
      store = root.render(createElement(Scene, { retryKey: 1, onReady }))
      await flush()
    })
    expect(loadAsync).toHaveBeenCalledTimes(2)
    expect(loadedRoots[0]!.parent).toBeNull()
    expect(loadedRoots[1]!.parent).toBeInstanceOf(THREE.Scene)
    expect(loadedRoots[1]!.parent).not.toBe(world)
    expect(world.children).not.toContain(loadedRoots[1])
    advance(3, true, store.getState())
    expect(renderer.render).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishCompiles[1]!()
      await flush()
    })
    expect(onReady).toHaveBeenCalledTimes(2)
    expect(loadedRoots[1]!.parent).toBe(world)
    advance(4, true, store.getState())
    expect(renderer.render).toHaveBeenCalledTimes(1)

    await act(async () => { root.unmount(); await flush() })
    expect(loadedRoots[1]!.parent).toBeNull()
  })

  it('suppresses private-loader progress from an attempt canceled by replacement', async () => {
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
    const fetchRequests: Request[] = []
    vi.stubGlobal('fetch', vi.fn((request: Request) => {
      fetchRequests.push(request)
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true },
        )
      })
    }))
    const Scene = createR3FCompiledScene({
      descriptor: {
        url: 'https://blendlink.invalid/models/stale-progress.glb',
        nodes: {},
      },
      prewarm: false,
    })
    const states: Array<{ phase: string; attempt: number }> = []
    const sceneElement = (retryKey: number) => createElement(Scene, {
      retryKey,
      onLoadStateChange: (state) => states.push(state),
    })
    const world = new THREE.Scene()
    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    const root = (() => {
      try { return createRoot(canvas as unknown as HTMLCanvasElement) }
      finally { clockDeprecation.mockRestore() }
    })()
    await root.configure({
      gl: renderer as unknown as THREE.WebGLRenderer,
      scene: world,
      size: { width: 640, height: 360, top: 0, left: 0 },
      frameloop: 'never',
      dpr: 1,
    })
    const flush = async (): Promise<void> => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve()
    }

    try {
      await act(async () => { root.render(sceneElement(0)); await flush() })
      expect(fetchRequests).toHaveLength(1)

      await act(async () => { root.render(sceneElement(1)); await flush() })
      expect(fetchRequests[0]!.signal.aborted).toBe(true)
      expect(fetchRequests).toHaveLength(2)

      const replacementStarted = states.findIndex((state) => state.attempt === 2)
      expect(replacementStarted).toBeGreaterThanOrEqual(0)
      expect(states.slice(replacementStarted + 1).filter((state) => state.attempt === 1))
        .toEqual([])
    } finally {
      await act(async () => { root.unmount(); await flush() })
      vi.unstubAllGlobals()
    }
  })

  it('bounds long R3F deltas and starts newly active runtime time at zero', async () => {
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
    const loadedRoot = new THREE.Group()
    const manager = new THREE.LoadingManager()
    const loadAsync = vi.fn(async () => ({
      scene: loadedRoot,
      scenes: [loadedRoot],
      animations: [],
      cameras: [],
      asset: {},
      parser: parserFixture(),
      userData: {},
    }))
    let active = false
    const updates: number[] = []
    const Scene = createR3FCompiledScene({
      descriptor: {
        url: '/models/activity-clock.glb',
        nodes: {},
        components: [{
          id: 'activity-clock',
          type: 'test.activity-clock',
          schemaVersion: 1,
          enabled: true,
          target: { kind: 'scene' },
          values: {},
        }],
      },
      loader: { manager, loadAsync } as unknown as
        import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      componentAdapters: {
        'test.activity-clock': defineThreeComponentAdapter(() => ({
          isActive: () => active,
          update: (deltaSeconds) => { updates.push(deltaSeconds) },
          dispose() {},
        })),
      },
      prewarm: false,
    })
    const originalWarn = console.warn
    const clockDeprecation = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      if (args[0] !== 'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.') {
        originalWarn(...args)
      }
    })
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const root = (() => {
      try { return createRoot(canvas as unknown as HTMLCanvasElement) }
      finally { clockDeprecation.mockRestore() }
    })()
    await root.configure({
      gl: renderer as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      size: { width: 640, height: 360, top: 0, left: 0 },
      frameloop: 'always',
      dpr: 1,
    })
    const flush = async (): Promise<void> => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve()
    }
    let store!: ReturnType<typeof root.render>
    try {
      await act(async () => {
        store = root.render(createElement(Scene))
        await flush()
      })
      expect(loadAsync).toHaveBeenCalledOnce()

      const state = store.getState()
      state.clock.start()
      state.clock.oldTime = performance.now() - 1_000
      advance(performance.now(), true, state)
      expect(updates.at(-1)).toBe(0.1)

      active = true
      state.clock.oldTime = performance.now() - 1_000
      advance(performance.now(), true, state)
      expect(updates.at(-1)).toBe(0)
    } finally {
      await act(async () => { root.unmount(); await flush() })
      vi.unstubAllGlobals()
    }
  })
})
