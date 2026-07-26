import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import type { RectAreaLightContractEvidence } from './invoke.js'
import { generateSceneModule } from './typegen.js'

const descriptor = {
  schemaVersion: 1 as const,
  color: [1, 0.5, 0.25] as [number, number, number],
  size: [2, 3] as [number, number],
  power: 12,
  calibration: 'retained-additive-field',
}

const evidence: RectAreaLightContractEvidence = {
  sourceObjectName: 'Area_Key',
  nodeName: 'Area_Key',
  descriptor,
  attachment: 'attached',
}

async function withGlb(
  nodes: Array<{ name: string; extras?: Record<string, unknown> }>,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'blendlink-rect-area-contract-'))
  const path = join(directory, 'scene.glb')
  try {
    const document = new Document()
    const scene = document.createScene('Scene')
    for (const entry of nodes) {
      const node = document.createNode(entry.name)
      if (entry.extras) node.setExtras(entry.extras)
      scene.addChild(node)
    }
    writeFileSync(path, await new NodeIO().writeBinary(document))
    await run(path)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Rect Area finalized-node attestation', () => {
  it('accepts the exact finalized payload and retains additive v1 fields', async () => {
    await withGlb([{
      name: 'Area_Key',
      extras: { blendlink_rect_area_light: descriptor },
    }], async (path) => {
      const generated = await generateSceneModule({
        glbPath: path,
        url: '/area.glb',
        exportName: 'area',
        rectAreaLightContract: [evidence],
      })
      expect(generated.manifest.nodes[0]?.extras?.blendlink_rect_area_light).toEqual(descriptor)
    })
  })

  it('rejects a descriptor dropped or changed after Blender attachment', async () => {
    await withGlb([{ name: 'Area_Key' }], async (path) => {
      await expect(generateSceneModule({
        glbPath: path,
        url: '/area.glb',
        exportName: 'area',
        rectAreaLightContract: [evidence],
      })).rejects.toThrow(/descriptor must be an object/)
    })
    await withGlb([{
      name: 'Area_Key',
      extras: { blendlink_rect_area_light: { ...descriptor, power: 13 } },
    }], async (path) => {
      await expect(generateSceneModule({
        glbPath: path,
        url: '/area.glb',
        exportName: 'area',
        rectAreaLightContract: [evidence],
      })).rejects.toThrow(/changed between Blender attachment and the optimized GLB/)
    })
  })

  it('rejects unattested and ambiguous finalized descriptors', async () => {
    await withGlb([{
      name: 'Area_Key',
      extras: { blendlink_rect_area_light: descriptor },
    }], async (path) => {
      await expect(generateSceneModule({
        glbPath: path,
        url: '/area.glb',
        exportName: 'area',
        rectAreaLightContract: [],
      })).rejects.toThrow(/contains an unattested blendlink_rect_area_light/)
    })
    await withGlb([
      { name: 'Area_Key', extras: { blendlink_rect_area_light: descriptor } },
      { name: 'Area_Key', extras: { blendlink_rect_area_light: descriptor } },
    ], async (path) => {
      await expect(generateSceneModule({
        glbPath: path,
        url: '/area.glb',
        exportName: 'area',
        rectAreaLightContract: [evidence],
      })).rejects.toThrow(/contains 2/)
    })
  })

  it('keeps generic external GLBs usable when no Blender attestation seam is supplied', async () => {
    await withGlb([{
      name: 'External_Area',
      extras: { blendlink_rect_area_light: descriptor },
    }], async (path) => {
      const generated = await generateSceneModule({
        glbPath: path,
        url: '/external.glb',
        exportName: 'external',
      })
      expect(generated.manifest.nodes[0]?.extras?.blendlink_rect_area_light).toEqual(descriptor)
    })
  })
})
