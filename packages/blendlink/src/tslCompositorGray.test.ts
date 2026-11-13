import { describe, expect, it } from 'vitest'
import { compositorGrayscale } from './tslCompositorGray.js'
import type { CompositorValue, SourceCompositorOperation } from './sourceDisplay.js'
const source = { path: ['Compositor'], node: 'Gray Input', nodeType: 'CompositorNodeCombineColor', output: 'Image' }
const constant = (n: number): CompositorValue => ({ kind: 'constant', type: 'VALUE', value: n })
const ref = (node: string): CompositorValue => ({ kind: 'ref', type: 'RGBA', node })
function combine(): SourceCompositorOperation {
  return { id: 'gray', kind: 'combine-color', type: 'RGBA', source, properties: { mode: 'RGB' }, inputs:
    Object.fromEntries(['Red', 'Green', 'Blue', 'Alpha'].map(name => [name, { name, socketType: 'VALUE', value: constant(.25) }])) }
}
describe('Independent grayscale compositor certificate', () => {
  it('accepts equal actual F32 constants and one repeated scalar field', () => {
    const op = combine()
    expect(compositorGrayscale(ref('gray'), [op])).toBe(true)
    const scalar: SourceCompositorOperation = { id: 's', kind: 'separate-color', type: 'VALUE', source: { ...source, output: 'Red' }, properties: { mode: 'RGB' }, inputs: {} }
    for (const name of ['Red', 'Green', 'Blue']) op.inputs[name]!.value = { kind: 'ref', type: 'VALUE', node: 's' }
    expect(compositorGrayscale(ref('gray'), [scalar, op])).toBe(true)
    op.inputs.Blue!.value = constant(.5)
    expect(compositorGrayscale(ref('gray'), [scalar, op])).toBe(false)
  })
  it('rejects HSV combination, colored arrays, forged scalar shape and cycles', () => {
    const op = combine(); op.properties.mode = 'HSV'
    expect(compositorGrayscale(ref('gray'), [op])).toBe(false)
    expect(compositorGrayscale({ kind: 'constant', type: 'RGBA', value: [1, .5, 1, 1] }, [])).toBe(false)
    const sparse = Array(4); sparse[0] = sparse[1] = sparse[2] = 1
    expect(compositorGrayscale({ kind: 'constant', type: 'RGBA', value: sparse }, [])).toBe(false)
    op.properties.mode = 'RGB'
    for (const name of ['Red', 'Green', 'Blue']) op.inputs[name]!.value = { kind: 'ref', type: 'VALUE', node: 'gray' }
    expect(compositorGrayscale(ref('gray'), [op])).toBe(false)
    const forged: CompositorValue = { kind: 'convert', type: 'RGBA', fromType: 'VALUE', input: ref('gray') }
    expect(compositorGrayscale(forged, [op])).toBe(false)
  })
})
