import { describe, expect, it } from 'vitest'
import { buildTslScalarNode, type TslIrExpression } from './tslNodeRecipe.js'
import { isUnitBoundedExpression } from './tslColorConversion.js'
const scalar = (value: number): TslIrExpression => ({op:'const_float',value})
const expression: TslIrExpression = {op:'noise_normalized',normalize:true,noiseType:'FBM',
  output:'fac',dimensions:1,detail:0,roughness:.5,lacunarity:2,
  input:scalar(100000),scale:scalar(1),perlinModel:'mf-periodic-f32'}
const build = (output: TslIrExpression) => buildTslScalarNode({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})
describe('versioned native Noise coordinate models', () => {
  it('constructs distinct periodic and prior unwrapped models without changing old documents', () => {
    for (const perlinModel of ['native-standard-f32','cycles-neon-fma','eevee-metal-periodic-f32',
      'mf-periodic-f32']) {
      expect(build({...expression,perlinModel})).toBeTruthy()
      expect(isUnitBoundedExpression({...expression,perlinModel})).toBe(true)
    }
  })
  it('refuses unknown coordinate arithmetic instead of inheriting a prior model', () => {
    const unknown = {...expression,perlinModel:'future-coordinate-model'}
    expect(() => build(unknown)).toThrow(/no verified source Perlin model/)
    expect(isUnitBoundedExpression(unknown)).toBe(false)
  })
  it('does not let periodic reduction restore disproved 3D or 4D unit claims', () => {
    for (const dimensions of [3,4]) {
      const noise = {...expression,dimensions,input:{op:'const_vec3',value:[1,2,3]},w:scalar(4)}
      expect(build(noise)).toBeTruthy()
      expect(isUnitBoundedExpression(noise)).toBe(false)
    }
  })
})
