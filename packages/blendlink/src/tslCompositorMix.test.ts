import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const input = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })
function numericMix(vector: boolean): SourceCompositorProgram {
  const type = vector ? 'VECTOR' : 'VALUE', suffix = vector ? 'Vector' : 'Float'
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'artist', kind: 'mix', type, source: {
      path: ['Compositor'], node: 'Artist Mix', nodeType: 'ShaderNodeMix', output: 'Result_' + suffix,
    }, properties: { data_type: vector ? 'VECTOR' : 'FLOAT', factor_mode: vector ? 'NON_UNIFORM' : 'UNIFORM',
      blend_type: 'DODGE', clamp_factor: true, clamp_result: true },
    // Deliberately omit inactive Color and scalar-factor inputs.
    inputs: { [vector ? 'Factor_Vector' : 'Factor_Float']: input(type, vector ? [-0.5, 0.3, 1.5] : 0.3),
      ['A_' + suffix]: input(type, vector ? [0.2, 0.4, 1.2] : 0.2),
      ['B_' + suffix]: input(type, vector ? [0.8, -0.2, 0.1] : 1.2) } }],
    output: { kind: 'convert', fromType: type, type: 'RGBA', input: { kind: 'ref', node: 'artist', type } } }
}

describe('native compositor Mix domains', () => {
  it.each([false, true])('builds numeric Mix without reading inactive Color controls (vector=%s)', vector => {
    const built = buildSourceCompositor(numericMix(vector), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('refuses an unproven socket model without relabeling it as Vector', () => {
    const graph = numericMix(true)
    graph.ops[0]!.properties.data_type = 'ROTATION'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Mix.*verified.*socket model/)
  })

  it('refuses unknown blend modes before deferred shader compilation', () => {
    const graph = numericMix(false), operation = graph.ops[0]!
    operation.properties = { data_type: 'RGBA', blend_type: 'UNKNOWN', color_conversion_device: 'CPU' }
    operation.inputs = { Factor_Float: input('VALUE', 0.5),
      A_Color: input('RGBA', [0.2, 0.4, 0.8, 0.5]), B_Color: input('RGBA', [0.8, 0.3, 0.1, 0.25]) }
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Mix.*Mix mode UNKNOWN/)
  })
})
