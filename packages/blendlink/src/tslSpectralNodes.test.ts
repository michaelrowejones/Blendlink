import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTslColorNode, createTslBuildResources, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'

const tables = JSON.parse(readFileSync(new URL('../../blender-addon/spectral_tables.json', import.meta.url), 'utf8'))
function expression(kind = 'blackbody'): TslIrExpression {
  return { op: 'spectral', kind, model: 'cycles', matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    input: { op: 'const_float', value: kind === 'blackbody' ? 6500 : 500 },
    rCoefficients: tables.blackbody_table_r.flat(), gCoefficients: tables.blackbody_table_g.flat(),
    bCoefficients: tables.blackbody_table_b.flat(), samples: 81,
    values: tables.cie_color_match.flatMap((row: number[]) => [...row, 1]) }
}
const document = (output: TslIrExpression): TslIrDocument => ({ schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output })

describe('native spectral color programs', () => {
  it.each(['blackbody', 'wavelength'])('builds live %s from its explicit source model', kind => {
    const resources = createTslBuildResources()
    expect(buildTslColorNode(document(expression(kind)), { resources })).toBeTruthy()
    expect(resources.textures.length).toBe(kind === 'wavelength' ? 1 : 0)
    resources.dispose(); resources.dispose()
    expect(resources.textures).toHaveLength(0)
  })
  it('shares a native CIE table and releases it once for a repeated material graph', () => {
    const resources = createTslBuildResources()
    const output = { op: 'mix_color', blendType: 'MIX', factor: { op: 'const_float', value: 0.5 },
      a: expression('wavelength'), b: expression('wavelength') }
    expect(buildTslColorNode(document(output), { resources })).toBeTruthy()
    expect(resources.textures).toHaveLength(1)
    resources.dispose()
  })
  it.each(['matrix', 'rCoefficients', 'gCoefficients', 'bCoefficients'])('names malformed %s data', field => {
    const output = expression()
    output[field] = [Number.NaN]
    expect(() => buildTslColorNode(document(output))).toThrow(/Spectral .* requires .* finite values/)
  })
  it('refuses unrecognized evaluation semantics', () => {
    const output = expression()
    output.model = 'future-model'
    expect(() => buildTslColorNode(document(output))).toThrow(/Unknown spectral evaluation model/)
  })
  it('refuses a truncated native CIE table', () => {
    const output = expression('wavelength')
    output.samples = 80
    expect(() => buildTslColorNode(document(output))).toThrow(/81 native CIE samples/)
  })
})
