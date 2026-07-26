import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  BlendFunction, BloomEffect, Effect, EffectComposer, LUT3DEffect, OutlineEffect, SMAAEffect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { installThreeComponents } from './threeComponents.js'
import type { PortableComponentRecord } from './components.js'
import type { SceneBindings } from './runtime.js'

function record(
  type: string,
  target: PortableComponentRecord['target'],
  values: PortableComponentRecord['values'] = {},
): PortableComponentRecord {
  return { id: `component-${type}`, type, schemaVersion: 1, enabled: true, target, values }
}

function fixture() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  object.name = 'Hero'
  object.userData.blendlink_id = 'hero-id'
  root.add(object)
  const camera = new THREE.PerspectiveCamera()
  const render = vi.fn()
  const renderer = {
    domElement: { clientWidth: 640, clientHeight: 360 },
    render,
  } as unknown as THREE.WebGLRenderer
  const bindings: SceneBindings<THREE.Object3D> = {
    byId: { 'hero-id': object }, byName: { Hero: object }, object: () => object, dispose() {},
  }
  return { scene, root, object, camera, renderer, bindings, render }
}

function postFixture(hdr = true) {
  const f = fixture()
  const renderer = f.renderer as THREE.WebGLRenderer & {
    capabilities: { isWebGL2: boolean }
    extensions: { has(name: string): boolean; get(name: string): object | null }
  }
  renderer.autoClear = true
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 0.8
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.capabilities = { isWebGL2: true, maxSamples: 8 } as THREE.WebGLCapabilities
  renderer.extensions = {
    has: (name) => hdr && name === 'EXT_color_buffer_float',
    get: (name) => hdr && name === 'EXT_color_buffer_float' ? {} : null,
  } as unknown as THREE.WebGLExtensions
  renderer.getContext = (() => ({
    getContextAttributes: () => ({ alpha: true }),
  })) as THREE.WebGLRenderer['getContext']
  renderer.getSize = ((target: THREE.Vector2) => target.set(640, 360)) as THREE.WebGLRenderer['getSize']
  renderer.getDrawingBufferSize = ((target: THREE.Vector2) => target.set(640, 360)) as THREE.WebGLRenderer['getDrawingBufferSize']
  renderer.setSize = vi.fn() as unknown as THREE.WebGLRenderer['setSize']
  renderer.getPixelRatio = () => 1
  return f
}

