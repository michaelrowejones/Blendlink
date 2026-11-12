import { describe, expect, it } from 'vitest'
import { buildTslColorNode, createTslBuildResources, type TslIrDocument, type TslIrExpression } from './tslNodeRecipe.js'

const noise = (): TslIrExpression => ({
  op: 'noise_fractal', normalize: false, output: 'fac', dimensions: 3,
  detail: 2, roughness: .5, lacunarity: 2,
  scale: { op: 'const_float', value: 1 },
  input: { op: 'tex_image', width: 1, height: 1, pixels: [.25, .5, .75, 1],
    interpolation: 'Closest', extension: 'REPEAT', output: 'color', vector: { op: 'uv' } },
})
function document(x: TslIrExpression, y: TslIrExpression, z: TslIrExpression): TslIrDocument {
  return { schemaVersion: 1, model: 'blendlink-tsl-ir-v1', output: { op: 'combine', x, y, z } }
}

describe('repeated scalar Noise in Combine channels', () => {
  it('evaluates identical separately serialized scalar fields once', () => {
    const resources = createTslBuildResources()
    try {
      expect(buildTslColorNode(document(noise(), noise(), noise()), { resources }).isNode).toBe(true)
      expect(resources.textures).toHaveLength(1)
    } finally { resources.dispose() }
  })
  it('keeps distinct controls and signed-zero input bits independent', () => {
    for (const value of [.625, -0]) {
      const x = noise(), y = noise(), z = noise()
      if (value === 0) {
        x.scale = { op: 'const_float', value: 0 }
        z.scale = { op: 'const_float', value: 0 }
        y.scale = { op: 'const_float', value }
      } else y.roughness = value
      const resources = createTslBuildResources()
      try {
        buildTslColorNode(document(x, y, z), { resources })
        expect(resources.textures).toHaveLength(3)
      } finally { resources.dispose() }
    }
  })
  it('does not skip validation for a differing malformed channel', () => {
    const x = noise(), y = noise()
    y.detail = '2'
    const resources = createTslBuildResources()
    try {
      expect(() => buildTslColorNode(document(x, y, x), { resources })).toThrow(/finite fractal controls/)
    } finally { resources.dispose() }
  })
})
