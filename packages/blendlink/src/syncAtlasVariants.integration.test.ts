import { createHash } from 'node:crypto'
import {
  existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig, ResolvedScene } from './config.js'

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

function hash16(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

describe('published baked-atlas tier integrity', () => {
  it('publishes every PNG/WebP variant and rebuilds after a changed or missing tier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'blendlink-atlas-variants-'))
    temporaryDirectories.push(root)
    const scene: ResolvedScene = {
      name: 'hero',
      root,
      blendPath: join(root, 'hero.blend'),
      glbPath: join(root, 'public', 'models', 'hero.glb'),
      url: '/models/hero.glb',
      manifestPath: join(root, 'src', 'generated', 'hero.manifest.json'),
      modulePath: join(root, 'src', 'generated', 'hero.gen.ts'),
      settings: { mode: 'baked' },
      external: false,
    }
    writeFileSync(scene.blendPath, 'stable blend bytes')

    mocks.exportBlend.mockImplementation(async ({ outPath }: { outPath: string }) => {
      const outputDirectory = dirname(outPath)
      const canonical = join(outputDirectory, 'hero.default.png')
      const tier = join(outputDirectory, 'hero.default.256.png')
      await sharp({
        create: {
          width: 1024, height: 1024, channels: 4,
          background: { r: 110, g: 143, b: 175, alpha: 0.75 },
        },
      }).png().toFile(canonical)
      await sharp({
        create: {
          width: 256, height: 256, channels: 4,
          background: { r: 110, g: 143, b: 175, alpha: 0.75 },
        },
      }).png().toFile(tier)
      const document = new Document()
      const buffer = document.createBuffer()
      const position = document.createAccessor().setType('VEC3').setBuffer(buffer)
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      const mesh = document.createMesh('Baked Mesh').addPrimitive(
        document.createPrimitive().setAttribute('POSITION', position),
      )
      document.createScene('Scene').addChild(document.createNode('Baked Mesh').setMesh(mesh))
      writeFileSync(outPath, await new NodeIO().writeBinary(document))
      return {
        ok: true as const,
        glbPath: outPath,
        blenderVersion: '5.2.0',
        exporterKwargsDropped: [],
        warnings: [],
        excluded: [],
        sidecar: { fps: 24, markers: [], empties: [], curves: [], textures: [] },
        bakedStates: { default: { main: canonical } },
        bakeOutputs: { main: 'appearance' as const },
        bakedStateScales: { default: { main: 1 } },
        bakedStateVisibility: {},
        bakedLightGroups: {},
        bakedVariants: {
          states: { default: { main: [{
            path: tier, width: 256, height: 256,
            bytes: readFileSync(tier).byteLength, hash: hash16(tier),
          }] } },
          lightGroups: {},
        },
        bakeFingerprints: {
          version: 1 as const,
          states: { default: { main: 'stable-fingerprint' } },
          lightGroups: {},
        },
        bakeArtifactHashes: {
          version: 1 as const,
          states: { default: { main: hash16(canonical) } },
          lightGroups: {},
        },
        presentation: 'baked' as const,
        reflectionProbeAssets: {},
        durationMs: 1,
      }
    })

    const blender = {
      executable: 'mock-blender', version: '5.2.0',
      semver: [5, 2, 0] as [number, number, number],
    }
    const config: ResolvedConfig = {
      root, website: { root }, scenes: [scene],
    }
    expect((await syncScene(scene, blender)).action).toBe('exported')

    const manifest = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const sourceUrl = Object.keys(manifest.textureVariants)[0]!
    expect(sourceUrl).toContain(
      `/models/${manifest.runtimeAssetPublication.bundlePath}/`,
    )
    const variants = manifest.textureVariants[sourceUrl] as Array<{
      url: string
      format: 'png' | 'webp'
      width: number
      hash: string
    }>
    expect(variants.map(({ format, width }) => `${width}:${format}`)).toEqual([
      '256:webp', '256:png', '1024:webp',
    ])
    for (const variant of variants) {
      const path = join(dirname(scene.glbPath), basename(variant.url))
      expect(existsSync(path), variant.url).toBe(true)
      expect(hash16(path), variant.url).toBe(variant.hash)
    }

    expect((await syncScene(scene, blender)).action).toBe('skipped')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(1)

    const pngTier = variants.find((variant) => variant.format === 'png')!
    const bundleDirectory = join(
      dirname(scene.glbPath),
      ...manifest.runtimeAssetPublication.bundlePath.split('/'),
    )
    const addressedPngTier = join(bundleDirectory, basename(pngTier.url))
    const addressedPngBytes = readFileSync(addressedPngTier)
    const immutableTime = new Date('2005-06-07T08:09:10.000Z')
    writeFileSync(addressedPngTier, 'changed addressed tier bytes')
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContainEqual(
      expect.stringMatching(/texture variant integrity failed.*256x256 png.*bytes do not match/i),
    )
    writeFileSync(addressedPngTier, addressedPngBytes)
    utimesSync(addressedPngTier, immutableTime, immutableTime)

    writeFileSync(join(dirname(scene.glbPath), basename(pngTier.url)), 'changed tier bytes')
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContainEqual(
      expect.stringMatching(/stable compatibility asset graph integrity failed.*256\.png/i),
    )
    expect((await syncScene(scene, blender)).action).toBe('exported')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(dirname(scene.glbPath), basename(pngTier.url))))
      .toEqual(addressedPngBytes)
    expect(statSync(addressedPngTier).mtimeMs).toBe(immutableTime.getTime())

    const republished = JSON.parse(readFileSync(scene.manifestPath, 'utf8'))
    const republishedSource = Object.keys(republished.textureVariants)[0]!
    const fullWebp = republished.textureVariants[republishedSource]
      .find((variant: { format: string; width: number }) => (
        variant.format === 'webp' && variant.width === 1024
      ))
    const fullWebpPath = join(dirname(scene.glbPath), basename(fullWebp.url))
    unlinkSync(fullWebpPath)
    expect((await verifyAll(config)).map((issue) => issue.problem)).toContainEqual(
      expect.stringMatching(/stable compatibility asset graph integrity failed.*default\.webp.*missing/i),
    )
    expect((await syncScene(scene, blender)).action).toBe('exported')
    expect(mocks.exportBlend).toHaveBeenCalledTimes(3)
    expect(existsSync(fullWebpPath)).toBe(true)
  })
})
