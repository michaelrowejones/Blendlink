import { Camera, Group, Material, Mesh, MeshStandardMaterial, Scene } from 'three'
import { NodeMaterial } from 'three/webgpu'
import { bool, vec4 } from 'three/tsl'
import { expect, it, vi } from 'vitest'
// @ts-expect-error Upstream private implementation deliberately tested without a fake peer renderer.
import RenderObjects from 'three/src/renderers/common/RenderObjects.js'
import { trackMaterialShadowCache } from './tslMaterialShadowCache.js'
import { installTslMaterials, type MaterialProgramsDocument } from './tslMaterialRuntime.js'

function pass(): Material {
  const material = new Material()
  ;(material as any).isShadowPassMaterial = true
  return material
}
function args(mesh: Mesh, shadow: Material, group: unknown = null): Parameters<Mesh['onBeforeShadow']> {
  return [{} as any, new Scene(), new Camera(), new Camera(), mesh.geometry, shadow, group as any]
}
function draw(mesh: Mesh, shadow: Material, group: unknown = null): void {
  const a = args(mesh, shadow, group)
  mesh.onBeforeShadow(...a)
  mesh.onAfterShadow(...a)
}

it('invalidates only the actual shadow override for active owned material groups', () => {
  const a = new Material(), b = new Material(), stock = new Material(), mesh = new Mesh(undefined, [a, stock, b])
  const shadow = pass(), ordinary = new Material(), release = trackMaterialShadowCache(mesh, new Set([a, b]))
  draw(mesh, shadow, { materialIndex: 1 }); draw(mesh, shadow); draw(mesh, ordinary, { materialIndex: 0 })
  expect(shadow.version).toBe(0); expect(ordinary.version).toBe(0)
  draw(mesh, shadow, { materialIndex: 0 }); draw(mesh, shadow, { materialIndex: 2 })
  expect(shadow.version).toBe(4); expect([a.version, b.version, stock.version]).toEqual([0, 0, 0])
  mesh.material[0] = stock
  draw(mesh, shadow, { materialIndex: 0 }); expect(shadow.version).toBe(4)
  release(); release(); mesh.material[0] = a
  draw(mesh, shadow, { materialIndex: 0 }); expect(shadow.version).toBe(4)
})

it('chains exact app callback arguments and restores out of order without clobbering later wrappers', () => {
  const material = new Material(), mesh = new Mesh(undefined, material), shadow = pass()
  const before = vi.fn(function (this: Mesh) { expect(this).toBe(mesh) }), after = vi.fn(function (this: Mesh) { expect(this).toBe(mesh) })
  mesh.onBeforeShadow = before; mesh.onAfterShadow = after
  const first = trackMaterialShadowCache(mesh, new Set([material])), second = trackMaterialShadowCache(mesh, new Set([material]))
  first(); const a = args(mesh, shadow); mesh.onBeforeShadow(...a); mesh.onAfterShadow(...a)
  expect(before).toHaveBeenCalledExactlyOnceWith(...a); expect(after).toHaveBeenCalledExactlyOnceWith(...a); expect(shadow.version).toBe(2)
  const ownedBefore = mesh.onBeforeShadow, ownedAfter = mesh.onAfterShadow
  const laterBefore: Mesh['onBeforeShadow'] = function (...a) { ownedBefore.apply(this, a) }
  const laterAfter: Mesh['onAfterShadow'] = function (...a) { ownedAfter.apply(this, a) }
  mesh.onBeforeShadow = laterBefore; mesh.onAfterShadow = laterAfter
  second(); draw(mesh, shadow)
  expect(shadow.version).toBe(2); expect(mesh.onBeforeShadow).toBe(laterBefore); expect(mesh.onAfterShadow).toBe(laterAfter)
  const third = trackMaterialShadowCache(mesh, new Set([material])); third()
  expect(mesh.onBeforeShadow).toBe(laterBefore); expect(mesh.onAfterShadow).toBe(laterAfter)
})

it('invalidates a completed masked draw even if the app after-callback disposes or throws', () => {
  const material = new Material(), mesh = new Mesh(undefined, material), shadow = pass(), failure = Error('app after')
  let release: () => void
  mesh.onAfterShadow = () => { release(); throw failure }
  release = trackMaterialShadowCache(mesh, new Set([material]))
  const a = args(mesh, shadow); mesh.onBeforeShadow(...a)
  expect(() => mesh.onAfterShadow(...a)).toThrow(failure); expect(shadow.version).toBe(2)
  expect(() => mesh.onAfterShadow(...a)).toThrow(failure); expect(shadow.version).toBe(2)
})

