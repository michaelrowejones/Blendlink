import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig, ResolvedScene } from './config.js'
import { DEFAULT_SCENE_RECIPE } from './sceneRecipe.js'
import { withPublicationLease } from './publicationLease.js'
import {
  publicationRootsForScene,
  resolvePublicationScopes,
} from './publicationScopes.js'

const mocks = vi.hoisted(() => ({ exportBlend: vi.fn() }))

vi.mock('./invoke.js', () => ({ exportBlend: mocks.exportBlend }))

import { syncScene, verifyAll } from './sync.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  mocks.exportBlend.mockReset()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

async function writeRenderableGlb(
  path: string,
  nodeName = 'Realtime Mesh',
): Promise<void> {
  const document = new Document()
  const buffer = document.createBuffer()
  const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
  const mesh = document.createMesh(nodeName).addPrimitive(
    document.createPrimitive().setAttribute('POSITION', position),
  )
  document.createScene('Scene').addChild(document.createNode(nodeName).setMesh(mesh))
  writeFileSync(path, await new NodeIO().writeBinary(document))
}

function fixture(): {
  root: string
  scene: ResolvedScene
  config: ResolvedConfig
  blender: { executable: string, version: string, semver: [number, number, number] }
} {
  const root = mkdtempSync(join(tmpdir(), 'blendlink-sync-asset-closure-'))
  temporaryDirectories.push(root)
  const scene: ResolvedScene = {
    name: 'hero',
    root,
    blendPath: join(root, 'hero.blend'),
    glbPath: join(root, 'public', 'scenes', 'hero.glb'),
    url: '/scenes/hero.glb',
    manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
    modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
    settings: {},
    external: false,
  }
  mkdirSync(dirname(scene.manifestPath), { recursive: true })
  writeFileSync(scene.blendPath, 'blend bytes')
  return {
    root,
    scene,
    config: { root, website: { root }, scenes: [scene] },
    blender: {
      executable: 'mock-blender',
      version: '5.2.0',
      semver: [5, 2, 0],
    },
  }
}

function realtimeResult(outPath: string): Record<string, unknown> {
  return {
    ok: true,
    glbPath: outPath,
    blenderVersion: '5.2.0',
    exporterKwargsDropped: [],
    warnings: [],
    excluded: [],
    sidecar: { fps: 24, markers: [], empties: [], curves: [], textures: [] },
    bakedStates: {},
    bakeOutputs: {},
    bakedStateScales: {},
    bakedStateVisibility: {},
    bakedLightGroups: {},
    bakedVariants: { states: {}, lightGroups: {} },
    reflectionProbeAssets: {},
    recipe: { ...DEFAULT_SCENE_RECIPE, presentation: 'realtime' as const },
    presentation: 'realtime' as const,
    durationMs: 1,
  }
}

