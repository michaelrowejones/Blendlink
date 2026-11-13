import { expect, it } from 'vitest'
import { buildTslColorNode, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'

it('keeps the native Checker Fac output scalar while guarding a color-typed factor', () => {
  const factor: TslIrExpression = {
    op: 'tex_checker',
    output: 'fac',
    vector: { op: 'const_vec3', value: [0.2, 0.3, 0.4] },
    scale: { op: 'const_float', value: 1 },
    color1: { op: 'const_vec3', value: [0.25, 0.35, 0.8] },
    color2: { op: 'const_vec3', value: [0.85, 0.65, 0.55] },
  }
  const doc: TslIrDocument = {
    schemaVersion: 1,
    model: 'blendlink-tsl-ir-v1',
    output: {
      op: 'mix_color',
      blendType: 'MIX',
      clampFactor: true,
      factor,
      a: factor.color1,
      b: factor.color2,
    },
  }
  expect(() => buildTslColorNode(doc)).not.toThrow()
  factor.output = 'color'
  expect(() => buildTslColorNode(doc)).toThrow(/vector-typed/)
  doc.output.factor = { op: 'rgb_to_bw', input: factor }
  expect(() => buildTslColorNode(doc)).not.toThrow()
})
