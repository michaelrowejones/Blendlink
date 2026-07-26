import { describe, expect, it, vi } from 'vitest'
import { installCompiledSceneCamera, type PresentationCameraLike } from './cameraControls.js'
import type { Object3DLike, SceneBindings } from './runtime.js'

function vector(x: number, y: number, z: number) {
  return { x, y, z, set(nx: number, ny: number, nz: number) { this.x = nx; this.y = ny; this.z = nz } }
}

function camera(name = 'Hero Camera'): PresentationCameraLike {
  return {
    name,
    position: vector(0, 0, 10),
    quaternion: {
      x: 0, y: 0, z: 0, w: 1,
      set(x: number, y: number, z: number, w: number) {
        this.x = x; this.y = y; this.z = z; this.w = w
      },
    },
    isPerspectiveCamera: true,
    fov: 60,
    aspect: 1,
    zoom: 1,
    near: 0.1,
    far: 100,
    updateProjectionMatrix: vi.fn(),
    updateMatrixWorld: vi.fn(),
  }
}

function bindings(entries: Record<string, Object3DLike>): SceneBindings<Object3DLike> {
  return {
    byName: {},
    byId: entries,
    object(id: string) {
      const found = entries[id]
      if (!found) throw new Error(id)
      return found
    },
    dispose() {},
  }
}

const compositions = [
  { name: 'Desktop', width: 1600, height: 900, safeMargin: 0.1 },
  { name: 'Mobile', width: 390, height: 844, safeMargin: 0.12 },
]

