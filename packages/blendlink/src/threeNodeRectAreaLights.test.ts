import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { WebGPURenderer, RectAreaLightNode, MeshStandardNodeMaterial } from 'three/webgpu'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
import { acquireRendererLocalRectAreaLights } from './threeNodeRectAreaLights.js'
import { installThreeRectAreaLights } from './threeRectAreaLights.js'

function renderer() {
  const value = Object.create(WebGPURenderer.prototype) as WebGPURenderer
  const mappings = new Map<Function, Function>([[THREE.RectAreaLight, RectAreaLightNode]])
  Object.assign(value, { isWebGPURenderer: true, library: {
    addLight(Node: Function, Light: Function) { if (mappings.has(Light)) throw Error('duplicate mapping'); mappings.set(Light, Node) },
    getLightNodeClass(Light: Function) { return mappings.get(Light) ?? null },
  }, initTexture: vi.fn(async () => {}) })
  return { value, mappings }
}
const slots = ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'] as const
const globals = () => slots.map(key => [(RectAreaLightTexturesLib as any)[key], (THREE.UniformsLib as any)[key]])

describe('renderer-local node Rect Area ownership', () => {
  it('isolates two renderers and preserves all application global tables and base light registration', async () => {
    const before = globals(), setter = vi.spyOn(RectAreaLightNode, 'setLTC'), a = renderer(), b = renderer()
    const first = await acquireRendererLocalRectAreaLights(a.value, {}), overlap = await acquireRendererLocalRectAreaLights(a.value, {}), other = await acquireRendererLocalRectAreaLights(b.value, {})
    expect(first.Light).toBe(overlap.Light); expect(first.Light).not.toBe(other.Light)
    expect(a.mappings.get(THREE.RectAreaLight)).toBe(RectAreaLightNode)
    const maps = vi.mocked(a.value.initTexture).mock.calls.slice(0, 4).map(([map]) => map)
    const disposed = maps.map(map => vi.spyOn(map, 'dispose'))
    first.release(); expect(disposed.every(spy => spy.mock.calls.length === 0)).toBe(true)
    overlap.assertActive(); overlap.release(); expect(disposed.every(spy => spy.mock.calls.length === 1)).toBe(true)
    overlap.release(); expect(disposed.every(spy => spy.mock.calls.length === 1)).toBe(true)
    const remount = await acquireRendererLocalRectAreaLights(a.value, {})
    expect(remount.Light).toBe(first.Light); expect(a.mappings.size).toBe(2)
    remount.release(); other.release()
    expect(globals()).toEqual(before); expect(setter).not.toHaveBeenCalled(); setter.mockRestore()
  })
  it('cleans partially allocated tables when the private initializer fails and can retry', async () => {
    const a = renderer(), map = new THREE.DataTexture(), dispose = vi.spyOn(map, 'dispose')
    const initialize = vi.spyOn(RectAreaLightTexturesLib, 'init').mockImplementationOnce(function (this: any) {
      this.LTC_FLOAT_1 = map
      throw new Error('initializer failed')
    })
    await expect(acquireRendererLocalRectAreaLights(a.value, {})).rejects.toThrow('initializer failed')
    expect(dispose).toHaveBeenCalledOnce()
    initialize.mockRestore()
    const lease = await acquireRendererLocalRectAreaLights(a.value, {})
    lease.release()
  })
  it('releases all tables after an upload failure and honors lazy prewarm', async () => {
    const a = renderer(), dispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose')
    a.value.initTexture = vi.fn(async () => { throw new Error('upload failed') })
    await expect(acquireRendererLocalRectAreaLights(a.value, {})).rejects.toThrow('upload failed')
    expect(dispose).toHaveBeenCalledTimes(4)
    const lazy = await acquireRendererLocalRectAreaLights(a.value, { prewarm: false })
    expect(a.value.initTexture).toHaveBeenCalledOnce()
    lazy.release(); expect(dispose).toHaveBeenCalledTimes(8)
    dispose.mockRestore()
  })
  it('cleans canceled/failed prewarm and refuses a fake or replaced mapping', async () => {
    await expect(acquireRendererLocalRectAreaLights({ isWebGPURenderer: true }, {})).rejects.toThrow(/same evaluated/)
    const a = renderer(), controller = new AbortController(), maps: THREE.Texture[] = []
    a.value.initTexture = vi.fn(async map => { maps.push(map); controller.abort() })
    await expect(acquireRendererLocalRectAreaLights(a.value, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    a.value.initTexture = vi.fn(async () => {})
    const retry = await acquireRendererLocalRectAreaLights(a.value, {})
    a.mappings.set(retry.Light, RectAreaLightNode)
    expect(() => retry.assertActive()).toThrow(/no longer active/)
    retry.release()
    await expect(acquireRendererLocalRectAreaLights(a.value, {})).rejects.toThrow(/replaced/)
  })
  it('preserves the upload failure when all disposal listeners throw and permits a fresh lease', async () => {
    const a = renderer(), primary = new Error('primary upload failure')
    a.value.initTexture = vi.fn(async () => { throw primary })
    const dispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose').mockImplementation(() => {
      throw new Error('dispose listener failure')
    })
    try {
      const failure = await acquireRendererLocalRectAreaLights(a.value, {}).catch(error => error)
      expect(failure).toBeInstanceOf(AggregateError)
      expect(failure.message).toMatch(/primary upload failure.*Cleanup also failed/)
      expect(failure.cause).toBe(primary)
      expect(failure.errors[0]).toBe(primary)
      expect(failure.errors[1].message).toContain('dispose listener failure')
      expect(dispose).toHaveBeenCalledTimes(4)
    } finally { dispose.mockRestore() }
    const retry = await acquireRendererLocalRectAreaLights(a.value, { prewarm: false })
    retry.assertActive()
    retry.release()
  })
  it('installs authored children only with opt-in and counts node PBR receivers', async () => {
    const root = new THREE.Group(), marker = new THREE.Object3D(), r = renderer()
    marker.userData.blendlink_rect_area_light = { schemaVersion: 1, color: [1, .5, .25], size: [2, 4], power: 100 }
    root.add(marker, new THREE.Mesh(new THREE.BoxGeometry(), new MeshStandardNodeMaterial()))
    await expect(installThreeRectAreaLights(root, r.value as any)).rejects.toThrow(/explicit nodeRectAreaLights/)
    const handle = await installThreeRectAreaLights(root, r.value as any, { nodeRectAreaLights: 'renderer-local' })
    expect(marker.children).toHaveLength(1); expect(marker.children[0]).toBeInstanceOf(THREE.RectAreaLight)
    handle.auditReceivers(); expect(handle.report.supportedReceiverCount).toBe(1)
    handle.sync(); handle.dispose(); expect(marker.children).toHaveLength(0)
  })
})
