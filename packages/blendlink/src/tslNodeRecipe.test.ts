import { describe, expect, it } from 'vitest'

import {
  buildTslColorNode,
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
