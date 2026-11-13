import { describe, expect, it } from 'vitest'
import { buildSourceCompositor } from './tslSourceCompositor.js'
import type { SourceCompositorProgram } from './sourceDisplay.js'
import { buildCompositorMapValue } from './tslCompositorMapValue.js'
import { float } from 'three/tsl'
import { certifyMapValueDomain, MAP_VALUE_DOMAIN_MODEL } from './tslCompositorMapValueDomain.js'

function certified(document: SourceCompositorProgram): SourceCompositorProgram {
  const op = document.ops[0]!, p = op.properties
  p.map_value_domain_model = MAP_VALUE_DOMAIN_MODEL
  p.map_value_domain = certifyMapValueDomain(op.inputs.Value!.value, document.ops, p.map_value_controls, p.map_value_use_min, p.map_value_use_max, p.evaluation_device)
  return document
}

function program(): SourceCompositorProgram {
  return certified({ version: 1, status: 'extracted', passes: [], diagnostics: [], ops: [{ id: 'map', kind: 'map-value', type: 'VALUE',
    source: { path: ['Compositor'], node: 'Artist Map Value', nodeType: 'CompositorNodeMapValue', output: 'Value' },
    properties: { evaluation_device: 'CPU', map_value_model: 'native-legacy-map-value-f32-v1',
      map_value_native_version: [4, 2, 0], map_value_input_model: 'scalar-v1', map_value_controls: [0, 1, null, null], map_value_use_min: false, map_value_use_max: false },
    inputs: { Value: { name: 'Value', socketType: 'VALUE', value: { kind: 'constant', type: 'VALUE', value: -.5 } } },
  }], output: { kind: 'ref', type: 'VALUE', node: 'map' } })
}

describe('legacy Map Value admission and ownership', () => {
  it('keeps ordered Min-then-Max behavior without sorting authored reversed limits', () => {
    for (const device of ['CPU', 'GPU']) for (const minimum of [false, true]) for (const maximum of [false, true]) {
      const document = program(), op = document.ops[0]!
      Object.assign(op.properties, { evaluation_device: device, native_gpu_backend: 'METAL',
        map_value_use_min: minimum, map_value_use_max: maximum, map_value_controls: [-0, -1.5, minimum ? .75 : null, maximum ? .25 : null] })
      certified(document)
      const before = JSON.stringify(document), built = buildSourceCompositor(document, () => null)
      expect(built.node.isNode).toBe(true); built.dispose(); built.dispose()
      expect(JSON.stringify(document)).toBe(before)
      expect(Object.is((op.properties.map_value_controls as number[])[0], -0)).toBe(true)
    }
  })
  it('does not trust forged native schemas or unsupported fixed-control/source models', () => {
    for (const patch of [{ map_value_model: undefined }, { map_value_native_version: [5, 2, 0] },
      { map_value_domain_model: undefined }, { map_value_domain: { kind: 'fixed', input: [0, 0] } },
      { map_value_native_version: [4, 2] }, { map_value_use_min: 1 }, { map_value_controls: [0, 1, 0, null] },
      { map_value_controls: [0, 1] }, { map_value_controls: [0, Infinity, null, null] },
      { map_value_controls: [0, 65537, null, null] }, { map_value_controls: [0, 2 ** -130, null, null] },
      { map_value_controls: [.1, 1, null, null] }, { evaluation_device: 'future' },
      { evaluation_device: 'GPU', native_gpu_backend: 'OPENGL' }]) {
      const document = program(); Object.assign(document.ops[0]!.properties, patch)
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Map Value/)
    }
    for (const shape of ['nodeType', 'output', 'type', 'socket']) {
      const document = program(), op = document.ops[0]!
      if (shape === 'nodeType') op.source.nodeType = 'ShaderNodeMapping'
      if (shape === 'output') op.source.output = 'Vector'
      if (shape === 'type') op.type = 'VECTOR'
      if (shape === 'socket') op.inputs.Value!.socketType = 'VECTOR'
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/Artist Map Value/)
    }
  })
  it('verifies actual legacy mean conversions and refuses unqualified GPU fusion or upstream implicit conversions', () => {
    for (const device of ['CPU', 'GPU']) {
      const document = program(), op = document.ops[0]!
      Object.assign(op.properties, { evaluation_device: device, native_gpu_backend: 'METAL', map_value_input_model: 'legacy-mean-v1' })
      op.inputs.Value!.value = { kind: 'convert', type: 'VALUE', fromType: 'RGBA',
        input: { kind: 'constant', type: 'RGBA', value: [.125, -.5, 2, -1] } }
      certified(document)
      const built = buildSourceCompositor(document, () => null); built.dispose()
      op.properties.map_value_controls = [.125, 1, null, null]
      certified(document)
      if (device === 'GPU') expect(() => buildSourceCompositor(document, () => null)).toThrow(/Offset zero/)
      else buildSourceCompositor(document, () => null).dispose()
      op.properties.map_value_input_model = 'scalar-v1'
      expect(() => buildSourceCompositor(document, () => null)).toThrow(/input conversion/)
    }
    const document = program(), op = document.ops[0]!, upstream = { ...op, id: 'upstream', kind: 'math', inputs: {
      Value: { name: 'Value', socketType: 'VALUE', value: { kind: 'convert' as const, type: 'VALUE', fromType: 'RGBA',
        input: { kind: 'constant' as const, type: 'RGBA', value: [1, 0, 0, 1] } } },
    } }
    op.inputs.Value!.value = { kind: 'ref', type: 'VALUE', node: 'upstream' }
    expect(() => buildCompositorMapValue(op, () => float(0), [upstream], message => { throw new Error(message) })).toThrow(/farther upstream/)
  })
})
