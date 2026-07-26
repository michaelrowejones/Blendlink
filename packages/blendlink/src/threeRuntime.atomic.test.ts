import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { CompiledSceneDescriptor } from './runtime.js'
import {
  assertGltfRuntimeCompatibility,
  BLENDLINK_THREE_R184_COMPILED_PROFILE,
} from './gltfRuntimeCompatibility.js'
import {
  prepareLoadedThreeCompiledScene,
  type ThreeCompiledSceneCommitHost,
} from './threeRuntime.js'

function descriptor(): CompiledSceneDescriptor {
  return {
    url: '/atomic-scene.glb',
    nodes: {},
    playback: { start: 'manual', loop: 'repeat', speed: 1 },
    look: {
      toneMapping: 'neutral',
      // Runtime exposure is 2 ** authoredStops, so one authored stop commits 2.
      exposure: 1,
      background: 'color',
      backgroundColor: [0.1, 0.2, 0.3],
    },
    fog: {
      mode: 'linear',
      color: [0.2, 0.3, 0.4],
      near: 2,
      far: 40,
      density: 0.02,
    },
    shadows: {
      preset: 'off',
      filter: 'pcf',
      mapSize: 1024,
      maxDistance: 50,
      bias: 0,
      normalBias: 0,
      radius: 1,
      autoUpdate: false,
    },
  }
}

