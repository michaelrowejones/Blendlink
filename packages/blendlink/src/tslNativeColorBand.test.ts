import { describe, expect, it } from 'vitest'
import { float, vec3 } from 'three/tsl'
import { buildNativeColorBandSample } from './tslNativeColorBand.js'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'
const sample = (): TslExpression => vec3(.1, .2, .3) as unknown as TslExpression
const build = (fields: Record<string, unknown>): TslExpression => buildNativeColorBandSample(fields as TslIrExpression,
  float(.375) as unknown as TslExpression, sample, message => { throw new Error(message) })
describe('native material color-band sampler', () => {
  it.each([{ tableStorage: 'rgba16f', sampleStorage: 'rgba16f', filterFractionBits: 8, sampleRounding: 'nearest-away' },
    { tableStorage: 'rgba16f', sampleStorage: 'rgba32f', filterFractionBits: 0 },
    { tableStorage: 'rgba32f', sampleStorage: 'rgba32f', filterFractionBits: 8 },
    { tableStorage: 'rgba32f', sampleStorage: 'rgba32f', filterFractionBits: 0 }])
  ('builds the explicit source precision model $tableStorage/$sampleStorage/$filterFractionBits', fields => {
    expect(build(fields)).toBeTruthy()
  })
  it('does not infer sampler precision from the source texel format', () => {
    expect(() => build({ tableStorage: 'rgba16f', filterFractionBits: 8 })).toThrow(/verified storage model/)
    expect(() => build({ tableStorage: 'rgba32f', sampleStorage: 'rgba16f', filterFractionBits: 8 })).toThrow(/verified storage model/)
    expect(() => build({ tableStorage: 'rgba16f', sampleStorage: 'rgba32f', filterFractionBits: 12 })).toThrow(/verified precision model/)
    expect(() => build({ tableStorage: 'rgba16f', sampleStorage: 'rgba16f', filterFractionBits: 8, sampleRounding: 'unknown' })).toThrow(/verified sample rounding model/)
  })
})