it('restores the before callback if installing the after callback is refused', () => {
  const mesh = new Mesh(), before = mesh.onBeforeShadow, after = mesh.onAfterShadow, failure = Error('readonly after')
  Object.defineProperty(mesh, 'onAfterShadow', { configurable: true, get: () => after, set: () => { throw failure } })
  expect(() => trackMaterialShadowCache(mesh, new Set([mesh.material as Material]))).toThrow(failure)
  expect(mesh.onBeforeShadow).toBe(before); expect(mesh.onAfterShadow).toBe(after)
})

it('refreshes actual Three RenderObjects when the shader key changes, not on unchanged shadow draws', () => {
  const owned = new Material(), mesh = new Mesh(undefined, owned), shadow = new NodeMaterial()
  ;(shadow as any).isShadowPassMaterial = true
  const opaque = vec4(0, 0, 0, 1), masked = bool(false).select(opaque, opaque)
  shadow.colorNode = opaque
  const objects = new RenderObjects({}, {}, {}, {}, {}, {}), context = {}, lights = {}, camera = new Camera(), scene = new Scene()
  let created = 0
  // Use the real upstream cache-selection code; replace only resource construction,
  // which otherwise needs a real backend. Cache keys remain actual NodeMaterial keys.
  objects.createRenderObject = () => {
    created++
    const key = shadow.customProgramCacheKey()
    return { version: shadow.version, initialCacheKey: key, needsGeometryUpdate: false,
      needsUpdate: false, updateClipping() {}, getCacheKey: () => shadow.customProgramCacheKey(),
      dispose() { objects.getChainMap().delete([mesh, shadow, context, lights]) } }
  }
  const get = () => objects.get(mesh, shadow, scene, camera, lights, context, null)
  get(); expect(created).toBe(1)
  shadow.colorNode = masked
  get(); expect(created).toBe(1) // Reproduces the stale cache without invalidation.
  const release = trackMaterialShadowCache(mesh, new Set([owned])), a = args(mesh, shadow)
  for (let i = 0; i < 5; i++) { mesh.onBeforeShadow(...a); get(); mesh.onAfterShadow(...a) }
  expect(created).toBe(2) // Version checks alone do not recreate unchanged programs.
  release(); mesh.material = new Material(); shadow.colorNode = opaque
  get(); expect(created).toBe(3) // The last after-draw increment survives disposal.
  get(); expect(created).toBe(3)
})

it('installer scopes shadow callbacks to actual masked clones and releases them on dispose or rollback', async () => {
  const make = (name: string) => { const m = new MeshStandardMaterial(); m.userData.blendlink_source_material = name; return m }
  const root = new Group(), masked = new Mesh(undefined, make('Mask')), stock = new Mesh(undefined, make('Ordinary'))
  root.add(masked, stock); const originals = [masked.material, stock.material], before = masked.onBeforeShadow, after = masked.onAfterShadow
  const document: MaterialProgramsDocument = { schemaVersion: 1, model: 'blendlink-material-programs-v1', materials: {
    Mask: { channels: {
      'Base Color': { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'const_vec3', value: [1, 1, 1] } } },
      Metallic: { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'const_float', value: 0 } } },
      Roughness: { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'const_float', value: .5 } } },
      Emission: { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'const_vec3', value: [0, 0, 0] } } },
      Alpha: { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: {
      op: 'shadow_exclusion_native', model: 'eevee53-white-shadow-branch-v1', sourceProfile: 'blender53-macos-metal-shadow-transparent-v1', visibleAlpha: 1, input: { op: 'const_float', value: 1 },
    } } } } }, Ordinary: { channels: { Roughness: { tslIr: { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'const_float', value: .5 } } } } },
  } }
  const options = { root, descriptor: { materialPrograms: { url: 'x', bytes: 1, hash: 'x', materials: 2 } }, loadPrograms: async () => document }
  const handle = await installTslMaterials(options), shadow = pass()
  expect(handle.applied).toBe(2); draw(masked, shadow); draw(stock, shadow); expect(shadow.version).toBe(2)
  handle.dispose(); handle.dispose(); expect([masked.material, stock.material]).toEqual(originals)
  expect(masked.onBeforeShadow).toBe(before); expect(masked.onAfterShadow).toBe(after)
  const failure = Error('later mesh callback readonly'), previous = stock.onBeforeRender
  Object.defineProperty(stock, 'onBeforeRender', { configurable: true, get: () => previous, set: () => { throw failure } })
  await expect(installTslMaterials(options)).rejects.toThrow(failure)
  expect([masked.material, stock.material]).toEqual(originals)
  expect(masked.onBeforeShadow).toBe(before); expect(masked.onAfterShadow).toBe(after)
})
