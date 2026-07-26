import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './config.js'
import { setupWebsiteProject } from './projectSetup.js'
import { DEFAULT_SCENE_RECIPE } from './sceneRecipe.js'

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

describe('Realtime recipe publication', () => {
  it('self-heals the harmless recipe imported by a setup-generated consumer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-realtime-recipe-'))
    temporaryDirectories.push(root)
    const setup = await setupWebsiteProject(root)
    const config = await loadConfig(root)
    const scene = config.scenes[0]!

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
        recipe: { ...DEFAULT_SCENE_RECIPE, presentation: 'realtime' as const },
        presentation: 'realtime' as const,
        durationMs: 1,
      }
    })

    await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    const recipePath = join(root, 'src', 'generated', `${setup.sceneName}.baked.ts`)
    expect(existsSync(recipePath)).toBe(true)

    // This models a project last compiled before Realtime recipes were
    // published. An otherwise-current manifest must not hide the missing
    // module behind the unchanged-scene fast path.
    unlinkSync(recipePath)
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContain(
      `missing generated recipe (${recipePath})`,
    )
    const repaired = await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    expect(repaired.action).toBe('exported')
    expect(existsSync(recipePath)).toBe(true)

    const entryPath = join(root, 'src', 'main.ts')
    const entry = readFileSync(entryPath, 'utf8')
    const integrationSpecifier = entry.match(/from '([^']+\/blendlink\/[^']+)'/)?.[1]
    expect(integrationSpecifier).toBe(`./blendlink/SampleScene`)
    const integrationImport = ts.resolveModuleName(
      integrationSpecifier!,
      entryPath,
      { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
      ts.sys,
    ).resolvedModule
    const integrationPath = integrationImport!.resolvedFileName
    const integration = readFileSync(integrationPath, 'utf8')
    const recipeSpecifier = integration.match(/from '([^']+\.baked)'/)?.[1]
    expect(recipeSpecifier).toBe(`../generated/${setup.sceneName}.baked`)
    const resolvedImport = ts.resolveModuleName(
      recipeSpecifier!,
      integrationPath,
      { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
      ts.sys,
    ).resolvedModule
    expect(resolve(resolvedImport!.resolvedFileName)).toBe(resolve(recipePath))

    const artistLegacyRecipe = '// artist-owned pre-Lighting recipe\nexport const custom = true\n'
    writeFileSync(recipePath, artistLegacyRecipe)
    const migrationIssue = (await verifyAll(config)).find(
      (issue) => issue.problem.includes('predates baked composition template'),
    )
    expect(migrationIssue?.fix).toContain(`blendlink recipe update ${scene.name}`)
    expect(migrationIssue?.fix).toContain(`${recipePath}.blendlink-legacy.bak`)
    const realtimeSkip = await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    expect(realtimeSkip.action).toBe('skipped')
    expect(realtimeSkip.warnings.join('\n')).toContain('predates baked composition template')
    expect(readFileSync(recipePath, 'utf8')).toBe(artistLegacyRecipe)

    const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    manifest.states = { day: { url: '/day.png', default: true } }
    manifest.bakeOutputs = { main: 'appearance' }
    manifest.stateScales = { day: { main: 2 } }
    writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await expect(syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })).rejects.toThrow(/normalized Appearance state.*blendlink recipe update.*did not publish or preview/s)
    expect(readFileSync(recipePath, 'utf8')).toBe(artistLegacyRecipe)

    manifest.bakeOutputs = { main: 'lighting' }
    manifest.stateScales = { day: { main: 1 } }
    writeFileSync(scene.manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await expect(syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })).rejects.toThrow(/Lighting atlas.*blendlink recipe update.*did not publish or preview/s)
    expect(readFileSync(recipePath, 'utf8')).toBe(artistLegacyRecipe)
  })
})
