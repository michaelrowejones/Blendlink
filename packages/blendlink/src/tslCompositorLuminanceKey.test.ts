import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'luminance-key', type: 'RGBA', source: { path: ['Compositor'],
      node: 'Artist Luminance Key', nodeType: 'CompositorNodeLumaMatte', output: 'Image' },
    properties: { luminance_key_model: 'native-luminance-key-v1', luminance_key_schema: 'linear-ramp',
      luminance_key_limits: [.25, .75] },
    inputs: { Image: { name: 'Image', socketType: 'RGBA', value: { kind: 'constant', type: 'RGBA', value: [2, -.5, .25, -.5] } } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('luminance-key document admission', () => {
  it('accepts the two source schemas and both outputs without resource ownership', () => {
    for (const schema of ['linear-ramp', 'legacy-branch']) for (const output of ['Image', 'Matte']) {
      const document = program(), operation = document.ops[0]!
      operation.properties.luminance_key_schema = schema; operation.source.output = output
      operation.type = output === 'Image' ? 'RGBA' : 'VALUE'
      document.output!.type = operation.type
      const built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true)
      expect(() => { built.dispose(); built.dispose() }).not.toThrow()
    }
  })

  it('rejects unknown models, narrow/undefined ramps and forged nonfinite thresholds at the artist node', () => {
    for (const properties of [
      { luminance_key_model: undefined }, { luminance_key_schema: 'future' },
      { luminance_key_limits: [.5, .5] }, { luminance_key_limits: [.5, .5 + 1/128] },
      { luminance_key_limits: [0, Infinity] }, { luminance_key_limits: [-1, 1] },
    ]) {
      const document = program(); Object.assign(document.ops[0]!.properties, properties)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Luminance Key.*native model/)
    }
  })
})