describe('compiler-owned staging closure', () => {
  it('refuses to activate bytes compiled from an older source revision', async () => {
    const { scene, blender } = fixture()
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      writeFileSync(scene.blendPath, 'artist saved a newer revision while Blender was exporting')
      return realtimeResult(outPath)
    })

    await expect(syncScene(scene, blender))
      .rejects.toThrow(/source or declared compiler input changed while .* was compiling/i)
    expect(existsSync(scene.glbPath)).toBe(false)
    expect(existsSync(scene.manifestPath)).toBe(false)
    expect(existsSync(scene.modulePath)).toBe(false)
  })

  it('refuses to activate settings resolved from an older config revision', async () => {
    const { root, scene, blender } = fixture()
    const configPath = join(root, 'blendlink.config.mjs')
    writeFileSync(configPath, 'export default { scenes: [] }\n')
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      writeFileSync(configPath, 'export default { scenes: [], changedDuringCompile: true }\n')
      return realtimeResult(outPath)
    })

    await expect(syncScene(scene, blender))
      .rejects.toThrow(/source or declared compiler input changed while .* was compiling/i)
    expect(existsSync(scene.glbPath)).toBe(false)
    expect(existsSync(scene.manifestPath)).toBe(false)
    expect(existsSync(scene.modulePath)).toBe(false)
  })

  it('refuses an already-stale resolved config before invoking Blender', async () => {
    const { root, scene, blender } = fixture()
    const configPath = join(root, 'blendlink.config.mjs')
    writeFileSync(configPath, 'export default { scenes: [] }\n')
    scene.configSource = {
      path: configPath,
      hash: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    }
    writeFileSync(configPath, 'export default { scenes: [], changedWhileWaiting: true }\n')

    await expect(syncScene(scene, blender))
      .rejects.toThrow(/config.*changed since.*loaded/i)
    expect(mocks.exportBlend).not.toHaveBeenCalled()
    expect(existsSync(scene.glbPath)).toBe(false)
  })

  it('retains a same-revision Final publication when a queued Preview arrives', async () => {
    const { scene, blender } = fixture()
    let reportExportStarted!: () => void
    let releaseExport!: () => void
    const exportStarted = new Promise<void>((resolvePromise) => {
      reportExportStarted = resolvePromise
    })
    const exportRelease = new Promise<void>((resolvePromise) => {
      releaseExport = resolvePromise
    })
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      reportExportStarted()
      await exportRelease
      return realtimeResult(outPath)
    })

    const final = syncScene(scene, blender)
    await exportStarted
    let previewSettled = false
    const preview = syncScene(scene, blender, {
      draft: true,
      force: true,
    }).finally(() => {
      previewSettled = true
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30))
    expect(previewSettled).toBe(false)
    releaseExport()

    await expect(final).resolves.toMatchObject({ action: 'exported' })
    await expect(preview).resolves.toMatchObject({
      action: 'skipped',
      warnings: [expect.stringMatching(/retained.*Final.*same source revision/i)],
    })
    expect(mocks.exportBlend).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(scene.manifestPath, 'utf8')).draft).not.toBe(true)
  })

  it('allows a newer source revision to replace Final with an explicit Preview draft', async () => {
    const { scene, blender } = fixture()
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      return realtimeResult(outPath)
    })

    expect((await syncScene(scene, blender)).action).toBe('exported')
    writeFileSync(scene.blendPath, 'newer artist-authored blend bytes')
    expect((await syncScene(scene, blender, { draft: true })).action).toBe('exported')

    expect(mocks.exportBlend).toHaveBeenCalledTimes(2)
    const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    expect(manifest.draft).toBe(true)
  })

  it('verifies the config revision that produced published artifacts', async () => {
    const { root, scene, config, blender } = fixture()
    const configPath = join(root, 'blendlink.config.mjs')
    writeFileSync(configPath, 'export default { scenes: [{ file: "hero.blend" }] }\n')
    scene.configSource = {
      path: configPath,
      hash: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    }
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      return realtimeResult(outPath)
    })

    expect((await syncScene(scene, blender)).action).toBe('exported')
    writeFileSync(configPath, 'export default { scenes: [{ file: "hero.blend", imageFormat: "NONE" }] }\n')
    scene.configSource = {
      path: configPath,
      hash: createHash('sha256').update(readFileSync(configPath)).digest('hex'),
    }

    expect(await verifyAll(config)).toContainEqual(expect.objectContaining({
      scene: 'hero',
      problem: expect.stringMatching(/config revision.*published artifacts/i),
    }))
  })

  it('waits for an active publication instead of verifying a hybrid file set', async () => {
    const { scene, config, blender } = fixture()
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      return realtimeResult(outPath)
    })
    expect((await syncScene(scene, blender)).action).toBe('exported')

    const roots = publicationRootsForScene(scene)
    const firstScope = resolvePublicationScopes([
      roots.assetRoot,
      roots.generatedRoot,
    ])[0]!
    let verification!: Promise<Awaited<ReturnType<typeof verifyAll>>>
    let settled = false
    await withPublicationLease({
      lockPath: firstScope.lockPath,
      intent: 'test-active-publication',
      pollIntervalMs: 2,
    }, async () => {
      verification = verifyAll(config).finally(() => {
        settled = true
      })
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30))
      expect(settled).toBe(false)
    })

    await expect(verification).resolves.toEqual([])
  })

  it('reuses an identical sealed graph without touching its immutable files', async () => {
    const { scene, blender } = fixture()
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      return realtimeResult(outPath)
    })

    expect((await syncScene(scene, blender)).action).toBe('exported')
    const first = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const addressedGlb = join(
      dirname(scene.glbPath),
      ...first.runtimeAssetPublication.bundlePath.split('/'),
      first.runtimeAssetPublication.scenePath,
    )
    const retainedTime = new Date('2004-05-06T07:08:09.000Z')
    utimesSync(addressedGlb, retainedTime, retainedTime)

    expect((await syncScene(scene, blender, { force: true })).action).toBe('exported')
    const second = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    expect(second.runtimeAssetPublication).toEqual(first.runtimeAssetPublication)
    expect(statSync(addressedGlb).mtimeMs).toBe(retainedTime.getTime())
    expect(readdirSync(join(dirname(scene.glbPath), scene.name))
      .filter((entry) => /^[a-f0-9]{64}$/.test(entry))).toEqual([
        first.runtimeAssetGraph.fingerprint,
      ])
  })

  it('activates changed runtime bytes in a new graph while retaining the prior graph', async () => {
    const { scene, blender } = fixture()
    let generation = 0
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      generation += 1
      await writeRenderableGlb(outPath, `Realtime Mesh ${generation}`)
      return realtimeResult(outPath)
    })

    expect((await syncScene(scene, blender)).action).toBe('exported')
    const first = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const firstDirectory = join(
      dirname(scene.glbPath),
      ...first.runtimeAssetPublication.bundlePath.split('/'),
    )
    const firstBytes = readFileSync(join(
      firstDirectory,
      first.runtimeAssetPublication.scenePath,
    ))
    writeFileSync(scene.blendPath, 'artist-authored second runtime revision')

    expect((await syncScene(scene, blender)).action).toBe('exported')
    const second = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    expect(second.runtimeAssetGraph.fingerprint)
      .not.toBe(first.runtimeAssetGraph.fingerprint)
    expect(existsSync(firstDirectory)).toBe(true)
    expect(readFileSync(join(
      firstDirectory,
      first.runtimeAssetPublication.scenePath,
    ))).toEqual(firstBytes)
    expect(existsSync(join(
      dirname(scene.glbPath),
      ...second.runtimeAssetPublication.bundlePath.split('/'),
      second.runtimeAssetPublication.scenePath,
    ))).toBe(true)
  })

  it('preserves recursively declared companion paths through publish, skip, and verify', async () => {
    const { scene, config, blender } = fixture()
    const environmentBytes = Buffer.from('nested environment bytes')
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      const environmentPath = join(dirname(outPath), 'environments', 'studio', 'main.hdr')
      mkdirSync(dirname(environmentPath), { recursive: true })
      writeFileSync(environmentPath, environmentBytes)
      return {
        ...realtimeResult(outPath),
        environment: {
          path: environmentPath,
          sourceName: 'Studio',
          format: 'hdr',
          bytes: environmentBytes.byteLength,
          hash: createHash('sha256').update(environmentBytes).digest('hex').slice(0, 16),
          source: 'packed',
        },
      }
    })

    expect((await syncScene(scene, blender)).action).toBe('exported')
    const publishedEnvironment = join(dirname(scene.glbPath), 'environments', 'studio', 'main.hdr')
    expect(readFileSync(publishedEnvironment)).toEqual(environmentBytes)
    const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const bundlePath = manifest.runtimeAssetPublication.bundlePath as string
    expect(bundlePath).toBe(`hero/${manifest.runtimeAssetGraph.fingerprint}`)
    expect(manifest.url).toBe(
      `/scenes/${bundlePath}/hero.glb`,
    )
    expect(manifest.environment.url).toBe(
      `/scenes/${bundlePath}/environments/studio/main.hdr`,
    )
    expect(readFileSync(join(
      dirname(scene.glbPath),
      ...bundlePath.split('/'),
      'environments',
      'studio',
      'main.hdr',
    ))).toEqual(environmentBytes)
    expect(manifest.runtimeAssetGraph.entries.map((entry: { path: string }) => entry.path))
      .toEqual(['environments/studio/main.hdr', 'hero.glb'])
    expect((await syncScene(scene, blender)).action).toBe('skipped')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(1)
    expect(await verifyAll(config)).toEqual([])
  })

  it('rejects an undeclared staged file instead of silently promoting it into the graph', async () => {
    const { scene, blender } = fixture()
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      writeFileSync(join(dirname(outPath), 'orphan.tmp'), 'leftover encoder output')
      return realtimeResult(outPath)
    })

    await expect(syncScene(scene, blender))
      .rejects.toThrow(/undeclared compiler-owned staged file.*orphan\.tmp/i)
    expect(existsSync(scene.glbPath)).toBe(false)
    expect(existsSync(scene.manifestPath)).toBe(false)
  })

  it('rejects a declared file reached through a junction ancestor', async () => {
    const { root, scene, blender } = fixture()
    const redirected = join(root, 'redirected-assets')
    mkdirSync(redirected)
    writeFileSync(join(redirected, 'studio.hdr'), 'outside stage bytes')
    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      await writeRenderableGlb(outPath)
      const linkedDirectory = join(dirname(outPath), 'environments')
      symlinkSync(redirected, linkedDirectory, 'junction')
      const environmentPath = join(linkedDirectory, 'studio.hdr')
      return {
        ...realtimeResult(outPath),
        environment: {
          path: environmentPath,
          sourceName: 'Studio',
          format: 'hdr',
          bytes: 19,
          hash: '0'.repeat(16),
          source: 'linked',
        },
      }
    })

    await expect(syncScene(scene, blender))
      .rejects.toThrow(/symbolic link, junction, or reparse point.*environments/i)
    expect(existsSync(scene.glbPath)).toBe(false)
  })
})
