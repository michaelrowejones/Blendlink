import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENE_RECIPE, type SceneRecipe } from './sceneRecipe.js'
import { generateSceneModule } from './typegen.js'

async function writeProbeGlb(path: string, includeProbe = true): Promise<void> {
  const document = new Document()
  const scene = document.createScene('Scene')
  if (includeProbe) {
    scene.addChild(document.createNode('Hero Probe').setExtras({ blendlink_id: 'probe-uuid' }))
  }
  scene.addChild(document.createNode('Hero Anchor').setExtras({ blendlink_id: 'anchor-uuid' }))
  scene.addChild(document.createNode('Hero Mesh').setExtras({
    blendlink_id: 'mesh-uuid',
    blendlink_reflection_probe: 'probe-uuid',
  }))
  writeFileSync(path, await new NodeIO().writeBinary(document))
}

const recipe: SceneRecipe = {
  ...DEFAULT_SCENE_RECIPE,
  reflectionProbes: [{
    id: 'hero-metal', name: 'Hero Metal', objectId: 'probe-uuid', objectName: 'Hero Probe',
    shape: 'box', source: 'runtime', resolution: 256, samples: 128,
    influence: 8, intensity: 1,
    anchorId: 'anchor-uuid', anchorName: 'Hero Anchor',
  }],
  components: [{
    id: 'hero-link', type: 'blendlink.open-url', schemaVersion: 1, enabled: true,
    target: { kind: 'object', objectId: 'mesh-uuid', objectName: 'Hero Mesh' },
    values: { url: 'https://example.com', newTab: true },
  }],
}

describe('reflection probe generated contract', () => {
  it('emits literal probe ids and explicit loaded-node assignments', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-probes-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeProbeGlb(glbPath)
      const generated = await generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe,
      })
      expect(generated.manifest.recipe?.reflectionProbes[0]).toMatchObject({
        id: 'hero-metal', objectId: 'probe-uuid', anchorId: 'anchor-uuid',
      })
      expect(generated.manifest.components).toEqual(recipe.components)
      expect(generated.module).toContain('reflectionProbes: [{"id":"hero-metal"')
      expect(generated.module).toContain('components: [{"id":"hero-link"')
      expect(generated.module).toContain('reflectionProbeAssignments: {')
      expect(generated.module).toContain('Hero_Mesh: "probe-uuid"')
      expect(generated.module).toContain('ReflectionProbeId =')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('refuses a recipe whose probe helper did not reach the GLB', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-probes-missing-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeProbeGlb(glbPath, false)
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe,
      })).rejects.toThrow(/probe.*was not exported/i)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires and emits a byte-identified texture for Blender Bake probes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-probes-baked-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      await writeProbeGlb(glbPath)
      const bakedRecipe: SceneRecipe = {
        ...recipe,
        reflectionProbes: [{
          ...recipe.reflectionProbes[0], source: 'baked',
          texture: {
            imageName: 'Hero Reflection.exr', width: 1024, height: 512,
            format: 'exr', colorSpace: 'linear',
            sourceHash: '0123456789abcdef01234567', contentHash: 'fedcba9876543210',
          },
        }],
      }
      const asset = {
        url: '/hero-reflection.exr', sourceName: 'Hero Reflection.exr',
        mode: 'baked' as const, format: 'exr' as const, colorSpace: 'linear' as const,
        width: 1024, height: 512, bytes: 1234, hash: 'fedcba9876543210',
        source: 'linked' as const, sourceHash: '0123456789abcdef01234567',
      }
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe: bakedRecipe,
      })).rejects.toThrow(/published texture/i)
      await expect(generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe: bakedRecipe,
        reflectionProbeAssets: {
          'hero-metal': { ...asset, hash: '0000000000000000' },
        },
      })).rejects.toThrow(/bytes\/source hash disagree/i)

      const generated = await generateSceneModule({
        glbPath, url: '/hero.glb', exportName: 'hero', recipe: bakedRecipe,
        reflectionProbeAssets: { 'hero-metal': asset },
      })
      expect(generated.manifest.reflectionProbeAssets?.['hero-metal']).toEqual(asset)
      expect(generated.manifest.stats.reflectionProbeBytes).toBe(1234)
      expect(generated.module).toContain('hero-reflection.exr?v=fedcba9876543210')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
