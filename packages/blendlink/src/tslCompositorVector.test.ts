import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(output: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'vector', kind: 'separate-vector', type: 'VALUE', source: {
      path: ['Compositor'], node: 'Artist XYZ', nodeType: 'ShaderNodeSeparateXYZ', output,
    }, properties: {}, inputs: { Vector: { name: 'Vector', socketType: 'VECTOR',
      value: { kind: 'constant', type: 'VECTOR', value: [-.5, .25, 2] } } },
  }], output: { kind: 'ref', type: 'VALUE', node: 'vector' } }
}

describe('compositor XYZ utility output contract', () => {
  it.each(['X', 'Y', 'Z'])('builds the active %s output', output => {
    const built = buildSourceCompositor(program(output), () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })
  it('rejects an unknown output with the artist node name', () => {
    expect(() => buildSourceCompositor(program('W'), () => null)).toThrow(/Artist XYZ.*X, Y or Z/)
  })
})
