import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import ts from 'typescript'
import { renderBakedRecipe } from './bakedRecipe.js'
import {
  installThreeCompiledScene,
  installLoadedThreeCompiledScene,
  prepareLoadedThreeCompiledScene,
  startThreeCompiledSceneInstallation,
  threeKtx2TranscoderPath,
  type ThreeBakedSceneHandle,
} from './threeRuntime.js'
import type { CompiledSceneDescriptor } from './runtime.js'

function descriptor(overrides: Partial<CompiledSceneDescriptor> = {}): CompiledSceneDescriptor {
  return {
    url: '/hero.glb',
    nodes: {},
    playback: { start: 'manual', loop: 'repeat', speed: 1 },
    look: {
      toneMapping: 'neutral', exposure: 1, background: 'color', backgroundColor: [0.1, 0.2, 0.3],
    },
    fog: { mode: 'linear', color: [0.2, 0.3, 0.4], near: 2, far: 40, density: 0.02 },
    shadows: {
      preset: 'application', filter: 'pcf', mapSize: 1024, maxDistance: 50,
      bias: -0.0005, normalBias: 0.02, radius: 1, autoUpdate: true,
    },
    ...overrides,
  }
}

function renderer() {
  let clearAlpha = 0.65
  const sizes: Array<[number, number, boolean]> = []
  return {
    isWebGLRenderer: true,
    domElement: { clientWidth: 640, clientHeight: 360 },
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 0.5,
    capabilities: { getMaxAnisotropy() { return 8 } },
    shadowMap: { enabled: false, autoUpdate: false, needsUpdate: false, type: 0 },
    extensions: { has() { return false }, get() { return null } },
    setClearAlpha(value: number) { clearAlpha = value },
    getClearAlpha() { return clearAlpha },
    getContextAttributes() { return { alpha: true } },
    setSize(width: number, height: number, updateStyle: boolean) {
      sizes.push([width, height, updateStyle])
    },
    render: vi.fn(),
    initTexture: vi.fn(),
    sizes,
  }
}

function rectAreaMarker(name = 'Area_Key') {
  const object = new THREE.Object3D()
  object.name = name
  object.userData.blendlink_rect_area_light = {
    schemaVersion: 1,
    color: [0.25, 0.5, 1],
    size: [2, 4],
    power: 10,
  }
  return object
}

function rectAreaRenderer() {
  const value = renderer()
  Object.setPrototypeOf(value, THREE.WebGLRenderer.prototype)
  Object.assign(value.domElement, {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
  })
  return value as unknown as THREE.WebGLRenderer & {
    compileAsync?: ReturnType<typeof vi.fn>
    initTexture: ReturnType<typeof vi.fn>
  }
}