function loaded(
  root: THREE.Group,
  json: Record<string, unknown> = { asset: { version: '2.0' } },
): GLTF {
  return {
    scene: root,
    scenes: [root],
    animations: [],
    cameras: [],
    asset: {},
    parser: { json, plugins: {}, extensions: {}, options: {} },
    userData: {},
  } as unknown as GLTF
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderer() {
  let clearAlpha = 0.65
  return {
    isWebGLRenderer: true,
    domElement: {
      clientWidth: 640,
      clientHeight: 360,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.75,
    capabilities: { getMaxAnisotropy() { return 8 } },
    shadowMap: {
      enabled: true,
      autoUpdate: true,
      needsUpdate: false,
      type: THREE.VSMShadowMap,
    },
    extensions: { has() { return false }, get() { return null } },
    setClearAlpha: vi.fn((value: number) => { clearAlpha = value }),
    getClearAlpha: vi.fn(() => clearAlpha),
    getContextAttributes: vi.fn(() => ({ alpha: true })),
    setSize: vi.fn(),
    render: vi.fn(),
    initTexture: vi.fn(),
    compileAsync: vi.fn(async () => {}),
  }
}

function sceneFixture() {
  const root = new THREE.Group()
  root.name = 'Atomic candidate'
  root.add(new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  ))

  const sibling = new THREE.Object3D()
  sibling.name = 'Application sibling'
  const scene = new THREE.Scene()
  scene.add(sibling)
  const background = new THREE.Color(0.8, 0.7, 0.6)
  const fog = new THREE.Fog(0x123456, 3, 90)
  const environment = new THREE.Texture()
  scene.background = background
  scene.fog = fog
  scene.environment = environment
  return { root, sibling, scene, background, fog, environment }
}

function expectApplicationPresentation(
  fixture: ReturnType<typeof sceneFixture>,
  webgl: ReturnType<typeof renderer>,
): void {
  expect(fixture.scene.children).toEqual([fixture.sibling])
  expect(fixture.root.parent).not.toBe(fixture.scene)
  expect(fixture.scene.background).toBe(fixture.background)
  expect(fixture.scene.fog).toBe(fixture.fog)
  expect(fixture.scene.environment).toBe(fixture.environment)
  expect(webgl.toneMapping).toBe(THREE.ACESFilmicToneMapping)
  expect(webgl.toneMappingExposure).toBe(0.75)
  expect(webgl.shadowMap).toMatchObject({
    enabled: true,
    autoUpdate: true,
    type: THREE.VSMShadowMap,
  })
  expect(webgl.getClearAlpha()).toBe(0.65)
  // Canvas sizing remains application-owned even when the prepared camera
  // receives its initial viewport during activation.
  expect(webgl.setSize).not.toHaveBeenCalled()
}

describe('atomic Three scene activation contract', () => {
  it('refuses an unsupported required extension before preparing or committing the root', async () => {
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    const webgl = renderer()

    await expect(prepareLoadedThreeCompiledScene(loaded(root, {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_node_visibility'],
      extensionsRequired: ['KHR_node_visibility'],
    }), {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
    })).rejects.toThrow(
      /runtime\.required-extension-unsupported.*KHR_node_visibility/s,
    )

    expect(root.parent).toBeNull()
    expect(webgl.compileAsync).not.toHaveBeenCalled()
    expect(webgl.render).not.toHaveBeenCalled()
  })

  it('does not treat an application plugin name as semantic capability evidence', async () => {
    const extension = 'EXT_application_registered_atomic_fixture'
    const json = {
      asset: { version: '2.0' },
      extensionsUsed: [extension],
      extensionsRequired: [extension],
    }
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    const webgl = renderer()
    const compiledSupport = BLENDLINK_THREE_R184_COMPILED_PROFILE
      .supportedRequiredExtensions

    expect(compiledSupport.has(extension)).toBe(false)
    const candidate = loaded(root, json)
    candidate.parser.plugins = {
      [extension]: { name: extension },
    } as typeof candidate.parser.plugins

    await expect(prepareLoadedThreeCompiledScene(candidate, {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      prewarm: false,
    })).rejects.toThrow(
      /runtime\.required-extension-unsupported.*EXT_application_registered_atomic_fixture/s,
    )

    expect(root.parent).toBeNull()
    expect(webgl.compileAsync).not.toHaveBeenCalled()
    expect(compiledSupport.has(extension)).toBe(false)
  })

  it('accepts a registered application extension only with an explicit semantic attestation', async () => {
    const extension = 'EXT_application_registered_atomic_fixture'
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    const candidate = loaded(root, {
      asset: { version: '2.0' },
      extensionsUsed: [extension],
      extensionsRequired: [extension],
    })
    candidate.parser.plugins = {
      [extension]: { name: extension },
    } as typeof candidate.parser.plugins

    const prepared = await prepareLoadedThreeCompiledScene(candidate, {
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      prewarm: false,
      gltfRuntimeCapabilities: {
        id: 'application EXT fixture browser adapter',
        supportedRequiredExtensions: new Set([extension]),
      },
    })

    expect(prepared.state).toBe('prepared')
    prepared.dispose()
    expect(root.parent).toBeNull()
  })

  it('requires both a registered pointer plugin and an explicit pointer predicate', async () => {
    const pointer = '/materials/0/pbrMetallicRoughness/baseColorFactor'
    const pointerDocument = {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_animation_pointer'],
      animations: [{
        channels: [{
          sampler: 0,
          target: {
            path: 'pointer',
            extensions: { KHR_animation_pointer: { pointer } },
          },
        }],
      }],
    }
    const unregisteredRoot = new THREE.Group()
    await expect(prepareLoadedThreeCompiledScene(
      loaded(unregisteredRoot, pointerDocument),
      {
        descriptor: descriptor(),
        renderer: renderer() as unknown as THREE.WebGLRenderer,
        scene: new THREE.Scene(),
        prewarm: false,
        gltfRuntimeCapabilities: {
          id: 'application pointer fixture',
          supportedRequiredExtensions: new Set(['KHR_animation_pointer']),
          supportsAnimationPointer: (candidate) => candidate === pointer,
        },
      },
    )).rejects.toThrow(/runtime\.animation-pointer-unsupported/)

    const root = new THREE.Group()
    const candidate = loaded(root, pointerDocument)
    candidate.parser.plugins = {
      KHR_animation_pointer: { name: 'KHR_animation_pointer' },
    } as typeof candidate.parser.plugins
    const prepared = await prepareLoadedThreeCompiledScene(candidate, {
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      prewarm: false,
      gltfRuntimeCapabilities: {
        id: 'browser-verified application pointer fixture',
        supportedRequiredExtensions: new Set(['KHR_animation_pointer']),
        supportsAnimationPointer: (candidatePointer) => candidatePointer === pointer,
      },
    })
    prepared.dispose()
    expect(root.parent).toBeNull()
  })

  it('rejects a parented GLTF root without disturbing its current owner', async () => {
    const root = new THREE.Group()
    const currentOwner = new THREE.Scene()
    currentOwner.add(root)

    await expect(prepareLoadedThreeCompiledScene(loaded(root), {
      descriptor: descriptor(),
      renderer: renderer() as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      prewarm: false,
    })).rejects.toThrow(/detached|parented|exclusive/i)

    expect(root.parent).toBe(currentOwner)
    expect(currentOwner.children).toContain(root)
  })

  it('separates shader preparation from exact-once synchronous presentation', async () => {
    const fixture = sceneFixture()
    const webgl = renderer()
    const compilation = deferred<THREE.Object3D>()
    webgl.compileAsync.mockImplementation((
      compiled: THREE.Object3D,
    ) => compilation.promise.then(() => compiled))
    const hostEvents: string[] = []
    const hostLeaseDispose = vi.fn(() => { hostEvents.push('host:dispose') })
    const host: ThreeCompiledSceneCommitHost = {
      activate(installed) {
        hostEvents.push('host:activate')
        expect(installed.root.parent).toBe(fixture.scene)
        expect(fixture.scene.background).not.toBe(fixture.background)
        expect(fixture.scene.fog).not.toBe(fixture.fog)
        expect(webgl.toneMapping).toBe(THREE.NeutralToneMapping)
        expect(webgl.toneMappingExposure).toBe(2)
        return { dispose: hostLeaseDispose }
      },
      requestFrame() { hostEvents.push('host:frame') },
    }

    const preparing = prepareLoadedThreeCompiledScene(loaded(fixture.root), {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: fixture.scene,
    })

    await vi.waitFor(() => expect(webgl.compileAsync).toHaveBeenCalledOnce())
    expectApplicationPresentation(fixture, webgl)
    expect(hostEvents).toEqual([])
    const [compiled, , targetScene] = webgl.compileAsync.mock.calls[0] as unknown as [
      THREE.Object3D,
      THREE.Camera,
      THREE.Scene | undefined,
    ]
    expect(compiled).not.toBe(fixture.scene)
    expect(targetScene).not.toBe(fixture.scene)

    compilation.resolve(compiled)
    const prepared = await preparing
    expect(prepared.state).toBe('prepared')
    // Three r184 compileAsync only reports shader-program preparation. It does
    // not mean a browser frame has been requested, rendered, or found nonblank.
    expectApplicationPresentation(fixture, webgl)
    expect(webgl.setClearAlpha).not.toHaveBeenCalled()
    expect(webgl.render).not.toHaveBeenCalled()
    expect(hostEvents).toEqual([])

    const installed = prepared.commit(host)
    expect(installed).not.toBeInstanceOf(Promise)
    expect(prepared.state).toBe('committed')
    expect(fixture.root.parent).toBe(fixture.scene)
    expect(fixture.scene.children).toEqual([fixture.sibling, fixture.root])
    expect(fixture.scene.background).not.toBe(fixture.background)
    expect(fixture.scene.fog).not.toBe(fixture.fog)
    expect(fixture.scene.environment).toBe(fixture.environment)
    expect(webgl.toneMapping).toBe(THREE.NeutralToneMapping)
    expect(webgl.toneMappingExposure).toBe(2)
    expect(webgl.shadowMap.enabled).toBe(false)
    expect(webgl.getClearAlpha()).toBe(1)
    expect(hostEvents).toEqual(['host:activate', 'host:frame'])

    expect(() => prepared.commit(host)).toThrow(/commit.*generation 1.*committed/i)
    expect(hostEvents).toEqual(['host:activate', 'host:frame'])

    installed.dispose()
    installed.dispose()
    expect(prepared.state).toBe('disposed')
    expect(hostLeaseDispose).toHaveBeenCalledOnce()
    expectApplicationPresentation(fixture, webgl)
  })

  it('rolls the complete live journal back when host activation rejects', async () => {
    const fixture = sceneFixture()
    const webgl = renderer()
    const requestFrame = vi.fn()
    const prepared = await prepareLoadedThreeCompiledScene(loaded(fixture.root), {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: fixture.scene,
      prewarm: false,
    })

    expectApplicationPresentation(fixture, webgl)
    expect(() => prepared.commit({
      activate() {
        expect(fixture.root.parent).toBe(fixture.scene)
        expect(fixture.scene.background).not.toBe(fixture.background)
        expect(fixture.scene.fog).not.toBe(fixture.fog)
        expect(webgl.toneMapping).toBe(THREE.NeutralToneMapping)
        expect(webgl.shadowMap.enabled).toBe(false)
        throw new Error('application host activation failed')
      },
      requestFrame,
    })).toThrow(/commit.*activate application scene host.*application host activation failed/i)

    expect(prepared.state).toBe('failed')
    expect(requestFrame).not.toHaveBeenCalled()
    expectApplicationPresentation(fixture, webgl)
    expect(fixture.root.parent).toBeNull()
    expect(() => prepared.dispose()).not.toThrow()
  })

  it('makes an externally aborted prepared candidate stale and uncommittable', async () => {
    const fixture = sceneFixture()
    const webgl = renderer()
    const controller = new AbortController()
    const prepared = await prepareLoadedThreeCompiledScene(loaded(fixture.root), {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: fixture.scene,
      prewarm: false,
      signal: controller.signal,
    })

    expect(prepared.state).toBe('prepared')
    expectApplicationPresentation(fixture, webgl)
    controller.abort(new Error('replacement generation requested'))

    expect(prepared.state).toBe('stale')
    expect(fixture.root.parent).toBeNull()
    expectApplicationPresentation(fixture, webgl)
    expect(() => prepared.commit()).toThrow(
      expect.objectContaining({ code: 'illegal-transition', state: 'stale' }),
    )
    expect(() => prepared.dispose()).not.toThrow()
  })

  it('defers candidate release until a non-abortable compileAsync settles', async () => {
    const fixture = sceneFixture()
    const webgl = renderer()
    const compilation = deferred<THREE.Object3D>()
    webgl.compileAsync.mockImplementation((
      compiled: THREE.Object3D,
    ) => compilation.promise.then(() => compiled))
    const controller = new AbortController()
    const preparing = prepareLoadedThreeCompiledScene(loaded(fixture.root), {
      descriptor: descriptor(),
      renderer: webgl as unknown as THREE.WebGLRenderer,
      scene: fixture.scene,
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(webgl.compileAsync).toHaveBeenCalledOnce())
    const stagedParent = fixture.root.parent
    expect(stagedParent).toBeInstanceOf(THREE.Scene)
    expect(stagedParent).not.toBe(fixture.scene)
    controller.abort(new Error('candidate abandoned during shader preparation'))

    // Three r184 offers no AbortSignal to compileAsync. The attempt becomes
    // stale immediately, but its detached graph stays alive until polling has
    // stopped, avoiding disposal of material programs still in use.
    expect(fixture.root.parent).toBe(stagedParent)
    expectApplicationPresentation(fixture, webgl)

    const [compiled] = webgl.compileAsync.mock.calls[0] as unknown as [THREE.Object3D]
    compilation.resolve(compiled)
    await expect(preparing).rejects.toMatchObject({
      code: 'preparation-cancelled',
      state: 'stale',
    })
    expect(fixture.root.parent).toBeNull()
    expectApplicationPresentation(fixture, webgl)
  })
})
