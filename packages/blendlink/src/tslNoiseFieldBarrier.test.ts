import { describe, expect, it } from 'vitest'
import { buildNoiseFieldBarrier, usesNoiseFieldBarrier } from './tslNoiseFieldBarrier.js'
import type { TslExpression, TslIrExpression } from './tslNodeRecipe.js'
const field = (): TslIrExpression => ({ op: 'noise_fractal', output: 'color', dimensions: 4,
  noiseType: 'FBM', evaluationModel: 'shader', detail: 6, roughness: 1, lacunarity: 2,
  scale: { op: 'const_float', value: 40 },
  input: { op: 'tex_image', sourceEngine: 'EEVEE', nativeGpuBackend: 'OPENGL', sourceImageStorage: 'rgba32f',
    sourceImageUploadRounding: 'none', output: 'color', interpolation: 'Closest', extension: 'REPEAT',
    vector: { op: 'uv_active' }, width: 2, height: 1,
    pixels: [-.5, 0, .5, 1, .125, .25, .875, 1] }, w: { op: 'const_float', value: .5 } })

describe('fresh high-detail4D Color field compiler barrier', () => {
  it('uses a private zero uniform for the actual failing field shape', () => {
    const ir = field(); expect(usesNoiseFieldBarrier(ir)).toBe(true)
    const calls: unknown[] = [], result = {} as TslExpression
    const input = { add(value: unknown) { calls.push(value); return { toVar: () => result } } } as unknown as TslExpression
    expect(buildNoiseFieldBarrier(ir, input)).toBe(result)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ isUniformNode: true, value: 0 })
  })
  it.each([
    { op: 'noise' }, { op: 'noise_varying' }, { op: 'noise_varying_native' },
    { dimensions: 3 }, { output: 'fac' }, { noiseType: 'RIDGED_MULTIFRACTAL' },
    { evaluationModel: 'shader-mf' }, { detail: 2.5 }, { detail: 7 }, { detail: Infinity },
    { distortion: 1 }, { roughnessNode: { op: 'separate' } },
    { input: { op: 'const_vec3', value: [0, 0, 0] } },
  ])('leaves the existing path unchanged for %j', change => {
    const ir = { ...field(), ...change }, input = {} as TslExpression
    expect(usesNoiseFieldBarrier(ir)).toBe(false)
    expect(buildNoiseFieldBarrier(ir, input)).toBe(input)
  })
  it('recognizes a live W subtree without treating a claimed stage alone as a field', () => {
    const ir = field()
    ir.w = { op: 'math', operation: 'MULTIPLY_ADD', a: { op: 'separate', channel: 'y', input: field().input },
      b: { op: 'const_float', value: .5 }, c: { op: 'const_float', value: .125 } }
    expect(usesNoiseFieldBarrier(ir)).toBe(true)
  })
  it('certifies exact arithmetic independently of a particular fixture grid', () => {
    const ir = field(); ((ir.input as TslIrExpression).pixels as number[])[0] = 1 / 2048
    expect(usesNoiseFieldBarrier(ir)).toBe(true)
  })
  it.each([
    { output: 'alpha' }, { sourceImageStorage: 'rgba8' }, { sourceImageStorage: 'rgba16f' },
    { sourceImageUploadRounding: 'toward-zero' }, { interpolation: 'Linear' }, { extension: 'CLIP' },
    { sourceImageColorSpace: 'sRGB' }, { workingSpace: 'ACEScg' }, { projection: 'box' },
    { sourceEngine: 'future' }, { nativeGpuBackend: 'future' }, { vector: { op: 'generated' } },
  ])('does not certify raw pixels through an unmeasured sampled profile %j', change => {
    const ir = field(); Object.assign(ir.input as TslIrExpression, change)
    expect(usesNoiseFieldBarrier(ir)).toBe(false)
  })
  it('requires exact coordinate staging rather than just claiming an image field', () => {
    const ir = field(), input = ir.input as TslIrExpression
    ;(input.pixels as number[])[0] = Math.fround(.1234567)
    expect(usesNoiseFieldBarrier(ir)).toBe(false)
    const outside = field(); outside.scale = { op: 'const_float', value: 61.7 }
    expect(usesNoiseFieldBarrier(outside)).toBe(false)
    const nonGridW = field(); nonGridW.w = { op: 'math', operation: 'ADD', a: { op: 'const_float', value: 1 }, b: { op: 'const_float', value: .5 } }
    expect(usesNoiseFieldBarrier(nonGridW)).toBe(false)
    const roundedW = field(); ((roundedW.input as TslIrExpression).pixels as number[])[1] = 2 ** -24
    roundedW.w = { op: 'math', operation: 'MULTIPLY_ADD', a: { op: 'separate', channel: 'y', input: roundedW.input },
      b: { op: 'const_float', value: .5 }, c: { op: 'const_float', value: .125 } }
    expect(usesNoiseFieldBarrier(roundedW)).toBe(false)
    const alternate = field(); alternate.scale = { op: 'const_float', value: 80 }
    expect(usesNoiseFieldBarrier(alternate)).toBe(true)
  })
  it('does not follow cyclic or excessive opaque author data indefinitely', () => {
    const ir = field(), cycle: TslIrExpression = { op: 'math' }; cycle.a = cycle; ir.input = cycle
    expect(usesNoiseFieldBarrier(ir)).toBe(false)
  })
})
