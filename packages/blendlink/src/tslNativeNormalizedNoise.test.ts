import { describe, expect, it } from 'vitest'
import { buildTslColorNode, type TslIrDocument } from './tslNodeRecipe.js'
import { isUnitBoundedExpression } from './tslColorConversion.js'

const expression = { op: 'noise_normalized', noiseType: 'FBM', normalize: true, perlinModel: 'native-standard-f32', dimensions: 3,
  detail: 1, roughness: .5, lacunarity: 2, input: { op: 'uv' }, scale: { op: 'const_float', value: .15 } }
const document = (output: Record<string, unknown>): TslIrDocument => ({ schemaVersion: 1,
  model: 'blendlink-tsl-ir-v1', output: output as TslIrDocument['output'] })

describe('native normalized Noise capability', () => {
  it('constructs the native primitive in every dimension without changing old serialized noise', () => {
    for (const dimensions of [1, 2, 3, 4]) {
      const input = dimensions === 1 ? { op: 'const_float', value: .25 } : { op: 'uv' }
      const candidate = { ...expression, dimensions, input, ...(dimensions === 4 ? { w: { op: 'const_float', value: .5 } } : {}) }
      expect(buildTslColorNode(document(candidate))).toBeTruthy()
      expect(buildTslColorNode(document({ ...candidate, op: 'noise' }))).toBeTruthy()
    }
  })
  it('refuses unsupported controls and forged version or range annotations', () => {
    for (const patch of [{ normalize: false }, { normalize: undefined }, { noiseType: 'MULTIFRACTAL' }, { perlinModel: 'UNKNOWN' },
      { roughnessNode: { op: 'const_float', value: .5 } }, { detail: 7 }, { roughness: 2 },
      { lacunarity: 3 }, { distortion: 2 }, { scale: { op: 'const_float', value: 80.0001 } },
      { scale: { op: 'separate', channel: 'x', input: { op: 'uv' } } }])
      expect(() => buildTslColorNode(document({ ...expression, ...patch, amplitudeBound: 0, inputDomain: 'unit-bounded-live' }))).toThrow()
    for (const controls of [{ dimensions: 3, detail: 2 }, { dimensions: 4, detail: 1, distortion: .5 }])
      expect(() => buildTslColorNode(document({ ...expression, ...controls, perlinModel: 'cycles-neon-fma' })))
        .toThrow(/workload requires source baking/)
    expect(isUnitBoundedExpression(expression)).toBe(false)
    expect(isUnitBoundedExpression({ ...expression, dimensions: 2 })).toBe(true)
    expect(isUnitBoundedExpression({ ...expression, normalize: false })).toBe(false)
    expect(isUnitBoundedExpression({ ...expression, perlinModel: 'UNKNOWN' })).toBe(false)
    expect(isUnitBoundedExpression({ ...expression, roughnessNode: { op: 'const_float', value: .5 } })).toBe(false)
  })
})
