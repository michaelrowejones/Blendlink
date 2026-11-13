import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  const color = { kind: 'constant' as const, type: 'RGBA', value: [1, .25, .25, -.5] }
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'color-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Color Key',
      nodeType: 'CompositorNodeColorMatte', output: 'Image' }, properties: {
      color_key_model: 'native-color-key-cpu-v1', color_key_schema: 'modern', color_key_settings: [.01, .1, .1],
      evaluation_device: 'CPU', single_value_device: 'CPU',
    }, inputs: { Image: { name: 'Image', socketType: 'RGBA', value: color },
      'Key Color': { name: 'Key Color', socketType: 'RGBA', value: color } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('Color Key document admission', () => {
  it('admits both CPU native models and Image/Matte outputs', () => {
    for (const schema of ['modern', 'legacy']) for (const name of ['Image', 'Matte']) {
      const document = program(), op = document.ops[0]!
      Object.assign(op.properties, { color_key_schema: schema, evaluation_device: 'CPU', single_value_device: 'CPU' })
      op.source.output = name; op.type = document.output!.type = name === 'Image' ? 'RGBA' : 'VALUE'
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('refuses unknown semantics, outputs and malformed thresholds at the artist node', () => {
    for (const properties of [{ color_key_model: undefined }, { color_key_schema: 'future' },
      { color_key_settings: [0, 1] }, { color_key_settings: [0, 1, Infinity] },
      { color_key_settings: [0, -1, .5] }, { color_key_settings: [0, 1, 2] }, { color_key_settings: [2 ** -149, .1, .1] }]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Color Key.*native model/)
    }
    const document = program(); document.ops[0]!.source.output = 'Future'
    expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Color Key.*native model/)
  })

  it('rejects GPU-authored fields and folded constants while GPU hue precision is unported', () => {
    for (const folded of ['CPU', 'GPU']) {
      const document = program()
      Object.assign(document.ops[0]!.properties, { evaluation_device: 'GPU', single_value_device: folded })
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Color Key.*CPU source compositing/)
    }
  })

})
