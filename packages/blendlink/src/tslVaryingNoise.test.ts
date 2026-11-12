import { describe, expect, it } from 'vitest'
import { buildTslColorNode, type TslIrDocument } from './tslNodeRecipe.js'
import { isUnitRoughnessExpression } from './tslVaryingNoise.js'

const unit = { op: 'clamp_minmax', value: { op: 'separate', channel: 'x', input: { op: 'uv' } },
  min: { op: 'const_float', value: 0 }, max: { op: 'const_float', value: 1 } }
const expression = { op: 'noise_varying', noiseType: 'FBM', normalize: true, dimensions: 3,
  detail: 1.5, roughness: 1, roughnessNode: unit, lacunarity: 1.7,
  input: { op: 'uv' }, scale: { op: 'const_float', value: 1 } }
const build = (changes: Record<string, unknown> = {}) => buildTslColorNode({
  schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { ...expression, ...changes },
} as TslIrDocument)

describe('varying Noise capability admission', () => {
  it('constructs normalized/signed FBM and all bounded recurrences', () => {
    for (const dimensions of [1, 2, 3, 4]) for (const detail of [-.5, 0, .5, 1, 1.5, 2])
      for (const normalize of [true, false])
        expect(build({ dimensions, detail, normalize, w: { op: 'const_float', value: .25 } })).toBeTruthy()
    for (const noiseType of ['MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'])
      expect(build({ noiseType, normalize: false, offset: .5, gain: 1 })).toBeTruthy()
  })
  it('requires the actual scalar child range and rejects forged range/bound annotations', () => {
    for (const roughnessNode of [{ op: 'separate', channel: 'x', input: { op: 'uv' }, range: [0, 1] },
      { op: 'const_vec3', value: [.25, .5, .75] }, { ...unit, value: { op: 'const_vec3', value: [0, 0, 0] } }])
      expect(() => build({ roughnessNode, roughnessRange: [0, 1], amplitudeBound: 0 })).toThrow(/independently proven/)
    for (const changes of [{ detail: 3 }, { roughness: 0 }])
      expect(() => build(changes)).toThrow(/static Detail/)
    expect(() => build({ normalize: undefined })).toThrow(/explicit native normalization/)
    expect(() => build({ noiseType: 'MULTIFRACTAL', normalize: true })).toThrow(/explicit native normalization/)
  })
  it('does not grant a raw or non-FBM field normalized Roughness bounds', () => {
    expect(isUnitRoughnessExpression({ ...expression, dimensions: 2, output: 'fac' })).toBe(true)
    for (const dimensions of [3,4])
      expect(isUnitRoughnessExpression({ ...expression, dimensions, output: 'fac' })).toBe(false)
    for (const changes of [{ normalize: false }, { noiseType: 'MULTIFRACTAL' }, { output: 'color' }])
      expect(isUnitRoughnessExpression({ ...expression, ...changes })).toBe(false)
  })
})
