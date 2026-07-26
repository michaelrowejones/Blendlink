import { describe, expect, it } from 'vitest'
import {
  startCompiledSceneLods,
  type LodObjectLike,
  type LodVectorLike,
} from './lodRuntime.js'
import type { LodChainDiagnostic } from './sceneDiagnostics.js'

class Vector implements LodVectorLike {
  constructor(public x = 0) {}
  distanceTo(other: Vector): number { return Math.abs(this.x - other.x) }
}

type Positioned = LodObjectLike & { x: number }

function object(name: string, x: number, visible = true): Positioned {
  return {
    name, x, visible, children: [],
    getWorldPosition(target: Vector) { target.x = this.x; return target },
  }
}

function chain(valid = true): LodChainDiagnostic {
  return {
    base: 'Rock', valid,
    warnings: valid ? [] : ['Rock_LOD1 needs a positive switch distance'],
    drawCallsWithoutAdapter: 2, drawCallsWithAdapter: 1,
    levels: [
      { index: 0, node: 'Rock_LOD0', loadedName: 'Rock_LOD0', id: 'rock-near', distance: 0, drawCalls: 1 },
      { index: 1, node: 'Rock_LOD1', loadedName: 'Rock_LOD1', id: 'rock-far', distance: 10, drawCalls: 1 },
    ],
  }
}

describe('LOD runtime adapter', () => {
  it('keeps one level visible, applies hysteresis, and restores ownership', () => {
    const near = { ...object('PrivateSuffix_8', 0, true), userData: { blendlink_id: 'rock-near' } }
    const far = { ...object('PrivateSuffix_9', 0, true), userData: { blendlink_id: 'rock-far' } }
    const camera = object('Camera', 0)
    const root: LodObjectLike = { name: 'Scene', children: [near, far] }
    const handle = startCompiledSceneLods(root, camera, {
      runtimeDiagnostics: {
        schemaVersion: 1,
        lodChains: [chain()],
        instanceGroups: [],
      },
    }, { createVector3: () => new Vector(), hysteresis: 0.05 })
    expect(handle?.active.Rock).toBe(0)
    expect([near.visible, far.visible]).toEqual([true, false])

    camera.x = 10.2
    handle?.update()
    expect(handle?.active.Rock).toBe(0)
    camera.x = 10.6
    handle?.update()
    expect(handle?.active.Rock).toBe(1)
    expect([near.visible, far.visible]).toEqual([false, true])

    camera.x = 9.7
    handle?.update()
    expect(handle?.active.Rock).toBe(1)
    camera.x = 9.4
    handle?.update()
    expect(handle?.active.Rock).toBe(0)

    near.visible = false // a later application owner wins
    handle?.stop()
    handle?.stop()
    expect([near.visible, far.visible]).toEqual([false, true])
    expect(() => handle?.update()).toThrow(/already been stopped/)
  })

  it('fails before changing visibility when compiler diagnostics are invalid', () => {
    const near = object('Rock_LOD0', 0)
    const far = object('Rock_LOD1', 0)
    expect(() => startCompiledSceneLods(
      { name: 'Scene', children: [near, far] }, object('Camera', 0),
      { sceneDiagnostics: { lod: { chains: [chain(false)] } } },
      { createVector3: () => new Vector() },
    )).toThrow(/positive switch distance/)
    expect([near.visible, far.visible]).toEqual([true, true])
  })
})
