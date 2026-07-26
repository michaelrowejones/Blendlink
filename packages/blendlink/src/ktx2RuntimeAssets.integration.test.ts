import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig, ResolvedScene } from './config.js'
import { createSceneAssetGraph } from './sceneAssetGraph.js'
import { DEFAULT_SCENE_RECIPE } from './sceneRecipe.js'

const mocks = vi.hoisted(() => ({
  exportBlend: vi.fn(),
  compressTexturesKtx2: vi.fn(),
}))

vi.mock('./invoke.js', () => ({ exportBlend: mocks.exportBlend }))
vi.mock('./textureCompression.js', () => ({
  compressTexturesKtx2: mocks.compressTexturesKtx2,
}))

import { publishKtx2RuntimeAssets, syncScene, verifyAll } from './sync.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  mocks.exportBlend.mockReset()
  mocks.compressTexturesKtx2.mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('internal KTX2 runtime asset publication', () => {
  it('publishes the same complete runtime for generic external typegen pipelines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-external-ktx2-runtime-'))
    temporaryDirectories.push(root)

    const published = await publishKtx2RuntimeAssets(root)

    expect(published.map((path) => path.slice(root.length + 1).replace(/\\/g, '/'))).toEqual([
      'blendlink-basis/basis_transcoder.js',
      'blendlink-basis/basis_transcoder.wasm',
      'blendlink-basis/README.md',
      'blendlink-basis/LICENSE',
    ])
    for (const path of published) expect(existsSync(path), path).toBe(true)
  })

  it('publishes attribution and transcoder bytes transactionally, then invalidates missing assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-ktx2-runtime-'))
    temporaryDirectories.push(root)
    const output = join(root, 'public', 'scenes')
    const generated = join(root, 'src', 'generated')
    const scene: ResolvedScene = {
      name: 'hero',
      root,
      blendPath: join(root, 'hero.blend'),
      glbPath: join(output, 'hero.glb'),
      url: '/scenes/hero.glb',
      manifestPath: join(generated, 'hero.manifest.json'),
      modulePath: join(generated, 'hero.gen.ts'),
      settings: {},
      external: false,
    }
    writeFileSync(scene.blendPath, 'blend bytes')
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      const document = new Document()
      const buffer = document.createBuffer()
      const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      const mesh = document.createMesh('Realtime Mesh').addPrimitive(
        document.createPrimitive().setAttribute('POSITION', position),
      )
      document.createScene('Scene').addChild(document.createNode('Realtime Mesh').setMesh(mesh))
      writeFileSync(outPath, await new NodeIO().writeBinary(document))
      return {
        ok: true,
        glbPath: outPath,
        blenderVersion: '5.2.0',
        exporterKwargsDropped: [],
        warnings: [],
        excluded: [],
        sidecar: { fps: 24, markers: [], empties: [], curves: [], textures: [] },
        bakedStates: {},
        bakedStateVisibility: {},
        bakedLightGroups: {},
        recipe: {
          ...DEFAULT_SCENE_RECIPE,
          presentation: 'realtime' as const,
          optimization: { geometry: 'none' as const, textures: 'ktx2' as const },
        },
        presentation: 'realtime' as const,
        durationMs: 1,
      }
    })
    mocks.compressTexturesKtx2.mockResolvedValue({
      report: {
        format: 'ktx2', encoder: 'KTX-Software', encoderVersion: 'test',
        inputBytes: 10, outputBytes: 5, savedBytes: 5, ratio: 0.5,
        textures: [], skipped: [],
      },
      warnings: [],
    })
    const blender = { executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0] as [number, number, number] }
    const config: ResolvedConfig = { root, website: { root }, scenes: [scene] }

    const first = await syncScene(scene, blender)
    expect(first.action).toBe('exported')
    const basisDirectory = join(output, 'blendlink-basis')
    for (const filename of ['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md', 'LICENSE']) {
      expect(existsSync(join(basisDirectory, filename)), filename).toBe(true)
    }
    expect(readFileSync(join(basisDirectory, 'README.md'), 'utf8')).toMatch(/Basis Universal GPU Texture Compression/)
    expect(readFileSync(join(basisDirectory, 'LICENSE'), 'utf8')).toMatch(/Apache License\s+Version 2\.0/)
    expect(await verifyAll(config)).toEqual([])

    const skipped = await syncScene(scene, blender)
    expect(skipped.action).toBe('skipped')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(1)

    // Model a future compiler-owned companion that has entered the graph but
    // has no dedicated manifest field. Both verify and the unchanged fast
    // path must follow the graph rather than a hard-coded sidecar list.
    const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const futurePath = join(output, 'future-runtime.bin')
    writeFileSync(futurePath, 'future runtime bytes')
    manifest.runtimeAssetGraph = createSceneAssetGraph([
      ...manifest.runtimeAssetGraph.entries.map((entry: { path: string, role: 'scene' | 'companion' | 'basis-runtime' }) => ({
        path: entry.path,
        role: entry.role,
        bytes: readFileSync(join(output, ...entry.path.split('/'))),
      })),
      { path: 'future-runtime.bin', role: 'companion', bytes: readFileSync(futurePath) },
    ], { requiresKtx2: true })
    writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    unlinkSync(futurePath)
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContainEqual(
      expect.stringMatching(
        /runtime asset publication integrity failed:.*bundlePath must end with graph fingerprint/i,
      ),
    )
    const graphRepaired = await syncScene(scene, blender)
    expect(graphRepaired.action).toBe('exported')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(2)

    const wasmPath = join(basisDirectory, 'basis_transcoder.wasm')
    unlinkSync(wasmPath)
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContain(
      `KTX2 runtime transcoder integrity failed: basis_transcoder.wasm is missing from ${wasmPath}`,
    )
    const repaired = await syncScene(scene, blender)
    expect(repaired.action).toBe('exported')
    expect(existsSync(wasmPath)).toBe(true)
    expect(mocks.exportBlend).toHaveBeenCalledTimes(3)
  })
})
