import { describe, expect, it } from 'vitest'
import { buildTslColorNode, type TslIrExpression } from './tslNodeRecipe.js'

const scalar = (value: number): TslIrExpression => ({ op: 'const_float', value })
function expression(output: 'color' | 'fac' = 'color'): TslIrExpression {
  return { op: 'tex_brick', output, vector: { op: 'uv' },
    color1: { op: 'const_vec3', value: [0.2, 0.4, 0.8] }, color2: { op: 'const_vec3', value: [0.8, 0.4, 0.2] },
    mortar: { op: 'const_vec3', value: [0.1, 0.1, 0.1] }, scale: scalar(5),
    brickWidth: scalar(.5), rowHeight: scalar(.25), mortarSize: scalar(.02), mortarSmooth: scalar(.1), bias: scalar(0),
    offsetAmount: .5, offsetFrequency: 2, squashAmount: 1, squashFrequency: 2 }
}
const build = (output: TslIrExpression) => buildTslColorNode({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output })
describe('native Brick texture programs', () => {
  it.each(['color', 'fac'] as const)('builds the live %s output', output => expect(build(expression(output))).toBeTruthy())
  it.each(['offsetAmount', 'offsetFrequency', 'squashAmount', 'squashFrequency'])('names malformed %s', key => {
    const output = expression(); output[key] = Number.NaN
    expect(() => build(output)).toThrow(/Brick Texture has an invalid/)
  })
  it('refuses an unrecognized output', () => {
    const output = expression(); output.output = 'missing'
    expect(() => build(output)).toThrow(/unknown output/)
  })
  it('names a missing live input', () => {
    const output = expression(); delete output.scale
    expect(() => build(output)).toThrow(/expression for scale/)
  })
})
