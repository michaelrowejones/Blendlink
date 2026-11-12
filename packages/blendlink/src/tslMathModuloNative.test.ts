import { describe, expect, it } from 'vitest'
import { nativeModuloInputBounds, nativeModuloIntegerBand, nativeModuloHalfExactImage } from './tslMathModuloNative.js'
import { buildTslColorNode } from './tslNodeRecipe.js'
const scalar = (value: number) => ({ op: 'const_float', value })
const point = (value: number, pixels = [-.5, 0, 1, 1, .5, 1, 0, 1]) => ({ op: 'separate', channel: 'x', input: {
  op: 'vector_math', operation: 'ADD', a: { op: 'tex_image', sourceEngine: 'EEVEE', nativeGpuBackend: 'METAL',
    sourceImageStorage: 'rgba32f', sourceImageUploadRounding: 'none', width: 2, height: 1,
    pixels, output: 'color', interpolation: 'Closest', extension: 'REPEAT', vector: { op: 'uv' } },
  b: { op: 'const_vec3', value: [value, 0, 0] } } })
const build = (input: unknown, precisionModel = 'metal-mod100000-v1') => buildTslColorNode({ schemaVersion: 1,
  model: 'blendlink-tsl-ir-v1', output: { op: 'math_modulo_native', precisionModel, inputModel: (input as any).op === 'const_float' ? 'literal-f32-v1' : 'metal-f32-image-v1', input } })

describe('source-qualified native fixed100000 Modulo', () => {
  it.each([2 ** 24, -(2 ** 24), 1074100096, 1638499968, 2147483520, -2147483520])('admits the exact integer band %s', value => {
    expect(nativeModuloIntegerBand(nativeModuloInputBounds(scalar(value)))).toBe(true)
    expect(build(scalar(value)).isNode).toBe(true)
    expect(build(scalar(value), 'mf-fmod100000-v1').isNode).toBe(true)
  })
  it.each([2 ** 24 - 1, -(2 ** 24) + 1, 2 ** 31, -(2 ** 31), 1.5, Infinity, NaN])('refuses unsafe integer conversion %s', value => {
    expect(() => build(scalar(value))).toThrow(/same-sign Float32/)
  })
  it('derives a live image interval from actual payload rather than serialized claims', () => {
    const source = point(1074100096)
    expect(nativeModuloInputBounds(source)).toEqual([1074100096, 1074100096])
    expect(nativeModuloIntegerBand(nativeModuloInputBounds(source))).toBe(true)
    source.input.a.pixels[0] = 2 ** 31
    expect(() => build(source)).toThrow(/same-sign Float32/)
  })
  it('checks legacy image half precision without trusting a native storage tag', () => {
    const source = point(1074100096)
    expect(nativeModuloHalfExactImage(source)).toBe(true)
    source.input.a.pixels[0] = Math.fround(.1234567)
    expect(nativeModuloHalfExactImage(source)).toBe(false)
    source.input.a.pixels[0] = 65520
    expect(nativeModuloHalfExactImage(source)).toBe(false)
  })
  it('includes transparent CLIP borders in the scalar bound', () => {
    const source = point(2 ** 24, [4, 0, 0, 1, 8, 0, 0, 1])
    source.input.a.extension = 'CLIP'
    expect(nativeModuloInputBounds(source)).toEqual([2 ** 24, 2 ** 24 + 8])
  })
  it.each(['interpolation', 'storage', 'association', 'backend', 'projection'])('refuses an unproved image %s', mode => {
    const source = point(1074100096)
    if (mode === 'interpolation') source.input.a.interpolation = 'Linear'
    if (mode === 'storage') source.input.a.sourceImageStorage = 'rgba16f'
    if (mode === 'association') source.input.a.pixels[3] = .5
    if (mode === 'backend') source.input.a.nativeGpuBackend = 'OPENGL'
    if (mode === 'projection') Object.assign(source.input.a, { projection: 'box' })
    expect(() => build(source)).toThrow(/same-sign Float32/)
  })
  it('does not grant a native constant evaluator to an opaque image field', () => {
    expect(() => build(point(1074100096), 'mf-fmod100000-v1')).toThrow(/constant evaluation stage/)
    expect(() => build(scalar(1074100096), 'future')).toThrow(/precision model/)
  })
  it('refuses the independently failing WebGPU MF negative-zero composition', () => {
    expect(() => build(scalar(-1000000000), 'mf-fmod100000-v1')).toThrow(/negative-zero composition/)
    expect(build(scalar(-1000000000), 'metal-mod100000-v1').isNode).toBe(true)
    expect(build(scalar(1000000000), 'mf-fmod100000-v1').isNode).toBe(true)
  })
  it('leaves old serialized Math dispatch independent of the new strict opcode', () => {
    expect(buildTslColorNode({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: {
      op: 'math', operation: 'MODULO', a: scalar(2 ** 31), b: scalar(100000) } }).isNode).toBe(true)
  })
})
