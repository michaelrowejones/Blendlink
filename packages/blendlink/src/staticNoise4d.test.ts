import { describe, expect, it } from 'vitest'
import { evaluateStaticNoiseInput, foldStaticNoise4dColor, staticStandardPerlin4d } from './staticNoise4d.js'
import type { TslIrExpression } from './tslNodeRecipe.js'

const scalar = (value: number): TslIrExpression => ({ op: 'const_float', value })
const vector = (value: number[]): TslIrExpression => ({ op: 'const_vec3', value })
const source = (): TslIrExpression => ({ op: 'combine', x: scalar(Math.fround(.173)), y: scalar(-.375), z: scalar(.625) })
const operation = (): TslIrExpression => ({ op: 'noise_fractal', dimensions: 4, output: 'color', normalize: false, noiseType: 'FBM',
  detail: 6, roughness: 1, lacunarity: 2, scale: scalar(40), input: source(),
  w: { op: 'math', operation: 'MULTIPLY_ADD', a: { op: 'separate', channel: 'y', input: source() }, b: scalar(.5), c: scalar(.125) },
  colorOffsets: [[155.58091735839844, 177.15463256835938, 138.14002990722656, 180.18572998046875],
    [188.85379028320312, 132.6776885986328, 162.05215454101562, 185.26815795898438]] })

describe('fresh static 4D FBM Color', () => {
  it('executes Combine / Separate / Math rather than trusting a static tag', () => {
    expect(evaluateStaticNoiseInput(source())).toEqual([Math.fround(.173), -.375, .625])
    expect(evaluateStaticNoiseInput(operation().w as TslIrExpression)).toBe(-.0625)
    expect(evaluateStaticNoiseInput({ op: 'vector_math', operation: 'ADD', a: vector([1, 2, 3]), b: vector([.5, -.5, 1]) })).toEqual([1.5, 1.5, 4])
    expect(evaluateStaticNoiseInput({ op: 'math', operation: 'MULTIPLY_ADD', a: scalar(Math.fround(.1)), b: scalar(Math.fround(.1)), c: scalar(.2) })).toBeUndefined()
  })

  it('uses the standard scalar kernel and explicit Float32 recurrence', () => {
    expect(staticStandardPerlin4d([0, 0, 0, 0])).toBe(0)
    expect(foldStaticNoise4dColor(operation())).toEqual([-.08296456933021545, -.12156559526920319, -.4272286593914032])
    const normalized = { ...operation(), op: 'noise_normalized', normalize: true, perlinModel: 'native-standard-f32' }
    expect(foldStaticNoise4dColor(normalized)).toEqual([.4940739572048187, .4913167357444763, .4694836735725403])
  })

  it.each([{ op: 'noise' }, { op: 'noise_varying' }, { dimensions: 3 }, { output: 'fac' },
    { noiseType: 'HYBRID_MULTIFRACTAL' }, { distortion: .25 }, { roughnessNode: scalar(.5) },
    { detail: 7 }, { roughness: 1.1 }, { lacunarity: 3 }, { scale: scalar(81) },
    { colorOffsets: [[0, 0, 0, 0]] }, { distortion: 0 }, { input: { op: 'uv', value: [0, 0, 0], constant: true } },
    { input: { op: 'tex_image', width: 1, height: 1, pixels: [0, 0, 0, 1] } },
    { w: { op: 'object_index', value: 0, static: true } },
    { w: { op: 'math', operation: 'SINE', a: scalar(0) } },
  ])('leaves unsupported or dynamic graphs on the existing path: %s', patch => {
    expect(foldStaticNoise4dColor({ ...operation(), ...patch })).toBeUndefined()
  })

  it.each(['cycles-neon-fma', 'future', undefined])('does not change an unqualified normalized model (%s)', perlinModel => {
    expect(foldStaticNoise4dColor({ ...operation(), op: 'noise_normalized', normalize: true, perlinModel })).toBeUndefined()
  })

  it('checks every color seed and fractional octave before declaring reducer identity', () => {
    const expr = { ...operation(), input: vector([1406.25, 0, 0]), w: scalar(0), colorOffsets: [[0, 0, 0, 0], [0, 0, 0, 0]], scale: scalar(1) }
    expect(foldStaticNoise4dColor(expr)).toBeUndefined() // final octave is exactly90000
    expect(foldStaticNoise4dColor({ ...expr, detail: 5 })).toBeDefined()
    expect(foldStaticNoise4dColor({ ...expr, detail: 5.5 })).toBeUndefined()
    expect(foldStaticNoise4dColor({ ...expr, detail: 0, colorOffsets: [[90000, 0, 0, 0], [0, 0, 0, 0]] })).toBeUndefined()
  })

  it('accepts negative Detail/Roughness clamping and MF/Metal below the reduction band', () => {
    for (const perlinModel of ['mf-periodic-f32', 'eevee-metal-periodic-f32'])
      expect(foldStaticNoise4dColor({ ...operation(), op: 'noise_normalized', normalize: true, perlinModel, detail: -.5, roughness: -.5 })).toBeDefined()
  })

  it('does not mutate input documents and refuses cyclic, deep or nonfinite trees', () => {
    const expr = operation(), before = JSON.stringify(expr)
    foldStaticNoise4dColor(expr); expect(JSON.stringify(expr)).toBe(before)
    const cyclic: TslIrExpression = { op: 'separate', channel: 'x' }; cyclic.input = cyclic
    expect(evaluateStaticNoiseInput(cyclic)).toBeUndefined()
    expect(evaluateStaticNoiseInput(vector([NaN, 1, 2]))).toBeUndefined()
    expect(evaluateStaticNoiseInput(scalar(2 ** -149))).toBeUndefined()
  })

  it('qualifies constant coordinate arithmetic by native evaluation stage', () => {
    for (const direction of [-1, 1]) {
      const canary: TslIrExpression = { op: 'math', operation: 'SUBTRACT', b: scalar(direction), a: {
        op: 'math', operation: 'SUBTRACT', b: scalar(1e8), a: {
          op: 'math', operation: 'ADD', a: scalar(1e8), b: scalar(direction),
        },
      } }
      expect(evaluateStaticNoiseInput(canary)).toBe(-direction)
      expect(evaluateStaticNoiseInput(canary, { exactArithmetic: true })).toBeUndefined()
      const expr = { ...operation(), input: { op: 'combine', x: canary, y: scalar(-.375), z: scalar(.625) } }
      expect(foldStaticNoise4dColor({ ...expr, evaluationModel: 'shader' })).toBeUndefined()
      expect(foldStaticNoise4dColor({ ...expr, evaluationModel: 'shader-mf' })).toBeDefined()
    }
    const lostInDouble: TslIrExpression = { op: 'math', operation: 'ADD', a: scalar(2 ** 80), b: scalar(1) }
    expect(evaluateStaticNoiseInput(lostInDouble)).toBe(2 ** 80)
    expect(evaluateStaticNoiseInput(lostInDouble, { exactArithmetic: true })).toBeUndefined()
    expect(foldStaticNoise4dColor({ ...operation(), evaluationModel: 'shader' })).toBeDefined()
  })
})
