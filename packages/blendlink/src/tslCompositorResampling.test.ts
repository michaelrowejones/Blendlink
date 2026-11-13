import { describe, expect, it } from 'vitest'
import { compositorAxisMapping, compositorFma32 } from './tslCompositorResampling.js'

const F = Math.fround

describe('native compositor coordinate realization', () => {
  it('rounds fused coordinates once even at binary64 double-rounding boundaries', () => {
    const a = F(1 + 2 ** -23), b = F(1 - 2 ** -24), c = F(2 ** -47 + 2 ** -70)
    expect(F(a * b + c)).toBe(1)
    expect(compositorFma32(a, b, c)).toBe(F(1 + 2 ** -23))
    expect(compositorFma32(-a, b, -c)).toBe(F(-1 - 2 ** -23))
    expect(compositorFma32(1, 2, -2)).toBe(0)
  })

  it('keeps the legacy CPU finite-window clip before interpolation', () => {
    const table = compositorAxisMapping(13, 0, 0, { model: 'legacy-cpu-v1', interpolation: 'Bilinear' }, .25)
    expect(Array.from(table.slice(0, 4))).toEqual([-1, 0, .75, 0])
    expect(Array.from(table.slice(4, 8))).toEqual([0, 1, .75, 1])
  })

  it('retains native independent rounded neighbor indices near zero', () => {
    const table = compositorAxisMapping(13, 2, 0, { model: 'modern-cpu-v1', interpolation: 'Bilinear' })
    // The native index is floor(float32(u+1)), not floor(u)+1.
    expect(Array.from(table.slice(8, 12))).toEqual([-1, 1, 1, 1])
  })

  it('quantizes Metal sampler coordinates before subtracting the half pixel', () => {
    const table = compositorAxisMapping(13, .501953125, 0,
      { model: 'modern-metal-v1', interpolation: 'Bilinear' })
    // Native Metal ramp alpha at pixel(0,0) is .49609375. Quantizing after
    // subtraction gives .5 at this tie and visibly changes the boundary.
    expect(Array.from(table.slice(0, 4))).toEqual([-1, 0, .49609375, 1])
  })

  it('preserves the different legacy CPU and modern nearest half-pixel conventions', () => {
    const cpu = compositorAxisMapping(13, 0, 0, { model: 'legacy-cpu-v1', interpolation: 'Nearest' }, -.5)
    const modern = compositorAxisMapping(13, -.5, 0, { model: 'modern-cpu-v1', interpolation: 'Nearest' })
    expect(Array.from(cpu.slice(0, 4))).toEqual([1, 1, 0, 1])
    expect(Array.from(modern.slice(0, 4))).toEqual([0, 0, 0, 1])
  })

  it.each([0, -1, 8193, 1.5, Infinity])('refuses unresolved or excessive extents (%s)', size => {
    expect(() => compositorAxisMapping(size, 0, 0, { model: 'modern-cpu-v1', interpolation: 'Bilinear' }))
      .toThrow(/between 1 and 8192/)
  })
})
