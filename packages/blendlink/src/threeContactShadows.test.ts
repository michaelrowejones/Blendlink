import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  installThreeContactShadows,
  type ThreeContactShadowValues,
} from './threeContactShadows.js'

const DEFAULTS: ThreeContactShadowValues = {
  autoFit: true,
  darkness: 0.5,
  opacity: 0.5,
  blur: 4,
  occludeBelowGround: false,
  backfaceShadows: true,
  updatePolicy: 'static',
}

class FakeRenderer {
  readonly domElement = new EventTarget() as unknown as HTMLCanvasElement
  readonly xr = { enabled: true }
  readonly calls: Array<{
    object: THREE.Object3D
    camera: THREE.Camera
    target: THREE.WebGLRenderTarget | null
  }> = []
  target: THREE.WebGLRenderTarget | null = new THREE.WebGLRenderTarget(4, 4)
  activeCubeFace = 3
  activeMipmapLevel = 2
  clearColor = new THREE.Color(0x123456)
  clearAlpha = 0.75
  clears = 0
  throwAtCall = -1
  onRender?: (object: THREE.Object3D, camera: THREE.Camera) => void

  getRenderTarget(): THREE.WebGLRenderTarget | null { return this.target }
  getActiveCubeFace(): number { return this.activeCubeFace }
  getActiveMipmapLevel(): number { return this.activeMipmapLevel }
  getClearColor(target: THREE.Color): THREE.Color { return target.copy(this.clearColor) }
  getClearAlpha(): number { return this.clearAlpha }
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void {
    this.clearColor.set(color)
    if (alpha !== undefined) this.clearAlpha = alpha
  }
  setClearAlpha(alpha: number): void { this.clearAlpha = alpha }
  setRenderTarget(
    target: THREE.WebGLRenderTarget | null,
    activeCubeFace = 0,
    activeMipmapLevel = 0,
  ): void {
    this.target = target
    this.activeCubeFace = activeCubeFace
    this.activeMipmapLevel = activeMipmapLevel
  }
  clear(): void { this.clears += 1 }
  render(object: THREE.Object3D, camera: THREE.Camera): void {
    this.calls.push({ object, camera, target: this.target })
    this.onRender?.(object, camera)
    if (this.calls.length === this.throwAtCall) throw new Error('synthetic render failure')
  }
}

function fixture(): {
  scene: THREE.Scene
  root: THREE.Group
  anchor: THREE.Group
  caster: THREE.Mesh
  camera: THREE.PerspectiveCamera
  renderer: FakeRenderer
} {
  const scene = new THREE.Scene()
  scene.name = 'Application Scene'
  const root = new THREE.Group()
  root.name = 'Compiled Root'
  const caster = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 6),
    new THREE.MeshStandardMaterial(),
  )
  caster.position.y = 2
  root.add(caster)
  scene.add(root)
  const anchor = new THREE.Group()
  anchor.name = 'Contact Shadow Empty'
  scene.add(anchor)
  const camera = new THREE.PerspectiveCamera()
  return { scene, root, anchor, caster, camera, renderer: new FakeRenderer() }
}

function renderer(value: FakeRenderer): THREE.WebGLRenderer {
  return value as unknown as THREE.WebGLRenderer
}

