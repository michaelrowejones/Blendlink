import { describe, expect, it } from 'vitest'
import { buildTslColorNode, createTslBuildResources, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'

function expression(kind = 'float', model = 'cycles'): TslIrExpression {
  const count = kind === 'float' ? 1 : kind === 'vector' ? 3 : 4
  return { op: 'curve_native', kind, model, domain: [0, 1], extrapolate: true,
    ranges: Array.from({ length: count }, () => [0, 1]), slopes: Array.from({ length: count }, () => [1, 1]),
    input: kind === 'float' ? { op: 'const_float', value: .37 } : { op: 'const_vec3', value: [-.3, .37, 1.7] },
    factor: { op: 'const_float', value: 1.5 }, samples: 257,
    values: Array.from({ length: 257 }, (_, i) => [i / 256, i / 256, i / 256, i / 256]).flat(),
    tableStorage: 'rgba16f', sampleStorage: 'rgba16f', filterFractionBits: 8 }
}
const document = (output: TslIrExpression): TslIrDocument => ({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output })

describe('native shader Curve Mapping', () => {
  it.each(['cycles', 'shader-mf', 'eevee-gpu'])('builds three curve kinds through the %s source model', model => {
    for (const kind of ['float', 'vector', 'rgb']) {
      const resources = createTslBuildResources()
      expect(buildTslColorNode(document(expression(kind, model)), { resources })).toBeTruthy()
      expect(resources.textures).toHaveLength(1)
      resources.dispose(); resources.dispose()
      expect(resources.textures).toHaveLength(0)
    }
  })
  it('deduplicates native curve tables within one material and releases them', () => {
    const resources = createTslBuildResources()
    const output = { op: 'mix_color', blendType: 'MIX', factor: { op: 'const_float', value: .5 },
      a: expression('rgb'), b: expression('rgb') }
    expect(buildTslColorNode(document(output), { resources })).toBeTruthy()
    expect(resources.textures).toHaveLength(1)
    resources.dispose()
  })
  it.each(['unknown', 'future-gpu'])('refuses unknown evaluation model %s', model => {
    expect(() => buildTslColorNode(document(expression('float', model)))).toThrow(/Unknown native shader curve evaluation model/)
  })
  it('refuses collapsed domains instead of emitting nonfinite shader values', () => {
    const output = expression(); output.domain = [1, 1]
    expect(() => buildTslColorNode(document(output))).toThrow(/finite nonzero input domain/)
  })
  it('refuses invalid MF range and clip metadata', () => {
    const output = expression('float', 'shader-mf'); output.ranges = [[0, 0]]
    expect(() => buildTslColorNode(document(output))).toThrow(/native per-channel ranges and slopes/)
    output.ranges = [[0, 1]]; output.clip = true; output.clipY = [1, 0]
    expect(() => buildTslColorNode(document(output))).toThrow(/invalid clipping range/)
  })
  it('keeps old published curve_rgb documents readable', () => {
    const output = expression('rgb'); output.op = 'curve_rgb'
    expect(buildTslColorNode(document(output))).toBeTruthy()
  })
})
