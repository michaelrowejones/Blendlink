import { describe, expect, it, vi } from 'vitest'
import { applyCompiledSceneFog } from './sceneFog.js'

describe('compiled scene fog', () => {
  it('leaves application-owned fog untouched', () => {
    const scene = { fog: 'site fog' }
    const descriptor = {
      fog: { mode: 'application', color: [0, 0, 0], near: 10, far: 100, density: 0.02 },
    } as const
    expect(applyCompiledSceneFog(scene, descriptor)).toBeNull()
    expect(scene.fog).toBe('site fog')
  })

  it('applies renderer-native linear/exponential fog and restores cleanly', () => {
    const scene = { fog: 'site fog' as unknown }
    const fog = { kind: 'Three.Fog' }
    const createFog = vi.fn(() => fog)
    const handle = applyCompiledSceneFog(scene, {
      fog: { mode: 'linear', color: [0.1, 0.2, 0.3], near: 5, far: 40, density: 0.02 },
    }, { createFog })!
    expect(createFog).toHaveBeenCalledWith({
      mode: 'linear', color: [0.1, 0.2, 0.3], near: 5, far: 40, density: 0.02,
    })
    expect(scene.fog).toBe(fog)
    handle.dispose()
    expect(scene.fog).toBe('site fog')
    handle.dispose()
  })

  it('can explicitly clear fog and never overwrites a later owner on dispose', () => {
    const scene = { fog: 'old' as unknown }
    const handle = applyCompiledSceneFog(scene, {
      fog: { mode: 'none', color: [0, 0, 0], near: 10, far: 100, density: 0.02 },
    })!
    expect(scene.fog).toBeNull()
    scene.fog = 'new owner'
    handle.dispose()
    expect(scene.fog).toBe('new owner')
  })

  it('fails loudly instead of guessing a renderer constructor', () => {
    expect(() => applyCompiledSceneFog({}, {
      fog: { mode: 'exponential', color: [0, 0, 0], near: 10, far: 100, density: 0.02 },
    })).toThrow(/Three\.Fog or Three\.FogExp2/)
  })
})
