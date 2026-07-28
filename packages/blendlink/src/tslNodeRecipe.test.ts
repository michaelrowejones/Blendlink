import { describe, expect, it, vi } from 'vitest'

import {
  buildTslColorNode,
  buildTslScalarNode,
  createTslBuildResources,
  TslIrError,
  type TslIrDocument,
} from './tslNodeRecipe.js'

// Node-construction only: TSL builds an expression graph without a GPU,
// which is exactly what the manifest consumer will do before Phase 4's
// renderer swap. Numeric fidelity is the differential harness's job
// (experiments/tsl-node-differential); this pins the package seam.

const documentOf = (output: Record<string, unknown>): TslIrDocument => ({
  schemaVersion: 1,
  model: 'blendlink-tsl-ir-v1',
  output: output as TslIrDocument['output'],
})

describe('buildTslColorNode', () => {
  it('builds proven-op documents into TSL nodes', () => {
    const node = buildTslColorNode(documentOf({
      op: 'mix_color',
      blendType: 'MIX',
      clampFactor: true,
      factor: {
        op: 'math',
        operation: 'MULTIPLY_ADD',
        a: { op: 'separate', channel: 'x', input: { op: 'uv' } },
        b: { op: 'const_float', value: 1.5 },
        c: { op: 'const_float', value: -0.25 },
      },
      a: { op: 'const_vec3', value: [0.8, 0.2, 0.1] },
      b: { op: 'const_vec3', value: [0.1, 0.2, 0.9] },
    }))
    expect(node).toBeTruthy()
    expect(typeof (node as { mul: unknown }).mul).toBe('function')
  })

  it('builds safe-math and surface-lerp compositions', () => {
    const lerp = {
      op: 'math',
      operation: 'MULTIPLY_ADD',
      a: {
        op: 'math',
        operation: 'SUBTRACT',
        a: { op: 'const_float', value: 0.85 },
        b: { op: 'const_float', value: 0.15 },
      },
      b: {
        op: 'clamp01',
        input: { op: 'separate', channel: 'y', input: { op: 'uv' } },
      },
      c: { op: 'const_float', value: 0.15 },
    }
    expect(buildTslColorNode(documentOf(lerp))).toBeTruthy()
    expect(buildTslColorNode(documentOf({
      op: 'math',
      operation: 'DIVIDE',
      a: { op: 'const_float', value: 1 },
      b: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }))).toBeTruthy()
  })

  it('builds object coordinates in either geometry basis', () => {
    const objectDocument = documentOf({ op: 'object_coords' })
    expect(buildTslColorNode(objectDocument)).toBeTruthy()
    expect(buildTslColorNode(objectDocument, {
      objectSpace: { basis: 'gltf-y-up' },
    })).toBeTruthy()
    expect(buildTslColorNode(documentOf({ op: 'generated' }), {
      objectSpace: { basis: 'gltf-y-up' },
      generatedTexspace: { location: [0, 0, 0], size: [1, 1, 1] },
    })).toBeTruthy()
  })

  it('resolves named UV maps and color layers through the runtime resolvers', () => {
    const uvChannel = vi.fn(() => 1)
    expect(buildTslColorNode(
      documentOf({ op: 'uv', uvMap: 'Detail' }), { uvChannel },
    )).toBeTruthy()
    expect(uvChannel).toHaveBeenCalledWith('Detail')
    expect(() => buildTslColorNode(
      documentOf({ op: 'uv', uvMap: 'Detail' }), { uvChannel: () => -1 },
    )).toThrow(/invalid index/)

    const colorAttribute = vi.fn(() => 'color_1')
    expect(buildTslColorNode(
      documentOf({ op: 'vertex_color', layer: 'Paint' }), { colorAttribute },
    )).toBeTruthy()
    expect(colorAttribute).toHaveBeenCalledWith('Paint')
  })

  it('refuses texture_ref without a resolver and resolves through one', () => {
    const reference = documentOf({
      op: 'texture_ref',
      ref: { slot: 3 },
      vector: { op: 'uv' },
    })
    expect(() => buildTslColorNode(reference))
      .toThrow(/BuildTslOptions\.textures/)
    expect(() => buildTslColorNode(reference, { textures: () => null }))
      .toThrow(/resolved no texture/)
  })

  it('collects build-allocated textures into a disposable resource handle', () => {
    const resources = createTslBuildResources()
    buildTslColorNode(documentOf({
      op: 'ramp_lut',
      samples: 4,
      values: [0, 0, 0, 1, 0.3, 0.3, 0.3, 1, 0.6, 0.6, 0.6, 1, 1, 1, 1, 1],
      input: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }), { resources })
    expect(resources.textures.length).toBe(1)
    const disposed = vi.fn()
    ;(resources.textures[0] as { dispose: () => void }).dispose = disposed
    resources.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    expect(resources.textures.length).toBe(0)
  })

  it('builds scalar documents without the RGB broadcast', () => {
    expect(buildTslScalarNode(documentOf({
      op: 'clamp01',
      input: { op: 'separate', channel: 'x', input: { op: 'uv' } },
    }))).toBeTruthy()
  })

  it('rejects unknown documents and unproven ops by name', () => {
    expect(() => buildTslColorNode({
      schemaVersion: 2,
      model: 'blendlink-tsl-ir-v1',
      output: { op: 'uv' },
    } as unknown as TslIrDocument)).toThrow(TslIrError)
    expect(() => buildTslColorNode({
      schemaVersion: 1,
      model: 'something-else',
      output: { op: 'uv' },
    } as unknown as TslIrDocument)).toThrow(TslIrError)
    expect(() => buildTslColorNode(documentOf({ op: 'not_a_real_op' })))
      .toThrow(/no proven TSL mapping/)
  })
})
