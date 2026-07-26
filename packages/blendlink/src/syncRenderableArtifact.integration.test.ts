import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBakedRecipe } from './bakedRecipe.js'
import type { ResolvedConfig, ResolvedScene } from './config.js'
import { generateSceneModule } from './typegen.js'

const mocks = vi.hoisted(() => ({ exportBlend: vi.fn() }))

vi.mock('./invoke.js', () => ({ exportBlend: mocks.exportBlend }))

import { syncScene, verifyAll } from './sync.js'

const temporaryDirectories: string[] = []

function mutateGlbJson(
  bytes: Uint8Array,
  mutate: (json: Record<string, unknown>) => void,
): Uint8Array {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = source.getUint32(12, true)
  const jsonStart = 20
  const jsonEnd = jsonStart + jsonLength
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd)).trim(),
  ) as Record<string, unknown>
  mutate(json)
  const encoded = new TextEncoder().encode(JSON.stringify(json))
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4
  const suffix = bytes.subarray(jsonEnd)
  const result = new Uint8Array(20 + paddedLength + suffix.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, result.byteLength, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  result.set(encoded, jsonStart)
  result.fill(0x20, jsonStart + encoded.byteLength, jsonStart + paddedLength)
  result.set(suffix, jsonStart + paddedLength)
  return result
}

function transactionalResidue(root: string): string[] {
  const found: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (
        entry.name.startsWith('.blendlink-stage-')
        || entry.name.includes('.blendlink-next-')
        || entry.name.includes('.blendlink-backup-')
      ) {
        found.push(path)
      }
      if (entry.isDirectory()) visit(path)
    }
  }
  visit(root)
  return found
}

