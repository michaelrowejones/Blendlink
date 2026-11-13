import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'chroma-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Chroma Key',
      nodeType: 'CompositorNodeChromaMatte', output: 'Image' }, properties: {
      chroma_key_model: 'native-cpu-fixed-chroma-key-v1', chroma_key_schema: 'modern',
      chroma_key_controls: [0, Math.PI / 6, 1], chroma_key_rgb: [0, 1, 0],
      chroma_key_basis: [-.6460352540016174, -.7633076310157776], chroma_key_acceptance: .2679491937160492,
      evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: { Image: { name: 'Image', socketType: 'RGBA',
      value: { kind: 'constant', type: 'RGBA', value: [.25, .5, .75, -.5] } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('Chroma Key document admission', () => {
  it('admits both CPU source schemas, both outputs and qualified control endpoints', () => {
    for (const schema of ['modern', 'legacy']) for (const output of ['Image', 'Matte']) {
      for (const controls of [[0, Math.fround(Math.PI / 32), 1 / 64],
        [0, Math.fround(Math.PI / 2), 1]]) {
        const document = program(), operation = document.ops[0]!
        operation.properties.chroma_key_schema = schema
        operation.properties.chroma_key_controls = controls
        operation.properties.chroma_key_acceptance = Math.fround(Math.tan(Math.fround(controls[1]! / 2)))
        operation.source.output = output
        operation.type = document.output!.type = output === 'Image' ? 'RGBA' : 'VALUE'
        const built = buildSourceCompositor(document, () => null)
        expect(built.node.isNode).toBe(true)
        expect(() => { built.dispose(); built.dispose() }).not.toThrow()
      }
    }
  })

  it('refuses GPU-authored graphs even when their inputs would CPU-fold', () => {
    for (const device of ['GPU', 'future', undefined]) {
      const document = program()
      document.ops[0]!.properties.evaluation_device = device
      expect(() => buildSourceCompositor(document, () => null))
        .toThrow(/Artist Chroma Key.*needs Blender's CPU compositor/)
    }
    const document = program()
    document.ops[0]!.properties.single_value_device = 'GPU'
    expect(() => buildSourceCompositor(document, () => null)).toThrow(/CPU compositor/)
  })

  it('refuses unknown models and malformed, poorly conditioned or unproved controls', () => {
    for (const properties of [
      { chroma_key_model: undefined }, { chroma_key_model: 'native-fixed-chroma-key-v1' },
      { chroma_key_schema: 'future' }, { chroma_key_controls: [0, .01, 1] },
      { chroma_key_controls: [Math.PI / 18, Math.PI / 6, 1] },
      { chroma_key_controls: [.6, .5, 1] }, { chroma_key_controls: [0, .5, 1 / 128] },
      { chroma_key_controls: [0, 2, 1] }, { chroma_key_controls: [0, .5, 2] },
      { chroma_key_controls: [0, NaN, 1] }, { chroma_key_controls: [0, .5] },
      { chroma_key_rgb: [0, 1, Infinity] }, { chroma_key_rgb: [0, -1, 0] },
      { chroma_key_rgb: [.5, .5, .5] }, { chroma_key_rgb: [0, 1] },
      { chroma_key_basis: undefined }, { chroma_key_basis: [0, 0] }, { chroma_key_basis: [1, 0] },
      { chroma_key_acceptance: undefined }, { chroma_key_acceptance: 1 },
    ]) {
      const document = program()
      Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Chroma Key/)
    }
  })
})
