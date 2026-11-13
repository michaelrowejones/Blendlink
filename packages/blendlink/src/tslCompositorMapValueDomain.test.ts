import { describe, expect, it } from 'vitest'
import { certifyMapValueDomain } from './tslCompositorMapValueDomain.js'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
const constant = (value: number): CompositorValue => ({ kind: 'constant', type: 'VALUE', value: Math.fround(value) })
const ref = (node: string): CompositorValue => ({ kind: 'ref', type: 'VALUE', node })
function clamp(low: number, high: number): SourceCompositorOperation[] {
  const source = { path: ['Compositor'], node: 'Bounded input', nodeType: 'CompositorNodeMath', output: 'Value' }
  return [{ id: 'raw', kind: 'render-pass', type: 'RGBA', source, properties: {}, inputs: {} },
    { id: 'lower', kind: 'math', type: 'VALUE', source, properties: { operation: 'MAXIMUM' }, inputs: {
      Value: { name: 'Value', socketType: 'VALUE', value: ref('raw') }, Value_001: { name: 'Value', socketType: 'VALUE', value: constant(low) } } },
    { id: 'upper', kind: 'math', type: 'VALUE', source, properties: { operation: 'MINIMUM' }, inputs: {
      Value: { name: 'Value', socketType: 'VALUE', value: ref('lower') }, Value_001: { name: 'Value', socketType: 'VALUE', value: constant(high) } } }]
}
const certify = (input: CompositorValue, ops: SourceCompositorOperation[] = [], controls = [0, 1, null, null]) =>
  certifyMapValueDomain(input, ops, controls, false, false, 'CPU')

describe('Map Value normal-or-zero domain proof', () => {
  it('rejects subnormal inputs, intermediate underflow/overflow and unbounded spatial fields', () => {
    expect(certify(constant(1e-40))).toBeNull()
    expect(certify(constant(1e-20), [], [0, Math.fround(1e-20), null, null])).toBeNull()
    expect(certify(constant(1e38), [], [0, 1000, null, null])).toBeNull()
    expect(certify(ref('raw'), clamp(.25, 16))).toBeNull()
    expect(certify(ref('upper'), clamp(0, 1))).toBeNull()
    expect(certify(ref('upper'), clamp(.25, 16), [0, 2 ** -126, null, null])).toBeNull()
  })
  it('derives executable authored bounds and separately certifies cancellation through multiply', () => {
    expect(certify(ref('upper'), clamp(.25, 16))).toMatchObject({ kind: 'bounded-field', input: [.25, 16], product: [.25, 16] })
    const proof = certify(ref('upper'), clamp(.25, 16), [-.5, 2, null, null])
    expect(proof).toMatchObject({ sum: [-.25, 15.5], product: [-.5, 31] })
    expect(certify(ref('upper'), clamp(.25, 16), [-.5, 2 ** -126, null, null])).toBeNull()
    expect(certify(constant(.25), [], [.125, 2, null, null])?.output).toEqual([.75, .75])
    expect(certify(constant(0), [], [0, 1000, null, null])?.output).toEqual([0, 0])
  })
  it('checks mean stages and refuses unsafe values before mapping can hide them', () => {
    const mean = (numbers: number[]): CompositorValue => ({ kind: 'convert', type: 'VALUE', fromType: 'RGBA',
      input: { kind: 'constant', type: 'RGBA', value: [...numbers.map(Math.fround), 1] } })
    expect(certify(mean([1e38, 1e38, -1e38]))).not.toBeNull()
    expect(certify(mean([3e38, 3e38, -3e38]))).toBeNull()
    expect(certify(mean([1e-40, 1e-40, 1e-40]))).toBeNull()
    expect(certify(mean([.25, .5, .75]))?.input).toEqual([.5, .5])
  })
  it('does not certify a mixed-device ancestor under the outer evaluation model', () => {
    const ancestor: SourceCompositorOperation = { id: 'ancestor', kind: 'map-value', type: 'VALUE',
      source: { path: [], node: 'Ancestor', nodeType: 'CompositorNodeMapValue', output: 'Value' },
      properties: { evaluation_device: 'GPU', map_value_controls: [0, 1, null, null], map_value_use_min: false, map_value_use_max: false },
      inputs: { Value: { name: 'Value', socketType: 'VALUE', value: constant(.25) } } }
    expect(certify(ref('ancestor'), [ancestor])).toBeNull()
    ancestor.properties.evaluation_device = 'CPU'
    expect(certify(ref('ancestor'), [ancestor])?.input).toEqual([.25, .25])
  })
})
