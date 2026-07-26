import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENE_RECIPE, type SceneRecipe } from './sceneRecipe.js'
import { generateSceneModule } from './typegen.js'

describe('final GLB camera aspect diagnostics', () => {
  it('persists and surfaces an AUTHORED orthographic composition mismatch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-camera-aspect-'))
    try {
      const glbPath = join(directory, 'hero.glb')
      const document = new Document()
      const camera = document.createCamera('Website Camera')
        .setType('orthographic')
        .setXMag(1.8)
        .setYMag(1.8)
      document.createScene('Scene').addChild(
        document.createNode('Website Camera')
          .setExtras({ blendlink_id: 'camera-id' })
          .setCamera(camera),
      )
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))
      const recipe: SceneRecipe = {
        ...DEFAULT_SCENE_RECIPE,
        camera: {
          objectId: 'camera-id',
          objectName: 'Website Camera',
          behavior: 'fixed',
          framing: 'authored',
          compositions: [
            { name: 'Desktop', width: 1440, height: 900, safeMargin: 0.08 },
          ],
        },
      }

      const generated = await generateSceneModule({
        glbPath,
        url: '/hero.glb',
        exportName: 'hero',
        recipe,
      })

      const evidence = generated.manifest.sceneDiagnostics
        ?.camera?.authoredOrthographicAspect
      expect(evidence).toMatchObject({
        code: 'camera.authored-orthographic-aspect',
        exportedAspect: 1,
        compositions: [{ name: 'Desktop', aspect: 1.6 }],
      })
      expect(generated.manifest.vocabulary.warnings).toContain(evidence?.warning)
      expect(generated.module).not.toContain('camera.authored-orthographic-aspect')
      expect(generated.module).not.toContain('no named camera composition matches')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
