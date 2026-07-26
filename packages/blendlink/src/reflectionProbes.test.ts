import { describe, expect, it, vi } from 'vitest'
import {
  applyCompiledSceneReflectionProbes,
  createThreeWebGLReflectionCapture,
  type ReflectionProbeRuntimeContext,
} from './reflectionProbes.js'

const probe = {
  id: 'hero-metal', name: 'Hero Metal', objectId: 'probe-uuid', objectName: 'Hero_Probe',
  shape: 'box' as const, source: 'runtime' as const, resolution: 256, samples: 128,
  influence: 8, intensity: 1.25,
  anchorId: 'anchor-uuid', anchorName: 'Hero_Anchor',
}

function descriptor() {
  return {
    url: '/hero.glb',
    nodes: { Hero: 'Hero_Mesh', Probe: 'Hero_Probe', Anchor: 'Hero_Anchor' },
    objectsById: {
      'mesh-uuid': 'Hero_Mesh',
      'probe-uuid': 'Hero_Probe',
      'anchor-uuid': 'Hero_Anchor',
    },
    extras: { Hero_Mesh: { blendlink_reflection_probe: 'probe-uuid' } },
    reflectionProbes: [probe],
  }
}

describe('reflection probe runtime adapter', () => {
  it('provides an owned one-call Three WebGL CubeCamera to PMREM capture', () => {
    const calls: string[] = []
    const cubeTarget = { texture: { cube: true }, dispose: () => calls.push('cube.dispose') }
    const pmremTarget = { texture: { pmrem: true }, dispose: () => calls.push('pmrem.dispose') }
    class Vector {
      copy() { calls.push('position.copy'); return this }
    }
    const capture = createThreeWebGLReflectionCapture({
      THREE: {
        Vector3: Vector,
        WebGLCubeRenderTarget: class {
          texture = cubeTarget.texture
          constructor(resolution: number) { expect(resolution).toBe(256) }
          dispose() { cubeTarget.dispose() }
        },
        CubeCamera: class {
          position = new Vector()
          constructor(near: number, far: number) {
            expect(near).toBe(0.05)
            expect(far).toBe(1000)
          }
          updateMatrixWorld() { calls.push('camera.matrix') }
          update() { calls.push('camera.update') }
        },
        PMREMGenerator: class {
          compileCubemapShader() { calls.push('pmrem.compile') }
          fromCubemap(texture: unknown) {
            expect(texture).toBe(cubeTarget.texture)
            calls.push('pmrem.fromCube')
            return pmremTarget
          }
          dispose() { calls.push('generator.dispose') }
        },
      },
      renderer: { webgl: true },
      scene: { name: 'Scene' },
    })
    const receiver = { name: 'ReflectiveReceiver', visible: true, children: [] }
    const anchor = {
      name: 'Anchor', children: [],
      getWorldPosition(target: Vector) { calls.push('anchor.world'); return target },
    }
    const resource = capture({
      definition: probe,
      probeObject: anchor,
      anchorObject: anchor,
      assignedObjects: [receiver],
    })
    expect(receiver.visible).toBe(true)
    expect(resource.texture).toBe(pmremTarget.texture)
    expect(calls).toEqual([
      'anchor.world', 'position.copy', 'camera.matrix', 'camera.update',
      'pmrem.compile', 'pmrem.fromCube', 'cube.dispose', 'generator.dispose',
    ])
    resource.dispose?.()
    expect(calls.at(-1)).toBe('pmrem.dispose')
  })

  it('restores runtime-capture receiver visibility and temporary GPU resources on failure', () => {
    const calls: string[] = []
    const receiver = { name: 'ClosedChrome', visible: true, children: [] }
    class Vector {
      copy() { return this }
    }
    const capture = createThreeWebGLReflectionCapture({
      THREE: {
        Vector3: Vector,
        WebGLCubeRenderTarget: class {
          texture = {}
          dispose() { calls.push('cube.dispose') }
        },
        CubeCamera: class {
          position = new Vector()
          updateMatrixWorld() {}
          update() {
            expect(receiver.visible).toBe(false)
            throw new Error('intentional CubeCamera failure')
          }
        },
        PMREMGenerator: class {
          fromCubemap() { throw new Error('PMREM must not run') }
          dispose() { calls.push('generator.dispose') }
        },
      },
      renderer: {},
      scene: {},
    })
    const anchor = {
      name: 'Anchor',
      children: [],
      getWorldPosition(target: Vector) { return target },
    }

    expect(() => capture({
      definition: probe,
      probeObject: anchor,
      anchorObject: anchor,
      assignedObjects: [receiver],
    })).toThrow(/intentional CubeCamera failure/)
    expect(receiver.visible).toBe(true)
    expect(calls).toEqual(['cube.dispose', 'generator.dispose'])
  })

  it('applies a supplied PMREM only to explicitly assigned cloned materials', async () => {
    const disposeClone = vi.fn()
    const original = {
      envMap: null as unknown,
      envMapIntensity: 0,
      needsUpdate: false,
      clone() { return { ...this, clone: this.clone, dispose: disposeClone } },
    }
    const hero = { name: 'Hero_Mesh', material: original, children: [] }
    const probeObject = { name: 'Hero_Probe', children: [] }
    const anchor = { name: 'Hero_Anchor', children: [] }
    const root = { name: 'Scene', children: [hero, probeObject, anchor] }
    const texture = { name: 'Hero PMREM' }
    const disposeTexture = vi.fn()
    const releaseClone = vi.fn()
    const trackMaterialClone = vi.fn(() => releaseClone)

    const applied = await applyCompiledSceneReflectionProbes(root, descriptor(), {
      providedTextures: { 'hero-metal': { texture, dispose: disposeTexture } },
      trackMaterialClone,
    })

    expect(hero.material).not.toBe(original)
    expect(hero.material).toMatchObject({ envMap: texture, envMapIntensity: 1.25, needsUpdate: true })
    expect(applied.report).toEqual({
      probesConfigured: 1, objectsAssigned: 1, runtimeCaptures: 0,
      publishedTextures: 0, capturePixels: 0, unusedProbes: [],
    })
    applied.dispose()
    expect(hero.material).toBe(original)
    expect(trackMaterialClone).toHaveBeenCalledWith(
      original, expect.any(Object), expect.objectContaining({ definition: probe }),
    )
    expect(releaseClone).toHaveBeenCalledWith(false)
    expect(disposeClone).toHaveBeenCalledOnce()
    expect(disposeTexture).toHaveBeenCalledOnce()
  })

  it('loads a published baked/custom source instead of silently capturing at runtime', async () => {
    const hero = { name: 'Hero_Mesh', children: [] }
    const probeObject = { name: 'Hero_Probe', children: [] }
    const anchor = { name: 'Hero_Anchor', children: [] }
    const asset = {
      url: '/hero-probe.exr?v=abc', sourceName: 'Hero Probe.exr', mode: 'baked' as const,
      format: 'exr' as const, colorSpace: 'linear' as const, width: 1024, height: 512,
      bytes: 123, hash: 'abc', source: 'linked' as const, sourceHash: 'source',
    }
    const loadTexture = vi.fn(() => ({ texture: { pmrem: true } }))
    const capture = vi.fn(() => ({ texture: { runtime: true } }))
    const result = await applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [hero, probeObject, anchor] },
      {
        ...descriptor(),
        reflectionProbes: [{ ...probe, source: 'baked' as const }],
        reflectionProbeAssets: { 'hero-metal': asset },
      },
      {
        loadTexture,
        capture,
        assignTexture() {},
      },
    )
    expect(loadTexture).toHaveBeenCalledWith(asset, expect.objectContaining({
      definition: expect.objectContaining({ id: 'hero-metal', source: 'baked' }),
    }))
    expect(capture).not.toHaveBeenCalled()
    expect(result.report).toMatchObject({
      probesConfigured: 1, publishedTextures: 1, runtimeCaptures: 0, capturePixels: 0,
    })
  })

  it('passes resolution, influence, anchor, and assignment context to runtime capture', async () => {
    const hero = { name: 'Hero_Mesh', children: [] }
    const probeObject = { name: 'Hero_Probe', children: [] }
    const anchor = { name: 'Hero_Anchor', children: [] }
    const capture = vi.fn((context: ReflectionProbeRuntimeContext) => {
      expect(context.definition).toMatchObject({ resolution: 256, influence: 8, shape: 'box' })
      expect(context.anchorObject).toBe(anchor)
      expect(context.assignedObjects).toEqual([hero])
      return { texture: { name: 'Captured PMREM' } }
    })
    const assigned: unknown[] = []
    const result = await applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [hero, probeObject, anchor] },
      descriptor(),
      {
        capture,
        assignTexture(object, resource) { assigned.push([object, resource.texture]) },
      },
    )
    expect(capture).toHaveBeenCalledOnce()
    expect(assigned).toHaveLength(1)
    expect(result.report).toMatchObject({
      probesConfigured: 1, runtimeCaptures: 1, capturePixels: 6 * 256 ** 2,
    })
  })

  it('captures every probe before assigning local env maps so list order cannot contaminate captures', async () => {
    const originalA = { envMap: null }
    const originalB = { envMap: null }
    const heroA = { name: 'Hero_A', material: originalA, children: [] }
    const heroB = { name: 'Hero_B', material: originalB, children: [] }
    const probeA = { name: 'Probe_A', userData: { blendlink_id: 'probe-a' }, children: [] }
    const probeB = { name: 'Probe_B', userData: { blendlink_id: 'probe-b' }, children: [] }
    const events: string[] = []
    const result = await applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [heroA, heroB, probeA, probeB] },
      {
        url: '/hero.glb',
        nodes: { HeroA: 'Hero_A', HeroB: 'Hero_B' },
        objectsById: { 'probe-a': 'Probe_A', 'probe-b': 'Probe_B' },
        extras: {
          Hero_A: { blendlink_reflection_probe: 'probe-a' },
          Hero_B: { blendlink_reflection_probe: 'probe-b' },
        },
        reflectionProbes: [
          {
            ...probe, id: 'a', name: 'A', objectId: 'probe-a', objectName: 'Probe_A',
            anchorId: 'probe-a', anchorName: 'Probe_A',
          },
          {
            ...probe, id: 'b', name: 'B', objectId: 'probe-b', objectName: 'Probe_B',
            anchorId: 'probe-b', anchorName: 'Probe_B',
          },
        ],
      },
      {
        capture(context) {
          events.push(`capture:${context.definition.id}`)
          expect(heroA.material).toBe(originalA)
          expect(heroB.material).toBe(originalB)
          return { texture: { probe: context.definition.id } }
        },
        assignTexture(object, resource, context) {
          events.push(`assign:${context.definition.id}`)
          object.material = { envMap: resource.texture }
        },
      },
    )
    expect(events).toEqual(['capture:a', 'capture:b', 'assign:a', 'assign:b'])
    expect(result.report).toMatchObject({ probesConfigured: 2, objectsAssigned: 2, runtimeCaptures: 2 })
  })

  it('does not clobber or release a reflection assignment transferred to a later owner', async () => {
    const disposeClone = vi.fn()
    const original = {
      envMap: null as unknown,
      clone() { return { ...this, clone: this.clone, dispose: disposeClone } },
    }
    const hero = { name: 'Hero_Mesh', material: original, children: [] }
    const probeObject = { name: 'Hero_Probe', children: [] }
    const anchor = { name: 'Hero_Anchor', children: [] }
    const disposeTexture = vi.fn()
    const releaseClone = vi.fn()
    const applied = await applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [hero, probeObject, anchor] },
      descriptor(),
      {
        providedTextures: { 'hero-metal': { texture: {}, dispose: disposeTexture } },
        trackMaterialClone: () => releaseClone,
      },
    )
    const laterMaterial = { envMap: 'application' }
    ;(hero as { material: unknown }).material = laterMaterial

    applied.dispose()
    expect((hero as { material: unknown }).material).toBe(laterMaterial)
    expect(disposeClone).not.toHaveBeenCalled()
    expect(disposeTexture).not.toHaveBeenCalled()
    expect(releaseClone).toHaveBeenCalledWith(true)
  })

  it('does not capture unused probes and fails loudly for stale assignments', async () => {
    const probeObject = { name: 'Hero_Probe', children: [] }
    const anchor = { name: 'Hero_Anchor', children: [] }
    const capture = vi.fn(() => ({ texture: {} }))
    const unusedDescriptor = { ...descriptor(), extras: {} }
    const unused = await applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [probeObject, anchor] }, unusedDescriptor, { capture },
    )
    expect(capture).not.toHaveBeenCalled()
    expect(unused.report.unusedProbes).toEqual(['hero-metal'])

    await expect(applyCompiledSceneReflectionProbes(
      { name: 'Scene', children: [{ name: 'Hero_Mesh', children: [] }, probeObject, anchor] },
      {
        ...descriptor(),
        extras: { Hero_Mesh: { blendlink_reflection_probe: 'deleted-probe' } },
      },
      { capture },
    )).rejects.toThrow(/missing reflection probe/)
  })
})
