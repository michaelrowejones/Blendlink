import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createThreeRectAreaLightRuntimeForTests } from './threeRectAreaLights.js'

const SLOT_NAMES = ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'] as const

type TestUniforms = typeof THREE.UniformsLib & Partial<Record<typeof SLOT_NAMES[number], THREE.Texture>>

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    color: [0.25, 0.5, 1],
    size: [2, 4],
    power: 10,
    ...overrides,
  }
}

function marker(value: unknown = descriptor()): THREE.Object3D {
  const object = new THREE.Object3D()
  object.name = 'Area_Key'
  object.userData.blendlink_rect_area_light = value
  return object
}

function renderer(floatLinear = true): THREE.WebGLRenderer & {
  initTexture: ReturnType<typeof vi.fn>
} {
  const value = Object.create(THREE.WebGLRenderer.prototype) as THREE.WebGLRenderer & {
    initTexture: ReturnType<typeof vi.fn>
  }
  Object.assign(value, {
    isWebGLRenderer: true,
    extensions: { has: (name: string) => name === 'OES_texture_float_linear' && floatLinear },
    initTexture: vi.fn(),
  })
  return value
}

function runtimeFixture(initial: Partial<Record<typeof SLOT_NAMES[number], THREE.Texture>> = {}) {
  const uniforms = { ...initial } as TestUniforms
  const textures = Object.fromEntries(SLOT_NAMES.map((name) => [name, new THREE.DataTexture()])) as
    Record<typeof SLOT_NAMES[number], THREE.Texture>
  const load = vi.fn(async () => ({
    RectAreaLightUniformsLib: {
      init: vi.fn(() => {
        for (const name of SLOT_NAMES) uniforms[name] = textures[name]
      }),
    },
  }))
  const runtime = createThreeRectAreaLightRuntimeForTests({
    WebGLRenderer: THREE.WebGLRenderer,
    RectAreaLight: THREE.RectAreaLight,
    UniformsLib: uniforms,
  }, load)
  return { runtime, uniforms, textures, load }
}

