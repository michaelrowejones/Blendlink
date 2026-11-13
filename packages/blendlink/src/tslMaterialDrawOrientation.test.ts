import { BufferGeometry, Camera, Material, Matrix4, Mesh, Scene } from 'three'
import { expect, it, vi } from 'vitest'
import { trackMaterialDrawCallback, trackMaterialDrawOrientation } from './tslMaterialDrawOrientation.js'

function draw(mesh: Mesh, material: Material, webgpu = true, group: unknown = null): void {
  mesh.onBeforeRender(
    { backend: { isWebGPUBackend: webgpu } } as any,
    new Scene(),
    new Camera(),
    mesh.geometry,
    material,
    group as any,
  )
}
function sign(mesh: Mesh, value: number): void {
  mesh.matrixWorld.copy(new Matrix4().makeScale(value, 1, 1))
}

it('invalidates only the active installed group material once per WebGPU sign change', () => {
  const a = new Material(),
    b = new Material(),
    portable = new Material()
  const mesh = new Mesh(new BufferGeometry(), [a, portable, b])
  const restore = trackMaterialDrawOrientation(mesh, new Set([a, b]))
  draw(mesh, a)
  draw(mesh, b)
  const initial = [a.version, b.version, portable.version]
  sign(mesh, -1)
  draw(mesh, portable, true, { materialIndex: 1 })
  expect([a.version, b.version, portable.version]).toEqual(initial)
  draw(mesh, a, true, { materialIndex: 0 })
  expect([a.version, b.version]).toEqual([initial[0]! + 1, initial[1]])
  for (let index = 0; index < 20; index++) draw(mesh, a)
  expect(a.version).toBe(initial[0]! + 1)
  draw(mesh, b, true, { materialIndex: 2 })
  expect(b.version).toBe(initial[1]! + 1)
  sign(mesh, 1)
  draw(mesh, a)
  expect(a.version).toBe(initial[0]! + 2)
  restore()
})

it('keeps shared-owner state separate and leaves WebGL2 draws idle', () => {
  const shared = new Material(),
    a = new Mesh(),
    b = new Mesh()
  const releaseA = trackMaterialDrawOrientation(a, new Set([shared]))
  const releaseB = trackMaterialDrawOrientation(b, new Set([shared]))
  sign(b, -1)
  for (let index = 0; index < 5; index++) {
    draw(a, shared)
    draw(b, shared)
  }
  expect(shared.version).toBe(0)
  sign(a, -1)
  draw(a, shared, false)
  expect(shared.version).toBe(0)
  draw(a, shared)
  expect(shared.version).toBe(1)
  draw(b, shared)
  expect(shared.version).toBe(1)
  releaseA()
  releaseB()
})

it('calls the user callback first with its exact receiver and active group arguments', () => {
  const material = new Material(),
    mesh = new Mesh(),
    calls: unknown[] = []
  mesh.onBeforeRender = function (...args) {
    calls.push([this, args])
    sign(mesh, calls.length === 1 ? 1 : -1)
  }
  const previous = mesh.onBeforeRender,
    restore = trackMaterialDrawOrientation(mesh, new Set([material]))
  const group = { start: 3, count: 3, materialIndex: 2 }
  draw(mesh, material, true, group)
  draw(mesh, material, true, group)
  expect((calls[0] as any)[0]).toBe(mesh)
  expect((calls[0] as any)[1][4]).toBe(material)
  expect((calls[0] as any)[1][5]).toBe(group)
  expect(material.version).toBe(1)
  restore()
  restore()
  expect(mesh.onBeforeRender).toBe(previous)
})

it('preserves later user callbacks and unwraps disposed managed callbacks during reapplication', () => {
  const material = new Material(),
    mesh = new Mesh(),
    user = vi.fn()
  mesh.onBeforeRender = user
  const first = trackMaterialDrawOrientation(mesh, new Set([material]))
  const second = trackMaterialDrawOrientation(mesh, new Set([material]))
  first()
  draw(mesh, material)
  expect(user).toHaveBeenCalledTimes(1)
  second()
  expect(mesh.onBeforeRender).toBe(user)
  const third = trackMaterialDrawOrientation(mesh, new Set([material]))
  const installed = mesh.onBeforeRender
  mesh.onBeforeRender = function (...args) {
    installed.apply(this, args)
  }
  const replacement = mesh.onBeforeRender
  third()
  sign(mesh, -1)
  draw(mesh, material)
  expect(mesh.onBeforeRender).toBe(replacement)
  expect(material.version).toBe(0)
  const fourth = trackMaterialDrawOrientation(mesh, new Set([material]))
  fourth()
  expect(mesh.onBeforeRender).toBe(replacement)
})

it('shares lease cleanup with per-material validation and never invokes a released validator',()=>{
  const material=new Material(),portable=new Material(),mesh=new Mesh(),user=vi.fn(),validate=vi.fn()
  mesh.onBeforeRender=user
  const orientation=trackMaterialDrawOrientation(mesh,new Set([material]))
  const guard=trackMaterialDrawCallback(mesh,new Set([material]),validate)
  draw(mesh,portable);expect(validate).not.toHaveBeenCalled()
  draw(mesh,material);expect(validate).toHaveBeenCalledTimes(1)
  orientation();guard()
  expect(mesh.onBeforeRender).toBe(user)
  draw(mesh,material);expect(validate).toHaveBeenCalledTimes(1)
})
