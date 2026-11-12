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
  it('shares identical normalized fields but keeps their source precision models distinct', () => {
    const normalized = (): TslIrExpression => ({ ...noise(), op: 'noise_normalized', normalize: true, detail: 1,
      perlinModel: 'native-standard-f32' })
    const resources = createTslBuildResources()
    try {
      buildTslColorNode(document(normalized(), normalized(), normalized()), { resources })
      expect(resources.textures).toHaveLength(1)
    } finally { resources.dispose() }
    const distinct = createTslBuildResources()
    try {
      const x = normalized(), y = normalized(), z = normalized()
      y.perlinModel = 'cycles-neon-fma'
      buildTslColorNode(document(x, y, z), { resources: distinct })
      expect(distinct.textures).toHaveLength(3)
    } finally { distinct.dispose() }
  })
  it('shares native live Roughness fields without sharing different scalar controls', () => {
    const live = (): TslIrExpression => ({...noise(),op:'noise_varying_native',sourceEngine:'EEVEE',nativeGpuBackend:'METAL',
      perlinModel:'eevee-metal-periodic-f32',normalize:true,noiseType:'FBM',detail:2,roughness:1,roughnessNode:{op:'const_float',value:.5}})
    const resources=createTslBuildResources()
    try {
      buildTslColorNode(document(live(),live(),live()),{resources})
      expect(resources.textures).toHaveLength(1)
    } finally {resources.dispose()}
    const different=createTslBuildResources()
    try {
      const x=live(),y=live(),z=live();y.roughnessNode={op:'const_float',value:.25}
      buildTslColorNode(document(x,y,z),{resources:different})
      expect(different.textures).toHaveLength(3)
    } finally {different.dispose()}
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
