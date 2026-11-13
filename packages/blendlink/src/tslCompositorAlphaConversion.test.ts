import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(kind: string, mode: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'convert', kind, type: 'RGBA', source: {
      path: ['Compositor'], node: 'Artist Alpha Conversion', nodeType: 'CompositorNodePremulKey', output: 'Image',
    }, properties: { alpha_conversion_model: 'native-alpha-v1', alpha_mode: mode }, inputs: {
      Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [.25, -.5, 2, 0] } },
      Alpha: { name: 'Alpha', socketType: 'VALUE', value: { kind: 'constant', type: 'VALUE', value: -.5 } },
    } }], output: { kind: 'ref', type: 'RGBA', node: 'convert' } }
}

describe('native alpha conversion contract', () => {
  it.each([['set-alpha', 'Apply Mask'], ['set-alpha', 'Replace Alpha'],
    ['convert-alpha', 'To Premultiplied'], ['convert-alpha', 'To Straight']])('builds %s %s', (kind, mode) => {
    const built = buildSourceCompositor(program(kind, mode), () => null)
    expect(built.node.isNode).toBe(true)
    expect(() => { built.dispose(); built.dispose() }).not.toThrow()
  })

  it('rejects unversioned and unknown native alpha semantics with the artist node name', () => {
    for (const model of [undefined, 'future-model']) {
      const graph = program('convert-alpha', 'To Straight')
      graph.ops[0]!.properties.alpha_conversion_model = model
      expect(() => buildSourceCompositor(graph, () => null))
        .toThrow(/Artist Alpha Conversion.*native color and zero-alpha model/)
    }
    for (const [kind, mode] of [['set-alpha', 'To Straight'], ['convert-alpha', 'Apply Mask']])
      expect(() => buildSourceCompositor(program(kind!, mode!), () => null)).toThrow(/Artist Alpha Conversion/)
  })
})