describe('compiled camera controls', () => {
  it('keeps fixed/authored cameras untouched and never creates controls invisibly', () => {
    const hero = camera()
    const createControls = vi.fn()
    const descriptor = {
      camera: { objectId: 'camera', objectName: hero.name, behavior: 'fixed', framing: 'authored', compositions },
    } as const
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero }),
      descriptor,
      { createControls },
    )
    expect(handle).toMatchObject({ camera: hero, behavior: 'fixed', interactive: false, initialFit: null })
    expect(createControls).not.toHaveBeenCalled()
    expect(hero.position).toMatchObject({ x: 0, y: 0, z: 10 })
  })

  it('resolves camera and orbit target by stable ID and restores the authored first frame', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    const update = vi.fn()
    const dispose = vi.fn()
    const saveState = vi.fn()
    const createControls = vi.fn(({ camera: installed, target, targetPosition }) => {
      installed.position.set?.(99, 99, 99)
      installed.quaternion?.set?.(1, 0, 0, 0)
      expect(target).toBe(focus)
      expect(targetPosition).toEqual([1, 2, 3])
      return { update, dispose, saveState }
    })
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      { createControls, getWorldPosition: () => [1, 2, 3] },
    )!
    expect(hero.position).toMatchObject({ x: 0, y: 0, z: 10 })
    expect(hero.quaternion).toMatchObject({ x: 0, y: 0, z: 0, w: 1 })
    expect(saveState).toHaveBeenCalledOnce()
    // Unknown application controls stay conservative: Blendlink cannot prove
    // that their internal input, damping, or keyboard state is idle.
    expect(handle.requiresContinuousFrames).toBe(true)
    handle.update(1 / 60)
    expect(update).toHaveBeenCalledWith(1 / 60)
    handle.dispose()
    handle.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(() => handle.update()).toThrow(/disposed/)
  })

  it('exposes an optional live controls activity signal without trusting it before activation', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    let active = false
    const update = vi.fn(() => {
      active = false
    })
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        deferActivation: true,
        getWorldPosition: () => [0, 0, 0],
        createControls: () => ({
          update,
          dispose() {},
          get requiresContinuousFrames() { return active },
        }),
      },
    )!

    expect(handle.interactive).toBe(false)
    expect(handle.requiresContinuousFrames).toBe(false)
    handle.activate()
    expect(handle.interactive).toBe(true)
    expect(handle.requiresContinuousFrames).toBe(false)
    active = true
    expect(handle.requiresContinuousFrames).toBe(true)
    handle.update(1 / 60)
    expect(update).toHaveBeenCalledWith(1 / 60)
    expect(handle.requiresContinuousFrames).toBe(false)
    handle.dispose()
    expect(handle.requiresContinuousFrames).toBe(false)
  })

  it('fits once only when the artist and installer opt in, with composition consequences', () => {
    const hero = camera()
    const root = { name: 'Root' }
    const handle = installCompiledSceneCamera(
      root, bindings({ camera: hero }),
      { camera: { objectId: 'camera', objectName: hero.name, behavior: 'fixed', framing: 'fit-scene', compositions } },
      {
        initialViewport: { width: 1600, height: 900 },
        getViewDirection: () => [0, 0, -1],
        measureBounds: (object) => {
          expect(object).toBe(root)
          return { center: [0, 0, 0], radius: 2 }
        },
      },
    )!
    expect(handle.initialFit).toMatchObject({ scope: 'scene', composition: 'Desktop', safeMargin: 0.1, radius: 2 })
    expect(handle.initialFit!.distance).toBeGreaterThan(4)
    expect(handle.initialFit!.consequence).toMatch(/matches the Desktop composition/)
    expect(hero.position.z).toBeCloseTo(handle.initialFit!.distance)
    expect(hero.aspect).toBeCloseTo(1600 / 900)
    expect(hero.updateProjectionMatrix).toHaveBeenCalledOnce()
  })

  it('makes authored re-fit explicit and lets free-flight controls fit without an orbit target API', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'free', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        getWorldPosition: () => [0, 0, 0],
        getViewDirection: () => [0, 0, -1],
        measureBounds: () => ({ center: [0, 0, 0], radius: 2 }),
        createControls: () => ({ update() {}, dispose() {} }),
      },
    )!
    expect(() => handle.fit({ width: 390, height: 844 })).toThrow(/explicit.*scope/i)
    expect(handle.fit({ width: 390, height: 844 }, 'target')).toMatchObject({ scope: 'target' })

    const clipped = camera('Clipped')
    clipped.far = 2
    const fixed = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ clipped }),
      { camera: { objectId: 'clipped', objectName: clipped.name, behavior: 'fixed', framing: 'authored', compositions } },
      {
        getViewDirection: () => [0, 0, -1],
        measureBounds: () => ({ center: [0, 0, 0], radius: 2 }),
      },
    )!
    expect(() => fixed.fit({ width: 1600, height: 900 }, 'scene')).toThrow(/camera far=.*required above/)
    expect(clipped.position.z).toBe(10)
  })

  it('fails loudly when interactive behavior lacks an explicit adapter', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    expect(() => installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      { getWorldPosition: () => [0, 0, 0] },
    )).toThrow(/never imports or injects browser controls/)
  })

  it('rolls back an explicit fit when controls installation fails', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    expect(() => installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'fit-target',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        initialViewport: { width: 1600, height: 900 },
        getWorldPosition: () => [0, 0, 0],
        getViewDirection: () => [0, 0, -1],
        measureBounds: () => ({ center: [0, 0, 0], radius: 2 }),
        createControls: () => { throw new Error('DOM element unavailable') },
      },
    )).toThrow(/DOM element unavailable/)
    expect(hero.position).toMatchObject({ x: 0, y: 0, z: 10 })
    expect(hero.aspect).toBe(1)
  })

  it('fits an orthographic camera to the real viewport without stretching its frustum', () => {
    const hero = camera('Ortho')
    hero.isPerspectiveCamera = false
    hero.isOrthographicCamera = true
    delete hero.fov
    hero.left = -2; hero.right = 2; hero.top = 2; hero.bottom = -2
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ ortho: hero }),
      { camera: { objectId: 'ortho', objectName: hero.name, behavior: 'fixed', framing: 'fit-scene', compositions } },
      {
        initialViewport: { width: 1600, height: 800 },
        getViewDirection: () => [0, 0, -1],
        measureBounds: () => ({ center: [0, 0, 0], radius: 1 }),
      },
    )!
    expect(hero.left).toBe(-4)
    expect(hero.right).toBe(4)
    expect(hero.zoom).toBeCloseTo(1.6)
    expect(handle.initialFit?.composition).toBe('Desktop')
  })

  it('defers controls until activation and carries the latest fitted camera state into them exactly once', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    const dispose = vi.fn()
    const saveState = vi.fn()
    const getWorldPosition = vi.fn(() => [2, 3, 4] as const)
    const createControls = vi.fn(({ camera: installed, targetPosition }) => {
      expect(targetPosition).toEqual([2, 3, 4])
      installed.position.set?.(99, 99, 99)
      installed.quaternion?.set?.(1, 0, 0, 0)
      installed.aspect = 99
      return { update() {}, dispose, saveState }
    })
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        deferActivation: true,
        createControls,
        getWorldPosition,
        getViewDirection: () => [0, 0, -1],
        measureBounds: () => ({ center: [2, 3, 4], radius: 1 }),
      },
    )!

    expect(getWorldPosition).toHaveBeenCalledOnce()
    expect(createControls).not.toHaveBeenCalled()
    const fitted = handle.fit({ width: 1600, height: 900 }, 'target')
    const fittedPosition = { x: hero.position.x, y: hero.position.y, z: hero.position.z }
    const fittedAspect = hero.aspect

    handle.activate()
    handle.activate()

    expect(createControls).toHaveBeenCalledOnce()
    expect(saveState).toHaveBeenCalledOnce()
    expect(hero.position).toMatchObject(fittedPosition)
    expect(hero.quaternion).toMatchObject({ x: 0, y: 0, z: 0, w: 1 })
    expect(hero.aspect).toBe(fittedAspect)
    expect(hero.position.z).toBeCloseTo(4 + fitted.distance)
    expect(handle.interactive).toBe(true)
    handle.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('reports activation and partial-cleanup failures while leaving the deferred handle cleanable', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    const createControls = vi.fn(() => ({
      update() {},
      dispose() { throw new Error('partial controls would not detach') },
      saveState() { throw new Error('controls could not save fitted state') },
    }))
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        deferActivation: true,
        createControls,
        getWorldPosition: () => [0, 0, 0],
      },
    )!

    expect(() => handle.activate()).toThrow(
      /controls could not save fitted state.*partial controls would not detach/i,
    )
    expect(hero.position).toMatchObject({ x: 0, y: 0, z: 10 })
    expect(hero.quaternion).toMatchObject({ x: 0, y: 0, z: 0, w: 1 })
    expect(handle.interactive).toBe(false)
    expect(() => handle.dispose()).not.toThrow()
    expect(() => handle.activate()).toThrow(/disposed/i)
    expect(createControls).toHaveBeenCalledOnce()
  })

  it('disposes an unactivated deferred camera without constructing controls', () => {
    const hero = camera()
    const focus = { name: 'Focus' }
    const createControls = vi.fn(() => ({ update() {}, dispose() {} }))
    const handle = installCompiledSceneCamera(
      { name: 'Root' }, bindings({ camera: hero, target: focus }),
      {
        camera: {
          objectId: 'camera', objectName: hero.name, behavior: 'orbit', framing: 'authored',
          targetId: 'target', targetName: focus.name, compositions,
        },
      },
      {
        deferActivation: true,
        createControls,
        getWorldPosition: () => [0, 0, 0],
      },
    )!

    handle.dispose()
    handle.dispose()

    expect(createControls).not.toHaveBeenCalled()
    expect(handle.interactive).toBe(false)
    expect(() => handle.activate()).toThrow(/disposed/i)
  })
})
