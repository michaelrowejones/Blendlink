import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'

function program(): SourceCompositorProgram {
  const constant = (type: string, value: unknown) => ({ kind: 'constant' as const, type, value })
  return { version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{
    id: 'key', kind: 'channel-key', type: 'RGBA', source: { path: ['Compositor'], node: 'Artist Channel Key',
      nodeType: 'CompositorNodeChannelMatte', output: 'Image' }, properties: {
      channel_key_model: 'native-rgb-channel-key-pow2-v1', channel_key_schema: 'modern', channel_key_space: 'RGB',
      channel_key_channel: 'G', channel_key_limit_method: 'MAX', channel_key_limit_channel: 'R',
      channel_key_limits: [0, 1], evaluation_device: 'CPU', single_value_device: 'CPU',
      channel_key_limit_sources: ['socket-default', 'socket-default'], channel_key_native_version: [5, 3, 0],
    }, inputs: { Image: { name: 'Image', socketType: 'RGBA', value: constant('RGBA', [2, -.5, .125, -1]) },
      Minimum: { name: 'Minimum', socketType: 'VALUE', value: constant('VALUE', 0) },
      Maximum: { name: 'Maximum', socketType: 'VALUE', value: constant('VALUE', 1) } },
  }], output: { kind: 'ref', type: 'RGBA', node: 'key' } }
}

describe('fresh Channel Key document admission', () => {
  it('admits both native schemas, all RGB channels/limit methods and both outputs without changing the document', () => {
    for (const schema of ['modern', 'legacy']) for (const device of ['CPU', 'GPU'])
      for (const channel of ['R', 'G', 'B']) for (const method of ['SINGLE', 'MAX']) for (const output of ['Image', 'Matte']) {
        const document = program(), op = document.ops[0]!
        Object.assign(op.properties, { channel_key_schema: schema, evaluation_device: device, single_value_device: schema === 'legacy' ? device : 'CPU',
          native_gpu_backend: 'METAL', channel_key_channel: channel, channel_key_limit_channel: channel, channel_key_limit_method: method })
        if (schema === 'legacy') Object.assign(op.properties, { channel_key_native_version: [4, 2, 0], channel_key_limit_sources: ['property', 'property'] })
        op.source.output = output; op.type = document.output!.type = output === 'Image' ? 'RGBA' : 'VALUE'
        const before = JSON.stringify(document), built = buildSourceCompositor(document, () => null)
        expect(built.node.isNode).toBe(true); built.dispose(); built.dispose()
        expect(JSON.stringify(document)).toBe(before)
      }
  })

  it('independently validates literal Value controls instead of trusting a claimed fixed-limit annotation', () => {
    const document = program(), op = document.ops[0]!
    document.ops.unshift({ id: 'low', kind: 'value', type: 'VALUE', value: .125, inputs: {}, properties: {}, source: op.source })
    op.properties.channel_key_limits = [.125, .625]
    op.properties.channel_key_limit_sources = ['linked-literal', 'socket-default']
    op.inputs.Minimum!.value = { kind: 'ref', type: 'VALUE', node: 'low' }
    op.inputs.Maximum!.value.value = .625
    const built = buildSourceCompositor(document, () => null); built.dispose()
    document.ops[0]!.value = .25
    expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Channel Key.*independently verified/)
    document.ops[0]!.kind = 'utility-constant'; document.ops[0]!.type = 'INT'; document.ops[0]!.value = 0
    expect(() => buildSourceCompositor(document, () => null)).toThrow()
  })

  it('names unverified spaces, collapsed/reversed/nondyadic limits, controls and GPU profiles', () => {
    for (const patch of [{ channel_key_model: undefined }, { channel_key_schema: 'future' }, { channel_key_space: 'HSV' },
      { channel_key_channel: 'A' }, { channel_key_limit_channel: 'Q' }, { channel_key_limit_method: 'Average' },
      { channel_key_limits: [0, 1, 2] }, { channel_key_limits: [.5, .5] }, { channel_key_limits: [.75, .25] },
      { channel_key_limits: [0, .3] }, { channel_key_limits: [0, 1/128] }, { channel_key_limits: [0, Infinity] },
      { channel_key_limit_sources: undefined }, { channel_key_limit_sources: ['future', 'socket-default'] },
      { channel_key_native_version: [5, 3] },
      { evaluation_device: 'GPU', native_gpu_backend: 'METAL', channel_key_native_version: [4, 2, 0] },
      { evaluation_device: 'GPU', single_value_device: 'GPU', native_gpu_backend: 'METAL' },
      { evaluation_device: 'GPU', single_value_device: 'CPU', native_gpu_backend: 'METAL', channel_key_native_version: [6, 0, 0] },
      { evaluation_device: 'GPU', native_gpu_backend: 'OPENGL' }]) {
      const document = program(); Object.assign(document.ops[0]!.properties, patch)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Channel Key/)
    }
    for (const corrupt of ['ImageType', 'OutputType', 'FutureOutput', 'ControlType']) {
      const document = program(), op = document.ops[0]!
      if (corrupt === 'ImageType') op.inputs.Image!.value.type = 'VALUE'
      if (corrupt === 'OutputType') op.type = 'VALUE'
      if (corrupt === 'FutureOutput') op.source.output = 'Other'
      if (corrupt === 'ControlType') op.inputs.Maximum!.value.type = 'BOOLEAN'
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Channel Key/)
    }
  })
})
