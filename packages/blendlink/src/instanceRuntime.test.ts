import { describe, expect, it, vi } from 'vitest'
import {
  applyCompiledSceneInstances,
  type InstanceBatchLike,
  type InstanceObjectLike,
  type InstanceParentLike,
} from './instanceRuntime.js'
import type { InstanceSourceDiagnostic } from './sceneDiagnostics.js'

function group(): InstanceSourceDiagnostic {
  return {
    id: 'trees', meshData: 'TreeMesh', count: 2, eligible: true, reasons: [],
    members: [
      { name: 'Tree A', loadedName: 'Tree_A', id: 'tree-a' },
      { name: 'Tree B', loadedName: 'Tree_B', id: 'tree-b' },
    ],
    drawCallsSeparate: 2, drawCallsInstanced: 1, drawCallsSaved: 1,
    emission: 'shared-data',
  }
}

describe('runtime instance batching', () => {
  it('preserves stable hit identity, updates transforms, and restores originals', () => {
    const geometry = {}
    const material = {}
    const added: InstanceBatchLike[] = []
    const removed: InstanceBatchLike[] = []
    const parent: InstanceParentLike = {
      add(batch) { added.push(batch) },
      remove(batch) { removed.push(batch) },
    }
    const first: InstanceObjectLike = {
      name: 'PrivateSuffix_4', userData: { blendlink_id: 'tree-a' },
      visible: true, geometry, material, matrix: { x: 1 }, parent, children: [],
    }
    const second: InstanceObjectLike = {
      name: 'PrivateSuffix_5', userData: { blendlink_id: 'tree-b' },
      geometry, material, matrix: { x: 2 }, parent, children: [],
    }
    const matrices: unknown[] = []
    const dispose = vi.fn()
    const batch: InstanceBatchLike = {
      instanceMatrix: {},
      setMatrixAt(index, matrix) { matrices[index] = matrix },
      computeBoundingSphere: vi.fn(),
      dispose,
    }
    const handle = applyCompiledSceneInstances(
      { name: 'Scene', children: [first, second] },
      {
        runtimeDiagnostics: {
          schemaVersion: 1,
          lodChains: [],
          instanceGroups: [group()],
        },
      },
      { createInstancedMesh: () => batch },
    )
    expect(handle?.report).toEqual({ groupsBatched: 1, instancesBatched: 2, drawCallsSaved: 1 })
    expect(added).toEqual([batch])
    expect([first.visible, second.visible]).toEqual([false, false])
    expect(matrices).toEqual([{ x: 1 }, { x: 2 }])
    expect(batch.userData).toMatchObject({ blendlinkInstanceIds: ['tree-a', 'tree-b'] })
    expect(handle?.resolveInstance(batch, 1)).toEqual({ id: 'tree-b', name: 'Tree B', object: second })

    second.matrix = { x: 3 }
    handle?.update()
    expect(matrices[1]).toEqual({ x: 3 })
    expect(batch.instanceMatrix?.needsUpdate).toBe(true)

    second.visible = true // a later application owner wins
    handle?.stop()
    handle?.stop()
    expect(removed).toEqual([batch])
    expect([first.visible, second.visible]).toEqual([true, true])
    expect(dispose).toHaveBeenCalledOnce()
    expect(() => handle?.update()).toThrow(/already been stopped/)
  })

  it('fails loudly without mutating members when compiled eligibility has drifted', () => {
    const parent: InstanceParentLike = { add() {}, remove() {} }
    const first: InstanceObjectLike = {
      name: 'Tree_A', visible: true, geometry: {}, material: {}, matrix: {}, parent, children: [],
    }
    const second: InstanceObjectLike = {
      name: 'Tree_B', visible: true, geometry: {}, material: {}, matrix: {}, parent, children: [],
    }
    expect(() => applyCompiledSceneInstances(
      { name: 'Scene', children: [first, second] },
      { sceneDiagnostics: { instances: { groups: [group()] } } },
      { createInstancedMesh: () => ({ setMatrixAt() {} }) },
    )).toThrow(/geometry\/material identity drifted/)
    expect([first.visible, second.visible]).toEqual([true, true])
  })

  it('disposes a newly-created batch when population fails transactionally', () => {
    const geometry = {}
    const material = {}
    const parent: InstanceParentLike = { add() {}, remove() {} }
    const first: InstanceObjectLike = {
      name: 'Tree_A', visible: true, geometry, material, matrix: {}, parent, children: [],
    }
    const second: InstanceObjectLike = {
      name: 'Tree_B', visible: true, geometry, material, matrix: {}, parent, children: [],
    }
    const dispose = vi.fn()
    expect(() => applyCompiledSceneInstances(
      { name: 'Scene', children: [first, second] },
      { sceneDiagnostics: { instances: { groups: [group()] } } },
      { createInstancedMesh: () => ({ setMatrixAt() { throw new Error('GPU allocation failed') }, dispose }) },
    )).toThrow(/GPU allocation failed/)
    expect(dispose).toHaveBeenCalledOnce()
    expect([first.visible, second.visible]).toEqual([true, true])
  })
})
