import { describe, expect, it } from 'vitest'
import { buildSourceCompositor, SourceCompositorUnsupported } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function colorBalance(model: string, mode = 'Lift/Gamma/Gain'): SourceCompositorProgram {
  const constant = (type: string, value: unknown) => ({ name: '', socketType: type,
    value: { kind: 'constant' as const, type, value } })
  const inputs = {
    Image: constant('RGBA', [0.2, 0.4, 1.4, 0.3]),
    Fac: constant('VALUE', 0.6), Type: constant('MENU', mode),
    ...Object.fromEntries(['Lift', 'Gamma', 'Gain', 'Offset', 'Power', 'Slope'].flatMap(name => [
      ['Base ' + name, constant('VALUE', name === 'Lift' || name === 'Offset' ? 0 : 1)],
      ['Color ' + name, constant('RGBA', name === 'Offset' ? [0, 0, 0, 1] : [1, 1, 1, 1])],
    ])),
  }
  return { version: 1, status: 'extracted', passes: [], diagnostics: [],
    ops: [{ id: 'grade', kind: 'color-balance', type: 'RGBA',
      source: { path: ['Compositor'], node: 'Final grade', nodeType: 'CompositorNodeColorBalance', output: 'Image' },
      properties: { color_balance_model: model }, inputs }],
    output: { kind: 'ref', type: 'RGBA', node: 'grade' } }
}

describe('native compositor Color Balance', () => {
  it.each(['legacy-srgb', 'linear'])('builds both verified color-grade modes for %s', model => {
    for (const mode of ['Lift/Gamma/Gain', 'Offset/Power/Slope (ASC-CDL)']) {
      const built = buildSourceCompositor(colorBalance(model, mode), () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('refuses unknown color semantics instead of choosing a different Blender look', () => {
    expect(() => buildSourceCompositor(colorBalance('future-model'), () => null))
      .toThrow(/Compositor \/ Final grade \[Image\]: Color Balance has no verified color model/)
  })

  it('refuses White Point without its native model with the artist node name', () => {
    expect(() => buildSourceCompositor(colorBalance('linear', 'White Point'), () => null))
      .toThrow(/Final grade.*White Point requires its native chromatic-adaptation model/)
  })

  it('refuses a linked mode selector without installing a partial graph', () => {
    const program = colorBalance('linear')
    program.ops[0]!.inputs.Type!.value = { kind: 'ref', type: 'MENU', node: 'selection' }
    expect(() => buildSourceCompositor(program, () => null)).toThrow(SourceCompositorUnsupported)
    expect(() => buildSourceCompositor(program, () => null)).toThrow(/Type requires a constant setting/)
  })
})
