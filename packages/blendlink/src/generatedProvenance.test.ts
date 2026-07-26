import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Document, NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'
import {
  localPathProvenanceKey,
  prepareGeneratedProvenance,
  readLocalPathProvenance,
  writeLocalPathProvenance,
} from './generatedProvenance.js'
import { generateSceneModule } from './typegen.js'

describe('generated artifact provenance privacy', () => {
  it('keeps project inputs relative and replaces outside paths with opaque references', () => {
    const fixtureRoot = join(tmpdir(), 'blendlink-generated-provenance-fixture')
    const projectRoot = join(fixtureRoot, 'portfolio')
    const sourceBlend = join(projectRoot, 'assets', 'hero.blend')
    const outside = join(fixtureRoot, 'private', 'client-secret.blend')

    const result = prepareGeneratedProvenance({
      projectRoot,
      sourceBlend,
      externalDependencies: [{
        path: outside,
        relativeToBlend: false,
        exists: true,
        bytes: 42,
        hash: '0123456789abcdef',
        volatile: false,
      }, {
        path: join(projectRoot, 'assets', 'textures', 'wall.png'),
        relativeToBlend: false,
        exists: true,
        bytes: 12,
        hash: 'fedcba9876543210',
        volatile: false,
      }, {
        path: 'textures/floor.png',
        relativeToBlend: true,
        exists: true,
        bytes: 8,
        hash: 'aaaaaaaaaaaaaaaa',
        volatile: false,
      }],
    })

    expect(result.sourceBlend).toBe('assets/hero.blend')
    expect(result.sourceBlendLocalPathKey).toBeUndefined()
    expect(result.externalDependencies[0]).toMatchObject({
      path: expect.stringMatching(/^external\/[a-f0-9]{64}$/),
      relativeToBlend: false,
      localPathKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(result.externalDependencies[0]!.path).not.toContain('client-secret')
    expect(result.externalDependencies[0]!.path).not.toMatch(/[A-Za-z]:[\\/]/)
    expect(result.externalDependencies[1]).toMatchObject({
      path: 'assets/textures/wall.png',
      relativeToBlend: false,
      projectRelative: true,
    })
    expect(result.externalDependencies[2]).toMatchObject({
      path: 'textures/floor.png',
      relativeToBlend: true,
    })
    expect(result.localPaths).toEqual([{
      key: result.externalDependencies[0]!.localPathKey,
      absolutePath: outside,
    }])
  })

  it('moves an outside source path behind the same private seam', () => {
    const fixtureRoot = join(tmpdir(), 'blendlink-generated-provenance-source-fixture')
    const projectRoot = join(fixtureRoot, 'portfolio')
    const sourceBlend = join(fixtureRoot, 'private', 'hero.blend')
    const result = prepareGeneratedProvenance({
      projectRoot,
      sourceBlend,
      externalDependencies: [],
    })

    expect(result.sourceBlend).toMatch(/^external\/[a-f0-9]{64}$/)
    expect(result.sourceBlend).not.toContain('hero.blend')
    expect(result.sourceBlendLocalPathKey).toMatch(/^[a-f0-9]{64}$/)
    expect(result.localPaths).toEqual([{
      key: result.sourceBlendLocalPathKey,
      absolutePath: sourceBlend,
    }])
  })

  it('redacts relative dependencies when their Blender source is outside the project', () => {
    const fixtureRoot = join(tmpdir(), 'blendlink-generated-provenance-outside-source')
    const projectRoot = join(fixtureRoot, 'portfolio')
    const sourceBlend = join(fixtureRoot, 'private-client', 'hero.blend')
    const dependencyPath = join(fixtureRoot, 'private-client', 'textures', 'client-logo.png')
    const result = prepareGeneratedProvenance({
      projectRoot,
      sourceBlend,
      externalDependencies: [{
        path: 'textures/client-logo.png',
        relativeToBlend: true,
        exists: true,
        bytes: 12,
        hash: 'fedcba9876543210',
        volatile: false,
      }],
    })

    expect(result.externalDependencies[0]).toMatchObject({
      path: expect.stringMatching(/^external\/[a-f0-9]{64}$/),
      relativeToBlend: false,
      localPathKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(result.externalDependencies)).not.toContain('client-logo')
    expect(result.localPaths).toEqual(expect.arrayContaining([{
      key: result.externalDependencies[0]!.localPathKey,
      absolutePath: dependencyPath,
    }]))
  })

  it('normalizes malformed relative traversal instead of publishing it', () => {
    const fixtureRoot = join(tmpdir(), 'blendlink-generated-provenance-traversal')
    const projectRoot = join(fixtureRoot, 'portfolio')
    const sourceBlend = join(projectRoot, 'assets', 'scenes', 'hero.blend')
    const result = prepareGeneratedProvenance({
      projectRoot,
      sourceBlend,
      externalDependencies: [{
        path: '../textures/wall.png',
        relativeToBlend: true,
        exists: true,
        bytes: 12,
        hash: 'fedcba9876543210',
        volatile: false,
        projectRelative: true,
        localPathKey: 'a'.repeat(64),
      }, {
        path: '../../../../private/client-secret.png',
        relativeToBlend: true,
        exists: true,
        bytes: 8,
        hash: 'aaaaaaaaaaaaaaaa',
        volatile: false,
      }],
    })

    expect(result.externalDependencies[0]).toMatchObject({
      path: 'assets/textures/wall.png',
      relativeToBlend: false,
      projectRelative: true,
    })
    expect(result.externalDependencies[0]!.localPathKey).toBeUndefined()
    expect(result.externalDependencies[1]).toMatchObject({
      path: expect.stringMatching(/^external\/[a-f0-9]{64}$/),
      relativeToBlend: false,
      localPathKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(result.externalDependencies)).not.toContain('client-secret')
  })

  it('refuses unresolvable relative dependency provenance loudly', () => {
    expect(() => prepareGeneratedProvenance({
      projectRoot: join(tmpdir(), 'blendlink-generated-provenance-no-source'),
      externalDependencies: [{
        path: 'textures/wall.png',
        relativeToBlend: true,
        exists: true,
        bytes: 12,
        hash: 'fedcba9876543210',
        volatile: false,
      }],
    })).toThrow(/without sourceBlend/)
  })

  it('does not trust relativeToBlend on an absolute dependency label', () => {
    const fixtureRoot = join(tmpdir(), 'blendlink-generated-provenance-absolute-label')
    const projectRoot = join(fixtureRoot, 'portfolio')
    const outside = join(fixtureRoot, 'private', 'absolute-secret.png')
    const result = prepareGeneratedProvenance({
      projectRoot,
      externalDependencies: [{
        path: outside,
        relativeToBlend: true,
        exists: true,
        bytes: 12,
        hash: 'fedcba9876543210',
        volatile: false,
      }],
    })

    expect(result.externalDependencies[0]).toMatchObject({
      path: expect.stringMatching(/^external\/[a-f0-9]{64}$/),
      relativeToBlend: false,
      localPathKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(result.externalDependencies)).not.toContain('absolute-secret')
  })

  it('round-trips exact paths only through the private user cache and rejects tampering', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-local-provenance-'))
    const privateRoot = join(directory, 'cache')
    const path = join(directory, 'outside', 'secret.blend')
    mkdirSync(join(directory, 'outside'), { recursive: true })
    writeFileSync(path, 'private source')
    try {
      const prepared = prepareGeneratedProvenance({
        projectRoot: join(directory, 'project'),
        sourceBlend: path,
        externalDependencies: [],
      })
      writeLocalPathProvenance(prepared.localPaths, { cacheRoot: privateRoot })
      expect(readLocalPathProvenance(prepared.sourceBlendLocalPathKey!, {
        cacheRoot: privateRoot,
      })).toBe(path)

      writeFileSync(
        join(privateRoot, `${prepared.sourceBlendLocalPathKey}.json`),
        JSON.stringify({ schemaVersion: 1, key: prepared.sourceBlendLocalPathKey, path: join(directory, 'wrong') }),
      )
      expect(readLocalPathProvenance(prepared.sourceBlendLocalPathKey!, {
        cacheRoot: privateRoot,
      })).toBeNull()
      expect(() => writeLocalPathProvenance(prepared.localPaths, {
        cacheRoot: privateRoot,
      })).toThrow(/is corrupt/)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')(
    'treats Windows path casing as the same private cache identity',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'blendlink-local-provenance-case-'))
      const privateRoot = join(directory, 'cache')
      const exactPath = join(directory, 'Private', 'Secret.blend')
      const differentlyCasedPath = exactPath.toUpperCase()
      const key = localPathProvenanceKey(exactPath)
      try {
        writeLocalPathProvenance([{ key, absolutePath: exactPath }], {
          cacheRoot: privateRoot,
        })
        expect(() => writeLocalPathProvenance([{
          key,
          absolutePath: differentlyCasedPath,
        }], { cacheRoot: privateRoot })).not.toThrow()
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
  )

  it('keeps both generated manifest data and the TypeScript header commit-safe', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'blendlink-generated-privacy-'))
    const projectRoot = join(directory, 'site')
    const outside = join(directory, 'private-client-name.blend')
    try {
      mkdirSync(projectRoot, { recursive: true })
      const sourceBlend = join(projectRoot, 'assets', 'hero.blend')
      mkdirSync(join(projectRoot, 'assets'), { recursive: true })
      writeFileSync(sourceBlend, 'blend')
      writeFileSync(outside, 'linked')
      const glbPath = join(projectRoot, 'hero.glb')
      const document = new Document()
      document.createScene('Scene').addChild(document.createNode('Hero'))
      writeFileSync(glbPath, await new NodeIO().writeBinary(document))

      const generated = await generateSceneModule({
        glbPath,
        url: '/hero.glb',
        exportName: 'hero',
        provenanceRoot: projectRoot,
        sourceBlend,
        sidecar: {
          fps: 24, curves: [], markers: [], empties: [], textures: [],
          externalDependencies: [{
            path: outside,
            relativeToBlend: false,
            exists: true,
            bytes: 6,
            hash: '0123456789abcdef',
            volatile: false,
          }],
        },
      })

      const serialized = JSON.stringify(generated.manifest)
      expect(generated.manifest.sourceBlend).toBe('assets/hero.blend')
      expect(generated.module.split('\n')[0]).toContain('Source: assets/hero.blend')
      expect(serialized).not.toContain(directory)
      expect(serialized).not.toContain('private-client-name')
      expect(generated.localProvenance).toEqual([
        expect.objectContaining({ absolutePath: outside }),
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