describe('installThreeContactShadows', () => {
  it('matches Needle five-pass structure once, then settles a static demand scene', () => {
    const data = fixture()
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })

    expect(installed.isActive()).toBe(true)
    installed.update()
    installed.beforeRender()

    expect(data.renderer.calls).toHaveLength(5)
    expect(data.renderer.clears).toBe(1)
    expect(installed.evidence).toMatchObject({
      resolution: 512,
      refreshes: 1,
      auxiliaryRenders: 5,
      specifiedColorAttachmentBytes: 2 * 512 * 512 * 4,
      hasDepthAttachments: false,
    })
    expect(installed.isActive()).toBe(false)

    installed.update()
    installed.beforeRender()
    expect(data.renderer.calls).toHaveLength(5)
    expect(installed.evidence.refreshes).toBe(1)

    const targets = [...new Set(data.renderer.calls.map((call) => call.target))]
      .filter((target): target is THREE.WebGLRenderTarget => target !== null)
    expect(targets).toHaveLength(2)
    expect(targets.every((target) =>
      target.depthBuffer === false && target.stencilBuffer === false)).toBe(true)

    const helper = data.scene.getObjectByName('Blendlink Contact Shadows Root')
    expect(helper).toBeDefined()
    expect(helper?.parent).toBe(data.scene)
    // Needle's blur-border heuristic expands a 2x6 box by one full original
    // extent on both sides.
    expect(helper?.scale.x).toBeCloseTo(6)
    expect(helper?.scale.z).toBeCloseTo(18)
    installed.dispose()
    expect(data.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
  })

  it('refreshes exactly once per host frame in both update+render and render-only hosts', () => {
    const data = fixture()
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: { ...DEFAULTS, updatePolicy: 'continuous' },
    })

    installed.update()
    installed.beforeRender()
    expect(data.renderer.calls).toHaveLength(5)
    installed.update()
    installed.beforeRender()
    expect(data.renderer.calls).toHaveLength(10)
    // A renderer-owning host may call only beforeRender.
    installed.beforeRender()
    expect(data.renderer.calls).toHaveLength(15)
    expect(installed.evidence.refreshes).toBe(3)
    expect(installed.isActive()).toBe(true)
    installed.dispose()
  })

  it('bounds duplicate suppression to one synchronous host frame', async () => {
    const data = fixture()
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: { ...DEFAULTS, updatePolicy: 'continuous' },
    })
    installed.update()
    expect(data.renderer.calls).toHaveLength(5)
    await Promise.resolve()
    installed.beforeRender()
    expect(data.renderer.calls).toHaveLength(10)
    installed.dispose()
  })

  it('bounds only visible renderable scene content so hidden helpers cannot dilute resolution', () => {
    const data = fixture()
    const hiddenGiant = new THREE.Mesh(
      new THREE.BoxGeometry(10000, 10000, 10000),
      new THREE.MeshBasicMaterial(),
    )
    hiddenGiant.visible = false
    data.root.add(hiddenGiant)
    const depthOnlyGiant = new THREE.Mesh(
      new THREE.BoxGeometry(20000, 20000, 20000),
      new THREE.MeshBasicMaterial({ colorWrite: false }),
    )
    data.root.add(depthOnlyGiant)

    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })
    const helper = data.scene.getObjectByName('Blendlink Contact Shadows Root')
    expect(helper?.scale.x).toBeCloseTo(6)
    expect(helper?.scale.z).toBeCloseTo(18)
    installed.dispose()
  })

  it('restores every borrowed renderer/scene field and public visibility when a pass throws', () => {
    const data = fixture()
    const background = new THREE.Color(0xabcdef)
    const applicationOverride = new THREE.MeshBasicMaterial()
    data.scene.background = background
    data.scene.overrideMaterial = applicationOverride
    data.scene.matrixWorldAutoUpdate = true
    const line = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial(),
    )
    const transparentMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
    })
    const transparent = new THREE.Mesh(new THREE.BoxGeometry(), transparentMaterial)
    const noOverrideMaterial = new THREE.MeshBasicMaterial()
    noOverrideMaterial.allowOverride = false
    const noOverride = new THREE.Mesh(new THREE.BoxGeometry(), noOverrideMaterial)
    data.scene.add(line)
    data.scene.add(transparent)
    data.scene.add(noOverride)
    const originalTarget = data.renderer.target
    const originalColor = data.renderer.clearColor.clone()
    data.renderer.throwAtCall = 2
    let lineWasHiddenDuringCapture = false
    let transparentWasHiddenDuringCapture = false
    let noOverrideWasHiddenDuringCapture = false
    data.renderer.onRender = (object) => {
      if (object === data.scene) {
        lineWasHiddenDuringCapture = line.visible === false
        transparentWasHiddenDuringCapture = transparentMaterial.visible === false
        noOverrideWasHiddenDuringCapture = noOverrideMaterial.visible === false
      }
    }

    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })

    expect(() => installed.update()).toThrow('synthetic render failure')
    expect(lineWasHiddenDuringCapture).toBe(true)
    expect(transparentWasHiddenDuringCapture).toBe(true)
    expect(noOverrideWasHiddenDuringCapture).toBe(true)
    expect(line.visible).toBe(true)
    expect(transparentMaterial.visible).toBe(true)
    expect(noOverrideMaterial.visible).toBe(true)
    expect(data.scene.background).toBe(background)
    expect(data.scene.overrideMaterial).toBe(applicationOverride)
    expect(data.scene.matrixWorldAutoUpdate).toBe(true)
    expect(data.renderer.xr.enabled).toBe(true)
    expect(data.renderer.target).toBe(originalTarget)
    expect(data.renderer.activeCubeFace).toBe(3)
    expect(data.renderer.activeMipmapLevel).toBe(2)
    expect(data.renderer.clearColor.equals(originalColor)).toBe(true)
    expect(data.renderer.clearAlpha).toBe(0.75)
    expect(installed.isActive()).toBe(true)

    data.renderer.throwAtCall = -1
    installed.update()
    expect(installed.evidence.refreshes).toBe(1)
    installed.dispose()
    applicationOverride.dispose()
    transparentMaterial.dispose()
    noOverrideMaterial.dispose()
    originalTarget?.dispose()
  })

  it.each([1, 2, 3, 4, 5])(
    'keeps static work dirty and restores the render target when auxiliary pass %i fails',
    (throwAtCall) => {
      const data = fixture()
      const originalTarget = data.renderer.target
      data.renderer.throwAtCall = throwAtCall
      const installed = installThreeContactShadows({
        ...data,
        renderer: renderer(data.renderer),
        values: DEFAULTS,
      })
      expect(() => installed.update()).toThrow('synthetic render failure')
      expect(data.renderer.target).toBe(originalTarget)
      expect(installed.evidence.refreshes).toBe(0)
      expect(installed.isActive()).toBe(true)
      data.renderer.throwAtCall = -1
      installed.update()
      expect(installed.evidence.refreshes).toBe(1)
      installed.dispose()
      originalTarget?.dispose()
    },
  )

  it('marks a lost context dormant and requests one truthful refresh after restore', () => {
    const data = fixture()
    const requestFrame = vi.fn()
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      requestFrame,
    })

    data.renderer.domElement.dispatchEvent(new Event('webglcontextlost'))
    expect(installed.isActive()).toBe(false)
    installed.update()
    expect(data.renderer.calls).toHaveLength(0)

    data.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'))
    expect(requestFrame).toHaveBeenCalledOnce()
    expect(installed.isActive()).toBe(true)
    installed.update()
    expect(data.renderer.calls).toHaveLength(5)
    installed.dispose()

    data.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'))
    expect(requestFrame).toHaveBeenCalledOnce()
  })

  it('defers context listeners until activation and abandons them without touching the Canvas', () => {
    const data = fixture()
    const addEventListener = vi.spyOn(data.renderer.domElement, 'addEventListener')
    const removeEventListener = vi.spyOn(data.renderer.domElement, 'removeEventListener')
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      deferActivation: true,
    })

    expect(addEventListener).not.toHaveBeenCalled()
    expect(installed.isActive()).toBe(false)
    installed.update()
    expect(data.renderer.calls).toHaveLength(0)

    installed.dispose()
    expect(addEventListener).not.toHaveBeenCalled()
    expect(removeEventListener).not.toHaveBeenCalled()
    expect(data.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    expect(() => installed.activate()).toThrow(/disposed/i)
  })

  it('registers deferred context listeners exactly once during synchronous activation', () => {
    const data = fixture()
    const addEventListener = vi.spyOn(data.renderer.domElement, 'addEventListener')
    const removeEventListener = vi.spyOn(data.renderer.domElement, 'removeEventListener')
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      deferActivation: true,
    })

    installed.activate()
    installed.activate()
    expect(addEventListener).toHaveBeenCalledTimes(2)
    expect(addEventListener).toHaveBeenCalledWith(
      'webglcontextlost',
      expect.any(Function),
    )
    expect(addEventListener).toHaveBeenCalledWith(
      'webglcontextrestored',
      expect.any(Function),
    )
    expect(installed.isActive()).toBe(true)

    installed.dispose()
    expect(removeEventListener).toHaveBeenCalledTimes(2)
  })

  it('moves a deferred auto-fit helper and its capture pass to the committed Scene and camera', () => {
    const data = fixture()
    const committedScene = new THREE.Scene()
    committedScene.name = 'Committed Application Scene'
    const committedCamera = new THREE.PerspectiveCamera()
    committedCamera.layers.set(7)
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      deferActivation: true,
    })
    const preparedHelper = data.scene.getObjectByName('Blendlink Contact Shadows Root')
    expect(preparedHelper?.parent).toBe(data.scene)

    data.root.removeFromParent()
    committedScene.add(data.root)
    installed.activate(committedScene, committedCamera)

    expect(data.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    const committedHelper = committedScene.getObjectByName('Blendlink Contact Shadows Root')
    expect(committedHelper).toBe(preparedHelper)
    expect(committedHelper?.parent).toBe(committedScene)

    installed.update()
    expect(data.renderer.calls[0]?.object).toBe(committedScene)
    expect(data.renderer.calls[0]?.camera).toBeInstanceOf(THREE.OrthographicCamera)
    expect(committedHelper?.getObjectByName('Blendlink Contact Shadows Plane')?.layers.mask)
      .toBe(committedCamera.layers.mask)

    installed.dispose()
    expect(committedScene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
  })

  it('retains a refresh requested during a pass and follows the main camera layer mask', () => {
    const data = fixture()
    data.camera.layers.set(7)
    const requestFrame = vi.fn()
    let installed!: ReturnType<typeof installThreeContactShadows>
    let requested = false
    data.renderer.onRender = () => {
      if (!requested) {
        requested = true
        installed.requestRefresh()
      }
    }
    installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      requestFrame,
    })

    installed.update()
    expect(installed.evidence.refreshes).toBe(1)
    expect(installed.isActive()).toBe(true)
    expect(requestFrame).toHaveBeenCalledOnce()
    const helper = data.scene.getObjectByName('Blendlink Contact Shadows Root')!
    expect(helper.userData.blendlink_internal).toBe(true)
    expect(helper.getObjectByName('Blendlink Contact Shadows Plane')?.layers.mask)
      .toBe(data.camera.layers.mask)

    installed.beforeRender()
    installed.update()
    expect(installed.evidence.refreshes).toBe(2)
    expect(installed.isActive()).toBe(false)
    data.camera.layers.set(3)
    installed.update()
    expect(helper.getObjectByName('Blendlink Contact Shadows Plane')?.layers.mask)
      .toBe(data.camera.layers.mask)
    expect(helper.getObjectByName('Blendlink Contact Shadows Occluder')?.layers.mask)
      .toBe(data.camera.layers.mask)
    installed.dispose()
  })

  it('uses an Empty transform for manual placement and rejects Mesh ownership loudly', () => {
    const data = fixture()
    data.anchor.position.set(3, 4, 5)
    data.anchor.scale.set(6, 7, 8)
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: { ...DEFAULTS, autoFit: false },
    })
    const helper = data.anchor.getObjectByName('Blendlink Contact Shadows Root')
    expect(helper?.parent).toBe(data.anchor)
    expect(helper?.position.toArray()).toEqual([0, 0, 0])
    expect(helper?.scale.toArray()).toEqual([1, 1, 1])
    installed.dispose()

    expect(() => installThreeContactShadows({
      ...data,
      anchor: data.caster,
      renderer: renderer(data.renderer),
      values: { ...DEFAULTS, autoFit: false },
    })).toThrow('Attach it to an Empty/group')
  })

  it('isolates overlapping helpers and disposes each owner independently', () => {
    const data = fixture()
    const first = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })
    const firstHelper = data.scene.getObjectByName('Blendlink Contact Shadows Root')!
    const secondAnchor = new THREE.Group()
    data.scene.add(secondAnchor)
    let firstWasExcluded = false
    data.renderer.onRender = (object) => {
      if (object === data.scene) firstWasExcluded = firstHelper.visible === false
    }
    const second = installThreeContactShadows({
      ...data,
      anchor: secondAnchor,
      renderer: renderer(data.renderer),
      values: { ...DEFAULTS, autoFit: false },
    })
    second.update()
    expect(firstWasExcluded).toBe(true)
    expect(firstHelper.visible).toBe(true)
    first.dispose()
    expect(secondAnchor.getObjectByName('Blendlink Contact Shadows Root')).toBeDefined()
    second.dispose()
    expect(secondAnchor.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
  })

  it('disposes every owned GPU resource exactly once', () => {
    const data = fixture()
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })

    installed.dispose()
    installed.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(5)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    targetDispose.mockRestore()
    materialDispose.mockRestore()
    geometryDispose.mockRestore()
  })

  it('rolls back helpers, listeners, and GPU resources when listener setup fails', () => {
    const data = fixture()
    const removeEventListener = vi.fn()
    const surface = {
      addEventListener: vi.fn((type: string) => {
        if (type === 'webglcontextrestored') throw new Error('listener refused')
      }),
      removeEventListener,
    }
    Object.defineProperty(data.renderer, 'domElement', { value: surface })
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')

    expect(() => installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
    })).toThrow('listener refused')
    expect(removeEventListener).toHaveBeenCalledWith(
      'webglcontextlost',
      expect.any(Function),
    )
    expect(data.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    expect(targetDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(5)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    targetDispose.mockRestore()
    materialDispose.mockRestore()
    geometryDispose.mockRestore()
  })

  it('rolls back a partial deferred listener activation and makes the failed lease terminal', () => {
    const data = fixture()
    const committedScene = new THREE.Scene()
    const committedCamera = new THREE.PerspectiveCamera()
    const removeEventListener = vi.fn()
    const surface = {
      addEventListener: vi.fn((type: string) => {
        if (type === 'webglcontextrestored') throw new Error('deferred listener refused')
      }),
      removeEventListener,
    }
    Object.defineProperty(data.renderer, 'domElement', { value: surface })
    const targetDispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose')
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose')
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const installed = installThreeContactShadows({
      ...data,
      renderer: renderer(data.renderer),
      values: DEFAULTS,
      deferActivation: true,
    })

    expect(surface.addEventListener).not.toHaveBeenCalled()
    expect(() => installed.activate(committedScene, committedCamera))
      .toThrow('deferred listener refused')
    expect(removeEventListener).toHaveBeenCalledTimes(1)
    expect(removeEventListener).toHaveBeenCalledWith(
      'webglcontextlost',
      expect.any(Function),
    )
    expect(data.scene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    expect(committedScene.getObjectByName('Blendlink Contact Shadows Root')).toBeUndefined()
    expect(targetDispose).toHaveBeenCalledTimes(2)
    expect(materialDispose).toHaveBeenCalledTimes(5)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(() => installed.activate()).toThrow(/disposed/i)
    installed.dispose()
    expect(targetDispose).toHaveBeenCalledTimes(2)
    targetDispose.mockRestore()
    materialDispose.mockRestore()
    geometryDispose.mockRestore()
  })
})
