import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  const color = { kind: 'constant' as const, type: 'RGBA', value: [.25, .5, .75, -.5] }
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'difference-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Difference Key',
      nodeType: 'CompositorNodeDiffMatte', output: 'Image' }, properties: {
      difference_key_model: 'native-difference-key-v1', difference_key_schema: 'modern', difference_key_settings: [.125, .25],
      evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: { 'Image 1': { name: 'Image 1', socketType: 'RGBA', value: color },
      'Image 2': { name: 'Image 2', socketType: 'RGBA', value: color } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('Difference Key document admission', () => {
  it('admits both source models, outputs and an actual zero-falloff node', () => {
    for (const schema of ['modern', 'legacy-cpu']) for (const name of ['Image', 'Matte']) for (const falloff of [0, .25]) {
      const document = program(), operation = document.ops[0]!
      operation.properties.difference_key_schema = schema; operation.properties.difference_key_settings = [.125, falloff]
      operation.source.output = name; operation.type = document.output!.type = name === 'Image' ? 'RGBA' : 'VALUE'
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('refuses unknown semantics or malformed/narrow controls at the named artist node', () => {
    for (const properties of [
      { difference_key_model: undefined }, { difference_key_schema: 'future' },
      { difference_key_settings: [.125, 1/128] }, { difference_key_settings: [.125, -1] },
      { difference_key_settings: [Infinity, .25] }, { difference_key_settings: [0] },
    ]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Difference Key.*native model/)
    }
  })
})
