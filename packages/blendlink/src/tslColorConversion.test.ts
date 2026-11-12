import { describe, expect, it } from 'vitest'
import { vec3 } from 'three/tsl'
import { buildTslColorConversion } from './tslColorConversion.js'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'

const expression = (fields: Partial<TslIrExpression> = {}): TslIrExpression => ({ op: 'color_convert', mode: 'HSL',
  direction: 'separate', model: 'cycles', sourceEngine: 'CYCLES', hslUpperDivisor: 'sequential',
  inputDomain: 'verified-static-nonsingular', input: { op: 'const_vec3', value: [.2, .4, .7] }, ...fields })
const build = (output: TslIrExpression): TslExpression => buildTslColorConversion(output,
  vec3(.2, .4, .7) as unknown as TslExpression, message => { throw new Error(message) })

describe('native shader color conversion', () => {
  it.each(['RGB', 'HSV', 'HSL'])('constructs both %s directions without textures', mode => {
    for (const direction of ['separate', 'combine']) for (const model of ['cycles', 'eevee-gpu'])
      expect(build(expression({ mode, direction, model }))).toBeTruthy()
  })
  it('refuses invalid mode or model rather than falling back to RGB', () => {
    expect(() => build(expression({ mode: 'YUV' }))).toThrow(/no verified native mode/)
    expect(() => build(expression({ model: 'unknown' }))).toThrow(/no verified native mode/)
  })
  it('does not trust a domain label on an unconstrained object property', () => {
    for (const inputDomain of ['verified-static-nonsingular', 'unit-bounded-live'])
      expect(() => build(expression({ inputDomain, input: { op: 'attribute_object', name: 'color' } }))).toThrow(/verified finite input domain/)
  })
  it('rejects literal native saturation singularities', () => {
    for (const value of [[-.3, 0, .3], [.5, 1, 1.5]])
      expect(() => build(expression({ input: { op: 'const_vec3', value } }))).toThrow(/undefined saturation/)
  })
  it('retains the native achromatic branch at black and white', () => {
    for (const value of [[0, 0, 0], [1, 1, 1]])
      expect(build(expression({ input: { op: 'const_vec3', value } }))).toBeTruthy()
  })
  it('allows unit-bounded image data and rejects the same carrier with HDR pixels', () => {
    const input = { op: 'tex_image', width: 1, height: 1, pixels: [.2, .4, .7, 1] }
    expect(build(expression({ inputDomain: 'unit-bounded-live', input }))).toBeTruthy()
    input.pixels[0] = 1.4
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input }))).toThrow(/verified finite input domain/)
  })
  it('requires convex bounds for a live blend rather than assuming its output is a color', () => {
    const input = { op: 'mix_color', blendType: 'MIX', clampFactor: true,
      a: { op: 'const_vec3', value: [.2, .4, .7] }, b: { op: 'const_vec3', value: [.7, .8, .9] } }
    expect(build(expression({ inputDomain: 'unit-bounded-live', input }))).toBeTruthy()
    input.clampFactor = false
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input }))).toThrow(/verified finite input domain/)
  })
  it('refuses unproven Noise modes and contradictory annotations', () => {
    const input: TslIrExpression = { op: 'noise', dimensions: 3, detail: 2, roughness: .5, lacunarity: 2 }
    expect(build(expression({ inputDomain: 'unit-bounded-live', input }))).toBeTruthy()
    for (const fields of [{ normalize: false }, { noiseType: 'MULTIFRACTAL' }, { type: 'RIDGED_MULTIFRACTAL' },
      { detail: 100 }, { roughness: -1 }, { lacunarity: Number.NaN }]) {
      expect(() => build(expression({ inputDomain: 'unit-bounded-live', input: { ...input, ...fields } })))
        .toThrow(/verified finite input domain/)
    }
  })
  it('requires a ramp model whose actual interpolation is convex', () => {
    const input = { op: 'color_ramp', interpolation: 'LINEAR', stops: [
      { position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }] }
    expect(build(expression({ inputDomain: 'unit-bounded-live', input }))).toBeTruthy()
    input.interpolation = 'CARDINAL'
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input }))).toThrow(/verified finite input domain/)
    const lut = { op: 'ramp_lut', values: [0, 0, 0, 1, 1.125, 1, 1, 1] }
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input: lut }))).toThrow(/verified finite input domain/)
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input: {
      op: 'ramp_lut', channel: 'alpha', values: [0, 0, 0, 1.125] } }))).toThrow(/verified finite input domain/)
    expect(build(expression({ inputDomain: 'unit-bounded-live', input: {
      op: 'ramp_lut', channel: 'alpha', values: [1.125, 2, -1, .5] } }))).toBeTruthy()
  })
  it('accepts the consumed clampResult field and rejects an ignored lookalike', () => {
    const input = { op: 'mix_color', blendType: 'ADD', clampFactor: false,
      a: { op: 'const_vec3', value: [2, 3, 4] }, b: { op: 'const_vec3', value: [1, 2, 3] } }
    expect(build(expression({ inputDomain: 'unit-bounded-live', input: { ...input, clampResult: true } }))).toBeTruthy()
    expect(() => build(expression({ inputDomain: 'unit-bounded-live', input: { ...input, clamp_result: true } })))
      .toThrow(/verified finite input domain/)
  })
})
