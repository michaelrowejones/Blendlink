import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function mathProgram(operation: string, unary = false): SourceCompositorProgram {
  const input = (value: number) => ({ name: 'Value', socketType: 'VALUE',
    value: { kind: 'constant' as const, type: 'VALUE', value } })
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'result', kind: 'math', type: 'VALUE',
      source: { path: ['Compositor'], node: 'Artist Math', nodeType: 'ShaderNodeMath', output: 'Value' },
      properties: { operation, use_clamp: false },
      inputs: { Value: input(0.75), ...(unary ? {} : { Value_001: input(1.3), Value_002: input(0.1) }) } }],
    output: { kind: 'convert', type: 'RGBA', fromType: 'VALUE', input: { kind: 'ref', type: 'VALUE', node: 'result' } } }
}

describe('compositor Math coverage', () => {
  // Actual numeric/zero/equality semantics are checked against native Blender
  // float pixels by compositor_math_check.py and the two-backend browser corpus.
  it.each(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MULTIPLY_ADD', 'POWER', 'LOGARITHM',
    'SQRT', 'INVERSE_SQRT', 'ABSOLUTE', 'EXPONENT', 'MINIMUM', 'MAXIMUM', 'LESS_THAN',
    'GREATER_THAN', 'SIGN', 'COMPARE', 'SMOOTH_MIN', 'SMOOTH_MAX', 'ROUND', 'FLOOR',
    'CEIL', 'TRUNC', 'FRACT', 'MODULO', 'FLOORED_MODULO', 'WRAP', 'SNAP', 'PINGPONG',
    'SINE', 'COSINE', 'TANGENT', 'ARCSINE', 'ARCCOSINE', 'ARCTANGENT', 'ARCTAN2',
    'SINH', 'COSH', 'TANH', 'RADIANS', 'DEGREES'])('builds %s', operation => {
    const built = buildSourceCompositor(mathProgram(operation), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('does not require hidden operands for unary nodes', () => {
    const built = buildSourceCompositor(mathProgram('SINE', true), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('names the artist node when a future operation is unsupported', () => {
    expect(() => buildSourceCompositor(mathProgram('FUTURE_MATH'), () => null))
      .toThrow(/Compositor \/ Artist Math \[Value\].*FUTURE_MATH/)
  })

  it('refuses the undefined legacy logarithm base instead of silently substituting modern math', () => {
    const program = mathProgram('LOGARITHM')
    program.ops[0]!.source.nodeType = 'CompositorNodeMath'
    program.ops[0]!.inputs.Value_001!.value.value = 1
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/Artist Math.*Legacy compositor Logarithm/)
  })
})
