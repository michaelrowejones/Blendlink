import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedScene } from './config.js'

const mocks = vi.hoisted(() => ({
  exportBlend: vi.fn(),
  compilerSignatureSuffix: '',
  bakePlan: undefined as unknown,
}))

vi.mock('./invoke.js', () => ({ exportBlend: mocks.exportBlend }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync(path: Parameters<typeof actual.readFileSync>[0], ...args: unknown[]) {
      const value = (actual.readFileSync as (...input: unknown[]) => string | Buffer)(
        path,
        ...args,
      )
      const normalized = String(path).replace(/\\/g, '/')
      if (!mocks.compilerSignatureSuffix
          || !/\/planManifest\.(?:js|ts)$/u.test(normalized)) return value
      return typeof value === 'string'
        ? value + mocks.compilerSignatureSuffix
        : Buffer.concat([value, Buffer.from(mocks.compilerSignatureSuffix)])
    },
  }
})

import { syncScene } from './sync.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  mocks.exportBlend.mockReset()
  mocks.compilerSignatureSuffix = ''
  mocks.bakePlan = undefined
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Final material-portability publication gate', () => {
  it('refuses a realtime scene whose used material would lose authored surface behavior', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-material-portability-'))
    temporaryDirectories.push(root)
    const scene: ResolvedScene = {
      name: 'painterlyHero',
      root,
      blendPath: join(root, 'painterly-hero.blend'),
      glbPath: join(root, 'public', 'models', 'painterly-hero.glb'),
      url: '/models/painterly-hero.glb',
      manifestPath: join(root, 'src', 'generated', 'painterlyHero.manifest.json'),
      modulePath: join(root, 'src', 'generated', 'painterlyHero.gen.ts'),
      settings: { mode: 'standard' },
      external: false,
    }
    mkdirSync(dirname(scene.glbPath), { recursive: true })
    mkdirSync(dirname(scene.manifestPath), { recursive: true })
    writeFileSync(scene.blendPath, 'artist blend bytes')

    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      const document = new Document()
      const buffer = document.createBuffer()
      const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      const material = document.createMaterial('Showcase')
        .setBaseColorFactor([0.2, 0.4, 0.6, 1])
      const mesh = document.createMesh('Icosphere').addPrimitive(
        document.createPrimitive()
          .setAttribute('POSITION', position)
          .setMaterial(material),
      )
      document.createScene('Scene').addChild(
        document.createNode('Icosphere').setMesh(mesh),
      )
      writeFileSync(outPath, await new NodeIO().writeBinary(document))
      return {
        ok: true as const,
        glbPath: outPath,
        blenderVersion: '5.2.0',
        exporterKwargsDropped: [],
        warnings: [],
        excluded: [],
        sidecar: {
          fps: 24,
          markers: [],
          empties: [],
          curves: [],
          textures: [],
          diagnostics: {
            materials: [{
              material: 'Showcase',
              status: 'needsBake' as const,
              label: 'Needs Bake',
              summary:
                'The active shader graph cannot publish faithfully as editable glTF.',
              reasons: [
                'Fresnel is not a portable stock glTF material node.',
              ],
              usedBy: ['Icosphere'],
              cyclesAppearance: { status: 'compatible' as const, blockers: [] },
              materialCompilation: {
                intent: 'automatic' as const,
                outcome: 'preserved' as const,
                fidelity: 'full-surface' as const,
                transport: 'stock' as const,
                limitations: [],
              },
            }],
          },
        },
        bakedStates: {},
        bakedStateVisibility: {},
        bakedLightGroups: {},
        ...(mocks.bakePlan ? { plan: mocks.bakePlan } : {}),
        presentation: 'realtime' as const,
        reflectionProbeAssets: {},
        durationMs: 1,
      }
    })

    await expect(syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })).rejects.toThrow(
      /Material Fidelity.*Showcase.*Fresnel.*previous publication was not changed/s,
    )

    expect(existsSync(scene.glbPath)).toBe(false)
    expect(existsSync(scene.manifestPath)).toBe(false)
    expect(existsSync(scene.modulePath)).toBe(false)
    expect(readdirSync(dirname(scene.glbPath)).filter(
      (name) => name.startsWith('.blendlink-stage-'),
    )).toEqual([])

    scene.applicationMaterialAdapter = {
      acknowledgePayloadCollapse: true,
      description: 'src/materials/installPainterlyHero.ts',
    }
    const acknowledged = await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    expect(acknowledged.action).toBe('exported')
    expect(acknowledged.warnings.join('\n')).toMatch(
      /applicationMaterialAdapter "src\/materials\/installPainterlyHero\.ts".*Showcase.*browser gate/s,
    )
    expect(existsSync(scene.glbPath)).toBe(true)
    expect(existsSync(scene.manifestPath)).toBe(true)
    expect(existsSync(scene.modulePath)).toBe(true)

    const unchanged = await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    expect(unchanged.action).toBe('skipped')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(2)

    mocks.compilerSignatureSuffix = '\nmaterial-policy-revision'
    const policyChanged = await syncScene(scene, {
      executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
    })
    expect(policyChanged.action).toBe('exported')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(3)

    const lastGood = {
      glb: readFileSync(scene.glbPath),
      manifest: readFileSync(scene.manifestPath),
      module: readFileSync(scene.modulePath),
    }
    scene.applicationMaterialAdapter = undefined
    mocks.bakePlan = {
      objects: [{
        name: 'Baked Backdrop',
        atlas: 'main',
        bakeOutput: 'appearance',
      }],
      dynamicObjects: [{
        name: 'Icosphere',
        reason: 'explicit blendlink_dynamic',
      }],
    }

    for (const options of [
      { force: true },
      { force: true, draft: true, authoringPreview: true },
    ]) {
      await expect(syncScene(scene, {
        executable: 'mock-blender', version: '5.2.0', semver: [5, 2, 0],
      }, options)).rejects.toThrow(
        /Material Fidelity.*Showcase.*Icosphere.*previous publication was not changed/s,
      )
      expect(readFileSync(scene.glbPath)).toEqual(lastGood.glb)
      expect(readFileSync(scene.manifestPath)).toEqual(lastGood.manifest)
      expect(readFileSync(scene.modulePath)).toEqual(lastGood.module)
      expect(readdirSync(dirname(scene.glbPath)).filter(
        (name) => name.startsWith('.blendlink-stage-'),
      )).toEqual([])
    }
  })
})
