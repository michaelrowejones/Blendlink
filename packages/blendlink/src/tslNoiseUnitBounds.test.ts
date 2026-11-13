import { describe, expect, it } from 'vitest'
import { isUnitBoundedExpression } from './tslColorConversion.js'
import { isUnitRoughnessExpression } from './tslVaryingNoise.js'
import { buildTslScalarNode, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'
const scalar = (value: number): TslIrExpression => ({ op: 'const_float', value })
const candidate = (op: string): TslIrExpression => ({ op, normalize: true, noiseType: 'FBM',
  perlinModel: 'native-standard-f32', output: 'fac', dimensions: 4, detail: 0,
  roughness: op === 'noise_varying' ? 1 : .5, lacunarity: 2,
  ...(op === 'noise_varying' ? { roughnessNode: scalar(.5) } : {}),
  scale: scalar(1), input: { op: 'const_vec3', value: [58250.5,35498.5,49388.5] }, w: scalar(58164.5) })
const document = (output: TslIrExpression): TslIrDocument => ({schemaVersion:1,model:'blendlink-tsl-ir-v1',output})
describe('native normalized 3D/4D Noise range', () => {
  for (const dimensions of [3,4]) for (const op of ['noise','noise_normalized','noise_varying']) it(`${dimensions}D ${op} keeps HDR output and requires a real clamp to prove a unit input`, () => {
    const noise = {...candidate(op),dimensions}
    expect(buildTslScalarNode(document(noise))).toBeTruthy()
    expect(isUnitBoundedExpression(noise)).toBe(false)
    expect(isUnitRoughnessExpression(noise)).toBe(false)
    expect(isUnitBoundedExpression({...noise,inputDomain:'unit-bounded-live',minimum:0,maximum:1})).toBe(false)
    const clamped: TslIrExpression = {op:'clamp_minmax',value:noise,min:scalar(0),max:scalar(1)}
    expect(isUnitBoundedExpression(clamped)).toBe(true)
    expect(isUnitRoughnessExpression(clamped)).toBe(true)
    const outer: TslIrExpression = {...candidate('noise_varying'),dimensions:3,roughnessNode:noise}
    expect(() => buildTslScalarNode(document(outer))).toThrow(/proven \[0,1\]/)
    expect(buildTslScalarNode(document({...outer,roughnessNode:clamped}))).toBeTruthy()
  })
  it('does not grant legacy1D unit bounds from the ideal octave alone', () => {
    // Repeated native peak; legacy JS-double amplitude constants differ from
    // the shader-rounded sum. SwiftShader returns1.000000238418579 while
    // Metal returns1, so this serialized opcode has no portable unit proof.
    const noise: TslIrExpression = {...candidate('noise'),dimensions:1,detail:6,
      input:scalar(291.5),roughness:Math.fround(.063289),lacunarity:1}
    expect(buildTslScalarNode(document(noise))).toBeTruthy()
    expect(isUnitBoundedExpression(noise)).toBe(false)
    expect(isUnitRoughnessExpression(noise)).toBe(false)
    expect(isUnitBoundedExpression({op:'clamp_minmax',value:noise,min:scalar(0),max:scalar(1)})).toBe(true)
    expect(isUnitBoundedExpression({...noise,op:'noise_normalized'})).toBe(true)
    expect(isUnitBoundedExpression({...noise,op:'noise_varying',detail:2,roughness:1,roughnessNode:scalar(.5)})).toBe(true)
  })
})