afterEach(() => {
  mocks.exportBlend.mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('final renderable-artifact publication gate', () => {
  it('rejects an incompatible exact staged GLB without disturbing the last-known-good publication', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-runtime-capability-rollback-'))
    temporaryDirectories.push(root)
    const scene: ResolvedScene = {
      name: 'hero',
      root,
      blendPath: join(root, 'hero.blend'),
      glbPath: join(root, 'public', 'models', 'hero.glb'),
      url: '/models/hero.glb',
      manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
      modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
      settings: { mode: 'standard' },
      external: false,
    }
    const recipePath = scene.modulePath.replace(/\.gen\.ts$/, '.baked.ts')
    mkdirSync(dirname(scene.glbPath), { recursive: true })
    mkdirSync(dirname(scene.manifestPath), { recursive: true })
    writeFileSync(scene.blendPath, 'artist blend bytes')
    const previous = {
      glb: Buffer.from('last known good glb'),
      manifest: '{"lastKnownGood":true}\n',
      module: 'export const lastKnownGood = true\n',
      recipe: `${renderBakedRecipe(scene.name)}\n// last-known-good developer edit\n`,
    }
    writeFileSync(scene.glbPath, previous.glb)
    writeFileSync(scene.manifestPath, previous.manifest)
    writeFileSync(scene.modulePath, previous.module)
    writeFileSync(recipePath, previous.recipe)

    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      const document = new Document()
      const buffer = document.createBuffer()
      const position = document.createAccessor('Position')
        .setType('VEC3')
        .setBuffer(buffer)
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      const mesh = document.createMesh('Visible').addPrimitive(
        document.createPrimitive().setAttribute('POSITION', position),
      )
      document.createScene('Scene').addChild(document.createNode('Visible').setMesh(mesh))
      const bytes = mutateGlbJson(await new NodeIO().writeBinary(document), (json) => {
        json.extensionsUsed = ['KHR_node_visibility']
        json.extensionsRequired = ['KHR_node_visibility']
      })
      writeFileSync(outPath, bytes)
      return {
        ok: true as const,
        glbPath: outPath,
        blenderVersion: '5.2.0',
        exporterKwargsDropped: [],
        warnings: [],
        excluded: [],
        sidecar: { fps: 24, markers: [], empties: [], curves: [], textures: [] },
        bakedStates: {},
        bakedStateVisibility: {},
        bakedLightGroups: {},
        presentation: 'realtime' as const,
        reflectionProbeAssets: {},
        durationMs: 1,
      }
    })

    await expect(syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    }, { force: true })).rejects.toThrow(
      /runtime\.required-extension-unsupported.*KHR_node_visibility/s,
    )

    expect(readFileSync(scene.glbPath)).toEqual(previous.glb)
    expect(readFileSync(scene.manifestPath, 'utf8')).toBe(previous.manifest)
    expect(readFileSync(scene.modulePath, 'utf8')).toBe(previous.module)
    expect(readFileSync(recipePath, 'utf8')).toBe(previous.recipe)
    expect(transactionalResidue(root)).toEqual([])
  })

  it('refuses an empty staged GLB and preserves the last published artifact set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-renderable-artifact-'))
    temporaryDirectories.push(root)
    const scene: ResolvedScene = {
      name: 'hero',
      root,
      blendPath: join(root, 'hero.blend'),
      glbPath: join(root, 'public', 'models', 'hero.glb'),
      url: '/models/hero.glb',
      manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
      modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
      settings: { mode: 'standard' },
      external: false,
    }
    mkdirSync(dirname(scene.glbPath), { recursive: true })
    mkdirSync(dirname(scene.manifestPath), { recursive: true })
    writeFileSync(scene.blendPath, 'artist blend bytes')
    const previous = {
      glb: Buffer.from('last known good glb'),
      manifest: '{"lastKnownGood":true}\n',
      module: 'export const lastKnownGood = true\n',
    }
    writeFileSync(scene.glbPath, previous.glb)
    writeFileSync(scene.manifestPath, previous.manifest)
    writeFileSync(scene.modulePath, previous.module)

    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      const document = new Document()
      document.createScene('World and camera helpers only')
      writeFileSync(outPath, await new NodeIO().writeBinary(document))
      return {
        ok: true as const,
        glbPath: outPath,
        blenderVersion: '5.2.0',
        exporterKwargsDropped: [],
        warnings: [],
        excluded: [],
        sidecar: { fps: 24, markers: [], empties: [], curves: [], textures: [] },
        bakedStates: {},
        bakedStateVisibility: {},
        bakedLightGroups: {},
        presentation: 'realtime' as const,
        reflectionProbeAssets: {},
        durationMs: 1,
      }
    })

    await expect(syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    }, { force: true })).rejects.toThrow(
      /no renderable mesh primitives.*helper or asset library.*`blendlink plan`/s,
    )

    expect(readFileSync(scene.glbPath)).toEqual(previous.glb)
    expect(readFileSync(scene.manifestPath, 'utf8')).toBe(previous.manifest)
    expect(readFileSync(scene.modulePath, 'utf8')).toBe(previous.module)
    expect(readdirSync(dirname(scene.glbPath)).filter(
      (name) => name.startsWith('.blendlink-stage-'),
    )).toEqual([])
  })

  it('rejects a previously generated empty artifact during Blender-free verification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-verify-renderable-artifact-'))
    temporaryDirectories.push(root)
    const scene: ResolvedScene = {
      name: 'hero',
      root,
      blendPath: join(root, 'external-helper.blend'),
      glbPath: join(root, 'public', 'models', 'hero.glb'),
      url: '/models/hero.glb',
      manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
      modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
      settings: {},
      external: true,
    }
    mkdirSync(dirname(scene.glbPath), { recursive: true })
    mkdirSync(dirname(scene.manifestPath), { recursive: true })
    const document = new Document()
    document.createScene('Empty external scene')
    writeFileSync(scene.glbPath, await new NodeIO().writeBinary(document))
    const generated = await generateSceneModule({
      glbPath: scene.glbPath,
      url: scene.url,
      exportName: scene.name,
    })
    writeFileSync(scene.manifestPath, JSON.stringify(generated.manifest, null, 2) + '\n')
    writeFileSync(scene.modulePath, generated.module)
    writeFileSync(
      scene.modulePath.replace(/\.gen\.ts$/, '.baked.ts'),
      renderBakedRecipe(scene.name),
    )
    const config: ResolvedConfig = { root, website: { root }, scenes: [scene] }

    expect((await verifyAll(config))).toContainEqual(expect.objectContaining({
      scene: scene.name,
      problem: expect.stringMatching(
        /compiled GLB quality audit failed:.*no renderable mesh primitives.*default scene/,
      ),
    }))
  })
})
