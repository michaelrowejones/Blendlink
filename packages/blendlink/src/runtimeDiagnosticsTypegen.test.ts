import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import type { BlendSidecar } from './invoke.js'
import { generateSceneModule } from './typegen.js'

function sidecar(sampleCount: number): BlendSidecar {
  const snapshot = (frame: number) => ({
    frame,
    vertices: 3,
    edges: 3,
    polygons: 1,
    triangles: 1,
    topologyHash: `topology-${frame}`,
    positionHash: `position-${frame}`,
    appearanceHash: `appearance-${frame}`,
  })
  return {
    fps: 24,
    markers: [],
    empties: [],
    curves: [],
    textures: [],
    diagnostics: {
      procedural: [{
        object: 'Procedural Proof',
        modifiers: [],
        dependencies: { camera: false, objects: [], collections: [] },
        source: snapshot(1),
        samples: Array.from({ length: sampleCount }, (_, index) => snapshot(index + 1)),
        sampledExhaustively: true,
        frameRange: [1, sampleCount],
        topology: 'deforming',
        appearanceChanging: true,
        sourceDelta: {
          vertices: 0,
          triangles: 0,
          topologyChanged: false,
          appearanceChanged: true,
        },
        route: 'Cache',
        blocking: false,
        reason: 'Exhaustive proof retained in the manifest.',
        estimatedMorphBytes: 4096,
      }],
      instances: [],
      materials: [{
        material: 'Tooling-only material evidence',
        status: 'needsBake',
        label: 'Needs Bake',
        summary: 'This record belongs in the manifest.',
        reasons: ['sentinel-material-reason'],
        usedBy: ['Procedural Proof'],
        cyclesAppearance: { status: 'compatible', blockers: [] },
      }],
      limits: { maxAuditFrames: 120, maxMorphCacheBytes: 64 * 1024 * 1024 },
    },
  }
}

describe('generated runtime diagnostics boundary', () => {
  it('retains exhaustive evidence in the manifest without scaling application code', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-runtime-diagnostics-'))
    try {
      const glbPath = join(directory, 'scene.glb')
      const document = new Document()
      document.createScene('Scene').addChild(document.createNode('Procedural Proof'))
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))

      const small = await generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        sidecar: sidecar(1),
      })
      const exhaustive = await generateSceneModule({
        glbPath,
        url: '/scene.glb',
        exportName: 'scene',
        sidecar: sidecar(400),
      })

      expect(exhaustive.manifest.sceneDiagnostics?.procedural.objects[0]?.samples)
        .toHaveLength(400)
      expect(exhaustive.manifest.sceneDiagnostics?.procedural.objects[0]?.samples[399])
        .toMatchObject({ positionHash: 'position-400' })
      expect(exhaustive.manifest.sceneDiagnostics?.materials?.records[0])
        .toMatchObject({ reasons: ['sentinel-material-reason'] })
      expect(exhaustive.module).toContain(
        'runtimeDiagnostics: {"schemaVersion":1,"lodChains":[],"instanceGroups":[]} as const',
      )
      expect(exhaustive.module).not.toContain('sceneDiagnostics:')
      expect(exhaustive.module).not.toContain('position-400')
      expect(exhaustive.module).not.toContain('sentinel-material-reason')
      expect(exhaustive.module).toBe(small.module)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