function loader(root: THREE.Group, animations: THREE.AnimationClip[] = []) {
  return {
    async loadAsync() {
      return {
        scene: root,
        scenes: [root],
        animations,
        cameras: [],
        asset: {},
        parser: {
          json: { asset: { version: '2.0' } },
          plugins: {},
          extensions: {},
          options: {},
        },
        userData: {},
      }
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function onePixelHdrDataUrl(): string {
  const header = Buffer.from(
    '#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 1\n',
    'ascii',
  )
  const pixel = Buffer.from([128, 128, 128, 129])
  return `data:application/octet-stream;base64,${Buffer.concat([header, pixel]).toString('base64')}`
}

function visibilityAdapterFixture() {
  const root = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  const material = new THREE.MeshStandardMaterial()
  const instanceA = new THREE.Mesh(geometry, material)
  instanceA.name = 'Instance_A'
  instanceA.userData.blendlink_id = 'instance-a'
  const instanceB = new THREE.Mesh(geometry, material)
  instanceB.name = 'Instance_B'
  instanceB.userData.blendlink_id = 'instance-b'
  const lod0 = new THREE.Object3D()
  lod0.name = 'Tree_LOD0'
  lod0.userData.blendlink_id = 'lod-0'
  const lod1 = new THREE.Object3D()
  lod1.name = 'Tree_LOD1'
  lod1.userData.blendlink_id = 'lod-1'
  root.add(instanceA, instanceB, lod0, lod1)
  const sceneDiagnostics: NonNullable<CompiledSceneDescriptor['sceneDiagnostics']> = {
    lod: {
      chains: [{
        base: 'Tree', valid: true, warnings: [],
        drawCallsWithoutAdapter: 2, drawCallsWithAdapter: 1,
        levels: [
          { index: 0, node: 'Tree_LOD0', loadedName: 'Tree_LOD0', id: 'lod-0', distance: 0, drawCalls: 1 },
          { index: 1, node: 'Tree_LOD1', loadedName: 'Tree_LOD1', id: 'lod-1', distance: 10, drawCalls: 1 },
        ],
      }],
      validChains: 1, drawCallsWithoutAdapter: 2, drawCallsWithAdapter: 1,
    },
    instances: {
      groups: [{
        id: 'boxes', meshData: 'Box', count: 2, eligible: true, reasons: [],
        drawCallsSeparate: 2, drawCallsInstanced: 1, drawCallsSaved: 1,
        emission: 'shared-data',
        members: [
          { name: 'Instance_A', loadedName: 'Instance_A', id: 'instance-a' },
          { name: 'Instance_B', loadedName: 'Instance_B', id: 'instance-b' },
        ],
      }],
      gpuBatches: [], eligibleGroups: 1, estimatedDrawCallsCurrent: 2,
      estimatedDrawCallsIfEligibleBatched: 1, estimatedDrawCallsSaved: 1,
    },
    procedural: { objects: [], blockers: 0, topologyChanging: 0, cacheCandidates: 0 },
  }
  const runtimeDiagnostics: NonNullable<CompiledSceneDescriptor['runtimeDiagnostics']> = {
    schemaVersion: 1,
    lodChains: sceneDiagnostics.lod.chains,
    instanceGroups: sceneDiagnostics.instances.groups,
  }
  return { root, instanceA, instanceB, lod0, lod1, runtimeDiagnostics, sceneDiagnostics }
}

function visibilityBakedHandle(
  objects: THREE.Object3D[],
  hiddenByState: Record<string, Set<string>>,
  defaultState: string,
): ThreeBakedSceneHandle {
  const controlled = new Set(Object.values(hiddenByState).flatMap((set) => [...set]))
  const apply = (name: string): boolean => {
    const hidden = hiddenByState[name]
    if (!hidden) return false
    for (const object of objects) {
      const id = object.userData.blendlink_id as string
      if (controlled.has(id)) object.visible = !hidden.has(id)
    }
    return true
  }
  apply(defaultState)
  return {
    ready: Promise.resolve(),
    lightGroupNames: [],
    setState: apply,
    setLightGroup: () => false,
    dispose() {},
  }
}

describe('official Three scene installation seam', () => {
  it('prepares a complete scene offscreen and changes live presentation only at commit', async () => {
    const root = new THREE.Group()
    root.name = 'Prepared Hero'
    root.add(new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    ))
    const existing = new THREE.Object3D()
    existing.name = 'Application sibling'
    const world = new THREE.Scene()
    world.add(existing)
    const applicationBackground = new THREE.Color(0.8, 0.7, 0.6)
    const applicationFog = new THREE.Fog(0x123456, 3, 90)
    world.background = applicationBackground
    world.fog = applicationFog
    const webgl = renderer()
    webgl.shadowMap.enabled = true
    webgl.toneMapping = THREE.ACESFilmicToneMapping
    webgl.toneMappingExposure = 0.75

    const prepared = await prepareLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          shadows: {
            preset: 'off', filter: 'pcf', mapSize: 1024, maxDistance: 50,
            bias: 0, normalBias: 0, radius: 1, autoUpdate: false,
          },
        }),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: world,
        prewarm: false,
      },
    )

    expect(world.children).toEqual([existing])
    expect(root.parent).not.toBe(world)
    expect(world.background).toBe(applicationBackground)
    expect(world.fog).toBe(applicationFog)
    expect(webgl).toMatchObject({
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 0.75,
      shadowMap: { enabled: true },
    })

    const installed = prepared.commit()
    expect(root.parent).toBe(world)
    expect(world.background).toBeInstanceOf(THREE.Color)
    expect(world.background).not.toBe(applicationBackground)
    expect(world.fog).toBeInstanceOf(THREE.Fog)
    expect(world.fog).not.toBe(applicationFog)
    expect(webgl).toMatchObject({
      toneMapping: THREE.NeutralToneMapping,
      toneMappingExposure: 2,
      shadowMap: { enabled: false },
    })

    installed.dispose()
    expect(root.parent).toBeNull()
    expect(world.children).toEqual([existing])
    expect(world.background).toBe(applicationBackground)
    expect(world.fog).toBe(applicationFog)
    expect(webgl).toMatchObject({
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 0.75,
      shadowMap: { enabled: true },
    })
  })

  it('fits a grounded backdrop to visible compiled-root bounds without absorbing helpers', async () => {
    vi.stubGlobal('ProgressEvent', class extends Event {
      readonly lengthComputable: boolean
      readonly loaded: number
      readonly total: number

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type)
        this.lengthComputable = init.lengthComputable ?? false
        this.loaded = init.loaded ?? 0
        this.total = init.total ?? 0
      }
    })
    const root = new THREE.Group()
    const subject = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4),
      new THREE.MeshBasicMaterial(),
    )
    subject.position.set(3, 0, 1)
    const hiddenOutlier = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    )
    hiddenOutlier.position.set(100, -100, 100)
    hiddenOutlier.visible = false
    const authoredHelper = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
    )
    authoredHelper.position.set(-100, -100, -100)
    authoredHelper.userData.blendlink_auto_fit = false
    root.add(subject, hiddenOutlier, authoredHelper)

    let installed: Awaited<ReturnType<typeof installLoadedThreeCompiledScene>> | null = null
    try {
      installed = await installLoadedThreeCompiledScene(
        await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
        {
          descriptor: descriptor({
            look: { toneMapping: 'application', exposure: 0, background: 'application' },
            environment: {
              source: 'image', imageName: 'One Pixel.hdr', lighting: 'none', background: 'grounded',
              lightingIntensity: 1, lightingRotation: 0,
              backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
              groundHeight: 1, groundRadius: 18,
            },
            environmentAsset: {
              url: onePixelHdrDataUrl(),
              sourceName: 'One Pixel.hdr',
              format: 'hdr',
              bytes: 51,
              hash: 'fixture',
              source: 'packed',
            },
          }),
          renderer: renderer() as unknown as THREE.WebGLRenderer,
          scene: new THREE.Scene(),
          fallbackCamera: (() => {
            const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
            camera.position.set(3, 2, 8)
            camera.lookAt(3, 0.5, 1)
            camera.updateMatrixWorld(true)
            return camera
          })(),
          prewarm: false,
        },
      )

      const ground = installed.environment.groundedBackground as THREE.Mesh
      expect(ground.position.toArray()).toEqual([3, 0.5, 1])
    } finally {
      installed?.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('repairs only the package-created fallback camera for a grounded backdrop', async () => {
    vi.stubGlobal('ProgressEvent', class extends Event {
      readonly lengthComputable: boolean
      readonly loaded: number
      readonly total: number

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type)
        this.lengthComputable = init.lengthComputable ?? false
        this.loaded = init.loaded ?? 0
        this.total = init.total ?? 0
      }
    })
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    let installed: Awaited<ReturnType<typeof installLoadedThreeCompiledScene>> | null = null
    try {
      installed = await installLoadedThreeCompiledScene(
        await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
        {
          descriptor: descriptor({
            look: { toneMapping: 'application', exposure: 0, background: 'application' },
            environment: {
              source: 'image', imageName: 'One Pixel.hdr', lighting: 'none', background: 'grounded',
              lightingIntensity: 1, lightingRotation: 0,
              backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
              groundHeight: 1, groundRadius: 100,
            },
            environmentAsset: {
              url: onePixelHdrDataUrl(), sourceName: 'One Pixel.hdr', format: 'hdr',
              bytes: 51, hash: 'fixture', source: 'packed',
            },
          }),
          renderer: renderer() as unknown as THREE.WebGLRenderer,
          scene: new THREE.Scene(),
          prewarm: false,
        },
      )

      expect(installed.camera).toBeInstanceOf(THREE.PerspectiveCamera)
      expect((installed.camera as THREE.PerspectiveCamera).far).toBeGreaterThan(96)
    } finally {
      installed?.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('rejects an unsafe application camera without mutating its clipping ownership', async () => {
    vi.stubGlobal('ProgressEvent', class extends Event {
      readonly lengthComputable: boolean
      readonly loaded: number
      readonly total: number

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type)
        this.lengthComputable = init.lengthComputable ?? false
        this.loaded = init.loaded ?? 0
        this.total = init.total ?? 0
      }
    })
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const world = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10)
    camera.position.set(0, 1, 3)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)
    const projection = camera.projectionMatrix.clone()
    try {
      await expect(installLoadedThreeCompiledScene(
        await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
        {
          descriptor: descriptor({
            look: { toneMapping: 'application', exposure: 0, background: 'application' },
            environment: {
              source: 'image', imageName: 'One Pixel.hdr', lighting: 'none', background: 'grounded',
              lightingIntensity: 1, lightingRotation: 0,
              backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
              groundHeight: 1, groundRadius: 100,
            },
            environmentAsset: {
              url: onePixelHdrDataUrl(), sourceName: 'One Pixel.hdr', format: 'hdr',
              bytes: 51, hash: 'fixture', source: 'packed',
            },
          }),
          renderer: renderer() as unknown as THREE.WebGLRenderer,
          scene: world,
          fallbackCamera: camera,
          prewarm: false,
        },
      )).rejects.toThrow(/application-owned camera.*far.*Grounded Backdrop/i)
      expect(camera.far).toBe(10)
      expect(camera.projectionMatrix.equals(projection)).toBe(true)
      expect(root.parent).toBeNull()
      expect(world.children).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('records Three r184 cross-manager same-URL cancellation as a non-isolated boundary', async () => {
    expect(typeof AbortSignal.any).toBe('function')
    const requests: Request[] = []
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const request = input as Request
      requests.push(request)
      return new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
        if (request.signal.aborted) rejectAbort()
        else request.signal.addEventListener('abort', rejectAbort, { once: true })
      })
    })

    try {
      // When the application starts the URL first, Three coalesces Blendlink's
      // same-URL subscriber onto that request. Aborting the second/private
      // manager cannot stop work owned by the first manager.
      const applicationFirstManager = new THREE.LoadingManager()
      const privateSecondManager = new THREE.LoadingManager()
      const applicationFirst = new THREE.FileLoader(applicationFirstManager)
        .loadAsync('https://blendlink.invalid/shared-application-first.bin')
      const privateSecond = new THREE.FileLoader(privateSecondManager)
        .loadAsync('https://blendlink.invalid/shared-application-first.bin')
      const applicationFirstSettlements = Promise.allSettled([applicationFirst, privateSecond])
      expect(requests).toHaveLength(1)
      privateSecondManager.abort()
      expect(requests[0]!.signal.aborted).toBe(false)
      applicationFirstManager.abort()
      expect(requests[0]!.signal.aborted).toBe(true)
      expect((await applicationFirstSettlements).map((entry) => entry.status))
        .toEqual(['rejected', 'rejected'])

      // The reverse is the dangerous ownership collision: when Blendlink's
      // private request starts first, canceling it also rejects an application
      // consumer that Three attached to the same module-global URL entry.
      const privateFirstManager = new THREE.LoadingManager()
      const applicationSecondManager = new THREE.LoadingManager()
      const privateFirst = new THREE.FileLoader(privateFirstManager)
        .loadAsync('https://blendlink.invalid/shared-private-first.bin')
      const applicationSecond = new THREE.FileLoader(applicationSecondManager)
        .loadAsync('https://blendlink.invalid/shared-private-first.bin')
      const privateFirstSettlements = Promise.allSettled([privateFirst, applicationSecond])
      expect(requests).toHaveLength(2)
      privateFirstManager.abort()
      expect(requests[1]!.signal.aborted).toBe(true)
      expect((await privateFirstSettlements).map((entry) => entry.status))
        .toEqual(['rejected', 'rejected'])
    } finally {
      fetch.mockRestore()
    }
  })

  it('refuses ready when its private manager reports a failed glTF dependency', async () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const material = new THREE.MeshStandardMaterial()
    root.add(new THREE.Mesh(geometry, material))
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      async function () {
        this.manager.itemStart('/hero.glb')
        this.manager.itemStart('/textures/missing-base-color.png')
        this.manager.itemError('/textures/missing-base-color.png')
        this.manager.itemEnd('/textures/missing-base-color.png')
        this.manager.itemEnd('/hero.glb')
        // GLTFLoader r184 catches external image failures and can still resolve
        // with a null texture. Blendlink must treat the manager error as the
        // terminal fact rather than publishing a visibly incomplete scene.
        return await loader(root).loadAsync() as never
      },
    )

    try {
      await expect(installThreeCompiledScene({
        descriptor: descriptor(),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
      })).rejects.toThrow(
        /missing-base-color\.png[\s\S]*base path[\s\S]*CORS/i,
      )
      expect(root.parent).toBeNull()
      expect(disposeGeometry).toHaveBeenCalledOnce()
      expect(disposeMaterial).toHaveBeenCalledOnce()
    } finally {
      load.mockRestore()
    }
  })

  it('leaves dependency-failure policy on an application-owned manager untouched', async () => {
    const root = new THREE.Group()
    const manager = new THREE.LoadingManager()
    const applicationOnError = vi.fn()
    manager.onError = applicationOnError
    const applicationLoader = {
      manager,
      async loadAsync() {
        manager.itemError('/authenticated/application-texture.png')
        return await loader(root).loadAsync()
      },
    }

    const installed = await installThreeCompiledScene({
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: applicationLoader as unknown as GLTFLoader,
      prewarm: false,
    })

    expect(manager.onError).toBe(applicationOnError)
    expect(applicationOnError).toHaveBeenCalledExactlyOnceWith(
      '/authenticated/application-texture.png',
    )
    installed.dispose()
  })

  it('aborts its private LoadingManager exactly once when a pending load is canceled', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    let resolveLoad!: (value: Awaited<ReturnType<ReturnType<typeof loader>['loadAsync']>>) => void
    const pending = new Promise<Awaited<ReturnType<ReturnType<typeof loader>['loadAsync']>>>((resolve) => {
      resolveLoad = resolve
    })
    let privateManager: THREE.LoadingManager | null = null
    let abortPrivateManager: ReturnType<typeof vi.spyOn> | null = null
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      function () {
        privateManager = this.manager
        abortPrivateManager = vi.spyOn(this.manager, 'abort')
        return pending as never
      },
    )

    try {
      const task = startThreeCompiledSceneInstallation({
        descriptor: descriptor(),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: world,
      })
      expect(privateManager).toBeInstanceOf(THREE.LoadingManager)

      task.cancel()
      task.cancel()

      expect(abortPrivateManager).toHaveBeenCalledTimes(1)
      resolveLoad(await loader(root).loadAsync())
      await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' })
      expect(root.parent).toBeNull()
    } finally {
      abortPrivateManager?.mockRestore()
      load.mockRestore()
    }
  })

  it('never aborts an application-owned LoadingManager when abandoning a pending load', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const applicationManager = new THREE.LoadingManager()
    const abortApplicationManager = vi.spyOn(applicationManager, 'abort')
    let resolveLoad!: (value: Awaited<ReturnType<ReturnType<typeof loader>['loadAsync']>>) => void
    const pending = new Promise<Awaited<ReturnType<ReturnType<typeof loader>['loadAsync']>>>((resolve) => {
      resolveLoad = resolve
    })
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      function () {
        expect(this.manager).toBe(applicationManager)
        return pending as never
      },
    )

    try {
      const task = startThreeCompiledSceneInstallation({
        descriptor: descriptor(),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: world,
        loadingManager: applicationManager,
      })
      task.cancel()

      expect(abortApplicationManager).not.toHaveBeenCalled()
      resolveLoad(await loader(root).loadAsync())
      await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' })
      expect(root.parent).toBeNull()
    } finally {
      abortApplicationManager.mockRestore()
      load.mockRestore()
    }
  })

  it('abandons a non-abortable application load before it can attach or become ready', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    let resolveLoad!: (value: { scene: THREE.Group; animations: never[] }) => void
    const pending = new Promise<{ scene: THREE.Group; animations: never[] }>((resolve) => {
      resolveLoad = resolve
    })
    const applicationLoader = loader(root) as ReturnType<typeof loader> & {
      loadAsync(): typeof pending
    }
    applicationLoader.loadAsync = () => pending

    const task = startThreeCompiledSceneInstallation({
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: applicationLoader as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })
    task.cancel()
    resolveLoad({ scene: root, animations: [] })

    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(root.parent).toBeNull()
  })

  it('clones authored NLA strips and converts only additive copies', async () => {
    const enter = new THREE.AnimationClip('Enter', 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
    ])
    const settle = new THREE.AnimationClip('Settle', 1, [
      new THREE.NumberKeyframeTrack('.position[y]', [0, 0.5, 1], [1, 2, 3]),
    ])
    const loaded = await loader(new THREE.Group(), [enter, settle]).loadAsync()
    const installed = await installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          animationSequence: {
            name: 'Hero Story',
            source: { objectId: 'hero', objectName: 'Hero', track: 'Website Story' },
            duration: 1.5,
            loop: false,
            speed: 1,
            strips: [
              {
                order: 0, name: 'Enter Strip', clip: 'Enter', at: 0, duration: 1,
                clipStart: 0, clipEnd: 1, scale: 1, speed: 1, repeat: 1,
                blend: 'replace', blendIn: 0, blendOut: 0, weight: 1,
                easing: 'linear', extrapolation: 'nothing', reverse: false, muted: false,
              },
              {
                order: 1, name: 'Settle Strip', clip: 'Settle', at: 1, duration: 0.5,
                clipStart: 0.5, clipEnd: 1, scale: 1, speed: 1, repeat: 1,
                blend: 'add', blendIn: 0, blendOut: 0, weight: 0.5,
                easing: 'linear', extrapolation: 'hold-forward', reverse: false, muted: false,
              },
            ],
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
      },
    )

    expect(installed.playback?.clips.map((clip) => clip.name)).toEqual([
      'Enter__blendlink_sequence_0',
      'Settle__blendlink_sequence_1',
    ])
    expect(installed.playback?.clips[0]).not.toBe(enter)
    expect(installed.playback?.clips[1]).not.toBe(settle)
    expect((installed.playback?.clips[0] as THREE.AnimationClip).blendMode)
      .toBe(THREE.NormalAnimationBlendMode)
    expect((installed.playback?.clips[1] as THREE.AnimationClip).blendMode)
      .toBe(THREE.AdditiveAnimationBlendMode)
    expect(Array.from(
      (installed.playback?.clips[1] as THREE.AnimationClip).tracks[0]!.values,
    )).toEqual([-1, 0, 1])
    expect(settle.blendMode).toBe(THREE.NormalAnimationBlendMode)
    expect(Array.from(settle.tracks[0]!.values)).toEqual([1, 2, 3])
    expect(installed.animation).not.toBe(installed.playback)
    expect(Object.keys(installed.animation ?? {})).not.toEqual(expect.arrayContaining([
      'mixer',
      'actions',
      'update',
      'dispose',
    ]))
    expect('mixer' in (installed.animation ?? {})).toBe(false)
    expect('dispose' in (installed.animation ?? {})).toBe(false)
    expect(installed.requiresContinuousFrames).toBe(true)
    installed.update(1.5)
    expect(installed.animation?.state.phase).toBe('finished')
    expect(installed.requiresContinuousFrames).toBe(false)
    installed.dispose()
  })

  it('exposes manual animation transport without transferring mixer ownership', async () => {
    const root = new THREE.Group()
    const wave = new THREE.AnimationClip('Wave', 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
    ])
    const loaded = await loader(root, [wave]).loadAsync()
    const requestFrame = vi.fn()
    const installed = await installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          playback: { start: 'manual', loop: 'repeat', speed: 1 },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        requestFrame,
      },
    )

    expect(installed.animation?.state).toMatchObject({
      phase: 'idle',
      mode: 'clips',
      activeClips: [],
    })
    installed.animation?.play('Wave')
    expect(installed.requiresContinuousFrames).toBe(true)
    installed.update(0.25)
    expect(installed.animation?.state.time).toBeCloseTo(0.25)
    installed.animation?.pause()
    expect(installed.requiresContinuousFrames).toBe(false)
    installed.animation?.seek(0.75)
    expect(root.position.x).toBeCloseTo(0.75)
    expect(requestFrame).toHaveBeenCalled()

    installed.dispose()
    expect(() => installed.animation?.play('Wave')).toThrow(/disposed/i)
  })

  it('installs a constant Blender World only in opted-in previews and restores it safely', async () => {
    const world = {
      color: [0.1, 0.2, 0.3] as const,
      strength: 2,
      exact: true,
      source: 'background' as const,
    }
    const sceneDescriptor = descriptor({
      look: { toneMapping: 'application', exposure: 0, background: 'application' },
      environment: {
        source: 'application', lighting: 'application', background: 'application',
        lightingIntensity: 1, lightingRotation: 0,
        backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
        groundHeight: 0, groundRadius: 10,
      },
      authoringPreview: {
        look: {
          toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
        },
        shadows: { enabled: false },
        world,
      },
    })

    const productionScene = new THREE.Scene()
    const productionBackground = new THREE.Color(0x123456)
    productionScene.background = productionBackground
    const production = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: productionScene,
      },
    )
    expect(productionScene.background).toBe(productionBackground)
    expect(productionScene.getObjectByName('Blendlink Preview World')).toBeUndefined()
    production.dispose()

    const previewScene = new THREE.Scene()
    const previousBackground = new THREE.Color(0x654321)
    const previousEnvironment = new THREE.Texture()
    previewScene.background = previousBackground
    previewScene.environment = previousEnvironment
    previewScene.backgroundIntensity = 1.75
    previewScene.environmentIntensity = 0.625
    const preview = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: previewScene,
        useAuthoringPreview: true,
      },
    )

    const environment = previewScene.environment as THREE.DataTexture
    expect(previewScene.background).toBe(environment)
    expect(environment).toBeInstanceOf(THREE.DataTexture)
    expect(environment).toMatchObject({
      name: 'Blendlink Preview World',
      mapping: THREE.EquirectangularReflectionMapping,
      colorSpace: THREE.LinearSRGBColorSpace,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
    })
    expect(environment.image).toMatchObject({ width: 64, height: 32 })
    expect(Array.from(environment.image.data.slice(0, 8))).toEqual([
      expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), 1,
      expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), 1,
    ])
    expect(previewScene.backgroundIntensity).toBe(1)
    expect(previewScene.environmentIntensity).toBe(1)
    expect(previewScene.getObjectByName('Blendlink Preview World')).toBeUndefined()
    expect(sceneDescriptor.authoringPreview?.world).toBe(world)
    const disposeEnvironment = vi.spyOn(environment, 'dispose')

    preview.dispose()
    expect(previewScene.background).toBe(previousBackground)
    expect(previewScene.environment).toBe(previousEnvironment)
    expect(previewScene.backgroundIntensity).toBe(1.75)
    expect(previewScene.environmentIntensity).toBe(0.625)
    expect(previewScene.getObjectByName('Blendlink Preview World')).toBeUndefined()
    expect(disposeEnvironment).toHaveBeenCalledOnce()

    preview.dispose()
    expect(disposeEnvironment).toHaveBeenCalledOnce()
  })

  it('keeps published background and environment ownership ahead of the preview World', async () => {
    const scene = new THREE.Scene()
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: {
            toneMapping: 'application', exposure: 0,
            background: 'color', backgroundColor: [0.7, 0.6, 0.5],
          },
          environment: {
            source: 'application', lighting: 'none', background: 'none',
            lightingIntensity: 1, lightingRotation: 0,
            backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
            groundHeight: 0, groundRadius: 10,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: false },
            world: {
              color: [0.1, 0.2, 0.3], strength: 3, exact: true, source: 'background',
            },
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene,
        useAuthoringPreview: true,
      },
    )

    expect((scene.background as THREE.Color).toArray()).toEqual([0.7, 0.6, 0.5])
    expect(scene.environment).toBeNull()
    expect(scene.getObjectByName('Blendlink Preview World')).toBeUndefined()
    installed.dispose()
  })

  it('uses a Film Transparent World for lighting without drawing it behind the scene', async () => {
    const scene = new THREE.Scene()
    const previousBackground = new THREE.Color(0x112233)
    scene.background = previousBackground
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'application', exposure: 0, background: 'application' },
          environment: {
            source: 'application', lighting: 'application', background: 'application',
            lightingIntensity: 1, lightingRotation: 0,
            backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
            groundHeight: 0, groundRadius: 10,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: false },
            world: {
              color: [0.3, 0.2, 0.1], strength: 2, exact: true,
              source: 'background', backgroundVisible: false,
            },
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene,
        useAuthoringPreview: true,
      },
    )

    expect(scene.background).toBe(previousBackground)
    expect(scene.environment).toBeInstanceOf(THREE.DataTexture)
    expect(Array.from((scene.environment as THREE.DataTexture).image.data.slice(0, 4))).toEqual([
      expect.closeTo(0.6), expect.closeTo(0.4), expect.closeTo(0.2), 1,
    ])
    installed.dispose()
    expect(scene.background).toBe(previousBackground)
    expect(scene.environment).toBeNull()
  })

  it('does not warn about a hidden procedural World background when image lighting owns the look', async () => {
    const warnings: string[] = []
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'application', exposure: 0, background: 'application' },
          environment: {
            // A published image source blocks Blender-World lighting even
            // while the downstream lighting slot remains application-owned.
            source: 'image', lighting: 'application', background: 'application',
            lightingIntensity: 1, lightingRotation: 0,
            backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
            groundHeight: 0, groundRadius: 10,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: false },
            worldBackgroundVisible: false,
            worldWarning: 'Blender World preview omitted: procedural graph',
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
        onWarning: (message) => warnings.push(message),
      },
    )

    expect(warnings).toEqual([])
    installed.dispose()
  })

  it('resolves preview World background and lighting ownership independently', async () => {
    const scene = new THREE.Scene()
    const originalBackground = new THREE.Color(0x010203)
    scene.background = originalBackground
    scene.backgroundIntensity = 1.75
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'application', exposure: 0, background: 'application' },
          environment: {
            // A published image source blocks source-World lighting even if
            // the lighting slot itself remains application-owned.
            source: 'image', lighting: 'application', background: 'application',
            lightingIntensity: 1, lightingRotation: 0,
            backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
            groundHeight: 0, groundRadius: 10,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: false },
            world: {
              color: [0.2, 0.3, 0.4], strength: 0.5, exact: true, source: 'world-color',
            },
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene,
        useAuthoringPreview: true,
      },
    )

    const background = scene.background as THREE.DataTexture
    expect(background).toBeInstanceOf(THREE.DataTexture)
    expect(background.mapping).toBe(THREE.EquirectangularReflectionMapping)
    expect(Array.from(background.image.data.slice(0, 4))).toEqual([
      expect.closeTo(0.1), expect.closeTo(0.15), expect.closeTo(0.2), 1,
    ])
    expect(scene.getObjectByName('Blendlink Preview World')).toBeUndefined()

    const laterBackground = new THREE.Color(0xabcdef)
    scene.background = laterBackground
    scene.backgroundIntensity = 1
    const disposeBackground = vi.spyOn(background, 'dispose')
    installed.dispose()
    expect(scene.background).toBe(laterBackground)
    expect(scene.backgroundIntensity).toBe(1)
    expect(disposeBackground).toHaveBeenCalledOnce()
  })

  it('does not dispose a preview World texture adopted by a later application owner', async () => {
    const scene = new THREE.Scene()
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'application', exposure: 0, background: 'application' },
          environment: {
            source: 'image', lighting: 'application', background: 'application',
            lightingIntensity: 1, lightingRotation: 0,
            backgroundIntensity: 1, backgroundRotation: 0, backgroundBlur: 0,
            groundHeight: 0, groundRadius: 10,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: false },
            world: {
              color: [0.15, 0.2, 0.25], strength: 1, exact: true, source: 'background',
            },
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene,
        useAuthoringPreview: true,
      },
    )

    const texture = scene.background as THREE.DataTexture
    const disposeTexture = vi.spyOn(texture, 'dispose')
    // The published image source prevented Blendlink from owning Environment,
    // so this assignment is unambiguously a later application transfer.
    scene.environment = texture
    scene.background = new THREE.Color(0xabcdef)
    installed.dispose()

    expect(scene.environment).toBe(texture)
    expect(disposeTexture).not.toHaveBeenCalled()
  })

  it('uses the Blender authoring look only for an opted-in application-owned preview', async () => {
    const root = new THREE.Group()
    const light = new THREE.DirectionalLight()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(light, mesh)
    const loaded = await loader(root).loadAsync()
    const sceneDescriptor = descriptor({
      look: { toneMapping: 'application', exposure: 0, background: 'application' },
      authoringPreview: {
        look: {
          toneMapping: 'agx', exposure: -1, previewExposureOffsetStops: -0.28,
          sourceViewTransform: 'AgX', exact: false,
        },
        shadows: { enabled: true },
        warnings: ['Blender display device is approximated'],
      },
    })

    const productionRenderer = renderer()
    const productionWarnings: string[] = []
    const production = await installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: productionRenderer as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        onWarning: (message) => productionWarnings.push(message),
      },
    )
    expect(productionRenderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(productionRenderer.toneMappingExposure).toBe(0.5)
    expect(productionRenderer.shadowMap.enabled).toBe(false)
    expect(light.castShadow).toBe(false)
    expect(mesh).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(productionWarnings).toEqual([])
    production.dispose()

    const previewRenderer = renderer()
    const previewWarnings: string[] = []
    const preview = await installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: previewRenderer as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
        onWarning: (message) => previewWarnings.push(message),
      },
    )
    expect(previewRenderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(previewRenderer.toneMappingExposure).toBeCloseTo(2 ** -1.28)
    expect(previewWarnings).toEqual(['Blender display device is approximated'])
    preview.dispose()
    expect(previewRenderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(previewRenderer.toneMappingExposure).toBe(0.5)
  })

  it('uses Three LinearToneMapping so Standard authoring exposure is actually rendered', async () => {
    const sceneDescriptor = descriptor({
      look: { toneMapping: 'application', exposure: 0, background: 'application' },
      authoringPreview: {
        look: {
          toneMapping: 'none', exposure: 1.5, sourceViewTransform: 'Standard', exact: true,
        },
        shadows: { enabled: false },
      },
    })

    const productionRenderer = renderer()
    const production = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: productionRenderer as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
      },
    )
    expect(productionRenderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(productionRenderer.toneMappingExposure).toBe(0.5)
    production.dispose()

    const previewRenderer = renderer()
    const preview = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: sceneDescriptor,
        renderer: previewRenderer as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
      },
    )
    expect(previewRenderer.toneMapping).toBe(THREE.LinearToneMapping)
    expect(previewRenderer.toneMappingExposure).toBeCloseTo(2 ** 1.5)

    preview.dispose()
    expect(previewRenderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(previewRenderer.toneMappingExposure).toBe(0.5)
  })

  it('warns when a non-Standard no-tone-mapping preview cannot render exposure', async () => {
    const webgl = renderer()
    const warnings: string[] = []
    const installed = await installLoadedThreeCompiledScene(
      await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'application', exposure: 0, background: 'application' },
          authoringPreview: {
            look: {
              toneMapping: 'none', exposure: 1, sourceViewTransform: 'Raw', exact: false,
            },
            shadows: { enabled: false },
          },
        }),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
        onWarning: (message) => warnings.push(message),
      },
    )

    expect(webgl.toneMapping).toBe(THREE.NoToneMapping)
    expect(warnings).toEqual([
      expect.stringMatching(/Raw exposure cannot be represented.*does not affect this preview/),
    ])
    installed.dispose()
  })

  it('previews application-owned Blender shadows and lifecycle-safely defaults only untagged meshes', async () => {
    const root = new THREE.Group()
    const light = new THREE.DirectionalLight()
    light.name = 'Key'
    const disabledLight = new THREE.DirectionalLight()
    disabledLight.name = 'Fill'
    disabledLight.userData.blendlink_cast_shadow = false
    const untagged = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    untagged.name = 'Untagged'
    const tagged = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    tagged.name = 'Tagged_Primitive_A'
    const taggedB = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshStandardMaterial())
    taggedB.name = 'Tagged_Primitive_B'
    const taggedGroup = new THREE.Group()
    taggedGroup.name = 'Tagged'
    taggedGroup.add(tagged, taggedB)
    root.add(light, disabledLight, untagged, taggedGroup)
    const webgl = renderer()
    const warnings: string[] = []
    const loadedWithLegacyBindings = Object.assign(await loader(root).loadAsync(), {
      // Compatibility fixture for cache/application-owned bindings created
      // before SceneBindings.shadowIntent was added.
      blendlink: {
        byName: { TaggedAlias: taggedGroup },
        byId: {},
        object(name: string) {
          if (name === 'Tagged') return taggedGroup
          throw new Error(`missing ${name}`)
        },
        dispose() {},
      },
    })
    const installed = await installLoadedThreeCompiledScene(
      loadedWithLegacyBindings as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          nodes: { TaggedAlias: 'Tagged' },
          extras: {
            Tagged: { blendlink_cast_shadow: false, blendlink_receive_shadow: false },
          },
          shadows: {
            preset: 'application', filter: 'vsm', mapSize: 2048, maxDistance: 75,
            bias: -0.001, normalBias: 0.04, radius: 3, autoUpdate: false,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: 0, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: true },
            warnings: ['This authoring look is approximate'],
          },
        }),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
        onWarning: (message) => warnings.push(message),
      },
    )

    expect(webgl.shadowMap).toEqual({
      enabled: true, autoUpdate: false, needsUpdate: true, type: THREE.VSMShadowMap,
    })
    expect(light.castShadow).toBe(true)
    expect(disabledLight.castShadow).toBe(false)
    expect(installed.shadows.lightsConfigured).toBe(1)
    expect(light.shadow.mapSize.toArray()).toEqual([2048, 2048])
    expect(light.shadow).toMatchObject({ bias: -0.001, normalBias: 0.04, radius: 3 })
    expect(light.shadow.camera.far).toBe(75)
    expect(untagged).toMatchObject({ castShadow: true, receiveShadow: true })
    expect(tagged).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(taggedB).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(warnings).toEqual([])

    untagged.castShadow = false // a later owner wins
    installed.dispose()
    expect(untagged).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(tagged).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(taggedB).toMatchObject({ castShadow: false, receiveShadow: false })
    expect(light.castShadow).toBe(false)
    expect(webgl.shadowMap).toEqual({ enabled: false, autoUpdate: false, needsUpdate: false, type: 0 })
  })

  it('keeps explicit published look and shadow ownership ahead of authoring evidence', async () => {
    const root = new THREE.Group()
    const light = new THREE.DirectionalLight()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    root.add(light, mesh)
    const webgl = renderer()
    const installed = await installLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          look: { toneMapping: 'neutral', exposure: 2, background: 'application' },
          shadows: {
            preset: 'off', filter: 'vsm', mapSize: 4096, maxDistance: 100,
            bias: -0.002, normalBias: 0.08, radius: 6, autoUpdate: false,
          },
          authoringPreview: {
            look: {
              toneMapping: 'agx', exposure: -2, sourceViewTransform: 'AgX', exact: true,
            },
            shadows: { enabled: true },
          },
        }),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        useAuthoringPreview: true,
      },
    )

    expect(webgl.toneMapping).toBe(THREE.NeutralToneMapping)
    expect(webgl.toneMappingExposure).toBe(4)
    expect(webgl.shadowMap.enabled).toBe(false)
    expect(light.castShadow).toBe(false)
    expect(mesh).toMatchObject({ castShadow: false, receiveShadow: false })
    installed.dispose()
  })

  it('rejects WebGPU and renderer-like objects before loading scene assets', async () => {
    await expect(installThreeCompiledScene({
      descriptor: descriptor(),
      renderer: { isWebGPURenderer: true } as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(new THREE.Group()) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })).rejects.toThrow(/requires Three WebGLRenderer.*WebGPURenderer/s)
  })

  it('preserves application-owned KTX2 and Meshopt decoders on a supplied GLTFLoader', async () => {
    const root = new THREE.Group()
    const loaded = await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF
    const sceneLoader = new GLTFLoader()
    const applicationKtx2Loader = { dispose: vi.fn() } as unknown as KTX2Loader
    const applicationMeshoptDecoder = {
      supported: true,
      ready: Promise.resolve(),
      decodeGltfBuffer() {},
    }
    sceneLoader.setKTX2Loader(applicationKtx2Loader)
    sceneLoader.setMeshoptDecoder(applicationMeshoptDecoder)
    const loadAsync = vi.spyOn(sceneLoader, 'loadAsync').mockResolvedValue(loaded)

    const installed = await installThreeCompiledScene({
      descriptor: descriptor({ requiresKtx2: true, requiresMeshopt: true }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: sceneLoader,
      prewarm: false,
    })

    expect(loadAsync).toHaveBeenCalledOnce()
    expect(sceneLoader.ktx2Loader).toBe(applicationKtx2Loader)
    expect(sceneLoader.meshoptDecoder).toBe(applicationMeshoptDecoder)
    installed.dispose()
    expect(applicationKtx2Loader.dispose).not.toHaveBeenCalled()
  })

  it('lets paired explicit options replace supplied-loader decoders without taking disposal ownership', async () => {
    const loaded = await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF
    const sceneLoader = new GLTFLoader()
    const existingKtx2Loader = { dispose: vi.fn() } as unknown as KTX2Loader
    const explicitKtx2Loader = { dispose: vi.fn() } as unknown as KTX2Loader
    const existingMeshoptDecoder = {
      supported: true, ready: Promise.resolve(), decodeGltfBuffer() {},
    }
    const explicitMeshoptDecoder = {
      supported: true, ready: Promise.resolve(), decodeGltfBuffer() {},
    }
    sceneLoader.setKTX2Loader(existingKtx2Loader)
    sceneLoader.setMeshoptDecoder(existingMeshoptDecoder)
    vi.spyOn(sceneLoader, 'loadAsync').mockResolvedValue(loaded)

    const installed = await installThreeCompiledScene({
      descriptor: descriptor({ requiresKtx2: true, requiresMeshopt: true }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: sceneLoader,
      ktx2Loader: explicitKtx2Loader,
      meshoptDecoder: explicitMeshoptDecoder,
      prewarm: false,
    })

    expect(sceneLoader.ktx2Loader).toBe(explicitKtx2Loader)
    expect(sceneLoader.meshoptDecoder).toBe(explicitMeshoptDecoder)
    installed.dispose()
    expect(existingKtx2Loader.dispose).not.toHaveBeenCalled()
    expect(explicitKtx2Loader.dispose).not.toHaveBeenCalled()
  })

  it('rejects package worker policy for an application-owned Meshopt decoder', async () => {
    const loaded = await loader(new THREE.Group()).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF
    const sceneLoader = new GLTFLoader()
    const applicationMeshoptDecoder = {
      supported: true,
      ready: Promise.resolve(),
      decodeGltfBuffer() {},
    }
    sceneLoader.setMeshoptDecoder(applicationMeshoptDecoder)
    const loadAsync = vi.spyOn(sceneLoader, 'loadAsync').mockResolvedValue(loaded)

    await expect(installThreeCompiledScene({
      descriptor: descriptor({ requiresMeshopt: true }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: sceneLoader,
      meshoptWorkerCount: 2,
    })).rejects.toThrow(/meshoptDecoder is application-owned.*meshoptWorkerCount/s)

    expect(loadAsync).not.toHaveBeenCalled()
    expect(sceneLoader.meshoptDecoder).toBe(applicationMeshoptDecoder)
  })

  it('terminates a package KTX2 worker on CSP failure and disposes a late GLTF result once', async () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const texture = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: texture })
    root.add(new THREE.Mesh(geometry, material))
    const lateLoaded = await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF
    const disposal = { geometry: 0, material: 0, texture: 0 }
    geometry.addEventListener('dispose', () => { disposal.geometry += 1 })
    material.addEventListener('dispose', () => { disposal.material += 1 })
    texture.addEventListener('dispose', () => { disposal.texture += 1 })
    const pendingLoad = deferred<import('three/addons/loaders/GLTFLoader.js').GLTF>()
    const loadAsync = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockReturnValue(pendingLoad.promise)
    const disposeKtx2 = vi.spyOn(KTX2Loader.prototype, 'dispose')
    const cspTarget = new EventTarget()
    vi.stubGlobal('addEventListener', cspTarget.addEventListener.bind(cspTarget))
    vi.stubGlobal('removeEventListener', cspTarget.removeEventListener.bind(cspTarget))

    try {
      const installation = installThreeCompiledScene({
        descriptor: descriptor({ requiresKtx2: true }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        prewarm: false,
      })
      const rejection = expect(installation).rejects.toThrow(
        /KTX2 decoder worker was blocked by Content Security Policy/,
      )
      await vi.waitFor(() => expect(loadAsync).toHaveBeenCalledOnce())
      const violation = new Event('securitypolicyviolation')
      Object.defineProperties(violation, {
        blockedURI: { value: 'blob:http://localhost/basis-worker' },
        disposition: { value: 'enforce' },
        effectiveDirective: { value: 'worker-src' },
      })
      cspTarget.dispatchEvent(violation)

      await rejection
      expect(disposeKtx2).toHaveBeenCalledOnce()
      expect(disposal).toEqual({ geometry: 0, material: 0, texture: 0 })

      pendingLoad.resolve(lateLoaded)
      await vi.waitFor(() => expect(disposal).toEqual({ geometry: 1, material: 1, texture: 1 }))
      expect(disposeKtx2).toHaveBeenCalledOnce()
    } finally {
      pendingLoad.resolve(lateLoaded)
      vi.unstubAllGlobals()
      disposeKtx2.mockRestore()
      loadAsync.mockRestore()
    }
  })

  it('observes a rejected GLTF load that settles after the primary KTX2 CSP failure', async () => {
    const pendingLoad = deferred<import('three/addons/loaders/GLTFLoader.js').GLTF>()
    const loadAsync = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockReturnValue(pendingLoad.promise)
    const disposeKtx2 = vi.spyOn(KTX2Loader.prototype, 'dispose')
    const cspTarget = new EventTarget()
    vi.stubGlobal('addEventListener', cspTarget.addEventListener.bind(cspTarget))
    vi.stubGlobal('removeEventListener', cspTarget.removeEventListener.bind(cspTarget))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)

    try {
      const installation = installThreeCompiledScene({
        descriptor: descriptor({ requiresKtx2: true }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        prewarm: false,
      })
      const rejection = expect(installation).rejects.toThrow(
        /KTX2 decoder worker was blocked by Content Security Policy/,
      )
      await vi.waitFor(() => expect(loadAsync).toHaveBeenCalledOnce())
      const violation = new Event('securitypolicyviolation')
      Object.defineProperties(violation, {
        blockedURI: { value: 'blob:http://localhost/basis-worker' },
        disposition: { value: 'enforce' },
        effectiveDirective: { value: 'worker-src' },
      })
      cspTarget.dispatchEvent(violation)

      await rejection
      pendingLoad.reject(new Error('abandoned GLTF load rejected after CSP failure'))
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
      expect(disposeKtx2).toHaveBeenCalledOnce()
    } finally {
      process.off('unhandledRejection', onUnhandled)
      pendingLoad.reject(new Error('test cleanup'))
      vi.unstubAllGlobals()
      disposeKtx2.mockRestore()
      loadAsync.mockRestore()
    }
  })

  it('owns a convention-based KTX2 loader through the complete one-call lifecycle', async () => {
    expect(threeKtx2TranscoderPath('/scenes/hero.glb?v=bytes#view')).toBe('/scenes/blendlink-basis/')
    expect(threeKtx2TranscoderPath('hero.glb')).toBe('blendlink-basis/')
    expect(threeKtx2TranscoderPath(
      '/releases/graph-sha/scenes/hero.glb?v=bytes',
      descriptor({
        url: '/releases/graph-sha/scenes/hero.glb?v=bytes',
        runtimeAssetGraph: {
          algorithm: 'sha256',
          fingerprint: 'graph-sha',
          entries: [
            { path: 'scenes/hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
            {
              path: 'blendlink-basis/basis_transcoder.wasm',
              role: 'basis-runtime',
              bytes: 1,
              sha256: 'wasm',
            },
          ],
        },
      }),
    )).toBe('/releases/graph-sha/blendlink-basis/')
    expect(() => threeKtx2TranscoderPath('/scenes/')).toThrow(/ending in the generated \.glb/)

    const root = new THREE.Group()
    let configured: KTX2Loader | undefined
    const sceneLoader = {
      ...loader(root),
      setKTX2Loader(value: KTX2Loader) { configured = value },
    }
    const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose')
    try {
      const installed = await installThreeCompiledScene({
        descriptor: descriptor({
          url: '/releases/graph-sha/scenes/hero.glb?v=bytes',
          requiresKtx2: true,
          runtimeAssetGraph: {
            algorithm: 'sha256',
            fingerprint: 'graph-sha',
            entries: [
              { path: 'scenes/hero.glb', role: 'scene', bytes: 1, sha256: 'glb' },
              {
                path: 'blendlink-basis/basis_transcoder.wasm',
                role: 'basis-runtime',
                bytes: 1,
                sha256: 'wasm',
              },
            ],
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        loader: sceneLoader as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      })
      expect(configured).toBeInstanceOf(KTX2Loader)
      expect((configured as unknown as { transcoderPath: string }).transcoderPath)
        .toBe('/releases/graph-sha/blendlink-basis/')
      expect(dispose).not.toHaveBeenCalled()
      installed.dispose()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      dispose.mockRestore()
    }
  })

  it('configures Meshopt from decoded-GLB intent through the one-call installer', async () => {
    const root = new THREE.Group()
    let decoder: unknown
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({ requiresMeshopt: true }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: {
        ...loader(root),
        setMeshoptDecoder(value: unknown) { decoder = value },
      } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })
    expect(decoder).toBeDefined()
    installed.dispose()
  })

  it('reports the automatic transcoder path when a KTX2 GLB cannot load', async () => {
    const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose')
    try {
      await expect(installThreeCompiledScene({
        descriptor: descriptor({
          url: '/scenes/hero.glb?v=bytes',
          textureCompression: { format: 'ktx2' },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        loader: {
          setKTX2Loader() {},
          async loadAsync() { throw new Error('basis_transcoder.wasm returned 404') },
        } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      })).rejects.toThrow(/"\/scenes\/blendlink-basis\/".*blendlink sync.*basis_transcoder\.wasm returned 404/)
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      dispose.mockRestore()
    }
  })

  it('loads, applies authored presentation, updates, resizes, and restores through one handle', async () => {
    const root = new THREE.Group()
    root.name = 'Hero'
    const geometry = new THREE.BoxGeometry(2, 2, 2)
    const texture = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: texture })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'HeroMesh'
    root.add(mesh)
    const disposed = { geometry: 0, material: 0, texture: 0 }
    geometry.addEventListener('dispose', () => { disposed.geometry += 1 })
    material.addEventListener('dispose', () => { disposed.material += 1 })
    texture.addEventListener('dispose', () => { disposed.texture += 1 })
    const world = new THREE.Scene()
    const originalBackground = new THREE.Color(0.01, 0.01, 0.01)
    const originalFog = new THREE.Fog(0x111111, 1, 100)
    world.background = originalBackground
    world.fog = originalFog
    const webgl = renderer()

    const installed = await installThreeCompiledScene({
      descriptor: descriptor({
        nodes: { HeroMesh: 'HeroMesh' },
        extras: { HeroMesh: { blendlink_active: false } },
      }),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      viewport: { width: 800, height: 500 },
    })

    expect(root.parent).toBe(world)
    expect(mesh.visible).toBe(false)
    expect(installed.root).toBe(root)
    expect(installed.camera).toBeInstanceOf(THREE.PerspectiveCamera)
    expect(world.background).toBeInstanceOf(THREE.Color)
    expect(world.background).not.toBe(originalBackground)
    expect(world.fog).toBeInstanceOf(THREE.Fog)
    expect(webgl.toneMapping).toBe(THREE.NeutralToneMapping)
    expect(webgl.toneMappingExposure).toBe(2)
    expect(webgl.sizes.at(-1)).toEqual([800, 500, false])
    expect(texture.anisotropy).toBe(4)

    installed.update(1 / 60)
    installed.resize(400, 200)
    expect((installed.camera as THREE.PerspectiveCamera).aspect).toBe(2)
    expect(webgl.sizes.at(-1)).toEqual([400, 200, false])

    installed.dispose()
    installed.dispose()
    expect(root.parent).toBeNull()
    expect(world.background).toBe(originalBackground)
    expect(world.fog).toBe(originalFog)
    expect(webgl.toneMapping).toBe(THREE.NoToneMapping)
    expect(webgl.toneMappingExposure).toBe(0.5)
    expect(mesh.visible).toBe(true)
    expect(texture.anisotropy).toBe(1)
    expect(disposed).toEqual({ geometry: 1, material: 1, texture: 1 })
    expect(() => installed.update(0)).toThrow(/disposed/)
  })

  it('leaves resources caller-owned at the already-loaded cache seam', async () => {
    const root = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const texture = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: texture })
    root.add(new THREE.Mesh(geometry, material))
    const geometryDisposed = vi.fn()
    const materialDisposed = vi.fn()
    geometry.addEventListener('dispose', geometryDisposed)
    material.addEventListener('dispose', materialDisposed)
    const loaded = await loader(root).loadAsync()
    const webgl = renderer()
    const world = new THREE.Scene()
    const installed = await installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor(),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: world,
      },
    )
    expect(installed.components.count).toBe(0)
    expect(texture.anisotropy).toBe(1)
    expect(installed.textureSampling).toMatchObject({
      policy: 'authored',
      changedTextures: 0,
    })
    installed.render()
    expect(webgl.render).toHaveBeenCalledWith(world, installed.camera)
    installed.dispose()
    expect(geometryDisposed).not.toHaveBeenCalled()
    expect(materialDisposed).not.toHaveBeenCalled()
  })

  it('applies and restores an explicit Needle-matching cache sampling lease', async () => {
    const texture = new THREE.Texture()
    const root = new THREE.Group()
    root.add(new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ map: texture }),
    ))
    const installed = await installLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor(),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        textureAnisotropy: 4,
        prewarm: false,
      },
    )

    expect(texture.anisotropy).toBe(4)
    expect(installed.textureSampling).toMatchObject({
      policy: 4,
      requestedAnisotropy: 4,
      appliedAnisotropy: 4,
      changedTextures: 1,
    })

    installed.dispose()
    expect(texture.anisotropy).toBe(1)
  })

  it('keeps baked states and Appearance light layers connected through reflection material clones', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-baked-reflection-'))
    try {
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }))
      const threeModuleUrl = pathToFileURL(
        createRequire(import.meta.url).resolve('three').replace(/three\.cjs$/, 'three.module.js'),
      ).href
      writeFileSync(join(directory, 'three-shim.js'), `
        export * from '${threeModuleUrl}'
        import { Texture } from '${threeModuleUrl}'
        export class TextureLoader {
          load(url, onLoad) {
            const texture = new Texture()
            texture.name = String(url)
            texture.userData.url = String(url)
            queueMicrotask(() => onLoad?.(texture))
            return texture
          }
        }
      `)
      writeFileSync(join(directory, 'hero.gen.js'), `export const hero = {
        states: { day: '/day.png?v=day', night: '/night.png?v=night' },
        bakeOutputs: { main: 'appearance' }, stateScales: {},
        lightGroups: { lamp: { url: '/lamp.png?v=lamp', maxValue: 2 } },
        stateVisibility: {}, defaultState: 'day',
      }`)
      const source = renderBakedRecipe('hero')
        .replace("from './hero.gen'", "from './hero.gen.js'")
        .replace("from 'three'", "from './three-shim.js'")
      const output = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText
      const recipePath = join(directory, 'hero.baked.js')
      writeFileSync(recipePath, output)
      const { createBakedScene } = await import(
        `${pathToFileURL(recipePath).href}?test=${Date.now()}`
      ) as { createBakedScene: (root: THREE.Object3D) => ThreeBakedSceneHandle }

      const root = new THREE.Group()
      const embedded = new THREE.Texture()
      embedded.name = 'Embedded Day'
      const original = new THREE.MeshBasicMaterial({ map: embedded })
      original.name = 'Baked Hero'
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original)
      mesh.name = 'Hero'
      mesh.userData = {
        blendlink_id: 'hero-id', blendlink_atlas: 'main',
        blendlink_bake_output: 'appearance',
      }
      const probeObject = new THREE.Object3D()
      probeObject.name = 'Hero Probe'
      probeObject.userData.blendlink_id = 'probe-id'
      root.add(mesh, probeObject)
      const reflectionTexture = new THREE.Texture()
      const disposeReflection = vi.fn()
      const installed = await installLoadedThreeCompiledScene(
        { scene: root, scenes: [root], animations: [] } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
        {
          descriptor: descriptor({
            nodes: { Hero: 'Hero', Probe: 'Hero Probe' },
            objectsById: { 'hero-id': 'Hero', 'probe-id': 'Hero Probe' },
            extras: { Hero: { blendlink_reflection_probe: 'probe-id' } },
            states: { day: '/day.png?v=day', night: '/night.png?v=night' },
            bakeOutputs: { main: 'appearance' },
            lightGroups: { lamp: { url: '/lamp.png?v=lamp', maxValue: 2 } },
            defaultState: 'day',
            reflectionProbes: [{
              id: 'hero', name: 'Hero', objectId: 'probe-id', objectName: 'Hero Probe',
              shape: 'box', source: 'runtime', resolution: 128, samples: 16,
              influence: 5, intensity: 1,
            }],
          }),
          renderer: renderer() as unknown as THREE.WebGLRenderer,
          scene: new THREE.Scene(),
          createBakedScene,
          reflectionProbes: {
            providedTextures: {
              hero: { texture: reflectionTexture, dispose: disposeReflection },
            },
          },
        },
      )

      const reflected = mesh.material as THREE.MeshBasicMaterial
      expect(reflected).not.toBe(original)
      expect(reflected.map).toBe(embedded)
      expect(reflected.envMap).toBe(reflectionTexture)
      expect(installed.setState('night')).toBe(true)
      expect(reflected.map?.userData.url).toBe('/night.png?v=night')
      expect(installed.setState('day')).toBe(true)
      expect(reflected.map).toBe(embedded)

      expect(installed.setLightGroup('lamp', { strength: 0.35 })).toBe(true)
      const shader = {
        uniforms: {} as Record<string, { value: unknown }>,
        fragmentShader: '#include <map_pars_fragment>\n#include <map_fragment>',
      }
      reflected.onBeforeCompile(shader as never, renderer() as never)
      expect(shader.fragmentShader).toContain('blLayerMap0')
      expect(shader.uniforms.blLayerStrength0?.value).toBe(0.35)

      installed.dispose()
      expect(mesh.material).toBe(original)
      expect(original.map).toBe(embedded)
      expect(disposeReflection).toHaveBeenCalledOnce()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('blocks an older baked recipe instead of freezing reflected meshes on the default state', async () => {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = 'Hero'
    mesh.userData.blendlink_id = 'hero-id'
    const probeObject = new THREE.Object3D()
    probeObject.name = 'Probe'
    probeObject.userData.blendlink_id = 'probe-id'
    root.add(mesh, probeObject)
    const legacyHandle: ThreeBakedSceneHandle = {
      ready: Promise.resolve(), lightGroupNames: [],
      setState: () => true, setStateAsync: async () => true,
      setLightGroup: () => false, dispose() {},
    }
    await expect(installLoadedThreeCompiledScene(
      { scene: root, scenes: [root], animations: [] } as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          nodes: { Hero: 'Hero', Probe: 'Probe' },
          objectsById: { 'hero-id': 'Hero', 'probe-id': 'Probe' },
          extras: { Hero: { blendlink_reflection_probe: 'probe-id' } },
          states: { day: '/day.png' }, defaultState: 'day',
          reflectionProbes: [{
            id: 'hero', name: 'Hero', objectId: 'probe-id', objectName: 'Probe',
            shape: 'box', source: 'runtime', resolution: 128, samples: 16,
            influence: 5, intensity: 1,
          }],
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        createBakedScene: () => legacyHandle,
        reflectionProbes: { providedTextures: { hero: { texture: new THREE.Texture() } } },
      },
    )).rejects.toThrow(/recipe update <scene>/)
  })

  it('keeps an authored look background when the environment background is explicitly none', async () => {
    const world = new THREE.Scene()
    const originalBackground = new THREE.Color(0x111111)
    world.background = originalBackground
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({
        environment: {
          source: 'application', imageName: '', lighting: 'none', background: 'none',
          lightingIntensity: 1, lightingRotation: 0, backgroundIntensity: 1,
          backgroundRotation: 0, backgroundBlur: 0, groundHeight: 1, groundRadius: 10,
        },
      }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: loader(new THREE.Group()) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })
    expect(world.background).toBeInstanceOf(THREE.Color)
    expect((world.background as THREE.Color).toArray()).toEqual([0.1, 0.2, 0.3])
    installed.dispose()
    expect(world.background).toBe(originalBackground)
  })

  it('resizes orthographic fallback cameras without stretching and restores owned frustum fields', async () => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
    const installed = await installThreeCompiledScene({
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(new THREE.Group()) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      fallbackCamera: camera,
      viewport: { width: 800, height: 400 },
    })
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([-2, 2, 1, -1])
    installed.resize(200, 400)
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([-0.5, 0.5, 1, -1])
    installed.dispose()
    expect([camera.left, camera.right, camera.top, camera.bottom]).toEqual([-1, 1, 1, -1])
  })

  it('uses free-flight controls for Blender Free cameras and removes their listeners', async () => {
    const browserWindow = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('window', browserWindow)
    const canvas = {
      clientWidth: 640, clientHeight: 360,
      offsetWidth: 640, offsetHeight: 360, offsetLeft: 0, offsetTop: 0,
      style: { touchAction: '' },
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }
    const webgl = renderer()
    webgl.domElement = canvas
    const root = new THREE.Group()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.name = 'FreeCamera'
    camera.userData.blendlink_id = 'free-camera-id'
    root.add(camera)
    try {
      const installed = await installThreeCompiledScene({
        descriptor: descriptor({
          nodes: { FreeCamera: 'FreeCamera' },
          nodeIds: { FreeCamera: 'free-camera-id' },
          objectsById: { 'free-camera-id': 'FreeCamera' },
          camera: {
            objectId: 'free-camera-id', objectName: 'FreeCamera', behavior: 'free',
            framing: 'authored', compositions: [
              { name: 'Desktop', width: 1600, height: 900, safeMargin: 0.1 },
            ],
          },
        }),
        renderer: webgl as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      })
      expect(browserWindow.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
      expect(browserWindow.addEventListener).toHaveBeenCalledWith('keyup', expect.any(Function))
      expect(canvas.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
      camera.position.set(4, 5, 6)
      installed.cameraController?.reset()
      expect(camera.position.toArray()).toEqual([0, 0, 0])
      installed.update(1 / 60)
      installed.dispose()
      expect(browserWindow.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
      expect(canvas.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('lets built-in Orbit controls settle idle and wakes demand rendering on input', async () => {
    const documentListeners = new Map<string, EventListener>()
    const canvasListeners = new Map<string, EventListener>()
    const ownerDocument = {
      addEventListener(type: string, listener: EventListener) {
        documentListeners.set(type, listener)
      },
      removeEventListener(type: string, listener: EventListener) {
        if (documentListeners.get(type) === listener) documentListeners.delete(type)
      },
    }
    const canvas = {
      clientWidth: 640, clientHeight: 360,
      offsetWidth: 640, offsetHeight: 360, offsetLeft: 0, offsetTop: 0,
      style: { touchAction: '', cursor: '' },
      ownerDocument,
      getRootNode: () => ownerDocument,
      addEventListener(type: string, listener: EventListener) {
        canvasListeners.set(type, listener)
      },
      removeEventListener(type: string, listener: EventListener) {
        if (canvasListeners.get(type) === listener) canvasListeners.delete(type)
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 360 }),
      setPointerCapture() {},
      releasePointerCapture() {},
    }
    const webgl = renderer()
    webgl.domElement = canvas
    const root = new THREE.Group()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.name = 'OrbitCamera'
    camera.position.set(0, 0, 6)
    camera.userData.blendlink_id = 'orbit-camera-id'
    const target = new THREE.Object3D()
    target.name = 'OrbitTarget'
    target.userData.blendlink_id = 'orbit-target-id'
    root.add(camera, target)
    const requestFrame = vi.fn()
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({
        nodes: { OrbitCamera: 'OrbitCamera', OrbitTarget: 'OrbitTarget' },
        nodeIds: {
          OrbitCamera: 'orbit-camera-id',
          OrbitTarget: 'orbit-target-id',
        },
        objectsById: {
          'orbit-camera-id': 'OrbitCamera',
          'orbit-target-id': 'OrbitTarget',
        },
        camera: {
          objectId: 'orbit-camera-id', objectName: 'OrbitCamera', behavior: 'orbit',
          framing: 'authored', targetId: 'orbit-target-id', targetName: 'OrbitTarget',
          compositions: [
            { name: 'Desktop', width: 1600, height: 900, safeMargin: 0.1 },
          ],
        },
      }),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      requestFrame,
    })

    expect(installed.cameraController?.interactive).toBe(true)
    expect(installed.cameraController?.requiresContinuousFrames).toBe(false)
    expect(installed.requiresContinuousFrames).toBe(false)

    requestFrame.mockClear()
    const wheel = canvasListeners.get('wheel')
    expect(wheel).toBeTypeOf('function')
    wheel?.({
      deltaY: -100,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as Event)
    expect(requestFrame).toHaveBeenCalled()
    expect(installed.requiresContinuousFrames).toBe(true)

    installed.update(1 / 60)
    expect(installed.requiresContinuousFrames).toBe(false)
    installed.dispose()
    expect(canvasListeners.size).toBe(0)
    expect(documentListeners.size).toBe(0)
  })

  it('accepts an authored camera loaded through a distinct Three module identity', async () => {
    const root = new THREE.Group()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.name = 'PresentationCamera'
    camera.userData.blendlink_id = 'presentation-camera-id'

    // Vite/file-linked packages can evaluate the same Three release twice.
    // Preserve Three's canonical camera flags and behavior while detaching the
    // constructor identity, reproducing that boundary without a second install.
    const cameraPrototype = Object.getPrototypeOf(camera) as object
    const detachedPrototype = Object.create(Object.getPrototypeOf(cameraPrototype)) as object
    Object.defineProperties(detachedPrototype, Object.getOwnPropertyDescriptors(cameraPrototype))
    Object.setPrototypeOf(camera, detachedPrototype)
    expect(camera).not.toBeInstanceOf(THREE.PerspectiveCamera)
    root.add(camera)

    const installed = await installLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          nodes: { PresentationCamera: 'PresentationCamera' },
          nodeIds: { PresentationCamera: 'presentation-camera-id' },
          objectsById: { 'presentation-camera-id': 'PresentationCamera' },
          camera: {
            objectId: 'presentation-camera-id', objectName: 'PresentationCamera',
            behavior: 'fixed', framing: 'authored', compositions: [],
          },
        }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
      },
    )

    expect(installed.camera).toBe(camera)
    installed.resize(800, 400)
    expect(camera.aspect).toBe(2)
    installed.dispose()
  })

  it('requires the portable baked recipe and rolls back before exposing an incomplete scene', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const webgl = renderer()
    await expect(installThreeCompiledScene({
      descriptor: descriptor({ states: { day: '/day.png' }, defaultState: 'day' }),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })).rejects.toThrow(/createBakedScene/)
    expect(root.parent).toBeNull()
  })

  it('passes baked texture ownership policies through the one-call installer', async () => {
    const root = new THREE.Group()
    let received: {
      textureCacheBytes?: number
      atlasDeliveryQuality?: 'authored' | 'adaptive' | number
      loadingManager?: THREE.LoadingManager
    } | undefined
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({ states: { day: '/day.png' }, defaultState: 'day' }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      bakedTextureCacheBytes: 96 * 1024 * 1024,
      bakedAtlasDeliveryQuality: 1024,
      createBakedScene: (_loadedRoot, options) => {
        received = options
        return {
          ready: Promise.resolve(),
          lightGroupNames: [],
          setState: () => true,
          setLightGroup: () => false,
          dispose() {},
        }
      },
    })

    expect(received).toMatchObject({
      textureCacheBytes: 96 * 1024 * 1024,
      atlasDeliveryQuality: 1024,
    })
    expect(received?.loadingManager).toBeInstanceOf(THREE.LoadingManager)
    installed.dispose()
  })

  it('stops attempt progress after installation reaches a terminal ready state', async () => {
    const root = new THREE.Group()
    let manager: THREE.LoadingManager | undefined
    const progress: Array<{ phase: string; item?: string }> = []
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(
      async function () {
        this.manager.itemStart('/hero.glb')
        this.manager.itemEnd('/hero.glb')
        return await loader(root).loadAsync() as never
      },
    )
    try {
      const installed = await installThreeCompiledScene({
        descriptor: descriptor({ states: { day: '/day.png' }, defaultState: 'day' }),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        prewarm: false,
        onProgress: (state) => progress.push(state),
        createBakedScene: (_loadedRoot, options) => {
          manager = options?.loadingManager
          return {
            ready: Promise.resolve(),
            lightGroupNames: [],
            setState: () => true,
            setLightGroup: () => false,
            dispose() {},
          }
        },
      })
      const terminalLength = progress.length
      expect(progress.at(-1)?.phase).toBe('preparing')

      manager!.itemStart('/late-quality.webp')
      manager!.itemEnd('/late-quality.webp')

      expect(progress).toHaveLength(terminalLength)
      installed.dispose()
    } finally {
      load.mockRestore()
    }
  })

  it('propagates default baked-state readiness failures and disposes before scene attachment', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const dispose = vi.fn()
    await expect(installThreeCompiledScene({
      descriptor: descriptor({ states: { day: '/missing-day.png' }, defaultState: 'day' }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      createBakedScene: () => ({
        ready: Promise.reject(new Error(
          'Could not load baked state "day", atlas "main" at "/missing-day.png": HTTP 404',
        )),
        lightGroupNames: [],
        setState: () => false,
        setLightGroup: () => false,
        dispose,
      }),
    })).rejects.toThrow(/state "day".*atlas "main".*missing-day\.png.*404/)
    expect(root.parent).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('omits instance and LOD adapters whose members are hidden by the default baked state', async () => {
    const fixture = visibilityAdapterFixture()
    const hidden = new Set(['instance-a', 'lod-0'])
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({
        states: { day: '/day.png' }, defaultState: 'day',
        stateVisibility: {
          day: { hiddenObjectIds: [...hidden], hiddenObjectNames: [] },
        },
        runtimeDiagnostics: fixture.runtimeDiagnostics,
      }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(fixture.root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      createBakedScene: () => visibilityBakedHandle(
        [fixture.instanceA, fixture.instanceB, fixture.lod0, fixture.lod1],
        { day: hidden },
        'day',
      ),
      instantiateEligibleMeshes: true,
    })
    expect(installed.instances).toBeNull()
    expect(installed.lods).toBeNull()
    expect(fixture.instanceA.visible).toBe(false)
    expect(fixture.lod0.visible).toBe(false)
    installed.update(1 / 60)
    expect(fixture.instanceA.visible).toBe(false)
    expect(fixture.lod0.visible).toBe(false)
    installed.dispose()
  })

  it('keeps frames active while a camera-dependent LOD adapter is installed', async () => {
    const fixture = visibilityAdapterFixture()
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({ sceneDiagnostics: fixture.sceneDiagnostics }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(fixture.root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
    })
    expect(installed.lods).not.toBeNull()
    expect(installed.requiresContinuousFrames).toBe(true)
    installed.dispose()
  })

  it('omits instance and LOD adapters for members hidden only by a later baked state', async () => {
    const fixture = visibilityAdapterFixture()
    const nightHidden = new Set(['instance-b', 'lod-1'])
    const installed = await installThreeCompiledScene({
      descriptor: descriptor({
        states: { day: '/day.png', night: '/night.png' }, defaultState: 'day',
        stateVisibility: {
          day: { hiddenObjectIds: [], hiddenObjectNames: [] },
          night: { hiddenObjectIds: [...nightHidden], hiddenObjectNames: [] },
        },
        runtimeDiagnostics: fixture.runtimeDiagnostics,
      }),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      loader: loader(fixture.root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      createBakedScene: () => visibilityBakedHandle(
        [fixture.instanceA, fixture.instanceB, fixture.lod0, fixture.lod1],
        { day: new Set(), night: nightHidden },
        'day',
      ),
      instantiateEligibleMeshes: true,
    })
    expect(installed.instances).toBeNull()
    expect(installed.lods).toBeNull()
    expect(installed.setState('night')).toBe(true)
    installed.update(1 / 60)
    expect(fixture.instanceB.visible).toBe(false)
    expect(fixture.lod1.visible).toBe(false)
    installed.dispose()
  })

  it('exposes baked state and light controls without leaking their implementation', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const webgl = renderer()
    const calls: string[] = []
    let resolveReady!: () => void
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
    const baked: ThreeBakedSceneHandle = {
      ready,
      lightGroupNames: ['lamp'],
      setState(name) { calls.push(`state:${name}`); return name === 'day' },
      async setStateAsync(name) { calls.push(`state-async:${name}`); return name === 'night' },
      setLightGroup(name, options) {
        calls.push(`light:${name}:${options?.strength}`)
        return name === 'lamp'
      },
      dispose() { calls.push('dispose') },
    }
    const installing = installThreeCompiledScene({
      descriptor: descriptor({
        states: { day: '/day.png' },
        lightGroups: { lamp: { url: '/lamp.png', maxValue: 2 } },
        defaultState: 'day',
      }),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: world,
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      createBakedScene: () => baked,
    })
    await Promise.resolve()
    expect(root.parent).toBeNull()
    resolveReady()
    const installed = await installing
    expect(root.parent).toBe(world)
    expect(installed.setState('day')).toBe(true)
    await expect(installed.setStateAsync('night')).resolves.toBe(true)
    expect(installed.setLightGroup('lamp', { strength: 0.5 })).toBe(true)
    installed.dispose()
    expect(calls).toEqual(['state:day', 'state-async:night', 'light:lamp:0.5', 'dispose'])
  })

  it('keeps Rect Area installation atomic through reflection capture, Components, and shader compilation', async () => {
    const events: string[] = []
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const source = rectAreaMarker()
    const probe = new THREE.Object3D()
    probe.name = 'Room Probe'
    probe.userData.blendlink_id = 'probe-id'
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    receiver.name = 'Desk'
    receiver.userData.blendlink_id = 'desk-id'
    root.add(source, probe, receiver)

    source.addEventListener('childadded', ((event: { child: THREE.Object3D }) => {
      if ((event.child as THREE.RectAreaLight).isRectAreaLight) events.push('light')
    }) as never)
    world.addEventListener('childadded', ((event: { child: THREE.Object3D }) => {
      if (event.child === root) events.push('root')
    }) as never)

    let componentReceiver: THREE.Mesh | null = null
    const webgl = rectAreaRenderer()
    webgl.initTexture.mockImplementation(() => { events.push('ltc') })
    webgl.compileAsync = vi.fn(async (compiled: THREE.Object3D) => {
      events.push('compile')
      expect(compiled).toBe(world)
      expect(source.children.filter(
        (child) => (child as THREE.RectAreaLight).isRectAreaLight,
      )).toHaveLength(1)
      expect(componentReceiver?.parent).toBe(root)
      const materials = new Set<THREE.Material>()
      root.traverse((object) => {
        const material = (object as THREE.Mesh).material
        if (!material) return
        for (const item of Array.isArray(material) ? material : [material]) materials.add(item)
      })
      expect([...materials].filter(
        (material) => (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true,
      )).toHaveLength(2)
    })

    const loaded = await loader(root).loadAsync()
    const installing = installLoadedThreeCompiledScene(
      loaded as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor({
          nodes: { Desk: 'Desk', RoomProbe: 'Room Probe' },
          objectsById: { 'desk-id': 'Desk', 'probe-id': 'Room Probe' },
          extras: { Desk: { blendlink_reflection_probe: 'probe-id' } },
          reflectionProbes: [{
            id: 'room', name: 'Room', objectId: 'probe-id', objectName: 'Room Probe',
            shape: 'box', source: 'runtime', resolution: 128, samples: 16,
            influence: 5, intensity: 1,
          }],
          components: [{
            id: 'component-receiver', type: 'studio.receiver', schemaVersion: 1,
            enabled: true, target: { kind: 'scene' }, values: {},
          }],
        }),
        renderer: webgl,
        scene: world,
        reflectionProbes: {
          capture: async () => {
            events.push('capture')
            expect(root.parent).toBe(world)
            expect(source.children.some(
              (child) => (child as THREE.RectAreaLight).isRectAreaLight,
            )).toBe(true)
            return { texture: new THREE.Texture() }
          },
        },
        componentAdapters: {
          'studio.receiver': ({ root: componentRoot }) => {
            events.push('component')
            componentReceiver = new THREE.Mesh(
              new THREE.BoxGeometry(),
              new THREE.MeshStandardMaterial(),
            )
            componentReceiver.name = 'Component Receiver'
            componentRoot.add(componentReceiver)
            return {
              dispose() {
                componentReceiver?.removeFromParent()
                componentReceiver = null
              },
            }
          },
        },
      },
    )

    // installLoaded... has already crossed into the awaited LTC preparation,
    // but neither the package-owned light nor the loaded root is observable.
    expect(root.parent).toBeNull()
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(false)

    const installed = await installing
    const first = (name: string) => events.indexOf(name)
    expect(events.filter((event) => event === 'ltc')).toHaveLength(2)
    expect(first('ltc')).toBeLessThan(first('light'))
    expect(first('light')).toBeLessThan(first('root'))
    expect(first('root')).toBeLessThan(first('capture'))
    expect(first('capture')).toBeLessThan(first('component'))
    expect(first('component')).toBeLessThan(first('compile'))
    expect(installed.rectAreaLights).toEqual({
      lightsConfigured: 1,
      supportedReceiverCount: 2,
      unsupportedReceiverCount: 0,
    })
    expect(Object.isFrozen(installed.rectAreaLights)).toBe(true)

    installed.dispose()
    expect(root.parent).toBeNull()
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(false)
  })

  it('keeps Rect Area LTC lazy when prewarm is false and skips the shader barrier', async () => {
    const root = new THREE.Group()
    const source = rectAreaMarker('Area_Lazy')
    root.add(source)
    const webgl = rectAreaRenderer()
    webgl.compileAsync = vi.fn(async () => {})

    const installed = await installLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      {
        descriptor: descriptor(), renderer: webgl, scene: new THREE.Scene(), prewarm: false,
        onWarning: vi.fn(),
      },
    )

    expect(webgl.initTexture).not.toHaveBeenCalled()
    expect(webgl.compileAsync).not.toHaveBeenCalled()
    expect(installed.rectAreaLights.lightsConfigured).toBe(1)
    expect(source.children.filter(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toHaveLength(1)
    installed.dispose()
  })

  it('rolls back every scene-owned Rect Area light when compileAsync rejects', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const source = rectAreaMarker('Area_Compile_Failure')
    root.add(source)
    const webgl = rectAreaRenderer()
    webgl.compileAsync = vi.fn(async () => { throw new Error('shader barrier failed') })

    await expect(installLoadedThreeCompiledScene(
      await loader(root).loadAsync() as unknown as import('three/addons/loaders/GLTFLoader.js').GLTF,
      { descriptor: descriptor(), renderer: webgl, scene: world, onWarning: vi.fn() },
    )).rejects.toThrow(/shader barrier failed/)

    expect(root.parent).toBeNull()
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(false)
  })

  it('keeps Rect Area preparation detached and alive until canceled compileAsync settles', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const source = rectAreaMarker('Area_Canceled')
    root.add(source)
    const webgl = rectAreaRenderer()
    let resolveCompile!: () => void
    let markCompileStarted!: () => void
    const compileStarted = new Promise<void>((resolve) => { markCompileStarted = resolve })
    webgl.compileAsync = vi.fn(() => {
      markCompileStarted()
      return new Promise<void>((resolve) => { resolveCompile = resolve })
    })

    const task = startThreeCompiledSceneInstallation({
      descriptor: descriptor(),
      renderer: webgl,
      scene: world,
      loader: loader(root) as unknown as import('three/addons/loaders/GLTFLoader.js').GLTFLoader,
      onWarning: vi.fn(),
    })
    await compileStarted
    const stagingParent = root.parent
    expect(stagingParent).toBeInstanceOf(THREE.Scene)
    expect(stagingParent).not.toBe(world)
    expect(world.children).not.toContain(root)
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(true)

    task.cancel()
    // Three r184 compileAsync is not abortable. Cancellation gates commit but
    // must not dispose the graph while the compiler can still inspect it.
    expect(root.parent).toBe(stagingParent)
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(true)
    resolveCompile()
    await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(root.parent).toBeNull()
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(false)
  })

  it('supports an R3F Strict Mode-style dispose/remount without duplicate lights or new LTC identities', async () => {
    const root = new THREE.Group()
    const world = new THREE.Scene()
    const source = rectAreaMarker('Area_Strict_Mode')
    root.add(source)
    const loaded = await loader(root).loadAsync() as unknown as
      import('three/addons/loaders/GLTFLoader.js').GLTF

    const firstRenderer = rectAreaRenderer()
    firstRenderer.compileAsync = vi.fn(async () => {})
    const first = await installLoadedThreeCompiledScene(loaded, {
      descriptor: descriptor(), renderer: firstRenderer, scene: world, onWarning: vi.fn(),
    })
    const firstLtc = firstRenderer.initTexture.mock.calls.map(([texture]) => texture)
    expect(firstLtc).toHaveLength(2)
    expect(source.children.filter(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toHaveLength(1)
    first.dispose()
    first.dispose()
    expect(root.parent).toBeNull()
    expect(source.children.some(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toBe(false)

    const secondRenderer = rectAreaRenderer()
    secondRenderer.compileAsync = vi.fn(async () => {})
    const second = await installLoadedThreeCompiledScene(loaded, {
      descriptor: descriptor(), renderer: secondRenderer, scene: world, onWarning: vi.fn(),
    })
    const secondLtc = secondRenderer.initTexture.mock.calls.map(([texture]) => texture)
    expect(secondLtc).toEqual(firstLtc)
    expect(source.children.filter(
      (child) => (child as THREE.RectAreaLight).isRectAreaLight,
    )).toHaveLength(1)
    expect(second.rectAreaLights.lightsConfigured).toBe(1)
    second.dispose()
  })
})