describe('installThreeComponents', () => {
  it('keeps the normal Three render path as a first-class no-component case', async () => {
    const f = fixture()
    const installed = await installThreeComponents({ ...f })
    installed.update(1 / 60)
    installed.resize(800, 500)
    installed.render()
    expect(installed.count).toBe(0)
    expect(installed.postprocessing).toBe(false)
    expect(installed.postEdgeAntialiasing).toBe(false)
    expect(installed.postEdgeAntialiasingPreset).toBe('off')
    expect(f.render).toHaveBeenCalledWith(f.scene, f.camera)
    installed.dispose()
    expect(() => installed.render()).toThrow(/disposed/)
  })

  it('publishes a Website Surface without claiming the render loop', async () => {
    const f = fixture()
    const authored = new THREE.MeshBasicMaterial({ map: new THREE.Texture() })
    f.object.material = authored
    const requestFrame = vi.fn()
    const installed = await installThreeComponents({
      ...f,
      requestFrame,
      components: [record('blendlink.website-surface', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, { name: 'monitor-screen', colorTreatment: 'display' })],
    })

    expect(installed.websiteSurfaces.names).toEqual(['monitor-screen'])
    expect(installed.requiresContinuousFrames).toBe(false)
    const binding = installed.websiteSurfaces.bindCanvas(
      'monitor-screen', { width: 32, height: 16 } as HTMLCanvasElement,
    )
    expect(requestFrame).toHaveBeenCalledOnce()
    binding.changed()
    expect(requestFrame).toHaveBeenCalledTimes(2)
    installed.dispose()
    expect(f.object.material).toBe(authored)
    expect(binding.active).toBe(false)
    expect(() => binding.changed()).toThrow(/disposed/)
  })

  it('installs Shadow Catcher as static object intent and restores authored material ownership', async () => {
    const f = fixture()
    const authored = new THREE.MeshStandardMaterial({ color: 0x6688aa })
    f.object.material = authored
    f.object.receiveShadow = false
    f.object.layers.set(8)
    const layerMask = f.object.layers.mask
    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.shadow-catcher', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, {
        mode: 'mask', color: [0, 0, 0], opacity: 0.5,
        lightStrength: 6.6, includeDescendants: true,
      })],
    })

    expect(installed.count).toBe(1)
    expect(installed.requiresContinuousFrames).toBe(false)
    expect(f.object.material).toBeInstanceOf(THREE.ShadowMaterial)
    expect(f.object.receiveShadow).toBe(true)
    expect(f.object.layers.mask).toBe(layerMask)
    installed.dispose()
    expect(f.object.material).toBe(authored)
    expect(f.object.receiveShadow).toBe(false)
    expect(f.object.layers.mask).toBe(layerMask)
  })

  it('runs Contact Shadows in a direct demand path, settles static work, and restores after context loss', async () => {
    const f = fixture()
    f.scene.add(f.root)
    f.camera.layers.set(7)
    const surface = Object.assign(new EventTarget(), {
      clientWidth: 640,
      clientHeight: 360,
    }) as unknown as HTMLCanvasElement
    let target: THREE.WebGLRenderTarget | null = null
    let cubeFace = 0
    let mipLevel = 0
    let clearColor = new THREE.Color(0x112233)
    let clearAlpha = 1
    Object.assign(f.renderer, {
      domElement: surface,
      xr: { enabled: true },
      getRenderTarget: () => target,
      getActiveCubeFace: () => cubeFace,
      getActiveMipmapLevel: () => mipLevel,
      setRenderTarget: (
        next: THREE.WebGLRenderTarget | null,
        face = 0,
        mip = 0,
      ) => {
        target = next
        cubeFace = face
        mipLevel = mip
      },
      getClearColor: (out: THREE.Color) => out.copy(clearColor),
      getClearAlpha: () => clearAlpha,
      setClearColor: (value: THREE.ColorRepresentation, alpha?: number) => {
        clearColor = new THREE.Color(value)
        if (alpha !== undefined) clearAlpha = alpha
      },
      setClearAlpha: (alpha: number) => { clearAlpha = alpha },
      clear: vi.fn(),
    })
    const requestFrame = vi.fn()
    const installed = await installThreeComponents({
      ...f,
      requestFrame,
      components: [record('blendlink.contact-shadows', { kind: 'scene' }, {
        autoFit: true, darkness: 0.5, opacity: 0.5, blur: 4,
        occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
      })],
    })

    expect(installed.postprocessing).toBe(false)
    expect(installed.requiresContinuousFrames).toBe(true)
    installed.update(1 / 60)
    expect(f.render).toHaveBeenCalledTimes(5)
    expect(installed.requiresContinuousFrames).toBe(false)
    installed.render()
    expect(f.render).toHaveBeenCalledTimes(6)
    const helper = f.scene.getObjectByName('Blendlink Contact Shadows Root')!
    expect(helper.getObjectByName('Blendlink Contact Shadows Plane')?.layers.mask)
      .toBe(f.camera.layers.mask)

    surface.dispatchEvent(new Event('webglcontextlost'))
    expect(installed.requiresContinuousFrames).toBe(false)
    surface.dispatchEvent(new Event('webglcontextrestored'))
    expect(requestFrame).toHaveBeenCalledOnce()
    expect(installed.requiresContinuousFrames).toBe(true)
    installed.update(1 / 60)
    expect(f.render).toHaveBeenCalledTimes(11)
    installed.dispose()
    expect(f.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
  })

  it('keeps Contact Shadows Canvas listeners out of a deferred component preparation', async () => {
    const f = fixture()
    const surface = {
      clientWidth: 640,
      clientHeight: 360,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement
    Object.assign(f.renderer, { domElement: surface })
    const options = {
      ...f,
      deferActivation: true,
      components: [record('blendlink.contact-shadows', { kind: 'scene' }, {
        autoFit: true, darkness: 0.5, opacity: 0.5, blur: 4,
        occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
      })],
    } as const

    const abandoned = await installThreeComponents(options)
    expect(surface.addEventListener).not.toHaveBeenCalled()
    expect(abandoned.requiresContinuousFrames).toBe(false)
    abandoned.dispose()
    expect(surface.removeEventListener).not.toHaveBeenCalled()

    const committed = await installThreeComponents(options)
    expect(surface.addEventListener).not.toHaveBeenCalled()
    const committedScene = new THREE.Scene()
    const committedCamera = new THREE.PerspectiveCamera()
    committedCamera.layers.set(5)
    expect(f.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeDefined()
    committed.activate(committedScene, committedCamera)
    committed.activate(committedScene, committedCamera)
    expect(surface.addEventListener).toHaveBeenCalledTimes(2)
    expect(committed.requiresContinuousFrames).toBe(true)
    expect(f.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    const committedHelper =
      committedScene.getObjectByName('Blendlink Contact Shadows Root')
    expect(committedHelper).toBeDefined()
    expect(committedHelper?.getObjectByName('Blendlink Contact Shadows Plane')?.layers.mask)
      .toBe(committedCamera.layers.mask)
    committed.dispose()
    expect(surface.removeEventListener).toHaveBeenCalledTimes(2)
    expect(committedScene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
  })

  it('rejects manual Scene Contact Shadows before taking renderer ownership', async () => {
    const f = fixture()
    await expect(installThreeComponents({
      ...f,
      components: [record('blendlink.contact-shadows', { kind: 'scene' }, {
        autoFit: false, darkness: 0.5, opacity: 0.5, blur: 4,
        occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
      })],
    })).rejects.toThrow('Move it to an Empty/group')
  })

  it('preserves post-pipeline renderer ownership across a Contact Shadows refresh', async () => {
    const f = postFixture(true)
    f.scene.add(f.root)
    const surface = Object.assign(new EventTarget(), {
      clientWidth: 640,
      clientHeight: 360,
    }) as unknown as HTMLCanvasElement
    let target: THREE.WebGLRenderTarget | null = null
    let clearColor = new THREE.Color(0x224466)
    let clearAlpha = 0.4
    Object.assign(f.renderer, {
      domElement: surface,
      xr: { enabled: true },
      getRenderTarget: () => target,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next },
      getClearColor: (out: THREE.Color) => out.copy(clearColor),
      getClearAlpha: () => clearAlpha,
      setClearColor: (value: THREE.ColorRepresentation, alpha?: number) => {
        clearColor = new THREE.Color(value)
        if (alpha !== undefined) clearAlpha = alpha
      },
      setClearAlpha: (alpha: number) => { clearAlpha = alpha },
      clear: vi.fn(),
    })
    const installed = await installThreeComponents({
      ...f,
      components: [
        record('blendlink.bloom', { kind: 'scene' }, {
          mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
        }),
        record('blendlink.contact-shadows', { kind: 'scene' }, {
          autoFit: true, darkness: 0.5, opacity: 0.5, blur: 4,
          occludeBelowGround: false, backfaceShadows: true, updatePolicy: 'static',
        }),
      ],
    })
    expect(installed.postprocessing).toBe(true)
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    installed.update(1 / 60)
    expect(f.renderer.autoClear).toBe(false)
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(clearColor.getHex()).toBe(0x224466)
    expect(clearAlpha).toBe(0.4)
    installed.dispose()
    expect(f.renderer.autoClear).toBe(true)
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
  })

  it('fuses compatible effects, preserves HDR tone mapping, and restores renderer ownership', async () => {
    const f = postFixture(true)
    const installed = await installThreeComponents({
      ...f,
      components: [
        record('blendlink.vignette', { kind: 'scene' }, {
          intensity: 0.2, softness: 0.5, color: [0, 0, 0],
        }),
        record('blendlink.bloom', { kind: 'scene' }, {
          mode: 'bright-pixels', intensity: 0.6, threshold: 1, radius: 0.4,
        }),
        record('blendlink.kuwahara', { kind: 'scene' }, {
          strength: 0.5, brushScale: 4, directionality: 0.75, detail: 0.5,
        }),
      ],
    })

    expect(installed.postprocessing).toBe(true)
    expect(installed.antialiasingSamples).toBe(4)
    expect(installed.postEdgeAntialiasing).toBe(false)
    expect(installed.postEdgeAntialiasingPreset).toBe('off')
    expect(installed.postprocessingOrder).toEqual([
      'scene-color',
      'component-blendlink.bloom',
      'tone-mapping',
      'component-blendlink.kuwahara',
      'component-blendlink.vignette',
    ])
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(f.renderer.toneMappingExposure).toBe(0.8)
    expect(f.renderer.autoClear).toBe(false)
    installed.setQuality('low')
    expect(installed.antialiasingSamples).toBe(2)
    installed.resize(800, 450)
    installed.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)
  })

  it('commits a deferred post pipeline once against the supplied live scene and camera', async () => {
    const f = postFixture(true)
    const liveScene = new THREE.Scene()
    const liveCamera = new THREE.PerspectiveCamera()
    const setMainScene = vi.spyOn(EffectComposer.prototype, 'setMainScene')
    const setMainCamera = vi.spyOn(EffectComposer.prototype, 'setMainCamera')

    try {
      const installed = await installThreeComponents({
        ...f,
        deferActivation: true,
        components: [record('blendlink.bloom', { kind: 'scene' }, {
          mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
        })],
      })

      expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
      expect(f.renderer.autoClear).toBe(true)
      installed.activate(liveScene, liveCamera)
      installed.activate(liveScene, liveCamera)
      expect(setMainScene).toHaveBeenCalledTimes(1)
      expect(setMainScene).toHaveBeenCalledWith(liveScene)
      expect(setMainCamera).toHaveBeenCalledTimes(1)
      expect(setMainCamera).toHaveBeenCalledWith(liveCamera)
      expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
      expect(f.renderer.autoClear).toBe(false)

      installed.dispose()
      expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
      expect(f.renderer.autoClear).toBe(true)
    } finally {
      setMainScene.mockRestore()
      setMainCamera.mockRestore()
    }
  })

  it('drops the staging camera from deferred Outline work after commit', async () => {
    const initialize = OutlineEffect.prototype.initialize
    let outline: OutlineEffect | undefined
    const initializeSpy = vi.spyOn(OutlineEffect.prototype, 'initialize').mockImplementation(function (
      this: OutlineEffect, renderer, alpha, frameBufferType,
    ) {
      outline = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })

    try {
      const f = postFixture(true)
      f.scene.add(f.root)
      const installed = await installThreeComponents({
        ...f,
        deferActivation: true,
        components: [record('blendlink.outline', { kind: 'scene' }, {
          visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
          strength: 3, thickness: 1, xRay: false,
        })],
      })
      const liveScene = new THREE.Scene()
      liveScene.add(f.root)
      const liveCamera = new THREE.PerspectiveCamera()
      installed.activate(liveScene, liveCamera)

      const effect = outline as OutlineEffect & {
        depthPass: { render(renderer: THREE.WebGLRenderer): void }
        maskPass: { render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void }
        outlinePass: { render(renderer: THREE.WebGLRenderer, input: null, target: THREE.WebGLRenderTarget): void }
      }
      const reserved = effect.selection.layer
      liveCamera.layers.enable(reserved)
      const liveMask = liveCamera.layers.mask
      effect.depthPass.render = vi.fn(() => {
        expect(liveCamera.layers.isEnabled(reserved)).toBe(false)
      })
      effect.maskPass.render = vi.fn()
      effect.outlinePass.render = vi.fn()
      effect.update(f.renderer, new THREE.WebGLRenderTarget(), 1 / 60)
      expect(liveCamera.layers.mask).toBe(liveMask)

      installed.dispose()
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('drops N8AO staging scene and camera references after deferred commit', async () => {
    const setQualityMode = N8AOPostPass.prototype.setQualityMode
    let ao: (N8AOPostPass & { scene: THREE.Scene; camera: THREE.Camera }) | undefined
    const qualitySpy = vi.spyOn(N8AOPostPass.prototype, 'setQualityMode').mockImplementation(function (
      this: N8AOPostPass, mode,
    ) {
      ao = this as N8AOPostPass & { scene: THREE.Scene; camera: THREE.Camera }
      return setQualityMode.call(this, mode)
    })

    try {
      const f = postFixture(true)
      const installed = await installThreeComponents({
        ...f,
        deferActivation: true,
        components: [record('blendlink.ambient-occlusion', { kind: 'scene' }, {
          radiusMode: 'world', worldRadius: 1, screenRadius: 32,
          intensity: 2, color: [0, 0, 0],
        })],
      })
      const liveScene = new THREE.Scene()
      const liveCamera = new THREE.OrthographicCamera()

      expect(ao?.scene).toBe(f.scene)
      expect(ao?.camera).toBe(f.camera)
      installed.activate(liveScene, liveCamera)
      expect(ao?.scene).toBe(liveScene)
      expect(ao?.camera).toBe(liveCamera)
      installed.dispose()
    } finally {
      qualitySpy.mockRestore()
    }
  })

  it('does not claim shared renderer ownership for an abandoned prepared post pipeline', async () => {
    const f = postFixture(true)
    const component = record('blendlink.bloom', { kind: 'scene' }, {
      mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
    })
    const prepared = await installThreeComponents({
      ...f,
      components: [component],
      deferActivation: true,
    })
    const active = await installThreeComponents({ ...f, components: [component] })

    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(f.renderer.autoClear).toBe(false)
    active.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)

    prepared.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)
  })

  it('rolls renderer ownership back when deferred component activation fails', async () => {
    const f = postFixture(true)
    const installed = await installThreeComponents({
      ...f,
      deferActivation: true,
      components: [
        record('studio.activation-failure', { kind: 'scene' }),
        record('blendlink.bloom', { kind: 'scene' }, {
          mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
        }),
      ],
      adapters: {
        'studio.activation-failure': () => ({
          activate() { throw new Error('activation fixture failed') },
        }),
      },
    })

    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)
    expect(() => installed.activate(new THREE.Scene(), new THREE.PerspectiveCamera()))
      .toThrow(/activation fixture failed/)
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)
    expect(() => installed.activate()).toThrow(/disposed/i)
  })

  it('plans tone transfer from detached presentation look without adopting its restore state', async () => {
    const f = postFixture(true)
    f.renderer.toneMapping = THREE.NoToneMapping
    const installed = await installThreeComponents({
      ...f,
      deferActivation: true,
      presentationToneMapping: THREE.AgXToneMapping,
      components: [record('blendlink.bloom', { kind: 'scene' }, {
        mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
      })],
    })

    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(installed.postprocessingOrder).toContain('tone-mapping')
    installed.activate()
    installed.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
  })

  it('falls back visibly when HDR post targets are unavailable', async () => {
    const f = postFixture(false)
    const warnings: string[] = []
    const installed = await installThreeComponents({
      ...f,
      onWarning: (message) => warnings.push(message),
      components: [record('blendlink.bloom', { kind: 'scene' }, {
        mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
      })],
    })
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(warnings).toContainEqual(expect.stringMatching(/half-float.*LDR fallback/i))
    expect(warnings).toContainEqual(expect.stringMatching(/Threshold at or above 1.*lower Threshold below 1/i))
    installed.dispose()
  })

  it('changes Bloom quality through the effective mip count without claiming resolution scaling', async () => {
    const initialize = BloomEffect.prototype.initialize
    let bloom: BloomEffect | undefined
    const initializeSpy = vi.spyOn(BloomEffect.prototype, 'initialize').mockImplementation(function (
      this: BloomEffect, renderer, alpha, frameBufferType,
    ) {
      bloom = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })
    try {
      const f = postFixture(true)
      const installed = await installThreeComponents({
        ...f,
        components: [record('blendlink.bloom', { kind: 'scene' }, {
          mode: 'bright-pixels', intensity: 0.5, threshold: 0.8, radius: 0.4,
        })],
      })
      expect(bloom).toBeDefined()
      const authoredScale = bloom!.resolution.scale
      installed.setQuality('low')
      expect(bloom!.mipmapBlurPass.levels).toBe(5)
      expect(bloom!.resolution.scale).toBe(authoredScale)
      installed.setQuality('high')
      expect(bloom!.mipmapBlurPass.levels).toBe(8)
      expect(bloom!.resolution.scale).toBe(authoredScale)
      installed.dispose()
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('falls back to final SMAA when a non-pixel post stack has no offscreen MSAA', async () => {
    const components = [
      record('blendlink.vignette', { kind: 'scene' }, {
        intensity: 0.2, softness: 0.5, color: [0, 0, 0],
      }),
      record('blendlink.bloom', { kind: 'scene' }, {
        mode: 'bright-pixels', intensity: 0.6, threshold: 1, radius: 0.4,
      }),
    ]
    for (const component of components) {
      const f = postFixture(true)
      ;(f.renderer.capabilities as THREE.WebGLCapabilities).maxSamples = 0
      const installed = await installThreeComponents({ ...f, components: [component] })
      expect(installed.antialiasingSamples).toBe(0)
      expect(installed.postEdgeAntialiasing).toBe(true)
      expect(installed.postprocessingOrder.at(-1)).toBe('post-edge-antialiasing')
      installed.dispose()
    }
  })

  it('reference-counts post ownership for overlapping installs on one renderer', async () => {
    const f = postFixture(true)
    const component = record('blendlink.bloom', { kind: 'scene' }, {
      mode: 'bright-pixels', intensity: 0.5, threshold: 1, radius: 0.4,
    })
    const first = await installThreeComponents({ ...f, components: [component] })
    const second = await installThreeComponents({ ...f, components: [component] })
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(f.renderer.autoClear).toBe(false)
    first.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping)
    expect(f.renderer.autoClear).toBe(false)
    second.dispose()
    expect(f.renderer.toneMapping).toBe(THREE.AgXToneMapping)
    expect(f.renderer.autoClear).toBe(true)
  })

  it('restores layers used by emissive-object selective bloom', async () => {
    const f = postFixture(true)
    const material = new THREE.MeshStandardMaterial({ emissive: 0xff2200, emissiveIntensity: 2 })
    f.object.material = material
    const originalMask = f.object.layers.mask
    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.bloom', { kind: 'scene' }, {
        mode: 'emissive-objects', intensity: 0.5, threshold: 1, radius: 0.4,
      })],
    })
    expect(f.object.layers.mask).not.toBe(originalMask)
    installed.dispose()
    expect(f.object.layers.mask).toBe(originalMask)
  })

  it('installs the depth-aware Batch 1 stack and restores outline selection', async () => {
    const f = postFixture(true)
    const originalMask = f.object.layers.mask
    const installed = await installThreeComponents({
      ...f,
      components: [
        record('blendlink.ambient-occlusion', { kind: 'scene' }, {
          radiusMode: 'world', worldRadius: 1, screenRadius: 32,
          intensity: 2, color: [0, 0, 0],
        }),
        record('blendlink.depth-of-field', { kind: 'scene' }, {
          focusMode: 'object', focusDistance: 3, focusRange: 2, blurStrength: 1,
          focusTargetId: 'hero-id', focusTargetName: 'Hero',
        }),
        record('blendlink.outline', { kind: 'scene' }, {
          visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
          strength: 3, thickness: 1, xRay: false,
        }),
      ],
    })
    expect(installed.postprocessingOrder).toEqual([
      'scene-color',
      'component-blendlink.ambient-occlusion',
      'component-blendlink.depth-of-field',
      'tone-mapping',
      'component-blendlink.outline',
      'post-edge-antialiasing',
    ])
    expect(installed.postEdgeAntialiasing).toBe(true)
    expect(installed.postEdgeAntialiasingPreset).toBe('medium')
    expect(installed.postprocessingOrder.filter((stage) => stage === 'post-edge-antialiasing')).toHaveLength(1)
    expect(f.object.layers.mask).toBe(originalMask)
    f.object.position.set(1, 2, 3)
    installed.update(1 / 60)
    installed.setQuality('low')
    expect(installed.postEdgeAntialiasingPreset).toBe('low')
    installed.setQuality('balanced')
    expect(installed.postEdgeAntialiasingPreset).toBe('medium')
    installed.setQuality('high')
    expect(installed.antialiasingSamples).toBe(8)
    expect(installed.postEdgeAntialiasingPreset).toBe('high')
    installed.dispose()
    expect(f.object.layers.mask).toBe(originalMask)
  })

  it('uses ALPHA blending so the default dark Outline is not a SCREEN identity', async () => {
    const initialize = OutlineEffect.prototype.initialize
    let outline: OutlineEffect | undefined
    const initializeSpy = vi.spyOn(OutlineEffect.prototype, 'initialize').mockImplementation(function (
      this: OutlineEffect, renderer, alpha, frameBufferType,
    ) {
      outline = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })
    try {
      const f = postFixture(true)
      const installed = await installThreeComponents({
        ...f,
        components: [record('blendlink.outline', { kind: 'scene' }, {
          visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
          strength: 3, thickness: 1, xRay: false,
        })],
      })
      expect(outline?.blendMode.blendFunction).toBe(BlendFunction.ALPHA)
      installed.dispose()
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('confines Outline selection layers to its render and restores application masks', async () => {
    const initialize = OutlineEffect.prototype.initialize
    let outline: OutlineEffect | undefined
    const initializeSpy = vi.spyOn(OutlineEffect.prototype, 'initialize').mockImplementation(function (
      this: OutlineEffect, renderer, alpha, frameBufferType,
    ) {
      outline = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })
    try {
      const f = postFixture(true)
      f.scene.add(f.root)
      f.object.layers.set(7)
      f.camera.layers.set(7)
      const installed = await installThreeComponents({
        ...f,
        components: [record('blendlink.outline', { kind: 'scene' }, {
          visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
          strength: 3, thickness: 1, xRay: false,
        })],
      })
      expect(outline).toBeDefined()
      const effect = outline as OutlineEffect & {
        depthPass: { render(renderer: THREE.WebGLRenderer): void }
        maskPass: { render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void }
        outlinePass: { render(renderer: THREE.WebGLRenderer, input: null, target: THREE.WebGLRenderTarget): void }
      }
      const reserved = effect.selection.layer
      const objectMask = f.object.layers.mask
      const cameraMask = f.camera.layers.mask
      expect(reserved).not.toBe(0)
      expect(f.object.layers.isEnabled(reserved)).toBe(false)

      effect.depthPass.render = vi.fn(() => {
        expect(f.object.layers.isEnabled(reserved)).toBe(true)
        expect(f.object.layers.isEnabled(7)).toBe(false)
        expect(f.camera.layers.isEnabled(reserved)).toBe(false)
      })
      effect.maskPass.render = vi.fn(() => {
        expect(f.object.layers.isEnabled(reserved)).toBe(true)
        expect(f.object.layers.isEnabled(0)).toBe(true)
        expect(f.camera.layers.mask >>> 0).toBe((1 << reserved) >>> 0)
      })
      effect.outlinePass.render = vi.fn()
      effect.update(f.renderer, new THREE.WebGLRenderTarget(), 1 / 60)
      expect(f.object.layers.mask).toBe(objectMask)
      expect(f.camera.layers.mask).toBe(cameraMask)

      // Application changes outside the effect remain application-owned.
      f.object.layers.enable(5)
      const changedMask = f.object.layers.mask
      effect.maskPass.render = vi.fn(() => { throw new Error('mask render failed') })
      expect(() => effect.update(f.renderer, new THREE.WebGLRenderTarget(), 1 / 60))
        .toThrow('mask render failed')
      expect(f.object.layers.mask).toBe(changedMask)
      expect(f.camera.layers.mask).toBe(cameraMask)

      installed.dispose()
      expect(f.object.layers.mask).toBe(changedMask)
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('does not treat package-owned render helpers as application layer ownership', async () => {
    const f = postFixture(true)
    f.scene.add(f.root)
    const internal = new THREE.Group()
    internal.userData.blendlink_internal = true
    const helperCamera = new THREE.OrthographicCamera()
    const helperPlane = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
    helperCamera.layers.enableAll()
    helperPlane.layers.enableAll()
    internal.add(helperCamera, helperPlane)
    f.scene.add(internal)

    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.outline', { kind: 'scene' }, {
        visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
        strength: 3, thickness: 1, xRay: false,
      })],
    })

    expect(installed.postprocessingOrder).toContain('component-blendlink.outline')
    expect(helperCamera.layers.mask >>> 0).toBe(0xffffffff)
    expect(helperPlane.layers.mask >>> 0).toBe(0xffffffff)
    installed.dispose()
  })

  it('adapts Blendlink linear AO tint to the sRGB-facing N8AO configuration boundary', async () => {
    const setQualityMode = N8AOPostPass.prototype.setQualityMode
    let configuredColor: THREE.Color | undefined
    const qualitySpy = vi.spyOn(N8AOPostPass.prototype, 'setQualityMode').mockImplementation(function (
      this: N8AOPostPass, mode,
    ) {
      configuredColor = this.configuration.color.clone()
      return setQualityMode.call(this, mode)
    })
    try {
      const f = postFixture(true)
      const linearColor = new THREE.Color(0.25, 0.5, 0.75)
      const installed = await installThreeComponents({
        ...f,
        components: [record('blendlink.ambient-occlusion', { kind: 'scene' }, {
          radiusMode: 'world', worldRadius: 1, screenRadius: 32,
          intensity: 2, color: linearColor.toArray(),
        })],
      })
      const expected = linearColor.clone().convertLinearToSRGB()
      expect(configuredColor?.r).toBeCloseTo(expected.r)
      expect(configuredColor?.g).toBeCloseTo(expected.g)
      expect(configuredColor?.b).toBeCloseTo(expected.b)
      installed.dispose()
    } finally {
      qualitySpy.mockRestore()
    }
  })

  it('adds post-edge SMAA for either AO or Outline and disposes it once per install', async () => {
    const disposeSmaa = vi.spyOn(SMAAEffect.prototype, 'dispose')
    try {
      const components = [
        record('blendlink.ambient-occlusion', { kind: 'scene' }, {
          radiusMode: 'world', worldRadius: 1, screenRadius: 32,
          intensity: 2, color: [0, 0, 0],
        }),
        record('blendlink.outline', { kind: 'scene' }, {
          visibleColor: [0, 0, 0], hiddenColor: [0.08, 0.08, 0.08],
          strength: 3, thickness: 1, xRay: false,
        }),
      ]
      for (const component of components) {
        const f = postFixture(true)
        const installed = await installThreeComponents({ ...f, components: [component] })
        expect(installed.postEdgeAntialiasing).toBe(true)
        expect(installed.postprocessingOrder.at(-1)).toBe('post-edge-antialiasing')
        installed.resize(800, 450)
        installed.dispose()
      }
      expect(disposeSmaa).toHaveBeenCalledTimes(2)
    } finally {
      disposeSmaa.mockRestore()
    }
  })

  it('loads and owns a standard 3D LUT for color grading', async () => {
    const initialize = Effect.prototype.initialize
    let lut: LUT3DEffect | undefined
    const initializeSpy = vi.spyOn(Effect.prototype, 'initialize').mockImplementation(function (
      this: Effect, renderer, alpha, frameBufferType,
    ) {
      if (this instanceof LUT3DEffect) lut = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })
    try {
      const f = postFixture(true)
      const lutUrl = '/looks/identity.cube'
      const texture = new THREE.Data3DTexture(new Uint8Array(2 * 2 * 2 * 4), 2, 2, 2)
      const disposed = vi.fn()
      texture.addEventListener('dispose', disposed)
      const installed = await installThreeComponents({
        ...f,
        loadLut: async (url) => {
          expect(url).toBe(lutUrl)
          return texture
        },
        components: [record('blendlink.color-grading', { kind: 'scene' }, {
          lutUrl, intensity: 0.75, tetrahedralInterpolation: true,
        })],
      })
      expect(installed.postprocessingOrder).toEqual([
        'scene-color', 'tone-mapping', 'component-blendlink.color-grading',
      ])
      expect(lut?.blendMode.blendFunction).toBe(BlendFunction.NORMAL)
      expect(lut?.blendMode.opacity.value).toBeCloseTo(0.75)
      expect(lut?.tetrahedralInterpolation).toBe(true)
      expect(installed.postEdgeAntialiasing).toBe(false)
      expect(installed.postEdgeAntialiasingPreset).toBe('off')
      installed.dispose()
      expect(disposed).not.toHaveBeenCalled()
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('samples geometry-aware Pixelation alpha from the same block UV as RGB', async () => {
    const initialize = Effect.prototype.initialize
    let pixelation: Effect | undefined
    const initializeSpy = vi.spyOn(Effect.prototype, 'initialize').mockImplementation(function (
      this: Effect, renderer, alpha, frameBufferType,
    ) {
      if (this.name === 'BlendlinkGeometryAwarePixelation') pixelation = this
      return initialize.call(this, renderer, alpha, frameBufferType)
    })
    try {
      const f = postFixture(true)
      const installed = await installThreeComponents({
        ...f,
        components: [record('blendlink.pixelation', { kind: 'scene' }, {
          pixelSize: 6, depthEdgeStrength: 0.4, normalEdgeStrength: 0.6,
        })],
      })
      expect(pixelation?.fragmentShader).toContain(
        'vec4(pixelColor.rgb * (1.0 - edge * 0.82), pixelColor.a)',
      )
      installed.dispose()
    } finally {
      initializeSpy.mockRestore()
    }
  })

  it('installs the geometry-aware Batch 2 stack in semantic order', async () => {
    const f = postFixture(true)
    const warnings: string[] = []
    const installed = await installThreeComponents({
      ...f,
      onWarning: (warning) => warnings.push(warning),
      components: [
        record('blendlink.sharpen', { kind: 'scene' }, { amount: 0.35 }),
        record('blendlink.pixelation', { kind: 'scene' }, {
          pixelSize: 6, depthEdgeStrength: 0.4, normalEdgeStrength: 0.6,
        }),
        record('blendlink.tilt-shift', { kind: 'scene' }, {
          focusPosition: 0.5, angle: 12, feather: 0.25, strength: 0.7, quality: 'high',
        }),
        record('blendlink.chromatic-aberration', { kind: 'scene' }, {
          amount: 0.012, mode: 'radial', angle: 0, centerX: 0.4, centerY: 0.55,
        }),
      ],
    })

    expect(installed.postprocessingOrder).toEqual([
      'scene-color',
      'scene-normals',
      'component-blendlink.tilt-shift',
      'tone-mapping',
      'component-blendlink.chromatic-aberration',
      'component-blendlink.pixelation',
      'component-blendlink.sharpen',
    ])
    expect(Object.isFrozen(installed.postprocessingOrder)).toBe(true)
    expect(warnings).toContainEqual(expect.stringMatching(/above 0\.01.*phone size/i))
    installed.resize(800, 450)
    installed.setQuality('low')
    installed.setQuality('high')
    installed.dispose()
  })

  it('keeps ordinary pixelation on the cheaper color-only path', async () => {
    const f = postFixture(true)
    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.pixelation', { kind: 'scene' }, {
        pixelSize: 8, depthEdgeStrength: 0, normalEdgeStrength: 0,
      })],
    })
    expect(installed.postprocessingOrder).toEqual([
      'scene-color', 'tone-mapping', 'component-blendlink.pixelation',
    ])
    expect(installed.postEdgeAntialiasing).toBe(false)
    expect(installed.postEdgeAntialiasingPreset).toBe('off')
    installed.resize(320, 240)
    installed.dispose()
  })

  it('lets Pixelation preserve its grid when AO and zero-sample fallback would add SMAA', async () => {
    const f = postFixture(true)
    ;(f.renderer.capabilities as THREE.WebGLCapabilities).maxSamples = 0
    const installed = await installThreeComponents({
      ...f,
      components: [
        record('blendlink.ambient-occlusion', { kind: 'scene' }, {
          radiusMode: 'world', worldRadius: 1, screenRadius: 32,
          intensity: 2, color: [0, 0, 0],
        }),
        record('blendlink.pixelation', { kind: 'scene' }, {
          pixelSize: 8, depthEdgeStrength: 0, normalEdgeStrength: 0,
        }),
      ],
    })
    expect(installed.postprocessingOrder).toEqual([
      'scene-color',
      'component-blendlink.ambient-occlusion',
      'tone-mapping',
      'component-blendlink.pixelation',
    ])
    expect(installed.antialiasingSamples).toBe(0)
    expect(installed.postEdgeAntialiasing).toBe(false)
    expect(installed.postEdgeAntialiasingPreset).toBe('off')
    installed.dispose()
  })

  it('uses stable object bindings and reverses authored visibility on dispose', async () => {
    const f = fixture()
    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.hide-on-start', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      })],
    })
    expect(f.object.visible).toBe(false)
    installed.dispose()
    expect(f.object.visible).toBe(true)
  })

  it('does not erase enabled vendor intent: the host must install an explicit adapter', async () => {
    const f = fixture()
    await expect(installThreeComponents({
      ...f,
      components: [record('studio.ripple', { kind: 'scene' })],
    })).rejects.toThrow(/studio\.ripple.*no Three\.js adapter/i)
  })

  it('accepts a supplied adapter for an otherwise unknown enabled component', async () => {
    const f = fixture()
    const dispose = vi.fn()
    const installed = await installThreeComponents({
      ...f,
      components: [record('studio.ripple', { kind: 'scene' })],
      adapters: { 'studio.ripple': () => ({ dispose }) },
    })
    expect(installed.count).toBe(1)
    installed.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('routes custom adapters through the shared lifecycle phases and narrow services', async () => {
    const f = fixture()
    const events: string[] = []
    const installed = await installThreeComponents({
      ...f,
      components: [record('studio.lifecycle', { kind: 'scene' })],
      adapters: {
        'studio.lifecycle': (context) => {
          expect(context.services.interaction?.addTarget).toBeTypeOf('function')
          expect(context.services.accessibility?.addControl).toBeTypeOf('function')
          expect(context.services.postPipeline).toBeUndefined()
          return {
            fixedUpdate: () => events.push('fixed'),
            beforeRender: () => events.push('before'),
            afterRender: () => events.push('after'),
            setQuality: (quality) => events.push(quality),
            dispose: () => events.push('dispose'),
          }
        },
      },
    })
    installed.fixedUpdate(1 / 50)
    installed.setQuality('balanced')
    installed.render()
    installed.dispose()
    expect(events).toEqual(['fixed', 'balanced', 'before', 'after', 'dispose'])
    expect(f.render).toHaveBeenCalledWith(f.scene, f.camera)
  })

  it('defers Three component activation until the installed scene commits', async () => {
    const f = fixture()
    const committedScene = new THREE.Scene()
    const committedCamera = new THREE.PerspectiveCamera()
    const activate = vi.fn()
    const dispose = vi.fn()
    const installed = await installThreeComponents({
      ...f,
      components: [record('studio.deferred', { kind: 'scene' })],
      adapters: {
        'studio.deferred': () => ({ activate, dispose }),
      },
      deferActivation: true,
    })

    expect(activate).not.toHaveBeenCalled()
    installed.activate(committedScene, committedCamera)
    installed.activate(committedScene, committedCamera)
    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(committedScene, committedCamera)

    installed.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('renders the committed scene and camera on the deferred direct-render path', async () => {
    const f = fixture()
    const liveScene = new THREE.Scene()
    const liveCamera = new THREE.PerspectiveCamera()
    const installed = await installThreeComponents({
      ...f,
      components: [record('studio.direct-render', { kind: 'scene' })],
      adapters: { 'studio.direct-render': () => ({}) },
      deferActivation: true,
    })

    installed.activate(liveScene, liveCamera)
    installed.render()
    expect(f.render).toHaveBeenCalledOnce()
    expect(f.render).toHaveBeenCalledWith(liveScene, liveCamera)
    installed.dispose()
  })

  it('restores earlier Three mutations when a later component cannot install', async () => {
    const f = fixture()
    await expect(installThreeComponents({
      ...f,
      components: [
        record('blendlink.hide-on-start', {
          kind: 'object', objectId: 'hero-id', objectName: 'Hero',
        }),
        record('studio.missing', { kind: 'scene' }),
      ],
    })).rejects.toThrow(/studio\.missing.*no Three\.js adapter/i)
    expect(f.object.visible).toBe(true)
  })

  it('keeps a focal object visible without mutating shared source materials', async () => {
    const f = fixture()
    f.camera.position.set(0, 0, 5)
    f.camera.lookAt(0, 0, 0)
    f.camera.updateMatrixWorld()
    f.object.position.set(0, 0, 0)
    const shared = new THREE.MeshBasicMaterial({ opacity: 1 })
    const occluder = new THREE.Mesh(new THREE.BoxGeometry(), shared)
    occluder.position.set(0, 0, 2.5)
    f.root.add(occluder)
    f.root.updateMatrixWorld(true)

    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.see-through', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, { fadeDistance: 0.5, minOpacity: 0.15, duration: 0 })],
    })
    installed.update(1 / 60)
    const faded = occluder.material as THREE.Material
    expect(faded).not.toBe(shared)
    expect(faded.opacity).toBeCloseTo(0.15)
    expect(faded.transparent).toBe(true)
    expect(faded.depthWrite).toBe(false)
    expect(shared.opacity).toBe(1)
    expect(shared.transparent).toBe(false)

    installed.dispose()
    expect(occluder.material).toBe(shared)
    expect(shared.opacity).toBe(1)
  })

  it('rejects unsafe navigation before attaching an interaction', async () => {
    const f = fixture()
    await expect(installThreeComponents({
      ...f,
      components: [record('blendlink.open-url', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, { url: 'javascript:alert(1)', newTab: true })],
    })).rejects.toThrow(/unsupported javascript/i)
  })

  it('installs audio sources before triggers regardless of card order', async () => {
    const f = fixture()
    const order: string[] = []
    const installed = await installThreeComponents({
      ...f,
      components: [
        record('studio.trigger', { kind: 'scene' }),
        record('blendlink.audio-source', {
          kind: 'object', objectId: 'hero-id', objectName: 'Hero',
        }, { url: '/sound.ogg' }),
      ],
      adapters: {
        'studio.trigger': () => { order.push('trigger'); return {} },
        'blendlink.audio-source': () => { order.push('source'); return {} },
      },
    })
    expect(order).toEqual(['source', 'trigger'])
    installed.dispose()
  })

  it('makes the authored spatial-audio outer radius genuinely silent', async () => {
    const f = fixture()
    const panner = {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 10_000,
      rolloffFactor: 1,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    const gains: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }> = []
    const createGain = () => {
      const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1, setTargetAtTime: vi.fn() },
      }
      gains.push(gain)
      return gain
    }
    THREE.AudioContext.setContext({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createGain,
      createPanner: () => panner,
    } as unknown as AudioContext)

    const installed = await installThreeComponents({
      ...f,
      components: [record('blendlink.audio-source', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, {
        url: '/sound.ogg', autoplay: false, loop: false, volume: 0.7,
        spatial: true, minDistance: 3, maxDistance: 12,
      })],
      audioLoader: { loadAsync: async () => ({} as AudioBuffer) },
    })

    expect(panner.distanceModel).toBe('linear')
    expect(panner.rolloffFactor).toBe(1)
    expect(panner.refDistance).toBe(3)
    expect(panner.maxDistance).toBe(12)
    expect(f.object.children.some((child) => child instanceof THREE.PositionalAudio)).toBe(true)
    installed.dispose()
    expect(f.object.children.some((child) => child instanceof THREE.PositionalAudio)).toBe(false)
    expect(panner.disconnect).toHaveBeenCalled()
    expect(gains).toHaveLength(2)
    expect(gains.every((gain) => gain.disconnect.mock.calls.length > 0)).toBe(true)
  })

  it('does not autoplay prepared audio before deferred activation', async () => {
    const f = fixture()
    const gains: Array<{
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
      gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }
    }> = []
    THREE.AudioContext.setContext({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createGain: () => {
        const gain = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { value: 1, setTargetAtTime: vi.fn() },
        }
        gains.push(gain)
        return gain
      },
    } as unknown as AudioContext)
    const play = vi.spyOn(THREE.Audio.prototype, 'play').mockImplementation(
      function () { return this },
    )

    try {
      const options = {
        ...f,
        components: [record('blendlink.audio-source', {
          kind: 'object', objectId: 'hero-id', objectName: 'Hero',
        }, {
          url: '/autoplay.ogg', autoplay: true,
        })],
        audioLoader: { loadAsync: async () => ({} as AudioBuffer) },
        deferActivation: true,
      } as const
      const abandoned = await installThreeComponents(options)

      expect(play).not.toHaveBeenCalled()
      expect(f.camera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
      abandoned.dispose()
      expect(play).not.toHaveBeenCalled()
      expect(f.camera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
      expect(() => abandoned.activate()).toThrow(/disposed/i)

      const installed = await installThreeComponents(options)
      const liveCamera = new THREE.PerspectiveCamera()
      expect(f.camera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
      installed.activate(new THREE.Scene(), liveCamera)
      installed.activate(new THREE.Scene(), liveCamera)
      expect(play).toHaveBeenCalledOnce()
      expect(f.camera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
      expect(liveCamera.children.some((child) => child instanceof THREE.AudioListener)).toBe(true)
      installed.dispose()
      expect(f.camera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
      expect(liveCamera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
    } finally {
      play.mockRestore()
    }
  })

  it('borrows an application-owned audio listener without moving or disconnecting it', async () => {
    const f = fixture()
    const gains: Array<{
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
      gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }
    }> = []
    THREE.AudioContext.setContext({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createGain: () => {
        const gain = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { value: 1, setTargetAtTime: vi.fn() },
        }
        gains.push(gain)
        return gain
      },
    } as unknown as AudioContext)
    const listener = new THREE.AudioListener()
    const listenerGain = gains[0]!
    f.camera.add(listener)
    f.camera.userData.__blendlink_audio_listener = listener

    const installed = await installThreeComponents({
      ...f,
      deferActivation: true,
      components: [record('blendlink.audio-source', {
        kind: 'object', objectId: 'hero-id', objectName: 'Hero',
      }, { url: '/borrowed-listener.ogg' })],
      audioLoader: { loadAsync: async () => ({} as AudioBuffer) },
    })

    expect(f.camera.children.filter((child) => child instanceof THREE.AudioListener)).toEqual([listener])
    installed.activate()
    installed.dispose()
    expect(listener.parent).toBe(f.camera)
    expect(listenerGain.disconnect).not.toHaveBeenCalled()
  })

  it('removes a newly attached listener when deferred activation rolls back', async () => {
    const f = fixture()
    THREE.AudioContext.setContext({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createGain: () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { value: 1, setTargetAtTime: vi.fn() },
      }),
    } as unknown as AudioContext)
    const installed = await installThreeComponents({
      ...f,
      deferActivation: true,
      components: [
        record('blendlink.audio-source', {
          kind: 'object', objectId: 'hero-id', objectName: 'Hero',
        }, { url: '/rollback-listener.ogg' }),
        record('studio.audio-activation-failure', { kind: 'scene' }),
      ],
      adapters: {
        'studio.audio-activation-failure': () => ({
          activate() { throw new Error('audio activation fixture failed') },
        }),
      },
      audioLoader: { loadAsync: async () => ({} as AudioBuffer) },
    })
    const liveCamera = new THREE.PerspectiveCamera()

    expect(liveCamera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
    expect(() => installed.activate(new THREE.Scene(), liveCamera))
      .toThrow(/audio activation fixture failed/)
    expect(liveCamera.children.some((child) => child instanceof THREE.AudioListener)).toBe(false)
  })

  it('keeps a shared listener alive until the last overlapping preview install disposes', async () => {
    const f = fixture()
    const gains: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }> = []
    const panners: Array<{ connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
    THREE.AudioContext.setContext({
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createGain: () => {
        const gain = {
          connect: vi.fn(), disconnect: vi.fn(),
          gain: { value: 1, setTargetAtTime: vi.fn() },
        }
        gains.push(gain)
        return gain
      },
      createPanner: () => {
        const panner = {
          panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
          maxDistance: 10_000, rolloffFactor: 1,
          connect: vi.fn(), disconnect: vi.fn(),
        }
        panners.push(panner)
        return panner
      },
    } as unknown as AudioContext)
    const component = record('blendlink.audio-source', {
      kind: 'object', objectId: 'hero-id', objectName: 'Hero',
    }, {
      url: '/sound.ogg', spatial: true, minDistance: 0, maxDistance: 10,
    })
    const options = {
      ...f, components: [component],
      audioLoader: { loadAsync: async () => ({} as AudioBuffer) },
    }

    const first = await installThreeComponents(options)
    const listener = f.camera.userData.__blendlink_audio_listener as THREE.AudioListener
    const second = await installThreeComponents(options)
    expect(listener).toBeInstanceOf(THREE.AudioListener)
    expect(f.camera.children).toContain(listener)
    expect(f.object.children.filter((child) => child instanceof THREE.PositionalAudio)).toHaveLength(2)

    first.dispose()
    expect(f.camera.children).toContain(listener)
    expect(f.camera.userData.__blendlink_audio_listener).toBe(listener)
    expect(gains[0]?.disconnect).not.toHaveBeenCalled()
    expect(f.object.children.filter((child) => child instanceof THREE.PositionalAudio)).toHaveLength(1)

    second.dispose()
    expect(f.camera.children).not.toContain(listener)
    expect(f.camera.userData.__blendlink_audio_listener).toBeUndefined()
    expect(f.camera.userData.__blendlink_audio_listener_state).toBeUndefined()
    expect(gains[0]?.disconnect).toHaveBeenCalled()
    expect(panners.every((panner) => panner.disconnect.mock.calls.length > 0)).toBe(true)
  })
})
