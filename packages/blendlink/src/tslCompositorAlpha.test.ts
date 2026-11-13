import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

const input = (type: string, value: unknown) => ({ name: '', socketType: type,
  value: { kind: 'constant' as const, type, value } })
function program(kind: string): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'alpha', kind, type: 'RGBA', source: {
      path: ['Compositor'], node: 'Artist Alpha', nodeType: 'CompositorNodeAlphaOver', output: 'Image',
    }, properties: {}, inputs: { Background: input('RGBA', [0.2, 0.4, 0.8, 0.5]),
      Foreground: input('RGBA', [0.8, 0.3, 0.1, 0.25]), Fac: input('VALUE', 0.35),
      Type: input('MENU', 'Over'), 'Straight Alpha': input('BOOLEAN', false),
      Color: input('RGBA', [0.2, 0.4, 0.8, 0.5]), 'Invert Color': input('BOOLEAN', true),
      'Invert Alpha': input('BOOLEAN', false), Image: input('RGBA', [0.2, 0.4, 0.8, 0.5]),
      Bright: input('VALUE', 20), Contrast: input('VALUE', -30) } }],
    output: { kind: 'ref', node: 'alpha', type: 'RGBA' } }
}

describe('native alpha-aware compositor utilities', () => {
  it.each(['Over', 'Disjoint Over', 'Conjoint Over'])('builds %s with boolean straight-alpha control', type => {
    const graph = program('alpha-over')
    graph.ops[0]!.inputs.Type = input('MENU', type)
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('requires the complete legacy Alpha Over premultiply model', () => {
    const graph = program('alpha-over')
    Object.assign(graph.ops[0]!.properties, { alpha_over_model: 'legacy', legacy_premul: 0.35, legacy_straight: true })
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
    graph.ops[0]!.properties.legacy_premul = 2
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Alpha.*verified premultiply settings/)
  })

  it('accepts normalized legacy Invert flags and numeric boolean conversions', () => {
    const graph = program('invert')
    graph.ops[0]!.inputs['Invert Color']!.value = {
      kind: 'convert', fromType: 'VALUE', type: 'BOOLEAN',
      input: { kind: 'constant', type: 'VALUE', value: -0.5 },
    }
    const built = buildSourceCompositor(graph, () => null)
    expect(built.node.isNode).toBe(true)
    built.dispose()
  })

  it('refuses unknown alpha modes and malformed premultiply controls', () => {
    const graph = program('alpha-over')
    graph.ops[0]!.inputs.Type = input('MENU', 'Unknown')
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Alpha.*Alpha Over requires/)
    graph.ops[0]!.kind = 'brightness-contrast'
    graph.ops[0]!.properties.use_premultiply = 'true'
    expect(() => buildSourceCompositor(graph, () => null)).toThrow(/Artist Alpha.*boolean premultiply/)
  })
})
