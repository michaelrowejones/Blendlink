import { describe, expect, it } from 'vitest'
import { relativeBlurRadii, relativeBlurWeights, type RelativeBlurSettings } from './tslCompositorBlurSizing.js'

const settings = (legacyCpu: boolean, aspect: RelativeBlurSettings['aspect'] = 'NONE'): RelativeBlurSettings =>
  ({ percent: [12.5, 25], aspect, multiplier: 1, legacyCpu })

describe('legacy relative Blur radius contract', () => {
  it('retains native CPU rounding before Size and GPU fractional radii', () => {
    expect(relativeBlurRadii(settings(true), 13, 7)).toEqual([2, 2])
    expect(relativeBlurRadii(settings(false), 13, 7)).toEqual([1.625, 1.75])
    expect(relativeBlurRadii({ ...settings(true), multiplier: .25 }, 13, 7)).toEqual([.5, .5])
    expect(relativeBlurRadii({ ...settings(false), multiplier: .25 }, 13, 7)).toEqual([.40625, .4375])
  })

  it('uses native X=height and Y=width aspect correction', () => {
    expect(relativeBlurRadii(settings(true, 'X'), 13, 7)).toEqual([1, 2])
    expect(relativeBlurRadii(settings(false, 'Y'), 13, 7)).toEqual([1.625, 3.25])
  })

  it('rounds the .5 addition in float32 rather than applying Math.round to the unrounded value', () => {
    const percent = Math.fround(.5 / 13 * 100)
    const unrounded = Math.fround(Math.fround(percent * Math.fround(.01)) * 13)
    expect(unrounded).toBeLessThan(.5)
    expect(Math.round(unrounded)).toBe(0)
    expect(relativeBlurRadii({ ...settings(true), percent: [percent, 0] }, 13, 7)).toEqual([1, 0])
  })

  it('preserves the different native accumulation and normalization orders', () => {
    // Float32 reference coefficients from native RE_filter_value at radius2.25.
    expect(relativeBlurWeights('Catrom', 2.25, true)).toEqual([
      .7095028162002563, .1952504813671112, -.05000194534659386, 0,
    ])
    expect(relativeBlurWeights('Catrom', 2.25, false)).toEqual([
      .7095028758049011, .1952505111694336, -.050001949071884155, 0,
    ])
  })

  it.each([-1, 128.01, Infinity, NaN])('rejects an unsupported resolved radius before creating a table: %s', radius => {
    expect(() => relativeBlurWeights('Tent', radius, true)).toThrow(/between 0 and 128/)
  })

  it('does not substitute JavaScript Math.exp for native Gaussian expf', () => {
    expect(() => relativeBlurWeights('Gaussian', 2, true)).toThrow(/no verified portable filter/)
  })
})
