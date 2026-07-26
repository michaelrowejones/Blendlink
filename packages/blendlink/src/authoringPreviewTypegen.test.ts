import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { generateSceneModule } from './typegen.js'

describe('authoring preview generated contract', () => {
  it('preserves additive Blender look and shadow evidence in the manifest and descriptor', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-authoring-preview-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      const document = new Document()
      document.createScene('Scene').addChild(document.createNode('Hero'))
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const authoringPreview = {
        look: {
          toneMapping: 'neutral' as const,
          exposure: -0.75,
          sourceViewTransform: 'Khronos PBR Neutral',
          exact: true,
        },
        shadows: { enabled: true },
        world: {
          color: [0.05, 0.1, 0.2] as const,
          strength: 1.5,
          exact: true,
          source: 'background' as const,
        },
        warnings: ['Blender look Medium High Contrast is not reproduced'],
      }

      const generated = await generateSceneModule({
        glbPath,
        url: '/hero.glb',
        exportName: 'hero',
        sidecar: {
          fps: 24,
          markers: [],
          empties: [],
          curves: [],
          textures: [],
          authoringPreview,
        },
      })

      expect(generated.manifest.authoringPreview).toEqual(authoringPreview)
      expect(generated.module).toContain(
        'authoringPreview: {"look":{"toneMapping":"neutral","exposure":-0.75,' +
          '"sourceViewTransform":"Khronos PBR Neutral","exact":true},' +
          '"shadows":{"enabled":true},"world":{"color":[0.05,0.1,0.2],"strength":1.5,' +
          '"exact":true,"source":"background"},' +
          '"warnings":["Blender look Medium High Contrast is not reproduced"]} as const',
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
