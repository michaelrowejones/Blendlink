import { describe, expect, it } from 'vitest'
import { float } from 'three/tsl'
import { buildTslFractalNoise, nativeFractalAmplitudeBound, type NativeFractalParameters } from './tslFractalNoise.js'
import type { TslExpression } from './tslNodeRecipe.js'
const literal = (value: number): TslExpression => float(value) as unknown as TslExpression
const build = (fields: Partial<NativeFractalParameters> = {}): TslExpression => buildTslFractalNoise(literal(.25),
  { type: 'MULTIFRACTAL', detail: 2, roughness: .5, lacunarity: 2, ...fields }, () => literal(.25), message => { throw new Error(message) })

describe('bounded native fractal recurrences', () => {
  it.each(['MULTIFRACTAL', 'HETERO_TERRAIN', 'HYBRID_MULTIFRACTAL', 'RIDGED_MULTIFRACTAL'])('builds %s with negative native-zero controls and fractional detail', type => {
    for (const detail of [-.5, 0, .5, 1, 1.5, 2]) expect(build({ type, detail })).toBeTruthy()
    expect(build({ type, roughness: -.5 })).toBeTruthy()
  })
  it('refuses unproven modes and active parameter domains', () => {
    expect(() => build({ type: 'UNKNOWN' })).toThrow(/no verified fractal recurrence/)
    for (const fields of [{ detail: 3 }, { roughness: 2 }, { lacunarity: 3 }, { detail: NaN }])
      expect(() => build(fields)).toThrow(/verified static parameter domain/)
    expect(() => build({ type: 'HETERO_TERRAIN', offset: 2 })).toThrow(/verified static parameter domain/)
    expect(() => build({ type: 'RIDGED_MULTIFRACTAL', gain: 3 })).toThrow(/verified static parameter domain/)
  })
  it('ignores inactive offset/gain instead of granting or blocking an unrelated input', () => {
    expect(build({ offset: Infinity, gain: Infinity })).toBeTruthy()
    expect(build({ type: 'HETERO_TERRAIN', gain: Infinity })).toBeTruthy()
  })
  it('bounds all-mode finite amplitudes separately from frequency and rejects unbounded counters', () => {
    const limits = { MULTIFRACTAL: 64, HETERO_TERRAIN: 100, HYBRID_MULTIFRACTAL: 12, RIDGED_MULTIFRACTAL: 48 }
    for (const [type, expected] of Object.entries(limits))
      expect(nativeFractalAmplitudeBound({ type, detail: 2, roughness: 1, lacunarity: 2, offset: 1, gain: 2 })).toBe(expected)
    expect(nativeFractalAmplitudeBound({ type: 'MULTIFRACTAL', detail: Infinity, roughness: 1, lacunarity: 2 })).toBe(Infinity)
    expect(nativeFractalAmplitudeBound({ type: 'HETERO_TERRAIN', detail: 1, roughness: .5, lacunarity: 2, offset: NaN })).toBe(Infinity)
  })
})
