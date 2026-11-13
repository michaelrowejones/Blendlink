import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'spill', kind: 'color-spill', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Color Spill',
      nodeType: 'CompositorNodeColorSpill', output: 'Image' }, properties: {
      spill_model: 'native-color-spill-v1', spill_schema: 'modern', spill_channel: 'G',
      spill_limit_method: 'Single', spill_limit_channel: 'R', spill_ratio: 1, spill_custom_strength: null,
      evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [.25, 2, -.5, -.5] } },
      Fac: { name: 'Fac', socketType: 'VALUE', value: { kind: 'constant', type: 'VALUE', value: 2 } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'spill' } }
}

describe('Color Spill document admission', () => {
  it('admits each qualified device/schema and fixed method with custom strength', () => {
    for (const schema of ['modern', 'legacy']) for (const device of ['CPU', 'GPU'])
      for (const method of ['Single', 'Average']) for (const strength of [null, [.5, 1.25, -.25]]) {
        const document = program()
        Object.assign(document.ops[0]!.properties, { spill_schema: schema, spill_limit_method: method,
          evaluation_device: device, single_value_device: device, spill_custom_strength: strength })
        const built = buildSourceCompositor(document, () => null)
        expect(built.node.isNode).toBe(true)
        expect(() => { built.dispose(); built.dispose() }).not.toThrow()
      }
  })

  it('refuses unknown semantics and malformed fixed controls at the artist node', () => {
    for (const properties of [{ spill_model: undefined }, { spill_schema: 'future' }, { spill_channel: 'Y' },
      { spill_limit_method: 'future' }, { spill_limit_channel: 'A' }, { spill_ratio: -1 }, { spill_ratio: Infinity },
      { spill_custom_strength: [1, 2] }, { spill_custom_strength: [1, 2, NaN] }, { spill_custom_strength: [3, 0, 0] }]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Color Spill.*native model/)
    }
  })
})
