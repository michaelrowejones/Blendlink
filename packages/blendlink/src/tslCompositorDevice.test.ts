import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const input = (number: number) => ({ name: '', socketType: 'VALUE',
  value: { kind: 'constant' as const, type: 'VALUE', value: number } })

function math(operation: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'math', kind: 'math', type: 'VALUE', source: { path: ['Compositor'], node: 'Artist Math',
      nodeType: 'CompositorNodeMath', output: 'Value' },
    properties: { operation, evaluation_device: 'GPU', single_value_device: 'GPU' },
    inputs: { Value: input(0.5), Value_001: input(2), Value_002: input(0) } }],
    output: { kind: 'convert', fromType: 'VALUE', type: 'RGBA', input: { kind: 'ref', node: 'math', type: 'VALUE' } } }
}

describe('native compositor device and domain contracts', () => {
  it('keeps zero to a negative exponent defined only for the native GPU execution model', () => {
    const graph = math('POWER'), operation = graph.ops[0]!
    operation.inputs.Value = input(0)
    operation.inputs.Value_001 = input(-1)
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
    operation.properties.single_value_device = 'CPU'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*non-finite/)
  })

  it('refuses an unknown single-value model instead of silently choosing a CPU formula', () => {
    const graph = math('ROUND')
    graph.ops[0]!.properties.single_value_device = 'future-device'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*single-value execution model/)
  })

  it.each([undefined, 0, -1, 2 ** -140])('requires positive normal bounds for legacy GPU Inverse Sqrt (%s)', bound => {
    const graph = math('INVERSE_SQRT')
    graph.ops[0]!.properties.math_domain_lower_bound = bound
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*positive normal/)
  })

  it('admits an exported positive-domain proof', () => {
    const graph = math('INVERSE_SQRT')
    graph.ops[0]!.properties.math_domain_lower_bound = 0.125
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('refuses modern spatial GPU inverse sqrt but admits its valid CPU-folded constants', () => {
    const graph = math('INVERSE_SQRT'), operation = graph.ops[0]!
    operation.source.nodeType = 'ShaderNodeMath'
    operation.inputs.Value = input(-1)
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*positive normal/)
    operation.properties.single_value_device = 'CPU'
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('requires a nonzero operand proof for legacy GPU atan2 while retaining modern zero-origin semantics', () => {
    const graph = math('ARCTAN2'), operation = graph.ops[0]!
    operation.inputs.Value = input(0)
    operation.inputs.Value_001 = input(0)
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*nonzero normal operand/)
    operation.source.nodeType = 'ShaderNodeMath'
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('accepts a proven fixed linked Logarithm base and refuses base one', () => {
    const graph = math('LOGARITHM'), operation = graph.ops[0]!
    operation.inputs.Value_001!.value = { kind: 'ref', type: 'VALUE', node: 'base' }
    graph.ops.unshift({ id: 'base', kind: 'value', type: 'VALUE', value: 2, inputs: {}, properties: {},
      source: { path: ['Compositor'], node: 'Fixed Base', nodeType: 'CompositorNodeValue', output: 'Value' } })
    operation.properties.math_logarithm_base = 2
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
    operation.properties.math_logarithm_base = 1
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Math.*fixed base other than 1/)
  })
})