describe('Three Rect Area light runtime', () => {
  it('does no LTC work when no authored descriptor exists', async () => {
    const { runtime, load } = runtimeFixture()
    const root = new THREE.Group()
    const installed = await runtime.install(
      root,
      { isWebGLRenderer: true } as THREE.WebGLRenderer,
    )

    expect(load).not.toHaveBeenCalled()
    expect(installed.report).toEqual({
      lightsConfigured: 0,
      supportedReceiverCount: 0,
      unsupportedReceiverCount: 0,
    })
    expect(Object.isFrozen(installed.report)).toBe(true)
    installed.dispose()
  })

  it('refuses authored lights on WebGPURenderer with the named LTC-ownership reason', async () => {
    const { runtime, load } = runtimeFixture()
    const root = new THREE.Group()
    root.add(marker())
    await expect(runtime.install(
      root,
      { isWebGPURenderer: true } as unknown as THREE.WebGLRenderer,
    )).rejects.toThrow(/WebGPURenderer.*setLTC/s)
    expect(load).not.toHaveBeenCalled()
  })

  it('installs authored power lights, uploads only the selected LTC pair, and preserves Basic materials', async () => {
    const { runtime, textures, load } = runtimeFixture()
    const root = new THREE.Group()
    root.scale.setScalar(1.5)
    root.rotation.set(0.2, -0.35, 0.1)
    const source = marker()
    source.scale.set(2, 3, 1)
    source.rotation.set(-0.15, 0.25, 0.4)
    root.add(source)

    const standard = new THREE.MeshStandardMaterial()
    const physical = new THREE.MeshPhysicalMaterial()
    const appearance = new THREE.MeshBasicMaterial({ color: 0x2468ac })
    const originalAppearanceColor = appearance.color.getHex()
    const attachedDimensions: Array<[number, number]> = []
    source.addEventListener('childadded', ((event: { child: THREE.Object3D }) => {
      const child = event.child as THREE.RectAreaLight
      if (child.isRectAreaLight) attachedDimensions.push([child.width, child.height])
    }) as never)
    source.add(
      new THREE.Mesh(new THREE.BoxGeometry(), standard),
      new THREE.Mesh(new THREE.BoxGeometry(), physical),
      new THREE.Mesh(new THREE.BoxGeometry(), appearance),
    )
    const webgl = renderer(true)

    const installed = await runtime.install(root, webgl)
    const light = source.children.find((child) => (child as THREE.RectAreaLight).isRectAreaLight) as
      THREE.RectAreaLight
    expect(light).toBeInstanceOf(THREE.RectAreaLight)
    expect(light.name).toBe('Area_Key__Blendlink_RectAreaLight')
    expect(light.color.toArray()).toEqual([0.25, 0.5, 1])
    expect(light.castShadow).toBe(false)
    expect(light.width).toBeCloseTo(6)
    expect(light.height).toBeCloseTo(18)
    expect(light.power).toBeCloseTo(10)
    expect(attachedDimensions).toEqual([[6, 18]])
    expect(light.position.toArray()).toEqual([0, 0, 0])
    expect(light.quaternion.toArray()).toEqual([0, 0, 0, 1])
    expect(light.scale.toArray()).toEqual([1, 1, 1])
    source.updateWorldMatrix(true, false)
    light.updateWorldMatrix(true, false)
    const markerMinusZ = new THREE.Vector3(0, 0, -1).transformDirection(source.matrixWorld)
    const lightMinusZ = new THREE.Vector3(0, 0, -1).transformDirection(light.matrixWorld)
    expect(lightMinusZ.distanceTo(markerMinusZ)).toBeLessThan(1e-10)
    expect(webgl.initTexture.mock.calls.map(([texture]) => texture)).toEqual([
      textures.LTC_FLOAT_1,
      textures.LTC_FLOAT_2,
    ])
    expect(load).toHaveBeenCalledTimes(1)

    installed.auditReceivers()
    expect(Object.isFrozen(installed.report)).toBe(true)
    expect(installed.report).toEqual({
      lightsConfigured: 1,
      supportedReceiverCount: 2,
      unsupportedReceiverCount: 1,
    })
    expect(appearance.color.getHex()).toBe(originalAppearanceColor)
    expect(appearance.isMeshBasicMaterial).toBe(true)

    source.scale.set(4, 2, 1)
    installed.sync()
    expect(light.width).toBeCloseTo(12)
    expect(light.height).toBeCloseTo(12)
    expect(light.power).toBeCloseTo(10)

    const disposals = SLOT_NAMES.map((name) => vi.spyOn(textures[name], 'dispose'))
    installed.dispose()
    installed.dispose()
    expect(source.children).not.toContain(light)
    expect(disposals.every((spy) => spy.mock.calls.length === 0)).toBe(true)

    const halfRenderer = renderer(false)
    const remounted = await runtime.install(root, halfRenderer)
    expect(load).toHaveBeenCalledTimes(1)
    expect(halfRenderer.initTexture.mock.calls.map(([texture]) => texture)).toEqual([
      textures.LTC_HALF_1,
      textures.LTC_HALF_2,
    ])
    remounted.dispose()
  })

  it('maps authored intensity without changing it when world area changes', async () => {
    const { runtime } = runtimeFixture()
    const root = new THREE.Group()
    const source = marker(descriptor({ power: undefined, intensity: 3 }))
    // `undefined` still counts as an authored power field, matching JSON/schema
    // semantics, so remove it explicitly for the valid intensity branch.
    delete source.userData.blendlink_rect_area_light.power
    root.add(source)
    const installed = await runtime.install(root, renderer())
    const light = source.children[0] as THREE.RectAreaLight
    expect(light.intensity).toBe(3)
    source.scale.set(3, 2, 1)
    installed.sync()
    expect(light.width).toBeCloseTo(6)
    expect(light.height).toBeCloseTo(8)
    expect(light.intensity).toBe(3)
    installed.dispose()
  })

  it('honors the public prewarm opt-out while retaining shared LTC correctness', async () => {
    const { runtime, load } = runtimeFixture()
    const root = new THREE.Group()
    root.add(marker())
    const webgl = renderer()

    const installed = await runtime.install(root, webgl, { prewarm: false })
    expect(load).toHaveBeenCalledTimes(1)
    expect(webgl.initTexture).not.toHaveBeenCalled()
    expect(installed.report.lightsConfigured).toBe(1)
    installed.dispose()
  })

  it('validates every descriptor before allocation or scene mutation', async () => {
    const { runtime, load } = runtimeFixture()
    const root = new THREE.Group()
    const first = marker()
    const second = marker(descriptor({ size: [1, 0] }))
    second.name = 'Area_Bad'
    root.add(first, second)

    await expect(runtime.install(root, renderer())).rejects.toThrow('Area_Bad')
    expect(load).not.toHaveBeenCalled()
    expect(first.children).toHaveLength(0)
    expect(second.children).toHaveLength(0)
  })

  it('refuses malformed finalized descriptor payloads before LTC work', async () => {
    const withoutPower = descriptor()
    delete (withoutPower as { power?: unknown }).power
    const malformed: Array<[string, unknown]> = [
      ['non-object', null],
      ['schema', descriptor({ schemaVersion: 2 })],
      ['short color', descriptor({ color: [1, 1] })],
      ['nonfinite color', descriptor({ color: [1, Number.POSITIVE_INFINITY, 1] })],
      ['short size', descriptor({ size: [1] })],
      ['zero size', descriptor({ size: [0, 1] })],
      ['neither strength', withoutPower],
      ['both strengths', descriptor({ intensity: 1 })],
      ['undefined strength', descriptor({ power: undefined })],
      ['negative strength', descriptor({ power: -1 })],
      ['nonfinite strength', descriptor({ power: Number.NaN })],
    ]
    for (const [label, payload] of malformed) {
      const { runtime, load } = runtimeFixture()
      const root = new THREE.Group()
      const source = marker(payload)
      root.add(source)
      await expect(runtime.install(root, renderer()), label).rejects.toThrow()
      expect(load, label).not.toHaveBeenCalled()
      expect(source.children, label).toHaveLength(0)
    }
  })

  it('rejects Lighting-atlas receivers before LTC allocation to avoid probable double illumination', async () => {
    const { runtime, load } = runtimeFixture()
    const root = new THREE.Group()
    root.add(marker())
    const lighting = new THREE.Group()
    lighting.userData.blendlink_atlas = 'room'
    lighting.userData.blendlink_bake_output = 'lighting'
    lighting.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()))
    root.add(lighting)

    await expect(runtime.install(root, renderer())).rejects.toThrow(/Probable double illumination/)
    expect(load).not.toHaveBeenCalled()
  })

  it('reports a fully baked Appearance scene loudly while leaving its Basic material untouched', async () => {
    const { runtime } = runtimeFixture()
    const root = new THREE.Group()
    const source = marker()
    const appearance = new THREE.MeshBasicMaterial()
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), appearance))
    root.add(source)
    const warning = vi.fn()

    const installed = await runtime.install(root, renderer(), { onWarning: warning })
    installed.auditReceivers()
    expect(installed.report.supportedReceiverCount).toBe(0)
    expect(installed.report.unsupportedReceiverCount).toBe(1)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Appearance MeshBasicMaterial'))
    expect(appearance.isMeshBasicMaterial).toBe(true)
    installed.dispose()
  })

  it('rejects a partial LTC global set and a renderer from a second evaluated Three peer', async () => {
    const partial = runtimeFixture({ LTC_FLOAT_1: new THREE.DataTexture() })
    const root = new THREE.Group()
    root.add(marker())
    await expect(partial.runtime.install(root, renderer())).rejects.toThrow(/partially initialized/)
    expect(partial.load).not.toHaveBeenCalled()

    const duplicatePeer = runtimeFixture()
    await expect(duplicatePeer.runtime.install(
      root,
      { isWebGLRenderer: true } as THREE.WebGLRenderer,
    )).rejects.toThrow(/one evaluated Three peer/)
    expect(duplicatePeer.load).not.toHaveBeenCalled()
  })

  it('serializes shared initialization and refuses a concurrent marker owner transactionally', async () => {
    const uniforms = {} as TestUniforms
    const textures = Object.fromEntries(SLOT_NAMES.map((name) => [name, new THREE.DataTexture()])) as
      Record<typeof SLOT_NAMES[number], THREE.Texture>
    let resolveLoad!: (module: {
      RectAreaLightUniformsLib: { init(): void }
    }) => void
    const pending = new Promise<{ RectAreaLightUniformsLib: { init(): void } }>((resolve) => {
      resolveLoad = resolve
    })
    const load = vi.fn(() => pending)
    const runtime = createThreeRectAreaLightRuntimeForTests({
      WebGLRenderer: THREE.WebGLRenderer,
      RectAreaLight: THREE.RectAreaLight,
      UniformsLib: uniforms,
    }, load)
    const root = new THREE.Group()
    const source = marker()
    root.add(source)

    const first = runtime.install(root, renderer())
    const second = runtime.install(root, renderer())
    resolveLoad({
      RectAreaLightUniformsLib: {
        init() { for (const name of SLOT_NAMES) uniforms[name] = textures[name] },
      },
    })
    const installed = await first
    await expect(second).rejects.toThrow(/concurrent installation/)
    expect(load).toHaveBeenCalledTimes(1)
    expect(source.children.filter((child) => (child as THREE.RectAreaLight).isRectAreaLight)).toHaveLength(1)
    installed.dispose()
  })

  it('retains a completed shared LTC cache after cancellation without committing scene lights', async () => {
    const uniforms = {} as TestUniforms
    const textures = Object.fromEntries(SLOT_NAMES.map((name) => [name, new THREE.DataTexture()])) as
      Record<typeof SLOT_NAMES[number], THREE.Texture>
    let resolveLoad!: (module: { RectAreaLightUniformsLib: { init(): void } }) => void
    const pending = new Promise<{ RectAreaLightUniformsLib: { init(): void } }>((resolve) => {
      resolveLoad = resolve
    })
    const runtime = createThreeRectAreaLightRuntimeForTests({
      WebGLRenderer: THREE.WebGLRenderer,
      RectAreaLight: THREE.RectAreaLight,
      UniformsLib: uniforms,
    }, () => pending)
    const root = new THREE.Group()
    const source = marker()
    root.add(source)
    const controller = new AbortController()
    const installing = runtime.install(root, renderer(), { signal: controller.signal })
    controller.abort()
    resolveLoad({
      RectAreaLightUniformsLib: {
        init() { for (const name of SLOT_NAMES) uniforms[name] = textures[name] },
      },
    })

    await expect(installing).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.children).toHaveLength(0)
    const later = await runtime.install(root, renderer())
    expect(source.children.some((child) => (child as THREE.RectAreaLight).isRectAreaLight)).toBe(true)
    later.dispose()
  })

  it('retries a failed LTC initializer provider instead of caching a poisoned promise', async () => {
    const uniforms = {} as TestUniforms
    const textures = Object.fromEntries(SLOT_NAMES.map((name) => [name, new THREE.DataTexture()])) as
      Record<typeof SLOT_NAMES[number], THREE.Texture>
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('temporary LTC chunk failure'))
      .mockResolvedValue({
        RectAreaLightUniformsLib: {
          init() { for (const name of SLOT_NAMES) uniforms[name] = textures[name] },
        },
      })
    const runtime = createThreeRectAreaLightRuntimeForTests({
      WebGLRenderer: THREE.WebGLRenderer,
      RectAreaLight: THREE.RectAreaLight,
      UniformsLib: uniforms,
    }, load)
    const root = new THREE.Group()
    const source = marker()
    root.add(source)

    await expect(runtime.install(root, renderer())).rejects.toThrow(
      /could not access Three RectArea LTC support.*temporary LTC chunk failure/,
    )
    expect(source.children).toHaveLength(0)
    const installed = await runtime.install(root, renderer())
    expect(load).toHaveBeenCalledTimes(2)
    expect(source.children.some((child) => (child as THREE.RectAreaLight).isRectAreaLight)).toBe(true)
    installed.dispose()
  })

  it('refuses a non-extensible marker before attaching a light or claiming ownership', async () => {
    const { runtime } = runtimeFixture()
    const root = new THREE.Group()
    const source = marker()
    root.add(source)
    Object.preventExtensions(source)

    await expect(runtime.install(root, renderer())).rejects.toThrow(/ownership token/)
    expect(source.children).toHaveLength(0)
    await expect(runtime.install(root, renderer())).rejects.toThrow(/ownership token/)
  })

  it('clears ownership through a sealed marker and permits a Strict Mode-style reinstall', async () => {
    const { runtime } = runtimeFixture()
    const root = new THREE.Group()
    const source = marker()
    root.add(source)
    const installed = await runtime.install(root, renderer())
    Object.seal(source)

    expect(() => installed.dispose()).not.toThrow()
    const remounted = await runtime.install(root, renderer())
    expect(remounted.report.lightsConfigured).toBe(1)
    remounted.dispose()
  })

  it('rejects unrepresentable derived dimensions and power intensity transactionally', async () => {
    const dimensionsFixture = runtimeFixture()
    const dimensionsRoot = new THREE.Group()
    const tooWide = marker(descriptor({ size: [Number.MAX_VALUE, 1] }))
    tooWide.scale.x = 2
    dimensionsRoot.add(tooWide)
    await expect(dimensionsFixture.runtime.install(dimensionsRoot, renderer())).rejects.toThrow(
      /world dimensions/,
    )
    expect(tooWide.children).toHaveLength(0)

    const powerFixture = runtimeFixture()
    const powerRoot = new THREE.Group()
    const tooSmall = marker(descriptor({ size: [Number.MIN_VALUE, Number.MIN_VALUE] }))
    powerRoot.add(tooSmall)
    await expect(powerFixture.runtime.install(powerRoot, renderer())).rejects.toThrow(
      /power-to-area intensity/,
    )
    expect(tooSmall.children).toHaveLength(0)

    const underflowFixture = runtimeFixture()
    const underflowRoot = new THREE.Group()
    const underflow = marker(descriptor({ size: [1e100, 1e100], power: Number.MIN_VALUE }))
    underflowRoot.add(underflow)
    await expect(underflowFixture.runtime.install(underflowRoot, renderer())).rejects.toThrow(
      /power-to-area intensity/,
    )
    expect(underflow.children).toHaveLength(0)
  })

  it('synchronizes multiple lights atomically when a later transform becomes invalid', async () => {
    const { runtime } = runtimeFixture()
    const root = new THREE.Group()
    const first = marker()
    first.name = 'Area_First'
    const second = marker()
    second.name = 'Area_Second'
    root.add(first, second)
    const installed = await runtime.install(root, renderer())
    const firstLight = first.children[0] as THREE.RectAreaLight
    const originalWidth = firstLight.width
    first.scale.x = 2
    second.matrixAutoUpdate = false
    second.matrix.set(
      1, 0.25, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    )

    expect(() => installed.sync()).toThrow(/Area_Second.*sheared/)
    expect(firstLight.width).toBe(originalWidth)
    installed.dispose()
  })

  it('refuses a descriptor on an existing light or beside an application-created RectAreaLight', async () => {
    const lightFixture = runtimeFixture()
    const lightRoot = new THREE.Group()
    const punctual = new THREE.PointLight()
    punctual.name = 'Tampered_Point'
    punctual.userData.blendlink_rect_area_light = descriptor()
    lightRoot.add(punctual)
    await expect(lightFixture.runtime.install(lightRoot, renderer())).rejects.toThrow(
      /already a Three light/,
    )
    expect(lightFixture.load).not.toHaveBeenCalled()

    const childFixture = runtimeFixture()
    const childRoot = new THREE.Group()
    const source = marker()
    const applicationLight = new THREE.RectAreaLight()
    source.add(applicationLight)
    childRoot.add(source)
    await expect(childFixture.runtime.install(childRoot, renderer())).rejects.toThrow(
      /already contains a RectAreaLight/,
    )
    expect(source.children).toEqual([applicationLight])
    expect(childFixture.load).not.toHaveBeenCalled()
  })

  it('rejects shear, reflection, and replaced shared LTC identities', async () => {
    const shearFixture = runtimeFixture()
    const shearRoot = new THREE.Group()
    const sheared = marker()
    sheared.matrixAutoUpdate = false
    sheared.matrix.set(
      1, 0.25, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    )
    shearRoot.add(sheared)
    await expect(shearFixture.runtime.install(shearRoot, renderer())).rejects.toThrow(/sheared/)

    // The producer deliberately permits Z shear when the X/Y emitter plane
    // remains orthogonal. Three derives RectArea half-width/half-height from
    // those two columns only, so runtime acceptance must match it.
    const zShearFixture = runtimeFixture()
    const zShearRoot = new THREE.Group()
    const zSheared = marker()
    zSheared.matrixAutoUpdate = false
    zSheared.matrix.set(
      1, 0, 0.5, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    )
    zShearRoot.add(zSheared)
    const zShearInstalled = await zShearFixture.runtime.install(zShearRoot, renderer())
    const zShearLight = zSheared.children[0] as THREE.RectAreaLight
    expect(zShearLight.width).toBeCloseTo(2)
    expect(zShearLight.height).toBeCloseTo(4)
    zShearInstalled.dispose()

    const reflectedFixture = runtimeFixture()
    const reflectedRoot = new THREE.Group()
    const reflected = marker()
    reflected.scale.x = -1
    reflectedRoot.add(reflected)
    await expect(reflectedFixture.runtime.install(reflectedRoot, renderer())).rejects.toThrow(/reflected/)

    const replacementFixture = runtimeFixture()
    const replacementRoot = new THREE.Group()
    replacementRoot.add(marker())
    const installed = await replacementFixture.runtime.install(replacementRoot, renderer())
    installed.dispose()
    replacementFixture.uniforms.LTC_FLOAT_1 = new THREE.DataTexture()
    await expect(replacementFixture.runtime.install(replacementRoot, renderer())).rejects.toThrow(
      /ownership changed/,
    )
  })
})
